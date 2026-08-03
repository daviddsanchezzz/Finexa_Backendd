import { IsDateString, IsInt, IsOptional, IsString } from "class-validator";
import { TripDocumentType } from "@prisma/client";

export { TripDocumentType };

export class UpsertTripDocumentDto {
  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() referenceCode?: string;

  @IsOptional() @IsDateString() expiryDate?: string;

  // Plan item (type="expense") ya existente al que enlazar este documento para llevar su coste.
  @IsOptional() @IsInt() planItemId?: number;
}
