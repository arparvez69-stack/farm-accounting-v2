import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  PlusCircle,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Layers,
  ArrowRightLeft
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  generateTrialBalance,
  getGeneralLedger,
  postJournalEntry,
  TrialBalanceRow,
  LedgerEntry,
  validateBalancedLines
} from '../accounting/accountingEngine';
import { Account, JournalEntry, JournalLine, UserRole, VoucherType } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type AccountingSubTab = 'vouchers' | 'daybook' | 'ledger' | 'trialBalance' | 'chart';

export const AccountingModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [subTab, setSubTab] = useState<AccountingSubTab>('daybook');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Voucher Form State
  const [voucherType, setVoucherType] = useState<VoucherType>('JOURNAL');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [narration, setNarration] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
  ]);

  // General Ledger State
  const [selectedLedgerCode, setSelectedLedgerCode] = useState<string>('1010');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerAccount, setLedgerAccount] = useState<Account | undefined>();
  const [ledgerNetBalance, setLedgerNetBalance] = useState(0);

  // Trial Balance State
  const [tbRows, setTbRows] = useState<TrialBalanceRow[]>([]);
  const [tbTotalDebit, setTbTotalDebit] = useState(0);
  const [tbTotalCredit, setTbTotalCredit] = useState(0);
  const [tbIsBalanced, setTbIsBalanced] = useState(true);
  const [tbDifference, setTbDifference] = useState(0);
  const [tbOrphanAccounts, setTbOrphanAccounts] = useState<string[]>([]);

  // New Account Modal State
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccNameBn, setNewAccNameBn] = useState('');
  const [newAccNameEn, setNewAccNameEn] = useState('');
  const [newAccClass, setNewAccClass] = useState<Account['accountClass']>('EXPENSE');
  const [newAccNormalBalance, setNewAccNormalBalance] = useState<Account['normalBalance']>('DEBIT');

  useEffect(() => {
    loadBaseData();
  }, [subTab]);

  const loadBaseData = async () => {
    setLoading(true);
    try {
      const accList = await db.accounts.orderBy('code').toArray();
      setAccounts(accList);

      if (subTab === 'daybook') {
        const jList = await db.journalEntries.orderBy('date').reverse().toArray();
        setJournals(jList);
      } else if (subTab === 'ledger') {
        if (accList.length > 0) {
          const codeToLoad = selectedLedgerCode || accList[0].code;
          loadLedger(codeToLoad);
        }
      } else if (subTab === 'trialBalance') {
        const tb = await generateTrialBalance();
        setTbRows(tb.rows);
        setTbTotalDebit(tb.totalDebit);
        setTbTotalCredit(tb.totalCredit);
        setTbIsBalanced(tb.isBalanced);
        setTbDifference(tb.difference);
        setTbOrphanAccounts(tb.orphanAccounts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadLedger = async (code: string) => {
    setSelectedLedgerCode(code);
    const res = await getGeneralLedger(code);
    setLedgerAccount(res.account);
    setLedgerEntries(res.entries);
    setLedgerNetBalance(res.netBalance);
  };

  // Voucher Line handlers
  const handleLineAccountChange = (index: number, code: string) => {
    const acc = accounts.find((a) => a.code === code);
    if (!acc) return;
    const next = [...lines];
    next[index].accountId = acc.id;
    next[index].accountCode = acc.code;
    next[index].accountName = acc.nameBn;
    setLines(next);
  };

  const handleLineAmountChange = (index: number, field: 'debit' | 'credit', val: string) => {
    const num = parseFloat(val) || 0;
    const next = [...lines];
    if (field === 'debit') {
      next[index].debit = num;
      if (num > 0) next[index].credit = 0;
    } else {
      next[index].credit = num;
      if (num > 0) next[index].debit = 0;
    }
    setLines(next);
  };

  const addLine = () => {
    setLines([...lines, { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== index));
  };

  let balanceCheck = { isBalanced: false, totalDebit: 0, totalCredit: 0, difference: 0 };
  try {
    balanceCheck = validateBalancedLines(lines, accounts);
  } catch (e) {
    let tDebit = 0;
    let tCredit = 0;
    for (const l of lines) {
      tDebit += Number(l.debit || 0);
      tCredit += Number(l.credit || 0);
    }
    balanceCheck = {
      isBalanced: Math.abs(tDebit - tCredit) < 0.01 && tDebit > 0,
      totalDebit: tDebit,
      totalCredit: tCredit,
      difference: Math.abs(tDebit - tCredit)
    };
  }

  const handleSubmitVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (role === 'VIEWER') {
      setMsg({ type: 'error', text: 'পরিদর্শক (Viewer) হিসেবে আপনার শুধুমাত্র দেখার অনুমতি রয়েছে।' });
      return;
    }

    try {
      // Validate lines strictly against accounts list
      validateBalancedLines(lines, accounts);

      const voucherPrefix = voucherType.substring(0, 3).toUpperCase();
      const voucherNum = generateTransactionNumber(voucherPrefix);
      const entryId = generateUniqueId('j');

      await postJournalEntry({
        id: entryId,
        voucherNumber: voucherNum,
        voucherType,
        date,
        narration: narration.trim() || 'হিসাবরক্ষণ জাবেদা ভাউচার',
        reference: reference.trim(),
        lines,
        createdBy: currentUserId,
        createdAt: new Date().toISOString()
      });

      // Audit log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'CREATE_VOUCHER',
        module: 'ACCOUNTING',
        recordId: entryId,
        status: 'SUCCESS',
        details: `ভাউচার পোস্ট করা হয়েছে: ${voucherNum} (৳${balanceCheck.totalDebit})`
      });

      setMsg({ type: 'success', text: `ভাউচার ${voucherNum} সফলভাবে সংরক্ষিত হয়েছে!` });
      // Reset form
      setNarration('');
      setReference('');
      setLines([
        { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
        { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
      ]);
      setSubTab('daybook');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ভাউচার সংরক্ষণ করতে ব্যর্থ হয়েছে।' });
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccCode || !newAccNameBn) return;

    if (newAccCode.trim() === '1050') {
      alert('১০৫০ কোড তৈরি বা ব্যবহার করা নিষিদ্ধ।');
      return;
    }

    try {
      const existing = await db.accounts.where('code').equals(newAccCode.trim()).first();
      if (existing) {
        alert('এই হিসাব কোডটি ইতিমধ্যে ব্যবহৃত হচ্ছে।');
        return;
      }

      const acc: Account = {
        id: `acc_${newAccCode.trim()}`,
        code: newAccCode.trim(),
        nameBn: newAccNameBn.trim(),
        nameEn: newAccNameEn.trim() || newAccNameBn.trim(),
        accountClass: newAccClass,
        normalBalance: newAccNormalBalance,
        isSystem: false,
        isActive: true
      };

      await safeInsert(db.accounts, acc);
      setShowAddAccount(false);
      setNewAccCode('');
      setNewAccNameBn('');
      setNewAccNameEn('');
      loadBaseData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      {/* Top Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <span>দ্বৈত-দাখিলা হিসাবরক্ষণ (Double-Entry Accounting)</span>
          </h2>
          <p className="text-xs text-slate-400">
            রশিদ, পরিশোধ, কন্ট্রা, সাধারণ জাবেদা, খতিয়ান ও স্বয়ংক্রিয় রেওয়ামিল
          </p>
        </div>

        {/* Sub Navigation Bar */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setSubTab('daybook')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              subTab === 'daybook' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            জাবেদা তালিকা (Daybook)
          </button>
          <button
            onClick={() => setSubTab('vouchers')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              subTab === 'vouchers' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            + নতুন ভাউচার
          </button>
          <button
            onClick={() => setSubTab('ledger')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              subTab === 'ledger' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            খতিয়ান (Ledger)
          </button>
          <button
            onClick={() => setSubTab('trialBalance')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              subTab === 'trialBalance' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            রেওয়ামিল (Trial Balance)
          </button>
          <button
            onClick={() => setSubTab('chart')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              subTab === 'chart' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            হিসাবের চার্ট (COA)
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            msg.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/70 border-rose-800 text-rose-300'
          }`}
        >
          {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* SUBTAB 1: NEW VOUCHER FORM */}
      {subTab === 'vouchers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-emerald-400" />
              <span>নতুন আর্থিক লেনদেন লিপিবদ্ধ করুন (New Balanced Voucher)</span>
            </h3>
            {/* Live Balanced indicator */}
            <div
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                balanceCheck.isBalanced && balanceCheck.totalDebit > 0
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
              }`}
            >
              {balanceCheck.isBalanced && balanceCheck.totalDebit > 0 ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>ডেবিট = ক্রেডিট (৳{balanceCheck.totalDebit.toFixed(2)})</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>পার্থক্য: ৳{balanceCheck.difference.toFixed(2)}</span>
                </>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmitVoucher} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ভাউচারের ধরন (Voucher Type)
                </label>
                <select
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="PAYMENT">পরিশোধ (Payment Voucher)</option>
                  <option value="RECEIPT">জমা/রশিদ (Receipt Voucher)</option>
                  <option value="CONTRA">কন্ট্রা / তহবিল স্থানান্তর (Contra Voucher)</option>
                  <option value="JOURNAL">সাধারণ জাবেদা (Journal Voucher)</option>
                  <option value="ADJUSTMENT">সমন্বয় ভাউচার (Adjustment Voucher)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">তারিখ (Date)</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">রেফারেন্স নং (Reference No)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="যেমন: বিল নং / ব্যাংক স্লিপ নং"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                লেনদেনের বিবরণ / ব্যাখ্যা (Narration)
              </label>
              <input
                type="text"
                required
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="যেমন: ১০০০ কেজি ফিড ক্রয়ের বিল নগদ পরিশোধ"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Debit / Credit Lines */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">হিসাব লাইনসমূহ (Debit & Credit Lines)</span>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+ লাইন যোগ করুন</span>
                </button>
              </div>

              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center bg-slate-800/40 p-2 rounded-xl border border-slate-800"
                  >
                    <div className="col-span-12 sm:col-span-6">
                      <select
                        value={line.accountCode}
                        onChange={(e) => handleLineAccountChange(idx, e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="">-- হিসাব নির্বাচন করুন (Select Account) --</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.code}>
                            {acc.code} - {acc.nameBn} ({acc.accountClass})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-5 sm:col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.debit || ''}
                        onChange={(e) => handleLineAmountChange(idx, 'debit', e.target.value)}
                        placeholder="ডেবিট ৳"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="col-span-5 sm:col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.credit || ''}
                        onChange={(e) => handleLineAmountChange(idx, 'credit', e.target.value)}
                        placeholder="ক্রেডিট ৳"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-sky-400 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="col-span-2 sm:col-span-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 2}
                        className="p-1 text-slate-500 hover:text-rose-400 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Summary Footer */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/80 text-xs font-mono font-bold text-white border border-slate-700">
                <span>মোট যোগফল (Total):</span>
                <div className="flex gap-4">
                  <span className="text-emerald-400">মোট ডেবিট: ৳{balanceCheck.totalDebit.toFixed(2)}</span>
                  <span className="text-sky-400">মোট ক্রেডিট: ৳{balanceCheck.totalCredit.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={role === 'VIEWER' || !balanceCheck.isBalanced || balanceCheck.totalDebit <= 0}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs transition-colors cursor-pointer shadow-lg shadow-emerald-900/20"
            >
              ভাউচার নিশ্চিত ও পোস্ট করুন (Post Balanced Voucher)
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 2: DAYBOOK / JOURNAL LIST */}
      {subTab === 'daybook' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>লিপিবদ্ধ জাবেদা ভাউচারসমূহ ({journals.length})</span>
            </h3>
            <button
              onClick={() => setSubTab('vouchers')}
              className="text-xs text-emerald-400 hover:underline font-medium"
            >
              + নতুন ভাউচার
            </button>
          </div>

          {journals.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              কোনো জাবেদা রেকর্ড নেই। "+ নতুন ভাউচার" বাটনে ক্লিক করে হিসাব শুরু করুন।
            </div>
          ) : (
            <div className="space-y-3">
              {journals.map((j) => (
                <div
                  key={j.id}
                  className="p-3 rounded-xl bg-slate-800/50 border border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-700/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-emerald-400">{j.voucherNumber}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-medium">
                        {j.voucherType}
                      </span>
                      <span className="text-slate-400 text-[11px]">{j.date}</span>
                    </div>
                    <div className="font-bold text-white font-mono">
                      মোট: {fmt(j.totalDebit)}
                    </div>
                  </div>

                  <p className="text-slate-300 text-[11px] italic">{j.narration}</p>

                  {/* Lines preview */}
                  <div className="space-y-1 pt-1 font-mono text-[11px]">
                    {j.lines.map((line, lIdx) => (
                      <div key={lIdx} className="flex items-center justify-between text-slate-300">
                        <span className="truncate pr-2">
                          {line.accountCode} - {line.accountName}
                        </span>
                        <div className="flex gap-3 shrink-0">
                          {line.debit > 0 && (
                            <span className="text-emerald-400">Dr: {fmt(line.debit)}</span>
                          )}
                          {line.credit > 0 && (
                            <span className="text-sky-400">Cr: {fmt(line.credit)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: GENERAL LEDGER */}
      {subTab === 'ledger' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
                <span>সাধারণ খতিয়ান (General Ledger)</span>
              </h3>
              <p className="text-[11px] text-slate-400">নির্দিষ্ট হিসাবের সমস্ত লেনদেন ও রানিং ব্যালেন্স</p>
            </div>

            {/* Account Selector */}
            <div className="w-full sm:w-72">
              <select
                value={selectedLedgerCode}
                onChange={(e) => loadLedger(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} - {a.nameBn} ({a.accountClass})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Account Summary Banner */}
          {ledgerAccount && (
            <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-white text-sm">
                  {ledgerAccount.code} — {ledgerAccount.nameBn}
                </span>
                <div className="text-slate-400 text-[11px] mt-0.5">
                  শ্রেণী: {ledgerAccount.accountClass} | স্বাভাবিক স্থিতি: {ledgerAccount.normalBalance}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-400">সর্বশেষ স্থিতি (Net Balance)</div>
                <div className="text-base font-bold text-emerald-400 font-mono">
                  {fmt(ledgerNetBalance)}
                </div>
              </div>
            </div>
          )}

          {/* Ledger Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="p-2.5">তারিখ</th>
                  <th className="p-2.5">ভাউচার নং</th>
                  <th className="p-2.5">বিবরণ</th>
                  <th className="p-2.5 text-right">ডেবিট (৳)</th>
                  <th className="p-2.5 text-right">ক্রেডিট (৳)</th>
                  <th className="p-2.5 text-right">ব্যালেন্স (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500 text-xs">
                      এই হিসাবে এখনো কোনো লেনদেন সংঘটিত হয়নি।
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-2.5 text-slate-400">{row.date}</td>
                      <td className="p-2.5 font-bold text-emerald-400">{row.voucherNumber}</td>
                      <td className="p-2.5 font-sans text-slate-300 truncate max-w-xs">{row.narration}</td>
                      <td className="p-2.5 text-right text-emerald-400">{row.debit > 0 ? fmt(row.debit) : '-'}</td>
                      <td className="p-2.5 text-right text-sky-400">{row.credit > 0 ? fmt(row.credit) : '-'}</td>
                      <td className="p-2.5 text-right font-bold text-white">{fmt(row.runningBalance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 4: TRIAL BALANCE */}
      {subTab === 'trialBalance' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>রেওয়ামিল (Trial Balance)</span>
              </h3>
              <p className="text-[11px] text-slate-400">সকল খতিয়ান স্থিতির সমতা ও নির্ভুলতা যাচাই</p>
            </div>

            <div
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                tbIsBalanced && tbOrphanAccounts.length === 0
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                  : 'bg-rose-950 text-rose-300 border-rose-800 animate-bounce'
              }`}
            >
              {tbIsBalanced && tbOrphanAccounts.length === 0
                ? '✓ রেওয়ামিল সম্পূর্ণ ভারসাম্যপূর্ণ'
                : `⚠️ ভারসাম্যহীন বা অবৈধ হিসাব! পার্থক্য: ৳${tbDifference.toFixed(2)}`}
            </div>
          </div>

          {tbOrphanAccounts.length > 0 && (
            <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800 text-xs text-rose-200">
              <strong>সতর্কতা:</strong> নিম্নলিখিত হিসাবগুলো চার্ট অব একাউন্টসে বিদ্যমান নেই: {tbOrphanAccounts.join(', ')}।
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="p-2.5">কোড</th>
                  <th className="p-2.5">হিসাবের নাম</th>
                  <th className="p-2.5">শ্রেণী</th>
                  <th className="p-2.5 text-right">ডেবিট ব্যালেন্স (৳)</th>
                  <th className="p-2.5 text-right">ক্রেডিট ব্যালেন্স (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {tbRows.map((r) => (
                  <tr key={r.code} className={`hover:bg-slate-800/40 ${r.isOrphan ? 'bg-rose-950/30' : ''}`}>
                    <td className="p-2.5 text-emerald-400 font-bold">{r.code}</td>
                    <td className="p-2.5 font-sans text-slate-200">{r.nameBn}</td>
                    <td className="p-2.5 text-slate-400 text-[10px]">{r.accountClass}</td>
                    <td className="p-2.5 text-right text-emerald-400">{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className="p-2.5 text-right text-sky-400">{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-800/80 font-mono font-bold text-xs border-t-2 border-slate-700">
                <tr>
                  <td colSpan={3} className="p-3 text-white">মোট (Total):</td>
                  <td className="p-3 text-right text-emerald-400">{fmt(tbTotalDebit)}</td>
                  <td className="p-3 text-right text-sky-400">{fmt(tbTotalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 5: CHART OF ACCOUNTS EXPLORER */}
      {subTab === 'chart' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>হিসাবের চার্ট (Chart of Accounts Master)</span>
              </h3>
              <p className="text-[11px] text-slate-400">হিসাবসমূহের হায়ারার্কি ও কাঠামো</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAccount(true)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors"
              >
                + নতুন হিসাব কোড যোগ করুন
              </button>
            )}
          </div>

          {showAddAccount && (
            <form onSubmit={handleCreateAccount} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-emerald-400">নতুন হিসাব তৈরি (Add Child Account)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  required
                  placeholder="কোড (যেমন: 6160)"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <input
                  type="text"
                  required
                  placeholder="বাংলা নাম"
                  value={newAccNameBn}
                  onChange={(e) => setNewAccNameBn(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <select
                  value={newAccClass}
                  onChange={(e) => setNewAccClass(e.target.value as any)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  <option value="ASSET">ASSET (সম্পদ)</option>
                  <option value="LIABILITY">LIABILITY (দায়)</option>
                  <option value="EQUITY">EQUITY (মূলধন)</option>
                  <option value="REVENUE">REVENUE (আয়)</option>
                  <option value="COGS">COGS (বিক্রিত পণ্যের ব্যয়)</option>
                  <option value="EXPENSE">EXPENSE (পরিচালন ব্যয়)</option>
                </select>
                <select
                  value={newAccNormalBalance}
                  onChange={(e) => setNewAccNormalBalance(e.target.value as any)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  <option value="DEBIT">স্বাভাবিক ব্যালেন্স: DEBIT</option>
                  <option value="CREDIT">স্বাভাবিক ব্যালেন্স: CREDIT</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition-colors text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-emerald-400">{acc.code}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                    {acc.accountClass}
                  </span>
                </div>
                <div className="font-medium text-white text-xs">{acc.nameBn}</div>
                <div className="text-[10px] text-slate-400 italic">{acc.nameEn}</div>
                <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800 flex justify-between">
                  <span>ব্যালেন্স ধরন: {acc.normalBalance}</span>
                  <span>{acc.isSystem ? 'সিস্টেম' : 'কাস্টম'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
