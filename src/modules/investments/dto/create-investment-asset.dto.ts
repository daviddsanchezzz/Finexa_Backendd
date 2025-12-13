import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min} from 'class-validator';

export enum InvestmentAssetType {
  crypto = 'crypto',
  etf = 'etf',
  stock = 'stock',
  fund = 'fund',
  custom = 'custom',
}

export class CreateInvestmentAssetDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialInvested?: number;


  @IsOptional()
  @IsEnum(InvestmentAssetType)
  type?: InvestmentAssetType;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string; // default EUR si no viene
}
