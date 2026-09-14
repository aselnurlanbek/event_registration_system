/**
 * Soft event cancellation, verified against real Postgres. Confirms the event +
 * registrations are preserved, new registrations and check-ins are refused,
 * reminders stop, participant history still shows it, and affected participants
 * receive exactly one EVENT_CANCELLED email (idempotent).
 */
import 'dotenv/config';
import { EmailType, RegistrationStatus } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { CheckInService } from '../check-in/check-in.service';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeStatsService } from '../realtime/realtime-stats.service';
import { RegistrationsService } from '../registrations/registrations.service';
import { ReminderService } from '../scheduler/reminder.service';

const realtimeStub = { broadcast: async () => {} } as unknown as RealtimeStatsService;

describe('Event soft-cancellation (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let events: EventsService;
  let registrations: RegistrationsService;
  let checkIn: CheckInService;
  let reminders: ReminderService;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const email = new EmailService(prisma);
    events = new EventsService(prisma, email);
    registrations = new RegistrationsService(prisma, events, realtimeStub, email);
    checkIn = new CheckInService(prisma, realtimeStub);
    reminders = new ReminderService(prisma, email);
  });

  afterAll(async () => {
    if (createdEventIds.length) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await prisma.$disconnect();
  });

  async function makeEvent(startsAt: Date, capacity = 5) {
    const ev = await prisma.event.create({
      data: { title: 'Cancellation Test', startsAt, capacity },
    });
    createdEventIds.push(ev.id);
    return ev;
  }

  it('preserves the event + registrations and notifies affected participants once', async () => {
    const ev = await makeEvent(new Date('2027-08-01T10:00:00.000Z'));
    const reg = await registrations.register(ev.id, 'keep@example.com');
    await registrations.register(ev.id, 'wait@example.com'); // (still REGISTERED, capacity 5)

    const res = await events.cancelEvent(ev.id);
    expect(res.status).toBe('CANCELLED');
    expect(res.alreadyCancelled).toBe(false);
    expect(res.notified).toBe(2);

    // Event row preserved, flagged CANCELLED with a timestamp.
    const row = await prisma.event.findUnique({ where: { id: ev.id } });
    expect(row?.status).toBe('CANCELLED');
    expect(row?.cancelledAt).not.toBeNull();

    // Registrations + tickets preserved as history.
    const stillThere = await prisma.registration.findUnique({
      where: { id: reg.id },
      include: { ticket: true },
    });
    expect(stillThere?.status).toBe(RegistrationStatus.REGISTERED);
    expect(stillThere?.ticket).not.toBeNull();

    // EVENT_CANCELLED emails recorded.
    expect(
      await prisma.emailLog.count({
        where: { eventId: ev.id, type: EmailType.EVENT_CANCELLED },
      }),
    ).toBe(2);
  });

  it('is idempotent — cancelling again sends no further emails', async () => {
    const ev = await makeEvent(new Date('2027-08-02T10:00:00.000Z'));
    await registrations.register(ev.id, 'once@example.com');

    const first = await events.cancelEvent(ev.id);
    expect(first.notified).toBe(1);
    const second = await events.cancelEvent(ev.id);
    expect(second.alreadyCancelled).toBe(true);
    expect(second.notified).toBe(0);

    expect(
      await prisma.emailLog.count({
        where: { eventId: ev.id, type: EmailType.EVENT_CANCELLED },
      }),
    ).toBe(1);
  });

  it('refuses new registrations on a cancelled event (409)', async () => {
    const ev = await makeEvent(new Date('2027-08-03T10:00:00.000Z'));
    await events.cancelEvent(ev.id);

    await expect(
      registrations.register(ev.id, 'late@example.com'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses check-in on a cancelled event (409)', async () => {
    const ev = await makeEvent(new Date('2027-08-04T10:00:00.000Z'));
    const reg = await registrations.register(ev.id, 'ticketed@example.com');
    const code = reg.ticket!.code;
    await events.cancelEvent(ev.id);

    await expect(checkIn.checkIn(ev.id, code)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('stops future reminders for a cancelled event', async () => {
    const now = new Date('2027-09-01T00:00:00.000Z');
    const inWindow = new Date(now.getTime() + 12 * 3_600_000);
    const ev = await makeEvent(inWindow);
    await registrations.register(ev.id, 'noremind@example.com');
    await events.cancelEvent(ev.id);

    await reminders.processReminders(now);

    expect(
      await prisma.emailLog.count({
        where: { eventId: ev.id, type: EmailType.EVENT_REMINDER },
      }),
    ).toBe(0);
  });

  it('hides cancelled events from public list but keeps them in participant history', async () => {
    const ev = await makeEvent(new Date('2027-08-05T10:00:00.000Z'));
    const reg = await registrations.register(ev.id, 'hist@example.com');
    await events.cancelEvent(ev.id);

    const publicList = await events.findAll();
    expect(publicList.some((e) => e.id === ev.id)).toBe(false);

    const history = await registrations.findMine(reg.userId ?? 'none', 'hist@example.com');
    const entry = history.find((h) => h.event.id === ev.id);
    expect(entry).toBeDefined();
    expect(entry?.event.status).toBe('CANCELLED');
  });
});