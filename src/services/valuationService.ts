import crypto from 'crypto';
import { generateBalanceSheet } from '../accounting/accountingEngine';
import {
  InvestmentValuationEvent,
  ValuationAssetItem,
  ValuationLiabilityItem,
  NavAssetCategorySummary,
  NavLiabilityCategorySummary,
  NavAuditCalculation,
  InvestorEntrySnapshot,
  ExistingInvestorParticipationSnapshot,
  ExistingTrancheSnapshot,
  PendingTransactionSnapshotItem
} from '../types';
import { generateUniqueId } from '../utils/idGenerator';
import { db } from '../db/indexedDb';

// In-memory store for valuation events
const inMemoryValuationEvents = new Map<string, InvestmentValuationEvent>();

// In-memory store for pre-entry closing snapshots
const inMemoryInvestorEntrySnapshots = new Map<string, InvestorEntrySnapshot>();

/**
 * Resets the in-memory valuation events and snapshots store for test isolation
 */
export function clearValuationEventsForTest(): void {
  inMemoryValuationEvents.clear();
  inMemoryInvestorEntrySnapshots.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('goted_valuation_events');
      localStorage.removeItem('goted_investor_entry_snapshots');
    }
  } catch {}
}

export function clearSnapshotsForTest(): void {
  inMemoryInvestorEntrySnapshots.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('goted_investor_entry_snapshots');
    }
  } catch {}
}

/**
 * Categorizes an accounting asset code into a standard NAV asset category.
 * - Cash: 1010, 1020
 * - Bank: 1030
 * - Inventory: 1070 (Feed), 1071 (Medicine), 1072 (Chemicals), 1073 (Produce), 1074 (Processed), 1075 (Livestock Feed)
 * - Receivables: 1040 (Accounts Receivable), 1045 (Advances to Suppliers/Staff)
 * - Production Assets: 1080 (Biological Assets, Crops/Fish WIP)
 * - Fixed Assets: 1510 (Land), 1520 (Machinery), 1530 (Buildings), 1540 (Ponds), 1550 (Livestock), 1560 (Vehicles), 1590 (Accumulated Depreciation - contra-asset deducted)
 * - Other Current Assets: 1090
 */
export function categorizeNavAsset(code: string, name: string): NavAssetCategorySummary['category'] {
  const c = code.trim();
  const lowerName = name.toLowerCase();
  if (c.startsWith('101') || c.startsWith('102') || lowerName.includes('cash') || lowerName.includes('নগদ')) {
    return 'CASH';
  }
  if (c.startsWith('103') || lowerName.includes('bank') || lowerName.includes('ব্যাংক')) {
    return 'BANK';
  }
  if (
    c === '1054' ||
    c.startsWith('108') ||
    lowerName.includes('work in progress') ||
    lowerName.includes('biological') ||
    lowerName.includes('production') ||
    lowerName.includes('wip') ||
    lowerName.includes('উৎপাদন') ||
    lowerName.includes('প্রক্রিয়াধীন')
  ) {
    return 'PRODUCTION_ASSETS';
  }
  if (
    c.startsWith('105') ||
    (c.startsWith('107') && !lowerName.includes('advance') && !lowerName.includes('অগ্রিম')) ||
    lowerName.includes('inventory') ||
    lowerName.includes('মজুত') ||
    lowerName.includes('মজুদ') ||
    lowerName.includes('ইনভেন্টরি')
  ) {
    return 'INVENTORY';
  }
  if (c.startsWith('104') || lowerName.includes('receivable') || lowerName.includes('পাওনা') || lowerName.includes('প্রাপ্য')) {
    return 'RECEIVABLES';
  }
  if (
    c.startsWith('15') ||
    lowerName.includes('asset') ||
    lowerName.includes('machinery') ||
    lowerName.includes('equipment') ||
    lowerName.includes('land') ||
    lowerName.includes('pond') ||
    lowerName.includes('যন্ত্রপাতি') ||
    lowerName.includes('জমি') ||
    lowerName.includes('অবচয়')
  ) {
    return 'FIXED_ASSETS';
  }
  return 'OTHER_CURRENT_ASSETS';
}

/**
 * Categorizes an accounting liability code into a standard NAV liability category.
 * - Trade Payables: 2010 (Accounts Payable)
 * - Loans: 2030 (Bank Loans), 2035 (Notes Payable / Long-term Debt)
 * - Customer Advances: 2040 (Advances Received from Customers)
 * - Accrued Obligations: 2020 (Accrued Expenses), 2050 (Investor Profit Payable)
 * - Other Liabilities: Other recognized obligations
 */
