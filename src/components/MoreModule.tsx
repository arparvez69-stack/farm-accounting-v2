import React, { useEffect, useState } from 'react';
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
  RefreshCw
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { AuditLog, FixedAsset, SystemConfig, UserRole, AppAccessLog } from '../types';
import { APPROVED_OWNER_EMAILS, getAppAccessLogs, MASTER_SECRET_PIN } from '../services/authService';
import { generateTransactionNumber, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
  systemConfig: SystemConfig | null;
}

type MoreTab = 'audit' | 'accessLogs' | 'owners' | 'assets' | 'settings';

export const MoreModule: React.FC<Props> = ({ role, currentUserId, systemConfig }) => {
  const [tab, setTab] = useState<MoreTab>('accessLogs');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [accessLogs, setAccessLogs] = useState<AppAccessLog[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);

  // Add Asset Modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<FixedAsset['category']>('MACHINERY');
  const [assetCost, setAssetCost] = useState('150000');
  const [assetLifeYears, setAssetLifeYears] = useState('5');
  const [assetSalvage, setAssetSalvage] = useState('15000');

  useEffect(() => {
    loadData();
  }, [tab]);

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

      const item: FixedAsset = {
        id: generateTransactionNumber('AST'),
        name: assetName.trim(),
        category: assetCategory === 'BUILDING' ? 'BUILDINGS' : (assetCategory as any),
        purchaseDate: new Date().toISOString().split('T')[0],
        originalCost: cost,
        salvageValue: salvage,
        usefulLifeYears: life,
        accumulatedDepreciation: 0,
        currentBookValue: cost,
        synced: false
      };
      await safeInsert(db.fixedAssets, item, { idPrefix: 'ast' });
      setShowAddAsset(false);
      setAssetName('');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1E5128]" />
            <span>নিরাপত্তা, স্থায়ী সম্পদ ও অডিট (System & Security)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            অডিট ট্রেইল, খামার মালিক তালিকা, স্থায়ী সম্পদ অবচয় ও ফার্ম সেটিংস
          </p>
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

            <button
              onClick={() => setShowAddAsset(!showAddAsset)}
              className="px-4 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px]"
            >
              + নতুন স্থায়ী সম্পদ
            </button>
          </div>

          {showAddAsset && (
            <form onSubmit={handleAddAsset} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন সম্পদ যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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
                    onChange={(e) => setAssetLifeYears(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
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
            {assets.map((ast) => (
              <div key={ast.id} className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-gray-900 text-[15px]">{ast.name}</h4>
                    <span className="text-[12px] text-gray-500 font-mono">{ast.id} | {ast.category}</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-gray-200 text-gray-700 text-xs font-semibold">
                    {ast.usefulLifeYears} বছর
                  </span>
                </div>

                <div className="space-y-1.5 pt-2.5 border-t border-gray-200 font-mono text-[13px]">
                  <div className="flex justify-between">
                    <span className="font-sans text-gray-600">মূল ক্রয়মূল্য:</span>
                    <span className="text-gray-900 font-semibold">{fmt(ast.originalCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-gray-600">পুঞ্জীভূত অবচয় (1590):</span>
                    <span className="text-red-600 font-semibold">{fmt(ast.accumulatedDepreciation)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#15803D] pt-1.5 border-t border-gray-200">
                    <span className="font-sans text-gray-900">বর্তমান পুস্তক মূল্য:</span>
                    <span>{fmt(ast.currentBookValue)}</span>
                  </div>
                </div>
              </div>
            ))}
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
            {APPROVED_OWNER_EMAILS.map((email, idx) => (
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
            <p>• সঠিক পিন (111069) ব্যতীত কেউ সিস্টেমে কোনো অবস্থাতেই প্রবেশ করতে পারবে না।</p>
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
              <span className="font-semibold text-gray-900">গোপন পিন যাচাইকরণ (Secret PIN Auth)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">মাস্টার সিক্রেট পিন:</span>
              <span className="font-mono font-bold text-[#15803D]">111069</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">ইনিশিয়ালাইজেশন:</span>
              <span className="font-mono text-gray-600">The Goated Farm Enterprise</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
