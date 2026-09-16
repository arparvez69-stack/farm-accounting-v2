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

    if (role !== 'OWNER') {
      setMsg({ type: 'error', text: 'শুধুমাত্র অনুমোদিত মালিক ভাউচার পোস্ট করতে পারেন।' });
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
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Top Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#1E5128]" />
            <span>দ্বৈত-দাখিলা হিসাবরক্ষণ</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            রশিদ, পরিশোধ, কন্ট্রা, সাধারণ জাবেদা, খতিয়ান ও স্বয়ংক্রিয় রেওয়ামিল
          </p>
        </div>

        {/* Sub Navigation Bar */}
        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
          <button
            onClick={() => setSubTab('daybook')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              subTab === 'daybook' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            জাবেদা তালিকা (Daybook)
          </button>
          <button
            onClick={() => setSubTab('vouchers')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              subTab === 'vouchers' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            + নতুন ভাউচার
          </button>
          <button
            onClick={() => setSubTab('ledger')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              subTab === 'ledger' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            খতিয়ান (Ledger)
          </button>
          <button
            onClick={() => setSubTab('trialBalance')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              subTab === 'trialBalance' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            রেওয়ামিল (Trial Balance)
          </button>
          <button
            onClick={() => setSubTab('chart')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              subTab === 'chart' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            হিসাবের চার্ট (COA)
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3.5 rounded-xl border text-[14px] font-medium flex items-center gap-2.5 ${
            msg.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* SUBTAB 1: NEW VOUCHER FORM */}
      {subTab === 'vouchers' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-gray-100">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-[#1E5128]" />
              <span>নতুন আর্থিক লেনদেন লিপিবদ্ধ করুন (New Balanced Voucher)</span>
            </h3>
            {/* Live Balanced indicator */}
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] font-semibold ${
                balanceCheck.isBalanced && balanceCheck.totalDebit > 0
                  ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                  : 'bg-red-50 text-red-700 border border-red-200 animate-pulse'
              }`}
            >
              {balanceCheck.isBalanced && balanceCheck.totalDebit > 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ডেবিট = ক্রেডিট (৳{balanceCheck.totalDebit.toFixed(2)})</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>পার্থক্য: ৳{balanceCheck.difference.toFixed(2)}</span>
                </>
              )}
            </div>
          </div>

          <form onSubmit={handleSubmitVoucher} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-1.5">
                  ভাউচারের ধরন (Voucher Type)
                </label>
                <select
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                >
                  <option value="PAYMENT">পরিশোধ (Payment Voucher)</option>
                  <option value="RECEIPT">জমা/রশিদ (Receipt Voucher)</option>
                  <option value="CONTRA">কন্ট্রা / তহবিল স্থানান্তর (Contra Voucher)</option>
                  <option value="JOURNAL">সাধারণ জাবেদা (Journal Voucher)</option>
                  <option value="ADJUSTMENT">সমন্বয় ভাউচার (Adjustment Voucher)</option>
                </select>
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-1.5">তারিখ (Date)</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-1.5">রেফারেন্স নং (Reference No)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="যেমন: বিল নং / ব্যাংক স্লিপ নং"
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[14px] font-bold text-gray-800 mb-1.5">
                লেনদেনের বিবরণ / ব্যাখ্যা (Narration)
              </label>
              <input
                type="text"
                required
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="যেমন: ১০০০ কেজি ফিড ক্রয়ের বিল নগদ পরিশোধ"
                className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
              />
            </div>

            {/* Debit / Credit Lines */}
            <div className="pt-3 border-t border-gray-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-gray-800">হিসাব লাইনসমূহ (Debit & Credit Lines)</span>
                <button
                  type="button"
                  onClick={addLine}
                  className="text-[13px] text-[#1E5128] hover:underline flex items-center gap-1 font-bold cursor-pointer py-1 px-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ লাইন যোগ করুন</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {lines.map((line, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center bg-[#F8FAFC] p-2.5 sm:p-3 rounded-xl border border-gray-200"
                  >
                    <div className="col-span-12 sm:col-span-6">
                      <select
                        value={line.accountCode}
                        onChange={(e) => handleLineAccountChange(idx, e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-gray-900 focus:outline-none focus:border-[#1E5128] min-h-[40px]"
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
                        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-[#15803D] font-bold focus:outline-none focus:border-[#1E5128] min-h-[40px]"
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
                        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-sky-700 font-bold focus:outline-none focus:border-[#1E5128] min-h-[40px]"
                      />
                    </div>

                    <div className="col-span-2 sm:col-span-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length <= 2}
                        className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Summary Footer */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] text-[14px] font-bold text-gray-900 border border-gray-200 gap-2">
                <span>মোট যোগফল:</span>
                <div className="flex gap-4">
                  <span className="text-[#15803D]">মোট ডেবিট: ৳{balanceCheck.totalDebit.toFixed(2)}</span>
                  <span className="text-sky-700">মোট ক্রেডিট: ৳{balanceCheck.totalCredit.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={role !== 'OWNER' || !balanceCheck.isBalanced || balanceCheck.totalDebit <= 0}
              className="w-full py-3.5 px-4 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-[15px] transition-all cursor-pointer shadow-xs min-h-[48px] active:scale-98"
            >
              ভাউচার নিশ্চিত ও পোস্ট করুন (Post Balanced Voucher)
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 2: DAYBOOK / JOURNAL LIST */}
      {subTab === 'daybook' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
            <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#1E5128]" />
              <span>লিপিবদ্ধ জাবেদা ভাউচারসমূহ ({journals.length})</span>
            </h3>
            <button
              onClick={() => setSubTab('vouchers')}
              className="text-[13px] text-[#1E5128] hover:underline font-bold cursor-pointer py-1 px-2"
            >
              + নতুন ভাউচার
            </button>
          </div>

          {journals.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-[14px]">
              কোনো জাবেদা রেকর্ড নেই। "+ নতুন ভাউচার" বাটনে ক্লিক করে হিসাব শুরু করুন।
            </div>
          ) : (
            <div className="space-y-3">
              {journals.map((j) => (
                <div
                  key={j.id}
                  className="p-3.5 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 text-[14px]"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#1E5128] text-[15px]">{j.voucherNumber}</span>
                      <span className="px-2 py-0.5 rounded bg-white border border-gray-200 text-xs text-gray-700 font-semibold">
                        {j.voucherType}
                      </span>
                      <span className="text-gray-500 text-[13px]">{j.date}</span>
                    </div>
                    <div className="font-bold text-gray-900 font-mono text-[15px]">
                      মোট: {fmt(j.totalDebit)}
                    </div>
                  </div>

                  <p className="text-gray-800 text-[14px]">{j.narration}</p>

                  {/* Lines preview */}
                  <div className="space-y-1.5 pt-1 text-[13px]">
                    {j.lines.map((line, lIdx) => (
                      <div key={lIdx} className="flex items-center justify-between text-gray-700">
                        <span className="truncate pr-2 font-medium">
                          {line.accountCode} - {line.accountName}
                        </span>
                        <div className="flex gap-3 shrink-0 font-bold">
                          {line.debit > 0 && (
                            <span className="text-[#15803D]">Dr: {fmt(line.debit)}</span>
                          )}
                          {line.credit > 0 && (
                            <span className="text-sky-700">Cr: {fmt(line.credit)}</span>
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
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#1E5128]" />
                <span>সাধারণ খতিয়ান (General Ledger)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">নির্দিষ্ট হিসাবের সমস্ত লেনদেন ও রানিং ব্যালেন্স</p>
            </div>

            {/* Account Selector */}
            <div className="w-full sm:w-80">
              <select
                value={selectedLedgerCode}
                onChange={(e) => loadLedger(e.target.value)}
                className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 focus:outline-none focus:border-[#1E5128] min-h-[44px]"
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
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 flex items-center justify-between text-[14px]">
              <div>
                <span className="font-bold text-gray-900 text-base">
                  {ledgerAccount.code} — {ledgerAccount.nameBn}
                </span>
                <div className="text-gray-600 text-[13px] mt-0.5">
                  শ্রেণী: {ledgerAccount.accountClass} | স্বাভাবিক স্থিতি: {ledgerAccount.normalBalance}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[12px] text-gray-600 font-medium">সর্বশেষ স্থিতি (Net Balance)</div>
                <div className="text-lg font-extrabold text-[#15803D] font-mono">
                  {fmt(ledgerNetBalance)}
                </div>
              </div>
            </div>
          )}

          {/* Ledger Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[13px] text-gray-800">
              <thead className="bg-gray-100 text-gray-600 uppercase text-[11px] font-bold">
                <tr>
                  <th className="p-3">তারিখ</th>
                  <th className="p-3">ভাউচার নং</th>
                  <th className="p-3">বিবরণ</th>
                  <th className="p-3 text-right">ডেবিট (৳)</th>
                  <th className="p-3 text-right">ক্রেডিট (৳)</th>
                  <th className="p-3 text-right">ব্যালেন্স (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-gray-500 text-[14px]">
                      এই হিসাবে এখনো কোনো লেনদেন সংঘটিত হয়নি।
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="p-3 text-gray-600 whitespace-nowrap">{row.date}</td>
                      <td className="p-3 font-bold text-[#1E5128] whitespace-nowrap font-mono">{row.voucherNumber}</td>
                      <td className="p-3 text-gray-800 truncate max-w-xs">{row.narration}</td>
                      <td className="p-3 text-right font-semibold text-[#15803D] whitespace-nowrap">{row.debit > 0 ? fmt(row.debit) : '-'}</td>
                      <td className="p-3 text-right font-semibold text-sky-700 whitespace-nowrap">{row.credit > 0 ? fmt(row.credit) : '-'}</td>
                      <td className="p-3 text-right font-bold text-gray-900 whitespace-nowrap">{fmt(row.runningBalance)}</td>
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
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#1E5128]" />
                <span>রেওয়ামিল (Trial Balance)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">সকল খতিয়ান স্থিতির সমতা ও নির্ভুলতা যাচাই</p>
            </div>

            <div
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                tbIsBalanced && tbOrphanAccounts.length === 0
                  ? 'bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]'
                  : 'bg-red-50 text-red-700 border-red-200 animate-bounce'
              }`}
            >
              {tbIsBalanced && tbOrphanAccounts.length === 0
                ? '✓ রেওয়ামিল সম্পূর্ণ ভারসাম্যপূর্ণ'
                : `⚠️ ভারসাম্যহীন বা অবৈধ হিসাব! পার্থক্য: ৳${tbDifference.toFixed(2)}`}
            </div>
          </div>

          {tbOrphanAccounts.length > 0 && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-800">
              <strong>সতর্কতা:</strong> নিম্নলিখিত হিসাবগুলো চার্ট অব একাউন্টসে বিদ্যমান নেই: {tbOrphanAccounts.join(', ')}।
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[13px] text-gray-800">
              <thead className="bg-gray-100 text-gray-600 uppercase text-[11px] font-bold">
                <tr>
                  <th className="p-3">কোড</th>
                  <th className="p-3">হিসাবের নাম</th>
                  <th className="p-3">শ্রেণী</th>
                  <th className="p-3 text-right">ডেবিট ব্যালেন্স (৳)</th>
                  <th className="p-3 text-right">ক্রেডিট ব্যালেন্স (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tbRows.map((r) => (
                  <tr key={r.code} className={`hover:bg-gray-50 ${r.isOrphan ? 'bg-red-50' : ''}`}>
                    <td className="p-3 text-[#1E5128] font-bold font-mono">{r.code}</td>
                    <td className="p-3 text-gray-900 font-medium">{r.nameBn}</td>
                    <td className="p-3 text-gray-600 text-xs">{r.accountClass}</td>
                    <td className="p-3 text-right font-semibold text-[#15803D]">{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className="p-3 text-right font-semibold text-sky-700">{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-bold text-[14px] border-t-2 border-gray-300">
                <tr>
                  <td colSpan={3} className="p-3.5 text-gray-900">মোট (Total):</td>
                  <td className="p-3.5 text-right text-[#15803D]">{fmt(tbTotalDebit)}</td>
                  <td className="p-3.5 text-right text-sky-700">{fmt(tbTotalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 5: CHART OF ACCOUNTS EXPLORER */}
      {subTab === 'chart' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-[#1E5128]" />
                <span>হিসাবের চার্ট (Chart of Accounts Master)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">হিসাবসমূহের কাঠামো ও শ্রেণীবিভাগ</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAccount(true)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px]"
              >
                + নতুন হিসাব কোড যোগ করুন
              </button>
            )}
          </div>

          {showAddAccount && (
            <form onSubmit={handleCreateAccount} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <h4 className="text-[14px] font-bold text-[#1E5128]">নতুন হিসাব তৈরি (Add Account)</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="কোড (যেমন: 6160)"
                  value={newAccCode}
                  onChange={(e) => setNewAccCode(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  required
                  placeholder="বাংলা নাম"
                  value={newAccNameBn}
                  onChange={(e) => setNewAccNameBn(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <select
                  value={newAccClass}
                  onChange={(e) => setNewAccClass(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
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
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="DEBIT">স্বাভাবিক ব্যালেন্স: DEBIT</option>
                  <option value="CREDIT">স্বাভাবিক ব্যালেন্স: CREDIT</option>
                </select>
              </div>
              <div className="flex gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="p-3.5 rounded-xl bg-[#F8FAFC] border border-gray-200 hover:border-gray-300 transition-colors text-[13px] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-[#1E5128] text-[14px]">{acc.code}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700 font-semibold">
                    {acc.accountClass}
                  </span>
                </div>
                <div className="font-bold text-gray-900 text-[14px]">{acc.nameBn}</div>
                <div className="text-[12px] text-gray-500 italic">{acc.nameEn}</div>
                <div className="text-[12px] text-gray-600 pt-1.5 border-t border-gray-200 flex justify-between font-medium">
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
