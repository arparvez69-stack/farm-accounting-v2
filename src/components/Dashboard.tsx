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
  FileText
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { ActiveTab } from './MobileBottomNav';
import { UserRole } from '../types';

interface Props {
  role: UserRole;
  onNavigate: (tab: ActiveTab) => void;
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

  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [isAccountingBalanced, setIsAccountingBalanced] = useState(true);

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

  const fmtMoney = (val: number) => `৳${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      {/* Top Banner / Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800 shadow-lg">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <span>খামার ওভারভিউ ও সারসংক্ষেপ</span>
            {isAccountingBalanced && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-normal">
                দ্বৈত-দাখিলা হিসাব নির্ভুল
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            রিয়েল-টাইম হিসাবরক্ষণ, গবাদিপশু, মৎস্য ও শস্য বিশ্লেষণ
          </p>
        </div>

        {/* Quick action buttons for Owner */}
        {role === 'OWNER' && (
          <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-wrap">
            <button
              onClick={() => onNavigate('accounting')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>নতুন ভাউচার</span>
            </button>
            <button
              onClick={() => onNavigate('commerce')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold shadow transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>বিক্রয় / চালান</span>
            </button>
          </div>
        )}
      </div>

      {/* Alerts section */}
      {alerts.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-800/80 text-amber-200 text-xs space-y-1.5 shadow">
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            <AlertTriangle className="w-4 h-4" />
            <span>জরুরি সতর্কতা ({alerts.length})</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-amber-200/90 pl-1">
            {alerts.map((alt, idx) => (
              <li key={idx}>{alt}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Core Financial Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Net Profit */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>নিট লাভ/ক্ষতি (Net Profit)</span>
            <div className={`p-1.5 rounded-lg ${netProfit >= 0 ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
              {netProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </div>
          </div>
          <div className={`text-base sm:text-xl font-bold tracking-tight ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {fmtMoney(netProfit)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">চলতি হিসাব সময়কাল</div>
        </div>

        {/* Revenue */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>মোট আয় (Revenue)</span>
            <div className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-base sm:text-xl font-bold tracking-tight text-white">
            {fmtMoney(totalRevenue)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">মাছ, পশু, দুধ ও শস্য বিক্রয়</div>
        </div>

        {/* Expenses */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>মোট ব্যয় (Expense)</span>
            <div className="p-1.5 rounded-lg bg-rose-950 text-rose-400">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="text-base sm:text-xl font-bold tracking-tight text-white">
            {fmtMoney(totalExpenses)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1">COGS ও পরিচালন খরচ</div>
        </div>

        {/* Total Liquidity: Cash + Bank */}
        <div className="p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>তরল তহবিল (Cash & Bank)</span>
            <div className="p-1.5 rounded-lg bg-blue-950 text-blue-400">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="text-base sm:text-xl font-bold tracking-tight text-white">
            {fmtMoney(cashBalance + bankBalance)}
          </div>
          <div className="text-[10px] text-slate-400 flex justify-between mt-1">
            <span>ক্যাশ: {fmtMoney(cashBalance)}</span>
            <span>ব্যাংক: {fmtMoney(bankBalance)}</span>
          </div>
        </div>
      </div>

      {/* AR, AP, and Inventory Row */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <div className="p-3 rounded-2xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] text-slate-400 truncate">পাওনা (Accounts Receivable)</div>
          <div className="text-sm sm:text-lg font-bold text-sky-400 mt-0.5 truncate">
            {fmtMoney(arBalance)}
          </div>
        </div>
        <div className="p-3 rounded-2xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] text-slate-400 truncate">দেনা (Accounts Payable)</div>
          <div className="text-sm sm:text-lg font-bold text-amber-400 mt-0.5 truncate">
            {fmtMoney(apBalance)}
          </div>
        </div>
        <div className="p-3 rounded-2xl bg-slate-900/70 border border-slate-800">
          <div className="text-[11px] text-slate-400 truncate">মজুদ পণ্যের মূল্য (Inventory)</div>
          <div className="text-sm sm:text-lg font-bold text-emerald-400 mt-0.5 truncate">
            {fmtMoney(inventoryValue)}
          </div>
        </div>
      </div>

      {/* Farm Live Operational KPIs */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>খামারের বর্তমান জৈব সম্পদ সূচক (Farm Operations)</span>
          </h3>
          <button
            onClick={() => onNavigate('operations')}
            className="text-[11px] text-emerald-400 hover:underline font-medium"
          >
            বিস্তারিত দেখুন →
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div
            onClick={() => onNavigate('operations')}
            className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 cursor-pointer transition-all"
          >
            <div className="text-[11px] text-slate-400">সক্রিয় গবাদিপশু</div>
            <div className="text-lg sm:text-2xl font-bold text-white mt-0.5">{animalCount} টি</div>
            <div className="text-[10px] text-emerald-400 mt-0.5">গরু ও ছাগল</div>
          </div>

          <div
            onClick={() => onNavigate('operations')}
            className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 cursor-pointer transition-all"
          >
            <div className="text-[11px] text-slate-400">সক্রিয় মাছের ব্যাচ</div>
            <div className="text-lg sm:text-2xl font-bold text-white mt-0.5">{fishBatchCount} টি</div>
            <div className="text-[10px] text-sky-400 mt-0.5">পুকুরভিত্তিক ব্যাচ</div>
          </div>

          <div
            onClick={() => onNavigate('operations')}
            className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 cursor-pointer transition-all"
          >
            <div className="text-[11px] text-slate-400">চলতি শস্য/ঘাস চক্র</div>
            <div className="text-lg sm:text-2xl font-bold text-white mt-0.5">{cropCycleCount} টি</div>
            <div className="text-[10px] text-amber-400 mt-0.5">নেপিয়ার ও ফসল</div>
          </div>
        </div>
      </div>

      {/* Recent Posted Financial Transactions */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>সাম্প্রতিক জাবেদা লেনদেন (Recent Posted Vouchers)</span>
          </h3>
          <button
            onClick={() => onNavigate('accounting')}
            className="text-[11px] text-emerald-400 hover:underline font-medium"
          >
            সকল জাবেদা →
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            এখনও কোন আর্থিক লেনদেন লিপিবদ্ধ করা হয়নি। "নতুন ভাউচার" দিয়ে শুরু করুন।
          </div>
        ) : (
          <div className="space-y-2">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-800 hover:bg-slate-800/70 transition-colors text-xs"
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-emerald-400 font-semibold">{tx.voucherNumber}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                      {tx.voucherType}
                    </span>
                    <span className="text-slate-400 text-[10px]">{tx.date}</span>
                  </div>
                  <p className="text-slate-300 truncate mt-0.5">{tx.narration || 'কোন বিবরণ নেই'}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-white">{fmtMoney(tx.totalDebit)}</div>
                  <div className="text-[10px] text-slate-500">ডেবিট = ক্রেডিট</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
