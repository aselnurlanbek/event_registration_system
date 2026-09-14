import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EventsService } from './events.service';

@Controller('organizer/events')
export class OrganizerEventsController {
  constructor(private readonly eventsService: EventsService) {}

  // The logged-in organizer's own events only.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORGANIZER)
  myEvents(@CurrentUser() user: AuthUser) {
    return this.eventsService.findByOrganizer(user.userId);
  }
}