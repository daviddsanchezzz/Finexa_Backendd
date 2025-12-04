import { IsOptional, IsDateString, IsInt } from 'class-validator';

export class FilterDashboardDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  walletId?: number;
}
