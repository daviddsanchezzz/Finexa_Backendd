import { IsArray, ArrayNotEmpty, IsInt } from 'class-validator';

export class AttachProjectTransactionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  transactionIds: number[];
}

