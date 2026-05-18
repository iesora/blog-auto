import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Site } from '../entities';
import { SitesService } from '../sites/sites.service';
import {
  WordpressClient,
  WordpressService,
} from '../wordpress/wordpress.service';
import { ImageGeneratorService } from './image-generator.service';
import { GenerateBlogDto, ArticleType } from './blog-generator.dto';
import { buildPrompt } from './prompt-templates';

interface FaqItem {
  question: string;
  answer: string;
}

interface GeneratedBlog {
  title: string;
  content: string;
  excerpt: string;
  metaDescription?: string;
  slug?: string;
  sectionImages?: { altText: string; prompt: string }[];
  suggestedCategories?: string[];
  suggestedTags?: string[];
  faq?: FaqItem[];
}

const MAX_TOKENS: Record<ArticleType, number> = {
  [ArticleType.SEO]: 6400,
  [ArticleType.REPAIR_REPORT]: 7200,
  [ArticleType.QA]: 6400,
  [ArticleType.RANKING]: 6800,
};

export interface GenerateForSiteResult {
  postId: number;
  title: string;
  excerpt: string;
  metaDescription?: string;
  slug?: string;
  status: 'draft';
  articleType: ArticleType;
  featuredMediaId?: number;
  sectionImageCount: number;
  faqCount: number;
  categories: string[];
  tags: string[];
  link?: string;
}

@Injectable()
export class BlogGeneratorService {
  private readonly logger = new Logger(BlogGeneratorService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly wordpressService: WordpressService,
    private readonly sitesService: SitesService,
    private readonly imageGeneratorService: ImageGeneratorService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async generateForSlug(
    slug: string,
    dto: GenerateBlogDto,
  ): Promise<GenerateForSiteResult> {
    const site = await this.sitesService.findBySlug(slug);
    return this.generateForSite(site, dto);
  }

  async generateForSite(
    site: Site,
    dto: GenerateBlogDto,
  ): Promise<GenerateForSiteResult> {
    const articleType =
      dto.articleType ?? site.defaultArticleType ?? ArticleType.SEO;
    const keywordList = dto.keywords.join(', ');
    this.logger.log(
      `[${site.slug}] generating [${articleType}] blog from keywords: [${keywordList}]`,
    );

    const wp = this.wordpressService.forSite(site);

    // 1. Claude で記事本文を生成（サイトのペルソナを織り込む）
    const blog = await this.generateContent(dto, articleType, site);

    // 2. 画像生成
    const inlineImageCount = Math.min(dto.inlineImageCount ?? 2, 4);
    const sectionImageDefs = (blog.sectionImages ?? []).slice(
      0,
      inlineImageCount,
    );
    const imageResults = await this.generateAllImages(
      blog.title,
      articleType,
      sectionImageDefs,
    );

    // 3. WordPress へアップロード
    const uploadedImages = await this.uploadAllImages(
      wp,
      blog.title,
      imageResults,
    );

    // 4. 本文中のプレースホルダー置換
    let content = blog.content;
    uploadedImages.sections.forEach((img, i) => {
      const placeholder = `<!-- IMAGE_${i} -->`;
      const figureHtml = `<figure class="wp-block-image"><img src="${img.url}" alt="${sectionImageDefs[i]?.altText ?? ''}" />${sectionImageDefs[i]?.altText ? `<figcaption>${sectionImageDefs[i].altText}</figcaption>` : ''}</figure>`;
      content = content.replace(placeholder, figureHtml);
    });
    content = content.replace(/<!-- IMAGE_\d+ -->/g, '');

    if (blog.faq && blog.faq.length > 0) {
      content += this.buildFaqJsonLd(blog.faq);
    }

    // 5. カテゴリ・タグの ID 解決
    const categoryNames =
      dto.categoryNames ??
      site.defaultCategories ??
      blog.suggestedCategories ??
      [];
    const tagNames =
      dto.tagNames ?? site.defaultTags ?? blog.suggestedTags ?? [];

    const [categoryIds, tagIds] = await Promise.all([
      this.resolveCategories(wp, categoryNames),
      this.resolveTags(wp, tagNames),
    ]);

    // 6. WordPress に下書き投稿
    const metaDescription = blog.metaDescription || blog.excerpt;
    const post = await wp.createPost({
      title: blog.title,
      content,
      excerpt: metaDescription,
      slug: blog.slug,
      status: 'draft',
      featured_media: uploadedImages.thumbnailId,
      categories: categoryIds.length > 0 ? categoryIds : undefined,
      tags: tagIds.length > 0 ? tagIds : undefined,
    });

    this.logger.log(
      `[${site.slug}] draft created: id=${post.id}, title="${blog.title}"`,
    );

    return {
      postId: post.id,
      title: blog.title,
      excerpt: blog.excerpt,
      metaDescription,
      slug: blog.slug,
      status: 'draft',
      articleType,
      featuredMediaId: uploadedImages.thumbnailId,
      sectionImageCount: uploadedImages.sections.length,
      faqCount: blog.faq?.length ?? 0,
      categories: categoryNames,
      tags: tagNames,
      link: post.link,
    };
  }

  // ── Claude による記事生成 ──

  private async generateContent(
    dto: GenerateBlogDto,
    articleType: ArticleType,
    site: Site,
  ): Promise<GeneratedBlog> {
    const prompt = buildPrompt(articleType, dto.keywords, dto.topic, {
      persona: site.persona,
      siteName: site.name,
    });

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: MAX_TOKENS[articleType],
      messages: [{ role: 'user', content: prompt }],
    });

