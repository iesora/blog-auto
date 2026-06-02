import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message: string;
  code?: string;
  upstream?: string;
  upstreamCode?: string;
  upstreamMessage?: string;
  upstreamStatus?: number;
  upstreamUrl?: string;
  requestId?: string;
}

/**
 * 外部 API (Anthropic / Gemini / WordPress 等) のエラーを
 * 利用者に伝わる形に変換するグローバル例外フィルタ。
 *
 * - 課金不足 / 認証失敗 / レート制限などを HTTP ステータスとコードで区別
 * - メッセージは日本語、原因の手当てまで含めて記述
 * - サーバ側ログには元のスタックも残す
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { status, body } = this.toResponse(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.code ?? ''} | ${body.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} ${body.code ?? ''} | ${body.message}`,
      );
    }

    response.status(status).json(body);
  }

  // ──────────────────────────────────────────────
  // exception → HTTP レスポンス
  // ──────────────────────────────────────────────

  private toResponse(e: unknown): { status: number; body: ErrorBody } {
    // 1) NestJS 標準の HttpException (404 / 400 / 401 等)
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse();
      const msg =
        typeof r === 'string'
          ? r
          : Array.isArray((r as { message?: unknown }).message)
            ? ((r as { message: unknown[] }).message as string[]).join('; ')
            : ((r as { message?: string }).message ?? e.message);
      return {
        status,
        body: { statusCode: status, message: msg },
      };
    }

    // 2) Anthropic SDK エラー
    if (this.isAnthropicError(e)) {
      return this.fromAnthropic(e as AnthropicLikeError);
    }

    // 3) Axios エラー (WordPress / Gemini REST 等)
    if (this.isAxiosError(e)) {
      return this.fromAxios(e as AxiosLikeError);
    }

    // 4) Gemini SDK エラー (Google GenAI)
    if (this.isGoogleAiError(e)) {
      return this.fromGoogleAi(e as Error & { status?: number });
    }

    // 5) 一般的な Error
    if (e instanceof Error) {
      return {
        status: 500,
        body: {
          statusCode: 500,
          code: 'INTERNAL_ERROR',
          message: `内部エラー: ${e.message}`,
        },
      };
    }

    // 6) 不明
    return {
      status: 500,
      body: {
        statusCode: 500,
        code: 'UNKNOWN_ERROR',
        message: '不明なエラーが発生しました',
      },
    };
  }

  // ──────────────────────────────────────────────
  // Anthropic
  // ──────────────────────────────────────────────

  private isAnthropicError(e: unknown): boolean {
    if (!e || typeof e !== 'object') return false;
    const obj = e as Record<string, unknown>;
    if (typeof obj.request_id !== 'string') return false;
    const err = obj.error as Record<string, unknown> | undefined;
    const inner = err?.error as Record<string, unknown> | undefined;
    const t = inner?.type;
    return (
      typeof t === 'string' &&
      [
        'invalid_request_error',
        'authentication_error',
        'permission_error',
        'rate_limit_error',
        'api_error',
        'overloaded_error',
        'not_found_error',
      ].includes(t)
    );
  }

  private fromAnthropic(e: AnthropicLikeError): {
    status: number;
    body: ErrorBody;
  } {
    const innerType = e.error?.error?.type ?? 'api_error';
    const innerMsg = e.error?.error?.message ?? '不明な Claude API エラー';

    if (innerMsg.includes('credit balance is too low')) {
      return {
        status: 402,
        body: {
          statusCode: 402,
          code: 'ANTHROPIC_CREDIT_EXHAUSTED',
          upstream: 'Anthropic',
          message:
            'Claude API のクレジット残高が不足しています。Anthropic コンソールで残高を追加してから再試行してください。',
          upstreamCode: innerType,
          upstreamMessage: innerMsg,
          requestId: e.request_id,
        },
      };
    }
    if (innerType === 'authentication_error' || e.status === 401) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'ANTHROPIC_AUTH_FAILED',
          upstream: 'Anthropic',
          message:
            'Claude API の認証に失敗しました。.env の ANTHROPIC_API_KEY を確認してください。',
          upstreamCode: innerType,
          upstreamMessage: innerMsg,
          requestId: e.request_id,
        },
      };
    }
    if (innerType === 'rate_limit_error' || e.status === 429) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'ANTHROPIC_RATE_LIMITED',
          upstream: 'Anthropic',
          message:
            'Claude API のレート制限に達しました。しばらく待ってから再試行してください。',
          upstreamMessage: innerMsg,
          requestId: e.request_id,
        },
      };
    }
    if (innerType === 'overloaded_error') {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'ANTHROPIC_OVERLOADED',
          upstream: 'Anthropic',
          message:
            'Claude API が混雑しています。しばらく待ってから再試行してください。',
          upstreamMessage: innerMsg,
          requestId: e.request_id,
        },
      };
    }
    return {
      status: 502,
      body: {
        statusCode: 502,
        code: 'ANTHROPIC_ERROR',
        upstream: 'Anthropic',
        message: `Claude API エラー: ${innerMsg}`,
        upstreamCode: innerType,
        upstreamMessage: innerMsg,
        requestId: e.request_id,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Axios (WordPress 等)
  // ──────────────────────────────────────────────

  private isAxiosError(e: unknown): boolean {
    return (
      !!e &&
      typeof e === 'object' &&
      (e as { isAxiosError?: boolean }).isAxiosError === true
    );
  }

  private fromAxios(e: AxiosLikeError): { status: number; body: ErrorBody } {
    const url = e.config?.url ?? '';
    const upstreamStatus = e.response?.status;
    const isWp = url.includes('/wp-json/');
    const upstream = isWp ? 'WordPress' : 'HTTP';
    const code = isWp ? 'WORDPRESS_ERROR' : 'HTTP_ERROR';

    // WP の認証失敗 (401)
    if (isWp && upstreamStatus === 401) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'WORDPRESS_AUTH_FAILED',
          upstream,
          message:
            'WordPress 認証に失敗しました。サイトの WP ユーザー名・アプリパスワードを再確認してください。',
          upstreamUrl: url,
          upstreamStatus,
          upstreamMessage: this.extractWpMessage(e),
        },
      };
    }
    // WP の権限エラー (403)
    if (isWp && upstreamStatus === 403) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'WORDPRESS_FORBIDDEN',
          upstream,
          message:
            'WordPress 操作の権限がありません。対象ユーザーに投稿権限があるか確認してください。',
          upstreamUrl: url,
          upstreamStatus,
          upstreamMessage: this.extractWpMessage(e),
        },
      };
    }
    // 接続自体ができていない (ENOTFOUND / ECONNREFUSED 等)
    if (!upstreamStatus) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: isWp ? 'WORDPRESS_UNREACHABLE' : 'HTTP_UNREACHABLE',
          upstream,
          message: isWp
            ? `WordPress に接続できません。URL や DNS を確認してください: ${e.message}`
            : `外部 API に接続できません: ${e.message}`,
          upstreamUrl: url,
          upstreamMessage: e.message,
        },
      };
    }
    return {
      status: 502,
      body: {
        statusCode: 502,
        code,
        upstream,
        message: `${upstream} エラー (${upstreamStatus}): ${this.extractWpMessage(e)}`,
        upstreamUrl: url,
        upstreamStatus,
        upstreamMessage: this.extractWpMessage(e),
      },
    };
  }

  private extractWpMessage(e: AxiosLikeError): string {
    const data = e.response?.data;
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    return e.message;
  }

  // ──────────────────────────────────────────────
  // Google GenAI (Gemini)
  // ──────────────────────────────────────────────

  private isGoogleAiError(e: unknown): boolean {
    if (!(e instanceof Error)) return false;
    const name = e.constructor?.name ?? '';
    return (
      name.startsWith('GoogleGenerative') ||
      name.startsWith('GoogleGenAI') ||
      /google.*generative|RESOURCE_EXHAUSTED|API key not valid/i.test(e.message)
    );
  }

  private fromGoogleAi(e: Error & { status?: number }): {
    status: number;
    body: ErrorBody;
  } {
    if (/API key not valid|API_KEY_INVALID/.test(e.message)) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'GEMINI_AUTH_FAILED',
          upstream: 'Gemini',
          message:
            'Gemini API の認証に失敗しました。.env の GEMINI_API_KEY を確認してください。',
          upstreamMessage: e.message,
        },
      };
    }
    if (/RESOURCE_EXHAUSTED|quota/i.test(e.message)) {
      return {
        status: 502,
        body: {
          statusCode: 502,
          code: 'GEMINI_QUOTA_EXHAUSTED',
          upstream: 'Gemini',
          message:
            'Gemini API のクォータを使い切りました。時間を置くか別キーに切り替えてください。',
          upstreamMessage: e.message,
        },
      };
    }
    return {
      status: 502,
      body: {
        statusCode: 502,
        code: 'GEMINI_ERROR',
        upstream: 'Gemini',
        message: `Gemini API エラー: ${e.message}`,
        upstreamMessage: e.message,
      },
    };
  }
}

interface AnthropicLikeError {
  status?: number;
  request_id?: string;
  error?: {
    error?: { type?: string; message?: string };
  };
}

interface AxiosLikeError {
  isAxiosError: true;
  message: string;
  config?: { url?: string };
  response?: { status?: number; data?: unknown };
}
