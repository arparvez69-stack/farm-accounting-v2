import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry, generateTrialBalance, generateProfitLoss } from '../accounting/accountingEngine';
import { runCompleteProfitReconciliation } from '../services/profitReconciliationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST B — Profit Reconciliation
 *
 * Requirements:
 * Run the final profit reconciliation.
 *
 * Verify:
 *   Total Investor Profit
 *   + Total Mudarib Profit
 *   = Total Distributable Profit
 *
 * Test with multiple investors having different contractual percentages.
 * Do not assume percentages must total 100%.
 * Verify the accounting P&L itself is unchanged by profit appropriation.
 * Return PASS.
 */
export async function runFinalTestBProfitReconciliation(): Promise<AssertionResult> {
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
  console.log('FINAL TEST B — PROFIT RECONCILIATION');
  console.log('Verifying Core Invariant:');
  console.log('  Total Investor Profit + Total Mudarib Profit = Total Distributable Profit');
  console.log('Multiple Investors with Independent Contractual Percentages (NOT totaling 100%)');
  console.log('Accounting P&L Statement Invariance Verification');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  // Populate canonical Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Real Operating Revenues & Expenses to Generate Net Profit
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Posting Operating Business Revenues & Expenses ---');

  // Initial Bank Balance & Capital: ৳500,000
  await postJournalEntry(
    {
      id: 'j_init_bank',
      voucherNumber: 'JV-INIT-BANK',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'Initial Farm Bank Balance',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 500000, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 500000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-01T09:00:00Z'
    },
    { dbInstance }
  );

  // Operating Revenue 1: Goat Sales (Account 4010) = ৳150,000
  await postJournalEntry(
    {
      id: 'j_op_rev_1',
      voucherNumber: 'SV-2026-001',
      voucherType: 'RECEIPT',
      date: '2026-01-15',
      narration: 'ছাগল ও খাসি বিক্রয় আয় (Goat Sales Revenue)',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 150000, credit: 0 },
        { accountId: 'acc_4010', accountCode: '4010', accountName: 'ছাগল বিক্রয় (Goat Sales)', debit: 0, credit: 150000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-15T10:00:00Z'
    },
    { dbInstance }
  );

  // Operating Revenue 2: Fish Sales (Account 4020) = ৳50,000
  await postJournalEntry(
    {
      id: 'j_op_rev_2',
      voucherNumber: 'SV-2026-002',
      voucherType: 'RECEIPT',
      date: '2026-02-10',
      narration: 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 50000, credit: 0 },
        { accountId: 'acc_4020', accountCode: '4020', accountName: 'মাছ বিক্রয় (Fish Sales)', debit: 0, credit: 50000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-10T10:00:00Z'
    },
    { dbInstance }
  );
  // Total Operating Revenue = 150,000 + 50,000 = ৳200,000

  // Operating Expense 1: Animal Feed Cost (Account 5010) = ৳50,000
  await postJournalEntry(
    {
      id: 'j_op_exp_1',
      voucherNumber: 'PV-2026-001',
      voucherType: 'PAYMENT',
      date: '2026-01-20',
      narration: 'দানাদার ও ঘাস ক্রয় ব্যয় (Animal Feed Cost)',
      lines: [
        { accountId: 'acc_5010', accountCode: '5010', accountName: 'পশু খাদ্য খরচ (Feed Cost)', debit: 50000, credit: 0 },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 50000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-20T11:00:00Z'
    },
    { dbInstance }
  );

  // Operating Expense 2: Veterinary Care Cost (Account 5020) = ৳30,000
  await postJournalEntry(
    {
      id: 'j_op_exp_2',
      voucherNumber: 'PV-2026-002',
      voucherType: 'PAYMENT',
      date: '2026-02-15',
      narration: 'ভ্যাকসিন ও চিকিৎসা খরচ (Veterinary Cost)',
      lines: [
        { accountId: 'acc_5020', accountCode: '5020', accountName: 'চিকিৎসা ও ওষুধ খরচ', debit: 30000, credit: 0 },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 30000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-15T11:00:00Z'
    },
    { dbInstance }
  );
  // Total Operating Expenses = 50,000 + 30,000 = ৳80,000
  // Net Operating Profit = 200,000 - 80,000 = ৳120,000

  function getTotalExpenses(pnl: any): number {
    return Math.round(((pnl.totalCogs || 0) + (pnl.totalOperatingExpenses || 0) + (pnl.totalOtherExpenses || 0)) * 100) / 100;
  }

  // Verify baseline P&L
  const baselinePnL = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, dbInstance);
  assert(baselinePnL.totalRevenue === 200000, `Baseline Operating Revenue = ৳200,000 (got ${baselinePnL.totalRevenue})`);
  assert(getTotalExpenses(baselinePnL) === 80000, `Baseline Operating Expenses = ৳80,000 (got ${getTotalExpenses(baselinePnL)})`);
  assert(baselinePnL.netProfit === 120000, `Baseline Net Operating Profit = ৳120,000 (got ${baselinePnL.netProfit})`);

  // ---------------------------------------------------------------------------
  // STEP 2: Configure 3 Investors with Independent Contractual Percentages
  // Percentages: 40%, 25%, 50% -> Sum = 115% (Strictly NOT 100%!)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Setting Up 3 Investors with Independent Contractual Rates ---');
  console.log('Contractual Percentages: 40% (A), 25% (B), 50% (C) -> Sum = 115% (!== 100%)\n');

  const participants = [
    {
      id: 'inv_A',
      name: 'Investor A (Al-Amin)',
      capital: 100000, // 1/6 of total 600k capital
      contractualPercentage: 40 // 40% investor, 60% mudarib
    },
    {
      id: 'inv_B',
      name: 'Investor B (Fatima)',
      capital: 200000, // 2/6 = 1/3 of total 600k capital
      contractualPercentage: 25 // 25% investor, 75% mudarib
    },
    {
      id: 'inv_C',
      name: 'Investor C (Kamal)',
      capital: 300000, // 3/6 = 1/2 of total 600k capital
      contractualPercentage: 50 // 50% investor, 50% mudarib
    }
  ];

  // Distributable Profit is exactly the Net Operating Profit: ৳120,000
  const distributableProfit = 120000;

  // ---------------------------------------------------------------------------
  // STEP 3: Run Complete Profit Reconciliation
  // ---------------------------------------------------------------------------
  console.log('--- Step 3: Executing Profit Reconciliation Service ---');

  const report = await runCompleteProfitReconciliation(
    {
      distributableProfit,
      participants,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      postAppropriationToLedger: true
    },
    dbInstance
  );

  console.log(`\nReconciliation Results:`);
  console.log(`  Total Distributable Profit: ৳${report.distributableProfit}`);
  console.log(`  Total Investor Profit: ৳${report.totalInvestorProfit}`);
  console.log(`  Total Mudarib Profit: ৳${report.totalMudaribProfit}`);
  console.log(`  Sum (Investor + Mudarib): ৳${report.sumInvestorPlusMudarib}`);
  console.log(`  Profit Difference: ৳${report.profitDifference}`);
  console.log(`  Contractual Percentages Sum: ${report.contractualPercentagesSum}% (Does sum to 100%: ${report.doesPercentagesSumTo100})`);
  console.log(`  Is Profit Equation Reconciled: ${report.isProfitEquationReconciled}`);
  console.log(`  Pre-Appropriation Net Profit: ৳${report.preAppropriationPnL.netProfit}`);
  console.log(`  Post-Appropriation Net Profit: ৳${report.postAppropriationPnL.netProfit}`);
  console.log(`  Is P&L Unchanged: ${report.isPnLUnchanged}`);

  // Assertions for Invariant 1: Total Investor Profit + Total Mudarib Profit = Total Distributable Profit
  assert(report.totalInvestorProfit === 48000, `Total Investor Profit = ৳48,000 (got ${report.totalInvestorProfit})`);
  assert(report.totalMudaribProfit === 72000, `Total Mudarib Profit = ৳72,000 (got ${report.totalMudaribProfit})`);
  assert(
    report.sumInvestorPlusMudarib === 120000,
    `Investor Profit (৳48,000) + Mudarib Profit (৳72,000) = ৳120,000 (got ${report.sumInvestorPlusMudarib})`
  );
  assert(report.profitDifference === 0, `Difference between sum and distributable profit is exactly ৳0.00 (got ${report.profitDifference})`);
  assert(report.isProfitEquationReconciled === true, 'Profit reconciliation equation strictly holds');

  // Assertions for Invariant 2: Percentages do NOT need to sum to 100%
  assert(report.contractualPercentagesSum === 115, `Contractual percentages sum to 115% (got ${report.contractualPercentagesSum}%)`);
  assert(report.doesPercentagesSumTo100 === false, 'Verification confirmed: Percentages are NOT assumed to total 100%');

  // Verify Detailed Breakdown for Participant A
  const pA = report.participants.find((p) => p.participantId === 'inv_A');
  assert(Boolean(pA), 'Participant A exists in breakdown');
  if (pA) {
    assert(pA.allocatedEconomicProfit === 20000, `A Economic Allocation (1/6 of 120k) = ৳20,000 (got ${pA.allocatedEconomicProfit})`);
    assert(pA.investorProfit === 8000, `A Investor Profit (40% of 20k) = ৳8,000 (got ${pA.investorProfit})`);
    assert(pA.mudaribProfit === 12000, `A Mudarib Share (60% of 20k) = ৳12,000 (got ${pA.mudaribProfit})`);
    assert(pA.investorProfit + pA.mudaribProfit === pA.allocatedEconomicProfit, 'A: Investor + Mudarib === Economic Allocation');
  }

  // Verify Detailed Breakdown for Participant B
  const pB = report.participants.find((p) => p.participantId === 'inv_B');
  assert(Boolean(pB), 'Participant B exists in breakdown');
  if (pB) {
    assert(pB.allocatedEconomicProfit === 40000, `B Economic Allocation (1/3 of 120k) = ৳40,000 (got ${pB.allocatedEconomicProfit})`);
    assert(pB.investorProfit === 10000, `B Investor Profit (25% of 40k) = ৳10,000 (got ${pB.investorProfit})`);
    assert(pB.mudaribProfit === 30000, `B Mudarib Share (75% of 40k) = ৳30,000 (got ${pB.mudaribProfit})`);
    assert(pB.investorProfit + pB.mudaribProfit === pB.allocatedEconomicProfit, 'B: Investor + Mudarib === Economic Allocation');
  }

  // Verify Detailed Breakdown for Participant C
  const pC = report.participants.find((p) => p.participantId === 'inv_C');
  assert(Boolean(pC), 'Participant C exists in breakdown');
  if (pC) {
    assert(pC.allocatedEconomicProfit === 60000, `C Economic Allocation (1/2 of 120k) = ৳60,000 (got ${pC.allocatedEconomicProfit})`);
    assert(pC.investorProfit === 30000, `C Investor Profit (50% of 60k) = ৳30,000 (got ${pC.investorProfit})`);
    assert(pC.mudaribProfit === 30000, `C Mudarib Share (50% of 60k) = ৳30,000 (got ${pC.mudaribProfit})`);
    assert(pC.investorProfit + pC.mudaribProfit === pC.allocatedEconomicProfit, 'C: Investor + Mudarib === Economic Allocation');
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Accounting P&L Statement Invariance
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Accounting P&L Itself is Unchanged by Profit Appropriation ---');

  const finalPnL = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, dbInstance);

  assert(
    finalPnL.totalRevenue === baselinePnL.totalRevenue,
    `Post-appropriation Operating Revenue (৳${finalPnL.totalRevenue}) strictly equals Pre-appropriation Operating Revenue (৳${baselinePnL.totalRevenue})`
  );
  assert(
    getTotalExpenses(finalPnL) === getTotalExpenses(baselinePnL),
    `Post-appropriation Operating Expenses (৳${getTotalExpenses(finalPnL)}) strictly equals Pre-appropriation Operating Expenses (৳${getTotalExpenses(baselinePnL)})`
  );
  assert(
    finalPnL.netProfit === baselinePnL.netProfit,
    `Post-appropriation Net Profit (৳${finalPnL.netProfit}) strictly equals Pre-appropriation Net Profit (৳${baselinePnL.netProfit})`
  );
  assert(report.isPnLUnchanged === true, 'P&L invariance flag is strictly TRUE');
  assert(report.pnlNetProfitDifference === 0, 'P&L net profit difference is exactly ৳0.00');

  // Verify Double-Entry Balance
  const trialBalance = await generateTrialBalance({ endDate: '2026-03-31' }, dbInstance);
  assert(trialBalance.isBalanced === true, `Trial balance remains strictly balanced after profit appropriation: Total Debit ${trialBalance.totalDebit} === Total Credit ${trialBalance.totalCredit}`);

  // ---------------------------------------------------------------------------
  // STEP 5: Second Test Case — Percentages Summing to Less Than 100% (e.g. 30% + 35% = 65%)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Test Case 2 — Multiple Investors with Contractual Rates Summing to 65% (< 100%) ---');

  const reportCase2 = await runCompleteProfitReconciliation(
    {
      distributableProfit: 90000,
      participants: [
        { id: 'p_x', name: 'Partner X', capital: 100000, contractualPercentage: 30 },
        { id: 'p_y', name: 'Partner Y', capital: 200000, contractualPercentage: 35 }
      ],
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      postAppropriationToLedger: false
    },
    dbInstance
  );

  assert(reportCase2.contractualPercentagesSum === 65, `Case 2 Contractual percentages sum to 65% (< 100%) (got ${reportCase2.contractualPercentagesSum}%)`);
  assert(reportCase2.doesPercentagesSumTo100 === false, 'Case 2 confirmed: Percentages do not sum to 100%');
  assert(
    reportCase2.sumInvestorPlusMudarib === 90000,
    `Case 2: Total Investor Profit (৳${reportCase2.totalInvestorProfit}) + Total Mudarib Profit (৳${reportCase2.totalMudaribProfit}) = ৳90,000 (Distributable Profit)`
  );
  assert(reportCase2.isProfitEquationReconciled === true, 'Case 2: Profit equation strictly reconciled');

  // ---------------------------------------------------------------------------
  // STEP 6: Negative Test — Detect Violation if P&L is Wrongly Mutated
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Negative Test — Detecting Illegal P&L Mutation by Appropriation ---');

  // Simulate an invalid appropriation that wrongly books to an expense account (e.g. 5030)
  await postJournalEntry(
    {
      id: 'j_illegal_pnl_mutation',
      voucherNumber: 'JV-ILLEGAL',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Illegal profit distribution booked to operational expense',
      lines: [
        { accountId: 'acc_5030', accountCode: '5030', accountName: 'অন্যান্য খামার ব্যয়', debit: 10000, credit: 0 },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 0, credit: 10000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-31T23:59:59Z'
    },
    { dbInstance }
  );

  const corruptedPnL = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, dbInstance);
  const pnlCorrupted = corruptedPnL.netProfit !== baselinePnL.netProfit;
  assert(pnlCorrupted === true, 'Engine detects that booking distribution to operational expense illegally alters P&L net profit');

  // Reverse illegal entry to clean state
  await postJournalEntry(
    {
      id: 'j_illegal_reversal',
      voucherNumber: 'JV-REVERSAL',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Reversal of illegal profit appropriation expense',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 10000, credit: 0 },
        { accountId: 'acc_5030', accountCode: '5030', accountName: 'অন্যান্য খামার ব্যয়', debit: 0, credit: 10000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-31T23:59:59Z'
    },
    { dbInstance }
  );

  const restoredPnL = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, dbInstance);
  assert(
    restoredPnL.netProfit === baselinePnL.netProfit,
    `After clean reversal, Net Operating Profit is restored to exact ৳${baselinePnL.netProfit}`
  );

  console.log('\n================================================================');
  console.log('FINAL TEST B SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestBProfitReconciliation.ts') || process.argv[1]?.endsWith('testFinalTestBProfitReconciliation.js')) {
  runFinalTestBProfitReconciliation()
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
