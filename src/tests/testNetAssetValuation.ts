import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  calculateNetAssetValuation,
  calculateBusinessValuation,
  createValuationEvent,
  categorizeNavAsset,
  categorizeNavLiability,
  clearValuationEventsForTest
} from '../services/transactionService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 7 — NET ASSET VALUATION (NAV) BASIS TESTS
 * Validates the transparent Net Asset Value approach for investor admission:
 * - NAV = eligible business assets − business liabilities
 * - Includes cash, bank, inventory, receivables, fixed assets (net of depreciation), production assets, other assets
 * - Deducts payables, recognized loans/liabilities, customer advances, accrued obligations
 * - Does NOT simply total investor capital
 * - Does NOT treat revenue as an asset
 * - Does NOT treat unrecognized future profit as current asset value
 * - Does NOT silently invent market values
 * - Full reproducibility from accounting records with audit checksum
 * - Transparent audit calculation breakdown
 */
export async function runNetAssetValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 7: NET ASSET VALUATION (NAV) TESTS');
  console.log('Testing transparent NAV basis, asset/liability inclusion, & audit reproducibility');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  const testUserId = 'nav_auditor_p7';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p7';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 400000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p7';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 150000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Broad Recognized Business Assets and Liabilities
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Seeding Broad Asset and Liability Portfolios ---');

  // A. Cash & Bank Initial Position: Dr 1010 Cash ৳150,000, Dr 1030 Bank ৳400,000 | Cr 3010 Owner Capital ৳550,000
  await postJournalEntry(
    {
      id: 'j_nav_01',
      voucherNumber: 'V-NAV-01',
      voucherType: 'RECEIPT',
      date: '2026-03-01',
      narration: 'প্রাথমিক নগদ ও ব্যাংক তহবিল',
      lines: [
        { accountCode: '1010', accountName: 'নগদ হিসাব', debit: 150000, credit: 0 },
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 400000, credit: 0 },
        { accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 550000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-01T09:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // B. Inventory (Feed 1051 + Medicine/Fertilizer 1052): Dr 1051 ৳90,000, Dr 1052 ৳30,000 | Cr 2010 Trade Payables ৳120,000
  await postJournalEntry(
    {
      id: 'j_nav_02',
      voucherNumber: 'V-NAV-02',
      voucherType: 'PURCHASE',
      date: '2026-03-10',
      narration: 'পশুখাদ্য ও বীজ/সার মজুত বাকিতে ক্রয়',
      lines: [
        { accountCode: '1051', accountName: 'মজুদ খাদ্য', debit: 90000, credit: 0 },
        { accountCode: '1052', accountName: 'মজুদ বীজ ও সার', debit: 30000, credit: 0 },
        { accountCode: '2010', accountName: 'প্রদেয় হিসাব', debit: 0, credit: 120000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-10T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // C. Receivables (1040 Accounts Receivable): Dr 1040 ৳60,000 | Cr 4010 Farm Revenue ৳60,000
  await postJournalEntry(
    {
      id: 'j_nav_03',
      voucherNumber: 'V-NAV-03',
      voucherType: 'SALES',
      date: '2026-03-15',
      narration: 'বাকিতে খামার পণ্য বিক্রয়',
      lines: [
        { accountCode: '1040', accountName: 'গ্রাহকের নিকট পাওনা', debit: 60000, credit: 0 },
        { accountCode: '4010', accountName: 'খামার পণ্য বিক্রয় আয়', debit: 0, credit: 60000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-15T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // D. Fixed Assets (Machinery 1550 + Sheds/Buildings 1520): Dr 1550 ৳250,000, Dr 1520 ৳350,000 | Cr 1030 Bank ৳200,000, Cr 2030 Bank Loan ৳400,000
  await postJournalEntry(
    {
      id: 'j_nav_04',
      voucherNumber: 'V-NAV-04',
      voucherType: 'PAYMENT',
      date: '2026-03-20',
      narration: 'যন্ত্রপাতি ও খামার ভবন স্থাপন (ব্যাংক ঋণ ও নিজস্ব অর্থায়ন)',
      lines: [
        { accountCode: '1550', accountName: 'যন্ত্রপাতি ও সরঞ্জাম', debit: 250000, credit: 0 },
        { accountCode: '1520', accountName: 'শেড ও ভবন', debit: 350000, credit: 0 },
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 200000 },
        { accountCode: '2030', accountName: 'ব্যাংক ঋণ', debit: 0, credit: 400000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-20T12:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // E. Accumulated Depreciation on Fixed Assets (Contra-Asset 1590): Dr 6140 ৳35,000 | Cr 1590 ৳35,000
  await postJournalEntry(
    {
      id: 'j_nav_05',
      voucherNumber: 'V-NAV-05',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'যন্ত্রপাতি ও ভবনের প্রথম প্রান্তিকের অবচয়',
      lines: [
        { accountCode: '6140', accountName: 'অবচয় খরচ', debit: 35000, credit: 0 },
        { accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 35000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-31T16:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // F. Production Assets / Biological WIP (1054): Dr 1054 ৳75,000 | Cr 1010 Cash ৳75,000
  await postJournalEntry(
    {
      id: 'j_nav_06',
      voucherNumber: 'V-NAV-06',
      voucherType: 'PAYMENT',
      date: '2026-04-10',
      narration: 'চলমান ফসল ও মৎস্য পোনা উৎপাদন ব্যয় (Biological WIP)',
      lines: [
        { accountCode: '1054', accountName: 'প্রক্রিয়াধীন পণ্য (WIP)', debit: 75000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 75000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-10T14:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // G. Customer Advance / Unearned Obligation (2040): Dr 1030 Bank ৳40,000 | Cr 2040 Customer Advances ৳40,000
  await postJournalEntry(
    {
      id: 'j_nav_07',
      voucherNumber: 'V-NAV-07',
      voucherType: 'RECEIPT',
      date: '2026-04-15',
      narration: 'ভবিষ্যৎ পণ্য সরবরাহের জন্য গ্রাহকের নিকট হতে অগ্রিম গ্রহণ',
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 40000, credit: 0 },
        { accountCode: '2040', accountName: 'গ্রাহক অগ্রিম', debit: 0, credit: 40000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // H. Accrued Operating Expenses (2020): Dr 6110 Farm Labor Expense ৳25,000 | Cr 2020 Accrued Expenses ৳25,000
  await postJournalEntry(
    {
      id: 'j_nav_08',
      voucherNumber: 'V-NAV-08',
      voucherType: 'JOURNAL',
      date: '2026-04-20',
      narration: 'শ্রমিকদের বকেয়া মজুরি হিসাবভুক্তকরণ',
      lines: [
        { accountCode: '6110', accountName: 'শ্রমিক মজুরি খরচ', debit: 25000, credit: 0 },
        { accountCode: '2020', accountName: 'বকেয়া খরচ', debit: 0, credit: 25000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-20T17:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // I. Other Current Assets (Prepaid Expenses 1060): Dr 1060 ৳20,000 | Cr 1030 Bank ৳20,000
  await postJournalEntry(
    {
      id: 'j_nav_09',
      voucherNumber: 'V-NAV-09',
      voucherType: 'PAYMENT',
      date: '2026-04-25',
      narration: 'অগ্রিম বীমা প্রিমিয়াম প্রদান (Prepaid Expense)',
      lines: [
        { accountCode: '1060', accountName: 'অগ্রিম খরচ', debit: 20000, credit: 0 },
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 20000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-25T11:30:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Compute Net Asset Value and Validate Transparent Categorization
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Running Net Asset Valuation (NAV) Audit Calculation ---');

  const valuationDate = '2026-04-30';
  const nav = await calculateNetAssetValuation(valuationDate, mDb);

  // Expected Balances as of 2026-04-30:
  // Cash (1010): 150,000 - 75,000 = ৳75,000
  // Bank (1030): 400,000 - 200,000 + 40,000 - 20,000 = ৳220,000
  // Inventory: 1070 (90,000) + 1071 (30,000) = ৳120,000
  // Receivables: 1040 = ৳60,000
  // Fixed Assets: 1520 (250,000) + 1530 (350,000) - 1590 Acc. Depr (35,000) = ৳565,000
  // Production Assets (1080): ৳75,000
  // Other Current Assets (1090): ৳20,000
  // Total Assets = 75k + 220k + 120k + 60k + 565k + 75k + 20k = ৳1,135,000

  // Deducted Liabilities:
  // Trade Payables (2010): ৳120,000
  // Loans (2030): ৳400,000
  // Customer Advances (2040): ৳40,000
  // Accrued Expenses (2020): ৳25,000
  // Total Liabilities = 120k + 400k + 40k + 25k = ৳585,000

  // Resulting Net Asset Value:
  // NAV = 1,135,000 - 585,000 = ৳550,000

  assert(nav.valuationDate === valuationDate, 'NAV calculation records exact valuation date (2026-04-30)');
  assert(nav.totalEligibleAssets === 1135000, 'Eligible business assets accurately totaled ৳1,135,000');
  assert(nav.totalDeductedLiabilities === 585000, 'Recognized business liabilities accurately totaled ৳585,000');
  assert(nav.netAssetValue === 550000, 'Net Asset Value equals eligible assets minus liabilities (৳550,000)');
  assert(
    nav.netAssetValue === nav.totalEligibleAssets - nav.totalDeductedLiabilities,
    'Core formula strictly satisfied: NAV = eligible business assets − business liabilities'
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Inclusion of All Required Business Asset Categories
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Inclusion of Required Business Asset Categories ---');

  const cashCat = nav.assetCategories.find((c) => c.category === 'CASH');
  assert(cashCat !== undefined && cashCat.totalAmount === 75000, 'Cash category included with balance ৳75,000');

  const bankCat = nav.assetCategories.find((c) => c.category === 'BANK');
  assert(bankCat !== undefined && bankCat.totalAmount === 220000, 'Bank category included with balance ৳220,000');

  const invCat = nav.assetCategories.find((c) => c.category === 'INVENTORY');
  assert(invCat !== undefined && invCat.totalAmount === 120000, 'Inventory category included with balance ৳120,000');

  const recCat = nav.assetCategories.find((c) => c.category === 'RECEIVABLES');
  assert(recCat !== undefined && recCat.totalAmount === 60000, 'Receivables category included with balance ৳60,000');

  const faCat = nav.assetCategories.find((c) => c.category === 'FIXED_ASSETS');
  assert(faCat !== undefined && faCat.totalAmount === 565000, 'Fixed assets included net of accumulated depreciation (৳565,000)');

  const prodCat = nav.assetCategories.find((c) => c.category === 'PRODUCTION_ASSETS');
  assert(prodCat !== undefined && prodCat.totalAmount === 75000, 'Relevant production assets (biological/WIP) included (৳75,000)');

  const ocaCat = nav.assetCategories.find((c) => c.category === 'OTHER_CURRENT_ASSETS');
  assert(ocaCat !== undefined && ocaCat.totalAmount === 20000, 'Other recognized business assets (prepaids) included (৳20,000)');

  const sumOfAssetCategories = nav.assetCategories.reduce((sum, c) => sum + c.totalAmount, 0);
  assert(
    Math.round(sumOfAssetCategories * 100) / 100 === nav.totalEligibleAssets,
    'Sum of asset category breakdowns equals total eligible business assets'
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Deduction of All Required Liability Categories
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Deduction of Required Liability Categories ---');

  const apCat = nav.liabilityCategories.find((l) => l.category === 'TRADE_PAYABLES');
  assert(apCat !== undefined && apCat.totalAmount === 120000, 'Trade payables deducted with balance ৳120,000');

  const loanCat = nav.liabilityCategories.find((l) => l.category === 'LOANS');
  assert(loanCat !== undefined && loanCat.totalAmount === 400000, 'Recognized loans/debt deducted with balance ৳400,000');

  const advCat = nav.liabilityCategories.find((l) => l.category === 'CUSTOMER_ADVANCES');
  assert(advCat !== undefined && advCat.totalAmount === 40000, 'Customer advance obligations deducted with balance ৳40,000');

  const accCat = nav.liabilityCategories.find((l) => l.category === 'ACCRUED_OBLIGATIONS');
  assert(accCat !== undefined && accCat.totalAmount === 25000, 'Accrued obligations deducted with balance ৳25,000');

  const sumOfLiabilityCategories = nav.liabilityCategories.reduce((sum, l) => sum + l.totalAmount, 0);
  assert(
    Math.round(sumOfLiabilityCategories * 100) / 100 === nav.totalDeductedLiabilities,
    'Sum of liability category breakdowns equals total deducted liabilities'
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Audit Guarantees & Constraints
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Enforcing Accounting Integrity & Valuation Rules ---');

  // Rule 1: Do not simply total investor capital
  // Here, Owner Capital 3010 is ৳550,000, but NAV is calculated from assets minus liabilities
  assert(
    nav.investorCapitalExcludedFromNavBasis === true,
    'Valuation does NOT simply total investor capital (nav derives strictly from assets - liabilities)'
  );

  // Rule 2: Do not treat revenue as an asset
  assert(
    nav.revenueExcludedFromAssets === true,
    'Revenue (accounts 4000+) is strictly excluded from asset categories'
  );
  const revenueInAssets = nav.assetCategories
    .flatMap((c) => c.items)
    .some((item) => item.code.startsWith('4') || Number(item.code) >= 4000);
  assert(!revenueInAssets, 'Zero revenue account lines present in eligible asset breakdown');

  // Rule 3: Do not treat unrecognized future profit as current asset value
  assert(
    nav.unrecognizedProfitExcluded === true,
    'Unrecognized future profit is excluded from current asset value'
  );

  // Rule 4: Do not silently invent market values
  assert(
    nav.marketValueInventionDetected === false,
    'Zero invented market values: all figures derive strictly from general ledger book values'
  );

  // Rule 5: Clear, transparent formula string provided
  assert(Boolean(nav.formula), 'Audit calculation provides explicit mathematical formula string');
  assert(nav.formula.includes('1,135,000') && nav.formula.includes('585,000'), 'Formula explicitly displays asset and liability totals');

  // ---------------------------------------------------------------------------
  // STEP 6: Reproducibility From Accounting Records
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying Exact Reproducibility From Accounting Records ---');

  assert(Boolean(nav.reproducibilityChecksum), 'Audit calculation produces deterministic cryptographic checksum');

  // Run calculation a second time on the same accounting state
  const navReRun = await calculateNetAssetValuation(valuationDate, mDb);
  assert(navReRun.netAssetValue === nav.netAssetValue, 'Reproducibility: Net Asset Value is 100% identical on re-run');
  assert(
    navReRun.totalEligibleAssets === nav.totalEligibleAssets,
    'Reproducibility: Total eligible assets are 100% identical on re-run'
  );
  assert(
    navReRun.totalDeductedLiabilities === nav.totalDeductedLiabilities,
    'Reproducibility: Total liabilities are 100% identical on re-run'
  );
  assert(
    navReRun.reproducibilityChecksum === nav.reproducibilityChecksum,
    'Reproducibility: Checksum matches byte-for-byte across separate audit runs'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Integration with createValuationEvent
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Verifying Integration with createValuationEvent ---');

  const valEvent = await createValuationEvent(
    {
      valuationDate,
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'Series B pre-admission valuation based on verified Balance Sheet NAV'
    },
    mDb
  );

  assert(valEvent.valuationMethodology === 'NET_ASSET_VALUE', 'Valuation event records NET_ASSET_VALUE methodology');
  assert(valEvent.totalBusinessAssetsIncluded === 1135000, 'Valuation event preserves NAV total assets (৳1,135,000)');
  assert(valEvent.relevantLiabilities === 585000, 'Valuation event preserves NAV total liabilities (৳585,000)');
  assert(valEvent.resultingNetBusinessValue === 550000, 'Valuation event preserves NAV resulting value (৳550,000)');
  assert(Boolean(valEvent.auditCalculation), 'Valuation event embeds full NavAuditCalculation breakdown');
  assert(
    valEvent.auditCalculation?.reproducibilityChecksum === nav.reproducibilityChecksum,
    'Embedded audit calculation checksum matches standalone NAV calculation'
  );

  // ---------------------------------------------------------------------------
  // STEP 8: Classification Helper Unit Tests
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 8: Classification Mapping Verifications ---');

  assert(categorizeNavAsset('1010', 'Main Cash Drawer') === 'CASH', 'Code 1010 maps to CASH');
  assert(categorizeNavAsset('1030', 'Prime Bank Account') === 'BANK', 'Code 1030 maps to BANK');
  assert(categorizeNavAsset('1070', 'Feed Inventory') === 'INVENTORY', 'Code 1070 maps to INVENTORY');
  assert(categorizeNavAsset('1040', 'Accounts Receivable') === 'RECEIVABLES', 'Code 1040 maps to RECEIVABLES');
  assert(categorizeNavAsset('1080', 'Biological Assets WIP') === 'PRODUCTION_ASSETS', 'Code 1080 maps to PRODUCTION_ASSETS');
  assert(categorizeNavAsset('1520', 'Machinery & Equipment') === 'FIXED_ASSETS', 'Code 1520 maps to FIXED_ASSETS');
  assert(categorizeNavAsset('1060', 'Prepaid Insurance') === 'OTHER_CURRENT_ASSETS', 'Code 1060 maps to OTHER_CURRENT_ASSETS');

  assert(categorizeNavLiability('2010', 'Accounts Payable') === 'TRADE_PAYABLES', 'Code 2010 maps to TRADE_PAYABLES');
  assert(categorizeNavLiability('2030', 'Bank Loan') === 'LOANS', 'Code 2030 maps to LOANS');
  assert(categorizeNavLiability('2040', 'Customer Advance') === 'CUSTOMER_ADVANCES', 'Code 2040 maps to CUSTOMER_ADVANCES');
  assert(categorizeNavLiability('2020', 'Accrued Wages') === 'ACCRUED_OBLIGATIONS', 'Code 2020 maps to ACCRUED_OBLIGATIONS');

  console.log('\n================================================================');
  console.log(`PROMPT 7 NET ASSET VALUATION TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testNetAssetValuation.ts') || process.argv[1].endsWith('testNetAssetValuation.js'));

if (isDirectRun) {
  runNetAssetValuationTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Prompt 7 NAV tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 7 NAV tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 7 NAV tests:', err);
      process.exit(1);
    });
}
