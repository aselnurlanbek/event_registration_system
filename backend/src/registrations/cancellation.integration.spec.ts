/**
 * Integration tests for cancellation + automatic waitlist promotion, against a
 * REAL PostgreSQL database (no mocked transactions). Proves the atomic
 * cancel→promote behaviour and its concurrency safety (ARCHITECTURE §8).
 */
import 'dotenv/config';
import { RegistrationStatus } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';
import { RegistrationsService } from './registrations.service';

const realtimeStub = {
  broadcast: async () => {},
} as unknown as RealtimeStatsService;

describe('RegistrationsService cancellation (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let service: RegistrationsService;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new RegistrationsService(
      prisma,
      new EventsService(prisma),
      realtimeStub,
    );
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await prisma.$disconnect();
  });

  async function makeEvent(capacity: number) {
    const event = await prisma.event.create({
      data: {
        title: 'CancellationTest Event',
        startsAt: new Date('2027-02-01T10:00:00.000Z'),
        capacity,
      },
    });
    createdEventIds.push(event.id);
    return event;
  }

  const countBy = (eventId: string, status: RegistrationStatus) =>
    prisma.registration.count({ where: { eventId, status } });

  it('cancels a REGISTERED participant (empty waitlist → no promotion)', async () => {
    const event = await makeEvent(5);
    await service.register(event.id, 'solo@example.com');

    const result = await service.cancel(event.id, 'solo@example.com');

    expect(result.cancelled).toBe(true);
    expect(result.alreadyCancelled).toBe(false);
    expect(result.registration.status).toBe(RegistrationStatus.CANCELLED);
    expect(result.promoted).toBeNull();
    expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(0);
    // History preserved — the row still exists, just CANCELLED.
    expect(await countBy(event.id, RegistrationStatus.CANCELLED)).toBe(1);
  });

  it('auto-promotes the first waitlisted participant with a ticket', async () => {
    const event = await makeEvent(1);
    await service.register(event.id, 'reg@example.com'); // takes the seat
    const waiter = await service.register(event.id, 'waiter@example.com');
    expect(waiter.status).toBe(RegistrationStatus.WAITLISTED);

    const result = await service.cancel(event.id, 'reg@example.com');

    expect(result.promoted).not.toBeNull();
    expect(result.promoted?.email).toBe('waiter@example.com');
    expect(result.promoted?.status).toBe(RegistrationStatus.REGISTERED);
    expect(result.promoted?.waitlistPos).toBeNull();
    expect(result.promoted?.ticket?.code).toMatch(/^[0-9A-F]{12}$/);
    expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(1);
    expect(await countBy(event.id, RegistrationStatus.WAITLISTED)).toBe(0);
  });

  it('promotes in correct FIFO order', async () => {
    const event = await makeEvent(1);
    await service.register(event.id, 'holder@example.com');
    await service.register(event.id, 'w1@example.com'); // pos 1
    await service.register(event.id, 'w2@example.com'); // pos 2
    await service.register(event.id, 'w3@example.com'); // pos 3

    // First cancellation promotes w1.
    const r1 = await service.cancel(event.id, 'holder@example.com');
    expect(r1.promoted?.email).toBe('w1@example.com');

    // Cancelling the freshly-promoted w1 promotes the next in line, w2.
    const r2 = await service.cancel(event.id, 'w1@example.com');
    expect(r2.promoted?.email).toBe('w2@example.com');

    const { waitlisted } = await service.findByEvent(event.id);
    expect(waitlisted.map((r) => r.email)).toEqual(['w3@example.com']);
  });

  it('cancels a WAITLISTED participant and preserves remaining order', async () => {
    const event = await makeEvent(1);
    await service.register(event.id, 'seat@example.com');
    await service.register(event.id, 'a@example.com'); // pos 1
    await service.register(event.id, 'b@example.com'); // pos 2
    await service.register(event.id, 'c@example.com'); // pos 3

    // Cancel the middle waitlisted participant — no promotion should occur.
    const result = await service.cancel(event.id, 'b@example.com');
    expect(result.promoted).toBeNull();
    expect(result.registration.status).toBe(RegistrationStatus.CANCELLED);

    const { waitlisted } = await service.findByEvent(event.id);
    expect(waitlisted.map((r) => r.email)).toEqual([
      'a@example.com',
      'c@example.com',
    ]);
    // Registered holder untouched.
    expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(1);
  });

  it('is idempotent on repeated cancellation (no extra promotion)', async () => {
    const event = await makeEvent(1);
    await service.register(event.id, 'reg@example.com');
    await service.register(event.id, 'wait@example.com');

    const first = await service.cancel(event.id, 'reg@example.com');
    expect(first.cancelled).toBe(true);
    expect(first.promoted?.email).toBe('wait@example.com');

    const second = await service.cancel(event.id, 'reg@example.com');
    expect(second.cancelled).toBe(false);
    expect(second.alreadyCancelled).toBe(true);
    expect(second.promoted).toBeNull();

    // Still exactly one registered (the promoted waiter), no double promotion.
    expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(1);
  });

  it('throws 404 when cancelling a non-existent registration', async () => {
    const event = await makeEvent(5);
    await expect(
      service.cancel(event.id, 'ghost@example.com'),
    ).rejects.toThrow();
  });

  it(
    'concurrent cancellations never give one waitlist spot to two people',
    async () => {
      // Two registered, only ONE waitlister. Cancel both registered at once.
      const event = await makeEvent(2);
      await service.register(event.id, 'A@example.com');
      await service.register(event.id, 'B@example.com');
      const c = await service.register(event.id, 'C@example.com');
      expect(c.status).toBe(RegistrationStatus.WAITLISTED);

      const [ra, rb] = await Promise.all([
        service.cancel(event.id, 'A@example.com'),
        service.cancel(event.id, 'B@example.com'),
      ]);

      // Exactly one of the two cancellations promoted C; the other promoted no one.
      const promotedEmails = [ra.promoted?.email, rb.promoted?.email].filter(
        Boolean,
      );
      expect(promotedEmails).toEqual(['c@example.com']); // emails normalized to lowercase

      // Final DB state: only C registered, A & B cancelled, waitlist empty.
      expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(1);
      expect(await countBy(event.id, RegistrationStatus.WAITLISTED)).toBe(0);
      expect(await countBy(event.id, RegistrationStatus.CANCELLED)).toBe(2);

      // C is registered exactly once and holds a single ticket.
      const cRow = await prisma.registration.findUnique({
        where: { eventId_email: { eventId: event.id, email: 'c@example.com' } },
        include: { ticket: true },
      });
      expect(cRow?.status).toBe(RegistrationStatus.REGISTERED);
      expect(cRow?.ticket).not.toBeNull();
    },
    30000,
  );

  it(
    'concurrent cancellations promote all waitlisters without exceeding capacity',
    async () => {
      // Two registered, two waitlisters. Cancel both registered concurrently.
      const event = await makeEvent(2);
      await service.register(event.id, 'r1@example.com');
      await service.register(event.id, 'r2@example.com');
      await service.register(event.id, 'wa@example.com'); // pos 1
      await service.register(event.id, 'wb@example.com'); // pos 2

      await Promise.all([
        service.cancel(event.id, 'r1@example.com'),
        service.cancel(event.id, 'r2@example.com'),
      ]);

      // Both waitlisters promoted; capacity (2) exactly filled, never exceeded.
      expect(await countBy(event.id, RegistrationStatus.REGISTERED)).toBe(2);
      expect(await countBy(event.id, RegistrationStatus.WAITLISTED)).toBe(0);

      const { registered } = await service.findByEvent(event.id);
      expect(registered.map((r) => r.email).sort()).toEqual([
        'wa@example.com',
        'wb@example.com',
      ]);
    },
    30000,
  );
});