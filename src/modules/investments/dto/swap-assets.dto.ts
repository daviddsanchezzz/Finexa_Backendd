// src/investments/dto/swap-assets.dto.ts
import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class SwapAssetsDto {
  @IsInt()
  fromAssetId: number;

  @IsInt()
  toAssetId: number;

  @IsNumber()
  amountOut: number; // lo que "sale" del asset origen (en tu unidad monetaria)

  @IsOptional()
  @IsNumber()
  amountIn?: number; // si no viene, se asume = amountOut

  @IsOptional()
  @IsNumber()
  fee?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  date?: string; // ISO

  @IsOptional()
  @IsString()
  swapGroupId?: string; // opcional (si lo generas desde frontend)
}
