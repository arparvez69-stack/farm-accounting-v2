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
  Search,
  Repeat,
  Edit2,
  Clock,
  Scale,
  User
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
import { Account, ClosedPeriod, JournalEntry, JournalLine, RecurringExpenseTemplate, UserRole, VoucherType } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { HIGH_AMOUNT_CONFIRMATION_THRESHOLD } from '../constants/validation';
import { notifyUndoableAction } from '../services/undoService';
import { StatusBadge, Card, SearchableSelect, SearchableOption } from './ui';
import { synchronizePendingData } from '../firebase/firebaseClient';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type AccountingSubTab = 'vouchers' | 'daybook' | 'ledger' | 'trialBalance' | 'chart' | 'recurring';

// Helper: auto-generate the next available code based on the selected account class
export const getNextAccountCode = (
  accountClass: Account['accountClass'],
  existingAccounts: Account[]
): string => {
  const classRange: Record<Account['accountClass'], { min: number; max: number; defaultStart: number }> = {
    ASSET: { min: 1000, max: 1999, defaultStart: 1010 },
    LIABILITY: { min: 2000, max: 2999, defaultStart: 2010 },
    EQUITY: { min: 3000, max: 3999, defaultStart: 3010 },
    REVENUE: { min: 4000, max: 4999, defaultStart: 4010 },
    COGS: { min: 5000, max: 5999, defaultStart: 5010 },
    EXPENSE: { min: 6000, max: 6999, defaultStart: 6010 },
    OTHER_INCOME: { min: 4000, max: 4999, defaultStart: 4090 },
    OTHER_EXPENSE: { min: 6000, max: 6999, defaultStart: 6090 }
  };

  const config = classRange[accountClass] || { min: 6000, max: 6999, defaultStart: 6010 };
  const usedCodes = new Set(existingAccounts.map((a) => a.code.trim()));

  const numericCodes = existingAccounts
    .map((a) => parseInt(a.code.trim(), 10))
    .filter((n) => !isNaN(n) && n >= config.min && n <= config.max);

  if (numericCodes.length === 0) {
    return String(config.defaultStart);
  }

  const maxCode = Math.max(...numericCodes);
  let candidate = (Math.floor(maxCode / 10) + 1) * 10;
  if (candidate <= config.max && !usedCodes.has(String(candidate)) && candidate !== 1050) {
    return String(candidate);
  }

  // Scan for any unused multiple of 10 in the range
  for (let c = config.min + 10; c <= config.max; c += 10) {
    if (c === 1050) continue;
    if (!usedCodes.has(String(c))) {
      return String(c);
    }
  }

  // Fallback to sequential numeric
  for (let c = config.min + 1; c <= config.max; c++) {
    if (c === 1050) continue;
    if (!usedCodes.has(String(c))) {
      return String(c);
    }
  }

  return String(maxCode + 1);
};

// Helper: infer normal balance automatically from account class
export const inferNormalBalance = (
  accountClass: Account['accountClass']
): 'DEBIT' | 'CREDIT' => {
  if (
    accountClass === 'ASSET' ||
    accountClass === 'EXPENSE' ||
    accountClass === 'COGS' ||
    accountClass === 'OTHER_EXPENSE'
  ) {
    return 'DEBIT';
  }
  return 'CREDIT';
};

