-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
