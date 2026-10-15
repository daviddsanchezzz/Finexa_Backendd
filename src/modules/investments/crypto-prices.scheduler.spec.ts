import { Prisma } from '@prisma/client';
import { CryptoPricesScheduler } from './crypto-prices.scheduler';

const CLOSE = new Date(Date.UTC(2026, 9, 14));
const NOW = new Date(Date.UTC(2026, 9, 15, 0, 10));

function setup(opts: { assets: any[]; fetch: jest.Mock; existing?: { source: string } | null }) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma: any = {
    investmentAsset: { findMany: jest.fn().mockResolvedValue(opts.assets) },
    investmentValuationSnapshot: { findUnique: jest.fn().mockResolvedValue(opts.existing ?? null) },
    $transaction: jest.fn((fn: any) => fn({})),
  };
  const investments: any = {
    upsertValuationSnapshotTx: upsert,
    recalcInvestmentWalletBalance: jest.fn().mockResolvedValue(undefined),
  };
  const sched = new CryptoPricesScheduler(prisma, investments, { fetchDailyClose: opts.fetch } as any);
  return { sched, upsert, investments };
}

const asset = (over: Partial<any> = {}) => ({
  id: 2,
  userId: 7,
  name: 'Bitcoin',
  identificator: 'BTC',
  currency: 'EUR',
  quantity: new Prisma.Decimal('0.006257'),
  ...over,
});

const ok = (price = 72888.3, closeDate = CLOSE) => jest.fn().mockResolvedValue({ ticker: 'BTC', currency: 'EUR', price, closeDate });

describe('CryptoPricesScheduler.syncCryptoPrices', () => {
  beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any));
  afterEach(() => jest.restoreAllMocks());

  it('guarda cierre x cantidad con la fecha del cierre y source "kraken"', async () => {
    const { sched, upsert, investments } = setup({ assets: [asset()], fetch: ok() });
    expect((await sched.syncCryptoPrices(NOW)).written).toBe(1);
    const dto = upsert.mock.calls[0][2];
    expect(dto.date).toEqual(CLOSE);
    expect(dto.source).toBe('kraken');
    expect(dto.unitPrice.toString()).toBe('72888.3');
    expect(dto.value.toString()).toBe('456.0620931'); // 72888.3 x 0.006257
    expect(investments.recalcInvestmentWalletBalance).toHaveBeenCalledWith(7);
  });

  it('si Kraken falla no escribe nada', async () => {
    const { sched, upsert } = setup({ assets: [asset()], fetch: jest.fn().mockRejectedValue(new Error('Kraken HTTP 503')) });
    expect((await sched.syncCryptoPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('no pisa un snapshot manual o importado de esa fecha, pero sí uno de cron o kraken', async () => {
    for (const source of ['Manual', 'excel_import']) {
      const { sched, upsert } = setup({ assets: [asset()], fetch: ok(), existing: { source } });
      expect((await sched.syncCryptoPrices(NOW)).written).toBe(0);
      expect(upsert).not.toHaveBeenCalled();
    }
    for (const source of ['cron', 'kraken']) {
      const { sched } = setup({ assets: [asset()], fetch: ok(), existing: { source } });
      expect((await sched.syncCryptoPrices(NOW)).written).toBe(1);
    }
  });

  it('rechaza un cierre de hace más de 4 días', async () => {
    const { sched, upsert } = setup({ assets: [asset()], fetch: ok(70000, new Date(Date.UTC(2026, 9, 8))) });
    expect((await sched.syncCryptoPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('omite identificadores que no son un ticker (p. ej. "BTC - ETH") sin llamar a Kraken', async () => {
    const fetch = jest.fn();
    const { sched } = setup({ assets: [asset({ identificator: 'BTC - ETH' })], fetch });
    expect((await sched.syncCryptoPrices(NOW)).written).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('acepta el ticker en minúsculas y hace un solo fetch para dos usuarios', async () => {
    const fetch = ok();
    const { sched, upsert } = setup({ assets: [asset({ identificator: 'btc' }), asset({ id: 3, userId: 15 })], fetch });
    expect((await sched.syncCryptoPrices(NOW)).written).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('BTC');
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  describe('scheduledSync', () => {
    afterEach(() => delete process.env.CRYPTO_PRICES_CRON_ENABLED);

    it('corre por defecto', async () => {
      delete process.env.CRYPTO_PRICES_CRON_ENABLED;
      const { sched } = setup({ assets: [], fetch: jest.fn() });
      const spy = jest.spyOn(sched, 'syncCryptoPrices');
      await sched.scheduledSync();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('no hace nada si CRYPTO_PRICES_CRON_ENABLED=false', async () => {
      process.env.CRYPTO_PRICES_CRON_ENABLED = 'false';
      const { sched } = setup({ assets: [asset()], fetch: jest.fn() });
      const spy = jest.spyOn(sched, 'syncCryptoPrices');
      await sched.scheduledSync();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
