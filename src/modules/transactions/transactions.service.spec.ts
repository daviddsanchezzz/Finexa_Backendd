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
    const service = new TransactionsService(prisma, {} as any, {} as any);
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
