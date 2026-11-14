import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../common/prisma/prisma.module';
import { DashboardModule } from '../../dashboard/dashboard.module';
import { InvestmentsModule } from '../../investments/investments.module';
import { BudgetsModule } from '../../budgets/budgets.module';
import { GoalsModule } from '../../goals/goals.module';
import { DebtsModule } from '../../debts/debts.module';
import { MonthDataModule } from '../../monthData/month-data.module';
import { VidaIntegrationController } from './vida-integration.controller';
import { VidaIntegrationGuard } from './vida-integration.guard';
import { VidaIntegrationService } from './vida-integration.service';

@Module({
  imports: [PrismaModule, DashboardModule, InvestmentsModule, BudgetsModule, GoalsModule, DebtsModule, MonthDataModule],
  controllers: [VidaIntegrationController],
  providers: [VidaIntegrationService, VidaIntegrationGuard],
})
export class VidaIntegrationModule {}
