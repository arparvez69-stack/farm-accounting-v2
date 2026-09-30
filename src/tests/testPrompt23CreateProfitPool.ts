import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry, generateProfitLoss } from '../accounting/accountingEngine';
import {
  determineFinalizedDistributableProfit,
  createProfitAllocationEvent,
  getProfitAllocationEventById,
  getAllProfitAllocationEvents,
  inspectProfitAllocation,
  clearProfitAllocationEventsForTest,
  clearValuationEventsForTest
} from '../services/valuationService';
import { ProfitAllocationEvent } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 4 — PROFIT ALLOCATION
 * PROMPT 23 — Create the Profit Pool
 *
 * Requirements:
 * Inspect profit allocation.
 *
 * First determine the finalized accounting/distributable profit for the eligible period.
 *
 * Do not calculate investor profit directly from random account balances.
 *
 * Do not change the accounting P&L during allocation.
 *
 * Create a clear allocation event referencing:
 * - period;
 * - profit pool;
 * - valuation/eligibility boundary;
 * - source accounting result.
 *
 * Test with distributable profit = 300.
 *
 * Verify allocation starts from exactly 300.
 *
 * Return PASS.
 */
export async function runPrompt23CreateProfitPoolTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 23: CREATE THE PROFIT POOL & INSPECT ALLOCATION');
  console.log('Testing: Finalized Accounting Distributable Profit, Anti-Pattern Prevention,');
  console.log('P&L Preservation, Allocation Event Creation, and Pool Starting = 300');
  console.log('================================================================\n');

  clearProfitAllocationEventsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account with an arbitrary balance to test anti-pattern
  const bankAccId = 'bank_main_p23';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Agrani Bank Main Farm Account',
    accountType: 'BANK',
    currentBalance: 50000, // ৳50,000 cash balance in bank!
    synced: false
  });

  const testUserId = 'auditor_prompt23';
  const periodStartDate = '2026-01-01';
  const periodEndDate = '2026-03-31';

  // ===========================================================================
  // STEP 1: Establish Accounting Operations Generating Exact Net Profit = ৳300
  // ===========================================================================
  console.log('--- Step 1: Establish Accounting Operations (Revenue ৳800, Expense ৳500 -> Net Profit ৳300) ---');

  // Revenue: ৳800
  await postJournalEntry(
    {
      id: 'j_p23_rev',
      voucherNumber: 'SALES-2026-Q1',
      voucherType: 'SALES',
      date: '2026-02-15',
      narration: 'কৃষি ও ডেইরি পণ্য বিক্রয় আয়',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 800,
          credit: 0,
          memo: 'বিক্রয়লব্ধ ব্যাংক জমা'
        },
        {
          accountId: 'acc_4010',
          accountCode: '4010',
          accountName: 'বিক্রয় আয়',
          debit: 0,
          credit: 800,
          memo: 'পণ্য বিক্রয় আয়'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-02-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Operating Expenses: ৳500
  await postJournalEntry(
    {
      id: 'j_p23_exp',
      voucherNumber: 'EXP-2026-Q1',
      voucherType: 'EXPENSE',
      date: '2026-03-10',
      narration: 'ফার্মের পশুখাদ্য ও পরিচালনা ব্যয়',
      lines: [
        {
          accountId: 'acc_6010',
          accountCode: '6010',
          accountName: 'পশুখাদ্য ও পরিচালন খরচ',
          debit: 500,
          credit: 0,
          memo: 'পশুখাদ্য ক্রয় খরচ'
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 500,
          memo: 'ব্যাংক থেকে পেমেন্ট'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-10T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const initialPnl = await generateProfitLoss({ startDate: periodStartDate, endDate: periodEndDate }, undefined, mDb);
  assert(initialPnl.totalRevenue === 800, 'Initial P&L total revenue is ৳800');
  assert(initialPnl.totalOperatingExpenses === 500, 'Initial P&L total operating expenses is ৳500');
  assert(initialPnl.operatingProfit === 300, 'Initial P&L operating profit is exactly ৳300');
  assert(initialPnl.netProfit === 300, 'Initial P&L net profit is exactly ৳300');

  // ===========================================================================
  // STEP 2: Determine Finalized Accounting/Distributable Profit for the Eligible Period
  // ===========================================================================
  console.log('\n--- Step 2: Determine Finalized Distributable Profit for Eligible Period ---');

  const determinedProfit = await determineFinalizedDistributableProfit(
    {
      startDate: periodStartDate,
      endDate: periodEndDate
    },
    mDb
  );

  assert(
    determinedProfit.distributableProfit === 300,
    `Finalized accounting distributable profit determined: ৳${determinedProfit.distributableProfit} (expected 300)`
  );
  assert(determinedProfit.netProfit === 300, 'Accounting net profit is ৳300');
  assert(determinedProfit.operatingProfit === 300, 'Accounting operating profit is ৳300');
  assert(determinedProfit.isDerivedFromAccountingPnl === true, 'Profit is strictly derived from period accounting P&L');
  assert(
    determinedProfit.notCalculatedFromRandomBalances === true,
    'Verified not calculated from random account balances'
  );

  // ===========================================================================
  // STEP 3: Anti-Pattern Check: Do Not Calculate Directly from Random Account Balances
  // ===========================================================================
  console.log('\n--- Step 3: Anti-Pattern Check — Block Calculating Directly from Random Account Balances ---');

  let randomAccountBlocked = false;
  try {
    await determineFinalizedDistributableProfit(
      {
        startDate: periodStartDate,
        endDate: periodEndDate,
        accountBalanceCheck: {
          sourceAccountCode: '1030', // Attempting to use Bank balance (which might be ৳50,300)
          preventRandomAccountBalanceCalculation: true
        }
      },
      mDb
    );
  } catch (err: any) {
    randomAccountBlocked = true;
    assert(
      err.message.includes('সরাসরি বিচ্ছিন্ন অ্যাকাউন্ট ব্যালেন্স') ||
      err.message.includes('random account balances'),
      `Correctly blocked calculation from random account balance: "${err.message}"`
    );
  }
  assert(randomAccountBlocked, 'Calculating profit directly from random account balances was strictly rejected');

  // ===========================================================================
  // STEP 4: Create Clear Allocation Event Referencing Required Fields
  // ===========================================================================
  console.log('\n--- Step 4: Create Clear Allocation Event Referencing 4 Core Elements ---');

  const event = await createProfitAllocationEvent(
    {
      startDate: periodStartDate,
      endDate: periodEndDate,
      distributableProfit: 300, // Explicitly test with distributable profit = 300
      responsibleUser: testUserId,
      valuationEventId: 'val_event_q1_2026',
      valuationReference: 'VAL-2026-Q1-APPROVED',
      eligibleAdmissionCutoffDate: periodEndDate,
      eligibleInvestorIds: ['inv_alpha', 'inv_beta'],
      eligibleTrancheIds: ['tranche_alpha_01', 'tranche_beta_01'],
      notes: 'Q1 2026 Approved Profit Pool & Allocation Event',
      allocations: [
        {
          investorId: 'inv_alpha',
          investorName: 'Investor Alpha',
          trancheId: 'tranche_alpha_01',
          profitSharingRatio: 40,
          economicParticipationRatio: 1.0,
          allocatedAmount: 120 // 40% of 300 = 120
        },
        {
          investorId: 'inv_founder',
          investorName: 'Working Partner (Founder)',
          profitSharingRatio: 60,
          economicParticipationRatio: 1.0,
          allocatedAmount: 180 // 60% of 300 = 180
        }
      ]
    },
    mDb
  );

  // 1. Period reference
  assert(event.period !== undefined, 'Event contains period reference');
  assert(event.period.startDate === '2026-01-01', 'Event period startDate is 2026-01-01');
  assert(event.period.endDate === '2026-03-31', 'Event period endDate is 2026-03-31');

  // 2. Profit pool reference
  assert(event.profitPool !== undefined, 'Event contains profit pool reference');
  assert(event.profitPool.poolAmount === 300, 'Profit pool amount is ৳300');
  assert(event.profitPool.distributableProfit === 300, 'Profit pool distributable profit is ৳300');
  assert(event.profitPool.isFinalized === true, 'Profit pool is marked finalized');

  // 3. Valuation / eligibility boundary reference
  assert(event.valuationEligibilityBoundary !== undefined, 'Event contains valuation/eligibility boundary reference');
  assert(event.valuationEligibilityBoundary.cutoffDate === '2026-03-31', 'Boundary cutoff date is 2026-03-31');
  assert(
    event.valuationEligibilityBoundary.valuationEventId === 'val_event_q1_2026',
    'Boundary references valuationEventId: val_event_q1_2026'
  );
  assert(
    event.valuationEligibilityBoundary.valuationReference === 'VAL-2026-Q1-APPROVED',
    'Boundary references valuationReference: VAL-2026-Q1-APPROVED'
  );
  assert(
    event.valuationEligibilityBoundary.eligibleAdmissionCutoffDate === '2026-03-31',
    'Boundary enforces eligible admission cutoff date: 2026-03-31'
  );

  // 4. Source accounting result reference
  assert(event.sourceAccountingResult !== undefined, 'Event contains source accounting result reference');
  assert(event.sourceAccountingResult.sourceType === 'PROFIT_AND_LOSS', 'Source type is PROFIT_AND_LOSS');
  assert(event.sourceAccountingResult.periodStartDate === '2026-01-01', 'Source period start is 2026-01-01');
  assert(event.sourceAccountingResult.periodEndDate === '2026-03-31', 'Source period end is 2026-03-31');
  assert(event.sourceAccountingResult.totalRevenue === 800, 'Source total revenue is ৳800');
  assert(event.sourceAccountingResult.totalOperatingExpenses === 500, 'Source operating expenses is ৳500');
  assert(event.sourceAccountingResult.operatingProfit === 300, 'Source operating profit is ৳300');
  assert(event.sourceAccountingResult.netProfit === 300, 'Source net profit is ৳300');
  assert(event.sourceAccountingResult.finalizedDistributableProfit === 300, 'Source finalized distributable profit is ৳300');
  assert(event.sourceAccountingResult.isUnalteredByAllocation === true, 'Source accounting result is unaltered by allocation');

  // ===========================================================================
  // STEP 5: Verify Allocation Starts from Exactly 300
  // ===========================================================================
  console.log('\n--- Step 5: Verify Allocation Starts from Exactly 300 ---');

  assert(
    event.allocationStartingAmount === 300,
    `CRITICAL REQUIREMENT: Allocation starting amount is exactly ৳300 (got ৳${event.allocationStartingAmount})`
  );
  assert(
    event.profitPool.poolAmount === 300,
    `CRITICAL REQUIREMENT: Profit pool amount starts from exactly ৳300 (got ৳${event.profitPool.poolAmount})`
  );
  assert(
    event.profitPool.distributableProfit === 300,
    `CRITICAL REQUIREMENT: Distributable profit starts from exactly ৳300 (got ৳${event.profitPool.distributableProfit})`
  );

  // Allocation distribution breakdown
  assert(event.totalAllocated === 300, 'Total allocated across participants is ৳300 (120 + 180)');
  assert(event.remainingPoolAmount === 0, 'Remaining pool amount is ৳0 (pool fully accounted for)');

  // ===========================================================================
  // STEP 6: Verify Accounting P&L Does NOT Change During Allocation
  // ===========================================================================
  console.log('\n--- Step 6: Verify Accounting P&L Does NOT Change During Allocation ---');

  const postPnl = await generateProfitLoss({ startDate: periodStartDate, endDate: periodEndDate }, undefined, mDb);
  assert(
    postPnl.totalRevenue === initialPnl.totalRevenue,
    `Revenue unchanged: ৳${postPnl.totalRevenue} === ৳${initialPnl.totalRevenue}`
  );
  assert(
    postPnl.totalOperatingExpenses === initialPnl.totalOperatingExpenses,
    `Operating expenses unchanged: ৳${postPnl.totalOperatingExpenses} === ৳${initialPnl.totalOperatingExpenses}`
  );
  assert(
    postPnl.operatingProfit === initialPnl.operatingProfit,
    `Operating profit unchanged: ৳${postPnl.operatingProfit} === ৳${initialPnl.operatingProfit}`
  );
  assert(
    postPnl.netProfit === initialPnl.netProfit,
    `Net profit unchanged: ৳${postPnl.netProfit} === ৳${initialPnl.netProfit} (strictly ৳300)`
  );

  // ===========================================================================
  // STEP 7: Run inspectProfitAllocation & Verify All Invariants
  // ===========================================================================
  console.log('\n--- Step 7: Run inspectProfitAllocation Inspection Function ---');

  const inspection = await inspectProfitAllocation({
    allocationEventId: event.id,
    expectedDistributableProfit: 300,
    dbInstance: mDb
  });

  assert(inspection.passed === true, 'inspectProfitAllocation returned passed: true');
  assert(
    inspection.allocationStartsFromExactDistributableProfit === true,
    'Inspection confirms: allocationStartsFromExactDistributableProfit: true'
  );
  assert(inspection.distributableProfit === 300, 'Inspection confirms: distributableProfit === 300');
  assert(inspection.initialPoolAmount === 300, 'Inspection confirms: initialPoolAmount === 300');
  assert(inspection.accountingPnlUnchanged === true, 'Inspection confirms: accountingPnlUnchanged === true');
  assert(
    inspection.notCalculatedFromRandomBalances === true,
    'Inspection confirms: notCalculatedFromRandomBalances === true'
  );
  assert(inspection.referencesPeriod === true, 'Inspection confirms: referencesPeriod === true');
  assert(inspection.referencesProfitPool === true, 'Inspection confirms: referencesProfitPool === true');
  assert(
    inspection.referencesValuationEligibilityBoundary === true,
    'Inspection confirms: referencesValuationEligibilityBoundary === true'
  );
  assert(
    inspection.referencesSourceAccountingResult === true,
    'Inspection confirms: referencesSourceAccountingResult === true'
  );

  // ===========================================================================
  // STEP 8: Edge Cases & Validation Invariants
  // ===========================================================================
  console.log('\n--- Step 8: Edge Cases & Over-Allocation Protection ---');

  // Test 8a: Over-allocation beyond pool is rejected
  let overAllocRejected = false;
  try {
    await createProfitAllocationEvent(
      {
        startDate: periodStartDate,
        endDate: periodEndDate,
        distributableProfit: 300,
        responsibleUser: testUserId,
        allocations: [
          {
            investorId: 'inv_x',
            investorName: 'Greedy Investor',
            profitSharingRatio: 100,
            allocatedAmount: 450 // Exceeds 300 pool!
          }
        ]
      },
      mDb
    );
  } catch (err: any) {
    overAllocRejected = true;
    assert(
      err.message.includes('চেয়ে বেশি হতে পারে না') || err.message.includes('exceed'),
      `Over-allocation properly rejected: "${err.message}"`
    );
  }
  assert(overAllocRejected, 'Allocations exceeding profit pool are strictly blocked');

  // Test 8b: Zero or negative profit cannot create pool
  let zeroProfitRejected = false;
  try {
    await createProfitAllocationEvent(
      {
        startDate: periodStartDate,
        endDate: periodEndDate,
        distributableProfit: 0,
        responsibleUser: testUserId
      },
      mDb
    );
  } catch (err: any) {
    zeroProfitRejected = true;
  }
  assert(zeroProfitRejected, 'Zero distributable profit pool creation is strictly rejected');

  // Test 8c: Retrieval by ID and array listing
  const retrievedEvent = await getProfitAllocationEventById(event.id);
  assert(retrievedEvent !== null, 'getProfitAllocationEventById successfully retrieved the event');
  assert(retrievedEvent?.allocationNumber === event.allocationNumber, 'Retrieved allocationNumber matches');

  const allEvents = await getAllProfitAllocationEvents();
  assert(allEvents.length >= 1, `getAllProfitAllocationEvents returned ${allEvents.length} event(s)`);

  // Print Summary
  console.log('\n================================================================');
  console.log('PROMPT 23 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt23CreateProfitPoolTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 23 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 23 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 23 tests:', err);
      process.exit(1);
    });
}
