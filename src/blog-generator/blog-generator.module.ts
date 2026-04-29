import { Module } from '@nestjs/common';
import { BlogGeneratorController } from './blog-generator.controller';
import { BlogGeneratorService } from './blog-generator.service';
import { ImageGeneratorService } from './image-generator.service';
import { WordpressModule } from '../wordpress/wordpress.module';

@Module({
  imports: [WordpressModule],
  controllers: [BlogGeneratorController],
  providers: [BlogGeneratorService, ImageGeneratorService],
})
export class BlogGeneratorModule {}
