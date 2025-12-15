// src/reports/reports.presenter.ts
export function formatMonthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function toMonthlyTemplateParams(report: any, currency: string) {
  return {
    monthLabel: formatMonthLabel(report.period.month),
    totals: report.totals,
    topCategories: (report.topCategories || []).map((c: any) => ({ name: c.name, amount: c.amount })),
    trends: {
      incomeDelta: report.trends.vsPreviousMonth.income.value,
      expenseDelta: report.trends.vsPreviousMonth.expense.value,
      savingsDelta: report.trends.vsPreviousMonth.savings.value,
    },
    currency,
  };
}

export function toYearlyTemplateParams(report: any, currency: string) {
  return {
    yearLabel: report.period.year,
    totals: report.totals,
    topCategories: (report.topCategories || []).map((c: any) => ({ name: c.name, amount: c.amount })),
    trends: {
      incomeDelta: report.trends.vsPreviousYear.income.value,
      expenseDelta: report.trends.vsPreviousYear.expense.value,
      savingsDelta: report.trends.vsPreviousYear.savings.value,
    },
    monthly: report.series.monthly,
    currency,
  };
}
