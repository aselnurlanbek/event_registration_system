import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { EventOwnerGuard } from '../auth/guards/event-owner.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CheckInDto } from './dto/check-in.dto';
import { CheckInService } from './check-in.service';

@Controller('events/:eventId/check-in')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  // Organizer-only, owner of the event.
  @Post()
  @HttpCode(200) // 200 on first successful check-in (req. 5)
  @UseGuards(JwtAuthGuard, RolesGuard, EventOwnerGuard)
  @Roles(Role.ORGANIZER)
  checkIn(@Param('eventId') eventId: string, @Body() dto: CheckInDto) {
    return this.checkInService.checkIn(eventId, dto.ticketCode);
  }
}