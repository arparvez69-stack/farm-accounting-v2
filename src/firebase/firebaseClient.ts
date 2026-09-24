import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { migrateLegacyAccounts } from '../accounting/accountingEngine';
import { SyncState, SystemConfig, UserProfile } from '../types';
import { recordSyncTime } from '../services/exportService';

// Helper to retrieve authorized owner emails received via authenticated API response
export function getStoredOwnerEmails(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('goted_owner_session') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.authorizedEmails) && parsed.authorizedEmails.length > 0) {
        return parsed.authorizedEmails;
      }
    }
  } catch {}
  return [];
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  ownerUid: 'the_goated_farm_owners',
  companyName: 'The Goated Farm',
  ownerEmails: [],
  companyAddress: 'ঢাকা, বাংলাদেশ',
  phone: '', // Set via app settings
  currency: '৳',
  initializedAt: new Date().toISOString()
};

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Auth with browserLocalPersistence ("Remember Me" across browser sessions)
export const auth = getAuth(app);
try {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase setPersistence warning:', err);
  });
} catch (e) {
  console.warn('Firebase persistence initialization error:', e);
}

// Initialize Firestore
export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

// Test connection on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(firestore, 'system', 'config'));
    return true;
  } catch (error) {
    console.warn('Firestore connection check notice:', error);
    return false;
  }
}

/**
 * Initialize default IndexedDB data (Chart of Accounts, Cash Account, System Config)
 */
export async function initializeLocalDatabase(): Promise<void> {
  const accountsCount = await db.accounts.count();
  if (accountsCount === 0) {
    await db.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS);
  } else {
    // Ensure all canonical default accounts exist in user's local database
    for (const defAcc of DEFAULT_CHART_OF_ACCOUNTS) {
      const existing = await db.accounts.where('code').equals(defAcc.code).first();
      if (!existing) {
        await db.accounts.put(defAcc);
      }
    }
  }

  // Ensure default system config in local IndexedDB
  const sysConfigs = await db.systemConfig.toArray();
  if (sysConfigs.length === 0) {
    await db.systemConfig.put(DEFAULT_SYSTEM_CONFIG);
  } else {
    const current = sysConfigs[0];
    const cleanedPhone = current.phone === '+8801700000000' ? '' : (current.phone || '');
    if (current.companyName !== 'The Goated Farm' || current.phone === '+8801700000000') {
      await db.systemConfig.put({
        ...current,
        companyName: 'The Goated Farm',
        phone: cleanedPhone,
        ownerEmails: current.ownerEmails || getStoredOwnerEmails()
      });
    }
  }

  // Automatically migrate legacy journal entries referencing discontinued accounts (e.g. 1050)
  // Only runs when the required migration has not already been completed.
  try {
    await migrateLegacyAccounts();
  } catch (err) {
    console.warn('Notice: Legacy accounts migration error:', err);
  }
}

/**
 * Silently seed or synchronize "The Goated Farm" system configuration
 */
export async function seedSystemConfigIfNecessary(authorizedEmails?: string[]): Promise<SystemConfig> {
  const localConfig = await db.systemConfig.toArray();
  const baseConfig: SystemConfig = localConfig.length > 0 ? localConfig[0] : DEFAULT_SYSTEM_CONFIG;
  const emails = authorizedEmails && authorizedEmails.length > 0
    ? authorizedEmails
    : (baseConfig.ownerEmails && baseConfig.ownerEmails.length > 0 ? baseConfig.ownerEmails : getStoredOwnerEmails());

  const targetConfig: SystemConfig = {
    ...baseConfig,
    companyName: 'The Goated Farm',
    ownerEmails: emails,
    currency: '৳'
  };

  await db.systemConfig.put(targetConfig);

  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(firestore, 'system', 'config'));
      if (!snap.exists()) {
        await syncRecordToServer('system', { id: 'config', ...targetConfig }).catch(() => {});
      }
    } catch (e) {
      console.warn('Silent config seed note (offline or rules check):', e);
    }
  }

  return targetConfig;
}

/**
 * Single-tenant bootstrap check: The Goated Farm is always bootstrapped
 */
export async function checkSystemBootstrap(): Promise<{ isBootstrapped: boolean; config: SystemConfig }> {
  const localConfig = await db.systemConfig.toArray();
  if (localConfig.length > 0) {
    return { isBootstrapped: true, config: localConfig[0] };
  }
  return { isBootstrapped: true, config: DEFAULT_SYSTEM_CONFIG };
}

/**
 * Resolve User Profile and Role for The Goated Farm
 * Authorized owners have full equal OWNER role.
 */
