import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  getTranchesForInvestor
} from '../services/transactionService';
import {
  calculateCapitalParticipationAllocation,
  executeCapitalParticipationAllocation
} from '../services/valuationService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 04: INDIVIDUAL CONTRACT PERCENTAGE TEST
 *
 * Each investment tranche must have its own contractual profit-sharing percentage.
 * Do NOT require all investor percentages to sum to 100%.
 *
 * Exact Prompt Example:
 * - Investor A = 50%
 * - Investor B = 60%
 * - Sum = 110% > 100%
 * - Must NOT be rejected; both must coexist correctly.
 */
export async function runIndividualContractPercentageTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 04: INDIVIDUAL CONTRACT PERCENTAGE TEST');
  console.log('Testing coexistence of Investor A=50% and Investor B=60% (Sum: 110% > 100%)');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p04';

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_p04';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Dhaka Bank Limited',
    name: 'Dhaka Bank Limited',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Investor A enters with 50% contractual profit share
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Creating Investor A with 50% contract rate ---');
  let resA: any;
  let errorA: any = null;
  try {
    resA = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01811000001',
        contribution: 100,
        profitSharingRatio: 50, // 50%
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-01-01',
        notes: 'Prompt 04 Investor A 50%'
      },
      mDb
    );
  } catch (err) {
    errorA = err;
  }

  assert(errorA === null, 'Investor A with 50% contractual rate created without error');
  assert(Boolean(resA?.investor?.id), 'Investor A assigned valid ID');
  assert(resA?.investor?.profitSharingRatio === 50, 'Investor A recorded with profitSharingRatio = 50%');

  // ---------------------------------------------------------------------------
  // STEP 2: Investor B enters with 60% contractual profit share (Sum = 110%)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Creating Investor B with 60% contract rate (50% + 60% = 110%) ---');
  let resB: any;
  let errorB: any = null;
  try {
    resB = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01811000002',
        contribution: 100,
        profitSharingRatio: 60, // 60%
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-01-01',
        notes: 'Prompt 04 Investor B 60%'
      },
      mDb
    );
  } catch (err) {
    errorB = err;
  }

  assert(
    errorB === null,
    'Investor B with 60% contractual rate created without rejection (even though 50% + 60% = 110% > 100%)'
  );
  assert(Boolean(resB?.investor?.id), 'Investor B assigned valid ID');
  assert(resB?.investor?.profitSharingRatio === 60, 'Investor B recorded with profitSharingRatio = 60%');

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Both Investors and Their Tranches Coexist Correctly
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Database Coexistence ---');
  const allInvestors = await mDb.investors.toArray();
  const activeInvestors = allInvestors.filter((i: any) => i.status !== 'EXITED');

  assert(activeInvestors.length === 2, 'Both Investor A and Investor B actively coexist in database');

  const invA = activeInvestors.find((i: any) => i.id === resA.investor.id);
  const invB = activeInvestors.find((i: any) => i.id === resB.investor.id);

  assert(invA !== undefined, 'Investor A exists in database');
  assert(invB !== undefined, 'Investor B exists in database');
  assert(invA?.profitSharingRatio === 50, 'Investor A preserves individual 50% rate');
  assert(invB?.profitSharingRatio === 60, 'Investor B preserves individual 60% rate');

  const sumPercentages = (invA?.profitSharingRatio || 0) + (invB?.profitSharingRatio || 0);
  assert(
    sumPercentages === 110,
    `Total sum of individual contractual percentages is 110% (> 100%), confirming no 100% restriction exists`
  );

  // Check Tranches
  const tranchesA = await getTranchesForInvestor(resA.investor.id, mDb);
  const tranchesB = await getTranchesForInvestor(resB.investor.id, mDb);

  assert(tranchesA.length === 1, 'Investor A has 1 active tranche');
  assert(tranchesB.length === 1, 'Investor B has 1 active tranche');
  assert(
    tranchesA[0].contractualProfitSharePercentage === 50,
    'Tranche A records contractualProfitSharePercentage = 50%'
  );
  assert(
    tranchesB[0].contractualProfitSharePercentage === 60,
    'Tranche B records contractualProfitSharePercentage = 60%'
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Additional Tranche with Different Percentage on Investor A (e.g. 55%)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Adding Tranche 2 to Investor A with 55% ---');
  const resA2 = await executeInvestmentTrancheTransaction(
    {
      investorId: resA.investor.id,
      investmentAmount: 50,
      contractualProfitSharePercentage: 55, // 55%
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      notes: 'Tranche A2 with 55%'
    },
    mDb
  );

  assert(Boolean(resA2?.tranche?.id), 'Tranche A2 created successfully');
  assert(
    resA2.tranche.contractualProfitSharePercentage === 55,
    'Tranche A2 records distinct contractual percentage of 55%'
  );

  const updatedTranchesA = await getTranchesForInvestor(resA.investor.id, mDb);
  assert(updatedTranchesA.length === 2, 'Investor A now has 2 distinct tranches');
  assert(
    updatedTranchesA.some((t) => t.contractualProfitSharePercentage === 50),
    'Tranche A1 preserves 50%'
  );
  assert(
    updatedTranchesA.some((t) => t.contractualProfitSharePercentage === 55),
    'Tranche A2 preserves 55%'
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Economic Allocation Verification (Economic Profit, not Total Profit)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Economic Participation Allocation with A=50% and B=60% ---');
  // Scenario:
  // Tranche A: ৳100 @ 50%
  // Tranche B: ৳100 @ 60%
  // Farm Business Profit: ৳100
  const calc = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 100,
    tranches: [
      {
        id: 't_A',
        investorId: 'inv_A',
        investmentAmount: 100,
        contractualProfitSharePercentage: 50,
        status: 'ACTIVE'
      },
      {
        id: 't_B',
        investorId: 'inv_B',
        investmentAmount: 100,
        contractualProfitSharePercentage: 60,
        status: 'ACTIVE'
      }
    ]
  });

  const allocA = calc.trancheAllocations.find((t) => t.investorId === 'inv_A')!;
  const allocB = calc.trancheAllocations.find((t) => t.investorId === 'inv_B')!;

  // Economic participation for each is 100 / 200 = 50% -> ৳50 attributable profit each
  assert(allocA.applicableBusinessProfit === 50, 'A attributable economic profit = ৳50');
  assert(allocB.applicableBusinessProfit === 50, 'B attributable economic profit = ৳50');

  // Distribution:
  // A gets 50% of ৳50 = ৳25
  // B gets 60% of ৳50 = ৳30
  assert(allocA.investorProfitShare === 25, 'Investor A distribution is strictly ৳25 (50% of ৳50)');
  assert(allocB.investorProfitShare === 30, 'Investor B distribution is strictly ৳30 (60% of ৳50)');

  // Working partner share:
  // From A: 50% of ৳50 = ৳25
  // From B: 40% of ৳50 = ৳20
  // Total WP = 25 + 20 = ৳45
  assert(allocA.workingPartnerProfitShare === 25, 'Working partner share from A is ৳25 (50% of ৳50)');
  assert(allocB.workingPartnerProfitShare === 20, 'Working partner share from B is ৳20 (40% of ৳50)');
  assert(calc.totalWorkingPartnerEarnings === 45, 'Total working partner share is strictly ৳45 (25 + 20)');

  // Reconciliation: 25 + 30 + 45 = 100
  assert(
    allocA.investorProfitShare + allocB.investorProfitShare + calc.totalWorkingPartnerEarnings === 100,
    'Total profit fully reconciles: ৳25 + ৳30 + ৳45 === ৳100'
  );

  console.log('\n================================================================');
  console.log(`PROMPT 04 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testIndividualContractPercentage.ts') ||
    process.argv[1].endsWith('testIndividualContractPercentage.js'));

if (isDirectRun) {
  runIndividualContractPercentageTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 04 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 04 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 04 tests:', err);
      process.exit(1);
    });
}
