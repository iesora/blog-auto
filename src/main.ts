import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

function basicAuthMiddleware(username: string, password: string) {
  const expectedUser = Buffer.from(username, 'utf-8');
  const expectedPass = Buffer.from(password, 'utf-8');

  // API のたたきは Basic 認証を通さない（画面の保護のみが目的）
  const apiPrefixes = ['/wordpress', '/blog-generator', '/schedules'];

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      apiPrefixes.some(
        (p) => req.path === p || req.path.startsWith(`${p}/`),
      )
    ) {
      return next();
    }

    const header = req.headers.authorization ?? '';
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (match) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      const userBuf = Buffer.from(user, 'utf-8');
      const passBuf = Buffer.from(pass, 'utf-8');
      if (
        userBuf.length === expectedUser.length &&
        passBuf.length === expectedPass.length &&
        timingSafeEqual(userBuf, expectedUser) &&
        timingSafeEqual(passBuf, expectedPass)
      ) {
        return next();
      }
    }

    res.setHeader(
      'WWW-Authenticate',
      'Basic realm="blog-auto", charset="UTF-8"',
    );
    res.status(401).send('Authentication required');
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (username && password) {
    app.use(basicAuthMiddleware(username, password));
  } else {
    new Logger('Bootstrap').warn(
      'BASIC_AUTH_USERNAME / BASIC_AUTH_PASSWORD are not set. Basic authentication is disabled.',
    );
  }

  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
