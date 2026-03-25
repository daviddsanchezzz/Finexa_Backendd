import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export enum ProjectEntryTypeDto {
  income = 'income',
  expense = 'expense',
}

export class CreateProjectManualEntryDto {
  @IsEnum(ProjectEntryTypeDto)
  type: ProjectEntryTypeDto;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProjectManualEntryDto extends PartialType(CreateProjectManualEntryDto) {}
