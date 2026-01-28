import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MonthDataService } from './month-data.service';
import { MonthDataController } from './month-data.controller';
import { MonthDataCron } from './month-data.cron';

@Module({
  imports: [PrismaModule],
  controllers: [MonthDataController],
  providers: [MonthDataService, MonthDataCron],
})
export class MonthDataModule {}