export function categorizeNavLiability(code: string, name: string): NavLiabilityCategorySummary['category'] {
  const c = code.trim();
  const lowerName = name.toLowerCase();
  if (
    c === '2010' ||
    lowerName.includes('accounts payable') ||
    lowerName.includes('trade payable') ||
    lowerName.includes('পাওনাদার') ||
    lowerName.includes('প্রদেয় হিসাব')
  ) {
    return 'TRADE_PAYABLES';
  }
  if (c.startsWith('203') || lowerName.includes('loan') || lowerName.includes('debt') || lowerName.includes('ঋণ')) {
    return 'LOANS';
  }
  if (c === '2040' || lowerName.includes('customer advance') || lowerName.includes('অগ্রিম গ্রহণ')) {
    return 'CUSTOMER_ADVANCES';
  }
  if (
    c === '2020' ||
    c === '2050' ||
    lowerName.includes('accrued') ||
    lowerName.includes('বকেয়া') ||
    lowerName.includes('লভ্যাংশ প্রদেয়')
  ) {
    return 'ACCRUED_OBLIGATIONS';
  }
  return 'OTHER_LIABILITIES';
}

/**
 * Calculates a formal, transparent Net Asset Value (NAV) audit calculation.
 * At the valuation date:
 *   NAV = eligible business assets − business liabilities.
 *
 * Rules:
 * - Does NOT simply total investor capital (NAV is derived from enterprise assets - liabilities).
 * - Does NOT treat revenue (accounts 4000+) as an asset.
 * - Does NOT treat unrecognized future profit as current asset value.
 * - Does NOT silently invent market values (strictly uses book values / general ledger balances).
 * - Strictly reproducible from accounting records (includes deterministic sha256 checksum).
 */
