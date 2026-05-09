import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CustomerOtpSignupDto {
  @IsString()
  @Matches(/^[0-9]{10}$/)
  phone!: string;

  @IsString()
  @Length(1, 5)
  countryCode!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;

  /** Customer trade selection (mobile signup) */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  profession?: string;

  /** Delivery address (captured on signup so profile is complete without a second screen) */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryAddress?: string;
}

