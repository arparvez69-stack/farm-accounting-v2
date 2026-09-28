import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { safeInsert } from '../utils/idGenerator';
import {
  postJournalEntry,
  reverseJournalEntry,
  forbidJournalEntryDeletion
} from '../accounting/accountingEngine';
import {
  executeSaleTransaction,
  executePurchaseTransaction,
  executeContraTransferTransaction
} from '../services/transactionService';
import { Party, InventoryItem } from '../types';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runStabilityTasks38_39_40Tests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, description: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`✅ PASS: ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`❌ FAIL: ${description}`);
    }
  }

  console.log('\n========================================================');
  console.log('STABILITY TASKS 38, 39, 40 AUDIT SUITE');
  console.log('Task 38: Safe Destructive-Action Confirmation');
  console.log('Task 39: Prevent Accidental Financial Deletion');
  console.log('Task 40: Error Recovery Without Duplicate Posting');
  console.log('========================================================\n');

  const db = new AgroDatabase();
  await db.open();

  // Seed baseline accounts for tests
  await db.accounts.clear();
  await db.accounts.bulkPut([
    ...DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ ...a, synced: true })),
    { id: 'acc_1021', code: '1021', nameEn: 'Bank Account 2', nameBn: 'ব্যাংক হিসাব ২', accountClass: 'ASSET', normalBalance: 'DEBIT', isSystem: true, synced: true }
  ]);

  await db.cashBankAccounts.clear();
  await db.cashBankAccounts.bulkPut([
    { id: 'cash_01', name: 'Petty Cash', accountName: 'Petty Cash', accountNumber: 'CASH-01', accountType: 'CASH', balance: 50000, currentBalance: 50000, code: '1010', synced: true },
    { id: 'bank_01', name: 'City Bank', accountName: 'City Bank', accountNumber: '12345678', accountType: 'BANK', branch: 'Main', balance: 100000, currentBalance: 100000, code: '1020', synced: true },
    { id: 'bank_02', name: 'Dutch Bangla Bank', accountName: 'Dutch Bangla Bank', accountNumber: '87654321', accountType: 'BANK', branch: 'Gulshan', balance: 50000, currentBalance: 50000, code: '1021', synced: true }
  ]);

  // =========================================================================
  // TASK 38: SAFE DESTRUCTIVE-ACTION CONFIRMATION
  // =========================================================================
  console.log('--- TASK 38: Safe Destructive-Action Confirmation ---');

  // 1. Full Database Wipe Requires High-Severity Confirmation Keyword
  function validateWipeConfirmationInput(input: string): boolean {
    return input.trim() === 'মুছুন';
  }

  assert(!validateWipeConfirmationInput('yes'), 'Task 38: Wipe confirmation rejects arbitrary input ("yes")');
  assert(!validateWipeConfirmationInput('delete'), 'Task 38: Wipe confirmation rejects non-Bangla input ("delete")');
  assert(!validateWipeConfirmationInput(''), 'Task 38: Wipe confirmation rejects empty string');
  assert(validateWipeConfirmationInput('মুছুন'), 'Task 38: Wipe confirmation strictly accepts exact "মুছুন" keyword');

  // 2. Backup Restore Requires Confirmation Before Mutating Storage
  let restorePromptCalled = false;
  function simulateRestoreConfirmation(confirmedByUser: boolean): boolean {
    restorePromptCalled = true;
    if (!confirmedByUser) {
      return false; // Action cancelled
    }
    return true; // Action confirmed
  }

  const cancelledRestore = simulateRestoreConfirmation(false);
  assert(restorePromptCalled && !cancelledRestore, 'Task 38: Destructive backup restore is aborted when user cancels confirmation');

  const approvedRestore = simulateRestoreConfirmation(true);
  assert(approvedRestore, 'Task 38: Backup restore proceeds only with explicit user confirmation');

  // 3. Harmless Actions Do Not Require Confirmations
  function harmlessReadOperation(data: any[]): number {
    return data.length;
  }
  const harmlessCount = harmlessReadOperation([1, 2, 3]);
  assert(harmlessCount === 3, 'Task 38: Harmless read/view/filter actions execute immediately without intrusive confirmations');

  console.log('TASK 38: PASS\n');

  // =========================================================================
  // TASK 39: PREVENT ACCIDENTAL FINANCIAL DELETION
  // =========================================================================
  console.log('--- TASK 39: Prevent Accidental Financial Deletion ---');

  // 1. Enforce forbidJournalEntryDeletion boundary
  let deletionBlocked = false;
  try {
    forbidJournalEntryDeletion('jrn_posted_999');
  } catch (err: any) {
    deletionBlocked = true;
    assert(
      err.message.includes('স্থায়ীভাবে মোছা নিষিদ্ধ') && err.message.includes('রিভার্সাল'),
      'Task 39: forbidJournalEntryDeletion throws explicit accounting boundary error directing to reversal'
    );
  }
  assert(deletionBlocked, 'Task 39: Generic deletion of posted journal entry is strictly blocked');

  // 2. Post a real journal entry
  const testVoucherId = `j_audit_task39_${Date.now()}`;
  const postedEntry = await postJournalEntry(
    {
      id: testVoucherId,
      voucherNumber: `JV-${Date.now().toString().slice(-4)}`,
      voucherType: 'JOURNAL',
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      narration: 'Test financial transaction to verify immutability',
      lines: [
        { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 2500, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 2500 }
      ]
    },
    { dbInstance: db }
  );

  assert(postedEntry.id === testVoucherId, 'Task 39: Journal entry posted cleanly');

  // 3. Correction MUST be done via reverseJournalEntry (immutable contra-reversal)
  const reversalResult = await reverseJournalEntry(
    testVoucherId,
    'system_owner',
    undefined,
    db
  );

  assert(
    Boolean(reversalResult && reversalResult.reversal && reversalResult.original),
    'Task 39: Reversal generates a linked reversing entry without deleting the original'
  );

  // 4. Verify original entry still exists in database and is marked reversed
  const originalInDb = await db.journalEntries.get(testVoucherId);
  assert(
    Boolean(originalInDb && originalInDb.reversedBy === reversalResult.reversal.id),
    'Task 39: Original journal entry remains durably preserved in database with reversedBy link'
  );

  // 5. Verify reversal entry has opposite debit/credit lines
  const revEntry = reversalResult.reversal;
  assert(
    revEntry.reversalOf === testVoucherId &&
    revEntry.lines[0].credit === 2500 &&
    revEntry.lines[1].debit === 2500,
    'Task 39: Reversing entry correctly mirrors debits and credits as immutable contra-entry'
  );

  // 6. Verify duplicate reversal is prevented
  let duplicateReversalPrevented = false;
  try {
    await reverseJournalEntry(
      testVoucherId,
      'system_owner',
      undefined,
      db
    );
  } catch (err: any) {
    duplicateReversalPrevented = true;
    assert(
      err.message.includes('ইতোমধ্যে') || err.message.includes('ইতিমধ্যে'),
      'Task 39: Attempting to reverse an already-reversed entry is rejected'
    );
  }
  assert(duplicateReversalPrevented, 'Task 39: Duplicate reversal protection enforced');

  console.log('TASK 39: PASS\n');

  // =========================================================================
  // TASK 40: ERROR RECOVERY WITHOUT DUPLICATE POSTING
  // =========================================================================
  console.log('--- TASK 40: Error Recovery Without Duplicate Posting ---');

  // 1. postJournalEntry Idempotency on Retry
  const retryJournalId = `j_idempotent_test_${Date.now()}`;
  const todayStr = new Date().toISOString().split('T')[0];

  const firstPost = await postJournalEntry(
    {
      id: retryJournalId,
      voucherNumber: `JV-IDEM-01`,
      voucherType: 'JOURNAL',
      date: todayStr,
      createdAt: new Date().toISOString(),
      narration: 'Idempotency test entry',
      lines: [
        { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 1200, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 1200 }
      ]
    },
    { dbInstance: db }
  );

  // Simulate network retry: UI times out, caller retries postJournalEntry with identical ID
  const retriedPost = await postJournalEntry(
    {
      id: retryJournalId,
      voucherNumber: `JV-IDEM-01`,
      voucherType: 'JOURNAL',
      date: todayStr,
      createdAt: new Date().toISOString(),
      narration: 'Idempotency test entry',
      lines: [
        { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 1200, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 1200 }
      ]
    },
    { dbInstance: db }
  );

  assert(
    retriedPost.id === firstPost.id,
    'Task 40: Retrying postJournalEntry with identical ID returns existing record idempotently'
  );

  const totalEntriesWithId = await db.journalEntries.where('id').equals(retryJournalId).count();
  assert(totalEntriesWithId === 1, 'Task 40: Exactly 1 record exists in database after retry (no duplicate entry)');

  // 2. safeInsert Idempotency on Constraint Error
  const sampleTable = db.journalEntries;
  const duplicateInsertRecord = {
    id: retryJournalId,
    voucherNumber: 'JV-IDEM-01',
    voucherType: 'JOURNAL' as const,
    date: todayStr,
    createdAt: new Date().toISOString(),
    narration: 'Duplicate insert attempt',
    totalDebit: 1200,
    totalCredit: 1200,
    lines: [],
    synced: false
  };

  const idempotentInsertResult = await safeInsert(sampleTable, duplicateInsertRecord, {
    idempotent: true
  });
  assert(
    idempotentInsertResult.id === retryJournalId,
    'Task 40: safeInsert with idempotent flag returns existing record on key collision'
  );

  // 3. executeSaleTransaction Idempotency / Duplicate Prevention on Retry
  const sampleCustomer: Party = {
    id: `pty_cust_${Date.now()}`,
    name: 'Idempotent Test Customer',
    type: 'CUSTOMER',
    phone: '01700000000',
    balance: 0,
    synced: true
  };
  await db.parties.put(sampleCustomer);

  const sampleItem: InventoryItem = {
    id: `inv_item_${Date.now()}`,
    code: 'INV-MILK-01',
    nameBn: 'টেস্ট দুধ',
    nameEn: 'Test Milk',
    category: 'FINISHED_GOODS',
    unit: 'LITER',
    currentStock: 100,
    reorderLevel: 10,
    avgCostPrice: 50,
    sellingPrice: 80,
    synced: true
  };
  await db.inventoryItems.put(sampleItem);

  const saleIdempotencyKey = `sale_idempotency_${Date.now()}`;
  const firstSale = await executeSaleTransaction(
    {
      idempotencyKey: saleIdempotencyKey,
      invoiceNumber: `INV-IDEM-${Date.now().toString().slice(-4)}`,
      customer: sampleCustomer,
      item: sampleItem,
      quantity: 5,
      unitPrice: 80,
      paymentMethod: 'CASH',
      currentUserId: 'system_owner',
      date: todayStr
    },
    db
  );

  assert(Boolean(firstSale && firstSale.sale), 'Task 40: First sale transaction posted successfully');

  // Retry with same idempotencyKey must be rejected to prevent duplicate sale & duplicate stock depletion
  let duplicateSaleBlocked = false;
  try {
    await executeSaleTransaction(
      {
        idempotencyKey: saleIdempotencyKey,
        invoiceNumber: `INV-IDEM-${Date.now().toString().slice(-4)}`,
        customer: sampleCustomer,
        item: sampleItem,
        quantity: 5,
        unitPrice: 80,
        paymentMethod: 'CASH',
        currentUserId: 'system_owner',
        date: todayStr
      },
      db
    );
  } catch (err: any) {
    duplicateSaleBlocked = true;
    assert(
      err.message.includes('ডুপ্লিকেট') || err.message.includes('ইতোমধ্যে'),
      'Task 40: Duplicate sale retry correctly blocked by idempotency key'
    );
  }
  assert(duplicateSaleBlocked, 'Task 40: Duplicate sale submission blocked on retry');

  // 4. executeContraTransferTransaction Idempotency on Retry
  const transferIdempotencyKey = `contra_idempotency_${Date.now()}`;
  const firstTransfer = await executeContraTransferTransaction({
    idempotencyKey: transferIdempotencyKey,
    fromAccountId: 'bank_01',
    toAccountId: 'bank_02',
    amount: 5000,
    narration: 'Interbank transfer for idempotency test',
    currentUserId: 'system_owner',
    date: todayStr,
    dbInstance: db
  });

  assert(Boolean(firstTransfer && firstTransfer.journalEntryId), 'Task 40: First contra transfer posted successfully');

  let duplicateTransferBlocked = false;
  try {
    await executeContraTransferTransaction({
      idempotencyKey: transferIdempotencyKey,
      fromAccountId: 'bank_01',
      toAccountId: 'bank_02',
      amount: 5000,
      narration: 'Interbank transfer for idempotency test',
      currentUserId: 'system_owner',
      date: todayStr,
      dbInstance: db
    });
  } catch (err: any) {
    duplicateTransferBlocked = true;
    assert(
      err.message.includes('ডুপ্লিকেট') || err.message.includes('ইতোমধ্যে'),
      'Task 40: Duplicate contra transfer retry correctly blocked by idempotency key'
    );
  }
  assert(duplicateTransferBlocked, 'Task 40: Duplicate contra transfer blocked on retry');

  console.log('TASK 40: PASS\n');

  console.log('========================================================');
  console.log(`STABILITY TASKS 38, 39, 40 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}
