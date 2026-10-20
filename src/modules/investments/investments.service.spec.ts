import { InvestmentsService, MANUAL_SOURCE } from './investments.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

describe('Investment asset manager name', () => {
  const prisma = {
    investmentAsset: {
      create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      findFirst: jest.fn(async () => ({ id: 1, userId: 7 })),
      update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
    },
  };
  const service = new InvestmentsService(prisma as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'recalcInvestmentWalletBalance').mockResolvedValue(undefined);
  });

  it.each(['Fidelity', 'Vanguard', 'iShares'])('preserves %s when creating and editing', async (provider) => {
    const created = await service.createAsset(7, { name: 'Fund', provider: ` ${provider} ` });
    expect(created.provider).toBe(provider);

    const updated = await service.updateAsset(7, 1, { provider: ` ${provider} ` });
    expect(updated.provider).toBe(provider);
  });

  it('allows clearing the manager without changing it on unrelated edits', async () => {
    const cleared = await service.updateAsset(7, 1, { provider: '  ' });
    expect(cleared.provider).toBeNull();

    await service.updateAsset(7, 1, { name: 'New name' });
    expect(prisma.investmentAsset.update.mock.calls.at(-1)?.[0].data).not.toHaveProperty('provider');
  });
});

describe('Origen de las valoraciones', () => {
  const upsert = jest.fn(async ({ create }) => create);
  const tx = { investmentValuationSnapshot: { upsert } };
  const service = new InvestmentsService({} as any, {} as any);
  const base = { assetId: 1, date: new Date('2026-10-15T00:00:00Z'), value: 1 as any, currency: 'EUR' };

  beforeEach(() => upsert.mockClear());

  it('una valoración hecha desde la app queda como Manual (no como cron)', async () => {
    await service.upsertValuationSnapshotTx(tx as any, 7, base);
    const call = upsert.mock.calls[0][0] as any;
    expect(MANUAL_SOURCE).toBe('Manual');
    expect(call.create.source).toBe('Manual');
    expect(call.update.source).toBe('Manual');
  });

  it('un origen explícito se respeta (cron externo, excel_import, eodhd...)', async () => {
    await service.upsertValuationSnapshotTx(tx as any, 7, { ...base, source: 'cron' });
    expect((upsert.mock.calls[0][0] as any).create.source).toBe('cron');
  });
});

describe('getAssetSummary (activo vendido y archivado)', () => {
  const asset = { id: 4, name: 'Rock MyInvestor', abbreviation: null, identificator: null, description: null, type: 'fund', riskType: null, currency: 'EUR', quantity: 0, initialInvested: 917.8, createdAt: new Date('2025-12-13T00:00:00Z') };
  const op = (id: number, date: string, amount: number) => ({ id, assetId: 4, type: 'sell', date: new Date(date), amount, fee: 0 });
  const val = (id: number, date: string, value: number) => ({ id, assetId: 4, date: new Date(date), value });
  const prisma = {
    investmentAsset: { findFirst: jest.fn() },
    investmentOperation: { findMany: jest.fn() },
    investmentValuationSnapshot: { findMany: jest.fn() },
  };
  const service = new InvestmentsService(prisma as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T10:00:00Z'));
    prisma.investmentAsset.findFirst.mockResolvedValue(asset);
    prisma.investmentOperation.findMany.mockResolvedValue([op(1, '2026-06-08T00:00:00Z', 400), op(2, '2026-06-09T00:00:00Z', 710.53)]);
    prisma.investmentValuationSnapshot.findMany.mockResolvedValue([val(1, '2026-06-04T00:00:00Z', 1110.54), val(2, '2026-06-09T00:00:00Z', 0)]);
  });
  afterEach(() => jest.useRealTimers());

  it('vale 0, con el capital aportado y el resultado de la venta; la fecha es la de la última valoración', async () => {
    const r = await service.getAssetSummary(7, 4);
    expect(r.currentValue).toBe(0);
    expect(r.totalContributed).toBeCloseTo(917.8, 6);
    expect(r.totalWithdrawn).toBeCloseTo(1110.53, 6);
    expect(r.pnl).toBeCloseTo(192.73, 6); // 0 + 1110,53 vendido - 917,80 aportado... visto como valor - aportado neto
    expect(String(r.lastValuationDate?.toISOString().slice(0, 10))).toBe('2026-06-09');
    expect(r.dayReturnPct).toBeNull(); // sin valoración de hoy/ayer
  });

  it('un activo que no es del usuario da 404', async () => {
    prisma.investmentAsset.findFirst.mockResolvedValue(null);
    await expect(service.getAssetSummary(7, 99)).rejects.toThrow(/not found/i);
  });
});
