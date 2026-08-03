import { Module } from "@nestjs/common";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { WorldService } from "./world.service";
import { WorldController } from "./world.controller";

@Module({
  imports: [PrismaModule],
  controllers: [WorldController],
  providers: [WorldService],
})
export class WorldModule {}
