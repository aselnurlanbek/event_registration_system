import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { EventOwnerGuard } from '../auth/guards/event-owner.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('events/:eventId/stats')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // Organizer-only, owner of the event.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, EventOwnerGuard)
  @Roles(Role.ORGANIZER)
  getStats(@Param('eventId') eventId: string) {
    return this.dashboard.getStats(eventId);
  }
}