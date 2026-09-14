import { IsEmail } from 'class-validator';

export class CancelRegistrationDto {
  @IsEmail()
  email!: string;
}