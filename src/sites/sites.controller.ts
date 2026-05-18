import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto';
import { SitesService } from './sites.service';

@Controller('sites')
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  async list() {
    const sites = await this.sitesService.list();
    return sites.map((s) => this.sitesService.toResponse(s));
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const site = await this.sitesService.findBySlug(slug);
    return this.sitesService.toResponse(site);
  }

  @Post()
  async create(@Body() dto: CreateSiteDto) {
    const site = await this.sitesService.create(dto);
    return this.sitesService.toResponse(site);
  }

  @Patch(':slug')
  async update(@Param('slug') slug: string, @Body() dto: UpdateSiteDto) {
    const site = await this.sitesService.update(slug, dto);
    return this.sitesService.toResponse(site);
  }
}
