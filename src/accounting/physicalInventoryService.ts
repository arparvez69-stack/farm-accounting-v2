import { db } from '../db/indexedDb';
import {
  InventoryItem,
  StockMovement,
  JournalEntry,
  PhysicalInventoryCountRecord
} from '../types';
import { postJournalEntry } from './accountingEngine';
import { CANONICAL_ACCOUNTS, getInventoryAssetAccount, getInventoryAccountDetails } from './accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

// In-memory store for physical inventory count records (Prompt 08)
const inMemoryPhysicalInventoryRecords: Map<string, PhysicalInventoryCountRecord> = new Map();

/**
 * Clear in-memory physical inventory records (for test isolation)
 */
export function clearPhysicalInventoryRecordsForTest(): void {
  inMemoryPhysicalInventoryRecords.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('goted_physical_inventory_records');
    }
  } catch {}
}

/**
 * Get all recorded physical inventory adjustment records
 */
export function getPhysicalInventoryRecords(): PhysicalInventoryCountRecord[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_physical_inventory_records') || '{}');
      for (const [k, v] of Object.entries(stored)) {
        if (!inMemoryPhysicalInventoryRecords.has(k)) {
          inMemoryPhysicalInventoryRecords.set(k, v as PhysicalInventoryCountRecord);
        }
      }
    }
  } catch {}
  return Array.from(inMemoryPhysicalInventoryRecords.values());
}

/**
 * Get a single physical inventory count record by ID
 */
export function getPhysicalInventoryRecordById(id: string): PhysicalInventoryCountRecord | undefined {
  if (inMemoryPhysicalInventoryRecords.has(id)) {
    return inMemoryPhysicalInventoryRecords.get(id);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_physical_inventory_records') || '{}');
      if (stored[id]) {
        inMemoryPhysicalInventoryRecords.set(id, stored[id]);
        return stored[id];
      }
    }
  } catch {}
  return undefined;
}

/**
 * PROMPT 08: Physical Inventory Adjustment
 *
 * Inspects inventory reconciliation used for valuation.
 * A physical count must NEVER silently overwrite the accounting quantity.
 *
 * When:
 *   Book quantity = 50
 *   Physical quantity = 40
 *
 * The system must record:
 *   - book quantity;
 *   - physical quantity;
 *   - variance;
 *   - value impact;
 *   - reason/narration;
 *   - user;
 *   - timestamp.
 *
 * Uses the existing inventory/accounting engine for the resulting adjustment.
 * Does not directly mutate historical records.
 */
