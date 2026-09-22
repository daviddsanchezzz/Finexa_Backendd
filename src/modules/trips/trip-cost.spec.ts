import { sumPlanItemsCost } from './trip-cost';

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
});
