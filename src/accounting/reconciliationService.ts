import { db } from '../db/indexedDb';
import { CANONICAL_ACCOUNTS } from './accountMapping';
import {
  calculateAnimalRecordedCosts,
  calculateFishBatchRecordedCosts,
  calculateCropCycleRecordedCosts,
  getFishBatchAccumulatedCost,
  getCropCycleAccumulatedCost
} from '../services/transactionService';
import {
  Animal,
  CashBankAccount,
  CropCycle,
  FishBatch,
  FixedAsset,
  InventoryItem,
  Investor,
  JournalEntry,
  Party
} from '../types';

export interface ReconciliationSubItem {
  id: string;
  name: string;
  code?: string;
  operationalAmount: number;
  glAmount?: number;
  difference?: number;
  status: 'MATCHED' | 'MISMATCH';
  notes?: string;
}

export interface ReconciliationCheck {
  id: string;
  itemNumber: number;
  checkNumber?: number;
  moduleBn: string;
  moduleNameBn?: string;
  moduleEn: string;
  moduleNameEn?: string;
  accountCode: string;
  accountNameBn: string;
  accountNameEn: string;
  operationalAmount: number;
  glAmount: number;
  difference: number;
  isMatched: boolean;
  status: 'MATCHED' | 'MISMATCH';
  notesBn: string;
  notes?: string;
  details?: ReconciliationSubItem[];
  subItems?: ReconciliationSubItem[];
}

export interface FullReconciliationReport {
  timestamp: string;
  asOfDate?: string;
  checks: ReconciliationCheck[];
  totalOperational: number;
  totalOperationalAmount?: number;
  totalGl: number;
  totalGlAmount?: number;
  totalDifference: number;
  matchedCount: number;
  mismatchCount: number;
  isAllMatched: boolean;
}

/**
 * Calculates net balance for one or more account codes from journal entries.
 * normalBalance:
 * - 'DEBIT': debit - credit
 * - 'CREDIT': credit - debit
 */
export function calculateGlBalanceForAccounts(
  journalEntries: JournalEntry[],
  accountCodes: string[],
  normalBalance: 'DEBIT' | 'CREDIT'
): number {
  let net = 0;
  const targetCodes = new Set(accountCodes);

  for (const entry of journalEntries) {
    for (const line of entry.lines || []) {
      if (targetCodes.has(line.accountCode)) {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        if (normalBalance === 'CREDIT') {
          net += credit - debit;
        } else {
          net += debit - credit;
        }
      }
    }
  }

  return Math.round(net * 100) / 100;
}

/**
 * Round utility to prevent floating-point precision artifacts
 */
function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * Check 1: Inventory subledger ↔ inventory GL
 * - Operational: Sum of (currentStock * avgCostPrice) across all inventory items
 * - GL: Net debit balance of inventory asset accounts (1051, 1052, 1053, 1055, 1056, and 1050 if legacy)
 */
