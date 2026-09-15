import React from 'react';
import { Shield, ShieldAlert, LogOut, Sprout } from 'lucide-react';
import { SyncState, SystemConfig, UserProfile } from '../types';
import { SyncStatusBadge } from './SyncStatusBadge';

interface Props {
  userProfile: UserProfile;
  systemConfig: SystemConfig | null;
  syncState: SyncState;
  pendingCount: number;
  onSyncNow: () => void;
  onLogout: () => void;
  onOpenProfile?: () => void;
}

export const Header: React.FC<Props> = ({
  userProfile,
  systemConfig,
  syncState,
  pendingCount,
  onSyncNow,
  onLogout
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-white pt-safe px-3 sm:px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
        {/* Left: Brand / Farm Info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-900/40 shrink-0">
            <Sprout className="w-5 h-5 text-white" />
          </div>
          <div className="truncate">
            <h1 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight leading-tight truncate">
              {systemConfig?.companyName || 'সমন্বিত কৃষি খামার (Agro ERP)'}
            </h1>
            <p className="text-[11px] text-emerald-400 font-medium truncate">
              বাংলাদেশ সমন্বিত খামার ইআরপি
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

          {/* Role Badge */}
          {userProfile.role === 'OWNER' ? (
            <span className="hidden xs:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
              <Shield className="w-3 h-3 text-emerald-400" />
              <span>মালিক (OWNER)</span>
            </span>
          ) : userProfile.role === 'VIEWER' ? (
            <span className="hidden xs:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-950/80 text-sky-300 border border-sky-800">
              <ShieldAlert className="w-3 h-3 text-sky-400" />
              <span>পরিদর্শক (VIEWER)</span>
            </span>
          ) : null}

          {/* User & Logout */}
          <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2">
            <span
              title={userProfile.email || userProfile.phoneNumber || 'User'}
              className="text-xs text-slate-400 max-w-[90px] sm:max-w-[140px] truncate hidden md:inline-block"
            >
              {userProfile.displayName || userProfile.email || 'ব্যবহারকারী'}
            </span>
            <button
              onClick={onLogout}
              title="লগআউট করুন (Logout)"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
