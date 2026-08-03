import { WONDERS_CATALOG } from './wonders.data';

describe('wonders.data', () => {
  it('has exactly 21 wonders with unique keys', () => {
    expect(WONDERS_CATALOG.length).toBe(21);
    const keys = new Set(WONDERS_CATALOG.map((w) => w.key));
    expect(keys.size).toBe(21);
  });

  it('has exactly 7 modern, 7 ancient and 7 natural wonders', () => {
    expect(WONDERS_CATALOG.filter((w) => w.era === 'modern').length).toBe(7);
    expect(WONDERS_CATALOG.filter((w) => w.era === 'ancient').length).toBe(7);
    expect(WONDERS_CATALOG.filter((w) => w.era === 'natural').length).toBe(7);
  });

  it('every wonder has a valid 2-letter uppercase ISO country code', () => {
    for (const w of WONDERS_CATALOG) {
      expect(w.country).toMatch(/^[A-Z]{2}$/);
    }
  });
});
