// src/trips/dto/create-trip-plan-item.dto.ts
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
} from "class-validator";

// 👇 Enum de tipos alineado con Prisma
export enum TripPlanItemType {
  // Logistics
  flight = "flight",
  accommodation = "accommodation",
  transport = "transport",
  taxi = "taxi",

  // Culture & tourism
  museum = "museum",
  monument = "monument",
  viewpoint = "viewpoint",

  // Leisure / entertainment
  free_tour = "free_tour",
  concert = "concert",
  bar_party = "bar_party",

  // Nature
  beach = "beach",

  // Gastronomy
  restaurant = "restaurant",

  // Shopping
  shopping = "shopping",

  // Generic
  other = "other",
}

export class CreateTripPlanItemDto {
  @IsEnum(TripPlanItemType)
  type: TripPlanItemType;

  @IsString()
  title: string;

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsISO8601()
  startTime?: string;

  @IsOptional()
  @IsISO8601()
  endTime?: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsInt()
  transactionId?: number | null;

  @IsOptional()
  @IsNumber()
  cost?: number | null;
}
