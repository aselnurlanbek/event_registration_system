import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailType, RegistrationStatus } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ReminderRunResult {
  eventsInWindow: number;
  remindersSent: number;
}

/**
 * Sends each REGISTERED participant exactly one reminder ~24h before their event.
 *
 * The job runs every minute and records an EVENT_REMINDER for every REGISTERED
 * participant of any event starting within the next `windowHours`. Exactly-once
 * is guaranteed NOT by in-memory state but by the unique email deduplication key
 * `event-reminder:{eventId}:{registrationId}` (see EmailService): re-runs,
 * overlapping ticks and backend restarts all hit the same key and insert
 * nothing the second time. This also means a participant who registers later
 * (but still inside the window) correctly receives their one reminder.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);
  private readonly windowHours = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    await this.processReminders();
  }

  /**
   * Process all events currently in the reminder window. `now` is injectable
   * for deterministic tests; defaults to the current time in production.
   */
  async processReminders(now: Date = new Date()): Promise<ReminderRunResult> {
    const windowEnd = new Date(now.getTime() + this.windowHours * 3_600_000);

    const events = await this.prisma.event.findMany({
      // Cancelled events get no reminders.
      where: { status: 'ACTIVE', startsAt: { gt: now, lte: windowEnd } },
      select: { id: true },
    });

    let remindersSent = 0;
    for (const event of events) {
      remindersSent += await this.remindEvent(event.id);
    }

    if (remindersSent > 0) {
      this.logger.log(
        `Reminder job: ${remindersSent} reminder(s) sent across ${events.length} event(s) in window`,
      );
    }
    return { eventsInWindow: events.length, remindersSent };
  }

  /** Record EVENT_REMINDER for every REGISTERED participant of one event. */
  private async remindEvent(eventId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const registered = await tx.registration.findMany({
        where: { eventId, status: RegistrationStatus.REGISTERED },
      });
      if (registered.length === 0) {
        return 0;
      }

      return this.email.recordInTx(
        tx,
        registered.map((r) => ({
          type: EmailType.EVENT_REMINDER,
          recipient: r.email,
          eventId,
          registrationId: r.id,
          deduplicationKey: `event-reminder:${eventId}:${r.id}`,
          payload: {},
        })),
      );
    });
  }
}