import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TransactionsRecurringScheduler } from './transactions-recurring.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRecurringScheduler],
  exports: [TransactionsService],
})
export class TransactionsModule {}
