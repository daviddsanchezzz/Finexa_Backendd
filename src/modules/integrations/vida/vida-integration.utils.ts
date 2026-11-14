import { DateTime } from 'luxon';

// Misma zona que usa el cierre de mes (ver monthData/month-data.service.ts):
// un movimiento de la 01:00 del día 1 debe caer en el mes que le toca.
export const APP_TIMEZONE = 'Europe/Madrid';
export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthRange = { key: string; start: Date; end: Date; year: number; month0: number };

export function currentMonthKey(now: Date = new Date(), zone: string = APP_TIMEZONE): string {
  return DateTime.fromJSDate(now, { zone }).toFormat('yyyy-MM');
}

/** Rango [start, end) de un mes natural en hora local. Devuelve null si la clave no es `AAAA-MM`. */
export function monthRange(key: string, zone: string = APP_TIMEZONE): MonthRange | null {
  if (!MONTH_KEY.test(key)) return null;
  const start = DateTime.fromISO(`${key}-01`, { zone }).startOf('day');
  if (!start.isValid) return null;
  return { key, start: start.toJSDate(), end: start.plus({ months: 1 }).toJSDate(), year: start.year, month0: start.month - 1 };
}

export function previousMonthKey(key: string, zone: string = APP_TIMEZONE): string | null {
  const range = monthRange(key, zone);
  if (!range) return null;
  return DateTime.fromJSDate(range.start, { zone }).minus({ months: 1 }).toFormat('yyyy-MM');
}

export type SummaryRow = {
  type: string;
  amount: number;
  baseAmount: unknown;
  date: Date;
  categoryId: number | null;
  category: { id: number; name: string; emoji: string | null; color: string | null } | null;
  investmentAssetId: number | null;
  toWallet: { kind: string; active: boolean | null } | null;
};

/** Importe en moneda base si existe (multi-divisa) y, si no, el importe original. Siempre positivo. */
export const amountOf = (row: { amount: number; baseAmount?: unknown }): number =>
  Math.abs(Number(row.baseAmount ?? row.amount ?? 0));

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Variación porcentual; null si no hay base de comparación. */
export function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? round2(((current - previous) / previous) * 100) : null;
}

const isInvestmentTransfer = (r: SummaryRow) =>
  r.type === 'transfer' && r.investmentAssetId != null && r.toWallet?.kind === 'investment' && r.toWallet?.active !== false;

export type MonthSummary = {
  totals: { income: number; expenses: number; investment: number; balance: number; savingsRate: number };
  byCategory: { id: number | null; name: string; emoji: string | null; color: string | null; total: number; pct: number; count: number }[];
  weekly: { label: string; from: string; to: string; income: number; expenses: number }[];
  daily: { date: string; income: number; expenses: number }[];
};

/**
 * Resume los movimientos de un mes: totales, gasto por categoría, semanas (lunes a domingo, recortadas al mes)
 * y días. Los filtros (activos, no plantillas recurrentes, no excluidos de estadísticas) se aplican en la consulta.
 * `balance` es ingresos − gastos, como en la pantalla de inicio de Finexa; la inversión va aparte.
 */
export function summarizeMonth(rows: SummaryRow[], range: MonthRange, zone: string = APP_TIMEZONE): MonthSummary {
  const monthStart = DateTime.fromJSDate(range.start, { zone });
  const daysInMonth = monthStart.daysInMonth ?? 30;

  const daily = Array.from({ length: daysInMonth }, (_, i) => ({
    date: monthStart.plus({ days: i }).toFormat('yyyy-MM-dd'),
    income: 0,
    expenses: 0,
  }));
  const dayIndex = new Map(daily.map((d, i) => [d.date, i]));

  // Semanas: la primera empieza el día 1 y las siguientes cada lunes.
  const weekly: MonthSummary['weekly'] = [];
  let cursor = monthStart;
  while (cursor < monthStart.plus({ months: 1 })) {
    const sunday = cursor.plus({ days: 7 - cursor.weekday }); // weekday: lunes = 1 … domingo = 7
    const last = sunday < monthStart.plus({ months: 1 }).minus({ days: 1 }) ? sunday : monthStart.plus({ months: 1 }).minus({ days: 1 });
    weekly.push({ label: `S${weekly.length + 1}`, from: cursor.toFormat('yyyy-MM-dd'), to: last.toFormat('yyyy-MM-dd'), income: 0, expenses: 0 });
    cursor = last.plus({ days: 1 });
  }
  const weekOfDate = (iso: string) => weekly.findIndex((w) => iso >= w.from && iso <= w.to);

  let income = 0;
  let expenses = 0;
  let investment = 0;
  const categories = new Map<string, { id: number | null; name: string; emoji: string | null; color: string | null; total: number; count: number }>();

  for (const row of rows) {
    const day = DateTime.fromJSDate(row.date, { zone }).toFormat('yyyy-MM-dd');
    const amount = amountOf(row);

    if (row.type === 'income') {
      income += amount;
      const di = dayIndex.get(day);
      if (di != null) daily[di].income += amount;
      const wi = weekOfDate(day);
      if (wi >= 0) weekly[wi].income += amount;
    } else if (row.type === 'expense') {
      expenses += amount;
      const di = dayIndex.get(day);
      if (di != null) daily[di].expenses += amount;
      const wi = weekOfDate(day);
      if (wi >= 0) weekly[wi].expenses += amount;

      const key = row.category ? String(row.category.id) : 'none';
      const current = categories.get(key) ?? {
        id: row.category?.id ?? null,
        name: row.category?.name ?? 'Sin categoría',
        emoji: row.category?.emoji ?? null,
        color: row.category?.color ?? null,
        total: 0,
        count: 0,
      };
      current.total += amount;
      current.count += 1;
      categories.set(key, current);
    } else if (isInvestmentTransfer(row)) {
      investment += Math.abs(Number(row.amount ?? 0));
    }
  }

  const byCategory = [...categories.values()]
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c, total: round2(c.total), pct: expenses > 0 ? round2((c.total / expenses) * 100) : 0 }));

  return {
    totals: {
      income: round2(income),
      expenses: round2(expenses),
      investment: round2(investment),
      balance: round2(income - expenses),
      savingsRate: income > 0 ? round2(((income - expenses) / income) * 100) : 0,
    },
    byCategory,
    weekly: weekly.map((w) => ({ ...w, income: round2(w.income), expenses: round2(w.expenses) })),
    daily: daily.map((d) => ({ ...d, income: round2(d.income), expenses: round2(d.expenses) })),
  };
}
