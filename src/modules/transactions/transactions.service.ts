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
    console.log('🔵 CREATE TX called', {
    userId,
    amount: dto.amount,
    isRecurring: dto.isRecurring,
    recurrence: dto.recurrence,
  });

  if (isNaN(rawDate.getTime())) {
    throw new BadRequestException('Fecha inválida');
  }

  // Extraer info de recurrencia del DTO
  const { isRecurring, recurrence, parentId, ...rest } = dto;

  // 1) Crear SIEMPRE la transacción "real" (la que afecta al saldo)
  const transaction = await this.prisma.transaction.create({
    data: {
      ...rest,
      userId,
      date: rawDate,
      // la ocurrencia inicial NO es recurrente en sí misma
      isRecurring: false,
      recurrence: null,
      parentId: null,        // luego, si quieres, la enlazamos
    },
  });
    console.log('✅ REAL TX created', transaction.id);

  // 2) Actualizar balances en función del tipo
  if (transaction.type === 'transfer') {
    const { fromWalletId, toWalletId, amount } = transaction;

    if (!fromWalletId || !toWalletId) {
      throw new BadRequestException('Transferencia inválida');
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
      date: nextDate,           // fecha de la PRÓXIMA ejecución
      isRecurring: true,
      recurrence: recurrence,   // "daily" | "weekly" | ...

      walletId: transaction.walletId,
      fromWalletId: transaction.fromWalletId,
      toWalletId: transaction.toWalletId,
      categoryId: transaction.categoryId,
      subcategoryId: transaction.subcategoryId,
      tripId: transaction.tripId,

      userId: transaction.userId,
      active: true,
      parentId: null,          // la plantilla es raíz de la serie
    },
  });
    console.log('📌 TEMPLATE created', template.id);

  // 5) (Opcional pero recomendable) enlazar la primera ocurrencia con la plantilla
  await this.prisma.transaction.update({
    where: { id: transaction.id },
    data: { parentId: template.id },
  });

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

      if (filters?.type && !['income', 'expense', 'transfer'].includes(filters.type)) {
        throw new BadRequestException('El parámetro type no es válido.');
      }

      if (filters?.isRecurring !== undefined && typeof filters.isRecurring !== 'boolean') {
        throw new BadRequestException('El parámetro isRecurring debe ser un booleano.');
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
        if (filters.dateFrom) where.date.gte = new Date(filters.dateFrom);
        if (filters.dateTo) where.date.lte = new Date(filters.dateTo);
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
      data: dto,
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
        categoryId: t.categoryId ?? undefined,
        subcategoryId: t.subcategoryId ?? undefined,
        tripId: t.tripId ?? undefined,
        // la ocurrencia NO es recurrente
        isRecurring: false,
        recurrence: null,
        // enlazamos con la plantilla
        parentId: t.id,
      };

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
    // Equivalente a "Aquest esdeveniment"
    if (!isInSeries || scope === 'single') {
      return this.update(userId, id, dto); // usa tu lógica actual de update (recalcula saldos)
    }
  
    // 2) Identificar plantilla de la serie
    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;
  
    if (!templateId) {
      // Fallback defensivo
      return this.update(userId, id, dto);
    }
  
    // 3) Actualizar la plantilla (no toca balances)
    //    Usamos baseTx como base para campos por defecto
    const templateUpdateData: any = {
      type: dto.type ?? baseTx.type,
      amount: dto.amount ?? baseTx.amount,
      description: dto.description ?? baseTx.description,
      categoryId:
        typeof dto.categoryId !== 'undefined'
          ? dto.categoryId
          : baseTx.categoryId,
      subcategoryId:
        typeof dto.subcategoryId !== 'undefined'
          ? dto.subcategoryId
          : baseTx.subcategoryId,
      walletId:
        typeof dto.walletId !== 'undefined' ? dto.walletId : baseTx.walletId,
      fromWalletId:
        typeof dto.fromWalletId !== 'undefined'
          ? dto.fromWalletId
          : baseTx.fromWalletId,
      toWalletId:
        typeof dto.toWalletId !== 'undefined'
          ? dto.toWalletId
          : baseTx.toWalletId,
    };
  
    // isRecurring + recurrence para la plantilla
    if (typeof dto.recurrence !== 'undefined') {
      if (dto.recurrence) {
        templateUpdateData.isRecurring = true;
        templateUpdateData.recurrence = dto.recurrence;
      } else {
        templateUpdateData.isRecurring = false;
        templateUpdateData.recurrence = null;
      }
    }
  
    await this.prisma.transaction.update({
      where: { id: templateId },
      data: templateUpdateData,
    });
  
    // ✅ Caso 2: "Aquest esdeveniment i els següents"
    // → actualizar esta ocurrencia + todas las futuras de la serie
    if (scope === 'future') {
      // 2.1. Actualizar SIEMPRE la transacción actual con tu lógica normal
      //      (recalcula balances en función del cambio)
      if (baseTx.parentId) {
        await this.update(userId, baseTx.id, dto);
      } else {
        // Si por alguna razón baseTx fuera la plantilla (raro en tu UI),
        // simplemente no llamamos a update (la plantilla ya se ha actualizado arriba).
      }
  
      // 2.2. Actualizar todas las ocurrencias FUTURAS (fecha estrictamente mayor)
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
          ...dto,
          // Si el DTO no trae date, respetamos la fecha original de esa ocurrencia
          date: dto.date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }
  
      return this.findOne(userId, id);
    }
  
    // ✅ Caso 3: "Tots els esdeveniments"
    // → actualizar toda la serie (todas las ocurrencias)
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
          ...dto,
          date: dto.date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }
  
      // Si baseTx es una ocurrencia, ya estará incluida en allChildren.
      // Si baseTx es la plantilla, ya la hemos actualizado arriba con templateUpdateData.
  
      return this.findOne(userId, id);
    }
  
    // Fallback defensivo
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
  
    // ✅ Caso 1: no pertenece a serie o el usuario quiere "solo esta"
    // Equivalente a: "Aquest esdeveniment"
    if (!isInSeries || scope === 'single') {
      return this.remove(userId, id); // usa tu lógica actual (revertir saldos + active=false)
    }
  
    // A partir de aquí sabemos que hay serie detrás y scope es 'future' o 'series'
    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;
  
    if (!templateId) {
      // Por seguridad, si algo está raro, caemos a borrado simple
      return this.remove(userId, id);
    }
  
    let deletedCount = 0;
  
    // ✅ Caso 2: "Aquest esdeveniment i els següents"
    // → esta + todas las futuras
    if (scope === 'future') {
      // 2.1. Borrar SIEMPRE la actual si es una ocurrencia de la serie
      if (baseTx.parentId) {
        await this.remove(userId, baseTx.id);
        deletedCount++;
      }
  
      // 2.2. Borrar todas las ocurrencias FUTURAS (fecha estrictamente mayor)
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
  
      // 2.3. Desactivar la plantilla para no generar más con el cron
      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });
  
      return { scope, deletedCount };
    }
  
    // ✅ Caso 3: "Tots els esdeveniments"
    // → toda la serie (todas las ocurrencias pasadas y futuras)
    if (scope === 'series') {
      // 3.1. Todas las ocurrencias hijas de esa plantilla
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
  
      // 3.2. Si por alguna razón baseTx es la propia plantilla, NO usamos this.remove
      //     sobre la plantilla (no afecta a saldo); solo la marcamos inactiva.
      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });
  
      return { scope, deletedCount };
    }
  
    // Fallback defensivo
    return this.remove(userId, id);
  }
  
}
