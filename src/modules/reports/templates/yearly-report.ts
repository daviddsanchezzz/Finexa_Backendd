// reports/templates/yearly-report.ts
export function yearlyReportHtml(params: {
  yearLabel: string;
  totals: {
    income: number;
    expense: number;
    savings: number;
    savingsRate: number;
  };
  trends: {
    incomeDelta: number;
    expenseDelta: number;
    savingsDelta: number;
  };
  topCategories: { name: string; amount: number }[];
  monthly: {
    month: string;
    income: number;
    expense: number;
    savings: number;
  }[];
  currency: string;
}) {
  const { yearLabel, totals, trends, topCategories, monthly, currency } = params;

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(n);

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const deltaClass = (n: number) => (n >= 0 ? 'pos' : 'neg');
  const deltaFmt = (n: number) =>
    `${n >= 0 ? '+' : ''}${fmt(n)}`;

  return `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Informe anual · ${yearLabel}</title>

<style>
body {
  margin: 0;
  padding: 32px;
  font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, Arial;
  background: #f8fafc;
  color: #0f172a;
}

.container {
  max-width: 900px;
  margin: 0 auto;
}

h1 {
  font-size: 28px;
  font-weight: 900;
}

.cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin: 24px 0;
}

.card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 16px;
}

.k {
  font-size: 11px;
  text-transform: uppercase;
  color: #64748b;
  font-weight: 700;
}

.v {
  margin-top: 6px;
  font-size: 20px;
  font-weight: 900;
}

.delta.pos { color: #16a34a; font-weight: 700; }
.delta.neg { color: #dc2626; font-weight: 700; }

.section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 16px;
  margin-top: 24px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

td, th {
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
  font-size: 13px;
}

th {
  text-align: left;
  color: #64748b;
  font-weight: 700;
}

.right {
  text-align: right;
  font-weight: 800;
}
</style>
</head>

<body>
<div class="container">

  <h1>Informe anual · ${yearLabel}</h1>

  <div class="cards">
    <div class="card">
      <div class="k">Ingresos</div>
      <div class="v">${fmt(totals.income)}</div>
      <div class="delta ${deltaClass(trends.incomeDelta)}">
        ${deltaFmt(trends.incomeDelta)}
      </div>
    </div>

    <div class="card">
      <div class="k">Gastos</div>
      <div class="v">${fmt(totals.expense)}</div>
      <div class="delta ${deltaClass(trends.expenseDelta)}">
        ${deltaFmt(trends.expenseDelta)}
      </div>
    </div>

    <div class="card">
      <div class="k">Ahorro</div>
      <div class="v">${fmt(totals.savings)}</div>
      <div class="k">Tasa ${pct(totals.savingsRate)}</div>
    </div>

    <div class="card">
      <div class="k">Balance neto</div>
      <div class="v">${fmt(totals.income - totals.expense)}</div>
    </div>
  </div>

  <div class="section">
    <h3>Resumen mensual</h3>
    <table>
      <tr>
        <th>Mes</th>
        <th class="right">Ingresos</th>
        <th class="right">Gastos</th>
        <th class="right">Ahorro</th>
      </tr>
      ${monthly
        .map(
          (m) => `
        <tr>
          <td>${m.month}</td>
          <td class="right">${fmt(m.income)}</td>
          <td class="right">${fmt(m.expense)}</td>
          <td class="right">${fmt(m.savings)}</td>
        </tr>
      `
        )
        .join('')}
    </table>
  </div>

  <div class="section">
    <h3>Top categorías de gasto</h3>
    <table>
      ${topCategories
        .map(
          (c) => `
        <tr>
          <td>${c.name}</td>
          <td class="right">${fmt(c.amount)}</td>
        </tr>
      `
        )
        .join('')}
    </table>
  </div>

</div>
</body>
</html>
`;
}
