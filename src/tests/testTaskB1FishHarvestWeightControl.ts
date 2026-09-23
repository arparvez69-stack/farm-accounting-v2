import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeFishStockingTransaction,
  executeFishHarvestAndSaleTransaction
} from '../services/transactionService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runTaskB1Tests() {
  console.log('====================================================');
  console.log('RUNNING TASK B1: FISH HARVEST WEIGHT CONTROL TESTS');
  console.log('====================================================');

  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.add({
      ...acc
    });
  }

  const cashAccount = {
    id: 'cba-cash-01',
    name: 'নগদ ক্যাশ (Main Cash)',
    accountName: 'নগদ ক্যাশ (Main Cash)',
    accountType: 'CASH' as const,
    accountNumber: '1010-01',
    currentBalance: 500000,
    isActive: true,
    isDefault: true,
    synced: false
  };
  await db.cashBankAccounts.add(cashAccount);

  // Stock a test batch: 1,000 fingerlings
  const stockResult = await executeFishStockingTransaction({
    pondName: 'Pond B1 Test',
    species: 'Rui',
    fingerlingQty: 1000,
    fingerlingCost: 10000,
    paymentMethod: 'CASH',
    stockingDate: '2026-03-01',
    currentUserId: 'usr-b1'
  });
  const batchId = stockResult.batch.id;

  // Set currentEstimatedWeightKg on batch to test physically available weight limit
  await db.fishBatches.update(batchId, { currentEstimatedWeightKg: 500 });

  // TEST 1: Rejection when sold weight exceeds harvested weight
  console.log('\n--- Test 1: Rejection when sold weight exceeds harvested weight ---');
  let test1Passed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 100,
      soldWeightKg: 150, // 150 kg > 100 kg harvested
      harvestQuantity: 200,
      salePrice: 30000,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      currentUserId: 'usr-b1',
      isPartialHarvest: true
    });
  } catch (err: any) {
    test1Passed = true;
    console.log(`✅ Correctly rejected sold weight exceeding harvest weight: "${err.message}"`);
  }
  assert(test1Passed, 'Transaction must reject sold weight exceeding harvested weight');

  // TEST 2: Rejection when harvest weight exceeds physically available batch weight
  console.log('\n--- Test 2: Rejection when harvest weight exceeds physically available batch weight ---');
  let test2Passed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 600, // 600 kg > 500 kg physically available
      harvestQuantity: 800,
      salePrice: 120000,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      currentUserId: 'usr-b1',
      isPartialHarvest: true
    });
  } catch (err: any) {
    test2Passed = true;
    console.log(`✅ Correctly rejected harvest weight exceeding physically available weight: "${err.message}"`);
  }
  assert(test2Passed, 'Transaction must reject harvest weight exceeding physically available weight');

  // TEST 3: Rejection when harvest count is 0 but positive sale weight or revenue is entered
  console.log('\n--- Test 3: Rejection when harvest quantity is 0 but sale weight/revenue entered ---');
  let test3Passed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestQuantity: 0,
      harvestWeightKg: 50,
      salePrice: 10000,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      currentUserId: 'usr-b1',
      isPartialHarvest: true
    });
  } catch (err: any) {
    test3Passed = true;
    console.log(`✅ Correctly rejected harvest count 0 with positive sale weight: "${err.message}"`);
  }
  assert(test3Passed, 'Transaction must reject harvest count 0 with positive sale weight');

  // TEST 4: Rejection when sold count exceeds harvested count
  console.log('\n--- Test 4: Rejection when sold fish count exceeds harvested count ---');
  let test4Passed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestQuantity: 100,
      soldQuantity: 150, // 150 fish sold > 100 fish harvested
      harvestWeightKg: 100,
      salePrice: 20000,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      currentUserId: 'usr-b1',
      isPartialHarvest: true
    });
  } catch (err: any) {
    test4Passed = true;
    console.log(`✅ Correctly rejected sold count exceeding harvested count: "${err.message}"`);
  }
  assert(test4Passed, 'Transaction must reject sold count exceeding harvested count');

  // TEST 5: Rejection when recording sale with zero or negative harvest weight
  console.log('\n--- Test 5: Rejection when recording sale with 0 harvest weight ---');
  let test5Passed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 0,
      salePrice: 20000,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      currentUserId: 'usr-b1',
      isPartialHarvest: true
    });
  } catch (err: any) {
    test5Passed = true;
    console.log(`✅ Correctly rejected sale with 0 harvest weight: "${err.message}"`);
  }
  assert(test5Passed, 'Transaction must reject sale with 0 harvest weight');

  // TEST 6: Successful partial harvest and sale where sold weight == harvest weight
  console.log('\n--- Test 6: Successful partial harvest with valid weights ---');
  const result6 = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 150,
    harvestQuantity: 200,
    salePrice: 30000,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    currentUserId: 'usr-b1',
    isPartialHarvest: true
  });
  assert(result6.sale !== undefined, 'Sale record must be created');
  assert(result6.sale?.items[0].quantity === 150, 'Sale item quantity must be 150 kg');
  assert(result6.updatedBatch.currentEstimatedWeightKg === 350, `Remaining estimated weight must be 350 kg, got ${result6.updatedBatch.currentEstimatedWeightKg}`);
  assert(result6.updatedBatch.fingerlingQty === 800, 'Remaining fish count must be 800');
  console.log('✅ Partial harvest with exact weight sold succeeded.');

  // TEST 7: Successful partial harvest where sold weight < harvest weight (farm retained portion)
  console.log('\n--- Test 7: Successful harvest where sold weight < harvest weight ---');
  const result7 = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 100, // 100 kg harvested
    soldWeightKg: 75,     // 75 kg sold, 25 kg kept on farm
    harvestQuantity: 150,
    salePrice: 18750,
    paymentMethod: 'CASH',
    date: '2026-03-12',
    currentUserId: 'usr-b1',
    isPartialHarvest: true
  });
  assert(result7.sale !== undefined, 'Sale record must be created');
  assert(result7.sale?.items[0].quantity === 75, `Sale item quantity must be 75 kg, got ${result7.sale?.items[0].quantity}`);
  assert(result7.updatedBatch.harvestWeightKg === 250, `Cumulative harvested weight must be 250 kg (150 + 100), got ${result7.updatedBatch.harvestWeightKg}`);
  assert(result7.updatedBatch.currentEstimatedWeightKg === 250, `Remaining estimated weight must be 250 kg (350 - 100), got ${result7.updatedBatch.currentEstimatedWeightKg}`);
  console.log('✅ Harvest with sold weight < harvested weight succeeded cleanly.');

  console.log('\n====================================================');
  console.log('ALL TASK B1 TESTS PASSED!');
  console.log('====================================================\n');
  return true;
}

if (process.argv[1]?.includes('testTaskB1FishHarvestWeightControl')) {
  runTaskB1Tests().catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
}
