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
  calculatePostMoneyNav,
  validatePostMoneyNav,
  inspectAdmissionPostMoneyNav
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
  calculateAdmissionParticipation
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 18 — Post-Money NAV
 *
 * Formula:
 * POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL
 *
 * Example:
 * Pre-money NAV = 600
 * New capital = 100
 * Post-money NAV = 700
 *
 * Requirements:
 * 1. Implement or repair post-money calculation.
 * 2. Formula: POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL
 * 3. Example: Pre-money NAV = 600, New capital = 100 -> Post-money NAV = 700.
 * 4. Do not add profit again.
 * 5. Test the exact 600 + 100 case.
 * 6. Expected post-money NAV = 700.
 * 7. Return PASS.
 */
export async function runPrompt18PostMoneyNavTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 18: POST-MONEY NAV CALCULATION & VERIFICATION');
  console.log('Formula: POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL');
  console.log('Testing Exact Case: 600 (Pre-Money) + 100 (New Capital) = 700 (Post-Money)');
  console.log('Double-Profit Prevention: Strictly ensure profit is NOT added again');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Default Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p18';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt18';
  const admissionDate = '2026-06-15';

  // ===========================================================================
  // STEP 1: Direct Unit Test of calculatePostMoneyNav & Formula
  // ===========================================================================
  console.log('--- Step 1: Unit Testing calculatePostMoneyNav Formula & Exact Case ---');

  const calcExact = calculatePostMoneyNav({
    preMoneyNav: 600,
    newCapital: 100
  });

  assert(calcExact.preMoneyNav === 600, 'Pre-money NAV is 600');
  assert(calcExact.newCapital === 100, 'New capital is 100');
  assert(calcExact.postMoneyNav === 700, 'Expected post-money NAV = 700 (exact 600 + 100 case)');
  assert(
    calcExact.formula === 'POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL',
    'Formula is explicitly POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL'
  );
  assert(calcExact.profitDoubleCounted === false, 'profitDoubleCounted is false');

  // ===========================================================================
  // STEP 2: Strict Double-Profit Addition Prevention
  // ===========================================================================
  console.log('\n--- Step 2: Strict Double-Profit Prevention ---');

  // If someone attempts to add profit again (e.g. ৳300 accounting profit), system must block or detect it
  let doubleProfitBlocked = false;
  try {
    calculatePostMoneyNav({
      preMoneyNav: 600,
      newCapital: 100,
      attemptedProfitAddition: 300,
      strictDoubleProfitPrevention: true
    });
  } catch (err: any) {
    doubleProfitBlocked = true;
    assert(
      err.message.includes('মুনাফা পুনর্বার যোগ করা সম্পূর্ণ নিষিদ্ধ') ||
        err.message.includes('Double profit addition forbidden'),
      `Attempt to add profit again is strictly rejected: "${err.message}"`
    );
  }
  assert(doubleProfitBlocked, 'System blocked adding profit again to post-money NAV');

  // Validation function detects erroneous double-counted calculation
  const validationWithDoubleProfit = validatePostMoneyNav({
    preMoneyNav: 600,
    newCapital: 100,
    actualPostMoneyNav: 1000, // 600 + 100 + 300 profit
    accumulatedProfit: 300
  });
  assert(
    validationWithDoubleProfit.isValid === false,
    'validatePostMoneyNav correctly marks 1000 as INVALID for 600 + 100 case'
  );
  assert(
    validationWithDoubleProfit.profitDoubleCounted === true,
    'validatePostMoneyNav flags profitDoubleCounted = true for 1000'
  );
  assert(
    validationWithDoubleProfit.expectedPostMoneyNav === 700,
    'validatePostMoneyNav indicates expected post-money NAV is 700'
  );

  // Validation function validates correct 700 post-money NAV
  const validationCorrect = validatePostMoneyNav({
    preMoneyNav: 600,
    newCapital: 100,
    actualPostMoneyNav: 700,
    accumulatedProfit: 300
  });
  assert(validationCorrect.isValid === true, 'validatePostMoneyNav marks 700 as VALID');
  assert(
    validationCorrect.profitDoubleCounted === false,
    'validatePostMoneyNav confirms profit was not added again'
  );

  // ===========================================================================
  // STEP 3: calculateAdmissionParticipation Integration
  // ===========================================================================
  console.log('\n--- Step 3: calculateAdmissionParticipation Integration with Post-Money NAV ---');

  const partCalc = calculateAdmissionParticipation({
    preMoneyValuation: 600,
    contribution: 100,
    existingInvestors: [
      {
        investorId: 'founder_1',
        investorName: 'Original Founder',
        historicalCapital: 300,
        profitSharingRatio: 100
      }
    ]
  });

  assert(partCalc.preMoneyValuation === 600, 'Participation calc: Pre-money valuation is 600');
  assert(partCalc.contributionAmount === 100, 'Participation calc: Contribution amount is 100');
  assert(partCalc.postMoneyValuation === 700, 'Participation calc: Post-money valuation is 700 (600 + 100)');
  assert(
    partCalc.newInvestorParticipationPercentage === 14.29,
    'New investor economic participation is 100 / 700 = 14.29%'
  );
  assert(
    partCalc.existingEconomicParticipationPercentage === 85.71,
    'Existing investors economic participation is 600 / 700 = 85.71%'
  );
  assert(partCalc.is5050DefaultPrevented === true, '50/50 default split is strictly prevented');
  assert(partCalc.historicalCapitalPreserved === true, 'Historical capital preserved');

  // ===========================================================================
  // STEP 4: Setup Realistic Accounting State for 600 Pre-Money NAV
  // ===========================================================================
  console.log('\n--- Step 4: Accounting State: Nominal Capital 300 + Profit 300 = Pre-Money NAV 600 ---');

  // Existing founder contributes ৳300 initial capital
  await executeInvestorTransaction(
    {
      investorName: 'Founder Tareq',
      phone: '01711000001',
      contribution: 300,
      profitSharingRatio: 100,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Initial founder equity contribution',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
    },
    mDb
  );

  // Update bank account balance to ৳200
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 200 });

  // Post GL entry for cash adjustment and inventory creation so GL reflects exact asset structure (Total Assets = ৳600, Liabilities = ৳0, NAV = ৳600)
  await postJournalEntry(
    {
      id: 'j_p18_ops',
      voucherNumber: 'JRN-P18-001',
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

  // Balance sheet summary at this point:
  // Bank: ৳200
  // Inventory: ৳400
  // Total Assets = ৳600
  // Liabilities = ৳0
  // Equity: Capital (300) + Net Profit / Reserve (300) = ৳600
  // Net Asset Value (NAV) = ৳600.

  // Create finalized valuation event prior to admission
  const valEvent = await createValuationEvent(
    {
      valuationDate: '2026-06-14',
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'Finalized Business Valuation immediately prior to admission: Pre-Money NAV = 600',
      finalize: true,
      status: 'FINALIZED',
      bypassReconciliationForTest: true
    },
    mDb
  );

  assert(valEvent.resultingNetBusinessValue === 600, 'Valuation event finalized at Pre-Money NAV = 600');
  assert(valEvent.status === 'FINALIZED', 'Valuation event status is FINALIZED');

  // ===========================================================================
  // STEP 5: End-to-End Admission Pipeline with 600 Pre-Money + 100 New Capital
  // ===========================================================================
  console.log('\n--- Step 5: Admission Pipeline Execution (Pre-Money 600 + New Capital 100) ---');

  const newInvestorName = 'New Investor Hasan';
  const newInvestorPhone = '01899000001';

  // 1. Create Request
  const admReq = await createAdmissionRequest(
    {
      investorName: newInvestorName,
      phone: newInvestorPhone,
      proposedContribution: 100,
      proposedProfitSharingRatio: 14.29,
      requestDate: admissionDate,
      currentUserId: testUserId,
      notes: 'Prompt 18: Testing exact 600 + 100 post-money NAV'
    },
    mDb
  );

  // 2. Reconciliation Gate
  await executeAdmissionReconciliation(
    admReq.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'Pre-admission audit gate PASS'
    },
    mDb
  );

  // 3. Valuation Stage
  const valuedRequest = await executeAdmissionValuation(
    admReq.id,
    {
      responsibleUser: testUserId,
      valuationEventId: valEvent.id,
      finalizeValuation: true,
      notes: 'Prompt 18: 600 Pre-money + 100 New Capital'
    },
    mDb
  );

  assert(valuedRequest.stage === 'VALUATION', 'Admission request in stage VALUATION');
  assert(valuedRequest.valuation?.preMoneyValuation === 600, 'Valuation step preMoneyValuation is ৳600');
  assert(valuedRequest.valuation?.postMoneyValuation === 700, 'Valuation step postMoneyValuation is ৳700 (600 + 100)');
  assert(
    valuedRequest.valuation?.calculatedParticipationPercentage === 14.29,
    'Valuation step calculatedParticipationPercentage is 14.29%'
  );

  // 4. Review
  await executeAdmissionReview(
    admReq.id,
    {
      reviewedBy: testUserId,
      reviewNotes: 'Terms reviewed and compliant with valuation',
      approvedRecommendation: true
    },
    mDb
  );

  // 5. Approval
  await executeAdmissionApproval(
    admReq.id,
    {
      approvedBy: testUserId,
      approved: true,
      decision: 'APPROVE',
      approvalNotes: 'Approved by management'
    },
    mDb
  );

  // 6. Capital Receipt (৳100 deposited to bank)
  await executeAdmissionCapitalReceipt(
    admReq.id,
    {
      receivedAmount: 100,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      receiptDate: admissionDate,
      notes: '৳100 capital received'
    },
    mDb
  );

  // 7. Final Admission
  const finalizedResult = await executeAdmissionFinalization(
    admReq.id,
    {
      currentUserId: testUserId,
      admissionDate,
      contractualProfitSharePercentage: 14.29,
      notes: 'Final admission complete'
    },
    mDb
  );

  const admittedReq = finalizedResult.request;
  assert(admittedReq.stage === 'ADMISSION', 'Stage reached ADMISSION');
  assert(admittedReq.status === 'ADMITTED', 'Status is ADMITTED');
  assert(
    admittedReq.admission?.preMoneyValuation === 600,
    'Admission event records preMoneyValuation = ৳600'
  );
  assert(
    admittedReq.admission?.postMoneyValuation === 700,
    'Admission event records postMoneyValuation = ৳700 (Expected 600 + 100 = 700)'
  );
  assert(
    admittedReq.admission?.postMoneyValuation !== 1000,
    'Admission event strictly did NOT add profit again (postMoney is NOT ৳1,000)'
  );

  // ===========================================================================
  // STEP 6: Verify Tranche & Audit Storage of Post-Money NAV = 700
  // ===========================================================================
  console.log('\n--- Step 6: Verify Tranche & InvestorAdmissionAudit Post-Money NAV ---');

  const audit = await getAdmissionAuditById(admittedReq.admission!.admissionAuditId!, mDb);
  assert(audit !== null, 'Admission audit record found');
  assert(audit?.preMoneyValuation === 600, 'Audit pre-money valuation is ৳600');
  assert(audit?.contributionAmount === 100, 'Audit contribution amount is ৳100');
  assert(audit?.postMoneyValuation === 700, 'Audit post-money valuation is ৳700');
  assert(audit?.postMoneyValuation !== 1000, 'Audit post-money does NOT add profit again (NOT ৳1000)');

  const tranche = finalizedResult.tranche;
  assert(tranche.preMoneyValuation === 600, 'InvestmentTranche stores preMoneyValuation: ৳600');
  assert(tranche.postMoneyValuation === 700, 'InvestmentTranche stores postMoneyValuation: ৳700');
  assert(
    tranche.postMoneyValuation === tranche.preMoneyValuation! + tranche.investmentAmount,
    'InvestmentTranche postMoneyValuation === preMoneyValuation + investmentAmount'
  );

  // ===========================================================================
  // STEP 7: Audit Inspection via inspectAdmissionPostMoneyNav
  // ===========================================================================
  console.log('\n--- Step 7: Comprehensive Inspection via inspectAdmissionPostMoneyNav ---');

  const inspection = await inspectAdmissionPostMoneyNav(admittedReq.id, mDb);
  assert(inspection.passed === true, 'inspectAdmissionPostMoneyNav returned PASS: true');
  assert(inspection.preMoneyNav === 600, 'Inspection confirms Pre-Money NAV is ৳600');
  assert(inspection.newCapital === 100, 'Inspection confirms New Capital is ৳100');
  assert(inspection.postMoneyNav === 700, 'Inspection confirms Post-Money NAV is ৳700');
  assert(inspection.expectedPostMoneyNav === 700, 'Inspection confirms Expected Post-Money NAV is ৳700');
  assert(
    inspection.formula === 'POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL',
    'Inspection formula is POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL'
  );
  assert(inspection.profitDoubleCounted === false, 'Inspection confirms profit was NOT double-counted');

  // Test inspection on audit ID as well
  const auditInspection = await inspectAdmissionPostMoneyNav(audit!.admissionId, mDb);
  assert(auditInspection.passed === true, 'inspectAdmissionPostMoneyNav on audit record returned PASS: true');
  assert(auditInspection.postMoneyNav === 700, 'Audit inspection confirms Post-Money NAV is ৳700');

  // ===========================================================================
  // STEP 8: Direct Admission via admitNewInvestorWithValuation
  // ===========================================================================
  console.log('\n--- Step 8: Direct Admission via admitNewInvestorWithValuation ---');

  const directAdmission = await admitNewInvestorWithValuation(
    {
      investorName: 'Direct Investor Faruk',
      phone: '01899000002',
      contribution: 100,
      admissionDate: '2026-06-15',
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      valuationEventId: valEvent.id,
      bypassReconciliationForTest: true
    },
    mDb
  );

  assert(
    directAdmission.tranche.postMoneyValuation === 700,
    'Direct admission tranche records postMoneyValuation = ৳700'
  );
  assert(
    directAdmission.admissionAudit.postMoneyValuation === 700,
    'Direct admission audit records postMoneyValuation = ৳700'
  );

  console.log('\n================================================================');
  console.log(`PROMPT 18 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed > 0) {
    throw new Error(`Prompt 18 tests FAILED: ${result.failed} failures.`);
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt18PostMoneyNavTests()
    .then((res) => {
      console.log(`Prompt 18 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Prompt 18 tests threw an error:', err);
      process.exit(1);
    });
}
