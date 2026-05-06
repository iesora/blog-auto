import { ArticleType } from '../blog-generator/blog-generator.dto';

export class UpsertScheduleDto {
  date!: string;
  keywords!: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
}

export type RunStatus = 'success' | 'failed';

export interface RunHistory {
  status: RunStatus;
  ranAt: string;
  postId?: number;
  postLink?: string;
  postTitle?: string;
  error?: string;
}

export interface ScheduleEntry {
  date: string;
  keywords: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
  lastRun?: RunHistory;
}
