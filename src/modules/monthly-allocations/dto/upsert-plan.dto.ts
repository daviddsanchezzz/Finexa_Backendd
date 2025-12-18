import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateAllocationPlanDto {
  @IsNumber()
  @Min(0)
  income: number;

  @IsOptional()
  @IsString()
  currency?: string; // lo dejamos por si futuro, ahora fija EUR
}
