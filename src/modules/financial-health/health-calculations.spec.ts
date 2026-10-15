import {
  GoalInput,
  HealthInputs,
  MonthAgg,
  PortfolioPosition,
  analyzePortfolio,
  computeHealth,
  contributionsMetric,
  debtMetric,
  emergencyMonthsTarget,
  fiMetric,
  goalsMetric,
  monthsToTarget,
  portfolioMetric,
  projectFi,
  reservedForGoals,
  runwayMetric,
  savingsMetric,
  simulate,
  stabilityMetric,
} from './health-calculations';

const NOW = new Date(Date.UTC(2026, 9, 15, 12));

const month = (key: string, income: number, expense: number, inv = 0): MonthAgg => ({ key, income, expense, investmentContribution: inv });
// Seis meses parecidos a un perfil real: ingresa ~1.800, gasta ~1.100, aporta 500.
const SIX: MonthAgg[] = [
  month('2026-04', 1800, 1100, 500),
  month('2026-05', 1800, 1100, 500),
  month('2026-06', 1800, 1100, 500),
  month('2026-07', 1800, 1100, 500),
  month('2026-08', 1800, 1100, 500),
  month('2026-09', 1800, 1100, 500),
];

const goal = (over: Partial<GoalInput> = {}): GoalInput => ({
  id: 1,
  name: 'Viaje',
  status: 'ACTIVE',
  currentAmount: 0,
  targetAmount: 1000,
  startDate: new Date(Date.UTC(2026, 0, 1)),
  targetDate: new Date(Date.UTC(2027, 0, 1)),
  ...over,
});

const pos = (assetId: number, name: string, value: number, targetPct: number | null, type = 'fund'): PortfolioPosition => ({ assetId, name, type, value, targetPct });

const base = (over: Partial<HealthInputs> = {}): HealthInputs => ({
  now: NOW,
  months: SIX,
  currentMonth: null,
  liquid: 20000,
  invested: 10000,
  debts: [],
  positions: [],
  goals: [],
  profile: {},
  ...over,
});

describe('savingsMetric', () => {
  it('usa la suma de ingresos y gastos (no la media de porcentajes)', () => {
    // Un mes de 100 € de ingreso con 0 gasto no puede pesar igual que uno de 2.000 €.
    const r = savingsMetric([month('a', 100, 0), month('b', 2000, 2000)]);
    expect(r.value).toBeCloseTo(100 / 2100, 5);
  });

  it('con 38,9 % de ahorro supera el objetivo y puntúa 100', () => {
    const r = savingsMetric(SIX);
    expect(r.value).toBeCloseTo(0.3889, 3);
    expect(r.score).toBe(100);
    expect(r.status).toBe('good');
  });

  it('gastar más de lo ingresado puntúa 0', () => {
    expect(savingsMetric([month('a', 1000, 1200), month('b', 1000, 1300)]).score).toBe(0);
  });

  it('el 10 % es la mitad del objetivo del 20 %', () => {
    expect(savingsMetric([month('a', 1000, 900), month('b', 1000, 900)]).score).toBe(50);
  });

  it('no mide con menos de 2 meses o sin ingresos', () => {
    expect(savingsMetric([month('a', 1000, 500)]).score).toBeNull();
    expect(savingsMetric([month('a', 0, 500), month('b', 0, 500)]).score).toBeNull();
  });

  it('solo mira los últimos 6 meses', () => {
    const old = [month('x1', 1000, 5000), month('x2', 1000, 5000)];
    expect(savingsMetric([...old, ...SIX]).value).toBeCloseTo(0.3889, 3);
  });
});

describe('emergencyMonthsTarget', () => {
  it('prioriza el objetivo explícito del perfil', () => {
    expect(emergencyMonthsTarget({ emergencyMonthsTarget: 10, incomeType: 'salaried' })).toEqual({ months: 10, assumed: false });
  });
  it('depende del tipo de ingreso y suma 2 meses con personas a cargo', () => {
    expect(emergencyMonthsTarget({ incomeType: 'salaried' }).months).toBe(4);
    expect(emergencyMonthsTarget({ incomeType: 'self_employed' }).months).toBe(9);
    expect(emergencyMonthsTarget({ incomeType: 'salaried', dependents: 2 }).months).toBe(6);
  });
  it('sin perfil usa 6 meses y lo marca como suposición', () => {
    expect(emergencyMonthsTarget({})).toEqual({ months: 6, assumed: true });
  });
});

