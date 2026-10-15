import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export const INCOME_TYPES = ['salaried', 'variable', 'self_employed', 'student', 'other'] as const;

// Todos los campos son opcionales; enviar null borra el valor guardado.
export class UpdateFinancialProfileDto {
  @IsOptional() @IsInt() @Min(1900) @Max(new Date().getUTCFullYear()) birthYear?: number | null;
  @IsOptional() @IsIn(INCOME_TYPES as unknown as string[]) incomeType?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(20) dependents?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) riskTolerance?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) emergencyMonthsTarget?: number | null;
  @IsOptional() @IsInt() @Min(5) @Max(100) fiTargetMultiple?: number | null;
  @IsOptional() @IsInt() @Min(18) @Max(100) fiTargetAge?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(15) expectedRealReturnPct?: number | null;
}
