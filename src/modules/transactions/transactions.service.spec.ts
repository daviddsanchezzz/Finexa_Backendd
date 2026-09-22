import { TransactionsService } from './transactions.service';

// Regresión: al editar la PLANTILLA recurrente con scope "future"/"series", la
// fecha nueva (próxima ejecución) no se guardaba y la lista seguía mostrando
// la anterior.
describe('TransactionsService.updateWithScope — fecha de la plantilla', () => {
  const template = {
    id: 1,
    userId: 7,
    active: true,
    isRecurring: true,
    parentId: null,
    type: 'expense',
    amount: 22,
    description: 'Claude',
    date: new Date('2026-09-22T14:51:00.000Z'),
    categoryId: 1,
    subcategoryId: 2,
    walletId: 3,
  };

  function build() {
    const prisma: any = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(template),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(template),
      },
    };
    const service = new TransactionsService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'findOne').mockResolvedValue(template as any);
    return { service, prisma };
  }

  it.each(['future', 'series'] as const)('guarda la nueva fecha en la plantilla (scope %s)', async (scope) => {
    const { service, prisma } = build();
    const newDate = '2026-09-21T14:51:00.000Z';

    await service.updateWithScope(7, 1, { date: newDate } as any, scope);

    const call = prisma.transaction.update.mock.calls.find((c: any[]) => c[0].where.id === 1);
    expect(call[0].data.date).toEqual(new Date(newDate));
  });

  it('rechaza una fecha inválida', async () => {
    const { service } = build();
    await expect(
      service.updateWithScope(7, 1, { date: 'no-es-fecha' } as any, 'future'),
    ).rejects.toThrow('Fecha inválida');
  });
});

describe('TransactionsService.create — currency/baseAmount', () => {
  function build() {
    const prisma: any = {
      transaction: { create: jest.fn(), findUnique: jest.fn() },
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: 3, balance: 100, currency: 'EUR' }), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ currency: 'EUR' }) },
    };
    const currencyService: any = {
      convertToBase: jest.fn(),
    };
    const budgets: any = { checkBudgetThresholds: jest.fn().mockResolvedValue(undefined) };
    const service = new TransactionsService(prisma, {} as any, budgets, currencyService);
    return { service, prisma, currencyService };
  }

  it('transaccion en la moneda base: currency=EUR y baseAmount queda NULL', async () => {
    const { service, prisma, currencyService } = build();
    prisma.transaction.create.mockResolvedValue({ id: 1, type: 'expense', amount: 10, walletId: 3, currency: 'EUR', baseAmount: null });

    await service.create(7, { type: 'expense', amount: 10, walletId: 3, date: '2026-09-22' } as any);

    expect(currencyService.convertToBase).not.toHaveBeenCalled();
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR', baseAmount: null, exchangeRate: null }) }),
    );
  });

  it('transaccion en otra moneda: calcula baseAmount con el tipo historico de la fecha', async () => {
    const { service, prisma, currencyService } = build();
    prisma.wallet.findUnique.mockResolvedValue({ id: 3, balance: 100, currency: 'CHF' });
    currencyService.convertToBase.mockResolvedValue({ toNumber: () => 53.72, dividedBy: () => ({ toNumber: () => 1.0744 }) });
    prisma.transaction.create.mockResolvedValue({ id: 1 });

    await service.create(7, { type: 'expense', amount: 50, walletId: 3, currency: 'CHF', date: '2026-09-01' } as any);

    expect(currencyService.convertToBase).toHaveBeenCalledWith(7, 50, 'CHF', new Date('2026-09-01'));
    const data = prisma.transaction.create.mock.calls[0][0].data;
    expect(data.currency).toBe('CHF');
    expect(data.baseAmount).toBe(53.72);
  });

  it('si CurrencyService falla, la transaccion se crea igual con baseAmount/exchangeRate null', async () => {
    const { service, prisma, currencyService } = build();
    prisma.wallet.findUnique.mockResolvedValue({ id: 3, balance: 100, currency: 'ZZZ' });
    currencyService.convertToBase.mockRejectedValue(new Error('No hay tipo de cambio EUR->ZZZ disponible.'));
    prisma.transaction.create.mockResolvedValue({ id: 1 });

    await service.create(7, { type: 'expense', amount: 50, walletId: 3, currency: 'ZZZ', date: '2026-09-01' } as any);

    const data = prisma.transaction.create.mock.calls[0][0].data;
    expect(data.currency).toBe('ZZZ');
    expect(data.baseAmount).toBeNull();
    expect(data.exchangeRate).toBeNull();
  });
});
