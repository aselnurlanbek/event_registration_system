import { IsEmail } from 'class-validator';

export class CreateRegistrationDto {
  @IsEmail()
  email!: string;
}