import { IsString, Length, Matches } from 'class-validator';

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
}
