import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { ArticleType } from './blog-generator.dto';

const STYLE_SUFFIX =
  'Photorealistic style, warm workshop lighting, clean composition. No anime, no cartoon, no illustration, no text overlay in the image.';

const THUMBNAIL_PROMPTS: Record<ArticleType, string> = {
  [ArticleType.SEO]:
    'A professional close-up photograph of wind instrument parts and repair tools on a clean wooden workbench.',
  [ArticleType.REPAIR_REPORT]:
    'A detailed close-up photograph of a craftsman repairing a wind instrument, hands working with precision tools on an instrument laid on a repair mat.',
  [ArticleType.QA]:
    'A photograph showing a wind instrument with visible wear or a common problem, placed on a workbench next to diagnostic tools.',
  [ArticleType.RANKING]:
    'A neatly arranged flat-lay photograph of multiple wind instrument repair tools and maintenance supplies on a green felt mat.',
};

const SAFETY_CHECK_PROMPT = `Analyze this image for content safety. Check whether the image contains any of the following:
- Nudity or sexual content (even partial or ambiguous)
- Genitalia or sexually suggestive body parts
- Violence or gore
- Any other NSFW content

Even if the image is low-resolution or blurry, examine it carefully.

Respond with ONLY a JSON object in this exact format:
{"safe": true} or {"safe": false, "reason": "brief description of the issue"}`;

const MAX_GENERATION_ATTEMPTS = 3;

/**
 * Imagen 4 系は 2026-08-17 に提供終了。後継の Gemini 画像モデルを既定にする。
 * lite は現行の画像モデルで最安（$0.0336/枚）かつ最速で、記事のアイキャッチ用途では
 * 上位の gemini-3.1-flash-image（$0.067/枚）と画質差が実用上ない。
 */
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
const DEFAULT_SAFETY_MODEL = 'gemini-2.5-flash';

/**
 * 画像生成の提供元。IMAGE_PROVIDER で切り替える（未設定なら gemini）。
 * Gemini の画像モデルは無料枠が無く、課金が切れると全滅するため、
 * OpenAI に逃がせるようにしている。安全チェックはどちらでも Gemini を使う。
 */
type ImageProvider = 'gemini' | 'openai';

/** gpt-image-1-mini の medium は約 $0.009/枚で、Gemini lite の約1/4。 */
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1-mini';
const DEFAULT_OPENAI_IMAGE_QUALITY = 'medium';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

/** 生成された画像。モデルによって PNG / JPEG が変わるため MIME を持ち回る。 */
export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

@Injectable()
export class ImageGeneratorService {
  private readonly logger = new Logger(ImageGeneratorService.name);
  private readonly genai: GoogleGenAI;
  private readonly provider: ImageProvider;
  private readonly imageModel: string;
  private readonly safetyModel: string;
  private readonly openaiApiKey?: string;
  private readonly openaiQuality: string;

  constructor(private readonly configService: ConfigService) {
    this.genai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
    this.provider = this.resolveProvider(
      this.configService.get<string>('IMAGE_PROVIDER'),
    );
    this.imageModel =
      this.provider === 'openai'
        ? (this.configService.get<string>('OPENAI_IMAGE_MODEL') ??
          DEFAULT_OPENAI_IMAGE_MODEL)
        : (this.configService.get<string>('GEMINI_IMAGE_MODEL') ??
          DEFAULT_IMAGE_MODEL);
    this.openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openaiQuality =
      this.configService.get<string>('OPENAI_IMAGE_QUALITY') ??
      DEFAULT_OPENAI_IMAGE_QUALITY;
    this.safetyModel =
      this.configService.get<string>('GEMINI_SAFETY_MODEL') ??
      DEFAULT_SAFETY_MODEL;
    this.logger.log(
      `image provider = ${this.provider}, image model = ${this.imageModel}` +
        (this.provider === 'openai' ? ` (${this.openaiQuality})` : '') +
        `, safety model = ${this.safetyModel}`,
    );
    if (this.provider === 'openai' && !this.openaiApiKey) {
      // 起動は止めない。記事生成は続け、画像だけ失敗として imageErrors に残す
      this.logger.error(
        'IMAGE_PROVIDER=openai ですが OPENAI_API_KEY が未設定です。画像生成は失敗します',
      );
    }
  }

  /** 未設定・未知の値は gemini（従来動作）に倒す。typo で気づけるよう警告を出す。 */
  private resolveProvider(raw: string | undefined): ImageProvider {
    const value = (raw ?? '').trim().toLowerCase();
    if (value === '' || value === 'gemini') return 'gemini';
    if (value === 'openai') return 'openai';
    this.logger.warn(
      `IMAGE_PROVIDER="${raw}" は不明な値のため gemini を使います（gemini / openai のみ有効）`,
    );
    return 'gemini';
  }

