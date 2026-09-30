import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  previewValuation,
  calculateBusinessValuation,
  calculateNetAssetValuation,
  createValuationEvent,
  captureDatabaseFinancialState,
  compareFinancialStateBeforeAndAfter,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { FixedAsset, Investor } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 14 — Valuation Preview Must Not Mutate Data
 *
 * Inspect the valuation calculation flow.
 *
 * Before final confirmation, valuation must operate as PREVIEW only.
 *
 * Preview/calculation must not:
 * - create accounting entries;
 * - change capital;
 * - change investor balances;
 * - create profit payable;
 * - alter inventory;
 * - alter finalized records.
 *
 * Only the explicit finalization action may commit changes.
 *
 * Test by running valuation preview and comparing database state before and after.
 *
 * Expected result:
 * No financial mutation during preview.
 *
 * Return PASS.
 */
export async function runValuationPreviewNoMutationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 14: VALUATION PREVIEW NO-MUTATION AUDIT');
  console.log('Testing: Preview-only behavior, zero financial mutation, state comparison');
  console.log('================================================================\n');

  clearValuationEventsForTest();

  const testUser = 'valuation_auditor';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setting up Comprehensive Accounting Baseline
  // Total Assets: ৳1,500 (Bank ৳800, Feed ৳300, Machinery ৳400)
  // Total Liabilities: ৳500 (AP ৳300, Loan ৳200)
  // Total Equity: ৳1,000 (Owner ৳500, Investor ৳500)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establishing Accounting Baseline ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 1a. Cash/Bank
  await mDb.cashBankAccounts.put({
    id: 'cb_p14_main',
    name: 'Operating Bank Account',
    accountType: 'BANK',
    currentBalance: 800,
    synced: false
  });

  // 1b. Inventory
  await mDb.inventoryItems.put({
    id: 'item_feed_p14',
    code: 'FEED-P14',
    nameBn: 'মাছের খাবার (গ্রোয়ার)',
    nameEn: 'Fish Feed (Grower)',
    category: 'FEED',
    currentStock: 3,
    unit: 'BAG',
    avgCostPrice: 100,
    costPrice: 100,
    sellingPrice: 130,
    synced: false
  });
  await mDb.stockMovements.put({
    id: 'sm_feed_p14_opening',
    date: '2026-01-05',
    itemId: 'item_feed_p14',
    movementType: 'OPENING',
    quantity: 3,
    unitCost: 100,
    totalValue: 300,
    status: 'POSTED',
    synced: false
  });

  // 1c. Fixed Asset
  const machineryAsset: FixedAsset = {
    id: 'asset_aerator_p14',
    name: 'পুকুর এয়ারেটর মেশিনারি',
    category: 'MACHINERY',
    purchaseDate: '2026-01-10',
    originalCost: 400,
    usefulLifeYears: 5,
    salvageValue: 0,
    accumulatedDepreciation: 0,
    currentBookValue: 400,
    status: 'ACTIVE',
    synced: false
  };
  await mDb.fixedAssets.put(machineryAsset);

  // 1d. Investor
  const investorId = 'inv_p14_tarek';
  const investorRecord: Investor = {
    id: investorId,
    name: 'তারেক রহমান',
    phone: '01712345678',
    capitalContributed: 500,
    capitalAmount: 500,
    profitSharingRatio: 0.40,
    profitSharePercentage: 40,
    totalProfitPaid: 0,
    status: 'ACTIVE',
    joinedDate: '2026-01-01',
    synced: false
  };
  await mDb.investors.put(investorRecord);

  // 1e. Supplier party
  await mDb.parties.put({
    id: 'supp_feed_p14',
    name: 'ফিড মিলস লিমিটেড',
    type: 'SUPPLIER',
    phone: '01711223344',
    balance: 300,
    currentBalance: 300,
    isActive: true,
    synced: false
  });

  // 1f. Loan
  await mDb.loans.put({
    id: 'loan_p14_bank',
    loanType: 'BORROWED',
    bankAccountId: 'cb_p14_main',
    principalAmount: 200,
    remainingPrincipal: 200,
    disbursementDate: '2026-01-10',
    status: 'ACTIVE',
    lenderName: 'সোনালী ব্যাংক',
    synced: false
  });

  // Post double-entry journals for baseline
  // Founder capital: Dr 1030 ৳500 | Cr 3010 ৳500
  await postJournalEntry(
    {
      id: 'j_p14_cap1',
      voucherNumber: 'V-P14-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 500 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Investor capital: Dr 1030 ৳500 | Cr 3020 ৳500
  await postJournalEntry(
    {
      id: 'j_p14_cap2',
      voucherNumber: 'V-P14-02',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      reference: investorId,
      investorId,
      relatedPerson: investorId,
      narration: 'বিনিয়োগকারীর মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 500, investorId }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Bank loan: Dr 1030 ৳200 | Cr 2110 ৳200
  await postJournalEntry(
    {
      id: 'j_p14_loan',
      voucherNumber: 'V-P14-03',
      voucherType: 'RECEIPT',
      date: '2026-01-10',
      reference: 'loan_p14_bank',
      narration: 'ব্যাংক ঋণ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 200, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ব্যাংক ঋণ', debit: 0, credit: 200 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Buy Inventory on Credit: Dr 1051 ৳300 | Cr 2010 ৳300
  await postJournalEntry(
    {
      id: 'j_p14_inv',
      voucherNumber: 'V-P14-04',
      voucherType: 'PURCHASE',
      date: '2026-01-15',
      reference: 'supp_feed_p14',
      narration: 'বাকিতে ফিড ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: 300, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, accountName: 'সরবরাহকারীর প্রদেয় হিসাব', debit: 0, credit: 300 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Buy Machinery Cash: Dr 1550 ৳400 | Cr 1030 ৳400
  await postJournalEntry(
    {
      id: 'j_p14_fa',
      voucherNumber: 'V-P14-05',
      voucherType: 'PAYMENT',
      date: '2026-01-20',
      reference: 'asset_aerator_p14',
      narration: 'এয়ারেটর যন্ত্রপাতি ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি', debit: 400, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 400 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-20T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 1g. Create a pre-existing FINALIZED valuation event to test immutability of finalized records
  const preFinalizedValuation = await createValuationEvent(
    {
      valuationDate: '2026-03-31',
      responsibleUser: 'auditor_prior_period',
      finalize: true,
      notes: 'পূর্ববর্তী প্রান্তিকের চূড়ান্ত মূল্যায়ন রেকর্ড'
    },
    mDb
  );
  assert(preFinalizedValuation.status === 'FINALIZED', 'Pre-existing finalized valuation established');
  assert(preFinalizedValuation.isImmutable === true, 'Pre-existing valuation is marked immutable');

  // ---------------------------------------------------------------------------
  // STEP 2: Capture Database Financial State BEFORE Preview
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Capturing Database State BEFORE Preview ---');
  const beforeState = await captureDatabaseFinancialState(mDb);

  assert(beforeState.journalEntriesCount === 5, 'Baseline: Exactly 5 journal entries exist');
  assert(beforeState.ownerCapital === 500, 'Baseline: Owner Capital (3010) = ৳500');
  assert(beforeState.investorCapital === 500, 'Baseline: Investor Capital (3020) = ৳500');
  assert(beforeState.profitPayable === 0, 'Baseline: Profit Payable (2050) = ৳0');
  assert(beforeState.inventoryItems['item_feed_p14']?.stock === 3, 'Baseline: Inventory stock = 3 bags');
  assert(beforeState.finalizedValuationCount === 1, 'Baseline: Exactly 1 finalized valuation event exists');

  // ---------------------------------------------------------------------------
  // STEP 3: Execute Valuation Preview
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Executing Valuation Preview Flow ---');
  const preview = await previewValuation(valDate, mDb);

  // Verify preview output:
  assert(preview.mode === 'PREVIEW_ONLY', 'Preview mode is strictly PREVIEW_ONLY');
  assert(preview.isFinalized === false, 'Preview is strictly NOT finalized (isFinalized === false)');
  assert(preview.totalBusinessAssetsIncluded === 1500, 'Preview calculated assets: ৳1,500');
  assert(preview.relevantLiabilities === 500, 'Preview calculated liabilities: ৳500');
  assert(preview.resultingNetBusinessValue === 1000, 'Preview calculated NAV: ৳1,000 (1500 - 500 = 1000)');
  assert(preview.noFinancialMutationGuaranteed === true, 'Preview guarantees zero financial mutation');
  assert(preview.reconciliationGatePreview.status === 'PASS', 'Preview reconciliation gate returns PASS');

  // Also run calculation flows calculateBusinessValuation and calculateNetAssetValuation
  const calc1 = await calculateBusinessValuation(valDate, mDb);
  assert(calc1.resultingNetBusinessValue === 1000, 'calculateBusinessValuation reports NAV ৳1,000');
  const calc2 = await calculateNetAssetValuation(valDate, mDb);
  assert(calc2.netAssetValue === 1000, 'calculateNetAssetValuation reports NAV ৳1,000');

  // ---------------------------------------------------------------------------
  // STEP 4: Capture Database Financial State AFTER Preview & Compare
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Comparing Database State Before and After Preview ---');
  const afterState = await captureDatabaseFinancialState(mDb);
  const comparison = compareFinancialStateBeforeAndAfter(beforeState, afterState);

  // 1. Must NOT create accounting entries
  assert(comparison.noAccountingEntriesCreated === true, 'CRITICAL AUDIT: Zero accounting entries created during preview (journal entries count remained 5)');
  assert(afterState.journalEntriesCount === beforeState.journalEntriesCount, 'Journal entries count unchanged: ' + afterState.journalEntriesCount);

  // 2. Must NOT change capital
  assert(comparison.capitalUnchanged === true, 'CRITICAL AUDIT: Capital is 100% unchanged (Owner: ৳500, Investor: ৳500)');
  assert(afterState.ownerCapital === 500, 'Owner Capital account (3010) strictly remained ৳500');
  assert(afterState.investorCapital === 500, 'Investor Capital account (3020) strictly remained ৳500');

  // 3. Must NOT change investor balances
  assert(comparison.investorBalancesUnchanged === true, 'CRITICAL AUDIT: Investor balances 100% unchanged');
  assert(afterState.investorBalances[investorId]?.capital === 500, 'Investor capital contributed remains ৳500');
  assert(afterState.investorBalances[investorId]?.totalProfitEarned === 0, 'Investor total profit earned remains ৳0');

  // 4. Must NOT create profit payable
  assert(comparison.noProfitPayableCreated === true, 'CRITICAL AUDIT: Profit payable (2050) was NOT created');
  assert(afterState.profitPayable === 0, 'Profit payable account (2050) balance strictly remained ৳0');

  // 5. Must NOT alter inventory
  assert(comparison.inventoryUnaltered === true, 'CRITICAL AUDIT: Inventory is 100% unaltered');
  assert(afterState.inventoryItems['item_feed_p14']?.stock === 3, 'Feed stock remains strictly 3 bags');
  assert(afterState.stockMovementsCount === beforeState.stockMovementsCount, 'Stock movements count unchanged: ' + afterState.stockMovementsCount);

  // 6. Must NOT alter finalized records
  assert(comparison.finalizedRecordsUnaltered === true, 'CRITICAL AUDIT: Existing finalized valuation records are 100% unaltered');
  assert(afterState.finalizedValuationCount === 1, 'Finalized valuation count remained strictly 1');
  const reloadedPreFinalized = afterState.finalizedValuationSnapshots[preFinalizedValuation.id];
  assert(Boolean(reloadedPreFinalized), 'Pre-existing finalized record still intact in database');

  // Overall check
  assert(comparison.hasAnyMutation === false, 'CRITICAL RESULT: Zero financial mutations detected during preview');
  assert(comparison.mutationsList.length === 0, 'Mutations list is empty: []');

  // ---------------------------------------------------------------------------
  // STEP 5: Only Explicit Finalization Action Commits Changes
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Testing Explicit Finalization Action ---');
  const finalizedEvent = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: true,
      notes: 'স্পষ্ট নিশ্চিতকরণসহ চূড়ান্ত অনুমোদন (Explicit confirmation finalization)'
    },
    mDb
  );

  assert(finalizedEvent.status === 'FINALIZED', 'Explicit finalization action successfully finalized event: ' + finalizedEvent.id);
  assert(finalizedEvent.isImmutable === true, 'Explicitly finalized event is now immutable');

  const postFinalizeState = await captureDatabaseFinancialState(mDb);
  assert(postFinalizeState.finalizedValuationCount === 2, 'Finalized valuations count is now 2 (pre-existing 1 + newly finalized 1)');
  // Even finalization does not modify core historical GL journal entries or inventory:
  assert(postFinalizeState.journalEntriesCount === 5, 'Historical GL entries count remains intact: 5');
  assert(postFinalizeState.inventoryItems['item_feed_p14']?.stock === 3, 'Inventory stock remains intact: 3 bags');

  console.log('\n================================================================');
  console.log(`PROMPT 14 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 14 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 14 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testValuationPreviewNoMutation')) {
  runValuationPreviewNoMutationTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 14 tests:', err);
      process.exit(1);
    });
}
