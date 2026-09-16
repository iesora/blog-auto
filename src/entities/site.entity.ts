import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ArticleType, PostStatus } from '../blog-generator/blog-generator.dto';
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

  /**
   * 生成した記事を WordPress にどの状態で投稿するか。
   * 既定は下書き。公開運用に切り替えたサイトだけ publish にする。
   */
  @Column({
    name: 'post_status',
    type: 'enum',
    enum: PostStatus,
    default: PostStatus.DRAFT,
  })
  postStatus!: PostStatus;

  /**
   * キーワード生成時にプランを自動承認するか。
   * false（既定）なら従来どおり pending で作成し、人の承認を待つ。
   */
  @Column({ name: 'auto_approve_keywords', default: false })
  autoApproveKeywords!: boolean;

  @Column({ name: 'default_categories', type: 'json', nullable: true })
  defaultCategories?: string[];

  @Column({ name: 'default_tags', type: 'json', nullable: true })
  defaultTags?: string[];

  /**
   * 記事タイプごとの生成プロンプト。キーは ArticleType。
   * 未設定（キーが無い / 空文字）の記事タイプは prompt-templates.ts の既定値を使う。
   */
  @Column({ name: 'prompt_templates', type: 'json', nullable: true })
  promptTemplates?: Partial<Record<ArticleType, string>> | null;

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