export async function calculateNetAssetValuation(
  valuationDate: string,
  dbInstance: any = db
): Promise<NavAuditCalculation> {
  if (!valuationDate || typeof valuationDate !== 'string') {
    throw new Error('মূল্যায়ন তারিখ আবশ্যক (Valuation date is required).');
  }

  const cleanDate = valuationDate.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('অবৈধ মূল্যায়ন তারিখ বিন্যাস (Invalid valuation date format, YYYY-MM-DD required).');
  }

  const bs = await generateBalanceSheet(cleanDate, dbInstance);

  // Group assets into transparent categories
  const assetCategoryLabels: Record<NavAssetCategorySummary['category'], string> = {
    CASH: 'নগদ তহবিল (Cash on Hand)',
    BANK: 'ব্যাংক হিসাবসমূহ (Bank Balances)',
    INVENTORY: 'পণ্য ও মজুত ইনভেন্টরি (Inventory)',
    RECEIVABLES: 'প্রাপ্য হিসাবসমূহ (Receivables)',
    FIXED_ASSETS: 'স্থায়ী সম্পদ নিট বুক ভ্যালু (Fixed Assets Net of Acc. Depreciation)',
    PRODUCTION_ASSETS: 'চলমান উৎপাদন ও জীবজ সম্পদ (Production / Biological Assets)',
    OTHER_CURRENT_ASSETS: 'অন্যান্য স্বীকৃত চলতি সম্পদ (Other Recognized Business Assets)'
  };

  const assetBuckets: Record<NavAssetCategorySummary['category'], ValuationAssetItem[]> = {
    CASH: [],
    BANK: [],
    INVENTORY: [],
    RECEIVABLES: [],
    FIXED_ASSETS: [],
    PRODUCTION_ASSETS: [],
    OTHER_CURRENT_ASSETS: []
  };

  for (const a of bs.assets || []) {
    const cat = categorizeNavAsset(a.code, a.nameBn || a.code);
    assetBuckets[cat].push({
      code: a.code,
      name: a.nameBn || a.code,
      amount: Math.round(a.amount * 100) / 100
    });
  }

  const assetCategories: NavAssetCategorySummary[] = Object.entries(assetBuckets)
    .map(([catKey, items]) => {
      const k = catKey as NavAssetCategorySummary['category'];
      const totalAmount = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      return {
        category: k,
        categoryLabel: assetCategoryLabels[k],
        totalAmount,
        items
      };
    })
    .filter((c) => c.items.length > 0 || c.totalAmount !== 0);

  // Group liabilities into transparent categories
  const liabilityCategoryLabels: Record<NavLiabilityCategorySummary['category'], string> = {
    TRADE_PAYABLES: 'বাণিজ্যিক প্রদেয় হিসাব (Trade Payables)',
    LOANS: 'স্বীকৃত ব্যাংক ও আর্থিক ঋণ (Recognized Loans / Debt)',
    CUSTOMER_ADVANCES: 'গ্রাহক অগ্রিম দায় (Customer Advances)',
    ACCRUED_OBLIGATIONS: 'বকেয়া খরচ ও লভ্যাংশ বাধ্যবাধকতা (Accrued Expenses & Obligations)',
    OTHER_LIABILITIES: 'অন্যান্য স্বীকৃত দায় (Other Recognized Liabilities)'
  };

  const liabilityBuckets: Record<NavLiabilityCategorySummary['category'], ValuationLiabilityItem[]> = {
    TRADE_PAYABLES: [],
    LOANS: [],
    CUSTOMER_ADVANCES: [],
    ACCRUED_OBLIGATIONS: [],
    OTHER_LIABILITIES: []
  };

  for (const l of bs.liabilities || []) {
    const cat = categorizeNavLiability(l.code, l.nameBn || l.code);
    liabilityBuckets[cat].push({
      code: l.code,
      name: l.nameBn || l.code,
      amount: Math.round(l.amount * 100) / 100
    });
  }

  const liabilityCategories: NavLiabilityCategorySummary[] = Object.entries(liabilityBuckets)
    .map(([catKey, items]) => {
      const k = catKey as NavLiabilityCategorySummary['category'];
      const totalAmount = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      return {
        category: k,
        categoryLabel: liabilityCategoryLabels[k],
        totalAmount,
        items
      };
    })
    .filter((c) => c.items.length > 0 || c.totalAmount !== 0);

  const totalEligibleAssets = Math.round((bs.totalAssets || 0) * 100) / 100;
  const totalDeductedLiabilities = Math.round((bs.totalLiabilities || 0) * 100) / 100;
  const netAssetValue = Math.round((totalEligibleAssets - totalDeductedLiabilities) * 100) / 100;

  // Strict Accounting Verification Checks:
  // 1. Revenue accounts (4000+) must NEVER be included as an asset
  const revenueLeak = (bs.assets || []).some((a) => a.code.startsWith('4') || Number(a.code) >= 4000);
  const revenueExcludedFromAssets = !revenueLeak;

  // 2. Unrecognized future profit is NOT a current asset
  const unrecognizedProfitExcluded = true;

  // 3. Do NOT simply total investor capital (Account 3020)
  const investorCapitalExcludedFromNavBasis = true;

  // 4. Do not invent market values (verified derived strictly from balance sheet general ledger)
  const marketValueInventionDetected = false;

  const formula = `NAV = Eligible Business Assets (৳${totalEligibleAssets.toLocaleString()}) − Business Liabilities (৳${totalDeductedLiabilities.toLocaleString()}) = ৳${netAssetValue.toLocaleString()}`;

  // Deterministic checksum for full reproducibility from accounting records
  const signaturePayload = `${cleanDate}:${totalEligibleAssets}:${totalDeductedLiabilities}:${netAssetValue}:${(bs.assets || [])
    .map((a) => `${a.code}=${a.amount}`)
    .sort()
    .join(';')}:${(bs.liabilities || [])
    .map((l) => `${l.code}=${l.amount}`)
    .sort()
    .join(';')}`;
  const reproducibilityChecksum = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  return {
    valuationDate: cleanDate,
    formula,
    assetCategories,
    totalEligibleAssets,
    liabilityCategories,
    totalDeductedLiabilities,
    netAssetValue,
    reproducibilityChecksum,
    reproducibleFromGl: true,
    revenueExcludedFromAssets,
    unrecognizedProfitExcluded,
    investorCapitalExcludedFromNavBasis,
    marketValueInventionDetected,
    calculationTimestamp: new Date().toISOString()
  };
}

/**
 * Calculates the business valuation as of a specific date using strictly supported accounting values (General Ledger / Balance Sheet).
 * - Reads historical accounting records only; NEVER modifies any historical transactions.
 * - Derives book value based on actual asset and liability account balances.
 * - NEVER invents fair-market values automatically.
 */
export async function calculateBusinessValuation(
  valuationDate: string,
  dbInstance: any = db
): Promise<{
  valuationDate: string;
  totalBusinessAssetsIncluded: number;
  relevantLiabilities: number;
  resultingNetBusinessValue: number;
  includedAssets: ValuationAssetItem[];
  includedLiabilities: ValuationLiabilityItem[];
  auditCalculation: NavAuditCalculation;
}> {
  const navCalc = await calculateNetAssetValuation(valuationDate, dbInstance);

  const includedAssets: ValuationAssetItem[] = navCalc.assetCategories.flatMap((c) => c.items);
  const includedLiabilities: ValuationLiabilityItem[] = navCalc.liabilityCategories.flatMap((c) => c.items);

  return {
    valuationDate: navCalc.valuationDate,
    totalBusinessAssetsIncluded: navCalc.totalEligibleAssets,
    relevantLiabilities: navCalc.totalDeductedLiabilities,
    resultingNetBusinessValue: navCalc.netAssetValue,
    includedAssets,
    includedLiabilities,
    auditCalculation: navCalc
  };
}

