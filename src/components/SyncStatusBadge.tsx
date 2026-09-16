import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { SyncState } from '../types';

interface Props {
  syncState: SyncState;
  pendingCount: number;
  onSyncNow: () => void;
}

export const SyncStatusBadge: React.FC<Props> = ({ syncState, pendingCount, onSyncNow }) => {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <button
      onClick={onSyncNow}
      disabled={syncState === 'SYNCING'}
      title="ট্যাপ করে ডেটা সিঙ্ক করুন (Tap to synchronize)"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all cursor-pointer min-h-[40px] shadow-xs active:scale-95 ${
        !isOnline
          ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
          : syncState === 'SYNCING'
          ? 'bg-blue-50 text-blue-800 border-blue-300 animate-pulse'
          : pendingCount > 0
          ? 'bg-orange-50 text-orange-800 border-orange-300 hover:bg-orange-100'
          : 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-emerald-100/60'
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>অফলাইন</span>
        </>
      ) : syncState === 'SYNCING' ? (
        <>
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
          <span>সিঙ্ক হচ্ছে...</span>
        </>
      ) : pendingCount > 0 ? (
        <>
          <AlertCircle className="w-4 h-4 text-orange-600 shrink-0" />
          <span>{pendingCount} অপেক্ষমাণ</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
          <span>সিঙ্কড</span>
        </>
      )}
    </button>
  );
};

