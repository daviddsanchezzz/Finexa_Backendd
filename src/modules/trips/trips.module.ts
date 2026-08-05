import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { AerodataboxService } from './aviationstack.service';
import { TripsRemindersScheduler } from './trips-reminders.scheduler';

@Module({
  imports: [PrismaModule, NotificationsModule, TransactionsModule],
  controllers: [TripsController],
  providers: [TripsService, AerodataboxService, TripsRemindersScheduler],
})
export class TripsModule {}