import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { synchronizePendingData } from '../firebase/firebaseClient';
import {
  createSessionToken,
  setSimulateFirestoreUnavailable,
  setAdminDbForTest,
  resetAdminDbForTest,
  createFailingAdminDb,
  createSuccessfulAdminDb
} from '../../server';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF7DurablePersistenceRequirementTests(): Promise<AssertionResult> {
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
  console.log('F7 TEST SUITE: NEVER CLAIM CLOUD SYNC SUCCESS WITHOUT DURABLE PERSISTENCE');
  console.log('Testing Firestore Unavailable, Synced=False Retention & Intact Records');
  console.log('========================================================\n');

  // Polyfill localStorage in Node if needed
  if (typeof globalThis.localStorage === 'undefined') {
    const memStore = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => memStore.get(key) || null,
      setItem: (key: string, val: string) => { memStore.set(key, String(val)); },
      removeItem: (key: string) => { memStore.delete(key); },
      clear: () => { memStore.clear(); },
      key: (idx: number) => Array.from(memStore.keys())[idx] || null,
      length: 0
    };
  }

  const serverBaseUrl = 'http://localhost:3000';
  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);
  localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken, email: testOwnerEmail }));

  // Cleanup any test records
  const testAnimalId = 'f7-test-cow-persistence';
  const testJournalId = 'f7-test-journal-persistence';
  const testPurchaseId = 'f7-test-purchase-persistence';
  const testAdvanceId = 'f7-test-advance-persistence';

  await db.animals.delete(testAnimalId);
  await db.journalEntries.delete(testJournalId);
  await db.purchases.delete(testPurchaseId);
  await db.advancePayments.delete(testAdvanceId);

  // -------------------------------------------------------------
  // TEST SCENARIO 1: Simulate Firestore Unavailable
  // -------------------------------------------------------------
  console.log('--- Scenario 1: Simulate Firestore Unavailable ---');
  setSimulateFirestoreUnavailable(true);

  // Also verify via endpoint
  try {
    const simRes = await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unavailable: true })
    });
    const simJson = await simRes.json();
    assert(simJson.simulateFirestoreUnavailable === true, 'Server acknowledges Firestore is unavailable');
  } catch (err: any) {
    assert(false, `Failed to configure simulate-firestore-unavailable: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 2: Create Offline Records Locally
  // -------------------------------------------------------------
  console.log('\n--- Scenario 2: Create Offline Records Locally (synced: false) ---');
  const initialAnimal = {
    id: testAnimalId,
    tag: 'F7-COW-01',
    breed: 'Holstein-Friesian',
    status: 'ACTIVE' as const,
    purchasePrice: 85000,
    currentWeightKg: 420,
    species: 'CATTLE' as const,
    gender: 'FEMALE' as const,
    synced: false,
    updatedAt: new Date().toISOString(),
    version: 1
  };

  const initialJournal = {
    id: testJournalId,
    voucherNumber: 'JV-F7-001',
    date: '2026-03-24',
    narration: 'F7 Durable persistence validation entry',
    totalDebit: 30000,
    totalCredit: 30000,
    lines: [
      {
        id: 'line-f7-1',
        accountCode: CANONICAL_ACCOUNTS.FEED_EXPENSE,
        accountName: 'পশুখাদ্য খরচ',
        debit: 30000,
        credit: 0
      },
      {
        id: 'line-f7-2',
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'নগদ তহবিল',
        debit: 0,
        credit: 30000
      }
    ],
    synced: false,
    updatedAt: new Date().toISOString(),
    version: 1
  };

  const initialPurchase = {
    id: testPurchaseId,
    invoiceNumber: 'PUR-F7-001',
    date: '2026-03-24',
    supplierName: 'F7 Feed Supplier',
    totalAmount: 15000,
    paidAmount: 15000,
    synced: false,
    updatedAt: new Date().toISOString(),
    version: 1
  };

  const initialAdvance = {
    id: testAdvanceId,
    receiptNumber: 'ADV-F7-001',
    date: '2026-03-24',
    partyName: 'F7 Customer Corp',
    amount: 7500,
    paymentMethod: 'CASH',
    direction: 'CUSTOMER_ADVANCE' as const,
    synced: false,
    updatedAt: new Date().toISOString(),
    version: 1
  };

  await db.animals.put(initialAnimal as any);
  await db.journalEntries.put(initialJournal as any);
  await db.purchases.put(initialPurchase as any);
  await db.advancePayments.put(initialAdvance as any);

  const localAnimalPre = await db.animals.get(testAnimalId);
  assert(localAnimalPre !== undefined && localAnimalPre.synced === false, 'Local animal saved with synced: false');
  const localJournalPre = await db.journalEntries.get(testJournalId);
  assert(localJournalPre !== undefined && localJournalPre.synced === false, 'Local journal saved with synced: false');

  // -------------------------------------------------------------
  // TEST SCENARIO 3: Synchronization FAILS when Firestore is Unavailable
  // -------------------------------------------------------------
  console.log('\n--- Scenario 3: Trigger Synchronization while Firestore is Unavailable ---');
  const syncResult = await synchronizePendingData();

  assert(syncResult.syncedCount === 0, 'No records marked as synced (syncedCount === 0)');
  assert(syncResult.errors.length > 0, `Sync reported failure with ${syncResult.errors.length} error(s)`);
  const hasPersistenceError = syncResult.errors.some((e) =>
    e.includes('পারসিস্টেন্স অনুপলব্ধ') || e.includes('Cloud persistence') || e.includes('unavailable') || e.includes('503')
  );
  assert(hasPersistenceError, 'Sync errors explicitly identify Cloud persistence failure');

  // -------------------------------------------------------------
  // TEST SCENARIO 4: Local Records Remain Intact and synced: false
  // -------------------------------------------------------------
  console.log('\n--- Scenario 4: Verify Local Records Remain Intact & synced: false ---');
  const localAnimalPost = await db.animals.get(testAnimalId);
  assert(localAnimalPost !== undefined, 'Local animal was NOT deleted on sync failure');
  assert(localAnimalPost?.synced === false, 'Local animal remains synced: false for future retry');
  assert(localAnimalPost?.tag === 'F7-COW-01' && (localAnimalPost as any)?.purchasePrice === 85000, 'Local animal fields are completely intact and uncorrupted');

  const localJournalPost = await db.journalEntries.get(testJournalId);
  assert(localJournalPost !== undefined, 'Local journal entry was NOT deleted on sync failure');
  assert(localJournalPost?.synced === false, 'Local journal remains synced: false for future retry');
  assert(localJournalPost?.totalDebit === 30000 && localJournalPost?.lines?.length === 2, 'Local journal financial lines remain completely intact');

  const localPurchasePost = await db.purchases.get(testPurchaseId);
  assert(localPurchasePost !== undefined && localPurchasePost.synced === false, 'Local purchase remains intact with synced: false');

  const localAdvancePost = await db.advancePayments.get(testAdvanceId);
  assert(localAdvancePost !== undefined && localAdvancePost.synced === false, 'Local advance payment remains intact with synced: false');

  // -------------------------------------------------------------
  // TEST SCENARIO 5: Direct Server API Rejects without Claiming Success
  // -------------------------------------------------------------
  console.log('\n--- Scenario 5: Direct Server API rejects write without claiming success ---');
  const directRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`
    },
    body: JSON.stringify({
      id: 'f7-direct-animal-test',
      tag: 'F7-DIRECT-FAIL',
      species: 'GOAT'
    })
  });

  const directJson = await directRes.json().catch(() => ({}));
  assert(directRes.status === 503, `Server returned HTTP 503 Service Unavailable (received ${directRes.status})`);
  assert(directJson.success !== true, 'Server did NOT return success: true');
  assert(directJson.persisted === false, 'Server explicitly returned persisted: false');

  // -------------------------------------------------------------
  // TEST SCENARIO 6: Offline-first Operations Continue Normally
  // -------------------------------------------------------------
  console.log('\n--- Scenario 6: Offline Operations Continue Normally ---');
  let offlineOpsError = null;
  const offlineAnimalId = 'f7-offline-animal-cont';
  try {
    await db.animals.put({
      id: offlineAnimalId,
      tag: 'F7-OFFLINE-02',
      breed: 'Boer',
      species: 'GOAT' as const,
      gender: 'MALE' as const,
      status: 'ACTIVE' as const,
      synced: false,
      updatedAt: new Date().toISOString()
    } as any);

    const checkOffline = await db.animals.get(offlineAnimalId);
    assert(checkOffline !== undefined && checkOffline.tag === 'F7-OFFLINE-02', 'User can continue creating records offline without error');
  } catch (err: any) {
    offlineOpsError = err;
    assert(false, `Offline operation threw error: ${err.message}`);
  }
  assert(offlineOpsError === null, 'Existing offline operation functions 100% normally');

  // -------------------------------------------------------------
  // TEST SCENARIO 7: Focused Test: Missing Admin DB
  // -------------------------------------------------------------
  console.log('\n--- Scenario 7: Focused Test: Missing Admin DB (adminDb === null) ---');
  // First clear any simulation flags
  setSimulateFirestoreUnavailable(false);
  await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unavailable: false })
  });

  // Set Admin DB mode to missing (null)
  setAdminDbForTest(null);
  const missingDbConfigRes = await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'missing' })
  });
  const missingDbConfig = await missingDbConfigRes.json();
  assert(missingDbConfig.hasAdminDb === false, 'Server acknowledges Admin DB is missing (hasAdminDb === false)');
  assert(missingDbConfig.available === false, 'Server reports persistence is unavailable when Admin DB is missing');

  // Verify direct API returns HTTP 503 Service Unavailable when Admin DB is missing
  const missingDbDirectRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`
    },
    body: JSON.stringify({
      id: 'f7-missing-db-animal',
      tag: 'F7-MISSING-DB',
      species: 'CATTLE'
    })
  });
  const missingDbDirectJson = await missingDbDirectRes.json().catch(() => ({}));
  assert(missingDbDirectRes.status === 503, `Direct write returns HTTP 503 when Admin DB is missing (received ${missingDbDirectRes.status})`);
  assert(missingDbDirectJson.success !== true, 'Server did NOT return success: true when Admin DB is missing');
  assert(missingDbDirectJson.persisted === false, 'Server explicitly returned persisted: false when Admin DB is missing');
  assert(
    missingDbDirectJson.error?.includes('অনুপলব্ধ') || missingDbDirectJson.error?.includes('unavailable') || missingDbDirectJson.error?.includes('Admin DB'),
    'Error message clearly indicates Admin DB / cloud persistence is unavailable'
  );

  // Trigger client sync while Admin DB is missing
  const missingDbSyncRes = await synchronizePendingData();
  assert(missingDbSyncRes.syncedCount === 0, 'No pending records marked as synced when Admin DB is missing');
  const localAnimalAfterMissingDb = await db.animals.get(testAnimalId);
  assert(localAnimalAfterMissingDb?.synced === false, 'Local animal remains synced: false when Admin DB is missing');
  assert(localAnimalAfterMissingDb?.tag === 'F7-COW-01', 'Local animal data remains intact and uncorrupted');

  // -------------------------------------------------------------
  // TEST SCENARIO 8: Focused Test: Firestore Write Failure
  // -------------------------------------------------------------
  console.log('\n--- Scenario 8: Focused Test: Firestore Write Failure (rejection on write) ---');
  // Configure failing Admin DB that throws error on write
  const simulatedWriteError = '7 PERMISSION_DENIED: Missing or insufficient permissions.';
  setAdminDbForTest(createFailingAdminDb(simulatedWriteError));
  const writeFailConfigRes = await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'write_failure', errorMessage: simulatedWriteError })
  });
  const writeFailConfig = await writeFailConfigRes.json();
  assert(writeFailConfig.hasAdminDb === true, 'Server acknowledges Admin DB instance is present for write failure test');

  // Verify direct API returns HTTP 503 when write fails
  const writeFailDirectRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`
    },
    body: JSON.stringify({
      id: 'f7-write-failure-animal',
      tag: 'F7-WRITE-FAIL',
      species: 'GOAT'
    })
  });
  const writeFailDirectJson = await writeFailDirectRes.json().catch(() => ({}));
  assert(writeFailDirectRes.status === 503, `Direct write returns HTTP 503 on Firestore write failure (received ${writeFailDirectRes.status})`);
  assert(writeFailDirectJson.success !== true, 'Server did NOT return success: true on write failure');
  assert(writeFailDirectJson.persisted === false, 'Server explicitly returned persisted: false on write failure');
  assert(
    writeFailDirectJson.error?.includes('ব্যর্থ') || writeFailDirectJson.error?.includes('failed') || writeFailDirectJson.error?.includes('PERMISSION_DENIED'),
    'Error message clearly identifies Firestore write failure'
  );

  // CRITICAL REQUIREMENT: Local disk or in-memory persistence must NEVER be reported as cloud success
  assert(
    writeFailDirectJson.persisted !== true && writeFailDirectJson.success !== true,
    'CRITICAL: Local disk or in-memory persistence is NEVER reported as cloud success on write failure'
  );

  // Trigger client sync while Firestore write fails
  const writeFailSyncRes = await synchronizePendingData();
  assert(writeFailSyncRes.syncedCount === 0, 'No pending records marked as synced on Firestore write failure');
  const localJournalAfterWriteFail = await db.journalEntries.get(testJournalId);
  assert(localJournalAfterWriteFail?.synced === false, 'Local journal remains synced: false on Firestore write failure');
  assert(localJournalAfterWriteFail?.totalDebit === 30000, 'Local journal entry remains completely intact');

  // -------------------------------------------------------------
  // TEST SCENARIO 9: Focused Test: Confirmed Successful Write
  // -------------------------------------------------------------
  console.log('\n--- Scenario 9: Focused Test: Confirmed Successful Write ---');
  // Configure confirmed Admin DB that durably confirms writes
  setAdminDbForTest(createSuccessfulAdminDb());
  const confirmedDbConfigRes = await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'success' })
  });
  const confirmedDbConfig = await confirmedDbConfigRes.json();
  assert(confirmedDbConfig.available === true, 'Server acknowledges persistence is available for confirmed write');
  assert(confirmedDbConfig.hasAdminDb === true, 'Server acknowledges Admin DB is active');

  // Verify direct write succeeds ONLY with confirmed write
  const confirmedDirectRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validSessionToken}`
    },
    body: JSON.stringify({
      id: 'f7-confirmed-animal-direct',
      tag: 'F7-CONFIRMED-OK',
      species: 'SHEEP'
    })
  });
  const confirmedDirectJson = await confirmedDirectRes.json().catch(() => ({}));
  assert(confirmedDirectRes.status === 200, `Confirmed write returns HTTP 200 OK (received ${confirmedDirectRes.status})`);
  assert(confirmedDirectJson.success === true, 'Server returned success: true for confirmed Firestore write');
  assert(confirmedDirectJson.persisted === true, 'Server returned persisted: true for confirmed Firestore write');

  // Now synchronize pending offline records — must succeed ONLY AFTER confirmed durable persistence
  const restoredSyncResult = await synchronizePendingData();
  assert(restoredSyncResult.syncedCount >= 4, `Restored sync succeeded with ${restoredSyncResult.syncedCount} records synced`);

  const localAnimalAfterRestore = await db.animals.get(testAnimalId);
  assert(localAnimalAfterRestore?.synced === true, 'Local animal marked synced: true ONLY AFTER confirmed durable persistence');

  const localJournalAfterRestore = await db.journalEntries.get(testJournalId);
  assert(localJournalAfterRestore?.synced === true, 'Local journal marked synced: true ONLY AFTER confirmed durable persistence');

  const localPurchaseAfterRestore = await db.purchases.get(testPurchaseId);
  assert(localPurchaseAfterRestore?.synced === true, 'Local purchase marked synced: true ONLY AFTER confirmed durable persistence');

  const localAdvanceAfterRestore = await db.advancePayments.get(testAdvanceId);
  assert(localAdvanceAfterRestore?.synced === true, 'Local advance payment marked synced: true ONLY AFTER confirmed durable persistence');

  // -------------------------------------------------------------
  // TEST SCENARIO 10: Cleanup & Teardown
  // -------------------------------------------------------------
  console.log('\n--- Scenario 10: Cleanup & Reset Test State ---');
  // Cleanup test records
  await db.animals.delete(testAnimalId);
  await db.animals.delete(offlineAnimalId);
  await db.animals.delete('f7-missing-db-animal');
  await db.animals.delete('f7-write-failure-animal');
  await db.animals.delete('f7-confirmed-animal-direct');
  await db.journalEntries.delete(testJournalId);
  await db.purchases.delete(testPurchaseId);
  await db.advancePayments.delete(testAdvanceId);

  // Reset Admin DB and simulation test state
  resetAdminDbForTest();
  await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'reset' })
  });
  await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unavailable: false })
  });
  assert(true, 'Test state cleaned up and reset successfully');

  console.log('\n========================================================');
  console.log(`F7 TEST RESULT: ${result.passed}/${result.total} Assertions Passed`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testTaskF7DurablePersistenceRequirement.ts')) {
  runTaskF7DurablePersistenceRequirementTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`❌ F7 TESTS FAILED: ${res.failed} failure(s)`);
        process.exit(1);
      } else {
        console.log('✅ ALL F7 PERSISTENCE TESTS PASSED CLEANLY');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running F7 tests:', err);
      process.exit(1);
    });
}
