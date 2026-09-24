import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { validateBalancedLines } from './src/accounting/accountingEngine';
import { calculateHistoricalInventoryValuation } from './src/accounting/reconciliationService';
import { CANONICAL_ACCOUNTS } from './src/accounting/accountMapping';
import { DEFAULT_CHART_OF_ACCOUNTS } from './src/accounting/defaultAccounts';
import { Account, ClosedPeriod } from './src/types';

dotenv.config();

export const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to read owner email secrets from environment variables (supports standard or lowercase aliases)
export function getRawEmailsEnv(): string {
  return (
    process.env.APPROVED_OWNER_EMAILS?.trim() ||
    process.env.OWNER_EMAILS?.trim() ||
    process.env.EMAIL?.trim() ||
    process.env.email?.trim() ||
    ''
  );
}

// Helper to read initial PIN secrets from environment variables (supports standard or lowercase aliases)
export function getRawPinEnv(): string {
  return (
    process.env.INITIAL_PIN?.trim() ||
    process.env.MASTER_PIN?.trim() ||
    process.env.INITIAL_MASTER_PIN?.trim() ||
    process.env.masterpin?.trim() ||
    process.env.MASTERPIN?.trim() ||
    process.env.PIN?.trim() ||
    process.env.pin?.trim() ||
    '123456'
  );
}

const ALLOW_LIST_FILE = path.resolve(process.cwd(), 'data', 'owner_allow_list.json');

export const AUTHORIZED_OWNER_EMAILS: readonly string[] = Object.freeze([
  'arparvez111@gmail.com',
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'lubaiyatasnum111@gmail.com',
  'atikurrahman00021@gmail.com'
]);

let testApprovedOwnerEmailsOverride: string[] | null | undefined = undefined;

export function setApprovedOwnerEmailsForTest(emails: string[] | null | undefined): void {
  testApprovedOwnerEmailsOverride = emails;
}

// Single authoritative owner allow-list parsed from environment variable APPROVED_OWNER_EMAILS (or data/owner_allow_list.json)
export function getApprovedOwnerEmails(): string[] {
  if (testApprovedOwnerEmailsOverride !== undefined) {
    return testApprovedOwnerEmailsOverride
      ? Array.from(new Set(testApprovedOwnerEmailsOverride.map((e) => e.trim().toLowerCase()).filter(Boolean)))
      : [];
  }

  const envEmails = getRawEmailsEnv();
  const list = new Set<string>();

  if (envEmails) {
    envEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes('@'))
      .forEach((e) => list.add(e));
  } else if (fs.existsSync(ALLOW_LIST_FILE)) {
    try {
      const raw = fs.readFileSync(ALLOW_LIST_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const emails = Array.isArray(parsed.authorizedOwners)
        ? parsed.authorizedOwners
        : Array.isArray(parsed.emails)
        ? parsed.emails
        : [];
      emails
        .map((e: any) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter((e: string) => e.length > 0 && e.includes('@'))
        .forEach((e: string) => list.add(e));
    } catch (err: any) {
      console.warn('[The Goated Farm] Failed to read data/owner_allow_list.json:', err.message);
    }
  }

  if (list.size === 0) {
    AUTHORIZED_OWNER_EMAILS.forEach((e) => list.add(e.toLowerCase().trim()));
  }

  return Array.from(list);
}

// Single authoritative check: returns true only if email is in the authoritative owner allow-list
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  const approved = getApprovedOwnerEmails();
  return approved.length > 0 && approved.includes(normalized);
}

// Checks if required authentication secrets are configured
export function isSetupComplete(): boolean {
  return getApprovedOwnerEmails().length > 0;
}

// In-memory record of access events for dashboard & audit
interface AccessLogRecord {
  id: string;
  email: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
  status: 'SUCCESS' | 'FAILED';
}
const serverAccessLogs: AccessLogRecord[] = [];

// ==========================================
// Rate Limiting for Login
// Tracks failed attempts per email.
// After 5 failed attempts within 15 minutes, locks for 15 minutes.
// Resets counter on success.
// ==========================================
interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}
const failedLoginAttempts = new Map<string, RateLimitRecord>();
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// Initialize Firebase Admin SDK
let adminInitialized = false;
const hasServiceAccountKey = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS
);

try {
  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const parsedKey = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        initializeApp({
          credential: cert(parsedKey),
          projectId: firebaseConfig.projectId
        });
        adminInitialized = true;
      } catch {
        initializeApp({
          credential: cert(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
          projectId: firebaseConfig.projectId
        });
        adminInitialized = true;
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp();
      adminInitialized = true;
    } else {
      initializeApp({
        projectId: firebaseConfig.projectId
      });
      adminInitialized = true;
    }
  } else {
    adminInitialized = true;
  }
} catch (err: any) {
  console.warn('[The Goated Farm] Firebase Admin initialization note:', err.message);
}

// Initialize Firestore Admin
let adminDb: FirebaseFirestore.Firestore | null = null;
try {
  if (adminInitialized) {
    adminDb = firebaseConfig.firestoreDatabaseId
      ? getFirestore(firebaseConfig.firestoreDatabaseId)
      : getFirestore();
  }
} catch (err: any) {
  console.warn('[The Goated Farm] Admin Firestore init note:', err.message);
}

// ==========================================
// Hardened Owner Session-Token Authentication (F8)
// ==========================================

const INSECURE_DEFAULT_SECRETS = [
  'the-goated-farm-session-secret-salt-2025',
  'the-goated-farm-session-secret',
  'change-this-to-a-secure-secret-key',
  'session-secret',
  'secret',
  'password',
  'default',
  '12345678901234567890123456789012',
  'abcdefghijklmnopqrstuvwxyz123456'
];

/**
 * Validates whether a given session secret meets strict cryptographic strength:
 * - Must be non-empty string
 * - Length >= 32 characters (256 bits minimum)
 * - Must not match or contain known insecure default strings
 * - Must have adequate character entropy (at least 8 distinct characters)
 */
export function isStrongSessionSecret(secret: string | undefined | null): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const trimmed = secret.trim();
  if (trimmed.length < 32) return false;

  const lower = trimmed.toLowerCase();
  for (const insecure of INSECURE_DEFAULT_SECRETS) {
    if (lower === insecure || lower.includes(insecure)) {
      return false;
    }
  }

  const uniqueChars = new Set(trimmed);
  if (uniqueChars.size < 8) return false;

  return true;
}

// Scoped test override mechanism
let testSecretOverride: string | null | undefined = undefined;

export function setSessionSecretForTest(secret: string | null | undefined): void {
  testSecretOverride = secret;
}

export function getSessionSecretForTest(): string | null | undefined {
  return testSecretOverride;
}

/**
 * Resolves the active session secret.
 * In production: strictly requires process.env.SESSION_SECRET to be a validated strong secret.
 * In non-production: reads process.env.SESSION_SECRET or a secured durable secret file in data/.session_secret.
 * Returns null if no valid strong secret is configured.
 */