describe('runwayMetric', () => {
  it('calcula meses de gasto cubiertos y se satura en 100', () => {
    const r = runwayMetric(base());
    expect(r.value).toBeCloseTo(20000 / 1100, 3);
    expect(r.score).toBe(100);
    expect(r.assumption).toContain('supuesto');
  });

  it('puntúa proporcional cuando no llega al objetivo', () => {
    const r = runwayMetric(base({ liquid: 3300, profile: { emergencyMonthsTarget: 6 } })); // 3 meses de 6
    expect(r.value).toBeCloseTo(3, 5);
    expect(r.score).toBe(50);
    expect(r.assumption).toBeNull();
  });

  it('el dinero apartado en objetivos NO cuenta como colchón, pero el fondo de emergencia sí', () => {
    const goals = [goal({ currentAmount: 2200, targetAmount: 3000 }), goal({ id: 2, name: 'Fondo de emergencia', currentAmount: 5000, targetAmount: 5000 })];
    expect(reservedForGoals(goals)).toBe(2200);
    const r = runwayMetric(base({ liquid: 5500, goals, profile: { emergencyMonthsTarget: 6 } }));
    expect(r.value).toBeCloseTo(3300 / 1100, 5);
  });

  it('lo que supera la meta de un objetivo no se considera apartado', () => {
    expect(reservedForGoals([goal({ currentAmount: 5000, targetAmount: 1000 })])).toBe(1000);
  });

  it('no mide sin gastos', () => {
    expect(runwayMetric(base({ months: [month('a', 1000, 0), month('b', 1000, 0)] })).score).toBeNull();
  });

  it('la liquidez nunca es negativa', () => {
    expect(runwayMetric(base({ liquid: 100, goals: [goal({ currentAmount: 900 })] })).value).toBe(0);
  });
});

describe('debtMetric', () => {
  it('sin deudas puntúa 100', () => {
    expect(debtMetric(base()).score).toBe(100);
  });
  it('ignora deudas ya saldadas', () => {
    expect(debtMetric(base({ debts: [{ name: 'x', remaining: 0, monthlyPayment: 500, interestRate: 3 }] })).score).toBe(100);
  });
  it('cuotas del 15 % puntúan 100 y del 40 % puntúan 0', () => {
    expect(debtMetric(base({ debts: [{ name: 'a', remaining: 5000, monthlyPayment: 270, interestRate: 3 }] })).score).toBe(100);
    expect(debtMetric(base({ debts: [{ name: 'a', remaining: 5000, monthlyPayment: 720, interestRate: 3 }] })).score).toBe(0);
  });
  it('penaliza 20 puntos las deudas de interés alto', () => {
    const low = debtMetric(base({ debts: [{ name: 'a', remaining: 5000, monthlyPayment: 270, interestRate: 3 }] })).score!;
    const high = debtMetric(base({ debts: [{ name: 'a', remaining: 5000, monthlyPayment: 270, interestRate: 18 }] })).score!;
    expect(low - high).toBe(20);
  });
  it('no mide el peso de la deuda sin ingresos', () => {
    expect(debtMetric(base({ months: [month('a', 0, 100), month('b', 0, 100)], debts: [{ name: 'a', remaining: 1, monthlyPayment: 1, interestRate: 1 }] })).score).toBeNull();
  });
});

describe('contributionsMetric', () => {
  it('aportar el 10 % cada mes puntúa 100', () => {
    const six = SIX.map((m) => ({ ...m, investmentContribution: 180 }));
    expect(contributionsMetric(six).score).toBe(100);
  });
  it('no aportar puntúa 0', () => {
    expect(contributionsMetric(SIX.map((m) => ({ ...m, investmentContribution: 0 }))).score).toBe(0);
  });
  it('la regularidad cuenta: mismo importe en menos meses puntúa menos', () => {
    const total = 1080; // 10 % de 10.800
    const spread = SIX.map((m) => ({ ...m, investmentContribution: total / 6 }));
    const lumpy = SIX.map((m, i) => ({ ...m, investmentContribution: i === 0 ? total : 0 }));
    expect(contributionsMetric(spread).score!).toBeGreaterThan(contributionsMetric(lumpy).score!);
  });
});

