-- AlterEnum
BEGIN;
CREATE TYPE "EmailType_new" AS ENUM ('REGISTRATION_TICKET', 'WAITLIST_PROMOTED', 'EVENT_REMINDER', 'EVENT_RESCHEDULED');
ALTER TABLE "EmailLog" ALTER COLUMN "type" TYPE "EmailType_new" USING ("type"::text::"EmailType_new");
ALTER TYPE "EmailType" RENAME TO "EmailType_old";
ALTER TYPE "EmailType_new" RENAME TO "EmailType";
DROP TYPE "public"."EmailType_old";
COMMIT;

-- DropIndex
DROP INDEX "EmailLog_registrationId_dedupeKey_key";

-- AlterTable
ALTER TABLE "EmailLog" DROP COLUMN "dedupeKey",
ADD COLUMN     "deduplicationKey" TEXT NOT NULL,
ADD COLUMN     "eventId" TEXT NOT NULL,
ADD COLUMN     "payload" JSONB NOT NULL,
ADD COLUMN     "recipient" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_deduplicationKey_key" ON "EmailLog"("deduplicationKey");

-- CreateIndex
CREATE INDEX "EmailLog_eventId_idx" ON "EmailLog"("eventId");

-- CreateIndex
CREATE INDEX "EmailLog_registrationId_idx" ON "EmailLog"("registrationId");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

