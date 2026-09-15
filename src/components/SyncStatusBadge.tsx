import React from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { SyncState } from '../types';

interface Props {
  syncState: SyncState;
  pendingCount: number;
  onSyncNow: () => void;
}

export const SyncStatusBadge: React.FC<Props> = ({ syncState, pendingCount, onSyncNow }) => {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onSyncNow}
        disabled={syncState === 'SYNCING'}
        title="সিঙ্ক করুন (Click to synchronize)"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
          !isOnline
            ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
            : syncState === 'SYNCING'
            ? 'bg-blue-900/30 text-blue-300 border-blue-700/50 animate-pulse'
            : pendingCount > 0
            ? 'bg-orange-900/30 text-orange-300 border-orange-700/50'
            : 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50'
        }`}
      >
        {!isOnline ? (
          <>
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            <span>অফলাইন (OFFLINE)</span>
          </>
        ) : syncState === 'SYNCING' ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
            <span>সিঙ্ক হচ্ছে...</span>
          </>
        ) : pendingCount > 0 ? (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
            <span>{pendingCount} অপেক্ষমাণ (PENDING)</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>সিঙ্কড (SYNCED)</span>
          </>
        )}
      </button>
    </div>
  );
};
