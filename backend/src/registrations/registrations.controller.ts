import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/auth.types';
import { EventOwnerGuard } from '../auth/guards/event-owner.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RegistrationsService } from './registrations.service';

@Controller('events/:eventId/registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  // Authenticated participant registers for the event using THEIR OWN identity.
  // Email + userId come from the JWT — an arbitrary body email is never trusted.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PARTICIPANT)
  register(
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.registrations.register(eventId, user.email, user.userId);
  }

  // Cancel own registration (identity from JWT → can only cancel yourself).
  @Post('cancel')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PARTICIPANT)
  cancel(@Param('eventId') eventId: string, @CurrentUser() user: AuthUser) {
    return this.registrations.cancel(eventId, user.email);
  }

  // Organizer view of all registrations — owner only.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, EventOwnerGuard)
  @Roles(Role.ORGANIZER)
  list(@Param('eventId') eventId: string) {
    return this.registrations.findByEvent(eventId);
  }
}