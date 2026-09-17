import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  PlusCircle,
  FileText,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Layers,
  ArrowRightLeft,
  Calculator,
  Lock,
  Calendar,
  History,
  X,
  Check,
  Search
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  generateTrialBalance,
  getGeneralLedger,
  postJournalEntry,
  reverseJournalEntry,
  TrialBalanceRow,
  LedgerEntry,
  validateBalancedLines,
  getLatestClosedPeriod,
  getClosedPeriods,
  previewYearEndClosing,
  executeYearEndClosing,
  YearEndClosingPreview
} from '../accounting/accountingEngine';
import { runAutomatedDepreciation } from '../accounting/depreciationService';
import { Account, ClosedPeriod, JournalEntry, JournalLine, UserRole, VoucherType } from '../types';
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
  const [deprRunning, setDeprRunning] = useState(false);

  // Closed Periods State
  const [closedPeriods, setClosedPeriods] = useState<ClosedPeriod[]>([]);
  const [latestClosed, setLatestClosed] = useState<ClosedPeriod | null>(null);
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [closingDate, setClosingDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-12-31`;
  });
  const [closingNotes, setClosingNotes] = useState('');
  const [closingPreview, setClosingPreview] = useState<YearEndClosingPreview | null>(null);
  const [closingLoading, setClosingLoading] = useState(false);
  const [closingExecuting, setClosingExecuting] = useState(false);

  // New Voucher Form State
  const [voucherType, setVoucherType] = useState<VoucherType>('JOURNAL');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [narration, setNarration] = useState('');
  const [reference, setReference] = useState('');
  const [correctionOf, setCorrectionOf] = useState<string | null>(null);
  const [correctingOriginal, setCorrectingOriginal] = useState<JournalEntry | null>(null);
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
  ]);

  // Daybook & Reversal Modal State
  const [searchQuery, setSearchQuery] = useState('');
  const [reversingEntry, setReversingEntry] = useState<JournalEntry | null>(null);

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

      const periods = await getClosedPeriods();
      setClosedPeriods(periods);
      setLatestClosed(periods.length > 0 ? periods[0] : null);

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

  const handleOpenClosingModal = async () => {
    setShowClosingModal(true);
    const dateToPreview = closingDate || new Date().toISOString().split('T')[0];
    await handleFetchClosingPreview(dateToPreview);
  };

  const handleFetchClosingPreview = async (selectedDate: string) => {
    setClosingLoading(true);
    try {
      const preview = await previewYearEndClosing(selectedDate);
      setClosingPreview(preview);
    } catch (err: any) {
      console.error(err);
      setClosingPreview(null);
    } finally {
      setClosingLoading(false);
    }
  };

  const handleConfirmClosing = async () => {
    if (!closingPreview || !closingPreview.canClose || closingExecuting) return;
    setClosingExecuting(true);
    try {
      const res = await executeYearEndClosing({
        closingDate,
        currentUserId,
        notes: closingNotes
      });
      setMsg({
        type: 'success',
        text: `বছর সমাপ্তি (${closingDate}) সফলভাবে সম্পন্ন হয়েছে! পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings) হিসেবে ৳${res.netProfitTransferred.toLocaleString('en-IN')} স্থানান্তর করা হয়েছে${res.journalEntry ? ` (দাখিলা ভাউচার নং: ${res.journalEntry.voucherNumber})` : ''}।`
      });
      setShowClosingModal(false);
      setClosingNotes('');
      await loadBaseData();
    } catch (err: any) {
      setMsg({
        type: 'error',
        text: err.message || 'বছর সমাপ্তি প্রক্রিয়া ব্যর্থ হয়েছে।'
      });
    } finally {
      setClosingExecuting(false);
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

    if (latestClosed && date <= latestClosed.endDate) {
      setMsg({
        type: 'error',
        text: `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosed.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে নতুন জাবেদা পোস্ট বা সংশোধন করা যাবে না। অনুগ্রহ করে সমাপ্তির পরবর্তী কোনো তারিখ নির্বাচন করুন।`
      });
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
        correctionOf: correctionOf || undefined,
        createdBy: currentUserId,
        createdAt: new Date().toISOString()
      });

      // Audit log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: correctionOf ? 'CREATE_CORRECTION_VOUCHER' : 'CREATE_VOUCHER',
        module: 'ACCOUNTING',
        recordId: entryId,
        status: 'SUCCESS',
        details: correctionOf
          ? `সংশোধিত ভাউচার পোস্ট করা হয়েছে: ${voucherNum} (রিভার্সাল ভাউচার ID: ${correctionOf}, পরিমাণ: ৳${balanceCheck.totalDebit})`
          : `ভাউচার পোস্ট করা হয়েছে: ${voucherNum} (৳${balanceCheck.totalDebit})`
      });

      setMsg({
        type: 'success',
        text: correctionOf
          ? `সংশোধিত নতুন ভাউচার ${voucherNum} সফলভাবে সংরক্ষিত ও লিঙ্ক করা হয়েছে!`
          : `ভাউচার ${voucherNum} সফলভাবে সংরক্ষিত হয়েছে!`
      });
      // Reset form
      setNarration('');
      setReference('');
      setCorrectionOf(null);
      setCorrectingOriginal(null);
      setLines([
        { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
        { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
      ]);
      setSubTab('daybook');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ভাউচার সংরক্ষণ করতে ব্যর্থ হয়েছে।' });
    }
  };

  const handleReverseAndCorrect = async (originalEntry: JournalEntry) => {
    if (role !== 'OWNER') {
      setMsg({ type: 'error', text: 'শুধুমাত্র অনুমোদিত মালিক ভাউচার সংশোধন বা রিভার্স করতে পারেন।' });
      return;
    }

    if (originalEntry.reversedBy) {
      setMsg({ type: 'error', text: `এই এন্ট্রিটি (#${originalEntry.voucherNumber}) ইতোমধ্যে সংশোধিত হয়েছে।` });
      return;
    }

    try {
      setLoading(true);
      const result = await reverseJournalEntry(originalEntry.id, currentUserId);

      // Reload so lists show the reversal and the "সংশোধিত" badge on original
      await loadBaseData();

      setMsg({
        type: 'success',
        text: `মূল এন্ট্রি #${originalEntry.voucherNumber} সফলভাবে রিভার্স করা হয়েছে (রিভার্সাল দাখিলা: #${result.reversal.voucherNumber})। এখন নিচে সঠিক তথ্য প্রদান করে সংশোধিত ভাউচারটি সংরক্ষণ করুন।`
      });

      // 4. Immediately open a blank entry form pre-filled with the same accounts/lines as the original,
      // linked via a correctionOf field pointing back to the reversal.
      setCorrectionOf(result.reversal.id);
      setCorrectingOriginal(originalEntry);
      setVoucherType(originalEntry.voucherType || 'JOURNAL');
      setDate(new Date().toISOString().split('T')[0]);
      setNarration(`মূল এন্ট্রি #${originalEntry.id}-এর সংশোধিত সঠিক দাখিলা`);
      setReference(`সংশোধনী: #${result.reversal.voucherNumber}`);
      setLines(
        originalEntry.lines.map((l) => ({
          accountId: l.accountId,
          accountCode: l.accountCode,
          accountName: l.accountName,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo ? `সংশোধনী: ${l.memo}` : ''
        }))
      );

      // Open the voucher form immediately
      setSubTab('vouchers');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'এন্ট্রি সংশোধন করতে ব্যর্থ হয়েছে।' });
    } finally {
      setLoading(false);
      setReversingEntry(null);
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

  const handleRunDepreciationNow = async () => {
    setDeprRunning(true);
    setMsg(null);
    try {
      const res = await runAutomatedDepreciation(currentUserId);
      if (res.entriesPosted > 0) {
        setMsg({
          type: 'success',
          text: `স্থায়ী সম্পদ অবচয় সম্পন্ন: ${res.entriesPosted}টি জাবেদা দাখিলা করা হয়েছে (মোট ৳${res.totalDepreciationAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})।`
        });
      } else {
        setMsg({
          type: 'success',
          text: 'সকল সক্রিয় স্থায়ী সম্পদের অবচয় ইতোমধ্যে হালনাগাদ রয়েছে। নতুন কোনো বকেয়া অবচয় নেই।'
        });
      }
      await loadBaseData();
    } catch (err: any) {
      setMsg({
        type: 'error',
        text: `অবচয় দাখিলায় ত্রুটি: ${err.message}`
      });
    } finally {
      setDeprRunning(false);
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Top Header & Subtabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#1E5128]" />
            <span>দ্বৈত-দাখিলা হিসাবরক্ষণ</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            রশিদ, পরিশোধ, কন্ট্রা, সাধারণ জাবেদা, খতিয়ান ও স্বয়ংক্রিয় রেওয়ামিল
          </p>
        </div>

        {/* Sub Navigation Bar & Run Depreciation Button */}
        <div className="flex flex-wrap items-center gap-2">
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

          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="btn-run-depreciation-now"
              type="button"
              onClick={handleRunDepreciationNow}
              disabled={deprRunning}
              className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px] whitespace-nowrap disabled:opacity-50"
              title="বিগত মাসগুলোর বকেয়া স্থায়ী সম্পদ অবচয় জাবেদা হিসাব ও স্বয়ংক্রিয় দাখিলা করুন"
            >
              <Calculator className={`w-4 h-4 text-amber-700 ${deprRunning ? 'animate-spin' : ''}`} />
              <span>{deprRunning ? 'অবচয় হিসাব হচ্ছে...' : 'এখনই অবচয় হিসাব করুন'}</span>
            </button>

            {role === 'OWNER' && (
              <button
                id="btn-year-end-closing"
                type="button"
                onClick={handleOpenClosingModal}
                className="px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-300 text-purple-900 text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px] whitespace-nowrap"
                title="বছর সমাপ্তি: নির্বাচিত তারিখ পর্যন্ত নিট লাভ হিসাব করে পুঞ্জীভূত লাভ/মুনাফায় স্থানান্তর ও হিসাবকাল সমাপ্ত করুন"
              >
                <Lock className="w-4 h-4 text-purple-700" />
                <span>বছর সমাপ্তি (Year-End Closing)</span>
              </button>
            )}
          </div>
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

          {correctionOf && (
            <div className="mb-4 p-3.5 rounded-xl bg-amber-50/90 border border-amber-300 text-amber-950 flex items-center justify-between flex-wrap gap-2 text-[13px] shadow-2xs">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>সংশোধিত নতুন দাখিলা (Correction Entry):</strong> মূল এন্ট্রির বিপরীতকরণ (Reversal) সম্পন্ন হয়েছে (রিভার্সাল ভাউচার ID: <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-xs">{correctionOf}</code>)। নিচে সঠিক পরিমাণ ও হিসাব তথ্য যাচাই করে নতুন এন্ট্রিটি নিশ্চিত করুন।
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCorrectionOf(null);
                  setCorrectingOriginal(null);
                  setNarration('');
                  setReference('');
                  setLines([
                    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
                    { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
                  ]);
                }}
                className="text-xs text-amber-800 underline hover:text-amber-950 font-bold cursor-pointer"
              >
                সংশোধনী মোড বাতিল করুন
              </button>
            </div>
          )}

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
                  className={`w-full bg-[#F8FAFC] border rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none min-h-[44px] ${
                    latestClosed && date <= latestClosed.endDate
                      ? 'border-red-500 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-300'
                      : 'border-gray-300 focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20'
                  }`}
                />
                {latestClosed && date <= latestClosed.endDate && (
                  <p className="text-[12px] text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>বন্ধ হিসাবকাল: {latestClosed.endDate} বা পূর্বের তারিখে জাবেদা পোস্ট নিষিদ্ধ।</span>
                  </p>
                )}
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
              {correctionOf
                ? 'সংশোধিত ভাউচার নিশ্চিত ও পোস্ট করুন (Post Corrected Voucher)'
                : 'ভাউচার নিশ্চিত ও পোস্ট করুন (Post Balanced Voucher)'}
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
              onClick={() => {
                setCorrectionOf(null);
                setCorrectingOriginal(null);
                setSubTab('vouchers');
              }}
              className="text-[13px] text-[#1E5128] hover:underline font-bold cursor-pointer py-1 px-2"
            >
              + নতুন ভাউচার
            </button>
          </div>

          {/* Search Box */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ভাউচার নম্বর, বিবরণ, বা হিসাবের নাম দিয়ে খুঁজুন..."
                className="w-full pl-10 pr-9 py-2 bg-[#F8FAFC] border border-gray-200 rounded-xl text-[14px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:bg-white transition-all min-h-[42px]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {searchQuery && (
              <div className="text-xs text-gray-500 font-medium whitespace-nowrap">
                ফলাফল:{' '}
                {
                  journals.filter((j) => {
                    const q = searchQuery.toLowerCase().trim();
                    return (
                      j.voucherNumber.toLowerCase().includes(q) ||
                      j.narration.toLowerCase().includes(q) ||
                      j.id.toLowerCase().includes(q) ||
                      (j.reversedBy && ('সংশোধিত'.includes(q) || 'corrected'.includes(q))) ||
                      (j.reversalOf && ('রিভার্সাল'.includes(q) || 'reversal'.includes(q))) ||
                      (j.correctionOf && ('নতুন সংশোধিত'.includes(q) || 'correction'.includes(q))) ||
                      j.lines.some((l) => l.accountCode.includes(q) || l.accountName.toLowerCase().includes(q))
                    );
                  }).length
                }{' '}
                টি ভাউচার
              </div>
            )}
          </div>

          {latestClosed && (
            <div className="mb-4 p-3.5 rounded-xl bg-purple-50/80 border border-purple-200 flex items-center justify-between flex-wrap gap-2 text-[13px] text-purple-950">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-purple-700 shrink-0" />
                <span>
                  <strong>সর্বশেষ সমাপ্ত হিসাবকাল:</strong> {latestClosed.endDate} পর্যন্ত সময়কাল সমাপ্ত (Year-End Closed)। পুঞ্জীভূত লাভে স্থানান্তরিত: <strong>৳{latestClosed.netProfitTransferred.toLocaleString('en-IN')}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] bg-purple-100 text-purple-800 px-2.5 py-1 rounded-full font-semibold border border-purple-200">
                  {latestClosed.endDate} বা পূর্বের তারিখে নতুন দাখিলা নিষিদ্ধ
                </span>
                {role === 'OWNER' && (
                  <button
                    type="button"
                    onClick={handleOpenClosingModal}
                    className="text-[12px] text-purple-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>নতুন সমাপ্তি / বিবরণ</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {journals.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-[14px]">
              কোনো জাবেদা রেকর্ড নেই। "+ নতুন ভাউচার" বাটনে ক্লিক করে হিসাব শুরু করুন।
            </div>
          ) : (
            <div className="space-y-3">
              {journals
                .filter((j) => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase().trim();
                  return (
                    j.voucherNumber.toLowerCase().includes(q) ||
                    j.narration.toLowerCase().includes(q) ||
                    j.id.toLowerCase().includes(q) ||
                    (j.reversedBy && ('সংশোধিত'.includes(q) || 'corrected'.includes(q))) ||
                    (j.reversalOf && ('রিভার্সাল'.includes(q) || 'reversal'.includes(q))) ||
                    (j.correctionOf && ('নতুন সংশোধিত'.includes(q) || 'correction'.includes(q))) ||
                    j.lines.some((l) => l.accountCode.includes(q) || l.accountName.toLowerCase().includes(q))
                  );
                })
                .map((j) => (
                  <div
                    key={j.id}
                    className={`p-3.5 rounded-xl border space-y-2.5 text-[14px] transition-all ${
                      j.reversedBy
                        ? 'bg-amber-50/30 border-amber-200'
                        : j.reversalOf
                        ? 'bg-blue-50/30 border-blue-200'
                        : 'bg-[#F8FAFC] border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-200 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-[#1E5128] text-[15px]">{j.voucherNumber}</span>
                        <span className="px-2 py-0.5 rounded bg-white border border-gray-200 text-xs text-gray-700 font-semibold">
                          {j.voucherType}
                        </span>

                        {/* Badges */}
                        {j.reversedBy && (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center gap-1 shadow-2xs"
                            title={`সংশোধিত এন্ট্রি (রিভার্সাল আইডি: ${j.reversedBy})`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                            সংশোধিত
                          </span>
                        )}

                        {j.reversalOf && (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200 text-xs font-semibold flex items-center gap-1"
                            title={`বিপরীত দাখিলা - মূল ভাউচার আইডি: ${j.reversalOf}`}
                          >
                            <ArrowRightLeft className="w-3 h-3 text-blue-700" />
                            বিপরীত দাখিলা (Reversal)
                          </span>
                        )}

                        {j.correctionOf && (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-semibold flex items-center gap-1"
                            title={`সংশোধিত নতুন দাখিলা - রিভার্সাল আইডি: ${j.correctionOf}`}
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                            নতুন সংশোধিত দাখিলা
                          </span>
                        )}

                        <span className="text-gray-500 text-[13px]">{j.date}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="font-bold text-gray-900 font-mono text-[15px]">
                          মোট: {fmt(j.totalDebit)}
                        </div>
                        {!j.reversedBy && role === 'OWNER' && (
                          <button
                            type="button"
                            onClick={() => setReversingEntry(j)}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 hover:border-amber-400 text-[12px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95"
                            title="এই এন্ট্রিটি সংশোধন বা রিভার্স করুন"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-amber-700" />
                            <span>সংশোধন করুন</span>
                          </button>
                        )}
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
                  <th className="p-3 text-right">অবস্থা ও অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-gray-500 text-[14px]">
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
                      <td className="p-3 text-right whitespace-nowrap">
                        {row.reversedBy ? (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px] inline-flex items-center gap-1 shadow-2xs"
                            title={`সংশোধিত এন্ট্রি (রিভার্সাল আইডি: ${row.reversedBy})`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                            সংশোধিত
                          </span>
                        ) : row.reversalOf ? (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200 font-semibold text-[11px] inline-flex items-center gap-1"
                            title={`বিপরীত দাখিলা - মূল এন্ট্রি আইডি: ${row.reversalOf}`}
                          >
                            রিভার্সাল
                          </span>
                        ) : row.correctionOf ? (
                          <span
                            className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold text-[11px] inline-flex items-center gap-1"
                            title={`সংশোধিত নতুন দাখিলা - রিভার্সাল আইডি: ${row.correctionOf}`}
                          >
                            সংশোধিত দাখিলা
                          </span>
                        ) : (
                          role === 'OWNER' && (
                            <button
                              type="button"
                              onClick={async () => {
                                let entryToReverse = journals.find((j) => j.id === row.journalEntryId);
                                if (!entryToReverse && row.journalEntryId) {
                                  entryToReverse = await db.journalEntries.get(row.journalEntryId);
                                }
                                if (!entryToReverse) {
                                  entryToReverse = await db.journalEntries.where('voucherNumber').equals(row.voucherNumber).first();
                                }
                                if (entryToReverse) {
                                  setReversingEntry(entryToReverse);
                                }
                              }}
                              className="px-2.5 py-1 rounded-md bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 hover:border-amber-400 text-[11px] font-bold transition-all cursor-pointer shadow-2xs"
                              title="এই এন্ট্রিটি সংশোধন করুন"
                            >
                              সংশোধন করুন
                            </button>
                          )
                        )}
                      </td>
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

      {/* YEAR-END CLOSING MODAL */}
      {showClosingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-purple-50/50 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">বছর সমাপ্তি প্রক্রিয়া (Year-End Closing)</h3>
                  <p className="text-xs text-gray-600">হিসাবকাল সমাপ্তি ও পুঞ্জীভূত লাভে (Retained Earnings) স্থানান্তর</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowClosingModal(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-sm text-gray-800">
              {/* Notice Banner */}
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-950">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>হিসাবরক্ষণ বিধি ও অপরিবর্তনীয়তা নীতি</span>
                </div>
                <p>
                  • এই প্রক্রিয়ায় পূর্ববর্তী কোনো জাবেদা ভাউচার ডিলিট বা পরিবর্তন হবে না।
                </p>
                <p>
                  • শুধুমাত্র একটি সারসংক্ষেপ সমন্বয় দাখিলা দ্বারা পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings - কোড ৩০৫০) হিসাবে নিট লাভ স্থানান্তর হবে।
                </p>
                <p>
                  • সমাপ্তি তারিখ বা তার পূর্বের যেকোনো তারিখে আর কোনো নতুন জাবেদা পোস্ট করা যাবে না (হিসাব সিলগালা)।
                </p>
              </div>

              {/* Date Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-gray-800">
                  সমাপ্তি তারিখ (Closing End Date)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={closingDate}
                    onChange={(e) => {
                      setClosingDate(e.target.value);
                      handleFetchClosingPreview(e.target.value);
                    }}
                    className="flex-1 bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm font-sans focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleFetchClosingPreview(closingDate)}
                    disabled={closingLoading}
                    className="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                  >
                    {closingLoading ? 'গণনা হচ্ছে...' : 'হিসাব রিফ্রেশ'}
                  </button>
                </div>
              </div>

              {/* Preview calculation */}
              {closingPreview && (
                <div className="space-y-3">
                  {!closingPreview.canClose ? (
                    <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>সমাপ্তি সম্ভব নয়:</strong> {closingPreview.blockReason}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-2.5">
                      <div className="text-xs font-bold text-gray-700 pb-1.5 border-b border-gray-200 flex justify-between">
                        <span>শুরু হতে {closingDate} পর্যন্ত আর্থিক সারাংশ</span>
                        <span className="text-purple-700">লাভ-ক্ষতি বিবরণী হতে গণনাকৃত</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="text-gray-600">মোট বিক্রয় ও পরিচালন আয়:</div>
                        <div className="text-right font-mono font-bold text-gray-900">৳{closingPreview.totalRevenue.toLocaleString('en-IN')}</div>

                        <div className="text-gray-600">বিক্রিত পণ্যের ব্যয় (COGS):</div>
                        <div className="text-right font-mono font-bold text-red-700">(৳{closingPreview.totalCogs.toLocaleString('en-IN')})</div>

                        <div className="text-gray-600 font-semibold">মোট লাভ (Gross Profit):</div>
                        <div className="text-right font-mono font-bold text-emerald-800">৳{closingPreview.grossProfit.toLocaleString('en-IN')}</div>

                        <div className="text-gray-600">মোট পরিচালন ব্যয়:</div>
                        <div className="text-right font-mono font-bold text-red-700">(৳{closingPreview.totalOperatingExpenses.toLocaleString('en-IN')})</div>

                        <div className="text-gray-600 font-semibold">পরিচালন মুনাফা (Operating Profit):</div>
                        <div className="text-right font-mono font-bold text-gray-900">৳{closingPreview.operatingProfit.toLocaleString('en-IN')}</div>

                        <div className="text-gray-600">অন্যান্য নিট আয়/ব্যয়:</div>
                        <div className="text-right font-mono text-gray-700">৳{(closingPreview.totalOtherIncome - closingPreview.totalOtherExpenses).toLocaleString('en-IN')}</div>
                      </div>

                      <div className="pt-2 border-t border-gray-200 space-y-1.5 text-xs">
                        <div className="flex justify-between items-center text-gray-700">
                          <span>মোট গণনাকৃত নিট লাভ (শুরু হতে {closingDate}):</span>
                          <span className="font-mono font-bold text-gray-900">৳{closingPreview.netProfit.toLocaleString('en-IN')}</span>
                        </div>

                        {closingPreview.previousTransferred !== 0 && (
                          <div className="flex justify-between items-center text-gray-600">
                            <span>পূর্ববর্তী সমাপ্তিতে স্থানান্তরিত লাভ:</span>
                            <span className="font-mono text-gray-700">৳{closingPreview.previousTransferred.toLocaleString('en-IN')}</span>
                          </div>
                        )}

                        <div className="flex justify-between items-center p-2.5 rounded-lg bg-purple-100/70 text-purple-950 font-bold text-sm">
                          <span>এই সমাপ্তিতে স্থানান্তরিতব্য নিট লাভ:</span>
                          <span className="font-mono text-base text-purple-900">৳{closingPreview.netProfitToTransfer.toLocaleString('en-IN')}</span>
                        </div>
                      </div>

                      {/* Journal Entry Preview */}
                      <div className="pt-2 border-t border-purple-200/60 text-xs space-y-1 text-purple-900">
                        <div className="font-bold">সমন্বয় দাখিলা পূর্বরূপ (Journal Entry Preview):</div>
                        <div className="p-2.5 rounded-lg bg-white border border-purple-200 font-mono text-[11px] space-y-1">
                          {closingPreview.netProfitToTransfer >= 0 ? (
                            <>
                              <div className="flex justify-between text-gray-700">
                                <span>ডেবিট: ৩০৬০ - আয় সারাংশ হিসাব (Income Summary)</span>
                                <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                              </div>
                              <div className="flex justify-between text-emerald-800 font-bold">
                                <span>ক্রেডিট: ৩০৫০ - পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)</span>
                                <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex justify-between text-red-800 font-bold">
                                <span>ডেবিট: ৩০৫০ - পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)</span>
                                <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                              </div>
                              <div className="flex justify-between text-gray-700">
                                <span>ক্রেডিট: ৩০৬০ - আয় সারাংশ হিসাব (Income Summary)</span>
                                <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes Field */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-gray-700">সমাপ্তি মন্তব্য / বিবরণ (Notes)</label>
                <input
                  type="text"
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="যেমন: ২০২৫ অর্থবছর সমাপ্তি ও পুঞ্জীভূত লাভে স্থানান্তর"
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
                />
              </div>

              {/* Previous Closed Periods List if any */}
              {closedPeriods.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-gray-100">
                  <div className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-gray-500" />
                    <span>পূর্ববর্তী সমাপ্ত হিসাবকালসমূহ ({closedPeriods.length})</span>
                  </div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {closedPeriods.map((p) => (
                      <div key={p.id} className="p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs flex items-center justify-between">
                        <div>
                          <span className="font-bold text-gray-900">শেষ তারিখ: {p.endDate}</span>
                          <span className="text-gray-500 text-[11px] ml-2">({new Date(p.closedAt).toLocaleDateString('bn-BD')})</span>
                        </div>
                        <div className="font-mono font-bold text-purple-900">
                          ৳{p.netProfitTransferred.toLocaleString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setShowClosingModal(false)}
                disabled={closingExecuting}
                className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 text-xs font-bold hover:bg-gray-100 cursor-pointer transition-colors"
              >
                বাতিল করুন
              </button>
              <button
                type="button"
                onClick={handleConfirmClosing}
                disabled={!closingPreview?.canClose || closingExecuting || closingLoading}
                className="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer transition-colors shadow-xs flex items-center gap-2"
              >
                {closingExecuting ? (
                  <span>সমাপ্তি পোস্ট হচ্ছে...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>বছর সমাপ্তি নিশ্চিত করুন</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REVERSAL CONFIRMATION MODAL */}
      {reversingEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5 text-amber-700">
                <ArrowRightLeft className="w-6 h-6 shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">ভুল এন্ট্রি সংশোধন ও বিপরীতকরণ</h3>
              </div>
              <button
                type="button"
                onClick={() => setReversingEntry(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-amber-950 text-[13px] space-y-2">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>হিসাবরক্ষণ নীতি (Never Delete, Always Traceable Reversal):</span>
              </p>
              <p className="text-gray-700">
                হিসাবরক্ষণ স্বচ্ছতা বজায় রাখতে ডাটাবেজ থেকে এন্ট্রি মুছে ফেলা হয় না। আপনি সংশোধন নিশ্চিত করলে:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700 font-medium">
                <li>আজকের তারিখে স্বয়ংক্রিয়ভাবে একটি বিপরীত সমপরিমাণ দাখিলা (Reversal Entry) পোস্ট হবে।</li>
                <li>মূল ভাউচারটিতে স্থায়ীভাবে <strong>"সংশোধিত"</strong> ব্যাজ দৃশ্যমান থাকবে।</li>
                <li>এরপর সাথে সাথে একই হিসাব লাইনসমূহ প্রি-ফিল্ড অবস্থায় নতুন ভাউচার ফর্ম খুলবে, যাতে আপনি সরাসরি সঠিক তথ্য দিয়ে সংশোধিত ভাউচার পোস্ট করতে পারেন।</li>
              </ol>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-[13px] space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-gray-500 font-sans">ভাউচার নম্বর:</span>
                <span className="font-bold text-gray-900">{reversingEntry.voucherNumber} ({reversingEntry.voucherType})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-sans">তারিখ:</span>
                <span className="text-gray-800">{reversingEntry.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 font-sans">বিবরণ:</span>
                <span className="text-gray-800 truncate max-w-xs">{reversingEntry.narration}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-gray-200">
                <span className="text-gray-500 font-sans">মোট পরিমাণ:</span>
                <span className="font-bold text-emerald-800 font-sans text-[14px]">৳{reversingEntry.totalDebit.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setReversingEntry(null)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
              >
                বাতিল করুন
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleReverseAndCorrect(reversingEntry)}
                className="px-5 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] disabled:bg-gray-300 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                {loading ? 'প্রক্রিয়াকরণ হচ্ছে...' : 'বিপরীত দাখিলা নিশ্চিত ও সংশোধন করুন'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
