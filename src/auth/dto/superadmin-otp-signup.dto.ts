import { IsString, Length, Matches, MaxLength } from 'class-validator';

export class SuperadminOtpSignupDto {
  @IsString()
  @Matches(/^[0-9]{10}$/)
  phone!: string;

  @IsString()
  @Length(1, 5)
  countryCode!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MaxLength(100)
  email!: string;
}

