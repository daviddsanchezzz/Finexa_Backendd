// spendly-backend/src/modules/trips/trip-cost.ts
import { Prisma } from '@prisma/client';
import { CurrencyService } from '../currency/currency.service';

// `cost` es Decimal en Prisma (TripPlanItem.cost); se acepta también number
// para que la función sea testeable sin instanciar Prisma.Decimal.
export type PlanItemCost = {
  cost: Prisma.Decimal | number | null;
  currency: string | null;
  day?: Date | null;
};

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
// Convierte el coste de un viaje (ya en Trip.currency) a la moneda base del
// usuario, con el tipo ACTUAL — es un total "en vivo" (como el saldo de una
// Wallet), no un histórico. Lo usa el agregado de "gastado en todos los
// viajes" (varios viajes de monedas distintas no se pueden sumar en crudo).
// Si no se puede convertir, devuelve el coste sin convertir en vez de
// propagar la excepción: un viaje problemático no debe poder romper la
// lista completa de viajes.
export async function tripCostInBase(
  cost: number,
  tripCurrency: string,
  baseCurrency: string,
  currencyService: Pick<CurrencyService, 'getCurrentRate'>,
): Promise<number> {
  if (tripCurrency === baseCurrency) return cost;
  try {
    const rate = await currencyService.getCurrentRate(tripCurrency, baseCurrency);
    return rate.toNumber() * cost;
  } catch {
    return cost;
  }
}

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
      const converted = await currencyService.convert(
        cost,
        itemCurrency,
        tripCurrency,
        item.day ?? undefined,
      );
      total += converted.toNumber();
    } catch {
      // Omitido a propósito: ver comentario de la función.
    }
  }
  return total;
}
