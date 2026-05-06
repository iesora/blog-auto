export enum ArticleType {
  SEO = 'seo',
  REPAIR_REPORT = 'repair_report',
  QA = 'qa',
  RANKING = 'ranking',
}

export class GenerateBlogDto {
  keywords!: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
}
