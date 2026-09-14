import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Optional; defaults to PARTICIPANT. See AuthService for the note on allowing
  // ORGANIZER self-registration in this demo build.
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}