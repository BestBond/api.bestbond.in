import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Coupon } from './entities/coupon.entity';
import { randomBytes, randomUUID } from 'crypto';
import { PointsService } from '../points/points.service';
import { User } from '../users/entities/user.entity';
import type { FindOptionsWhere } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

/**
 * Coupon design SVGs live under `src/frontend_assets/svgs` and are not copied to `dist/`.
 * When running compiled code, `__dirname` is `dist/coupons`, so `../frontend_assets` is wrong.
 */
function resolveBackendSvgAssetsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'frontend_assets', 'svgs'),
    path.resolve(__dirname, '../../src/frontend_assets/svgs'),
    path.resolve(__dirname, '../frontend_assets/svgs'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

/** Best Bond man mark for coupon PDF (vector wrapper or raster-in-SVG). */
function couponBestBondManSvgPaths(): string[] {
  return [
    path.join(process.cwd(), 'src', 'coupons', 'assets', 'BestBondman.svg'),
    path.resolve(__dirname, '../../src/coupons/assets/BestBondman.svg'),
    path.resolve(__dirname, 'assets/BestBondman.svg'),
  ];
}

function sanitizeSvgMarkup(svg: string): string {
  const cleaned = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .trim();

  // Force responsive sizing so the SVG fills the face container.
  // We keep its viewBox (already present in our assets).
  return cleaned.replace(
    /<svg\b([^>]*)>/i,
    (m, attrs) =>
      `<svg${attrs} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`,
  );
}

function wrapSvgWithBackground(params: {
  svg: string;
  viewBox: string;
  background: string;
}): string {
  const cleaned = params.svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .trim();

  // Remove outer <svg ...> ... </svg> so we can draw a background behind it.
  const inner = cleaned
    .replace(/^\s*<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  return `
    <svg viewBox="${params.viewBox}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="100%" height="100%" fill="${params.background}" />
      ${inner}
    </svg>
  `.trim();
}

/** Limits Chromium memory per pass; merged into one PDF. */
function couponExportPdfChunkSize(): number {
  const raw = process.env.COUPON_EXPORT_PDF_CHUNK_SIZE;
  const n = raw ? Number(raw) : 20;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 20;
}

/** Front-only coupon faces per A4 page (print export). */
const COUPON_BATCH_PDF_FRONTS_PER_PAGE = 3;

function puppeteerPdfTimeoutMs(): number {
  const raw = process.env.PUPPETEER_PDF_TIMEOUT_MS;
  const n = raw ? Number(raw) : 180_000;
  return Number.isFinite(n) && n >= 30_000 ? Math.floor(n) : 180_000;
}

function buildCouponBatchPdfHtml(innerPagesHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4; margin: 10mm; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
      .page {
        page-break-after: always;
        display: flex;
        flex-direction: column;
        gap: 8mm;
        align-items: center;
      }
      .face { display: block; border-radius: 10mm; overflow: hidden; flex-shrink: 0; }
    </style>
  </head>
  <body>
${innerPagesHtml}
  </body>
</html>`;
}

async function mergeCouponPdfBuffers(parts: Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 0) throw new Error('No PDF chunks produced');
  if (parts.length === 1) return parts[0];
  const merged = await PDFDocument.create();
  for (const raw of parts) {
    const doc = await PDFDocument.load(raw);
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  return new Uint8Array(await merged.save());
}

function resolvePuppeteerExecutablePath(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    /* puppeteer may throw if browser not installed */
  }
  return undefined;
}

async function htmlToCouponPdfBuffer(html: string): Promise<Uint8Array> {
  const timeoutMs = puppeteerPdfTimeoutMs();
  const launchOpts = {
    headless: true,
    protocolTimeout: timeoutMs,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-crash-reporter',
    ],
  };

  const executablePath = resolvePuppeteerExecutablePath();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch(
      executablePath
        ? { ...launchOpts, executablePath }
        : { ...launchOpts },
    );
  } catch (firstErr) {
    if (executablePath) {
      browser = await puppeteer.launch({ ...launchOpts });
    } else {
      throw firstErr;
    }
  }
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

@Injectable()
export class CouponsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Coupon) private readonly couponsRepo: Repository<Coupon>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly points: PointsService,
  ) {}

  async generate(params: {
    createdByUserId: string;
    title: string;
    points: number;
    quantity: number;
    site?: string | null;
    expiresAt?: Date | null;
  }) {
    const createdBy = await this.usersRepo.findOne({
      where: { id: params.createdByUserId },
    });
    if (!createdBy) throw new NotFoundException('Creator user not found');

    const batchId = randomUUID();
    const raw = await this.couponsRepo
      .createQueryBuilder('c')
      .select('MAX(c.batchNumber)', 'max')
      .getRawOne<{ max: number | null }>();
    const batchNumber = Number(raw?.max ?? 0) + 1;

    const coupons: Coupon[] = [];
    for (let i = 0; i < params.quantity; i++) {
      coupons.push(
        this.couponsRepo.create({
          batchId,
          batchNumber,
          code: this.generateCode(),
          title: params.title,
          points: params.points,
          site: params.site ?? null,
          status: 'ACTIVE',
          expiresAt: params.expiresAt ?? null,
          createdBy,
          redeemedBy: null,
          redeemedAt: null,
        }),
      );
    }

    // Insert in one go
    const saved = await this.couponsRepo.save(coupons);
    const createdAt = saved[0]?.createdAt ?? new Date();
    const previewCodes = saved.slice(0, Math.min(20, saved.length)).map((c) => c.code);

    return {
      batchId,
      batchNumber,
      createdAt,
      quantity: saved.length,
      title: params.title,
      points: params.points,
      site: params.site ?? null,
      expiresAt: params.expiresAt ?? null,
      previewCodes,
      items: saved.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        points: c.points,
        site: c.site,
        status: c.status,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        batchId: c.batchId,
        batchNumber: c.batchNumber,
      })),
    };
  }

  async list(params: { status?: string; take?: number }) {
    const take = params.take ?? 50;
    const where: FindOptionsWhere<Coupon> = params.status
      ? { status: params.status as Coupon['status'] }
      : {};
    return this.couponsRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(500, take)),
    });
  }

  async listBatches(params?: { take?: number; offset?: number }) {
    const take = Math.max(1, Math.min(100, Number(params?.take ?? 20)));
    const offset = Math.max(0, Math.min(10_000, Number(params?.offset ?? 0)));

    // SQLite grouping: pick min(createdAt) as createdAt and max(points/title/site/expiresAt) as representative.
    // All coupons in a batch share the same points/title/site/expiresAt from generation call.
    const qb = this.couponsRepo
      .createQueryBuilder('c')
      .select('c.batchId', 'batchId')
      .addSelect('MAX(c.batchNumber)', 'batchNumber')
      .addSelect('MIN(c.createdAt)', 'createdAt')
      .addSelect('COUNT(1)', 'totalCoupons')
      .addSelect(
        'COALESCE(SUM(CASE WHEN c.status = :active THEN 1 ELSE 0 END), 0)',
        'activeCount',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN c.status = :redeemed THEN 1 ELSE 0 END), 0)',
        'redeemedCount',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN c.status = :expired THEN 1 ELSE 0 END), 0)',
        'expiredCount',
      )
      .addSelect('MAX(c.points)', 'points')
      .addSelect('MAX(c.title)', 'title')
      .addSelect('MAX(c.site)', 'site')
      .addSelect('MAX(c.expiresAt)', 'expiresAt')
      .where('c.batchId IS NOT NULL')
      .setParameters({ active: 'ACTIVE', redeemed: 'REDEEMED', expired: 'EXPIRED' })
      .groupBy('c.batchId')
      .orderBy('createdAt', 'DESC')
      .offset(offset)
      .limit(take);

    const rows = await qb.getRawMany<{
      batchId: string;
      batchNumber: string | number | null;
      createdAt: string;
      totalCoupons: string;
      activeCount: string;
      redeemedCount: string;
      expiredCount: string;
      points: string;
      title: string;
      site: string | null;
      expiresAt: string | null;
    }>();

    return {
      hasMore: rows.length === take,
      items: rows.map((r) => {
        const points = Number(r.points ?? 0);
        const totalCoupons = Number(r.totalCoupons ?? 0);
        return {
          batchId: r.batchId,
          batchNumber: r.batchNumber != null ? Number(r.batchNumber) : null,
          createdAt: r.createdAt,
          totalCoupons,
          totalValuePoints: points * totalCoupons,
          slabPoints: points,
          title: r.title,
          site: r.site ?? null,
          expiresAt: r.expiresAt ?? null,
          counts: {
            active: Number(r.activeCount ?? 0),
            redeemed: Number(r.redeemedCount ?? 0),
            expired: Number(r.expiredCount ?? 0),
          },
        };
      }),
    };
  }

  async listBatchCoupons(params: {
    batchId: string;
    status?: string;
    take?: number;
    offset?: number;
  }) {
    const take = Math.max(1, Math.min(500, Number(params.take ?? 50)));
    const offset = Math.max(0, Math.min(50_000, Number(params.offset ?? 0)));
    const batchId = params.batchId.trim();
    if (!batchId) throw new BadRequestException('Invalid batch id');

    const where: FindOptionsWhere<Coupon> = { batchId };
    if (params.status) where.status = params.status as Coupon['status'];

    const rows = await this.couponsRepo.find({
      where,
      order: { createdAt: 'ASC' },
      take,
      skip: offset,
    });
    return {
      hasMore: rows.length === take,
      items: rows.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        points: c.points,
        site: c.site,
        status: c.status,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        batchId: c.batchId,
        batchNumber: c.batchNumber,
      })),
    };
  }

  async exportBatchPdf(params: { batchId: string }) {
    const batchId = params.batchId.trim();
    if (!batchId) throw new BadRequestException('Invalid batch id');

    const coupons = await this.couponsRepo.find({
      where: { batchId },
      order: { createdAt: 'ASC' },
      take: 50_000,
    });
    if (coupons.length === 0) throw new NotFoundException('Batch not found');

    const readFirstExisting = (paths: string[]) => {
      for (const p of paths) {
        try {
          if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
        } catch {
          /* try next */
        }
      }
      throw new NotFoundException(
        `Coupon export assets missing. Tried: ${paths.join(', ')}`,
      );
    };

    // Prefer backend-hosted design assets; fall back to app assets if needed.
    const backendAssetsDir = resolveBackendSvgAssetsDir();
    const backendRoot = path.resolve(__dirname, '../../..'); // <repo>/reward-system-backend
    const repoRoot = path.resolve(backendRoot, '..'); // <repo>
    const appAssetsDir = path.resolve(
      repoRoot,
      'RewardSystem',
      'RewardSystem',
      'src',
      'assets',
      'svgs',
      'originals',
    );
    const mobileAppAssetsDir = path.resolve(
      repoRoot,
      'BestBond',
      'src',
      'assets',
      'svgs',
      'originals',
    );

    const couponPhoneScanSvg = readFirstExisting([
      path.join(backendAssetsDir, 'coupon_phone_scan.svg'),
      path.join(mobileAppAssetsDir, 'coupon_phone_scan.svg'),
      path.join(appAssetsDir, 'coupon_phone_scan.svg'),
    ]);
    const couponFrontManLogoSvg = readFirstExisting([
      ...couponBestBondManSvgPaths(),
      path.join(backendAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(mobileAppAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(appAssetsDir, 'coupon_front_man_logo.svg'),
    ]);

    // Render at the exact design canvas size (660x245), then scale in mm for A4.
    const DESIGN_W = 660;
    const DESIGN_H = 245;
    const faceWmm = 180;
    const faceHmm = (faceWmm * DESIGN_H) / DESIGN_W;

    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const fmtPoints = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 });

    const toSvgDataUri = (svg: string) => {
      const cleaned = svg
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/g, '')
        .trim();
      const b64 = Buffer.from(cleaned, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${b64}`;
    };

    const couponPhoneScanUri = toSvgDataUri(couponPhoneScanSvg);
    const couponFrontManLogoUri = toSvgDataUri(couponFrontManLogoSvg);

    const renderFrontSvg = (params: {
      code: string;
      points: number;
      qrDataUrl: string;
      idSuffix: string;
    }) => {
      const code = params.code;
      const points = params.points;
      const qr = params.qrDataUrl;
      const sid = params.idSuffix.replace(/[^a-zA-Z0-9_]/g, '_');

      // New front design (from provided image): white left, orange right, centered pill, subtitle, top-right man+logo.
      const LEFT_W = 220;
      const RIGHT_X = LEFT_W;
      const RIGHT_W = DESIGN_W - LEFT_W;

      const iconW = 28;
      const iconX = Math.round((LEFT_W - iconW) / 2);
      const iconY = 14;
      const qrSize = 150;
      const qrX = Math.round((LEFT_W - qrSize) / 2);
      const qrY = iconY + iconW + 10;
      const idY = qrY + qrSize + 14;

      const pillW = 330;
      const pillH = 74;
      const pillX = Math.round(RIGHT_X + (RIGHT_W - pillW) / 2);
      const pillY = 76;
      const pillR = Math.round(pillH / 2);

      // Logo asset is 68×101 (portrait); avoid square 52×52 to reduce raster blur in PDF.
      const logoW = 50;
      const logoH = 75;
      const logoPad = 10;
      const logoX = DESIGN_W - logoW - logoPad;
      const logoY = 12;

      return `
        <svg viewBox="0 0 ${DESIGN_W} ${DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="c_${sid}">
              <rect x="0" y="0" width="${DESIGN_W}" height="${DESIGN_H}" rx="26" ry="26" />
            </clipPath>
            <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="0" x2="${DESIGN_W}" y2="245" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#F97316"/>
              <stop offset="1" stop-color="#EA6A12"/>
            </linearGradient>
          </defs>
          <g clip-path="url(#c_${sid})">
            <rect x="0" y="0" width="${DESIGN_W}" height="${DESIGN_H}" fill="#FFFFFF" />
            <rect x="${RIGHT_X}" y="0" width="${RIGHT_W}" height="${DESIGN_H}" fill="url(#g_${sid})" />

            <!-- subtle texture-ish overlay (keeps it pure SVG) -->
            <path d="M${RIGHT_X + 40} 18C${RIGHT_X + 80} 50 ${RIGHT_X + 150} 78 ${RIGHT_X + 240} 96C${RIGHT_X + 315} 111 ${RIGHT_X + 365} 132 ${RIGHT_X + 420} 162V0H${RIGHT_X}v245h${RIGHT_W}v-26c-62-8-126-30-190-66C${RIGHT_X + 140} 126 ${RIGHT_X + 80} 72 ${RIGHT_X + 40} 18Z" fill="#000" opacity="0.06"/>

            <!-- Left: phone scan icon -->
            <image href="${couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconW}" />

            <!-- Left: coupon QR -->
            <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />

            <!-- Left: ID label -->
            <text x="${Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="13" font-weight="700" fill="#6B7280">ID: ${escapeHtml(code)}</text>

            <!-- Right: Best Bond man mark (prefer src/coupons/assets/BestBondman.svg) -->
            <image href="${couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />

            <!-- Center pill -->
            <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}" fill="#FFFFFF" />
            <text x="${pillX + Math.round(pillW / 2)}" y="${pillY + 50}" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="36" font-weight="900" fill="#1F2937">${escapeHtml(fmtPoints(points))} Points</text>

            <!-- Subtitle -->
            <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="198" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="14" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
          </g>
        </svg>
      `;
    };

    const couponPages: string[] = [];
    for (
      let pageStart = 0;
      pageStart < coupons.length;
      pageStart += COUPON_BATCH_PDF_FRONTS_PER_PAGE
    ) {
      const slice = coupons.slice(
        pageStart,
        pageStart + COUPON_BATCH_PDF_FRONTS_PER_PAGE,
      );
      const faces: string[] = [];
      for (let j = 0; j < slice.length; j++) {
        const c = slice[j];
        const code = String(c.code);
        const points = Number(c.points ?? 0);
        const qr = await QRCode.toDataURL(code, { margin: 0, width: 520 });
        const idSuffix = `f${pageStart + j}`;
        faces.push(`<div class="face" style="width:${faceWmm}mm;height:${faceHmm}mm;">
            ${renderFrontSvg({ code, points, qrDataUrl: qr, idSuffix })}
          </div>`);
      }
      couponPages.push(`<div class="page">\n${faces.join('\n')}\n</div>`);
    }

    const chunkSize = couponExportPdfChunkSize();
    const pdfParts: Uint8Array[] = [];
    for (let offset = 0; offset < couponPages.length; offset += chunkSize) {
      const slice = couponPages.slice(offset, offset + chunkSize);
      const html = buildCouponBatchPdfHtml(slice.join(''));
      pdfParts.push(await htmlToCouponPdfBuffer(html));
    }
    return mergeCouponPdfBuffers(pdfParts);
  }

  async exportBatchPreviewHtml(params: {
    batchId: string;
    index?: number;
    perPage?: number;
  }) {
    const batchId = params.batchId.trim();
    if (!batchId) throw new BadRequestException('Invalid batch id');

    const coupons = await this.couponsRepo.find({
      where: { batchId },
      order: { createdAt: 'ASC' },
      take: 50_000,
    });
    if (coupons.length === 0) throw new NotFoundException('Batch not found');

    const index =
      params.index != null && Number.isFinite(params.index)
        ? Math.max(0, Math.floor(params.index))
        : 0;
    const perPage =
      params.perPage != null && Number.isFinite(params.perPage)
        ? Math.max(1, Math.min(6, Math.floor(params.perPage)))
        : COUPON_BATCH_PDF_FRONTS_PER_PAGE;

    const slice = coupons.slice(index, index + perPage);

    const readFirstExisting = (paths: string[]) => {
      for (const p of paths) {
        try {
          if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
        } catch {
          /* try next */
        }
      }
      throw new NotFoundException(
        `Coupon export assets missing. Tried: ${paths.join(', ')}`,
      );
    };

    const backendAssetsDir = resolveBackendSvgAssetsDir();
    const backendRoot = path.resolve(__dirname, '../../..'); // <repo>/reward-system-backend
    const repoRoot = path.resolve(backendRoot, '..'); // <repo>
    const appAssetsDir = path.resolve(
      repoRoot,
      'RewardSystem',
      'RewardSystem',
      'src',
      'assets',
      'svgs',
      'originals',
    );
    const mobileAppAssetsDir = path.resolve(
      repoRoot,
      'BestBond',
      'src',
      'assets',
      'svgs',
      'originals',
    );

    const couponPhoneScanSvg = readFirstExisting([
      path.join(backendAssetsDir, 'coupon_phone_scan.svg'),
      path.join(mobileAppAssetsDir, 'coupon_phone_scan.svg'),
      path.join(appAssetsDir, 'coupon_phone_scan.svg'),
    ]);
    const couponFrontManLogoSvg = readFirstExisting([
      ...couponBestBondManSvgPaths(),
      path.join(backendAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(mobileAppAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(appAssetsDir, 'coupon_front_man_logo.svg'),
    ]);

    const DESIGN_W = 660;
    const DESIGN_H = 245;

    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const fmtPoints = (n: number) =>
      n.toLocaleString('en-US', { maximumFractionDigits: 0 });

    const toSvgDataUri = (svg: string) => {
      const cleaned = svg
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/g, '')
        .trim();
      const b64 = Buffer.from(cleaned, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${b64}`;
    };

    const couponPhoneScanUri = toSvgDataUri(couponPhoneScanSvg);
    const couponFrontManLogoUri = toSvgDataUri(couponFrontManLogoSvg);

    const renderFrontSvg = (p: {
      code: string;
      points: number;
      qrDataUrl: string;
      idSuffix: string;
    }) => {
      const code = p.code;
      const points = p.points;
      const qr = p.qrDataUrl;
      const sid = p.idSuffix.replace(/[^a-zA-Z0-9_]/g, '_');
      const LEFT_W = 220;
      const RIGHT_X = LEFT_W;
      const RIGHT_W = DESIGN_W - LEFT_W;
      const iconW = 28;
      const iconX = Math.round((LEFT_W - iconW) / 2);
      const iconY = 14;
      const qrSize = 150;
      const qrX = Math.round((LEFT_W - qrSize) / 2);
      const qrY = iconY + iconW + 10;
      const idY = qrY + qrSize + 14;
      const pillW = 330;
      const pillH = 74;
      const pillX = Math.round(RIGHT_X + (RIGHT_W - pillW) / 2);
      const pillY = 76;
      const pillR = Math.round(pillH / 2);
      const logoW = 50;
      const logoH = 75;
      const logoPad = 10;
      const logoX = DESIGN_W - logoW - logoPad;
      const logoY = 12;
      return `
        <svg viewBox="0 0 ${DESIGN_W} ${DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="c_${sid}">
              <rect x="0" y="0" width="${DESIGN_W}" height="${DESIGN_H}" rx="26" ry="26" />
            </clipPath>
            <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="0" x2="${DESIGN_W}" y2="245" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#F97316"/>
              <stop offset="1" stop-color="#EA6A12"/>
            </linearGradient>
          </defs>
          <g clip-path="url(#c_${sid})">
            <rect x="0" y="0" width="${DESIGN_W}" height="${DESIGN_H}" fill="#FFFFFF" />
            <rect x="${RIGHT_X}" y="0" width="${RIGHT_W}" height="${DESIGN_H}" fill="url(#g_${sid})" />
            <path d="M${RIGHT_X + 40} 18C${RIGHT_X + 80} 50 ${RIGHT_X + 150} 78 ${RIGHT_X + 240} 96C${RIGHT_X + 315} 111 ${RIGHT_X + 365} 132 ${RIGHT_X + 420} 162V0H${RIGHT_X}v245h${RIGHT_W}v-26c-62-8-126-30-190-66C${RIGHT_X + 140} 126 ${RIGHT_X + 80} 72 ${RIGHT_X + 40} 18Z" fill="#000" opacity="0.06"/>
            <image href="${couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconW}" />
            <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
            <text x="${Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="13" font-weight="700" fill="#6B7280">ID: ${escapeHtml(code)}</text>
            <image href="${couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />
            <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}" fill="#FFFFFF" />
            <text x="${pillX + Math.round(pillW / 2)}" y="${pillY + 50}" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="36" font-weight="900" fill="#1F2937">${escapeHtml(fmtPoints(points))} Points</text>
            <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="198" text-anchor="middle"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
              font-size="14" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
          </g>
        </svg>
      `;
    };

    const blocks: string[] = [];
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      const code = String(c.code);
      const points = Number(c.points ?? 0);
      const qr = await QRCode.toDataURL(code, { margin: 0, width: 520 });
      const idSuffix = `pv${index + i}`;
      blocks.push(
        `<div class="face">${renderFrontSvg({ code, points, qrDataUrl: qr, idSuffix })}</div>`,
      );
    }

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { margin: 0; padding: 24px; background: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
            .preview-stack { display: flex; flex-direction: column; gap: 20px; align-items: flex-start; max-width: 660px; margin: 0 auto; }
            .face { width: 660px; height: 245px; border-radius: 26px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.12); background: #fff; }
          </style>
        </head>
        <body>
          <div class="preview-stack">
          ${blocks.join('')}
          </div>
        </body>
      </html>
    `;
  }

  async redeem(params: { userId: string; userRoles: string[]; code: string }) {
    const code = params.code.trim();
    if (!code) throw new BadRequestException('Invalid code');

    const roleNames = new Set((params.userRoles ?? []).map((r) => String(r).toUpperCase()));
    const isCustomer = roleNames.has('CUSTOMER');
    const isDealer = roleNames.has('DEALER');
    // Customers (and optionally dealers) can scan coupons; staff/admin must not.
    if (!isCustomer && !isDealer) {
      throw new ForbiddenException('Only customer accounts can redeem coupons');
    }

    return this.dataSource.transaction(async (manager) => {
      const couponRepo = manager.getRepository(Coupon);
      const userRepo = manager.getRepository(User);

      const coupon = await couponRepo.findOne({ where: { code } });
      if (!coupon) throw new NotFoundException('Coupon not found');

      if (coupon.status !== 'ACTIVE') {
        throw new ForbiddenException('Coupon already used or inactive');
      }

      if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
        coupon.status = 'EXPIRED';
        await couponRepo.save(coupon);
        throw new ForbiddenException('Coupon expired');
      }

      const user = await userRepo.findOne({ where: { id: params.userId } });
      if (!user) throw new NotFoundException('User not found');

      const redeemedAt = new Date();
      const reserve = await couponRepo
        .createQueryBuilder()
        .update(Coupon)
        .set({ status: 'REDEEMED', redeemedAt })
        .where('id = :id', { id: coupon.id })
        .andWhere('status = :active', { active: 'ACTIVE' })
        .execute();
      if (!reserve.affected) {
        throw new ForbiddenException('Coupon already used or inactive');
      }
      coupon.status = 'REDEEMED';
      coupon.redeemedBy = user;
      coupon.redeemedAt = redeemedAt;
      await couponRepo.save(coupon);

      // Credit points + create transaction record
      const result = await this.points.creditWithManager(manager, {
        userId: user.id,
        points: coupon.points,
        title: coupon.title,
        site: coupon.site,
        type: 'COUPON_SCAN',
      });

      return {
        pointsAdded: coupon.points,
        newTotalBalance: result.user.loyaltyPoints,
        title: coupon.title,
        site: coupon.site,
      };
    });
  }

  private generateCode(): string {
    // Short, user-friendly coupon code (uppercase hex).
    return randomBytes(6).toString('hex').toUpperCase(); // 12 chars
  }
}
