import React, { useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  PieChart,
  Layers,
  Scale,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Droplets,
  CalendarDays,
  Filter,
  Clock,
  Coins,
  Wallet,
  Landmark,
  ArrowDownRight,
  ArrowUpRight
} from 'lucide-react';
import {
  BalanceSheetReport,
  DateRangeFilter,
  generateBalanceSheet,
  generateProfitLoss,
  generateTrialBalance,
  ProfitLossReport,
  TrialBalance
} from '../accounting/accountingEngine';
import { exportAllToExcel, createFullJsonBackup, restoreFromJsonBackup } from '../services/exportService';
import { db } from '../db/indexedDb';
import { UserRole, Sale, Purchase, PaymentRecord, Loan, Investor, CashBankAccount, JournalEntry } from '../types';

type DatePreset = 'this_month' | 'last_month' | 'this_year' | 'custom';

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPresetDates(preset: 'this_month' | 'last_month' | 'this_year'): { startDate: string; endDate: string } {
  const now = new Date();
  if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: formatYMD(start), endDate: formatYMD(end) };
  }
  if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: formatYMD(start), endDate: formatYMD(end) };
  }
  if (preset === 'this_year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    return { startDate: formatYMD(start), endDate: formatYMD(end) };
  }
  return { startDate: '', endDate: '' };
}

interface Props {
  role: UserRole;
  currentUserId: string;
}

export interface AnimalProfitabilityRow {
  id: string;
  tag: string;
  species: string;
  breed: string;
  gender?: string;
  status: string;
  purchaseDate: string;
  saleDate?: string | number;
  daysHeld: number;
  purchaseCost: number;
  feedCost: number;
  medCost: number;
  labourCost: number;
  otherCosts: number;
  totalCost: number;
  saleRevenue: number;
  milkRevenue: number;
  milkLiters: number;
  totalRevenue: number;
  netProfit: number;
  costPerDay: number;
}

export interface AgingItem {
  id: string;
  invoiceNumber: string;
  partyName: string;
  date: string;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  daysOverdue: number;
}

export type AgingBucketKey = '0-7' | '8-14' | '15-30' | '30+';

export interface CashFlowAccountBreakdown {
  id: string;
  name: string;
  accountType: string;
  balance: number;
}

export interface CashFlowReportData {
  openingBalance: number;
  // Cash In
  cashSales: number;
  salesPayments: number;
  loansReceived: number;
  investorContributions: number;
  totalCashIn: number;
  // Cash Out
  purchasesPaid: number;
  expensesPaid: number;
  loanRepayments: number;
  totalCashOut: number;
  // Summary
  netCashFlow: number;
  closingBalance: number;
  // Accounts
  accountsBreakdown: CashFlowAccountBreakdown[];
  // Item counts / activity
  details: {
    cashSalesCount: number;
    salesPaymentsCount: number;
    loansCount: number;
    investorCount: number;
    cashPurchasesCount: number;
    purchasePaymentsCount: number;
    expenseTransactionsCount: number;
    loanRepaymentsCount: number;
  };
}

type ReportType = 'pl' | 'balanceSheet' | 'trialBalance' | 'animalProfitability' | 'aging' | 'cashFlow' | 'backup';

