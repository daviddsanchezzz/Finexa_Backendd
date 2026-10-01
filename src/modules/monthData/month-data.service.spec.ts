import { monthRangeLocal } from './month-data.service';

// Regresión real: una nómina programada para la 1 de la madrugada (hora de
// Madrid) del día 1 de octubre quedó contabilizada como ingreso de
// SEPTIEMBRE, porque el cierre mensual usaba límites en UTC puro — 1:00
// Madrid (CEST, UTC+2) es todavía 23:00 UTC del día anterior.
describe('monthRangeLocal', () => {
  it('el rango de octubre 2026 (CEST, UTC+2) empieza en Madrid, no en UTC', () => {
    const { start, end } = monthRangeLocal(new Date(Date.UTC(2026, 9, 1)));

    // 1 de octubre 00:00 en Madrid = 30 de septiembre 22:00 UTC.
    expect(start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    // 1 de noviembre 00:00 en Madrid = 31 de octubre 23:00 UTC (CET ya para entonces).
    expect(end.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('una nómina a la 1:00 de Madrid el día 1 de octubre cae DENTRO del rango de octubre', () => {
    const { start, end } = monthRangeLocal(new Date(Date.UTC(2026, 9, 1)));
    // 1:00 Madrid (CEST) del 1 de octubre = 23:00 UTC del 30 de septiembre.
    const salaryInstant = new Date('2026-09-30T23:00:00.000Z');

    expect(salaryInstant.getTime() >= start.getTime()).toBe(true);
    expect(salaryInstant.getTime() < end.getTime()).toBe(true);
  });

  it('esa misma nómina quedaría FUERA del rango de septiembre (no se cuenta dos veces)', () => {
    const { start, end } = monthRangeLocal(new Date(Date.UTC(2026, 8, 1)));
    const salaryInstant = new Date('2026-09-30T23:00:00.000Z');

    expect(salaryInstant.getTime() < start.getTime() || salaryInstant.getTime() >= end.getTime()).toBe(true);
  });

  it('el rango de enero (CET, UTC+1) empieza en Madrid, no en UTC', () => {
    const { start, end } = monthRangeLocal(new Date(Date.UTC(2027, 0, 1)));

    expect(start.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-31T23:00:00.000Z');
  });
});
