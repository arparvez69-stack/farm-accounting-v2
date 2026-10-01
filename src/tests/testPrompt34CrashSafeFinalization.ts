import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeFinalAllocationAndSettlement,
  checkFinalAllocationSettlementStatus,
  inspectCrashSafeFinalization
} from '../services/settlementService';
import { generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 34 — Crash-Safe Finalization
 *
 * Requirements:
 * Inspect the final allocation + settlement transaction.
 *
 * If the process stops halfway through, it must not leave partial accounting.
 *
 * Test an interruption between:
 * 1. profit allocation;
 * 2. settlement;
 * 3. reinvestment.
 *
 * After recovery, verify the system can safely determine whether the operation committed.
 *
 * Do not create duplicate profit or duplicate capital.
 *
 * Use existing atomic transaction/idempotency mechanisms.
 *
 * Return PASS only after a real test.
 */
export async function runPrompt34CrashSafeFinalizationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 34: CRASH-SAFE FINALIZATION');
  console.log('Testing: Atomicity of Final Allocation + Settlement Transaction,');
  console.log('Interruption Checkpoints:');
  console.log('  1. Interruption after Profit Allocation');
  console.log('  2. Interruption after Settlement / Withdrawal');
  console.log('  3. Interruption during Reinvestment Tranche Creation');
  console.log('Recovery & Re-execution Guarantees:');
  console.log('  - Safe determination of commit status');
  console.log('  - Zero partial accounting on crash');
  console.log('  - Zero duplicate profit or duplicate capital on retry');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Interruption after Profit Allocation (Checkpoint 1)
  // Process crashes right after allocation journal is drafted.
  // Must roll back cleanly leaving ZERO partial accounting.
  // ===========================================================================
  console.log('--- Step 1: Testing Interruption after Profit Allocation (Checkpoint 1) ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const testInvestorId = 'inv_p34_golden_1';
  const testInvestorName = 'Mowlana Abdul Hakim (Investor)';
  const testBankId = 'bank_p34_golden_1';
  const testMudaribId = 'mudarib_p34_golden';
  const testMudaribName = 'Md. Tariqul Islam (Farm Mudarib)';

  // Seed bank account (৳60,000)
  await mDb.cashBankAccounts.put({
    id: testBankId,
    accountType: 'BANK',
    name: 'Pubali Bank (Settlement Account)',
    currentBalance: 60000,
    isActive: true,
    synced: false
  });

  // Seed investor with ৳100 initial capital, 0 profit payable
  await mDb.investors.put({
    id: testInvestorId,
    name: testInvestorName,
    phone: '01911223344',
    totalInvestment: 100,
    currentCapital: 100,
    capitalAmount: 100,
    capitalContributed: 100,
    currentCapitalBalance: 100,
    profitPayable: 0,
    totalProfitAllocated: 0,
    profitSharingRatio: 50,
    status: 'ACTIVE',
    joinedDate: '2026-01-01',
    synced: false
  });

  const baselineJournals = (await mDb.journalEntries.toArray()).length;
  const baselineTranches = (await mDb.investmentTranches.toArray()).length;
  const baselineMovements = (await mDb.investorCapitalMovements.toArray()).length;

  const keyInterruption1 = 'idemp_p34_crash_chkpt_1';
  let chkpt1Interrupted = false;

  try {
    await executeFinalAllocationAndSettlement(
      {
        periodEndDate: '2026-03-31',
        totalDistributableProfit: 200, // ৳100 investor, ৳100 mudarib
        investorId: testInvestorId,
        investorName: testInvestorName,
        investorSharePercentage: 50,
        mudaribPersonId: testMudaribId,
        mudaribName: testMudaribName,
        mudaribSharePercentage: 50,
        reinvestPercentage: 50, // ৳50 reinvest, ৳50 withdraw
        bankAccountId: testBankId,
        idempotencyKey: keyInterruption1,
        simulateInterruptionAt: 'AFTER_ALLOCATION'
      },
      mDb
    );
  } catch (err: any) {
    chkpt1Interrupted = err.message.includes('CRASH_SIMULATION');
  }

  assert(chkpt1Interrupted, 'Checkpoint 1: Mid-transaction crash after allocation was caught');

  // Verify status check after Checkpoint 1 crash
  const status1 = await checkFinalAllocationSettlementStatus(keyInterruption1, mDb);
  assert(status1.committed === false, 'Checkpoint 1: checkFinalAllocationSettlementStatus reports committed === false');
  assert(status1.status === 'NOT_COMMITTED', 'Checkpoint 1: checkFinalAllocationSettlementStatus status is NOT_COMMITTED');

  // Verify ZERO partial accounting in database
  const journalsAfter1 = (await mDb.journalEntries.toArray()).length;
  const tranchesAfter1 = (await mDb.investmentTranches.toArray()).length;
  const movementsAfter1 = (await mDb.investorCapitalMovements.toArray()).length;
  const invAfter1 = await mDb.investors.get(testInvestorId);
  const bankAfter1 = await mDb.cashBankAccounts.get(testBankId);

  assert(journalsAfter1 === baselineJournals, `Checkpoint 1: Zero partial journals created (got ${journalsAfter1}, expected ${baselineJournals})`);
  assert(tranchesAfter1 === baselineTranches, `Checkpoint 1: Zero partial tranches created (got ${tranchesAfter1}, expected ${baselineTranches})`);
  assert(movementsAfter1 === baselineMovements, `Checkpoint 1: Zero partial movements logged (got ${movementsAfter1}, expected ${baselineMovements})`);
  assert(invAfter1?.profitPayable === 0, `Checkpoint 1: Investor profit payable rolled back to ৳0 (got ${invAfter1?.profitPayable})`);
  assert(invAfter1?.currentCapital === 100, `Checkpoint 1: Investor capital unchanged at ৳100 (got ${invAfter1?.currentCapital})`);
  assert(bankAfter1?.currentBalance === 60000, `Checkpoint 1: Bank balance unchanged at ৳60000 (got ${bankAfter1?.currentBalance})`);

  // ===========================================================================
  // STEP 2: Interruption after Settlement / Withdrawal (Checkpoint 2)
  // Process crashes after withdrawal journal is drafted.
  // Must roll back cleanly leaving ZERO partial accounting.
  // ===========================================================================
  console.log('\n--- Step 2: Testing Interruption after Settlement (Checkpoint 2) ---');

  const keyInterruption2 = 'idemp_p34_crash_chkpt_2';
  let chkpt2Interrupted = false;

  try {
    await executeFinalAllocationAndSettlement(
      {
        periodEndDate: '2026-03-31',
        totalDistributableProfit: 200,
        investorId: testInvestorId,
        investorName: testInvestorName,
        investorSharePercentage: 50,
        mudaribPersonId: testMudaribId,
        mudaribName: testMudaribName,
        mudaribSharePercentage: 50,
        reinvestPercentage: 50,
        bankAccountId: testBankId,
        idempotencyKey: keyInterruption2,
        simulateInterruptionAt: 'AFTER_SETTLEMENT'
      },
      mDb
    );
  } catch (err: any) {
    chkpt2Interrupted = err.message.includes('CRASH_SIMULATION');
  }

  assert(chkpt2Interrupted, 'Checkpoint 2: Mid-transaction crash after settlement was caught');

  const status2 = await checkFinalAllocationSettlementStatus(keyInterruption2, mDb);
  assert(status2.committed === false, 'Checkpoint 2: checkFinalAllocationSettlementStatus reports committed === false');
  assert(status2.status === 'NOT_COMMITTED', 'Checkpoint 2: checkFinalAllocationSettlementStatus status is NOT_COMMITTED');

  const journalsAfter2 = (await mDb.journalEntries.toArray()).length;
  const tranchesAfter2 = (await mDb.investmentTranches.toArray()).length;
  const movementsAfter2 = (await mDb.investorCapitalMovements.toArray()).length;
  const invAfter2 = await mDb.investors.get(testInvestorId);
  const bankAfter2 = await mDb.cashBankAccounts.get(testBankId);

  assert(journalsAfter2 === baselineJournals, `Checkpoint 2: Zero partial journals created (got ${journalsAfter2}, expected ${baselineJournals})`);
  assert(tranchesAfter2 === baselineTranches, `Checkpoint 2: Zero partial tranches created (got ${tranchesAfter2}, expected ${baselineTranches})`);
  assert(movementsAfter2 === baselineMovements, `Checkpoint 2: Zero partial movements logged (got ${movementsAfter2}, expected ${baselineMovements})`);
  assert(invAfter2?.profitPayable === 0, `Checkpoint 2: Investor profit payable rolled back to ৳0 (got ${invAfter2?.profitPayable})`);
  assert(invAfter2?.currentCapital === 100, `Checkpoint 2: Investor capital unchanged at ৳100 (got ${invAfter2?.currentCapital})`);
  assert(bankAfter2?.currentBalance === 60000, `Checkpoint 2: Bank balance rolled back to ৳60000 (got ${bankAfter2?.currentBalance})`);

  // ===========================================================================
  // STEP 3: Interruption during Reinvestment Tranche Creation (Checkpoint 3)
  // Process crashes after reinvestment journal but before tranche/audit.
  // Must roll back cleanly leaving ZERO partial accounting.
  // ===========================================================================
  console.log('\n--- Step 3: Testing Interruption during Reinvestment (Checkpoint 3) ---');

  const keyInterruption3 = 'idemp_p34_crash_chkpt_3';
  let chkpt3Interrupted = false;

  try {
    await executeFinalAllocationAndSettlement(
      {
        periodEndDate: '2026-03-31',
        totalDistributableProfit: 200,
        investorId: testInvestorId,
        investorName: testInvestorName,
        investorSharePercentage: 50,
        mudaribPersonId: testMudaribId,
        mudaribName: testMudaribName,
        mudaribSharePercentage: 50,
        reinvestPercentage: 50,
        bankAccountId: testBankId,
        idempotencyKey: keyInterruption3,
        simulateInterruptionAt: 'AFTER_REINVESTMENT'
      },
      mDb
    );
  } catch (err: any) {
    chkpt3Interrupted = err.message.includes('CRASH_SIMULATION');
  }

  assert(chkpt3Interrupted, 'Checkpoint 3: Mid-transaction crash during reinvestment was caught');

  const status3 = await checkFinalAllocationSettlementStatus(keyInterruption3, mDb);
  assert(status3.committed === false, 'Checkpoint 3: checkFinalAllocationSettlementStatus reports committed === false');
  assert(status3.status === 'NOT_COMMITTED', 'Checkpoint 3: checkFinalAllocationSettlementStatus status is NOT_COMMITTED');

  const journalsAfter3 = (await mDb.journalEntries.toArray()).length;
  const tranchesAfter3 = (await mDb.investmentTranches.toArray()).length;
  const movementsAfter3 = (await mDb.investorCapitalMovements.toArray()).length;
  const invAfter3 = await mDb.investors.get(testInvestorId);
  const bankAfter3 = await mDb.cashBankAccounts.get(testBankId);

  assert(journalsAfter3 === baselineJournals, `Checkpoint 3: Zero partial journals created (got ${journalsAfter3}, expected ${baselineJournals})`);
  assert(tranchesAfter3 === baselineTranches, `Checkpoint 3: Zero partial tranches created (got ${tranchesAfter3}, expected ${baselineTranches})`);
  assert(movementsAfter3 === baselineMovements, `Checkpoint 3: Zero partial movements logged (got ${movementsAfter3}, expected ${baselineMovements})`);
  assert(invAfter3?.currentCapital === 100, `Checkpoint 3: Investor capital rolled back to ৳100 (got ${invAfter3?.currentCapital})`);
  assert(bankAfter3?.currentBalance === 60000, `Checkpoint 3: Bank balance rolled back to ৳60000 (got ${bankAfter3?.currentBalance})`);

  // ===========================================================================
  // STEP 4: Recovery and Clean Finalization
  // After recovery, transaction is executed to completion without interruption.
  // ===========================================================================
  console.log('\n--- Step 4: Testing Recovery and Clean Finalization ---');

  const recoveryKey = 'idemp_p34_crash_safe_recovery_final';

  const recoveryResult = await executeFinalAllocationAndSettlement(
    {
      periodEndDate: '2026-03-31',
      totalDistributableProfit: 200,
      investorId: testInvestorId,
      investorName: testInvestorName,
      investorSharePercentage: 50,
      mudaribPersonId: testMudaribId,
      mudaribName: testMudaribName,
      mudaribSharePercentage: 50,
      reinvestPercentage: 50,
      bankAccountId: testBankId,
      idempotencyKey: recoveryKey
    },
    mDb
  );

  assert(recoveryResult.passed === true, 'Recovery: executeFinalAllocationAndSettlement completed with passed: true');
  assert(recoveryResult.committed === true, 'Recovery: executeFinalAllocationAndSettlement committed === true');
  assert(recoveryResult.reinvestedCapital === 50, `Recovery: Reinvested capital is ৳50 (got ${recoveryResult.reinvestedCapital})`);
  assert(recoveryResult.withdrawableAmount === 50, `Recovery: Withdrawable amount is ৳50 (got ${recoveryResult.withdrawableAmount})`);
  assert(recoveryResult.futureCapitalPosition === 150, `Recovery: Future capital position is ৳150 (got ${recoveryResult.futureCapitalPosition})`);

  // Verify status check after recovery
  const statusRecovery = await checkFinalAllocationSettlementStatus(recoveryKey, mDb);
  assert(statusRecovery.committed === true, 'Recovery: checkFinalAllocationSettlementStatus reports committed === true');
  assert(statusRecovery.status === 'COMMITTED', 'Recovery: checkFinalAllocationSettlementStatus status is COMMITTED');
  assert(statusRecovery.allocationCommitted === true, 'Recovery: allocationCommitted === true');
  assert(statusRecovery.settlementCommitted === true, 'Recovery: settlementCommitted === true');
  assert(statusRecovery.reinvestmentCommitted === true, 'Recovery: reinvestmentCommitted === true');

  // Verify committed records in database
  const journalsCommitted = (await mDb.journalEntries.toArray()).length;
  const tranchesCommitted = (await mDb.investmentTranches.toArray()).length;
  const movementsCommitted = (await mDb.investorCapitalMovements.toArray()).length;
  const invCommitted = await mDb.investors.get(testInvestorId);
  const bankCommitted = await mDb.cashBankAccounts.get(testBankId);

  assert(journalsCommitted === baselineJournals + 3, `Recovery: Exactly 3 journals created (1 alloc + 1 withdraw + 1 reinv) (got ${journalsCommitted})`);
  assert(tranchesCommitted === baselineTranches + 1, `Recovery: Exactly 1 new tranche created (got ${tranchesCommitted})`);
  assert(movementsCommitted === baselineMovements + 1, `Recovery: Exactly 1 capital movement logged (got ${movementsCommitted})`);
  assert(invCommitted?.currentCapital === 150, `Recovery: Investor capital increased from ৳100 to ৳150 (got ${invCommitted?.currentCapital})`);
  assert(bankCommitted?.currentBalance === 59950, `Recovery: Bank balance decreased from ৳60000 to ৳59950 (got ${bankCommitted?.currentBalance})`);
  assert(invCommitted?.profitPayable === 0, `Recovery: Investor profit payable cleared to ৳0 (got ${invCommitted?.profitPayable})`);

  // Verify P&L and Trial Balance
  const tb = await generateTrialBalance({ endDate: '2026-04-01' }, mDb);
  assert(tb.isBalanced === true, 'Recovery: Trial Balance is strictly balanced');
  assert(tb.difference === 0, `Recovery: Trial Balance difference is strictly ৳0 (got ${tb.difference})`);

  // ===========================================================================
  // STEP 5: Resubmission / Retry (Duplicate Protection Invariant)
  // Re-submitting the exact same transaction must NOT create duplicate profit or duplicate capital.
  // ===========================================================================
  console.log('\n--- Step 5: Testing Resubmission / Retry (Duplicate Protection) ---');

  const replayResult = await executeFinalAllocationAndSettlement(
    {
      periodEndDate: '2026-03-31',
      totalDistributableProfit: 200,
      investorId: testInvestorId,
      investorName: testInvestorName,
      investorSharePercentage: 50,
      mudaribPersonId: testMudaribId,
      mudaribName: testMudaribName,
      mudaribSharePercentage: 50,
      reinvestPercentage: 50,
      bankAccountId: testBankId,
      idempotencyKey: recoveryKey
    },
    mDb
  );

  assert(replayResult.passed === true, 'Resubmission: Succeeded safely');
  assert(replayResult.isDuplicate === true, 'Resubmission: isDuplicate === true');
  assert(replayResult.idempotentReplay === true, 'Resubmission: idempotentReplay === true');
  assert(replayResult.duplicateProfitCreated === false, 'Resubmission: duplicateProfitCreated === false');
  assert(replayResult.duplicateCapitalCreated === false, 'Resubmission: duplicateCapitalCreated === false');

  // Verify NO duplicate records exist in database
  const journalsAfterReplay = (await mDb.journalEntries.toArray()).length;
  const tranchesAfterReplay = (await mDb.investmentTranches.toArray()).length;
  const movementsAfterReplay = (await mDb.investorCapitalMovements.toArray()).length;
  const invAfterReplay = await mDb.investors.get(testInvestorId);
  const bankAfterReplay = await mDb.cashBankAccounts.get(testBankId);

  assert(journalsAfterReplay === journalsCommitted, `Resubmission: No duplicate journals created (still ${journalsAfterReplay})`);
  assert(tranchesAfterReplay === tranchesCommitted, `Resubmission: No duplicate tranches created (still ${tranchesAfterReplay})`);
  assert(movementsAfterReplay === movementsCommitted, `Resubmission: No duplicate movements created (still ${movementsAfterReplay})`);
  assert(invAfterReplay?.currentCapital === 150, `Resubmission: Investor capital remained ৳150 (NOT ৳200) (got ${invAfterReplay?.currentCapital})`);
  assert(bankAfterReplay?.currentBalance === 59950, `Resubmission: Bank balance remained ৳59950 (NOT ৳59900) (got ${bankAfterReplay?.currentBalance})`);

  // ===========================================================================
  // STEP 6: Execute inspectCrashSafeFinalization Golden Suite
  // ===========================================================================
  console.log('\n--- Step 6: Executing inspectCrashSafeFinalization Golden Suite ---');

  const inspectionDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await inspectionDb.accounts.put(acc);
  }

  const inspectionResult = await inspectCrashSafeFinalization({
    dbInstance: inspectionDb,
    totalDistributableProfit: 200,
    reinvestPercentage: 50,
    investorId: 'inv_p34_inspect',
    bankAccountId: 'bank_p34_inspect'
  });

  assert(inspectionResult.passed === true, 'inspectCrashSafeFinalization: passed === true');
  assert(inspectionResult.interruptionAfterAllocationCleanRollback === true, 'inspectCrashSafeFinalization: interruptionAfterAllocationCleanRollback === true');
  assert(inspectionResult.interruptionAfterSettlementCleanRollback === true, 'inspectCrashSafeFinalization: interruptionAfterSettlementCleanRollback === true');
  assert(inspectionResult.interruptionDuringReinvestmentCleanRollback === true, 'inspectCrashSafeFinalization: interruptionDuringReinvestmentCleanRollback === true');
  assert(inspectionResult.recoveryDeterminesCommitStatusAccurately === true, 'inspectCrashSafeFinalization: recoveryDeterminesCommitStatusAccurately === true');
  assert(inspectionResult.recoveryReexecutionSuccessful === true, 'inspectCrashSafeFinalization: recoveryReexecutionSuccessful === true');
  assert(inspectionResult.noPartialAccountingVerified === true, 'inspectCrashSafeFinalization: noPartialAccountingVerified === true');
  assert(inspectionResult.noDuplicateProfitVerified === true, 'inspectCrashSafeFinalization: noDuplicateProfitVerified === true');
  assert(inspectionResult.noDuplicateCapitalVerified === true, 'inspectCrashSafeFinalization: noDuplicateCapitalVerified === true');
  assert(inspectionResult.trialBalanceBalanced === true, 'inspectCrashSafeFinalization: trialBalanceBalanced === true');

  // ===========================================================================
  // STEP 7: Testing on Real Dexie AgroDatabase (IndexedDB Engine)
  // Verify that real browser IndexedDB transaction engine rolls back atomically
  // ===========================================================================
  console.log('\n--- Step 7: Testing on Real Dexie AgroDatabase (IndexedDB Engine) ---');

  const realDbName = `AgroCrashFinalizationDb_${Date.now()}`;
  const realDb = new AgroDatabase(realDbName);
  await realDb.open();
  await Promise.all(realDb.tables.map((t) => t.clear()));

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await realDb.accounts.put(acc);
  }

  const realBankId = 'bank_p34_real';
  const realInvId = 'inv_p34_real';

  await realDb.cashBankAccounts.put({
    id: realBankId,
    accountType: 'BANK',
    name: 'Real Pubali Bank (IndexedDB)',
    currentBalance: 80000,
    isActive: true,
    synced: false
  });

  await realDb.investors.put({
    id: realInvId,
    name: 'Real Investor (IndexedDB)',
    phone: '01888888888',
    totalInvestment: 500,
    currentCapital: 500,
    capitalAmount: 500,
    capitalContributed: 500,
    currentCapitalBalance: 500,
    profitPayable: 0,
    totalProfitAllocated: 0,
    profitSharingRatio: 50,
    status: 'ACTIVE',
    joinedDate: '2026-01-01',
    synced: false
  });

  const realBaseJournals = (await realDb.journalEntries.toArray()).length;

  // Interruption on real Dexie
  let realInterrupted = false;
  try {
    await executeFinalAllocationAndSettlement(
      {
        periodEndDate: '2026-03-31',
        totalDistributableProfit: 400,
        investorId: realInvId,
        investorName: 'Real Investor (IndexedDB)',
        investorSharePercentage: 50,
        mudaribSharePercentage: 50,
        reinvestPercentage: 50,
        bankAccountId: realBankId,
        idempotencyKey: 'idemp_real_dexie_crash_chkpt',
        simulateInterruptionAt: 'AFTER_SETTLEMENT'
      },
      realDb
    );
  } catch (err: any) {
    realInterrupted = err.message.includes('CRASH_SIMULATION');
  }

  assert(realInterrupted, 'Real IndexedDB: Simulated crash caught');
  const realStatusAfterCrash = await checkFinalAllocationSettlementStatus('idemp_real_dexie_crash_chkpt', realDb);
  assert(realStatusAfterCrash.status === 'NOT_COMMITTED', 'Real IndexedDB: Status accurately reports NOT_COMMITTED after crash');

  const realJournalsAfterCrash = (await realDb.journalEntries.toArray()).length;
  assert(realJournalsAfterCrash === realBaseJournals, `Real IndexedDB: Clean rollback with zero journals (got ${realJournalsAfterCrash})`);

  const realInvAfterCrash = await realDb.investors.get(realInvId);
  const realBankAfterCrash = await realDb.cashBankAccounts.get(realBankId);
  assert(realInvAfterCrash?.currentCapital === 500, `Real IndexedDB: Capital unchanged at ৳500 (got ${realInvAfterCrash?.currentCapital})`);
  assert(realBankAfterCrash?.currentBalance === 80000, `Real IndexedDB: Bank balance unchanged at ৳80000 (got ${realBankAfterCrash?.currentBalance})`);

  // Clean execution on real Dexie
  const realCleanResult = await executeFinalAllocationAndSettlement(
    {
      periodEndDate: '2026-03-31',
      totalDistributableProfit: 400,
      investorId: realInvId,
      investorName: 'Real Investor (IndexedDB)',
      investorSharePercentage: 50,
      mudaribSharePercentage: 50,
      reinvestPercentage: 50,
      bankAccountId: realBankId,
      idempotencyKey: 'idemp_real_dexie_clean'
    },
    realDb
  );

  assert(realCleanResult.committed === true, 'Real IndexedDB: Clean execution committed === true');
  const realCleanStatus = await checkFinalAllocationSettlementStatus('idemp_real_dexie_clean', realDb);
  assert(realCleanStatus.status === 'COMMITTED', 'Real IndexedDB: Status accurately reports COMMITTED after recovery');

  const realInvFinal = await realDb.investors.get(realInvId);
  const realBankFinal = await realDb.cashBankAccounts.get(realBankId);
  assert(realInvFinal?.currentCapital === 600, `Real IndexedDB: Capital cleanly increased to ৳600 (500 + 100 reinvest) (got ${realInvFinal?.currentCapital})`);
  assert(realBankFinal?.currentBalance === 79900, `Real IndexedDB: Bank balance cleanly decreased to ৳79900 (80000 - 100 withdraw) (got ${realBankFinal?.currentBalance})`);

  await realDb.close();

  console.log('\n================================================================');
  console.log('PROMPT 34 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testPrompt34CrashSafeFinalization.ts')) {
  runPrompt34CrashSafeFinalizationTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 34 tests failed: ${res.failed} failure(s)`);
        process.exit(1);
      } else {
        console.log('Prompt 34 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 34 tests:', err);
      process.exit(1);
    });
}
