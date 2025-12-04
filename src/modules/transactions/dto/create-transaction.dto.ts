import { IsString, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  type: string; // income, expense, transfer

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsString()
  recurrence?: string;

  @IsOptional()
  walletId?: number;

  @IsOptional()
  fromWalletId?: number;

  @IsOptional()
  toWalletId?: number;

  @IsOptional()
  categoryId?: number;

  @IsOptional()
  subcategoryId?: number;
}
