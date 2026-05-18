import { Body, Controller, Param, Post } from '@nestjs/common';
import { BlogGeneratorService } from './blog-generator.service';
import { GenerateBlogDto } from './blog-generator.dto';

@Controller('blog-generator')
export class BlogGeneratorController {
  constructor(private readonly blogGeneratorService: BlogGeneratorService) {}

  /** サイト指定でブログ生成 + 下書き作成。 */
  @Post(':slug/generate')
  generate(@Param('slug') slug: string, @Body() dto: GenerateBlogDto) {
    return this.blogGeneratorService.generateForSlug(slug, dto);
  }
}
