import { IsString, IsOptional, IsDateString, IsArray, IsNumber, Length, Matches, IsEnum, IsInt } from "class-validator";

export enum ContinentDto {
  europe = "europe",
  africa = "africa",
  asia = "asia",
  north_america = "north_america",
  south_america = "south_america",
  oceania = "oceania",
  antarctica = "antarctica",
}

export enum StatusDto {
  seen = "seen",
  wishlist = "wishlist",
  planning = "planning",
}

export class CreateTripDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i, { message: "destination must be ISO country code (e.g. ES, IT, LT)" })
  destination?: string;

  @IsOptional()
@IsEnum(ContinentDto)
continent?: ContinentDto;

  @IsOptional()
@IsEnum(StatusDto)
status?: StatusDto;

@IsOptional()
@IsInt()
year?: number;

  

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  companions?: string[];

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
