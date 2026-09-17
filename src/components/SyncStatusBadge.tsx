import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { SyncState } from '../types';
import { listenToOnlineSync, synchronizePendingData } from '../firebase/firebaseClient';

interface Props {
  syncState?: SyncState;
  pendingCount?: number;
  onSyncNow?: () => void;
}

export const SyncStatusBadge: React.FC<Props> = ({
  syncState: propSyncState,
  pendingCount: propPendingCount,
  onSyncNow: propOnSyncNow
}) => {
  const [internalSyncState, setInternalSyncState] = useState<SyncState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'OFFLINE' : 'ONLINE'
  );
  const [internalPendingCount, setInternalPendingCount] = useState<number>(0);

  const hasProps = propSyncState !== undefined;
  const currentSyncState = hasProps ? propSyncState : internalSyncState;
  const currentPendingCount = hasProps ? (propPendingCount ?? 0) : internalPendingCount;

  // If props are not passed, listen autonomously to network and sync changes
  useEffect(() => {
    if (hasProps) return;
    const unsubscribe = listenToOnlineSync(
      (state) => setInternalSyncState(state),
      (count) => setInternalPendingCount(count)
    );
    return () => unsubscribe();
  }, [hasProps]);

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const isOffline = !isOnline || currentSyncState === 'OFFLINE';
  const isSyncing = currentSyncState === 'SYNCING';

  const handleSyncClick = async () => {
    if (isSyncing || isOffline) return;
    if (propOnSyncNow) {
      propOnSyncNow();
    } else {
      setInternalSyncState('SYNCING');
      try {
        await synchronizePendingData();
        setInternalSyncState(navigator.onLine ? 'ONLINE' : 'OFFLINE');
      } catch {
        setInternalSyncState('SYNC_FAILED');
      }
    }
  };

  return (
    <button
      id="sync-status-badge"
      type="button"
      onClick={handleSyncClick}
      disabled={isSyncing || isOffline}
      title={
        isOffline
          ? 'বর্তমানে অফলাইন — সংযোগ এলে স্বয়ংক্রিয়ভাবে সিঙ্ক হবে'
          : isSyncing
          ? 'সার্ভারে ডেটা সিঙ্ক হচ্ছে...'
          : 'সিঙ্ক সম্পন্ন (ট্যাপ করে পুনরায় যাচাই করুন)'
      }
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all cursor-pointer min-h-[36px] shadow-xs active:scale-95 ${
        isOffline
          ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
          : isSyncing
          ? 'bg-blue-50 text-blue-900 border-blue-300 animate-pulse'
          : 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-emerald-100/60'
      }`}
    >
      {isOffline ? (
        <>
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="whitespace-nowrap font-semibold">অফলাইন</span>
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
          <span className="whitespace-nowrap font-semibold">সিঙ্ক হচ্ছে</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
          <span className="whitespace-nowrap font-semibold">
            সিঙ্ক সম্পন্ন{currentPendingCount > 0 ? ` (${currentPendingCount})` : ''}
          </span>
        </>
      )}
    </button>
  );
};