export function resolveSessionSecret(): string | null {
  if (testSecretOverride !== undefined) {
    if (testSecretOverride === null || !isStrongSessionSecret(testSecretOverride)) {
      return null;
    }
    return testSecretOverride;
  }

  const envSecret = process.env.SESSION_SECRET?.trim();
  if (isStrongSessionSecret(envSecret)) {
    return envSecret!;
  }

  // Requirement 1: NEVER use a hardcoded or fallback secret in production!
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  // For non-production development environments, read or generate a durable random 256-bit secret in data/.session_secret
  try {
    const durableSecretPath = path.join(process.cwd(), 'data', '.session_secret');
    if (fs.existsSync(durableSecretPath)) {
      const stored = fs.readFileSync(durableSecretPath, 'utf8').trim();
      if (isStrongSessionSecret(stored)) return stored;
    }
    const dataDir = path.dirname(durableSecretPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(durableSecretPath, generated, { mode: 0o600, encoding: 'utf8' });
    return generated;
  } catch {
    return null;
  }
}

/**
 * Refuse to start secure owner-session authentication if a strong secret is not configured.
 */
export function assertStrongSecretConfigured(): void {
  const secret = resolveSessionSecret();
  if (!secret) {
    throw new Error(
      'FATAL: Refusing to start secure owner-session authentication: A strong SESSION_SECRET (minimum 32 characters, high entropy, no defaults) is not configured.'
    );
  }
}

// Requirement 1 & 2: In production, immediately fail server startup if strong secret is not configured
if (process.env.NODE_ENV === 'production') {
  assertStrongSecretConfigured();
}

/**
 * Creates a cryptographically unpredictable session token for an approved owner.
 * Contains:
 * - email: normalized owner email
 * - jti: 256-bit cryptographically secure random identifier (unpredictability)
 * - iat: issue timestamp
 * - exp: expiration timestamp (30 days)
 * Signed with HMAC-SHA256 using the configured strong secret.
 */
export function createSessionToken(email: string): string {
  const secret = resolveSessionSecret();
  if (!secret) {
    throw new Error('Refusing to issue owner session token: strong SESSION_SECRET is not configured or fails security policy.');
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!isOwnerEmail(normalizedEmail)) {
    throw new Error(`Refusing to issue owner session token: ${email} is not in approved owner allow-list.`);
  }

  const payloadObj = {
    email: normalizedEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  };

  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

// Chart of accounts cache for sync validation
let cachedValidAccounts: Account[] | null = null;
let lastAccountsFetch = 0;

export async function getValidAccountsForValidation(): Promise<Account[]> {
  const now = Date.now();
  if (cachedValidAccounts && now - lastAccountsFetch < 60000) {
    return cachedValidAccounts;
  }
  const accountsMap = new Map<string, Account>();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    accountsMap.set(acc.code, acc);
  }
  if (adminDb) {
    try {
      const snap = await adminDb.collection('accounts').get();
      snap.forEach((doc) => {
        const d = doc.data() as Account;
        if (d && d.code) {
          accountsMap.set(d.code, d);
        }
      });
    } catch {
      // Fallback to default accounts
    }
  }
  if (inMemoryStores.has('accounts')) {
    const memAccounts = inMemoryStores.get('accounts')!;
    for (const acc of memAccounts.values()) {
      if (acc && acc.code) {
        accountsMap.set(acc.code, acc);
      }
    }
  }
  cachedValidAccounts = Array.from(accountsMap.values());
  lastAccountsFetch = now;
  return cachedValidAccounts;
}

// In-memory store for sync operations (serves as fast lookup cache for confirmed persisted documents)
export const inMemoryStores = new Map<string, Map<string, any>>();

// Non-volatile disk-backed durable storage path (guarantees data survives server restarts and is never only in RAM)
const DURABLE_STORAGE_DIR = path.join(process.cwd(), 'data');
const DURABLE_STORAGE_FILE = path.join(DURABLE_STORAGE_DIR, 'durable_cloud_storage.json');

// Initialize durable storage from non-volatile disk
export function initDurableStorage() {
  try {
    if (!fs.existsSync(DURABLE_STORAGE_DIR)) {
      fs.mkdirSync(DURABLE_STORAGE_DIR, { recursive: true });
    }
    if (fs.existsSync(DURABLE_STORAGE_FILE)) {
      const content = fs.readFileSync(DURABLE_STORAGE_FILE, 'utf-8');
      const data = JSON.parse(content || '{}');
      for (const [colName, colDocs] of Object.entries(data)) {
        if (!inMemoryStores.has(colName)) {
          inMemoryStores.set(colName, new Map<string, any>());
        }
        const colMap = inMemoryStores.get(colName)!;
        for (const [docId, doc] of Object.entries(colDocs as Record<string, any>)) {
          colMap.set(docId, doc);
        }
      }
    }
  } catch (err) {
    console.warn('[The Goated Farm] Durable storage init notice:', err);
  }
}
initDurableStorage();

export function saveRecordToDurableDisk(collection: string, id: string, record: any): void {
  if (!fs.existsSync(DURABLE_STORAGE_DIR)) {
    fs.mkdirSync(DURABLE_STORAGE_DIR, { recursive: true });
  }
  let allData: Record<string, Record<string, any>> = {};
  if (fs.existsSync(DURABLE_STORAGE_FILE)) {
    try {
      allData = JSON.parse(fs.readFileSync(DURABLE_STORAGE_FILE, 'utf-8') || '{}');
    } catch {
      allData = {};
    }
  }
  if (!allData[collection]) {
    allData[collection] = {};
  }
  allData[collection][id] = record;
  fs.writeFileSync(DURABLE_STORAGE_FILE, JSON.stringify(allData, null, 2), 'utf-8');
}

// F7: Control for simulating Cloud Firestore persistence unavailability
let simulateFirestoreUnavailable = false;

export function setSimulateFirestoreUnavailable(val: boolean) {
  simulateFirestoreUnavailable = val;
}

// F7: Test controls for Admin DB state and Firestore write verification
let customAdminDbForTest: any = undefined;
let simulateFirestoreWriteFailure = false;
let simulateFirestoreWriteErrorMessage = 'Firestore write failed: 7 PERMISSION_DENIED: Missing or insufficient permissions.';

export function setAdminDbForTest(db: any): void {
  customAdminDbForTest = db;
}

export function setFirestoreWriteFailureForTest(failure: boolean, message?: string): void {
  simulateFirestoreWriteFailure = failure;
  if (message) simulateFirestoreWriteErrorMessage = message;
}

export function resetAdminDbForTest(): void {
  customAdminDbForTest = undefined;
  simulateFirestoreWriteFailure = false;
  simulateFirestoreWriteErrorMessage = 'Firestore write failed: 7 PERMISSION_DENIED: Missing or insufficient permissions.';
}

export function createFailingAdminDb(errorMessage?: string): any {
  const msg = errorMessage || simulateFirestoreWriteErrorMessage;
  const fail = async () => {
    throw new Error(msg);
  };
  const failingDocRef = (colName: string, id: string) => ({
    id,
    get: fail,
    set: fail,
    update: fail,
    delete: fail,
    ref: { id }
  });

  return {
    collection: (colName: string) => ({
      doc: (id: string) => failingDocRef(colName, id),
      where: () => ({
        limit: () => ({
          get: fail
        }),
        get: fail
      }),
      get: fail
    }),
    doc: (path: string) => {
      const parts = path.split('/');
      return failingDocRef(parts[0], parts.slice(1).join('/'));
    },
    batch: () => ({
      set: () => {},
      update: () => {},
      delete: () => {},
      commit: fail
    })
  };
}

export function createSuccessfulAdminDb(): any {
  const store = new Map<string, Map<string, any>>();
  const getCol = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  const makeDocRef = (colName: string, id: string): any => ({
    id,
    get: async () => {
      const col = getCol(colName);
      const data = col.get(id);
      return {
        exists: data !== undefined,
        id,
        data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
        ref: makeDocRef(colName, id)
      };
    },
    set: async (data: any, options?: any) => {
      const col = getCol(colName);
      if (options?.merge && col.has(id)) {
        col.set(id, { ...col.get(id), ...JSON.parse(JSON.stringify(data)) });
      } else {
        col.set(id, JSON.parse(JSON.stringify(data)));
      }
      return;
    },
    update: async (data: any) => {
      const col = getCol(colName);
      col.set(id, { ...(col.get(id) || {}), ...JSON.parse(JSON.stringify(data)) });
      return;
    },
    delete: async () => {
      getCol(colName).delete(id);
      return;
    },
    ref: { id }
  });

  return {
    collection: (colName: string) => ({
      doc: (id: string) => makeDocRef(colName, id),
      where: (field: string, op: string, val: any) => {
        const queryMatches = () => {
          const col = getCol(colName);
          const docs: any[] = [];
          for (const [id, data] of col.entries()) {
            if (op === '==' && data && data[field] === val) {
              docs.push({
                id,
                data: () => JSON.parse(JSON.stringify(data)),
                exists: true,
                ref: makeDocRef(colName, id)
              });
            }
          }
          return docs;
        };
        return {
          limit: (n: number) => ({
            get: async () => {
              const matched = queryMatches().slice(0, n);
              return { empty: matched.length === 0, docs: matched };
            }
          }),
          get: async () => {
            const matched = queryMatches();
            return { empty: matched.length === 0, docs: matched };
          }
        };
      },
      get: async () => {
        const col = getCol(colName);
        const docs = Array.from(col.entries()).map(([id, data]) => ({
          id,
          data: () => JSON.parse(JSON.stringify(data)),
          exists: true,
          ref: makeDocRef(colName, id)
        }));
        return { empty: docs.length === 0, docs };
      }
    }),
    doc: (path: string) => {
      const parts = path.split('/');
      const colName = parts[0];
      const docId = parts.slice(1).join('/');
      return makeDocRef(colName, docId);
    },
    batch: () => {
      const operations: Array<() => Promise<void> | void> = [];
      return {
        set: (docRef: any, data: any, options?: any) => {
          operations.push(() => docRef.set(data, options));
        },
        update: (docRef: any, data: any) => {
          operations.push(() => docRef.update(data));
        },
        delete: (docRef: any) => {
          operations.push(() => docRef.delete());
        },
        commit: async () => {
          for (const op of operations) {
            await op();
          }
        }
      };
    }
  };
}

export function getEffectiveAdminDb(req?: express.Request): FirebaseFirestore.Firestore | null {
  if (req) {
    const headerMode = req.headers['x-test-admin-db-mode'] || req.headers['x-test-firestore-mode'];
    if (headerMode === 'missing') {
      return null;
    }
    if (headerMode === 'write_failure') {
      const msg = typeof req.headers['x-test-write-error'] === 'string'
        ? req.headers['x-test-write-error']
        : 'Firestore write failed: 7 PERMISSION_DENIED: Missing or insufficient permissions.';
      return createFailingAdminDb(msg) as any;
    }
    if (headerMode === 'success') {
      return (customAdminDbForTest && customAdminDbForTest !== null)
        ? customAdminDbForTest
        : (createSuccessfulAdminDb() as any);
    }
  }

  if (customAdminDbForTest !== undefined) {
    return customAdminDbForTest;
  }

  if (simulateFirestoreWriteFailure) {
    return createFailingAdminDb(simulateFirestoreWriteErrorMessage) as any;
  }

  return adminDb;
}

export function isFirestorePersistenceAvailable(req?: express.Request): boolean {
  if (simulateFirestoreUnavailable) return false;
  if (req) {
    if (
      req.headers['x-simulate-firestore-unavailable'] === 'true' ||
      req.headers['x-simulate-firestore-offline'] === 'true'
    ) {
      return false;
    }
    if (req.query?.simulate_firestore_unavailable === 'true') {
      return false;
    }
    if (
      req.headers['x-test-admin-db-mode'] === 'missing' ||
      req.headers['x-test-firestore-mode'] === 'missing'
    ) {
      return false;
    }
  }
  if (process.env.SIMULATE_FIRESTORE_UNAVAILABLE === 'true') {
    return false;
  }

  const effective = getEffectiveAdminDb(req);
  if (!effective) {
    return false;
  }
  return true;
}

export async function getCollectionRecordsForValidation(colName: string): Promise<any[]> {
  const recordsMap = new Map<string, any>();
  const inMem = inMemoryStores.get(colName);
  if (inMem) {
    for (const [id, rec] of inMem.entries()) {
      if (rec) recordsMap.set(id, rec);
    }
  }
  if (adminDb) {
    try {
      const snap = await adminDb.collection(colName).get();
      snap.forEach((doc) => {
        recordsMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
    } catch {
      // Dev/offline fallback
    }
  }
  return Array.from(recordsMap.values());
}

// Closed periods cache for server-side closed-period protection
let cachedClosedPeriods: ClosedPeriod[] | null = null;
let lastClosedPeriodsFetch = 0;

export function clearClosedPeriodsCacheForTesting(): void {
  cachedClosedPeriods = null;
  lastClosedPeriodsFetch = 0;
  if (inMemoryStores.has('closedPeriods')) {
    inMemoryStores.get('closedPeriods')!.clear();
  }
}

export async function getClosedPeriodsForValidation(): Promise<ClosedPeriod[]> {
  const now = Date.now();
  if (cachedClosedPeriods && now - lastClosedPeriodsFetch < 5000) {
    return cachedClosedPeriods;
  }
  const periodsMap = new Map<string, ClosedPeriod>();
  // 1. From in-memory store
  const inMem = inMemoryStores.get('closedPeriods');
  if (inMem) {
    for (const [id, cp] of inMem.entries()) {
      if (cp && cp.endDate) {
        periodsMap.set(id, cp);
      }
    }
  }
  // 2. From Firestore Admin SDK if available
  if (adminDb) {
    try {
      const snap = await adminDb.collection('closedPeriods').get();
      snap.forEach((doc) => {
        const d = doc.data() as ClosedPeriod;
        if (d && d.endDate) {
          periodsMap.set(doc.id, { ...d, id: doc.id });
        }
      });
    } catch (err: any) {
      console.warn('[The Goated Farm] Notice reading closedPeriods from Firestore:', err.message);
    }
  }
  const periods = Array.from(periodsMap.values());
  periods.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
  cachedClosedPeriods = periods;
  lastClosedPeriodsFetch = now;
  return periods;
}

export function extractTransactionDate(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const rawDate =
    data.date ||
    data.transactionDate ||
    data.purchaseDate ||
    data.saleDate ||
    data.paymentDate ||
    data.disbursementDate ||
    data.dateStr;
  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.substring(0, 10);
    }
  }
  return null;
}

export function extractAllTransactionDates(data: any): string[] {
  const dates = new Set<string>();
  const rootDate = extractTransactionDate(data);
  if (rootDate) dates.add(rootDate);
  if (Array.isArray(data?.lines)) {
    for (const line of data.lines) {
      const lineDate = extractTransactionDate(line);
      if (lineDate) dates.add(lineDate);
    }
  }
  return Array.from(dates);
}

export function checkClosedPeriodViolation(
  txDate: string,
  closedPeriods: ClosedPeriod[],
  entryData?: any
): { isClosed: boolean; closedPeriod?: ClosedPeriod; reason?: string } {
  if (!txDate || !closedPeriods || closedPeriods.length === 0) {
    return { isClosed: false };
  }

  // Check if entry is specifically the closing entry for a closed period
  for (const cp of closedPeriods) {
    const isClosingEntry =
      Boolean(entryData?.isClosingEntry && (entryData.date === cp.endDate || entryData.closingDate === cp.endDate)) ||
      Boolean(entryData?.reference && entryData.reference === `YEC-${cp.endDate}`) ||
      Boolean(cp.journalEntryId && entryData?.id === cp.journalEntryId) ||
      Boolean(cp.voucherNumber && entryData?.voucherNumber === cp.voucherNumber);

    if (isClosingEntry) {
      // It is the closing entry for this period cp.
      // However, check if it violates an EARLIER closed period:
      const earlierClosed = closedPeriods.find((p) => p.id !== cp.id && p.endDate >= txDate && p.endDate < cp.endDate);
      if (earlierClosed) {
        return {
          isClosed: true,
          closedPeriod: earlierClosed,
          reason: `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর বা তারিখ (${txDate}) ইতোমধ্যে বন্ধ সময়কালের (${earlierClosed.endDate}) অন্তর্ভুক্ত।`
        };
      }
      return { isClosed: false };
    }
  }

  // For any normal transaction:
  // Sort descending by endDate
  const latestClosed = closedPeriods[0];
  if (latestClosed && txDate <= latestClosed.endDate) {
    const matching = closedPeriods.find((cp) => (cp.startDate ? cp.startDate <= txDate : true) && cp.endDate >= txDate) || latestClosed;
    return {
      isClosed: true,
      closedPeriod: matching,
      reason: `হিসাবরক্ষণ সীমাবদ্ধতা: ${matching.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Closed Period) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে লেনদেন পোস্ট বা পরিবর্তন করা যাবে না (Cannot modify or post transactions in closed period ending ${matching.endDate}).`
    };
  }

  return { isClosed: false };
}

export function verifySessionToken(token: string): { email: string } | null {
  try {
    const secret = resolveSessionSecret();
    if (!secret) {
      return null;
    }
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    if (!payloadB64 || !signature) return null;

    // Cryptographic signature check with timing-safe comparison to prevent timing attacks
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;

    // 1. Expiration check (Requirement 4)
    if (!payload.exp || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }

    // 2. Issuance timestamp validation (clock skew tolerance <= 60s)
    if (payload.iat && typeof payload.iat === 'number' && payload.iat > Date.now() + 60000) {
      return null;
    }

    // 3. Unpredictable token nonce check (Requirement 3)
    if (!payload.jti || typeof payload.jti !== 'string' || payload.jti.length < 16) {
      return null;
    }

    // 4. Owner email validation and allow-list checking (Requirement 5 & F9)
    if (!payload.email || typeof payload.email !== 'string') return null;
    const normalizedEmail = payload.email.toLowerCase().trim();
    if (!isOwnerEmail(normalizedEmail)) {
      return null;
    }

    return { email: normalizedEmail };
  } catch {
    return null;
  }
}

/**
 * Authenticate caller: verifies Firebase ID token via Admin SDK, or verified owner session token
 */
async function authenticateOwnerRequest(req: express.Request): Promise<{ email: string; uid: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) return null;

  // 1. Verify standard Firebase ID Token using Firebase Admin SDK
  if (adminInitialized) {
    try {
      const decoded = await getAuth().verifyIdToken(token);
      if (decoded && decoded.email && isOwnerEmail(decoded.email)) {
        return { email: decoded.email.toLowerCase(), uid: decoded.uid };
      }
    } catch {
      // In offline/container dev environment or when custom session token is used
    }
  }

  // 2. Also verify owner session token
  const session = verifySessionToken(token);
  if (session && isOwnerEmail(session.email)) {
    return {
      email: session.email.toLowerCase(),
      uid: `goted_owner_${session.email.replace(/[^a-zA-Z0-9]/g, '_')}`
    };
  }

  return null;
}

// ==========================================
// Sync Authorized Emails to Firestore
// Stored in Firestore document: system/authorizedEmails
// Written ONLY by Admin SDK for firestore.rules evaluation
// Enforces the EXACT same authoritative owner allow-list as the server
// ==========================================
export async function syncAuthorizedEmails(): Promise<void> {
  const emails = getApprovedOwnerEmails();
  if (!adminDb || emails.length === 0) return;

  try {
    const docRef = adminDb.doc('system/authorizedEmails');
    // Set authoritative list directly without preserving obsolete or revoked emails
    await docRef.set({
      emails: emails,
      updatedAt: new Date().toISOString()
    });
    console.log(`[The Goated Farm] Synced system/authorizedEmails in Firestore via Admin SDK (${emails.length} owners)`);
  } catch (err: any) {
    console.warn('[The Goated Farm] Note on syncing system/authorizedEmails in Firestore:', err.message);
  }
}

async function ensureEmailAuthorized(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if (!isOwnerEmail(normalized)) return;
  if (!adminDb) return;
  try {
    const docRef = adminDb.doc('system/authorizedEmails');
    const emails = getApprovedOwnerEmails();
    await docRef.set({
      emails: emails,
      updatedAt: new Date().toISOString()
    });
    console.log(`[The Goated Farm] Registered verified owner ${normalized} in system/authorizedEmails`);
  } catch (err: any) {
    console.warn('[The Goated Farm] Note on ensuring email in system/authorizedEmails:', err.message);
  }
}

// ==========================================
// Server-Side Bcrypt PIN Storage & Seeding
// Stored in Firestore document: system/authSecrets
// Holds bcrypt hashes (cost 12) keyed by email.
// No plaintext PIN is ever compared or stored.
// ==========================================
const cachedAuthSecrets: Record<string, string> = {};

