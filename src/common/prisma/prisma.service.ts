// prisma.service.ts
import { INestApplication, Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: ["error"],
    });
  }
  return globalForPrisma.prisma;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Reutiliza la MISMA instancia en dev/watch
    const client = getPrismaClient();

    // PrismaClient no permite “inyectar” una instancia ya creada en super().
    // Lo que sí podemos hacer es evitar crear múltiples *procesos* y además
    // asegurar que el cliente global sea el que conecte.
    super();

    // Truco: en dev, apuntamos los métodos del PrismaService al cliente global
    // para que todos los módulos usen el mismo pool.
    if (process.env.NODE_ENV !== "production") {
      Object.assign(this, client);
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  enableShutdownHooks(app: INestApplication) {
    const shutdown = async () => {
      await app.close();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
