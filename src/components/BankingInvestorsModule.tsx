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
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Module Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-[#1E5128]" />
            <span>ব্যাংকিং, তহবিল স্থানান্তর, ঋণ ও মূলধন (Banking & Capital)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            নগদ ও ব্যাংক তহবিল (1010/1030), কন্ট্রা জাবেদা, ব্যাংক ঋণ (2110/2120) ও বিনিয়োগকারী মূলধন (3020)
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
          <button
            onClick={() => setTab('accounts')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'accounts' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            তহবিল ও ব্যাংক (Accounts)
          </button>
          <button
            onClick={() => setTab('transfers')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'transfers' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            কন্ট্রা স্থানান্তর (Contra)
          </button>
          <button
            onClick={() => setTab('loans')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'loans' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            ব্যাংক ও মহাজনি ঋণ (Loans)
          </button>
          <button
            onClick={() => setTab('investors')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'investors' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            বিনিয়োগকারী ও শেয়ার (Investors)
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

      {/* ===================== TAB 1: CASH & BANK ACCOUNTS ===================== */}
      {tab === 'accounts' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-[#1E5128]" />
                <span>নগদ ড্রয়ার ও ব্যাংক অ্যাকাউন্টসমূহ ({accounts.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">খামারের নগদ টাকা ও বিভিন্ন ব্যাংকের চলতি/সঞ্চয়ী হিসাব</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAccount(!showAddAccount)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন ব্যাংক একাউন্ট</span>
              </button>
            )}
          </div>

          {showAddAccount && (
            <form onSubmit={handleAddAccount} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন ব্যাংক/তহবিল হিসাব যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">হিসাবের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: ইসলামী ব্যাংক চলতি হিসাব"
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">হিসাবের ধরন</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="BANK">ব্যাংক হিসাব (Bank - 1030)</option>
                    <option value="MOBILE_BANKING">মোবাইল ব্যাংকিং (bKash/Nagad - 1030)</option>
                    <option value="CASH">নগদ তহবিল (Petty Cash - 1020)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">হিসাব নম্বর</label>
                  <input
                    type="text"
                    placeholder="A/C Number"
                    value={accNumber}
                    onChange={(e) => setAccNumber(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              {accType === 'BANK' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 mb-1">ব্যাংকের নাম</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 mb-1">শাখা (Branch)</label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="শাখার নাম"
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-1">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 rounded-xl bg-white border border-gray-200 text-[#1E5128] shadow-xs">
                      {a.accountType === 'CASH' ? <Wallet className="w-5 h-5" /> : <Landmark className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-[15px] leading-tight">{a.name}</h4>
                      <p className="text-[12px] text-gray-500">
                        {a.bankName ? `${a.bankName} (${a.accountNumber || 'N/A'})` : a.accountType}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-200 text-gray-700 font-mono font-semibold">
                    {a.accountType === 'CASH' ? '1010' : '1030'}
                  </span>
                </div>

                <div className="pt-2.5 border-t border-gray-200 flex items-center justify-between font-mono">
                  <span className="text-gray-600 text-[13px]">বর্তমান স্থিতি:</span>
                  <span className={`text-[17px] font-bold ${a.currentBalance < 0 ? 'text-red-600' : 'text-[#15803D]'}`}>
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
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#1E5128]" />
                <span>তহবিল স্থানান্তর / কন্ট্রা ভাউচার (Contra Transfers)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                ব্যাংক থেকে নগদ উত্তোলন অথবা ব্যাংকে নগদ জমা (সম্পূর্ণ পারমাণবিক লেনদেন)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowTransfer(!showTransfer)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন স্থানান্তর</span>
              </button>
            )}
          </div>

          {showTransfer && (
            <form onSubmit={handleExecuteTransfer} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">কন্ট্রা ভাউচার তৈরি করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">উৎস হিসাব (টাকা যাবে)</label>
                  <select
                    value={fromAccId}
                    onChange={(e) => setFromAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
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
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">গন্তব্য হিসাব (টাকা জমা হবে)</label>
                  <select
                    value={toAccId}
                    onChange={(e) => setToAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
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
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">স্থানান্তরের পরিমাণ (৳)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="টাকার অংক"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বিবরণ / নোট</label>
                  <input
                    type="text"
                    placeholder="যেমন: খামার খরচের জন্য ব্যাংক হতে নগদ উত্তোলন"
                    value={transferNarration}
                    onChange={(e) => setTransferNarration(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowTransfer(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  স্থানান্তর সম্পন্ন করুন
                </button>
              </div>
            </form>
          )}

          <div className="p-5 text-center text-gray-600 text-[14px] bg-[#F8FAFC] rounded-xl border border-gray-200">
            কন্ট্রা ভাউচার নিশ্চিত করার সাথে সাথে স্বয়ংক্রিয়ভাবে উভয় হিসাবের স্থিতি সমন্বয় হবে এবং
            দ্বৈত-দাখিলায় ডেবিট-ক্রেডিট হিসেবে সংরক্ষিত হবে।
          </div>
        </div>
      )}

      {/* ===================== TAB 3: LOANS ===================== */}
      {tab === 'loans' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Landmark className="w-5 h-5 text-[#1E5128]" />
                <span>ব্যাংক ও মহাজনি ঋণ ট্র্যাকিং ({loans.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                স্বল্পমেয়াদী ঋণ: Cr 2110 | দীর্ঘমেয়াদী ঋণ: Cr 2120 | তহবিল প্রাপ্তি: Dr 1010/1030
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewLoan(!showNewLoan)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন ঋণ চুক্তি</span>
              </button>
            )}
          </div>

          {showNewLoan && (
            <form onSubmit={handleCreateLoan} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন ঋণ গ্রহণ ও হিসাবভুক্তকরণ</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ঋণদাতা ব্যাংক/মহাজন</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: বাংলাদেশ কৃষি ব্যাংক"
                    value={loanLenderName}
                    onChange={(e) => setLoanLenderName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ঋণের মেয়াদকাল</label>
                  <select
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="SHORT_TERM">স্বল্পমেয়াদী ঋণ (১২ মাসের নিচে - 2110)</option>
                    <option value="LONG_TERM">দীর্ঘমেয়াদী ঋণ (১২ মাসের উপরে - 2120)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">টাকা জমার হিসাব</label>
                  <select
                    value={loanDestinationAcc}
                    onChange={(e) => setLoanDestinationAcc(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="BANK">ব্যাংক একাউন্ট (1030)</option>
                    <option value="CASH">নগদ ড্রয়ার (1010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মূল ঋণের পরিমাণ ৳</label>
                  <input
                    type="number"
                    required
                    placeholder="টাকা"
                    value={loanPrincipal}
                    onChange={(e) => setLoanPrincipal(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">সুদের হার (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={loanInterestRate}
                    onChange={(e) => setLoanInterestRate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">শুরুর তারিখ</label>
                  <input
                    type="date"
                    value={loanStartDate}
                    onChange={(e) => setLoanStartDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মেয়াদ (মাস)</label>
                  <input
                    type="number"
                    value={loanDurationMonths}
                    onChange={(e) => setLoanDurationMonths(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewLoan(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  ঋণ নিশ্চিত ও পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">ঋণ নং</th>
                  <th className="p-3">ঋণদাতা</th>
                  <th className="p-3">মেয়াদ ধরন</th>
                  <th className="p-3">মূলধন (Principal)</th>
                  <th className="p-3">সুদের হার</th>
                  <th className="p-3">বকেয়া কিস্তি/স্থিতি</th>
                  <th className="p-3">অবস্থা</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500 text-[14px]">
                      বর্তমানে কোনো সক্রিয় ব্যাংক বা মহাজনি ঋণ নেই।
                    </td>
                  </tr>
                ) : (
                  loans.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50/80">
                      <td className="p-3 font-bold text-[#1E5128] font-mono">{l.loanNumber}</td>
                      <td className="p-3 font-semibold text-gray-900">{l.lenderName}</td>
                      <td className="p-3 text-gray-600 text-[13px]">
                        {l.term === 'SHORT_TERM' ? 'স্বল্পমেয়াদী (2110)' : 'দীর্ঘমেয়াদী (2120)'}
                      </td>
                      <td className="p-3 text-gray-900 font-bold font-mono">{fmt(l.principalAmount)}</td>
                      <td className="p-3 text-gray-700 font-mono">{l.interestRate}%</td>
                      <td className="p-3 text-amber-700 font-bold font-mono">{fmt(l.remainingBalance)}</td>
                      <td className="p-3">
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
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
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#1E5128]" />
                <span>বিনিয়োগকারী ও শেয়ারহোল্ডার মূলধন ({investors.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                বিনিয়োগ গ্রহণ: Dr 1010/1030 | শেয়ার মূলধন: Cr 3020 (Investor Capital)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewInvestor(!showNewInvestor)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন বিনিয়োগকারী</span>
              </button>
            )}
          </div>

          {showNewInvestor && (
            <form onSubmit={handleCreateInvestor} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন বিনিয়োগকারীর মূলধন এন্ট্রি</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বিনিয়োগকারীর পূর্ণ নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="নাম"
                    value={investorName}
                    onChange={(e) => setInvestorName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মোবাইল নম্বর</label>
                  <input
                    type="text"
                    placeholder="01XXXXXXXXX"
                    value={investorPhone}
                    onChange={(e) => setInvestorPhone(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">জমার মাধ্যম</label>
                  <select
                    value={investorDestinationAcc}
                    onChange={(e) => setInvestorDestinationAcc(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="BANK">ব্যাংক জমা (1030)</option>
                    <option value="CASH">নগদ তহবিল (1010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বিনিয়োগকৃত মূলধন ৳ (Capital)</label>
                  <input
                    type="number"
                    required
                    placeholder="৳"
                    value={investorAmount}
                    onChange={(e) => setInvestorAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">অংশীদারিত্ব হার (% Share)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="যেমন: 15%"
                    value={investorSharePct}
                    onChange={(e) => setInvestorSharePct(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewInvestor(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  মূলধন হিসাবভুক্ত করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {investors.map((inv) => (
              <div
                key={inv.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-gray-900 text-[15px]">{inv.name}</h4>
                    <p className="text-[12px] text-gray-500">{inv.phone || 'ফোন নেই'}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-mono text-xs font-semibold">
                    {inv.sharePercentage}% শেয়ার
                  </span>
                </div>

                <div className="pt-2.5 border-t border-gray-200 space-y-1.5 font-mono text-[13px]">
                  <div className="flex justify-between text-gray-700">
                    <span className="font-sans">বিনিয়োগকৃত মূলধন:</span>
                    <span className="font-bold text-[#15803D]">{fmt(inv.capitalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span className="font-sans">উত্তোলন (Drawings):</span>
                    <span className="text-red-600 font-semibold">{fmt(inv.drawings || 0)}</span>
                  </div>
                  <div className="flex justify-between text-gray-900 font-bold pt-1.5 border-t border-gray-200">
                    <span className="font-sans">বর্তমান ইকুইটি স্থিতি:</span>
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
