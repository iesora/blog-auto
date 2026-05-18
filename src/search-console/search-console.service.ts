import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosError, AxiosInstance, isAxiosError } from 'axios';
import * as ExcelJS from 'exceljs';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { DataSource, Repository } from 'typeorm';
import { GscQueryRow, GscSnapshot, Site } from '../entities';

export interface SearchAnalyticsQueryParams {
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
  dataState?: 'final' | 'all';
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowCount: number;
  rows: SearchAnalyticsRow[];
  responseAggregationType?: string;
}

@Injectable()
export class SearchConsoleService {
  private readonly logger = new Logger(SearchConsoleService.name);
  private readonly auth?: GoogleAuth;
  private readonly oauth?: OAuth2Client;
  private readonly defaultSiteUrl: string;
  private readonly http: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(GscSnapshot)
    private readonly snapshotRepo: Repository<GscSnapshot>,
    @InjectRepository(GscQueryRow)
    private readonly rowRepo: Repository<GscQueryRow>,
  ) {
    this.defaultSiteUrl =
      this.configService.get<string>('GSC_SITE_URL') ?? 'https://gakkiou.com/';

    const clientId = this.configService.get<string>('GSC_OAUTH_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'GSC_OAUTH_CLIENT_SECRET',
    );
    const refreshToken = this.configService.get<string>(
      'GSC_OAUTH_REFRESH_TOKEN',
    );

    if (clientId && clientSecret && refreshToken) {
      const oauth = new OAuth2Client(clientId, clientSecret);
      oauth.setCredentials({ refresh_token: refreshToken });
      this.oauth = oauth;
      this.logger.log('GSC auth mode: OAuth user credentials');
    } else {
      const keyFile = this.configService.get<string>('GSC_KEY_FILE');
      this.auth = new GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      });
      this.logger.log(
        `GSC auth mode: Service Account${keyFile ? ` (keyFile=${keyFile})` : ' (ADC)'}`,
      );
    }

    this.http = axios.create({
      baseURL: 'https://searchconsole.googleapis.com/webmasters/v3',
    });
  }

  private rethrow(err: unknown): never {
    if (isAxiosError(err)) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      const status = ax.response?.status ?? 500;
      const message =
        ax.response?.data?.error?.message ?? ax.message ?? 'GSC request failed';
      this.logger.warn(`GSC API error (${status}): ${message}`);
      throw new HttpException({ statusCode: status, message }, status);
    }
    throw err as Error;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    let token: string | null | undefined;
    if (this.oauth) {
      token = (await this.oauth.getAccessToken()).token;
    } else if (this.auth) {
      const client = await this.auth.getClient();
      token = (await client.getAccessToken()).token;
    }
    if (!token) {
      throw new Error('Failed to obtain Google access token');
    }
    return { Authorization: `Bearer ${token}` };
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  async listSites() {
    try {
      const { data } = await this.http.get('/sites', {
        headers: await this.authHeaders(),
      });
      return data;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async searchAnalyticsQuery(
    params: SearchAnalyticsQueryParams = {},
    siteUrl?: string,
  ): Promise<SearchAnalyticsResult> {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 28);

    const startDate = params.startDate ?? this.formatDate(start);
    const endDate = params.endDate ?? this.formatDate(today);
    const dimensions = params.dimensions ?? ['query'];
    const rowLimit = params.rowLimit ?? 1000;
    const startRow = params.startRow ?? 0;

    const body = {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      ...(params.searchType && { searchType: params.searchType }),
      ...(params.dataState && { dataState: params.dataState }),
    };

    const target = siteUrl ?? this.defaultSiteUrl;
    const encodedSite = encodeURIComponent(target);

    this.logger.log(
      `GSC searchAnalytics.query site=${target} ${startDate}..${endDate} dims=[${dimensions.join(',')}] rowLimit=${rowLimit} startRow=${startRow}`,
    );

    try {
      const { data } = await this.http.post(
        `/sites/${encodedSite}/searchAnalytics/query`,
        body,
        { headers: await this.authHeaders() },
      );

      const rows: SearchAnalyticsRow[] = data.rows ?? [];
      return {
        siteUrl: target,
        startDate,
        endDate,
        dimensions,
        rowCount: rows.length,
        rows,
        responseAggregationType: data.responseAggregationType,
      };
    } catch (err) {
      this.rethrow(err);
    }
  }

  /**
   * 直近28日のクエリ × ページ次元データを GSC から取得し DB に保存。
   * 戻り値は作成された snapshot レコード。
   */
  async fetchAndStore(site: Site): Promise<GscSnapshot> {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 28);
    const startDate = this.formatDate(start);
    const endDate = this.formatDate(today);

    const result = await this.searchAnalyticsQuery(
      {
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: 5000,
        dataState: 'final',
      },
      site.gscSiteUrl,
    );

    return this.dataSource.transaction(async (em) => {
      const snapshot = em.create(GscSnapshot, {
        siteId: site.id,
        startDate,
        endDate,
        rowCount: result.rowCount,
        takenAt: new Date(),
        dataState: 'final',
      });
      const saved = await em.save(snapshot);

      if (result.rows.length > 0) {
        const chunks: GscQueryRow[][] = [];
        const batchSize = 500;
        const all = result.rows.map((r) =>
          em.create(GscQueryRow, {
            snapshotId: saved.id,
            query: (r.keys?.[0] ?? '').slice(0, 255),
            page: r.keys?.[1]?.slice(0, 512),
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          }),
        );
        for (let i = 0; i < all.length; i += batchSize) {
          chunks.push(all.slice(i, i + batchSize));
        }
        for (const c of chunks) await em.save(c);
      }

      this.logger.log(
        `[${site.slug}] GSC snapshot saved id=${saved.id}, rows=${result.rowCount}`,
      );
      return saved;
    });
  }

  async listSnapshotsForSite(siteId: number): Promise<GscSnapshot[]> {
    return this.snapshotRepo.find({
      where: { siteId },
      order: { takenAt: 'DESC' },
      take: 50,
    });
  }

  async findSnapshot(id: number): Promise<GscSnapshot | null> {
    return this.snapshotRepo.findOne({
      where: { id },
      relations: { site: true },
    });
  }

  async loadSnapshotRows(snapshotId: number): Promise<GscQueryRow[]> {
    return this.rowRepo.find({
      where: { snapshotId },
      order: { impressions: 'DESC' },
    });
  }

  // ── Excel / CSV エクスポート（既存と同等） ──

  async toXlsx(result: SearchAnalyticsResult): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('analytics');

    const metaRows: [string, string | number][] = [
      ['siteUrl', result.siteUrl],
      ['startDate', result.startDate],
      ['endDate', result.endDate],
      ['dimensions', result.dimensions.join(',')],
      ['rowCount', result.rowCount],
    ];
    for (const [k, v] of metaRows) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true };
    }
    ws.addRow([]);

    const headers = [
      ...result.dimensions,
      'clicks',
      'impressions',
      'ctr',
      'position',
    ];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((c) => {
      c.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' },
      };
    });

    for (const row of result.rows) {
      ws.addRow([
        ...(row.keys ?? []),
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
      ]);
    }

    const metricStart = result.dimensions.length + 1;
    ws.getColumn(metricStart + 2).numFmt = '0.00%';
    ws.getColumn(metricStart + 3).numFmt = '0.00';

    ws.columns.forEach((col) => {
      let max = 8;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 60);
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  toCsv(result: SearchAnalyticsResult): string {
    const headers = [
      ...result.dimensions,
      'clicks',
      'impressions',
      'ctr',
      'position',
    ];
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [headers.map(escape).join(',')];
    for (const row of result.rows) {
      lines.push(
        [
          ...(row.keys ?? []),
          row.clicks,
          row.impressions,
          row.ctr,
          row.position,
        ]
          .map(escape)
          .join(','),
      );
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async snapshotToXlsx(snapshot: GscSnapshot): Promise<Buffer> {
    const rows = await this.loadSnapshotRows(snapshot.id);
    const result: SearchAnalyticsResult = {
      siteUrl: snapshot.site?.gscSiteUrl ?? '',
      startDate: snapshot.startDate,
      endDate: snapshot.endDate,
      dimensions: ['query', 'page'],
      rowCount: rows.length,
      rows: rows.map((r) => ({
        keys: [r.query, r.page ?? ''],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      })),
    };
    return this.toXlsx(result);
  }

  buildExportFilename(result: SearchAnalyticsResult, ext: 'xlsx' | 'csv'): string {
    const host = result.siteUrl
      .replace(/^sc-domain:/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .replace(/[^A-Za-z0-9._-]/g, '_');
    const dimTag = result.dimensions.join('-') || 'data';
    return `gsc_${dimTag}_${host}_${result.startDate}_${result.endDate}.${ext}`;
  }
}
