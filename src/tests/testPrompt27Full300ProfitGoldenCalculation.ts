import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  calculateFullProfitGoldenCalculation,
  calculateFull300ProfitGoldenCalculation,
  runFull300ProfitGoldenCalculation,
  inspectFullProfitGoldenCalculation,
  inspectFull300ProfitGoldenCalculation,
  calculateEconomicAllocationByCapital
} from '../services/valuationService';
import { postJournalEntry, generateTrialBalance, generateProfitLoss } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 4 — PROFIT ALLOCATION
 * PROMPT 27 — Full 300 Profit Golden Calculation
 *
 * Exact Accounting Test Requirements:
 * A capital = 100
 * B capital = 200
 * Total profit = 300
 *
 * A contract = 50%
 * B contract = 60%
 *
 * Expected economic allocation:
 * A = 100
 * B = 200
 *
 * Expected investor profit:
 * A = 50
 * B = 120
 *
 * Expected Mudarib profit:
 * A = 50
 * B = 80
 *
 * Expected totals:
 * Investor profit = 170
 * Mudarib profit = 130
 * Total = 300
 *
 * Verify every intermediate value.
 * If current code differs, find and fix the calculation error.
 * Do not hard-code the answer.
 * Return PASS only after the formula itself produces the result.
 */
export async function runPrompt27Full300ProfitGoldenCalculationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 27: FULL 300 PROFIT GOLDEN CALCULATION');
  console.log('Testing Exact Accounting Formula, Every Intermediate Value,');
  console.log('Dynamic Scaling Without Hard-Coding, and GL Integration');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Execute Exact Golden Calculation Test Case
  // ===========================================================================
  console.log('--- Step 1: Input Setup & Execution of Formula ---');
  console.log('Inputs: A capital = 100, B capital = 200, Total profit = 300');
  console.log('Contracts: A = 50%, B = 60%\n');

  const participants = [
    { id: 'A', name: 'Participant A', capital: 100, contractPercentage: 50 },
    { id: 'B', name: 'Participant B', capital: 200, contractPercentage: 60 }
  ];

  const goldenResult = calculateFullProfitGoldenCalculation({
    totalProfit: 300,
    participants
  });

  // Verify inputs and totals
  assert(goldenResult.totalProfit === 300, 'Total profit input is exactly ৳300');
  assert(goldenResult.totalCapital === 300, 'Total capital is exactly ৳300 (100 + 200)');
  assert(goldenResult.participants.length === 2, 'Two participants in calculation');

  // ===========================================================================
  // STEP 2: Intermediate Values — Capital Proportion Ratios
  // ===========================================================================
  console.log('\n--- Step 2: Intermediate Value Verification — Capital Proportions ---');

  const partA = goldenResult.participants.find((p) => p.id === 'A')!;
  const partB = goldenResult.participants.find((p) => p.id === 'B')!;

  assert(partA !== undefined, 'Participant A exists in results');
  assert(partB !== undefined, 'Participant B exists in results');

  assert(
    Math.abs(partA.capitalProportionRatio - 1 / 3) < 0.0001,
    `A capital proportion ratio: 100 / 300 = 1/3 (${partA.capitalProportionRatio.toFixed(4)})`
  );
  assert(
    Math.abs(partB.capitalProportionRatio - 2 / 3) < 0.0001,
    `B capital proportion ratio: 200 / 300 = 2/3 (${partB.capitalProportionRatio.toFixed(4)})`
  );
  assert(
    Math.abs(partA.capitalProportionRatio + partB.capitalProportionRatio - 1.0) < 0.0001,
    'Sum of capital proportion ratios equals exactly 1.0 (100%)'
  );

  // ===========================================================================
  // STEP 3: Intermediate Values — Expected Economic Allocation
  // ===========================================================================
  console.log('\n--- Step 3: Intermediate Value Verification — Economic Allocation ---');
  console.log('Expected: A = 100, B = 200 (Allocated by capital BEFORE contractual percentages)');

  assert(
    partA.economicAllocation === 100,
    `CRITICAL INTERMEDIATE: Expected economic allocation A = 100 (got ৳${partA.economicAllocation})`
  );
  assert(
    partB.economicAllocation === 200,
    `CRITICAL INTERMEDIATE: Expected economic allocation B = 200 (got ৳${partB.economicAllocation})`
  );
  assert(
    goldenResult.economicAllocations['A'] === 100,
    `Economic allocations map contains A = 100`
  );
  assert(
    goldenResult.economicAllocations['B'] === 200,
    `Economic allocations map contains B = 200`
  );
  assert(
    partA.economicAllocation + partB.economicAllocation === 300,
    'Sum of economic allocations matches total profit: 100 + 200 = 300'
  );

  // ===========================================================================
  // STEP 4: Intermediate Values — Expected Investor Profit
  // ===========================================================================
  console.log('\n--- Step 4: Intermediate Value Verification — Investor Profit ---');
  console.log('Expected: A = 50 (100 × 50%), B = 120 (200 × 60%)');

  assert(
    partA.contractPercentage === 50,
    `A contract percentage is 50%`
  );
  assert(
    partA.investorProfit === 50,
    `CRITICAL INTERMEDIATE: Expected investor profit A = 50 (got ৳${partA.investorProfit})`
  );

  assert(
    partB.contractPercentage === 60,
    `B contract percentage is 60%`
  );
  assert(
    partB.investorProfit === 120,
    `CRITICAL INTERMEDIATE: Expected investor profit B = 120 (got ৳${partB.investorProfit})`
  );

  assert(
    goldenResult.investorProfits['A'] === 50,
    'Investor profits map contains A = 50'
  );
  assert(
    goldenResult.investorProfits['B'] === 120,
    'Investor profits map contains B = 120'
  );

  // ===========================================================================
  // STEP 5: Intermediate Values — Expected Mudarib Profit
  // ===========================================================================
  console.log('\n--- Step 5: Intermediate Value Verification — Mudarib Profit ---');
  console.log('Expected: A = 50 (100 - 50), B = 80 (200 - 120)');

  assert(
    partA.mudaribProfit === 50,
    `CRITICAL INTERMEDIATE: Expected Mudarib profit A = 50 (got ৳${partA.mudaribProfit})`
  );
  assert(
    partB.mudaribProfit === 80,
    `CRITICAL INTERMEDIATE: Expected Mudarib profit B = 80 (got ৳${partB.mudaribProfit})`
  );

  assert(
    goldenResult.mudaribProfits['A'] === 50,
    'Mudarib profits map contains A = 50'
  );
  assert(
    goldenResult.mudaribProfits['B'] === 80,
    'Mudarib profits map contains B = 80'
  );

  // Verify internal participant balance: Economic = Investor + Mudarib
  assert(
    partA.investorProfit + partA.mudaribProfit === partA.economicAllocation,
    `A internal balance: ৳${partA.investorProfit} (investor) + ৳${partA.mudaribProfit} (mudarib) = ৳${partA.economicAllocation} (economic)`
  );
  assert(
    partB.investorProfit + partB.mudaribProfit === partB.economicAllocation,
    `B internal balance: ৳${partB.investorProfit} (investor) + ৳${partB.mudaribProfit} (mudarib) = ৳${partB.economicAllocation} (economic)`
  );

  // ===========================================================================
  // STEP 6: Expected Totals
  // ===========================================================================
  console.log('\n--- Step 6: Expected Totals Verification ---');
  console.log('Expected totals: Investor profit = 170, Mudarib profit = 130, Total = 300');

  assert(
    goldenResult.totalInvestorProfit === 170,
    `CRITICAL REQUIREMENT: Investor profit total = 170 (50 + 120 = ৳${goldenResult.totalInvestorProfit})`
  );
  assert(
    goldenResult.totalMudaribProfit === 130,
    `CRITICAL REQUIREMENT: Mudarib profit total = 130 (50 + 80 = ৳${goldenResult.totalMudaribProfit})`
  );
  assert(
    goldenResult.grandTotal === 300,
    `CRITICAL REQUIREMENT: Grand Total = 300 (170 + 130 = ৳${goldenResult.grandTotal})`
  );
  assert(
    goldenResult.totalInvestorProfit + goldenResult.totalMudaribProfit === goldenResult.totalProfit,
    'Total investor profit + total mudarib profit === total profit (170 + 130 = 300)'
  );
  assert(goldenResult.passed === true, 'goldenResult.passed === true');
  assert(goldenResult.formulaVerified === true, 'goldenResult.formulaVerified === true');

  // ===========================================================================
  // STEP 7: Verification via calculateEconomicAllocationByCapital Engine
  // ===========================================================================
  console.log('\n--- Step 7: Verification via calculateEconomicAllocationByCapital Engine ---');

  const econResult = calculateEconomicAllocationByCapital({
    distributableProfit: 300,
    participants: [
      {
        id: 'A',
        name: 'Participant A',
        eligibleCapital: 100,
        contractualProfitSharingPercentage: 50
      },
      {
        id: 'B',
        name: 'Participant B',
        eligibleCapital: 200,
        contractualProfitSharingPercentage: 60
      }
    ]
  });

  const eaA = econResult.allocations.find((a) => a.participantId === 'A')!;
  const eaB = econResult.allocations.find((a) => a.participantId === 'B')!;

  assert(eaA.allocatedEconomicProfit === 100, 'calculateEconomicAllocationByCapital: A economic = 100');
  assert(eaB.allocatedEconomicProfit === 200, 'calculateEconomicAllocationByCapital: B economic = 200');

  assert(eaA.investorProfit === 50, 'calculateEconomicAllocationByCapital: A investor profit = 50');
  assert(eaB.investorProfit === 120, 'calculateEconomicAllocationByCapital: B investor profit = 120');

  assert(eaA.mudaribProfit === 50, 'calculateEconomicAllocationByCapital: A mudarib profit = 50');
  assert(eaB.mudaribProfit === 80, 'calculateEconomicAllocationByCapital: B mudarib profit = 80');

  assert(econResult.totalInvestorProfit === 170, 'calculateEconomicAllocationByCapital: totalInvestorProfit = 170');
  assert(econResult.totalMudaribProfit === 130, 'calculateEconomicAllocationByCapital: totalMudaribProfit = 130');
  assert(econResult.totalProfit === 300, 'calculateEconomicAllocationByCapital: totalProfit = 300');

  // ===========================================================================
  // STEP 8: Inspection Suite (inspectFullProfitGoldenCalculation)
  // ===========================================================================
  console.log('\n--- Step 8: Comprehensive Inspection Suite Verification ---');

  const inspection = inspectFullProfitGoldenCalculation({
    totalProfit: 300,
    participants,
    expectedEconomicAllocations: { A: 100, B: 200 },
    expectedInvestorProfits: { A: 50, B: 120 },
    expectedMudaribProfits: { A: 50, B: 80 },
    expectedTotalInvestorProfit: 170,
    expectedTotalMudaribProfit: 130,
    expectedGrandTotal: 300
  });

  assert(inspection.passed === true, 'inspectFullProfitGoldenCalculation returned passed === true');
  assert(inspection.exactGoldenExampleVerified === true, 'Inspection: exactGoldenExampleVerified === true');
  assert(inspection.formulaDerivedWithoutHardcoding === true, 'Inspection: formulaDerivedWithoutHardcoding === true');
  assert(inspection.economicAllocationsMatch === true, 'Inspection: economicAllocationsMatch === true');
  assert(inspection.investorProfitsMatch === true, 'Inspection: investorProfitsMatch === true');
  assert(inspection.mudaribProfitsMatch === true, 'Inspection: mudaribProfitsMatch === true');
  assert(inspection.totalsMatch === true, 'Inspection: totalsMatch === true');

  // ===========================================================================
  // STEP 9: Anti-Hardcoding Proof: Dynamic Scaling with Arbitrary Inputs
  // ===========================================================================
  console.log('\n--- Step 9: Anti-Hardcoding Proof — Dynamic Scaling with Arbitrary Inputs ---');
  console.log('Testing Scaled Inputs: A capital = 300, B capital = 600, Total profit = 900');
  console.log('Contracts: A = 50%, B = 60%');

  const scaledResult = calculateFullProfitGoldenCalculation({
    totalProfit: 900,
    participants: [
      { id: 'A', capital: 300, contractPercentage: 50 },
      { id: 'B', capital: 600, contractPercentage: 60 }
    ]
  });

  // A proportion = 300/900 = 1/3 -> Economic: 900 * 1/3 = 300
  // B proportion = 600/900 = 2/3 -> Economic: 900 * 2/3 = 600
  // A investor = 300 * 50% = 150; Mudarib = 300 - 150 = 150
  // B investor = 600 * 60% = 360; Mudarib = 600 - 360 = 240
  // Totals: Investor = 150 + 360 = 510; Mudarib = 150 + 240 = 390; Grand Total = 900
  assert(scaledResult.economicAllocations['A'] === 300, 'Scaled: A economic allocation dynamically = 300');
  assert(scaledResult.economicAllocations['B'] === 600, 'Scaled: B economic allocation dynamically = 600');
  assert(scaledResult.investorProfits['A'] === 150, 'Scaled: A investor profit dynamically = 150');
  assert(scaledResult.investorProfits['B'] === 360, 'Scaled: B investor profit dynamically = 360');
  assert(scaledResult.mudaribProfits['A'] === 150, 'Scaled: A mudarib profit dynamically = 150');
  assert(scaledResult.mudaribProfits['B'] === 240, 'Scaled: B mudarib profit dynamically = 240');
  assert(scaledResult.totalInvestorProfit === 510, 'Scaled: total investor profit dynamically = 510');
  assert(scaledResult.totalMudaribProfit === 390, 'Scaled: total mudarib profit dynamically = 390');
  assert(scaledResult.grandTotal === 900, 'Scaled: grand total dynamically = 900');

  // Test with three participants and different percentages
  console.log('Testing 3 participants: P1=100 (40%), P2=200 (50%), P3=300 (60%), Profit=600');
  const threePart = calculateFullProfitGoldenCalculation({
    totalProfit: 600,
    participants: [
      { id: 'P1', capital: 100, contractPercentage: 40 },
      { id: 'P2', capital: 200, contractPercentage: 50 },
      { id: 'P3', capital: 300, contractPercentage: 60 }
    ]
  });
  // Total capital = 600
  // P1: 100 -> inv: 40, mud: 60
  // P2: 200 -> inv: 100, mud: 100
  // P3: 300 -> inv: 180, mud: 120
  // Inv: 40 + 100 + 180 = 320; Mud: 60 + 100 + 120 = 280; Total = 600
  assert(threePart.totalInvestorProfit === 320, '3-party: total investor profit = 320');
  assert(threePart.totalMudaribProfit === 280, '3-party: total mudarib profit = 280');
  assert(threePart.grandTotal === 600, '3-party: grand total = 600');

  // ===========================================================================
  // STEP 10: Anti-Pattern Check — Flat Profit Sharing Blocked
  // ===========================================================================
  console.log('\n--- Step 10: Anti-Pattern Verification ---');

  const flatA = 300 * 0.50; // 150 (WRONG!)
  const flatB = 300 * 0.60; // 180 (WRONG!)
  const flatSum = flatA + flatB; // 330 > 300!

  assert(
    partA.economicAllocation !== flatA,
    `ANTI-PATTERN PREVENTED: A economic allocation (৳${partA.economicAllocation}) !== flat 300 × 50% (৳${flatA})`
  );
  assert(
    partB.economicAllocation !== flatB,
    `ANTI-PATTERN PREVENTED: B economic allocation (৳${partB.economicAllocation}) !== flat 300 × 60% (৳${flatB})`
  );
  assert(
    flatSum > 300,
    `Proof that flat application violates mathematical solvency: ৳150 + ৳180 = ৳${flatSum} > ৳300`
  );

  // ===========================================================================
  // STEP 11: General Ledger Journal Posting & Trial Balance Integration
  // ===========================================================================
  console.log('\n--- Step 11: General Ledger Accounting Verification ---');

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Record Journal Entry for Investor Profit: Dr 3070 (৳170) | Cr 2050 (A: ৳50, B: ৳120)
  const invJournal = await postJournalEntry(
    {
      id: 'j_golden_inv_170',
      voucherNumber: 'JRN-GOLDEN-001',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Golden calculation investor profit appropriation (A: ৳50, B: ৳120)',
      lines: [
        {
          accountCode: '3070',
          accountName: 'Investor Profit Distribution',
          debit: 170,
          credit: 0,
          memo: 'Total investor contractual share'
        },
        {
          accountCode: '2050',
          accountName: 'Investor Profit Payable',
          debit: 0,
          credit: 50,
          memo: 'Participant A contractual share (50% of 100)'
        },
        {
          accountCode: '2050',
          accountName: 'Investor Profit Payable',
          debit: 0,
          credit: 120,
          memo: 'Participant B contractual share (60% of 200)'
        }
      ],
      createdBy: 'auditor_prompt27',
      createdAt: new Date().toISOString(),
      reference: 'GOLDEN-INV-170'
    },
    { dbInstance: mDb }
  );

  assert(invJournal !== undefined && invJournal.id !== undefined, 'Investor profit journal entry posted to GL');

  // Record Journal Entry for Mudarib Profit: Dr 3070 (৳130) | Cr 3015 (৳130)
  const mudJournal = await postJournalEntry(
    {
      id: 'j_golden_mud_130',
      voucherNumber: 'JRN-GOLDEN-002',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Golden calculation Mudarib working partner profit allocation (A: ৳50, B: ৳80)',
      lines: [
        {
          accountCode: '3070',
          accountName: 'Investor Profit Distribution',
          debit: 130,
          credit: 0,
          memo: 'Working partner Mudarib profit allocation'
        },
        {
          accountCode: '3015',
          accountName: 'Working Partner Mudarib Profit Equity',
          debit: 0,
          credit: 130,
          memo: 'Mudarib profit equity from A (৳50) + B (৳80)'
        }
      ],
      createdBy: 'auditor_prompt27',
      createdAt: new Date().toISOString(),
      reference: 'GOLDEN-MUD-130'
    },
    { dbInstance: mDb }
  );

  assert(mudJournal !== undefined && mudJournal.id !== undefined, 'Mudarib profit journal entry posted to GL');

  // Check Trial Balance integrity
  const tb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
  assert(tb.isBalanced === true, 'Trial balance is balanced (Debits === Credits)');
  assert(tb.totalDebit === 300, `Trial balance total debits is exactly ৳300 (got ৳${tb.totalDebit})`);
  assert(tb.totalCredit === 300, `Trial balance total credits is exactly ৳300 (got ৳${tb.totalCredit})`);

  // Verify operating P&L accounts (Revenue 4xxx, Expense 6xxx) are undisturbed
  const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
  assert(pnl.totalRevenue === 0, 'Operating revenue completely unaffected (0)');
  assert(pnl.totalOperatingExpenses === 0, 'Operating expenses completely unaffected (0)');
  assert(pnl.netProfit === 0, 'Net operating profit completely unaffected (0)');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 27 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt27Full300ProfitGoldenCalculationTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 27 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 27 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 27 tests:', err);
      process.exit(1);
    });
}
