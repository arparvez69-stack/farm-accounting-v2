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
  HardDriveDownload,
  Droplets
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { ActiveTab } from './MobileBottomNav';
import { Reminder, UserRole, InventoryItem } from '../types';
import { createFullJsonBackup, getLastSyncTime, getLastExportTime } from '../services/exportService';
import { auth, synchronizePendingData } from '../firebase/firebaseClient';
import { useLanguage } from '../i18n/translations';
import { runRegressionTests, getLatestRegressionTestResult, TestResult } from '../utils/regressionTests';
import { Card } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';
import { IconTile } from './ui/IconTile';
import { EmptyState } from './ui/EmptyState';
import { triggerSuccessAnimation } from './ui/SuccessAnimation';

interface LowFeedItemInfo {
  item: InventoryItem;
  currentStock: number;
  threshold: number;
  unit: string;
  isCustomThreshold: boolean;
}

interface Props {
  role: UserRole;
  onNavigate: (
    tab: ActiveTab,
    animalId?: string,
    action?: { openActivityModal?: boolean; eventType?: 'FEED' | 'MILK' | 'VACCINE' | 'TREATMENT' | 'WEIGHT' }
  ) => void;
  onOpenQuickVoucher?: () => void;
  regressionTestResult?: TestResult | null;
}

