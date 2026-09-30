import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  recordPhysicalInventoryAdjustment,
  detectSilentInventoryOverwrite,
  assertNoSilentInventoryOverwrite,
  getPhysicalInventoryRecords,
  getPhysicalInventoryRecordById,
  clearPhysicalInventoryRecordsForTest
} from '../accounting/physicalInventoryService';
import {
  reconcileInventorySubledger,
  runValuationReconciliationGate
} from '../accounting/reconciliationService';
import {
  createValuationEvent,
  finalizeValuation,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { InventoryItem, StockMovement, JournalEntry } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 08 — Physical Inventory Adjustment
 *
 * Inspect inventory reconciliation used for valuation.
 *
 * A physical count must never silently overwrite the accounting quantity.
 *
 * When:
 *   Book quantity = 50
 *   Physical quantity = 40
 *
 * The system must record:
 *   - book quantity;
 *   - physical quantity;
 *   - variance;
 *   - value impact;
 *   - reason/narration;
 *   - user;
 *   - timestamp.
 *
 * Use the existing inventory/accounting engine for the resulting adjustment.
 *
 * Do not directly mutate historical records.
 *
 * Test the 50 versus 40 case.
 *
 * Return PASS.
 */
export async function runPhysicalInventoryAdjustmentTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, message: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`  ✅ [PASS] ${message}`);
    } else {
      result.failed++;
      result.failures.push(message);
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  console.log('\n================================================================');
  console.log('STARTING PROMPT 08: PHYSICAL INVENTORY ADJUSTMENT AUDIT');
  console.log('Testing: Physical count vs accounting quantity, 50 vs 40 case');
  console.log('================================================================\n');

  clearPhysicalInventoryRecordsForTest();
  clearValuationEventsForTest();

  const testUser = 'auditor_lead_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setup Clean Baseline with Book Quantity = 50
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establishing Accounting Baseline with Book Quantity = 50 ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Balanced Cash & Bank for valuation gate
  await mDb.cashBankAccounts.put({
    id: 'cb_main_p8',
    name: 'Main Bank Account',
    accountType: 'BANK',
    currentBalance: 50000,
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p8_capital',
      voucherNumber: 'V-P8-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 50000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 50000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Setup Inventory Item: Feed, 50 bags @ ৳200/bag = ৳10,000 total book value
  const feedItemId = 'item_feed_p8';
  const unitCostPrice = 200;
  const initialBookQty = 50;
  const initialBookValue = initialBookQty * unitCostPrice; // ৳10,000

  const initialFeedItem: InventoryItem = {
    id: feedItemId,
    code: 'FEED-CATTLE-01',
    nameBn: 'উন্নত ডেইরি ক্যাটল ফিড',
    nameEn: 'Premium Dairy Cattle Feed',
    category: 'FEED',
    currentStock: initialBookQty,
    unit: 'BAG',
    avgCostPrice: unitCostPrice,
    costPrice: unitCostPrice,
    sellingPrice: 250,
    synced: false
  };
  await mDb.inventoryItems.put(initialFeedItem);

  // Initial historical stock movement: Opening purchase of 50 bags @ ৳200
  const initialMovementId = 'sm_feed_p8_opening';
  const initialMovement: StockMovement = {
    id: initialMovementId,
    date: '2026-01-10',
    itemId: feedItemId,
    movementType: 'PURCHASE',
    quantity: initialBookQty,
    unitCost: unitCostPrice,
    totalValue: initialBookValue,
    referenceId: 'PURCH-P8-001',
    notes: 'প্রারম্ভিক ক্যাটল ফিড ক্রয় (৫০ ব্যাগ @ ৳২০০)',
    direction: 'IN',
    adjustmentType: 'INCREASE',
    status: 'POSTED',
    synced: false
  };
  await mDb.stockMovements.put(initialMovement);

  // Initial historical journal entry: Dr 1051 (Feed Inventory) ৳10,000 | Cr 1030 (Bank) ৳10,000
  const initialJournalEntryId = 'j_p8_inv_open';
  await postJournalEntry(
    {
      id: initialJournalEntryId,
      voucherNumber: 'V-P8-02',
      voucherType: 'PURCHASE',
      date: '2026-01-10',
      narration: 'ফিড ক্রয় জাবেদা দাখিলা (৫০ ব্যাগ @ ৳২০০)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: initialBookValue, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: initialBookValue }
      ],
      createdBy: testUser,
      createdAt: '2026-01-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  await mDb.cashBankAccounts.update('cb_main_p8', { currentBalance: 40000 });

  // Verify baseline reconciliation
  const initialInvReconciliation = await reconcileInventorySubledger(mDb, undefined, valDate);
  assert(initialInvReconciliation.isMatched === true, 'Initial inventory subledger is 100% reconciled on baseline (50 bags @ ৳200 = ৳10,000)');
  assert(initialInvReconciliation.operationalAmount === 10000, 'Baseline operational inventory valuation is exactly ৳10,000');
  assert(initialInvReconciliation.glAmount === 10000, 'Baseline GL Account 1051 balance is exactly ৳10,000');
  assert(initialInvReconciliation.difference === 0, 'Baseline inventory difference is 0');

  const baselineGate = await runValuationReconciliationGate(mDb, valDate);
  assert(baselineGate.status === 'PASS', 'Valuation reconciliation gate passes on baseline before physical count');

  // ---------------------------------------------------------------------------
  // STEP 2: Verify That a Silent Overwrite Is Detected, Forbidden & Blocks Valuation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Testing Detection and Rejection of Silent Overwrite ---');
  // Simulate an unauthorized, direct silent mutation: item.currentStock = 40 without StockMovement or JournalEntry
  await mDb.inventoryItems.update(feedItemId, { currentStock: 40 });
  const corruptedItem = (await mDb.inventoryItems.get(feedItemId))!;
  const allMovementsBefore = await mDb.stockMovements.toArray();

  const overwriteDetection = detectSilentInventoryOverwrite(corruptedItem, allMovementsBefore);
  assert(overwriteDetection.isSilentOverwrite === true, 'detectSilentInventoryOverwrite catches silent quantity overwrite without movement');
  assert(overwriteDetection.expectedBookQuantity === 50, 'Expected book quantity according to movements is 50');
  assert(overwriteDetection.recordedCurrentStock === 40, 'Corrupted recorded currentStock is 40');
  assert(overwriteDetection.discrepancy === -10, 'Discrepancy is detected as -10 bags');

  let silentOverwriteErrorCaught = false;
  try {
    assertNoSilentInventoryOverwrite(corruptedItem, allMovementsBefore);
  } catch (err: any) {
    silentOverwriteErrorCaught = true;
    assert(err.message.includes('Silent overwrite') || err.message.includes('নীরব পরিবর্তন'), 'assertNoSilentInventoryOverwrite throws descriptive safety violation');
  }
  assert(silentOverwriteErrorCaught === true, 'Silent overwrite strictly throws error when validated');

  // Verify that inventory reconciliation used for valuation fails when silently overwritten
  const corruptedInvReconciliation = await reconcileInventorySubledger(mDb, undefined, valDate);
  assert(corruptedInvReconciliation.isMatched === false, 'Inventory reconciliation FAILS when physical count silently overwrote record quantity');

  const blockedGate = await runValuationReconciliationGate(mDb, valDate);
  assert(blockedGate.status === 'UNRESOLVED', 'Valuation reconciliation gate strictly returns UNRESOLVED on silent overwrite');
  assert(blockedGate.unresolvedDiscrepancies.some((d) => d.item === 'inventory'), 'Inventory is explicitly listed among unresolved discrepancies');

  // Verify valuation finalization is blocked
  let valuationBlockedOnSilentOverwrite = false;
  try {
    await createValuationEvent(
      {
        valuationDate: valDate,
        responsibleUser: testUser,
        finalize: true
      },
      mDb
    );
  } catch (err: any) {
    valuationBlockedOnSilentOverwrite = true;
    assert(err.message.includes('Valuation finalization blocked') || err.message.includes('চূড়ান্তকরণ স্থগিত'), 'Valuation finalization is strictly blocked by silent overwrite discrepancy');
  }
  assert(valuationBlockedOnSilentOverwrite === true, 'Valuation finalization was strictly BLOCKED on silent overwrite');

  // Revert the silent corruption back to 50 so we can perform the legitimate adjustment
  await mDb.inventoryItems.update(feedItemId, { currentStock: 50 });

  // ---------------------------------------------------------------------------
  // STEP 3: Execute Formal Physical Inventory Adjustment (Book = 50, Physical = 40)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Executing Formal Physical Inventory Adjustment (Book 50 vs Physical 40) ---');
  const countReason = 'বার্ষিক ফিজিক্যাল অডিট গণনা: ১০ ব্যাগ ইঁদুরে নষ্ট ও আর্দ্রতাজনিত ক্ষতি (Annual audit physical count shrinkage/spoilage)';
  const adjustmentDate = '2026-06-15';

  const adjustmentResult = await recordPhysicalInventoryAdjustment(
    {
      itemId: feedItemId,
      physicalQuantity: 40,
      reason: countReason,
      user: testUser,
      date: adjustmentDate
    },
    mDb
  );

  const adjRecord = adjustmentResult.adjustmentRecord;

  // Verify all required recorded fields:
  // - book quantity;
  // - physical quantity;
  // - variance;
  // - value impact;
  // - reason/narration;
  // - user;
  // - timestamp.
  assert(adjRecord.bookQuantity === 50, 'Recorded book quantity is strictly 50');
  assert(adjRecord.physicalQuantity === 40, 'Recorded physical quantity is strictly 40');
  assert(adjRecord.variance === -10, 'Recorded variance is strictly -10 (40 - 50 = -10)');
  assert(adjRecord.unitCost === 200, 'Recorded unit cost is ৳200');
  assert(adjRecord.valueImpact === -2000, 'Recorded value impact is strictly -৳2,000 (-10 * ৳200)');
  assert(adjRecord.reason === countReason, 'Recorded reason matches audit narration');
  assert(adjRecord.narration.includes('৫০') && adjRecord.narration.includes('৪০'), 'Descriptive narration includes book quantity 50 and physical quantity 40');
  assert(adjRecord.user === testUser, 'Recorded user is strictly lead audit officer');
  assert(typeof adjRecord.timestamp === 'string' && !isNaN(Date.parse(adjRecord.timestamp)), 'Recorded timestamp is a valid ISO 8601 string');
  assert(adjRecord.status === 'POSTED', 'Adjustment record status is POSTED');
  assert(Boolean(adjRecord.stockMovementId), 'Adjustment references generated StockMovement ID');
  assert(Boolean(adjRecord.journalEntryId), 'Adjustment references generated JournalEntry ID');
  assert(Boolean(adjRecord.voucherNumber), 'Adjustment references generated Journal voucher number');

  // Verify lookup via service
  const fetchedRecord = getPhysicalInventoryRecordById(adjRecord.id);
  assert(fetchedRecord !== undefined, 'Physical inventory adjustment record is retrievable by ID');
  assert(getPhysicalInventoryRecords().length >= 1, 'Physical inventory records list contains the new adjustment record');

  // ---------------------------------------------------------------------------
  // STEP 4: Inspect Existing Inventory & Accounting Engine Integration
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Existing Inventory and Accounting Engine Outputs ---');
  // 4a. Verify StockMovement
  assert(adjustmentResult.stockMovement !== undefined, 'Result includes created StockMovement');
  const movement = adjustmentResult.stockMovement!;
  assert(movement.movementType === 'ADJUSTMENT', 'Stock movementType is strictly ADJUSTMENT');
  assert(movement.quantity === 10, 'Stock movement quantity is strictly 10 (magnitude of variance)');
  assert(movement.unitCost === 200, 'Stock movement unit cost is ৳200');
  assert(movement.totalValue === 2000, 'Stock movement total value is ৳2,000');
  assert(movement.direction === 'OUT', 'Stock movement direction is OUT (decrease)');
  assert(movement.adjustmentType === 'DECREASE', 'Stock movement adjustmentType is DECREASE');
  assert(movement.referenceId === adjRecord.id, 'Stock movement referenceId links to PhysicalInventoryCountRecord');

  const movementInDb = await mDb.stockMovements.get(movement.id);
  assert(movementInDb !== undefined, 'StockMovement was persisted into the stockMovements table');

  // 4b. Verify Journal Entry posted through Accounting Engine
  assert(adjustmentResult.journalEntry !== undefined, 'Result includes created JournalEntry');
  const journalEntry = adjustmentResult.journalEntry!;
  assert(journalEntry.voucherType === 'JOURNAL', 'Journal voucherType is JOURNAL');
  assert(journalEntry.date === adjustmentDate, 'Journal date matches adjustment date');
  assert(journalEntry.totalDebit === 2000, 'Journal totalDebit is exactly ৳2,000');
  assert(journalEntry.totalCredit === 2000, 'Journal totalCredit is exactly ৳2,000');

  // Verify balanced debit & credit lines:
  // Debit: 5090 (OTHER_COGS / Inventory adjustment loss) ৳2,000
  // Credit: 1051 (FEED_INVENTORY) ৳2,000
  const debitLine = journalEntry.lines.find((l) => l.debit > 0);
  const creditLine = journalEntry.lines.find((l) => l.credit > 0);
  assert(debitLine !== undefined && debitLine.accountCode === CANONICAL_ACCOUNTS.OTHER_COGS, 'Debit line posts to 5090 (OTHER_COGS / Inventory Shrinkage Expense)');
  assert(debitLine?.debit === 2000, 'Debit line amount is ৳2,000');
  assert(creditLine !== undefined && creditLine.accountCode === CANONICAL_ACCOUNTS.FEED_INVENTORY, 'Credit line posts to 1051 (Feed Inventory Asset Account)');
  assert(creditLine?.credit === 2000, 'Credit line amount is ৳2,000');

  const entryInDb = await mDb.journalEntries.get(journalEntry.id);
  assert(entryInDb !== undefined, 'Journal entry was persisted into the journalEntries table');

  // 4c. Verify Inventory Item updated via adjustment
  const updatedItem = (await mDb.inventoryItems.get(feedItemId))!;
  assert(updatedItem.currentStock === 40, 'Inventory item currentStock is updated to verified physical quantity of 40');

  // 4d. Verify Audit Log entry was recorded
  const auditLogs = await mDb.auditLogs.toArray();
  const adjustmentAudit = auditLogs.find((a) => a.recordId === adjRecord.id);
  assert(adjustmentAudit !== undefined, 'Audit log entry was recorded for PHYSICAL_INVENTORY_ADJUSTMENT');
  assert(adjustmentAudit?.userId === testUser, 'Audit log records responsible user');
  assert(adjustmentAudit?.details.includes('৫০') && adjustmentAudit?.details.includes('৪০'), 'Audit log details include 50 -> 40 transition');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify That Historical Records Were NOT Mutated
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying Historical Records Are Completely Immutable ---');
  const openingMovementCheck = (await mDb.stockMovements.get(initialMovementId))!;
  assert(openingMovementCheck.quantity === 50, 'Original purchase/opening movement quantity is UNMUTATED (still 50)');
  assert(openingMovementCheck.totalValue === 10000, 'Original movement totalValue is UNMUTATED (still ৳10,000)');
  assert(openingMovementCheck.date === '2026-01-10', 'Original movement date is UNMUTATED (still 2026-01-10)');

  const openingJournalCheck = (await mDb.journalEntries.get(initialJournalEntryId))!;
  assert(openingJournalCheck.lines.length === 2, 'Original purchase journal entry lines are UNMUTATED');
  assert(openingJournalCheck.lines[0].debit === 10000, 'Original debit line is UNMUTATED (still ৳10,000)');
  assert(openingJournalCheck.lines[1].credit === 10000, 'Original credit line is UNMUTATED (still ৳10,000)');

  // Verify that the movements array now contains exactly 2 distinct historical events
  const itemMovements = (await mDb.stockMovements.toArray()).filter((m) => m.itemId === feedItemId);
  assert(itemMovements.length === 2, 'Item has exactly 2 immutable chronological movements (Opening: +50, Adjustment: -10)');

  // Verify that no silent overwrite is flagged after the formal adjustment
  const allMovementsAfter = await mDb.stockMovements.toArray();
  const postAdjDetection = detectSilentInventoryOverwrite(updatedItem, allMovementsAfter);
  assert(postAdjDetection.isSilentOverwrite === false, 'After formal adjustment, detectSilentInventoryOverwrite confirms 100% integrity');
  assert(postAdjDetection.expectedBookQuantity === 40, 'Expected book quantity from movements is now exactly 40');
  assert(postAdjDetection.recordedCurrentStock === 40, 'Recorded currentStock matches expected 40');

  // ---------------------------------------------------------------------------
  // STEP 6: Verify Inventory Reconciliation Used for Valuation Passes
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying Inventory Reconciliation & Valuation Gate ---');
  const postAdjInvReconciliation = await reconcileInventorySubledger(mDb, undefined, valDate);
  assert(postAdjInvReconciliation.isMatched === true, 'Inventory subledger is 100% RECONCILED after adjustment');
  assert(postAdjInvReconciliation.difference === 0, 'Reconciled inventory difference is 0');
  assert(postAdjInvReconciliation.operationalAmount === 8000, 'Reconciled operational inventory valuation is ৳8,000 (40 bags @ ৳200)');
  assert(postAdjInvReconciliation.glAmount === 8000, 'Reconciled GL Account 1051 balance is ৳8,000 (৳10,000 - ৳2,000)');

  // Verify Valuation Reconciliation Gate now returns PASS
  const finalGate = await runValuationReconciliationGate(mDb, valDate);
  assert(finalGate.status === 'PASS', 'Valuation reconciliation gate returns strictly PASS after proper inventory adjustment');
  assert(finalGate.unresolvedCount === 0, 'Zero unresolved discrepancies in valuation reconciliation gate');

  // Verify valuation finalization succeeds and records passing reconciliation gate
  const finalizedValuation = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: true
    },
    mDb
  );
  assert(finalizedValuation.status === 'FINALIZED', 'Valuation event successfully FINALIZED with passing inventory reconciliation gate');
  assert(finalizedValuation.reconciliationGate?.status === 'PASS', 'Finalized valuation includes confirmed PASS reconciliation gate');

  // ---------------------------------------------------------------------------
  // STEP 7: Test Physical Inventory Surplus (Book 40 vs Physical 45)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Testing Inventory Surplus Case (Book 40 vs Physical 45) ---');
  const surplusResult = await recordPhysicalInventoryAdjustment(
    {
      itemId: feedItemId,
      physicalQuantity: 45,
      reason: 'অতিরিক্ত ৫ ব্যাগ ফিজিক্যাল মজুদে উদ্বৃত্ত পাওয়া গিয়েছে (5 surplus bags found during recount)',
      user: testUser,
      date: '2026-06-20'
    },
    mDb
  );

  const surplusRecord = surplusResult.adjustmentRecord;
  assert(surplusRecord.bookQuantity === 40, 'Surplus check: Book quantity was 40');
  assert(surplusRecord.physicalQuantity === 45, 'Surplus check: Physical quantity is 45');
  assert(surplusRecord.variance === 5, 'Surplus check: Variance is strictly +5');
  assert(surplusRecord.valueImpact === 1000, 'Surplus check: Value impact is +৳1,000 (5 * ৳200)');
  assert(surplusResult.stockMovement?.direction === 'IN', 'Surplus movement direction is IN');
  assert(surplusResult.stockMovement?.adjustmentType === 'INCREASE', 'Surplus movement adjustmentType is INCREASE');

  const surplusJournal = surplusResult.journalEntry!;
  const surplusDebit = surplusJournal.lines.find((l) => l.debit > 0);
  const surplusCredit = surplusJournal.lines.find((l) => l.credit > 0);
  assert(surplusDebit?.accountCode === CANONICAL_ACCOUNTS.FEED_INVENTORY, 'Surplus debits 1051 (Feed Inventory) for ৳1,000');
  assert(surplusCredit?.accountCode === CANONICAL_ACCOUNTS.OTHER_INCOME, 'Surplus credits 4090 (Other Income) for ৳1,000');

  const itemAfterSurplus = (await mDb.inventoryItems.get(feedItemId))!;
  assert(itemAfterSurplus.currentStock === 45, 'Item currentStock is updated to 45');

  const surplusInvReconciliation = await reconcileInventorySubledger(mDb, undefined, valDate);
  assert(surplusInvReconciliation.isMatched === true, 'Inventory subledger remains 100% reconciled after surplus adjustment (45 bags @ ৳200 = ৳9,000)');
  assert(surplusInvReconciliation.operationalAmount === 9000, 'Operational amount is ৳9,000');
  assert(surplusInvReconciliation.glAmount === 9000, 'GL amount is ৳9,000');

  console.log('\n================================================================');
  console.log(`PROMPT 08 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 08 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 08 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testPhysicalInventoryAdjustment')) {
  runPhysicalInventoryAdjustmentTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 08 tests:', err);
      process.exit(1);
    });
}
