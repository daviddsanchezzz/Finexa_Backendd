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
//
// Si CurrencyService no puede convertir un item concreto (moneda invalida,
// provider caido, sin tipo de cambio cacheado — nunca se inventa uno), ese
// item se omite del total en vez de propagar la excepcion: antes de esta
// funcion, sumar el coste de un viaje era sincrono y nunca fallaba, así que
// dejar que un solo item con datos corruptos tumbe TODO GET /trips para el
// usuario sería una regresión de disponibilidad, no una mejora.
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
      continue;
    }
    try {
      const converted = await currencyService.convert(cost, itemCurrency, tripCurrency, item.day ?? undefined);
      total += converted.toNumber();
    } catch {
      // Omitido a propósito: ver comentario de la función.
    }
  }
  return total;
}
