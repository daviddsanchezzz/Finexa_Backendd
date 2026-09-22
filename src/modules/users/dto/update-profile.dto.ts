import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  avatar?: string | null;

  // ISO 4217: moneda base del usuario, para consolidar patrimonio/estadísticas.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 de 3 letras' })
  currency?: string;
}
