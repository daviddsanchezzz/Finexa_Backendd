import { sumInBaseCurrency } from './investment-currency-totals';

describe('sumInBaseCurrency', () => {
  it('todos los activos en la moneda base: suma directa', async () => {
    const currencyService = { getCurrentRate: jest.fn() } as any;
    const total = await sumInBaseCurrency([{ value: 100, currency: 'EUR' }, { value: 50, currency: 'EUR' }], 'EUR', currencyService);
    expect(total).toBe(150);
    expect(currencyService.getCurrentRate).not.toHaveBeenCalled();
  });

  it('un activo en otra moneda: convierte al tipo actual', async () => {
    const currencyService = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => 0.9393 }) } as any;
    const total = await sumInBaseCurrency([{ value: 100, currency: 'EUR' }, { value: 1000, currency: 'USD' }], 'EUR', currencyService);
    expect(currencyService.getCurrentRate).toHaveBeenCalledWith('USD', 'EUR');
    expect(total).toBeCloseTo(100 + 1000 * 0.9393, 2);
  });

  it('un activo con moneda sin tipo de cambio disponible suma su valor sin convertir, sin romper el total', async () => {
    const currencyService = { getCurrentRate: jest.fn().mockRejectedValue(new Error('No hay tipo de cambio EUR->ZZZ disponible.')) } as any;
    const total = await sumInBaseCurrency([{ value: 100, currency: 'EUR' }, { value: 50, currency: 'ZZZ' }], 'EUR', currencyService);
    expect(total).toBe(150);
  });
});
