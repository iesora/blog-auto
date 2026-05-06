import { Module } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { SchedulerStorageService } from './scheduler-storage.service';
import { OidcAuthGuard } from './oidc-auth.guard';
import { BlogGeneratorModule } from '../blog-generator/blog-generator.module';

@Module({
  imports: [BlogGeneratorModule],
  controllers: [SchedulerController],
  providers: [SchedulerService, SchedulerStorageService, OidcAuthGuard],
})
export class SchedulerModule {}
