import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { AttachProjectTransactionsDto } from './dto/attach-project-transactions.dto';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import {
  CreateProjectManualEntryDto,
  UpdateProjectManualEntryDto,
} from './dto/project-manual-entry.dto';
import {
  DistributeProjectProfitDto,
  UpsertProjectPartnersDto,
} from './dto/project-partners.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  private toDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} no es una fecha valida`);
    }
    return parsed;
  }

  private async assertOwnership(userId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });

    if (!project) {
      throw new ForbiddenException('No tienes acceso a este proyecto');
    }

    return true;
  }

  private emptyFinancials() {
    return {
      transactionsIncome: 0,
      transactionsExpense: 0,
      manualIncome: 0,
      manualExpense: 0,
      income: 0,
      expense: 0,
      result: 0,
      contributions: 0,
      withdrawals: 0,
      withdrawalsProfit: 0,
      withdrawalsCapital: 0,
      cash: 0,
      myPercentage: 100,
      myProfit: 0,
      myWithdrawnProfit: 0,
      myCapitalContributed: 0,
      myCapitalReturned: 0,
      myPending: 0,
    };
  }

  // Deja claramente separados: resultado (income - expense, el P&L del
  // proyecto) de caja (lo que realmente queda dentro, incluyendo capital de
  // socios). Aportaciones/retiradas nunca tocan income/expense/result.
  private async buildFinancialsMap(userId: number, projectIds: number[]) {
    if (!projectIds.length) return new Map<number, ReturnType<typeof this.emptyFinancials>>();

    const [txGrouped, manualGrouped] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['projectId', 'type'],
        where: {
          userId,
          active: true,
          projectId: { in: projectIds },
          type: { in: ['income', 'expense'] },
        },
        _sum: { amount: true },
      }),
      this.prisma.projectManualEntry.groupBy({
        by: ['projectId', 'kind', 'isCapitalReturn'],
        where: {
          projectId: { in: projectIds },
        },
        _sum: { amount: true },
      }),
    ]);

    const map = new Map<number, ReturnType<typeof this.emptyFinancials>>();
    for (const projectId of projectIds) {
      map.set(projectId, this.emptyFinancials());
    }

    for (const row of txGrouped) {
      if (!row.projectId) continue;
      const data = map.get(row.projectId);
      if (!data) continue;
      const value = Number(row._sum.amount || 0);
      if (row.type === 'income') data.transactionsIncome = value;
      if (row.type === 'expense') data.transactionsExpense = value;
    }

    for (const row of manualGrouped) {
      const data = map.get(row.projectId);
      if (!data) continue;
      const value = Number(row._sum.amount || 0);
      if (row.kind === 'income') data.manualIncome = value;
      if (row.kind === 'expense') data.manualExpense = value;
      if (row.kind === 'contribution') data.contributions += value;
      if (row.kind === 'withdrawal' && !row.isCapitalReturn) data.withdrawalsProfit += value;
      if (row.kind === 'withdrawal' && row.isCapitalReturn) data.withdrawalsCapital += value;
    }

    for (const [, data] of map) {
      data.income = data.transactionsIncome + data.manualIncome;
      data.expense = data.transactionsExpense + data.manualExpense;
      data.result = data.income - data.expense;
      data.withdrawals = data.withdrawalsProfit + data.withdrawalsCapital;
      data.cash = data.contributions + data.income - data.expense - data.withdrawals;
    }

    return map;
  }

  // Socio marcado isMe por proyecto, con su porcentaje. Si el proyecto no
  // tiene ningún socio configurado, se asume que el usuario es dueño al
  // 100% (partnerId=-1 no existe nunca, así que buildPartnerLedgerMap
  // devuelve ceros para él, que es justo lo que corresponde: sin socios no
  // puede haber aportaciones/retiradas registradas).
  private async buildMyPartnerByProject(projectIds: number[]) {
    const map = new Map<number, { id: number; percentage: number }>();
    for (const projectId of projectIds) map.set(projectId, { id: -1, percentage: 100 });

    if (!projectIds.length) return map;

    const partners = await this.prisma.projectPartner.findMany({
      where: { projectId: { in: projectIds }, isMe: true },
      select: { id: true, projectId: true, percentage: true },
    });

    for (const partner of partners) {
      map.set(partner.projectId, { id: partner.id, percentage: partner.percentage });
    }

    return map;
  }

  // Aportado/retirado-de-beneficio/capital-devuelto por socio (todos los
  // socios de los proyectos dados, no solo "yo"). Lo reutilizan tanto el
  // cálculo de "mi beneficio" (aquí, filtrando por el socio isMe) como el
  // desglose por socio del detalle del proyecto.
  private async buildPartnerLedgerMap(projectIds: number[]) {
    const empty = () => ({ contributed: 0, withdrawnProfit: 0, capitalReturned: 0 });
    const map = new Map<number, ReturnType<typeof empty>>();
    if (!projectIds.length) return map;

    const partners = await this.prisma.projectPartner.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true },
    });
    if (!partners.length) return map;

    for (const partner of partners) map.set(partner.id, empty());

    const partnerIds = partners.map((p) => p.id);
    const rows = await this.prisma.projectManualEntry.groupBy({
      by: ['partnerId', 'kind', 'isCapitalReturn'],
      where: { partnerId: { in: partnerIds } },
      _sum: { amount: true },
    });

    for (const row of rows) {
      if (row.partnerId == null) continue;
      const entry = map.get(row.partnerId);
      if (!entry) continue;
      const value = Number(row._sum.amount || 0);
      if (row.kind === 'contribution') entry.contributed += value;
      if (row.kind === 'withdrawal' && !row.isCapitalReturn) entry.withdrawnProfit += value;
      if (row.kind === 'withdrawal' && row.isCapitalReturn) entry.capitalReturned += value;
    }

    return map;
  }

  // Punto único donde se combina el resultado del proyecto
  // (buildFinancialsMap) con la posición personal del usuario (su % y su
  // ledger de aportaciones/retiradas). Lo usan findAll y findOne, así el
  // listado y el detalle nunca pueden desincronizarse en cómo calculan "mi
  // beneficio".
  private async attachFinancials<T extends { id: number }>(userId: number, projects: T[]) {
    const projectIds = projects.map((p) => p.id);
    const [financialsMap, myPartnerMap, ledgerMap] = await Promise.all([
      this.buildFinancialsMap(userId, projectIds),
      this.buildMyPartnerByProject(projectIds),
      this.buildPartnerLedgerMap(projectIds),
    ]);

    return projects.map((project) => {
      const financials = financialsMap.get(project.id)!;
      const myPartner = myPartnerMap.get(project.id)!;
      const ledger = ledgerMap.get(myPartner.id) ?? { contributed: 0, withdrawnProfit: 0, capitalReturned: 0 };
      const myProfit = financials.result * (myPartner.percentage / 100);

      return {
        ...project,
        financials: {
          ...financials,
          myPercentage: myPartner.percentage,
          myProfit,
          myWithdrawnProfit: ledger.withdrawnProfit,
          myCapitalContributed: ledger.contributed,
          myCapitalReturned: ledger.capitalReturned,
          myPending: myProfit - ledger.withdrawnProfit,
        },
      };
    });
  }

  private validateDistributionLines(totalAmount: number, lines: { amount: number }[]) {
    if (!lines?.length) {
      throw new BadRequestException('Debes añadir al menos un socio en el reparto');
    }

    const sum = lines.reduce((acc, line) => acc + Number(line.amount || 0), 0);
    const roundedTotal = Math.round(totalAmount * 100);
    const roundedSum = Math.round(sum * 100);

    if (roundedTotal !== roundedSum) {
      throw new BadRequestException(
        `La suma de líneas (${sum.toFixed(2)}) debe coincidir con el total (${totalAmount.toFixed(2)})`,
      );
    }
  }

  // partnerId solo tiene sentido (y es obligatorio) para movimientos de
  // capital (contribution/withdrawal); para income/expense siempre es null.
  private async resolvePartnerId(
    projectId: number,
    kind: string,
    partnerId: number | null | undefined,
  ): Promise<number | null> {
    const needsPartner = kind === 'contribution' || kind === 'withdrawal';
    if (!needsPartner) return null;

    if (partnerId == null) {
      throw new BadRequestException('Selecciona el socio para este movimiento');
    }

    const partner = await this.prisma.projectPartner.findFirst({
      where: { id: partnerId, projectId },
      select: { id: true },
    });

    if (!partner) {
      throw new BadRequestException('El socio no pertenece a este proyecto');
    }

    return partnerId;
  }

  async create(userId: number, dto: CreateProjectDto) {
    const startDate = this.toDate(dto.startDate, 'startDate');
    const endDate = dto.endDate ? this.toDate(dto.endDate, 'endDate') : null;

    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate no puede ser anterior a startDate');
    }

    const project = await this.prisma.project.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        type: dto.type?.trim() || null,
        status: dto.status,
        startDate,
        endDate,
        notes: dto.notes?.trim() || null,
      },
    });

    return {
      ...project,
      financials: this.emptyFinancials(),
    };
  }

  async findAll(userId: number) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return this.attachFinancials(userId, projects);
  }

  async findOne(userId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        transactions: {
          where: { active: true },
          include: {
            category: true,
            subcategory: true,
            wallet: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { date: 'desc' },
        },
        manualEntries: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        },
        partners: {
          orderBy: [{ isMe: 'desc' }, { name: 'asc' }],
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    const [withFinancials, ledgerMap] = await Promise.all([
      this.attachFinancials(userId, [project]),
      this.buildPartnerLedgerMap([projectId]),
    ]);

    const { financials } = withFinancials[0];

    const partners = project.partners.map((partner) => {
      const ledger = ledgerMap.get(partner.id) ?? { contributed: 0, withdrawnProfit: 0, capitalReturned: 0 };
      return {
        ...partner,
        contributed: ledger.contributed,
        withdrawnProfit: ledger.withdrawnProfit,
        capitalReturned: ledger.capitalReturned,
      };
    });

    return {
      ...project,
      partners,
      financials,
    };
  }

  async update(userId: number, projectId: number, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!existing) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    const nextStartDate = dto.startDate
      ? this.toDate(dto.startDate, 'startDate')
      : existing.startDate;
    const nextEndDate = dto.endDate
      ? this.toDate(dto.endDate, 'endDate')
      : dto.endDate === null
      ? null
      : existing.endDate;

    if (nextEndDate && nextEndDate < nextStartDate) {
      throw new BadRequestException('endDate no puede ser anterior a startDate');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        type: dto.type !== undefined ? dto.type?.trim() || null : undefined,
        status: dto.status,
        startDate: dto.startDate ? nextStartDate : undefined,
        endDate:
          dto.endDate !== undefined
            ? dto.endDate
              ? nextEndDate
              : null
            : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
      },
    });
  }

  async remove(userId: number, projectId: number) {
    await this.assertOwnership(userId, projectId);

    await this.prisma.transaction.updateMany({
      where: { userId, projectId },
      data: { projectId: null },
    });

    await this.prisma.project.delete({ where: { id: projectId } });

    return { success: true };
  }

  async attachTransactions(
    userId: number,
    projectId: number,
    dto: AttachProjectTransactionsDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const result = await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
        active: true,
        type: { in: ['income', 'expense'] },
      },
      data: { projectId },
    });

    return { success: true, updated: result.count };
  }

  async detachTransactions(
    userId: number,
    projectId: number,
    dto: AttachProjectTransactionsDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const result = await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
        active: true,
        projectId,
      },
      data: { projectId: null },
    });

    return { success: true, updated: result.count };
  }

  async createManualEntry(
    userId: number,
    projectId: number,
    dto: CreateProjectManualEntryDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const partnerId = await this.resolvePartnerId(projectId, dto.kind, dto.partnerId);

    return this.prisma.projectManualEntry.create({
      data: {
        projectId,
        kind: dto.kind,
        isCapitalReturn: dto.isCapitalReturn ?? false,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        amount: dto.amount,
        date: this.toDate(dto.date, 'date'),
        category: dto.category?.trim() || null,
        notes: dto.notes?.trim() || null,
        partnerId,
      },
    });
  }

  async updateManualEntry(
    userId: number,
    projectId: number,
    entryId: number,
    dto: UpdateProjectManualEntryDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectManualEntry.findFirst({
      where: { id: entryId, projectId },
    });

    if (!existing) {
      throw new NotFoundException('Movimiento manual no encontrado');
    }

    const nextKind = dto.kind ?? existing.kind;
    const requestedPartnerId =
      dto.partnerId !== undefined ? dto.partnerId : existing.partnerId;
    const partnerId = await this.resolvePartnerId(projectId, nextKind, requestedPartnerId);

    return this.prisma.projectManualEntry.update({
      where: { id: entryId },
      data: {
        kind: dto.kind,
        isCapitalReturn: dto.isCapitalReturn,
        title: dto.title?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        amount: dto.amount,
        date: dto.date ? this.toDate(dto.date, 'date') : undefined,
        category: dto.category !== undefined ? dto.category?.trim() || null : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        partnerId,
      },
    });
  }

  async removeManualEntry(userId: number, projectId: number, entryId: number) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectManualEntry.findFirst({
      where: { id: entryId, projectId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Movimiento manual no encontrado');
    }

    await this.prisma.projectManualEntry.delete({ where: { id: entryId } });

    return { success: true };
  }

  // Reemplaza a los socios existentes por id cuando se indica (preservando el
  // vínculo con su historial de aportaciones/retiradas), crea los que no
  // traen id, y borra los que ya no vienen en la lista. Un deleteMany +
  // createMany a ciegas (como antes) generaría ids nuevos en cada edición y
  // rompería ese vínculo cada vez que se guardaran los socios.
  async upsertPartners(
    userId: number,
    projectId: number,
    dto: UpsertProjectPartnersDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const normalized = dto.partners.map((partner) => ({
      id: partner.id,
      name: partner.name.trim(),
      percentage: Number(partner.percentage),
      isMe: !!partner.isMe,
    }));

    if (normalized.some((partner) => !partner.name)) {
      throw new BadRequestException('Todos los socios deben tener nombre');
    }

    const totalPercentage = normalized.reduce(
      (acc, partner) => acc + Number(partner.percentage || 0),
      0,
    );
    if (Math.round(totalPercentage * 100) !== 10000) {
      throw new BadRequestException(
        `El porcentaje total debe ser 100%. Actual: ${totalPercentage.toFixed(2)}%`,
      );
    }

    const meCount = normalized.filter((partner) => partner.isMe).length;
    if (meCount !== 1) {
      throw new BadRequestException('Debe existir exactamente un socio marcado como tú');
    }

    const existing = await this.prisma.projectPartner.findMany({
      where: { projectId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((partner) => partner.id));
    const incomingIds = new Set(
      normalized.filter((partner) => partner.id != null).map((partner) => partner.id as number),
    );

    for (const partner of normalized) {
      if (partner.id != null && !existingIds.has(partner.id)) {
        throw new BadRequestException('Uno de los socios no pertenece a este proyecto');
      }
    }

    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

    await this.prisma.$transaction(async (tx) => {
      if (toDelete.length) {
        await tx.projectPartner.deleteMany({ where: { id: { in: toDelete } } });
      }

      for (const partner of normalized) {
        if (partner.id != null) {
          await tx.projectPartner.update({
            where: { id: partner.id },
            data: { name: partner.name, percentage: partner.percentage, isMe: partner.isMe },
          });
        } else {
          await tx.projectPartner.create({
            data: {
              projectId,
              name: partner.name,
              percentage: partner.percentage,
              isMe: partner.isMe,
            },
          });
        }
      }
    });

    return this.prisma.projectPartner.findMany({
      where: { projectId },
      orderBy: [{ isMe: 'desc' }, { name: 'asc' }],
    });
  }

  // Reparto de beneficios: sigue siendo un atajo para crear varias retiradas
  // (una por socio) en un solo envío. Ahora cada línea crea explícitamente un
  // movimiento kind=withdrawal vinculado por partnerId — antes se guardaba
  // como un "gasto" (type=expense), que es justo lo que no debe pasar: una
  // retirada no es un gasto del proyecto.
  async distributeProfit(
    userId: number,
    projectId: number,
    dto: DistributeProjectProfitDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const partners = await this.prisma.projectPartner.findMany({
      where: { projectId },
    });

    if (!partners.length) {
      throw new BadRequestException(
        'Define primero los socios y sus porcentajes para repartir beneficios',
      );
    }

    const totalAmount = Number(dto.totalAmount);
    const lines = dto.lines.map((line) => ({
      partnerId: line.partnerId,
      amount: Number(line.amount),
    }));

    this.validateDistributionLines(totalAmount, lines);

    const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
    for (const line of lines) {
      if (!partnerById.has(line.partnerId)) {
        throw new BadRequestException('Uno de los socios no pertenece a este proyecto');
      }
    }

    const date = this.toDate(dto.date, 'date');
    const baseTitle = dto.title?.trim() || 'Reparto de beneficios';
    const commonNotes = dto.notes?.trim() || null;

    await this.prisma.projectManualEntry.createMany({
      data: lines.map((line) => {
        const partner = partnerById.get(line.partnerId)!;
        return {
          projectId,
          kind: 'withdrawal' as const,
          title: `${baseTitle} · ${partner.name}`,
          description: `Retirada de beneficios para ${partner.name}`,
          amount: line.amount,
          date,
          category: 'profit_distribution',
          notes: commonNotes,
          partnerId: partner.id,
        };
      }),
    });

    return { success: true, created: lines.length };
  }
}
