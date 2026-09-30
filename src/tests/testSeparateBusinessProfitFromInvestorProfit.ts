import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeFinalizedBusinessProfitAllocationToInvestors,
  executeInvestorProfitAllocationTransaction,
  clearAdmissionAuditsForTest
} from '../services/transactionService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE IV — PROMPT 10: SEPARATE BUSINESS PROFIT FROM INVESTOR PROFIT
 * Regression test proving:
 * - ERP calculates actual farm business profit first.
 * - Only after final business profit is determined may investor profit allocation occur.
 * - Allocation is strictly an appropriation/distribution (Dr 3070 Equity / Cr 2050 Liability).
 * - Allocation NEVER changes sales (4000s).
 * - Allocation NEVER changes expenses (6000s).
 * - Allocation NEVER changes inventory COGS (5000s).
 * - Allocation NEVER fabricates revenue or expenses.
 * - Allocation NEVER alters Trial Balance incorrectly (trial balance remains balanced).
 * - Allocation NEVER alters actual operating P&L.
 */
export async function runSeparateBusinessProfitFromInvestorProfitTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 10: SEPARATE BUSINESS PROFIT FROM INVESTOR PROFIT');
  console.log('Testing that investor allocation does NOT change underlying operating P&L');
  console.log('================================================================\n');

  clearAdmissionAuditsForTest();
  const testUserId = 'auditor_p10';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p10';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p10';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 200000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Set Up Investors with Approved Participation Ratios
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting Up Active Investors & Capital ---');

  // Investor 1: Tariqul Islam (Capital ৳300,000, 30% approved participation)
  const inv1 = await executeInvestorTransaction(
    {
      investorName: 'Tariqul Islam',
      phone: '01711000001',
      contribution: 300000,
      profitSharingRatio: 30,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Partner 1'
    },
    mDb
  );

  // Investor 2: Farhana Yasmin (Capital ৳200,000, 20% approved participation)
  const inv2 = await executeInvestorTransaction(
    {
      investorName: 'Farhana Yasmin',
      phone: '01911000002',
      contribution: 200000,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      allowExceedingGlobal100: true,
      date: '2026-01-05',
      notes: 'Partner 2'
    },
    mDb
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Record Actual Farm Operations (Sales, COGS, Operating Expenses)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Recording Real Farm Operations (Revenue, COGS, Expenses) ---');

  // 1. Farm Produce Sales Revenue: Dr Bank ৳450,000 | Cr 4010 Farm Sales ৳450,000
  await postJournalEntry(
    {
      id: 'j_p10_rev',
      voucherNumber: 'V-REV-01',
      voucherType: 'RECEIPT',
      date: '2026-03-15',
      narration: 'খামার দুধ ও শাকসবজি বিক্রয়',
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 450000, credit: 0 },
        { accountCode: '4010', accountName: 'খামার পণ্য বিক্রয় আয়', debit: 0, credit: 450000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 2. Inventory Cost of Goods Sold (COGS): Dr 5010 Feed COGS ৳150,000 | Cr 1051 Feed Inventory ৳150,000
  await postJournalEntry(
    {
      id: 'j_p10_cogs',
      voucherNumber: 'V-COGS-01',
      voucherType: 'JOURNAL',
      date: '2026-03-20',
      narration: 'ব্যবহৃত পশুখাদ্য বিক্রিত পণ্যের ব্যয় (COGS)',
      lines: [
        { accountCode: '5010', accountName: 'পশুখাদ্য ব্যয় (COGS)', debit: 150000, credit: 0 },
        { accountCode: '1051', accountName: 'মজুদ খাদ্য', debit: 0, credit: 150000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-20T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 3. Farm Labor Operating Expense: Dr 6110 Labor ৳60,000 | Cr 1010 Cash ৳60,000
  await postJournalEntry(
    {
      id: 'j_p10_exp1',
      voucherNumber: 'V-EXP-01',
      voucherType: 'PAYMENT',
      date: '2026-03-25',
      narration: 'খামার শ্রমিকদের মাসিক বেতন ও মজুরি',
      lines: [
        { accountCode: '6110', accountName: 'শ্রমিক মজুরি খরচ', debit: 60000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 60000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-25T14:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 4. Utility / Electricity Expense: Dr 6130 Utilities ৳20,000 | Cr 1010 Cash ৳20,000
  await postJournalEntry(
    {
      id: 'j_p10_exp2',
      voucherNumber: 'V-EXP-02',
      voucherType: 'PAYMENT',
      date: '2026-03-28',
      narration: 'খামারের সেচ ও বিদ্যুৎ বিল পরিশোধ',
      lines: [
        { accountCode: '6130', accountName: 'বিদ্যুৎ ও জ্বালানি খরচ', debit: 20000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 20000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-28T16:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 5. Fixed Asset Depreciation Expense: Dr 6140 Depreciation ৳20,000 | Cr 1590 Acc. Depr ৳20,000
  await postJournalEntry(
    {
      id: 'j_p10_depr',
      voucherNumber: 'V-DEPR-01',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'ত্রৈমাসিক শেড ও যন্ত্রপাতি অবচয়',
      lines: [
        { accountCode: '6140', accountName: 'অবচয় খরচ', debit: 20000, credit: 0 },
        { accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 20000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-31T17:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Calculate Actual Business Profit First (Prior to Investor Allocation)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Establishing Actual Farm Business Profit First ---');

  const periodParams = { startDate: '2026-01-01', endDate: '2026-03-31' };
  const prePnl = await generateProfitLoss(periodParams, undefined, mDb);
  const preTb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);

  // Expected Business Performance:
  // Revenue: ৳450,000
  // COGS: ৳150,000
  // Gross Profit = 450,000 - 150,000 = ৳300,000
  // Operating Expenses = 60,000 (labor) + 20,000 (utilities) + 20,000 (depr) = ৳100,000
  // Final Net Farm Business Profit = 300,000 - 100,000 = ৳200,000

  assert(prePnl.totalRevenue === 450000, 'Baseline Sales / Revenue establishes ৳450,000');
  assert(prePnl.totalCogs === 150000, 'Baseline Inventory COGS establishes ৳150,000');
  assert(prePnl.grossProfit === 300000, 'Baseline Gross Profit establishes ৳300,000');
  assert(prePnl.totalOperatingExpenses === 100000, 'Baseline Operating Expenses establishes ৳100,000');
  assert(prePnl.netProfit === 200000, 'Actual Farm Business Profit is strictly ৳200,000');
  assert(Math.abs(preTb.totalDebit - preTb.totalCredit) < 0.01, 'Baseline Trial Balance is strictly balanced');

  // ---------------------------------------------------------------------------
  // STEP 4: Prevent Allocation When Profit Is Not Yet Finalized or Non-Positive
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Enforcing Non-Negative Profit Requirement ---');

  let lossAllocationRejected = false;
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: inv1.investor.id,
        finalizedDistributableProfit: 0,
        allocatedProfit: 1000,
        date: '2026-03-31',
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    lossAllocationRejected = true;
    assert(
      err.message.includes('চূড়ান্ত বণ্টনযোগ্য প্রকৃত মুনাফা অবশ্যই ০ এর বেশি হতে হবে') ||
        err.message.includes('Finalized distributable profit must be > 0'),
      'Allocation with zero or negative profit is strictly rejected'
    );
  }
  assert(lossAllocationRejected, 'Zero/loss profit allocation prevention confirmed');

  // ---------------------------------------------------------------------------
  // STEP 5: Execute Investor Profit Allocation Based on Finalized Business Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Executing Formal Investor Profit Allocation ---');

  // Investor 1: 30% of ৳200,000 = ৳60,000
  // Investor 2: 20% of ৳200,000 = ৳40,000
  // Total allocated to investors = ৳100,000
  // Retained farm business profit = ৳100,000 (Working partner / retained earnings)
  const allocResult = await executeFinalizedBusinessProfitAllocationToInvestors(
    {
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      responsibleUser: testUserId,
      notes: 'Q1 2026 Finalized Business Profit Appropriation'
    },
    mDb
  );

  assert(allocResult.finalizedBusinessProfit === 200000, 'Allocation confirms finalized business profit of ৳200,000');
  assert(allocResult.totalAllocatedToInvestors === 100000, 'Total allocated to investors is ৳100,000 (60k + 40k)');
  assert(allocResult.retainedBusinessProfit === 100000, 'Retained business profit is ৳100,000');
  assert(allocResult.allocations.length === 2, 'Two investor allocations created');

  const inv1Alloc = allocResult.allocations.find((a) => a.investorId === inv1.investor.id);
  assert(inv1Alloc !== undefined && inv1Alloc.allocatedProfitAmount === 60000, 'Investor 1 allocated exactly ৳60,000 (30% of 200k)');

  const inv2Alloc = allocResult.allocations.find((a) => a.investorId === inv2.investor.id);
  assert(inv2Alloc !== undefined && inv2Alloc.allocatedProfitAmount === 40000, 'Investor 2 allocated exactly ৳40,000 (20% of 200k)');

  // ---------------------------------------------------------------------------
  // STEP 6: CRITICAL REGRESSION PROOF — OPERATING P&L IS 100% UNTOUCHED
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: CRITICAL REGRESSION PROOF — P&L Intact After Allocation ---');

  const postPnl = await generateProfitLoss(periodParams, undefined, mDb);
  const postTb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);

  // 1. Sales / Revenue must be strictly identical
  assert(
    postPnl.totalRevenue === prePnl.totalRevenue,
    `SALES UNTOUCHED: Revenue post-allocation (৳${postPnl.totalRevenue}) strictly equals pre-allocation (৳${prePnl.totalRevenue})`
  );
  assert(
    postPnl.revenues.length === prePnl.revenues.length,
    'Zero revenue lines added, modified, or fabricated'
  );
  assert(
    postPnl.revenues.every((r, idx) => r.code === prePnl.revenues[idx].code && r.amount === prePnl.revenues[idx].amount),
    'Revenue account line items are byte-for-byte identical'
  );

  // 2. Inventory COGS must be strictly identical
  assert(
    postPnl.totalCogs === prePnl.totalCogs,
    `COGS UNTOUCHED: Inventory COGS post-allocation (৳${postPnl.totalCogs}) strictly equals pre-allocation (৳${prePnl.totalCogs})`
  );
  assert(
    postPnl.cogs.every((c, idx) => c.code === prePnl.cogs[idx].code && c.amount === prePnl.cogs[idx].amount),
    'COGS account line items are byte-for-byte identical'
  );

  // 3. Operating Expenses must be strictly identical
  assert(
    postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses,
    `EXPENSES UNTOUCHED: Operating expenses post-allocation (৳${postPnl.totalOperatingExpenses}) strictly equals pre-allocation (৳${prePnl.totalOperatingExpenses})`
  );
  assert(
    postPnl.operatingExpenses.length === prePnl.operatingExpenses.length,
    'Zero expense accounts fabricated or modified'
  );
  assert(
    postPnl.operatingExpenses.every((e, idx) => e.code === prePnl.operatingExpenses[idx].code && e.amount === prePnl.operatingExpenses[idx].amount),
    'Operating expense line items are byte-for-byte identical'
  );

  // 4. Gross Profit & Net Operating Profit must be strictly identical
  assert(
    postPnl.grossProfit === prePnl.grossProfit,
    `GROSS PROFIT UNTOUCHED: Gross profit post-allocation (৳${postPnl.grossProfit}) equals pre-allocation (৳${prePnl.grossProfit})`
  );
  assert(
    postPnl.netProfit === prePnl.netProfit,
    `NET PROFIT UNTOUCHED: Operating Net Profit post-allocation (৳${postPnl.netProfit}) strictly equals pre-allocation (৳${prePnl.netProfit})`
  );

  // 5. Trial Balance must remain balanced
  assert(
    Math.abs(postTb.totalDebit - postTb.totalCredit) < 0.01,
    `TRIAL BALANCE BALANCED: Total Debits (৳${postTb.totalDebit}) strictly equals Total Credits (৳${postTb.totalCredit})`
  );

  // 6. Trial Balance Operating Accounts (4xxx, 5xxx, 6xxx) must remain 100% identical
  const getRowCode = (r: any): string => (r && (r.code || r.accountCode) ? String(r.code || r.accountCode).trim() : '');
  const preOperatingTbRows = preTb.rows.filter((r) => {
    const code = getRowCode(r);
    return code.startsWith('4') || code.startsWith('5') || code.startsWith('6');
  });
  const postOperatingTbRows = postTb.rows.filter((r) => {
    const code = getRowCode(r);
    return code.startsWith('4') || code.startsWith('5') || code.startsWith('6');
  });

  assert(
    preOperatingTbRows.length === postOperatingTbRows.length,
    'Trial Balance operating accounts count unchanged'
  );

  let allOperatingBalancesIdentical = true;
  for (const preRow of preOperatingTbRows) {
    const preCode = getRowCode(preRow);
    const postRow = postOperatingTbRows.find((r) => getRowCode(r) === preCode);
    if (!postRow || postRow.debit !== preRow.debit || postRow.credit !== preRow.credit) {
      allOperatingBalancesIdentical = false;
      break;
    }
  }
  assert(
    allOperatingBalancesIdentical,
    'Every single operating account in Trial Balance has 100% identical debit and credit balances before and after allocation'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Verify Nature of Allocation: Equity Appropriation (Dr 3070 / Cr 2050)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Verifying Canonical Equity Appropriation GL Entry ---');

  const allJournals = await mDb.journalEntries.toArray();
  const allocationJournals = allJournals.filter((j: any) => j.reference?.startsWith('ALLOC-'));

  assert(allocationJournals.length === 2, 'Exactly 2 allocation journal entries created');

  for (const entry of allocationJournals) {
    const debitLine = entry.lines.find((l: any) => l.debit > 0);
    const creditLine = entry.lines.find((l: any) => l.credit > 0);

    assert(
      debitLine?.accountCode === '3070',
      'Debit line is strictly Account 3070 (Profit Distribution / Equity Appropriation), NOT an expense'
    );
    assert(
      creditLine?.accountCode === '2050',
      'Credit line is strictly Account 2050 (Investor Profit Payable / Liability), NOT revenue'
    );
    assert(
      debitLine?.debit === creditLine?.credit,
      'Allocation journal entry is strictly balanced (Debit == Credit)'
    );
  }

  // Verify Investor Balance Updated
  const updatedInv1 = await mDb.investors.get(inv1.investor.id);
  assert(updatedInv1?.profitPayable === 60000, 'Investor 1 profitPayable balance updated to ৳60,000');
  assert(updatedInv1?.totalProfitAllocated === 60000, 'Investor 1 totalProfitAllocated updated to ৳60,000');

  const updatedInv2 = await mDb.investors.get(inv2.investor.id);
  assert(updatedInv2?.profitPayable === 40000, 'Investor 2 profitPayable balance updated to ৳40,000');
  assert(updatedInv2?.totalProfitAllocated === 40000, 'Investor 2 totalProfitAllocated updated to ৳40,000');

  console.log('\n================================================================');
  console.log(`PROMPT 10 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testSeparateBusinessProfitFromInvestorProfit.ts') ||
    process.argv[1].endsWith('testSeparateBusinessProfitFromInvestorProfit.js'));

if (isDirectRun) {
  runSeparateBusinessProfitFromInvestorProfitTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Prompt 10 tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 10 tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 10 tests:', err);
      process.exit(1);
    });
}
