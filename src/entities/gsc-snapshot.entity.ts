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

  @OneToMany(() => GscQueryRow, (r) => r.snapshot)
  rows!: GscQueryRow[];
}
