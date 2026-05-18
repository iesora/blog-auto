import { Module } from '@nestjs/common';
import { SitesModule } from '../sites/sites.module';
import { WordpressController } from './wordpress.controller';
import { WordpressService } from './wordpress.service';

@Module({
  imports: [SitesModule],
  controllers: [WordpressController],
  providers: [WordpressService],
  exports: [WordpressService],
})
export class WordpressModule {}
