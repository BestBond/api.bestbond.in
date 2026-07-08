/** Wallet points validity period from account anniversary (1 year in app). */
export const WALLET_POINTS_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function initialWalletPointsExpiresAt(createdAt: Date): Date {
  return addMs(createdAt, WALLET_POINTS_VALIDITY_MS);
}

export function computePointsExpireInDays(
  expiresAt: Date,
  now = new Date(),
): number {
  const diffMs = expiresAt.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

export function serializeWalletExpiry(
  expiresAt: Date | null | undefined,
  now = new Date(),
): { pointsExpiresAt: string | null; pointsExpireInDays: number | null } {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { pointsExpiresAt: null, pointsExpireInDays: null };
  }
  return {
    pointsExpiresAt: expiresAt.toISOString(),
    pointsExpireInDays: computePointsExpireInDays(expiresAt, now),
  };
}
