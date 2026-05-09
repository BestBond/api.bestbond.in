import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOperationalAdminDto {
  @IsEmail()
  email!: string;

  /**
   * Optional: if omitted, backend generates a strong temporary password.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  tempPassword?: string;
}
