import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  // ISO 8601 string (e.g. "2026-10-01T18:00:00Z"). Stored in UTC — see service.
  @IsISO8601()
  startsAt!: string;

  @IsInt()
  @Min(1) // capacity must be greater than 0
  capacity!: number;
}