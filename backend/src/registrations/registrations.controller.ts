import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateRegistrationDto } from './dto/create-registration.dto';
import { RegistrationsService } from './registrations.service';

@Controller('events/:eventId/registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Post()
  register(
    @Param('eventId') eventId: string,
    @Body() dto: CreateRegistrationDto,
  ) {
    return this.registrations.register(eventId, dto.email);
  }

  @Get()
  list(@Param('eventId') eventId: string) {
    return this.registrations.findByEvent(eventId);
  }
}