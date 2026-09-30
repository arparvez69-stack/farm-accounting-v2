import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  executeInvestorCapitalReturnTransaction
} from '../services/transactionService';
import {
  recordCapitalMovement,
  getInvestorCapitalMovements,
  executeReinvestInvestorProfitTransaction,
  executeApprovedCapitalAdjustmentTransaction
} from '../services/capitalMovementService';
import { generateTrialBalance, generateProfitLoss } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 06: CAPITAL MOVEMENT LEDGER TEST
 *
 * Verifies that investor capital movements are separately identifiable:
 * 1. initial contribution
 * 2. additional contribution
 * 3. withdrawal of capital
 * 4. reinvested profit
 * 5. other approved capital adjustments
 *
 * Strict Accounting Rules:
 * - Investor capital contribution must NOT become farm revenue.
 * - Investor capital withdrawal must NOT become farm expense.
 * - Reinvested profit must NOT create new profit.
 * - Accounting engine remains balanced throughout.
 */
export async function runCapitalMovementLedgerTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 06: CAPITAL MOVEMENT LEDGER TEST');
  console.log('Testing separate identifiability, GL non-revenue/non-expense invariants & balance');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p06';

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_p06';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Sonali Bank PLC',
    name: 'Sonali Bank PLC',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: INITIAL CONTRIBUTION
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Initial Capital Contribution (৳100,000) ---');
  const res1 = await executeInvestorTransaction(
    {
      investorName: 'Mahmudul Hasan (Investor 1)',
      phone: '01911000001',
      contribution: 100000,
      profitSharingRatio: 40,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-10',
      notes: 'Initial capital investment'
    },
    mDb
  );

  const investorId = res1.investor.id;
  const initialJournals = await mDb.journalEntries.toArray();
  const initJnl = initialJournals.find((j: any) => j.id === res1.journalEntryId);

  // Invariant 1: Contribution must NOT become farm revenue
  const initRevenueLines = initJnl.lines.filter((l: any) => l.accountCode.startsWith('4'));
  assert(initRevenueLines.length === 0, 'INITIAL CONTRIBUTION: Zero lines in Revenue accounts (no 4xxx). Not farm revenue.');

  // Invariant 2: Correct GL accounts: Dr Bank (1030) | Cr Investor Capital (3020)
  const initDrBank = initJnl.lines.find((l: any) => l.accountCode === '1030' && l.debit === 100000);
  const initCrEquity = initJnl.lines.find((l: any) => l.accountCode === '3020' && l.credit === 100000);
  assert(Boolean(initDrBank), 'INITIAL CONTRIBUTION: Dr Bank (1030) ৳100,000');
  assert(Boolean(initCrEquity), 'INITIAL CONTRIBUTION: Cr Investor Capital (3020) ৳100,000');

  // Verify Capital Movement Ledger record
  const movements1 = await getInvestorCapitalMovements({ investorId }, mDb);
  assert(movements1.length === 1, 'Capital Movement Ledger contains 1 movement');
  assert(movements1[0].movementType === 'INITIAL_CONTRIBUTION', 'Movement is separately identifiable as INITIAL_CONTRIBUTION');
  assert(movements1[0].amount === 100000, 'Movement amount is ৳100,000');
  assert(movements1[0].direction === 'INFLOW', 'Movement direction is INFLOW');

  // ---------------------------------------------------------------------------
  // STEP 2: ADDITIONAL CONTRIBUTION
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Additional Capital Contribution (৳50,000) ---');
  const res2 = await executeInvestmentTrancheTransaction(
    {
      investorId,
      investmentAmount: 50000,
      contractualProfitSharePercentage: 35,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-02-15',
      notes: 'Second tranche capital injection'
    },
    mDb
  );

  const allJournals2 = await mDb.journalEntries.toArray();
  const addJnl = allJournals2.find((j: any) => j.id === res2.journalEntryId);

  // Invariant: Additional contribution must NOT become farm revenue
  const addRevenueLines = addJnl.lines.filter((l: any) => l.accountCode.startsWith('4'));
  assert(addRevenueLines.length === 0, 'ADDITIONAL CONTRIBUTION: Zero lines in Revenue accounts (no 4xxx). Not farm revenue.');

  const movements2 = await getInvestorCapitalMovements({ investorId }, mDb);
  assert(movements2.length === 2, 'Capital Movement Ledger contains 2 movements');
  assert(movements2[1].movementType === 'ADDITIONAL_CONTRIBUTION', 'Movement is separately identifiable as ADDITIONAL_CONTRIBUTION');
  assert(movements2[1].amount === 50000, 'Movement amount is ৳50,000');

  // ---------------------------------------------------------------------------
  // STEP 3: WITHDRAWAL OF CAPITAL
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Withdrawal of Capital (৳30,000) ---');
  const res3 = await executeInvestorCapitalReturnTransaction(
    {
      investorId,
      amount: 30000,
      sourceAccountId: bankAccId,
      returnDate: '2026-03-20',
      currentUserId: testUserId,
      notes: 'Partial capital withdrawal'
    },
    mDb
  );

  const allJournals3 = await mDb.journalEntries.toArray();
  const withJnl = allJournals3.find((j: any) => j.id === res3.journalEntryId);

  // Invariant 1: Withdrawal must NOT become farm expense
  const withExpenseLines = withJnl.lines.filter(
    (l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6')
  );
  assert(withExpenseLines.length === 0, 'CAPITAL WITHDRAWAL: Zero lines in Expense accounts (no 5xxx COGS or 6xxx OpEx). Not farm expense.');

  // Invariant 2: Correct GL accounts: Dr Investor Capital (3020) | Cr Bank (1030)
  const withDrEquity = withJnl.lines.find((l: any) => l.accountCode === '3020' && l.debit === 30000);
  const withCrBank = withJnl.lines.find((l: any) => l.accountCode === '1030' && l.credit === 30000);
  assert(Boolean(withDrEquity), 'CAPITAL WITHDRAWAL: Dr Investor Capital (3020) ৳30,000');
  assert(Boolean(withCrBank), 'CAPITAL WITHDRAWAL: Cr Bank (1030) ৳30,000');

  const movements3 = await getInvestorCapitalMovements({ investorId }, mDb);
  assert(movements3.length === 3, 'Capital Movement Ledger contains 3 movements');
  assert(movements3[2].movementType === 'WITHDRAWAL', 'Movement is separately identifiable as WITHDRAWAL');
  assert(movements3[2].amount === 30000, 'Movement amount is ৳30,000');
  assert(movements3[2].direction === 'OUTFLOW', 'Movement direction is OUTFLOW');

  // ---------------------------------------------------------------------------
  // STEP 4: REINVESTED PROFIT (MUST NOT CREATE NEW PROFIT!)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Reinvested Profit (৳20,000) ---');
  // Setup: credit profit payable to investor (৳25,000)
  const currentInv = await mDb.investors.get(investorId);
  await mDb.investors.update(investorId, { profitPayable: 25000 });

  // Baseline P&L check before reinvestment
  const pnlBefore = await generateProfitLoss(
    { startDate: '2026-01-01', endDate: '2026-12-31' },
    undefined,
    mDb
  );

  const res4 = await executeReinvestInvestorProfitTransaction(
    {
      investorId,
      reinvestAmount: 20000,
      contractualProfitSharePercentage: 40,
      date: '2026-04-10',
      currentUserId: testUserId,
      notes: 'Reinvesting Q1 earned profit into capital'
    },
    mDb
  );

  const allJournals4 = await mDb.journalEntries.toArray();
  const reinvJnl = allJournals4.find((j: any) => j.id === res4.journalEntryId);

  // Invariant 1: Must NOT create new profit (Zero 4xxx revenue, zero 5xxx/6xxx expense)
  const reinvRevenueLines = reinvJnl.lines.filter((l: any) => l.accountCode.startsWith('4'));
  const reinvExpenseLines = reinvJnl.lines.filter(
    (l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6')
  );
  assert(reinvRevenueLines.length === 0, 'REINVESTED PROFIT: Zero revenue accounts affected (no 4xxx).');
  assert(reinvExpenseLines.length === 0, 'REINVESTED PROFIT: Zero expense accounts affected (no 5xxx/6xxx).');

  // Invariant 2: GL: Dr Investor Profit Payable (2050) ৳20,000 | Cr Investor Capital (3020) ৳20,000
  const reinvDrPayable = reinvJnl.lines.find((l: any) => l.accountCode === '2050' && l.debit === 20000);
  const reinvCrCapital = reinvJnl.lines.find((l: any) => l.accountCode === '3020' && l.credit === 20000);
  assert(Boolean(reinvDrPayable), 'REINVESTED PROFIT: Dr Investor Profit Payable (2050) ৳20,000');
  assert(Boolean(reinvCrCapital), 'REINVESTED PROFIT: Cr Investor Capital (3020) ৳20,000');

  // Invariant 3: P&L is completely unaffected: net profit change is 0!
  const pnlAfter = await generateProfitLoss(
    { startDate: '2026-01-01', endDate: '2026-12-31' },
    undefined,
    mDb
  );
  assert(
    pnlAfter.netProfit === pnlBefore.netProfit,
    'REINVESTED PROFIT: P&L Net Profit strictly unchanged. No new profit created!'
  );

  const movements4 = await getInvestorCapitalMovements({ investorId }, mDb);
  assert(movements4.length === 4, 'Capital Movement Ledger contains 4 movements');
  assert(movements4[3].movementType === 'REINVESTED_PROFIT', 'Movement is separately identifiable as REINVESTED_PROFIT');
  assert(movements4[3].amount === 20000, 'Movement amount is ৳20,000');

  // ---------------------------------------------------------------------------
  // STEP 5: OTHER APPROVED CAPITAL ADJUSTMENTS
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Approved Capital Adjustment (৳5,000) ---');
  const res5 = await executeApprovedCapitalAdjustmentTransaction(
    {
      investorId,
      adjustmentAmount: 5000,
      direction: 'INFLOW',
      approvedBy: 'Partner Resolution 2026-04',
      date: '2026-05-01',
      currentUserId: testUserId,
      notes: 'Approved capital restructuring adjustment'
    },
    mDb
  );

  const movements5 = await getInvestorCapitalMovements({ investorId }, mDb);
  assert(movements5.length === 5, 'Capital Movement Ledger contains 5 movements');
  assert(movements5[4].movementType === 'ADJUSTMENT', 'Movement is separately identifiable as ADJUSTMENT');
  assert(movements5[4].amount === 5000, 'Movement amount is ৳5,000');

  // ---------------------------------------------------------------------------
  // STEP 6: VERIFY ALL 5 TYPES ARE SEPARATELY IDENTIFIABLE
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying Separate Identifiability of All 5 Categories ---');
  const initList = await getInvestorCapitalMovements({ movementType: 'INITIAL_CONTRIBUTION' }, mDb);
  const addList = await getInvestorCapitalMovements({ movementType: 'ADDITIONAL_CONTRIBUTION' }, mDb);
  const withList = await getInvestorCapitalMovements({ movementType: 'WITHDRAWAL' }, mDb);
  const reinvList = await getInvestorCapitalMovements({ movementType: 'REINVESTED_PROFIT' }, mDb);
  const adjList = await getInvestorCapitalMovements({ movementType: 'ADJUSTMENT' }, mDb);

  assert(initList.length === 1 && initList[0].amount === 100000, 'Query by INITIAL_CONTRIBUTION retrieves ৳100,000');
  assert(addList.length === 1 && addList[0].amount === 50000, 'Query by ADDITIONAL_CONTRIBUTION retrieves ৳50,000');
  assert(withList.length === 1 && withList[0].amount === 30000, 'Query by WITHDRAWAL retrieves ৳30,000');
  assert(reinvList.length === 1 && reinvList[0].amount === 20000, 'Query by REINVESTED_PROFIT retrieves ৳20,000');
  assert(adjList.length === 1 && adjList[0].amount === 5000, 'Query by ADJUSTMENT retrieves ৳5,000');

  // ---------------------------------------------------------------------------
  // STEP 7: ACCOUNTING ENGINE REMAINS BALANCED
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Verifying Accounting Engine Balance ---');
  const tb = await generateTrialBalance({ endDate: '2026-12-31' }, mDb);
  assert(tb.isBalanced, 'Trial Balance is strictly balanced');
  assert(Math.abs(tb.difference) < 0.01, 'Trial Balance difference is zero');
  assert(tb.totalDebit === tb.totalCredit, `Trial Balance: Total Debit (৳${tb.totalDebit}) === Total Credit (৳${tb.totalCredit})`);

  // Final Net Capital Verification on Investor
  // 100,000 (init) + 50,000 (add) - 30,000 (with) + 20,000 (reinv) + 5,000 (adj) = 145,000
  const finalInv = await mDb.investors.get(investorId);
  const expectedCapitalBalance = 145000;
  assert(
    finalInv?.currentCapitalBalance === expectedCapitalBalance,
    `Investor final capital balance matches ledger arithmetic: ৳${finalInv?.currentCapitalBalance} === ৳${expectedCapitalBalance}`
  );

  console.log('\n================================================================');
  console.log(`PROMPT 06 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testCapitalMovementLedger.ts') ||
    process.argv[1].endsWith('testCapitalMovementLedger.js'));

if (isDirectRun) {
  runCapitalMovementLedgerTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 06 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 06 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 06 tests:', err);
      process.exit(1);
    });
}
