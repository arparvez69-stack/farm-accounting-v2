import React from 'react';
import { ArrowRight, Sparkles, LogOut } from 'lucide-react';

interface WelcomeScreenProps {
  onDismiss: () => void;
  onLogout?: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onDismiss, onLogout }) => {
  return (
    <div
      id="welcome-screen-root"
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8 sm:p-8 relative z-10"
    >
      <div
        id="welcome-card"
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-xl flex flex-col items-center text-center space-y-6 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Farm Brand Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-[#1E5128] dark:text-emerald-400 text-xs font-semibold tracking-wide border border-emerald-200/80 dark:border-emerald-800/60 select-none">
          <Sparkles className="w-3.5 h-3.5" />
          <span>The Goated Farm ইআরপি</span>
        </div>

        {/* Large Farmer Illustration */}
        <div className="w-full flex justify-center items-center py-1">
          <img
            id="welcome-farmer-illustration"
            src="/illustrations/Farmer-amico.svg"
            alt="Farmer illustration"
            loading="eager"
            className="w-56 sm:w-72 md:w-80 max-w-full h-auto object-contain pointer-events-none drop-shadow-xs"
          />
        </div>

        {/* Short Welcome Message */}
        <div className="space-y-2.5 max-w-md">
          <h1
            id="welcome-title"
            className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tracking-tight leading-snug"
          >
            স্বাগতম! আপনার খামার ব্যবস্থাপনা শুরু করুন
          </h1>
          <p
            id="welcome-message"
            className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed font-normal"
          >
            সমন্বিত ডেইরি, ফসল ও মৎস্য খামারের হিসাবরক্ষণ প্ল্যাটফর্মে আপনাকে স্বাগতম। এই মুহূর্তে কোনো পূর্ববর্তী ডেটা নেই — নতুনভাবে আপনার খামারের সকল কার্যক্রম ও লেনদেন লিপিবদ্ধ করতে ড্যাশবোর্ডে প্রবেশ করুন।
          </p>
        </div>

        {/* Action Button: Dismisses and goes straight to normal Dashboard */}
        <div className="w-full pt-2 flex flex-col items-center gap-3">
          <button
            id="btn-welcome-dismiss-dashboard"
            type="button"
            onClick={onDismiss}
            className="w-full sm:w-auto px-8 py-3.5 bg-[#1E5128] hover:bg-[#163e1e] active:scale-[0.98] text-white font-semibold text-base rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2.5 cursor-pointer select-none"
          >
            <span>ড্যাশবোর্ডে প্রবেশ করুন</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onLogout && (
            <button
              id="btn-welcome-logout"
              type="button"
              onClick={onLogout}
              className="mt-2 text-xs sm:text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>লগআউট করুন (Sign out)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
