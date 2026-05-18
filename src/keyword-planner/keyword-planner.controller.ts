import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovePlanDto } from './keyword-planner.dto';
import { KeywordPlannerService } from './keyword-planner.service';

@Controller('keywords')
export class KeywordPlannerController {
  constructor(private readonly service: KeywordPlannerService) {}

  /** Cloud Scheduler から叩く。全 active サイトの新プランを draft で作成。 */
  @Post('plan-next-cycle')
  @HttpCode(200)
  planNextCycle() {
    return this.service.planNextCycle();
  }

  /** 1サイトだけ再生成。 */
  @Post('plan/:siteSlug')
  @HttpCode(200)
  planForSlug(@Param('siteSlug') slug: string) {
    return this.service.planForSlug(slug);
  }

  @Get('plans')
  listPlans(
    @Query('siteSlug') siteSlug?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listPlans({ siteSlug, status });
  }

  @Post('plans/:id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApprovePlanDto = {},
  ) {
    return this.service.approvePlan(id, body.approvedBy);
  }

  @Post('plans/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.service.rejectPlan(id);
  }
}
