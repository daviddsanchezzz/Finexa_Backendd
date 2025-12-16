import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";
import { BudgetPeriod } from "@prisma/client";

export class CreateBudgetDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @IsNumber()
  @IsPositive()
  limit!: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsNumber()
  categoryId?: number | null;

  @IsOptional()
  @IsNumber()
  walletId?: number | null;
}
