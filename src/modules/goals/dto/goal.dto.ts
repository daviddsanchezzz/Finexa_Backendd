import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { GoalStatus, GoalTrackingMode } from '@prisma/client';

export class AllocationDto {
  @IsInt() @Min(1) walletId: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999999.99) amount: number;
}

export class SetAllocationsDto {
  @IsArray() @ArrayUnique((a: AllocationDto) => a.walletId)
  @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations: AllocationDto[];
}

export class GoalFieldsDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(64) icon?: string | null;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string | null;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999999999.99) targetAmount: number;
  @IsOptional() @IsDateString() targetDate?: string | null;
  @IsOptional() @IsDateString() startDate?: string;
}

export class CreateGoalDto extends GoalFieldsDto {
  @IsEnum(GoalTrackingMode) trackingMode: GoalTrackingMode;
  @IsString() @Length(3, 3) @Matches(/^[A-Z]{3}$/) currency: string;
  @IsOptional() @IsInt() @Min(1) linkedWalletId?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999999.99) initialAmount?: number;
  @IsOptional() @IsArray() @ArrayUnique((a: AllocationDto) => a.walletId)
  @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
}

// Currency and tracking mode are intentionally immutable: changing either
// requires an explicit migration of the progress source, not a metadata edit.
export class UpdateGoalDto extends PartialType(GoalFieldsDto) {}

export class GoalStatusDto {
  @IsEnum(GoalStatus) status: GoalStatus;
}

export class ManualEntryDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-999999999999.99) @Max(999999999999.99) amount: number;
  @IsDateString() date: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}
