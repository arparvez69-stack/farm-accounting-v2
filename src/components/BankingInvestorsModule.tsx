import React, { useEffect, useState } from 'react';
import {
  Landmark,
  Wallet,
  ArrowRightLeft,
  Users,
  PlusCircle,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  executeContraTransferTransaction,
  executeInvestorTransaction,
  executeLoanTransaction
} from '../services/transactionService';
import { CashBankAccount, Investor, Loan, UserRole } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type FinanceTab = 'accounts' | 'transfers' | 'loans' | 'investors';

export const BankingInvestorsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [tab, setTab] = useState<FinanceTab>('accounts');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);

  // Add Bank Account Modal
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<CashBankAccount['accountType']>('BANK');
  const [bankName, setBankName] = useState('Sonali Bank PLC');
  const [accNumber, setAccNumber] = useState('');
  const [branch, setBranch] = useState('');

  // Contra Transfer Modal
  const [showTransfer, setShowTransfer] = useState(false);
  const [fromAccId, setFromAccId] = useState('');
  const [toAccId, setToAccId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNarration, setTransferNarration] = useState('');

  // New Loan Modal
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [loanLenderName, setLoanLenderName] = useState('');
  const [loanTerm, setLoanTerm] = useState<'SHORT_TERM' | 'LONG_TERM'>('SHORT_TERM');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanInterestRate, setLoanInterestRate] = useState('9');
  const [loanDestinationAcc, setLoanDestinationAcc] = useState<'CASH' | 'BANK'>('BANK');
  const [loanStartDate, setLoanStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [loanDurationMonths, setLoanDurationMonths] = useState('12');

  // New Investor Modal
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [investorName, setInvestorName] = useState('');
  const [investorPhone, setInvestorPhone] = useState('');
  const [investorAmount, setInvestorAmount] = useState('');
  const [investorSharePct, setInvestorSharePct] = useState('');
  const [investorDestinationAcc, setInvestorDestinationAcc] = useState<'CASH' | 'BANK'>('BANK');

  useEffect(() => {
    loadFinanceData();
  }, [tab]);

  const loadFinanceData = async () => {
    setLoading(true);
    try {
      const accList = await db.cashBankAccounts.toArray();
      setAccounts(accList);

      if (tab === 'loans') {
        const loanList = await db.loans.toArray();
        setLoans(loanList);
      } else if (tab === 'investors') {
        const invList = await db.investors.toArray();
        setInvestors(invList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ADD CASH/BANK ACCOUNT
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newAcc: CashBankAccount = {
        id: generateUniqueId('cb'),
        accountType: accType,
        name: accName.trim(),
        bankName: accType === 'BANK' ? bankName.trim() : undefined,
        accountNumber: accNumber.trim() || undefined,
        branch: branch.trim() || undefined,
        currentBalance: 0,
        synced: false
      };
      await safeInsert(db.cashBankAccounts, newAcc, { idPrefix: 'cb' });
      setShowAddAccount(false);
      setAccName('');
      setAccNumber('');
      setMsg({ type: 'success', text: `অ্যাকাউন্ট ${newAcc.name} সফলভাবে তৈরি হয়েছে!` });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  // EXECUTE CONTRA TRANSFER
  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromAccId || !toAccId) {
      setMsg({ type: 'error', text: 'উৎস ও গন্তব্য হিসাব নির্বাচন করুন।' });
      return;
    }
    const amt = parseFloat(transferAmount) || 0;
    if (amt <= 0) {
      setMsg({ type: 'error', text: 'স্থানান্তরের পরিমাণ সঠিক হতে হবে।' });
      return;
    }

    try {
      const res = await executeContraTransferTransaction({
        fromAccountId: fromAccId,
        toAccountId: toAccId,
        amount: amt,
        narration: transferNarration.trim() || undefined,
        currentUserId
      });

      setShowTransfer(false);
      setTransferAmount('');
      setTransferNarration('');
      setMsg({
        type: 'success',
        text: `কন্ট্রা ভাউচার ${res.voucherNumber} এর মাধ্যমে ৳${amt} সফলভাবে স্থানান্তর সম্পন্ন হয়েছে!`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'স্থানান্তর ব্যর্থ হয়েছে।' });
    }
  };

  // EXECUTE LOAN RECEIPT
  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    const principal = parseFloat(loanPrincipal) || 0;
    const rate = parseFloat(loanInterestRate) || 0;
    const months = parseInt(loanDurationMonths) || 12;

    if (!loanLenderName.trim() || principal <= 0) {
      setMsg({ type: 'error', text: 'ঋণদাতার নাম ও মূলধনের পরিমাণ সঠিকভাবে লিখুন।' });
      return;
    }

    try {
      const res = await executeLoanTransaction({
        lenderName: loanLenderName.trim(),
        principal,
        interestRate: rate,
        tenureMonths: months,
        targetAccountId: loanDestinationAcc,
        currentUserId
      });

      setShowNewLoan(false);
      setLoanLenderName('');
      setLoanPrincipal('');
      setMsg({
        type: 'success',
        text: `ঋণ চুক্তি ${res.loan.id} (৳${res.loan.principalAmount}) সফলভাবে গৃহীত এবং হিসাবভুক্ত হয়েছে!`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ঋণ গ্রহণ প্রক্রিয়া ব্যর্থ হয়েছে।' });
    }
  };

  // EXECUTE INVESTOR CONTRIBUTION
  const handleCreateInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(investorAmount) || 0;
    const share = parseFloat(investorSharePct) || 0;

    if (!investorName.trim() || amt <= 0) {
      setMsg({ type: 'error', text: 'বিনিয়োগকারীর নাম ও বিনিয়োগকৃত মূলধন সঠিকভাবে লিখুন।' });
      return;
    }

    try {
      const res = await executeInvestorTransaction({
        investorName: investorName.trim(),
        contribution: amt,
        profitShare: share,
        targetAccountId: investorDestinationAcc,
        currentUserId
      });

      setShowNewInvestor(false);
      setInvestorName('');
      setInvestorPhone('');
      setInvestorAmount('');
      setInvestorSharePct('');
      setMsg({
        type: 'success',
        text: `বিনিয়োগকারী ${res.investor.name} এর ৳${amt} মূলধন সরাসরি ৩০২০ (Investor Capital) এ পোস্ট করা হয়েছে!`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'বিনিয়োগ সংরক্ষণ ব্যর্থ হয়েছে।' });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      {/* Module Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <Landmark className="w-5 h-5 text-emerald-400" />
            <span>ব্যাংকিং, তহবিল স্থানান্তর, ঋণ ও মূলধন (Banking & Capital)</span>
          </h2>
          <p className="text-xs text-slate-400">
            নগদ ও ব্যাংক তহবিল (1010/1030), কন্ট্রা জাবেদা, ব্যাংক ঋণ (2110/2120) ও বিনিয়োগকারী মূলধন (3020)
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setTab('accounts')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'accounts' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            তহবিল ও ব্যাংক (Accounts)
          </button>
          <button
            onClick={() => setTab('transfers')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'transfers' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            কন্ট্রা স্থানান্তর (Contra)
          </button>
          <button
            onClick={() => setTab('loans')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'loans' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            ব্যাংক ও মহাজনি ঋণ (Loans)
          </button>
          <button
            onClick={() => setTab('investors')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'investors' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            বিনিয়োগকারী ও শেয়ার (Investors)
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

      {/* ===================== TAB 1: CASH & BANK ACCOUNTS ===================== */}
      {tab === 'accounts' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span>নগদ ড্রয়ার ও ব্যাংক অ্যাকাউন্টসমূহ ({accounts.length})</span>
              </h3>
              <p className="text-xs text-slate-400">খামারের নগদ টাকা ও বিভিন্ন ব্যাংকের চলতি/সঞ্চয়ী হিসাব</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAccount(!showAddAccount)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন ব্যাংক একাউন্ট</span>
              </button>
            )}
          </div>

          {showAddAccount && (
            <form onSubmit={handleAddAccount} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন ব্যাংক/তহবিল হিসাব যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">হিসাবের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: ইসলামী ব্যাংক চলতি হিসাব"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">হিসাবের ধরন</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="BANK">ব্যাংক হিসাব (Bank - 1030)</option>
                    <option value="MOBILE_BANKING">মোবাইল ব্যাংকিং (bKash/Nagad - 1030)</option>
                    <option value="CASH">নগদ তহবিল (Petty Cash - 1020)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">হিসাব নম্বর</label>
                  <input
                    type="text"
                    placeholder="A/C Number"
                    value={accNumber}
                    onChange={(e) => setAccNumber(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              {accType === 'BANK' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400">ব্যাংকের নাম</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">শাখা (Branch)</label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="শাখার নাম"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-xl bg-slate-800/50 border border-slate-800 space-y-2 text-xs shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-slate-800 text-emerald-400">
                      {a.accountType === 'CASH' ? <Wallet className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm leading-tight">{a.name}</h4>
                      <p className="text-[10px] text-slate-400">
                        {a.bankName ? `${a.bankName} (${a.accountNumber || 'N/A'})` : a.accountType}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {a.accountType === 'CASH' ? '1010' : '1030'}
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-mono">
                  <span className="text-slate-400 text-[11px]">বর্তমান স্থিতি:</span>
                  <span className={`text-base font-bold ${a.currentBalance < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {fmt(a.currentBalance)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 2: CONTRA TRANSFERS ===================== */}
      {tab === 'transfers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
                <span>তহবিল স্থানান্তর / কন্ট্রা ভাউচার (Contra Transfers)</span>
              </h3>
              <p className="text-xs text-slate-400">
                ব্যাংক থেকে নগদ উত্তোলন অথবা ব্যাংকে নগদ জমা (সম্পূর্ণ পারমাণবিক লেনদেন)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowTransfer(!showTransfer)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন স্থানান্তর</span>
              </button>
            )}
          </div>

          {showTransfer && (
            <form onSubmit={handleExecuteTransfer} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">কন্ট্রা ভাউচার তৈরি করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400">উৎস হিসাব (টাকা যাবে)</label>
                  <select
                    value={fromAccId}
                    onChange={(e) => setFromAccId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="">-- যে হিসাব থেকে টাকা বের হবে --</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (স্থিতি: {fmt(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400">গন্তব্য হিসাব (টাকা জমা হবে)</label>
                  <select
                    value={toAccId}
                    onChange={(e) => setToAccId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="">-- যে হিসাবে টাকা জমা হবে --</option>
                    {accounts.filter((a) => a.id !== fromAccId).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (স্থিতি: {fmt(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400">স্থানান্তরের পরিমাণ (৳)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="টাকার অংক"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">বিবরণ / নোট</label>
                  <input
                    type="text"
                    placeholder="যেমন: খামার খরচের জন্য ব্যাংক হতে নগদ উত্তোলন"
                    value={transferNarration}
                    onChange={(e) => setTransferNarration(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTransfer(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  স্থানান্তর সম্পন্ন করুন
                </button>
              </div>
            </form>
          )}

          <div className="p-6 text-center text-slate-400 text-xs bg-slate-800/40 rounded-xl border border-slate-800">
            কন্ট্রা ভাউচার নিশ্চিত করার সাথে সাথে স্বয়ংক্রিয়ভাবে উভয় হিসাবের স্থিতি সমন্বয় হবে এবং
            দ্বৈত-দাখিলায় ডেবিট-ক্রেডিট হিসেবে সংরক্ষিত হবে।
          </div>
        </div>
      )}

      {/* ===================== TAB 3: LOANS ===================== */}
      {tab === 'loans' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Landmark className="w-4 h-4 text-emerald-400" />
                <span>ব্যাংক ও মহাজনি ঋণ ট্র্যাকিং ({loans.length})</span>
              </h3>
              <p className="text-xs text-slate-400">
                স্বল্পমেয়াদী ঋণ: Cr 2110 | দীর্ঘমেয়াদী ঋণ: Cr 2120 | তহবিল প্রাপ্তি: Dr 1010/1030
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewLoan(!showNewLoan)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন ঋণ চুক্তি</span>
              </button>
            )}
          </div>

          {showNewLoan && (
            <form onSubmit={handleCreateLoan} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন ঋণ গ্রহণ ও হিসাবভুক্তকরণ</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">ঋণদাতা ব্যাংক/মহাজন</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: বাংলাদেশ কৃষি ব্যাংক"
                    value={loanLenderName}
                    onChange={(e) => setLoanLenderName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">ঋণের মেয়াদকাল</label>
                  <select
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="SHORT_TERM">স্বল্পমেয়াদী ঋণ (১২ মাসের নিচে - 2110)</option>
                    <option value="LONG_TERM">দীর্ঘমেয়াদী ঋণ (১২ মাসের উপরে - 2120)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">টাকা জমার হিসাব</label>
                  <select
                    value={loanDestinationAcc}
                    onChange={(e) => setLoanDestinationAcc(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="BANK">ব্যাংক একাউন্ট (1030)</option>
                    <option value="CASH">নগদ ড্রয়ার (1010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">মূল ঋণের পরিমাণ ৳</label>
                  <input
                    type="number"
                    required
                    placeholder="টাকা"
                    value={loanPrincipal}
                    onChange={(e) => setLoanPrincipal(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">সুদের হার (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={loanInterestRate}
                    onChange={(e) => setLoanInterestRate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">শুরুর তারিখ</label>
                  <input
                    type="date"
                    value={loanStartDate}
                    onChange={(e) => setLoanStartDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">মেয়াদ (মাস)</label>
                  <input
                    type="number"
                    value={loanDurationMonths}
                    onChange={(e) => setLoanDurationMonths(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewLoan(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  ঋণ নিশ্চিত ও পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">ঋণ নং</th>
                  <th className="p-2.5">ঋণদাতা</th>
                  <th className="p-2.5">মেয়াদ ধরন</th>
                  <th className="p-2.5">মূলধন (Principal)</th>
                  <th className="p-2.5">সুদের হার</th>
                  <th className="p-2.5">বকেয়া কিস্তি/স্থিতি</th>
                  <th className="p-2.5">অবস্থা</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500 font-sans text-xs">
                      বর্তমানে কোনো সক্রিয় ব্যাংক বা মহাজনি ঋণ নেই।
                    </td>
                  </tr>
                ) : (
                  loans.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-emerald-400">{l.loanNumber}</td>
                      <td className="p-2.5 font-sans font-medium text-white">{l.lenderName}</td>
                      <td className="p-2.5 font-sans text-[10px] text-slate-400">
                        {l.term === 'SHORT_TERM' ? 'স্বল্পমেয়াদী (2110)' : 'দীর্ঘমেয়াদী (2120)'}
                      </td>
                      <td className="p-2.5 text-white font-bold">{fmt(l.principalAmount)}</td>
                      <td className="p-2.5 text-slate-300">{l.interestRate}%</td>
                      <td className="p-2.5 text-amber-300 font-bold">{fmt(l.remainingBalance)}</td>
                      <td className="p-2.5 font-sans">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950 text-emerald-300">
                          {l.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: INVESTORS ===================== */}
      {tab === 'investors' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>বিনিয়োগকারী ও শেয়ারহোল্ডার মূলধন ({investors.length})</span>
              </h3>
              <p className="text-xs text-slate-400">
                বিনিয়োগ গ্রহণ: Dr 1010/1030 | শেয়ার মূলধন: Cr 3020 (Investor Capital)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewInvestor(!showNewInvestor)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন বিনিয়োগকারী</span>
              </button>
            )}
          </div>

          {showNewInvestor && (
            <form onSubmit={handleCreateInvestor} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">নতুন বিনিয়োগকারীর মূলধন এন্ট্রি</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">বিনিয়োগকারীর পূর্ণ নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="নাম"
                    value={investorName}
                    onChange={(e) => setInvestorName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">মোবাইল নম্বর</label>
                  <input
                    type="text"
                    placeholder="01XXXXXXXXX"
                    value={investorPhone}
                    onChange={(e) => setInvestorPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">জমার মাধ্যম</label>
                  <select
                    value={investorDestinationAcc}
                    onChange={(e) => setInvestorDestinationAcc(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="BANK">ব্যাংক জমা (1030)</option>
                    <option value="CASH">নগদ তহবিল (1010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">বিনিয়োগকৃত মূলধন ৳ (Capital)</label>
                  <input
                    type="number"
                    required
                    placeholder="৳"
                    value={investorAmount}
                    onChange={(e) => setInvestorAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">অংশীদারিত্ব হার (% Share)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="যেমন: 15%"
                    value={investorSharePct}
                    onChange={(e) => setInvestorSharePct(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewInvestor(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  মূলধন হিসাবভুক্ত করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {investors.map((inv) => (
              <div
                key={inv.id}
                className="p-4 rounded-xl bg-slate-800/50 border border-slate-800 space-y-2 text-xs shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-sm">{inv.name}</h4>
                    <p className="text-[10px] text-slate-400">{inv.phone || 'ফোন নেই'}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-800 font-mono text-[10px]">
                    {inv.sharePercentage}% শেয়ার
                  </span>
                </div>

                <div className="pt-2 border-t border-slate-800 space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between text-slate-300">
                    <span>বিনিয়োগকৃত মূলধন:</span>
                    <span className="font-bold text-emerald-400">{fmt(inv.capitalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>উত্তোলন (Drawings):</span>
                    <span className="text-rose-400">{fmt(inv.drawings || 0)}</span>
                  </div>
                  <div className="flex justify-between text-white font-bold pt-1 border-t border-slate-700">
                    <span>বর্তমান ইকুইটি স্থিতি:</span>
                    <span>{fmt(inv.currentBalance)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
