import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  recurringTransactions?: boolean;

  @IsOptional()
  @IsBoolean()
  budgetThresholdAlerts?: boolean;
}
