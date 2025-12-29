import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min} from 'class-validator';

export enum InvestmentAssetType {
  crypto = 'crypto',
  etf = 'etf',
  stock = 'stock',
  fund = 'fund',
  custom = 'custom',
}

export enum InvestmentRiskType {
fixed_income =   'fixed_income',
  variable_income = 'variable_income',
}

export class CreateInvestmentAssetDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsString()
  @MaxLength(120)
  description: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialInvested?: number;


  @IsOptional()
  @IsEnum(InvestmentAssetType)
  type?: InvestmentAssetType;

  @IsOptional()
  @IsEnum(InvestmentRiskType)
  riskType?: InvestmentRiskType;


  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string; // default EUR si no viene
}
