// src/debts/debts.service.ts
import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { CreateDebtDto, DebtDirectionDto, DebtTypeDto } from "./dto/create-debt.dto";
import { UpdateDebtDto } from "./dto/update-debt.dto";
import { DebtStatus } from "@prisma/client"; // generado por Prisma

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

  async create(userId: number, dto: CreateDebtDto) {
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

    const debt = await this.prisma.debt.create({
      data: {
        userId,
        type: dto.type,
        direction: dto.direction,
        status,
        name: dto.name,
        entity: dto.entity,
        emoji: dto.emoji ?? "💸",
        color: dto.color ?? "#3b82f6",
        totalAmount: dto.totalAmount,
        payed,
        remainingAmount,
        interestRate:
          dto.type === DebtTypeDto.PERSONAL ? null : dto.interestRate ?? null,
        monthlyPayment:
          dto.type === DebtTypeDto.PERSONAL ? null : dto.monthlyPayment ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : null,
        installmentsPaid: dto.installmentsPaid ?? 0,
        subcategoryId: subcategory.id,
      },
      include: {
        subcategory: true,
      },
    });

    return debt;
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
      include: { subcategory: true },
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
        entity: dto.entity ?? existing.entity,
        emoji: dto.emoji ?? existing.emoji,
        color: dto.color ?? existing.color,

        totalAmount,
        payed,
        remainingAmount,

        interestRate:
          (dto.type ?? existing.type) === DebtTypeDto.PERSONAL
            ? null
            : dto.interestRate ?? existing.interestRate,
        monthlyPayment:
          (dto.type ?? existing.type) === DebtTypeDto.PERSONAL
            ? null
            : dto.monthlyPayment ?? existing.monthlyPayment,
        startDate: dto.startDate
          ? new Date(dto.startDate)
          : existing.startDate,
        nextDueDate: dto.nextDueDate
          ? new Date(dto.nextDueDate)
          : existing.nextDueDate,
        installmentsPaid:
          dto.installmentsPaid ?? existing.installmentsPaid ?? 0,
      },
      include: {
        subcategory: true,
      },
    });

    return updated;
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

    return deleted;
  }
}
