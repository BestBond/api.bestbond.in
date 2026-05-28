/** Physical print size (mm). */
export const COUPON_W_MM = 101;
export const COUPON_H_MM = 38;

/** Keep artwork inside this inset so die-cutting does not clip content. */
export const COUPON_SAFE_INSET_MM = 5;

/** SVG user units per mm (viewBox matches physical size). */
export const COUPON_UNITS_PER_MM = 10;

export const COUPON_DESIGN_W = COUPON_W_MM * COUPON_UNITS_PER_MM;
export const COUPON_DESIGN_H = COUPON_H_MM * COUPON_UNITS_PER_MM;
export const COUPON_SAFE_INSET_U = COUPON_SAFE_INSET_MM * COUPON_UNITS_PER_MM;

export const COUPON_INNER_W = COUPON_DESIGN_W - 2 * COUPON_SAFE_INSET_U;
export const COUPON_INNER_H = COUPON_DESIGN_H - 2 * COUPON_SAFE_INSET_U;

/** A4 print layout (@page margin matches coupons.service). */
export const COUPON_A4_PAGE_MARGIN_MM = 10;

/** Center 101 mm coupon on 210 mm A4 (Puppeteer margins must be numeric, not auto). */
export const COUPON_A4_HORIZONTAL_MARGIN_MM = (210 - COUPON_W_MM) / 2;

export function couponFrontsPerA4Page(): number {
  const printableH = 297 - 2 * COUPON_A4_PAGE_MARGIN_MM;
  return Math.max(1, Math.floor(printableH / COUPON_H_MM));
}
