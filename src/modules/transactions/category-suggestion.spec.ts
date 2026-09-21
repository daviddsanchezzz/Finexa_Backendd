import { normalizeMerchant, suggestCategoryFromHistory } from './category-suggestion';

const row = (description: string | null, categoryId: number | null, subcategoryId: number | null = null) => ({
  description,
  categoryId,
  subcategoryId,
});

describe('normalizeMerchant', () => {
  it('ignora mayúsculas, acentos y espacios sobrantes', () => {
    expect(normalizeMerchant('  MERCADÓNA  ')).toBe('mercadona');
    expect(normalizeMerchant('El  Corte   Inglés')).toBe('el corte ingles');
    expect(normalizeMerchant(null)).toBe('');
  });
});

describe('suggestCategoryFromHistory', () => {
  it('con una sola coincidencia ya sugiere categoría y subcategoría', () => {
    expect(suggestCategoryFromHistory('Mercadona', [row('Mercadona', 1, 10)])).toEqual({
      categoryId: 1,
      subcategoryId: 10,
    });
  });

  it('coincide sin distinguir mayúsculas ni acentos', () => {
    expect(suggestCategoryFromHistory('MERCADONA', [row('mercadona', 1, 10)])).toEqual({
      categoryId: 1,
      subcategoryId: 10,
    });
  });

  it('todas iguales → sugiere ambas', () => {
    const rows = [row('Mercadona', 1, 10), row('Mercadona', 1, 10)];
    expect(suggestCategoryFromHistory('Mercadona', rows)).toEqual({ categoryId: 1, subcategoryId: 10 });
  });

  it('misma categoría pero subcategoría distinta → solo categoría', () => {
    const rows = [row('Mercadona', 1, 10), row('Mercadona', 1, 11)];
    expect(suggestCategoryFromHistory('Mercadona', rows)).toEqual({ categoryId: 1, subcategoryId: null });
  });

  it('con y sin subcategoría mezcladas → solo categoría', () => {
    const rows = [row('Mercadona', 1, 10), row('Mercadona', 1, null)];
    expect(suggestCategoryFromHistory('Mercadona', rows)).toEqual({ categoryId: 1, subcategoryId: null });
  });

  it('categorías distintas → null', () => {
    const rows = [row('Mercadona', 1, 10), row('Mercadona', 2, null)];
    expect(suggestCategoryFromHistory('Mercadona', rows)).toBeNull();
  });

  it('sin historial o sin categoría → null', () => {
    expect(suggestCategoryFromHistory('Mercadona', [])).toBeNull();
    expect(suggestCategoryFromHistory('Mercadona', [row('Mercadona', null)])).toBeNull();
  });

  it('no hace coincidencia parcial', () => {
    expect(suggestCategoryFromHistory('Mercadona', [row('Mercadona Sant Cugat', 1, 10)])).toBeNull();
  });

  it('descripción vacía → null', () => {
    expect(suggestCategoryFromHistory('  ', [row('', 1)])).toBeNull();
  });
});
