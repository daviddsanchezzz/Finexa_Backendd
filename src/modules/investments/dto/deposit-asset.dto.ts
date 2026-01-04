import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class DepositAssetDto {
  @IsNumber()
  amount: number;

  @IsInt()
  fromWalletId: number; // cash wallet origen

  @IsOptional()
  @IsInt()
  toWalletId?: number; // investment wallet destino (si no viene, primera investment)

  @IsOptional()
  @IsNumber()
  fee?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  date?: string; // ISO
}
