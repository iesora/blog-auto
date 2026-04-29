import { Body, Controller, Post } from '@nestjs/common';
import { BlogGeneratorService } from './blog-generator.service';
import { GenerateBlogDto } from './blog-generator.dto';

@Controller('blog-generator')
export class BlogGeneratorController {
  constructor(private readonly blogGeneratorService: BlogGeneratorService) {}

  @Post('generate')
  generate(@Body() dto: GenerateBlogDto) {
    return this.blogGeneratorService.generateAndCreateDraft(dto);
  }
}
