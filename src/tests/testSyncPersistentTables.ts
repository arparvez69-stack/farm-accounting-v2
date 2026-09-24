import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import {
  synchronizePendingData,
  listenToOnlineSync,
  restoreRemoteDataIfLocalEmpty
} from '../firebase/firebaseClient';
import { app, createSessionToken, inMemoryStores } from '../../server';
import { SalesReturn, PurchaseReturn, AdvancePayment } from '../types';
import http from 'http';

interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runSyncPersistentTablesTests(): Promise<AssertionResult> {
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
  console.log('F2 TEST SUITE: SYNC & RESTORE ALL PERSISTENT FINANCIAL TABLES');
  console.log('Validating salesReturns, purchaseReturns, advancePayments & All Tables');
  console.log('========================================================\n');

  // Setup localStorage polyfill if needed in Node
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

  // Ensure server is accessible
  let serverInstance: http.Server | null = null;
  let testPort = 3000;
  try {
    const healthCheck = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(1000) });
    if (!healthCheck.ok) throw new Error('Health check non-200');
  } catch {
    // If not running on 3000, start ephemeral server on dynamic port
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        testPort = addr.port;
        process.env.PORT = String(testPort);
        resolve();
      });
    });
  }

  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);

  try {
    // ----------------------------------------------------
    // TEST 1: Pending Detection for Returns and Advances
    // ----------------------------------------------------
    console.log('--- TEST 1: Pending Detection for Returns & Advances ---');

    const testId = `sync_test_${Date.now()}`;

    const offlineSalesReturn: SalesReturn = {
      id: `sr_${testId}`,
      returnNumber: `SR-TEST-${testId}`,
      saleId: `sale_${testId}`,
      customerId: `cust_${testId}`,
      customerName: 'Karim Ahmed',
      date: '2026-09-24',
      items: [
        {
          itemId: `item_dairy_${testId}`,
          itemName: 'Organic Dairy Milk 1L',
          returnedQuantity: 5,
          unitPrice: 100,
          lineTotal: 500,
          cogsAmount: 350,
          reason: 'Packaging seal broken'
        }
      ],
      totalRefundAmount: 500,
      totalCogsReversed: 350,
      refundMethod: 'ADJUST_DUE',
      journalEntryId: `jnl_sr_${testId}`,
      idempotencyKey: `idem_sr_${testId}`,
      createdAt: new Date().toISOString(),
      synced: false
    };

    const offlinePurchaseReturn: PurchaseReturn = {
      id: `pr_${testId}`,
      returnNumber: `PR-TEST-${testId}`,
      purchaseId: `purch_${testId}`,
      supplierId: `supp_${testId}`,
      supplierName: 'Agro Seeds Ltd',
      date: '2026-09-24',
      items: [
        {
          itemId: `item_feed_${testId}`,
          itemName: 'Dairy Cattle Feed Mash',
          returnedQuantity: 2,
          unitPrice: 1200,
          lineTotal: 2400,
          reason: 'Excess batch delivery'
        }
      ],
      totalRefundAmount: 2400,
      refundMethod: 'ADJUST_DUE',
      journalEntryId: `jnl_pr_${testId}`,
      idempotencyKey: `idem_pr_${testId}`,
      createdAt: new Date().toISOString(),
      synced: false
    };

    const offlineAdvancePayment: AdvancePayment = {
      id: `adv_${testId}`,
      advanceNumber: `ADV-TEST-${testId}`,
      party: 'Rahim Trading',
      partyId: `cust_${testId}`,
      partyName: 'Rahim Trading',
      amount: 15000,
      direction: 'RECEIVED',
      remainingBalance: 15000,
      paymentMethod: 'CASH',
      date: '2026-09-24',
      narration: 'Initial advance booking for festival supply',
      journalEntryId: `jnl_adv_${testId}`,
      idempotencyKey: `idem_adv_${testId}`,
      createdAt: new Date().toISOString(),
      synced: false
    };

    await db.salesReturns.put(offlineSalesReturn);
    await db.purchaseReturns.put(offlinePurchaseReturn);
    await db.advancePayments.put(offlineAdvancePayment);

    // Verify pending detection via listenToOnlineSync
    let detectedPendingCount = 0;
    const unsub = listenToOnlineSync(
      () => {},
      (pendingCount) => {
        detectedPendingCount = pendingCount;
      }
    );

    // Wait for async pending count
    await new Promise((r) => setTimeout(r, 150));
    unsub();

    assert(detectedPendingCount >= 3, `listenToOnlineSync detected at least 3 pending records (actual: ${detectedPendingCount})`);

    // ----------------------------------------------------
    // TEST 2: Durable Persistence Safeguard (Unconfirmed sync NEVER sets synced=true)
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Durable Persistence Precondition Safeguard ---');

    // Simulate an unauthorized or failed server write by temporarily removing session
    globalThis.localStorage.removeItem('goted_owner_session');

    const failedSyncResult = await synchronizePendingData();
    assert(failedSyncResult.errors.length > 0, 'Sync failed without authenticated owner session');

    // Verify records remain NOT synchronized in local DB
    const checkUnsyncedSR = await db.salesReturns.get(offlineSalesReturn.id);
    const checkUnsyncedPR = await db.purchaseReturns.get(offlinePurchaseReturn.id);
    const checkUnsyncedADV = await db.advancePayments.get(offlineAdvancePayment.id);

    assert(checkUnsyncedSR?.synced === false, 'Offline salesReturn remains synced=false when server persistence fails');
    assert(checkUnsyncedPR?.synced === false, 'Offline purchaseReturn remains synced=false when server persistence fails');
    assert(checkUnsyncedADV?.synced === false, 'Offline advancePayment remains synced=false when server persistence fails');

    // ----------------------------------------------------
    // TEST 3: Authenticated Server Sync & Durability
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Authenticated Server Synchronization ---');

    // Set valid owner session
    globalThis.localStorage.setItem(
      'goted_owner_session',
      JSON.stringify({
        email: testOwnerEmail,
        sessionToken: validSessionToken
      })
    );

    const successSyncResult = await synchronizePendingData();
    if (successSyncResult.errors.length > 0) {
      console.error('synchronizePendingData errors:', successSyncResult.errors);
    }
    assert(successSyncResult.syncedCount >= 3, `Sync succeeded for pending records (syncedCount: ${successSyncResult.syncedCount})`);

    // Verify local records are now updated with synced=true only after confirmed persistence
    const syncedSR = await db.salesReturns.get(offlineSalesReturn.id);
    const syncedPR = await db.purchaseReturns.get(offlinePurchaseReturn.id);
    const syncedADV = await db.advancePayments.get(offlineAdvancePayment.id);

    assert(syncedSR?.synced === true, 'salesReturn updated to synced=true after confirmed server persistence');
    assert(syncedPR?.synced === true, 'purchaseReturn updated to synced=true after confirmed server persistence');
    assert(syncedADV?.synced === true, 'advancePayment updated to synced=true after confirmed server persistence');

    // Verify durably stored on the server side via restore API
    const baseUrl = `http://127.0.0.1:${testPort}`;
    const verifyRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    const verifyData = await verifyRes.json();
    const serverSR = verifyData.collections?.salesReturns?.find((r: any) => r.id === offlineSalesReturn.id);
    const serverPR = verifyData.collections?.purchaseReturns?.find((r: any) => r.id === offlinePurchaseReturn.id);
    const serverADV = verifyData.collections?.advancePayments?.find((r: any) => r.id === offlineAdvancePayment.id);

    assert(serverSR !== undefined, 'Server durably stored salesReturn by ID');
    assert(serverSR?.returnNumber === offlineSalesReturn.returnNumber, 'Server stored salesReturn number matches');
    assert(serverSR?.totalRefundAmount === 500, 'Server stored salesReturn amount matches');

    assert(serverPR !== undefined, 'Server durably stored purchaseReturn by ID');
    assert(serverPR?.returnNumber === offlinePurchaseReturn.returnNumber, 'Server stored purchaseReturn number matches');
    assert(serverPR?.totalRefundAmount === 2400, 'Server stored purchaseReturn amount matches');

    assert(serverADV !== undefined, 'Server durably stored advancePayment by ID');
    assert(serverADV?.advanceNumber === offlineAdvancePayment.advanceNumber, 'Server stored advancePayment number matches');
    assert(serverADV?.amount === 15000, 'Server stored advancePayment amount matches');

    // ----------------------------------------------------
    // TEST 4: Idempotency & Re-sync Safety
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Idempotency & Duplicate Protection ---');

    // Mark one as unsynced again to simulate a network retry
    await db.salesReturns.update(offlineSalesReturn.id, { synced: false });
    const retryResult = await synchronizePendingData();

    assert(retryResult.errors.length === 0, 'Resyncing existing salesReturn succeeded without error');

    const afterRetryRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    const afterRetryData = await afterRetryRes.json();
    const matchingSRs = (afterRetryData.collections?.salesReturns || []).filter((r: any) => r.id === offlineSalesReturn.id);
    assert(matchingSRs.length === 1, 'Idempotent resync preserved same document ID without duplicating');

    // ----------------------------------------------------
    // TEST 5: Cloud Restore Support
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Cloud Restore Survival for Returns & Advances ---');

    // 1. Verify GET /api/sync/restore endpoint directly
    const restoreRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: {
        Authorization: `Bearer ${validSessionToken}`
      }
    });

    assert(restoreRes.ok, '/api/sync/restore responded with HTTP 200 OK');
    const restoreData = await restoreRes.json();
    assert(restoreData.success === true, 'Restore response indicates success: true');
    assert(Array.isArray(restoreData.collections?.salesReturns), 'Restore payload contains salesReturns array');
    assert(Array.isArray(restoreData.collections?.purchaseReturns), 'Restore payload contains purchaseReturns array');
    assert(Array.isArray(restoreData.collections?.advancePayments), 'Restore payload contains advancePayments array');

    const foundRestoredSR = restoreData.collections?.salesReturns?.find((r: any) => r.id === offlineSalesReturn.id);
    const foundRestoredPR = restoreData.collections?.purchaseReturns?.find((r: any) => r.id === offlinePurchaseReturn.id);
    const foundRestoredADV = restoreData.collections?.advancePayments?.find((r: any) => r.id === offlineAdvancePayment.id);

    assert(foundRestoredSR !== undefined, 'Cloud restore payload contains the offline-created salesReturn');
    assert(foundRestoredPR !== undefined, 'Cloud restore payload contains the offline-created purchaseReturn');
    assert(foundRestoredADV !== undefined, 'Cloud restore payload contains the offline-created advancePayment');

    // 2. Clear local IndexedDB tables to simulate clean new device login
    await db.salesReturns.clear();
    await db.purchaseReturns.clear();
    await db.advancePayments.clear();

    const emptySRCount = await db.salesReturns.count();
    const emptyPRCount = await db.purchaseReturns.count();
    const emptyADVCount = await db.advancePayments.count();

    assert(emptySRCount === 0, 'Local salesReturns cleared before cloud restore');
    assert(emptyPRCount === 0, 'Local purchaseReturns cleared before cloud restore');
    assert(emptyADVCount === 0, 'Local advancePayments cleared before cloud restore');

    // 3. Trigger client restoreRemoteDataIfLocalEmpty
    const clientRestoreResult = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true);
    assert(clientRestoreResult.restored === true, 'restoreRemoteDataIfLocalEmpty completed with restored: true');

    // 4. Verify records re-populated into Dexie with all fields and synced=true
    const restoredLocalSR = await db.salesReturns.get(offlineSalesReturn.id);
    const restoredLocalPR = await db.purchaseReturns.get(offlinePurchaseReturn.id);
    const restoredLocalADV = await db.advancePayments.get(offlineAdvancePayment.id);

    assert(restoredLocalSR !== undefined, 'salesReturn restored into local IndexedDB');
    assert(restoredLocalSR?.returnNumber === offlineSalesReturn.returnNumber, 'Restored salesReturn number matches');
    assert(restoredLocalSR?.totalRefundAmount === 500, 'Restored salesReturn totalRefundAmount matches');
    assert(restoredLocalSR?.items?.length === 1, 'Restored salesReturn items array preserved');
    assert(restoredLocalSR?.items?.[0]?.itemId === offlineSalesReturn.items[0].itemId, 'Restored salesReturn item ID preserved');
    assert(restoredLocalSR?.synced === true, 'Restored salesReturn marked synced=true');

    assert(restoredLocalPR !== undefined, 'purchaseReturn restored into local IndexedDB');
    assert(restoredLocalPR?.returnNumber === offlinePurchaseReturn.returnNumber, 'Restored purchaseReturn number matches');
    assert(restoredLocalPR?.totalRefundAmount === 2400, 'Restored purchaseReturn totalRefundAmount matches');
    assert(restoredLocalPR?.items?.length === 1, 'Restored purchaseReturn items array preserved');
    assert(restoredLocalPR?.synced === true, 'Restored purchaseReturn marked synced=true');

    assert(restoredLocalADV !== undefined, 'advancePayment restored into local IndexedDB');
    assert(restoredLocalADV?.advanceNumber === offlineAdvancePayment.advanceNumber, 'Restored advancePayment number matches');
    assert(restoredLocalADV?.amount === 15000, 'Restored advancePayment amount matches');
    assert(restoredLocalADV?.direction === 'RECEIVED', 'Restored advancePayment direction matches');
    assert(restoredLocalADV?.synced === true, 'Restored advancePayment marked synced=true');

    // ----------------------------------------------------
    // TEST 6: Schema Audit - All 30 Persistent Tables Covered
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Audit All 30 Persistent Tables Sync Architecture ---');

    const expectedPersistentTables = [
      'systemConfig',
      'accounts',
      'journalEntries',
      'animals',
      'animalEvents',
      'reminders',
      'ponds',
      'fishBatches',
      'plots',
      'cropCycles',
      'internalFlows',
      'processingRuns',
      'inventoryItems',
      'stockMovements',
      'parties',
      'purchases',
      'sales',
      'salesReturns',
      'purchaseReturns',
      'advancePayments',
      'payments',
      'cashBankAccounts',
      'bankTransfers',
      'loans',
      'investors',
      'fixedAssets',
      'auditLogs',
      'accessLogs',
      'closedPeriods',
      'recurringExpenseTemplates'
    ];

    assert(db.tables.length === 30, `Dexie database has exactly 30 persistent tables (actual: ${db.tables.length})`);

    for (const tbl of expectedPersistentTables) {
      assert(db.table(tbl) !== undefined, `Table "${tbl}" is verified as active persistent Dexie table`);
    }

    // Clean up test records
    await db.salesReturns.delete(offlineSalesReturn.id);
    await db.purchaseReturns.delete(offlinePurchaseReturn.id);
    await db.advancePayments.delete(offlineAdvancePayment.id);

  } finally {
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as http.Server).close(() => resolve()));
    }
  }

  console.log('\n========================================================');
  console.log(`F2 SYNC TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}
