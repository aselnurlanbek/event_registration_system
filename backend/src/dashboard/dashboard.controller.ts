import { Controller, Get, Param } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('events/:eventId/stats')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  getStats(@Param('eventId') eventId: string) {
    return this.dashboard.getStats(eventId);
  }
}