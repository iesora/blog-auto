import { Module } from '@nestjs/common';
import { SitesModule } from '../sites/sites.module';
import { WordpressModule } from '../wordpress/wordpress.module';
import { BlogGeneratorController } from './blog-generator.controller';
import { BlogGeneratorService } from './blog-generator.service';
import { ImageGeneratorService } from './image-generator.service';

@Module({
  imports: [SitesModule, WordpressModule],
  controllers: [BlogGeneratorController],
  providers: [BlogGeneratorService, ImageGeneratorService],
  exports: [BlogGeneratorService],
})
export class BlogGeneratorModule {}
