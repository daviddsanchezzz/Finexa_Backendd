const COUNTRY_MAP: Record<string, string> = {
  'estados unidos': 'United States',
  'japon': 'Japan',
  'japón': 'Japan',
  'reino unido': 'United Kingdom',
  'canada': 'Canada',
  'canadá': 'Canada',
  'francia': 'France',
  'suiza': 'Switzerland',
  'alemania': 'Germany',
  'australia': 'Australia',
  'holanda': 'Netherlands',
  'paises bajos': 'Netherlands',
  'países bajos': 'Netherlands',
  'espana': 'Spain',
  'españa': 'Spain',
  'otros': 'Other',
};

const SECTOR_MAP: Record<string, string> = {
  'tecnologia de la informacion': 'Information Technology',
  'tecnología de la información': 'Information Technology',
  'servicios financieros': 'Financials',
  'industrias': 'Industrials',
  'bienes de consumo discrecional': 'Consumer Discretionary',
  'servicios de comunicacion': 'Communication Services',
  'servicios de comunicación': 'Communication Services',
  'sanidad': 'Healthcare',
  'bienes de consumo de 1ª necesidad': 'Consumer Staples',
  'energia': 'Energy',
  'energía': 'Energy',
  'materiales': 'Materials',
  'suministros publicos': 'Utilities',
  'suministros públicos': 'Utilities',
  'propiedades inmobiliarias': 'Real Estate',
};

export function parsePercent(input: string): number | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/%/g, '').replace(/\s/g, '');
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCountry(input: string): string {
  const key = String(input ?? '').trim().toLowerCase();
  return COUNTRY_MAP[key] ?? String(input ?? '').trim();
}

export function normalizeSector(input: string): string {
  const key = String(input ?? '').trim().toLowerCase();
  return SECTOR_MAP[key] ?? String(input ?? '').trim();
}

export function normalizeWeightMap(
  map: Record<string, number> | null | undefined,
  normalizeKey: (k: string) => string,
): Record<string, number> | null {
  if (!map) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const key = normalizeKey(k);
    const val = Number(v);
    if (!key || !Number.isFinite(val) || val <= 0) continue;
    out[key] = (out[key] ?? 0) + val;
  }
  return Object.keys(out).length ? out : null;
}

export function extractNamePercentPairs(html: string): Array<{ name: string; pct: number }> {
  const pairs: Array<{ name: string; pct: number }> = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null = null;
  while ((m = rowRegex.exec(html))) {
    const row = m[1];
    const text = row.replace(/<[^>]+>/g, '|').replace(/&nbsp;/g, ' ');
    const tokens = text.split('|').map((x) => x.trim()).filter(Boolean);
    if (tokens.length < 2) continue;
    const pctToken = tokens.find((t) => /\d+[\.,]?\d*\s*%/.test(t));
    if (!pctToken) continue;
    const pct = parsePercent(pctToken);
    if (pct == null) continue;
    const name = tokens[0];
    if (!name) continue;
    pairs.push({ name, pct });
  }
  return pairs;
}

export function toMap(pairs: Array<{ name: string; pct: number }>): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const p of pairs) out[p.name] = p.pct;
  return Object.keys(out).length ? out : null;
}
