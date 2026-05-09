/**
 * Single canonical form for OTP + user phone: +<country digits><national digits>
 * (e.g. +91 + 10-digit Indian mobile). Prevents duplicate accounts from +91 vs 91 vs missing +.
 */
export function normalizeAuthPhone(
  countryCode: string,
  nationalNumber: string,
): string {
  const cc = countryCode.replace(/\D/g, '');
  const nn = nationalNumber.replace(/\D/g, '');
  return `+${cc}${nn}`;
}
