import { IsString, MinLength } from 'class-validator';

export class RedeemCouponDto {
  @IsString()
  @MinLength(4)
  code!: string;
}
