import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class AdminOtpLoginDto {
  @IsString()
  @Matches(/^[0-9]{10}$/)
  phone!: string;

  @IsString()
  @Length(1, 5)
  countryCode!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  /** Required for SUPERADMIN login; omit or leave empty for operational admin (OTP-only). */
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
