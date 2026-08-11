import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AdjustUserPointsDto {
  /** Add-only: positive integer, capped to guard against typos (e.g. an extra zero). */
  @IsInt()
  @Min(1)
  @Max(10_000)
  points!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
