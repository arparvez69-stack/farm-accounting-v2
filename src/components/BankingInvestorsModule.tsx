import React, { useEffect, useState } from 'react';
import {
  Landmark,
  Wallet,
  ArrowRightLeft,
  Users,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  AlertCircle,
  Eye,
  Clock,
  Calendar,
  CreditCard,
  UserCheck,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  X,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Search,
  CheckSquare,
  Square
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  executeContraTransferTransaction,
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction,
  executeInvestorProfitPaymentTransaction,
  executeInvestorCapitalReturnTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeOwnerCapitalTransaction,
  executeOwnerDrawingTransaction
} from '../services/transactionService';
import { generateAmortizationSchedule } from '../accounting/amortizationService';
import { AmortizationScheduleItem, CashBankAccount, Investor, Loan, UserRole, JournalEntry } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import {
  BankReconcileTransaction,
  calculateBankReconciliationMetrics,
  getStoredBankReconciliation,
  loadBankTransactionsForAccount,
  saveStoredBankReconciliation
} from '../accounting/bankReconciliationService';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type FinanceTab = 'accounts' | 'transfers' | 'loans' | 'investors' | 'owner';

export const BankingInvestorsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [tab, setTab] = useState<FinanceTab>('accounts');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [accounts, setAccounts] = useState<CashBankAccount[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);

  // Owner Capital & Drawings State
  const [showAddCapitalModal, setShowAddCapitalModal] = useState(false);
  const [capitalAmount, setCapitalAmount] = useState('');
  const [capitalTargetAccId, setCapitalTargetAccId] = useState('');
  const [capitalDate, setCapitalDate] = useState(new Date().toISOString().split('T')[0]);
  const [capitalNotes, setCapitalNotes] = useState('');

  const [showDrawingModal, setShowDrawingModal] = useState(false);
  const [drawingAmount, setDrawingAmount] = useState('');
  const [drawingSourceAccId, setDrawingSourceAccId] = useState('');
  const [drawingDate, setDrawingDate] = useState(new Date().toISOString().split('T')[0]);
  const [drawingNotes, setDrawingNotes] = useState('');

  const [ownerEntries, setOwnerEntries] = useState<JournalEntry[]>([]);
  const [submittingOwner, setSubmittingOwner] = useState(false);

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
  const [loanType, setLoanType] = useState<'BANK' | 'NGO' | 'INDIVIDUAL'>('BANK');
  const [loanTerm, setLoanTerm] = useState<'SHORT_TERM' | 'LONG_TERM'>('SHORT_TERM');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [annualInterestRatePercent, setAnnualInterestRatePercent] = useState('9');
  const [termMonths, setTermMonths] = useState('12');
  const [loanDestinationAcc, setLoanDestinationAcc] = useState('');
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
  const [submittingRepayment, setSubmittingRepayment] = useState(false);

  // New Investor Modal
  const [showNewInvestor, setShowNewInvestor] = useState(false);
  const [investorName, setInvestorName] = useState('');
  const [investorPhone, setInvestorPhone] = useState('');
  const [investorAmount, setInvestorAmount] = useState('');
  const [investorSharePct, setInvestorSharePct] = useState('');
  const [investorDestinationAcc, setInvestorDestinationAcc] = useState('');

  // Profit Allocation, Payment & Capital Return Modals
  const [allocatingInvestor, setAllocatingInvestor] = useState<Investor | null>(null);
  const [finalizedFarmProfit, setFinalizedFarmProfit] = useState('');
  const [allocationDate, setAllocationDate] = useState(new Date().toISOString().split('T')[0]);
  const [allocationNotes, setAllocationNotes] = useState('');
  const [submittingAllocation, setSubmittingAllocation] = useState(false);

  const [payingInvestor, setPayingInvestor] = useState<Investor | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSourceAccId, setPaymentSourceAccId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [returningCapitalInvestor, setReturningCapitalInvestor] = useState<Investor | null>(null);
  const [capitalReturnAmount, setCapitalReturnAmount] = useState('');
  const [capitalReturnSourceAccId, setCapitalReturnSourceAccId] = useState('');
  const [capitalReturnDate, setCapitalReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [capitalReturnNotes, setCapitalReturnNotes] = useState('');
  const [submittingCapitalReturn, setSubmittingCapitalReturn] = useState(false);

  // Manual Bank & Cash Reconciliation State (Read / Tracking Only)
  const [selectedReconcileAccount, setSelectedReconcileAccount] = useState<CashBankAccount | null>(null);
  const [reconcileTransactions, setReconcileTransactions] = useState<BankReconcileTransaction[]>([]);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [statementBalanceInput, setStatementBalanceInput] = useState('');
  const [clearedTxIds, setClearedTxIds] = useState<Set<string>>(new Set());
  const [statementDate, setStatementDate] = useState(new Date().toISOString().split('T')[0]);
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [reconcileFilter, setReconcileFilter] = useState<'ALL' | 'CLEARED' | 'UNCLEARED'>('ALL');
  const [reconcileSearch, setReconcileSearch] = useState('');

  const handleOpenReconciliation = async (acc: CashBankAccount) => {
    setSelectedReconcileAccount(acc);
    setReconcileLoading(true);
    setReconcileSearch('');
    setReconcileFilter('ALL');
    try {
      const stored = getStoredBankReconciliation(acc.id);
      setStatementBalanceInput(stored.statementBalance || '');
      setClearedTxIds(new Set(stored.clearedTxIds || []));
      setStatementDate(stored.statementDate || new Date().toISOString().split('T')[0]);
      setReconcileNotes(stored.notes || '');

      const res = await loadBankTransactionsForAccount(acc.id);
      setReconcileTransactions(res.transactions);
    } catch (err: any) {
      console.error(err);
      setMsg({ type: 'error', text: 'হিসাব মিলকরণের লেনদেন লোড করতে ত্রুটি হয়েছে।' });
    } finally {
      setReconcileLoading(false);
    }
  };

  const handleToggleCleared = (txId: string) => {
    if (!selectedReconcileAccount) return;
    const next = new Set(clearedTxIds);
    if (next.has(txId)) {
      next.delete(txId);
    } else {
      next.add(txId);
    }
    setClearedTxIds(next);
    saveStoredBankReconciliation(selectedReconcileAccount.id, {
      clearedTxIds: Array.from(next),
      statementBalance: statementBalanceInput,
      statementDate,
      notes: reconcileNotes
    });
  };

  const handleStatementBalanceChange = (val: string) => {
    if (!selectedReconcileAccount) return;
    setStatementBalanceInput(val);
    saveStoredBankReconciliation(selectedReconcileAccount.id, {
      statementBalance: val,
      clearedTxIds: Array.from(clearedTxIds),
      statementDate,
      notes: reconcileNotes
    });
  };

  const handleMarkAllCleared = (markAll: boolean) => {
    if (!selectedReconcileAccount) return;
    const next = markAll ? new Set(reconcileTransactions.map((t) => t.id)) : new Set<string>();
    setClearedTxIds(next);
    saveStoredBankReconciliation(selectedReconcileAccount.id, {
      clearedTxIds: Array.from(next),
      statementBalance: statementBalanceInput,
      statementDate,
      notes: reconcileNotes
    });
  };

  useEffect(() => {
    loadFinanceData();
  }, [tab]);

  const loadFinanceData = async () => {
    setLoading(true);
    try {
      const accList = await db.cashBankAccounts.toArray();
      setAccounts(accList);
      if (selectedReconcileAccount) {
        const fresh = accList.find((a) => a.id === selectedReconcileAccount.id);
        if (fresh) setSelectedReconcileAccount(fresh);
      }

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
      } else if (tab === 'owner') {
        const jEntries = await db.journalEntries.toArray();
        const filtered = jEntries
          .filter((j) => j.lines?.some((l) => l.accountCode === '3010' || l.accountCode === '3040'))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setOwnerEntries(filtered);
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

    if (!loanDestinationAcc) {
      setMsg({ type: 'error', text: 'টাকা জমার হিসাব নির্বাচন করুন।' });
      return;
    }

    try {
      const res = await executeLoanTransaction({
        lenderName: loanLenderName.trim(),
        loanType,
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
      setLoanType('BANK');
      setLoanPrincipal('');
      setAnnualInterestRatePercent('9');
      setTermMonths('12');
      setLoanDestinationAcc('');
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
    setRepaymentSourceAccId('');
    setShowRepaymentModal(true);
  };

  // EXECUTE LOAN REPAYMENT
  const handleExecuteRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repaymentLoan || submittingRepayment) return;

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

    setSubmittingRepayment(true);
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
    } finally {
      setSubmittingRepayment(false);
    }
  };

  // EXECUTE INVESTOR CONTRIBUTION
  const handleCreateInvestor = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(investorAmount) || 0;
    const share = parseFloat(investorSharePct) || 0;

    if (!investorName.trim() || amt <= 0) {
      setMsg({ type: 'error', text: 'বিনিয়োগকারীর নাম ও বিনিয়োগকৃত মূলধন সঠিকভাবে লিখুন (মূলধন > ০ হতে হবে)।' });
      return;
    }

    if (share <= 0 || share > 100) {
      setMsg({
        type: 'error',
        text: 'চুক্তিভিত্তিক লভ্যাংশ বণ্টন অনুপাত (Profit-sharing ratio) অবশ্যই ০ এর বেশি এবং সর্বোচ্চ ১০০% হতে হবে (> 0 এবং <= 100)।'
      });
      return;
    }

    const activeInvestors = investors.filter((i) => i.status !== 'EXITED');
    const existingShareTotal = activeInvestors.reduce((sum, i) => {
      const r = i.profitSharingRatio ?? i.profitSharePercentage ?? i.sharePercentage ?? 0;
      return sum + r;
    }, 0);
    if (existingShareTotal + share > 100) {
      setMsg({
        type: 'error',
        text: `মোট বিনিয়োগকারীদের চুক্তিভিত্তিক লভ্যাংশ অনুপাত ১০০% অতিক্রম করতে পারে না। বর্তমান সক্রিয় বিনিয়োগকারীদের মোট অনুপাত: ${existingShareTotal}%, সর্বোচ্চ অবশিষ্ট অনুপাত: ${100 - existingShareTotal}%।`
      });
      return;
    }

    if (!investorDestinationAcc) {
      setMsg({ type: 'error', text: 'বিনিয়োগ জমার জন্য ক্যাশ বা ব্যাংক হিসাব নির্বাচন করুন।' });
      return;
    }

    try {
      const res = await executeInvestorTransaction({
        investorName: investorName.trim(),
        phone: investorPhone.trim() || undefined,
        contribution: amt,
        profitShare: share,
        profitSharingRatio: share,
        targetAccountId: investorDestinationAcc,
        currentUserId
      });

      setShowNewInvestor(false);
      setInvestorName('');
      setInvestorPhone('');
      setInvestorAmount('');
      setInvestorSharePct('');
      setInvestorDestinationAcc('');
      setMsg({
        type: 'success',
        text: `বিনিয়োগকারী ${res.investor.name} এর ৳${amt.toLocaleString()} মূলধন সরাসরি ৩০২০ (Investor Capital) এ ক্রেডিট ও ব্যাংকে ডেবিট করা হয়েছে!`
      });
      loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'বিনিয়োগ সংরক্ষণ ব্যর্থ হয়েছে।' });
    }
  };

  // EXECUTE INVESTOR PROFIT ALLOCATION (Dr Profit Distribution 3070, Cr Investor Profit Payable 2050)
  const handleExecuteProfitAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocatingInvestor) return;

    const profit = parseFloat(finalizedFarmProfit) || 0;
    if (profit <= 0) {
      setMsg({ type: 'error', text: 'চূড়ান্ত বণ্টনযোগ্য প্রকৃত মুনাফার পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }

    setSubmittingAllocation(true);
    try {
      const res = await executeInvestorProfitAllocationTransaction({
        investorId: allocatingInvestor.id,
        finalizedDistributableProfit: profit,
        allocationDate,
        notes: allocationNotes,
        currentUserId
      });

      setMsg({
        type: 'success',
        text: `বিনিয়োগকারী ${res.investor.name} এর লভ্যাংশ ৳${res.allocatedProfit.toLocaleString()} (${res.profitSharingRatio}%) সফলভাবে বণ্টন ও জাবেদায় পোস্ট করা হয়েছে!`
      });
      setAllocatingInvestor(null);
      setFinalizedFarmProfit('');
      setAllocationNotes('');
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `মুনাফা বণ্টন ব্যর্থ হয়েছে: ${err.message}` });
    } finally {
      setSubmittingAllocation(false);
    }
  };

  // EXECUTE INVESTOR PROFIT PAYMENT (Dr Investor Profit Payable 2050, Cr Cash/Bank 1010/1030)
  const handleExecuteProfitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingInvestor) return;

    const amt = parseFloat(paymentAmount) || 0;
    if (amt <= 0) {
      setMsg({ type: 'error', text: 'পরিশোধের পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }
    const currentPayable = payingInvestor.profitPayable || 0;
    if (amt > currentPayable) {
      setMsg({
        type: 'error',
        text: `পাওনা লভ্যাংশের চেয়ে বেশি পরিশোধ করা সম্ভব নয়। বর্তমান প্রদেয়: ৳${currentPayable}`
      });
      return;
    }

    const accId = paymentSourceAccId;
    if (!accId) {
      setMsg({ type: 'error', text: 'পরিশোধের জন্য ক্যাশ বা ব্যাংক হিসাব নির্বাচন করুন।' });
      return;
    }

    const selectedPayAcc = accounts.find((a: any) => a.id === accId);
    if (selectedPayAcc && typeof selectedPayAcc.currentBalance === 'number' && selectedPayAcc.currentBalance < amt) {
      setMsg({
        type: 'error',
        text: `উৎস হিসাবে পর্যাপ্ত ব্যালেন্স নেই (Insufficient balance)। বর্তমান ব্যালেন্স: ৳${(selectedPayAcc.currentBalance || 0).toLocaleString()}, পরিশোধের আবেদন: ৳${amt.toLocaleString()}`
      });
      return;
    }

    setSubmittingPayment(true);
    try {
      const res = await executeInvestorProfitPaymentTransaction({
        investorId: payingInvestor.id,
        amount: amt,
        sourceAccountId: accId,
        paymentDate,
        notes: paymentNotes,
        currentUserId
      });

      setMsg({
        type: 'success',
        text: `বিনিয়োগকারী ${res.investor.name} কে লভ্যাংশ ৳${amt.toLocaleString()} সফলভাবে পরিশোধ করা হয়েছে (অবশিষ্ট প্রদেয়: ৳${res.remainingPayable.toLocaleString()})!`
      });
      setPayingInvestor(null);
      setPaymentAmount('');
      setPaymentNotes('');
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `লভ্যাংশ পরিশোধ ব্যর্থ হয়েছে: ${err.message}` });
    } finally {
      setSubmittingPayment(false);
    }
  };

  // EXECUTE INVESTOR CAPITAL RETURN (Dr 3020 Investor Capital, Cr 1010/1030 Cash/Bank)
  const handleExecuteCapitalReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningCapitalInvestor) return;

    const amt = parseFloat(capitalReturnAmount) || 0;
    if (amt <= 0) {
      setMsg({ type: 'error', text: 'মূলধন ফেরতের পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }
    const currentCapital = returningCapitalInvestor.currentCapitalBalance ?? returningCapitalInvestor.capitalAmount ?? 0;
    if (amt > currentCapital) {
      setMsg({
        type: 'error',
        text: `বিদ্যমান মূলধনের চেয়ে বেশি ফেরত দেওয়া সম্ভব নয়। বর্তমান মূলধন স্থিতি: ৳${currentCapital.toLocaleString()}`
      });
      return;
    }

    const accId = capitalReturnSourceAccId;
    if (!accId) {
      setMsg({ type: 'error', text: 'মূলধন ফেরতের জন্য ক্যাশ বা ব্যাংক হিসাব নির্বাচন করুন।' });
      return;
    }

    const selectedReturnAcc = accounts.find((a: any) => a.id === accId);
    if (selectedReturnAcc && typeof selectedReturnAcc.currentBalance === 'number' && selectedReturnAcc.currentBalance < amt) {
      setMsg({
        type: 'error',
        text: `উৎস হিসাবে পর্যাপ্ত ব্যালেন্স নেই (Insufficient balance)। বর্তমান ব্যালেন্স: ৳${(selectedReturnAcc.currentBalance || 0).toLocaleString()}, ফেরত দাবি: ৳${amt.toLocaleString()}`
      });
      return;
    }

    setSubmittingCapitalReturn(true);
    try {
      const res = await executeInvestorCapitalReturnTransaction({
        investorId: returningCapitalInvestor.id,
        amount: amt,
        sourceAccountId: accId,
        returnDate: capitalReturnDate,
        notes: capitalReturnNotes,
        currentUserId
      });

      setMsg({
        type: 'success',
        text: `বিনিয়োগকারী ${res.investor.name} এর মূলধন ৳${amt.toLocaleString()} সফলভাবে ফেরত ও জাবেদায় পোস্ট করা হয়েছে (অবশিষ্ট মূলধন: ৳${(res.investor.currentCapitalBalance || 0).toLocaleString()})!`
      });
      setReturningCapitalInvestor(null);
      setCapitalReturnAmount('');
      setCapitalReturnNotes('');
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `মূলধন ফেরত ব্যর্থ হয়েছে: ${err.message}` });
    } finally {
      setSubmittingCapitalReturn(false);
    }
  };

  // EXECUTE OWNER CAPITAL (Add Capital: Dr Cash/Bank, Cr 3010)
  const handleExecuteAddCapital = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(capitalAmount) || 0;
    if (amt <= 0) {
      setMsg({ type: 'error', text: 'মূলধনের পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }
    if (!capitalTargetAccId) {
      setMsg({ type: 'error', text: 'জমার জন্য ক্যাশ বা ব্যাংক হিসাব নির্বাচন করুন।' });
      return;
    }

    setSubmittingOwner(true);
    try {
      const res = await executeOwnerCapitalTransaction({
        amount: amt,
        targetAccountId: capitalTargetAccId,
        currentUserId,
        date: capitalDate,
        notes: capitalNotes
      });

      setMsg({
        type: 'success',
        text: `মালিকের মূলধন ৳${amt.toLocaleString()} সফলভাবে জমা ও জাবেদায় পোস্ট করা হয়েছে (ভাউচার: ${res.voucherNumber})!`
      });
      setShowAddCapitalModal(false);
      setCapitalAmount('');
      setCapitalTargetAccId('');
      setCapitalNotes('');
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `মূলধন জমা ব্যর্থ হয়েছে: ${err.message}` });
    } finally {
      setSubmittingOwner(false);
    }
  };

  // EXECUTE OWNER DRAWINGS (Personal Drawings: Dr 3040, Cr Cash/Bank)
  const handleExecuteDrawing = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(drawingAmount) || 0;
    if (amt <= 0) {
      setMsg({ type: 'error', text: 'উত্তোলনের পরিমাণ ০ থেকে বেশি হতে হবে।' });
      return;
    }
    if (!drawingSourceAccId) {
      setMsg({ type: 'error', text: 'উত্তোলনের জন্য ক্যাশ বা ব্যাংক হিসাব নির্বাচন করুন।' });
      return;
    }

    setSubmittingOwner(true);
    try {
      const res = await executeOwnerDrawingTransaction({
        amount: amt,
        sourceAccountId: drawingSourceAccId,
        currentUserId,
        date: drawingDate,
        notes: drawingNotes
      });

      setMsg({
        type: 'success',
        text: `মালিকের ব্যক্তিগত উত্তোলন ৳${amt.toLocaleString()} সফলভাবে সম্পন্ন ও জাবেদায় পোস্ট করা হয়েছে (ভাউচার: ${res.voucherNumber})!`
      });
      setShowDrawingModal(false);
      setDrawingAmount('');
      setDrawingSourceAccId('');
      setDrawingNotes('');
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadFinanceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `উত্তোলন ব্যর্থ হয়েছে: ${err.message}` });
    } finally {
      setSubmittingOwner(false);
    }
  };

  const ownerTotalCapital = ownerEntries.reduce((sum, j) => {
    const line3010 = j.lines?.find((l) => l.accountCode === '3010');
    return sum + (line3010?.credit || 0);
  }, 0);

  const ownerTotalDrawings = ownerEntries.reduce((sum, j) => {
    const line3040 = j.lines?.find((l) => l.accountCode === '3040');
    return sum + (line3040?.debit || 0);
  }, 0);

  const ownerNetEquity = Math.round((ownerTotalCapital - ownerTotalDrawings) * 100) / 100;

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

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
          alt="Banking & Capital illustration"
          loading="lazy"
          className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
        />
      </div>

      {/* Module Title */}
      <div className="flex flex-col gap-3.5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#1E5128]" />
              <span>ব্যাংকিং, তহবিল স্থানান্তর, ঋণ ও মূলধন (Banking & Capital)</span>
            </h2>
            <p className="text-[14px] text-gray-600 mt-0.5">
              নগদ ও ব্যাংক তহবিল (1010/1030), কন্ট্রা জাবেদা, ব্যাংক ঋণ (2110/2120), বিনিয়োগকারী (3020) ও মালিকের মূলধন/উত্তোলন (3010/3040)
            </p>
          </div>

          <div className="w-full sm:w-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-1.5 rounded-xl text-[13px] font-semibold">
          <button
            type="button"
            onClick={() => setTab('accounts')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'accounts'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span>তহবিল ও ব্যাংক</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('transfers')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'transfers'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowRightLeft className="w-4 h-4 shrink-0" />
            <span>কন্ট্রা স্থানান্তর</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('loans')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'loans'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <CreditCard className="w-4 h-4 shrink-0" />
            <span>ব্যাংক ঋণ</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('investors')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'investors'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>বিনিয়োগকারী</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('owner')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'owner'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <UserCheck className="w-4 h-4 shrink-0" />
            <span>মালিকের লেনদেন</span>
          </button>
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

      {/* ===================== TAB 1: CASH & BANK ACCOUNTS ===================== */}
      {tab === 'accounts' && (
        selectedReconcileAccount ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-5">
            {/* Top Navigation & Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  id="btn-back-to-accounts"
                  onClick={() => setSelectedReconcileAccount(null)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>সকল অ্যাকাউন্টে ফিরুন</span>
                </button>
                <div>
                  <h3 className="text-[17px] font-bold text-gray-900 flex items-center gap-2">
                    {selectedReconcileAccount.accountType === 'CASH' ? (
                      <Wallet className="w-5 h-5 text-[#1E5128]" />
                    ) : (
                      <Landmark className="w-5 h-5 text-[#1E5128]" />
                    )}
                    <span>হিসাব মিলকরণ (Reconcile): {selectedReconcileAccount.name}</span>
                  </h3>
                  <p className="text-[12px] text-gray-500 mt-0.5">
                    {selectedReconcileAccount.bankName ? `${selectedReconcileAccount.bankName} (হিসাব: ${selectedReconcileAccount.accountNumber || 'N/A'})` : 'ক্যাশ ড্রয়ার / নগদ তহবিল'} | কোড: {selectedReconcileAccount.accountType === 'CASH' ? '1010' : '1030'}
                  </p>
                </div>
              </div>

              {/* Account Switcher */}
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-500 whitespace-nowrap">হিসাব পরিবর্তন:</label>
                <select
                  value={selectedReconcileAccount.id}
                  onChange={(e) => {
                    const acc = accounts.find((a) => a.id === e.target.value);
                    if (acc) handleOpenReconciliation(acc);
                  }}
                  className="bg-white border border-gray-300 rounded-lg py-1.5 px-2.5 text-xs font-medium text-gray-800 focus:outline-none focus:border-emerald-600"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({fmt(a.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* THREE FIGURES (Requirement 2) */}
            {(() => {
              const metrics = calculateBankReconciliationMetrics(
                selectedReconcileAccount,
                reconcileTransactions,
                statementBalanceInput,
                clearedTxIds
              );

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {/* Figure 1: Book Balance (from existing app data) */}
                    <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 shadow-2xs">
                      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1">
                        <span>১. খাতাপত্রের স্থিতি (Book Balance)</span>
                        <span className="font-mono text-[11px] bg-gray-200/80 text-gray-700 px-1.5 py-0.5 rounded">সফটওয়্যার</span>
                      </div>
                      <div className="text-2xl font-bold font-mono text-gray-900">
                        {fmt(metrics.bookBalance)}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        বিদ্যমান অ্যাপ লেজারের হিসাবকৃত মোট ব্যালেন্স
                      </p>
                    </div>

                    {/* Figure 2: Manually-entered Statement Balance */}
                    <div className="p-4 rounded-xl bg-emerald-50/50 border-2 border-emerald-200 shadow-2xs">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-800 mb-1">
                        <span>২. ব্যাংক স্টেটমেন্ট স্থিতি (Statement Balance)</span>
                        <span className="font-mono text-[11px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">ম্যানুয়াল এন্ট্রি</span>
                      </div>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-700 font-mono font-bold text-base">৳</span>
                        <input
                          type="number"
                          step="0.01"
                          id="input-statement-balance"
                          value={statementBalanceInput}
                          onChange={(e) => handleStatementBalanceChange(e.target.value)}
                          placeholder="পাসবইয়ের স্থিতি লিখুন"
                          className="w-full pl-8 pr-3 py-1.5 bg-white border border-emerald-400 focus:border-emerald-600 rounded-lg text-lg font-bold font-mono text-gray-900 focus:outline-none"
                        />
                      </div>
                      <p className="text-[11px] text-emerald-700 mt-1">
                        পাসবই / অনলাইন স্টেটমেন্ট থেকে টাইপ করুন (স্বয়ংক্রিয়ভাবে সংরক্ষিত)
                      </p>
                    </div>

                    {/* Figure 3: Difference between Book and Statement Balance */}
                    <div className={`p-4 rounded-xl border shadow-2xs ${
                      metrics.hasStatementEntered
                        ? metrics.isBalanced
                          ? 'bg-emerald-50/60 border-emerald-300'
                          : 'bg-rose-50/60 border-rose-300'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center justify-between text-xs font-semibold mb-1">
                        <span className={metrics.hasStatementEntered ? (metrics.isBalanced ? 'text-emerald-800' : 'text-rose-800') : 'text-gray-500'}>
                          ৩. পার্থক্য (Difference)
                        </span>
                        {metrics.hasStatementEntered && (
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                            metrics.isBalanced
                              ? 'bg-emerald-200/80 text-emerald-900 border border-emerald-300'
                              : 'bg-rose-200/80 text-rose-900 border border-rose-300'
                          }`}>
                            {metrics.isBalanced ? '✓ সম্পূর্ণ মিলেছে' : '⚠ অমিল'}
                          </span>
                        )}
                      </div>
                      <div className={`text-2xl font-bold font-mono ${
                        metrics.hasStatementEntered
                          ? metrics.isBalanced
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                          : 'text-gray-400'
                      }`}>
                        {metrics.hasStatementEntered
                          ? `${metrics.difference >= 0 ? '+' : ''}${fmt(metrics.difference)}`
                          : '—'}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {metrics.hasStatementEntered
                          ? metrics.isBalanced
                            ? 'স্টেটমেন্ট ও বইয়ের স্থিতির মাঝে কোনো অমিল নেই'
                            : `স্টেটমেন্ট স্থিতি - বই স্থিতি = ${fmt(metrics.difference)}`
                          : 'পার্থক্য দেখতে স্টেটমেন্ট স্থিতি টাইপ করুন'}
                      </p>
                    </div>
                  </div>

                  {/* Summary bar & batch selection */}
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 font-medium text-gray-700">
                        <span className="font-semibold">মোট লেনদেন:</span>
                        <span className="font-mono bg-white px-2 py-0.5 rounded border border-gray-200 font-bold">{reconcileTransactions.length} টি</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium text-emerald-800">
                        <span className="font-semibold">মিলিত (Cleared):</span>
                        <span className="font-mono bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300 font-bold">{metrics.clearedCount} টি ({fmt(metrics.clearedNet)})</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-medium text-amber-800">
                        <span className="font-semibold">অমিলিত (Uncleared):</span>
                        <span className="font-mono bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300 font-bold">{metrics.unclearedCount} টি ({fmt(metrics.unclearedNet)})</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-mark-all-cleared"
                        onClick={() => handleMarkAllCleared(true)}
                        className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
                      >
                        সবগুলো চিহ্নিত করুন
                      </button>
                      <button
                        type="button"
                        id="btn-unmark-all-cleared"
                        onClick={() => handleMarkAllCleared(false)}
                        className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
                      >
                        সব টিক মুছুন
                      </button>
                    </div>
                  </div>

                  {/* Search & Filter Controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        id="btn-filter-all"
                        onClick={() => setReconcileFilter('ALL')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                          reconcileFilter === 'ALL'
                            ? 'bg-[#1E5128] text-white shadow-2xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        সব লেনদেন ({reconcileTransactions.length})
                      </button>
                      <button
                        type="button"
                        id="btn-filter-cleared"
                        onClick={() => setReconcileFilter('CLEARED')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                          reconcileFilter === 'CLEARED'
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        মিলিত ({metrics.clearedCount})
                      </button>
                      <button
                        type="button"
                        id="btn-filter-uncleared"
                        onClick={() => setReconcileFilter('UNCLEARED')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                          reconcileFilter === 'UNCLEARED'
                            ? 'bg-amber-700 text-white shadow-2xs'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        অমিলিত ({metrics.unclearedCount})
                      </button>
                    </div>

                    <div className="relative w-full sm:w-72">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        id="input-reconcile-search"
                        value={reconcileSearch}
                        onChange={(e) => setReconcileSearch(e.target.value)}
                        placeholder="ভাউচার, তারিখ বা বিবরণ খুঁজুন..."
                        className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 focus:bg-white focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                  </div>

                  {/* Transaction Table (Requirement 1) */}
                  {reconcileLoading ? (
                    <div className="py-12 text-center text-sm text-gray-500">
                      লেনদেন লোড হচ্ছে...
                    </div>
                  ) : (() => {
                    const q = reconcileSearch.toLowerCase().trim();
                    const filtered = reconcileTransactions.filter((tx) => {
                      if (reconcileFilter === 'CLEARED' && !clearedTxIds.has(tx.id)) return false;
                      if (reconcileFilter === 'UNCLEARED' && clearedTxIds.has(tx.id)) return false;
                      if (!q) return true;
                      return (
                        (tx.voucherNumber && tx.voucherNumber.toLowerCase().includes(q)) ||
                        (tx.narration && tx.narration.toLowerCase().includes(q)) ||
                        (tx.memo && tx.memo.toLowerCase().includes(q)) ||
                        (tx.date && tx.date.includes(q)) ||
                        (tx.amount && tx.amount.toString().includes(q))
                      );
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className="p-8 text-center text-gray-500 bg-gray-50 rounded-xl border border-gray-200 text-xs">
                          {reconcileTransactions.length === 0
                            ? 'এই অ্যাকাউন্টের জন্য কোনো লেনদেন পাওয়া যায়নি।'
                            : 'অনুসন্ধানের সাথে মিলে এমন কোনো লেনদেন নেই।'}
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* Mobile Bank Transactions Card View (Optimized for iPhone 13 mini) */}
                        <div className="md:hidden space-y-2.5">
                          {filtered.map((tx) => {
                            const isCleared = clearedTxIds.has(tx.id);
                            return (
                              <div
                                key={`mob-tx-${tx.id}`}
                                className={`p-3.5 rounded-xl border transition-colors shadow-2xs space-y-2 ${
                                  isCleared ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-gray-200'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <label className="inline-flex items-center gap-2 cursor-pointer select-none min-h-[36px]">
                                    <input
                                      type="checkbox"
                                      id={`mob-checkbox-cleared-${tx.id}`}
                                      checked={isCleared}
                                      onChange={() => handleToggleCleared(tx.id)}
                                      className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300 cursor-pointer"
                                    />
                                    <span className={`text-xs font-bold ${isCleared ? 'text-emerald-800' : 'text-gray-600'}`}>
                                      {isCleared ? '✓ স্টেটমেন্টে মিলিত' : 'অমিলিত'}
                                    </span>
                                  </label>

                                  <div className="text-right">
                                    <span className="bg-gray-100 text-gray-800 font-mono px-2 py-0.5 rounded text-xs font-semibold">
                                      {tx.voucherNumber || tx.journalEntryId}
                                    </span>
                                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">{tx.date}</div>
                                  </div>
                                </div>

                                <div className="text-xs text-gray-800 leading-snug">
                                  {tx.narration || tx.memo || 'কোনো বিবরণ নেই'}
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-xs font-mono">
                                  <div>
                                    <span className="font-sans text-gray-500 block text-[10px]">লেনদেন পরিমাণ:</span>
                                    {tx.debit > 0 ? (
                                      <span className="font-bold text-emerald-700 text-sm">+ ৳{fmt(tx.debit)} (জমা)</span>
                                    ) : (
                                      <span className="font-bold text-rose-700 text-sm">- ৳{fmt(tx.credit)} (উত্তোলন)</span>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <span className="font-sans text-gray-500 block text-[10px]">রানিং ব্যালেন্স:</span>
                                    <span className="font-bold text-gray-900 text-sm">৳{fmt(tx.runningBalance ?? 0)}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-xl">
                          <table className="w-full min-w-[550px] text-left text-xs">
                          <thead className="bg-[#F8FAFC] text-gray-700 font-semibold border-b border-gray-200 select-none">
                            <tr>
                              <th className="py-2.5 px-3 w-36 text-center">মিলিত (Cleared)</th>
                              <th className="py-2.5 px-3">তারিখ</th>
                              <th className="py-2.5 px-3">ভাউচার নম্বর</th>
                              <th className="py-2.5 px-3">বিবরণ / নোট</th>
                              <th className="py-2.5 px-3 text-right">জমা (Deposit / Dr)</th>
                              <th className="py-2.5 px-3 text-right">উত্তোলন (Withdrawal / Cr)</th>
                              <th className="py-2.5 px-3 text-right">রানিং ব্যালেন্স</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filtered.map((tx) => {
                              const isCleared = clearedTxIds.has(tx.id);
                              return (
                                <tr
                                  key={tx.id}
                                  className={`transition-colors ${
                                    isCleared ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-gray-50/80'
                                  }`}
                                >
                                  {/* Requirement 1: "মিলিত (Cleared)" checkbox per transaction, persisted */}
                                  <td className="py-2 px-3 text-center">
                                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                                      <input
                                        type="checkbox"
                                        id={`checkbox-cleared-${tx.id}`}
                                        checked={isCleared}
                                        onChange={() => handleToggleCleared(tx.id)}
                                        className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300 cursor-pointer"
                                      />
                                      <span className={`text-[11px] font-semibold ${isCleared ? 'text-emerald-800' : 'text-gray-500'}`}>
                                        মিলিত
                                      </span>
                                    </label>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-gray-700 whitespace-nowrap">
                                    {tx.date}
                                  </td>
                                  <td className="py-2 px-3 font-mono font-medium text-gray-900 whitespace-nowrap">
                                    <span className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-[11px]">
                                      {tx.voucherNumber || tx.journalEntryId}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-gray-800 max-w-xs truncate" title={tx.narration || tx.memo || ''}>
                                    {tx.narration || tx.memo || '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700 whitespace-nowrap">
                                    {tx.debit > 0 ? fmt(tx.debit) : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-semibold text-rose-700 whitespace-nowrap">
                                    {tx.credit > 0 ? fmt(tx.credit) : '—'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-gray-900 whitespace-nowrap">
                                    {fmt(tx.runningBalance ?? 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      </>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-[#1E5128]" />
                  <span>নগদ ড্রয়ার ও ব্যাংক অ্যাকাউন্টসমূহ ({accounts.length})</span>
                </h3>
                <p className="text-[13px] text-gray-600 mt-0.5">খামারের নগদ টাকা ও বিভিন্ন ব্যাংকের চলতি/সঞ্চয়ী হিসাব</p>
              </div>

              <div className="flex items-center gap-2">
                {accounts.length > 0 && (
                  <button
                    type="button"
                    id="btn-open-reconciliation-first"
                    onClick={() => handleOpenReconciliation(accounts[0])}
                    className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>মিলকরণ (Reconcile)</span>
                  </button>
                )}
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
            </div>

            {showAddAccount && (
              <form onSubmit={handleAddAccount} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3.5">
                <div className="font-bold text-[#1E5128] text-[15px]">নতুন ব্যাংক/তহবিল হিসাব যোগ করুন</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">হিসাবের নাম *</label>
                    <input
                      type="text"
                      required
                      placeholder="যেমন: ইসলামী ব্যাংক চলতি হিসাব"
                      value={accName}
                      onChange={(e) => setAccName(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">হিসাবের ধরন *</label>
                    <select
                      value={accType}
                      onChange={(e) => setAccType(e.target.value as any)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                    >
                      <option value="BANK">ব্যাংক হিসাব (Bank - 1030)</option>
                      <option value="MOBILE_BANKING">মোবাইল ব্যাংকিং (bKash/Nagad - 1030)</option>
                      <option value="CASH">নগদ তহবিল (Petty Cash - 1020)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">হিসাব নম্বর</label>
                    <input
                      type="text"
                      placeholder="A/C Number"
                      value={accNumber}
                      onChange={(e) => setAccNumber(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                    />
                  </div>
                </div>

                {accType === 'BANK' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ব্যাংকের নাম</label>
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">শাখা (Branch)</label>
                      <input
                        type="text"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="শাখার নাম"
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAccount(false)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                  >
                    বাতিল
                  </button>
                  <button
                    type="submit"
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm hover:bg-[#173F1F] transition-colors"
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
                  className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2.5 rounded-xl bg-white border border-gray-200 text-[#1E5128] shadow-xs">
                        {a.accountType === 'CASH' ? <Wallet className="w-5 h-5" /> : <Landmark className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <h4 className="font-bold text-gray-900 text-[15px] leading-tight">{a.name}</h4>
                          <span className="text-xs text-gray-400 font-mono font-normal">
                            ({a.accountType === 'CASH' ? '1010' : '1030'})
                          </span>
                        </div>
                        <p className="text-[12px] text-gray-500 mt-0.5">
                          {a.bankName ? `${a.bankName} (${a.accountNumber || 'N/A'})` : (a.accountType === 'CASH' ? 'নগদ ক্যাশ তহবিল' : 'ব্যাংক হিসাব')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-gray-200 flex items-center justify-between font-mono">
                    <span className="text-gray-600 text-[13px]">বর্তমান স্থিতি:</span>
                    <span className={`text-[17px] font-bold ${a.currentBalance < 0 ? 'text-red-600' : 'text-[#15803D]'}`}>
                      {fmt(a.currentBalance)}
                    </span>
                  </div>

                  {/* Requirement 1: Reconcile action button for each account */}
                  <div className="pt-1 border-t border-gray-100">
                    <button
                      type="button"
                      id={`btn-reconcile-${a.id}`}
                      onClick={() => handleOpenReconciliation(a)}
                      className="w-full py-1.5 px-3 bg-white hover:bg-emerald-50 text-emerald-800 hover:text-emerald-950 border border-emerald-300 hover:border-emerald-500 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer min-h-[36px]"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>মিলকরণ (Reconcile)</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
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
            <form onSubmit={handleExecuteTransfer} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3.5">
              <div className="font-bold text-[#1E5128] text-[15px]">কন্ট্রা ভাউচার তৈরি করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">উৎস হিসাব (টাকা যাবে) *</label>
                  <select
                    value={fromAccId}
                    onChange={(e) => setFromAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="">-- যে হিসাব থেকে টাকা বের হবে --</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.accountType === 'CASH' ? '1010' : '1030'}) - স্থিতি: {fmt(a.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">গন্তব্য হিসাব (টাকা জমা হবে) *</label>
                  <select
                    value={toAccId}
                    onChange={(e) => setToAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="">-- যে হিসাবে টাকা জমা হবে --</option>
                    {accounts.filter((a) => a.id !== fromAccId).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.accountType === 'CASH' ? '1010' : '1030'}) - স্থিতি: {fmt(a.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">স্থানান্তরের পরিমাণ (৳) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                    placeholder="টাকার অংক"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিবরণ / নোট</label>
                  <input
                    type="text"
                    placeholder="যেমন: খামার খরচের জন্য ব্যাংক হতে নগদ উত্তোলন"
                    value={transferNarration}
                    onChange={(e) => setTransferNarration(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTransfer(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm hover:bg-[#173F1F] transition-colors"
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
            <form onSubmit={handleCreateLoan} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3.5">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন ঋণ গ্রহণ ও হিসাবভুক্তকরণ</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ঋণের উৎস/প্রকার (Type) *</label>
                  <select
                    id="loanTypeSelect"
                    value={loanType}
                    onChange={(e) => setLoanType(e.target.value as 'BANK' | 'NGO' | 'INDIVIDUAL')}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="BANK">বাণিজ্যিক/কৃষি ব্যাংক (Bank)</option>
                    <option value="NGO">এনজিও/সমিতি ঋণ (NGO)</option>
                    <option value="INDIVIDUAL">ব্যক্তিগত/মহাজন ঋণ (Individual)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ঋণদাতা ব্যাংক/মহাজন *</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: বাংলাদেশ কৃষি ব্যাংক"
                    value={loanLenderName}
                    onChange={(e) => setLoanLenderName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ঋণের মেয়াদকাল *</label>
                  <select
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="SHORT_TERM">স্বল্পমেয়াদী ঋণ (১২ মাসের নিচে - 2110)</option>
                    <option value="LONG_TERM">দীর্ঘমেয়াদী ঋণ (১২ মাসের উপরে - 2120)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    টাকা জমার হিসাব (Target Account) <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={loanDestinationAcc}
                    onChange={(e) => setLoanDestinationAcc(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="">হিসাব নির্বাচন করুন...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountName || acc.name || acc.accountNumber} ({acc.accountType === 'BANK' ? 'ব্যাংক' : 'নগদ'}) — স্থিতি: ৳{(acc.currentBalance || 0).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মূল ঋণের পরিমাণ ৳ (Principal) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    required
                    placeholder="টাকা"
                    value={loanPrincipal}
                    onChange={(e) => setLoanPrincipal(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    বার্ষিক সুদের হার % *
                  </label>
                  <input
                    id="annualInterestRatePercent"
                    name="annualInterestRatePercent"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    required
                    value={annualInterestRatePercent}
                    onChange={(e) => setAnnualInterestRatePercent(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    ঋণের মেয়াদ মাস *
                  </label>
                  <input
                    id="termMonths"
                    name="termMonths"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    required
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">শুরুর/বিতরণ তারিখ *</label>
                  <input
                    type="date"
                    required
                    value={loanStartDate}
                    onChange={(e) => setLoanStartDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
              </div>

              {Number(loanPrincipal) > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[13px] text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
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

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewLoan(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm hover:bg-[#173F1F] transition-colors"
                >
                  ঋণ নিশ্চিত ও পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          {/* Mobile Loans Card View (Optimized for iPhone 13 mini) */}
          <div className="md:hidden space-y-3">
            {loans.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                বর্তমানে কোনো সক্রিয় ব্যাংক বা মহাজনি ঋণ নেই।
              </div>
            ) : (
              loans.map((l) => {
                const paidCount = l.schedule ? l.schedule.filter((s) => s.isPaid).length : 0;
                const totalCount = l.schedule?.length || l.termMonths || l.tenureMonths || 12;

                return (
                  <div
                    key={`mob-loan-${l.id}`}
                    className="p-4 rounded-2xl border border-gray-200 bg-white shadow-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-[#1E5128] font-mono text-base">{l.loanNumber || l.id}</div>
                        <div className="font-bold text-gray-900 text-sm mt-0.5">{l.lenderName}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                          {l.term === 'SHORT_TERM' ? 'স্বল্পমেয়াদী' : 'দীর্ঘমেয়াদী'}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            l.status === 'PAID_OFF'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}
                        >
                          {l.status === 'PAID_OFF' ? 'পরিশোধিত' : 'চলমান'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 py-2 border-y border-gray-100 text-xs font-mono">
                      <div>
                        <span className="font-sans text-gray-500 block text-[11px]">মূল ঋণ (Principal):</span>
                        <span className="font-bold text-gray-900 text-sm">৳{fmt(l.principalAmount)}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-sans text-gray-500 block text-[11px]">বকেয়া স্থিতি:</span>
                        <span className="font-bold text-amber-700 text-sm">
                          ৳{fmt(l.remainingBalance ?? l.remainingPrincipal ?? 0)}
                        </span>
                      </div>
                      <div>
                        <span className="font-sans text-gray-500 block text-[11px]">সুদের হার:</span>
                        <span className="text-gray-700">{l.annualInterestRatePercent ?? l.interestRate ?? 0}% বার্ষিক</span>
                      </div>
                      <div className="text-right">
                        <span className="font-sans text-gray-500 block text-[11px]">মেয়াদকাল:</span>
                        <span className="text-gray-700">{l.termMonths ?? l.tenureMonths ?? 12} মাস</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setSelectedLoan(l)}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Eye className="w-4 h-4" />
                        <span>কিস্তির সূচি ({paidCount}/{totalCount})</span>
                      </button>
                      {role === 'OWNER' && l.status !== 'PAID_OFF' && (
                        <button
                          type="button"
                          onClick={() => handleOpenRepaymentModal(l)}
                          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>পরিশোধ</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Full Table View */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[680px] text-left text-[14px] text-gray-800">
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
                <span>অংশীদারী বিনিয়োগকারী ও মূলধন হিসাব ({investors.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                স্লিপিং/ক্যাপিটাল পার্টনারশিপ • নিট মুনাফা বণ্টন • মূলধন জমা: Dr 1010/1030 | Cr 3020 Investor Capital
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
              <div className="font-bold text-[#1E5128] text-[15px] flex items-center justify-between">
                <span>নতুন অংশীদারী বিনিয়োগকারীর মূলধন এন্ট্রি (Investor Capital)</span>
                <span className="text-xs text-gray-500 font-normal">স্লিপিং/ক্যাপিটাল পার্টনারশিপ মডেল</span>
              </div>

              {/* Policy Note */}
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-950 space-y-1">
                <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  অংশীদারিত্ব ও হিসাবরক্ষণ নীতিমালা (Non-Interest Profit Sharing):
                </div>
                <div className="text-[12px] text-emerald-800 space-y-0.5 leading-relaxed">
                  <div>• বিনিয়োগকারী হলেন <strong>স্লিপিং পার্টনার (Capital Partner)</strong>; ফার্মের স্বত্বাধিকারী/ইউজার হলেন <strong>ওয়ার্কিং পার্টনার (Working Partner)</strong>।</div>
                  <div>• কোনো নির্দিষ্ট সুদ (Interest) বা গ্যারান্টিড রিটার্ন প্রযোজ্য নয়। বিনিয়োগকারী শুধুমাত্র ফার্মের অর্জিত প্রকৃত নিট মুনাফার চুক্তিভিত্তিক অংশ পাবেন।</div>
                  <div>• বিনিয়োগকৃত মূলধন কোনো বিক্রয় বা রাজস্ব (Revenue) নয়। জাবেদা দাখিলা: <strong>Dr ১০১০/১০৩০ নগদ বা ব্যাংক</strong> | <strong>Cr ৩০২০ বিনিয়োগকারীর মূলধন</strong>।</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিনিয়োগকারীর পূর্ণ নাম <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="উদাঃ মোঃ রহিম হোসেন"
                    value={investorName}
                    onChange={(e) => setInvestorName(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মোবাইল নম্বর (ঐচ্ছিক)</label>
                  <input
                    type="text"
                    inputMode="tel"
                    placeholder="01XXXXXXXXX"
                    value={investorPhone}
                    onChange={(e) => setInvestorPhone(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">জমার মাধ্যম (হিসাব) <span className="text-red-500">*</span></label>
                  <select
                    required
                    value={investorDestinationAcc}
                    onChange={(e) => setInvestorDestinationAcc(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  >
                    <option value="">হিসাব নির্বাচন করুন...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountName || acc.name || acc.accountNumber} ({acc.accountType === 'BANK' ? 'ব্যাংক' : 'নগদ'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    বিনিয়োগকৃত মূলধন ৳ (Capital Amount) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="any"
                    required
                    placeholder="যেমন: 100000"
                    value={investorAmount}
                    onChange={(e) => setInvestorAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono font-bold text-[#1E5128] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                  <span className="text-[11px] text-gray-500 mt-1 block">ইকুইটি হিসাব ৩০২০ এ ক্রেডিট হবে (Cr 3020 Investor Capital)</span>
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    প্রকৃত মুনাফায় বিনিয়োগকারীর অংশ % (Profit-Sharing Ratio) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    max="100"
                    step="0.1"
                    required
                    placeholder="যেমন: 40"
                    value={investorSharePct}
                    onChange={(e) => setInvestorSharePct(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono font-bold text-sky-700 focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20 min-h-[44px]"
                  />
                  {(() => {
                    const activeInvestors = investors.filter((i) => i.status !== 'EXITED');
                    const existingActiveRatios = activeInvestors.reduce(
                      (sum, i) => sum + (i.profitSharingRatio ?? i.profitSharePercentage ?? i.sharePercentage ?? 0),
                      0
                    );
                    const newShare = parseFloat(investorSharePct) || 0;
                    const combinedRatio = Math.round((existingActiveRatios + newShare) * 100) / 100;
                    const projectedWorkingPartnerRatio = Math.max(0, Math.round((100 - combinedRatio) * 100) / 100);
                    return (
                      <div className="text-[11px] text-gray-600 mt-1 flex justify-between bg-sky-50 px-2 py-1 rounded-md border border-sky-200">
                        <span>স্লিপিং পার্টনার: <strong>{newShare}%</strong></span>
                        <span className={`font-semibold ${combinedRatio > 100 ? 'text-rose-700' : 'text-emerald-800'}`}>
                          ওয়ার্কিং পার্টনার: {projectedWorkingPartnerRatio}% {combinedRatio > 100 ? '(মোট অনুপাত ১০০% অতিক্রম করেছে)' : ''}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewInvestor(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[44px] hover:bg-[#173F1F] shadow-sm transition-colors"
                >
                  মূলধন হিসাবভুক্ত করুন
                </button>
              </div>
            </form>
          )}

          {(() => {
            const activeInvestors = investors.filter((i) => i.status !== 'EXITED');
            const totalActiveInvestorRatio = Math.round(
              activeInvestors.reduce(
                (sum, i) => sum + (i.profitSharingRatio ?? i.profitSharePercentage ?? i.sharePercentage ?? 0),
                0
              ) * 100
            ) / 100;
            const farmWorkingPartnerRatio = Math.max(0, Math.round((100 - totalActiveInvestorRatio) * 100) / 100);

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {investors.map((inv) => {
                  const currentCap = inv.currentCapitalBalance ?? inv.capitalAmount ?? 0;
                  const ratio = inv.profitSharingRatio ?? inv.profitSharePercentage ?? inv.sharePercentage ?? 0;
                  const workingRatio = inv.status === 'EXITED' ? 0 : farmWorkingPartnerRatio;
                  const payable = inv.profitPayable || 0;

                  return (
                    <div
                      key={inv.id}
                      className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-gray-900 text-[15px]">{inv.name}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              inv.status === 'EXITED'
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}>
                              {inv.status === 'EXITED' ? 'অব্যাহতিপ্রাপ্ত' : 'সক্রিয় পার্টনার'}
                            </span>
                          </div>
                          <p className="text-[12px] text-gray-500">{inv.phone || 'ফোন নম্বর নেই'}</p>
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-mono text-xs font-semibold">
                          {ratio}% মুনাফা অংশ
                        </span>
                      </div>

                      <div className="pt-2.5 border-t border-gray-200 space-y-1.5 font-mono text-[13px]">
                        <div className="flex justify-between text-gray-700">
                          <span className="font-sans">বিনিয়োগকৃত মূলধন:</span>
                          <span className="font-bold text-[#15803D]">{fmt(inv.capitalContributed ?? inv.capitalAmount ?? 0)}</span>
                        </div>
                        <div className="flex justify-between text-gray-700">
                          <span className="font-sans">ফেরতকৃত মূলধন:</span>
                          <span className="font-semibold text-rose-700">{fmt(inv.totalCapitalReturned || 0)}</span>
                        </div>
                        <div className="flex justify-between text-gray-800">
                          <span className="font-sans font-medium">অবশিষ্ট মূলধন স্থিতি:</span>
                          <span className="font-bold text-gray-900">{fmt(currentCap)}</span>
                        </div>
                        <div className="flex justify-between text-gray-700">
                          <span className="font-sans">মুনাফা বণ্টন অনুপাত:</span>
                          <span className="font-semibold text-sky-700 font-sans text-xs">
                            বিনিয়োগকারী {ratio}% | ওয়ার্কিং পার্টনার {workingRatio}%
                          </span>
                        </div>
                    <div className="flex justify-between text-gray-700">
                      <span className="font-sans">বণ্টনকৃত মোট প্রকৃত মুনাফা:</span>
                      <span className="font-semibold text-emerald-700">{fmt(inv.totalProfitAllocated || 0)}</span>
                    </div>
                    <div className="flex justify-between text-gray-700">
                      <span className="font-sans">পরিশোধিত মোট লভ্যাংশ:</span>
                      <span className="font-semibold text-blue-700">{fmt(inv.totalProfitPaid || 0)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-900 font-bold pt-1.5 border-t border-gray-200">
                      <span className="font-sans">বর্তমান প্রদেয় লভ্যাংশ:</span>
                      <span className={`px-2 py-0.5 rounded-md font-mono ${
                        payable > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {fmt(payable)}
                      </span>
                    </div>
                  </div>

                  {role === 'OWNER' && (
                    <div className="pt-2 grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAllocatingInvestor(inv);
                          setFinalizedFarmProfit('');
                          setAllocationNotes('');
                        }}
                        className="py-1.5 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="ফার্মের প্রকৃত অর্জিত মুনাফা থেকে চুক্তি অনুযায়ী লভ্যাংশ বণ্টন"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>মুনাফা বণ্টন</span>
                      </button>
                      <button
                        type="button"
                        disabled={payable <= 0}
                        onClick={() => {
                          setPayingInvestor(inv);
                          setPaymentAmount(payable > 0 ? String(payable) : '');
                          setPaymentNotes('');
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors ${
                          payable > 0
                            ? 'bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 cursor-pointer'
                            : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                        }`}
                        title="বকেয়া প্রদেয় লভ্যাংশ নগদ বা ব্যাংক থেকে প্রদান"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>লভ্যাংশ প্রদান</span>
                      </button>
                      <button
                        type="button"
                        disabled={currentCap <= 0}
                        onClick={() => {
                          setReturningCapitalInvestor(inv);
                          setCapitalReturnAmount('');
                          setCapitalReturnNotes('');
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors ${
                          currentCap > 0
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 cursor-pointer'
                            : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                        }`}
                        title="বিনিয়োগকারীর মূলধন ফেরত / প্রত্যাহার"
                      >
                        <MinusCircle className="w-3.5 h-3.5" />
                        <span>মূলধন ফেরত</span>
                      </button>
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedInvestor(inv)}
                      className="w-full py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>অংশীদারী হিসাব ও বিবরণ দেখুন</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
            );
          })()}

          {/* Modal 1: Profit Allocation */}
          {allocatingInvestor && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-emerald-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      প্রকৃত মুনাফা বণ্টন (Profit Allocation)
                    </h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      বিনিয়োগকারী: <strong className="text-gray-900">{allocatingInvestor.name}</strong> (অনুপাত: {allocatingInvestor.profitSharingRatio ?? allocatingInvestor.profitSharePercentage ?? allocatingInvestor.sharePercentage ?? 0}%)
                    </p>
                  </div>
                  <button
                    onClick={() => setAllocatingInvestor(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-950 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5 text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ইসলামিক পার্টনারশিপ / স্লিপিং পার্টনার মডেল:
                  </p>
                  <p>• মুনাফা বণ্টন চূড়ান্ত <strong>প্রকৃত নিট মুনাফা</strong> থেকে নির্ধারিত অনুপাত অনুসারে হবে।</p>
                  <p>• বিনিয়োগকৃত মূলধন থেকে কখনো মুনাফা হিসাব হয় না এবং কোনো নির্দিষ্ট সুদ প্রযোজ্য নয়।</p>
                  <p>• এটি ফার্মের পরিচালন ব্যয় (Operating Expense) নয়; ইকুইটি মুনাফা বণ্টন ও প্রদেয় দায় (Payable)।</p>
                </div>

                <form onSubmit={handleExecuteProfitAllocation} className="space-y-3.5 text-sm">
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                      ফার্মের চূড়ান্ত বণ্টনযোগ্য প্রকৃত নিট মুনাফা (৳) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="any"
                      required
                      placeholder="উদাঃ 200000"
                      value={finalizedFarmProfit}
                      onChange={(e) => setFinalizedFarmProfit(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden font-mono text-sm sm:text-[15px] min-h-[44px]"
                    />
                  </div>

                  {Number(finalizedFarmProfit) > 0 && (() => {
                    const activeInvestors = investors.filter((i) => i.status !== 'EXITED');
                    const totalActiveRatio = Math.round(
                      activeInvestors.reduce(
                        (sum, i) => sum + (i.profitSharingRatio ?? i.profitSharePercentage ?? i.sharePercentage ?? 0),
                        0
                      ) * 100
                    ) / 100;
                    const farmWorkingRatio = Math.max(0, Math.round((100 - totalActiveRatio) * 100) / 100);
                    const invRatio = allocatingInvestor.profitSharingRatio ?? allocatingInvestor.profitSharePercentage ?? allocatingInvestor.sharePercentage ?? 0;
                    const invShare = Math.round(Number(finalizedFarmProfit) * (invRatio / 100));
                    const workingPartnerShare = Math.round(Number(finalizedFarmProfit) * (farmWorkingRatio / 100));
                    const totalActiveInvestorsShare = Math.round(Number(finalizedFarmProfit) * (totalActiveRatio / 100));

                    return (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 text-xs">
                        <div className="flex justify-between text-gray-700">
                          <span>বিনিয়োগকারী ({allocatingInvestor.name}) এর প্রাপ্য অংশ ({invRatio}%):</span>
                          <strong className="text-emerald-700 font-mono text-sm">
                            ৳{invShare.toLocaleString()}
                          </strong>
                        </div>
                        {activeInvestors.length > 1 && (
                          <div className="flex justify-between text-gray-500 text-[11px]">
                            <span>সকল সক্রিয় বিনিয়োগকারীদের মোট অংশ ({totalActiveRatio}%):</span>
                            <span className="font-mono">
                              ৳{totalActiveInvestorsShare.toLocaleString()}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between text-gray-700">
                          <span>ওয়ার্কিং পার্টনার / খামার মালিকের অংশ ({farmWorkingRatio}%):</span>
                          <span className="font-mono font-semibold text-emerald-800">
                            ৳{workingPartnerShare.toLocaleString()}
                          </span>
                        </div>
                        <div className="pt-2 border-t border-gray-200 text-gray-600 text-[11px] font-mono">
                          <div>দাখিলা: Dr ৩০৭০ মুনাফা বণ্টন / ইকুইটি ৳{invShare.toLocaleString()}</div>
                          <div>দাখিলা: Cr ২০৫০ বিনিয়োগকারীর লভ্যাংশ প্রদেয় ৳{invShare.toLocaleString()}</div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">তারিখ *</label>
                      <input
                        type="date"
                        value={allocationDate}
                        onChange={(e) => setAllocationDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মন্তব্য (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        placeholder="উদাঃ ২০২৪ সালের বার্ষিক নিট মুনাফা"
                        value={allocationNotes}
                        onChange={(e) => setAllocationNotes(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => setAllocatingInvestor(null)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 cursor-pointer min-h-[44px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingAllocation}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50 min-h-[44px] shadow-sm"
                    >
                      {submittingAllocation ? 'বণ্টন হচ্ছে...' : 'মুনাফা বণ্টন নিশ্চিত করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 2: Profit Payment */}
          {payingInvestor && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-blue-100 space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      লভ্যাংশ পরিশোধ (Profit Payment)
                    </h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      বিনিয়োগকারী: <strong className="text-gray-900">{payingInvestor.name}</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => setPayingInvestor(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-950 flex justify-between items-center">
                  <span>বর্তমান বণ্টনকৃত অপরিশোধিত লভ্যাংশ (বকেয়া):</span>
                  <span className="font-mono font-bold text-base text-amber-900">
                    ৳{(payingInvestor.profitPayable || 0).toLocaleString()}
                  </span>
                </div>

                <form onSubmit={handleExecuteProfitPayment} className="space-y-3.5 text-sm">
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                      পরিশোধের পরিমাণ (৳) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      max={payingInvestor.profitPayable || 0}
                      step="any"
                      required
                      placeholder={`সর্বোচ্চ ৳${payingInvestor.profitPayable || 0}`}
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-hidden font-mono text-sm sm:text-[15px] min-h-[44px]"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      নিয়ম: বণ্টনকৃত পাওনা লভ্যাংশের চেয়ে বেশি পরিশোধ করা সম্ভব নয় (সর্বোচ্চ: ৳{(payingInvestor.profitPayable || 0).toLocaleString()})।
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                      তহবিল প্রদানকারী অ্যাকাউন্ট (Source Account) <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={paymentSourceAccId}
                      onChange={(e) => setPaymentSourceAccId(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                    >
                      <option value="">হিসাব নির্বাচন করুন...</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name || acc.accountName || acc.accountNumber} ({acc.accountType === 'BANK' ? 'ব্যাংক' : 'ক্যাশ'}) — স্থিতি: ৳{(acc.currentBalance || 0).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পরিশোধের তারিখ *</label>
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মন্তব্য (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        placeholder="উদাঃ ব্যাংক ট্রান্সফার / চেক"
                        value={paymentNotes}
                        onChange={(e) => setPaymentNotes(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                  </div>

                  {Number(paymentAmount) > 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] font-mono text-gray-600">
                      <div>দাখিলা: Dr ২০৫০ বিনিয়োগকারীর লভ্যাংশ প্রদেয় ৳{Number(paymentAmount).toLocaleString()}</div>
                      <div>দাখিলা: Cr ১০১০/১০৩০ নগদ বা ব্যাংক তহবিল ৳{Number(paymentAmount).toLocaleString()}</div>
                    </div>
                  )}

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => setPayingInvestor(null)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 cursor-pointer min-h-[44px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingPayment}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50 min-h-[44px] shadow-sm"
                    >
                      {submittingPayment ? 'পরিশোধ হচ্ছে...' : 'পরিশোধ নিশ্চিত করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Modal 3: Capital Return (Dr 3020 Investor Capital, Cr 1010/1030 Cash/Bank) */}
          {returningCapitalInvestor && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-rose-200 space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                      মূলধন ফেরত (Investor Capital Return)
                    </h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      বিনিয়োগকারী: <strong className="text-gray-900">{returningCapitalInvestor.name}</strong> | বর্তমান মূলধন স্থিতি: <strong className="text-rose-700">৳{(returningCapitalInvestor.currentCapitalBalance ?? returningCapitalInvestor.capitalAmount ?? 0).toLocaleString()}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReturningCapitalInvestor(null)}
                    className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-900 space-y-1">
                  <div className="font-semibold text-rose-950">হিসাবরক্ষণ নীতিমালা (Capital Return Accounting):</div>
                  <div className="text-[12px] text-rose-800">
                    • মূলধন ফেরত কোনো পরিচালন ব্যয় বা ক্ষতি নয়; এটি ইকুইটি থেকে মূলধনের প্রত্যাহার।
                    <br />
                    • জাবেদা দাখিলা: <strong>Dr ৩০২০ বিনিয়োগকারীর মূলধন</strong> (ইকুইটি হ্রাস) | <strong>Cr ১০১০/১০৩০ নগদ বা ব্যাংক তহবিল</strong> (সম্পদ হ্রাস)।
                    <br />
                    • বিদ্যমান মূলধন স্থিতির অতিরিক্ত ফেরত দেওয়া যাবে না।
                  </div>
                </div>

                <form onSubmit={handleExecuteCapitalReturn} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                        ফেরতযোগ্য মূলধনের পরিমাণ ৳ <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="1"
                        max={returningCapitalInvestor.currentCapitalBalance ?? returningCapitalInvestor.capitalAmount ?? 0}
                        required
                        placeholder="৳ পরিমাণ"
                        value={capitalReturnAmount}
                        onChange={(e) => setCapitalReturnAmount(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] font-mono font-bold text-rose-700 focus:ring-2 focus:ring-rose-500 focus:border-rose-500 min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                        ফেরতের মাধ্যম (উৎস হিসাব) <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={capitalReturnSourceAccId}
                        onChange={(e) => setCapitalReturnSourceAccId(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      >
                        <option value="">হিসাব নির্বাচন করুন...</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.accountType === 'CASH' ? '1010 নগদ' : '1030 ব্যাংক'} - ব্যালেন্স: {fmt(acc.currentBalance)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ফেরতের তারিখ <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        required
                        max={new Date().toISOString().split('T')[0]}
                        value={capitalReturnDate}
                        onChange={(e) => setCapitalReturnDate(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিবরণ / নোট (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        placeholder="উদাঃ মূলধন আংশিক বা পূর্ণাঙ্গ প্রত্যাহার"
                        value={capitalReturnNotes}
                        onChange={(e) => setCapitalReturnNotes(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm sm:text-[15px] min-h-[44px]"
                      />
                    </div>
                  </div>

                  {Number(capitalReturnAmount) > 0 && (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] font-mono text-gray-700 space-y-0.5">
                      <div className="font-semibold text-gray-900 font-sans">প্রত্যাশিত জাবেদা দাখিলা (Journal Entry Preview):</div>
                      <div>দাখিলা: Dr ৩০২০ বিনিয়োগকারীর মূলধন (ইকুইটি হ্রাস) ৳{Number(capitalReturnAmount).toLocaleString()}</div>
                      <div>দাখিলা: Cr ১০১০/১০৩০ নগদ বা ব্যাংক তহবিল (সম্পদ হ্রাস) ৳{Number(capitalReturnAmount).toLocaleString()}</div>
                    </div>
                  )}

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => setReturningCapitalInvestor(null)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 cursor-pointer min-h-[44px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingCapitalReturn}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[13px] font-bold cursor-pointer disabled:opacity-50 min-h-[44px] shadow-sm"
                    >
                      {submittingCapitalReturn ? 'প্রক্রিয়াকরণ হচ্ছে...' : 'মূলধন ফেরত নিশ্চিত করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 5: OWNER TRANSACTIONS (CAPITAL & DRAWINGS) ===================== */}
      {tab === 'owner' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-5">
          {/* Header & Action Buttons */}
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-3">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-amber-600" />
                <span>মালিকের লেনদেন (Owner Transactions)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                মালিকের নিজস্ব মূলধন জমা (Cr 3010) ও ব্যক্তিগত প্রয়োজন বাবদ উত্তোলন (Dr 3040) — বহিরাগত বিনিয়োগকারী থেকে সম্পূর্ণ পৃথক
              </p>
            </div>

            {role === 'OWNER' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddCapitalModal(true);
                    setShowDrawingModal(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ মূলধন জমা (Add Capital)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDrawingModal(true);
                    setShowAddCapitalModal(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <MinusCircle className="w-4 h-4" />
                  <span>- উত্তোলন (Drawing)</span>
                </button>
              </div>
            )}
          </div>

          {/* ADD CAPITAL FORM */}
          {showAddCapitalModal && (
            <form onSubmit={handleExecuteAddCapital} className="p-4 sm:p-5 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                <div>
                  <div className="font-bold text-emerald-900 text-[15px] flex items-center gap-2">
                    <ArrowDownCircle className="w-4 h-4 text-emerald-700" />
                    <span>মালিকের মূলধন জমা (Add Owner Capital)</span>
                  </div>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    জাবেদা দাখিলা: ডেবিট নগদ/ব্যাংক (1010/1030) | ক্রেডিট মালিকের মূলধন (3010)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddCapitalModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs sm:text-[13px]">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">মূলধনের পরিমাণ ৳ *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    required
                    placeholder="যেমন: 50000"
                    value={capitalAmount}
                    onChange={(e) => setCapitalAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">জমার হিসাব (Deposit Destination) *</label>
                  <select
                    required
                    value={capitalTargetAccId}
                    onChange={(e) => setCapitalTargetAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                  >
                    <option value="">হিসাব নির্বাচন করুন...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.accountType === 'CASH' ? '1010' : '1030'} • {acc.accountType === 'BANK' ? acc.bankName || 'ব্যাংক' : 'ক্যাশ'}) - স্থিতি: {fmt(acc.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">লেনদেনের তারিখ *</label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().split('T')[0]}
                    value={capitalDate}
                    onChange={(e) => setCapitalDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিবরণ / নোট (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: খামার সম্প্রসারণ বাবদ ব্যক্তিগত তহবিল থেকে মূলধন জমা"
                  value={capitalNotes}
                  onChange={(e) => setCapitalNotes(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-emerald-100">
                <button
                  type="button"
                  onClick={() => setShowAddCapitalModal(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={submittingOwner}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-[13px] font-bold cursor-pointer shadow-sm min-h-[44px]"
                >
                  {submittingOwner ? 'সংরক্ষণ হচ্ছে...' : 'মূলধন জমা নিশ্চিত করুন'}
                </button>
              </div>
            </form>
          )}

          {/* DRAWING FORM */}
          {showDrawingModal && (
            <form onSubmit={handleExecuteDrawing} className="p-4 sm:p-5 bg-rose-50/60 border border-rose-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between border-b border-rose-100 pb-2">
                <div>
                  <div className="font-bold text-rose-900 text-[15px] flex items-center gap-2">
                    <ArrowUpCircle className="w-4 h-4 text-rose-700" />
                    <span>মালিকের ব্যক্তিগত উত্তোলন (Owner Drawings)</span>
                  </div>
                  <p className="text-xs text-rose-800 mt-0.5">
                    জাবেদা দাখিলা: ডেবিট মালিকের উত্তোলন (3040) | ক্রেডিট নগদ/ব্যাংক (1010/1030)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDrawingModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs sm:text-[13px]">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">উত্তোলনের পরিমাণ ৳ *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    required
                    placeholder="যেমন: 15000"
                    value={drawingAmount}
                    onChange={(e) => setDrawingAmount(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-600/20"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">উৎস হিসাব (Withdrawal Source) *</label>
                  <select
                    required
                    value={drawingSourceAccId}
                    onChange={(e) => setDrawingSourceAccId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-600/20"
                  >
                    <option value="">হিসাব নির্বাচন করুন...</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.accountType === 'CASH' ? '1010' : '1030'} • {acc.accountType === 'BANK' ? acc.bankName || 'ব্যাংক' : 'ক্যাশ'}) - স্থিতি: {fmt(acc.currentBalance)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">লেনদেনের তারিখ *</label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().split('T')[0]}
                    value={drawingDate}
                    onChange={(e) => setDrawingDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-600/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিবরণ / নোট (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: ব্যক্তিগত পারিবারিক খরচ বাবদ তহবিল উত্তোলন"
                  value={drawingNotes}
                  onChange={(e) => setDrawingNotes(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-rose-600 focus:ring-2 focus:ring-rose-600/20"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-rose-100">
                <button
                  type="button"
                  onClick={() => setShowDrawingModal(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={submittingOwner}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white text-[13px] font-bold cursor-pointer shadow-sm min-h-[44px]"
                >
                  {submittingOwner ? 'সংরক্ষণ হচ্ছে...' : 'উত্তোলন নিশ্চিত করুন'}
                </button>
              </div>
            </form>
          )}

          {/* Equity Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800">মোট মূলধন জমা (3010)</span>
                <ArrowDownCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono text-emerald-700">
                {fmt(ownerTotalCapital)}
              </div>
              <p className="text-[11px] text-emerald-600 mt-1">ব্যবসায়ে মালিকের নিজস্ব মূলধন</p>
            </div>

            <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-800">মোট উত্তোলন (3040)</span>
                <ArrowUpCircle className="w-4 h-4 text-rose-600" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono text-rose-700">
                {fmt(ownerTotalDrawings)}
              </div>
              <p className="text-[11px] text-rose-600 mt-1">মালিকের ব্যক্তিগত উত্তোলন (Contra-Equity)</p>
            </div>

            <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-800">নিট মালিকানা স্থিতি (Net Equity)</span>
                <UserCheck className="w-4 h-4 text-amber-600" />
              </div>
              <div className="mt-2 text-xl font-bold font-mono text-amber-900">
                {fmt(ownerNetEquity)}
              </div>
              <p className="text-[11px] text-amber-700 mt-1">মূলধন (3010) বিয়োগ উত্তোলন (3040)</p>
            </div>
          </div>

          {/* Transaction History Table */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <History className="w-4 h-4 text-gray-500" />
                <span>মালিকের লেনদেন বিবরণী ({ownerEntries.length})</span>
              </h4>
            </div>

            {ownerEntries.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500 text-xs">
                মালিকের কোনো মূলধন জমা বা উত্তোলনের রেকর্ড পাওয়া যায়নি। উপরের বাটন ব্যবহার করে নতুন লেনদেন যোগ করুন।
              </div>
            ) : (
              <>
                {/* Mobile Owner Entries Card View (Optimized for iPhone 13 mini) */}
                <div className="md:hidden space-y-2.5">
                  {ownerEntries.map((entry) => {
                    const isCapital = entry.lines?.some((l) => l.accountCode === '3010');
                    const amount = isCapital
                      ? entry.lines?.find((l) => l.accountCode === '3010')?.credit || 0
                      : entry.lines?.find((l) => l.accountCode === '3040')?.debit || 0;
                    const cashBankLine = entry.lines?.find((l) => l.accountCode === '1010' || l.accountCode === '1030');
                    const accountLabel = cashBankLine?.accountName || 'তহবিল/ব্যাংক';

                    return (
                      <div
                        key={`mob-owner-${entry.id}`}
                        className={`p-3.5 rounded-xl border shadow-2xs space-y-2 bg-white ${
                          isCapital ? 'border-emerald-200' : 'border-rose-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-mono font-bold text-gray-900 text-sm">
                              {entry.voucherNumber}
                            </span>
                            <div className="text-xs text-gray-400 font-mono mt-0.5">{entry.date}</div>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isCapital
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-rose-100 text-rose-800 border border-rose-300'
                          }`}>
                            {isCapital ? (
                              <>
                                <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600" />
                                <span>মূলধন জমা</span>
                              </>
                            ) : (
                              <>
                                <ArrowUpCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>ব্যক্তিগত উত্তোলন</span>
                              </>
                            )}
                          </span>
                        </div>

                        <div className="text-xs text-gray-700 font-medium">
                          উৎস/মাধ্যম: <span className="font-bold text-gray-900">{accountLabel}</span>
                          {cashBankLine?.accountCode && (
                            <span className="text-[11px] text-gray-400 font-mono ml-1">({cashBankLine.accountCode})</span>
                          )}
                        </div>

                        {entry.narration && (
                          <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded-lg leading-snug">
                            {entry.narration}
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-1.5 border-t border-gray-100 text-xs">
                          <span className="text-gray-500 font-sans">লেনদেন অংক:</span>
                          <span className={`font-mono font-bold text-base ${isCapital ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {isCapital ? `+ ৳${fmt(amount)}` : `- ৳${fmt(amount)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop Full Table View */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[500px] text-left text-xs text-gray-800 border-collapse">
                  <thead className="bg-[#F8FAFC] text-gray-700 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="p-2.5">তারিখ</th>
                      <th className="p-2.5">ভাউচার নং</th>
                      <th className="p-2.5 text-center">লেনদেনের ধরন</th>
                      <th className="p-2.5">তহবিল / মাধ্যম</th>
                      <th className="p-2.5 text-right">পরিমাণ (৳)</th>
                      <th className="p-2.5">বিবরণ / নোট</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ownerEntries.map((entry) => {
                      const isCapital = entry.lines?.some((l) => l.accountCode === '3010');
                      const amount = isCapital
                        ? entry.lines?.find((l) => l.accountCode === '3010')?.credit || 0
                        : entry.lines?.find((l) => l.accountCode === '3040')?.debit || 0;
                      const cashBankLine = entry.lines?.find((l) => l.accountCode === '1010' || l.accountCode === '1030');
                      const accountLabel = cashBankLine?.accountName || 'তহবিল/ব্যাংক';

                      return (
                        <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-2.5 font-mono whitespace-nowrap text-gray-700">{entry.date}</td>
                          <td className="p-2.5 font-mono font-bold text-gray-900 whitespace-nowrap">{entry.voucherNumber}</td>
                          <td className="p-2.5 text-center whitespace-nowrap">
                            {isCapital ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <ArrowDownCircle className="w-3 h-3 text-emerald-600" />
                                <span>মূলধন জমা</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                                <ArrowUpCircle className="w-3 h-3 text-rose-600" />
                                <span>ব্যক্তিগত উত্তোলন</span>
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 font-medium text-gray-800">
                            <span className="font-bold text-gray-900">{accountLabel}</span>
                            {cashBankLine?.accountCode && (
                              <span className="text-[11px] text-gray-400 font-mono ml-1.5 font-normal">({cashBankLine.accountCode})</span>
                            )}
                          </td>
                          <td className={`p-2.5 text-right font-mono font-bold whitespace-nowrap ${isCapital ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {isCapital ? `+ ${fmt(amount)}` : `- ${fmt(amount)}`}
                          </td>
                          <td className="p-2.5 text-gray-600 max-w-xs truncate" title={entry.narration}>
                            {entry.narration}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
            )}
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

              {/* Schedule Section Content */}
              <div className="overflow-y-auto flex-1 min-h-0">
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
                    <>
                      {/* Mobile Schedule Cards View (Optimized for iPhone 13 mini) */}
                      <div className="sm:hidden space-y-2.5 pr-0.5">
                        {effectiveSchedule.map((item) => (
                          <div
                            key={`mob-sched-${item.installmentNumber}`}
                            className={`p-3 rounded-xl border transition-colors shadow-2xs space-y-2 ${
                              item.isPaid ? 'bg-emerald-50/40 border-emerald-300' : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-xs bg-gray-100 text-gray-800 px-2 py-0.5 rounded">
                                  #{item.installmentNumber}
                                </span>
                                <span className="text-xs font-mono text-gray-600">{item.date}</span>
                              </div>
                              {item.isPaid ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>পরিশোধিত</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                  <Clock className="w-3 h-3 text-amber-600" />
                                  <span>বকেয়া</span>
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-gray-100 text-xs font-mono">
                              <div>
                                <span className="font-sans text-gray-500 block text-[10px]">আসল (Principal):</span>
                                <span className="font-semibold text-gray-900">৳{fmt(item.principalPortion)}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-sans text-gray-500 block text-[10px]">সুদ (Interest):</span>
                                <span className="font-semibold text-amber-700">৳{fmt(item.interestPortion)}</span>
                              </div>
                              <div>
                                <span className="font-sans text-gray-500 block text-[10px]">মোট কিস্তি (EMI):</span>
                                <span className="font-bold text-[#1E5128] text-sm">৳{fmt(item.totalPayment)}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-sans text-gray-500 block text-[10px]">অবশিষ্ট ঋণ:</span>
                                <span className="font-semibold text-gray-600">৳{fmt(item.remainingBalance)}</span>
                              </div>
                            </div>

                            {role === 'OWNER' && !item.isPaid && (
                              <button
                                type="button"
                                onClick={() => handleOpenRepaymentModal(selectedLoan, item)}
                                className="w-full py-2 px-3 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold transition-all cursor-pointer min-h-[38px] flex items-center justify-center gap-1 shadow-2xs mt-1"
                              >
                                <CreditCard className="w-3.5 h-3.5" />
                                <span>এই কিস্তিটি পরিশোধ করুন (৳{fmt(item.totalPayment)})</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Desktop Schedule Table */}
                      <div className="hidden sm:block overflow-x-auto overflow-y-auto flex-1 rounded-xl border border-gray-200">
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
                      </div>
                    </>
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

      {/* ===================== INVESTOR DETAIL & EQUITY SUMMARY MODAL ===================== */}
      {selectedInvestor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 space-y-4 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">{selectedInvestor.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    selectedInvestor.status === 'EXITED'
                      ? 'bg-gray-200 text-gray-700'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}>
                    {selectedInvestor.status === 'EXITED' ? 'অব্যাহতিপ্রাপ্ত' : 'সক্রিয় পার্টনার'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  যোগদানের তারিখ: {selectedInvestor.joinedDate || selectedInvestor.entryDate || 'প্রযোজ্য নয়'} | ফোন: {selectedInvestor.phone || 'নেই'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvestor(null)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-3.5 pr-1 text-xs">
              {/* Partnership Model Box */}
              {(() => {
                const activeInvestors = investors.filter((i) => i.status !== 'EXITED');
                const totalActiveRatio = Math.round(
                  activeInvestors.reduce(
                    (sum, i) => sum + (i.profitSharingRatio ?? i.profitSharePercentage ?? i.sharePercentage ?? 0),
                    0
                  ) * 100
                ) / 100;
                const farmWorkingRatio = Math.max(0, Math.round((100 - totalActiveRatio) * 100) / 100);
                const invRatio = selectedInvestor.profitSharingRatio ?? selectedInvestor.profitSharePercentage ?? selectedInvestor.sharePercentage ?? 0;

                return (
                  <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 text-emerald-950 space-y-1.5">
                    <div className="font-bold text-emerald-900 text-sm flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      অংশীদারিত্বের কাঠামো ও মুনাফা বণ্টন নীতি:
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                        <span className="font-sans text-gray-600 block text-[11px]">স্লিপিং পার্টনার (বিনিয়োগকারী):</span>
                        <strong className="text-sky-700 text-sm">{invRatio}%</strong>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                        <span className="font-sans text-gray-600 block text-[11px]">ওয়ার্কিং পার্টনার (খামার মালিক):</span>
                        <strong className="text-emerald-800 text-sm">
                          {selectedInvestor.status === 'EXITED' ? 0 : farmWorkingRatio}%
                        </strong>
                      </div>
                      {activeInvestors.length > 1 && (
                        <div className="col-span-2 bg-white/80 p-2 rounded-lg border border-emerald-200 flex justify-between">
                          <span className="font-sans text-gray-600 text-[11px]">সকল সক্রিয় বিনিয়োগকারীদের মোট অনুপাত:</span>
                          <strong className="text-emerald-900 text-xs font-mono">{totalActiveRatio}%</strong>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-emerald-800 pt-1">
                      • কোনো নির্দিষ্ট সুদ বা ঋণের কিস্তি নেই। শুধুমাত্র খামারের অর্জিত প্রকৃত নিট বণ্টনযোগ্য মুনাফা থেকে চুক্তি অনুযায়ী লভ্যাংশ বণ্টন হবে।
                    </p>
                  </div>
                );
              })()}

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <span className="text-[11px] text-gray-500 block">মোট মূলধন জমা</span>
                  <strong className="text-sm font-mono text-[#1E5128]">{fmt(selectedInvestor.capitalContributed ?? selectedInvestor.capitalAmount ?? 0)}</strong>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <span className="text-[11px] text-gray-500 block">ফেরতকৃত মূলধন</span>
                  <strong className="text-sm font-mono text-rose-700">{fmt(selectedInvestor.totalCapitalReturned || 0)}</strong>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <span className="text-[11px] text-gray-500 block">অবশিষ্ট মূলধন স্থিতি</span>
                  <strong className="text-sm font-mono text-gray-900">{fmt(selectedInvestor.currentCapitalBalance ?? selectedInvestor.capitalAmount ?? 0)}</strong>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
                  <span className="text-[11px] text-gray-500 block">বর্তমান প্রদেয় লভ্যাংশ</span>
                  <strong className={`text-sm font-mono ${(selectedInvestor.profitPayable || 0) > 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                    {fmt(selectedInvestor.profitPayable || 0)}
                  </strong>
                </div>
              </div>

              {/* Profit Accounting Summary */}
              <div className="bg-white border border-gray-200 rounded-xl p-3.5 space-y-2 font-mono">
                <div className="font-bold text-gray-900 font-sans text-xs flex items-center justify-between border-b pb-1.5">
                  <span>প্রকৃত মুনাফা বণ্টন ও পরিশোধ স্থিতি</span>
                  <span className="text-gray-500 text-[11px]">লেজার ২০৫০ ও ৩০৭০</span>
                </div>
                <div className="flex justify-between text-gray-700 text-xs">
                  <span className="font-sans">বণ্টনকৃত মোট প্রকৃত মুনাফা (Dr 3070, Cr 2050):</span>
                  <span className="font-bold text-emerald-700">{fmt(selectedInvestor.totalProfitAllocated || 0)}</span>
                </div>
                <div className="flex justify-between text-gray-700 text-xs">
                  <span className="font-sans">পরিশোধিত মোট লভ্যাংশ (Dr 2050, Cr 1010/1030):</span>
                  <span className="font-bold text-blue-700">{fmt(selectedInvestor.totalProfitPaid || 0)}</span>
                </div>
                <div className="flex justify-between text-gray-900 text-xs pt-1.5 border-t border-dashed">
                  <span className="font-sans font-bold">অবশিষ্ট প্রদেয় লভ্যাংশ দায় (Current Payable):</span>
                  <span className="font-bold text-amber-800">{fmt(selectedInvestor.profitPayable || 0)}</span>
                </div>
              </div>

              {/* Canonical GL Accounting Rules */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] font-mono text-slate-700 space-y-1">
                <div className="font-semibold text-slate-900 font-sans">হিসাবরক্ষণ জাবেদা দাখিলা নির্দেশিকা (Accounting GL Rules):</div>
                <div>• মূলধন গ্রহণ: Dr 1010/1030 নগদ বা ব্যাংক | Cr 3020 বিনিয়োগকারীর মূলধন (রাজস্ব নয়)</div>
                <div>• মুনাফা বণ্টন: Dr 3070 মুনাফা বণ্টন | Cr 2050 বিনিয়োগকারীর লভ্যাংশ প্রদেয় (পরিচালন ব্যয় নয়)</div>
                <div>• লভ্যাংশ প্রদান: Dr 2050 বিনিয়োগকারীর লভ্যাংশ প্রদেয় | Cr 1010/1030 নগদ বা ব্যাংক</div>
                <div>• মূলধন ফেরত: Dr 3020 বিনিয়োগকারীর মূলধন | Cr 1010/1030 নগদ বা ব্যাংক</div>
              </div>
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

            <div className="space-y-3.5 text-xs sm:text-[13px]">
              <div>
                <label className="block font-semibold text-gray-700 mb-1.5">পরিশোধের উৎস হিসাব (Source Account) *</label>
                <select
                  required
                  value={repaymentSourceAccId}
                  onChange={(e) => setRepaymentSourceAccId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                >
                  <option value="">হিসাব নির্বাচন করুন...</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.accountType === 'CASH' ? '1010' : '1030'} • {acc.accountType === 'BANK' ? acc.bankName || 'ব্যাংক' : 'ক্যাশ'}) - স্থিতি: {fmt(acc.currentBalance)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">আসল অংশ ৳ (Principal) *</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    required
                    value={repaymentPrincipal}
                    onChange={(e) => setRepaymentPrincipal(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">সুদ খরচ ৳ (Interest Expense)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={repaymentInterest}
                    onChange={(e) => setRepaymentInterest(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                  />
                </div>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center text-xs sm:text-[13px]">
                <span className="font-semibold text-gray-700">মোট পরিশোধের পরিমাণ:</span>
                <span className="font-bold text-base text-[#1E5128] font-mono">
                  {fmt((parseFloat(repaymentPrincipal) || 0) + (parseFloat(repaymentInterest) || 0))}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">পরিশোধ তারিখ *</label>
                  <input
                    type="date"
                    required
                    value={repaymentDate}
                    onChange={(e) => setRepaymentDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">কিস্তি নম্বর (ঐচ্ছিক)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="যেমন: 1"
                    value={repaymentInstallmentNum ?? ''}
                    onChange={(e) =>
                      setRepaymentInstallmentNum(e.target.value ? parseInt(e.target.value) : undefined)
                    }
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1.5">নোট / রেফারেন্স</label>
                <input
                  type="text"
                  placeholder="রেফারেন্স বা চেক নম্বর"
                  value={repaymentNote}
                  onChange={(e) => setRepaymentNote(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none focus:border-[#1E5128] focus:ring-2 focus:ring-[#1E5128]/20"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowRepaymentModal(false)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={submittingRepayment}
                className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-white text-[13px] font-bold shadow-sm min-h-[44px] ${
                  submittingRepayment
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-[#1E5128] hover:bg-[#173F1F] cursor-pointer'
                }`}
              >
                {submittingRepayment ? 'পরিশোধ হচ্ছে...' : 'পরিশোধ নিশ্চিত করুন'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
