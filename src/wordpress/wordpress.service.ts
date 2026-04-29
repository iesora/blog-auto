import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CreatePostDto, UpdatePostDto } from './wordpress.dto';

@Injectable()
export class WordpressService {
  private readonly logger = new Logger(WordpressService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.get<string>('WORDPRESS_URL');
    const username = this.configService.get<string>('WORDPRESS_USERNAME');
    const appPassword = this.configService.get<string>(
      'WORDPRESS_APP_PASSWORD',
    );

    const token = Buffer.from(`${username}:${appPassword}`).toString('base64');

    this.client = axios.create({
      baseURL: `${baseURL}/wp-json/wp/v2`,
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

    this.logger.log(`Post created: id=${data.id}, title="${data.title.rendered}"`);
    return data;
  }

  async updatePost(id: number, dto: UpdatePostDto) {
    const { data } = await this.client.put(`/posts/${id}`, dto);

    this.logger.log(`Post updated: id=${data.id}`);
    return data;
  }

  async deletePost(id: number) {
    const { data } = await this.client.delete(`/posts/${id}`);

    this.logger.log(`Post deleted: id=${id}`);
    return data;
  }

  async getPost(id: number) {
    const { data } = await this.client.get(`/posts/${id}`);
    return data;
  }

  async listPosts(params?: { page?: number; per_page?: number; status?: string }) {
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

    this.logger.log(`Media uploaded: id=${data.id}, url="${data.source_url}"`);
    return data;
  }
}
