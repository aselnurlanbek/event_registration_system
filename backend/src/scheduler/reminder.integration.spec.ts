/**
 * Integration tests for the reminder job against REAL Postgres. The "already
 * sent" state lives entirely in the EmailLog table (dedup keys), so these tests
 * also cover re-runs and simulated restarts without any mocking of that state.
 */
import 'dotenv/config';
import { EmailType, RegistrationStatus } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReminderService } from './reminder.service';

describe('ReminderService (integration, real Postgres)', () => {
  let prisma: PrismaService;
  let service: ReminderService;
  const createdEventIds: string[] = [];
  const now = new Date('2027-08-01T00:00:00.000Z');
  const inWindow = new Date(now.getTime() + 12 * 3_600_000); // 12h ahead
  const outsideWindow = new Date(now.getTime() + 48 * 3_600_000); // 48h ahead

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ReminderService(prisma, new EmailService(prisma));
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await prisma.$disconnect();
  });

  async function makeEvent(startsAt: Date) {
    const event = await prisma.event.create({
      data: { title: 'ReminderTest Event', startsAt, capacity: 10 },
    });
    createdEventIds.push(event.id);
    return event;
  }

  function addReg(
    eventId: string,
    email: string,
    status: RegistrationStatus,
  ) {
    return prisma.registration.create({ data: { eventId, email, status } });
  }

  const reminderCount = (eventId: string) =>
    prisma.emailLog.count({
      where: { eventId, type: EmailType.EVENT_REMINDER },
    });

  it('sends a reminder to each REGISTERED participant in the window', async () => {
    const event = await makeEvent(inWindow);
    await addReg(event.id, 'a@example.com', RegistrationStatus.REGISTERED);
    await addReg(event.id, 'b@example.com', RegistrationStatus.REGISTERED);

    const result = await service.processReminders(now);

    expect(result.remindersSent).toBeGreaterThanOrEqual(2);
    expect(await reminderCount(event.id)).toBe(2);
  });

  it('does not remind WAITLISTED or CANCELLED registrations', async () => {
    const event = await makeEvent(inWindow);
    await addReg(event.id, 'reg@example.com', RegistrationStatus.REGISTERED);
    await addReg(event.id, 'wait@example.com', RegistrationStatus.WAITLISTED);
    await addReg(event.id, 'cancel@example.com', RegistrationStatus.CANCELLED);

    await service.processReminders(now);

    expect(await reminderCount(event.id)).toBe(1);
    const reminded = await prisma.emailLog.findMany({
      where: { eventId: event.id, type: EmailType.EVENT_REMINDER },
    });
    expect(reminded.map((r) => r.recipient)).toEqual(['reg@example.com']);
  });

  it('is idempotent across repeated job runs (exactly one reminder each)', async () => {
    const event = await makeEvent(inWindow);
    await addReg(event.id, 'once@example.com', RegistrationStatus.REGISTERED);

    await service.processReminders(now);
    await service.processReminders(now);
    await service.processReminders(now);

    expect(await reminderCount(event.id)).toBe(1);
  });

  it('does not remind events outside the 24h window', async () => {
    const event = await makeEvent(outsideWindow);
    await addReg(event.id, 'future@example.com', RegistrationStatus.REGISTERED);

    await service.processReminders(now);

    expect(await reminderCount(event.id)).toBe(0);
  });

  it('survives a simulated backend restart without resending (state is in Postgres)', async () => {
    const event = await makeEvent(inWindow);
    await addReg(event.id, 'persist@example.com', RegistrationStatus.REGISTERED);

    // First run with one instance.
    await service.processReminders(now);
    expect(await reminderCount(event.id)).toBe(1);

    // "Restart": brand-new service + email instances, no in-memory carryover.
    const freshService = new ReminderService(prisma, new EmailService(prisma));
    await freshService.processReminders(now);

    expect(await reminderCount(event.id)).toBe(1); // still exactly one
  });
});