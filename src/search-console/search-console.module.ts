import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GscQueryRow, GscSnapshot } from '../entities';
import { OidcAuthGuard } from '../scheduler/oidc-auth.guard';
import { SitesModule } from '../sites/sites.module';
import { SearchConsoleController } from './search-console.controller';
import { SearchConsoleService } from './search-console.service';

@Module({
  imports: [TypeOrmModule.forFeature([GscSnapshot, GscQueryRow]), SitesModule],
  controllers: [SearchConsoleController],
  providers: [SearchConsoleService, OidcAuthGuard],
  exports: [SearchConsoleService],
})
export class SearchConsoleModule {}
