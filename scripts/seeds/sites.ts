/**
 * 初期サイトの seed 定義。
 * 暗号化キー (WP_APP_PW_ENC_KEY) を環境変数で渡し、生パスワードを暗号化して INSERT する。
 *
 *   $ NODE_ENV=development \
 *     WP_APP_PW_ENC_KEY=$(openssl rand -base64 32) \
 *     npx ts-node scripts/seeds/sites.ts
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { ArticleType } from '../../src/blog-generator/blog-generator.dto';
import { Site } from '../../src/entities';
import { AppDataSource } from '../../src/utils/data-source';
import { encryptSecret } from '../../src/utils/encryption';

interface SiteSeed {
  slug: string;
  name: string;
  wpUrl: string;
  wpUsername: string;
  wpAppPasswordPlain: string;
  gscSiteUrl: string;
  defaultArticleType: ArticleType;
  persona: string;
  defaultCategories?: string[];
  defaultTags?: string[];
}

const seeds: SiteSeed[] = [
  {
    slug: 'gakkiou',
    name: '楽器王',
    wpUrl: process.env.WORDPRESS_URL ?? 'https://gakkiou.com',
    wpUsername: process.env.WORDPRESS_USERNAME ?? 'admin',
    wpAppPasswordPlain: process.env.WORDPRESS_APP_PASSWORD ?? '',
    gscSiteUrl: process.env.GSC_SITE_URL ?? 'https://gakkiou.com/',
    defaultArticleType: ArticleType.SEO,
    persona: '楽器の修理・買取・レビューを扱う中立的な情報サイトの編集者',
  },
  // 残りの 4 サイトはオーナー判断で追加（slug / name / persona を埋める）
  // {
  //   slug: 'site-2', name: 'サイト2',
  //   wpUrl: '', wpUsername: '', wpAppPasswordPlain: '',
  //   gscSiteUrl: '', defaultArticleType: ArticleType.SEO,
  //   persona: '...',
  // },
];

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Site);
  for (const s of seeds) {
    const existing = await repo.findOne({ where: { slug: s.slug } });
    const encrypted = s.wpAppPasswordPlain
      ? encryptSecret(s.wpAppPasswordPlain)
      : '';
    if (existing) {
      console.log(`[skip] site '${s.slug}' already exists (id=${existing.id})`);
      continue;
    }
    const site = repo.create({
      slug: s.slug,
      name: s.name,
      wpUrl: s.wpUrl,
      wpUsername: s.wpUsername,
      wpAppPwEncrypted: encrypted,
      gscSiteUrl: s.gscSiteUrl,
      defaultArticleType: s.defaultArticleType,
      defaultCategories: s.defaultCategories,
      defaultTags: s.defaultTags,
      persona: s.persona,
      active: true,
    });
    const saved = await repo.save(site);
    console.log(`[ok]   inserted site '${s.slug}' id=${saved.id}`);
  }
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
