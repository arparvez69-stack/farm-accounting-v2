import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  calculateParticipantProfitRetention,
  executeParticipantProfitSettlement,
  inspectParticipantProfitRetention
} from '../services/settlementService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 30 — Partial Reinvestment
 *
 * Requirements:
 * Implement or repair participant profit retention.
 *
 * Allow:
 * - 0% reinvest;
 * - 100% reinvest;
 * - any percentage between them.
 *
 * Example:
 * Profit = 100
 * Reinvest = 50%
 *
 * Expected:
 * Reinvested capital = 50
 * Withdrawable/settlement amount = 50
 *
 * Reinvestment must NOT create new revenue.
 * Withdrawal must NOT create operating expense.
 *
 * Test exactly.
 *
 * Return PASS.
 */
export async function runPrompt30PartialReinvestmentTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 30: PARTIAL REINVESTMENT & PROFIT RETENTION');
  console.log('Testing: Exact Example (Profit=100, Reinvest=50% -> Reinvested=50, Withdrawn=50),');
  console.log('Boundaries (0% and 100%), Arbitrary Percentages (between 0% and 100%),');
  console.log('GL Invariants: Reinvestment Creates ZERO Revenue, Withdrawal Creates ZERO Opex');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Test Exact Prompt Example
  // Profit = 100, Reinvest = 50%
  // Expected: Reinvested capital = 50, Withdrawable/settlement amount = 50
  // ===========================================================================
  console.log('--- Step 1: Exact Example Execution (Profit = 100, Reinvest = 50%) ---');

  const exactSplit = calculateParticipantProfitRetention({
    profit: 100,
    reinvestPercentage: 50
  });

  assert(exactSplit.profit === 100, 'Input profit is exactly ৳100');
  assert(exactSplit.reinvestPercentage === 50, 'Reinvestment percentage is exactly 50%');

  // CRITICAL REQUIREMENT: Expected Reinvested capital = 50
  assert(
    exactSplit.reinvestedCapital === 50,
    `CRITICAL REQUIREMENT: Reinvested capital is exactly ৳50 (got ৳${exactSplit.reinvestedCapital})`
  );

  // CRITICAL REQUIREMENT: Expected Withdrawable/settlement amount = 50
  assert(
    exactSplit.withdrawableAmount === 50,
    `CRITICAL REQUIREMENT: Withdrawable amount is exactly ৳50 (got ৳${exactSplit.withdrawableAmount})`
  );
  assert(
    exactSplit.settlementAmount === 50,
    `Settlement amount alias is exactly ৳50 (got ৳${exactSplit.settlementAmount})`
  );

  // Solvency invariant
  assert(
    exactSplit.reinvestedCapital + exactSplit.withdrawableAmount === 100,
    'Reinvested capital + Withdrawable amount exactly equals 100 (50 + 50 = 100)'
  );

  // ===========================================================================
  // STEP 2: Allow 0% Reinvestment Boundary
  // ===========================================================================
  console.log('\n--- Step 2: Boundary Test: 0% Reinvestment ---');

  const zeroSplit = calculateParticipantProfitRetention({
    profit: 100,
    reinvestPercentage: 0
  });

  assert(
    zeroSplit.reinvestedCapital === 0,
    '0% reinvestment: Reinvested capital is ৳0'
  );
  assert(
    zeroSplit.withdrawableAmount === 100,
    '0% reinvestment: Withdrawable/settlement amount is ৳100 (100% payout)'
  );
  assert(zeroSplit.zeroPercentAllowed === true, '0% reinvestment flag is allowed');

  // ===========================================================================
  // STEP 3: Allow 100% Reinvestment Boundary
  // ===========================================================================
  console.log('\n--- Step 3: Boundary Test: 100% Reinvestment ---');

  const hundredSplit = calculateParticipantProfitRetention({
    profit: 100,
    reinvestPercentage: 100
  });

  assert(
    hundredSplit.reinvestedCapital === 100,
    '100% reinvestment: Reinvested capital is ৳100 (100% capitalization)'
  );
  assert(
    hundredSplit.withdrawableAmount === 0,
    '100% reinvestment: Withdrawable/settlement amount is ৳0'
  );
  assert(hundredSplit.hundredPercentAllowed === true, '100% reinvestment flag is allowed');

  // ===========================================================================
  // STEP 4: Allow Any Percentage Between 0% and 100%
  // ===========================================================================
  console.log('\n--- Step 4: Arbitrary Percentages Between 0% and 100% ---');

  // Test 25%
  const split25 = calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: 25 });
  assert(split25.reinvestedCapital === 25, '25% reinvest: Reinvested capital = ৳25');
  assert(split25.withdrawableAmount === 75, '25% reinvest: Withdrawable amount = ৳75');

  // Test 33.33%
  const split33 = calculateParticipantProfitRetention({ profit: 300, reinvestPercentage: 33.33 });
  assert(split33.reinvestedCapital === 99.99, '33.33% reinvest of 300: Reinvested capital = ৳99.99');
  assert(split33.withdrawableAmount === 200.01, '33.33% reinvest of 300: Withdrawable amount = ৳200.01');

  // Test 70%
  const split70 = calculateParticipantProfitRetention({ profit: 150, reinvestPercentage: 70 });
  assert(split70.reinvestedCapital === 105, '70% reinvest of 150: Reinvested capital = ৳105');
  assert(split70.withdrawableAmount === 45, '70% reinvest of 150: Withdrawable amount = ৳45');

  // Test 80%
  const split80 = calculateParticipantProfitRetention({ profit: 200, reinvestPercentage: 80 });
  assert(split80.reinvestedCapital === 160, '80% reinvest of 200: Reinvested capital = ৳160');
  assert(split80.withdrawableAmount === 40, '80% reinvest of 200: Withdrawable amount = ৳40');

  // Negative test: percentage < 0% or > 100% rejected
  let invalidUnder = false;
  try {
    calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: -5 });
  } catch (err: any) {
    invalidUnder = true;
    assert(err.message.includes('০% থেকে ১০০%'), 'Negative percentage correctly rejected');
  }
  assert(invalidUnder, 'Percentage < 0% is strictly rejected');

  let invalidOver = false;
  try {
    calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: 105 });
  } catch (err: any) {
    invalidOver = true;
    assert(err.message.includes('০% থেকে ১০০%'), 'Percentage > 100% correctly rejected');
  }
  assert(invalidOver, 'Percentage > 100% is strictly rejected');

  // ===========================================================================
  // STEP 5: General Ledger Accounting Engine Execution & Invariant Verification
  // "Reinvestment must NOT create new revenue."
  // "Withdrawal must NOT create operating expense."
  // ===========================================================================
  console.log('\n--- Step 5: GL Audit: Reinvestment NO Revenue, Withdrawal NO Opex ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_main_p30';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Agrani Bank Main Farm Account',
    accountType: 'BANK',
    currentBalance: 50000,
    synced: false
  });

  const investorId = 'inv_p30_A';
  await mDb.investors.put({
    id: investorId,
    name: 'Tariqul Islam',
    phone: '01711999999',
    totalInvestment: 100,
    currentCapital: 100,
    profitPayable: 100, // ৳100 profit earned and payable
    joinedDate: '2026-01-01',
    status: 'ACTIVE',
    isActive: true
  });

  // Post Initial Capital & Profit Allocation Journal Entries in GL
  // Initial Capital: Dr 1030 Bank 100 | Cr 3020 Investor Capital 100
  await postJournalEntry(
    {
      id: 'j_p30_init_cap',
      voucherNumber: 'JRN-P30-001',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'Initial capital deposit Tariqul (৳100)',
      relatedPerson: investorId,
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100 }
      ],
      createdBy: 'auditor_prompt30',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  // Profit Allocation: Dr 3070 Profit Distribution 100 | Cr 2050 Profit Payable 100
  await postJournalEntry(
    {
      id: 'j_p30_alloc',
      voucherNumber: 'JRN-P30-002',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Allocated profit appropriation (৳100)',
      relatedPerson: investorId,
      lines: [
        { accountCode: '3070', accountName: 'মুনাফা বণ্টন', debit: 100, credit: 0 },
        { accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয়', debit: 0, credit: 100 }
      ],
      createdBy: 'auditor_prompt30',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  // 1. Capture Pre-Settlement P&L
  const prePnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
  assert(prePnl.totalRevenue === 0, 'Pre-settlement: Total revenue is ৳0');
  assert(prePnl.totalOperatingExpenses === 0, 'Pre-settlement: Total operating expenses is ৳0');
  assert(prePnl.netProfit === 0, 'Pre-settlement: Net operating profit is ৳0');

  // 2. Execute Participant Profit Settlement: Profit = 100, Reinvest = 50%
  const settlementResult = await executeParticipantProfitSettlement(
    {
      investorId,
      profit: 100,
      reinvestPercentage: 50,
      bankAccountId: bankAccId,
      date: '2026-04-01',
      currentUserId: 'auditor_prompt30'
    },
    mDb
  );

  assert(settlementResult.passed === true, 'executeParticipantProfitSettlement returned passed === true');
  assert(settlementResult.reinvestedCapital === 50, 'Settlement executed reinvested capital: ৳50');
  assert(settlementResult.withdrawableAmount === 50, 'Settlement executed withdrawable amount: ৳50');

  // 3. Capture Post-Settlement P&L
  const postPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-02' }, undefined, mDb);

  // CRITICAL REQUIREMENT: Reinvestment must NOT create new revenue
  assert(
    postPnl.totalRevenue === prePnl.totalRevenue,
    `CRITICAL REQUIREMENT: Reinvestment did NOT create new revenue! Total revenue remains ৳${postPnl.totalRevenue} (Pre: ${prePnl.totalRevenue})`
  );
  assert(
    postPnl.totalRevenue === 0,
    'Total revenue is strictly ৳0 after 50% reinvestment'
  );

  // CRITICAL REQUIREMENT: Withdrawal must NOT create operating expense
  assert(
    postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses,
    `CRITICAL REQUIREMENT: Withdrawal did NOT create operating expense! Total operating expenses remains ৳${postPnl.totalOperatingExpenses} (Pre: ${prePnl.totalOperatingExpenses})`
  );
  assert(
    postPnl.totalOperatingExpenses === 0,
    'Total operating expenses is strictly ৳0 after 50% cash withdrawal'
  );

  // Net Profit unimpacted
  assert(
    postPnl.netProfit === prePnl.netProfit,
    'Net operating profit is completely unaltered (0 P&L impact)'
  );

  // 4. Verify Balance Sheet / General Ledger Balances
  const updatedInvestor = await mDb.investors.get(investorId);
  assert(
    updatedInvestor.currentCapital === 150,
    `Investor capital increased by exact reinvestment: 100 + 50 = ৳150 (got ৳${updatedInvestor.currentCapital})`
  );
  assert(
    updatedInvestor.profitPayable === 0,
    `Investor profit payable reduced by 100 (50 reinvested + 50 withdrawn): remains ৳0 (got ৳${updatedInvestor.profitPayable})`
  );

  const updatedBank = await mDb.cashBankAccounts.get(bankAccId);
  assert(
    updatedBank.currentBalance === 49950,
    `Bank balance decreased by exact withdrawal: 50,000 - 50 = ৳49,950 (got ৳${updatedBank.currentBalance})`
  );

  // 5. Verify Trial Balance Integrity
  const tb = await generateTrialBalance({ endDate: '2026-04-02' }, mDb);
  assert(tb.isBalanced === true, 'Trial balance is balanced (Debits === Credits)');
  assert(tb.totalDebit === tb.totalCredit, `Trial balance total debits (৳${tb.totalDebit}) === credits (৳${tb.totalCredit})`);

  // ===========================================================================
  // STEP 6: Run Comprehensive inspectParticipantProfitRetention Suite
  // ===========================================================================
  console.log('\n--- Step 6: Comprehensive inspectParticipantProfitRetention Suite ---');

  const inspection = await inspectParticipantProfitRetention({
    profit: 100,
    reinvestPercentage: 50,
    dbInstance: mDb
  });

  assert(inspection.passed === true, 'inspectParticipantProfitRetention passed === true');
  assert(inspection.exactExampleVerified === true, 'Inspection: exactExampleVerified === true (50 / 50)');
  assert(inspection.zeroPercentAllowed === true, 'Inspection: zeroPercentAllowed === true');
  assert(inspection.hundredPercentAllowed === true, 'Inspection: hundredPercentAllowed === true');
  assert(inspection.arbitraryPercentAllowed === true, 'Inspection: arbitraryPercentAllowed === true');
  assert(inspection.reinvestmentCreatedRevenue === false, 'Inspection: reinvestmentCreatedRevenue === false');
  assert(inspection.withdrawalCreatedOperatingExpense === false, 'Inspection: withdrawalCreatedOperatingExpense === false');
  assert(inspection.pnlUnaffected === true, 'Inspection: pnlUnaffected === true');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 30 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt30PartialReinvestmentTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 30 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 30 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 30 tests:', err);
      process.exit(1);
    });
}
