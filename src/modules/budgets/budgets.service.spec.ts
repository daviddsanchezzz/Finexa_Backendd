import { BudgetsService } from './budgets.service';

describe('BudgetsService — gasto convertido a Budget.currency', () => {
  function build(rows: Array<{ amount: number; currency: string; date: Date }>) {
    const prisma: any = {
      transaction: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const currency: any = {
      convert: jest.fn(async (amount: number, from: string, to: string) => ({
        toNumber: () => (from === to ? amount : amount * 0.9393),
      })),
    };
    const service: any = new BudgetsService(prisma, {} as any, currency);
    return { service, prisma, currency };
  }

  it('todas las transacciones en la moneda del budget: no llama a CurrencyService', async () => {
    const { service, currency } = build([{ amount: 30, currency: 'EUR', date: new Date('2026-09-01') }]);
    const budget: any = { id: 1, currency: 'EUR', totalLimit: 100, carryOverRemaining: false, categoryLimits: [], walletIds: [], startDate: new Date('2026-09-01') };

    const progress = await service['computeBudgetProgress'](
      7,
      budget,
      { from: new Date('2026-09-01'), to: new Date('2026-09-30') },
      { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    );

    expect(progress.globalSpent).toBe(30);
    expect(currency.convert).not.toHaveBeenCalled();
  });

  it('una transaccion en otra moneda: se convierte a Budget.currency antes de sumar', async () => {
    const { service, currency } = build([
      { amount: 30, currency: 'EUR', date: new Date('2026-09-01') },
      { amount: 50, currency: 'CHF', date: new Date('2026-09-02') },
    ]);
    const budget: any = { id: 1, currency: 'EUR', totalLimit: 100, carryOverRemaining: false, categoryLimits: [], walletIds: [], startDate: new Date('2026-09-01') };

    const progress = await service['computeBudgetProgress'](
      7,
      budget,
      { from: new Date('2026-09-01'), to: new Date('2026-09-30') },
      { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    );

    expect(currency.convert).toHaveBeenCalledWith(50, 'CHF', 'EUR', new Date('2026-09-02'));
    expect(progress.globalSpent).toBeCloseTo(30 + 50 * 0.9393, 2);
  });

  it('una fila con moneda sin tipo de cambio disponible no rompe el calculo del resto', async () => {
    const prisma: any = {
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          { amount: 30, currency: 'EUR', date: new Date('2026-09-01') },
          { amount: 50, currency: 'ZZZ', date: new Date('2026-09-02') },
        ]),
      },
    };
    const currency: any = {
      convert: jest.fn(async (amount: number, from: string) => {
        if (from === 'ZZZ') throw new Error('No hay tipo de cambio EUR->ZZZ disponible.');
        return { toNumber: () => amount };
      }),
    };
    const service: any = new BudgetsService(prisma, {} as any, currency);
    const budget: any = { id: 1, currency: 'EUR', totalLimit: 100, carryOverRemaining: false, categoryLimits: [], walletIds: [], startDate: new Date('2026-09-01') };

    const progress = await service['computeBudgetProgress'](
      7,
      budget,
      { from: new Date('2026-09-01'), to: new Date('2026-09-30') },
      { from: new Date('2026-08-01'), to: new Date('2026-08-31') },
    );

    expect(progress.globalSpent).toBe(30);
  });
});
