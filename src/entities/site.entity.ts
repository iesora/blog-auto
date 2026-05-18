import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ArticleType } from '../blog-generator/blog-generator.dto';
import { ScheduleEntry } from './schedule-entry.entity';
import { KeywordPlan } from './keyword-plan.entity';

@Entity({ name: 'sites' })
export class Site {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 64 })
  slug!: string;

  @Column({ length: 128 })
  name!: string;

  @Column({ name: 'wp_url', length: 255 })
  wpUrl!: string;

  @Column({ name: 'wp_username', length: 128 })
  wpUsername!: string;

  @Column({ name: 'wp_app_pw_encrypted', type: 'text' })
  wpAppPwEncrypted!: string;

  @Column({ name: 'gsc_site_url', length: 255 })
  gscSiteUrl!: string;

  @Column({
    name: 'default_article_type',
    type: 'enum',
    enum: ArticleType,
    default: ArticleType.SEO,
  })
  defaultArticleType!: ArticleType;

  @Column({ name: 'default_categories', type: 'json', nullable: true })
  defaultCategories?: string[];

  @Column({ name: 'default_tags', type: 'json', nullable: true })
  defaultTags?: string[];

  @Column({ type: 'text', nullable: true })
  persona?: string;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ScheduleEntry, (s) => s.site)
  schedules!: ScheduleEntry[];

  @OneToMany(() => KeywordPlan, (p) => p.site)
  keywordPlans!: KeywordPlan[];
}
