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

  // Query string tal cual la manda el Shortcut, sin parsear — solo para
  // depurar por qué a veces el comercio llega vacío.
  @IsOptional()
  @IsString()
  rawQuery?: string;
}

export class CreateQuickTransactionViaTokenDto extends CreateQuickTransactionDto {
  // Token largo del usuario (ver User.quickAddToken) — identifica al usuario
  // sin sesión activa, para automatizaciones externas (Shortcuts por NFC).
  @IsString()
  @IsNotEmpty()
  token: string;
}
