import { ArticleType } from '../blog-generator/blog-generator.dto';

/** 記事タイプごとの生成プロンプト。未設定の記事タイプは既定値が使われる。 */
export type PromptTemplates = Partial<Record<ArticleType, string>>;

export class CreateSiteDto {
  slug!: string;
  name!: string;
  wpUrl!: string;
  wpUsername!: string;
  wpAppPassword!: string; // 平文受信 → サーバ側で暗号化
  gscSiteUrl!: string;
  defaultArticleType?: ArticleType;
  promptTemplates?: PromptTemplates;
  active?: boolean;
}

export class UpdateSiteDto {
  name?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  gscSiteUrl?: string;
  defaultArticleType?: ArticleType;
  promptTemplates?: PromptTemplates;
  active?: boolean;
}

export interface SiteResponse {
  id: number;
  slug: string;
  name: string;
  wpUrl: string;
  wpUsername: string;
  gscSiteUrl: string;
  defaultArticleType: ArticleType;
  /** サイト固有のプロンプト。キーが無い記事タイプは既定値が使われる。 */
  promptTemplates?: PromptTemplates;
  active: boolean;
}

/** 記事タイプごとの既定プロンプト（UI の初期表示・「既定値に戻す」用）。 */
export interface PromptDefaultsResponse {
  articleTypes: Array<{
    value: ArticleType;
    label: string;
    template: string;
  }>;
  placeholders: Array<{ token: string; description: string }>;
}
