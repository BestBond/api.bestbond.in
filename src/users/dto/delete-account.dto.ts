import { IsString, Matches } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Passcode must be 6 digits' })
  passcode!: string;
}
