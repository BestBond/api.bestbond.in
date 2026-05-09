import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Prevent shared caches (CDN, browser, some proxies) from serving stale user-specific JSON.
  app.use((_, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  app.enableCors({
    origin: "http://localhost:5173", // frontend URL
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
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
}
void bootstrap();