export async function reconcileInventorySubledger(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const items: InventoryItem[] = await dbInstance.inventoryItems.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  let totalOperational = 0;
  const categoryBreakdown: Record<string, { name: string; opVal: number; glCode: string }> = {
    '1051': { name: 'মজুদ খাদ্য (Feed Inventory - 1051)', opVal: 0, glCode: CANONICAL_ACCOUNTS.FEED_INVENTORY },
    '1052': { name: 'মজুদ বীজ ও সার (Seed & Fert - 1052)', opVal: 0, glCode: CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY },
    '1053': { name: 'মজুদ কাঁচামাল ও ওষুধ (Raw Materials - 1053)', opVal: 0, glCode: CANONICAL_ACCOUNTS.RAW_MATERIALS },
    '1055': { name: 'উৎপাদিত পণ্য মজুদ (Finished Goods - 1055)', opVal: 0, glCode: CANONICAL_ACCOUNTS.FINISHED_GOODS },
    '1056': { name: 'প্যাকেজিং সামগ্রী (Packaging - 1056)', opVal: 0, glCode: CANONICAL_ACCOUNTS.PACKAGING_INVENTORY }
  };

  for (const item of items) {
    const qty = Math.max(0, Number(item.currentStock) || 0);
    const unitCost = Number(item.avgCostPrice) || Number((item as any).costPrice) || 0;
    const itemVal = round2(qty * unitCost);
    totalOperational = round2(totalOperational + itemVal);

    const cat = String(item.category || '').toUpperCase();
    if (cat.includes('FEED')) {
      categoryBreakdown['1051'].opVal = round2(categoryBreakdown['1051'].opVal + itemVal);
    } else if (cat.includes('SEED') || cat.includes('FERT')) {
      categoryBreakdown['1052'].opVal = round2(categoryBreakdown['1052'].opVal + itemVal);
    } else if (cat.includes('RAW') || cat.includes('MEDICINE')) {
      categoryBreakdown['1053'].opVal = round2(categoryBreakdown['1053'].opVal + itemVal);
    } else if (cat.includes('PACKAGING')) {
      categoryBreakdown['1056'].opVal = round2(categoryBreakdown['1056'].opVal + itemVal);
    } else {
      categoryBreakdown['1055'].opVal = round2(categoryBreakdown['1055'].opVal + itemVal);
    }
  }

  const inventoryCodes = [
    CANONICAL_ACCOUNTS.FEED_INVENTORY,
    CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY,
    CANONICAL_ACCOUNTS.RAW_MATERIALS,
    CANONICAL_ACCOUNTS.FINISHED_GOODS,
    CANONICAL_ACCOUNTS.PACKAGING_INVENTORY,
    '1050' // Legacy account check
  ];

  const glAmount = calculateGlBalanceForAccounts(entries, inventoryCodes, 'DEBIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  const details: ReconciliationSubItem[] = Object.entries(categoryBreakdown).map(([code, cat]) => {
    const catGl = calculateGlBalanceForAccounts(entries, [cat.glCode], 'DEBIT');
    const diff = round2(cat.opVal - catGl);
    return {
      id: `inv_cat_${code}`,
      name: cat.name,
      operationalAmount: cat.opVal,
      glAmount: catGl,
      difference: diff,
      status: Math.abs(diff) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল মজুদ মূল্য: ৳${cat.opVal}, জিএল ব্যালেন্স: ৳${catGl}`
    };
  });

  return {
    id: 'check_1_inventory',
    itemNumber: 1,
    moduleBn: 'ইনভেন্টরি সাবলেজার',
    moduleEn: 'Inventory Subledger',
    accountCode: '1051-1056',
    accountNameBn: 'মজুদ পণ্য সম্পদ হিসাবসমূহ (Inventory Assets)',
    accountNameEn: 'Inventory Asset Accounts (1051, 1052, 1053, 1055, 1056)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'ইনভেন্টরি সাবলেজারের মোট মজুদ মূল্য এবং সাধারণ খতিয়ান (GL) সম্পূর্ণ মিলেছে।'
      : `ইনভেন্টরি সাবলেজারের মূল্য এবং GL ব্যালেন্সের মধ্যে ৳${Math.abs(difference)} এর অমিল পাওয়া গেছে।`,
    details
  };
}

/**
 * Check 2: Customer balances ↔ AR GL
 * - Operational: Sum of balance of customers (parties with type 'CUSTOMER' or 'BOTH')
 * - GL: Net debit balance of Accounts Receivable (1040)
 */
export async function reconcileCustomerBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const parties: Party[] = await dbInstance.parties.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  const customers = parties.filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH');
  let totalOperational = 0;
  const customerDetails: ReconciliationSubItem[] = [];

  for (const c of customers) {
    const bal = round2(Number(c.balance) || 0);
    totalOperational = round2(totalOperational + bal);
    if (bal !== 0) {
      customerDetails.push({
        id: c.id,
        name: `${c.name} (${c.phone || 'ফোন নেই'})`,
        operationalAmount: bal,
        status: 'MATCHED',
        notes: `গ্রাহকের বর্তমান বাকি পাওনা: ৳${bal}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE], 'DEBIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_2_customers_ar',
    itemNumber: 2,
    moduleBn: 'গ্রাহক দেনাদার সাবলেজার',
    moduleEn: 'Customer Balances (Accounts Receivable)',
    accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
    accountNameBn: 'গ্রাহকের নিকট পাওনা (Accounts Receivable - 1040)',
    accountNameEn: 'Accounts Receivable (1040)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সকল গ্রাহকের মোট বাকি ব্যালেন্স এবং GL Accounts Receivable হিসাব নিখুঁতভাবে মিলেছে।'
      : `গ্রাহক পাওনা সাবলেজার এবং GL AR ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল বিদ্যমান।`,
    details: customerDetails
  };
}

