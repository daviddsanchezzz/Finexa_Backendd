import { DashboardService } from './dashboard.service';

describe('DashboardService.getNetWorth', () => {
  function build(wallets: any[], userCurrency: string, rate = 0.9393) {
    const prisma: any = {
      wallet: { findMany: jest.fn().mockResolvedValue(wallets) },
      user: { findUnique: jest.fn().mockResolvedValue({ currency: userCurrency }) },
    };
    const currency: any = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => rate, times: (n: number) => ({ toNumber: () => n * rate }) }) };
    return { service: new DashboardService(prisma, currency), prisma, currency };
  }

  it('todas las carteras en la moneda base: suma directa, sin llamar a CurrencyService', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(result).toEqual({
      total: 150,
      currency: 'EUR',
      wallets: [
        { id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR', balanceInBase: 100 },
        { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR', balanceInBase: 50 },
      ],
    });
    expect(currency.getCurrentRate).not.toHaveBeenCalled();
  });

  it('cartera en otra moneda: convierte al tipo actual', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Revolut CHF', emoji: '💳', balance: 2000, currency: 'CHF' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(currency.getCurrentRate).toHaveBeenCalledWith('CHF', 'EUR');
    expect(result.total).toBeCloseTo(100 + 2000 * 0.9393, 2);
    expect(result.wallets[1].balanceInBase).toBeCloseTo(2000 * 0.9393, 2);
  });
});

describe('DashboardService.getSummary2 — multi-currency', () => {
  function build(incomeRows: any[], expenseRows: any[]) {
    const prisma: any = {
      transaction: {
        findMany: jest.fn((args: any) => {
          if (args.where.type === 'income') return Promise.resolve(incomeRows);
          if (args.where.type === 'expense') return Promise.resolve(expenseRows);
          return Promise.resolve([]); // investmentTransfers
        }),
      },
    };
    return { service: new DashboardService(prisma, {} as any), prisma };
  }

  it('con todo EUR, suma amount tal cual (comportamiento identico al actual)', async () => {
    const { service } = build([{ amount: 1000, baseAmount: null }], [{ amount: 400, baseAmount: null }]);

    const result = await service.getSummary2(7, {} as any);

    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpenses).toBe(400);
  });

  it('con una transaccion en otra moneda, usa baseAmount ya convertido', async () => {
    const { service } = build(
      [{ amount: 1000, baseAmount: 1000 }, { amount: 50, baseAmount: 46.5 }],
      [{ amount: 400, baseAmount: null }],
    );

    const result = await service.getSummary2(7, {} as any);

    expect(result.totalIncome).toBeCloseTo(1046.5, 2);
    expect(result.totalExpenses).toBe(400);
  });
});

describe('DashboardService.getByCategory — multi-currency', () => {
  it('agrupa por categoria sumando baseAmount cuando existe', async () => {
    const prisma: any = {
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          { categoryId: 1, amount: 30, baseAmount: null },
          { categoryId: 1, amount: 50, baseAmount: 46.5 },
          { categoryId: 2, amount: 10, baseAmount: null },
        ]),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, name: 'Alimentación', emoji: '🍔', color: '#fff' },
          { id: 2, name: 'Ocio', emoji: '🎉', color: '#000' },
        ]),
      },
    };
    const service = new DashboardService(prisma, {} as any);

    const result = await service.getByCategory(7, {} as any);

    expect(result.find((r) => r.id === 1)?.total).toBeCloseTo(76.5, 2);
    expect(result.find((r) => r.id === 2)?.total).toBe(10);
  });
});

describe('DashboardService.getTrends — multi-currency', () => {
  it('suma income/expenses usando baseAmount cuando existe', async () => {
    const prisma: any = {
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          { type: 'income', amount: 1000, baseAmount: null },
          { type: 'expense', amount: 50, baseAmount: 46.5 },
          { type: 'expense', amount: 20, baseAmount: null },
        ]),
      },
    };
    const service = new DashboardService(prisma, {} as any);

    const result = await service.getTrends(7, {} as any);

    expect(result.income).toBe(1000);
    expect(result.expenses).toBeCloseTo(66.5, 2);
    expect(result.transactionsCount).toBe(3);
  });
});
