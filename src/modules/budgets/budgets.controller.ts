import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { BudgetsService } from "./budgets.service";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { UpdateBudgetDto } from "./dto/update-budget.dto";
import { BudgetsOverviewQueryDto } from "./dto/budgets-overview.query.dto";
import { User } from "src/common/decorators/user.decorator"; // asumo que tienes @User('userId')

@Controller("budgets")
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get("overview")
  overview(@User("userId") userId: number, @Query() query: BudgetsOverviewQueryDto) {
    return this.budgetsService.overview(userId, query);
  }

  @Get()
  findAll(@User("userId") userId: number) {
    return this.budgetsService.findAll(userId);
  }

  @Get(":id")
  findOne(@User("userId") userId: number, @Param("id") id: string) {
    return this.budgetsService.findOne(userId, Number(id));
  }

  @Post()
  create(@User("userId") userId: number, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(userId, dto);
  }

  @Patch(":id")
  update(
    @User("userId") userId: number,
    @Param("id") id: string,
    @Body() dto: UpdateBudgetDto
  ) {
    return this.budgetsService.update(userId, Number(id), dto);
  }

  @Delete(":id")
  remove(@User("userId") userId: number, @Param("id") id: string) {
    return this.budgetsService.remove(userId, Number(id));
  }
}
