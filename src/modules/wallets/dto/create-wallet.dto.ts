import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsArray, ArrayNotEmpty, IsInt, IsEnum } from 'class-validator';
import { WalletKind } from '@prisma/client';

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

  @IsEnum(WalletKind)
  @IsOptional()
  kind?: WalletKind;
}

export class ReorderWalletsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  order: number[];   // [id1, id2, id3...]
}
