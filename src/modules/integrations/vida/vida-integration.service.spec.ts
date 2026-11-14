import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { VidaIntegrationService } from './vida-integration.service';

const build = (overrides: any = {}) => {
  const prisma: any = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 5 }), findUnique: jest.fn().mockResolvedValue({ name: 'Ana', currency: 'EUR' }) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides.prisma,
  };
  const dashboard: any = { getNetWorth: jest.fn().mockResolvedValue({ total: 31096.23, currency: 'EUR', wallets: [] }) };
  const investments: any = {
    getSummary: jest.fn().mockResolvedValue({ totalCurrentValue: 9892.47, totalNetContributed: 9000, totalPnL: 892.47, returnPct: 0.0991, asOf: 'x', assets: [] }),
  };
  const monthData: any = { findAll: jest.fn().mockResolvedValue([{ year: 2026, month: 9, finalBalance: 29935.67 }]) };
  const service = new VidaIntegrationService(prisma, dashboard, investments, {} as any, {} as any, {} as any, monthData);
  return { service, prisma, dashboard, monthData };
};

describe('VidaIntegrationService', () => {
  const email = process.env.VIDA_INTEGRATION_USER_EMAIL;
  beforeEach(() => { process.env.VIDA_INTEGRATION_USER_EMAIL = 'yo@example.com'; });
  afterAll(() => { if (email === undefined) delete process.env.VIDA_INTEGRATION_USER_EMAIL; else process.env.VIDA_INTEGRATION_USER_EMAIL = email; });

  it('falla si no hay usuario configurado o no existe', async () => {
    delete process.env.VIDA_INTEGRATION_USER_EMAIL;
    await expect(build().service.ping()).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.VIDA_INTEGRATION_USER_EMAIL = 'otro@example.com';
    const { service } = build({ prisma: { user: { findFirst: jest.fn().mockResolvedValue(null) } } });
    await expect(service.ping()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza meses con formato inválido', async () => {
    await expect(build().service.transactions({ month: '2026-99' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo consulta datos del usuario configurado y excluye plantillas en los movimientos', async () => {
    const { service, prisma } = build();
    await service.transactions({ month: '2026-11', limit: 9999 });
    const args = prisma.transaction.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: 5, active: true, isRecurring: false });
    expect(args.take).toBe(500);
  });

  it('calcula la variación del patrimonio frente al cierre del mes anterior', async () => {
    const { service } = build();
    const month = new Date().toISOString().slice(0, 7);
    // El cierre de prueba solo aplica a un mes concreto: se fuerza el mes actual con su anterior.
    const [y, m] = month.split('-').map(Number);
    const prev = new Date(Date.UTC(y, m - 2, 1));
    (service as any).monthData.findAll = jest.fn().mockResolvedValue([{ year: prev.getUTCFullYear(), month: prev.getUTCMonth(), finalBalance: 29935.67 }]);
    const o = await service.overview();
    expect(o.netWorth.monthDelta).toBe(1160.56);
    expect(o.netWorth.monthDeltaPct).toBe(3.88);
    expect(o.investments.currentValue).toBe(9892.47);
    expect(o.investments.returnPct).toBe(9.91);
  });

  it('no inventa variación para meses pasados', async () => {
    const o = await build().service.overview('2020-01');
    expect(o.netWorth.monthDelta).toBeNull();
  });
});
