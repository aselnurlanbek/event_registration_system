import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Event, EmailType, Prisma, RegistrationStatus } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async create(dto: CreateEventDto, organizerId?: string): Promise<Event> {
    return this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        // Parse the ISO string to a Date; Prisma persists it in UTC.
        startsAt: new Date(dto.startsAt),
        capacity: dto.capacity,
        organizerId, // the event belongs to the creating organizer
      },
    });
  }

  async findAll(): Promise<Event[]> {
    return this.prisma.event.findMany({ orderBy: { startsAt: 'asc' } });
  }

  /** Events owned by a specific organizer (for GET /organizer/events). */
  async findByOrganizer(organizerId: string): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { organizerId },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Delete an event (cascade removes registrations/tickets/emails). */
  async remove(id: string): Promise<{ id: string }> {
    await this.findOne(id); // 404 if missing
    await this.prisma.event.delete({ where: { id } });
    return { id };
  }

  async findOne(id: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }

  async update(id: string, dto: UpdateEventDto): Promise<Event> {
    // Ensures the event exists (throws 404 otherwise) and gives us the previous
    // startsAt so we can detect a reschedule.
    const existing = await this.findOne(id);

    const newStartsAt =
      dto.startsAt !== undefined ? new Date(dto.startsAt) : undefined;
    const isRescheduled =
      newStartsAt !== undefined &&
      newStartsAt.getTime() !== existing.startsAt.getTime();

    // The event update and the reschedule notifications are recorded atomically:
    // either the date change AND its EVENT_RESCHEDULED emails commit, or neither.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.event.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          startsAt: newStartsAt,
          capacity: dto.capacity,
        },
      });

      if (isRescheduled) {
        await this.notifyReschedule(tx, existing, updated);
      }

      return updated;
    });
  }

  /**
   * On a startsAt change, record an EVENT_RESCHEDULED email for every currently
   * REGISTERED participant (req. 3). The deduplicationKey includes the new
   * startsAt, so a retry of the same change is idempotent, while a *different*
   * later reschedule correctly produces a fresh notification.
   */
  private async notifyReschedule(
    tx: Prisma.TransactionClient,
    previous: Event,
    updated: Event,
  ): Promise<void> {
    const registered = await tx.registration.findMany({
      where: { eventId: updated.id, status: RegistrationStatus.REGISTERED },
    });
    const newStartsAtIso = updated.startsAt.toISOString();

    const recorded = await this.email.recordInTx(
      tx,
      registered.map((r) => ({
        type: EmailType.EVENT_RESCHEDULED,
        recipient: r.email,
        eventId: updated.id,
        registrationId: r.id,
        deduplicationKey: `event-rescheduled:${updated.id}:${r.id}:${newStartsAtIso}`,
        payload: {
          previousStartsAt: previous.startsAt.toISOString(),
          newStartsAt: newStartsAtIso,
        },
      })),
    );
    this.logger.log(
      `Event ${updated.id} rescheduled → recorded ${recorded} EVENT_RESCHEDULED email(s)`,
    );
  }
}