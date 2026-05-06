import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { Request } from 'express';

@Injectable()
export class OidcAuthGuard implements CanActivate {
  private readonly logger = new Logger(OidcAuthGuard.name);
  private readonly client = new OAuth2Client();

  constructor(private readonly configService: ConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.configService.get<string>('OIDC_BYPASS') === 'true') {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const token = m[1];

    const audience = this.configService.get<string>('OIDC_AUDIENCE');
    if (!audience) {
      throw new UnauthorizedException('OIDC_AUDIENCE is not configured');
    }

    let email: string | undefined;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException('Empty OIDC payload');
      }
      email = typeof payload.email === 'string' ? payload.email : undefined;
    } catch (err) {
      this.logger.warn(`OIDC verify failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid OIDC token');
    }

    const allowedEmails = (
      this.configService.get<string>('OIDC_ALLOWED_EMAILS') ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedEmails.length > 0) {
      if (!email || !allowedEmails.includes(email)) {
        throw new UnauthorizedException(
          `Caller ${email ?? '(no email)'} not allowed`,
        );
      }
    }

    return true;
  }
}
