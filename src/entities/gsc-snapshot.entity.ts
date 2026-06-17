import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Site } from './site.entity';
import { GscQueryRow } from './gsc-query-row.entity';

@Entity({ name: 'gsc_snapshots' })
export class GscSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site!: Site;

  @Column({ name: 'site_id' })
  siteId!: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @Column({ name: 'row_count' })
  rowCount!: number;

  @Column({
    name: 'taken_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  takenAt!: Date;

  @Column({ name: 'data_state', length: 16, default: 'final' })
  dataState!: string;

  /** Claude が立案したマーケティング戦略（Markdown）。未立案なら null。 */
  @Column({ name: 'marketing_strategy', type: 'text', nullable: true })
  marketingStrategy?: string | null;

  /** 戦略を生成したモデル名。 */
  @Column({
    name: 'marketing_generated_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  marketingGeneratedBy?: string | null;

  /** 戦略を生成した日時。 */
  @Column({ name: 'marketing_generated_at', type: 'datetime', nullable: true })
  marketingGeneratedAt?: Date | null;

  @OneToMany(() => GscQueryRow, (r) => r.snapshot)
  rows!: GscQueryRow[];
}