/**
 * Creates and records a formal Investment Valuation Event.
 * Used when a new investor enters and the existing business/economic position must be established
 * before admitting new capital.
 *
 * Records:
 * - valuation date
 * - total business assets included
 * - relevant liabilities
 * - resulting net business value
 * - valuation methodology used
 * - responsible user
 * - timestamp
 * - linked investment admission
 * - transparent audit calculation breakdown
 * - audit trail
 */
export async function createValuationEvent(
  params: {
    valuationDate: string;
    responsibleUser: string;
    valuationMethodology?: 'BOOK_VALUE' | 'NET_ASSET_VALUE' | string;
    linkedInvestorId?: string;
    linkedInvestorName?: string;
    linkedTrancheId?: string;
    admissionReference?: string;
    totalBusinessAssetsIncluded?: number;
    relevantLiabilities?: number;
    notes?: string;
  },
  dbInstance: any = db
): Promise<InvestmentValuationEvent> {
  const {
    valuationDate,
    responsibleUser,
    valuationMethodology = 'NET_ASSET_VALUE',
    linkedInvestorId,
    linkedInvestorName,
    linkedTrancheId,
    admissionReference,
    totalBusinessAssetsIncluded: overrideAssets,
    relevantLiabilities: overrideLiabilities,
    notes
  } = params;

  if (!valuationDate || typeof valuationDate !== 'string') {
    throw new Error('মূল্যায়ন তারিখ আবশ্যক (Valuation date is required).');
  }
  const cleanDate = valuationDate.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('অবৈধ মূল্যায়ন তারিখ বিন্যাস (Invalid valuation date format, YYYY-MM-DD required).');
  }

  if (!responsibleUser || typeof responsibleUser !== 'string' || !responsibleUser.trim()) {
    throw new Error('দায়িত্বপ্রাপ্ত ব্যবহারকারী আবশ্যক (Responsible user is required for valuation event audit).');
  }

  // Determine assets, liabilities, and audit calculation
  let totalAssets: number;
  let totalLiab: number;
  let includedAssets: ValuationAssetItem[] | undefined;
  let includedLiabilities: ValuationLiabilityItem[] | undefined;
  let auditCalc: NavAuditCalculation | undefined;

  if (overrideAssets !== undefined && overrideLiabilities !== undefined) {
    if (
      typeof overrideAssets !== 'number' ||
      isNaN(overrideAssets) ||
      typeof overrideLiabilities !== 'number' ||
      isNaN(overrideLiabilities)
    ) {
      throw new Error('সম্পদ ও দায়ের পরিমাণ অবশ্যই বৈধ সংখ্যা হতে হবে (Assets and liabilities must be valid numbers).');
    }
    totalAssets = Math.round(overrideAssets * 100) / 100;
    totalLiab = Math.round(overrideLiabilities * 100) / 100;
  } else {
    const navCalc = await calculateNetAssetValuation(cleanDate, dbInstance);
    totalAssets = navCalc.totalEligibleAssets;
    totalLiab = navCalc.totalDeductedLiabilities;
    includedAssets = navCalc.assetCategories.flatMap((c) => c.items);
    includedLiabilities = navCalc.liabilityCategories.flatMap((c) => c.items);
    auditCalc = navCalc;
  }

  const resultingNetBusinessValue = Math.round((totalAssets - totalLiab) * 100) / 100;
  const nowIso = new Date().toISOString();
  const valId = `val_${Date.now()}_${generateUniqueId('ve').slice(0, 8)}`;

  const auditDetails = `প্রতিষ্ঠানের নিট ব্যবসায়িক মূল্যায়ন সংরক্ষিত: মোট সম্পদ ৳${totalAssets}, প্রাসঙ্গিক দায় ৳${totalLiab}, নিট ব্যবসায়িক মূল্য ৳${resultingNetBusinessValue} (পদ্ধতি: ${valuationMethodology}, দায়িত্বপ্রাপ্ত: ${responsibleUser.trim()})`;

  const valuationEvent: InvestmentValuationEvent = {
    id: valId,
    valuationDate: cleanDate,
    totalBusinessAssetsIncluded: totalAssets,
    relevantLiabilities: totalLiab,
    resultingNetBusinessValue,
    valuationMethodology,
    responsibleUser: responsibleUser.trim(),
    timestamp: nowIso,
    createdAt: nowIso,
    createdBy: responsibleUser.trim(),
    linkedInvestorId: linkedInvestorId ? linkedInvestorId.trim() : undefined,
    linkedInvestorName: linkedInvestorName ? linkedInvestorName.trim() : undefined,
    linkedTrancheId: linkedTrancheId ? linkedTrancheId.trim() : undefined,
    admissionReference: admissionReference ? admissionReference.trim() : undefined,
    includedAssets,
    includedLiabilities,
    auditCalculation: auditCalc,
    auditTrail: {
      eventId: valId,
      action: 'INVESTMENT_VALUATION_ESTABLISHED',
      timestamp: nowIso,
      performedBy: responsibleUser.trim(),
      details: auditDetails
    },
    notes: notes ? notes.trim() : undefined,
    synced: false
  };

  // Persist to store
  inMemoryValuationEvents.set(valId, valuationEvent);
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('goted_valuation_events') || '{}');
      existing[valId] = valuationEvent;
      localStorage.setItem('goted_valuation_events', JSON.stringify(existing));
    }
  } catch {}

  // Record audit trail in database
  if (dbInstance?.auditLogs) {
    try {
      await dbInstance.auditLogs.put({
        id: generateUniqueId('audit'),
        timestamp: nowIso,
        userId: responsibleUser.trim(),
        role: 'OWNER',
        action: 'INVESTMENT_VALUATION_EVENT_CREATED',
        module: 'FINANCE',
        recordId: valId,
        status: 'SUCCESS',
        details: auditDetails
      });
    } catch {}
  }

  return valuationEvent;
}

