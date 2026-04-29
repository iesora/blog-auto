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

@Controller('wordpress')
export class WordpressController {
  constructor(private readonly wordpressService: WordpressService) {}

  @Post('posts')
  createPost(@Body() dto: CreatePostDto) {
    return this.wordpressService.createPost(dto);
  }

  @Put('posts/:id')
  updatePost(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostDto,
  ) {
    return this.wordpressService.updatePost(id, dto);
  }

  @Delete('posts/:id')
  deletePost(@Param('id', ParseIntPipe) id: number) {
    return this.wordpressService.deletePost(id);
  }

  @Get('posts/:id')
  getPost(@Param('id', ParseIntPipe) id: number) {
    return this.wordpressService.getPost(id);
  }

  @Get('posts')
  listPosts(
    @Query('page') page?: number,
    @Query('per_page') perPage?: number,
    @Query('status') status?: string,
  ) {
    return this.wordpressService.listPosts({
      page,
      per_page: perPage,
      status,
    });
  }

  @Get('categories')
  listCategories() {
    return this.wordpressService.listCategories();
  }

  @Get('tags')
  listTags() {
    return this.wordpressService.listTags();
  }
}
