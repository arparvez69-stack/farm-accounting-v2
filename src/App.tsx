import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  checkSystemBootstrap,
  initializeLocalDatabase,
  listenToOnlineSync,
  resolveUserRole,
  seedSystemConfigIfNecessary,
  synchronizePendingData,
  restoreRemoteDataIfLocalEmpty
} from './firebase/firebaseClient';
import { AlertTriangle, CheckCircle2, RotateCcw, X } from 'lucide-react';
import { logoutOwner } from './services/authService';
import { ActiveTab, MobileBottomNav } from './components/MobileBottomNav';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { AccountingModule } from './components/AccountingModule';
import { FarmOperationsModule } from './components/FarmOperationsModule';
import { InventoryCommerceModule } from './components/InventoryCommerceModule';
import { BankingInvestorsModule } from './components/BankingInvestorsModule';
import { ReportsModule } from './components/ReportsModule';
import { MoreModule } from './components/MoreModule';
import { AnimalEvent, JournalLine, SyncState, SystemConfig, UserProfile } from './types';
import { runRegressionTests, getLatestRegressionTestResult, TestResult } from './utils/regressionTests';
import { db, triggerForegroundDueTodayNotification } from './db/indexedDb';
import { runDepreciationOnAppLoad } from './accounting/depreciationService';
import { postJournalEntry } from './accounting/accountingEngine';
import { getPaymentAccount } from './accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId, safeInsert } from './utils/idGenerator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { subscribeToUndo, executeUndo, UndoableAction } from './services/undoService';
import { PatternBackground } from './components/ui/PatternBackground';
import { SuccessAnimationToast } from './components/ui/SuccessAnimation';

