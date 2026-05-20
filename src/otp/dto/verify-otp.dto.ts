import { Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @Matches(/^91[6-9]\d{9}$/, {
    message:
      'mobile must be 12 digits: 91 followed by a valid 10-digit Indian mobile',
  })
  mobile!: string;

  @Matches(/^\d+$/)
  @MinLength(4)
  @MaxLength(9)
  otp!: string;
}
