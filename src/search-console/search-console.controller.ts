import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { SitesService } from '../sites/sites.service';
import {
  SearchAnalyticsQueryParams,
  SearchConsoleService,
} from './search-console.service';

type RawQuery = {
  startDate?: string;
  endDate?: string;
  dimensions?: string;
  rowLimit?: string;
  startRow?: string;
  searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
  dataState?: 'final' | 'all';
};

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller()
export class SearchConsoleController {
  constructor(
    private readonly service: SearchConsoleService,
    private readonly sitesService: SitesService,
  ) {}

  // ── 既存：ad hoc query 系 ──

  @Get('search-console/sites')
  listSites() {
    return this.service.listSites();
  }

  @Get('search-console/analytics')
  analytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dimensions') dimensions?: string,
    @Query('rowLimit') rowLimit?: string,
    @Query('startRow') startRow?: string,
    @Query('searchType')
    searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews',
    @Query('dataState') dataState?: 'final' | 'all',
    @Query('siteUrl') siteUrl?: string,
  ) {
    return this.service.searchAnalyticsQuery(
      this.parseParams({
        startDate,
        endDate,
        dimensions,
        rowLimit,
        startRow,
        searchType,
        dataState,
      }),
      siteUrl,
    );
  }

  @Get('search-console/analytics.xlsx')
  analyticsXlsx(
    @Res({ passthrough: true }) res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dimensions') dimensions?: string,
    @Query('rowLimit') rowLimit?: string,
    @Query('startRow') startRow?: string,
    @Query('searchType')
    searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews',
    @Query('dataState') dataState?: 'final' | 'all',
    @Query('siteUrl') siteUrl?: string,
  ): Promise<StreamableFile> {
    return this.streamXlsx(
      res,
      ['query'],
      { startDate, endDate, dimensions, rowLimit, startRow, searchType, dataState },
      siteUrl,
    );
  }

  @Get('search-console/analytics.csv')
  analyticsCsv(
    @Res({ passthrough: true }) res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dimensions') dimensions?: string,
    @Query('rowLimit') rowLimit?: string,
    @Query('startRow') startRow?: string,
    @Query('searchType')
    searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews',
    @Query('dataState') dataState?: 'final' | 'all',
    @Query('siteUrl') siteUrl?: string,
  ): Promise<string> {
    return this.streamCsv(
      res,
      ['query'],
      { startDate, endDate, dimensions, rowLimit, startRow, searchType, dataState },
      siteUrl,
    );
  }

  // ── 新規：snapshot 永続化系 ──

  @Post('gsc/snapshots/:siteSlug')
  async createSnapshot(@Param('siteSlug') slug: string) {
    const site = await this.sitesService.findBySlug(slug);
    const snapshot = await this.service.fetchAndStore(site);
    return {
      id: snapshot.id,
      siteSlug: site.slug,
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      rowCount: snapshot.rowCount,
      takenAt: snapshot.takenAt,
    };
  }

  @Get('gsc/snapshots')
  async listSnapshots(@Query('siteSlug') slug: string) {
    if (!slug) return [];
    const site = await this.sitesService.findBySlug(slug);
    const snapshots = await this.service.listSnapshotsForSite(site.id);
    return snapshots.map((s) => ({
      id: s.id,
      startDate: s.startDate,
      endDate: s.endDate,
      rowCount: s.rowCount,
      takenAt: s.takenAt,
    }));
  }

  @Get('gsc/snapshots/:id/export.xlsx')
  async exportSnapshot(
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const snapshot = await this.service.findSnapshot(id);
    if (!snapshot) throw new NotFoundException(`snapshot ${id} not found`);
    const buf = await this.service.snapshotToXlsx(snapshot);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gsc_snapshot_${id}.xlsx"`,
    );
    return new StreamableFile(buf);
  }

  // ── 既存ヘルパ ──

  private async streamXlsx(
    res: Response,
    defaultDimensions: string[],
    raw: RawQuery,
    siteUrl?: string,
  ): Promise<StreamableFile> {
    const params = this.parseParams(raw);
    if (!params.dimensions) params.dimensions = defaultDimensions;
    const result = await this.service.searchAnalyticsQuery(params, siteUrl);
    const buf = await this.service.toXlsx(result);
    const filename = this.service.buildExportFilename(result, 'xlsx');
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buf);
  }

  private async streamCsv(
    res: Response,
    defaultDimensions: string[],
    raw: RawQuery,
    siteUrl?: string,
  ): Promise<string> {
    const params = this.parseParams(raw);
    if (!params.dimensions) params.dimensions = defaultDimensions;
    const result = await this.service.searchAnalyticsQuery(params, siteUrl);
    const csv = this.service.toCsv(result);
    const filename = this.service.buildExportFilename(result, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  private parseParams(raw: RawQuery): SearchAnalyticsQueryParams {
    return {
      startDate: raw.startDate,
      endDate: raw.endDate,
      dimensions: raw.dimensions
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      rowLimit: raw.rowLimit ? Number(raw.rowLimit) : undefined,
      startRow: raw.startRow ? Number(raw.startRow) : undefined,
      searchType: raw.searchType,
      dataState: raw.dataState,
    };
  }
}
