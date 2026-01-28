import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Svg,
  Path,
  Circle,
  Polyline,
  Line,
} from "@react-pdf/renderer";
import { formatMoney, formatSignedMoney } from "./pdf.utils";
import { KpiCard } from "./templates/KpiCard";

type Delta = { value: number; pct?: number | null };
type CategoryRow = { name: string; amount: number };

type SubcategoryRow = {
  subcategoryId: number;
  name: string;
  amount: number;
};

// Traduce tipo de operación (buy/sell/transfer/etc)
type BackendOpType =
  | "buy"
  | "sell"
  | "transfer_in"
  | "transfer_out"
  | "swap_in"
  | "swap_out"
  | string;

function opLabel(t: BackendOpType) {
  switch (t) {
    case "transfer_in":
      return "Aportación";
    case "transfer_out":
      return "Retirada";
    case "buy":
      return "Compra";
    case "sell":
      return "Venta";
    case "swap_in":
      return "Swap (entrada)";
    case "swap_out":
      return "Swap (salida)";
    default:
      // fallback: Capitaliza si viene algo nuevo
      return String(t || "—")
        .replaceAll("_", " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

// Traduce tipo de activo (crypto/stock/etc)
type InvestmentAssetType =
  | "crypto"
  | "etf"
  | "stock"
  | "fund"
  | "custom"
  | "cash"
  | string;

function assetTypeLabel(t: InvestmentAssetType) {
  switch (t) {
    case "crypto":
      return "Cripto";
    case "etf":
      return "ETF";
    case "stock":
      return "Acción";
    case "fund":
      return "Fondo";
    case "custom":
      return "Personalizado";
    case "cash":
      return "Efectivo";
    default:
      return "Otro";
  }
}

export type InvestmentAssetMini = {
  id: number;
  name: string;
  type: string;
  identificator?: string | null;
  currency?: string | null;
};

type AssetMonthlyPerformanceRow = {
  asset: InvestmentAssetMini;
  startValue: number | null;
  endValue: number | null;
  cashflowNet: number;   // neto del mes para ese asset
  profit: number | null; // end - start - cashflow
  returnPct: number | null;
  startSnapAt?: string | null;
  endSnapAt?: string | null;
};


type InvestmentOperationRow = {
  id: number;
  date: string; // ISO
  type: string; // "buy" | "sell" | ...
  amount: number;
  fee: number;
  transactionId?: number | null;
  swapGroupId?: number | null;
  asset: InvestmentAssetMini;
};


type CategoryWithSubs = {
  categoryId: number;
  name: string;
  amount: number;
  color?: string | null;
  subcategories: SubcategoryRow[];
};


export type MonthlyParams = {
  monthLabel: string;
  monthKey: string;
  generatedAtISO?: string;
  walletName?: string | null;
  currency: string;
  totals: { income: number; expense: number; savings: number; savingsRate: number };
  trends: { income: Delta; expense: Delta; savings: Delta };
  categoriesBreakdown?: { expense: CategoryRow[]; income: CategoryRow[] };
  dailyExpense?: { date: string; amount: number }[];
    categoriesWithSubcategories?: {
    income: CategoryWithSubs[];
    expense: CategoryWithSubs[];
  };
    netWorthTotal?: number | null; // <-- NUEVO (patrimonio total)
investments?: {
  operations: InvestmentOperationRow[];
  performanceByAsset?: AssetMonthlyPerformanceRow[];
};



  // opcional: si también lo guardas flat
  subcategoriesBreakdown?: {
    income: Array<SubcategoryRow & { categoryId: number | null }>;
    expense: Array<SubcategoryRow & { categoryId: number | null }>;
  };
};

const palette = {
  ink: "#0F172A",
  muted: "#64748B",
  faint: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F8FAFC",
  card: "#FFFFFF",
  primary: "#2563EB",
  good: "#16A34A",
  bad: "#DC2626",
};

const styles = StyleSheet.create({
    sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 6 },
sectionSub: { fontSize: 10, color: palette.muted, marginBottom: 10 },

table: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, overflow: "hidden" },
thead: { flexDirection: "row", backgroundColor: "#F8FAFC", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
th: { fontSize: 9.5, color: palette.muted, fontWeight: 700 },

tr: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
trLast: { borderBottomWidth: 0 },

colName: { flex: 1 },
colPct: { width: 56, textAlign: "right" },
colAmt: { width: 92, textAlign: "right" },

catName: { fontWeight: 700, fontSize: 10.5 },
subName: { fontSize: 10, color: palette.ink },
subIndent: { marginLeft: 14 },

muted: { color: palette.muted },
small: { fontSize: 9.5, color: palette.muted },

pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, fontSize: 9.5, fontWeight: 700 },
pillGood: { backgroundColor: "#DCFCE7", color: palette.good },
pillBad: { backgroundColor: "#FEE2E2", color: palette.bad },

  page: {
    paddingTop: 22,
    paddingBottom: 26,
    paddingHorizontal: 26,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: palette.ink,
    backgroundColor: "#FFFFFF",
  },

  headerWrap: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: { fontSize: 18, fontWeight: 700 },
  subtitle: { marginTop: 4, color: palette.muted, fontSize: 10.5 },
  metaRight: { alignItems: "flex-end" },
  metaText: { color: palette.muted, fontSize: 10 },

  kpiRow: { flexDirection: "row", marginTop: 12 },
  kpiCard: {
    flex: 1,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 12,
  },
  kpiCardMid: { marginHorizontal: 10 },
  kpiLabel: { color: palette.muted, fontSize: 10 },
  kpiValue: { marginTop: 6, fontSize: 16, fontWeight: 700 },
  kpiSub: { marginTop: 6, flexDirection: "row", alignItems: "center" },
  deltaPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 9,
    fontWeight: 700,
  },

  dashStack: { marginTop: 12 },
  dashCard: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 12,
  },
  dashCardSpacing: { marginTop: 8 },

  dashTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  dashTitle: { fontSize: 12, fontWeight: 700 },
  dashMeta: { fontSize: 10, color: palette.muted },

  // Legend (mejorada)
legend: { marginLeft: 14, flex: 1 },
legendHeader: {
  flexDirection: "row",
  paddingBottom: 6,
  marginBottom: 8,
  borderBottomWidth: 1,
  borderBottomColor: "#F1F5F9",
},
lhName: { flex: 1, fontSize: 9.5, color: palette.muted, fontWeight: 700 },
lhPct: { width: 58, textAlign: "right", fontSize: 9.5, color: palette.muted, fontWeight: 700 },
lhAmt: { width: 86, textAlign: "right", fontSize: 9.5, color: palette.muted, fontWeight: 700 },

legendRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
dot: { width: 8, height: 8, borderRadius: 999, marginRight: 8 },
lrName: { flex: 1, fontSize: 10.5, fontWeight: 700, color: palette.ink },
lrPct: { width: 58, textAlign: "right", fontSize: 10, color: palette.muted },
lrAmt: { width: 86, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: palette.ink },

  donutRow: { flexDirection: "row", alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  legendName: { fontSize: 10.5, fontWeight: 700, color: palette.ink },
  legendMeta: { fontSize: 10, color: palette.muted, marginTop: 1 },

  lineFooter: { marginTop: 8, flexDirection: "row", justifyContent: "space-between" },
  smallMuted: { fontSize: 9.5, color: palette.muted },

  invPerfTable: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, overflow: "hidden", marginTop: 12 },
invPerfHead: { flexDirection: "row", backgroundColor: "#F8FAFC", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
invPerfRow: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
invPerfLast: { borderBottomWidth: 0 },

invPerfColAsset: { flex: 1 },
invPerfColNum: { width: 78, textAlign: "right" },
invPerfColPct: { width: 58, textAlign: "right" },

invPerfName: { fontSize: 10.5, fontWeight: 700, color: palette.ink },
invPerfSub: { fontSize: 9, color: palette.muted, marginTop: 1 },


  footer: {
    position: "absolute",
    left: 26,
    right: 26,
    bottom: 14,
    fontSize: 9,
    color: palette.faint,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  group: { /* separador visual entre categorías */
  // Si quieres más aire entre grupos, descomenta:
  // paddingBottom: 2,
},

catTr: {
  backgroundColor: "#F8FAFC",
  borderBottomColor: "#E2E8F0",
  borderBottomWidth: 1,
  paddingVertical: 8, // un pelín más que sub
},


subTr: {
  backgroundColor: "#FFFFFF",
  paddingVertical: 6,
},


invTable: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, overflow: "hidden" },
invHead: { flexDirection: "row", backgroundColor: "#F8FAFC", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
invRow: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
invLast: { borderBottomWidth: 0 },

invColDate: { width: 70 },
invColAsset: { flex: 1 },
invColType: { width: 54, textAlign: "right" },
invColAmt: { width: 80, textAlign: "right" },
invColFee: { width: 60, textAlign: "right" },

invTypeBuy: { color: palette.good, fontWeight: 700 },
invTypeSell: { color: palette.bad, fontWeight: 700 },

invAssetSub: { fontSize: 9, color: palette.muted, marginTop: 1 },


// styles
catRow: {
  backgroundColor: "#F8FAFC",
  paddingVertical: 9,
},
catBar: {
  width: 3,
  borderRadius: 2,
  marginRight: 8,
},
catNameWrap: { flexDirection: "row", alignItems: "center" },
catAmt: { fontWeight: 800 }, // más fuerte que 700

subRow: {
  backgroundColor: "#FFFFFF",
  paddingVertical: 6,
},
subRowAlt: {
  backgroundColor: "#FBFDFF",
},
subBullet: { color: "#94A3B8" },
subAmt: { fontWeight: 400, color: "#94A3B8", fontSize: 9},

  pctCell: { width: 64, flexDirection: "row", justifyContent: "flex-end" },
  pctText: { fontSize: 9, color: "#94A3B8" },

  invSummary: {
  marginTop: 10,
  borderWidth: 1,
  borderColor: palette.border,
  borderRadius: 12,
  backgroundColor: "#FFFFFF",
  paddingVertical: 10,
  paddingHorizontal: 12,
},
invSummaryRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
invSummaryLabel: { fontSize: 9.5, color: palette.muted, fontWeight: 700 },
invSummaryValue: { fontSize: 9.5, color: palette.ink, fontWeight: 700 },


});

 function fmtPct1(p: number) {
  // p es ratio: 0.0412 => 4.1%
  const v = Math.round(p * 1000) / 10; // 1 decimal
  // usa coma decimal ES
  const s = v.toFixed(1).replace(".", ",");
  return `${s}%`;
}

function sumAmounts(rows: { amount: number }[]) {
  return rows.reduce((a, r) => a + Number(r.amount || 0), 0);
}

function pctLabel(part: number, total: number) {
  const p = total > 0 ? part / total : 0;
  return fmtPct1(p);
}

function sortByAmountDesc<T extends { amount: number }>(rows: T[]) {
  return [...rows].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
}

function fmtMoneyOrDash(v: number | null | undefined, currency: string) {
  return v == null ? "—" : formatMoney(Number(v), currency);
}

function fmtPctOrDash(v: number | null | undefined) {
  return v == null ? "—" : fmtPct1(Number(v));
}


function normalizePct(pct: any): number | null {
  if (pct === null || pct === undefined) return null;
  const n = Number(pct);
  if (!isFinite(n)) return null;
  // si viene como 4 => 4% ya, lo pasamos a 0.04
  if (Math.abs(n) > 1.5) return n / 100;
  return n;
}

function fmtDeltaLabel(d: { value: number; pct?: number | null }, currency: string) {
  const v = Number(d?.value || 0);
  const pctRaw = normalizePct(d?.pct);

  // Si pct existe pero el signo no cuadra con value, lo “arreglamos”
  // Ej: value +41€ pero pct -4% -> forzamos +4%
  const pct =
    pctRaw == null
      ? null
      : (v === 0 ? pctRaw : (Math.sign(pctRaw) !== Math.sign(v) ? Math.abs(pctRaw) * Math.sign(v) : pctRaw));

  const arrow = v >= 0 ? "↑ " : "↓ ";
  const money = formatSignedMoney(v, currency);

  const pctLabel =
    pct == null
      ? ""
      : ` (${pct >= 0 ? "+" : ""}${fmtPct1(pct)})`;

  return `${money}${pctLabel}`;
}

function chipStyleForDelta(deltaValue: number) {
  return deltaValue >= 0
    ? { backgroundColor: "#DCFCE7", color: palette.good }
    : { backgroundColor: "#FEE2E2", color: palette.bad };
}

function fmtISODate(iso?: string) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(d);
  } catch {
    return null;
  }
}
function fmtShortDate(iso: string) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(d);
  } catch {
    return iso?.slice(0, 10) ?? "—";
  }
}


