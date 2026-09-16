import {
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence,
  signOut,
  User
} from 'firebase/auth';
import { auth, resolveUserRole, seedSystemConfigIfNecessary } from '../firebase/firebaseClient';
import { UserProfile } from '../types';

export const APPROVED_OWNER_EMAILS = [
  'arparvez69@gmail.com',
  'arparvez4@gmail.com',
  'arparvez111@gmail.com',
  'atikurrahman00021@gmail.com'
] as const;

export interface RequestCodeResponse {
  success: boolean;
  message: string;
  error?: string;
  devCode?: string;
}

export interface VerifyCodeResponse {
  success: boolean;
  email?: string;
  uid?: string;
  customToken?: string | null;
  error?: string;
}

/**
 * Step 1: Request 6-digit verification code sent to owner email
 */
export async function requestOwnerLoginCode(email: string): Promise<RequestCodeResponse> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { success: false, message: '', error: 'ইমেইল ঠিকানা প্রদান করা আবশ্যক।' };
  }

  try {
    const res = await fetch('/api/request-login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        message: '',
        error: data.error || 'কোড পাঠানো সম্ভব হয়নি। অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন।'
      };
    }

    return {
      success: true,
      message: data.message || 'যাচাইকরণ কোড সফলভাবে পাঠানো হয়েছে।',
      devCode: data.devCode
    };
  } catch (err: any) {
    return {
      success: false,
      message: '',
      error: 'সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। ইন্টারনেট বা নেটওয়ার্ক চেক করুন।'
    };
  }
}

/**
 * Step 2: Verify 6-digit code and authenticate Firebase session
 */
export async function verifyOwnerLoginCode(
  email: string,
  code: string
): Promise<{ success: boolean; profile?: UserProfile; error?: string }> {
  const normalized = email.trim().toLowerCase();
  const cleanCode = code.trim();

  if (!normalized || !cleanCode) {
    return { success: false, error: 'ইমেইল এবং কোড উভয়ই প্রদান করুন।' };
  }

  try {
    // 1. Ensure browserLocalPersistence so session stays indefinitely ("Remember Me")
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (persistErr) {
      console.warn('Firebase persistence warning:', persistErr);
    }

    // 2. Call server endpoint to verify code and issue custom token
    const res = await fetch('/api/verify-login-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalized, code: cleanCode })
    });

    const data: VerifyCodeResponse = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'যাচাইকরণ ব্যর্থ হয়েছে। সঠিক কোড প্রদান করুন।'
      };
    }

    // 3. Sign in to Firebase Auth with Custom Token
    if (data.customToken) {
      await signInWithCustomToken(auth, data.customToken);
    } else {
      // If service account key is not yet configured in local container environment,
      // store authenticated verified owner session state in local storage
      const verifiedSession = {
        uid: data.uid || `goted_owner_${normalized.replace(/[^a-zA-Z0-9]/g, '_')}`,
        email: normalized,
        displayName: normalized.split('@')[0],
        role: 'OWNER',
        authenticatedAt: new Date().toISOString()
      };
      localStorage.setItem('goted_owner_session', JSON.stringify(verifiedSession));
    }

    // 4. Silently ensure single-tenant "The Goted Farm" system/config document is seeded
    await seedSystemConfigIfNecessary();

    // 5. Resolve user profile as full Owner
    const profile = await resolveUserRole(auth.currentUser);
    return { success: true, profile };
  } catch (err: any) {
    console.error('Verify login error:', err);
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
