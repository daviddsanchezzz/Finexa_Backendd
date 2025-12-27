-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('travel', 'debts', 'application', 'personal');

-- DropIndex
DROP INDEX "Debt_subcategoryId_idx";

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "kind" "CategoryKind" NOT NULL DEFAULT 'personal';
