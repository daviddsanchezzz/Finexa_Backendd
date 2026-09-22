// spendly-backend/src/modules/investments/investment-currency-totals.ts
import { CurrencyService } from '../currency/currency.service';

export type ValueInCurrency = { value: number; currency: string };

// Suma valores de activos que pueden estar en distintas monedas, convirtiendo
// cada uno a `baseCurrency` con el tipo ACTUAL (no histórico: es un total
// consolidado en vivo, igual que el saldo de una Wallet). No mezcla esto con
// la rentabilidad de cada activo, que sigue calculándose en su propia moneda.
export async function sumInBaseCurrency(
  items: ValueInCurrency[],
  baseCurrency: string,
  currencyService: Pick<CurrencyService, 'getCurrentRate'>,
): Promise<number> {
  let total = 0;
  for (const item of items) {
    if (item.currency === baseCurrency) {
      total += item.value;
    } else {
      const rate = await currencyService.getCurrentRate(item.currency, baseCurrency);
      total += rate.toNumber() * item.value;
    }
  }
  return total;
}
