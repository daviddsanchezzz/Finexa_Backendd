import { Prisma } from '@prisma/client';
import { FundPricesScheduler } from './fund-prices.scheduler';

const NAV = new Date(Date.UTC(2026, 9, 14));
const NOW = new Date(Date.UTC(2026, 9, 15, 8, 0));

function setup(opts: {
  assets: any[];
  fetch: jest.Mock;
  configured?: boolean;
  existing?: { source: string } | null;
}) {
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
  const eodhd: any = { fetchFundPrice: opts.fetch, isConfigured: () => opts.configured ?? true };
  const sched = new FundPricesScheduler(prisma, investments, eodhd);
  return { sched, upsert, investments };
}

const asset = (over: Partial<any> = {}) => ({
  id: 1,
  userId: 7,
  name: 'Vanguard EM',
  identificator: 'IE0031786696',
  currency: 'EUR',
  quantity: new Prisma.Decimal('5.03'),
  ...over,
});

const ok = (price = 314.4983, navDate = NAV) => jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price, navDate });

describe('FundPricesScheduler.syncFundPrices', () => {
  beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any));
  afterEach(() => jest.restoreAllMocks());

  it('guarda precio x cantidad con la fecha del NAV y source "eodhd"', async () => {
    const { sched, upsert, investments } = setup({ assets: [asset()], fetch: ok() });
    const r = await sched.syncFundPrices(NOW);
    expect(r.written).toBe(1);
    const dto = upsert.mock.calls[0][2];
    expect(dto.date).toEqual(NAV);
    expect(dto.source).toBe('eodhd');
    expect(dto.value.toString()).toBe('1581.926449');
    expect(dto.unitPrice.toString()).toBe('314.4983');
    expect(investments.recalcInvestmentWalletBalance).toHaveBeenCalledWith(7);
  });

  it('si EODHD falla no escribe nada (sin respaldo)', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('EODHD HTTP 503'));
    const { sched, upsert, investments } = setup({ assets: [asset()], fetch });
    expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(investments.recalcInvestmentWalletBalance).not.toHaveBeenCalled();
  });

  it('no pisa un snapshot manual o importado de esa fecha', async () => {
    for (const source of ['Manual', 'excel_import']) {
      const { sched, upsert } = setup({ assets: [asset()], fetch: ok(), existing: { source } });
      expect((await sched.syncFundPrices(NOW)).written).toBe(0);
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('sí actualiza un snapshot previo de cron o eodhd', async () => {
    for (const source of ['cron', 'eodhd']) {
      const { sched, upsert } = setup({ assets: [asset()], fetch: ok(), existing: { source } });
      expect((await sched.syncFundPrices(NOW)).written).toBe(1);
      expect(upsert).toHaveBeenCalledTimes(1);
    }
  });

  it('rechaza un NAV de hace más de 7 días', async () => {
    const { sched, upsert } = setup({ assets: [asset()], fetch: ok(314, new Date(Date.UTC(2026, 9, 1))) });
    expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rechaza un NAV con fecha futura', async () => {
    const { sched, upsert } = setup({ assets: [asset()], fetch: ok(314, new Date(Date.UTC(2026, 9, 20))) });
    expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('omite identificadores que no son ISIN (p. ej. el ISIN mal escrito) sin llamar a EODHD', async () => {
    const fetch = jest.fn();
    for (const identificator of ['BTC', 'IE00B42WL06']) {
      const { sched } = setup({ assets: [asset({ identificator })], fetch });
      expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un solo fetch para el mismo fondo de dos usuarios, y escribe ambos', async () => {
    const fetch = ok();
    const { sched, upsert } = setup({ assets: [asset(), asset({ id: 2, userId: 15 })], fetch });
    expect((await sched.syncFundPrices(NOW)).written).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  describe('scheduledSync', () => {
    it('no hace nada sin EODHD_API_KEY', async () => {
      const { sched } = setup({ assets: [asset()], fetch: jest.fn(), configured: false });
      const spy = jest.spyOn(sched, 'syncFundPrices');
      await sched.scheduledSync();
      expect(spy).not.toHaveBeenCalled();
    });

    it('corre si EODHD_API_KEY está configurada', async () => {
      const { sched } = setup({ assets: [], fetch: jest.fn(), configured: true });
      const spy = jest.spyOn(sched, 'syncFundPrices');
      await sched.scheduledSync();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
