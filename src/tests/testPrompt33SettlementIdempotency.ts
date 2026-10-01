import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeParticipantProfitSettlement,
  inspectProfitSettlementIdempotency,
  calculateParticipantProfitRetention
} from '../services/settlementService';
import { generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { ExecuteProfitSettlementParams } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 33 — Settlement Idempotency
 *
 * Requirements:
 * Inspect profit settlement idempotency.
 *
 * The same settlement must not be posted twice because of:
 * - double-click;
 * - browser retry;
 * - network retry;
 * - page refresh;
 * - offline sync retry.
 *
 * Use a durable idempotency key.
 *
 * Test by submitting the exact same settlement twice.
 *
 * Expected:
 * Exactly one financial settlement.
 *
 * Return PASS.
 */
export async function runPrompt33SettlementIdempotencyTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 33: SETTLEMENT IDEMPOTENCY');
  console.log('Testing: Durable Idempotency Key Enforcement,');
  console.log('Protection against Double-Click, Browser Retry, Network Retry,');
  console.log('Page Refresh, and Offline Sync Retry,');
  console.log('Invariant: Exactly One Financial Settlement on Duplicate Submissions');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Direct Execution of Exact Prompt Scenario
  // Submit exact same settlement twice with a durable idempotency key.
  // ===========================================================================
  console.log('--- Step 1: Direct Execution of Exact Prompt Scenario ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const testInvestorId = 'inv_p33_golden_1';
  const testInvestorName = 'Al-Haj Bashir Ahmed (Investor)';
  const testBankId = 'bank_p33_golden_1';
  const testUserId = 'settlement_auditor_p33';
  const durableIdempotencyKey = 'idemp_settle_p33_exact_golden_777';

  // Seed bank account (৳50,000)
  await mDb.cashBankAccounts.put({
    id: testBankId,
    accountType: 'BANK',
    name: 'Islami Bank Bangladesh Ltd (Principal Account)',
    currentBalance: 50000,
    isActive: true,
    synced: false
  });

  // Seed investor: Capital ৳100, Profit Payable ৳100
  await mDb.investors.put({
    id: testInvestorId,
    name: testInvestorName,
    phone: '01711223344',
    totalInvestment: 100,
    currentCapital: 100,
    capitalAmount: 100,
    capitalContributed: 100,
    currentCapitalBalance: 100,
    profitPayable: 100,
    totalProfitAllocated: 100,
    profitSharingRatio: 40,
    status: 'ACTIVE',
    joinedDate: '2026-01-01',
    synced: false
  });

  // Seed initial investment tranche (৳100)
  const initialTrancheId = 'tranche_p33_init_1';
  await mDb.investmentTranches.put({
    id: initialTrancheId,
    trancheId: initialTrancheId,
    trancheNumber: 'TR-P33-INIT',
    investorId: testInvestorId,
    participantId: testInvestorId,
    investorName: testInvestorName,
    investmentAmount: 100,
    amount: 100,
    originalCapital: 100,
    currentCapital: 100,
    currentCapitalBalance: 100,
    totalCapitalReturned: 0,
    investmentDate: '2026-01-01',
    effectiveDate: '2026-01-01',
    effectiveInvestmentDate: '2026-01-01',
    contractualProfitSharePercentage: 40,
    status: 'ACTIVE',
    creationTimestamp: '2026-01-01T00:00:00.000Z',
    synced: false
  });

  const preJournalsCount = (await mDb.journalEntries.toArray()).length;
  const preTranchesCount = (await mDb.investmentTranches.toArray()).length;
  const preMovementsCount = (await mDb.investorCapitalMovements.toArray()).length;

  const exactPayload: ExecuteProfitSettlementParams = {
    investorId: testInvestorId,
    profit: 100,
    reinvestPercentage: 50, // ৳50 reinvested, ৳50 withdrawn
    bankAccountId: testBankId,
    date: '2026-04-01',
    effectiveDate: '2026-04-01',
    sourceProfitAllocationId: 'alloc_q1_p33_golden',
    settlementEventId: 'settle_evt_p33_golden',
    idempotencyKey: durableIdempotencyKey,
    currentUserId: testUserId,
    notes: 'Q1 Profit Settlement with durable idempotency key'
  };

  // 1. First Submission
  console.log('\n--- Executing Submission 1 (Initial Settlement) ---');
  const res1 = await executeParticipantProfitSettlement(exactPayload, mDb);

  assert(res1.passed === true, 'Submission 1: executeParticipantProfitSettlement passed cleanly');
  assert(res1.isDuplicate === false, 'Submission 1: isDuplicate is false');
  assert(res1.idempotentReplay === false, 'Submission 1: idempotentReplay is false');
  assert(res1.reinvestedCapital === 50, 'Submission 1: Reinvested capital is ৳50');
  assert(res1.withdrawableAmount === 50, 'Submission 1: Withdrawable amount is ৳50');
  assert(res1.futureCapitalPosition === 150, 'Submission 1: Future capital position is ৳150');
  assert(res1.reinvestJournalEntryId !== undefined, 'Submission 1: Reinvest journal created');
  assert(res1.withdrawJournalEntryId !== undefined, 'Submission 1: Withdraw journal created');
  assert(res1.reinvestTranche !== undefined, 'Submission 1: New capital tranche created');
  assert(res1.capitalMovement !== undefined, 'Submission 1: Capital movement logged');

  const journalsAfter1 = (await mDb.journalEntries.toArray()).length;
  const tranchesAfter1 = (await mDb.investmentTranches.toArray()).length;
  const movementsAfter1 = (await mDb.investorCapitalMovements.toArray()).length;
  const bankBalAfter1 = (await mDb.cashBankAccounts.get(testBankId))?.currentBalance;
  const invAfter1 = await mDb.investors.get(testInvestorId);

  assert(journalsAfter1 === preJournalsCount + 2, 'Submission 1: Exactly 2 journal entries created (1 reinvest + 1 withdraw)');
  assert(tranchesAfter1 === preTranchesCount + 1, 'Submission 1: Exactly 1 new tranche created');
  assert(movementsAfter1 === preMovementsCount + 1, 'Submission 1: Exactly 1 capital movement logged');
  assert(bankBalAfter1 === 49950, 'Submission 1: Bank balance decreased by ৳50 (50000 -> 49950)');
  assert(invAfter1?.currentCapital === 150, 'Submission 1: Investor capital increased by ৳50 (100 -> 150)');
  assert(invAfter1?.profitPayable === 0, 'Submission 1: Investor profit payable cleared to ৳0');

  // 2. Second Submission (Exact Same Settlement Resubmitted)
  // Simulates double-click, browser retry, network retry, page refresh, offline sync retry
  console.log('\n--- Executing Submission 2 (Submitting Exact Same Settlement Twice) ---');
  const res2 = await executeParticipantProfitSettlement(exactPayload, mDb);

  assert(res2.passed === true, 'Submission 2: executeParticipantProfitSettlement succeeded without throwing error');
  assert(res2.isDuplicate === true, 'Submission 2: Duplicate detected (isDuplicate === true)');
  assert(res2.idempotentReplay === true, 'Submission 2: Idempotent replay returned (idempotentReplay === true)');
  assert(res2.reinvestJournalEntryId === res1.reinvestJournalEntryId, 'Submission 2: Reinvest journal ID is identical to Submission 1');
  assert(res2.withdrawJournalEntryId === res1.withdrawJournalEntryId, 'Submission 2: Withdraw journal ID is identical to Submission 1');
  assert(res2.reinvestTranche?.id === res1.reinvestTranche?.id, 'Submission 2: Tranche ID is identical to Submission 1');
  assert(res2.capitalMovement?.id === res1.capitalMovement?.id, 'Submission 2: Capital movement ID is identical to Submission 1');

  // ===========================================================================
  // REQUIREMENT: EXACTLY ONE FINANCIAL SETTLEMENT IN THE DATABASE
  // ===========================================================================
  console.log('\n--- Checking Requirement: Exactly One Financial Settlement in Database ---');

  const journalsAfter2 = (await mDb.journalEntries.toArray()).length;
  const tranchesAfter2 = (await mDb.investmentTranches.toArray()).length;
  const movementsAfter2 = (await mDb.investorCapitalMovements.toArray()).length;
  const bankBalAfter2 = (await mDb.cashBankAccounts.get(testBankId))?.currentBalance;
  const invAfter2 = await mDb.investors.get(testInvestorId);

  assert(
    journalsAfter2 === journalsAfter1,
    `CRITICAL INVARIANT: Zero second journal entries created! Total journals: ${journalsAfter2} === ${journalsAfter1}`
  );
  assert(
    tranchesAfter2 === tranchesAfter1,
    `CRITICAL INVARIANT: Zero second investment tranches created! Total tranches: ${tranchesAfter2} === ${tranchesAfter1}`
  );
  assert(
    movementsAfter2 === movementsAfter1,
    `CRITICAL INVARIANT: Zero second capital movements created! Total movements: ${movementsAfter2} === ${movementsAfter1}`
  );
  assert(
    bankBalAfter2 === 49950,
    `CRITICAL INVARIANT: Bank balance was NOT deducted a second time! Balance remains ৳${bankBalAfter2} (Expected: ৳49950)`
  );
  assert(
    invAfter2?.currentCapital === 150,
    `CRITICAL INVARIANT: Investor capital was NOT credited a second time! Capital remains ৳${invAfter2?.currentCapital} (Expected: ৳150)`
  );
  assert(
    invAfter2?.profitPayable === 0,
    `CRITICAL INVARIANT: Investor profit payable remains ৳0 (No negative payable: ৳${invAfter2?.profitPayable})`
  );

  // Verify Trial Balance is balanced and zero revenue/opex duplication
  const tb = await generateTrialBalance({ endDate: '2026-04-02' }, mDb);
  assert(tb.isBalanced === true, 'Trial Balance is strictly balanced');
  assert(tb.difference === 0, 'Trial Balance difference is strictly ৳0');

  const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-02' }, undefined, mDb);
  assert(pnl.totalRevenue === 0, 'Settlement created strictly ৳0 operating revenue (Zero revenue creation)');
  assert(pnl.totalOperatingExpenses === 0, 'Settlement created strictly ৳0 operating expense (Zero expense creation)');

  // ===========================================================================
  // STEP 2: Specific Failure Scenarios Coverage
  // 1. Double-Click Concurrency (Promise.allSettled)
  // 2. Browser & Network Retry
  // 3. Page Refresh Simulation
  // 4. Offline Sync Retry Simulation
  // 5. Strict Rejection Verification (throwOnDuplicate: true)
  // ===========================================================================
  console.log('\n--- Step 2: Testing Double-Click Concurrent Submissions ---');

  const doubleClickKey = 'idemp_double_click_sim_999';
  const doubleClickPayload: ExecuteProfitSettlementParams = {
    ...exactPayload,
    idempotencyKey: doubleClickKey,
    settlementEventId: `settle_evt_${doubleClickKey}`,
    sourceProfitAllocationId: `alloc_${doubleClickKey}`
  };

  // Simulate two rapid clicks fired at the exact same millisecond
  const [click1, click2] = await Promise.allSettled([
    executeParticipantProfitSettlement(doubleClickPayload, mDb),
    executeParticipantProfitSettlement(doubleClickPayload, mDb)
  ]);

  assert(click1.status === 'fulfilled', 'Double-click: First click promise resolved');
  assert(click2.status === 'fulfilled', 'Double-click: Second click promise resolved safely');

  const tranchesForDoubleClick = (await mDb.investmentTranches.toArray()).filter(
    (t: any) => t.idempotencyKey === doubleClickKey
  );
  assert(
    tranchesForDoubleClick.length === 1,
    `Double-click: Exactly 1 tranche created for double-click key (got ${tranchesForDoubleClick.length})`
  );

  const movementsForDoubleClick = (await mDb.investorCapitalMovements.toArray()).filter(
    (m: any) => m.idempotencyKey === doubleClickKey
  );
  assert(
    movementsForDoubleClick.length === 1,
    `Double-click: Exactly 1 capital movement logged for double-click key (got ${movementsForDoubleClick.length})`
  );

  console.log('\n--- Step 3: Testing Page Refresh / Offline Sync Retry Simulation ---');

  // Simulate user refreshing the page or offline queue syncing the exact same item
  const refreshRetryRes = await executeParticipantProfitSettlement(exactPayload, mDb);
  assert(refreshRetryRes.isDuplicate === true, 'Page refresh retry: Identified existing settlement');
  assert(refreshRetryRes.idempotentReplay === true, 'Page refresh retry: Replayed settlement idempotently');

  console.log('\n--- Step 4: Testing Strict Duplicate Rejection (throwOnDuplicate: true) ---');

  let caughtDuplicateException = false;
  try {
    await executeParticipantProfitSettlement(
      {
        ...exactPayload,
        throwOnDuplicate: true
      },
      mDb
    );
  } catch (err: any) {
    caughtDuplicateException = true;
    assert(
      err.message.includes('ডুপ্লিকেট') ||
      err.message.includes('Duplicate') ||
      err.message.includes('idempotency') ||
      err.message.includes('আইডেমপোটেন্সি'),
      'Strict mode: Safely rejected duplicate with clear idempotency error message'
    );
  }
  assert(caughtDuplicateException === true, 'Strict mode: Duplicate submission threw error as requested');

  // ===========================================================================
  // STEP 3: Execute inspectProfitSettlementIdempotency Golden Suite
  // ===========================================================================
  console.log('\n--- Step 5: Executing inspectProfitSettlementIdempotency Golden Suite ---');

  const inspectionRes = await inspectProfitSettlementIdempotency({
    profit: 100,
    reinvestPercentage: 50,
    investorId: 'inv_p33_inspect_suite',
    investorName: 'Ismail Chowdhury (Investor)',
    bankAccountId: 'bank_p33_inspect_acc',
    idempotencyKey: 'idemp_key_suite_inspect_999',
    dbInstance: mDb
  });

  assert(inspectionRes.passed === true, 'inspectProfitSettlementIdempotency passed === true');
  assert(inspectionRes.duplicatePrevented === true, 'Inspection: duplicatePrevented === true');
  assert(inspectionRes.exactlyOneFinancialSettlement === true, 'Inspection: exactlyOneFinancialSettlement === true');
  assert(inspectionRes.bankDeductionCount === 1, 'Inspection: bankDeductionCount === 1');
  assert(inspectionRes.capitalAdditionCount === 1, 'Inspection: capitalAdditionCount === 1');
  assert(inspectionRes.totalTranchesCreated === 1, 'Inspection: totalTranchesCreated === 1');
  assert(inspectionRes.totalMovementsCreated === 1, 'Inspection: totalMovementsCreated === 1');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 33 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt33SettlementIdempotencyTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 33 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 33 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 33 tests:', err);
      process.exit(1);
    });
}
