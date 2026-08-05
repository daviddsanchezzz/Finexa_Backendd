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
  @IsBoolean()
  excludeFromStats?: boolean;

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
  investmentAssetId?: number | null;

  @IsOptional()
  @IsInt()
  tripId?: number;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  parentId?: number;

  // Si la subcategoría elegida pertenece a un viaje y esto viene relleno,
  // el gasto se clasifica directamente en el itinerario del viaje (sin
  // pasar por el estado "pendiente de clasificar").
  @IsOptional()
  @IsIn(['accommodation', 'transport_local', 'food', 'activities', 'leisure', 'shopping', 'other'])
  tripExpenseCategory?: string;
}
