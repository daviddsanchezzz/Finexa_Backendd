import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { UserModule } from './modules/users/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { SubcategoriesModule } from './modules/categories/subcategories/subcategories.module';
import { MonthDataModule } from './modules/monthData/month-data.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DebtsModule } from './modules/debts/debts.module';
import { TripsModule } from './modules/trips/trips.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AllocationPlanModule } from './modules/monthly-allocations/monthly-allocations.module';

@Module({
  imports: [PrismaModule, UserModule, AllocationPlanModule, ReportsModule, TripsModule, InvestmentsModule  ,DebtsModule, AuthModule, WalletsModule, BudgetsModule, 
    DashboardModule, CategoriesModule, TransactionsModule, SubcategoriesModule, MonthDataModule,
    ScheduleModule.forRoot()],
})
export class AppModule {}
