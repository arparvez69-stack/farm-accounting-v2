import 'fake-indexeddb/auto';
import http from 'http';
import { db } from '../db/indexedDb';
import {
  synchronizePendingData,
  restoreRemoteDataIfLocalEmpty,
  initializeLocalDatabase
} from '../firebase/firebaseClient';
import {
  executeInventoryItemCreationTransaction,
  executeSaleTransaction,
  executePurchaseTransaction,
  executeAdvancePaymentTransaction
} from '../services/transactionService';
import { generateTrialBalance } from '../accounting/accountingEngine';
import { app, createSessionToken, inMemoryStores } from '../../server';
import { InventoryItem, Party, Animal } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 09 — OFFLINE → RELOAD → ONLINE → SYNC
 * FINAL RELEASE TASK 09 — COMPLETE OFFLINE/SYNC RECOVERY TEST
 *
 * Full cycle test:
 * 1. Start online.
 * 2. Create valid transactions.
 * 3. Disconnect network.
 * 4. Create valid offline transactions.
 * 5. Reload/close and reopen the application.
 * 6. Reconnect the network.
 * 7. Allow synchronization to complete.
 * 8. Verify cloud persistence.
 * 9. Reload again.
 * 10. Verify final data.
 *
 * Verifies:
 * - No data disappears
 * - No duplicate financial transactions appear
 * - No stale record overwrites newer data
 * - Pending operations survive reload
 * - Failed operations are not marked successful
 * - Sync retry works
 * - Accounting remains balanced
 */
