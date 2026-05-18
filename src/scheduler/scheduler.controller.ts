import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { SchedulerService } from './scheduler.service';
import { PatchScheduleDto, UpsertScheduleDto } from './scheduler.dto';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('schedules')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get()
  list(
    @Query('siteSlug') siteSlug?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.schedulerService.list({ siteSlug, from, to });
  }

  @Post()
  upsert(@Body() dto: UpsertScheduleDto) {
    return this.schedulerService.upsert(dto);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchScheduleDto,
  ) {
    return this.schedulerService.patch(id, dto);
  }

  // ── Cloud Scheduler から呼ばれるエンドポイント（OIDC は middleware/Guard で別途） ──

  @Post('run-today')
  @HttpCode(200)
  runToday() {
    return this.schedulerService.runToday();
  }

  @Post('run/:date')
  @HttpCode(200)
  runForDate(@Param('date') date: string) {
    return this.schedulerService.runForDate(date);
  }

  // ── Excel エクスポート（互換） ──

  @Get('export.xlsx')
  async exportXlsx(
    @Res({ passthrough: true }) res: Response,
    @Query('siteSlug') siteSlug?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<StreamableFile> {
    const views = await this.schedulerService.list({ siteSlug, from, to });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('schedules');
    const headers = [
      'id',
      'date',
      'siteSlug',
      'siteName',
      'status',
      'source',
      'keyword1',
      'keyword2',
      'keyword3',
      'topic',
      'articleType',
      'categoryNames',
      'tagNames',
      'planId',
      'lastRunStatus',
      'lastRunAt',
      'lastRunPostId',
      'lastRunPostLink',
      'lastRunPostTitle',
      'lastRunError',
    ];
    ws.addRow(headers).font = { bold: true };
    for (const v of views) {
      ws.addRow([
        v.id,
        v.date,
        v.siteSlug,
        v.siteName,
        v.status,
        v.source,
        v.keywords[0],
        v.keywords[1],
        v.keywords[2],
        v.topic ?? '',
        v.articleType ?? '',
        (v.categoryNames ?? []).join('|'),
        (v.tagNames ?? []).join('|'),
        v.planId ?? '',
        v.lastRun?.status ?? '',
        v.lastRun?.ranAt ?? '',
        v.lastRun?.postId ?? '',
        v.lastRun?.postLink ?? '',
        v.lastRun?.postTitle ?? '',
        v.lastRun?.error ?? '',
      ]);
    }
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="schedules.xlsx"`,
    );
    return new StreamableFile(buf);
  }
}
