import { IsDateString, IsEnum, IsOptional } from "class-validator";
import { BudgetPeriod } from "@prisma/client";

export class BudgetsOverviewQueryDto {
  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod; // si viene, filtra budgets por period

  @IsOptional()
  @IsDateString()
  date?: string; // fecha de referencia; si no viene, hoy
}
