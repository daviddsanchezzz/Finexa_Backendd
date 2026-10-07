import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ImportValuationsColumnMappingDto {
  @IsInt()
  @Type(() => Number)
  assetId: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;
}

export class ImportValuationsRowDto {
  @IsDateString()
  date: string;

  // columna (nombre tal cual lo devolvió /import/parse) -> valor numérico o null
  @IsObject()
  values: Record<string, number | null>;
}

export class CommitValuationsImportDto {
  // columna (nombre tal cual lo devolvió /import/parse) -> a qué activo mapearla
  @IsObject()
  mapping: Record<string, ImportValuationsColumnMappingDto>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportValuationsRowDto)
  rows: ImportValuationsRowDto[];
}
