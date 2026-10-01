import 'fake-indexeddb/auto';
import { calculateEconomicAllocationByCapital } from '../services/valuationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK 4 — FIX INVESTOR ECONOMIC ALLOCATION
 *
 * Minimal Regression Test:
 * Two equal-capital investors entering on different dates.
 * Proves that the later investor cannot receive the same full-period economic allocation
 * as the earlier investor under time-weighted capital × eligible-days weighting.
 *
 * Mathematical invariants verified:
 * 1. Both investors have identical capital amounts (e.g. ৳100,000 each).
 * 2. Earlier investor (entered 2026-01-01) participates for full period (90 days).
 * 3. Later investor (entered 2026-02-15) participates for partial period (45 days).
 * 4. Deterministic capital × eligible-days weighting:
 *      Weight A = 100,000 × 90 = 9,000,000
 *      Weight B = 100,000 × 45 = 4,500,000
 *      Ratio A = 2/3 (66.67%), Ratio B = 1/3 (33.33%)
 * 5. Later investor allocation (৳100) < Earlier investor allocation (৳200).
 * 6. Later investor CANNOT receive the same full-period economic allocation as earlier investor.
 * 7. Exact total reconciliation: 200 + 100 = 300 (remainingEconomicProfit === 0).
 * 8. Contractual profit-share percentages are preserved and applied to economic allocation.
 */
