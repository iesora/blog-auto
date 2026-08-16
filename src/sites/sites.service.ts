import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../entities';
import { encryptSecret, decryptSecret } from '../utils/encryption';
import {
  CreateSiteDto,
  PromptDefaultsResponse,
  PromptTemplates,
  SiteResponse,
  UpdateSiteDto,
} from './sites.dto';
import { ArticleType } from '../blog-generator/blog-generator.dto';
import {
  PROMPT_PLACEHOLDERS,
  defaultPromptFor,
} from '../blog-generator/prompt-templates';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
/** プロンプト1本の上限。Claude の入力上限より十分手前で弾く。 */
const PROMPT_MAX_LENGTH = 20000;
const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  [ArticleType.SEO]: 'SEO 記事',
  [ArticleType.REPAIR_REPORT]: '修理レポート',
  [ArticleType.QA]: 'Q&A',
  [ArticleType.RANKING]: 'ランキング・比較',
};

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);

  constructor(
    @InjectRepository(Site) private readonly repo: Repository<Site>,
  ) {}

  /** 記事タイプごとの既定プロンプトと、使えるプレースホルダを返す。 */
  promptDefaults(): PromptDefaultsResponse {
    return {
      articleTypes: Object.values(ArticleType).map((value) => ({
        value,
        label: ARTICLE_TYPE_LABELS[value],
        template: defaultPromptFor(value),
      })),
      placeholders: PROMPT_PLACEHOLDERS.map((p) => ({ ...p })),
    };
  }

  /**
   * 保存前にプロンプトを検証・正規化する。
   *
   * - 未知の記事タイプキーは弾く
   * - 空文字/空白のみは「未設定」= 既定値を使う、として落とす
   * - {{keywords}} が無いプロンプトはキーワードが本文に反映されず事故になるので弾く
   *
   * 全て既定値に戻された場合は null を返す。undefined を返すと TypeORM の save() が
   * 「変更なし」と解釈して既存の JSON が残り、既定値に戻せなくなる。
   */
  private sanitizePromptTemplates(
    input?: PromptTemplates | null,
  ): PromptTemplates | null {
    if (input === null || input === undefined) return null;
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('promptTemplates must be an object');
    }

    const allowed = Object.values(ArticleType) as string[];
    const out: PromptTemplates = {};
    for (const [key, raw] of Object.entries(input)) {
      if (!allowed.includes(key)) {
        throw new BadRequestException(`unknown article type: ${key}`);
      }
      if (raw === null || raw === undefined) continue;
      if (typeof raw !== 'string') {
        throw new BadRequestException(
          `promptTemplates.${key} must be a string`,
        );
      }
      const value = raw.trim();
      if (!value) continue; // 空欄 = 既定値に戻す
      if (value.length > PROMPT_MAX_LENGTH) {
        throw new BadRequestException(
          `promptTemplates.${key} は ${PROMPT_MAX_LENGTH} 文字以内にしてください（現在 ${value.length} 文字）`,
        );
      }
      if (!value.includes('{{keywords}}')) {
        throw new BadRequestException(
          `promptTemplates.${key} に {{keywords}} が含まれていません。キーワードが記事に反映されなくなるため必須です`,
        );
      }
      out[key as ArticleType] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  toResponse(site: Site): SiteResponse {
    return {
      id: site.id,
      slug: site.slug,
      name: site.name,
      wpUrl: site.wpUrl,
      wpUsername: site.wpUsername,
      gscSiteUrl: site.gscSiteUrl,
      defaultArticleType: site.defaultArticleType,
      promptTemplates: site.promptTemplates ?? undefined,
      active: site.active,
    };
  }

  async list(): Promise<Site[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  async listActive(): Promise<Site[]> {
    return this.repo.find({ where: { active: true }, order: { id: 'ASC' } });
  }

  async findBySlug(slug: string): Promise<Site> {
    const site = await this.repo.findOne({ where: { slug } });
    if (!site) throw new NotFoundException(`site '${slug}' not found`);
    return site;
  }

  async findById(id: number): Promise<Site> {
    const site = await this.repo.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`site id=${id} not found`);
    return site;
  }

  async create(dto: CreateSiteDto): Promise<Site> {
    if (!dto.slug || !SLUG_RE.test(dto.slug)) {
      throw new BadRequestException(
        'slug must be lowercase alphanumeric / dash',
      );
    }
    if (!dto.wpAppPassword) {
      throw new BadRequestException('wpAppPassword is required');
    }
    const exists = await this.repo.findOne({ where: { slug: dto.slug } });
    if (exists)
      throw new BadRequestException(`slug '${dto.slug}' already exists`);

    const site = this.repo.create({
      slug: dto.slug,
      name: dto.name,
      wpUrl: dto.wpUrl,
      wpUsername: dto.wpUsername,
      wpAppPwEncrypted: encryptSecret(dto.wpAppPassword),
      gscSiteUrl: dto.gscSiteUrl,
      defaultArticleType: dto.defaultArticleType ?? ArticleType.SEO,
      promptTemplates: this.sanitizePromptTemplates(dto.promptTemplates),
      active: dto.active ?? true,
    });
    return this.repo.save(site);
  }

  async update(slug: string, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.findBySlug(slug);
    if (dto.name !== undefined) site.name = dto.name;
    if (dto.wpUrl !== undefined) site.wpUrl = dto.wpUrl;
    if (dto.wpUsername !== undefined) site.wpUsername = dto.wpUsername;
    if (dto.wpAppPassword !== undefined && dto.wpAppPassword !== '') {
      site.wpAppPwEncrypted = encryptSecret(dto.wpAppPassword);
    }
    if (dto.gscSiteUrl !== undefined) site.gscSiteUrl = dto.gscSiteUrl;
    if (dto.defaultArticleType !== undefined)
      site.defaultArticleType = dto.defaultArticleType;
    if (dto.promptTemplates !== undefined)
      site.promptTemplates = this.sanitizePromptTemplates(dto.promptTemplates);
    if (dto.active !== undefined) site.active = dto.active;
    return this.repo.save(site);
  }

  /**
   * 復号した平文の WordPress Application Password を返す。
   * 呼び出し側は使い終わったら参照を破棄すること。
   */
  decryptWpAppPassword(site: Site): string {
    return decryptSecret(site.wpAppPwEncrypted);
  }
}
