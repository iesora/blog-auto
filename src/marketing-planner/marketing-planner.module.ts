import { Module } from '@nestjs/common';
import { SearchConsoleModule } from '../search-console/search-console.module';
import { MarketingPlannerController } from './marketing-planner.controller';
import { MarketingPlannerService } from './marketing-planner.service';

@Module({
  imports: [SearchConsoleModule],
  controllers: [MarketingPlannerController],
  providers: [MarketingPlannerService],
})
export class MarketingPlannerModule {}
