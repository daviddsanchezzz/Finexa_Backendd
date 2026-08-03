import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ChecklistCategory } from "@prisma/client";

export { ChecklistCategory };

export class CreateTripChecklistItemDto {
  @IsEnum(ChecklistCategory) category: ChecklistCategory;

  @IsString() label: string;

  @IsOptional() @IsInt() order?: number;
}

export class UpdateTripChecklistItemDto {
  @IsOptional() @IsString() label?: string;

  @IsOptional() @IsBoolean() checked?: boolean;

  @IsOptional() @IsInt() order?: number;
}

export class SeedTripChecklistDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTripChecklistItemDto)
  items: CreateTripChecklistItemDto[];
}
