import { PartialType } from '@nestjs/mapped-types';
import { CreateEventDto } from './create-event.dto';

// All fields optional; validation rules are inherited from CreateEventDto.
export class UpdateEventDto extends PartialType(CreateEventDto) {}