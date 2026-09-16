import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  auth,
  checkSystemBootstrap,
  initializeLocalDatabase,
  listenToOnlineSync,
  resolveUserRole,
  seedSystemConfigIfNecessary,
  synchronizePendingData
} from './firebase/firebaseClient';
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

export default function App() {
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

      // 1. Initialize IndexedDB default accounts and configuration
      await initializeLocalDatabase();

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
        setUserProfile(initialProfile);
        setCurrentUser(auth.currentUser);
        await seedSystemConfigIfNecessary();
      }

      // 5. Firebase Auth state listener
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          setCurrentUser(user);
          const prof = await resolveUserRole(user);
          setUserProfile(prof);
          if (prof.isApproved) {
            await seedSystemConfigIfNecessary();
          }
        } else {
          // If no Firebase Auth user, check if we have a verified local session
          const fallbackProf = await resolveUserRole(null);
          if (fallbackProf.isApproved && fallbackProf.role === 'OWNER') {
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
          setUserProfile(profile);
          const boot = await checkSystemBootstrap();
          if (boot.config) setSystemConfig(boot.config);
          await seedSystemConfigIfNecessary();
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
