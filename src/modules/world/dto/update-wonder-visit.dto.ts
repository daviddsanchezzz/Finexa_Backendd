import { IsBoolean, IsOptional, IsDateString, IsUrl, IsIn, IsInt, IsPositive } from "class-validator";

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
  @IsIn(["top", "center", "bottom"])
  photoAlign?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  tripId?: number;
}
