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

  // Automatically migrate legacy journal entries referencing discontinued accounts (e.g. 1050)
  try {
    await migrateLegacyAccounts();
  } catch (err) {
    console.warn('Notice: Legacy accounts migration error:', err);
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
async function syncRecordToServer(collection: string, data: any): Promise<void> {
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

  const endpoint = `/api/sync/${collection}`;
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
    throw new Error(errorData.error || `Server returned ${res.status}`);
  }
}

let activeSyncPromise: Promise<{ syncedCount: number; errors: string[] }> | null = null;

/**
 * Synchronize pending offline data to server endpoints (Admin SDK write)
 */
export async function synchronizePendingData(): Promise<{ syncedCount: number; errors: string[] }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
      // 1. Sync Animals
    const pendingAnimals = await db.animals.filter((a) => a.synced === false).toArray();
    for (const animal of pendingAnimals) {
      try {
        await syncRecordToServer('animals', animal);
        await db.animals.update(animal.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Animal ${animal.id}: ${err.message}`);
      }
    }

    // 2. Sync Fish Batches
    const pendingFish = await db.fishBatches.filter((b) => b.synced === false).toArray();
    for (const batch of pendingFish) {
      try {
        await syncRecordToServer('fishBatches', batch);
        await db.fishBatches.update(batch.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Fish batch ${batch.id}: ${err.message}`);
      }
    }

    // 3. Sync Crop Cycles
    const pendingCrops = await db.cropCycles.filter((c) => c.synced === false).toArray();
    for (const crop of pendingCrops) {
      try {
        await syncRecordToServer('cropCycles', crop);
        await db.cropCycles.update(crop.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Crop cycle ${crop.id}: ${err.message}`);
      }
    }

    // 4. Sync Journal Entries (re-validates debit/credit server-side)
    const pendingJournals = await db.journalEntries.filter((j) => j.synced === false).toArray();
    for (const j of pendingJournals) {
      try {
        await syncRecordToServer('journalEntries', j);
        await db.journalEntries.update(j.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Journal ${j.voucherNumber}: ${err.message}`);
      }
    }

    // 5. Sync Purchases
    const pendingPurchases = await db.purchases.filter((p) => p.synced === false).toArray();
    for (const p of pendingPurchases) {
      try {
        await syncRecordToServer('purchases', p);
        await db.purchases.update(p.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Purchase ${p.invoiceNumber}: ${err.message}`);
      }
    }

    // 6. Sync Sales
    const pendingSales = await db.sales.filter((s) => s.synced === false).toArray();
    for (const s of pendingSales) {
      try {
        await syncRecordToServer('sales', s);
        await db.sales.update(s.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Sale ${s.invoiceNumber}: ${err.message}`);
      }
    }

    // 7. Sync Audit Logs
    const pendingAudit = await db.auditLogs.filter((a) => a.synced === false).toArray();
    for (const a of pendingAudit) {
      try {
        await syncRecordToServer('auditLogs', a);
        await db.auditLogs.update(a.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Audit ${a.id}: ${err.message}`);
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
      const total = pAnimals + pFish + pCrops + pJournals + pPurchases + pSales;
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
      await synchronizePendingData();
      onStateChange('SYNCED');
      setTimeout(() => onStateChange(navigator.onLine ? 'ONLINE' : 'OFFLINE'), 2000);
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

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  updatePending();
  const interval = setInterval(() => {
    updatePending();
  }, 10000);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
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
export async function restoreRemoteDataIfLocalEmpty(userEmail?: string): Promise<{
  restored: boolean;
  count: number;
  offlineEmptyWarning: boolean;
}> {
  try {
    const animalCount = await db.animals.count();
    const journalCount = await db.journalEntries.count();

    // If local IndexedDB already has records, no cloud restore is needed
    if (animalCount > 0 || journalCount > 0) {
      return { restored: false, count: animalCount + journalCount, offlineEmptyWarning: false };
    }

    // Known owner email check
    const allowed = getStoredOwnerEmails();
    const cleanEmail = (userEmail || auth.currentUser?.email || '').toLowerCase().trim();
    const isKnownOwner = allowed.length === 0 || (cleanEmail && allowed.includes(cleanEmail));

    // If genuinely empty and no internet connection available
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
    if (!token && typeof window !== 'undefined') {
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
      const res = await fetch('/api/sync/restore', {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload.success && payload.collections) {
          const c = payload.collections;
          if (Array.isArray(c.animals) && c.animals.length > 0) {
            await db.animals.bulkPut(c.animals.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.animals.length;
          }
          if (Array.isArray(c.animalEvents) && c.animalEvents.length > 0) {
            await db.animalEvents.bulkPut(c.animalEvents.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.animalEvents.length;
          }
          if (Array.isArray(c.journalEntries) && c.journalEntries.length > 0) {
            await db.journalEntries.bulkPut(c.journalEntries.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.journalEntries.length;
          }
          if (Array.isArray(c.sales) && c.sales.length > 0) {
            await db.sales.bulkPut(c.sales.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.sales.length;
          }
          if (Array.isArray(c.purchases) && c.purchases.length > 0) {
            await db.purchases.bulkPut(c.purchases.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.purchases.length;
          }
          if (Array.isArray(c.cropCycles) && c.cropCycles.length > 0) {
            await db.cropCycles.bulkPut(c.cropCycles.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.cropCycles.length;
          }
          if (Array.isArray(c.fishBatches) && c.fishBatches.length > 0) {
            await db.fishBatches.bulkPut(c.fishBatches.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.fishBatches.length;
          }
          if (Array.isArray(c.ponds) && c.ponds.length > 0) {
            await db.ponds.bulkPut(c.ponds.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.ponds.length;
          }
          if (Array.isArray(c.plots) && c.plots.length > 0) {
            await db.plots.bulkPut(c.plots.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.plots.length;
          }
          if (Array.isArray(c.inventoryItems) && c.inventoryItems.length > 0) {
            await db.inventoryItems.bulkPut(c.inventoryItems.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.inventoryItems.length;
          }
          if (Array.isArray(c.parties) && c.parties.length > 0) {
            await db.parties.bulkPut(c.parties.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.parties.length;
          }
          if (Array.isArray(c.fixedAssets) && c.fixedAssets.length > 0) {
            await db.fixedAssets.bulkPut(c.fixedAssets.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.fixedAssets.length;
          }
          if (Array.isArray(c.loans) && c.loans.length > 0) {
            await db.loans.bulkPut(c.loans.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.loans.length;
          }
          if (Array.isArray(c.investors) && c.investors.length > 0) {
            await db.investors.bulkPut(c.investors.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.investors.length;
          }
          if (Array.isArray(c.cashBankAccounts) && c.cashBankAccounts.length > 0) {
            await db.cashBankAccounts.bulkPut(c.cashBankAccounts.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.cashBankAccounts.length;
          }
          if (Array.isArray(c.reminders) && c.reminders.length > 0) {
            await db.reminders.bulkPut(c.reminders.map((item: any) => ({ ...item, synced: true })));
            restoredCount += c.reminders.length;
          }
        }
      }
    } catch (serverErr) {
      console.warn('[The Goated Farm] Server restore endpoint read note:', serverErr);
    }

    // 2. Direct Firestore fallback if server restore was not possible
    if (restoredCount === 0 && auth.currentUser) {
      try {
        const animalSnap = await getDocs(collection(firestore, 'animals'));
        if (!animalSnap.empty) {
          const list: any[] = [];
          animalSnap.forEach((d) => list.push({ id: d.id, ...d.data(), synced: true }));
          await db.animals.bulkPut(list);
          restoredCount += list.length;
        }
        const journalSnap = await getDocs(collection(firestore, 'journalEntries'));
        if (!journalSnap.empty) {
          const list: any[] = [];
          journalSnap.forEach((d) => list.push({ id: d.id, ...d.data(), synced: true }));
          await db.journalEntries.bulkPut(list);
          restoredCount += list.length;
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

