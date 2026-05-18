import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { Repository } from 'typeorm';
import {
  GscQueryRow,
  GscSnapshot,
  KeywordPlan,
  ScheduleEntry,
  Site,
} from '../entities';
import { ArticleType } from '../blog-generator/blog-generator.dto';
import { SearchConsoleService } from '../search-console/search-console.service';
import { SitesService } from '../sites/sites.service';
import { SchedulerStorageService } from '../scheduler/scheduler-storage.service';
import {
  PlanCycleResult,
  PlanDayItem,
  PlanResponseRaw,
  PlanSummary,
} from './keyword-planner.dto';

const CYCLE_DAYS = 28;
const TOP_QUERY_LIMIT = 50;

@Injectable()
export class KeywordPlannerService {
  private readonly logger = new Logger(KeywordPlannerService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly sitesService: SitesService,
    private readonly searchConsole: SearchConsoleService,
    private readonly schedulerStorage: SchedulerStorageService,
    @InjectRepository(KeywordPlan)
    private readonly planRepo: Repository<KeywordPlan>,
    @InjectRepository(GscQueryRow)
    private readonly gscRowRepo: Repository<GscQueryRow>,
    @InjectRepository(ScheduleEntry)
    private readonly scheduleRepo: Repository<ScheduleEntry>,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ── サイクル境界 ──

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private toDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private nextCycleRange(): { start: Date; end: Date } {
    const tomorrow = this.addDays(new Date(), 1);
    const end = this.addDays(tomorrow, CYCLE_DAYS - 1);
    return { start: tomorrow, end };
  }

  // ── plan-next-cycle ──

  async planNextCycle(): Promise<PlanCycleResult> {
    const sites = await this.sitesService.listActive();
    this.logger.log(`planNextCycle: ${sites.length} active sites`);

    const settled = await Promise.allSettled(
      sites.map((s) => this.planForSite(s)),
    );

    const results = settled.map((s, i) => {
      const site = sites[i];
      if (s.status === 'fulfilled') {
        return {
          siteSlug: site.slug,
          status: 'created' as const,
          planId: s.value.planId,
          insertedSchedules: s.value.insertedSchedules,
        };
      }
      return {
        siteSlug: site.slug,
        status: 'failed' as const,
        error: (s.reason as Error)?.message ?? String(s.reason),
      };
    });

    const succeeded = results.filter((r) => r.status === 'created').length;
    return {
      processed: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  }

  async planForSlug(
    slug: string,
  ): Promise<{ planId: number; insertedSchedules: number }> {
    const site = await this.sitesService.findBySlug(slug);
    return this.planForSite(site);
  }

  /**
   * 1サイト分のキーワードプラン生成。
   * 1) GSC スナップショットを取得（既に直近のものがあれば再利用）
   * 2) 候補シードを抽出して Claude にプロンプト
   * 3) keyword_plans を draft で保存
   * 4) schedule_entries を pending / source='auto' で upsert（既存 approved は保護）
   */
  async planForSite(
    site: Site,
  ): Promise<{ planId: number; insertedSchedules: number }> {
    const snapshot = await this.searchConsole.fetchAndStore(site);
    const seeds = await this.extractSeeds(snapshot);
    const recentTitles = await this.recentPostTitles(site);

    const days = await this.callClaude(site, seeds, recentTitles);
    if (days.length !== CYCLE_DAYS) {
      throw new Error(
        `Claude returned ${days.length} days (expected ${CYCLE_DAYS}). plan は draft のまま、schedule は作成しない`,
      );
    }

    const cycle = this.nextCycleRange();
    const cycleStart = this.toDateString(cycle.start);
    const cycleEnd = this.toDateString(cycle.end);

    const plan = await this.planRepo.save(
      this.planRepo.create({
        siteId: site.id,
        cycleStart,
        cycleEnd,
        status: 'draft',
        snapshotId: snapshot.id,
        generatedBy: 'claude-sonnet-4-6',
        rawResponse: { days } as unknown,
      }),
    );

    let inserted = 0;
    for (const day of days) {
      const date = this.toDateString(this.addDays(cycle.start, day.offset));
      const upserted = await this.schedulerStorage.upsertProtectingApproved({
        siteId: site.id,
        scheduledDate: date,
        keyword1: day.keywords[0],
        keyword2: day.keywords[1],
        keyword3: day.keywords[2],
        topic: day.topic,
        articleType: day.articleType,
        categoryNames: day.categoryNames,
        tagNames: day.tagNames,
        status: 'pending',
        source: 'auto',
        planId: plan.id,
      });
      if (upserted) inserted++;
    }

    this.logger.log(
      `[${site.slug}] plan ${plan.id} (${cycleStart}..${cycleEnd}) created, schedule rows upserted=${inserted}`,
    );
    return { planId: plan.id, insertedSchedules: inserted };
  }

  // ── 一覧 / 承認 / 棄却 ──

  async listPlans(opts: {
    siteSlug?: string;
    status?: string;
  }): Promise<PlanSummary[]> {
    const qb = this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.site', 'site')
      .orderBy('p.createdAt', 'DESC');
    if (opts.siteSlug) qb.andWhere('site.slug = :slug', { slug: opts.siteSlug });
    if (opts.status) qb.andWhere('p.status = :status', { status: opts.status });
    const plans = await qb.getMany();
    return plans.map((p) => ({
      id: p.id,
      siteSlug: p.site?.slug ?? '',
      cycleStart: p.cycleStart,
      cycleEnd: p.cycleEnd,
      status: p.status,
      generatedBy: p.generatedBy,
      approvedBy: p.approvedBy,
      approvedAt: p.approvedAt?.toISOString(),
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async approvePlan(planId: number, approvedBy?: string): Promise<PlanSummary> {
    const plan = await this.planRepo.findOne({
      where: { id: planId },
      relations: { site: true },
    });
    if (!plan) throw new NotFoundException(`plan ${planId} not found`);
    if (plan.status !== 'draft') {
      throw new BadRequestException(
        `plan status must be 'draft' to approve (current=${plan.status})`,
      );
    }
    plan.status = 'approved';
    plan.approvedBy = approvedBy ?? 'system';
    plan.approvedAt = new Date();
    await this.planRepo.save(plan);

    // 配下の pending schedule を approved に一括更新
    const updated = await this.scheduleRepo
      .createQueryBuilder()
      .update(ScheduleEntry)
      .set({ status: 'approved' })
      .where('plan_id = :pid AND status = :pending', {
        pid: plan.id,
        pending: 'pending',
      })
      .execute();
    this.logger.log(
      `plan ${planId} approved, ${updated.affected ?? 0} schedules promoted to approved`,
    );

    return {
      id: plan.id,
      siteSlug: plan.site?.slug ?? '',
      cycleStart: plan.cycleStart,
      cycleEnd: plan.cycleEnd,
      status: plan.status,
      generatedBy: plan.generatedBy,
      approvedBy: plan.approvedBy,
      approvedAt: plan.approvedAt?.toISOString(),
      createdAt: plan.createdAt.toISOString(),
    };
  }

  async rejectPlan(planId: number): Promise<PlanSummary> {
    const plan = await this.planRepo.findOne({
      where: { id: planId },
      relations: { site: true },
    });
    if (!plan) throw new NotFoundException(`plan ${planId} not found`);
    plan.status = 'rejected';
    await this.planRepo.save(plan);

    await this.scheduleRepo
      .createQueryBuilder()
      .update(ScheduleEntry)
      .set({ status: 'skipped' })
      .where('plan_id = :pid AND status = :pending', {
        pid: plan.id,
        pending: 'pending',
      })
      .execute();

    return {
      id: plan.id,
      siteSlug: plan.site?.slug ?? '',
      cycleStart: plan.cycleStart,
      cycleEnd: plan.cycleEnd,
      status: plan.status,
      generatedBy: plan.generatedBy,
      createdAt: plan.createdAt.toISOString(),
    };
  }

  // ── 内部：候補抽出 ──

  private async extractSeeds(snapshot: GscSnapshot): Promise<{
    highImpLowCtr: GscQueryRow[];
    midPosition: GscQueryRow[];
  }> {
    // A. impressions ≥ 100 かつ ctr ≤ 1.0%
    const highImpLowCtr = await this.gscRowRepo
      .createQueryBuilder('r')
      .where('r.snapshot_id = :sid', { sid: snapshot.id })
      .andWhere('r.impressions >= 100')
      .andWhere('r.ctr <= 0.01')
      .orderBy('r.impressions', 'DESC')
      .limit(TOP_QUERY_LIMIT)
      .getMany();

    // B. position が 8〜20
    const midPosition = await this.gscRowRepo
      .createQueryBuilder('r')
      .where('r.snapshot_id = :sid', { sid: snapshot.id })
      .andWhere('r.position BETWEEN 8 AND 20')
      .orderBy('r.impressions', 'DESC')
      .limit(TOP_QUERY_LIMIT)
      .getMany();

    return { highImpLowCtr, midPosition };
  }

  private async recentPostTitles(site: Site): Promise<string[]> {
    // 直近28日に投稿済みの schedule_entries.run_history を見て title を集める
    const since = this.toDateString(this.addDays(new Date(), -CYCLE_DAYS));
    const rows = await this.scheduleRepo
      .createQueryBuilder('s')
      .leftJoin('s.runs', 'r')
      .select('r.wp_post_title', 'title')
      .where('s.site_id = :sid', { sid: site.id })
      .andWhere('r.status = :ok', { ok: 'success' })
      .andWhere('s.scheduled_date >= :since', { since })
      .getRawMany<{ title: string | null }>();
    return rows
      .map((r) => r.title)
      .filter((t): t is string => !!t)
      .slice(0, 50);
  }

  // ── Claude 呼び出し ──

  private async callClaude(
    site: Site,
    seeds: {
      highImpLowCtr: GscQueryRow[];
      midPosition: GscQueryRow[];
    },
    recentTitles: string[],
  ): Promise<PlanDayItem[]> {
    const prompt = this.buildPrompt(site, seeds, recentTitles);

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    if (message.stop_reason === 'max_tokens') {
      this.logger.warn(`[${site.slug}] keyword plan response was truncated`);
    }

    const text =
      message.content[0]?.type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude response did not contain JSON');
    }
    const parsed = JSON.parse(jsonMatch[0]) as PlanResponseRaw;
    if (!Array.isArray(parsed.days)) {
      throw new Error('Claude response missing days[]');
    }
    return parsed.days.map((d) => this.normalizeDay(d));
  }

  private normalizeDay(d: PlanDayItem): PlanDayItem {
    const at = (d.articleType ?? ArticleType.SEO) as ArticleType;
    const articleType = Object.values(ArticleType).includes(at)
      ? at
      : ArticleType.SEO;
    const kws = (d.keywords ?? []).map((k) => String(k).trim()).slice(0, 3);
    while (kws.length < 3) kws.push(kws[0] ?? 'general');
    return {
      offset: d.offset,
      keywords: [kws[0], kws[1], kws[2]] as [string, string, string],
      topic: d.topic ?? '',
      articleType,
      categoryNames: d.categoryNames,
      tagNames: d.tagNames,
    };
  }

  private buildPrompt(
    site: Site,
    seeds: {
      highImpLowCtr: GscQueryRow[];
      midPosition: GscQueryRow[];
    },
    recentTitles: string[],
  ): string {
    const fmt = (rows: GscQueryRow[]) =>
      rows
        .map(
          (r) =>
            `- "${r.query}" (imp=${r.impressions}, ctr=${(r.ctr * 100).toFixed(2)}%, pos=${r.position.toFixed(1)})`,
        )
        .join('\n');

    return [
      `あなたは ${site.name}（ペルソナ: ${site.persona ?? '(指定なし)'}）の SEO 担当です。`,
      `直近${CYCLE_DAYS}日の Google Search Console データを以下に示します。`,
      `これをもとに「次の${CYCLE_DAYS}日間で書くべきブログ記事」のキーワードを ${CYCLE_DAYS} 件提案してください。`,
      '',
      '# 入力データ',
      '## 高インプ低 CTR クエリ',
      fmt(seeds.highImpLowCtr) || '(該当なし)',
      '',
      '## 順位8〜20の改善余地クエリ',
      fmt(seeds.midPosition) || '(該当なし)',
      '',
      '## 直近に投稿済みの記事タイトル',
      recentTitles.length > 0
        ? recentTitles.map((t) => `- ${t}`).join('\n')
        : '(なし)',
      '',
      '# 制約',
      `- 1日 = 3つのキーワード（メイン + サブ × 2）`,
      '- 既存記事との重複を避け、内部リンク候補となる関連トピックを優先',
      `- ${CYCLE_DAYS}日分の article_type 分布の目安: SEO 60%, QA 25%, RANKING 10%, REPAIR_REPORT 5%`,
      '- offset は 0..27 の連番。重複させない',
      '',
      '# 出力（厳密な JSON、それ以外を含めない）',
      '{',
      '  "days": [',
      '    {',
      '      "offset": 0,',
      '      "keywords": ["メインキーワード", "サブ1", "サブ2"],',
      '      "topic": "...",',
      '      "articleType": "seo",',
      '      "categoryNames": ["..."],',
      '      "tagNames": ["..."]',
      `    } /* ... ${CYCLE_DAYS}件 ... */`,
      '  ]',
      '}',
    ].join('\n');
  }
}
