import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAdminPreferencesDto {
  @IsOptional()
  @IsBoolean()
  quickLoginPinEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  highValueRedemptions?: boolean;

  @IsOptional()
  @IsBoolean()
  couponExportFailures?: boolean;

  @IsOptional()
  @IsBoolean()
  suspiciousUserActivity?: boolean;
}
