-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Category_userId_type_position_idx" ON "Category"("userId", "type", "position");

-- CreateIndex
CREATE INDEX "Subcategory_categoryId_position_idx" ON "Subcategory"("categoryId", "position");

-- CreateIndex
CREATE INDEX "Wallet_userId_position_idx" ON "Wallet"("userId", "position");
