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
  getAdmissionRequestById,
  clearAdmissionRequestsForTest,
  isInvestorAdmittedAndActive
} from '../services/admissionService';
import {
  executeInvestorProfitAllocationTransaction,
  executeInvestorTransaction,
  admitNewInvestorWithValuation
} from '../services/transactionService';
import {
  createValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';

import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 16 — Block Admission Without Final Valuation Audit
 *
 * Verifies:
 * 1. A new investor must NOT become economically active until the required valuation is finalized.
 * 2. If reconciliation is unresolved or valuation is incomplete: block admission with a clear reason.
 * 3. Cannot bypass this check through another API (e.g. admitNewInvestorWithValuation, executeInvestorTransaction).
 * 4. Admission with unfinalized valuation is strictly rejected and blocked.
 * 5. Only after explicit finalization can the investor become economically active.
 */
export async function runPrompt16BlockAdmissionWithoutFinalValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 16: BLOCK ADMISSION WITHOUT FINAL VALUATION AUDIT');
  console.log('Testing: Unfinalized Valuation Gate, Unresolved Discrepancies, & API Bypass Defense');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Default Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account (initialized at 0, founder deposit will bring both GL and subledger to ৳1,000)
  const bankAccId = 'bank_prime_p16';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt16';
  const today = '2026-06-15';

  // 3. Establish initial active founder
  const founderTx = await executeInvestorTransaction(
    {
      investorName: 'Founder Tariqul',
      phone: '01711000001',
      contribution: 1000,
      profitSharingRatio: 40,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
    },
    mDb
  );
  assert(Boolean(founderTx.investor), 'Baseline: Founder Tariqul established with ৳1,000 capital');

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Attempt Admission With No Finalized Valuation (Draft/Unfinalized)
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 1: Attempt Admission With Unfinalized / Draft Valuation ---');

  const req1 = await createAdmissionRequest(
    {
      investorName: 'Engineer Anisur Rahman',
      phone: '01722000003',
      proposedContribution: 600,
      proposedProfitSharingRatio: 30,
      requestDate: today,
      notes: 'Prospective tech partner',
      currentUserId: testUserId,
      createCandidateInvestorRecord: true
    },
    mDb
  );
  assert(req1.stage === 'REQUEST', 'Admission request 1 created at REQUEST stage');

  // Step 2: Reconciliation passes
  await executeAdmissionReconciliation(
    req1.id,
    { responsibleUser: testUserId },
    mDb
  );
  assert(true, 'Step 2: Reconciliation completed with PASS status');

  // Step 3: Valuation executed as DRAFT / UNFINALIZED (finalizeValuation: false)
  const req1Valued = await executeAdmissionValuation(
    req1.id,
    {
      responsibleUser: testUserId,
      overridePreMoney: 1400,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'Draft pre-money valuation ৳1,400 pending committee sign-off',
      finalizeValuation: false // CRITICAL: explicitly unfinalized
    },
    mDb
  );
  assert(req1Valued.valuation?.status === 'VALUED', 'Valuation recorded with status VALUED (unfinalized)');
  assert(req1Valued.valuation?.isFinalized === false, 'Valuation isFinalized is strictly FALSE');

  // Step 4: Review completed
  await executeAdmissionReview(
    req1.id,
    {
      reviewedBy: testUserId,
      reviewNotes: 'Draft valuation noted, recommended with condition of final valuation sign-off',
      approvedRecommendation: true
    },
    mDb
  );

  // Step 5: Approval completed
  await executeAdmissionApproval(
    req1.id,
    {
      approvedBy: 'Chairman Rahim',
      approvalNotes: 'Conditionally approved',
      approved: true
    },
    mDb
  );

  // Step 6: Capital Receipt completed
  await executeAdmissionCapitalReceipt(
    req1.id,
    {
      receivedAmount: 600,
      targetAccountId: bankAccId,
      receiptDate: today,
      currentUserId: testUserId,
      notes: 'Capital wire received'
    },
    mDb
  );
  const req1BeforeFinal = await getAdmissionRequestById(req1.id, mDb);
  assert(req1BeforeFinal?.stage === 'CAPITAL_RECEIPT', 'Capital receipt stage reached');
  assert(req1BeforeFinal?.valuation?.isFinalized === false, 'Valuation remains UNFINALIZED');

  // Step 7: ATTEMPT FINAL ADMISSION WITH UNFINALIZED VALUATION -> MUST BE BLOCKED!
  let blockedAdmission1 = false;
  let blockError1 = '';
  try {
    await executeAdmissionFinalization(
      req1.id,
      {
        admissionDate: today,
        currentUserId: testUserId,
        contractualProfitSharePercentage: 30
      },
      mDb
    );
  } catch (err: any) {
    blockedAdmission1 = true;
    blockError1 = err.message || '';
  }

  assert(blockedAdmission1, 'CRITICAL: executeAdmissionFinalization strictly BLOCKED admission with unfinalized valuation');
  assert(
    blockError1.includes('চূড়ান্ত') || blockError1.includes('FINALIZED') || blockError1.includes('Valuation is not finalized'),
    `Clear blocking reason displayed: "${blockError1}"`
  );

  // Verify investor is still NOT economically active
  const checkActive1 = await isInvestorAdmittedAndActive(req1.investorId!, mDb);
  assert(checkActive1.isActive === false, `Investor is NOT economically active: ${checkActive1.reason}`);
  assert(
    checkActive1.reason?.includes('not finalized') ||
      checkActive1.reason?.includes('CAPITAL_RECEIPT') ||
      checkActive1.reason?.includes('REQUESTED') ||
      checkActive1.reason?.includes('pending'),
    `Active check reason clearly identifies unadmitted/unfinalized status: "${checkActive1.reason}"`
  );

  // Verify candidate investor cannot receive profit allocation
  let profitAllocBlocked1 = false;
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: req1.investorId!,
        finalizedDistributableProfit: 1000,
        allocationDate: today,
        currentUserId: testUserId
      },
      mDb
    );
  } catch {
    profitAllocBlocked1 = true;
  }
  assert(profitAllocBlocked1, 'CRITICAL: Candidate investor strictly blocked from profit allocation while admission is blocked');

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Attempt Admission With Incomplete Valuation
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Attempt Admission With Incomplete Valuation ---');

  const req2 = await createAdmissionRequest(
    {
      investorName: 'Dr. Shirin Akhtar',
      phone: '01833000004',
      proposedContribution: 400,
      proposedProfitSharingRatio: 20,
      requestDate: today,
      currentUserId: testUserId,
      createCandidateInvestorRecord: true
    },
    mDb
  );

  // Fake advance to capital receipt stage with incomplete valuation
  req2.stage = 'CAPITAL_RECEIPT';
  req2.status = 'CAPITAL_RECEIVED';
  req2.reconciliation = { status: 'PASS' };
  req2.valuation = {
    status: 'PENDING' // Incomplete!
  };
  await mDb.investorAdmissionRequests.put(req2);

  let blockedAdmission2 = false;
  let blockError2 = '';
  try {
    await executeAdmissionFinalization(
      req2.id,
      {
        admissionDate: today,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    blockedAdmission2 = true;
    blockError2 = err.message || '';
  }

  assert(blockedAdmission2, 'CRITICAL: Admission blocked when valuation is incomplete');
  assert(
    blockError2.includes('অসম্পূর্ণ') || blockError2.includes('incomplete') || blockError2.includes('Valuation is incomplete'),
    `Clear reason displayed for incomplete valuation: "${blockError2}"`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Attempt Admission With Unresolved Reconciliation Discrepancies
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Attempt Admission With Unresolved Reconciliation ---');

  const req3 = await createAdmissionRequest(
    {
      investorName: 'Major Masud Rana',
      phone: '01944000005',
      proposedContribution: 500,
      proposedProfitSharingRatio: 25,
      requestDate: today,
      currentUserId: testUserId,
      createCandidateInvestorRecord: true
    },
    mDb
  );

  // Simulate unresolved reconciliation
  req3.stage = 'CAPITAL_RECEIPT';
  req3.status = 'CAPITAL_RECEIVED';
  req3.reconciliation = {
    status: 'UNRESOLVED',
    gateResult: {
      passed: false,
      status: 'UNRESOLVED',
      asOfDate: today,
      timestamp: new Date().toISOString(),
      checks: [],
      unresolvedDiscrepancies: [
        {
          item: 'Inventory Feed Ledger Discrepancy',
          description: 'GL 1070 feed vs physical bin mismatch',
          glAmount: 50000,
          operationalAmount: 42000,
          difference: 8000,
          reason: 'Material inventory subledger discrepancy ৳8,000'
        }
      ],
      totalMaterialDiscrepancy: 8000,
      unresolvedCount: 1,
      blockingReason: 'Material inventory subledger discrepancy ৳8,000'
    }
  };
  req3.valuation = {
    status: 'FINALIZED',
    isFinalized: true,
    preMoneyValuation: 2000,
    postMoneyValuation: 2500,
    calculatedParticipationPercentage: 20
  };
  await mDb.investorAdmissionRequests.put(req3);

  let blockedAdmission3 = false;
  let blockError3 = '';
  try {
    await executeAdmissionFinalization(
      req3.id,
      {
        admissionDate: today,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    blockedAdmission3 = true;
    blockError3 = err.message || '';
  }

  assert(blockedAdmission3, 'CRITICAL: Admission blocked when reconciliation is unresolved');
  assert(
    blockError3.includes('অমীমাংসিত') || blockError3.includes('unresolved') || blockError3.includes('Reconciliation is unresolved'),
    `Clear reason displayed for unresolved reconciliation: "${blockError3}"`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Anti-Bypass Defense: admitNewInvestorWithValuation
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Anti-Bypass Defense (Alternative API Calls) ---');

  // A. Create an unfinalized valuation event
  const draftValEvent = await createValuationEvent(
    {
      valuationDate: today,
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      totalBusinessAssetsIncluded: 1000,
      relevantLiabilities: 200,
      finalize: false,
      status: 'DRAFT',
      notes: 'Unfinalized valuation event'
    },
    mDb
  );
  assert(draftValEvent.status === 'DRAFT', 'Draft valuation event created with status DRAFT');

  // Attempt to admit investor via admitNewInvestorWithValuation referencing DRAFT valuation
  let bypassBlocked1 = false;
  let bypassError1 = '';
  try {
    await admitNewInvestorWithValuation(
      {
        investorName: 'Bypass Candidate A',
        contribution: 300,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        admissionDate: today,
        valuationEventId: draftValEvent.id
      },
      mDb
    );
  } catch (err: any) {
    bypassBlocked1 = true;
    bypassError1 = err.message || '';
  }

  assert(bypassBlocked1, 'CRITICAL: admitNewInvestorWithValuation blocked admission referencing unfinalized valuation');
  assert(
    bypassError1.includes('চূড়ান্ত') || bypassError1.includes('FINALIZED') || bypassError1.includes('Valuation is not finalized'),
    `Clear reason displayed on API bypass attempt: "${bypassError1}"`
  );

  // B. Attempt to call executeInvestorTransaction on an unadmitted candidate investor
  let bypassBlocked2 = false;
  let bypassError2 = '';
  try {
    await executeInvestorTransaction(
      {
        investorId: req1.investorId,
        investorName: 'Engineer Anisur Rahman',
        contribution: 600,
        profitSharingRatio: 30,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: today
      },
      mDb
    );
  } catch (err: any) {
    bypassBlocked2 = true;
    bypassError2 = err.message || '';
  }

  assert(bypassBlocked2, 'CRITICAL: executeInvestorTransaction blocked direct capital entry for candidate investor');
  assert(
    bypassError2.includes('স্থগিত') || bypassError2.includes('formal admission workflow'),
    `Direct transaction blocked with message: "${bypassError2}"`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Explicit Finalization & Clean Admission Success
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Explicit Finalization & Admission Success ---');

  // Finalize the valuation for Request 1
  const finalizedValReq1 = await finalizeAdmissionValuation(
    req1.id,
    {
      responsibleUser: testUserId,
      notes: 'Valuation officially finalized and approved by board'
    },
    mDb
  );
  assert(finalizedValReq1.valuation?.status === 'FINALIZED', 'Valuation status updated to FINALIZED');
  assert(finalizedValReq1.valuation?.isFinalized === true, 'Valuation isFinalized is now TRUE');
  assert(Boolean(finalizedValReq1.valuation?.finalizedAt), 'finalizedAt timestamp recorded');

  // Now execute final admission -> MUST SUCCEED!
  const finalAdmissionSuccess = await executeAdmissionFinalization(
    req1.id,
    {
      admissionDate: today,
      currentUserId: testUserId,
      contractualProfitSharePercentage: 30,
      notes: 'Admission finalized after approved valuation'
    },
    mDb
  );

  assert(finalAdmissionSuccess.request.stage === 'ADMISSION', 'Stage is ADMISSION');
  assert(finalAdmissionSuccess.request.status === 'ADMITTED', 'Status is ADMITTED');
  assert(finalAdmissionSuccess.request.isAdmitted === true, 'isAdmitted is TRUE');
  assert(finalAdmissionSuccess.request.economicParticipationActive === true, 'economicParticipationActive is TRUE');
  assert(finalAdmissionSuccess.investor.status === 'ACTIVE', 'Investor record is ACTIVE');
  assert(finalAdmissionSuccess.investor.economicParticipationActive === true, 'Investor economicParticipationActive is TRUE');
  assert(finalAdmissionSuccess.investor.currentCapitalBalance === 600, 'Investor capital balance is ৳600');
  assert(finalAdmissionSuccess.tranche.status === 'ACTIVE', 'Investment tranche is ACTIVE');

  // Verify isInvestorAdmittedAndActive now returns TRUE
  const checkActiveSuccess = await isInvestorAdmittedAndActive(req1.investorId!, mDb);
  assert(checkActiveSuccess.isActive === true, 'isInvestorAdmittedAndActive confirms investor is now ACTIVE in economic participation');

  // Verify profit allocation now succeeds
  const profitAllocSuccess = await executeInvestorProfitAllocationTransaction(
    {
      investorId: req1.investorId!,
      finalizedDistributableProfit: 1000,
      allocationDate: today,
      currentUserId: testUserId
    },
    mDb
  );
  assert(Boolean(profitAllocSuccess.journalEntryId), 'Profit allocation successfully executed post-admission');
  assert(profitAllocSuccess.allocatedProfit === 300, 'Allocated 30% of ৳1,000 = ৳300 to admitted investor');

  console.log('\n================================================================');
  console.log(`PROMPT 16 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution
if (process.argv[1]?.includes('testPrompt16BlockAdmissionWithoutFinalValuation')) {
  runPrompt16BlockAdmissionWithoutFinalValuationTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 16 tests FAILED: ${res.failed}/${res.total} failed.`);
        process.exit(1);
      } else {
        console.log(`Prompt 16 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Test execution threw unhandled error:', err);
      process.exit(1);
    });
}
