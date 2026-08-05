import { IsString, IsNumber, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateQuickTransactionDto {
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  merchant?: string;

  @IsOptional()
  @IsString()
  cardName?: string;

  @IsString()
  @IsNotEmpty()
  qid: string;
}
