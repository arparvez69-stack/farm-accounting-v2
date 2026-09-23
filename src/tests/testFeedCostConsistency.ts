import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import {
  executeLivestockProductionCostTransaction,
  executeAnimalEventTransaction
} from '../services/transactionService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${msg}`);
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

export async function runFeedCostConsistencyTest() {
  console.log('--- STARTING TASK A1 FEED COST CONSISTENCY TESTS ---');

  // Reset database tables
  await db.animals.clear();
  await db.animalEvents.clear();
  await db.inventoryItems.clear();
  await db.stockMovements.clear();
  await db.journalEntries.clear();
  await db.accounts.clear();
  await db.cashBankAccounts.clear();
  await db.closedPeriods.clear();

  // Seed chart of accounts
  await db.accounts.bulkAdd([
    {
      id: `acc_${CANONICAL_ACCOUNTS.FEED_INVENTORY}`,
      code: CANONICAL_ACCOUNTS.FEED_INVENTORY,
      nameBn: 'মজুদ খাদ্য (Feed Inventory)',
      nameEn: 'Feed Inventory',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isActive: true
    },
    {
      id: `acc_${CANONICAL_ACCOUNTS.FEED_EXPENSE}`,
      code: CANONICAL_ACCOUNTS.FEED_EXPENSE,
      nameBn: 'খাদ্য ক্রয় খরচ (Feed Expense)',
      nameEn: 'Feed Expense',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isActive: true
    },
    {
      id: `acc_${CANONICAL_ACCOUNTS.CASH}`,
      code: CANONICAL_ACCOUNTS.CASH,
      nameBn: 'নগদ টাকা (Cash on Hand)',
      nameEn: 'Cash on Hand',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isActive: true
    }
  ]);

  // Seed inventory feed item: 50 kg available, avgCostPrice = ৳100
  const feedItem = {
    id: 'inv_feed_100',
    nameBn: 'ফিড পেলেট (Feed Pellet)',
    nameEn: 'Feed Pellet',
    category: 'FEED' as any,
    unit: 'কেজি',
    currentStock: 50,
    minStockLevel: 5,
    avgCostPrice: 100,
    costPrice: 100,
    synced: false
  };
  await db.inventoryItems.add(feedItem as any);

  // Seed an animal: Cow
  const cow = {
    id: 'cow_test_01',
    tag: 'COW-01',
    species: 'COW',
    breed: 'Holstein Friesian',
    status: 'ACTIVE',
    purchaseCost: 60000,
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    totalCost: 60000,
    synced: false
  };
  await db.animals.add(cow as any);

  console.log('✓ Initial setup: 50kg feed @ ৳100/kg; Cow initial totalCost ৳60,000');

  // TEST 1: User enters amount = ৳500, but quantity = 10 kg @ ৳100.
  // The accounting amount must equal 10 * 100 = ৳1,000.
  // GL inventory credit must be ৳1,000, NOT ৳500.
  console.log('--- TEST 1: Arbitrary user-entered amount (৳500) overridden by 10kg × ৳100 = ৳1,000 ---');
  const res1 = await executeLivestockProductionCostTransaction({
    animalId: cow.id,
    costType: 'FEED',
    eventType: 'FEED',
    amount: 500, // User entered arbitrary 500
    paymentMethod: 'INVENTORY',
    feedItemId: feedItem.id,
    feedQuantityUsed: 10, // 10 kg × ৳100 = ৳1,000
    date: '2026-03-15',
    notes: 'Testing feed consumption valuation consistency',
    currentUserId: 'test-user'
  });

  assert(!!res1.journalEntryId, 'Journal entry must be created');
  const je1 = await db.journalEntries.get(res1.journalEntryId!);
  assert(!!je1, 'Journal entry record must exist in DB');

  const invCreditLine = je1!.lines.find(
    (l) => l.accountCode === CANONICAL_ACCOUNTS.FEED_INVENTORY
  );
  const feedDebitLine = je1!.lines.find(
    (l) => l.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE
  );

  assert(!!invCreditLine, 'Must have Feed Inventory credit line');
  assert(!!feedDebitLine, 'Must have Feed Expense debit line');
  assert(
    invCreditLine!.credit === 1000,
    `GL Feed Inventory credit MUST be 1000, got ${invCreditLine!.credit}`
  );
  assert(
    feedDebitLine!.debit === 1000,
    `GL Feed Expense debit MUST be 1000, got ${feedDebitLine!.debit}`
  );
  console.log(`✓ GL journal entries correctly reflect ৳1,000 (Dr: ${feedDebitLine!.debit}, Cr: ${invCreditLine!.credit})`);

  // Check animal record
  const freshCow1 = await db.animals.get(cow.id);
  assert(
    freshCow1!.accumulatedFeedCost === 1000,
    `Animal accumulatedFeedCost must be 1000, got ${freshCow1!.accumulatedFeedCost}`
  );
  assert(
    freshCow1!.totalCost === 61000,
    `Animal totalCost must be 61000, got ${freshCow1!.totalCost}`
  );
  console.log('✓ Animal accumulatedFeedCost and totalCost updated by ৳1,000');

  // Check inventory stock and stock movement
  const freshInv1 = await db.inventoryItems.get(feedItem.id);
  assert(
    freshInv1!.currentStock === 40,
    `Inventory stock must be 40 (50 - 10), got ${freshInv1!.currentStock}`
  );

  const movements = await db.stockMovements.where('itemId').equals(feedItem.id).toArray();
  assert(movements.length === 1, 'Exactly one stock movement recorded');
  assert(movements[0].quantity === 10, 'Stock movement quantity must be 10');
  assert(movements[0].unitCost === 100, `Stock movement unitCost must be 100, got ${movements[0].unitCost}`);
  assert(movements[0].totalValue === 1000, `Stock movement totalValue must be 1000, got ${movements[0].totalValue}`);
  console.log('✓ Stock movement correctly recorded with unitCost 100 and totalValue 1000');

  // TEST 2: Stock validation (requesting 45 kg when only 40 kg left)
  console.log('--- TEST 2: Stock validation rejects overconsumption ---');
  let caught = false;
  try {
    await executeLivestockProductionCostTransaction({
      animalId: cow.id,
      costType: 'FEED',
      eventType: 'FEED',
      amount: 4500,
      paymentMethod: 'INVENTORY',
      feedItemId: feedItem.id,
      feedQuantityUsed: 45, // 45 > 40
      date: '2026-03-16',
      notes: 'Testing stock validation',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught = true;
    console.log('Correctly caught stock validation error:', err.message);
    assert(err.message.includes('পর্যাপ্ত খাদ্য মজুদ নেই'), 'Should contain stock shortage error message');
  }
  assert(caught, 'Overconsumption must be rejected');

  // Verify DB state unchanged after rejected attempt
  const freshInvAfterReject = await db.inventoryItems.get(feedItem.id);
  assert(freshInvAfterReject!.currentStock === 40, 'Inventory stock must remain 40');
  const freshCowAfterReject = await db.animals.get(cow.id);
  assert(freshCowAfterReject!.accumulatedFeedCost === 1000, 'Animal feed cost must remain 1000');
  console.log('✓ Stock validation preserved with zero partial updates');

  // TEST 3: executeAnimalEventTransaction valuation consistency
  console.log('--- TEST 3: executeAnimalEventTransaction valuation consistency ---');
  // Pass 5 kg with user cost = 0 or 200, avgCostPrice is 100 -> must be 5 * 100 = 500
  await executeAnimalEventTransaction({
    animal: freshCowAfterReject!,
    event: {
      animalId: cow.id,
      eventType: 'FEED',
      date: '2026-03-17',
      cost: 9999, // user arbitrary cost
      feedItemId: feedItem.id,
      feedQuantityUsed: 5,
      details: 'Feeding 5kg'
    },
    currentUserId: 'test-user'
  });

  const freshCow3 = await db.animals.get(cow.id);
  assert(
    freshCow3!.accumulatedFeedCost === 1500,
    `Animal accumulatedFeedCost must be 1500 (1000 + 500), got ${freshCow3!.accumulatedFeedCost}`
  );
  assert(
    freshCow3!.totalCost === 61500,
    `Animal totalCost must be 61500, got ${freshCow3!.totalCost}`
  );

  const freshInv3 = await db.inventoryItems.get(feedItem.id);
  assert(
    freshInv3!.currentStock === 35,
    `Inventory stock must be 35 (40 - 5), got ${freshInv3!.currentStock}`
  );
  console.log('✓ executeAnimalEventTransaction correctly valued 5kg × ৳100 = ৳500 (ignoring ৳9999)');

  console.log('\n======================================================');
  console.log('TASK A1 FEED COST CONSISTENCY: ALL TESTS PASSED!');
  console.log('======================================================');
  return { success: true };
}

runFeedCostConsistencyTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
