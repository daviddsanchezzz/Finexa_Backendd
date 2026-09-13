export type InvestmentOperationKind =
  | 'transfer_in'
  | 'transfer_out'
  | 'buy'
  | 'sell'
  | 'swap_in'
  | 'swap_out';

export type PerformanceAsset = {
  id: number;
  createdAt: Date;
  initialInvested: number;
};

export type PerformanceOperation = {
  id: number;
  assetId: number;
  type: InvestmentOperationKind | string;
  date: Date;
  amount: number;
  fee?: number | null;
};

export type PerformanceValuation = {
  id: number;
  assetId: number;
  date: Date;
  value: number;
};

export type PortfolioPerformancePoint = {
  date: string;
  equity: number;
  totalCurrentValue: number;
  externalFlow: number;
  netContributions: number;
  result: number;
  dailyReturn: number | null;
  twr: number;
};

export const EXTERNAL_IN_OPERATION_TYPES = new Set<InvestmentOperationKind>(['buy', 'transfer_in']);

export const EXTERNAL_OUT_OPERATION_TYPES = new Set<InvestmentOperationKind>([
  'sell',
  'transfer_out',
]);

export function externalFlowForOperation(operation: PerformanceOperation): number {
  const amount = Math.abs(Number(operation.amount || 0));
  const fee = Math.abs(Number(operation.fee || 0));
  const type = operation.type as InvestmentOperationKind;

  // Las compras/aportaciones consumen principal + comisión de la wallet de
  // efectivo. La comisión no entra en cartera y, por tanto, queda reflejada
  // como coste de rendimiento. Las ventas/retiradas almacenan el neto recibido.
  if (EXTERNAL_IN_OPERATION_TYPES.has(type)) return amount + fee;
  if (EXTERNAL_OUT_OPERATION_TYPES.has(type)) return -amount;
  return 0;
}

