import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import {
  buildCouponPrintPageSvg,
  couponFrontQrPixelSize,
  type CouponFrontFaceInput,
  type CouponFrontSvgAssets,
} from './coupon-front-svg';
import {
  COUPON_H_MM,
  COUPON_W_MM,
  couponFrontsPerPrintPage,
  couponPrintPageHeightMm,
} from './coupon-print-spec';

/**
 * Coupon design SVGs live under `src/frontend_assets/svgs` and are not copied to `dist/`.
 * When running compiled code, `__dirname` is `dist/coupons`, so `../frontend_assets` is wrong.
 */
function resolveBackendSvgAssetsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'frontend_assets', 'svgs'),
    path.join(process.cwd(), 'dist', 'frontend_assets', 'svgs'),
    path.resolve(__dirname, '../../src/frontend_assets/svgs'),
    path.resolve(__dirname, '../../frontend_assets/svgs'),
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

/** Front-only coupon faces per exported PDF page (custom mm page height). */
const COUPON_BATCH_PDF_FRONTS_PER_PAGE = couponFrontsPerPrintPage();

/** Coupons per Puppeteer browser session before restart (limits VPS memory). */
function couponExportBrowserChunkSize(): number {
  const raw = process.env.COUPON_EXPORT_PDF_CHUNK_SIZE;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 35;
}

const COUPON_POINT_PALETTES = [
  { max: 10, left: '#FFFFFF', pill: '#FFFFFF' },
  { max: 20, left: '#F7E5BC', pill: '#F7E5BC' },
  { max: 30, left: '#C9E8D0', pill: '#C9E8D0' },
  { max: 40, left: '#C98245', pill: '#C98245' },
  { max: 50, left: '#E9EEF2', pill: '#F4F6F8' },
  { max: Number.POSITIVE_INFINITY, left: '#E3BD3F', pill: '#D9EBC6' },
];

function couponPaletteForPoints(points: number): { left: string; pill: string } {
  const safePoints = Number.isFinite(points) ? Math.max(0, points) : 0;
  const palette =
    COUPON_POINT_PALETTES.find((p) => safePoints <= p.max) ??
    COUPON_POINT_PALETTES[0];
  return { left: palette.left, pill: palette.pill };
}

function puppeteerPdfTimeoutMs(): number {
  const raw = process.env.PUPPETEER_PDF_TIMEOUT_MS;
  const n = raw ? Number(raw) : 180_000;
  return Number.isFinite(n) && n >= 30_000 ? Math.floor(n) : 180_000;
}

function buildCouponBatchPdfHtml(
  pageSvgHtml: string,
  couponCountOnPage: number,
): string {
  const pageH = couponPrintPageHeightMm(couponCountOnPage);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page {
        size: ${COUPON_W_MM}mm ${pageH}mm;
        margin: 0;
        background: transparent;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: ${COUPON_W_MM}mm;
        height: ${pageH}mm;
        overflow: hidden;
        background: transparent;
      }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
      .page {
        display: block;
        width: ${COUPON_W_MM}mm;
        height: ${pageH}mm;
        line-height: 0;
        font-size: 0;
        overflow: hidden;
        border-radius: 0 !important;
        background: transparent;
      }
      .page > svg {
        display: block;
        width: ${COUPON_W_MM}mm;
        height: ${pageH}mm;
        border-radius: 0 !important;
      }
    </style>
  </head>
  <body>
    <div class="page">${pageSvgHtml}</div>
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

/** Common Chromium paths on Linux VPS images (apt install chromium / chromium-browser). */
const LINUX_CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium',
];

/** Common browser paths for local development on macOS. */
const DARWIN_CHROMIUM_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function browserExecutableCandidates(): string[] {
  if (process.platform === 'linux') return LINUX_CHROMIUM_CANDIDATES;
  if (process.platform === 'darwin') return DARWIN_CHROMIUM_CANDIDATES;
  if (process.platform === 'win32') {
    return [
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          )
        : '',
      process.env.PROGRAMFILES
        ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : '',
      process.env['PROGRAMFILES(X86)']
        ? path.join(
            process.env['PROGRAMFILES(X86)'],
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          )
        : '',
    ].filter(Boolean);
  }
  return [];
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
  for (const candidate of browserExecutableCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function puppeteerUnavailableMessage(cause?: string): string {
  const hint =
    process.env.NODE_ENV === 'production'
      ? 'On the VPS, keep @sparticuz/chromium installed with npm ci, or set PUPPETEER_EXECUTABLE_PATH to a working Linux Chromium binary.'
      : 'Locally, install Google Chrome/Chromium, run `npx puppeteer browsers install chrome`, or set PUPPETEER_EXECUTABLE_PATH to a working browser binary.';
  return cause
    ? `Coupon PDF export is unavailable (${cause}). ${hint}`
    : `Coupon PDF export is unavailable. ${hint}`;
}

function shouldUseSparticuzChromium(): boolean {
  if (process.env.PUPPETEER_USE_SPARTICUZ === '0') return false;
  if (process.env.PUPPETEER_USE_SPARTICUZ === '1') return true;
  if (process.env.PUPPETEER_EXECUTABLE_PATH?.trim()) return false;
  return process.platform === 'linux' && process.env.NODE_ENV === 'production';
}

async function launchPuppeteerForPdf(
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof puppeteer.launch>>> {
  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-crash-reporter',
  ];

  if (shouldUseSparticuzChromium()) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const executablePath = await chromium.executablePath();
    return puppeteer.launch({
      headless: chromium.headless,
      executablePath,
      args: [...chromium.args, ...baseArgs],
      protocolTimeout: timeoutMs,
    });
  }

  const executablePath = resolvePuppeteerExecutablePath();
  if (!executablePath) {
    throw new ServiceUnavailableException(
      puppeteerUnavailableMessage('no Chromium/Chrome binary found'),
    );
  }

  return puppeteer.launch({
    headless: true,
    protocolTimeout: timeoutMs,
    args: baseArgs,
    executablePath,
  });
}

