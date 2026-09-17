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

describe('ProjectsService — mi beneficio según mi participación', () => {
  const prisma = {
    project: { findMany: jest.fn(async () => [{ id: 1 }, { id: 2 }]) },
    transaction: {
      groupBy: jest.fn(async () => [
        { projectId: 1, type: 'income', _sum: { amount: 2931.86 } },
        { projectId: 1, type: 'expense', _sum: { amount: 742.2 } },
      ]),
    },
    projectManualEntry: {
      groupBy: jest.fn(async ({ by }: any) => {
        if (by.includes('partnerId')) {
          return [{ partnerId: 50, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 400 } }];
        }
        return [];
      }),
    },
    projectPartner: {
      findMany: jest.fn(async ({ where }: any) =>
        where.isMe ? [{ id: 50, projectId: 1, percentage: 50 }] : [{ id: 50, projectId: 1 }],
      ),
    },
  };
  const service = new ProjectsService(prisma as any);

  it('calcula mi beneficio como resultado del proyecto * mi porcentaje', async () => {
    const projects = await service.findAll(1);
    const projectA = projects.find((p) => p.id === 1)!;

    expect(projectA.financials.result).toBeCloseTo(2189.66, 2);
    expect(projectA.financials.myPercentage).toBe(50);
    expect(projectA.financials.myProfit).toBeCloseTo(1094.83, 2);
    expect(projectA.financials.myWithdrawnProfit).toBe(400);
    expect(projectA.financials.myPending).toBeCloseTo(694.83, 2);
  });

  it('asume 100% cuando el proyecto no tiene ningún socio configurado', async () => {
    const projects = await service.findAll(1);
    const projectB = projects.find((p) => p.id === 2)!;

    expect(projectB.financials.myPercentage).toBe(100);
    expect(projectB.financials.myProfit).toBe(0);
    expect(projectB.financials.myWithdrawnProfit).toBe(0);
  });
});

describe('ProjectsService — desglose de retiradas por socio en el detalle', () => {
  const prisma = {
    project: {
      findFirst: jest.fn(async () => ({
        id: 1,
        transactions: [],
        manualEntries: [],
        partners: [{ id: 50, name: 'Yo', percentage: 100, isMe: true }],
      })),
    },
    transaction: { groupBy: jest.fn(async () => []) },
    projectManualEntry: {
      groupBy: jest.fn(async () => [
        { partnerId: 50, kind: 'contribution', isCapitalReturn: false, _sum: { amount: 500 } },
        { partnerId: 50, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 300 } },
        { partnerId: 50, kind: 'withdrawal', isCapitalReturn: true, _sum: { amount: 500 } },
      ]),
    },
    projectPartner: {
      findMany: jest.fn(async ({ where }: any) =>
        where.isMe ? [{ id: 50, projectId: 1, percentage: 100 }] : [{ id: 50 }],
      ),
    },
  };
  const service = new ProjectsService(prisma as any);

  it('separa retirado de beneficio y capital devuelto para cada socio', async () => {
    const detail = await service.findOne(1, 1);
    const [partner] = detail.partners;

    expect(partner.contributed).toBe(500);
    expect(partner.withdrawnProfit).toBe(300);
    expect(partner.capitalReturned).toBe(500);
    expect((partner as any).withdrawn).toBeUndefined();
  });
});
