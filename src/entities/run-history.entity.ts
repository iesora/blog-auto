import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScheduleEntry } from './schedule-entry.entity';

export type RunStatus = 'success' | 'failed';

@Entity({ name: 'run_history' })
@Index('idx_run_entry_ranat', ['scheduleEntry', 'ranAt'])
export class RunHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => ScheduleEntry, (s) => s.runs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_entry_id' })
  scheduleEntry!: ScheduleEntry;

  @Column({ name: 'schedule_entry_id' })
  scheduleEntryId!: number;

  @Column({ type: 'enum', enum: ['success', 'failed'] })
  status!: RunStatus;

  @Column({ name: 'ran_at', type: 'datetime' })
  ranAt!: Date;

  @Column({ name: 'wp_post_id', nullable: true })
  wpPostId?: number;

  @Column({ name: 'wp_post_link', length: 512, nullable: true })
  wpPostLink?: string;

  @Column({ name: 'wp_post_title', length: 512, nullable: true })
  wpPostTitle?: string;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ name: 'duration_ms', nullable: true })
  durationMs?: number;
}
