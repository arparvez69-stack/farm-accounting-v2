import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { SyncState, SystemConfig, UserProfile, UserRole, ViewerAccount } from '../types';

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

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
 * Initialize default IndexedDB data (Chart of Accounts, Cash Account)
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
    // If cash_main exists and has negative or zero balance due to previous transactions, replenish it
    const cashMain = await db.cashBankAccounts.get('cash_main');
    if (cashMain && cashMain.currentBalance < 10000) {
      await db.cashBankAccounts.update('cash_main', {
        currentBalance: Math.max(cashMain.currentBalance, 0) + 50000
      });
    }
  }
}

/**
 * Check if the system has been bootstrapped with an Owner
 */
export async function checkSystemBootstrap(): Promise<{ isBootstrapped: boolean; config?: SystemConfig }> {
  // Try local first
  const localConfig = await db.systemConfig.toArray();
  if (localConfig.length > 0) {
    return { isBootstrapped: true, config: localConfig[0] };
  }

  // Try Firestore if online
  if (navigator.onLine) {
    try {
      const snap = await getDoc(doc(firestore, 'system', 'config'));
      if (snap.exists()) {
        const config = snap.data() as SystemConfig;
        await db.systemConfig.put(config);
        return { isBootstrapped: true, config };
      }
    } catch (e) {
      console.warn('Failed to fetch remote system config:', e);
    }
  }

  return { isBootstrapped: false };
}

/**
 * Secure Owner Bootstrap: First registered authorized Owner
 */
export async function bootstrapSystemOwner(
  ownerUid: string,
  ownerEmail: string,
  companyName: string,
  companyAddress: string,
  phone: string
): Promise<SystemConfig> {
  const config: SystemConfig = {
    ownerUid,
    ownerEmail,
    companyName: companyName || 'সমন্বিত কৃষি খামার (Integrated Agro Farm)',
    companyAddress: companyAddress || 'ঢাকা, বাংলাদেশ',
    phone: phone || '+8801700000000',
    currency: '৳',
    initializedAt: new Date().toISOString()
  };

  // Save to local IndexedDB
  await db.systemConfig.put(config);

  // If online, save to Firestore /system/config
  if (navigator.onLine) {
    try {
      await setDoc(doc(firestore, 'system', 'config'), config);
    } catch (e) {
      console.error('Failed to sync bootstrap to Firestore:', e);
    }
  }

  // Record audit log
  await db.auditLogs.put({
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: ownerUid,
    role: 'OWNER',
    action: 'SYSTEM_BOOTSTRAP',
    module: 'SECURITY',
    recordId: 'system/config',
    status: 'SUCCESS',
    details: `সিস্টেম মালিক কনফিগারেশন সম্পন্ন হয়েছে: ${companyName}`
  });

  return config;
}

/**
 * Resolve User Profile and Role (OWNER, VIEWER, UNAUTHENTICATED)
 */
export async function resolveUserRole(user: User | null): Promise<UserProfile> {
  if (!user) {
    return {
      uid: '',
      role: 'UNAUTHENTICATED',
      isApproved: false
    };
  }

  // Check system config for Owner
  const bootstrap = await checkSystemBootstrap();
  if (bootstrap.isBootstrapped && bootstrap.config?.ownerUid === user.uid) {
    return {
      uid: user.uid,
      email: user.email || undefined,
      phoneNumber: user.phoneNumber || undefined,
      displayName: user.displayName || 'Farm Owner (মালিক)',
      role: 'OWNER',
      isApproved: true
    };
  }

  // Check Viewer Whitelist local first
  const localViewer = await db.viewers.where('uid').equals(user.uid).first();
  if (localViewer && localViewer.status === 'active') {
    return {
      uid: user.uid,
      email: user.email || undefined,
      phoneNumber: user.phoneNumber || undefined,
      displayName: localViewer.name || 'Viewer (পরিদর্শক)',
      role: 'VIEWER',
      isApproved: true
    };
  }

  // Check Firestore if online
  if (navigator.onLine) {
    try {
      const viewerSnap = await getDoc(doc(firestore, 'viewers', user.uid));
      if (viewerSnap.exists()) {
        const viewerData = viewerSnap.data() as ViewerAccount;
        if (viewerData.status === 'active') {
          await db.viewers.put(viewerData);
          return {
            uid: user.uid,
            email: user.email || undefined,
            phoneNumber: user.phoneNumber || undefined,
            displayName: viewerData.name || 'Viewer (পরিদর্শক)',
            role: 'VIEWER',
            isApproved: true
          };
        }
      }
    } catch (e) {
      console.warn('Failed to query viewers collection:', e);
    }
  }

  return {
    uid: user.uid,
    email: user.email || undefined,
    phoneNumber: user.phoneNumber || undefined,
    displayName: user.displayName || 'Unapproved User',
    role: 'UNAUTHENTICATED',
    isApproved: false
  };
}

/**
 * Synchronize pending offline data to Firestore when online
 */
export async function synchronizePendingData(): Promise<{ syncedCount: number; errors: string[] }> {
  if (!navigator.onLine || !auth.currentUser) {
    return { syncedCount: 0, errors: ['Offline or unauthenticated'] };
  }

  let count = 0;
  const errors: string[] = [];

  try {
    // 1. Sync Animals
    const pendingAnimals = await db.animals.filter((a) => a.synced === false).toArray();
    for (const animal of pendingAnimals) {
      try {
        await setDoc(doc(firestore, 'animals', animal.id), animal);
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
        await setDoc(doc(firestore, 'fishBatches', batch.id), batch);
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
        await setDoc(doc(firestore, 'cropCycles', crop.id), crop);
        await db.cropCycles.update(crop.id, { synced: true });
        count++;
      } catch (err: any) {
        errors.push(`Crop cycle ${crop.id}: ${err.message}`);
      }
    }

    // 4. Sync Journal Entries
    const pendingJournals = await db.journalEntries.filter((j) => j.synced === false).toArray();
    for (const j of pendingJournals) {
      try {
        await setDoc(doc(firestore, 'journalEntries', j.id), j);
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
        await setDoc(doc(firestore, 'purchases', p.id), p);
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
        await setDoc(doc(firestore, 'sales', s.id), s);
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
        await setDoc(doc(firestore, 'auditLogs', a.id), a);
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
  return null;
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

/**
 * Update approved viewers whitelist (Owner Only)
 */
export async function updateApprovedViewers(viewers: string[]): Promise<void> {
  const localConfig = await db.systemConfig.toArray();
  if (localConfig.length > 0) {
    const updated = { ...localConfig[0], approvedViewers: viewers };
    await db.systemConfig.put(updated);
    if (navigator.onLine) {
      try {
        await setDoc(doc(firestore, 'system', 'config'), updated, { merge: true });
      } catch (e) {
        console.error('Failed to sync viewers to Firestore:', e);
      }
    }
  }
}
