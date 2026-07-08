import {
  addMs,
  computePointsExpireInDays,
  initialWalletPointsExpiresAt,
  WALLET_POINTS_VALIDITY_MS,
} from './points-expiry.util';

describe('points-expiry.util', () => {
  it('sets first expiry one year after account creation', () => {
    const createdAt = new Date('2025-06-18T10:00:00.000Z');
    const expiresAt = initialWalletPointsExpiresAt(createdAt);
    expect(expiresAt.getTime()).toBe(
      addMs(createdAt, WALLET_POINTS_VALIDITY_MS).getTime(),
    );
  });

  it('computes whole days until expiry', () => {
    const now = new Date('2026-06-17T12:00:00.000Z');
    const expiresAt = new Date('2026-06-18T10:00:00.000Z');
    expect(computePointsExpireInDays(expiresAt, now)).toBe(1);
  });

  it('returns 0 on expiry day or after', () => {
    const expiresAt = new Date('2026-06-18T10:00:00.000Z');
    expect(
      computePointsExpireInDays(expiresAt, new Date('2026-06-18T10:00:00.000Z')),
    ).toBe(0);
    expect(
      computePointsExpireInDays(expiresAt, new Date('2026-06-19T00:00:00.000Z')),
    ).toBe(0);
  });
});
