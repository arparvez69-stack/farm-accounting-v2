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
import { SyncState, SystemConfig, UserProfile } from '../types';

// Fixed owner allow-list for "The Goated Farm"
export const APPROVED_OWNER_EMAILS: string[] = [
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'arparvez111@gmail.com',
  'atikurrahman00021@gmail.com'
];

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  ownerUid: 'the_goated_farm_owners',
  companyName: 'The Goated Farm',
  ownerEmails: APPROVED_OWNER_EMAILS,
  companyAddress: 'ঢাকা, বাংলাদেশ',
  phone: '+8801700000000',
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
  }

  const cashCount = await db.cashBankAccounts.count();
  if (cashCount === 0) {
    await db.cashBankAccounts.put({
      id: 'cash_main',
      accountType: 'CASH',
      name: 'প্রধান নগদ তহবিল (Main Cash Drawer)',
      currentBalance: 50000,
      synced: true
    });
    await db.cashBankAccounts.put({
      id: 'bank_main',
      accountType: 'BANK',
      name: 'সোনালী ব্যাংক চলতি হিসাব (Sonali Bank Current)',
      accountNumber: '01234567890',
      bankName: 'Sonali Bank PLC',
      branch: 'Main Branch',
      currentBalance: 150000,
      synced: true
    });
  } else {
    const cashMain = await db.cashBankAccounts.get('cash_main');
    if (cashMain && cashMain.currentBalance < 10000) {
      await db.cashBankAccounts.update('cash_main', {
        currentBalance: Math.max(cashMain.currentBalance, 0) + 50000
      });
    }
  }

  // Ensure default system config in local IndexedDB
  const sysConfigs = await db.systemConfig.toArray();
  if (sysConfigs.length === 0) {
    await db.systemConfig.put(DEFAULT_SYSTEM_CONFIG);
  } else if (sysConfigs[0].companyName !== 'The Goated Farm') {
    await db.systemConfig.put({
      ...sysConfigs[0],
      companyName: 'The Goated Farm',
      ownerEmails: APPROVED_OWNER_EMAILS
    });
  }
}

/**
 * Silently seed or synchronize "The Goated Farm" system configuration
 */
export async function seedSystemConfigIfNecessary(): Promise<SystemConfig> {
  const localConfig = await db.systemConfig.toArray();
  const baseConfig: SystemConfig = localConfig.length > 0 ? localConfig[0] : DEFAULT_SYSTEM_CONFIG;

  const targetConfig: SystemConfig = {
    ...baseConfig,
    companyName: 'The Goated Farm',
    ownerEmails: APPROVED_OWNER_EMAILS,
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
 * All four allow-listed emails have full equal OWNER role.
 */
export async function resolveUserRole(user: User | null): Promise<UserProfile> {
  // 1. Check Firebase Auth user email
  if (user && user.email) {
    const email = user.email.toLowerCase().trim();
    const isApproved = APPROVED_OWNER_EMAILS.includes(email);
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
        localStorage.setItem('goted_owner_session', JSON.stringify({
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
        const isApproved = APPROVED_OWNER_EMAILS.includes(email);
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

/**
 * Synchronize pending offline data to server endpoints (Admin SDK write)
 */
export async function synchronizePendingData(): Promise<{ syncedCount: number; errors: string[] }> {
  if (!navigator.onLine) {
    return { syncedCount: 0, errors: ['Offline'] };
  }

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

  return { syncedCount: count, errors };
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
