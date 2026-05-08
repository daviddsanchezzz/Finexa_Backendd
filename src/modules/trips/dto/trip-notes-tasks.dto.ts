import { IsBoolean, IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export enum TaskStatus {
    to_do = "to_do",
    done = "done",    
}    
// ---------- NOTES ----------
export class CreateTripNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class UpdateTripNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

// ---------- TASKS ----------
export class CreateTripTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(["low", "medium", "high"])
  priority?: "low" | "medium" | "high";

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateTripTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(["low", "medium", "high"])
  priority?: "low" | "medium" | "high";

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
