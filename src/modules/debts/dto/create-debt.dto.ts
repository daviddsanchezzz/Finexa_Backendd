// src/debts/dto/create-debt.dto.ts
import { IsString, IsOptional, IsNumber, IsEnum, IsDateString } from "class-validator";

export enum DebtTypeDto {
  LOAN = "loan",
  PERSONAL = "personal",
}

export enum DebtDirectionDto {
  I_OWE = "i_ow",
  THEY_OWE = "they_owe",
}

export class CreateDebtDto {
  @IsEnum(DebtTypeDto)
  type: DebtTypeDto = DebtTypeDto.LOAN;

  @IsEnum(DebtDirectionDto)
  direction: DebtDirectionDto = DebtDirectionDto.I_OWE;

  @IsString()
  name: string;

  @IsString()
  entity: string;

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNumber()
  totalAmount: number;

  @IsOptional()
  @IsNumber()
  payed?: number;

  @IsOptional()
  @IsNumber()
  interestRate?: number;

  @IsOptional()
  @IsNumber()
  monthlyPayment?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;

  @IsOptional()
  @IsNumber()
  installmentsPaid?: number;
}
