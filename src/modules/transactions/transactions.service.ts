import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { PrismaDateTransformer } from 'src/common/prisma/prisma.transformer';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  // CREATE
  // ============================================================
  async create(userId: number, dto: CreateTransactionDto) {
    const rawDate = dto.date ? new Date(dto.date) : new Date();

    if (isNaN(rawDate.getTime())) {
      throw new BadRequestException('Fecha inválida');
    }

    // Extraer info de recurrencia del DTO
    const { isRecurring, recurrence, parentId, ...rest } = dto as any;

    // 1) Crear SIEMPRE la transacción "real" (la que afecta al saldo)
    const transaction = await this.prisma.transaction.create({
      data: {
        ...rest,
        userId,
        date: rawDate,
        isRecurring: false,
        recurrence: null,
        parentId: parentId ?? null,
      },
    });

    // 2) Actualizar balances en función del tipo + validación inversión
    if (transaction.type === 'transfer') {
      const { fromWalletId, toWalletId, amount } = transaction;

      if (!fromWalletId || !toWalletId) {
        throw new BadRequestException('Transferencia inválida');
      }

      const toWallet = await this.prisma.wallet.findUnique({
        where: { id: toWalletId },
      });

      if (!toWallet) {
        throw new NotFoundException('Wallet destino no existe');
      }

      // ✅ si destino es wallet inversión, exige investmentAssetId
      if (toWallet.kind === 'investment' && !(transaction as any).investmentAssetId) {
        throw new BadRequestException(
          'investmentAssetId es obligatorio cuando el destino es una wallet de inversión',
        );
      }

      await this.prisma.wallet.update({
        where: { id: fromWalletId },
        data: { balance: { decrement: amount } },
      });

      await this.prisma.wallet.update({
        where: { id: toWalletId },
        data: { balance: { increment: amount } },
      });
    } else if (transaction.walletId) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { id: transaction.walletId },
      });

      if (!wallet) {
        throw new NotFoundException(
          `Wallet with ID ${transaction.walletId} not found`,
        );
      }

      const newBalance =
        transaction.type === 'income'
          ? wallet.balance + transaction.amount
          : wallet.balance - transaction.amount;

      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });
    }

    // 3) Si NO es recurrente, terminamos aquí
    if (!isRecurring || !recurrence) {
      return PrismaDateTransformer.toPlain(transaction);
    }

    // 4) Crear la PLANTILLA recurrente para futuras ejecuciones
    const nextDate = this.getNextDate(rawDate, recurrence);

    const template = await this.prisma.transaction.create({
      data: {
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        date: nextDate, // fecha de la PRÓXIMA ejecución
        isRecurring: true,
        recurrence: recurrence, // "daily" | "weekly" | ...

        walletId: transaction.walletId,
        fromWalletId: transaction.fromWalletId,
        toWalletId: transaction.toWalletId,

        // ✅ CLAVE: copiar investmentAssetId para aportaciones recurrentes a inversión
        investmentAssetId: (transaction as any).investmentAssetId ?? null,

        categoryId: transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        tripId: transaction.tripId,

        userId: transaction.userId,
        active: true,
        parentId: null, // la plantilla es raíz de la serie
      },
    });


    // 5) (Opcional pero recomendable) enlazar la primera ocurrencia con la plantilla
    // ✅ SOLO si la ocurrencia no venía ya enlazada (cron)
    if (!transaction.parentId) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { parentId: template.id },
      });
    }

    // 6) Devolvemos la transacción real (la que ve el usuario)
    return PrismaDateTransformer.toPlain(transaction);
  }

  // ============================================================
  // FIND ALL
  // ============================================================
  async findAll(
    userId: number,
    filters?: {
      walletId?: number;
      dateFrom?: string;
      dateTo?: string;
      type?: string;
      subcategoryId?: number;
      isRecurring?: boolean;
      investmentAssetId?: number;
    },
  ) {
    try {
      const where: any = { userId, active: true };

      if (filters?.walletId && isNaN(Number(filters.walletId))) {
        throw new BadRequestException(
          'El parámetro walletId debe ser un número válido.',
        );
      }

      if (filters?.subcategoryId && isNaN(Number(filters.subcategoryId))) {
        throw new BadRequestException(
          'El parámetro subcategoryId debe ser un número válido.',
        );
      }

      if (
        filters?.type &&
        !['income', 'expense', 'transfer'].includes(filters.type)
      ) {
        throw new BadRequestException('El parámetro type no es válido.');
      }

      if (
        filters?.isRecurring !== undefined &&
        typeof filters.isRecurring !== 'boolean'
      ) {
        throw new BadRequestException(
          'El parámetro isRecurring debe ser un booleano.',
        );
      }

      if (filters?.dateFrom && isNaN(Date.parse(filters.dateFrom))) {
        throw new BadRequestException(
          'El parámetro dateFrom no tiene un formato de fecha válido.',
        );
      }

      if (filters?.dateTo && isNaN(Date.parse(filters.dateTo))) {
        throw new BadRequestException(
          'El parámetro dateTo no tiene un formato de fecha válido.',
        );
      }

      if (filters?.investmentAssetId && isNaN(Number(filters.investmentAssetId))) {
        throw new BadRequestException(
          'El parámetro investmentAssetId debe ser un número válido.',
        );
      }

      if (filters?.investmentAssetId) {
        where.investmentAssetId = filters.investmentAssetId;
      }

      if (filters?.walletId) {
        where.walletId = filters.walletId;
      }

      if (filters?.isRecurring !== undefined) {
        where.isRecurring = filters.isRecurring;
      }

      if (filters?.subcategoryId) {
        where.subcategoryId = filters.subcategoryId;
      }

      if (filters?.type) {
        where.type = filters.type;
      }

if (filters?.dateFrom || filters?.dateTo) {
  where.date = {};

  if (filters.dateFrom) {
    where.date.gte = new Date(filters.dateFrom);
  }

  if (filters.dateTo) {
    const toExclusive = new Date(filters.dateTo);

    // sumamos 1 día y usamos lt (exclusivo) para incluir TODO el día dateTo
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    where.date.lt = toExclusive;
  }
}


      const transactions = await this.prisma.transaction.findMany({
        where,
        include: {
          category: true,
          subcategory: true,
          wallet: true,
          fromWallet: true,
          toWallet: true,
        },
        orderBy: { date: 'desc' },
      });

      return PrismaDateTransformer.toPlain(transactions);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      throw new InternalServerErrorException(
        'Ocurrió un error al obtener las transacciones. Inténtalo de nuevo más tarde.',
      );
    }
  }

  // ============================================================
  // FIND ONE
  // ============================================================
  async findOne(userId: number, id: number) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
    });

    if (!tx) throw new NotFoundException('Transaction not found');

    return PrismaDateTransformer.toPlain(tx);
  }

  // ============================================================
  // UPDATE (manteniendo balance correcto)
  // ============================================================
  async update(userId: number, id: number, dto: UpdateTransactionDto) {
    const prev = await this.findOne(userId, id);

    // 1️⃣ REVERTIR EFECTO ANTERIOR
    if (prev.type === 'income' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      if (prev.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.fromWalletId },
          data: { balance: { increment: prev.amount } },
        });
      }

      if (prev.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.toWalletId },
          data: { balance: { decrement: prev.amount } },
        });
      }
    }

    // 2️⃣ ACTUALIZAR TRANSACCIÓN
    const updated = await this.prisma.transaction.update({
      where: { id },
      data: dto as any,
    });

    // 3️⃣ APLICAR EFECTO NUEVO
    if (updated.type === 'income' && updated.walletId) {
      await this.prisma.wallet.update({
        where: { id: updated.walletId },
        data: { balance: { increment: updated.amount } },
      });
    }

    if (updated.type === 'expense' && updated.walletId) {
      await this.prisma.wallet.update({
        where: { id: updated.walletId },
        data: { balance: { decrement: updated.amount } },
      });
    }

    if (updated.type === 'transfer') {
      // ✅ validación inversión también en update (por si cambian toWalletId)
      if (updated.toWalletId) {
        const toWallet = await this.prisma.wallet.findUnique({
          where: { id: updated.toWalletId },
        });
        if (toWallet?.kind === 'investment' && !(updated as any).investmentAssetId) {
          throw new BadRequestException(
            'investmentAssetId es obligatorio cuando el destino es una wallet de inversión',
          );
        }
      }

      if (updated.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: updated.fromWalletId },
          data: { balance: { decrement: updated.amount } },
        });
      }

      if (updated.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: updated.toWalletId },
          data: { balance: { increment: updated.amount } },
        });
      }
    }

    return PrismaDateTransformer.toPlain(updated);
  }

  // ============================================================
  // REMOVE (revirtiendo balance correctamente)
  // ============================================================
  async remove(userId: number, id: number) {
    const prev = await this.findOne(userId, id);

    // Revertir efecto previo
    if (prev.type === 'income' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      if (prev.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.fromWalletId },
          data: { balance: { increment: prev.amount } },
        });
      }

      if (prev.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.toWalletId },
          data: { balance: { decrement: prev.amount } },
        });
      }
    }

    // Soft delete
    const removed = await this.prisma.transaction.update({
      where: { id },
      data: { active: false },
    });

    return PrismaDateTransformer.toPlain(removed);
  }

  // ============================================================
  // RECURRING ENGINE (CRON)
  // ============================================================
  async processRecurringTransactions() {
    const now = new Date();

    const templates = await this.prisma.transaction.findMany({
      where: {
        isRecurring: true,
        recurrence: { not: null },
        date: { lte: now }, // ya toca ejecutarlas
        active: true,
      },
    });

    for (const t of templates) {
      // 1) DTO para la transacción real (ocurrencia)
      const dto: CreateTransactionDto = {
        type: t.type as any,
        amount: t.amount,
        description: t.description ?? undefined,
        // guardamos la fecha programada como fecha del movimiento
        date: t.date.toISOString(),
        walletId: t.walletId ?? undefined,
        fromWalletId: t.fromWalletId ?? undefined,
        toWalletId: t.toWalletId ?? undefined,

        // ✅ clave para aportaciones recurrentes a inversión
        investmentAssetId: (t as any).investmentAssetId ?? undefined,

        categoryId: t.categoryId ?? undefined,
        subcategoryId: t.subcategoryId ?? undefined,
        tripId: t.tripId ?? undefined,
        // la ocurrencia NO es recurrente
        isRecurring: false,
        recurrence: null,
        // enlazamos con la plantilla
        parentId: t.id,
      } as any;

      // 2) crear la transacción pasando por la lógica normal (balances, validaciones, etc.)
      await this.create(t.userId, dto);

      // 3) calcular siguiente fecha para la plantilla
      const nextDate = this.getNextDate(t.date, t.recurrence);

      // 4) actualizar plantilla recurrente
      await this.prisma.transaction.update({
        where: { id: t.id },
        data: { date: nextDate },
      });
    }
  }

  // ============================================================
  // HELPER: calcular siguiente fecha de ejecución
  // ============================================================
  private getNextDate(current: Date, interval: string | null): Date {
    const d = new Date(current);
    switch (interval) {
      case 'daily':
        d.setDate(d.getDate() + 1);
        break;
      case 'weekly':
        d.setDate(d.getDate() + 7);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'yearly':
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    return d;
  }

  async updateWithScope(
    userId: number,
    id: number,
    dto: UpdateTransactionDto,
    scope: 'single' | 'series' | 'future' = 'single',
  ) {
    // 1) Obtenemos la transacción base (la que el usuario está editando)
    const baseTx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
    });

    if (!baseTx) {
      throw new NotFoundException('Transaction not found');
    }

    const isInSeries = baseTx.isRecurring || !!baseTx.parentId;

    // ✅ Caso 1: no pertenece a serie o el usuario ha elegido "solo esta"
    if (!isInSeries || scope === 'single') {
      return this.update(userId, id, dto);
    }

    // 2) Identificar plantilla de la serie
    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;

    if (!templateId) {
      return this.update(userId, id, dto);
    }

    // 3) Actualizar la plantilla (no toca balances)
    const templateUpdateData: any = {
      type: dto.type ?? baseTx.type,
      amount: dto.amount ?? baseTx.amount,
      description: dto.description ?? baseTx.description,
      categoryId:
        typeof (dto as any).categoryId !== 'undefined'
          ? (dto as any).categoryId
          : baseTx.categoryId,
      subcategoryId:
        typeof (dto as any).subcategoryId !== 'undefined'
          ? (dto as any).subcategoryId
          : baseTx.subcategoryId,
      walletId:
        typeof (dto as any).walletId !== 'undefined'
          ? (dto as any).walletId
          : baseTx.walletId,
      fromWalletId:
        typeof (dto as any).fromWalletId !== 'undefined'
          ? (dto as any).fromWalletId
          : baseTx.fromWalletId,
      toWalletId:
        typeof (dto as any).toWalletId !== 'undefined'
          ? (dto as any).toWalletId
          : baseTx.toWalletId,

      // ✅ clave: propagar investmentAssetId en series
      investmentAssetId:
        typeof (dto as any).investmentAssetId !== 'undefined'
          ? (dto as any).investmentAssetId
          : (baseTx as any).investmentAssetId,
    };

    // isRecurring + recurrence para la plantilla
    if (typeof (dto as any).recurrence !== 'undefined') {
      if ((dto as any).recurrence) {
        templateUpdateData.isRecurring = true;
        templateUpdateData.recurrence = (dto as any).recurrence;
      } else {
        templateUpdateData.isRecurring = false;
        templateUpdateData.recurrence = null;
      }
    }

    await this.prisma.transaction.update({
      where: { id: templateId },
      data: templateUpdateData,
    });

    // ✅ Caso 2: actualizar esta + futuras
    if (scope === 'future') {
      if (baseTx.parentId) {
        await this.update(userId, baseTx.id, dto);
      }

      const futureChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
          date: { gt: baseTx.date },
        },
      });

      for (const child of futureChildren) {
        const dtoForChild: UpdateTransactionDto = {
          ...(dto as any),
          date: (dto as any).date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }

      return this.findOne(userId, id);
    }

    // ✅ Caso 3: actualizar toda la serie
    if (scope === 'series') {
      const allChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
        },
      });

      for (const child of allChildren) {
        const dtoForChild: UpdateTransactionDto = {
          ...(dto as any),
          date: (dto as any).date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }

      return this.findOne(userId, id);
    }

    return this.update(userId, id, dto);
  }

  async removeWithScope(
    userId: number,
    id: number,
    scope: 'single' | 'series' | 'future' = 'single',
  ) {
    const baseTx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
    });

    if (!baseTx) {
      throw new NotFoundException('Transaction not found');
    }

    const isInSeries = baseTx.isRecurring || !!baseTx.parentId;

    if (!isInSeries || scope === 'single') {
      return this.remove(userId, id);
    }

    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;

    if (!templateId) {
      return this.remove(userId, id);
    }

    let deletedCount = 0;

    if (scope === 'future') {
      if (baseTx.parentId) {
        await this.remove(userId, baseTx.id);
        deletedCount++;
      }

      const futureChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
          date: { gt: baseTx.date },
        },
      });

      for (const child of futureChildren) {
        await this.remove(userId, child.id);
        deletedCount++;
      }

      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });

      return { scope, deletedCount };
    }

    if (scope === 'series') {
      const allChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
        },
      });

      for (const child of allChildren) {
        await this.remove(userId, child.id);
        deletedCount++;
      }

      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });

      return { scope, deletedCount };
    }

    return this.remove(userId, id);
  }

  // dentro de TransactionsService

