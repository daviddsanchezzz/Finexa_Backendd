export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatSignedMoney(amount: number, currency: string) {
  const abs = formatMoney(Math.abs(amount), currency);
  return amount >= 0 ? `+ ${abs}` : `- ${abs}`;
}
