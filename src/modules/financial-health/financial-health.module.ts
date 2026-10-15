import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurrencyModule } from '../currency/currency.module';
import { FinancialHealthController } from './financial-health.controller';
import { FinancialHealthService } from './financial-health.service';

@Module({
  imports: [PrismaModule, CurrencyModule],
  controllers: [FinancialHealthController],
  providers: [FinancialHealthService],
})
export class FinancialHealthModule {}
