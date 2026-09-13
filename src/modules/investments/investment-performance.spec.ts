import {
  buildPortfolioPerformanceSeries,
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
});
