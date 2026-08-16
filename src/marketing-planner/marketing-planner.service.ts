import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { GscQueryRow, GscSnapshot } from '../entities';
import { SearchConsoleService } from '../search-console/search-console.service';

const MODEL = 'claude-opus-4-8';
/** プロンプトに載せるクエリ上位件数（表示回数降順） */
const TOP_QUERIES = 80;

export interface MarketingPlanResult {
  snapshotId: number;
  siteSlug: string;
  siteName: string;
  startDate: string;
  endDate: string;
  generatedBy: string;
  generatedAt: string;
  /** Markdown 形式のマーケティング戦略 */
  strategy: string;
}

interface QueryAgg {
  query: string;
  clicks: number;
  impressions: number;
  /** impressions 加重平均の掲載順位 */
  position: number;
}

@Injectable()
export class MarketingPlannerService {
  private readonly logger = new Logger(MarketingPlannerService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly searchConsole: SearchConsoleService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  /**
   * GSC スナップショットを根拠に、次の1ヶ月の Web マーケティング戦略を Claude で立案する。
   */
  async planFromSnapshot(snapshotId: number): Promise<MarketingPlanResult> {
    const snapshot = await this.searchConsole.findSnapshot(snapshotId);
    if (!snapshot) {
      throw new NotFoundException(`snapshot ${snapshotId} not found`);
    }
    const rows = await this.searchConsole.loadSnapshotRows(snapshotId);
    const aggregated = this.aggregateByQuery(rows).slice(0, TOP_QUERIES);

    this.logger.log(
      `marketing-plan: snapshot=${snapshotId} site=${snapshot.site?.slug} queries=${aggregated.length}`,
    );

    const prompt = this.buildPrompt(snapshot, aggregated);
    const strategy = await this.callClaude(prompt);

    // DB へ永続化（リロード後も確認なしで表示できるようにする）
    const generatedAt = new Date();
    await this.searchConsole.saveMarketingPlan(
      snapshotId,
      strategy,
      MODEL,
      generatedAt,
    );

    return this.toResult(snapshot, strategy, MODEL, generatedAt);
  }

  /**
   * 立案済みの戦略を返す。未立案なら null。
   */
  async getSavedPlan(snapshotId: number): Promise<MarketingPlanResult | null> {
    const snapshot = await this.searchConsole.findSnapshot(snapshotId);
    if (!snapshot) {
      throw new NotFoundException(`snapshot ${snapshotId} not found`);
    }
    if (!snapshot.marketingStrategy) return null;
    return this.toResult(
      snapshot,
      snapshot.marketingStrategy,
      snapshot.marketingGeneratedBy ?? MODEL,
      snapshot.marketingGeneratedAt ?? new Date(),
    );
  }

  private toResult(
    snapshot: GscSnapshot,
    strategy: string,
    generatedBy: string,
    generatedAt: Date,
  ): MarketingPlanResult {
    return {
      snapshotId: snapshot.id,
      siteSlug: snapshot.site?.slug ?? '',
      siteName: snapshot.site?.name ?? '',
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      generatedBy,
      generatedAt: generatedAt.toISOString(),
      strategy,
    };
  }

  /** query×page 行を query 単位に集計（順位は impressions 加重平均）。 */
  private aggregateByQuery(rows: GscQueryRow[]): QueryAgg[] {
    const map = new Map<
      string,
      { clicks: number; impressions: number; posWeighted: number }
    >();
    for (const r of rows) {
      const cur = map.get(r.query) ?? {
        clicks: 0,
        impressions: 0,
        posWeighted: 0,
      };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.posWeighted += r.position * r.impressions;
      map.set(r.query, cur);
    }
    return [...map.entries()]
      .map(([query, v]) => ({
        query,
        clicks: v.clicks,
        impressions: v.impressions,
        position: v.impressions > 0 ? v.posWeighted / v.impressions : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);
  }

  private buildPrompt(snapshot: GscSnapshot, rows: QueryAgg[]): string {
    const table = rows
      .map(
        (r) =>
          `| ${r.query} | ${r.impressions} | ${r.clicks} | ${(
            (r.impressions > 0 ? r.clicks / r.impressions : 0) * 100
          ).toFixed(2)}% | ${r.position.toFixed(1)} |`,
      )
      .join('\n');

    return [
      `あなたは経験豊富な Web マーケティング戦略コンサルタントです。`,
      `以下は「${snapshot.site?.name ?? '(サイト名不明)'}」の Google Search Console 実績データ（${snapshot.startDate} 〜 ${snapshot.endDate}、直近約4週間）です。`,
      `このデータを根拠に、次の1ヶ月で講じるべき Web マーケティング戦略を立案してください。`,
      '',
      '# サイト情報',
      `- サイト名: ${snapshot.site?.name ?? '(指定なし)'}`,
      '',
      `# GSC データ（クエリ単位で集計・表示回数の多い順、上位${rows.length}件）`,
      '| クエリ | 表示回数 | クリック数 | CTR | 平均掲載順位 |',
      '| --- | ---: | ---: | ---: | ---: |',
      table || '(データなし)',
      '',
      '# 立案時に重視する観点',
      '- 表示回数が多いのに CTR が低いクエリ → タイトル・メタディスクリプション改善の機会',
      '- 掲載順位が 8〜20 位の「あと一歩」クエリ → コンテンツ強化で1ページ目を狙う',
      '- すでにクリックを多く獲得している強みクエリ → さらに伸ばす / 関連トピックへ横展開',
      '- データから推測できる、取りこぼしている関連トピック・新規キーワードの機会',
      '- 既存記事のリライト優先度',
      '',
      '# 出力要件',
      '- 日本語の Markdown で、具体的かつ実行可能な内容にすること',
      '- 抽象論ではなく、上記データの実際のクエリ名を引用して根拠を示すこと',
      '- 次の見出し構成に従うこと:',
      '',
      '## 1. 現状サマリー（データから読み取れる傾向）',
      '## 2. 今月の重点テーマ（3〜5個）',
      '## 3. 具体的な施策（優先度の高い順。各施策に「対象クエリ/ページ」「狙い」「想定アクション」を明記）',
      '## 4. 新規コンテンツ提案（タイトル案つきで 5〜10 本、狙うクエリも明記）',
      '## 5. 既存コンテンツの改善・リライト提案',
      '## 6. 今月の KPI / 計測指標',
    ].join('\n');
  }

  private async callClaude(prompt: string): Promise<string> {
    // 戦略文は長くなり得るためストリーミングで受ける（HTTP タイムアウト回避）。
    const stream = this.anthropic.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: prompt }],
    });

    const message = await stream.finalMessage();
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) {
      throw new Error('Claude から空の戦略が返されました');
    }
    return text;
  }
}
