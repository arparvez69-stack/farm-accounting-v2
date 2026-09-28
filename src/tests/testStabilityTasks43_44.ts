import 'fake-indexeddb/auto';
import http from 'http';
import { db } from '../db/indexedDb';
import {
  restoreRemoteDataIfLocalEmpty
} from '../firebase/firebaseClient';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  app,
  createSessionToken,
  setAdminDbForTest,
  resetAdminDbForTest,
  createFailingAdminDb,
  createSuccessfulAdminDb
} from '../../server';
import { Animal, JournalEntry } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runStabilityTasks43_44Tests(): Promise<AssertionResult> {
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
  console.log('STABILITY TASKS 43 & 44 AUDIT SUITE');
  console.log('Task 43: Verify Durable Cloud Write Success');
  console.log('Task 44: Firestore Restore Atomicity');
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

  // Ensure HTTP server is accessible
  let serverInstance: http.Server | null = null;
  let serverBaseUrl = 'http://localhost:3000';
  const originalPort = process.env.PORT;

  try {
    const healthCheck = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(1000) });
    if (!healthCheck.ok) throw new Error('Health check non-200');
  } catch {
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        const testPort = addr.port;
        serverBaseUrl = `http://127.0.0.1:${testPort}`;
        process.env.PORT = String(testPort);
        resolve();
      });
    });
  }

  try {
    const testOwnerEmail = 'atikurrahman00021@gmail.com';
    const validSessionToken = createSessionToken(testOwnerEmail);
    localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken, email: testOwnerEmail }));

    // =========================================================================
    // TASK 43: VERIFY DURABLE CLOUD WRITE SUCCESS
    // =========================================================================
    console.log('--- TASK 43: Verify Durable Cloud Write Success ---');

    // 1. Success path: When Firestore write succeeds, server returns success: true, persisted: true
    const testWriteAnimal = {
      id: `t43_animal_${Date.now()}`,
      tag: 'T43-COW-01',
      species: 'CATTLE',
      breed: 'Sahiwal',
      gender: 'FEMALE',
      birthDate: '2026-01-01',
      purchaseDate: '2026-02-15',
      purchaseCost: 95000,
      currentWeightKg: 380,
      status: 'ACTIVE',
      location: 'Shed 1',
      totalCost: 95000,
      version: 1
    };

    const successRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`,
        'x-test-admin-db-mode': 'success'
      },
      body: JSON.stringify(testWriteAnimal)
    });
    const successJson = await successRes.json().catch(() => ({}));
    assert(successRes.status === 200, 'Task 43: Server returns 200 when Firestore write succeeds');
    assert(successJson.success === true, 'Task 43: Response returns success=true on durable write');
    assert(successJson.persisted === true, 'Task 43: Response explicitly confirms persisted=true');

    // 2. Duplicate prevention (Idempotency): Resending identical payload returns idempotent response without duplicating writes
    const retryRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`,
        'x-test-admin-db-mode': 'success'
      },
      body: JSON.stringify(testWriteAnimal)
    });
    const retryJson = await retryRes.json().catch(() => ({}));
    assert(retryRes.status === 200, 'Task 43: Idempotent resend returns 200');
    assert(retryJson.idempotent === true, 'Task 43: Server recognizes identical data and flags idempotent=true without duplicate write');

    // 3. Failure path: When Firestore write fails, server must NEVER report persistence success
    const failAnimal = {
      id: `t43_fail_${Date.now()}`,
      tag: 'T43-FAIL-01',
      species: 'GOAT',
      breed: 'Jamnapari',
      gender: 'MALE',
      birthDate: '2026-01-01',
      purchaseDate: '2026-03-01',
      purchaseCost: 15000,
      currentWeightKg: 35,
      status: 'ACTIVE',
      location: 'Shed 2',
      totalCost: 15000
    };

    const failRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`,
        'x-test-admin-db-mode': 'write_failure',
        'x-test-write-error': 'Simulated Firestore unavailable disk error'
      },
      body: JSON.stringify(failAnimal)
    });
    const failJson = await failRes.json().catch(() => ({}));
    assert(failRes.status === 503, 'Task 43: Server returns 503 Service Unavailable when cloud write fails');
    assert(failJson.success === false, 'Task 43: Server does NOT report success=true on failed cloud write');
    assert(failJson.persisted === false, 'Task 43: Server explicitly reports persisted=false');
    assert(!failJson.idempotent, 'Task 43: Failed cloud write is not marked as idempotent success');

    // =========================================================================
    // TASK 44: FIRESTORE RESTORE ATOMICITY
    // =========================================================================
    console.log('\n--- TASK 44: Firestore Restore Atomicity ---');

    // Setup pristine baseline local database state
    await Promise.all(db.tables.map((t) => t.clear()));

    const baselineAnimal: Animal = {
      id: 't44_baseline_goat',
      tag: 'T44-BASE-01',
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'FEMALE',
      birthDate: '2025-01-01',
      purchaseDate: '2025-05-01',
      purchaseCost: 11000,
      currentWeightKg: 25,
      status: 'ACTIVE',
      location: 'Base Barn',
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 11000,
      synced: true,
      updatedAt: '2026-01-01T00:00:00Z'
    };

    const baselineJournal: JournalEntry = {
      id: 't44_baseline_journal',
      voucherNumber: 'JV-T44-BASE',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'Baseline entry',
      totalDebit: 11000,
      totalCredit: 11000,
      lines: [
        { id: 'l1', accountCode: '1010', accountName: 'Cash', debit: 11000, credit: 0 },
        { id: 'l2', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 11000 }
      ],
      synced: true,
      createdAt: '2026-01-01T00:00:00Z'
    };

    await db.animals.put(baselineAnimal);
    await db.journalEntries.put(baselineJournal);
    await db.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS.slice(0, 3));

    const preCountAnimals = await db.animals.count();
    const preCountJournals = await db.journalEntries.count();
    const preCountAccounts = await db.accounts.count();

    assert(preCountAnimals === 1, 'Task 44: Baseline local animals count is 1');
    assert(preCountJournals === 1, 'Task 44: Baseline local journals count is 1');
    assert(preCountAccounts === 3, 'Task 44: Baseline local accounts count is 3');

    // 1. Staging pre-validation rejects corrupted cloud data BEFORE any mutation
    const corruptedRemotePayload: Record<string, any[]> = {
      animals: [
        {
          id: 't44_cloud_cow_corrupt',
          tag: 'T44-CORRUPT-COW',
          species: 'CATTLE',
          breed: 'Sahiwal',
          gender: 'FEMALE',
          birthDate: '2025-01-01',
          purchaseDate: '2025-06-01',
          purchaseCost: 65000,
          currentWeightKg: 300,
          status: 'ACTIVE',
          location: 'Barn 2',
          totalCost: 65000
        }
      ],
      journalEntries: [
        {
          id: 't44_unbalanced_journal',
          voucherNumber: 'JV-CORRUPT-01',
          date: '2026-02-01',
          narration: 'Unbalanced corrupt entry',
          lines: [
            { accountCode: '1010', debit: 50000, credit: 0 },
            { accountCode: '3010', debit: 0, credit: 35000 } // Unbalanced!
          ]
        }
      ]
    };

    const corruptRestoreRes = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true, {
      mockRemoteCollections: corruptedRemotePayload
    });

    assert(corruptRestoreRes.restored === false, 'Task 44: Restore of corrupted cloud payload returns restored=false');

    // Verify baseline was NOT modified at all (atomicity preserved via staging validation)
    assert((await db.animals.count()) === 1, 'Task 44: Local animals preserved untouched after corrupt payload');
    assert((await db.journalEntries.count()) === 1, 'Task 44: Local journals preserved untouched after corrupt payload');
    assert((await db.animals.get('t44_cloud_cow_corrupt')) === undefined, 'Task 44: Corrupted cloud animal was NOT partially inserted');

    // 2. Mid-mutation failure triggers automatic rollback: Database is NOT left half-restored
    const validPartialPayload: Record<string, any[]> = {
      animals: [
        {
          id: 't44_staged_animal_1',
          tag: 'T44-STAGED-01',
          species: 'GOAT',
          breed: 'Jamnapari',
          gender: 'MALE',
          birthDate: '2025-01-01',
          purchaseDate: '2025-07-01',
          purchaseCost: 14000,
          currentWeightKg: 30,
          status: 'ACTIVE',
          location: 'Barn 3',
          totalCost: 14000
        }
      ],
      animalEvents: [
        {
          id: 'ev_t44_01',
          animalId: 't44_staged_animal_1',
          eventType: 'VACCINATION',
          date: '2026-03-01'
        }
      ]
    };

    const failureRes = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true, {
      mockRemoteCollections: validPartialPayload,
      simulateFailureAfterMutation: true,
      simulateFailureErrorMessage: 'Storage quota exceeded midway through cloud restore'
    });

    assert(failureRes.restored === false, 'Task 44: Restore returns false when mutation failure occurs');
    assert(failureRes.rollbackPerformed === true, 'Task 44: Automatic rollback was performed on mutation failure');

    // Verify that the local database is NOT half-restored: baseline snapshot was cleanly rolled back
    const postRollbackAnimals = await db.animals.count();
    const postRollbackJournals = await db.journalEntries.count();
    const postRollbackAccounts = await db.accounts.count();

    assert(postRollbackAnimals === 1, `Task 44: Animals count is restored to exact baseline (got ${postRollbackAnimals})`);
    assert(postRollbackJournals === 1, `Task 44: Journals count is restored to exact baseline (got ${postRollbackJournals})`);
    assert(postRollbackAccounts === 3, `Task 44: Accounts count is restored to exact baseline (got ${postRollbackAccounts})`);

    const stagedAnimalCheck = await db.animals.get('t44_staged_animal_1');
    assert(stagedAnimalCheck === undefined, 'Task 44: Staged animal was cleanly rolled back; database is not half-restored');

    const baselineAnimalCheck = await db.animals.get('t44_baseline_goat');
    assert(baselineAnimalCheck !== undefined && baselineAnimalCheck.tag === 'T44-BASE-01', 'Task 44: Baseline record remains completely intact');

    // 3. Clean restore succeeds and atomically updates records
    const cleanPayload: Record<string, any[]> = {
      animals: [
        {
          id: 't44_clean_animal_1',
          tag: 'T44-CLEAN-01',
          species: 'GOAT',
          breed: 'Boer',
          gender: 'FEMALE',
          birthDate: '2025-01-01',
          purchaseDate: '2025-07-01',
          purchaseCost: 18000,
          currentWeightKg: 40,
          status: 'ACTIVE',
          location: 'Barn 4',
          totalCost: 18000
        }
      ]
    };

    const cleanRes = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true, {
      mockRemoteCollections: cleanPayload
    });

    assert(cleanRes.restored === true, 'Task 44: Clean cloud restore executes with restored=true');
    assert((await db.animals.get('t44_clean_animal_1')) !== undefined, 'Task 44: Restored record exists in database');
    assert((await db.animals.count()) === 2, 'Task 44: Total animals count accurately accounts for restored record');
  } finally {
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as any).close(() => resolve()));
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      } else {
        delete process.env.PORT;
      }
    }
    resetAdminDbForTest();
  }

  console.log('\n========================================================');
  console.log(`STABILITY TASKS 43 & 44 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testStabilityTasks43_44.ts')) {
  runStabilityTasks43_44Tests().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
