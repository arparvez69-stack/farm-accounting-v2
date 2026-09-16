import React, { useState, useEffect } from 'react';
import {
  Sprout,
  Mail,
  KeyRound,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import {
  requestOwnerLoginCode,
  verifyOwnerLoginCode,
  APPROVED_OWNER_EMAILS
} from '../services/authService';
import { UserProfile } from '../types';

interface Props {
  onLoginSuccess: (profile: UserProfile) => void;
}

export const LoginScreen: React.FC<Props> = ({ onLoginSuccess }) => {
  const [step, setStep] = useState<'EMAIL' | 'OTP'>('EMAIL');
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Resend countdown timer
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Step 1: Request OTP Code
  const handleRequestCode = async (targetEmail?: string) => {
    const emailToUse = (targetEmail || email).trim().toLowerCase();
    if (!emailToUse) {
      setError('অনুগ্রহ করে আপনার নিবন্ধিত ইমেইল ঠিকানা প্রদান করুন।');
      return;
    }

    setLoading(true);
    setError(null);
    setInfoMessage(null);
    setDevCode(null);

    try {
      const res = await requestOwnerLoginCode(emailToUse);
      if (res.success) {
        setEmail(emailToUse);
        setStep('OTP');
        setInfoMessage(res.message);
        setResendCooldown(30);
        if (res.devCode) {
          setDevCode(res.devCode);
          setOtpCode(res.devCode);
        }
      } else {
        setError(res.error || 'কোড পাঠানো সম্ভব হয়নি।');
      }
    } catch (err: any) {
      setError('সার্ভার যোগাযোগে সমস্যা হয়েছে।');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP Code
  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = otpCode.trim();

    if (!cleanCode || cleanCode.length < 6) {
      setError('অনুগ্রহ করে ৬ ডিজিটের সম্পূর্ণ কোড প্রদান করুন।');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await verifyOwnerLoginCode(email, cleanCode);
      if (res.success && res.profile) {
        onLoginSuccess(res.profile);
      } else {
        setError(res.error || 'যাচাইকরণ ব্যর্থ হয়েছে। অনুগ্রহ করে সঠিক কোড দিন।');
      }
    } catch (err: any) {
      setError(err.message || 'যাচাইকরণে ত্রুটি দেখা দিয়েছে।');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/40 text-slate-100 flex flex-col justify-between p-4 sm:p-6 antialiased">
      {/* Top Brand Bar */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/90 flex items-center justify-center shadow-lg shadow-emerald-900/30">
            <Sprout className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-slate-300">
            The Goted Farm
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-400/90 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>সুরক্ষিত মালিক পোর্টাল</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/50 backdrop-blur-md">
          {/* Header Visual */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-xl shadow-emerald-900/40 mb-3">
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
              className="mb-5 p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2.5 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Info Banner */}
          {infoMessage && (
            <div
              id="login-info-alert"
              className="mb-5 p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2.5 animate-fadeIn"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{infoMessage}</div>
            </div>
          )}

          {/* Development Fast-Test Banner */}
          {devCode && (
            <div
              id="dev-otp-banner"
              onClick={() => setOtpCode(devCode)}
              className="mb-5 p-3 rounded-xl bg-amber-950/50 border border-amber-800/80 text-amber-200 text-xs cursor-pointer hover:bg-amber-950/70 transition-colors flex items-center justify-between gap-2"
              title="ক্লিক করে কোড পেস্ট করুন"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>টেস্টিং ওটিপি কোড: <strong className="font-mono text-sm tracking-widest text-white">{devCode}</strong></span>
              </div>
              <span className="text-[11px] underline text-amber-400">অটো-পূরণ করুন</span>
            </div>
          )}

          {/* STEP 1: Email Form */}
          {step === 'EMAIL' ? (
            <form
              id="request-code-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleRequestCode();
              }}
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="owner-email-input"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  মালিকের ইমেইল ঠিকানা (Owner Email)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    id="owner-email-input"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-white placeholder-slate-500 text-sm transition outline-none"
                  />
                </div>
              </div>

              {/* Quick-Pick Authorized Owner Buttons */}
              <div className="pt-1">
                <p className="text-[11px] font-medium text-slate-400 mb-2">
                  অনুমোদিত মালিক তালিকা (Quick Select):
                </p>
                <div className="grid grid-cols-1 gap-1.5">
                  {APPROVED_OWNER_EMAILS.map((approvedEmail) => (
                    <button
                      key={approvedEmail}
                      type="button"
                      id={`select-owner-${approvedEmail.split('@')[0]}`}
                      onClick={() => {
                        setEmail(approvedEmail);
                        handleRequestCode(approvedEmail);
                      }}
                      disabled={loading}
                      className="text-left px-3 py-1.5 rounded-lg text-xs bg-slate-800/70 hover:bg-slate-800 hover:border-emerald-600/70 border border-slate-700/60 text-slate-300 hover:text-white transition flex items-center justify-between group"
                    >
                      <span className="font-mono truncate">{approvedEmail}</span>
                      <span className="text-[10px] text-emerald-400 opacity-80 group-hover:opacity-100 flex items-center gap-1 shrink-0">
                        লগইন করুন <ArrowRight className="w-2.5 h-2.5" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                id="btn-request-code"
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer mt-4"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>কোড পাঠানো হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <span>লগইন কোড পাঠান</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed pt-2">
                পাসওয়ার্ডহীন নিরাপদ ইমেইল প্রমাণীকরণ। ব্রাউজারে ডিভাইস মনে রাখবে ("Remember Me")।
              </p>
            </form>
          ) : (
            /* STEP 2: OTP Code Form */
            <form
              id="verify-code-form"
              onSubmit={handleVerifyCode}
              className="space-y-4"
            >
              <div className="flex items-center justify-between pb-1">
                <button
                  type="button"
                  id="btn-change-email"
                  onClick={() => {
                    setStep('EMAIL');
                    setError(null);
                    setInfoMessage(null);
                  }}
                  className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>ইমেইল পরিবর্তন</span>
                </button>
                <span className="text-xs font-mono text-emerald-400 truncate max-w-[200px]" title={email}>
                  {email}
                </span>
              </div>

              <div>
                <label
                  htmlFor="otp-code-input"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  ৬ ডিজিটের ওটিপি যাচাইকরণ কোড
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    id="otp-code-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoFocus
                    required
                    placeholder="123456"
                    value={otpCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setOtpCode(val);
                      if (val.length === 6) {
                        // Auto-submit when 6 digits typed
                        setError(null);
                      }
                    }}
                    disabled={loading}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-950/80 border border-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-white placeholder-slate-600 text-center tracking-[0.5em] font-mono text-xl font-bold transition outline-none"
                  />
                </div>
              </div>

              <button
                id="btn-verify-code"
                type="submit"
                disabled={loading || otpCode.length < 6}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>যাচাই করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <span>যাচাই করুন ও প্রবেশ করুন</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Resend Code Section */}
              <div className="text-center pt-2">
                {resendCooldown > 0 ? (
                  <span className="text-xs text-slate-500">
                    কোড পুনরায় পাঠানো যাবে: <strong className="text-slate-300 font-mono">{resendCooldown}s</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    id="btn-resend-code"
                    onClick={() => handleRequestCode()}
                    disabled={loading}
                    className="text-xs text-emerald-400 hover:text-emerald-300 underline font-medium transition"
                  >
                    কোড পাননি? আবার পাঠান (Resend Code)
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 py-3">
        © 2025 The Goted Farm • একক মালিকানা সমন্বিত কৃষি খামার ইআরপি
      </footer>
    </div>
  );
};
