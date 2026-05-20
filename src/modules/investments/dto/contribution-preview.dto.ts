import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class ContributionPreviewDto {
  @IsNumber()
  @Type(() => Number)
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minOperation?: number;
}