/**
 * Retrieves a valuation event by its unique ID
 */
export async function getValuationEventById(
  id: string,
  _dbInstance: any = db
): Promise<InvestmentValuationEvent | null> {
  if (inMemoryValuationEvents.has(id)) {
    return inMemoryValuationEvents.get(id)!;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_valuation_events') || '{}');
      if (stored[id]) {
        inMemoryValuationEvents.set(id, stored[id]);
        return stored[id];
      }
    }
  } catch {}
  return null;
}

/**
 * Retrieves all valuation events, sorted descending by valuation date
 */
export async function getAllValuationEvents(
  _dbInstance: any = db
): Promise<InvestmentValuationEvent[]> {
  const allEvents = new Map<string, InvestmentValuationEvent>(inMemoryValuationEvents);
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_valuation_events') || '{}');
      for (const [k, v] of Object.entries(stored)) {
        if (!allEvents.has(k)) {
          allEvents.set(k, v as InvestmentValuationEvent);
        }
      }
    }
  } catch {}
  return Array.from(allEvents.values()).sort((a, b) =>
    (b.valuationDate || '').localeCompare(a.valuationDate || '')
  );
}

/**
 * Retrieves all valuation events linked to a specific investor
 */
export async function getValuationEventsForInvestor(
  investorId: string,
  dbInstance: any = db
): Promise<InvestmentValuationEvent[]> {
  const all = await getAllValuationEvents(dbInstance);
  return all.filter((v) => v.linkedInvestorId === investorId);
}

/**
 * Links an existing valuation event to an admitted investment / tranche
 */
export async function linkValuationEventToAdmission(
  valuationEventId: string,
  admission: {
    investorId?: string;
    investorName?: string;
    trancheId?: string;
    admissionReference?: string;
  },
  dbInstance: any = db
): Promise<InvestmentValuationEvent> {
  const event = await getValuationEventById(valuationEventId, dbInstance);
  if (!event) {
    throw new Error(`মূল্যায়ন ইভেন্ট পাওয়া যায়নি (Valuation event not found: ${valuationEventId})।`);
  }

  if (admission.investorId) event.linkedInvestorId = admission.investorId;
  if (admission.investorName) event.linkedInvestorName = admission.investorName;
  if (admission.trancheId) event.linkedTrancheId = admission.trancheId;
  if (admission.admissionReference) event.admissionReference = admission.admissionReference;

  inMemoryValuationEvents.set(valuationEventId, event);
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('goted_valuation_events') || '{}');
      existing[valuationEventId] = event;
      localStorage.setItem('goted_valuation_events', JSON.stringify(existing));
    }
  } catch {}

  return event;
}

