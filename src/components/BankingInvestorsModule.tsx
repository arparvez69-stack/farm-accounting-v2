import React, { useEffect, useState } from 'react';
import {
  Landmark,
  Wallet,
  ArrowRightLeft,
  Users,
  PlusCircle,
  CheckCircle2,
  AlertCircle,
  Eye,
  Clock,
  Calendar,
  CreditCard,
  X
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  executeContraTransferTransaction,
  executeInvestorTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction
} from '../services/transactionService';
import { generateAmortizationSchedule } from '../accounting/amortizationService';
import { AmortizationScheduleItem, CashBankAccount, Investor, Loan, UserRole } from '../types';
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
  const [annualInterestRatePercent, setAnnualInterestRatePercent] = useState('9');
  const [termMonths, setTermMonths] = useState('12');
  const [loanDestinationAcc, setLoanDestinationAcc] = useState<'CASH' | 'BANK'>('BANK');
  const [loanStartDate, setLoanStartDate] = useState(new Date().toISOString().split('T')[0]);

  // Selected Loan & Schedule Detail View
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);

  // Selected Investor & Schedule Detail View
  const [selectedInvestor, setSelectedInvestor] = useState<Investor | null>(null);

  // Repayment Modal State
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [repaymentLoan, setRepaymentLoan] = useState<Loan | null>(null);
  const [repaymentPrincipal, setRepaymentPrincipal] = useState('');
  const [repaymentInterest, setRepaymentInterest] = useState('');
  const [repaymentInstallmentNum, setRepaymentInstallmentNum] = useState<number | undefined>(undefined);
  const [repaymentSourceAccId, setRepaymentSourceAccId] = useState('');
  const [repaymentDate, setRepaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [repaymentNote, setRepaymentNote] = useState('');

  // New Investor Modal
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [investorName, setInvestorName] = useState('');
  const [investorPhone, setInvestorPhone] = useState('');
  const [investorAmount, setInvestorAmount] = useState('');
  const [investorSharePct, setInvestorSharePct] = useState('');
  const [investorAnnualRate, setInvestorAnnualRate] = useState('');
  const [investorTermMonths, setInvestorTermMonths] = useState('');
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
        if (selectedLoan) {
          const fresh = loanList.find((l) => l.id === selectedLoan.id);
          if (fresh) setSelectedLoan(fresh);
        }
      } else if (tab === 'investors') {
        const invList = await db.investors.toArray();
        setInvestors(invList);
        if (selectedInvestor) {
          const freshInv = invList.find((i) => i.id === selectedInvestor.id);
          if (freshInv) setSelectedInvestor(freshInv);
        }
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
    const rate = parseFloat(annualInterestRatePercent) || 0;
    const months = parseInt(termMonths) || 12;

    if (!loanLenderName.trim() || principal <= 0) {
      setMsg({ type: 'error', text: 'ঋণদাতার নাম ও মূলধনের পরিমাণ সঠিকভাবে লিখুন।' });
      return;
    }

    try {
      const res = await executeLoanTransaction({
        lenderName: loanLenderName.trim(),
        principal,
        annualInterestRatePercent: rate,
        interestRate: rate,
        termMonths: months,
        tenureMonths: months,
        startDate: loanStartDate,
        targetAccountId: loanDestinationAcc,
        currentUserId
      });

      setShowNewLoan(false);
      setLoanLenderName('');
      setLoanPrincipal('');
      setAnnualInterestRatePercent('9');
      setTermMonths('12');
      setMsg({
        type: 'success',
        text: `ঋণ চুক্তি ${res.loan.loanNumber || res.loan.id} (৳${res.loan.principalAmount}) সফলভাবে গৃহীত এবং কিস্তির সূচি তৈরি হয়েছে!`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ঋণ গ্রহণ প্রক্রিয়া ব্যর্থ হয়েছে।' });
    }
  };

  // OPEN LOAN REPAYMENT MODAL
  const handleOpenRepaymentModal = (loan: Loan, installment?: AmortizationScheduleItem) => {
    setRepaymentLoan(loan);
    setRepaymentPrincipal(installment ? String(installment.principalPortion) : '');
    setRepaymentInterest(installment ? String(installment.interestPortion) : '0');
    setRepaymentInstallmentNum(installment ? installment.installmentNumber : undefined);
    setRepaymentDate(installment?.date || new Date().toISOString().split('T')[0]);
    setRepaymentNote(installment ? `কিস্তি #${installment.installmentNumber} পরিশোধ` : 'ঋণ কিস্তি পরিশোধ');
    // Default to first account or bank account
    if (accounts.length > 0) {
      const defaultAcc = accounts.find((a) => a.accountType === 'BANK' && a.currentBalance > 0) || accounts[0];
      setRepaymentSourceAccId(defaultAcc.id);
    }
    setShowRepaymentModal(true);
  };

  // EXECUTE LOAN REPAYMENT
  const handleExecuteRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repaymentLoan) return;

    const pAmt = parseFloat(repaymentPrincipal) || 0;
    const iAmt = parseFloat(repaymentInterest) || 0;

    if (pAmt + iAmt <= 0) {
      setMsg({ type: 'error', text: 'পরিশোধের আসল বা সুদের পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }

    if (!repaymentSourceAccId) {
      setMsg({ type: 'error', text: 'পরিশোধের ব্যাংক বা নগদ হিসাব নির্বাচন করুন।' });
      return;
    }

    try {
      const res = await executeLoanRepaymentTransaction({
        loanId: repaymentLoan.id,
        sourceAccountId: repaymentSourceAccId,
        principalAmount: pAmt,
        interestAmount: iAmt,
        installmentNumber: repaymentInstallmentNum,
        repaymentDate,
        note: repaymentNote.trim() || undefined,
        currentUserId
      });

      setShowRepaymentModal(false);
      setSelectedLoan(res.updatedLoan);
      setMsg({
        type: 'success',
        text: `ঋণ পরিশোধ সফল হয়েছে! ভাউচার তৈরি হয়েছে এবং কিস্তি তালিকায় পরিশোধ হিসেবে চিহ্নিত হয়েছে।`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ঋণ পরিশোধ প্রক্রিয়া ব্যর্থ হয়েছে।' });
    }
  };

  // EXECUTE INVESTOR CONTRIBUTION
  const handleCreateInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(investorAmount) || 0;
    const share = parseFloat(investorSharePct) || 0;
    const annualRate = investorAnnualRate ? parseFloat(investorAnnualRate) : undefined;
    const invMonths = investorTermMonths ? parseInt(investorTermMonths) : undefined;

    if (!investorName.trim() || amt <= 0) {
      setMsg({ type: 'error', text: 'বিনিয়োগকারীর নাম ও বিনিয়োগকৃত মূলধন সঠিকভাবে লিখুন।' });
      return;
    }

    try {
      const res = await executeInvestorTransaction({
        investorName: investorName.trim(),
        phone: investorPhone.trim() || undefined,
        contribution: amt,
        profitShare: share,
        annualInterestRatePercent: annualRate,
        termMonths: invMonths,
        targetAccountId: investorDestinationAcc,
        currentUserId
      });

      setShowNewInvestor(false);
      setInvestorName('');
      setInvestorPhone('');
      setInvestorAmount('');
      setInvestorSharePct('');
      setInvestorAnnualRate('');
      setInvestorTermMonths('');
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
    <div className="space-y-4 pb-6 max-w-5xl mx-auto rounded-3xl p-2 sm:p-4 bg-gradient-to-b from-blue-500/[0.08] via-sky-500/[0.03] to-transparent dark:from-blue-950/30 dark:via-blue-950/10 dark:to-transparent">
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
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মূল ঋণের পরিমাণ ৳ (Principal)</label>
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
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">
                    বার্ষিক সুদের হার % (annualInterestRatePercent)
                  </label>
                  <input
                    id="annualInterestRatePercent"
                    name="annualInterestRatePercent"
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    value={annualInterestRatePercent}
                    onChange={(e) => setAnnualInterestRatePercent(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">
                    ঋণের মেয়াদ মাস (termMonths)
                  </label>
                  <input
                    id="termMonths"
                    name="termMonths"
                    type="number"
                    min="1"
                    required
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">শুরুর/বিতরণ তারিখ</label>
                  <input
                    type="date"
                    required
                    value={loanStartDate}
                    onChange={(e) => setLoanStartDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              {Number(loanPrincipal) > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px] text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5 font-semibold text-[#1E5128]">
                    <Calendar className="w-4 h-4 shrink-0 text-[#1E5128]" />
                    <span>অনুমানিত মাসিক কিস্তি (Estimated Monthly Installment):</span>
                  </span>
                  <span className="font-bold font-mono text-[14px] text-[#1E5128]">
                    {fmt(
                      generateAmortizationSchedule(
                        parseFloat(loanPrincipal) || 0,
                        parseFloat(annualInterestRatePercent) || 0,
                        parseInt(termMonths) || 12,
                        loanStartDate
                      )[0]?.totalPayment || 0
                    )} / মাস ({termMonths} টি সমান মাসিক কিস্তি)
                  </span>
                </div>
              )}

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
                  <th className="p-3">মেয়াদকাল</th>
                  <th className="p-3">বকেয়া কিস্তি/স্থিতি</th>
                  <th className="p-3">অবস্থা</th>
                  <th className="p-3 text-center">কিস্তির সূচি ও অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-500 text-[14px]">
                      বর্তমানে কোনো সক্রিয় ব্যাংক বা মহাজনি ঋণ নেই।
                    </td>
                  </tr>
                ) : (
                  loans.map((l) => {
                    const paidCount = l.schedule ? l.schedule.filter((s) => s.isPaid).length : 0;
                    const totalCount = l.schedule?.length || l.termMonths || l.tenureMonths || 12;

                    return (
                      <tr key={l.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="p-3 font-bold text-[#1E5128] font-mono">{l.loanNumber || l.id}</td>
                        <td className="p-3 font-semibold text-gray-900">{l.lenderName}</td>
                        <td className="p-3 text-gray-600 text-[13px]">
                          {l.term === 'SHORT_TERM' ? 'স্বল্পমেয়াদী (2110)' : 'দীর্ঘমেয়াদী (2120)'}
                        </td>
                        <td className="p-3 text-gray-900 font-bold font-mono">{fmt(l.principalAmount)}</td>
                        <td className="p-3 text-gray-700 font-mono">
                          {l.annualInterestRatePercent ?? l.interestRate ?? 0}%
                        </td>
                        <td className="p-3 text-gray-700 text-[13px]">
                          {l.termMonths ?? l.tenureMonths ?? 12} মাস
                        </td>
                        <td className="p-3 text-amber-700 font-bold font-mono">
                          {fmt(l.remainingBalance ?? l.remainingPrincipal ?? 0)}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              l.status === 'PAID_OFF'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {l.status === 'PAID_OFF' ? 'পরিশোধিত' : 'চলমান'}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => setSelectedLoan(l)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold cursor-pointer flex items-center gap-1"
                              title="কিস্তির সূচি ও বিস্তারিত দেখুন"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>কিস্তির সূচি ({paidCount}/{totalCount})</span>
                            </button>
                            {role === 'OWNER' && l.status !== 'PAID_OFF' && (
                              <button
                                onClick={() => handleOpenRepaymentModal(l)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-semibold cursor-pointer flex items-center gap-1"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>পরিশোধ</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
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

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
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
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">
                    বার্ষিক লভ্যাংশ/মুনাফা হার % (ঐচ্ছিক)
                  </label>
                  <input
                    id="investor-annualInterestRatePercent"
                    name="annualInterestRatePercent"
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="যেমন: 10"
                    value={investorAnnualRate}
                    onChange={(e) => setInvestorAnnualRate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">
                    মেয়াদকাল মাস (ঐচ্ছিক)
                  </label>
                  <input
                    id="investor-termMonths"
                    name="termMonths"
                    type="number"
                    min="1"
                    placeholder="যেমন: 12"
                    value={investorTermMonths}
                    onChange={(e) => setInvestorTermMonths(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono"
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

                {inv.schedule && inv.schedule.length > 0 && (
                  <div className="pt-2">
                    <button
                      onClick={() => setSelectedInvestor(inv)}
                      className="w-full py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>কিস্তির সূচি দেখুন ({inv.schedule.filter((s) => s.isPaid).length}/{inv.schedule.length})</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== LOAN DETAIL & AMORTIZATION SCHEDULE MODAL ===================== */}
      {selectedLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 space-y-5 my-8 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-gray-100 pb-4 shrink-0">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs bg-[#1E5128] text-white px-2 py-0.5 rounded">
                    {selectedLoan.loanNumber || selectedLoan.id}
                  </span>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900">
                    {selectedLoan.lenderName}
                  </h3>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      selectedLoan.status === 'PAID_OFF'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-blue-100 text-blue-800 border border-blue-300'
                    }`}
                  >
                    {selectedLoan.status === 'PAID_OFF' ? 'পরিশোধ সম্পন্ন (PAID OFF)' : 'চলমান ঋণ (ACTIVE)'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  বিতরণের তারিখ: {selectedLoan.disbursedDate || selectedLoan.startDate || '—'} | মেয়াদ: {selectedLoan.termMonths ?? selectedLoan.tenureMonths ?? 12} মাস | বার্ষিক সুদের হার: {selectedLoan.annualInterestRatePercent ?? selectedLoan.interestRate ?? 0}%
                </p>
              </div>

              <div className="flex items-center gap-2">
                {role === 'OWNER' && selectedLoan.status !== 'PAID_OFF' && (
                  <button
                    onClick={() => handleOpenRepaymentModal(selectedLoan)}
                    className="px-3.5 py-1.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>+ কিস্তি পরিশোধ</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedLoan(null)}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Loan Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-xs text-gray-500 block">মূল ঋণ (Principal)</span>
                <span className="text-sm sm:text-base font-bold text-gray-900 font-mono">
                  {fmt(selectedLoan.principalAmount)}
                </span>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                <span className="text-xs text-amber-700 block">বকেয়া ঋণ (Remaining)</span>
                <span className="text-sm sm:text-base font-bold text-amber-800 font-mono">
                  {fmt(selectedLoan.remainingBalance ?? selectedLoan.remainingPrincipal ?? 0)}
                </span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                <span className="text-xs text-emerald-700 block">পরিশোধিত আসল (Principal Paid)</span>
                <span className="text-sm sm:text-base font-bold text-emerald-800 font-mono">
                  {fmt(selectedLoan.totalPaidPrincipal || 0)}
                </span>
              </div>
              <div className="p-3 bg-sky-50 rounded-xl border border-sky-100">
                <span className="text-xs text-sky-700 block">পরিশোধিত সুদ (Interest Paid)</span>
                <span className="text-sm sm:text-base font-bold text-sky-800 font-mono">
                  {fmt(selectedLoan.totalPaidInterest || 0)}
                </span>
              </div>
            </div>

            {/* Schedule Section */}
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-[#1E5128]" />
                  <span>ঋণ পরিশোধ ও কিস্তির সূচি (Amortization Schedule)</span>
                </h4>
                <span className="text-xs text-gray-500">
                  হ্রাসমান জের (Reducing-Balance) পদ্ধতিতে নির্ধারিত মাসিক কিস্তি
                </span>
              </div>

              {/* Schedule Table */}
              <div className="overflow-x-auto overflow-y-auto flex-1 rounded-xl border border-gray-200">
                {(() => {
                  const effectiveSchedule =
                    selectedLoan.schedule && selectedLoan.schedule.length > 0
                      ? selectedLoan.schedule
                      : generateAmortizationSchedule(
                          selectedLoan.principalAmount,
                          selectedLoan.annualInterestRatePercent ?? selectedLoan.interestRate ?? 0,
                          selectedLoan.termMonths ?? selectedLoan.tenureMonths ?? 12,
                          selectedLoan.disbursedDate || selectedLoan.startDate
                        );

                  return (
                    <table className="w-full text-left text-xs text-gray-800 border-collapse">
                      <thead className="bg-[#F8FAFC] text-gray-700 font-semibold border-b border-gray-200 sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5 text-center">কিস্তি #</th>
                          <th className="p-2.5">পরিশোধ তারিখ</th>
                          <th className="p-2.5 text-right">আসল (Principal)</th>
                          <th className="p-2.5 text-right">সুদ (Interest)</th>
                          <th className="p-2.5 text-right">মোট কিস্তি (EMI)</th>
                          <th className="p-2.5 text-right">অবশিষ্ট ঋণ</th>
                          <th className="p-2.5 text-center">অবস্থা (Status)</th>
                          {role === 'OWNER' && <th className="p-2.5 text-center">অ্যাকশন</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {effectiveSchedule.map((item) => (
                          <tr
                            key={item.installmentNumber}
                            className={`transition-colors ${
                              item.isPaid ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="p-2.5 font-bold font-mono text-center text-gray-900">
                              #{item.installmentNumber}
                            </td>
                            <td className="p-2.5 font-mono text-gray-700 whitespace-nowrap">
                              {item.date}
                            </td>
                            <td className="p-2.5 text-right font-mono font-medium text-gray-900">
                              {fmt(item.principalPortion)}
                            </td>
                            <td className="p-2.5 text-right font-mono text-amber-700">
                              {fmt(item.interestPortion)}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-[#1E5128]">
                              {fmt(item.totalPayment)}
                            </td>
                            <td className="p-2.5 text-right font-mono text-gray-600">
                              {fmt(item.remainingBalance)}
                            </td>
                            <td className="p-2.5 text-center whitespace-nowrap">
                              {item.isPaid ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>পরিশোধিত</span>
                                  {item.paidDate && (
                                    <span className="text-[10px] text-emerald-600">({item.paidDate})</span>
                                  )}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                                  <span>বকেয়া</span>
                                </span>
                              )}
                            </td>
                            {role === 'OWNER' && (
                              <td className="p-2.5 text-center">
                                {item.isPaid ? (
                                  <span className="text-[11px] text-emerald-700 font-semibold">সম্পন্ন</span>
                                ) : (
                                  <button
                                    onClick={() => handleOpenRepaymentModal(selectedLoan, item)}
                                    className="px-2 py-1 rounded bg-[#1E5128] hover:bg-[#173F1F] text-white text-[11px] font-semibold cursor-pointer"
                                  >
                                    পরিশোধ
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-2 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLoan(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold cursor-pointer"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== INVESTOR DETAIL & SCHEDULE MODAL ===================== */}
      {selectedInvestor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 space-y-4 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selectedInvestor.name}</h3>
                <p className="text-xs text-gray-500">
                  শেয়ার: {selectedInvestor.sharePercentage}% | বিনিয়োগ: {fmt(selectedInvestor.capitalAmount)} | স্থিতি: {fmt(selectedInvestor.currentBalance)}
                </p>
              </div>
              <button
                onClick={() => setSelectedInvestor(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto flex-1 rounded-xl border border-gray-200">
              <table className="w-full text-left text-xs text-gray-800 border-collapse">
                <thead className="bg-[#F8FAFC] text-gray-700 font-semibold border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="p-2.5 text-center">কিস্তি #</th>
                    <th className="p-2.5">তারিখ</th>
                    <th className="p-2.5 text-right">আসল অংশ</th>
                    <th className="p-2.5 text-right">মুনাফা/সুদ</th>
                    <th className="p-2.5 text-right">মোট প্রদেয়</th>
                    <th className="p-2.5 text-right">অবশিষ্ট মূলধন</th>
                    <th className="p-2.5 text-center">অবস্থা</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedInvestor.schedule?.map((item) => (
                    <tr key={item.installmentNumber} className={item.isPaid ? 'bg-emerald-50/40' : ''}>
                      <td className="p-2.5 text-center font-bold font-mono">#{item.installmentNumber}</td>
                      <td className="p-2.5 font-mono">{item.date}</td>
                      <td className="p-2.5 text-right font-mono">{fmt(item.principalPortion)}</td>
                      <td className="p-2.5 text-right font-mono">{fmt(item.interestPortion)}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-[#1E5128]">{fmt(item.totalPayment)}</td>
                      <td className="p-2.5 text-right font-mono">{fmt(item.remainingBalance)}</td>
                      <td className="p-2.5 text-center">
                        {item.isPaid ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            পরিশোধিত
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            বকেয়া
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedInvestor(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold cursor-pointer"
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== LOG REPAYMENT MODAL ===================== */}
      {showRepaymentModal && repaymentLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs">
          <form
            onSubmit={handleExecuteRepayment}
            className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-gray-200 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#1E5128]" />
                  <span>ঋণ কিস্তি পরিশোধ ভাউচার</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {repaymentLoan.lenderName} ({repaymentLoan.loanNumber || repaymentLoan.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRepaymentModal(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700 mb-1">পরিশোধের উৎস হিসাব (Source Account)</label>
                <select
                  required
                  value={repaymentSourceAccId}
                  onChange={(e) => setRepaymentSourceAccId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900"
                >
                  <option value="">হিসাব নির্বাচন করুন...</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.accountType === 'BANK' ? acc.bankName || 'ব্যাংক' : 'ক্যাশ'}) - স্থিতি: {fmt(acc.currentBalance)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">আসল অংশ ৳ (Principal)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={repaymentPrincipal}
                    onChange={(e) => setRepaymentPrincipal(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-gray-700 mb-1">সুদ খরচ ৳ (Interest Expense)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={repaymentInterest}
                    onChange={(e) => setRepaymentInterest(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900 font-mono"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 flex justify-between items-center text-xs">
                <span className="font-semibold text-gray-700">মোট পরিশোধের পরিমাণ:</span>
                <span className="font-bold text-sm text-[#1E5128] font-mono">
                  {fmt((parseFloat(repaymentPrincipal) || 0) + (parseFloat(repaymentInterest) || 0))}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">পরিশোধ তারিখ</label>
                  <input
                    type="date"
                    required
                    value={repaymentDate}
                    onChange={(e) => setRepaymentDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900"
                  />
                </div>
                <div>
                  <label className="block font-medium text-gray-700 mb-1">কিস্তি নম্বর (ঐচ্ছিক)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="যেমন: 1"
                    value={repaymentInstallmentNum ?? ''}
                    onChange={(e) =>
                      setRepaymentInstallmentNum(e.target.value ? parseInt(e.target.value) : undefined)
                    }
                    className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-gray-700 mb-1">নোট / রেফারেন্স</label>
                <input
                  type="text"
                  placeholder="রেফারেন্স বা চেক নম্বর"
                  value={repaymentNote}
                  onChange={(e) => setRepaymentNote(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowRepaymentModal(false)}
                className="px-3.5 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold cursor-pointer shadow-xs"
              >
                পরিশোধ নিশ্চিত করুন
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
