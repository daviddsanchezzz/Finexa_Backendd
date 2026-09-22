import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from "class-validator";
import { BudgetPeriod } from "@prisma/client";
import { BudgetCategoryLimitDto } from "./budget-category-limit.dto";

export class CreateBudgetDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @IsDateString()
  startDate!: string;

  // Límite global opcional. Debe existir totalLimit o al menos un categoryLimit.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  totalLimit?: number | null;

  // ISO 4217. Si no se manda, el service la rellena con la moneda base del
  // usuario. Todos los importes de este presupuesto (limite y gasto) se
  // comparan en esta moneda, sin importar la moneda de cada cartera incluida.
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetCategoryLimitDto)
  categoryLimits?: BudgetCategoryLimitDto[];

  // Carteras a las que aplica; vacío/omitido = todas.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  walletIds?: number[];

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsBoolean()
  carryOverRemaining?: boolean;
}