    if (message.stop_reason === 'max_tokens') {
      this.logger.warn('Claude response was truncated by max_tokens');
    }

    const text =
      message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse generated blog content');
    }

    let jsonStr = jsonMatch[0];
    try {
      return JSON.parse(jsonStr) as GeneratedBlog;
    } catch {
      this.logger.warn('JSON parse failed, attempting repair...');
      jsonStr = this.repairTruncatedJson(jsonStr);
      return JSON.parse(jsonStr) as GeneratedBlog;
    }
  }

  private repairTruncatedJson(jsonStr: string): string {
    const quoteCount = (jsonStr.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) jsonStr += '"';

    let braces = 0;
    let brackets = 0;
    let inString = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (ch === '\\' && inString) {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }

    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*$/, '');
    jsonStr = jsonStr.replace(/,\s*$/, '');

    while (brackets > 0) {
      jsonStr += ']';
      brackets--;
    }
    while (braces > 0) {
      jsonStr += '}';
      braces--;
    }
    return jsonStr;
  }

  // ── 画像 ──

  private async generateAllImages(
    title: string,
    articleType: ArticleType,
    sectionImageDefs: { altText: string; prompt: string }[],
  ): Promise<{
    thumbnail: Buffer | null;
    sections: (Buffer | null)[];
  }> {
    const promises = [
      this.imageGeneratorService
        .generateThumbnail(title, articleType)
        .catch((err) => {
          this.logger.warn(`Thumbnail generation failed: ${err.message}`);
          return null;
        }),
      ...sectionImageDefs.map((def, i) =>
        this.imageGeneratorService
          .generateSectionImage(def.prompt)
          .catch((err) => {
            this.logger.warn(
              `Section image ${i} generation failed: ${err.message}`,
            );
            return null;
          }),
      ),
    ];
    const results = await Promise.all(promises);
    return { thumbnail: results[0], sections: results.slice(1) };
  }

  private async uploadAllImages(
    wp: WordpressClient,
    title: string,
    images: { thumbnail: Buffer | null; sections: (Buffer | null)[] },
  ): Promise<{
    thumbnailId: number | undefined;
    sections: { id: number; url: string }[];
  }> {
    const slug = (
      title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'blog'
    ).substring(0, 50);
    let thumbnailId: number | undefined;

    if (images.thumbnail) {
      try {
        const filename = `thumbnail-${slug}-${Date.now()}.png`;
        const media = await wp.uploadMedia(
          images.thumbnail,
          filename,
          'image/png',
        );
        thumbnailId = media.id;
      } catch (err) {
        this.logger.warn(`Thumbnail upload failed: ${(err as Error).message}`);
      }
    }

    const sections: { id: number; url: string }[] = [];
    for (let i = 0; i < images.sections.length; i++) {
      const buf = images.sections[i];
      if (!buf) continue;
      try {
        const filename = `section-${slug}-${i}-${Date.now()}.png`;
        const media = await wp.uploadMedia(buf, filename, 'image/png');
        sections.push({ id: media.id, url: media.source_url });
      } catch (err) {
        this.logger.warn(
          `Section image ${i} upload failed: ${(err as Error).message}`,
        );
      }
    }

    return { thumbnailId, sections };
  }

  // ── カテゴリ / タグ ──

  private async resolveCategories(
    wp: WordpressClient,
    names: string[],
  ): Promise<number[]> {
    if (names.length === 0) return [];
    try {
      const categories = await wp.listCategories();
      return names
        .map((name) => {
          const found = categories.find(
            (c: { name: string }) => c.name === name,
          );
          return found?.id;
        })
        .filter((id): id is number => id !== undefined);
    } catch (err) {
      this.logger.warn(
        `Failed to resolve categories: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async resolveTags(
    wp: WordpressClient,
    names: string[],
  ): Promise<number[]> {
    if (names.length === 0) return [];
    try {
      const tags = await wp.listTags();
      return names
        .map((name) => {
          const found = tags.find((t: { name: string }) => t.name === name);
          return found?.id;
        })
        .filter((id): id is number => id !== undefined);
    } catch (err) {
      this.logger.warn(`Failed to resolve tags: ${(err as Error).message}`);
      return [];
    }
  }

  // ── FAQ JSON-LD ──

  buildFaqJsonLd(faq: FaqItem[]): string {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    };
    return `\n<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
  }
}