export async function recordPhysicalInventoryAdjustment(
  params: {
    itemId: string;
    physicalQuantity: number;
    reason: string;
    user: string;
    date?: string;
    customUnitCost?: number;
    expenseAccountCode?: string; // defaults to 5090 (OTHER_COGS)
    incomeAccountCode?: string;  // defaults to 4090 (OTHER_INCOME)
  },
  dbInstance: any = db
): Promise<{
  adjustmentRecord: PhysicalInventoryCountRecord;
  stockMovement?: StockMovement;
  journalEntry?: JournalEntry;
  previousBookQuantity: number;
  newQuantity: number;
}> {
  const {
    itemId,
    physicalQuantity,
    reason,
    user,
    date,
    customUnitCost,
    expenseAccountCode = CANONICAL_ACCOUNTS.OTHER_COGS,
    incomeAccountCode = CANONICAL_ACCOUNTS.OTHER_INCOME
  } = params;

  if (!itemId || typeof itemId !== 'string') {
    throw new Error('ইনভেন্টরি আইটেম আইডি আবশ্যক (Item ID is required for physical inventory adjustment).');
  }

  if (typeof physicalQuantity !== 'number' || isNaN(physicalQuantity) || physicalQuantity < 0) {
    throw new Error('শারীরিক গণনা সংখ্যা অবশ্যই অ-ঋণাত্মক বৈধ সংখ্যা হতে হবে (Physical quantity must be a non-negative number).');
  }

  if (!user || typeof user !== 'string' || !user.trim()) {
    throw new Error('দায়িত্বপ্রাপ্ত ব্যবহারকারী/নিরীক্ষক আবশ্যক (Responsible user/auditor is required).');
  }

  const cleanUser = user.trim();

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('সমন্বয়ের কারণ বা বিবরণ আবশ্যক (Reason/narration is required for inventory adjustment).');
  }

  const cleanReason = reason.trim();

  // 1. Retrieve inventory item
  const item: InventoryItem | undefined = await dbInstance.inventoryItems.get(itemId);
  if (!item) {
    throw new Error(`ইনভেন্টরি আইটেম পাওয়া যায়নি (Inventory item not found: ${itemId})।`);
  }

  const bookQuantity = Number(item.currentStock) || 0;
  const variance = round2(physicalQuantity - bookQuantity);
  const unitCost = round2(customUnitCost ?? (item.avgCostPrice || item.costPrice || 0));
  const valueImpact = round2(variance * unitCost);
  const absValueImpact = Math.abs(valueImpact);
  const timestamp = new Date().toISOString();
  const cleanDate = date ? date.slice(0, 10) : timestamp.slice(0, 10);
  const recordId = `phy_adj_${Date.now()}_${generateUniqueId('pia').slice(0, 8)}`;

  // Determine GL Accounts
  const inventoryAssetCode = getInventoryAssetAccount(item.category);
  const inventoryDetails = getInventoryAccountDetails(item.category);

  const isDeficit = variance < 0;
  const isSurplus = variance > 0;
  const varianceLabel = isDeficit
    ? `ঘাটতি ${Math.abs(variance)}`
    : isSurplus
    ? `উদ্বৃত্ত +${variance}`
    : 'কোনো ব্যবধান নেই';

  const narration = `ফিজিক্যাল কাউন্ট সমন্বয়: "${item.nameBn || item.nameEn || item.id}" (${item.code}) | পূর্ববর্তী বহিমজুদ: ${bookQuantity}, গণনাকৃত শারীরিক মজুদ: ${physicalQuantity}, ${varianceLabel} ${item.unit || ''} (মূল্য প্রভাব: ৳${valueImpact})। নিরীক্ষক: ${cleanUser}। কারণ: ${cleanReason}`;

  const adjustmentRecord: PhysicalInventoryCountRecord = {
    id: recordId,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.nameBn || item.nameEn,
    category: item.category,
    inventoryAccountCode: inventoryAssetCode,
    adjustmentAccountCode: isDeficit ? expenseAccountCode : isSurplus ? incomeAccountCode : undefined,
    bookQuantity,
    physicalQuantity,
    variance,
    unitCost,
    valueImpact,
    reason: cleanReason,
    narration,
    user: cleanUser,
    timestamp,
    date: cleanDate,
    status: 'RECORDED'
  };

  let createdMovement: StockMovement | undefined;
  let createdJournalEntry: JournalEntry | undefined;

  // 2. If there is a variance, record adjustment via existing inventory & accounting engine
  if (variance !== 0) {
    // 2a. Record StockMovement (without mutating any historical movements)
    const movementId = generateUniqueId('sm_adj');
    createdMovement = {
      id: movementId,
      date: cleanDate,
      itemId: item.id,
      movementType: 'ADJUSTMENT',
      quantity: Math.abs(variance),
      unitCost,
      totalValue: absValueImpact,
      referenceId: recordId,
      notes: narration,
      direction: isDeficit ? 'OUT' : 'IN',
      adjustmentType: isDeficit ? 'DECREASE' : 'INCREASE',
      status: 'POSTED',
      synced: false
    };

    if (dbInstance.stockMovements) {
      await dbInstance.stockMovements.put(createdMovement);
    }

    // 2b. Post Adjusting Journal Entry via accounting engine
    const voucherNumber = generateTransactionNumber('V-ADJ');
    const journalEntryInput = {
      id: generateUniqueId('j_inv_adj'),
      voucherNumber,
      voucherType: 'JOURNAL' as const,
      date: cleanDate,
      narration,
      lines: isDeficit
        ? [
            {
              accountCode: expenseAccountCode,
              accountName: 'ইনভেন্টরি সমন্বয় ক্ষতি / বিবিধ উৎপাদন ব্যয় (Other COGS)',
              debit: absValueImpact,
              credit: 0
            },
            {
              accountCode: inventoryAssetCode,
              accountName: inventoryDetails.nameBn,
              debit: 0,
              credit: absValueImpact
            }
          ]
        : [
            {
              accountCode: inventoryAssetCode,
              accountName: inventoryDetails.nameBn,
              debit: absValueImpact,
              credit: 0
            },
            {
              accountCode: incomeAccountCode,
              accountName: 'অন্যান্য আয় (ইনভেন্টরি উদ্বৃত্ত সমন্বয় / Other Income)',
              debit: 0,
              credit: absValueImpact
            }
          ],
      createdBy: cleanUser,
      createdAt: timestamp
    };

    createdJournalEntry = await postJournalEntry(journalEntryInput, { dbInstance });

    // 2c. Update inventory item to reflect physical count (backed by the adjustment movement)
    await dbInstance.inventoryItems.update(item.id, {
      currentStock: physicalQuantity,
      synced: false
    });

    // 2d. Audit log entry
    if (dbInstance.auditLogs) {
      try {
        const auditId = generateUniqueId('audit');
        await dbInstance.auditLogs.put({
          id: auditId,
          timestamp,
          userId: cleanUser,
          role: 'AUDITOR',
          action: 'PHYSICAL_INVENTORY_ADJUSTMENT',
          module: 'INVENTORY',
          recordId: recordId,
          status: 'SUCCESS',
          details: `শারীরিক গণনা সমন্বয়: ${item.code} (${item.nameBn || item.nameEn || item.id}). বহিমজুদ ${bookQuantity} -> শারীরিক মজুদ ${physicalQuantity} (ব্যবধান: ${variance}, আর্থিক প্রভাব: ৳${valueImpact}, ভাউচার: ${voucherNumber})`
        });
        adjustmentRecord.auditLogId = auditId;
      } catch {}
    }

    adjustmentRecord.stockMovementId = movementId;
    adjustmentRecord.journalEntryId = createdJournalEntry.id;
    adjustmentRecord.voucherNumber = voucherNumber;
    adjustmentRecord.status = 'POSTED';
  } else {
    // 0 variance verification audit
    if (dbInstance.auditLogs) {
      try {
        await dbInstance.auditLogs.put({
          id: generateUniqueId('audit'),
          timestamp,
          userId: cleanUser,
          role: 'AUDITOR',
          action: 'PHYSICAL_INVENTORY_VERIFIED_EXACT',
          module: 'INVENTORY',
          recordId: recordId,
          status: 'SUCCESS',
          details: `শারীরিক গণনা যাচাই সম্পন্ন: ${item.code} (${item.nameBn || item.nameEn || item.id}). বহিমজুদ ${bookQuantity} ও শারীরিক মজুদ ${physicalQuantity} সম্পূর্ণ মিলেছে (কোনো ব্যবধান নেই)।`
        });
      } catch {}
    }
  }

  // Persist record to in-memory store and localStorage
  inMemoryPhysicalInventoryRecords.set(recordId, adjustmentRecord);
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_physical_inventory_records') || '{}');
      stored[recordId] = adjustmentRecord;
      localStorage.setItem('goted_physical_inventory_records', JSON.stringify(stored));
    }
  } catch {}

  return {
    adjustmentRecord,
    stockMovement: createdMovement,
    journalEntry: createdJournalEntry,
    previousBookQuantity: bookQuantity,
    newQuantity: physicalQuantity
  };
}

