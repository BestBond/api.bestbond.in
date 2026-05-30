/**
 * Allowed coupon point tiers for generation.
 * Keep in sync with:
 * - reward-system-frontend/src/constants/couponTiers.ts
 * - BestBond/src/constants/couponTiers.ts
 */
export const ALLOWED_COUPON_POINTS = [10, 20, 30, 40, 50, 100] as const;

export type AllowedCouponPoints = (typeof ALLOWED_COUPON_POINTS)[number];

export type CouponTierGradientStop = { offset: string; color: string };

export type CouponTierTheme = {
  points: AllowedCouponPoints | null;
  label: string;
  /** Solid fill or url(#tierGrad_*) for left panel and pill */
  panelFill: string;
  pillFill: string;
  pillStroke: string;
  pillStrokeWidth: number;
  /** When set, emit linearGradient defs for left + pill */
  gradient?: {
    idSuffix: string;
    stops: CouponTierGradientStop[];
  };
};

const TIER_THEMES: Record<AllowedCouponPoints, CouponTierTheme> = {
  10: {
    points: 10,
    label: '10 Points',
    panelFill: '#FFFFFF',
    pillFill: '#FFFFFF',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
  },
  20: {
    points: 20,
    label: '20 Points',
    panelFill: '#F7E5BC',
    pillFill: '#F7E5BC',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
  },
  30: {
    points: 30,
    label: '30 Points',
    panelFill: '#C9E8D0',
    pillFill: '#C9E8D0',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
  },
  40: {
    points: 40,
    label: '40 Points',
    panelFill: 'url(#tierGrad_panel)',
    pillFill: 'url(#tierGrad_pill)',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
    gradient: {
      idSuffix: 'bronze',
      stops: [
        { offset: '0%', color: '#D27B42' },
        { offset: '50%', color: '#C98245' },
        { offset: '100%', color: '#8F3B00' },
      ],
    },
  },
  50: {
    points: 50,
    label: '50 Points',
    panelFill: 'url(#tierGrad_panel)',
    pillFill: 'url(#tierGrad_pill)',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
    gradient: {
      idSuffix: 'silver',
      stops: [
        { offset: '0%', color: '#FFFFFF' },
        { offset: '30%', color: '#E2E8F0' },
        { offset: '70%', color: '#CBD5E1' },
        { offset: '100%', color: '#94A3B8' },
      ],
    },
  },
  100: {
    points: 100,
    label: '100 Points',
    panelFill: 'url(#tierGrad_panel)',
    pillFill: 'url(#tierGrad_pill)',
    pillStroke: '#DBB146',
    pillStrokeWidth: 3,
    gradient: {
      idSuffix: 'gold',
      stops: [
        { offset: '0%', color: '#FDE68A' },
        { offset: '50%', color: '#E3BD3F' },
        { offset: '100%', color: '#B45309' },
      ],
    },
  },
};

const LEGACY_FALLBACK: CouponTierTheme = {
  points: null,
  label: 'Coupon',
  panelFill: '#FFFFFF',
  pillFill: '#FFFFFF',
  pillStroke: '#9CA3AF',
  pillStrokeWidth: 2,
};

export function isAllowedCouponPoints(n: number): n is AllowedCouponPoints {
  return (ALLOWED_COUPON_POINTS as readonly number[]).includes(n);
}

export function getCouponTierTheme(points: number): CouponTierTheme {
  if (isAllowedCouponPoints(points)) {
    return TIER_THEMES[points];
  }
  return LEGACY_FALLBACK;
}

export function getCouponTierOptions(): Array<{
  value: AllowedCouponPoints;
  label: string;
}> {
  return ALLOWED_COUPON_POINTS.map((value) => ({
    value,
    label: TIER_THEMES[value].label,
  }));
}
