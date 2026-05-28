import { getCouponTierTheme } from './coupon-tiers';
import {
  COUPON_DESIGN_H,
  COUPON_DESIGN_W,
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

function tierGradientDefs(
  theme: ReturnType<typeof getCouponTierTheme>,
  sid: string,
  leftW: number,
): string {
  if (!theme.gradient) return '';
  const stops = theme.gradient.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
    .join('');
  return `
    <linearGradient id="tierGrad_panel_${sid}" x1="0" y1="0" x2="${leftW}" y2="${COUPON_DESIGN_H}" gradientUnits="userSpaceOnUse">
      ${stops}
    </linearGradient>
    <linearGradient id="tierGrad_pill_${sid}" x1="0" y1="0" x2="260" y2="52" gradientUnits="userSpaceOnUse">
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

  const inset = COUPON_SAFE_INSET_U;
  const LEFT_W = 340;
  const RIGHT_X = LEFT_W;
  const RIGHT_W = COUPON_DESIGN_W - LEFT_W;

  const iconW = 16;
  const qrSize = Math.min(LEFT_W - inset * 2, 108);
  const idFontSize = code.length > 14 ? 9 : 10;

  const stackH = iconW + 4 + qrSize + 10 + idFontSize + 4;
  const stackTop = Math.round((COUPON_DESIGN_H - stackH) / 2);
  const iconX = Math.round((LEFT_W - iconW) / 2);
  const iconY = stackTop;
  const qrX = Math.max(inset, Math.round((LEFT_W - qrSize) / 2));
  const qrY = iconY + iconW + 4;
  const idY = qrY + qrSize + 8 + idFontSize;
  const idLineLeft = inset;
  const idLineRight = LEFT_W - inset;
  const idLineAbove = idY - idFontSize - 5;
  const idLineBelow = idY + 5;

  const pillW = Math.min(260, RIGHT_W - inset - 44);
  const pillH = 50;
  const pillX = RIGHT_X + Math.round((RIGHT_W - pillW) / 2);
  const pillY = Math.round((COUPON_DESIGN_H - pillH) / 2) - 4;
  const pillR = 6;

  const logoW = 38;
  const logoH = 56;
  const logoX = COUPON_DESIGN_W - logoW - inset;
  const logoY = inset;

  const leftFill = panelFillAttr(theme, sid);
  const pillFill = pillFillAttr(theme, sid);
  const tierDefs = tierGradientDefs(theme, sid, LEFT_W);

  const taglineY = COUPON_DESIGN_H - inset;

  return `
    <svg viewBox="0 0 ${COUPON_DESIGN_W} ${COUPON_DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="c_${sid}">
          <rect x="0" y="0" width="${COUPON_DESIGN_W}" height="${COUPON_DESIGN_H}" />
        </clipPath>
        <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="0" x2="${COUPON_DESIGN_W}" y2="${COUPON_DESIGN_H}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#EA6A12"/>
        </linearGradient>
        ${tierDefs}
      </defs>
      <g clip-path="url(#c_${sid})">
        <rect x="0" y="0" width="${LEFT_W}" height="${COUPON_DESIGN_H}" fill="${leftFill}" />
        <rect x="${RIGHT_X}" y="0" width="${RIGHT_W}" height="${COUPON_DESIGN_H}" fill="url(#g_${sid})" />

        <path d="M${RIGHT_X + 32} 14C${RIGHT_X + 64} 46 ${RIGHT_X + 118} 76 ${RIGHT_X + 188} 96C${RIGHT_X + 248} 110 ${RIGHT_X + 288} 128 ${RIGHT_X + 332} 154V0H${RIGHT_X}v${COUPON_DESIGN_H}h${RIGHT_W}v-24c-48-8-98-30-148-68C${RIGHT_X + 108} 124 ${RIGHT_X + 58} 64 ${RIGHT_X + 32} 14Z" fill="#000" opacity="0.06"/>

        <image href="${params.assets.couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconW}" />
        <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />

        <line x1="${idLineLeft}" y1="${idLineAbove}" x2="${idLineRight}" y2="${idLineAbove}" stroke="#C4C4C4" stroke-width="1" />
        <text x="${Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="${idFontSize}" font-weight="700" fill="#6B7280">ID: ${escapeHtml(code)}</text>
        <line x1="${idLineLeft}" y1="${idLineBelow}" x2="${idLineRight}" y2="${idLineBelow}" stroke="#C4C4C4" stroke-width="1" />

        <image href="${params.assets.couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />

        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}"
          fill="${pillFill}" stroke="${theme.pillStroke}" stroke-width="${theme.pillStrokeWidth}" />
        <text x="${pillX + Math.round(pillW / 2)}" y="${pillY + 33}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="26" font-weight="900" fill="#1F2937">${escapeHtml(fmtPoints(points))} Points</text>

        <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="${taglineY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="11" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
      </g>
    </svg>
  `;
}
