import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  auth,
  checkSystemBootstrap,
  initializeLocalDatabase,
  listenToOnlineSync,
  resolveUserRole,
  synchronizePendingData
} from './firebase/firebaseClient';
import { ActiveTab, MobileBottomNav } from './components/MobileBottomNav';
import { Header } from './components/Header';
import { BootstrapOwner } from './components/BootstrapOwner';
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

export default function App() {
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>('ONLINE');
  const [pendingCount, setPendingCount] = useState(0);

  // Active Tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    try {
      setLoading(true);
      // Initialize IndexedDB default accounts
      await initializeLocalDatabase();

      // Run accounting and transaction regression tests in the background to guarantee 100% integrity
      runRegressionTests().then((testRes) => {
        if (testRes.success) {
          console.log(`[Agro ERP] Regression test suite passed (${testRes.passed}/${testRes.total} assertions).`);
        } else {
          console.error('[Agro ERP] Regression test failures:', testRes.failures);
        }
      });

      // Check if farm has an owner configured
      const boot = await checkSystemBootstrap();
      setBootstrapped(boot.isBootstrapped);
      if (boot.config) {
        setSystemConfig(boot.config);
      }

      // Check local storage for authenticated session
      const localUserRaw = localStorage.getItem('local_auth_user');
      if (localUserRaw) {
        try {
          const localUser = JSON.parse(localUserRaw);
          setCurrentUser(localUser as any);
          const prof = await resolveUserRole(localUser as any);
          setUserProfile(prof);
        } catch (e) {
          console.error('Error parsing local auth user:', e);
        }
      }

      // Firebase Auth listener
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          setCurrentUser(user);
          const prof = await resolveUserRole(user);
          setUserProfile(prof);
          localStorage.removeItem('local_auth_user');
        } else {
          const checkLocal = localStorage.getItem('local_auth_user');
          if (!checkLocal) {
            setCurrentUser(null);
            setUserProfile(null);
          }
        }
      });

      // Background Sync Listener
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

  const handleBootstrapped = async (config: SystemConfig) => {
    setSystemConfig(config);
    setBootstrapped(true);
    const prof = await resolveUserRole(auth.currentUser);
    setUserProfile(prof);
  };

  const handleLogout = async () => {
    localStorage.removeItem('local_auth_user');
    await signOut(auth);
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
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold">কৃষি খামার ইআরপি ডাটাবেজ লোড হচ্ছে...</p>
        <p className="text-xs text-slate-500 mt-1">অফলাইন-ফার্স্ট ক্যাশ ও হিসাবরক্ষণ ইঞ্জিন প্রস্তুত হচ্ছে</p>
      </div>
    );
  }

  // STEP 1: If not bootstrapped, require Owner Initialization
  if (bootstrapped === false) {
    return <BootstrapOwner onBootstrapped={handleBootstrapped} />;
  }

  // STEP 2: If not logged in, show Login Screen
  if (!currentUser || !userProfile || userProfile.role === 'UNAUTHENTICATED') {
    return (
      <LoginScreen
        onLoginSuccess={async () => {
          const boot = await checkSystemBootstrap();
          if (boot.config) setSystemConfig(boot.config);

          const localRaw = localStorage.getItem('local_auth_user');
          if (localRaw) {
            const parsed = JSON.parse(localRaw);
            setCurrentUser(parsed as any);
            const prof = await resolveUserRole(parsed as any);
            setUserProfile(prof);
          } else {
            const user = auth.currentUser;
            setCurrentUser(user);
            const prof = await resolveUserRole(user);
            setUserProfile(prof);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-emerald-600 selection:text-white">
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
      <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto">
        {activeTab === 'dashboard' && (
          <Dashboard
            role={userProfile.role}
            onNavigate={(tab) => setActiveTab(tab)}
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
          />
        )}
      </main>

      {/* Persistent Bottom Mobile Navigation Bar */}
      <MobileBottomNav activeTab={activeTab} onChangeTab={setActiveTab} />
    </div>
  );
}
