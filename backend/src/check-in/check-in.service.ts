import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CheckInResult {
  ticketCode: string;
  status: 'CHECKED_IN';
  checkedInAt: Date;
  participant: { id: string; email: string };
}

@Injectable()
export class CheckInService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check in a ticket. Single-use is guaranteed at the DATABASE level, not in
   * application memory (see docs/ARCHITECTURE.md §9): the write is a single
   * conditional UPDATE guarded by `checkedInAt IS NULL`. Postgres row-locks the
   * row for the duration of each UPDATE, so of two concurrent check-ins the
   * first sets `checkedInAt` and the second's WHERE no longer matches → 0 rows
   * affected → 409. Exactly one succeeds.
   */
  async checkIn(eventId: string, ticketCode: string): Promise<CheckInResult> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { code: ticketCode },
      include: { registration: true },
    });

    // Invalid ticket (req. 7).
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketCode} not found`);
    }
    // The ticket must belong to the specified event (req. 1).
    if (ticket.registration.eventId !== eventId) {
      throw new NotFoundException(
        `Ticket ${ticketCode} does not belong to event ${eventId}`,
      );
    }
    // Only a currently REGISTERED participant may check in (req. 2).
    if (ticket.registration.status !== RegistrationStatus.REGISTERED) {
      throw new ConflictException(
        `Participant is not registered (status: ${ticket.registration.status})`,
      );
    }
    // Fast path for an obvious repeat (req. 6). The atomic guard below is the
    // real protection; this just yields a clear message in the common case.
    if (ticket.registration.checkedInAt) {
      throw new ConflictException(`Ticket ${ticketCode} already checked in`);
    }

    // Atomic single-use check-in (req. 3, 8).
    const result = await this.prisma.registration.updateMany({
      where: {
        id: ticket.registrationId,
        status: RegistrationStatus.REGISTERED,
        checkedInAt: null,
      },
      data: { checkedInAt: new Date() },
    });

    if (result.count === 0) {
      // Lost the race to a concurrent check-in (or state changed underneath us).
      throw new ConflictException(`Ticket ${ticketCode} already checked in`);
    }

    const updated = await this.prisma.registration.findUniqueOrThrow({
      where: { id: ticket.registrationId },
    });

    return {
      ticketCode,
      status: 'CHECKED_IN',
      checkedInAt: updated.checkedInAt!,
      participant: { id: updated.id, email: updated.email },
    };
  }
}