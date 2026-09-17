import express from 'express';
import path from 'path';
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

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper to read owner email secrets from environment variables (supports standard or lowercase aliases)
export function getRawEmailsEnv(): string | undefined {
  return (
    process.env.APPROVED_OWNER_EMAILS?.trim() ||
    process.env.OWNER_EMAILS?.trim() ||
    process.env.EMAIL?.trim() ||
    process.env.email?.trim()
  );
}

// Helper to read initial PIN secrets from environment variables (supports standard or lowercase aliases)
export function getRawPinEnv(): string | undefined {
  return (
    process.env.INITIAL_PIN?.trim() ||
    process.env.MASTER_PIN?.trim() ||
    process.env.INITIAL_MASTER_PIN?.trim() ||
    process.env.masterpin?.trim() ||
    process.env.MASTERPIN?.trim() ||
    process.env.PIN?.trim() ||
    process.env.pin?.trim()
  );
}

// Single-tenant owner allow-list parsed from environment variable APPROVED_OWNER_EMAILS (or aliases)
export function getApprovedOwnerEmails(): string[] {
  const envEmails = getRawEmailsEnv();
  const list = new Set<string>();

  if (envEmails) {
    envEmails
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .forEach((e) => list.add(e));
  }

  // Always authorize primary owner account
  list.add('brandingdeshi@gmail.com');

  return Array.from(list);
}

