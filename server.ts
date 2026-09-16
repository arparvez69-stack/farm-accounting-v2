import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json';

const app = express();
const PORT = 3000;

app.use(express.json());

// Single-tenant fixed owner allow-list for "The Goated Farm"
export const APPROVED_OWNER_EMAILS: string[] = [
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'arparvez111@gmail.com',
  'atikurrahman00021@gmail.com'
];

// Master Secret PIN for The Goated Farm
const MASTER_SECRET_PIN = process.env.MASTER_SECRET_PIN || '111069';

// Owner PIN configuration - supports dedicated PIN per email or falls back to Master Secret PIN
export const OWNER_PINS: Record<string, string> = {
  'arparvez69@gmail.com': process.env.PIN_ARPARVEZ69 || MASTER_SECRET_PIN,
  'arparvez4@gmail.com': process.env.PIN_ARPARVEZ4 || MASTER_SECRET_PIN,
  'arparvez111@gmail.com': process.env.PIN_ARPARVEZ111 || MASTER_SECRET_PIN,
  'atikurrahman00021@gmail.com': process.env.PIN_ATIKURRAHMAN || MASTER_SECRET_PIN
};

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

// ==========================================
// API Route: POST /api/verify-login-code
// Validates email against APPROVED_OWNER_EMAILS and verifies Secret PIN
// ==========================================
app.post('/api/verify-login-code', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const rawCode = req.body?.code;

    if (!rawEmail || !rawCode || typeof rawEmail !== 'string' || typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'ইমেইল এবং গোপন পিন উভয়ই আবশ্যক।' });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();
    const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // 1. Verify email is in the approved owner allow-list
    const isEmailApproved = APPROVED_OWNER_EMAILS.includes(email);

    // 2. Verify Secret PIN matches owner PIN or Master PIN
    const expectedPin = OWNER_PINS[email] || MASTER_SECRET_PIN;
    const isPinValid = Boolean(expectedPin) && (code === expectedPin || code === MASTER_SECRET_PIN);

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
      console.warn(`[The Goated Farm] ❌ Failed login attempt for email: ${email}`);
      return res.status(401).json({
        error: 'অবৈধ ইমেইল অথবা গোপন পিন (Invalid email or secret PIN)।'
      });
    }

    console.log(`[The Goated Farm] ✅ Successful login for: ${email}`);

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
      tokenFallbackRequired: !customToken
    });
  } catch (err: any) {
    console.error('[The Goated Farm] verify-login-code error:', err);
    return res.status(500).json({ error: 'যাচাইকরণে সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।' });
  }
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
  res.json({
    farmName: 'The Goated Farm',
    mode: 'single-tenant',
    authorizedOwnersCount: APPROVED_OWNER_EMAILS.length
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
