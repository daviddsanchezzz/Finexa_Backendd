import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrencyService } from './currency.service';
import { EXCHANGE_RATE_PROVIDER, PIVOT_CURRENCY } from './currency.constants';
import type { ExchangeRateProvider } from './currency.types';

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class ExchangeRateUpdaterScheduler {
  private readonly logger = new Logger(ExchangeRateUpdaterScheduler.name);

  constructor(
    private readonly currencyService: CurrencyService,
    @Inject(EXCHANGE_RATE_PROVIDER) private readonly provider: ExchangeRateProvider,
    private readonly prisma: PrismaService,
  ) {}

  // 07:00 todos los días — mismo patrón que TransactionsRecurringScheduler.
  @Cron('0 0 7 * * *')
  async handleDailyUpdate() {
    try {
      const active = await this.currencyService.getActiveCurrencies();
      const quotes = active.filter((c) => c !== PIVOT_CURRENCY);
      if (!quotes.length) return;

      const rates = await this.provider.getLatestRates(PIVOT_CURRENCY, quotes);
      const date = todayUtc();

      for (const [quoteCurrency, rate] of Object.entries(rates)) {
        await this.prisma.exchangeRate.upsert({
          where: {
            date_baseCurrency_quoteCurrency: { date, baseCurrency: PIVOT_CURRENCY, quoteCurrency },
          },
          create: {
            date,
            baseCurrency: PIVOT_CURRENCY,
            quoteCurrency,
            rate,
            provider: 'frankfurter',
          },
          update: { rate, provider: 'frankfurter' },
        });
      }
      this.logger.log(`Tipos de cambio actualizados para ${Object.keys(rates).length} monedas.`);
    } catch (error) {
      this.logger.error('Error al actualizar tipos de cambio', error as Error);
    }
  }
}