export default function App() {
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [regressionTestResult, setRegressionTestResult] = useState<TestResult | null>(() => getLatestRegressionTestResult());

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>('ONLINE');
  const [pendingCount, setPendingCount] = useState(0);

  // Active Tab & Cross-Tab Navigation Params
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedAnimalIdForOps, setSelectedAnimalIdForOps] = useState<string | null>(null);
  const [opsActionParams, setOpsActionParams] = useState<{
    openActivityModal?: boolean;
    eventType?: AnimalEvent['eventType'];
  } | null>(null);
  const [offlineEmptyWarning, setOfflineEmptyWarning] = useState<boolean>(false);

  // Toast Undo State (5 seconds duration)
  const [undoAction, setUndoAction] = useState<UndoableAction | null>(null);
  const [undoToastMessage, setUndoToastMessage] = useState<string | null>(null);
  const undoTimerRef = useRef<any>(null);

  // Auto-posted Recurring Expense Toast State
  const [recurringToastMessage, setRecurringToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (recurringToastMessage) {
      const timer = setTimeout(() => {
        setRecurringToastMessage(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [recurringToastMessage]);

  const checkAndPostRecurringExpenses = async () => {
    try {
      const now = new Date();
      const currentDay = now.getDate();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDay).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;
      const currentYearMonth = `${yyyy}-${mm}`;

      // 1. Fetch active templates
      const activeTemplates = await db.recurringExpenseTemplates
        .filter((t) => t.active === true)
        .toArray();

      if (!activeTemplates || activeTemplates.length === 0) {
        return;
      }

      // 2. Filter templates where dayOfMonth matches today's date
      const templatesDueToday = activeTemplates.filter((t) => Number(t.dayOfMonth) === currentDay);
      if (templatesDueToday.length === 0) {
        return;
      }

      // 3. Check existing journal entries for current month to avoid duplicate posting
      const allAccounts = await db.accounts.toArray();
      const cashAccountCode = getPaymentAccount('CASH', 'PURCHASE');
      const cashAccount = allAccounts.find((a) => a.code === cashAccountCode);

      const postedItems: { description: string; amount: number }[] = [];

      for (const template of templatesDueToday) {
        const amount = Number(template.amount);
        if (isNaN(amount) || amount <= 0) continue;

        // Check if matching entry has already been posted this month
        const alreadyPosted = await db.journalEntries
          .filter((j) => {
            if (!j.date || !j.date.startsWith(currentYearMonth)) return false;
            if (
              j.reference === `REC_${template.id}_${currentYearMonth}` ||
              j.reference === `REC_${template.id}` ||
              j.reference === template.id
            ) {
              return true;
            }
            const hasMatchingAccount = j.lines?.some(
              (l) => l.accountCode === template.accountCode && Math.abs(Number(l.debit || 0) - amount) < 0.01
            );
            return Boolean(hasMatchingAccount && j.narration?.includes(template.description));
          })
          .count();

        if (alreadyPosted > 0) {
          continue;
        }

        const expAccount = allAccounts.find((a) => a.code === template.accountCode);
        const expName = expAccount ? expAccount.nameBn : template.description;
        const cashName = cashAccount ? cashAccount.nameBn : 'নগদ তহবিল (Cash in Hand)';

        const journalId = generateUniqueId('jrn');
        const voucherNum = generateTransactionNumber('PAY');

        const lines: JournalLine[] = [
          {
            accountId: expAccount?.id || template.accountCode,
            accountCode: template.accountCode,
            accountName: expName,
            debit: amount,
            credit: 0,
            memo: template.description
          },
          {
            accountId: cashAccount?.id || cashAccountCode,
            accountCode: cashAccountCode,
            accountName: cashName,
            debit: 0,
            credit: amount,
            memo: `পুনরাবৃত্ত খরচ: ${template.description}`
          }
        ];

        await postJournalEntry({
          id: journalId,
          voucherNumber: voucherNum,
          voucherType: 'PAYMENT',
          date: todayStr,
          narration: `স্বয়ংক্রিয় পুনরাবৃত্ত খরচ: ${template.description}`,
          reference: `REC_${template.id}_${currentYearMonth}`,
          lines,
          createdBy: 'SYSTEM',
          createdAt: new Date().toISOString(),
          synced: false
        });

        postedItems.push({
          description: template.description,
          amount
        });
      }

      if (postedItems.length > 0) {
        window.dispatchEvent(new Event('goted_data_changed'));
        const totalPostedAmount = postedItems.reduce((sum, item) => sum + item.amount, 0);
        const detailStr = postedItems.map((p) => `${p.description} (৳${p.amount.toLocaleString('en-IN')})`).join(', ');
        setRecurringToastMessage(`স্বয়ংক্রিয় পুনরাবৃত্ত খরচ দাখিলা সম্পন্ন: ${detailStr} [মোট: ৳${totalPostedAmount.toLocaleString('en-IN')}]`);
      }
    } catch (err) {
      console.error('[The Goated Farm] Error processing recurring expense templates:', err);
    }
  };

  const handleNavigate = (
    tab: ActiveTab,
    animalId?: string,
    action?: { openActivityModal?: boolean; eventType?: AnimalEvent['eventType'] }
  ) => {
    setActiveTab(tab);
    if (tab === 'operations') {
      if (animalId) {
        setSelectedAnimalIdForOps(animalId);
      }
      if (action) {
        setOpsActionParams(action);
      }
    }
  };

  const handlePerformUndo = async () => {
    if (!undoAction) return;
    const actionToUndo = undoAction;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
    }
    setUndoAction(null);
    try {
      const res = await executeUndo(actionToUndo);
      setUndoToastMessage(res.message);
      setTimeout(() => {
        setUndoToastMessage(null);
      }, 3000);
    } catch (err: any) {
      setUndoToastMessage(`আনডু ব্যর্থ: ${err.message || 'ত্রুটি'}`);
      setTimeout(() => {
        setUndoToastMessage(null);
      }, 3000);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeToUndo((action) => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      setUndoAction(action);
      setUndoToastMessage(null);
      undoTimerRef.current = setTimeout(() => {
        setUndoAction(null);
      }, 5000);
    });

    return () => {
      unsubscribe();
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const hasRunInitRef = useRef(false);

  useEffect(() => {
    if (!hasRunInitRef.current) {
      hasRunInitRef.current = true;
      initApp();
    }

    const handleOnlineEvent = async () => {
      // When connection returns, re-check restore if local DB was empty
      try {
        const restoreRes = await restoreRemoteDataIfLocalEmpty();
        if (restoreRes.restored || !restoreRes.offlineEmptyWarning) {
          setOfflineEmptyWarning(false);
        }
      } catch {}
    };

    window.addEventListener('online', handleOnlineEvent);
    return () => window.removeEventListener('online', handleOnlineEvent);
  }, []);

  // Synchronize dark mode class on root HTML element
  useEffect(() => {
    const applyTheme = () => {
      const isDark = localStorage.getItem('goted_dark_mode') === 'true';
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();
    window.addEventListener('goted_settings_changed', applyTheme);
    window.addEventListener('storage', applyTheme);
    return () => {
      window.removeEventListener('goted_settings_changed', applyTheme);
      window.removeEventListener('storage', applyTheme);
    };
  }, []);

  const initApp = async () => {
    try {
      setLoading(true);

      // 1. Initialize IndexedDB default accounts and configuration
      await initializeLocalDatabase();

      // Automated fixed asset depreciation check on app load (runs once per session)
      try {
        await runDepreciationOnAppLoad();
      } catch (err) {
        console.error('[The Goated Farm] Automated depreciation on app load error:', err);
      }

      // Automated recurring expense check on app load
      try {
        await checkAndPostRecurringExpenses();
      } catch (err) {
        console.error('[The Goated Farm] Recurring expense check on app load error:', err);
      }

      // 2. Run accounting integrity regression tests in background
      runRegressionTests().then((testRes) => {
        setRegressionTestResult(testRes);
        if (testRes.success) {
          console.log(`[The Goated Farm] Accounting regression test suite passed (${testRes.passed}/${testRes.total} assertions).`);
        } else {
          console.error('[The Goated Farm] Regression test failures:', testRes.failures);
        }
      });

      // 3. Ensure system config for The Goated Farm
      const boot = await checkSystemBootstrap();
      setSystemConfig(boot.config);

      // 4. Check for active session in Firebase Auth or local verified session
      const initialProfile = await resolveUserRole(auth.currentUser);
      if (initialProfile.isApproved && initialProfile.role === 'OWNER') {
        // Silently pull down and restore cloud data if local DB has 0 records
        const restoreRes = await restoreRemoteDataIfLocalEmpty(initialProfile.email);
        if (restoreRes.offlineEmptyWarning) {
          setOfflineEmptyWarning(true);
        } else {
          setOfflineEmptyWarning(false);
        }
        setUserProfile(initialProfile);
        setCurrentUser(auth.currentUser);
        await seedSystemConfigIfNecessary();
        triggerForegroundDueTodayNotification().catch(() => {});
      }

      // 5. Firebase Auth state listener
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          setCurrentUser(user);
          const prof = await resolveUserRole(user);
          if (prof.isApproved && prof.role === 'OWNER') {
            const restoreRes = await restoreRemoteDataIfLocalEmpty(prof.email);
            if (restoreRes.offlineEmptyWarning) {
              setOfflineEmptyWarning(true);
            } else {
              setOfflineEmptyWarning(false);
            }
          }
          setUserProfile(prof);
          if (prof.isApproved) {
            await seedSystemConfigIfNecessary();
          }
        } else {
          // If no Firebase Auth user, check if we have a verified local session
          const fallbackProf = await resolveUserRole(null);
          if (fallbackProf.isApproved && fallbackProf.role === 'OWNER') {
            const restoreRes = await restoreRemoteDataIfLocalEmpty(fallbackProf.email);
            if (restoreRes.offlineEmptyWarning) {
              setOfflineEmptyWarning(true);
            } else {
              setOfflineEmptyWarning(false);
            }
            setUserProfile(fallbackProf);
          } else {
            setCurrentUser(null);
            setUserProfile(null);
          }
        }
      });

      // 6. Background synchronization listener
      listenToOnlineSync(
        (st) => setSyncState(st),
        (cnt) => setPendingCount(cnt)
      );
    } catch (err) {
      console.error('Initialization error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutOwner();
    setCurrentUser(null);
    setUserProfile(null);
  };

  const handleSyncNow = async () => {
    setSyncState('SYNCING');
    await synchronizePendingData();
    setSyncState(navigator.onLine ? 'ONLINE' : 'OFFLINE');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-6 text-slate-800">
        <div className="w-12 h-12 border-4 border-[#1E5128] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-base font-bold text-slate-900">The Goated Farm ইআরপি ডাটাবেজ প্রস্তুত হচ্ছে...</p>
        <p className="text-sm text-slate-600 mt-1">অফলাইন-ফার্স্ট হিসাবরক্ষণ ও সমন্বিত খামার ইঞ্জিন লোড হচ্ছে</p>
      </div>
    );
  }

  // If not logged in as an approved Owner, show single-tenant OTP Login Screen
  if (!userProfile || !userProfile.isApproved || userProfile.role !== 'OWNER') {
    return (
      <div className="min-h-screen relative bg-[#F8F9FA] dark:bg-slate-950">
        <PatternBackground />
        <LoginScreen
          onLoginSuccess={async (profile) => {
            const restoreRes = await restoreRemoteDataIfLocalEmpty(profile.email);
            if (restoreRes.offlineEmptyWarning) {
              setOfflineEmptyWarning(true);
            } else {
              setOfflineEmptyWarning(false);
            }
            setUserProfile(profile);
            const boot = await checkSystemBootstrap();
            if (boot.config) setSystemConfig(boot.config);
            await seedSystemConfigIfNecessary();
            triggerForegroundDueTodayNotification().catch(() => {});
            checkAndPostRecurringExpenses().catch(() => {});
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-slate-950 text-[#111827] dark:text-slate-100 flex flex-col antialiased selection:bg-[#1E5128] selection:text-white transition-colors relative">
      {/* Fixed subtle decorative background pattern sitting behind all screens */}
      <PatternBackground />

      {/* Sticky Top Header */}
      <Header
        userProfile={userProfile}
        systemConfig={systemConfig}
        syncState={syncState}
        pendingCount={pendingCount}
        regressionTestResult={regressionTestResult}
        activeTab={activeTab}
        onSyncNow={handleSyncNow}
        onLogout={handleLogout}
      />

      {/* Main App Content Viewport */}
      <main className="flex-1 px-3.5 py-4 sm:px-6 sm:py-6 max-w-5xl w-full mx-auto pb-28 md:pb-12 relative z-10">
        <ErrorBoundary resetKey={activeTab}>
          {/* TASK 4: Clear warning when opened by known owner with empty local DB and no internet */}
          {offlineEmptyWarning && (
            <div
              id="empty-offline-restore-warning"
              role="alert"
              className="mb-5 p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 flex items-start gap-3.5 shadow-sm"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-800" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-amber-950">
                  ইন্টারনেট সংযোগ ছাড়া পুরোনো ডেটা পুনরুদ্ধার করা যাচ্ছে না, সংযুক্ত হলে আবার চেষ্টা করুন
                </h4>
                <p className="text-xs sm:text-sm text-amber-800 mt-1 font-medium">
                  (Cannot restore your old data without internet — try again once connected). আপনার ডিভাইসের স্টোরেজ খালি দেখাচ্ছে এবং ইন্টারনেট সংযোগ না থাকায় ক্লাউড ব্যাকআপ থেকে পূর্বের খামারের তথ্য নামিয়ে আনা সম্ভব হয়নি। ইন্টারনেট পেলে অ্যাপ স্বয়ংক্রিয়ভাবে ক্লাউড ডাটা পুনরুদ্ধার করবে।
                </p>
              </div>
            </div>
          )}
          {activeTab === 'dashboard' && (
            <Dashboard
              role={userProfile.role}
              onNavigate={handleNavigate}
              regressionTestResult={regressionTestResult}
            />
          )}

          {activeTab === 'accounting' && (
            <AccountingModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
            />
          )}

          {activeTab === 'operations' && (
            <FarmOperationsModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
              initialAnimalId={selectedAnimalIdForOps}
              onClearInitialAnimalId={() => setSelectedAnimalIdForOps(null)}
              initialAction={opsActionParams}
              onClearInitialAction={() => setOpsActionParams(null)}
            />
          )}

          {activeTab === 'commerce' && (
            <InventoryCommerceModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
            />
          )}

          {activeTab === 'finance' && (
            <BankingInvestorsModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
            />
          )}

          {activeTab === 'reports' && (
            <ReportsModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
            />
          )}

          {activeTab === 'more' && (
            <MoreModule
              role={userProfile.role}
              currentUserId={userProfile.uid}
              systemConfig={systemConfig}
              userEmail={userProfile.email}
              onLogout={handleLogout}
              onNavigate={setActiveTab}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* Persistent Bottom Mobile Navigation Bar */}
      <MobileBottomNav activeTab={activeTab} onChangeTab={setActiveTab} />

      {/* Global 5-second Undo Toast Notification */}
      {undoAction && (
        <div
          id="toast-undo-container"
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div
            onClick={handlePerformUndo}
            className="flex items-center gap-3 px-4 sm:px-5 py-3 bg-gray-900/95 dark:bg-slate-900/95 text-white rounded-full shadow-2xl border border-gray-700/80 dark:border-slate-700 cursor-pointer hover:bg-black transition-all active:scale-95 select-none"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs sm:text-sm font-medium">যোগ করা হয়েছে —</span>
            <button
              id="btn-undo-toast"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePerformUndo();
              }}
              className="text-amber-300 hover:text-amber-200 font-bold text-xs sm:text-sm underline underline-offset-4 cursor-pointer flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>আনডু (Added — Undo)</span>
            </button>
          </div>
        </div>
      )}

      {/* Post-Undo Feedback Confirmation */}
      {undoToastMessage && (
        <div
          id="toast-undo-feedback"
          role="status"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-800 text-white text-xs sm:text-sm font-medium rounded-full shadow-xl border border-emerald-600">
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>{undoToastMessage}</span>
          </div>
        </div>
      )}

      {/* Global Spring Checkmark Success Animation */}
      <SuccessAnimationToast />

      {/* Auto-posted Recurring Expenses Toast Confirmation */}
      {recurringToastMessage && (
        <div
          id="toast-recurring-expense"
          role="status"
          aria-live="polite"
          className="fixed top-16 md:top-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-3 duration-200 max-w-lg w-[92%]"
        >
          <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 bg-[#1E5128] text-white rounded-2xl shadow-2xl border border-emerald-600">
            <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
            <div className="flex-1 text-xs sm:text-sm font-medium leading-snug">
              {recurringToastMessage}
            </div>
            <button
              id="btn-close-recurring-toast"
              type="button"
              onClick={() => setRecurringToastMessage(null)}
              className="text-emerald-200 hover:text-white p-1 rounded-lg transition-colors cursor-pointer shrink-0"
              aria-label="বন্ধ করুন"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
