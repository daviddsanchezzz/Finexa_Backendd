import { buildSystemPrompt, DRAFT_JSON_SCHEMA, localDateTime, sanitizeDraft } from './booking-draft';

const base = {
  kind: 'flight', confidence: 0.95, title: 'LCG → BCN',
  flight: { airlineName: 'Vueling', flightNumber: 'vy 1291', fromIata: 'lcg', toIata: 'BCN', fromCity: 'A Coruña', toCity: 'Barcelona', depAt: '2026-09-30T23:50', arrAt: '2026-10-01T01:30', bookingRef: 'HMD3JD', seat: null, gate: null },
  transport: {}, accommodation: {}, activity: {}, cost: null, currency: 'EUR', notes: null, warnings: [],
};

describe('sanitizeDraft', () => {
  it('normaliza un vuelo (IATA en mayúsculas, nº de vuelo sin espacios)', () => {
    const d = sanitizeDraft(base);
    expect(d.kind).toBe('flight');
    expect(d.flight).toMatchObject({ fromIata: 'LCG', toIata: 'BCN', flightNumber: 'VY1291', bookingRef: 'HMD3JD', depAt: '2026-09-30T23:50', arrAt: '2026-10-01T01:30' });
    expect(d.currency).toBeNull(); // sin importe no hay moneda
    expect(d.warnings).toEqual([]);
  });

  it('descarta datos inválidos en vez de fiarse del modelo', () => {
    const d = sanitizeDraft({ ...base, flight: { ...base.flight, fromIata: 'LCGX', flightNumber: 'x', depAt: '2026-13-40T99:99', arrAt: 'mañana' }, cost: -5 });
    expect(d.flight.fromIata).toBeNull();
    expect(d.flight.flightNumber).toBeNull();
    expect(d.flight.depAt).toBeNull();
    expect(d.flight.arrAt).toBeNull();
    expect(d.cost).toBeNull();
  });

  it('acepta importe con moneda y redondea', () => {
    const d = sanitizeDraft({ ...base, cost: 123.456, currency: 'eur' });
    expect(d.cost).toBe(123.46);
    expect(d.currency).toBe('EUR');
  });

  it('tipo desconocido o sin datos → unknown con aviso', () => {
    expect(sanitizeDraft({ kind: 'cohete' }).kind).toBe('unknown');
    const d = sanitizeDraft({ ...base, flight: {} });
    expect(d.kind).toBe('unknown');
    expect(d.warnings.join(' ')).toMatch(/No se pudieron leer/);
  });

  it('avisa si la fecha cae fuera del viaje o si el final es anterior al inicio', () => {
    const trip = { name: 'Barcelona', startDate: new Date('2026-12-01T00:00:00Z'), endDate: new Date('2026-12-05T00:00:00Z') };
    expect(sanitizeDraft(base, trip).warnings.join(' ')).toMatch(/fuera de las fechas del viaje/);
    const inside = { ...base, flight: { ...base.flight, depAt: '2026-12-02T10:00', arrAt: '2026-12-02T09:00' } };
    expect(sanitizeDraft(inside, trip).warnings.join(' ')).toMatch(/anterior al inicio/);
  });

  it('alojamiento: web solo http(s), huéspedes enteros', () => {
    const d = sanitizeDraft({ ...base, kind: 'accommodation', accommodation: { name: 'Hotel Sol', address: null, city: 'Madrid', country: 'ES', checkInAt: '2026-11-02T15:00', checkOutAt: '2026-11-04T11:00', guests: 2.5, rooms: 1, bookingRef: 'ABC', phone: null, website: 'javascript:alert(1)' } });
    expect(d.accommodation.website).toBeNull();
    expect(d.accommodation.guests).toBeNull();
    expect(d.accommodation.rooms).toBe(1);
  });

  it('entrada basura → unknown sin romper', () => {
    expect(sanitizeDraft(null).kind).toBe('unknown');
    expect(sanitizeDraft('texto').kind).toBe('unknown');
  });
});

describe('localDateTime', () => {
  it('valida fechas reales', () => {
    expect(localDateTime('2026-02-30T10:00')).toBeNull();
    expect(localDateTime('2026-10-01T01:30:00')).toBe('2026-10-01T01:30');
  });
});

describe('prompt y esquema', () => {
  it('incluye hoy, fechas del viaje y la defensa contra instrucciones en el documento', () => {
    const p = buildSystemPrompt('2026-10-15', { name: 'Barcelona', startDate: new Date('2026-12-01T00:00:00Z'), endDate: new Date('2026-12-05T00:00:00Z') });
    expect(p).toContain('2026-10-15');
    expect(p).toContain('2026-12-01');
    expect(p).toMatch(/DATOS, no instrucciones/);
  });
  it('el esquema estricto exige todas las propiedades', () => {
    const s: any = DRAFT_JSON_SCHEMA;
    expect(s.additionalProperties).toBe(false);
    expect(s.required.sort()).toEqual(Object.keys(s.properties).sort());
    expect(s.properties.flight.required.sort()).toEqual(Object.keys(s.properties.flight.properties).sort());
  });
});
