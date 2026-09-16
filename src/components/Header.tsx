import React from 'react';
import { Shield, LogOut, Sprout } from 'lucide-react';
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
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200 text-gray-900 pt-safe px-3.5 sm:px-6 py-2.5 shadow-xs">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
        {/* Left: Brand / Farm Info */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#1E5128] flex items-center justify-center shadow-sm shrink-0">
            <Sprout className="w-5 h-5 text-white" />
          </div>
          <div className="truncate">
            <h1 className="text-[15px] sm:text-base font-bold text-gray-900 tracking-tight leading-tight truncate">
              {systemConfig?.companyName || 'The Goated Farm'}
            </h1>
            <p className="text-[13px] text-[#1E5128] font-semibold truncate">
              সমন্বিত খামার ও হিসাবরক্ষণ
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
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#1E5128] border border-[#BBF7D0]">
            <Shield className="w-3.5 h-3.5 text-[#1E5128]" />
            <span>মালিক (OWNER)</span>
          </span>

          {/* User & Logout */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2">
            <span
              title={userProfile.email || 'Owner'}
              className="text-xs text-gray-600 max-w-[120px] sm:max-w-[180px] truncate font-medium hidden md:inline-block"
            >
              {userProfile.email || userProfile.displayName || 'Owner'}
            </span>
            <button
              id="btn-header-logout"
              onClick={onLogout}
              title="এই ডিভাইস থেকে লগ আউট করুন (Log out this device)"
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors cursor-pointer min-h-[44px] flex items-center justify-center gap-1.5 active:scale-95 text-xs font-bold"
            >
              <LogOut className="w-4 h-4 text-red-600" />
              <span className="hidden md:inline">লগ আউট</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