describe('stabilityMetric', () => {
  it('ingresos constantes puntúan 100', () => {
    expect(stabilityMetric(SIX, {}).score).toBe(100);
  });
  it('ingresos muy variables puntúan bajo', () => {
    const wild = [1000, 3000, 500, 2800, 700, 3200].map((i, k) => month(`m${k}`, i, 1000));
    expect(stabilityMetric(wild, {}).score!).toBeLessThan(20);
  });
  it('necesita al menos 3 meses', () => {
    expect(stabilityMetric(SIX.slice(0, 2), {}).score).toBeNull();
  });
});

describe('monthsToTarget / projectFi', () => {
  it('sin rentabilidad es una división simple', () => {
    expect(monthsToTarget(0, 1000, 0, 12000)).toBe(12);
  });
  it('ya alcanzado devuelve 0', () => {
    expect(monthsToTarget(500, 0, 0.04, 400)).toBe(0);
  });
  it('sin ahorro ni rentabilidad suficiente no se alcanza', () => {
    expect(monthsToTarget(1000, 0, 0, 5000)).toBeNull();
  });
  it('la rentabilidad acorta el plazo', () => {
    expect(monthsToTarget(10000, 500, 0.05, 100000)!).toBeLessThan(monthsToTarget(10000, 500, 0, 100000)!);
  });

  it('un perfil como el real: capital 30 k, ahorro 700/mes, gasto 1.100 -> ~21-22 años', () => {
    const fi = projectFi(base())!;
    expect(fi.annualExpense).toBeCloseTo(13200, 0);
    expect(fi.target).toBeCloseTo(330000, 0);
    expect(fi.monthlySavings).toBeCloseTo(700, 0);
    expect(fi.monthsCovered).toBeCloseTo(30000 / 1100, 3);
    expect(fi.yearsToFi!).toBeGreaterThan(20);
    expect(fi.yearsToFi!).toBeLessThan(23);
  });

  it('el dinero apartado en objetivos no cuenta como capital', () => {
    const fi = projectFi(base({ goals: [goal({ currentAmount: 1000, targetAmount: 1000 })] }))!;
    expect(fi.capital).toBe(29000);
  });

  it('usa el múltiplo y la rentabilidad del perfil', () => {
    const fi = projectFi(base({ profile: { fiTargetMultiple: 20, expectedRealReturnPct: 3 } }))!;
    expect(fi.target).toBeCloseTo(264000, 0);
    expect(fi.realReturnPct).toBe(3);
  });

  it('sin suficientes meses no proyecta', () => {
    expect(projectFi(base({ months: SIX.slice(0, 1) }))).toBeNull();
  });
});

describe('fiMetric', () => {
  it('con edad y meta puntúa 100 si va a tiempo', () => {
    const inp = base({ profile: { birthYear: 2000, fiTargetAge: 55 } }); // 26 años, meta en 29 años
    const r = fiMetric(inp, projectFi(inp));
    expect(r.score).toBe(100);
    expect(r.assumption).toContain('rentabilidad real supuesta');
    expect(r.assumption).not.toContain('sin edad objetivo');
  });
  it('con edad y meta puntúa menos si va tarde', () => {
    const inp = base({ profile: { birthYear: 2000, fiTargetAge: 45 } }); // meta en 19 años; proyección ~21,5
    const r = fiMetric(inp, projectFi(inp));
    expect(r.score!).toBeLessThan(100);
    expect(r.score!).toBeGreaterThan(80);
  });
  it('sin meta usa la referencia 15-40 años y lo dice', () => {
    const r = fiMetric(base(), projectFi(base()));
    expect(r.score!).toBeGreaterThan(60);
    expect(r.score!).toBeLessThan(90);
    expect(r.assumption).toContain('sin edad objetivo');
  });
  it('capital ya suficiente puntúa 100', () => {
    const inp = base({ liquid: 400000 });
    expect(fiMetric(inp, projectFi(inp)).score).toBe(100);
  });
  it('sin ahorro y capital pequeño: no se alcanza', () => {
    const months = SIX.map((m) => ({ ...m, income: 1000, expense: 1100 }));
    const inp = base({ months, liquid: 1000, invested: 0 });
    const r = fiMetric(inp, projectFi(inp));
    expect(r.score).toBe(0);
    expect(r.summary).toContain('no llegarías');
  });
  it('sin proyección no mide', () => {
    expect(fiMetric(base(), null).score).toBeNull();
  });
});

