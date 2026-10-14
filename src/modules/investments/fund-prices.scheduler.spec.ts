import { Prisma } from '@prisma/client';
import { FundPricesScheduler } from './fund-prices.scheduler';

const NAV = new Date(Date.UTC(2026, 9, 13));
const NOW = new Date(Date.UTC(2026, 9, 14, 8, 0));

function setup(opts: {
  assets: any[];
  ft: jest.Mock;
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
  const sched = new FundPricesScheduler(prisma, investments, { fetchFundPrice: opts.ft } as any);
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

describe('FundPricesScheduler.syncFundPrices', () => {
  beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any));
  afterEach(() => jest.restoreAllMocks());

  it('guarda precio x cantidad con la fecha del NAV y source "ft"', async () => {
    const ft = jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price: 312.76, navDate: NAV });
    const { sched, upsert, investments } = setup({ assets: [asset()], ft });
    const r = await sched.syncFundPrices(NOW);
    expect(r.written).toBe(1);
    const dto = upsert.mock.calls[0][2];
    expect(dto.date).toEqual(NAV);
    expect(dto.source).toBe('ft');
    expect(dto.value.toString()).toBe('1573.1828');
    expect(dto.unitPrice.toString()).toBe('312.76');
    expect(investments.recalcInvestmentWalletBalance).toHaveBeenCalledWith(7);
  });

  it('si FT falla no escribe nada (sin respaldo)', async () => {
    const ft = jest.fn().mockRejectedValue(new Error('HTTP 503'));
    const { sched, upsert, investments } = setup({ assets: [asset()], ft });
    const r = await sched.syncFundPrices(NOW);
    expect(r.written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
    expect(investments.recalcInvestmentWalletBalance).not.toHaveBeenCalled();
  });

  it('no pisa un snapshot manual o importado de esa fecha', async () => {
    const ft = jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price: 312.76, navDate: NAV });
    for (const source of ['Manual', 'excel_import']) {
      const { sched, upsert } = setup({ assets: [asset()], ft, existing: { source } });
      expect((await sched.syncFundPrices(NOW)).written).toBe(0);
      expect(upsert).not.toHaveBeenCalled();
    }
  });

  it('sí actualiza un snapshot previo de cron o ft', async () => {
    const ft = jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price: 312.76, navDate: NAV });
    const { sched, upsert } = setup({ assets: [asset()], ft, existing: { source: 'cron' } });
    expect((await sched.syncFundPrices(NOW)).written).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('rechaza un NAV de hace más de 7 días', async () => {
    const old = new Date(Date.UTC(2026, 9, 1));
    const ft = jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price: 312.76, navDate: old });
    const { sched, upsert } = setup({ assets: [asset()], ft });
    expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('omite identificadores que no son ISIN y no llama a FT', async () => {
    const ft = jest.fn();
    const { sched } = setup({ assets: [asset({ identificator: 'BTC' })], ft });
    expect((await sched.syncFundPrices(NOW)).written).toBe(0);
    expect(ft).not.toHaveBeenCalled();
  });

  it('un solo fetch para el mismo fondo de dos usuarios, y escribe ambos', async () => {
    const ft = jest.fn().mockResolvedValue({ isin: 'IE0031786696', currency: 'EUR', price: 312.76, navDate: NAV });
    const { sched, upsert } = setup({ assets: [asset(), asset({ id: 2, userId: 15 })], ft });
    expect((await sched.syncFundPrices(NOW)).written).toBe(2);
    expect(ft).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  describe('scheduledSync', () => {
    afterEach(() => delete process.env.FT_PRICES_CRON_ENABLED);

    it('corre por defecto (variable sin definir)', async () => {
      delete process.env.FT_PRICES_CRON_ENABLED;
      const { sched } = setup({ assets: [], ft: jest.fn() });
      const spy = jest.spyOn(sched, 'syncFundPrices');
      await sched.scheduledSync();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('no hace nada si FT_PRICES_CRON_ENABLED=false', async () => {
      process.env.FT_PRICES_CRON_ENABLED = 'false';
      const { sched } = setup({ assets: [asset()], ft: jest.fn() });
      const spy = jest.spyOn(sched, 'syncFundPrices');
      await sched.scheduledSync();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
