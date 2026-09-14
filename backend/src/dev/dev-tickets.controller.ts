import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DEVELOPMENT-ONLY endpoint. Returns a flat list of an event's tickets (code +
 * participant) for manual testing in Postman. Disabled (404) in production so
 * ticket codes are never exposed there.
 */
@Controller('dev/events/:eventId/tickets')
export class DevTicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@Param('eventId') eventId: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { registration: { eventId } },
      include: { registration: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      _warning: 'DEVELOPMENT-ONLY endpoint — exposes ticket codes for testing.',
      eventId,
      count: tickets.length,
      tickets: tickets.map((t) => ({
        code: t.code,
        email: t.registration.email,
        status: t.registration.status,
        checkedInAt: t.registration.checkedInAt,
        registrationId: t.registrationId,
      })),
    };
  }
}