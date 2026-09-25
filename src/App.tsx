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
import { AnimalEvent, SyncState, SystemConfig, UserProfile } from './types';
import { getLatestRegressionTestResult, TestResult } from './utils/regressionTests';
import { triggerForegroundDueTodayNotification, checkHasAnyFarmData } from './db/indexedDb';
import { cleanupLeakedRegressionTestData } from './utils/cleanupTestData';
import { ErrorBoundary } from './components/ErrorBoundary';
import { subscribeToUndo, executeUndo, UndoableAction } from './services/undoService';
import { PatternBackground } from './components/ui/PatternBackground';
import { SuccessAnimationToast } from './components/ui/SuccessAnimation';
import { WelcomeScreen } from './components/WelcomeScreen';

export default function App() {
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState<boolean>(false);
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

  const evaluateWelcomeScreen = async () => {
    try {
      if (localStorage.getItem('goted_welcome_dismissed') === 'true') {
        setShowWelcome(false);
        return;
      }
      const hasData = await checkHasAnyFarmData();
      if (hasData) {
        setShowWelcome(false);
        return;
      }
      setShowWelcome(true);
    } catch {
      setShowWelcome(false);
    }
  };

  const handleDismissWelcome = () => {
    try {
      localStorage.setItem('goted_welcome_dismissed', 'true');
    } catch {}
    setShowWelcome(false);
    setActiveTab('dashboard');
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

      // One-time startup scan to remove any leaked regression test records from IndexedDB
      await cleanupLeakedRegressionTestData();

      // 2. Ensure system config for The Goated Farm
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
        await evaluateWelcomeScreen();
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
            await evaluateWelcomeScreen();
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
            await evaluateWelcomeScreen();
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
    setShowWelcome(false);
  };

  const handleSyncNow = async () => {
    setSyncState('SYNCING');
    try {
      const syncRes = await synchronizePendingData();
      if (syncRes.errors && syncRes.errors.length > 0) {
        setSyncState('SYNC_FAILED');
      } else {
        setSyncState(navigator.onLine ? 'ONLINE' : 'OFFLINE');
      }
    } catch {
      setSyncState('SYNC_FAILED');
    }
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
            await evaluateWelcomeScreen();
            setUserProfile(profile);
            const boot = await checkSystemBootstrap();
            if (boot.config) setSystemConfig(boot.config);
            await seedSystemConfigIfNecessary();
            triggerForegroundDueTodayNotification().catch(() => {});
          }}
        />
      </div>
    );
  }

  // One-time Welcome screen shown only when the app detects genuinely zero data exists
  if (showWelcome) {
    return (
      <div className="min-h-screen relative bg-[#F8F9FA] dark:bg-slate-950 text-[#111827] dark:text-slate-100 flex flex-col antialiased selection:bg-[#1E5128] selection:text-white transition-colors">
        <PatternBackground />
        <WelcomeScreen
          onDismiss={handleDismissWelcome}
          onLogout={handleLogout}
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
      <main className="flex-1 px-3 py-3.5 sm:px-6 sm:py-6 max-w-5xl w-full mx-auto pb-28 md:pb-12 relative z-10 min-w-0">
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
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm sm:w-auto animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div
            onClick={handlePerformUndo}
            className="flex items-center justify-between sm:justify-center gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-2.5 sm:py-3 bg-gray-900/95 dark:bg-slate-900/95 text-white rounded-full shadow-2xl border border-gray-700/80 dark:border-slate-700 cursor-pointer hover:bg-black transition-all active:scale-95 select-none"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs sm:text-sm font-medium truncate">যোগ করা হয়েছে —</span>
            <button
              id="btn-undo-toast"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePerformUndo();
              }}
              className="text-amber-300 hover:text-amber-200 font-bold text-xs sm:text-sm underline underline-offset-4 cursor-pointer flex items-center gap-1.5 transition-colors shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>আনডু (Undo)</span>
            </button>
          </div>
        </div>
      )}

      {/* Post-Undo Feedback Confirmation */}
      {undoToastMessage && (
        <div
          id="toast-undo-feedback"
          role="status"
          className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm sm:w-auto animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-800 text-white text-xs sm:text-sm font-medium rounded-full shadow-xl border border-emerald-600 text-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
            <span className="truncate">{undoToastMessage}</span>
          </div>
        </div>
      )}

      {/* Global Spring Checkmark Success Animation */}
      <SuccessAnimationToast />
    </div>
  );
}
