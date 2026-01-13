// prisma.service.ts
import { INestApplication, Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
  await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on("SIGTERM", async () => {
      await app.close();
      process.exit(0);
    });
    process.on("SIGINT", async () => {
      await app.close();
      process.exit(0);
    });
  }
}
