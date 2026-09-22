import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  EXCHANGE_RATE_PROVIDER,
  PIVOT_CURRENCY,
  ZERO_DECIMAL_CURRENCIES,
} from './currency.constants';
import type { ExchangeRateProvider } from './currency.types';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

@Injectable()
export class CurrencyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXCHANGE_RATE_PROVIDER) private readonly provider: ExchangeRateProvider,
  ) {}

  // Tipo EUR->quote más reciente en cache (lo escribe el cron). Devuelve null
  // si no hay ninguna fila todavía para esa moneda.
  private async latestPivotRate(quote: string): Promise<Prisma.Decimal | null> {
    const row = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote },
      orderBy: { date: 'desc' },
    });
    return row ? new Prisma.Decimal(row.rate) : null;
  }

  async getCurrentRate(from: string, to: string): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    if (from === PIVOT_CURRENCY) {
      const rate = await this.latestPivotRate(to);
      if (!rate)
        throw new ServiceUnavailableException(`No hay tipo de cambio EUR->${to} disponible.`);
      return rate;
    }
    if (to === PIVOT_CURRENCY) {
      const rate = await this.latestPivotRate(from);
      if (!rate)
        throw new ServiceUnavailableException(`No hay tipo de cambio EUR->${from} disponible.`);
      return new Prisma.Decimal(1).dividedBy(rate);
    }

    // Cruce: from->EUR->to, ninguna fila propia para el par.
    const [fromToEur, eurToTarget] = await Promise.all([
      this.getCurrentRate(from, PIVOT_CURRENCY),
      this.getCurrentRate(PIVOT_CURRENCY, to),
    ]);
    return fromToEur.times(eurToTarget);
  }

  async convert(
    amount: number | Prisma.Decimal,
    from: string,
    to: string,
    date?: Date,
  ): Promise<Prisma.Decimal> {
    const rate = date
      ? await this.getHistoricalRate(from, to, date)
      : await this.getCurrentRate(from, to);
    return new Prisma.Decimal(amount).times(rate);
  }

  async convertToBase(
    userId: number,
    amount: number | Prisma.Decimal,
    currency: string,
    date?: Date,
  ): Promise<Prisma.Decimal> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currency: true },
    });
    const base = user?.currency ?? PIVOT_CURRENCY;
    return this.convert(amount, currency, base, date);
  }

  async getHistoricalRate(from: string, to: string, date: Date): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    if (from !== PIVOT_CURRENCY && to !== PIVOT_CURRENCY) {
      const [fromToEur, eurToTarget] = await Promise.all([
        this.getHistoricalRate(from, PIVOT_CURRENCY, date),
        this.getHistoricalRate(PIVOT_CURRENCY, to, date),
      ]);
      return fromToEur.times(eurToTarget);
    }

    // A partir de aquí, uno de los dos es EUR: se busca/guarda como EUR->quote,
    // invirtiendo si hace falta.
    const quote = from === PIVOT_CURRENCY ? to : from;
    const day = startOfUtcDay(date);

    const existing = await this.prisma.exchangeRate.findFirst({
      where: { date: day, baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote },
    });
    let rate: Prisma.Decimal;

    if (existing) {
      rate = new Prisma.Decimal(existing.rate);
    } else {
      const fetched = await this.provider.getHistoricalRate(PIVOT_CURRENCY, quote, day);
      if (fetched != null) {
        const saved = await this.prisma.exchangeRate.upsert({
          where: {
            date_baseCurrency_quoteCurrency: {
              date: day,
              baseCurrency: PIVOT_CURRENCY,
              quoteCurrency: quote,
            },
          },
          create: {
            date: day,
            baseCurrency: PIVOT_CURRENCY,
            quoteCurrency: quote,
            rate: fetched,
            provider: 'frankfurter',
          },
          update: { rate: fetched, provider: 'frankfurter' },
        });
        rate = new Prisma.Decimal(saved.rate);
      } else {
        // Provider caído: fallback al último rate conocido ANTERIOR a esa fecha.
        // Nunca se inventa un número que no venga de una fila real o del provider.
        const fallback = await this.prisma.exchangeRate.findFirst({
          where: { baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote, date: { lt: day } },
          orderBy: { date: 'desc' },
        });
        if (!fallback) {
          throw new ServiceUnavailableException(
            `No se pudo obtener el tipo de cambio EUR->${quote} para ${day.toISOString().slice(0, 10)} ni hay uno anterior en cache.`,
          );
        }
        rate = new Prisma.Decimal(fallback.rate);
      }
    }

    return from === PIVOT_CURRENCY ? rate : new Prisma.Decimal(1).dividedBy(rate);
  }

  round(amount: number | Prisma.Decimal, currency: string): Prisma.Decimal {
    const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    return new Prisma.Decimal(amount).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
  }

  // Monedas realmente en uso hoy, más EUR siempre — lo consume el cron para
  // saber qué pedirle a Frankfurter cada día.
  async getActiveCurrencies(): Promise<string[]> {
    const [wallets, transactions, goals, trips, budgets, debts, assets, users] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { active: true },
        select: { currency: true },
        distinct: ['currency'],
      }),
      this.prisma.transaction.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.goal.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.trip.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.budget.findMany({
        where: { active: true },
        select: { currency: true },
        distinct: ['currency'],
      }),
      this.prisma.debt.findMany({
        where: { active: true },
        select: { currency: true },
        distinct: ['currency'],
      }),
      this.prisma.investmentAsset.findMany({
        where: { active: true },
        select: { currency: true },
        distinct: ['currency'],
      }),
      this.prisma.user.findMany({
        where: { active: true },
        select: { currency: true },
        distinct: ['currency'],
      }),
    ]);
    const all = [wallets, transactions, goals, trips, budgets, debts, assets, users]
      .flat()
      .map((r) => r.currency)
      .filter((c): c is string => !!c);
    return Array.from(new Set([PIVOT_CURRENCY, ...all]));
  }
}
