import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegionItemDto {
  @IsString()
  @MaxLength(120)
  country: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  pct: number;
}

export class SectorItemDto {
  @IsString()
  @MaxLength(120)
  sector: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  pct: number;
}

export class HoldingItemDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ticker?: string;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class UpsertCompositionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegionItemDto)
  regions?: RegionItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectorItemDto)
  sectors?: SectorItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HoldingItemDto)
  holdings?: HoldingItemDto[];
}
