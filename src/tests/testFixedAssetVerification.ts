import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  getFixedAssetVerificationBreakdown,
  recordFixedAssetVerificationAdjustment,
  getFixedAssetRevaluationEvents,
  getFixedAssetRevaluationEventById,
  clearFixedAssetRevaluationEventsForTest
} from '../accounting/fixedAssetVerificationService';
import {
  reconcileFixedAssetRegister,
  reconcileAccumulatedDepreciation,
  runValuationReconciliationGate
} from '../accounting/reconciliationService';
import {
  createValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry, generateProfitLoss } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { FixedAsset, JournalEntry } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 09 — Fixed Asset Verification
 *
 * Inspect fixed-asset valuation handling.
 *
 * Show separately:
 * - original cost;
 * - accumulated depreciation;
 * - carrying amount;
 * - verified/approved value;
 * - adjustment;
 * - reason.
 *
 * A user correction must become an auditable adjustment/revaluation event.
 *
 * Do not silently overwrite historical depreciation.
 *
 * Do not automatically classify every valuation adjustment as operating profit.
 *
 * Test:
 * Cost = 1000
 * Accumulated depreciation = 300
 * Carrying amount = 700
 * Approved value = 600
 *
 * Verify the 100 difference is traceable.
 *
 * Return PASS.
 */
