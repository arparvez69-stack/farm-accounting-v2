import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { executeInvestorTransaction } from '../services/transactionService';
import { clearAdmissionRequestsForTest } from '../services/admissionService';
import { clearValuationEventsForTest } from '../services/valuationService';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK D REGRESSION TEST:
 * Proves a new investor CANNOT bypass admission using:
 * - founding / inception shortcuts
 * - test idempotency keys
 * - legacy test notes
 * - candidate-name tricks
 * - date-based exceptions
 * - allowExceedingGlobal100
 * - any other test-specific condition
 *
 * And proves:
 * - Existing investors adding legitimate new tranches remain allowed.
 */
export async function runTaskDNoAdmissionBypassTests(): Promise<AssertionResult> {
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
  console.log('STARTING TASK D: REMOVE PRODUCTION ADMISSION BYPASSES REGRESSION');
  console.log('Testing: Anti-Bypass Defenses & Existing Investor Tranche Support');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_task_d';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Islami Bank Main',
    name: 'Islami Bank Main',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  const testUserId = 'auditor_task_d';

  // ---------------------------------------------------------------------------
  // TEST 1: Plain direct capital entry for brand-new investor is REJECTED
  // ---------------------------------------------------------------------------
  console.log('--- Test 1: Brand-New Investor Direct Capital Entry => REJECTED ---');
  let err1 = '';
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Plain Candidate',
        phone: '01700000001',
        contribution: 100000,
        profitSharingRatio: 40,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-06-15'
      },
      mDb
    );
  } catch (e: any) {
    err1 = e.message || '';
  }
  assert(
    err1.includes('Admission blocked') || err1.includes('স্থগিত') || err1.includes('চূড়ান্ত ব্যবসায়িক মূল্যায়ন'),
    `Plain direct entry rejected with clear admission error: "${err1}"`
  );

  // ---------------------------------------------------------------------------
  // TEST 2: Founding / Inception shortcuts in notes => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 2: Founding / Inception shortcuts in notes => REJECTED ---');
  const foundingNotes = [
    'founding',
    'Initial founding capital',
    'inception',
    'Founding partner seed money',
    'Inception investment'
  ];

  for (const note of foundingNotes) {
    let rejected = false;
    let errMsg = '';
    try {
      await executeInvestorTransaction(
        {
          investorName: `Investor Note ${note.slice(0, 8)}`,
          phone: '01700000002',
          contribution: 50000,
          profitSharingRatio: 30,
          targetAccountId: bankAccId,
          currentUserId: testUserId,
          date: '2026-06-15',
          notes: note
        },
        mDb
      );
    } catch (e: any) {
      rejected = true;
      errMsg = e.message || '';
    }
    assert(
      rejected && (errMsg.includes('Admission blocked') || errMsg.includes('স্থগিত')),
      `Bypass attempt with note "${note}" was strictly REJECTED`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Legacy test notes => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 3: Legacy test notes => REJECTED ---');
  const legacyNotes = [
    'legacy test notes',
    'test fixture',
    'bypass admission for unit test',
    'partner 1 legacy',
    'Initial seed capital partner admission'
  ];

  for (const note of legacyNotes) {
    let rejected = false;
    let errMsg = '';
    try {
      await executeInvestorTransaction(
        {
          investorName: `Investor Legacy ${note.slice(0, 8)}`,
          phone: '01700000003',
          contribution: 50000,
          profitSharingRatio: 30,
          targetAccountId: bankAccId,
          currentUserId: testUserId,
          date: '2026-06-15',
          notes: note
        },
        mDb
      );
    } catch (e: any) {
      rejected = true;
      errMsg = e.message || '';
    }
    assert(
      rejected && (errMsg.includes('Admission blocked') || errMsg.includes('স্থগিত')),
      `Bypass attempt with legacy note "${note}" was strictly REJECTED`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Candidate-name tricks => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 4: Candidate-name tricks => REJECTED ---');
  const candidateNames = [
    'Founder Tariqul',
    'Founder Tareq',
    'রহিম পার্টনার',
    'Inception Partner',
    'Founding Partner Alpha',
    'System Admin Founder'
  ];

  for (const name of candidateNames) {
    let rejected = false;
    let errMsg = '';
    try {
      await executeInvestorTransaction(
        {
          investorName: name,
          phone: '01700000004',
          contribution: 75000,
          profitSharingRatio: 40,
          targetAccountId: bankAccId,
          currentUserId: testUserId,
          date: '2026-06-15'
        },
        mDb
      );
    } catch (e: any) {
      rejected = true;
      errMsg = e.message || '';
    }
    assert(
      rejected && (errMsg.includes('Admission blocked') || errMsg.includes('স্থগিত')),
      `Bypass attempt with special candidate name "${name}" was strictly REJECTED`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Date-based exceptions => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 5: Date-based exceptions => REJECTED ---');
  const specialDates = ['2026-01-01', '1970-01-01', '2026-01-10', '2020-01-01'];

  for (const dt of specialDates) {
    let rejected = false;
    let errMsg = '';
    try {
      await executeInvestorTransaction(
        {
          investorName: `Investor Date ${dt}`,
          phone: '01700000005',
          contribution: 60000,
          profitSharingRatio: 35,
          targetAccountId: bankAccId,
          currentUserId: testUserId,
          date: dt
        },
        mDb
      );
    } catch (e: any) {
      rejected = true;
      errMsg = e.message || '';
    }
    assert(
      rejected && (errMsg.includes('Admission blocked') || errMsg.includes('স্থগিত')),
      `Bypass attempt with date "${dt}" was strictly REJECTED`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Test idempotency keys => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 6: Test idempotency keys => REJECTED ---');
  const idempotencyKeys = [
    'test_idemp_bypass_01',
    'founding_tx_idempotency_key',
    'idemp_legacy_test_bypass',
    'bypass_admission_key'
  ];

  for (const idKey of idempotencyKeys) {
    let rejected = false;
    let errMsg = '';
    try {
      await executeInvestorTransaction(
        {
          investorName: `Investor Idemp ${idKey.slice(0, 10)}`,
          phone: '01700000006',
          contribution: 80000,
          profitSharingRatio: 30,
          targetAccountId: bankAccId,
          currentUserId: testUserId,
          date: '2026-06-15',
          idempotencyKey: idKey
        },
        mDb
      );
    } catch (e: any) {
      rejected = true;
      errMsg = e.message || '';
    }
    assert(
      rejected && (errMsg.includes('Admission blocked') || errMsg.includes('স্থগিত')),
      `Bypass attempt with idempotency key "${idKey}" was strictly REJECTED`
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 7: allowExceedingGlobal100 flag does NOT bypass admission => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 7: allowExceedingGlobal100 flag does NOT bypass admission => REJECTED ---');
  let rejectedFlag = false;
  let errMsgFlag = '';
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Flag Bypass Investor',
        phone: '01700000007',
        contribution: 100000,
        profitSharingRatio: 50,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        allowExceedingGlobal100: true,
        date: '2026-06-15'
      },
      mDb
    );
  } catch (e: any) {
    rejectedFlag = true;
    errMsgFlag = e.message || '';
  }
  assert(
    rejectedFlag && (errMsgFlag.includes('Admission blocked') || errMsgFlag.includes('স্থগিত')),
    'Bypass attempt with allowExceedingGlobal100 was strictly REJECTED'
  );

  // ---------------------------------------------------------------------------
  // TEST 8: Combination of ALL bypass attempts together => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 8: Kitchen-sink bypass attempt combining all tricks => REJECTED ---');
  let rejectedCombo = false;
  let errMsgCombo = '';
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Founder Tariqul',
        phone: '01711000001',
        contribution: 200000,
        profitSharingRatio: 40,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-01-01',
        notes: 'Initial founding capital - inception legacy bypass',
        idempotencyKey: 'test_founding_kitchen_sink_key',
        allowExceedingGlobal100: true
      },
      mDb
    );
  } catch (e: any) {
    rejectedCombo = true;
    errMsgCombo = e.message || '';
  }
  assert(
    rejectedCombo && (errMsgCombo.includes('Admission blocked') || errMsgCombo.includes('স্থগিত')),
    'Kitchen-sink combination of all bypass tricks was strictly REJECTED'
  );

  // ---------------------------------------------------------------------------
  // TEST 9: Unfinalized valuation record (DRAFT or UNRESOLVED) => REJECTED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 9: Unfinalized valuation record => REJECTED ---');
  let rejectedDraftVal = false;
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Draft Valuation Investor',
        phone: '01700000008',
        contribution: 50000,
        profitSharingRatio: 25,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-06-15',
        valuationRecord: { id: 'val_draft', status: 'DRAFT', reconciliationStatus: 'PASS' }
      },
      mDb
    );
  } catch {
    rejectedDraftVal = true;
  }
  assert(rejectedDraftVal, 'Valuation record with status DRAFT was strictly REJECTED');

  let rejectedUnresolvedVal = false;
  try {
    await executeInvestorTransaction(
      {
        investorName: 'Unresolved Valuation Investor',
        phone: '01700000009',
        contribution: 50000,
        profitSharingRatio: 25,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-06-15',
        valuationRecord: { id: 'val_unres', status: 'FINALIZED', reconciliationStatus: 'UNRESOLVED' }
      },
      mDb
    );
  } catch {
    rejectedUnresolvedVal = true;
  }
  assert(rejectedUnresolvedVal, 'Valuation record with reconciliationStatus UNRESOLVED was strictly REJECTED');

  // Verify NO unauthorized investor records were created in the database
  const allInvestors = await mDb.investors.toArray();
  const activeUnauthorized = allInvestors.filter(
    (inv: any) => inv.status === 'ACTIVE' || (Number(inv.capitalContributed || 0) > 0)
  );
  assert(activeUnauthorized.length === 0, 'Database contains ZERO active investors after rejected bypass attempts');

  // Verify NO journal entries posted to 3020 Investor Capital
  const allJournals = await mDb.journalEntries.toArray();
  const investorCapitalLines = allJournals.flatMap((j: any) =>
    (j.lines || []).filter((l: any) => l.accountCode === '3020')
  );
  assert(investorCapitalLines.length === 0, 'GL 3020 contains ZERO capital postings from rejected bypass attempts');

  // ---------------------------------------------------------------------------
  // TEST 10: Legitimate new investor with finalized valuation fixture => ALLOWED
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 10: Legitimate new investor with finalized valuation fixture => ALLOWED ---');
  const legitimateTx = await executeInvestorTransaction(
    {
      investorName: 'Legitimate Investor Zahid',
      phone: '01899000001',
      contribution: 100000,
      profitSharingRatio: 30,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-06-15',
      valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE,
      notes: 'Legitimate admission with finalized valuation fixture'
    },
    mDb
  );

  assert(Boolean(legitimateTx.investor), 'Legitimate new investor was successfully created');
  assert(legitimateTx.investor.status === 'ACTIVE', 'Admitted investor status is ACTIVE');
  assert(legitimateTx.investor.isAdmitted === true, 'Admitted investor isAdmitted is TRUE');
  assert(legitimateTx.investor.capitalContributed === 100000, 'Capital contributed is ৳100,000');
  assert(Boolean(legitimateTx.tranche), 'InvestmentTranche was created for admitted investor');
  assert(legitimateTx.tranche?.contractualProfitSharePercentage === 30, 'Tranche contractual rate is 30%');

  // ---------------------------------------------------------------------------
  // TEST 11: Existing active investor adding a new tranche => ALLOWED (normal path)
  // ---------------------------------------------------------------------------
  console.log('\n--- Test 11: Existing active investor adding new tranche => ALLOWED ---');
  const tranche2Tx = await executeInvestorTransaction(
    {
      investorId: legitimateTx.investor.id,
      investorName: 'Legitimate Investor Zahid',
      contribution: 50000,
      profitSharingRatio: 30,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-08-01',
      notes: 'Tranche 2 addition for existing active investor'
    },
    mDb
  );

  assert(Boolean(tranche2Tx.investor), 'Existing investor tranche 2 succeeded through normal path');
  assert(tranche2Tx.investor.capitalContributed === 150000, 'Total capital updated to ৳150,000 (100k + 50k)');
  assert(Boolean(tranche2Tx.tranche), 'Tranche 2 record was created');
  assert(tranche2Tx.tranche?.investmentAmount === 50000, 'Tranche 2 investment amount is ৳50,000');

  console.log('\n================================================================');
  console.log(`TASK D TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution
if (process.argv[1]?.includes('testTaskDNoAdmissionBypass')) {
  runTaskDNoAdmissionBypassTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Task D tests FAILED: ${res.failed}/${res.total} failed.`);
        process.exit(1);
      } else {
        console.log(`Task D tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Task D fatal error:', err);
      process.exit(1);
    });
}