export const ReportsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [activeReport, setActiveReport] = useState<ReportType>('pl');
  const [loading, setLoading] = useState(false);

  const [pl, setPl] = useState<ProfitLossReport | null>(null);
  const [bs, setBs] = useState<BalanceSheetReport | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);

  // Cash Flow Report State
  const [cashFlowData, setCashFlowData] = useState<CashFlowReportData | null>(null);

  // Animal Profitability State
  const [animalRows, setAnimalRows] = useState<AnimalProfitabilityRow[]>([]);
  const [animalSortKey, setAnimalSortKey] = useState<'netProfit' | 'totalCost' | 'totalRevenue' | 'costPerDay'>('netProfit');
  const [animalSortDirection, setAnimalSortDirection] = useState<'desc' | 'asc'>('desc');
  const [animalStatusFilter, setAnimalStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SOLD'>('ALL');
  const [animalSearchQuery, setAnimalSearchQuery] = useState<string>('');

  // Aging Report State (Receivables & Payables)
  const [agingSubTab, setAgingSubTab] = useState<'receivables' | 'payables'>('receivables');
  const [receivablesList, setReceivablesList] = useState<AgingItem[]>([]);
  const [payablesList, setPayablesList] = useState<AgingItem[]>([]);
  const [agingSearchQuery, setAgingSearchQuery] = useState<string>('');
  const [agingBucketFilter, setAgingBucketFilter] = useState<'ALL' | AgingBucketKey>('ALL');

  const [restoreStatus, setRestoreStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Date Range Filtering State (Defaults to 'This Month' on first load)
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [startDate, setStartDate] = useState<string>(() => getPresetDates('this_month').startDate);
  const [endDate, setEndDate] = useState<string>(() => getPresetDates('this_month').endDate);

  const handleSelectPreset = (preset: 'this_month' | 'last_month' | 'this_year') => {
    const dates = getPresetDates(preset);
    setDatePreset(preset);
    setStartDate(dates.startDate);
    setEndDate(dates.endDate);
  };

  const handleCustomStartDateChange = (val: string) => {
    setDatePreset('custom');
    setStartDate(val);
  };

  const handleCustomEndDateChange = (val: string) => {
    setDatePreset('custom');
    setEndDate(val);
  };

  useEffect(() => {
    loadReports();
  }, [activeReport, startDate, endDate]);

  const loadAnimalProfitability = async () => {
    const [allAnimals, allEvents, allSales] = await Promise.all([
      db.animals.toArray(),
      db.animalEvents.toArray(),
      db.sales.toArray()
    ]);

    const milkEvents = allEvents.filter((ev) => ev.eventType === 'MILK');

    const rows: AnimalProfitabilityRow[] = allAnimals.map((a) => {
      const purchaseCost = Number(a.purchaseCost) || 0;
      const feedCost = Number(a.accumulatedFeedCost) || 0;
      const medCost = Number(a.accumulatedMedCost) || 0;
      const labourCost = Number(a.accumulatedLabourCost) || 0;
      const otherCosts = Number(a.otherCosts) || 0;
      const totalCost = purchaseCost + feedCost + medCost + labourCost + otherCosts;

      const saleRevenue = a.status === 'SOLD' ? Number(a.salePrice) || 0 : 0;

      // Milk events
      const thisAnimalMilk = milkEvents.filter((ev) => ev.animalId === a.id);
      const milkLiters =
        Math.round(
          thisAnimalMilk.reduce((acc, ev) => acc + (Number(ev.milkLiters) || 0), 0) * 10
        ) / 10;

      // Trackable milk sales linked to this animal
      let milkRevenue = 0;
      for (const s of allSales) {
        if (
          s.category === 'MILK' ||
          s.items?.some((it) => it.itemName?.toLowerCase().includes('milk') || it.itemName?.includes('দুধ'))
        ) {
          const isTied =
            s.items?.some(
              (it) =>
                it.itemName?.includes(a.id) ||
                (a.tag && it.itemName?.includes(a.tag))
            ) || s.invoiceNumber?.includes(a.id);
          if (isTied) {
            milkRevenue += s.grandTotal || s.totalAmount || 0;
          }
        }
      }

      const totalRevenue = saleRevenue + milkRevenue;
      const netProfit = totalRevenue - totalCost;

      let daysHeld = 1;
      if (a.purchaseDate) {
        const pTime = new Date(a.purchaseDate).getTime();
        if (!isNaN(pTime)) {
          const endTime =
            a.status === 'SOLD' && a.saleDate
              ? new Date(a.saleDate).getTime()
              : Date.now();
          daysHeld = Math.max(1, Math.floor((endTime - pTime) / (1000 * 60 * 60 * 24)));
        }
      }
      const costPerDay = daysHeld > 0 ? totalCost / daysHeld : totalCost;

      return {
        id: a.id,
        tag: a.tag || '',
        species: a.species,
        breed: a.breed || '',
        gender: a.gender,
        status: a.status,
        purchaseDate: a.purchaseDate || '',
        saleDate: a.saleDate,
        daysHeld,
        purchaseCost,
        feedCost,
        medCost,
        labourCost,
        otherCosts,
        totalCost,
        saleRevenue,
        milkRevenue,
        milkLiters,
        totalRevenue,
        netProfit,
        costPerDay
      };
    });

    setAnimalRows(rows);
  };

  const loadAgingReport = async () => {
    const [sales, purchases, payments] = await Promise.all([
      db.sales.toArray(),
      db.purchases.toArray(),
      db.payments.toArray()
    ]);

    // Aggregate payments by parentId from Tier 2 payment log
    const paymentsByParent = new Map<string, number>();
    for (const pmt of payments) {
      const prev = paymentsByParent.get(pmt.parentId) || 0;
      paymentsByParent.set(pmt.parentId, prev + (Number(pmt.amount) || 0));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const calcDaysOverdue = (dateStr: string): number => {
      if (!dateStr) return 0;
      const invDate = new Date(dateStr);
      invDate.setHours(0, 0, 0, 0);
      const diffMs = today.getTime() - invDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    };

    const rec: AgingItem[] = [];
    for (const s of sales) {
      const total = Number(s.grandTotal || s.totalAmount || 0);
      const pmtSum = paymentsByParent.get(s.id);
      const paid = pmtSum !== undefined ? pmtSum : Number(s.paidAmount || 0);
      const due = Math.max(0, total - paid);

      if (due > 0) {
        rec.push({
          id: s.id,
          invoiceNumber: s.invoiceNumber || s.id,
          partyName: s.customerName || 'গ্রাহক',
          date: s.date || '',
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          daysOverdue: calcDaysOverdue(s.date)
        });
      }
    }

    const pay: AgingItem[] = [];
    for (const p of purchases) {
      const total = Number(p.grandTotal || p.totalAmount || 0);
      const pmtSum = paymentsByParent.get(p.id);
      const paid = pmtSum !== undefined ? pmtSum : Number(p.paidAmount || 0);
      const due = Math.max(0, total - paid);

      if (due > 0) {
        pay.push({
          id: p.id,
          invoiceNumber: p.invoiceNumber || p.id,
          partyName: p.supplierName || 'সরবরাহকারী',
          date: p.date || '',
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          daysOverdue: calcDaysOverdue(p.date)
        });
      }
    }

    // Sort with oldest/most overdue at top of each list
    rec.sort((a, b) => b.daysOverdue - a.daysOverdue);
    pay.sort((a, b) => b.daysOverdue - a.daysOverdue);

    setReceivablesList(rec);
    setPayablesList(pay);
  };

  const loadCashFlowReport = async () => {
    const [
      allAccounts,
      cashBankAccounts,
      sales,
      purchases,
      payments,
      loans,
      investors,
      journalEntries
    ] = await Promise.all([
      db.accounts.toArray(),
      db.cashBankAccounts.toArray(),
      db.sales.toArray(),
      db.purchases.toArray(),
      db.payments.toArray(),
      db.loans.toArray(),
      db.investors.toArray(),
      db.journalEntries.toArray()
    ]);

    const isWithinRange = (dateStr?: string) => {
      if (!dateStr) return false;
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;
      return true;
    };

    // 1. CASH IN:
    // a) Cash sales (paymentMethod is 'CASH' or 'BANK' within date range)
    const inRangeCashSales = sales.filter(
      (s) => (s.paymentMethod === 'CASH' || s.paymentMethod === 'BANK') && isWithinRange(s.date)
    );
    const cashSalesTotal = inRangeCashSales.reduce(
      (sum, s) => sum + (Number(s.paidAmount ?? s.grandTotal ?? s.totalAmount) || 0),
      0
    );

    // b) Payments received via Tier 2's PaymentRecords (parentType === 'SALE')
    const inRangeSalePayments = payments.filter(
      (p) => p.parentType === 'SALE' && isWithinRange(p.date)
    );
    const salesPaymentsTotal = inRangeSalePayments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );

    // c) Loans received (from loans table disbursedDate/startDate within range)
    const inRangeLoans = loans.filter((l) => {
      const d = l.disbursedDate || l.startDate;
      return isWithinRange(d);
    });
    const loansReceivedTotal = inRangeLoans.reduce(
      (sum, l) => sum + (Number(l.principalAmount) || 0),
      0
    );

    // d) Investor contributions (from investors table joinedDate/entryDate within range)
    const inRangeInvestors = investors.filter((inv) => {
      const d = inv.joinedDate || (inv as any).entryDate;
      return isWithinRange(d);
    });
    const investorContributionsTotal = inRangeInvestors.reduce(
      (sum, inv) =>
        sum + (Number(inv.totalContribution || (inv as any).initialCapital || (inv as any).capitalAmount) || 0),
      0
    );

    const totalCashIn =
      Math.round((cashSalesTotal + salesPaymentsTotal + loansReceivedTotal + investorContributionsTotal) * 100) / 100;

    // 2. CASH OUT:
    // a) Purchases paid:
    // - Cash/bank purchases within range
    const inRangeCashPurchases = purchases.filter(
      (p) => (p.paymentMethod === 'CASH' || p.paymentMethod === 'BANK') && isWithinRange(p.date)
    );
    const cashPurchasesTotal = inRangeCashPurchases.reduce(
      (sum, p) => sum + (Number(p.paidAmount ?? p.grandTotal ?? p.totalAmount) || 0),
      0
    );

    // - Payments made via Tier 2's PaymentRecords (parentType === 'PURCHASE')
    const inRangePurchasePayments = payments.filter(
      (p) => p.parentType === 'PURCHASE' && isWithinRange(p.date)
    );
    const purchasePaymentsTotal = inRangePurchasePayments.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0
    );

    const purchasesPaidTotal = Math.round((cashPurchasesTotal + purchasePaymentsTotal) * 100) / 100;

    // b) Expenses paid & c) Loan repayments:
    // Any journal entry within range where Cash/Bank (1010, 1020, 1030) was credited
    const cashCodes = new Set(['1010', '1020', '1030']);
    const loanLiabilityCodes = new Set(['2110', '2120']);

    const expenseAccountCodes = new Set<string>();
    for (const acc of allAccounts) {
      if (
        acc.accountClass === 'EXPENSE' ||
        acc.accountClass === 'OTHER_EXPENSE' ||
        acc.code.startsWith('6') ||
        acc.code.startsWith('7')
      ) {
        expenseAccountCodes.add(acc.code);
      }
    }

    let expensesPaidTotal = 0;
    let expenseTransactionsCount = 0;
    let loanRepaymentsTotal = 0;
    let loanRepaymentsCount = 0;

    const inRangeJournals = journalEntries.filter((j) => isWithinRange(j.date));

    for (const entry of inRangeJournals) {
      const cashCredit = entry.lines
        .filter((l) => cashCodes.has(l.accountCode))
        .reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

      if (cashCredit > 0) {
        // Exclude purchase vouchers, sale vouchers, and internal contra transfers
        const isPurchaseJournal =
          entry.voucherType === 'PURCHASE' ||
          entry.reference?.startsWith('PUR') ||
          entry.voucherNumber?.startsWith('PUR');
        const isContra =
          entry.voucherType === 'CONTRA' ||
          entry.lines.every((l) => cashCodes.has(l.accountCode));

        if (!isPurchaseJournal && !isContra) {
          // Check for loan repayment: debit to 2110 or 2120
          const loanDebit = entry.lines
            .filter((l) => loanLiabilityCodes.has(l.accountCode))
            .reduce((sum, l) => sum + (Number(l.debit) || 0), 0);

          if (loanDebit > 0) {
            loanRepaymentsTotal += loanDebit;
            loanRepaymentsCount++;
          }

          // Check for expense debits
          const expenseDebit = entry.lines
            .filter((l) => expenseAccountCodes.has(l.accountCode) && !loanLiabilityCodes.has(l.accountCode))
            .reduce((sum, l) => sum + (Number(l.debit) || 0), 0);

          if (expenseDebit > 0) {
            expensesPaidTotal += expenseDebit;
            expenseTransactionsCount++;
          }
        }
      }
    }

    expensesPaidTotal = Math.round(expensesPaidTotal * 100) / 100;
    loanRepaymentsTotal = Math.round(loanRepaymentsTotal * 100) / 100;

    const totalCashOut = Math.round((purchasesPaidTotal + expensesPaidTotal + loanRepaymentsTotal) * 100) / 100;
    const netCashFlow = Math.round((totalCashIn - totalCashOut) * 100) / 100;

    // Actual closing balance = sum of all cashBankAccounts
    const actualTotalInCashBank =
      Math.round(cashBankAccounts.reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0) * 100) / 100;

    // The resulting closing balance — which should match the actual total in cashBankAccounts
    const closingBalance = actualTotalInCashBank;
    // Opening balance at start of range: closing - netCashFlow
    const openingBalance = Math.round((closingBalance - netCashFlow) * 100) / 100;

    const accountsBreakdown = cashBankAccounts.map((a) => ({
      id: a.id,
      name: a.name || (a.accountType === 'CASH' ? 'নগদ তহবিল (Cash Drawer)' : 'ব্যাংক হিসাব (Bank)'),
      accountType: a.accountType,
      balance: Number(a.currentBalance) || 0
    }));

    setCashFlowData({
      openingBalance,
      cashSales: cashSalesTotal,
      salesPayments: salesPaymentsTotal,
      loansReceived: loansReceivedTotal,
      investorContributions: investorContributionsTotal,
      totalCashIn,
      purchasesPaid: purchasesPaidTotal,
      expensesPaid: expensesPaidTotal,
      loanRepayments: loanRepaymentsTotal,
      totalCashOut,
      netCashFlow,
      closingBalance,
      accountsBreakdown,
      details: {
        cashSalesCount: inRangeCashSales.length,
        salesPaymentsCount: inRangeSalePayments.length,
        loansCount: inRangeLoans.length,
        investorCount: inRangeInvestors.length,
        cashPurchasesCount: inRangeCashPurchases.length,
        purchasePaymentsCount: inRangePurchasePayments.length,
        expenseTransactionsCount,
        loanRepaymentsCount
      }
    });
  };

  const loadReports = async () => {
    setLoading(true);
    try {
      const dateFilter: DateRangeFilter | undefined = (startDate || endDate) ? { startDate, endDate } : undefined;
      if (activeReport === 'pl') {
        const res = await generateProfitLoss(dateFilter);
        setPl(res);
      } else if (activeReport === 'balanceSheet') {
        const res = await generateBalanceSheet(dateFilter);
        setBs(res);
      } else if (activeReport === 'trialBalance') {
        const res = await generateTrialBalance(dateFilter);
        setTb(res);
      } else if (activeReport === 'animalProfitability') {
        await loadAnimalProfitability();
      } else if (activeReport === 'aging') {
        await loadAgingReport();
      } else if (activeReport === 'cashFlow') {
        await loadCashFlowReport();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (key: 'netProfit' | 'totalCost' | 'totalRevenue' | 'costPerDay') => {
    if (animalSortKey === key) {
      setAnimalSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setAnimalSortKey(key);
      setAnimalSortDirection('desc');
    }
  };

  const sortedAnimalRows = useMemo(() => {
    let result = [...animalRows];

    if (animalStatusFilter !== 'ALL') {
      result = result.filter((r) => r.status === animalStatusFilter);
    }

    if (animalSearchQuery.trim()) {
      const q = animalSearchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.tag.toLowerCase().includes(q) ||
          r.breed.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const valA = a[animalSortKey];
      const valB = b[animalSortKey];
      return animalSortDirection === 'desc' ? valB - valA : valA - valB;
    });

    return result;
  }, [animalRows, animalStatusFilter, animalSearchQuery, animalSortKey, animalSortDirection]);

  const herdSummary = useMemo(() => {
    const totalAnimals = animalRows.length;
    const activeCount = animalRows.filter((r) => r.status === 'ACTIVE').length;
    const soldCount = animalRows.filter((r) => r.status === 'SOLD').length;
    const totalHerdCost = animalRows.reduce((acc, r) => acc + r.totalCost, 0);
    const totalHerdRevenue = animalRows.reduce((acc, r) => acc + r.totalRevenue, 0);
    const totalHerdProfit = totalHerdRevenue - totalHerdCost;
    const totalDays = animalRows.reduce((acc, r) => acc + r.daysHeld, 0);
    const avgDailyCost = totalDays > 0 ? totalHerdCost / totalDays : 0;

    return {
      totalAnimals,
      activeCount,
      soldCount,
      totalHerdCost,
      totalHerdRevenue,
      totalHerdProfit,
      avgDailyCost
    };
  }, [animalRows]);

  const currentAgingItems = useMemo(() => {
    const source = agingSubTab === 'receivables' ? receivablesList : payablesList;
    if (!agingSearchQuery.trim()) return source;
    const q = agingSearchQuery.toLowerCase();
    return source.filter(
      (item) =>
        item.partyName.toLowerCase().includes(q) ||
        item.invoiceNumber.toLowerCase().includes(q)
    );
  }, [agingSubTab, receivablesList, payablesList, agingSearchQuery]);

  const agingBuckets = useMemo(() => {
    const b0_7: AgingItem[] = [];
    const b8_14: AgingItem[] = [];
    const b15_30: AgingItem[] = [];
    const b30_plus: AgingItem[] = [];

    for (const item of currentAgingItems) {
      if (item.daysOverdue <= 7) {
        b0_7.push(item);
      } else if (item.daysOverdue <= 14) {
        b8_14.push(item);
      } else if (item.daysOverdue <= 30) {
        b15_30.push(item);
      } else {
        b30_plus.push(item);
      }
    }

    // Sort with oldest/most overdue at top of each list
    b0_7.sort((a, b) => b.daysOverdue - a.daysOverdue);
    b8_14.sort((a, b) => b.daysOverdue - a.daysOverdue);
    b15_30.sort((a, b) => b.daysOverdue - a.daysOverdue);
    b30_plus.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return [
      {
        key: '30+' as AgingBucketKey,
        labelBn: '৩০+ দিন (30+ days)',
        title: '৩০+ দিন অতিবাহিত',
        priorityTag: 'সর্বাধিক জরুরি তাগাদা (Critical)',
        items: b30_plus,
        totalDue: b30_plus.reduce((sum, i) => sum + i.dueAmount, 0),
        badgeClass: 'bg-red-100 text-red-800 border-red-200',
        headerBg: 'bg-red-50/70 border-red-200 text-red-950',
        cardBorder: 'border-red-200',
        urgencyBadge: 'bg-red-600 text-white'
      },
      {
        key: '15-30' as AgingBucketKey,
        labelBn: '১৫-৩০ দিন (15-30 days)',
        title: '১৫-৩০ দিন অতিবাহিত',
        priorityTag: 'মাঝারি তাগাদা (Attention Required)',
        items: b15_30,
        totalDue: b15_30.reduce((sum, i) => sum + i.dueAmount, 0),
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
        headerBg: 'bg-amber-50/70 border-amber-200 text-amber-950',
        cardBorder: 'border-amber-200',
        urgencyBadge: 'bg-amber-600 text-white'
      },
      {
        key: '8-14' as AgingBucketKey,
        labelBn: '৮-১৪ দিন (8-14 days)',
        title: '৮-১৪ দিন অতিবাহিত',
        priorityTag: 'সাধারণ বকেয়া (Moderate)',
        items: b8_14,
        totalDue: b8_14.reduce((sum, i) => sum + i.dueAmount, 0),
        badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        headerBg: 'bg-yellow-50/60 border-yellow-200 text-yellow-950',
        cardBorder: 'border-yellow-200',
        urgencyBadge: 'bg-yellow-600 text-white'
      },
      {
        key: '0-7' as AgingBucketKey,
        labelBn: '০-৭ দিন (0-7 days)',
        title: '০-৭ দিন অতিবাহিত',
        priorityTag: 'নতুন চালান (Recent / Current)',
        items: b0_7,
        totalDue: b0_7.reduce((sum, i) => sum + i.dueAmount, 0),
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
        headerBg: 'bg-blue-50/60 border-blue-200 text-blue-950',
        cardBorder: 'border-blue-200',
        urgencyBadge: 'bg-blue-600 text-white'
      }
    ];
  }, [currentAgingItems]);

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
          onClick={() => setActiveReport('animalProfitability')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'animalProfitability'
              ? 'bg-[#1E5128] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>পশুভিত্তিক লাভ-ক্ষতি (Animal Profitability)</span>
        </button>

        <button
          id="tab-aging-report"
          onClick={() => setActiveReport('aging')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'aging'
              ? 'bg-[#1E5128] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>পাওনা-দেনার হিসাব (Aging Report)</span>
        </button>

        <button
          id="tab-cash-flow"
          onClick={() => setActiveReport('cashFlow')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'cashFlow'
              ? 'bg-[#1E5128] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Coins className="w-4 h-4" />
          <span>নগদ প্রবাহ (Cash Flow)</span>
        </button>

        <button
          id="tab-backup-restore"
          onClick={() => setActiveReport('backup')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
            activeReport === 'backup' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>ব্যাকআপ ও রিস্টোর (JSON Backup)</span>
        </button>
      </div>

      {/* Date Range Control (Visible for Financial Reports: pl, balanceSheet, trialBalance, animalProfitability) */}
      {activeReport !== 'backup' && activeReport !== 'aging' && (
        <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#1E5128] border border-emerald-100 flex items-center justify-center shrink-0">
              <CalendarDays className="w-5 h-5 text-[#1E5128]" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">সময়সীমা নির্বাচন (Report Date Range)</span>
              <div className="text-[13px] font-bold text-gray-900 flex items-center gap-1.5 flex-wrap">
                <span>
                  {datePreset === 'this_month' && 'এই মাস (This Month)'}
                  {datePreset === 'last_month' && 'গত মাস (Last Month)'}
                  {datePreset === 'this_year' && 'এই বছর (This Year)'}
                  {datePreset === 'custom' && 'কাস্টম সময়কাল (Custom Range)'}
                </span>
                {startDate && endDate && (
                  <span className="text-gray-600 font-mono text-xs font-semibold bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200">
                    {startDate} হতে {endDate}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Quick Presets: এই মাস, গত মাস, এই বছর */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
              <button
                type="button"
                id="btn-preset-this-month"
                onClick={() => handleSelectPreset('this_month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                  datePreset === 'this_month'
                    ? 'bg-[#1E5128] text-white shadow-xs'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                }`}
              >
                এই মাস
              </button>
              <button
                type="button"
                id="btn-preset-last-month"
                onClick={() => handleSelectPreset('last_month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                  datePreset === 'last_month'
                    ? 'bg-[#1E5128] text-white shadow-xs'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                }`}
              >
                গত মাস
              </button>
              <button
                type="button"
                id="btn-preset-this-year"
                onClick={() => handleSelectPreset('this_year')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                  datePreset === 'this_year'
                    ? 'bg-[#1E5128] text-white shadow-xs'
                    : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                }`}
              >
                এই বছর
              </button>
            </div>

            {/* Custom From/To Date Picker */}
            <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl border border-gray-200">
              <div className="flex items-center gap-1.5 pl-1.5">
                <span className="text-xs font-semibold text-gray-600">হতে:</span>
                <input
                  type="date"
                  id="filter-start-date"
                  value={startDate}
                  onChange={(e) => handleCustomStartDateChange(e.target.value)}
                  className="px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-800 text-base font-sans cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                  title="শুরুর তারিখ (From Date)"
                />
              </div>
              <div className="flex items-center gap-1.5 pr-1.5">
                <span className="text-xs font-semibold text-gray-600">পর্যন্ত:</span>
                <input
                  type="date"
                  id="filter-end-date"
                  value={endDate}
                  onChange={(e) => handleCustomEndDateChange(e.target.value)}
                  className="px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-800 text-base font-sans cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                  title="শেষ তারিখ (To Date)"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REPORT 1: PROFIT & LOSS ===================== */}
      {activeReport === 'pl' && pl && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          <div className="text-center border-b border-gray-100 pb-4">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              লাভ ও ক্ষতি হিসাব বিবরণী (Statement of Profit or Loss)
            </h3>
            <p className="text-[13px] text-gray-500 mt-0.5">
              আন্তর্জাতিক হিসাবরক্ষণ মান (IAS 1 & IFRS) অনুযায়ী প্রস্তুতকৃত • সময়সীমা: {startDate || 'শুরু'} হতে {endDate || 'বর্তমান'}
            </p>
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
              সম্পদ = দায় + মূলধন (Assets = Liabilities + Equity) • তারিখ: {endDate || 'বর্তমান'} অনুযায়ী
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
              <p className="text-[13px] text-gray-500 mt-0.5">
                লিপিবদ্ধ সকল খতিয়ান স্থিতির সমতা নিশ্চিতকরণ • সময়সীমা: {startDate || 'শুরু'} হতে {endDate || 'বর্তমান'}
              </p>
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

      {/* ===================== REPORT 4: ANIMAL PROFITABILITY ===================== */}
      {activeReport === 'animalProfitability' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#1E5128]" />
                <span>পশুভিত্তিক লাভ-ক্ষতি প্রতিবেদন (Per-Animal Profitability Report)</span>
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                খামারের প্রতিটি পশুর মোট খরচ, অর্জিত রাজস্ব ও নিট লাভ-ক্ষতির তুলনামূলক বিশ্লেষণ
              </p>
            </div>
            <div className="text-[12px] text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1.5">
              <span>ক্রমানুসারে সাজানো:</span>
              <span className="font-bold text-[#1E5128]">
                {animalSortKey === 'netProfit'
                  ? `নিট লাভ (${animalSortDirection === 'desc' ? 'সর্বোচ্চ ➔ সর্বনিম্ন' : 'সর্বনিম্ন ➔ সর্বোচ্চ'})`
                  : animalSortKey === 'totalCost'
                  ? `মোট খরচ (${animalSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : animalSortKey === 'totalRevenue'
                  ? `মোট রাজস্ব (${animalSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : `দৈনিক খরচ`}
              </span>
            </div>
          </div>

          {/* Herd KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                মোট পাল / গবাদিপশু
              </span>
              <div className="text-[18px] font-bold text-gray-900">
                {herdSummary.totalAnimals} <span className="text-[12px] font-normal text-gray-500">টি</span>
              </div>
              <div className="text-[11px] text-gray-600">
                সক্রিয়: {herdSummary.activeCount} | বিক্রিত: {herdSummary.soldCount}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">
                সর্বমোট ব্যয় (Cost)
              </span>
              <div className="text-[18px] font-bold font-mono text-amber-900">
                {fmt(herdSummary.totalHerdCost)}
              </div>
              <div className="text-[11px] text-amber-700">ক্রয় + খাদ্য + চিকিৎসা + শ্রমিক</div>
            </div>

            <div className="p-3.5 rounded-xl bg-cyan-50/70 border border-cyan-200 space-y-1">
              <span className="text-[11px] font-bold text-cyan-800 uppercase tracking-wide">
                সর্বমোট রাজস্ব (Revenue)
              </span>
              <div className="text-[18px] font-bold font-mono text-cyan-900">
                {fmt(herdSummary.totalHerdRevenue)}
              </div>
              <div className="text-[11px] text-cyan-700">বিক্রয়মূল্য ও দুধ বিক্রয়</div>
            </div>

            <div
              className={`p-3.5 rounded-xl border space-y-1 ${
                herdSummary.totalHerdProfit >= 0
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
              }`}
            >
              <span
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  herdSummary.totalHerdProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                সার্বিক নিট লাভ/ক্ষতি
              </span>
              <div
                className={`text-[18px] font-bold font-mono ${
                  herdSummary.totalHerdProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                {herdSummary.totalHerdProfit >= 0 ? '+' : ''}
                {fmt(herdSummary.totalHerdProfit)}
              </div>
              <div className="text-[11px] opacity-80">
                {herdSummary.totalHerdProfit >= 0 ? 'সার্বিক উদ্বৃত্ত লাভ' : 'চলতি বিনিয়োগ ঘাটতি'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                গড় দৈনিক ব্যয় / পশু
              </span>
              <div className="text-[18px] font-bold font-mono text-gray-800">
                {fmt(herdSummary.avgDailyCost)}
              </div>
              <div className="text-[11px] text-gray-500">প্রতি দিনের গড় প্রতিপালন ব্যয়</div>
            </div>
          </div>

          {/* Controls: Search, Filter, Sort */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                type="text"
                value={animalSearchQuery}
                onChange={(e) => setAnimalSearchQuery(e.target.value)}
                placeholder="আইডি, ট্যাগ বা জাত দিয়ে খুঁজুন..."
                className="w-full pl-9 pr-4 py-2 text-[13px] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1E5128] focus:border-transparent bg-gray-50"
              />
            </div>

            {/* Filter Pills & Sort Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-gray-100 p-1 rounded-xl text-[12px] font-medium">
                <button
                  onClick={() => setAnimalStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    animalStatusFilter === 'ALL'
                      ? 'bg-white font-bold text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  সবগুলো ({animalRows.length})
                </button>
                <button
                  onClick={() => setAnimalStatusFilter('ACTIVE')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    animalStatusFilter === 'ACTIVE'
                      ? 'bg-white font-bold text-emerald-800 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  সক্রিয় ({herdSummary.activeCount})
                </button>
                <button
                  onClick={() => setAnimalStatusFilter('SOLD')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    animalStatusFilter === 'SOLD'
                      ? 'bg-white font-bold text-blue-800 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  বিক্রিত ({herdSummary.soldCount})
                </button>
              </div>

              {/* Sort by Net Profit button */}
              <button
                onClick={() => toggleSort('netProfit')}
                className={`px-3 py-2 rounded-xl border text-[12px] font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  animalSortKey === 'netProfit'
                    ? 'bg-[#1E5128] text-white border-[#1E5128] shadow-xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>নিট লাভ অনুযায়ী</span>
                {animalSortKey === 'netProfit' ? (
                  animalSortDirection === 'desc' ? (
                    <ArrowDown className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowUp className="w-3.5 h-3.5" />
                  )
                ) : (
                  <ArrowUpDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Main Profitability Summary Table */}
          <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-2xs">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 font-bold">
                  <th className="py-3 px-3.5 whitespace-nowrap">পশু ও ট্যাগ</th>
                  <th className="py-3 px-3 whitespace-nowrap">স্ট্যাটাস</th>
                  <th className="py-3 px-3 whitespace-nowrap">প্রতিপালন কাল</th>
                  <th
                    onClick={() => toggleSort('totalCost')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট ব্যয়</span>
                      {animalSortKey === 'totalCost' && (
                        animalSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleSort('totalRevenue')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট রাজস্ব</span>
                      {animalSortKey === 'totalRevenue' && (
                        animalSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleSort('netProfit')}
                    className="py-3 px-3.5 whitespace-nowrap cursor-pointer bg-gray-200/50 hover:bg-gray-200 transition-all"
                  >
                    <div className="flex items-center gap-1 text-[#1E5128]">
                      <span>নিট লাভ / ক্ষতি</span>
                      {animalSortKey === 'netProfit' ? (
                        animalSortDirection === 'desc' ? <ArrowDown className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleSort('costPerDay')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>দৈনিক খরচ</span>
                      {animalSortKey === 'costPerDay' && (
                        animalSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-sans">
                {sortedAnimalRows.length > 0 ? (
                  sortedAnimalRows.map((row) => {
                    const isProfitable = row.netProfit >= 0;

                    return (
                      <tr key={row.id} className="hover:bg-gray-50/70 transition-colors">
                        {/* Animal ID & Tag */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900">{row.id}</span>
                            {row.tag && (
                              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px] font-mono border border-gray-200">
                                {row.tag}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {row.species === 'CATTLE' ? 'গরু' : row.species === 'GOAT' ? 'ছাগল' : row.species}
                            {row.breed ? ` • ${row.breed}` : ''}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          {row.status === 'ACTIVE' ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                              <span>সক্রিয়</span>
                            </span>
                          ) : row.status === 'SOLD' ? (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200 inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                              <span>বিক্রিত</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
                              {row.status}
                            </span>
                          )}
                        </td>

                        {/* Days Held */}
                        <td className="py-3 px-3 whitespace-nowrap text-gray-600">
                          <div className="font-mono font-semibold text-gray-900">
                            {row.daysHeld} দিন
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {row.purchaseDate || 'ক্রয় তারিখ নেই'}
                          </div>
                        </td>

                        {/* Total Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-gray-900">
                            {fmt(row.totalCost)}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            ক্রয় {fmt(row.purchaseCost)} + পরিচর্যা {fmt(row.totalCost - row.purchaseCost)}
                          </div>
                        </td>

                        {/* Total Revenue */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-gray-900">
                            {fmt(row.totalRevenue)}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            {row.status === 'SOLD'
                              ? `বিক্রয়: ${fmt(row.saleRevenue)}`
                              : row.milkLiters > 0
                              ? `দুধ: ${row.milkLiters} লিটার (মেমো)`
                              : 'অবিক্রিত'}
                          </div>
                        </td>

                        {/* Net Profit / Loss */}
                        <td className="py-3 px-3.5 whitespace-nowrap font-mono bg-gray-50/50">
                          <div
                            className={`font-bold text-[14px] flex items-center gap-1 ${
                              isProfitable ? 'text-[#15803D]' : 'text-rose-700'
                            }`}
                          >
                            <span>{isProfitable ? '+' : ''}</span>
                            <span>{fmt(row.netProfit)}</span>
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            {isProfitable
                              ? 'লাভ'
                              : row.status === 'ACTIVE'
                              ? 'চলতি ব্যয় (অবিক্রিত)'
                              : 'ক্ষতি'}
                          </div>
                        </td>

                        {/* Cost Per Day */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-700">
                          <span className="font-semibold">{fmt(row.costPerDay)}</span>
                          <span className="text-[11px] text-gray-400 font-sans">/দিন</span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      কোনো পশুর তথ্য পাওয়া যায়নি।
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Table Footer: Herd Totals */}
              {sortedAnimalRows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-300">
                    <td colSpan={3} className="py-3 px-3.5">
                      মোট সমষ্টি ({sortedAnimalRows.length}টি পশু)
                    </td>
                    <td className="py-3 px-3 font-mono text-amber-900">
                      {fmt(sortedAnimalRows.reduce((acc, r) => acc + r.totalCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-cyan-900">
                      {fmt(sortedAnimalRows.reduce((acc, r) => acc + r.totalRevenue, 0))}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-[14px]">
                      {(() => {
                        const sumNet = sortedAnimalRows.reduce((acc, r) => acc + r.netProfit, 0);
                        return (
                          <span className={sumNet >= 0 ? 'text-[#15803D]' : 'text-rose-700'}>
                            {sumNet >= 0 ? '+' : ''}
                            {fmt(sumNet)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-700 text-[12px]">
                      {fmt(
                        sortedAnimalRows.reduce((acc, r) => acc + r.totalCost, 0) /
                          Math.max(
                            1,
                            sortedAnimalRows.reduce((acc, r) => acc + r.daysHeld, 0)
                          )
                      )}
                      <span className="text-[10px] text-gray-400 font-sans">/দিন</span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Footnote */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-[11px] text-gray-500 space-y-1">
            <p>
              • <strong>হিসাবের ভিত্তি:</strong> প্রতিটি পশুর মোট ব্যয় = ক্রয়মূল্য + খাদ্য খরচ + ওষুধ/চিকিৎসা খরচ + শ্রমিক ব্যয় + অন্যান্য ব্যয়।
            </p>
            <p>
              • <strong>রাজস্ব ও নিট লাভ:</strong> সক্রিয় পশুর ক্ষেত্রে বিক্রয় না হওয়া পর্যন্ত নিট লাভ-ক্ষতিতে বিনিয়োগ খরচ ঋণাত্মক হিসেবে প্রদর্শিত হয়। পশু বিক্রয়ের পর বিক্রয়লব্ধ মূল্যের ভিত্তিতে চূড়ান্ত লাভ বা ক্ষতি নির্ধারিত হয়।
            </p>
            <p>
              • <strong>দুধ উৎপাদনের হিসাব:</strong> গাভীর ক্ষেত্রে উৎপন্ন দুধের পরিমাণ মেমো লাইন হিসেবে প্রদর্শিত হয়েছে।
            </p>
          </div>
        </div>
      )}

      {/* ===================== REPORT: AGING REPORT (পাওনা-দেনার হিসাব) ===================== */}
      {activeReport === 'aging' && (
        <div className="space-y-5">
          {/* Sub-tabs: Receivables & Payables */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#1E5128]" />
                  <span>পাওনা-দেনার হিসাব (Receivables & Payables Aging Report)</span>
                </h3>
                <p className="text-[13px] text-gray-600 mt-0.5">
                  আজকের তারিখ পর্যন্ত বকেয়া অর্থ আদায় ও পরিশোধের মেয়াদ ভিত্তিক অগ্রাধিকার তালিকা
                </p>
              </div>

              {/* Sub-tab Switcher */}
              <div className="inline-flex p-1 bg-gray-100 rounded-xl border border-gray-200 self-start sm:self-auto">
                <button
                  type="button"
                  id="tab-aging-receivables"
                  onClick={() => {
                    setAgingSubTab('receivables');
                    setAgingBucketFilter('ALL');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-[13px] font-bold transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px] ${
                    agingSubTab === 'receivables'
                      ? 'bg-[#1E5128] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Receivables (বিক্রয় বকেয়া / পাওনা)</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                    agingSubTab === 'receivables' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {receivablesList.length}
                  </span>
                </button>

                <button
                  type="button"
                  id="tab-aging-payables"
                  onClick={() => {
                    setAgingSubTab('payables');
                    setAgingBucketFilter('ALL');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-[13px] font-bold transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px] ${
                    agingSubTab === 'payables'
                      ? 'bg-[#1E5128] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>Payables (ক্রয় বকেয়া / দেনা)</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                    agingSubTab === 'payables' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {payablesList.length}
                  </span>
                </button>
              </div>
            </div>

            {/* Overview Metric Cards for Current Sub-tab */}
            {(() => {
              const totalItemsCount = currentAgingItems.length;
              const totalDueSum = currentAgingItems.reduce((acc, it) => acc + it.dueAmount, 0);

              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {/* Total Due */}
                  <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                    <span className="text-[11px] font-bold text-gray-500 block">
                      {agingSubTab === 'receivables' ? 'মোট বিক্রয় বকেয়া (Total)' : 'মোট ক্রয় বকেয়া (Total)'}
                    </span>
                    <div className="text-base sm:text-lg font-bold font-mono text-gray-900">
                      {fmt(totalDueSum)}
                    </div>
                    <span className="text-[11px] text-gray-500 block">
                      {totalItemsCount}টি চালানে বকেয়া
                    </span>
                  </div>

                  {/* 4 Buckets Breakdown */}
                  {agingBuckets.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setAgingBucketFilter(agingBucketFilter === b.key ? 'ALL' : b.key)}
                      className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                        agingBucketFilter === b.key
                          ? 'ring-2 ring-[#1E5128] bg-white shadow-xs'
                          : 'bg-white hover:bg-gray-50/80'
                      } ${b.cardBorder}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[11px] font-bold text-gray-700">{b.labelBn}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${b.badgeClass}`}>
                          {b.items.length}
                        </span>
                      </div>
                      <div className="text-sm sm:text-base font-bold font-mono text-gray-900">
                        {fmt(b.totalDue)}
                      </div>
                      <span className="text-[10px] text-gray-500 block truncate">
                        {b.title}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  id="input-aging-search"
                  placeholder={
                    agingSubTab === 'receivables'
                      ? 'গ্রাহকের নাম বা চালান নম্বর খুঁজুন...'
                      : 'সরবরাহকারীর নাম বা চালান নম্বর খুঁজুন...'
                  }
                  value={agingSearchQuery}
                  onChange={(e) => setAgingSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                />
              </div>

              {/* Bucket Quick Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 mr-1 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" /> বাকেট:
                </span>
                <button
                  type="button"
                  onClick={() => setAgingBucketFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[32px] ${
                    agingBucketFilter === 'ALL'
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  সব বাকেট
                </button>
                {agingBuckets.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setAgingBucketFilter(b.key)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[32px] ${
                      agingBucketFilter === b.key
                        ? 'bg-[#1E5128] text-white shadow-2xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {b.labelBn} ({b.items.length})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Grouped Buckets Content */}
          <div className="space-y-4">
            {agingBuckets
              .filter((b) => agingBucketFilter === 'ALL' || agingBucketFilter === b.key)
              .map((bucket) => (
                <div
                  key={bucket.key}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs"
                >
                  {/* Bucket Header */}
                  <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${bucket.headerBg}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${bucket.urgencyBadge}`}>
                        {bucket.priorityTag}
                      </span>
                      <h4 className="text-base font-bold">
                        {bucket.labelBn}
                      </h4>
                      <span className="text-xs text-gray-600 font-medium">
                        ({bucket.title})
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs sm:text-sm font-semibold">
                      <span className="text-gray-700">
                        চালান সংখ্যা: <strong className="font-mono text-gray-900">{bucket.items.length}</strong>টি
                      </span>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-700">
                        মোট বকেয়া:{' '}
                        <strong className="font-mono text-red-600 font-bold text-sm sm:text-base">
                          {fmt(bucket.totalDue)}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Bucket Items Table (Oldest/Most Overdue at Top) */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-gray-50/80 text-gray-600 font-semibold border-b border-gray-200">
                          <th className="p-3">চালান নং</th>
                          <th className="p-3">{agingSubTab === 'receivables' ? 'গ্রাহকের নাম' : 'সরবরাহকারীর নাম'}</th>
                          <th className="p-3">চালানের তারিখ</th>
                          <th className="p-3">মোট মূল্য</th>
                          <th className="p-3">পরিশোধিত</th>
                          <th className="p-3">বকেয়া পরিমাণ (Due)</th>
                          <th className="p-3">মেয়াদোত্তীর্ণ দিন (Overdue)</th>
                          <th className="p-3 text-right">অগ্রাধিকার স্থিতি</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bucket.items.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-6 text-center text-gray-400 text-xs italic">
                              এই বাকেটে কোনো বকেয়া চালান নেই।
                            </td>
                          </tr>
                        ) : (
                          bucket.items.map((item) => (
                            <tr key={item.id} className="hover:bg-gray-50/80">
                              <td className="p-3 font-mono font-bold text-sky-800 whitespace-nowrap">
                                {item.invoiceNumber}
                              </td>
                              <td className="p-3 font-semibold text-gray-900 whitespace-nowrap">
                                {item.partyName}
                              </td>
                              <td className="p-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                                {item.date}
                              </td>
                              <td className="p-3 font-mono text-gray-700 whitespace-nowrap">
                                {fmt(item.totalAmount)}
                              </td>
                              <td className="p-3 font-mono text-emerald-700 font-medium whitespace-nowrap">
                                {fmt(item.paidAmount)}
                              </td>
                              <td className="p-3 font-mono font-bold text-red-600 whitespace-nowrap">
                                {fmt(item.dueAmount)}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1 font-mono font-bold px-2.5 py-1 rounded-md text-xs ${
                                  item.daysOverdue > 30
                                    ? 'bg-red-100 text-red-800 border border-red-200'
                                    : item.daysOverdue >= 15
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : item.daysOverdue >= 8
                                    ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}>
                                  <Clock className="w-3 h-3" />
                                  <span>{item.daysOverdue} দিন</span>
                                </span>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${bucket.badgeClass}`}>
                                  {item.daysOverdue > 30
                                    ? 'জরুরি তাগাদা'
                                    : item.daysOverdue >= 15
                                    ? 'মনোযোগ প্রয়োজন'
                                    : item.daysOverdue >= 8
                                    ? 'বকেয়া'
                                    : 'নতুন চালান'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
          </div>

          {/* Aging Explanatory Footnote */}
          <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-600 space-y-1">
            <p>
              • <strong>হিসাবের সূত্র:</strong> বকেয়া পরিমাণ = মোট চালান মূল্য − কিস্তির মাধ্যমে পরিশোধিত মোট টাকা। অতিবাহিত দিন = আজকের তারিখ − চালানের তারিখ।
            </p>
            <p>
              • <strong>অগ্রাধিকার ক্রম:</strong> প্রতিটি বাকেটের তালিকায় সর্বাধিক পুরনো ও ঝুঁকিপূর্ণ বকেয়া চালানগুলো সবার শীর্ষে রাখা হয়েছে যাতে সবার আগে যোগাযোগ ও তাগাদা প্রদান সহজ হয়।
            </p>
          </div>
        </div>
      )}

      {/* ===================== REPORT: CASH FLOW STATEMENT (নগদ প্রবাহ বিবরণী) ===================== */}
      {activeReport === 'cashFlow' && (
        <div className="space-y-4">
          {loading || !cashFlowData ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 text-gray-500 font-medium">
              নগদ প্রবাহ বিবরণী লোড হচ্ছে...
            </div>
          ) : (
            <>
              {/* Cash Flow Header Card */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-emerald-50 text-[#1E5128] border border-emerald-100">
                        <Coins className="w-4 h-4 text-[#1E5128]" />
                      </span>
                      <h3 className="text-base sm:text-lg font-bold text-gray-900">
                        নগদ প্রবাহ বিবরণী (Cash Flow Statement)
                      </h3>
                    </div>
                    <p className="text-[13px] text-gray-600 mt-1">
                      প্রত্যক্ষ পদ্ধতিতে নগদ আগমন ও বহির্গমনের হিসাব এবং সমাপ্তি ব্যাংক ও নগদ স্থিতির সমন্বয়
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>ক্যাশ ও ব্যাংক একাউন্টের সাথে সমন্বিত</span>
                    </span>
                    {startDate && endDate && (
                      <span className="text-xs font-mono font-bold bg-gray-100 px-2.5 py-1 rounded-lg text-gray-700 border border-gray-200">
                        {startDate} হতে {endDate}
                      </span>
                    )}
                  </div>
                </div>

                {/* 5 Top Level High-Level Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {/* 1. Opening Balance */}
                  <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                    <span className="text-[11px] font-bold text-gray-500 block uppercase tracking-wider">
                      প্রারম্ভিক স্থিতি (Opening)
                    </span>
                    <div className="text-base sm:text-lg font-bold font-mono text-gray-900">
                      {fmt(cashFlowData.openingBalance)}
                    </div>
                    <span className="text-[11px] text-gray-500 block">
                      সময়কালের শুরুতে তহবিল
                    </span>
                  </div>

                  {/* 2. Total Cash IN */}
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                        মোট নগদ আগমন (IN)
                      </span>
                      <ArrowDownRight className="w-4 h-4 text-emerald-600 shrink-0" />
                    </div>
                    <div className="text-base sm:text-lg font-bold font-mono text-emerald-700">
                      +{fmt(cashFlowData.totalCashIn)}
                    </div>
                    <span className="text-[11px] text-emerald-600 block">
                      বিক্রয়, কিস্তি, ঋণ ও বিনিয়োগ
                    </span>
                  </div>

                  {/* 3. Total Cash OUT */}
                  <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider">
                        মোট নগদ প্রদান (OUT)
                      </span>
                      <ArrowUpRight className="w-4 h-4 text-rose-600 shrink-0" />
                    </div>
                    <div className="text-base sm:text-lg font-bold font-mono text-rose-700">
                      -{fmt(cashFlowData.totalCashOut)}
                    </div>
                    <span className="text-[11px] text-rose-600 block">
                      ক্রয়, পরিচালন ব্যয় ও কিস্তি
                    </span>
                  </div>

                  {/* 4. Net Cash Flow */}
                  <div className={`p-3.5 rounded-xl border space-y-1 ${
                    cashFlowData.netCashFlow >= 0
                      ? 'bg-blue-50/60 border-blue-200'
                      : 'bg-amber-50/60 border-amber-200'
                  }`}>
                    <span className={`text-[11px] font-bold uppercase tracking-wider block ${
                      cashFlowData.netCashFlow >= 0 ? 'text-blue-800' : 'text-amber-800'
                    }`}>
                      নিট প্রবাহ (Net Flow)
                    </span>
                    <div className={`text-base sm:text-lg font-bold font-mono ${
                      cashFlowData.netCashFlow >= 0 ? 'text-blue-700' : 'text-amber-700'
                    }`}>
                      {cashFlowData.netCashFlow >= 0 ? '+' : ''}{fmt(cashFlowData.netCashFlow)}
                    </div>
                    <span className={`text-[11px] block ${
                      cashFlowData.netCashFlow >= 0 ? 'text-blue-600' : 'text-amber-600'
                    }`}>
                      {cashFlowData.netCashFlow >= 0 ? 'তহবিল নিট বৃদ্ধি' : 'তহবিল নিট হ্রাস'}
                    </span>
                  </div>

                  {/* 5. Closing Balance */}
                  <div className="p-3.5 rounded-xl bg-[#1E5128]/5 border border-[#1E5128]/30 space-y-1 col-span-2 sm:col-span-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-[#1E5128] uppercase tracking-wider">
                        সমাপ্তি স্থিতি (Closing)
                      </span>
                      <CheckCircle2 className="w-4 h-4 text-[#1E5128] shrink-0" />
                    </div>
                    <div className="text-base sm:text-lg font-bold font-mono text-[#1E5128]">
                      {fmt(cashFlowData.closingBalance)}
                    </div>
                    <span className="text-[11px] text-[#1E5128]/80 font-medium block truncate">
                      = মোট সক্রিয় তহবিল
                    </span>
                  </div>
                </div>
              </div>

              {/* Two Column Breakdown: Cash IN vs Cash OUT */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Cash IN Section */}
                <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
                        <ArrowDownRight className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900 text-sm sm:text-base">
                          নগদ আগমন (Cash IN - Grouped by Source)
                        </h4>
                        <p className="text-xs text-gray-500">উৎস ভিত্তিক সমস্ত নগদ প্রাপ্তি</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                      +{fmt(cashFlowData.totalCashIn)}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* 1. Cash Sales */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>১. নগদ ও ব্যাংক বিক্রয় (Cash Sales)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.cashSalesCount}টি চালান
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            বিক্রয়কালে সরাসরি নগদ ও ব্যাংকে প্রাপ্ত চালানের অর্থ
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-emerald-700">
                          {fmt(cashFlowData.cashSales)}
                        </div>
                      </div>
                    </div>

                    {/* 2. Sales Payments / Installments (Tier 2 Payment Records) */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>২. বকেয়া বিক্রয় কিস্তি আদায় (Payments Received)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800">
                              {cashFlowData.details.salesPaymentsCount}টি কিস্তি
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            ক্রেতার পূর্বের বাকি বা কিস্তি পরিশোধ (PaymentRecords লগ হতে)
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-emerald-700">
                          {fmt(cashFlowData.salesPayments)}
                        </div>
                      </div>
                    </div>

                    {/* 3. Loans Received */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>৩. গৃহীত ঋণ (Loans Received)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.loansCount}টি ঋণ
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            ব্যাংক বা কৃষি ঋণ অনুমোদন বাবদ প্রাপ্ত অর্থ
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-emerald-700">
                          {fmt(cashFlowData.loansReceived)}
                        </div>
                      </div>
                    </div>

                    {/* 4. Investor Contributions */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>৪. বিনিয়োগকারীদের মূলধন (Investor Contributions)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.investorCount} জন
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            বিনিয়োগকারীদের মূলধন সংযোজন বাবদ প্রাপ্ত নগদ
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-emerald-700">
                          {fmt(cashFlowData.investorContributions)}
                        </div>
                      </div>
                    </div>

                    {/* Total Cash In Summary Bar */}
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between font-bold text-sm">
                      <span className="text-emerald-950">সর্বমোট নগদ আগমন (Total Cash IN):</span>
                      <span className="font-mono text-emerald-700 text-base">+{fmt(cashFlowData.totalCashIn)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Cash OUT Section */}
                <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-800 flex items-center justify-center font-bold">
                        <ArrowUpRight className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900 text-sm sm:text-base">
                          নগদ বহির্গমন (Cash OUT - Grouped by Source)
                        </h4>
                        <p className="text-xs text-gray-500">খাত ভিত্তিক সমস্ত নগদ পরিশোধ</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold font-mono text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                      -{fmt(cashFlowData.totalCashOut)}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* 1. Purchases Paid */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-rose-200 hover:bg-rose-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>১. ক্রয় বাবদ পরিশোধ (Purchases Paid)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.cashPurchasesCount + cashFlowData.details.purchasePaymentsCount}টি লেনদেন
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            নগদ ক্রয় ও সরবরাহকারীদের বকেয়া কিস্তি পরিশোধ (PaymentRecords সহ)
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-rose-700">
                          {fmt(cashFlowData.purchasesPaid)}
                        </div>
                      </div>
                    </div>

                    {/* 2. Expenses Paid */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-rose-200 hover:bg-rose-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>২. খামার পরিচালন ও অন্যান্য ব্যয় (Expenses Paid)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.expenseTransactionsCount}টি ভাউচার/ইভেন্ট
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            খাদ্য, শ্রমিক মজুরি, বিদ্যুৎ, চিকিৎসা, ভ্যাকসিন ও অন্যান্য পরিচালন ব্যয়
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-rose-700">
                          {fmt(cashFlowData.expensesPaid)}
                        </div>
                      </div>
                    </div>

                    {/* 3. Loan Repayments */}
                    <div className="p-3.5 rounded-xl border border-gray-200 hover:border-rose-200 hover:bg-rose-50/20 transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-[13px] text-gray-900 flex items-center gap-1.5">
                            <span>৩. ঋণ পরিশোধ (Loan Repayments)</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-gray-100 text-gray-700">
                              {cashFlowData.details.loanRepaymentsCount}টি কিস্তি
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            গৃহীত ঋণের মূলধন ও সুদ পরিশোধ বাবদ নগদ প্রদান
                          </p>
                        </div>
                        <div className="text-sm sm:text-base font-bold font-mono text-rose-700">
                          {fmt(cashFlowData.loanRepayments)}
                        </div>
                      </div>
                    </div>

                    {/* Total Cash Out Summary Bar */}
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between font-bold text-sm">
                      <span className="text-rose-950">সর্বমোট নগদ বহির্গমন (Total Cash OUT):</span>
                      <span className="font-mono text-rose-700 text-base">-{fmt(cashFlowData.totalCashOut)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Formal Reconciliation & Verification with Active cashBankAccounts */}
              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                      <Scale className="w-4 h-4 text-[#1E5128]" />
                      <span>সমাপ্তি স্থিতি সমন্বয় ও হিসাবভিত্তিক বিভাজন (Cash Flow Reconciliation)</span>
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      প্রারম্ভিক স্থিতি + আগমন − বহির্গমন = সমাপ্তি স্থিতি (যা সক্রিয় cashBankAccounts এর সাথে সমান)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>সফলভাবে সমন্বিত (100% Balanced)</span>
                    </span>
                  </div>
                </div>

                {/* Mathematical Equation Flow Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 font-semibold border-b border-gray-200">
                        <th className="py-2.5 px-3">ধাপ / বিবরণ (Item)</th>
                        <th className="py-2.5 px-3">চিহ্ন</th>
                        <th className="py-2.5 px-3 text-right">পরিমাণ (Amount)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="py-2.5 px-3 font-medium text-gray-800">
                          প্রারম্ভিক নগদ ও ব্যাংক স্থিতি (Opening Balance at Start of Range)
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-500"></td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-gray-900">
                          {fmt(cashFlowData.openingBalance)}
                        </td>
                      </tr>
                      <tr className="bg-emerald-50/30">
                        <td className="py-2.5 px-3 font-medium text-emerald-950">
                          যোগ: মোট নগদ প্রাপ্তি (Add: Total Cash IN during Range)
                        </td>
                        <td className="py-2.5 px-3 font-mono text-emerald-600 font-bold">(+)</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                          {fmt(cashFlowData.totalCashIn)}
                        </td>
                      </tr>
                      <tr className="bg-rose-50/30">
                        <td className="py-2.5 px-3 font-medium text-rose-950">
                          বাদ: মোট নগদ প্রদান (Less: Total Cash OUT during Range)
                        </td>
                        <td className="py-2.5 px-3 font-mono text-rose-600 font-bold">(−)</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                          {fmt(cashFlowData.totalCashOut)}
                        </td>
                      </tr>
                      <tr className="bg-blue-50/30">
                        <td className="py-2.5 px-3 font-medium text-blue-950">
                          নিট নগদ প্রবাহ (Net Cash Flow for Selected Range)
                        </td>
                        <td className="py-2.5 px-3 font-mono text-blue-600 font-bold">(=)</td>
                        <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                          cashFlowData.netCashFlow >= 0 ? 'text-blue-700' : 'text-amber-700'
                        }`}>
                          {cashFlowData.netCashFlow >= 0 ? '+' : ''}{fmt(cashFlowData.netCashFlow)}
                        </td>
                      </tr>
                      <tr className="bg-[#1E5128]/10 font-bold text-gray-900 border-t-2 border-[#1E5128]/40">
                        <td className="py-3 px-3 text-[#1E5128] font-bold">
                          সমাপ্তি নগদ ও ব্যাংক স্থিতি (Resulting Closing Balance)
                        </td>
                        <td className="py-3 px-3 font-mono text-[#1E5128] font-bold">(=)</td>
                        <td className="py-3 px-3 text-right font-mono text-[#1E5128] font-extrabold text-base sm:text-lg">
                          {fmt(cashFlowData.closingBalance)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Active Accounts Breakdown Grid */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      সক্রিয় নগদ ও ব্যাংক হিসাবের বর্তমান স্থিতি (cashBankAccounts Breakdown)
                    </span>
                    <span className="text-[11px] text-gray-500 font-mono">
                      মোট হিসাব: {cashFlowData.accountsBreakdown.length}টি
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cashFlowData.accountsBreakdown.map((acc) => (
                      <div
                        key={acc.id}
                        id={`card-cashbank-acc-${acc.id}`}
                        className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            acc.accountType === 'CASH'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {acc.accountType === 'CASH' ? (
                              <Wallet className="w-4 h-4" />
                            ) : (
                              <Landmark className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-gray-900 block truncate">
                              {acc.name}
                            </span>
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider block">
                              {acc.accountType === 'CASH' ? 'নগদ ড্রয়ার' : 'ব্যাংক হিসাব'}
                            </span>
                          </div>
                        </div>
                        <div className="text-sm font-mono font-bold text-gray-900 text-right shrink-0">
                          {fmt(acc.balance)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      সক্রিয় নগদ ও ব্যাংক একাউন্টগুলোর মোট সমষ্টি <strong>{fmt(cashFlowData.closingBalance)}</strong>, যা নগদ প্রবাহ বিবরণীর সমাপ্তি স্থিতির সাথে হুবহু সমান।
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
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
