import { ArticleType } from '../blog-generator/blog-generator.dto';

export class CreateSiteDto {
  slug!: string;
  name!: string;
  wpUrl!: string;
  wpUsername!: string;
  wpAppPassword!: string; // 平文受信 → サーバ側で暗号化
  gscSiteUrl!: string;
  defaultArticleType?: ArticleType;
  defaultCategories?: string[];
  defaultTags?: string[];
  persona?: string;
  active?: boolean;
}

export class UpdateSiteDto {
  name?: string;
  wpUrl?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  gscSiteUrl?: string;
  defaultArticleType?: ArticleType;
  defaultCategories?: string[];
  defaultTags?: string[];
  persona?: string;
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
  defaultCategories?: string[];
  defaultTags?: string[];
  persona?: string;
  active: boolean;
}