async findLastSalary(userId: number) {
  try {
    // 1) Buscar categoría "Salario" del usuario (category o subcategory, según tu modelo)
    // Ajusta el where si tu categoría de salario vive en subcategory en vez de category.
    const salaryCategory = await this.prisma.category.findFirst({
      where: {
        userId,
        active: true,
        name: { equals: 'Salario', mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });

    // Si no existe categoría salario, no tiene sentido seguir
    if (!salaryCategory) {
      throw new NotFoundException('No existe la categoría "Salario"');
    }

    // 2) Obtener última transacción income en esa categoría
    // Importante: ignoramos recurrent templates (isRecurring=true) y soft-deleted (active=false)
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId,
        active: true,
        isRecurring: false,
        type: 'income',
        categoryId: salaryCategory.id,
      },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        date: true,
        description: true,
        walletId: true,
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true } },
      },
    });

    if (!tx) {
      throw new NotFoundException('No hay transacciones de salario');
    }

    // 3) Respuesta pequeña y directa (ideal para tu modal)
    return PrismaDateTransformer.toPlain({
      id: tx.id,
      amount: Number(tx.amount),
      date: tx.date,
      description: tx.description,
      walletId: tx.walletId,
      category: tx.category,
      subcategory: tx.subcategory,
    });
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    if (error instanceof BadRequestException) throw error;

    throw new InternalServerErrorException(
      'Ocurrió un error al obtener el último salario. Inténtalo de nuevo más tarde.',
    );
  }
}

}
