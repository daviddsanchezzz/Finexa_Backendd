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
