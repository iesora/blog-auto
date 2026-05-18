import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GscSnapshot } from './gsc-snapshot.entity';

@Entity({ name: 'gsc_query_rows' })
@Index('idx_gsc_snapshot_impressions', ['snapshot', 'impressions'])
export class GscQueryRow {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => GscSnapshot, (s) => s.rows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot!: GscSnapshot;

  @Column({ name: 'snapshot_id' })
  snapshotId!: number;

  @Column({ length: 255 })
  query!: string;

  @Column({ length: 512, nullable: true })
  page?: string;

  @Column()
  clicks!: number;

  @Column()
  impressions!: number;

  @Column({ type: 'float' })
  ctr!: number;

  @Column({ type: 'float' })
  position!: number;
}
