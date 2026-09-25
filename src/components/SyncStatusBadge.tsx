import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const isFailed = currentSyncState === 'SYNC_FAILED' || currentSyncState === 'ERROR';

  const handleSyncClick = async () => {
    if (isSyncing || isOffline) return;
    if (propOnSyncNow) {
      propOnSyncNow();
    } else {
      setInternalSyncState('SYNCING');
      try {
        const syncRes = await synchronizePendingData();
        if (syncRes.errors && syncRes.errors.length > 0) {
          setInternalSyncState('SYNC_FAILED');
        } else {
          setInternalSyncState(navigator.onLine ? 'ONLINE' : 'OFFLINE');
        }
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
          : isFailed
          ? 'ক্লাউড পারসিস্টেন্স ব্যর্থ হয়েছে। ডেটা ডিভাইসে নিরাপদে আছে (ট্যাপ করে পুনরায় চেষ্টা করুন)'
          : 'সিঙ্ক সম্পন্ন (ট্যাপ করে পুনরায় যাচাই করুন)'
      }
      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-xs sm:text-[13px] font-medium border transition-all cursor-pointer min-h-[34px] sm:min-h-[36px] shadow-xs active:scale-95 shrink-0 ${
        isOffline
          ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
          : isSyncing
          ? 'bg-blue-50 text-blue-900 border-blue-300 animate-pulse'
          : isFailed
          ? 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100'
          : 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-emerald-100/60'
      }`}
    >
      {isOffline ? (
        <>
          <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="whitespace-nowrap font-medium text-xs">অফলাইন</span>
        </>
      ) : isSyncing ? (
        <>
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0" />
          <span className="whitespace-nowrap font-medium text-xs">সিঙ্ক হচ্ছে</span>
        </>
      ) : isFailed ? (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span className="whitespace-nowrap font-medium text-xs">
            {currentPendingCount > 0 ? `সিঙ্ক ব্যর্থ (${currentPendingCount})` : 'সিঙ্ক ব্যর্থ'}
          </span>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
          <span className="whitespace-nowrap font-medium text-xs">সিঙ্ক সম্পন্ন</span>
        </>
      )}
    </button>
  );
};
