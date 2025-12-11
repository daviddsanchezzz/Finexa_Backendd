import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TransactionsRecurringScheduler } from './transactions-recurring.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRecurringScheduler],
})
export class TransactionsModule {}
