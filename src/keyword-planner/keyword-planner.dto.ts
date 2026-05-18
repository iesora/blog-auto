import { ArticleType } from '../blog-generator/blog-generator.dto';
import { KeywordPlanStatus } from '../entities';

export interface PlanDayItem {
  offset: number;
  keywords: [string, string, string];
  topic: string;
  articleType: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
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
  results: Array<{
    siteSlug: string;
    status: 'created' | 'failed';
    planId?: number;
    insertedSchedules?: number;
    error?: string;
  }>;
}

export class ApprovePlanDto {
  approvedBy?: string;
}
