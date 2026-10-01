import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  calculateNegativePeriodResultAllocation,
  inspectNegativePeriodResultHandling,
  handleNegativePeriodResult,
  calculateLossHandlingAllocation,
  createProfitAllocationEvent
} from '../services/valuationService';
import { executeFinalizedBusinessProfitAllocationToInvestors } from '../services/transactionService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 4 — PROFIT & LOSS ALLOCATION
 * PROMPT 28 — Loss Handling
 *
 * Requirements:
 * Inspect negative-period-result handling.
 *
 * If the finalized result is a loss:
 * - investor profit payable must not become negative;
 * - Mudarib profit must not become negative;
 * - the system must not manufacture profit;
 * - loss must remain visible;
 * - capital/economic balances must follow the configured loss policy.
 *
 * Do not simply reuse the positive-profit formula for negative values.
 *
 * Test a period with loss = 100.
 *
 * Expected investor profit = 0.
 * Expected Mudarib profit = 0.
 *
 * Return PASS.
 */
export async function runPrompt28LossHandlingTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 28: LOSS HANDLING & NEGATIVE PERIOD RESULT');
  console.log('Testing: Non-negative Profit Payable, Non-negative Mudarib Profit,');
  console.log('No Manufactured Profit, Loss Visibility, Configured Loss Policy,');
  console.log('Exact Example (Loss = 100 -> Investor = 0, Mudarib = 0), and GL Audit');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Test Exact Period with Loss = 100
  // ===========================================================================
  console.log('--- Step 1: Exact Loss = 100 Scenario Execution ---');
  console.log('Inputs: A capital = 100 (50%), B capital = 200 (60%), Loss = 100');

  const participants = [
    { id: 'A', name: 'Participant A', capital: 100, contractPercentage: 50 },
    { id: 'B', name: 'Participant B', capital: 200, contractPercentage: 60 }
  ];

  const lossResult = calculateNegativePeriodResultAllocation({
    periodResult: -100,
    loss: 100,
    participants,
    lossPolicy: 'PRO_RATA_CAPITAL_IMPAIRMENT'
  });

  // Verify basic loss detection
  assert(lossResult.isLoss === true, 'Period result correctly identified as a LOSS');
  assert(lossResult.lossAmount === 100, 'Loss amount is exactly ৳100');
  assert(lossResult.finalizedAccountingResult === -100, 'Finalized accounting result is visibly -100');
  assert(lossResult.totalOriginalCapital === 300, 'Total original capital is ৳300 (100 + 200)');

  // ===========================================================================
  // STEP 2: Expected Investor Profit = 0 (Must Not Become Negative)
  // ===========================================================================
  console.log('\n--- Step 2: Investor Profit Verification (Expected = 0, Non-negative) ---');

  const partA = lossResult.participants.find((p) => p.id === 'A')!;
  const partB = lossResult.participants.find((p) => p.id === 'B')!;

  assert(partA !== undefined, 'Participant A exists in loss result');
  assert(partB !== undefined, 'Participant B exists in loss result');

  // CRITICAL REQUIREMENT: Expected investor profit = 0
  assert(
    partA.investorProfit === 0,
    `CRITICAL REQUIREMENT: A investor profit is exactly 0 (got ৳${partA.investorProfit})`
  );
  assert(
    partB.investorProfit === 0,
    `CRITICAL REQUIREMENT: B investor profit is exactly 0 (got ৳${partB.investorProfit})`
  );
  assert(
    lossResult.totalInvestorProfit === 0,
    `CRITICAL REQUIREMENT: Expected total investor profit = 0 (got ৳${lossResult.totalInvestorProfit})`
  );

  // CRITICAL REQUIREMENT: Investor profit payable must not become negative
  assert(
    partA.investorProfitPayable === 0,
    `CRITICAL REQUIREMENT: A investor profit payable is 0 (strictly NOT negative)`
  );
  assert(
    partB.investorProfitPayable === 0,
    `CRITICAL REQUIREMENT: B investor profit payable is 0 (strictly NOT negative)`
  );
  assert(
    partA.investorProfitPayable >= 0 && partB.investorProfitPayable >= 0,
    'All investor profit payables are >= 0 (negative payable strictly barred)'
  );
  assert(
    lossResult.totalInvestorProfitPayable === 0,
    'Total investor profit payable is exactly 0'
  );

  // ===========================================================================
  // STEP 3: Expected Mudarib Profit = 0 (Must Not Become Negative)
  // ===========================================================================
  console.log('\n--- Step 3: Mudarib Profit Verification (Expected = 0, Non-negative) ---');

  // CRITICAL REQUIREMENT: Expected Mudarib profit = 0
  assert(
    partA.mudaribProfit === 0,
    `CRITICAL REQUIREMENT: A Mudarib profit is exactly 0 (got ৳${partA.mudaribProfit})`
  );
  assert(
    partB.mudaribProfit === 0,
    `CRITICAL REQUIREMENT: B Mudarib profit is exactly 0 (got ৳${partB.mudaribProfit})`
  );
  assert(
    lossResult.totalMudaribProfit === 0,
    `CRITICAL REQUIREMENT: Expected total Mudarib profit = 0 (got ৳${lossResult.totalMudaribProfit})`
  );

  // CRITICAL REQUIREMENT: Mudarib profit must not become negative
  assert(
    partA.mudaribProfit >= 0 && partB.mudaribProfit >= 0,
    'All Mudarib profits are >= 0 (negative Mudarib profit strictly barred)'
  );

  // ===========================================================================
  // STEP 4: System Must Not Manufacture Profit
  // ===========================================================================
  console.log('\n--- Step 4: Verification That Profit Is NOT Manufactured ---');

  assert(
    lossResult.distributableProfit === 0,
    `CRITICAL REQUIREMENT: Distributable profit is strictly ৳0 (got ৳${lossResult.distributableProfit})`
  );
  assert(
    lossResult.grandTotalDistributedProfit === 0,
    'Grand total distributed profit is strictly ৳0'
  );
  assert(
    lossResult.distributableProfit !== 100,
    'NEGATIVE ASSERTION: Loss of 100 is NOT converted into positive distributable profit'
  );

  // ===========================================================================
  // STEP 5: Loss Must Remain Visible
  // ===========================================================================
  console.log('\n--- Step 5: Loss Visibility Verification ---');

  assert(
    lossResult.lossRemainsVisible === true,
    'CRITICAL REQUIREMENT: Loss remains visible in system reporting'
  );
  assert(
    lossResult.finalizedAccountingResult === -100,
    'Accounting result visibly reflects deficit of -100 (loss = 100)'
  );
  assert(
    lossResult.lossAmount === 100,
    'Loss amount visibly stored as ৳100'
  );

  // ===========================================================================
  // STEP 6: Anti-Pattern Check: Positive Formula NOT Reused for Negative Values
  // ===========================================================================
  console.log('\n--- Step 6: Anti-Pattern Verification — Do Not Reuse Positive Formula ---');

  // If one naively reused the positive formula:
  // A economic = -100 * (1/3) = -33.33
  // A investor = -33.33 * 50% = -16.67 (NEGATIVE!)
  // B investor = -66.67 * 60% = -40 (NEGATIVE!)
  // Mudarib A = -16.67, Mudarib B = -26.67 (NEGATIVE!)
  const naiveAInvestor = -100 * (1 / 3) * 0.50;
  const naiveBInvestor = -100 * (2 / 3) * 0.60;
  const naiveAMudarib = -100 * (1 / 3) - naiveAInvestor;

  assert(
    partA.investorProfit !== naiveAInvestor,
    `ANTI-PATTERN PREVENTED: A investor profit (${partA.investorProfit}) !== naive formula result (${naiveAInvestor.toFixed(2)})`
  );
  assert(
    partB.investorProfit !== naiveBInvestor,
    `ANTI-PATTERN PREVENTED: B investor profit (${partB.investorProfit}) !== naive formula result (${naiveBInvestor.toFixed(2)})`
  );
  assert(
    partA.mudaribProfit !== naiveAMudarib,
    `ANTI-PATTERN PREVENTED: A Mudarib profit (${partA.mudaribProfit}) !== naive formula result (${naiveAMudarib.toFixed(2)})`
  );
  assert(
    lossResult.positiveFormulaReusedAntiPatternPrevented === true,
    'Flag positiveFormulaReusedAntiPatternPrevented: true'
  );

  // ===========================================================================
  // STEP 7: Capital / Economic Balances Follow Configured Loss Policy
  // ===========================================================================
  console.log('\n--- Step 7: Capital / Economic Balances Under Loss Policies ---');

  // Policy 1: PRO_RATA_CAPITAL_IMPAIRMENT (Standard Mudarabah: capital providers absorb loss pro-rata)
  console.log('Testing Policy 1: PRO_RATA_CAPITAL_IMPAIRMENT');
  assert(
    partA.lossAbsorbed === 33.33,
    `A absorbed loss pro-rata: 100 × (100/300) = ৳33.33 (got ৳${partA.lossAbsorbed})`
  );
  assert(
    partA.remainingCapital === 66.67,
    `A remaining capital: 100 - 33.33 = ৳66.67 (got ৳${partA.remainingCapital})`
  );
  assert(
    partB.lossAbsorbed === 66.67,
    `B absorbed loss pro-rata: 100 × (200/300) = ৳66.67 (got ৳${partB.lossAbsorbed})`
  );
  assert(
    partB.remainingCapital === 133.33,
    `B remaining capital: 200 - 66.67 = ৳133.33 (got ৳${partB.remainingCapital})`
  );
  assert(
    lossResult.totalLossAbsorbed === 100,
    'Total loss absorbed by capital equals exact loss: 33.33 + 66.67 = ৳100'
  );
  assert(
    lossResult.totalRemainingCapital === 200,
    'Total remaining capital equals 300 - 100 = ৳200'
  );

  // Policy 2: RETAINED_DEFICIT_CARRY_FORWARD
  console.log('Testing Policy 2: RETAINED_DEFICIT_CARRY_FORWARD');
  const carryForwardResult = calculateNegativePeriodResultAllocation({
    loss: 100,
    participants,
    lossPolicy: 'RETAINED_DEFICIT_CARRY_FORWARD'
  });
  const cfA = carryForwardResult.participants.find((p) => p.id === 'A')!;
  const cfB = carryForwardResult.participants.find((p) => p.id === 'B')!;
  assert(cfA.investorProfit === 0, 'Carry forward: A investor profit is 0');
  assert(cfB.investorProfit === 0, 'Carry forward: B investor profit is 0');
  assert(cfA.mudaribProfit === 0, 'Carry forward: A Mudarib profit is 0');
  assert(cfB.mudaribProfit === 0, 'Carry forward: B Mudarib profit is 0');
  assert(cfA.remainingCapital === 100, 'Carry forward: A nominal capital intact at ৳100');
  assert(cfB.remainingCapital === 200, 'Carry forward: B nominal capital intact at ৳200');

  // ===========================================================================
  // STEP 8: Run inspectNegativePeriodResultHandling Inspection Suite
  // ===========================================================================
  console.log('\n--- Step 8: Comprehensive Inspection Suite Execution ---');

  const inspection = inspectNegativePeriodResultHandling({
    loss: 100,
    periodResult: -100,
    participants,
    lossPolicy: 'PRO_RATA_CAPITAL_IMPAIRMENT',
    expectedInvestorProfit: 0,
    expectedMudaribProfit: 0,
    expectedLossAmount: 100
  });

  assert(inspection.passed === true, 'inspectNegativePeriodResultHandling passed === true');
  assert(inspection.isLossVerified === true, 'Inspection: isLossVerified === true');
  assert(inspection.investorProfitNonNegative === true, 'Inspection: investorProfitNonNegative === true');
  assert(inspection.mudaribProfitNonNegative === true, 'Inspection: mudaribProfitNonNegative === true');
  assert(inspection.noManufacturedProfit === true, 'Inspection: noManufacturedProfit === true');
  assert(inspection.lossRemainsVisible === true, 'Inspection: lossRemainsVisible === true');
  assert(inspection.capitalBalancesFollowPolicy === true, 'Inspection: capitalBalancesFollowPolicy === true');
  assert(inspection.positiveFormulaNotReused === true, 'Inspection: positiveFormulaNotReused === true');
  assert(inspection.expectedInvestorProfitMatches === true, 'Inspection: expectedInvestorProfitMatches (0)');
  assert(inspection.expectedMudaribProfitMatches === true, 'Inspection: expectedMudaribProfitMatches (0)');

  // ===========================================================================
  // STEP 9: General Ledger Accounting Engine Integration & Verification
  // ===========================================================================
  console.log('\n--- Step 9: General Ledger & Financial Statement Verification ---');

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account with ৳500 balance
  const bankAccId = 'bank_loss_p28';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Farm Operating Bank Account',
    accountType: 'BANK',
    currentBalance: 500,
    synced: false
  });

  // Post actual operating expense of ৳100 (e.g. Feed Expense):
  // Dr 6010 Feed Expense ৳100 | Cr 1030 Bank ৳100
  await postJournalEntry(
    {
      id: 'j_p28_exp_100',
      voucherNumber: 'JRN-P28-EXP-001',
      voucherType: 'JOURNAL',
      date: '2026-03-15',
      narration: 'ফিড ক্রয় ও খামার পরিচালনা খরচ (Feed Expense incurring period loss)',
      lines: [
        {
          accountCode: '6010',
          accountName: 'পশুখাদ্য ও মুরগির ফিড খরচ',
          debit: 100,
          credit: 0,
          memo: 'ফিড খরচ'
        },
        {
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 100,
          memo: 'ব্যাংক পরিশোধ'
        }
      ],
      createdBy: 'auditor_prompt28',
      createdAt: new Date().toISOString(),
      reference: 'EXP-LOSS-100'
    },
    { dbInstance: mDb }
  );

  // 1. Verify operating P&L visibly reflects loss of 100
  const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
  assert(pnl.totalRevenue === 0, 'P&L: Total revenue is ৳0');
  assert(pnl.totalOperatingExpenses === 100, 'P&L: Total operating expenses visibly ৳100');
  assert(pnl.netProfit === -100, 'P&L: Net profit visibly reflects -৳100 (Deficit/Loss = ৳100)');

  // 2. Verify that profit distribution transactions (Dr 3070 / Cr 2050) are NOT created
  const allEntries = await mDb.journalEntries.toArray();
  const distributionEntries = allEntries.filter((e) =>
    e.lines.some((l) => l.accountCode === '3070' || l.accountCode === '2050')
  );
  assert(
    distributionEntries.length === 0,
    'No profit distribution entries exist in GL when period result is a loss'
  );

  // 3. Verify that attempting to allocate profit during a loss strictly throws an error
  let blockedAllocation = false;
  try {
    await executeFinalizedBusinessProfitAllocationToInvestors(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        responsibleUser: 'auditor_prompt28'
      },
      mDb
    );
  } catch (err: any) {
    blockedAllocation = true;
    assert(
      err.message.includes('চূড়ান্ত বণ্টনযোগ্য প্রকৃত মুনাফা অবশ্যই ০ এর বেশি হতে হবে') ||
      err.message.includes('লোকসান হলে লভ্যাংশ বণ্টন সম্ভব নয়'),
      'executeFinalizedBusinessProfitAllocationToInvestors properly rejected loss period'
    );
  }
  assert(blockedAllocation, 'CRITICAL: Distribution strictly blocked when P&L is in a loss position');

  // 4. Also verify createProfitAllocationEvent rejects negative or zero profit
  let poolBlocked = false;
  try {
    await createProfitAllocationEvent(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        responsibleUser: 'auditor_prompt28'
      },
      mDb
    );
  } catch (err: any) {
    poolBlocked = true;
    assert(
      err.message.includes('চূড়ান্ত বণ্টনযোগ্য মুনাফা অবশ্যই ০ এর বেশি হতে হবে'),
      'createProfitAllocationEvent properly rejected loss period'
    );
  }
  assert(poolBlocked, 'CRITICAL: Profit pool creation strictly rejected when P&L is in a loss position');

  // 5. Check Trial Balance integrity (Debits == Credits == 100)
  const tb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
  assert(tb.isBalanced === true, 'Trial balance is balanced (Debits === Credits)');
  assert(tb.totalDebit === 100, `Trial balance total debits is ৳100 (got ৳${tb.totalDebit})`);
  assert(tb.totalCredit === 100, `Trial balance total credits is ৳100 (got ৳${tb.totalCredit})`);

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 28 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt28LossHandlingTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 28 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 28 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 28 tests:', err);
      process.exit(1);
    });
}
