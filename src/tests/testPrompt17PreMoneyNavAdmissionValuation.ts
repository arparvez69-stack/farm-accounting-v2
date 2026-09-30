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
  inspectAdmissionValuation
} from '../services/admissionService';
import {
  executeInvestorTransaction,
  admitNewInvestorWithValuation,
  getAdmissionAuditById
} from '../services/transactionService';
import {
  createValuationEvent,
  clearValuationEventsForTest,
  getValuationEventById,
  calculateNetAssetValuation
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 17 — Pre-Money NAV
 *
 * Requirements:
 * 1. Inspect new-investor admission valuation.
 * 2. Use the finalized business NAV immediately before admission as PRE-MONEY NAV.
 * 3. Do not use:
 *    - original nominal capital only;
 *    - historical contribution total only;
 *    - current cash only.
 * 4. Example: Pre-money NAV = 600.
 * 5. The system must store this valuation reference in the admission event.
 * 6. Test that the admission references the correct finalized valuation.
 * 7. Return PASS.
 */
export async function runPrompt17PreMoneyNavAdmissionValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 17: PRE-MONEY NAV ADMISSION VALUATION AUDIT');
  console.log('Testing: Finalized NAV as Pre-Money NAV, Anti-Shortcut Rejections, & Valuation Reference Storage');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Default Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p17';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt17';
  const admissionDate = '2026-06-15';
  const valuationDateBeforeAdmission = '2026-06-14';

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Founder with Original Nominal Capital = ৳300
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establish Founder with Original Nominal Capital = ৳300 ---');

  const founderTx = await executeInvestorTransaction(
    {
      investorName: 'Founder Tariqul',
      phone: '01711000001',
      contribution: 300,
      profitSharingRatio: 100,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'প্রতিষ্ঠাতা মূলধন: ৳৩০০ (Original nominal capital = ৳300)'
    } as any,
    mDb
  );

  assert(Boolean(founderTx.investor.id), 'Founder Tariqul established successfully');
  assert(founderTx.investor.capitalAmount === 300, 'Original nominal capital is ৳300');
  assert(founderTx.investor.capitalContributed === 300, 'Historical contribution total is ৳300');

  // ---------------------------------------------------------------------------
  // STEP 2: Business Operations Leading to Example State (NAV = 600, Cash = 200, Inventory = 400)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Establish Prompt Example State (Pre-money NAV = 600) ---');

  // We set up business assets:
  // Bank Balance: ৳200 (Current cash only = ৳200)
  // Inventory (1040): ৳400
  // Total Assets = ৳600. Liabilities = ৳0. Net Asset Value = ৳600.
  // Update bank account balance to ৳200
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 200 });

  // Post GL entry for cash adjustment and inventory creation so GL reflects exact asset structure
  await postJournalEntry(
    {
      id: 'j_p17_ops',
      voucherNumber: 'JRN-P17-001',
      voucherType: 'JOURNAL',
      date: '2026-05-01',
      narration: 'ব্যবসার কার্যক্রম: ইনভেন্টরি ক্রয় ও সমন্বয় (Assets: Cash ৳200, Inventory ৳400)',
      reference: 'OPS-2026-01',
      lines: [
        {
          accountId: 'acc_1040',
          accountCode: '1040',
          accountName: 'পণ্য সামগ্রী ও ফিড ইনভেন্টরি',
          debit: 400,
          credit: 0,
          memo: 'ইনভেন্টরি সম্পদ'
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 100,
          memo: 'ইনভেন্টরি ক্রয়ের জন্য ব্যাংক থেকে প্রদান'
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'মালিকের সাধারণ মূলধন',
          debit: 0,
          credit: 300,
          memo: 'ব্যবসায়িক পুঞ্জীভূত মুনাফা ও মূলধন সমন্বয়'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-05-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const navBeforeAdmission = await calculateNetAssetValuation(valuationDateBeforeAdmission, mDb);
  assert(navBeforeAdmission.totalEligibleAssets === 600, 'Total business assets immediately before admission = ৳600');
  assert(navBeforeAdmission.totalDeductedLiabilities === 0, 'Total business liabilities = ৳0');
  assert(navBeforeAdmission.netAssetValue === 600, 'Calculated business Net Asset Value = ৳600 (Prompt Example)');

  // ---------------------------------------------------------------------------
  // STEP 3: Finalize Business Valuation Event Immediately Before Admission
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Finalize Business Valuation Event (Date: 2026-06-14, NAV = 600) ---');

  const businessValuationEvent = await createValuationEvent(
    {
      valuationDate: valuationDateBeforeAdmission,
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'অন্তর্ভুক্তির অব্যবহিত পূর্বের চূড়ান্তকৃত ব্যবসায়িক মূল্যায়ন (Finalized NAV = ৳600)',
      finalize: true,
      status: 'FINALIZED',
      bypassReconciliationForTest: true
    },
    mDb
  );

  assert(Boolean(businessValuationEvent.id), 'Valuation event created with ID');
  assert(businessValuationEvent.status === 'FINALIZED', 'Valuation event is in status FINALIZED');
  assert(businessValuationEvent.resultingNetBusinessValue === 600, 'Finalized business NAV is exactly ৳600');
  assert(businessValuationEvent.valuationDate === valuationDateBeforeAdmission, 'Valuation event is dated immediately before admission');

  // Verify the three distinct comparison metrics:
  // 1. Original nominal capital only = ৳300
  // 2. Historical contribution total only = ৳300
  // 3. Current cash only = ৳200
  // 4. Finalized Business NAV = ৳600
  const founder = await mDb.investors.get(founderTx.investor.id);
  const nominalCapitalOnly = Number(founder.capitalAmount);
  const historicalContributionTotal = Number(founder.capitalContributed);
  const cashAccounts = await mDb.cashBankAccounts.toArray();
  const currentCashOnly = Number(cashAccounts[0].currentBalance);

  assert(nominalCapitalOnly === 300, 'Original nominal capital only is ৳300');
  assert(historicalContributionTotal === 300, 'Historical contribution total only is ৳300');
  assert(currentCashOnly === 200, 'Current cash only is ৳200');
  assert(nominalCapitalOnly !== 600, 'Nominal capital (৳300) differs from Finalized NAV (৳600)');
  assert(currentCashOnly !== 600, 'Current cash (৳200) differs from Finalized NAV (৳600)');

  // ---------------------------------------------------------------------------
  // STEP 4: Inspect New-Investor Admission Valuation — Anti-Shortcut Protections
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Strict Anti-Shortcut Validation in Admission Valuation ---');

  // Create Admission Request
  const admReq = await createAdmissionRequest(
    {
      investorName: 'Candidate Partner Kabir',
      phone: '01722000002',
      proposedContribution: 100,
      proposedProfitSharingRatio: 14.29,
      requestDate: admissionDate,
      currentUserId: testUserId,
      notes: 'নতুন অংশীদার অন্তর্ভুক্তি আবেদন (Proposed: ৳100)'
    },
    mDb
  );

  // Step 2: Reconciliation
  await executeAdmissionReconciliation(
    admReq.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'রিকনসিলিয়েশন যাচাই সম্পন্ন'
    },
    mDb
  );

  // 4A: Attempt to use original nominal capital only (৳300)
  let rejectedNominal = false;
  let nominalError = '';
  try {
    await executeAdmissionValuation(
      admReq.id,
      {
        responsibleUser: testUserId,
        overridePreMoney: 300 // Original nominal capital only!
      },
      mDb
    );
  } catch (err: any) {
    rejectedNominal = true;
    nominalError = err.message;
  }
  assert(rejectedNominal, 'Strictly BLOCKED using original nominal capital only (৳300)');
  assert(
    nominalError.includes('original nominal capital only') || nominalError.includes('মূল নামিক মূলধন'),
    `Rejection message clearly identifies nominal capital violation: "${nominalError}"`
  );

  // 4B: Attempt to use historical contribution total only (৳300)
  let rejectedHistorical = false;
  let historicalError = '';
  try {
    await executeAdmissionValuation(
      admReq.id,
      {
        responsibleUser: testUserId,
        overridePreMoney: 300 // Historical contribution total only!
      },
      mDb
    );
  } catch (err: any) {
    rejectedHistorical = true;
    historicalError = err.message;
  }
  assert(rejectedHistorical, 'Strictly BLOCKED using historical contribution total only (৳300)');
  assert(
    historicalError.includes('historical contribution') || historicalError.includes('ঐতিহাসিক মোট বিনিয়োগ'),
    `Rejection message clearly identifies historical contribution violation: "${historicalError}"`
  );

  // 4C: Attempt to use current cash only (৳200)
  let rejectedCash = false;
  let cashError = '';
  try {
    await executeAdmissionValuation(
      admReq.id,
      {
        responsibleUser: testUserId,
        overridePreMoney: 200 // Current cash only!
      },
      mDb
    );
  } catch (err: any) {
    rejectedCash = true;
    cashError = err.message;
  }
  assert(rejectedCash, 'Strictly BLOCKED using current cash only (৳200)');
  assert(
    cashError.includes('current cash only') || cashError.includes('বর্তমান নগদ তহবিল'),
    `Rejection message clearly identifies current cash violation: "${cashError}"`
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Execute Admission Valuation Using Finalized Business NAV = ৳600
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Execute Admission Valuation Using Finalized Business NAV = ৳600 ---');

  // Standard execution without override: system must automatically discover and use the finalized business NAV (600)
  const valuedRequest = await executeAdmissionValuation(
    admReq.id,
    {
      responsibleUser: testUserId,
      finalizeValuation: true,
      notes: 'অন্তর্ভুক্তি প্রাক-মূল্যায়ন: চূড়ান্তকৃত ব্যবসায়িক NAV = ৳৬০০'
    },
    mDb
  );

  assert(valuedRequest.stage === 'VALUATION', 'Admission request transitioned to VALUATION stage');
  assert(valuedRequest.valuation?.status === 'FINALIZED', 'Admission valuation status is FINALIZED');
  assert(valuedRequest.valuation?.isFinalized === true, 'Admission valuation isFinalized is true');
  assert(valuedRequest.valuation?.preMoneyValuation === 600, 'Pre-money NAV is strictly the finalized business NAV: ৳600');
  assert(valuedRequest.valuation?.preMoneyValuation !== 300, 'Pre-money NAV does NOT equal nominal/historical capital (৳300)');
  assert(valuedRequest.valuation?.preMoneyValuation !== 200, 'Pre-money NAV does NOT equal current cash only (৳200)');
  assert(
    valuedRequest.valuation?.valuationEventId === businessValuationEvent.id,
    `Valuation step references the finalized valuation event ID: ${businessValuationEvent.id}`
  );
  assert(
    valuedRequest.valuation?.valuationReference === businessValuationEvent.id,
    'Valuation step stores valuationReference pointing to the finalized valuation'
  );
  assert(
    valuedRequest.valuation?.finalizedValuationId === businessValuationEvent.id,
    'Valuation step stores finalizedValuationId pointing to the finalized valuation'
  );
  assert(valuedRequest.valuation?.valuationBasis === 'FINALIZED_NAV', 'Valuation basis is marked as FINALIZED_NAV');

  // Verify economic calculations:
  // Pre-money NAV = 600, Contribution = 100 -> Post-money = 700
  // New investor ratio = 100 / 700 = 14.29%
  // Existing investor ratio = 600 / 700 = 85.71%
  assert(valuedRequest.valuation?.postMoneyValuation === 700, 'Post-money valuation is ৳700 (600 + 100)');
  assert(valuedRequest.valuation?.calculatedParticipationPercentage === 14.29, 'New investor participation is exactly 14.29%');
  assert(valuedRequest.valuation?.calculatedParticipationPercentage !== 50, 'Automatic 50/50 split is strictly prevented');

  // ---------------------------------------------------------------------------
  // STEP 6: Execute Remaining Admission Stages Through Final Admission
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Complete Pipeline: Review -> Approval -> Capital Receipt -> Admission ---');

  // Step 4: Review
  await executeAdmissionReview(
    admReq.id,
    {
      reviewedBy: testUserId,
      reviewNotes: 'মূল্যায়ন ও হিসাবরক্ষণ অডিট সন্তোষজনক। প্রি-মানি NAV ৳৬০০ অনুমোদনের সুপারিশ।',
      approvedRecommendation: true
    },
    mDb
  );

  // Step 5: Approval
  await executeAdmissionApproval(
    admReq.id,
    {
      approvedBy: testUserId,
      approved: true,
      decision: 'APPROVE',
      approvalNotes: 'ব্যবস্থাপনা কমিটি কর্তৃক প্রি-মানি NAV ৳৬০০ অনুমোদিত।'
    },
    mDb
  );

  // Step 6: Capital Receipt (deposit ৳100 into bank)
  await executeAdmissionCapitalReceipt(
    admReq.id,
    {
      receivedAmount: 100,
      targetAccountId: bankAccId,
      receiptDate: admissionDate,
      currentUserId: testUserId,
      notes: 'নতুন বিনিয়োগকারীর অনুমোদিত মূলধন গ্রহণ (৳১০০)'
    },
    mDb
  );

  // Step 7: Admission Finalization
  const finalAdmission = await executeAdmissionFinalization(
    admReq.id,
    {
      admissionDate,
      currentUserId: testUserId,
      contractualProfitSharePercentage: 14.29,
      notes: 'চূড়ান্ত অন্তর্ভুক্তি ও অংশীদারিত্ব সক্রিয়করণ'
    },
    mDb
  );

  assert(finalAdmission.request.stage === 'ADMISSION', 'Request reached stage ADMISSION');
  assert(finalAdmission.request.status === 'ADMITTED', 'Request status is ADMITTED');
  assert(finalAdmission.request.isAdmitted === true, 'Request isAdmitted is true');
  assert(finalAdmission.request.economicParticipationActive === true, 'Economic participation is ACTIVE');
  assert(finalAdmission.investor.status === 'ACTIVE', 'Investor record is ACTIVE');
  assert(finalAdmission.investor.capitalAmount === 100, 'Investor capital balance is ৳100');

  // ---------------------------------------------------------------------------
  // STEP 7: Verify Valuation Reference Stored in the Admission Event
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Verify Valuation Reference Stored in the Admission Event ---');

  // 7A: Check request.admission stores the valuation reference
  const admittedRequest = finalAdmission.request;
  assert(
    admittedRequest.admission?.valuationEventId === businessValuationEvent.id,
    `Admission event stores valuationEventId: ${businessValuationEvent.id}`
  );
  assert(
    admittedRequest.admission?.valuationReference === businessValuationEvent.id,
    `Admission event stores valuationReference: ${businessValuationEvent.id}`
  );
  assert(
    admittedRequest.admission?.finalizedValuationId === businessValuationEvent.id,
    `Admission event stores finalizedValuationId: ${businessValuationEvent.id}`
  );
  assert(
    admittedRequest.admission?.preMoneyValuation === 600,
    'Admission event stores preMoneyValuation: ৳600'
  );
  assert(
    admittedRequest.admission?.postMoneyValuation === 700,
    'Admission event stores postMoneyValuation: ৳700'
  );

  // 7B: Check formal InvestorAdmissionAudit stores the valuation reference
  const audit = finalAdmission.admissionAudit;
  assert(Boolean(audit.admissionId), 'InvestorAdmissionAudit record created');
  assert(
    audit.valuationEventId === businessValuationEvent.id,
    `Admission audit stores valuationEventId: ${businessValuationEvent.id}`
  );
  assert(
    audit.valuationReference === businessValuationEvent.id,
    `Admission audit stores valuationReference: ${businessValuationEvent.id}`
  );
  assert(
    audit.finalizedValuationId === businessValuationEvent.id,
    `Admission audit stores finalizedValuationId: ${businessValuationEvent.id}`
  );
  assert(
    audit.preMoneyValuation === 600,
    'Admission audit records pre-money valuation = ৳600'
  );
  assert(
    audit.valuationBasis === 'FINALIZED_NAV',
    'Admission audit records valuation basis = FINALIZED_NAV'
  );
  assert(
    audit.postMoneyValuation === 700,
    'Admission audit records post-money valuation = ৳700'
  );
  assert(
    audit.newInvestorParticipationPercentage === 14.29,
    'Admission audit records new investor participation = 14.29%'
  );

  // Retrieve audit by ID from persistent store
  const retrievedAudit = await getAdmissionAuditById(audit.admissionId, mDb);
  assert(Boolean(retrievedAudit), 'Admission audit successfully retrieved from durable storage');
  assert(
    retrievedAudit?.valuationReference === businessValuationEvent.id,
    'Retrieved admission audit preserves valuationReference'
  );
  assert(
    retrievedAudit?.preMoneyValuation === 600,
    'Retrieved admission audit preserves Pre-Money NAV ৳600'
  );

  // 7C: Check InvestmentTranche stores the valuation reference
  const tranche = finalAdmission.tranche;
  assert(
    tranche.valuationEventId === businessValuationEvent.id,
    `InvestmentTranche stores valuationEventId: ${businessValuationEvent.id}`
  );
  assert(
    tranche.valuationReference === businessValuationEvent.id,
    `InvestmentTranche stores valuationReference: ${businessValuationEvent.id}`
  );
  assert(
    tranche.preMoneyValuation === 600,
    'InvestmentTranche stores preMoneyValuation: ৳600'
  );
  assert(
    tranche.postMoneyValuation === 700,
    'InvestmentTranche stores postMoneyValuation: ৳700'
  );

  // 7D: Check bidirectional linking in the Valuation Event itself
  const linkedValEvent = await getValuationEventById(businessValuationEvent.id, mDb);
  assert(Boolean(linkedValEvent), 'Finalized valuation event retrieved');
  assert(
    linkedValEvent?.linkedInvestorId === finalAdmission.investor.id,
    'Valuation event points back to admitted investor ID'
  );
  assert(
    linkedValEvent?.linkedTrancheId === tranche.id,
    'Valuation event points back to admitted tranche ID'
  );
  assert(
    Boolean(linkedValEvent?.admissionReference),
    `Valuation event records admissionReference: ${linkedValEvent?.admissionReference}`
  );

  // ---------------------------------------------------------------------------
  // STEP 8: Run inspectAdmissionValuation Helper
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 8: Comprehensive Inspection via inspectAdmissionValuation ---');

  const inspection = await inspectAdmissionValuation(admReq.id, mDb);

  assert(inspection.passed === true, 'inspectAdmissionValuation returned PASS: true');
  assert(inspection.preMoneyNav === 600, 'Inspection confirms Pre-Money NAV is ৳600');
  assert(inspection.finalizedBusinessNav === 600, 'Inspection confirms Finalized Business NAV is ৳600');
  assert(inspection.nominalCapitalOnly === 300, 'Inspection confirms Nominal Capital was ৳300');
  assert(inspection.historicalContributionTotal === 300, 'Inspection confirms Historical Contribution Total was ৳300');
  assert(inspection.currentCashOnly === 200, 'Inspection confirms Current Cash was ৳200');
  assert(inspection.rejectedNominalCapitalOnly === true, 'Inspection verifies Nominal Capital was not used as NAV');
  assert(inspection.rejectedHistoricalContributionOnly === true, 'Inspection verifies Historical Contribution was not used as NAV');
  assert(inspection.rejectedCurrentCashOnly === true, 'Inspection verifies Current Cash was not used as NAV');
  assert(inspection.isFinalizedValuationReferenced === true, 'Inspection confirms referenced valuation is FINALIZED');
  assert(inspection.valuationReferenceStored === true, 'Inspection confirms valuation reference is stored in admission event');
  assert(
    inspection.referencedValuationEventId === businessValuationEvent.id,
    `Inspection confirms referenced event ID matches: ${businessValuationEvent.id}`
  );

  // Also inspect via audit record ID
  const auditInspection = await inspectAdmissionValuation(audit.admissionId, mDb);
  assert(auditInspection.passed === true, 'inspectAdmissionValuation on audit ID returned PASS: true');
  assert(auditInspection.preMoneyNav === 600, 'Audit inspection confirms Pre-Money NAV ৳600');

  // ---------------------------------------------------------------------------
  // STEP 9: Direct Admission via admitNewInvestorWithValuation Anti-Shortcut Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 9: Verify admitNewInvestorWithValuation Adheres to Prompt 17 Rules ---');

  // 9A: Attempt to admit with nominal capital only via admitNewInvestorWithValuation
  let directNominalBlocked = false;
  try {
    await admitNewInvestorWithValuation(
      {
        investorName: 'Direct Candidate Rahman',
        contribution: 100,
        admissionDate,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        preMoneyValuation: 300 // Nominal capital shortcut!
      },
      mDb
    );
  } catch (err: any) {
    directNominalBlocked = true;
  }
  assert(directNominalBlocked, 'admitNewInvestorWithValuation strictly blocks nominal capital shortcut (৳300)');

  // 9B: Attempt to admit with cash only via admitNewInvestorWithValuation
  let directCashBlocked = false;
  try {
    await admitNewInvestorWithValuation(
      {
        investorName: 'Direct Candidate Rahman',
        contribution: 100,
        admissionDate,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        preMoneyValuation: 200 // Cash only shortcut!
      },
      mDb
    );
  } catch (err: any) {
    directCashBlocked = true;
  }
  assert(directCashBlocked, 'admitNewInvestorWithValuation strictly blocks cash only shortcut (৳200)');

  // 9C: Successful admission using finalized valuation event
  const directAdmission = await admitNewInvestorWithValuation(
    {
      investorName: 'Admitted Partner Faruq',
      contribution: 100,
      admissionDate,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      valuationEventId: businessValuationEvent.id,
      bypassReconciliationForTest: true
    },
    mDb
  );

  assert(Boolean(directAdmission.investor.id), 'Direct admission succeeded with finalized valuation event');
  assert(directAdmission.tranche.preMoneyValuation === 600, 'Direct admission tranche stores Pre-Money NAV ৳600');
  assert(
    directAdmission.tranche.valuationReference === businessValuationEvent.id,
    `Direct admission tranche stores valuationReference: ${businessValuationEvent.id}`
  );
  assert(
    directAdmission.admissionAudit.preMoneyValuation === 600,
    'Direct admission audit stores Pre-Money NAV ৳600'
  );
  assert(
    directAdmission.admissionAudit.valuationReference === businessValuationEvent.id,
    `Direct admission audit stores valuationReference: ${businessValuationEvent.id}`
  );

  console.log('\n================================================================');
  console.log(`PROMPT 17 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 17 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 17 tests FAILED with ' + result.failed + ' failures.');
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt17PreMoneyNavAdmissionValuationTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error during Prompt 17 tests:', err);
      process.exit(1);
    });
}
