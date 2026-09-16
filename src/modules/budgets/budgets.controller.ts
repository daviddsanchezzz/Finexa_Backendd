import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { BudgetsService } from "./budgets.service";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { UpdateBudgetDto } from "./dto/update-budget.dto";
import { BudgetsOverviewQueryDto } from "./dto/budgets-overview.query.dto";
import { BudgetsHistoryQueryDto } from "./dto/budgets-history.query.dto";
import { User } from "src/common/decorators/user.decorator"; // asumo que tienes @User('userId')

@Controller("budgets")
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get("overview")
  overview(@User("id") userId: number, @Query() query: BudgetsOverviewQueryDto) {
    return this.budgetsService.overview(userId, query);
  }

  @Get()
  findAll(@User("id") userId: number) {
    return this.budgetsService.findAll(userId);
  }

  @Get(":id")
  findOne(@User("id") userId: number, @Param("id") id: string) {
    return this.budgetsService.findOne(userId, Number(id));
  }

  @Get(":id/history")
  history(
    @User("id") userId: number,
    @Param("id") id: string,
    @Query() query: BudgetsHistoryQueryDto
  ) {
    return this.budgetsService.history(userId, Number(id), query);
  }

  @Get(":id/progress")
  progress(
    @User("id") userId: number,
    @Param("id") id: string,
    @Query("date") date?: string
  ) {
    return this.budgetsService.progress(userId, Number(id), { date });
  }

  @Post()
  create(@User("id") userId: number, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(userId, dto);
  }

  @Patch(":id")
  update(
    @User("id") userId: number,
    @Param("id") id: string,
    @Body() dto: UpdateBudgetDto
  ) {
    return this.budgetsService.update(userId, Number(id), dto);
  }

  @Delete(":id")
  remove(@User("id") userId: number, @Param("id") id: string) {
    return this.budgetsService.remove(userId, Number(id));
  }

  @Delete(":id/permanent")
  hardDelete(@User("id") userId: number, @Param("id") id: string) {
    return this.budgetsService.hardDelete(userId, Number(id));
  }
}
