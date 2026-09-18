import React, { useState, useEffect } from 'react';
import { Shield, LogOut, Sprout, CloudCheck, AlertTriangle, RefreshCw, X, ChevronRight } from 'lucide-react';
import { SyncState, SystemConfig, UserProfile } from '../types';
import { SyncStatusBadge } from './SyncStatusBadge';
import { getLastSyncTime, formatBackupTimestamp } from '../services/exportService';
import { useLanguage, t } from '../i18n/translations';
import { runRegressionTests, getLatestRegressionTestResult, TestResult } from '../utils/regressionTests';

interface Props {
  userProfile: UserProfile;
  systemConfig: SystemConfig | null;
  syncState: SyncState;
  pendingCount: number;
  regressionTestResult?: TestResult | null;
  activeTab?: string;
  onSyncNow: () => void;
  onLogout: () => void;
  onOpenProfile?: () => void;
}

const getModuleTheme = (tab?: string) => {
  switch (tab) {
    case 'operations':
      return {
        iconBg: 'bg-emerald-700 dark:bg-emerald-800',
        textColor: 'text-emerald-700 dark:text-emerald-400',
        barColor: 'bg-emerald-600',
        roleBadge: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
        roleIcon: 'text-emerald-700 dark:text-emerald-400'
      };
    case 'commerce':
      return {
        iconBg: 'bg-amber-600 dark:bg-amber-700',
        textColor: 'text-amber-700 dark:text-amber-400',
        barColor: 'bg-amber-500',
        roleBadge: 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        roleIcon: 'text-amber-600 dark:text-amber-400'
      };
    case 'accounting':
    case 'finance':
      return {
        iconBg: 'bg-blue-600 dark:bg-blue-700',
        textColor: 'text-blue-700 dark:text-blue-400',
        barColor: 'bg-blue-600',
        roleBadge: 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
        roleIcon: 'text-blue-600 dark:text-blue-400'
      };
    case 'reports':
      return {
        iconBg: 'bg-teal-600 dark:bg-teal-700',
        textColor: 'text-teal-700 dark:text-teal-400',
        barColor: 'bg-teal-600',
        roleBadge: 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-400 border-teal-200 dark:border-teal-800',
        roleIcon: 'text-teal-600 dark:text-teal-400'
      };
    case 'more':
      return {
        iconBg: 'bg-slate-700 dark:bg-slate-700',
        textColor: 'text-slate-700 dark:text-slate-300',
        barColor: 'bg-slate-600',
        roleBadge: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700',
        roleIcon: 'text-slate-700 dark:text-slate-300'
      };
    default:
      return {
        iconBg: 'bg-[#1E5128] dark:bg-emerald-800',
        textColor: 'text-[#1E5128] dark:text-emerald-400',
        barColor: 'bg-[#1E5128]',
        roleBadge: 'bg-[#F0FDF4] dark:bg-emerald-950/60 text-[#1E5128] dark:text-emerald-400 border-[#BBF7D0] dark:border-emerald-800',
        roleIcon: 'text-[#1E5128] dark:text-emerald-400'
      };
  }
};

