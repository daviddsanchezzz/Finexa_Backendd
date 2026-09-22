// spendly-backend/src/modules/trips/trip-cost.ts
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';

// `cost` es Decimal en Prisma (TripPlanItem.cost); se acepta también number
// para que la función sea testeable sin instanciar Prisma.Decimal.
export type PlanItemCost = { cost: Prisma.Decimal | number | null; currency: string | null; day?: Date | null };

// Suma el coste de los plan items de un viaje, convirtiendo cada uno a
// `tripCurrency` cuando su propia currency difiere (tipo historico, fecha del
// item). Antes de esta funcion, trips.service.ts sumaba item.cost en crudo
// ignorando item.currency — bug latente ya presente si algun dia hay items en
// monedas distintas, corregido aqui de paso.
export async function sumPlanItemsCost(
  items: PlanItemCost[],
  tripCurrency: string,
  currencyService: Pick<CurrencyService, 'convert'>,
): Promise<number> {
  let total = 0;
  for (const item of items) {
    const cost = Number(item.cost ?? 0);
    if (!cost) continue;
    const itemCurrency = item.currency ?? tripCurrency;
    if (itemCurrency === tripCurrency) {
      total += cost;
    } else {
      const converted = await currencyService.convert(cost, itemCurrency, tripCurrency, item.day ?? undefined);
      total += converted.toNumber();
    }
  }
  return total;
}
