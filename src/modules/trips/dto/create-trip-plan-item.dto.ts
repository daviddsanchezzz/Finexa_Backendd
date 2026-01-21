// src/trips/dto/create-trip-plan-item.dto.ts
import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateNested,
  IsBoolean,
} from "class-validator";
import { AccommodationDetailsDto } from "./accommodation-details.dto";

// 👇 Enum de tipos alineado con Prisma
export enum TripPlanItemType {
  // ===== Logistics =====
  flight = "flight",
  accommodation = "accommodation",

  transport_destination = "transport_destination",
  transport_local = "transport_local",

  // legacy (NO borrar)
  transport = "transport",
  taxi = "taxi",

  // ===== Generic / base =====
  activity = "activity",
  expense = "expense",

  // ===== Culture & tourism =====
  museum = "museum",
  monument = "monument",
  viewpoint = "viewpoint",
  free_tour = "free_tour",
  guided_tour = "guided_tour",

  // ===== Leisure / entertainment =====
  concert = "concert",
  sport = "sport",
  bar_party = "bar_party",
  nightlife = "nightlife",

  // ===== Nature =====
  beach = "beach",
  hike = "hike",

  // ===== Gastronomy =====
  restaurant = "restaurant",
  cafe = "cafe",
  market = "market",

  // ===== Shopping =====
  shopping = "shopping",

  // ===== Excursions =====
  day_trip = "day_trip",

  // ===== Fallback =====
  other = "other",
}

export enum PaymentStatus {
  pending = "pending",
  paid = "paid",
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
  @IsString()
  day?: string;

  @IsOptional()
  @IsString()
  startAt?: string;

  @IsOptional()
  @IsString()
  endAt?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;


  @IsOptional()
  @IsString()
  timezone?: string | null;

  @IsOptional()
  @IsNumber()
  cost?: number | null;

    @IsOptional()
  @IsString()
  currency?: string | null;

  @IsOptional()
  @IsBoolean()
  logistics?: boolean;

  @IsOptional()
  metadata?: any;

  

  @IsOptional()
  @ValidateNested()
  @Type(() => AccommodationDetailsDto)
  accommodationDetails?: AccommodationDetailsDto;

}


export class SetPaymentStatusDto {
  @IsEnum(PaymentStatus)
  paymentStatus: PaymentStatus;
}
