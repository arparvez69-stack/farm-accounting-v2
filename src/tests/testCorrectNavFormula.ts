import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  calculateNetAssetValuation,
  createValuationEvent,
  validateCoreNavFormula,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry, generateBalanceSheet, generateProfitLoss } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 11 — Correct NAV Formula
 *
 * Inspect the valuation formula.
 *
 * The core NAV formula must be:
 *   NAV = approved assets - approved liabilities
 *
 * Do NOT calculate:
 *   Assets - Liabilities + Net Profit
 * when accounting profit is already reflected in the accounting balances.
 *
 * Example:
 *   Capital = 300
 *   Accounting profit = 300
 *   Liabilities = 0
 *   Assets = 600
 *
 * Expected NAV = 600, not 900.
 *
 * Run this exact test.
 * Fix only double-counting logic.
 * Return PASS.
 */
export async function runCorrectNavFormulaTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 11: CORRECT NAV FORMULA & DOUBLE-COUNTING AUDIT');
  console.log('Testing: Capital=300, Profit=300, Liab=0, Assets=600 -> NAV=600 (not 900)');
  console.log('================================================================\n');

  clearValuationEventsForTest();

  const testUser = 'valuation_auditor_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setting up Exact Test Baseline:
  // Capital = 300
  // Accounting profit = 300
  // Liabilities = 0
  // Assets = 600
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting up Exact Test Accounting Balances ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 1a. Operational Bank Account
  await mDb.cashBankAccounts.put({
    id: 'cb_p11_main',
    name: 'Operating Bank Account',
    accountType: 'BANK',
    currentBalance: 600,
    synced: false
  });

  // 1b. Transaction 1: Capital Contribution of ৳300
  // Dr 1030 (Bank) ৳300 | Cr 3010 (Owner Capital) ৳300
  await postJournalEntry(
    {
      id: 'j_p11_capital',
      voucherNumber: 'V-P11-CAP',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার প্রারম্ভিক মূলধন জমা (Capital = 300)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 300, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 300 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 1c. Transaction 2: Earned Accounting Profit of ৳300
  // Dr 1030 (Bank) ৳300 | Cr 4010 (Fish Revenue) ৳300
  await postJournalEntry(
    {
      id: 'j_p11_revenue',
      voucherNumber: 'V-P11-REV',
      voucherType: 'RECEIPT',
      date: '2026-06-15',
      narration: 'মাছ বিক্রয় আয় হিসাবভুক্তকরণ (Accounting profit = 300)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 300, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 300 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Verify Accounting Source of Truth (Balance Sheet & Profit/Loss)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Verifying Authoritative Accounting Balances ---');
  const bs = await generateBalanceSheet(valDate, mDb);
  const pl = await generateProfitLoss({ startDate: '2026-01-01', endDate: valDate }, undefined, mDb);

  assert(bs.totalAssets === 600, 'Authoritative Balance Sheet: Assets = 600');
  assert(bs.totalLiabilities === 0, 'Authoritative Balance Sheet: Liabilities = 0');
  assert(bs.totalEquity === 600, 'Authoritative Balance Sheet: Equity = 600 (Capital 300 + Profit 300)');
  assert(bs.isBalanced === true, 'Authoritative Balance Sheet is 100% balanced');
  assert(pl.netProfit === 300, 'Profit and Loss: Accounting profit = 300');

  // Verify that the ৳300 accounting profit is ALREADY reflected inside the ৳600 Bank Asset balance
  const bankAccount = bs.assets.find((a) => a.code === CANONICAL_ACCOUNTS.BANK);
  assert(bankAccount?.amount === 600, 'Bank asset balance is ৳600 (reflects ৳300 capital + ৳300 realized profit)');

  // ---------------------------------------------------------------------------
  // STEP 3: Execute Core NAV Formula Test (Expected NAV = 600, not 900)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Executing Core NAV Formula Test ---');
  const navCalc = await calculateNetAssetValuation(valDate, mDb);

  assert(navCalc.totalEligibleAssets === 600, 'Core NAV input: approved assets = 600');
  assert(navCalc.totalDeductedLiabilities === 0, 'Core NAV input: approved liabilities = 0');

  // CRITICAL TEST: NAV must equal 600, NOT 900!
  assert(navCalc.netAssetValue === 600, 'EXACT TEST: Expected NAV is strictly 600 (NAV = 600 - 0 = 600)');
  assert(navCalc.netAssetValue !== 900, 'CRITICAL AUDIT: NAV is NOT 900 (double-counting prevented)');

  // Verify formula string and audit flags
  assert(navCalc.formula.includes('Approved Assets') && navCalc.formula.includes('Approved Liabilities'), 'Formula explicitly states: NAV = Approved Assets − Approved Liabilities');
  assert(navCalc.netProfitExcludedFromNavSum === true, 'Audit flag: netProfitExcludedFromNavSum is strictly TRUE');
  assert(navCalc.doubleCountingProfitPrevented === true, 'Audit flag: doubleCountingProfitPrevented is strictly TRUE');

  // ---------------------------------------------------------------------------
  // STEP 4: Inspect and Test validateCoreNavFormula
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Testing validateCoreNavFormula with Erroneous Double-Counting Comparison ---');
  const formulaValidation = validateCoreNavFormula({
    approvedAssets: 600,
    approvedLiabilities: 0,
    accountingProfitReflectedInBalances: 300
  });

  assert(formulaValidation.coreNav === 600, 'Validator coreNav is strictly 600');
  assert(formulaValidation.erroneousDoubleCountedNav === 900, 'Validator detects erroneous formula (Assets - Liab + Profit = 600 - 0 + 300) would yield 900');
  assert(formulaValidation.isDoubleCounted === true, 'Validator correctly flags double-counting discrepancy');
  assert(formulaValidation.doubleCountingPrevented === true, 'Validator confirms double counting was prevented');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify Valuation Event Records Exactly 600 (not 900)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying Valuation Event Persistence ---');
  const valEvent = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: true
    },
    mDb
  );

  assert(valEvent.status === 'FINALIZED', 'Valuation event successfully FINALIZED');
  assert(valEvent.totalBusinessAssetsIncluded === 600, 'Valuation event totalBusinessAssetsIncluded = 600');
  assert(valEvent.relevantLiabilities === 0, 'Valuation event relevantLiabilities = 0');
  assert(valEvent.resultingNetBusinessValue === 600, 'Valuation event resultingNetBusinessValue = 600 (NOT 900)');
  assert(valEvent.resultingNetBusinessValue !== 900, 'Valuation event strictly rejected double-counted 900 value');

  // ---------------------------------------------------------------------------
  // STEP 6: Additional Test with Non-Zero Liabilities
  // Capital = 400, Profit = 300, Liabilities = 100, Assets = 600
  // Core NAV = 600 - 100 = 500 (NOT 600 - 100 + 300 = 800)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Testing Non-Zero Liabilities Case (Assets=600, Liab=100 -> NAV=500, not 800) ---');
  // Add a loan liability of ৳100 and use ৳100 cash (so Assets remain 600, Liab = 100)
  await postJournalEntry(
    {
      id: 'j_p11_loan',
      voucherNumber: 'V-P11-LOAN',
      voucherType: 'RECEIPT',
      date: '2026-06-20',
      narration: 'ব্যাংক ঋণ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ঋণ', debit: 0, credit: 100 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-20T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  // Pay operational expense of ৳100 to keep total assets at 600
  await postJournalEntry(
    {
      id: 'j_p11_expense',
      voucherNumber: 'V-P11-EXP',
      voucherType: 'PAYMENT',
      date: '2026-06-25',
      narration: 'খামারের সাধারণ ব্যয় পরিশোধ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, accountName: 'বিবিধ খরচ', debit: 100, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 100 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-25T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const bsWithLiab = await generateBalanceSheet(valDate, mDb);
  assert(bsWithLiab.totalAssets === 600, 'Assets remain 600');
  assert(bsWithLiab.totalLiabilities === 100, 'Liabilities are 100');

  const navWithLiab = await calculateNetAssetValuation(valDate, mDb);
  assert(navWithLiab.netAssetValue === 500, 'Core NAV with liabilities is strictly 500 (600 - 100 = 500)');
  assert(navWithLiab.netAssetValue !== 700 && navWithLiab.netAssetValue !== 800, 'Profit is not double-counted when liabilities exist');

  console.log('\n================================================================');
  console.log(`PROMPT 11 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 11 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 11 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testCorrectNavFormula')) {
  runCorrectNavFormulaTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 11 tests:', err);
      process.exit(1);
    });
}
