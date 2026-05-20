import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateInvestmentValuationBatchItemDto {
  @IsNumber()
  @Type(() => Number)
  assetId: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  value: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;
}

export class CreateInvestmentValuationsBatchDto {
  @IsDateString()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvestmentValuationBatchItemDto)
  items: CreateInvestmentValuationBatchItemDto[];
}

