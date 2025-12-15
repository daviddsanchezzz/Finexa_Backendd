// reports/templates/monthly-report.ts
export function monthlyReportHtml(params: {
  monthLabel: string;
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
  currency: string;
}) {
  const { monthLabel, totals, trends, topCategories, currency } = params;

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

  // Para % de categorías
  const totalTop = topCategories.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
  const catPct = (amount: number) => {
    const denom = totals.expense > 0 ? totals.expense : totalTop > 0 ? totalTop : 0;
    if (denom <= 0) return "0.0%";
    return `${((amount / denom) * 100).toFixed(1)}%`;
  };

  // Mini “insights” para darle vibe fintech
  const top1 = topCategories[0];
  const insight1 =
    totals.savingsRate >= 0.3
      ? "Buen mes: tu tasa de ahorro es sólida."
      : totals.savingsRate >= 0.15
      ? "Mes equilibrado: margen de mejora en ahorro."
      : "Atención: ahorro bajo este mes.";
  const insight2 = top1
    ? `Mayor categoría: ${top1.name} (${catPct(top1.amount)} del gasto).`
    : "Sin categorías suficientes para destacar.";
  const insight3 =
    trends.expenseDelta > 0
      ? "Tus gastos subieron vs el mes anterior."
      : trends.expenseDelta < 0
      ? "Tus gastos bajaron vs el mes anterior."
      : "Tus gastos se mantuvieron estables vs el mes anterior.";

  // Para barras de categoría (sobre el máximo)
  const maxCat = Math.max(...topCategories.map((c) => Number(c.amount) || 0), 0);
  const barW = (amount: number) => {
    if (maxCat <= 0) return 0;
    return Math.round((amount / maxCat) * 100);
  };

  const generatedAt = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Informe mensual · ${safe(monthLabel)}</title>
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
html, body { height:100%; }

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
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
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
  font-size: 22px;
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

/* Insights */
.grid2{
  display:grid;
  grid-template-columns: 1.1fr .9fr;
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

/* Categories */
.table{
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
}

.tr{
  border-bottom: 1px solid var(--border);
}

.td{
  padding: 12px 0;
  font-size: 12px;
  font-weight: 800;
  vertical-align: middle;
}

.td.name{
  width: 45%;
  padding-right: 12px;
}

.td.bar{
  width: 35%;
}

.td.pct{
  width: 10%;
  text-align:right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.td.amount{
  width: 10%;
  text-align:right;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
}

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
  body{ background: #fff; }
  .container{ padding: 0; }
  .card, .section{ box-shadow: none; }
}
</style>
</head>

<body>
  <div class="container">

    <div class="header">
      <div>
        <div class="brand">
          <div class="logo">F</div>
          <div>
            <div class="title">Informe mensual</div>
            <div class="sub">${safe(monthLabel)}</div>
          </div>
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
            <span class="help">vs mes anterior</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k">Gastos</div>
        <div class="v">${fmt(totals.expense)}</div>
        <div class="deltaRow">
          <div class="delta ${deltaClass(trends.expenseDelta)}">
            <span class="badge">${deltaArrow(trends.expenseDelta)} ${deltaFmt(trends.expenseDelta)}</span>
            <span class="help">vs mes anterior</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k">Ahorro</div>
        <div class="v">${fmt(totals.savings)}</div>
        <div class="deltaRow">
          <div class="delta">
            <span class="badge">Tasa ${pct(totals.savingsRate)}</span>
            <span class="help">sobre ingresos</span>
          </div>
        </div>
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
        </ul>
      </div>

      <div class="section callout">
        <div class="big">Resumen del periodo</div>
        <div class="small">
          Ingresos: <b>${fmt(totals.income)}</b> ·
          Gastos: <b>${fmt(totals.expense)}</b> ·
          Ahorro: <b>${fmt(totals.savings)}</b>
        </div>
        <div class="small" style="margin-top:8px">
          Consejo: revisa las 2 categorías principales y define un límite mensual.
        </div>
      </div>
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
                  const w = barW(amount);
                  return `
                    <tr class="tr">
                      <td class="td name">${safe(c.name)}</td>
                      <td class="td bar">
                        <div class="progress"><span style="width:${w}%"></span></div>
                      </td>
                      <td class="td pct">${catPct(amount)}</td>
                      <td class="td amount">${fmt(amount)}</td>
                    </tr>
                  `;
                })
                .join("")
            : `<tr class="tr"><td class="td" colspan="4" style="color:var(--muted);font-weight:900;">Sin datos de categorías en este periodo.</td></tr>`
        }
      </table>
    </div>

    <div class="footer">
      <div class="left">
        <span class="tag">Finexa</span>
        <span>Informe mensual</span>
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
