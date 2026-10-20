import {
  buildPortfolioPerformanceSeries,
  calculateAssetPeriodReturns,
  calculatePeriodPerformance,
  externalFlowForOperation,
  type PerformanceAsset,
  type PerformanceOperation,
  type PerformanceValuation,
} from './investment-performance';

const d = (iso: string) => new Date(iso);
const asset = (
  id = 1,
  initialInvested = 0,
  createdAt = '2025-01-01T00:00:00.000Z',
): PerformanceAsset => ({
  id,
  initialInvested,
  createdAt: d(createdAt),
});
const operation = (
  id: number,
  type: PerformanceOperation['type'],
  date: string,
  amount: number,
  assetId = 1,
  fee = 0,
): PerformanceOperation => ({ id, type, date: d(date), amount, assetId, fee });
const valuation = (id: number, date: string, value: number, assetId = 1): PerformanceValuation => ({
  id,
  date: d(date),
  value,
  assetId,
});
const series = (
  assets: PerformanceAsset[],
  operations: PerformanceOperation[],
  valuations: PerformanceValuation[],
  asOf = '2025-01-10T23:59:59.999Z',
) => buildPortfolioPerformanceSeries({ assets, operations, valuations, asOf: d(asOf) });

describe('investment performance', () => {
  test('A) cartera sin aportaciones intermedias', () => {
    const { points } = series(
      [asset(1, 100)],
      [],
      [
        valuation(1, '2025-01-01T18:00:00.000Z', 100),
        valuation(2, '2025-01-10T18:00:00.000Z', 110),
      ],
    );
    expect(points.at(-1)?.result).toBeCloseTo(10);
    expect(points.at(-1)?.twr).toBeCloseTo(0.1);
  });

  test('B) aportación al inicio', () => {
    const { points } = series(
      [asset()],
      [operation(1, 'buy', '2025-01-01T09:00:00.000Z', 100)],
      [
        valuation(1, '2025-01-01T18:00:00.000Z', 100),
        valuation(2, '2025-01-10T18:00:00.000Z', 110),
      ],
    );
    expect(points.at(-1)?.netContributions).toBe(100);
    expect(points.at(-1)?.twr).toBeCloseTo(0.1);
  });

  test('C) una aportación grande a mitad del periodo no crea rentabilidad', () => {
    const { points } = series(
      [asset(1, 500)],
      [operation(1, 'buy', '2025-01-05T09:00:00.000Z', 9000)],
      [
        valuation(1, '2025-01-01T18:00:00.000Z', 500),
        valuation(2, '2025-01-10T18:00:00.000Z', 9500),
      ],
    );
    expect(points.at(-1)?.result).toBeCloseTo(0);
    expect(points.at(-1)?.twr).toBeCloseTo(0);
  });

  test('D) múltiples aportaciones mantienen separado capital y resultado', () => {
    const { points } = series(
      [asset(1, 100)],
      [
        operation(1, 'buy', '2025-01-03T09:00:00.000Z', 50),
        operation(2, 'transfer_in', '2025-01-06T09:00:00.000Z', 25),
      ],
      [valuation(1, '2025-01-10T18:00:00.000Z', 175)],
    );
    expect(points.at(-1)?.netContributions).toBe(175);
    expect(points.at(-1)?.result).toBeCloseTo(0);
    expect(points.at(-1)?.twr).toBeCloseTo(0);
  });

  test('E) una retirada usa signo negativo y no crea una pérdida', () => {
    const { points } = series(
      [asset(1, 100)],
      [operation(1, 'sell', '2025-01-05T09:00:00.000Z', 40)],
      [valuation(1, '2025-01-01T18:00:00.000Z', 100)],
    );
    expect(points.at(-1)?.netContributions).toBe(60);
    expect(points.at(-1)?.equity).toBe(60);
    expect(points.at(-1)?.twr).toBeCloseTo(0);
  });

  test('F) un swap interno no altera flujos externos ni rentabilidad', () => {
    const { points } = series(
      [asset(1, 100), asset(2, 0)],
      [
        operation(1, 'swap_out', '2025-01-05T09:00:00.000Z', 50, 1),
        operation(2, 'swap_in', '2025-01-05T09:00:00.000Z', 50, 2),
      ],
      [],
    );
    expect(points.at(-1)?.netContributions).toBe(100);
    expect(points.at(-1)?.equity).toBe(100);
    expect(points.at(-1)?.twr).toBeCloseTo(0);
    expect(externalFlowForOperation(operation(3, 'swap_in', '2025-01-05T10:00:00.000Z', 500))).toBe(
      0,
    );
  });

  test('G) ignora valoraciones futuras para el valor actual', () => {
    const { points } = series(
      [asset(1, 100)],
      [],
      [
        valuation(1, '2025-01-05T18:00:00.000Z', 110),
        valuation(2, '2025-02-01T18:00:00.000Z', 999),
      ],
    );
    expect(points.at(-1)?.equity).toBe(110);
  });

  test('H) ante dos valoraciones diarias usa la última por timestamp e id', () => {
    const { points } = series(
      [asset(1, 100)],
      [],
      [
        valuation(1, '2025-01-05T10:00:00.000Z', 105),
        valuation(2, '2025-01-05T18:00:00.000Z', 108),
        valuation(3, '2025-01-05T18:00:00.000Z', 109),
      ],
    );
    expect(points.find((point) => point.date === '2025-01-05')?.equity).toBe(109);
  });

  test('I) periodo sin operaciones conserva el retorno de mercado', () => {
    const { points } = series(
      [asset(1, 100)],
      [],
      [
        valuation(1, '2025-01-01T18:00:00.000Z', 100),
        valuation(2, '2025-01-10T18:00:00.000Z', 105),
      ],
    );
    const metrics = calculatePeriodPerformance(points, d('2025-01-01'), d('2025-01-11'));
    expect(metrics.cashflowNet).toBe(100);
    expect(metrics.profit).toBe(5);
    expect(metrics.returnPct).toBeCloseTo(0.05);
  });

  test('J) TODO conserva más de 365 días de histórico', () => {
    const { points } = series(
      [asset(1, 100, '2023-01-01T00:00:00.000Z')],
      [],
      [valuation(1, '2024-12-31T18:00:00.000Z', 120)],
      '2025-01-01T23:59:59.999Z',
    );
    expect(points.length).toBeGreaterThan(365);
    expect(points[0].date).toBe('2022-12-31');
    expect(points.at(-1)?.date).toBe('2025-01-01');
  });

  test('las comisiones de compra cuentan como capital desembolsado y coste', () => {
    const { points } = series(
      [asset()],
      [operation(1, 'buy', '2025-01-01T09:00:00.000Z', 100, 1, 2)],
      [valuation(1, '2025-01-01T18:00:00.000Z', 100)],
    );
    expect(points.at(-1)?.netContributions).toBe(102);
    expect(points.at(-1)?.result).toBe(-2);
    expect(points.at(-1)?.twr).toBeCloseTo(100 / 102 - 1);
  });

  test('K) la rentabilidad del periodo se basa en el coste aportado, no en el valor de mercado al inicio', () => {
    const { points } = series(
      [asset(1, 100, '2025-01-01T00:00:00.000Z')],
      [],
      [
        valuation(1, '2025-01-01T18:00:00.000Z', 100),
        valuation(2, '2025-01-04T18:00:00.000Z', 90), // pérdida no realizada antes del periodo
        valuation(3, '2025-01-10T18:00:00.000Z', 99), // recupera durante el periodo
      ],
    );
    const metrics = calculatePeriodPerformance(points, d('2025-01-05'), d('2025-01-11'));
    expect(metrics.costBasisAtStart).toBe(100);
    expect(metrics.startValue).toBe(90);
    expect(metrics.profit).toBeCloseTo(9);
    // profit / coste aportado (100), no profit / valor de mercado al inicio (90):
    // 9/100 = 9 %, no 9/90 = 10 %. Así coincide con el criterio de "rentabilidad
    // total" de la cartera (PnL / dinero neto aportado).
    expect(metrics.returnPct).toBeCloseTo(0.09);
  });

  test('una valoración diaria consolidada sustituye operaciones del mismo día sin duplicarlas', () => {
    const { points } = series(
      [asset()],
      [operation(1, 'buy', '2025-01-05T09:00:00.000Z', 100)],
      [valuation(1, '2025-01-05T00:00:00.000Z', 100)],
    );
    const close = points.find((point) => point.date === '2025-01-05');
    expect(close?.equity).toBe(100);
    expect(close?.netContributions).toBe(100);
    expect(close?.twr).toBeCloseTo(0);
  });

  // Regresión real: un activo se dio de alta en la app el 23/09 con
  // initialInvested=12000, pero se le importó por Excel un histórico de
  // valoraciones desde diciembre del año anterior. El capital inicial se
  // imputaba en createdAt (23/09), inflando el cashflow y hundiendo el
  // profit de ESE mes aunque no hubiera ningún movimiento real en septiembre.
  test('el capital inicial se imputa en la fecha del dato más antiguo, no en createdAt, si hay histórico importado previo', () => {
    const { points } = series(
      [asset(1, 12000, '2025-09-23T00:00:00.000Z')],
      [],
      [
        valuation(1, '2024-12-31T00:00:00.000Z', 13043.66),
        valuation(2, '2025-09-22T00:00:00.000Z', 13783.46),
        valuation(3, '2025-09-23T00:00:00.000Z', 13916.44),
        valuation(4, '2025-09-30T00:00:00.000Z', 13746.01),
      ],
      '2025-09-30T23:59:59.999Z',
    );

    // Sin movimiento real en septiembre: el cashflow del mes debe ser 0, no 12000.
    // startValue arrastra el valor de diciembre (sin valoración entre medias).
    const metrics = calculatePeriodPerformance(points, d('2025-09-01'), d('2025-10-01'));
    expect(metrics.cashflowNet).toBe(0);
    expect(metrics.startValue).toBe(13043.66);
    expect(metrics.endValue).toBe(13746.01);
    expect(metrics.profit).toBeCloseTo(13746.01 - 13043.66);

    // El capital inicial sigue contando en el coste acumulado (desde diciembre).
    const decemberPoint = points.find((p) => p.date === '2024-12-31');
    expect(decemberPoint?.netContributions).toBe(12000);
  });

  test('sin histórico previo a createdAt, el capital inicial se sigue imputando en createdAt (comportamiento normal)', () => {
    const { points } = series(
      [asset(1, 500, '2025-01-05T00:00:00.000Z')],
      [],
      [valuation(1, '2025-01-05T00:00:00.000Z', 500)],
      '2025-01-10T23:59:59.999Z',
    );
    const point = points.find((p) => p.date === '2025-01-05');
    expect(point?.netContributions).toBe(500);
    expect(point?.externalFlow).toBe(500);
  });
});