function isPuppeteerLaunchError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : String(err ?? '');
  return /Could not find Chrome|Failed to launch|ENOENT|browser|chromium|executable/i.test(
    msg,
  );
}

function isPuppeteerCrashError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : String(err ?? '');
  return /Target closed|Protocol error|OOM|out of memory|killed|Session closed/i.test(
    msg,
  );
}

type PuppeteerBrowser = Awaited<ReturnType<typeof puppeteer.launch>>;
type PuppeteerPage = Awaited<ReturnType<PuppeteerBrowser['newPage']>>;

async function htmlToCouponPdfBuffer(
  html: string,
  browser: PuppeteerBrowser,
  couponCountOnPage: number,
  reusePage?: PuppeteerPage | null,
): Promise<{ buffer: Uint8Array; page: PuppeteerPage }> {
  const timeoutMs = puppeteerPdfTimeoutMs();
  const pageH = couponPrintPageHeightMm(couponCountOnPage);
  const page = reusePage ?? (await browser.newPage());
  page.setDefaultTimeout(timeoutMs);
  await page.emulateMediaType('screen');
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  const buffer = await page.pdf({
    width: `${COUPON_W_MM}mm`,
    height: `${pageH}mm`,
    printBackground: true,
    omitBackground: true,
    preferCSSPageSize: false,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
  });
  return { buffer, page };
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
      'RewardSystemMobile',
      'src',
      'assets',
      'svgs',
      'originals',
    );

    const couponFrontManLogoSvg = readFirstExisting([
      ...couponBestBondManSvgPaths(),
      path.join(backendAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(mobileAppAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(appAssetsDir, 'coupon_front_man_logo.svg'),
    ]);

    const couponPhoneScanSvg = readFirstExisting([
      path.join(backendAssetsDir, 'coupon_phone_scan.svg'),
      path.join(mobileAppAssetsDir, 'coupon_phone_scan.svg'),
      path.join(appAssetsDir, 'coupon_phone_scan.svg'),
    ]);

    const toSvgDataUri = (svg: string) => {
      // If the SVG is just a wrapper for a base64 PNG, extract the PNG to avoid double-encoding blur.
      const pngMatch = svg.match(/xlink:href="data:image\/png;base64,([^"]+)"/);
      if (pngMatch && pngMatch[1]) {
        return `data:image/png;base64,${pngMatch[1]}`;
      }

      const cleaned = svg
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/g, '')
        .trim();
      const b64 = Buffer.from(cleaned, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${b64}`;
    };

    const assets: CouponFrontSvgAssets = {
      couponFrontManLogoUri: toSvgDataUri(couponFrontManLogoSvg),
      couponPhoneScanUri: toSvgDataUri(couponPhoneScanSvg),
    };

    const buildFacesForSlice = async (
      slice: typeof coupons,
      globalOffset: number,
      idPrefix: string,
    ): Promise<CouponFrontFaceInput[]> => {
      const qrCodes = await Promise.all(
        slice.map((c) =>
          QRCode.toDataURL(String(c.code), {
            margin: 0,
            width: 384,
            color: { dark: '#1F2937', light: '#FFFFFF' },
          }),
        ),
      );
      return slice.map((c, j) => ({
        code: String(c.code),
        points: Number(c.points ?? 0),
        qrDataUrl: qrCodes[j],
        idSuffix: `${idPrefix}${globalOffset + j}`,
      }));
    };

    const browserChunkSize = couponExportBrowserChunkSize();
    const timeoutMs = puppeteerPdfTimeoutMs();
    const pdfParts: Uint8Array[] = [];

    for (
      let chunkStart = 0;
      chunkStart < coupons.length;
      chunkStart += browserChunkSize
    ) {
      const couponChunk = coupons.slice(
        chunkStart,
        chunkStart + browserChunkSize,
      );
      const printPages: { svg: string; count: number }[] = [];
      for (
        let pageStart = 0;
        pageStart < couponChunk.length;
        pageStart += COUPON_BATCH_PDF_FRONTS_PER_PAGE
      ) {
        const slice = couponChunk.slice(
          pageStart,
          pageStart + COUPON_BATCH_PDF_FRONTS_PER_PAGE,
        );
        const faces = await buildFacesForSlice(
          slice,
          chunkStart + pageStart,
          'f',
        );
        printPages.push({
          svg: buildCouponPrintPageSvg(faces, assets),
          count: slice.length,
        });
      }

      const browser = await launchPuppeteerForPdf(timeoutMs);
      let pdfPage: PuppeteerPage | null = null;
      try {
        for (const printPage of printPages) {
          const html = buildCouponBatchPdfHtml(printPage.svg, printPage.count);
          try {
            const { buffer, page } = await htmlToCouponPdfBuffer(
              html,
              browser,
              printPage.count,
              pdfPage,
            );
            pdfPage = page;
            pdfParts.push(buffer);
          } catch (pdfErr) {
            if (isPuppeteerCrashError(pdfErr)) {
              throw new ServiceUnavailableException(
                'Coupon PDF export ran out of memory. Wait a moment and try again, or export a smaller batch.',
              );
            }
            throw pdfErr;
          }
        }
      } finally {
        if (pdfPage) await pdfPage.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    }
    return mergeCouponPdfBuffers(pdfParts);
  }

  async exportBatchPreviewHtml(params: { batchId: string }) {
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

    const backendAssetsDir = resolveBackendSvgAssetsDir();
    const backendRoot = path.resolve(__dirname, '../../..');
    const repoRoot = path.resolve(backendRoot, '..');
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
      'RewardSystemMobile',
      'src',
      'assets',
      'svgs',
      'originals',
    );

    const couponFrontManLogoSvg = readFirstExisting([
      ...couponBestBondManSvgPaths(),
      path.join(backendAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(mobileAppAssetsDir, 'coupon_front_man_logo.svg'),
      path.join(appAssetsDir, 'coupon_front_man_logo.svg'),
    ]);

    const couponPhoneScanSvg = readFirstExisting([
      path.join(backendAssetsDir, 'coupon_phone_scan.svg'),
      path.join(mobileAppAssetsDir, 'coupon_phone_scan.svg'),
      path.join(appAssetsDir, 'coupon_phone_scan.svg'),
    ]);

    const toSvgDataUri = (svg: string) => {
      const pngMatch = svg.match(/xlink:href="data:image\/png;base64,([^"]+)"/);
      if (pngMatch && pngMatch[1]) {
        return `data:image/png;base64,${pngMatch[1]}`;
      }

      const cleaned = svg
        .replace(/<\?xml[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/g, '')
        .trim();
      const b64 = Buffer.from(cleaned, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${b64}`;
    };

    const assets: CouponFrontSvgAssets = {
      couponFrontManLogoUri: toSvgDataUri(couponFrontManLogoSvg),
      couponPhoneScanUri: toSvgDataUri(couponPhoneScanSvg),
    };

    const pageBlocks: string[] = [];
    for (
      let pageStart = 0;
      pageStart < coupons.length;
      pageStart += COUPON_BATCH_PDF_FRONTS_PER_PAGE
    ) {
      const slice = coupons.slice(
        pageStart,
        pageStart + COUPON_BATCH_PDF_FRONTS_PER_PAGE,
      );
      const faces: CouponFrontFaceInput[] = [];
      for (let j = 0; j < slice.length; j++) {
        const c = slice[j];
        const code = String(c.code);
        const points = Number(c.points ?? 0);
        const qr = await QRCode.toDataURL(code, {
          margin: 0,
          width: 520,
          color: { dark: '#1F2937', light: '#FFFFFF' },
        });
        faces.push({
          code,
          points,
          qrDataUrl: qr,
          idSuffix: `pv${pageStart + j}`,
        });
      }
      pageBlocks.push(
        `<div class="print-page">${buildCouponPrintPageSvg(faces, assets)}</div>`,
      );
    }

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        margin: 0;
        padding: 24px;
        background: #151515;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      }
      .preview-stack {
        display: flex;
        flex-direction: column;
        gap: 32px;
        align-items: center;
        margin: 0 auto;
      }
      .print-page {
        display: block;
        line-height: 0;
        font-size: 0;
        background: transparent;
      }
      .print-page > svg {
        display: block;
        max-width: min(101mm, 100%);
        height: auto;
      }
    </style>
  </head>
  <body>
    <div class="preview-stack">
      ${pageBlocks.join('\n')}
    </div>
  </body>
</html>`;
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
