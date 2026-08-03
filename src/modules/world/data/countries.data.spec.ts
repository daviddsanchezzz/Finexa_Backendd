import { COUNTRIES, CONTINENT_ORDER, safePct } from './countries.data';

describe('countries.data', () => {
  it('has exactly 195 countries with no duplicate codes', () => {
    expect(COUNTRIES.length).toBe(195);
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.size).toBe(195);
  });

  it('splits countries per continent matching the expected reference totals', () => {
    const counts = CONTINENT_ORDER.reduce((acc, continent) => {
      acc[continent] = COUNTRIES.filter((c) => c.continent === continent).length;
      return acc;
    }, {} as Record<string, number>);

    expect(counts).toEqual({
      europe: 44,
      asia: 48,
      north_america: 23,
      south_america: 12,
      africa: 54,
      oceania: 14,
    });
  });

  it('every country code is a valid 2-letter uppercase ISO code', () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('safePct', () => {
  it('returns 0 when denominator is 0 or negative', () => {
    expect(safePct(5, 0)).toBe(0);
    expect(safePct(5, -1)).toBe(0);
  });
  it('rounds to nearest integer percentage', () => {
    expect(safePct(1, 3)).toBe(33);
    expect(safePct(2, 3)).toBe(67);
  });
});
