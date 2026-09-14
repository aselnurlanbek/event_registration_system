/**
 * Integration tests for RegistrationsService against a REAL PostgreSQL database.
 *
 * These deliberately do NOT mock Prisma/Postgres — the whole point is to prove
 * the transaction + row-lock behaviour (docs/ARCHITECTURE.md §8), especially
 * the concurrent last-spot race, which cannot be verified with mocks.
 *
 * Requires DATABASE_URL (loaded from backend/.env via dotenv below) pointing at
 * a running Postgres with the schema migrated.
 */
import 'dotenv/config';
import { RegistrationStatus } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';
import { RegistrationsService } from './registrations.service';

// Realtime broadcasting is covered by its own tests; stub it here.
const realtimeStub = {
  broadcast: async () => {},
} as unknown as RealtimeStatsService;

describe('RegistrationsService (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let service: RegistrationsService;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const events = new EventsService(prisma);
    service = new RegistrationsService(prisma, events, realtimeStub);
  });

  afterAll(async () => {
    // Cascade deletes registrations + tickets for every event we created.
    if (createdEventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await prisma.$disconnect();
  });

  async function makeEvent(capacity: number) {
    const event = await prisma.event.create({
      data: {
        title: `IntegrationTest Event`,
        startsAt: new Date('2027-01-01T10:00:00.000Z'),
        capacity,
      },
    });
    createdEventIds.push(event.id);
    return event;
  }

  it('registers a participant when capacity exists (with a ticket)', async () => {
    const event = await makeEvent(5);

    const reg = await service.register(event.id, 'alice@example.com');

    expect(reg.status).toBe(RegistrationStatus.REGISTERED);
    expect(reg.ticket).not.toBeNull();
    expect(reg.ticket?.code).toMatch(/^[0-9A-F]{12}$/);
    expect(reg.waitlistPos).toBeNull();
  });

  it('waitlists a participant when the event is full (no ticket)', async () => {
    const event = await makeEvent(1);

    const first = await service.register(event.id, 'first@example.com');
    const second = await service.register(event.id, 'second@example.com');

    expect(first.status).toBe(RegistrationStatus.REGISTERED);
    expect(second.status).toBe(RegistrationStatus.WAITLISTED);
    expect(second.waitlistPos).toBe(1);
    expect(second.ticket).toBeNull();
  });

  it('does not create a second registration for a duplicate email', async () => {
    const event = await makeEvent(5);

    const a = await service.register(event.id, 'dupe@example.com');
    const b = await service.register(event.id, 'DUPE@example.com'); // case-insensitive

    expect(b.id).toBe(a.id);
    const count = await prisma.registration.count({
      where: { eventId: event.id, email: 'dupe@example.com' },
    });
    expect(count).toBe(1);
  });

  it('assigns FIFO waitlist positions', async () => {
    const event = await makeEvent(1);

    await service.register(event.id, 'reg@example.com'); // takes the only seat
    const w1 = await service.register(event.id, 'w1@example.com');
    const w2 = await service.register(event.id, 'w2@example.com');
    const w3 = await service.register(event.id, 'w3@example.com');

    expect(w1.waitlistPos).toBe(1);
    expect(w2.waitlistPos).toBe(2);
    expect(w3.waitlistPos).toBe(3);

    const { waitlisted } = await service.findByEvent(event.id);
    expect(waitlisted.map((r) => r.email)).toEqual([
      'w1@example.com',
      'w2@example.com',
      'w3@example.com',
    ]);
  });

  it(
    'handles two concurrent registrations for the last spot: exactly 1 REGISTERED + 1 WAITLISTED',
    async () => {
      const capacity = 10;
      const event = await makeEvent(capacity);

      // Fill 9 of 10 seats sequentially so exactly one spot remains.
      for (let i = 0; i < capacity - 1; i++) {
        const r = await service.register(event.id, `seat${i}@example.com`);
        expect(r.status).toBe(RegistrationStatus.REGISTERED);
      }

      // Two users race for the final seat — fired concurrently.
      const [a, b] = await Promise.all([
        service.register(event.id, 'racerA@example.com'),
        service.register(event.id, 'racerB@example.com'),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([
        RegistrationStatus.REGISTERED,
        RegistrationStatus.WAITLISTED,
      ]);

      // Authoritative check against the database.
      const registered = await prisma.registration.count({
        where: { eventId: event.id, status: RegistrationStatus.REGISTERED },
      });
      const waitlisted = await prisma.registration.count({
        where: { eventId: event.id, status: RegistrationStatus.WAITLISTED },
      });

      expect(registered).toBe(10); // never 11
      expect(waitlisted).toBe(1);
    },
    30000,
  );
});