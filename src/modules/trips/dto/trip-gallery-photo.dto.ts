import { IsDateString, IsOptional, IsString } from "class-validator";

export class CreateTripGalleryPhotoDto {
  @IsString() url!: string;

  @IsOptional() @IsString() fileName?: string;

  @IsOptional() @IsString() mimeType?: string;

  // Día del viaje al que pertenece la foto; si se omite, va a "general del viaje".
  @IsOptional() @IsDateString() dayDate?: string;
}