describe('calculateAssetPeriodReturns', () => {
  const ASOF = '2026-10-20T10:00:00.000Z';

  it('mes y año en curso descuentan las aportaciones del periodo', () => {
    const r = calculateAssetPeriodReturns({
      assets: [asset(1, 1000, '2025-12-01T00:00:00.000Z')],
      operations: [operation(1, 'buy', '2026-10-05T00:00:00.000Z', 200)],
      valuations: [
        valuation(1, '2025-12-31T00:00:00.000Z', 1100),
        valuation(2, '2026-09-30T00:00:00.000Z', 1500),
        valuation(3, '2026-10-10T00:00:00.000Z', 1760),
      ],
      asOf: d(ASOF),
    }).get(1)!;
    // Octubre: 1760 - 1500 - 200 de aportación = 60 sobre (1000 + 200) aportados.
    expect(r.month.profit).toBeCloseTo(60, 6);
    expect(r.month.returnPct).toBeCloseTo(60 / 1200, 6);
    // Año: 1760 - 1100 - 200 = 460 sobre 1200.
    expect(r.ytd.profit).toBeCloseTo(460, 6);
    expect(r.ytd.returnPct).toBeCloseTo(460 / 1200, 6);
  });

  it('un activo sin movimientos este mes da 0 %, no un hueco', () => {
    const r = calculateAssetPeriodReturns({
      assets: [asset(1, 1000, '2026-01-01T00:00:00.000Z')],
      operations: [],
      valuations: [valuation(1, '2026-09-30T00:00:00.000Z', 1200)],
      asOf: d(ASOF),
    }).get(1)!;
    expect(r.month.profit).toBe(0);
    expect(r.month.returnPct).toBe(0);
  });

  it('sin datos ni aportaciones la rentabilidad es null (se muestra "—")', () => {
    const r = calculateAssetPeriodReturns({ assets: [asset(1, 0)], operations: [], valuations: [], asOf: d(ASOF) }).get(1)!;
    expect(r.month.returnPct).toBeNull();
    expect(r.ytd.returnPct).toBeNull();
  });

  it('cada activo se calcula por separado', () => {
    const r = calculateAssetPeriodReturns({
      assets: [asset(1, 1000, '2026-01-01T00:00:00.000Z'), asset(2, 500, '2026-01-01T00:00:00.000Z')],
      operations: [operation(1, 'buy', '2026-10-05T00:00:00.000Z', 1000, 1)],
      valuations: [
        valuation(1, '2026-09-30T00:00:00.000Z', 1000, 1),
        valuation(2, '2026-10-15T00:00:00.000Z', 2100, 1),
        valuation(3, '2026-09-30T00:00:00.000Z', 500, 2),
        valuation(4, '2026-10-15T00:00:00.000Z', 550, 2),
      ],
      asOf: d(ASOF),
    });
    expect(r.get(1)!.month.profit).toBeCloseTo(100, 6); // 2100 - 1000 - 1000
    expect(r.get(2)!.month.profit).toBeCloseTo(50, 6);
    expect(r.get(2)!.month.returnPct).toBeCloseTo(0.1, 6); // 50 / 500
  });
});

