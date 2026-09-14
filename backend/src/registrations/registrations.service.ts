import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Registration, RegistrationStatus, Ticket } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

export type RegistrationWithTicket = Registration & { ticket: Ticket | null };

export interface EventRegistrations {
  eventId: string;
  counts: { registered: number; waitlisted: number };
  registered: RegistrationWithTicket[];
  waitlisted: RegistrationWithTicket[];
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
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
  ): Promise<RegistrationWithTicket> {
    const email = this.normalizeEmail(rawEmail);

    return this.prisma.$transaction(async (tx) => {
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
        return this.upsertRegistered(tx, eventId, email, existing);
      }
      return this.upsertWaitlisted(tx, eventId, email, existing);
    });
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

  // --- helpers -------------------------------------------------------------

  private async upsertRegistered(
    tx: Prisma.TransactionClient,
    eventId: string,
    email: string,
    existing: RegistrationWithTicket | null,
  ): Promise<RegistrationWithTicket> {
    const code = this.generateTicketCode();

    if (existing) {
      // Reviving a previously CANCELLED registration: keep an existing ticket
      // if present, otherwise mint a new one.
      return tx.registration.update({
        where: { id: existing.id },
        data: {
          status: RegistrationStatus.REGISTERED,
          waitlistPos: null,
          ...(existing.ticket ? {} : { ticket: { create: { code } } }),
        },
        include: { ticket: true },
      });
    }

    return tx.registration.create({
      data: {
        eventId,
        email,
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
  ): Promise<RegistrationWithTicket> {
    // FIFO position at the tail of the waitlist. Safe because we hold the lock.
    const waitCount = await tx.registration.count({
      where: { eventId, status: RegistrationStatus.WAITLISTED },
    });
    const waitlistPos = waitCount + 1;

    if (existing) {
      return tx.registration.update({
        where: { id: existing.id },
        data: { status: RegistrationStatus.WAITLISTED, waitlistPos },
        include: { ticket: true },
      });
    }

    return tx.registration.create({
      data: {
        eventId,
        email,
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