import express from 'express';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json';

const app = express();
const PORT = 3000;

app.use(express.json());

// Single-tenant fixed owner allow-list for "The Goted Farm"
export const APPROVED_OWNER_EMAILS: string[] = [
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'arparvez111@gmail.com',
  'atikurrahman00021@gmail.com'
];

// Master Secret PIN for The Goted Farm
const MASTER_SECRET_PIN = process.env.MASTER_SECRET_PIN || '111069';

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
  console.warn('[The Goted Farm] Firebase Admin initialization note:', err.message);
}

// In-memory OTP and Rate-limiting Stores
interface OtpRecord {
  hash: string;
  expiresAt: number;
  attempts: number;
  lockedUntil: number;
  lastRequestedAt: number;
  hourlyRequests: number;
  hourlyWindowStart: number;
}

const otpStore = new Map<string, OtpRecord>();

// Helper to send email via available services
async function sendOtpEmail(recipient: string, code: string): Promise<boolean> {
  // Always log code to server console for testing/audit
  console.log(`\n==================================================`);
  console.log(`[The Goted Farm OTP] 🔐 VERIFICATION CODE for ${recipient}: ${code}`);
  console.log(`==================================================\n`);

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #059669; font-size: 24px; font-weight: bold; margin: 0;">The Goted Farm</h1>
        <p style="color: #64748b; font-size: 13px; margin-top: 4px;">সমন্বিত কৃষি খামার ইআরপি — নিরাপত্তা যাচাইকরণ</p>
      </div>
      <p style="font-size: 15px; line-height: 1.6; color: #334155;">
        সম্মানিত খামার মালিক,<br>
        আপনার একাউন্টে সুরক্ষিতভাবে প্রবেশের জন্য নিচের <strong>৬ ডিজিটের ওটিপি (OTP)</strong> কোডটি ব্যবহার করুন:
      </p>
      <div style="background-color: #f0fdf4; border: 2px dashed #10b981; border-radius: 10px; padding: 18px; text-align: center; margin: 24px 0;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #065f46; font-family: monospace;">${code}</span>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        ⚠️ এই কোডটি আগামী <strong>১০ মিনিট</strong> সক্রিয় থাকবে। নিরাপত্তা নিশ্চিত রাখতে এই কোডটি অন্য কারো সাথে শেয়ার করবেন না।
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
        The Goted Farm ERP • ঢাকা, বাংলাদেশ • নিরাপদ মালিকানা প্রমাণীকরণ
      </p>
    </div>
  `;

  // 1. Try Resend if configured
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'The Goted Farm <onboarding@resend.dev>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [recipient],
          subject: `The Goted Farm - লগইন যাচাইকরণ কোড: ${code}`,
          html: htmlContent
        })
      });
      if (res.ok) {
        console.log(`[The Goted Farm] OTP email delivered via Resend to ${recipient}`);
        return true;
      }
      console.warn('[The Goted Farm] Resend delivery response:', await res.text());
    } catch (e) {
      console.warn('[The Goted Farm] Resend error:', e);
    }
  }

  // 2. Try SendGrid if configured
  if (process.env.SENDGRID_API_KEY) {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'noreply@thegotedfarm.com';
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: fromEmail, name: 'The Goted Farm' },
          subject: `The Goted Farm - লগইন যাচাইকরণ কোড: ${code}`,
          content: [{ type: 'text/html', value: htmlContent }]
        })
      });
      if (res.ok || res.status === 202) {
        console.log(`[The Goted Farm] OTP email delivered via SendGrid to ${recipient}`);
        return true;
      }
    } catch (e) {
      console.warn('[The Goted Farm] SendGrid error:', e);
    }
  }

  // 3. Try SMTP / Nodemailer if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `"The Goted Farm" <${process.env.SMTP_USER}>`,
        to: recipient,
        subject: `The Goted Farm - লগইন যাচাইকরণ কোড: ${code}`,
        html: htmlContent
      });
      console.log(`[The Goted Farm] OTP email delivered via SMTP to ${recipient}`);
      return true;
    } catch (e) {
      console.warn('[The Goted Farm] SMTP error:', e);
    }
  }

  return false;
}

// ==========================================
// API Route 1: POST /api/request-login-code
// ==========================================
app.post('/api/request-login-code', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'ইমেইল প্রদান করা আবশ্যক।' });
    }

    const email = rawEmail.trim().toLowerCase();
    const now = Date.now();

    // Check if email is on the fixed owner allow-list
    const isAllowed = APPROVED_OWNER_EMAILS.includes(email);

    // Rate Limiting Check: Max 1 request per 30s, max 5 per hour
    let record = otpStore.get(email);
    if (!record) {
      record = {
        hash: '',
        expiresAt: 0,
        attempts: 0,
        lockedUntil: 0,
        lastRequestedAt: 0,
        hourlyRequests: 0,
        hourlyWindowStart: now
      };
      otpStore.set(email, record);
    }

    // Reset hourly window if > 1 hour passed
    if (now - record.hourlyWindowStart > 60 * 60 * 1000) {
      record.hourlyRequests = 0;
      record.hourlyWindowStart = now;
    }

    // Minimum 30 seconds interval between requests
    if (record.lastRequestedAt && now - record.lastRequestedAt < 30 * 1000) {
      const waitSec = Math.ceil((30 * 1000 - (now - record.lastRequestedAt)) / 1000);
      return res.status(429).json({
        error: `অনুরোধের সীমা অতিক্রম হয়েছে। অনুগ্রহ করে আরও ${waitSec} সেকেন্ড অপেক্ষা করুন।`
      });
    }

    // Hourly limit: max 5 requests per hour
    if (record.hourlyRequests >= 5) {
      return res.status(429).json({
        error: 'প্রতি ঘণ্টায় সর্বোচ্চ ৫ বার কোড অনুরোধ করা যাবে। পরে আবার চেষ্টা করুন।'
      });
    }

    // If NOT on the allow-list: return generic success message to prevent enumeration
    if (!isAllowed) {
      // Record rate limit attempt
      record.lastRequestedAt = now;
      record.hourlyRequests++;
      return res.json({
        success: true,
        message: 'যদি এই ইমেইলটি "The Goted Farm"-এর অনুমোদিত মালিক তালিকায় থাকে, তবে একটি ৬ ডিজিটের যাচাইকরণ কোড পাঠানো হবে।'
      });
    }

    // Generate random 6-digit numeric verification code
    const code = String(crypto.randomInt(100000, 999999));
    const hash = crypto.createHash('sha256').update(code).digest('hex');

    record.hash = hash;
    record.expiresAt = now + 10 * 60 * 1000; // 10 minutes expiry
    record.attempts = 0;
    record.lockedUntil = 0;
    record.lastRequestedAt = now;
    record.hourlyRequests++;

    // Send email
    const emailSent = await sendOtpEmail(email, code);

    return res.json({
      success: true,
      message: 'যাচাইকরণ কোড সফলভাবে পাঠানো হয়েছে। অনুগ্রহ করে আপনার ইমেইল চেক করুন।'
    });
  } catch (err: any) {
    console.error('[The Goted Farm] request-login-code error:', err);
    return res.status(500).json({ error: 'সার্ভার সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।' });
  }
});

// ==========================================
// API Route 2: POST /api/verify-login-code
// Supports Secret PIN (111069) directly or OTP
// ==========================================
app.post('/api/verify-login-code', async (req, res) => {
  try {
    const rawEmail = req.body?.email;
    const rawCode = req.body?.code;

    if (!rawEmail || !rawCode || typeof rawEmail !== 'string' || typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'ইমেইল এবং গোপন পিন/কোড উভয়ই আবশ্যক।' });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim();
    const now = Date.now();
    const ip = req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // 1. Verify Secret Master PIN (Default: 111069)
    let isMasterPinValid = code === MASTER_SECRET_PIN;

    // 2. Also check dynamic OTP if applicable
    let isOtpValid = false;
    const record = otpStore.get(email);
    if (record && record.hash && record.expiresAt >= now && record.lockedUntil <= now) {
      const inputHash = crypto.createHash('sha256').update(code).digest('hex');
      isOtpValid = crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(record.hash));
    }

    const isValid = isMasterPinValid || isOtpValid;

    // Record access attempt in server memory log
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
      console.warn(`[The Goted Farm] ❌ Failed login attempt for email: ${email} with invalid PIN.`);
      return res.status(400).json({
        error: 'ভুল গোপন পিন (Incorrect Secret PIN)। সঠিক পিন না দিলে অ্যাপে প্রবেশ করা যাবে না।'
      });
    }

    // Success: Clear any pending OTP record
    if (record) {
      otpStore.delete(email);
    }

    console.log(`[The Goted Farm]  Successful login for: ${email} via Secret PIN/Code`);

    // Deterministic UID for this user email
    const uid = 'goted_user_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 20);

    // Attempt Firebase custom token creation
    let customToken: string | null = null;
    try {
      if (adminInitialized) {
        customToken = await getAuth().createCustomToken(uid, {
          role: 'OWNER',
          email: email
        });
        console.log(`[The Goted Farm] Custom token issued for user: ${email}`);
      }
    } catch (tokenErr: any) {
      console.warn('[The Goted Farm] Admin customToken note:', tokenErr.message);
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
    console.error('[The Goted Farm] verify-login-code error:', err);
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
    farmName: 'The Goted Farm',
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
    console.log(`[The Goted Farm] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
