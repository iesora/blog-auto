import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
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

/** 生成された画像。モデルによって PNG / JPEG が変わるため MIME を持ち回る。 */
export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

@Injectable()
export class ImageGeneratorService {
  private readonly logger = new Logger(ImageGeneratorService.name);
  private readonly genai: GoogleGenAI;
  private readonly imageModel: string;
  private readonly safetyModel: string;

  constructor(private readonly configService: ConfigService) {
    this.genai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
    this.imageModel =
      this.configService.get<string>('GEMINI_IMAGE_MODEL') ??
      DEFAULT_IMAGE_MODEL;
    this.safetyModel =
      this.configService.get<string>('GEMINI_SAFETY_MODEL') ??
      DEFAULT_SAFETY_MODEL;
    this.logger.log(
      `image model = ${this.imageModel}, safety model = ${this.safetyModel}`,
    );
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
