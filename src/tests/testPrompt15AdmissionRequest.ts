import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  createAdmissionRequest,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
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
  executeInvestorTransaction
} from '../services/transactionService';
import {
  calculateCapitalParticipationAllocation,
  executeCapitalParticipationAllocation,
  clearValuationEventsForTest
} from '../services/valuationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 15 — Admission Request Audit
 *
 * Verifies:
 * 1. A new investor admission must have an explicit request/event.
 * 2. Merely creating an investor record or request does NOT grant active economic participation.
 * 3. The 7-stage workflow is supported:
 *    REQUEST -> RECONCILIATION -> VALUATION -> REVIEW -> APPROVAL -> CAPITAL RECEIPT -> ADMISSION
 * 4. Candidate investor is strictly excluded from profit allocation prior to final ADMISSION.
 * 5. Full audit trail tracks all 7 stages transparently.
 */
export async function runPrompt15AdmissionRequestTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 15: NEW INVESTOR ADMISSION REQUEST AUDIT');
  console.log('Testing: Explicit Request Event, 7-Stage Workflow, & Profit Allocation Protection');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // Setup Default Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p15';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  const testUserId = 'auditor_prompt15';
  const today = '2026-06-15';

  // Setup an existing active founder investor
  const founderTx = await executeInvestorTransaction(
    {
      investorName: 'Founder Tariqul',
      phone: '01711000001',
      contribution: 1000,
      profitSharingRatio: 40,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01'
    },
    mDb
  );
  assert(Boolean(founderTx.investor), 'Baseline: Active Founder Investor Tariqul established with ৳1,000 capital');
  assert(founderTx.investor.status === 'ACTIVE', 'Baseline: Founder Investor Tariqul is ACTIVE');

  // ---------------------------------------------------------------------------
  // STEP 1: Creating an Admission Request (Stage: REQUEST)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 1: Initiating Explicit Admission Request (Stage: REQUEST) ---');

  const proposedContribution = 500;
  const proposedProfitShare = 25;
  const candidateName = 'Dr. Kamal Hasan';

  const req = await createAdmissionRequest(
    {
      investorName: candidateName,
      phone: '01899000002',
      proposedContribution,
      proposedProfitSharingRatio: proposedProfitShare,
      requestDate: today,
      notes: 'New prospective medical investor for farm fishery expansion',
      currentUserId: testUserId,
      createCandidateInvestorRecord: true
    },
    mDb
  );

  assert(Boolean(req.id), `Admission request created with ID: ${req.id}`);
  assert(Boolean(req.requestNumber), `Human-readable request number generated: ${req.requestNumber}`);
  assert(req.stage === 'REQUEST', `Stage is strictly 'REQUEST' (got: ${req.stage})`);
  assert(req.status === 'REQUESTED', `Status is strictly 'REQUESTED' (got: ${req.status})`);
  assert(req.isAdmitted === false, 'isAdmitted is strictly FALSE at creation');
  assert(req.economicParticipationActive === false, 'economicParticipationActive is strictly FALSE at creation');
  assert(req.proposedContribution === 500, 'Proposed contribution correctly captured: ৳500');
  assert(req.proposedProfitSharingRatio === 25, 'Proposed profit sharing ratio correctly captured: 25%');
  assert(req.auditTrail.length === 1, 'Initial audit trail record created');
  assert(req.auditTrail[0].stage === 'REQUEST', 'Audit trail logged stage REQUEST');

  // Verify candidate investor record created in database
  assert(Boolean(req.investorId), `Candidate investor ID linked: ${req.investorId}`);
  const candidateInv = await mDb.investors.get(req.investorId!);
  assert(Boolean(candidateInv), 'Candidate investor record exists in database');
  assert(candidateInv.status === 'REQUESTED', `Candidate investor status is strictly 'REQUESTED' (got: ${candidateInv.status})`);
  assert(candidateInv.currentCapitalBalance === 0, 'Candidate investor capital balance is strictly ৳0');
  assert(candidateInv.capitalContributed === 0, 'Candidate investor capital contributed is strictly ৳0');
  assert(candidateInv.economicParticipationActive === false, 'Candidate investor economicParticipationActive is strictly false');
  assert(candidateInv.isAdmitted === false, 'Candidate investor isAdmitted is strictly false');

  // Verify isInvestorAdmittedAndActive helper
  const activeCheck1 = await isInvestorAdmittedAndActive(candidateInv.id, mDb);
  assert(activeCheck1.isActive === false, `isInvestorAdmittedAndActive returns FALSE for requested candidate (${activeCheck1.reason})`);

  // ---------------------------------------------------------------------------
  // STEP 2: Verify Investor is NOT Prematurely Included in Profit Allocation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Premature Profit Allocation Protection Audit ---');

  // A. Attempting direct allocation to candidate investor MUST be rejected
  let directAllocationFailed = false;
  let directAllocError = '';
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: candidateInv.id,
        finalizedDistributableProfit: 1000,
        allocationDate: today,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    directAllocationFailed = true;
    directAllocError = err.message || '';
  }
  assert(directAllocationFailed, 'CRITICAL: executeInvestorProfitAllocationTransaction strictly rejected candidate investor');
  assert(
    directAllocError.includes('অননুমোদিত') || directAllocError.includes('pending') || directAllocError.includes('নিষ্ক্রিয়'),
    `Rejection message clearly states admission is pending: "${directAllocError}"`
  );

  // B. Batch capital participation allocation MUST exclude candidate investor
  const allTranchesBefore = await mDb.investmentTranches.toArray();
  const candidateTranches = allTranchesBefore.filter((t: any) => t.investorId === candidateInv.id);
  assert(candidateTranches.length === 0, 'Candidate investor has zero active investment tranches');

  const testFarmProfit = 1000;
  const batchCalc = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: testFarmProfit,
    tranches: allTranchesBefore,
    totalValuationBasis: 1000,
    periodEndDate: today
  });

  const candidateInSummary = batchCalc.investorSummary.find((s) => s.investorId === candidateInv.id);
  assert(!candidateInSummary, 'CRITICAL: Candidate investor is NOT present in calculateCapitalParticipationAllocation summary');

  // C. Execute batch capital participation allocation: candidate investor receives 0
  const batchExec = await executeCapitalParticipationAllocation(
    {
      startDate: '2026-01-01',
      endDate: today,
      finalizedBusinessProfit: testFarmProfit,
      responsibleUser: testUserId,
      totalValuationBasis: 1000
    },
    mDb
  );

  const candidateExecAlloc = batchExec.trancheAllocations.find((a) => a.investorId === candidateInv.id);
  assert(!candidateExecAlloc, 'CRITICAL: Candidate investor received zero tranche allocation entries in GL distribution');

  const refreshedCandidate = await mDb.investors.get(candidateInv.id);
  assert(refreshedCandidate.profitPayable === 0, 'Candidate investor profitPayable remained strictly ৳0');
  assert(refreshedCandidate.totalProfitAllocated === 0, 'Candidate investor totalProfitAllocated remained strictly ৳0');

  // ---------------------------------------------------------------------------
  // STEP 3: Progressing Through the 7-Stage Workflow
  // REQUEST -> RECONCILIATION -> VALUATION -> REVIEW -> APPROVAL -> CAPITAL RECEIPT -> ADMISSION
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Progressing Through 7-Stage Admission Workflow ---');

  // Stage 2: RECONCILIATION
  console.log('  -> Executing Step 2: RECONCILIATION...');
  const reconciledReq = await executeAdmissionReconciliation(
    req.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'Audit of GL accounts vs subledgers passed cleanly'
    },
    mDb
  );
  assert(reconciledReq.stage === 'RECONCILIATION', `Stage transitioned to 'RECONCILIATION' (got: ${reconciledReq.stage})`);
  assert(reconciledReq.status === 'RECONCILED', `Status is 'RECONCILED' (got: ${reconciledReq.status})`);
  assert(reconciledReq.reconciliation?.status === 'PASS', 'Reconciliation gate status recorded as PASS');
  assert(reconciledReq.isAdmitted === false, 'isAdmitted remains FALSE after reconciliation');
  assert(reconciledReq.economicParticipationActive === false, 'economicParticipationActive remains FALSE after reconciliation');

  // Stage 3: VALUATION
  console.log('  -> Executing Step 3: VALUATION...');
  const valuedReq = await executeAdmissionValuation(
    req.id,
    {
      responsibleUser: testUserId,
      overridePreMoney: 1500,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'NAV established at ৳1,500'
    },
    mDb
  );
  assert(valuedReq.stage === 'VALUATION', `Stage transitioned to 'VALUATION' (got: ${valuedReq.stage})`);
  assert(valuedReq.status === 'VALUED', `Status is 'VALUED' (got: ${valuedReq.status})`);
  assert(valuedReq.valuation?.preMoneyValuation === 1500, 'Pre-money valuation recorded as ৳1,500');
  assert(valuedReq.valuation?.postMoneyValuation === 2000, 'Post-money valuation recorded as ৳2,000 (1500 + 500)');
  assert(valuedReq.valuation?.calculatedParticipationPercentage === 25, 'Calculated participation percentage: 25% (500 / 2000)');
  assert(valuedReq.isAdmitted === false, 'isAdmitted remains FALSE after valuation');
  assert(valuedReq.economicParticipationActive === false, 'economicParticipationActive remains FALSE after valuation');

  // Stage 4: REVIEW
  console.log('  -> Executing Step 4: REVIEW...');
  const reviewedReq = await executeAdmissionReview(
    req.id,
    {
      reviewedBy: testUserId,
      reviewNotes: 'Valuation, financial standing, and agricultural background verified. Recommended for approval.',
      approvedRecommendation: true
    },
    mDb
  );
  assert(reviewedReq.stage === 'REVIEW', `Stage transitioned to 'REVIEW' (got: ${reviewedReq.stage})`);
  assert(reviewedReq.status === 'REVIEWED', `Status is 'REVIEWED' (got: ${reviewedReq.status})`);
  assert(reviewedReq.review?.approvedRecommendation === true, 'Review recommendation recorded as approved');
  assert(reviewedReq.isAdmitted === false, 'isAdmitted remains FALSE after review');
  assert(reviewedReq.economicParticipationActive === false, 'economicParticipationActive remains FALSE after review');

  // Stage 5: APPROVAL
  console.log('  -> Executing Step 5: APPROVAL...');
  const approvedReq = await executeAdmissionApproval(
    req.id,
    {
      approvedBy: 'Owner Tariqul',
      approvalNotes: 'Officially approved by farm governing body for admission at 25% economic participation.',
      approved: true
    },
    mDb
  );
  assert(approvedReq.stage === 'APPROVAL', `Stage transitioned to 'APPROVAL' (got: ${approvedReq.stage})`);
  assert(approvedReq.status === 'APPROVED', `Status is 'APPROVED' (got: ${approvedReq.status})`);
  assert(approvedReq.approval?.approvedBy === 'Owner Tariqul', 'Approval authority recorded as Owner Tariqul');
  assert(approvedReq.isAdmitted === false, 'isAdmitted remains FALSE after approval (awaiting capital receipt)');
  assert(approvedReq.economicParticipationActive === false, 'economicParticipationActive remains FALSE after approval');

  // Stage 6: CAPITAL RECEIPT
  console.log('  -> Executing Step 6: CAPITAL RECEIPT...');
  const bankBefore = (await mDb.cashBankAccounts.get(bankAccId)).currentBalance;
  const receiptReq = await executeAdmissionCapitalReceipt(
    req.id,
    {
      receivedAmount: 500,
      targetAccountId: bankAccId,
      receiptDate: today,
      currentUserId: testUserId,
      notes: 'Capital deposit receipt via Prime Bank Wire Transfer'
    },
    mDb
  );
  const bankAfter = (await mDb.cashBankAccounts.get(bankAccId)).currentBalance;

  assert(receiptReq.stage === 'CAPITAL_RECEIPT', `Stage transitioned to 'CAPITAL_RECEIPT' (got: ${receiptReq.stage})`);
  assert(receiptReq.status === 'CAPITAL_RECEIVED', `Status is 'CAPITAL_RECEIVED' (got: ${receiptReq.status})`);
  assert(receiptReq.capitalReceipt?.receivedAmount === 500, 'Capital received recorded: ৳500');
  assert(Boolean(receiptReq.capitalReceipt?.receiptVoucherNumber), `Receipt voucher generated: ${receiptReq.capitalReceipt?.receiptVoucherNumber}`);
  assert(bankAfter === bankBefore + 500, `Bank account debited cleanly: ৳${bankBefore} -> ৳${bankAfter}`);
  assert(receiptReq.isAdmitted === false, 'isAdmitted remains FALSE until Step 7 finalization');
  assert(receiptReq.economicParticipationActive === false, 'economicParticipationActive remains FALSE until Step 7 finalization');

  // Stage 7: ADMISSION FINALIZATION
  console.log('  -> Executing Step 7: ADMISSION FINALIZATION...');
  const admissionFinal = await executeAdmissionFinalization(
    req.id,
    {
      admissionDate: today,
      currentUserId: testUserId,
      contractualProfitSharePercentage: 25,
      notes: 'Full 7-stage admission completed successfully'
    },
    mDb
  );

  const finalizedReq = admissionFinal.request;
  const finalizedInvestor = admissionFinal.investor;
  const finalizedTranche = admissionFinal.tranche;
  const finalizedAudit = admissionFinal.admissionAudit;

  assert(finalizedReq.stage === 'ADMISSION', `Final stage is strictly 'ADMISSION' (got: ${finalizedReq.stage})`);
  assert(finalizedReq.status === 'ADMITTED', `Final status is strictly 'ADMITTED' (got: ${finalizedReq.status})`);
  assert(finalizedReq.isAdmitted === true, 'isAdmitted is now TRUE');
  assert(finalizedReq.economicParticipationActive === true, 'economicParticipationActive is now TRUE');

  assert(finalizedInvestor.status === 'ACTIVE', 'Investor record is now ACTIVE');
  assert(finalizedInvestor.isAdmitted === true, 'Investor isAdmitted is TRUE');
  assert(finalizedInvestor.economicParticipationActive === true, 'Investor economicParticipationActive is TRUE');
  assert(finalizedInvestor.capitalContributed === 500, 'Investor capitalContributed updated to ৳500');
  assert(finalizedInvestor.currentCapitalBalance === 500, 'Investor currentCapitalBalance updated to ৳500');

  assert(finalizedTranche.status === 'ACTIVE', 'Investment Tranche created with status ACTIVE');
  assert(finalizedTranche.investmentAmount === 500, 'Tranche investment amount is ৳500');
  assert(finalizedTranche.contractualProfitSharePercentage === 25, 'Tranche contractual percentage is 25%');
  assert(finalizedTranche.economicParticipationPercentage === 25, 'Tranche economic participation percentage is 25%');

  assert(Boolean(finalizedAudit), 'Formal InvestorAdmissionAudit record created');
  assert(finalizedAudit.preMoneyValuation === 1500, 'Audit record pre-money valuation is ৳1,500');
  assert(finalizedAudit.postMoneyValuation === 2000, 'Audit record post-money valuation is ৳2,000');

  // Verify Audit Trail Completeness (all 7 stages recorded)
  console.log('\n--- Step 4: Audit Trail Completeness Verification ---');
  const trailStages = finalizedReq.auditTrail.map((t) => t.stage);
  assert(trailStages.includes('REQUEST'), 'Audit trail includes REQUEST');
  assert(trailStages.includes('RECONCILIATION'), 'Audit trail includes RECONCILIATION');
  assert(trailStages.includes('VALUATION'), 'Audit trail includes VALUATION');
  assert(trailStages.includes('REVIEW'), 'Audit trail includes REVIEW');
  assert(trailStages.includes('APPROVAL'), 'Audit trail includes APPROVAL');
  assert(trailStages.includes('CAPITAL_RECEIPT'), 'Audit trail includes CAPITAL_RECEIPT');
  assert(trailStages.includes('ADMISSION'), 'Audit trail includes ADMISSION');
  assert(finalizedReq.auditTrail.length === 7, `Audit trail has exactly 7 sequential stages (got: ${finalizedReq.auditTrail.length})`);

  // Verify Active Check after finalization
  const activeCheck2 = await isInvestorAdmittedAndActive(finalizedInvestor.id, mDb);
  assert(activeCheck2.isActive === true, 'isInvestorAdmittedAndActive returns TRUE after Step 7 completion');

  // ---------------------------------------------------------------------------
  // STEP 5: Post-Admission Profit Allocation Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Post-Admission Profit Allocation Verification ---');

  // Now that the investor is formally admitted, they can participate in profit allocation!
  const postAdmissionAlloc = await executeInvestorProfitAllocationTransaction(
    {
      investorId: finalizedInvestor.id,
      finalizedDistributableProfit: 1000,
      allocationDate: today,
      allocationReference: 'DIST-POST-ADM-001',
      currentUserId: testUserId
    },
    mDb
  );

  assert(Boolean(postAdmissionAlloc.journalEntryId), 'Post-admission profit allocation succeeded with journal entry');
  assert(postAdmissionAlloc.allocatedProfit === 250, `Allocated profit calculated correctly: ৳250 (25% of ৳1,000) (got: ${postAdmissionAlloc.allocatedProfit})`);
  assert(postAdmissionAlloc.investor.profitPayable === 250, 'Investor profitPayable updated to ৳250');

  console.log('\n================================================================');
  console.log(`PROMPT 15 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Auto-run if executed directly via tsx
if (
  process.argv[1] &&
  (process.argv[1].endsWith('testPrompt15AdmissionRequest.ts') ||
    process.argv[1].endsWith('testPrompt15AdmissionRequest.js'))
) {
  runPrompt15AdmissionRequestTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 15 tests FAILED: ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 15 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error during Prompt 15 tests:', err);
      process.exit(1);
    });
}
