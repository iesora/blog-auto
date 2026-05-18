import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ArticleType } from '../blog-generator/blog-generator.dto';
import { Site } from './site.entity';
import { KeywordPlan } from './keyword-plan.entity';
import { RunHistory } from './run-history.entity';

export type ScheduleStatus = 'pending' | 'approved' | 'skipped';
export type ScheduleSource = 'manual' | 'auto';

@Entity({ name: 'schedule_entries' })
@Unique('uq_schedule_site_date', ['site', 'scheduledDate'])
@Index('idx_schedule_date_status', ['scheduledDate', 'status'])
export class ScheduleEntry {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Site, (s) => s.schedules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: Site;

  @Column({ name: 'site_id' })
  siteId!: number;

  @Column({ name: 'scheduled_date', type: 'date' })
  scheduledDate!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'skipped'],
    default: 'pending',
  })
  status!: ScheduleStatus;

  @Column({ length: 100 })
  keyword1!: string;

  @Column({ length: 100 })
  keyword2!: string;

  @Column({ length: 100 })
  keyword3!: string;

  @Column({ type: 'text', nullable: true })
  topic?: string;

  @Column({
    name: 'article_type',
    type: 'enum',
    enum: ArticleType,
    nullable: true,
  })
  articleType?: ArticleType;

  @Column({ name: 'category_names', type: 'json', nullable: true })
  categoryNames?: string[];

  @Column({ name: 'tag_names', type: 'json', nullable: true })
  tagNames?: string[];

  @Column({ name: 'inline_image_count', type: 'tinyint', nullable: true })
  inlineImageCount?: number;

  @Column({ type: 'enum', enum: ['manual', 'auto'], default: 'manual' })
  source!: ScheduleSource;

  @ManyToOne(() => KeywordPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_id' })
  plan?: KeywordPlan;

  @Column({ name: 'plan_id', nullable: true })
  planId?: number;

  @OneToMany(() => RunHistory, (r) => r.scheduleEntry)
  runs!: RunHistory[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
