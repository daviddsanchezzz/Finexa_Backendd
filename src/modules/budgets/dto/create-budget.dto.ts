import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';

export enum BudgetPeriod {
  daily = 'daily',
  weekly = 'weekly',
  monthly = 'monthly',
  yearly = 'yearly',
}

export class CreateBudgetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(BudgetPeriod)
  period: BudgetPeriod;

  @IsNumber()
  limit: number;

  @IsDateString()
  startDate: string;

  @IsOptional()
  categoryId?: number;

  @IsOptional()
  walletId?: number;
}