export async function resolveUserRole(user: User | null): Promise<UserProfile> {
  const allowed = getStoredOwnerEmails();

  // 1. Check Firebase Auth user email
  if (user && user.email) {
    const email = user.email.toLowerCase().trim();
    const isApproved = allowed.length === 0 || allowed.includes(email);
    const prof: UserProfile = {
      uid: user.uid,
      email: email,
      phoneNumber: user.phoneNumber || undefined,
      displayName: user.displayName || email.split('@')[0],
      role: isApproved ? 'OWNER' : 'UNAPPROVED',
      isApproved: isApproved
    };
    if (isApproved) {
      try {
        const prevRaw = localStorage.getItem('goted_owner_session');
        const prev = prevRaw ? JSON.parse(prevRaw) : {};
        localStorage.setItem('goted_owner_session', JSON.stringify({
          ...prev,
          uid: prof.uid,
          email: prof.email,
          displayName: prof.displayName,
          role: 'OWNER',
          authenticatedAt: new Date().toISOString()
        }));
      } catch (e) {
        // Ignore localStorage quota errors
      }
    }
    return prof;
  }

  // 2. Check local verified session in container dev environment
  const sessionRaw = localStorage.getItem('goted_owner_session');
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      if (session.email && session.email.includes('@')) {
        const email = session.email.toLowerCase().trim();
        const sessionAllowed = Array.isArray(session.authorizedEmails) && session.authorizedEmails.length > 0
          ? session.authorizedEmails
          : allowed;
        const isApproved = sessionAllowed.length === 0 || sessionAllowed.includes(email);
        return {
          uid: session.uid || `goted_owner_${email}`,
          email: email,
          displayName: session.displayName || email.split('@')[0],
          role: isApproved ? 'OWNER' : 'UNAPPROVED',
          isApproved: isApproved
        };
      }
    } catch (e) {
      localStorage.removeItem('goted_owner_session');
    }
  }

  return {
    uid: '',
    role: 'UNAUTHENTICATED',
    isApproved: false
  };
}

/**
 * Post records to authenticated server-side sync endpoints
 * Validates double-entry balance and accounts server-side, writes safely via Admin SDK
 */
async function syncRecordToServer(collection: string, data: any): Promise<any> {
  let token: string | null = null;
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {}
  }
  if (!token) {
    try {
      const session = JSON.parse(localStorage.getItem('goted_owner_session') || '{}');
      token = session.sessionToken || null;
    } catch {}
  }

  const baseUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : typeof process !== 'undefined' && process.env?.PORT
      ? `http://localhost:${process.env.PORT}`
      : 'http://localhost:3000';
  const endpoint = `${baseUrl}/api/sync/${collection}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Server returned ${res.status}: Cloud persistence failed`);
  }

  const json = await res.json().catch(() => ({ success: false, persisted: false }));
  // F7: Never claim cloud sync success without confirmed durable persistence
  if (!json || json.success !== true || json.persisted === false) {
    throw new Error(json?.error || 'ক্লাউড পারসিস্টেন্স নিশ্চিত হয়নি (Cloud persistence was not confirmed)');
  }

  return json;
}

/**
 * Handles sync result: a record is marked synced=true ONLY after confirmed durable cloud persistence.
 * If cloud was newer (staleIgnored), safely updates local IndexedDB record to authoritative
 * cloud state and marks synchronized (F6 conflict protection).
 */
async function handleSyncedResult(table: any, recordId: string, syncRes: any): Promise<void> {
  // F7: Never mark synced=true without confirmed durable cloud persistence
  if (!syncRes || syncRes.success !== true || syncRes.persisted === false) {
    throw new Error(syncRes?.error || 'Cloud persistence was not confirmed. Record remains unpersisted.');
  }

  if (syncRes?.staleIgnored && syncRes?.data) {
    await table.put({
      ...syncRes.data,
      id: syncRes.data.id || recordId,
      synced: true
    });
  } else {
    await table.update(recordId, { synced: true });
  }
}

let activeSyncPromise: Promise<{ syncedCount: number; errors: string[] }> | null = null;

/**
 * Synchronize pending offline data to server endpoints (Admin SDK write)
 */
