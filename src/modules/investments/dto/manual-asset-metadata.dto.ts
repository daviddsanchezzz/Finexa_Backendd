import { IsArray, IsDateString, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ManualHoldingDto {
  @IsString()
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ticker?: string;

  @IsNumber()
  weight: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sector?: string;
}

export class ManualAssetMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  sourceUrl?: string;

  @IsOptional()
  @IsDateString()
  asOfDate?: string;

  @IsOptional()
  @IsObject()
  countries?: Record<string, number>;

  @IsOptional()
  @IsObject()
  sectors?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualHoldingDto)
  topHoldings?: ManualHoldingDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cryptoCategory?: string;
}
