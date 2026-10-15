/**
 * Puntuación de salud financiera: funciones puras (sin base de datos) para poder
 * probarlas a fondo. Todas las cantidades van ya en la moneda base del usuario.
 *
 * Principios de diseño:
 *  - Cada métrica explica de dónde sale, con qué objetivo se compara y si ese
 *    objetivo es una suposición (perfil sin rellenar).
 *  - Lo que no se puede medir se omite y los pesos se reparten entre el resto;
 *    nunca se inventa un 0 ni un 100.
 *  - Un buen resultado en lo básico no oculta lo que viene: la proyección hacia
 *    la independencia financiera (FI) y la cartera mantienen el score informativo.
 */

export type IncomeType = 'salaried' | 'variable' | 'self_employed' | 'student' | 'other';

export interface HealthProfile {
  birthYear?: number | null;
  incomeType?: IncomeType | string | null;
  dependents?: number | null;
  riskTolerance?: number | null; // 1..5
  emergencyMonthsTarget?: number | null;
  fiTargetMultiple?: number | null;
  fiTargetAge?: number | null;
  expectedRealReturnPct?: number | null;
}

/** Mes natural COMPLETO (nunca el mes en curso). */
export interface MonthAgg {
  key: string; // 'YYYY-MM'
  income: number;
  expense: number;
  investmentContribution: number;
}

export interface CurrentMonth {
  income: number;
  expense: number;
  investmentContribution: number;
  daysElapsed: number;
  daysInMonth: number;
}

export interface PortfolioPosition {
  assetId: number;
  name: string;
  type: string; // crypto | etf | stock | fund | custom | cash
  value: number;
  targetPct: number | null; // 0..100
}

export interface GoalInput {
  id: number;
  name: string;
  status: string; // ACTIVE | COMPLETED | ARCHIVED
  currentAmount: number;
  targetAmount: number;
  startDate: Date;
  targetDate: Date | null;
}

export interface DebtInput {
  name: string;
  remaining: number;
  monthlyPayment: number | null;
  interestRate: number | null; // % anual
}

export interface HealthInputs {
  now: Date;
  months: MonthAgg[]; // ascendentes, solo completos
  currentMonth: CurrentMonth | null;
  liquid: number; // carteras cash + savings
  invested: number; // carteras de inversión
  debts: DebtInput[];
  positions: PortfolioPosition[];
  goals: GoalInput[];
  profile: HealthProfile;
}

export type MetricKey =
  | 'runway'
  | 'debt'
  | 'savings'
  | 'contributions'
  | 'stability'
  | 'fiPath'
  | 'portfolio'
  | 'goals';
export type PillarKey = 'resilience' | 'habits' | 'growth' | 'portfolio' | 'goals';
export type Unit = 'percent' | 'months' | 'years' | 'eur' | 'count';
export type Status = 'good' | 'ok' | 'attention' | 'na';

export interface MetricResult {
  key: MetricKey;
  label: string;
  pillar: PillarKey;
  weight: number;
  score: number | null; // 0..100, null = no medible
  value: number | null;
  unit: Unit;
  target: number | null;
  status: Status;
  summary: string;
  assumption: string | null;
}

export interface PillarResult {
  key: PillarKey;
  label: string;
  weight: number;
  score: number | null;
}

export interface Insight {
  id: string;
  severity: 'info' | 'tip' | 'warning';
  title: string;
  body: string;
  amount: number | null;
}

export interface FiProjection {
  capital: number;
  annualExpense: number;
  target: number;
  targetMultiple: number;
  progressPct: number;
  monthsCovered: number | null;
  monthlySavings: number;
  realReturnPct: number;
  yearsToFi: number | null; // null = no se alcanza con este ritmo
  reached: boolean;
}

export interface Lever {
  id: string;
  label: string;
  monthlyImpact: number; // € al mes
  yearsSooner: number | null; // años que adelanta la independencia financiera
}

export interface HealthReport {
  score: number | null;
  grade: 'excelente' | 'buena' | 'mejorable' | 'atencion' | null;
  confidence: 'alta' | 'media' | 'baja';
  monthsUsed: number;
  pillars: PillarResult[];
  metrics: MetricResult[];
  focus: { metric: MetricKey; label: string; reason: string } | null;
  insights: Insight[];
  fi: FiProjection | null;
  levers: Lever[];
  assumptions: string[];
  currency?: string;
}

// ---------------------------------------------------------------------------
// Configuración (un único sitio para ajustar umbrales)
// ---------------------------------------------------------------------------

