import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { UpsertScheduleDto } from './scheduler.dto';
import { OidcAuthGuard } from './oidc-auth.guard';

@Controller('schedules')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post()
  upsert(@Body() dto: UpsertScheduleDto) {
    return this.schedulerService.upsert(dto);
  }

  @Get()
  list() {
    return this.schedulerService.list();
  }

  @Get(':date')
  async get(@Param('date') date: string) {
    const entry = await this.schedulerService.findByDate(date);
    if (!entry) throw new NotFoundException(`No schedule for ${date}`);
    return entry;
  }

  @Delete(':date')
  @HttpCode(204)
  async remove(@Param('date') date: string) {
    await this.schedulerService.remove(date);
  }

  // ── Cloud Scheduler から呼ばれるエンドポイント（OIDC 必須） ──

  // @UseGuards(OidcAuthGuard)
  @Post('run-today')
  runToday() {
    return this.schedulerService.runToday();
  }

  @UseGuards(OidcAuthGuard)
  @Post('run/:date')
  runForDate(@Param('date') date: string) {
    return this.schedulerService.runForDate(date);
  }
}
