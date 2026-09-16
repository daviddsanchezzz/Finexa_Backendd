import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class BudgetsHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  count?: number; // nº de periodos a devolver (incluye el actual); por defecto 6
}