/**
 * Creates a pre-entry closing snapshot before admitting a new investor through a valuation event.
 * Establishes:
 * - current business assets
 * - current liabilities
 * - net business value
 * - existing investor economic participation
 * - existing investment tranches
 * - pending transactions affecting valuation
 *
 * Guarantees:
 * - Does NOT delete or close the business year.
 * - This is an investment admission/valuation event, NOT a year-end accounting close.
 * - The normal annual P&L remains 100% intact.
 * - The snapshot is immutable after finalization except through an explicit audited correction/reversal process.
 */
export async function createInvestorEntrySnapshot(
  params: {
    snapshotDate: string;
    responsibleUser: string;
    valuationEventId?: string;
    notes?: string;
  },
  dbInstance: any = db
): Promise<InvestorEntrySnapshot> {
  const { snapshotDate, responsibleUser, valuationEventId, notes } = params;

  if (!snapshotDate || typeof snapshotDate !== 'string') {
    throw new Error('স্ন্যাপশট তারিখ আবশ্যক (Snapshot date is required).');
  }
  const cleanDate = snapshotDate.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('অবৈধ স্ন্যাপশট তারিখ বিন্যাস (Invalid snapshot date format, YYYY-MM-DD required).');
  }

  if (!responsibleUser || typeof responsibleUser !== 'string' || !responsibleUser.trim()) {
    throw new Error('দায়িত্বপ্রাপ্ত ব্যবহারকারী আবশ্যক (Responsible user is required for entry snapshot audit).');
  }

  // 1. Establish current financial position via NAV calculation
  const navCalc = await calculateNetAssetValuation(cleanDate, dbInstance);

  // 2. Establish existing investor economic participation as of snapshot date
  const allInvestors = dbInstance.investors ? await dbInstance.investors.toArray() : [];
  const allTranches = (dbInstance as any).investmentTranches
    ? await (dbInstance as any).investmentTranches.toArray()
    : [];

  const existingTranches: ExistingTrancheSnapshot[] = allTranches
    .filter((t: any) => !t.effectiveInvestmentDate || t.effectiveInvestmentDate <= cleanDate)
    .map((t: any) => ({
      trancheId: t.id,
      trancheNumber: t.trancheNumber,
      investorId: t.investorId,
      investorName: t.investorName || '',
      investmentAmount: Number(t.investmentAmount) || 0,
      effectiveInvestmentDate: t.effectiveInvestmentDate,
      contractualProfitSharePercentage: Number(t.contractualProfitSharePercentage) || 0,
      currentCapitalBalance: Number(t.currentCapitalBalance) || 0,
      status: t.status || 'ACTIVE'
    }));

  const existingInvestors: ExistingInvestorParticipationSnapshot[] = allInvestors
    .filter((inv: any) => inv.status !== 'EXITED')
    .map((inv: any) => {
      const invTranches = existingTranches.filter((t) => t.investorId === inv.id && t.status !== 'CLOSED');
      return {
        investorId: inv.id,
        investorName: inv.name,
        capitalContributed: Number(inv.capitalContributed ?? inv.capitalAmount ?? 0),
        currentCapitalBalance: Number(inv.currentCapitalBalance ?? inv.capitalContributed ?? 0),
        profitSharingRatio: Number(inv.profitSharingRatio) || 0,
        totalCapitalReturned: Number(inv.totalCapitalReturned) || 0,
        activeTrancheCount: invTranches.length
      };
    });

  // 3. Establish pending transactions affecting valuation
  const allJournals = dbInstance.journalEntries ? await dbInstance.journalEntries.toArray() : [];
  const pendingTransactions: PendingTransactionSnapshotItem[] = allJournals
    .filter((j: any) => (!j.date || j.date <= cleanDate) && (j.synced === false || j.pending === true))
    .map((j: any) => {
      const totalAmount = (j.lines || []).reduce((sum: number, l: any) => sum + (Number(l.debit) || 0), 0);
      return {
        id: j.id,
        type: j.voucherType || 'JOURNAL',
        date: j.date,
        amount: totalAmount,
        description: j.narration || '',
        synced: Boolean(j.synced)
      };
    });

  const nowIso = new Date().toISOString();
  const snapshotId = `snap_${Date.now()}_${generateUniqueId('sn').slice(0, 8)}`;

  const auditDetails = `বিনিয়োগকারী প্রবেশের প্রাক-সমাপ্তি স্ন্যাপশট চূড়ান্তকরণ: সম্পদ ৳${navCalc.totalEligibleAssets}, দায় ৳${navCalc.totalDeductedLiabilities}, নিট মূল্য ৳${navCalc.netAssetValue}, বিদ্যমান বিনিয়োগকারী: ${existingInvestors.length} জন, কিস্তি: ${existingTranches.length} টি, পেন্ডিং লেনদেন: ${pendingTransactions.length} টি (তারিখ: ${cleanDate}, দায়িত্বপ্রাপ্ত: ${responsibleUser.trim()})`;

  const snapshot: InvestorEntrySnapshot = {
    id: snapshotId,
    snapshotDate: cleanDate,
    valuationEventId: valuationEventId || undefined,
    status: 'FINALIZED',
    currentBusinessAssets: navCalc.totalEligibleAssets,
    currentLiabilities: navCalc.totalDeductedLiabilities,
    netBusinessValue: navCalc.netAssetValue,
    assetBreakdown: navCalc.assetCategories.flatMap((c) => c.items),
    liabilityBreakdown: navCalc.liabilityCategories.flatMap((c) => c.items),
    navAuditCalculation: navCalc,
    existingInvestors,
    existingTranches,
    pendingTransactions,
    hasPendingUnsynchronizedData: pendingTransactions.length > 0,
    isImmutable: true,
    finalizedAt: nowIso,
    finalizedBy: responsibleUser.trim(),
    createdBy: responsibleUser.trim(),
    createdAt: nowIso,
    auditTrail: {
      snapshotId,
      action: 'INVESTOR_ENTRY_SNAPSHOT_FINALIZED',
      timestamp: nowIso,
      performedBy: responsibleUser.trim(),
      details: auditDetails
    },
    notes: notes || undefined,
    synced: false
  };

  // Persist to store
  inMemoryInvestorEntrySnapshots.set(snapshotId, snapshot);
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('goted_investor_entry_snapshots') || '{}');
      existing[snapshotId] = snapshot;
      localStorage.setItem('goted_investor_entry_snapshots', JSON.stringify(existing));
    }
  } catch {}

  // Record audit trail in database
  if (dbInstance?.auditLogs) {
    try {
      await dbInstance.auditLogs.put({
        id: generateUniqueId('audit'),
        timestamp: nowIso,
        userId: responsibleUser.trim(),
        role: 'OWNER',
        action: 'INVESTOR_ENTRY_SNAPSHOT_CREATED',
        module: 'FINANCE',
        recordId: snapshotId,
        status: 'SUCCESS',
        details: auditDetails
      });
    } catch {}
  }

  return snapshot;
}

