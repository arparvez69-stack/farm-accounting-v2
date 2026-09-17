import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  PlusCircle,
  Clock,
  FileText,
  Calendar,
  CheckCircle2,
  Check,
  SkipForward,
  ChevronRight,
  Syringe,
  Stethoscope,
  ShoppingBag,
  Bell,
  Download,
  RefreshCw,
  X,
  HardDriveDownload
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { ActiveTab } from './MobileBottomNav';
import { Reminder, UserRole } from '../types';
import { createFullJsonBackup, getLastSyncTime, getLastExportTime } from '../services/exportService';
import { synchronizePendingData } from '../firebase/firebaseClient';

interface Props {
  role: UserRole;
  onNavigate: (tab: ActiveTab, animalId?: string) => void;
  onOpenQuickVoucher?: () => void;
}

export const Dashboard: React.FC<Props> = ({ role, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [netProfit, setNetProfit] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const [arBalance, setArBalance] = useState(0);
  const [apBalance, setApBalance] = useState(0);
  const [inventoryValue, setInventoryValue] = useState(0);

  const [animalCount, setAnimalCount] = useState(0);
  const [fishBatchCount, setFishBatchCount] = useState(0);
  const [cropCycleCount, setCropCycleCount] = useState(0);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [isAccountingBalanced, setIsAccountingBalanced] = useState(true);

  // Backup & sync reminder banner state
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('goted_backup_reminder_dismissed') === 'true';
    } catch {
      return false;
    }
  });
  const [syncingNow, setSyncingNow] = useState(false);
  const [exportingNow, setExportingNow] = useState(false);
  const [lastSyncTimeVal, setLastSyncTimeVal] = useState<string | null>(() => getLastSyncTime());
  const [lastExportTimeVal, setLastExportTimeVal] = useState<string | null>(() => getLastExportTime());

  useEffect(() => {
    const handleUpdate = () => {
      setLastSyncTimeVal(getLastSyncTime());
      setLastExportTimeVal(getLastExportTime());
    };
    window.addEventListener('goted-sync-time-updated', handleUpdate);
    window.addEventListener('goted-export-time-updated', handleUpdate);
    return () => {
      window.removeEventListener('goted-sync-time-updated', handleUpdate);
      window.removeEventListener('goted-export-time-updated', handleUpdate);
    };
  }, []);

  const nowMs = Date.now();
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  const isSyncOverdue = !lastSyncTimeVal || (nowMs - new Date(lastSyncTimeVal).getTime() > FIVE_DAYS_MS);
  const isExportOverdue = !lastExportTimeVal || (nowMs - new Date(lastExportTimeVal).getTime() > FOURTEEN_DAYS_MS);
  const showBackupReminder = !bannerDismissed && (isSyncOverdue || isExportOverdue);

  const handleDismissBanner = () => {
    try {
      sessionStorage.setItem('goted_backup_reminder_dismissed', 'true');
    } catch {}
    setBannerDismissed(true);
  };

  const handleTriggerCloudSync = async () => {
    try {
      setSyncingNow(true);
      await synchronizePendingData();
      setLastSyncTimeVal(getLastSyncTime());
    } catch (err) {
      console.warn('Sync error from dashboard reminder:', err);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleTriggerManualDownload = async () => {
    try {
      setExportingNow(true);
      await createFullJsonBackup();
      setLastExportTimeVal(getLastExportTime());
    } catch (err) {
      console.error('Manual download error:', err);
    } finally {
      setExportingNow(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Financials via Double-Entry Engine
      const pl = await generateProfitLoss();
      setNetProfit(pl.netProfit);
      setTotalRevenue(pl.totalRevenue);
      setTotalExpenses(pl.totalOperatingExpenses + pl.totalCogs + pl.totalOtherExpenses);

      // Trial balance check
      const tb = await generateTrialBalance();
      setIsAccountingBalanced(tb.isBalanced);

      // Cash & Bank balances
      const cashBank = await db.cashBankAccounts.toArray();
      let cash = 0;
      let bank = 0;
      for (const cb of cashBank) {
        if (cb.accountType === 'CASH') cash += cb.currentBalance;
        if (cb.accountType === 'BANK' || cb.accountType === 'MOBILE_BANKING') bank += cb.currentBalance;
      }
      setCashBalance(cash);
      setBankBalance(bank);

      // AR & AP from Parties
      const parties = await db.parties.toArray();
      let ar = 0;
      let ap = 0;
      for (const p of parties) {
        if (p.type === 'CUSTOMER' && p.balance > 0) ar += p.balance;
        if (p.type === 'SUPPLIER' && p.balance > 0) ap += p.balance;
      }
      setArBalance(ar);
      setApBalance(ap);

      // Inventory valuation
      const items = await db.inventoryItems.toArray();
      let invTotal = 0;
      const lowStockAlerts: string[] = [];
      for (const it of items) {
        invTotal += it.currentStock * it.avgCostPrice;
        if (it.currentStock <= it.reorderLevel) {
          lowStockAlerts.push(`${it.nameBn} মজুদ কমে গেছে (স্টক: ${it.currentStock} ${it.unit})`);
        }
      }
      setInventoryValue(invTotal);

      // Counts
      const animals = await db.animals.where('status').equals('ACTIVE').count();
      setAnimalCount(animals);

      const fish = await db.fishBatches.where('status').equals('ACTIVE').count();
      setFishBatchCount(fish);

      const crops = await db.cropCycles.where('status').equals('GROWING').count();
      setCropCycleCount(crops);

      // Reminders: PENDING that are overdue or due within 7 days, soonest first
      const today = new Date();
      const in7Days = new Date(today.getTime() + 7 * 86400000);
      const in7DaysStr = in7Days.toISOString().split('T')[0];

      // If reminders table is empty, seed initial realistic reminders
      const reminderCount = await db.reminders.count();
      if (reminderCount === 0) {
        const todayDate = new Date();
        const tomorrow = new Date(todayDate.getTime() + 86400000).toISOString().split('T')[0];
        const in3Days = new Date(todayDate.getTime() + 3 * 86400000).toISOString().split('T')[0];
        const in5Days = new Date(todayDate.getTime() + 5 * 86400000).toISOString().split('T')[0];

        try {
          await db.reminders.bulkPut([
            {
              id: 'rem-seed-1',
              animalId: 'COW-101',
              title: 'TAG-101: ক্ষুরা রোগ (FMD) পরবর্তী বুস্টার ডোজ',
              category: 'VACCINE',
              dueDate: in3Days,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              synced: false
            },
            {
              id: 'rem-seed-2',
              title: 'পশু খাদ্য ও সাইলেজ সংগ্রহের জন্য বাজার সফর',
              category: 'MARKET',
              dueDate: tomorrow,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              synced: false
            },
            {
              id: 'rem-seed-3',
              animalId: 'BULL-102',
              title: 'TAG-102: কৃমিনাশক ও ওজন পরিমাপ ফলোআপ',
              category: 'TREATMENT',
              dueDate: in5Days,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              synced: false
            }
          ]);
        } catch (seedErr) {
          console.warn('Initial reminders seed note:', seedErr);
        }
      }

      const allPendingReminders = await db.reminders
        .where('status')
        .equals('PENDING')
        .toArray();

      const dueThisWeek = allPendingReminders
        .filter((r) => r.dueDate <= in7DaysStr)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)); // soonest first

      setReminders(dueThisWeek);

      // Recent Journal entries
      const recentJ = await db.journalEntries.orderBy('date').reverse().limit(6).toArray();
      setRecentTransactions(recentJ);

      // System alerts
      const activeAlerts: string[] = [...lowStockAlerts];
      if (!tb.isBalanced) {
        activeAlerts.push(`হিসাব ভারসাম্যহীন (Trial Balance Difference: ৳${tb.difference})`);
      }
      if (tb.hasInvalidAccounts) {
        activeAlerts.push(`অবৈধ হিসাব শনাক্ত হয়েছে: ${tb.orphanAccounts.join(', ')}`);
      }
      if (cash < 0) {
        activeAlerts.push('নগদ তহবিল ঋণাত্মক (Negative Cash Balance)! দ্রুত সমন্বয় করুন।');
      }
      if (bank < 0) {
        activeAlerts.push('ব্যাংক হিসাব ঋণাত্মক (Negative Bank Balance)!');
      }
      setAlerts(activeAlerts);
    } catch (e) {
      console.error('Failed to load dashboard:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDone = async (reminderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.reminders.update(reminderId, { status: 'DONE' });
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    } catch (err) {
      console.error('Failed to mark reminder done:', err);
    }
  };

  const handleSkip = async (reminderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.reminders.update(reminderId, { status: 'SKIPPED' });
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    } catch (err) {
      console.error('Failed to skip reminder:', err);
    }
  };

  const handleRowClick = (reminder: Reminder) => {
    if (reminder.animalId) {
      onNavigate('operations', reminder.animalId);
    }
  };

  const fmtMoney = (val: number) => `৳${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const todayStr = new Date().toISOString().split('T')[0];
  const todayTime = new Date(todayStr).getTime();

  return (
    <div className="space-y-5 pb-6 max-w-5xl mx-auto">
      {/* TASK 3: Dismissible Reminder Banner if > 5 days since sync or > 14 days since manual export */}
      {showBackupReminder && (
        <div
          id="backup-reminder-banner"
          role="alert"
          className="relative p-4 sm:p-5 rounded-2xl bg-amber-50/95 border-2 border-amber-300 text-amber-950 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3.5 pr-6 sm:pr-0">
            <div className="w-10 h-10 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0 shadow-2xs">
              <HardDriveDownload className="w-5 h-5 text-amber-800" />
            </div>
            <div>
              <h4 className="font-bold text-[15px] sm:text-base text-amber-950 leading-snug">
                আপনার খামারের হিসাব সুরক্ষিত রাখতে নিয়মিত ক্লাউড সিঙ্ক অথবা ব্যাকআপ ডাউনলোড করুন
              </h4>
              <p className="text-xs sm:text-[13px] text-amber-800 mt-1 font-medium">
                (Sync to cloud or download backup to keep your farm data safe) • 
                {isSyncOverdue && ' ক্লাউড সিঙ্ক ৫ দিনের বেশি পুরোনো'}
                {isSyncOverdue && isExportOverdue && ' ও '}
                {isExportOverdue && ' ফাইল ব্যাকআপ ১৪ দিনের বেশি পুরোনো'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <button
              id="btn-reminder-sync"
              onClick={handleTriggerCloudSync}
              disabled={syncingNow}
              className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-[13px] font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer min-h-[40px] active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
              <span>{syncingNow ? 'সিঙ্ক হচ্ছে...' : 'ক্লাউড সিঙ্ক'}</span>
            </button>
            <button
              id="btn-reminder-download-backup"
              onClick={handleTriggerManualDownload}
              disabled={exportingNow}
              className="px-3.5 py-2 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 border border-amber-400 text-xs sm:text-[13px] font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer min-h-[40px] active:scale-95 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5 text-amber-800" />
              <span>{exportingNow ? 'ডাউনলোড হচ্ছে...' : 'ব্যাকআপ ডাউনলোড'}</span>
            </button>
            <button
              id="btn-reminder-dismiss"
              onClick={handleDismissBanner}
              aria-label="Dismiss banner"
              title="বন্ধ করুন (Dismiss)"
              className="p-2 rounded-xl text-amber-800 hover:bg-amber-200 transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 0. PROMINENT DUE THIS WEEK (এই সপ্তাহে করণীয়) CARD AT THE TOP */}
      <div className="bg-white rounded-2xl border-2 border-emerald-600/30 p-4 sm:p-5 shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#1E5128] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  এই সপ্তাহে করণীয় (Due This Week)
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  reminders.length > 0
                    ? 'bg-emerald-100 text-[#1E5128] border border-emerald-200'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {reminders.length}টি পেন্ডিং
                </span>
              </div>
              <p className="text-xs sm:text-[13px] text-gray-600">
                টিকা, চিকিৎসা ফলোআপ ও খামার পরিচালনার জরুরি সময়সূচি (বকেয়া ও আগামী ৭ দিন)
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('operations')}
            className="text-xs sm:text-[13px] font-bold text-[#1E5128] hover:text-[#173F1F] flex items-center gap-1 self-start sm:self-auto cursor-pointer"
          >
            <span>খামার কার্যক্রমে যান</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {reminders.length === 0 ? (
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-center flex flex-col items-center justify-center py-6 text-gray-600 space-y-1.5">
            <CheckCircle2 className="w-7 h-7 text-[#15803D]" />
            <p className="text-[14px] font-semibold text-gray-900">
              এই সপ্তাহে কোনো বকেয়া বা জরুরি করণীয় কাজ নেই!
            </p>
            <p className="text-xs text-gray-500">
              খামারের সকল পশু টিকা ও চিকিৎসা সময়সূচি হালনাগাদ রয়েছে।
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reminders.map((rem) => {
              const dueTime = new Date(rem.dueDate).getTime();
              const diffDays = Math.round((dueTime - todayTime) / 86400000);
              const isOverdue = diffDays < 0;
              const isToday = diffDays === 0;

              let catBadge = {
                label: 'অন্যান্য',
                bg: 'bg-gray-100 text-gray-700 border-gray-200',
                icon: Clock
              };
              if (rem.category === 'VACCINE') {
                catBadge = {
                  label: 'টিকা (Vaccine)',
                  bg: 'bg-blue-50 text-blue-700 border-blue-200',
                  icon: Syringe
                };
              } else if (rem.category === 'TREATMENT') {
                catBadge = {
                  label: 'চিকিৎসা (Treatment)',
                  bg: 'bg-purple-50 text-purple-700 border-purple-200',
                  icon: Stethoscope
                };
              } else if (rem.category === 'MARKET') {
                catBadge = {
                  label: 'বাজার / হাট (Market)',
                  bg: 'bg-amber-50 text-amber-800 border-amber-200',
                  icon: ShoppingBag
                };
              }

              const CatIcon = catBadge.icon;

              return (
                <div
                  key={rem.id}
                  onClick={() => handleRowClick(rem)}
                  className={`p-3 sm:p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isOverdue
                      ? 'bg-red-50/50 border-red-200'
                      : isToday
                      ? 'bg-amber-50/50 border-amber-300'
                      : 'bg-white border-gray-200 hover:border-[#1E5128]/50'
                  } ${rem.animalId ? 'cursor-pointer hover:shadow-xs group' : ''}`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${catBadge.bg}`}>
                        <CatIcon className="w-3 h-3 shrink-0" />
                        <span>{catBadge.label}</span>
                      </span>

                      {isOverdue && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-100 text-red-800 border border-red-300 animate-pulse">
                          মেয়াদোত্তীর্ণ ({Math.abs(diffDays)} দিন আগে)
                        </span>
                      )}

                      {isToday && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
                          আজকের কাজ (Due Today)
                        </span>
                      )}

                      {!isOverdue && !isToday && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-[#15803D] border border-emerald-200">
                          {diffDays === 1 ? 'আগামীকাল' : `${diffDays} দিন বাকি`}
                        </span>
                      )}

                      <span className="text-[12px] text-gray-500 font-mono">
                        তারিখ: {rem.dueDate}
                      </span>
                    </div>

                    <div className="font-bold text-[14px] sm:text-[15px] text-gray-900 leading-snug">
                      {rem.title}
                    </div>

                    {rem.animalId && (
                      <div className="text-[12px] text-[#1E5128] font-semibold flex items-center gap-1 group-hover:underline">
                        <span>পশু আইডি: {rem.animalId}</span>
                        <span className="text-gray-400 font-normal">| বিস্তারিত ও ইতিহাস দেখতে ট্যাপ করুন →</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons: Mark Done & Skip (without leaving card) */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleMarkDone(rem.id, e)}
                      title="কাজটি সম্পন্ন হিসেবে চিহ্নিত করুন"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-[12px] font-bold shadow-xs active:scale-95 transition-all cursor-pointer min-h-[36px]"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0 stroke-[3]" />
                      <span>সম্পন্ন</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleSkip(rem.id, e)}
                      title="এই কাজটি এড়িয়ে যান"
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-[12px] font-semibold active:scale-95 transition-all cursor-pointer min-h-[36px]"
                    >
                      <SkipForward className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                      <span>এড়িয়ে যান</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 1. Top Executive Banner & Hero Balances */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                খামার সার্বিক চিত্র
              </h2>
              {isAccountingBalanced && (
                <span className="inline-flex items-center gap-1 text-[13px] px-2.5 py-0.5 rounded-full bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] font-semibold">
                  দ্বৈত-দাখিলা নির্ভুল
                </span>
              )}
            </div>
            <p className="text-[14px] text-gray-600 mt-1">
              রিয়েল-টাইম হিসাবরক্ষণ, গবাদিপশু, মৎস্য ও শস্যের সার্বিক অবস্থা
            </p>
          </div>

          {/* Quick Action Dock for Owner */}
          {role === 'OWNER' && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => onNavigate('accounting')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[14px] font-bold shadow-xs transition-all active:scale-95 cursor-pointer min-h-[44px]"
              >
                <PlusCircle className="w-4 h-4" />
                <span>নতুন ভাউচার</span>
              </button>
              <button
                onClick={() => onNavigate('commerce')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 border border-gray-200 text-[14px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer min-h-[44px]"
              >
                <FileText className="w-4 h-4" />
                <span>বিক্রয় / চালান</span>
              </button>
            </div>
          )}
        </div>

        {/* Hero 2 Key Metrics (Total Liquidity & Net Margin) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          {/* Liquidity (Cash + Bank) */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200/80">
            <div className="flex items-center justify-between text-[14px] text-gray-600 font-medium">
              <span>তরল তহবিল (নগদ ও ব্যাংক)</span>
              <div className="p-2 rounded-lg bg-blue-100/80 text-blue-700">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mt-1">
              {fmtMoney(cashBalance + bankBalance)}
            </div>
            <div className="flex items-center gap-3 text-[13px] text-gray-600 mt-2 pt-2 border-t border-gray-200/60 font-medium">
              <span>ক্যাশ: <strong className="text-gray-900">{fmtMoney(cashBalance)}</strong></span>
              <span>•</span>
              <span>ব্যাংক: <strong className="text-gray-900">{fmtMoney(bankBalance)}</strong></span>
            </div>
          </div>

          {/* Net Profit / Margin */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200/80">
            <div className="flex items-center justify-between text-[14px] text-gray-600 font-medium">
              <span>নিট লাভ / ক্ষতি (Net Profit)</span>
              <div className={`p-2 rounded-lg ${netProfit >= 0 ? 'bg-emerald-100/80 text-[#15803D]' : 'bg-red-100/80 text-[#C2410C]'}`}>
                {netProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-extrabold tracking-tight mt-1 ${netProfit >= 0 ? 'text-[#15803D]' : 'text-[#C2410C]'}`}>
              {fmtMoney(netProfit)}
            </div>
            <div className="text-[13px] text-gray-600 mt-2 pt-2 border-t border-gray-200/60 font-medium">
              চলতি হিসাবকাল অনুযায়ী দ্বৈত-দাখিলা মুনাফা
            </div>
          </div>
        </div>
      </div>

      {/* 2. System Alerts Section (if active) */}
      {alerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 shadow-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-[15px] text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <span>জরুরি সতর্কতা ({alerts.length} টি)</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-[14px] text-amber-900 pl-1">
            {alerts.map((alt, idx) => (
              <li key={idx} className="leading-snug">{alt}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Secondary Revenue, Expense & Working Capital */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Revenue */}
        <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between text-[13px] text-gray-600 font-medium">
            <span>মোট রাজস্ব / আয়</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 text-[#15803D]">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-gray-900 tracking-tight mt-1.5">
            {fmtMoney(totalRevenue)}
          </div>
          <p className="text-[13px] text-gray-600 mt-1">পশু, মাছ, দুধ ও ফসল বিক্রয়</p>
        </div>

        {/* Total Expenses */}
        <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between text-[13px] text-gray-600 font-medium">
            <span>মোট খরচ ও COGS</span>
            <div className="p-1.5 rounded-lg bg-rose-50 text-[#C2410C]">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-bold text-gray-900 tracking-tight mt-1.5">
            {fmtMoney(totalExpenses)}
          </div>
          <p className="text-[13px] text-gray-600 mt-1">খাবার, ওষুধ ও পরিচালন ব্যয়</p>
        </div>

        {/* AR (Receivable) */}
        <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-xs">
          <div className="text-[13px] text-gray-600 font-medium">কাস্টমারদের কাছে পাওনা</div>
          <div className="text-xl font-bold text-sky-700 tracking-tight mt-1.5">
            {fmtMoney(arBalance)}
          </div>
          <p className="text-[13px] text-gray-600 mt-1">বকেয়া বিক্রয় বিল</p>
        </div>

        {/* AP (Payable) */}
        <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-xs">
          <div className="text-[13px] text-gray-600 font-medium">সাপ্লায়ার দেনা (AP)</div>
          <div className="text-xl font-bold text-amber-700 tracking-tight mt-1.5">
            {fmtMoney(apBalance)}
          </div>
          <p className="text-[13px] text-gray-600 mt-1">খাবার ও কাঁচামাল দেনা</p>
        </div>
      </div>

      {/* 4. Live Farm Biological Assets (Operations) */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#1E5128]" />
            <h3 className="text-[16px] sm:text-[17px] font-bold text-gray-900">
              খামারের বর্তমান জৈব সম্পদ সূচক
            </h3>
          </div>
          <button
            onClick={() => onNavigate('operations')}
            className="text-[14px] text-[#1E5128] hover:underline font-bold cursor-pointer py-1 px-2"
          >
            বিস্তারিত →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Livestock */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 hover:border-[#1E5128]/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 font-medium">সক্রিয় গবাদিপশু</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{animalCount} টি</div>
            <div className="text-[13px] font-semibold text-[#1E5128] mt-1">গরু ও ছাগল পালনে সক্রিয়</div>
          </div>

          {/* Fisheries */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 hover:border-[#1E5128]/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 font-medium">সক্রিয় মাছের ব্যাচ</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{fishBatchCount} টি</div>
            <div className="text-[13px] font-semibold text-sky-700 mt-1">পুকুরভিত্তিক মাছ চাষ</div>
          </div>

          {/* Crops */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 hover:border-[#1E5128]/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 font-medium">চলতি শস্য ও ঘাস চক্র</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{cropCycleCount} টি</div>
            <div className="text-[13px] font-semibold text-amber-700 mt-1">নেপিয়ার ঘাস ও মৌসুমী ফসল</div>
          </div>
        </div>
      </div>

      {/* 5. Recent Posted Financial Transactions */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            <h3 className="text-[16px] sm:text-[17px] font-bold text-gray-900">
              সাম্প্রতিক জাবেদা লেনদেন
            </h3>
          </div>
          <button
            onClick={() => onNavigate('accounting')}
            className="text-[14px] text-[#1E5128] hover:underline font-bold cursor-pointer py-1 px-2"
          >
            সকল জাবেদা →
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-[14px]">
            এখনও কোন আর্থিক লেনদেন লিপিবদ্ধ করা হয়নি। "নতুন ভাউচার" দিয়ে শুরু করুন।
          </div>
        ) : (
          <div className="space-y-2.5">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                onClick={() => onNavigate('accounting')}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] border border-gray-200 hover:border-gray-300 hover:bg-gray-50/80 transition-all cursor-pointer gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[#1E5128] font-bold text-[14px]">
                      {tx.voucherNumber}
                    </span>
                    <span className="text-[12px] font-semibold px-2 py-0.5 rounded-md bg-white border border-gray-200 text-gray-700">
                      {tx.voucherType}
                    </span>
                    <span className="text-gray-500 text-[13px]">{tx.date}</span>
                  </div>
                  <p className="text-gray-800 text-[14px] truncate mt-1">
                    {tx.narration || 'কোন বিবরণ নেই'}
                  </p>
                </div>
                <div className="text-left sm:text-right shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-gray-200/50">
                  <div className="font-bold text-[16px] text-gray-900">
                    {fmtMoney(tx.totalDebit)}
                  </div>
                  <div className="text-[12px] text-gray-500 font-medium">ডেবিট = ক্রেডিট</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
