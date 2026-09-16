import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TransactionsRecurringScheduler } from './transactions-recurring.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { BudgetsModule } from '../budgets/budgets.module';

@Module({
  imports: [PrismaModule, NotificationsModule, BudgetsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRecurringScheduler],
  exports: [TransactionsService],
})
export class TransactionsModule {}
