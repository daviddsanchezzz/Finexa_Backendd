// spendly-backend/src/modules/currency/currency.constants.ts

export const EXCHANGE_RATE_PROVIDER = 'EXCHANGE_RATE_PROVIDER';

// Todas las conversiones pasan por EUR: nunca se guarda una fila cruzada
// (p.ej. CHF->USD) en ExchangeRate, se calcula en memoria vía este pivote.
export const PIVOT_CURRENCY = 'EUR';

// Monedas que no usan decimales (Intl.NumberFormat/redondeo). Añadir una
// moneda nueva sin decimales es una línea aquí.
export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);
