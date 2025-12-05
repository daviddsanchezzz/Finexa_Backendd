// src/trips/dto/update-trip-plan-item.dto.ts
import { PartialType } from "@nestjs/mapped-types";
import { CreateTripPlanItemDto } from "./create-trip-plan-item.dto";

export class UpdateTripPlanItemDto extends PartialType(CreateTripPlanItemDto) {}
