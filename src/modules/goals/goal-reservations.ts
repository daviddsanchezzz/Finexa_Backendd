import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// Serializes reservations for a user, including wallet deactivation. Serializable
// isolation also detects a wallet balance changing during validation.
export async function withGoalLock<T>(prisma: PrismaService, userId: number, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${userId}::integer, 71001)`;
        return work(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
  throw new ConflictException('El saldo o las asignaciones han cambiado. Recarga e inténtalo de nuevo.');
}
