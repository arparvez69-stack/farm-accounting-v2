import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Building,
  Shield,
  History,
  HardDrive,
  Users,
  PlusCircle,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { updateApprovedViewers } from '../firebase/firebaseClient';
import { AuditLog, FixedAsset, SystemConfig, UserRole, ViewerAccount } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
  systemConfig: SystemConfig | null;
}

type MoreTab = 'audit' | 'viewers' | 'assets' | 'settings';

export const MoreModule: React.FC<Props> = ({ role, currentUserId, systemConfig }) => {
  const [tab, setTab] = useState<MoreTab>('audit');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [viewers, setViewers] = useState<ViewerAccount[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);

  // Add Asset Modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<FixedAsset['category']>('MACHINERY');
  const [assetCost, setAssetCost] = useState('150000');
  const [assetLifeYears, setAssetLifeYears] = useState('5');
  const [assetSalvage, setAssetSalvage] = useState('15000');

  // Add Viewer Modal
  const [showAddViewer, setShowAddViewer] = useState(false);
  const [viewerName, setViewerName] = useState('');
  const [viewerUid, setViewerUid] = useState('');
  const [viewerEmail, setViewerEmail] = useState('');

  useEffect(() => {
    loadData();
  }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'audit') {
        const aList = await db.auditLogs.orderBy('timestamp').reverse().limit(100).toArray();
        setLogs(aList);
      } else if (tab === 'viewers') {
        const vList = await db.viewers.toArray();
        setViewers(vList);
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
      const rate = life > 0 ? (1 / life) * 100 : 20;

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

  const handleAddViewer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewerUid.trim()) {
      alert('ব্যবহারকারীর UID প্রদান করুন');
      return;
    }
    try {
      const v: ViewerAccount = {
        uid: viewerUid.trim(),
        email: viewerEmail.trim(),
        name: viewerName.trim() || 'অনুমোদিত পরিদর্শক',
        status: 'active',
        addedAt: new Date().toISOString(),
        addedBy: currentUserId
      };
      await db.viewers.put(v);
      const currentList = viewers.map((x) => x.uid);
      currentList.push(v.uid);
      await updateApprovedViewers(currentList);
      setShowAddViewer(false);
      setViewerUid('');
      setViewerEmail('');
      setViewerName('');
      loadData();
    } catch (e: any) {
      alert(e.message);
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
            অডিট ট্রেইল, পরিদর্শক হোয়াইটলিস্ট, স্থায়ী সম্পদ অবচয় ও ফার্ম সেটিংস
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setTab('audit')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'audit' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            অডিট ট্রেইল (Audit Trail)
          </button>
          <button
            onClick={() => setTab('assets')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'assets' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            স্থায়ী সম্পদ (Assets)
          </button>
          <button
            onClick={() => setTab('viewers')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'viewers' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            পরিদর্শক হোয়াইটলিস্ট (Viewers)
          </button>
          <button
            onClick={() => setTab('settings')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
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
                <span>অডিট লগ ও সিস্টেম নিরাপত্তা রেকর্ড ({logs.length})</span>
              </h3>
              <p className="text-xs text-slate-400">প্রতিটি পোস্ট, ব্যাকআপ, রিস্টোর ও মুছে ফেলার অমোচনীয় রেকর্ড</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">সময়</th>
                  <th className="p-2.5">ব্যবহারকারী</th>
                  <th className="p-2.5">রোল</th>
                  <th className="p-2.5">অ্যাকশন</th>
                  <th className="p-2.5">মডিউল</th>
                  <th className="p-2.5">বিবরণ</th>
                  <th className="p-2.5">অবস্থা</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-800/40">
                    <td className="p-2.5 text-slate-400 text-[11px]">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="p-2.5 font-bold text-white">{l.userId.slice(0, 10)}...</td>
                    <td className="p-2.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-emerald-400">
                        {l.role}
                      </span>
                    </td>
                    <td className="p-2.5 text-sky-400 font-semibold">{l.action}</td>
                    <td className="p-2.5 text-slate-300">{l.module}</td>
                    <td className="p-2.5 font-sans text-slate-200 truncate max-w-xs">{l.details}</td>
                    <td className="p-2.5">
                      <span className="text-emerald-400 text-[10px]">✓ {l.status}</span>
                    </td>
                  </tr>
                ))}
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
                <span>খামারের স্থায়ী সম্পদ ও যন্ত্রপাতি ({assets.length})</span>
              </h3>
              <p className="text-xs text-slate-400">ট্র্যাক্টর, সেচ পাম্প, শেড কাঠামো, মিল্কিং মেশিন ও অবচয়</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAsset(!showAddAsset)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন সম্পদ</span>
              </button>
            )}
          </div>

          {showAddAsset && (
            <form onSubmit={handleAddAsset} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন স্থায়ী সম্পদ এন্ট্রি</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  required
                  placeholder="সম্পদের নাম (যেমন: পাওয়ার টিলার)"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <select
                  value={assetCategory}
                  onChange={(e) => setAssetCategory(e.target.value as any)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  <option value="MACHINERY">কৃষি যন্ত্রপাতি (Machinery - 1530)</option>
                  <option value="EQUIPMENT">খামার সরঞ্জাম (Equipment - 1540)</option>
                  <option value="VEHICLE">যানবাহন (Vehicle - 1550)</option>
                  <option value="BUILDING">শেড ও ভবন (Building - 1520)</option>
                  <option value="LAND">জমি (Land - 1510)</option>
                </select>
                <input
                  type="number"
                  placeholder="ক্রয়মূল্য ৳"
                  value={assetCost}
                  onChange={(e) => setAssetCost(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <input
                  type="number"
                  placeholder="আয়ুষ্কাল (বছর)"
                  value={assetLifeYears}
                  onChange={(e) => setAssetLifeYears(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddAsset(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assets.map((ast) => (
              <div
                key={ast.id}
                className="p-4 rounded-xl bg-slate-800/50 border border-slate-800 space-y-2 text-xs shadow"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white text-sm">{ast.name}</h4>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-mono">
                    {ast.id}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">ক্যাটাগরি: {ast.category}</div>
                <div className="space-y-1 font-mono text-[11px] pt-1 border-t border-slate-800 text-slate-300">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-400">মূল ক্রয়মূল্য:</span>
                    <span>{fmt(ast.originalCost)}</span>
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

      {/* ===================== TAB 3: VIEWERS WHITELIST ===================== */}
      {tab === 'viewers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>অনুমোদিত পরিদর্শক হোয়াইটলিস্ট ({viewers.length})</span>
              </h3>
              <p className="text-xs text-slate-400">
                শুধুমাত্র মালিক যাদের অনুমতি দেবেন, তারাই রিড-অনলি হিসেবে খামার পর্যবেক্ষণ করতে পারবেন
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddViewer(!showAddViewer)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ পরিদর্শক অনুমোদন</span>
              </button>
            )}
          </div>

          {showAddViewer && (
            <form onSubmit={handleAddViewer} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন পরিদর্শক হোয়াইটলিস্ট করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  placeholder="ব্যবহারকারীর UID (Firebase UID)"
                  value={viewerUid}
                  onChange={(e) => setViewerUid(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <input
                  type="email"
                  placeholder="ইমেইল (ঐচ্ছিক)"
                  value={viewerEmail}
                  onChange={(e) => setViewerEmail(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <input
                  type="text"
                  placeholder="নাম/পদবি"
                  value={viewerName}
                  onChange={(e) => setViewerName(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddViewer(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  অনুমোদন দিন
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {viewers.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs">
                কোনো অতিরিক্ত পরিদর্শক যুক্ত করা নেই। শুধুমাত্র মালিকের পূর্ণ প্রবেশাধিকার রয়েছে।
              </div>
            ) : (
              viewers.map((v) => (
                <div
                  key={v.uid}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs"
                >
                  <div>
                    <div className="font-bold text-white">{v.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">UID: {v.uid} | {v.email || 'কোন ইমেইল নেই'}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800 text-[10px]">
                    {v.status === 'active' ? 'সক্রিয় পরিদর্শক' : 'নিষ্ক্রিয়'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===================== TAB 4: SETTINGS ===================== */}
      {tab === 'settings' && systemConfig && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 max-w-xl mx-auto shadow-xl">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <Building className="w-8 h-8 text-emerald-400" />
            <div>
              <h3 className="font-bold text-white text-base">{systemConfig.companyName}</h3>
              <p className="text-xs text-slate-400">{systemConfig.companyAddress}</p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">মালিকের ইমেইল:</span>
              <span className="font-mono text-white">{systemConfig.ownerEmail}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">মালিকের UID:</span>
              <span className="font-mono text-slate-400">{systemConfig.ownerUid}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">খামারের ফোন নম্বর:</span>
              <span className="font-mono text-white">{systemConfig.phone}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">মুদ্রা (Currency):</span>
              <span className="font-bold text-emerald-400">{systemConfig.currency} (BDT)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800">
              <span className="text-slate-400">ইনিশিয়ালাইজেশন তারিখ:</span>
              <span className="font-mono text-slate-400">{new Date(systemConfig.initializedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
