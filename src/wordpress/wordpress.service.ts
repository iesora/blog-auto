import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { Site } from '../entities';
import { SitesService } from '../sites/sites.service';
import { CreatePostDto, UpdatePostDto } from './wordpress.dto';

/**
 * 1サイトに紐づく WordPress REST クライアント。
 * 認証情報は復号した状態で保持する。利用が終わったら参照を破棄する想定。
 */
export class WordpressClient {
  private readonly logger = new Logger(WordpressClient.name);
  private readonly client: AxiosInstance;

  constructor(
    public readonly site: Site,
    appPasswordPlain: string,
  ) {
    const token = Buffer.from(
      `${site.wpUsername}:${appPasswordPlain}`,
    ).toString('base64');

    this.client = axios.create({
      baseURL: `${site.wpUrl.replace(/\/+$/, '')}/wp-json/wp/v2`,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async createPost(dto: CreatePostDto) {
    const { data } = await this.client.post('/posts', {
      title: dto.title,
      content: dto.content,
      status: dto.status ?? 'draft',
      categories: dto.categories,
      tags: dto.tags,
      featured_media: dto.featured_media,
      excerpt: dto.excerpt,
      slug: dto.slug,
    });
    this.logger.log(
      `[${this.site.slug}] post created: id=${data.id}, title="${data.title.rendered}"`,
    );
    return data;
  }

  async updatePost(id: number, dto: UpdatePostDto) {
    const { data } = await this.client.put(`/posts/${id}`, dto);
    this.logger.log(`[${this.site.slug}] post updated: id=${data.id}`);
    return data;
  }

  async deletePost(id: number) {
    const { data } = await this.client.delete(`/posts/${id}`);
    this.logger.log(`[${this.site.slug}] post deleted: id=${id}`);
    return data;
  }

  async getPost(id: number) {
    const { data } = await this.client.get(`/posts/${id}`);
    return data;
  }

  async listPosts(params?: {
    page?: number;
    per_page?: number;
    status?: string;
  }) {
    const { data } = await this.client.get('/posts', { params });
    return data;
  }

  async listCategories() {
    const { data } = await this.client.get('/categories', {
      params: { per_page: 100 },
    });
    return data;
  }

  async listTags() {
    const { data } = await this.client.get('/tags', {
      params: { per_page: 100 },
    });
    return data;
  }

  /**
   * サイトに存在するカテゴリー名・タグ名を返す。
   *
   * 分類はエンドユーザーが WordPress 側で管理しているものを正とし、記事生成・
   * キーワード生成のプロンプトに「この中から選べ」と渡すために使う。
   * 取得に失敗しても生成自体は続行したいので、例外は投げず空配列を返す。
   */
  async listTaxonomyNames(): Promise<{
    categories: string[];
    tags: string[];
  }> {
    const pick = async (
      load: () => Promise<{ name?: string }[]>,
      label: string,
    ): Promise<string[]> => {
      try {
        const rows = await load();
        return rows
          .map((r) => (r.name ?? '').trim())
          .filter((n) => n.length > 0);
      } catch (err) {
        this.logger.warn(
          `[${this.site.slug}] failed to load ${label}: ${(err as Error).message}`,
        );
        return [];
      }
    };

    const [categories, tags] = await Promise.all([
      pick(
        () => this.listCategories() as Promise<{ name?: string }[]>,
        'categories',
      ),
      pick(() => this.listTags() as Promise<{ name?: string }[]>, 'tags'),
    ]);
    return { categories, tags };
  }

  async uploadMedia(
    imageBuffer: Buffer,
    filename: string,
    mimeType: string = 'image/png',
  ) {
    const { data } = await this.client.post('/media', imageBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
    this.logger.log(
      `[${this.site.slug}] media uploaded: id=${data.id}, url="${data.source_url}"`,
    );
    return data;
  }
}

@Injectable()
export class WordpressService {
  constructor(private readonly sitesService: SitesService) {}

  /** Site を渡してクライアントを生成する。 */
  forSite(site: Site): WordpressClient {
    const password = this.sitesService.decryptWpAppPassword(site);
    return new WordpressClient(site, password);
  }

  async forSlug(slug: string): Promise<WordpressClient> {
    const site = await this.sitesService.findBySlug(slug);
    return this.forSite(site);
  }
}
