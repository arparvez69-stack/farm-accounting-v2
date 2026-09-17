import {
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence,
  signOut
} from 'firebase/auth';
import { auth, resolveUserRole, seedSystemConfigIfNecessary } from '../firebase/firebaseClient';
import { UserProfile, AppAccessLog } from '../types';
import { db } from '../db/indexedDb';

/**
 * Retrieve authorized owner emails received from authenticated server API response
 */
export function getStoredAuthorizedEmails(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('goted_owner_session') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.authorizedEmails)) {
        return parsed.authorizedEmails;
      }
    }
  } catch {}
  return [];
}

export interface VerifyPinResponse {
  success: boolean;
  profile?: UserProfile;
  error?: string;
}

/**
 * Log access event both locally in IndexedDB and to server / Firestore
 */
export async function recordAccessLog(
  email: string,
  status: 'SUCCESS' | 'FAILED',
  method: 'SECRET_PIN' | 'SESSION_RESTORE'
): Promise<void> {
  const logEntry: AppAccessLog = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    email: email.trim().toLowerCase(),
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
    loginMethod: method,
    status: status,
    synced: false
  };

  try {
    // Save to local IndexedDB
    await db.accessLogs.put(logEntry);
  } catch (err) {
    console.warn('Failed to save access log locally:', err);
  }
}

/**
 * Fetch all access history logs from local database and server
 */
export async function getAppAccessLogs(): Promise<AppAccessLog[]> {
  try {
    // 1. Fetch from local Dexie database
    const localLogs = await db.accessLogs.orderBy('timestamp').reverse().toArray();

    // 2. Also try fetching server-side logs
    try {
      const res = await fetch('/api/access-logs');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.logs)) {
          const serverLogs: AppAccessLog[] = data.logs.map((l: any) => ({
            id: l.id,
            email: l.email,
            timestamp: l.timestamp,
            userAgent: l.userAgent,
            loginMethod: 'SECRET_PIN',
            status: l.status,
            synced: true
          }));

          // Merge unique by timestamp+email
          const seen = new Set<string>();
          const combined: AppAccessLog[] = [];
          for (const item of [...localLogs, ...serverLogs]) {
            const key = `${item.email}_${item.timestamp}_${item.status}`;
            if (!seen.has(key)) {
              seen.add(key);
              combined.push(item);
            }
          }
          return combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        }
      }
    } catch {
      // Server offline or unavailable, return local logs
    }

    return localLogs;
  } catch (err) {
    console.warn('Could not fetch access logs:', err);
    return [];
  }
}

/**
 * Verify Email & Secret PIN via Server
 * Login must ALWAYS go through POST /api/verify-login-code on server.ts.
 * If that request fails or is offline, shows "Cannot verify login while offline" — no client-side check.
 */
export async function verifyOwnerSecretPin(
  email: string,
  pin: string
): Promise<VerifyPinResponse> {
  const normalized = email.trim().toLowerCase();
  const cleanPin = pin.trim();

  if (!normalized || !cleanPin) {
    return { success: false, error: 'ইমেইল এবং গোপন পিন উভয়ই আবশ্যক।' };
  }

  // If client is offline, do not attempt fallback — reject immediately
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, error: 'Cannot verify login while offline' };
  }

  let customToken: string | null = null;
  let serverSessionToken: string | null = null;
  let uid = `goted_owner_${normalized.replace(/[^a-zA-Z0-9]/g, '_')}`;
  let serverAuthorizedEmails: string[] = [];

  try {
    // 1. Mandatory server verification (BCrypt verified on server against Firestore)
    const res = await fetch('/api/verify-login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized, code: cleanPin })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await recordAccessLog(normalized, 'FAILED', 'SECRET_PIN');
      return {
        success: false,
        error: data.error || 'অবৈধ ইমেইল অথবা গোপন পিন (Invalid email or secret PIN)!'
      };
    }

    if (data.customToken) customToken = data.customToken;
    if (data.sessionToken) serverSessionToken = data.sessionToken;
    if (data.uid) uid = data.uid;
    if (Array.isArray(data.authorizedEmails)) serverAuthorizedEmails = data.authorizedEmails;
  } catch (networkErr) {
    // If request fails or server is offline, show "Cannot verify login while offline" — NEVER fall back to a client-side check
    console.warn('Authentication server network error:', networkErr);
    return {
      success: false,
      error: 'Cannot verify login while offline'
    };
  }

  try {
    // 2. Ensure browserLocalPersistence so session stays indefinitely
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (persistErr) {
      console.warn('Firebase persistence warning:', persistErr);
    }

    // 3. Record successful access log
    await recordAccessLog(normalized, 'SUCCESS', 'SECRET_PIN');

    // 4. Store authenticated owner session state in localStorage for persistent access
    const verifiedSession = {
      uid: uid,
      email: normalized,
      displayName: normalized.split('@')[0],
      role: 'OWNER',
      sessionToken: serverSessionToken,
      authorizedEmails: serverAuthorizedEmails,
      authenticatedAt: new Date().toISOString()
    };
    localStorage.setItem('goted_owner_session', JSON.stringify(verifiedSession));

    // 5. Sign in to Firebase Auth with Custom Token if available
    if (customToken) {
      try {
        await signInWithCustomToken(auth, customToken);
      } catch (tokenErr) {
        console.warn('Custom token sign-in notice:', tokenErr);
      }
    }

    // 6. Silently ensure single-tenant system/config is seeded
    await seedSystemConfigIfNecessary(serverAuthorizedEmails);

    // 7. Resolve user profile
    const profile = await resolveUserRole(auth.currentUser);
    return { success: true, profile };
  } catch (err: any) {
    console.error('Session establishment error:', err);
    return {
      success: false,
      error: err.message || 'লগইন সম্পন্ন করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
    };
  }
}

/**
 * Log out owner completely and clear session
 */
export async function logoutOwner(): Promise<void> {
  localStorage.removeItem('goted_owner_session');
  localStorage.removeItem('local_auth_user');
  localStorage.removeItem('local_owner_credentials');
  try {
    await signOut(auth);
  } catch (e) {
    console.warn('SignOut warning:', e);
  }
}