describe('cartera', () => {
  const targets = [pos(1, 'Fondo A', 5800, 58), pos(2, 'Fondo B', 1500, 15), pos(3, 'Fondo C', 1000, 10), pos(4, 'Fondo D', 1000, 10), pos(5, 'BTC', 500, 5, 'crypto'), pos(6, 'ETH', 200, 2, 'crypto')];

  it('sin desviación puntúa 100', () => {
    const r = portfolioMetric(targets);
    expect(r.score).toBe(100);
    expect(r.value!).toBeLessThan(0.001);
  });

  it('calcula la desviación y los euros que faltan en cada activo', () => {
    const a = analyzePortfolio([pos(1, 'A', 5000, 50), pos(2, 'B', 5000, 70)]);
    // actual 50/50 vs objetivo 41,7/58,3 (normalizado a 120 -> 100)
    expect(a.drift).toBeGreaterThan(0.05);
    const b = a.deviations.find((d) => d.assetId === 2)!;
    expect(b.gapEur).toBeGreaterThan(0);
  });

  it('un activo sin objetivo cuenta como desviación', () => {
    const a = analyzePortfolio([pos(1, 'A', 5000, 100), pos(2, 'B', 5000, null)]);
    expect(a.drift).toBeCloseTo(0.5, 5);
  });

  it('puntúa 0 a partir de 20 puntos de desviación', () => {
    const r = portfolioMetric([pos(1, 'A', 10000, 50), pos(2, 'B', 0, 50)]);
    expect(r.score).toBe(0);
  });

  it('sin objetivos mide la concentración y lo declara como suposición', () => {
    const r = portfolioMetric([pos(1, 'A', 9000, null), pos(2, 'B', 1000, null)]);
    expect(r.value).toBeCloseTo(0.9, 5);
    expect(r.score!).toBeLessThan(40);
    expect(r.assumption).toContain('concentración');
  });

  it('una cartera pequeña no se valora', () => {
    expect(portfolioMetric([pos(1, 'A', 500, 100)]).score).toBeNull();
  });
});

describe('goalsMetric', () => {
  it('sin objetivos con fecha no mide', () => {
    expect(goalsMetric([], NOW).score).toBeNull();
    expect(goalsMetric([goal({ targetDate: null })], NOW).score).toBeNull();
  });
  it('ignora el fondo de emergencia (ya se mide en el colchón)', () => {
    expect(goalsMetric([goal({ name: 'Fondo de emergencia' })], NOW).score).toBeNull();
  });
  it('va a ritmo si lo ahorrado acompaña al tiempo transcurrido', () => {
    // 1-ene -> 1-ene-27, hoy 15-oct: ~79 % del tiempo
    const r = goalsMetric([goal({ currentAmount: 800 })], NOW);
    expect(r.score!).toBeGreaterThanOrEqual(85);
  });
  it('va tarde si lo ahorrado es poco', () => {
    expect(goalsMetric([goal({ currentAmount: 100 })], NOW).score!).toBeLessThan(25);
  });
  it('vencido sin cumplir puntúa 0; cumplido puntúa 100', () => {
    expect(goalsMetric([goal({ targetDate: new Date(Date.UTC(2026, 5, 1)), currentAmount: 10 })], NOW).score).toBe(0);
    expect(goalsMetric([goal({ currentAmount: 1000 })], NOW).score).toBe(100);
  });
});

