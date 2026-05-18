import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  GscQueryRow,
  GscSnapshot,
  KeywordPlan,
  ScheduleEntry,
  Site,
} from '../entities';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SearchConsoleModule } from '../search-console/search-console.module';
import { SitesModule } from '../sites/sites.module';
import { KeywordPlannerController } from './keyword-planner.controller';
import { KeywordPlannerService } from './keyword-planner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KeywordPlan,
      GscSnapshot,
      GscQueryRow,
      ScheduleEntry,
      Site,
    ]),
    SitesModule,
    SearchConsoleModule,
    SchedulerModule,
  ],
  controllers: [KeywordPlannerController],
  providers: [KeywordPlannerService],
  exports: [KeywordPlannerService],
})
export class KeywordPlannerModule {}
