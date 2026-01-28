// src/reports/reports.presenter.ts

export function formatMonthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  const label = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}



export type Delta = { value: number; pct: number | null };

function deltaOf(x: any): Delta {
  return { value: Number(x?.value || 0), pct: x?.pct ?? null };
}

export type SubcategoryBreakdownRow = {
  subcategoryId: number;
  categoryId: number | null;
  name: string;
  amount: number;
  emoji?: string | null;
  color?: string | null;
};

export type CategoryWithSubcategoriesRow = {
  categoryId: number;
  name: string;
  amount: number;
  emoji?: string | null;
  color?: string | null;
  subcategories: Array<{
    subcategoryId: number;
    name: string;
    amount: number;
    emoji?: string | null;
    color?: string | null;
  }>;
};


export type CategoryBreakdownRow = {
  name: string;
  amount: number;
  emoji?: string | null;
  color?: string | null; // hex: #EEF2FF, etc
};

export type InvestmentOpRow = {
  id: number;
  date: string; // ISO
  type: string; // "buy" | "sell" | "dividend" | ...
  amount: number;
  fee: number;
  transactionId: number | null;
  swapGroupId: number | null;
  asset: {
    id: number;
    name: string;
    type: string;
    identificator: string | null;
    currency: string | null;
  };
};

export type MonthlyTemplateParams = {
  monthKey: string;
  monthLabel: string;
  generatedAtISO: string;
  walletId: number | null;
  walletName: string | null;
  currency: string;
    netWorthTotal: number;

  totals: { income: number; expense: number; savings: number; savingsRate: number };

  previous: null | {
    monthKey: string;
    totals: { income: number; expense: number; savings: number };
  };

    investments?: {
    operations: InvestmentOpRow[];
  };

  trends: {
    income: Delta;
    expense: Delta;
    savings: Delta;
  };

  topCategories: { name: string; amount: number }[];

  categoriesBreakdown?: {
    expense: CategoryBreakdownRow[];
    income: CategoryBreakdownRow[];
  };


    subcategoriesBreakdown?: {
    expense: SubcategoryBreakdownRow[];
    income: SubcategoryBreakdownRow[];
  };

  // NUEVO (opción 2 PRO)
  categoriesWithSubcategories?: {
    expense: CategoryWithSubcategoriesRow[];
    income: CategoryWithSubcategoriesRow[];
  };

  dailyExpense: { date: string; amount: number }[];
};

export type YearlyTemplateParams = {
  yearLabel: string;
  generatedAtISO: string;
  walletId: number | null;
  walletName: string | null;
  currency: string;

  totals: { income: number; expense: number; savings: number; savingsRate: number };

  previous: null | {
    year: string;
    totals: { income: number; expense: number; savings: number };
  };

  trends: {
    income: Delta;
    expense: Delta;
    savings: Delta;
  };

  topCategories: { name: string; amount: number }[];

  categoriesBreakdown?: {
    expense: CategoryBreakdownRow[];
    income: CategoryBreakdownRow[];
  };

  monthly: { month: string; income: number; expense: number; savings: number }[];
};

function toCategoryRow(c: any): CategoryBreakdownRow {
  return {
    name: c.name,
    amount: Number(c.amount || 0),
    emoji: c.emoji ?? null,
    color: c.color ?? null,
  };
}

