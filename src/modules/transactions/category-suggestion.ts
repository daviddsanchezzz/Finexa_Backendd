// Sugerencia de categoría por comercio, a partir del historial del usuario.
// Lógica pura (sin Prisma) para poder testearla aislada.

export type SuggestionRow = {
  description: string | null;
  categoryId: number | null;
  subcategoryId: number | null;
};

export type CategorySuggestion = {
  categoryId: number;
  subcategoryId: number | null;
};

/** Minúsculas, sin acentos y con espacios colapsados. */
export function normalizeMerchant(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve la categoría (y subcategoría) a sugerir para `description`, o null.
 *
 * Reglas:
 * - Solo cuentan filas cuya descripción normalizada es IGUAL (no parcial).
 * - Con una sola coincidencia ya se sugiere.
 * - La categoría solo se sugiere si TODAS las coincidencias tienen la misma.
 * - La subcategoría solo si TODAS tienen la misma; si varía, se sugiere solo
 *   la categoría (subcategoryId = null).
 */
export function suggestCategoryFromHistory(
  description: string,
  rows: SuggestionRow[],
): CategorySuggestion | null {
  const target = normalizeMerchant(description);
  if (!target) return null;

  const matches = rows.filter(
    (r) => r.categoryId != null && normalizeMerchant(r.description) === target,
  );
  if (!matches.length) return null;

  const categoryId = matches[0].categoryId as number;
  if (!matches.every((r) => r.categoryId === categoryId)) return null;

  const subcategoryId = matches[0].subcategoryId ?? null;
  const sameSub = matches.every((r) => (r.subcategoryId ?? null) === subcategoryId);

  return { categoryId, subcategoryId: sameSub ? subcategoryId : null };
}
