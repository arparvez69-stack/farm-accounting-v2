import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry, closePeriod, generateProfitLoss } from '../accounting/accountingEngine';
import { executeInvestorTransaction, executeInvestorProfitAllocationTransaction } from '../services/transactionService';
import { executeFinalAllocationAndSettlement } from '../services/settlementService';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK 5 — AUTHORITATIVE PROFIT SOURCE REGRESSION TEST
 *
 * Requirements & Invariants:
 * 1. The distributable profit used for an actual allocation transaction MUST come from
 *    a finalized authoritative accounting period/result.
 * 2. Reject:
 *    - missing period
 *    - unfinalized period
 *    - arbitrary manually supplied profit override
 *    - inconsistent profit source
 * 3. A preview may display calculated values, but final commit must re-read/validate
 *    the authoritative finalized result.
 * 4. A manipulated/manual profit value cannot change the committed allocation.
 * 5. Preserve existing accounting calculations and journal posting.
 */
export async function runTask5AuthoritativeProfitSourceTests(): Promise<AssertionResult> {
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
  console.log('TASK 5: AUTHORITATIVE PROFIT SOURCE REGRESSION TEST');
  console.log('Testing: Finalized Authoritative Period, Rejection of Manual Override,');
  console.log('and Immunity of Committed Allocation to Profit Manipulation');
  console.log('================================================================\n');

  const testUserId = 'test_auditor_task5';
  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_task5';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Sonali Bank Farm Account',
    name: 'Sonali Bank Farm Account',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // Setup active investor: Investor Alpha (Capital ৳100, Contract 50%)
  const investorRes = await executeInvestorTransaction(
    {
      investorName: 'Investor Alpha',
      phone: '01711000099',
      contribution: 100,
      profitSharingRatio: 50,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Initial Capital 100, Contract 50%',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
    },
    mDb
  );
  const investorId = investorRes.investor.id;
  assert(Boolean(investorId), 'Investor Alpha registered and active');

  // Step 1: Establish Authoritative Accounting Operations
  // Revenue ৳1,000 - Operating Expenses ৳700 = Net Profit ৳300
  await postJournalEntry(
    {
      id: 'j_rev_t5',
      voucherNumber: 'SALES-T5',
      voucherType: 'SALES',
      date: '2026-02-15',
      narration: 'কৃষি বিক্রয় আয়',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 1000,
          credit: 0
        },
        {
          accountId: 'acc_4010',
          accountCode: '4010',
          accountName: 'বিক্রয় আয়',
          debit: 0,
          credit: 1000
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-02-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  await postJournalEntry(
    {
      id: 'j_exp_t5',
      voucherNumber: 'EXP-T5',
      voucherType: 'EXPENSE',
      date: '2026-02-20',
      narration: 'খামার পরিচালন ও খাদ্য ব্যয়',
      lines: [
        {
          accountId: 'acc_5010',
          accountCode: '5010',
          accountName: 'খাদ্য ও উপাদান খরচ',
          debit: 700,
          credit: 0
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 700
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-02-20T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Authoritative operating P&L net profit = 300
  const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
  assert(pnl.netProfit === 300, `Authoritative P&L net profit is strictly ৳300 (got ৳${pnl.netProfit})`);

  // Step 2: Formally close and finalize the accounting period
  const closeRes = await closePeriod(
    {
      closingDate: '2026-03-31',
      currentUserId: testUserId,
      notes: 'Q1 2026 Finalized Closed Period'
    },
    mDb
  );
  const authoritativeClosedPeriodId = closeRes.closedPeriod.id;
  assert(Boolean(authoritativeClosedPeriodId), 'Period formally closed via accounting year-end closing');
  assert(
    closeRes.closedPeriod.netProfitTransferred === 300,
    `Closed period authoritative net profit transferred is ৳300 (got ৳${closeRes.closedPeriod.netProfitTransferred})`
  );

  // ===========================================================================
  // TEST CASE 1: Reject Missing Period
  // ===========================================================================
  console.log('\n--- Test 1: Reject Missing Accounting Period ---');
  let missingPeriodRejected = false;
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId,
        closedPeriodId: 'non_existent_closed_period_9999',
        finalizedDistributableProfit: 300,
        currentUserId: testUserId,
        allocationDate: '2026-03-31'
      },
      mDb
    );
  } catch (err: any) {
    missingPeriodRejected = true;
    assert(
      err.message.includes('হিসাবকাল পাওয়া যায়নি') || err.message.includes('Missing closed period'),
      `Missing period correctly rejected: "${err.message}"`
    );
  }
  assert(missingPeriodRejected, 'Execution strictly rejected missing closed period');

  // ===========================================================================
  // TEST CASE 2: Reject Unfinalized Period
  // ===========================================================================
  console.log('\n--- Test 2: Reject Unfinalized Accounting Period ---');
  const unfinalizedPeriodId = 'cp_unfinalized_test';
  await mDb.closedPeriods.put({
    id: unfinalizedPeriodId,
    endDate: '2026-06-30',
    startDate: '2026-04-01',
    netProfitTransferred: 500,
    status: 'OPEN',
    isFinalized: false,
    closedAt: new Date().toISOString()
  });

  let unfinalizedPeriodRejected = false;
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId,
        closedPeriodId: unfinalizedPeriodId,
        finalizedDistributableProfit: 500,
        currentUserId: testUserId,
        allocationDate: '2026-06-30'
      },
      mDb
    );
  } catch (err: any) {
    unfinalizedPeriodRejected = true;
    assert(
      err.message.includes('চূড়ান্ত করা হয়নি') || err.message.includes('Unfinalized period'),
      `Unfinalized period correctly rejected: "${err.message}"`
    );
  }
  assert(unfinalizedPeriodRejected, 'Execution strictly rejected unfinalized period');

  // ===========================================================================
  // TEST CASE 3: Reject Arbitrary Manually Supplied Profit Override
  // ===========================================================================
  console.log('\n--- Test 3: Reject Arbitrary Manually Supplied Profit Override ---');
  let manualOverrideRejected = false;
  try {
    // User attempts to supply a manipulated profit override of ৳5,000 (true profit is ৳300)
    await executeInvestorProfitAllocationTransaction(
      {
        investorId,
        closedPeriodId: authoritativeClosedPeriodId,
        finalizedDistributableProfit: 5000, // Manipulated profit value!
        currentUserId: testUserId,
        allocationDate: '2026-03-31'
      },
      mDb
    );
  } catch (err: any) {
    manualOverrideRejected = true;
    assert(
      err.message.includes('অননুমোদিত মুনাফা ওভাররাইড') || err.message.includes('Arbitrary manual profit override rejected'),
      `Arbitrary manual override properly rejected: "${err.message}"`
    );
  }
  assert(manualOverrideRejected, 'System strictly rejected user-entered profit overriding authoritative result');

  // ===========================================================================
  // TEST CASE 4: Prove Manipulated Profit Value Cannot Change Committed Allocation
  // ===========================================================================
  console.log('\n--- Test 4: Prove Authoritative Result Governs the Committed Allocation ---');

  // The actual allocation transaction commits strictly using the authoritative finalized accounting result
  const allocRes = await executeInvestorProfitAllocationTransaction(
    {
      investorId,
      closedPeriodId: authoritativeClosedPeriodId,
      // Pass the matching authoritative profit or let it re-read from closed period
      finalizedDistributableProfit: 300,
      currentUserId: testUserId,
      allocationDate: '2026-03-31',
      allocationReference: 'ALLOC-2026-Q1-AUTH'
    },
    mDb
  );

  // Contractual share is 50% of ৳300 = ৳150
  assert(allocRes.allocatedProfit === 150, `Committed allocated profit is strictly ৳150 (got ৳${allocRes.allocatedProfit})`);
  assert(allocRes.finalizedProfit === 300, `Authoritative finalized profit is strictly ৳300 (got ৳${allocRes.finalizedProfit})`);

  // Verify General Ledger Journal Entry
  const journal = await mDb.journalEntries.get(allocRes.journalEntryId);
  assert(Boolean(journal), 'Committed General Ledger journal entry exists');

  const debitLine = journal.lines.find((l: any) => l.accountCode === '3070');
  const creditLine = journal.lines.find((l: any) => l.accountCode === '2050');

  assert(debitLine?.debit === 150, `Dr 3070 Profit Distribution is strictly ৳150 (got ৳${debitLine?.debit})`);
  assert(creditLine?.credit === 150, `Cr 2050 Investor Profit Payable is strictly ৳150 (got ৳${creditLine?.credit})`);

  // Verify Investor Balance
  const updatedInv = await mDb.investors.get(investorId);
  assert(updatedInv?.profitPayable === 150, `Investor profitPayable in db is strictly ৳150 (got ৳${updatedInv?.profitPayable})`);
  assert(updatedInv?.totalProfitAllocated === 150, `Investor totalProfitAllocated in db is strictly ৳150 (got ৳${updatedInv?.totalProfitAllocated})`);

  // ===========================================================================
  // TEST CASE 5: Settlement Commit Also Enforces Authoritative Closed Period
  // ===========================================================================
  console.log('\n--- Test 5: Final Settlement Commit Enforces Authoritative Closed Period ---');

  // Attempt settlement commit with manipulated profit override (৳8,000 vs ৳300)
  let settlementOverrideRejected = false;
  try {
    await executeFinalAllocationAndSettlement(
      {
        investorId,
        closedPeriodId: authoritativeClosedPeriodId,
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-03-31',
        totalDistributableProfit: 8000, // Manipulated profit override!
        investorSharePercentage: 50,
        mudaribSharePercentage: 50,
        reinvestPercentage: 0,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    settlementOverrideRejected = true;
    assert(
      err.message.includes('অননুমোদিত মুনাফা ওভাররাইড') || err.message.includes('Arbitrary manual profit override rejected'),
      `Settlement manual override properly rejected: "${err.message}"`
    );
  }
  assert(settlementOverrideRejected, 'Settlement final commit strictly rejected manipulated profit override');

  console.log('\n================================================================');
  console.log(`TASK 5 TEST SUMMARY:`);
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Allow direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runTask5AuthoritativeProfitSourceTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Task 5 tests failed with ${res.failed} error(s)`);
        process.exit(1);
      } else {
        console.log('Task 5 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error during Task 5 tests:', err);
      process.exit(1);
    });
}
