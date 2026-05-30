import { getCouponTierTheme } from './coupon-tiers';
import {
  COUPON_DESIGN_H,
  COUPON_DESIGN_W,
  COUPON_H_MM,
  COUPON_INNER_H,
  COUPON_INNER_W,
  COUPON_SAFE_INSET_U,
  COUPON_V_GAP_MM,
  COUPON_V_GAP_U,
  COUPON_W_MM,
} from './coupon-print-spec';

/** Canonical coupon artboard (AdminCouponPreviewScreen / print reference). */
const DESIGN_W = 660;
const DESIGN_H = 245;
const DESIGN_LEFT_W = 220;
const DESIGN_RIGHT_W = 440;

export const COUPON_ASSET_SCAN_ID = 'couponAssetScan';
export const COUPON_ASSET_LOGO_ID = 'couponAssetLogo';

export type CouponFrontSvgAssets = {
  couponPhoneScanUri: string;
  couponFrontManLogoUri: string;
};

export type CouponFrontFaceInput = {
  code: string;
  points: number;
  qrDataUrl: string;
  idSuffix: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtPoints(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function tierGradientDefs(
  theme: ReturnType<typeof getCouponTierTheme>,
  sid: string,
): string {
  if (!theme.gradient) return '';
  const stops = theme.gradient.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
    .join('');
  return `
    <linearGradient id="tierGrad_panel_${sid}" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      ${stops}
    </linearGradient>
    <linearGradient id="tierGrad_pill_${sid}" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
      ${stops}
    </linearGradient>
  `;
}

function panelFillAttr(theme: ReturnType<typeof getCouponTierTheme>, sid: string): string {
  if (theme.gradient) {
    return `url(#tierGrad_panel_${sid})`;
  }
  return theme.panelFill;
}

function pillFillAttr(theme: ReturnType<typeof getCouponTierTheme>, sid: string): string {
  if (theme.gradient) {
    return `url(#tierGrad_pill_${sid})`;
  }
  return theme.pillFill;
}

export function couponFrontQrPixelSize(): number {
  const sx = COUPON_INNER_W / DESIGN_W;
  return Math.round(150 * sx * 2);
}

function layoutCouponFace(code: string, points: number) {
  // Use the physical design units from coupon-print-spec.ts (1010x380)
  // while maintaining the relative layout of the 660x245 design.
  const sx = COUPON_DESIGN_W / 660;
  const sy = COUPON_DESIGN_H / 245;

  const LEFT_W = Math.round(220 * sx);
  const RIGHT_W = COUPON_DESIGN_W - LEFT_W;
  const RIGHT_X = LEFT_W;

  const iconW = Math.round(60 * sx);
  const iconH = Math.round(60 * sy);
  const iconX = Math.round((LEFT_W - iconW) / 2);
  const iconY = Math.round(18 * sy);

  const qrSize = Math.round(130 * sx);
  const qrX = Math.round((LEFT_W - qrSize) / 2);
  const qrY = Math.round(82 * sy);

  const idFontSize = Math.round(13 * sy);
  const idY = Math.round(230 * sy);

  // Dynamic pill sizing for better padding
  const pointsStr = `${points.toLocaleString()} Points`;
  const charCount = pointsStr.length;
  
  const pillH = Math.round(76 * sy);
  const pillW = Math.max(Math.round(260 * sx), charCount * Math.round(28 * sx)); 
  const pillR = Math.round(pillH / 2);
  const pillX = RIGHT_X + Math.round((RIGHT_W - pillW) / 2);
  const pillY = Math.round(92 * sy);

  const logoW = Math.round(60 * sx);
  // Match original 306:460 aspect ratio exactly to avoid scaling blur
  const logoH = Math.round(logoW * (460 / 306));
  const logoPad = Math.round(24 * sx);
  const logoX = COUPON_DESIGN_W - logoW - logoPad;
  const logoY = Math.round(14 * sy);

  const pointsFontSize = Math.round(38 * sy);
  const pointsTextY = pillY + (pillH / 2) + (pointsFontSize * 0.34);

  const taglineFontSize = Math.round(14 * sy);

  return {
    LEFT_W,
    RIGHT_W,
    RIGHT_X,
    iconW,
    iconH,
    iconX,
    iconY,
    qrSize,
    qrX,
    qrY,
    idFontSize,
    idY,
    pillW,
    pillH,
    pillR,
    pillX,
    pillY,
    logoW,
    logoH,
    logoX,
    logoY,
    pointsFontSize,
    pointsTextY,
    taglineFontSize,
  };
}

/** One coupon face (local origin). Use inside a page SVG or standalone wrapper. */
export function buildCouponFaceMarkup(params: {
  code: string;
  points: number;
  qrDataUrl: string;
  idSuffix: string;
  assets: CouponFrontSvgAssets;
  /** When set, scan/logo use <use href="#id"> from parent SVG defs. */
  sharedAssetIds?: { scan: string; logo: string };
}): string {
  const code = params.code;
  const points = params.points;
  const qr = params.qrDataUrl;
  const sid = params.idSuffix.replace(/[^a-zA-Z0-9_]/g, '_');
  const theme = getCouponTierTheme(points);
  const L = layoutCouponFace(code, points);

  const leftFill = panelFillAttr(theme, sid);
  const pillFill = pillFillAttr(theme, sid);
  const tierDefs = tierGradientDefs(theme, sid);

  const sx = COUPON_DESIGN_W / 660;
  const sy = COUPON_DESIGN_H / 245;

  // Background pattern paths for the right section (scaled from 660x245 design)
  const swoosh1 = `M${L.RIGHT_X + Math.round(12 * sx)} 0C${L.RIGHT_X + Math.round(82 * sx)} ${Math.round(16 * sy)} ${L.RIGHT_X + Math.round(128 * sx)} ${Math.round(44 * sy)} ${L.RIGHT_X + Math.round(174 * sx)} ${Math.round(90 * sy)}C${L.RIGHT_X + Math.round(228 * sx)} ${Math.round(144 * sy)} ${L.RIGHT_X + Math.round(305 * sx)} ${Math.round(178 * sy)} ${L.RIGHT_X + Math.round(440 * sx)} ${Math.round(199 * sy)}V0H${L.RIGHT_X + Math.round(12 * sx)}Z`;
  const swoosh2 = `M${L.RIGHT_X + Math.round(2 * sx)} 0C${L.RIGHT_X + Math.round(54 * sx)} ${Math.round(54 * sy)} ${L.RIGHT_X + Math.round(130 * sx)} ${Math.round(88 * sy)} ${L.RIGHT_X + Math.round(248 * sx)} ${Math.round(107 * sy)}C${L.RIGHT_X + Math.round(330 * sx)} ${Math.round(120 * sy)} ${L.RIGHT_X + Math.round(394 * sx)} ${Math.round(146 * sy)} ${L.RIGHT_X + Math.round(440 * sx)} ${Math.round(176 * sy)}V0H${L.RIGHT_X + Math.round(2 * sx)}Z`;
  const swoosh3 = `M${L.RIGHT_X} ${Math.round(118 * sy)}C${L.RIGHT_X + Math.round(88 * sx)} ${Math.round(120 * sy)} ${L.RIGHT_X + Math.round(194 * sx)} ${Math.round(116 * sy)} ${L.RIGHT_X + Math.round(288 * sx)} ${Math.round(142 * sy)}C${L.RIGHT_X + Math.round(350 * sx)} ${Math.round(159 * sy)} ${L.RIGHT_X + Math.round(397 * sx)} ${Math.round(186 * sy)} ${L.RIGHT_X + Math.round(440 * sx)} ${Math.round(226 * sy)}V${COUPON_DESIGN_H}H${L.RIGHT_X}Z`;

  const scanHref = params.sharedAssetIds
    ? `#${params.sharedAssetIds.scan}`
    : params.assets.couponPhoneScanUri;
  const logoHref = params.sharedAssetIds
    ? `#${params.sharedAssetIds.logo}`
    : params.assets.couponFrontManLogoUri;

  const scanGraphic = params.sharedAssetIds
    ? `<use href="${scanHref}" xlink:href="${scanHref}" x="${L.iconX}" y="${L.iconY}" width="${L.iconW}" height="${L.iconH}" />`
    : `<image href="${scanHref}" x="${L.iconX}" y="${L.iconY}" width="${L.iconW}" height="${L.iconH}" preserveAspectRatio="xMidYMid meet" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" />`;
  const logoGraphic = params.sharedAssetIds
    ? `<use href="${logoHref}" xlink:href="${logoHref}" x="${L.logoX}" y="${L.logoY}" width="${L.logoW}" height="${L.logoH}" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" />`
    : `<image href="${logoHref}" x="${L.logoX}" y="${L.logoY}" width="${L.logoW}" height="${L.logoH}" preserveAspectRatio="xMidYMid meet" style="image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" />`;

  return `
      <defs>
        <clipPath id="c_${sid}">
          <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" />
        </clipPath>
        <linearGradient id="g_${sid}" x1="${L.RIGHT_X}" y1="0" x2="${COUPON_DESIGN_W}" y2="${COUPON_DESIGN_H}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#F55E00"/>
        </linearGradient>
        <filter id="pillShadow_${sid}" x="-20%" y="-20%" width="140%" height="160%" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="${Math.round(13 * sy)}" stdDeviation="${Math.round(9 * sx)}" flood-color="#8F3B00" flood-opacity="0.24"/>
        </filter>
        ${tierDefs}
      </defs>
      <g clip-path="url(#c_${sid})" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">
        <!-- Left Section -->
        <rect x="0" y="0" width="${L.LEFT_W}" height="${COUPON_DESIGN_H}" fill="${leftFill}" />
        
        <!-- Right Section Background -->
        <rect x="${L.RIGHT_X}" y="0" width="${L.RIGHT_W}" height="${COUPON_DESIGN_H}" fill="url(#g_${sid})" />
        
        <!-- Decorative Swooshes in Right Section -->
        <path d="${swoosh1}" fill="#FFFFFF" opacity="0.08"/>
        <path d="${swoosh2}" fill="#A63A05" opacity="0.12"/>
        <path d="${swoosh3}" fill="#C14508" opacity="0.12"/>

        <!-- Left Content -->
        ${scanGraphic}
        <image href="${qr}" x="${L.qrX}" y="${L.qrY}" width="${L.qrSize}" height="${L.qrSize}" preserveAspectRatio="xMidYMid meet" />
        
        <!-- ID label with decorative lines -->
        <line x1="${Math.round(40 * sx)}" y1="${L.idY - Math.round(5 * sy)}" x2="${Math.round(55 * sx)}" y2="${L.idY - Math.round(5 * sy)}" stroke="#000" stroke-width="${1 * sx}" stroke-linecap="round" />
        <text x="${Math.round(L.LEFT_W / 2)}" y="${L.idY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${L.idFontSize}" font-weight="400" fill="#000">ID: ${code}</text>
        <line x1="${Math.round(165 * sx)}" y1="${L.idY - Math.round(5 * sy)}" x2="${Math.round(180 * sx)}" y2="${L.idY - Math.round(5 * sy)}" stroke="#000" stroke-width="${1 * sx}" stroke-linecap="round" />

        <!-- Right Content -->
        ${logoGraphic}
        
        <!-- Points Pill -->
        <rect x="${L.pillX}" y="${L.pillY}" width="${L.pillW}" height="${L.pillH}" rx="${L.pillR}" ry="${L.pillR}"
          fill="${pillFill}" stroke="${theme.pillStroke}" stroke-width="${theme.pillStrokeWidth}"
          filter="url(#pillShadow_${sid})" />
        <text x="${L.pillX + Math.round(L.pillW / 2)}" y="${L.pointsTextY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${L.pointsFontSize}" font-weight="900" fill="#1F2937">${fmtPoints(points)} Points</text>
        
        <!-- Tagline -->
        <text x="${L.RIGHT_X + Math.round(L.RIGHT_W / 2)}" y="340" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${L.taglineFontSize}" font-weight="500" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
      </g>
  `.trim();
}

/** Print PDF: one SVG per A4 page, coupons stacked flush (no HTML gaps). */
export function buildCouponPrintPageSvg(
  faces: CouponFrontFaceInput[],
  assets: CouponFrontSvgAssets,
): string {
  const count = faces.length;
  const totalCouponH = count * COUPON_DESIGN_H;
  const totalGapH = Math.max(0, count - 1) * COUPON_V_GAP_U;
  const pageViewBoxH = totalCouponH + totalGapH;

  const totalCouponMmH = count * COUPON_H_MM;
  const totalGapMmH = Math.max(0, count - 1) * COUPON_V_GAP_MM;
  const pageMmH = totalCouponMmH + totalGapMmH;

  const shared = { scan: COUPON_ASSET_SCAN_ID, logo: COUPON_ASSET_LOGO_ID };

  const stacked = faces
    .map((face, index) => {
      const inner = buildCouponFaceMarkup({
        ...face,
        assets,
        sharedAssetIds: shared,
      });
      const yOffset = index * (COUPON_DESIGN_H + COUPON_V_GAP_U);
      return `<g transform="translate(0, ${yOffset})">${inner}</g>`;
    })
    .join('\n');

  return `
    <svg viewBox="0 0 ${COUPON_DESIGN_W} ${pageViewBoxH}" width="${COUPON_W_MM}mm" height="${pageMmH}mm"
      xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" shape-rendering="crispEdges"
      style="background-color: transparent">
      <defs>
        <symbol id="${COUPON_ASSET_SCAN_ID}" viewBox="0 0 132 133">
          <image width="132" height="133" href="${assets.couponPhoneScanUri}" preserveAspectRatio="xMidYMid meet" />
        </symbol>
        <symbol id="${COUPON_ASSET_LOGO_ID}" viewBox="0 0 306 460">
          <image width="306" height="460" href="${assets.couponFrontManLogoUri}" preserveAspectRatio="xMidYMid meet" />
        </symbol>
      </defs>
      ${stacked}
    </svg>
  `.trim();
}

/** Standalone coupon (admin preview modal, HTML preview). */
 export function buildCouponFrontSvg(params: {
   code: string;
   points: number;
   qrDataUrl: string;
   idSuffix: string;
   assets: CouponFrontSvgAssets;
 }): string {
   const inner = buildCouponFaceMarkup(params);
   // Fixed size 660x245px as requested.
   return `
     <svg width="660" height="245" viewBox="0 0 ${COUPON_DESIGN_W} ${COUPON_DESIGN_H}"
       xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" shape-rendering="geometricPrecision">
       ${inner}
     </svg>
   `.trim();
 }
