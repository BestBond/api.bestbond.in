import { Transform } from 'class-transformer';
import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { normalizeNationalPhone } from '../phone.util';

/**
 * Accepts messy national phone input (spaces, leading 0 for India),
 * then validates the canonical 10-digit form.
 */
export function AuthPhoneField() {
  return applyDecorators(
    Transform(({ value, obj }) =>
      normalizeNationalPhone(
        String(obj?.countryCode ?? ''),
        String(value ?? ''),
      ),
    ),
    IsString(),
    Matches(/^[0-9]{10}$/, {
      message: 'phone must be a valid 10-digit mobile number',
    }),
  );
}