/**
 * Check 3: Supplier balances ↔ AP GL
 * - Operational: Sum of balance of suppliers (parties with type 'SUPPLIER' or 'BOTH')
 * - GL: Net credit balance of Accounts Payable (2010)
 */
export async function reconcileSupplierBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const parties: Party[] = await dbInstance.parties.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  const suppliers = parties.filter((p) => p.type === 'SUPPLIER' || p.type === 'BOTH');
  let totalOperational = 0;
  const supplierDetails: ReconciliationSubItem[] = [];

  for (const s of suppliers) {
    const bal = round2(Number(s.balance) || 0);
    totalOperational = round2(totalOperational + bal);
    if (bal !== 0) {
      supplierDetails.push({
        id: s.id,
        name: `${s.name} (${s.phone || 'ফোন নেই'})`,
        operationalAmount: bal,
        status: 'MATCHED',
        notes: `সরবরাহকারীর বর্তমান প্রদেয় দেনা: ৳${bal}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE], 'CREDIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_3_suppliers_ap',
    itemNumber: 3,
    moduleBn: 'সরবরাহকারী পাওনাদার সাবলেজার',
    moduleEn: 'Supplier Balances (Accounts Payable)',
    accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE,
    accountNameBn: 'সরবরাহকারীর নিকট দেনা (Accounts Payable - 2010)',
    accountNameEn: 'Accounts Payable (2010)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সকল সরবরাহকারীর মোট প্রদেয় দেনা এবং GL Accounts Payable হিসাব সম্পূর্ণ মিলেছে।'
      : `সরবরাহকারী দেনা সাবলেজার এবং GL AP ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল পাওয়া গেছে।`,
    details: supplierDetails
  };
}

/**
 * Check 4: Fish batch accumulated cost ↔ Fish production accounting
 * - Operational: Sum of accumulated recorded costs for active fish batches
 * - GL/Accounting: Sum of batch-linked accounting debits/net remaining costs across active batches
 */
export async function reconcileFishBatchProduction(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const batches: FishBatch[] = await dbInstance.fishBatches.toArray();
  const activeBatches = batches.filter((b) => b.status === 'ACTIVE');

  let totalOperational = 0;
  let totalAccounting = 0;
  const batchDetails: ReconciliationSubItem[] = [];

  for (const batch of activeBatches) {
    const opBreakdown = calculateFishBatchRecordedCosts(batch);
    const opCost = opBreakdown.totalRecordedCost;
    totalOperational = round2(totalOperational + opCost);

    let accountingCost = 0;
    try {
      const status = await getFishBatchAccumulatedCost(batch.id, dbInstance);
      accountingCost = status.accountingDebits;
    } catch {
      accountingCost = 0;
    }

    totalAccounting = round2(totalAccounting + accountingCost);
    const diff = round2(opCost - accountingCost);

    batchDetails.push({
      id: batch.id,
      name: `ব্যাচ ${batch.id} (${batch.species} - ${batch.pondName})`,
      operationalAmount: opCost,
      glAmount: accountingCost,
      difference: diff,
      status: Math.abs(diff) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল ব্যয়: ৳${opCost}, হিসাবভুক্ত ডেবিট: ৳${accountingCost}`
    });
  }

  const difference = round2(totalOperational - totalAccounting);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_4_fish_production',
    itemNumber: 4,
    moduleBn: 'মাছ চাষ উৎপাদন হিসাব',
    moduleEn: 'Fish Batch Production Accounting',
    accountCode: '1580/1054',
    accountNameBn: 'মাছের ব্যাচ ব্যয় হিসাবায়ন (Fish Production Records vs Accounting)',
    accountNameEn: 'Fish Batch Production Accounting (Biological Assets / WIP)',
    operationalAmount: totalOperational,
    glAmount: totalAccounting,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সক্রিয় মাছের ব্যাচসমূহের অপারেশনাল ব্যয় এবং জাবেদায় হিসাবভুক্ত উৎপাদন ব্যয় সম্পূর্ণ সামঞ্জস্যপূর্ণ।'
      : `সক্রিয় মাছের ব্যাচসমূহের অপারেশনাল রেকর্ড এবং অনুমোদিত হিসাবভুক্ত ব্যয়ের মাঝে ৳${Math.abs(difference)} এর পার্থক্য রয়েছে।`,
    details: batchDetails
  };
}

