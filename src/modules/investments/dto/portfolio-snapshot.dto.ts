import { IsISO8601, IsInt, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class ListPortfolioSnapshotsQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  limit?: number;
}
