import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RegistrationsService } from './registrations.service';

@Controller('me/registrations')
export class MeController {
  constructor(private readonly registrations: RegistrationsService) {}

  // The authenticated participant's own registration history.
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PARTICIPANT)
  myRegistrations(@CurrentUser() user: AuthUser) {
    return this.registrations.findMine(user.userId, user.email);
  }
}