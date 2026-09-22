import { ExchangeRateUpdaterScheduler } from './exchange-rate-updater.scheduler';

describe('ExchangeRateUpdaterScheduler', () => {
  it('pide al provider todas las monedas activas salvo EUR y guarda una fila por cada una', async () => {
    const currencyService = { getActiveCurrencies: jest.fn().mockResolvedValue(['EUR', 'CHF', 'USD']) } as any;
    const provider = { getLatestRates: jest.fn().mockResolvedValue({ CHF: 0.9393, USD: 1.1463 }) } as any;
    const prisma = { exchangeRate: { upsert: jest.fn().mockResolvedValue({}) } } as any;

    const scheduler = new ExchangeRateUpdaterScheduler(currencyService, provider, prisma);
    await scheduler.handleDailyUpdate();

    expect(provider.getLatestRates).toHaveBeenCalledWith('EUR', ['CHF', 'USD']);
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.9393, provider: 'frankfurter' }) }),
    );
  });

  it('si el provider no devuelve rates, no falla ni escribe nada', async () => {
    const currencyService = { getActiveCurrencies: jest.fn().mockResolvedValue(['EUR', 'CHF']) } as any;
    const provider = { getLatestRates: jest.fn().mockResolvedValue({}) } as any;
    const prisma = { exchangeRate: { upsert: jest.fn() } } as any;

    const scheduler = new ExchangeRateUpdaterScheduler(currencyService, provider, prisma);
    await expect(scheduler.handleDailyUpdate()).resolves.not.toThrow();
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled();
  });
});
