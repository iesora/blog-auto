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
import { CreateSiteDto, SiteResponse, UpdateSiteDto } from './sites.dto';
import { ArticleType } from '../blog-generator/blog-generator.dto';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);

  constructor(
    @InjectRepository(Site) private readonly repo: Repository<Site>,
  ) {}

  toResponse(site: Site): SiteResponse {
    return {
      id: site.id,
      slug: site.slug,
      name: site.name,
      wpUrl: site.wpUrl,
      wpUsername: site.wpUsername,
      gscSiteUrl: site.gscSiteUrl,
      defaultArticleType: site.defaultArticleType,
      defaultCategories: site.defaultCategories,
      defaultTags: site.defaultTags,
      persona: site.persona,
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
      throw new BadRequestException('slug must be lowercase alphanumeric / dash');
    }
    if (!dto.wpAppPassword) {
      throw new BadRequestException('wpAppPassword is required');
    }
    const exists = await this.repo.findOne({ where: { slug: dto.slug } });
    if (exists) throw new BadRequestException(`slug '${dto.slug}' already exists`);

    const site = this.repo.create({
      slug: dto.slug,
      name: dto.name,
      wpUrl: dto.wpUrl,
      wpUsername: dto.wpUsername,
      wpAppPwEncrypted: encryptSecret(dto.wpAppPassword),
      gscSiteUrl: dto.gscSiteUrl,
      defaultArticleType: dto.defaultArticleType ?? ArticleType.SEO,
      defaultCategories: dto.defaultCategories,
      defaultTags: dto.defaultTags,
      persona: dto.persona,
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
    if (dto.defaultCategories !== undefined)
      site.defaultCategories = dto.defaultCategories;
    if (dto.defaultTags !== undefined) site.defaultTags = dto.defaultTags;
    if (dto.persona !== undefined) site.persona = dto.persona;
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
