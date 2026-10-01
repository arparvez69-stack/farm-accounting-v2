import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeInvestorTransaction
} from '../services/transactionService';
import {
  createAdmissionRequest,
  clearAdmissionRequestsForTest
} from '../services/admissionService';
import {
  createValuationEvent,
  finalizeValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK 3 REGRESSION TEST: ENFORCE NEW INVESTOR ADMISSION GATE
 *
 * RULE:
 * A brand-new investor must NOT become an active capital participant through direct capital entry alone.
 * Before first capital is committed, require a finalized valid admission/valuation record containing the required valuation/admission information.
 * Existing investors adding a new tranche may use the normal existing-investor path.
 * Reject missing/invalid admission data with a clear error.
 * Do not bypass this rule through UI, API, service, or alternate transaction paths.
 * Preserve existing accounting/idempotency behavior.
 *
 * Proves:
 * 1. new investor + direct capital entry without finalized admission => REJECTED
 * 2. candidate investor + unfinalized admission => REJECTED
 * 3. new investor + valid finalized admission => ALLOWED
 * 4. existing investor + adding new tranche => ALLOWED (normal existing-investor path)
 */
export async function runTask3NewInvestorAdmissionGateTests(): Promise<AssertionResult> {
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
  console.log('STARTING TASK 3: NEW INVESTOR ADMISSION GATE REGRESSION TEST');
  console.log('Testing: Direct Capital Entry Rejection & Finalized Admission Gate');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_task3';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Islami Bank PLC',
    name: 'Islami Bank PLC',
    accountType: 'BANK',
    currentBalance: 100000,
    synced: false
  });

  const testUserId = 'auditor_task3';
  const baselineDate = '2026-01-01';
  const opDate = '2026-06-15';

  // 1. Establish initial active founder
  const founderTx = await executeInvestorTransaction(
    {
      investorName: 'Founder Tariqul',
      phone: '01711000001',
      contribution: 1000,
      profitSharingRatio: 40,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: baselineDate,
      notes: 'Initial founding capital'
    },
    mDb
  );

  assert(Boolean(founderTx.investor), 'Baseline: Founder established with initial capital');
  assert(founderTx.investor.status === 'ACTIVE', 'Founder status is ACTIVE');

  // ===========================================================================
  // TEST 1: New investor + direct capital entry without finalized admission => REJECTED
  // ===========================================================================
  console.log('\n--- Test 1: Brand-New Investor Direct Capital Entry (Without Finalized Admission) => REJECTED ---');

  let directReject1 = false;
  let directErrorMsg1 = '';
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Candidate Tahmid',
        phone: '01811000021',
        contribution: 500,
        profitSharingRatio: 25,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: opDate
      },
      mDb
    );
  } catch (err: any) {
    directReject1 = true;
    directErrorMsg1 = err.message || '';
  }

  assert(directReject1, 'CRITICAL: Brand-new investor direct capital entry without admission was strictly REJECTED');
  assert(
    directErrorMsg1.includes('Admission blocked') ||
      directErrorMsg1.includes('স্থগিত') ||
      directErrorMsg1.includes('চূড়ান্ত ব্যবসায়িক মূল্যায়ন'),
    `Direct rejection error message is clear: "${directErrorMsg1}"`
  );

  // Verify Candidate Tahmid did NOT become an active participant in database
  const allInvestorsAfterReject = await mDb.investors.toArray();
  const tahmidInv = allInvestorsAfterReject.find(
    (i: any) => i.name?.toLowerCase().includes('tahmid')
  );
  assert(!tahmidInv || tahmidInv.status !== 'ACTIVE', 'Candidate Tahmid is NOT an active capital participant in database');

  // ===========================================================================
  // TEST 2: Candidate with unfinalized admission request => REJECTED
  // ===========================================================================
  console.log('\n--- Test 2: Candidate Investor With Unfinalized Admission => REJECTED ---');

  const req2 = await createAdmissionRequest(
    {
      investorName: 'Candidate Sumon',
      phone: '01811000022',
      proposedContribution: 600,
      proposedProfitSharingRatio: 30,
      requestDate: opDate,
      currentUserId: testUserId,
      notes: 'Draft admission request without finalized valuation'
    },
    mDb
  );

  assert(Boolean(req2.id), 'Candidate Sumon admission request created (stage: REQUEST)');

  let directReject2 = false;
  let directErrorMsg2 = '';
  try {
    await executeInvestorTransaction(
      {
        investorId: req2.investorId,
        investorName: 'Candidate Sumon',
        contribution: 600,
        profitSharingRatio: 30,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: opDate,
        admissionRequestId: req2.id
      },
      mDb
    );
  } catch (err: any) {
    directReject2 = true;
    directErrorMsg2 = err.message || '';
  }

  assert(directReject2, 'CRITICAL: Candidate with unfinalized admission request was strictly REJECTED');
  assert(
    directErrorMsg2.includes('Admission blocked') ||
      directErrorMsg2.includes('স্থগিত') ||
      directErrorMsg2.includes('চূড়ান্ত ব্যবসায়িক মূল্যায়ন সম্পন্ন করেননি') ||
      directErrorMsg2.includes('চূড়ান্ত করা হয়নি'),
    `Unfinalized candidate error message is clear: "${directErrorMsg2}"`
  );

  // ===========================================================================
  // TEST 3: New investor + valid finalized admission => ALLOWED
  // ===========================================================================
  console.log('\n--- Test 3: New Investor + Valid Finalized Admission => ALLOWED ---');

  // Create and finalize a business valuation event
  const valEvent = await createValuationEvent(
    {
      valuationDate: opDate,
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      totalBusinessAssetsIncluded: 5000,
      relevantLiabilities: 1000, // 5000 - 1000 = 4000 Net Business Value
      notes: 'Finalized Board-Approved NAV Valuation'
    },
    mDb
  );

  const finalizedVal = await finalizeValuationEvent(
    {
      valuationEventId: valEvent.id,
      responsibleUser: testUserId,
      notes: 'Board Approved',
      bypassReconciliationForTest: true
    },
    mDb
  );
  assert(finalizedVal.status === 'FINALIZED', 'Valuation event successfully finalized (status: FINALIZED)');

  const bankBefore = Number((await mDb.cashBankAccounts.get(bankAccId)).currentBalance);

  // Commit first capital for new investor with valid finalized admission
  const admittedTx = await executeInvestorTransaction(
    {
      investorName: 'Admitted Tanvir',
      phone: '01811000023',
      contribution: 500,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: opDate,
      valuationEventId: finalizedVal.id,
      preMoneyValuation: 4000,
      postMoneyValuation: 4500,
      notes: 'New investor admitted with finalized valuation'
    },
    mDb
  );

  assert(Boolean(admittedTx.investor), 'New investor with finalized admission was successfully ALLOWED');
  assert(admittedTx.investor.status === 'ACTIVE', 'Admitted investor status is ACTIVE');
  assert(admittedTx.investor.isAdmitted === true, 'Admitted investor isAdmitted is TRUE');
  assert(admittedTx.investor.capitalContributed === 500, 'Admitted investor capitalContributed is ৳500');
  assert(Boolean(admittedTx.tranche), 'InvestmentTranche was created for admitted investor');
  assert(admittedTx.tranche?.investmentAmount === 500, 'Tranche investmentAmount is ৳500');
  assert(admittedTx.tranche?.contractualProfitSharePercentage === 20, 'Tranche contractual rate is 20%');

  const bankAfter = Number((await mDb.cashBankAccounts.get(bankAccId)).currentBalance);
  assert(bankAfter === bankBefore + 500, `Bank balance increased by ৳500 (${bankBefore} -> ${bankAfter})`);

  // Verify journal entry posted properly (Dr Bank / Cr 3020 Investor Capital)
  const journalEntry = await mDb.journalEntries.get(admittedTx.journalEntryId);
  assert(Boolean(journalEntry), 'Journal entry created for admitted investor capital');
  const drBankLine = journalEntry.lines.find((l: any) => l.accountCode === '1030' && l.debit === 500);
  const crCapitalLine = journalEntry.lines.find((l: any) => l.accountCode === '3020' && l.credit === 500);
  assert(Boolean(drBankLine), 'Journal correctly debited 1030 Bank by ৳500');
  assert(Boolean(crCapitalLine), 'Journal correctly credited 3020 Investor Capital by ৳500');

  // ===========================================================================
  // TEST 4: Existing investor adding a new tranche => ALLOWED (normal path)
  // ===========================================================================
  console.log('\n--- Test 4: Existing Investor Adding New Tranche => ALLOWED (Normal Path) ---');

  const tranche2Tx = await executeInvestorTransaction(
    {
      investorId: admittedTx.investor.id,
      investorName: 'Admitted Tanvir',
      contribution: 300,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-08-01',
      notes: 'Existing investor tranche 2 contribution'
    },
    mDb
  );

  assert(Boolean(tranche2Tx.investor), 'Existing investor adding tranche 2 succeeded through normal path');
  assert(tranche2Tx.investor.capitalContributed === 800, 'Investor total capitalContributed updated to ৳800 (500 + 300)');
  assert(Boolean(tranche2Tx.tranche), 'Tranche 2 created successfully');
  assert(tranche2Tx.tranche?.investmentAmount === 300, 'Tranche 2 investmentAmount is ৳300');

  console.log('\n================================================================');
  console.log(`TASK 3 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution
if (process.argv[1]?.includes('testTask3NewInvestorAdmissionGate')) {
  runTask3NewInvestorAdmissionGateTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Task 3 tests FAILED: ${res.failed}/${res.total} failed.`);
        process.exit(1);
      } else {
        console.log(`Task 3 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Task 3 fatal error:', err);
      process.exit(1);
    });
}
