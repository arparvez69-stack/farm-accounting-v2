import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeFishStockingTransaction,
  executeFishHarvestAndSaleTransaction,
  executeCropHarvestAndSaleTransaction,
  executeCropProductionCostTransaction
} from '../services/transactionService';
import { FishBatch, CropCycle, CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runHarvestQuantityControlTest() {
  console.log('========================================================');
  console.log('STARTING FISH & CROP HARVEST QUANTITY CONTROL TEST');
  console.log('========================================================\n');

  // 1. Reset Database and Seed Chart of Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);
  await db.journalEntries.clear();
  await db.fishBatches.clear();
  await db.cropCycles.clear();
  await db.cashBankAccounts.clear();
  await db.inventoryItems.clear();
  await db.auditLogs.clear();
  await db.closedPeriods.clear();
  await db.sales.clear();

  // 2. Seed Cash and Bank Accounts
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-harvest',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountType: 'CASH',
    accountNumber: 'CASH-HARV-01',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.add(cashAccount);

  console.log('--- TEST 1: FISH HARVEST QUANTITY CONTROL ---');

  // Stock fish batch with 1,000 fingerlings
  const stockingResult = await executeFishStockingTransaction({
    pondName: 'Pond A',
    species: 'Tilapia',
    fingerlingQty: 1000,
    fingerlingCost: 50000,
    paymentMethod: 'CASH',
    date: '2026-03-01',
    currentUserId: 'usr-tester',
    notes: 'Initial stocking of 1000 fingerlings'
  });
  const batchId = stockingResult.batch.id;

  const stockedBatch = await db.fishBatches.get(batchId);
  assert(stockedBatch !== undefined, 'Stocked fish batch must exist');
  assert(stockedBatch?.fingerlingQty === 1000, 'Initial fingerlingQty must be 1000');
  assert(stockedBatch?.originalStockedQty === 1000, 'originalStockedQty must be 1000');
  console.log('✅ Fish batch created with 1,000 fingerlings.');

  // Test 1.1: Rejection of excessive mortality
  console.log('\nTesting rejection of excessive fish mortality (> available 1000)...');
  let excessiveMortalityFailed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 0,
      harvestQuantity: 0,
      mortalityCount: 1200,
      salePrice: 0,
      paymentMethod: 'CASH',
      date: '2026-03-05',
      currentUserId: 'usr-tester',
      isPartialHarvest: true
    });
  } catch (err: any) {
    excessiveMortalityFailed = true;
    console.log(`✅ Excessive mortality correctly rejected: "${err.message}"`);
  }
  assert(excessiveMortalityFailed, 'Excessive mortality must be rejected');

  // Test 1.2: Rejection of excessive harvest quantity
  console.log('\nTesting rejection of excessive fish harvest quantity (> available 1000)...');
  let excessiveHarvestFailed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 500,
      harvestQuantity: 1100,
      salePrice: 50000,
      paymentMethod: 'CASH',
      date: '2026-03-06',
      currentUserId: 'usr-tester',
      isPartialHarvest: true
    });
  } catch (err: any) {
    excessiveHarvestFailed = true;
    console.log(`✅ Excessive harvest correctly rejected: "${err.message}"`);
  }
  assert(excessiveHarvestFailed, 'Excessive harvest must be rejected');

  // Test 1.3: Repeated partial harvests
  console.log('\nExecuting Partial Harvest 1: 300 fish, 50 mortality...');
  const harvest1 = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 150,
    harvestQuantity: 300,
    mortalityCount: 50,
    salePrice: 30000,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    currentUserId: 'usr-tester',
    isPartialHarvest: true
  });

  assert(harvest1.updatedBatch.status === 'ACTIVE', 'Batch should remain ACTIVE after partial harvest');
  assert(harvest1.updatedBatch.fingerlingQty === 650, `Remaining fingerlings must be 650, got ${harvest1.updatedBatch.fingerlingQty}`);
  assert(harvest1.updatedBatch.mortalityCount === 50, 'Mortality count should be 50');
  assert(harvest1.updatedBatch.harvestQuantity === 300, 'Harvested quantity should be 300');
  console.log('✅ Partial harvest 1 succeeded. Remaining available: 650 fish.');

  console.log('\nExecuting Partial Harvest 2: 250 fish, 50 mortality...');
  const harvest2 = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 125,
    harvestQuantity: 250,
    mortalityCount: 50,
    salePrice: 25000,
    paymentMethod: 'CASH',
    date: '2026-03-15',
    currentUserId: 'usr-tester',
    isPartialHarvest: true
  });

  assert(harvest2.updatedBatch.status === 'ACTIVE', 'Batch should remain ACTIVE after second partial harvest');
  assert(harvest2.updatedBatch.fingerlingQty === 350, `Remaining fingerlings must be 350, got ${harvest2.updatedBatch.fingerlingQty}`);
  assert(harvest2.updatedBatch.mortalityCount === 100, 'Cumulative mortality should be 100');
  assert(harvest2.updatedBatch.harvestQuantity === 550, 'Cumulative harvest should be 550');
  console.log('✅ Partial harvest 2 succeeded. Remaining available: 350 fish.');

  // Test 1.4: Rejection of excessive harvest against remaining 350
  console.log('\nTesting rejection of excessive harvest (400 requested vs 350 remaining)...');
  let excessiveRemainingFailed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 200,
      harvestQuantity: 400,
      salePrice: 40000,
      paymentMethod: 'CASH',
      date: '2026-03-18',
      currentUserId: 'usr-tester',
      isPartialHarvest: true
    });
  } catch (err: any) {
    excessiveRemainingFailed = true;
    console.log(`✅ Excessive harvest against remaining balance correctly rejected: "${err.message}"`);
  }
  assert(excessiveRemainingFailed, 'Harvest exceeding remaining quantity must be rejected');

  // Test 1.5: Final harvest of exact remaining quantity
  console.log('\nExecuting Final Harvest: 350 fish (exact remaining)...');
  const harvest3 = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 175,
    harvestQuantity: 350,
    mortalityCount: 0,
    salePrice: 35000,
    paymentMethod: 'CASH',
    date: '2026-03-20',
    currentUserId: 'usr-tester',
    isPartialHarvest: false
  });

  assert(harvest3.updatedBatch.status === 'HARVESTED', 'Batch must be marked HARVESTED');
  assert(harvest3.updatedBatch.fingerlingQty === 0, 'Remaining fish count must be 0');
  assert(harvest3.updatedBatch.harvestQuantity === 900, 'Total harvested quantity must be 900');
  assert(harvest3.updatedBatch.mortalityCount === 100, 'Total mortality count must be 100');
  console.log('✅ Final harvest succeeded. Total fish accounted for: 900 harvested + 100 dead = 1,000 original.');

  // Test 1.6: Post-harvest attempt rejected
  console.log('\nTesting rejection of harvest on completed/HARVESTED fish batch...');
  let postHarvestFailed = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId,
      harvestWeightKg: 50,
      harvestQuantity: 50,
      salePrice: 5000,
      paymentMethod: 'CASH',
      date: '2026-03-22',
      currentUserId: 'usr-tester'
    });
  } catch (err: any) {
    postHarvestFailed = true;
    console.log(`✅ Post-harvest attempt correctly rejected: "${err.message}"`);
  }
  assert(postHarvestFailed, 'Attempt to harvest completed batch must be rejected');

  console.log('\n--- TEST 2: CROP HARVEST QUANTITY CONTROL ---');

  // Create crop cycle with expected yield 1,000 kg
  const cycleId = 'crop-cycle-wheat-01';
  const newCycle: CropCycle = {
    id: cycleId,
    plotId: 'plot-01',
    plotName: 'Plot Alpha',
    cropName: 'Wheat',
    cropCategory: 'GRAIN',
    plantingDate: '2026-01-01',
    expectedHarvestDate: '2026-04-01',
    areaDecimals: 50,
    seedCost: 10000,
    fertilizerCost: 5000,
    irrigationCost: 3000,
    labourCost: 2000,
    otherCost: 0,
    totalCost: 20000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    expectedYieldKg: 1000,
    status: 'GROWING'
  };
  await db.cropCycles.add(newCycle);

  // Capitalize production costs so accounting balance matches
  await executeCropProductionCostTransaction({
    cycleId,
    category: 'SEED',
    amount: 20000,
    paymentMethod: 'CASH',
    date: '2026-01-05',
    currentUserId: 'usr-tester',
    notes: 'Seed and initial fertilizers'
  });
  console.log('✅ Crop cycle created with expected yield 1,000 kg and capitalized cost.');

  // Test 2.1: Rejection of excessive crop harvest (> 1000 kg)
  console.log('\nTesting rejection of excessive crop harvest (1,200 kg vs 1,000 kg available)...');
  let excessiveCropFailed = false;
  try {
    await executeCropHarvestAndSaleTransaction({
      cycleId,
      harvestYieldKg: 1200,
      salePrice: 60000,
      paymentMethod: 'CASH',
      date: '2026-03-25',
      currentUserId: 'usr-tester',
      isPartialHarvest: true
    });
  } catch (err: any) {
    excessiveCropFailed = true;
    console.log(`✅ Excessive crop harvest correctly rejected: "${err.message}"`);
  }
  assert(excessiveCropFailed, 'Excessive crop harvest must be rejected');

  // Test 2.2: Partial harvest 1 (400 kg)
  console.log('\nExecuting Crop Partial Harvest 1: 400 kg...');
  const cropHarvest1 = await executeCropHarvestAndSaleTransaction({
    cycleId,
    harvestYieldKg: 400,
    salePrice: 20000,
    paymentMethod: 'CASH',
    date: '2026-03-26',
    currentUserId: 'usr-tester',
    isPartialHarvest: true,
    remainingAreaDecimals: 30
  });

  assert(cropHarvest1.updatedCycle.status === 'GROWING', 'Cycle should remain GROWING after partial harvest');
  assert(cropHarvest1.updatedCycle.harvestYieldKg === 400, `Harvest yield must be 400 kg, got ${cropHarvest1.updatedCycle.harvestYieldKg}`);
  console.log('✅ Partial harvest 1 succeeded. Remaining yield: 600 kg.');

  // Test 2.3: Partial harvest 2 (350 kg)
  console.log('\nExecuting Crop Partial Harvest 2: 350 kg...');
  const cropHarvest2 = await executeCropHarvestAndSaleTransaction({
    cycleId,
    harvestYieldKg: 350,
    salePrice: 17500,
    paymentMethod: 'CASH',
    date: '2026-03-27',
    currentUserId: 'usr-tester',
    isPartialHarvest: true,
    remainingAreaDecimals: 10
  });

  assert(cropHarvest2.updatedCycle.status === 'GROWING', 'Cycle should remain GROWING after second partial harvest');
  assert(cropHarvest2.updatedCycle.harvestYieldKg === 750, `Cumulative harvest yield must be 750 kg, got ${cropHarvest2.updatedCycle.harvestYieldKg}`);
  console.log('✅ Partial harvest 2 succeeded. Remaining yield: 250 kg.');

  // Test 2.4: Rejection of excessive harvest against remaining 250 kg
  console.log('\nTesting rejection of harvest exceeding remaining 250 kg (300 kg requested)...');
  let excessiveCropRemainingFailed = false;
  try {
    await executeCropHarvestAndSaleTransaction({
      cycleId,
      harvestYieldKg: 300,
      salePrice: 15000,
      paymentMethod: 'CASH',
      date: '2026-03-28',
      currentUserId: 'usr-tester',
      isPartialHarvest: true
    });
  } catch (err: any) {
    excessiveCropRemainingFailed = true;
    console.log(`✅ Excessive harvest against remaining crop production rejected: "${err.message}"`);
  }
  assert(excessiveCropRemainingFailed, 'Harvest exceeding remaining crop yield must be rejected');

  // Test 2.5: Final harvest of exact remaining quantity (250 kg)
  console.log('\nExecuting Final Crop Harvest: 250 kg (exact remaining)...');
  const cropHarvest3 = await executeCropHarvestAndSaleTransaction({
    cycleId,
    harvestYieldKg: 250,
    salePrice: 12500,
    paymentMethod: 'CASH',
    date: '2026-03-29',
    currentUserId: 'usr-tester',
    isPartialHarvest: false
  });

  assert(cropHarvest3.updatedCycle.status === 'HARVESTED', 'Cycle must be marked HARVESTED');
  assert(cropHarvest3.updatedCycle.harvestYieldKg === 1000, 'Total harvest yield must be 1000 kg');
  console.log('✅ Final harvest succeeded. Total yield harvested: 1,000 kg.');

  // Test 2.6: Post-harvest attempt rejected
  console.log('\nTesting rejection of harvest on completed/HARVESTED crop cycle...');
  let postCropHarvestFailed = false;
  try {
    await executeCropHarvestAndSaleTransaction({
      cycleId,
      harvestYieldKg: 50,
      salePrice: 2500,
      paymentMethod: 'CASH',
      date: '2026-03-30',
      currentUserId: 'usr-tester'
    });
  } catch (err: any) {
    postCropHarvestFailed = true;
    console.log(`✅ Post-harvest attempt on completed crop cycle correctly rejected: "${err.message}"`);
  }
  assert(postCropHarvestFailed, 'Attempt to harvest completed crop cycle must be rejected');

  console.log('\n========================================================');
  console.log('ALL FISH & CROP HARVEST QUANTITY CONTROL TESTS PASSED! 🎉');
  console.log('========================================================\n');
}

// Auto-run when executed directly via tsx
runHarvestQuantityControlTest().catch((err) => {
  console.error('Fatal error during test execution:', err);
  process.exit(1);
});
