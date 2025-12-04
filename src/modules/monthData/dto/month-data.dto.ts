import { IsInt, IsNumber, Min, Max, IsOptional } from "class-validator";

export class MonthDataDto {
  @IsInt()
  year: number;

  @IsInt()
  @Min(0)
  @Max(11)
  month: number;

  @IsNumber()
  @IsOptional()
  income?: number; // ingresos manuales para ese mes

  @IsNumber()
  @IsOptional()
  expense?: number; // gastos manuales para ese mes

  @IsNumber()
  @IsOptional()
  finalBalance?: number; // balance manuales para ese mes

}
