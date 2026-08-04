import { IsString, IsOptional, IsDateString, IsArray, IsNumber, Length, Matches, IsEnum, IsInt, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

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

export class CountryStayDto {
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i, { message: "country must be ISO country code (e.g. ES, IT, LT)" })
  country: string;

  @IsOptional()
  @IsEnum(ContinentDto)
  continent?: ContinentDto;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
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

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  // When provided, replaces the trip's country stays wholesale (each with
  // its own optional date sub-range) and derives destination/continent/
  // startDate/endDate as the "primary" (earliest) stay + overall range.
  // Omit entirely to keep single-country create/edit flows working exactly
  // as before.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountryStayDto)
  countryStays?: CountryStayDto[];
}


// trips/dto/update-trip.dto.ts
import { PartialType } from "@nestjs/mapped-types";

export class UpdateTripDto extends PartialType(CreateTripDto) {}