export async function synchronizePendingData(): Promise<{ syncedCount: number; errors: string[] }> {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { syncedCount: 0, errors: ['Offline'] };
  }

  // Prevent duplicate concurrent sync runs
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    let count = 0;
    const errors: string[] = [];

    try {
      // 1. Sync Chart of Accounts (Custom and user-created ledgers must sync before journals)
      const pendingChartAccounts = await db.accounts.filter((acc) => acc.synced === false).toArray();
      for (const acc of pendingChartAccounts) {
        try {
          const syncRes = await syncRecordToServer('accounts', acc);
          await handleSyncedResult(db.accounts, acc.id, syncRes);
          count++;
        } catch (err: any) {
          errors.push(`Account ${acc.code} (${acc.nameBn}): ${err.message}`);
        }
      }

      // 2. Sync Animals
      const pendingAnimals = await db.animals.filter((a) => a.synced === false).toArray();
      for (const animal of pendingAnimals) {
        try {
          const syncRes = await syncRecordToServer('animals', animal);
          await handleSyncedResult(db.animals, animal.id, syncRes);
          count++;
        } catch (err: any) {
          errors.push(`Animal ${animal.id}: ${err.message}`);
        }
      }

    // 2. Sync Fish Batches
    const pendingFish = await db.fishBatches.filter((b) => b.synced === false).toArray();
    for (const batch of pendingFish) {
      try {
        const syncRes = await syncRecordToServer('fishBatches', batch);
        await handleSyncedResult(db.fishBatches, batch.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Fish batch ${batch.id}: ${err.message}`);
      }
    }

    // 3. Sync Crop Cycles
    const pendingCrops = await db.cropCycles.filter((c) => c.synced === false).toArray();
    for (const crop of pendingCrops) {
      try {
        const syncRes = await syncRecordToServer('cropCycles', crop);
        await handleSyncedResult(db.cropCycles, crop.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Crop cycle ${crop.id}: ${err.message}`);
      }
    }

    // 4. Sync Journal Entries (re-validates debit/credit server-side)
    const pendingJournals = await db.journalEntries.filter((j) => j.synced === false).toArray();
    for (const j of pendingJournals) {
      try {
        const syncRes = await syncRecordToServer('journalEntries', j);
        await handleSyncedResult(db.journalEntries, j.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Journal ${j.voucherNumber}: ${err.message}`);
      }
    }

    // 5. Sync Purchases
    const pendingPurchases = await db.purchases.filter((p) => p.synced === false).toArray();
    for (const p of pendingPurchases) {
      try {
        const syncRes = await syncRecordToServer('purchases', p);
        await handleSyncedResult(db.purchases, p.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Purchase ${p.invoiceNumber}: ${err.message}`);
      }
    }

    // 6. Sync Sales
    const pendingSales = await db.sales.filter((s) => s.synced === false).toArray();
    for (const s of pendingSales) {
      try {
        const syncRes = await syncRecordToServer('sales', s);
        await handleSyncedResult(db.sales, s.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Sale ${s.invoiceNumber}: ${err.message}`);
      }
    }

    // 7. Sync Audit Logs
    const pendingAudit = await db.auditLogs.filter((a) => a.synced === false).toArray();
    for (const a of pendingAudit) {
      try {
        const syncRes = await syncRecordToServer('auditLogs', a);
        await handleSyncedResult(db.auditLogs, a.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Audit ${a.id}: ${err.message}`);
      }
    }

    // 8. Sync Payments
    const pendingPayments = await db.payments.filter((p) => !p.synced).toArray();
    for (const p of pendingPayments) {
      try {
        const syncRes = await syncRecordToServer('payments', p);
        await handleSyncedResult(db.payments, p.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Payment ${p.id}: ${err.message}`);
      }
    }

    // 9. Sync Inventory Items
    const pendingInventory = await db.inventoryItems.filter((item) => !item.synced).toArray();
    for (const item of pendingInventory) {
      try {
        const syncRes = await syncRecordToServer('inventoryItems', item);
        await handleSyncedResult(db.inventoryItems, item.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Inventory item ${item.id}: ${err.message}`);
      }
    }

    // 10. Sync Stock Movements
    const pendingStock = await db.stockMovements.filter((m) => !m.synced).toArray();
    for (const sm of pendingStock) {
      try {
        const syncRes = await syncRecordToServer('stockMovements', sm);
        await handleSyncedResult(db.stockMovements, sm.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Stock movement ${sm.id}: ${err.message}`);
      }
    }

    // 11. Sync Cash & Bank Accounts
    const pendingAccounts = await db.cashBankAccounts.filter((acc) => !acc.synced).toArray();
    for (const acc of pendingAccounts) {
      try {
        const syncRes = await syncRecordToServer('cashBankAccounts', acc);
        await handleSyncedResult(db.cashBankAccounts, acc.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Cash/Bank Account ${acc.id}: ${err.message}`);
      }
    }

    // 12. Sync Loans
    const pendingLoans = await db.loans.filter((loan) => !loan.synced).toArray();
    for (const loan of pendingLoans) {
      try {
        const syncRes = await syncRecordToServer('loans', loan);
        await handleSyncedResult(db.loans, loan.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Loan ${loan.id}: ${err.message}`);
      }
    }

    // 13. Sync Investors
    const pendingInvestors = await db.investors.filter((inv) => !inv.synced).toArray();
    for (const inv of pendingInvestors) {
      try {
        const syncRes = await syncRecordToServer('investors', inv);
        await handleSyncedResult(db.investors, inv.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Investor ${inv.id}: ${err.message}`);
      }
    }

    // 14. Sync Fixed Assets
    const pendingAssets = await db.fixedAssets.filter((asset) => !asset.synced).toArray();
    for (const asset of pendingAssets) {
      try {
        const syncRes = await syncRecordToServer('fixedAssets', asset);
        await handleSyncedResult(db.fixedAssets, asset.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Fixed Asset ${asset.id}: ${err.message}`);
      }
    }

    // 15. Sync Parties (Customers & Suppliers)
    const pendingParties = await db.parties.filter((party) => !party.synced).toArray();
    for (const party of pendingParties) {
      try {
        const syncRes = await syncRecordToServer('parties', party);
        await handleSyncedResult(db.parties, party.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Party ${party.id}: ${err.message}`);
      }
    }

    // 16. Sync Closed Periods
    const pendingClosedPeriods = await db.closedPeriods.filter((period) => !period.synced).toArray();
    for (const period of pendingClosedPeriods) {
      try {
        const syncRes = await syncRecordToServer('closedPeriods', period);
        await handleSyncedResult(db.closedPeriods, period.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Closed Period ${period.id}: ${err.message}`);
      }
    }

    // 17. Sync Bank Transfers (Operational & contra records)
    const pendingTransfers = await db.bankTransfers.filter((t) => !t.synced).toArray();
    for (const bt of pendingTransfers) {
      try {
        const syncRes = await syncRecordToServer('bankTransfers', bt);
        await handleSyncedResult(db.bankTransfers, bt.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Bank Transfer ${bt.id}: ${err.message}`);
      }
    }

    // 18. Sync Animal Events (Feed, treatment, vaccine, etc.)
    const pendingAnimalEvents = await db.animalEvents.filter((e) => !e.synced).toArray();
    for (const ev of pendingAnimalEvents) {
      try {
        const syncRes = await syncRecordToServer('animalEvents', ev);
        await handleSyncedResult(db.animalEvents, ev.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Animal Event ${ev.id}: ${err.message}`);
      }
    }

    // 19. Sync Reminders
    const pendingReminders = await db.reminders.filter((r) => !r.synced).toArray();
    for (const rem of pendingReminders) {
      try {
        const syncRes = await syncRecordToServer('reminders', rem);
        await handleSyncedResult(db.reminders, rem.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Reminder ${rem.id}: ${err.message}`);
      }
    }

    // 20. Sync Internal Resource Flows (Permaculture)
    const pendingFlows = await db.internalFlows.filter((f) => !f.synced).toArray();
    for (const fl of pendingFlows) {
      try {
        const syncRes = await syncRecordToServer('internalFlows', fl);
        await handleSyncedResult(db.internalFlows, fl.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Internal Flow ${fl.id}: ${err.message}`);
      }
    }

    // 21. Sync Processing & Recipe Runs
    const pendingProcessing = await db.processingRuns.filter((pr) => !pr.synced).toArray();
    for (const pr of pendingProcessing) {
      try {
        const syncRes = await syncRecordToServer('processingRuns', pr);
        await handleSyncedResult(db.processingRuns, pr.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Processing Run ${pr.id}: ${err.message}`);
      }
    }

    // 22. Sync Ponds
    const pendingPonds = await db.ponds.filter((p) => !p.synced).toArray();
    for (const p of pendingPonds) {
      try {
        const syncRes = await syncRecordToServer('ponds', p);
        await handleSyncedResult(db.ponds, p.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Pond ${p.id}: ${err.message}`);
      }
    }

    // 23. Sync Plots
    const pendingPlots = await db.plots.filter((p) => !p.synced).toArray();
    for (const p of pendingPlots) {
      try {
        const syncRes = await syncRecordToServer('plots', p);
        await handleSyncedResult(db.plots, p.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Plot ${p.id}: ${err.message}`);
      }
    }

    // 24. Sync Security Access Logs
    const pendingAccessLogs = await db.accessLogs.filter((al) => !al.synced).toArray();
    for (const al of pendingAccessLogs) {
      try {
        const syncRes = await syncRecordToServer('accessLogs', al);
        await handleSyncedResult(db.accessLogs, al.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Access Log ${al.id}: ${err.message}`);
      }
    }

    // 25. Sync Recurring Expense Templates
    const pendingRecurring = await db.recurringExpenseTemplates.filter((rt) => !rt.synced).toArray();
    for (const rt of pendingRecurring) {
      try {
        const syncRes = await syncRecordToServer('recurringExpenseTemplates', rt);
        await handleSyncedResult(db.recurringExpenseTemplates, rt.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Recurring Template ${rt.id}: ${err.message}`);
      }
    }

    // 26. Sync Sales Returns
    const pendingSalesReturns = await db.salesReturns.filter((sr) => !sr.synced).toArray();
    for (const sr of pendingSalesReturns) {
      try {
        const syncRes = await syncRecordToServer('salesReturns', sr);
        await handleSyncedResult(db.salesReturns, sr.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Sales Return ${sr.id}: ${err.message}`);
      }
    }

    // 27. Sync Purchase Returns
    const pendingPurchaseReturns = await db.purchaseReturns.filter((pr) => !pr.synced).toArray();
    for (const pr of pendingPurchaseReturns) {
      try {
        const syncRes = await syncRecordToServer('purchaseReturns', pr);
        await handleSyncedResult(db.purchaseReturns, pr.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Purchase Return ${pr.id}: ${err.message}`);
      }
    }

    // 28. Sync Advance Payments
    const pendingAdvancePayments = await db.advancePayments.filter((ap) => !ap.synced).toArray();
    for (const ap of pendingAdvancePayments) {
      try {
        const syncRes = await syncRecordToServer('advancePayments', ap);
        await handleSyncedResult(db.advancePayments, ap.id, syncRes);
        count++;
      } catch (err: any) {
        errors.push(`Advance Payment ${ap.id}: ${err.message}`);
      }
    }
  } catch (globalErr: any) {
    errors.push(`Sync failed: ${globalErr.message}`);
  }

    if (count > 0) {
      recordSyncTime();
    }

    return { syncedCount: count, errors };
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

