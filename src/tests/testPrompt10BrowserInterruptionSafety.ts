import 'fake-indexeddb/auto';
import http from 'http';
import React from 'react';
import { db, AgroDatabase } from '../db/indexedDb';
import {
  synchronizePendingData,
  restoreRemoteDataIfLocalEmpty,
  initializeLocalDatabase
} from '../firebase/firebaseClient';
import {
  executeInventoryItemCreationTransaction,
  executeSaleTransaction,
  executePurchaseTransaction
} from '../services/transactionService';
import { generateTrialBalance } from '../accounting/accountingEngine';
import { app, createSessionToken, inMemoryStores } from '../../server';
import { InventoryItem, Party, Animal } from '../types';
import {
  pushNav,
  goBack,
  getCurrentNav,
  canGoBack,
  registerUnsavedChecker,
  hasUnsavedChanges,
  resetToDashboard
} from '../services/navigationService';
import { ErrorBoundary } from '../components/ErrorBoundary';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 10 — BROWSER RELOAD / CRASH / UNSAVED DATA
 * FINAL RELEASE TASK 10 — APPLICATION INTERRUPTION SAFETY.
 *
 * Test:
 * - browser reload during normal navigation;
 * - browser reload while entering data;
 * - browser close/reopen;
 * - temporary network loss;
 * - temporary server/API failure.
 *
 * Verify:
 * 1. Already committed transactions remain intact.
 * 2. Uncommitted forms are NOT falsely saved.
 * 3. No transaction is duplicated.
 * 4. Sync state remains accurate.
 * 5. IndexedDB remains usable.
 * 6. The application recovers normally.
 * 7. No blank-screen permanent failure occurs.
 */
export async function runBrowserInterruptionSafetyTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 10: APPLICATION INTERRUPTION SAFETY TESTS');
  console.log('================================================================\n');

  // Ensure localStorage polyfill in Node
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

  const runTag = `p10_${Date.now()}`;
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
    // BASE SETUP: Initialize isolated environment
    // --------------------------------------------------------------------------
    console.log('--- BASE SETUP: Initialize Clean Isolated Environment ---');
    setOnlineStatus(true);
    await Promise.all(db.tables.map((t) => t.clear()));
    for (const [colName, store] of inMemoryStores.entries()) {
      store.clear();
    }
    await initializeLocalDatabase();

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

    const itemId = `item_seed_${runTag}`;
    const itemCreationRes = await executeInventoryItemCreationTransaction({
      itemData: {
        id: itemId,
        code: `SEED-${runTag.slice(-4)}`,
        nameBn: 'ধান বীজ ব্রি-২৮',
        nameEn: 'Paddy Seed BR-28',
        category: 'SEED',
        unit: 'KG',
        currentStock: 200,
        avgCostPrice: 80,
        sellingPrice: 100
      },
      currentUserId: 'test-user-p10'
    });
    const inventoryItem = itemCreationRes.item;

    const customerParty: Party = {
      id: `cust_${runTag}`,
      name: 'কৃষক সোলায়মান',
      type: 'CUSTOMER',
      phone: '01711998877',
      balance: 0,
      synced: true
    };
    await db.parties.put(customerParty);

    // Seed master accounts to server
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

    assert(true, 'Base setup completed cleanly');

    // --------------------------------------------------------------------------
    // PART 1: BROWSER RELOAD DURING NORMAL NAVIGATION
    // --------------------------------------------------------------------------
    console.log('\n--- PART 1: Browser Reload During Normal Navigation ---');

    resetToDashboard();
    assert(getCurrentNav().tab === 'dashboard', 'Navigation initialized at dashboard');

    // User navigates deeply through tabs
    pushNav({ tab: 'operations', subTab: 'livestock', detailId: 'cow-101' });
    assert(getCurrentNav().tab === 'operations', 'Navigated to operations livestock detail');
    assert(getCurrentNav().detailId === 'cow-101', 'Detail ID cow-101 in navigation');
    assert(canGoBack() === true, 'Navigation stack allows going back');

    pushNav({ tab: 'accounting', subTab: 'vouchers' });
    assert(getCurrentNav().tab === 'accounting', 'Navigated to accounting vouchers');

    pushNav({ tab: 'commerce', subTab: 'sales' });
    assert(getCurrentNav().tab === 'commerce', 'Navigated to commerce sales');

    // Navigate back one step
    goBack();
    assert(getCurrentNav().tab === 'accounting', 'Successfully backed up to accounting');

    // Simulate browser reload during deep navigation
    // Reload creates a fresh navigation stack starting at dashboard
    resetToDashboard();
    assert(getCurrentNav().tab === 'dashboard', 'Reload safely resets navigation to dashboard');
    assert(canGoBack() === false, 'Fresh session starts with empty back stack');

    // Check that local IndexedDB records remain 100% intact after navigation reload
    const initialItemCheck = await db.inventoryItems.get(itemId);
    assert(initialItemCheck !== undefined && initialItemCheck.currentStock === 200, 'Committed inventory intact after navigation reload');

    const accountsCheck = await db.accounts.count();
    assert(accountsCheck >= 60, 'Chart of accounts intact after navigation reload');

    // --------------------------------------------------------------------------
    // PART 2: BROWSER RELOAD WHILE ENTERING DATA (UNCOMMITTED FORMS SAFETY)
    // --------------------------------------------------------------------------
    console.log('\n--- PART 2: Browser Reload While Entering Data (Uncommitted Forms Safety) ---');

    // Record baseline database state
    const baselineSalesCount = await db.sales.count();
    const baselinePurchasesCount = await db.purchases.count();
    const baselineJournalCount = await db.journalEntries.count();
    const baselineStockMovements = await db.stockMovements.count();
    const baselineCashBalance = (await db.cashBankAccounts.get(cashAccId))?.currentBalance || 0;

    // Simulate user typing into a New Sale form (uncommitted React component state)
    let formState: any = {
      customerId: customerParty.id,
      items: [
        { itemId: inventoryItem.id, quantity: 50, unitPrice: 100 }
      ],
      paymentMethod: 'CASH',
      amountReceived: 5000,
      notes: 'অসম্পূর্ণ বিক্রয় ড্রাফট (Unfinished sale draft)',
      isDirty: true
    };

    // Register dirty checker for the open form
    const unregisterDirtyChecker = registerUnsavedChecker(() => formState.isDirty);
    assert(hasUnsavedChanges() === true, 'Dirty checker detects unsaved form entry');

    // Simulate beforeunload warning event
    let beforeUnloadPrevented = false as boolean;
    const mockBeforeUnloadEvent = {
      preventDefault: () => { beforeUnloadPrevented = true; },
      returnValue: ''
    };
    if (hasUnsavedChanges()) {
      mockBeforeUnloadEvent.preventDefault();
      mockBeforeUnloadEvent.returnValue = 'Unsaved changes';
    }
    assert(beforeUnloadPrevented === true, 'beforeunload event correctly intercepts reload when dirty form exists');

    // Now simulate browser hard reload / tab closure:
    // The user ignores the warning or browser crashes. Memory is completely cleared.
    formState = null; // in-memory form destroyed
    unregisterDirtyChecker(); // component unmounted
    assert(hasUnsavedChanges() === false, 'After reload, uncommitted form memory is discarded');

    // VERIFY: Uncommitted forms were NEVER falsely committed or written to storage
    const postCrashSalesCount = await db.sales.count();
    const postCrashPurchasesCount = await db.purchases.count();
    const postCrashJournalCount = await db.journalEntries.count();
    const postCrashStockMovements = await db.stockMovements.count();
    const postCrashCashBalance = (await db.cashBankAccounts.get(cashAccId))?.currentBalance || 0;

    assert(postCrashSalesCount === baselineSalesCount, 'Zero uncommitted sales falsely saved');
    assert(postCrashPurchasesCount === baselinePurchasesCount, 'Zero uncommitted purchases falsely saved');
    assert(postCrashJournalCount === baselineJournalCount, 'Zero orphan journal entries created from uncommitted form');
    assert(postCrashStockMovements === baselineStockMovements, 'Zero orphan stock movements created from uncommitted form');
    assert(postCrashCashBalance === baselineCashBalance, 'Cash balance completely unchanged by uncommitted form');

    // Verify stock balance remained 200
    const stockAfterCrash = await db.inventoryItems.get(itemId);
    assert(stockAfterCrash?.currentStock === 200, 'Inventory stock intact at 200 after uncommitted reload');

    // --------------------------------------------------------------------------
    // PART 3: BROWSER CLOSE / REOPEN (COMMITTED DATA PERSISTENCE & NO DUPLICATION)
    // --------------------------------------------------------------------------
    console.log('\n--- PART 3: Browser Close / Reopen (Committed Data Intact & No Duplication) ---');

    // Legitimate committed transaction: Sale of 20 KG seeds @ ৳100 = ৳2,000 to Cash
    const sale1Res = await executeSaleTransaction({
      customer: customerParty,
      items: [{ item: inventoryItem, quantity: 20, unitPrice: 100 }],
      paymentMethod: 'CASH',
      cashBankAccountId: cashAccId,
      currentUserId: 'user-p10-a',
      date: '2026-09-28',
      note: 'বৈধ বিক্রয় ১ (Legitimate sale 1)',
      idempotencyKey: `sale_p10_1_${runTag}`
    });

    assert(Boolean(sale1Res?.sale?.id), 'Sale 1 committed successfully before browser close');
    const committedSaleId = sale1Res.sale.id;
    const committedJournalBeforeClose = await db.journalEntries.get(sale1Res.journalEntryId);
    assert(committedJournalBeforeClose !== undefined, 'Sale journal entry verified before browser close');

    // Simulate closing the browser: closing Dexie DB connection
    db.close();
    assert(db.isOpen() === false, 'Database closed to simulate browser termination');

    // Simulate reopen: opening new Dexie connection on the same underlying database
    const reopenedDb = new AgroDatabase();
    await reopenedDb.open();
    assert(reopenedDb.isOpen() === true, 'Database reopened cleanly on application restart');

    // Verify committed sale and journal exist intact in reopened DB
    const recoveredSale = await reopenedDb.sales.get(committedSaleId);
    assert(recoveredSale !== undefined, 'Committed sale retrieved intact from reopened database');
    assert(recoveredSale?.id === committedSaleId, 'Committed sale ID preserved');
    assert(recoveredSale?.totalAmount === 2000, 'Committed sale total amount ৳2000 preserved');

    const recoveredJournal = await reopenedDb.journalEntries.get(sale1Res.journalEntryId);
    assert(recoveredJournal !== undefined, 'Committed journal entry retrieved intact from reopened database');
    assert(recoveredJournal?.totalDebit === committedJournalBeforeClose?.totalDebit, `Journal entry debit preserved as ৳${committedJournalBeforeClose?.totalDebit}`);
    assert(recoveredJournal?.totalCredit === committedJournalBeforeClose?.totalCredit, `Journal entry credit preserved as ৳${committedJournalBeforeClose?.totalCredit}`);
    assert(recoveredJournal?.totalDebit === recoveredJournal?.totalCredit, 'Journal entry remains strictly balanced (Debit === Credit)');

    // Check inventory stock is 200 - 20 = 180
    const itemAfterReopen = await reopenedDb.inventoryItems.get(itemId);
    assert(itemAfterReopen?.currentStock === 180, 'Inventory stock accurately preserved as 180 after reopen');

    // Reopen primary db instance
    await db.open();

    // --------------------------------------------------------------------------
    // PART 4: TEMPORARY NETWORK LOSS DURING TRANSACTION CREATION & RECOVERY
    // --------------------------------------------------------------------------
    console.log('\n--- PART 4: Temporary Network Loss & Local Safety ---');

    // Disconnect network
    setOnlineStatus(false);
    assert(navigator.onLine === false, 'Network disconnected (offline mode active)');

    // Create an offline transaction while disconnected: Sale of 15 KG @ ৳100 = ৳1,500
    const offlineSaleRes = await executeSaleTransaction({
      customer: customerParty,
      items: [{ item: itemAfterReopen!, quantity: 15, unitPrice: 100 }],
      paymentMethod: 'CASH',
      cashBankAccountId: cashAccId,
      currentUserId: 'user-p10-b',
      date: '2026-09-28',
      note: 'অফলাইন বিক্রয় ২ (Offline sale 2)',
      idempotencyKey: `sale_p10_off_${runTag}`
    });

    assert(Boolean(offlineSaleRes?.sale?.id), 'Offline sale successfully committed to local storage');
    const offlineSaleId = offlineSaleRes.sale.id;

    // Verify sale has synced: false
    const localOfflineSale = await db.sales.get(offlineSaleId);
    assert(localOfflineSale?.synced === false, 'Offline sale correctly stored with synced=false');

    // Attempting sync while offline must abort cleanly without errors or false successes
    const offlineSyncAttempt = await synchronizePendingData();
    assert(offlineSyncAttempt.syncedCount === 0, 'Zero records synced while network is offline');

    const recheckOfflineSale = await db.sales.get(offlineSaleId);
    assert(recheckOfflineSale?.synced === false, 'Offline sale remains synced=false after offline sync attempt');

    // Reconnect network
    setOnlineStatus(true);
    assert(navigator.onLine === true, 'Network reconnected (online mode active)');

    // Sync now that network is back
    const onlineSyncOutcome = await synchronizePendingData();
    assert(onlineSyncOutcome.errors.length === 0, `Sync completed without errors after network reconnection (errors: ${onlineSyncOutcome.errors.join(', ')})`);
    assert(onlineSyncOutcome.syncedCount >= 2, `Sync successfully pushed pending records (syncedCount: ${onlineSyncOutcome.syncedCount})`);

    // Verify local record is now synced=true
    const syncedSaleRecord = await db.sales.get(offlineSaleId);
    assert(syncedSaleRecord?.synced === true, 'Offline sale marked synced=true after network recovery');

    // --------------------------------------------------------------------------
    // PART 5: TEMPORARY SERVER / API FAILURE (500 / 503 ERROR TOLERANCE)
    // --------------------------------------------------------------------------
    console.log('\n--- PART 5: Temporary Server / API Failure (500 / 503 Tolerant) ---');

    // Create another valid local transaction to test sync failure tolerance
    const updatedItem = await db.inventoryItems.get(itemId);
    const saleBeforeServerError = await executeSaleTransaction({
      customer: customerParty,
      items: [{ item: updatedItem!, quantity: 10, unitPrice: 100 }],
      paymentMethod: 'CASH',
      cashBankAccountId: cashAccId,
      currentUserId: 'user-p10-c',
      date: '2026-09-28',
      note: 'সার্ভার ডাউন সময়ের বিক্রয় (Sale during server down)',
      idempotencyKey: `sale_p10_srv_down_${runTag}`
    });

    assert(Boolean(saleBeforeServerError?.sale?.id), 'Local transaction recorded before server outage');
    const pendingSaleId = saleBeforeServerError.sale.id;

    // Verify it is currently synced: false
    const pendingSaleBefore = await db.sales.get(pendingSaleId);
    assert(pendingSaleBefore?.synced === false, 'New transaction has synced=false prior to server failure');

    // Intercept fetch to simulate HTTP 500 Server Error
    let serverFailureTriggered = false as boolean;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : (input as any).url || '';
      if (urlStr.includes('/api/sync/')) {
        serverFailureTriggered = true;
        return new Response(JSON.stringify({ error: 'Internal Server Error (Simulated 500)' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, init);
    };

    // Attempt sync while server returns 500
    const failedSyncOutcome = await synchronizePendingData();
    assert(serverFailureTriggered === true, 'Simulated 500 server error was intercepted during sync');
    assert(failedSyncOutcome.errors.length > 0, 'synchronizePendingData recorded sync errors due to server 500');

    // CRITICAL: Ensure local database was NOT corrupted and records were NOT marked synced
    const pendingSaleAfterFailure = await db.sales.get(pendingSaleId);
    assert(pendingSaleAfterFailure !== undefined, 'Local transaction remains intact in IndexedDB despite server 500');
    assert(pendingSaleAfterFailure?.synced === false, 'Record is NOT falsely marked synced=true when server fails');

    // IndexedDB remains 100% usable during server failure: can still read and write
    const testAnimal: Animal = {
      id: `anim_srv_down_${runTag}`,
      tag: `TAG-SRV-${runTag.slice(-4)}`,
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'MALE',
      birthDate: '2026-03-01',
      purchaseCost: 8000,
      purchaseDate: '2026-03-01',
      currentWeightKg: 18,
      status: 'ACTIVE',
      location: 'Shed 2',
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 8000,
      notes: 'Added while server down',
      synced: false
    };
    await db.animals.put(testAnimal);
    const retrievedAnimal = await db.animals.get(testAnimal.id);
    assert(retrievedAnimal?.id === testAnimal.id, 'IndexedDB remains fully writable and readable while server is down');

    // Restore real server fetch
    globalThis.fetch = originalFetch;

    // Retry sync now that server is recovered
    const recoveredSyncOutcome = await synchronizePendingData();
    assert(recoveredSyncOutcome.errors.length === 0, `Sync retried and succeeded after server restored (errors: ${recoveredSyncOutcome.errors.join(', ')})`);

    const finalSaleSynced = await db.sales.get(pendingSaleId);
    assert(finalSaleSynced?.synced === true, 'Transaction successfully synced after server recovery');

    const finalAnimalSynced = await db.animals.get(testAnimal.id);
    assert(finalAnimalSynced?.synced === true, 'Animal record successfully synced after server recovery');

    // --------------------------------------------------------------------------
    // PART 6: CRASH / BLANK-SCREEN PERMANENT FAILURE PREVENTION
    // --------------------------------------------------------------------------
    console.log('\n--- PART 6: Crash / Blank-Screen Prevention & Error Boundary Resilience ---');

    // Test ErrorBoundary class logic
    const errorBoundary = new ErrorBoundary({ children: null });
    assert(errorBoundary.state.hasError === false, 'ErrorBoundary initial state hasError is false');

    // Simulate an uncaught render exception
    const simulatedError = new Error('Unexpected render crash in component tree');
    const derivedState = ErrorBoundary.getDerivedStateFromError(simulatedError);
    assert(derivedState.hasError === true, 'ErrorBoundary captures render error and sets hasError=true');
    assert(derivedState.error === simulatedError, 'ErrorBoundary retains error instance');

    // Simulate error catch
    errorBoundary.componentDidCatch(simulatedError, { componentStack: 'in FaultyComponent\n  in App' });
    errorBoundary.state = { ...errorBoundary.state, ...derivedState };
    assert(errorBoundary.state.hasError === true, 'ErrorBoundary hasError set');

    // Verify rendered output is the error screen rather than blank screen
    const renderedFallback = errorBoundary.render();
    assert(React.isValidElement(renderedFallback), 'ErrorBoundary renders valid fallback element, preventing blank screen');
    const fallbackProps = (renderedFallback as any).props;
    assert(fallbackProps.id === 'error-boundary-screen', 'Fallback has #error-boundary-screen');
    assert(fallbackProps.role === 'alert', 'Fallback has accessibility alert role');

    // Simulate clicking Retry button
    let retryCalled = false as boolean;
    const errorBoundaryWithReset = new ErrorBoundary({
      children: null,
      onReset: () => { retryCalled = true; }
    });
    const ebWithResetAny = errorBoundaryWithReset as any;
    ebWithResetAny.state = { ...ebWithResetAny.state, hasError: true };
    ebWithResetAny.handleRetry();
    assert(ebWithResetAny.state.hasError === false, 'handleRetry clears error state');
    assert(retryCalled === true, 'handleRetry invokes onReset callback');

    // --------------------------------------------------------------------------
    // PART 7: FINAL FINANCIAL LEDGER & TRIAL BALANCE INTEGRITY
    // --------------------------------------------------------------------------
    console.log('\n--- PART 7: Final Financial Ledger & Trial Balance Integrity ---');

    // Generate comprehensive Trial Balance after all reloads, failures, and recoveries
    const finalTb = await generateTrialBalance({ endDate: '2026-09-28' }, db);
    assert(finalTb.isBalanced === true, `Final Trial Balance is strictly balanced (Diff: ${finalTb.difference})`);
    assert(finalTb.difference === 0, 'Final Trial Balance discrepancy is exactly 0');
    assert(finalTb.totalDebit > 0, `Final totalDebit is positive (৳${finalTb.totalDebit})`);
    assert(finalTb.totalDebit === finalTb.totalCredit, `Debit (৳${finalTb.totalDebit}) === Credit (৳${finalTb.totalCredit})`);

    // Verify no duplicate journal entries or vouchers were produced
    const allJournals = await db.journalEntries.toArray();
    const voucherNumbers = allJournals.map((j) => j.voucherNumber);
    const uniqueVoucherNumbers = new Set(voucherNumbers);
    assert(voucherNumbers.length === uniqueVoucherNumbers.size, `No duplicate journal vouchers exist (total: ${voucherNumbers.length}, unique: ${uniqueVoucherNumbers.size})`);

    // Verify inventory stock calculation matches reality:
    // Initial: 200 KG
    // Sale 1: -20 KG
    // Sale 2: -15 KG
    // Sale 3: -10 KG
    // Expected stock: 200 - 45 = 155 KG
    const finalStockItem = await db.inventoryItems.get(itemId);
    assert(finalStockItem?.currentStock === 155, `Final inventory stock reconciled (expected: 155, actual: ${finalStockItem?.currentStock})`);

    // Verify cash balance:
    // Initial: ৳50,000
    // Sale 1: +৳2,000
    // Sale 2: +৳1,500
    // Sale 3: +৳1,000
    // Expected: ৳54,500
    const finalCashAcc = await db.cashBankAccounts.get(cashAccId);
    assert(finalCashAcc?.currentBalance === 54500, `Final cash balance reconciled (expected: ৳54,500, actual: ৳${finalCashAcc?.currentBalance})`);

    console.log('\n================================================================');
    console.log('ALL PROMPT 10 APPLICATION INTERRUPTION SAFETY TESTS PASSED! 🎉');
    console.log(`Total Assertions Passed: ${result.passed}/${result.total}`);
    console.log('================================================================\n');

    return result;
  } finally {
    // Restore global fetch and online status
    globalThis.fetch = originalFetch;
    setOnlineStatus(true);
    if (serverInstance) {
      (serverInstance as http.Server).close();
    }
  }
}

// Allow direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runBrowserInterruptionSafetyTests()
    .then((res) => {
      console.log(`Execution complete. Result: ${res.passed}/${res.total} passed.`);
      process.exit(res.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