// ---------- SVG helpers ----------
function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const start = polarToCartesian(cx, cy, r, a0);
  const end = polarToCartesian(cx, cy, r, a1);
  const largeArcFlag = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

// ---------- Donut ----------
function DonutChart(props: {
  values: { label: string; value: number; color: string }[];
  totalLabel: string;
  totalValueLabel: string;
  size?: number;
  stroke?: number;
}) {
  const { values, size = 120, stroke = 16, totalLabel, totalValueLabel } = props;
  const total = values.reduce((a, v) => a + Math.max(0, v.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2;

  let angle = -Math.PI / 2;

  return (
    <View style={{ position: "relative", width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke="#E5E7EB" strokeWidth={stroke} fill="none" />
        {total > 0
          ? values.map((s, i) => {
              const v = Math.max(0, s.value);
              const sweep = (v / total) * Math.PI * 2;
              const a0 = angle;
              const a1 = angle + sweep;
              angle = a1;
              if (sweep < 0.03) return null;
              return (
                <Path
                  key={`${s.label}-${i}`}
                  d={arcPath(cx, cy, r, a0, a1)}
                  stroke={s.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                />
              );
            })
          : null}
      </Svg>

      {/* center label */}
<View
  style={{
    position: "absolute",
    left: 0,
    top: 0,
    width: size,
    height: size,
    alignItems: "center",
    justifyContent: "center",
  }}
>
  <Text style={{ fontSize: 9, color: palette.muted }}>Gasto total</Text>
  <Text style={{ marginTop: 2, fontSize: 13.5, fontWeight: 700, color: palette.ink }}>
    {totalValueLabel}
  </Text>
  <Text style={{ marginTop: 2, fontSize: 8.5, color: palette.faint }}>
    Top categorías
  </Text>
</View>
    </View>
  );
}

function BreakdownTable(props: {
  title: string;
  subtitle: string;
  rows: CategoryWithSubs[];
  totalLabel: string;
  currency: string;
}) {
  const { title, subtitle, rows, totalLabel, currency } = props;

  const sorted = sortByAmountDesc(rows || []).filter((r) => Number(r.amount || 0) !== 0);
  const total = sumAmounts(sorted);

  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSub}>{subtitle}</Text>

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={styles.small}>{totalLabel}</Text>
        <Text style={{ fontSize: 11, fontWeight: 700 }}>{formatMoney(total, currency)}</Text>
      </View>

      {sorted.length === 0 ? (
        <Text style={{ color: palette.muted }}>No hay datos en este periodo.</Text>
      ) : (
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, styles.colName]}>Categoría / Subcategoría</Text>
            <Text style={[styles.th, styles.colPct]}>%</Text>
            <Text style={[styles.th, styles.colAmt]}>Importe</Text>
          </View>

          {sorted.map((c, idx) => {
            const isLastCat = idx === sorted.length - 1;
            const subs = sortByAmountDesc(c.subcategories || []).filter((s) => Number(s.amount || 0) !== 0);
            const catTotal = Number(c.amount || 0);

            // Color “barra” (si tienes color por categoría)
            const barColor = c.color || palette.primary;

            const catRowStyles = [
              styles.tr,
              styles.catRow, // <-- nuevo
              ...(subs.length === 0 && isLastCat ? [styles.trLast] : []),
            ];

            return (
              <View key={`cat-${c.categoryId}-${idx}`}>
                {/* Categoría */}
                <View style={catRowStyles}>
                  <View style={[styles.catBar, { backgroundColor: barColor }]} />
                  <View style={[styles.colName, styles.catNameWrap]}>
                    <Text style={styles.catName}>
                      {c.name}
                    </Text>
                  </View>

                  <Text style={[styles.colPct, styles.catAmt]}>{pctLabel(catTotal, total)}</Text>
                  <Text style={[styles.colAmt, styles.catAmt]}>{formatMoney(catTotal, currency)}</Text>
                </View>

                {/* Subcategorías */}
                {subs.map((s, sIdx) => {
  const isLastRow = isLastCat && sIdx === subs.length - 1;

  const amt = Number(s.amount || 0);
  const pctInCat = catTotal > 0 ? amt / catTotal : 0;
  const pctOfTotal = total > 0 ? amt / total : 0;

  const subRowStyles = [
    styles.tr,
    styles.subRow,
    ...(isLastRow ? [styles.trLast] : []),
  ];

  return (
    <View
      key={`sub-${c.categoryId}-${s.subcategoryId}-${sIdx}`}
      style={subRowStyles}
    >
      <Text style={[styles.colName, styles.subName, styles.subIndent]}>
        <Text style={styles.subBullet}>• </Text>
        {s.name}
      </Text>

      {/* % en una sola línea */}
      <View style={styles.pctCell}>
        <Text style={styles.pctText} wrap={false}>
          {fmtPct1(pctInCat)}{" "}{`(${fmtPct1(pctOfTotal)})`}
        </Text>
      </View>

      <Text style={[styles.colAmt, styles.subAmt]}>
        {formatMoney(amt, currency)}
      </Text>
    </View>
  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}


function PageIncome({ p }: { p: MonthlyParams }) {
  const rows =
    p.categoriesWithSubcategories?.income?.length
      ? p.categoriesWithSubcategories.income
      : (p.categoriesBreakdown?.income || []).map((c: any, i: number) => ({
          categoryId: i + 1,
          name: c.name,
          amount: Number(c.amount || 0),
          subcategories: [],
        }));

  return (
    <Page size="A4" style={styles.page}>
      <BreakdownTable
        title="Ingresos por categoría"
        subtitle={`Periodo: ${p.monthLabel}${p.walletName ? ` · Cartera: ${p.walletName}` : ""}`}
        rows={rows}
        totalLabel="Total ingresos"
        currency={p.currency}
      />

      <View style={styles.footer} fixed>
        <Text>Finexa · Reportes</Text>
        <Text>
          {p.monthKey} · {p.walletName ?? "Todas las carteras"}
        </Text>
      </View>
    </Page>
  );
}

function PageExpense({ p }: { p: MonthlyParams }) {
  const rows =
    p.categoriesWithSubcategories?.expense?.length
      ? p.categoriesWithSubcategories.expense
      : (p.categoriesBreakdown?.expense || []).map((c: any, i: number) => ({
          categoryId: i + 1,
          name: c.name,
          amount: Number(c.amount || 0),
          subcategories: [],
        }));

  return (
    <Page size="A4" style={styles.page}>
      <BreakdownTable
        title="Gastos por categoría"
        subtitle={`Periodo: ${p.monthLabel}${p.walletName ? ` · Cartera: ${p.walletName}` : ""}`}
        rows={rows}
        totalLabel="Total gastos"
        currency={p.currency}
      />

      <View style={styles.footer} fixed>
        <Text>Finexa · Reportes</Text>
        <Text>
          {p.monthKey} · {p.walletName ?? "Todas las carteras"}
        </Text>
      </View>
    </Page>
  );
}

function PageInvestments({ p }: { p: MonthlyParams }) {
  const currency = p.currency;

  // -----------------------------
  // Ops
  // -----------------------------
  const ops = (p.investments?.operations || [])
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const opsCount = ops.length;

  const totalBuys = ops.reduce(
    (acc, o) => acc + (o.type === "buy" ? Number(o.amount || 0) : 0),
    0
  );

  const totalSells = ops.reduce(
    (acc, o) => acc + (o.type === "sell" ? Number(o.amount || 0) : 0),
    0
  );

  const totalFees = ops.reduce((acc, o) => acc + Number(o.fee || 0), 0);

  // Neto del mes: ventas - compras - comisiones
  const net = totalSells - totalBuys - totalFees;

  // -----------------------------
  // Performance (por activo)
  // - Calculables primero
  // - Luego los "null" (faltan valoraciones)
  // - Orden por abs(profit)
  // -----------------------------
  const perfRaw = p.investments?.performanceByAsset || [];

  const perf = perfRaw
    .slice()
    .sort((a, b) => {
      const aOk = a.profit != null;
      const bOk = b.profit != null;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return (
        Math.abs(Number(b.profit ?? 0)) - Math.abs(Number(a.profit ?? 0))
      );
    });

  const hasPerf = perf.length > 0;
  const hasPerfCalculable = perf.some((r) => r.profit != null);

  const perfCalculable = perf.filter((r) => r.profit != null && r.startValue != null && r.startValue > 0);

  
  // (Opcional útil) total profit calculable
  const totalProfitCalculable = perf.reduce(
    (acc, r) => acc + (r.profit == null ? 0 : Number(r.profit)),
    0
  );

  // start "efectivo": si no hay snapshot inicial, usa cashflow (tu regla)
function effectiveStart(r: AssetMonthlyPerformanceRow) {
  if (r.startValue != null && r.startValue > 0) return Number(r.startValue);

  // Si tu cashflow es "aportaciones" (compras/transfer_in en positivo), esto cuadra:
  const cf = Number(r.cashflowNet ?? 0);
  if (cf > 0) return cf;

  return null;
}

const rowsOk = perf
  .map((r) => {
    const startReal = r.startValue != null ? Number(r.startValue) : null; // SOLO snapshot
    const end = r.endValue != null ? Number(r.endValue) : null;
    const cash = Number(r.cashflowNet ?? 0);

    const sEff = effectiveStart(r); // para calcular profit aunque no haya startReal

    const profitEff =
      r.profit != null
        ? Number(r.profit)
        : (sEff != null && end != null ? end - sEff : null);

    // "calculable": puedo obtener profit
    const calculable = profitEff != null && end != null && sEff != null && sEff > 0;

    return calculable ? { startReal, end, cash, profitEff } : null;
  })
  .filter(Boolean) as Array<{ startReal: number | null; end: number; cash: number; profitEff: number }>;

// Totales
const totalStart = rowsOk.reduce((acc, x) => acc + (x.startReal ?? 0), 0); // 👈 SOLO starts reales
const totalEnd = rowsOk.reduce((acc, x) => acc + x.end, 0);
const totalCashflow = rowsOk.reduce((acc, x) => acc + x.cash, 0);
const totalProfit = rowsOk.reduce((acc, x) => acc + x.profitEff, 0);

// % total: aquí hay 2 opciones
// A) coherente con "Inicio total" (solo snapshot): ojo, puede infra-representar activos nuevos
const totalReturnPct = totalStart > 0 ? totalProfit / totalStart : null;


  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.sectionTitle}>Inversiones</Text>
      <Text style={styles.sectionSub}>
        {p.monthLabel}
        {p.walletName ? ` · Cartera: ${p.walletName}` : ""}
      </Text>

      {/* =========================
          OPERACIONES + RESUMEN
         ========================= */}
      {ops.length === 0 ? (
        <View style={{ marginTop: 4 }}>
          <Text style={{ color: palette.muted }}>
            No hay operaciones de inversión en este periodo.
          </Text>
        </View>
      ) : (
        <>
          {/* Tabla ops */}
          <View style={styles.invTable}>
            <View style={styles.invHead}>
              <Text style={[styles.th, styles.invColDate]}>Fecha</Text>
              <Text style={[styles.th, styles.invColAsset]}>Activo</Text>
              <Text style={[styles.th, styles.invColType]}>Tipo</Text>
              <Text style={[styles.th, styles.invColAmt]}>Importe</Text>
              <Text style={[styles.th, styles.invColFee]}>Comisión</Text>
            </View>

            {ops.map((o, idx) => {
              const isLast = idx === ops.length - 1;
              const isBuy = o.type === "buy";
              const isSell = o.type === "sell";

              const assetSub = [assetTypeLabel(o.asset?.type), o.asset?.identificator]
                .filter(Boolean)
                .join(" · ");

              return (
                <View
                  key={o.id}
                  style={[styles.invRow, ...(isLast ? [styles.invLast] : [])]}
                >
                  <Text style={[styles.small, styles.invColDate]} wrap={false}>
                    {fmtShortDate(o.date)}
                  </Text>

                  <View style={styles.invColAsset}>
                    <Text
                      style={{ fontSize: 10.5, fontWeight: 700 }}
                      wrap={false}
                    >
                      {o.asset?.name ?? "—"}
                    </Text>

                    {!!assetSub ? (
                      <Text style={styles.invAssetSub} wrap={false}>
                        {assetSub}
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.small,
                      styles.invColType,
                      ...(isBuy ? [styles.invTypeBuy] : []),
                      ...(isSell ? [styles.invTypeSell] : []),
                    ]}
                    wrap={false}
                  >
                    {opLabel(o.type)}
                  </Text>

                  <Text style={[styles.small, styles.invColAmt]} wrap={false}>
                    {formatMoney(Number(o.amount || 0), currency)}
                  </Text>

                  <Text style={[styles.small, styles.invColFee]} wrap={false}>
                    {formatMoney(Number(o.fee || 0), currency)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* =========================
          RENTABILIDAD POR ACTIVO
         ========================= */}
      <View style={{ marginTop: 14 }}>
        <Text style={styles.sectionTitle}>Rentabilidad por activo</Text>
        <Text style={styles.sectionSub}>
          Inicio/fin de mes + cashflow neto (sin swaps)
        </Text>

        {hasPerf ? (
          <>
            <View style={styles.invPerfTable}>
              <View style={styles.invPerfHead}>
                <Text style={[styles.th, styles.invPerfColAsset]}>Activo</Text>
                <Text style={[styles.th, styles.invPerfColNum]}>Inicio</Text>
                <Text style={[styles.th, styles.invPerfColNum]}>Fin</Text>
                <Text style={[styles.th, styles.invPerfColNum]}>Cashflow</Text>
                <Text style={[styles.th, styles.invPerfColNum]}>Rentab.</Text>
                <Text style={[styles.th, styles.invPerfColPct]}>%</Text>
              </View>

              {perf.map((r, idx) => {
                const isLast = idx === perf.length - 1;

                const profit = r.profit == null ? null : Number(r.profit);
                const profitColor =
                  profit == null
                    ? palette.muted
                    : profit > 0
                    ? palette.good
                    : profit < 0
                    ? palette.bad
                    : palette.muted;

                const cash = Number(r.cashflowNet ?? 0);
                const cashColor =
                  cash > 0 ? palette.good : cash < 0 ? palette.bad : palette.muted;

                const assetLabel = r.asset?.name ?? "—";
                const assetSub = [
                  assetTypeLabel(r.asset?.type),
                  r.asset?.identificator,
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <View
                    key={`perf-${r.asset?.id}-${idx}`}
                    style={[
                      styles.invPerfRow,
                      ...(isLast ? [styles.invPerfLast] : []),
                    ]}
                  >
                    <View style={styles.invPerfColAsset}>
                      <Text style={styles.invPerfName} wrap={false}>
                        {assetLabel}
                      </Text>
                      {!!assetSub && (
                        <Text style={styles.invPerfSub} wrap={false}>
                          {assetSub}
                        </Text>
                      )}
                    </View>

                    <Text style={[styles.small, styles.invPerfColNum]} wrap={false}>
                      {fmtMoneyOrDash(r.startValue, currency)}
                    </Text>

                    <Text style={[styles.small, styles.invPerfColNum]} wrap={false}>
                      {fmtMoneyOrDash(r.endValue, currency)}
                    </Text>

                    <Text
                      style={[
                        styles.small,
                        styles.invPerfColNum,
                        { color: cashColor },
                      ]}
                      wrap={false}
                    >
                      {formatSignedMoney(cash, currency)}
                    </Text>

                    <Text
                      style={[
                        styles.small,
                        styles.invPerfColNum,
                        { color: profitColor, fontWeight: 700 },
                      ]}
                      wrap={false}
                    >
                      {profit == null ? "—" : formatSignedMoney(profit, currency)}
                    </Text>

                    <Text
                      style={[
                        styles.small,
                        styles.invPerfColPct,
                        { color: profitColor, fontWeight: 700 },
                      ]}
                      wrap={false}
                    >
                      {fmtPctOrDash(r.returnPct)}
                    </Text>
                  </View>
                );
              })}

                          {perfCalculable.length > 0 ? (
  <View
    style={[
      styles.invPerfRow,
      {
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: "#F8FAFC",
      },
    ]}
  >
    <View style={styles.invPerfColAsset}>
      <Text style={[styles.invPerfName, { fontWeight: 800 }]}>Total</Text>
      <Text style={styles.invPerfSub}>Activos calculables</Text>
    </View>

    <Text style={[styles.small, styles.invPerfColNum]} wrap={false}>
      {formatMoney(totalStart, currency)}
    </Text>

<Text style={[styles.small, styles.invPerfColNum]} wrap={false}>
  {formatMoney(totalEnd, currency)}
</Text>

<Text style={[styles.small, styles.invPerfColNum]} wrap={false}>
  {formatSignedMoney(totalCashflow, currency)}
</Text>
    <Text
      style={[
        styles.small,
        styles.invPerfColNum,
        { fontWeight: 800, color: totalProfit >= 0 ? palette.good : palette.bad },
      ]}
      wrap={false}
    >
      {formatSignedMoney(totalProfit, currency)}
    </Text>

    <Text
      style={[
        styles.small,
        styles.invPerfColPct,
        { fontWeight: 800, color: totalProfit >= 0 ? palette.good : palette.bad },
      ]}
      wrap={false}
    >
      {totalReturnPct == null ? "—" : fmtPct1(totalReturnPct)}
    </Text>
  </View>
) : null}

            </View>


          </>
        ) : (
          <View style={{ marginTop: 6 }}>
            <Text style={{ color: palette.muted }}>
              No hay datos de rentabilidad por activo (faltan valoraciones).
            </Text>
          </View>
        )}
      </View>

      <View style={styles.footer} fixed>
        <Text>Finexa · Reportes</Text>
        <Text>
          {p.monthKey} · {p.walletName ?? "Todas las carteras"}
        </Text>
      </View>
    </Page>
  );
}




// ---------- Line chart ----------
function LineChart(props: {
  points: number[];
  width?: number;
  height?: number;
  tickLabels?: { left: string; mid: string; right: string };
}) {
  const { points, width = 520, height = 140, tickLabels } = props;
  const n = points.length;

  if (!n) {
    return (
      <View style={{ height }}>
        <Text style={{ color: palette.muted }}>No hay datos.</Text>
      </View>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1e-9, max - min);

  const padX = 10;
  const padY = 10;

  const w = width - padX * 2;
  const h = height - padY * 2;

  const xy = points.map((v, i) => {
    const x = padX + (n === 1 ? 0 : (i / (n - 1)) * w);
    const y = padY + (1 - (v - min) / range) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  // x positions for 3 ticks
  const xL = padX;
  const xM = padX + w / 2;
  const xR = padX + w;

  return (
    <View>
      <Svg width={width} height={height}>
        <Line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#E5E7EB" strokeWidth={1} />
        <Polyline points={xy.join(" ")} fill="none" stroke={palette.primary} strokeWidth={2} />
      </Svg>

      {tickLabels ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          <Text style={{ fontSize: 9, color: palette.faint }}>{tickLabels.left}</Text>
          <Text style={{ fontSize: 9, color: palette.faint }}>{tickLabels.mid}</Text>
          <Text style={{ fontSize: 9, color: palette.faint }}>{tickLabels.right}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------- slices ----------
function buildTopSlices(expenseRows: CategoryRow[]) {
  const rows = [...(expenseRows || [])]
    .filter((r) => Number(r.amount) > 0)
    .sort((a, b) => b.amount - a.amount);

  const top = rows.slice(0, 4);
  const othersAmt = rows.slice(4).reduce((a, r) => a + r.amount, 0);

  const colors = ["#2563EB", "#7C3AED", "#F59E0B", "#10B981", "#64748B"];

  const slices = top.map((r, i) => ({ label: r.name, value: r.amount, color: colors[i % colors.length] }));
  if (othersAmt > 0) slices.push({ label: "Otros", value: othersAmt, color: colors[4] });

  const total = rows.reduce((a, r) => a + r.amount, 0);
  return { slices, total };
}

function monthDayLabel(iso: string) {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(d);
  } catch {
    return iso;
  }
}

export function MonthlyReportPdf({ p }: { p: MonthlyParams }) {
  const generatedLabel = fmtISODate(p.generatedAtISO);
  const rate = Math.max(0, Math.min(1, p.totals.savingsRate || 0));

  const incomeChip = (
    <Text style={[styles.deltaPill, chipStyleForDelta(p.trends.income.value)]}>
      {fmtDeltaLabel(p.trends.income, p.currency)}
    </Text>
  );

  const expenseChip = (
    <Text
      style={[
        styles.deltaPill,
        // gasto: subir es malo, bajar es bueno
        p.trends.expense.value <= 0
          ? { backgroundColor: "#DCFCE7", color: palette.good }
          : { backgroundColor: "#FEE2E2", color: palette.bad },
      ]}
    >
      {fmtDeltaLabel(p.trends.expense, p.currency)}
    </Text>
  );

  const savingsChip = (
    <Text style={[styles.deltaPill, chipStyleForDelta(p.trends.savings.value)]}>
      {fmtDeltaLabel(p.trends.savings, p.currency)}
    </Text>
  );

  const expenseAll = p.categoriesBreakdown?.expense ?? [];
  const { slices, total: expenseTotal } = buildTopSlices(expenseAll);

  const daily = (p.dailyExpense || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const dailyPoints = daily.map((d) => Number(d.amount || 0));
  const dailySum = dailyPoints.reduce((a, v) => a + v, 0);
  const dailyMax = dailyPoints.length ? Math.max(...dailyPoints) : 0;

  const firstDay = daily.length ? monthDayLabel(daily[0].date) : "—";
  const lastDay = daily.length ? monthDayLabel(daily[daily.length - 1].date) : "—";

  const midIdx = daily.length ? Math.floor((daily.length - 1) / 2) : 0;
  const midDay = daily.length ? monthDayLabel(daily[midIdx].date) : "—";

  const income = Number(p.totals?.income || 0);
const expense = Number(p.totals?.expense || 0);
const savings = Number(p.totals?.savings || 0);
const savingsRate = Math.max(0, Math.min(1, Number(p.totals?.savingsRate || 0)));

const netWorth = p.netWorthTotal == null ? null : Number(p.netWorthTotal);

const balanceLabel = formatMoney(savings, p.currency); // o formatMoney(income - expense, p.currency)
const savingsRateLabel = fmtPct1(savingsRate);

// chips (texto)
const incomeChipText = fmtDeltaLabel(p.trends.income, p.currency);
const expenseChipText = fmtDeltaLabel(p.trends.expense, p.currency);

// colores gasto: subir gasto = malo
const expenseChipColors =
  Number(p.trends.expense?.value || 0) <= 0
    ? { bg: "#DCFCE7", fg: palette.good } // baja gasto => bueno
    : { bg: "#FEE2E2", fg: palette.bad }; // sube gasto => malo

// balance: lo consideramos "bueno" si sube, "malo" si baja
const balanceChipColors =
  savings >= 0 ? { bg: "#DCFCE7", fg: palette.good } : { bg: "#FEE2E2", fg: palette.bad };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerWrap}>
          <View style={styles.headerTopRow}>
            <View>
              <Text style={styles.title}>Informe mensual</Text>
              <Text style={styles.subtitle}>{p.monthLabel}</Text>
              {p.walletName ? (
                <Text style={[styles.subtitle, { marginTop: 2 }]}>Cartera: {p.walletName}</Text>
              ) : null}
            </View>

            <View style={styles.metaRight}>
              <Text style={styles.metaText}>Moneda: {p.currency}</Text>
              {generatedLabel ? <Text style={styles.metaText}>Generado: {generatedLabel}</Text> : null}
            </View>
          </View>


<View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
  {/* Patrimonio: más ancho */}
  <KpiCard
    variant="premium"
    tone="neutral"
    size="lg"
    title="PATRIMONIO TOTAL"
    value={formatMoney(p.netWorthTotal ?? 0, p.currency)}
    bottomText={p.walletName ?? "Todas las carteras"}
    style={{ flexGrow: 2, flexBasis: 0 }}
  />

  <KpiCard
    tone="info"
    title="BALANCE"
    value={formatMoney(p.totals.savings, p.currency)}
    bottomText={`Ahorro: ${fmtPct1(p.totals.savingsRate || 0)}`}
    style={{ flexGrow: 1, flexBasis: 0 }}
  />

  <KpiCard
    tone="success"
    title="INGRESOS"
    value={formatMoney(p.totals.income, p.currency)}
    bottomText={p.monthLabel}
    style={{ flexGrow: 1, flexBasis: 0 }}
  />

  <KpiCard
    tone="danger"
    title="GASTOS"
    value={formatMoney(p.totals.expense, p.currency)}
    bottomText={p.monthLabel}
    style={{ flexGrow: 1, flexBasis: 0 }}
  />
</View>



        </View>

        <View style={styles.dashStack}>
          <View style={styles.dashCard}>
            <View style={styles.dashTitleRow}>
              <Text style={styles.dashTitle}>Distribución del gasto</Text>
              <Text style={styles.dashMeta}>{expenseAll.length} categorías</Text>
            </View>

            {expenseTotal <= 0 ? (
              <Text style={{ color: palette.muted }}>No hay gasto en este periodo.</Text>
            ) : (
              <View style={styles.donutRow}>
                <DonutChart
                  values={slices}
                  size={120}
                  stroke={16}
                  totalLabel="Total gasto"
                  totalValueLabel={formatMoney(expenseTotal, p.currency)}
                />

<View style={styles.legend}>
  <View style={styles.legendHeader}>
    <Text style={styles.lhName}>Categoría</Text>
    <Text style={styles.lhPct}>%</Text>
    <Text style={styles.lhAmt}>Importe</Text>
  </View>

  {slices.slice(0, 5).map((s) => {
    const pct = expenseTotal > 0 ? s.value / expenseTotal : 0;
    return (
      <View key={s.label} style={styles.legendRow}>
        <View style={[styles.dot, { backgroundColor: s.color }]} />
        <Text style={styles.lrName}>{s.label}</Text>
        <Text style={styles.lrPct}>{fmtPct1(pct)}</Text>
        <Text style={styles.lrAmt}>{formatMoney(s.value, p.currency)}</Text>
      </View>
    );
  })}
</View>
              </View>
            )}
          </View>

          <View style={[styles.dashCard, styles.dashCardSpacing]}>
            <View style={styles.dashTitleRow}>
              <Text style={styles.dashTitle}>Gasto diario</Text>
              <Text style={styles.dashMeta}>
                {firstDay} – {lastDay}
              </Text>
            </View>

            <LineChart
              points={dailyPoints}
              width={520}
              height={140}
              tickLabels={{ left: firstDay, mid: midDay, right: lastDay }}
            />

            <View style={styles.lineFooter}>
              <Text style={styles.smallMuted}>Total: {formatMoney(dailySum, p.currency)}</Text>
              <Text style={styles.smallMuted}>Máx día: {formatMoney(dailyMax, p.currency)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Finexa · Reportes</Text>
          <Text>
            {p.monthKey} · {p.walletName ?? "Todas las carteras"}
          </Text>
        </View>
      </Page>

          {/* Page 2 */}
    <PageIncome p={p} />

    {/* Page 3 */}
    <PageExpense p={p} />

    <PageInvestments p={p} />

    </Document>
  );
}
