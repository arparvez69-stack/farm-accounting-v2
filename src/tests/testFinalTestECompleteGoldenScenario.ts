import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { runCompleteGoldenScenario, GoldenScenarioResult } from '../services/goldenScenarioService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST E — Complete Golden Scenario
 *
 * Requirements:
 * Run this complete scenario:
 *   A invests 100 in January.
 *   B invests 200 in January.
 *   Business makes 300 distributable profit.
 *   A contract = 50%.
 *   B contract = 60%.
 *
 * Expected:
 *   A economic profit = 100.
 *   B economic profit = 200.
 *   A investor profit = 50.
 *   A Mudarib share = 50.
 *   B investor profit = 120.
 *   B Mudarib share = 80.
 *   Total investor profit = 170.
 *   Total Mudarib profit = 130.
 *
 * Then:
 *   A reinvests 50%.
 *   B reinvests 100%.
 *
 * Verify:
 *   - All capital balances
 *   - Settlement amounts
 *   - Accounting entries
 *   - Future capital positions
 *
 * Then perform a new valuation.
 * Return PASS only if the complete lifecycle reconciles.
 */
export async function runFinalTestECompleteGoldenScenario(): Promise<AssertionResult> {
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
  console.log('FINAL TEST E — COMPLETE GOLDEN SCENARIO');
  console.log('Testing: Full End-to-End Islamic Mudarabah Lifecycle,');
  console.log('Two-Tier Capital Allocation, Asymmetric Contracts,');
  console.log('Partial/Full Reinvestments, Double-Entry GL Ledger, and Post-Settlement NAV');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  const scenario: GoldenScenarioResult = await runCompleteGoldenScenario(dbInstance);

  // ---------------------------------------------------------------------------
  // STEP 1: Capital Injections in January
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Capital Injections Verification ---');
  assert(scenario.step1Capital.investorA.capital === 100, `Investor A initial capital = ৳100 (got ${scenario.step1Capital.investorA.capital})`);
  assert(scenario.step1Capital.investorB.capital === 200, `Investor B initial capital = ৳200 (got ${scenario.step1Capital.investorB.capital})`);
  assert(scenario.step1Capital.totalCapital === 300, `Total initial capital = ৳300 (got ${scenario.step1Capital.totalCapital})`);
  assert(scenario.step1Capital.bankBalance === 300, `Initial bank cash balance = ৳300 (got ${scenario.step1Capital.bankBalance})`);

  // ---------------------------------------------------------------------------
  // STEP 2: Operations & Distributable Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Operations & Profit Generation Verification ---');
  assert(scenario.step2Operations.revenue === 500, `Operating revenue = ৳500 (got ${scenario.step2Operations.revenue})`);
  assert(scenario.step2Operations.expenses === 200, `Operating expenses = ৳200 (got ${scenario.step2Operations.expenses})`);
  assert(scenario.step2Operations.distributableProfit === 300, `Distributable business profit = ৳300 (got ${scenario.step2Operations.distributableProfit})`);
  assert(scenario.step2Operations.bankBalance === 600, `Pre-settlement bank cash balance = ৳600 (got ${scenario.step2Operations.bankBalance})`);

  // ---------------------------------------------------------------------------
  // STEP 3: Profit Allocation Equations
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Two-Tier Profit Allocation Verification ---');

  // A calculations
  assert(scenario.step3ProfitAllocation.investorA.economicProfit === 100, `A economic profit = ৳100 (got ${scenario.step3ProfitAllocation.investorA.economicProfit})`);
  assert(scenario.step3ProfitAllocation.investorA.contractPercentage === 50, `A contract = 50% (got ${scenario.step3ProfitAllocation.investorA.contractPercentage}%)`);
  assert(scenario.step3ProfitAllocation.investorA.investorProfit === 50, `A investor profit = ৳50 (got ${scenario.step3ProfitAllocation.investorA.investorProfit})`);
  assert(scenario.step3ProfitAllocation.investorA.mudaribShare === 50, `A Mudarib share = ৳50 (got ${scenario.step3ProfitAllocation.investorA.mudaribShare})`);
  assert(
    scenario.step3ProfitAllocation.investorA.investorProfit + scenario.step3ProfitAllocation.investorA.mudaribShare === 100,
    'A: Investor Profit (50) + Mudarib Share (50) === Economic Profit (100)'
  );

  // B calculations
  assert(scenario.step3ProfitAllocation.investorB.economicProfit === 200, `B economic profit = ৳200 (got ${scenario.step3ProfitAllocation.investorB.economicProfit})`);
  assert(scenario.step3ProfitAllocation.investorB.contractPercentage === 60, `B contract = 60% (got ${scenario.step3ProfitAllocation.investorB.contractPercentage}%)`);
  assert(scenario.step3ProfitAllocation.investorB.investorProfit === 120, `B investor profit = ৳120 (got ${scenario.step3ProfitAllocation.investorB.investorProfit})`);
  assert(scenario.step3ProfitAllocation.investorB.mudaribShare === 80, `B Mudarib share = ৳80 (got ${scenario.step3ProfitAllocation.investorB.mudaribShare})`);
  assert(
    scenario.step3ProfitAllocation.investorB.investorProfit + scenario.step3ProfitAllocation.investorB.mudaribShare === 200,
    'B: Investor Profit (120) + Mudarib Share (80) === Economic Profit (200)'
  );

  // Aggregate allocations
  assert(scenario.step3ProfitAllocation.totalInvestorProfit === 170, `Total investor profit = ৳170 (got ${scenario.step3ProfitAllocation.totalInvestorProfit})`);
  assert(scenario.step3ProfitAllocation.totalMudaribProfit === 130, `Total Mudarib profit = ৳130 (got ${scenario.step3ProfitAllocation.totalMudaribProfit})`);
  assert(scenario.step3ProfitAllocation.sumProfits === 300, `Sum (Investor 170 + Mudarib 130) = ৳300 Distributable Profit (got ${scenario.step3ProfitAllocation.sumProfits})`);
  assert(scenario.step3ProfitAllocation.isAllocatedCleanly === true, 'No unallocated profit leakage');

  // ---------------------------------------------------------------------------
  // STEP 4: Settlements & Future Capital Positions
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Settlement & Future Capital Position Verification ---');

  // A settlements (50% reinvest, 50% payout)
  assert(scenario.step4Settlement.investorA.reinvestPercentage === 50, `A reinvest percentage = 50% (got ${scenario.step4Settlement.investorA.reinvestPercentage}%)`);
  assert(scenario.step4Settlement.investorA.reinvestedCapital === 25, `A reinvested capital = ৳25 (got ${scenario.step4Settlement.investorA.reinvestedCapital})`);
  assert(scenario.step4Settlement.investorA.withdrawableAmount === 25, `A withdrawable cash payout = ৳25 (got ${scenario.step4Settlement.investorA.withdrawableAmount})`);
  assert(scenario.step4Settlement.investorA.initialCapital === 100, `A initial capital = ৳100 (got ${scenario.step4Settlement.investorA.initialCapital})`);
  assert(scenario.step4Settlement.investorA.futureCapitalPosition === 125, `A future capital position = ৳125 (got ${scenario.step4Settlement.investorA.futureCapitalPosition})`);

  // B settlements (100% reinvest, 0% payout)
  assert(scenario.step4Settlement.investorB.reinvestPercentage === 100, `B reinvest percentage = 100% (got ${scenario.step4Settlement.investorB.reinvestPercentage}%)`);
  assert(scenario.step4Settlement.investorB.reinvestedCapital === 120, `B reinvested capital = ৳120 (got ${scenario.step4Settlement.investorB.reinvestedCapital})`);
  assert(scenario.step4Settlement.investorB.withdrawableAmount === 0, `B withdrawable cash payout = ৳0 (got ${scenario.step4Settlement.investorB.withdrawableAmount})`);
  assert(scenario.step4Settlement.investorB.initialCapital === 200, `B initial capital = ৳200 (got ${scenario.step4Settlement.investorB.initialCapital})`);
  assert(scenario.step4Settlement.investorB.futureCapitalPosition === 320, `B future capital position = ৳320 (got ${scenario.step4Settlement.investorB.futureCapitalPosition})`);

  // Aggregate settlement metrics
  assert(scenario.step4Settlement.totalReinvested === 145, `Total reinvested capital = ৳145 (A: 25 + B: 120) (got ${scenario.step4Settlement.totalReinvested})`);
  assert(scenario.step4Settlement.totalWithdrawn === 25, `Total withdrawn cash payout = ৳25 (A: 25 + B: 0) (got ${scenario.step4Settlement.totalWithdrawn})`);
  assert(
    scenario.step4Settlement.bankBalanceAfterSettlement === 575,
    `Post-settlement bank cash balance = ৳575 (600 - 25) (got ${scenario.step4Settlement.bankBalanceAfterSettlement})`
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Post-Settlement Valuation & Complete Lifecycle Reconciliation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Post-Settlement Valuation & Complete Reconciliation ---');
  assert(scenario.step5PostSettlementValuation.totalAssets === 575, `Total Post-Settlement Assets = ৳575 (got ${scenario.step5PostSettlementValuation.totalAssets})`);
  assert(scenario.step5PostSettlementValuation.totalLiabilities === 0, `Total Post-Settlement Liabilities = ৳0 (got ${scenario.step5PostSettlementValuation.totalLiabilities})`);
  assert(
    scenario.step5PostSettlementValuation.nav === 575,
    `New Valuation: NAV = Assets (৳575) - Liabilities (৳0) = ৳575 (got ${scenario.step5PostSettlementValuation.nav})`
  );
  assert(scenario.step5PostSettlementValuation.isBalanced === true, 'General Ledger trial balance is strictly balanced');
  assert(scenario.lifecycleReconciled === true, 'Complete Lifecycle is strictly reconciled without discrepancies');
  assert(scenario.discrepancies.length === 0, `Zero discrepancies reported (discrepancies: ${scenario.discrepancies.join(', ') || 'none'})`);

  console.log('\n================================================================');
  console.log('FINAL TEST E SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestECompleteGoldenScenario.ts') || process.argv[1]?.endsWith('testFinalTestECompleteGoldenScenario.js')) {
  runFinalTestECompleteGoldenScenario()
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
