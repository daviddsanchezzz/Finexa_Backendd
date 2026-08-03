import { IsEnum } from 'class-validator';

// Debe reflejar las keys del catálogo MODULES en el frontend
// (spendly/src/screens/Mobile/finances/financeModulesConfig.ts).
export enum FinanceModuleKeyDto {
  BUDGETS = 'budgets',
  GOALS = 'goals',
  DEBTS = 'debts',
  TRIPS = 'trips',
  PROJECTS = 'projects',
  RECURRING = 'recurring',
  MONTHLY_CONTRIBUTIONS = 'monthlyContributions',
  NET_WORTH = 'netWorth',
  INVESTMENTS = 'investments',
}

export class PinFinanceTabDto {
  @IsEnum(FinanceModuleKeyDto)
  moduleKey: FinanceModuleKeyDto;
}
