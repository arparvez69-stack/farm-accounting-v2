import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { synchronizePendingData } from '../firebase/firebaseClient';
import { createSessionToken } from '../../server';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF6VersionConflictProtectionTests(): Promise<AssertionResult> {
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
  console.log('F6 TEST SUITE: STALE OFFLINE DATA & CLOUD CONFLICT PROTECTION');
  console.log('Testing Version Comparison, Timestamps, Idempotency & Financial Safety');
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

  const serverBaseUrl = `http://localhost:${process.env.PORT || 3000}`;
  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);
  localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken, email: testOwnerEmail }));

  async function fetchCloudRestore(): Promise<any> {
    const res = await fetch(`${serverBaseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    return res.json().catch(() => ({ collections: {} }));
  }

  try {
    // ----------------------------------------------------
    // TEST 1: Newly Created Record with No Previous Cloud Version
    // ----------------------------------------------------
    console.log('--- TEST 1: Newly Created Record with No Cloud Version ---');
    const newAnimalId = `animal_new_${Date.now()}`;
    const newAnimalPayload = {
      id: newAnimalId,
      tagNumber: 'COW-001',
      name: 'Dairy Cow Alpha',
      category: 'CATTLE',
      species: 'COW',
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const res1 = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(newAnimalPayload)
    });
    assert(res1.ok, `New record created successfully: HTTP ${res1.status}`);

    const cloudRestore1 = await fetchCloudRestore();
    const cloudDoc = cloudRestore1.collections?.animals?.find((a: any) => a.id === newAnimalId);
    assert(cloudDoc?.name === 'Dairy Cow Alpha', 'Cloud store correctly saved new record without conflict');

    // ----------------------------------------------------
    // TEST 2: Cloud Newer by Explicit Version
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Cloud Newer by Explicit Version ---');
    const animalVId = `animal_ver_${Date.now()}`;
    // Seed cloud with version 2
    const seedCloudV2Res = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        id: animalVId,
        tagNumber: 'COW-002',
        name: 'Dairy Cow Beta Cloud v2',
        category: 'CATTLE',
        species: 'COW',
        status: 'ACTIVE',
        version: 2,
        updatedAt: '2026-09-24T12:00:00Z'
      })
    });
    if (!seedCloudV2Res.ok) throw new Error('Failed to seed cloud v2');

    // Stale local client syncs version 1
    const staleVPayload = {
      id: animalVId,
      tagNumber: 'COW-002',
      name: 'Dairy Cow Beta Local Stale v1',
      category: 'CATTLE',
      species: 'COW',
      status: 'ACTIVE',
      version: 1,
      updatedAt: '2026-09-24T10:00:00Z'
    };

    const staleRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(staleVPayload)
    });
    assert(staleRes.ok, `Stale version sync handled: HTTP ${staleRes.status}`);

    const staleJson = await staleRes.json();
    assert(staleJson.staleIgnored === true, 'Server detected stale version and returned staleIgnored: true');
    assert(staleJson.conflict === true, 'Server explicitly flagged conflict: true');

    const cloudRestore2 = await fetchCloudRestore();
    const cloudRecord = cloudRestore2.collections?.animals?.find((a: any) => a.id === animalVId);
    assert(cloudRecord?.name === 'Dairy Cow Beta Cloud v2', 'Cloud record preserved newer v2 data against stale v1 overwrite');

    // ----------------------------------------------------
    // TEST 3: Local Newer by Explicit Version
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Local Newer by Explicit Version ---');
    const newerVPayload = {
      id: animalVId,
      tagNumber: 'COW-002',
      name: 'Dairy Cow Beta Local v3',
      category: 'CATTLE',
      species: 'COW',
      status: 'ACTIVE',
      version: 3,
      updatedAt: '2026-09-24T14:00:00Z'
    };

    const newerRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(newerVPayload)
    });
    assert(newerRes.ok, `Newer version sync accepted: HTTP ${newerRes.status}`);

    const newerJson = await newerRes.json();
    assert(!newerJson.staleIgnored, 'Newer local version not flagged as stale');

    const cloudRestore3 = await fetchCloudRestore();
    const cloudAfterLocalNewer = cloudRestore3.collections?.animals?.find((a: any) => a.id === animalVId);
    assert(cloudAfterLocalNewer?.version === 3, 'Cloud updated to local version 3');
    assert(cloudAfterLocalNewer?.name === 'Dairy Cow Beta Local v3', 'Cloud successfully persisted newer local version data');

    // ----------------------------------------------------
    // TEST 4: Cloud Newer When Version is Missing but Timestamp Proves Newer
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Cloud Newer by Timestamp (Version Missing) ---');
    const reminderId = `reminder_${Date.now()}`;
    const seedCloudTsRes = await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        id: reminderId,
        title: 'Vaccination Alert',
        name: 'Reminder Cloud 15:00',
        updatedAt: '2026-09-24T15:00:00Z'
      })
    });
    if (!seedCloudTsRes.ok) throw new Error('Failed to seed reminder');

    // Local client has older timestamp (10:00) with no version field
    const staleTsPayload = {
      id: reminderId,
      title: 'Vaccination Alert',
      name: 'Reminder Local Stale 10:00',
      updatedAt: '2026-09-24T10:00:00Z'
    };

    const staleTsRes = await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(staleTsPayload)
    });
    assert(staleTsRes.ok, `Stale timestamp sync handled: HTTP ${staleTsRes.status}`);

    const staleTsJson = await staleTsRes.json();
    assert(staleTsJson.staleIgnored === true, 'Server detected older timestamp and set staleIgnored: true');
    assert(staleTsJson.conflict === true, 'Server flagged conflict: true for timestamp conflict');

    const cloudRestore4 = await fetchCloudRestore();
    const cloudTsRecord = cloudRestore4.collections?.reminders?.find((r: any) => r.id === reminderId);
    assert(cloudTsRecord?.name === 'Reminder Cloud 15:00', 'Cloud record preserved newer timestamp data');

    // ----------------------------------------------------
    // TEST 5: Local Newer When Version is Missing but Timestamp Proves Newer
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Local Newer by Timestamp (Version Missing) ---');
    const newerTsPayload = {
      id: reminderId,
      title: 'Vaccination Alert',
      name: 'Reminder Local 16:00',
      updatedAt: '2026-09-24T16:00:00Z'
    };

    const newerTsRes = await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(newerTsPayload)
    });
    assert(newerTsRes.ok, `Newer timestamp sync accepted: HTTP ${newerTsRes.status}`);

    const newerTsJson = await newerTsRes.json();
    assert(!newerTsJson.staleIgnored, 'Newer timestamp record not marked as stale');

    const cloudRestore5 = await fetchCloudRestore();
    const cloudAfterNewerTs = cloudRestore5.collections?.reminders?.find((r: any) => r.id === reminderId);
    assert(cloudAfterNewerTs?.name === 'Reminder Local 16:00', 'Cloud updated to newer local timestamp data');

    // ----------------------------------------------------
    // TEST 6: Identical Record Retry (Idempotency)
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Identical Record Retry (Idempotency) ---');
    const retryRes = await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(newerTsPayload)
    });
    assert(retryRes.ok, `Identical retry responded with HTTP ${retryRes.status}`);

    const retryJson = await retryRes.json();
    assert(retryJson.idempotent === true || retryJson.success === true, 'Identical retry confirmed idempotent without error');

    // ----------------------------------------------------
    // TEST 7: Stale Retry After Cloud Has Advanced
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Stale Retry After Cloud Has Advanced ---');
    // Cloud advances further to 18:00
    await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        ...newerTsPayload,
        name: 'Reminder Advanced Cloud 18:00',
        updatedAt: '2026-09-24T18:00:00Z'
      })
    });

    const staleAdvRes = await fetch(`${serverBaseUrl}/api/sync/reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(newerTsPayload) // timestamp 16:00
    });
    assert(staleAdvRes.ok, `Advanced cloud stale retry handled: HTTP ${staleAdvRes.status}`);

    const staleAdvJson = await staleAdvRes.json();
    assert(staleAdvJson.staleIgnored === true, 'Stale retry safely ignored after cloud advanced');

    // ----------------------------------------------------
    // TEST 8: Financial Transaction Mutation Protection
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Financial Transaction Mutation Protection ---');
    const journalId = `jnl_${Date.now()}`;
    const initialJournal = {
      id: journalId,
      voucherNumber: `JV-${Date.now()}`,
      date: '2026-09-20',
      totalDebit: 5000,
      totalCredit: 5000,
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, debit: 5000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.CASH, debit: 0, credit: 5000 }
      ]
    };

    const journalCreateRes = await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(initialJournal)
    });
    assert(journalCreateRes.ok, `Initial financial transaction posted: HTTP ${journalCreateRes.status}`);

    // Attempt illegal mutation: altering totalDebit/credit and line amount
    const mutatedJournal = {
      ...initialJournal,
      totalDebit: 8000,
      totalCredit: 8000,
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, debit: 8000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.CASH, debit: 0, credit: 8000 }
      ]
    };

    const journalMutateRes = await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(mutatedJournal)
    });
    assert(journalMutateRes.status === 400, 'Server rejected illegal financial transaction mutation with HTTP 400');

    // Attempt illegal mutation on a Sale invoice
    const saleId = `sale_${Date.now()}`;
    const initialSale = {
      id: saleId,
      invoiceNumber: `INV-${Date.now()}`,
      date: '2026-09-20',
      totalAmount: 10000,
      items: [{ name: 'Milk', quantity: 100, price: 100 }]
    };

    await fetch(`${serverBaseUrl}/api/sync/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(initialSale)
    });

    const mutateSaleRes = await fetch(`${serverBaseUrl}/api/sync/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        id: saleId,
        invoiceNumber: initialSale.invoiceNumber,
        totalAmount: 25000 // Illegal change
      })
    });
    assert(mutateSaleRes.status === 400, 'Server rejected arbitrary mutation of sale invoice totalAmount with HTTP 400');

    // Attempt illegal mutation on a Payment
    const paymentId = `pay_${Date.now()}`;
    const initialPayment = {
      id: paymentId,
      paymentNumber: `PAY-${Date.now()}`,
      amount: 4500,
      date: '2026-09-20'
    };

    await fetch(`${serverBaseUrl}/api/sync/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(initialPayment)
    });

    const mutatePayRes = await fetch(`${serverBaseUrl}/api/sync/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        id: paymentId,
        paymentNumber: initialPayment.paymentNumber,
        amount: 9000 // Illegal change
      })
    });
    assert(mutatePayRes.status === 400, 'Server rejected arbitrary mutation of payment amount with HTTP 400');

    // ----------------------------------------------------
    // TEST 9: Legitimate Reversal / Status Change
    // ----------------------------------------------------
    console.log('\n--- TEST 9: Legitimate Reversal / Status Change Allowed ---');
    const reversalPayload = {
      ...initialJournal,
      isReversed: true,
      reversalReason: 'Wrong party ledger selected',
      reversalVoucherNumber: `REV-${Date.now()}`
    };

    const reversalRes = await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(reversalPayload)
    });
    assert(reversalRes.ok, `Legitimate reversal status update accepted: HTTP ${reversalRes.status}`);

    // ----------------------------------------------------
    // TEST 10: Local IndexedDB Updated When Cloud Data Wins
    // ----------------------------------------------------
    console.log('\n--- TEST 10: Local IndexedDB Updated When Cloud Data Wins ---');
    const conflictAnimalId = `animal_sync_conflict_${Date.now()}`;
    // Cloud has authoritative newer state
    await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify({
        id: conflictAnimalId,
        tagNumber: 'COW-999',
        name: 'Cloud Animal 15:00',
        category: 'CATTLE',
        species: 'COW',
        status: 'ACTIVE',
        updatedAt: '2026-09-24T15:00:00Z'
      })
    });

    // Local IndexedDB has stale state with synced = false
    await db.animals.put({
      id: conflictAnimalId,
      tagNumber: 'COW-999',
      name: 'Local Stale Animal 10:00',
      category: 'CATTLE',
      species: 'COW',
      status: 'ACTIVE',
      updatedAt: '2026-09-24T10:00:00Z',
      synced: false
    } as any);

    // Run client offline-first sync
    await synchronizePendingData();

    // Verify local IndexedDB was updated to cloud's newer state and marked synced: true
    const localAfterSync = await db.animals.get(conflictAnimalId);
    assert(
      localAfterSync?.name === 'Cloud Animal 15:00' && localAfterSync?.synced === true,
      'When cloud data wins, local IndexedDB record safely updated to cloud state and marked synced: true'
    );

    // Clean up
    await db.animals.delete(conflictAnimalId);

    console.log('\n========================================================');
    console.log(`F6 TEST RESULTS: ${result.passed}/${result.total} PASSED (${result.failed} FAILED)`);
    console.log('========================================================\n');
  } catch (err: any) {
    assert(false, `Unexpected error during F6 tests: ${err.message}`);
  }

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testTaskF6VersionConflictProtection')) {
  runTaskF6VersionConflictProtectionTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    }
  });
}
