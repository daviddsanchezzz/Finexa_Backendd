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
    month: string; // YYYY-MM
    income: number;
    expense: number;
    savings: number;
  }[];
  currency: string;
}) {
  const { yearLabel, totals, trends, topCategories, monthly, currency } = params;

  const fmt = (n: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(n);

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const deltaClass = (n: number) => (n >= 0 ? "pos" : "neg");
  const deltaArrow = (n: number) => (n >= 0 ? "↑" : "↓");
  const deltaFmt = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}`;

  const safe = (s: string) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const monthLabelEsShort = (monthKey: string) => {
    // "YYYY-MM" -> "Ene", "Feb", ...
    const d = new Date(`${monthKey}-01T00:00:00Z`);
    const label = new Intl.DateTimeFormat("es-ES", { month: "short" }).format(d);
    return label.charAt(0).toUpperCase() + label.slice(1).replace(".", "");
  };

  const generatedAt = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  // Insights (simples pero muy “pro”)
  const bestSavingsMonth = monthly.reduce(
    (best, m) => (m.savings > (best?.savings ?? -Infinity) ? m : best),
    null as null | (typeof monthly)[number]
  );
  const worstExpenseMonth = monthly.reduce(
    (worst, m) => (m.expense > (worst?.expense ?? -Infinity) ? m : worst),
    null as null | (typeof monthly)[number]
  );

  const top1 = topCategories[0];

  const insight1 =
    totals.savingsRate >= 0.3
      ? "Año muy sólido: alta capacidad de ahorro."
      : totals.savingsRate >= 0.15
      ? "Año equilibrado: buen control general."
      : "Año ajustado: conviene revisar gastos recurrentes.";

  const insight2 = bestSavingsMonth
    ? `Mejor mes (ahorro): ${bestSavingsMonth.month} (${fmt(bestSavingsMonth.savings)}).`
    : "No hay datos suficientes para detectar el mejor mes.";

  const insight3 = worstExpenseMonth
    ? `Mes con más gasto: ${worstExpenseMonth.month} (${fmt(worstExpenseMonth.expense)}).`
    : "No hay datos suficientes para detectar el mes con más gasto.";

  const insight4 = top1
    ? `Top categoría anual: ${top1.name} (${fmt(top1.amount)}).`
    : "No hay categorías destacadas este año.";

  // Mini chart SVG (barras) para “Resumen mensual”
  const maxMonthly = Math.max(...monthly.map((m) => m.income + m.expense), 0);
  const chartW = 860;
  const chartH = 140;
  const padX = 16;
  const padY = 16;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padY * 2;
  const barCount = Math.max(monthly.length, 12);
  const slot = innerW / barCount;
  const barW = Math.min(18, Math.max(10, slot * 0.45));

  const barX = (i: number) => padX + i * slot + (slot - barW) / 2;
  const barHFor = (v: number) => (maxMonthly > 0 ? Math.round((v / maxMonthly) * innerH) : 0);
  const yFor = (h: number) => padY + (innerH - h);

  const svgBars = monthly
    .slice(0, 12)
    .map((m, i) => {
      const total = (Number(m.income) || 0) + (Number(m.expense) || 0);
      const h = barHFor(total);
      const x = barX(i);
      const y = yFor(h);
      const label = monthLabelEsShort(m.month);
      return `
        <g>
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="8" ry="8" fill="rgba(37,99,235,.35)" />
          <text x="${x + barW / 2}" y="${chartH - 4}" text-anchor="middle" font-size="10" font-weight="800" fill="#64748b">${safe(
            label
          )}</text>
        </g>
      `;
    })
    .join("");

  // Categorías: % y barras
  const maxCat = Math.max(...topCategories.map((c) => Number(c.amount) || 0), 0);
  const catBarW = (amount: number) => (maxCat > 0 ? Math.round((amount / maxCat) * 100) : 0);
  const catPct = (amount: number) =>
    totals.expense > 0 ? `${((amount / totals.expense) * 100).toFixed(1)}%` : "0.0%";

  return `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Informe anual · ${safe(yearLabel)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />

<style>
@page { size: A4; margin: 16mm 14mm; }

:root{
  --bg:#f8fafc;
  --card:#ffffff;
  --border:#e5e7eb;
  --text:#0f172a;
  --muted:#64748b;
  --muted2:#94a3b8;
  --pos:#16a34a;
  --neg:#dc2626;
  --accent:#2563eb;
  --accentSoft: rgba(37, 99, 235, .10);
  --shadow: 0 1px 0 rgba(15,23,42,.02), 0 10px 30px rgba(15,23,42,.04);
}

*{ box-sizing:border-box; }
body{
  margin:0;
  padding:0;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.container{
  max-width: 920px;
  margin: 0 auto;
  padding: 26px 0;
}

/* Header */
.header{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  gap:16px;
  margin-bottom: 18px;
}

.brand{
  display:flex;
  align-items:center;
  gap:10px;
}

.logo{
  width:34px;
  height:34px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(37,99,235,.22), rgba(37,99,235,.08));
  border: 1px solid rgba(37,99,235,.25);
  display:flex;
  align-items:center;
  justify-content:center;
  font-weight: 900;
  color: var(--accent);
  letter-spacing: -.02em;
}

.title{
  font-size: 26px;
  font-weight: 950;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.sub{
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 700;
}

.meta{
  text-align:right;
  font-size: 11px;
  color: var(--muted);
  font-weight: 700;
}

.pills{
  margin-top: 8px;
  display:flex;
  justify-content:flex-end;
  gap:8px;
  flex-wrap:wrap;
}

.pill{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--muted);
  font-weight: 800;
  font-size: 11px;
}

.pill .dot{
  width:6px; height:6px; border-radius:999px;
  background: var(--accent);
  opacity: .8;
}

/* Cards */
.cards{
  display:grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 14px 0 14px;
}

.card{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 16px;
  box-shadow: var(--shadow);
}

.k{
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted2);
  font-weight: 900;
}

.v{
  margin-top: 8px;
  font-size: 20px;
  font-weight: 950;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.deltaRow{
  margin-top: 8px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}

.delta{
  font-size: 12px;
  font-weight: 900;
  display:flex;
  align-items:center;
  gap:8px;
}

.delta .badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 950;
  border: 1px solid var(--border);
  background: #fff;
}

.delta.pos{ color: var(--pos); }
.delta.pos .badge{ border-color: rgba(22,163,74,.28); background: rgba(22,163,74,.06); }

.delta.neg{ color: var(--neg); }
.delta.neg .badge{ border-color: rgba(220,38,38,.28); background: rgba(220,38,38,.06); }

.help{
  font-size: 11px;
  color: var(--muted);
  font-weight: 700;
}

/* Layout */
.grid2{
  display:grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 14px;
  margin-top: 14px;
}

.section{
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 16px;
  box-shadow: var(--shadow);
}

.sectionTitle{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom: 10px;
}

.sectionTitle h3{
  margin:0;
  font-size: 14px;
  font-weight: 950;
  letter-spacing: -0.01em;
}

.mini{
  font-size: 11px;
  color: var(--muted);
  font-weight: 800;
}

.ul{
  margin:0;
  padding-left: 18px;
}

.ul li{
  margin: 8px 0;
  font-size: 12px;
  color: var(--text);
  font-weight: 700;
  line-height: 1.4;
}

.callout{
  border-radius: 16px;
  padding: 14px;
  border: 1px solid rgba(37,99,235,.20);
  background: var(--accentSoft);
}

.callout .big{
  font-size: 13px;
  font-weight: 950;
  letter-spacing: -0.01em;
}

.callout .small{
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
  font-weight: 800;
}

/* Monthly table */
.table{
  width:100%;
  border-collapse: collapse;
  margin-top: 8px;
}

.tr{
  border-bottom: 1px solid var(--border);
}

th, td{
  padding: 9px 0;
  font-size: 12px;
}

th{
  text-align:left;
  color: var(--muted);
  font-weight: 900;
}

td{
  font-weight: 800;
}

.right{
  text-align:right;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

.mut{
  color: var(--muted);
  font-weight: 800;
}

/* Categories */
.progress{
  height: 10px;
  border-radius: 999px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  overflow: hidden;
}

.progress > span{
  display:block;
  height:100%;
  width:0%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(37,99,235,.65), rgba(37,99,235,.18));
}

/* Footer */
.footer{
  margin-top: 16px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
}

.footer .left{
  display:flex;
  gap:10px;
  align-items:center;
}

.footer .tag{
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 10px;
  font-weight: 900;
}

@media print{
  body{ background:#fff; }
  .container{ padding:0; }
  .card, .section{ box-shadow:none; }
}
</style>
</head>

<body>
  <div class="container">

    <div class="header">
      <div class="brand">
        <div class="logo">F</div>
        <div>
          <div class="title">Informe anual</div>
          <div class="sub">${safe(yearLabel)}</div>
        </div>
      </div>

      <div>
        <div class="meta">Generado: ${safe(generatedAt)}</div>
        <div class="pills">
          <span class="pill"><span class="dot"></span>Moneda: ${safe(currency)}</span>
          <span class="pill"><span class="dot"></span>Fuente: transacciones activas</span>
          <span class="pill"><span class="dot"></span>Sin transferencias</span>
        </div>
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="k">Ingresos</div>
        <div class="v">${fmt(totals.income)}</div>
        <div class="deltaRow">
          <div class="delta ${deltaClass(trends.incomeDelta)}">
            <span class="badge">${deltaArrow(trends.incomeDelta)} ${deltaFmt(trends.incomeDelta)}</span>
            <span class="help">vs año anterior</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k">Gastos</div>
        <div class="v">${fmt(totals.expense)}</div>
        <div class="deltaRow">
          <div class="delta ${deltaClass(trends.expenseDelta)}">
            <span class="badge">${deltaArrow(trends.expenseDelta)} ${deltaFmt(trends.expenseDelta)}</span>
            <span class="help">vs año anterior</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k">Ahorro</div>
        <div class="v">${fmt(totals.savings)}</div>
        <div class="deltaRow">
          <div class="delta ${deltaClass(trends.savingsDelta)}">
            <span class="badge">${deltaArrow(trends.savingsDelta)} ${deltaFmt(trends.savingsDelta)}</span>
            <span class="help">vs año anterior</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k">Tasa de ahorro</div>
        <div class="v">${pct(totals.savingsRate)}</div>
        <div class="help">sobre ingresos</div>
      </div>
    </div>

    <div class="grid2">
      <div class="section">
        <div class="sectionTitle">
          <h3>Insights</h3>
          <div class="mini">Lectura rápida</div>
        </div>
        <ul class="ul">
          <li>${safe(insight1)}</li>
          <li>${safe(insight2)}</li>
          <li>${safe(insight3)}</li>
          <li>${safe(insight4)}</li>
        </ul>
      </div>

      <div class="section callout">
        <div class="big">Resumen del año</div>
        <div class="small">
          Ingresos: <b>${fmt(totals.income)}</b> ·
          Gastos: <b>${fmt(totals.expense)}</b> ·
          Ahorro: <b>${fmt(totals.savings)}</b>
        </div>
        <div class="small" style="margin-top:8px">
          Balance neto: <b>${fmt(totals.income - totals.expense)}</b>
        </div>
      </div>
    </div>

    <div class="section" style="margin-top:14px">
      <div class="sectionTitle">
        <h3>Resumen mensual</h3>
        <div class="mini">distribución del año</div>
      </div>

      <div style="margin-top:6px; border:1px solid var(--border); border-radius:16px; background:#fff; overflow:hidden;">
        <svg width="100%" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none" style="display:block">
          <rect x="0" y="0" width="${chartW}" height="${chartH}" fill="#ffffff"></rect>
          ${svgBars}
        </svg>
      </div>

      <table class="table">
        <tr class="tr">
          <th>Mes</th>
          <th class="right">Ingresos</th>
          <th class="right">Gastos</th>
          <th class="right">Ahorro</th>
        </tr>
        ${
          monthly.length
            ? monthly
                .slice(0, 12)
                .map(
                  (m) => `
          <tr class="tr">
            <td class="mut">${safe(m.month)}</td>
            <td class="right">${fmt(Number(m.income) || 0)}</td>
            <td class="right">${fmt(Number(m.expense) || 0)}</td>
            <td class="right">${fmt(Number(m.savings) || 0)}</td>
          </tr>`
                )
                .join("")
            : `<tr class="tr"><td colspan="4" class="mut">Sin datos este año.</td></tr>`
        }
      </table>
    </div>

    <div class="section" style="margin-top:14px">
      <div class="sectionTitle">
        <h3>Top categorías de gasto</h3>
        <div class="mini">por importe y peso relativo</div>
      </div>

      <table class="table">
        ${
          topCategories.length
            ? topCategories
                .map((c) => {
                  const amount = Number(c.amount) || 0;
                  const w = catBarW(amount);
                  return `
                  <tr class="tr">
                    <td style="width:40%">${safe(c.name)}</td>
                    <td style="width:40%">
                      <div class="progress"><span style="width:${w}%"></span></div>
                    </td>
                    <td class="right" style="width:10%; color: var(--muted); font-weight:900;">${catPct(amount)}</td>
                    <td class="right" style="width:10%">${fmt(amount)}</td>
                  </tr>
                `;
                })
                .join("")
            : `<tr class="tr"><td colspan="4" class="mut">Sin categorías para mostrar.</td></tr>`
        }
      </table>
    </div>

    <div class="footer">
      <div class="left">
        <span class="tag">Finexa</span>
        <span>Informe anual</span>
      </div>
      <div>
        Nota: excluye transferencias y se basa únicamente en transacciones activas del periodo.
      </div>
    </div>

  </div>
</body>
</html>
`;
}
