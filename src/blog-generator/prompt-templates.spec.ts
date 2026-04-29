import { buildPrompt, PROMPT_TEMPLATES } from './prompt-templates';
import { ArticleType } from './blog-generator.dto';

describe('prompt-templates', () => {
  describe('PROMPT_TEMPLATES', () => {
    it('全記事タイプのテンプレートが定義されている', () => {
      expect(PROMPT_TEMPLATES[ArticleType.SEO]).toBeDefined();
      expect(PROMPT_TEMPLATES[ArticleType.REPAIR_REPORT]).toBeDefined();
      expect(PROMPT_TEMPLATES[ArticleType.QA]).toBeDefined();
      expect(PROMPT_TEMPLATES[ArticleType.RANKING]).toBeDefined();
    });

    it.each(Object.values(ArticleType))(
      '%s テンプレートにSEO共通ルールが含まれる',
      (type) => {
        const tmpl = PROMPT_TEMPLATES[type];
        expect(tmpl).toContain('SEO対策ルール');
        expect(tmpl).toContain('見出し(h2, h3)');
        expect(tmpl).toContain('{{keywords}}');
      },
    );

    it.each(Object.values(ArticleType))(
      '%s テンプレートにJSON出力フォーマットが含まれる',
      (type) => {
        const tmpl = PROMPT_TEMPLATES[type];
        expect(tmpl).toContain('"title"');
        expect(tmpl).toContain('"content"');
        expect(tmpl).toContain('"excerpt"');
        expect(tmpl).toContain('"metaDescription"');
        expect(tmpl).toContain('"slug"');
        expect(tmpl).toContain('"sectionImages"');
        expect(tmpl).toContain('"faq"');
      },
    );

    it.each(Object.values(ArticleType))(
      '%s テンプレートにSEO強化ルールが含まれる',
      (type) => {
        const tmpl = PROMPT_TEMPLATES[type];
        expect(tmpl).toContain('冒頭の120文字以内');
        expect(tmpl).toContain('1〜3%の密度');
        expect(tmpl).toContain('INTERNAL_LINK');
      },
    );

    it.each(Object.values(ArticleType))(
      '%s テンプレートにSwellブロック指示が含まれる',
      (type) => {
        const tmpl = PROMPT_TEMPLATES[type];
        expect(tmpl).toContain('swell-block-capbox');
        expect(tmpl).toContain('swell-block-balloon');
      },
    );
  });

  describe('buildPrompt', () => {
    it('キーワードがカンマ区切りで埋め込まれる', () => {
      const result = buildPrompt(ArticleType.SEO, [
        'フルート',
        'タンポ交換',
      ]);
      expect(result).toContain('フルート, タンポ交換');
    });

    it('トピック指定時にトピック行が挿入される', () => {
      const result = buildPrompt(ArticleType.QA, ['サックス'], '音が出ない');
      expect(result).toContain('トピック: 音が出ない');
    });

    it('トピック未指定時はトピック行が空になる', () => {
      const result = buildPrompt(ArticleType.QA, ['サックス']);
      expect(result).not.toContain('トピック:');
    });

    it('各記事タイプで異なるプロンプトが生成される', () => {
      const seo = buildPrompt(ArticleType.SEO, ['テスト']);
      const qa = buildPrompt(ArticleType.QA, ['テスト']);
      expect(seo).not.toEqual(qa);
    });
  });
});
