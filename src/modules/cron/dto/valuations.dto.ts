import {
  ArrayMinSize,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertValuationItemDto {
  @IsInt()
  userId: number;

  @IsInt()
  assetId: number;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsOptional()
  @IsString()
  unitPrice?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class UpsertValuationBatchDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ValidateNested({ each: true })
  @Type(() => UpsertValuationItemDto)
  @ArrayMinSize(1)
  items: UpsertValuationItemDto[];
}
