import { Injectable, Logger } from '@nestjs/common';
import { EmailLog, EmailType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface EmailRecord {
  type: EmailType;
  recipient: string;
  eventId: string;
  registrationId: string;
  deduplicationKey: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Mock email service. No external provider — a "sent" email IS a row in the
 * EmailLog outbox table, inspectable via GET /api/dev/emails.
 *
 * Transaction strategy (see docs/ARCHITECTURE.md §9): emails are recorded via
 * `recordInTx`, which is called INSIDE the same transaction as the business
 * operation that causes them (registration, promotion, reschedule). This makes
 * the email record atomic with the state change — it exists iff the change
 * committed, so no phantom emails on rollback and no lost emails on success.
 *
 * Idempotency: `createMany({ skipDuplicates: true })` relies on the UNIQUE
 * `deduplicationKey`. It never throws on a duplicate (so it is safe to call
 * inside a transaction, where a thrown error would abort the whole tx) and
 * returns how many rows were actually inserted. Retrying the same logical
 * operation inserts nothing the second time.
 *
 * With a real provider the network send would move to an after-commit worker
 * that dispatches unsent outbox rows; here "delivery" is just a log line.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Record one or more emails within an existing transaction. Returns the
   *  number of NEW emails recorded (duplicates are skipped). */
  async recordInTx(
    tx: Prisma.TransactionClient,
    records: EmailRecord | EmailRecord[],
  ): Promise<number> {
    const list = Array.isArray(records) ? records : [records];
    if (list.length === 0) {
      return 0;
    }

    const result = await tx.emailLog.createMany({
      data: list.map((r) => ({
        type: r.type,
        recipient: r.recipient,
        eventId: r.eventId,
        registrationId: r.registrationId,
        deduplicationKey: r.deduplicationKey,
        payload: r.payload,
      })),
      skipDuplicates: true, // idempotent — no duplicate emails on retry
    });

    if (result.count > 0) {
      this.logger.log(
        `[MOCK EMAIL] recorded ${result.count} email(s): ${list
          .map((r) => `${r.type}→${r.recipient}`)
          .join(', ')}`,
      );
    }
    return result.count;
  }

  /** Development/demo helper: list all recorded emails, newest first. */
  listAll(): Promise<EmailLog[]> {
    return this.prisma.emailLog.findMany({ orderBy: { sentAt: 'desc' } });
  }
}