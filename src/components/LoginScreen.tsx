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
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1E5128] bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-1 rounded-full">
          <Lock className="w-3.5 h-3.5 text-[#1E5128]" />
          <span>সুরক্ষিত প্রবেশদ্বার</span>
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
              <p className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                আপনার ইমেইলটি অ্যাপের সিকিউরিটি অডিট লগে রেকর্ড থাকবে যাতে কে অ্যাপ ব্যবহার করছে তা মালিক দেখতে পারেন।
              </p>
            </div>

            {/* Field 2: Master Secret PIN */}
            <div>
              <label
                htmlFor="secret-pin-input"
                className="block text-[14px] font-bold text-gray-800 mb-1.5"
              >
                গোপন পিন (Secret Master PIN)
              </label>
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
                  placeholder="গোপন পিন দিন..."
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
              <p className="text-[13px] text-gray-500 mt-1.5 leading-snug">
                অনুমোদিত ৪ জন মালিকের নির্ধারিত গোপন পিন প্রদান করুন।
              </p>
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
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-gray-500 py-3 font-medium">
        © 2025 The Goated Farm • একক মালিকানা সমন্বিত কৃষি খামার ইআরপি
      </footer>
    </div>
  );
};
