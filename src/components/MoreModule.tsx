import React, { useEffect, useState, useMemo } from 'react';
import {
  ShieldCheck,
  Building,
  Shield,
  History,
  HardDrive,
  Users,
  CheckCircle2,
  Mail,
  Lock,
  UserCheck,
  KeyRound,
  RefreshCw,
  LogOut,
  Eye,
  EyeOff,
  AlertCircle,
  Calculator,
  FileText,
  Globe
} from 'lucide-react';
import { useLanguage } from '../i18n/translations';
import { db } from '../db/indexedDb';
import { AuditLog, FixedAsset, SystemConfig, UserRole, AppAccessLog } from '../types';
import { getStoredAuthorizedEmails, getAppAccessLogs, logoutOwner } from '../services/authService';
import { generateTransactionNumber, safeInsert } from '../utils/idGenerator';
import { getLastSyncTime, formatBackupTimestamp } from '../services/exportService';
import { runAutomatedDepreciation } from '../accounting/depreciationService';

interface Props {
  role: UserRole;
  currentUserId: string;
  systemConfig: SystemConfig | null;
  userEmail?: string;
  onLogout?: () => void;
}

type MoreTab = 'accessLogs' | 'changePin' | 'audit' | 'assets' | 'owners' | 'settings';

export const MoreModule: React.FC<Props> = ({ role, currentUserId, systemConfig, userEmail, onLogout }) => {
  const [tab, setTab] = useState<MoreTab>('accessLogs');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [accessLogs, setAccessLogs] = useState<AppAccessLog[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(() => getLastSyncTime());

  // Language state (stored in local settings, defaulting to Bengali)
  const { lang: currentLanguage, setLanguage } = useLanguage();

  // VAT/TIN Registered Business State (stored in local settings, off by default)
  const [isVatRegistered, setIsVatRegistered] = useState<boolean>(() => {
    return localStorage.getItem('goted_vat_registered') === 'true';
  });
  const [tinNumber, setTinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_tin_number') || '';
  });
  const [binNumber, setBinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_bin_number') || '';
  });

  const handleToggleVat = (checked: boolean) => {
    setIsVatRegistered(checked);
    localStorage.setItem('goted_vat_registered', checked ? 'true' : 'false');
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handleTinChange = (val: string) => {
    setTinNumber(val);
    localStorage.setItem('goted_tin_number', val);
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handleBinChange = (val: string) => {
    setBinNumber(val);
    localStorage.setItem('goted_bin_number', val);
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  useEffect(() => {
    const handleSyncTimeUpdated = () => {
      setLastBackupTime(getLastSyncTime());
    };
    window.addEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
    return () => window.removeEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
  }, []);

  const ownerList = useMemo(() => {
    const fromStorage = getStoredAuthorizedEmails();
    if (fromStorage.length > 0) return fromStorage;
    if (systemConfig?.ownerEmails && systemConfig.ownerEmails.length > 0) return systemConfig.ownerEmails;
    if (userEmail) return [userEmail];
    return [];
  }, [systemConfig, userEmail]);

  // Change PIN state
  const [targetEmail, setTargetEmail] = useState<string>(userEmail || '');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  // Add Asset Modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<FixedAsset['category']>('MACHINERY');
  const [assetCost, setAssetCost] = useState('150000');
  const [assetLifeYears, setAssetLifeYears] = useState('5');
  const [assetSalvage, setAssetSalvage] = useState('15000');
  const [assetDepreciationRate, setAssetDepreciationRate] = useState('10');
  const [deprLoading, setDeprLoading] = useState(false);
  const [deprFeedback, setDeprFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [tab]);

  const handleLogoutDevice = async () => {
    if (window.confirm('আপনি কি নিশ্চিত যে আপনি এই ডিভাইস থেকে লগ আউট করতে চান? পুনরায় প্রবেশ করতে ইমেইল ও গোপন পিন প্রয়োজন হবে।')) {
      await logoutOwner();
      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    const cleanCurrent = currentPin.trim();
    const cleanNew = newPin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!cleanCurrent) {
      setPinError('বর্তমান গোপন পিন প্রদান করুন।');
      return;
    }
    if (cleanNew.length < 6) {
      setPinError('নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে (New PIN must be 6+ digits)।');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setPinError('নতুন পিন এবং নিশ্চিতকরণ পিন মিলছে না (PINs do not match)।');
      return;
    }

    setPinLoading(true);
    try {
      const res = await fetch('/api/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          currentPin: cleanCurrent,
          newPin: cleanNew
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPinSuccess('গোপন পিন সফলভাবে পরিবর্তন করা হয়েছে! আপনার পরবর্তী লগইনে এই নতুন পিনটি ব্যবহার করুন।');
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
      } else {
        setPinError(data.error || 'পিন পরিবর্তন ব্যর্থ হয়েছে।');
      }
    } catch (err: any) {
      setPinError(err.message || 'সার্ভার যোগাযোগে ত্রুটি দেখা দিয়েছে।');
    } finally {
      setPinLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'accessLogs') {
        const alList = await getAppAccessLogs();
        setAccessLogs(alList);
      } else if (tab === 'audit') {
        const aList = await db.auditLogs.orderBy('timestamp').reverse().limit(100).toArray();
        setLogs(aList);
      } else if (tab === 'assets') {
        const fList = await db.fixedAssets.toArray();
        setAssets(fList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cost = parseFloat(assetCost) || 0;
      const life = parseFloat(assetLifeYears) || 5;
      const salvage = parseFloat(assetSalvage) || 0;
      const rate = parseFloat(assetDepreciationRate) || (life > 0 ? Number((100 / life).toFixed(2)) : 10);
      const purchaseDateStr = new Date().toISOString().split('T')[0];

      const item: FixedAsset = {
        id: generateTransactionNumber('AST'),
        name: assetName.trim(),
        category: assetCategory === 'BUILDING' ? 'BUILDINGS' : (assetCategory as any),
        purchaseDate: purchaseDateStr,
        originalCost: cost,
        salvageValue: salvage,
        usefulLifeYears: life,
        accumulatedDepreciation: 0,
        currentBookValue: cost,
        depreciationRatePercent: rate,
        lastDepreciationDate: purchaseDateStr,
        synced: false
      };
      await safeInsert(db.fixedAssets, item, { idPrefix: 'ast' });
      setShowAddAsset(false);
      setAssetName('');
      setAssetDepreciationRate('10');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRunDepreciationNow = async () => {
    setDeprLoading(true);
    setDeprFeedback(null);
    try {
      const res = await runAutomatedDepreciation(currentUserId);
      if (res.entriesPosted > 0) {
        setDeprFeedback(`সফলভাবে ${res.entriesPosted}টি অবচয় জাবেদা (মোট ৳${res.totalDepreciationAmount.toLocaleString()}) দাখিলা করা হয়েছে।`);
      } else {
        setDeprFeedback('সকল সক্রিয় স্থায়ী সম্পদের অবচয় ইতোমধ্যে হালনাগাদ রয়েছে। নতুন কোনো বকেয়া অবচয় নেই।');
      }
      await loadData();
    } catch (err: any) {
      setDeprFeedback(`অবচয় গণনায় ত্রুটি: ${err.message}`);
    } finally {
      setDeprLoading(false);
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Subtabs */}
      <div className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#1E5128]" />
              <span>নিরাপত্তা, স্থায়ী সম্পদ ও অডিট (System & Security)</span>
            </h2>
            <p className="text-[14px] text-gray-600 mt-0.5">
              অডিট ট্রেইল, খামার মালিক তালিকা, গোপন পিন পরিবর্তন ও ফার্ম সেটিংস
            </p>
            {/* TASK 2: Small সর্বশেষ ব্যাকআপ timestamp showing last cloud sync */}
            <div
              id="more-last-backup-timestamp"
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold shadow-2xs"
              title="ক্লাউড ফায়ারস্টোরে সর্বশেষ ডেটা সিঙ্ক ও ব্যাকআপের সময়"
            >
              <RefreshCw className="w-3 h-3 text-emerald-700 shrink-0" />
              <span>সর্বশেষ ব্যাকআপ: {formatBackupTimestamp(lastBackupTime)}</span>
            </div>
          </div>

          {/* TASK 6: Clearly labeled Log out this device button */}
          <button
            id="btn-logout-device-header"
            onClick={handleLogoutDevice}
            className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[13px] font-bold flex items-center gap-2 transition-all cursor-pointer min-h-[44px] shadow-xs active:scale-95"
            title="এই ডিভাইস থেকে লগ আউট করুন (Log out this device)"
          >
            <LogOut className="w-4 h-4 text-red-600 shrink-0" />
            <span>এই ডিভাইস থেকে লগ আউট করুন / Log out this device</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
          <button
            id="tab-access-logs-btn"
            onClick={() => setTab('accessLogs')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5 ${
              tab === 'accessLogs' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <UserCheck className="w-4 h-4" />
            <span>কে কে অ্যাপ ব্যবহার করছে (Access Log)</span>
          </button>
          <button
            id="tab-change-pin-btn"
            onClick={() => setTab('changePin')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5 ${
              tab === 'changePin' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>পিন পরিবর্তন (Change PIN)</span>
          </button>
          <button
            onClick={() => setTab('audit')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'audit' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            অডিট ট্রেইল (Audit Trail)
          </button>
          <button
            onClick={() => setTab('assets')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'assets' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            স্থায়ী সম্পদ (Assets)
          </button>
          <button
            onClick={() => setTab('owners')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'owners' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            অনুমোদিত মালিকবৃন্দ (Owners)
          </button>
          <button
            onClick={() => setTab('settings')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'settings' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            ফার্ম সেটিংস (Settings)
          </button>
        </div>
      </div>

      {/* ===================== TAB: CHANGE PIN (TASK 7) ===================== */}
      {tab === 'changePin' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-7 shadow-xs space-y-5 max-w-xl mx-auto">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <div className="w-12 h-12 rounded-2xl bg-[#E8F5E9] text-[#1E5128] flex items-center justify-center shrink-0">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                গোপন পিন পরিবর্তন করুন (Change Secret PIN)
              </h3>
              <p className="text-[13px] text-gray-500">
                শুধুমাত্র অনুমোদিত খামার মালিকদের জন্য (Owner-only)। নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে।
              </p>
            </div>
          </div>

          {pinSuccess && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-[14px] flex items-start gap-2.5 shadow-xs"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-semibold">{pinSuccess}</div>
            </div>
          )}

          {pinError && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-50 border border-red-300 text-red-900 text-[14px] flex items-start gap-2.5 shadow-xs"
            >
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-semibold">{pinError}</div>
            </div>
          )}

          <form onSubmit={handleChangePin} className="space-y-4">
            {/* Owner Email Selection */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                মালিকের ইমেইল (Owner Email)
              </label>
              <select
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                disabled={pinLoading}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 text-[14px] font-mono outline-none"
              >
                {ownerList.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </div>

            {/* Current PIN */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                বর্তমান গোপন পিন (Current PIN)
              </label>
              <div className="relative">
                <input
                  type={showCurrentPin ? 'text' : 'password'}
                  inputMode="numeric"
                  required
                  placeholder="বর্তমান পিন দিন..."
                  value={currentPin}
                  onChange={(e) => {
                    setCurrentPin(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  disabled={pinLoading}
                  className="w-full px-3.5 pr-11 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPin(!showCurrentPin)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                >
                  {showCurrentPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New PIN (6+ digits) */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                নতুন গোপন পিন (New PIN — 6+ digits)
              </label>
              <div className="relative">
                <input
                  type={showNewPin ? 'text' : 'password'}
                  inputMode="numeric"
                  minLength={6}
                  required
                  placeholder="নতুন ৬+ ডিজিটের পিন দিন..."
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  disabled={pinLoading}
                  className="w-full px-3.5 pr-11 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPin(!showNewPin)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                >
                  {showNewPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[12px] text-gray-500 mt-1">
                পিনটি অন্তত ৬ ডিজিটের হতে হবে। সার্ভারে এটি Bcrypt Cost 12 অ্যালগরিদমে হ্যাশ হিসেবে সুরক্ষিত থাকবে।
              </p>
            </div>

            {/* Confirm New PIN */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                নতুন পিন নিশ্চিত করুন (Confirm New PIN)
              </label>
              <input
                type="password"
                inputMode="numeric"
                minLength={6}
                required
                placeholder="নতুন পিনটি আবার লিখুন..."
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value);
                  if (pinError) setPinError(null);
                }}
                disabled={pinLoading}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
              />
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={pinLoading || !currentPin || !newPin || !confirmPin}
                className="w-full py-3 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] active:scale-98 disabled:opacity-50 text-white font-bold text-[14px] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[44px]"
              >
                {pinLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>পরিবর্তন সংরক্ষণ করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>পিন পরিবর্তন সম্পন্ন করুন (Update PIN)</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== TAB 0: APP ACCESS LOGS ===================== */}
      {tab === 'accessLogs' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-[#1E5128]" />
                <span>অ্যাপে প্রবেশ ও ব্যবহারকারীর তালিকা (App Access & Login History)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                কে কোন ইমেইল দিয়ে গোপন পিন ব্যবহার করে অ্যাপে প্রবেশ করেছে তার বিস্তারিত বিবরণ
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={loadData}
                className="px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-gray-200 min-h-[40px]"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>রিফ্রেশ</span>
              </button>
              <span className="text-[13px] text-[#15803D] bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-1.5 rounded-full font-mono font-bold">
                মোট প্রবেশ রেকর্ড: {accessLogs.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">সময় (Timestamp)</th>
                  <th className="p-3">ব্যবহারকারীর ইমেইল (User Email)</th>
                  <th className="p-3">লগইন পদ্ধতি</th>
                  <th className="p-3">অবস্থা (Status)</th>
                  <th className="p-3">ডিভাইস / ব্রাউজার</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accessLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-500 text-[14px]">
                      এখনো কোনো অ্যাক্সেস লগ নেই। নতুন কেউ পিন দিয়ে লগইন করলে এখানে প্রদর্শিত হবে।
                    </td>
                  </tr>
                ) : (
                  accessLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="p-3 font-mono text-[13px] text-gray-600 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('bn-BD', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#E8F5E9] border border-[#81C784] flex items-center justify-center text-[#1E5128] font-bold text-xs">
                            {log.email.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-gray-900 font-mono text-[14px]">{log.email}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                          {log.loginMethod === 'SECRET_PIN' ? 'গোপন পিন (Secret PIN)' : 'সংরক্ষিত সেশন'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            log.status === 'SUCCESS'
                              ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {log.status === 'SUCCESS' ? 'সফল (Success)' : 'প্রত্যাখ্যাত (Denied)'}
                        </span>
                      </td>
                      <td className="p-3 max-w-xs truncate text-gray-500 text-[13px]">
                        {log.userAgent || 'ওয়েব ব্রাউজার'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 1: AUDIT TRAIL ===================== */}
      {tab === 'audit' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-[#1E5128]" />
                <span>পরিবর্তনহীন নিরাপত্তা অডিট ট্রেইল (Immutable Audit Log)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                সকল লেনদেন, মুছে ফেলা বা পরিবর্তনের তথ্য ফায়ারস্টোর ও লোকাল ডাটাবেজে অপরিবর্তনীয়ভাবে সংরক্ষিত
              </p>
            </div>
            <span className="text-[13px] text-gray-500 font-medium">সর্বশেষ {logs.length} রেকর্ড</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">সময় (Timestamp)</th>
                  <th className="p-3">অ্যাকশন</th>
                  <th className="p-3">মডিউল</th>
                  <th className="p-3">ব্যবহারকারী UID</th>
                  <th className="p-3">বিবরণ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-500 text-[14px]">
                      কোনো অডিট লগ এন্ট্রি পাওয়া যায়নি
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/80">
                      <td className="p-3 font-mono text-[13px] text-gray-600 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            log.action === 'CREATE'
                              ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                              : log.action === 'UPDATE'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-gray-900">{log.entity}</td>
                      <td className="p-3 font-mono text-[12px] text-gray-500">{log.userId}</td>
                      <td className="p-3 max-w-xs truncate text-gray-600 font-mono text-[12px]">
                        {JSON.stringify(log.details || {})}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: FIXED ASSETS ===================== */}
      {tab === 'assets' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-[#1E5128]" />
                <span>স্থায়ী সম্পদ রেজিস্টার ও অবচয় (Fixed Assets & Depreciation)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                সরলরৈখিক অবচয় (Straight-line Depreciation) স্বয়ংক্রিয় হিসাবরক্ষণ
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                id="btn-run-depreciation-more"
                type="button"
                onClick={handleRunDepreciationNow}
                disabled={deprLoading}
                className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px] disabled:opacity-50"
              >
                <Calculator className={`w-4 h-4 text-amber-700 ${deprLoading ? 'animate-spin' : ''}`} />
                <span>{deprLoading ? 'হিসাব করা হচ্ছে...' : 'এখনই অবচয় হিসাব করুন'}</span>
              </button>
              <button
                onClick={() => setShowAddAsset(!showAddAsset)}
                className="px-4 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px]"
              >
                + নতুন স্থায়ী সম্পদ
              </button>
            </div>
          </div>

          {deprFeedback && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[13px] font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{deprFeedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setDeprFeedback(null)}
                className="text-xs text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {showAddAsset && (
            <form onSubmit={handleAddAsset} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন সম্পদ যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">সম্পদের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: মিল্কিং মেশিন"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্যাটাগরি</label>
                  <select
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="LAND">জমি ও ভূমি উন্নয়ন</option>
                    <option value="BUILDINGS">শেড ও খামার ভবন</option>
                    <option value="MACHINERY">যন্ত্রপাতি ও ইকুইপমেন্ট</option>
                    <option value="VEHICLE">যানবাহন</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রয়মূল্য (Cost)</label>
                  <input
                    type="number"
                    required
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">আয়ুষ্কাল (বছর)</label>
                  <input
                    type="number"
                    required
                    value={assetLifeYears}
                    onChange={(e) => {
                      const l = parseFloat(e.target.value);
                      setAssetLifeYears(e.target.value);
                      if (l > 0) {
                        setAssetDepreciationRate((100 / l).toFixed(1));
                      }
                    }}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">
                    বার্ষিক অবচয় হার (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    required
                    placeholder="যেমন: 20"
                    value={assetDepreciationRate}
                    onChange={(e) => setAssetDepreciationRate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddAsset(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {assets.map((ast) => {
              const rate = ast.depreciationRatePercent ?? (ast.usefulLifeYears ? Number((100 / ast.usefulLifeYears).toFixed(1)) : 10);
              const monthly = Math.round(((ast.originalCost * rate / 100) / 12) * 100) / 100;
              return (
                <div key={ast.id} className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-gray-900 text-[15px]">{ast.name}</h4>
                      <span className="text-[12px] text-gray-500 font-mono">{ast.id} | {ast.category}</span>
                    </div>
                    <div className="text-right">
                      <span className="px-2.5 py-1 rounded-full bg-gray-200 text-gray-700 text-xs font-semibold">
                        {ast.usefulLifeYears} বছর ({rate}%/বছর)
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2.5 border-t border-gray-200 font-mono text-[13px]">
                    <div className="flex justify-between">
                      <span className="font-sans text-gray-600">মূল ক্রয়মূল্য:</span>
                      <span className="text-gray-900 font-semibold">{fmt(ast.originalCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-gray-600">মাসিক অবচয় হার:</span>
                      <span className="text-amber-700 font-semibold">{fmt(monthly)}/মাস</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-gray-600">পুঞ্জীভূত অবচয় (1590):</span>
                      <span className="text-red-600 font-semibold">{fmt(ast.accumulatedDepreciation)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-[#15803D] pt-1.5 border-t border-gray-200">
                      <span className="font-sans text-gray-900">বর্তমান পুস্তক মূল্য:</span>
                      <span>{fmt(ast.currentBookValue)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                      <span className="font-sans">সর্বশেষ অবচয় হিসাব:</span>
                      <span>{ast.lastDepreciationDate || ast.purchaseDate || 'হিসাব হয়নি'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: AUTHORIZED OWNERS ===================== */}
      {tab === 'owners' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#1E5128]" />
                <span>The Goated Farm — অনুমোদিত মালিক তালিকা (Authorized Owners)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                একক-মালিকানা খামার (Single-Tenant Farm)। শুধুমাত্র নির্ধারিত ৪ জন অনুমোদিত মালিক পিন মাধ্যমে প্রবেশাধিকার পাবেন।
              </p>
            </div>

            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#15803D]" />
              <span>নিরাপদ এলাও-লিস্ট</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {ownerList.map((email, idx) => (
              <div
                key={email}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#E8F5E9] border border-[#81C784] flex items-center justify-center text-[#1E5128] font-bold text-sm">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-[14px] font-mono flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-gray-500" />
                      <span>{email}</span>
                    </div>
                    <p className="text-[12px] text-[#15803D] font-medium mt-0.5">
                      পূর্ণ কর্তৃত্ব ও স্বাক্ষরকারী মালিক (Owner)
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>সক্রিয়</span>
                </span>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 text-[13px] text-gray-600 space-y-1.5">
            <p className="font-bold text-gray-900">নিরাপত্তা ও অ্যাক্সেস পলিসি:</p>
            <p>• ব্যবহারকারীকে তার ইমেইল প্রদান করতে হবে এবং মাস্টার সিক্রেট পিন দিয়ে প্রবেশ করতে হবে।</p>
            <p>• প্রতিটি লগইন ও অ্যাক্সেস প্রচেষ্টা অডিট লগে রেকর্ড থাকে, যা উপরের "কে কে অ্যাপ ব্যবহার করছে" ট্যাবে দেখা যাবে।</p>
            <p>• সঠিক এনক্রিপ্টেড পিন ব্যতীত কেউ সিস্টেমে কোনো অবস্থাতেই প্রবেশ করতে পারবে না।</p>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: SETTINGS ===================== */}
      {tab === 'settings' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 max-w-xl mx-auto shadow-xs">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <div className="p-3 rounded-2xl bg-[#E8F5E9] text-[#1E5128]">
              <Building className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-lg">
                {systemConfig?.companyName || 'The Goated Farm'}
              </h3>
              <p className="text-[13px] text-gray-500">
                {systemConfig?.companyAddress || 'ঢাকা, বাংলাদেশ'}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-[14px] text-gray-700">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">খামার আর্কিটেকচার:</span>
              <span className="font-bold text-[#15803D]">একক মালিকানা (Single Tenant)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">অনুমোদিত মালিক সংখ্যা:</span>
              <span className="font-mono font-semibold text-gray-900">৪ জন সক্রিয় অংশীদার</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">মুদ্রা (Currency):</span>
              <span className="font-bold text-[#15803D]">{systemConfig?.currency || '৳'} (BDT)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">প্রমাণীকরণ পদ্ধতি:</span>
              <span className="font-semibold text-gray-900">সার্ভার-সাইড Bcrypt হ্যাশ যাচাইকরণ (Bcrypt Hashed PIN)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">সিক্রেট পিন নিরাপত্তা:</span>
              <span className="font-mono font-bold text-[#15803D]">•••••• (Bcrypt Cost 12 Secured)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">ইনিশিয়ালাইজেশন:</span>
              <span className="font-mono text-gray-600">The Goated Farm Enterprise</span>
            </div>
          </div>

          {/* ভাষা / Language Setting */}
          <div className="pt-2 border-t border-gray-100">
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-gray-900 text-[14px] flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-[#1E5128]" />
                    <span>ভাষা / Language</span>
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    অ্যাপের দৃশ্যমান লেখার ভাষা পরিবর্তন করুন (Change app display language)
                  </p>
                </div>

                <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-300 shadow-2xs self-start sm:self-auto">
                  <button
                    type="button"
                    id="btn-lang-bn"
                    onClick={() => setLanguage('bn')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                      currentLanguage === 'bn'
                        ? 'bg-[#1E5128] text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    বাংলা (ডিফল্ট)
                  </button>
                  <button
                    type="button"
                    id="btn-lang-en"
                    onClick={() => setLanguage('en')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                      currentLanguage === 'en'
                        ? 'bg-[#1E5128] text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ভ্যাট/টিন নিবন্ধন সেটিংস (VAT/TIN Registered Business Toggle) */}
          <div className="pt-2 border-t border-gray-100">
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-gray-900 text-[14px] flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-[#1E5128]" />
                    <span>ভ্যাট/টিন নিবন্ধিত ব্যবসা (VAT/TIN Registered Business)</span>
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    ব্যবসায়িক ভ্যাট বা কর নিবন্ধন থাকলে সক্রিয় করুন। এটি সক্রিয় থাকলে আর্থিক প্রতিবেদন মডিউলে "ভ্যাট সারাংশ" প্রদর্শিত হবে।
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    id="toggle-vat-registered"
                    checked={isVatRegistered}
                    onChange={(e) => handleToggleVat(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E5128]"></div>
                </label>
              </div>

              {/* Only when toggle is ON, show TIN/BIN-related fields */}
              {isVatRegistered && (
                <div className="pt-3 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ই-টিন নম্বর (e-TIN Number)
                    </label>
                    <input
                      type="text"
                      id="input-tin-number"
                      placeholder="যেমন: ১২৩৪৫৬৭৮৯১০১"
                      value={tinNumber}
                      onChange={(e) => handleTinChange(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[13px] text-gray-900 font-mono focus:ring-1 focus:ring-[#1E5128]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      বিআইএন / ভ্যাট নিবন্ধন নম্বর (BIN / VAT Reg No.)
                    </label>
                    <input
                      type="text"
                      id="input-bin-number"
                      placeholder="যেমন: ০০১২৩৪৫৬৭-০১০১"
                      value={binNumber}
                      onChange={(e) => handleBinChange(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[13px] text-gray-900 font-mono focus:ring-1 focus:ring-[#1E5128]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* TASK 6: Prominent Logout Button in Settings */}
          <div className="pt-3 border-t border-gray-100">
            <button
              id="btn-logout-device-settings"
              onClick={handleLogoutDevice}
              className="w-full py-3 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[14px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <LogOut className="w-5 h-5 text-red-600" />
              <span>এই ডিভাইস থেকে লগ আউট করুন / Log out this device</span>
            </button>
            <p className="text-[12px] text-gray-500 text-center mt-2">
              লগ আউট করলে এই ডিভাইসে সংরক্ষিত সেশন মুছে যাবে এবং পুনরায় প্রবেশ করতে ইমেইল ও গোপন পিন প্রয়োজন হবে।
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
