import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuthPhoneField } from './phone-field';

export class CustomerPasscodeSignupDto {
  @AuthPhoneField()
  phone!: string;

  @IsString()
  @Length(1, 5)
  countryCode!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  passcode!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  confirmPasscode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  profession?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryAddress?: string;
}
