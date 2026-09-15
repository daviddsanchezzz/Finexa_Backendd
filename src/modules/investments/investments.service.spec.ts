import { InvestmentsService } from './investments.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

describe('Investment asset manager name', () => {
  const prisma = {
    investmentAsset: {
      create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      findFirst: jest.fn(async () => ({ id: 1, userId: 7 })),
      update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
    },
  };
  const service = new InvestmentsService(prisma as any);

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
