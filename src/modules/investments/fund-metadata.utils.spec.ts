import { normalizeCountry, normalizeSector, parsePercent } from './fund-metadata.utils';

describe('fund-metadata.utils', () => {
  it('parses percentages with comma and dot', () => {
    expect(parsePercent('71,9 %')).toBeCloseTo(71.9);
    expect(parsePercent('81.51%')).toBeCloseTo(81.51);
  });

  it('normalizes country names', () => {
    expect(normalizeCountry('Estados Unidos')).toBe('United States');
    expect(normalizeCountry('japon')).toBe('Japan');
  });

  it('normalizes sector names', () => {
    expect(normalizeSector('tecnologia de la informacion')).toBe('Information Technology');
    expect(normalizeSector('Sanidad')).toBe('Healthcare');
  });
});
