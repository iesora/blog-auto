import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { MarketingPlannerService } from './marketing-planner.service';

@Controller()
export class MarketingPlannerController {
  constructor(private readonly service: MarketingPlannerService) {}

  /** データ分析画面から手動で叩く。GSC スナップショットを根拠にマーケティング戦略を立案し DB 保存。 */
  @Post('gsc/snapshots/:id/marketing-plan')
  @HttpCode(200)
  planFromSnapshot(@Param('id', ParseIntPipe) id: number) {
    return this.service.planFromSnapshot(id);
  }

  /** 立案済みの戦略を取得（未立案なら 404）。リロード後に確認なしで表示するために使う。 */
  @Get('gsc/snapshots/:id/marketing-plan')
  async getSavedPlan(@Param('id', ParseIntPipe) id: number) {
    const plan = await this.service.getSavedPlan(id);
    if (!plan) {
      throw new NotFoundException(
        `marketing plan for snapshot ${id} not found`,
      );
    }
    return plan;
  }
}