export async function runFixedAssetVerificationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 09: FIXED ASSET VERIFICATION AUDIT');
  console.log('Testing: Cost=1000, AccDep=300, Carrying=700, Approved=600');
  console.log('================================================================\n');

  clearFixedAssetRevaluationEventsForTest();
  clearValuationEventsForTest();

  const testUser = 'valuation_auditor_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setting up Fixed Asset Baseline (Cost = 1000, AccDep = 300, Carrying = 700)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting up Accounting Baseline ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Balanced Bank & Capital
  await mDb.cashBankAccounts.put({
    id: 'cb_main_p9',
    name: 'Main Business Bank Account',
    accountType: 'BANK',
    currentBalance: 50000,
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p9_capital',
      voucherNumber: 'V-P9-CAP',
      voucherType: 'RECEIPT',
      date: '2025-01-01',
      narration: 'প্রতিষ্ঠাতার প্রারম্ভিক মূলধন',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 50000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 50000 }
      ],
      createdBy: testUser,
      createdAt: '2025-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Asset acquisition: Cost = 1000 (Machinery GL 1550)
  const assetId = 'asset_water_pump_p9';
  const initialCost = 1000;
  const initialAccDep = 300;
  const initialCarryingAmount = initialCost - initialAccDep; // 700

  const pumpAsset: FixedAsset = {
    id: assetId,
    name: 'কৃষি সেচ পানির পাম্প ও মোটর',
    category: 'MACHINERY',
    purchaseDate: '2025-01-05',
    originalCost: initialCost,
    usefulLifeYears: 5,
    salvageValue: 100,
    accumulatedDepreciation: initialAccDep,
    currentBookValue: initialCarryingAmount,
    status: 'ACTIVE',
    synced: false
  };
  await mDb.fixedAssets.put(pumpAsset);

  // Post Acquisition Journal: Dr 1550 (Machinery) ৳1,000 | Cr 1030 (Bank) ৳1,000
  await postJournalEntry(
    {
      id: 'j_p9_fa_purchase',
      voucherNumber: 'V-P9-ACQ',
      voucherType: 'PAYMENT',
      date: '2025-01-05',
      narration: 'সেচ পাম্প স্থায়ী সম্পদ ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি', debit: initialCost, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: initialCost }
      ],
      createdBy: testUser,
      createdAt: '2025-01-05T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  await mDb.cashBankAccounts.update('cb_main_p9', { currentBalance: 49000 });

  // Post Historical Depreciation Journal Entries: Totaling ৳300
  // Dr 6140 (Depreciation Expense) ৳300 | Cr 1590 (Accumulated Depreciation) ৳300
  const historicalDepJournalId = 'j_p9_fa_dep';
  await postJournalEntry(
    {
      id: historicalDepJournalId,
      voucherNumber: 'V-P9-DEP-01',
      voucherType: 'JOURNAL',
      date: '2025-12-31',
      reference: assetId,
      narration: 'সেচ পাম্পের বার্ষিক অবচয় সঞ্চিতি',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.DEPRECIATION_EXPENSE, accountName: 'অবচয় খরচ', debit: initialAccDep, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: initialAccDep }
      ],
      createdBy: testUser,
      createdAt: '2025-12-31T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Verify baseline reconciliations
  const costRec = await reconcileFixedAssetRegister(mDb, undefined, valDate);
  assert(costRec.isMatched === true, 'Baseline fixed asset cost is 100% reconciled (GL ৳1,000 = Register ৳1,000)');
  assert(costRec.operationalAmount === 1000, 'Baseline operational asset cost is exactly ৳1,000');
  assert(costRec.glAmount === 1000, 'Baseline GL 1550 balance is exactly ৳1,000');

  const depRec = await reconcileAccumulatedDepreciation(mDb, undefined, valDate);
  assert(depRec.isMatched === true, 'Baseline accumulated depreciation is 100% reconciled (GL ৳300 = Register ৳300)');
  assert(depRec.operationalAmount === 300, 'Baseline operational accumulated depreciation is exactly ৳300');
  assert(depRec.glAmount === 300, 'Baseline GL 1590 balance is exactly ৳300');

  const baselineGate = await runValuationReconciliationGate(mDb, valDate);
  assert(baselineGate.status === 'PASS', 'Baseline valuation reconciliation gate PASSES before revaluation');

  // ---------------------------------------------------------------------------
  // STEP 2: Inspect Breakdown — Show All 6 Required Fields Separately
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Testing Fixed Asset Verification Breakdown ---');
  const auditReason = 'কারিগরি পরিদর্শন ও বাজারদর যাচাই: পাম্প মোটরে অতিরিক্ত ক্ষয়ক্ষতি ও অবমূল্যায়ন শনাক্ত (Technical inspection wear & impairment)';
  const approvedValue = 600;

  const breakdown = getFixedAssetVerificationBreakdown(pumpAsset, approvedValue, auditReason);

  // Verify all 6 required fields are shown separately:
  // - original cost;
  // - accumulated depreciation;
  // - carrying amount;
  // - verified/approved value;
  // - adjustment;
  // - reason.
  assert(breakdown.originalCost === 1000, '1. Original cost is shown separately and equals strictly 1000');
  assert(breakdown.accumulatedDepreciation === 300, '2. Accumulated depreciation is shown separately and equals strictly 300');
  assert(breakdown.carryingAmount === 700, '3. Carrying amount is shown separately and equals strictly 700 (1000 - 300)');
  assert(breakdown.verifiedApprovedValue === 600, '4. Verified/approved value is shown separately and equals strictly 600');
  assert(breakdown.adjustment === -100, '5. Adjustment is shown separately and equals strictly -100 (600 - 700)');
  assert(breakdown.reason === auditReason, '6. Reason is shown separately and matches audit narration');
  assert(breakdown.adjustmentType === 'IMPAIRMENT_DECREASE', 'Adjustment type is correctly identified as IMPAIRMENT_DECREASE');

  // ---------------------------------------------------------------------------
  // STEP 3: Execute Auditable Adjustment / Revaluation Event
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Executing Auditable Revaluation Event ---');
  const revalResult = await recordFixedAssetVerificationAdjustment(
    {
      assetId,
      approvedValue: 600,
      reason: auditReason,
      user: testUser,
      valuationDate: '2026-06-15'
    },
    mDb
  );

  const event = revalResult.revaluationEvent;
  assert(event !== undefined, 'Auditable revaluation event was created');
  assert(event!.assetId === assetId, 'Event references correct asset ID');
  assert(event!.originalCost === 1000, 'Event records original cost 1000');
  assert(event!.accumulatedDepreciation === 300, 'Event records accumulated depreciation 300');
  assert(event!.carryingAmount === 700, 'Event records carrying amount 700');
  assert(event!.verifiedApprovedValue === 600, 'Event records approved value 600');
  assert(event!.adjustment === -100, 'Event records adjustment -100');
  assert(event!.reason === auditReason, 'Event records user reason');
  assert(event!.user === testUser, 'Event records responsible user');
  assert(typeof event!.timestamp === 'string' && !isNaN(Date.parse(event!.timestamp)), 'Event timestamp is a valid ISO 8601 string');
  assert(Boolean(event!.voucherNumber), 'Event references generated Journal Voucher number');
  assert(Boolean(event!.journalEntryId), 'Event references generated Journal Entry ID');

  // Verify lookup via service
  const fetchedEvent = getFixedAssetRevaluationEventById(event!.id);
  assert(fetchedEvent !== undefined, 'Revaluation event is retrievable by ID from revaluation service');
  assert(getFixedAssetRevaluationEvents().length >= 1, 'Revaluation events list contains the new event');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Historical Depreciation Was NOT Silently Overwritten
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Historical Depreciation Is UNMUTATED ---');
  const updatedAssetInDb = (await mDb.fixedAssets.get(assetId))!;

  // CRITICAL: Historical depreciation must NOT be silently overwritten to 400 or wiped!
  assert(updatedAssetInDb.accumulatedDepreciation === 300, 'CRITICAL: Historical accumulated depreciation is strictly 300 (NOT silently overwritten)');
  assert(updatedAssetInDb.originalCost === 1000, 'Historical original cost remains 1000');
  assert(updatedAssetInDb.currentBookValue === 600, 'Asset currentBookValue reflects verified approved value 600');
  assert(updatedAssetInDb.verifiedApprovedValue === 600, 'Asset verifiedApprovedValue is 600');
  assert(updatedAssetInDb.revaluationAdjustment === -100, 'Asset revaluationAdjustment is -100');

  // Verify historical depreciation journal entry is completely intact and untouched
  const histDepEntry = (await mDb.journalEntries.get(historicalDepJournalId))!;
  assert(histDepEntry !== undefined, 'Historical depreciation journal entry exists in database');
  const histCreditLine = histDepEntry.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION);
  assert(histCreditLine?.credit === 300, 'Historical depreciation credit line is strictly UNMUTATED (still ৳300)');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify Valuation Adjustment Is NOT Classified as Operating Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying Valuation Adjustment Is NOT Operating Profit ---');
  assert(event!.isOperatingProfit === false, 'CRITICAL: Revaluation event isOperatingProfit is strictly FALSE');

  const revalJournal = revalResult.journalEntry!;
  assert(revalJournal !== undefined, 'Result contains posted adjusting JournalEntry');
  assert(revalJournal.voucherType === 'JOURNAL', 'Voucher type is JOURNAL');
  assert(revalJournal.totalDebit === 100, 'Journal totalDebit is 100');
  assert(revalJournal.totalCredit === 100, 'Journal totalCredit is 100');

  // Check debit line account
  const debitLine = revalJournal.lines.find((l) => l.debit > 0);
  const creditLine = revalJournal.lines.find((l) => l.credit > 0);

  // The debit MUST be classified as non-operating impairment / other expense (8020 / 7020)
  // NEVER an operating sales/revenue reduction (4010, 4020, etc.)
  assert(debitLine !== undefined, 'Debit line exists for 100');
  assert(debitLine?.accountCode === '8020' || debitLine?.accountCode === '7020' || debitLine?.accountCode === '6150', 'Debit line posts to non-operating expense/loss account (8020/7020/6150)');
  assert(debitLine?.debit === 100, 'Debit amount is exactly ৳100');

  // The credit line reduces fixed asset cost account (1550)
  assert(creditLine !== undefined && creditLine.accountCode === CANONICAL_ACCOUNTS.MACHINERY, 'Credit line posts to 1550 (Machinery Cost Account)');
  assert(creditLine?.credit === 100, 'Credit amount is exactly ৳100');

  // Generate Profit and Loss report to verify operating profit is unaffected by valuation adjustment
  const pl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-06-30' }, undefined, mDb);
  assert(pl.totalRevenue === 0, 'Operating revenue is 0 (valuation adjustment did not falsely inflate or alter sales)');
  assert(pl.grossProfit === 0, 'Gross profit is 0 (valuation adjustment did not distort gross margin)');
  assert(pl.otherExpenses.some((oe) => oe.code === debitLine?.accountCode && oe.amount === 100), '100 impairment is classified under otherExpenses (non-operating), NOT operating revenue');

  // ---------------------------------------------------------------------------
  // STEP 6: Verify the 100 Difference is Completely Traceable
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying the 100 Difference is Traceable Across All Layers ---');
  // 6a. Traceable in verification breakdown and revaluation event:
  assert(breakdown.originalCost === 1000, 'Traceable: Breakdown originalCost = 1000');
  assert(breakdown.accumulatedDepreciation === 300, 'Traceable: Breakdown accumulatedDepreciation = 300');
  assert(breakdown.carryingAmount === 700, 'Traceable: Breakdown initial carryingAmount = 700');
  assert(breakdown.verifiedApprovedValue === 600, 'Traceable: Breakdown approved value = 600');
  assert(breakdown.adjustment === -100, 'Traceable: Breakdown adjustment = -100 (exactly the 100 difference)');
  assert(event!.adjustment === -100, 'Traceable in event: adjustment = -100');

  const reAuditBreakdown = getFixedAssetVerificationBreakdown(updatedAssetInDb);
  assert(reAuditBreakdown.carryingAmount === 600, 'Traceable: Updated asset carryingAmount is now 600');
  assert(reAuditBreakdown.verifiedApprovedValue === 600, 'Traceable: Updated asset approved value is 600');

  // 6b. Traceable in Audit Log:
  const auditLogs = await mDb.auditLogs.toArray();
  const assetAudit = auditLogs.find((a) => a.action === 'FIXED_ASSET_VERIFICATION_REVALUATION' && a.recordId === assetId);
  assert(assetAudit !== undefined, 'Traceable: Audit log entry exists for asset revaluation');
  const auditDetails = JSON.parse(assetAudit!.details);
  assert(auditDetails.originalCost === 1000, 'Traceable: Audit log details record originalCost = 1000');
  assert(auditDetails.accumulatedDepreciation === 300, 'Traceable: Audit log details record accumulatedDepreciation = 300');
  assert(auditDetails.carryingAmount === 700, 'Traceable: Audit log details record carryingAmount = 700');
  assert(auditDetails.verifiedApprovedValue === 600, 'Traceable: Audit log details record approvedValue = 600');
  assert(auditDetails.adjustment === -100, 'Traceable: Audit log details record adjustment = -100');
  assert(auditDetails.isOperatingProfit === false, 'Traceable: Audit log details confirm isOperatingProfit = false');

  // 6c. Traceable in General Ledger:
  // Machinery (1550): Initial Dr 1000 - Reval Cr 100 = Net Dr 900
  // Accumulated Depreciation (1590): Cr 300
  // Net balance sheet asset = 900 - 300 = 600 (matches approved value 600!)
  const postCostRec = await reconcileFixedAssetRegister(mDb, undefined, valDate);
  assert(postCostRec.isMatched === true, 'Traceable: Fixed asset register is 100% reconciled with GL');
  assert(postCostRec.operationalAmount === 900, 'Traceable: Operational asset cost is ৳900 (৳1000 - ৳100 adjustment)');
  assert(postCostRec.glAmount === 900, 'Traceable: GL Account 1550 balance is ৳900');
  assert(postCostRec.difference === 0, 'Traceable: Cost discrepancy is 0');

  const postDepRec = await reconcileAccumulatedDepreciation(mDb, undefined, valDate);
  assert(postDepRec.isMatched === true, 'Traceable: Accumulated depreciation is 100% reconciled with GL');
  assert(postDepRec.operationalAmount === 300, 'Traceable: Operational accumulated depreciation remains strictly ৳300');
  assert(postDepRec.glAmount === 300, 'Traceable: GL Account 1590 balance remains strictly ৳300');

  // 6d. Traceable in Valuation Reconciliation Gate:
  const postRevalGate = await runValuationReconciliationGate(mDb, valDate);
  assert(postRevalGate.status === 'PASS', 'Traceable: Valuation reconciliation gate PASSES after revaluation');
  assert(postRevalGate.unresolvedCount === 0, 'Traceable: Zero unresolved discrepancies in valuation gate');

  // 6e. Traceable in Valuation Event:
  const finalValuation = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: true
    },
    mDb
  );
  assert(finalValuation.status === 'FINALIZED', 'Traceable: Valuation event successfully FINALIZED');
  const faCategory = finalValuation.auditCalculation?.assetCategories.find((c) => c.category === 'FIXED_ASSETS');
  assert(faCategory !== undefined, 'Traceable: Valuation includes FIXED_ASSETS category');
  assert(faCategory?.totalAmount === 600, 'Traceable: Net fixed asset carrying value in valuation is strictly ৳600 (৳900 - ৳300)');

  // ---------------------------------------------------------------------------
  // STEP 7: Testing Revaluation Surplus Case (e.g. Carrying 600 -> Approved 750)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Testing Revaluation Surplus (Carrying 600 -> Approved 750) ---');
  const surplusResult = await recordFixedAssetVerificationAdjustment(
    {
      assetId,
      approvedValue: 750,
      reason: 'যন্ত্রপাতির বাজারদর ও নির্ভরযোগ্যতা বৃদ্ধিজনিত পুনর্মূল্যায়ন (Asset revaluation surplus)',
      user: testUser,
      valuationDate: '2026-06-25'
    },
    mDb
  );

  const surplusEvent = surplusResult.revaluationEvent;
  assert(surplusEvent !== undefined, 'Surplus revaluation event was created');
  assert(surplusEvent!.carryingAmount === 600, 'Surplus check: Initial carrying amount was 600');
  assert(surplusEvent!.verifiedApprovedValue === 750, 'Surplus check: Approved value is 750');
  assert(surplusEvent!.adjustment === 150, 'Surplus check: Adjustment is +150 (750 - 600)');
  assert(surplusEvent!.isOperatingProfit === false, 'Surplus check: isOperatingProfit is strictly FALSE (NOT operating revenue)');
  assert(surplusEvent!.accountingTreatment === 'REVALUATION_SURPLUS', 'Surplus check: Treatment is REVALUATION_SURPLUS');

  const surplusJournal = surplusResult.journalEntry!;
  const sDebit = surplusJournal.lines.find((l) => l.debit > 0);
  const sCredit = surplusJournal.lines.find((l) => l.credit > 0);
  assert(sDebit?.accountCode === CANONICAL_ACCOUNTS.MACHINERY, 'Surplus debits 1550 (Machinery) for ৳150');
  assert(sCredit?.accountCode === '7020' || sCredit?.accountCode === '3050', 'Surplus credits non-operating gain/reserve account (7020/3050)');

  const assetAfterSurplus = (await mDb.fixedAssets.get(assetId))!;
  assert(assetAfterSurplus.currentBookValue === 750, 'Asset book value updated to 750');
  assert(assetAfterSurplus.accumulatedDepreciation === 300, 'Historical depreciation remains strictly 300 after surplus');

  console.log('\n================================================================');
  console.log(`PROMPT 09 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 09 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 09 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testFixedAssetVerification')) {
  runFixedAssetVerificationTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 09 tests:', err);
      process.exit(1);
    });
}
