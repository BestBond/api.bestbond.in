import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDealerRedemptionDto {
  @IsUUID()
  dealerUserId!: string;

  @IsUUID()
  rewardId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deliveryLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryAddress?: string | null;
}
