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
  clearAdmissionRequestsForTest,
  inspectAdmissionPeriodProfitAllocation,
  getInvestorEffectiveAdmissionDate
} from '../services/admissionService';
import {
  executeInvestorTransaction,
  executeFinalizedBusinessProfitAllocationToInvestors,
  executeInvestorProfitAllocationTransaction,
  clearValuationEventsForTest
} from '../services/transactionService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 20 — Protect Historical Profit
 *
 * Requirements:
 * Inspect admission-period profit allocation.
 *
 * A new investor admitted after a finalized profit period must not receive profit from that earlier period.
 * Admission must create a clear effective date/period boundary.
 *
 * Test:
 * A exists January-May.
 * C enters June.
 * Finalize January-May profit.
 * Verify C receives zero January-May allocation.
 * Return PASS.
 */
export async function runPrompt20ProtectHistoricalProfitTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 20: PROTECT HISTORICAL PROFIT');
  console.log('Boundary Rule: A new investor admitted after a finalized profit');
  console.log('period must not receive profit from that earlier period.');
  console.log('Test Scenario:');
  console.log('  1. Investor A exists January-May');
  console.log('  2. Investor C enters June');
  console.log('  3. Finalize January-May profit');
  console.log('  4. Verify C receives zero January-May allocation');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account
  const bankAccId = 'bank_main_p20';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Main Farm Bank A/C',
    name: 'Main Farm Bank A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt20';

  // ===========================================================================
  // STEP 1: Investor A Exists January - May
  // ===========================================================================
  console.log('--- Step 1: Investor A Exists in January-May (Effective 2026-01-01) ---');

  const investorATx = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01711000001',
      contribution: 1000,
      profitSharingRatio: 60,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Investor A initial investment (January 2026)'
    },
    mDb
  );

  const investorA = investorATx.investor;
  assert(investorA.status === 'ACTIVE', 'Investor A is ACTIVE');
  assert(investorA.profitSharingRatio === 60, 'Investor A profit sharing ratio is 60%');

  const effDateA = await getInvestorEffectiveAdmissionDate(investorA, mDb);
  assert(effDateA === '2026-01-01', `Investor A effective date is 2026-01-01 (got ${effDateA})`);

  // ===========================================================================
  // STEP 2: Record January-May Business Operations & Generate Profit
  // ===========================================================================
  console.log('\n--- Step 2: Farm Operates January-May (Generates Net Profit ৳2,000) ---');

  // Revenue: ৳5,000 earned in March 2026
  await postJournalEntry(
    {
      id: 'j_p20_sales',
      voucherNumber: 'SALES-2026-001',
      voucherType: 'SALES',
      date: '2026-03-15',
      narration: 'ফার্মের কৃষি ও ডেইরি পণ্য বিক্রয় আয় (January-May period)',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 5000,
          credit: 0,
          memo: 'বিক্রয়লব্ধ ব্যাংক জমা'
        },
        {
          accountId: 'acc_4010',
          accountCode: '4010',
          accountName: 'বিক্রয় আয়',
          debit: 0,
          credit: 5000,
          memo: 'পণ্য বিক্রয় আয়'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Operating Expenses / Feed: ৳3,000 spent in April 2026
  await postJournalEntry(
    {
      id: 'j_p20_exp',
      voucherNumber: 'EXP-2026-001',
      voucherType: 'EXPENSE',
      date: '2026-04-20',
      narration: 'ফার্মের পশুখাদ্য ও পরিচালন ব্যয় (January-May period)',
      lines: [
        {
          accountId: 'acc_5010',
          accountCode: '5010',
          accountName: 'পশুখাদ্য ও পরিচর্যা খরচ',
          debit: 3000,
          credit: 0,
          memo: 'খাদ্য ক্রয় খরচ'
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 3000,
          memo: 'ব্যাংক থেকে পরিশোধ'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-20T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Bank balance now = 1000 + 5000 - 3000 = ৳3,000
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 3000 });

  // Net Profit for Jan-May: 5000 - 3000 = ৳2,000
  console.log('Operating P&L for January-May 2026: Revenue ৳5,000, Expenses ৳3,000, Net Profit ৳2,000');

  // ===========================================================================
  // STEP 3: Investor C Enters in June (Effective 2026-06-01)
  // ===========================================================================
  console.log('\n--- Step 3: Investor C Enters in June (Effective 2026-06-01) ---');

  // Create Admission Request for Investor C (June 1, 2026)
  const reqC = await createAdmissionRequest(
    {
      investorName: 'Investor C',
      phone: '01711000003',
      proposedContribution: 500,
      proposedProfitSharingRatio: 40,
      requestDate: '2026-06-01',
      currentUserId: testUserId,
      notes: 'Investor C admitted in June 2026'
    },
    mDb
  );

  // Reconciliation Gate
  await executeAdmissionReconciliation(
    reqC.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'Pre-admission audit gate PASS'
    },
    mDb
  );

  // Valuation Stage
  await executeAdmissionValuation(
    reqC.id,
    {
      valuationDate: '2026-06-01',
      responsibleUser: testUserId,
      overridePreMoneyValuation: 3000,
      finalizeValuation: true,
      notes: 'Valuation for C admission in June'
    },
    mDb
  );

  // Review & Approval
  await executeAdmissionReview(
    reqC.id,
    {
      reviewedBy: testUserId,
      reviewNotes: 'Terms approved for June entry',
      approvedRecommendation: true
    },
    mDb
  );

  await executeAdmissionApproval(
    reqC.id,
    {
      approvedBy: 'Director',
      decision: 'APPROVE'
    },
    mDb
  );

  // Capital Receipt in June (৳500)
  await executeAdmissionCapitalReceipt(
    reqC.id,
    {
      receivedAmount: 500,
      targetAccountId: bankAccId,
      receiptDate: '2026-06-01',
      currentUserId: testUserId,
      notes: 'Capital received from Investor C'
    },
    mDb
  );

  // Admission Finalization for C
  const finalResultC = await executeAdmissionFinalization(
    reqC.id,
    {
      admissionDate: '2026-06-01',
      currentUserId: testUserId,
      contractualProfitSharePercentage: 40,
      notes: 'Investor C admission finalized'
    },
    mDb
  );

  const investorC = finalResultC.investor;
  assert(investorC.status === 'ACTIVE', 'Investor C is ACTIVE');
  assert(investorC.profitSharingRatio === 40, 'Investor C profit sharing ratio is 40%');

  // Verify Clear Effective Date / Period Boundary Created for C
  const effDateC = await getInvestorEffectiveAdmissionDate(investorC, mDb);
  assert(effDateC === '2026-06-01', `Investor C effective admission date is strictly 2026-06-01 (got ${effDateC})`);
  assert(
    finalResultC.tranche.effectiveInvestmentDate === '2026-06-01',
    'Investor C tranche effectiveInvestmentDate is 2026-06-01'
  );
  assert(
    finalResultC.tranche.effectiveDate === '2026-06-01',
    'Investor C tranche effectiveDate is 2026-06-01'
  );
  assert(
    effDateC > '2026-05-31',
    'Clear Boundary Established: Investor C effective date (2026-06-01) is strictly after May 31 (2026-05-31)'
  );

  // ===========================================================================
  // STEP 4: Finalize January-May Profit
  // ===========================================================================
  console.log('\n--- Step 4: Finalize January-May Profit (Period: 2026-01-01 to 2026-05-31) ---');

  const janMayAllocation = await executeFinalizedBusinessProfitAllocationToInvestors(
    {
      startDate: '2026-01-01',
      endDate: '2026-05-31',
      responsibleUser: testUserId,
      allocationReference: 'ALLOC-2026-JAN-MAY',
      notes: 'Finalized profit allocation for January-May 2026'
    },
    mDb
  );

  assert(janMayAllocation.finalizedBusinessProfit === 2000, 'Finalized January-May profit is ৳2,000');
  assert(janMayAllocation.periodStartDate === '2026-01-01', 'Period start date is 2026-01-01');
  assert(janMayAllocation.periodEndDate === '2026-05-31', 'Period end date is 2026-05-31');

  // ===========================================================================
  // STEP 5: Verify C Receives ZERO January-May Allocation
  // ===========================================================================
  console.log('\n--- Step 5: Verify C Receives Zero January-May Allocation ---');

  // 1. Check allocations array in the finalized result
  const allocC = janMayAllocation.allocations.find(
    (a) => a.investorId === investorC.id || a.investorName === 'Investor C'
  );

  assert(allocC !== undefined, 'Investor C is tracked in allocation distribution report');
  assert(
    allocC?.allocatedProfitAmount === 0,
    `CRITICAL PROMPT 20 REQUIREMENT: Investor C receives ZERO January-May allocation (got ৳${allocC?.allocatedProfitAmount})`
  );
  assert(
    allocC?.ineligibleReason !== undefined && allocC.ineligibleReason.includes('PROMPT 20'),
    `Ineligibility reason recorded: "${allocC?.ineligibleReason}"`
  );

  // 2. Check Investor A receives their positive allocation from January-May profit
  const allocA = janMayAllocation.allocations.find(
    (a) => a.investorId === investorA.id || a.investorName === 'Investor A'
  );
  assert(allocA !== undefined, 'Investor A is tracked in allocation distribution report');
  assert(
    (allocA?.allocatedProfitAmount || 0) > 0,
    `Investor A receives positive January-May allocation (৳${allocA?.allocatedProfitAmount} = 60% of ৳2,000)`
  );
  assert(allocA?.allocatedProfitAmount === 1200, 'Investor A receives exact ৳1,200 (60% of ৳2,000)');

  // 3. Verify total allocated to investors strictly matches A only (৳1,200), not including C
  assert(
    janMayAllocation.totalAllocatedToInvestors === 1200,
    `Total allocated to investors is ৳1,200 (C received ৳0)`
  );
  assert(
    janMayAllocation.retainedBusinessProfit === 800,
    'Retained farm business profit is ৳800 (৳2,000 - ৳1,200)'
  );

  // 4. Verify no payable GL entry exists for C for January-May
  const allJournals = await mDb.journalEntries.toArray();
  const cPayableEntriesForJanMay = allJournals.filter((j: any) => {
    if (j.status === 'REVERSED') return false;
    const isC =
      j.investorId === investorC.id ||
      j.relatedInvestorId === investorC.id ||
      j.relatedPerson === 'Investor C' ||
      j.narration?.includes('Investor C');
    return isC && j.date <= '2026-05-31';
  });

  assert(
    cPayableEntriesForJanMay.length === 0,
    'Zero payable journal entries posted for Investor C for January-May period'
  );

  // ===========================================================================
  // STEP 6: Direct Allocation Attempt Rejection
  // ===========================================================================
  console.log('\n--- Step 6: Verify Direct Allocation Attempt for C on Earlier Period is Rejected ---');

  let directAttemptBlocked = false;
  try {
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: investorC.id,
        finalizedDistributableProfit: 2000,
        allocatedProfit: 400,
        date: '2026-05-31', // Attempting to backdate allocation into May
        allocationReference: 'ATTEMPTED-BACKDATED-ALLOC',
        currentUserId: testUserId,
        notes: 'Malicious or erroneous backdated profit allocation'
      },
      mDb
    );
  } catch (err: any) {
    directAttemptBlocked = true;
    assert(
      err.message.includes('ঐতিহাসিক মুনাফা সুরক্ষা') ||
        err.message.includes('PROMPT 20') ||
        err.message.includes('receives zero profit') ||
        err.message.includes('পূর্ববর্তী হিসাবকাল'),
      `Direct backdated allocation rejected with descriptive error: "${err.message}"`
    );
  }

  assert(directAttemptBlocked, 'Direct profit allocation to C for pre-admission period was strictly blocked');

  // ===========================================================================
  // STEP 7: Comprehensive Inspection via inspectAdmissionPeriodProfitAllocation
  // ===========================================================================
  console.log('\n--- Step 7: Audit Inspection via inspectAdmissionPeriodProfitAllocation ---');

  const inspection = await inspectAdmissionPeriodProfitAllocation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-05-31',
      targetInvestorId: investorC.id,
      existingInvestorId: investorA.id
    },
    mDb
  );

  assert(inspection.passed === true, 'inspectAdmissionPeriodProfitAllocation returns passed: true');
  assert(inspection.historicalProfitProtected === true, 'Historical profit is protected: true');
  assert(inspection.clearBoundaryEstablished === true, 'Clear effective date/period boundary established: true');
  assert(
    inspection.postPeriodAdmittedInvestorAllocation === 0,
    'Post-period admitted investor allocation is exactly 0'
  );
  assert(
    (inspection.prePeriodInvestorAllocation || 0) === 1200,
    'Pre-period investor (A) allocation is confirmed as ৳1,200'
  );
  assert(
    inspection.postPeriodInvestorEffectiveDate === '2026-06-01',
    'Post-period investor effective date confirmed as 2026-06-01'
  );
  assert(
    inspection.boundaryRule ===
      'A new investor admitted after a finalized profit period must not receive profit from that earlier period.',
    'Boundary rule is explicitly stated and verified'
  );

  // ===========================================================================
  // STEP 8: Future Period Eligibility (C is eligible starting June)
  // ===========================================================================
  console.log('\n--- Step 8: Verify C IS Eligible for Profit Starting June 2026 ---');

  // June operations: ৳1,000 profit in June
  await postJournalEntry(
    {
      id: 'j_p20_june_sales',
      voucherNumber: 'SALES-2026-002',
      voucherType: 'SALES',
      date: '2026-06-25',
      narration: 'জুন মাসের কৃষি বিক্রয় আয়',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 1000,
          credit: 0,
          memo: 'জুন মাসের বিক্রয়'
        },
        {
          accountId: 'acc_4010',
          accountCode: '4010',
          accountName: 'বিক্রয় আয়',
          debit: 0,
          credit: 1000,
          memo: 'পণ্য বিক্রয় আয়'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-06-25T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const juneAllocation = await executeFinalizedBusinessProfitAllocationToInvestors(
    {
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      responsibleUser: testUserId,
      allocationReference: 'ALLOC-2026-JUNE'
    },
    mDb
  );

  const juneAllocC = juneAllocation.allocations.find((a) => a.investorId === investorC.id);
  assert(juneAllocC !== undefined, 'Investor C is present in June allocation');
  assert(
    (juneAllocC?.allocatedProfitAmount || 0) > 0,
    `Investor C is eligible and receives positive allocation for June period (৳${juneAllocC?.allocatedProfitAmount})`
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 20 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log('STATUS: ' + (result.failed === 0 ? 'PASS' : 'FAIL'));
  console.log('================================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testPrompt20ProtectHistoricalProfit')) {
  runPrompt20ProtectHistoricalProfitTests()
    .then((r) => {
      process.exit(r.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test run failed:', err);
      process.exit(1);
    });
}
