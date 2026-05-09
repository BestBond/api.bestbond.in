import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