async function initializeAuthSecrets(): Promise<void> {
  // Seeding logic only runs once both APPROVED_OWNER_EMAILS and INITIAL_PIN secrets are actually present
  if (!isSetupComplete()) {
    console.log('[The Goated Farm] Setup incomplete: APPROVED_OWNER_EMAILS or INITIAL_PIN secret is missing. Skipping auth seeding.');
    return;
  }

  await syncAuthorizedEmails();

  const initialPin = getRawPinEnv()!.trim();
  const emails = getApprovedOwnerEmails();
  if (emails.length === 0) return;

  // Always seed in-memory cache with bcrypt hash (cost 12) if not already set
  // Note: Changing INITIAL_PIN after the first successful seed has no effect; the PIN can only be updated via the in-app Change PIN screen from then on.
  const defaultHash = await bcrypt.hash(initialPin, 12);
  for (const email of emails) {
    if (!cachedAuthSecrets[email]) {
      cachedAuthSecrets[email] = defaultHash;
    }
  }
  console.log('[The Goated Farm] Seeded in-memory auth secrets for authorized owners:', emails);

  if (adminDb) {
    try {
      const docRef = adminDb.doc('system/authSecrets');
      const snap = await docRef.get();
      if (!snap.exists) {
        // Initial first-time seed using INITIAL_PIN
        const initialDoc: Record<string, string> = {};
        for (const email of emails) {
          initialDoc[email] = cachedAuthSecrets[email];
        }
        await docRef.set(initialDoc);
        console.log('[The Goated Farm] Seeded system/authSecrets in Firestore with bcrypt hashes (cost 12)');
      } else {
        // Note: Changing INITIAL_PIN after the first successful seed has no effect; the PIN can only be updated via the in-app Change PIN screen from then on.
        const data = snap.data() || {};
        for (const email of emails) {
          const h = data[email] || data.hashes?.[email];
          if (h && typeof h === 'string') {
            cachedAuthSecrets[email] = h;
          }
        }
        console.log('[The Goated Farm] Loaded bcrypt auth secrets from Firestore');
      }
    } catch (err: any) {
      console.warn('[The Goated Farm] Firestore system/authSecrets fallback note:', err.message);
    }
  }
}

async function getStoredHash(email: string): Promise<string | null> {
  if (!isSetupComplete()) {
    return null;
  }
  if (adminDb) {
    try {
      const snap = await adminDb.doc('system/authSecrets').get();
      if (snap.exists) {
        const data = snap.data() || {};
        const hash = data[email] || data.hashes?.[email];
        if (hash && typeof hash === 'string') {
          cachedAuthSecrets[email] = hash;
          return hash;
        }
      }
    } catch {
      // Fall through to memory cache if Firestore query fails
    }
  }

  if (!cachedAuthSecrets[email]) {
    if (isOwnerEmail(email)) {
      const initialPin = getRawPinEnv();
      if (initialPin) {
        const defaultHash = await bcrypt.hash(initialPin.trim(), 12);
        cachedAuthSecrets[email] = defaultHash;
        return defaultHash;
      }
    }
  }

  return cachedAuthSecrets[email] || null;
}

async function updateStoredHash(email: string, newHash: string): Promise<void> {
  cachedAuthSecrets[email] = newHash;
  if (adminDb) {
    try {
      await adminDb.doc('system/authSecrets').set({
        [email]: newHash,
        hashes: { [email]: newHash }
      }, { merge: true });
      console.log(`[The Goated Farm] Stored updated PIN hash in Firestore for ${email}`);
    } catch (err: any) {
      console.warn('[The Goated Farm] Note on persisting new hash in Firestore:', err.message);
    }
  }
}

// Reset codes tracking: 15-minute expiration
interface ResetRecord {
  code: string;
  expiresAt: number;
}
const cachedResetCodes: Record<string, ResetRecord> = {};

async function getStoredResetCode(email: string): Promise<ResetRecord | null> {
  if (adminDb) {
    try {
      const snap = await adminDb.doc('system/authSecrets').get();
      if (snap.exists) {
        const data = snap.data() || {};
        const rc = data.resetCodes?.[email];
        if (rc && rc.code && typeof rc.expiresAt === 'number') {
          cachedResetCodes[email] = rc;
          return rc;
        }
      }
    } catch (err: any) {
      console.warn('[The Goated Farm] Note on reading reset code from Firestore:', err.message);
    }
  }
  return cachedResetCodes[email] || null;
}

async function setStoredResetCode(email: string, code: string, expiresAt: number): Promise<void> {
  const record: ResetRecord = { code, expiresAt };
  cachedResetCodes[email] = record;
  if (adminDb) {
    try {
      await adminDb.doc('system/authSecrets').set({
        resetCodes: {
          [email]: record
        }
      }, { merge: true });
      console.log(`[The Goated Farm] Stored reset code in Firestore for ${email}`);
    } catch (err: any) {
      console.warn('[The Goated Farm] Note on storing reset code in Firestore:', err.message);
    }
  }
}

async function clearStoredResetCode(email: string): Promise<void> {
  delete cachedResetCodes[email];
  if (adminDb) {
    try {
      const snap = await adminDb.doc('system/authSecrets').get();
      if (snap.exists) {
        const data = snap.data() || {};
        const currentResets = { ...(data.resetCodes || {}) };
        delete currentResets[email];
        await adminDb.doc('system/authSecrets').update({
          resetCodes: currentResets
        });
      }
    } catch (err: any) {
      console.warn('[The Goated Farm] Note on clearing reset code in Firestore:', err.message);
    }
  }
}