// Checks if required authentication secrets are configured
export function isSetupComplete(): boolean {
  const hasEmails = Boolean(getRawEmailsEnv());
  const hasPin = Boolean(getRawPinEnv());
  return hasEmails && hasPin;
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

// Session tokens for persistent owner access
const SESSION_SECRET = process.env.SESSION_SECRET || 'the-goated-farm-session-secret-salt-2025';

function createSessionToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string): { email: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
    if (signature !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    const approvedEmails = getApprovedOwnerEmails();
    if (payload.email && (approvedEmails.length === 0 || approvedEmails.includes(payload.email.toLowerCase()))) {
      return { email: payload.email.toLowerCase() };
    }
  } catch {
    return null;
  }
  return null;
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

  const approvedEmails = getApprovedOwnerEmails();

  // 1. Verify standard Firebase ID Token using Firebase Admin SDK
  if (adminInitialized) {
    try {
      const decoded = await getAuth().verifyIdToken(token);
      if (decoded && decoded.email && (approvedEmails.length === 0 || approvedEmails.includes(decoded.email.toLowerCase()))) {
        return { email: decoded.email.toLowerCase(), uid: decoded.uid };
      }
    } catch {
      // In offline/container dev environment or when custom session token is used
    }
  }

  // 2. Also verify owner session token
  const session = verifySessionToken(token);
  if (session && (approvedEmails.length === 0 || approvedEmails.includes(session.email.toLowerCase()))) {
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
// ==========================================
async function syncAuthorizedEmails(): Promise<void> {
  const emails = getApprovedOwnerEmails();
  if (!adminDb || emails.length === 0) return;

  try {
    const docRef = adminDb.doc('system/authorizedEmails');
    const snap = await docRef.get();
    let mergedEmails = emails;
    if (snap.exists) {
      const data = snap.data();
      if (Array.isArray(data?.emails)) {
        mergedEmails = Array.from(new Set([...data.emails, ...emails]));
      }
    }
    await docRef.set({
      emails: mergedEmails,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`[The Goated Farm] Synced system/authorizedEmails in Firestore via Admin SDK (${mergedEmails.length} owners)`);
  } catch (err: any) {
    console.warn('[The Goated Farm] Note on syncing system/authorizedEmails in Firestore:', err.message);
  }
}

async function ensureEmailAuthorized(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  if (!adminDb) return;
  try {
    const docRef = adminDb.doc('system/authorizedEmails');
    const snap = await docRef.get();
    let emails = [normalized];
    if (snap.exists) {
      const data = snap.data();
      if (Array.isArray(data?.emails)) {
        emails = Array.from(new Set([...data.emails, normalized]));
      }
    }
    await docRef.set({
      emails: emails,
      updatedAt: new Date().toISOString()
    }, { merge: true });
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
    const approvedEmails = getApprovedOwnerEmails();
    if (approvedEmails.includes(email)) {
      const initialPin = getRawPinEnv()!.trim();
      const defaultHash = await bcrypt.hash(initialPin, 12);
      cachedAuthSecrets[email] = defaultHash;
      return defaultHash;
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

    if (rateLimit?.lockedUntil) {
      if (now < rateLimit.lockedUntil) {
        const remainingMinutes = Math.max(1, Math.ceil((rateLimit.lockedUntil - now) / 60000));
        return res.status(429).json({
          error: `অতিরিক্ত ব্যর্থ চেষ্টার কারণে এই অ্যাকাউন্টটি ১৫ মিনিটের জন্য সাময়িকভাবে লক করা হয়েছে। আরও ${remainingMinutes} মিনিট পর পুনরায় চেষ্টা করুন (Too many failed login attempts. Account locked for ${remainingMinutes} more minutes).`
        });
      } else {
        // Lockout period expired, clear lockout
        failedLoginAttempts.delete(email);
      }
    }

    // 2. Verify email is in the approved owner allow-list
    const approvedEmails = getApprovedOwnerEmails();
    const isEmailApproved = approvedEmails.includes(email);

    // 3. Verify Secret PIN using bcrypt against stored hash
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
    const updatedApproved = Array.from(new Set([...approvedEmails, email]));

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
    const approvedEmails = getApprovedOwnerEmails();
    if (approvedEmails.length > 0 && !approvedEmails.includes(email)) {
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
    const approvedEmails = getApprovedOwnerEmails();
    if (approvedEmails.length > 0 && !approvedEmails.includes(email)) {
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

    const approvedEmails = getApprovedOwnerEmails();
    if (approvedEmails.length > 0 && !approvedEmails.includes(email)) {
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
  'loans',
  'investors',
  'investorTransactions',
  'fixedAssets',
  'internalFlows',
  'processingRuns',
  'auditLogs',
  'system'
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

    const docId = data.id || (collectionName === 'system' ? 'config' : null);
    if (!docId) {
      return res.status(400).json({ error: 'নথি আইডি (Document ID) অনুপস্থিত।' });
    }

    // 2. Re-run balance and account validation for financial records
    if (collectionName === 'journalEntries' || collectionName === 'journal-entry') {
      if (!data.lines || !Array.isArray(data.lines) || data.lines.length < 2) {
        return res.status(400).json({
          error: 'জাবেদা ভাউচারে কমপক্ষে ২টি ভারসাম্যপূর্ণ লাইন থাকতে হবে (Journal entry must have at least 2 balanced lines).'
        });
      }

      try {
        const check = validateBalancedLines(data.lines);
        if (!check.isBalanced) {
          return res.status(400).json({
            error: `জাবেদা ভারসাম্যহীন! ডেবিট: ৳${check.totalDebit}, ক্রেডিট: ৳${check.totalCredit}`
          });
        }
        if (check.totalDebit <= 0) {
          return res.status(400).json({ error: 'ভাউচারের পরিমাণ শূন্য হতে পারে না।' });
        }
        data.totalDebit = check.totalDebit;
        data.totalCredit = check.totalCredit;
      } catch (valErr: any) {
        return res.status(400).json({
          error: `হিসাবরক্ষণ ভ্যালিডেশন ত্রুটি: ${valErr.message}`
        });
      }
    } else if (collectionName === 'sales' || collectionName === 'sale') {
      if (data.lines && Array.isArray(data.lines)) {
        try {
          validateBalancedLines(data.lines);
        } catch (valErr: any) {
          return res.status(400).json({ error: `বিক্রয় জাবেদা ত্রুটি: ${valErr.message}` });
        }
      }
    } else if (collectionName === 'purchases' || collectionName === 'purchase') {
      if (data.lines && Array.isArray(data.lines)) {
        try {
          validateBalancedLines(data.lines);
        } catch (valErr: any) {
          return res.status(400).json({ error: `ক্রয় জাবেদা ত্রুটি: ${valErr.message}` });
        }
      }
    }

    // Mark synced metadata
    const recordToWrite = {
      ...data,
      syncedAt: new Date().toISOString(),
      syncedBy: owner.email
    };

    // 3. Write via firebase-admin (which bypasses rules safely since it is trusted)
    if (adminDb) {
      const targetCol = collectionName === 'journal-entry' ? 'journalEntries'
        : collectionName === 'sale' ? 'sales'
        : collectionName === 'purchase' ? 'purchases'
        : collectionName === 'animal' ? 'animals'
        : collectionName;

      try {
        await adminDb.collection(targetCol).doc(docId).set(recordToWrite, { merge: true });
      } catch (adminErr: any) {
        console.warn(`[The Goated Farm] Admin Firestore write notice for ${collectionName}:`, adminErr.message);
        if (hasServiceAccountKey) {
          throw adminErr;
        }
      }
    } else {
      console.warn('[The Goated Farm] Admin Firestore not initialized, sync processed in memory');
    }

    return res.json({
      success: true,
      id: docId,
      collection: collectionName
    });
  } catch (err: any) {
    console.error(`[The Goated Farm] Sync error for ${collectionName}:`, err);
    return res.status(500).json({ error: `সিঙ্ক ব্যর্থ হয়েছে: ${err.message}` });
  }
}

// Dedicated sync endpoints
app.post('/api/sync/journal-entry', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/journalEntries', (req, res) => handleSyncWrite('journalEntries', req, res));
app.post('/api/sync/sale', (req, res) => handleSyncWrite('sales', req, res));
app.post('/api/sync/sales', (req, res) => handleSyncWrite('sales', req, res));
app.post('/api/sync/purchase', (req, res) => handleSyncWrite('purchases', req, res));
app.post('/api/sync/purchases', (req, res) => handleSyncWrite('purchases', req, res));
app.post('/api/sync/animal', (req, res) => handleSyncWrite('animals', req, res));
app.post('/api/sync/animals', (req, res) => handleSyncWrite('animals', req, res));

// Generic sync endpoint: POST /api/sync/:collection
app.post('/api/sync/:collection', (req, res) => {
  const col = req.params.collection;
  if (!ALLOWED_SYNC_COLLECTIONS.includes(col) && col !== 'journal-entry' && col !== 'sale' && col !== 'purchase' && col !== 'animal') {
    return res.status(400).json({ error: `অননুমোদিত কালেকশন: ${col}` });
  }
  return handleSyncWrite(col, req, res);
});

// API Route 3: GET /api/access-logs (to see who is using/accessing the app)
app.get('/api/access-logs', (req, res) => {
  res.json({
    success: true,
    logs: serverAccessLogs
  });
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

startServer();
