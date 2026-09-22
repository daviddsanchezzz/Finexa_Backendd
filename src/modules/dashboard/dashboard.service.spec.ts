import { DashboardService } from './dashboard.service';

describe('DashboardService.getNetWorth', () => {
  function build(wallets: any[], userCurrency: string, rate = 0.9393) {
    const prisma: any = {
      wallet: { findMany: jest.fn().mockResolvedValue(wallets) },
      user: { findUnique: jest.fn().mockResolvedValue({ currency: userCurrency }) },
    };
    const currency: any = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => rate, times: (n: number) => ({ toNumber: () => n * rate }) }) };
    return { service: new DashboardService(prisma, currency), prisma, currency };
  }

  it('todas las carteras en la moneda base: suma directa, sin llamar a CurrencyService', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(result).toEqual({
      total: 150,
      currency: 'EUR',
      wallets: [
        { id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR', balanceInBase: 100 },
        { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR', balanceInBase: 50 },
      ],
    });
    expect(currency.getCurrentRate).not.toHaveBeenCalled();
  });

  it('cartera en otra moneda: convierte al tipo actual', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Revolut CHF', emoji: '💳', balance: 2000, currency: 'CHF' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(currency.getCurrentRate).toHaveBeenCalledWith('CHF', 'EUR');
    expect(result.total).toBeCloseTo(100 + 2000 * 0.9393, 2);
    expect(result.wallets[1].balanceInBase).toBeCloseTo(2000 * 0.9393, 2);
  });
});
