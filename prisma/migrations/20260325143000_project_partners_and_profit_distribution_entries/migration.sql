-- CreateEnum
CREATE TYPE "ProjectManualEntryKind" AS ENUM ('standard', 'profit_distribution');

-- AlterTable
ALTER TABLE "ProjectManualEntry"
ADD COLUMN "entryKind" "ProjectManualEntryKind" NOT NULL DEFAULT 'standard',
ADD COLUMN "partnerName" TEXT;

-- CreateTable
CREATE TABLE "ProjectPartner" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "isMe" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectPartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectManualEntry_projectId_entryKind_idx" ON "ProjectManualEntry"("projectId", "entryKind");

-- CreateIndex
CREATE INDEX "ProjectPartner_projectId_idx" ON "ProjectPartner"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectPartner" ADD CONSTRAINT "ProjectPartner_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
