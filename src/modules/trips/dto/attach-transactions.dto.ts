// trips/dto/attach-transactions.dto.ts
import { IsArray, ArrayNotEmpty, IsInt } from "class-validator";

export class AttachTransactionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  transactionIds: number[];
}