export const Dashboard: React.FC<Props> = ({ role, onNavigate, regressionTestResult }) => {
  const { lang, t } = useLanguage();
  const [testResult, setTestResult] = useState<TestResult | null>(() => regressionTestResult || getLatestRegressionTestResult());
  const [showTestModal, setShowTestModal] = useState(false);
  const [isRerunningTests, setIsRerunningTests] = useState(false);
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

  // Low feed stock warnings and threshold setting
  const [lowFeedItems, setLowFeedItems] = useState<LowFeedItemInfo[]>([]);
  const [editingThresholdItem, setEditingThresholdItem] = useState<InventoryItem | null>(null);
  const [editThresholdValue, setEditThresholdValue] = useState<string>('');

  // Low Cash Alert Threshold (default: 5000)
  const [lowCashThreshold, setLowCashThreshold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('goted_low_cash_alert_threshold');
      if (saved !== null && !isNaN(Number(saved))) {
        return Number(saved);
      }
    } catch {}
    return 5000;
  });

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
    if (regressionTestResult) {
      setTestResult(regressionTestResult);
    }
  }, [regressionTestResult]);

  useEffect(() => {
    const handleTestsFinished = (e: Event) => {
      const customEvent = e as CustomEvent<TestResult>;
      if (customEvent.detail) {
        setTestResult(customEvent.detail);
      }
    };
    window.addEventListener('regression-tests-finished', handleTestsFinished);
    return () => window.removeEventListener('regression-tests-finished', handleTestsFinished);
  }, []);

  const handleRerunTestsInDashboard = async () => {
    setIsRerunningTests(true);
    try {
      const res = await runRegressionTests();
      setTestResult(res);
    } catch (err) {
      console.error('Error re-running regression tests:', err);
    } finally {
      setIsRerunningTests(false);
    }
  };

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
    const handleDataChanged = () => {
      loadDashboardData();
    };
    const handleSettingsChanged = () => {
      try {
        const saved = localStorage.getItem('goted_low_cash_alert_threshold');
        if (saved !== null && !isNaN(Number(saved))) {
          setLowCashThreshold(Number(saved));
        } else {
          setLowCashThreshold(5000);
        }
      } catch {}
    };
    window.addEventListener('goted_data_changed', handleDataChanged);
    window.addEventListener('goted_settings_changed', handleSettingsChanged);
    window.addEventListener('storage', handleSettingsChanged);
    return () => {
      window.removeEventListener('goted_data_changed', handleDataChanged);
      window.removeEventListener('goted_settings_changed', handleSettingsChanged);
      window.removeEventListener('storage', handleSettingsChanged);
    };
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

      // Inventory valuation & low feed stock checking
      const items = await db.inventoryItems.toArray();
      let invTotal = 0;
      const lowStockAlerts: string[] = [];
      const lowFeeds: LowFeedItemInfo[] = [];

      for (const it of items) {
        invTotal += it.currentStock * it.avgCostPrice;
        if (it.currentStock <= it.reorderLevel) {
          lowStockAlerts.push(`${it.nameBn} মজুদ কমে গেছে (স্টক: ${it.currentStock} ${it.unit})`);
        }

        // Low feed stock calculation per item
        if (it.category === 'FEED' || it.category === 'FEED_STOCK') {
          const restockBase = (it.lastRestockAmount && it.lastRestockAmount > 0)
            ? it.lastRestockAmount
            : (it.currentStock > 0 ? it.currentStock : (it.reorderLevel ? it.reorderLevel * 5 : 100));
          const defaultThreshold = Math.round(restockBase * 0.20 * 100) / 100;
          const hasCustomThreshold = it.lowStockThreshold != null && it.lowStockThreshold >= 0;
          const effectiveThreshold = hasCustomThreshold ? (it.lowStockThreshold as number) : defaultThreshold;

          if (it.currentStock <= effectiveThreshold) {
            lowFeeds.push({
              item: it,
              currentStock: it.currentStock,
              threshold: effectiveThreshold,
              unit: it.unit || 'কেজি',
              isCustomThreshold: hasCustomThreshold
            });
          }
        }
      }
      setInventoryValue(invTotal);
      setLowFeedItems(lowFeeds);

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
      const target = reminders.find((r) => r.id === reminderId);
      await db.reminders.update(reminderId, { status: 'DONE', synced: false });
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
      triggerSuccessAnimation('রিমাইন্ডার সম্পন্ন হয়েছে!', target?.title || 'রিমাইন্ডার সম্পন্ন হিসেবে চিহ্নিত করা হয়েছে');
    } catch (err) {
      console.error('Failed to mark reminder done:', err);
    }
  };

  const handleSkip = async (reminderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.reminders.update(reminderId, { status: 'SKIPPED', synced: false });
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

  const handleSaveThreshold = async (item: InventoryItem, newThreshold: number) => {
    try {
      await db.inventoryItems.update(item.id, {
        lowStockThreshold: newThreshold,
        reorderLevel: newThreshold,
        synced: false
      });
      setEditingThresholdItem(null);
      window.dispatchEvent(new CustomEvent('goted_data_changed'));
      await loadDashboardData();
    } catch (err) {
      console.error('Failed to update feed stock threshold:', err);
    }
  };

  const fmtMoney = (val: number) => `৳${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const todayStr = new Date().toISOString().split('T')[0];
  const todayTime = new Date(todayStr).getTime();

  const combinedCashBankBalance = cashBalance + bankBalance;
  const isLowCash = !loading && (combinedCashBankBalance < lowCashThreshold);

  // Owner greeting & time of day
  const [ownerName, setOwnerName] = useState<string>('আতিকুর রহমান');

  useEffect(() => {
    const fetchOwnerName = async () => {
      try {
        if (auth.currentUser?.displayName) {
          setOwnerName(auth.currentUser.displayName);
          return;
        }
        if (auth.currentUser?.email) {
          const emailPrefix = auth.currentUser.email.split('@')[0];
          const cleanName = emailPrefix.replace(/[0-9_.-]+$/, '');
          setOwnerName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
          return;
        }
        const configs = await db.systemConfig.toArray();
        if (configs.length > 0) {
          if (configs[0].companyName) {
            setOwnerName(configs[0].companyName);
            return;
          }
          if (configs[0].ownerEmail) {
            const emailPrefix = configs[0].ownerEmail.split('@')[0];
            const cleanName = emailPrefix.replace(/[0-9_.-]+$/, '');
            setOwnerName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
            return;
          }
        }
      } catch (err) {
        console.warn('Could not determine owner name for greeting:', err);
      }
    };
    fetchOwnerName();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'শুভ সকাল';
    if (hour >= 12 && hour < 17) return 'শুভ দুপুর';
    return 'শুভ সন্ধ্যা';
  };

  const getFormattedDate = () => {
    try {
      const now = new Date();
      return new Intl.DateTimeFormat('bn-BD', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(now);
    } catch {
      return new Date().toLocaleDateString();
    }
  };

  const overdueRemindersCount = reminders.filter((r) => {
    const diffDays = Math.round((new Date(r.dueDate).getTime() - todayTime) / 86400000);
    return diffDays < 0;
  }).length;

  const dueTodayRemindersCount = reminders.filter((r) => {
    const diffDays = Math.round((new Date(r.dueDate).getTime() - todayTime) / 86400000);
    return diffDays === 0;
  }).length;

  const totalDueOrOverdue = overdueRemindersCount + dueTodayRemindersCount;

  return (
    <div className="space-y-5 pb-6 max-w-5xl mx-auto rounded-3xl p-2 sm:p-4 bg-gradient-to-b from-emerald-500/[0.06] via-green-500/[0.02] to-transparent dark:from-emerald-950/20 dark:via-emerald-950/5 dark:to-transparent">
      {/* 1. GREETING HEADER & HERO ILLUSTRATION AT THE TOP */}
      <div id="dashboard-greeting-header" className="pt-1 pb-0.5 space-y-3">
        <div
          className="w-full h-48 sm:h-56 flex justify-center items-center overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
          }}
        >
          <img
            src="/illustrations/Farmer-pana.svg"
            alt="Farmer illustration"
            loading="lazy"
            className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-slate-100 tracking-tight leading-tight">
              {getGreeting()}, {ownerName}!
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-slate-400 font-medium mt-1">
              {getFormattedDate()}
            </p>
          </div>
        </div>
      </div>

      {/* 2. SUMMARY CARD (STATIC VARIANT) */}
      <Card
        id="dashboard-cash-reminders-summary-card"
        variant="static"
        padding="md"
        className="border-gray-200/90 dark:border-slate-800"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-[#1E5128] dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/60 flex items-center justify-center shrink-0 shadow-2xs">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs sm:text-[13px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider block">
                {lang === 'en' ? "Today's Cash + Bank Balance" : 'আজকের মোট নগদ ও ব্যাংক তহবিল'}
              </span>
              <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-slate-100 tracking-tight leading-tight mt-0.5">
                {fmtMoney(combinedCashBankBalance)}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 mt-1 font-medium">
                <span>নগদ: {fmtMoney(cashBalance)}</span>
                <span>•</span>
                <span>ব্যাংক: {fmtMoney(bankBalance)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center sm:justify-end border-t sm:border-t-0 sm:border-l border-gray-100 dark:border-slate-800/80 pt-3 sm:pt-0 sm:pl-6">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-900/50">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 block">
                  {lang === 'en' ? 'Due / Overdue Reminders' : 'জরুরি রিমাইন্ডার (আজ ও বকেয়া)'}
                </span>
                <div className="text-sm sm:text-[15px] font-bold text-gray-800 dark:text-slate-200 mt-0.5">
                  {totalDueOrOverdue > 0 ? (
                    <span className="text-amber-700 dark:text-amber-400">
                      {overdueRemindersCount > 0 && `${overdueRemindersCount}টি বিলম্বিত (Overdue)`}
                      {overdueRemindersCount > 0 && dueTodayRemindersCount > 0 && ', '}
                      {dueTodayRemindersCount > 0 && `${dueTodayRemindersCount}টি আজ করণীয়`}
                    </span>
                  ) : (
                    <span className="text-[#15803D] dark:text-emerald-400 font-semibold">
                      {lang === 'en' ? 'No urgent reminders today' : 'আজ বা বকেয়া কোনো তাগিদ নেই (সব ঠিক আছে)'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
      {/* LOW CASH ALERT WARNING BANNER */}
      {isLowCash && (
        <div
          id="low-cash-alert-banner"
          role="alert"
          className="relative p-4 sm:p-5 rounded-2xl bg-rose-50/95 dark:bg-rose-950/40 border-2 border-rose-400 dark:border-rose-600 text-rose-950 dark:text-rose-100 shadow-sm space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-200 dark:bg-rose-800/80 text-rose-900 dark:text-rose-200 flex items-center justify-center shrink-0 shadow-2xs">
                <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-300" />
              </div>
              <div>
                <h4 className="font-bold text-[15px] sm:text-base text-rose-950 dark:text-rose-100 leading-snug">
                  নগদ সতর্কতা সীমা সতর্কতা (Low Cash Balance Alert)
                </h4>
                <p className="text-xs sm:text-[13px] text-rose-800 dark:text-rose-200 mt-0.5 font-medium">
                  সম্মিলিত নগদ ও ব্যাংক জমার ব্যালেন্স নির্ধারিত সতর্কতা সীমার নিচে নেমে গেছে। জরুরি পরিচালন ব্যয়ের জন্য তহবিল বৃদ্ধি করুন।
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                id="btn-nav-to-banking"
                onClick={() => onNavigate('finance')}
                className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs sm:text-[13px] font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 min-h-[38px]"
              >
                <Wallet className="w-4 h-4" />
                <span>তহবিল ও ব্যাংক হিসাব দেখুন</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/85 border border-rose-300 dark:border-rose-700/60 shadow-2xs">
              <div className="text-[11px] text-gray-500 dark:text-slate-400">বর্তমান সম্মিলিত নগদ ও ব্যাংক তহবিল:</div>
              <div className="text-base font-extrabold text-rose-600 dark:text-rose-400 mt-0.5 font-mono">
                {fmtMoney(combinedCashBankBalance)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/85 border border-rose-300 dark:border-rose-700/60 shadow-2xs">
              <div className="text-[11px] text-gray-500 dark:text-slate-400">নির্ধারিত সতর্কতা সীমা:</div>
              <div className="text-base font-extrabold text-gray-900 dark:text-slate-100 mt-0.5 font-mono">
                {fmtMoney(lowCashThreshold)}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/85 border border-rose-300 dark:border-rose-700/60 shadow-2xs">
              <div className="text-[11px] text-gray-500 dark:text-slate-400">তহবিল ঘাটতি (Shortfall):</div>
              <div className="text-base font-extrabold text-amber-700 dark:text-amber-400 mt-0.5 font-mono">
                {fmtMoney(Math.max(0, lowCashThreshold - combinedCashBankBalance))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 0. LOW FEED STOCK WARNING BANNER */}
      {lowFeedItems.length > 0 && (
        <div
          id="low-feed-stock-banner"
          role="alert"
          className="relative p-4 sm:p-5 rounded-2xl bg-amber-50/95 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-600 text-amber-950 dark:text-amber-100 shadow-sm space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-200 dark:bg-amber-800/80 text-amber-900 dark:text-amber-200 flex items-center justify-center shrink-0 shadow-2xs">
                <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300" />
              </div>
              <div>
                <h4 className="font-bold text-[15px] sm:text-base text-amber-950 dark:text-amber-100 leading-snug">
                  ফিড স্টক কমতির সতর্কতা (Low Feed Stock Warning)
                </h4>
                <p className="text-xs sm:text-[13px] text-amber-800 dark:text-amber-200 mt-0.5 font-medium">
                  {lowFeedItems.length}টি ফিড আইটেমের বর্তমান মজুদ নির্ধারিত সতর্কতার সীমার নিচে নেমে গেছে।
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                id="btn-nav-to-commerce-inventory"
                onClick={() => onNavigate('commerce')}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs sm:text-[13px] font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5 min-h-[38px]"
              >
                <span>ইনভেন্টরিতে স্টক যুক্ত করুন</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
            {lowFeedItems.map(({ item, currentStock, threshold, unit, isCustomThreshold }) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl bg-white/90 dark:bg-slate-900/85 border border-amber-300/80 dark:border-amber-700/60 flex flex-col justify-between gap-2.5 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h5 className="font-bold text-[14px] text-gray-900 dark:text-slate-100">{item.nameBn}</h5>
                    <span className="text-[11px] text-gray-500 font-mono">{item.code}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 shrink-0">
                    মজুদ কম
                  </span>
                </div>

                <div className="flex items-end justify-between gap-2 pt-2 border-t border-gray-100 dark:border-slate-800 text-xs">
                  <div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">বর্তমান স্টক:</div>
                    <div className="text-base font-extrabold text-rose-600 dark:text-rose-400">
                      {currentStock} {unit}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">
                      সতর্কতা সীমা:{' '}
                      <strong className="text-gray-900 dark:text-slate-200 font-bold">
                        {threshold} {unit}
                      </strong>
                      <span className="text-[10px] text-gray-400 block">
                        {isCustomThreshold ? '(কাস্টম সীমা)' : '(রিস্টকের ২০%)'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingThresholdItem(item);
                        setEditThresholdValue(threshold.toString());
                      }}
                      className="text-[11px] font-bold text-[#1E5128] dark:text-emerald-400 hover:underline mt-1 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>সীমা নির্ধারণ</span>
                      <span>✏️</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                {t('dashboard.backupReminder')}
              </h4>
              <p className="text-xs sm:text-[13px] text-amber-800 mt-1 font-medium">
                {t('dashboard.backupReminderSub')} • 
                {isSyncOverdue && ` ${t('dashboard.syncOverdue')}`}
                {isSyncOverdue && isExportOverdue && ' • '}
                {isExportOverdue && ` ${t('dashboard.exportOverdue')}`}
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
              <span>{syncingNow ? t('dashboard.syncing') : t('btn.sync')}</span>
            </button>
            <button
              id="btn-reminder-download-backup"
              onClick={handleTriggerManualDownload}
              disabled={exportingNow}
              className="px-3.5 py-2 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 border border-amber-400 text-xs sm:text-[13px] font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer min-h-[40px] active:scale-95 disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5 text-amber-800" />
              <span>{exportingNow ? t('dashboard.downloading') : t('btn.downloadBackup')}</span>
            </button>
            <button
              id="btn-reminder-dismiss"
              onClick={handleDismissBanner}
              aria-label="Dismiss banner"
              title={t('btn.dismiss')}
              className="p-2 rounded-xl text-amber-800 hover:bg-amber-200 transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 0. QUICK ACTIVITY ACTION BUTTONS WITH ICONTILE */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          id="btn-quick-feed-cost"
          type="button"
          onClick={() => onNavigate('operations', undefined, { openActivityModal: true, eventType: 'FEED' })}
          className="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/90 border border-gray-200/90 dark:border-slate-700 shadow-xs hover:shadow-md active:scale-[0.99] transition-all cursor-pointer text-left group min-h-[58px]"
        >
          <IconTile
            icon={PlusCircle}
            color="warning"
            size="md"
            rounded="xl"
          />
          <div className="min-w-0">
            <span className="block text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
              + ফিড খরচ
            </span>
            <span className="block text-xs text-gray-500 dark:text-slate-400 truncate">
              দৈনিক খাদ্য খরচ এন্ট্রি
            </span>
          </div>
        </button>

        <button
          id="btn-quick-milk-today"
          type="button"
          onClick={() => onNavigate('operations', undefined, { openActivityModal: true, eventType: 'MILK' })}
          className="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/90 border border-gray-200/90 dark:border-slate-700 shadow-xs hover:shadow-md active:scale-[0.99] transition-all cursor-pointer text-left group min-h-[58px]"
        >
          <IconTile
            icon={Droplets}
            color="info"
            size="md"
            rounded="xl"
          />
          <div className="min-w-0">
            <span className="block text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
              + আজকের দুধ
            </span>
            <span className="block text-xs text-gray-500 dark:text-slate-400 truncate">
              দুধ দোহন ও উৎপাদন হিসাব
            </span>
          </div>
        </button>

        <button
          id="btn-quick-vaccine"
          type="button"
          onClick={() => onNavigate('operations', undefined, { openActivityModal: true, eventType: 'VACCINE' })}
          className="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-800/90 border border-gray-200/90 dark:border-slate-700 shadow-xs hover:shadow-md active:scale-[0.99] transition-all cursor-pointer text-left group min-h-[58px]"
        >
          <IconTile
            icon={Syringe}
            color="success"
            size="md"
            rounded="xl"
          />
          <div className="min-w-0">
            <span className="block text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
              + ভ্যাকসিন
            </span>
            <span className="block text-xs text-gray-500 dark:text-slate-400 truncate">
              টিকা ও অ্যান্টিবায়োটিক প্রয়োগ
            </span>
          </div>
        </button>
      </div>

      {/* 0. PROMINENT DUE THIS WEEK (এই সপ্তাহে করণীয়) CARD AT THE TOP */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-emerald-600/30 dark:border-emerald-500/40 p-4 sm:p-5 shadow-sm space-y-3.5 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#1E5128] dark:bg-emerald-800 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                  <span>{t('dashboard.dueThisWeek')}</span>
                  <img
                    src="/illustrations/Checklist-bro.svg"
                    alt="Checklist icon"
                    loading="lazy"
                    className="w-6 h-6 object-contain pointer-events-none drop-shadow-xs inline-block"
                  />
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  reminders.length > 0
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-[#1E5128] dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400'
                }`}>
                  {reminders.length} {t('dashboard.pendingCount')}
                </span>
              </div>
              <p className="text-xs sm:text-[13px] text-gray-600 dark:text-slate-400">
                {lang === 'en'
                  ? 'Vaccine, treatment follow-up & farm operational schedule (overdue & next 7 days)'
                  : 'টিকা, চিকিৎসা ফলোআপ ও খামার পরিচালনার জরুরি সময়সূচি (বকেয়া ও আগামী ৭ দিন)'}
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigate('operations')}
            className="text-xs sm:text-[13px] font-bold text-[#1E5128] dark:text-emerald-400 hover:text-[#173F1F] dark:hover:text-emerald-300 flex items-center gap-1 self-start sm:self-auto cursor-pointer"
          >
            <span>{t('nav.operations')} →</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {reminders.length === 0 ? (
          <EmptyState
            id="empty-reminders-state"
            illustration="/illustrations/Checking_boxes-amico.svg"
            illustrationAlt="Checking boxes illustration"
            heading={lang === 'en' ? 'All Tasks Completed!' : 'সব কাজ সম্পন্ন!'}
            message={
              lang === 'en'
                ? 'All animal vaccination & medical treatment schedules are up to date.'
                : 'খামারের সকল পশু টিকা ও চিকিৎসা সময়সূচি হালনাগাদ রয়েছে।'
            }
            action={{
              label: lang === 'en' ? 'Manage Schedule' : 'সময়সূচি দেখুন',
              onClick: () => onNavigate('operations'),
              icon: Calendar,
            }}
          />
        ) : (
          <div className="space-y-2">
            {reminders.map((rem, idx) => {
              const dueTime = new Date(rem.dueDate).getTime();
              const diffDays = Math.round((dueTime - todayTime) / 86400000);
              const isOverdue = diffDays < 0;
              const isToday = diffDays === 0;

              let catBadge = {
                label: lang === 'en' ? 'Other' : 'অন্যান্য',
                bg: 'bg-gray-100 text-gray-700 border-gray-200',
                icon: Clock
              };
              if (rem.category === 'VACCINE') {
                catBadge = {
                  label: lang === 'en' ? 'Vaccine' : 'টিকা (Vaccine)',
                  bg: 'bg-blue-50 text-blue-700 border-blue-200',
                  icon: Syringe
                };
              } else if (rem.category === 'TREATMENT') {
                catBadge = {
                  label: lang === 'en' ? 'Treatment' : 'চিকিৎসা (Treatment)',
                  bg: 'bg-purple-50 text-purple-700 border-purple-200',
                  icon: Stethoscope
                };
              } else if (rem.category === 'MARKET') {
                catBadge = {
                  label: lang === 'en' ? 'Market' : 'বাজার / হাট (Market)',
                  bg: 'bg-amber-50 text-amber-800 border-amber-200',
                  icon: ShoppingBag
                };
              }

              const CatIcon = catBadge.icon;

              return (
                <div
                  key={rem.id}
                  onClick={() => handleRowClick(rem)}
                  style={{ animationDelay: `${Math.min(idx * 35, 240)}ms` }}
                  className={`p-3 sm:p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-slide-up ${
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

                      {/* StatusBadge: danger for overdue, warning for due-within-3-days, info for others */}
                      {isOverdue ? (
                        <StatusBadge
                          status="overdue"
                          label={`${t('dashboard.overdue')} (${Math.abs(diffDays)} ${lang === 'en' ? 'days ago' : 'দিন আগে'})`}
                        />
                      ) : diffDays <= 3 ? (
                        <StatusBadge
                          status="due-soon"
                          label={isToday ? t('dashboard.today') : diffDays === 1 ? t('dashboard.tomorrow') : `${diffDays} দিন বাকি`}
                        />
                      ) : (
                        <StatusBadge
                          status="info"
                          label={`${diffDays} ${t('dashboard.daysRemaining')}`}
                        />
                      )}

                      <span className="text-[12px] text-gray-500 font-mono">
                        {t('dashboard.date')} {rem.dueDate}
                      </span>
                    </div>

                    <div className="font-bold text-[14px] sm:text-[15px] text-gray-900 leading-snug">
                      {rem.title}
                    </div>

                    {rem.animalId && (
                      <div className="text-[12px] text-[#1E5128] font-semibold flex items-center gap-1 group-hover:underline">
                        <span>{t('dashboard.animalId')} {rem.animalId}</span>
                        <span className="text-gray-400 font-normal">{t('dashboard.viewDetails')}</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons: Mark Done & Skip (without leaving card) */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => handleMarkDone(rem.id, e)}
                      title="Mark as done"
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-[12px] font-bold shadow-xs active:scale-95 transition-all cursor-pointer min-h-[36px]"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0 stroke-[3]" />
                      <span>{t('btn.done')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleSkip(rem.id, e)}
                      title="Skip this item"
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-[12px] font-semibold active:scale-95 transition-all cursor-pointer min-h-[36px]"
                    >
                      <SkipForward className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                      <span>{t('btn.skip')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 1. Top Executive Banner & Hero Balances */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100 tracking-tight">
                {t('dashboard.title')}
              </h2>
              {isAccountingBalanced && (
                <span className="inline-flex items-center gap-1 text-[13px] px-2.5 py-0.5 rounded-full bg-[#F0FDF4] dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400 border border-[#BBF7D0] dark:border-emerald-800 font-semibold">
                  {t('dashboard.balanced')}
                </span>
              )}
            </div>
            <p className="text-[14px] text-gray-600 dark:text-slate-400 mt-1">
              {t('dashboard.subtitle')}
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
                <span>{t('btn.newVoucher')}</span>
              </button>
              <button
                onClick={() => onNavigate('commerce')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-200 border border-gray-200 dark:border-slate-700 text-[14px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer min-h-[44px]"
              >
                <FileText className="w-4 h-4" />
                <span>{t('btn.salesInvoice')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Hero 2 Key Metrics (Total Liquidity & Net Margin) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          {/* Liquidity (Cash + Bank) */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/80">
            <div className="flex items-center justify-between text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-semibold">
              <span>{t('dashboard.totalLiquidity')}</span>
              <div className="p-1.5 rounded-lg bg-blue-100/80 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-gray-900 dark:text-slate-100 tracking-tight mt-1.5">
              {fmtMoney(cashBalance + bankBalance)}
            </div>
            <div className="flex items-center gap-2.5 text-xs text-gray-500 dark:text-slate-400 mt-2 pt-2 border-t border-gray-200/60 dark:border-slate-700/60 font-medium">
              <span>{t('dashboard.cash')} <strong className="text-gray-900 dark:text-slate-200 font-mono tabular-nums">{fmtMoney(cashBalance)}</strong></span>
              <span>•</span>
              <span>{t('dashboard.bank')} <strong className="text-gray-900 dark:text-slate-200 font-mono tabular-nums">{fmtMoney(bankBalance)}</strong></span>
            </div>
          </div>

          {/* Net Profit / Margin */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/80">
            <div className="flex items-center justify-between text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-semibold">
              <span>{t('dashboard.netProfit')}</span>
              <div className={`p-1.5 rounded-lg ${netProfit >= 0 ? 'bg-emerald-100/80 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400' : 'bg-red-100/80 dark:bg-red-950/60 text-[#C2410C] dark:text-rose-400'}`}>
                {netProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              </div>
            </div>
            <div className={`text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight mt-1.5 ${netProfit >= 0 ? 'text-[#15803D] dark:text-emerald-400' : 'text-[#C2410C] dark:text-rose-400'}`}>
              {fmtMoney(netProfit)}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-2 pt-2 border-t border-gray-200/60 dark:border-slate-700/60 font-medium">
              {t('dashboard.netProfitNote')}
            </div>
          </div>
        </div>
      </div>

      {/* 2. System Alerts Section (if active) */}
      {testResult && !testResult.success && testResult.failures.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 text-amber-950 shadow-xs space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 animate-pulse" />
              <div>
                <h4 className="font-bold text-[15px] text-amber-950">
                  সিস্টেম পরীক্ষায় সমস্যা পাওয়া গেছে, বিস্তারিত দেখতে ট্যাপ করুন
                </h4>
                <p className="text-xs text-amber-800 font-medium mt-0.5">
                  (System check found an issue, tap for details) • {testResult.failures.length}টি পরীক্ষা ব্যর্থ হয়েছে
                </p>
              </div>
            </div>
            <button
              type="button"
              id="btn-dashboard-test-failures"
              onClick={() => setShowTestModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-950 border border-amber-400 text-xs font-bold transition-all cursor-pointer min-h-[36px]"
            >
              বিস্তারিত দেখুন →
            </button>
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 shadow-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-[15px] text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
            <span>{t('dashboard.alerts')} ({alerts.length} {t('dashboard.unitPieces')})</span>
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
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="flex items-center justify-between text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-medium">
            <span>{t('dashboard.totalRevenue')}</span>
            <div className="p-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-400">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-gray-900 dark:text-slate-100 tracking-tight mt-1.5">
            {fmtMoney(totalRevenue)}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t('dashboard.revenueDesc')}</p>
        </div>

        {/* Total Expenses */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="flex items-center justify-between text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-medium">
            <span>{t('dashboard.totalExpenses')}</span>
            <div className="p-1 rounded-md bg-rose-50 dark:bg-rose-950/60 text-[#C2410C] dark:text-rose-400">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-gray-900 dark:text-slate-100 tracking-tight mt-1.5">
            {fmtMoney(totalExpenses)}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t('dashboard.expensesDesc')}</p>
        </div>

        {/* AR (Receivable) */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-medium">{t('dashboard.receivables')}</div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-sky-700 dark:text-sky-400 tracking-tight mt-1.5">
            {fmtMoney(arBalance)}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t('dashboard.receivablesDesc')}</p>
        </div>

        {/* AP (Payable) */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs transition-colors">
          <div className="text-xs sm:text-[13px] text-gray-600 dark:text-slate-400 font-medium">{t('dashboard.payables')}</div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 tracking-tight mt-1.5">
            {fmtMoney(apBalance)}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{t('dashboard.payablesDesc')}</p>
        </div>
      </div>

      {/* 4. Live Farm Biological Assets (Operations) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#1E5128] dark:text-emerald-400" />
            <h3 className="text-[16px] sm:text-[17px] font-bold text-gray-900 dark:text-slate-100">
              {t('dashboard.bioAssets')}
            </h3>
          </div>
          <button
            onClick={() => onNavigate('operations')}
            className="text-[14px] text-[#1E5128] dark:text-emerald-400 hover:underline font-bold cursor-pointer py-1 px-2"
          >
            {t('dashboard.details')}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Livestock */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/80 hover:border-[#1E5128]/60 dark:hover:border-emerald-500/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 dark:text-slate-400 font-medium">{t('dashboard.activeLivestock')}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{animalCount} {t('dashboard.unitPieces')}</div>
            <div className="text-[13px] font-semibold text-[#1E5128] dark:text-emerald-400 mt-1">{t('dashboard.livestockDesc')}</div>
          </div>

          {/* Fisheries */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/80 hover:border-[#1E5128]/60 dark:hover:border-emerald-500/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 dark:text-slate-400 font-medium">{t('dashboard.activeFish')}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{fishBatchCount} {t('dashboard.unitPieces')}</div>
            <div className="text-[13px] font-semibold text-sky-700 dark:text-sky-400 mt-1">{t('dashboard.fishDesc')}</div>
          </div>

          {/* Crops */}
          <div
            onClick={() => onNavigate('operations')}
            className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/80 hover:border-[#1E5128]/60 dark:hover:border-emerald-500/60 cursor-pointer transition-all active:scale-98"
          >
            <div className="text-[13px] text-gray-600 dark:text-slate-400 font-medium">{t('dashboard.activeCrops')}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{cropCycleCount} {t('dashboard.unitPieces')}</div>
            <div className="text-[13px] font-semibold text-amber-700 dark:text-amber-400 mt-1">{t('dashboard.cropDesc')}</div>
          </div>
        </div>
      </div>

      {/* 5. Recent Posted Financial Transactions */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500 dark:text-slate-400" />
            <h3 className="text-[16px] sm:text-[17px] font-bold text-gray-900 dark:text-slate-100">
              {t('dashboard.recentTx')}
            </h3>
          </div>
          <button
            onClick={() => onNavigate('accounting')}
            className="text-[14px] text-[#1E5128] dark:text-emerald-400 hover:underline font-bold cursor-pointer py-1 px-2"
          >
            {t('dashboard.allJournals')}
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400 text-[14px]">
            {t('dashboard.noTx')}
          </div>
        ) : (
          <div className="space-y-2.5">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                onClick={() => onNavigate('accounting')}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/80 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50/80 dark:hover:bg-slate-750 transition-all cursor-pointer gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[#1E5128] dark:text-emerald-400 font-bold text-[13px] sm:text-[14px]">
                      {tx.voucherNumber}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200">
                      {tx.voucherType}
                    </span>
                    {tx.reversedBy && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                        {t('dashboard.corrected')}
                      </span>
                    )}
                    <span className="text-gray-400 dark:text-slate-500 text-xs">{tx.date}</span>
                    {tx.relatedPerson && (
                      <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                        • {tx.relatedPerson}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-800 dark:text-slate-200 text-xs sm:text-[13px] truncate mt-1">
                    {tx.narration || t('dashboard.noNarration')}
                  </p>
                </div>
                <div className="text-left sm:text-right shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-gray-200/50 dark:border-slate-700/50">
                  <div className="font-bold font-mono tabular-nums text-base sm:text-lg text-gray-900 dark:text-slate-100">
                    {fmtMoney(tx.totalDebit)}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-slate-500 font-medium">{t('dashboard.balancedDebitCredit')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Test Failures Details Modal */}
      {showTestModal && testResult && (
        <div
          id="modal-dashboard-system-test-failures"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 leading-tight">
                    সিস্টেম স্ব-পরীক্ষার ফলাফল
                  </h3>
                  <p className="text-[11px] sm:text-xs text-amber-900 font-medium">
                    System Self-Test Diagnostic Report
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-amber-100 transition-colors cursor-pointer"
                title="বন্ধ করুন"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 sm:px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs sm:text-[13px] font-medium text-gray-600">
              <div>
                মোট পরীক্ষা: <strong className="text-gray-900">{testResult.total}</strong>
              </div>
              <div>
                সফল: <strong className="text-emerald-700">{testResult.passed}</strong>
              </div>
              <div>
                ব্যর্থ: <strong className="text-rose-700">{testResult.failed}</strong>
              </div>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1">
              <p className="text-xs text-gray-600 font-medium">
                নিচের পরীক্ষাগুলোতে সমস্যা ধরা পড়েছে। এগুলো অবিলম্বে সংশোধন করা প্রয়োজন:
              </p>
              <ul className="space-y-2">
                {testResult.failures.map((fail, idx) => (
                  <li
                    key={idx}
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-[13px] font-mono leading-relaxed"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-600 mt-1.5 shrink-0" />
                      <span className="break-words">{fail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-3.5 sm:p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRerunTestsInDashboard}
                disabled={isRerunningTests}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs sm:text-sm font-bold shadow-xs active:scale-95 transition-all disabled:opacity-60 cursor-pointer min-h-[40px]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRerunningTests ? 'animate-spin' : ''}`} />
                <span>{isRerunningTests ? 'পরীক্ষা চলছে...' : 'পুনরায় পরীক্ষা করুন'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer min-h-[40px]"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Feed Stock Threshold Modal */}
      {editingThresholdItem && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl border border-gray-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[15px]">
                কম মজুদের সতর্কতা সীমা নির্ধারণ
              </h4>
              <button
                type="button"
                onClick={() => setEditingThresholdItem(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              <strong>{editingThresholdItem.nameBn}</strong>-এর জন্য সতর্কতার সীমা পরিবর্তন করুন ({editingThresholdItem.unit}):
            </p>
            <div>
              <input
                type="number"
                min="0"
                step="0.1"
                value={editThresholdValue}
                onChange={(e) => setEditThresholdValue(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg p-2.5 text-sm text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-[#1E5128]"
              />
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                ডিফল্ট: শেষ রিস্টকের ২০% ({editingThresholdItem.lastRestockAmount ? Math.round(editingThresholdItem.lastRestockAmount * 0.2) : Math.round(editingThresholdItem.currentStock * 0.2)} {editingThresholdItem.unit})
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingThresholdItem(null)}
                className="px-3.5 py-2 text-xs font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 rounded-lg cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseFloat(editThresholdValue);
                  if (!isNaN(val) && val >= 0) {
                    handleSaveThreshold(editingThresholdItem, val);
                  }
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-[#1E5128] hover:bg-[#173F1F] rounded-lg cursor-pointer"
              >
                সংরক্ষণ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
