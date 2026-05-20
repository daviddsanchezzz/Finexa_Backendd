import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class RebalancePreviewDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minOperation?: number;
}
