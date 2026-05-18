import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RunHistory,
  RunStatus,
  ScheduleEntry,
  ScheduleSource,
  ScheduleStatus,
  Site,
} from '../entities';

export interface UpsertEntryData {
  siteId: number;
  scheduledDate: string;
  keyword1: string;
  keyword2: string;
  keyword3: string;
  topic?: string;
  articleType?: ScheduleEntry['articleType'];
  categoryNames?: string[];
  tagNames?: string[];
  inlineImageCount?: number;
  status?: ScheduleStatus;
  source?: ScheduleSource;
  planId?: number;
}

export interface CreateRunHistoryData {
  scheduleEntryId: number;
  status: RunStatus;
  ranAt: Date;
  wpPostId?: number;
  wpPostLink?: string;
  wpPostTitle?: string;
  error?: string;
  durationMs?: number;
}

@Injectable()
export class SchedulerStorageService {
  constructor(
    @InjectRepository(ScheduleEntry)
    private readonly scheduleRepo: Repository<ScheduleEntry>,
    @InjectRepository(RunHistory)
    private readonly runRepo: Repository<RunHistory>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  async listSchedules(opts: {
    siteSlug?: string;
    from?: string;
    to?: string;
  }): Promise<ScheduleEntry[]> {
    const qb = this.scheduleRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.site', 'site')
      .orderBy('s.scheduledDate', 'ASC')
      .addOrderBy('site.id', 'ASC');
    if (opts.siteSlug) qb.andWhere('site.slug = :slug', { slug: opts.siteSlug });
    if (opts.from) qb.andWhere('s.scheduledDate >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('s.scheduledDate <= :to', { to: opts.to });
    return qb.getMany();
  }

  async findById(id: number): Promise<ScheduleEntry | null> {
    return this.scheduleRepo.findOne({
      where: { id },
      relations: { site: true },
    });
  }

  async findApprovedForDate(date: string): Promise<ScheduleEntry[]> {
    return this.scheduleRepo.find({
      where: { scheduledDate: date, status: 'approved' },
      relations: { site: true },
      order: { siteId: 'ASC' },
    });
  }

  /**
   * (site_id, scheduled_date) UNIQUE 制約に基づいた upsert。
   * 既存レコードがあれば更新、なければ作成。run_history はそのまま保持される。
   */
  async upsert(data: UpsertEntryData): Promise<ScheduleEntry> {
    const existing = await this.scheduleRepo.findOne({
      where: { siteId: data.siteId, scheduledDate: data.scheduledDate },
    });

    if (existing) {
      existing.keyword1 = data.keyword1;
      existing.keyword2 = data.keyword2;
      existing.keyword3 = data.keyword3;
      existing.topic = data.topic;
      existing.articleType = data.articleType;
      existing.categoryNames = data.categoryNames;
      existing.tagNames = data.tagNames;
      existing.inlineImageCount = data.inlineImageCount;
      if (data.status !== undefined) existing.status = data.status;
      if (data.source !== undefined) existing.source = data.source;
      if (data.planId !== undefined) existing.planId = data.planId;
      return this.scheduleRepo.save(existing);
    }

    const entry = this.scheduleRepo.create({
      siteId: data.siteId,
      scheduledDate: data.scheduledDate,
      keyword1: data.keyword1,
      keyword2: data.keyword2,
      keyword3: data.keyword3,
      topic: data.topic,
      articleType: data.articleType,
      categoryNames: data.categoryNames,
      tagNames: data.tagNames,
      inlineImageCount: data.inlineImageCount,
      status: data.status ?? 'pending',
      source: data.source ?? 'manual',
      planId: data.planId,
    });
    return this.scheduleRepo.save(entry);
  }

  /**
   * status='approved' の既存エントリは保護したい場合に呼ぶ。
   * 既存が approved ならスキップして null を返す。
   */
  async upsertProtectingApproved(
    data: UpsertEntryData,
  ): Promise<ScheduleEntry | null> {
    const existing = await this.scheduleRepo.findOne({
      where: { siteId: data.siteId, scheduledDate: data.scheduledDate },
    });
    if (existing && existing.status === 'approved') return null;
    return this.upsert(data);
  }

  async patch(
    id: number,
    patch: Partial<UpsertEntryData> & { status?: ScheduleStatus },
  ): Promise<ScheduleEntry> {
    const entry = await this.scheduleRepo.findOneOrFail({ where: { id } });
    Object.assign(entry, patch);
    return this.scheduleRepo.save(entry);
  }

  async createRunHistory(data: CreateRunHistoryData): Promise<RunHistory> {
    const run = this.runRepo.create(data);
    return this.runRepo.save(run);
  }

  async findLatestSuccessfulRun(
    scheduleEntryId: number,
  ): Promise<RunHistory | null> {
    return this.runRepo.findOne({
      where: { scheduleEntryId, status: 'success' },
      order: { ranAt: 'DESC' },
    });
  }

  async findLatestRun(scheduleEntryId: number): Promise<RunHistory | null> {
    return this.runRepo.findOne({
      where: { scheduleEntryId },
      order: { ranAt: 'DESC' },
    });
  }
}
