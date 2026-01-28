// src/pdf/templates/KpiCard.tsx
import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

type Tone = "neutral" | "info" | "success" | "danger";
type Variant = "default" | "premium";
type Size = "md" | "lg";

const palette = {
  ink: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  card: "#FFFFFF",
  primary: "#2563EB",
  good: "#16A34A",
  bad: "#DC2626",
  faint: "#94A3B8",
};

const ACCENT: Record<Tone, { bar: string; softBg: string }> = {
  neutral: { bar: "#0F172A", softBg: "rgba(15,23,42,0.06)" },
  info: { bar: palette.primary, softBg: "rgba(37,99,235,0.10)" },
  success: { bar: palette.good, softBg: "rgba(22,163,74,0.10)" },
  danger: { bar: palette.bad, softBg: "rgba(220,38,38,0.10)" },
};

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 12,
    position: "relative",
  },

  // Patrimonio: oscuro premium, sin “borde verde”
  cardPremium: {
    backgroundColor: "#0B1220",
  },

  // Accent bar (toque de color)
accentInline: {
  height: 3,
  borderRadius: 999,
  marginTop: 6,
  marginBottom: 8,
},

  title: { fontSize: 10, fontWeight: 700, color: palette.muted },
  titlePremium: { color: "rgba(226,232,240,0.85)" },

  value: { marginTop: 10, fontSize: 16, fontWeight: 800, color: palette.ink },
  valuePremium: { color: "#FFFFFF" },

  valueLg: { fontSize: 20, marginTop: 12 },

  bottom: { marginTop: 6, fontSize: 10, color: palette.muted },
  bottomPremium: { color: "rgba(226,232,240,0.80)" },
});

export function KpiCard({
  title,
  value,
  tone = "neutral",
  variant = "default",
  size = "md",
  bottomText,
  style,
}: {
  title: string;
  value: string;
  tone?: Tone;
  variant?: Variant;
  size?: Size;
  bottomText?: string;
  style?: Style;
}) {
  const isPremium = variant === "premium";
  const a = ACCENT[tone];

  const cardStyle = {
    ...styles.card,
    ...(isPremium ? styles.cardPremium : {}),
    ...(style as any),
  };

  const titleStyle = { ...styles.title, ...(isPremium ? styles.titlePremium : {}) };

  const valueStyle = {
    ...styles.value,
    ...(size === "lg" ? styles.valueLg : {}),
    ...(isPremium ? styles.valuePremium : {}),
  };

  const bottomStyle = { ...styles.bottom, ...(isPremium ? styles.bottomPremium : {}) };

  // Premium: el accent debe ser MUY sutil (sin borde verde)
  const accentColor = isPremium ? "rgba(255,255,255,0.14)" : a.bar;

  return (
    <View style={cardStyle}>
      {/* Accent bar */}

      <Text style={titleStyle}>{title}</Text>
    <View style={{ ...styles.accentInline, backgroundColor: accentColor }} />

      <Text style={valueStyle}>{value}</Text>

      {bottomText ? <Text style={bottomStyle}>{bottomText}</Text> : null}
    </View>
  );
}