/**
 * Detects whether an inventory item has been silently overwritten without a corresponding StockMovement.
 * A physical count must never silently overwrite the accounting quantity.
 */
export function detectSilentInventoryOverwrite(
  item: InventoryItem,
  movements: StockMovement[]
): {
  isSilentOverwrite: boolean;
  expectedBookQuantity: number;
  recordedCurrentStock: number;
  discrepancy: number;
  message: string;
} {
  const itemMovements = movements.filter((m) => m.itemId === item.id);
  let computedQty = 0;

  for (const m of itemMovements) {
    const type = String(m.movementType || '').toUpperCase();
    const qty = Math.abs(Number(m.quantity) || 0);

    const isRevInflow =
      type === 'REVERSAL' &&
      ((m as any).direction === 'IN' ||
        (m as any).adjustmentType === 'INCREASE' ||
        (m.notes || '').includes('বৃদ্ধি') ||
        (m.notes || '').toLowerCase().includes('sale') ||
        (m.notes || '').toLowerCase().includes('consumption'));
    const isRevOutflow = type === 'REVERSAL' && !isRevInflow;

    const isInflow =
      type === 'PURCHASE' ||
      type === 'PRODUCTION' ||
      type === 'HARVEST' ||
      type === 'OPENING' ||
      isRevInflow;

    const isOutflow =
      type === 'CONSUMPTION' ||
      type === 'SALE' ||
      type === 'WASTE' ||
      type === 'DAMAGE' ||
      isRevOutflow;

    if (isInflow) {
      computedQty = round2(computedQty + qty);
    } else if (isOutflow) {
      computedQty = Math.max(0, round2(computedQty - qty));
    } else if (type === 'ADJUSTMENT') {
      const isDecrease =
        (m as any).direction === 'OUT' ||
        (m as any).adjustmentType === 'DECREASE' ||
        Number(m.quantity) < 0 ||
        (m.notes || '').includes('হ্রাস') ||
        (m.notes || '').includes('ঘাটতি') ||
        (m.notes || '').toLowerCase().includes('decrease') ||
        (m.notes || '').toLowerCase().includes('loss') ||
        (m.notes || '').toLowerCase().includes('deficit') ||
        (m.notes || '').toLowerCase().includes('damage');

      if (isDecrease) {
        computedQty = Math.max(0, round2(computedQty - qty));
      } else {
        computedQty = round2(computedQty + qty);
      }
    } else if (type === 'TRANSFER') {
      const delta = Number(m.quantity) || 0;
      computedQty = Math.max(0, round2(computedQty + delta));
    }
  }

  const recordedStock = Number(item.currentStock) || 0;
  const discrepancy = round2(recordedStock - computedQty);
  const isSilentOverwrite = Math.abs(discrepancy) > 0.001;

  return {
    isSilentOverwrite,
    expectedBookQuantity: computedQty,
    recordedCurrentStock: recordedStock,
    discrepancy,
    message: isSilentOverwrite
      ? `নীরব পরিবর্তন শনাক্ত হয়েছে (Silent overwrite detected): আইটেম "${item.nameBn || item.nameEn || item.id}" (${item.code})-এর বর্তমান রেকর্ড মজুদ ${recordedStock}, কিন্তু অনুমোদিত স্টক মুভমেন্ট অনুসারে প্রত্যাশিত মজুদ ${computedQty} (ব্যবধান: ${discrepancy})। ফিজিক্যাল কাউন্ট সরাসরি ওভাররাইট না করে recordPhysicalInventoryAdjustment ব্যবহার করুন।`
      : 'স্টক মুভমেন্ট ও বর্তমান মজুদ সম্পূর্ণ সমন্বিত ও বিশ্বস্ত।'
  };
}

/**
 * Asserts that no silent inventory overwrite has occurred.
 * Throws a descriptive error if an unrecorded overwrite is detected.
 */
export function assertNoSilentInventoryOverwrite(
  item: InventoryItem,
  movements: StockMovement[]
): void {
  const result = detectSilentInventoryOverwrite(item, movements);
  if (result.isSilentOverwrite) {
    throw new Error(result.message);
  }
}
