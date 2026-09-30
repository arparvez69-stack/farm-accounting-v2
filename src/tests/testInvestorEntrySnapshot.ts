import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  createInvestorEntrySnapshot,
  getInvestorEntrySnapshotById,
  getAllInvestorEntrySnapshots,
  getInvestorEntrySnapshotForDate,
  reverseInvestorEntrySnapshot,
  correctInvestorEntrySnapshot,
  updateInvestorEntrySnapshotDirectly,
  clearSnapshotsForTest,
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction
} from '../services/transactionService';
import { postJournalEntry, generateProfitLoss } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 8 — PRE-ENTRY CLOSING SNAPSHOT / INVESTOR ENTRY SNAPSHOT TESTS
 * Validates pre-entry snapshot creation before admitting a new investor:
 * - Establishes current business assets, liabilities, and net business value
 * - Establishes existing investor economic participation
 * - Establishes existing investment tranches
 * - Identifies pending transactions affecting valuation
 * - Guarantees the business year is NOT closed or deleted
 * - Guarantees normal annual P&L remains 100% intact
 * - Enforces immutability of finalized snapshots
 * - Verifies explicit audited correction and reversal workflows
 */
export async function runInvestorEntrySnapshotTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 8: INVESTOR ENTRY SNAPSHOT TESTS');
  console.log('Testing pre-entry closing snapshot, P&L integrity, & audited immutability');
  console.log('================================================================\n');

  clearSnapshotsForTest();
  const testUserId = 'snapshot_auditor_p8';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p8';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p8';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 200000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Set Up Initial Operational Farm Financials, Investors & Tranches
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting Up Accounting Baseline, Investors, & Tranches ---');

  // Existing Investor 1: Tariqul Islam (Capital ৳300,000 @ 30%)
  const invRes1 = await executeInvestorTransaction(
    {
      investorName: 'Tariqul Islam',
      phone: '01711000001',
      contribution: 300000,
      profitSharingRatio: 30,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-02-01',
      notes: 'Founding investor'
    },
    mDb
  );

  // Add Tranche 2 for Investor 1 (৳100,000 @ 25%)
  const trancheRes1B = await executeInvestmentTrancheTransaction(
    {
      investorId: invRes1.investor.id,
      investmentAmount: 100000,
      effectiveInvestmentDate: '2026-03-15',
      contractualProfitSharePercentage: 25,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      notes: 'Second capital injection'
    },
    mDb
  );

  // Existing Investor 2: Farhana Yasmin (Capital ৳200,000 @ 20%)
  const invRes2 = await executeInvestorTransaction(
    {
      investorName: 'Farhana Yasmin',
      phone: '01911000002',
      contribution: 200000,
      profitSharingRatio: 20,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      allowExceedingGlobal100: true,
      date: '2026-03-01',
      notes: 'Strategic expansion partner'
    },
    mDb
  );

  // Fixed Asset Purchase: Dr 1550 Machinery ৳250,000 | Cr 1030 Bank ৳250,000
  await postJournalEntry(
    {
      id: 'j_p8_01',
      voucherNumber: 'V-P8-01',
      voucherType: 'PAYMENT',
      date: '2026-03-20',
      narration: 'সেচ পাম্প ও জেনারেটর ক্রয়',
      lines: [
        { accountCode: '1550', accountName: 'যন্ত্রপাতি ও সরঞ্জাম', debit: 250000, credit: 0 },
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 250000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-03-20T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Feed Inventory on Credit: Dr 1051 ৳80,000 | Cr 2010 Accounts Payable ৳80,000
  await postJournalEntry(
    {
      id: 'j_p8_02',
      voucherNumber: 'V-P8-02',
      voucherType: 'PURCHASE',
      date: '2026-04-05',
      narration: 'বাকিতে পশুখাদ্য ক্রয়',
      lines: [
        { accountCode: '1051', accountName: 'মজুদ খাদ্য', debit: 80000, credit: 0 },
        { accountCode: '2010', accountName: 'প্রদেয় হিসাব', debit: 0, credit: 80000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-05T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Operational Sales Revenue: Dr 1010 Cash ৳120,000 | Cr 4010 Farm Revenue ৳120,000
  await postJournalEntry(
    {
      id: 'j_p8_03',
      voucherNumber: 'V-P8-03',
      voucherType: 'RECEIPT',
      date: '2026-04-10',
      narration: 'খামারের দুধ ও শাকসবজি বিক্রয়',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 120000, credit: 0 },
        { accountCode: '4010', accountName: 'খামার পণ্য বিক্রয় আয়', debit: 0, credit: 120000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-10T12:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Operational Expense: Dr 6110 Labor Expense ৳30,000 | Cr 1010 Cash ৳30,000
  await postJournalEntry(
    {
      id: 'j_p8_04',
      voucherNumber: 'V-P8-04',
      voucherType: 'PAYMENT',
      date: '2026-04-12',
      narration: 'খামার শ্রমিকদের দৈনিক মজুরি প্রদান',
      lines: [
        { accountCode: '6110', accountName: 'শ্রমিক মজুরি খরচ', debit: 30000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 30000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-12T15:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // One pending un-synced journal entry to test pending transactions capture
  const pendingJ = await postJournalEntry(
    {
      id: 'j_p8_pending_01',
      voucherNumber: 'V-P8-PEND',
      voucherType: 'JOURNAL',
      date: '2026-04-14',
      narration: 'পেন্ডিং রক্ষণাবেক্ষণ সমন্বয়',
      lines: [
        { accountCode: '6110', accountName: 'শ্রমিক মজুরি খরচ', debit: 5000, credit: 0 },
        { accountCode: '2020', accountName: 'বকেয়া খরচ', debit: 0, credit: 5000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-14T16:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  // Mark as unsynced
  await mDb.journalEntries.update(pendingJ.id, { synced: false });

  // Baseline P&L Check
  const pnlBeforeSnapshot = await generateProfitLoss(
    { startDate: '2026-01-01', endDate: '2026-04-15' },
    undefined,
    mDb
  );
  assert(pnlBeforeSnapshot.totalRevenue === 120000, 'Baseline P&L total revenue equals ৳120,000');
  assert(pnlBeforeSnapshot.netProfit === 85000, 'Baseline P&L net profit equals ৳85,000 (120k revenue - 35k expenses)');

  // Baseline Closed Period Check
  const closedPeriodsBefore = await mDb.closedPeriods.toArray();
  assert(closedPeriodsBefore.length === 0, 'Baseline: Zero closed periods exist before snapshot');

  // ---------------------------------------------------------------------------
  // STEP 2: Create Pre-Entry Closing Snapshot as of Agreed Effective Date
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Creating Pre-Entry Closing Snapshot ---');

  const snapshotDate = '2026-04-15';
  const snapshot = await createInvestorEntrySnapshot(
    {
      snapshotDate,
      responsibleUser: testUserId,
      notes: 'Pre-entry closing snapshot for admitting Series Seed-2 Partner'
    },
    mDb
  );

  assert(Boolean(snapshot.id), 'Snapshot created with unique ID');
  assert(snapshot.snapshotDate === snapshotDate, 'Snapshot records agreed effective date (2026-04-15)');
  assert(snapshot.status === 'FINALIZED', 'Snapshot status is FINALIZED');
  assert(snapshot.isImmutable === true, 'Snapshot is flagged as immutable');
  assert(snapshot.finalizedBy === testUserId, 'Snapshot records finalizing responsible user');
  assert(Boolean(snapshot.finalizedAt), 'Snapshot records finalized timestamp');

  // Verify Financial Position established
  assert(snapshot.currentBusinessAssets > 0, 'Snapshot establishes current business assets');
  assert(snapshot.currentLiabilities > 0, 'Snapshot establishes current liabilities');
  assert(
    snapshot.netBusinessValue === snapshot.currentBusinessAssets - snapshot.currentLiabilities,
    'Snapshot establishes net business value strictly as Assets - Liabilities'
  );
  assert(snapshot.assetBreakdown.length > 0, 'Snapshot includes itemized asset breakdown');
  assert(snapshot.liabilityBreakdown.length > 0, 'Snapshot includes itemized liability breakdown');

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Existing Investor Economic Participation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Existing Investor Economic Participation ---');

  assert(snapshot.existingInvestors.length === 2, 'Snapshot establishes exactly 2 existing investors');

  const inv1Snap = snapshot.existingInvestors.find((i) => i.investorId === invRes1.investor.id);
  assert(inv1Snap !== undefined, 'Investor 1 (Tariqul) captured in economic participation snapshot');
  assert(inv1Snap?.capitalContributed === 400000, 'Investor 1 total capital contributed establishes ৳400,000 (300k + 100k)');
  assert(inv1Snap?.currentCapitalBalance === 400000, 'Investor 1 current capital balance establishes ৳400,000');
  assert(inv1Snap?.profitSharingRatio === 30, 'Investor 1 profit-sharing ratio establishes 30%');
  assert(inv1Snap?.activeTrancheCount === 2, 'Investor 1 active tranche count establishes 2');

  const inv2Snap = snapshot.existingInvestors.find((i) => i.investorId === invRes2.investor.id);
  assert(inv2Snap !== undefined, 'Investor 2 (Farhana) captured in economic participation snapshot');
  assert(inv2Snap?.capitalContributed === 200000, 'Investor 2 total capital contributed establishes ৳200,000');
  assert(inv2Snap?.profitSharingRatio === 20, 'Investor 2 profit-sharing ratio establishes 20%');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Existing Investment Tranches
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Existing Investment Tranches Established ---');

  assert(snapshot.existingTranches.length === 3, 'Snapshot establishes exactly 3 existing investment tranches');

  const t1 = snapshot.existingTranches.find((t) => t.investorId === invRes1.investor.id && t.investmentAmount === 300000);
  assert(t1 !== undefined && t1.contractualProfitSharePercentage === 30, 'Tranche 1 established: ৳300,000 @ 30%');

  const t2 = snapshot.existingTranches.find((t) => t.trancheId === trancheRes1B.tranche.id);
  assert(t2 !== undefined && t2.investmentAmount === 100000 && t2.contractualProfitSharePercentage === 25, 'Tranche 2 established: ৳100,000 @ 25%');

  const t3 = snapshot.existingTranches.find((t) => t.investorId === invRes2.investor.id);
  assert(t3 !== undefined && t3.investmentAmount === 200000 && t3.contractualProfitSharePercentage === 20, 'Tranche 3 established: ৳200,000 @ 20%');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify Pending Transactions Affecting Valuation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying Pending Transactions Captured ---');

  assert(snapshot.hasPendingUnsynchronizedData === true, 'Snapshot flags pending un-synchronized data');
  assert(snapshot.pendingTransactions.length >= 1, 'Snapshot captures pending transactions list');
  const capturedPending = snapshot.pendingTransactions.find((p) => p.id === pendingJ.id);
  assert(capturedPending !== undefined, 'Pending journal entry specifically captured in pending transactions list');
  assert(capturedPending?.synced === false, 'Captured pending transaction marked as un-synced');

  // ---------------------------------------------------------------------------
  // STEP 6: Guarantees: Business Year NOT Closed & Normal P&L Remains Intact
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying Business Year Is NOT Closed & P&L Intact ---');

  // 1. Closed Periods must remain zero
  const closedPeriodsAfter = await mDb.closedPeriods.toArray();
  assert(
    closedPeriodsAfter.length === 0,
    'Business year is NOT closed: zero closed period records created'
  );

  // 2. Annual P&L must remain 100% intact
  const pnlAfterSnapshot = await generateProfitLoss(
    { startDate: '2026-01-01', endDate: '2026-04-15' },
    undefined,
    mDb
  );
  assert(
    pnlAfterSnapshot.totalRevenue === pnlBeforeSnapshot.totalRevenue,
    'Normal annual P&L revenue remains 100% intact after snapshot creation'
  );
  assert(
    pnlAfterSnapshot.totalOperatingExpenses === pnlBeforeSnapshot.totalOperatingExpenses,
    'Normal annual P&L expenses remain 100% intact after snapshot creation'
  );
  assert(
    pnlAfterSnapshot.netProfit === pnlBeforeSnapshot.netProfit,
    'Normal annual P&L net profit (৳85,000) remains completely intact (NOT wiped or closed)'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Snapshot Immutability & Audited Correction/Reversal
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Verifying Snapshot Immutability & Audited Reversal ---');

  // 1. Direct mutation attempt throws error
  let directUpdatePrevented = false;
  try {
    updateInvestorEntrySnapshotDirectly(snapshot.id, { netBusinessValue: 999999 });
  } catch (err: any) {
    directUpdatePrevented = true;
    assert(
      err.message.includes('অননুমোদিত পরিবর্তন') || err.message.includes('Immutable'),
      'Direct mutation rejected with explicit immutability error message'
    );
  }
  assert(directUpdatePrevented, 'Direct mutation on finalized snapshot is strictly rejected');

  // 2. Explicit Audited Reversal
  const reversedSnap = await reverseInvestorEntrySnapshot(
    snapshot.id,
    {
      reason: 'Auditor identified unbilled vendor invoice requiring correction',
      responsibleUser: testUserId
    },
    mDb
  );

  assert(reversedSnap.status === 'REVERSED', 'Audited reversal changes status to REVERSED');
  assert(
    reversedSnap.reversalReason === 'Auditor identified unbilled vendor invoice requiring correction',
    'Reversal records audited reversal reason'
  );
  assert(reversedSnap.reversedBy === testUserId, 'Reversal records responsible user');
  assert(Boolean(reversedSnap.reversedAt), 'Reversal records timestamp');
  assert(reversedSnap.auditTrail.action === 'INVESTOR_ENTRY_SNAPSHOT_REVERSED', 'Audit trail updated with reversal action');

  // 3. Double reversal is rejected
  let doubleReversalRejected = false;
  try {
    await reverseInvestorEntrySnapshot(snapshot.id, { reason: 'try again', responsibleUser: testUserId }, mDb);
  } catch {
    doubleReversalRejected = true;
  }
  assert(doubleReversalRejected, 'Double reversal on an already reversed snapshot is rejected');

  // 4. Audited Correction Workflow
  const freshSnapshot = await createInvestorEntrySnapshot(
    {
      snapshotDate: '2026-04-16',
      responsibleUser: testUserId,
      notes: 'Initial uncorrected snapshot'
    },
    mDb
  );

  const correctionOutcome = await correctInvestorEntrySnapshot(
    freshSnapshot.id,
    {
      reason: 'Adjusted effective valuation date to reflect agreed board meeting date',
      responsibleUser: testUserId,
      newSnapshotDate: '2026-04-17',
      notes: 'Corrected board date snapshot'
    },
    mDb
  );

  assert(correctionOutcome.originalSnapshot.status === 'REVERSED', 'Original snapshot status updated to REVERSED upon correction');
  assert(
    correctionOutcome.originalSnapshot.correctionReference === correctionOutcome.correctedSnapshot.id,
    'Reversed original links directly to corrected snapshot ID'
  );
  assert(
    correctionOutcome.correctedSnapshot.snapshotDate === '2026-04-17',
    'Corrected snapshot records new target date'
  );
  assert(
    correctionOutcome.correctedSnapshot.status === 'FINALIZED',
    'Corrected snapshot is established in FINALIZED status'
  );

  // ---------------------------------------------------------------------------
  // STEP 8: Query & Retrieval Functions
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 8: Query & Retrieval Functions ---');

  const retrievedSnap = await getInvestorEntrySnapshotById(freshSnapshot.id, mDb);
  assert(retrievedSnap !== null && retrievedSnap.id === freshSnapshot.id, 'getInvestorEntrySnapshotById retrieves snapshot');

  const dateSnap = await getInvestorEntrySnapshotForDate('2026-04-17', mDb);
  assert(dateSnap !== null && dateSnap.id === correctionOutcome.correctedSnapshot.id, 'getInvestorEntrySnapshotForDate retrieves active snapshot');

  const allSnaps = await getAllInvestorEntrySnapshots(mDb);
  assert(allSnaps.length >= 2, 'getAllInvestorEntrySnapshots returns complete list');

  console.log('\n================================================================');
  console.log(`PROMPT 8 INVESTOR ENTRY SNAPSHOT TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testInvestorEntrySnapshot.ts') || process.argv[1].endsWith('testInvestorEntrySnapshot.js'));

if (isDirectRun) {
  runInvestorEntrySnapshotTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Prompt 8 snapshot tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 8 snapshot tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 8 snapshot tests:', err);
      process.exit(1);
    });
}
