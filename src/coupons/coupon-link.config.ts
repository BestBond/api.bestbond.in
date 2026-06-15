/** 12-char uppercase hex coupon codes (see CouponsService.generateCode). */
export const COUPON_CODE_PATTERN = /^[0-9A-F]{12}$/;

export function normalizeCouponCode(raw: string): string | null {
  const code = decodeURIComponent(String(raw ?? ''))
    .trim()
    .toUpperCase();
  return COUPON_CODE_PATTERN.test(code) ? code : null;
}

export function getCouponLinkBaseUrl(): string {
  return (
    process.env.COUPON_LINK_BASE_URL ?? 'https://api.bestbond.in'
  ).replace(/\/$/, '');
}

export function buildCouponQrUrl(code: string): string {
  const normalized = normalizeCouponCode(code);
  if (!normalized) {
    throw new Error('Invalid coupon code');
  }
  return `${getCouponLinkBaseUrl()}/c/${normalized}`;
}

export function getAppDeepLinkScheme(): string {
  return (process.env.APP_DEEP_LINK_SCHEME ?? 'bestbond').replace(/:$/, '');
}

/** Opens the in-app scanner only — no coupon code, no auto-redeem. */
export function buildAppScanDeepLink(): string {
  return `${getAppDeepLinkScheme()}://scan`;
}

export function getIosAppStoreUrl(): string {
  return (
    process.env.IOS_APP_STORE_URL ??
    'https://apps.apple.com/in/app/bestbond-pro-club/id6768066865'
  );
}

export function getAndroidPlayStoreUrl(): string {
  return (
    process.env.ANDROID_PLAY_STORE_URL ??
    'https://play.google.com/store/apps/details?id=com.nuvate.bestbond'
  );
}

export function getIosTeamId(): string {
  return process.env.IOS_TEAM_ID ?? 'J22N5WHHN9';
}

export function getIosBundleId(): string {
  return process.env.IOS_BUNDLE_ID ?? 'com.nuvate.bestbond';
}

export function getAndroidPackageName(): string {
  return process.env.ANDROID_PACKAGE_NAME ?? 'com.nuvate.bestbond';
}

export function getAndroidAppLinkSha256Fingerprints(): string[] {
  const raw = process.env.ANDROID_APP_LINK_SHA256 ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
