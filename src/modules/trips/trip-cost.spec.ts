import { sumPlanItemsCost, tripCostInBase } from './trip-cost';

describe('sumPlanItemsCost', () => {
  it('todos los items en la moneda del viaje: suma directa', async () => {
    const currencyService = { convert: jest.fn() } as any;
    const total = await sumPlanItemsCost(
      [{ cost: 100, currency: 'EUR' }, { cost: 50, currency: null }],
      'EUR',
      currencyService,
    );
    expect(total).toBe(150);
    expect(currencyService.convert).not.toHaveBeenCalled();
  });

  it('un item en otra moneda: se convierte con el tipo historico de su dia', async () => {
    const day = new Date('2026-09-01');
    const currencyService = { convert: jest.fn().mockResolvedValue({ toNumber: () => 46.5 }) } as any;
    const total = await sumPlanItemsCost([{ cost: 100, currency: 'EUR' }, { cost: 50, currency: 'CHF', day }], 'EUR', currencyService);
    expect(currencyService.convert).toHaveBeenCalledWith(50, 'CHF', 'EUR', day);
    expect(total).toBe(146.5);
  });

  it('ignora items sin coste', async () => {
    const currencyService = { convert: jest.fn() } as any;
    const total = await sumPlanItemsCost([{ cost: null, currency: 'EUR' }], 'EUR', currencyService);
    expect(total).toBe(0);
  });

  it('un item con moneda sin tipo de cambio disponible no rompe la suma del resto (no inventa el importe, lo omite)', async () => {
    const currencyService = {
      convert: jest.fn(async (amount: number, from: string) => {
        if (from === 'ZZZ') throw new Error('No hay tipo de cambio EUR->ZZZ disponible.');
        return { toNumber: () => amount };
      }),
    } as any;

    const total = await sumPlanItemsCost(
      [{ cost: 100, currency: 'EUR' }, { cost: 50, currency: 'ZZZ' }, { cost: 20, currency: 'EUR' }],
      'EUR',
      currencyService,
    );

    // 50 ZZZ se omite (no se inventa un tipo de cambio), pero 100+20 EUR sí suman.
    expect(total).toBe(120);
  });
});

describe('tripCostInBase', () => {
  it('misma moneda: no llama a CurrencyService', async () => {
    const currencyService = { getCurrentRate: jest.fn() } as any;
    const cost = await tripCostInBase(1500, 'EUR', 'EUR', currencyService);
    expect(cost).toBe(1500);
    expect(currencyService.getCurrentRate).not.toHaveBeenCalled();
  });

  it('convierte con el tipo actual cuando la moneda del viaje difiere de la base', async () => {
    const currencyService = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => 0.92 }) } as any;
    const cost = await tripCostInBase(1500, 'USD', 'EUR', currencyService);
    expect(currencyService.getCurrentRate).toHaveBeenCalledWith('USD', 'EUR');
    expect(cost).toBeCloseTo(1500 * 0.92, 2);
  });

  it('si CurrencyService falla, devuelve el coste sin convertir en vez de romper', async () => {
    const currencyService = { getCurrentRate: jest.fn().mockRejectedValue(new Error('caido')) } as any;
    const cost = await tripCostInBase(1500, 'ZZZ', 'EUR', currencyService);
    expect(cost).toBe(1500);
  });
});
