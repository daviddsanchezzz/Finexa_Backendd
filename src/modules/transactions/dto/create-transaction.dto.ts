import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, IsInt } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  @IsIn(['income', 'expense', 'transfer'])
  type: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  date?: string; // ISO string

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly', 'yearly'], {
    message: 'recurrence must be daily, weekly, monthly or yearly',
  })
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @IsOptional()
  @IsInt()
  fromWalletId?: number;

  @IsOptional()
  @IsInt()
  toWalletId?: number;

  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsInt()
  subcategoryId?: number;

  @IsOptional()
  @IsInt()
  tripId?: number;

  @IsOptional()
  @IsInt()
  parentId?: number;
}
