import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

// income/expense afectan al resultado del proyecto. contribution/withdrawal son
// movimientos de capital de un socio (aportación/retirada) y nunca afectan al
// resultado, solo a la caja disponible.
export enum ProjectMovementKindDto {
  income = 'income',
  expense = 'expense',
  contribution = 'contribution',
  withdrawal = 'withdrawal',
}

export class CreateProjectManualEntryDto {
  @IsEnum(ProjectMovementKindDto)
  kind: ProjectMovementKindDto;

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

  // Obligatorio (validado en el servicio) cuando kind es contribution o withdrawal.
  @IsOptional()
  @IsInt()
  partnerId?: number;
}

export class UpdateProjectManualEntryDto extends PartialType(CreateProjectManualEntryDto) {}
