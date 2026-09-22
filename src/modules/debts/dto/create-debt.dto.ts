// src/debts/dto/create-debt.dto.ts
import { IsString, IsOptional, IsNumber, IsEnum, IsDateString, IsBoolean, IsInt } from "class-validator";

export enum DebtTypeDto {
  LOAN = "loan",
  MORTGAGE = "mortgage",
  CREDIT_CARD = "credit_card",
  PERSONAL = "personal",
  OTHER = "other",
}

export enum DebtDirectionDto {
  I_OWE = "i_ow",
  THEY_OWE = "they_owe",
}

export enum DebtPaymentFrequencyDto {
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly",
}

export class CreateDebtDto {
  @IsEnum(DebtTypeDto)
  type: DebtTypeDto = DebtTypeDto.LOAN;

  @IsEnum(DebtDirectionDto)
  direction: DebtDirectionDto = DebtDirectionDto.I_OWE;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNumber()
  totalAmount: number;

  // ISO 4217. Si no se manda y hay walletId, hereda la moneda de esa cartera;
  // si no, la moneda base del usuario (se resuelve en el service).
  @IsOptional()
  @IsString()
  currency?: string;

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
  @IsEnum(DebtPaymentFrequencyDto)
  paymentFrequency?: DebtPaymentFrequencyDto;

  @IsOptional()
  @IsInt()
  walletId?: number;

  @IsOptional()
  @IsBoolean()
  autoRecurringEnabled?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;

  @IsOptional()
  @IsDateString()
  expectedEndDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  installmentsPaid?: number;
}
