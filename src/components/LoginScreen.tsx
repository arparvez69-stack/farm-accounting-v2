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
  EyeOff
} from 'lucide-react';
import { verifyOwnerSecretPin } from '../services/authService';
import { UserProfile } from '../types';

interface Props {
  onLoginSuccess: (profile: UserProfile) => void;
}

export const LoginScreen: React.FC<Props> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 antialiased">
      {/* Top Brand Bar */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-950/50">
            <Sprout className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-slate-200">
            The Goted Farm
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-950/70 border border-emerald-800/80 px-2.5 py-1 rounded-full">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>সুরক্ষিত প্রবেশদ্বার</span>
        </div>
      </header>

      {/* Main Login Card */}
      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/80">
          {/* Header Visual */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-600 shadow-xl shadow-emerald-950/60 mb-3">
              <Sprout className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              The Goted Farm
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              সমন্বিত কৃষি ও খামার ইআরপি ব্যবস্থাপনা
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div
              id="login-error-alert"
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-start gap-2.5 shadow-lg animate-shake"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed font-medium">{error}</div>
            </div>
          )}

          {/* Direct Email + Secret PIN Form */}
          <form
            id="secret-pin-login-form"
            onSubmit={handleLogin}
            className="space-y-4"
          >
            {/* Field 1: User's Email Address */}
            <div>
              <label
                htmlFor="user-email-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                আপনার ইমেইল ঠিকানা (Your Email)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
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
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-white placeholder-slate-500 text-sm transition outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                আপনার ইমেইলটি অ্যাপের সিকিউরিটি অডিট লগে রেকর্ড থাকবে যাতে কে অ্যাপ ব্যবহার করছে তা মালিক দেখতে পারেন।
              </p>
            </div>

            {/* Field 2: Master Secret PIN */}
            <div>
              <label
                htmlFor="secret-pin-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                গোপন পিন (Secret Master PIN)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  id="secret-pin-input"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={12}
                  required
                  placeholder="গোপন পিন দিন..."
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={loading}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-white placeholder-slate-600 text-sm font-mono tracking-widest transition outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                নির্ধারিত সঠিক গোপন পিন প্রদান না করলে কোনোভাবেই অ্যাপের ভেতরে প্রবেশ করা যাবে না।
              </p>
            </div>

            {/* Submit Button */}
            <button
              id="btn-submit-login"
              type="submit"
              disabled={loading || !email.trim() || !pin.trim()}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer mt-5"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>যাচাই করা হচ্ছে...</span>
                </>
              ) : (
                <>
                  <span>লগইন করুন ও অ্যাপে প্রবেশ করুন</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Remember Me Notice */}
            <div className="pt-3 border-t border-slate-800/80 flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                একবার সঠিক পিন দিয়ে সফলভাবে লগইন করলে এই ডিভাইসে আপনার সেশন সংরক্ষিত থাকবে। পরবর্তীতে লিংক খুললে বারবার পিন দিতে হবে না।
              </span>
            </div>
          </form>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 py-3">
        © 2025 The Goted Farm • একক মালিকানা সমন্বিত কৃষি খামার ইআরপি
      </footer>
    </div>
  );
};