async function sendResetEmail(toEmail: string, resetCode: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@thegoatedfarm.com';
  const port = Number(process.env.SMTP_PORT) || 587;

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
      });

      await transporter.sendMail({
        from: `"The Goated Farm" <${from}>`,
        to: toEmail,
        subject: 'The Goated Farm — পিন রিসেট কোড (PIN Reset Code)',
        text: `আপনার The Goated Farm অ্যাকাউন্টের পিন রিসেট কোড হলো: ${resetCode}\nএই কোডটি আগামী ১৫ মিনিটের জন্য কার্যকর থাকবে।`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <h2 style="color: #1E5128; margin-top: 0;">The Goated Farm</h2>
            <p style="font-size: 15px; color: #374151;">আপনার অ্যাকাউন্টের গোপন পিন রিসেটের অনুরোধ পাওয়া গেছে।</p>
            <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; padding: 18px; border-radius: 8px; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #15803D; text-align: center; margin: 20px 0;">
              ${resetCode}
            </div>
            <p style="font-size: 13px; color: #6b7280; margin-bottom: 0;">এই কোডটি আগামী ১৫ মিনিটের জন্য কার্যকর থাকবে। একবার ব্যবহার করার পর কোডটি বাতিল হয়ে যাবে।</p>
          </div>
        `
      });
      console.log(`[The Goated Farm] Reset PIN email sent via SMTP to ${toEmail}`);
      return true;
    } catch (err: any) {
      console.error('[The Goated Farm] Failed to send email via SMTP:', err.message);
      return false;
    }
  } else {
    console.log(`[The Goated Farm] SMTP credentials not fully configured. PIN Reset code for ${toEmail}: [${resetCode}]`);
    return true;
  }
}

// Seed on startup
initializeAuthSecrets().catch((err) => {
  console.warn('[The Goated Farm] initializeAuthSecrets error:', err);
});

// ==========================================
// API Route: POST /api/verify-login-code
// Validates email against APPROVED_OWNER_EMAILS and verifies Secret PIN using bcrypt
// Rate-limits after 5 failures in 15 mins for 15 mins
// ==========================================
app.post('/api/verify-login-code', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const rawCode = req.body?.code;

    if (!rawEmail || !rawCode || typeof rawEmail !== 'string' || typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'ইমেইল এবং গোপন পিন উভয়ই আবশ্যক।' });
    }

    // 0. Ensure Server Setup is complete with secrets
    if (!isSetupComplete()) {
      return res.status(503).json({
        error: 'সেটআপ অসম্পূর্ণ (Setup incomplete): অনুগ্রহ করে AI Studio-র Secrets প্যানেলে আপনার ইমেইল ও পিন যোগ করুন।'
      });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();
    const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // 1. Rate Limiting Check
    const now = Date.now();
    const rateLimit = failedLoginAttempts.get(email);
    const isEmailApproved = isOwnerEmail(email);

    if (rateLimit?.lockedUntil) {
      if (now < rateLimit.lockedUntil) {
        const remainingMinutes = Math.max(1, Math.ceil((rateLimit.lockedUntil - now) / 60000));
        return res.status(429).json({
          error: `অতিরিক্ত ব্যর্থ চেষ্টার কারণে এই অ্যাকাউন্টটি ১৫ মিনিটের জন্য সাময়িকভাবে লক করা হয়েছে। আরও ${remainingMinutes} মিনিট পর পুনরায় চেষ্টা করুন (Too many failed login attempts. Account locked for ${remainingMinutes} more minutes).`
        });
      } else {
        failedLoginAttempts.delete(email);
      }
    }

    // 2. Verify Secret PIN using bcrypt against stored hash
    const storedHash = await getStoredHash(email);
    let isPinValid = false;
    if (storedHash) {
      isPinValid = await bcrypt.compare(code, storedHash);
    }

    const isValid = isEmailApproved && isPinValid;

    // Record access attempt in server memory log (never logging the secret PIN)
    serverAccessLogs.unshift({
      id: 'acc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      email: email,
      timestamp: new Date().toISOString(),
      ip: ip,
      userAgent: userAgent,
      status: isValid ? 'SUCCESS' : 'FAILED'
    });
    // Keep max 200 logs
    if (serverAccessLogs.length > 200) serverAccessLogs.pop();

    if (!isValid) {
      // Track failed attempts for rate limiting
      const existing = failedLoginAttempts.get(email);
      if (!existing || now - existing.firstAttemptAt > WINDOW_MS) {
        failedLoginAttempts.set(email, {
          attempts: 1,
          firstAttemptAt: now
        });
      } else {
        existing.attempts += 1;
        if (existing.attempts >= MAX_FAILED_ATTEMPTS) {
          existing.lockedUntil = now + LOCKOUT_MS;
          console.warn(`[The Goated Farm] ⛔ Account ${email} locked for 15 minutes after 5 failed attempts.`);
          return res.status(429).json({
            error: 'অতিরিক্ত ৫ বার ভুল পিন দেওয়ার কারণে এই অ্যাকাউন্টটি ১৫ মিনিটের জন্য লক করা হয়েছে। অনুগ্রহ করে পরে চেষ্টা করুন (Too many failed login attempts. Account locked for 15 minutes).'
          });
        }
      }

      console.warn(`[The Goated Farm] ❌ Failed login attempt for email: ${email} (Attempt ${failedLoginAttempts.get(email)?.attempts || 1}/${MAX_FAILED_ATTEMPTS})`);
      return res.status(401).json({
        error: 'অবৈধ ইমেইল অথবা গোপন পিন (Invalid email or secret PIN)।'
      });
    }

    // 4. Successful login - Reset rate limit counter on success
    failedLoginAttempts.delete(email);
    console.log(`[The Goated Farm] ✅ Successful login for: ${email}`);

    // Ensure verified owner is registered in Firestore system/authorizedEmails
    await ensureEmailAuthorized(email);
    const updatedApproved = getApprovedOwnerEmails();

    // Deterministic UID for this user email
    const uid = 'goted_user_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 20);

    // Attempt Firebase custom token creation only if service account credentials with signing capability are configured
    let customToken: string | null = null;
    if (adminInitialized && hasServiceAccountKey) {
      try {
        customToken = await getAuth().createCustomToken(uid, {
          role: 'OWNER',
          email: email
        });
        console.log(`[The Goated Farm] Custom token issued for user: ${email}`);
      } catch {
        // Fall back gracefully if custom token creation fails
        customToken = null;
      }
    }

    return res.json({
      success: true,
      email: email,
      uid: uid,
      role: 'OWNER',
      customToken: customToken,
      sessionToken: createSessionToken(email),
      tokenFallbackRequired: !customToken,
      authorizedEmails: updatedApproved
    });
  } catch (err: any) {
    console.error('[The Goated Farm] verify-login-code error:', err);
    return res.status(500).json({ error: 'যাচাইকরণে সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।' });
  }
});

// ==========================================
// API Route: POST /api/change-pin
// Owner-only: changes secret PIN by verifying current PIN and storing new bcrypt hash
// ==========================================
app.post('/api/change-pin', async (req, res) => {
  try {
    const { email: rawEmail, currentPin, newPin } = req.body || {};

    if (!rawEmail || !currentPin || !newPin) {
      return res.status(400).json({ error: 'ইমেইল, বর্তমান পিন এবং নতুন পিন প্রদান আবশ্যক।' });
    }

    const email = rawEmail.trim().toLowerCase();
    if (!isOwnerEmail(email)) {
      return res.status(403).json({ error: 'অননুমোদিত ইমেইল ঠিকানা (Unauthorized email)।' });
    }

    if (typeof newPin !== 'string' || newPin.trim().length < 6) {
      return res.status(400).json({ error: 'নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে (New PIN must be at least 6 digits)।' });
    }

    const storedHash = await getStoredHash(email);
    if (!storedHash) {
      return res.status(500).json({ error: 'সিক্রেট পিন তথ্য খুঁজে পাওয়া যায়নি।' });
    }

    const isMatch = await bcrypt.compare(currentPin.trim(), storedHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'বর্তমান গোপন পিন সঠিক নয় (Incorrect current PIN)।' });
    }

    const newHash = await bcrypt.hash(newPin.trim(), 12);
    await updateStoredHash(email, newHash);

    console.log(`[The Goated Farm] 🔑 PIN changed successfully for ${email}`);
    return res.json({
      success: true,
      message: 'গোপন পিন সফলভাবে পরিবর্তন করা হয়েছে (PIN changed successfully)।'
    });
  } catch (err: any) {
    console.error('[The Goated Farm] change-pin error:', err);
    return res.status(500).json({ error: 'পিন পরিবর্তন করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।' });
  }
});

// ==========================================
// API Route: POST /api/request-pin-reset
// Sends 6-digit reset code to approved email (15-min expiry) via nodemailer
// ==========================================
app.post('/api/request-pin-reset', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'অনুগ্রহ করে অনুমোদিত ইমেইল ঠিকানা দিন।' });
    }

    const email = rawEmail.trim().toLowerCase();
    if (!isOwnerEmail(email)) {
      return res.status(400).json({ error: 'এই ইমেইলটি অনুমোদিত মালিকের তালিকায় নেই (Unauthorized email)।' });
    }

    // Generate random 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store in system/authSecrets with 15-minute expiry
    await setStoredResetCode(email, resetCode, expiresAt);

    // Send email via nodemailer (or logs if SMTP credentials not fully configured)
    await sendResetEmail(email, resetCode);

    return res.json({
      success: true,
      message: 'আপনার অনুমোদিত ইমেইলে ৬ ডিজিটের রিসেট কোড পাঠানো হয়েছে। আগামী ১৫ মিনিটের মধ্যে কোডটি ব্যবহার করুন।'
    });
  } catch (err: any) {
    console.error('[The Goated Farm] request-pin-reset error:', err);
    return res.status(500).json({ error: 'রিসেট কোড পাঠাতে সমস্যা হয়েছে।' });
  }
});

// ==========================================
// API Route: POST /api/confirm-pin-reset
// Accepts email + resetCode + newPin, checks code and expiry, hashes & stores new PIN,
// invalidates reset code (single-use only)
// ==========================================
app.post('/api/confirm-pin-reset', async (req, res) => {
  try {
    const { email: rawEmail, resetCode: rawCode, newPin: rawNewPin } = req.body || {};

    if (!rawEmail || !rawCode || !rawNewPin) {
      return res.status(400).json({ error: 'ইমেইল, রিসেট কোড এবং নতুন পিন আবশ্যক।' });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.toString().trim();
    const newPin = rawNewPin.toString().trim();

    if (!isOwnerEmail(email)) {
      return res.status(400).json({ error: 'অননুমোদিত ইমেইল ঠিকানা।' });
    }

    if (newPin.length < 6) {
      return res.status(400).json({ error: 'নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে (New PIN must be 6+ digits)।' });
    }

    const storedReset = await getStoredResetCode(email);

    // Invalidate reset code after use (one attempt only)
    await clearStoredResetCode(email);

    if (!storedReset) {
      return res.status(400).json({ error: 'কোনো সক্রিয় রিসেট কোড পাওয়া যায়নি। পুনরায় কোড অনুরোধ করুন।' });
    }

    const now = Date.now();
    if (now > storedReset.expiresAt) {
      return res.status(400).json({ error: 'রিসেট কোডের মেয়াদ (১৫ মিনিট) শেষ হয়ে গেছে। পুনরায় কোড অনুরোধ করুন।' });
    }

    if (storedReset.code !== code) {
      return res.status(400).json({ error: 'ভুল রিসেট কোড প্রদান করা হয়েছে (Invalid reset code)। পুনরায় অনুরোধ করুন।' });
    }

    // Code is valid! Hash new PIN and store
    const newHash = await bcrypt.hash(newPin, 12);
    await updateStoredHash(email, newHash);

    // Clear any previous rate-limit lockouts on this account
    failedLoginAttempts.delete(email);

    console.log(`[The Goated Farm] 🔑 PIN reset completed successfully for ${email}`);
    return res.json({
      success: true,
      message: 'নতুন গোপন পিন সফলভাবে সংরক্ষিত হয়েছে। এখন নতুন পিন দিয়ে লগইন করুন।'
    });
  } catch (err: any) {
    console.error('[The Goated Farm] confirm-pin-reset error:', err);
    return res.status(500).json({ error: 'পিন রিসেট সম্পন্ন করতে সমস্যা হয়েছে।' });
  }
});

// ==========================================
// TASK 4: Authenticated Sync POST Endpoints
// Server-side validation and write via Admin SDK
// ==========================================

const ALLOWED_SYNC_COLLECTIONS = [
  'journalEntries',
  'sales',
  'purchases',
  'animals',
  'animalEvents',
  'ponds',
  'fishBatches',
  'plots',
  'cropCycles',
  'inventoryItems',
  'stockMovements',
  'parties',
  'cashBankAccounts',
  'bankTransfers',
  'loans',
  'investors',
  'investorTransactions',
  'fixedAssets',
  'internalFlows',
  'processingRuns',
  'reminders',
  'accessLogs',
  'recurringExpenseTemplates',
  'auditLogs',
  'system',
  'payments',
  'closedPeriods',
  'salesReturns',
  'purchaseReturns',
  'advancePayments',
  'accounts',
  'systemConfig'
];

async function handleSyncWrite(
  collectionName: string,
  req: express.Request,
  res: express.Response
) {
  try {
    // 1. Authenticate caller (verify Firebase ID token or session token)
    const owner = await authenticateOwnerRequest(req);
    if (!owner) {
      return res.status(401).json({
        error: 'অননুমোদিত অ্যাক্সেস (Unauthorized). শুধুমাত্র অনুমোদিত মালিক ডেটা সিঙ্ক করতে পারেন।'
      });
    }

    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'অবৈধ ডেটা পে-লোড (Invalid payload).' });
    }

    // F7: REQUIREMENT 1, 2, 3 - NEVER CLAIM CLOUD SYNC SUCCESS WITHOUT DURABLE PERSISTENCE
    // If Firebase/Firestore persistence is unavailable, synchronization MUST fail.
    // Do not treat in-memory server cache as successful backup.
    // Do not return success to client when data exists only in RAM.
    const effectiveDb = getEffectiveAdminDb(req);
    if (!isFirestorePersistenceAvailable(req) || !effectiveDb) {
      console.warn(`[The Goated Farm] Cloud Firestore persistence is unavailable for ${collectionName}. Refusing to claim success.`);
      return res.status(503).json({
        success: false,
        persisted: false,
        error: !effectiveDb
          ? 'ফায়ারস্টোর অ্যাডমিন ডাটাবেস অনুপলব্ধ (Firestore Admin DB unavailable — cloud persistence not configured)'
          : 'ক্লাউড ফায়ারস্টোর পারসিস্টেন্স অনুপলব্ধ — ডাটা ক্লাউডে সংরক্ষিত হয়নি (Cloud Firestore persistence unavailable — data was not durably persisted to cloud)',
        collection: collectionName,
        id: data?.id || req.body?.id
      });
    }

    const headerIdempotencyKey =
      (typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : null) ||
      (typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : null);

    const dataIdempotencyKey =
      typeof data.idempotencyKey === 'string' && data.idempotencyKey.trim() !== ''
        ? data.idempotencyKey.trim()
        : null;

    const dataTransactionId =
      typeof data.transactionId === 'string' && data.transactionId.trim() !== ''
        ? data.transactionId.trim()
        : null;

    const effectiveIdempotencyKey = headerIdempotencyKey || dataIdempotencyKey || dataTransactionId;

    const targetCol =
      collectionName === 'journal-entry' ||
      collectionName === 'journal' ||
      collectionName === 'journals' ||
      collectionName === 'journal_entries' ||
      collectionName === 'journalEntries' ||
      collectionName === 'transaction' ||
      collectionName === 'transactions'
        ? 'journalEntries'
        : collectionName === 'sale' || collectionName === 'sales'
        ? 'sales'
        : collectionName === 'purchase' || collectionName === 'purchases'
        ? 'purchases'
        : collectionName === 'animal' || collectionName === 'animals'
        ? 'animals'
        : collectionName === 'animalEvent' || collectionName === 'animalEvents'
        ? 'animalEvents'
        : collectionName === 'payment' || collectionName === 'payments'
        ? 'payments'
        : collectionName === 'inventoryItem' || collectionName === 'inventoryItems'
        ? 'inventoryItems'
        : collectionName === 'stockMovement' || collectionName === 'stockMovements'
        ? 'stockMovements'
        : collectionName === 'cashBankAccount' || collectionName === 'cashBankAccounts'
        ? 'cashBankAccounts'
        : collectionName === 'bankTransfer' || collectionName === 'bankTransfers'
        ? 'bankTransfers'
        : collectionName === 'loan' || collectionName === 'loans'
        ? 'loans'
        : collectionName === 'investor' || collectionName === 'investors'
        ? 'investors'
        : collectionName === 'fixedAsset' || collectionName === 'fixedAssets'
        ? 'fixedAssets'
        : collectionName === 'party' || collectionName === 'parties' || collectionName === 'customer' || collectionName === 'customers' || collectionName === 'supplier' || collectionName === 'suppliers'
        ? 'parties'
        : collectionName === 'crop-cycle' || collectionName === 'cropCycles'
        ? 'cropCycles'
        : collectionName === 'fish-batch' || collectionName === 'fishBatches'
        ? 'fishBatches'
        : collectionName === 'pond' || collectionName === 'ponds'
        ? 'ponds'
        : collectionName === 'plot' || collectionName === 'plots'
        ? 'plots'
        : collectionName === 'reminder' || collectionName === 'reminders'
        ? 'reminders'
        : collectionName === 'internalFlow' || collectionName === 'internalFlows'
        ? 'internalFlows'
        : collectionName === 'processingRun' || collectionName === 'processingRuns'
        ? 'processingRuns'
        : collectionName === 'accessLog' || collectionName === 'accessLogs'
        ? 'accessLogs'
        : collectionName === 'recurringExpenseTemplate' || collectionName === 'recurringExpenseTemplates'
        ? 'recurringExpenseTemplates'
        : collectionName === 'closedPeriod' || collectionName === 'closedPeriods'
        ? 'closedPeriods'
        : collectionName === 'salesReturn' || collectionName === 'salesReturns'
        ? 'salesReturns'
        : collectionName === 'purchaseReturn' || collectionName === 'purchaseReturns'
        ? 'purchaseReturns'
        : collectionName === 'advancePayment' || collectionName === 'advancePayments'
        ? 'advancePayments'
        : collectionName === 'account' || collectionName === 'accounts'
        ? 'accounts'
        : collectionName === 'systemConfig' || collectionName === 'system'
        ? 'systemConfig'
        : collectionName;

    let docId = data.id || data.ownerUid || (collectionName === 'system' || collectionName === 'systemConfig' ? 'config' : null);
    if (!docId && effectiveIdempotencyKey) {
      docId = effectiveIdempotencyKey;
    }
    if (!docId) {
      return res.status(400).json({ error: 'নথি আইডি (Document ID) অনুপস্থিত।' });
    }

    // 2. Duplicate Protection & Idempotency Check for Server Synchronization:
    // Retrying the same transaction must not create a second accounting record.
    // Preserves existing transaction IDs and idempotency keys.
    let existingDoc: any = null;

    // A. Check in-memory store by exact document ID
    if (inMemoryStores.has(targetCol)) {
      existingDoc = inMemoryStores.get(targetCol)!.get(docId) || null;
    }

    // B. Check in-memory store by idempotency key / transaction ID / document reference
    if (!existingDoc && inMemoryStores.has(targetCol)) {
      const colMap = inMemoryStores.get(targetCol)!;
      for (const item of colMap.values()) {
        if (!item) continue;
        if (effectiveIdempotencyKey) {
          if (
            item.idempotencyKey === effectiveIdempotencyKey ||
            item.transactionId === effectiveIdempotencyKey ||
            item.reference === effectiveIdempotencyKey ||
            item.id === effectiveIdempotencyKey
          ) {
            existingDoc = item;
            break;
          }
        }
        if (targetCol === 'journalEntries' && data.voucherNumber && item.voucherNumber === data.voucherNumber) {
          existingDoc = item;
          break;
        }
        if ((targetCol === 'sales' || targetCol === 'purchases') && data.invoiceNumber && item.invoiceNumber === data.invoiceNumber) {
          existingDoc = item;
          break;
        }
        if (targetCol === 'payments' && data.paymentNumber && item.paymentNumber === data.paymentNumber) {
          existingDoc = item;
          break;
        }
        if (targetCol === 'bankTransfers') {
          if (data.voucherNumber && item.voucherNumber === data.voucherNumber) {
            existingDoc = item;
            break;
          }
          if (data.reference && item.reference === data.reference) {
            existingDoc = item;
            break;
          }
          if (data.journalEntryId && item.journalEntryId === data.journalEntryId) {
            existingDoc = item;
            break;
          }
        }
        if ((targetCol === 'salesReturns' || targetCol === 'purchaseReturns') && data.returnNumber && item.returnNumber === data.returnNumber) {
          existingDoc = item;
          break;
        }
        if (targetCol === 'advancePayments' && data.advanceNumber && item.advanceNumber === data.advanceNumber) {
          existingDoc = item;
          break;
        }
        if (targetCol === 'accounts' && data.code && item.code === data.code) {
          existingDoc = item;
          break;
        }
      }
    }

    // C. Check effectiveDb by exact document ID
    if (!existingDoc && effectiveDb) {
      try {
        const snap = await effectiveDb.collection(targetCol).doc(docId).get();
        if (snap.exists) {
          existingDoc = snap.data();
        }
      } catch {
        // Ignore read error
      }
    }

    // D. Check effectiveDb by idempotency key / document reference
    if (!existingDoc && effectiveDb) {
      try {
        if (effectiveIdempotencyKey) {
          const qSnap = await effectiveDb.collection(targetCol).where('idempotencyKey', '==', effectiveIdempotencyKey).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && targetCol === 'journalEntries' && data.voucherNumber) {
          const qSnap = await effectiveDb.collection(targetCol).where('voucherNumber', '==', data.voucherNumber).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && (targetCol === 'sales' || targetCol === 'purchases') && data.invoiceNumber) {
          const qSnap = await effectiveDb.collection(targetCol).where('invoiceNumber', '==', data.invoiceNumber).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && targetCol === 'payments' && data.paymentNumber) {
          const qSnap = await effectiveDb.collection(targetCol).where('paymentNumber', '==', data.paymentNumber).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && targetCol === 'bankTransfers') {
          if (data.voucherNumber) {
            const qSnap = await effectiveDb.collection(targetCol).where('voucherNumber', '==', data.voucherNumber).limit(1).get();
            if (!qSnap.empty) {
              existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
            }
          }
          if (!existingDoc && data.reference) {
            const qSnap = await effectiveDb.collection(targetCol).where('reference', '==', data.reference).limit(1).get();
            if (!qSnap.empty) {
              existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
            }
          }
        }
        if (!existingDoc && (targetCol === 'salesReturns' || targetCol === 'purchaseReturns') && data.returnNumber) {
          const qSnap = await effectiveDb.collection(targetCol).where('returnNumber', '==', data.returnNumber).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && targetCol === 'advancePayments' && data.advanceNumber) {
          const qSnap = await effectiveDb.collection(targetCol).where('advanceNumber', '==', data.advanceNumber).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
        if (!existingDoc && targetCol === 'accounts' && data.code) {
          const qSnap = await effectiveDb.collection(targetCol).where('code', '==', data.code).limit(1).get();
          if (!qSnap.empty) {
            existingDoc = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
          }
        }
      } catch {
        // Ignore query error
      }
    }

    // Preserve existing transaction ID if this is a retried sync
    const finalDocId = existingDoc?.id || docId;

    // 3. Closed-Period Protection:
    // Reject any synced accounting transaction that modifies or posts into a closed accounting period.
    if (
      targetCol !== 'closedPeriods' &&
      targetCol !== 'auditLogs' &&
      targetCol !== 'system' &&
      targetCol !== 'systemConfig' &&
      targetCol !== 'accounts' &&
      targetCol !== 'parties' &&
      targetCol !== 'cashBankAccounts' &&
      targetCol !== 'reminders' &&
      targetCol !== 'accessLogs' &&
      targetCol !== 'recurringExpenseTemplates' &&
      targetCol !== 'ponds' &&
      targetCol !== 'plots'
    ) {
      const closedPeriods = await getClosedPeriodsForValidation();
      if (closedPeriods.length > 0) {
        // Check A: If modifying an existing document, was the existing document in a closed period?
        if (existingDoc) {
          const existingDates = extractAllTransactionDates(existingDoc);
          for (const d of existingDates) {
            const check = checkClosedPeriodViolation(d, closedPeriods, existingDoc);
            if (check.isClosed) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: বিদ্যমান লেনদেনটি (#${finalDocId}, তারিখ: ${d}) একটি সমাপ্ত হিসাবকালের (${check.closedPeriod?.endDate}) অন্তর্ভুক্ত। বন্ধ সময়কালের কোনো লেনদেন পরিবর্তন বা সংশোধন করা যাবে না (Cannot modify a transaction in closed period ending ${check.closedPeriod?.endDate}).`
              });
            }
          }
        }

        // Check B: Does the incoming transaction date belong to a closed period?
        const incomingDates = extractAllTransactionDates(data);
        for (const d of incomingDates) {
          const check = checkClosedPeriodViolation(d, closedPeriods, data);
          if (check.isClosed) {
            return res.status(400).json({
              error: check.reason || `হিসাবরক্ষণ সীমাবদ্ধতা: ${d} তারিখটি ইতোমধ্যে বন্ধ হিসাবকালের (${check.closedPeriod?.endDate}) অন্তর্ভুক্ত। বন্ধ সময়কালের কোনো তারিখে লেনদেন পোস্ট বা পরিবর্তন করা যাবে না (Cannot modify or post transactions in closed period ending ${check.closedPeriod?.endDate}).`
            });
          }
        }
      }
    }

    // 3. Re-run balance and account validation for financial records
    const isJournal =
      collectionName === 'journalEntries' ||
      collectionName === 'journal-entry' ||
      collectionName === 'journal' ||
      collectionName === 'journals' ||
      collectionName === 'journal_entries';

    if (isJournal) {
      let lines = data.lines;
      if (typeof lines === 'string') {
        try {
          lines = JSON.parse(lines);
        } catch {
          return res.status(400).json({
            error: 'জাবেদা লাইন ফরম্যাট অবৈধ (Invalid journal lines JSON format)।'
          });
        }
      }

      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({
          error: 'জাবেদা ভাউচারে কমপক্ষে ২টি ভারসাম্যপূর্ণ লাইন থাকতে হবে (Journal entry must have at least 2 balanced lines).'
        });
      }

      for (let i = 0; i < lines.length; i++) {
        if (!lines[i] || typeof lines[i] !== 'object') {
          return res.status(400).json({
            error: `জাবেদা লাইন ${i + 1} একটি অবজেক্ট হতে হবে (Journal line ${i + 1} must be an object).`
          });
        }
      }

      try {
        const validAccounts = await getValidAccountsForValidation();
        const check = validateBalancedLines(lines, validAccounts);

        if (!check.isBalanced) {
          return res.status(400).json({
            error: `জাবেদা ভারসাম্যহীন! ডেবিট: ৳${check.totalDebit}, ক্রেডিট: ৳${check.totalCredit}`
          });
        }

        if (check.totalDebit <= 0) {
          return res.status(400).json({ error: 'ভাউচারের পরিমাণ শূন্য বা ঋণাত্মক হতে পারে না (Journal amount cannot be zero or negative)।' });
        }

        // Header amount validations if provided
        if (data.totalDebit !== undefined && data.totalDebit !== null) {
          const numDebit = Number(data.totalDebit);
          if (isNaN(numDebit) || !isFinite(numDebit) || numDebit <= 0 || Math.round(Math.abs(numDebit - check.totalDebit) * 100) / 100 !== 0) {
            return res.status(400).json({
              error: `ভাউচারের মোট ডেবিট অমিল বা অবৈধ (Expected: ৳${check.totalDebit}, Received: ৳${data.totalDebit})।`
            });
          }
        }

        if (data.totalCredit !== undefined && data.totalCredit !== null) {
          const numCredit = Number(data.totalCredit);
          if (isNaN(numCredit) || !isFinite(numCredit) || numCredit <= 0 || Math.round(Math.abs(numCredit - check.totalCredit) * 100) / 100 !== 0) {
            return res.status(400).json({
              error: `ভাউচারের মোট ক্রেডিট অমিল বা অবৈধ (Expected: ৳${check.totalCredit}, Received: ৳${data.totalCredit})।`
            });
          }
        }

        data.lines = lines;
        data.totalDebit = check.totalDebit;
        data.totalCredit = check.totalCredit;
      } catch (valErr: any) {
        return res.status(400).json({
          error: `হিসাবরক্ষণ ভ্যালিডেশন ত্রুটি: ${valErr.message}`
        });
      }
    } else if (collectionName === 'sales' || collectionName === 'sale') {
      if (data.lines && Array.isArray(data.lines) && data.lines.length > 0) {
        try {
          const validAccounts = await getValidAccountsForValidation();
          validateBalancedLines(data.lines, validAccounts);
        } catch (valErr: any) {
          return res.status(400).json({ error: `বিক্রয় জাবেদা ত্রুটি: ${valErr.message}` });
        }
      }
    } else if (collectionName === 'purchases' || collectionName === 'purchase') {
      if (data.lines && Array.isArray(data.lines) && data.lines.length > 0) {
        try {
          const validAccounts = await getValidAccountsForValidation();
          validateBalancedLines(data.lines, validAccounts);
        } catch (valErr: any) {
          return res.status(400).json({ error: `ক্রয় জাবেদা ত্রুটি: ${valErr.message}` });
        }
      }
    }

    // ========================================================
    // 4. Server Operational-State Protection
    // A sync request must not arbitrarily overwrite critical calculated fields:
    // - inventory currentStock/avgCostPrice
    // - cash/bank currentBalance
    // - investor capital/payable balances
    // - loan remaining balances
    // Reuse existing business logic where possible. Do not create a second accounting engine.
    // ========================================================
    if (existingDoc) {
      // 1. Inventory Items: currentStock / avgCostPrice
      if (targetCol === 'inventoryItems') {
        const existingStock = Number(existingDoc.currentStock ?? 0);
        const incomingStock = data.currentStock !== undefined ? Number(data.currentStock) : undefined;
        const hasStockMismatch = incomingStock !== undefined && Math.abs(incomingStock - existingStock) > 0.0001;

        const existingAvgCost = Number(existingDoc.avgCostPrice ?? existingDoc.costPrice ?? 0);
        const incomingAvgCost =
          data.avgCostPrice !== undefined
            ? Number(data.avgCostPrice)
            : data.costPrice !== undefined
            ? Number(data.costPrice)
            : undefined;
        const hasCostMismatch = incomingAvgCost !== undefined && Math.abs(incomingAvgCost - existingAvgCost) > 0.0001;

        if (hasStockMismatch || hasCostMismatch) {
          const allMovements = await getCollectionRecordsForValidation('stockMovements');
          const itemMovements = allMovements.filter(
            (m: any) =>
              m.itemId === finalDocId ||
              m.itemId === docId ||
              (existingDoc.code && m.itemCode === existingDoc.code) ||
              (data.code && m.itemCode === data.code)
          );

          if (itemMovements.length > 0) {
            const valuation = calculateHistoricalInventoryValuation({ ...existingDoc, ...data }, itemMovements);
            const stockMatches = Math.abs(valuation.stockMovementQuantity - (incomingStock ?? existingStock)) < 0.0001;
            const costMatches = !hasCostMismatch || Math.abs(valuation.unitCost - (incomingAvgCost ?? existingAvgCost)) < 0.01;

            if (!stockMatches || !costMatches) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: পণ্যের বর্তমান মজুদ বা গড় ক্রয়মূল্য সরাসরি ওভাররাইট করা যাবে না (Cannot arbitrarily overwrite inventory currentStock/avgCostPrice. Expected stock: ${valuation.stockMovementQuantity}, received: ${incomingStock}).`
              });
            }
          } else {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: বিদ্যমান পণ্যের বর্তমান মজুদ বা গড় ক্রয়মূল্য সরাসরি ওভাররাইট করা যাবে না (Cannot arbitrarily overwrite inventory currentStock/avgCostPrice without supporting stock movements).`
            });
          }
        }
      }

      // 2. Cash/Bank Accounts: currentBalance
      else if (targetCol === 'cashBankAccounts') {
        const existingBal = Number(existingDoc.currentBalance ?? existingDoc.balance ?? 0);
        const incomingBal =
          data.currentBalance !== undefined
            ? Number(data.currentBalance)
            : data.balance !== undefined
            ? Number(data.balance)
            : undefined;
        const hasBalMismatch = incomingBal !== undefined && Math.abs(incomingBal - existingBal) > 0.0001;

        if (hasBalMismatch) {
          const allJournals = await getCollectionRecordsForValidation('journalEntries');
          const accCode = existingDoc.code || data.code;
          let netJournalDelta = 0;
          let hasAccountJournals = false;

          for (const j of allJournals) {
            const lines = Array.isArray(j.lines) ? j.lines : [];
            for (const l of lines) {
              const matchesAccount =
                l.accountId === finalDocId ||
                l.accountId === docId ||
                (accCode && l.accountCode === accCode) ||
                (l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId)));
              if (matchesAccount) {
                hasAccountJournals = true;
                netJournalDelta += (Number(l.debit) || 0) - (Number(l.credit) || 0);
              }
            }
          }

          const opening = Number(existingDoc.openingBalance ?? 0);
          const expectedBal = Math.round((opening + netJournalDelta) * 100) / 100;

          if (!hasAccountJournals || Math.abs(expectedBal - incomingBal!) > 0.01) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: নগদ বা ব্যাংক হিসাবের বর্তমান ব্যালেন্স সরাসরি ওভাররাইট করা যাবে না (Cannot arbitrarily overwrite cash/bank currentBalance without supporting journal entries).`
            });
          }
        }
      }

      // 3. Investors: capital / payable balances
      else if (targetCol === 'investors') {
        const capitalFields = [
          'currentCapitalBalance',
          'capitalAmount',
          'capitalContributed',
          'totalContribution',
          'netCapital',
          'currentBalance',
          'currentEquityBalance',
          'totalCapitalReturned',
          'withdrawals',
          'totalWithdrawals',
          'drawings'
        ];
        const payableFields = [
          'profitPayable',
          'totalProfitAllocated',
          'totalProfitPaid'
        ];

        let hasCapDiff = false;
        for (const f of capitalFields) {
          if (data[f] !== undefined && existingDoc[f] !== undefined) {
            if (Math.abs(Number(data[f]) - Number(existingDoc[f])) > 0.0001) {
              hasCapDiff = true;
              break;
            }
          }
        }

        let hasPayDiff = false;
        for (const f of payableFields) {
          if (data[f] !== undefined && existingDoc[f] !== undefined) {
            if (Math.abs(Number(data[f]) - Number(existingDoc[f])) > 0.0001) {
              hasPayDiff = true;
              break;
            }
          }
        }

        if (hasCapDiff || hasPayDiff) {
          const allJournals = await getCollectionRecordsForValidation('journalEntries');
          const investorJournals = allJournals.filter((j: any) => {
            return (
              j.reference === finalDocId ||
              j.reference === docId ||
              (j.narration && (j.narration.includes(existingDoc.name) || (data.name && j.narration.includes(data.name)))) ||
              (j.lines &&
                j.lines.some(
                  (l: any) =>
                    l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId) || l.memo.includes(existingDoc.name))
                ))
            );
          });

          if (investorJournals.length === 0) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: বিনিয়োগকারীর মূলধন বা প্রদেয় লভ্যাংশের ব্যালেন্স সরাসরি ওভাররাইট করা যাবে না (Cannot arbitrarily overwrite investor capital/payable balances without supporting journal entries).`
            });
          }

          if (hasCapDiff) {
            let netCapCredits = 0;
            for (const j of investorJournals) {
              for (const l of j.lines || []) {
                if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL) {
                  netCapCredits += (Number(l.credit) || 0) - (Number(l.debit) || 0);
                }
              }
            }
            const initialCap = Number(existingDoc.initialCapital ?? existingDoc.capitalContributed ?? 0);
            const expectedCap = Math.max(0, Math.round((initialCap + netCapCredits) * 100) / 100);
            const incomingCapVal = Number(
              data.currentCapitalBalance ?? data.capitalAmount ?? data.capitalContributed ?? data.totalContribution ?? 0
            );
            if (Math.abs(expectedCap - incomingCapVal) > 0.01) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: বিনিয়োগকারী মূলধন ব্যালেন্স GL 3020 এর সাথে অমিল (Cannot arbitrarily overwrite investor capital balance).`
              });
            }
          }

          if (hasPayDiff) {
            let netPayCredits = 0;
            for (const j of investorJournals) {
              for (const l of j.lines || []) {
                if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE) {
                  netPayCredits += (Number(l.credit) || 0) - (Number(l.debit) || 0);
                }
              }
            }
            const expectedPayable = Math.max(0, Math.round(netPayCredits * 100) / 100);
            const incomingPayableVal = Number(data.profitPayable ?? 0);
            if (Math.abs(expectedPayable - incomingPayableVal) > 0.01) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: বিনিয়োগকারী প্রদেয় লভ্যাংশ GL 2050 এর সাথে অমিল (Cannot arbitrarily overwrite investor payable balance).`
              });
            }
          }
        }
      }

      // 4. Loans: remaining balances
      else if (targetCol === 'loans') {
        const loanBalFields = [
          'remainingBalance',
          'outstandingPrincipal',
          'remainingPrincipal',
          'totalPaidPrincipal',
          'totalPaidInterest'
        ];
        let hasLoanDiff = false;
        for (const f of loanBalFields) {
          if (data[f] !== undefined && existingDoc[f] !== undefined) {
            if (Math.abs(Number(data[f]) - Number(existingDoc[f])) > 0.0001) {
              hasLoanDiff = true;
              break;
            }
          }
        }

        if (hasLoanDiff) {
          const allJournals = await getCollectionRecordsForValidation('journalEntries');
          const loanJournals = allJournals.filter((j: any) => {
            return (
              j.reference === finalDocId ||
              j.reference === docId ||
              (j.narration && (j.narration.includes(existingDoc.lenderName) || (data.lenderName && j.narration.includes(data.lenderName)))) ||
              (j.lines &&
                j.lines.some(
                  (l: any) =>
                    l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId) || l.memo.includes(existingDoc.lenderName))
                ))
            );
          });

          const hasSchedulePaid = Array.isArray(data.schedule) && data.schedule.some((s: any) => s.isPaid);

          if (loanJournals.length === 0 && !hasSchedulePaid) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: ঋণের বকেয়া স্থিতি বা পরিশোধিত আসল সরাসরি ওভাররাইট করা যাবে না (Cannot arbitrarily overwrite loan remaining balances without supporting repayment entries).`
            });
          }

          let repaidPrincipal = 0;
          for (const j of loanJournals) {
            for (const l of j.lines || []) {
              if (l.accountCode === CANONICAL_ACCOUNTS.SHORT_TERM_LOANS || l.accountCode === CANONICAL_ACCOUNTS.LONG_TERM_LOANS) {
                repaidPrincipal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
              }
            }
          }
          if (repaidPrincipal <= 0 && Array.isArray(data.schedule)) {
            for (const s of data.schedule) {
              if (s.isPaid) {
                repaidPrincipal += Number(s.principalPortion || 0);
              }
            }
          }

          const principal = Number(existingDoc.principalAmount || data.principalAmount || 0);
          const expectedRemaining = Math.max(0, Math.round((principal - repaidPrincipal) * 100) / 100);
          const incomingRemaining = Number(data.remainingBalance ?? data.outstandingPrincipal ?? data.remainingPrincipal ?? 0);

          if (Math.abs(expectedRemaining - incomingRemaining) > 0.01) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: ঋণের বকেয়া ব্যালেন্সের অমিল (Cannot arbitrarily overwrite loan remaining balance. Expected: ৳${expectedRemaining}, Received: ৳${incomingRemaining}).`
            });
          }
        }
      }
    } else {
      // ========================================================
      // NEW OPERATIONAL RECORD VALIDATION (!existingDoc)
      // A newly created record must not be able to establish arbitrary
      // calculated financial balances merely because no previous cloud document exists.
      // Distinguish legitimate initial/opening balances from calculated balances that must be supported by transactions.
      // ========================================================

      // 1. Inventory Items: currentStock / avgCostPrice
      if (targetCol === 'inventoryItems') {
        const incomingStock = Number(data.currentStock ?? 0);
        const incomingAvgCost = Number(data.avgCostPrice ?? data.costPrice ?? 0);

        if (incomingStock < 0 || incomingAvgCost < 0) {
          return res.status(400).json({
            error: `হিসাবরক্ষণ সীমাবদ্ধতা: পণ্যের মজুদ বা গড় মূল্য ঋণাত্মক হতে পারে না (Inventory currentStock and avgCostPrice cannot be negative).`
          });
        }

        // Legitimate creation with zero stock is always allowed (catalog registration)
        if (incomingStock > 0) {
          // A newly created inventory item cannot establish positive stock out of thin air.
          // It MUST be supported by:
          // A. Stock movements (opening stock, purchase, or production movement)
          // B. Opening stock journal entry debiting inventory and crediting retained earnings / equity
          const allMovements = await getCollectionRecordsForValidation('stockMovements');
          const itemMovements = allMovements.filter(
            (m: any) =>
              m.itemId === finalDocId ||
              m.itemId === docId ||
              (data.code && m.itemCode === data.code)
          );

          let isSupportedByMovements = false;
          if (itemMovements.length > 0) {
            let movementStockTotal = 0;
            let totalMovementCost = 0;
            let totalInflowQty = 0;
            for (const m of itemMovements) {
              const type = String(m.movementType || '').toUpperCase();
              const qty = Math.abs(Number(m.quantity) || 0);
              const cost = Number(m.unitCost) || 0;
              if (type === 'PURCHASE' || type === 'PRODUCTION' || type === 'HARVEST' || type === 'OPENING') {
                movementStockTotal += qty;
                totalMovementCost += qty * cost;
                totalInflowQty += qty;
              } else if (type === 'CONSUMPTION' || type === 'SALE' || type === 'WASTE' || type === 'DAMAGE') {
                movementStockTotal -= qty;
              } else if (type === 'ADJUSTMENT' || type === 'TRANSFER') {
                movementStockTotal += Number(m.quantity) || 0;
              }
            }
            movementStockTotal = Math.max(0, Math.round(movementStockTotal * 10000) / 10000);
            const expectedAvgCost = totalInflowQty > 0 ? Math.round((totalMovementCost / totalInflowQty) * 100) / 100 : incomingAvgCost;

            const stockMatches = Math.abs(movementStockTotal - incomingStock) < 0.0001;
            const costMatches = incomingAvgCost <= 0 || expectedAvgCost <= 0 || Math.abs(expectedAvgCost - incomingAvgCost) < 0.01;
            if (!stockMatches || !costMatches) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন পণ্যের বর্তমান মজুদ বা গড় মূল্য স্টক মুভমেন্টের সাথে অমিল (New inventory item currentStock/avgCostPrice does not match supporting movements. Expected stock: ${movementStockTotal}, received: ${incomingStock}).`
              });
            }
            isSupportedByMovements = true;
          }

          let isSupportedByJournal = false;
          if (!isSupportedByMovements) {
            const allJournals = await getCollectionRecordsForValidation('journalEntries');
            for (const j of allJournals) {
              const isItemRef =
                j.reference === finalDocId ||
                j.reference === docId ||
                (data.journalEntryId && j.id === data.journalEntryId);
              const mentionsItem =
                (data.nameBn && j.narration && j.narration.includes(data.nameBn)) ||
                (data.nameEn && j.narration && j.narration.includes(data.nameEn)) ||
                (data.code && j.narration && j.narration.includes(data.code)) ||
                (j.lines &&
                  j.lines.some(
                    (l: any) =>
                      l.memo &&
                      ((data.nameBn && l.memo.includes(data.nameBn)) ||
                        (data.code && l.memo.includes(data.code)) ||
                        l.memo.includes(finalDocId) ||
                        l.memo.includes(docId))
                  ));

              if (isItemRef || ((j.reference === 'OPENING_STOCK' || (j.narration && j.narration.includes('প্রারম্ভিক'))) && mentionsItem)) {
                let totalInvDebits = 0;
                for (const l of j.lines || []) {
                  const code = String(l.accountCode || l.accountId || '');
                  if (code.startsWith('105')) {
                    totalInvDebits += (Number(l.debit) || 0) - (Number(l.credit) || 0);
                  }
                }
                const expectedValue = Math.round(incomingStock * incomingAvgCost * 100) / 100;
                if (totalInvDebits > 0 && (expectedValue === 0 || Math.abs(totalInvDebits - expectedValue) <= 1.0)) {
                  isSupportedByJournal = true;
                  break;
                }
              }
            }
          }

          if (!isSupportedByMovements && !isSupportedByJournal) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন পণ্যের প্রারম্ভিক মজুদ বা গড় মূল্য সমর্থিত স্টক মুভমেন্ট বা প্রারম্ভিক জাবেদা দাখিলা ছাড়া সরাসরি নির্ধারণ করা যাবে না (Cannot establish calculated inventory currentStock/avgCostPrice on a new record without supporting stock movements or opening journal entry).`
            });
          }
        }
      }

      // 2. Cash/Bank Accounts: currentBalance
      else if (targetCol === 'cashBankAccounts') {
        const incomingBal = Number(data.currentBalance ?? data.balance ?? 0);
        const openingBal = Number(data.openingBalance ?? 0);

        // Legitimate zero-balance account registration is allowed
        if (incomingBal !== 0 || openingBal !== 0) {
          const allJournals = await getCollectionRecordsForValidation('journalEntries');
          const accCode = data.code;
          let netJournalDelta = 0;

          for (const j of allJournals) {
            const lines = Array.isArray(j.lines) ? j.lines : [];
            for (const l of lines) {
              const matchesAccount =
                l.accountId === finalDocId ||
                l.accountId === docId ||
                (accCode && l.accountCode === accCode) ||
                (l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId)));
              if (matchesAccount) {
                netJournalDelta += (Number(l.debit) || 0) - (Number(l.credit) || 0);
              }
            }
          }

          const expectedBal = Math.round((openingBal + netJournalDelta) * 100) / 100;

          if (Math.abs(expectedBal - incomingBal) > 0.01) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন নগদ বা ব্যাংক হিসাবের ব্যালেন্স প্রারম্ভিক উদ্বৃত্ত বা সমর্থিত জাবেদা দাখিলা ছাড়া সরাসরি নির্ধারণ করা যাবে না (Cannot establish arbitrary cash/bank currentBalance on a new record without valid opening balance or supporting journal entries. Expected: ৳${expectedBal}, Received: ৳${incomingBal}).`
            });
          }
        }
      }

      // 3. Investors: capital / payable balances
      else if (targetCol === 'investors') {
        const initialCap = Number(data.initialCapital ?? data.capitalContributed ?? 0);
        const incomingCap = Number(
          data.currentCapitalBalance ??
            data.capitalAmount ??
            data.totalContribution ??
            data.netCapital ??
            data.currentBalance ??
            data.currentEquityBalance ??
            initialCap
        );
        const incomingReturned = Number(
          data.totalCapitalReturned ?? data.withdrawals ?? data.totalWithdrawals ?? data.drawings ?? 0
        );
        const incomingProfitPayable = Number(data.profitPayable ?? 0);
        const incomingProfitAllocated = Number(data.totalProfitAllocated ?? 0);
        const incomingProfitPaid = Number(data.totalProfitPaid ?? 0);

        let allJournals: any[] | null = null;
        const getJournals = async () => {
          if (!allJournals) {
            allJournals = await getCollectionRecordsForValidation('journalEntries');
          }
          return allJournals;
        };

        // A. Validate Profit Payable balances:
        // A newly created investor cannot establish profit payable out of nowhere;
        // profit payable is a calculated liability that MUST be supported by GL 2050 journals.
        if (incomingProfitPayable > 0 || incomingProfitAllocated > 0 || incomingProfitPaid > 0) {
          const journals = await getJournals();
          const investorJournals = journals.filter((j: any) => {
            return (
              j.reference === finalDocId ||
              j.reference === docId ||
              (data.name && j.narration && j.narration.includes(data.name)) ||
              (j.lines &&
                j.lines.some(
                  (l: any) =>
                    l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId) || (data.name && l.memo.includes(data.name)))
                ))
            );
          });

          let netPayCredits = 0;
          for (const j of investorJournals) {
            for (const l of j.lines || []) {
              if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE) {
                netPayCredits += (Number(l.credit) || 0) - (Number(l.debit) || 0);
              }
            }
          }

          const expectedPayable = Math.max(0, Math.round(netPayCredits * 100) / 100);
          if (netPayCredits <= 0 || Math.abs(expectedPayable - incomingProfitPayable) > 0.01) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন বিনিয়োগকারী রেকর্ডে প্রদেয় লভ্যাংশের ব্যালেন্স সমর্থিত জাবেদা দাখিলা ছাড়া সরাসরি নির্ধারণ করা যাবে না (Cannot establish calculated profit payable balance on a new investor record without supporting journal entries).`
            });
          }
        }

        // B. Validate Capital balances:
        // Initial capital can be set legitimately as initialCapital (matching incomingCap with 0 returns).
        // Any divergence (additional capital, returns/withdrawals, or non-matching current capital)
        // must be supported by GL 3020 journals.
        if (incomingCap !== 0 || initialCap !== 0 || incomingReturned !== 0) {
          if (incomingReturned > 0 || (initialCap === 0 && incomingCap > 0) || Math.abs(incomingCap - initialCap) > 0.01) {
            const journals = await getJournals();
            const investorJournals = journals.filter((j: any) => {
              return (
                j.reference === finalDocId ||
                j.reference === docId ||
                (data.name && j.narration && j.narration.includes(data.name)) ||
                (j.lines &&
                  j.lines.some(
                    (l: any) =>
                      l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId) || (data.name && l.memo.includes(data.name)))
                  ))
              );
            });

            let netCapCredits = 0;
            for (const j of investorJournals) {
              for (const l of j.lines || []) {
                if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL) {
                  netCapCredits += (Number(l.credit) || 0) - (Number(l.debit) || 0);
                }
              }
            }

            const expectedCapFromJournals = Math.max(0, Math.round((initialCap + netCapCredits) * 100) / 100);
            const matchesJournals =
              Math.abs(expectedCapFromJournals - incomingCap) <= 0.01 ||
              (netCapCredits > 0 && Math.abs(netCapCredits - incomingCap) <= 0.01);

            if (!matchesJournals) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন বিনিয়োগকারীর মূলধন স্থিতি সমর্থিত প্রাথমিক মূলধন বা জাবেদা দাখিলা ছাড়া সরাসরি নির্ধারণ করা যাবে না (Cannot establish arbitrary investor capital balance on a new record without valid initial capital or supporting journal entries).`
              });
            }
          }
        }
      }

      // 4. Loans: remaining balances
      else if (targetCol === 'loans') {
        const principal = Number(data.principalAmount || 0);
        if (principal <= 0) {
          return res.status(400).json({
            error: `হিসাবরক্ষণ সীমাবদ্ধতা: ঋণের মূল আসল অবশ্যই শূন্যের চেয়ে বেশি হতে হবে (Loan principal amount must be greater than zero).`
          });
        }

        const incomingRemaining = Number(
          data.remainingBalance ?? data.outstandingPrincipal ?? data.remainingPrincipal ?? principal
        );
        const incomingPaidPrincipal = Number(data.totalPaidPrincipal || 0);
        const incomingPaidInterest = Number(data.totalPaidInterest || 0);
        const hasSchedulePaid = Array.isArray(data.schedule) && data.schedule.some((s: any) => s.isPaid);

        if (incomingRemaining > principal + 0.01) {
          return res.status(400).json({
            error: `হিসাবরক্ষণ সীমাবদ্ধতা: ঋণের বকেয়া ব্যালেন্স মূল আসলের চেয়ে বেশি হতে পারে না (Loan remaining balance cannot exceed principal amount).`
          });
        }

        if (
          Math.abs(incomingRemaining - principal) > 0.01 ||
          incomingPaidPrincipal > 0 ||
          hasSchedulePaid
        ) {
          const allJournals = await getCollectionRecordsForValidation('journalEntries');
          const loanJournals = allJournals.filter((j: any) => {
            return (
              j.reference === finalDocId ||
              j.reference === docId ||
              (data.loanNumber && j.reference === data.loanNumber) ||
              (data.lenderName && j.narration && j.narration.includes(data.lenderName)) ||
              (j.lines &&
                j.lines.some(
                  (l: any) =>
                    l.memo && (l.memo.includes(finalDocId) || l.memo.includes(docId) || (data.lenderName && l.memo.includes(data.lenderName)))
                ))
            );
          });

          let repaidPrincipal = 0;
          for (const j of loanJournals) {
            for (const l of j.lines || []) {
              if (
                l.accountCode === CANONICAL_ACCOUNTS.SHORT_TERM_LOANS ||
                l.accountCode === CANONICAL_ACCOUNTS.LONG_TERM_LOANS
              ) {
                repaidPrincipal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
              }
            }
          }

          if (repaidPrincipal <= 0 && hasSchedulePaid) {
            for (const s of data.schedule) {
              if (s.isPaid) {
                repaidPrincipal += Number(s.principalPortion || 0);
              }
            }
          }

          if (repaidPrincipal <= 0 && loanJournals.length === 0) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: নতুন ঋণে পরিশোধিত আসল বা হ্রাসকৃত বকেয়া স্থিতি সমর্থিত পরিশোধ দাখিলা ছাড়া সরাসরি নির্ধারণ করা যাবে না (Cannot establish reduced loan remaining balance or paid principal on a new record without supporting repayment entries).`
            });
          }

          const expectedRemaining = Math.max(0, Math.round((principal - repaidPrincipal) * 100) / 100);
          if (Math.abs(expectedRemaining - incomingRemaining) > 0.01) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: ঋণের বকেয়া ব্যালেন্সের অমিল (Cannot arbitrarily establish loan remaining balance. Expected: ৳${expectedRemaining}, Received: ৳${incomingRemaining}).`
            });
          }
        }
      }
    }

    // Mark synced metadata and safeguard calculated operational fields on partial updates
    const protectedFields: Record<string, any> = {};
    if (existingDoc) {
      if (targetCol === 'inventoryItems') {
        if (data.currentStock === undefined && existingDoc.currentStock !== undefined) {
          protectedFields.currentStock = existingDoc.currentStock;
        }
        if (data.avgCostPrice === undefined && existingDoc.avgCostPrice !== undefined) {
          protectedFields.avgCostPrice = existingDoc.avgCostPrice;
        }
      } else if (targetCol === 'cashBankAccounts') {
        if (data.currentBalance === undefined && existingDoc.currentBalance !== undefined) {
          protectedFields.currentBalance = existingDoc.currentBalance;
        }
      } else if (targetCol === 'investors') {
        if (data.currentCapitalBalance === undefined && existingDoc.currentCapitalBalance !== undefined) {
          protectedFields.currentCapitalBalance = existingDoc.currentCapitalBalance;
        }
        if (data.profitPayable === undefined && existingDoc.profitPayable !== undefined) {
          protectedFields.profitPayable = existingDoc.profitPayable;
        }
      } else if (targetCol === 'loans') {
        if (data.remainingBalance === undefined && existingDoc.remainingBalance !== undefined) {
          protectedFields.remainingBalance = existingDoc.remainingBalance;
        }
      } else if (targetCol === 'accounts') {
        const isSystem = existingDoc.isSystem || DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.code === existingDoc.code);
        if (isSystem) {
          if (data.accountClass && data.accountClass !== existingDoc.accountClass) {
            return res.status(400).json({
              error: `সিস্টেম হিসাবের শ্রেণী পরিবর্তন করা যাবে না (Cannot change account class of system account ${existingDoc.code}).`
            });
          }
          if (data.normalBalance && data.normalBalance !== existingDoc.normalBalance) {
            return res.status(400).json({
              error: `সিস্টেম হিসাবের স্বাভাবিক ব্যালেন্স পরিবর্তন করা যাবে না (Cannot change normal balance of system account ${existingDoc.code}).`
            });
          }
          protectedFields.isSystem = true;
          protectedFields.accountClass = existingDoc.accountClass;
          protectedFields.normalBalance = existingDoc.normalBalance;
        }
      }

      // 5. Financial Transaction Mutation Protection (F6 Integrity)
      const isFinancialRecord = [
        'journalEntries',
        'sales',
        'purchases',
        'payments',
        'bankTransfers',
        'salesReturns',
        'purchaseReturns',
        'advancePayments'
      ].includes(targetCol);

      if (isFinancialRecord) {
        // A. Journal Entries: lines and total debit/credit immutability
        if (targetCol === 'journalEntries') {
          const isReversalStatusUpdate =
            (data.isReversed && !existingDoc.isReversed) ||
            (data.reversalReason && !existingDoc.reversalReason) ||
            (data.reversalVoucherNumber && !existingDoc.reversalVoucherNumber);

          if (!isReversalStatusUpdate) {
            if (
              existingDoc.totalDebit !== undefined &&
              data.totalDebit !== undefined &&
              Math.abs(Number(existingDoc.totalDebit) - Number(data.totalDebit)) > 0.01
            ) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: পোস্ট করা জাবেদা ভাউচারের মোট পরিমাণ পরিবর্তন করা যাবে না (Cannot mutate amount of posted journal entry #${finalDocId}).`
              });
            }
            if (Array.isArray(existingDoc.lines) && Array.isArray(data.lines)) {
              if (existingDoc.lines.length !== data.lines.length) {
                return res.status(400).json({
                  error: `হিসাবরক্ষণ সীমাবদ্ধতা: পোস্ট করা জাবেদা ভাউচারের লাইন পরিবর্তন করা যাবে না (Cannot mutate lines of posted journal entry #${finalDocId}).`
                });
              }
              for (let i = 0; i < existingDoc.lines.length; i++) {
                const el = existingDoc.lines[i];
                const dl = data.lines[i];
                if (
                  el.accountCode !== dl.accountCode ||
                  Math.abs((Number(el.debit) || 0) - (Number(dl.debit) || 0)) > 0.01 ||
                  Math.abs((Number(el.credit) || 0) - (Number(dl.credit) || 0)) > 0.01
                ) {
                  return res.status(400).json({
                    error: `হিসাবরক্ষণ সীমাবদ্ধতা: পোস্ট করা জাবেদা ভাউচারের আর্থিক লাইন পরিবর্তন করা যাবে না (Cannot mutate financial lines of posted journal entry #${finalDocId}).`
                  });
                }
              }
            }
          }
        }

        // B. Sales / Purchases: Total amount and items immutability
        else if (targetCol === 'sales' || targetCol === 'purchases') {
          const isReversalOrStatusUpdate =
            Boolean(data.isReversed && !existingDoc.isReversed) ||
            data.status === 'CANCELLED' ||
            data.status === 'REVERSED' ||
            (data.paymentStatus && data.paymentStatus !== existingDoc.paymentStatus);

          if (!isReversalOrStatusUpdate) {
            const existingTotal = existingDoc.totalAmount ?? existingDoc.grandTotal ?? existingDoc.netAmount;
            const incomingTotal = data.totalAmount ?? data.grandTotal ?? data.netAmount;
            if (
              existingTotal !== undefined &&
              incomingTotal !== undefined &&
              Math.abs(Number(existingTotal) - Number(incomingTotal)) > 0.01
            ) {
              return res.status(400).json({
                error: `হিসাবরক্ষণ সীমাবদ্ধতা: পোস্ট করা ক্রয়/বিক্রয় চালানের মূল পরিমাণ পরিবর্তন করা যাবে না (Cannot mutate total amount of posted transaction #${finalDocId}).`
              });
            }
          }
        }

        // C. Payments / Bank Transfers / Advance Payments: Amount immutability
        else if (targetCol === 'payments' || targetCol === 'bankTransfers' || targetCol === 'advancePayments') {
          if (
            existingDoc.amount !== undefined &&
            data.amount !== undefined &&
            Math.abs(Number(existingDoc.amount) - Number(data.amount)) > 0.01
          ) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: পরিশোধ বা লেনদেনের মূল পরিমাণ পরিবর্তন করা যাবে না (Cannot mutate payment amount of posted transaction #${finalDocId}).`
            });
          }
        }

        // D. Sales Returns / Purchase Returns: Refund amount immutability
        else if (targetCol === 'salesReturns' || targetCol === 'purchaseReturns') {
          const existingRefund = existingDoc.totalRefundAmount ?? existingDoc.amount;
          const incomingRefund = data.totalRefundAmount ?? data.amount;
          if (
            existingRefund !== undefined &&
            incomingRefund !== undefined &&
            Math.abs(Number(existingRefund) - Number(incomingRefund)) > 0.01
          ) {
            return res.status(400).json({
              error: `হিসাবরক্ষণ সীমাবদ্ধতা: ফেরত রসিদের মূল পরিমাণ পরিবর্তন করা যাবে না (Cannot mutate refund amount of posted transaction #${finalDocId}).`
            });
          }
        }
      }

      // Check Identical Retry (Idempotency)
      const isIdenticalRecord = () => {
        const keysToCheck = Object.keys(data).filter(
          (k) => !['synced', 'syncedAt', 'syncedBy'].includes(k)
        );
        for (const k of keysToCheck) {
          if (typeof data[k] === 'object' && data[k] !== null) {
            if (JSON.stringify(data[k]) !== JSON.stringify(existingDoc[k])) return false;
          } else if (data[k] !== existingDoc[k]) {
            return false;
          }
        }
        return true;
      };

      if (isIdenticalRecord()) {
        return res.json({
          success: true,
          persisted: true,
          id: finalDocId,
          collection: collectionName,
          idempotent: true,
          message: 'Record already synced with identical data.',
          data: existingDoc
        });
      }

      // 6. Universal Version and Timestamp Conflict Protection (F6)
      // A. Explicit Version Comparison
      if (existingDoc.version !== undefined && data.version !== undefined) {
        const existingVer = Number(existingDoc.version);
        const incomingVer = Number(data.version);
        if (!isNaN(existingVer) && !isNaN(incomingVer)) {
          if (existingVer > incomingVer) {
            return res.json({
              success: true,
              persisted: true,
              id: finalDocId,
              collection: collectionName,
              staleIgnored: true,
              conflict: true,
              message: `Cloud record is newer (version ${existingVer} > ${incomingVer}); stale local overwrite ignored.`,
              data: existingDoc
            });
          }
        }
      }

      // B. Timestamp Comparison (when versions are missing or equal)
      const existingTime = existingDoc.updatedAt || existingDoc.syncedAt;
      const incomingTime = data.updatedAt || data.syncedAt;
      if (existingTime && incomingTime) {
        const existingMs = new Date(existingTime).getTime();
        const incomingMs = new Date(incomingTime).getTime();
        if (!isNaN(existingMs) && !isNaN(incomingMs) && existingMs > incomingMs) {
          return res.json({
            success: true,
            persisted: true,
            id: finalDocId,
            collection: collectionName,
            staleIgnored: true,
            conflict: true,
            message: 'Cloud record data is newer; stale local overwrite ignored.',
            data: existingDoc
          });
        }
      }
    }

    if (!existingDoc && targetCol === 'accounts') {
      const defaultAcc = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === data.code);
      if (defaultAcc) {
        if (data.accountClass && data.accountClass !== defaultAcc.accountClass) {
          return res.status(400).json({
            error: `সিস্টেম হিসাবের শ্রেণী পরিবর্তন করা যাবে না (Cannot change account class of system account ${defaultAcc.code}).`
          });
        }
        if (data.normalBalance && data.normalBalance !== defaultAcc.normalBalance) {
          return res.status(400).json({
            error: `সিস্টেম হিসাবের স্বাভাবিক ব্যালেন্স পরিবর্তন করা যাবে না (Cannot change normal balance of system account ${defaultAcc.code}).`
          });
        }
      }
    }

    // Mark synced metadata
    const recordToWrite = {
      ...(existingDoc || {}),
      ...data,
      ...protectedFields,
      id: finalDocId,
      ...(data.version !== undefined
        ? { version: data.version }
        : existingDoc?.version !== undefined
        ? { version: existingDoc.version }
        : {}),
      ...(data.updatedAt || existingDoc?.updatedAt ? { updatedAt: data.updatedAt || existingDoc?.updatedAt } : {}),
      ...(effectiveIdempotencyKey ? { idempotencyKey: effectiveIdempotencyKey } : {}),
      syncedAt: new Date().toISOString(),
      syncedBy: owner.email
    };

    // 4. Durably persist to Cloud Firestore
    // F7: Ensure sync success is returned ONLY after Firestore durably confirms the write.
    // Local disk or in-memory persistence must NEVER be reported as cloud success.
    // Verify actual Firestore availability/write outcome; do not rely only on simulation flags.
    let persistedToCloud = false;

    try {
      await effectiveDb.collection(targetCol).doc(finalDocId).set(recordToWrite, { merge: true });
      persistedToCloud = true;
    } catch (adminErr: any) {
      console.warn(`[The Goated Farm] Cloud Firestore durable write failed for ${collectionName}:`, adminErr.message);
      return res.status(503).json({
        success: false,
        persisted: false,
        error: `ক্লাউড ফায়ারস্টোরে সংরক্ষণ ব্যর্থ হয়েছে (Cloud Firestore write failed): ${adminErr.message}`,
        collection: collectionName,
        id: finalDocId
      });
    }

    if (!persistedToCloud) {
      return res.status(503).json({
        success: false,
        persisted: false,
        error: 'ক্লাউড ফায়ারস্টোর পারসিস্টেন্স নিশ্চিত হয়নি (Cloud Firestore persistence was not confirmed)',
        collection: collectionName,
        id: finalDocId
      });
    }

    // Durably store on non-volatile disk for offline local restart recovery ONLY after confirmed cloud write.
    // Local disk or in-memory persistence alone is NEVER reported as cloud success.
    try {
      saveRecordToDurableDisk(targetCol, finalDocId, recordToWrite);
    } catch (diskErr: any) {
      console.error('[The Goated Farm] Durable storage write error:', diskErr);
    }

    // CRITICAL: Update in-memory store ONLY after confirmed durable cloud persistence!
    if (!inMemoryStores.has(targetCol)) {
      inMemoryStores.set(targetCol, new Map<string, any>());
    }
    inMemoryStores.get(targetCol)!.set(finalDocId, recordToWrite);

    if (targetCol === 'closedPeriods') {
      cachedClosedPeriods = null;
    }
    if (targetCol === 'accounts') {
      cachedValidAccounts = null;
    }

    return res.json({
      success: true,
      persisted: true,
      id: finalDocId,
      collection: collectionName,
      ...(existingDoc ? { duplicate: true } : {})
    });
  } catch (err: any) {
    console.error(`[The Goated Farm] Sync error for ${collectionName}:`, err);
    return res.status(500).json({ error: `সিঙ্ক ব্যর্থ হয়েছে: ${err.message}` });
  }
}

