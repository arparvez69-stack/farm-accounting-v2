import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();

// Fixed allow-list for "The Goted Farm"
const APPROVED_OWNER_EMAILS = [
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'arparvez111@gmail.com',
  'atikurrahman00021@gmail.com'
];

/**
 * Cloud Function 1: requestLoginCode
 */
export const requestLoginCode = functions.https.onCall(async (data, context) => {
  const rawEmail = data?.email;
  if (!rawEmail || typeof rawEmail !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required.');
  }

  const email = rawEmail.trim().toLowerCase();
  const isAllowed = APPROVED_OWNER_EMAILS.includes(email);

  // Rate limiting check via Firestore loginCodes document
  const codeRef = firestore.collection('loginCodes').doc(email);
  const now = Date.now();
  const doc = await codeRef.get();
  const existing = doc.data();

  if (existing?.lastRequestedAt && now - existing.lastRequestedAt < 30 * 1000) {
    const waitSec = Math.ceil((30 * 1000 - (now - existing.lastRequestedAt)) / 1000);
    throw new functions.https.HttpsError('resource-exhausted', `Please wait ${waitSec}s before requesting again.`);
  }

  // Prevent email enumeration: return generic success if not allowed
  if (!isAllowed) {
    return {
      success: true,
      message: 'If this email is an authorized owner of The Goted Farm, a 6-digit code has been sent.'
    };
  }

  // Generate 6-digit OTP code
  const code = String(crypto.randomInt(100000, 999999));
  const hash = crypto.createHash('sha256').update(code).digest('hex');

  await codeRef.set({
    hash,
    expiresAt: now + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
    lockedUntil: 0,
    lastRequestedAt: now,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Log code in Cloud Function logs
  console.log(`[The Goted Farm] 🔐 Verification OTP for ${email}: ${code}`);

  // If using Firebase Trigger Email extension, queue into 'mail' collection
  try {
    await firestore.collection('mail').add({
      to: email,
      message: {
        subject: `The Goted Farm - লগইন যাচাইকরণ কোড: ${code}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px;">
            <h2 style="color: #059669;">The Goted Farm</h2>
            <p>আপনার ৬ ডিজিটের যাচাইকরণ কোড:</p>
            <h1 style="color: #065f46; letter-spacing: 6px;">${code}</h1>
            <p style="color: #64748b; font-size: 13px;">কোডটি আগামী ১০ মিনিটের জন্য কার্যকর থাকবে।</p>
          </div>
        `
      }
    });
  } catch (mailErr) {
    console.warn('Mail queue notice:', mailErr);
  }

  return {
    success: true,
    message: 'Verification code sent.'
  };
});

/**
 * Cloud Function 2: verifyLoginCode
 */
export const verifyLoginCode = functions.https.onCall(async (data, context) => {
  const rawEmail = data?.email;
  const rawCode = data?.code;

  if (!rawEmail || !rawCode) {
    throw new functions.https.HttpsError('invalid-argument', 'Email and code are required.');
  }

  const email = String(rawEmail).trim().toLowerCase();
  const code = String(rawCode).trim();
  const now = Date.now();

  if (!APPROVED_OWNER_EMAILS.includes(email)) {
    throw new functions.https.HttpsError('permission-denied', 'Unauthorized email address.');
  }

  const codeRef = firestore.collection('loginCodes').doc(email);
  const snap = await codeRef.get();

  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'No active verification code found.');
  }

  const record = snap.data()!;
  if (record.lockedUntil && record.lockedUntil > now) {
    throw new functions.https.HttpsError('resource-exhausted', 'Account locked due to failed attempts. Try later.');
  }

  if (record.expiresAt < now) {
    await codeRef.delete();
    throw new functions.https.HttpsError('deadline-exceeded', 'Verification code expired.');
  }

  const inputHash = crypto.createHash('sha256').update(code).digest('hex');
  if (inputHash !== record.hash) {
    const attempts = (record.attempts || 0) + 1;
    const lockedUntil = attempts >= 5 ? now + 15 * 60 * 1000 : 0;
    await codeRef.update({ attempts, lockedUntil });
    throw new functions.https.HttpsError('invalid-argument', `Invalid verification code. Remaining attempts: ${5 - attempts}`);
  }

  // Code verified! Delete code record
  await codeRef.delete();

  // Create deterministic UID and custom token
  const uid = 'goted_owner_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 20);

  // Ensure user exists in Firebase Auth
  try {
    await admin.auth().getUser(uid);
  } catch {
    await admin.auth().createUser({
      uid,
      email,
      emailVerified: true,
      displayName: email.split('@')[0]
    });
  }

  const customToken = await admin.auth().createCustomToken(uid, {
    role: 'OWNER',
    email: email
  });

  return {
    success: true,
    customToken,
    uid,
    email
  };
});