export function toMonthlyTemplateParams(report: any, currency: string): MonthlyTemplateParams {
  const monthKey = report?.period?.month;
  const prev = report?.trends?.previousMonth;

  return {
    monthKey,
    monthLabel: formatMonthLabel(monthKey),
    generatedAtISO: new Date().toISOString(),
    walletId: report?.walletId ?? null,
    walletName: report?.walletName ?? null,
  netWorthTotal: Number(report?.netWorthTotal || 0), // <-- AÑADIR

    currency,

    totals: {
      income: Number(report?.totals?.income || 0),
      expense: Number(report?.totals?.expense || 0),
      savings: Number(report?.totals?.savings || 0),
      savingsRate: Number(report?.totals?.savingsRate || 0),
    },

    previous: prev
      ? {
          monthKey: prev.month,
          totals: {
            income: Number(prev.income || 0),
            expense: Number(prev.expense || 0),
            savings: Number(prev.savings || 0),
          },
        }
      : null,

    trends: {
      income: deltaOf(report?.trends?.vsPreviousMonth?.income),
      expense: deltaOf(report?.trends?.vsPreviousMonth?.expense),
      savings: deltaOf(report?.trends?.vsPreviousMonth?.savings),
    },

        investments: report?.investments
      ? {
          operations: (report.investments.operations || []).map((o: any) => ({
            id: Number(o.id),
            date: String(o.date),
            type: String(o.type),
            amount: Number(o.amount || 0),
            fee: Number(o.fee || 0),
            transactionId: o.transactionId == null ? null : Number(o.transactionId),
            swapGroupId: o.swapGroupId == null ? null : Number(o.swapGroupId),
            asset: {
              id: Number(o.asset?.id),
              name: String(o.asset?.name ?? "—"),
              type: String(o.asset?.type ?? "unknown"),
              identificator: o.asset?.identificator ?? null,
              currency: o.asset?.currency ?? null,
            },
          })),
        }
      : undefined,


    topCategories: (report?.topCategories || []).map((c: any) => ({
      name: c.name,
      amount: Number(c.amount || 0),
    })),

    categoriesBreakdown: report?.categoriesBreakdown
      ? {
          expense: (report.categoriesBreakdown.expense || []).map(toCategoryRow),
          income: (report.categoriesBreakdown.income || []).map(toCategoryRow),
        }
      : undefined,

    // NUEVO: subcategorías (flat)
    subcategoriesBreakdown: report?.subcategoriesBreakdown
      ? {
          expense: (report.subcategoriesBreakdown.expense || []).map((s: any) => ({
            subcategoryId: Number(s.subcategoryId),
            categoryId: s.categoryId == null ? null : Number(s.categoryId),
            name: s.name,
            amount: Number(s.amount || 0),
            emoji: s.emoji ?? null,
            color: s.color ?? null,
          })),
          income: (report.subcategoriesBreakdown.income || []).map((s: any) => ({
            subcategoryId: Number(s.subcategoryId),
            categoryId: s.categoryId == null ? null : Number(s.categoryId),
            name: s.name,
            amount: Number(s.amount || 0),
            emoji: s.emoji ?? null,
            color: s.color ?? null,
          })),
        }
      : undefined,

    // NUEVO: opción 2 (categoría + subcategorías)
    categoriesWithSubcategories: report?.categoriesWithSubcategories
      ? {
          expense: (report.categoriesWithSubcategories.expense || []).map((c: any) => ({
            categoryId: Number(c.categoryId),
            name: c.name,
            amount: Number(c.amount || 0),
            emoji: c.emoji ?? null,
            color: c.color ?? null,
            subcategories: (c.subcategories || []).map((s: any) => ({
              subcategoryId: Number(s.subcategoryId),
              name: s.name,
              amount: Number(s.amount || 0),
              emoji: s.emoji ?? null,
              color: s.color ?? null,
            })),
          })),
          income: (report.categoriesWithSubcategories.income || []).map((c: any) => ({
            categoryId: Number(c.categoryId),
            name: c.name,
            amount: Number(c.amount || 0),
            emoji: c.emoji ?? null,
            color: c.color ?? null,
            subcategories: (c.subcategories || []).map((s: any) => ({
              subcategoryId: Number(s.subcategoryId),
              name: s.name,
              amount: Number(s.amount || 0),
              emoji: s.emoji ?? null,
              color: s.color ?? null,
            })),
          })),
        }
      : undefined,

    dailyExpense: (report?.series?.dailyExpense || []).map((d: any) => ({
      date: d.date,
      amount: Number(d.amount || 0),
    })),
  };
}


// ====== NUEVO: params “ligeros” para PDF anual ======

export type YearlyParams = {
  yearLabel: string;
  totals: { income: number; expense: number; savings: number; savingsRate: number };
  topCategories: { name: string; amount: number }[];
  trends: { incomeDelta: number; expenseDelta: number; savingsDelta: number };
  monthly: { month: string; income: number; expense: number; savings: number }[];
  currency: string;
};

export function toYearlyParams(report: any, currency: string): YearlyParams {
  return {
    yearLabel: String(report?.period?.year ?? ""),

    currency,

    totals: {
      income: Number(report?.totals?.income || 0),
      expense: Number(report?.totals?.expense || 0),
      savings: Number(report?.totals?.savings || 0),
      savingsRate: Number(report?.totals?.savingsRate || 0),
    },

    topCategories: (report?.topCategories || []).map((c: any) => ({
      name: c.name,
      amount: Number(c.amount || 0),
    })),

    trends: {
      incomeDelta: Number(report?.trends?.vsPreviousYear?.income?.value || 0),
      expenseDelta: Number(report?.trends?.vsPreviousYear?.expense?.value || 0),
      savingsDelta: Number(report?.trends?.vsPreviousYear?.savings?.value || 0),
    },

    monthly: (report?.series?.monthly || []).map((m: any) => ({
      month: m.month,
      income: Number(m.income || 0),
      expense: Number(m.expense || 0),
      savings: Number(m.savings || 0),
    })),
  };
}


export function toYearlyTemplateParams(report: any, currency: string): YearlyTemplateParams {
  const year = report.period.year;
  const prev = report.trends?.previousYear;

  return {
    yearLabel: year,
    generatedAtISO: new Date().toISOString(),

    walletId: report.walletId ?? null,
    walletName: report.walletName ?? null, // si no existe en tu report, déjalo como null

    currency,

    totals: {
      income: Number(report.totals?.income || 0),
      expense: Number(report.totals?.expense || 0),
      savings: Number(report.totals?.savings || 0),
      savingsRate: Number(report.totals?.savingsRate || 0),
    },

    previous: prev
      ? {
          year: prev.year,
          totals: {
            income: Number(prev.income || 0),
            expense: Number(prev.expense || 0),
            savings: Number(prev.savings || 0),
          },
        }
      : null,

    trends: {
      income: deltaOf(report.trends?.vsPreviousYear?.income),
      expense: deltaOf(report.trends?.vsPreviousYear?.expense),
      savings: deltaOf(report.trends?.vsPreviousYear?.savings),
    },

    topCategories: (report.topCategories || []).map((c: any) => ({
      name: c.name,
      amount: Number(c.amount || 0),
    })),

    categoriesBreakdown: report.categoriesBreakdown
      ? {
          expense: (report.categoriesBreakdown.expense || []).map(toCategoryRow),
          income: (report.categoriesBreakdown.income || []).map(toCategoryRow),
        }
      : undefined,

    monthly: (report.series?.monthly || []).map((m: any) => ({
      month: m.month,
      income: Number(m.income || 0),
      expense: Number(m.expense || 0),
      savings: Number(m.savings || 0),
    })),
  };
}
