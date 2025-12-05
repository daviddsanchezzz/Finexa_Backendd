// trips/dto/create-trip.dto.ts
import { IsString, IsOptional, IsDateString, IsArray, IsNumber } from "class-validator";

export class CreateTripDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsArray()
  companions?: string[]; // o string si al final guardas un texto plano

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsNumber()
  budget?: number;

    @IsOptional()
  @IsNumber()
  cost?: number;

}

// trips/dto/update-trip.dto.ts
import { PartialType } from "@nestjs/mapped-types";

export class UpdateTripDto extends PartialType(CreateTripDto) {}
