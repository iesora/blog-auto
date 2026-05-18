import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { WordpressService } from './wordpress.service';
import { CreatePostDto, UpdatePostDto } from './wordpress.dto';

/**
 * WordPress 操作 API。マルチサイト化に伴い :slug パラメータを必須にした。
 */
@Controller('wordpress/:slug')
export class WordpressController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Post('posts')
  async createPost(@Param('slug') slug: string, @Body() dto: CreatePostDto) {
    const client = await this.wordpressService.forSlug(slug);
    return client.createPost(dto);
  }

  @Put('posts/:id')
  async updatePost(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostDto,
  ) {
    const client = await this.wordpressService.forSlug(slug);
    return client.updatePost(id, dto);
  }

  @Delete('posts/:id')
  async deletePost(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const client = await this.wordpressService.forSlug(slug);
    return client.deletePost(id);
  }

  @Get('posts/:id')
  async getPost(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const client = await this.wordpressService.forSlug(slug);
    return client.getPost(id);
  }

  @Get('posts')
  async listPosts(
    @Param('slug') slug: string,
    @Query('page') page?: number,
    @Query('per_page') perPage?: number,
    @Query('status') status?: string,
  ) {
    const client = await this.wordpressService.forSlug(slug);
    return client.listPosts({ page, per_page: perPage, status });
  }

  @Get('categories')
  async listCategories(@Param('slug') slug: string) {
    const client = await this.wordpressService.forSlug(slug);
    return client.listCategories();
  }

  @Get('tags')
  async listTags(@Param('slug') slug: string) {
    const client = await this.wordpressService.forSlug(slug);
    return client.listTags();
  }
}
