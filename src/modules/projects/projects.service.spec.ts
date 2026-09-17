import { ProjectsService } from './projects.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

describe('ProjectsService — isCapitalReturn en movimientos manuales', () => {
  const prisma = {
    project: { findFirst: jest.fn(async () => ({ id: 1 })) },
    projectPartner: { findFirst: jest.fn(async () => ({ id: 10 })) },
    projectManualEntry: {
      create: jest.fn(async ({ data }: any) => ({ id: 100, ...data })),
    },
  };
  const service = new ProjectsService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('por defecto una retirada se clasifica como beneficio (isCapitalReturn=false)', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Reparto de beneficios',
      amount: 100,
      date: '2026-01-01',
      partnerId: 10,
    } as any);

    expect(result.isCapitalReturn).toBe(false);
  });

  it('persiste isCapitalReturn=true para una devolución de capital', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Devolución de capital',
      amount: 500,
      date: '2026-01-01',
      partnerId: 10,
      isCapitalReturn: true,
    } as any);

    expect(result.isCapitalReturn).toBe(true);
  });
});

describe('ProjectsService — desglose de retiradas por tipo', () => {
  const prisma = {
    project: { findMany: jest.fn(async () => [{ id: 1 }]) },
    transaction: { groupBy: jest.fn(async () => []) },
    projectManualEntry: {
      groupBy: jest.fn(async () => [
        { projectId: 1, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 300 } },
        { projectId: 1, kind: 'withdrawal', isCapitalReturn: true, _sum: { amount: 200 } },
      ]),
    },
    projectPartner: { findMany: jest.fn(async () => []) },
  };
  const service = new ProjectsService(prisma as any);

  it('separa retiradas de beneficio y capital, manteniendo el total combinado', async () => {
    const [project] = await service.findAll(1);
    expect(project.financials.withdrawalsProfit).toBe(300);
    expect(project.financials.withdrawalsCapital).toBe(200);
    expect(project.financials.withdrawals).toBe(500);
  });
});
