import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateInvestmentValuationDto {
  @IsNumber()
  assetId: number;

  // fin de mes o la fecha que tú quieras (ISO string)
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0)
  value: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string; // default EUR si no viene
}
