import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurrencyService } from './currency.service';
import { EXCHANGE_RATE_PROVIDER } from './currency.constants';
import { FrankfurterProvider } from './frankfurter.provider';
import { ExchangeRateUpdaterScheduler } from './exchange-rate-updater.scheduler';

@Module({
  imports: [PrismaModule],
  providers: [CurrencyService, ExchangeRateUpdaterScheduler, { provide: EXCHANGE_RATE_PROVIDER, useClass: FrankfurterProvider }],
  exports: [CurrencyService],
})
export class CurrencyModule {}
