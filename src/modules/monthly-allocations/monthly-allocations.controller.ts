import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { CreateAllocationItemDto } from './dto/create-item.dto';
import { UpdateAllocationItemDto } from './dto/update-item.dto';
import { AllocationPlanService } from './monthly-allocations.service';
import { UpdateAllocationPlanDto } from './dto/upsert-plan.dto';

@Controller('allocation-plan')
export class AllocationPlanController {
  constructor(private readonly service: AllocationPlanService) {}

  // GET /allocation-plan
  @Get()
  get(@Req() req: any) {
    return this.service.get(req.user.id);
  }

  // PATCH /allocation-plan  (actualiza income)
  @Patch()
  updatePlan(@Req() req: any, @Body() dto: UpdateAllocationPlanDto) {
    return this.service.updatePlan(req.user.id, dto);
  }

  // POST /allocation-plan/items
  @Post('items')
  addItem(@Req() req: any, @Body() dto: CreateAllocationItemDto) {
    return this.service.addItem(req.user.id, dto);
  }

  // PATCH /allocation-plan/items/:id
  @Patch('items/:id')
  updateItem(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAllocationItemDto,
  ) {
    return this.service.updateItem(req.user.id, id, dto);
  }

  // DELETE /allocation-plan/items/:id
  @Delete('items/:id')
  deleteItem(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteItem(req.user.id, id);
  }
}
