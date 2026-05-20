import { Matches } from 'class-validator';

/** Indian mobile in MSG91 format: country code 91 + 10 digits (no + prefix). */
export class SendOtpDto {
  @Matches(/^91[6-9]\d{9}$/, {
    message:
      'mobile must be 12 digits: 91 followed by a valid 10-digit Indian mobile',
  })
  mobile!: string;
}
