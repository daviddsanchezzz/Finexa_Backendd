import { IsBoolean, IsInt, IsOptional, IsString } from "class-validator";
import { ChecklistCategory } from "@prisma/client";

export { ChecklistCategory };

export class CreateTripChecklistItemDto {
  category: ChecklistCategory;

  @IsString() label: string;

  @IsOptional() @IsInt() order?: number;
}

export class UpdateTripChecklistItemDto {
  @IsOptional() @IsString() label?: string;

  @IsOptional() @IsBoolean() checked?: boolean;

  @IsOptional() @IsInt() order?: number;
}

export class SeedTripChecklistDto {
  items: { category: ChecklistCategory; label: string; order?: number }[];
}
