import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Site } from './site.entity';
import { GscSnapshot } from './gsc-snapshot.entity';

export type KeywordPlanStatus = 'draft' | 'approved' | 'rejected';

@Entity({ name: 'keyword_plans' })
@Index('idx_plan_site_cycle', ['site', 'cycleStart'])
export class KeywordPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: Site;

  @Column({ name: 'site_id' })
  siteId!: number;

  @Column({ name: 'cycle_start', type: 'date' })
  cycleStart!: string;

  @Column({ name: 'cycle_end', type: 'date' })
  cycleEnd!: string;

  @Column({
    type: 'enum',
    enum: ['draft', 'approved', 'rejected'],
    default: 'draft',
  })
  status!: KeywordPlanStatus;

  @ManyToOne(() => GscSnapshot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot?: GscSnapshot;

  @Column({ name: 'snapshot_id', nullable: true })
  snapshotId?: number;

  @Column({ name: 'generated_by', length: 64, default: 'claude-sonnet-4-6' })
  generatedBy!: string;

  @Column({ name: 'approved_by', length: 128, nullable: true })
  approvedBy?: string;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt?: Date;

  @Column({ name: 'raw_response', type: 'json', nullable: true })
  rawResponse?: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
