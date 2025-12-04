// src/debts/debts.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
} from "@nestjs/common";
import { DebtsService } from "./debts.service";
import { CreateDebtDto } from "./dto/create-debt.dto";
import { UpdateDebtDto } from "./dto/update-debt.dto";
import { User } from "src/common/decorators/user.decorator";

@Controller("debts")
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Post()
  async create(@User('userId') userId: number, @Body() dto: CreateDebtDto) {
    return this.debtsService.create(userId, dto);
  }

  @Get()
  async findAll(@User('userId') userId: number) {
    return this.debtsService.findAll(userId);
  }

  @Get(":id")
  async findOne(@User('userId') userId: number, @Param("id") id: string) {
    return this.debtsService.findOne(userId, Number(id));
  }

  @Get(":id/detail")
  async getDetail(@User('userId') userId: number, @Param("id") id: string) {
    return this.debtsService.getDetail(userId, Number(id));
  }

  @Patch(":id")
  async update(
    @User('userId') userId: number,
    @Param("id") id: string,
    @Body() dto: UpdateDebtDto,
  ) {
    return this.debtsService.update(userId, Number(id), dto);
  }

  // 🔹 Cerrar deuda
  @Patch(":id/close")
  async close(@User('userId') userId: number, @Param("id") id: string) {
    return this.debtsService.close(userId, Number(id));
  }

  // (Opcional) borrar de verdad o soft delete separado del cierre
  @Delete(":id")
  async remove(@User('userId') userId: number, @Param("id") id: string) {
    return this.debtsService.remove(userId, Number(id));
  }
}
