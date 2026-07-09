/**
 * Canonical phone helpers for auth.
 * Stored / lookup form: +<country digits><10-digit national>
 * (e.g. +919611299129).
 */

/** Digits-only country calling code (e.g. "91"). */
export function digitsCountryCode(countryCode: string): string {
  return String(countryCode ?? '').replace(/\D/g, '');
}

/**
 * Normalize a national mobile number for lookup/storage.
 * - Strips non-digits and spaces
 * - Drops a pasted country-code prefix when present
 * - For India (+91): drops a leading trunk `0` (e.g. 09611299129 → 9611299129)
 */
export function normalizeNationalPhone(
  countryCode: string,
  raw: string,
): string {
  const cc = digitsCountryCode(countryCode);
  let digits = String(raw ?? '').replace(/\D/g, '');

  if (cc && digits.startsWith(cc) && digits.length > cc.length + 9) {
    digits = digits.slice(cc.length);
  }

  // India trunk prefix: 0 + 10-digit mobile
  if (cc === '91' && digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits;
}

/**
 * Single canonical form: +<country digits><national digits>
 */
export function normalizeAuthPhone(
  countryCode: string,
  nationalNumber: string,
): string {
  const cc = digitsCountryCode(countryCode);
  const nn = normalizeNationalPhone(countryCode, nationalNumber);
  return `+${cc}${nn}`;
}