/**
 * Check 5: Crop cycle accumulated cost ↔ Crop WIP accounting
 * - Operational: Sum of accumulated recorded costs for active/unharvested crop cycles
 * - GL/Accounting: Sum of cycle-linked accounting WIP debits / net remaining costs across active cycles
 */
export async function reconcileCropCycleWip(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const cycles: CropCycle[] = await dbInstance.cropCycles.toArray();
  const activeCycles = cycles.filter((c) => c.status !== 'HARVESTED' && c.status !== 'CLOSED');

  let totalOperational = 0;
  let totalAccounting = 0;
  const cycleDetails: ReconciliationSubItem[] = [];

  for (const cycle of activeCycles) {
    const opBreakdown = calculateCropCycleRecordedCosts(cycle);
    const opCost = opBreakdown.totalRecordedCost;
    totalOperational = round2(totalOperational + opCost);

    let accountingCost = 0;
    try {
      const status = await getCropCycleAccumulatedCost(cycle.id, dbInstance);
      accountingCost = status.accountingDebits;
    } catch {
      accountingCost = 0;
    }

    totalAccounting = round2(totalAccounting + accountingCost);
    const diff = round2(opCost - accountingCost);

    cycleDetails.push({
      id: cycle.id,
      name: `চক্র ${cycle.id} (${cycle.cropName} - ${cycle.plotName})`,
      operationalAmount: opCost,
      glAmount: accountingCost,
      difference: diff,
      status: Math.abs(diff) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল খরচ: ৳${opCost}, হিসাবভুক্ত ডেবিট: ৳${accountingCost}`
    });
  }

  const difference = round2(totalOperational - totalAccounting);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_5_crop_wip',
    itemNumber: 5,
    moduleBn: 'শস্য চাষ উৎপাদন ও প্রক্রিয়াধীন পণ্য (WIP)',
    moduleEn: 'Crop Cycle Accumulated Cost vs WIP Accounting',
    accountCode: CANONICAL_ACCOUNTS.WIP,
    accountNameBn: 'প্রক্রিয়াধীন পণ্য (Crop Work in Progress - 1054)',
    accountNameEn: 'Crop WIP Accounting (1054)',
    operationalAmount: totalOperational,
    glAmount: totalAccounting,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সক্রিয় শস্য চক্রসমূহের অপারেশনাল ব্যয় এবং WIP উৎপাদন হিসাব সম্পূর্ণ মিলেছে।'
      : `সক্রিয় শস্য চক্রসমূহের অপারেশনাল খরচ ও WIP হিসাবভুক্তির মাঝে ৳${Math.abs(difference)} এর অমিল পাওয়া গেছে।`,
    details: cycleDetails
  };
}

/**
 * Check 6: Livestock accumulated cost ↔ biological asset GL
 * - Operational: Sum of accumulated costs of all active animals
 * - GL: Net debit balance of GL account 1580 (Livestock Assets)
 */
export async function reconcileLivestockBiologicalAssets(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const animals: Animal[] = await dbInstance.animals.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  const activeAnimals = animals.filter((a) => a.status === 'ACTIVE');
  let totalOperational = 0;
  const animalDetails: ReconciliationSubItem[] = [];

  for (const animal of activeAnimals) {
    const costBreakdown = calculateAnimalRecordedCosts(animal);
    const opCost = costBreakdown.totalRecordedCost;
    totalOperational = round2(totalOperational + opCost);

    if (opCost > 0) {
      animalDetails.push({
        id: animal.id,
        name: `${(animal as any).name || animal.species || 'পশু'} (ট্যাগ: ${(animal as any).tagNumber || animal.tag || animal.id})`,
        operationalAmount: opCost,
        status: 'MATCHED',
        notes: `পশুর ক্রয় ও লালন-পালন ব্যয়: ৳${opCost}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS], 'DEBIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_6_livestock_assets',
    itemNumber: 6,
    moduleBn: 'পশুসম্পদ জৈবিক সম্পদ হিসাব',
    moduleEn: 'Livestock Accumulated Cost vs Biological Asset GL',
    accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
    accountNameBn: 'পশুসম্পদ ও জৈবিক সম্পদ (Biological Assets - 1580)',
    accountNameEn: 'Livestock & Biological Assets (1580)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সক্রিয় গবাদিপশুর মোট অপারেশনাল ব্যয় এবং GL Biological Asset ব্যালেন্স সম্পূর্ণ সমন্বিত।'
      : `গবাদিপশুর অপারেশনাল ব্যয় এবং GL 1580 ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর পার্থক্য চিহ্নিত হয়েছে।`,
    details: animalDetails
  };
}

/**
 * Check 7: Fixed Asset register ↔ fixed asset GL
 * - Operational: Sum of originalCost across active fixed assets
 * - GL: Net debit balance of Fixed Asset GL accounts (1510, 1520, 1530, 1550)
 */
export async function reconcileFixedAssetRegister(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const assets: FixedAsset[] = await dbInstance.fixedAssets.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  const activeAssets = assets.filter((a) => a.status === 'ACTIVE' || (a.status as any) !== 'DISPOSED');
  let totalOperational = 0;
  const assetDetails: ReconciliationSubItem[] = [];

  for (const asset of activeAssets) {
    const cost = round2(Number(asset.originalCost) || 0);
    totalOperational = round2(totalOperational + cost);
    assetDetails.push({
      id: asset.id,
      name: `${asset.name} (${asset.category})`,
      operationalAmount: cost,
      status: 'MATCHED',
      notes: `ক্রয়মূল্য: ৳${cost}, বর্তমান বহিমূল্য: ৳${asset.currentBookValue ?? (cost - (asset.accumulatedDepreciation || 0))}`
    });
  }

  const fixedAssetCodes = [
    CANONICAL_ACCOUNTS.LAND, // 1510
    CANONICAL_ACCOUNTS.BUILDINGS, // 1520
    CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE, // 1530
    CANONICAL_ACCOUNTS.MACHINERY // 1550
  ];

  const glAmount = calculateGlBalanceForAccounts(entries, fixedAssetCodes, 'DEBIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_7_fixed_assets',
    itemNumber: 7,
    moduleBn: 'স্থায়ী সম্পদ রেজিস্টার',
    moduleEn: 'Fixed Asset Register vs Fixed Asset GL',
    accountCode: '1510-1550',
    accountNameBn: 'স্থায়ী সম্পদ খতিয়ান (Land, Buildings, Ponds, Machinery)',
    accountNameEn: 'Fixed Assets (1510, 1520, 1530, 1550)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'স্থায়ী সম্পদ রেজিস্টারের মোট মূলধন ব্যয় এবং GL স্থায়ী সম্পদ খতিয়ান সম্পূর্ণ মিলেছে।'
      : `স্থায়ী সম্পদ রেজিস্টার ও GL ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল বিদ্যমান।`,
    details: assetDetails
  };
}

/**
 * Check 8: Accumulated depreciation ↔ depreciation GL
 * - Operational: Sum of accumulatedDepreciation across active fixed assets
 * - GL: Net credit balance of GL account 1590 (Accumulated Depreciation)
 */
export async function reconcileAccumulatedDepreciation(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const assets: FixedAsset[] = await dbInstance.fixedAssets.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  const activeAssets = assets.filter((a) => a.status === 'ACTIVE' || (a.status as any) !== 'DISPOSED');
  let totalOperational = 0;
  const depDetails: ReconciliationSubItem[] = [];

  for (const asset of activeAssets) {
    const dep = round2(Number(asset.accumulatedDepreciation) || 0);
    totalOperational = round2(totalOperational + dep);
    if (dep > 0) {
      depDetails.push({
        id: asset.id,
        name: `${asset.name} (${asset.category})`,
        operationalAmount: dep,
        status: 'MATCHED',
        notes: `রেজিস্টারে পুঞ্জীভূত অবচয়: ৳${dep}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION], 'CREDIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_8_accumulated_depreciation',
    itemNumber: 8,
    moduleBn: 'পুঞ্জীভূত অবচয় রেজিস্টার',
    moduleEn: 'Accumulated Depreciation vs GL Contra-Asset',
    accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION,
    accountNameBn: 'পুঞ্জীভূত অবচয় কন্ট্রা-সম্পদ হিসাব (Accumulated Depreciation - 1590)',
    accountNameEn: 'Accumulated Depreciation (1590)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সম্পদ রেজিস্টারে সংরক্ষিত পুঞ্জীভূত অবচয় এবং GL 1590 ব্যালেন্স নিখুঁতভাবে মিলেছে।'
      : `অবচয় রেজিস্টার ও GL 1590 ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল বিদ্যমান।`,
    details: depDetails
  };
}

/**
 * Check 9: Investor capital records ↔ Investor Capital GL
 * - Operational: Sum of currentCapitalBalance (fallback to capitalAmount/capitalContributed) for all investors
 * - GL: Net credit balance of GL account 3020 (Investor Capital)
 */
export async function reconcileInvestorCapital(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const investors: Investor[] = await dbInstance.investors.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  let totalOperational = 0;
  const investorDetails: ReconciliationSubItem[] = [];

  for (const inv of investors) {
    const cap = round2(
      Number(inv.currentCapitalBalance ?? inv.capitalAmount ?? inv.capitalContributed ?? (inv as any).totalContribution ?? 0)
    );
    totalOperational = round2(totalOperational + cap);
    investorDetails.push({
      id: inv.id,
      name: `${inv.name} (${inv.phone || 'ফোন নেই'})`,
      operationalAmount: cap,
      status: 'MATCHED',
      notes: `বিনিয়োগকারীর মূলধন স্থিতি: ৳${cap} (লভ্যাংশ অনুপাত: ${inv.profitSharingRatio ?? inv.profitSharePercentage ?? 0}%)`
    });
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.INVESTOR_CAPITAL], 'CREDIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_9_investor_capital',
    itemNumber: 9,
    moduleBn: 'বিনিয়োগকারীর মূলধন রেজিস্টার',
    moduleEn: 'Investor Capital Records vs Investor Capital GL',
    accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL,
    accountNameBn: 'বিনিয়োগকারীর মূলধন মালিকানা স্বত্ব (Investor Capital - 3020)',
    accountNameEn: 'Investor Capital (3020)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'বিনিয়োগকারীদের ব্যক্তিগত মূলধন স্থিতি এবং GL Investor Capital হিসাব সম্পূর্ণ সমন্বিত।'
      : `বিনিয়োগকারীদের রেজিস্টার ও GL 3020 মূলধন ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল রয়েছে।`,
    details: investorDetails
  };
}

/**
 * Check 10: Investor profit payable ↔ Investor Profit Payable GL
 * - Operational: Sum of profitPayable across all investors
 * - GL: Net credit balance of GL account 2050 (Investor Profit Payable)
 */
export async function reconcileInvestorProfitPayable(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const investors: Investor[] = await dbInstance.investors.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  let totalOperational = 0;
  const payableDetails: ReconciliationSubItem[] = [];

  for (const inv of investors) {
    const payable = round2(Number(inv.profitPayable) || 0);
    totalOperational = round2(totalOperational + payable);
    if (payable > 0) {
      payableDetails.push({
        id: inv.id,
        name: `${inv.name} (${inv.phone || 'ফোন নেই'})`,
        operationalAmount: payable,
        status: 'MATCHED',
        notes: `অপ্রদত্ত মুনাফা পাওনা: ৳${payable}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE], 'CREDIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  return {
    id: 'check_10_investor_profit_payable',
    itemNumber: 10,
    moduleBn: 'বিনিয়োগকারী প্রদেয় মুনাফা',
    moduleEn: 'Investor Profit Payable vs GL',
    accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE,
    accountNameBn: 'বিনিয়োগকারীর প্রদেয় লভ্যাংশ দায় (Investor Profit Payable - 2050)',
    accountNameEn: 'Investor Profit Payable (2050)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'বিনিয়োগকারীদের বকেয়া লভ্যাংশ স্থিতি এবং GL Investor Profit Payable হিসাব সম্পূর্ণ মিলেছে।'
      : `বিনিয়োগকারী প্রদেয় মুনাফা রেজিস্টার ও GL 2050 ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল বিদ্যমান।`,
    details: payableDetails
  };
}

/**
 * Check 11: Cash/bank operational balances ↔ GL
 * - Operational: Sum of currentBalance across all accounts in db.cashBankAccounts
 * - GL: Net debit balance of GL Cash and Bank accounts (1010, 1020, 1030)
 */
export async function reconcileCashBankBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[]
): Promise<ReconciliationCheck> {
  const accounts: CashBankAccount[] = await dbInstance.cashBankAccounts.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());

  let totalOperational = 0;
  let cashOperational = 0;
  let bankOperational = 0;
  const cbDetails: ReconciliationSubItem[] = [];

  for (const acc of accounts) {
    const bal = round2(Number(acc.currentBalance ?? (acc as any).balance ?? 0));
    totalOperational = round2(totalOperational + bal);

    if (acc.accountType === 'CASH') {
      cashOperational = round2(cashOperational + bal);
    } else {
      bankOperational = round2(bankOperational + bal);
    }

    cbDetails.push({
      id: acc.id,
      name: `${acc.name} (${acc.accountType})`,
      operationalAmount: bal,
      status: 'MATCHED',
      notes: `হিসাব স্থিতি: ৳${bal} [${acc.bankName ? `${acc.bankName} - ${acc.accountNumber || ''}` : 'নগদ ক্যাশ'}]`
    });
  }

  const cashBankCodes = [
    CANONICAL_ACCOUNTS.CASH, // 1010
    CANONICAL_ACCOUNTS.PETTY_CASH, // 1020
    CANONICAL_ACCOUNTS.BANK // 1030
  ];

  const glAmount = calculateGlBalanceForAccounts(entries, cashBankCodes, 'DEBIT');
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  // Breakdown detail comparing Cash vs Bank GL
  const cashGl = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.CASH, CANONICAL_ACCOUNTS.PETTY_CASH], 'DEBIT');
  const bankGl = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.BANK], 'DEBIT');

  cbDetails.unshift(
    {
      id: 'sub_cash_group',
      name: 'হাতে নগদ ও পেটি ক্যাশ (GL 1010 & 1020)',
      operationalAmount: cashOperational,
      glAmount: cashGl,
      difference: round2(cashOperational - cashGl),
      status: Math.abs(cashOperational - cashGl) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল ক্যাশ: ৳${cashOperational}, GL ব্যালেন্স: ৳${cashGl}`
    },
    {
      id: 'sub_bank_group',
      name: 'ব্যাংক ও মোবাইল ব্যাংকিং (GL 1030)',
      operationalAmount: bankOperational,
      glAmount: bankGl,
      difference: round2(bankOperational - bankGl),
      status: Math.abs(bankOperational - bankGl) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল ব্যাংক/MFS: ৳${bankOperational}, GL ব্যালেন্স: ৳${bankGl}`
    }
  );

  return {
    id: 'check_11_cash_bank',
    itemNumber: 11,
    moduleBn: 'নগদ ও ব্যাংক পরিচালনা হিসাব',
    moduleEn: 'Cash & Bank Operational Balances vs GL',
    accountCode: '1010, 1020, 1030',
    accountNameBn: 'নগদ ও ব্যাংক হিসাবসমূহ (Cash, Petty Cash, Bank Accounts)',
    accountNameEn: 'Cash & Bank Accounts (1010, 1020, 1030)',
    operationalAmount: totalOperational,
    glAmount,
    difference,
    isMatched,
    status: isMatched ? 'MATCHED' : 'MISMATCH',
    notesBn: isMatched
      ? 'সকল নগদ ও ব্যাংক হিসাবের অপারেশনাল স্থিতি এবং GL নগদ/ব্যাংক খতিয়ান সম্পূর্ণ নিখুঁত মিলেছে।'
      : `অপারেশনাল ক্যাশ/ব্যাংক স্থিতি এবং GL ক্যাশ/ব্যাংক ব্যালেন্সের মাঝে ৳${Math.abs(difference)} এর অমিল শনাক্ত হয়েছে।`,
    details: cbDetails
  };
}

