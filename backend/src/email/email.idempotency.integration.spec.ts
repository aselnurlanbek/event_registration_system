/**
 * Email idempotency, verified against REAL Postgres. The unique
 * deduplicationKey + createMany(skipDuplicates) guarantee that retrying the same
 * logical operation never creates a duplicate email.
 */
import 'dotenv/config';
import { EmailType, RegistrationStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';
import { RegistrationsService } from '../registrations/registrations.service';

const realtimeStub = {
  broadcast: async () => {},
} as unknown as RealtimeStatsService;

describe('Email idempotency (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let email: EmailService;
  let events: EventsService;
  let registrations: RegistrationsService;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    email = new EmailService(prisma);
    events = new EventsService(prisma, email);
    registrations = new RegistrationsService(prisma, events, realtimeStub, email);
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
        title: 'EmailTest Event',
        startsAt: new Date('2027-05-01T10:00:00.000Z'),
        capacity,
      },
    });
    createdEventIds.push(event.id);
    return event;
  }

  const countEmails = (eventId: string, type: EmailType) =>
    prisma.emailLog.count({ where: { eventId, type } });

  it('records exactly one REGISTRATION_TICKET even if registration is retried', async () => {
    const event = await makeEvent(5);

    await registrations.register(event.id, 'ticket@example.com');
    await registrations.register(event.id, 'ticket@example.com'); // idempotent retry

    expect(await countEmails(event.id, EmailType.REGISTRATION_TICKET)).toBe(1);
  });

  it('records a WAITLIST_PROMOTED email when a waitlister is promoted', async () => {
    const event = await makeEvent(1);
    await registrations.register(event.id, 'holder@example.com');
    await registrations.register(event.id, 'waiter@example.com');

    await registrations.cancel(event.id, 'holder@example.com'); // promotes waiter

    expect(await countEmails(event.id, EmailType.WAITLIST_PROMOTED)).toBe(1);
    const promo = await prisma.emailLog.findFirst({
      where: { eventId: event.id, type: EmailType.WAITLIST_PROMOTED },
    });
    expect(promo?.recipient).toBe('waiter@example.com');
  });

  it('records EVENT_RESCHEDULED per registered participant; a new date sends again, an unchanged date does not', async () => {
    const event = await makeEvent(5);
    await registrations.register(event.id, 'r@example.com');

    // First reschedule → one email.
    await events.update(event.id, { startsAt: '2027-06-01T10:00:00.000Z' });
    expect(await countEmails(event.id, EmailType.EVENT_RESCHEDULED)).toBe(1);

    // Same date again → no-op, no new email.
    await events.update(event.id, { startsAt: '2027-06-01T10:00:00.000Z' });
    expect(await countEmails(event.id, EmailType.EVENT_RESCHEDULED)).toBe(1);

    // Different date → a fresh notification (distinct deduplicationKey).
    await events.update(event.id, { startsAt: '2027-07-01T10:00:00.000Z' });
    expect(await countEmails(event.id, EmailType.EVENT_RESCHEDULED)).toBe(2);
  });

  it('recordInTx returns 1 on first insert and 0 on a duplicate deduplicationKey', async () => {
    const event = await makeEvent(5);
    const reg = await registrations.register(event.id, 'dupe@example.com');
    const key = `email-test:${reg.id}`;

    const first = await prisma.$transaction((tx) =>
      email.recordInTx(tx, {
        type: EmailType.EVENT_REMINDER,
        recipient: 'dupe@example.com',
        eventId: event.id,
        registrationId: reg.id,
        deduplicationKey: key,
        payload: {},
      }),
    );
    const second = await prisma.$transaction((tx) =>
      email.recordInTx(tx, {
        type: EmailType.EVENT_REMINDER,
        recipient: 'dupe@example.com',
        eventId: event.id,
        registrationId: reg.id,
        deduplicationKey: key,
        payload: {},
      }),
    );

    expect(first).toBe(1);
    expect(second).toBe(0); // duplicate skipped — no second email
    expect(
      await prisma.emailLog.count({ where: { deduplicationKey: key } }),
    ).toBe(1);

    // Sanity: the registration itself was REGISTERED.
    expect(reg.status).toBe(RegistrationStatus.REGISTERED);
  });
});