  async generateThumbnail(
    blogTitle: string,
    articleType: ArticleType = ArticleType.SEO,
  ): Promise<GeneratedImage> {
    this.logger.log(`Generating thumbnail for: "${blogTitle}"`);

    const basePrompt = THUMBNAIL_PROMPTS[articleType];
    const prompt = `${basePrompt} Related to a blog post titled "${blogTitle}". ${STYLE_SUFFIX}`;

    return this.generateImageWithSafetyCheck(prompt);
  }

  async generateSectionImage(prompt: string): Promise<GeneratedImage> {
    this.logger.log(`Generating section image`);

    const fullPrompt = prompt.includes('photorealistic')
      ? prompt
      : `${prompt} ${STYLE_SUFFIX}`;

    return this.generateImageWithSafetyCheck(fullPrompt);
  }

  private async generateImageWithSafetyCheck(
    prompt: string,
  ): Promise<GeneratedImage> {
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const image = await this.generateImage(prompt);
      const safetyResult = await this.checkImageSafety(image);

      if (safetyResult.safe) {
        return image;
      }

      this.logger.warn(
        `Image failed safety check (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}): ${safetyResult.reason}`,
      );

      if (attempt === MAX_GENERATION_ATTEMPTS) {
        throw new Error(
          `Image generation failed safety check after ${MAX_GENERATION_ATTEMPTS} attempts: ${safetyResult.reason}`,
        );
      }
    }

    throw new Error('Unexpected: exited retry loop without result');
  }

  private async checkImageSafety(
    image: GeneratedImage,
  ): Promise<{ safe: boolean; reason?: string }> {
    try {
      const base64Image = image.buffer.toString('base64');

      const response = await this.genai.models.generateContent({
        model: this.safetyModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: base64Image,
                },
              },
              { text: SAFETY_CHECK_PROMPT },
            ],
          },
        ],
      });

      const text = response.text?.trim() ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        this.logger.warn(`Safety check returned unparseable response: ${text}`);
        return { safe: false, reason: 'Safety check response was unparseable' };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        safe: !!result.safe,
        reason: result.reason,
      };
    } catch (err) {
      this.logger.warn(`Safety check failed: ${err.message}`);
      return { safe: false, reason: `Safety check error: ${err.message}` };
    }
  }

  private async generateImage(prompt: string): Promise<GeneratedImage> {
    return this.provider === 'openai'
      ? this.generateWithOpenAI(prompt)
      : this.generateWithGemini(prompt);
  }

  private async generateWithOpenAI(prompt: string): Promise<GeneratedImage> {
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    let data: { data?: { b64_json?: string }[] };
    try {
      const res = await axios.post(
        OPENAI_IMAGES_URL,
        {
          model: this.imageModel,
          prompt,
          size: '1024x1024',
          quality: this.openaiQuality,
          // PNG だと 1枚 1.5MB 前後になりページが重くなるため JPEG で受ける
          output_format: 'jpeg',
          n: 1,
        },
        {
          headers: { Authorization: `Bearer ${this.openaiApiKey}` },
          timeout: 120_000,
        },
      );
      data = res.data as typeof data;
    } catch (err) {
      const reason = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? '-'} ${
            (err.response?.data as { error?: { message?: string } })?.error
              ?.message ?? err.message
          }`
        : (err as Error).message;
      throw new Error(
        `Failed to generate image (${this.imageModel}): ${reason.slice(0, 300)}`,
      );
    }

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(
        `Failed to generate image (${this.imageModel}): empty response`,
      );
    }
    const buffer = Buffer.from(b64, 'base64');
    this.logger.log(`Image generated: ${buffer.length} bytes (image/jpeg)`);
    return { buffer, mimeType: 'image/jpeg' };
  }

  private async generateWithGemini(prompt: string): Promise<GeneratedImage> {
    const response = await this.genai.models.generateContent({
      model: this.imageModel,
      contents: prompt,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      // 画像が返らない場合、モデルは理由をテキストで返すことがある（安全フィルタ等）
      const reason =
        parts
          .map((p) => p.text)
          .filter(Boolean)
          .join(' ')
          .slice(0, 200) ||
        `finishReason=${response.candidates?.[0]?.finishReason ?? 'unknown'}`;
      throw new Error(
        `Failed to generate image (${this.imageModel}): ${reason}`,
      );
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
    this.logger.log(`Image generated: ${buffer.length} bytes (${mimeType})`);
    return { buffer, mimeType };
  }
}
