import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatMoney, formatSignedMoney } from "./pdf.utils";

export type YearlyParams = {
  yearLabel: string;
  totals: { income: number; expense: number; savings: number; savingsRate: number };
  topCategories: { name: string; amount: number }[];
  trends: { incomeDelta: number; expenseDelta: number; savingsDelta: number };
  monthly: { month: string; income: number; expense: number; savings: number }[];
  currency: string;
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 18, marginBottom: 14, fontWeight: 700 },
  sub: { color: "#555", marginBottom: 16 },

  section: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8 },

  grid: { flexDirection: "row", gap: 10 },
  card: { flexGrow: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10 },
  cardLabel: { color: "#6B7280", marginBottom: 4 },
  cardValue: { fontSize: 12, fontWeight: 700 },
  badge: { fontSize: 10, color: "#6B7280" },

  tableHeader: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  th: { fontWeight: 700, color: "#374151" },
  tr: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  cellMonth: { width: "22%" },
  cell: { width: "26%", textAlign: "right" },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },

  footer: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 9, color: "#9CA3AF" },
});

 function fmtPct1(p: number) {
  // p es ratio: 0.0412 => 4.1%
  const v = Math.round(p * 1000) / 10; // 1 decimal
  // usa coma decimal ES
  const s = v.toFixed(1).replace(".", ",");
  return `${s}%`;
}

function monthLabelEs(monthKey: string) {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  const label = new Intl.DateTimeFormat("es-ES", { month: "short" }).format(d);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function YearlyReportPdf({ p }: { p: YearlyParams }) {
  const { yearLabel, totals, topCategories, trends, monthly, currency } = p;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Informe anual · {yearLabel}</Text>
        <Text style={styles.sub}>Resumen anual y evolución mensual.</Text>

        {/* Totales */}
        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Ingresos</Text>
            <Text style={styles.cardValue}>{formatMoney(totals.income, currency)}</Text>
            <Text style={styles.badge}>Δ vs año anterior: {formatSignedMoney(trends.incomeDelta, currency)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Gastos</Text>
            <Text style={styles.cardValue}>{formatMoney(totals.expense, currency)}</Text>
            <Text style={styles.badge}>Δ vs año anterior: {formatSignedMoney(trends.expenseDelta, currency)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Ahorro</Text>
            <Text style={styles.cardValue}>{formatMoney(totals.savings, currency)}</Text>
            <Text style={styles.badge}>Tasa de ahorro: {fmtPct1(totals.savingsRate)}</Text>
            <Text style={styles.badge}>Δ vs año anterior: {formatSignedMoney(trends.savingsDelta, currency)}</Text>
          </View>
        </View>

        {/* Serie mensual */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Evolución mensual</Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.cellMonth, styles.th]}>Mes</Text>
            <Text style={[styles.cell, styles.th]}>Ingresos</Text>
            <Text style={[styles.cell, styles.th]}>Gastos</Text>
            <Text style={[styles.cell, styles.th]}>Ahorro</Text>
          </View>

          {monthly.map((m) => (
            <View key={m.month} style={styles.tr}>
              <Text style={styles.cellMonth}>{monthLabelEs(m.month)}</Text>
              <Text style={styles.cell}>{formatMoney(m.income, currency)}</Text>
              <Text style={styles.cell}>{formatMoney(m.expense, currency)}</Text>
              <Text style={styles.cell}>{formatMoney(m.savings, currency)}</Text>
            </View>
          ))}
        </View>

        {/* Top categorías */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top categorías (gasto)</Text>

          {topCategories.length === 0 ? (
            <Text style={{ color: "#6B7280" }}>No hay gastos con categoría en este año.</Text>
          ) : (
            <View>
              {topCategories.map((c, idx) => (
                <View key={`${c.name}-${idx}`} style={styles.row}>
                  <Text>{idx + 1}. {c.name}</Text>
                  <Text style={{ fontWeight: 700 }}>{formatMoney(c.amount, currency)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Generado automáticamente. (Los informes excluyen transferencias y elementos marcados como excludeFromStats).
        </Text>
      </Page>
    </Document>
  );
}
