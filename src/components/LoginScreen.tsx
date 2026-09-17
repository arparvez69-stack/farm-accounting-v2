import React, { useState } from 'react';
import {
  Sprout,
  Mail,
  KeyRound,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
  ArrowLeft
} from 'lucide-react';
import { verifyOwnerSecretPin } from '../services/authService';
import { triggerForegroundDueTodayNotification } from '../db/indexedDb';
import { UserProfile } from '../types';
import { SyncStatusBadge } from './SyncStatusBadge';

interface Props {
  onLoginSuccess: (profile: UserProfile) => void;
}

export const LoginScreen: React.FC<Props> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('goted_last_email') || 'arparvez111@gmail.com';
    } catch {
      return 'arparvez111@gmail.com';
    }
  });
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check setup status on load: if secrets are missing, show setup incomplete banner instead of login form
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(true);

  React.useEffect(() => {
    let isMounted = true;
    const checkSetupStatus = async () => {
      try {
        const res = await fetch('/api/farm-info');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setSetupComplete(data.setupComplete !== false);
          }
        } else {
          if (isMounted) setSetupComplete(true);
        }
      } catch {
        if (isMounted) setSetupComplete(true);
      } finally {
        if (isMounted) setCheckingSetup(false);
      }
    };
    checkSetupStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  // TASK 8: Forgot PIN state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newResetPin, setNewResetPin] = useState('');
  const [confirmResetPin, setConfirmResetPin] = useState('');
  const [showNewResetPin, setShowNewResetPin] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);

  // TASK 8: Step 1 - Request code
  const handleRequestResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setForgotError('অনুগ্রহ করে অনুমোদিত ইমেইল দিন।');
      return;
    }

    setForgotLoading(true);
    setForgotError(null);
    setForgotSuccess(null);

    try {
      const res = await fetch('/api/request-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setForgotSuccess(data.message || 'রিসেট কোড পাঠানো হয়েছে। ইমেইল ইনবক্স চেক করুন।');
        setForgotStep(2);
      } else {
        setForgotError(data.error || 'রিসেট কোড পাঠানো সম্ভব হয়নি।');
      }
    } catch (err: any) {
      setForgotError(err.message || 'সার্ভার যোগাযোগে ত্রুটি দেখা দিয়েছে।');
    } finally {
      setForgotLoading(false);
    }
  };

  // TASK 8: Step 2 - Confirm reset
  const handleConfirmPinReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = forgotEmail.trim().toLowerCase();
    const cleanCode = resetCode.trim();
    const cleanNewPin = newResetPin.trim();
    const cleanConfirm = confirmResetPin.trim();

    if (!cleanCode) {
      setForgotError('৬-সংখ্যার রিসেট কোড দিন।');
      return;
    }
    if (cleanNewPin.length < 6) {
      setForgotError('নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে (At least 6 digits)।');
      return;
    }
    if (cleanNewPin !== cleanConfirm) {
      setForgotError('নতুন পিন ও নিশ্চিতকরণ পিন মিলছে না।');
      return;
    }

    setForgotLoading(true);
    setForgotError(null);

    try {
      const res = await fetch('/api/confirm-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          resetCode: cleanCode,
          newPin: cleanNewPin
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowForgotModal(false);
        setForgotStep(1);
        setEmail(cleanEmail);
        setPin(cleanNewPin);
        setError(null);
        alert('আপনার গোপন পিন সফলভাবে পরিবর্তন করা হয়েছে! এখন লগইন বাটনে চাপ দিয়ে প্রবেশ করুন।');
      } else {
        setForgotError(data.error || 'পিন রিসেট ব্যর্থ হয়েছে। কোড ভুল বা মেয়াদোত্তীর্ণ হতে পারে।');
      }
    } catch (err: any) {
      setForgotError(err.message || 'সার্ভার যোগাযোগে ত্রুটি দেখা দিয়েছে।');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPin = pin.trim();

    if (!cleanEmail) {
      setError('অনুগ্রহ করে আপনার ইমেইল ঠিকানা প্রদান করুন।');
      return;
    }
    if (!cleanPin) {
      setError('অনুগ্রহ করে গোপন পিন (Secret PIN) প্রদান করুন।');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyOwnerSecretPin(cleanEmail, cleanPin);
      if (res.success && res.profile) {
        // Request browser Notification permission on login and fire a one-time Notification()
        // for any reminder due today, as a best-effort foreground alert.
        // NOTE: This works only while the app tab/PWA is open in the foreground; it does NOT
        // operate in the background or replace in-app notifications.
        triggerForegroundDueTodayNotification().catch(() => {});
        onLoginSuccess(res.profile);
      } else {
        setError(res.error || 'অবৈধ ইমেইল অথবা গোপন পিন! সঠিক তথ্য না দিলে অ্যাপে প্রবেশ করা যাবে না।');
      }
    } catch (err: any) {
      setError(err.message || 'যাচাইকরণে ত্রুটি দেখা দিয়েছে। পুনরায় চেষ্টা করুন।');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-gray-900 flex flex-col justify-between p-4 sm:p-6 antialiased pt-safe pb-safe">
      {/* Top Brand Bar */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#1E5128] flex items-center justify-center shadow-xs">
            <Sprout className="w-5 h-5 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-gray-900">
            The Goated Farm
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatusBadge />
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-[#1E5128] bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-1 rounded-full">
            <Lock className="w-3.5 h-3.5 text-[#1E5128]" />
            <span>সুরক্ষিত প্রবেশদ্বার</span>
          </div>
        </div>
      </header>

      {/* Main Login Card */}
      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-sm">
          {/* Header Visual */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1E5128] shadow-sm mb-3">
              <Sprout className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              The Goated Farm
            </h1>
            <p className="text-[14px] text-gray-600 mt-1 font-medium">
              সমন্বিত কৃষি ও খামার হিসাবরক্ষণ ব্যবস্থাপনা
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              id="login-error-alert"
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-[14px] flex items-start gap-2.5 shadow-xs animate-shake"
            >
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed font-semibold">{error}</div>
            </div>
          )}

          {/* Conditional: Setup Incomplete Message OR Login Form */}
          {setupComplete === false ? (
            <div
              id="setup-incomplete-banner"
              className="p-5 sm:p-6 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-4 shadow-xs"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 border border-amber-200">
                  <AlertCircle className="w-6 h-6 text-amber-700" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-amber-950 text-base leading-tight">
                    সেটআপ অসম্পূর্ণ (Setup incomplete)
                  </h3>
                  <p className="text-[14px] text-amber-900 font-semibold leading-relaxed">
                    সেটআপ অসম্পূর্ণ (Setup incomplete): অনুগ্রহ করে AI Studio-র Secrets প্যানেলে আপনার ইমেইল ও পিন যোগ করুন।
                  </p>
                </div>
              </div>

              <div className="bg-white/80 p-3.5 rounded-xl border border-amber-200 text-[13px] text-amber-800 space-y-1.5">
                <div className="font-semibold text-gray-900">প্রয়োজনীয় সিক্রেট ভ্যারিয়েবল (Required Secrets):</div>
                <div className="font-mono text-[12px] text-gray-700 space-y-1">
                  <div>• <span className="font-bold text-[#1E5128]">APPROVED_OWNER_EMAILS</span> — অনুমোদিত মালিকের ইমেইল (যেমন: your-email@gmail.com)</div>
                  <div>• <span className="font-bold text-[#1E5128]">INITIAL_PIN</span> — লগইনের প্রাথমিক গোপন মাস্টার পিন (কমপক্ষে ৬ ডিজিট)</div>
                </div>
              </div>

              <button
                type="button"
                id="btn-retry-setup-check"
                onClick={async () => {
                  setCheckingSetup(true);
                  try {
                    const res = await fetch('/api/farm-info');
                    if (res.ok) {
                      const data = await res.json();
                      setSetupComplete(data.setupComplete !== false);
                    }
                  } catch {
                    // ignore
                  } finally {
                    setCheckingSetup(false);
                  }
                }}
                className="w-full py-3 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white font-bold text-[14px] flex items-center justify-center gap-2 cursor-pointer transition shadow-xs min-h-[44px]"
              >
                <RefreshCw className={`w-4 h-4 ${checkingSetup ? 'animate-spin' : ''}`} />
                <span>পুনরায় যাচাই করুন (Check Again)</span>
              </button>
            </div>
          ) : checkingSetup ? (
            <div className="py-10 text-center text-gray-500 space-y-2.5">
              <RefreshCw className="w-7 h-7 text-[#1E5128] animate-spin mx-auto" />
              <p className="text-[13px] font-medium">নিরাপত্তা স্ট্যাটাস যাচাই করা হচ্ছে...</p>
            </div>
          ) : (
            /* Direct Email + Secret PIN Form */
            <form
              id="secret-pin-login-form"
              onSubmit={handleLogin}
              className="space-y-4"
            >
              {/* Field 1: User's Email Address */}
              <div>
                <label
                  htmlFor="user-email-input"
                  className="block text-[14px] font-bold text-gray-800 mb-1.5"
                >
                  আপনার ইমেইল ঠিকানা (Your Email)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                    <Mail className="w-5 h-5" />
                  </div>
                  <input
                    id="user-email-input"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="যেমন: yourname@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                    className="w-full pl-11 pr-3.5 py-3 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 placeholder-gray-400 text-[15px] transition outline-none"
                  />
                </div>
              </div>

              {/* Field 2: Master Secret PIN */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="secret-pin-input"
                    className="block text-[14px] font-bold text-gray-800"
                  >
                    গোপন পিন (Secret Master PIN)
                  </label>
                  {/* TASK 8: Forgot PIN Link */}
                  <button
                    type="button"
                    id="btn-forgot-pin"
                    onClick={() => {
                      setForgotEmail(email.trim());
                      setShowForgotModal(true);
                      setForgotStep(1);
                      setForgotError(null);
                      setForgotSuccess(null);
                      setResetCode('');
                      setNewResetPin('');
                      setConfirmResetPin('');
                    }}
                    className="text-[13px] text-[#1E5128] hover:text-[#173F1F] hover:underline font-semibold cursor-pointer"
                  >
                    PIN ভুলে গেছেন? / Forgot PIN?
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-500">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <input
                    id="secret-pin-input"
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={12}
                    required
                    placeholder="গোপন পিন দিন (ডিফল্ট: 123456)..."
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                    className="w-full pl-11 pr-11 py-3 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 placeholder-gray-400 text-[16px] font-mono tracking-widest transition outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                  >
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 pt-1.5 px-0.5">
                  <span>ডিফল্ট পিন: <strong className="font-mono text-gray-800 font-semibold">123456</strong></span>
                  <button
                    type="button"
                    onClick={() => setPin('123456')}
                    className="text-[#1E5128] hover:text-[#173F1F] font-semibold cursor-pointer underline"
                  >
                    পিন পূরণ করুন (Auto-fill 123456)
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-login"
                type="submit"
                disabled={loading || !email.trim() || !pin.trim()}
                className="w-full py-3.5 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 disabled:opacity-50 text-white font-bold text-[15px] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[48px] mt-5"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>যাচাই করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <span>লগইন করুন ও অ্যাপে প্রবেশ করুন</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {/* Remember Me Notice */}
              <div className="pt-3 border-t border-gray-200 flex items-start gap-2.5 text-[13px] text-gray-600 leading-relaxed">
                <ShieldCheck className="w-5 h-5 text-[#1E5128] shrink-0 mt-0.5" />
                <span>
                  একবার সঠিক পিন দিয়ে সফলভাবে লগইন করলে এই ডিভাইসে আপনার সেশন সংরক্ষিত থাকবে। পরবর্তীতে লিংক খুললে বারবার পিন দিতে হবে না।
                </span>
              </div>
            </form>
          )}
        </div>
      </main>

      {/* TASK 8: Forgot PIN Modal (2-Step Form) */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl border border-gray-200 relative animate-in fade-in zoom-in duration-150">
            <button
              onClick={() => setShowForgotModal(false)}
              className="absolute top-5 right-5 p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#E8F5E9] text-[#1E5128] flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-lg">
                  {forgotStep === 1 ? 'গোপন পিন পুনরুদ্ধার (Step 1 of 2)' : 'নতুন পিন নিশ্চিতকরণ (Step 2 of 2)'}
                </h3>
                <p className="text-[12px] text-gray-500">
                  {forgotStep === 1
                    ? 'ইমেইলে যাচাইকরণ কোড পাঠানো হবে (১৫ মিনিট মেয়াদ)'
                    : 'কোড ও নতুন ৬+ ডিজিটের গোপন পিন দিন'}
                </p>
              </div>
            </div>

            {forgotError && (
              <div
                role="alert"
                className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-[13px] flex items-start gap-2 shadow-xs"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 font-semibold">{forgotError}</div>
              </div>
            )}

            {forgotSuccess && (
              <div
                role="alert"
                className="mb-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] flex items-start gap-2 shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1 font-semibold">{forgotSuccess}</div>
              </div>
            )}

            {/* Step 1: Request Code */}
            {forgotStep === 1 && (
              <form onSubmit={handleRequestResetCode} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-1">
                    অনুমোদিত মালিকের ইমেইল (Owner Email)
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    disabled={forgotLoading}
                    placeholder="মালিকের ইমেইল প্রদান করুন..."
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] text-gray-900 text-[14px] font-mono outline-none"
                  />
                  <p className="text-[12px] text-gray-500 mt-1">
                    অনুমোদিত মালিকের ইমেইলে ৬ ডিজিটের রিসেট কোড পাঠানো হবে।
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={forgotLoading || !forgotEmail}
                  className="w-full py-3 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 disabled:opacity-50 text-white font-bold text-[14px] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[44px]"
                >
                  {forgotLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>কোড পাঠানো হচ্ছে...</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      <span>রিসেট কোড পাঠান (Send Reset Code)</span>
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Step 2: Enter Code + New PIN */}
            {forgotStep === 2 && (
              <form onSubmit={handleConfirmPinReset} className="space-y-3.5">
                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-1">
                    ইমেইল ঠিকানা
                  </label>
                  <input
                    type="text"
                    disabled
                    value={forgotEmail}
                    className="w-full px-3.5 py-2 rounded-xl bg-gray-100 border border-gray-300 text-gray-600 font-mono text-base"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-1">
                    ৬-সংখ্যার রিসেট কোড (6-digit Reset Code)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    placeholder="যেমন: 492815"
                    value={resetCode}
                    onChange={(e) => {
                      setResetCode(e.target.value.replace(/\D/g, ''));
                      if (forgotError) setForgotError(null);
                    }}
                    disabled={forgotLoading}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] text-gray-900 font-mono text-[16px] tracking-widest outline-none text-center"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    কোডটির মেয়াদ ১৫ মিনিট। এটি একবারই ব্যবহারযোগ্য।
                  </p>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-1">
                    নতুন গোপন পিন (New PIN — 6+ digits)
                  </label>
                  <div className="relative">
                    <input
                      type={showNewResetPin ? 'text' : 'password'}
                      inputMode="numeric"
                      minLength={6}
                      required
                      placeholder="কমপক্ষে ৬ ডিজিটের নতুন পিন..."
                      value={newResetPin}
                      onChange={(e) => {
                        setNewResetPin(e.target.value);
                        if (forgotError) setForgotError(null);
                      }}
                      disabled={forgotLoading}
                      className="w-full px-3.5 pr-10 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] text-gray-900 font-mono text-[15px] tracking-wider outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewResetPin(!showNewResetPin)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                    >
                      {showNewResetPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-1">
                    নতুন পিন নিশ্চিত করুন (Confirm New PIN)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    minLength={6}
                    required
                    placeholder="নতুন পিনটি পুনরায় লিখুন..."
                    value={confirmResetPin}
                    onChange={(e) => {
                      setConfirmResetPin(e.target.value);
                      if (forgotError) setForgotError(null);
                    }}
                    disabled={forgotLoading}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] text-gray-900 font-mono text-[15px] tracking-wider outline-none"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotStep(1);
                      setForgotError(null);
                    }}
                    disabled={forgotLoading}
                    className="py-2.5 px-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-[13px] transition flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>পেছনে</span>
                  </button>

                  <button
                    type="submit"
                    disabled={forgotLoading || !resetCode || !newResetPin || !confirmResetPin}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 disabled:opacity-50 text-white font-bold text-[14px] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[44px]"
                  >
                    {forgotLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>সংরক্ষণ হচ্ছে...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>পিন রিসেট ও সেভ করুন</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-xs text-gray-500 py-3 font-medium">
        © 2025 The Goated Farm • একক মালিকানা সমন্বিত কৃষি খামার ইআরপি
      </footer>
    </div>
  );
};
