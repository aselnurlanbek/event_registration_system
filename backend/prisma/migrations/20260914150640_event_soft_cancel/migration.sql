-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'EVENT_CANCELLED';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'ACTIVE';