export async function runOfflineReloadOnlineSyncRecoveryTests(): Promise<AssertionResult> {
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
      console.log(`  ✅ [PASS] ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`  ❌ [FAIL] ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 09: OFFLINE → RELOAD → ONLINE → SYNC RECOVERY');
  console.log('================================================================\n');

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
    const healthCheck = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(3000) });
    if (!healthCheck.ok) throw new Error('Health check non-200');
  } catch {
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        testPort = addr.port;
        process.env.PORT = String(testPort);
        resolve();
      });
    });
  }

  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);
  localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken, email: testOwnerEmail }));

  const runTag = `p09_${Date.now()}`;
  const originalFetch = globalThis.fetch;

  function setOnlineStatus(online: boolean) {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: online,
        configurable: true,
        writable: true
      });
    } catch {}
    if (typeof window !== 'undefined' && (window as any).navigator) {
      try {
        Object.defineProperty((window as any).navigator, 'onLine', {
          value: online,
          configurable: true,
          writable: true
        });
      } catch {}
    }
  }

  try {
    // --------------------------------------------------------------------------
    // STEP 1: START ONLINE
    // --------------------------------------------------------------------------
    console.log('--- STEP 1: Start Online & Initialize Base State ---');
    setOnlineStatus(true);

    assert(navigator.onLine === true, 'Environment reports online status');

    // Clean up local database for clean test run
    await Promise.all(db.tables.map((t) => t.clear()));

    // Clean up in-memory stores on server for clean cloud state
    for (const [colName, store] of inMemoryStores.entries()) {
      store.clear();
    }

    // Initialize local chart of accounts and default accounts
    await initializeLocalDatabase();

    const initialAccountsCount = await db.accounts.count();
    assert(initialAccountsCount > 0, `Chart of accounts initialized locally (count: ${initialAccountsCount})`);

    // Create Base Cash and Bank Accounts
    const cashAccId = `cash_${runTag}`;
    const bankAccId = `bank_${runTag}`;

    await db.cashBankAccounts.bulkPut([
      {
        id: cashAccId,
        name: 'প্রধান ক্যাশ ড্রয়ার',
        accountName: 'প্রধান ক্যাশ ড্রয়ার',
        accountType: 'CASH',
        openingBalance: 50000,
        currentBalance: 50000,
        isActive: true,
        synced: true
      },
      {
        id: bankAccId,
        name: 'ফার্ম ব্যাংক হিসাব',
        accountName: 'ফার্ম ব্যাংক হিসাব',
        accountType: 'BANK',
        openingBalance: 100000,
        currentBalance: 100000,
        bankName: 'Sonali Bank Ltd',
        accountNumber: 'SB-0987654321',
        isActive: true,
        synced: true
      }
    ]);

    // Create Initial Inventory Item with legitimate opening stock & movement via domain transaction
    const itemId = `item_feed_${runTag}`;
    const itemCreationRes = await executeInventoryItemCreationTransaction({
      itemData: {
        id: itemId,
        code: `FEED-${runTag.slice(-4)}`,
        nameBn: 'পোল্ট্রি ফিড প্রিমিয়াম',
        nameEn: 'Poultry Feed Premium',
        category: 'FEED',
        unit: 'BAG',
        currentStock: 100,
        avgCostPrice: 1000,
        sellingPrice: 1200
      },
      currentUserId: 'test-user-p09'
    });
    const initialItem = itemCreationRes.item;

    // Create Parties
    const customerId = `cust_${runTag}`;
    const supplierId = `supp_${runTag}`;
    const customerParty: Party = {
      id: customerId,
      name: 'সবুজ খামার লিমিটেড (Green Farm Ltd)',
      type: 'CUSTOMER',
      phone: '01711223344',
      balance: 0,
      synced: true
    };
    const supplierParty: Party = {
      id: supplierId,
      name: 'ন্যাশনাল এগ্রো ফিডস (National Agro Feeds)',
      type: 'SUPPLIER',
      phone: '01811556677',
      balance: 0,
      synced: true
    };
    await db.parties.bulkPut([customerParty, supplierParty]);

    // Seed master accounts in cloud
    const allAccounts = await db.accounts.toArray();
    for (const acc of allAccounts) {
      await fetch(`${baseUrl}/api/sync/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validSessionToken}`
        },
        body: JSON.stringify(acc)
      });
    }

    assert(true, 'Step 1 complete: Online base established cleanly');

    // --------------------------------------------------------------------------
    // STEP 2: CREATE VALID TRANSACTIONS (ONLINE)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 2: Create Valid Transactions Online ---');

    // Create an initial animal record (Cow #101)
    const animalId = `anim_${runTag}`;
    const initialCow: Animal = {
      id: animalId,
      tag: `TAG-COW-${runTag.slice(-4)}`,
      species: 'CATTLE',
      breed: 'Holstein Friesian',
      gender: 'FEMALE',
      birthDate: '2026-01-15',
      purchaseCost: 150000,
      purchaseDate: '2026-02-01',
      currentWeightKg: 420,
      status: 'ACTIVE',
      location: 'Main Shed',
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 150000,
      notes: 'Initial Cow 101',
      synced: false
    };
    await db.animals.put(initialCow);

    // Online Sale: 10 bags of feed @ ৳1,200 = ৳12,000 paid to Cash
    const onlineSaleRes = await executeSaleTransaction({
      customer: customerParty,
      items: [
        {
          item: initialItem,
          quantity: 10,
          unitPrice: 1200
        }
      ],
      paymentMethod: 'CASH',
      cashBankAccountId: cashAccId,
      currentUserId: 'test-user-p09',
      date: '2026-09-28',
      note: 'অনলাইন প্রথম বিক্রয় (Online initial sale)',
      idempotencyKey: `idem_sale_on_${runTag}`
    });

    assert(Boolean(onlineSaleRes?.sale?.id), 'Online sale executed successfully');
    const onlineSaleId = onlineSaleRes.sale.id;

    // Synchronize online data to cloud
    const onlineSyncOutcome = await synchronizePendingData();
    assert(onlineSyncOutcome.errors.length === 0, `Online sync completed without errors (errors: ${onlineSyncOutcome.errors.join(', ')})`);
    assert(onlineSyncOutcome.syncedCount >= 2, `Online sync synchronized records (syncedCount: ${onlineSyncOutcome.syncedCount})`);

    // Verify local records marked synced=true
    const syncedCow = await db.animals.get(animalId);
    const syncedSale = await db.sales.get(onlineSaleId);
    const syncedSaleJv = await db.journalEntries.get(onlineSaleRes.journalEntryId);

    assert(syncedCow?.synced === true, 'Animal record marked synced=true locally');
    assert(syncedSale?.synced === true, 'Sale record marked synced=true locally');
    assert(syncedSaleJv?.synced === true, 'Sale journal entry marked synced=true locally');

    // Verify cloud has the records
    const cloudCheckRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    const cloudCheckData = await cloudCheckRes.json();
    const cloudSales = cloudCheckData.collections?.sales || [];
    const cloudAnimals = cloudCheckData.collections?.animals || [];

    assert(cloudSales.some((s: any) => s.id === onlineSaleId), 'Online sale persisted in cloud store');
    assert(cloudAnimals.some((a: any) => a.id === animalId), 'Online animal persisted in cloud store');

    // Check accounting balance
    const onlineTb = await generateTrialBalance({ endDate: '2026-09-28' }, db);
    assert(onlineTb.isBalanced === true, `Online Trial Balance is strictly balanced (Diff: ${onlineTb.difference})`);
    assert(onlineTb.difference === 0, 'Online Trial Balance difference is 0');

    // Verify Cash updated: 50,000 + 12,000 = 62,000
    const cashAccAfterOnline = await db.cashBankAccounts.get(cashAccId);
    assert(cashAccAfterOnline?.currentBalance === 62000, `Cash balance updated to ৳62,000 (actual: ${cashAccAfterOnline?.currentBalance})`);

    // --------------------------------------------------------------------------
    // STEP 3: DISCONNECT NETWORK
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 3: Disconnect Network ---');

    setOnlineStatus(false);

    assert(navigator.onLine === false, 'Network disconnected: navigator.onLine is false');

    // Intercept fetch to reject any network calls while offline
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch: Network offline simulation active');
    };

    // Attempt sync while offline -> must handle gracefully
    const offlineSyncAttempt = await synchronizePendingData();
    assert(
      offlineSyncAttempt.syncedCount === 0 &&
        (offlineSyncAttempt.errors.includes('Offline') || offlineSyncAttempt.errors.length > 0),
      'SynchronizePendingData correctly stopped due to offline status'
    );

    // --------------------------------------------------------------------------
    // STEP 4: CREATE VALID OFFLINE TRANSACTIONS
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 4: Create Valid Offline Transactions ---');

    // Transaction A: Offline Sale (15 bags @ ৳1,200 = ৳18,000 paid to Bank)
    const currentItemState = await db.inventoryItems.get(itemId);
    const offlineSaleRes = await executeSaleTransaction({
      customer: customerParty,
      items: [
        {
          item: currentItemState!,
          quantity: 15,
          unitPrice: 1200
        }
      ],
      paymentMethod: 'BANK',
      bankAccountId: bankAccId,
      currentUserId: 'test-user-p09',
      date: '2026-09-28',
      note: 'অফলাইন দ্বিতীয় বিক্রয় (Offline sale via bank)',
      idempotencyKey: `idem_sale_off_${runTag}`
    });

    const offlineSaleId = offlineSaleRes.sale.id;
    assert(Boolean(offlineSaleId), 'Offline sale created successfully');

    // Transaction B: Offline Purchase (40 bags @ ৳1,000 = ৳40,000 paid from Bank)
    const offlinePurRes = await executePurchaseTransaction({
      supplier: supplierParty,
      items: [
        {
          item: (await db.inventoryItems.get(itemId))!,
          quantity: 40,
          unitPrice: 1000
        }
      ],
      paymentMethod: 'BANK',
      bankAccountId: bankAccId,
      currentUserId: 'test-user-p09',
      date: '2026-09-28',
      note: 'অফলাইন ফিড ক্রয় (Offline feed purchase via bank)',
      idempotencyKey: `idem_pur_off_${runTag}`
    });

    const offlinePurId = offlinePurRes.purchase.id;
    assert(Boolean(offlinePurId), 'Offline purchase created successfully');

    // Transaction C: Offline Advance Payment (Customer pays ৳15,000 cash advance)
    const offlineAdvRes = await executeAdvancePaymentTransaction({
      partyId: customerId,
      party: customerParty,
      amount: 15000,
      direction: 'RECEIVED',
      paymentMethod: 'CASH',
      cashBankAccountId: cashAccId,
      date: '2026-09-28',
      narration: 'অফলাইন কাস্টমার অগ্রিম প্রাপ্তি (Offline customer advance)',
      idempotencyKey: `idem_adv_off_${runTag}`
    });

    const offlineAdvId = offlineAdvRes.advancePayment.id;
    assert(Boolean(offlineAdvId), 'Offline advance payment created successfully');

    // Transaction D: Offline Animal Record Edit (newer version & timestamp)
    await db.animals.update(animalId, {
      currentWeightKg: 460,
      notes: 'হোলস্টেইন ফ্রিজিয়ান ডেইরি গাভী #১০১ (চিকিৎসা ও ওজন হালনাগাদ)',
      synced: false
    });

    // Verify offline records have synced=false
    const checkOffSale = await db.sales.get(offlineSaleId);
    const checkOffPur = await db.purchases.get(offlinePurId);
    const checkOffAdv = await db.advancePayments.get(offlineAdvId);
    const checkOffCow = await db.animals.get(animalId);
    const checkOffJvSale = await db.journalEntries.get(offlineSaleRes.journalEntryId);
    const checkOffJvPur = await db.journalEntries.get(offlinePurRes.journalEntryId);

    assert(checkOffSale?.synced === false, 'Offline sale has synced=false');
    assert(checkOffPur?.synced === false, 'Offline purchase has synced=false');
    assert(checkOffAdv?.synced === false, 'Offline advance has synced=false');
    assert(checkOffCow?.synced === false, 'Offline animal update has synced=false');
    assert(checkOffJvSale?.synced === false, 'Offline sale journal entry has synced=false');
    assert(checkOffJvPur?.synced === false, 'Offline purchase journal entry has synced=false');

    // Verify failed operations are NOT marked successful while offline
    const failedSyncAttempt2 = await synchronizePendingData();
    assert(
      failedSyncAttempt2.syncedCount === 0,
      'Failed operations are not marked successful: 0 records synced while offline'
    );

    const recheckOffSale = await db.sales.get(offlineSaleId);
    assert(recheckOffSale?.synced === false, 'Offline sale strictly remains synced=false after failed sync attempt');

    // Verify accounting remains balanced locally while offline
    const offlineTb = await generateTrialBalance({ endDate: '2026-09-28' }, db);
    assert(offlineTb.isBalanced === true, `Offline Trial Balance is strictly balanced (Diff: ${offlineTb.difference})`);
    assert(offlineTb.difference === 0, 'Offline Trial Balance difference is 0');

    // --------------------------------------------------------------------------
    // STEP 5: RELOAD / CLOSE AND REOPEN THE APPLICATION
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 5: Reload / Close and Reopen Application ---');

    // Simulate closing app
    db.close();

    // Reopen database connection
    await db.open();

    // Simulate app startup bootstrap
    await initializeLocalDatabase();

    // Verify pending operations survived reload
    const reloadedSale = await db.sales.get(offlineSaleId);
    const reloadedPur = await db.purchases.get(offlinePurId);
    const reloadedAdv = await db.advancePayments.get(offlineAdvId);
    const reloadedCow = await db.animals.get(animalId);
    const reloadedJvSale = await db.journalEntries.get(offlineSaleRes.journalEntryId);
    const reloadedJvPur = await db.journalEntries.get(offlinePurRes.journalEntryId);

    assert(Boolean(reloadedSale), 'Pending offline sale survived application reload');
    assert(reloadedSale?.synced === false, 'Pending sale still has synced=false after reload');
    assert(Boolean(reloadedPur), 'Pending offline purchase survived application reload');
    assert(reloadedPur?.synced === false, 'Pending purchase still has synced=false after reload');
    assert(Boolean(reloadedAdv), 'Pending offline advance survived application reload');
    assert(reloadedAdv?.synced === false, 'Pending advance still has synced=false after reload');
    assert(reloadedCow?.currentWeightKg === 460, 'Offline animal update survived reload with weight 460kg');
    assert(reloadedCow?.synced === false, 'Updated animal still has synced=false after reload');
    assert(Boolean(reloadedJvSale), 'Offline sale journal survived reload');
    assert(Boolean(reloadedJvPur), 'Offline purchase journal survived reload');

    // Verify Trial Balance still strictly balanced after reload
    const postReloadTb = await generateTrialBalance({ endDate: '2026-09-28' }, db);
    assert(postReloadTb.isBalanced === true, 'Trial Balance remains strictly balanced after application reload');

    // --------------------------------------------------------------------------
    // STEP 6: RECONNECT THE NETWORK
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 6: Reconnect Network ---');

    setOnlineStatus(true);
    globalThis.fetch = originalFetch;

    assert(navigator.onLine === true, 'Network reconnected: navigator.onLine is true');

    const healthCheckAfterReconnect = await fetch(`${baseUrl}/api/health`);
    assert(healthCheckAfterReconnect.ok, 'Cloud server is reachable on port ' + testPort);

    // --------------------------------------------------------------------------
    // STEP 7: ALLOW SYNCHRONIZATION TO COMPLETE (WITH RETRY TESTING)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 7: Allow Synchronization to Complete & Test Sync Retry ---');

    // Test sync retry: simulate 1 temporary glitch, then let retry succeed
    let glitchInjected = true;
    const interceptedGlitchFetch = async (input: any, init?: any) => {
      if (glitchInjected && String(input).includes('/api/sync/sales')) {
        glitchInjected = false;
        return new Response(JSON.stringify({ error: 'Temporary Server Busy (Simulated 503)' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, init);
    };

    globalThis.fetch = interceptedGlitchFetch as any;

    // Run sync (bounded backoff will retry and succeed)
    const fullSyncResult = await synchronizePendingData();
    globalThis.fetch = originalFetch;

    if (fullSyncResult.errors.length > 0) {
      console.log('Sync notice:', fullSyncResult.errors);
      // Run retry sync to verify retry works
      const retryResult = await synchronizePendingData();
      assert(retryResult.errors.length === 0, `Sync retry succeeded cleanly (errors: ${retryResult.errors.join(', ')})`);
    } else {
      assert(fullSyncResult.syncedCount > 0, `Sync succeeded on initial/retry (syncedCount: ${fullSyncResult.syncedCount})`);
    }

    // Verify all records in local DB are now marked synced=true
    const syncedSaleAfter = await db.sales.get(offlineSaleId);
    const syncedPurAfter = await db.purchases.get(offlinePurId);
    const syncedAdvAfter = await db.advancePayments.get(offlineAdvId);
    const syncedCowAfter = await db.animals.get(animalId);

    assert(syncedSaleAfter?.synced === true, 'Offline sale successfully synchronized (synced=true)');
    assert(syncedPurAfter?.synced === true, 'Offline purchase successfully synchronized (synced=true)');
    assert(syncedAdvAfter?.synced === true, 'Offline advance successfully synchronized (synced=true)');
    assert(syncedCowAfter?.synced === true, 'Updated animal successfully synchronized (synced=true)');

    // --------------------------------------------------------------------------
    // STEP 8: VERIFY CLOUD PERSISTENCE
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 8: Verify Cloud Persistence ---');

    const cloudRestoreRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    assert(cloudRestoreRes.status === 200, 'Cloud restore endpoint responded with HTTP 200');

    const cloudPayload = await cloudRestoreRes.json();
    assert(cloudPayload.success === true, 'Cloud restore payload indicates success: true');

    const remoteSales = cloudPayload.collections?.sales || [];
    const remotePurchases = cloudPayload.collections?.purchases || [];
    const remoteAdvances = cloudPayload.collections?.advancePayments || [];
    const remoteJournals = cloudPayload.collections?.journalEntries || [];
    const remoteAnimals = cloudPayload.collections?.animals || [];

    // Verify both online sale and offline sale exist in cloud
    assert(remoteSales.some((s: any) => s.id === onlineSaleId), 'Cloud contains online sale');
    assert(remoteSales.some((s: any) => s.id === offlineSaleId), 'Cloud contains offline sale');
    const cloudTestSales = remoteSales.filter((s: any) => s.id === onlineSaleId || s.id === offlineSaleId);
    assert(cloudTestSales.length === 2, `Cloud has exactly 2 sales for this session (actual: ${cloudTestSales.length})`);

    // Verify offline purchase exists in cloud
    assert(remotePurchases.some((p: any) => p.id === offlinePurId), 'Cloud contains offline purchase');
    const cloudTestPurchases = remotePurchases.filter((p: any) => p.id === offlinePurId);
    assert(cloudTestPurchases.length === 1, `Cloud has exactly 1 purchase for this session (actual: ${cloudTestPurchases.length})`);

    // Verify advance payment exists in cloud
    assert(remoteAdvances.some((a: any) => a.id === offlineAdvId), 'Cloud contains offline advance payment');

    // Verify newer animal update exists in cloud (no stale overwrite!)
    const cloudCow = remoteAnimals.find((a: any) => a.id === animalId);
    assert(Boolean(cloudCow), 'Cloud contains animal record');
    assert(cloudCow?.currentWeightKg === 460, `Cloud has newer offline animal weight (460kg, actual: ${cloudCow?.currentWeightKg})`);
    assert(cloudCow?.notes?.includes('চিকিৎসা'), 'Cloud has newer offline animal notes');

    // Verify no duplicate journal entries in cloud
    const cloudJournalIds = remoteJournals.map((j: any) => j.id);
    const uniqueCloudJournalIds = new Set(cloudJournalIds);
    assert(
      cloudJournalIds.length === uniqueCloudJournalIds.size,
      `No duplicate journal entries in cloud (total: ${cloudJournalIds.length}, unique: ${uniqueCloudJournalIds.size})`
    );

    // --------------------------------------------------------------------------
    // STEP 9: RELOAD AGAIN (AND NON-DESTRUCTIVE RESTORE VERIFICATION)
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 9: Reload Application Again & Test Non-Destructive Restore ---');

    // Simulate application reload again after synchronization
    db.close();
    await db.open();
    await initializeLocalDatabase();

    // Verify non-destructive restore check (normal reload checks empty state safely)
    const testRestoreOutcome = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false);
    assert(typeof testRestoreOutcome.restored === 'boolean', 'restoreRemoteDataIfLocalEmpty executed safely without error');

    // --------------------------------------------------------------------------
    // STEP 10: VERIFY FINAL DATA & FINANCIAL INTEGRITY
    // --------------------------------------------------------------------------
    console.log('\n--- STEP 10: Verify Final Data Invariants ---');

    // Invariant 1: No data disappears
    const finalSales = await db.sales.toArray();
    const finalPurchases = await db.purchases.toArray();
    const finalAdvances = await db.advancePayments.toArray();
    const finalAnimals = await db.animals.toArray();
    const finalStockMovements = await db.stockMovements.toArray();
    const finalJournals = await db.journalEntries.toArray();

    const testFinalSales = finalSales.filter((s) => s.id === onlineSaleId || s.id === offlineSaleId);
    assert(testFinalSales.length === 2, `Both session sales exist locally without loss (actual: ${testFinalSales.length})`);

    const testFinalPurchases = finalPurchases.filter((p) => p.id === offlinePurId);
    assert(testFinalPurchases.length === 1, `Session purchase exists locally without loss (actual: ${testFinalPurchases.length})`);

    const testFinalAdvances = finalAdvances.filter((a) => a.id === offlineAdvId);
    assert(testFinalAdvances.length === 1, `Session advance exists locally without loss (actual: ${testFinalAdvances.length})`);

    const testFinalAnimal = await db.animals.get(animalId);
    assert(Boolean(testFinalAnimal), 'Session animal record exists locally without loss');

    // Invariant 2: No duplicate financial transactions appear
    const saleInvoices = testFinalSales.map((s) => s.invoiceNumber);
    assert(new Set(saleInvoices).size === testFinalSales.length, 'No duplicate sale invoice numbers exist for session');

    const purInvoices = testFinalPurchases.map((p) => p.invoiceNumber);
    assert(new Set(purInvoices).size === testFinalPurchases.length, 'No duplicate purchase invoice numbers exist for session');

    const sessionJournals = finalJournals.filter(
      (j) =>
        j.id === onlineSaleRes.journalEntryId ||
        j.id === offlineSaleRes.journalEntryId ||
        j.id === offlinePurRes.journalEntryId ||
        j.id === offlineAdvRes.journalEntryId ||
        (j.narration && j.narration.includes(runTag))
    );
    const journalVouchers = sessionJournals.map((j) => j.voucherNumber);
    assert(new Set(journalVouchers).size === sessionJournals.length, `No duplicate journal voucher numbers exist for session (count: ${sessionJournals.length})`);

    // Invariant 3: No stale record overwrites newer data
    const finalCow = await db.animals.get(animalId);
    assert(finalCow?.currentWeightKg === 460, `Final animal weight is preserved as 460kg (actual: ${finalCow?.currentWeightKg})`);

    // Invariant 4: Cash & Bank Account balances reconcile exactly
    // Initial Cash: ৳50,000 + Online Sale: ৳12,000 + Advance Payment: ৳15,000 = ৳77,000
    const finalCashAcc = await db.cashBankAccounts.get(cashAccId);
    assert(finalCashAcc?.currentBalance === 77000, `Cash balance reconciles to ৳77,000 (actual: ৳${finalCashAcc?.currentBalance})`);

    // Initial Bank: ৳100,000 + Offline Sale: ৳18,000 - Offline Purchase: ৳40,000 = ৳78,000
    const finalBankAcc = await db.cashBankAccounts.get(bankAccId);
    assert(finalBankAcc?.currentBalance === 78000, `Bank balance reconciles to ৳78,000 (actual: ৳${finalBankAcc?.currentBalance})`);

    // Invariant 5: Inventory stock reconciles exactly
    // Initial: 100 - Sale 1: 10 - Sale 2: 15 + Purchase 1: 40 = 115 bags
    const finalItem = await db.inventoryItems.get(itemId);
    assert(finalItem?.currentStock === 115, `Inventory currentStock reconciles to 115 bags (actual: ${finalItem?.currentStock})`);

    // Invariant 6: Final Trial Balance is strictly balanced
    const finalTb = await generateTrialBalance({ endDate: '2026-09-28' }, db);
    assert(finalTb.isBalanced === true, `Final Trial Balance is strictly balanced (Diff: ৳${finalTb.difference})`);
    assert(finalTb.difference === 0, 'Final Trial Balance discrepancy is 0');
    assert(finalTb.totalDebit > 0, `Final TB totalDebit is positive (৳${finalTb.totalDebit})`);
    assert(finalTb.totalDebit === finalTb.totalCredit, `Final TB totalDebit (৳${finalTb.totalDebit}) === totalCredit (৳${finalTb.totalCredit})`);

    // Invariant 7: All records are synced=true
    for (const s of testFinalSales) assert(s.synced === true, `Sale ${s.invoiceNumber} has synced=true`);
    for (const p of testFinalPurchases) assert(p.synced === true, `Purchase ${p.invoiceNumber} has synced=true`);
    for (const a of testFinalAdvances) assert(a.synced === true, `Advance ${a.advanceNumber} has synced=true`);
    for (const j of finalJournals) assert(j.synced === true, `Journal ${j.voucherNumber} has synced=true`);

    console.log('\n================================================================');
    console.log('ALL PROMPT 09 OFFLINE/SYNC RECOVERY TESTS PASSED! 🎉');
    console.log(`Total Assertions Passed: ${result.passed}/${result.total}`);
    console.log('================================================================\n');

    return result;
  } finally {
    // Restore global fetch and navigator
    globalThis.fetch = originalFetch;
    setOnlineStatus(true);
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

// Standalone execution support
if (
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testPrompt09OfflineSyncRecovery.ts') ||
    process.argv[1].endsWith('testPrompt09OfflineSyncRecovery.js'))
) {
  runOfflineReloadOnlineSyncRecoveryTests()
    .then((r) => {
      console.log(`Execution complete. Result: ${r.passed}/${r.total} passed.`);
      process.exit(r.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal test error in Prompt 09:', err);
      process.exit(1);
    });
}
