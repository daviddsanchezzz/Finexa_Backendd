import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from './currency.service';
import { ExchangeRateProvider } from './currency.types';

function buildPrismaMock() {
  return {
    exchangeRate: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    wallet: { findMany: jest.fn().mockResolvedValue([]) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
    trip: { findMany: jest.fn().mockResolvedValue([]) },
    budget: { findMany: jest.fn().mockResolvedValue([]) },
    debt: { findMany: jest.fn().mockResolvedValue([]) },
    investmentAsset: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
  } as any;
}

function buildProviderMock(): jest.Mocked<ExchangeRateProvider> {
  return { getLatestRates: jest.fn(), getHistoricalRate: jest.fn() };
}

describe('CurrencyService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let provider: jest.Mocked<ExchangeRateProvider>;
  let service: CurrencyService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    provider = buildProviderMock();
    service = new CurrencyService(prisma, provider);
  });

  it('from === to no toca la base de datos', async () => {
    const rate = await service.getCurrentRate('EUR', 'EUR');
    expect(rate.toNumber()).toBe(1);
    expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('getCurrentRate EUR->CHF lee la fila más reciente en cache', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const rate = await service.getCurrentRate('EUR', 'CHF');
    expect(rate.toString()).toBe('0.9393');
  });

  it('getCurrentRate CHF->EUR invierte la fila EUR->CHF', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const rate = await service.getCurrentRate('CHF', 'EUR');
    expect(rate.toNumber()).toBeCloseTo(1 / 0.9393, 6);
  });

  it('getCurrentRate CHF->USD hace cross-rate vía EUR sin fila propia', async () => {
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('0.9393') }) // EUR->CHF
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('1.1463') }); // EUR->USD
    const rate = await service.getCurrentRate('CHF', 'USD');
    expect(rate.toNumber()).toBeCloseTo(1.1463 / 0.9393, 6);
  });

  it('convert aplica el rate al importe', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const converted = await service.convert(100, 'EUR', 'CHF');
    expect(converted.toNumber()).toBeCloseTo(93.93, 2);
  });

  it('convertToBase usa la moneda del usuario', async () => {
    prisma.user.findUnique.mockResolvedValue({ currency: 'CHF' });
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const converted = await service.convertToBase(1, 100, 'EUR');
    expect(converted.toNumber()).toBeCloseTo(93.93, 2);
  });

  it('getHistoricalRate lee primero la fila exacta de esa fecha', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.94') });
    const rate = await service.getHistoricalRate('EUR', 'CHF', date);
    expect(rate.toString()).toBe('0.94');
    expect(provider.getHistoricalRate).not.toHaveBeenCalled();
  });

  it('getHistoricalRate sin fila cae al provider y la persiste', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst.mockResolvedValue(null);
    provider.getHistoricalRate.mockResolvedValue(0.94);
    prisma.exchangeRate.upsert.mockResolvedValue({ rate: new Prisma.Decimal('0.94') });

    const rate = await service.getHistoricalRate('EUR', 'CHF', date);

    expect(rate.toString()).toBe('0.94');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date_baseCurrency_quoteCurrency: { date, baseCurrency: 'EUR', quoteCurrency: 'CHF' } },
        create: expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'CHF', provider: 'frankfurter' }),
      }),
    );
  });

  it('provider caído sin cache previo: excepción controlada', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce(null) // fila exacta
      .mockResolvedValueOnce(null); // fallback: ninguna fila anterior
    provider.getHistoricalRate.mockResolvedValue(null);

    await expect(service.getHistoricalRate('EUR', 'CHF', date)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('provider caído con cache previo: usa el último rate conocido', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce(null) // fila exacta para esa fecha
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('0.93') }); // última fila anterior
    provider.getHistoricalRate.mockResolvedValue(null);

    const rate = await service.getHistoricalRate('EUR', 'CHF', date);
    expect(rate.toString()).toBe('0.93');
  });

  it('round: JPY sin decimales, EUR con 2', () => {
    expect(service.round(1234.567, 'JPY').toString()).toBe('1235');
    expect(service.round(1234.567, 'EUR').toString()).toBe('1234.57');
  });

  it('getActiveCurrencies incluye EUR siempre, sin duplicados', async () => {
    prisma.wallet.findMany.mockResolvedValue([{ currency: 'CHF' }]);
    prisma.transaction.findMany.mockResolvedValue([{ currency: 'CHF' }, { currency: 'USD' }]);
    const currencies = await service.getActiveCurrencies();
    expect(currencies.sort()).toEqual(['CHF', 'EUR', 'USD']);
  });
});