/**
 * Fetch System Configuration (Local first, then remote)
 */
export async function fetchSystemConfig(): Promise<SystemConfig | null> {
  const local = await db.systemConfig.toArray();
  if (local.length > 0) return local[0];
  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(firestore, 'system', 'config'));
      if (snap.exists()) {
        const cfg = snap.data() as SystemConfig;
        await db.systemConfig.put(cfg);
        return cfg;
      }
    } catch (e) {
      console.warn('fetchSystemConfig remote error:', e);
    }
  }
  return DEFAULT_SYSTEM_CONFIG;
}

/**
 * Listen to network state and auto-synchronize
 */
export function listenToOnlineSync(
  onStateChange: (state: SyncState) => void,
  onPendingChange: (count: number) => void
): () => void {
  let isRunning = false;

  const updatePending = async () => {
    try {
      const pAnimals = await db.animals.filter((a) => a.synced === false).count();
      const pFish = await db.fishBatches.filter((b) => b.synced === false).count();
      const pCrops = await db.cropCycles.filter((c) => c.synced === false).count();
      const pJournals = await db.journalEntries.filter((j) => j.synced === false).count();
      const pPurchases = await db.purchases.filter((p) => p.synced === false).count();
      const pSales = await db.sales.filter((s) => s.synced === false).count();
      const pPayments = await db.payments.filter((p) => !p.synced).count();
      const pInventory = await db.inventoryItems.filter((i) => !i.synced).count();
      const pStock = await db.stockMovements.filter((m) => !m.synced).count();
      const pAccounts = await db.cashBankAccounts.filter((a) => !a.synced).count();
      const pLoans = await db.loans.filter((l) => !l.synced).count();
      const pInvestors = await db.investors.filter((i) => !i.synced).count();
      const pAssets = await db.fixedAssets.filter((fa) => !fa.synced).count();
      const pParties = await db.parties.filter((p) => !p.synced).count();
      const pClosedPeriods = await db.closedPeriods.filter((cp) => !cp.synced).count();
      const pTransfers = await db.bankTransfers.filter((t) => !t.synced).count();
      const pEvents = await db.animalEvents.filter((e) => !e.synced).count();
      const pReminders = await db.reminders.filter((r) => !r.synced).count();
      const pFlows = await db.internalFlows.filter((f) => !f.synced).count();
      const pProcessing = await db.processingRuns.filter((pr) => !pr.synced).count();
      const pPonds = await db.ponds.filter((p) => !p.synced).count();
      const pPlots = await db.plots.filter((p) => !p.synced).count();
      const pAccessLogs = await db.accessLogs.filter((al) => !al.synced).count();
      const pRecurring = await db.recurringExpenseTemplates.filter((rt) => !rt.synced).count();
      const pSalesReturns = await db.salesReturns.filter((sr) => !sr.synced).count();
      const pPurchaseReturns = await db.purchaseReturns.filter((pr) => !pr.synced).count();
      const pAdvancePayments = await db.advancePayments.filter((ap) => !ap.synced).count();
      const pChartAccounts = await db.accounts.filter((acc) => acc.synced === false).count();
      const total =
        pAnimals +
        pFish +
        pCrops +
        pJournals +
        pPurchases +
        pSales +
        pPayments +
        pInventory +
        pStock +
        pAccounts +
        pLoans +
        pInvestors +
        pAssets +
        pParties +
        pClosedPeriods +
        pTransfers +
        pEvents +
        pReminders +
        pFlows +
        pProcessing +
        pPonds +
        pPlots +
        pAccessLogs +
        pRecurring +
        pSalesReturns +
        pPurchaseReturns +
        pAdvancePayments +
        pChartAccounts;
      onPendingChange(total);
      if (!navigator.onLine) {
        onStateChange('OFFLINE');
      } else if (total > 0) {
        onStateChange('PENDING');
      } else {
        onStateChange('ONLINE');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const syncIfOnline = async () => {
    if (!navigator.onLine || isRunning) return;
    isRunning = true;
    onStateChange('SYNCING');
    try {
      const syncRes = await synchronizePendingData();
      if (syncRes.errors && syncRes.errors.length > 0) {
        onStateChange('SYNC_FAILED');
      } else {
        onStateChange('SYNCED');
        setTimeout(() => onStateChange(navigator.onLine ? 'ONLINE' : 'OFFLINE'), 2000);
      }
    } catch (e) {
      onStateChange('SYNC_FAILED');
    } finally {
      isRunning = false;
      await updatePending();
    }
  };

  const handleOnline = () => {
    onStateChange('ONLINE');
    syncIfOnline();
  };
  const handleOffline = () => {
    onStateChange('OFFLINE');
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  updatePending();
  const interval = setInterval(() => {
    updatePending();
  }, 10000);

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
    clearInterval(interval);
  };
}

// Autonomous listener for the browser's 'online' event that automatically
// triggers synchronizePendingData and restores cloud data if local DB was empty.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[The Goated Farm] Browser reconnected online. Auto-triggering pending data sync...');
    synchronizePendingData()
      .then((result) => {
        if (result.syncedCount > 0) {
          console.log(`[The Goated Farm] Auto-sync completed: ${result.syncedCount} records synced.`);
        }
      })
      .catch((err) => {
        console.warn('[The Goated Farm] Auto-sync error on reconnection:', err);
      });

    // If local database was genuinely empty, automatically try restoring from cloud
    restoreRemoteDataIfLocalEmpty().catch((err) => {
      console.warn('[The Goated Farm] Online auto-restore note:', err);
    });
  });
}