export function bookValueDeltaForOperation(operation: PerformanceOperation): number {
  const amount = Math.abs(Number(operation.amount || 0));
  const fee = Math.abs(Number(operation.fee || 0));

  switch (operation.type as InvestmentOperationKind) {
    case 'buy':
    case 'transfer_in':
    case 'swap_in':
      return amount;
    case 'sell':
    case 'transfer_out':
    case 'swap_out':
      // sell/transfer_out guardan el importe neto; en swap la comisión vive
      // en la pata de salida. En ambos casos la cartera soporta ese coste.
      return -(amount + fee);
    default:
      return 0;
  }
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function toUtcDayKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

type TimelineEvent =
  | { kind: 'initial'; assetId: number; date: Date; id: number; amount: number }
  | { kind: 'operation'; assetId: number; date: Date; id: number; operation: PerformanceOperation }
  | { kind: 'valuation'; assetId: number; date: Date; id: number; value: number };

const eventPriority = (event: TimelineEvent) =>
  event.kind === 'initial' ? 0 : event.kind === 'operation' ? 1 : 2;

export function buildPortfolioPerformanceSeries(input: {
  assets: PerformanceAsset[];
  operations: PerformanceOperation[];
  valuations: PerformanceValuation[];
  asOf: Date;
}): { points: PortfolioPerformancePoint[]; assetValues: Map<number, number> } {
  const asOf = new Date(input.asOf);
  const assetIds = new Set(input.assets.map((asset) => asset.id));
  const events: TimelineEvent[] = [];

  input.assets.forEach((asset) => {
    const initial = Number(asset.initialInvested || 0);
    if (initial && asset.createdAt <= asOf) {
      events.push({
        kind: 'initial',
        assetId: asset.id,
        date: asset.createdAt,
        id: -asset.id,
        amount: initial,
      });
    }
  });

  input.operations.forEach((operation) => {
    if (assetIds.has(operation.assetId) && operation.date <= asOf) {
      events.push({
        kind: 'operation',
        assetId: operation.assetId,
        date: operation.date,
        id: operation.id,
        operation,
      });
    }
  });

  input.valuations.forEach((valuation) => {
    if (assetIds.has(valuation.assetId) && valuation.date <= asOf) {
      events.push({
        kind: 'valuation',
        assetId: valuation.assetId,
        date: valuation.date,
        id: valuation.id,
        value: Number(valuation.value || 0),
      });
    }
  });

  events.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || eventPriority(a) - eventPriority(b) || a.id - b.id,
  );

  const eventsByDay = new Map<string, TimelineEvent[]>();
  events.forEach((event) => {
    const key = toUtcDayKey(event.date);
    const dayEvents = eventsByDay.get(key) ?? [];
    dayEvents.push(event);
    eventsByDay.set(key, dayEvents);
  });
  eventsByDay.forEach((dayEvents) => {
    // Las valoraciones del modelo son cierres consolidados del día aunque su
    // timestamp esté normalizado a 00:00. Por eso sustituyen el book value
    // después de aplicar las operaciones de esa fecha; de otro modo una compra
    // ya contenida en el cierre se sumaría dos veces.
    dayEvents.sort(
      (a, b) =>
        eventPriority(a) - eventPriority(b) || a.date.getTime() - b.date.getTime() || a.id - b.id,
    );
  });

  const firstEventDate = events[0]?.date ?? asOf;
  const firstDay = addUtcDays(startOfUtcDay(firstEventDate), -1);
  const lastDay = startOfUtcDay(asOf);
  const assetValues = new Map<number, number>(input.assets.map((asset) => [asset.id, 0]));
  const points: PortfolioPerformancePoint[] = [];
  let netContributions = 0;
  let growthFactor = 1;
  let previousEquity = 0;

  for (let cursor = firstDay; cursor <= lastDay; cursor = addUtcDays(cursor, 1)) {
    const date = toUtcDayKey(cursor);
    let externalFlow = 0;

    for (const event of eventsByDay.get(date) ?? []) {
      if (event.kind === 'initial') {
        assetValues.set(event.assetId, (assetValues.get(event.assetId) ?? 0) + event.amount);
        externalFlow += event.amount;
      } else if (event.kind === 'operation') {
        assetValues.set(
          event.assetId,
          (assetValues.get(event.assetId) ?? 0) + bookValueDeltaForOperation(event.operation),
        );
        externalFlow += externalFlowForOperation(event.operation);
      } else {
        // Orden date + id: si hay varias valoraciones el mismo día gana la
        // última cronológicamente y, a igualdad de timestamp, la de mayor id.
        assetValues.set(event.assetId, event.value);
      }
    }

    const equity = [...assetValues.values()].reduce((sum, value) => sum + value, 0);
    netContributions += externalFlow;

    let dailyReturn: number | null = null;
    if (previousEquity > 1e-9) {
      dailyReturn = (equity - externalFlow) / previousEquity - 1;
    } else if (externalFlow > 1e-9) {
      // Inicio de cartera: el flujo del día es la base. Esto mantiene neutra
      // una aportación pura y permite que una comisión aparezca como coste.
      dailyReturn = equity / externalFlow - 1;
    }

    if (dailyReturn != null && Number.isFinite(dailyReturn)) growthFactor *= 1 + dailyReturn;

    points.push({
      date,
      equity,
      totalCurrentValue: equity,
      externalFlow,
      netContributions,
      result: equity - netContributions,
      dailyReturn,
      twr: growthFactor - 1,
    });
    previousEquity = equity;
  }

  return { points, assetValues };
}

export function calculatePeriodPerformance(
  points: PortfolioPerformancePoint[],
  from: Date,
  toExclusive: Date,
) {
  const fromKey = toUtcDayKey(from);
  const toKey = toUtcDayKey(toExclusive);
  const before = points.filter((point) => point.date < fromKey).at(-1);
  const periodPoints = points.filter((point) => point.date >= fromKey && point.date < toKey);
  const last = periodPoints.at(-1) ?? before;
  const startValue = before?.equity ?? 0;
  const endValue = last?.equity ?? startValue;
  const cashflowNet = periodPoints.reduce((sum, point) => sum + point.externalFlow, 0);
  const profit = endValue - startValue - cashflowNet;
  let growthFactor = 1;
  let hasReturn = false;

  periodPoints.forEach((point) => {
    if (point.dailyReturn != null && Number.isFinite(point.dailyReturn)) {
      growthFactor *= 1 + point.dailyReturn;
      hasReturn = true;
    }
  });

  return {
    startValue,
    endValue,
    cashflowNet,
    profit,
    returnPct: hasReturn ? growthFactor - 1 : null,
  };
}