export async function runTask4InvestorEconomicAllocationTests(): Promise<AssertionResult> {
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
  console.log('TASK 4: INVESTOR ECONOMIC ALLOCATION REGRESSION TEST');
  console.log('Testing: Equal Capital with Different Entry Dates (Time-Weighted)');
  console.log('================================================================\n');

  // --- SCENARIO 1: Two equal-capital investors entering on different dates ---
  console.log('--- Scenario 1: Two Equal-Capital Investors Entering on Different Dates ---');

  const distributableProfit = 300;
  const periodStartDate = '2026-01-01';
  const periodEndDate = '2026-03-31'; // 90 days total (Jan 31 + Feb 28 + Mar 31)

  const participants = [
    {
      id: 'inv_earlier',
      name: 'Earlier Investor (Jan 1 Entry)',
      eligibleCapital: 100000, // Equal capital: ৳100,000
      contractualProfitSharingPercentage: 50, // 50% contractual agreement
      eligibilityPeriodStart: '2026-01-01',
      eligibilityPeriodEnd: '2026-03-31',
      allocationMethod: 'TIME_WEIGHTED' as const
    },
    {
      id: 'inv_later',
      name: 'Later Investor (Feb 15 Entry)',
      eligibleCapital: 100000, // Equal capital: ৳100,000
      contractualProfitSharingPercentage: 60, // 60% contractual agreement
      eligibilityPeriodStart: '2026-02-15', // Entered midway through period
      eligibilityPeriodEnd: '2026-03-31',
      allocationMethod: 'TIME_WEIGHTED' as const
    }
  ];

  const allocResult = calculateEconomicAllocationByCapital({
    distributableProfit,
    participants,
    periodStartDate,
    periodEndDate,
    allocationMethod: 'TIME_WEIGHTED'
  });

  const earlierAlloc = allocResult.allocations.find((a) => a.participantId === 'inv_earlier')!;
  const laterAlloc = allocResult.allocations.find((a) => a.participantId === 'inv_later')!;

  // 1. Verify premise: Equal capital amounts
  assert(
    earlierAlloc.eligibleCapital === laterAlloc.eligibleCapital,
    `Equal capital verified: earlier = ৳${earlierAlloc.eligibleCapital}, later = ৳${laterAlloc.eligibleCapital}`
  );

  // 2. Verify eligible days calculated deterministically
  assert(
    earlierAlloc.eligibleDays === 90,
    `Earlier investor eligible participation duration is full period: 90 days (got ${earlierAlloc.eligibleDays})`
  );
  assert(
    laterAlloc.eligibleDays === 45,
    `Later investor eligible participation duration is partial period: 45 days (got ${laterAlloc.eligibleDays})`
  );

  // 3. Verify capital × eligible-days weighting
  assert(
    earlierAlloc.capitalDaysWeight === 100000 * 90,
    `Earlier investor weight = capital × 90 days = 9,000,000 (got ${earlierAlloc.capitalDaysWeight})`
  );
  assert(
    laterAlloc.capitalDaysWeight === 100000 * 45,
    `Later investor weight = capital × 45 days = 4,500,000 (got ${laterAlloc.capitalDaysWeight})`
  );

  // 4. CORE PROOF: Later investor cannot receive the same full-period economic allocation as earlier investor
  assert(
    laterAlloc.allocatedEconomicProfit !== earlierAlloc.allocatedEconomicProfit,
    `PROOF: Later investor cannot receive the same economic allocation as earlier investor (${laterAlloc.allocatedEconomicProfit} !== ${earlierAlloc.allocatedEconomicProfit})`
  );
  assert(
    laterAlloc.allocatedEconomicProfit < earlierAlloc.allocatedEconomicProfit,
    `PROOF: Later investor receives strictly less economic allocation (৳${laterAlloc.allocatedEconomicProfit} < ৳${earlierAlloc.allocatedEconomicProfit})`
  );

  // 5. Verify exact proportions: Earlier gets 2/3 (৳200), Later gets 1/3 (৳100)
  assert(
    earlierAlloc.allocatedEconomicProfit === 200,
    `Earlier investor receives exact 2/3 economic allocation: ৳200 (got ৳${earlierAlloc.allocatedEconomicProfit})`
  );
  assert(
    laterAlloc.allocatedEconomicProfit === 100,
    `Later investor receives exact 1/3 economic allocation: ৳100 (got ৳${laterAlloc.allocatedEconomicProfit})`
  );

  // 6. Exact total reconciliation without leakage
  assert(
    earlierAlloc.allocatedEconomicProfit + laterAlloc.allocatedEconomicProfit === distributableProfit,
    `Exact total reconciliation: ৳${earlierAlloc.allocatedEconomicProfit} + ৳${laterAlloc.allocatedEconomicProfit} = ৳${distributableProfit}`
  );
  assert(
    allocResult.totalAllocatedEconomicProfit === distributableProfit,
    `Total allocated economic profit exactly matches distributable profit (৳${allocResult.totalAllocatedEconomicProfit})`
  );
  assert(
    allocResult.remainingEconomicProfit === 0,
    `Zero remaining economic profit / zero penny leakage (৳${allocResult.remainingEconomicProfit})`
  );

  // 7. Verify user contractual profit-sharing percentages are preserved and not applied to total profit
  assert(
    earlierAlloc.investorProfit === 100,
    `Earlier investor contractual share (50% of allocated ৳200) = ৳100 (got ৳${earlierAlloc.investorProfit})`
  );
  assert(
    earlierAlloc.mudaribProfit === 100,
    `Working partner share from earlier investor (50% of ৳200) = ৳100 (got ৳${earlierAlloc.mudaribProfit})`
  );
  assert(
    laterAlloc.investorProfit === 60,
    `Later investor contractual share (60% of allocated ৳100) = ৳60 (got ৳${laterAlloc.investorProfit})`
  );
  assert(
    laterAlloc.mudaribProfit === 40,
    `Working partner share from later investor (40% of ৳100) = ৳40 (got ৳${laterAlloc.mudaribProfit})`
  );

  const totalInvestorProfit = (earlierAlloc.investorProfit || 0) + (laterAlloc.investorProfit || 0);
  const totalMudaribProfit = (earlierAlloc.mudaribProfit || 0) + (laterAlloc.mudaribProfit || 0);
  assert(
    totalInvestorProfit + totalMudaribProfit === distributableProfit,
    `Total investor profit (৳${totalInvestorProfit}) + Total mudarib profit (৳${totalMudaribProfit}) = ৳${distributableProfit}`
  );
  assert(
    allocResult.flatProfitSharingAntiPatternPrevented === true,
    'Contractual rates not applied directly to total farm profit (anti-pattern blocked)'
  );

  // --- SCENARIO 2: Unconfigured allocationMethod automatically uses time-weighting when dates differ ---
  console.log('\n--- Scenario 2: Implicit Time-Weighting When Entry Dates Differ ---');
  const implicitResult = calculateEconomicAllocationByCapital({
    distributableProfit: 300,
    participants: [
      { id: 'p1', eligibleCapital: 50000, entryDate: '2026-01-01' },
      { id: 'p2', eligibleCapital: 50000, entryDate: '2026-02-15' }
    ],
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-03-31'
  });

  const p1Alloc = implicitResult.allocations.find((a) => a.participantId === 'p1')!;
  const p2Alloc = implicitResult.allocations.find((a) => a.participantId === 'p2')!;

  assert(
    p2Alloc.allocatedEconomicProfit !== p1Alloc.allocatedEconomicProfit,
    `Different entry dates produce different allocations with equal capital: P1=৳${p1Alloc.allocatedEconomicProfit}, P2=৳${p2Alloc.allocatedEconomicProfit}`
  );
  assert(
    p1Alloc.allocatedEconomicProfit === 200 && p2Alloc.allocatedEconomicProfit === 100,
    'Implicit time-weighted weighting resolves to 200 and 100 exactly'
  );

  // Summary
  console.log('\n================================================================');
  console.log('TASK 4 REGRESSION TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Allow direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runTask4InvestorEconomicAllocationTests().then((res) => {
    if (res.failed > 0) {
      console.error('Task 4 tests failed.');
      process.exit(1);
    } else {
      console.log('Task 4 tests passed cleanly.');
      process.exit(0);
    }
  });
}
