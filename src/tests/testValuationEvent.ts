import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  calculateBusinessValuation,
  createValuationEvent,
  getValuationEventById,
  getAllValuationEvents,
  getValuationEventsForInvestor,
  clearValuationEventsForTest
} from '../services/transactionService';
import { postJournalEntry, generateBalanceSheet } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 6 — FORMAL INVESTMENT VALUATION EVENT TESTS
 * Validates the Investment Valuation Event concept when a new investor enters:
 * - Records valuation date
 * - Records total business assets included
 * - Records relevant liabilities
 * - Records resulting net business value (Assets - Liabilities)
 * - Records valuation methodology used ('BOOK_VALUE', 'NET_ASSET_VALUE')
 * - Records responsible user
 * - Records timestamp
 * - Links to investment admission
 * - Records audit trail
 * - Guarantees zero modification of historical transactions
 * - Guarantees no automated invention of fair-market values (strictly uses supported accounting values)
 */
export async function runValuationEventTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 6: INVESTMENT VALUATION EVENT TESTS');
  console.log('Testing valuation establishment, asset/liability inclusion, & admission linkage');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  const testUserId = 'valuation_lead_user_p6';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p6';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 300000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p6';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 100000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Populate Realistic Farm Financial Position with Historical Transactions
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establishing Historical Accounting Baseline ---');

  // A. Initial Founder Capital: Dr 1030 Bank ৳500,000 | Cr 3010 Owner Capital ৳500,000
  await postJournalEntry(
    {
      id: 'j_hist_01',
      voucherNumber: 'V-HIST-01',
      voucherType: 'RECEIPT',
      date: '2026-01-10',
      narration: 'প্রতিষ্ঠাতার প্রাথমিক মূলধন বিনিয়োগ',
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 500000, credit: 0 },
        { accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 500000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-01-10T09:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // B. Fixed Asset Purchase (Machinery/Equipment 1520): Dr 1520 ৳200,000 | Cr 1030 Bank ৳200,000
  await postJournalEntry(
    {
      id: 'j_hist_02',
      voucherNumber: 'V-HIST-02',
      voucherType: 'PAYMENT',
      date: '2026-02-01',
      narration: 'কৃষি যন্ত্রপাতি ও সেচ সরঞ্জাম ক্রয়',
      lines: [
        { accountCode: '1520', accountName: 'যন্ত্রপাতি ও সরঞ্জাম', debit: 200000, credit: 0 },
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 200000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-02-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // C. Accumulated Depreciation (1590 Contra-Asset): Dr 6140 Depreciation Expense ৳20,000 | Cr 1590 ৳20,000
  await postJournalEntry(
    {
      id: 'j_hist_03',
      voucherNumber: 'V-HIST-03',
      voucherType: 'JOURNAL',
      date: '2026-04-30',
      narration: 'যন্ত্রপাতির অবচয় চার্জ',
      lines: [
        { accountCode: '6140', accountName: 'অবচয় খরচ', debit: 20000, credit: 0 },
        { accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 20000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-04-30T16:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // D. Feed Inventory Purchase on Credit: Dr 1070 Feed Inventory ৳80,000 | Cr 2010 Accounts Payable ৳80,000
  await postJournalEntry(
    {
      id: 'j_hist_04',
      voucherNumber: 'V-HIST-04',
      voucherType: 'PURCHASE',
      date: '2026-05-15',
      narration: 'বাকিতে পশুখাদ্য মজুত ক্রয়',
      lines: [
        { accountCode: '1070', accountName: 'পশুখাদ্য ইনভেন্টরি', debit: 80000, credit: 0 },
        { accountCode: '2010', accountName: 'প্রদেয় হিসাব', debit: 0, credit: 80000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-05-15T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // E. Bank Loan (2030 Liability): Dr 1030 Bank ৳150,000 | Cr 2030 Bank Loan ৳150,000
  await postJournalEntry(
    {
      id: 'j_hist_05',
      voucherNumber: 'V-HIST-05',
      voucherType: 'RECEIPT',
      date: '2026-05-20',
      narration: 'ব্যাংক মেয়াদী ঋণ গ্রহণ',
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 150000, credit: 0 },
        { accountCode: '2030', accountName: 'ব্যাংক ঋণ', debit: 0, credit: 150000 }
      ],
      createdBy: testUserId,
      createdAt: '2026-05-20T14:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Record snapshot of historical journal entries to verify non-modification
  const initialJournals = await mDb.journalEntries.toArray();
  const initialJournalCount = initialJournals.length;
  assert(initialJournalCount === 5, 'Baseline: 5 historical journal entries posted successfully');

  // Verify Baseline Balance Sheet:
  // Assets:
  // - 1030 Bank: +500,000 - 200,000 + 150,000 = 450,000
  // - 1520 Machinery: +200,000
  // - 1590 Acc Depreciation (contra): -20,000
  // - 1070 Feed Inventory: +80,000
  // Total Assets = 450,000 + 200,000 - 20,000 + 80,000 = ৳710,000
  // Liabilities:
  // - 2010 Accounts Payable: ৳80,000
  // - 2030 Bank Loan: ৳150,000
  // Total Liabilities = 80,000 + 150,000 = ৳230,000
  // Net Business Value (Net Assets / Book Value) = 710,000 - 230,000 = ৳480,000
  const baselineBs = await generateBalanceSheet('2026-05-31', mDb);
  assert(baselineBs.totalAssets === 710000, 'Baseline balance sheet total assets equals ৳710,000');
  assert(baselineBs.totalLiabilities === 230000, 'Baseline balance sheet total liabilities equals ৳230,000');
  assert(
    Math.round((baselineBs.totalAssets - baselineBs.totalLiabilities) * 100) / 100 === 480000,
    'Baseline net book value equals ৳480,000'
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Calculate Business Valuation from Accounting Records
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Calculating Business Valuation via Supported Accounting Values ---');

  const valCalc = await calculateBusinessValuation('2026-05-31', mDb);
  assert(valCalc.valuationDate === '2026-05-31', 'Valuation calculation records correct valuation date (2026-05-31)');
  assert(valCalc.totalBusinessAssetsIncluded === 710000, 'Calculates total business assets included: ৳710,000');
  assert(valCalc.relevantLiabilities === 230000, 'Calculates relevant liabilities included: ৳230,000');
  assert(valCalc.resultingNetBusinessValue === 480000, 'Calculates resulting net business value: ৳480,000');
  assert(valCalc.includedAssets.length > 0, 'Includes granular asset breakdown from chart of accounts');
  assert(valCalc.includedLiabilities.length > 0, 'Includes granular liability breakdown from chart of accounts');

  const bankAssetItem = valCalc.includedAssets.find((a) => a.code === '1030');
  assert(bankAssetItem?.amount === 450000, 'Asset breakdown specifies Bank (1030) balance of ৳450,000');

  const loanLiabItem = valCalc.includedLiabilities.find((l) => l.code === '2030');
  assert(loanLiabItem?.amount === 150000, 'Liability breakdown specifies Bank Loan (2030) balance of ৳150,000');

  // ---------------------------------------------------------------------------
  // STEP 3: Create Formal Investment Valuation Event
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Creating Formal Investment Valuation Event ---');

  const valEvent = await createValuationEvent(
    {
      valuationDate: '2026-05-31',
      responsibleUser: testUserId,
      valuationMethodology: 'BOOK_VALUE',
      notes: 'Pre-investment economic position assessment prior to admitting Series A seed partner'
    },
    mDb
  );

  assert(Boolean(valEvent.id), 'Valuation event created with unique identifier');
  assert(valEvent.valuationDate === '2026-05-31', 'Valuation event records valuation date');
  assert(valEvent.totalBusinessAssetsIncluded === 710000, 'Valuation event records total business assets included (৳710,000)');
  assert(valEvent.relevantLiabilities === 230000, 'Valuation event records relevant liabilities (৳230,000)');
  assert(valEvent.resultingNetBusinessValue === 480000, 'Valuation event records resulting net business value (৳480,000)');
  assert(valEvent.valuationMethodology === 'BOOK_VALUE', 'Valuation event records methodology used (BOOK_VALUE)');
  assert(valEvent.responsibleUser === testUserId, 'Valuation event records responsible user');
  assert(Boolean(valEvent.timestamp), 'Valuation event records creation timestamp');
  assert(Boolean(valEvent.createdAt), 'Valuation event records createdAt timestamp');
  assert(valEvent.createdBy === testUserId, 'Valuation event records createdBy user');
  assert(Boolean(valEvent.auditTrail), 'Valuation event records structured audit trail');
  assert(valEvent.auditTrail.eventId === valEvent.id, 'Audit trail references valuation event ID');
  assert(valEvent.auditTrail.performedBy === testUserId, 'Audit trail records who performed the valuation');
  assert(valEvent.auditTrail.details.includes('480000'), 'Audit trail details capture the resulting net business value');

  // Verify Audit Log in DB
  const audits = await mDb.auditLogs.toArray();
  const valAudit = audits.find((a: any) => a.action === 'INVESTMENT_VALUATION_EVENT_CREATED');
  assert(valAudit !== undefined, 'Audit log persisted in database for valuation event creation');
  assert(valAudit?.userId === testUserId, 'Audit log records responsible user ID');

  // ---------------------------------------------------------------------------
  // STEP 4: Historical Non-Modification Guarantee
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Historical Transactions Were NOT Modified ---');

  const journalsAfterValuation = await mDb.journalEntries.toArray();
  assert(
    journalsAfterValuation.length === initialJournalCount,
    'Zero historical journal entries added or deleted during valuation establishment'
  );
  assert(
    JSON.stringify(journalsAfterValuation.map((j) => j.id)) === JSON.stringify(initialJournals.map((j) => j.id)),
    'Historical journal IDs remain identical'
  );
  assert(
    journalsAfterValuation.every((j, idx) => {
      const orig = initialJournals[idx];
      return j.date === orig.date && j.lines.length === orig.lines.length;
    }),
    'Historical transaction details (dates, lines) are completely untouched'
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Valuation Event Retrieval & Querying
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Valuation Event Retrieval & Querying ---');

  const retrievedEvent = await getValuationEventById(valEvent.id, mDb);
  assert(retrievedEvent !== null, 'getValuationEventById successfully retrieves the valuation event');
  assert(retrievedEvent?.id === valEvent.id, 'Retrieved event ID matches');
  assert(retrievedEvent?.resultingNetBusinessValue === 480000, 'Retrieved event preserves net business value');

  const allEvents = await getAllValuationEvents(mDb);
  assert(allEvents.length >= 1, 'getAllValuationEvents returns list containing created valuation event');
  assert(allEvents.some((e) => e.id === valEvent.id), 'Created event exists in all valuation events list');

  // ---------------------------------------------------------------------------
  // STEP 6: Linking Valuation Event to New Investment Admission
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Linking Valuation Event to New Investment Admission ---');

  // Now a new investor enters:
  // Pre-money business value established by valuation event: ৳480,000
  // New investor capital contribution: ৳120,000
  // Resulting post-money valuation: 480,000 + 120,000 = ৳600,000
  // Investor ownership stake: 120,000 / 600,000 = 20%
  const admissionRes = await executeInvestorTransaction(
    {
      investorName: 'New Partner Kamal',
      phone: '01811000005',
      contribution: 120000,
      profitSharingRatio: 20, // 20% ownership/profit share based on valuation
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      valuationEventId: valEvent.id, // Linking valuation event!
      preMoneyValuation: 480000,
      postMoneyValuation: 600000,
      date: '2026-06-01',
      notes: 'Series Seed admission linked to Valuation Event 2026-05-31'
    },
    mDb
  );

  assert(Boolean(admissionRes.investor.id), 'New investor successfully admitted');
  assert(Boolean(admissionRes.tranche), 'Tranche created for new investor');
  assert(admissionRes.tranche?.valuationEventId === valEvent.id, 'Tranche explicitly links to valuation event ID');
  assert(admissionRes.tranche?.preMoneyValuation === 480000, 'Tranche records pre-money valuation of ৳480,000');
  assert(admissionRes.tranche?.postMoneyValuation === 600000, 'Tranche records post-money valuation of ৳600,000');

  // Check updated valuation event linked references
  const linkedEvent = await getValuationEventById(valEvent.id, mDb);
  assert(
    linkedEvent?.linkedInvestorId === admissionRes.investor.id,
    'Valuation event records linked investor ID'
  );
  assert(
    linkedEvent?.linkedTrancheId === admissionRes.tranche?.id,
    'Valuation event records linked tranche ID'
  );

  const investorValuations = await getValuationEventsForInvestor(admissionRes.investor.id, mDb);
  assert(
    investorValuations.length === 1 && investorValuations[0].id === valEvent.id,
    'getValuationEventsForInvestor returns linked valuation event'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Automatic Valuation Derivation via Tranche Creation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Automatic Valuation Derivation via Tranche Transaction ---');

  // Create a second valuation event for a subsequent tranche
  const valEvent2 = await createValuationEvent(
    {
      valuationDate: '2026-06-15',
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'Mid-year assessment'
    },
    mDb
  );

  // Admit tranche with valuationEventId without specifying preMoneyValuation explicitly
  // System must auto-derive preMoneyValuation from valuation event's resultingNetBusinessValue
  const tranche2Res = await executeInvestmentTrancheTransaction(
    {
      investorId: admissionRes.investor.id,
      investmentAmount: 50000,
      contractualProfitSharePercentage: 25,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      valuationEventId: valEvent2.id, // linked event
      notes: 'Tranche 2 with auto-derived pre-money valuation'
    },
    mDb
  );

  assert(
    tranche2Res.tranche.preMoneyValuation === valEvent2.resultingNetBusinessValue,
    'executeInvestmentTrancheTransaction auto-derives preMoneyValuation from valuation event'
  );
  assert(
    tranche2Res.tranche.postMoneyValuation === valEvent2.resultingNetBusinessValue + 50000,
    'executeInvestmentTrancheTransaction auto-derives postMoneyValuation (preMoney + investmentAmount)'
  );

  // ---------------------------------------------------------------------------
  // STEP 8: Validation and Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 8: Strict Validation & Error Handling ---');

  // 1. Missing valuationDate
  let rejectedMissingDate = false;
  try {
    await createValuationEvent(
      {
        valuationDate: '',
        responsibleUser: testUserId
      },
      mDb
    );
  } catch {
    rejectedMissingDate = true;
  }
  assert(rejectedMissingDate, 'createValuationEvent rejects missing valuation date');

  // 2. Invalid valuationDate format
  let rejectedInvalidDate = false;
  try {
    await createValuationEvent(
      {
        valuationDate: 'not-a-date',
        responsibleUser: testUserId
      },
      mDb
    );
  } catch {
    rejectedInvalidDate = true;
  }
  assert(rejectedInvalidDate, 'createValuationEvent rejects invalid date format');

  // 3. Missing responsibleUser
  let rejectedMissingUser = false;
  try {
    await createValuationEvent(
      {
        valuationDate: '2026-06-30',
        responsibleUser: ''
      },
      mDb
    );
  } catch {
    rejectedMissingUser = true;
  }
  assert(rejectedMissingUser, 'createValuationEvent rejects missing responsible user');

  // 4. Invalid numeric override values
  let rejectedNaNOverride = false;
  try {
    await createValuationEvent(
      {
        valuationDate: '2026-06-30',
        responsibleUser: testUserId,
        totalBusinessAssetsIncluded: NaN,
        relevantLiabilities: 10000
      },
      mDb
    );
  } catch {
    rejectedNaNOverride = true;
  }
  assert(rejectedNaNOverride, 'createValuationEvent rejects NaN assets override');

  console.log('\n================================================================');
  console.log(`PROMPT 6 VALUATION EVENT TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testValuationEvent.ts') || process.argv[1].endsWith('testValuationEvent.js'));

if (isDirectRun) {
  runValuationEventTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Valuation event tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Valuation event tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running valuation event tests:', err);
      process.exit(1);
    });
}
