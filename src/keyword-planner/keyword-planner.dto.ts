import { ArticleType } from '../blog-generator/blog-generator.dto';
import { KeywordPlanStatus } from '../entities';

export interface PlanDayItem {
  offset: number;
  keywords: [string, string, string];
  topic: string;
  articleType: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  /** なぜこのキーワードを選んだかの簡易な生成理由（GSCデータ根拠）。 */
  reason?: string;
}

export interface PlanResponseRaw {
  days: PlanDayItem[];
}

export interface PlanSummary {
  id: number;
  siteSlug: string;
  cycleStart: string;
  cycleEnd: string;
  status: KeywordPlanStatus;
  generatedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  scheduleEntryCount?: number;
}

export interface PlanCycleResult {
  processed: number;
  succeeded: number;
  failed: number;
  /** 有効なサイクルが残っていて生成しなかったサイト数。 */
  skipped: number;
  results: Array<{
    siteSlug: string;
    status: 'created' | 'skipped' | 'failed';
    planId?: number;
    insertedSchedules?: number;
    /** status='skipped' のとき、既存サイクルの終了日 (YYYY-MM-DD)。 */
    activeUntil?: string;
    error?: string;
  }>;
}

export class ApprovePlanDto {
  approvedBy?: string;
}

export interface PlanDetail extends PlanSummary {
  snapshotId?: number;
  days: PlanDayItem[];
}
