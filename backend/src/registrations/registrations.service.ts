import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EmailType,
  Prisma,
  Registration,
  RegistrationStatus,
  Ticket,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { EmailService } from '../email/email.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';

export type RegistrationWithTicket = Registration & { ticket: Ticket | null };

export interface EventRegistrations {
  eventId: string;
  counts: { registered: number; waitlisted: number };
  registered: RegistrationWithTicket[];
  waitlisted: RegistrationWithTicket[];
}

export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  waitlistPos: number | null;
  checkedInAt: Date | null;
  createdAt: Date;
  ticketCode: string | null;
  event: {
    id: string;
    title: string;
    description: string | null;
    startsAt: Date;
    capacity: number;
  };
}

export interface CancelResult {
  registration: RegistrationWithTicket;
  // true only when this call performed the cancellation (false on a repeat).
  cancelled: boolean;
  alreadyCancelled: boolean;
  // the waitlisted participant auto-promoted into the freed spot, if any.
  promoted: RegistrationWithTicket | null;
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeStatsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Register a participant for an event.
   *
   * Concurrency strategy (see docs/ARCHITECTURE.md §8): a single interactive
   * transaction that FIRST takes a pessimistic row lock on the event row
   * (`SELECT ... FOR UPDATE`). This serializes all registrations for the same
   * event, so the "count REGISTERED then decide" step can never race — two
   * concurrent requests for the last seat are forced into a strict order, and
   * the second one observes the now-full count and is waitlisted. The
   * `@@unique([eventId, email])` constraint is an independent DB-level backstop.
   */
  async register(
    eventId: string,
    rawEmail: string,
    userId?: string,
  ): Promise<RegistrationWithTicket> {
    const email = this.normalizeEmail(rawEmail);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Serialize all registrations for THIS event. Concurrent transactions
      //    block on this lock until the holder commits. Also acts as the
      //    existence check (empty result => no such event).
      const locked = await tx.$queryRaw<{ id: string; capacity: number }[]>`
        SELECT id, capacity FROM "Event" WHERE id = ${eventId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException(`Event ${eventId} not found`);
      }
      const capacity = locked[0].capacity;

      // 2. Application-level idempotency: an active registration already exists.
      const existing = await tx.registration.findUnique({
        where: { eventId_email: { eventId, email } },
        include: { ticket: true },
      });
      if (existing && existing.status !== RegistrationStatus.CANCELLED) {
        return existing; // idempotent — never create a second registration (req. 1)
      }

      // 3. Capacity decision — race-free because we hold the event lock.
      const registeredCount = await tx.registration.count({
        where: { eventId, status: RegistrationStatus.REGISTERED },
      });
      const hasCapacity = registeredCount < capacity;

      if (hasCapacity) {
        const reg = await this.upsertRegistered(tx, eventId, email, existing, userId);
        // REGISTRATION_TICKET on becoming REGISTERED via normal registration.
        await this.email.recordInTx(tx, {
          type: EmailType.REGISTRATION_TICKET,
          recipient: email,
          eventId,
          registrationId: reg.id,
          deduplicationKey: `registration-ticket:${reg.id}`,
          payload: { ticketCode: reg.ticket?.code ?? null },
        });
        return reg;
      }
      return this.upsertWaitlisted(tx, eventId, email, existing, userId);
    });

    // Broadcast live stats after commit (covers REGISTERED + WAITLISTED).
    await this.realtime.broadcast(eventId);
    return result;
  }

  /**
   * Cancel a participant's registration and, if a REGISTERED spot was freed,
   * automatically promote the earliest WAITLISTED participant into it.
   *
   * Atomicity (req. 3): the cancellation, the freed-spot detection and the
   * promotion all happen inside ONE transaction that holds the same event
   * `FOR UPDATE` lock used by registration. This serializes cancels with each
   * other AND with registrations, so a freed spot can never be handed to two
   * participants, capacity can never be exceeded, and FIFO order is preserved.
   *
   * History is preserved: rows are flipped to CANCELLED, never deleted.
   */
  async cancel(eventId: string, rawEmail: string): Promise<CancelResult> {
    const email = this.normalizeEmail(rawEmail);

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the event row (also serves as existence check → 404).
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException(`Event ${eventId} not found`);
      }

      const reg = await tx.registration.findUnique({
        where: { eventId_email: { eventId, email } },
        include: { ticket: true },
      });
      if (!reg) {
        throw new NotFoundException(
          `No registration for ${email} on event ${eventId}`,
        );
      }

      // Repeated cancellation is a no-op — never triggers another promotion.
      if (reg.status === RegistrationStatus.CANCELLED) {
        return {
          registration: reg,
          cancelled: false,
          alreadyCancelled: true,
          promoted: null,
        };
      }

      const freesASpot = reg.status === RegistrationStatus.REGISTERED;

      const cancelled = await tx.registration.update({
        where: { id: reg.id },
        data: { status: RegistrationStatus.CANCELLED, waitlistPos: null },
        include: { ticket: true },
      });

      // Only a REGISTERED cancellation frees a seat to promote into.
      const promoted = freesASpot ? await this.promoteHead(tx, eventId) : null;

      return {
        registration: cancelled,
        cancelled: true,
        alreadyCancelled: false,
        promoted,
      };
    });

    // Broadcast live stats after commit (covers cancellation + promotion).
    // Skip the no-op repeat-cancel case — nothing changed.
    if (!result.alreadyCancelled) {
      await this.realtime.broadcast(eventId);
    }
    return result;
  }

  /**
   * Promote the earliest WAITLISTED participant (lowest waitlistPos) to
   * REGISTERED and mint a ticket. Returns null if the waitlist is empty.
   * Must be called inside the event-locked transaction.
   */
  private async promoteHead(
    tx: Prisma.TransactionClient,
    eventId: string,
  ): Promise<RegistrationWithTicket | null> {
    const head = await tx.registration.findFirst({
      where: { eventId, status: RegistrationStatus.WAITLISTED },
      orderBy: [{ waitlistPos: 'asc' }, { createdAt: 'asc' }], // FIFO head
      include: { ticket: true },
    });
    if (!head) {
      return null;
    }

    const code = this.generateTicketCode();
    const promoted = await tx.registration.update({
      where: { id: head.id },
      data: {
        status: RegistrationStatus.REGISTERED,
        waitlistPos: null,
        // Waitlisted rows have no ticket; mint one on promotion (req. 2).
        ...(head.ticket ? {} : { ticket: { create: { code } } }),
      },
      include: { ticket: true },
    });

    // WAITLIST_PROMOTED email, recorded inside the same transaction.
    await this.email.recordInTx(tx, {
      type: EmailType.WAITLIST_PROMOTED,
      recipient: promoted.email,
      eventId,
      registrationId: promoted.id,
      deduplicationKey: `waitlist-promoted:${promoted.id}`,
      payload: { ticketCode: promoted.ticket?.code ?? null },
    });

    return promoted;
  }

  /** List registered + waitlisted participants with counts. */
  async findByEvent(eventId: string): Promise<EventRegistrations> {
    await this.events.findOne(eventId); // 404 if the event is missing

    const registered = await this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.REGISTERED },
      include: { ticket: true },
      orderBy: { createdAt: 'asc' },
    });
    const waitlisted = await this.prisma.registration.findMany({
      where: { eventId, status: RegistrationStatus.WAITLISTED },
      include: { ticket: true },
      orderBy: [{ waitlistPos: 'asc' }, { createdAt: 'asc' }], // FIFO
    });

    return {
      eventId,
      counts: { registered: registered.length, waitlisted: waitlisted.length },
      registered,
      waitlisted,
    };
  }

  /**
   * A participant's own registrations (newest first) with event info + ticket.
   * Matches by userId OR email so pre-account (legacy) rows are included too.
   */
  async findMine(userId: string, rawEmail: string): Promise<MyRegistration[]> {
    const email = this.normalizeEmail(rawEmail);
    const rows = await this.prisma.registration.findMany({
      where: { OR: [{ userId }, { email }] },
      include: { event: true, ticket: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      waitlistPos: r.waitlistPos,
      checkedInAt: r.checkedInAt,
      createdAt: r.createdAt,
      ticketCode: r.ticket?.code ?? null,
      event: {
        id: r.event.id,
        title: r.event.title,
        description: r.event.description,
        startsAt: r.event.startsAt,
        capacity: r.event.capacity,
      },
    }));
  }

  // --- helpers -------------------------------------------------------------

  private async upsertRegistered(
    tx: Prisma.TransactionClient,
    eventId: string,
    email: string,
    existing: RegistrationWithTicket | null,
    userId?: string,
  ): Promise<RegistrationWithTicket> {
    const code = this.generateTicketCode();

    if (existing) {
      // Reviving a previously CANCELLED registration: keep an existing ticket
      // if present, otherwise mint a new one. Backfill userId if now known.
      return tx.registration.update({
        where: { id: existing.id },
        data: {
          status: RegistrationStatus.REGISTERED,
          waitlistPos: null,
          ...(userId ? { userId } : {}),
          ...(existing.ticket ? {} : { ticket: { create: { code } } }),
        },
        include: { ticket: true },
      });
    }

    return tx.registration.create({
      data: {
        eventId,
        email,
        userId,
        status: RegistrationStatus.REGISTERED,
        ticket: { create: { code } }, // ticket only for REGISTERED (reqs. 6, 7)
      },
      include: { ticket: true },
    });
  }

  private async upsertWaitlisted(
    tx: Prisma.TransactionClient,
    eventId: string,
    email: string,
    existing: RegistrationWithTicket | null,
    userId?: string,
  ): Promise<RegistrationWithTicket> {
    // FIFO position at the tail of the waitlist: max existing position + 1.
    // Using max (not count) keeps positions unique even after cancellations
    // leave gaps in the sequence. Safe because we hold the event lock.
    const maxPos = await tx.registration.aggregate({
      where: { eventId, status: RegistrationStatus.WAITLISTED },
      _max: { waitlistPos: true },
    });
    const waitlistPos = (maxPos._max.waitlistPos ?? 0) + 1;

    if (existing) {
      return tx.registration.update({
        where: { id: existing.id },
        data: {
          status: RegistrationStatus.WAITLISTED,
          waitlistPos,
          ...(userId ? { userId } : {}),
        },
        include: { ticket: true },
      });
    }

    return tx.registration.create({
      data: {
        eventId,
        email,
        userId,
        status: RegistrationStatus.WAITLISTED,
        waitlistPos,
      },
      include: { ticket: true },
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateTicketCode(): string {
    // 12 uppercase hex chars; Ticket.code is @unique as a collision backstop.
    return randomBytes(6).toString('hex').toUpperCase();
  }
}