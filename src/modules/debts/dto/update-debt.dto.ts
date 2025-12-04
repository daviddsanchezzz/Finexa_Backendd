// src/debts/dto/update-debt.dto.ts
import { PartialType } from "@nestjs/mapped-types";
import { CreateDebtDto } from "./create-debt.dto";

export class UpdateDebtDto extends PartialType(CreateDebtDto) {}