/**
 * Runs all 11 internal accounting reconciliation checks.
 * Completely non-destructive: does not create journals, does not modify historical data.
 */
export async function runAccountingReconciliation(
  dbInstance: any = db
): Promise<FullReconciliationReport> {
  const journalEntries: JournalEntry[] = await dbInstance.journalEntries.toArray();

  const [
    check1,
    check2,
    check3,
    check4,
    check5,
    check6,
    check7,
    check8,
    check9,
    check10,
    check11
  ] = await Promise.all([
    reconcileInventorySubledger(dbInstance, journalEntries),
    reconcileCustomerBalances(dbInstance, journalEntries),
    reconcileSupplierBalances(dbInstance, journalEntries),
    reconcileFishBatchProduction(dbInstance, journalEntries),
    reconcileCropCycleWip(dbInstance, journalEntries),
    reconcileLivestockBiologicalAssets(dbInstance, journalEntries),
    reconcileFixedAssetRegister(dbInstance, journalEntries),
    reconcileAccumulatedDepreciation(dbInstance, journalEntries),
    reconcileInvestorCapital(dbInstance, journalEntries),
    reconcileInvestorProfitPayable(dbInstance, journalEntries),
    reconcileCashBankBalances(dbInstance, journalEntries)
  ]);

  const checks: ReconciliationCheck[] = [
    check1,
    check2,
    check3,
    check4,
    check5,
    check6,
    check7,
    check8,
    check9,
    check10,
    check11
  ];

  let totalOperational = 0;
  let totalGl = 0;
  let matchedCount = 0;
  let mismatchCount = 0;

  for (const check of checks) {
    totalOperational = round2(totalOperational + check.operationalAmount);
    totalGl = round2(totalGl + check.glAmount);
    if (check.isMatched) {
      matchedCount++;
    } else {
      mismatchCount++;
    }
  }

  const totalDifference = round2(totalOperational - totalGl);

  const enrichedChecks: ReconciliationCheck[] = checks.map((c) => ({
    ...c,
    checkNumber: c.itemNumber,
    moduleNameBn: c.moduleBn,
    moduleNameEn: c.moduleEn,
    notes: c.notesBn,
    subItems: c.details || []
  }));

  const now = new Date().toISOString();
  return {
    timestamp: now,
    asOfDate: now.split('T')[0],
    checks: enrichedChecks,
    totalOperational,
    totalOperationalAmount: totalOperational,
    totalGl,
    totalGlAmount: totalGl,
    totalDifference,
    matchedCount,
    mismatchCount,
    isAllMatched: mismatchCount === 0
  };
}
