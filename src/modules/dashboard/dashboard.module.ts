import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from '../../common/prisma/prisma.module'; // 👈 import necesario
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [PrismaModule, CurrencyModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
