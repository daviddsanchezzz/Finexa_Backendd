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

    const transaction = await this.prisma.transaction.create({
      data: { ...dto, userId, date: rawDate },
    });

    // TRANSFERENCIA
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

      return PrismaDateTransformer.toPlain(transaction);
    }

    // INGRESOS Y GASTOS
    if (transaction.walletId) {
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

    return PrismaDateTransformer.toPlain(transaction);
  }

  // ============================================================
  // FIND ALL
  // ============================================================
  async findAll(
    userId: number,
    filters?: { walletId?: number; dateFrom?: string; dateTo?: string; type?: string },
  ) {
    try {
      const where: any = { userId, active: true };
  
      if (filters?.walletId && isNaN(Number(filters.walletId))) {
        throw new BadRequestException(
          'El parámetro walletId debe ser un número válido.',
        );
      }
  
      if (filters?.type && !["income", "expense", "transfer"].includes(filters.type)) {
        throw new BadRequestException(
          'El parámetro type no es válido.',
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
  
      if (filters?.walletId) {
        where.walletId = filters.walletId;
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
        include: { category: true, subcategory: true, wallet: true, fromWallet: true, toWallet: true },
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
  // UPDATE (corregido con balance correcto)
  // ============================================================
  async update(userId: number, id: number, dto: UpdateTransactionDto) {
    const prev = await this.findOne(userId, id);

    // 1️⃣ REVERTIR EFECTO ANTERIOR
    if (prev.type === 'income') {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense') {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      await this.prisma.wallet.update({
        where: { id: prev.fromWalletId },
        data: { balance: { increment: prev.amount } },
      });

      await this.prisma.wallet.update({
        where: { id: prev.toWalletId },
        data: { balance: { decrement: prev.amount } },
      });
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
    if (prev.type === 'income') {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense') {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      await this.prisma.wallet.update({
        where: { id: prev.fromWalletId },
        data: { balance: { increment: prev.amount } },
      });

      await this.prisma.wallet.update({
        where: { id: prev.toWalletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    // Soft delete
    const removed = await this.prisma.transaction.update({
      where: { id },
      data: { active: false },
    });

    return PrismaDateTransformer.toPlain(removed);
  }
}
