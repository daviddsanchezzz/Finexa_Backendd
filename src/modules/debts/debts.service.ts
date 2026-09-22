// src/debts/debts.service.ts
import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { CreateDebtDto, DebtDirectionDto } from "./dto/create-debt.dto";
import { UpdateDebtDto } from "./dto/update-debt.dto";
import { DebtStatus, Debt } from "@prisma/client"; // generado por Prisma

@Injectable()
export class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  // 🔹 buscar o crear categoría "Deudas" según direction (income/expense)
  private async getDebtCategory(userId: number, direction: DebtDirectionDto) {
    const isIncome = direction === DebtDirectionDto.THEY_OWE;

    // Tú decides el nombre; aquí uso siempre "Deudas"
    let category = await this.prisma.category.findFirst({
      where: {
        userId,
        type: isIncome ? "income" : "expense",
        name: "Deudas",
        active: true,
      },
    });

    if (!category) {
      category = await this.prisma.category.create({
        data: {
          userId,
          name: "Deudas",
          type: isIncome ? "income" : "expense",
          emoji: "📉",
          color: "#111827",
        },
      });
    }

    return category;
  }

  // 🔹 Evita IDOR: una deuda no puede enlazarse a la cartera de otro usuario.
  private async assertWalletOwnership(userId: number, walletId: number) {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId },
      select: { id: true },
    });
    if (!wallet) throw new ForbiddenException("La cartera indicada no existe o no te pertenece");
  }

  private computeRemaining(total: number, payed: number | undefined) {
    const safePayed = payed ?? 0;
    const remaining = total - safePayed;
    return remaining < 0 ? 0 : remaining;
  }

  // 🔹 Reglas de estado:
  // - closed → se mantiene closed (solo se cambia mediante close())
  // - si remaining <= 0 → paid
  // - si remaining > 0 → active
  private computeStatus(
    totalAmount: number,
    payed: number | undefined,
    currentStatus?: DebtStatus,
  ): DebtStatus {
    // si ya está cerrada, no tocamos
    if (currentStatus === DebtStatus.closed) return DebtStatus.closed;

    const remaining = this.computeRemaining(totalAmount, payed);

    if (remaining <= 0) return DebtStatus.paid;
    return DebtStatus.active;
  }

  // 🔹 Crea, actualiza o desactiva la transacción recurrente vinculada a la
  // deuda según cuota/frecuencia/cartera/autoRecurringEnabled. Se llama tras
  // cada create/update para mantenerla siempre sincronizada con la deuda.
  private async syncRecurringTransaction(
    userId: number,
    debt: Debt & { subcategory?: { categoryId: number } | null },
  ): Promise<Debt> {
    const hasPeriodicPayments = debt.monthlyPayment != null && debt.paymentFrequency != null;
    const shouldHaveRecurring = hasPeriodicPayments && debt.autoRecurringEnabled && debt.walletId != null;
    const categoryId = debt.subcategory?.categoryId ?? null;

    if (shouldHaveRecurring) {
      const date = debt.nextDueDate ?? new Date();

      if (debt.recurringTransactionId) {
        await this.prisma.transaction.update({
          where: { id: debt.recurringTransactionId },
          data: {
            amount: debt.monthlyPayment!,
            recurrence: debt.paymentFrequency,
            walletId: debt.walletId,
            categoryId,
            subcategoryId: debt.subcategoryId,
            date,
            active: true,
          },
        });
        return debt;
      }

      const created = await this.prisma.transaction.create({
        data: {
          type: "expense",
          amount: debt.monthlyPayment!,
          description: debt.name,
          date,
          isRecurring: true,
          recurrence: debt.paymentFrequency,
          walletId: debt.walletId,
          categoryId,
          subcategoryId: debt.subcategoryId,
          userId,
        },
      });

      return this.prisma.debt.update({
        where: { id: debt.id },
        data: { recurringTransactionId: created.id },
        include: { subcategory: true },
      });
    }

    // No debería tener transacción recurrente: si ya había una, se desactiva.
    if (debt.recurringTransactionId) {
      await this.prisma.transaction.update({
        where: { id: debt.recurringTransactionId },
        data: { active: false },
      });
      return this.prisma.debt.update({
        where: { id: debt.id },
        data: { recurringTransactionId: null },
        include: { subcategory: true },
      });
    }

    return debt;
  }

  async create(userId: number, dto: CreateDebtDto) {
    if (dto.walletId != null) await this.assertWalletOwnership(userId, dto.walletId);

    const category = await this.getDebtCategory(userId, dto.direction);

    const subcategory = await this.prisma.subcategory.create({
      data: {
        name: dto.name,
        emoji: dto.emoji ?? "💸",
        color: dto.color ?? category.color,
        categoryId: category.id,
      },
    });

    const payed = dto.payed ?? 0;
    const remainingAmount = this.computeRemaining(dto.totalAmount, payed);
    const status = this.computeStatus(dto.totalAmount, payed);

    let currency = dto.currency;
    if (!currency) {
      if (dto.walletId != null) {
        const wallet = await this.prisma.wallet.findUnique({ where: { id: dto.walletId }, select: { currency: true } });
        currency = wallet?.currency;
      }
      if (!currency) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
        currency = user?.currency ?? "EUR";
      }
    }

    const debt = await this.prisma.debt.create({
      data: {
        userId,
        type: dto.type,
        direction: dto.direction,
        status,
        name: dto.name,
        entity: dto.entity ?? null,
        emoji: dto.emoji ?? "💸",
        color: dto.color ?? "#3b82f6",
        totalAmount: dto.totalAmount,
        currency,
        payed,
        remainingAmount,
        interestRate: dto.interestRate ?? null,
        monthlyPayment: dto.monthlyPayment ?? null,
        paymentFrequency: dto.paymentFrequency ?? null,
        walletId: dto.walletId ?? null,
        autoRecurringEnabled: dto.autoRecurringEnabled ?? true,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : null,
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : null,
        notes: dto.notes ?? null,
        installmentsPaid: dto.installmentsPaid ?? 0,
        subcategoryId: subcategory.id,
      },
      include: {
        subcategory: true,
      },
    });

    return this.syncRecurringTransaction(userId, debt);
  }

  async findAll(userId: number) {
    return this.prisma.debt.findMany({
      where: { userId, active: true },
      orderBy: { createdAt: "desc" },
      include: {
        subcategory: {
          include: { category: true },
        },
      },
    });
  }

  private async findOwnedDebtOrThrow(userId: number, id: number) {
    const debt = await this.prisma.debt.findUnique({
      where: { id },
      include: { subcategory: true, wallet: true },
    });

    if (!debt || !debt.active) {
      throw new NotFoundException("Deuda no encontrada");
    }

    if (debt.userId !== userId) {
      throw new ForbiddenException("No tienes acceso a esta deuda");
    }

    return debt;
  }

  async findOne(userId: number, id: number) {
    return this.findOwnedDebtOrThrow(userId, id);
  }

  async getDetail(userId: number, id: number) {
    const debt = await this.findOwnedDebtOrThrow(userId, id);

    if (!debt.subcategoryId) {
      return {
        debt,
        transactionsCount: 0,
        paidFromTransactions: 0,
        paidHistoric: debt.payed ?? 0,
        paidTotal: debt.payed ?? 0,
        remainingComputed: this.computeRemaining(debt.totalAmount, debt.payed ?? 0),
      };
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        userId,
        subcategoryId: debt.subcategoryId,
        active: true,
      },
    });

    const paidFromTransactions = transactions.reduce(
      (sum, tx) => sum + Math.abs(tx.amount),
      0,
    );

    const paidHistoric = debt.payed ?? 0;
    const paidTotal = paidHistoric + paidFromTransactions;
    const remainingComputed = this.computeRemaining(debt.totalAmount, paidTotal);

    return {
      debt,
      transactionsCount: transactions.length,
      paidFromTransactions,
      paidHistoric,
      paidTotal,
      remainingComputed,
    };
  }

  async update(userId: number, id: number, dto: UpdateDebtDto) {
    const existing = await this.findOwnedDebtOrThrow(userId, id);

    if (dto.walletId != null) await this.assertWalletOwnership(userId, dto.walletId);

    const totalAmount = dto.totalAmount ?? existing.totalAmount;
    const payed = dto.payed ?? existing.payed ?? 0;
    const remainingAmount = this.computeRemaining(totalAmount, payed);
    const status = this.computeStatus(totalAmount, payed, existing.status);

    // nombre / emoji → sincronizar subcategoría
    if (existing.subcategoryId) {
      await this.prisma.subcategory.update({
        where: { id: existing.subcategoryId },
        data: {
          name: dto.name ?? existing.name,
          emoji: dto.emoji ?? existing.emoji ?? "💸",
        },
      });
    }

    const updated = await this.prisma.debt.update({
      where: { id: existing.id },
      data: {
        type: dto.type ?? existing.type,
        direction: dto.direction ?? existing.direction,
        status, // 👈 aquí ya viene recalculado

        name: dto.name ?? existing.name,
        entity: dto.entity !== undefined ? dto.entity : existing.entity,
        emoji: dto.emoji ?? existing.emoji,
        color: dto.color ?? existing.color,

        totalAmount,
        payed,
        remainingAmount,

        interestRate: dto.interestRate !== undefined ? dto.interestRate : existing.interestRate,
        monthlyPayment: dto.monthlyPayment !== undefined ? dto.monthlyPayment : existing.monthlyPayment,
        paymentFrequency: dto.paymentFrequency !== undefined ? dto.paymentFrequency : existing.paymentFrequency,
        walletId: dto.walletId !== undefined ? dto.walletId : existing.walletId,
        autoRecurringEnabled: dto.autoRecurringEnabled ?? existing.autoRecurringEnabled,

        startDate: dto.startDate
          ? new Date(dto.startDate)
          : existing.startDate,
        nextDueDate: dto.nextDueDate
          ? new Date(dto.nextDueDate)
          : existing.nextDueDate,
        expectedEndDate: dto.expectedEndDate
          ? new Date(dto.expectedEndDate)
          : existing.expectedEndDate,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        installmentsPaid:
          dto.installmentsPaid ?? existing.installmentsPaid ?? 0,
      },
      include: {
        subcategory: true,
      },
    });

    return this.syncRecurringTransaction(userId, updated);
  }

  /**
   * Cerrar deuda manualmente:
   * - status = closed
   * - active = false en la deuda
   * - subcategoría.active = false
   */
  async close(userId: number, id: number) {
    const existing = await this.findOwnedDebtOrThrow(userId, id);

    const updated = await this.prisma.debt.update({
      where: { id: existing.id },
      data: {
        status: DebtStatus.closed,
        active: false,
      },
    });

    if (existing.subcategoryId) {
      await this.prisma.subcategory.update({
        where: { id: existing.subcategoryId },
        data: { active: false },
      });
    }

    if (existing.recurringTransactionId) {
      await this.prisma.transaction.update({
        where: { id: existing.recurringTransactionId },
        data: { active: false },
      });
    }

    return updated;
  }

  // Opcional: soft delete "real" (p.ej si quieres eliminarla del todo distinto de cerrar)
  async remove(userId: number, id: number) {
    const existing = await this.findOwnedDebtOrThrow(userId, id);

    const deleted = await this.prisma.debt.update({
      where: { id: existing.id },
      data: {
        active: false,
      },
    });

    if (existing.recurringTransactionId) {
      await this.prisma.transaction.update({
        where: { id: existing.recurringTransactionId },
        data: { active: false },
      });
    }

    return deleted;
  }
}
