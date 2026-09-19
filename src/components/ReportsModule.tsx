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
  ArrowUpRight,
  GitCompare,
  Lock,
  Calendar,
  BookOpen,
  X,
  Activity,
  Fish,
  Sprout
} from 'lucide-react';
import {
  BalanceSheetReport,
  DateRangeFilter,
  generateBalanceSheet,
  generateProfitLoss,
  generateTrialBalance,
  getClosedPeriods,
  getGeneralLedger,
  LedgerEntry,
  ProfitLossReport,
  TrialBalance
} from '../accounting/accountingEngine';
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import { exportAllToExcel, createFullJsonBackup, restoreFromJsonBackup } from '../services/exportService';
import { db } from '../db/indexedDb';
import { UserRole, Sale, Purchase, PaymentRecord, Loan, Investor, CashBankAccount, JournalEntry, ClosedPeriod, Account, Animal, AnimalEvent, FishBatch, CropCycle } from '../types';
import { StatusBadge, Card, IconTile } from './ui';

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

export interface PondProfitabilityRow {
  id: string;
  pondId: string;
  pondName: string;
  species: string;
  status: string;
  stockingDate: string;
  harvestDate?: string;
  fingerlingQty: number;
  fingerlingCost: number;
  feedKg: number;
  feedCost: number;
  otherCost: number;
  totalCost: number;
  harvestWeightKg: number;
  totalRevenue: number;
  netProfit: number;
  profitMargin: number;
}

export interface CropProfitabilityRow {
  id: string;
  plotId: string;
  plotName: string;
  cropName: string;
  cropCategory: string;
  status: string;
  plantingDate: string;
  actualHarvestDate?: string;
  areaDecimals: number;
  seedCost: number;
  fertilizerCost: number;
  irrigationCost: number;
  labourCost: number;
  otherCost: number;
  totalCost: number;
  harvestYieldKg: number;
  totalRevenue: number;
  netProfit: number;
  profitMargin: number;
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

export interface VatSummaryReportData {
  totalOutputVat: number;
  totalInputVat: number;
  netVatPayable: number;
  totalSalesTaxable: number;
  totalPurchasesTaxable: number;
  salesWithVat: Sale[];
  purchasesWithVat: Purchase[];
}

export interface YoyMetric {
  thisYear: number;
  lastYear: number;
  diff: number;
  pctChange: number;
}

export interface YoyComparisonData {
  thisYearLabel: string;
  thisYearRange: { startDate: string; endDate: string };
  lastYearLabel: string;
  lastYearRange: { startDate: string; endDate: string };
  isLastYearClosed: boolean;
  closedPeriodRecord?: ClosedPeriod;
  thisYearPl: ProfitLossReport;
  lastYearPl: ProfitLossReport;
  metrics: {
    revenue: YoyMetric;
    cogs: YoyMetric;
    grossProfit: YoyMetric;
    operatingExpenses: YoyMetric;
    operatingProfit: YoyMetric;
    otherNet: YoyMetric;
    netProfit: YoyMetric;
  };
  expenseBreakdown: Array<{
    nameBn?: string;
    code?: string;
    category: string;
    thisYear: number;
    lastYear: number;
    diff: number;
    pctChange: number;
  }>;
}

export interface HerdKpiReportData {
  periodStartDate: string;
  periodEndDate: string;
  daysInPeriod: number;
  totalAnimalsEverOwned: number;
  activeAnimalsCount: number;
  soldAnimalsCount: number;
  deceasedAnimalsCount: number;
  otherStatusCount: number;
  totalMilkLiters: number;
  milkEventsCount: number;
  avgDailyMilkPerActiveAnimal: number;
  avgDailyMilkHerdTotal: number;
  totalFeedCost: number;
  feedEventsCount: number;
  feedCostPerLiter: number;
  deceasedInPeriodCount: number;
  mortalityRate: number;
  speciesBreakdown: Array<{
    species: string;
    total: number;
    active: number;
    sold: number;
    deceased: number;
    milkLiters: number;
    feedCost: number;
  }>;
  deceasedAnimals: Animal[];
}

type ReportType =
  | 'pl'
  | 'balanceSheet'
  | 'trialBalance'
  | 'ledger'
  | 'animalProfitability'
  | 'pondProfitability'
  | 'cropProfitability'
  | 'aging'
  | 'cashFlow'
  | 'backup'
  | 'vatSummary'
  | 'yoyComparison'
  | 'herdSummary';

export const ReportsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [activeReport, setActiveReport] = useState<ReportType>('pl');
  const [loading, setLoading] = useState(false);

