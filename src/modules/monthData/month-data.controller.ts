import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  ParseIntPipe,
} from "@nestjs/common";
import { MonthDataService } from "./month-data.service";
import { MonthDataDto } from "./dto/month-data.dto";
import { User } from "src/common/decorators/user.decorator";

@Controller("manual-month")
export class MonthDataController {
  constructor(private service: MonthDataService) {}

  // CREAR / ACTUALIZAR OVERRIDE
  @Post()
  async upsert(@User('id') userId: number, @Body() dto: MonthDataDto) {
     return this.service.upsert(userId, dto);
  }

  // LISTAR TODOS
  @Get()
  async findAll(@User('id') userId: number) {
    return this.service.findAll(userId);
  }

  // LISTAR POR AÑO
  @Get(":year")
  async findByYear(
    @User('id') userId: number,
    @Param("year", ParseIntPipe) year: number
  ) {
    return this.service.findByYear(userId, year);
  }

  // ELIMINAR OVERRIDE (DESACTIVAR)
  @Delete(":year/:month")
  async delete(
    @User('id') userId: number,
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    return this.service.delete(userId, year, month);
  }
}
