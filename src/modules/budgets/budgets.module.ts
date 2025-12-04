import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BudgetsCron } from './bugets.cron';

@Module({
  imports: [PrismaModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetsCron],
})
export class BudgetsModule {}
