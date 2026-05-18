import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GscQueryRow, GscSnapshot } from '../entities';
import { SitesModule } from '../sites/sites.module';
import { SearchConsoleController } from './search-console.controller';
import { SearchConsoleService } from './search-console.service';

@Module({
  imports: [TypeOrmModule.forFeature([GscSnapshot, GscQueryRow]), SitesModule],
  controllers: [SearchConsoleController],
  providers: [SearchConsoleService],
  exports: [SearchConsoleService],
})
export class SearchConsoleModule {}