  const [pl, setPl] = useState<ProfitLossReport | null>(null);
  const [bs, setBs] = useState<BalanceSheetReport | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);

  // Herd Summary KPI Report State
  const [herdKpiData, setHerdKpiData] = useState<HerdKpiReportData | null>(null);

  // General Ledger Report State
  const [reportAccounts, setReportAccounts] = useState<Account[]>([]);
  const [selectedLedgerAccountCode, setSelectedLedgerAccountCode] = useState<string>('1010');
  const [reportLedgerEntries, setReportLedgerEntries] = useState<LedgerEntry[]>([]);
  const [reportLedgerAccount, setReportLedgerAccount] = useState<Account | undefined>();
  const [reportLedgerNetBalance, setReportLedgerNetBalance] = useState<number>(0);
  const [reportLedgerSearchQuery, setReportLedgerSearchQuery] = useState<string>('');
  const [reportLedgerVisibleCount, setReportLedgerVisibleCount] = useState<number>(25);

  // Cash Flow Report State
  const [cashFlowData, setCashFlowData] = useState<CashFlowReportData | null>(null);

  // VAT Summary State (hidden by default unless toggled ON in Settings)
  const [isVatRegistered, setIsVatRegistered] = useState<boolean>(() => {
    return localStorage.getItem('goted_vat_registered') === 'true';
  });
  const [tinNumber, setTinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_tin_number') || '';
  });
  const [binNumber, setBinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_bin_number') || '';
  });
  const [vatData, setVatData] = useState<VatSummaryReportData | null>(null);

  // This Year vs Last Year Comparison State (using closedPeriods)
  const [closedPeriodsList, setClosedPeriodsList] = useState<ClosedPeriod[]>([]);
  const [comparisonMode, setComparisonMode] = useState<'calendar' | 'closed_period'>('calendar');
  const [selectedClosedPeriodId, setSelectedClosedPeriodId] = useState<string>('');
  const [yoyData, setYoyData] = useState<YoyComparisonData | null>(null);

  // Simple YOY Profit Bar Chart State (only shown once at least one prior year has been closed)
  const [yoyProfitBarData, setYoyProfitBarData] = useState<Array<{
    monthKey: string;
    monthName: string;
    thisYearProfit: number;
    lastYearProfit: number;
    diff: number;
    pctChange: number | null;
  }>>([]);
  const [yoyProfitBarSummary, setYoyProfitBarSummary] = useState<{
    thisYearYtd: number;
    lastYearYtd: number;
    diff: number;
    pctChange: number | null;
    thisYear: number;
    lastYear: number;
    monthsCount: number;
    latestClosedPeriod: ClosedPeriod | null;
  } | null>(null);

  useEffect(() => {
    const handleSettingsChanged = () => {
      const isReg = localStorage.getItem('goted_vat_registered') === 'true';
      setIsVatRegistered(isReg);
      setTinNumber(localStorage.getItem('goted_tin_number') || '');
      setBinNumber(localStorage.getItem('goted_bin_number') || '');
      if (!isReg && activeReport === 'vatSummary') {
        setActiveReport('pl');
      }
    };
    window.addEventListener('goted_settings_changed', handleSettingsChanged);
    window.addEventListener('storage', handleSettingsChanged);
    return () => {
      window.removeEventListener('goted_settings_changed', handleSettingsChanged);
      window.removeEventListener('storage', handleSettingsChanged);
    };
  }, [activeReport]);

  // Animal Profitability State
  const [animalRows, setAnimalRows] = useState<AnimalProfitabilityRow[]>([]);
  const [animalSortKey, setAnimalSortKey] = useState<'netProfit' | 'totalCost' | 'totalRevenue' | 'costPerDay'>('netProfit');
  const [animalSortDirection, setAnimalSortDirection] = useState<'desc' | 'asc'>('desc');
  const [animalStatusFilter, setAnimalStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SOLD'>('ALL');
  const [animalSearchQuery, setAnimalSearchQuery] = useState<string>('');

  // Pond Profitability State
  const [pondRows, setPondRows] = useState<PondProfitabilityRow[]>([]);
  const [pondSortKey, setPondSortKey] = useState<'netProfit' | 'totalCost' | 'totalRevenue' | 'harvestWeightKg'>('netProfit');
  const [pondSortDirection, setPondSortDirection] = useState<'desc' | 'asc'>('desc');
  const [pondSearchQuery, setPondSearchQuery] = useState<string>('');

  // Crop Profitability State
  const [cropRows, setCropRows] = useState<CropProfitabilityRow[]>([]);
  const [cropSortKey, setCropSortKey] = useState<'netProfit' | 'totalCost' | 'totalRevenue' | 'harvestYieldKg'>('netProfit');
  const [cropSortDirection, setCropSortDirection] = useState<'desc' | 'asc'>('desc');
  const [cropSearchQuery, setCropSearchQuery] = useState<string>('');

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
  }, [activeReport, startDate, endDate, comparisonMode, selectedClosedPeriodId]);

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

  const loadPondProfitability = async () => {
    const [allBatches, allSales] = await Promise.all([
      db.fishBatches.toArray(),
      db.sales.toArray()
    ]);

    const rows: PondProfitabilityRow[] = [];

    for (const b of allBatches) {
      const fingerlingCost = Number(b.fingerlingCost) || 0;
      const feedCost = Number(b.totalFeedCost) || 0;
      const otherCost = Number((b as any).otherCost || (b as any).otherCosts) || 0;
      const totalCost = fingerlingCost + feedCost + otherCost;

      // Check direct harvest revenue
      let totalRevenue = Number(b.harvestRevenue) || 0;

      // Check sales linked to this fish batch
      let linkedSalesRevenue = 0;
      for (const s of allSales) {
        if (s.items && s.items.length > 0) {
          for (const item of s.items) {
            if (item.itemId === b.id || (item.itemName && item.itemName.includes(b.id))) {
              linkedSalesRevenue += Number(item.lineTotal !== undefined ? item.lineTotal : (item.quantity * item.unitPrice)) || 0;
            }
          }
        }
      }

      if (linkedSalesRevenue > totalRevenue) {
        totalRevenue = linkedSalesRevenue;
      }

      // Only include batches that have actually been harvested/sold (i.e. have real revenue recorded).
      if (totalRevenue > 0) {
        const netProfit = totalRevenue - totalCost;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        rows.push({
          id: b.id,
          pondId: b.pondId || '',
          pondName: b.pondName || 'পুকুর',
          species: b.species || 'মাছ',
          status: b.status,
          stockingDate: b.stockingDate || '',
          harvestDate: b.harvestDate || '',
          fingerlingQty: Number(b.fingerlingQty) || 0,
          fingerlingCost,
          feedKg: Number(b.totalFeedKg) || 0,
          feedCost,
          otherCost,
          totalCost,
          harvestWeightKg: Number(b.harvestWeightKg) || 0,
          totalRevenue,
          netProfit,
          profitMargin
        });
      }
    }

    setPondRows(rows);
  };

  const loadCropProfitability = async () => {
    const [allCycles, allSales] = await Promise.all([
      db.cropCycles.toArray(),
      db.sales.toArray()
    ]);

    const rows: CropProfitabilityRow[] = [];

    for (const c of allCycles) {
      const seedCost = Number(c.seedCost) || 0;
      const fertilizerCost = Number(c.fertilizerCost) || 0;
      const irrigationCost = Number(c.irrigationCost) || 0;
      const labourCost = Number(c.labourCost) || 0;
      const otherCost = Number(c.otherCost) || 0;
      const costSum = seedCost + fertilizerCost + irrigationCost + labourCost + otherCost;
      const totalCost = costSum > 0 ? costSum : (Number(c.totalCost) || 0);

      // Check direct harvest revenue
      let totalRevenue = Number(c.harvestRevenue) || 0;

      // Check sales linked to this crop cycle
      let linkedSalesRevenue = 0;
      for (const s of allSales) {
        if (s.items && s.items.length > 0) {
          for (const item of s.items) {
            if (item.itemId === c.id || (item.itemName && item.itemName.includes(c.id))) {
              linkedSalesRevenue += Number(item.lineTotal !== undefined ? item.lineTotal : (item.quantity * item.unitPrice)) || 0;
            }
          }
        }
      }

      if (linkedSalesRevenue > totalRevenue) {
        totalRevenue = linkedSalesRevenue;
      }

      // Only include crop cycles that have actually been harvested/sold (i.e. have real revenue recorded).
      if (totalRevenue > 0) {
        const netProfit = totalRevenue - totalCost;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        rows.push({
          id: c.id,
          plotId: c.plotId || '',
          plotName: c.plotName || 'জমি/প্লট',
          cropName: c.cropName || 'ফসল',
          cropCategory: c.cropCategory || 'OTHER',
          status: c.status,
          plantingDate: c.plantingDate || '',
          actualHarvestDate: c.actualHarvestDate || c.expectedHarvestDate || '',
          areaDecimals: Number(c.areaDecimals) || 0,
          seedCost,
          fertilizerCost,
          irrigationCost,
          labourCost,
          otherCost,
          totalCost,
          harvestYieldKg: Number(c.harvestYieldKg) || 0,
          totalRevenue,
          netProfit,
          profitMargin
        });
      }
    }

    setCropRows(rows);
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

  const loadVatSummary = async () => {
    const [allSales, allPurchases] = await Promise.all([
      db.sales.toArray(),
      db.purchases.toArray()
    ]);

    const inRangeSales = allSales.filter((s) => {
      if (startDate && s.date < startDate) return false;
      if (endDate && s.date > endDate) return false;
      return true;
    });

    const inRangePurchases = allPurchases.filter((p) => {
      if (startDate && p.date < startDate) return false;
      if (endDate && p.date > endDate) return false;
      return true;
    });

    let totalOutputVat = 0;
    let totalSalesTaxable = 0;
    const salesWithVat: Sale[] = [];

    for (const s of inRangeSales) {
      const v = Number(s.taxVat || s.vat || s.vatTax || 0);
      if (v > 0) {
        totalOutputVat += v;
        salesWithVat.push(s);
      }
      totalSalesTaxable += Number(s.grandTotal || s.totalAmount || s.subtotal || 0);
    }

    let totalInputVat = 0;
    let totalPurchasesTaxable = 0;
    const purchasesWithVat: Purchase[] = [];

    for (const p of inRangePurchases) {
      const v = Number(p.taxVat || p.vat || p.vatTax || 0);
      if (v > 0) {
        totalInputVat += v;
        purchasesWithVat.push(p);
      }
      totalPurchasesTaxable += Number(p.grandTotal || p.totalAmount || p.subtotal || 0);
    }

    totalOutputVat = Math.round(totalOutputVat * 100) / 100;
    totalInputVat = Math.round(totalInputVat * 100) / 100;
    const netVatPayable = Math.round((totalOutputVat - totalInputVat) * 100) / 100;

    setVatData({
      totalOutputVat,
      totalInputVat,
      netVatPayable,
      totalSalesTaxable: Math.round(totalSalesTaxable * 100) / 100,
      totalPurchasesTaxable: Math.round(totalPurchasesTaxable * 100) / 100,
      salesWithVat,
      purchasesWithVat
    });
  };

  const calcMetric = (thisVal: number, lastVal: number): YoyMetric => {
    const diff = Math.round((thisVal - lastVal) * 100) / 100;
    let pctChange = 0;
    if (lastVal !== 0) {
      pctChange = Math.round(((thisVal - lastVal) / Math.abs(lastVal)) * 1000) / 10;
    } else if (thisVal !== 0) {
      pctChange = 100;
    }
    return { thisYear: thisVal, lastYear: lastVal, diff, pctChange };
  };

  const loadYoyComparison = async () => {
    const periods = await getClosedPeriods();
    setClosedPeriodsList(periods);

    const now = new Date();
    const currentCalYear = now.getFullYear();
    const lastCalYear = currentCalYear - 1;

    let thisYearLabel = `চলতি বছর (${currentCalYear})`;
    let thisYearRange = { startDate: `${currentCalYear}-01-01`, endDate: `${currentCalYear}-12-31` };
    let lastYearLabel = `বিগত বছর (${lastCalYear})`;
    let lastYearRange = { startDate: `${lastCalYear}-01-01`, endDate: `${lastCalYear}-12-31` };
    let isLastYearClosed = false;
    let closedPeriodRecord: ClosedPeriod | undefined = undefined;

    if (comparisonMode === 'closed_period' && periods.length > 0) {
      const selected = periods.find((p) => p.id === selectedClosedPeriodId) || periods[0];
      closedPeriodRecord = selected;
      isLastYearClosed = true;
      lastYearLabel = `সমাপ্ত হিসাবকাল (${selected.endDate} পর্যন্ত)`;

      // Look for previous closed period to determine start date
      const sorted = [...periods].sort((a, b) => b.endDate.localeCompare(a.endDate));
      const idx = sorted.findIndex((p) => p.id === selected.id);
      const prevClosed = idx >= 0 && idx + 1 < sorted.length ? sorted[idx + 1] : null;

      const lastStart = prevClosed
        ? new Date(new Date(prevClosed.endDate).getTime() + 86400000).toISOString().split('T')[0]
        : `${selected.endDate.substring(0, 4)}-01-01`;

      lastYearRange = { startDate: lastStart, endDate: selected.endDate };

      // This year is the ongoing period following this closed period up to today
      const thisStart = new Date(new Date(selected.endDate).getTime() + 86400000).toISOString().split('T')[0];
      thisYearRange = { startDate: thisStart, endDate: formatYMD(now) };
      thisYearLabel = `সমাপ্তির পরবর্তী চলতি সময়কাল (${thisStart} হতে)`;
    } else {
      // Calendar year mode: check if last calendar year is closed
      const matchingClosed = periods.find((p) => p.endDate >= `${lastCalYear}-12-31`);
      if (matchingClosed) {
        isLastYearClosed = true;
        closedPeriodRecord = matchingClosed;
      }
    }

    const [thisPl, lastPl] = await Promise.all([
      generateProfitLoss(thisYearRange),
      generateProfitLoss(lastYearRange)
    ]);

    // Build expense category breakdown from operatingExpenses array
    const catMap = new Map<string, { nameBn: string; code: string; thisYear: number; lastYear: number }>();

    for (const exp of thisPl.operatingExpenses) {
      catMap.set(exp.code, {
        code: exp.code,
        nameBn: exp.nameBn,
        thisYear: exp.amount,
        lastYear: 0
      });
    }

    for (const exp of lastPl.operatingExpenses) {
      const existing = catMap.get(exp.code);
      if (existing) {
        existing.lastYear = exp.amount;
      } else {
        catMap.set(exp.code, {
          code: exp.code,
          nameBn: exp.nameBn,
          thisYear: 0,
          lastYear: exp.amount
        });
      }
    }

    const expenseBreakdown = Array.from(catMap.values()).map((item) => {
      const diff = Math.round((item.thisYear - item.lastYear) * 100) / 100;
      let pctChange = 0;
      if (item.lastYear !== 0) {
        pctChange = Math.round(((item.thisYear - item.lastYear) / Math.abs(item.lastYear)) * 1000) / 10;
      } else if (item.thisYear !== 0) {
        pctChange = 100;
      }
      return {
        nameBn: item.nameBn,
        code: item.code,
        category: `${item.nameBn} (${item.code})`,
        thisYear: item.thisYear,
        lastYear: item.lastYear,
        diff,
        pctChange
      };
    });

    setYoyData({
      thisYearLabel,
      thisYearRange,
      lastYearLabel,
      lastYearRange,
      isLastYearClosed,
      closedPeriodRecord,
      thisYearPl: thisPl,
      lastYearPl: lastPl,
      metrics: {
        revenue: calcMetric(thisPl.totalRevenue, lastPl.totalRevenue),
        cogs: calcMetric(thisPl.totalCogs, lastPl.totalCogs),
        grossProfit: calcMetric(thisPl.grossProfit, lastPl.grossProfit),
        operatingExpenses: calcMetric(thisPl.totalOperatingExpenses, lastPl.totalOperatingExpenses),
        operatingProfit: calcMetric(thisPl.operatingProfit, lastPl.operatingProfit),
        otherNet: calcMetric(
          (thisPl.totalOtherIncome || 0) - (thisPl.totalOtherExpenses || 0),
          (lastPl.totalOtherIncome || 0) - (lastPl.totalOtherExpenses || 0)
        ),
        netProfit: calcMetric(thisPl.netProfit, lastPl.netProfit)
      },
      expenseBreakdown
    });
  };

  const loadLedgerReport = async (accountCode?: string) => {
    const code = accountCode || selectedLedgerAccountCode || '1010';
    setSelectedLedgerAccountCode(code);
    setReportLedgerVisibleCount(25);

    let accs = reportAccounts;
    if (accs.length === 0) {
      accs = await db.accounts.orderBy('code').toArray();
      setReportAccounts(accs);
    }

    const res = await getGeneralLedger(code);
    setReportLedgerAccount(res.account);

    let entries = res.entries;
    if (startDate || endDate) {
      entries = entries.filter((e) => {
        if (startDate && e.date < startDate) return false;
        if (endDate && e.date > endDate) return false;
        return true;
      });
    }

    setReportLedgerEntries(entries);
    setReportLedgerNetBalance(res.netBalance);
  };

  const loadReports = async () => {
    setLoading(true);
    try {
      const periods = await getClosedPeriods();
      setClosedPeriodsList(periods);
      if (periods.length > 0) {
        await loadYoyProfitBarChart(periods);
      } else {
        setYoyProfitBarData([]);
        setYoyProfitBarSummary(null);
      }

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
      } else if (activeReport === 'ledger') {
        await loadLedgerReport();
      } else if (activeReport === 'animalProfitability') {
        await loadAnimalProfitability();
      } else if (activeReport === 'pondProfitability') {
        await loadPondProfitability();
      } else if (activeReport === 'cropProfitability') {
        await loadCropProfitability();
      } else if (activeReport === 'aging') {
        await loadAgingReport();
      } else if (activeReport === 'cashFlow') {
        await loadCashFlowReport();
      } else if (activeReport === 'vatSummary') {
        await loadVatSummary();
      } else if (activeReport === 'yoyComparison') {
        await loadYoyComparison();
      } else if (activeReport === 'herdSummary') {
        await loadHerdSummaryReport();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadYoyProfitBarChart = async (periods: ClosedPeriod[]) => {
    if (!periods || periods.length === 0) {
      setYoyProfitBarData([]);
      setYoyProfitBarSummary(null);
      return;
    }

    try {
      const now = new Date();
      const thisYear = now.getFullYear();
      const lastYear = thisYear - 1;
      const currentMonthIdx = now.getMonth(); // 0 to 11

      const monthNamesBn = [
        'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
      ];
      const monthShortBn = [
        'জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'
      ];

      const barItems: Array<{
        monthKey: string;
        monthName: string;
        thisYearProfit: number;
        lastYearProfit: number;
        diff: number;
        pctChange: number | null;
      }> = [];

      let thisYearYtd = 0;
      let lastYearYtd = 0;

      for (let m = 0; m <= currentMonthIdx; m++) {
        const monthStr = String(m + 1).padStart(2, '0');
        const daysThis = new Date(thisYear, m + 1, 0).getDate();
        const daysLast = new Date(lastYear, m + 1, 0).getDate();

        const dayThis = m === currentMonthIdx ? Math.min(now.getDate(), daysThis) : daysThis;
        const dayLast = m === currentMonthIdx ? Math.min(now.getDate(), daysLast) : daysLast;

        const thisStartDate = `${thisYear}-${monthStr}-01`;
        const thisEndDate = `${thisYear}-${monthStr}-${String(dayThis).padStart(2, '0')}`;
        const lastStartDate = `${lastYear}-${monthStr}-01`;
        const lastEndDate = `${lastYear}-${monthStr}-${String(dayLast).padStart(2, '0')}`;

        const [thisReport, lastReport] = await Promise.all([
          generateProfitLoss({ startDate: thisStartDate, endDate: thisEndDate }),
          generateProfitLoss({ startDate: lastStartDate, endDate: lastEndDate })
        ]);

        const thisVal = Math.round(thisReport.netProfit);
        const lastVal = Math.round(lastReport.netProfit);
        thisYearYtd += thisVal;
        lastYearYtd += lastVal;

        const diff = thisVal - lastVal;
        let pctChange: number | null = null;
        if (lastVal !== 0) {
          pctChange = Math.round(((thisVal - lastVal) / Math.abs(lastVal)) * 100);
        }

        barItems.push({
          monthKey: monthShortBn[m],
          monthName: `${monthNamesBn[m]} (${thisYear})`,
          thisYearProfit: thisVal,
          lastYearProfit: lastVal,
          diff,
          pctChange
        });
      }

      const diff = thisYearYtd - lastYearYtd;
      let pctChange: number | null = null;
      if (lastYearYtd !== 0) {
        pctChange = Math.round(((thisYearYtd - lastYearYtd) / Math.abs(lastYearYtd)) * 100);
      }

      const sortedPeriods = [...periods].sort((a, b) => b.endDate.localeCompare(a.endDate));

      setYoyProfitBarSummary({
        thisYearYtd,
        lastYearYtd,
        diff,
        pctChange,
        thisYear,
        lastYear,
        monthsCount: currentMonthIdx + 1,
        latestClosedPeriod: sortedPeriods[0] || null
      });
      setYoyProfitBarData(barItems);
    } catch (err) {
      console.error('Error calculating YOY profit bar chart data:', err);
    }
  };

  const loadHerdSummaryReport = async () => {
    const [allAnimals, allEvents] = await Promise.all([
      db.animals.toArray(),
      db.animalEvents.toArray()
    ]);

    const isWithinRange = (dateStr?: string) => {
      if (!dateStr) return false;
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;
      return true;
    };

    let daysInPeriod = 30;
    if (startDate && endDate) {
      const s = new Date(startDate).getTime();
      const e = new Date(endDate).getTime();
      if (!isNaN(s) && !isNaN(e) && e >= s) {
        daysInPeriod = Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
      }
    }

    const totalAnimalsEverOwned = allAnimals.length;
    const activeAnimals = allAnimals.filter((a) => a.status === 'ACTIVE');
    const activeAnimalsCount = activeAnimals.length;
    const soldAnimalsCount = allAnimals.filter((a) => a.status === 'SOLD').length;
    const totalDeceasedCount = allAnimals.filter((a) => a.status === 'DECEASED').length;
    const otherStatusCount = allAnimals.filter(
      (a) => a.status !== 'ACTIVE' && a.status !== 'SOLD' && a.status !== 'DECEASED'
    ).length;

    // 1. Milk yield in period across all active animals
    const milkEventsInRange = allEvents.filter(
      (ev) => ev.eventType === 'MILK' && isWithinRange(ev.date)
    );
    const totalMilkLiters =
      Math.round(
        milkEventsInRange.reduce((acc, ev) => acc + (Number(ev.milkLiters) || 0), 0) * 100
      ) / 100;
    const milkEventsCount = milkEventsInRange.length;

    const avgDailyMilkHerdTotal =
      daysInPeriod > 0 ? Math.round((totalMilkLiters / daysInPeriod) * 100) / 100 : 0;
    const avgDailyMilkPerActiveAnimal =
      daysInPeriod > 0 && activeAnimalsCount > 0
        ? Math.round((totalMilkLiters / (daysInPeriod * activeAnimalsCount)) * 100) / 100
        : 0;

    // 2. Feed cost in period
    const feedEventsInRange = allEvents.filter(
      (ev) => ev.eventType === 'FEED' && isWithinRange(ev.date)
    );
    let totalFeedCost =
      Math.round(feedEventsInRange.reduce((acc, ev) => acc + (Number(ev.cost) || 0), 0) * 100) / 100;

    // Fallback: check stockMovements if feed events had 0 cost recorded
    if (totalFeedCost === 0) {
      const stockMovements = await db.stockMovements.toArray();
      const inRangeFeedConsumptions = stockMovements.filter(
        (sm) => sm.movementType === 'CONSUMPTION' && isWithinRange(sm.date)
      );
      if (inRangeFeedConsumptions.length > 0) {
        totalFeedCost =
          Math.round(
            inRangeFeedConsumptions.reduce((acc, sm) => acc + (Number(sm.totalValue) || 0), 0) * 100
          ) / 100;
      }
    }

    // Feed-cost-per-liter = total feed cost / total milk liters
    const feedCostPerLiter =
      totalMilkLiters > 0 ? Math.round((totalFeedCost / totalMilkLiters) * 100) / 100 : 0;

    // 3. Mortality rate = (deceased ÷ total animals ever owned) for selected period
    const deceasedInPeriod = allAnimals.filter((a) => {
      if (a.status !== 'DECEASED') return false;
      if (a.saleDate && isWithinRange(String(a.saleDate))) return true;
      if (allEvents.some((ev) => ev.animalId === a.id && ev.eventType === 'MORTALITY' && isWithinRange(ev.date))) {
        return true;
      }
      if (!startDate && !endDate) return true;
      return false;
    });

    const deceasedInPeriodCount = deceasedInPeriod.length;
    const mortalityRate =
      totalAnimalsEverOwned > 0
        ? Math.round((deceasedInPeriodCount / totalAnimalsEverOwned) * 1000) / 10
        : 0;

    // Species breakdown
    const speciesMap = new Map<
      string,
      { total: number; active: number; sold: number; deceased: number; milkLiters: number; feedCost: number }
    >();
    for (const a of allAnimals) {
      const sp = a.species || 'OTHER';
      if (!speciesMap.has(sp)) {
        speciesMap.set(sp, { total: 0, active: 0, sold: 0, deceased: 0, milkLiters: 0, feedCost: 0 });
      }
      const item = speciesMap.get(sp)!;
      item.total++;
      if (a.status === 'ACTIVE') item.active++;
      else if (a.status === 'SOLD') item.sold++;
      else if (a.status === 'DECEASED') item.deceased++;
    }

    for (const ev of milkEventsInRange) {
      const a = allAnimals.find((anim) => anim.id === ev.animalId);
      const sp = a?.species || 'OTHER';
      const item = speciesMap.get(sp);
      if (item) {
        item.milkLiters += Number(ev.milkLiters) || 0;
      }
    }

    for (const ev of feedEventsInRange) {
      const a = allAnimals.find((anim) => anim.id === ev.animalId);
      const sp = a?.species || 'OTHER';
      const item = speciesMap.get(sp);
      if (item) {
        item.feedCost += Number(ev.cost) || 0;
      }
    }

    const speciesBreakdown = Array.from(speciesMap.entries()).map(([species, stats]) => ({
      species,
      total: stats.total,
      active: stats.active,
      sold: stats.sold,
      deceased: stats.deceased,
      milkLiters: Math.round(stats.milkLiters * 100) / 100,
      feedCost: Math.round(stats.feedCost * 100) / 100
    }));

    setHerdKpiData({
      periodStartDate: startDate,
      periodEndDate: endDate,
      daysInPeriod,
      totalAnimalsEverOwned,
      activeAnimalsCount,
      soldAnimalsCount,
      deceasedAnimalsCount: totalDeceasedCount,
      otherStatusCount,
      totalMilkLiters,
      milkEventsCount,
      avgDailyMilkPerActiveAnimal,
      avgDailyMilkHerdTotal,
      totalFeedCost,
      feedEventsCount: feedEventsInRange.length,
      feedCostPerLiter,
      deceasedInPeriodCount,
      mortalityRate,
      speciesBreakdown,
      deceasedAnimals: deceasedInPeriod
    });
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

  const togglePondSort = (key: 'netProfit' | 'totalCost' | 'totalRevenue' | 'harvestWeightKg') => {
    if (pondSortKey === key) {
      setPondSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setPondSortKey(key);
      setPondSortDirection('desc');
    }
  };

  const sortedPondRows = useMemo(() => {
    let result = [...pondRows];

    if (pondSearchQuery.trim()) {
      const q = pondSearchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.pondName.toLowerCase().includes(q) ||
          r.species.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const valA = a[pondSortKey];
      const valB = b[pondSortKey];
      return pondSortDirection === 'desc' ? valB - valA : valA - valB;
    });

    return result;
  }, [pondRows, pondSearchQuery, pondSortKey, pondSortDirection]);

  const pondSummary = useMemo(() => {
    const totalBatches = pondRows.length;
    const totalPondCost = pondRows.reduce((acc, r) => acc + r.totalCost, 0);
    const totalPondRevenue = pondRows.reduce((acc, r) => acc + r.totalRevenue, 0);
    const totalPondProfit = totalPondRevenue - totalPondCost;
    const totalHarvestWeight = pondRows.reduce((acc, r) => acc + r.harvestWeightKg, 0);
    const avgProfit = totalBatches > 0 ? totalPondProfit / totalBatches : 0;

    return {
      totalBatches,
      totalPondCost,
      totalPondRevenue,
      totalPondProfit,
      totalHarvestWeight,
      avgProfit
    };
  }, [pondRows]);

  const toggleCropSort = (key: 'netProfit' | 'totalCost' | 'totalRevenue' | 'harvestYieldKg') => {
    if (cropSortKey === key) {
      setCropSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setCropSortKey(key);
      setCropSortDirection('desc');
    }
  };

  const sortedCropRows = useMemo(() => {
    let result = [...cropRows];

    if (cropSearchQuery.trim()) {
      const q = cropSearchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.plotName.toLowerCase().includes(q) ||
          r.cropName.toLowerCase().includes(q) ||
          r.cropCategory.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const valA = a[cropSortKey];
      const valB = b[cropSortKey];
      return cropSortDirection === 'desc' ? valB - valA : valA - valB;
    });

    return result;
  }, [cropRows, cropSearchQuery, cropSortKey, cropSortDirection]);

  const cropSummary = useMemo(() => {
    const totalCycles = cropRows.length;
    const totalCropCost = cropRows.reduce((acc, r) => acc + r.totalCost, 0);
    const totalCropRevenue = cropRows.reduce((acc, r) => acc + r.totalRevenue, 0);
    const totalCropProfit = totalCropRevenue - totalCropCost;
    const totalHarvestYield = cropRows.reduce((acc, r) => acc + r.harvestYieldKg, 0);
    const avgProfit = totalCycles > 0 ? totalCropProfit / totalCycles : 0;

    return {
      totalCycles,
      totalCropCost,
      totalCropRevenue,
      totalCropProfit,
      totalHarvestYield,
      avgProfit
    };
  }, [cropRows]);

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
        status: 'overdue' as const, // danger
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
        status: 'due-soon' as const, // warning
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
        status: 'due-soon' as const, // warning
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
        status: 'info' as const, // info
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

  const renderYoyProfitBarChart = () => {
    if (closedPeriodsList.length === 0 || !yoyProfitBarSummary) return null;

    return (
      <div
        id="yoy-profit-bar-chart-card"
        className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
                <Lock className="w-4 h-4" />
              </span>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                চলতি বছরের মুনাফা বনাম বিগত বছরের সমসাময়িক তুলনা (YTD Profit vs Prior Year)
              </h3>
            </div>
            <p className="text-xs sm:text-[13px] text-gray-600 mt-1">
              সমাপ্ত হিসাবকালের (Closed Periods) তথ্যের ভিত্তিতে চলতি বছরের আজ পর্যন্ত মুনাফা ও বিগত বছরের একই মাসসমূহের নিট লাভের বার চার্ট
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-900 border border-purple-200 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>সমাপ্ত হিসাবকাল: {closedPeriodsList.length}টি বছর সমাপ্ত</span>
            </span>
            {yoyProfitBarSummary.latestClosedPeriod && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                সর্বশেষ সমাপ্তি: {yoyProfitBarSummary.latestClosedPeriod.endDate}
              </span>
            )}
          </div>
        </div>

        {/* 3 Summary metric cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
            <div className="text-xs font-bold text-emerald-900 flex items-center justify-between">
              <span>চলতি বছর ({yoyProfitBarSummary.thisYear}) আজ পর্যন্ত</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-mono">
                ১ম-{yoyProfitBarSummary.monthsCount} মাস
              </span>
            </div>
            <div className={`text-xl font-extrabold font-mono ${
              yoyProfitBarSummary.thisYearYtd >= 0 ? 'text-[#15803D]' : 'text-red-600'
            }`}>
              {fmt(yoyProfitBarSummary.thisYearYtd)}
            </div>
            <div className="text-[11px] text-emerald-800">মোট অর্জিত মুনাফা (Profit-so-far)</div>
          </div>

          <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 space-y-1">
            <div className="text-xs font-bold text-purple-900 flex items-center justify-between">
              <span>বিগত বছর ({yoyProfitBarSummary.lastYear}) একই সময়কাল</span>
              <span className="px-1.5 py-0.5 rounded bg-purple-200 text-purple-900 text-[10px] font-mono">
                সমাপ্ত হিসাবকাল
              </span>
            </div>
            <div className={`text-xl font-extrabold font-mono ${
              yoyProfitBarSummary.lastYearYtd >= 0 ? 'text-purple-800' : 'text-red-600'
            }`}>
              {fmt(yoyProfitBarSummary.lastYearYtd)}
            </div>
            <div className="text-[11px] text-purple-800">বিগত সমাপ্ত বছরে একই মাসসমূহের নিট লাভ</div>
          </div>

          <div className={`p-3.5 rounded-xl border space-y-1 ${
            yoyProfitBarSummary.diff >= 0 ? 'bg-blue-50/70 border-blue-200 text-blue-950' : 'bg-rose-50/70 border-rose-200 text-rose-950'
          }`}>
            <div className="text-xs font-bold flex items-center justify-between">
              <span>পার্থক্য / প্রবৃদ্ধি (Variance)</span>
              {yoyProfitBarSummary.pctChange !== null && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                  yoyProfitBarSummary.diff >= 0 ? 'bg-blue-100 text-blue-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {yoyProfitBarSummary.diff >= 0 ? '+' : ''}{yoyProfitBarSummary.pctChange}%
                </span>
              )}
            </div>
            <div className={`text-xl font-extrabold font-mono ${
              yoyProfitBarSummary.diff >= 0 ? 'text-blue-700' : 'text-rose-700'
            }`}>
              {yoyProfitBarSummary.diff >= 0 ? '+' : ''}{fmt(yoyProfitBarSummary.diff)}
            </div>
            <div className="text-[11px] text-gray-600">
              {yoyProfitBarSummary.diff >= 0 ? 'বিগত বছরের চেয়ে মুনাফা বৃদ্ধি পেয়েছে' : 'বিগত বছরের চেয়ে মুনাফা হ্রাস পেয়েছে'}
            </div>
          </div>
        </div>

        {/* Recharts Bar Chart */}
        <div className="w-full pt-2">
          <div className="h-64 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart
                data={yoyProfitBarData}
                margin={{ top: 15, right: 15, left: -5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis
                  dataKey="monthKey"
                  tick={{ fontSize: 12, fill: '#475569', fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#CBD5E1',
                    borderRadius: '0.75rem',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }}
                  formatter={(val: any, name: any) => [`৳${Number(val || 0).toLocaleString('en-IN')}`, name]}
                  labelFormatter={(label) => {
                    const item = yoyProfitBarData.find((d) => d.monthKey === label);
                    return item ? item.monthName : `মাস: ${label}`;
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ paddingBottom: '10px', fontSize: '12px', fontWeight: 600 }}
                />
                <Bar
                  dataKey="thisYearProfit"
                  name={`চলতি বছর (${yoyProfitBarSummary.thisYear})`}
                  fill="#15803D"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="lastYearProfit"
                  name={`বিগত বছর (${yoyProfitBarSummary.lastYear} সমাপ্ত)`}
                  fill="#7C3AED"
                  radius={[4, 4, 0, 0]}
                />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between text-[11px] text-gray-500 pt-2 px-1">
            <span>* গ্রাফে চলতি বছরের মাসসমূহের সাথে বিগত সমাপ্ত হিসাবকালের একই মাসসমূহের নিট মুনাফা পাশাপাশি প্রদর্শিত হয়েছে।</span>
            <span className="font-mono font-semibold text-gray-700">১ম হতে {yoyProfitBarSummary.monthsCount}ম মাস</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto rounded-3xl p-2 sm:p-4 bg-gradient-to-b from-teal-500/[0.08] via-teal-500/[0.03] to-transparent dark:from-teal-950/30 dark:via-teal-950/10 dark:to-transparent">
      {/* Module Header Illustration */}
      <div
        className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
        }}
      >
        <img
          src="/illustrations/Revenue-bro.svg"
          alt="Reports & Revenue illustration"
          loading="lazy"
          className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
        />
      </div>

      {/* Header & Report Selectors */}
      <div className="flex flex-col gap-3.5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-teal-700" />
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
              className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-[13px] font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer min-h-[42px]"
            >
              <Download className="w-4 h-4" />
              <span>{isExporting ? 'এক্সপোর্ট হচ্ছে...' : 'Excel এক্সপোর্ট (.xlsx)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Report Switcher Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 bg-teal-50/50 dark:bg-slate-800/80 border border-teal-100 dark:border-slate-700 p-2 rounded-xl text-[13px] font-semibold">
        <button
          type="button"
          onClick={() => setActiveReport('pl')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'pl'
              ? 'bg-emerald-700 text-white shadow-xs border border-emerald-700'
              : 'bg-white dark:bg-slate-900/60 text-emerald-950 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 hover:bg-emerald-100/80'
          }`}
        >
          <PieChart className="w-4 h-4 shrink-0" />
          <span>লাভ-ক্ষতি (P&L)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('balanceSheet')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'balanceSheet'
              ? 'bg-blue-700 text-white shadow-xs border border-blue-700'
              : 'bg-white dark:bg-slate-900/60 text-blue-950 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800 hover:bg-blue-100/80'
          }`}
        >
          <Scale className="w-4 h-4 shrink-0" />
          <span>উদ্বৃত্তপত্র</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('trialBalance')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'trialBalance'
              ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
              : 'bg-white dark:bg-slate-900/60 text-amber-950 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800 hover:bg-amber-100/80'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span>রেওয়ামিল অডিট</span>
        </button>

        <button
          type="button"
          id="tab-ledger-report"
          onClick={() => {
            setActiveReport('ledger');
            loadLedgerReport(selectedLedgerAccountCode);
          }}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'ledger'
              ? 'bg-indigo-700 text-white shadow-xs border border-indigo-700'
              : 'bg-white dark:bg-slate-900/60 text-indigo-950 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 hover:bg-indigo-100/80'
          }`}
        >
          <BookOpen className="w-4 h-4 shrink-0" />
          <span>খতিয়ান বহি</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveReport('animalProfitability')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'animalProfitability'
              ? 'bg-teal-700 text-white shadow-xs border border-teal-700'
              : 'bg-white dark:bg-slate-900/60 text-teal-950 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800 hover:bg-teal-100/80'
          }`}
        >
          <TrendingUp className="w-4 h-4 shrink-0" />
          <span>পশুভিত্তিক লাভ-ক্ষতি</span>
        </button>

        <button
          type="button"
          id="tab-pond-profitability"
          onClick={() => setActiveReport('pondProfitability')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'pondProfitability'
              ? 'bg-blue-700 text-white shadow-xs border border-blue-700'
              : 'bg-white dark:bg-slate-900/60 text-blue-950 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800 hover:bg-blue-100/80'
          }`}
        >
          <Fish className="w-4 h-4 shrink-0" />
          <span>পুকুর লাভ-ক্ষতি</span>
        </button>

        <button
          type="button"
          id="tab-crop-profitability"
          onClick={() => setActiveReport('cropProfitability')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'cropProfitability'
              ? 'bg-emerald-700 text-white shadow-xs border border-emerald-700'
              : 'bg-white dark:bg-slate-900/60 text-emerald-950 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 hover:bg-emerald-100/80'
          }`}
        >
          <Sprout className="w-4 h-4 shrink-0" />
          <span>ফসল লাভ-ক্ষতি</span>
        </button>

        <button
          type="button"
          id="tab-herd-summary"
          onClick={() => setActiveReport('herdSummary')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'herdSummary'
              ? 'bg-cyan-700 text-white shadow-xs border border-cyan-700'
              : 'bg-white dark:bg-slate-900/60 text-cyan-950 dark:text-cyan-300 border border-cyan-200/80 dark:border-cyan-800 hover:bg-cyan-100/80'
          }`}
        >
          <Activity className="w-4 h-4 shrink-0" />
          <span>পালের সারসংক্ষেপ</span>
        </button>

        <button
          type="button"
          id="tab-aging-report"
          onClick={() => setActiveReport('aging')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'aging'
              ? 'bg-rose-700 text-white shadow-xs border border-rose-700'
              : 'bg-white dark:bg-slate-900/60 text-rose-950 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800 hover:bg-rose-100/80'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span>পাওনা-দেনার হিসাব</span>
        </button>

        <button
          type="button"
          id="tab-cash-flow"
          onClick={() => setActiveReport('cashFlow')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'cashFlow'
              ? 'bg-violet-700 text-white shadow-xs border border-violet-700'
              : 'bg-white dark:bg-slate-900/60 text-violet-950 dark:text-violet-300 border border-violet-200/80 dark:border-violet-800 hover:bg-violet-100/80'
          }`}
        >
          <Coins className="w-4 h-4 shrink-0" />
          <span>নগদ প্রবাহ</span>
        </button>

        {isVatRegistered && (
          <button
            type="button"
            id="tab-vat-summary"
            onClick={() => setActiveReport('vatSummary')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              activeReport === 'vatSummary'
                ? 'bg-orange-700 text-white shadow-xs border border-orange-700'
                : 'bg-white dark:bg-slate-900/60 text-orange-950 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800 hover:bg-orange-100/80'
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>ভ্যাট সারাংশ</span>
          </button>
        )}

        <button
          type="button"
          id="tab-yoy-comparison"
          onClick={() => setActiveReport('yoyComparison')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'yoyComparison'
              ? 'bg-fuchsia-700 text-white shadow-xs border border-fuchsia-700'
              : 'bg-white dark:bg-slate-900/60 text-fuchsia-950 dark:text-fuchsia-300 border border-fuchsia-200/80 dark:border-fuchsia-800 hover:bg-fuchsia-100/80'
          }`}
        >
          <GitCompare className="w-4 h-4 shrink-0" />
          <span>বার্ষিক তুলনা</span>
        </button>

        <button
          type="button"
          id="tab-backup-restore"
          onClick={() => setActiveReport('backup')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
            activeReport === 'backup'
              ? 'bg-slate-700 text-white shadow-xs border border-slate-700'
              : 'bg-white dark:bg-slate-900/60 text-slate-950 dark:text-slate-300 border border-slate-200/80 dark:border-slate-800 hover:bg-slate-100/80'
          }`}
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>ব্যাকআপ ও রিস্টোর</span>
        </button>
      </div>

      {/* Date Range Control (Visible for Financial Reports: pl, balanceSheet, trialBalance, animalProfitability, vatSummary) */}
      {activeReport !== 'backup' && activeReport !== 'aging' && activeReport !== 'yoyComparison' && (
        <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shrink-0">
              <CalendarDays className="w-5 h-5 text-teal-700" />
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
                    ? 'bg-teal-700 text-white shadow-xs'
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
                    ? 'bg-teal-700 text-white shadow-xs'
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
                    ? 'bg-teal-700 text-white shadow-xs'
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
                  className="px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-800 text-base font-sans cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-teal-600"
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
                  className="px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-800 text-base font-sans cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-teal-600"
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
                <div key={r.code} className="flex justify-between items-baseline text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans flex items-baseline gap-1.5">
                    <span className="font-bold text-gray-900 text-[14px]">{r.nameBn}</span>
                    <span className="text-xs text-gray-400 font-mono font-normal">({r.code})</span>
                  </span>
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
                <div key={c.code} className="flex justify-between items-baseline text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans flex items-baseline gap-1.5">
                    <span className="font-bold text-gray-900 text-[14px]">{c.nameBn}</span>
                    <span className="text-xs text-gray-400 font-mono font-normal">({c.code})</span>
                  </span>
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
                <div key={e.code} className="flex justify-between items-baseline text-gray-700 pl-4 py-1 border-b border-gray-50">
                  <span className="font-sans flex items-baseline gap-1.5">
                    <span className="font-bold text-gray-900 text-[14px]">{e.nameBn}</span>
                    <span className="text-xs text-gray-400 font-mono font-normal">({e.code})</span>
                  </span>
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
                  <div key={o.code} className="flex justify-between items-baseline text-gray-700 pl-4 py-1 border-b border-gray-50">
                    <span className="font-sans flex items-baseline gap-1.5">
                      <span className="font-bold text-gray-900 text-[14px]">{o.nameBn}</span>
                      <span className="text-xs text-gray-400 font-mono font-normal">({o.code})</span>
                    </span>
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

            {/* Quick compare link */}
            <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl flex items-center justify-between flex-wrap gap-2 text-xs text-purple-950">
              <div className="flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-700 shrink-0" />
                <span>
                  <strong>বার্ষিক তুলনা চান?</strong> চলতি বছরের পারফরম্যান্স বিগত বছর বা সমাপ্ত হিসাবকালের সাথে পাশাপাশি তুলনা করতে পারবেন।
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveReport('yoyComparison')}
                className="px-3 py-1.5 rounded-lg bg-purple-700 text-white font-bold hover:bg-purple-800 transition-colors cursor-pointer"
              >
                তুলনামূলক বিবরণী দেখুন →
              </button>
            </div>
          </div>

          {renderYoyProfitBarChart()}
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
                  <div key={a.code} className="flex justify-between items-baseline text-gray-700 py-0.5">
                    <span className="font-sans flex items-baseline gap-1.5">
                      <span className="font-bold text-gray-900 text-[14px]">{a.nameBn}</span>
                      <span className="text-xs text-gray-400 font-mono font-normal">({a.code})</span>
                    </span>
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
                    <div key={l.code} className="flex justify-between items-baseline text-gray-700 py-0.5">
                      <span className="font-sans flex items-baseline gap-1.5">
                        <span className="font-bold text-gray-900 text-[14px]">{l.nameBn}</span>
                        <span className="text-xs text-gray-400 font-mono font-normal">({l.code})</span>
                      </span>
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
                    <div key={eq.code} className="flex justify-between items-baseline text-gray-700 py-0.5">
                      <span className="font-sans flex items-baseline gap-1.5">
                        <span className="font-bold text-gray-900 text-[14px]">{eq.nameBn}</span>
                        <span className="text-xs text-gray-400 font-mono font-normal">({eq.code})</span>
                      </span>
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

          {/* Mobile / Tablet Card View */}
          <div className="md:hidden space-y-3">
            {tb.rows.map((r) => (
              <div
                key={r.code}
                onClick={() => {
                  setSelectedLedgerAccountCode(r.code);
                  loadLedgerReport(r.code);
                  setActiveReport('ledger');
                }}
                className={`p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-2xs space-y-2 cursor-pointer transition-colors ${
                  r.isOrphan ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' : 'hover:border-teal-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-bold text-gray-900 dark:text-slate-100 font-sans">{r.nameBn}</div>
                    <span className="text-xs text-gray-400 dark:text-slate-500 font-mono font-normal">
                      ({r.code})
                    </span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 shrink-0">
                    {r.accountClass}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-gray-100 dark:border-slate-800 font-mono">
                  <div className="text-[#15803D] dark:text-emerald-400 font-bold">
                    ডেবিট: {r.debit > 0 ? fmt(r.debit) : '-'}
                  </div>
                  <div className="text-right text-blue-700 dark:text-blue-400 font-bold">
                    ক্রেডিট: {r.credit > 0 ? fmt(r.credit) : '-'}
                  </div>
                </div>
              </div>
            ))}
            <div className="p-3.5 rounded-xl bg-gray-100 dark:bg-slate-800 text-sm font-bold flex justify-between items-center">
              <span>সর্বমোট সমতা:</span>
              <div className="flex items-center gap-3 text-xs sm:text-sm font-mono">
                <span className="text-[#15803D] dark:text-emerald-400">{fmt(tb.totalDebit)}</span>
                <span className="text-blue-700 dark:text-blue-400">{fmt(tb.totalCredit)}</span>
              </div>
            </div>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
            <table className="w-full text-left text-[14px] text-gray-800 dark:text-slate-200">
              <thead className="bg-[#F8FAFC] dark:bg-slate-800/80 text-gray-600 dark:text-slate-400 font-semibold border-b border-gray-200 dark:border-slate-700 text-[13px]">
                <tr>
                  <th className="p-3">হিসাবের নাম</th>
                  <th className="p-3">কোড</th>
                  <th className="p-3">শ্রেণী</th>
                  <th className="p-3 text-right">ডেবিট স্থিতি (৳)</th>
                  <th className="p-3 text-right">ক্রেডিট স্থিতি (৳)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800 font-mono">
                {tb.rows.map((r) => (
                  <tr
                    key={r.code}
                    onClick={() => {
                      setSelectedLedgerAccountCode(r.code);
                      loadLedgerReport(r.code);
                      setActiveReport('ledger');
                    }}
                    className={`${r.isOrphan ? 'bg-red-50/50 dark:bg-red-950/20' : 'hover:bg-gray-50/80 dark:hover:bg-slate-800/40'} cursor-pointer transition-colors`}
                    title="এই হিসাবের খতিয়ান দেখতে ক্লিক করুন"
                  >
                    <td className="p-3 font-sans text-gray-900 dark:text-slate-100 font-bold text-[14px]">{r.nameBn}</td>
                    <td className="p-3 text-xs text-gray-400 dark:text-slate-500 font-mono font-normal">({r.code})</td>
                    <td className="p-3 text-gray-500 dark:text-slate-400 text-[12px]">{r.accountClass}</td>
                    <td className="p-3 text-right text-[#15803D] dark:text-emerald-400 font-bold">{r.debit > 0 ? fmt(r.debit) : '-'}</td>
                    <td className="p-3 text-right text-blue-700 dark:text-blue-400 font-bold">{r.credit > 0 ? fmt(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F8FAFC] dark:bg-slate-800/80 font-mono font-bold text-[14px] border-t-2 border-gray-200 dark:border-slate-700">
                <tr>
                  <td colSpan={3} className="p-3 text-gray-900 dark:text-slate-100 font-sans">সর্বমোট সমতা (Total Balance):</td>
                  <td className="p-3 text-right text-[#15803D] dark:text-emerald-400">{fmt(tb.totalDebit)}</td>
                  <td className="p-3 text-right text-blue-700 dark:text-blue-400">{fmt(tb.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ===================== REPORT: GENERAL LEDGER ===================== */}
      {activeReport === 'ledger' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header & Account Picker */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-teal-700" />
                <span>সাধারণ খতিয়ান ও হিসাব বহি (General Ledger)</span>
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                হিসাবভিত্তিক সকল ডেবিট-ক্রেডিট লেনদেনের বিস্তারিত ইতিহাস ও ক্রমযোজিত জের
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="report-ledger-account-select" className="text-xs font-bold text-gray-600 whitespace-nowrap">
                হিসাব নির্বাচন:
              </label>
              <select
                id="report-ledger-account-select"
                value={selectedLedgerAccountCode}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedLedgerAccountCode(val);
                  loadLedgerReport(val);
                }}
                className="bg-[#F8FAFC] border border-gray-300 rounded-xl px-3 py-2 text-[13px] text-gray-900 font-semibold focus:outline-none focus:border-teal-600 focus:bg-white transition-all min-h-[40px] max-w-[260px] sm:max-w-[320px]"
              >
                {reportAccounts.map((acc) => (
                  <option key={acc.code} value={acc.code}>
                    {acc.nameBn} ({acc.code} • {acc.accountClass})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Account Summary Banner */}
          {reportLedgerAccount && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#F8FAFC] p-4 rounded-xl border border-gray-200">
              <div>
                <span className="text-[11px] text-gray-500 font-medium block">হিসাবের নাম ও কোড</span>
                <span className="text-[15px] font-bold text-gray-900 flex items-baseline gap-1.5">
                  <span>{reportLedgerAccount.nameBn}</span>
                  <span className="text-xs text-gray-400 font-mono font-normal">({reportLedgerAccount.code})</span>
                </span>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 font-medium block">হিসাবের শ্রেণী</span>
                <span className="text-[13px] font-semibold text-gray-700">{reportLedgerAccount.accountClass}</span>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 font-medium block">স্বাভাবিক ব্যালেন্স</span>
                <span className="text-[13px] font-semibold text-gray-700">
                  {reportLedgerAccount.normalBalance === 'DEBIT' ? 'ডেবিট (Debit)' : 'ক্রেডিট (Credit)'}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-gray-500 font-medium block">বর্তমান নিট জের (Net Balance)</span>
                <span
                  className={`text-[15px] font-bold font-mono ${
                    reportLedgerNetBalance >= 0 ? 'text-[#15803D]' : 'text-rose-600'
                  }`}
                >
                  {fmt(reportLedgerNetBalance)}
                </span>
              </div>
            </div>
          )}

          {/* Live Search Box */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="report-ledger-search-input"
                value={reportLedgerSearchQuery}
                onChange={(e) => setReportLedgerSearchQuery(e.target.value)}
                placeholder="খতিয়ান লেনদেন খুঁজুন (বিবরণ, টাকার পরিমাণ, তারিখ YYYY-MM-DD, ভাউচার)..."
                className="w-full pl-10 pr-9 py-2.5 bg-[#F8FAFC] border border-gray-300 rounded-xl text-[14px] text-gray-900 focus:outline-none focus:border-teal-600 focus:bg-white transition-all min-h-[42px]"
              />
              {reportLedgerSearchQuery && (
                <button
                  type="button"
                  id="btn-clear-report-ledger-search"
                  onClick={() => setReportLedgerSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  title="অনুসন্ধান মুছুন"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {reportLedgerSearchQuery.trim() && (
              <div className="text-xs text-gray-500 font-medium whitespace-nowrap">
                অনুসন্ধানের ফলাফল:{' '}
                <span className="font-bold text-teal-700">
                  {
                    reportLedgerEntries.filter((row) => {
                      const q = reportLedgerSearchQuery.toLowerCase().trim();
                      const descMatch = row.narration && row.narration.toLowerCase().includes(q);
                      const amountMatch =
                        (row.debit > 0 && (row.debit.toString().includes(q) || row.debit.toLocaleString().includes(q))) ||
                        (row.credit > 0 && (row.credit.toString().includes(q) || row.credit.toLocaleString().includes(q))) ||
                        row.runningBalance.toString().includes(q) ||
                        row.runningBalance.toLocaleString().includes(q);
                      const dateMatch = row.date && row.date.includes(q);
                      const voucherMatch = row.voucherNumber && row.voucherNumber.toLowerCase().includes(q);
                      return descMatch || amountMatch || dateMatch || voucherMatch;
                    }).length
                  }
                </span>{' '}
                টি এন্ট্রি
              </div>
            )}
          </div>

          {/* Ledger Table */}
          {(() => {
            const q = reportLedgerSearchQuery.toLowerCase().trim();
            const reversed = [...reportLedgerEntries].reverse();
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
              return descMatch || amountMatch || dateMatch || voucherMatch;
            });

            const visibleRows = filtered.slice(0, reportLedgerVisibleCount);

            if (filtered.length === 0) {
              return (
                <div className="p-8 text-center text-gray-500 bg-[#F8FAFC] rounded-xl border border-gray-200">
                  {reportLedgerSearchQuery.trim()
                    ? `"${reportLedgerSearchQuery}" দিয়ে এই খতিয়ানে কোনো লেনদেন খুঁজে পাওয়া যায়নি।`
                    : 'এই খতিয়ান হিসাবে নির্বাচিত সময়সীমার মধ্যে কোনো লেনদেন লিপিবদ্ধ নেই।'}
                </div>
              );
            }

            return (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-left text-[13px] text-gray-800">
                    <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="p-3">তারিখ</th>
                        <th className="p-3">ভাউচার নং</th>
                        <th className="p-3">বিবরণ / সূত্র</th>
                        <th className="p-3 text-right">ডেবিট (৳)</th>
                        <th className="p-3 text-right">ক্রেডিট (৳)</th>
                        <th className="p-3 text-right">জের / ব্যালেন্স (৳)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-mono">
                      {visibleRows.map((entry, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/80 transition-colors">
                          <td className="p-3 font-sans whitespace-nowrap text-gray-700">{entry.date}</td>
                          <td className="p-3 font-semibold text-teal-700 whitespace-nowrap">
                            {entry.voucherNumber || entry.journalId.slice(0, 8)}
                          </td>
                          <td className="p-3 font-sans max-w-xs text-gray-800 break-words">{entry.narration}</td>
                          <td className="p-3 text-right text-[#15803D] font-bold whitespace-nowrap">
                            {entry.debit > 0 ? fmt(entry.debit) : '-'}
                          </td>
                          <td className="p-3 text-right text-blue-700 font-bold whitespace-nowrap">
                            {entry.credit > 0 ? fmt(entry.credit) : '-'}
                          </td>
                          <td
                            className={`p-3 text-right font-bold whitespace-nowrap ${
                              entry.runningBalance >= 0 ? 'text-gray-900' : 'text-rose-600'
                            }`}
                          >
                            {fmt(entry.runningBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Batch / Pagination: "আরও দেখুন" (Load More) Button */}
                {filtered.length > reportLedgerVisibleCount && (
                  <div className="pt-3 pb-1 text-center">
                    <button
                      type="button"
                      id="btn-load-more-report-ledger"
                      onClick={() => setReportLedgerVisibleCount((prev) => prev + 25)}
                      className="px-6 py-2.5 bg-white border-2 border-teal-700 text-teal-700 hover:bg-teal-700 hover:text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer inline-flex items-center gap-2 min-h-[42px]"
                    >
                      <span>আরও দেখুন (Load More)</span>
                      <span className="text-[11px] opacity-80 font-normal">
                        ({Math.min(reportLedgerVisibleCount, filtered.length)} / {filtered.length}টি প্রদর্শিত, +২৫টি যোগ করুন)
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ===================== REPORT 4: ANIMAL PROFITABILITY ===================== */}
      {activeReport === 'animalProfitability' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-teal-700" />
                <span>পশুভিত্তিক লাভ-ক্ষতি প্রতিবেদন (Per-Animal Profitability Report)</span>
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                খামারের প্রতিটি পশুর মোট খরচ, অর্জিত রাজস্ব ও নিট লাভ-ক্ষতির তুলনামূলক বিশ্লেষণ
              </p>
            </div>
            <div className="text-[12px] text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1.5">
              <span>ক্রমানুসারে সাজানো:</span>
              <span className="font-bold text-teal-700">
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
                className="w-full pl-9 pr-4 py-2 text-[13px] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-transparent bg-gray-50"
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
                    ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
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
                    <div className="flex items-center gap-1 text-teal-700">
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

      {/* ===================== REPORT: POND PROFITABILITY (পুকুর লাভ-ক্ষতি) ===================== */}
      {activeReport === 'pondProfitability' && (
        <div id="pond-profitability-report-card" className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <Fish className="w-5 h-5 text-blue-700" />
                <span>পুকুর লাভ-ক্ষতি প্রতিবেদন (Pond Profitability Report)</span>
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                মাছের প্রতিটি ব্যাচের মোট উৎপাদন ব্যয় (পোনা + খাদ্য + অন্যান্য), আহরণ/বিক্রয় রাজস্ব ও নিট লাভ-ক্ষতির তুলনামূলক বিবরণী (শুধুমাত্র বিক্রিত ও আহরিত ব্যাচ)
              </p>
            </div>
            <div className="text-[12px] text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1.5">
              <span>ক্রমানুসারে সাজানো:</span>
              <span className="font-bold text-blue-700">
                {pondSortKey === 'netProfit'
                  ? `নিট লাভ (${pondSortDirection === 'desc' ? 'সর্বোচ্চ ➔ সর্বনিম্ন' : 'সর্বনিম্ন ➔ সর্বোচ্চ'})`
                  : pondSortKey === 'totalCost'
                  ? `মোট ব্যয় (${pondSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : pondSortKey === 'totalRevenue'
                  ? `মোট রাজস্ব (${pondSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : `আহরণ ওজন`}
              </span>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                মোট আহরিত ব্যাচ
              </span>
              <div className="text-[18px] font-bold text-gray-900">
                {pondSummary.totalBatches} <span className="text-[12px] font-normal text-gray-500">টি ব্যাচ</span>
              </div>
              <div className="text-[11px] text-gray-600">
                মোট ওজন: {pondSummary.totalHarvestWeight.toLocaleString()} কেজি
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">
                সর্বমোট উৎপাদন ব্যয়
              </span>
              <div className="text-[18px] font-bold font-mono text-amber-900">
                {fmt(pondSummary.totalPondCost)}
              </div>
              <div className="text-[11px] text-amber-700">পোনা + খাদ্য + অন্যান্য খরচ</div>
            </div>

            <div className="p-3.5 rounded-xl bg-cyan-50/70 border border-cyan-200 space-y-1">
              <span className="text-[11px] font-bold text-cyan-800 uppercase tracking-wide">
                সর্বমোট অর্জিত রাজস্ব
              </span>
              <div className="text-[18px] font-bold font-mono text-cyan-900">
                {fmt(pondSummary.totalPondRevenue)}
              </div>
              <div className="text-[11px] text-cyan-700">মাছ আহরণ ও বিক্রয়লব্ধ আয়</div>
            </div>

            <div
              className={`p-3.5 rounded-xl border space-y-1 ${
                pondSummary.totalPondProfit >= 0
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
              }`}
            >
              <span
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  pondSummary.totalPondProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                সার্বিক নিট লাভ/ক্ষতি
              </span>
              <div
                className={`text-[18px] font-bold font-mono ${
                  pondSummary.totalPondProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                {pondSummary.totalPondProfit >= 0 ? '+' : ''}
                {fmt(pondSummary.totalPondProfit)}
              </div>
              <div className="text-[11px] opacity-80">
                {pondSummary.totalPondProfit >= 0 ? 'সার্বিক উদ্বৃত্ত লাভ' : 'চলতি ঘাটতি'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wide">
                গড় নিট লাভ / ব্যাচ
              </span>
              <div className="text-[18px] font-bold font-mono text-blue-900">
                {pondSummary.avgProfit >= 0 ? '+' : ''}
                {fmt(pondSummary.avgProfit)}
              </div>
              <div className="text-[11px] text-blue-700">প্রতি ব্যাচের গড় মুনাফা</div>
            </div>
          </div>

          {/* Controls: Search, Sort */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                id="search-pond-profitability"
                type="text"
                value={pondSearchQuery}
                onChange={(e) => setPondSearchQuery(e.target.value)}
                placeholder="ব্যাচ আইডি, পুকুরের নাম বা মাছের প্রজাতি খুঁজুন..."
                className="w-full pl-9 pr-4 py-2 text-[13px] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent bg-gray-50"
              />
            </div>

            {/* Sort Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                id="btn-sort-pond-profit"
                onClick={() => togglePondSort('netProfit')}
                className={`px-3 py-2 rounded-xl border text-[12px] font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  pondSortKey === 'netProfit'
                    ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>নিট লাভ অনুযায়ী ({pondSortDirection === 'desc' ? 'সর্বোচ্চ ➔ সর্বনিম্ন' : 'সর্বনিম্ন ➔ সর্বোচ্চ'})</span>
                {pondSortKey === 'netProfit' ? (
                  pondSortDirection === 'desc' ? (
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

          {/* Profitability Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                  <th className="py-3 px-3.5 whitespace-nowrap">ব্যাচ ও পুকুর</th>
                  <th className="py-3 px-3 whitespace-nowrap">মজুত ও আহরণ তারিখ</th>
                  <th className="py-3 px-3 whitespace-nowrap">পোনা খরচ</th>
                  <th className="py-3 px-3 whitespace-nowrap">খাদ্য ও অন্যান্য</th>
                  <th
                    onClick={() => togglePondSort('totalCost')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট ব্যয়</span>
                      {pondSortKey === 'totalCost' && (
                        pondSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => togglePondSort('harvestWeightKg')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>আহরণ ওজন</span>
                      {pondSortKey === 'harvestWeightKg' && (
                        pondSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => togglePondSort('totalRevenue')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট রাজস্ব</span>
                      {pondSortKey === 'totalRevenue' && (
                        pondSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => togglePondSort('netProfit')}
                    className="py-3 px-3.5 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all bg-gray-200/40"
                  >
                    <div className="flex items-center gap-1 text-blue-900 font-bold">
                      <span>নিট লাভ / ক্ষতি</span>
                      {pondSortKey === 'netProfit' && (
                        pondSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap">মার্জিন (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-sans">
                {sortedPondRows.length > 0 ? (
                  sortedPondRows.map((row) => {
                    const isProfitable = row.netProfit >= 0;

                    return (
                      <tr key={row.id} className="hover:bg-blue-50/30 transition-colors">
                        {/* Batch ID, Pond & Species */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900">{row.id}</span>
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-semibold border border-blue-200">
                              {row.species}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {row.pondName}
                            {row.fingerlingQty > 0 ? ` • ${row.fingerlingQty.toLocaleString()}টি পোনা` : ''}
                          </div>
                        </td>

                        {/* Dates */}
                        <td className="py-3 px-3 whitespace-nowrap text-gray-600">
                          <div className="font-mono text-gray-900 text-[12px]">
                            {row.harvestDate || 'আহরণ তারিখ নেই'}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            মজুত: {row.stockingDate || '-'}
                          </div>
                        </td>

                        {/* Fingerling Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-700">
                          <div>{fmt(row.fingerlingCost)}</div>
                        </td>

                        {/* Feed & Other Costs */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-700">
                          <div>{fmt(row.feedCost + row.otherCost)}</div>
                          <div className="text-[10px] text-gray-400">
                            খাদ্য {fmt(row.feedCost)}
                            {row.otherCost > 0 ? ` + অন্যান্য ${fmt(row.otherCost)}` : ''}
                          </div>
                        </td>

                        {/* Total Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-amber-900">
                            {fmt(row.totalCost)}
                          </div>
                        </td>

                        {/* Harvest Weight */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-800">
                          <div className="font-semibold">{row.harvestWeightKg.toLocaleString()} কেজি</div>
                        </td>

                        {/* Total Revenue */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-cyan-900">
                            {fmt(row.totalRevenue)}
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
                            {isProfitable ? 'লাভ' : 'ক্ষতি'}
                          </div>
                        </td>

                        {/* Profit Margin */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              row.profitMargin >= 0
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {row.profitMargin >= 0 ? '+' : ''}
                            {row.profitMargin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      কোনো আহরিত মাছের ব্যাচ পাওয়া যায়নি (শুধুমাত্র আহরণ ও বিক্রয়কৃত ব্যাচের তথ্য এখানে প্রদর্শিত হয়)।
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Table Footer */}
              {sortedPondRows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-300">
                    <td colSpan={2} className="py-3 px-3.5">
                      মোট সমষ্টি ({sortedPondRows.length}টি ব্যাচ)
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {fmt(sortedPondRows.reduce((acc, r) => acc + r.fingerlingCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {fmt(sortedPondRows.reduce((acc, r) => acc + r.feedCost + r.otherCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-amber-900">
                      {fmt(sortedPondRows.reduce((acc, r) => acc + r.totalCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {sortedPondRows.reduce((acc, r) => acc + r.harvestWeightKg, 0).toLocaleString()} কেজি
                    </td>
                    <td className="py-3 px-3 font-mono text-cyan-900">
                      {fmt(sortedPondRows.reduce((acc, r) => acc + r.totalRevenue, 0))}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-[14px]">
                      {(() => {
                        const sumNet = sortedPondRows.reduce((acc, r) => acc + r.netProfit, 0);
                        return (
                          <span className={sumNet >= 0 ? 'text-[#15803D]' : 'text-rose-700'}>
                            {sumNet >= 0 ? '+' : ''}
                            {fmt(sumNet)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-3 font-mono text-[12px] text-gray-700">
                      {(() => {
                        const totRev = sortedPondRows.reduce((acc, r) => acc + r.totalRevenue, 0);
                        const totNet = sortedPondRows.reduce((acc, r) => acc + r.netProfit, 0);
                        const avgMarg = totRev > 0 ? (totNet / totRev) * 100 : 0;
                        return `${avgMarg >= 0 ? '+' : ''}${avgMarg.toFixed(1)}%`;
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Footnote */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-[11px] text-gray-500 space-y-1">
            <p>
              • <strong>হিসাবের ভিত্তি:</strong> প্রতিটি মাছের ব্যাচের সর্বমোট উৎপাদন ব্যয় = পোনা ক্রয় খরচ + মোট খাদ্য খরচ + অন্যান্য খরচ।
            </p>
            <p>
              • <strong>রাজস্ব ও নিট লাভ:</strong> শুধুমাত্র আহরণ ও বিক্রয় সম্পন্ন হওয়া ব্যাচসমূহ প্রদর্শিত হচ্ছে (নিট লাভ = সর্বমোট বিক্রয় রাজস্ব - সর্বমোট উৎপাদন ব্যয়)।
            </p>
            <p>
              • <strong>ডাটা ফিল্টারিং:</strong> যেসব ব্যাচের ক্ষেত্রে প্রকৃত বিক্রয়/আহরণ রাজস্ব ডাটাবেজে লিপিবদ্ধ রয়েছে কেবলমাত্র সেই ব্যাচসমূহের হিসাব অন্তর্ভুক্ত।
            </p>
          </div>
        </div>
      )}

      {/* ===================== REPORT: CROP PROFITABILITY (ফসল লাভ-ক্ষতি) ===================== */}
      {activeReport === 'cropProfitability' && (
        <div id="crop-profitability-report-card" className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                <Sprout className="w-5 h-5 text-emerald-700" />
                <span>ফসল লাভ-ক্ষতি প্রতিবেদন (Crop Profitability Report)</span>
              </h3>
              <p className="text-[13px] text-gray-500 mt-0.5">
                ফসলের প্রতিটি চক্রের মোট উৎপাদন ব্যয় (বীজ + সার + সেচ + শ্রমিক), আহরণ/বিক্রয় রাজস্ব ও নিট লাভ-ক্ষতির তুলনামূলক বিবরণী (শুধুমাত্র বিক্রিত ও আহরিত ফসল)
              </p>
            </div>
            <div className="text-[12px] text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 flex items-center gap-1.5">
              <span>ক্রমানুসারে সাজানো:</span>
              <span className="font-bold text-emerald-700">
                {cropSortKey === 'netProfit'
                  ? `নিট লাভ (${cropSortDirection === 'desc' ? 'সর্বোচ্চ ➔ সর্বনিম্ন' : 'সর্বনিম্ন ➔ সর্বোচ্চ'})`
                  : cropSortKey === 'totalCost'
                  ? `মোট ব্যয় (${cropSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : cropSortKey === 'totalRevenue'
                  ? `মোট রাজস্ব (${cropSortDirection === 'desc' ? 'বেশি ➔ কম' : 'কম ➔ বেশি'})`
                  : `আহরিত ফলন`}
              </span>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                মোট আহরিত ফসল চক্র
              </span>
              <div className="text-[18px] font-bold text-gray-900">
                {cropSummary.totalCycles} <span className="text-[12px] font-normal text-gray-500">টি ফসল</span>
              </div>
              <div className="text-[11px] text-gray-600">
                মোট ফলন: {cropSummary.totalHarvestYield.toLocaleString()} কেজি
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1">
              <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wide">
                সর্বমোট উৎপাদন ব্যয়
              </span>
              <div className="text-[18px] font-bold font-mono text-amber-900">
                {fmt(cropSummary.totalCropCost)}
              </div>
              <div className="text-[11px] text-amber-700">বীজ + সার + সেচ + শ্রমিক + অন্যান্য</div>
            </div>

            <div className="p-3.5 rounded-xl bg-cyan-50/70 border border-cyan-200 space-y-1">
              <span className="text-[11px] font-bold text-cyan-800 uppercase tracking-wide">
                সর্বমোট অর্জিত রাজস্ব
              </span>
              <div className="text-[18px] font-bold font-mono text-cyan-900">
                {fmt(cropSummary.totalCropRevenue)}
              </div>
              <div className="text-[11px] text-cyan-700">ফসল বিক্রয় ও আহরণলব্ধ আয়</div>
            </div>

            <div
              className={`p-3.5 rounded-xl border space-y-1 ${
                cropSummary.totalCropProfit >= 0
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
              }`}
            >
              <span
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  cropSummary.totalCropProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                সার্বিক নিট লাভ/ক্ষতি
              </span>
              <div
                className={`text-[18px] font-bold font-mono ${
                  cropSummary.totalCropProfit >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                }`}
              >
                {cropSummary.totalCropProfit >= 0 ? '+' : ''}
                {fmt(cropSummary.totalCropProfit)}
              </div>
              <div className="text-[11px] opacity-80">
                {cropSummary.totalCropProfit >= 0 ? 'সার্বিক উদ্বৃত্ত লাভ' : 'চলতি ঘাটতি'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">
                গড় নিট লাভ / চক্র
              </span>
              <div className="text-[18px] font-bold font-mono text-emerald-900">
                {cropSummary.avgProfit >= 0 ? '+' : ''}
                {fmt(cropSummary.avgProfit)}
              </div>
              <div className="text-[11px] text-emerald-700">প্রতি ফসলের গড় মুনাফা</div>
            </div>
          </div>

          {/* Controls: Search, Sort */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                id="search-crop-profitability"
                type="text"
                value={cropSearchQuery}
                onChange={(e) => setCropSearchQuery(e.target.value)}
                placeholder="ফসল, জমির নাম বা বিভাগ দিয়ে খুঁজুন..."
                className="w-full pl-9 pr-4 py-2 text-[13px] rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent bg-gray-50"
              />
            </div>

            {/* Sort Button */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                id="btn-sort-crop-profit"
                onClick={() => toggleCropSort('netProfit')}
                className={`px-3 py-2 rounded-xl border text-[12px] font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  cropSortKey === 'netProfit'
                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>নিট লাভ অনুযায়ী ({cropSortDirection === 'desc' ? 'সর্বোচ্চ ➔ সর্বনিম্ন' : 'সর্বনিম্ন ➔ সর্বোচ্চ'})</span>
                {cropSortKey === 'netProfit' ? (
                  cropSortDirection === 'desc' ? (
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

          {/* Profitability Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                  <th className="py-3 px-3.5 whitespace-nowrap">ফসল ও জমি</th>
                  <th className="py-3 px-3 whitespace-nowrap">রোপণ ও আহরণ তারিখ</th>
                  <th className="py-3 px-3 whitespace-nowrap">বীজ ও সার খরচ</th>
                  <th className="py-3 px-3 whitespace-nowrap">সেচ ও শ্রমিক খরচ</th>
                  <th
                    onClick={() => toggleCropSort('totalCost')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট ব্যয়</span>
                      {cropSortKey === 'totalCost' && (
                        cropSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleCropSort('harvestYieldKg')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>আহরিত ফলন</span>
                      {cropSortKey === 'harvestYieldKg' && (
                        cropSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleCropSort('totalRevenue')}
                    className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all"
                  >
                    <div className="flex items-center gap-1">
                      <span>সর্বমোট রাজস্ব</span>
                      {cropSortKey === 'totalRevenue' && (
                        cropSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => toggleCropSort('netProfit')}
                    className="py-3 px-3.5 whitespace-nowrap cursor-pointer hover:bg-gray-200/60 transition-all bg-gray-200/40"
                  >
                    <div className="flex items-center gap-1 text-emerald-900 font-bold">
                      <span>নিট লাভ / ক্ষতি</span>
                      {cropSortKey === 'netProfit' && (
                        cropSortDirection === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </th>
                  <th className="py-3 px-3 whitespace-nowrap">মার্জিন (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-sans">
                {sortedCropRows.length > 0 ? (
                  sortedCropRows.map((row) => {
                    const isProfitable = row.netProfit >= 0;

                    return (
                      <tr key={row.id} className="hover:bg-emerald-50/30 transition-colors">
                        {/* Crop Name, Category & Plot */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900">{row.cropName}</span>
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-semibold border border-emerald-200">
                              {row.cropCategory === 'GRAIN' ? 'দানা শস্য' : row.cropCategory === 'VEGETABLE' ? 'শাকসবজি' : row.cropCategory === 'FODDER' ? 'ঘাস/পশুখাদ্য' : 'অন্যান্য'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {row.plotName} {row.areaDecimals > 0 ? ` • ${row.areaDecimals} শতাংশ` : ''}
                            <span className="font-mono text-gray-400 ml-1">({row.id})</span>
                          </div>
                        </td>

                        {/* Dates */}
                        <td className="py-3 px-3 whitespace-nowrap text-gray-600">
                          <div className="font-mono text-gray-900 text-[12px]">
                            {row.actualHarvestDate || 'আহরণ তারিখ নেই'}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            রোপণ: {row.plantingDate || '-'}
                          </div>
                        </td>

                        {/* Seed & Fertilizer Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-700">
                          <div>{fmt(row.seedCost + row.fertilizerCost)}</div>
                          <div className="text-[10px] text-gray-400">
                            বীজ {fmt(row.seedCost)} + সার {fmt(row.fertilizerCost)}
                          </div>
                        </td>

                        {/* Irrigation & Labour Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-700">
                          <div>{fmt(row.irrigationCost + row.labourCost + row.otherCost)}</div>
                          <div className="text-[10px] text-gray-400">
                            সেচ {fmt(row.irrigationCost)} + শ্রমিক {fmt(row.labourCost)}
                            {row.otherCost > 0 ? ` + অন্য ${fmt(row.otherCost)}` : ''}
                          </div>
                        </td>

                        {/* Total Cost */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-amber-900">
                            {fmt(row.totalCost)}
                          </div>
                        </td>

                        {/* Harvest Yield */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-gray-800">
                          <div className="font-semibold">{row.harvestYieldKg.toLocaleString()} কেজি</div>
                        </td>

                        {/* Total Revenue */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <div className="font-bold text-cyan-900">
                            {fmt(row.totalRevenue)}
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
                            {isProfitable ? 'লাভ' : 'ক্ষতি'}
                          </div>
                        </td>

                        {/* Profit Margin */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              row.profitMargin >= 0
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {row.profitMargin >= 0 ? '+' : ''}
                            {row.profitMargin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      কোনো আহরিত ফসলের তথ্য পাওয়া যায়নি (শুধুমাত্র আহরণ ও বিক্রয়কৃত ফসলের তথ্য এখানে প্রদর্শিত হয়)।
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Table Footer */}
              {sortedCropRows.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-bold text-gray-900 border-t-2 border-gray-300">
                    <td colSpan={2} className="py-3 px-3.5">
                      মোট সমষ্টি ({sortedCropRows.length}টি ফসল)
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {fmt(sortedCropRows.reduce((acc, r) => acc + r.seedCost + r.fertilizerCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {fmt(sortedCropRows.reduce((acc, r) => acc + r.irrigationCost + r.labourCost + r.otherCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-amber-900">
                      {fmt(sortedCropRows.reduce((acc, r) => acc + r.totalCost, 0))}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-800">
                      {sortedCropRows.reduce((acc, r) => acc + r.harvestYieldKg, 0).toLocaleString()} কেজি
                    </td>
                    <td className="py-3 px-3 font-mono text-cyan-900">
                      {fmt(sortedCropRows.reduce((acc, r) => acc + r.totalRevenue, 0))}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-[14px]">
                      {(() => {
                        const sumNet = sortedCropRows.reduce((acc, r) => acc + r.netProfit, 0);
                        return (
                          <span className={sumNet >= 0 ? 'text-[#15803D]' : 'text-rose-700'}>
                            {sumNet >= 0 ? '+' : ''}
                            {fmt(sumNet)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-3 font-mono text-[12px] text-gray-700">
                      {(() => {
                        const totRev = sortedCropRows.reduce((acc, r) => acc + r.totalRevenue, 0);
                        const totNet = sortedCropRows.reduce((acc, r) => acc + r.netProfit, 0);
                        const avgMarg = totRev > 0 ? (totNet / totRev) * 100 : 0;
                        return `${avgMarg >= 0 ? '+' : ''}${avgMarg.toFixed(1)}%`;
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Footnote */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-[11px] text-gray-500 space-y-1">
            <p>
              • <strong>হিসাবের ভিত্তি:</strong> প্রতিটি ফসল চক্রের সর্বমোট উৎপাদন ব্যয় = বীজ ক্রয় + সার ও বালাইনাশক + সেচ খরচ + শ্রমিক মজুরি + অন্যান্য ব্যয়।
            </p>
            <p>
              • <strong>রাজস্ব ও নিট লাভ:</strong> শুধুমাত্র আহরণ ও বিক্রয় সম্পন্ন হওয়া ফসলসমূহ প্রদর্শিত হচ্ছে (নিট লাভ = সর্বমোট ফসল বিক্রয় রাজস্ব - সর্বমোট উৎপাদন ব্যয়)।
            </p>
            <p>
              • <strong>ডাটা ফিল্টারিং:</strong> যেসব ফসল চক্রের ক্ষেত্রে প্রকৃত বিক্রয়/আহরণ রাজস্ব ডাটাবেজে লিপিবদ্ধ রয়েছে কেবলমাত্র সেই চক্রসমূহের হিসাব অন্তর্ভুক্ত।
            </p>
          </div>
        </div>
      )}

      {/* ===================== REPORT: AGING REPORT (পাওনা-দেনার হিসাব) ===================== */}
      {activeReport === 'aging' && (
        <div className="space-y-5">
          {/* Aging Report Header Illustration */}
          <div
            className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
            }}
          >
            <img
              src="/illustrations/Pie_chart-pana.svg"
              alt="Aging report illustration"
              loading="lazy"
              className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
            />
          </div>

          {/* Sub-tabs: Receivables & Payables */}
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <IconTile icon={Clock} color="indigo" size="md" rounded="xl" />
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                    <span>পাওনা-দেনার হিসাব (Receivables & Payables Aging Report)</span>
                  </h3>
                  <p className="text-[13px] text-gray-600 mt-0.5">
                    আজকের তারিখ পর্যন্ত বকেয়া অর্থ আদায় ও পরিশোধের মেয়াদ ভিত্তিক অগ্রাধিকার তালিকা
                  </p>
                </div>
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
                      ? 'bg-teal-700 text-white shadow-xs'
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
                      ? 'bg-teal-700 text-white shadow-xs'
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
                          ? 'ring-2 ring-teal-600 bg-white shadow-xs'
                          : 'bg-white hover:bg-gray-50/80'
                      } ${b.cardBorder}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[11px] font-bold text-gray-700">{b.labelBn}</span>
                        <StatusBadge
                          status={b.status}
                          size="sm"
                          label={`${b.items.length}`}
                        />
                      </div>
                      <div className="text-sm sm:text-base font-bold font-mono text-gray-900">
                        {fmt(b.totalDue)}
                      </div>
                      <span className="text-[10px] text-gray-500 block truncate mt-0.5">
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
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-teal-600"
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
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[32px] inline-flex items-center gap-1.5 ${
                      agingBucketFilter === b.key
                        ? 'bg-teal-700 text-white shadow-2xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span>{b.labelBn}</span>
                    <StatusBadge
                      status={b.status}
                      size="sm"
                      label={`${b.items.length}`}
                    />
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
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <StatusBadge
                        status={bucket.status}
                        size="md"
                        label={bucket.priorityTag}
                      />
                      <h4 className="text-base font-bold text-gray-900">
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
                                <span className="inline-flex items-center gap-1 font-mono font-bold text-xs text-gray-700">
                                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                                  <span>{item.daysOverdue} দিন</span>
                                </span>
                              </td>
                              <td className="p-3 text-right whitespace-nowrap">
                                <StatusBadge
                                  status={bucket.status}
                                  label={
                                    item.daysOverdue > 30
                                      ? 'জরুরি তাগাদা'
                                      : item.daysOverdue >= 15
                                      ? 'মনোযোগ প্রয়োজন'
                                      : item.daysOverdue >= 8
                                      ? 'বকেয়া'
                                      : 'নতুন চালান'
                                  }
                                />
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
              <div className="bg-white border border-blue-200/80 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-blue-100">
                  <div className="flex items-center gap-3">
                    <IconTile icon={Coins} color="blue" size="md" rounded="xl" />
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-gray-900">
                        নগদ প্রবাহ বিবরণী (Cash Flow Statement)
                      </h3>
                      <p className="text-[13px] text-gray-600 mt-0.5">
                        প্রত্যক্ষ পদ্ধতিতে নগদ আগমন ও বহির্গমনের হিসাব এবং সমাপ্তি ব্যাংক ও নগদ স্থিতির সমন্বয়
                      </p>
                    </div>
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
                  <div className="p-3.5 rounded-xl bg-teal-50/70 border border-teal-200 space-y-1 col-span-2 sm:col-span-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider">
                        সমাপ্তি স্থিতি (Closing)
                      </span>
                      <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                    </div>
                    <div className="text-base sm:text-lg font-bold font-mono text-teal-800">
                      {fmt(cashFlowData.closingBalance)}
                    </div>
                    <span className="text-[11px] text-teal-700/80 font-medium block truncate">
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
                      <Scale className="w-4 h-4 text-teal-700" />
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
                      <tr className="bg-teal-50 font-bold text-gray-900 border-t-2 border-teal-300">
                        <td className="py-3 px-3 text-teal-800 font-bold">
                          সমাপ্তি নগদ ও ব্যাংক স্থিতি (Resulting Closing Balance)
                        </td>
                        <td className="py-3 px-3 font-mono text-teal-800 font-bold">(=)</td>
                        <td className="py-3 px-3 text-right font-mono text-teal-800 font-extrabold text-base sm:text-lg">
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
              <h4 className="font-bold text-teal-700 text-[15px] flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span>JSON ব্যাকআপ ডাউনলোড</span>
              </h4>
              <p className="text-[13px] text-gray-600 leading-relaxed">
                আপনার ডিভাইসে অফলাইনে নিরাপদ রাখার জন্য খামারের সমস্ত হিসাব ও রেকর্ডের একটি সম্পূর্ণ এনক্রিপ্টযোগ্য JSON ব্যাকআপ ফাইল ডাউনলোড করুন।
              </p>
              <button
                onClick={handleBackupJson}
                className="w-full py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-[13px] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs min-h-[42px]"
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

      {/* ===================== REPORT: VAT SUMMARY (ভ্যাট সারাংশ) ===================== */}
      {isVatRegistered && activeReport === 'vatSummary' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-700" />
                <h3 className="text-base sm:text-lg font-bold text-gray-900">
                  ভ্যাট ও মূসক সারাংশ প্রতিবেদন (VAT Summary Report)
                </h3>
              </div>
              <p className="text-[13px] text-gray-500 mt-1">
                সরকারি মূসক ও ভ্যাট রিটার্ন প্রস্তুতির জন্য আউটপুট ও ইনপুট ভ্যাট হিসাব
              </p>
            </div>

            {/* TIN & BIN Tags (Only shown if configured) */}
            {(tinNumber || binNumber) && (
              <div className="flex flex-wrap items-center gap-2">
                {binNumber && (
                  <span className="px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-mono font-bold">
                    বিআইএন (BIN): {binNumber}
                  </span>
                )}
                {tinNumber && (
                  <span className="px-3 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-xs font-mono font-bold">
                    ই-টিন (e-TIN): {tinNumber}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Primary Metric Cards: Output VAT, Input VAT, Net VAT Payable/Receivable */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Output VAT (Collected on Sales) */}
            <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                  আউটপুট ভ্যাট (Output VAT)
                </span>
                <span className="p-1 rounded-md bg-emerald-100 text-emerald-700">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-emerald-950 font-mono">
                {fmt(vatData?.totalOutputVat || 0)}
              </div>
              <p className="text-xs text-emerald-700">
                বিক্রয় হতে সংগৃহীত মূসক ({vatData?.salesWithVat.length || 0}টি চালান)
              </p>
            </div>

            {/* Card 2: Input VAT (Paid on Purchases) */}
            <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">
                  ইনপুট ভ্যাট (Input VAT)
                </span>
                <span className="p-1 rounded-md bg-blue-100 text-blue-700">
                  <ArrowDownRight className="w-4 h-4" />
                </span>
              </div>
              <div className="text-2xl font-black text-blue-950 font-mono">
                {fmt(vatData?.totalInputVat || 0)}
              </div>
              <p className="text-xs text-blue-700">
                ক্রয়ে পরিশোধিত/রেয়াতযোগ্য মূসক ({vatData?.purchasesWithVat.length || 0}টি চালান)
              </p>
            </div>

            {/* Card 3: Net VAT Payable / Receivable */}
            <div
              className={`p-4 rounded-xl border space-y-1 ${
                (vatData?.netVatPayable || 0) >= 0
                  ? 'bg-amber-50/60 border-amber-200'
                  : 'bg-emerald-50/60 border-emerald-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold uppercase tracking-wide ${
                    (vatData?.netVatPayable || 0) >= 0 ? 'text-amber-800' : 'text-emerald-800'
                  }`}
                >
                  {(vatData?.netVatPayable || 0) >= 0
                    ? 'নিট প্রদেয় ভ্যাট (Net Payable)'
                    : 'নিট প্রাপ্য ভ্যাট (Net Receivable / Credit)'}
                </span>
                <span
                  className={`p-1 rounded-md ${
                    (vatData?.netVatPayable || 0) >= 0
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  <Coins className="w-4 h-4" />
                </span>
              </div>
              <div
                className={`text-2xl font-black font-mono ${
                  (vatData?.netVatPayable || 0) >= 0 ? 'text-amber-950' : 'text-emerald-950'
                }`}
              >
                {fmt(Math.abs(vatData?.netVatPayable || 0))}
              </div>
              <p
                className={`text-xs font-medium ${
                  (vatData?.netVatPayable || 0) >= 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {(vatData?.netVatPayable || 0) >= 0
                  ? 'সরকারি কোষাগারে জমাযোগ্য নিট ভ্যাট'
                  : 'পরবর্তী মাসের সাথে সমন্বয়যোগ্য ভ্যাট প্রত্যর্পণ'}
              </p>
            </div>
          </div>

          {/* Base Revenue & Expenditure Summary Row */}
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-gray-500 block">মোট বিক্রয়ের পরিমাণ (Sales Base):</span>
                <span className="font-bold text-gray-900 font-mono text-sm">
                  {fmt(vatData?.totalSalesTaxable || 0)}
                </span>
              </div>
              <div className="h-6 w-px bg-gray-300 hidden sm:block" />
              <div>
                <span className="text-gray-500 block">মোট ক্রয়ের পরিমাণ (Purchase Base):</span>
                <span className="font-bold text-gray-900 font-mono text-sm">
                  {fmt(vatData?.totalPurchasesTaxable || 0)}
                </span>
              </div>
            </div>
            <div className="text-gray-600 bg-white px-3 py-1.5 rounded-lg border border-gray-200 font-mono">
              হিসাব সূত্র: আউটপুট ভ্যাট ({fmt(vatData?.totalOutputVat || 0)}) - ইনপুট ভ্যাট ({fmt(vatData?.totalInputVat || 0)}) = {fmt(vatData?.netVatPayable || 0)}
            </div>
          </div>

          {/* Detailed Lists: Output VAT on Sales & Input VAT on Purchases */}
          <div className="space-y-6">
            {/* 1. Sales / Output VAT Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <ArrowUpRight className="w-4 h-4 text-emerald-700" />
                  <span>বিক্রয় ভিত্তিক আউটপুট ভ্যাট (Sales Output VAT Invoices)</span>
                </h4>
                <span className="text-xs text-gray-500 font-semibold">
                  মোট: {vatData?.salesWithVat.length || 0}টি চালান
                </span>
              </div>

              {(!vatData || vatData.salesWithVat.length === 0) ? (
                <div className="p-6 text-center bg-gray-50 rounded-xl border border-gray-200 text-gray-500 text-xs">
                  নির্বাচিত সময়সীমার মধ্যে কোনো ভ্যাটযুক্ত বিক্রয় চালান নেই।
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="py-2.5 px-3">তারিখ</th>
                        <th className="py-2.5 px-3">চালান নং</th>
                        <th className="py-2.5 px-3">ক্রেতার নাম</th>
                        <th className="py-2.5 px-3 text-right">চালান মোট মূল্য</th>
                        <th className="py-2.5 px-3 text-right font-bold text-emerald-800">সংগৃহীত ভ্যাট</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {vatData.salesWithVat.map((sale) => (
                        <tr key={sale.id} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2 px-3 font-mono text-gray-600">{sale.date}</td>
                          <td className="py-2 px-3 font-mono font-bold text-gray-900">{sale.invoiceNumber}</td>
                          <td className="py-2 px-3 text-gray-800">{sale.customerName}</td>
                          <td className="py-2 px-3 text-right font-mono text-gray-800">
                            {fmt(sale.grandTotal || sale.totalAmount || 0)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                            {fmt(Number(sale.taxVat || sale.vat || sale.vatTax || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-emerald-50/70 font-bold border-t border-emerald-200">
                      <tr>
                        <td colSpan={4} className="py-2.5 px-3 text-emerald-900 text-right">
                          মোট আউটপুট ভ্যাট (Total Output VAT):
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-950">
                          {fmt(vatData.totalOutputVat)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* 2. Purchases / Input VAT Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <ArrowDownRight className="w-4 h-4 text-blue-700" />
                  <span>ক্রয় ভিত্তিক ইনপুট ভ্যাট (Purchases Input VAT / Rebate)</span>
                </h4>
                <span className="text-xs text-gray-500 font-semibold">
                  মোট: {vatData?.purchasesWithVat.length || 0}টি চালান
                </span>
              </div>

              {(!vatData || vatData.purchasesWithVat.length === 0) ? (
                <div className="p-6 text-center bg-gray-50 rounded-xl border border-gray-200 text-gray-500 text-xs">
                  নির্বাচিত সময়সীমার মধ্যে কোনো ভ্যাটযুক্ত ক্রয় চালান নেই।
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="py-2.5 px-3">তারিখ</th>
                        <th className="py-2.5 px-3">রেফারেন্স / চালান নং</th>
                        <th className="py-2.5 px-3">সরবরাহকারী</th>
                        <th className="py-2.5 px-3 text-right">ক্রয় মোট মূল্য</th>
                        <th className="py-2.5 px-3 text-right font-bold text-blue-800">পরিশোধিত ইনপুট ভ্যাট</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {vatData.purchasesWithVat.map((pur) => (
                        <tr key={pur.id} className="hover:bg-gray-50 transition-colors">
                          <td className="py-2 px-3 font-mono text-gray-600">{pur.date}</td>
                          <td className="py-2 px-3 font-mono font-bold text-gray-900">{pur.id}</td>
                          <td className="py-2 px-3 text-gray-800">{pur.supplierName}</td>
                          <td className="py-2 px-3 text-right font-mono text-gray-800">
                            {fmt(pur.grandTotal || pur.totalAmount || 0)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-blue-800">
                            {fmt(Number(pur.taxVat || pur.vat || pur.vatTax || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-blue-50/70 font-bold border-t border-blue-200">
                      <tr>
                        <td colSpan={4} className="py-2.5 px-3 text-blue-900 text-right">
                          মোট ইনপুট ভ্যাট (Total Input VAT):
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-blue-950">
                          {fmt(vatData.totalInputVat)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== REPORT: YEAR-OVER-YEAR / CLOSED PERIOD COMPARISON ===================== */}
      {activeReport === 'yoyComparison' && (
        <div className="space-y-5">
          {/* Header & Mode Switcher */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
                  <GitCompare className="w-5 h-5 text-purple-700" />
                  <span>চলতি বছর বনাম বিগত বছর আর্থিক তুলনা (This Year vs Last Year)</span>
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5">
                  সমাপ্ত হিসাবকাল (Closed Periods) ও পূর্ববর্তী বছরের সাথে আয়, ব্যয় ও মুনাফার তুলনামূলক আর্থিক পর্যালোচনা
                </p>
              </div>

              {/* Mode Selector */}
              <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setComparisonMode('calendar');
                    setSelectedClosedPeriodId('');
                  }}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    comparisonMode === 'calendar'
                      ? 'bg-purple-700 text-white shadow-xs'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                  }`}
                >
                  ক্যালেন্ডার বছরভিত্তিক
                </button>
                <button
                  type="button"
                  onClick={() => setComparisonMode('closed_period')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                    comparisonMode === 'closed_period'
                      ? 'bg-purple-700 text-white shadow-xs'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/70'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>সমাপ্ত হিসাবকালভিত্তিক</span>
                  {closedPeriodsList.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 bg-purple-200 text-purple-900 rounded-full text-[10px]">
                      {closedPeriodsList.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Closed period selection dropdown if mode is closed_period */}
            {comparisonMode === 'closed_period' && (
              <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-purple-950">
                  <Lock className="w-4 h-4 text-purple-700 shrink-0" />
                  <span>তুলনার জন্য সমাপ্ত হিসাবকাল নির্বাচন করুন:</span>
                </div>
                {closedPeriodsList.length === 0 ? (
                  <span className="text-gray-500 italic">এখনও কোনো হিসাবকাল সমাপ্ত (Year-End Closed) করা হয়নি।</span>
                ) : (
                  <select
                    value={selectedClosedPeriodId || (closedPeriodsList[0]?.id || '')}
                    onChange={(e) => setSelectedClosedPeriodId(e.target.value)}
                    className="bg-white border border-purple-300 rounded-lg px-3 py-1.5 text-xs text-purple-950 font-bold focus:outline-none focus:ring-2 focus:ring-purple-600/30 min-h-[36px]"
                  >
                    {closedPeriodsList.map((p) => (
                      <option key={p.id} value={p.id}>
                        সমাপ্তির তারিখ: {p.endDate} (স্থানান্তরিত লাভ: ৳{p.netProfitTransferred.toLocaleString('en-IN')})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Periods Range Banner */}
            {yoyData && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="font-bold text-emerald-900 flex items-center justify-between">
                    <span>চলতি সময়কাল (Current Period)</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[11px]">সক্রিয় / চলমান</span>
                  </div>
                  <div className="text-sm font-bold text-gray-900 mt-1">{yoyData.thisYearLabel}</div>
                  <div className="text-gray-600 font-mono text-[11px]">
                    {yoyData.thisYearRange.startDate} হতে {yoyData.thisYearRange.endDate}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200">
                  <div className="font-bold text-purple-900 flex items-center justify-between">
                    <span>বিগত সময়কাল (Prior Comparison Period)</span>
                    {yoyData.isLastYearClosed ? (
                      <span className="px-2 py-0.5 rounded bg-purple-200 text-purple-900 text-[11px] font-bold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> সমাপ্ত হিসাবকাল (Closed)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-[11px]">ক্যালেন্ডার বছর</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-gray-900 mt-1">{yoyData.lastYearLabel}</div>
                  <div className="text-gray-600 font-mono text-[11px]">
                    {yoyData.lastYearRange.startDate} হতে {yoyData.lastYearRange.endDate}
                    {yoyData.closedPeriodRecord && (
                      <span className="ml-2 font-sans text-purple-800 font-semibold">
                        • পুঞ্জীভূত লাভে স্থানান্তর: ৳{yoyData.closedPeriodRecord.netProfitTransferred.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {renderYoyProfitBarChart()}
          </div>

          {/* Top 4 KPI Comparison Cards */}
          {yoyData && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Revenue Card */}
              <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">মোট বিক্রয় ও আয় (Revenue)</div>
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-bold font-mono text-gray-900">{fmt(yoyData.metrics.revenue.thisYear)}</div>
                  <div className={`text-xs font-bold flex items-center gap-0.5 ${
                    yoyData.metrics.revenue.diff >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {yoyData.metrics.revenue.diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    <span>{yoyData.metrics.revenue.diff >= 0 ? '+' : ''}{yoyData.metrics.revenue.pctChange}%</span>
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 flex justify-between pt-1 border-t border-gray-100">
                  <span>বিগত বছর:</span>
                  <span className="font-mono text-gray-700 font-semibold">{fmt(yoyData.metrics.revenue.lastYear)}</span>
                </div>
              </div>

              {/* Gross Profit Card */}
              <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">মোট লাভ (Gross Profit)</div>
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-bold font-mono text-emerald-800">{fmt(yoyData.metrics.grossProfit.thisYear)}</div>
                  <div className={`text-xs font-bold flex items-center gap-0.5 ${
                    yoyData.metrics.grossProfit.diff >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {yoyData.metrics.grossProfit.diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    <span>{yoyData.metrics.grossProfit.diff >= 0 ? '+' : ''}{yoyData.metrics.grossProfit.pctChange}%</span>
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 flex justify-between pt-1 border-t border-gray-100">
                  <span>বিগত বছর:</span>
                  <span className="font-mono text-gray-700 font-semibold">{fmt(yoyData.metrics.grossProfit.lastYear)}</span>
                </div>
              </div>

              {/* Operating Expenses Card */}
              <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-2">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">পরিচালন ব্যয় (Operating Exp.)</div>
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-bold font-mono text-red-700">{fmt(yoyData.metrics.operatingExpenses.thisYear)}</div>
                  <div className={`text-xs font-bold flex items-center gap-0.5 ${
                    yoyData.metrics.operatingExpenses.diff <= 0 ? 'text-emerald-700' : 'text-amber-700'
                  }`}>
                    {yoyData.metrics.operatingExpenses.diff <= 0 ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
                    <span>{yoyData.metrics.operatingExpenses.diff >= 0 ? '+' : ''}{yoyData.metrics.operatingExpenses.pctChange}%</span>
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 flex justify-between pt-1 border-t border-gray-100">
                  <span>বিগত বছর:</span>
                  <span className="font-mono text-gray-700 font-semibold">{fmt(yoyData.metrics.operatingExpenses.lastYear)}</span>
                </div>
              </div>

              {/* Net Profit Card */}
              <div className={`p-4 rounded-2xl border shadow-xs space-y-2 ${
                yoyData.metrics.netProfit.thisYear >= 0
                  ? 'bg-emerald-50/50 border-emerald-200'
                  : 'bg-red-50/50 border-red-200'
              }`}>
                <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">নিট মুনাফা / (ক্ষতি) (Net Profit)</div>
                <div className="flex items-baseline justify-between">
                  <div className={`text-lg font-bold font-mono ${
                    yoyData.metrics.netProfit.thisYear >= 0 ? 'text-emerald-900' : 'text-red-700'
                  }`}>
                    {fmt(yoyData.metrics.netProfit.thisYear)}
                  </div>
                  <div className={`text-xs font-bold flex items-center gap-0.5 ${
                    yoyData.metrics.netProfit.diff >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}>
                    {yoyData.metrics.netProfit.diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    <span>{yoyData.metrics.netProfit.diff >= 0 ? '+' : ''}{yoyData.metrics.netProfit.pctChange}%</span>
                  </div>
                </div>
                <div className="text-[11px] text-gray-600 flex justify-between pt-1 border-t border-gray-200">
                  <span>বিগত বছর:</span>
                  <span className="font-mono font-semibold">{fmt(yoyData.metrics.netProfit.lastYear)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Comparative Financial Statement Table */}
          {yoyData && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-teal-700" />
                  <span>তুলনামূলক লাভ-ক্ষতি বিবরণী (Comparative Profit & Loss Statement)</span>
                </h4>
                <span className="text-xs text-gray-500 font-mono">মান: বিডিটি (BDT)</span>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left text-xs sm:text-sm border-collapse font-mono">
                  <thead className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200 font-sans">
                    <tr>
                      <th className="py-3 px-4 text-left">হিসাবের বিবরণ / খাত (Component)</th>
                      <th className="py-3 px-4 text-right">চলতি সময়কাল</th>
                      <th className="py-3 px-4 text-right">বিগত সময়কাল</th>
                      <th className="py-3 px-4 text-right">পার্থক্য (Variance)</th>
                      <th className="py-3 px-4 text-right">শতকরা পরিবর্তন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Revenue Row */}
                    <tr className="hover:bg-gray-50 font-bold">
                      <td className="py-2.5 px-4 font-sans text-gray-900">মোট বিক্রয় ও পরিচালন আয় (Total Revenue)</td>
                      <td className="py-2.5 px-4 text-right text-gray-900">{fmt(yoyData.metrics.revenue.thisYear)}</td>
                      <td className="py-2.5 px-4 text-right text-gray-700">{fmt(yoyData.metrics.revenue.lastYear)}</td>
                      <td className={`py-2.5 px-4 text-right ${
                        yoyData.metrics.revenue.diff >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}>
                        {yoyData.metrics.revenue.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.revenue.diff)}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-sans font-semibold ${
                        yoyData.metrics.revenue.pctChange >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}>
                        {yoyData.metrics.revenue.pctChange >= 0 ? '+' : ''}{yoyData.metrics.revenue.pctChange}%
                      </td>
                    </tr>

                    {/* COGS Row */}
                    <tr className="hover:bg-gray-50 text-gray-700">
                      <td className="py-2 px-4 font-sans pl-8 text-gray-600">বাদ: বিক্রিত পণ্যের ব্যয় (Cost of Goods Sold - COGS)</td>
                      <td className="py-2 px-4 text-right text-red-700">({fmt(yoyData.metrics.cogs.thisYear)})</td>
                      <td className="py-2 px-4 text-right text-red-700">({fmt(yoyData.metrics.cogs.lastYear)})</td>
                      <td className="py-2 px-4 text-right text-gray-600 font-sans">
                        {fmt(yoyData.metrics.cogs.diff)}
                      </td>
                      <td className="py-2 px-4 text-right font-sans text-gray-600">
                        {yoyData.metrics.cogs.pctChange >= 0 ? '+' : ''}{yoyData.metrics.cogs.pctChange}%
                      </td>
                    </tr>

                    {/* Gross Profit Row */}
                    <tr className="bg-emerald-50/50 font-bold border-y border-emerald-100">
                      <td className="py-2.5 px-4 font-sans text-emerald-950">মোট লাভ / প্রান্তিক আয় (Gross Profit)</td>
                      <td className="py-2.5 px-4 text-right text-emerald-900">{fmt(yoyData.metrics.grossProfit.thisYear)}</td>
                      <td className="py-2.5 px-4 text-right text-gray-800">{fmt(yoyData.metrics.grossProfit.lastYear)}</td>
                      <td className={`py-2.5 px-4 text-right ${
                        yoyData.metrics.grossProfit.diff >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}>
                        {yoyData.metrics.grossProfit.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.grossProfit.diff)}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-sans font-bold ${
                        yoyData.metrics.grossProfit.pctChange >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}>
                        {yoyData.metrics.grossProfit.pctChange >= 0 ? '+' : ''}{yoyData.metrics.grossProfit.pctChange}%
                      </td>
                    </tr>

                    {/* Section Header: Operating Expenses */}
                    <tr className="bg-gray-50/70 text-gray-800 font-bold font-sans">
                      <td colSpan={5} className="py-2 px-4 text-xs tracking-wider uppercase text-gray-500">
                        পরিচালন ব্যয়সমূহ (Operating Expenses Breakdown)
                      </td>
                    </tr>

                    {/* Expense Categories Breakdown */}
                    {yoyData.expenseBreakdown.map((item) => (
                      <tr key={item.category} className="hover:bg-gray-50 text-gray-700">
                        <td className="py-1.5 px-4 font-sans pl-8 text-gray-700">
                          {item.nameBn ? (
                            <span className="flex items-baseline gap-1.5">
                              <span className="font-bold text-gray-900 text-[14px]">{item.nameBn}</span>
                              <span className="text-xs text-gray-400 font-mono font-normal">({item.code})</span>
                            </span>
                          ) : (
                            item.category
                          )}
                        </td>
                        <td className="py-1.5 px-4 text-right text-gray-900">{fmt(item.thisYear)}</td>
                        <td className="py-1.5 px-4 text-right text-gray-600">{fmt(item.lastYear)}</td>
                        <td className="py-1.5 px-4 text-right text-gray-600">
                          {item.diff >= 0 ? '+' : ''}{fmt(item.diff)}
                        </td>
                        <td className="py-1.5 px-4 text-right font-sans text-gray-600">
                          {item.pctChange >= 0 ? '+' : ''}{item.pctChange}%
                        </td>
                      </tr>
                    ))}

                    {/* Total Operating Expenses Row */}
                    <tr className="bg-red-50/40 font-bold border-t border-red-100 text-red-900">
                      <td className="py-2.5 px-4 font-sans">মোট পরিচালন ব্যয় (Total Operating Expenses)</td>
                      <td className="py-2.5 px-4 text-right">({fmt(yoyData.metrics.operatingExpenses.thisYear)})</td>
                      <td className="py-2.5 px-4 text-right">({fmt(yoyData.metrics.operatingExpenses.lastYear)})</td>
                      <td className="py-2.5 px-4 text-right">
                        {yoyData.metrics.operatingExpenses.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.operatingExpenses.diff)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-sans">
                        {yoyData.metrics.operatingExpenses.pctChange >= 0 ? '+' : ''}{yoyData.metrics.operatingExpenses.pctChange}%
                      </td>
                    </tr>

                    {/* Operating Profit Row */}
                    <tr className="hover:bg-gray-50 font-bold">
                      <td className="py-2 px-4 font-sans text-gray-800">পরিচালন মুনাফা (Operating Profit)</td>
                      <td className="py-2 px-4 text-right text-gray-900">{fmt(yoyData.metrics.operatingProfit.thisYear)}</td>
                      <td className="py-2 px-4 text-right text-gray-700">{fmt(yoyData.metrics.operatingProfit.lastYear)}</td>
                      <td className="py-2 px-4 text-right text-gray-700">
                        {yoyData.metrics.operatingProfit.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.operatingProfit.diff)}
                      </td>
                      <td className="py-2 px-4 text-right font-sans">
                        {yoyData.metrics.operatingProfit.pctChange >= 0 ? '+' : ''}{yoyData.metrics.operatingProfit.pctChange}%
                      </td>
                    </tr>

                    {/* Other Net Income / Expense Row */}
                    <tr className="hover:bg-gray-50 text-gray-700">
                      <td className="py-1.5 px-4 font-sans pl-8 text-gray-600">অন্যান্য নিট আয় / (ব্যয়)</td>
                      <td className="py-1.5 px-4 text-right text-gray-800">{fmt(yoyData.metrics.otherNet.thisYear)}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">{fmt(yoyData.metrics.otherNet.lastYear)}</td>
                      <td className="py-1.5 px-4 text-right text-gray-600">
                        {yoyData.metrics.otherNet.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.otherNet.diff)}
                      </td>
                      <td className="py-1.5 px-4 text-right font-sans text-gray-600">
                        {yoyData.metrics.otherNet.pctChange >= 0 ? '+' : ''}{yoyData.metrics.otherNet.pctChange}%
                      </td>
                    </tr>

                    {/* NET PROFIT FINAL ROW */}
                    <tr className={`border-t-2 font-bold text-sm ${
                      yoyData.metrics.netProfit.thisYear >= 0
                        ? 'bg-emerald-100/70 border-emerald-400 text-emerald-950'
                        : 'bg-red-100/70 border-red-400 text-red-950'
                    }`}>
                      <td className="py-3 px-4 font-sans">খামারের নিট লাভ / (ক্ষতি) (Net Farm Profit / Loss)</td>
                      <td className="py-3 px-4 text-right text-base">{fmt(yoyData.metrics.netProfit.thisYear)}</td>
                      <td className="py-3 px-4 text-right">{fmt(yoyData.metrics.netProfit.lastYear)}</td>
                      <td className={`py-3 px-4 text-right ${
                        yoyData.metrics.netProfit.diff >= 0 ? 'text-emerald-800' : 'text-red-700'
                      }`}>
                        {yoyData.metrics.netProfit.diff >= 0 ? '+' : ''}{fmt(yoyData.metrics.netProfit.diff)}
                      </td>
                      <td className={`py-3 px-4 text-right font-sans text-base ${
                        yoyData.metrics.netProfit.pctChange >= 0 ? 'text-emerald-800' : 'text-red-700'
                      }`}>
                        {yoyData.metrics.netProfit.pctChange >= 0 ? '+' : ''}{yoyData.metrics.netProfit.pctChange}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Retained Earnings Note if Closed Period was matched */}
              {yoyData.closedPeriodRecord && (
                <div className="p-3.5 rounded-xl bg-purple-50/90 border border-purple-200 text-xs text-purple-950 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-purple-700 shrink-0" />
                    <span>
                      <strong>সমাপ্তি দাখিলা ও মালিকানা তহবিল:</strong> বিগত হিসাবকালের মোট নিট লাভ <strong>৳{yoyData.closedPeriodRecord.netProfitTransferred.toLocaleString('en-IN')}</strong> সফলভাবে পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings - Code 3050) হিসেবে স্থানান্তরিত হয়েছে।
                    </span>
                  </div>
                  <span className="font-mono text-[11px] bg-purple-200/80 text-purple-900 px-2 py-0.5 rounded font-semibold">
                    সমাপ্তির সময়: {new Date(yoyData.closedPeriodRecord.closedAt).toLocaleDateString('bn-BD')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================== REPORT 11: HERD SUMMARY & OPERATIONAL KPIS ===================== */}
      {activeReport === 'herdSummary' && herdKpiData && (
        <div className="space-y-4">
          {/* Herd Summary Header Illustration */}
          <div
            className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
            }}
          >
            <img
              src="/illustrations/Analysis-amico.svg"
              alt="Herd summary analysis illustration"
              loading="lazy"
              className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
            />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-purple-200/80 dark:border-purple-900/50 rounded-2xl p-4 sm:p-6 space-y-6 shadow-xs">
            {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-purple-100 pb-4">
            <div className="flex items-center gap-3">
              <IconTile icon={Activity} color="purple" size="md" rounded="xl" />
              <div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">
                  পালের সারসংক্ষেপ ও অপারেশনাল কেপিআই (Herd Summary & KPIs)
                </h3>
                <p className="text-[13px] text-gray-500 mt-0.5">
                  নির্ধারিত সময়সীমার গড় দৈনিক দুধ উৎপাদন, খাদ্য ব্যয় কার্যক্ষমতা ও পালের মৃত্যুহার বিশ্লেষণ
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
                সময়কাল: {herdKpiData.daysInPeriod} দিন
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-800">
                সক্রিয় পশু: {herdKpiData.activeAnimalsCount}টি
              </span>
            </div>
          </div>

          {/* 3 Primary Requested KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* KPI 1: Average Daily Milk Yield across all active animals */}
            <div className="bg-[#F8FAFC] rounded-2xl p-4 sm:p-5 border border-gray-200 flex flex-col justify-between space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-gray-500 tracking-wide">দুধ উৎপাদন কেপিআই</span>
                  <h4 className="text-[15px] font-bold text-gray-900 mt-0.5">গড় দৈনিক দুধ উৎপাদন</h4>
                </div>
                <div className="p-2 bg-emerald-100/80 rounded-xl text-emerald-800">
                  <Droplets className="w-5 h-5" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-bold font-mono text-[#15803D]">
                    {herdKpiData.avgDailyMilkPerActiveAnimal.toFixed(2)}
                  </span>
                  <span className="text-sm font-semibold text-gray-600">লিটার / দিন / পশু</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  সকল সক্রিয় পশুর সাপেক্ষে দৈনিক গড় হিসাব
                </p>
              </div>

              <div className="pt-2 border-t border-gray-200 space-y-1 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>পালে দৈনিক মোট দুধ:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.avgDailyMilkHerdTotal.toFixed(1)} লিটার / দিন
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>নির্বাচিত সময়কালে মোট দুধ:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.totalMilkLiters.toLocaleString()} লিটার
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>দুধ দোয়ানোর এন্ট্রি:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.milkEventsCount}টি
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200/70 text-[11px] text-emerald-900 font-medium">
                সূত্র: মোট দুধ ({herdKpiData.totalMilkLiters}L) ÷ ({herdKpiData.daysInPeriod} দিন × {herdKpiData.activeAnimalsCount} সক্রিয় পশু)
              </div>
            </div>

            {/* KPI 2: Total Feed Cost divided by Total Milk Liters (feed-cost-per-liter) */}
            <div className="bg-[#F8FAFC] rounded-2xl p-4 sm:p-5 border border-gray-200 flex flex-col justify-between space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-gray-500 tracking-wide">খাদ্য ব্যয় দক্ষতা কেপিআই</span>
                  <h4 className="text-[15px] font-bold text-gray-900 mt-0.5">দুধ প্রতি খাদ্য ব্যয়</h4>
                </div>
                <div className="p-2 bg-amber-100/80 rounded-xl text-amber-800">
                  <Coins className="w-5 h-5" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl sm:text-3xl font-bold font-mono text-amber-800">
                    {fmt(herdKpiData.feedCostPerLiter)}
                  </span>
                  <span className="text-sm font-semibold text-gray-600">/ লিটার</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  মোট খাদ্য ব্যয় ÷ মোট দুধ উৎপাদন (Liters)
                </p>
              </div>

              <div className="pt-2 border-t border-gray-200 space-y-1 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>সময়কালে মোট খাদ্য ব্যয়:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {fmt(herdKpiData.totalFeedCost)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>মোট উৎপাদিত দুধ:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.totalMilkLiters.toLocaleString()} লিটার
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>ব্যয় দক্ষতা সূচক:</span>
                  <span className="font-semibold">
                    {herdKpiData.totalMilkLiters === 0 ? (
                      <span className="text-gray-500">দুধের রেকর্ড নেই</span>
                    ) : herdKpiData.feedCostPerLiter <= 45 ? (
                      <span className="text-emerald-700">উচ্চ সাশ্রয়ী (≤ ৳৪৫)</span>
                    ) : herdKpiData.feedCostPerLiter <= 65 ? (
                      <span className="text-amber-700">পরিমিত (৳৪৫-৳৬৫)</span>
                    ) : (
                      <span className="text-rose-700">উচ্চ ব্যয় (&gt; ৳৬৫)</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200/70 text-[11px] text-amber-900 font-medium">
                সূত্র: মোট খাদ্য খরচ ({fmt(herdKpiData.totalFeedCost)}) ÷ মোট দুধ ({herdKpiData.totalMilkLiters} লিটার)
              </div>
            </div>

            {/* KPI 3: Mortality Rate (deceased ÷ total animals ever owned) for selected period */}
            <div className="bg-[#F8FAFC] rounded-2xl p-4 sm:p-5 border border-gray-200 flex flex-col justify-between space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs font-semibold text-gray-500 tracking-wide">স্বাস্থ্য ও নিরাপত্তা কেপিআই</span>
                  <h4 className="text-[15px] font-bold text-gray-900 mt-0.5">পালের মৃত্যুহার</h4>
                </div>
                <div className="p-2 bg-rose-100/80 rounded-xl text-rose-800">
                  <AlertCircle className="w-5 h-5" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl sm:text-3xl font-bold font-mono ${
                    herdKpiData.mortalityRate === 0
                      ? 'text-emerald-700'
                      : herdKpiData.mortalityRate <= 3
                      ? 'text-emerald-700'
                      : herdKpiData.mortalityRate <= 5
                      ? 'text-amber-700'
                      : 'text-rose-700'
                  }`}>
                    {herdKpiData.mortalityRate.toFixed(1)}%
                  </span>
                  <span className="text-sm font-semibold text-gray-600">মৃত্যুহার</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  নির্বাচিত সময়কালে মৃত ÷ খামারের সর্বমোট পশু
                </p>
              </div>

              <div className="pt-2 border-t border-gray-200 space-y-1 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>সময়কালে মৃত পশু:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.deceasedInPeriodCount}টি পশু
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>খামারের মোট মালিকানাধীন পশু:</span>
                  <span className="font-semibold text-gray-900 font-mono">
                    {herdKpiData.totalAnimalsEverOwned}টি
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>ঝুঁকি সূচক মানদণ্ড:</span>
                  <span className="font-semibold">
                    {herdKpiData.mortalityRate === 0 ? (
                      <span className="text-emerald-700">০% (নিখুঁত স্বাস্থ্য)</span>
                    ) : herdKpiData.mortalityRate <= 3 ? (
                      <span className="text-emerald-700">সন্তোষজনক (&lt; ৩%)</span>
                    ) : herdKpiData.mortalityRate <= 5 ? (
                      <span className="text-amber-700">মাঝারি ঝুঁকি (৩-৫%)</span>
                    ) : (
                      <span className="text-rose-700">উচ্চ সতর্কতা (&gt; ৫%)</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-rose-50 border border-rose-200/70 text-[11px] text-rose-900 font-medium">
                সূত্র: সময়কালে মৃত ({herdKpiData.deceasedInPeriodCount}) ÷ খামারের মোট পশু ({herdKpiData.totalAnimalsEverOwned})
              </div>
            </div>
          </div>

          {/* Herd Population Dynamics Cards */}
          <div>
            <h4 className="text-[14px] font-bold text-gray-900 mb-3 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-gray-600" />
              <span>খামারের পালের স্থিতি ও পরিসংখ্যান (Herd Population Dynamics)</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200">
                <div className="text-xs text-gray-500 font-medium">সর্বমোট মালিকানাধীন পশু</div>
                <div className="text-lg font-bold font-mono text-gray-900 mt-1">
                  {herdKpiData.totalAnimalsEverOwned} <span className="text-xs font-normal">টি</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">খামারের শুরু হতে এখন পর্যন্ত</div>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                <div className="text-xs text-emerald-800 font-medium">বর্তমানে সক্রিয় পশু</div>
                <div className="text-lg font-bold font-mono text-emerald-900 mt-1">
                  {herdKpiData.activeAnimalsCount} <span className="text-xs font-normal">টি</span>
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  {herdKpiData.totalAnimalsEverOwned > 0
                    ? `${((herdKpiData.activeAnimalsCount / herdKpiData.totalAnimalsEverOwned) * 100).toFixed(0)}% সক্রিয়`
                    : '০%'}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="text-xs text-amber-800 font-medium">বিক্রয়কৃত পশু</div>
                <div className="text-lg font-bold font-mono text-amber-900 mt-1">
                  {herdKpiData.soldAnimalsCount} <span className="text-xs font-normal">টি</span>
                </div>
                <div className="text-[11px] text-amber-700 mt-0.5">সফলভাবে বাজারজাতকৃত</div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200">
                <div className="text-xs text-rose-800 font-medium">মোট মৃত পশু (সর্বকাল)</div>
                <div className="text-lg font-bold font-mono text-rose-900 mt-1">
                  {herdKpiData.deceasedAnimalsCount} <span className="text-xs font-normal">টি</span>
                </div>
                <div className="text-[11px] text-rose-700 mt-0.5">
                  সময়কালে: {herdKpiData.deceasedInPeriodCount}টি
                </div>
              </div>
            </div>
          </div>

          {/* Species-wise Breakdown Table */}
          {herdKpiData.speciesBreakdown.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[14px] font-bold text-gray-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-gray-600" />
                <span>প্রজাতিভিত্তিক উৎপাদন ও ব্যয়ের বিভাজন (Species Breakdown)</span>
              </h4>
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-700">
                      <th className="py-2.5 px-3">প্রজাতি (Species)</th>
                      <th className="py-2.5 px-3 text-right">মোট পশু</th>
                      <th className="py-2.5 px-3 text-right">সক্রিয় পশু</th>
                      <th className="py-2.5 px-3 text-right">দুধ উৎপাদন</th>
                      <th className="py-2.5 px-3 text-right">খাদ্য ব্যয়</th>
                      <th className="py-2.5 px-3 text-right">দুধ প্রতি খাদ্য ব্যয়</th>
                      <th className="py-2.5 px-3 text-right">সময়কালে মৃত্যু</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-800 font-mono">
                    {herdKpiData.speciesBreakdown.map((sb) => {
                      const spName =
                        sb.species === 'CATTLE'
                          ? 'গরু (Cattle)'
                          : sb.species === 'GOAT'
                          ? 'ছাগল (Goat)'
                          : sb.species === 'SHEEP'
                          ? 'ভেড়া (Sheep)'
                          : sb.species;
                      const spFeedPerLiter = sb.milkLiters > 0 ? sb.feedCost / sb.milkLiters : 0;
                      return (
                        <tr key={sb.species} className="hover:bg-gray-50/80">
                          <td className="py-2 px-3 font-sans font-medium text-gray-900">{spName}</td>
                          <td className="py-2 px-3 text-right">{sb.total}টি</td>
                          <td className="py-2 px-3 text-right text-emerald-800 font-semibold">{sb.active}টি</td>
                          <td className="py-2 px-3 text-right">{sb.milkLiters.toLocaleString()} L</td>
                          <td className="py-2 px-3 text-right">{fmt(sb.feedCost)}</td>
                          <td className="py-2 px-3 text-right font-semibold">
                            {sb.milkLiters > 0 ? fmt(spFeedPerLiter) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-rose-700 font-semibold">{sb.deceased}টি</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* List of Deceased Animals in this Period (if any) */}
          {herdKpiData.deceasedAnimals && herdKpiData.deceasedAnimals.length > 0 && (
            <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200 space-y-2.5">
              <h5 className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-700" />
                <span>নির্বাচিত সময়কালে মৃত পশুর তালিকা ({herdKpiData.deceasedAnimals.length}টি)</span>
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {herdKpiData.deceasedAnimals.map((da) => (
                  <div key={da.id} className="p-2.5 bg-white rounded-lg border border-rose-100 text-xs text-gray-800 shadow-2xs">
                    <div className="font-bold text-rose-950 flex items-center justify-between">
                      <span>ট্যাগ: {da.id}</span>
                      <span className="text-[11px] font-mono text-gray-500">{da.saleDate || 'তারিখ নেই'}</span>
                    </div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      জাত: {da.breed} | প্রজাতি: {da.species}
                    </div>
                    {da.notes && (
                      <div className="text-[10px] text-gray-500 mt-1 line-clamp-1 italic">
                        নোট: {da.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </div>
  );
};
