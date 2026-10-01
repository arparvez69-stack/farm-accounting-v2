import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  createAdmissionRequest,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
  approveAdmissionRequest,
  recordAdmissionCapitalReceipt,
  executeAdmissionFinalization,
  clearAdmissionRequestsForTest
} from '../services/admissionService';
import {
  executeParticipantProfitSettlement,
  executeFinalAllocationAndSettlement,
  checkFinalAllocationSettlementStatus
} from '../services/settlementService';
import {
  createValuationEvent,
  finalizeValuationEvent,
  getAllValuationEvents,
  clearValuationEventsForTest
} from '../services/valuationService';
import {
  recordCapitalMovement,
  getInvestorCapitalMovements
} from '../services/capitalMovementService';
import {
  postJournalEntry,
  generateProfitLoss,
  generateTrialBalance
} from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { ExecuteProfitSettlementParams, InvestorAdmissionRequest } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST G — Duplicate / Crash / Retry Test
 *
 * Requirements:
 * Test the most dangerous operational failures:
 * 1. double-click;
 * 2. browser refresh;
 * 3. network retry;
 * 4. offline retry;
 * 5. interrupted transaction;
 * 6. repeated sync;
 * 7. repeated admission request;
 * 8. repeated reinvestment.
 *
 * No scenario may create duplicate:
 * - capital;
 * - profit;
 * - payable;
 * - journal entry;
 * - valuation;
 * - admission;
 * - settlement.
 *
 * Return PASS.
 */
