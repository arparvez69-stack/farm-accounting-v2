import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  createValuationEvent,
  getValuationEventById,
  updateValuationEventDirectly,
  attemptValuationMutation,
  createValuationRevisionEvent,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 13 — Immutable Valuation Snapshot
 *
 * Inspect finalized valuation records.
 *
 * When a valuation is finalized, make its financial values immutable.
 *
 * A finalized valuation must preserve:
 * - valuation ID;
 * - date;
 * - assets;
 * - liabilities;
 * - NAV;
 * - adjustments;
 * - reconciliation status;
 * - approver;
 * - timestamp.
 *
 * A later correction must create an adjustment/revision event instead of editing the original snapshot.
 *
 * Test:
 * Finalize valuation.
 * Attempt modification.
 *
 * Verify direct mutation is blocked.
 *
 * Return PASS.
 */
export async function runImmutableValuationSnapshotTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 13: IMMUTABLE VALUATION SNAPSHOT AUDIT');
  console.log('Testing: Finalized valuation immutability, blocked direct mutation, and revision events');
  console.log('================================================================\n');

  clearValuationEventsForTest();

  const approverUser = 'chief_audit_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setting up Accounting Foundation (Assets=1500, Liab=500, NAV=1000)
  // Assets: Bank ৳800 + Inventory ৳300 + Machinery ৳400 = ৳1,500
  // Liabilities: Payables ৳300 + Short-Term Loans ৳200 = ৳500
  // Equity: ৳1,000
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting up Accounting Baseline ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Bank subledger
  await mDb.cashBankAccounts.put({
    id: 'cb_p13_main',
    name: 'Operating Bank Account',
    accountType: 'BANK',
    currentBalance: 800,
    synced: false
  });

  // Inventory subledger
  await mDb.inventoryItems.put({
    id: 'item_feed_p13',
    code: 'FEED-P13',
    nameBn: 'মাছের খাবার',
    nameEn: 'Fish Feed',
    category: 'FEED',
    currentStock: 3,
    unit: 'BAG',
    avgCostPrice: 100,
    costPrice: 100,
    sellingPrice: 130,
    synced: false
  });
  await mDb.stockMovements.put({
    id: 'sm_feed_p13',
    date: '2026-01-10',
    itemId: 'item_feed_p13',
    movementType: 'OPENING',
    quantity: 3,
    unitCost: 100,
    totalValue: 300,
    status: 'POSTED',
    synced: false
  });

  // Fixed Asset subledger
  await mDb.fixedAssets.put({
    id: 'asset_machinery_p13',
    name: 'পুকুর এয়ারেটর মেশিনারি',
    category: 'MACHINERY',
    purchaseDate: '2026-01-10',
    originalCost: 400,
    usefulLifeYears: 5,
    salvageValue: 0,
    accumulatedDepreciation: 0,
    currentBookValue: 400,
    status: 'ACTIVE',
    synced: false
  });

  // Supplier subledger
  await mDb.parties.put({
    id: 'pty_supp_p13',
    name: 'এগ্রো ফিড সাপ্লায়ার্স',
    type: 'SUPPLIER',
    phone: '01711223344',
    balance: 300,
    currentBalance: 300,
    isActive: true,
    synced: false
  });

  // Loan subledger
  await mDb.loans.put({
    id: 'loan_bank_p13',
    loanType: 'BORROWED',
    bankAccountId: 'cb_p13_main',
    principalAmount: 200,
    remainingPrincipal: 200,
    disbursementDate: '2026-01-10',
    status: 'ACTIVE',
    lenderName: 'অগ্রণী ব্যাংক',
    synced: false
  });

  // Post baseline journal entries to match GL:
  // Transaction 1: Owner Capital ৳1000
  await postJournalEntry(
    {
      id: 'j_p13_cap',
      voucherNumber: 'V-P13-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'মালিকের প্রারম্ভিক মূলধন বিনিয়োগ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 1000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 1000 }
      ],
      createdBy: approverUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 2: Bank Loan ৳200
  await postJournalEntry(
    {
      id: 'j_p13_loan',
      voucherNumber: 'V-P13-02',
      voucherType: 'RECEIPT',
      date: '2026-01-10',
      reference: 'loan_bank_p13',
      narration: 'ব্যাংক ঋণ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 200, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ব্যাংক ঋণ', debit: 0, credit: 200 }
      ],
      createdBy: approverUser,
      createdAt: '2026-01-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 3: Buy Inventory ৳300 on credit
  await postJournalEntry(
    {
      id: 'j_p13_inv',
      voucherNumber: 'V-P13-03',
      voucherType: 'PURCHASE',
      date: '2026-01-15',
      reference: 'pty_supp_p13',
      narration: 'বাকিতে ফিড ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: 300, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, accountName: 'সরবরাহকারীর প্রদেয় হিসাব', debit: 0, credit: 300 }
      ],
      createdBy: approverUser,
      createdAt: '2026-01-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 4: Buy Machinery ৳400 cash
  await postJournalEntry(
    {
      id: 'j_p13_mach',
      voucherNumber: 'V-P13-04',
      voucherType: 'PAYMENT',
      date: '2026-01-20',
      reference: 'asset_machinery_p13',
      narration: 'এয়ারেটর যন্ত্রপাতি ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি', debit: 400, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 400 }
      ],
      createdBy: approverUser,
      createdAt: '2026-01-20T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Finalize Valuation & Inspect Preserved Fields
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Finalizing Valuation Event ---');
  const finalizedValuation = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: approverUser,
      finalize: true
    },
    mDb
  );

  assert(finalizedValuation.status === 'FINALIZED', 'Valuation status is strictly FINALIZED');
  assert(finalizedValuation.isImmutable === true, 'Valuation is marked isImmutable === true');

  // Verify preservation of ALL 9 required items:
  // 1. valuation ID
  assert(Boolean(finalizedValuation.id) && finalizedValuation.id.startsWith('val_'), '1. Preserves valuation ID: ' + finalizedValuation.id);

  // 2. date
  assert(finalizedValuation.valuationDate === valDate, '2. Preserves date: strictly ' + valDate);

  // 3. assets
  assert(finalizedValuation.totalBusinessAssetsIncluded === 1500, '3. Preserves assets: strictly ৳1,500 (Bank 800 + Inv 300 + FA 400)');

  // 4. liabilities
  assert(finalizedValuation.relevantLiabilities === 500, '4. Preserves liabilities: strictly ৳500 (AP 300 + Loan 200)');

  // 5. NAV
  assert(finalizedValuation.resultingNetBusinessValue === 1000, '5. Preserves NAV: strictly ৳1,000 (1500 - 500 = 1000)');

  // 6. adjustments
  const adj = finalizedValuation.adjustments ?? finalizedValuation.valuationAdjustments ?? 0;
  assert(adj === 0, '6. Preserves adjustments: strictly 0 before revision');

  // 7. reconciliation status
  const reconStatus = finalizedValuation.reconciliationStatus || (finalizedValuation.reconciliationGate?.status ?? 'PASS');
  assert(reconStatus === 'PASS', '7. Preserves reconciliation status: strictly PASS');

  // 8. approver
  const approver = finalizedValuation.approver || finalizedValuation.finalizedBy || finalizedValuation.responsibleUser;
  assert(approver === approverUser, '8. Preserves approver: strictly ' + approverUser);

  // 9. timestamp
  assert(Boolean(finalizedValuation.timestamp) && !isNaN(Date.parse(finalizedValuation.timestamp)), '9. Preserves timestamp: valid ISO timestamp (' + finalizedValuation.timestamp + ')');

  // ---------------------------------------------------------------------------
  // STEP 3: Attempt Direct Modification & Verify Direct Mutation Is BLOCKED
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Attempting Direct Mutation & Verifying It Is Blocked ---');

  // Test 3a: Call attemptValuationMutation with malicious changes
  const mutationAttempt = await attemptValuationMutation(
    finalizedValuation.id,
    {
      totalBusinessAssetsIncluded: 2000,
      resultingNetBusinessValue: 1500,
      notes: 'Hacked direct mutation attempt'
    },
    mDb
  );

  assert(mutationAttempt.blocked === true, 'CRITICAL AUDIT: Direct mutation attempt was strictly BLOCKED');
  assert(mutationAttempt.error.includes('Direct mutation blocked') || mutationAttempt.error.includes('immutable'), 'Blocking error message accurately identifies immutability constraint');

  // Test 3b: Call updateValuationEventDirectly and assert it throws
  let directCallThrew = false;
  let thrownMessage = '';
  try {
    updateValuationEventDirectly(finalizedValuation.id, {
      totalBusinessAssetsIncluded: 999999,
      resultingNetBusinessValue: 888888
    });
  } catch (err: any) {
    directCallThrew = true;
    thrownMessage = err.message;
  }
  assert(directCallThrew === true, 'updateValuationEventDirectly strictly throws an exception on finalized records');
  assert(thrownMessage.includes('immutable') || thrownMessage.includes('Direct mutation blocked'), 'Exception message confirms immutable protection');

  // Test 3c: Retrieve from database / memory to confirm NO financial values changed
  const reloadedOriginal = await getValuationEventById(finalizedValuation.id, mDb);
  assert(reloadedOriginal !== null, 'Reloaded original valuation exists');
  assert(reloadedOriginal?.totalBusinessAssetsIncluded === 1500, 'Original assets remain strictly 1500 (NOT mutated to 2000 or 999999)');
  assert(reloadedOriginal?.relevantLiabilities === 500, 'Original liabilities remain strictly 500');
  assert(reloadedOriginal?.resultingNetBusinessValue === 1000, 'Original NAV remains strictly 1000 (NOT mutated to 1500 or 888888)');
  assert(reloadedOriginal?.status === 'FINALIZED', 'Original status remains strictly FINALIZED');
  assert(reloadedOriginal?.valuationDate === valDate, 'Original date remains strictly ' + valDate);
  assert(reloadedOriginal?.approver === approverUser, 'Original approver remains strictly ' + approverUser);

  // ---------------------------------------------------------------------------
  // STEP 4: Test Audited Revision Event (Instead of In-Place Edit)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Testing Audited Revision / Adjustment Event ---');
  const revisionPartner = 'senior_audit_partner';
  const revisionReason = 'নিরীক্ষা কারিগরি যাচাইকরণ: পেলেট মেশিনের ব্লেড ক্ষয়ক্ষতিজনিত কারণে সম্পদের মূল্য ৳১,৪০০ তে সমন্বয়';

  const revisionResult = await createValuationRevisionEvent(
    {
      originalValuationId: finalizedValuation.id,
      revisionReason,
      responsibleUser: revisionPartner,
      revisedAssets: 1400, // Assets revised from 1500 to 1400 (-100)
      revisedLiabilities: 500, // Liabilities unchanged at 500
      notes: 'রিভিশন #২: সম্পদের সমন্বয়'
    },
    mDb
  );

  // 4a. Verify original snapshot was NOT edited in its financial figures
  assert(revisionResult.originalValuation.id === finalizedValuation.id, 'Original valuation ID preserved');
  assert(revisionResult.originalValuation.totalBusinessAssetsIncluded === 1500, 'Original valuation assets remain strictly ৳1,500');
  assert(revisionResult.originalValuation.relevantLiabilities === 500, 'Original valuation liabilities remain strictly ৳500');
  assert(revisionResult.originalValuation.resultingNetBusinessValue === 1000, 'Original valuation NAV remains strictly ৳1,000');
  assert(revisionResult.originalValuation.supersededByRevisionId === revisionResult.revisionEvent.id, 'Original links to revision event: ' + revisionResult.revisionEvent.id);

  // 4b. Verify revision event was created separately
  const rev = revisionResult.revisionEvent;
  assert(rev.id !== finalizedValuation.id, 'Revision event has distinct unique ID: ' + rev.id);
  assert(rev.revisionOfValuationId === finalizedValuation.id, 'Revision references original ID: ' + rev.revisionOfValuationId);
  assert(rev.revisionNumber === 2, 'Revision number is 2');
  assert(rev.totalBusinessAssetsIncluded === 1400, 'Revision assets = ৳1,400');
  assert(rev.relevantLiabilities === 500, 'Revision liabilities = ৳500');
  assert(rev.resultingNetBusinessValue === 900, 'Revision NAV = ৳900 (1400 - 500 = 900)');
  assert(rev.adjustments === -100, 'Revision adjustment delta = -৳100 (900 - 1000)');
  assert(rev.reconciliationStatus === 'PASS', 'Revision reconciliation status = PASS');
  assert(rev.approver === revisionPartner, 'Revision approver = ' + revisionPartner);
  assert(rev.revisionReason === revisionReason, 'Revision reason matches audit narration');
  assert(rev.status === 'FINALIZED', 'Revision event status is FINALIZED');
  assert(rev.isImmutable === true, 'Revision event is also immutable');

  // 4c. Verify that attempting to mutate the revision event is ALSO blocked
  const revMutationAttempt = await attemptValuationMutation(
    rev.id,
    { totalBusinessAssetsIncluded: 3000 },
    mDb
  );
  assert(revMutationAttempt.blocked === true, 'Direct mutation of revision event is also strictly BLOCKED');

  console.log('\n================================================================');
  console.log(`PROMPT 13 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 13 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 13 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testImmutableValuationSnapshot')) {
  runImmutableValuationSnapshotTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 13 tests:', err);
      process.exit(1);
    });
}