export const WEIGHTS: Record<MetricKey, { weight: number; pillar: PillarKey; label: string }> = {
  runway: { weight: 25, pillar: 'resilience', label: 'Colchón de emergencia' },
  debt: { weight: 10, pillar: 'resilience', label: 'Carga de deudas' },
  savings: { weight: 20, pillar: 'habits', label: 'Tasa de ahorro' },
  contributions: { weight: 10, pillar: 'habits', label: 'Aportación a inversión' },
  stability: { weight: 5, pillar: 'habits', label: 'Estabilidad de ingresos' },
  fiPath: { weight: 15, pillar: 'growth', label: 'Camino a la independencia' },
  portfolio: { weight: 10, pillar: 'portfolio', label: 'Cartera' },
  goals: { weight: 5, pillar: 'goals', label: 'Objetivos' },
};

const PILLAR_LABELS: Record<PillarKey, string> = {
  resilience: 'Resiliencia',
  habits: 'Hábitos',
  growth: 'Crecimiento',
  portfolio: 'Cartera',
  goals: 'Objetivos',
};

export const DEFAULTS = {
  windowMonths: 6,
  savingsRateTarget: 0.2,
  contributionRateTarget: 0.1,
  fiMultiple: 25,
  realReturnPct: 4,
  debtRatioFull: 0.15, // por debajo: 100
  debtRatioZero: 0.4, // por encima: 0
  highInterestPct: 8,
  stabilityCvFull: 0.1, // hasta un 10 % de variación entre meses puntúa 100
  stabilityCvZero: 0.35,
  fiYearsFull: 15, // sin edad objetivo: llegar en <=15 años puntúa 100
  fiYearsZero: 40, // ... y >=40 años puntúa 0
  driftZero: 0.2, // 20 pp de desviación = 0
  maxProjectionYears: 80,
  minMonthsForRatios: 2,
  minMonthsForStability: 3,
  surplusMultiple: 2, // exceso de liquidez cuando supera 2x el colchón objetivo
  surplusMinEur: 1500,
  focusMinGain: 3, // puntos que debe poder sumar una métrica para señalarla como foco
};

const EMERGENCY_MONTHS_BY_INCOME: Record<string, number> = {
  salaried: 4,
  student: 3,
  variable: 9,
  self_employed: 9,
  other: 6,
};
const CRYPTO_CAP_BY_RISK: Record<number, number> = { 1: 0.02, 2: 0.05, 3: 0.1, 4: 0.2, 5: 0.35 };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length);
};
const eur = (n: number) => `${Math.round(n).toLocaleString('es-ES')} €`;
const pct = (n: number, d = 0) => `${round(n * 100, d).toLocaleString('es-ES')} %`;
const num = (n: number, d = 1) => round(n, d).toLocaleString('es-ES');

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return MONTHS_ES[m - 1] ? `${MONTHS_ES[m - 1]} de ${y}` : key;
};

const statusOf = (score: number | null): Status =>
  score == null ? 'na' : score >= 85 ? 'good' : score >= 60 ? 'ok' : 'attention';

const EMERGENCY_NAME = /emergencia|colch[oó]n|imprevistos/i;

function metric(key: MetricKey, partial: Partial<MetricResult> & Pick<MetricResult, 'unit' | 'summary'>): MetricResult {
  const w = WEIGHTS[key];
  const score = partial.score ?? null;
  return {
    key,
    label: w.label,
    pillar: w.pillar,
    weight: w.weight,
    score: score == null ? null : Math.round(score),
    value: partial.value ?? null,
    unit: partial.unit,
    target: partial.target ?? null,
    status: statusOf(score),
    summary: partial.summary,
    assumption: partial.assumption ?? null,
  };
}

function age(profile: HealthProfile, now: Date): number | null {
  return profile.birthYear ? now.getUTCFullYear() - profile.birthYear : null;
}

export function emergencyMonthsTarget(profile: HealthProfile): { months: number; assumed: boolean } {
  if (profile.emergencyMonthsTarget && profile.emergencyMonthsTarget > 0) {
    return { months: profile.emergencyMonthsTarget, assumed: false };
  }
  const base = EMERGENCY_MONTHS_BY_INCOME[profile.incomeType ?? 'other'] ?? 6;
  const withDeps = base + (profile.dependents && profile.dependents > 0 ? 2 : 0);
  return { months: withDeps, assumed: !profile.incomeType };
}

function recentMonths(months: MonthAgg[]): MonthAgg[] {
  return months.slice(-DEFAULTS.windowMonths);
}

