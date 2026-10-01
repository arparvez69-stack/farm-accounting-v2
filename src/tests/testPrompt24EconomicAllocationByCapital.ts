import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  calculateEconomicAllocationByCapital,
  inspectEconomicAllocationByCapital,
  determineFinalizedDistributableProfit
} from '../services/valuationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 4 — PROFIT ALLOCATION
 * PROMPT 24 — Economic Allocation by Capital
 *
 * Requirements:
 * Implement the economic allocation layer.
 *
 * When participants have equal eligibility periods, allocate profit according to eligible capital proportion.
 *
 * Example:
 * A = 100
 * B = 200
 * Profit = 300
 *
 * Economic allocation:
 * A = 100
 * B = 200
 *
 * This is BEFORE applying their individual contractual profit-sharing percentages.
 *
 * Do not apply A's 50% or B's 60% directly to the total 300.
 *
 * Test the exact example.
 *
 * Return PASS.
 */
export async function runPrompt24EconomicAllocationByCapitalTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 24: ECONOMIC ALLOCATION BY CAPITAL');
  console.log('Testing: Capital Proportion Allocation Layer, Equal Eligibility Periods,');
  console.log('Exact Example (A=100, B=200, Profit=300), and Anti-Pattern Prevention');
  console.log('================================================================\n');

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // ===========================================================================
  // STEP 1: Test The Exact Example (A = 100, B = 200, Profit = 300)
  // ===========================================================================
  console.log('--- Step 1: Exact Example Execution (A=100, B=200, Profit=300) ---');

  const exactProfit = 300;
  const participants = [
    {
      id: 'A',
      name: 'Participant A',
      eligibleCapital: 100,
      contractualProfitSharingPercentage: 50, // A's 50%
      eligibilityPeriodStart: '2026-01-01',
      eligibilityPeriodEnd: '2026-03-31'
    },
    {
      id: 'B',
      name: 'Participant B',
      eligibleCapital: 200,
      contractualProfitSharingPercentage: 60, // B's 60%
      eligibilityPeriodStart: '2026-01-01',
      eligibilityPeriodEnd: '2026-03-31'
    }
  ];

  const allocResult = calculateEconomicAllocationByCapital({
    distributableProfit: exactProfit,
    participants,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-03-31'
  });

  assert(allocResult.distributableProfit === 300, 'Distributable profit is exactly ৳300');
  assert(allocResult.totalEligibleCapital === 300, 'Total eligible capital is exactly ৳300 (100 + 200)');
  assert(allocResult.hasEqualEligibilityPeriods === true, 'Participants have verified equal eligibility periods');
  assert(allocResult.allocations.length === 2, 'Allocations array contains 2 participants');

  const allocA = allocResult.allocations.find((a) => a.participantId === 'A')!;
  const allocB = allocResult.allocations.find((a) => a.participantId === 'B')!;

  assert(allocA !== undefined, 'Participant A allocation exists');
  assert(allocB !== undefined, 'Participant B allocation exists');

  // Verify capital proportions
  assert(
    Math.abs(allocA.capitalProportionRatio - 1 / 3) < 0.0001,
    `A's capital proportion ratio is exactly 1/3 (got ${allocA.capitalProportionRatio.toFixed(4)})`
  );
  assert(
    Math.abs(allocB.capitalProportionRatio - 2 / 3) < 0.0001,
    `B's capital proportion ratio is exactly 2/3 (got ${allocB.capitalProportionRatio.toFixed(4)})`
  );

  // CRITICAL REQUIREMENT: Economic allocation A = 100, B = 200
  assert(
    allocA.allocatedEconomicProfit === 100,
    `CRITICAL REQUIREMENT: Economic allocation A = 100 (got ৳${allocA.allocatedEconomicProfit})`
  );
  assert(
    allocB.allocatedEconomicProfit === 200,
    `CRITICAL REQUIREMENT: Economic allocation B = 200 (got ৳${allocB.allocatedEconomicProfit})`
  );
  assert(
    allocA.allocatedEconomicProfit + allocB.allocatedEconomicProfit === 300,
    'Total economic allocation matches total profit: 100 + 200 = 300'
  );

  // ===========================================================================
  // STEP 2: Invariant: This is BEFORE applying contractual profit-sharing percentages
  // ===========================================================================
  console.log('\n--- Step 2: Verify Allocation is BEFORE Contractual Percentages ---');

  assert(
    allocResult.isBeforeContractualPercentages === true,
    'Verified: Economic allocation is BEFORE applying individual contractual percentages'
  );
  assert(
    allocA.allocatedEconomicProfit !== 50,
    'A economic allocation is 100, NOT 50 (contractual 50% not applied at economic layer)'
  );
  assert(
    allocB.allocatedEconomicProfit !== 120,
    'B economic allocation is 200, NOT 120 (contractual 60% not applied at economic layer)'
  );

  // ===========================================================================
  // STEP 3: Invariant: Do NOT apply A's 50% or B's 60% directly to the total 300
  // ===========================================================================
  console.log('\n--- Step 3: Anti-Pattern Check — Block Direct Application of 50% or 60% to Total 300 ---');

  const flatA = 300 * 0.50; // 150 (WRONG anti-pattern!)
  const flatB = 300 * 0.60; // 180 (WRONG anti-pattern!)
  const totalFlat = flatA + flatB; // 330 > 300! (Invalid overflow!)

  assert(
    allocA.allocatedEconomicProfit !== flatA,
    `ANTI-PATTERN PREVENTED: A allocation (৳${allocA.allocatedEconomicProfit}) is NOT 300 × 50% (৳${flatA})`
  );
  assert(
    allocB.allocatedEconomicProfit !== flatB,
    `ANTI-PATTERN PREVENTED: B allocation (৳${allocB.allocatedEconomicProfit}) is NOT 300 × 60% (৳${flatB})`
  );
  assert(
    totalFlat > 300,
    `Verification that flat percentages would violate mathematics: ৳150 + ৳180 = ৳${totalFlat} (> ৳300 pool)`
  );
  assert(
    allocResult.flatProfitSharingAntiPatternPrevented === true,
    'Result flags flatProfitSharingAntiPatternPrevented: true'
  );

  // ===========================================================================
  // STEP 4: Subsequent Contractual Layer (Downstream from Economic Layer)
  // ===========================================================================
  console.log('\n--- Step 4: Subsequent Contractual Profit Application on Allocated Economic Profit ---');

  // Once economic profit is allocated (A=100, B=200):
  // A receives 50% of 100 = 50; Working partner receives remaining 50% = 50
  // B receives 60% of 200 = 120; Working partner receives remaining 40% = 80
  assert(
    allocA.investorContractualProfit === 50,
    `A's contractual investor share is 50% of allocated ৳100 = ৳50 (got ৳${allocA.investorContractualProfit})`
  );
  assert(
    allocA.workingPartnerShare === 50,
    `Working partner share from A is remaining 50% of ৳100 = ৳50 (got ৳${allocA.workingPartnerShare})`
  );
  assert(
    allocB.investorContractualProfit === 120,
    `B's contractual investor share is 60% of allocated ৳200 = ৳120 (got ৳${allocB.investorContractualProfit})`
  );
  assert(
    allocB.workingPartnerShare === 80,
    `Working partner share from B is remaining 40% of ৳200 = ৳80 (got ৳${allocB.workingPartnerShare})`
  );

  const totalInvestorDist = (allocA.investorContractualProfit || 0) + (allocB.investorContractualProfit || 0);
  const totalWorkingPartnerDist = (allocA.workingPartnerShare || 0) + (allocB.workingPartnerShare || 0);
  assert(
    totalInvestorDist + totalWorkingPartnerDist === 300,
    `All ৳300 profit fully accounted for after contractual layer: ৳${totalInvestorDist} (investors) + ৳${totalWorkingPartnerDist} (partner) = ৳300`
  );

  // ===========================================================================
  // STEP 5: Run inspectEconomicAllocationByCapital Function
  // ===========================================================================
  console.log('\n--- Step 5: Run inspectEconomicAllocationByCapital Inspection Suite ---');

  const inspection = inspectEconomicAllocationByCapital({
    distributableProfit: 300,
    participants,
    expectedEconomicAllocations: {
      A: 100,
      B: 200
    }
  });

  assert(inspection.passed === true, 'inspectEconomicAllocationByCapital returned passed: true');
  assert(inspection.exactExampleVerified === true, 'Inspection confirms: exactExampleVerified === true');
  assert(
    inspection.allocationsMatchCapitalProportions === true,
    'Inspection confirms: allocationsMatchCapitalProportions === true'
  );
  assert(
    inspection.beforeContractualPercentagesApplied === true,
    'Inspection confirms: beforeContractualPercentagesApplied === true'
  );
  assert(
    inspection.directApplicationOfContractualRateToTotalProfitBlocked === true,
    'Inspection confirms: directApplicationOfContractualRateToTotalProfitBlocked === true'
  );
  assert(inspection.allocations['A'] === 100, 'Inspection allocations record has A = 100');
  assert(inspection.allocations['B'] === 200, 'Inspection allocations record has B = 200');

  // ===========================================================================
  // STEP 6: Multi-Participant Scenario with Equal Eligibility Periods
  // ===========================================================================
  console.log('\n--- Step 6: Multi-Participant Scenario (Three Participants: 100, 200, 300 -> Total 600, Profit 1200) ---');

  const multiParticipants = [
    { id: 'P1', name: 'Partner 1', eligibleCapital: 100, contractualProfitSharingPercentage: 40 },
    { id: 'P2', name: 'Partner 2', eligibleCapital: 200, contractualProfitSharingPercentage: 50 },
    { id: 'P3', name: 'Partner 3', eligibleCapital: 300, contractualProfitSharingPercentage: 60 }
  ];

  const multiResult = calculateEconomicAllocationByCapital({
    distributableProfit: 1200,
    participants: multiParticipants
  });

  // Total capital = 600
  // P1: 100/600 * 1200 = 200
  // P2: 200/600 * 1200 = 400
  // P3: 300/600 * 1200 = 600
  assert(multiResult.allocations.find((p) => p.participantId === 'P1')?.allocatedEconomicProfit === 200, 'P1 economic allocation is ৳200');
  assert(multiResult.allocations.find((p) => p.participantId === 'P2')?.allocatedEconomicProfit === 400, 'P2 economic allocation is ৳400');
  assert(multiResult.allocations.find((p) => p.participantId === 'P3')?.allocatedEconomicProfit === 600, 'P3 economic allocation is ৳600');
  assert(multiResult.totalAllocatedEconomicProfit === 1200, 'Total economic allocated across 3 participants is ৳1200');

  // ===========================================================================
  // STEP 7: Validation Guards & Error Handling
  // ===========================================================================
  console.log('\n--- Step 7: Validation Guards & Error Handling ---');

  let zeroProfitError = false;
  try {
    calculateEconomicAllocationByCapital({
      distributableProfit: 0,
      participants
    });
  } catch (err: any) {
    zeroProfitError = true;
    assert(err.message.includes('০ এর বেশি হতে হবে') || err.message.includes('strictly > 0'), 'Zero profit rejected with proper message');
  }
  assert(zeroProfitError, 'Zero distributable profit is strictly rejected');

  let noParticipantsError = false;
  try {
    calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: []
    });
  } catch (err: any) {
    noParticipantsError = true;
  }
  assert(noParticipantsError, 'Empty participants array is strictly rejected');

  // ===========================================================================
  // STEP 8: Task 4 Regression Test — Equal Capital, Different Entry Dates (Time-Weighted)
  // ===========================================================================
  console.log('\n--- Step 8: Task 4 — Equal Capital, Different Entry Dates (Time-Weighted Allocation) ---');

  const t4DistributableProfit = 300;
  const t4PeriodStart = '2026-01-01';
  const t4PeriodEnd = '2026-03-31'; // 90 days total

  const t4Participants = [
    {
      id: 'inv_early',
      name: 'Early Investor',
      eligibleCapital: 100, // Equal capital: ৳100
      contractualProfitSharingPercentage: 50,
      eligibilityPeriodStart: '2026-01-01',
      eligibilityPeriodEnd: '2026-03-31'
    },
    {
      id: 'inv_late',
      name: 'Late Investor',
      eligibleCapital: 100, // Equal capital: ৳100
      contractualProfitSharingPercentage: 60,
      eligibilityPeriodStart: '2026-02-15', // 45 days in period
      eligibilityPeriodEnd: '2026-03-31'
    }
  ];

  const t4AllocResult = calculateEconomicAllocationByCapital({
    distributableProfit: t4DistributableProfit,
    participants: t4Participants,
    periodStartDate: t4PeriodStart,
    periodEndDate: t4PeriodEnd,
    allocationMethod: 'TIME_WEIGHTED'
  });

  const earlyAlloc = t4AllocResult.allocations.find((a) => a.participantId === 'inv_early')!;
  const lateAlloc = t4AllocResult.allocations.find((a) => a.participantId === 'inv_late')!;

  assert(earlyAlloc.eligibleCapital === lateAlloc.eligibleCapital, 'Task 4: Equal capital verified (৳100 === ৳100)');
  assert(earlyAlloc.eligibleDays === 90, 'Task 4: Early investor has 90 eligible days');
  assert(lateAlloc.eligibleDays === 45, 'Task 4: Late investor has 45 eligible days');
  assert(
    lateAlloc.allocatedEconomicProfit !== earlyAlloc.allocatedEconomicProfit,
    `Task 4 PROOF: Later investor cannot receive same allocation as earlier investor (${lateAlloc.allocatedEconomicProfit} !== ${earlyAlloc.allocatedEconomicProfit})`
  );
  assert(
    lateAlloc.allocatedEconomicProfit < earlyAlloc.allocatedEconomicProfit,
    `Task 4 PROOF: Later investor receives strictly less allocation (৳${lateAlloc.allocatedEconomicProfit} < ৳${earlyAlloc.allocatedEconomicProfit})`
  );
  assert(earlyAlloc.allocatedEconomicProfit === 200, 'Task 4: Early investor receives ৳200 (2/3 of ৳300)');
  assert(lateAlloc.allocatedEconomicProfit === 100, 'Task 4: Late investor receives ৳100 (1/3 of ৳300)');
  assert(
    earlyAlloc.allocatedEconomicProfit + lateAlloc.allocatedEconomicProfit === 300,
    'Task 4: Exact total reconciliation: 200 + 100 = 300'
  );
  assert(t4AllocResult.remainingEconomicProfit === 0, 'Task 4: Zero remaining economic profit');

  // Summary
  console.log('\n================================================================');
  console.log('PROMPT 24 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt24EconomicAllocationByCapitalTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 24 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 24 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 24 tests:', err);
      process.exit(1);
    });
}