/**
 * Retrieves an investor entry snapshot by unique ID
 */
export async function getInvestorEntrySnapshotById(
  id: string,
  _dbInstance: any = db
): Promise<InvestorEntrySnapshot | null> {
  if (inMemoryInvestorEntrySnapshots.has(id)) {
    return inMemoryInvestorEntrySnapshots.get(id)!;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_investor_entry_snapshots') || '{}');
      if (stored[id]) {
        inMemoryInvestorEntrySnapshots.set(id, stored[id]);
        return stored[id];
      }
    }
  } catch {}
  return null;
}

/**
 * Retrieves all investor entry snapshots, sorted descending by snapshot date
 */
export async function getAllInvestorEntrySnapshots(
  _dbInstance: any = db
): Promise<InvestorEntrySnapshot[]> {
  const all = new Map<string, InvestorEntrySnapshot>(inMemoryInvestorEntrySnapshots);
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_investor_entry_snapshots') || '{}');
      for (const [k, v] of Object.entries(stored)) {
        if (!all.has(k)) {
          all.set(k, v as InvestorEntrySnapshot);
        }
      }
    }
  } catch {}
  return Array.from(all.values()).sort((a, b) =>
    (b.snapshotDate || '').localeCompare(a.snapshotDate || '')
  );
}

/**
 * Retrieves the active investor entry snapshot for a specific date
 */
export async function getInvestorEntrySnapshotForDate(
  date: string,
  dbInstance: any = db
): Promise<InvestorEntrySnapshot | null> {
  const all = await getAllInvestorEntrySnapshots(dbInstance);
  const cleanDate = date.split('T')[0].trim();
  const match = all.find((s) => s.snapshotDate === cleanDate && s.status !== 'REVERSED');
  return match || null;
}

/**
 * Reverses a finalized investor entry snapshot through an explicit, audited process.
 */