describe('calculateAssetPeriodReturns · día', () => {
  const base = { assets: [asset(1, 1000, '2026-01-01T00:00:00.000Z')], operations: [] as PerformanceOperation[] };

  it('variación entre la última valoración (ayer) y la anterior', () => {
    const r = calculateAssetPeriodReturns({
      ...base,
      valuations: [valuation(1, '2026-10-14T00:00:00.000Z', 1200), valuation(2, '2026-10-15T00:00:00.000Z', 1212)],
      asOf: d('2026-10-16T09:00:00.000Z'),
    }).get(1)!;
    expect(r.day).not.toBeNull();
    expect(r.day!.profit).toBeCloseTo(12, 6);
    expect(r.day!.returnPct).toBeCloseTo(12 / 1000, 6); // sobre el coste aportado, como mes y año
  });

  it('también vale si la última valoración es de hoy', () => {
    const r = calculateAssetPeriodReturns({
      ...base,
      valuations: [valuation(1, '2026-10-15T00:00:00.000Z', 1200), valuation(2, '2026-10-16T00:00:00.000Z', 1188)],
      asOf: d('2026-10-16T09:00:00.000Z'),
    }).get(1)!;
    expect(r.day!.profit).toBeCloseTo(-12, 6);
  });

  it('null si la última valoración tiene dos días o más', () => {
    const r = calculateAssetPeriodReturns({
      ...base,
      valuations: [valuation(1, '2026-10-13T00:00:00.000Z', 1200), valuation(2, '2026-10-14T00:00:00.000Z', 1212)],
      asOf: d('2026-10-16T09:00:00.000Z'),
    }).get(1)!;
    expect(r.day).toBeNull();
  });

  it('null si no hay cierre previo con el que comparar', () => {
    const r = calculateAssetPeriodReturns({
      assets: [asset(1, 0, '2026-10-15T00:00:00.000Z')],
      operations: [],
      valuations: [valuation(1, '2026-10-15T12:00:00.000Z', 500)],
      asOf: d('2026-10-16T09:00:00.000Z'),
    }).get(1)!;
    expect(r.day).toBeNull();
  });

  it('una aportación del propio día no cuenta como ganancia', () => {
    const r = calculateAssetPeriodReturns({
      ...base,
      operations: [operation(1, 'buy', '2026-10-15T08:00:00.000Z', 200)],
      valuations: [valuation(1, '2026-10-14T00:00:00.000Z', 1200), valuation(2, '2026-10-15T00:00:00.000Z', 1412)],
      asOf: d('2026-10-16T09:00:00.000Z'),
    }).get(1)!;
    expect(r.day!.profit).toBeCloseTo(12, 6); // 1412 - 1200 - 200
  });

  it('sin valoraciones no hay dato del día', () => {
    const r = calculateAssetPeriodReturns({ ...base, valuations: [], asOf: d('2026-10-16T09:00:00.000Z') }).get(1)!;
    expect(r.day).toBeNull();
  });
});
