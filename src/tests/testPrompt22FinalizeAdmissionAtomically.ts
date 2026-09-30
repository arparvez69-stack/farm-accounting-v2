import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  createAdmissionRequest,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
  finalizeAdmissionValuation,
  executeAdmissionReview,
  executeAdmissionApproval,
  executeAdmissionCapitalReceipt,
  executeAdmissionFinalization,
  clearAdmissionRequestsForTest,
  getAdmissionRequestById,
  inspectFinalAdmissionCommit
} from '../services/admissionService';
import { clearValuationEventsForTest } from '../services/transactionService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 22 — Finalize Admission Atomically
 *
 * Requirements:
 * Inspect the final admission commit.
 * Final admission may update multiple records.
 * The operation must be atomic.
 *
 * It must not be possible to create:
 * - capital receipt without participant admission;
 * - admission without capital receipt when capital is required;
 * - economic units without the underlying event;
 * - partial profit eligibility.
 *
 * Use the existing transaction mechanism.
 * Simulate a failure during the operation.
 * Verify no half-completed admission remains.
 * Return PASS.
 */
export async function runPrompt22FinalizeAdmissionAtomicallyTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 22: FINALIZE ADMISSION ATOMICALLY');
  console.log('Testing: Atomic Multi-Record Commit, Rollback, & Invariant Enforcement');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // Setup Accounts and Bank Account
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_main_p22';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Agrani Bank Farm Operating A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt22';

  // Helper to run pipeline through approval and capital receipt
  async function setupReadyAdmission(name: string, capital: number, ratio: number) {
    const req = await createAdmissionRequest(
      {
        investorName: name,
        proposedContribution: capital,
        proposedProfitSharingRatio: ratio,
        requestDate: '2026-07-01',
        currentUserId: testUserId
      },
      mDb
    );

    await executeAdmissionReconciliation(
      req.id,
      { responsibleUser: testUserId, notes: 'Reconciliation pass' },
      mDb
    );

    const valRes = await executeAdmissionValuation(
      req.id,
      {
        overridePreMoney: 3000,
        valuationDate: '2026-07-03',
        responsibleUser: testUserId,
        valuationMethodology: 'NET_ASSET_VALUE'
      },
      mDb
    );

    await finalizeAdmissionValuation(
      req.id,
      {
        valuationEventId: valRes.valuation?.valuationEventId || 'val_p22_event',
        finalizedBy: testUserId
      },
      mDb
    );

    await executeAdmissionReview(
      req.id,
      {
        reviewedBy: 'Partner Reviewer',
        approvedRecommendation: true,
        reviewNotes: 'Verified'
      },
      mDb
    );

    await executeAdmissionApproval(
      req.id,
      {
        approvedBy: 'Managing Partner',
        decision: 'APPROVE',
        notes: 'Approved for capital receipt'
      },
      mDb
    );

    return req;
  }

  // ===========================================================================
  // TEST 1: Invariant — Capital receipt WITHOUT participant admission
  // (Paying capital must NOT grant active admission or economic units)
  // ===========================================================================
  console.log('\n--- Test 1: Capital receipt without participant admission ---');

  const req1 = await setupReadyAdmission('Investor Alpha', 1000, 25);

  const receipt1 = await executeAdmissionCapitalReceipt(
    req1.id,
    {
      receivedAmount: 1000,
      targetAccountId: bankAccId,
      receiptDate: '2026-07-05',
      currentUserId: testUserId,
      idempotencyKey: 'IDEMP-P22-T1'
    },
    mDb
  );

  assert(receipt1.stage === 'CAPITAL_RECEIPT', 'Request stage is CAPITAL_RECEIPT');
  assert(receipt1.status === 'CAPITAL_RECEIVED', 'Request status is CAPITAL_RECEIVED');
  assert(receipt1.isAdmitted === false, 'Participant is NOT admitted merely by paying capital');
  assert(receipt1.economicParticipationActive === false, 'Economic participation is NOT active after capital receipt');

  // Verify inspectFinalAdmissionCommit confirms no capital receipt without admission
  const inspection1 = await inspectFinalAdmissionCommit({ requestId: req1.id }, mDb);
  assert(inspection1.noCapitalReceiptWithoutAdmission === true, 'Inspection verifies no capital receipt without admission');
  assert(inspection1.isAdmitted === false, 'Inspection confirms candidate is not yet admitted');

  // Verify no active investment tranche exists yet
  const tranches1 = await mDb.investmentTranches.toArray();
  const candidateTranche1 = tranches1.find((t: any) => t.investorName === 'Investor Alpha');
  assert(candidateTranche1 === undefined, 'No economic unit (Tranche) exists prior to final admission commit');

  // ===========================================================================
  // TEST 2: Invariant — Admission WITHOUT capital receipt when capital is required
  // (Must be strictly blocked with an error)
  // ===========================================================================
  console.log('\n--- Test 2: Admission without capital receipt when capital required is blocked ---');

  const req2 = await setupReadyAdmission('Investor Beta', 1000, 20);
  // req2 is in stage APPROVAL, capital has NOT been deposited!

  let blockedWithoutCap = false;
  try {
    await executeAdmissionFinalization(
      req2.id,
      { admissionDate: '2026-07-05', currentUserId: testUserId },
      mDb
    );
  } catch (err: any) {
    blockedWithoutCap = true;
    assert(
      err.message.includes('মূলধন গ্রহণ ব্যতীত') || err.message.includes('capital receipt'),
      `Correct error message on admission attempt without capital: "${err.message}"`
    );
  }
  assert(blockedWithoutCap === true, 'Admission without capital receipt when capital required was strictly blocked');

  const postReq2 = await getAdmissionRequestById(req2.id, mDb);
  assert(postReq2?.stage === 'APPROVAL', 'Stage remains APPROVAL; not advanced to ADMISSION');
  assert(postReq2?.isAdmitted === false, 'Candidate is not admitted');

  // ===========================================================================
  // TEST 3: Invariant — Economic units without underlying event
  // (Tranche cannot exist without underlying valuation event)
  // ===========================================================================
  console.log('\n--- Test 3: Economic units without underlying event is blocked ---');

  const req3 = await setupReadyAdmission('Investor Gamma', 500, 15);
  await executeAdmissionCapitalReceipt(
    req3.id,
    {
      receivedAmount: 500,
      targetAccountId: bankAccId,
      receiptDate: '2026-07-05',
      currentUserId: testUserId,
      idempotencyKey: 'IDEMP-P22-T3'
    },
    mDb
  );

  // Strip valuation reference from request to test defense
  const req3Corrupt = await getAdmissionRequestById(req3.id, mDb);
  if (req3Corrupt && req3Corrupt.valuation) {
    delete (req3Corrupt.valuation as any).valuationEventId;
    delete (req3Corrupt.valuation as any).valuationReference;
  }

  let blockedWithoutEvent = false;
  try {
    await executeAdmissionFinalization(
      req3.id,
      { admissionDate: '2026-07-05', currentUserId: testUserId },
      mDb
    );
  } catch (err: any) {
    blockedWithoutEvent = true;
    assert(
      err.message.includes('অর্থনৈতিক ইউনিট') || err.message.includes('economic units'),
      `Correct error blocking economic unit creation without event: "${err.message}"`
    );
  }
  assert(blockedWithoutEvent === true, 'Creation of economic units without underlying event was strictly blocked');

  // ===========================================================================
  // TEST 4: Atomic Commit Failure Simulation & Complete Rollback
  // (Simulate failure during operation -> verify no half-completed admission remains)
  // ===========================================================================
  console.log('\n--- Test 4: Simulate Failure During Commit -> Verify No Half-Completed Admission ---');

  const req4 = await setupReadyAdmission('Investor Delta', 1000, 25);
  await executeAdmissionCapitalReceipt(
    req4.id,
    {
      receivedAmount: 1000,
      targetAccountId: bankAccId,
      receiptDate: '2026-07-05',
      currentUserId: testUserId,
      idempotencyKey: 'IDEMP-P22-T4'
    },
    mDb
  );

  // Snapshot database counts before the attempted finalization
  const preInvCount = (await mDb.investors.toArray()).length;
  const preTrancheCount = (await mDb.investmentTranches.toArray()).length;

  // Attempt finalization with simulated failure
  let failureCaught = false;
  try {
    await executeAdmissionFinalization(
      req4.id,
      {
        admissionDate: '2026-07-05',
        currentUserId: testUserId,
        contractualProfitSharePercentage: 25,
        simulateFailure: true // Triggers rollback inside the atomic transaction
      },
      mDb
    );
  } catch (err: any) {
    failureCaught = true;
    assert(
      err.message.includes('SIMULATED_TRANSACTION_FAILURE'),
      `Simulated failure properly caught: "${err.message}"`
    );
  }
  assert(failureCaught === true, 'Atomic transaction aborted upon simulated failure');

  // VERIFY NO HALF-COMPLETED ADMISSION REMAINS:
  // 1. In-memory and persisted request state must not be ADMITTED
  const rolledBackReq = await getAdmissionRequestById(req4.id, mDb);
  assert(rolledBackReq?.stage === 'CAPITAL_RECEIPT', 'Request stage was rolled back to CAPITAL_RECEIPT');
  assert(rolledBackReq?.status === 'CAPITAL_RECEIVED', 'Request status remained CAPITAL_RECEIVED');
  assert(rolledBackReq?.isAdmitted === false, 'Request isAdmitted remained strictly FALSE');
  assert(rolledBackReq?.economicParticipationActive === false, 'economicParticipationActive remained strictly FALSE');

  // 2. Candidate investor must NOT be left ACTIVE or admitted
  const allInvsAfterFail = await mDb.investors.toArray();
  const deltaInv = allInvsAfterFail.find((i: any) => i.name === 'Investor Delta');
  const deltaIsActive = deltaInv && deltaInv.status === 'ACTIVE' && deltaInv.isAdmitted === true;
  assert(!deltaIsActive, 'No active admitted investor record was left behind');

  // 3. No orphan tranche was left behind
  const allTranchesAfterFail = await mDb.investmentTranches.toArray();
  const deltaTranche = allTranchesAfterFail.find((t: any) => t.investorName === 'Investor Delta');
  assert(!deltaTranche, 'No active investment tranche was left behind');
  assert(allTranchesAfterFail.length === preTrancheCount, 'Tranche count unchanged after rollback');

  // 4. Invariant: Partial profit eligibility must NOT exist
  const partialProfitInv = allInvsAfterFail.find(
    (i: any) => i.name === 'Investor Delta' && (i.profitSharingRatio || 0) > 0 && (!i.isAdmitted || i.status !== 'ACTIVE')
  );
  assert(!partialProfitInv, 'Invariant: Zero partial profit eligibility exists after failure');

  // 5. Verification via inspectFinalAdmissionCommit
  const inspectionAfterFail = await inspectFinalAdmissionCommit({ requestId: req4.id }, mDb);
  assert(inspectionAfterFail.noHalfCompletedAdmission === true, 'Inspection confirms: no half-completed admission exists');
  assert(inspectionAfterFail.isAtomic === true, 'Inspection confirms: atomic safety invariant holds');
  assert(inspectionAfterFail.isAdmitted === false, 'Inspection confirms: participant is NOT admitted');

  // ===========================================================================
  // TEST 5: Clean Successful Atomic Commit
  // (All records commit together in full harmony)
  // ===========================================================================
  console.log('\n--- Test 5: Clean Successful Atomic Commit ---');

  // Now execute clean finalization WITHOUT simulated failure on the same request
  const finalized = await executeAdmissionFinalization(
    req4.id,
    {
      admissionDate: '2026-07-05',
      currentUserId: testUserId,
      contractualProfitSharePercentage: 25,
      notes: 'Clean atomic admission commit'
    },
    mDb
  );

  assert(finalized.request.stage === 'ADMISSION', 'Request stage is ADMISSION');
  assert(finalized.request.status === 'ADMITTED', 'Request status is ADMITTED');
  assert(finalized.request.isAdmitted === true, 'Request isAdmitted is TRUE');
  assert(finalized.request.economicParticipationActive === true, 'economicParticipationActive is TRUE');

  assert(finalized.investor.status === 'ACTIVE', 'Investor record is ACTIVE');
  assert(finalized.investor.isAdmitted === true, 'Investor isAdmitted is TRUE');
  assert(finalized.investor.economicParticipationActive === true, 'Investor economicParticipationActive is TRUE');
  assert(finalized.investor.profitSharingRatio === 25, 'Investor profit sharing ratio is exactly 25%');

  assert(finalized.tranche.status === 'ACTIVE', 'Tranche is ACTIVE');
  assert(finalized.tranche.investmentAmount === 1000, 'Tranche investmentAmount is ৳1,000');
  assert(finalized.tranche.contractualProfitSharePercentage === 25, 'Tranche profit share is 25%');
  assert(Boolean(finalized.tranche.valuationEventId), 'Tranche has valid valuationEventId');
  assert(Boolean(finalized.tranche.journalEntryId), 'Tranche has valid journalEntryId');

  assert(Boolean(finalized.admissionAudit), 'Formal InvestorAdmissionAudit created');
  assert(finalized.admissionAudit.preMoneyValuation === 3000, 'Audit record preMoneyValuation is ৳3,000');
  assert(finalized.admissionAudit.contributionAmount === 1000, 'Audit record contributionAmount is ৳1,000');
  assert(finalized.admissionAudit.postMoneyValuation === 4000, 'Audit record postMoneyValuation is ৳4,000');

  // 6. Verification via inspectFinalAdmissionCommit on committed admission
  const inspectionAfterSuccess = await inspectFinalAdmissionCommit({ requestId: req4.id }, mDb);
  assert(inspectionAfterSuccess.passed === true, 'inspectFinalAdmissionCommit returned passed: true');
  assert(inspectionAfterSuccess.isAtomic === true, 'inspectFinalAdmissionCommit confirms isAtomic: true');
  assert(inspectionAfterSuccess.noHalfCompletedAdmission === true, 'noHalfCompletedAdmission: true');
  assert(inspectionAfterSuccess.noCapitalReceiptWithoutAdmission === true, 'noCapitalReceiptWithoutAdmission: true');
  assert(inspectionAfterSuccess.noAdmissionWithoutCapitalReceipt === true, 'noAdmissionWithoutCapitalReceipt: true');
  assert(inspectionAfterSuccess.noEconomicUnitsWithoutEvent === true, 'noEconomicUnitsWithoutEvent: true');
  assert(inspectionAfterSuccess.noPartialProfitEligibility === true, 'noPartialProfitEligibility: true');
  assert(inspectionAfterSuccess.investorConsistent === true, 'investorConsistent: true');
  assert(inspectionAfterSuccess.trancheConsistent === true, 'trancheConsistent: true');
  assert(inspectionAfterSuccess.requestConsistent === true, 'requestConsistent: true');

  console.log('\n================================================================');
  console.log('PROMPT 22 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

if (import.meta.url.endsWith('testPrompt22FinalizeAdmissionAtomically.ts')) {
  runPrompt22FinalizeAdmissionAtomicallyTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Test execution failed:', err);
      process.exit(1);
    });
}
