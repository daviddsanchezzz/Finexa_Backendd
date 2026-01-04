import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class WithdrawAssetDto {
  @IsNumber()
  amount: number;

  @IsInt()
  toWalletId: number; // cash wallet destino

  @IsOptional()
  @IsInt()
  fromWalletId?: number; // investment wallet origen (si no viene, primera investment)

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
