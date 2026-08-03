import { IsBoolean, IsOptional, IsDateString, IsString, IsInt } from "class-validator";

export class UpdateWonderVisitDto {
  @IsBoolean()
  visited: boolean;

  @IsOptional()
  @IsDateString()
  visitedAt?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsInt()
  tripId?: number;
}
