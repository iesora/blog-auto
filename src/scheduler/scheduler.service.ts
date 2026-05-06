import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BlogGeneratorService } from '../blog-generator/blog-generator.service';
import { SchedulerStorageService } from './scheduler-storage.service';
import { RunHistory, ScheduleEntry, UpsertScheduleDto } from './scheduler.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly blogGeneratorService: BlogGeneratorService,
    private readonly storage: SchedulerStorageService,
  ) {}

  // ── バリデーション ──

  private validate(dto: UpsertScheduleDto): ScheduleEntry {
    if (!dto.date || !DATE_RE.test(dto.date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    if (!Array.isArray(dto.keywords) || dto.keywords.length !== 3) {
      throw new BadRequestException('keywords must be exactly 3 strings');
    }
    const keywords = dto.keywords
      .map((k) => String(k).trim())
      .filter((k) => k.length > 0);
    if (keywords.length !== 3) {
      throw new BadRequestException('all 3 keywords must be non-empty');
    }
    return {
      date: dto.date,
      keywords,
      topic: dto.topic,
      articleType: dto.articleType,
      categoryNames: dto.categoryNames,
      tagNames: dto.tagNames,
      inlineImageCount: dto.inlineImageCount,
    };
  }

  // ── CRUD ──

  async upsert(dto: UpsertScheduleDto): Promise<ScheduleEntry> {
    const entry = this.validate(dto);
    return this.storage.upsert(entry);
  }

  async list(): Promise<ScheduleEntry[]> {
    return this.storage.list();
  }

  async findByDate(date: string): Promise<ScheduleEntry | null> {
    return this.storage.findByDate(date);
  }

  async remove(date: string): Promise<void> {
    const removed = await this.storage.remove(date);
    if (!removed) {
      throw new NotFoundException(`No schedule found for ${date}`);
    }
  }

  // ── 実行 ──

  private todayString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  async runForDate(date: string) {
    const entry = await this.storage.findByDate(date);
    if (!entry) {
      this.logger.log(`No schedule entry for ${date}, skipping`);
      return { skipped: true, date };
    }
    this.logger.log(
      `Running schedule for ${date}: keywords=[${entry.keywords.join(', ')}]`,
    );
    try {
      const result = (await this.blogGeneratorService.generateAndCreateDraft({
        keywords: entry.keywords,
        topic: entry.topic,
        articleType: entry.articleType,
        categoryNames: entry.categoryNames,
        tagNames: entry.tagNames,
        inlineImageCount: entry.inlineImageCount,
      })) as { postId: number; link?: string; title: string };
      const lastRun: RunHistory = {
        status: 'success',
        ranAt: new Date().toISOString(),
        postId: result.postId,
        postLink: result.link,
        postTitle: result.title,
      };
      await this.storage.updateLastRun(date, lastRun);
      return { skipped: false, date, result, lastRun };
    } catch (err) {
      const lastRun: RunHistory = {
        status: 'failed',
        ranAt: new Date().toISOString(),
        error: (err as Error).message,
      };
      await this.storage.updateLastRun(date, lastRun);
      throw err;
    }
  }

  async runToday() {
    return this.runForDate(this.todayString());
  }
}