describe('computeHealth', () => {
  it('perfil sólido: score alto y sin foco urgente en lo básico', () => {
    const r = computeHealth(base({ positions: [pos(1, 'A', 5800, 58), pos(2, 'B', 4200, 42)] }));
    expect(r.score!).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe('excelente');
    expect(r.confidence).toBe('alta');
    expect(r.metrics).toHaveLength(8);
  });

  it('reparte los pesos entre lo medible: lo que no se puede medir no cuenta', () => {
    const r = computeHealth(base()); // sin cartera ni objetivos ni deudas medibles
    const na = r.metrics.filter((m) => m.score == null).map((m) => m.key).sort();
    expect(na).toEqual(['goals', 'portfolio']);
    const w = r.metrics.filter((m) => m.score != null);
    const manual = Math.round(w.reduce((s, m) => s + m.score! * m.weight, 0) / w.reduce((s, m) => s + m.weight, 0));
    expect(r.score).toBe(manual);
  });

  it('sin datos suficientes: score nulo y confianza baja', () => {
    const r = computeHealth(base({ months: [], liquid: 0, invested: 0 }));
    expect(r.score).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.confidence).toBe('baja');
    expect(r.fi).toBeNull();
  });

  it('los pilares agrupan las métricas', () => {
    const r = computeHealth(base());
    expect(r.pillars.map((p) => p.key)).toEqual(['resilience', 'habits', 'growth', 'portfolio', 'goals']);
    expect(r.pillars.find((p) => p.key === 'portfolio')!.score).toBeNull();
    expect(r.pillars.reduce((s, p) => s + p.weight, 0)).toBe(100);
  });

  it('señala como foco la métrica con más margen ponderado', () => {
    const r = computeHealth(base({ liquid: 1100, invested: 0 })); // colchón de 1 mes
    expect(r.focus?.metric).toBe('runway');
    expect(r.focus?.label).toBe('Colchón de emergencia');
    expect(r.focus?.reason).toContain('margen');
  });

  it('un mal mes de ahorro baja el score', () => {
    const bad = SIX.map((m) => ({ ...m, expense: 1900 }));
    expect(computeHealth(base({ months: bad })).score!).toBeLessThan(computeHealth(base()).score!);
  });

  it('recoge las suposiciones del perfil vacío', () => {
    const r = computeHealth(base());
    expect(r.assumptions.length).toBeGreaterThanOrEqual(2);
    expect(computeHealth(base({ profile: { incomeType: 'salaried', birthYear: 2000, fiTargetAge: 55, fiTargetMultiple: 25, expectedRealReturnPct: 4 } })).assumptions).toHaveLength(0);
  });
});

