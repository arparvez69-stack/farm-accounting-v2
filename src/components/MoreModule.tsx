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
  Lock
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { AuditLog, FixedAsset, SystemConfig, UserRole } from '../types';
import { APPROVED_OWNER_EMAILS } from '../services/authService';
import { generateTransactionNumber, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
  systemConfig: SystemConfig | null;
}

type MoreTab = 'audit' | 'owners' | 'assets' | 'settings';

export const MoreModule: React.FC<Props> = ({ role, currentUserId, systemConfig }) => {
  const [tab, setTab] = useState<MoreTab>('audit');
  const [logs, setLogs] = useState<AuditLog[]>([]);
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
      if (tab === 'audit') {
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
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      {/* Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>নিরাপত্তা, স্থায়ী সম্পদ ও অডিট (System & Security)</span>
          </h2>
          <p className="text-xs text-slate-400">
            অডিট ট্রেইল, খামার মালিক তালিকা, স্থায়ী সম্পদ অবচয় ও ফার্ম সেটিংস
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setTab('audit')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              tab === 'audit' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            অডিট ট্রেইল (Audit Trail)
          </button>
          <button
            onClick={() => setTab('assets')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              tab === 'assets' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            স্থায়ী সম্পদ (Assets)
          </button>
          <button
            onClick={() => setTab('owners')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              tab === 'owners' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            অনুমোদিত মালিকবৃন্দ (Owners)
          </button>
          <button
            onClick={() => setTab('settings')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
              tab === 'settings' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            ফার্ম সেটিংস (Settings)
          </button>
        </div>
      </div>

      {/* ===================== TAB 1: AUDIT TRAIL ===================== */}
      {tab === 'audit' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <span>পরিবর্তনহীন নিরাপত্তা অডিট ট্রেইল (Immutable Audit Log)</span>
              </h3>
              <p className="text-xs text-slate-400">
                সকল লেনদেন, মুছে ফেলা বা পরিবর্তনের তথ্য ফায়ারস্টোর ও লোকাল ডাটাবেজে অপরিবর্তনীয়ভাবে সংরক্ষিত
              </p>
            </div>
            <span className="text-xs text-slate-400">সর্বশেষ {logs.length} রেকর্ড</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">সময় (Timestamp)</th>
                  <th className="p-2.5">অ্যাকশন</th>
                  <th className="p-2.5">মডিউল</th>
                  <th className="p-2.5">ব্যবহারকারী UID</th>
                  <th className="p-2.5">বিবরণ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      কোনো অডিট লগ এন্ট্রি পাওয়া যায়নি
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="p-2.5 font-mono text-[11px] text-slate-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            log.action === 'CREATE'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : log.action === 'UPDATE'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-rose-950 text-rose-400 border border-rose-800'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="p-2.5 font-semibold text-white">{log.entity}</td>
                      <td className="p-2.5 font-mono text-[10px] text-slate-400">{log.userId}</td>
                      <td className="p-2.5 max-w-xs truncate text-slate-400">
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <span>স্থায়ী সম্পদ রেজিস্টার ও অবচয় (Fixed Assets & Depreciation)</span>
              </h3>
              <p className="text-xs text-slate-400">
                সরলরৈখিক অবচয় (Straight-line Depreciation) স্বয়ংক্রিয় হিসাবরক্ষণ
              </p>
            </div>

            <button
              onClick={() => setShowAddAsset(!showAddAsset)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              + নতুন স্থায়ী সম্পদ
            </button>
          </div>

          {showAddAsset && (
            <form onSubmit={handleAddAsset} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন সম্পদ যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">সম্পদের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: মিল্কিং মেশিন"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">ক্যাটাগরি</label>
                  <select
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="LAND">জমি ও ভূমি উন্নয়ন</option>
                    <option value="BUILDINGS">শেড ও খামার ভবন</option>
                    <option value="MACHINERY">যন্ত্রপাতি ও ইকুইপমেন্ট</option>
                    <option value="VEHICLE">যানবাহন</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">ক্রয়মূল্য (Cost)</label>
                  <input
                    type="number"
                    required
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">আয়ুষ্কাল (বছর)</label>
                  <input
                    type="number"
                    required
                    value={assetLifeYears}
                    onChange={(e) => setAssetLifeYears(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAsset(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assets.map((ast) => (
              <div key={ast.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 text-xs space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-white text-sm">{ast.name}</h4>
                    <span className="text-[10px] text-slate-400 font-mono">{ast.id} | {ast.category}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-[10px]">
                    {ast.usefulLifeYears} বছর
                  </span>
                </div>

                <div className="space-y-1 pt-2 border-t border-slate-700/60 font-mono">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-400">মূল ক্রয়মূল্য:</span>
                    <span className="text-slate-200">{fmt(ast.originalCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-400">পুঞ্জীভূত অবচয় (1590):</span>
                    <span className="text-rose-400">{fmt(ast.accumulatedDepreciation)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-emerald-400 pt-1 border-t border-slate-700">
                    <span className="font-sans text-white">বর্তমান পুস্তক মূল্য:</span>
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>The Goted Farm — অনুমোদিত মালিক তালিকা (Authorized Owners)</span>
              </h3>
              <p className="text-xs text-slate-400">
                একক-মালিকানা খামার (Single-Tenant Farm)। শুধুমাত্র নির্ধারিত ৪ জন অনুমোদিত মালিক ওটিপি মাধ্যমে প্রবেশাধিকার পাবেন।
              </p>
            </div>

            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>নিরাপদ এলাও-লিস্ট</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {APPROVED_OWNER_EMAILS.map((email, idx) => (
              <div
                key={email}
                className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 flex items-center justify-between gap-3 shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-400 font-bold">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="font-bold text-white text-xs sm:text-sm font-mono flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>{email}</span>
                    </div>
                    <p className="text-[11px] text-emerald-400 mt-0.5">
                      পূর্ণ কর্তৃত্ব ও স্বাক্ষরকারী মালিক (Owner)
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>সক্রিয়</span>
                </span>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">নিরাপত্তা ও অ্যাক্সেস পলিসি:</p>
            <p>• মুক্ত বা স্ব-নিবন্ধন সম্পূর্ণ বন্ধ। কোনো নতুন ব্যক্তি সরাসরি সাইন-আপ করতে পারবেন না।</p>
            <p>• ফায়ারস্টোর সিকিউরিটি রুলসে সার্ভার-লেভেলে অনুমোদিত ৪টি ইমেইল ছাড়া সকল রিড ও রাইট ব্লক করা।</p>
            <p>• পাসওয়ার্ডহীন ৬-ডিজিটের ওটিপি (Email OTP) ভিত্তিক প্রমাণীকরণ।</p>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: SETTINGS ===================== */}
      {tab === 'settings' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-w-xl mx-auto shadow-xl">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <Building className="w-8 h-8 text-emerald-400" />
            <div>
              <h3 className="font-bold text-white text-base">
                {systemConfig?.companyName || 'The Goted Farm'}
              </h3>
              <p className="text-xs text-slate-400">
                {systemConfig?.companyAddress || 'ঢাকা, বাংলাদেশ'}
              </p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">খামার আর্কিটেকচার:</span>
              <span className="font-bold text-emerald-400">একক মালিকানা (Single Tenant)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">অনুমোদিত মালিক সংখ্যা:</span>
              <span className="font-mono text-white">৪ জন সক্রিয় অংশীদার</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">মুদ্রা (Currency):</span>
              <span className="font-bold text-emerald-400">{systemConfig?.currency || '৳'} (BDT)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">প্রমাণীকরণ পদ্ধতি:</span>
              <span className="font-semibold text-white">Passwordless Email OTP</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">ইনিশিয়ালাইজেশন:</span>
              <span className="font-mono text-slate-400">The Goted Farm Enterprise</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
