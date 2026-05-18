import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlogGeneratorModule } from '../blog-generator/blog-generator.module';
import { SitesModule } from '../sites/sites.module';
import { RunHistory, ScheduleEntry, Site } from '../entities';
import { OidcAuthGuard } from './oidc-auth.guard';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { SchedulerStorageService } from './scheduler-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduleEntry, RunHistory, Site]),
    BlogGeneratorModule,
    SitesModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService, SchedulerStorageService, OidcAuthGuard],
  exports: [SchedulerStorageService],
})
export class SchedulerModule {}
