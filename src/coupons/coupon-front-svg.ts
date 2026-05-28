import { getCouponTierTheme } from './coupon-tiers';
import {
  COUPON_DESIGN_H,
  COUPON_DESIGN_W,
  COUPON_INNER_H,
  COUPON_INNER_W,
  COUPON_SAFE_INSET_U,
} from './coupon-print-spec';

/** Canonical coupon artboard (AdminCouponPreviewScreen / print reference). */
const DESIGN_W = 660;
const DESIGN_H = 245;
const DESIGN_LEFT_W = 220;
const DESIGN_RIGHT_W = 440;

export type CouponFrontSvgAssets = {
  couponPhoneScanUri: string;
  couponFrontManLogoUri: string;
};

/** IDs for assets declared once per PDF HTML document (see buildCouponSharedAssetDefs). */
export const COUPON_ASSET_SCAN_ID = 'couponAssetScan';
export const COUPON_ASSET_LOGO_ID = 'couponAssetLogo';

/** Embed scan + logo once per PDF; coupons reference via &lt;use href="#…"&gt;. */
export function buildCouponSharedAssetDefs(assets: CouponFrontSvgAssets): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        <image id="${COUPON_ASSET_SCAN_ID}" href="${assets.couponPhoneScanUri}" width="132" height="133" preserveAspectRatio="xMidYMid meet" />
        <image id="${COUPON_ASSET_LOGO_ID}" href="${assets.couponFrontManLogoUri}" width="306" height="460" preserveAspectRatio="xMidYMid meet" />
      </defs>
    </svg>
  `.trim();
}

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

export function buildCouponFrontSvg(params: {
  code: string;
  points: number;
  qrDataUrl: string;
  idSuffix: string;
  assets: CouponFrontSvgAssets;
  /** When true, logo/scan use shared document defs (batch PDF). */
  useSharedAssets?: boolean;
}): string {
  const code = params.code;
  const points = params.points;
  const qr = params.qrDataUrl;
  const sid = params.idSuffix.replace(/[^a-zA-Z0-9_]/g, '_');
  const theme = getCouponTierTheme(points);

  const ox = COUPON_SAFE_INSET_U;
  const oy = COUPON_SAFE_INSET_U;
  const sx = COUPON_INNER_W / DESIGN_W;
  const sy = COUPON_INNER_H / DESIGN_H;
  const sxf = (n: number) => Math.round(n * sx);
  const syf = (n: number) => Math.round(n * sy);

  const LEFT_W = sxf(DESIGN_LEFT_W);
  const RIGHT_W = sxf(DESIGN_RIGHT_W);
  const RIGHT_X = ox + LEFT_W;

  const iconW = sxf(28);
  const iconH = syf(28);
  const iconX = ox + Math.round((LEFT_W - iconW) / 2);
  const iconY = oy + syf(14);

  const qrSize = Math.min(sxf(150), syf(150), LEFT_W - sxf(24));
  const qrX = ox + Math.round((LEFT_W - qrSize) / 2);
  const qrY = iconY + iconH + syf(10);

  const idFontSize =
    code.length > 16 ? syf(10) : code.length > 12 ? syf(11) : syf(13);
  const idY = qrY + qrSize + syf(14) + idFontSize;
  const idLabel = `\u2014 ID: ${code} \u2014`;

  const pillW = Math.min(sxf(330), RIGHT_W - sxf(24));
  const pillH = syf(74);
  const pillR = Math.round(pillH / 2);
  const pillX = RIGHT_X + Math.round((RIGHT_W - pillW) / 2);
  const pillY = oy + syf(76);

  const logoW = sxf(50);
  const logoH = syf(75);
  const logoX = RIGHT_X + RIGHT_W - sxf(10) - logoW;
  const logoY = oy + syf(14);

  const pointsFontSize = syf(36);
  const pointsTextY = pillY + Math.round(pillH / 2) + Math.round(pointsFontSize * 0.36);

  const taglineFontSize = syf(14);
  const taglineY = pillY + pillH + syf(34) + taglineFontSize;

  const leftFill = panelFillAttr(theme, sid);
  const pillFill = pillFillAttr(theme, sid);
  const tierDefs = tierGradientDefs(theme, sid);

  const swooshPath =
    'M40 18C80 50 150 78 240 96C315 111 365 132 420 162V0H0v245h440v-26c-62-8-126-30-190-66C140 126 80 72 40 18Z';

  const scanGraphic = params.useSharedAssets
    ? `<use href="#${COUPON_ASSET_SCAN_ID}" xlink:href="#${COUPON_ASSET_SCAN_ID}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconH}" />`
    : `<image href="${params.assets.couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconH}" preserveAspectRatio="xMidYMid meet" />`;
  const logoGraphic = params.useSharedAssets
    ? `<use href="#${COUPON_ASSET_LOGO_ID}" xlink:href="#${COUPON_ASSET_LOGO_ID}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" />`
    : `<image href="${params.assets.couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />`;

  return `
    <svg viewBox="0 0 ${COUPON_DESIGN_W} ${COUPON_DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" shape-rendering="geometricPrecision">
      <defs>
        <clipPath id="c_${sid}">
          <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" />
        </clipPath>
        <clipPath id="right_${sid}">
          <rect x="${RIGHT_X}" y="${oy}" width="${RIGHT_W}" height="${COUPON_INNER_H}" />
        </clipPath>
        <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="${oy}" x2="${RIGHT_X + RIGHT_W}" y2="${oy + COUPON_INNER_H}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#EA6A12"/>
        </linearGradient>
        <pattern id="diag_${sid}" width="${syf(18)}" height="${syf(18)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="${syf(18)}" stroke="#FFFFFF" stroke-width="1" opacity="0.07"/>
        </pattern>
        <filter id="pillShadow_${sid}" x="-8%" y="-8%" width="116%" height="130%">
          <feDropShadow dx="0" dy="${syf(2)}" stdDeviation="${syf(3)}" flood-color="#000000" flood-opacity="0.18"/>
        </filter>
        ${tierDefs}
      </defs>
      <g clip-path="url(#c_${sid})">
        <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" fill="#FFFFFF" />

        <rect x="${ox}" y="${oy}" width="${LEFT_W}" height="${COUPON_INNER_H}" fill="${leftFill}" />
        <line x1="${RIGHT_X}" y1="${oy}" x2="${RIGHT_X}" y2="${oy + COUPON_INNER_H}" stroke="${theme.pillStroke}" stroke-width="1" />

        <rect x="${RIGHT_X}" y="${oy}" width="${RIGHT_W}" height="${COUPON_INNER_H}" fill="url(#g_${sid})" />
        <g clip-path="url(#right_${sid})">
          <rect x="${RIGHT_X}" y="${oy}" width="${RIGHT_W}" height="${COUPON_INNER_H}" fill="url(#diag_${sid})" />
          <g transform="translate(${RIGHT_X}, ${oy}) scale(${sx}, ${sy})">
            <path d="${swooshPath}" fill="#000000" opacity="0.06"/>
          </g>
        </g>

        ${scanGraphic}
        <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />

        <text x="${ox + Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${idFontSize}" font-weight="500" fill="#667085">${escapeHtml(idLabel)}</text>

        ${logoGraphic}

        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}"
          fill="${pillFill}" stroke="${theme.pillStroke}" stroke-width="${theme.pillStrokeWidth}"
          filter="url(#pillShadow_${sid})" />
        <text x="${pillX + Math.round(pillW / 2)}" y="${pointsTextY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${pointsFontSize}" font-weight="800" fill="#1F2937" letter-spacing="-0.5">${escapeHtml(fmtPoints(points))} Points</text>

        <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="${taglineY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${taglineFontSize}" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
      </g>
    </svg>
  `;
}
