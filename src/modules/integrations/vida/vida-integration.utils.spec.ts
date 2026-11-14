import { currentMonthKey, monthRange, pctChange, previousMonthKey, summarizeMonth, SummaryRow } from './vida-integration.utils';

const row = (p: Partial<SummaryRow> & { date: string }): SummaryRow => ({
  type: 'expense',
  amount: 0,
  baseAmount: null,
  categoryId: null,
  category: null,
  investmentAssetId: null,
  toWallet: null,
  ...p,
  date: new Date(p.date),
});
const food = { id: 1, name: 'Comida', emoji: '🍔', color: '#f00' };
const rent = { id: 2, name: 'Casa', emoji: '🏠', color: null };

describe('monthRange', () => {
  it('valida el formato y calcula [inicio, fin) en hora de Madrid', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('26-01')).toBeNull();
    const r = monthRange('2026-03')!;
    expect(r.month0).toBe(2);
    expect(r.start.toISOString()).toBe('2026-02-28T23:00:00.000Z'); // 1 mar 00:00 CET
    expect(r.end.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // 1 abr 00:00 CEST
  });
  it('calcula el mes anterior cruzando de año', () => {
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    expect(previousMonthKey('xx')).toBeNull();
  });
  it('usa la zona de Madrid para el mes actual', () => {
    expect(currentMonthKey(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });
});

describe('pctChange', () => {
  it('devuelve null sin base y redondea', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(40, 100)).toBe(-60);
    expect(pctChange(1, 3)).toBe(-66.67);
  });
});

describe('summarizeMonth', () => {
  const range = monthRange('2026-11')!;
  const rows = [
    row({ type: 'income', amount: 1000, date: '2026-11-03T10:00:00Z' }),
    row({ type: 'income', amount: 683.97, date: '2026-11-10T10:00:00Z' }),
    row({ amount: 100, category: food, categoryId: 1, date: '2026-11-04T10:00:00Z' }),
    row({ amount: 50, category: food, categoryId: 1, date: '2026-11-12T10:00:00Z' }),
    row({ amount: 180.73, category: rent, categoryId: 2, date: '2026-11-30T10:00:00Z' }),
    row({ amount: 30, baseAmount: 28.5, date: '2026-11-15T10:00:00Z' }), // sin categoría, en moneda base
    row({ type: 'transfer', amount: 200, investmentAssetId: 7, toWallet: { kind: 'investment', active: true }, date: '2026-11-05T10:00:00Z' }),
    row({ type: 'transfer', amount: 999, date: '2026-11-06T10:00:00Z' }), // traspaso normal: se ignora
  ];
  const s = summarizeMonth(rows, range);

  it('calcula totales con balance = ingresos − gastos', () => {
    expect(s.totals).toEqual({ income: 1683.97, expenses: 359.23, investment: 200, balance: 1324.74, savingsRate: 78.67 });
  });
  it('agrupa por categoría ordenando por gasto y usando baseAmount', () => {
    expect(s.byCategory.map((c) => [c.name, c.total])).toEqual([['Casa', 180.73], ['Comida', 150], ['Sin categoría', 28.5]]);
    expect(s.byCategory.reduce((a, c) => a + c.pct, 0)).toBeCloseTo(100, 0);
  });
  it('genera semanas de lunes a domingo recortadas al mes y un día por fecha', () => {
    expect(s.weekly[0]).toMatchObject({ label: 'S1', from: '2026-11-01', to: '2026-11-01' }); // 1 nov 2026 es domingo
    expect(s.weekly.at(-1)!.to).toBe('2026-11-30');
    expect(s.weekly.reduce((a, w) => a + w.expenses, 0)).toBeCloseTo(359.23, 2);
    expect(s.daily).toHaveLength(30);
  });
  it('un mes vacío no divide por cero', () => {
    const e = summarizeMonth([], range);
    expect(e.totals).toEqual({ income: 0, expenses: 0, investment: 0, balance: 0, savingsRate: 0 });
    expect(e.byCategory).toEqual([]);
  });
});
