import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { MonthDataDto } from "./dto/month-data.dto";

@Injectable()
export class MonthDataService {
  constructor(private prisma: PrismaService) {}

  private toValue(v: any) {
    return v === undefined || v === null ? null : Number(v);
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
    return this.prisma.manualMonthData.findMany({
      where: { userId, active: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    });
  }

  /**
   * Obtener overrides de un año
   */
  async findByYear(userId: number, year: number) {
    return this.prisma.manualMonthData.findMany({
      where: { userId, year, active: true },
      orderBy: { month: "asc" },
    });
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
}
