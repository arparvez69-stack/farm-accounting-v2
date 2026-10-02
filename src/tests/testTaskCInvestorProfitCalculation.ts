import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeInvestorTransaction,
  executeFinalizedBusinessProfitAllocationToInvestors
} from '../services/transactionService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK C — REMOVE LEGACY INVESTOR PROFIT CALCULATION REGRESSION TEST
 *
 * Verification Scenario:
 * Canonical 3-stage allocation engine:
 * 1. AUTHORITATIVE BUSINESS PROFIT = 300
 * 2. ECONOMIC ALLOCATION (by capital proportion):
 *    Total capital = 100 + 200 = 300
 *    A economic allocation = 300 × (100 / 300) = 100
 *    B economic allocation = 300 × (200 / 300) = 200
 * 3. INDIVIDUAL CONTRACTUAL SPLIT:
 *    A contract = 50%:
 *      A investor profit = 100 × 50% = 50
 *      A Mudarib profit  = 100 − 50  = 50
 *    B contract = 60%:
 *      B investor profit = 200 × 60% = 120
 *      B Mudarib profit  = 200 − 120 = 80
 *
 * Totals:
 *   Investor profit = 50 + 120 = 170
 *   Mudarib profit  = 50 + 80  = 130
 *   Total           = 170 + 130 = 300
 *
 * Invariants:
 * - NEVER calculate: finalizedBusinessProfit × investor contractual % (e.g. A=150, B=180)
 * - NEVER use: 100% − total investor percentages
 */
export async function runTaskCInvestorProfitCalculationTests(): Promise<AssertionResult> {
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
  console.log('STARTING TASK C: CANONICAL 3-STAGE INVESTOR PROFIT ALLOCATION TEST');
  console.log('Testing: A=100 capital, 50% contract; B=200 capital, 60% contract; profit=300');
  console.log('================================================================\n');

  const testUserId = 'auditor_task_c';
  const mDb = createMockAgroDatabase();

  // 1. Initialize Default Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Cash Account
  const cashAccId = 'cash_task_c';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 500000,
    synced: false
  });

  // 3. Setup Investor A: Capital = 100, Contract = 50%
  const invA = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01710000001',
      contribution: 100,
      profitSharingRatio: 50,
      targetAccountId: cashAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Participant A (100 capital, 50% contract)',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
    },
    mDb
  );

  // 4. Setup Investor B: Capital = 200, Contract = 60%
  const invB = await executeInvestorTransaction(
    {
      investorName: 'Investor B',
      phone: '01710000002',
      contribution: 200,
      profitSharingRatio: 60,
      targetAccountId: cashAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Participant B (200 capital, 60% contract)',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
    },
    mDb
  );

  // 5. Generate Real Operating Profit = 300 via Farm Sales Revenue
  await postJournalEntry(
    {
      id: 'j_task_c_rev',
      voucherNumber: 'V-REV-TC',
      voucherType: 'RECEIPT',
      date: '2026-03-31',
      narration: 'খামার পণ্য বিক্রয় আয় (Profit = 300)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 300, credit: 0 },
        { accountCode: '4010', accountName: 'খামার পণ্য বিক্রয় আয়', debit: 0, credit: 300 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-31T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Verify baseline P&L
  const prePnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
  assert(prePnl.netProfit === 300, 'Baseline net operating profit is strictly ৳300');

  // 6. Execute executeFinalizedBusinessProfitAllocationToInvestors()
  const allocResult = await executeFinalizedBusinessProfitAllocationToInvestors(
    {
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      responsibleUser: testUserId,
      notes: 'Task C Canonical 3-Stage Profit Allocation'
    },
    mDb
  );

  // 7. Assertions on Finalized Allocation Result
  assert(allocResult.finalizedBusinessProfit === 300, 'Authoritative business profit is ৳300');
  assert(allocResult.allocations.length === 2, 'Two investor allocations created');

  const allocA = allocResult.allocations.find((a) => a.investorId === invA.investor.id);
  const allocB = allocResult.allocations.find((a) => a.investorId === invB.investor.id);

  assert(allocA !== undefined, 'Investor A allocation item exists');
  assert(allocB !== undefined, 'Investor B allocation item exists');

  // Expected for Investor A:
  // A economic = 100, investor = 50, Mudarib = 50
  assert(allocA?.allocatedEconomicProfit === 100, 'Investor A economic allocation is exactly ৳100');
  assert(allocA?.allocatedProfitAmount === 50, 'Investor A contractual profit is exactly ৳50 (50% of 100)');
  assert(allocA?.mudaribProfit === 50, 'Investor A Mudarib profit is exactly ৳50 (100 - 50)');

  // Expected for Investor B:
  // B economic = 200, investor = 120, Mudarib = 80
  assert(allocB?.allocatedEconomicProfit === 200, 'Investor B economic allocation is exactly ৳200');
  assert(allocB?.allocatedProfitAmount === 120, 'Investor B contractual profit is exactly ৳120 (60% of 200)');
  assert(allocB?.mudaribProfit === 80, 'Investor B Mudarib profit is exactly ৳80 (200 - 120)');

  // Invariant assertions:
  // Must NEVER calculate finalizedBusinessProfit × investor contractual % (e.g. 300 * 50% = 150 or 300 * 60% = 180)
  assert(allocA?.allocatedProfitAmount !== 150, 'Legacy direct calculation prevented: A is NOT ৳150 (300 × 50%)');
  assert(allocB?.allocatedProfitAmount !== 180, 'Legacy direct calculation prevented: B is NOT ৳180 (300 × 60%)');

  // Total Allocations & Retained Business Profit
  assert(allocResult.totalAllocatedToInvestors === 170, 'Total allocated to investors is exactly ৳170 (50 + 120)');
  assert(allocResult.retainedBusinessProfit === 130, 'Retained Mudarib profit is exactly ৳130 (50 + 80 = 300 - 170)');

  // Verify Operating P&L is 100% unaltered
  assert(allocResult.operatingPnlUnaltered === true, 'Operating P&L is 100% unaltered by investor allocation');
  assert(allocResult.salesUnaltered === true, 'Operating sales/revenue is 100% unaltered');
  assert(allocResult.expensesUnaltered === true, 'Operating expenses are 100% unaltered');
  assert(allocResult.cogsUnaltered === true, 'Inventory COGS is 100% unaltered');

  // Verify Trial Balance is balanced
  assert(allocResult.trialBalanceBalanced === true, 'Trial Balance is confirmed strictly balanced');

  const postTb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
  assert(Math.abs(postTb.totalDebit - postTb.totalCredit) < 0.01, 'Post-allocation Trial Balance debits equal credits');

  console.log('\n================================================================');
  console.log(`TASK C REGRESSION TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testTaskCInvestorProfitCalculation')) {
  runTaskCInvestorProfitCalculationTests()
    .then((r) => {
      process.exit(r.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test run failed:', err);
      process.exit(1);
    });
}
