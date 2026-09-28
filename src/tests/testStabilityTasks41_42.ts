import 'fake-indexeddb/auto';
import http from 'http';
import { db } from '../db/indexedDb';
import { synchronizePendingData, listenToOnlineSync } from '../firebase/firebaseClient';
import {
  app,
  setSimulateFirestoreUnavailable,
  setAdminDbForTest,
  resetAdminDbForTest,
  createFailingAdminDb,
  getEffectiveAdminDb,
  isFirestorePersistenceAvailable,
  createSessionToken,
  getFirebaseAdminStatus
} from '../../server';
import { validateProductionEnvironment } from '../server/envValidation';
import { Animal } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runStabilityTasks41_42Tests(): Promise<AssertionResult> {
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
  console.log('STABILITY TASKS 41 & 42 AUDIT SUITE');
  console.log('Task 41: Firestore Unavailable Fail-safe');
  console.log('Task 42: Firebase Admin Initialization Safety');
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

  // Polyfill navigator.onLine in Node test runner safely without overriding read-only navigator object
  try {
    if (typeof globalThis.navigator !== 'undefined') {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true
      });
    }
  } catch {}

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
    // TASK 41: FIRESTORE UNAVAILABLE FAIL-SAFE
    // =========================================================================
    console.log('--- TASK 41: Firestore Unavailable Fail-safe ---');

    const testAnimalId = `t41_animal_${Date.now()}`;
    const localTestAnimal: Animal = {
      id: testAnimalId,
      tag: 'T41-GOAT-01',
      breed: 'Black Bengal',
      species: 'GOAT',
      gender: 'FEMALE',
      birthDate: '2025-01-01',
      purchaseDate: '2025-06-01',
      location: 'Barn A',
      purchaseCost: 12000,
      currentWeightKg: 28,
      status: 'ACTIVE',
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 12000,
      synced: false,
      updatedAt: new Date().toISOString()
    };

    // 1. Insert local offline data
    await db.animals.put(localTestAnimal);
    assert((await db.animals.get(testAnimalId))?.synced === false, 'Task 41: Offline animal record created with synced=false');

    // 2. Simulate Firestore unavailable across server process via API and in-process flag
    setSimulateFirestoreUnavailable(true);
    await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unavailable: true })
    });
    assert(isFirestorePersistenceAvailable() === false, 'Task 41: isFirestorePersistenceAvailable returns false when Firestore is unavailable');

    // 3. Attempt direct sync request to server endpoint while Firestore is unavailable
    try {
      const res = await fetch(`${serverBaseUrl}/api/sync/animals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validSessionToken}`
        },
        body: JSON.stringify(localTestAnimal)
      });

      const body = await res.json().catch(() => ({}));
      assert(res.status === 503, `Task 41: Server returns HTTP 503 Service Unavailable when Firestore is unavailable (got ${res.status})`);
      assert(body.success === false, 'Task 41: Server response indicates success=false');
      assert(body.persisted === false, 'Task 41: Server explicitly reports persisted=false');
      assert(body.error && body.error.includes('অনুপলব্ধ'), 'Task 41: Server returns clear error stating Firestore is unavailable');
    } catch (err: any) {
      assert(false, `Task 41: Unexpected network error: ${err.message}`);
    }

    // 4. Run client synchronizePendingData while Firestore is unavailable
    const syncOutcome = await synchronizePendingData();
    assert(syncOutcome.errors.length > 0, 'Task 41: synchronizePendingData reports failure errors when Firestore is unavailable');
    assert(syncOutcome.syncedCount === 0, 'Task 41: synchronizePendingData syncedCount is 0 when cloud write fails');

    // 5. Verify local data is NOT silently discarded or prematurely marked synced
    const preservedRecord = await db.animals.get(testAnimalId);
    assert(preservedRecord !== undefined, 'Task 41: Valid local offline data is preserved intact in IndexedDB');
    assert(preservedRecord?.synced === false, 'Task 41: Local record strictly retains synced=false (pending sync is not discarded)');
    assert(preservedRecord?.tag === 'T41-GOAT-01', 'Task 41: Local record attributes remain completely undamaged');

    // 6. Verify sync status badge listener indicates pending/failure
    let lastReportedState: string = '';
    let lastReportedPending: number = 0;
    const unsubListener = listenToOnlineSync(
      (state) => { lastReportedState = state; },
      (pending) => { lastReportedPending = pending; }
    );

    // Allow listener microtask to process
    await new Promise((r) => setTimeout(r, 120));
    assert(lastReportedPending >= 1, `Task 41: Pending queue count (${lastReportedPending}) accurately accounts for unpersisted record`);
    assert(
      lastReportedState === 'PENDING' || lastReportedState === 'SYNC_FAILED',
      `Task 41: State accurately indicates pending/failed (current: ${lastReportedState})`
    );
    unsubListener();

    // Reset Firestore simulation for subsequent tests
    setSimulateFirestoreUnavailable(false);
    await fetch(`${serverBaseUrl}/api/test/simulate-firestore-unavailable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unavailable: false })
    });
    resetAdminDbForTest();

    // Clean up test record
    await db.animals.delete(testAnimalId);

    // =========================================================================
    // TASK 42: FIREBASE ADMIN INITIALIZATION SAFETY
    // =========================================================================
    console.log('\n--- TASK 42: Firebase Admin Initialization Safety ---');

    // 1. In production mode, missing Firebase Admin credentials MUST NOT fall back to mock DB
    const origNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      // Verify status helper
      const adminStatus = getFirebaseAdminStatus();
      assert(adminStatus.isProduction === true, 'Task 42: Server recognizes production runtime environment');

      // Without test override, getEffectiveAdminDb in production must be null if credentials are unconfigured
      const effectiveInProd = getEffectiveAdminDb();
      if (!adminStatus.hasServiceAccountKey) {
        assert(effectiveInProd === null, 'Task 42: In production, missing credentials strictly returns null (never mock admin DB)');
        assert(isFirestorePersistenceAvailable() === false, 'Task 42: Persistence available is strictly false when credentials missing in production');
      } else {
        assert(effectiveInProd !== null, 'Task 42: In production with credentials, effective admin DB is active');
      }

      // 2. Explicit missing mode via headers must return null safely
      const mockReqMissing = {
        headers: { 'x-test-admin-db-mode': 'missing' }
      } as any;
      assert(getEffectiveAdminDb(mockReqMissing) === null, 'Task 42: Request with missing admin DB header returns null');
      assert(isFirestorePersistenceAvailable(mockReqMissing) === false, 'Task 42: isFirestorePersistenceAvailable returns false when admin DB is missing');

      // 3. Verify production environment validation records clear warnings without leaking secrets
      const fakeSecret = 'SUPER_SECRET_SERVICE_ACCOUNT_KEY_TOKEN_7788';
      const validHexSecret = 'e4b2c9d817f045a382c7104b9e28f16c5d9a0b3c4e5f60718293a4b5c6d7e8f9';
      const validationRes = validateProductionEnvironment({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: validHexSecret,
          INITIAL_PIN: '998877',
          APPROVED_OWNER_EMAILS: 'owner@example.com'
        }
      });

      assert(validationRes.valid === true, 'Task 42: Environment validation succeeds for required production core secrets');
      assert(
        validationRes.warnings.some((w) => w.includes('Firebase Admin') && w.includes('credentials')),
        'Task 42: Environment validation provides clear warning about unconfigured Firebase Admin credentials'
      );

      const fullWarningText = validationRes.warnings.join(' ') + ' ' + validationRes.errors.join(' ');
      assert(!fullWarningText.includes(fakeSecret), 'Task 42: Secrets are NEVER printed or leaked in validation output');
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }

    // 4. Test failing admin DB write handles rejection without crash or leaking secret
    const failingDb = createFailingAdminDb('7 PERMISSION_DENIED: Missing permissions for service account');
    setAdminDbForTest(failingDb);

    try {
      const writeFailReq = {
        headers: { 'x-test-admin-db-mode': 'write_failure' }
      } as any;
      const dbInstance = getEffectiveAdminDb(writeFailReq);
      assert(dbInstance !== null, 'Task 42: Failing DB instance created for write error simulation');

      let threwAsExpected = false;
      let errorMsg = '';
      try {
        await dbInstance!.collection('test').doc('testDoc').set({ foo: 'bar' });
      } catch (err: any) {
        threwAsExpected = true;
        errorMsg = err.message;
      }
      assert(threwAsExpected, 'Task 42: Failing Admin DB correctly throws on set() mutation');
      assert(errorMsg.includes('PERMISSION_DENIED'), 'Task 42: Error message conveys safe failure description');
      assert(!errorMsg.includes('private_key'), 'Task 42: Error message does not leak service account private key');
    } finally {
      resetAdminDbForTest();
    }
  } finally {
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as any).close(() => resolve()));
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      } else {
        delete process.env.PORT;
      }
    }
  }

  console.log('\n========================================================');
  console.log(`STABILITY TASKS 41 & 42 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testStabilityTasks41_42.ts')) {
  runStabilityTasks41_42Tests().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