/** Dinero apartado en objetivos que NO son el fondo de emergencia: no cuenta como colchón ni como capital libre. */
export function reservedForGoals(goals: GoalInput[]): number {
  return sum(
    goals
      .filter((g) => g.status === 'ACTIVE' && !EMERGENCY_NAME.test(g.name))
      .map((g) => Math.min(Math.max(g.currentAmount, 0), g.targetAmount)),
  );
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

export function savingsMetric(months: MonthAgg[]): MetricResult {
  const w = recentMonths(months);
  const income = sum(w.map((m) => m.income));
  if (w.length < DEFAULTS.minMonthsForRatios || income <= 0) {
    return metric('savings', { unit: 'percent', summary: 'Aún no hay suficientes meses con ingresos para calcularla.' });
  }
  const expense = sum(w.map((m) => m.expense));
  const rate = (income - expense) / income;
  const score = rate <= 0 ? 0 : clamp((rate / DEFAULTS.savingsRateTarget) * 100);
  const summary =
    rate <= 0
      ? `En los últimos ${w.length} meses has gastado más de lo que has ingresado.`
      : `Ahorras el ${pct(rate)} de lo que ingresas (media de ${w.length} meses). Referencia: ${pct(DEFAULTS.savingsRateTarget)}; por encima no suma más.`;
  return metric('savings', { score, value: rate, unit: 'percent', target: DEFAULTS.savingsRateTarget, summary });
}

export function runwayMetric(inp: HealthInputs): MetricResult {
  const w = recentMonths(inp.months);
  const { months: target, assumed } = emergencyMonthsTarget(inp.profile);
  const assumption = assumed
    ? `Objetivo de ${target} meses supuesto: añade tu tipo de ingreso en el perfil para ajustarlo.`
    : null;
  const avgExpense = mean(w.map((m) => m.expense));
  if (w.length < DEFAULTS.minMonthsForRatios || avgExpense < 1) {
    return metric('runway', { unit: 'months', target, summary: 'Aún no hay suficientes meses con gastos para calcularlo.', assumption });
  }
  const free = Math.max(inp.liquid - reservedForGoals(inp.goals), 0);
  const runway = free / avgExpense;
  const score = clamp((runway / target) * 100);
  const summary =
    runway >= target
      ? `Tu dinero líquido libre cubre ${num(runway)} meses de gasto (objetivo: ${target}).`
      : `Tu dinero líquido libre cubre ${num(runway)} de los ${target} meses que te has marcado.`;
  return metric('runway', { score, value: runway, unit: 'months', target, summary, assumption });
}

export function debtMetric(inp: HealthInputs): MetricResult {
  const debts = inp.debts.filter((d) => d.remaining > 0);
  if (!debts.length) {
    return metric('debt', { score: 100, value: 0, unit: 'percent', target: DEFAULTS.debtRatioFull, summary: 'No tienes deudas pendientes.' });
  }
  const w = recentMonths(inp.months);
  const income = mean(w.map((m) => m.income));
  if (income <= 0) {
    return metric('debt', { unit: 'percent', summary: 'Hay deudas, pero faltan ingresos para medir su peso.' });
  }
  const payments = sum(debts.map((d) => d.monthlyPayment ?? 0));
  const ratio = payments / income;
  let score = clamp(((DEFAULTS.debtRatioZero - ratio) / (DEFAULTS.debtRatioZero - DEFAULTS.debtRatioFull)) * 100);
  const expensive = debts.filter((d) => (d.interestRate ?? 0) > DEFAULTS.highInterestPct);
  if (expensive.length) score = Math.max(score - 20, 0);
  const summary =
    `Dedicas el ${pct(ratio)} de tus ingresos a cuotas de deuda.` +
    (expensive.length ? ` ${expensive.length === 1 ? 'Una deuda supera' : 'Varias deudas superan'} el ${DEFAULTS.highInterestPct} % de interés.` : '');
  return metric('debt', { score, value: ratio, unit: 'percent', target: DEFAULTS.debtRatioFull, summary });
}

export function contributionsMetric(months: MonthAgg[]): MetricResult {
  const w = recentMonths(months);
  const income = sum(w.map((m) => m.income));
  if (w.length < DEFAULTS.minMonthsForRatios || income <= 0) {
    return metric('contributions', { unit: 'percent', summary: 'Aún no hay suficientes meses para calcularla.' });
  }
  const rate = sum(w.map((m) => m.investmentContribution)) / income;
  const consistency = w.filter((m) => m.investmentContribution > 0).length / w.length;
  const rateScore = clamp((rate / DEFAULTS.contributionRateTarget) * 100);
  const score = 0.7 * rateScore + 0.3 * consistency * 100;
  const perMonth = sum(w.map((m) => m.investmentContribution)) / w.length;
  const summary =
    rate <= 0
      ? 'No has aportado a inversión en los últimos meses.'
      : `Aportas de media ${eur(perMonth)} al mes a inversión (${pct(rate)} de tus ingresos) y lo has hecho en ${Math.round(consistency * w.length)} de ${w.length} meses. Referencia: ${pct(DEFAULTS.contributionRateTarget)}.` +
        (rate > 1 ? ' Supera tus ingresos porque incluye traspasos desde tu ahorro.' : '');
  return metric('contributions', { score, value: rate, unit: 'percent', target: DEFAULTS.contributionRateTarget, summary });
}

export function stabilityMetric(months: MonthAgg[], profile: HealthProfile): MetricResult {
  const w = recentMonths(months).map((m) => m.income);
  if (w.length < DEFAULTS.minMonthsForStability || mean(w) <= 0) {
    return metric('stability', { unit: 'percent', summary: 'Hacen falta al menos 3 meses con ingresos para medir su regularidad.' });
  }
  const cv = stdev(w) / mean(w);
  const score = clamp(100 * (1 - (cv - DEFAULTS.stabilityCvFull) / (DEFAULTS.stabilityCvZero - DEFAULTS.stabilityCvFull)));
  const stable = cv <= DEFAULTS.stabilityCvFull + 0.02;
  const summary = stable
    ? `Tus ingresos son muy regulares (variación del ${pct(cv)} entre meses).`
    : `Tus ingresos varían un ${pct(cv)} entre meses${profile.incomeType === 'salaried' ? ', más de lo habitual en una nómina' : ''}.`;
  return metric('stability', { score, value: cv, unit: 'percent', target: 0.12, summary });
}

// --- Independencia financiera ---------------------------------------------

/** Meses hasta alcanzar `target` con capital inicial, aportación mensual y rentabilidad real anual. null = no se alcanza. */
export function monthsToTarget(capital: number, monthly: number, annualRealReturn: number, target: number): number | null {
  if (capital >= target) return 0;
  const r = annualRealReturn / 12;
  const maxMonths = DEFAULTS.maxProjectionYears * 12;
  let bal = capital;
  for (let m = 1; m <= maxMonths; m++) {
    bal = bal * (1 + r) + monthly;
    if (bal >= target) return m;
  }
  return null;
}

export function projectFi(inp: HealthInputs): FiProjection | null {
  const w = recentMonths(inp.months);
  if (w.length < DEFAULTS.minMonthsForRatios) return null;
  const avgExpense = mean(w.map((m) => m.expense));
  if (avgExpense < 1) return null;
  const capital = Math.max(inp.liquid + inp.invested - reservedForGoals(inp.goals), 0);
  const multiple = inp.profile.fiTargetMultiple && inp.profile.fiTargetMultiple > 0 ? inp.profile.fiTargetMultiple : DEFAULTS.fiMultiple;
  const annualExpense = avgExpense * 12;
  const target = annualExpense * multiple;
  const monthlySavings = Math.max(mean(w.map((m) => m.income - m.expense)), 0);
  const realReturnPct = inp.profile.expectedRealReturnPct ?? DEFAULTS.realReturnPct;
  const months = monthsToTarget(capital, monthlySavings, realReturnPct / 100, target);
  return {
    capital,
    annualExpense,
    target,
    targetMultiple: multiple,
    progressPct: target > 0 ? (capital / target) * 100 : 0,
    monthsCovered: avgExpense > 0 ? capital / avgExpense : null,
    monthlySavings,
    realReturnPct,
    yearsToFi: months == null ? null : months / 12,
    reached: capital >= target,
  };
}

export function fiMetric(inp: HealthInputs, fi: FiProjection | null): MetricResult {
  if (!fi) {
    return metric('fiPath', { unit: 'years', summary: 'Aún no hay suficientes meses para proyectar tu camino.' });
  }
  const a = age(inp.profile, inp.now);
  const targetYears = a != null && inp.profile.fiTargetAge ? inp.profile.fiTargetAge - a : null;
  const assumedReturn = inp.profile.expectedRealReturnPct == null;
  const notes: string[] = [];
  if (assumedReturn) notes.push(`rentabilidad real supuesta del ${DEFAULTS.realReturnPct} %`);
  if (inp.profile.fiTargetMultiple == null) notes.push(`objetivo de ${DEFAULTS.fiMultiple} veces tu gasto anual (regla del 4 %)`);
  if (targetYears == null) notes.push(`sin edad objetivo: referencia de ${DEFAULTS.fiYearsFull}-${DEFAULTS.fiYearsZero} años`);
  const assumption = notes.length ? `Suposiciones: ${notes.join('; ')}.` : null;

  if (fi.reached) {
    return metric('fiPath', { score: 100, value: 0, unit: 'years', target: 0, summary: 'Tu capital ya cubre el objetivo de independencia financiera.', assumption });
  }
  if (fi.yearsToFi == null) {
    return metric('fiPath', {
      score: 0,
      value: null,
      unit: 'years',
      summary: `Con tu ritmo de ahorro actual no llegarías a tu objetivo (${eur(fi.target)}) en ${DEFAULTS.maxProjectionYears} años.`,
      assumption,
    });
  }
  const years = fi.yearsToFi;
  const score =
    targetYears != null && targetYears > 0
      ? clamp((targetYears / Math.max(years, 0.1)) * 100)
      : clamp(((DEFAULTS.fiYearsZero - years) / (DEFAULTS.fiYearsZero - DEFAULTS.fiYearsFull)) * 100);
  const summary =
    `A este ritmo (${eur(fi.monthlySavings)}/mes) llegarías a ${eur(fi.target)} en unos ${num(years)} años` +
    (targetYears != null && targetYears > 0 ? `; tu meta son ${num(targetYears)}.` : '.') +
    ` Hoy llevas el ${num(fi.progressPct)} %.`;
  return metric('fiPath', { score, value: years, unit: 'years', target: targetYears, summary, assumption });
}

// --- Cartera ---------------------------------------------------------------

export interface PortfolioAnalysis {
  total: number;
  drift: number | null; // 0..1
  maxWeight: number;
  cryptoShare: number;
  deviations: { assetId: number; name: string; actualPct: number; targetPct: number; gapEur: number }[];
}

export function analyzePortfolio(positions: PortfolioPosition[]): PortfolioAnalysis {
  const valued = positions.filter((p) => p.value > 0);
  const total = sum(valued.map((p) => p.value));
  if (total <= 0) return { total: 0, drift: null, maxWeight: 0, cryptoShare: 0, deviations: [] };
  const targetSum = sum(positions.map((p) => p.targetPct ?? 0));
  const hasTargets = targetSum > 0;
  const deviations = hasTargets
    ? positions
        .filter((p) => (p.targetPct ?? 0) > 0 || p.value > 0)
        .map((p) => {
          const actualPct = (p.value / total) * 100;
          const targetPct = ((p.targetPct ?? 0) / targetSum) * 100; // normaliza si no suman 100
          return { assetId: p.assetId, name: p.name, actualPct, targetPct, gapEur: ((targetPct - actualPct) / 100) * total };
        })
    : [];
  const drift = hasTargets ? sum(deviations.map((d) => Math.abs(d.actualPct - d.targetPct))) / 200 : null;
  return {
    total,
    drift,
    maxWeight: Math.max(...valued.map((p) => p.value / total)),
    cryptoShare: sum(valued.filter((p) => p.type === 'crypto').map((p) => p.value)) / total,
    deviations,
  };
}

export function portfolioMetric(positions: PortfolioPosition[]): MetricResult {
  const a = analyzePortfolio(positions);
  if (a.total < 1000) {
    return metric('portfolio', { unit: 'percent', summary: 'Tu cartera es todavía demasiado pequeña para valorar su reparto.' });
  }
  if (a.drift != null) {
    const score = clamp(100 * (1 - a.drift / DEFAULTS.driftZero));
    const worst = [...a.deviations].sort((x, y) => Math.abs(y.actualPct - y.targetPct) - Math.abs(x.actualPct - x.targetPct))[0];
    const summary =
      a.drift < 0.02
        ? `Tu cartera está prácticamente en el reparto que te has marcado (desviación del ${pct(a.drift, 1)}).`
        : `Tu cartera se desvía un ${pct(a.drift, 1)} de tu reparto objetivo` +
          (worst ? `; lo que más: ${worst.name} (${num(worst.actualPct)} % frente a ${num(worst.targetPct)} % objetivo).` : '.');
    return metric('portfolio', { score, value: a.drift, unit: 'percent', target: 0.05, summary });
  }
  const over = Math.max(a.maxWeight - 0.4, 0);
  const score = clamp(100 * (1 - over / 0.4));
  return metric('portfolio', {
    score,
    value: a.maxWeight,
    unit: 'percent',
    target: 0.4,
    summary: `Tu mayor posición pesa el ${pct(a.maxWeight)} de la cartera. Si defines un reparto objetivo, se mide la desviación en lugar de la concentración.`,
    assumption: 'Sin reparto objetivo definido: se mide la concentración.',
  });
}

// --- Objetivos -------------------------------------------------------------

export function goalsMetric(goals: GoalInput[], now: Date): MetricResult {
  const dated = goals.filter((g) => g.status === 'ACTIVE' && g.targetDate && g.targetAmount > 0 && !EMERGENCY_NAME.test(g.name));
  if (!dated.length) {
    return metric('goals', { unit: 'percent', summary: 'Sin objetivos con fecha: crea uno para que se mida si vas a tiempo.' });
  }
  const scores = dated.map((g) => {
    if (g.currentAmount >= g.targetAmount) return 100;
    const start = g.startDate.getTime();
    const end = g.targetDate!.getTime();
    if (now.getTime() >= end) return 0;
    const expected = clamp(((now.getTime() - start) / Math.max(end - start, 1)) * 100, 0, 100) / 100;
    const actual = g.currentAmount / g.targetAmount;
    if (expected < 0.05) return 100; // acaba de empezar
    return clamp((actual / expected) * 100);
  });
  const score = mean(scores);
  const onTrack = scores.filter((s) => s >= 85).length;
  return metric('goals', {
    score,
    value: onTrack / dated.length,
    unit: 'percent',
    target: 1,
    summary: `${onTrack} de ${dated.length} objetivos con fecha van a buen ritmo.`,
  });
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function buildInsights(inp: HealthInputs, fi: FiProjection | null, metrics: MetricResult[]): Insight[] {
  const out: Insight[] = [];
  const w = recentMonths(inp.months);
  const avgExpense = mean(w.map((m) => m.expense));
  const { months: target } = emergencyMonthsTarget(inp.profile);
  const free = Math.max(inp.liquid - reservedForGoals(inp.goals), 0);

  // 1) Exceso de liquidez
  if (avgExpense >= 1 && w.length >= DEFAULTS.minMonthsForRatios) {
    const comfortable = target * avgExpense;
    if (free > comfortable * DEFAULTS.surplusMultiple && free - comfortable >= DEFAULTS.surplusMinEur) {
      const surplus = free - comfortable;
      out.push({
        id: 'liquidity_surplus',
        severity: 'tip',
        title: `Tienes unos ${eur(surplus)} por encima de tu colchón`,
        body: `Tu objetivo de colchón son ${target} meses (${eur(comfortable)}) y tienes ${eur(free)} líquidos libres. Si no te rinde al menos lo que sube la inflación, va perdiendo poder adquisitivo: puedes reservarlo para un plan concreto (crea un objetivo con fecha), buscarle un uso que rinda o decidir qué parte invertir. Es una decisión tuya; la app solo te lo señala.`,
        amount: surplus,
      });
    }
  }

  // 2) Cartera: siguiente aportación
  const a = analyzePortfolio(inp.positions);
  if (a.drift != null && a.drift > 0.03 && a.total >= 1000) {
    const under = [...a.deviations].filter((d) => d.gapEur > 0).sort((x, y) => y.gapEur - x.gapEur)[0];
    if (under && under.gapEur >= 50) {
      out.push({
        id: 'next_contribution',
        severity: 'tip',
        title: `Tu próxima aportación podría ir a ${under.name}`,
        body: `Pesa un ${num(under.actualPct)} % y tu objetivo es ${num(under.targetPct)} %. Aportar ahí acerca la cartera a tu reparto sin vender nada (faltan unos ${eur(under.gapEur)}).`,
        amount: under.gapEur,
      });
    }
  }

  // 3) Cripto por encima de lo que tolera tu perfil
  const cap = CRYPTO_CAP_BY_RISK[inp.profile.riskTolerance ?? 3] ?? 0.1;
  if (a.total >= 1000 && a.cryptoShare > cap) {
    out.push({
      id: 'crypto_cap',
      severity: 'warning',
      title: 'Tu peso en cripto supera tu límite de riesgo',
      body: `La cripto es el ${pct(a.cryptoShare)} de tu cartera y tu perfil de riesgo sugiere no pasar del ${pct(cap)}.`,
      amount: null,
    });
  }

  // 4) Ritmo de gasto del mes en curso
  const cm = inp.currentMonth;
  if (cm && cm.daysElapsed >= 7 && w.length >= 3) {
    const recent = w.slice(-3);
    const avg3 = mean(recent.map((m) => m.expense));
    const projected = (cm.expense / cm.daysElapsed) * cm.daysInMonth;
    if (avg3 > 0 && projected > avg3 * 1.15 && projected - avg3 >= 100) {
      out.push({
        id: 'spend_pace',
        severity: 'warning',
        title: 'Este mes vas a ritmo de gastar más de lo habitual',
        body: `Llevas ${eur(cm.expense)} en ${cm.daysElapsed} días: al ritmo actual acabarías el mes en torno a ${eur(projected)}, un ${pct(projected / avg3 - 1)} más que tu media de los últimos 3 meses (${eur(avg3)}).`,
        amount: projected - avg3,
      });
    }
  }

  // 5) Caída del ahorro el último mes completo
  if (w.length >= 4) {
    const last = w[w.length - 1];
    const prev = w.slice(0, -1);
    const prevRate = sum(prev.map((m) => m.income - m.expense)) / Math.max(sum(prev.map((m) => m.income)), 1);
    const lastRate = last.income > 0 ? (last.income - last.expense) / last.income : null;
    if (lastRate != null && prevRate - lastRate >= 0.2) {
      out.push({
        id: 'savings_drop',
        severity: 'info',
        title: `En ${monthLabel(last.key)} ahorraste mucho menos de lo habitual`,
        body: `Ahorraste el ${pct(lastRate)} frente a una media del ${pct(prevRate)} en los meses anteriores. Puede ser puntual (un viaje, una compra grande); si no lo es, conviene mirar en qué categoría subió el gasto.`,
        amount: null,
      });
    }
  }

  // 6) Aportación pendiente este mes
  if (cm && cm.daysElapsed >= 20 && w.length >= 4) {
    const habitual = w.filter((m) => m.investmentContribution > 0).length / w.length >= 0.8;
    if (habitual && cm.investmentContribution <= 0) {
      out.push({
        id: 'contribution_pending',
        severity: 'tip',
        title: 'Aún no has aportado a inversión este mes',
        body: 'Sueles aportar casi todos los meses y este todavía no figura. Si ya lo hiciste en otro sitio, ignora este aviso.',
        amount: null,
      });
    }
  }

  // 7) Objetivos vencidos
  const overdue = inp.goals.filter((g) => g.status === 'ACTIVE' && g.targetDate && g.targetDate.getTime() < inp.now.getTime() && g.currentAmount < g.targetAmount);
  for (const g of overdue.slice(0, 2)) {
    out.push({
      id: `goal_overdue_${g.id}`,
      severity: 'warning',
      title: `El objetivo «${g.name}» ha vencido sin completarse`,
      body: `Llevas ${eur(g.currentAmount)} de ${eur(g.targetAmount)}. Puedes ampliar la fecha o revisar la meta.`,
      amount: g.targetAmount - g.currentAmount,
    });
  }

  // 8) Si todo va bien: mantener
  const measurable = metrics.filter((m) => m.score != null);
  if (measurable.length && measurable.every((m) => (m.score ?? 0) >= 85) && fi && !fi.reached) {
    out.push({
      id: 'keep_going',
      severity: 'info',
      title: 'Tus bases están sólidas: lo que más mueve ahora es el largo plazo',
      body: `El colchón, el ahorro y las deudas están en buen estado. Lo que más acerca tu independencia financiera es mantener la aportación y revisar de vez en cuando el reparto de la cartera.`,
      amount: null,
    });
  }

  const order = { warning: 0, tip: 1, info: 2 } as const;
  return out.sort((x, y) => order[x.severity] - order[y.severity]).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Informe completo
// ---------------------------------------------------------------------------

/** Informe sin palancas (las palancas simulan, y simular usa este informe: así se evita la recursión). */
function computeReport(inp: HealthInputs): Omit<HealthReport, 'levers'> {
  const fi = projectFi(inp);
  const metrics: MetricResult[] = [
    runwayMetric(inp),
    debtMetric(inp),
    savingsMetric(inp.months),
    contributionsMetric(inp.months),
    stabilityMetric(inp.months, inp.profile),
    fiMetric(inp, fi),
    portfolioMetric(inp.positions),
    goalsMetric(inp.goals, inp.now),
  ];

  const measurable = metrics.filter((m) => m.score != null);
  const totalWeight = sum(measurable.map((m) => m.weight));
  // Sin historial suficiente no se da nota: "no tienes deudas" siempre puntúa 100
  // y, sola, daría un 100 engañoso a quien aún no ha registrado nada.
  const enoughHistory = recentMonths(inp.months).length >= DEFAULTS.minMonthsForRatios;
  const score = enoughHistory && totalWeight > 0 ? Math.round(sum(measurable.map((m) => (m.score as number) * m.weight)) / totalWeight) : null;

  const pillarKeys = Object.keys(PILLAR_LABELS) as PillarKey[];
  const pillars: PillarResult[] = pillarKeys.map((key) => {
    const ms = measurable.filter((m) => m.pillar === key);
    const w = sum(ms.map((m) => m.weight));
    return {
      key,
      label: PILLAR_LABELS[key],
      weight: sum(metrics.filter((m) => m.pillar === key).map((m) => m.weight)),
      score: w > 0 ? Math.round(sum(ms.map((m) => (m.score as number) * m.weight)) / w) : null,
    };
  });

  // Qué mejorar primero: el mayor margen ponderado.
  const ranked = measurable
    .map((m) => ({ m, gain: (m.weight * (100 - (m.score as number))) / 100 }))
    .sort((x, y) => y.gain - x.gain);
  const top = ranked[0];
  const focus =
    top && top.gain >= DEFAULTS.focusMinGain
      ? { metric: top.m.key, label: top.m.label, reason: `Es donde más margen hay: puntúa ${top.m.score}/100 y pesa un ${top.m.weight} % del total (podría sumar hasta ${Math.round(top.gain)} puntos).` }
      : null;

  const monthsUsed = recentMonths(inp.months).length;
  const missing = metrics.filter((m) => m.score == null).length;
  const confidence: HealthReport['confidence'] = monthsUsed >= 6 && missing <= 2 ? 'alta' : monthsUsed >= 3 ? 'media' : 'baja';

  const assumptions = metrics.map((m) => m.assumption).filter((x): x is string => !!x);

  return {
    score,
    grade: score == null ? null : score >= 85 ? 'excelente' : score >= 70 ? 'buena' : score >= 50 ? 'mejorable' : 'atencion',
    confidence,
    monthsUsed,
    pillars,
    metrics,
    focus,
    insights: buildInsights(inp, fi, metrics),
    fi,
    assumptions,
  };
}

export function computeHealth(inp: HealthInputs): HealthReport {
  const report = computeReport(inp);
  return { ...report, levers: buildLevers(inp, report.fi) };
}

/** Dos palancas fijas y comparables: gastar un 10 % menos y ahorrar 100 € más. */
function buildLevers(inp: HealthInputs, fi: FiProjection | null): Lever[] {
  if (!fi || fi.reached || fi.yearsToFi == null) return [];
  const defs = [
    { id: 'cut_spend_10', label: 'Gastar un 10 % menos cada mes', extra: (fi.annualExpense / 12) * 0.1 },
    { id: 'save_100', label: 'Ahorrar 100 € más al mes', extra: 100 },
  ];
  return defs
    .map((d) => {
      const s = simulate(inp, { extraMonthlySavings: d.extra });
      const years = s.scenario.yearsToFi;
      return { id: d.id, label: d.label, monthlyImpact: round(d.extra), yearsSooner: years == null ? null : round((fi.yearsToFi as number) - years, 1) };
    })
    .filter((l) => l.yearsSooner != null && l.yearsSooner > 0);
}

// ---------------------------------------------------------------------------
// Simulador "¿y si…?"
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  extraMonthlySavings?: number; // gastar menos cada mes
  oneOffExpense?: number; // gasto puntual que sale de la liquidez
  extraMonthlyInvestment?: number; // mover ahorro a inversión (no cambia el ahorro total)
}

export interface ScenarioResult {
  baseline: ScenarioSnapshot;
  scenario: ScenarioSnapshot;
  delta: { score: number | null; runwayMonths: number | null; yearsToFi: number | null };
}

export interface ScenarioSnapshot {
  score: number | null;
  runwayMonths: number | null;
  yearsToFi: number | null;
  monthlySavings: number | null;
}

const snapshot = (r: Omit<HealthReport, 'levers'>): ScenarioSnapshot => ({
  score: r.score,
  runwayMonths: r.metrics.find((m) => m.key === 'runway')?.value ?? null,
  yearsToFi: r.fi?.yearsToFi ?? null,
  monthlySavings: r.fi?.monthlySavings ?? null,
});

export function simulate(inp: HealthInputs, s: ScenarioInput): ScenarioResult {
  const extra = Math.max(s.extraMonthlySavings ?? 0, 0);
  const oneOff = Math.max(s.oneOffExpense ?? 0, 0);
  const invest = Math.max(s.extraMonthlyInvestment ?? 0, 0);
  const months = inp.months.map((m) => ({
    ...m,
    expense: Math.max(m.expense - extra, 0),
    investmentContribution: m.investmentContribution + invest,
  }));
  const modified: HealthInputs = { ...inp, months, liquid: Math.max(inp.liquid - oneOff, 0) };
  const base = snapshot(computeReport(inp));
  const scen = snapshot(computeReport(modified));
  const d = (a: number | null, b: number | null) => (a == null || b == null ? null : round(b - a, 2));
  return {
    baseline: base,
    scenario: scen,
    delta: { score: d(base.score, scen.score), runwayMonths: d(base.runwayMonths, scen.runwayMonths), yearsToFi: d(base.yearsToFi, scen.yearsToFi) },
  };
}
