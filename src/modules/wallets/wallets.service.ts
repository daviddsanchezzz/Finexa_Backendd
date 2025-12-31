import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateWalletDto, ReorderWalletsDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';

@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

async create(userId: number, dto: CreateWalletDto) {
  // 1. Obtener la última posición actual del usuario
  const lastWallet = await this.prisma.wallet.findFirst({
    where: { userId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const nextPosition = lastWallet ? lastWallet.position + 1 : 0;

  // 2. Crear la wallet con position calculada
  return this.prisma.wallet.create({
    data: {
      ...dto,
      userId,
      position: nextPosition,
    },
  });
}

  async findAll(userId: number) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, active: true },
      orderBy: [
        { position: 'asc' },
        { name: 'asc' },
      ],
    
    });
    return wallets;
  }

  async findOne(userId: number, id: number) {
    const walletId = Number(id); 
    if (Number.isNaN(walletId)) throw new BadRequestException('id inválido')
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, userId, active: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async update(userId: number, id: number, dto: UpdateWalletDto) {
    await this.findOne(userId, id);
    return this.prisma.wallet.update({
      where: { id },
      data: dto,
    });
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    return this.prisma.wallet.update({
      where: { id },
      data: { active: false },
    });
  }

  async reorder(userId: number, dto: ReorderWalletsDto) {
    const { order } = dto;

    if (!order || order.length === 0) {
      throw new BadRequestException('order no puede estar vacío');
    }

    // 1) Comprobamos que todas las wallets existen y pertenecen al usuario
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId,
        active: true,
        id: { in: order },
      },
      select: { id: true },
    });

    if (wallets.length !== order.length) {
      // Algún id no existe o no es del usuario
      throw new ForbiddenException('Algunas carteras no pertenecen al usuario actual');
    }

    // 2) Actualizamos posiciones dentro de una transacción
    await this.prisma.$transaction(
      order.map((id, index) =>
        this.prisma.wallet.update({
          where: { id },
          data: { position: index }, // 0,1,2,3...
        }),
      ),
    );

    // 3) Devolvemos la lista ya ordenada
    return this.prisma.wallet.findMany({
      where: { userId, active: true },
      orderBy: { position: 'asc' },
    });
  }


}
