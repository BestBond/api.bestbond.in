import { IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuthPhoneField } from './phone-field';

export class SuperadminPasscodeSignupDto {
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

  @IsString()
  @MaxLength(100)
  fullName!: string;

  @IsString()
  @MaxLength(100)
  email!: string;
}
