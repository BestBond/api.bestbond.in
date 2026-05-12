import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

/**
 * Comma- or space-separated list of allowed browser Origins (scheme + host + port).
 * Required for production: e.g. https://admin.bestbond.in — without it, browsers block
 * XHR/fetch from that site while curl from the server still works.
 */
function parseCorsOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS?.trim() ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prevent shared caches (CDN, browser, some proxies) from serving stale user-specific JSON.
  app.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  const allowedOrigins = parseCorsOrigins();
  const isProduction = process.env.NODE_ENV === 'production';

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
  
  const port = Number(process.env.PORT ?? 3000);
  // Bind explicitly so iOS simulator + other clients can reach it reliably.
  await app.listen(port, '0.0.0.0');
  // Helps verify the running build exposes staff routes (expect 401 without JWT, not 404).
  console.log(
    `Reward API listening on ${port} — admin dashboard: GET /admin/dashboard (Bearer + users.manage OR dealer.redemptions.manage)`,
  );
  if (!isProduction) {
    console.log(
      `CORS: non-production — allowing any http(s)://localhost or 127.0.0.1 origin (plus CORS_ORIGINS). Production requires an explicit allowlist.`,
    );
  }
}
void bootstrap();
