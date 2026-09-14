/**
 * Integration tests for check-in against a REAL PostgreSQL database. The
 * single-use / concurrency guarantees rely on a database-level conditional
 * UPDATE, so these must NOT mock Postgres.
 */
import 'dotenv/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RegistrationStatus } from '@prisma/client';
import { DashboardService } from '../dashboard/dashboard.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { CheckInService } from './check-in.service';

const realtimeStub = {
  broadcast: async () => {},
} as unknown as RealtimeStatsService;

describe('CheckInService (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let checkIn: CheckInService;
  let registrations: RegistrationsService;
  let dashboard: DashboardService;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const events = new EventsService(prisma);
    checkIn = new CheckInService(prisma, realtimeStub);
    registrations = new RegistrationsService(prisma, events, realtimeStub);
    dashboard = new DashboardService(prisma, events);
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
        title: 'CheckInTest Event',
        startsAt: new Date('2027-03-01T10:00:00.000Z'),
        capacity,
      },
    });
    createdEventIds.push(event.id);
    return event;
  }

  it('checks in a registered participant successfully', async () => {
    const event = await makeEvent(5);
    const reg = await registrations.register(event.id, 'attendee@example.com');
    const code = reg.ticket!.code;

    const result = await checkIn.checkIn(event.id, code);

    expect(result.status).toBe('CHECKED_IN');
    expect(result.checkedInAt).toBeInstanceOf(Date);
    expect(result.participant.email).toBe('attendee@example.com');

    const row = await prisma.registration.findUnique({ where: { id: reg.id } });
    expect(row?.checkedInAt).not.toBeNull();
  });

  it('rejects a second check-in of the same ticket (409)', async () => {
    const event = await makeEvent(5);
    const reg = await registrations.register(event.id, 'twice@example.com');
    const code = reg.ticket!.code;

    await checkIn.checkIn(event.id, code);

    await expect(checkIn.checkIn(event.id, code)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an invalid (unknown) ticket (404)', async () => {
    const event = await makeEvent(5);

    await expect(
      checkIn.checkIn(event.id, 'NONEXISTENTCODE'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a ticket that belongs to a different event (404)', async () => {
    const eventA = await makeEvent(5);
    const eventB = await makeEvent(5);
    const reg = await registrations.register(eventA.id, 'crossed@example.com');

    await expect(
      checkIn.checkIn(eventB.id, reg.ticket!.code),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects check-in for a cancelled participant (409)', async () => {
    const event = await makeEvent(5);
    const reg = await registrations.register(event.id, 'gone@example.com');
    const code = reg.ticket!.code;
    await registrations.cancel(event.id, 'gone@example.com'); // ticket retained

    await expect(checkIn.checkIn(event.id, code)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it(
    'allows only ONE of two concurrent check-ins for the same ticket',
    async () => {
      const event = await makeEvent(5);
      const reg = await registrations.register(event.id, 'race@example.com');
      const code = reg.ticket!.code;

      const results = await Promise.allSettled([
        checkIn.checkIn(event.id, code),
        checkIn.checkIn(event.id, code),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // checkedInAt is set exactly once.
      const row = await prisma.registration.findUnique({
        where: { id: reg.id },
      });
      expect(row?.checkedInAt).not.toBeNull();
    },
    30000,
  );

  it('reports accurate stats (capacity/registered/waitlisted/checkedIn)', async () => {
    const event = await makeEvent(2);
    const r1 = await registrations.register(event.id, 's1@example.com');
    await registrations.register(event.id, 's2@example.com');
    await registrations.register(event.id, 's3@example.com'); // waitlisted
    await checkIn.checkIn(event.id, r1.ticket!.code);

    const stats = await dashboard.getStats(event.id);

    expect(stats).toEqual({
      capacity: 2,
      registered: 2,
      waitlisted: 1,
      checkedIn: 1,
    });
  });
});