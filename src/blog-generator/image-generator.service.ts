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

@Injectable()
export class ImageGeneratorService {
  private readonly logger = new Logger(ImageGeneratorService.name);
  private readonly genai: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    this.genai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
  }

  async generateThumbnail(
    blogTitle: string,
    articleType: ArticleType = ArticleType.SEO,
  ): Promise<Buffer> {
    this.logger.log(`Generating thumbnail for: "${blogTitle}"`);

    const basePrompt = THUMBNAIL_PROMPTS[articleType];
    const prompt = `${basePrompt} Related to a blog post titled "${blogTitle}". ${STYLE_SUFFIX}`;

    return this.generateImageWithSafetyCheck(prompt);
  }

  async generateSectionImage(prompt: string): Promise<Buffer> {
    this.logger.log(`Generating section image`);

    const fullPrompt = prompt.includes('photorealistic')
      ? prompt
      : `${prompt} ${STYLE_SUFFIX}`;

    return this.generateImageWithSafetyCheck(fullPrompt);
  }

  private async generateImageWithSafetyCheck(prompt: string): Promise<Buffer> {
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const buffer = await this.generateImage(prompt);
      const safetyResult = await this.checkImageSafety(buffer);

      if (safetyResult.safe) {
        return buffer;
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
    imageBuffer: Buffer,
  ): Promise<{ safe: boolean; reason?: string }> {
    try {
      const base64Image = imageBuffer.toString('base64');

      const response = await this.genai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
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

  private async generateImage(prompt: string): Promise<Buffer> {
    const response = await this.genai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: {
        numberOfImages: 1,
      },
    });

    const image = response.generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      throw new Error('Failed to generate image');
    }

    const buffer = Buffer.from(image.image.imageBytes, 'base64');
    this.logger.log(`Image generated: ${buffer.length} bytes`);
    return buffer;
  }
}