describe('insights', () => {
  const ids = (inp: HealthInputs) => computeHealth(inp).insights.map((i) => i.id);

  it('avisa del exceso de liquidez sobre el colchón objetivo', () => {
    const r = computeHealth(base({ profile: { incomeType: 'salaried' } })); // objetivo 4 x 1.100 = 4.400; hay 20.000
    const ins = r.insights.find((i) => i.id === 'liquidity_surplus')!;
    expect(ins).toBeDefined();
    expect(ins.amount).toBeCloseTo(20000 - 4400, 0);
    expect(ins.body).toContain('decisión tuya');
  });

  it('no avisa si la liquidez es razonable', () => {
    expect(ids(base({ liquid: 6000, profile: { incomeType: 'salaried' } }))).not.toContain('liquidity_surplus');
  });

  it('el dinero reservado para planes no cuenta como exceso', () => {
    const goals = [goal({ currentAmount: 15000, targetAmount: 15000 })];
    expect(ids(base({ goals, profile: { incomeType: 'salaried' } }))).not.toContain('liquidity_surplus');
  });

  it('sugiere dónde aportar según la desviación', () => {
    const inp = base({ positions: [pos(1, 'Fondo A', 8000, 50), pos(2, 'Fondo B', 2000, 50)] });
    const ins = computeHealth(inp).insights.find((i) => i.id === 'next_contribution')!;
    expect(ins.title).toContain('Fondo B');
    expect(ins.amount).toBeCloseTo(3000, 0);
  });

  it('avisa si la cripto supera el límite del perfil', () => {
    const inp = base({ positions: [pos(1, 'Fondo', 8000, null), pos(2, 'BTC', 2000, null, 'crypto')], profile: { riskTolerance: 2 } });
    expect(ids(inp)).toContain('crypto_cap');
    expect(ids({ ...inp, profile: { riskTolerance: 5 } })).not.toContain('crypto_cap');
  });

  it('avisa del ritmo de gasto del mes en curso', () => {
    const inp = base({ currentMonth: { income: 0, expense: 1200, investmentContribution: 0, daysElapsed: 10, daysInMonth: 30 } });
    const ins = computeHealth(inp).insights.find((i) => i.id === 'spend_pace')!;
    expect(ins).toBeDefined();
    expect(ins.severity).toBe('warning');
  });

  it('no avisa del ritmo con pocos días transcurridos ni con gasto normal', () => {
    expect(ids(base({ currentMonth: { income: 0, expense: 900, investmentContribution: 0, daysElapsed: 3, daysInMonth: 30 } }))).not.toContain('spend_pace');
    expect(ids(base({ currentMonth: { income: 0, expense: 370, investmentContribution: 0, daysElapsed: 10, daysInMonth: 30 } }))).not.toContain('spend_pace');
  });

  it('detecta una caída fuerte del ahorro el último mes', () => {
    const months = [...SIX.slice(0, 5), month('2026-09', 1800, 1750, 0)];
    expect(ids(base({ months }))).toContain('savings_drop');
    expect(ids(base())).not.toContain('savings_drop');
  });

  it('recuerda la aportación pendiente si es habitual y ya pasó el día 20', () => {
    const cm = { income: 1800, expense: 600, investmentContribution: 0, daysElapsed: 22, daysInMonth: 31 };
    expect(ids(base({ currentMonth: cm }))).toContain('contribution_pending');
    expect(ids(base({ currentMonth: { ...cm, daysElapsed: 10 } }))).not.toContain('contribution_pending');
    expect(ids(base({ currentMonth: { ...cm, investmentContribution: 500 } }))).not.toContain('contribution_pending');
  });

  it('avisa de objetivos vencidos', () => {
    const g = goal({ id: 7, targetDate: new Date(Date.UTC(2026, 8, 1)), currentAmount: 200 });
    expect(ids(base({ goals: [g] }))).toContain('goal_overdue_7');
  });

  it('ordena primero los avisos y limita a 6', () => {
    const inp = base({
      positions: [pos(1, 'Fondo A', 8000, 50), pos(2, 'Fondo B', 1500, 50), pos(3, 'BTC', 2500, null, 'crypto')],
      profile: { riskTolerance: 1, incomeType: 'salaried' },
      currentMonth: { income: 0, expense: 1500, investmentContribution: 0, daysElapsed: 10, daysInMonth: 30 },
      goals: [goal({ id: 9, targetDate: new Date(Date.UTC(2026, 8, 1)), currentAmount: 10 })],
    });
    const list = computeHealth(inp).insights;
    expect(list.length).toBeLessThanOrEqual(6);
    expect(list[0].severity).toBe('warning');
  });
});

describe('simulate', () => {
  it('gastar menos acelera la independencia financiera y mejora el colchón', () => {
    const r = simulate(base(), { extraMonthlySavings: 200 });
    expect(r.scenario.monthlySavings!).toBeCloseTo(900, 0);
    expect(r.delta.yearsToFi!).toBeLessThan(0);
  });

  it('un gasto puntual reduce los meses de colchón', () => {
    const r = simulate(base({ profile: { emergencyMonthsTarget: 6 } }), { oneOffExpense: 11000 });
    expect(r.delta.runwayMonths!).toBeCloseTo(-10, 0);
  });

  it('un gasto puntual enorme no deja la liquidez negativa', () => {
    const r = simulate(base(), { oneOffExpense: 1e9 });
    expect(r.scenario.runwayMonths).toBe(0);
  });

  it('no cambia nada sin escenario', () => {
    const r = simulate(base(), {});
    expect(r.delta).toEqual({ score: 0, runwayMonths: 0, yearsToFi: 0 });
  });

  it('ignora cantidades negativas', () => {
    expect(simulate(base(), { extraMonthlySavings: -500, oneOffExpense: -500 }).delta.yearsToFi).toBe(0);
  });

  it('no muta los datos de entrada', () => {
    const inp = base();
    const copy = JSON.stringify(inp);
    simulate(inp, { extraMonthlySavings: 300, oneOffExpense: 1000, extraMonthlyInvestment: 100 });
    expect(JSON.stringify(inp)).toBe(copy);
  });
});

