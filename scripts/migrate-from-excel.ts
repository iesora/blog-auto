/**
 * GCS 上の旧 schedules.xlsx を読み、指定 site (slug) に紐づけて
 * schedule_entries / run_history に流し込む。
 *
 * 既存 Excel データは「manual / approved」として取り込む（status を上書き可能）。
 *
 * 使い方:
 *   $ npx ts-node scripts/migrate-from-excel.ts --site gakkiou --dry-run
 *   $ npx ts-node scripts/migrate-from-excel.ts --site gakkiou --commit
 *
 * 必要な env: GCS_BUCKET, GCS_SCHEDULE_KEY, DB_*, NODE_ENV
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { Storage } from '@google-cloud/storage';
import * as ExcelJS from 'exceljs';
import { ArticleType } from '../src/blog-generator/blog-generator.dto';
import {
  RunHistory,
  ScheduleEntry,
  Site,
} from '../src/entities';
import { AppDataSource } from '../src/utils/data-source';

const SHEET_NAME = 'schedules';

interface ExcelRow {
  date: string;
  keyword1: string;
  keyword2: string;
  keyword3: string;
  topic?: string;
  articleType?: ArticleType;
  lastRunStatus?: 'success' | 'failed';
  lastRunAt?: string;
  lastRunPostId?: number;
  lastRunPostLink?: string;
  lastRunPostTitle?: string;
  lastRunError?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let site: string | undefined;
  let dryRun = false;
  let commit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--site') site = args[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--commit') commit = true;
  }
  if (!site) {
    console.error('--site <slug> is required');
    process.exit(1);
  }
  if (!dryRun && !commit) {
    console.error('one of --dry-run or --commit is required');
    process.exit(1);
  }
  return { site, dryRun, commit };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
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

async function downloadXlsx(): Promise<ExcelJS.Workbook> {
  const bucketName = process.env.GCS_BUCKET;
  const objectKey = process.env.GCS_SCHEDULE_KEY ?? 'schedules.xlsx';
  if (!bucketName) throw new Error('GCS_BUCKET is required');
  const storage = new Storage();
  const file = storage.bucket(bucketName).file(objectKey);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`gs://${bucketName}/${objectKey} not found`);
  const [buf] = await file.download();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

function readRows(wb: ExcelJS.Workbook): ExcelRow[] {
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`sheet '${SHEET_NAME}' not found`);

  const headerRow = ws.getRow(1);
  const headerToCol = new Map<string, number>();
  headerRow.eachCell((cell, col) => {
    const h = cellToString(cell.value).trim();
    if (h) headerToCol.set(h, col);
  });

  const get = (row: ExcelJS.Row, header: string): string | undefined => {
    const col = headerToCol.get(header);
    if (col === undefined) return undefined;
    const v = cellToString(row.getCell(col).value).trim();
    return v.length > 0 ? v : undefined;
  };

  const rows: ExcelRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowIndex) => {
    if (rowIndex === 1) return;
    const date = get(row, 'date');
    const k1 = get(row, 'keyword1');
    const k2 = get(row, 'keyword2');
    const k3 = get(row, 'keyword3');
    if (!date || !k1 || !k2 || !k3) return;

    const articleTypeStr = get(row, 'articleType');
    const articleType =
      articleTypeStr &&
      Object.values(ArticleType).includes(articleTypeStr as ArticleType)
        ? (articleTypeStr as ArticleType)
        : undefined;

    const status = get(row, 'lastRunStatus');
    rows.push({
      date,
      keyword1: k1,
      keyword2: k2,
      keyword3: k3,
      topic: get(row, 'topic'),
      articleType,
      lastRunStatus:
        status === 'success' || status === 'failed' ? status : undefined,
      lastRunAt: get(row, 'lastRunAt'),
      lastRunPostId: get(row, 'lastRunPostId')
        ? Number(get(row, 'lastRunPostId'))
        : undefined,
      lastRunPostLink: get(row, 'lastRunPostLink'),
      lastRunPostTitle: get(row, 'lastRunPostTitle'),
      lastRunError: get(row, 'lastRunError'),
    });
  });

  return rows;
}

async function main() {
  const { site: slug, dryRun, commit } = parseArgs();
  console.log(`migrate-from-excel: site=${slug}, mode=${commit ? 'commit' : 'dry-run'}`);

  const wb = await downloadXlsx();
  const rows = readRows(wb);
  console.log(`Excel rows parsed: ${rows.length}`);

  if (dryRun && !commit) {
    for (const r of rows.slice(0, 5)) {
      console.log(' sample:', r);
    }
    console.log('--- dry-run, no DB writes ---');
    return;
  }

  await AppDataSource.initialize();
  try {
    const siteRepo = AppDataSource.getRepository(Site);
    const scheduleRepo = AppDataSource.getRepository(ScheduleEntry);
    const runRepo = AppDataSource.getRepository(RunHistory);

    const site = await siteRepo.findOne({ where: { slug } });
    if (!site) throw new Error(`site '${slug}' not found in DB. seeds/sites.ts を先に流してください`);

    let inserted = 0;
    let updated = 0;
    let runHistoryInserted = 0;
    for (const r of rows) {
      const existing = await scheduleRepo.findOne({
        where: { siteId: site.id, scheduledDate: r.date },
      });
      let entry: ScheduleEntry;
      if (existing) {
        existing.keyword1 = r.keyword1;
        existing.keyword2 = r.keyword2;
        existing.keyword3 = r.keyword3;
        existing.topic = r.topic;
        existing.articleType = r.articleType;
        existing.status = 'approved';
        existing.source = 'manual';
        entry = await scheduleRepo.save(existing);
        updated++;
      } else {
        entry = await scheduleRepo.save(
          scheduleRepo.create({
            siteId: site.id,
            scheduledDate: r.date,
            keyword1: r.keyword1,
            keyword2: r.keyword2,
            keyword3: r.keyword3,
            topic: r.topic,
            articleType: r.articleType,
            status: 'approved',
            source: 'manual',
          }),
        );
        inserted++;
      }

      if (r.lastRunStatus) {
        const ranAt = r.lastRunAt ? new Date(r.lastRunAt) : new Date();
        await runRepo.save(
          runRepo.create({
            scheduleEntryId: entry.id,
            status: r.lastRunStatus,
            ranAt,
            wpPostId: r.lastRunPostId,
            wpPostLink: r.lastRunPostLink,
            wpPostTitle: r.lastRunPostTitle,
            error: r.lastRunError,
          }),
        );
        runHistoryInserted++;
      }
    }
    console.log(
      `done: inserted=${inserted}, updated=${updated}, runHistoryInserted=${runHistoryInserted}`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
