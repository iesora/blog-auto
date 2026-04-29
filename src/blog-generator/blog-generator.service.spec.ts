import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlogGeneratorService } from './blog-generator.service';
import { WordpressService } from '../wordpress/wordpress.service';
import { ImageGeneratorService } from './image-generator.service';
import { ArticleType } from './blog-generator.dto';

// repairTruncatedJson はprivateなので、プロトタイプ経由でテスト
function callRepairTruncatedJson(
  service: BlogGeneratorService,
  json: string,
): string {
  return (service as any).repairTruncatedJson(json);
}

describe('BlogGeneratorService', () => {
  let service: BlogGeneratorService;
  let wordpressService: jest.Mocked<WordpressService>;
  let imageGeneratorService: jest.Mocked<ImageGeneratorService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlogGeneratorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
        {
          provide: WordpressService,
          useValue: {
            createPost: jest.fn(),
            uploadMedia: jest.fn(),
            listCategories: jest.fn().mockResolvedValue([]),
            listTags: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ImageGeneratorService,
          useValue: {
            generateThumbnail: jest.fn(),
            generateSectionImage: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BlogGeneratorService>(BlogGeneratorService);
    wordpressService = module.get(WordpressService);
    imageGeneratorService = module.get(ImageGeneratorService);
  });

  it('サービスが正常に初期化される', () => {
    expect(service).toBeDefined();
  });

  describe('repairTruncatedJson', () => {
    it('正常なJSONはそのまま返す', () => {
      const input = '{"title":"test","content":"hello"}';
      const result = callRepairTruncatedJson(service, input);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('閉じ括弧が不足しているJSONを修復する', () => {
      const input = '{"title":"test","content":"hello"';
      const result = callRepairTruncatedJson(service, input);
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe('test');
    });

    it('配列が閉じていないJSONを修復する', () => {
      const input =
        '{"title":"test","tags":["tag1","tag2"';
      const result = callRepairTruncatedJson(service, input);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('未閉じの文字列を修復する', () => {
      const input = '{"title":"途中で切れた';
      const result = callRepairTruncatedJson(service, input);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('末尾のゴミを除去する', () => {
      const input = '{"title":"test","content":"ok", "partial';
      const result = callRepairTruncatedJson(service, input);
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('resolveCategories', () => {
    it('名前からIDに変換する', async () => {
      wordpressService.listCategories.mockResolvedValue([
        { id: 1, name: '修理レポート' },
        { id: 2, name: 'メンテナンス' },
      ]);

      const result = await (service as any).resolveCategories(['修理レポート']);
      expect(result).toEqual([1]);
    });

    it('該当なしの場合は空配列を返す', async () => {
      wordpressService.listCategories.mockResolvedValue([
        { id: 1, name: '修理レポート' },
      ]);

      const result = await (service as any).resolveCategories(['存在しない']);
      expect(result).toEqual([]);
    });

    it('空配列ではAPIを呼ばない', async () => {
      const result = await (service as any).resolveCategories([]);
      expect(result).toEqual([]);
      expect(wordpressService.listCategories).not.toHaveBeenCalled();
    });
  });

  describe('resolveTags', () => {
    it('名前からIDに変換する', async () => {
      wordpressService.listTags.mockResolvedValue([
        { id: 10, name: 'フルート' },
        { id: 20, name: 'クラリネット' },
      ]);

      const result = await (service as any).resolveTags([
        'フルート',
        'クラリネット',
      ]);
      expect(result).toEqual([10, 20]);
    });

    it('APIエラー時は空配列を返す', async () => {
      wordpressService.listTags.mockRejectedValue(new Error('API error'));
      const result = await (service as any).resolveTags(['フルート']);
      expect(result).toEqual([]);
    });
  });

  describe('buildFaqJsonLd', () => {
    it('FAQ配列からJSON-LDスクリプトタグを生成する', () => {
      const faq = [
        { question: 'フルートの修理費用は？', answer: '内容により1万〜5万円程度です。' },
        { question: '修理期間はどのくらい？', answer: '通常1〜2週間です。' },
      ];
      const result = service.buildFaqJsonLd(faq);

      expect(result).toContain('<script type="application/ld+json">');
      expect(result).toContain('FAQPage');

      const jsonMatch = result.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const parsed = JSON.parse(jsonMatch![1]);

      expect(parsed['@context']).toBe('https://schema.org');
      expect(parsed['@type']).toBe('FAQPage');
      expect(parsed.mainEntity).toHaveLength(2);
      expect(parsed.mainEntity[0]['@type']).toBe('Question');
      expect(parsed.mainEntity[0].name).toBe('フルートの修理費用は？');
      expect(parsed.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
    });

    it('空配列でも有効なJSON-LDを生成する', () => {
      const result = service.buildFaqJsonLd([]);
      expect(result).toContain('FAQPage');
      const jsonMatch = result.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      const parsed = JSON.parse(jsonMatch![1]);
      expect(parsed.mainEntity).toEqual([]);
    });
  });
});
