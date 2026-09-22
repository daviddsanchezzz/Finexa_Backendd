// spendly-backend/src/modules/investments/investment-currency-totals.ts
import { CurrencyService } from '../currency/currency.service';

export type ValueInCurrency = { value: number; currency: string };

// Suma valores de activos que pueden estar en distintas monedas, convirtiendo
// cada uno a `baseCurrency` con el tipo ACTUAL (no histórico: es un total
// consolidado en vivo, igual que el saldo de una Wallet). No mezcla esto con
// la rentabilidad de cada activo, que sigue calculándose en su propia moneda.
//
// Si un activo no se puede convertir (moneda inválida, provider caído, sin
// tipo de cambio cacheado), se suma su valor SIN convertir en vez de excluirlo
// o de propagar la excepción: perder de vista ese dinero del total sería peor
// que mostrarlo con una conversión pendiente, y una sola moneda problemática
// no debe poder romper el resumen de inversiones completo.
export async function sumInBaseCurrency(
  items: ValueInCurrency[],
  baseCurrency: string,
  currencyService: Pick<CurrencyService, 'getCurrentRate'>,
): Promise<number> {
  let total = 0;
  for (const item of items) {
    if (item.currency === baseCurrency) {
      total += item.value;
      continue;
    }
    try {
      const rate = await currencyService.getCurrentRate(item.currency, baseCurrency);
      total += rate.toNumber() * item.value;
    } catch {
      total += item.value;
    }
  }
  return total;
}
