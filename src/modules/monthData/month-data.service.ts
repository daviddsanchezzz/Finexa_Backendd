import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { MonthDataDto } from "./dto/month-data.dto";


function monthRangeUTC(monthStart: Date) {
  const start = new Date(monthStart);
  const end = new Date(Date.UTC(
    monthStart.getUTCFullYear(),
    monthStart.getUTCMonth() + 1,
    1,
  ));
  return { start, end };
}

@Injectable()
export class MonthDataService {
  constructor(private prisma: PrismaService) {}

  private toValue(v: any) {
    return v === undefined || v === null ? null : Number(v);
  }

  private isUntouchedLegacyCronRow(row: {
    month: number;
    createdBy: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    if (row.createdBy !== null) return false;
    if (row.createdAt.getTime() !== row.updatedAt.getTime()) return false;
    if (row.createdAt.getUTCDate() !== 1 || row.createdAt.getUTCHours() !== 4) return false;

    // Legacy guardado por cron con +1:
    // month 1..11 creado en ese mismo month (UTC), o month 12 creado en enero (0).
    if (row.month >= 1 && row.month <= 11) {
      return row.createdAt.getUTCMonth() === row.month;
    }
    if (row.month === 12) {
      return row.createdAt.getUTCMonth() === 0;
    }

    return false;
  }

  private normalizeMonthForRead(row: { month: number; createdBy: number | null; createdAt: Date; updatedAt: Date }) {
    if (!this.isUntouchedLegacyCronRow(row)) return row.month;
    return row.month === 12 ? 11 : row.month - 1;
  }

  private normalizeRowsForRead<T extends { year: number; month: number; createdBy: number | null; createdAt: Date; updatedAt: Date }>(rows: T[]) {
    const byKey = new Map<string, T & { month: number }>();

    for (const row of rows) {
      const normalizedMonth = this.normalizeMonthForRead(row);
      if (normalizedMonth < 0 || normalizedMonth > 11) continue;

      const key = `${row.year}-${normalizedMonth}`;
      const candidate = { ...row, month: normalizedMonth };
      const current = byKey.get(key);

      if (!current) {
        byKey.set(key, candidate);
        continue;
      }

      // Preferimos el más recientemente actualizado para resolver conflictos.
      if (candidate.updatedAt.getTime() >= current.updatedAt.getTime()) {
        byKey.set(key, candidate);
      }
    }

    return Array.from(byKey.values()).sort(
      (a, b) => a.year - b.year || a.month - b.month,
    );
  }

async findOneByMonthAndYear(
  userId: number,
  year: number,
  month: number,
): Promise<number | null> {
  const finalMonth = month - 1
  const row = await this.prisma.manualMonthData.findFirst({
    where: {
      userId,
      year,
      month: finalMonth,
      active: true, // coherente con el resto del servicio
    },
    select: {
      finalBalance: true,
    },
  });

  return row?.finalBalance ?? null;
}


  /**
   * Crea o actualiza un override mensual
   */
  async upsert(userId: number, dto: MonthDataDto) {
    const { year, month, income, expense, finalBalance } = dto;

    return await this.prisma.manualMonthData.upsert({
      where: {
        userId_year_month: { userId, year, month },
      },
      update: {
        income: this.toValue(income),
        expense: this.toValue(expense),
        finalBalance: this.toValue(finalBalance),
      },
      create: {
        userId,
        year,
        month,
        income: this.toValue(income),
        expense: this.toValue(expense),
        finalBalance: this.toValue(finalBalance),
      },
    });
  }

  /**
   * Obtener todos los overrides activos del usuario
   */
  async findAll(userId: number) {
    const rows = await this.prisma.manualMonthData.findMany({
      where: { userId, active: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
    return this.normalizeRowsForRead(rows);
  }

  /**
   * Obtener overrides de un aÃƒÆ’Ã‚Â±o
   */
  async findByYear(userId: number, year: number) {
    const rows = await this.prisma.manualMonthData.findMany({
      where: { userId, year, active: true },
      orderBy: { month: "asc" },
    });
    return this.normalizeRowsForRead(rows);
  }

  /**
   * Eliminar override (desactivar o borrar)
   */
  async delete(userId: number, year: number, month: number) {
    const existing = await this.prisma.manualMonthData.findUnique({
      where: { userId_year_month: { userId, year, month } },
    });

    if (!existing) {
      throw new NotFoundException("No existe ese registro manual");
    }

    // Si prefieres desactivarlo:
    return this.prisma.manualMonthData.update({
      where: { userId_year_month: { userId, year, month } },
      data: { active: false },
    });

    // Si prefieres borrar completamente:
    // return this.prisma.manualMonthData.delete({
    //   where: { userId_year_month: { userId, year, month } }
    // });
  }

async calculateIncome(
  userId: number,
  start: Date,
  end: Date,
): Promise<number> {
  const res = await this.prisma.transaction.aggregate({
    where: {
      userId,
      active: true,
      type: "income",
      date: { gte: start, lt: end },

      // filtros equivalentes al frontend
      isRecurring: false,
      OR: [
        { excludeFromStats: false },
      ],
    },
    _sum: { amount: true },
  });

  return res._sum.amount ?? 0;
}

async calculateExpense(
  userId: number,
  start: Date,
  end: Date,
): Promise<number> {
  const res = await this.prisma.transaction.aggregate({
    where: {
      userId,
      active: true,
      type: "expense",
      date: { gte: start, lt: end },

      // filtros equivalentes al frontend
      isRecurring: false,
      OR: [
        { excludeFromStats: false },
      ],
    },
    _sum: { amount: true },
  });

  return res._sum.amount ?? 0;
}

async calculateFinalBalance(
  userId: number,
  end: Date,
): Promise<number> {
  const res = await this.prisma.wallet.aggregate({
    where: {
      userId,
      active: true,
    },
    _sum: {
      balance: true,
    },
  });

  return res._sum.balance ?? 0;
}


async closeMonthWithCron(userId: number, monthStart: Date) {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth(); // 0-11, coherente con frontend/DTO

  const existing = await this.prisma.manualMonthData.findUnique({
    where: { userId_year_month: { userId, year, month } },
  });

  const canAutoRepairLegacy =
    !!existing &&
    existing.createdBy === null &&
    existing.createdAt.getTime() === existing.updatedAt.getTime() &&
    existing.createdAt.getUTCDate() === 1 &&
    existing.createdAt.getUTCHours() === 4 &&
    existing.createdAt.getUTCMonth() === month;

  if (existing && !canAutoRepairLegacy) {
    return existing; // idempotente en registros validos o editados manualmente
  }
  const { start, end } = monthRangeUTC(monthStart);

  const [income, expense, finalBalance] = await Promise.all([
    this.calculateIncome(userId, start, end),
    this.calculateExpense(userId, start, end),
    this.calculateFinalBalance(userId, end),
  ]);

  if (existing && canAutoRepairLegacy) {
    return this.prisma.manualMonthData.update({
      where: { id: existing.id },
      data: {
        income,
        expense,
        finalBalance,
        active: true,
      },
    });
  }

  return this.prisma.manualMonthData.create({
    data: {
      userId,
      year,
      month,
      income,
      expense,
      finalBalance,
    },
  });
}

}