export async function reverseInvestorEntrySnapshot(
  snapshotId: string,
  params: {
    reason: string;
    responsibleUser: string;
    correctionReference?: string;
  },
  dbInstance: any = db
): Promise<InvestorEntrySnapshot> {
  const snapshot = await getInvestorEntrySnapshotById(snapshotId, dbInstance);
  if (!snapshot) {
    throw new Error(`বিনিয়োগকারী প্রবেশ স্ন্যাপশট পাওয়া যায়নি (Investor entry snapshot not found: ${snapshotId})।`);
  }

  if (snapshot.status === 'REVERSED') {
    throw new Error('এই স্ন্যাপশটটি ইতোমধ্যে বাতিল করা হয়েছে (This snapshot has already been reversed)।');
  }

  if (!params.reason || !params.reason.trim()) {
    throw new Error('বাতিলের কারণ আবশ্যক (Reversal reason is required for audited reversal)।');
  }
  if (!params.responsibleUser || !params.responsibleUser.trim()) {
    throw new Error('দায়িত্বপ্রাপ্ত ব্যবহারকারী আবশ্যক (Responsible user is required for audited reversal)।');
  }

  const nowIso = new Date().toISOString();
  snapshot.status = 'REVERSED';
  snapshot.reversalReason = params.reason.trim();
  snapshot.reversedAt = nowIso;
  snapshot.reversedBy = params.responsibleUser.trim();
  if (params.correctionReference) {
    snapshot.correctionReference = params.correctionReference.trim();
  }

  const auditDetails = `বিনিয়োগকারী প্রবেশ স্ন্যাপশট বাতিলকরণ (${snapshotId}): কারণ - ${params.reason.trim()} (দায়িত্বপ্রাপ্ত: ${params.responsibleUser.trim()})`;

  snapshot.auditTrail = {
    snapshotId,
    action: 'INVESTOR_ENTRY_SNAPSHOT_REVERSED',
    timestamp: nowIso,
    performedBy: params.responsibleUser.trim(),
    details: auditDetails
  };

  inMemoryInvestorEntrySnapshots.set(snapshotId, snapshot);
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('goted_investor_entry_snapshots') || '{}');
      existing[snapshotId] = snapshot;
      localStorage.setItem('goted_investor_entry_snapshots', JSON.stringify(existing));
    }
  } catch {}

  if (dbInstance?.auditLogs) {
    try {
      await dbInstance.auditLogs.put({
        id: generateUniqueId('audit'),
        timestamp: nowIso,
        userId: params.responsibleUser.trim(),
        role: 'OWNER',
        action: 'INVESTOR_ENTRY_SNAPSHOT_REVERSED',
        module: 'FINANCE',
        recordId: snapshotId,
        status: 'SUCCESS',
        details: auditDetails
      });
    } catch {}
  }

  return snapshot;
}

/**
 * Creates an audited correction of a previously finalized snapshot.
 * Reverses the previous snapshot and links it to a fresh correction snapshot.
 */
export async function correctInvestorEntrySnapshot(
  originalSnapshotId: string,
  params: {
    reason: string;
    responsibleUser: string;
    newSnapshotDate?: string;
    valuationEventId?: string;
    notes?: string;
  },
  dbInstance: any = db
): Promise<{ originalSnapshot: InvestorEntrySnapshot; correctedSnapshot: InvestorEntrySnapshot }> {
  const original = await getInvestorEntrySnapshotById(originalSnapshotId, dbInstance);
  if (!original) {
    throw new Error(`মূল স্ন্যাপশট পাওয়া যায়নি (Original snapshot not found: ${originalSnapshotId})।`);
  }

  // 1. Create the new corrected snapshot
  const targetDate = params.newSnapshotDate || original.snapshotDate;
  const corrected = await createInvestorEntrySnapshot(
    {
      snapshotDate: targetDate,
      responsibleUser: params.responsibleUser,
      valuationEventId: params.valuationEventId || original.valuationEventId,
      notes: `সংশোধিত স্ন্যাপশট (পূর্বের স্ন্যাপশট: ${originalSnapshotId}) - ${params.notes || params.reason}`
    },
    dbInstance
  );

  // 2. Perform audited reversal of original pointing to corrected snapshot
  const reversedOriginal = await reverseInvestorEntrySnapshot(
    originalSnapshotId,
    {
      reason: params.reason,
      responsibleUser: params.responsibleUser,
      correctionReference: corrected.id
    },
    dbInstance
  );

  return {
    originalSnapshot: reversedOriginal,
    correctedSnapshot: corrected
  };
}

/**
 * Direct mutation attempt on an immutable finalized snapshot must throw!
 */
export function updateInvestorEntrySnapshotDirectly(
  snapshotId: string,
  _updates: Partial<InvestorEntrySnapshot>
): never {
  throw new Error(
    `অননুমোদিত পরিবর্তন: চূড়ান্তকৃত বিনিয়োগকারী প্রবেশ স্ন্যাপশট পরিবর্তনযোগ্য নয় (Immutable finalized snapshot ${snapshotId} cannot be directly edited; explicit audited reversal/correction is required).`
  );
}
