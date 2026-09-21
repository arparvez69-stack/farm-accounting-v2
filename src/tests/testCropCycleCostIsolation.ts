import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeCropProductionCostTransaction,
  executeCropHarvestAndSaleTransaction,
  getCropCycleAccumulatedCost,
  calculateCropCycleRecordedCosts,
  integrateCropProductionCostAccounting,
  reclassifyCropExpenseToWip
} from '../services/transactionService';
import { CropCycle, CashBankAccount, JournalEntry } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runCropCycleCostIsolationTest() {
  console.log('========================================================');
  console.log('STARTING CROP PRODUCTION COST ACCOUNTING ISOLATION TEST');
  console.log('========================================================\n');

  // 1. Reset Database and Seed Chart of Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);
  await db.journalEntries.clear();
  await db.cropCycles.clear();
  await db.cashBankAccounts.clear();
  await db.inventoryItems.clear();
  await db.auditLogs.clear();
  await db.closedPeriods.clear();

  // 2. Seed Cash and Bank Accounts
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-crop',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountType: 'CASH',
    accountNumber: 'CASH-CROP-01',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.add(cashAccount);

  const bankAccount: CashBankAccount = {
    id: 'cba-bank-crop',
    name: 'Agrani Bank Ltd',
    accountName: 'Agrani Bank Current Account',
    accountType: 'BANK',
    accountNumber: '020001234567',
    bankName: 'Agrani Bank',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.add(bankAccount);

  // 3. Create TWO distinct Crop Cycles
  const cycleAId = 'crop_cycle_paddy_north';
  const cycleBId = 'crop_cycle_wheat_south';

  const cycleA: CropCycle = {
    id: cycleAId,
    plotId: 'plot_north_01',
    plotName: 'North Field Sector 1',
    cropName: 'Aman Paddy',
    cropCategory: 'GRAIN',
    areaDecimals: 250,
    plantingDate: '2026-03-01',
    expectedHarvestDate: '2026-06-15',
    status: 'GROWING',
    seedCost: 0,
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 0,
    protectionCost: 0,
    machineryCost: 0,
    otherCost: 0,
    totalCost: 0,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    synced: false
  };

  const cycleB: CropCycle = {
    id: cycleBId,
    plotId: 'plot_south_02',
    plotName: 'South Field Sector 2',
    cropName: 'Summer Maize',
    cropCategory: 'GRAIN',
    areaDecimals: 300,
    plantingDate: '2026-04-01',
    expectedHarvestDate: '2026-08-20',
    status: 'GROWING',
    seedCost: 0,
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 0,
    protectionCost: 0,
    machineryCost: 0,
    otherCost: 0,
    totalCost: 0,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    synced: false
  };

  await db.cropCycles.bulkAdd([cycleA, cycleB]);
  console.log(`✅ Initialized Two Crop Cycles: ${cycleA.cropName} (${cycleA.id}) and ${cycleB.cropName} (${cycleB.id})`);

  // 4. Record Legitimate Production Costs for Cycle A
  // Seed: 12,000, Fertilizer: 8,000, Irrigation: 5,000, Labour: 6,000, Protection: 3,000, Machinery: 4,000, Other: 2,000 -> Total = 40,000
  console.log('\n--- Recording Production Costs for Cycle A (Paddy) ---');
  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'SEED',
    amount: 12000,
    paymentMethod: 'CASH',
    date: '2026-03-02',
    notes: 'Paddy High Yield Seeds'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'FERTILIZER',
    amount: 8000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-03-10',
    notes: 'Urea and DAP'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'IRRIGATION',
    amount: 5000,
    paymentMethod: 'CASH',
    date: '2026-03-20',
    notes: 'Deep Tube-well Irrigation'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'LABOUR',
    amount: 6000,
    paymentMethod: 'CASH',
    date: '2026-04-01',
    notes: 'Weeding and Transplanting Labour'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'PROTECTION',
    amount: 3000,
    paymentMethod: 'CASH',
    date: '2026-04-15',
    notes: 'Pest protection spray'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'MACHINERY',
    amount: 4000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-05-01',
    notes: 'Tractor and Tiller rent'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleAId,
    costType: 'OTHER',
    amount: 2000,
    paymentMethod: 'CASH',
    date: '2026-05-10',
    notes: 'Transport and field sacks'
  });

  const costStatusA1 = await getCropCycleAccumulatedCost(cycleAId);
  console.log(`Cycle A Accumulated Cost: ৳${costStatusA1.accumulatedCost}`);
  assert(costStatusA1.accumulatedCost === 40000, `Cycle A accumulated cost must be 40000, got ${costStatusA1.accumulatedCost}`);
  assert(costStatusA1.breakdown.seedCost === 12000, 'Seed cost mismatch');
  assert(costStatusA1.breakdown.fertilizerCost === 8000, 'Fertilizer cost mismatch');
  assert(costStatusA1.breakdown.irrigationCost === 5000, 'Irrigation cost mismatch');
  assert(costStatusA1.breakdown.labourCost === 6000, 'Labour cost mismatch');
  assert(costStatusA1.breakdown.protectionCost === 3000, 'Protection cost mismatch');
  assert(costStatusA1.breakdown.machineryCost === 4000, 'Machinery cost mismatch');
  assert(costStatusA1.breakdown.otherCost === 2000, 'Other cost mismatch');
  assert(costStatusA1.isConsistent === true, 'Cycle A costs must be fully consistent with GL');

  // Verify Cycle B is still 0 (Absolute Isolation)
  const costStatusB_Initial = await getCropCycleAccumulatedCost(cycleBId);
  console.log(`Cycle B Accumulated Cost (before Cycle B operations): ৳${costStatusB_Initial.accumulatedCost}`);
  assert(costStatusB_Initial.accumulatedCost === 0, `Cycle B cost must remain 0 while recording Cycle A, got ${costStatusB_Initial.accumulatedCost}`);

  // 5. Record Legitimate Production Costs for Cycle B
  // Seed: 15,000, Fertilizer: 10,000, Irrigation: 6,000, Labour: 8,000, Protection: 4,000, Machinery: 5,000, Other: 3,000 -> Total = 51,000
  console.log('\n--- Recording Production Costs for Cycle B (Maize) ---');
  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'SEED',
    amount: 15000,
    paymentMethod: 'CASH',
    date: '2026-04-02',
    notes: 'Maize Foundation Seeds'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'FERTILIZER',
    amount: 10000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-04-15',
    notes: 'Potash and Zinc'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'IRRIGATION',
    amount: 6000,
    paymentMethod: 'CASH',
    date: '2026-04-25',
    notes: 'Canal Irrigation'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'LABOUR',
    amount: 8000,
    paymentMethod: 'CASH',
    date: '2026-05-05',
    notes: 'Maize sowing labour'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'PROTECTION',
    amount: 4000,
    paymentMethod: 'CASH',
    date: '2026-05-20',
    notes: 'Fungicide protection'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'MACHINERY',
    amount: 5000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-06-05',
    notes: 'Harvester advance'
  });

  await executeCropProductionCostTransaction({
    cycleId: cycleBId,
    costType: 'OTHER',
    amount: 3000,
    paymentMethod: 'CASH',
    date: '2026-06-15',
    notes: 'Field leveling fees'
  });

  const costStatusB1 = await getCropCycleAccumulatedCost(cycleBId);
  console.log(`Cycle B Accumulated Cost: ৳${costStatusB1.accumulatedCost}`);
  assert(costStatusB1.accumulatedCost === 51000, `Cycle B accumulated cost must be 51000, got ${costStatusB1.accumulatedCost}`);
  assert(costStatusB1.breakdown.seedCost === 15000, 'Seed cost mismatch B');
  assert(costStatusB1.breakdown.fertilizerCost === 10000, 'Fertilizer cost mismatch B');
  assert(costStatusB1.breakdown.irrigationCost === 6000, 'Irrigation cost mismatch B');
  assert(costStatusB1.breakdown.labourCost === 8000, 'Labour cost mismatch B');
  assert(costStatusB1.breakdown.protectionCost === 4000, 'Protection cost mismatch B');
  assert(costStatusB1.breakdown.machineryCost === 5000, 'Machinery cost mismatch B');
  assert(costStatusB1.breakdown.otherCost === 3000, 'Other cost mismatch B');

  // Verify Cycle A remains strictly 40,000 and did not absorb any of Cycle B's costs
  const costStatusA_Recheck = await getCropCycleAccumulatedCost(cycleAId);
  console.log(`Re-checking Cycle A Accumulated Cost: ৳${costStatusA_Recheck.accumulatedCost}`);
  assert(costStatusA_Recheck.accumulatedCost === 40000, `Cycle A must remain 40000, got ${costStatusA_Recheck.accumulatedCost}`);

  // 6. Test Shared WIP Account 1054 Independence
  // In the general ledger, WIP 1054 has 40,000 + 51,000 = 91,000.
  // Verify that neither cycle uses the global 91,000 balance!
  const allEntries = await db.journalEntries.toArray();
  let totalWipBalance = 0;
  for (const entry of allEntries) {
    for (const line of entry.lines || []) {
      if (line.accountCode === CANONICAL_ACCOUNTS.WIP) {
        totalWipBalance += (line.debit || 0) - (line.credit || 0);
      }
    }
  }
  console.log(`Total Shared WIP (1054) Balance in GL: ৳${totalWipBalance}`);
  assert(totalWipBalance === 91000, `Shared WIP balance must be 91000, got ${totalWipBalance}`);
  assert(costStatusA_Recheck.accumulatedCost !== totalWipBalance, 'Cycle A cost must NOT equal shared WIP balance');
  assert(costStatusB1.accumulatedCost !== totalWipBalance, 'Cycle B cost must NOT equal shared WIP balance');

  // Verify no line memo contamination
  for (const entry of allEntries) {
    if (entry.reference === cycleAId) {
      assert(
        !entry.narration?.includes(cycleBId),
        `Cycle A journal entry narration mentions Cycle B: ${entry.narration}`
      );
      for (const line of entry.lines || []) {
        assert(!line.memo?.includes(cycleBId), `Cycle A journal line memo mentions Cycle B: ${line.memo}`);
      }
    }
    if (entry.reference === cycleBId) {
      assert(
        !entry.narration?.includes(cycleAId),
        `Cycle B journal entry narration mentions Cycle A: ${entry.narration}`
      );
      for (const line of entry.lines || []) {
        assert(!line.memo?.includes(cycleAId), `Cycle B journal line memo mentions Cycle A: ${line.memo}`);
      }
    }
  }
  console.log('✅ Cycle Isolation Confirmed: Zero cross-contamination between Cycle A and Cycle B');

  // 7. Duplicate Prevention Test
  console.log('\n--- Testing Duplicate Cost Prevention ---');
  let duplicatePrevented = false;
  try {
    await executeCropProductionCostTransaction({
      cycleId: cycleAId,
      costType: 'SEED',
      amount: 12000,
      paymentMethod: 'CASH',
      date: '2026-03-02',
      notes: 'Paddy High Yield Seeds'
    });
  } catch (err: any) {
    duplicatePrevented = true;
    console.log(`Duplicate correctly rejected: ${err.message}`);
  }
  assert(duplicatePrevented, 'Identical duplicate production cost within window must be rejected');

  // 8. Reclassification Test: Reclassifying existing expense transaction to WIP (Dr WIP / Cr Expense, NEVER Cash)
  console.log('\n--- Testing Reclassification of Operating Expense to WIP ---');
  const cycleCId = 'crop_cycle_corn_east';
  const cycleC: CropCycle = {
    id: cycleCId,
    plotId: 'plot_east_03',
    plotName: 'East Plot',
    cropName: 'Hybrid Maize',
    cropCategory: 'GRAIN',
    areaDecimals: 150,
    plantingDate: '2026-05-01',
    expectedHarvestDate: '2026-09-01',
    status: 'GROWING',
    seedCost: 5000,
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 7000,
    protectionCost: 0,
    machineryCost: 0,
    otherCost: 0,
    totalCost: 12000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    synced: false
  };
  await db.cropCycles.add(cycleC);

  // Post expense transactions to 6020 (Farm Labour) and 6070 (Seed/Feed) tagged with cycleC
  const expenseEntry1: JournalEntry = {
    id: 'j_corn_exp_01',
    voucherNumber: 'PAY-EXP-01',
    voucherType: 'PAYMENT',
    date: '2026-05-02',
    narration: `Payment for maize seed: ${cycleCId}`,
    reference: cycleCId,
    totalDebit: 5000,
    totalCredit: 5000,
    createdBy: 'system-user',
    lines: [
      {
        accountId: CANONICAL_ACCOUNTS.FEED_EXPENSE,
        accountCode: CANONICAL_ACCOUNTS.FEED_EXPENSE,
        accountName: 'বীজ ও খাদ্য ব্যয়',
        debit: 5000,
        credit: 0,
        memo: `[${cycleCId}] Maize seed expense`
      },
      {
        accountId: CANONICAL_ACCOUNTS.CASH,
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'Main Cash',
        debit: 0,
        credit: 5000,
        memo: `[${cycleCId}] Cash paid for seed`
      }
    ],
    createdAt: new Date().toISOString()
  };
  await db.journalEntries.add(expenseEntry1);

  const expenseEntry2: JournalEntry = {
    id: 'j_corn_exp_02',
    voucherNumber: 'PAY-EXP-02',
    voucherType: 'PAYMENT',
    date: '2026-05-05',
    narration: `Payment for farm labour: ${cycleCId}`,
    reference: cycleCId,
    totalDebit: 7000,
    totalCredit: 7000,
    createdBy: 'system-user',
    lines: [
      {
        accountId: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
        accountCode: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
        accountName: 'শ্রমিক মজুরি',
        debit: 7000,
        credit: 0,
        memo: `[${cycleCId}] Maize labour wages`
      },
      {
        accountId: CANONICAL_ACCOUNTS.CASH,
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'Main Cash',
        debit: 0,
        credit: 7000,
        memo: `[${cycleCId}] Cash paid for labour`
      }
    ],
    createdAt: new Date().toISOString()
  };
  await db.journalEntries.add(expenseEntry2);

  // Reclassify existing expense to WIP
  const reclassRes = await reclassifyCropExpenseToWip(cycleCId);
  console.log(`Reclassified ৳${reclassRes.reclassifiedAmount} to WIP for Cycle C`);
  assert(reclassRes.reclassifiedAmount === 12000, `Reclassified amount should be 12000, got ${reclassRes.reclassifiedAmount}`);

  // Inspect the reclassification journal entry
  const reclassEntry = await db.journalEntries.get(reclassRes.journalEntryId!);
  assert(!!reclassEntry, 'Reclassification journal entry must exist');
  console.log('Reclassification entry lines:');
  for (const line of reclassEntry!.lines) {
    console.log(` - Account: ${line.accountCode} (${line.accountName}), Dr: ৳${line.debit}, Cr: ৳${line.credit}`);
    // Verify that NO line touches Cash or Bank!
    assert(line.accountCode !== CANONICAL_ACCOUNTS.CASH, 'Reclassification must NOT credit Cash');
    assert(line.accountCode !== CANONICAL_ACCOUNTS.BANK, 'Reclassification must NOT credit Bank');
  }

  // 9. Reject Unbacked Costs Test: Operational field contains a number with no source accounting transaction
  console.log('\n--- Testing Rejection of Unbacked Operational Cost ---');
  const cycleDId = 'crop_cycle_phantom';
  const cycleD: CropCycle = {
    id: cycleDId,
    plotId: 'plot_ghost_04',
    plotName: 'Ghost Field',
    cropName: 'Phantom Crop',
    cropCategory: 'OTHER',
    areaDecimals: 100,
    plantingDate: '2026-06-01',
    expectedHarvestDate: '2026-09-01',
    status: 'GROWING',
    seedCost: 25000, // Operational number without any GL transaction
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 0,
    protectionCost: 0,
    machineryCost: 0,
    otherCost: 0,
    totalCost: 25000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    synced: false
  };
  await db.cropCycles.add(cycleD);

  let unbackedRejected = false;
  try {
    await integrateCropProductionCostAccounting(cycleDId);
  } catch (err: any) {
    unbackedRejected = true;
    console.log(`Unbacked operational cost correctly rejected: ${err.message}`);
  }
  assert(unbackedRejected, 'Integrating unbacked operational cost must throw an error, never invent credits');

  let harvestUnbackedRejected = false;
  try {
    await executeCropHarvestAndSaleTransaction({
      cycleId: cycleDId,
      harvestYieldKg: 500,
      salePrice: 40000,
      paymentMethod: 'CASH',
      date: '2026-09-01'
    });
  } catch (err: any) {
    harvestUnbackedRejected = true;
    console.log(`Harvest with unbacked cost correctly rejected: ${err.message}`);
  }
  assert(harvestUnbackedRejected, 'Harvesting cycle with unbacked cost must throw an error, never invent credits');

  // 10. Harvest Cycle A and Verify Transfer to Crop COGS (5030)
  console.log('\n--- Harvesting Cycle A and Verifying COGS Transfer ---');
  const harvestResA = await executeCropHarvestAndSaleTransaction({
    cycleId: cycleAId,
    harvestYieldKg: 2000,
    salePrice: 75000,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    date: '2026-06-20'
  });

  console.log(`Cycle A Harvest executed. COGS Voucher: ${harvestResA.cogsVoucherNumber}`);
  assert(harvestResA.costTransferred === 40000, `COGS transferred must be 40000, got ${harvestResA.costTransferred}`);

  // Re-verify Cycle A and Cycle B statuses after harvest of Cycle A
  const costStatusA_PostHarvest = await getCropCycleAccumulatedCost(cycleAId);
  const costStatusB_PostHarvest = await getCropCycleAccumulatedCost(cycleBId);

  console.log(`Post-harvest Cycle A net remaining WIP: ৳${costStatusA_PostHarvest.netRemainingCost}, COGS transferred: ৳${costStatusA_PostHarvest.cogsTransferred}`);
  assert(costStatusA_PostHarvest.netRemainingCost === 0, 'Cycle A net remaining WIP should be 0 after full harvest');
  assert(costStatusA_PostHarvest.cogsTransferred === 40000, 'Cycle A COGS transferred should be 40000');

  console.log(`Post-harvest Cycle B accumulated cost: ৳${costStatusB_PostHarvest.accumulatedCost}, net remaining WIP: ৳${costStatusB_PostHarvest.netRemainingCost}`);
  assert(costStatusB_PostHarvest.accumulatedCost === 51000, `Cycle B accumulated cost must remain 51000, got ${costStatusB_PostHarvest.accumulatedCost}`);
  assert(costStatusB_PostHarvest.netRemainingCost === 51000, `Cycle B net remaining WIP must remain 51000, got ${costStatusB_PostHarvest.netRemainingCost}`);
  assert(costStatusB_PostHarvest.cogsTransferred === 0, 'Cycle B should have 0 COGS transferred');

  console.log('\n========================================================');
  console.log('ALL CROP PRODUCTION COST ISOLATION & ACCOUNTING TESTS PASSED!');
  console.log('========================================================\n');
}

runCropCycleCostIsolationTest().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
