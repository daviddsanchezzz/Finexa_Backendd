import { IsBoolean, IsOptional, IsDateString, IsUrl, IsNumber, Min, Max, IsInt, IsPositive } from "class-validator";

export class UpdateWonderVisitDto {
  @IsBoolean()
  visited: boolean;

  @IsOptional()
  @IsDateString()
  visitedAt?: string;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  photoUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  photoOffset?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  photoOffsetX?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  tripId?: number;
}
