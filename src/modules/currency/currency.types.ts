// spendly-backend/src/modules/currency/currency.types.ts

// Contrato que debe cumplir cualquier fuente de tipos de cambio. CurrencyService
// solo conoce esta interfaz — cambiar de proveedor es cambiar el `provide` en
// CurrencyModule, nunca tocar CurrencyService ni sus consumidores.
export interface ExchangeRateProvider {
  // Tipos actuales: 1 `base` = X `quote`, para cada moneda en `quotes`.
  getLatestRates(base: string, quotes: string[]): Promise<Record<string, number>>;

  // Tipo para una fecha concreta. `null` si el proveedor no tiene dato (caído,
  // fecha fuera de su cobertura) — nunca lanza para "no hay dato", solo para
  // errores de transporte inesperados que el llamador deba loguear.
  getHistoricalRate(base: string, quote: string, date: Date): Promise<number | null>;
}
