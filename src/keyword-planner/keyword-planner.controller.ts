import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OidcAuthGuard } from '../scheduler/oidc-auth.guard';
import { ApprovePlanDto } from './keyword-planner.dto';
import { KeywordPlannerService } from './keyword-planner.service';

@Controller('keywords')
export class KeywordPlannerController {
  constructor(private readonly service: KeywordPlannerService) {}

  /** Cloud Scheduler から叩く。全 active サイトの新プランを draft で作成。 */
  @Post('plan-next-cycle')
  @HttpCode(200)
  @UseGuards(OidcAuthGuard)
  planNextCycle() {
    return this.service.planNextCycle();
  }

  /** 1サイトだけ再生成。管理画面から叩かれる想定 (OIDC_BYPASS=true ローカル可)。 */
  @Post('plan/:siteSlug')
  @HttpCode(200)
  @UseGuards(OidcAuthGuard)
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

  @Get('plans/:id')
  getPlan(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPlanDetail(id);
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
