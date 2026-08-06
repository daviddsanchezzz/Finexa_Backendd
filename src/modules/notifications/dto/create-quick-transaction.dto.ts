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

  // Id de correlación para hacer match exacto con la transacción cuando se
  // cree desde la app. Opcional: si no lo manda el cliente (ej. una llamada
  // directa desde Shortcuts sin pasar por la app), el backend genera uno.
  @IsOptional()
  @IsString()
  qid?: string;

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