describe('ajustes de utilidad', () => {
  it('estabilidad: hasta ~10 % de variación entre meses puntúa 100, y baja a partir de ahí', () => {
    const mk = (spread: number) => [1, -1, 1, -1, 1, -1].map((s, i) => month(`m${i}`, 1800 * (1 + s * spread), 1000));
    expect(stabilityMetric(mk(0.08), {}).score).toBe(100);
    expect(stabilityMetric(mk(0.225), {}).score!).toBeGreaterThan(40);
    expect(stabilityMetric(mk(0.225), {}).score!).toBeLessThan(60);
    expect(stabilityMetric(mk(0.4), {}).score).toBe(0);
  });

  it('aportaciones: muestra la media mensual y explica cuándo superan los ingresos', () => {
    const months = SIX.map((m, i) => ({ ...m, investmentContribution: i === 0 ? 12000 : 500 })); // 14.500 aportados con 10.800 ingresados
    const r = contributionsMetric(months);
    expect(r.summary).toContain('al mes');
    expect(r.summary).toContain('traspasos desde tu ahorro');
    expect(contributionsMetric(SIX).summary).not.toContain('traspasos');
  });

  it('no señala un foco cuando no hay nada que pueda sumar al menos 3 puntos', () => {
    // Con la independencia financiera ya alcanzada y el resto en orden, nada puede sumar 3 puntos.
    const r = computeHealth(base({ liquid: 400000, positions: [pos(1, 'A', 5800, 58), pos(2, 'B', 4200, 42)] }));
    expect(r.focus).toBeNull();
  });

  it('el aviso de ahorro bajo usa el mes en castellano', () => {
    const months = [...SIX.slice(0, 5), month('2026-09', 1800, 1750, 0)];
    const ins = computeHealth(base({ months })).insights.find((i) => i.id === 'savings_drop')!;
    expect(ins.title).toContain('septiembre de 2026');
    expect(ins.title).not.toContain('2026-09');
  });

  it('el aviso de liquidez no afirma que el dinero pierda valor: depende de si rinde', () => {
    const ins = computeHealth(base({ profile: { incomeType: 'salaried' } })).insights.find((i) => i.id === 'liquidity_surplus')!;
    expect(ins.body).toContain('Si no te rinde');
  });
});

describe('palancas', () => {
  it('muestran cuántos años adelanta cada cambio, de forma coherente con la simulación', () => {
    const inp = base();
    const r = computeHealth(inp);
    expect(r.levers.map((l) => l.id)).toEqual(['cut_spend_10', 'save_100']);
    const cut = r.levers[0];
    expect(cut.monthlyImpact).toBeCloseTo(110, 0);
    const sim = simulate(inp, { extraMonthlySavings: cut.monthlyImpact });
    expect(cut.yearsSooner!).toBeCloseTo(-(sim.delta.yearsToFi as number), 0);
    expect(cut.yearsSooner!).toBeGreaterThan(0);
    expect(r.levers[1].yearsSooner!).toBeGreaterThan(0);
  });

  it('no hay palancas si ya se alcanzó la independencia, si no se puede proyectar o si no se llega nunca', () => {
    expect(computeHealth(base({ liquid: 400000 })).levers).toEqual([]);
    expect(computeHealth(base({ months: [] })).levers).toEqual([]);
    const poor = SIX.map((m) => ({ ...m, income: 1000, expense: 1100 }));
    expect(computeHealth(base({ months: poor, liquid: 500, invested: 0 })).levers).toEqual([]);
  });

  it('el informe sigue siendo finito: simular no recalcula palancas (sin recursión)', () => {
    expect(() => simulate(base(), { extraMonthlySavings: 100 })).not.toThrow();
  });
});
