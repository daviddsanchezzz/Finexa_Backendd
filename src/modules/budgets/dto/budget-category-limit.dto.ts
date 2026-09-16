import { IsInt, IsNumber, IsPositive } from "class-validator";

export class BudgetCategoryLimitDto {
  @IsInt()
  categoryId!: number;

  @IsNumber()
  @IsPositive()
  limit!: number;
}
