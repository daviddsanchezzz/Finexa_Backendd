import { IsNumber, IsOptional, Max, Min } from 'class-validator';

const MAX = 10_000_000;

export class SimulateDto {
  /** Gastar menos cada mes (€/mes). */
  @IsOptional() @IsNumber() @Min(0) @Max(MAX) extraMonthlySavings?: number;
  /** Gasto puntual que sale de la liquidez (€). */
  @IsOptional() @IsNumber() @Min(0) @Max(MAX) oneOffExpense?: number;
  /** Pasar más ahorro a inversión (€/mes): solo afecta a la métrica de aportación. */
  @IsOptional() @IsNumber() @Min(0) @Max(MAX) extraMonthlyInvestment?: number;
}
