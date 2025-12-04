import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  create(@User('userId') userId: number, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(userId, dto);
  }

  @Get()
  findAll(@User('userId') userId: number) {
    return this.budgetsService.findAll(userId);
  }

  @Get(':id')
  findOne(@User('userId') userId: number, @Param('id') id: string) {
    return this.budgetsService.findOne(userId, +id);
  }

  @Get(':id/progress')
  getProgress(@User('userId') userId: number, @Param('id') id: string) {
    return this.budgetsService.getProgress(userId, +id);
  }

  @Patch(':id')
  update(
    @User('userId') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(userId, +id, dto);
  }

  @Delete(':id')
  remove(@User('userId') userId: number, @Param('id') id: string) {
    return this.budgetsService.remove(userId, +id);
  }

  @Get(':id/history')
getHistory(
  @User('userId') userId: number,
  @Param('id') id: string
) {
  return this.budgetsService.getHistory(userId, +id);
}

@Post(':id/close-period')
forceClose(
  @User('userId') userId: number,
  @Param('id') id: string
) {
  return this.budgetsService.closeCurrentPeriod(userId, +id, true);
}

}
