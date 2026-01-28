import { IsNumber, IsOptional, IsInt, IsString } from 'class-validator';

export class SellAssetDto {
  @IsNumber()
  amount: number; // proceeds NETOS (recomendado)

  @IsOptional()
  @IsNumber()
  fee?: number; // comisión informativa (no afecta a wallets si amount es neto)

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  date?: string; // ISO

    @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsInt()
  toWalletId: number; // wallet cash destino

  @IsOptional()
  @IsInt()
  fromWalletId?: number; // opcional; si no, usaré la primera wallet investment
}
