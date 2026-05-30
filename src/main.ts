import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

function resolveGiftAssetsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'dist', 'rewards', 'assets', 'gifts'),
    path.join(process.cwd(), 'src', 'rewards', 'assets', 'gifts'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Comma- or space-separated list of allowed browser Origins (scheme + host + port).
 * Required for production: e.g. https://admin.bestbond.in — without it, browsers block
 * XHR/fetch from that site while curl from the server still works.
 */
const DEV_CORS_FALLBACK =
  'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  const isProduction = process.env.NODE_ENV === 'production';
  if (!raw) {
    if (isProduction) {
      throw new Error(
        'CORS_ORIGINS must be set in production (comma-separated HTTPS origins for the admin UI).',
      );
    }
    return DEV_CORS_FALLBACK.split(/[, \n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw
    .split(/[, \n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Browsers send Origin per scheme+host+port — 5173 vs 5174 are different origins. */
function isLocalDevBrowserOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const cors = process.env.CORS_ORIGINS?.trim();
  if (!cors) {
    throw new Error(
      'CORS_ORIGINS must be set in production (comma-separated admin site origins).',
    );
  }
  const jwt = process.env.JWT_SECRET?.trim();
  if (!jwt || jwt === 'dev-secret' || jwt.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a strong value (32+ characters, not dev-secret) in production.',
    );
  }
}

async function bootstrap() {
  assertProductionEnv();

  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    logger: isProduction ? ['error', 'warn', 'log'] : undefined,
  });

  if (process.env.TRUST_PROXY === '1') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Prevent shared caches (CDN, browser, some proxies) from serving stale user-specific JSON.
  app.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  const allowedOrigins = parseCorsOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      // curl / server-side / mobile apps often omit Origin
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Non-production: any Vite / local UI port on loopback (avoids CORS whack-a-mole).
      if (!isProduction && isLocalDevBrowserOrigin(origin)) {
        callback(null, true);
        return;
      }
      // Deny — browser shows a CORS error; do not throw (avoids 500 on preflight).
      callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const giftsDir = resolveGiftAssetsDir();
  if (giftsDir) {
    app.use(
      '/gifts',
      express.static(giftsDir, {
        maxAge: isProduction ? '7d' : 0,
        fallthrough: false,
      }),
    );
  }

  const port = Number(process.env.PORT ?? 3000);
  // Bind explicitly so iOS simulator + other clients can reach it reliably.
  await app.listen(port);
  // Helps verify the running build exposes staff routes (expect 401 without JWT, not 404).
  console.log(
    `Reward API listening on ${port} — health: GET /health — admin: GET /admin/dashboard`,
  );
  if (!isProduction) {
    console.log(
      `CORS: non-production — allowing any http(s)://localhost or 127.0.0.1 origin (plus CORS_ORIGINS). Production requires an explicit allowlist.`,
    );
  }
}
void bootstrap();
