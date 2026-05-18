import { ArticleType } from '../blog-generator/blog-generator.dto';
import {
  ScheduleSource,
  ScheduleStatus,
} from '../entities/schedule-entry.entity';
import { RunStatus } from '../entities/run-history.entity';

export class UpsertScheduleDto {
  /** YYYY-MM-DD */
  date!: string;
  /** サイトの slug。POST /schedules で対象サイトを指定 */
  siteSlug!: string;
  keywords!: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
  /** 任意で初期ステータスを指定（未指定なら 'pending'） */
  status?: ScheduleStatus;
}

export class PatchScheduleDto {
  status?: ScheduleStatus;
  keywords?: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
}

export interface ScheduleEntryView {
  id: number;
  siteSlug: string;
  siteName: string;
  date: string;
  status: ScheduleStatus;
  source: ScheduleSource;
  planId?: number;
  keywords: [string, string, string];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
  lastRun?: RunHistoryView;
}

export interface RunHistoryView {
  status: RunStatus;
  ranAt: string;
  postId?: number;
  postLink?: string;
  postTitle?: string;
  error?: string;
  durationMs?: number;
}

export interface RunForDateResult {
  date: string;
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<{
    siteSlug: string;
    status: RunStatus;
    postId?: number;
    postLink?: string;
    postTitle?: string;
    error?: string;
    durationMs: number;
  }>;
}
