import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WordpressService } from './wordpress.service';

// axios.create のモック
jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  }),
}));

import axios from 'axios';

describe('WordpressService', () => {
  let service: WordpressService;
  let mockClient: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordpressService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                WORDPRESS_URL: 'https://example.com',
                WORDPRESS_USERNAME: 'testuser',
                WORDPRESS_APP_PASSWORD: 'testpass',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WordpressService>(WordpressService);
    mockClient = (axios.create as jest.Mock).mock.results[0]?.value;
  });

  it('サービスが正常に初期化される', () => {
    expect(service).toBeDefined();
  });

  it('axios.createがBasic Auth付きで呼ばれる', () => {
    const expectedToken = Buffer.from('testuser:testpass').toString('base64');
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.com/wp-json/wp/v2',
        headers: expect.objectContaining({
          Authorization: `Basic ${expectedToken}`,
        }),
      }),
    );
  });

  describe('createPost', () => {
    it('投稿を作成してレスポンスを返す', async () => {
      const mockResponse = {
        data: { id: 123, title: { rendered: 'Test' }, link: 'https://example.com/test' },
      };
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await service.createPost({
        title: 'Test',
        content: '<p>content</p>',
        status: 'draft',
      });

      expect(result.id).toBe(123);
      expect(mockClient.post).toHaveBeenCalledWith(
        '/posts',
        expect.objectContaining({ title: 'Test', status: 'draft' }),
      );
    });
  });

  describe('uploadMedia', () => {
    it('画像をアップロードしてレスポンスを返す', async () => {
      const mockResponse = {
        data: { id: 456, source_url: 'https://example.com/image.png' },
      };
      mockClient.post.mockResolvedValue(mockResponse);

      const buf = Buffer.from('fake-image');
      const result = await service.uploadMedia(buf, 'test.png', 'image/png');

      expect(result.id).toBe(456);
      expect(mockClient.post).toHaveBeenCalledWith('/media', buf, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="test.png"',
        },
      });
    });
  });

  describe('listCategories', () => {
    it('カテゴリ一覧を取得する', async () => {
      mockClient.get.mockResolvedValue({
        data: [{ id: 1, name: '修理' }],
      });
      const result = await service.listCategories();
      expect(result).toEqual([{ id: 1, name: '修理' }]);
    });
  });

  describe('listTags', () => {
    it('タグ一覧を取得する', async () => {
      mockClient.get.mockResolvedValue({
        data: [{ id: 10, name: 'フルート' }],
      });
      const result = await service.listTags();
      expect(result).toEqual([{ id: 10, name: 'フルート' }]);
    });
  });
});
