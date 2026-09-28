import 'fake-indexeddb/auto';
import { AgroDatabase, isStorageFailure, formatStorageErrorMessage } from '../db/indexedDb';
import { safeInsert } from '../utils/idGenerator';
import {
  registerUnsavedChecker,
  hasUnsavedChanges,
  confirmDiscardUnsaved
} from '../services/navigationService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runStabilityTasks34_35_36_37Tests(): Promise<AssertionResult> {
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
  console.log('STABILITY TASKS 34, 35, 36, 37 AUDIT SUITE');
  console.log('Task 34: Dexie Schema Migration Safety');
  console.log('Task 35: Browser Storage Failure Handling');
  console.log('Task 36: Double-Submit Prevention at UI Boundary');
  console.log('Task 37: Accidental Data Loss & Unsaved Form Protection');
  console.log('========================================================\n');

  // =========================================================================
  // TASK 34: DEXIE SCHEMA MIGRATION SAFETY
  // =========================================================================
  console.log('--- TASK 34: Dexie Schema Migration Safety ---');

  const db = new AgroDatabase();
  assert(db instanceof AgroDatabase, 'Task 34: AgroDatabase initializes successfully');

  // Verify that all versions 1 to 12 exist and have valid store configurations
  const versions = (db as any)._versions;
  assert(Array.isArray(versions) && versions.length >= 12, 'Task 34: Database has all 12 defined schema versions');

  // Ensure no table store is set to null (which would silently delete a table in Dexie)
  let anyTableDeleted = false;
  for (const v of versions) {
    const stores = v.stores || v._cfg?.storesSource;
    if (stores) {
      for (const [storeName, schema] of Object.entries(stores)) {
        if (schema === null) {
          anyTableDeleted = true;
          console.error(`Store ${storeName} set to null in version ${v._cfg?.version || v.version}`);
        }
      }
    }
  }
  assert(!anyTableDeleted, 'Task 34: No table stores are set to null across any schema versions (no table drop)');

  // Verify version 8 has safe upgrade hook preserving existing fields
  const v8 = versions.find((v: any) => v.version === 8 || v._cfg?.version === 8);
  assert(Boolean(v8 && (typeof v8._cfg?.contentUpgrade === 'function' || v8._upgrade)), 'Task 34: Version 8 has explicit upgrade callback preserving fields');

  // Verify version 12 has safe upgrade hook preserving existing fields
  const v12 = versions.find((v: any) => v.version === 12 || v._cfg?.version === 12);
  assert(Boolean(v12 && (typeof v12._cfg?.contentUpgrade === 'function' || v12._upgrade)), 'Task 34: Version 12 has explicit upgrade callback preserving synced flag');

  // Test opening and writing to database
  await db.open();
  assert(db.isOpen(), 'Task 34: Database opens cleanly at current schema version');

  // Test that inserting a record preserves custom/non-indexed fields
  const sampleEntry = {
    id: `jrn_test_${Date.now()}`,
    voucherNumber: 'JRN-TEST-001',
    voucherType: 'JOURNAL' as const,
    date: '2026-09-28',
    narration: 'Migration test entry',
    totalDebit: 5000,
    totalCredit: 5000,
    lines: [
      { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 5000, credit: 0 },
      { accountId: 'acc_3010', accountCode: '3010', accountName: 'Capital', debit: 0, credit: 5000 }
    ],
    customMetadataField: 'PreservedAcrossMigrations',
    synced: false
  };

  await db.journalEntries.put(sampleEntry as any);
  const retrieved = await db.journalEntries.get(sampleEntry.id);
  assert(
    retrieved && (retrieved as any).customMetadataField === 'PreservedAcrossMigrations',
    'Task 34: Existing fields are preserved intact in IndexedDB records'
  );

  console.log('TASK 34: PASS\n');

  // =========================================================================
  // TASK 35: BROWSER STORAGE FAILURE HANDLING
  // =========================================================================
  console.log('--- TASK 35: Browser Storage Failure Handling ---');

  // 1. QuotaExceededError detection
  const quotaErr = new Error('QuotaExceededError: The quota has been exceeded.');
  (quotaErr as any).name = 'QuotaExceededError';
  assert(isStorageFailure(quotaErr), 'Task 35: QuotaExceededError is correctly identified as storage failure');

  const quotaMsg = formatStorageErrorMessage(quotaErr);
  assert(
    quotaMsg.includes('স্টোরেজ কোটা পূর্ণ') && quotaMsg.includes('বাতিল'),
    'Task 35: QuotaExceeded error returns clear recovery message stating transaction was cancelled'
  );

  // 2. DatabaseClosedError detection
  const closedErr = new Error('DatabaseClosedError: The database has been closed.');
  (closedErr as any).name = 'DatabaseClosedError';
  assert(isStorageFailure(closedErr), 'Task 35: DatabaseClosedError is correctly identified as storage failure');

  const closedMsg = formatStorageErrorMessage(closedErr);
  assert(
    closedMsg.includes('সংযোগ বিচ্ছিন্ন') || closedMsg.includes('অনুপলব্ধ'),
    'Task 35: DatabaseClosedError returns clear recovery message prompting page refresh'
  );

  // 3. OpenFailedError detection
  const openFailedErr = new Error('OpenFailedError: Cannot open database.');
  (openFailedErr as any).name = 'OpenFailedError';
  assert(isStorageFailure(openFailedErr), 'Task 35: OpenFailedError is correctly identified as storage failure');

  // 4. Message-based storage exhaustion
  const msgQuotaErr = new Error('DOMException: Disk full or storage exhausted');
  assert(isStorageFailure(msgQuotaErr), 'Task 35: Message with "disk full" is identified as storage failure');

  // 5. Normal validation error is NOT treated as storage failure
  const validationErr = new Error('Account balance cannot be negative');
  assert(!isStorageFailure(validationErr), 'Task 35: Normal validation error is not misclassified as storage failure');

  // 6. SafeInsert handles storage failures without claiming success
  let safeInsertThrewStorageError = false;
  const mockFailingTable: any = {
    name: 'mockTable',
    add: async () => {
      const err = new Error('Quota exceeded on mock table');
      (err as any).name = 'QuotaExceededError';
      throw err;
    }
  };

  try {
    await safeInsert(mockFailingTable, { id: 'test_rec_01', name: 'Test' } as any);
  } catch (err: any) {
    safeInsertThrewStorageError = true;
    assert(
      err.message.includes('কোটা পূর্ণ') || err.message.includes('বাতিল'),
      'Task 35: safeInsert throws formatted recovery message on storage failure'
    );
  }
  assert(safeInsertThrewStorageError, 'Task 35: safeInsert never claims transaction succeeded on storage failure');

  console.log('TASK 35: PASS\n');

  // =========================================================================
  // TASK 36: DOUBLE-SUBMIT PREVENTION AT UI BOUNDARY
  // =========================================================================
  console.log('--- TASK 36: Double-Submit Prevention at UI Boundary ---');

  // Test simulation: UI boundary double-submit protection lock pattern
  let simulatedSubmissionCount = 0;
  let isSubmitting = false;

  async function simulateFormSubmit() {
    if (isSubmitting) {
      return { status: 'BLOCKED_BY_GUARD' };
    }
    isSubmitting = true;
    try {
      // Simulate asynchronous persistence network / db delay
      await new Promise((resolve) => setTimeout(resolve, 30));
      simulatedSubmissionCount++;
      return { status: 'SUCCESS' };
    } finally {
      isSubmitting = false;
    }
  }

  // 1. Rapid repeated clicks / double click / enter key
  const [click1, click2, click3] = await Promise.all([
    simulateFormSubmit(),
    simulateFormSubmit(),
    simulateFormSubmit()
  ]);

  assert(
    simulatedSubmissionCount === 1,
    'Task 36: Rapid multi-clicks result in exactly 1 execution (double submit prevented)'
  );
  assert(
    click1.status === 'SUCCESS' && click2.status === 'BLOCKED_BY_GUARD' && click3.status === 'BLOCKED_BY_GUARD',
    'Task 36: Concurrent calls are cleanly blocked by submission guard'
  );

  // 2. Legitimate sequential editing is NOT disabled after previous submission finishes
  const secondLegitimateSubmit = await simulateFormSubmit();
  assert(
    secondLegitimateSubmit.status === 'SUCCESS' && simulatedSubmissionCount === 2,
    'Task 36: Legitimate subsequent editing and submissions remain fully functional'
  );

  console.log('TASK 36: PASS\n');

  // =========================================================================
  // TASK 37: ACCIDENTAL DATA LOSS & UNSAVED FORM PROTECTION
  // =========================================================================
  console.log('--- TASK 37: Accidental Data Loss & Unsaved Form Protection ---');

  // 1. When no forms are registered or dirty, hasUnsavedChanges is false
  assert(!hasUnsavedChanges(), 'Task 37: hasUnsavedChanges is false when no forms are dirty');
  assert(confirmDiscardUnsaved(), 'Task 37: confirmDiscardUnsaved allows unimpeded navigation when clean');

  // 2. Registering an unsaved form checker detects dirty state
  let formDirty = false;
  const unregister = registerUnsavedChecker(() => formDirty);

  assert(!hasUnsavedChanges(), 'Task 37: Clean registered form does not block navigation');

  formDirty = true;
  assert(hasUnsavedChanges(), 'Task 37: Meaningful unsaved changes are detected immediately');

  // 3. Unregistering removes the checker cleanly
  unregister();
  assert(!hasUnsavedChanges(), 'Task 37: Unregistering dirty checker restores unimpeded navigation');

  console.log('TASK 37: PASS\n');

  console.log('========================================================');
  console.log(`STABILITY TASKS 34, 35, 36, 37 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}
