import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import * as ExcelJS from 'exceljs';
import { ArticleType } from '../blog-generator/blog-generator.dto';
import { RunHistory, ScheduleEntry } from './scheduler.dto';

const SHEET_NAME = 'schedules';

const HEADERS = [
  'date',
  'keyword1',
  'keyword2',
  'keyword3',
  'topic',
  'articleType',
  'lastRunStatus',
  'lastRunAt',
  'lastRunPostId',
  'lastRunPostLink',
  'lastRunPostTitle',
  'lastRunError',
] as const;

type Header = (typeof HEADERS)[number];

@Injectable()
export class SchedulerStorageService {
  private readonly logger = new Logger(SchedulerStorageService.name);
  private storage?: Storage;
  private bucketName?: string;
  private objectKey?: string;

  constructor(private readonly configService: ConfigService) {}

  // GCS バケット名を取得時に解決する（未設定なら例外を投げる）
  private file() {
    if (!this.storage) {
      const bucket = this.configService.get<string>('GCS_BUCKET');
      if (!bucket) {
        throw new InternalServerErrorException(
          'GCS_BUCKET environment variable is required',
        );
      }
      this.bucketName = bucket;
      this.objectKey =
        this.configService.get<string>('GCS_SCHEDULE_KEY') ?? 'schedules.xlsx';
      this.storage = new Storage();
    }
    return this.storage.bucket(this.bucketName!).file(this.objectKey!);
  }

  // ── Public API ──

  async list(): Promise<ScheduleEntry[]> {
    const wb = await this.loadWorkbook();
    return this.readEntries(wb);
  }

  async findByDate(date: string): Promise<ScheduleEntry | null> {
    const entries = await this.list();
    return entries.find((e) => e.date === date) ?? null;
  }

  async upsert(entry: ScheduleEntry): Promise<ScheduleEntry> {
    const wb = await this.loadWorkbook();
    const entries = this.readEntries(wb);
    const idx = entries.findIndex((e) => e.date === entry.date);
    if (idx >= 0) {
      entry.lastRun = entries[idx].lastRun; // 履歴は引き継ぐ
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    this.writeEntries(wb, entries);
    await this.saveWorkbook(wb);
    return entry;
  }

  async remove(date: string): Promise<boolean> {
    const wb = await this.loadWorkbook();
    const entries = this.readEntries(wb);
    const next = entries.filter((e) => e.date !== date);
    if (next.length === entries.length) return false;
    this.writeEntries(wb, next);
    await this.saveWorkbook(wb);
    return true;
  }

  async updateLastRun(date: string, lastRun: RunHistory): Promise<void> {
    const wb = await this.loadWorkbook();
    const entries = this.readEntries(wb);
    const idx = entries.findIndex((e) => e.date === date);
    if (idx < 0) return;
    entries[idx] = { ...entries[idx], lastRun };
    this.writeEntries(wb, entries);
    await this.saveWorkbook(wb);
  }

  // ── GCS I/O ──

  private async loadWorkbook(): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    const file = this.file();
    const [exists] = await file.exists();
    if (!exists) {
      this.initSheet(wb);
      return wb;
    }
    const [buf] = await file.download();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    if (!wb.getWorksheet(SHEET_NAME)) {
      this.initSheet(wb);
    }
    return wb;
  }

  private async saveWorkbook(wb: ExcelJS.Workbook): Promise<void> {
    const buf = await wb.xlsx.writeBuffer();
    await this.file().save(Buffer.from(buf as ArrayBuffer), {
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      resumable: false,
    });
    this.logger.log(
      `Saved schedules to gs://${this.bucketName}/${this.objectKey}`,
    );
  }

  // ── Sheet read/write ──

  private initSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
    const ws = wb.addWorksheet(SHEET_NAME);
    ws.addRow([...HEADERS]);
    ws.getRow(1).font = { bold: true };
    return ws;
  }

  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && 'text' in value) {
      const t = (value as { text: unknown }).text;
      return typeof t === 'string' ? t : '';
    }
    if (typeof value === 'object' && 'result' in value) {
      const r = (value as { result?: unknown }).result;
      return typeof r === 'string' || typeof r === 'number' ? String(r) : '';
    }
    return '';
  }

  private headerIndex(ws: ExcelJS.Worksheet): Record<Header, number> {
    const headerRow = ws.getRow(1);
    const map = {} as Record<Header, number>;
    HEADERS.forEach((h) => {
      map[h] = -1;
    });
    headerRow.eachCell((cell, col) => {
      const v = this.cellToString(cell.value).trim();
      if ((HEADERS as readonly string[]).includes(v)) {
        map[v as Header] = col;
      }
    });
    return map;
  }

  private cellString(row: ExcelJS.Row, col: number): string | undefined {
    if (col < 0) return undefined;
    const s = this.cellToString(row.getCell(col).value).trim();
    return s.length > 0 ? s : undefined;
  }

  private cellNumber(row: ExcelJS.Row, col: number): number | undefined {
    const s = this.cellString(row, col);
    if (s === undefined) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }

  private readEntries(wb: ExcelJS.Workbook): ScheduleEntry[] {
    const ws = wb.getWorksheet(SHEET_NAME) ?? this.initSheet(wb);
    const cols = this.headerIndex(ws);
    const entries: ScheduleEntry[] = [];

    ws.eachRow({ includeEmpty: false }, (row, rowIndex) => {
      if (rowIndex === 1) return; // header
      const date = this.cellString(row, cols.date);
      const k1 = this.cellString(row, cols.keyword1);
      const k2 = this.cellString(row, cols.keyword2);
      const k3 = this.cellString(row, cols.keyword3);
      if (!date || !k1 || !k2 || !k3) return;

      const articleTypeStr = this.cellString(row, cols.articleType);
      const articleType =
        articleTypeStr &&
        Object.values(ArticleType).includes(articleTypeStr as ArticleType)
          ? (articleTypeStr as ArticleType)
          : undefined;

      const lastRunStatus = this.cellString(row, cols.lastRunStatus);
      const lastRun: RunHistory | undefined =
        lastRunStatus === 'success' || lastRunStatus === 'failed'
          ? {
              status: lastRunStatus,
              ranAt: this.cellString(row, cols.lastRunAt) ?? '',
              postId: this.cellNumber(row, cols.lastRunPostId),
              postLink: this.cellString(row, cols.lastRunPostLink),
              postTitle: this.cellString(row, cols.lastRunPostTitle),
              error: this.cellString(row, cols.lastRunError),
            }
          : undefined;

      entries.push({
        date,
        keywords: [k1, k2, k3],
        topic: this.cellString(row, cols.topic),
        articleType,
        lastRun,
      });
    });

    return entries;
  }

  private writeEntries(wb: ExcelJS.Workbook, entries: ScheduleEntry[]) {
    // 既存シートを削除して作り直す（行削除より単純で確実）
    const existing = wb.getWorksheet(SHEET_NAME);
    if (existing) wb.removeWorksheet(existing.id);
    const ws = this.initSheet(wb);
    for (const e of entries) {
      ws.addRow([
        e.date,
        e.keywords[0],
        e.keywords[1],
        e.keywords[2],
        e.topic ?? '',
        e.articleType ?? '',
        e.lastRun?.status ?? '',
        e.lastRun?.ranAt ?? '',
        e.lastRun?.postId ?? '',
        e.lastRun?.postLink ?? '',
        e.lastRun?.postTitle ?? '',
        e.lastRun?.error ?? '',
      ]);
    }
  }
}
