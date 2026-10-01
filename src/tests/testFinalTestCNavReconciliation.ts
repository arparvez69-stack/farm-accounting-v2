import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry, generateTrialBalance, generateBalanceSheet, generateProfitLoss } from '../accounting/accountingEngine';
import { runNavReconciliation, NavReconciliationReport } from '../services/navReconciliationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST C — NAV Reconciliation
 *
 * Requirements:
 * Run:
 *   NAV = Assets - Liabilities
 *
 * Then reconcile NAV movement against:
 *   Opening NAV
 *   + operating result
 *   + capital contributions
 *   - capital withdrawals
 *   + approved valuation adjustments
 *   + other legitimate equity movements
 *   = Closing NAV
 *
 * Do not force the result.
 * Find the actual source of any discrepancy.
 * Return PASS only after reconciliation.
 */
export async function runFinalTestCNavReconciliation(): Promise<AssertionResult> {
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
  console.log('FINAL TEST C — NAV RECONCILIATION');
  console.log('Primary Formula:');
  console.log('  NAV = Assets - Liabilities');
  console.log('Reconciliation Formula:');
  console.log('  Opening NAV');
  console.log('  + operating result');
  console.log('  + capital contributions');
  console.log('  - capital withdrawals');
  console.log('  + approved valuation adjustments');
  console.log('  + other legitimate equity movements');
  console.log('  = Closing NAV');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  // Populate canonical Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Opening Financial Position (as of 2025-12-31)
  // Assets: Bank ৳200,000 + Inventory ৳100,000 = ৳300,000
  // Liabilities: Accounts Payable ৳50,000
  // Opening NAV = 300,000 - 50,000 = ৳250,000
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establishing Opening Balance Sheet (2025-12-31) ---');

  await postJournalEntry(
    {
      id: 'j_open_position',
      voucherNumber: 'JV-OPEN-POS',
      voucherType: 'JOURNAL',
      date: '2025-12-31',
      narration: 'Opening Financial Position (Assets, Liabilities, Equity)',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 200000, credit: 0 },
        { accountId: 'acc_1056', accountCode: '1056', accountName: 'জীবন্ত পশু ও প্রজনন স্টক (Biological Assets)', debit: 100000, credit: 0 },
        { accountId: 'acc_2010', accountCode: '2010', accountName: 'বাণিজ্যিক প্রদেয় হিসাব (AP)', debit: 0, credit: 50000 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'মালিকের মূলধন (Owner Capital)', debit: 0, credit: 250000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2025-12-31T23:59:59Z'
    },
    { dbInstance }
  );

  const openBs = await generateBalanceSheet('2025-12-31', dbInstance);
  const openAssets = openBs.totalAssets;
  const openLiabilities = openBs.totalLiabilities;
  const openNav = Math.round((openAssets - openLiabilities) * 100) / 100;

  assert(openAssets === 300000, `Opening Assets = ৳300,000 (got ${openAssets})`);
  assert(openLiabilities === 50000, `Opening Liabilities = ৳50,000 (got ${openLiabilities})`);
  assert(openNav === 250000, `Opening NAV = Assets - Liabilities = ৳250,000 (got ${openNav})`);

  // ---------------------------------------------------------------------------
  // STEP 2: Post Period Operational & Equity Transactions (2026-01-01 to 2026-03-31)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Executing Period Operational & Equity Movements ---');

  // 1. Operating Result (P&L):
  // Operating Revenue: Goat Sales (4010) = ৳150,000
  await postJournalEntry(
    {
      id: 'j_sale_q1',
      voucherNumber: 'SV-Q1-001',
      voucherType: 'RECEIPT',
      date: '2026-01-15',
      narration: 'ছাগল বিক্রয় বাবদ আয় (Goat Sales)',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 150000, credit: 0 },
        { accountId: 'acc_4010', accountCode: '4010', accountName: 'ছাগল বিক্রয় আয়', debit: 0, credit: 150000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-15T10:00:00Z'
    },
    { dbInstance }
  );

  // Operating Expenses: Feed Cost (5010) = ৳40,000 + Vet Care (5020) = ৳20,000 -> Total = ৳60,000
  await postJournalEntry(
    {
      id: 'j_exp_q1',
      voucherNumber: 'PV-Q1-001',
      voucherType: 'PAYMENT',
      date: '2026-02-10',
      narration: 'পশু খাদ্য ও চিকিৎসা ব্যয় (Feed & Vet Expenses)',
      lines: [
        { accountId: 'acc_5010', accountCode: '5010', accountName: 'খাদ্য খরচ', debit: 40000, credit: 0 },
        { accountId: 'acc_5020', accountCode: '5020', accountName: 'চিকিৎসা খরচ', debit: 20000, credit: 0 },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 60000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-10T10:00:00Z'
    },
    { dbInstance }
  );
  // Net Operating Result = 150,000 - 60,000 = ৳90,000

  // 2. Capital Contribution:
  // New Investor Capital (3020) = ৳100,000
  await postJournalEntry(
    {
      id: 'j_cap_contrib',
      voucherNumber: 'JV-CAP-IN',
      voucherType: 'RECEIPT',
      date: '2026-02-15',
      narration: 'নতুন বিনিয়োগকারীর মূলধন সংযোজন (Investor Capital Contribution)',
      investorId: 'inv_alamin_001',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100000, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100000, investorId: 'inv_alamin_001' }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-15T11:00:00Z'
    },
    { dbInstance }
  );

  // 3. Capital Withdrawal:
  // Owner Partial Capital Withdrawal (3010) = ৳30,000
  await postJournalEntry(
    {
      id: 'j_cap_with',
      voucherNumber: 'JV-CAP-OUT',
      voucherType: 'PAYMENT',
      date: '2026-03-01',
      narration: 'মালিকের আংশিক মূলধন উত্তোলন (Owner Capital Withdrawal)',
      lines: [
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 30000, credit: 0 },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 30000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-01T11:00:00Z'
    },
    { dbInstance }
  );

  // 4. Approved Valuation Adjustment:
  // Land & Fixed Asset Revaluation Surplus (3040) = ৳50,000
  await postJournalEntry(
    {
      id: 'j_reval_adj',
      voucherNumber: 'JV-REVAL-001',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'খামারের জমি ও অবকাঠামোর অনুমোদিত পুনর্মূল্যায়ন উদ্বৃত্ত (Revaluation Surplus)',
      lines: [
        { accountId: 'acc_1510', accountCode: '1510', accountName: 'জমি ও খামার প্রাঙ্গণ (Land & Premises)', debit: 50000, credit: 0 },
        { accountId: 'acc_3040', accountCode: '3040', accountName: 'সম্পদ পুনর্মূল্যায়ন উদ্বৃত্ত (Revaluation Surplus)', debit: 0, credit: 50000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-31T12:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Run Full NAV Reconciliation Service
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Running Complete NAV Reconciliation ---');

  const report: NavReconciliationReport = await runNavReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31'
    },
    dbInstance
  );

  console.log(`\nReconciliation Results Summary:`);
  console.log(`  Opening NAV: ৳${report.movement.openingNav} (Assets ৳${report.openingNavSnapshot.totalAssets} - Liabilities ৳${report.openingNavSnapshot.totalLiabilities})`);
  console.log(`  + Operating Result: ৳${report.movement.operatingResult}`);
  console.log(`  + Capital Contributions: ৳${report.movement.capitalContributions}`);
  console.log(`  - Capital Withdrawals: ৳${report.movement.capitalWithdrawals}`);
  console.log(`  + Approved Valuation Adjustments: ৳${report.movement.approvedValuationAdjustments}`);
  console.log(`  + Other Equity Movements: ৳${report.movement.otherEquityMovements}`);
  console.log(`  = Expected Closing NAV: ৳${report.movement.expectedClosingNav}`);
  console.log(`  Actual Closing NAV: ৳${report.movement.actualClosingNav} (Assets ৳${report.closingNavSnapshot.totalAssets} - Liabilities ৳${report.closingNavSnapshot.totalLiabilities})`);
  console.log(`  Discrepancy: ৳${report.movement.discrepancy}`);
  console.log(`  Is Reconciled: ${report.isReconciled}`);
  console.log(`  Formula: ${report.movement.formula}`);

  // Assertions for Primary NAV Definition: NAV = Assets - Liabilities
  assert(
    report.closingNavSnapshot.totalAssets === 510000,
    `Closing Assets = ৳510,000 (got ${report.closingNavSnapshot.totalAssets})`
  );
  assert(
    report.closingNavSnapshot.totalLiabilities === 50000,
    `Closing Liabilities = ৳50,000 (got ${report.closingNavSnapshot.totalLiabilities})`
  );
  assert(
    report.movement.actualClosingNav === 460000,
    `Closing NAV = Assets (৳510,000) - Liabilities (৳50,000) = ৳460,000 (got ${report.movement.actualClosingNav})`
  );

  // Assertions for NAV Movement Components
  assert(report.movement.openingNav === 250000, `Opening NAV = ৳250,000 (got ${report.movement.openingNav})`);
  assert(report.movement.operatingResult === 90000, `Operating Result = ৳90,000 (got ${report.movement.operatingResult})`);
  assert(report.movement.capitalContributions === 100000, `Capital Contributions = ৳100,000 (got ${report.movement.capitalContributions})`);
  assert(report.movement.capitalWithdrawals === 30000, `Capital Withdrawals = ৳30,000 (got ${report.movement.capitalWithdrawals})`);
  assert(report.movement.approvedValuationAdjustments === 50000, `Approved Valuation Adjustments = ৳50,000 (got ${report.movement.approvedValuationAdjustments})`);
  assert(report.movement.otherEquityMovements === 0, `Other Equity Movements = ৳0 (got ${report.movement.otherEquityMovements})`);
  assert(report.movement.expectedClosingNav === 460000, `Expected Closing NAV = ৳460,000 (got ${report.movement.expectedClosingNav})`);

  // Exact Mathematical Reconciliation Assertion
  assert(report.movement.discrepancy === 0, `NAV Discrepancy is exactly ৳0.00 (got ${report.movement.discrepancy})`);
  assert(report.isReconciled === true, 'NAV movement equation strictly reconciled without forcing');
  assert(report.discrepancies.length === 0, 'Zero discrepancies reported');

  // Verify Double-Entry Balance
  const trialBalance = await generateTrialBalance({ endDate: '2026-03-31' }, dbInstance);
  assert(trialBalance.isBalanced === true, `Trial balance strictly balanced: Total Debit ${trialBalance.totalDebit} === Total Credit ${trialBalance.totalCredit}`);

  // ---------------------------------------------------------------------------
  // STEP 4: Negative Verification — Inject Simulated Corruption & Detect Discrepancy
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Negative Test — Detecting Discrepancy from Unbacked Valuation Adjustment ---');

  // Simulate claiming an unbacked/artificial valuation adjustment of ৳25,000 without actual asset revaluation
  const corruptedReport = await runNavReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      approvedValuationAdjustments: 25000 // Claiming unbacked ৳25,000 adjustment
    },
    dbInstance
  );

  assert(corruptedReport.isReconciled === false, 'Corrupted NAV movement is correctly detected as NOT reconciled');
  assert(Math.abs(corruptedReport.movement.discrepancy) === 25000, `Exact discrepancy is detected: ৳${corruptedReport.movement.discrepancy}`);
  assert(corruptedReport.discrepancies.length > 0, 'Discrepancy message is generated with full diagnostic formula');

  // ---------------------------------------------------------------------------
  // STEP 5: Root Cause Repair & Final Re-Reconciliation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Root Cause Fix & Clean Re-Reconciliation ---');

  // Fixing the root cause: Removing unbacked adjustment so only legitimate movements are reconciled
  const cleanReport = await runNavReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      approvedValuationAdjustments: 0
    },
    dbInstance
  );

  assert(cleanReport.isReconciled === true, 'After root cause repair, NAV reconciliation is strictly TRUE');
  assert(cleanReport.movement.discrepancy === 0, 'Discrepancy is exactly ৳0.00 after repair');
  assert(cleanReport.discrepancies.length === 0, 'Zero discrepancies reported after repair');

  console.log('\n================================================================');
  console.log('FINAL TEST C SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestCNavReconciliation.ts') || process.argv[1]?.endsWith('testFinalTestCNavReconciliation.js')) {
  runFinalTestCNavReconciliation()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Test execution error:', err);
      process.exit(1);
    });
}
