import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsArray, ArrayNotEmpty, IsInt } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  emoji: string;

  @IsNumber()
  @IsOptional()
  balance?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  position?: number;
}

export class ReorderWalletsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  order: number[];   // [id1, id2, id3...]
}
