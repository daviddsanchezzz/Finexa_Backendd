import { parseEodhdEod, parseEodhdEodAll } from './eodhd-fund-price.service';

const row = (date: string, close: any) => ({ date, open: close, high: close, low: close, close, adjusted_close: close, volume: 0 });

describe('parseEodhdEod', () => {
  it('devuelve el NAV más reciente con su fecha', () => {
    const r = parseEodhdEod([row('2026-10-14', 14.6677), row('2026-10-13', 14.7165)], 'IE00BYX5NX33', 'EUR');
    expect(r.price).toBe(14.6677);
    expect(r.navDate.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });

  it('no depende del orden de las filas', () => {
    const r = parseEodhdEod([row('2026-10-13', 14.7165), row('2026-10-14', 14.6677)], 'IE00BYX5NX33', 'EUR');
    expect(r.navDate.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  it('ignora filas inválidas y usa la última válida', () => {
    const r = parseEodhdEod([row('2026-10-14', 0), row('2026-10-13', 'NA'), row('basura', 5), row('2026-10-12', 14.7388)], 'IE00BYX5NX33', 'EUR');
    expect(r.price).toBe(14.7388);
  });

  it.each([[[]], [null], [{ message: 'Unauthorized' }], ['Forbidden']])('falla con respuesta sin datos: %j', (body) => {
    expect(() => parseEodhdEod(body, 'IE00BYX5NX33', 'EUR')).toThrow(/EODHD/);
  });

  it('falla si ninguna fila es válida', () => {
    expect(() => parseEodhdEod([row('2026-10-14', 0), row('x', 1)], 'IE00BYX5NX33', 'EUR')).toThrow(/sin filas válidas/);
  });
});

describe('parseEodhdEodAll', () => {
  it('devuelve todas las filas válidas de más antigua a más reciente, sin repetir fechas', () => {
    const r = parseEodhdEodAll(
      [row('2026-10-15', 3), row('2026-10-13', 1), row('2026-10-14', 2), row('2026-10-14', 2.5), row('2026-10-12', 0), row('malo', 5)],
      'IE00BYX5NX33',
      'EUR',
    );
    expect(r.map((p) => [p.navDate.toISOString().slice(0, 10), p.price])).toEqual([
      ['2026-10-13', 1],
      ['2026-10-14', 2.5],
      ['2026-10-15', 3],
    ]);
  });

  it('lanza si no hay ninguna fila válida', () => {
    expect(() => parseEodhdEodAll([row('2026-10-14', 0)], 'X', 'EUR')).toThrow(/sin filas válidas/);
    expect(() => parseEodhdEodAll([], 'X', 'EUR')).toThrow(/sin datos/);
  });
});

describe('parseEodhdEodAll', () => {
  it('devuelve todas las filas válidas de más antigua a más reciente, sin repetir fechas', () => {
    const r = parseEodhdEodAll(
      [row('2026-10-15', 3), row('2026-10-13', 1), row('2026-10-14', 2), row('2026-10-14', 2.5), row('2026-10-12', 0), row('malo', 5)],
      'IE00BYX5NX33',
      'EUR',
    );
    expect(r.map((p) => [p.navDate.toISOString().slice(0, 10), p.price])).toEqual([
      ['2026-10-13', 1],
      ['2026-10-14', 2.5],
      ['2026-10-15', 3],
    ]);
  });

  it('lanza si no hay ninguna fila válida', () => {
    expect(() => parseEodhdEodAll([row('2026-10-14', 0)], 'X', 'EUR')).toThrow(/sin filas válidas/);
    expect(() => parseEodhdEodAll([], 'X', 'EUR')).toThrow(/sin datos/);
  });
});
