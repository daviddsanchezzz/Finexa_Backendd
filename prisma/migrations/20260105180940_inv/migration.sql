/*
  Warnings:

  - The values [swap,withdraw,deposit] on the enum `InvestmentOperationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InvestmentOperationType_new" AS ENUM ('transfer_in', 'transfer_out', 'buy', 'sell', 'swap_in', 'swap_out');
ALTER TABLE "InvestmentOperation" ALTER COLUMN "type" TYPE "InvestmentOperationType_new" USING ("type"::text::"InvestmentOperationType_new");
ALTER TYPE "InvestmentOperationType" RENAME TO "InvestmentOperationType_old";
ALTER TYPE "InvestmentOperationType_new" RENAME TO "InvestmentOperationType";
DROP TYPE "public"."InvestmentOperationType_old";
COMMIT;