export async function runFinalTestGDuplicateCrashRetry(): Promise<AssertionResult> {
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
  console.log('FINAL TEST G — DUPLICATE / CRASH / RETRY TEST');
  console.log('Testing the most dangerous operational failures:');
  console.log('  1. double-click');
  console.log('  2. browser refresh');
  console.log('  3. network retry');
  console.log('  4. offline retry');
  console.log('  5. interrupted transaction');
  console.log('  6. repeated sync');
  console.log('  7. repeated admission request');
  console.log('  8. repeated reinvestment');
  console.log('Invariants: ZERO duplicate capital, profit, payable, journal entry,');
  console.log('valuation, admission, or settlement across all failure scenarios.');
  console.log('================================================================\n');

  // Helper to initialize fresh isolated database
  async function initFreshDb() {
    clearAdmissionRequestsForTest();
    clearValuationEventsForTest();
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put({ ...acc });
    }
    return db;
  }

  // ===========================================================================
  // SCENARIO 1: DOUBLE-CLICK TEST (CONCURRENT RACE CONDITIONS)
  // Rapid double-clicks on:
  // - profit settlement submission (reinvestment + withdrawal)
  // - admission request submission
  // - valuation creation
  // ===========================================================================
  console.log('--- SCENARIO 1: Double-Click Failure Test ---');
  {
    const db = await initFreshDb();

    // Seed bank account (৳100,000)
    await db.cashBankAccounts.put({
      id: 'bank_g1',
      accountType: 'BANK',
      name: 'Agrani Bank',
      currentBalance: 100000,
      isActive: true,
      synced: false
    });

    // Seed investor: Capital ৳500, Profit Payable ৳200
    await db.investors.put({
      id: 'inv_g1',
      name: 'Tarequl Hasan',
      capitalAmount: 500,
      capitalContributed: 500,
      currentCapitalBalance: 500,
      profitSharingRatio: 25,
      profitPayable: 200,
      totalProfitAllocated: 200,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const settleKey = 'idemp_double_click_settle_g1';
    const settlementPayload: ExecuteProfitSettlementParams = {
      investorId: 'inv_g1',
      profit: 200,
      reinvestAmount: 100, // 50% reinvested into capital
      withdrawAmount: 100, // 50% withdrawn to bank
      bankAccountId: 'bank_g1',
      date: '2026-06-30',
      currentUserId: 'user_g1',
      idempotencyKey: settleKey
    };

    // Simulate concurrent double-click via Promise.allSettled
    const [resA, resB] = await Promise.allSettled([
      executeParticipantProfitSettlement(settlementPayload, db),
      executeParticipantProfitSettlement(settlementPayload, db)
    ]);

    assert(resA.status === 'fulfilled' && resB.status === 'fulfilled', 'Both concurrent double-click requests resolved gracefully');

    // Verify exactly ONE settlement occurred:
    const allTranches = await db.investmentTranches.toArray();
    const g1Tranches = allTranches.filter((t: any) => t.investorId === 'inv_g1');
    assert(g1Tranches.length === 1, `Zero duplicate capital: Exactly 1 reinvestment tranche created (found ${g1Tranches.length})`);
    assert(g1Tranches[0].investmentAmount === 100, `Reinvestment tranche amount is exactly ৳100 (got ${g1Tranches[0]?.investmentAmount})`);

    const allMovements = await db.investorCapitalMovements.toArray();
    const g1Movements = allMovements.filter((m: any) => m.investorId === 'inv_g1');
    assert(g1Movements.length === 1, `Zero duplicate capital movements: Exactly 1 movement created (found ${g1Movements.length})`);

    const allJournals = await db.journalEntries.toArray();
    const withdrawJournals = allJournals.filter((j: any) =>
      j.lines?.some((l: any) => l.accountCode === CANONICAL_ACCOUNTS.BANK && (Number(l.credit) || 0) === 100)
    );
    assert(withdrawJournals.length === 1, `Zero duplicate journal entry: Exactly 1 bank withdrawal journal posted (found ${withdrawJournals.length})`);

    const bankAcc = await db.cashBankAccounts.get('bank_g1');
    assert(bankAcc?.currentBalance === 99900, `Zero duplicate payable/cash deduction: Bank deducted exactly ৳100 (got ৳${bankAcc?.currentBalance})`);

    const invAfter = await db.investors.get('inv_g1');
    assert(invAfter?.currentCapitalBalance === 600, `Capital increased exactly once from 500 to 600 (got ${invAfter?.currentCapitalBalance})`);
    assert(invAfter?.profitPayable === 0, `Profit payable reduced exactly once from 200 to 0 (got ${invAfter?.profitPayable})`);

    // Concurrent double-click on createAdmissionRequest
    const admDoubleKey = 'idemp_double_click_adm_g1';
    const [admResA, admResB] = await Promise.allSettled([
      createAdmissionRequest(
        {
          investorName: 'Kamal Hossain',
          proposedContribution: 300,
          proposedProfitSharingRatio: 15,
          requestDate: '2026-07-01',
          currentUserId: 'user_g1',
          idempotencyKey: admDoubleKey
        },
        db
      ),
      createAdmissionRequest(
        {
          investorName: 'Kamal Hossain',
          proposedContribution: 300,
          proposedProfitSharingRatio: 15,
          requestDate: '2026-07-01',
          currentUserId: 'user_g1',
          idempotencyKey: admDoubleKey
        },
        db
      )
    ]);

    assert(admResA.status === 'fulfilled' && admResB.status === 'fulfilled', 'Both concurrent admission request double-clicks resolved');
    const reqA = (admResA as PromiseFulfilledResult<InvestorAdmissionRequest>).value;
    const reqB = (admResB as PromiseFulfilledResult<InvestorAdmissionRequest>).value;
    assert(reqA.id === reqB.id, `Zero duplicate admission: Both double-click requests returned the identical request ID (${reqA.id})`);

    const allAdmissionReqs = await db.investorAdmissionRequests.toArray();
    assert(allAdmissionReqs.length === 1, `Database contains exactly 1 admission request (found ${allAdmissionReqs.length})`);
  }

  // ===========================================================================
  // SCENARIO 2: BROWSER REFRESH TEST
  // User submits a form, page reloads / refreshes, and submits again.
  // ===========================================================================
  console.log('\n--- SCENARIO 2: Browser Refresh Test ---');
  {
    const db = await initFreshDb();

    await db.cashBankAccounts.put({
      id: 'bank_g2',
      accountType: 'BANK',
      name: 'Sonali Bank',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });

    await db.investors.put({
      id: 'inv_g2',
      name: 'Nusrat Jahan',
      capitalAmount: 1000,
      currentCapitalBalance: 1000,
      profitSharingRatio: 30,
      profitPayable: 300,
      totalProfitAllocated: 300,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const refreshKey = 'idemp_browser_refresh_g2';
    const payload: ExecuteProfitSettlementParams = {
      investorId: 'inv_g2',
      profit: 300,
      reinvestAmount: 150,
      withdrawAmount: 150,
      bankAccountId: 'bank_g2',
      date: '2026-07-15',
      currentUserId: 'user_g2',
      idempotencyKey: refreshKey
    };

    // Initial submission before refresh
    const firstAttempt = await executeParticipantProfitSettlement(payload, db);
    assert(firstAttempt.passed === true, 'Initial submission before browser refresh succeeded');

    // Browser refresh occurs: state reloads, exact payload re-submitted
    const refreshAttempt = await executeParticipantProfitSettlement(payload, db);
    assert(refreshAttempt.isDuplicate === true, 'Browser refresh re-submission detected as duplicate');
    assert(refreshAttempt.idempotentReplay === true, 'Returned idempotent replay of existing settlement');

    const journals = await db.journalEntries.toArray();
    const matchingJournals = journals.filter((j: any) =>
      j.reference?.includes(refreshKey) || j.idempotencyKey?.includes(refreshKey)
    );
    assert(matchingJournals.length <= 2, `Zero duplicate journal entry on browser refresh (found ${matchingJournals.length} journals)`);

    const inv = await db.investors.get('inv_g2');
    assert(inv?.currentCapitalBalance === 1150, `Zero duplicate capital on browser refresh: Capital is ৳1150 (got ৳${inv?.currentCapitalBalance})`);
    assert(inv?.profitPayable === 0, `Zero duplicate payable on browser refresh: Payable is ৳0 (got ৳${inv?.profitPayable})`);

    const bank = await db.cashBankAccounts.get('bank_g2');
    assert(bank?.currentBalance === 49850, `Zero duplicate bank withdrawal on browser refresh: Balance is ৳49,850 (got ৳${bank?.currentBalance})`);
  }

  // ===========================================================================
  // SCENARIO 3: NETWORK RETRY TEST
  // Request succeeds on server/database, but HTTP response dropped -> client retries
  // ===========================================================================
  console.log('\n--- SCENARIO 3: Network Retry Test ---');
  {
    const db = await initFreshDb();

    // Create valuation event with network idempotency key
    const valKey = 'idemp_net_retry_val_g3';
    const val1 = await createValuationEvent(
      {
        valuationDate: '2026-05-31',
        responsibleUser: 'auditor_g3',
        totalBusinessAssetsIncluded: 800,
        relevantLiabilities: 100,
        idempotencyKey: valKey,
        notes: 'Pre-admission NAV Valuation'
      },
      db
    );

    // Network dropped ack; client retries with exact same key
    const val2 = await createValuationEvent(
      {
        valuationDate: '2026-05-31',
        responsibleUser: 'auditor_g3',
        totalBusinessAssetsIncluded: 800,
        relevantLiabilities: 100,
        idempotencyKey: valKey,
        notes: 'Pre-admission NAV Valuation'
      },
      db
    );

    assert(val1.id === val2.id, `Zero duplicate valuation: Network retry returned existing valuation ID (${val1.id})`);
    assert(val2.resultingNetBusinessValue === 700, `Resulting net business value = ৳700 (got ৳${val2.resultingNetBusinessValue})`);

    const allVals = await getAllValuationEvents(db);
    assert(allVals.length <= 1, `Zero duplicate valuation records in database on network retry (found ${allVals.length})`);
  }

  // ===========================================================================
  // SCENARIO 4: OFFLINE RETRY TEST
  // Transactions queued offline with synced: false; reconnected and synced multiple times
  // ===========================================================================
  console.log('\n--- SCENARIO 4: Offline Retry Test ---');
  {
    const db = await initFreshDb();

    // Record capital movement offline
    const movKey = 'idemp_offline_retry_mov_g4';
    const mov1 = await recordCapitalMovement(
      {
        investorId: 'inv_g4',
        investorName: 'Salma Khatun',
        movementType: 'INITIAL_CONTRIBUTION',
        amount: 250,
        direction: 'INFLOW',
        date: '2026-06-01',
        journalEntryId: 'j_g4_initial',
        voucherNumber: 'TR-G4-001',
        currentUserId: 'user_g4',
        idempotencyKey: movKey
      },
      db
    );

    // Simulate offline sync retry worker attempting to re-record
    const mov2 = await recordCapitalMovement(
      {
        investorId: 'inv_g4',
        investorName: 'Salma Khatun',
        movementType: 'INITIAL_CONTRIBUTION',
        amount: 250,
        direction: 'INFLOW',
        date: '2026-06-01',
        journalEntryId: 'j_g4_initial',
        voucherNumber: 'TR-G4-001',
        currentUserId: 'user_g4',
        idempotencyKey: movKey
      },
      db
    );

    assert(mov1.id === mov2.id, `Zero duplicate capital movement on offline retry: IDs match (${mov1.id})`);
    const allMovs = await db.investorCapitalMovements.toArray();
    assert(allMovs.length === 1, `Database contains exactly 1 capital movement (found ${allMovs.length})`);
  }

  // ===========================================================================
  // SCENARIO 5: INTERRUPTED TRANSACTION TEST (CRASH HALFWAY THROUGH)
  // Multi-step transaction crashes between stages; rolls back cleanly; retry commits
  // ===========================================================================
  console.log('\n--- SCENARIO 5: Interrupted Transaction Test ---');
  {
    const db = await initFreshDb();

    await db.cashBankAccounts.put({
      id: 'bank_g5',
      accountType: 'BANK',
      name: 'Dutch Bangla Bank',
      currentBalance: 75000,
      isActive: true,
      synced: false
    });

    await db.investors.put({
      id: 'inv_g5',
      name: 'Habibur Rahman',
      capitalAmount: 400,
      currentCapitalBalance: 400,
      profitSharingRatio: 20,
      profitPayable: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const crashKey = 'idemp_interrupted_tx_g5';
    const crashPayload = {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-06-30',
      totalDistributableProfit: 300,
      investorId: 'inv_g5',
      investorName: 'Habibur Rahman',
      investorSharePercentage: 50,
      mudaribPersonId: 'mudarib_g5',
      mudaribName: 'Farm Operator',
      mudaribSharePercentage: 50,
      reinvestPercentage: 50,
      bankAccountId: 'bank_g5',
      currentUserId: 'auditor_g5',
      idempotencyKey: crashKey
    };

    // Step A: Simulate interruption during transaction execution (Checkpoint 1)
    let crashed = false;
    try {
      await executeFinalAllocationAndSettlement(
        {
          ...crashPayload,
          simulateInterruptionAt: 'AFTER_ALLOCATION'
        },
        db
      );
    } catch (err: any) {
      crashed = true;
      assert(
        err.message.includes('CRASH_SIMULATION') || err.message.includes('interrupted') || err.message.includes('SIMULATED_INTERRUPTION'),
        'Transaction crash successfully triggered at Checkpoint 1'
      );
    }
    assert(crashed === true, 'Process stopped halfway through');

    // Verify recovery status: ZERO partial accounting left in database
    const statusAfterCrash = await checkFinalAllocationSettlementStatus(crashKey, db);
    assert(statusAfterCrash.committed === false, 'Safe determination: Operation correctly identified as NOT_COMMITTED after crash');
    assert(statusAfterCrash.allocationCommitted === false, 'Zero partial accounting: Allocation journal rolled back');
    assert(statusAfterCrash.settlementCommitted === false, 'Zero partial accounting: Settlement journal rolled back');
    assert(statusAfterCrash.reinvestmentCommitted === false, 'Zero partial accounting: Reinvestment tranche rolled back');

    const journalsAfterCrash = await db.journalEntries.toArray();
    assert(journalsAfterCrash.length === 0, `Zero orphan journal entries left behind after crash (found ${journalsAfterCrash.length})`);

    // Step B: Retry after recovery without interruption
    const recoveryResult = await executeFinalAllocationAndSettlement(crashPayload, db);
    assert(recoveryResult.passed === true, 'Retry after recovery succeeded cleanly');
    assert(recoveryResult.committed === true, 'Operation committed successfully on retry');
    assert(recoveryResult.duplicateProfitCreated === false, 'Zero duplicate profit created on recovery');
    assert(recoveryResult.duplicateCapitalCreated === false, 'Zero duplicate capital created on recovery');

    // Step C: Second retry after committed -> returns idempotent replay
    const secondRecoveryResult = await executeFinalAllocationAndSettlement(crashPayload, db);
    assert(secondRecoveryResult.isDuplicate === true, 'Second retry after commit identified as duplicate');
    assert(secondRecoveryResult.idempotentReplay === true, 'Returned idempotent replay');
    assert(secondRecoveryResult.reinvestedCapital === recoveryResult.reinvestedCapital, 'Reinvested capital matches exact first commit');
  }

  // ===========================================================================
  // SCENARIO 6: REPEATED SYNC TEST
  // Sync executed repeatedly back-to-back (3 consecutive runs)
  // ===========================================================================
  console.log('\n--- SCENARIO 6: Repeated Sync Test ---');
  {
    const db = await initFreshDb();

    // Create journal entry with explicit idempotency key
    const syncJournalKey = 'idemp_sync_repeat_j_g6';
    const journal1 = await postJournalEntry(
      {
        id: 'j_sync_g6_1',
        voucherNumber: 'V-SYNC-001',
        voucherType: 'RECEIPT',
        date: '2026-08-01',
        narration: 'Initial operating capital deposit',
        reference: syncJournalKey,
        lines: [
          {
            accountCode: CANONICAL_ACCOUNTS.CASH,
            accountName: 'নগদ তহবিল',
            debit: 5000,
            credit: 0
          },
          {
            accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
            accountName: 'মালিকের মূলধন',
            debit: 0,
            credit: 5000
          }
        ],
        createdBy: 'user_g6',
        createdAt: new Date().toISOString()
      },
      { dbInstance: db }
    );

    // Repeated posting with same ID / idempotency key (simulating repeated sync write)
    const journal2 = await postJournalEntry(
      {
        id: 'j_sync_g6_1',
        voucherNumber: 'V-SYNC-001',
        voucherType: 'RECEIPT',
        date: '2026-08-01',
        narration: 'Initial operating capital deposit',
        reference: syncJournalKey,
        lines: [
          {
            accountCode: CANONICAL_ACCOUNTS.CASH,
            accountName: 'নগদ তহবিল',
            debit: 5000,
            credit: 0
          },
          {
            accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
            accountName: 'মালিকের মূলধন',
            debit: 0,
            credit: 5000
          }
        ],
        createdBy: 'user_g6',
        createdAt: new Date().toISOString()
      },
      { dbInstance: db }
    );

    // Third repeated attempt
    const journal3 = await postJournalEntry(
      {
        id: 'j_sync_g6_1',
        voucherNumber: 'V-SYNC-001',
        voucherType: 'RECEIPT',
        date: '2026-08-01',
        narration: 'Initial operating capital deposit',
        reference: syncJournalKey,
        lines: [
          {
            accountCode: CANONICAL_ACCOUNTS.CASH,
            accountName: 'নগদ তহবিল',
            debit: 5000,
            credit: 0
          },
          {
            accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
            accountName: 'মালিকের মূলধন',
            debit: 0,
            credit: 5000
          }
        ],
        createdBy: 'user_g6',
        createdAt: new Date().toISOString()
      },
      { dbInstance: db }
    );

    assert(journal1.id === journal2.id && journal2.id === journal3.id, 'All 3 repeated sync attempts returned identical journal ID');

    const totalJournals = await db.journalEntries.toArray();
    assert(totalJournals.length === 1, `Zero duplicate journal entry on repeated sync: Exactly 1 record in GL (found ${totalJournals.length})`);

    const tb = await generateTrialBalance({ endDate: '2026-12-31' }, db);
    assert(tb.isBalanced === true, 'Trial balance remains balanced');
    assert(tb.totalDebit === 5000 && tb.totalCredit === 5000, `Trial balance debit & credit are exactly ৳5,000 (got ৳${tb.totalDebit})`);
  }

  // ===========================================================================
  // SCENARIO 7: REPEATED ADMISSION REQUEST & FINALIZATION TEST
  // Full 7-stage admission pipeline executed; finalized admission called repeatedly
  // ===========================================================================
  console.log('\n--- SCENARIO 7: Repeated Admission Request & Finalization Test ---');
  {
    const db = await initFreshDb();

    await db.cashBankAccounts.put({
      id: 'bank_g7',
      accountType: 'BANK',
      name: 'Islami Bank',
      currentBalance: 200000,
      isActive: true,
      synced: false
    });

    const admKey = 'idemp_repeated_admission_g7';

    // Step 1: Create admission request twice (repeated submission)
    const req1 = await createAdmissionRequest(
      {
        investorName: 'Dr. Mofizul Islam',
        proposedContribution: 500,
        proposedProfitSharingRatio: 20,
        requestDate: '2026-05-01',
        currentUserId: 'admin_g7',
        idempotencyKey: admKey
      },
      db
    );

    const req2 = await createAdmissionRequest(
      {
        investorName: 'Dr. Mofizul Islam',
        proposedContribution: 500,
        proposedProfitSharingRatio: 20,
        requestDate: '2026-05-01',
        currentUserId: 'admin_g7',
        idempotencyKey: admKey
      },
      db
    );

    assert(req1.id === req2.id, `Repeated admission request deduplicated: Returned identical ID (${req1.id})`);

    // Candidate investors check: exactly 1 candidate investor created
    const candInvestors = await db.investors.toArray();
    assert(candInvestors.length === 1, `Zero duplicate candidate investors: Exactly 1 created (found ${candInvestors.length})`);
    assert(candInvestors[0].capitalAmount === 0, 'Candidate investor has strictly ৳0 active capital');

    // Run pipeline through reconciliation, valuation, approval, capital receipt
    await executeAdmissionReconciliation(req1.id, { responsibleUser: 'auditor_g7', reconciliationDate: '2026-05-15', bypassReconciliationForTest: true }, db);

    const valEvent = await createValuationEvent(
      {
        valuationDate: '2026-05-31',
        responsibleUser: 'auditor_g7',
        totalBusinessAssetsIncluded: 2500,
        relevantLiabilities: 500, // Pre-money NAV = 2000
        admissionReference: req1.requestNumber,
        finalize: true,
        bypassReconciliationForTest: true
      },
      db
    );

    await executeAdmissionValuation(
      req1.id,
      {
        responsibleUser: 'auditor_g7',
        valuationEventId: valEvent.id,
        overridePreMoney: 2000,
        finalizeValuation: true,
        bypassReconciliationForTest: true
      },
      db
    );

    await approveAdmissionRequest(req1.id, { approvedBy: 'owner_g7' }, db);

    // Record capital receipt twice (repeated submission)
    const capKey = 'idemp_cap_receipt_g7';
    await recordAdmissionCapitalReceipt(
      req1.id,
      {
        receivedAmount: 500,
        targetAccountId: 'bank_g7',
        receiptDate: '2026-06-01',
        currentUserId: 'admin_g7',
        idempotencyKey: capKey
      },
      db
    );

    await recordAdmissionCapitalReceipt(
      req1.id,
      {
        receivedAmount: 500,
        targetAccountId: 'bank_g7',
        receiptDate: '2026-06-01',
        currentUserId: 'admin_g7',
        idempotencyKey: capKey
      },
      db
    );

    // Finalize admission twice (repeated finalization)
    const finalAdm1 = await executeAdmissionFinalization(
      req1.id,
      {
        admissionDate: '2026-06-01',
        currentUserId: 'admin_g7',
        contractualProfitSharePercentage: 20
      },
      db
    );

    const finalAdm2 = await executeAdmissionFinalization(
      req1.id,
      {
        admissionDate: '2026-06-01',
        currentUserId: 'admin_g7',
        contractualProfitSharePercentage: 20
      },
      db
    );

    assert(finalAdm1.tranche.id === finalAdm2.tranche.id, 'Repeated finalization returned identical tranche ID');
    assert(finalAdm1.investor.id === finalAdm2.investor.id, 'Repeated finalization returned identical investor ID');

    // Invariant verifications:
    const finalTranches = await db.investmentTranches.toArray();
    assert(finalTranches.length === 1, `Zero duplicate capital: Exactly 1 investment tranche exists in total (found ${finalTranches.length})`);
    assert(finalTranches[0].investmentAmount === 500, `Tranche capital is exactly ৳500 (got ৳${finalTranches[0].investmentAmount})`);

    const finalMovements = await db.investorCapitalMovements.toArray();
    assert(finalMovements.length === 1, `Zero duplicate capital movements: Exactly 1 movement exists (found ${finalMovements.length})`);

    const finalInvestors = await db.investors.toArray();
    assert(finalInvestors.length === 1, `Zero duplicate investors: Exactly 1 investor exists (found ${finalInvestors.length})`);
    assert(finalInvestors[0].currentCapitalBalance === 500, `Investor capital is exactly ৳500 (got ৳${finalInvestors[0].currentCapitalBalance})`);
  }

  // ===========================================================================
  // SCENARIO 8: REPEATED REINVESTMENT TEST
  // Reinvestment of profit executed repeatedly; must never duplicate capital or profit
  // ===========================================================================
  console.log('\n--- SCENARIO 8: Repeated Reinvestment Test ---');
  {
    const db = await initFreshDb();

    await db.cashBankAccounts.put({
      id: 'bank_g8',
      accountType: 'BANK',
      name: 'Bank Asia',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });

    await db.investors.put({
      id: 'inv_g8',
      name: 'Farhana Yasmin',
      capitalAmount: 1000,
      currentCapitalBalance: 1000,
      profitSharingRatio: 30,
      profitPayable: 400,
      totalProfitAllocated: 400,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const reinvKey = 'idemp_repeated_reinvest_g8';
    const reinvPayload: ExecuteProfitSettlementParams = {
      investorId: 'inv_g8',
      profit: 400,
      reinvestAmount: 400, // 100% reinvestment into capital
      withdrawAmount: 0,
      date: '2026-08-31',
      currentUserId: 'officer_g8',
      idempotencyKey: reinvKey
    };

    // First reinvestment execution
    const reinvResult1 = await executeParticipantProfitSettlement(reinvPayload, db);
    assert(reinvResult1.passed === true, 'First 100% profit reinvestment executed successfully');
    assert(reinvResult1.reinvestedCapital === 400, 'Reinvested capital = ৳400');
    assert(reinvResult1.futureCapitalPosition === 1400, 'Future capital position = ৳1,400');

    // Second repeated reinvestment execution with same parameters
    const reinvResult2 = await executeParticipantProfitSettlement(reinvPayload, db);
    assert(reinvResult2.isDuplicate === true, 'Second reinvestment execution identified as duplicate');
    assert(reinvResult2.idempotentReplay === true, 'Returned idempotent replay of existing reinvestment');
    assert(reinvResult2.futureCapitalPosition === 1400, 'Capital remains strictly ৳1,400 (not ৳1,800)');

    // Invariant verifications:
    const invG8 = await db.investors.get('inv_g8');
    assert(invG8?.currentCapitalBalance === 1400, `Zero duplicate capital: Final investor capital = ৳1,400 (got ৳${invG8?.currentCapitalBalance})`);
    assert(invG8?.profitPayable === 0, `Zero duplicate payable: Profit payable = ৳0 (got ৳${invG8?.profitPayable})`);

    const g8Tranches = await db.investmentTranches.toArray();
    assert(g8Tranches.length === 1, `Zero duplicate capital: Exactly 1 reinvestment tranche created (found ${g8Tranches.length})`);
    assert(g8Tranches[0].investmentAmount === 400, `Tranche amount is strictly ৳400 (got ৳${g8Tranches[0].investmentAmount})`);

    const g8Movements = await db.investorCapitalMovements.toArray();
    assert(g8Movements.length === 1, `Zero duplicate movements: Exactly 1 capital movement exists (found ${g8Movements.length})`);

    const g8Journals = await db.journalEntries.toArray();
    assert(g8Journals.length === 1, `Zero duplicate journal entry: Exactly 1 GL reinvestment journal exists (found ${g8Journals.length})`);

    // Verify P&L is 100% unaffected by reinvestment (zero revenue, zero expense)
    const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-12-31' }, undefined, db);
    assert(pnl.netProfit === 0, `Zero phantom profit/revenue created from reinvestment: Net profit = ৳0 (got ৳${pnl.netProfit})`);
  }

  // ===========================================================================
  // SUMMARY OF FINAL TEST G
  // ===========================================================================
  console.log('\n================================================================');
  console.log(`FINAL TEST G COMPLETE: ${result.passed}/${result.total} Assertions Passed`);
  if (result.failed === 0) {
    console.log('STATUS: PASS');
    console.log('Zero duplicate capital, profit, payable, journal entry,');
    console.log('valuation, admission, or settlement verified across all 8 failure modes.');
  } else {
    console.error(`STATUS: FAIL (${result.failed} failures)`);
  }
  console.log('================================================================\n');

  return result;
}
