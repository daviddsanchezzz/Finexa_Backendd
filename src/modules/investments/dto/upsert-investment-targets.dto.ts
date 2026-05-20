import { Type } from 'class-transformer';
import { IsArray, IsNumber, Min, Max, ValidateNested } from 'class-validator';

export class InvestmentTargetItemDto {
  @IsNumber()
  @Type(() => Number)
  assetId: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  targetPct: number;
}

export class UpsertInvestmentTargetsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvestmentTargetItemDto)
  items: InvestmentTargetItemDto[];
}
