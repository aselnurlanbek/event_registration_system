import { Injectable } from '@nestjs/common';
import { RegistrationStatus } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

export interface EventStats {
  capacity: number;
  registered: number;
  waitlisted: number;
  checkedIn: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async getStats(eventId: string): Promise<EventStats> {
    const event = await this.events.findOne(eventId); // 404 if missing

    const [registered, waitlisted, checkedIn] = await Promise.all([
      this.prisma.registration.count({
        where: { eventId, status: RegistrationStatus.REGISTERED },
      }),
      this.prisma.registration.count({
        where: { eventId, status: RegistrationStatus.WAITLISTED },
      }),
      this.prisma.registration.count({
        where: {
          eventId,
          status: RegistrationStatus.REGISTERED,
          checkedInAt: { not: null },
        },
      }),
    ]);

    return { capacity: event.capacity, registered, waitlisted, checkedIn };
  }
}