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
  Party,
  PaymentRecord,
  Purchase,
  Sale,
  StockMovement
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
 * When asOfDate is provided, strictly filters entries on or before asOfDate.
 * normalBalance:
 * - 'DEBIT': debit - credit
 * - 'CREDIT': credit - debit
 */
export function calculateGlBalanceForAccounts(
  journalEntries: JournalEntry[],
  accountCodes: string[],
  normalBalance: 'DEBIT' | 'CREDIT',
  asOfDate?: string
): number {
  let net = 0;
  const targetCodes = new Set(accountCodes);
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  for (const entry of journalEntries) {
    if (cleanAsOf && entry.date) {
      const entryDate = String(entry.date).slice(0, 10);
      if (entryDate > cleanAsOf) {
        continue;
      }
    }

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
 * Calculates inventory item valuation (quantity, weighted average unit cost, total value)
 * as of a specific date (historical calculation).
 * - For asOfDate, includes inventory movements and costs only up to that date.
 * - Does not use today's average cost when asOfDate is provided.
 * - Uses only cost information available on or before that date.
 * - Preserves current weighted-average behavior when asOfDate is not specified.
 */
export function calculateHistoricalInventoryValuation(
  item: InventoryItem,
  movements: StockMovement[],
  asOfDate?: string
): {
  quantity: number;
  unitCost: number;
  totalValue: number;
  stockMovementQuantity: number;
  recordQuantity: number;
  stockMovementValue: number;
  recordValue: number;
  isQuantityMatched: boolean;
  isValueMatched: boolean;
} {
  const currentStock = Math.max(0, Number(item.currentStock) || 0);
  const currentAvgCost = Math.max(0, Number(item.avgCostPrice) || Number((item as any).costPrice) || 0);
  const recordCurrentVal = round2(currentStock * currentAvgCost);

  // When asOfDate is not specified, preserve current weighted-average behavior
  if (!asOfDate) {
    const totalVal = recordCurrentVal;
    return {
      quantity: currentStock,
      unitCost: currentAvgCost,
      totalValue: totalVal,
      stockMovementQuantity: currentStock,
      recordQuantity: currentStock,
      stockMovementValue: totalVal,
      recordValue: totalVal,
      isQuantityMatched: true,
      isValueMatched: true
    };
  }

  const cleanAsOf = asOfDate.slice(0, 10);
  const itemMovements = (movements || []).filter((m) => m.itemId === item.id);

  // If item was created after asOfDate, it did not exist yet
  const createdAfter = Boolean(
    ((item as any).createdAt && String((item as any).createdAt).slice(0, 10) > cleanAsOf) ||
    ((item as any).date && String((item as any).date).slice(0, 10) > cleanAsOf)
  );
  if (createdAfter) {
    return {
      quantity: 0,
      unitCost: 0,
      totalValue: 0,
      stockMovementQuantity: 0,
      recordQuantity: 0,
      stockMovementValue: 0,
      recordValue: 0,
      isQuantityMatched: true,
      isValueMatched: true
    };
  }

  // If there are no movements recorded for this item
  if (itemMovements.length === 0) {
    const totalVal = recordCurrentVal;
    return {
      quantity: currentStock,
      unitCost: currentAvgCost,
      totalValue: totalVal,
      stockMovementQuantity: currentStock,
      recordQuantity: currentStock,
      stockMovementValue: totalVal,
      recordValue: totalVal,
      isQuantityMatched: true,
      isValueMatched: true
    };
  }

  // Helper to determine movement delta
  function getMovementDelta(m: StockMovement): number {
    const type = String(m.movementType || '').toUpperCase();
    const mQty = Math.abs(Number(m.quantity) || 0);

    if (
      type === 'PURCHASE' ||
      type === 'PRODUCTION' ||
      type === 'HARVEST' ||
      type === 'OPENING'
    ) {
      return mQty;
    }
    if (
      type === 'CONSUMPTION' ||
      type === 'SALE' ||
      type === 'WASTE' ||
      type === 'DAMAGE'
    ) {
      return -mQty;
    }
    if (type === 'ADJUSTMENT') {
      const isDecrease =
        (m as any).adjustmentType === 'DECREASE' ||
        Number(m.quantity) < 0 ||
        (m.notes || '').includes('হ্রাস') ||
        (m.notes || '').toLowerCase().includes('decrease') ||
        (m.notes || '').toLowerCase().includes('loss') ||
        (m.notes || '').toLowerCase().includes('damage');
      return isDecrease ? -mQty : mQty;
    }
    if (type === 'TRANSFER') {
      return Number(m.quantity) || 0;
    }
    return 0;
  }

  const movementsUpToAsOf = itemMovements.filter(
    (m) => m.date && String(m.date).slice(0, 10) <= cleanAsOf
  );
  const movementsAfterAsOf = itemMovements.filter(
    (m) => m.date && String(m.date).slice(0, 10) > cleanAsOf
  );

  const allMovementsNet = itemMovements.reduce((sum, m) => sum + getMovementDelta(m), 0);
  const untrackedBase = Math.max(0, currentStock - allMovementsNet);
  const baseStock = untrackedBase;

  // Unwind post-date inflows and outflows to compute unwound record stock and cost
  let laterInflowQty = 0;
  let laterInflowCost = 0;
  let laterOutflowQty = 0;
  let laterOutflowCost = 0;

  for (const m of movementsAfterAsOf) {
    const type = String(m.movementType || '').toUpperCase();
    const mQty = Math.abs(Number(m.quantity) || 0);
    const mUnitCost = Number(m.unitCost) || 0;
    const mTotalVal = Number(m.totalValue) || round2(mQty * (mUnitCost || currentAvgCost));

    const isInflow =
      type === 'PURCHASE' ||
      type === 'PRODUCTION' ||
      type === 'HARVEST' ||
      type === 'OPENING';
    const isOutflow =
      type === 'CONSUMPTION' ||
      type === 'SALE' ||
      type === 'WASTE' ||
      type === 'DAMAGE';

    if (isInflow) {
      laterInflowQty = round2(laterInflowQty + mQty);
      laterInflowCost = round2(laterInflowCost + mTotalVal);
    } else if (isOutflow) {
      laterOutflowQty = round2(laterOutflowQty + mQty);
      laterOutflowCost = round2(laterOutflowCost + mTotalVal);
    } else if (type === 'ADJUSTMENT') {
      const isDecrease =
        (m as any).adjustmentType === 'DECREASE' ||
        Number(m.quantity) < 0 ||
        (m.notes || '').includes('হ্রাস') ||
        (m.notes || '').toLowerCase().includes('decrease') ||
        (m.notes || '').toLowerCase().includes('loss') ||
        (m.notes || '').toLowerCase().includes('damage');
      if (isDecrease) {
        laterOutflowQty = round2(laterOutflowQty + mQty);
        laterOutflowCost = round2(laterOutflowCost + mTotalVal);
      } else {
        laterInflowQty = round2(laterInflowQty + mQty);
        laterInflowCost = round2(laterInflowCost + mTotalVal);
      }
    } else if (type === 'TRANSFER') {
      const delta = Number(m.quantity) || 0;
      if (delta >= 0) {
        laterInflowQty = round2(laterInflowQty + delta);
        laterInflowCost = round2(laterInflowCost + mTotalVal);
      } else {
        laterOutflowQty = round2(laterOutflowQty + Math.abs(delta));
        laterOutflowCost = round2(laterOutflowCost + mTotalVal);
      }
    }
  }

  // Cost before later inflows/outflows
  const preLaterTotalCost = Math.max(0, recordCurrentVal - laterInflowCost + laterOutflowCost);
  const preLaterStock = Math.max(0, currentStock - laterInflowQty + laterOutflowQty);
  const costBeforeLaterInflows = preLaterStock > 0 ? (preLaterTotalCost / preLaterStock) : currentAvgCost;

  // Sort prior movements chronologically: date asc, then inflows before outflows, then id
  const sortedPriorMovements = [...movementsUpToAsOf].sort((a, b) => {
    const dateDiff = String(a.date).slice(0, 10).localeCompare(String(b.date).slice(0, 10));
    if (dateDiff !== 0) return dateDiff;
    const priority = (type: string) => {
      const t = String(type || '').toUpperCase();
      if (t === 'OPENING') return 1;
      if (t === 'PURCHASE') return 2;
      if (t === 'PRODUCTION' || t === 'HARVEST') return 3;
      return 4;
    };
    const pDiff = priority(a.movementType) - priority(b.movementType);
    if (pDiff !== 0) return pDiff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  // Check if any prior movements specify unitCost or totalValue
  let hasCostInfoOnOrBefore = false;
  for (const m of sortedPriorMovements) {
    if ((Number(m.unitCost) || 0) > 0 || (Number(m.totalValue) || 0) > 0) {
      hasCostInfoOnOrBefore = true;
      break;
    }
  }

  let runningQty = baseStock;
  let runningAvgCost = 0;
  if (baseStock > 0) {
    if (hasCostInfoOnOrBefore) {
      const firstInflow = sortedPriorMovements.find(
        (m) => (Number(m.unitCost) || 0) > 0 || (Number(m.totalValue) || 0) > 0
      );
      runningAvgCost = firstInflow
        ? (Number(firstInflow.unitCost) || (Number(firstInflow.totalValue) / Math.abs(Number(firstInflow.quantity) || 1)))
        : costBeforeLaterInflows;
    } else {
      runningAvgCost = costBeforeLaterInflows;
    }
  }
  let runningTotalValue = round2(runningQty * runningAvgCost);

  for (const m of sortedPriorMovements) {
    const type = String(m.movementType || '').toUpperCase();
    const mQty = Math.abs(Number(m.quantity) || 0);
    const mUnitCost = Number(m.unitCost) || 0;
    const mTotalVal = Number(m.totalValue) || (mQty * mUnitCost);

    const isInflow =
      type === 'PURCHASE' ||
      type === 'PRODUCTION' ||
      type === 'HARVEST' ||
      type === 'OPENING';
    const isOutflow =
      type === 'CONSUMPTION' ||
      type === 'SALE' ||
      type === 'WASTE' ||
      type === 'DAMAGE';

    if (isInflow) {
      const costAdded = mTotalVal > 0 ? mTotalVal : round2(mQty * (mUnitCost || runningAvgCost));
      const newQty = round2(runningQty + mQty);
      const newTotalValue = round2(runningTotalValue + costAdded);
      runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : (mUnitCost || runningAvgCost);
      runningQty = newQty;
      runningTotalValue = newTotalValue;
    } else if (isOutflow) {
      const outflowCost = mTotalVal > 0 ? mTotalVal : round2(mQty * runningAvgCost);
      const newQty = Math.max(0, round2(runningQty - mQty));
      const newTotalValue = newQty > 0 ? Math.max(0, round2(runningTotalValue - outflowCost)) : 0;
      runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : runningAvgCost;
      runningQty = newQty;
      runningTotalValue = newTotalValue;
    } else if (type === 'ADJUSTMENT') {
      const isDec =
        (m as any).adjustmentType === 'DECREASE' ||
        Number(m.quantity) < 0 ||
        (m.notes || '').includes('হ্রাস') ||
        (m.notes || '').toLowerCase().includes('decrease') ||
        (m.notes || '').toLowerCase().includes('loss') ||
        (m.notes || '').toLowerCase().includes('damage');

      if (isDec) {
        const outflowCost = mTotalVal > 0 ? mTotalVal : round2(mQty * runningAvgCost);
        const newQty = Math.max(0, round2(runningQty - mQty));
        const newTotalValue = newQty > 0 ? Math.max(0, round2(runningTotalValue - outflowCost)) : 0;
        runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : runningAvgCost;
        runningQty = newQty;
        runningTotalValue = newTotalValue;
      } else {
        const adjCost = mTotalVal > 0 ? mTotalVal : round2(mQty * (mUnitCost || runningAvgCost));
        const newQty = round2(runningQty + mQty);
        const newTotalValue = round2(runningTotalValue + adjCost);
        runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : runningAvgCost;
        runningQty = newQty;
        runningTotalValue = newTotalValue;
      }
    } else if (type === 'TRANSFER') {
      const delta = Number(m.quantity) || 0;
      if (delta >= 0) {
        const addedVal = mTotalVal > 0 ? mTotalVal : round2(delta * (mUnitCost || runningAvgCost));
        const newQty = round2(runningQty + delta);
        const newTotalValue = round2(runningTotalValue + addedVal);
        runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : runningAvgCost;
        runningQty = newQty;
        runningTotalValue = newTotalValue;
      } else {
        const outflowCost = mTotalVal > 0 ? mTotalVal : round2(Math.abs(delta) * runningAvgCost);
        const newQty = Math.max(0, round2(runningQty + delta));
        const newTotalValue = newQty > 0 ? Math.max(0, round2(runningTotalValue - outflowCost)) : 0;
        runningAvgCost = newQty > 0 ? (newTotalValue / newQty) : runningAvgCost;
        runningQty = newQty;
        runningTotalValue = newTotalValue;
      }
    }
  }

  const movementQty = Math.max(0, round2(runningQty));
  const movementVal = Math.max(0, round2(runningTotalValue));

  // Record unwinding
  const recordQty = Math.max(0, round2(currentStock - laterInflowQty + laterOutflowQty));
  const recordVal = Math.max(0, round2(recordCurrentVal - laterInflowCost + laterOutflowCost));

  // Determine reconciled values
  const finalQty = movementQty;
  const finalValue = movementVal;
  const finalUnitCost = finalQty > 0 ? round2(finalValue / finalQty) : (recordQty > 0 ? round2(recordVal / recordQty) : round2(runningAvgCost));

  return {
    quantity: finalQty,
    unitCost: finalUnitCost,
    totalValue: finalValue,
    stockMovementQuantity: movementQty,
    recordQuantity: recordQty,
    stockMovementValue: movementVal,
    recordValue: recordVal,
    isQuantityMatched: Math.abs(movementQty - recordQty) < 0.001,
    isValueMatched: Math.abs(movementVal - recordVal) < 0.01
  };
}

/**
 * Calculates inventory item quantity as of a specific date (historical calculation).
 * - For asOfDate, includes inventory movements only up to that date.
 * - Does not include later purchases, consumption, harvests or adjustments.
 * - Does not change current-period inventory behavior when asOfDate is not specified.
 */
export function calculateHistoricalInventoryQuantity(
  item: InventoryItem,
  movements: StockMovement[],
  asOfDate?: string
): number {
  return calculateHistoricalInventoryValuation(item, movements, asOfDate).quantity;
}

/**
 * Calculates inventory item cost as of a specific date (historical calculation).
 */
export function calculateHistoricalInventoryCost(
  item: InventoryItem,
  movements: StockMovement[],
  asOfDate?: string
): number {
  return calculateHistoricalInventoryValuation(item, movements, asOfDate).unitCost;
}

/**
 * Check 1: Inventory subledger ↔ inventory GL
 * - Operational: Sum of (stock * avgCostPrice) as of asOfDate
 * - GL: Net debit balance of inventory asset accounts as of asOfDate (1051, 1052, 1053, 1055, 1056, and 1050 if legacy)
 */
export async function reconcileInventorySubledger(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const items: InventoryItem[] = await dbInstance.inventoryItems.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const movements: StockMovement[] = dbInstance.stockMovements ? await dbInstance.stockMovements.toArray() : [];

  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  let totalOperational = 0;
  let totalStockMovementsQty = 0;
  let totalInventoryRecordsQty = 0;
  let allItemsQtyMatched = true;

  const categoryBreakdown: Record<string, { name: string; opVal: number; glCode: string; qty: number }> = {
    '1051': { name: 'মজুদ খাদ্য (Feed Inventory - 1051)', opVal: 0, glCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, qty: 0 },
    '1052': { name: 'মজুদ বীজ ও সার (Seed & Fert - 1052)', opVal: 0, glCode: CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY, qty: 0 },
    '1053': { name: 'মজুদ কাঁচামাল ও ওষুধ (Raw Materials - 1053)', opVal: 0, glCode: CANONICAL_ACCOUNTS.RAW_MATERIALS, qty: 0 },
    '1055': { name: 'উৎপাদিত পণ্য মজুদ (Finished Goods - 1055)', opVal: 0, glCode: CANONICAL_ACCOUNTS.FINISHED_GOODS, qty: 0 },
    '1056': { name: 'প্যাকেজিং সামগ্রী (Packaging - 1056)', opVal: 0, glCode: CANONICAL_ACCOUNTS.PACKAGING_INVENTORY, qty: 0 }
  };

  const itemDetails: ReconciliationSubItem[] = [];

  for (const item of items) {
    const valuation = calculateHistoricalInventoryValuation(item, movements, cleanAsOf);
    const itemVal = valuation.totalValue;
    const itemQty = valuation.quantity;
    totalOperational = round2(totalOperational + itemVal);
    totalStockMovementsQty = round2(totalStockMovementsQty + valuation.stockMovementQuantity);
    totalInventoryRecordsQty = round2(totalInventoryRecordsQty + valuation.recordQuantity);

    if (!valuation.isQuantityMatched) {
      allItemsQtyMatched = false;
    }

    const cat = String(item.category || '').toUpperCase();
    let catKey = '1055';
    if (cat.includes('FEED')) {
      catKey = '1051';
    } else if (cat.includes('SEED') || cat.includes('FERT')) {
      catKey = '1052';
    } else if (cat.includes('RAW') || cat.includes('MEDICINE')) {
      catKey = '1053';
    } else if (cat.includes('PACKAGING')) {
      catKey = '1056';
    }

    categoryBreakdown[catKey].opVal = round2(categoryBreakdown[catKey].opVal + itemVal);
    categoryBreakdown[catKey].qty = round2(categoryBreakdown[catKey].qty + itemQty);

    itemDetails.push({
      id: `inv_item_${item.id}`,
      name: `${item.nameBn || item.nameEn || item.id} (${item.code || ''})`,
      operationalAmount: itemVal,
      difference: valuation.isQuantityMatched ? 0 : round2(valuation.stockMovementQuantity - valuation.recordQuantity),
      status: (valuation.isQuantityMatched && valuation.isValueMatched) ? 'MATCHED' : 'MISMATCH',
      notes: `মজুদ: ${itemQty} ${item.unit || ''} (মুভমেন্ট: ${valuation.stockMovementQuantity}, রেকর্ড: ${valuation.recordQuantity}) | মূল্য: ৳${itemVal}`
    });
  }

  const inventoryCodes = [
    CANONICAL_ACCOUNTS.FEED_INVENTORY,
    CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY,
    CANONICAL_ACCOUNTS.RAW_MATERIALS,
    CANONICAL_ACCOUNTS.FINISHED_GOODS,
    CANONICAL_ACCOUNTS.PACKAGING_INVENTORY,
    '1050' // Legacy account check
  ];

  const glAmount = calculateGlBalanceForAccounts(entries, inventoryCodes, 'DEBIT', asOfDate);
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01 && allItemsQtyMatched;

  const categoryDetails: ReconciliationSubItem[] = Object.entries(categoryBreakdown).map(([code, cat]) => {
    const catGl = calculateGlBalanceForAccounts(entries, [cat.glCode], 'DEBIT', asOfDate);
    const diff = round2(cat.opVal - catGl);
    return {
      id: `inv_cat_${code}`,
      name: cat.name,
      operationalAmount: cat.opVal,
      glAmount: catGl,
      difference: diff,
      status: Math.abs(diff) < 0.01 ? 'MATCHED' : 'MISMATCH',
      notes: `অপারেশনাল মজুদ মূল্য: ৳${cat.opVal} (পরিমাণ: ${cat.qty}), জিএল ব্যালেন্স: ৳${catGl}`
    };
  });

  const allDetails = [...categoryDetails, ...itemDetails];

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
      ? 'ইনভেন্টরি সাবলেজারের মোট মজুদ পরিমাণ/মূল্য, স্টক মুভমেন্টস এবং সাধারণ খতিয়ান (GL) সম্পূর্ণ মিলেছে।'
      : `ইনভেন্টরি সাবলেজার ও GL-এর মধ্যে ৳${Math.abs(difference)} এর অমিল পাওয়া গেছে।`,
    details: allDetails,
    subItems: allDetails
  };
}

/**
 * Check 2: Customer balances ↔ AR GL
 * - Operational: Sum of balance of customers as of asOfDate
 * - GL: Net debit balance of Accounts Receivable (1040) as of asOfDate
 */
export async function reconcileCustomerBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const parties: Party[] = await dbInstance.parties.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const sales: Sale[] = dbInstance.sales ? await dbInstance.sales.toArray() : [];
  const payments: PaymentRecord[] = dbInstance.payments ? await dbInstance.payments.toArray() : [];

  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;
  const customers = parties.filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH');
  let totalOperational = 0;
  const customerDetails: ReconciliationSubItem[] = [];

  for (const c of customers) {
    let bal = round2(Number(c.balance) || 0);

    if (cleanAsOf) {
      // 1. Credit sales after cleanAsOf (increased customer balance after asOfDate)
      const postSales = sales.filter(
        (s) => s.customerId === c.id && s.date && String(s.date).slice(0, 10) > cleanAsOf
      );
      let postCreditSales = 0;
      for (const s of postSales) {
        const isCredit = s.paymentMethod === 'CREDIT' || (s.dueAmount !== undefined && s.dueAmount > 0) || s.status === 'DUE' || s.status === 'PARTIAL';
        if (isCredit) {
          postCreditSales += Number(s.grandTotal ?? s.totalAmount ?? s.dueAmount) || 0;
        }
      }

      // 2. Payments after cleanAsOf (reduced customer balance after asOfDate)
      const postPayments = payments.filter((pmt) => {
        if (pmt.parentType !== 'SALE' || !pmt.date || String(pmt.date).slice(0, 10) <= cleanAsOf) return false;
        const s = sales.find((sale) => sale.id === pmt.parentId);
        return pmt.customerId === c.id || pmt.partyId === c.id || (s && s.customerId === c.id);
      });
      const postPaymentsTotal = postPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      // Unwind to as-of date
      bal = round2(bal - postCreditSales + postPaymentsTotal);
    }

    totalOperational = round2(totalOperational + bal);
    if (bal !== 0) {
      customerDetails.push({
        id: c.id,
        name: `${c.name} (${c.phone || 'ফোন নেই'})`,
        operationalAmount: bal,
        status: 'MATCHED',
        notes: `গ্রাহকের বকেয়া পাওনা: ৳${bal}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE], 'DEBIT', asOfDate);
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
 * - Operational: Sum of balance of suppliers as of asOfDate
 * - GL: Net credit balance of Accounts Payable (2010) as of asOfDate
 */
export async function reconcileSupplierBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const parties: Party[] = await dbInstance.parties.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const purchases: Purchase[] = dbInstance.purchases ? await dbInstance.purchases.toArray() : [];
  const payments: PaymentRecord[] = dbInstance.payments ? await dbInstance.payments.toArray() : [];

  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;
  const suppliers = parties.filter((p) => p.type === 'SUPPLIER' || p.type === 'BOTH');
  let totalOperational = 0;
  const supplierDetails: ReconciliationSubItem[] = [];

  for (const s of suppliers) {
    let bal = round2(Number(s.balance) || 0);

    if (cleanAsOf) {
      // 1. Credit purchases after cleanAsOf (increased supplier balance after asOfDate)
      const postPurchases = purchases.filter(
        (p) => p.supplierId === s.id && p.date && String(p.date).slice(0, 10) > cleanAsOf
      );
      let postCreditPurchases = 0;
      for (const p of postPurchases) {
        const isCredit = p.paymentMethod === 'CREDIT' || (p.dueAmount !== undefined && p.dueAmount > 0) || p.status === 'DUE' || p.status === 'PARTIAL';
        if (isCredit) {
          postCreditPurchases += Number(p.grandTotal ?? p.totalAmount ?? p.dueAmount) || 0;
        }
      }

      // 2. Payments to supplier after cleanAsOf (reduced supplier balance after asOfDate)
      const postPayments = payments.filter((pmt) => {
        if (pmt.parentType !== 'PURCHASE' || !pmt.date || String(pmt.date).slice(0, 10) <= cleanAsOf) return false;
        const pur = purchases.find((p) => p.id === pmt.parentId);
        return pmt.supplierId === s.id || pmt.partyId === s.id || (pur && pur.supplierId === s.id);
      });
      const postPaymentsTotal = postPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      // Unwind to as-of date
      bal = round2(bal - postCreditPurchases + postPaymentsTotal);
    }

    totalOperational = round2(totalOperational + bal);
    if (bal !== 0) {
      supplierDetails.push({
        id: s.id,
        name: `${s.name} (${s.phone || 'ফোন নেই'})`,
        operationalAmount: bal,
        status: 'MATCHED',
        notes: `সরবরাহকারীর প্রদেয় দেনা: ৳${bal}`
      });
    }
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE], 'CREDIT', asOfDate);
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
 * - Operational: Sum of accumulated recorded costs for active fish batches as of asOfDate
 * - GL/Accounting: Sum of batch-linked accounting debits across active batches as of asOfDate
 */
export async function reconcileFishBatchProduction(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const batches: FishBatch[] = await dbInstance.fishBatches.toArray();
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  const activeBatches = batches.filter((b) => {
    if (cleanAsOf) {
      const stocked = !b.stockingDate || String(b.stockingDate).slice(0, 10) <= cleanAsOf;
      const notHarvestedYet = !b.harvestDate || String(b.harvestDate).slice(0, 10) > cleanAsOf;
      return stocked && notHarvestedYet && (b.status === 'ACTIVE' || (b.harvestDate && String(b.harvestDate).slice(0, 10) > cleanAsOf));
    }
    return b.status === 'ACTIVE';
  });

  let totalOperational = 0;
  let totalAccounting = 0;
  const batchDetails: ReconciliationSubItem[] = [];

  for (const batch of activeBatches) {
    let opCost = 0;
    let accountingCost = 0;

    try {
      const status = await getFishBatchAccumulatedCost(batch.id, dbInstance, asOfDate);
      opCost = status.accumulatedCost;
      accountingCost = status.accountingDebits;
    } catch {
      const opBreakdown = calculateFishBatchRecordedCosts(batch);
      opCost = opBreakdown.totalRecordedCost;
      accountingCost = 0;
    }

    totalOperational = round2(totalOperational + opCost);
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
 * - Operational: Sum of accumulated recorded costs for active/unharvested crop cycles as of asOfDate
 * - GL/Accounting: Sum of cycle-linked accounting WIP debits across active cycles as of asOfDate
 */
export async function reconcileCropCycleWip(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const cycles: CropCycle[] = await dbInstance.cropCycles.toArray();
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  const activeCycles = cycles.filter((c) => {
    if (cleanAsOf) {
      const planted = !c.plantingDate || String(c.plantingDate).slice(0, 10) <= cleanAsOf;
      const notHarvestedYet = !c.actualHarvestDate || String(c.actualHarvestDate).slice(0, 10) > cleanAsOf;
      return (
        planted &&
        notHarvestedYet &&
        (c.status !== 'CLOSED' && (c.status !== 'HARVESTED' || (c.actualHarvestDate && String(c.actualHarvestDate).slice(0, 10) > cleanAsOf)))
      );
    }
    return c.status !== 'HARVESTED' && c.status !== 'CLOSED';
  });

  let totalOperational = 0;
  let totalAccounting = 0;
  const cycleDetails: ReconciliationSubItem[] = [];

  for (const cycle of activeCycles) {
    let opCost = 0;
    let accountingCost = 0;

    try {
      const status = await getCropCycleAccumulatedCost(cycle.id, dbInstance, asOfDate);
      opCost = status.accumulatedCost;
      accountingCost = status.accountingDebits;
    } catch {
      const opBreakdown = calculateCropCycleRecordedCosts(cycle);
      opCost = opBreakdown.totalRecordedCost;
      accountingCost = 0;
    }

    totalOperational = round2(totalOperational + opCost);
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
 * - Operational: Sum of accumulated costs of all active animals as of asOfDate
 * - GL: Net debit balance of GL account 1580 (Livestock Assets) as of asOfDate
 */
export async function reconcileLivestockBiologicalAssets(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const animals: Animal[] = await dbInstance.animals.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  const activeAnimals = animals.filter((a) => {
    if (cleanAsOf) {
      const purchased = !a.purchaseDate || String(a.purchaseDate).slice(0, 10) <= cleanAsOf;
      const notSold = !a.saleDate || String(a.saleDate).slice(0, 10) > cleanAsOf;
      return purchased && notSold && (a.status === 'ACTIVE' || (a.saleDate && String(a.saleDate).slice(0, 10) > cleanAsOf));
    }
    return a.status === 'ACTIVE';
  });

  let totalOperational = 0;
  const animalDetails: ReconciliationSubItem[] = [];

  for (const animal of activeAnimals) {
    const costBreakdown = calculateAnimalRecordedCosts(animal);
    let opCost = costBreakdown.totalRecordedCost;

    if (cleanAsOf) {
      // Unwind journal entry debits to livestock assets for this animal posted after cleanAsOf
      const postAnimalEntries = entries.filter((e) => {
        if (!e.date || String(e.date).slice(0, 10) <= cleanAsOf) return false;
        return (
          e.reference === animal.id ||
          e.reference === animal.tag ||
          (e.lines &&
            e.lines.some(
              (l: any) =>
                l.memo && (l.memo.includes(animal.id) || (animal.tag && l.memo.includes(animal.tag)))
            ))
        );
      });

      let postDebits = 0;
      for (const pe of postAnimalEntries) {
        for (const l of pe.lines || []) {
          const matches =
            l.memo ? l.memo.includes(animal.id) || (animal.tag && l.memo.includes(animal.tag)) : pe.reference === animal.id;
          if (matches && l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
            postDebits += Number(l.debit) || 0;
          }
        }
      }
      opCost = Math.max(0, round2(opCost - postDebits));
    }

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

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS], 'DEBIT', asOfDate);
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
 * - Operational: Sum of originalCost across active fixed assets as of asOfDate
 * - GL: Net debit balance of Fixed Asset GL accounts (1510, 1520, 1530, 1550) as of asOfDate
 */
export async function reconcileFixedAssetRegister(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const assets: FixedAsset[] = await dbInstance.fixedAssets.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  const activeAssets = assets.filter((a) => {
    if (cleanAsOf) {
      const purchased = !a.purchaseDate || String(a.purchaseDate).slice(0, 10) <= cleanAsOf;
      const notDisposed = !a.disposalDate || String(a.disposalDate).slice(0, 10) > cleanAsOf;
      return purchased && notDisposed && (a.status === 'ACTIVE' || (a.disposalDate && String(a.disposalDate).slice(0, 10) > cleanAsOf));
    }
    return a.status === 'ACTIVE' || (a.status as any) !== 'DISPOSED';
  });

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

  const glAmount = calculateGlBalanceForAccounts(entries, fixedAssetCodes, 'DEBIT', asOfDate);
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
 * - Operational: Sum of accumulatedDepreciation across active fixed assets as of asOfDate
 * - GL: Net credit balance of GL account 1590 (Accumulated Depreciation) as of asOfDate
 */
export async function reconcileAccumulatedDepreciation(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const assets: FixedAsset[] = await dbInstance.fixedAssets.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  const activeAssets = assets.filter((a) => {
    if (cleanAsOf) {
      const purchased = !a.purchaseDate || String(a.purchaseDate).slice(0, 10) <= cleanAsOf;
      const notDisposed = !a.disposalDate || String(a.disposalDate).slice(0, 10) > cleanAsOf;
      return purchased && notDisposed && (a.status === 'ACTIVE' || (a.disposalDate && String(a.disposalDate).slice(0, 10) > cleanAsOf));
    }
    return a.status === 'ACTIVE' || (a.status as any) !== 'DISPOSED';
  });

  let totalOperational = 0;
  const depDetails: ReconciliationSubItem[] = [];

  for (const asset of activeAssets) {
    let dep = round2(Number(asset.accumulatedDepreciation) || 0);

    if (cleanAsOf) {
      // Unwind depreciation entries posted after cleanAsOf
      const postDepEntries = entries.filter((e) => {
        if (!e.date || String(e.date).slice(0, 10) <= cleanAsOf) return false;
        return (
          e.reference === asset.id ||
          (e.narration && e.narration.includes(asset.id)) ||
          (e.lines &&
            e.lines.some(
              (l: any) =>
                l.accountCode === CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION &&
                l.memo &&
                l.memo.includes(asset.id)
            ))
        );
      });

      let postDepCredits = 0;
      for (const pe of postDepEntries) {
        for (const l of pe.lines || []) {
          if (l.accountCode === CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION) {
            postDepCredits += (Number(l.credit) || 0) - (Number(l.debit) || 0);
          }
        }
      }
      dep = Math.max(0, round2(dep - postDepCredits));
    }

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

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION], 'CREDIT', asOfDate);
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
 * - Operational: Sum of currentCapitalBalance for all investors as of asOfDate
 * - GL: Net credit balance of GL account 3020 (Investor Capital) as of asOfDate
 */
export async function reconcileInvestorCapital(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const investors: Investor[] = await dbInstance.investors.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  let totalOperational = 0;
  const investorDetails: ReconciliationSubItem[] = [];

  for (const inv of investors) {
    let cap = round2(
      Number(inv.currentCapitalBalance ?? inv.capitalAmount ?? inv.capitalContributed ?? (inv as any).totalContribution ?? 0)
    );

    if (cleanAsOf) {
      if (inv.entryDate && String(inv.entryDate).slice(0, 10) > cleanAsOf) {
        cap = 0;
      } else {
        // Unwind capital contributions and returns posted after cleanAsOf
        const postCapEntries = entries.filter((e) => {
          if (!e.date || String(e.date).slice(0, 10) <= cleanAsOf) return false;
          return (
            e.reference === inv.id ||
            (e.narration && e.narration.includes(inv.name)) ||
            (e.lines &&
              e.lines.some(
                (l: any) =>
                  l.memo && (l.memo.includes(inv.id) || l.memo.includes(inv.name))
              ))
          );
        });

        let postNetContribution = 0;
        for (const pe of postCapEntries) {
          for (const l of pe.lines || []) {
            if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL) {
              postNetContribution += (Number(l.credit) || 0) - (Number(l.debit) || 0);
            }
          }
        }
        cap = Math.max(0, round2(cap - postNetContribution));
      }
    }

    totalOperational = round2(totalOperational + cap);
    investorDetails.push({
      id: inv.id,
      name: `${inv.name} (${inv.phone || 'ফোন নেই'})`,
      operationalAmount: cap,
      status: 'MATCHED',
      notes: `বিনিয়োগকারীর মূলধন স্থিতি: ৳${cap} (লভ্যাংশ অনুপাত: ${inv.profitSharingRatio ?? inv.profitSharePercentage ?? 0}%)`
    });
  }

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.INVESTOR_CAPITAL], 'CREDIT', asOfDate);
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
 * - Operational: Sum of profitPayable across all investors as of asOfDate
 * - GL: Net credit balance of GL account 2050 (Investor Profit Payable) as of asOfDate
 */
export async function reconcileInvestorProfitPayable(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const investors: Investor[] = await dbInstance.investors.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  let totalOperational = 0;
  const payableDetails: ReconciliationSubItem[] = [];

  for (const inv of investors) {
    let payable = round2(Number(inv.profitPayable) || 0);

    if (cleanAsOf) {
      // Unwind profit allocations and payouts after cleanAsOf
      const postPayableEntries = entries.filter((e) => {
        if (!e.date || String(e.date).slice(0, 10) <= cleanAsOf) return false;
        return (
          e.reference === inv.id ||
          (e.narration && e.narration.includes(inv.name)) ||
          (e.lines &&
            e.lines.some(
              (l: any) =>
                l.memo && (l.memo.includes(inv.id) || l.memo.includes(inv.name))
            ))
        );
      });

      let postNetAllocated = 0;
      for (const pe of postPayableEntries) {
        for (const l of pe.lines || []) {
          if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE) {
            postNetAllocated += (Number(l.credit) || 0) - (Number(l.debit) || 0);
          }
        }
      }
      payable = Math.max(0, round2(payable - postNetAllocated));
    }

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

  const glAmount = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE], 'CREDIT', asOfDate);
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
 * - Operational: Sum of currentBalance across all accounts as of asOfDate
 * - GL: Net debit balance of GL Cash and Bank accounts (1010, 1020, 1030) as of asOfDate
 */
export async function reconcileCashBankBalances(
  dbInstance: any = db,
  journalEntries?: JournalEntry[],
  asOfDate?: string
): Promise<ReconciliationCheck> {
  const accounts: CashBankAccount[] = await dbInstance.cashBankAccounts.toArray();
  const entries: JournalEntry[] = journalEntries || (await dbInstance.journalEntries.toArray());
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;

  let totalOperational = 0;
  let cashOperational = 0;
  let bankOperational = 0;
  const cbDetails: ReconciliationSubItem[] = [];

  for (const acc of accounts) {
    let bal = round2(Number(acc.currentBalance ?? (acc as any).balance ?? 0));

    if (cleanAsOf) {
      const isCash = (acc.accountType as string) === 'CASH' || (acc.accountType as string) === 'PETTY_CASH';
      const targetCodes: string[] = isCash
        ? [CANONICAL_ACCOUNTS.CASH, CANONICAL_ACCOUNTS.PETTY_CASH]
        : [CANONICAL_ACCOUNTS.BANK];

      const postEntries = entries.filter(
        (e) => e.date && String(e.date).slice(0, 10) > cleanAsOf
      );

      let postNetInflow = 0;
      for (const pe of postEntries) {
        for (const l of pe.lines || []) {
          const matchAccount =
            l.accountId === acc.id ||
            (l.memo && l.memo.includes(acc.id)) ||
            (isCash && targetCodes.includes(l.accountCode)) ||
            (!isCash &&
              targetCodes.includes(l.accountCode) &&
              (accounts.filter((a) => (a.accountType as string) !== 'CASH' && (a.accountType as string) !== 'PETTY_CASH').length <= 1 ||
                l.accountId === acc.id ||
                (l.memo && l.memo.includes(acc.id))));

          if (matchAccount && targetCodes.includes(l.accountCode)) {
            postNetInflow += (Number(l.debit) || 0) - (Number(l.credit) || 0);
          }
        }
      }
      bal = round2(bal - postNetInflow);
    }

    totalOperational = round2(totalOperational + bal);

    if ((acc.accountType as string) === 'CASH' || (acc.accountType as string) === 'PETTY_CASH') {
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

  const glAmount = calculateGlBalanceForAccounts(entries, cashBankCodes, 'DEBIT', asOfDate);
  const difference = round2(totalOperational - glAmount);
  const isMatched = Math.abs(difference) < 0.01;

  // Breakdown detail comparing Cash vs Bank GL
  const cashGl = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.CASH, CANONICAL_ACCOUNTS.PETTY_CASH], 'DEBIT', asOfDate);
  const bankGl = calculateGlBalanceForAccounts(entries, [CANONICAL_ACCOUNTS.BANK], 'DEBIT', asOfDate);

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
 * Runs all 11 internal accounting reconciliation checks as of the specified asOfDate.
 * Both operational subledgers and GL balances are calculated as of the exact SAME date.
 * Completely non-destructive: does not create correcting journals, only reports differences.
 */
export async function runAccountingReconciliation(
  dbInstance: any = db,
  asOfDate?: string
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
    reconcileInventorySubledger(dbInstance, journalEntries, asOfDate),
    reconcileCustomerBalances(dbInstance, journalEntries, asOfDate),
    reconcileSupplierBalances(dbInstance, journalEntries, asOfDate),
    reconcileFishBatchProduction(dbInstance, journalEntries, asOfDate),
    reconcileCropCycleWip(dbInstance, journalEntries, asOfDate),
    reconcileLivestockBiologicalAssets(dbInstance, journalEntries, asOfDate),
    reconcileFixedAssetRegister(dbInstance, journalEntries, asOfDate),
    reconcileAccumulatedDepreciation(dbInstance, journalEntries, asOfDate),
    reconcileInvestorCapital(dbInstance, journalEntries, asOfDate),
    reconcileInvestorProfitPayable(dbInstance, journalEntries, asOfDate),
    reconcileCashBankBalances(dbInstance, journalEntries, asOfDate)
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
    asOfDate: asOfDate || now.split('T')[0],
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

export interface AgingReportResult {
  asOfDate: string;
  receivables: AgingItem[];
  payables: AgingItem[];
  totalReceivables: number;
  totalPayables: number;
  glReceivables: number;
  glPayables: number;
  subledgerReceivables: number;
  subledgerPayables: number;
  isReceivablesMatched: boolean;
  isPayablesMatched: boolean;
}

/**
 * Generates receivables and payables aging report as of a specific date,
 * guaranteed to agree with AR and AP GL accounts and party subledgers as of the same date.
 */
export async function generateAgingReport(
  dbInstance: any = db,
  asOfDate?: string
): Promise<AgingReportResult> {
  const cleanAsOf = asOfDate ? String(asOfDate).slice(0, 10) : undefined;
  const [sales, purchases, payments, entries]: [Sale[], Purchase[], PaymentRecord[], JournalEntry[]] = await Promise.all([
    dbInstance.sales ? dbInstance.sales.toArray() : [],
    dbInstance.purchases ? dbInstance.purchases.toArray() : [],
    dbInstance.payments ? dbInstance.payments.toArray() : [],
    dbInstance.journalEntries ? dbInstance.journalEntries.toArray() : []
  ]);

  // Aggregate payments by parentId on or before cleanAsOf
  const paymentsByParent = new Map<string, number>();
  for (const pmt of payments) {
    if (cleanAsOf && pmt.date && String(pmt.date).slice(0, 10) > cleanAsOf) {
      continue;
    }
    const prev = paymentsByParent.get(pmt.parentId) || 0;
    paymentsByParent.set(pmt.parentId, prev + (Number(pmt.amount) || 0));
  }

  const refDate = cleanAsOf ? new Date(cleanAsOf) : new Date();
  refDate.setHours(0, 0, 0, 0);

  const calcDaysOverdue = (dateStr: string): number => {
    if (!dateStr) return 0;
    const invDate = new Date(dateStr);
    invDate.setHours(0, 0, 0, 0);
    const diffMs = refDate.getTime() - invDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const rec: AgingItem[] = [];
  const custSalesDueMap = new Map<string, number>();
  for (const s of sales) {
    if (cleanAsOf && s.date && String(s.date).slice(0, 10) > cleanAsOf) {
      continue;
    }
    const isCredit = s.paymentMethod === 'CREDIT' || (s.dueAmount !== undefined && s.dueAmount > 0) || s.status === 'DUE' || s.status === 'PARTIAL';
    if (!isCredit) {
      continue;
    }

    const total = Number(s.grandTotal ?? s.totalAmount ?? s.dueAmount ?? 0);
    const pmtSum = paymentsByParent.get(s.id);
    const paid = pmtSum !== undefined ? pmtSum : (payments.length === 0 ? Number(s.paidAmount || 0) : 0);
    const due = Math.max(0, round2(total - paid));

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
      if (s.customerId) {
        custSalesDueMap.set(s.customerId, round2((custSalesDueMap.get(s.customerId) || 0) + due));
      }
    }
  }

  const pay: AgingItem[] = [];
  const supPurchDueMap = new Map<string, number>();
  for (const p of purchases) {
    if (cleanAsOf && p.date && String(p.date).slice(0, 10) > cleanAsOf) {
      continue;
    }
    const isCredit = p.paymentMethod === 'CREDIT' || (p.dueAmount !== undefined && p.dueAmount > 0) || p.status === 'DUE' || p.status === 'PARTIAL';
    if (!isCredit) {
      continue;
    }

    const total = Number(p.grandTotal ?? p.totalAmount ?? p.dueAmount ?? 0);
    const pmtSum = paymentsByParent.get(p.id);
    const paid = pmtSum !== undefined ? pmtSum : (payments.length === 0 ? Number(p.paidAmount || 0) : 0);
    const due = Math.max(0, round2(total - paid));

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
      if (p.supplierId) {
        supPurchDueMap.set(p.supplierId, round2((supPurchDueMap.get(p.supplierId) || 0) + due));
      }
    }
  }

  // Subledger reconciliations
  const custRecon = await reconcileCustomerBalances(dbInstance, entries, asOfDate);
  const suppRecon = await reconcileSupplierBalances(dbInstance, entries, asOfDate);

  // If customer has subledger balance from opening balance not covered by sales invoices, add opening item
  for (const cDetail of custRecon.details || []) {
    const fromSales = custSalesDueMap.get(cDetail.id) || 0;
    const diff = round2(cDetail.operationalAmount - fromSales);
    if (diff > 0.01) {
      rec.push({
        id: `opening_${cDetail.id}`,
        invoiceNumber: `OPENING-${cDetail.id.slice(-6)}`,
        partyName: cDetail.name || 'গ্রাহক',
        date: cleanAsOf || '',
        totalAmount: diff,
        paidAmount: 0,
        dueAmount: diff,
        daysOverdue: 0
      });
    }
  }

  // If supplier has subledger balance from opening balance not covered by purchase invoices, add opening item
  for (const sDetail of suppRecon.details || []) {
    const fromPurch = supPurchDueMap.get(sDetail.id) || 0;
    const diff = round2(sDetail.operationalAmount - fromPurch);
    if (diff > 0.01) {
      pay.push({
        id: `opening_${sDetail.id}`,
        invoiceNumber: `OPENING-${sDetail.id.slice(-6)}`,
        partyName: sDetail.name || 'সরবরাহকারী',
        date: cleanAsOf || '',
        totalAmount: diff,
        paidAmount: 0,
        dueAmount: diff,
        daysOverdue: 0
      });
    }
  }

  rec.sort((a, b) => b.daysOverdue - a.daysOverdue);
  pay.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const totalReceivables = round2(rec.reduce((sum, item) => sum + item.dueAmount, 0));
  const totalPayables = round2(pay.reduce((sum, item) => sum + item.dueAmount, 0));

  return {
    asOfDate: cleanAsOf || new Date().toISOString().slice(0, 10),
    receivables: rec,
    payables: pay,
    totalReceivables,
    totalPayables,
    glReceivables: custRecon.glAmount,
    glPayables: suppRecon.glAmount,
    subledgerReceivables: custRecon.operationalAmount,
    subledgerPayables: suppRecon.operationalAmount,
    isReceivablesMatched: Math.abs(round2(totalReceivables - custRecon.glAmount)) < 0.01,
    isPayablesMatched: Math.abs(round2(totalPayables - suppRecon.glAmount)) < 0.01
  };
}

export interface InventoryReportItem {
  id: string;
  code: string;
  name: string;
  category: string;
  categoryName?: string;
  accountCode: string;
  unit: string;
  unitCost: number;
  quantity: number; // reconciled quantity as of asOfDate
  stockMovementQuantity: number; // quantity from stock movements as of asOfDate
  recordQuantity: number; // quantity from unwound inventory record as of asOfDate
  value: number; // reconciled value as of asOfDate
  stockMovementValue: number; // value from stock movements as of asOfDate
  recordValue: number; // value from unwound inventory record as of asOfDate
  isQuantityMatched: boolean;
  isValueMatched: boolean;
  isMatched: boolean;
}

export interface InventoryReportResult {
  asOfDate: string;
  items: InventoryReportItem[];
  totalQuantity: number;
  totalValue: number;
  operationalAmount: number;
  glAmount: number;
  glValue: number;
  difference: number;
  isMatched: boolean;
  isGlMatched: boolean;
  isQuantityMatched: boolean;
  isAllMatched: boolean;
  categoryBreakdown: Record<string, {
    accountCode: string;
    name: string;
    quantity: number;
    operationalAmount: number;
    glAmount: number;
    difference: number;
    isMatched: boolean;
  }>;
}

/**
 * Generates an Inventory Valuation & Reconciliation Report as of a specific date.
 * Reconciles inventory quantity and value across:
 * 1. stock movements
 * 2. inventory records
 * 3. corresponding GL balance
 * strictly using the exact same asOfDate.
 */
export async function generateInventoryReport(
  dbInstance: any = db,
  asOfDate?: string
): Promise<InventoryReportResult> {
  const cleanAsOf = asOfDate ? asOfDate.slice(0, 10) : undefined;
  const items: InventoryItem[] = await dbInstance.inventoryItems.toArray();
  const entries: JournalEntry[] = await dbInstance.journalEntries.toArray();
  const movements: StockMovement[] = dbInstance.stockMovements ? await dbInstance.stockMovements.toArray() : [];

  const inventoryCodes = [
    CANONICAL_ACCOUNTS.FEED_INVENTORY,
    CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY,
    CANONICAL_ACCOUNTS.RAW_MATERIALS,
    CANONICAL_ACCOUNTS.FINISHED_GOODS,
    CANONICAL_ACCOUNTS.PACKAGING_INVENTORY,
    '1050'
  ];

  const categoryBreakdown: Record<string, {
    accountCode: string;
    name: string;
    quantity: number;
    operationalAmount: number;
    glAmount: number;
    difference: number;
    isMatched: boolean;
  }> = {
    '1051': { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, name: 'মজুদ খাদ্য (Feed Inventory)', quantity: 0, operationalAmount: 0, glAmount: 0, difference: 0, isMatched: true },
    '1052': { accountCode: CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY, name: 'মজুদ বীজ ও সার (Seed & Fert)', quantity: 0, operationalAmount: 0, glAmount: 0, difference: 0, isMatched: true },
    '1053': { accountCode: CANONICAL_ACCOUNTS.RAW_MATERIALS, name: 'মজুদ কাঁচামাল ও ওষুধ (Raw Materials)', quantity: 0, operationalAmount: 0, glAmount: 0, difference: 0, isMatched: true },
    '1055': { accountCode: CANONICAL_ACCOUNTS.FINISHED_GOODS, name: 'উৎপাদিত পণ্য মজুদ (Finished Goods)', quantity: 0, operationalAmount: 0, glAmount: 0, difference: 0, isMatched: true },
    '1056': { accountCode: CANONICAL_ACCOUNTS.PACKAGING_INVENTORY, name: 'প্যাকেজিং সামগ্রী (Packaging)', quantity: 0, operationalAmount: 0, glAmount: 0, difference: 0, isMatched: true }
  };

  const reportItems: InventoryReportItem[] = [];
  let totalQuantity = 0;
  let totalValue = 0;
  let allItemsQuantityMatched = true;

  for (const item of items) {
    const valuation = calculateHistoricalInventoryValuation(item, movements, cleanAsOf);
    const itemQty = valuation.quantity;
    const itemVal = valuation.totalValue;

    totalQuantity = round2(totalQuantity + itemQty);
    totalValue = round2(totalValue + itemVal);

    if (!valuation.isQuantityMatched) {
      allItemsQuantityMatched = false;
    }

    const cat = String(item.category || '').toUpperCase();
    let catKey = '1055';
    let accountCode: string = CANONICAL_ACCOUNTS.FINISHED_GOODS;
    if (cat.includes('FEED')) {
      catKey = '1051';
      accountCode = CANONICAL_ACCOUNTS.FEED_INVENTORY;
    } else if (cat.includes('SEED') || cat.includes('FERT')) {
      catKey = '1052';
      accountCode = CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY;
    } else if (cat.includes('RAW') || cat.includes('MEDICINE')) {
      catKey = '1053';
      accountCode = CANONICAL_ACCOUNTS.RAW_MATERIALS;
    } else if (cat.includes('PACKAGING')) {
      catKey = '1056';
      accountCode = CANONICAL_ACCOUNTS.PACKAGING_INVENTORY;
    }

    categoryBreakdown[catKey].quantity = round2(categoryBreakdown[catKey].quantity + itemQty);
    categoryBreakdown[catKey].operationalAmount = round2(categoryBreakdown[catKey].operationalAmount + itemVal);

    reportItems.push({
      id: item.id,
      code: item.code || '',
      name: item.nameBn || item.nameEn || item.id,
      category: item.category,
      categoryName: categoryBreakdown[catKey].name,
      accountCode,
      unit: item.unit || '',
      unitCost: valuation.unitCost,
      quantity: itemQty,
      stockMovementQuantity: valuation.stockMovementQuantity,
      recordQuantity: valuation.recordQuantity,
      value: itemVal,
      stockMovementValue: valuation.stockMovementValue,
      recordValue: valuation.recordValue,
      isQuantityMatched: valuation.isQuantityMatched,
      isValueMatched: valuation.isValueMatched,
      isMatched: valuation.isQuantityMatched && valuation.isValueMatched
    });
  }

  // Calculate GL amounts for each category
  for (const [key, cat] of Object.entries(categoryBreakdown)) {
    cat.glAmount = calculateGlBalanceForAccounts(entries, [cat.accountCode], 'DEBIT', cleanAsOf);
    cat.difference = round2(cat.operationalAmount - cat.glAmount);
    cat.isMatched = Math.abs(cat.difference) < 0.01;
  }

  const glAmount = calculateGlBalanceForAccounts(entries, inventoryCodes, 'DEBIT', cleanAsOf);
  const difference = round2(totalValue - glAmount);
  const isGlMatched = Math.abs(difference) < 0.01;
  const isAllMatched = isGlMatched && allItemsQuantityMatched;

  return {
    asOfDate: cleanAsOf || new Date().toISOString().slice(0, 10),
    items: reportItems,
    totalQuantity,
    totalValue,
    operationalAmount: totalValue,
    glAmount,
    glValue: glAmount,
    difference,
    isMatched: isAllMatched,
    isGlMatched,
    isQuantityMatched: allItemsQuantityMatched,
    isAllMatched,
    categoryBreakdown
  };
}
