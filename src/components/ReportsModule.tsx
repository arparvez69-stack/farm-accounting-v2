import React, { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  PieChart,
  Layers,
  Scale
} from 'lucide-react';
import {
  BalanceSheetReport,
  generateBalanceSheet,
  generateProfitLoss,
  generateTrialBalance,
  ProfitLossReport,
  TrialBalance
} from '../accounting/accountingEngine';
import { exportAllToExcel, createFullJsonBackup, restoreFromJsonBackup } from '../services/exportService';
import { UserRole } from '../types';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type ReportType = 'pl' | 'balanceSheet' | 'trialBalance' | 'backup';

export const ReportsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [activeReport, setActiveReport] = useState<ReportType>('pl');
  const [loading, setLoading] = useState(false);

  const [pl, setPl] = useState<ProfitLossReport | null>(null);
  const [bs, setBs] = useState<BalanceSheetReport | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);

  const [restoreStatus, setRestoreStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    loadReports();
  }, [activeReport]);

  const loadReports = async () => {
    setLoading(true);
    try {
      if (activeReport === 'pl') {
        const res = await generateProfitLoss();
        setPl(res);
      } else if (activeReport === 'balanceSheet') {
        const res = await generateBalanceSheet();
        setBs(res);
      } else if (activeReport === 'trialBalance') {
        const res = await generateTrialBalance();
        setTb(res);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      await exportAllToExcel('Agro_Farm');
    } catch (e: any) {
      alert(`এক্সেল এক্সপোর্ট ত্রুটি: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupJson = async () => {
    try {
      await createFullJsonBackup();
    } catch (e: any) {
      alert(`ব্যাকআপ ত্রুটি: ${e.message}`);
    }
  };

  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      const confirmRestore = window.confirm(
        'সতর্কতা: ব্যাকআপ ফাইল রিস্টোর করলে বর্তমান ডাটাবেজের সকল ডাটা নতুন তথ্যে পরিবর্তিত হবে। আপনি কি নিশ্চিত?'
      );
      if (!confirmRestore) return;

      const res = await restoreFromJsonBackup(content, currentUserId);
      setRestoreStatus(res);
      if (res.success) {
        loadReports();
      }
    };
    reader.readAsText(file);
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Report Selectors */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#1E5128]" />
            <span>আর্থিক প্রতিবেদন ও ব্যালেন্স শীট (Financial Reports)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            আন্তর্জাতিক মানের লাভ-ক্ষতি বিবরণী, ব্যালেন্স শীট, রেওয়ামিল ও এক্সেল এক্সপোর্ট
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="px-4 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] disabled:opacity-50 text-white text-[13px] font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer min-h-[42px]"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'এক্সপোর্ট হচ্ছে...' : 'Excel এক্সপোর্ট (.xlsx)'}</span>
          </button>
        </div>
      </div>

      {/* Report Switcher Tabs */}
      <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
        <button
          onClick={() => setActiveReport('pl')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'pl' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <PieChart className="w-4 h-4" />
          <span>লাভ-ক্ষতি বিবরণী (Profit & Loss)</span>
        </button>

        <button
          onClick={() => setActiveReport('balanceSheet')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'balanceSheet' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>উদ্বৃত্তপত্র (Balance Sheet)</span>
        </button>

        <button
          onClick={() => setActiveReport('trialBalance')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'trialBalance' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>রেওয়ামিল অডিট (Trial Balance)</span>
        </button>

        <button
          onClick={() => setActiveReport('backup')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'backup' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>ব্যাকআপ ও রিস্টোর (JSON Backup)</span>
        </button>
      </div>

      {/* ===================== REPORT 1: PROFIT & LOSS ===================== */}
      {activeReport === 'pl' && pl && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          <div className="text-center border-b border-gray-100 pb-4">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              লাভ ও ক্ষতি হিসাব বিবরণী (Statement of Profit or Loss)
            </h3>
            <p className="text-[13px] text-gray-500 mt-0.5">আন্তর্জাতিক হিসাবরক্ষণ মান (IAS 1 & IFRS) অনুযায়ী প্রস্তুতকৃত</p>
          </div>

          <div className="space-y-4 max-w-3xl mx-auto font-mono text-[14px]">
            {/* 1. REVENUE */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-bold text-[15px] text-[#15803D] border-b border-gray-200 pb-1.5">
                <span className="font-sans">১. খামারের মোট পরিচালন রাজস্ব (Operating Revenue)</span>
                <span>{fmt(pl.totalRevenue)}</span>
              </div>
              {pl.revenues.map((r) => (
                <div key={r.code} className="flex justify-between text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans">{r.code} - {r.nameBn}</span>
                  <span className="font-semibold text-gray-900">{fmt(r.amount)}</span>
                </div>
              ))}
            </div>

            {/* 2. COGS */}
            <div className="space-y-1.5 pt-3">
              <div className="flex justify-between font-bold text-[15px] text-amber-700 border-b border-gray-200 pb-1.5">
                <span className="font-sans">২. বাদ: বিক্রিত পণ্যের প্রত্যক্ষ ব্যয় (Cost of Goods Sold - COGS)</span>
                <span>({fmt(pl.totalCogs)})</span>
              </div>
              {pl.cogs.map((c) => (
                <div key={c.code} className="flex justify-between text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans">{c.code} - {c.nameBn}</span>
                  <span className="font-semibold text-gray-900">{fmt(c.amount)}</span>
                </div>
              ))}
            </div>

            {/* GROSS PROFIT */}
            <div className="flex justify-between p-3.5 rounded-xl bg-[#F8FAFC] text-[15px] font-bold text-gray-900 border border-gray-200">
              <span className="font-sans">মোট মুনাফা (Gross Profit):</span>
              <span className={pl.grossProfit >= 0 ? 'text-[#15803D]' : 'text-red-600'}>
                {fmt(pl.grossProfit)}
              </span>
            </div>

            {/* 3. OPERATING EXPENSES */}
            <div className="space-y-1.5 pt-3">
              <div className="flex justify-between font-bold text-[15px] text-red-600 border-b border-gray-200 pb-1.5">
                <span className="font-sans">৩. বাদ: পরিচালন ও সাধারণ ব্যয় (Operating Expenses)</span>
                <span>({fmt(pl.totalOperatingExpenses)})</span>
              </div>
              {pl.operatingExpenses.map((e) => (
                <div key={e.code} className="flex justify-between text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans">{e.code} - {e.nameBn}</span>
                  <span className="font-semibold text-gray-900">{fmt(e.amount)}</span>
                </div>
              ))}
            </div>

            {/* 4. OTHER EXPENSES */}
            {pl.otherExpenses.length > 0 && (
              <div className="space-y-1.5 pt-3">
                <div className="flex justify-between font-bold text-[15px] text-gray-600 border-b border-gray-200 pb-1.5">
                  <span className="font-sans">৪. অন্যান্য অ-পরিচালন ব্যয় (Other Expenses)</span>
                  <span>({fmt(pl.totalOtherExpenses)})</span>
                </div>
                {pl.otherExpenses.map((o) => (
                  <div key={o.code} className="flex justify-between text-gray-700 pl-4 py-1 border-b border-gray-50">
                    <span className="font-sans">{o.code} - {o.nameBn}</span>
                    <span className="font-semibold text-gray-900">{fmt(o.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* NET PROFIT */}
            <div className={`flex justify-between p-4 rounded-xl text-[16px] font-bold border-2 ${
              pl.netProfit >= 0 ? 'bg-[#F0FDF4] border-[#86EFAC] text-[#15803D]' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <span className="font-sans">খামারের নিট মুনাফা / (ক্ষতি) (Net Farm Profit / Loss):</span>
              <span className="font-mono">
                {fmt(pl.netProfit)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REPORT 2: BALANCE SHEET ===================== */}
      {activeReport === 'balanceSheet' && bs && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          <div className="text-center border-b border-gray-100 pb-4">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              উদ্বৃত্তপত্র / স্থিতিপত্র (Statement of Financial Position - Balance Sheet)
            </h3>
            <p className="text-[13px] text-gray-500 mt-0.5">
              সম্পদ = দায় + মূলধন (Assets = Liabilities + Equity)
            </p>
            {/* Balance check indicator */}
            <div className="mt-2.5 inline-flex items-center gap-1.5">
              {bs.isBalanced ? (
                <span className="text-[#15803D] bg-[#F0FDF4] border border-[#BBF7D0] px-3.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>উদ্বৃত্তপত্র সম্পূর্ণ ভারসাম্যপূর্ণ (Perfect Balance Sheet)</span>
                </span>
              ) : (
                <span className="text-red-700 bg-red-50 border border-red-200 px-3.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>ভারসাম্যহীন! অমিল: {fmt(bs.discrepancy)}</span>
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 font-mono text-[14px]">
            {/* LEFT SIDE: ASSETS */}
            <div className="space-y-4 p-4 rounded-xl bg-[#F8FAFC] border border-gray-200">
              <div className="flex justify-between font-bold text-[15px] text-[#15803D] border-b border-gray-200 pb-2">
                <span className="font-sans">মোট সম্পদ (Total Assets)</span>
                <span>{fmt(bs.totalAssets)}</span>
              </div>

              <div className="space-y-2">
                {bs.assets.map((a) => (
                  <div key={a.code} className="flex justify-between text-gray-700 py-0.5">
                    <span className="font-sans">{a.code} - {a.nameBn}</span>
                    <span className={`font-semibold ${a.isContra ? 'text-red-600' : 'text-gray-900'}`}>
                      {a.isContra ? `(${fmt(a.amount)})` : fmt(a.amount)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] font-bold text-gray-900 mt-4">
                <span className="font-sans">মোট সম্পদ সমষ্টি:</span>
                <span className="text-[#15803D]">{fmt(bs.totalAssets)}</span>
              </div>
            </div>

            {/* RIGHT SIDE: LIABILITIES & EQUITY */}
            <div className="space-y-4 p-4 rounded-xl bg-[#F8FAFC] border border-gray-200">
              {/* LIABILITIES */}
              <div className="space-y-2">
                <div className="flex justify-between font-bold text-[15px] text-amber-700 border-b border-gray-200 pb-2">
                  <span className="font-sans">১. মোট দায় (Total Liabilities)</span>
                  <span>{fmt(bs.totalLiabilities)}</span>
                </div>
                <div className="space-y-1.5">
                  {bs.liabilities.map((l) => (
                    <div key={l.code} className="flex justify-between text-gray-700 py-0.5">
                      <span className="font-sans">{l.code} - {l.nameBn}</span>
                      <span className="font-semibold text-gray-900">{fmt(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* EQUITY */}
              <div className="space-y-2 pt-3">
                <div className="flex justify-between font-bold text-[15px] text-blue-700 border-b border-gray-200 pb-2">
                  <span className="font-sans">২. মালিকানা স্বত্ব / মূলধন (Total Equity)</span>
                  <span>{fmt(bs.totalEquity)}</span>
                </div>
                <div className="space-y-1.5">
                  {bs.equity.map((eq) => (
                    <div key={eq.code} className="flex justify-between text-gray-700 py-0.5">
                      <span className="font-sans">{eq.code} - {eq.nameBn}</span>
                      <span className={`font-semibold ${eq.isContra ? 'text-red-600' : 'text-gray-900'}`}>
                        {eq.isContra ? `(${fmt(eq.amount)})` : fmt(eq.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between text-[#15803D] py-0.5 font-bold">
                    <span className="font-sans">+ চলতি বছরের নিট লাভ (Current Net Profit)</span>
                    <span>{fmt(bs.currentYearNetProfit)}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between p-3 rounded-lg bg-blue-50 border border-blue-200 font-bold text-gray-900 mt-4">
                <span className="font-sans">মোট দায় ও মূলধন সমষ্টি:</span>
                <span className="text-blue-700">{fmt(bs.totalLiabilities + bs.totalEquity)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REPORT 3: TRIAL BALANCE AUDIT ===================== */}
      {activeReport === 'trialBalance' && tb && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-base font-bold text-gray-900">রেওয়ামিল নিরীক্ষা ও বিশ্লেষণ (Trial Balance Audit)</h3>
              <p className="text-[13px] text-gray-500 mt-0.5">লিপিবদ্ধ সকল খতিয়ান স্থিতির সমতা নিশ্চিতকরণ</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              tb.isBalanced && tb.orphanAccounts.length === 0
                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {tb.isBalanced && tb.orphanAccounts.length === 0 ? '✓ ভারসাম্যপূর্ণ' : `⚠️ অমিল: ৳${tb.difference.toFixed(2)}`}
            </span>
          </div>

          {tb.orphanAccounts.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
              <strong>অডিট এলার্ট:</strong> এই হিসাবগুলো চার্ট অব একাউন্টসে অনুপস্থিত কিন্তু লেনদেনে ব্যবহৃত হয়েছে: {tb.orphanAccounts.join(', ')}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">কোড</th>
                  <th className="p-3">হিসাবের নাম</th>
                  <th className="p-3">শ্রেণী</th>
                  <th className="p-3 text-right">ডেবিট স্থিতি (৳)</th>
                  <th className="p-3 text-right">ক্রেডিট স্থিতি (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-mono">
                {tb.rows.map((r) => (
                  <tr key={r.code} className={r.isOrphan ? 'bg-red-50/50' : 'hover:bg-gray-50/80'}>
                    <td className="p-3 font-bold text-[#1E5128]">{r.code}</td>
                    <td className="p-3 font-sans text-gray-900 font-medium">{r.nameBn}</td>
                    <td className="p-3 text-gray-500 text-[12px]">{r.accountClass}</td>
                    <td className="p-3 text-right text-[#15803D] font-bold">{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className="p-3 text-right text-blue-700 font-bold">{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F8FAFC] font-mono font-bold text-[14px] border-t-2 border-gray-200">
                <tr>
                  <td colSpan={3} className="p-3 text-gray-900 font-sans">সর্বমোট সমতা (Total Balance):</td>
                  <td className="p-3 text-right text-[#15803D]">{fmt(tb.totalDebit)}</td>
                  <td className="p-3 text-right text-blue-700">{fmt(tb.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ===================== REPORT 4: BACKUP & RESTORE ===================== */}
      {activeReport === 'backup' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          <div>
            <h3 className="text-base font-bold text-gray-900">ডিজাস্টার রিকভারি ও পূর্ণাঙ্গ ব্যাকআপ (Backup & Disaster Recovery)</h3>
            <p className="text-[14px] text-gray-600 mt-1">
              খামারের হিসাবরক্ষণ, গবাদিপশু, পুকুর, ফসল, বিক্রয় ও সমস্ত ডাটা একক ফাইলে সংরক্ষণ বা পুনরুদ্ধার করুন
            </p>
          </div>

          {restoreStatus && (
            <div
              className={`p-3.5 rounded-xl border text-[14px] font-medium flex items-center gap-2.5 ${
                restoreStatus.success
                  ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {restoreStatus.success ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
              <span>{restoreStatus.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* EXPORT BACKUP */}
            <div className="p-5 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-3">
              <h4 className="font-bold text-[#1E5128] text-[15px] flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span>JSON ব্যাকআপ ডাউনলোড</span>
              </h4>
              <p className="text-[13px] text-gray-600 leading-relaxed">
                আপনার ডিভাইসে অফলাইনে নিরাপদ রাখার জন্য খামারের সমস্ত হিসাব ও রেকর্ডের একটি সম্পূর্ণ এনক্রিপ্টযোগ্য JSON ব্যাকআপ ফাইল ডাউনলোড করুন।
              </p>
              <button
                onClick={handleBackupJson}
                className="w-full py-2.5 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white font-bold text-[13px] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs min-h-[42px]"
              >
                <Download className="w-4 h-4" />
                <span>সম্পূর্ণ ডাটাবেজ ব্যাকআপ নিন (Download JSON)</span>
              </button>
            </div>

            {/* RESTORE BACKUP */}
            <div className="p-5 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-3">
              <h4 className="font-bold text-blue-700 text-[15px] flex items-center gap-2">
                <Upload className="w-4 h-4" />
                <span>ব্যাকআপ থেকে পুনরুদ্ধার (Restore)</span>
              </h4>
              <p className="text-[13px] text-gray-600 leading-relaxed">
                পূর্বে সংরক্ষিত কোনো .json ব্যাকআপ ফাইল আপলোড করে তৎক্ষণাৎ সম্পূর্ণ ডাটাবেজ আগের অবস্থায় পুনঃস্থাপন করুন।
              </p>
              <label className="w-full py-2.5 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-[13px] transition-all flex items-center justify-center gap-2 cursor-pointer border border-gray-300 shadow-xs min-h-[42px]">
                <Upload className="w-4 h-4" />
                <span>ব্যাকআপ ফাইল নির্বাচন করুন (.json)</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileRestore}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
