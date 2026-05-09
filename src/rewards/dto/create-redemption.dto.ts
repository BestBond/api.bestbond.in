import { IsOptional, IsString } from 'class-validator';

export class CreateRedemptionDto {
  @IsOptional()
  @IsString()
  deliveryLabel?: string; // e.g. "Office Site A"

  @IsOptional()
  @IsString()
  deliveryAddress?: string; // e.g. "123 Main St, Block B..."
}
