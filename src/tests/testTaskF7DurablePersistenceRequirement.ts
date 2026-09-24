import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { synchronizePendingData } from '../firebase/firebaseClient';
import { createSessionToken, setSimulateFirestoreUnavailable } from '../../server';
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
  assert(localAnimalPost?.tag === 'F7-COW-01' && localAnimalPost?.purchasePrice === 85000, 'Local animal fields are completely intact and uncorrupted');

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
  // TEST SCENARIO 7: When Cloud Persistence is Restored, Sync Succeeds Durably
  // -------------------------------------------------------------
  console.log('\n--- Scenario 7: When Cloud Persistence is Restored, Sync Succeeds Durably ---');
  setSimulateFirestoreUnavailable(false);
  await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unavailable: false })
  });

  const restoredSyncResult = await synchronizePendingData();
  assert(restoredSyncResult.syncedCount >= 4, `Restored sync succeeded with ${restoredSyncResult.syncedCount} records synced`);

  const localAnimalAfterRestore = await db.animals.get(testAnimalId);
  assert(localAnimalAfterRestore?.synced === true, 'Local animal marked synced: true ONLY AFTER confirmed durable persistence');

  const localJournalAfterRestore = await db.journalEntries.get(testJournalId);
  assert(localJournalAfterRestore?.synced === true, 'Local journal marked synced: true ONLY AFTER confirmed durable persistence');

  // Cleanup
  await db.animals.delete(testAnimalId);
  await db.animals.delete(offlineAnimalId);
  await db.journalEntries.delete(testJournalId);
  await db.purchases.delete(testPurchaseId);
  await db.advancePayments.delete(testAdvanceId);

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
