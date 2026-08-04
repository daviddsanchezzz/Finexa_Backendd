import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { AerodataboxService } from './aviationstack.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [TripsController],
  providers: [TripsService,   AerodataboxService],
})
export class TripsModule {}