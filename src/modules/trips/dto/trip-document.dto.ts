import { IsDateString, IsInt, IsObject, IsOptional, IsString } from "class-validator";
import { TripDocumentType } from "@prisma/client";

export { TripDocumentType };

export class CreateTripDocumentDto {
  @IsString() type!: TripDocumentType;

  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() referenceCode?: string;

  @IsOptional() @IsDateString() expiryDate?: string;

  // ISO2 opcional: liga el documento (ej. visado) a un país concreto del viaje.
  @IsOptional() @IsString() country?: string;

  // Campos específicos del tipo (tipo de visado, vigencia de vacuna, cobertura...).
  @IsOptional() @IsObject() metadata?: Record<string, any>;

  @IsOptional() @IsString() fileUrl?: string;

  @IsOptional() @IsString() fileName?: string;

  @IsOptional() @IsString() fileMimeType?: string;

  // Plan item (type="expense") ya existente al que enlazar este documento para llevar su coste.
  @IsOptional() @IsInt() planItemId?: number;
}

export class UpdateTripDocumentDto {
  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() referenceCode?: string;

  @IsOptional() @IsDateString() expiryDate?: string;

  @IsOptional() @IsString() country?: string;

  @IsOptional() @IsObject() metadata?: Record<string, any>;

  @IsOptional() @IsString() fileUrl?: string;

  @IsOptional() @IsString() fileName?: string;

  @IsOptional() @IsString() fileMimeType?: string;

  @IsOptional() @IsInt() planItemId?: number;
}
