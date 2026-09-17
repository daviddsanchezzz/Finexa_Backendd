// Explicit integration check against the configured database. All writes belong
// to one temporary user and are removed in finally. Never uses existing users.
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { GoalsService } from '../src/modules/goals/goals.service';
import { WalletsService } from '../src/modules/wallets/wallets.service';

async function rejects(work: Promise<unknown>) {
  let rejected = false;
  try { await work; } catch (error) { assert(error instanceof BadRequestException); rejected = true; }
  assert(rejected, 'Expected business validation to reject the operation');
}

async function main() {
  if (!process.argv.includes('--run')) throw new Error('Run explicitly with: npx ts-node test/goals.integration.ts --run');
  const prisma = new PrismaService();
  const goals = new GoalsService(prisma);
  const wallets = new WalletsService(prisma);
  let userId: number | undefined;
  try {
    const user = await prisma.user.create({ data: { name: 'Temporary goals integration fixture', email: `goals-test-${Date.now()}@example.invalid`, password: 'not-a-login-password', active: false } });
    userId = user.id;
    const wallet = await wallets.create(userId, { name: 'Fixture cash', emoji: 'cash-outline', currency: 'EUR', balance: 5000 });
    const home = await goals.create(userId, { name: 'Home', targetAmount: 1000, currency: 'EUR', trackingMode: 'ALLOCATIONS', allocations: [{ walletId: wallet.id, amount: 1500 }] });
    const car = await goals.create(userId, { name: 'Car', targetAmount: 10000, currency: 'EUR', trackingMode: 'ALLOCATIONS', allocations: [{ walletId: wallet.id, amount: 500 }] });
    assert.equal(home.currentAmount, 1500);
    assert.equal(home.progressPercentage, 150);
    assert.equal((await goals.wallets(userId))[0].availableToAllocate, 3000);
    assert.equal((await wallets.findOne(userId, wallet.id)).balance, 5000);
    assert.equal(await prisma.transaction.count({ where: { userId } }), 0);
    await rejects(goals.setAllocations(userId, car.id, [{ walletId: wallet.id, amount: 4000 }]));
    await rejects(wallets.remove(userId, wallet.id));
    await rejects(wallets.update(userId, wallet.id, { currency: 'USD' }));
    await goals.setStatus(userId, home.id, 'COMPLETED');
    assert.equal((await goals.wallets(userId))[0].availableToAllocate, 3000);
    const archived = await goals.setStatus(userId, home.id, 'ARCHIVED');
    assert.equal(archived.currentAmount, 1500);
    assert.equal(archived.allocations.length, 1);
    assert.equal((await goals.wallets(userId))[0].availableToAllocate, 4500);

    await wallets.update(userId, wallet.id, { balance: 300 });
    assert.equal((await goals.wallets(userId))[0].overAllocated, 200);
    await goals.setAllocations(userId, car.id, [{ walletId: wallet.id, amount: 400 }]);
    assert.equal((await goals.wallets(userId))[0].overAllocated, 100);
    await goals.setAllocations(userId, car.id, [{ walletId: wallet.id, amount: 200 }]);
    assert.equal((await goals.wallets(userId))[0].overAllocated, 0);

    const manual = await goals.create(userId, { name: 'Laptop', targetAmount: 2000, currency: 'EUR', trackingMode: 'MANUAL', initialAmount: 500 });
    const withWithdrawal = await goals.manualEntry(userId, manual.id, { amount: -100, date: new Date().toISOString() });
    assert.equal(withWithdrawal.currentAmount, 400);
    const withdrawal = withWithdrawal.manualEntries.find((e) => e.amount < 0)!;
    assert.equal((await goals.manualEntry(userId, manual.id, { amount: -50, date: withdrawal.date.toISOString() }, withdrawal.id)).currentAmount, 450);
    assert.equal((await goals.removeManualEntry(userId, manual.id, withdrawal.id)).currentAmount, 500);
    assert.equal((await wallets.findOne(userId, wallet.id)).balance, 300);

    const linkedWallet = await wallets.create(userId, { name: 'Fixture savings', emoji: 'cash-outline', currency: 'EUR', balance: 0 });
    const linked = await goals.create(userId, { name: 'Savings', targetAmount: 10000, currency: 'EUR', trackingMode: 'WALLET_BALANCE', linkedWalletId: linkedWallet.id });
    assert.equal(linked.currentAmount, 0);
    await wallets.update(userId, linkedWallet.id, { balance: 8250 });
    assert.equal((await goals.findOne(userId, linked.id)).currentAmount, 8250);
    await rejects(goals.create(userId, { name: 'Duplicate', targetAmount: 1000, currency: 'EUR', trackingMode: 'WALLET_BALANCE', linkedWalletId: linkedWallet.id }));
    await rejects(goals.setAllocations(userId, car.id, [{ walletId: linkedWallet.id, amount: 1 }]));
    const archivedLinked = await goals.setStatus(userId, linked.id, 'ARCHIVED');
    assert.equal(archivedLinked.linkedWalletId, null);
    await wallets.update(userId, linkedWallet.id, { balance: 9000 });
    assert.equal((await goals.findOne(userId, linked.id)).currentAmount, 8250);

    const concurrentWallet = await wallets.create(userId, { name: 'Fixture concurrent', emoji: 'cash-outline', currency: 'EUR', balance: 3000 });
    const results = await Promise.allSettled([1, 2].map((n) => goals.create(userId!, { name: `Concurrent ${n}`, targetAmount: 5000, currency: 'EUR', trackingMode: 'ALLOCATIONS', allocations: [{ walletId: concurrentWallet.id, amount: 2000 }] })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await goals.wallets(userId)).find((w) => w.id === concurrentWallet.id)?.allocatedAmount, 2000);
    assert.equal(await prisma.transaction.count({ where: { userId } }), 0);
    console.log('Goal integration passed: reservations, history, archive, observed balances and concurrent allocation.');
  } finally {
    if (userId !== undefined) {
      await prisma.goal.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
      console.log('Temporary integration fixtures removed.');
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
