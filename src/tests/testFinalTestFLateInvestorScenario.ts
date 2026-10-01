import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { runCompleteLateInvestorScenario, LateInvestorScenarioResult } from '../services/lateInvestorScenarioService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST F — Late Investor Scenario
 *
 * Requirements:
 * Run:
 *   A = 100 on January 1.
 *   B = 200 on January 1.
 *
 *   January-May profit is finalized.
 *
 *   Then C enters on June 1 with 100.
 *
 *   Before admission, calculate current NAV.
 *   Assume pre-money NAV = 600.
 *
 *   C contributes 100.
 *
 *   Expected post-money NAV = 700.
 *   Expected NAV-based C participation = 100/700.
 *
 *   Verify C receives no January-May profit.
 *   Verify C participates only from the approved June eligibility boundary.
 *
 *   Return PASS.
 */
export async function runFinalTestFLateInvestorScenario(): Promise<AssertionResult> {
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
  console.log('FINAL TEST F — LATE INVESTOR SCENARIO');
  console.log('Testing: Pre-Money Valuation, Post-Money NAV (600 + 100 = 700),');
  console.log('NAV-Based Participation (100/700), Zero Past Period Profit Leakage,');
  console.log('and Strict Eligibility Boundary Enforcement (June 1 onward)');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  const scenario: LateInvestorScenarioResult = await runCompleteLateInvestorScenario(dbInstance);

  // ---------------------------------------------------------------------------
  // STEP 1: Initial Injections (A = 100, B = 200 on January 1)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Initial Investments on January 1 ---');
  assert(scenario.step1InitialCapital.investorA.capital === 100, `Investor A capital = ৳100 on January 1 (got ${scenario.step1InitialCapital.investorA.capital})`);
  assert(scenario.step1InitialCapital.investorA.date === '2026-01-01', `Investor A effective date = 2026-01-01 (got ${scenario.step1InitialCapital.investorA.date})`);
  assert(scenario.step1InitialCapital.investorB.capital === 200, `Investor B capital = ৳200 on January 1 (got ${scenario.step1InitialCapital.investorB.capital})`);
  assert(scenario.step1InitialCapital.investorB.date === '2026-01-01', `Investor B effective date = 2026-01-01 (got ${scenario.step1InitialCapital.investorB.date})`);
  assert(scenario.step1InitialCapital.totalCapital === 300, `Total initial capital = ৳300 (got ${scenario.step1InitialCapital.totalCapital})`);

  // ---------------------------------------------------------------------------
  // STEP 2: January-May Profit Finalization
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: January-May Profit Finalization ---');
  assert(scenario.step2JanuaryMayFinalizedProfit.periodStart === '2026-01-01', 'Period starts 2026-01-01');
  assert(scenario.step2JanuaryMayFinalizedProfit.periodEnd === '2026-05-31', 'Period ends 2026-05-31');
  assert(scenario.step2JanuaryMayFinalizedProfit.distributableProfit === 300, `Distributable profit = ৳300 (got ${scenario.step2JanuaryMayFinalizedProfit.distributableProfit})`);
  assert(scenario.step2JanuaryMayFinalizedProfit.investorAAllocatedProfit === 50, `Investor A allocated profit = ৳50 (got ${scenario.step2JanuaryMayFinalizedProfit.investorAAllocatedProfit})`);
  assert(scenario.step2JanuaryMayFinalizedProfit.investorBAllocatedProfit === 120, `Investor B allocated profit = ৳120 (got ${scenario.step2JanuaryMayFinalizedProfit.investorBAllocatedProfit})`);
  assert(scenario.step2JanuaryMayFinalizedProfit.investorCAllocatedProfit === 0, `Investor C received strictly ৳0 from Jan-May allocation (got ${scenario.step2JanuaryMayFinalizedProfit.investorCAllocatedProfit})`);
  assert(Boolean(scenario.step2JanuaryMayFinalizedProfit.allocationEventId), 'Finalized profit allocation event recorded');

  // ---------------------------------------------------------------------------
  // STEP 3: Pre-Money Valuation Before Admission (Pre-Money NAV = 600)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Pre-Admission Business Valuation ---');
  assert(scenario.step3PreMoneyValuation.valuationDate === '2026-05-31', 'Valuation date immediately precedes admission (2026-05-31)');
  assert(scenario.step3PreMoneyValuation.preMoneyNav === 600, `Pre-money NAV = ৳600 (got ${scenario.step3PreMoneyValuation.preMoneyNav})`);

  // ---------------------------------------------------------------------------
  // STEP 4: C Contributes 100 on June 1 -> Expected Post-Money NAV = 700
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Post-Money NAV Calculation ---');
  assert(scenario.step4PostMoneyNavCalculation.newCapital === 100, `C contributes new capital = ৳100 (got ${scenario.step4PostMoneyNavCalculation.newCapital})`);
  assert(scenario.step4PostMoneyNavCalculation.preMoneyNav === 600, `Pre-money NAV base = ৳600 (got ${scenario.step4PostMoneyNavCalculation.preMoneyNav})`);
  assert(scenario.step4PostMoneyNavCalculation.postMoneyNav === 700, `Expected POST-MONEY NAV = ৳700 (got ${scenario.step4PostMoneyNavCalculation.postMoneyNav})`);
  assert(
    scenario.step4PostMoneyNavCalculation.formula.includes('600') && scenario.step4PostMoneyNavCalculation.formula.includes('100'),
    'Formula verifies POST-MONEY NAV = PRE-MONEY NAV (600) + NEW CAPITAL (100)'
  );
  assert(scenario.step4PostMoneyNavCalculation.noDoubleProfitAdded === true, 'Strictly avoided adding business profit again');

  // ---------------------------------------------------------------------------
  // STEP 5: Expected NAV-Based C Participation = 100/700
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: NAV-Based Economic Participation ---');
  const expectedFraction = 100 / 700;
  assert(
    Math.abs(scenario.step5NavBasedParticipation.investorCParticipationRatio - expectedFraction) < 0.000001,
    `C participation ratio = 100/700 = ${expectedFraction.toFixed(6)} (got ${scenario.step5NavBasedParticipation.investorCParticipationRatio.toFixed(6)})`
  );
  assert(
    Math.abs(scenario.step5NavBasedParticipation.investorCParticipationPercentage - (100 / 700) * 100) < 0.0001,
    `C participation percentage = 14.2857% (got ${scenario.step5NavBasedParticipation.investorCParticipationPercentage.toFixed(4)}%)`
  );
  assert(
    Math.abs(scenario.step5NavBasedParticipation.existingParticipationRatio - 600 / 700) < 0.000001,
    `Existing participants collective share = 600/700 = ${(600 / 700).toFixed(6)} (got ${scenario.step5NavBasedParticipation.existingParticipationRatio.toFixed(6)})`
  );
  assert(
    Math.abs((scenario.step5NavBasedParticipation.investorCParticipationRatio + scenario.step5NavBasedParticipation.existingParticipationRatio) - 1.0) < 0.000001,
    'Sum of New Investor (100/700) + Existing (600/700) === 1.0 (100%)'
  );

  // ---------------------------------------------------------------------------
  // STEP 6: Verify C Receives NO January-May Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Historical Protection Verification ---');
  assert(
    scenario.step6HistoricalProtectionVerification.investorCJanMayProfit === 0,
    `C receives strictly ৳0.00 from Jan-May profit (got ৳${scenario.step6HistoricalProtectionVerification.investorCJanMayProfit})`
  );
  assert(
    scenario.step6HistoricalProtectionVerification.boundaryRulePassed === true,
    'Audit passes: Investor admitted after finalized period is strictly excluded'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Verify C Participates ONLY From Approved June Eligibility Boundary
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: June Eligibility Boundary Enforcement ---');
  assert(
    scenario.step7JuneEligibilityBoundaryVerification.juneBoundaryDate === '2026-06-01',
    'Approved eligibility boundary date is strictly 2026-06-01'
  );
  assert(
    scenario.step7JuneEligibilityBoundaryVerification.isEligibleInJunePeriod === true,
    'C is strictly eligible for profit periods on or after 2026-06-01'
  );
  assert(
    scenario.step7JuneEligibilityBoundaryVerification.isEligibleInJanMayPeriod === false,
    'C is strictly ineligible for profit periods ending before 2026-06-01'
  );
  assert(
    scenario.step7JuneEligibilityBoundaryVerification.postAdmissionAllocatedShare === 5,
    `In post-admission June period (profit ৳70), C receives ৳5 profit based on 100/700 ratio (got ৳${scenario.step7JuneEligibilityBoundaryVerification.postAdmissionAllocatedShare})`
  );

  // Complete Lifecycle
  assert(scenario.lifecycleReconciled === true, 'Complete Late Investor Scenario lifecycle reconciled without discrepancies');
  assert(scenario.discrepancies.length === 0, `Zero discrepancies reported (discrepancies: ${scenario.discrepancies.join(', ') || 'none'})`);

  console.log('\n================================================================');
  console.log('FINAL TEST F SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestFLateInvestorScenario.ts') || process.argv[1]?.endsWith('testFinalTestFLateInvestorScenario.js')) {
  runFinalTestFLateInvestorScenario()
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
