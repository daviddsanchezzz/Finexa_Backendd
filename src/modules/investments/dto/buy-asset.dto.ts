// src/investments/dto/buy-asset.dto.ts
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class BuyAssetDto {
  @IsNumber()
  amount: number; // dinero que sale del cash (neto)

  @IsNumber()
  fromWalletId: number; // cash wallet

  @IsOptional()
  @IsNumber()
  toWalletId?: number; // investment wallet (opcional)

  @IsOptional()
  @IsNumber()
  fee?: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
