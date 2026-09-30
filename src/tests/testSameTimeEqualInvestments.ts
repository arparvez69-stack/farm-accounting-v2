import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  calculateCapitalParticipationAllocation,
  executeCapitalParticipationAllocation,
  clearValuationEventsForTest,
  clearAdmissionAuditsForTest
} from '../services/valuationService';
import {
  executeInvestorTransaction,
  executeFinalizedBusinessProfitAllocationToInvestors
} from '../services/transactionService';
import {
  generateProfitLoss,
  generateTrialBalance,
  postJournalEntry
} from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 12: SAME-TIME EQUAL INVESTMENTS REGRESSION SUITE
 *
 * Exact Scenario:
 * - Investor A invests ৳100.
 * - Investor B invests ৳100.
 * - Both enter at the same time.
 * - Both have 40% contractual investor profit share.
 * - Applicable business profit = ৳100.
 *
 * Expected economic allocation:
 * - A = ৳50 attributable profit.
 * - B = ৳50 attributable profit.
 *
 * Investor distribution:
 * - A = ৳20.
 * - B = ৳20.
 * - Working partner share = ৳60.
 *
 * MUST NOT produce:
 * - A = ৳40.
 * - B = ৳40.
 * - Working partner share = ৳20.
 */
export async function runSameTimeEqualInvestmentsTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 12: SAME-TIME EQUAL INVESTMENTS TEST');
  console.log('Scenario: A=৳100, B=৳100, Same-Time, Contract=40%, Profit=৳100');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  clearAdmissionAuditsForTest();

  const testUserId = 'test_owner_p12';

  // ---------------------------------------------------------------------------
  // STEP 1: Direct Pure Engine Economic Participation Calculation Test
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Engine Calculation for Same-Time Equal Investments ---');
  {
    const businessProfit = 100;
    const tranches = [
      {
        id: 'tranche_A',
        trancheNumber: 'TR-A',
        investorId: 'inv_A',
        investorName: 'Investor A',
        investmentAmount: 100,
        contractualProfitSharePercentage: 40,
        status: 'ACTIVE'
      },
      {
        id: 'tranche_B',
        trancheNumber: 'TR-B',
        investorId: 'inv_B',
        investorName: 'Investor B',
        investmentAmount: 100,
        contractualProfitSharePercentage: 40,
        status: 'ACTIVE'
      }
    ];

    const calc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: businessProfit,
      tranches
    });

    const allocA = calc.trancheAllocations.find((t) => t.investorId === 'inv_A')!;
    const allocB = calc.trancheAllocations.find((t) => t.investorId === 'inv_B')!;

    // 1. Expected economic allocation: A = ৳50, B = ৳50
    assert(
      allocA.applicableBusinessProfit === 50,
      `Investor A attributable economic profit is strictly ৳50 (50% of ৳100)`
    );
    assert(
      allocB.applicableBusinessProfit === 50,
      `Investor B attributable economic profit is strictly ৳50 (50% of ৳100)`
    );

    // 2. Expected investor distribution: A = ৳20, B = ৳20
    assert(
      allocA.investorProfitShare === 20,
      `Investor A distribution is strictly ৳20 (40% of ৳50 attributable profit)`
    );
    assert(
      allocB.investorProfitShare === 20,
      `Investor B distribution is strictly ৳20 (40% of ৳50 attributable profit)`
    );

    // 3. Expected working partner share = ৳60
    assert(
      calc.totalWorkingPartnerEarnings === 60,
      `Working partner share is strictly ৳60 (30 from A + 30 from B)`
    );
    assert(
      allocA.workingPartnerProfitShare === 30,
      `Working partner share from Investor A slice is ৳30 (60% of ৳50)`
    );
    assert(
      allocB.workingPartnerProfitShare === 30,
      `Working partner share from Investor B slice is ৳30 (60% of ৳50)`
    );

    // 4. NEGATIVE ASSERTIONS: The system MUST NOT produce A = ৳40, B = ৳40
    assert(
      allocA.investorProfitShare !== 40,
      `NEGATIVE ASSERTION CONFIRMED: Investor A distribution is NOT ৳40`
    );
    assert(
      allocB.investorProfitShare !== 40,
      `NEGATIVE ASSERTION CONFIRMED: Investor B distribution is NOT ৳40`
    );
    assert(
      calc.totalWorkingPartnerEarnings !== 20,
      `NEGATIVE ASSERTION CONFIRMED: Working partner share is NOT ৳20`
    );

    // 5. Total reconciliation
    assert(
      allocA.investorProfitShare + allocB.investorProfitShare + calc.totalWorkingPartnerEarnings === businessProfit,
      `Full mathematical reconciliation: ৳20 + ৳20 + ৳60 === ৳100 (100% of profit)`
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Database End-to-End Execution with Double-Entry GL Ledger
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Database & GL Execution of Same-Time Equal Investments ---');
  {
    const mDb = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await mDb.accounts.put(acc);
    }

    await mDb.cashBankAccounts.put({
      id: 'cash_main_p12',
      accountName: 'Main Cash Drawer',
      name: 'Main Cash Drawer',
      accountType: 'CASH',
      currentBalance: 100000,
      synced: false
    });

    // Investor A invests ৳100 at time 2026-01-01
    const resA = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01911000001',
        contribution: 100,
        profitSharingRatio: 40, // 40% contract
        targetAccountId: 'cash_main_p12',
        currentUserId: testUserId,
        date: '2026-01-01',
        notes: 'Prompt 12 Investor A ৳100 investment'
      },
      mDb
    );

    // Investor B invests ৳100 at the same time 2026-01-01
    const resB = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01911000002',
        contribution: 100,
        profitSharingRatio: 40, // 40% contract
        targetAccountId: 'cash_main_p12',
        currentUserId: testUserId,
        date: '2026-01-01',
        notes: 'Prompt 12 Investor B ৳100 investment'
      },
      mDb
    );

    assert(Boolean(resA.investor.id && resB.investor.id), 'Both Investor A and Investor B created in database');

    // Post farm revenue producing net operating profit = ৳100
    // Dr Cash ৳100 | Cr Fish Revenue ৳100
    await postJournalEntry(
      {
        id: 'j_p12_profit',
        voucherNumber: 'V-PROFIT-P12',
        voucherType: 'RECEIPT',
        date: '2026-03-31',
        narration: 'Prompt 12 Farm Revenue',
        lines: [
          { accountCode: '1010', accountName: 'নগদ তহবিল', debit: 100, credit: 0 },
          { accountCode: '4010', accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 100 }
        ],
        createdBy: testUserId,
        createdAt: '2026-03-31T12:00:00.000Z'
      },
      { dbInstance: mDb }
    );

    const periodPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
    assert(periodPnl.netProfit === 100, 'Baseline Farm Operating Profit is strictly ৳100');

    // Execute Capital Participation Allocation
    const execRes = await executeCapitalParticipationAllocation(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        finalizedBusinessProfit: 100,
        responsibleUser: testUserId,
        notes: 'Prompt 12 Equal Investment Profit Allocation'
      },
      mDb
    );

    const allocA = execRes.trancheAllocations.find((t) => t.investorId === resA.investor.id)!;
    const allocB = execRes.trancheAllocations.find((t) => t.investorId === resB.investor.id)!;

    assert(allocA.applicableBusinessProfit === 50, 'DB Execution: Investor A attributable profit = ৳50');
    assert(allocB.applicableBusinessProfit === 50, 'DB Execution: Investor B attributable profit = ৳50');
    assert(allocA.investorProfitShare === 20, 'DB Execution: Investor A distribution = ৳20');
    assert(allocB.investorProfitShare === 20, 'DB Execution: Investor B distribution = ৳20');
    assert(execRes.totalWorkingPartnerEarnings === 60, 'DB Execution: Working partner share = ৳60');
    assert(allocA.investorProfitShare !== 40 && allocB.investorProfitShare !== 40, 'DB Execution: Neither investor received ৳40');

    // Verify GL entries posted correctly: Dr 3070 / Cr 2050
    const allJournals = await mDb.journalEntries.toArray();
    const allocJournals = allJournals.filter((j: any) => j.reference?.startsWith('ALLOC-CAP-'));
    assert(allocJournals.length === 2, 'Exactly 2 allocation journal entries created in database');

    const invAJournal = allocJournals.find((j: any) => j.investorId === resA.investor.id);
    const invBJournal = allocJournals.find((j: any) => j.investorId === resB.investor.id);

    assert(invAJournal !== undefined && invBJournal !== undefined, 'Journal entries found for both Investor A and Investor B');

    const lineADr = invAJournal?.lines.find((l: any) => l.debit > 0);
    const lineACr = invAJournal?.lines.find((l: any) => l.credit > 0);
    assert(lineADr?.accountCode === '3070' && lineADr?.debit === 20, 'Investor A GL debit is ৳20 to Account 3070 (Profit Distribution)');
    assert(lineACr?.accountCode === '2050' && lineACr?.credit === 20, 'Investor A GL credit is ৳20 to Account 2050 (Investor Profit Payable)');

    const lineBDr = invBJournal?.lines.find((l: any) => l.debit > 0);
    const lineBCr = invBJournal?.lines.find((l: any) => l.credit > 0);
    assert(lineBDr?.accountCode === '3070' && lineBDr?.debit === 20, 'Investor B GL debit is ৳20 to Account 3070 (Profit Distribution)');
    assert(lineBCr?.accountCode === '2050' && lineBCr?.credit === 20, 'Investor B GL credit is ৳20 to Account 2050 (Investor Profit Payable)');

    // Verify Investor records in database updated with profitPayable = 20
    const invAInDb = await mDb.investors.get(resA.investor.id);
    const invBInDb = await mDb.investors.get(resB.investor.id);

    assert(invAInDb?.profitPayable === 20, 'Investor A profitPayable in database is updated to ৳20 (NOT ৳40)');
    assert(invBInDb?.profitPayable === 20, 'Investor B profitPayable in database is updated to ৳20 (NOT ৳40)');
    assert(invAInDb?.totalProfitAllocated === 20, 'Investor A totalProfitAllocated is ৳20');
    assert(invBInDb?.totalProfitAllocated === 20, 'Investor B totalProfitAllocated is ৳20');

    // Verify Trial Balance post-allocation
    const tb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
    assert(tb.isBalanced, 'Trial Balance remains strictly balanced');
    assert(Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, 'Trial Balance difference is zero');

    // Verify Operating P&L is 100% untouched
    const postPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
    assert(postPnl.netProfit === periodPnl.netProfit, 'Net Operating Profit is 100% untouched by allocation (৳100)');
    assert(postPnl.totalRevenue === periodPnl.totalRevenue, 'Revenue is 100% untouched (৳100)');
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Verification via executeFinalizedBusinessProfitAllocationToInvestors
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verification via executeFinalizedBusinessProfitAllocationToInvestors ---');
  {
    const mDb = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await mDb.accounts.put(acc);
    }

    await mDb.cashBankAccounts.put({
      id: 'cash_main_step3',
      accountName: 'Main Cash Drawer',
      name: 'Main Cash Drawer',
      accountType: 'CASH',
      currentBalance: 100000,
      synced: false
    });

    const invARes = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01911000011',
        contribution: 100,
        profitSharingRatio: 40,
        targetAccountId: 'cash_main_step3',
        currentUserId: testUserId,
        date: '2026-01-01'
      },
      mDb
    );

    const invBRes = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01911000012',
        contribution: 100,
        profitSharingRatio: 40,
        targetAccountId: 'cash_main_step3',
        currentUserId: testUserId,
        date: '2026-01-01'
      },
      mDb
    );

    await postJournalEntry(
      {
        id: 'j_p12_step3_profit',
        voucherNumber: 'V-PROFIT-P12-S3',
        voucherType: 'RECEIPT',
        date: '2026-03-31',
        narration: 'Prompt 12 Farm Revenue Step 3',
        lines: [
          { accountCode: '1010', accountName: 'নগদ তহবিল', debit: 100, credit: 0 },
          { accountCode: '4010', accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 100 }
        ],
        createdBy: testUserId,
        createdAt: '2026-03-31T12:00:00.000Z'
      },
      { dbInstance: mDb }
    );

    const flowRes = await executeFinalizedBusinessProfitAllocationToInvestors(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        responsibleUser: testUserId,
        useCapitalParticipation: true
      },
      mDb
    );

    const allocA = flowRes.allocations.find((a) => a.investorId === invARes.investor.id)!;
    const allocB = flowRes.allocations.find((a) => a.investorId === invBRes.investor.id)!;

    assert(allocA.allocatedProfitAmount === 20, 'executeFinalizedBusinessProfitAllocationToInvestors: A = ৳20 (NOT ৳40)');
    assert(allocB.allocatedProfitAmount === 20, 'executeFinalizedBusinessProfitAllocationToInvestors: B = ৳20 (NOT ৳40)');
    assert(flowRes.totalAllocatedToInvestors === 40, 'Total allocated to investors = ৳40');
    assert(flowRes.retainedBusinessProfit === 60, 'Retained business profit (working partner) = ৳60 (NOT ৳20)');
    assert(flowRes.operatingPnlUnaltered, 'Operating P&L confirmed unaltered');
    assert(flowRes.trialBalanceBalanced, 'Trial Balance confirmed balanced');
  }

  console.log('\n================================================================');
  console.log(`PROMPT 12 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testSameTimeEqualInvestments.ts') ||
    process.argv[1].endsWith('testSameTimeEqualInvestments.js'));

if (isDirectRun) {
  runSameTimeEqualInvestmentsTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 12 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 12 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 12 tests:', err);
      process.exit(1);
    });
}
