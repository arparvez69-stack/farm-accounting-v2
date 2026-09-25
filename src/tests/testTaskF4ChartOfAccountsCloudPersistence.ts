import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import {
  synchronizePendingData,
  restoreRemoteDataIfLocalEmpty
} from '../firebase/firebaseClient';
import { createSessionToken, inMemoryStores } from '../../server';
import { Account, JournalEntry } from '../types';
import {
  postJournalEntry,
  generateTrialBalance,
  generateProfitLoss,
  generateBalanceSheet
} from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF4ChartOfAccountsCloudPersistenceTests(): Promise<AssertionResult> {
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
  console.log('F4 TEST SUITE: CHART OF ACCOUNTS CLOUD PERSISTENCE & INTEGRITY');
  console.log('Testing Sync, Duplicate Protection, Stale Prevention & Reports');
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

  try {
    // ----------------------------------------------------
    // TEST 1: Default Chart of Accounts Preserved
    // ----------------------------------------------------
    console.log('--- TEST 1: Preserve Default Accounts ---');
    await db.accounts.clear();
    for (const defAcc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put({ ...defAcc, synced: true });
    }
    const defCount = await db.accounts.count();
    assert(defCount >= DEFAULT_CHART_OF_ACCOUNTS.length, `Local DB seeded with ${defCount} default accounts`);

    // ----------------------------------------------------
    // TEST 2: Creation and Automatic Sync of Custom Account
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Sync Custom Account via Sync Architecture ---');
    const customExpenseCode = `6${String(Math.floor(100 + Math.random() * 899))}`;
    const memAccounts = inMemoryStores.get('accounts');
    if (memAccounts) {
      for (const [key, val] of memAccounts.entries()) {
        if (val?.code === customExpenseCode) memAccounts.delete(key);
      }
    }
    const memJournal = inMemoryStores.get('journalEntries');
    if (memJournal) {
      for (const [key, val] of memJournal.entries()) {
        if (val?.lines?.some((l: any) => l.accountCode === customExpenseCode)) memJournal.delete(key);
      }
    }
    const customExpenseAccount: Account = {
      id: `acc_${customExpenseCode}`,
      code: customExpenseCode,
      nameBn: 'বিশেষ ভেটেরিনারি পরামর্শ ফি (Custom Vet Fee)',
      nameEn: 'Custom Vet Consultation Fee',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: false,
      isActive: true,
      synced: false,
      createdAt: '2026-09-24T10:00:00.000Z',
      updatedAt: '2026-09-24T10:00:00.000Z'
    };
    await db.accounts.put(customExpenseAccount);

    // Verify pending detection
    const pendingBefore = await db.accounts.filter(a => a.synced === false).count();
    assert(pendingBefore >= 1, `Found ${pendingBefore} pending account(s) before sync`);

    // Synchronize pending data
    const syncRes = await synchronizePendingData();
    assert(syncRes.errors.length === 0, `Sync completed without errors: ${syncRes.errors.join(', ')}`);

    const localAccountAfter = await db.accounts.get(customExpenseAccount.id);
    assert(localAccountAfter?.synced === true, 'Local account marked synced: true');

    // Verify server received the account via restore API
    const restoreCheckRes = await fetch(`${serverBaseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    assert(restoreCheckRes.ok, `Server restore endpoint reachable: HTTP ${restoreCheckRes.status}`);
    const restoreCheckJson = await restoreCheckRes.json();
    const serverAcc = restoreCheckJson.collections?.accounts?.find((a: any) => a.code === customExpenseCode);
    assert(serverAcc !== undefined, 'Account persisted in server cloud store');
    assert(serverAcc?.id === customExpenseAccount.id, 'Server account preserved exact ID');
    assert(serverAcc?.code === customExpenseCode, 'Server account preserved exact code');
    assert(serverAcc?.nameEn === customExpenseAccount.nameEn, 'Server account preserved exact English name');
    assert(serverAcc?.accountClass === 'EXPENSE', 'Server account preserved exact accountClass');

    // ----------------------------------------------------
    // TEST 3: Duplicate Account Prevention on Server
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Duplicate Account Prevention on Server ---');
    // Try to sync another account with the SAME code '6950' but a different ID
    const duplicateCodePayload = {
      id: `acc_dup_${Date.now()}`,
      code: customExpenseCode,
      nameBn: 'অন্যান্য পরামর্শ ফি (Duplicate)',
      nameEn: 'Duplicate Fee',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      synced: false,
      updatedAt: '2026-09-24T11:00:00.000Z'
    };

    const dupRes = await fetch(`${serverBaseUrl}/api/sync/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(duplicateCodePayload)
    });
    assert(dupRes.ok, `Duplicate code sync request handled gracefully: HTTP ${dupRes.status}`);
    const dupJson = await dupJsonOrEmpty(dupRes);
    assert(dupJson.id === customExpenseAccount.id, `Server merged to existing account ID (${customExpenseAccount.id}) rather than creating duplicate`);

    // ----------------------------------------------------
    // TEST 4: Stale Local Data Overwrite Prevention
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Prevent Stale Data Overwriting Newer Cloud Data ---');
    // Set cloud account updatedAt to 2026-09-24T15:00:00.000Z
    const cloudUpdatePayload = {
      id: customExpenseAccount.id,
      code: customExpenseCode,
      nameEn: 'Latest Cloud Name 15:00',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      updatedAt: '2026-09-24T15:00:00.000Z'
    };
    const updateRes = await fetch(`${serverBaseUrl}/api/sync/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(cloudUpdatePayload)
    });
    assert(updateRes.ok, `Updated cloud account to 15:00: HTTP ${updateRes.status}`);

    // Attempt to push stale local update with timestamp 2026-09-24T12:00:00.000Z
    const stalePayload = {
      id: customExpenseAccount.id,
      code: customExpenseCode,
      nameEn: 'Old Stale Name 12:00',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      updatedAt: '2026-09-24T12:00:00.000Z'
    };
    const staleRes = await fetch(`${serverBaseUrl}/api/sync/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(stalePayload)
    });
    assert(staleRes.ok, `Stale request handled: HTTP ${staleRes.status}`);
    const staleJson = await dupJsonOrEmpty(staleRes);
    assert(staleJson.staleIgnored === true, 'Server detected stale data and flagged staleIgnored: true');

    const verifyCloudRes = await fetch(`${serverBaseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${validSessionToken}` }
    });
    const verifyCloudJson = await verifyCloudRes.json();
    const cloudAfterStale = verifyCloudJson.collections?.accounts?.find((a: any) => a.code === customExpenseCode);
    assert(cloudAfterStale?.nameEn === 'Latest Cloud Name 15:00', 'Cloud account data preserved newer state');

    // ----------------------------------------------------
    // TEST 5: Protect System Accounts from Unsafe Class Alteration
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Protect System Accounts from Corruption ---');
    // Try to change system cash account 1010 to an EXPENSE
    const maliciousPayload = {
      id: 'acc_1010',
      code: '1010',
      nameBn: 'নগদ ক্যাশ (Corrupted)',
      accountClass: 'EXPENSE', // Illegal modification of system asset
      normalBalance: 'DEBIT'
    };
    const malRes = await fetch(`${serverBaseUrl}/api/sync/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(maliciousPayload)
    });
    assert(malRes.status === 400, `Rejected illegal class alteration of system account with HTTP ${malRes.status}`);

    // ----------------------------------------------------
    // TEST 6: Server Recognizes Custom Account for Transaction Sync
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Server Validates Transactions with Custom Account ---');
    // Post a journal entry using the custom account to /api/sync/journal
    const serverJournalPayload = {
      id: `jrn_f4_server_test_${Date.now()}`,
      voucherNumber: `JV-F4-SRV-${Date.now()}`,
      voucherType: 'JOURNAL',
      date: '2026-09-24',
      narration: 'Server sync test for custom account',
      lines: [
        {
          id: `line_1_${Date.now()}`,
          accountCode: customExpenseCode,
          accountName: 'Custom Fee',
          debit: 1000,
          credit: 0
        },
        {
          id: `line_2_${Date.now()}`,
          accountCode: '1010',
          accountName: 'Cash',
          debit: 0,
          credit: 1000
        }
      ],
      createdAt: new Date().toISOString()
    };
    const jrnRes = await fetch(`${serverBaseUrl}/api/sync/journal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validSessionToken}`
      },
      body: JSON.stringify(serverJournalPayload)
    });
    assert(jrnRes.ok, `Server accepted journal entry using custom account ${customExpenseCode}: HTTP ${jrnRes.status}`);

    // ----------------------------------------------------
    // TEST 7: Cloud Restore Brings Back Custom Accounts Without Duplicates
    // ----------------------------------------------------
    console.log('\n--- TEST 7: Cloud Restore Brings Back Custom Accounts ---');
    // Simulate empty local database on a new browser/device
    await db.accounts.clear();
    const countBeforeRestore = await db.accounts.count();
    assert(countBeforeRestore === 0, 'Local accounts table cleared for clean restore test');

    const restoreRes = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true);
    assert(restoreRes.restored === true, 'restoreRemoteDataIfLocalEmpty returned restored: true');

    const restoredCustomAcc = await db.accounts.where('code').equals(customExpenseCode).first();
    assert(restoredCustomAcc !== undefined, `Custom account ${customExpenseCode} successfully restored from cloud`);
    assert(restoredCustomAcc?.accountClass === 'EXPENSE', 'Restored custom account has correct accountClass');
    assert(restoredCustomAcc?.synced === true, 'Restored custom account marked synced: true');

    // Test idempotent second restore to confirm no duplicates are created
    await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true);
    const matchingAccounts = await db.accounts.where('code').equals(customExpenseCode).toArray();
    assert(matchingAccounts.length === 1, `Exactly 1 account exists for code ${customExpenseCode} (No duplicates on multiple restores)`);

    // ----------------------------------------------------
    // TEST 8: Custom Account Usability in Journal Entry & Financial Reports
    // ----------------------------------------------------
    console.log('\n--- TEST 8: Custom Account Usable in Journal Entry & Reports ---');
    let cashAcc = await db.accounts.where('code').equals('1010').first();
    if (!cashAcc) {
      cashAcc = DEFAULT_CHART_OF_ACCOUNTS.find(a => a.code === '1010')!;
      await db.accounts.put({ ...cashAcc, synced: true });
    }

    const testVoucherNumber = `JRN-F4-${Date.now()}`;
    const journalEntry: JournalEntry = {
      id: `je_${Date.now()}`,
      voucherNumber: testVoucherNumber,
      voucherType: 'JOURNAL',
      date: '2026-09-24',
      narration: 'F4 Test: Custom account consultation fee paid via cash',
      lines: [
        {
          id: `line_1_${Date.now()}`,
          accountCode: customExpenseCode,
          accountName: restoredCustomAcc?.nameBn || 'Consultation fee',
          debit: 3500,
          credit: 0,
          memo: 'Consultation fee'
        },
        {
          id: `line_2_${Date.now()}`,
          accountCode: '1010',
          accountName: cashAcc.nameBn,
          debit: 0,
          credit: 3500,
          memo: 'Cash disbursed'
        }
      ],
      createdBy: 'test-owner',
      createdAt: new Date().toISOString(),
      synced: false
    };

    const postResult = await postJournalEntry(journalEntry);
    assert(postResult !== undefined && postResult.id === journalEntry.id, 'Journal entry posted with custom account');

    // Verify Trial Balance (1000 from restored cloud journal entry + 3500 from local entry = 4500)
    const trialBalance = await generateTrialBalance();
    const tbCustomRow = trialBalance.rows.find(r => r.code === customExpenseCode);
    assert(tbCustomRow !== undefined, `Custom account ${customExpenseCode} appears in Trial Balance`);
    assert(tbCustomRow?.debit === 4500, `Trial Balance shows correct debit of 4500 (found ${tbCustomRow?.debit})`);
    assert(trialBalance.isBalanced, 'Trial Balance remains balanced (Total Debit == Total Credit)');

    // Verify Profit & Loss
    const pl = await generateProfitLoss();
    const plExpenseLine = pl.operatingExpenses.find(l => l.code === customExpenseCode);
    assert(plExpenseLine !== undefined, `Custom account ${customExpenseCode} appears in Profit & Loss expenses`);
    assert(plExpenseLine?.amount === 4500, `Profit & Loss reflects exact expense of 4500 (found ${plExpenseLine?.amount})`);

    // Verify Balance Sheet
    const bs = await generateBalanceSheet();
    assert(bs !== undefined && typeof bs.totalAssets === 'number', 'Balance Sheet generated successfully without errors');

    // Clean up test journal entry
    await db.journalEntries.delete(journalEntry.id);
    await db.accounts.delete(customExpenseAccount.id);

    console.log('\n========================================================');
    console.log(`F4 TEST RESULTS: ${result.passed}/${result.total} PASSED (${result.failed} FAILED)`);
    console.log('========================================================\n');
  } catch (err: any) {
    assert(false, `Unexpected error during F4 tests: ${err.message}`);
  }

  return result;
}

async function dupJsonOrEmpty(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testTaskF4ChartOfAccountsCloudPersistence')) {
  runTaskF4ChartOfAccountsCloudPersistenceTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
}
