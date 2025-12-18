import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum AllocationCategoryDto {
  expense = 'expense',
  investment = 'investment',
  savings = 'savings',
}

export class CreateAllocationItemDto {
  @IsEnum(AllocationCategoryDto)
  category: AllocationCategoryDto;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsNumber()
  order?: number;
}
