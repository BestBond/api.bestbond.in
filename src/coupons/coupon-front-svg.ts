import { getCouponTierTheme } from './coupon-tiers';
import {
  COUPON_DESIGN_H,
  COUPON_DESIGN_W,
  COUPON_INNER_H,
  COUPON_INNER_W,
  COUPON_SAFE_INSET_U,
} from './coupon-print-spec';

export type CouponFrontSvgAssets = {
  couponPhoneScanUri: string;
  couponFrontManLogoUri: string;
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

function tierGradientDefs(theme: ReturnType<typeof getCouponTierTheme>, sid: string, leftW: number): string {
  if (!theme.gradient) return '';
  const stops = theme.gradient.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
    .join('');
  return `
    <linearGradient id="tierGrad_panel_${sid}" x1="0" y1="0" x2="${leftW}" y2="${COUPON_INNER_H}" gradientUnits="userSpaceOnUse">
      ${stops}
    </linearGradient>
    <linearGradient id="tierGrad_pill_${sid}" x1="0" y1="0" x2="280" y2="58" gradientUnits="userSpaceOnUse">
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

export function buildCouponFrontSvg(params: {
  code: string;
  points: number;
  qrDataUrl: string;
  idSuffix: string;
  assets: CouponFrontSvgAssets;
}): string {
  const code = params.code;
  const points = params.points;
  const qr = params.qrDataUrl;
  const sid = params.idSuffix.replace(/[^a-zA-Z0-9_]/g, '_');
  const theme = getCouponTierTheme(points);

  const ox = COUPON_SAFE_INSET_U;
  const oy = COUPON_SAFE_INSET_U;
  const LEFT_W = 300;
  const RIGHT_X = ox + LEFT_W;
  const RIGHT_W = COUPON_INNER_W - LEFT_W;

  const iconW = 22;
  const iconX = ox + Math.round((LEFT_W - iconW) / 2);
  const iconY = oy + 12;
  const qrSize = 138;
  const qrX = ox + Math.round((LEFT_W - qrSize) / 2);
  const qrY = iconY + iconW + 6;
  const idY = qrY + qrSize + 14;

  const pillW = 268;
  const pillH = 56;
  const pillX = RIGHT_X + Math.round((RIGHT_W - pillW) / 2);
  const pillY = oy + Math.round((COUPON_INNER_H - pillH) / 2) - 6;
  const pillR = 8;

  const logoW = 42;
  const logoH = 62;
  const logoX = ox + COUPON_INNER_W - logoW - 8;
  const logoY = oy + 10;

  const leftFill = panelFillAttr(theme, sid);
  const pillFill = pillFillAttr(theme, sid);
  const tierDefs = tierGradientDefs(theme, sid, LEFT_W);

  const taglineY = oy + COUPON_INNER_H - 14;

  return `
    <svg viewBox="0 0 ${COUPON_DESIGN_W} ${COUPON_DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="c_${sid}">
          <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" />
        </clipPath>
        <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="${oy}" x2="${RIGHT_X + RIGHT_W}" y2="${oy + COUPON_INNER_H}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#EA6A12"/>
        </linearGradient>
        ${tierDefs}
      </defs>
      <g clip-path="url(#c_${sid})">
        <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" fill="#FFFFFF" />
        <rect x="${ox}" y="${oy}" width="${LEFT_W}" height="${COUPON_INNER_H}" fill="${leftFill}" />
        <rect x="${RIGHT_X}" y="${oy}" width="${RIGHT_W}" height="${COUPON_INNER_H}" fill="url(#g_${sid})" />

        <path d="M${RIGHT_X + 36} ${oy + 18}C${RIGHT_X + 72} ${oy + 52} ${RIGHT_X + 132} ${oy + 84} ${RIGHT_X + 210} ${oy + 104}C${RIGHT_X + 278} ${oy + 120} ${RIGHT_X + 322} ${oy + 142} ${RIGHT_X + 370} ${oy + 172}V${oy}H${RIGHT_X}v${COUPON_INNER_H}h${RIGHT_W}v-28c-54-9-110-34-166-76C${RIGHT_X + 124} ${oy + 136} ${RIGHT_X + 70} ${oy + 72} ${RIGHT_X + 36} ${oy + 18}Z" fill="#000" opacity="0.06"/>

        <image href="${params.assets.couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconW}" />
        <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />

        <text x="${ox + Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="12" font-weight="700" fill="#6B7280">ID: ${escapeHtml(code)}</text>

        <image href="${params.assets.couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />

        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}"
          fill="${pillFill}" stroke="${theme.pillStroke}" stroke-width="${theme.pillStrokeWidth}" />
        <text x="${pillX + Math.round(pillW / 2)}" y="${pillY + 38}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="30" font-weight="900" fill="#1F2937">${escapeHtml(fmtPoints(points))} Points</text>

        <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="${taglineY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="12" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
      </g>
    </svg>
  `;
}
