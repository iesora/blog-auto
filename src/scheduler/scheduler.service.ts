import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BlogGeneratorService } from '../blog-generator/blog-generator.service';
import { SitesService } from '../sites/sites.service';
import { ScheduleEntry, RunHistory } from '../entities';
import { SchedulerStorageService } from './scheduler-storage.service';
import {
  PatchScheduleDto,
  RunForDateResult,
  RunHistoryView,
  ScheduleEntryView,
  UpsertScheduleDto,
} from './scheduler.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly blogGenerator: BlogGeneratorService,
    private readonly sitesService: SitesService,
    private readonly storage: SchedulerStorageService,
  ) {}

  // ── 日付ヘルパ ──

  private todayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── 表現変換 ──

  toView(entry: ScheduleEntry, lastRun?: RunHistory | null): ScheduleEntryView {
    return {
      id: entry.id,
      siteSlug: entry.site?.slug ?? '',
      siteName: entry.site?.name ?? '',
      date: entry.scheduledDate,
      status: entry.status,
      source: entry.source,
      planId: entry.planId,
      keywords: [entry.keyword1, entry.keyword2, entry.keyword3],
      topic: entry.topic,
      articleType: entry.articleType,
      categoryNames: entry.categoryNames,
      tagNames: entry.tagNames,
      inlineImageCount: entry.inlineImageCount,
      lastRun: lastRun ? this.toRunView(lastRun) : undefined,
    };
  }

  private toRunView(r: RunHistory): RunHistoryView {
    return {
      status: r.status,
      ranAt: r.ranAt.toISOString(),
      postId: r.wpPostId,
      postLink: r.wpPostLink,
      postTitle: r.wpPostTitle,
      error: r.error,
      durationMs: r.durationMs,
    };
  }

  // ── CRUD ──

  async upsert(dto: UpsertScheduleDto): Promise<ScheduleEntryView> {
    if (!dto.date || !DATE_RE.test(dto.date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    if (!dto.siteSlug) throw new BadRequestException('siteSlug is required');
    if (!Array.isArray(dto.keywords) || dto.keywords.length !== 3) {
      throw new BadRequestException('keywords must be exactly 3 strings');
    }
    const keywords = dto.keywords.map((k) => String(k).trim());
    if (keywords.some((k) => k.length === 0)) {
      throw new BadRequestException('all 3 keywords must be non-empty');
    }
    const site = await this.sitesService.findBySlug(dto.siteSlug);
    const saved = await this.storage.upsert({
      siteId: site.id,
      scheduledDate: dto.date,
      keyword1: keywords[0],
      keyword2: keywords[1],
      keyword3: keywords[2],
      topic: dto.topic,
      articleType: dto.articleType,
      categoryNames: dto.categoryNames,
      tagNames: dto.tagNames,
      inlineImageCount: dto.inlineImageCount,
      status: dto.status ?? 'pending',
      source: 'manual',
    });
    saved.site = site;
    const lastRun = await this.storage.findLatestRun(saved.id);
    return this.toView(saved, lastRun);
  }

  async patch(id: number, dto: PatchScheduleDto): Promise<ScheduleEntryView> {
    const entry = await this.storage.findById(id);
    if (!entry) throw new NotFoundException(`schedule id=${id} not found`);
    const patch: Record<string, unknown> = {};
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.keywords) {
      if (dto.keywords.length !== 3)
        throw new BadRequestException('keywords must be exactly 3 strings');
      patch.keyword1 = dto.keywords[0];
      patch.keyword2 = dto.keywords[1];
      patch.keyword3 = dto.keywords[2];
    }
    if (dto.topic !== undefined) patch.topic = dto.topic;
    if (dto.articleType !== undefined) patch.articleType = dto.articleType;
    if (dto.categoryNames !== undefined)
      patch.categoryNames = dto.categoryNames;
    if (dto.tagNames !== undefined) patch.tagNames = dto.tagNames;
    if (dto.inlineImageCount !== undefined)
      patch.inlineImageCount = dto.inlineImageCount;
    const updated = await this.storage.patch(id, patch);
    updated.site = entry.site;
    const lastRun = await this.storage.findLatestRun(id);
    return this.toView(updated, lastRun);
  }

  async list(opts: {
    siteSlug?: string;
    from?: string;
    to?: string;
  }): Promise<ScheduleEntryView[]> {
    const entries = await this.storage.listSchedules(opts);
    const views: ScheduleEntryView[] = [];
    for (const e of entries) {
      const lastRun = await this.storage.findLatestRun(e.id);
      views.push(this.toView(e, lastRun));
    }
    return views;
  }

  // ── 実行 ──

  async runForDate(date: string): Promise<RunForDateResult> {
    if (!DATE_RE.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const entries = await this.storage.findApprovedForDate(date);
    this.logger.log(
      `runForDate(${date}): ${entries.length} approved entries found`,
    );
    if (entries.length === 0) {
      return {
        date,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      };
    }

    // 5サイト分は並列に実行（1サイトの失敗が他に波及しない）
    const settled = await Promise.allSettled(
      entries.map((entry) => this.runOneEntry(entry)),
    );

    const results = settled.map((s, i) => {
      const entry = entries[i];
      if (s.status === 'fulfilled') return s.value;
      return {
        siteSlug: entry.site?.slug ?? `site-${entry.siteId}`,
        status: 'failed' as const,
        error: (s.reason as Error)?.message ?? String(s.reason),
        durationMs: 0,
      };
    });

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.length - succeeded;

    this.logger.log(
      `runForDate(${date}) done: processed=${results.length}, succeeded=${succeeded}, failed=${failed}`,
    );

    return {
      date,
      processed: results.length,
      succeeded,
      failed,
      results,
    };
  }

  async runToday(): Promise<RunForDateResult> {
    return this.runForDate(this.todayString());
  }

  /**
   * 1エントリ分の実行。再実行時は既に成功している場合スキップする。
   */
  private async runOneEntry(entry: ScheduleEntry) {
    const startedAt = Date.now();
    const siteSlug = entry.site?.slug ?? `site-${entry.siteId}`;

    // 冪等性: 同じスケジュールで既に成功済みならスキップ
    const prior = await this.storage.findLatestSuccessfulRun(entry.id);
    if (prior) {
      this.logger.log(
        `[${siteSlug}] entry id=${entry.id} (${entry.scheduledDate}) already succeeded at ${prior.ranAt.toISOString()} — skipping`,
      );
      return {
        siteSlug,
        status: 'success' as const,
        postId: prior.wpPostId,
        postLink: prior.wpPostLink,
        postTitle: prior.wpPostTitle,
        durationMs: 0,
      };
    }

    try {
      const result = await this.blogGenerator.generateForSite(entry.site, {
        keywords: [entry.keyword1, entry.keyword2, entry.keyword3],
        topic: entry.topic,
        articleType: entry.articleType,
        categoryNames: entry.categoryNames,
        tagNames: entry.tagNames,
        inlineImageCount: entry.inlineImageCount,
      });
      const durationMs = Date.now() - startedAt;
      await this.storage.createRunHistory({
        scheduleEntryId: entry.id,
        status: 'success',
        ranAt: new Date(),
        wpPostId: result.postId,
        wpPostLink: result.link,
        wpPostTitle: result.title,
        durationMs,
      });
      return {
        siteSlug,
        status: 'success' as const,
        postId: result.postId,
        postLink: result.link,
        postTitle: result.title,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = (err as Error).message;
      this.logger.error(
        `[${siteSlug}] entry id=${entry.id} failed: ${message}`,
      );
      await this.storage.createRunHistory({
        scheduleEntryId: entry.id,
        status: 'failed',
        ranAt: new Date(),
        error: message,
        durationMs,
      });
      return {
        siteSlug,
        status: 'failed' as const,
        error: message,
        durationMs,
      };
    }
  }
}
