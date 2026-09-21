import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeFishStockingTransaction,
  executeFishProductionCostTransaction,
  executeFishHarvestAndSaleTransaction,
  getFishBatchAccumulatedCost,
  calculateFishBatchRecordedCosts,
  integrateFishProductionCostAccounting
} from '../services/transactionService';
import { FishBatch, CashBankAccount, InventoryItem } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runFishBatchCostAccountingTest() {
  console.log('====================================================');
  console.log('STARTING FISH PRODUCTION COST ACCOUNTING ISOLATION TEST');
  console.log('====================================================\n');

  // 1. Reset Database and Seed Chart of Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);
  await db.journalEntries.clear();
  await db.fishBatches.clear();
  await db.cashBankAccounts.clear();
  await db.inventoryItems.clear();
  await db.auditLogs.clear();
  await db.closedPeriods.clear();

  // 2. Seed Cash and Bank Accounts
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-01',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountType: 'CASH',
    accountNumber: 'CASH-01',
    currentBalance: 200000,
    isActive: true
  };
  await db.cashBankAccounts.add(cashAccount);

  const bankAccount: CashBankAccount = {
    id: 'cba-bank-01',
    name: 'Agrani Bank Ltd',
    accountName: 'Agrani Bank Current Account',
    accountType: 'BANK',
    accountNumber: '020001234567',
    bankName: 'Agrani Bank',
    currentBalance: 300000,
    isActive: true
  };
  await db.cashBankAccounts.add(bankAccount);

  // 3. Seed Feed Inventory Item for testing inventory consumption
  const feedItem: InventoryItem = {
    id: 'inv-fish-feed-01',
    code: 'FFD-01',
    nameBn: 'মাছের গ্রোয়ার ফিড',
    nameEn: 'Fish Grower Feed',
    category: 'FEED',
    unit: 'kg',
    currentStock: 200,
    reorderLevel: 20,
    avgCostPrice: 80,
    sellingPrice: 90
  };
  await db.inventoryItems.add(feedItem);

  console.log('✅ Accounts and Master Data Seeded Successfully.');

  // ----------------------------------------------------
  // STEP 1: Stock TWO Separate Fish Batches
  // ----------------------------------------------------
  console.log('\n--- Step 1: Stocking Two Separate Fish Batches ---');

  // Batch 1: Tilapia in Pond North
  const stockResult1 = await executeFishStockingTransaction({
    pondName: 'North Pond (পুকুর-১)',
    species: 'Tilapia',
    fingerlingQty: 3000,
    fingerlingCost: 12000,
    paymentMethod: 'CASH',
    stockingDate: '2026-03-01',
    currentUserId: 'test-user'
  });
  const batch1Id = stockResult1.batch.id;
  console.log(`✓ Batch 1 Created: ID=${batch1Id}, Fingerlings Cost=৳12,000`);

  // Batch 2: Pangash in South Pond
  const stockResult2 = await executeFishStockingTransaction({
    pondName: 'South Pond (পুকুর-২)',
    species: 'Pangash',
    fingerlingQty: 5000,
    fingerlingCost: 20000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    stockingDate: '2026-03-05',
    currentUserId: 'test-user'
  });
  const batch2Id = stockResult2.batch.id;
  console.log(`✓ Batch 2 Created: ID=${batch2Id}, Fingerlings Cost=৳20,000`);

  assert(batch1Id !== batch2Id, 'Batch IDs must be strictly unique.');

  // Verify Initial Costs
  const costStatus1_init = await getFishBatchAccumulatedCost(batch1Id);
  const costStatus2_init = await getFishBatchAccumulatedCost(batch2Id);

  assert(costStatus1_init.accumulatedCost === 12000, `Batch 1 initial cost must be ৳12,000 (got ${costStatus1_init.accumulatedCost})`);
  assert(costStatus2_init.accumulatedCost === 20000, `Batch 2 initial cost must be ৳20,000 (got ${costStatus2_init.accumulatedCost})`);
  assert(costStatus1_init.accountingDebits === 12000, 'Batch 1 accounting debits must match initial fingerling cost');
  assert(costStatus2_init.accountingDebits === 20000, 'Batch 2 accounting debits must match initial fingerling cost');

  // ----------------------------------------------------
  // STEP 2: Accumulate Legitimate Production Costs to Batch 1
  // Feed, Labour, Electricity
  // ----------------------------------------------------
  console.log('\n--- Step 2: Adding Legitimate Costs to Batch 1 ---');

  // Batch 1: Feed (Cash) ৳8,000
  await executeFishProductionCostTransaction({
    batchId: batch1Id,
    costType: 'FEED',
    amount: 8000,
    quantity: 100,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    currentUserId: 'test-user'
  });

  // Batch 1: Labour (Cash) ৳3,500
  await executeFishProductionCostTransaction({
    batchId: batch1Id,
    costType: 'LABOUR',
    amount: 3500,
    paymentMethod: 'CASH',
    date: '2026-03-15',
    currentUserId: 'test-user'
  });

  // Batch 1: Electricity (Cash) ৳2,000
  await executeFishProductionCostTransaction({
    batchId: batch1Id,
    costType: 'ELECTRICITY',
    amount: 2000,
    paymentMethod: 'CASH',
    date: '2026-03-20',
    currentUserId: 'test-user'
  });

  // Check Batch 1 vs Batch 2
  const costStatus1_mid = await getFishBatchAccumulatedCost(batch1Id);
  const costStatus2_mid = await getFishBatchAccumulatedCost(batch2Id);

  const expectedBatch1_mid = 12000 + 8000 + 3500 + 2000; // ৳25,500
  assert(
    costStatus1_mid.accumulatedCost === expectedBatch1_mid,
    `Batch 1 accumulated cost must equal ৳${expectedBatch1_mid} (got ${costStatus1_mid.accumulatedCost})`
  );
  assert(
    costStatus2_mid.accumulatedCost === 20000,
    `Batch 2 accumulated cost must remain STRICTLY UNCHANGED at ৳20,000 (got ${costStatus2_mid.accumulatedCost})`
  );

  console.log(`✓ Batch 1 accumulated cost: ৳${costStatus1_mid.accumulatedCost}`);
  console.log(`✓ Batch 2 accumulated cost preserved untouched: ৳${costStatus2_mid.accumulatedCost}`);

  // ----------------------------------------------------
  // STEP 3: Accumulate Legitimate Production Costs to Batch 2
  // Feed (Inventory), Medicine, Water treatment, Other
  // ----------------------------------------------------
  console.log('\n--- Step 3: Adding Legitimate Costs to Batch 2 ---');

  // Batch 2: Feed via Inventory consumption 50kg @ ৳80 = ৳4,000
  await executeFishProductionCostTransaction({
    batchId: batch2Id,
    costType: 'FEED',
    amount: 4000,
    quantity: 50,
    paymentMethod: 'INVENTORY',
    feedItemId: feedItem.id,
    date: '2026-03-12',
    currentUserId: 'test-user'
  });

  // Batch 2: Medicine (Bank) ৳1,500
  await executeFishProductionCostTransaction({
    batchId: batch2Id,
    costType: 'MEDICINE',
    amount: 1500,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-03-14',
    currentUserId: 'test-user'
  });

  // Batch 2: Water treatment (Cash) ৳1,800
  await executeFishProductionCostTransaction({
    batchId: batch2Id,
    costType: 'WATER_TREATMENT',
    amount: 1800,
    paymentMethod: 'CASH',
    date: '2026-03-18',
    currentUserId: 'test-user'
  });

  // Batch 2: Other legitimate production cost (Cash) ৳1,200
  await executeFishProductionCostTransaction({
    batchId: batch2Id,
    costType: 'OTHER',
    amount: 1200,
    paymentMethod: 'CASH',
    date: '2026-03-22',
    currentUserId: 'test-user'
  });

  // ----------------------------------------------------
  // STEP 4: Rigorous Cost Isolation & Account 1580 Verification
  // ----------------------------------------------------
  console.log('\n--- Step 4: Verifying Batch Isolation and Global 1580 Rules ---');

  const costStatus1_final = await getFishBatchAccumulatedCost(batch1Id);
  const costStatus2_final = await getFishBatchAccumulatedCost(batch2Id);

  const expectedBatch2_final = 20000 + 4000 + 1500 + 1800 + 1200; // ৳28,500

  assert(
    costStatus1_final.accumulatedCost === 25500,
    `Batch 1 final cost must remain exactly ৳25,500 (got ${costStatus1_final.accumulatedCost})`
  );
  assert(
    costStatus2_final.accumulatedCost === expectedBatch2_final,
    `Batch 2 final cost must equal exactly ৳${expectedBatch2_final} (got ${costStatus2_final.accumulatedCost})`
  );

  // Verify journal entries are strictly partitioned by batch ID
  const allEntries = await db.journalEntries.toArray();
  const b1Entries = allEntries.filter((j) => j.reference === batch1Id);
  const b2Entries = allEntries.filter((j) => j.reference === batch2Id);

  assert(b1Entries.length === 4, `Batch 1 must have exactly 4 journal entries (stocking + 3 costs), got ${b1Entries.length}`);
  assert(b2Entries.length === 5, `Batch 2 must have exactly 5 journal entries (stocking + 4 costs), got ${b2Entries.length}`);

  for (const entry of b1Entries) {
    assert(entry.reference === batch1Id, `Entry ${entry.id} must strictly reference Batch 1`);
    assert(
      !entry.narration?.includes(batch2Id),
      `Batch 1 entry must NEVER mention Batch 2`
    );
  }

  for (const entry of b2Entries) {
    assert(entry.reference === batch2Id, `Entry ${entry.id} must strictly reference Batch 2`);
    assert(
      !entry.narration?.includes(batch1Id),
      `Batch 2 entry must NEVER mention Batch 1`
    );
  }

  // Calculate global 1580 balance across all entries
  let global1580Debit = 0;
  let global1580Credit = 0;
  for (const entry of allEntries) {
    for (const line of entry.lines || []) {
      if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
        global1580Debit += line.debit || 0;
        global1580Credit += line.credit || 0;
      }
    }
  }
  const global1580Balance = global1580Debit - global1580Credit;
  const expectedTotal1580 = 25500 + 28500; // ৳54,000

  assert(
    global1580Balance === expectedTotal1580,
    `Global 1580 balance must equal sum of all biological assets ৳${expectedTotal1580} (got ${global1580Balance})`
  );

  // CRITICAL REQUIREMENT: Do NOT use global account 1580 as the cost of a specific batch
  assert(
    costStatus1_final.accumulatedCost !== global1580Balance,
    `Rule violation: Batch 1 cost (৳${costStatus1_final.accumulatedCost}) must NEVER be equal to global 1580 balance (৳${global1580Balance})`
  );
  assert(
    costStatus2_final.accumulatedCost !== global1580Balance,
    `Rule violation: Batch 2 cost (৳${costStatus2_final.accumulatedCost}) must NEVER be equal to global 1580 balance (৳${global1580Balance})`
  );

  console.log(`✓ Global Account 1580 Balance = ৳${global1580Balance}`);
  console.log(`✓ Batch 1 Cost = ৳${costStatus1_final.accumulatedCost} (strictly isolated)`);
  console.log(`✓ Batch 2 Cost = ৳${costStatus2_final.accumulatedCost} (strictly isolated)`);
  console.log('✓ Rule Verified: Batch costs are derived exclusively from batch-linked entries, never global 1580 balance.');

  // ----------------------------------------------------
  // STEP 5: Duplicate Prevention Verification
  // ----------------------------------------------------
  console.log('\n--- Step 5: Verifying Duplicate Cost Prevention ---');

  let duplicateRejected = false;
  try {
    // Attempt to post the exact same electricity cost for Batch 1 again within the same minute
    await executeFishProductionCostTransaction({
      batchId: batch1Id,
      costType: 'ELECTRICITY',
      amount: 2000,
      paymentMethod: 'CASH',
      date: '2026-03-20',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicateRejected = true;
    console.log(`✓ Duplicate successfully rejected with message: "${err.message}"`);
  }

  assert(duplicateRejected, 'System must reject recording duplicate costs for the same batch!');

  // ----------------------------------------------------
  // STEP 6: Unbacked Operational Cost Rejection Verification
  // ----------------------------------------------------
  console.log('\n--- Step 6: Verifying Unbacked Operational Cost Rejection ---');

  // Artificially inflate an operational field on Batch 1 without a source accounting transaction
  const batch1Record = await db.fishBatches.get(batch1Id);
  if (batch1Record) {
    batch1Record.medicineCost = 5000; // Operational field set to 5000, but no journal entry exists!
    await db.fishBatches.put(batch1Record);
  }

  const batch1StatusWithMismatch = await getFishBatchAccumulatedCost(batch1Id);
  assert(!batch1StatusWithMismatch.isConsistent, 'Batch 1 must be flagged as inconsistent due to unbacked cost');
  assert(batch1StatusWithMismatch.unbackedCost === 5000, `Unbacked cost must be ৳5,000 (got ${batch1StatusWithMismatch.unbackedCost})`);
  console.log(`✓ Unbacked operational cost correctly identified: ৳${batch1StatusWithMismatch.unbackedCost}`);

  // Attempting integration must reject the mismatch instead of inventing a credit!
  let integrationMismatchRejected = false;
  try {
    await integrateFishProductionCostAccounting(batch1Id);
  } catch (err: any) {
    integrationMismatchRejected = true;
    console.log(`✓ integrateFishProductionCostAccounting rejected mismatch: "${err.message}"`);
  }
  assert(integrationMismatchRejected, 'integrateFishProductionCostAccounting must reject unbacked operational numbers!');

  // Attempting harvest must reject the mismatch instead of inventing a credit!
  let harvestMismatchRejected = false;
  try {
    await executeFishHarvestAndSaleTransaction({
      batchId: batch1Id,
      harvestWeightKg: 1200,
      salePrice: 150000,
      paymentMethod: 'CASH',
      date: '2026-04-01',
      mortalityCount: 0,
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    harvestMismatchRejected = true;
    console.log(`✓ executeFishHarvestAndSaleTransaction rejected mismatch: "${err.message}"`);
  }
  assert(harvestMismatchRejected, 'Harvest derecognition must reject unbacked operational numbers!');

  // Revert operational field back to legitimate backed state
  if (batch1Record) {
    batch1Record.medicineCost = 0;
    await db.fishBatches.put(batch1Record);
  }

  // ----------------------------------------------------
  // STEP 7: Legitimate Harvest & Derecognition of Batch 1
  // ----------------------------------------------------
  console.log('\n--- Step 7: Harvest & Derecognition of Batch 1 ---');

  const harvestResult = await executeFishHarvestAndSaleTransaction({
    batchId: batch1Id,
    harvestWeightKg: 1200,
    salePrice: 150000,
    paymentMethod: 'CASH',
    date: '2026-04-01',
    mortalityCount: 50,
    currentUserId: 'test-user'
  });

  console.log(`✓ Batch 1 Harvested: Sale=৳150,000, Revenue Voucher=${harvestResult.voucherNumber}, COGS Voucher=${harvestResult.cogsVoucherNumber}`);

  // Verify Batch 1 costs are fully derecognized to COGS and Mortality Loss
  const costStatus1_afterHarvest = await getFishBatchAccumulatedCost(batch1Id);
  assert(costStatus1_afterHarvest.netRemainingCost === 0, `Batch 1 net remaining asset cost must be 0 after harvest (got ${costStatus1_afterHarvest.netRemainingCost})`);
  assert(
    costStatus1_afterHarvest.cogsTransferred + costStatus1_afterHarvest.mortalityTransferred === 25500,
    `Batch 1 transferred cost must exactly match total batch cost ৳25,500 (got ${costStatus1_afterHarvest.cogsTransferred + costStatus1_afterHarvest.mortalityTransferred})`
  );

  // Verify Batch 2 is COMPLETELY UNAFFECTED by Batch 1's harvest!
  const costStatus2_afterHarvest = await getFishBatchAccumulatedCost(batch2Id);
  assert(
    costStatus2_afterHarvest.accumulatedCost === 28500,
    `Batch 2 accumulated cost must remain untouched at ৳28,500 (got ${costStatus2_afterHarvest.accumulatedCost})`
  );
  assert(
    costStatus2_afterHarvest.netRemainingCost === 28500,
    `Batch 2 net remaining asset balance must remain untouched at ৳28,500 (got ${costStatus2_afterHarvest.netRemainingCost})`
  );
  assert(
    costStatus2_afterHarvest.cogsTransferred === 0,
    'Batch 2 must have 0 COGS transferred'
  );

  console.log(`✓ Batch 1 Net Remaining Cost: ৳${costStatus1_afterHarvest.netRemainingCost} (transferred to COGS/Mortality)`);
  console.log(`✓ Batch 2 Net Remaining Cost: ৳${costStatus2_afterHarvest.netRemainingCost} (completely untouched)`);

  console.log('\n====================================================');
  console.log('✅ ALL FISH PRODUCTION COST ACCOUNTING ISOLATION TESTS PASSED!');
  console.log('====================================================\n');
}

runFishBatchCostAccountingTest().catch((err) => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
