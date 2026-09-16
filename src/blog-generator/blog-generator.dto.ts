export enum ArticleType {
  SEO = 'seo',
  REPAIR_REPORT = 'repair_report',
  QA = 'qa',
  RANKING = 'ranking',
}

/**
 * WordPress への投稿ステータス。
 * サイト単位で既定値を持ち、未設定なら下書き。誤って公開されるのを避けるため
 * 既定は必ず DRAFT 側に倒す。
 */
export enum PostStatus {
  DRAFT = 'draft',
  PUBLISH = 'publish',
}

export class GenerateBlogDto {
  keywords!: string[];
  topic?: string;
  articleType?: ArticleType;
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
  /** 未指定ならサイトの postStatus、それも無ければ下書き。 */
  postStatus?: PostStatus;
}
