import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MonthDataService } from './month-data.service';
import { MonthDataController } from './month-data.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MonthDataController],
  providers: [MonthDataService],
})
export class MonthDataModule {}