/**
 * On login (or initial app load with verified session):
 * Checks if local IndexedDB has zero (or very few) records for animals/journalEntries.
 * If so, and the logged-in owner has synced data in Firestore, automatically pull that data
 * down and restore it into IndexedDB before showing the dashboard — silently and immediately.
 *
 * If the app detects it's opened by a known owner with a genuinely empty local database
 * and NO internet connection available to check Firestore, returns offlineEmptyWarning: true
 * so a clear warning can be displayed instead of silently acting like a brand-new account.
 */
export async function restoreRemoteDataIfLocalEmpty(userEmail?: string, force?: boolean): Promise<{
  restored: boolean;
  count: number;
  offlineEmptyWarning: boolean;
}> {
  try {
    const localOperationalCounts = await Promise.all([
      db.animals.count(),
      db.animalEvents.count(),
      db.journalEntries.count(),
      db.sales.count(),
      db.purchases.count(),
      db.payments.count(),
      db.cropCycles.count(),
      db.fishBatches.count(),
      db.ponds.count(),
      db.plots.count(),
      db.inventoryItems.count(),
      db.stockMovements.count(),
      db.parties.count(),
      db.fixedAssets.count(),
      db.loans.count(),
      db.investors.count(),
      db.cashBankAccounts.count(),
      db.bankTransfers.count(),
      db.reminders.count(),
      db.internalFlows.count(),
      db.processingRuns.count(),
      db.recurringExpenseTemplates.count(),
      db.closedPeriods.count(),
      db.salesReturns.count(),
      db.purchaseReturns.count(),
      db.advancePayments.count()
    ]);
    const totalLocalRecords = localOperationalCounts.reduce((a, b) => a + b, 0);

    // If local IndexedDB already has records, no cloud restore is needed unless forced
    if (totalLocalRecords > 0 && !force) {
      return { restored: false, count: totalLocalRecords, offlineEmptyWarning: false };
    }

    // Known owner email check
    const allowed = getStoredOwnerEmails();
    const cleanEmail = (userEmail || auth.currentUser?.email || '').toLowerCase().trim();
    const isKnownOwner = allowed.length === 0 || (cleanEmail && allowed.includes(cleanEmail));

    // If genuinely empty and no internet connection available
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (isKnownOwner) {
        console.warn('[The Goated Farm] Known owner opened app with empty local database while offline.');
        return { restored: false, count: 0, offlineEmptyWarning: true };
      }
      return { restored: false, count: 0, offlineEmptyWarning: false };
    }

    let restoredCount = 0;

    // Get auth token if available
    let token: string | null = null;
    if (auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch {}
    }
    if (!token && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('goted_owner_session');
        if (raw) {
          const parsed = JSON.parse(raw);
          token = parsed.sessionToken || null;
        }
      } catch {}
    }

    // 1. Try server restore endpoint (fastest, Admin-privileged, complete)
    try {
      const endpoint = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/api/sync/restore`
        : (typeof process !== 'undefined' && process.env?.PORT ? `http://localhost:${process.env.PORT}/api/sync/restore` : 'http://localhost:3000/api/sync/restore');
      const res = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload.success && payload.collections) {
          const c = payload.collections;

          const restoreTableItems = async (table: any, items: any[] | undefined, tableName?: string) => {
            if (Array.isArray(items) && items.length > 0 && table) {
              if (table === db.accounts || tableName === 'accounts') {
                for (const item of items) {
                  if (!item) continue;
                  const itemCode = (item.code || '').trim();
                  let existing = null;
                  if (itemCode) {
                    existing = await db.accounts.where('code').equals(itemCode).first();
                  }
                  if (!existing && item.id) {
                    existing = await db.accounts.get(item.id);
                  }

                  if (existing) {
                    // Stale local vs remote check:
                    // If local account has a newer modification timestamp than remote, don't overwrite with stale cloud data
                    const localTime = existing.updatedAt || existing.syncedAt;
                    const remoteTime = item.updatedAt || item.syncedAt;
                    if (localTime && remoteTime && new Date(localTime).getTime() > new Date(remoteTime).getTime()) {
                      continue;
                    }
                    const isSys = existing.isSystem || DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.code === existing.code);
                    await db.accounts.put({
                      ...existing,
                      ...item,
                      id: existing.id || item.id || (itemCode ? `acc_${itemCode}` : `acc_${Date.now()}`),
                      code: existing.code || item.code,
                      isSystem: isSys,
                      ...(isSys ? { accountClass: existing.accountClass, normalBalance: existing.normalBalance } : {}),
                      synced: true
                    });
                  } else {
                    await db.accounts.put({
                      ...item,
                      id: item.id || (itemCode ? `acc_${itemCode}` : `acc_${Date.now()}`),
                      synced: true
                    });
                  }
                  restoredCount++;
                }
              } else if (typeof table.bulkPut === 'function') {
                const prepared = items.map((item: any) => ({
                  ...item,
                  ownerUid: item.ownerUid || (table === db.systemConfig || tableName === 'systemConfig' ? (item.id || item.ownerUid || 'config') : item.ownerUid),
                  id: item.id || (table === db.systemConfig || tableName === 'systemConfig' ? (item.ownerUid || item.id || 'config') : item.id),
                  synced: true
                }));
                await table.bulkPut(prepared);
                restoredCount += prepared.length;
              }
            }
          };

          await restoreTableItems(db.systemConfig, c.systemConfig, 'systemConfig');
          await restoreTableItems(db.accounts, c.accounts, 'accounts');
          await restoreTableItems(db.animals, c.animals);
          await restoreTableItems(db.animalEvents, c.animalEvents);
          await restoreTableItems(db.journalEntries, c.journalEntries);
          await restoreTableItems(db.sales, c.sales);
          await restoreTableItems(db.purchases, c.purchases);
          await restoreTableItems(db.payments, c.payments);
          await restoreTableItems(db.salesReturns, c.salesReturns);
          await restoreTableItems(db.purchaseReturns, c.purchaseReturns);
          await restoreTableItems(db.advancePayments, c.advancePayments);
          await restoreTableItems(db.cropCycles, c.cropCycles);
          await restoreTableItems(db.fishBatches, c.fishBatches);
          await restoreTableItems(db.ponds, c.ponds);
          await restoreTableItems(db.plots, c.plots);
          const invList = (Array.isArray(c.inventory) && c.inventory.length > 0) ? c.inventory : ((Array.isArray(c.inventoryItems) && c.inventoryItems.length > 0) ? c.inventoryItems : []);
          await restoreTableItems(db.inventoryItems, invList);
          await restoreTableItems(db.stockMovements, c.stockMovements);
          await restoreTableItems(db.parties, c.parties);
          await restoreTableItems(db.fixedAssets, c.fixedAssets);
          await restoreTableItems(db.loans, c.loans);
          await restoreTableItems(db.investors, c.investors);
          await restoreTableItems(db.cashBankAccounts, c.cashBankAccounts);
          await restoreTableItems(db.bankTransfers, c.bankTransfers);
          await restoreTableItems(db.reminders, c.reminders);
          await restoreTableItems(db.internalFlows, c.internalFlows);
          await restoreTableItems(db.processingRuns, c.processingRuns);
          await restoreTableItems(db.recurringExpenseTemplates, c.recurringExpenseTemplates);
          await restoreTableItems(db.accessLogs, c.accessLogs);
          await restoreTableItems(db.auditLogs, c.auditLogs);
          await restoreTableItems(db.closedPeriods, c.closedPeriods);

          // Universal persistent Dexie table sweep: ensures NO table is ever silently omitted
          for (const tbl of db.tables) {
            const tblName = tbl.name;
            const items = c[tblName] || (tblName === 'inventoryItems' ? c.inventory : undefined) || (tblName === 'systemConfig' ? c.system : undefined);
            if (Array.isArray(items) && items.length > 0) {
              const currentCount = await tbl.count();
              if (currentCount === 0) {
                const prepared = items.map((item: any) => ({
                  ...item,
                  id: item.id || (tblName === 'systemConfig' ? (item.ownerUid || item.id) : item.id),
                  synced: true
                }));
                await tbl.bulkPut(prepared);
                restoredCount += prepared.length;
              }
            }
          }
        }
      }
    } catch (serverErr) {
      console.warn('[The Goated Farm] Server restore endpoint read note:', serverErr);
    }

    // 2. Direct Firestore fallback if server restore was not possible
    if (restoredCount === 0 && auth.currentUser) {
      try {
        const collectionsToFetchFromFirestore: Array<{ col: string; table: any }> = [
          { col: 'systemConfig', table: db.systemConfig },
          { col: 'accounts', table: db.accounts },
          { col: 'animals', table: db.animals },
          { col: 'animalEvents', table: db.animalEvents },
          { col: 'journalEntries', table: db.journalEntries },
          { col: 'sales', table: db.sales },
          { col: 'purchases', table: db.purchases },
          { col: 'payments', table: db.payments },
          { col: 'salesReturns', table: db.salesReturns },
          { col: 'purchaseReturns', table: db.purchaseReturns },
          { col: 'advancePayments', table: db.advancePayments },
          { col: 'cropCycles', table: db.cropCycles },
          { col: 'fishBatches', table: db.fishBatches },
          { col: 'ponds', table: db.ponds },
          { col: 'plots', table: db.plots },
          { col: 'inventoryItems', table: db.inventoryItems },
          { col: 'stockMovements', table: db.stockMovements },
          { col: 'parties', table: db.parties },
          { col: 'fixedAssets', table: db.fixedAssets },
          { col: 'loans', table: db.loans },
          { col: 'investors', table: db.investors },
          { col: 'cashBankAccounts', table: db.cashBankAccounts },
          { col: 'bankTransfers', table: db.bankTransfers },
          { col: 'reminders', table: db.reminders },
          { col: 'internalFlows', table: db.internalFlows },
          { col: 'processingRuns', table: db.processingRuns },
          { col: 'recurringExpenseTemplates', table: db.recurringExpenseTemplates },
          { col: 'closedPeriods', table: db.closedPeriods },
          { col: 'auditLogs', table: db.auditLogs },
          { col: 'accessLogs', table: db.accessLogs }
        ];

        for (const { col, table } of collectionsToFetchFromFirestore) {
          try {
            const snap = await getDocs(collection(firestore, col));
            if (!snap.empty) {
              const list: any[] = [];
              snap.forEach((d) => {
                const data = d.data();
                list.push({
                  ...data,
                  id: data.id || d.id,
                  synced: true
                });
              });
              if (table === db.accounts) {
                for (const item of list) {
                  if (!item) continue;
                  const itemCode = (item.code || '').trim();
                  let existing = null;
                  if (itemCode) {
                    existing = await db.accounts.where('code').equals(itemCode).first();
                  }
                  if (!existing && item.id) {
                    existing = await db.accounts.get(item.id);
                  }
                  if (existing) {
                    const localTime = existing.updatedAt || existing.syncedAt;
                    const remoteTime = item.updatedAt || item.syncedAt;
                    if (localTime && remoteTime && new Date(localTime).getTime() > new Date(remoteTime).getTime()) {
                      continue;
                    }
                    const isSys = existing.isSystem || DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.code === existing.code);
                    await db.accounts.put({
                      ...existing,
                      ...item,
                      id: existing.id || item.id || (itemCode ? `acc_${itemCode}` : `acc_${Date.now()}`),
                      code: existing.code || item.code,
                      isSystem: isSys,
                      ...(isSys ? { accountClass: existing.accountClass, normalBalance: existing.normalBalance } : {}),
                      synced: true
                    });
                  } else {
                    await db.accounts.put({
                      ...item,
                      id: item.id || (itemCode ? `acc_${itemCode}` : `acc_${Date.now()}`),
                      synced: true
                    });
                  }
                  restoredCount++;
                }
              } else if (table && typeof table.bulkPut === 'function') {
                await table.bulkPut(list);
                restoredCount += list.length;
              }
            }
          } catch (colErr: any) {
            console.warn(`[The Goated Farm] Direct Firestore restore fallback note for ${col}:`, colErr.message);
          }
        }
      } catch (fsErr) {
        console.warn('[The Goated Farm] Direct Firestore restore fallback note:', fsErr);
      }
    }

    if (restoredCount > 0) {
      console.log(`[The Goated Farm] Auto-restored ${restoredCount} records from cloud Firestore into local IndexedDB.`);
      recordSyncTime();
      return { restored: true, count: restoredCount, offlineEmptyWarning: false };
    }

    return { restored: false, count: 0, offlineEmptyWarning: false };
  } catch (err) {
    console.warn('[The Goated Farm] restoreRemoteDataIfLocalEmpty error:', err);
    return { restored: false, count: 0, offlineEmptyWarning: false };
  }
}

