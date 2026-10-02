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
 * PROMPT 05: EFFECTIVE INVESTMENT DATES TEST
 *
 * Requirements:
 * - Every investment tranche must have an effective date.
 * - Profit allocation must respect that date.
 * - A new investor must not receive profit from periods before admission.
 * - A later tranche of an existing investor must not receive profit from periods before that tranche became effective.
 * - Use the contractual/accounting effective date, not record creation time.
 *
 * Exact Prompt Test:
 * - A enters January 1 (2026-01-01).
 * - B enters June 1 (2026-06-01).
 * - Create January-May profit (2026-01-01 to 2026-05-31).
 * - Verify B receives zero allocation from January-May.
 */
export async function runEffectiveInvestmentDatesTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 05: EFFECTIVE INVESTMENT DATES TEST');
  console.log('Testing: A enters Jan 1, B enters June 1 -> B gets zero from Jan-May profit');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p05';

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_p05';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Eastern Bank PLC',
    name: 'Eastern Bank PLC',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Investor A enters on January 1, 2026
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Investor A enters January 1 (2026-01-01) ---');

  // Explicit test fixture: Valid admission request with finalized valuation for Investor A
  await mDb.investorAdmissionRequests.put({
    id: 'adm_req_eff_a',
    investorName: 'Investor A',
    phone: '01711100001',
    status: 'APPROVED',
    isAdmitted: true,
    valuation: {
      status: 'FINALIZED',
      isFinalized: true,
      preMoneyValuation: 1000,
      postMoneyValuation: 1100,
      valuationDate: '2026-01-01'
    }
  });

  const resA = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01711100001',
      contribution: 100,
      profitSharingRatio: 40, // 40% contractual rate
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Investor A admission on 2026-01-01'
    },
    mDb
  );

  const tranchesA = await getTranchesForInvestor(resA.investor.id, mDb);
  assert(tranchesA.length === 1, 'Investor A tranche created');
  const effDateA = tranchesA[0].effectiveInvestmentDate || tranchesA[0].effectiveDate;
  assert(effDateA === '2026-01-01', 'Investor A tranche effective date is strictly 2026-01-01');

  // ---------------------------------------------------------------------------
  // STEP 2: Investor B enters on June 1, 2026
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Investor B enters June 1 (2026-06-01) ---');

  // Explicit test fixture: Valid admission request with finalized valuation for Investor B
  await mDb.investorAdmissionRequests.put({
    id: 'adm_req_eff_b',
    investorName: 'Investor B',
    phone: '01711100002',
    status: 'APPROVED',
    isAdmitted: true,
    valuation: {
      status: 'FINALIZED',
      isFinalized: true,
      preMoneyValuation: 2000,
      postMoneyValuation: 2100,
      valuationDate: '2026-06-01'
    }
  });

  const resB = await executeInvestorTransaction(
    {
      investorName: 'Investor B',
      phone: '01711100002',
      contribution: 100,
      profitSharingRatio: 40, // 40% contractual rate
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-06-01',
      notes: 'Investor B admission on 2026-06-01'
    },
    mDb
  );

  const tranchesB = await getTranchesForInvestor(resB.investor.id, mDb);
  assert(tranchesB.length === 1, 'Investor B tranche created');
  const effDateB = tranchesB[0].effectiveInvestmentDate || tranchesB[0].effectiveDate;
  assert(effDateB === '2026-06-01', 'Investor B tranche effective date is strictly 2026-06-01');

  // ---------------------------------------------------------------------------
  // STEP 3: Create January-May Profit (2026-01-01 to 2026-05-31) and Allocate
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Allocating January-May profit (৳200) ---');
  const janMayProfit = 200;
  const periodStart = '2026-01-01';
  const periodEnd = '2026-05-31';

  // 3a. Mathematical calculation check via calculateCapitalParticipationAllocation
  const allActiveTranches = [
    ...tranchesA,
    ...tranchesB
  ];

  const calcJanMay = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: janMayProfit,
    tranches: allActiveTranches,
    periodStartDate: periodStart,
    periodEndDate: periodEnd
  });

  const allocItemA = calcJanMay.trancheAllocations.find((t) => t.investorId === resA.investor.id);
  const allocItemB = calcJanMay.trancheAllocations.find((t) => t.investorId === resB.investor.id);
  const summaryA = calcJanMay.investorSummary.find((s) => s.investorId === resA.investor.id);
  const summaryB = calcJanMay.investorSummary.find((s) => s.investorId === resB.investor.id);

  // PRIMARY CRITICAL ASSERTION: B receives ZERO allocation from January-May
  assert(
    allocItemB?.investorProfitShare === 0,
    'CRITICAL: Investor B tranche receives strictly ZERO profit share from January-May (0)'
  );
  assert(
    allocItemB?.applicableBusinessProfit === 0,
    'CRITICAL: Investor B tranche allocated economic profit is ZERO from January-May (0)'
  );
  assert(
    summaryB?.totalInvestorProfitShare === 0,
    'CRITICAL: Investor B summary receives strictly ZERO total investor profit share (0)'
  );
  assert(
    summaryB?.totalAllocatedEconomicProfit === 0,
    'CRITICAL: Investor B summary total allocated economic profit is ZERO (0)'
  );

  // Positive verification for eligible Investor A (A was active all Jan-May)
  assert(
    allocItemA?.applicableBusinessProfit === 200,
    'Investor A (only eligible investor) is allocated 100% of economic profit in Jan-May (৳200)'
  );
  assert(
    allocItemA?.investorProfitShare === 80,
    'Investor A receives 40% of ৳200 = ৳80'
  );
  assert(
    allocItemA?.workingPartnerProfitShare === 120,
    'Working partner receives remaining 60% = ৳120'
  );
  assert(
    calcJanMay.totalWorkingPartnerEarnings === 120,
    'Total working partner earnings = ৳120'
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Full GL Execution and Ledger Audit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Executing Capital Participation Allocation in Ledger ---');
  await executeCapitalParticipationAllocation(
    {
      startDate: periodStart,
      endDate: periodEnd,
      finalizedBusinessProfit: janMayProfit,
      responsibleUser: testUserId,
      allocationReference: 'ALLOC-JAN-MAY-2026'
    },
    mDb
  );

  // Check Investor B record in database: profitPayable must be 0!
  const investorBRecord = await mDb.investors.get(resB.investor.id);
  assert(
    investorBRecord?.profitPayable === 0,
    'Database: Investor B profitPayable is strictly 0 after Jan-May allocation'
  );
  assert(
    investorBRecord?.totalProfitAllocated === 0,
    'Database: Investor B totalProfitAllocated is strictly 0 after Jan-May allocation'
  );

  // Check Investor A record in database: profitPayable must be 80!
  const investorARecord = await mDb.investors.get(resA.investor.id);
  assert(
    investorARecord?.profitPayable === 80,
    'Database: Investor A profitPayable is updated to ৳80'
  );
  assert(
    investorARecord?.totalProfitAllocated === 80,
    'Database: Investor A totalProfitAllocated is updated to ৳80'
  );

  // Check Journal Entries: Ensure NO journal line credited Investor B!
  const allJournals = await mDb.journalEntries.toArray();
  const allocJournals = allJournals.filter((j: any) => j.reference === 'ALLOC-JAN-MAY-2026');

  const bHasJournal = allocJournals.some(
    (j: any) =>
      j.investorId === resB.investor.id ||
      j.lines?.some((l: any) => l.investorId === resB.investor.id)
  );
  assert(!bHasJournal, 'GL: No journal entry created for ineligible Investor B');

  // ---------------------------------------------------------------------------
  // STEP 5: Later Tranche of Existing Investor Must Not Receive Prior Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Later tranche of existing investor test ---');
  // Investor A adds a second tranche on August 1, 2026
  const resA2 = await executeInvestmentTrancheTransaction(
    {
      investorId: resA.investor.id,
      investmentAmount: 50,
      effectiveInvestmentDate: '2026-08-01',
      contractualProfitSharePercentage: 35,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      notes: 'Tranche A2 on August 1, 2026'
    },
    mDb
  );

  const trancheA2 = resA2.tranche;
  assert(
    trancheA2.effectiveInvestmentDate === '2026-08-01',
    'Tranche A2 effective date is strictly 2026-08-01'
  );

  // Allocate profit for June-July (2026-06-01 to 2026-07-31):
  // At this time:
  // - Tranche A1 (Jan 1) is ELIGIBLE
  // - Tranche B (June 1) is ELIGIBLE
  // - Tranche A2 (Aug 1) is INELIGIBLE (became effective after July 31)
  const juneJulyCalc = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 100,
    tranches: [
      tranchesA[0],
      tranchesB[0],
      trancheA2
    ],
    periodStartDate: '2026-06-01',
    periodEndDate: '2026-07-31'
  });

  const allocA2 = juneJulyCalc.trancheAllocations.find((t) => t.id === trancheA2.id);
  assert(
    allocA2?.investorProfitShare === 0,
    'Later Tranche A2 (effective Aug 1) receives strictly ZERO profit from June-July period'
  );
  assert(
    allocA2?.applicableBusinessProfit === 0,
    'Later Tranche A2 receives zero applicable business profit for June-July'
  );

  // ---------------------------------------------------------------------------
  // STEP 6: Contractual/Accounting Effective Date vs System Creation Timestamp
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Contractual/Accounting Date Precedence Test ---');
  // Tranche created with creationTimestamp today, but contractual effective date in future (2026-10-01)
  const futureTranche = {
    id: 'tranche_future',
    investorId: 'inv_future',
    investmentAmount: 100,
    contractualProfitSharePercentage: 40,
    effectiveInvestmentDate: '2026-10-01', // contractual date
    creationTimestamp: '2026-01-01T00:00:00Z', // early creation timestamp (e.g. advance agreement)
    status: 'ACTIVE'
  };

  const testPrecedence = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 100,
    tranches: [futureTranche as any],
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-05-31'
  });

  const futureAlloc = testPrecedence.trancheAllocations.find((t) => t.id === 'tranche_future');
  assert(
    futureAlloc?.investorProfitShare === 0,
    'Contractual effective date (2026-10-01) takes precedence over creationTimestamp (2026-01-01): receives ZERO profit for Jan-May'
  );

  console.log('\n================================================================');
  console.log(`PROMPT 05 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testEffectiveInvestmentDates.ts') ||
    process.argv[1].endsWith('testEffectiveInvestmentDates.js'));

if (isDirectRun) {
  runEffectiveInvestmentDatesTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 05 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 05 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 05 tests:', err);
      process.exit(1);
    });
}