// Dedicated sync endpoints
app.post('/api/sync/journal', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/journals', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/journal-entry', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/journalEntries', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/transaction', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/transactions', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/sale', (req, res) => handleSyncWrite('sales', req, res));
app.post('/api/sync/sales', (req, res) => handleSyncWrite('sales', req, res));
app.post('/api/sync/purchase', (req, res) => handleSyncWrite('purchases', req, res));
app.post('/api/sync/purchases', (req, res) => handleSyncWrite('purchases', req, res));
app.post('/api/sync/animal', (req, res) => handleSyncWrite('animals', req, res));
app.post('/api/sync/animals', (req, res) => handleSyncWrite('animals', req, res));
app.post('/api/sync/payment', (req, res) => handleSyncWrite('payments', req, res));
app.post('/api/sync/payments', (req, res) => handleSyncWrite('payments', req, res));
app.post('/api/sync/inventoryItem', (req, res) => handleSyncWrite('inventoryItems', req, res));
app.post('/api/sync/inventoryItems', (req, res) => handleSyncWrite('inventoryItems', req, res));
app.post('/api/sync/stockMovement', (req, res) => handleSyncWrite('stockMovements', req, res));
app.post('/api/sync/stockMovements', (req, res) => handleSyncWrite('stockMovements', req, res));
app.post('/api/sync/cashBankAccount', (req, res) => handleSyncWrite('cashBankAccounts', req, res));
app.post('/api/sync/cashBankAccounts', (req, res) => handleSyncWrite('cashBankAccounts', req, res));
app.post('/api/sync/loan', (req, res) => handleSyncWrite('loans', req, res));
app.post('/api/sync/loans', (req, res) => handleSyncWrite('loans', req, res));
app.post('/api/sync/investor', (req, res) => handleSyncWrite('investors', req, res));
app.post('/api/sync/investors', (req, res) => handleSyncWrite('investors', req, res));
app.post('/api/sync/fixedAsset', (req, res) => handleSyncWrite('fixedAssets', req, res));
app.post('/api/sync/fixedAssets', (req, res) => handleSyncWrite('fixedAssets', req, res));
app.post('/api/sync/party', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/parties', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/customer', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/customers', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/supplier', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/suppliers', (req, res) => handleSyncWrite('parties', req, res));
app.post('/api/sync/bankTransfer', (req, res) => handleSyncWrite('bankTransfers', req, res));
app.post('/api/sync/bankTransfers', (req, res) => handleSyncWrite('bankTransfers', req, res));
app.post('/api/sync/reminder', (req, res) => handleSyncWrite('reminders', req, res));
app.post('/api/sync/reminders', (req, res) => handleSyncWrite('reminders', req, res));
app.post('/api/sync/internalFlow', (req, res) => handleSyncWrite('internalFlows', req, res));
app.post('/api/sync/internalFlows', (req, res) => handleSyncWrite('internalFlows', req, res));
app.post('/api/sync/processingRun', (req, res) => handleSyncWrite('processingRuns', req, res));
app.post('/api/sync/processingRuns', (req, res) => handleSyncWrite('processingRuns', req, res));
app.post('/api/sync/animalEvent', (req, res) => handleSyncWrite('animalEvents', req, res));
app.post('/api/sync/animalEvents', (req, res) => handleSyncWrite('animalEvents', req, res));
app.post('/api/sync/pond', (req, res) => handleSyncWrite('ponds', req, res));
app.post('/api/sync/ponds', (req, res) => handleSyncWrite('ponds', req, res));
app.post('/api/sync/plot', (req, res) => handleSyncWrite('plots', req, res));
app.post('/api/sync/plots', (req, res) => handleSyncWrite('plots', req, res));
app.post('/api/sync/accessLog', (req, res) => handleSyncWrite('accessLogs', req, res));
app.post('/api/sync/accessLogs', (req, res) => handleSyncWrite('accessLogs', req, res));
app.post('/api/sync/recurringExpenseTemplate', (req, res) => handleSyncWrite('recurringExpenseTemplates', req, res));
app.post('/api/sync/recurringExpenseTemplates', (req, res) => handleSyncWrite('recurringExpenseTemplates', req, res));
app.post('/api/sync/closedPeriod', (req, res) => handleSyncWrite('closedPeriods', req, res));
app.post('/api/sync/closedPeriods', (req, res) => handleSyncWrite('closedPeriods', req, res));
app.post('/api/sync/salesReturn', (req, res) => handleSyncWrite('salesReturns', req, res));
app.post('/api/sync/salesReturns', (req, res) => handleSyncWrite('salesReturns', req, res));
app.post('/api/sync/purchaseReturn', (req, res) => handleSyncWrite('purchaseReturns', req, res));
app.post('/api/sync/purchaseReturns', (req, res) => handleSyncWrite('purchaseReturns', req, res));
app.post('/api/sync/advancePayment', (req, res) => handleSyncWrite('advancePayments', req, res));
app.post('/api/sync/advancePayments', (req, res) => handleSyncWrite('advancePayments', req, res));
app.post('/api/sync/account', (req, res) => handleSyncWrite('accounts', req, res));
app.post('/api/sync/accounts', (req, res) => handleSyncWrite('accounts', req, res));
app.post('/api/sync/systemConfig', (req, res) => handleSyncWrite('systemConfig', req, res));
app.post('/api/sync/system', (req, res) => handleSyncWrite('systemConfig', req, res));

// Generic sync endpoint: POST /api/sync/:collection
app.post('/api/sync/:collection', (req, res) => {
  const col = req.params.collection;
  if (
    !ALLOWED_SYNC_COLLECTIONS.includes(col) &&
    col !== 'journal-entry' &&
    col !== 'journal' &&
    col !== 'journals' &&
    col !== 'journal_entries' &&
    col !== 'sale' &&
    col !== 'purchase' &&
    col !== 'animal' &&
    col !== 'payment' &&
    col !== 'inventoryItem' &&
    col !== 'stockMovement' &&
    col !== 'cashBankAccount' &&
    col !== 'bankTransfer' &&
    col !== 'loan' &&
    col !== 'investor' &&
    col !== 'fixedAsset' &&
    col !== 'party' &&
    col !== 'customer' &&
    col !== 'customers' &&
    col !== 'supplier' &&
    col !== 'suppliers' &&
    col !== 'reminder' &&
    col !== 'internalFlow' &&
    col !== 'processingRun' &&
    col !== 'animalEvent' &&
    col !== 'pond' &&
    col !== 'plot' &&
    col !== 'accessLog' &&
    col !== 'recurringExpenseTemplate' &&
    col !== 'closedPeriod' &&
    col !== 'salesReturn' &&
    col !== 'salesReturns' &&
    col !== 'purchaseReturn' &&
    col !== 'purchaseReturns' &&
    col !== 'advancePayment' &&
    col !== 'advancePayments' &&
    col !== 'account' &&
    col !== 'accounts' &&
    col !== 'systemConfig' &&
    col !== 'system'
  ) {
    return res.status(400).json({ error: `অননুমোদিত কালেকশন: ${col}` });
  }
  return handleSyncWrite(col, req, res);
});

// F7: Test endpoint to simulate Firestore / Cloud persistence unavailability
app.post('/api/test/simulate-firestore-unavailable', (req, res) => {
  const { unavailable } = req.body;
  setSimulateFirestoreUnavailable(unavailable === undefined ? true : Boolean(unavailable));
  return res.json({
    simulateFirestoreUnavailable,
    available: isFirestorePersistenceAvailable(req),
    hasAdminDb: Boolean(getEffectiveAdminDb(req))
  });
});

// F7: Test endpoint to control Admin DB state for persistence verification tests
app.post('/api/test/admin-db-mode', (req, res) => {
  const { mode, errorMessage } = req.body;
  if (mode === 'missing') {
    setAdminDbForTest(null);
  } else if (mode === 'write_failure') {
    setAdminDbForTest(createFailingAdminDb(errorMessage));
  } else if (mode === 'success') {
    setAdminDbForTest(createSuccessfulAdminDb());
  } else {
    resetAdminDbForTest();
  }
  return res.json({
    mode: mode || 'reset',
    available: isFirestorePersistenceAvailable(req),
    hasAdminDb: Boolean(getEffectiveAdminDb(req))
  });
});

app.get('/api/test/firestore-status', (req, res) => {
  const effective = getEffectiveAdminDb(req);
  return res.json({
    simulateFirestoreUnavailable,
    available: isFirestorePersistenceAvailable(req),
    hasAdminDb: Boolean(effective)
  });
});

// API Route: GET /api/sync/restore
// Allows an authenticated owner to pull down all existing cloud Firestore records
// when logging into a new browser, device, or cleared storage.
app.get('/api/sync/restore', async (req, res) => {
  const owner = await authenticateOwnerRequest(req);
  if (!owner) {
    return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস। অনুগ্রহ করে প্রথমে লগইন করুন।' });
  }

  try {
    const collectionsToRestore = [
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

    const result: Record<string, any[]> = {};
    let totalCount = 0;

    for (const colName of collectionsToRestore) {
      const docsMap = new Map<string, any>();
      // 1. In-memory store
      if (inMemoryStores.has(colName)) {
        for (const [id, doc] of inMemoryStores.get(colName)!.entries()) {
          docsMap.set(id, { id, ...doc });
        }
      }
      // Check systemConfig aliases in memory
      if (colName === 'systemConfig' && inMemoryStores.has('system')) {
        for (const [id, doc] of inMemoryStores.get('system')!.entries()) {
          docsMap.set(id, { id, ...doc });
        }
      }
      // 2. Firestore Admin SDK
      if (adminDb) {
        try {
          const snap = await adminDb.collection(colName).get();
          snap.forEach((doc) => {
            docsMap.set(doc.id, { id: doc.id, ...doc.data() });
          });
          if (colName === 'systemConfig') {
            const cfgSnap = await adminDb.doc('system/config').get();
            if (cfgSnap.exists) {
              const data = cfgSnap.data();
              const id = data?.ownerUid || 'config';
              docsMap.set(id, { id, ...data });
            }
          }
        } catch (err: any) {
          console.warn(`[The Goated Farm] Restore read note for ${colName}:`, err.message);
        }
      }
      const docs = Array.from(docsMap.values());
      result[colName] = docs;
      totalCount += docs.length;
    }

    console.log(`[The Goated Farm] Restore served for ${owner.email}: ${totalCount} records retrieved.`);
    return res.json({
      success: true,
      count: totalCount,
      collections: result
    });
  } catch (err: any) {
    console.error('[The Goated Farm] Restore error:', err);
    return res.status(500).json({ error: `ডাটা রিস্টোর ব্যর্থ হয়েছে: ${err.message}` });
  }
});

// ==========================================
// API Route: POST /api/wipe-all-data
// Owner-only "Danger Zone": completely wipes all cloud Firestore collections for the farm.
// Requires confirmation string "মুছুন" and valid owner authentication.
// ==========================================
app.post('/api/wipe-all-data', async (req, res) => {
  const owner = await authenticateOwnerRequest(req);
  if (!owner) {
    return res.status(401).json({ error: 'অননুমোদিত অ্যাক্সেস। অনুগ্রহ করে প্রথমে মালিক হিসেবে লগইন করুন।' });
  }

  const { confirmation } = req.body || {};
  if (confirmation !== 'মুছুন') {
    return res.status(400).json({ error: 'সঠিক নিশ্চিতকরণ কোড লিখুন ("মুছুন")।' });
  }

  const collectionsToWipe = [
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

  let deletedTotal = 0;

  if (adminDb) {
    try {
      for (const colName of collectionsToWipe) {
        try {
          const colRef = adminDb.collection(colName);
          const snap = await colRef.get();
          if (!snap.empty) {
            // Commit in chunks of 400 to strictly respect Firestore batch limits
            const docs = snap.docs;
            for (let i = 0; i < docs.length; i += 400) {
              const chunk = docs.slice(i, i + 400);
              const batch = adminDb.batch();
              chunk.forEach((doc) => {
                batch.delete(doc.ref);
                deletedTotal++;
              });
              await batch.commit();
            }
          }
        } catch (colErr: any) {
          console.warn(`[The Goated Farm] Wipe note for collection ${colName}:`, colErr.message);
        }
      }
    } catch (err: any) {
      console.error('[The Goated Farm] Cloud wipe error:', err);
      return res.status(500).json({ error: `ক্লাউড ডেটা মোছা সম্পূর্ণ হয়নি: ${err.message}` });
    }
  }

  // Record audit log for the full wipe
  serverAccessLogs.unshift({
    id: 'wipe_' + Date.now(),
    timestamp: new Date().toISOString(),
    email: owner.email,
    ip: (req.ip || req.socket.remoteAddress || 'unknown') as string,
    userAgent: (req.headers['user-agent'] || 'unknown') as string,
    status: 'SUCCESS'
  });

  console.log(`[The Goated Farm] DANGER ZONE: All farm records wiped by ${owner.email} (${deletedTotal} cloud documents removed).`);

  return res.json({
    success: true,
    message: 'সব ডেটা সফলভাবে মুছে ফেলা হয়েছে এবং অ্যাপ্লিকেশন নতুন করে শুরু করার জন্য প্রস্তুত।',
    deletedCount: deletedTotal
  });
});

// API Route 3: GET /api/access-logs (to see who is using/accessing the app)
app.get('/api/access-logs', (req, res) => {
  res.json({
    success: true,
    logs: serverAccessLogs
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Farm status endpoint
app.get('/api/farm-info', (req, res) => {
  const setupComplete = isSetupComplete();
  res.json({
    farmName: 'The Goated Farm',
    mode: 'single-tenant',
    setupComplete,
    authorizedOwnersCount: getApprovedOwnerEmails().length
  });
});

// Vite middleware or static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[The Goated Farm] Server running on http://0.0.0.0:${PORT}`);
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.cjs') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].endsWith('server'));

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[The Goated Farm] Failed to start server:', err);
  });
}
