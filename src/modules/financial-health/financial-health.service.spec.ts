import { Prisma } from '@prisma/client';
import { FinancialHealthService } from './financial-health.service';

const NOW = new Date(Date.UTC(2026, 9, 15, 10)); // 15-oct-2026 12:00 Madrid

type Mock = jest.Mock;

function setup(data: Partial<Record<string, any>> = {}, rates: Record<string, number> = {}) {
  const txFind: Mock = jest.fn().mockImplementation(async (args: any) => {
    // Distingue la consulta de ingresos/gastos de la de aportaciones a inversión.
    return args.where.type === 'transfer' ? data.invest ?? [] : data.tx ?? [];
  });
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ currency: data.baseCurrency ?? 'EUR' }) },
    transaction: { findMany: txFind },
    wallet: { findMany: jest.fn().mockResolvedValue(data.wallets ?? []) },
    debt: { findMany: jest.fn().mockResolvedValue(data.debts ?? []) },
    investmentAsset: { findMany: jest.fn().mockResolvedValue(data.assets ?? []) },
    investmentTargetAllocation: { findMany: jest.fn().mockResolvedValue(data.targets ?? []) },
    investmentValuationSnapshot: { findMany: jest.fn().mockResolvedValue(data.snaps ?? []) },
    goal: { findMany: jest.fn().mockResolvedValue(data.goals ?? []) },
    financialProfile: {
      findUnique: jest.fn().mockResolvedValue(data.profile ?? null),
      upsert: jest.fn().mockImplementation(async (a: any) => ({ id: 1, userId: a.where.userId, ...a.create, ...a.update })),
    },
    manualMonthData: { findMany: jest.fn().mockResolvedValue(data.manual ?? []) },
  };
  const currency: any = {
    getCurrentRate: jest.fn().mockImplementation(async (from: string) => {
      if (rates[from] == null) throw new Error('sin tipo');
      return new Prisma.Decimal(rates[from]);
    }),
  };
  return { service: new FinancialHealthService(prisma, currency), prisma, currency };
}

const tx = (type: 'income' | 'expense', amount: number, iso: string, baseAmount: number | null = null) => ({ type, amount, baseAmount, date: new Date(iso) });

describe('FinancialHealthService.getReport: meses y movimientos', () => {
  it('aplica los mismos filtros que las estadísticas', async () => {
    const { service, prisma } = setup();
    await service.getReport(7, NOW);
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 7, active: { not: false }, isRecurring: false, excludeFromStats: { not: true } });
    expect(where.type).toEqual({ in: ['income', 'expense'] });
    const inv = prisma.transaction.findMany.mock.calls[1][0].where;
    expect(inv).toMatchObject({ type: 'transfer', investmentAssetId: { not: null }, toWallet: { is: { kind: 'investment', active: { not: false } } } });
  });

  it('agrupa por mes natural en hora de Madrid, no en UTC', async () => {
    // 30-sep 22:30 UTC ya es 1-oct en Madrid (CEST, UTC+2): cuenta en octubre, el mes en curso.
    const { service } = setup({
      tx: [
        tx('expense', 100, '2026-08-15T10:00:00Z'),
        tx('income', 1000, '2026-08-15T10:00:00Z'),
        tx('expense', 40, '2026-08-31T22:30:00Z'), // 1-sep Madrid
        tx('income', 1000, '2026-09-10T10:00:00Z'),
        tx('expense', 60, '2026-09-30T22:30:00Z'), // 1-oct Madrid -> mes en curso
      ],
    });
    const r = await service.getReport(7, NOW);
    const byKey = Object.fromEntries(r.history.map((h) => [h.key, h]));
    expect(byKey['2026-08'].expense).toBe(100);
    expect(byKey['2026-09'].expense).toBe(40);
    expect(byKey['2026-10'].expense).toBe(60);
    expect(byKey['2026-10'].partial).toBe(true);
    expect(byKey['2026-09'].partial).toBe(false);
  });

  it('usa baseAmount cuando existe (movimiento en otra divisa) y amount si no', async () => {
    const { service } = setup({
      tx: [tx('expense', 100, '2026-08-10T10:00:00Z', 92.5), tx('expense', 50, '2026-08-11T10:00:00Z'), tx('income', 1000, '2026-08-12T10:00:00Z')],
    });
    const r = await service.getReport(7, NOW);
    expect(r.history.find((h) => h.key === '2026-08')!.expense).toBeCloseTo(142.5, 5);
  });

  it('rellena con ceros los meses intermedios sin movimientos y no inventa meses anteriores al primero', async () => {
    const { service } = setup({ tx: [tx('income', 1000, '2026-05-10T10:00:00Z'), tx('income', 1000, '2026-07-10T10:00:00Z')] });
    const r = await service.getReport(7, NOW);
    expect(r.history.map((h) => h.key)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(r.history[1].income).toBe(0);
    expect(r.history[1].savingsRate).toBeNull();
  });

  it('el mes en curso no entra en el cálculo, pero informa del ritmo', async () => {
    const { service } = setup({
      tx: [tx('income', 1800, '2026-08-05T10:00:00Z'), tx('expense', 1000, '2026-08-20T10:00:00Z'), tx('income', 1800, '2026-09-05T10:00:00Z'), tx('expense', 1000, '2026-09-20T10:00:00Z'), tx('expense', 900, '2026-10-05T10:00:00Z')],
    });
    const r = await service.getReport(7, NOW);
    expect(r.monthsUsed).toBe(2);
    const savings = r.metrics.find((m) => m.key === 'savings')!;
    expect(savings.value).toBeCloseTo(800 / 1800, 5); // sin octubre
  });

  it('suma las aportaciones a inversión por mes', async () => {
    const { service } = setup({
      tx: [tx('income', 1800, '2026-08-05T10:00:00Z'), tx('income', 1800, '2026-09-05T10:00:00Z')],
      invest: [{ amount: 500, date: new Date('2026-08-12T10:00:00Z') }, { amount: -200, date: new Date('2026-08-20T10:00:00Z') }, { amount: 500, date: new Date('2026-09-12T10:00:00Z') }],
    });
    const r = await service.getReport(7, NOW);
    expect(r.history.find((h) => h.key === '2026-08')!.investmentContribution).toBe(700);
  });

  it('rellena un mes sin movimientos con el resumen manual, pero no pisa meses con movimientos', async () => {
    const { service } = setup({
      tx: [tx('income', 1000, '2026-08-05T10:00:00Z'), tx('expense', 300, '2026-08-06T10:00:00Z')],
      manual: [
        { year: 2026, month: 5, income: 1500, expense: 900 }, // junio (mes 0-indexado)
        { year: 2026, month: 7, income: 9999, expense: 9999 }, // agosto: ya hay movimientos
        { year: 2026, month: 9, income: 9999, expense: 9999 }, // octubre: mes en curso
        { year: 2019, month: 0, income: 9999, expense: 9999 }, // fuera de la ventana
      ],
    });
    const r = await service.getReport(7, NOW);
    const byKey = Object.fromEntries(r.history.map((h) => [h.key, h]));
    expect(byKey['2026-06'].income).toBe(1500);
    expect(byKey['2026-08'].income).toBe(1000);
    expect(byKey['2026-10']).toBeUndefined();
    expect(byKey['2019-01']).toBeUndefined();
  });
});