export const AccountingModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [subTab, setSubTab] = useState<AccountingSubTab>('daybook');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deprRunning, setDeprRunning] = useState(false);
  const [confirmHighAmountVoucher, setConfirmHighAmountVoucher] = useState<{ amount: number } | null>(null);

  // Memoized account options for SearchableSelect
  const accountOptions = React.useMemo<SearchableOption[]>(() => {
    return accounts.map((acc) => ({
      value: acc.code,
      label: acc.nameBn,
      code: acc.code,
      secondaryLabel: acc.accountClass,
      subtitle: acc.nameEn
    }));
  }, [accounts]);

  // Recurring Expense Templates State
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringExpenseTemplate[]>([]);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [recDescription, setRecDescription] = useState('');
  const [recAmount, setRecAmount] = useState<string>('');
  const [recAccountCode, setRecAccountCode] = useState<string>('6110');
  const [recDayOfMonth, setRecDayOfMonth] = useState<number>(1);
  const [recActive, setRecActive] = useState<boolean>(true);

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
  const [voucherMode, setVoucherMode] = useState<'SIMPLE' | 'ADVANCED'>('SIMPLE');
  const [simpleFromAccount, setSimpleFromAccount] = useState<string>(''); // Money going OUT of (credited)
  const [simpleToAccount, setSimpleToAccount] = useState<string>(''); // Money coming INTO (debited)
  const [simpleAmount, setSimpleAmount] = useState<string>('');
  const [relatedPerson, setRelatedPerson] = useState<string>('');
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
  const [daybookVisibleCount, setDaybookVisibleCount] = useState(25);
  const [reversingEntry, setReversingEntry] = useState<JournalEntry | null>(null);

  // General Ledger State
  const [selectedLedgerCode, setSelectedLedgerCode] = useState<string>('1010');
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerAccount, setLedgerAccount] = useState<Account | undefined>();
  const [ledgerNetBalance, setLedgerNetBalance] = useState(0);
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState('');
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(25);

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

  useEffect(() => {
    loadBaseData();
  }, [subTab]);

  useEffect(() => {
    const handleDataChanged = () => {
      loadBaseData();
    };
    window.addEventListener('goted_data_changed', handleDataChanged);
    return () => window.removeEventListener('goted_data_changed', handleDataChanged);
  }, []);

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
      } else if (subTab === 'recurring') {
        const templates = await db.recurringExpenseTemplates.toArray();
        setRecurringTemplates(templates);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadRecurringTemplates = async () => {
    try {
      const templates = await db.recurringExpenseTemplates.toArray();
      setRecurringTemplates(templates);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCreateRecurring = () => {
    setEditingTemplateId(null);
    setRecDescription('');
    setRecAmount('');
    const defaultExpense = accounts.find((a) => a.accountClass === 'EXPENSE');
    setRecAccountCode(defaultExpense ? defaultExpense.code : '6110');
    setRecDayOfMonth(1);
    setRecActive(true);
    setShowRecurringModal(true);
  };

  const handleOpenEditRecurring = (template: RecurringExpenseTemplate) => {
    setEditingTemplateId(template.id);
    setRecDescription(template.description);
    setRecAmount(String(template.amount));
    setRecAccountCode(template.accountCode);
    setRecDayOfMonth(template.dayOfMonth);
    setRecActive(template.active);
    setShowRecurringModal(true);
  };

  const handleSaveRecurringTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(recAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      setMsg({ type: 'error', text: 'অনুগ্রহ করে খরচের সঠিক পরিমাণ (৳) প্রদান করুন।' });
      return;
    }
    if (!recDescription.trim()) {
      setMsg({ type: 'error', text: 'অনুগ্রহ করে খরচের বিবরণ প্রদান করুন।' });
      return;
    }
    const day = Math.min(31, Math.max(1, parseInt(String(recDayOfMonth), 10) || 1));

    try {
      if (editingTemplateId) {
        await db.recurringExpenseTemplates.update(editingTemplateId, {
          description: recDescription.trim(),
          amount: amountVal,
          accountCode: recAccountCode,
          dayOfMonth: day,
          active: recActive
        });
        setMsg({ type: 'success', text: `পুনরাবৃত্ত খরচ "${recDescription.trim()}" সফলভাবে আপডেট করা হয়েছে!` });
      } else {
        const newId = generateUniqueId('rec');
        await safeInsert(db.recurringExpenseTemplates, {
          id: newId,
          description: recDescription.trim(),
          amount: amountVal,
          accountCode: recAccountCode,
          dayOfMonth: day,
          active: recActive
        });
        setMsg({ type: 'success', text: `নতুন পুনরাবৃত্ত খরচ "${recDescription.trim()}" তৈরি করা হয়েছে!` });
      }

      setShowRecurringModal(false);
      await loadRecurringTemplates();
      window.dispatchEvent(new Event('goted_data_changed'));
    } catch (err: any) {
      setMsg({ type: 'error', text: `সংরক্ষণ ব্যর্থ হয়েছে: ${err.message || 'অজানা ত্রুটি'}` });
    }
  };

  const handleToggleRecurringActive = async (template: RecurringExpenseTemplate) => {
    try {
      await db.recurringExpenseTemplates.update(template.id, { active: !template.active });
      await loadRecurringTemplates();
      setMsg({
        type: 'success',
        text: `টেমপ্লেট "${template.description}" ${!template.active ? 'সক্রিয়' : 'নিষ্ক্রিয়'} করা হয়েছে।`
      });
      window.dispatchEvent(new Event('goted_data_changed'));
    } catch (err: any) {
      setMsg({ type: 'error', text: 'স্ট্যাটাস পরিবর্তনে ত্রুটি।' });
    }
  };

  const handleDeleteRecurringTemplate = async (id: string, name: string) => {
    if (!window.confirm(`আপনি কি নিশ্চিত যে পুনরাবৃত্ত খরচ টেমপ্লেট "${name}" মুছে ফেলতে চান?`)) {
      return;
    }
    try {
      await db.recurringExpenseTemplates.delete(id);
      await loadRecurringTemplates();
      setMsg({ type: 'success', text: `পুনরাবৃত্ত খরচ "${name}" মুছে ফেলা হয়েছে।` });
      window.dispatchEvent(new Event('goted_data_changed'));
    } catch (err: any) {
      setMsg({ type: 'error', text: 'মুছে ফেলতে ব্যর্থ হয়েছে।' });
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
    setLedgerVisibleCount(25);
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

  const resetVoucherForm = () => {
    setVoucherMode('SIMPLE');
    setSimpleFromAccount('');
    setSimpleToAccount('');
    setSimpleAmount('');
    setRelatedPerson('');
    setNarration('');
    setReference('');
    setCorrectionOf(null);
    setCorrectingOriginal(null);
    setLines([
      { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' },
      { accountId: '', accountCode: '', accountName: '', debit: 0, credit: 0, memo: '' }
    ]);
  };

  const getEffectiveLines = (): JournalLine[] => {
    if (voucherMode === 'SIMPLE') {
      const fromAcc = accounts.find((a) => a.code === simpleFromAccount);
      const toAcc = accounts.find((a) => a.code === simpleToAccount);
      const amt = parseFloat(simpleAmount) || 0;
      return [
        {
          accountId: toAcc?.id || '',
          accountCode: toAcc?.code || simpleToAccount,
          accountName: toAcc?.nameBn || '',
          debit: amt,
          credit: 0,
          memo: ''
        },
        {
          accountId: fromAcc?.id || '',
          accountCode: fromAcc?.code || simpleFromAccount,
          accountName: fromAcc?.nameBn || '',
          debit: 0,
          credit: amt,
          memo: ''
        }
      ];
    }
    return lines;
  };

  const handleSwitchMode = (targetMode: 'SIMPLE' | 'ADVANCED') => {
    if (targetMode === voucherMode) return;
    if (targetMode === 'ADVANCED') {
      const amt = parseFloat(simpleAmount) || 0;
      if (simpleFromAccount || simpleToAccount || amt > 0) {
        const from = accounts.find((a) => a.code === simpleFromAccount);
        const to = accounts.find((a) => a.code === simpleToAccount);
        setLines([
          {
            accountId: to?.id || '',
            accountCode: to?.code || simpleToAccount,
            accountName: to?.nameBn || '',
            debit: amt,
            credit: 0,
            memo: ''
          },
          {
            accountId: from?.id || '',
            accountCode: from?.code || simpleFromAccount,
            accountName: from?.nameBn || '',
            debit: 0,
            credit: amt,
            memo: ''
          }
        ]);
      }
    } else {
      // Switching from ADVANCED to SIMPLE: check if exactly 1 debit and 1 credit line
      const debitLine = lines.find((l) => Number(l.debit) > 0 && Number(l.credit) === 0);
      const creditLine = lines.find((l) => Number(l.credit) > 0 && Number(l.debit) === 0);
      if (lines.length === 2 && debitLine && creditLine) {
        setSimpleToAccount(debitLine.accountCode);
        setSimpleFromAccount(creditLine.accountCode);
        setSimpleAmount(String(debitLine.debit));
      }
    }
    setVoucherMode(targetMode);
  };

  let balanceCheck = { isBalanced: false, totalDebit: 0, totalCredit: 0, difference: 0 };
  if (voucherMode === 'SIMPLE') {
    const fromAcc = accounts.find((a) => a.code === simpleFromAccount);
    const toAcc = accounts.find((a) => a.code === simpleToAccount);
    const amt = parseFloat(simpleAmount) || 0;
    const isBalanced = Boolean(
      fromAcc &&
      toAcc &&
      simpleFromAccount &&
      simpleToAccount &&
      simpleFromAccount !== simpleToAccount &&
      amt > 0
    );
    balanceCheck = {
      isBalanced,
      totalDebit: amt > 0 ? amt : 0,
      totalCredit: amt > 0 ? amt : 0,
      difference: 0
    };
  } else {
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
  }

  const executeSaveVoucher = async () => {
    try {
      const linesToSave = getEffectiveLines();
      validateBalancedLines(linesToSave, accounts);

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
        lines: linesToSave,
        correctionOf: correctionOf || undefined,
        relatedPerson: relatedPerson.trim() || undefined,
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
          ? `সংশোধিত ভাউচার পোস্ট করা হয়েছে: ${voucherNum} (রিভার্সাল ভাউচার ID: ${correctionOf}, পরিমাণ: ৳${balanceCheck.totalDebit}${relatedPerson.trim() ? `, সংশ্লিষ্ট ব্যক্তি: ${relatedPerson.trim()}` : ''})`
          : `ভাউচার পোস্ট করা হয়েছে: ${voucherNum} (৳${balanceCheck.totalDebit}${relatedPerson.trim() ? `, সংশ্লিষ্ট ব্যক্তি: ${relatedPerson.trim()}` : ''})`
      });

      setMsg({
        type: 'success',
        text: correctionOf
          ? `সংশোধিত নতুন ভাউচার ${voucherNum} সফলভাবে সংরক্ষিত ও লিঙ্ক করা হয়েছে!`
          : `ভাউচার ${voucherNum} সফলভাবে সংরক্ষিত হয়েছে!`
      });

      notifyUndoableAction({
        type: 'JOURNAL_ENTRY',
        journalEntryId: entryId,
        currentUserId
      });
      // Reset form
      resetVoucherForm();
      setSubTab('daybook');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ভাউচার সংরক্ষণ করতে ব্যর্থ হয়েছে।' });
    }
  };

  const handleSubmitVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (role !== 'OWNER') {
      setMsg({ type: 'error', text: 'শুধুমাত্র অনুমোদিত মালিক ভাউচার পোস্ট করতে পারেন।' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (date > todayStr) {
      setMsg({
        type: 'error',
        text: `ভাউচারের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    if (latestClosed && date <= latestClosed.endDate) {
      setMsg({
        type: 'error',
        text: `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosed.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে নতুন জাবেদা পোস্ট বা সংশোধন করা যাবে না। অনুগ্রহ করে সমাপ্তির পরবর্তী কোনো তারিখ নির্বাচন করুন।`
      });
      return;
    }

    if (voucherMode === 'SIMPLE') {
      if (!simpleFromAccount) {
        setMsg({ type: 'error', text: 'কোন হিসাব থেকে টাকা যাচ্ছে (From Account) তা নির্বাচন করুন।' });
        return;
      }
      if (!simpleToAccount) {
        setMsg({ type: 'error', text: 'কোন হিসাবে টাকা আসছে (To Account) তা নির্বাচন করুন।' });
        return;
      }
      if (simpleFromAccount === simpleToAccount) {
        setMsg({ type: 'error', text: 'টাকা যাওয়ার হিসাব ও টাকা আসার হিসাব একই হতে পারে না।' });
        return;
      }
      const amt = parseFloat(simpleAmount);
      if (!amt || isNaN(amt) || amt <= 0) {
        setMsg({ type: 'error', text: 'টাকার পরিমাণ শূণ্যের চেয়ে বেশি হতে হবে।' });
        return;
      }
    }

    try {
      const linesToValidate = getEffectiveLines();
      // Validate lines strictly against accounts list
      validateBalancedLines(linesToValidate, accounts);

      if (balanceCheck.totalDebit > HIGH_AMOUNT_CONFIRMATION_THRESHOLD) {
        setConfirmHighAmountVoucher({ amount: balanceCheck.totalDebit });
        return;
      }

      await executeSaveVoucher();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ভাউচার তথ্য সঠিক নয়।' });
    }
  };

  const handleReverseAndCorrect = async (originalEntry: JournalEntry) => {
    if (role !== 'OWNER') {
      setMsg({ type: 'error', text: 'শুধুমাত্র অনুমোদিত মালিক ভাউচার সংশোধন বা রিভার্স করতে পারেন।' });
      return;
    }

    if (originalEntry.reversedBy || originalEntry.reversalOf || originalEntry.status === 'REVERSED') {
      setMsg({ type: 'error', text: `এই এন্ট্রিটি (#${originalEntry.voucherNumber}) ইতোমধ্যে সংশোধিত/রিভার্স করা হয়েছে।` });
      setReversingEntry(null);
      return;
    }

    try {
      setLoading(true);
      const fresh = await db.journalEntries.get(originalEntry.id);
      if (!fresh || fresh.reversedBy || fresh.reversalOf || fresh.status === 'REVERSED') {
        setMsg({ type: 'error', text: `এই এন্ট্রিটি ইতোমধ্যে সংশোধিত/রিভার্স করা হয়েছে। ডুপ্লিকেট রিভার্সাল প্রতিরোধ করা হয়েছে।` });
        setReversingEntry(null);
        return;
      }
      setReversingEntry(null);
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
      setRelatedPerson(originalEntry.relatedPerson || '');
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

      // Default to Simple mode; automatically switch to Advanced mode when editing or reversing a voucher that already has more than 2 lines.
      if (originalEntry.lines.length > 2) {
        setVoucherMode('ADVANCED');
      } else {
        const debitLine = originalEntry.lines.find((l) => Number(l.debit) > 0 && Number(l.credit) === 0);
        const creditLine = originalEntry.lines.find((l) => Number(l.credit) > 0 && Number(l.debit) === 0);
        if (originalEntry.lines.length === 2 && debitLine && creditLine) {
          setVoucherMode('SIMPLE');
          setSimpleToAccount(debitLine.accountCode);
          setSimpleFromAccount(creditLine.accountCode);
          setSimpleAmount(String(debitLine.debit));
        } else {
          setVoucherMode('ADVANCED');
        }
      }

      // Open the voucher form immediately
      setSubTab('vouchers');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'এন্ট্রি সংশোধন করতে ব্যর্থ হয়েছে।' });
    } finally {
      setLoading(false);
      setReversingEntry(null);
    }
  };

  const handleOpenAddAccount = () => {
    const initialClass: Account['accountClass'] = 'EXPENSE';
    setNewAccClass(initialClass);
    setNewAccCode(getNextAccountCode(initialClass, accounts));
    setNewAccNameBn('');
    setNewAccNameEn('');
    setShowAddAccount(true);
  };

  const handleAccountClassChange = (selectedClass: Account['accountClass']) => {
    setNewAccClass(selectedClass);
    setNewAccCode(getNextAccountCode(selectedClass, accounts));
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccNameBn.trim()) return;

    const codeToUse = newAccCode.trim() || getNextAccountCode(newAccClass, accounts);
    if (!codeToUse) return;

    if (codeToUse === '1050') {
      alert('১০৫০ কোড তৈরি বা ব্যবহার করা নিষিদ্ধ।');
      return;
    }

    try {
      const existing = await db.accounts.where('code').equals(codeToUse).first();
      if (existing) {
        alert('এই হিসাব কোডটি ইতিমধ্যে ব্যবহৃত হচ্ছে।');
        return;
      }

      const nowIso = new Date().toISOString();
      const acc: Account = {
        id: `acc_${codeToUse}`,
        code: codeToUse,
        nameBn: newAccNameBn.trim(),
        nameEn: newAccNameEn.trim() || newAccNameBn.trim(),
        accountClass: newAccClass,
        normalBalance: inferNormalBalance(newAccClass),
        isSystem: false,
        isActive: true,
        synced: false,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await safeInsert(db.accounts, acc);
      setShowAddAccount(false);
      setNewAccCode('');
      setNewAccNameBn('');
      setNewAccNameEn('');
      loadBaseData();
      synchronizePendingData().catch(() => {});
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
    <div className="space-y-4 pb-6 max-w-5xl mx-auto rounded-3xl p-2 sm:p-4 bg-gradient-to-b from-blue-500/[0.08] via-sky-500/[0.03] to-transparent dark:from-blue-950/30 dark:via-blue-950/10 dark:to-transparent">
      {/* Module Header Illustration */}
      <div
        className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
        }}
      >
        <img
          src="/illustrations/Payment_Information-bro.svg"
          alt="Accounting Payment Information illustration"
          loading="lazy"
          className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
        />
      </div>

      {/* Top Header & Subtabs */}
      <div className="flex flex-col gap-3.5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-700" />
              <span>দ্বৈত-দাখিলা হিসাবরক্ষণ</span>
            </h2>
            <p className="text-[14px] text-gray-600 mt-0.5">
              রশিদ, পরিশোধ, কন্ট্রা, সাধারণ জাবেদা, খতিয়ান ও স্বয়ংক্রিয় রেওয়ামিল
            </p>
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

        {/* Sub Navigation Tabs Grid */}
        <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 bg-blue-50/50 dark:bg-slate-800/80 border border-blue-100 dark:border-slate-700 p-1.5 rounded-xl text-[13px] font-semibold">
          <button
            type="button"
            onClick={() => setSubTab('daybook')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'daybook'
                ? 'bg-blue-700 text-white shadow-xs border border-blue-700'
                : 'bg-white dark:bg-slate-900/60 text-blue-950 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800 hover:bg-blue-100/80'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>জাবেদা তালিকা</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('vouchers')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'vouchers'
                ? 'bg-emerald-700 text-white shadow-xs border border-emerald-700'
                : 'bg-white dark:bg-slate-900/60 text-emerald-950 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 hover:bg-emerald-100/80'
            }`}
          >
            <PlusCircle className="w-4 h-4 shrink-0" />
            <span>নতুন ভাউচার</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('ledger')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'ledger'
                ? 'bg-indigo-700 text-white shadow-xs border border-indigo-700'
                : 'bg-white dark:bg-slate-900/60 text-indigo-950 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 hover:bg-indigo-100/80'
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>খতিয়ান</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('trialBalance')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'trialBalance'
                ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
                : 'bg-white dark:bg-slate-900/60 text-amber-950 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800 hover:bg-amber-100/80'
            }`}
          >
            <Scale className="w-4 h-4 shrink-0" />
            <span>রেওয়ামিল</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('chart')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'chart'
                ? 'bg-teal-700 text-white shadow-xs border border-teal-700'
                : 'bg-white dark:bg-slate-900/60 text-teal-950 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800 hover:bg-teal-100/80'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <span>হিসাবের চার্ট</span>
          </button>
          <button
            type="button"
            id="tab-btn-recurring-costs"
            onClick={() => setSubTab('recurring')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              subTab === 'recurring'
                ? 'bg-rose-700 text-white shadow-xs border border-rose-700'
                : 'bg-white dark:bg-slate-900/60 text-rose-950 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800 hover:bg-rose-100/80'
            }`}
          >
            <Repeat className="w-4 h-4 shrink-0" />
            <span>পুনরাবৃত্ত খরচ</span>
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
              <PlusCircle className="w-5 h-5 text-blue-700" />
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
                  resetVoucherForm();
                }}
                className="text-xs text-amber-800 underline hover:text-amber-950 font-bold cursor-pointer"
              >
                সংশোধনী মোড বাতিল করুন
              </button>
            </div>
          )}

          <form onSubmit={handleSubmitVoucher} className="space-y-4">
            {/* Mode Toggle: Simple vs Advanced */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2.5">
              <div className="inline-flex p-1 bg-gray-100 rounded-xl border border-gray-200">
                <button
                  type="button"
                  id="btn-voucher-mode-simple"
                  onClick={() => handleSwitchMode('SIMPLE')}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    voucherMode === 'SIMPLE'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span>সহজ (Simple)</span>
                </button>
                <button
                  type="button"
                  id="btn-voucher-mode-advanced"
                  onClick={() => handleSwitchMode('ADVANCED')}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    voucherMode === 'ADVANCED'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span>উন্নত/একাধিক লাইন (Advanced/Multi-line)</span>
                </button>
              </div>

              <div className="text-xs text-gray-500 font-medium">
                {voucherMode === 'SIMPLE' ? (
                  <span>সাধারণ লেনদেন: একটি টাকা বহির্গমন ও একটি আগমন হিসাব</span>
                ) : (
                  <span>জটিল লেনদেন: ইচ্ছামত একাধিক ডেবিট/ক্রেডিট লাইন যোগ করুন</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-1.5">
                  ভাউচারের ধরন (Voucher Type)
                </label>
                <select
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value as VoucherType)}
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
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
                    (latestClosed && date <= latestClosed.endDate) || date > new Date().toISOString().split('T')[0]
                      ? 'border-red-500 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-300'
                      : 'border-gray-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20'
                  }`}
                />
                {latestClosed && date <= latestClosed.endDate && (
                  <p className="text-[12px] text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>বন্ধ হিসাবকাল: {latestClosed.endDate} বা পূর্বের তারিখে জাবেদা পোস্ট নিষিদ্ধ।</span>
                  </p>
                )}
                {date > new Date().toISOString().split('T')[0] && (
                  <p className="text-[12px] text-rose-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>ভাউচারের তারিখ ভবিষ্যতের হতে পারে না ({new Date().toISOString().split('T')[0]} বা তার পূর্বের হতে হবে)।</span>
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
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-[14px] font-bold text-gray-800 mb-1.5">
                  <span>সংশ্লিষ্ট ব্যক্তি (Related Person)</span>
                  <span className="text-xs font-normal text-gray-500 ml-1">(ঐচ্ছিক)</span>
                </label>
                <input
                  type="text"
                  value={relatedPerson}
                  onChange={(e) => setRelatedPerson(e.target.value)}
                  placeholder="যেমন: মো: করিম / আকাশ ট্রেডার্স"
                  className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
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
                className="w-full bg-[#F8FAFC] border border-gray-300 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
              />
            </div>

            {/* SIMPLE MODE: 2 Account Pickers + 1 Amount */}
            {voucherMode === 'SIMPLE' && (
              <div className="pt-3 border-t border-gray-200 space-y-3.5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* From Account: Money going OUT of (Credit) */}
                  <div className="bg-[#FEF2F2]/60 p-3.5 sm:p-4 rounded-xl border border-rose-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[14px] font-bold text-gray-900">
                        কোন হিসাব থেকে টাকা যাচ্ছে (Money going OUT of)
                      </label>
                      <span className="text-[11px] font-semibold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                        ক্রেডিট (Cr)
                      </span>
                    </div>
                    <SearchableSelect
                      options={accountOptions}
                      value={simpleFromAccount}
                      onChange={(val) => setSimpleFromAccount(val)}
                      placeholder="-- যে হিসাব থেকে টাকা যাচ্ছে তা নির্বাচন করুন --"
                      allowClear
                    />
                    <p className="text-[11px] text-gray-500">
                      যেমন: নগদ তহবিল (১০১০), ব্যাংক হিসাব, বা দেনাদার/সরবরাহকারী
                    </p>
                  </div>

                  {/* To Account: Money coming INTO (Debit) */}
                  <div className="bg-[#F0FDF4]/60 p-3.5 sm:p-4 rounded-xl border border-emerald-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[14px] font-bold text-gray-900">
                        কোন হিসাবে টাকা আসছে (Money coming INTO)
                      </label>
                      <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                        ডেবিট (Dr)
                      </span>
                    </div>
                    <SearchableSelect
                      options={accountOptions}
                      value={simpleToAccount}
                      onChange={(val) => setSimpleToAccount(val)}
                      placeholder="-- যে হিসাবে টাকা আসছে তা নির্বাচন করুন --"
                      allowClear
                    />
                    <p className="text-[11px] text-gray-500">
                      যেমন: ফিড ক্রয় খরচ (৫১১০), বেতন ও পারিশ্রমিক (৬১১০), বা ব্যাংক তহবিল
                    </p>
                  </div>
                </div>

                {/* Amount Field */}
                <div className="bg-[#F8FAFC] p-3.5 sm:p-4 rounded-xl border border-gray-200">
                  <label className="block text-[14px] font-bold text-gray-900 mb-1.5">
                    টাকার পরিমাণ (Amount ৳)
                  </label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-base">
                      ৳
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={simpleAmount}
                      onChange={(e) => setSimpleAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-8 pr-3.5 py-2.5 bg-white border border-gray-300 rounded-xl text-[16px] font-bold text-gray-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 min-h-[44px]"
                    />
                  </div>
                </div>

                {simpleFromAccount && simpleToAccount && simpleFromAccount === simpleToAccount && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>সতর্কতা: টাকা যাওয়ার হিসাব এবং টাকা আসার হিসাব একই হতে পারে না।</span>
                  </div>
                )}

                {/* Simple Mode Summary */}
                {balanceCheck.totalDebit > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] text-[14px] font-bold text-gray-900 border border-gray-200 gap-2">
                    <span>দাখিলা সংক্ষেপ (Entry Summary):</span>
                    <div className="flex gap-4">
                      <span className="text-[#15803D]">মোট ডেবিট: ৳{balanceCheck.totalDebit.toFixed(2)}</span>
                      <span className="text-sky-700">মোট ক্রেডিট: ৳{balanceCheck.totalCredit.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ADVANCED MODE: Multi-line Debit & Credit Lines Grid */}
            {voucherMode === 'ADVANCED' && (
              <div className="pt-3 border-t border-gray-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-gray-800">হিসাব লাইনসমূহ (Debit & Credit Lines)</span>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-[13px] text-blue-700 hover:underline flex items-center gap-1 font-bold cursor-pointer py-1 px-2"
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
                        <SearchableSelect
                          options={accountOptions}
                          value={line.accountCode}
                          onChange={(val) => handleLineAccountChange(idx, val)}
                          placeholder="-- হিসাব নির্বাচন বা সন্ধান করুন --"
                          allowClear
                        />
                      </div>

                      <div className="col-span-5 sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit || ''}
                          onChange={(e) => handleLineAmountChange(idx, 'debit', e.target.value)}
                          placeholder="ডেবিট ৳"
                          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-[#15803D] font-bold focus:outline-none focus:border-blue-600 min-h-[40px]"
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
                          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-[14px] text-sky-700 font-bold focus:outline-none focus:border-blue-600 min-h-[40px]"
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
            )}

            <button
              type="submit"
              disabled={role !== 'OWNER' || !balanceCheck.isBalanced || balanceCheck.totalDebit <= 0}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-[15px] transition-all cursor-pointer shadow-xs min-h-[48px] active:scale-98"
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
              <FileText className="w-5 h-5 text-blue-700" />
              <span>লিপিবদ্ধ জাবেদা ভাউচারসমূহ ({journals.length})</span>
            </h3>
            <button
              onClick={() => {
                resetVoucherForm();
                setSubTab('vouchers');
              }}
              className="text-[13px] text-blue-700 hover:underline font-bold cursor-pointer py-1 px-2"
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
                id="daybook-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="বিবরণ, টাকার পরিমাণ, তারিখ (YYYY-MM-DD), বা ভাউচার দিয়ে খুঁজুন..."
                className="w-full pl-10 pr-9 py-2 bg-[#F8FAFC] border border-gray-200 rounded-xl text-[14px] text-gray-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all min-h-[42px]"
              />
              {searchQuery && (
                <button
                  type="button"
                  id="btn-clear-daybook-search"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  title="অনুসন্ধান মুছুন"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-xs text-gray-500 font-medium whitespace-nowrap">
              {(() => {
                const q = searchQuery.toLowerCase().trim();
                const totalFiltered = journals.filter((j) => {
                  if (!q) return true;
                  const descMatch = (j.narration && j.narration.toLowerCase().includes(q)) ||
                    j.lines.some((l) => l.memo && l.memo.toLowerCase().includes(q));
                  const amountMatch =
                    j.totalDebit.toString().includes(q) ||
                    j.totalCredit.toString().includes(q) ||
                    j.totalDebit.toLocaleString().includes(q) ||
                    j.lines.some((l) => (l.debit > 0 && l.debit.toString().includes(q)) || (l.credit > 0 && l.credit.toString().includes(q)));
                  const dateMatch = j.date && j.date.includes(q);
                  const voucherMatch = j.voucherNumber && j.voucherNumber.toLowerCase().includes(q);
                  const idMatch = j.id && j.id.toLowerCase().includes(q);
                  const accountMatch = j.lines.some((l) => l.accountCode.includes(q) || l.accountName.toLowerCase().includes(q));
                  const badgeMatch =
                    (j.reversedBy && ('সংশোধিত'.includes(q) || 'corrected'.includes(q))) ||
                    (j.reversalOf && ('রিভার্সাল'.includes(q) || 'reversal'.includes(q))) ||
                    (j.correctionOf && ('নতুন সংশোধিত'.includes(q) || 'correction'.includes(q)));
                  const personMatch = Boolean(j.relatedPerson && j.relatedPerson.toLowerCase().includes(q));

                  return descMatch || amountMatch || dateMatch || voucherMatch || idMatch || accountMatch || badgeMatch || personMatch;
                }).length;

                return (
                  <span>
                    মোট: <strong className="text-blue-700">{totalFiltered}</strong> টি ভাউচার
                    {totalFiltered > 25 && ` (প্রদর্শিত: ${Math.min(daybookVisibleCount, totalFiltered)})`}
                  </span>
                );
              })()}
            </div>
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
            (() => {
              const q = searchQuery.toLowerCase().trim();
              const filtered = journals.filter((j) => {
                if (!q) return true;
                const descMatch = (j.narration && j.narration.toLowerCase().includes(q)) ||
                  j.lines.some((l) => l.memo && l.memo.toLowerCase().includes(q));
                const amountMatch =
                  j.totalDebit.toString().includes(q) ||
                  j.totalCredit.toString().includes(q) ||
                  j.totalDebit.toLocaleString().includes(q) ||
                  j.lines.some((l) => (l.debit > 0 && l.debit.toString().includes(q)) || (l.credit > 0 && l.credit.toString().includes(q)));
                const dateMatch = j.date && j.date.includes(q);
                const voucherMatch = j.voucherNumber && j.voucherNumber.toLowerCase().includes(q);
                const idMatch = j.id && j.id.toLowerCase().includes(q);
                const accountMatch = j.lines.some((l) => l.accountCode.includes(q) || l.accountName.toLowerCase().includes(q));
                const badgeMatch =
                  (j.reversedBy && ('সংশোধিত'.includes(q) || 'corrected'.includes(q))) ||
                  (j.reversalOf && ('রিভার্সাল'.includes(q) || 'reversal'.includes(q))) ||
                  (j.correctionOf && ('নতুন সংশোধিত'.includes(q) || 'correction'.includes(q)));
                const personMatch = Boolean(j.relatedPerson && j.relatedPerson.toLowerCase().includes(q));
                const authorMatch = Boolean(j.createdBy && j.createdBy.toLowerCase().includes(q));

                return descMatch || amountMatch || dateMatch || voucherMatch || idMatch || accountMatch || badgeMatch || personMatch || authorMatch;
              });

              if (filtered.length === 0) {
                return (
                  <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    "{searchQuery}" এর সাথে মিলে এমন কোনো জাবেদা রেকর্ড পাওয়া যায়নি।
                  </div>
                );
              }

              const visible = filtered.slice(0, daybookVisibleCount);

              return (
                <div className="space-y-3">
                  {visible.map((j) => (
                    <Card
                      key={j.id}
                      variant="static"
                      padding="md"
                      className={`space-y-3 transition-all ${
                        j.reversedBy
                          ? 'border-amber-300/80 bg-amber-50/20'
                          : j.reversalOf
                          ? 'border-blue-200/80 bg-blue-50/20'
                          : ''
                      }`}
                    >
                      <div className="flex items-start justify-between flex-wrap gap-3 border-b border-gray-100 dark:border-slate-800 pb-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-blue-700 dark:text-blue-400 text-[15px]">
                              {j.voucherNumber}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-xs text-gray-700 dark:text-slate-300 font-semibold">
                              {j.voucherType}
                            </span>

                            {/* Reversed/corrected entries get a distinct StatusBadge */}
                            {j.reversedBy && (
                              <StatusBadge
                                status="overdue"
                                label="সংশোধিত"
                              />
                            )}

                            {j.reversalOf && (
                              <StatusBadge
                                status="info"
                                icon={ArrowRightLeft}
                                label="বিপরীত দাখিলা"
                              />
                            )}

                            {j.correctionOf && (
                              <StatusBadge
                                status="done"
                                icon={CheckCircle2}
                                label="নতুন সংশোধিত দাখিলা"
                              />
                            )}
                          </div>

                          {/* Date and description in smaller gray text below it */}
                          <div className="text-xs text-gray-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{j.date}</span>
                            <span>•</span>
                            <span>{j.narration || 'কোনো বিবরণ নেই'}</span>
                            {j.relatedPerson && (
                              <span className="inline-flex items-center gap-1 font-semibold text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded text-[11px]">
                                <User className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                                <span>সংশ্লিষ্ট: {j.relatedPerson}</span>
                              </span>
                            )}
                            {j.createdBy && (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded text-[11px]">
                                <User className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span>যোগ করেছেন: {j.createdBy}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            {/* Amount in large bold text */}
                            <div className="text-lg sm:text-xl font-bold font-mono text-gray-900 dark:text-slate-100">
                              {fmt(j.totalDebit)}
                            </div>
                            <div className="text-[11px] text-gray-400 font-medium">
                              মোট ভাউচার মূল্য
                            </div>
                          </div>

                          {!j.reversedBy && !j.reversalOf && j.status !== 'REVERSED' && role === 'OWNER' && (
                            <button
                              type="button"
                              onClick={() => setReversingEntry(j)}
                              className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 hover:border-amber-400 text-[12px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95"
                              title="এই এন্ট্রিটি সংশোধন বা রিভার্স করুন"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-700" />
                              <span>সংশোধন করুন</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Lines preview */}
                      <div className="space-y-1.5 text-[13px] bg-gray-50/60 dark:bg-slate-800/40 p-2.5 rounded-lg border border-gray-100 dark:border-slate-800">
                        {j.lines.map((line, lIdx) => (
                          <div key={lIdx} className="flex items-center justify-between text-gray-700 dark:text-slate-300">
                            <span className="truncate pr-2 flex items-baseline gap-1.5">
                              <span className="font-bold text-gray-900 dark:text-slate-100 text-[14px]">{line.accountName}</span>
                              <span className="text-[11px] text-gray-400 dark:text-slate-500 font-mono font-normal">({line.accountCode})</span>
                            </span>
                            <div className="flex gap-3 shrink-0 font-bold">
                              {line.debit > 0 && (
                                <span className="text-[#15803D] dark:text-emerald-400">Dr: {fmt(line.debit)}</span>
                              )}
                              {line.credit > 0 && (
                                <span className="text-sky-700 dark:text-sky-400">Cr: {fmt(line.credit)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}

                  {/* Load More Button for Daybook */}
                  {filtered.length > daybookVisibleCount && (
                    <div className="pt-3 pb-1 text-center">
                      <button
                        type="button"
                        id="btn-load-more-daybook"
                        onClick={() => setDaybookVisibleCount((prev) => prev + 25)}
                        className="px-6 py-2.5 bg-white border-2 border-blue-700 text-blue-700 hover:bg-blue-700 hover:text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer inline-flex items-center gap-2 min-h-[42px]"
                      >
                        <span>আরও দেখুন (Load More)</span>
                        <span className="text-[11px] opacity-80 font-normal">
                          ({Math.min(daybookVisibleCount, filtered.length)} / {filtered.length}টি প্রদর্শিত, +২৫টি যোগ করুন)
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* SUBTAB 3: GENERAL LEDGER */}
      {subTab === 'ledger' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-700" />
                <span>সাধারণ খতিয়ান (General Ledger)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">নির্দিষ্ট হিসাবের সমস্ত লেনদেন ও রানিং ব্যালেন্স</p>
            </div>

            {/* Account Selector */}
            <div className="w-full sm:w-80">
              <SearchableSelect
                options={accountOptions}
                value={selectedLedgerCode}
                onChange={(code) => loadLedger(code)}
                placeholder="হিসাব খুঁজুন বা নির্বাচন করুন..."
              />
            </div>
          </div>

          {/* Account Summary Banner */}
          {ledgerAccount && (
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 flex items-center justify-between text-[14px]">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-bold text-gray-900 text-lg">
                    {ledgerAccount.nameBn}
                  </span>
                  <span className="text-xs text-gray-400 font-mono font-normal">
                    ({ledgerAccount.code})
                  </span>
                </div>
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

          {/* Ledger Search Box */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="ledger-search-input"
                value={ledgerSearchQuery}
                onChange={(e) => setLedgerSearchQuery(e.target.value)}
                placeholder="খতিয়ান লেনদেন খুঁজুন (বিবরণ, টাকার পরিমাণ, তারিখ YYYY-MM-DD, বা ভাউচার)..."
                className="w-full pl-10 pr-9 py-2 bg-[#F8FAFC] border border-gray-200 rounded-xl text-[14px] text-gray-900 focus:outline-none focus:border-blue-600 focus:bg-white transition-all min-h-[42px]"
              />
              {ledgerSearchQuery && (
                <button
                  type="button"
                  id="btn-clear-ledger-search"
                  onClick={() => setLedgerSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  title="অনুসন্ধান মুছুন"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-xs text-gray-500 font-medium whitespace-nowrap">
              {(() => {
                const q = ledgerSearchQuery.toLowerCase().trim();
                const count = ledgerEntries.filter((row) => {
                  if (!q) return true;
                  const descMatch = row.narration && row.narration.toLowerCase().includes(q);
                  const amountMatch =
                    (row.debit > 0 && (row.debit.toString().includes(q) || row.debit.toLocaleString().includes(q))) ||
                    (row.credit > 0 && (row.credit.toString().includes(q) || row.credit.toLocaleString().includes(q))) ||
                    row.runningBalance.toString().includes(q) ||
                    row.runningBalance.toLocaleString().includes(q);
                  const dateMatch = row.date && row.date.includes(q);
                  const voucherMatch = row.voucherNumber && row.voucherNumber.toLowerCase().includes(q);
                  const personMatch = Boolean(row.relatedPerson && row.relatedPerson.toLowerCase().includes(q));
                  const authorMatch = Boolean(row.createdBy && row.createdBy.toLowerCase().includes(q));
                  return descMatch || amountMatch || dateMatch || voucherMatch || personMatch || authorMatch;
                }).length;
                return (
                  <span>
                    মোট: <strong className="text-blue-700">{count}</strong> টি লেনদেন
                    {count > 25 && ` (প্রদর্শিত: ${Math.min(ledgerVisibleCount, count)})`}
                  </span>
                );
              })()}
            </div>
          </div>

          {/* Ledger Table */}
          {(() => {
            const q = ledgerSearchQuery.toLowerCase().trim();
            // Show most recent 25 entries first (reverse chronological)
            const reversed = [...ledgerEntries].reverse();
            const filtered = reversed.filter((row) => {
              if (!q) return true;
              const descMatch = row.narration && row.narration.toLowerCase().includes(q);
              const amountMatch =
                (row.debit > 0 && (row.debit.toString().includes(q) || row.debit.toLocaleString().includes(q))) ||
                (row.credit > 0 && (row.credit.toString().includes(q) || row.credit.toLocaleString().includes(q))) ||
                row.runningBalance.toString().includes(q) ||
                row.runningBalance.toLocaleString().includes(q);
              const dateMatch = row.date && row.date.includes(q);
              const voucherMatch = row.voucherNumber && row.voucherNumber.toLowerCase().includes(q);
              const personMatch = Boolean(row.relatedPerson && row.relatedPerson.toLowerCase().includes(q));
              const authorMatch = Boolean(row.createdBy && row.createdBy.toLowerCase().includes(q));
              return descMatch || amountMatch || dateMatch || voucherMatch || personMatch || authorMatch;
            });

            const visibleRows = filtered.slice(0, ledgerVisibleCount);

            return (
              <div className="space-y-3">
                {ledgerEntries.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    এই হিসাবে এখনো কোনো লেনদেন সংঘটিত হয়নি।
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    "{ledgerSearchQuery}" এর সাথে মিলে এমন কোনো খতিয়ান লেনদেন পাওয়া যায়নি।
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleRows.map((row, idx) => (
                      <Card
                        key={idx}
                        variant="static"
                        padding="md"
                        className={`space-y-2 transition-all ${
                          row.reversedBy
                            ? 'border-amber-300/80 bg-amber-50/20'
                            : row.reversalOf
                            ? 'border-blue-200/80 bg-blue-50/20'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between flex-wrap gap-3 border-b border-gray-100 dark:border-slate-800 pb-2.5">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-blue-700 dark:text-blue-400 text-[15px]">
                                {row.voucherNumber}
                              </span>

                              {/* Reversed/corrected entries get a distinct StatusBadge */}
                              {row.reversedBy && (
                                <StatusBadge
                                  status="overdue"
                                  label="সংশোধিত"
                                />
                              )}

                              {row.reversalOf && (
                                <StatusBadge
                                  status="info"
                                  icon={ArrowRightLeft}
                                  label="রিভার্সাল"
                                />
                              )}

                              {row.correctionOf && (
                                <StatusBadge
                                  status="done"
                                  icon={CheckCircle2}
                                  label="সংশোধিত দাখিলা"
                                />
                              )}
                            </div>

                            {/* Date and description in smaller gray text below it */}
                            <div className="text-xs text-gray-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>{row.date}</span>
                              <span>•</span>
                              <span>{row.narration || 'কোনো বিবরণ নেই'}</span>
                              {row.relatedPerson && (
                                <span className="inline-flex items-center gap-1 font-semibold text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded text-[11px]">
                                  <User className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                                  <span>সংশ্লিষ্ট: {row.relatedPerson}</span>
                                </span>
                              )}
                              {row.createdBy && (
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded text-[11px]">
                                  <User className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  <span>যোগ করেছেন: {row.createdBy}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              {/* Amount in large bold text */}
                              <div className="text-lg sm:text-xl font-bold font-mono">
                                {row.debit > 0 ? (
                                  <span className="text-[#15803D] dark:text-emerald-400">Dr: {fmt(row.debit)}</span>
                                ) : (
                                  <span className="text-sky-700 dark:text-sky-400">Cr: {fmt(row.credit)}</span>
                                )}
                              </div>
                              <div className="text-xs font-mono text-gray-500 dark:text-slate-400">
                                চলমান জের: {fmt(row.runningBalance)}
                              </div>
                            </div>

                            {!row.reversedBy && !row.reversalOf && role === 'OWNER' && (
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
                                className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 hover:border-amber-400 text-[11px] font-bold transition-all cursor-pointer shadow-2xs"
                                title="এই এন্ট্রিটি সংশোধন করুন"
                              >
                                সংশোধন করুন
                              </button>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Load More Button for General Ledger */}
                {filtered.length > ledgerVisibleCount && (
                  <div className="pt-2 pb-1 text-center">
                    <button
                      type="button"
                      id="btn-load-more-ledger"
                      onClick={() => setLedgerVisibleCount((prev) => prev + 25)}
                      className="px-6 py-2.5 bg-white border-2 border-blue-700 text-blue-700 hover:bg-blue-700 hover:text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer inline-flex items-center gap-2 min-h-[42px]"
                    >
                      <span>আরও দেখুন (Load More)</span>
                      <span className="text-[11px] opacity-80 font-normal">
                        ({Math.min(ledgerVisibleCount, filtered.length)} / {filtered.length}টি প্রদর্শিত, +২৫টি যোগ করুন)
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* SUBTAB 4: TRIAL BALANCE */}
      {subTab === 'trialBalance' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-blue-700" />
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

          {/* Mobile / Tablet Cards View */}
          <div className="md:hidden space-y-3">
            {tbRows.map((r) => (
              <div
                key={r.code}
                className={`p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-2xs space-y-2 ${
                  r.isOrphan ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-bold text-gray-900 dark:text-slate-100">{r.nameBn}</div>
                    <span className="text-xs text-gray-400 dark:text-slate-500 font-mono font-normal">({r.code})</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 shrink-0">
                    {r.accountClass}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-gray-100 dark:border-slate-800">
                  <div className="text-[#15803D] dark:text-emerald-400 font-bold">
                    ডেবিট: {r.debit > 0 ? fmt(r.debit) : '-'}
                  </div>
                  <div className="text-right text-sky-700 dark:text-sky-400 font-bold">
                    ক্রেডিট: {r.credit > 0 ? fmt(r.credit) : '-'}
                  </div>
                </div>
              </div>
            ))}
            <div className="p-3.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-sm font-bold flex justify-between items-center">
              <span>মোট (Total):</span>
              <div className="flex items-center gap-3 text-xs sm:text-sm">
                <span className="text-[#15803D] dark:text-emerald-400">{fmt(tbTotalDebit)}</span>
                <span className="text-sky-700 dark:text-sky-400">{fmt(tbTotalCredit)}</span>
              </div>
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
            <table className="w-full text-left text-[13px] text-gray-800 dark:text-slate-200">
              <thead className="bg-gray-100 dark:bg-slate-800/80 text-gray-600 dark:text-slate-400 uppercase text-[11px] font-bold">
                <tr>
                  <th className="p-3">হিসাবের নাম</th>
                  <th className="p-3">কোড</th>
                  <th className="p-3">শ্রেণী</th>
                  <th className="p-3 text-right">ডেবিট ব্যালেন্স (৳)</th>
                  <th className="p-3 text-right">ক্রেডিট ব্যালেন্স (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                {tbRows.map((r) => (
                  <tr key={r.code} className={`hover:bg-gray-50 dark:hover:bg-slate-800/40 ${r.isOrphan ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                    <td className="p-3 text-gray-900 dark:text-slate-100 font-bold text-[14px]">{r.nameBn}</td>
                    <td className="p-3 text-xs text-gray-400 dark:text-slate-500 font-mono font-normal">({r.code})</td>
                    <td className="p-3 text-gray-600 dark:text-slate-400 text-xs">{r.accountClass}</td>
                    <td className="p-3 text-right font-semibold text-[#15803D] dark:text-emerald-400">{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className="p-3 text-right font-semibold text-sky-700 dark:text-sky-400">{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 dark:bg-slate-800 font-bold text-[14px] border-t-2 border-gray-300 dark:border-slate-700">
                <tr>
                  <td colSpan={3} className="p-3.5 text-gray-900 dark:text-slate-100">মোট (Total):</td>
                  <td className="p-3.5 text-right text-[#15803D] dark:text-emerald-400">{fmt(tbTotalDebit)}</td>
                  <td className="p-3.5 text-right text-sky-700 dark:text-sky-400">{fmt(tbTotalCredit)}</td>
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
                <Layers className="w-5 h-5 text-blue-700" />
                <span>হিসাবের চার্ট (Chart of Accounts Master)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">হিসাবসমূহের কাঠামো ও শ্রেণীবিভাগ</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={handleOpenAddAccount}
                className="px-3.5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px]"
              >
                + নতুন হিসাব কোড যোগ করুন
              </button>
            )}
          </div>

          {showAddAccount && (
            <form onSubmit={handleCreateAccount} className="p-4 bg-blue-50/40 border border-blue-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-[14px] font-bold text-blue-800">নতুন হিসাব তৈরি (Add Account)</h4>
                <div className="text-[12px] font-medium text-gray-600 bg-white px-2.5 py-1 rounded-full border border-gray-200">
                  স্বাভাবিক ব্যালেন্স: <span className="text-blue-700 font-bold">{inferNormalBalance(newAccClass)}</span> (স্বয়ংক্রিয় নির্ধারিত)
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    হিসাবের শ্রেণী (Account Class)
                  </label>
                  <select
                    value={newAccClass}
                    onChange={(e) => handleAccountClassChange(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="ASSET">ASSET (১০xx সম্পদ)</option>
                    <option value="LIABILITY">LIABILITY (২০xx দায়)</option>
                    <option value="EQUITY">EQUITY (৩০xx মূলধন)</option>
                    <option value="REVENUE">REVENUE (৪০xx আয়)</option>
                    <option value="COGS">COGS (৫০xx বিক্রিত পণ্যের ব্যয়)</option>
                    <option value="EXPENSE">EXPENSE (৬০xx পরিচালন ব্যয়)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    হিসাবের বাংলা নাম
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: খামার পরিবহন ব্যয়"
                    value={newAccNameBn}
                    onChange={(e) => setNewAccNameBn(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-gray-700 mb-1">
                    হিসাব কোড (স্বয়ংক্রিয় প্রিভিউ / পরিবর্তনযোগ্য)
                  </label>
                  <input
                    type="text"
                    placeholder={getNextAccountCode(newAccClass, accounts)}
                    value={newAccCode}
                    onChange={(e) => setNewAccCode(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono font-bold"
                  />
                  <span className="text-[11px] text-gray-500 mt-1 block">স্বয়ংক্রিয় কোড নির্ধারিত (প্রয়োজনে পরিবর্তনযোগ্য)</span>
                </div>
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
                  className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
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
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-gray-900 text-base leading-snug">{acc.nameBn}</h4>
                    <span className="text-xs text-gray-400 font-mono font-medium">({acc.code})</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700 font-semibold shrink-0">
                    {acc.accountClass}
                  </span>
                </div>
                {acc.nameEn && acc.nameEn !== acc.nameBn && (
                  <div className="text-[12px] text-gray-500 italic">{acc.nameEn}</div>
                )}
                <div className="text-[12px] text-gray-600 pt-1.5 border-t border-gray-200 flex justify-between font-medium">
                  <span>ব্যালেন্স ধরন: {acc.normalBalance}</span>
                  <span>{acc.isSystem ? 'সিস্টেম' : 'কাস্টম'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECURRING EXPENSES SUBTAB */}
      {subTab === 'recurring' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-gray-100">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Repeat className="w-5 h-5 text-blue-700" />
                <span>পুনরাবৃত্ত খরচ টেমপ্লেট (Recurring Expense Templates)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                মাসিক নিয়মিত খরচসমূহ (যেমন দোকান ভাড়া, খামার বিদ্যুৎ বিল, কর্মচারীর বেতন) যা প্রতি মাসের নির্দিষ্ট দিনে স্বয়ংক্রিয়ভাবে দাখিলা হয়
              </p>
            </div>

            <button
              id="btn-add-recurring-template"
              type="button"
              onClick={handleOpenCreateRecurring}
              className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ নতুন পুনরাবৃত্ত খরচ</span>
            </button>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200">
              <span className="text-[12px] text-gray-500 font-medium">মোট টেমপ্লেট</span>
              <div className="text-xl font-bold text-gray-900 mt-1">{recurringTemplates.length} টি</div>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <span className="text-[12px] text-emerald-800 font-medium">সক্রিয় টেমপ্লেট</span>
              <div className="text-xl font-bold text-emerald-700 mt-1">
                {recurringTemplates.filter((t) => t.active).length} টি
              </div>
            </div>
            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200">
              <span className="text-[12px] text-blue-800 font-medium">মাসিক সম্ভাব্য স্বয়ংক্রিয় ব্যয়</span>
              <div className="text-xl font-bold text-blue-900 mt-1 font-mono">
                ৳{recurringTemplates
                  .filter((t) => t.active)
                  .reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
                  .toLocaleString('en-IN')}
              </div>
            </div>
          </div>

          {/* Templates List */}
          {recurringTemplates.length === 0 ? (
            <div className="text-center py-12 px-4 border border-dashed border-gray-300 rounded-2xl bg-gray-50/50">
              <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3 opacity-60" />
              <h4 className="text-base font-bold text-gray-800">কোন পুনরাবৃত্ত খরচ টেমপ্লেট তৈরি করা হয়নি</h4>
              <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-4">
                দোকান ভাড়া, গোডাউন ভাড়া, খামার বিদ্যুৎ বিল বা কর্মচারীর বেতনের মত নিয়মিত খরচের টেমপ্লেট সংরক্ষণ করুন। প্রতি মাসের নির্ধারিত তারিখে অ্যাপ লোড হলে তা স্বয়ংক্রিয়ভাবে হিসাবভুক্ত হবে।
              </p>
              <button
                type="button"
                onClick={handleOpenCreateRecurring}
                className="px-4 py-2 rounded-xl bg-blue-700 text-white text-[13px] font-bold shadow-xs hover:bg-blue-800 cursor-pointer"
              >
                প্রথম পুনরাবৃত্ত খরচ যোগ করুন
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recurringTemplates.map((template) => {
                const acc = accounts.find((a) => a.code === template.accountCode);
                return (
                  <div
                    key={template.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      template.active
                        ? 'bg-white border-gray-200 hover:border-blue-500 shadow-xs'
                        : 'bg-gray-50/80 border-gray-200 opacity-70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-[15px] font-bold text-gray-900">{template.description}</h4>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                              template.active
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-gray-200 text-gray-600 border border-gray-300'
                            }`}
                          >
                            {template.active ? 'সক্রিয় (Active)' : 'নিষ্ক্রিয় (Paused)'}
                          </span>
                        </div>
                        <div className="text-[13px] mt-1 flex items-baseline gap-1.5">
                          <span className="font-bold text-gray-900">{acc ? acc.nameBn : 'হিসাব খাত'}</span>
                          <span className="text-[11px] font-mono text-gray-400 font-medium">({template.accountCode})</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-lg font-bold font-mono text-blue-700">
                          ৳{Number(template.amount).toLocaleString('en-IN')}
                        </div>
                        <span className="text-[11px] text-gray-500 font-medium">প্রতি মাসের {template.dayOfMonth} তারিখ</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-1 text-gray-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>নির্ধারিত দিন: মাসের {template.dayOfMonth} তারিখ</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleRecurringActive(template)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                            template.active
                              ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {template.active ? 'স্থগিত করুন' : 'সক্রিয় করুন'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditRecurring(template)}
                          className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 font-semibold cursor-pointer flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>এডিট</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecurringTemplate(template.id, template.description)}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 cursor-pointer"
                          title="মুছে ফেলুন"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* RECURRING EXPENSE CREATE/EDIT MODAL */}
      {showRecurringModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-blue-50/50 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-100 rounded-xl">
                  <Repeat className="w-5 h-5 text-blue-700" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {editingTemplateId ? 'পুনরাবৃত্ত খরচ সম্পাদনা' : 'নতুন পুনরাবৃত্ত খরচ টেমপ্লেট'}
                  </h3>
                  <p className="text-[12px] text-gray-500">প্রতি মাসে স্বয়ংক্রিয়ভাবে দাখিলা হওয়ার জন্য খরচের বিবরণ নির্ধারণ করুন</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRecurringModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveRecurringTemplate} className="p-5 space-y-4">
              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1">
                  খরচের বিবরণ (Description) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: দোকান ভাড়া (Shop Rent), খামার বিদ্যুৎ বিল"
                  value={recDescription}
                  onChange={(e) => setRecDescription(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl p-3 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    খরচের পরিমাণ (৳ Amount) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="যেমন: 5000"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl p-3 text-[14px] font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-bold text-gray-700 mb-1">
                    মাসের কোন তারিখে (Day of Month) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={recDayOfMonth}
                    onChange={(e) => setRecDayOfMonth(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-white border border-gray-300 rounded-xl p-3 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        প্রতি মাসের {day} তারিখ
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-bold text-gray-700 mb-1">
                  খরচ হিসাব খাত (Expense Account) <span className="text-rose-500">*</span>
                </label>
                <SearchableSelect
                  options={accountOptions}
                  value={recAccountCode}
                  onChange={(code) => setRecAccountCode(code)}
                  placeholder="খরচ হিসাব খাত নির্বাচন করুন..."
                />
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <input
                  type="checkbox"
                  id="chk-rec-active"
                  checked={recActive}
                  onChange={(e) => setRecActive(e.target.checked)}
                  className="w-4 h-4 text-blue-700 rounded border-gray-300 focus:ring-blue-600"
                />
                <label htmlFor="chk-rec-active" className="text-[13px] font-medium text-gray-800 cursor-pointer">
                  টেমপ্লেটটি সক্রিয় রাখুন (Active — প্রতি মাসের নির্ধারিত তারিখে স্বয়ংক্রিয় পোস্ট হবে)
                </label>
              </div>

              {/* Modal Footer */}
              <div className="flex gap-3 justify-end pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowRecurringModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 font-semibold text-[13px] cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-[13px] cursor-pointer shadow-xs"
                >
                  {editingTemplateId ? 'হালনাগাদ করুন' : 'টেমপ্লেট সংরক্ষণ করুন'}
                </button>
              </div>
            </form>
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
                        <div className="font-bold">সমাপনী দাখিলা পূর্বরূপ (Compound Closing Entry Preview):</div>
                        <div className="p-2.5 rounded-lg bg-white border border-purple-200 font-mono text-[11px] space-y-1.5">
                          <div className="flex justify-between text-gray-700">
                            <span>ডেবিট: সকল আয় হিসাব বন্ধ (Revenues Zeroing)</span>
                            <span>৳{closingPreview.totalRevenue.toLocaleString('en-IN')}</span>
                          </div>
                          <div className="flex justify-between text-gray-700">
                            <span>ক্রেডিট: সকল ব্যয় হিসাব বন্ধ (Expenses Zeroing)</span>
                            <span>৳{(closingPreview.totalCogs + closingPreview.totalOperatingExpenses + closingPreview.totalOtherExpenses).toLocaleString('en-IN')}</span>
                          </div>
                          {closingPreview.netProfitToTransfer >= 0 ? (
                            <div className="flex justify-between text-emerald-800 font-bold border-t border-purple-100 pt-1">
                              <span>ক্রেডিট: ৩০৫০ - পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)</span>
                              <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                            </div>
                          ) : (
                            <div className="flex justify-between text-red-800 font-bold border-t border-purple-100 pt-1">
                              <span>ডেবিট: ৩০৫০ - পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)</span>
                              <span>৳{Math.abs(closingPreview.netProfitToTransfer).toLocaleString('en-IN')}</span>
                            </div>
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
              {reversingEntry.relatedPerson && (
                <div className="flex justify-between">
                  <span className="text-gray-500 font-sans">সংশ্লিষ্ট ব্যক্তি:</span>
                  <span className="text-gray-900 font-sans font-bold">{reversingEntry.relatedPerson}</span>
                </div>
              )}
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
                className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                {loading ? 'প্রক্রিয়াকরণ হচ্ছে...' : 'বিপরীত দাখিলা নিশ্চিত ও সংশোধন করুন'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmHighAmountVoucher && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5 text-amber-700">
                <AlertCircle className="w-6 h-6 shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">পোস্টিং নিশ্চিতকরণ</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmHighAmountVoucher(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-800 text-[15px] font-medium leading-relaxed">
              আপনি কি {confirmHighAmountVoucher.amount.toLocaleString('en-IN')} টাকার এই এন্ট্রিটি পোস্ট করতে নিশ্চিত?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmHighAmountVoucher(null)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
              >
                বাতিল (Cancel)
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmHighAmountVoucher(null);
                  await executeSaveVoucher();
                }}
                className="px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
              >
                নিশ্চিত করুন (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
