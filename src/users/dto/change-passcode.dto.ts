import { IsString, Matches } from 'class-validator';

export class ChangePasscodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  currentPasscode!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  newPasscode!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  confirmNewPasscode!: string;
}
