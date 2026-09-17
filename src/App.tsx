import React, { useEffect, useState } from 'react';
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
import { AlertTriangle } from 'lucide-react';
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
import { SyncState, SystemConfig, UserProfile } from './types';
import { runRegressionTests } from './tests/regressionTests';
import { triggerForegroundDueTodayNotification } from './db/indexedDb';
import { runDepreciationOnAppLoad } from './accounting/depreciationService';

export default function App() {
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>('ONLINE');
  const [pendingCount, setPendingCount] = useState(0);

  // Active Tab & Cross-Tab Navigation Params
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedAnimalIdForOps, setSelectedAnimalIdForOps] = useState<string | null>(null);
  const [offlineEmptyWarning, setOfflineEmptyWarning] = useState<boolean>(false);

  const handleNavigate = (tab: ActiveTab, animalId?: string) => {
    setActiveTab(tab);
    if (tab === 'operations' && animalId) {
      setSelectedAnimalIdForOps(animalId);
    }
  };

  useEffect(() => {
    initApp();

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

      // 2. Run accounting integrity regression tests in background
      runRegressionTests().then((testRes) => {
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
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#111827] flex flex-col antialiased selection:bg-[#1E5128] selection:text-white">
      {/* Sticky Top Header */}
      <Header
        userProfile={userProfile}
        systemConfig={systemConfig}
        syncState={syncState}
        pendingCount={pendingCount}
        onSyncNow={handleSyncNow}
        onLogout={handleLogout}
      />

      {/* Main App Content Viewport */}
      <main className="flex-1 px-3.5 py-4 sm:px-6 sm:py-6 max-w-5xl w-full mx-auto pb-28 md:pb-12">
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
          />
        )}
      </main>

      {/* Persistent Bottom Mobile Navigation Bar */}
      <MobileBottomNav activeTab={activeTab} onChangeTab={setActiveTab} />
    </div>
  );
}
