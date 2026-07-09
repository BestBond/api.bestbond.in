import { IsString, Length, Matches } from 'class-validator';
import { AuthPhoneField } from './phone-field';

export class AdminPasscodeLoginDto {
  @AuthPhoneField()
  phone!: string;

  @IsString()
  @Length(1, 5)
  countryCode!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  passcode!: string;
}
