import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { WordpressService } from '../wordpress/wordpress.service';
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
  // 1800〜2200文字程度を狙うため、過剰生成を抑える
  [ArticleType.SEO]: 6400,
  [ArticleType.REPAIR_REPORT]: 7200,
  [ArticleType.QA]: 6400,
  [ArticleType.RANKING]: 6800,
};

@Injectable()
export class BlogGeneratorService {
  private readonly logger = new Logger(BlogGeneratorService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly wordpressService: WordpressService,
    private readonly imageGeneratorService: ImageGeneratorService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async generateAndCreateDraft(dto: GenerateBlogDto) {
    const articleType = dto.articleType ?? ArticleType.SEO;
    const keywordList = dto.keywords.join(', ');
    this.logger.log(
      `Generating [${articleType}] blog from keywords: [${keywordList}]`,
    );

    // 1. Claude で記事本文を生成
    const blog = await this.generateContent(dto, articleType);

    // 2. 画像を並列生成（サムネイル + セクション画像）
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

    // 3. 画像をWordPressにアップロード
    const uploadedImages = await this.uploadAllImages(blog.title, imageResults);

    // 4. 本文中のプレースホルダーを画像タグに置換
    let content = blog.content;
    uploadedImages.sections.forEach((img, i) => {
      const placeholder = `<!-- IMAGE_${i} -->`;
      const figureHtml = `<figure class="wp-block-image"><img src="${img.url}" alt="${sectionImageDefs[i]?.altText ?? ''}" />${sectionImageDefs[i]?.altText ? `<figcaption>${sectionImageDefs[i].altText}</figcaption>` : ''}</figure>`;
      content = content.replace(placeholder, figureHtml);
    });

    // 未使用のプレースホルダーを除去
    content = content.replace(/<!-- IMAGE_\d+ -->/g, '');

    // FAQ構造化データ（JSON-LD）を記事末に挿入
    if (blog.faq && blog.faq.length > 0) {
      content += this.buildFaqJsonLd(blog.faq);
    }

    // 5. カテゴリ・タグのID解決
    const categoryNames = dto.categoryNames ?? blog.suggestedCategories ?? [];
    const tagNames = dto.tagNames ?? blog.suggestedTags ?? [];

    const [categoryIds, tagIds] = await Promise.all([
      this.resolveCategories(categoryNames),
      this.resolveTags(tagNames),
    ]);

    // 6. WordPress に下書き投稿
    const metaDescription = blog.metaDescription || blog.excerpt;
    const post = await this.wordpressService.createPost({
      title: blog.title,
      content,
      excerpt: metaDescription,
      slug: blog.slug,
      status: 'draft',
      featured_media: uploadedImages.thumbnailId,
      categories: categoryIds.length > 0 ? categoryIds : undefined,
      tags: tagIds.length > 0 ? tagIds : undefined,
    });

    this.logger.log(`Draft created: id=${post.id}, title="${blog.title}"`);

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
  ): Promise<GeneratedBlog> {
    const prompt = buildPrompt(articleType, dto.keywords, dto.topic);

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
      // JSON が途中で切れている場合の修復を試みる
      this.logger.warn('JSON parse failed, attempting repair...');
      jsonStr = this.repairTruncatedJson(jsonStr);
      return JSON.parse(jsonStr) as GeneratedBlog;
    }
  }

  private repairTruncatedJson(jsonStr: string): string {
    // 未閉じの文字列を閉じる
    const quoteCount = (jsonStr.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      jsonStr += '"';
    }

    // 開き括弧と閉じ括弧のバランスを修復
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

    // 末尾のゴミ（途中で切れた key/value）を取り除く
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

  // ── 画像の並列生成 ──

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
    return {
      thumbnail: results[0],
      sections: results.slice(1),
    };
  }

  // ── 画像のアップロード ──

  private async uploadAllImages(
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

    // サムネイルアップロード
    if (images.thumbnail) {
      try {
        const filename = `thumbnail-${slug}-${Date.now()}.png`;
        const media = await this.wordpressService.uploadMedia(
          images.thumbnail,
          filename,
          'image/png',
        );
        thumbnailId = media.id;
        this.logger.log(
          `Thumbnail uploaded: mediaId=${media.id}, url=${media.source_url}`,
        );
      } catch (err) {
        this.logger.warn(`Thumbnail upload failed: ${err.message}`);
      }
    }

    // セクション画像アップロード（順番を保持するため直列）
    const sections: { id: number; url: string }[] = [];
    for (let i = 0; i < images.sections.length; i++) {
      const buf = images.sections[i];
      if (!buf) continue;
      try {
        const filename = `section-${slug}-${i}-${Date.now()}.png`;
        const media = await this.wordpressService.uploadMedia(
          buf,
          filename,
          'image/png',
        );
        sections.push({ id: media.id, url: media.source_url });
        this.logger.log(
          `Section image ${i} uploaded: mediaId=${media.id}, url=${media.source_url}`,
        );
      } catch (err) {
        this.logger.warn(`Section image ${i} upload failed: ${err.message}`);
      }
    }

    return { thumbnailId, sections };
  }

  // ── カテゴリ・タグの名前 → ID 解決 ──

  private async resolveCategories(names: string[]): Promise<number[]> {
    if (names.length === 0) return [];
    try {
      const categories = await this.wordpressService.listCategories();
      return names
        .map((name) => {
          const found = categories.find(
            (c: { name: string }) => c.name === name,
          );
          return found?.id;
        })
        .filter((id): id is number => id !== undefined);
    } catch (err) {
      this.logger.warn(`Failed to resolve categories: ${err.message}`);
      return [];
    }
  }

  // ── FAQ構造化データ生成 ──

  buildFaqJsonLd(faq: FaqItem[]): string {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    };
    return `\n<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
  }

  private async resolveTags(names: string[]): Promise<number[]> {
    if (names.length === 0) return [];
    try {
      const tags = await this.wordpressService.listTags();
      return names
        .map((name) => {
          const found = tags.find((t: { name: string }) => t.name === name);
          return found?.id;
        })
        .filter((id): id is number => id !== undefined);
    } catch (err) {
      this.logger.warn(`Failed to resolve tags: ${err.message}`);
      return [];
    }
  }
}
