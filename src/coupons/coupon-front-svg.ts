import { getCouponTierTheme } from './coupon-tiers';

const DESIGN_W = 660;
const DESIGN_H = 330;
const LEFT_W = 220;

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

function tierGradientDefs(theme: ReturnType<typeof getCouponTierTheme>, sid: string): string {
  if (!theme.gradient) return '';
  const stops = theme.gradient.stops
    .map(
      (s) =>
        `<stop offset="${s.offset}" stop-color="${s.color}"/>`,
    )
    .join('');
  return `
    <linearGradient id="tierGrad_panel_${sid}" x1="0" y1="0" x2="${LEFT_W}" y2="${DESIGN_H}" gradientUnits="userSpaceOnUse">
      ${stops}
    </linearGradient>
    <linearGradient id="tierGrad_pill_${sid}" x1="0" y1="0" x2="330" y2="74" gradientUnits="userSpaceOnUse">
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

  const RIGHT_X = LEFT_W;
  const RIGHT_W = DESIGN_W - LEFT_W;

  const iconW = 28;
  const iconX = Math.round((LEFT_W - iconW) / 2);
  const iconY = 28;
  const qrSize = 176;
  const qrX = Math.round((LEFT_W - qrSize) / 2);
  const qrY = iconY + iconW + 10;
  const idY = qrY + qrSize + 14;

  const pillW = 330;
  const pillH = 82;
  const pillX = Math.round(RIGHT_X + (RIGHT_W - pillW) / 2);
  const pillY = 116;
  const pillR = Math.round(pillH / 2);

  const logoW = 50;
  const logoH = 75;
  const logoPad = 10;
  const logoX = DESIGN_W - logoW - logoPad;
  const logoY = 22;

  const leftFill = panelFillAttr(theme, sid);
  const pillFill = pillFillAttr(theme, sid);
  const tierDefs = tierGradientDefs(theme, sid);

  return `
    <svg viewBox="0 0 ${DESIGN_W} ${DESIGN_H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="c_${sid}">
          <rect x="0" y="0" width="${DESIGN_W}" height="${DESIGN_H}" rx="26" ry="26" />
        </clipPath>
        <linearGradient id="g_${sid}" x1="${RIGHT_X}" y1="0" x2="${DESIGN_W}" y2="${DESIGN_H}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#EA6A12"/>
        </linearGradient>
        ${tierDefs}
      </defs>
      <g clip-path="url(#c_${sid})">
        <rect x="0" y="0" width="${LEFT_W}" height="${DESIGN_H}" fill="${leftFill}" />
        <rect x="${RIGHT_X}" y="0" width="${RIGHT_W}" height="${DESIGN_H}" fill="url(#g_${sid})" />

        <path d="M${RIGHT_X + 40} 26C${RIGHT_X + 80} 68 ${RIGHT_X + 150} 106 ${RIGHT_X + 240} 130C${RIGHT_X + 315} 150 ${RIGHT_X + 365} 178 ${RIGHT_X + 420} 218V0H${RIGHT_X}v${DESIGN_H}h${RIGHT_W}v-35c-62-11-126-40-190-89C${RIGHT_X + 140} 170 ${RIGHT_X + 80} 96 ${RIGHT_X + 40} 26Z" fill="#000" opacity="0.06"/>

        <image href="${params.assets.couponPhoneScanUri}" x="${iconX}" y="${iconY}" width="${iconW}" height="${iconW}" />
        <image href="${qr}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />

        <text x="${Math.round(LEFT_W / 2)}" y="${idY}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="13" font-weight="700" fill="#6B7280">ID: ${escapeHtml(code)}</text>

        <image href="${params.assets.couponFrontManLogoUri}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet" />

        <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillR}" ry="${pillR}"
          fill="${pillFill}" stroke="${theme.pillStroke}" stroke-width="${theme.pillStrokeWidth}" />
        <text x="${pillX + Math.round(pillW / 2)}" y="${pillY + 55}" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="36" font-weight="900" fill="#1F2937">${escapeHtml(fmtPoints(points))} Points</text>

        <text x="${RIGHT_X + Math.round(RIGHT_W / 2)}" y="264" text-anchor="middle"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
          font-size="14" font-weight="600" fill="#FFFFFF">Scan in the Best Bond app to redeem</text>
      </g>
    </svg>
  `;
}
