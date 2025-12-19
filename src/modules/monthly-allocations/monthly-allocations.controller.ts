// src/modules/monthly-allocations/monthly-allocations.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AllocationPlanService } from './monthly-allocations.service';
import { CreateAllocationItemDto } from './dto/create-item.dto';
import { UpdateAllocationItemDto } from './dto/update-item.dto';
import { UpdateAllocationPlanDto } from './dto/upsert-plan.dto';
import { User } from 'src/common/decorators/user.decorator';

@Controller('allocation-plan')
export class AllocationPlanController {
  constructor(private readonly service: AllocationPlanService) {}

  // -----------------------------
  // Plan
  // -----------------------------
  // GET /allocation-plan
  @Get()
  get(@User('userId') userId: number) {
    return this.service.get(userId);
  }

  // PATCH /allocation-plan (actualiza income/currency si procede)
  @Patch()
  updatePlan(
    @User('userId') userId: number,
    @Body() dto: UpdateAllocationPlanDto,
  ) {
    return this.service.updatePlan(userId, dto);
  }

  // -----------------------------
  // Items
  // -----------------------------
  // POST /allocation-plan/items
  @Post('items')
  addItem(
    @User('userId') userId: number,
    @Body() dto: CreateAllocationItemDto,
  ) {
    return this.service.addItem(userId, dto);
  }

  // PATCH /allocation-plan/items/:id
  @Patch('items/:id')
  updateItem(
    @User('userId') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAllocationItemDto,
  ) {
    return this.service.updateItem(userId, id, dto);
  }

  // DELETE /allocation-plan/items/:id
  @Delete('items/:id')
  deleteItem(
    @User('userId') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.deleteItem(userId, id);
  }
}