describe('FinancialHealthService: saldos, deudas, cartera y objetivos', () => {
  it('separa líquido (cash + savings) de invertido y convierte divisas', async () => {
    const { service } = setup(
      {
        wallets: [
          { kind: 'cash', balance: 1000, currency: 'EUR' },
          { kind: 'savings', balance: 2000, currency: 'USD' },
          { kind: 'investment', balance: 5000, currency: 'EUR' },
        ],
        tx: [tx('income', 1000, '2026-08-05T10:00:00Z'), tx('income', 1000, '2026-09-05T10:00:00Z'), tx('expense', 500, '2026-08-06T10:00:00Z'), tx('expense', 500, '2026-09-06T10:00:00Z')],
      },
      { USD: 0.9 },
    );
    const r = await service.getReport(7, NOW);
    const runway = r.metrics.find((m) => m.key === 'runway')!;
    expect(runway.value).toBeCloseTo((1000 + 1800) / 500, 5); // 2.000 USD * 0,9
    expect(r.fi!.capital).toBeCloseTo(1000 + 1800 + 5000, 5);
  });

  it('si no hay tipo de cambio, cuenta el saldo sin convertir en vez de perderlo', async () => {
    const { service } = setup({
      wallets: [{ kind: 'savings', balance: 2000, currency: 'CHF' }],
      tx: [tx('income', 1000, '2026-08-05T10:00:00Z'), tx('income', 1000, '2026-09-05T10:00:00Z'), tx('expense', 500, '2026-08-06T10:00:00Z'), tx('expense', 500, '2026-09-06T10:00:00Z')],
    });
    const r = await service.getReport(7, NOW);
    expect(r.metrics.find((m) => m.key === 'runway')!.value).toBeCloseTo(4, 5);
  });

  it('solo cuenta las deudas que debe el usuario y las activas', async () => {
    const { service, prisma } = setup({
      debts: [{ name: 'Préstamo', remainingAmount: 5000, monthlyPayment: 300, interestRate: 4, currency: 'EUR' }],
      tx: [tx('income', 1800, '2026-08-05T10:00:00Z'), tx('income', 1800, '2026-09-05T10:00:00Z'), tx('expense', 900, '2026-08-06T10:00:00Z'), tx('expense', 900, '2026-09-06T10:00:00Z')],
    });
    const r = await service.getReport(7, NOW);
    expect(prisma.debt.findMany.mock.calls[0][0].where).toMatchObject({ userId: 7, active: true, status: 'active', direction: 'i_ow' });
    const debt = r.metrics.find((m) => m.key === 'debt')!;
    expect(debt.value).toBeCloseTo(300 / 1800, 5);
  });

  it('construye la cartera con el último valor de cada activo y su objetivo, y descarta lo vacío', async () => {
    const { service, prisma } = setup({
      assets: [
        { id: 1, name: 'Fondo A', type: 'fund' },
        { id: 2, name: 'Fondo B', type: 'fund' },
        { id: 3, name: 'Vacío', type: 'cash' },
      ],
      snaps: [
        { assetId: 1, value: 6000, currency: 'EUR' },
        { assetId: 2, value: 4000, currency: 'EUR' },
      ],
      targets: [
        { assetId: 1, targetPct: new Prisma.Decimal('60') },
        { assetId: 2, targetPct: new Prisma.Decimal('40') },
      ],
    });
    const r = await service.getReport(7, NOW);
    const q = prisma.investmentValuationSnapshot.findMany.mock.calls[0][0];
    expect(q.orderBy).toEqual({ date: 'desc' });
    expect(q.distinct).toEqual(['assetId']);
    const portfolio = r.metrics.find((m) => m.key === 'portfolio')!;
    expect(portfolio.score).toBe(100); // 60/40 = objetivo
  });

  it('no consulta valoraciones si no hay activos', async () => {
    const { service, prisma } = setup();
    await service.getReport(7, NOW);
    expect(prisma.investmentValuationSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('calcula lo ahorrado en un objetivo por sus asignaciones', async () => {
    const { service } = setup({
      goals: [
        {
          id: 1,
          name: 'Viaje',
          status: 'ACTIVE',
          currency: 'EUR',
          trackingMode: 'ALLOCATIONS',
          targetAmount: new Prisma.Decimal('2000'),
          archivedAmount: null,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          targetDate: new Date(Date.UTC(2027, 0, 1)),
          allocations: [{ amount: new Prisma.Decimal('1500') }],
          manualEntries: [],
          linkedWallet: null,
        },
      ],
      wallets: [{ kind: 'savings', balance: 6000, currency: 'EUR' }],
      tx: [tx('income', 1800, '2026-08-05T10:00:00Z'), tx('income', 1800, '2026-09-05T10:00:00Z'), tx('expense', 900, '2026-08-06T10:00:00Z'), tx('expense', 900, '2026-09-06T10:00:00Z')],
    });
    const r = await service.getReport(7, NOW);
    // 1.500 apartados para el viaje no cuentan como colchón: (6.000 - 1.500) / 900 = 5 meses
    expect(r.metrics.find((m) => m.key === 'runway')!.value).toBeCloseTo(5, 5);
    expect(r.metrics.find((m) => m.key === 'goals')!.score).not.toBeNull();
  });
});

describe('FinancialHealthService: perfil y simulador', () => {
  it('devuelve el perfil con su grado de compleción', async () => {
    const { service } = setup({ profile: { birthYear: 1995, incomeType: 'salaried', expectedRealReturnPct: new Prisma.Decimal('3.5') } });
    const p = await service.getProfile(7);
    expect(p.birthYear).toBe(1995);
    expect(p.expectedRealReturnPct).toBe(3.5);
    expect(p.completeness).toBeCloseTo(3 / 8, 5);
  });

  it('sin perfil devuelve todo nulo y compleción 0', async () => {
    const { service } = setup();
    const p = await service.getProfile(7);
    expect(p.birthYear).toBeNull();
    expect(p.completeness).toBe(0);
  });

  it('actualiza solo los campos enviados y permite borrar con null', async () => {
    const { service, prisma } = setup();
    await service.updateProfile(7, { incomeType: 'variable', dependents: null } as any);
    const call = prisma.financialProfile.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 7 });
    expect(call.update).toEqual({ incomeType: 'variable', dependents: null });
    expect(call.create).toEqual({ userId: 7, incomeType: 'variable', dependents: null });
    expect('birthYear' in call.update).toBe(false);
  });

  it('el informe incluye el perfil y la fecha de generación', async () => {
    const { service } = setup({ profile: { birthYear: 1990 } });
    const r = await service.getReport(7, NOW);
    expect(r.profile.birthYear).toBe(1990);
    expect(r.generatedAt).toBe(NOW.toISOString());
    expect(r.currency).toBe('EUR');
  });

  it('el simulador devuelve base, escenario y diferencia', async () => {
    const { service } = setup({
      wallets: [{ kind: 'savings', balance: 10000, currency: 'EUR' }],
      tx: [tx('income', 1800, '2026-08-05T10:00:00Z'), tx('income', 1800, '2026-09-05T10:00:00Z'), tx('expense', 1000, '2026-08-06T10:00:00Z'), tx('expense', 1000, '2026-09-06T10:00:00Z')],
    });
    const r = await service.simulate(7, { oneOffExpense: 5000 }, NOW);
    expect(r.baseline.runwayMonths).toBeCloseTo(10, 5);
    expect(r.scenario.runwayMonths).toBeCloseTo(5, 5);
    expect(r.delta.runwayMonths).toBeCloseTo(-5, 5);
  });
});