export const Header: React.FC<Props> = ({
  userProfile,
  systemConfig,
  syncState,
  pendingCount,
  regressionTestResult,
  activeTab,
  onSyncNow,
  onLogout
}) => {
  const { language } = useLanguage();
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(() => getLastSyncTime());
  const [testResult, setTestResult] = useState<TestResult | null>(() => regressionTestResult || getLatestRegressionTestResult());
  const [showFailuresModal, setShowFailuresModal] = useState(false);
  const [isRerunningTests, setIsRerunningTests] = useState(false);
  const theme = getModuleTheme(activeTab);

  useEffect(() => {
    if (regressionTestResult) {
      setTestResult(regressionTestResult);
    }
  }, [regressionTestResult]);

  useEffect(() => {
    const handleSyncTimeUpdated = () => {
      setLastBackupTime(getLastSyncTime());
    };
    window.addEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
    return () => window.removeEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
  }, []);

  useEffect(() => {
    const handleTestsFinished = (e: Event) => {
      const customEvent = e as CustomEvent<TestResult>;
      if (customEvent.detail) {
        setTestResult(customEvent.detail);
      }
    };
    window.addEventListener('regression-tests-finished', handleTestsFinished);
    return () => window.removeEventListener('regression-tests-finished', handleTestsFinished);
  }, []);

  const handleRerunTests = async () => {
    setIsRerunningTests(true);
    try {
      const res = await runRegressionTests();
      setTestResult(res);
    } catch (err) {
      console.error('Error re-running regression tests:', err);
    } finally {
      setIsRerunningTests(false);
    }
  };

  const hasTestFailures = !!(testResult && !testResult.success && testResult.failures && testResult.failures.length > 0);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 text-gray-900 dark:text-slate-100 pt-safe shadow-xs transition-colors">
        {/* Module Color Accent Bar */}
        <div className={`h-1 w-full transition-colors duration-200 ${theme.barColor}`} />

        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 px-3.5 sm:px-6 py-2.5">
          {/* Left: Brand / Farm Info */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-10 h-10 rounded-xl ${theme.iconBg} flex items-center justify-center shadow-sm shrink-0 transition-colors duration-200`}>
              <Sprout className="w-5 h-5 text-white" />
            </div>
            <div className="truncate">
              <h1 className="text-[15px] sm:text-base font-bold text-gray-900 dark:text-slate-100 tracking-tight leading-tight truncate">
                {systemConfig?.companyName || 'The Goated Farm'}
              </h1>
              <p className={`text-[13px] ${theme.textColor} font-semibold truncate flex items-center gap-1.5 transition-colors duration-200`}>
                <span>{t('app.tagline', language)}</span>
                <span className="hidden lg:inline text-xs text-gray-400 dark:text-slate-600">•</span>
                <span className="hidden lg:inline text-xs text-gray-500 dark:text-slate-400 font-normal">
                  {language === 'en' ? 'Last backup: ' : 'সর্বশেষ ব্যাকআপ: '}{formatBackupTimestamp(lastBackupTime)}
                </span>
              </p>
            </div>
          </div>

          {/* Right: Sync Status & User Role / Action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <SyncStatusBadge
              syncState={syncState}
              pendingCount={pendingCount}
              onSyncNow={onSyncNow}
            />

            {/* Owner Role Badge */}
            <span className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${theme.roleBadge} transition-colors duration-200`}>
              <Shield className={`w-3.5 h-3.5 ${theme.roleIcon}`} />
              <span>{language === 'en' ? 'Owner' : 'মালিক (OWNER)'}</span>
            </span>

            {/* User & Logout */}
            <div className="flex items-center gap-1.5 border-l border-gray-200 dark:border-slate-800 pl-2">
              <span
                title={userProfile.email || 'Owner'}
                className="text-xs text-gray-600 dark:text-slate-300 max-w-[120px] sm:max-w-[180px] truncate font-medium hidden md:inline-block"
              >
                {userProfile.email || userProfile.displayName || 'Owner'}
              </span>
              <button
                id="btn-header-logout"
                onClick={onLogout}
                title={language === 'en' ? 'Log out this device' : 'এই ডিভাইস থেকে লগ আউট করুন (Log out this device)'}
                className="p-2 sm:px-3 sm:py-1.5 rounded-xl text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-colors cursor-pointer min-h-[44px] flex items-center justify-center gap-1.5 active:scale-95 text-xs font-bold"
              >
                <LogOut className="w-4 h-4 text-red-600 dark:text-red-400" />
                <span className="hidden md:inline">{t('btn.logout', language)}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Small persistent warning banner on system test failure */}
        {hasTestFailures && (
          <div className="max-w-5xl mx-auto mt-2 pt-2 border-t border-amber-200/80">
            <button
              type="button"
              id="btn-system-test-warning-banner"
              onClick={() => setShowFailuresModal(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100/90 border border-amber-300 text-amber-950 transition-colors text-xs sm:text-[13px] font-semibold cursor-pointer active:scale-[0.99] text-left shadow-2xs group"
            >
              <div className="flex items-center gap-2 truncate">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 animate-pulse" />
                <span className="truncate font-bold">
                  সিস্টেম পরীক্ষায় সমস্যা পাওয়া গেছে, বিস্তারিত দেখতে ট্যাপ করুন
                </span>
                <span className="hidden sm:inline text-amber-800 font-normal">
                  (System check found an issue, tap for details)
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 text-[11px] font-bold">
                  {testResult?.failures.length}টি সমস্যা
                </span>
                <ChevronRight className="w-4 h-4 text-amber-700 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          </div>
        )}
      </header>

      {/* System Test Failures Details Modal */}
      {showFailuresModal && testResult && (
        <div
          id="modal-system-test-failures"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 leading-tight">
                    সিস্টেম স্ব-পরীক্ষার ফলাফল
                  </h3>
                  <p className="text-[11px] sm:text-xs text-amber-900 font-medium">
                    System Self-Test Diagnostic Report
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFailuresModal(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-amber-100 transition-colors cursor-pointer"
                title="বন্ধ করুন"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stats row */}
            <div className="px-4 sm:px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs sm:text-[13px] font-medium text-gray-600">
              <div>
                মোট পরীক্ষা: <strong className="text-gray-900">{testResult.total}</strong>
              </div>
              <div>
                সফল: <strong className="text-emerald-700">{testResult.passed}</strong>
              </div>
              <div>
                ব্যর্থ: <strong className="text-rose-700">{testResult.failed}</strong>
              </div>
            </div>

            {/* Failure items */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1">
              <p className="text-xs text-gray-600 font-medium">
                নিচের পরীক্ষাগুলোতে সমস্যা ধরা পড়েছে। এগুলো অবিলম্বে সংশোধন করা প্রয়োজন:
              </p>
              <ul className="space-y-2">
                {testResult.failures.map((fail, idx) => (
                  <li
                    key={idx}
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-[13px] font-mono leading-relaxed"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-600 mt-1.5 shrink-0" />
                      <span className="break-words">{fail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Modal Actions */}
            <div className="p-3.5 sm:p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRerunTests}
                disabled={isRerunningTests}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs sm:text-sm font-bold shadow-xs active:scale-95 transition-all disabled:opacity-60 cursor-pointer min-h-[40px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRerunningTests ? 'animate-spin' : ''}`} />
                <span>{isRerunningTests ? 'পরীক্ষা চলছে...' : 'পুনরায় পরীক্ষা করুন'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowFailuresModal(false)}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer min-h-[40px]"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
