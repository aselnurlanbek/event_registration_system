import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Event,
  EmailType,
  EventStatus,
  Prisma,
  RegistrationStatus,
} from '@prisma/client';
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

  /** Public browse — only ACTIVE events (cancelled ones are hidden here). */
  async findAll(): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { status: EventStatus.ACTIVE },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Events owned by an organizer (incl. cancelled, for organizer history). */
  async findByOrganizer(organizerId: string): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { organizerId },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Soft-cancel an event (DELETE endpoint). No rows are destroyed — the event is
   * flagged CANCELLED and kept for history. See docs for full behavior:
   * - new registrations and check-ins are refused (enforced in those services);
   * - future reminders stop (the scheduler skips non-ACTIVE events);
   * - existing REGISTERED/WAITLISTED rows + tickets are preserved as history;
   * - affected participants get one EVENT_CANCELLED email (idempotent).
   * Idempotent: cancelling an already-cancelled event is a no-op.
   */
  async cancelEvent(id: string): Promise<{
    eventId: string;
    status: EventStatus;
    alreadyCancelled: boolean;
    notified: number;
  }> {
    const event = await this.findOne(id); // 404 if missing
    if (event.status === EventStatus.CANCELLED) {
      return {
        eventId: id,
        status: EventStatus.CANCELLED,
        alreadyCancelled: true,
        notified: 0,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id },
        data: { status: EventStatus.CANCELLED, cancelledAt: new Date() },
      });

      // Notify everyone with an active (REGISTERED or WAITLISTED) registration.
      const affected = await tx.registration.findMany({
        where: {
          eventId: id,
          status: {
            in: [RegistrationStatus.REGISTERED, RegistrationStatus.WAITLISTED],
          },
        },
      });
      const notified = await this.email.recordInTx(
        tx,
        affected.map((r) => ({
          type: EmailType.EVENT_CANCELLED,
          recipient: r.email,
          eventId: id,
          registrationId: r.id,
          deduplicationKey: `event-cancelled:${id}:${r.id}`,
          payload: {
            title: event.title,
            startsAt: event.startsAt.toISOString(),
          },
        })),
      );

      return {
        eventId: id,
        status: EventStatus.CANCELLED,
        alreadyCancelled: false,
        notified,
      };
    });
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