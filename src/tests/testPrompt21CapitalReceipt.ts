import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  createAdmissionRequest,
  getAdmissionRequestById,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
  executeAdmissionReview,
  executeAdmissionApproval,
  executeAdmissionCapitalReceipt,
  executeAdmissionFinalization,
  clearAdmissionRequestsForTest,
  inspectNewInvestorCapitalReceipt
} from '../services/admissionService';
import {
  executeInvestorTransaction,
  clearValuationEventsForTest
} from '../services/transactionService';
import { generateProfitLoss } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 21 — Capital Receipt
 *
 * Requirements:
 * Inspect new-investor capital receipt.
 * The investor's new capital contribution must:
 * - increase the appropriate asset/cash/bank account;
 * - increase participant capital/economic position;
 * - NOT become revenue;
 * - NOT become operating profit.
 *
 * The event must have an idempotency key.
 * Repeat the same capital receipt twice.
 * Verify only one economic/accounting contribution exists.
 * Return PASS.
 */
export async function runPrompt21CapitalReceiptTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 21: CAPITAL RECEIPT & IDEMPOTENCY');
  console.log('Invariant Rules:');
  console.log('  1. Increase appropriate asset/cash/bank account');
  console.log('  2. Increase participant capital/economic position');
  console.log('  3. NOT become revenue');
  console.log('  4. NOT become operating profit');
  console.log('  5. Event must have an idempotency key');
  console.log('  6. Repeat the same capital receipt twice -> only 1 contribution exists');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  const mDb = createMockAgroDatabase();

  // 1. Setup Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 2. Setup Bank Account
  const bankAccId = 'bank_main_p21';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Agrani Bank Farm Operating A/C',
    name: 'Agrani Bank Farm Operating A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const testUserId = 'auditor_prompt21';

  // ===========================================================================
  // STEP 1: Create & Approve New Investor Admission Request
  // ===========================================================================
  console.log('--- Step 1: Create & Approve Admission Request for New Investor ---');

  const req = await createAdmissionRequest(
    {
      investorName: 'Investor Delta',
      phone: '01711000004',
      proposedContribution: 1000,
      proposedProfitSharingRatio: 25,
      requestDate: '2026-07-01',
      currentUserId: testUserId,
      notes: 'New investor admission for Prompt 21 verification'
    },
    mDb
  );

  assert(req.status === 'REQUESTED', 'Admission request created with status REQUESTED');
  assert(req.stage === 'REQUEST', 'Admission request created in stage REQUEST');
  assert(req.proposedContribution === 1000, 'Proposed capital contribution is ৳1,000');

  // Reconciliation Gate
  await executeAdmissionReconciliation(
    req.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'Pre-admission audit gate PASS'
    },
    mDb
  );

  // Valuation Stage
  await executeAdmissionValuation(
    req.id,
    {
      responsibleUser: testUserId,
      overridePreMoney: 5000,
      finalizeValuation: true,
      notes: 'Finalized Pre-money NAV ৳5,000'
    },
    mDb
  );

  // Review & Approval
  await executeAdmissionReview(
    req.id,
    {
      reviewedBy: testUserId,
      approvedRecommendation: true,
      reviewNotes: 'Terms reviewed and verified'
    },
    mDb
  );

  await executeAdmissionApproval(
    req.id,
    {
      approvedBy: 'Managing Partner',
      decision: 'APPROVE',
      notes: 'Capital deposit authorized'
    },
    mDb
  );

  const approvedReq = (await mDb.admissionRequests?.get(req.id)) || (await (mDb as any).investorAdmissionRequests?.get(req.id)) || (await getAdmissionRequestById(req.id, mDb));
  assert(approvedReq.status === 'APPROVED', 'Request is APPROVED and ready for capital receipt');

  // Baseline Bank Balance before capital receipt
  const preBank = await mDb.cashBankAccounts.get(bankAccId);
  const preBalance = Number(preBank.currentBalance || 0);
  assert(preBalance === 0, 'Initial bank balance is ৳0');

  // Baseline Operating P&L before capital receipt
  const prePnl = await generateProfitLoss({ startDate: '2026-07-01', endDate: '2026-07-31' }, undefined, mDb);
  assert(prePnl.totalRevenue === 0, 'Initial revenue is ৳0');
  assert(prePnl.operatingProfit === 0, 'Initial operating profit is ৳0');
  assert(prePnl.netProfit === 0, 'Initial net profit is ৳0');

  // ===========================================================================
  // STEP 2: Execute Capital Receipt (1st Time) with Idempotency Key
  // ===========================================================================
  console.log('\n--- Step 2: Execute Capital Receipt (1st Time) with Idempotency Key ---');

  const idempotencyKey1 = 'IDEMP-CAP-REC-DELTA-001';

  const receipt1 = await executeAdmissionCapitalReceipt(
    req.id,
    {
      receivedAmount: 1000,
      targetAccountId: bankAccId,
      receiptDate: '2026-07-05',
      currentUserId: testUserId,
      notes: 'Initial capital receipt from Investor Delta',
      idempotencyKey: idempotencyKey1
    },
    mDb
  );

  assert(receipt1.status === 'CAPITAL_RECEIVED', 'Admission request status is CAPITAL_RECEIVED');
  assert(receipt1.capitalReceipt?.status === 'RECEIVED', 'capitalReceipt status is RECEIVED');
  assert(receipt1.capitalReceipt?.receivedAmount === 1000, 'capitalReceipt receivedAmount is ৳1,000');
  assert(
    receipt1.capitalReceipt?.idempotencyKey === idempotencyKey1,
    `capitalReceipt recorded idempotencyKey: ${idempotencyKey1}`
  );

  // Check 1: Appropriate asset/cash/bank account increased
  const postBank1 = await mDb.cashBankAccounts.get(bankAccId);
  const postBalance1 = Number(postBank1.currentBalance || 0);
  assert(
    postBalance1 === 1000,
    `Requirement 1: Target bank account balance increased from ৳0 to ৳1,000 (got ৳${postBalance1})`
  );

  // Check 2: Journal Entry details (Dr 1030 Bank, Cr 3020 Investor Capital)
  const allJournals1 = await mDb.journalEntries.toArray();
  const capReceiptJournals1 = allJournals1.filter(
    (j: any) =>
      j.status !== 'REVERSED' &&
      (j.idempotencyKey === idempotencyKey1 || j.reference === idempotencyKey1 || j.id === receipt1.capitalReceipt?.journalEntryId)
  );
  assert(capReceiptJournals1.length === 1, 'Exactly 1 journal entry posted for capital receipt');

  const entry1 = capReceiptJournals1[0];
  assert(entry1.voucherType === 'RECEIPT', 'Journal voucherType is RECEIPT');
  assert(entry1.idempotencyKey === idempotencyKey1, 'Journal entry preserves idempotencyKey');

  const bankLine1 = entry1.lines.find((l: any) => l.accountCode === '1030');
  const capitalLine1 = entry1.lines.find((l: any) => l.accountCode === '3020');
  assert(bankLine1 !== undefined, 'Journal entry has Dr 1030 (Bank) line');
  assert(bankLine1?.debit === 1000 && bankLine1?.credit === 0, 'Dr 1030 Bank is exactly ৳1,000');
  assert(capitalLine1 !== undefined, 'Journal entry has Cr 3020 (Investor Capital) line');
  assert(capitalLine1?.credit === 1000 && capitalLine1?.debit === 0, 'Cr 3020 Capital is exactly ৳1,000');

  // Check 3 & 4: NOT become revenue & NOT become operating profit
  const revenueLines1 = entry1.lines.filter((l: any) => l.accountCode?.startsWith('4'));
  const expenseLines1 = entry1.lines.filter((l: any) => l.accountCode?.startsWith('5'));
  assert(revenueLines1.length === 0, 'Requirement 3: Zero revenue lines in capital receipt entry');
  assert(expenseLines1.length === 0, 'Requirement 4: Zero expense lines in capital receipt entry');

  const pnlAfter1 = await generateProfitLoss({ startDate: '2026-07-01', endDate: '2026-07-31' }, undefined, mDb);
  assert(pnlAfter1.totalRevenue === 0, 'Requirement 3: Operating Revenue remains strictly ৳0');
  assert(pnlAfter1.operatingProfit === 0, 'Requirement 4: Operating Profit remains strictly ৳0');
  assert(pnlAfter1.netProfit === 0, 'Requirement 4: Net Profit remains strictly ৳0');

  // ===========================================================================
  // STEP 3: Repeat the Same Capital Receipt Twice (Idempotency Replay)
  // ===========================================================================
  console.log('\n--- Step 3: Repeat the Same Capital Receipt Twice (Idempotency Replay) ---');

  // Re-run the exact same call with the exact same idempotency key
  const receipt2 = await executeAdmissionCapitalReceipt(
    req.id,
    {
      receivedAmount: 1000,
      targetAccountId: bankAccId,
      receiptDate: '2026-07-05',
      currentUserId: testUserId,
      notes: 'Duplicate replay of capital receipt',
      idempotencyKey: idempotencyKey1
    },
    mDb
  );

  assert(receipt2 !== undefined, 'Second execution completes idempotently without unhandled crash');
  assert(receipt2.status === 'CAPITAL_RECEIVED', 'Status remains CAPITAL_RECEIVED');

  // Verify only ONE accounting / economic contribution exists:
  // 1. Verify journal entry count across database
  const allJournals2 = await mDb.journalEntries.toArray();
  const capReceiptJournals2 = allJournals2.filter(
    (j: any) =>
      j.status !== 'REVERSED' &&
      (j.idempotencyKey === idempotencyKey1 || j.reference === idempotencyKey1 || j.id === receipt1.capitalReceipt?.journalEntryId)
  );
  assert(
    capReceiptJournals2.length === 1,
    `CRITICAL PROMPT 21 REQUIREMENT: Exactly 1 journal entry exists after repeating receipt twice (got ${capReceiptJournals2.length})`
  );

  // 2. Verify bank account balance NOT doubled
  const postBank2 = await mDb.cashBankAccounts.get(bankAccId);
  const postBalance2 = Number(postBank2.currentBalance || 0);
  assert(
    postBalance2 === 1000,
    `CRITICAL PROMPT 21 REQUIREMENT: Bank account balance is ৳1,000 (NOT doubled to ৳2,000; got ৳${postBalance2})`
  );

  // 3. Verify revenue & operating profit still zero after replay
  const pnlAfter2 = await generateProfitLoss({ startDate: '2026-07-01', endDate: '2026-07-31' }, undefined, mDb);
  assert(pnlAfter2.totalRevenue === 0, 'Revenue remains strictly ৳0 after second call');
  assert(pnlAfter2.operatingProfit === 0, 'Operating profit remains strictly ৳0 after second call');
  assert(pnlAfter2.netProfit === 0, 'Net profit remains strictly ৳0 after second call');

  // ===========================================================================
  // STEP 4: Comprehensive Audit via inspectNewInvestorCapitalReceipt
  // ===========================================================================
  console.log('\n--- Step 4: Comprehensive Audit via inspectNewInvestorCapitalReceipt ---');

  const inspection = await inspectNewInvestorCapitalReceipt(
    {
      requestId: req.id,
      idempotencyKey: idempotencyKey1,
      expectedAmount: 1000,
      targetAccountId: bankAccId
    },
    mDb
  );

  assert(inspection.passed === true, 'inspectNewInvestorCapitalReceipt returned passed: true');
  assert(
    inspection.singleContributionVerified === true,
    'Inspection confirms singleContributionVerified: true (only one contribution exists)'
  );
  assert(inspection.assetIncreased === true, 'Inspection confirms assetIncreased: true');
  assert(inspection.capitalIncreased === true, 'Inspection confirms capitalIncreased: true');
  assert(inspection.revenueZero === true, 'Inspection confirms revenueZero: true');
  assert(inspection.operatingProfitZero === true, 'Inspection confirms operatingProfitZero: true');
  assert(inspection.journalEntryCount === 1, 'Inspection confirms journalEntryCount === 1');
  assert(inspection.totalDebitToAsset === 1000, 'Inspection confirms totalDebitToAsset === 1000');
  assert(inspection.totalCreditToEquity === 1000, 'Inspection confirms totalCreditToEquity === 1000');
  assert(inspection.totalCreditToRevenue === 0, 'Inspection confirms totalCreditToRevenue === 0');
  assert(inspection.operatingProfitImpact === 0, 'Inspection confirms operatingProfitImpact === 0');

  // ===========================================================================
  // STEP 5: Finalization & Active Economic Position Verification
  // ===========================================================================
  console.log('\n--- Step 5: Finalization & Economic Position Verification ---');

  const finalized = await executeAdmissionFinalization(
    req.id,
    {
      admissionDate: '2026-07-05',
      currentUserId: testUserId,
      contractualProfitSharePercentage: 25,
      notes: 'Finalizing admission for Investor Delta'
    },
    mDb
  );

  const finalInv = finalized.investor;
  assert(finalInv.status === 'ACTIVE', 'Investor is now ACTIVE');
  assert(
    (finalInv.capitalAmount || 0) === 1000,
    `Participant capital/economic position increased to ৳1,000 (got ৳${finalInv.capitalAmount})`
  );
  assert(
    (finalInv.capitalContributed || 0) === 1000,
    `Participant capitalContributed is ৳1,000 (got ৳${finalInv.capitalContributed})`
  );

  // ===========================================================================
  // STEP 6: Direct Investor Capital Transaction Idempotency Verification
  // ===========================================================================
  console.log('\n--- Step 6: Direct Investor Capital Transaction Idempotency ---');

  // Explicit test fixture: Valid admission request with finalized valuation
  await mDb.investorAdmissionRequests.put({
    id: 'adm_req_direct_alpha',
    investorName: 'Investor Direct Alpha',
    phone: '01711000005',
    status: 'APPROVED',
    isAdmitted: true,
    valuation: {
      status: 'FINALIZED',
      isFinalized: true,
      preMoneyValuation: 5000,
      postMoneyValuation: 5500,
      valuationDate: '2026-07-10'
    }
  });

  const directIdempKey = 'DIR-IDEMP-2026-999';
  const directTx1 = await executeInvestorTransaction(
    {
      investorName: 'Investor Direct Alpha',
      phone: '01711000005',
      contribution: 500,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-07-10',
      idempotencyKey: directIdempKey
    },
    mDb
  );

  assert(directTx1.investor !== undefined, 'Direct transaction 1 succeeds');
  const bankAfterDirect1 = await mDb.cashBankAccounts.get(bankAccId);
  assert(
    Number(bankAfterDirect1.currentBalance) === 1500,
    'Bank balance increased to ৳1,500 (1000 + 500)'
  );

  // Repeat direct transaction with same idempotency key
  const directTx2 = await executeInvestorTransaction(
    {
      investorName: 'Investor Direct Alpha',
      phone: '01711000005',
      contribution: 500,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-07-10',
      idempotencyKey: directIdempKey
    },
    mDb
  );

  assert(directTx2.journalEntryId === directTx1.journalEntryId, 'Repeated direct transaction returns existing journalEntryId');

  const bankAfterDirect2 = await mDb.cashBankAccounts.get(bankAccId);
  assert(
    Number(bankAfterDirect2.currentBalance) === 1500,
    'Bank balance remains ৳1,500 after repeated direct transaction (not doubled)'
  );

  const directInv = await mDb.investors.get(directTx1.investor.id);
  assert(
    (directInv?.capitalAmount || 0) === 500,
    'Direct investor capital position remains ৳500 (not doubled to ৳1,000)'
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 21 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log('STATUS: ' + (result.failed === 0 ? 'PASS' : 'FAIL'));
  console.log('================================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testPrompt21CapitalReceipt')) {
  runPrompt21CapitalReceiptTests()
    .then((r) => {
      process.exit(r.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test run failed:', err);
      process.exit(1);
    });
}
