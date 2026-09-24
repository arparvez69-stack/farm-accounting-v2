import Dexie from 'dexie';
import { db } from '../db/indexedDb';
import { Account, AccountClass, ClosedPeriod, JournalEntry, JournalLine, NormalBalance, VoucherType, Sale, Purchase, AnimalEvent, PaymentRecord, Loan, Investor, FixedAsset, FishBatch, CropCycle, StockMovement } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { DEFAULT_CHART_OF_ACCOUNTS } from './defaultAccounts';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  nameBn: string;
  nameEn: string;
  accountClass: string;
  debit: number;
  credit: number;
  isOrphan?: boolean;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  difference: number;
  orphanAccounts: string[];
  hasInvalidAccounts: boolean;
}

export interface LedgerEntry {
  journalEntryId?: string;
  journalId?: string;
  date: string;
  voucherNumber: string;
  voucherType: VoucherType;
  narration: string;
  debit: number;
  credit: number;
  runningBalance: number;
  reversedBy?: string;
  reversalOf?: string;
  correctionOf?: string;
  relatedPerson?: string;
  createdBy?: string;
}

export interface ProfitLossReport {
  revenues: { code: string; nameBn: string; amount: number }[];
  totalRevenue: number;
  cogs: { code: string; nameBn: string; amount: number }[];
  totalCogs: number;
  grossProfit: number;
  operatingExpenses: { code: string; nameBn: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  otherIncome: { code: string; nameBn: string; amount: number }[];
  totalOtherIncome: number;
  otherExpenses: { code: string; nameBn: string; amount: number }[];
  totalOtherExpenses: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  assets: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  totalAssets: number;
  liabilities: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  totalLiabilities: number;
  equity: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  currentYearNetProfit: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  discrepancy: number;
}

export interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

export type ProfitLossResult = ProfitLossReport;
export type BalanceSheetResult = BalanceSheetReport;

/**
 * Validates that journal lines are strictly balanced, account codes are valid,
 * and amounts are non-negative and non-zero.
 */
export function validateBalancedLines(
  lines: JournalLine[],
  validAccounts?: Account[]
): { isBalanced: boolean; totalDebit: number; totalCredit: number; difference: number } {
  if (!lines || !Array.isArray(lines) || lines.length < 2) {
    throw new Error('Journal entry must contain at least 2 lines.');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.accountCode?.trim();

    if (!code) {
      throw new Error(`Line ${i + 1}: Account code is missing.`);
    }

    // Explicit rejection of invalid account 1050
    if (code === '1050') {
      throw new Error('REJECTED: Account code 1050 does not exist in Chart of Accounts. Use 1051 (Feed), 1052 (Seed & Fertilizer), 1053 (Raw Materials), 1054 (WIP), 1055 (Finished Goods), or 1056 (Packaging).');
    }

    // Verify against Chart of Accounts if provided
    if (validAccounts && validAccounts.length > 0) {
      const exists = validAccounts.some((a) => a.code === code);
      if (!exists) {
        throw new Error(`REJECTED: Nonexistent account code "${code}". Posting to undefined accounts is strictly forbidden.`);
      }
    }

    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (isNaN(debit) || isNaN(credit) || !isFinite(debit) || !isFinite(credit)) {
      throw new Error(`Line ${i + 1} (${code}): Invalid numeric amount.`);
    }

    if (debit < 0 || credit < 0) {
      throw new Error(`Line ${i + 1} (${code}): Negative amounts are not allowed (Debit: ${debit}, Credit: ${credit}).`);
    }

    if (debit > 0 && credit > 0) {
      throw new Error(`Line ${i + 1} (${code}): A line cannot have both Debit and Credit amounts.`);
    }

    if (debit === 0 && credit === 0) {
      throw new Error(`Line ${i + 1} (${code}): Line must have a non-zero Debit or Credit amount.`);
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  // Round to 2 decimal places to avoid floating point anomalies
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;

  if (difference !== 0) {
    throw new Error(
      `CRITICAL ACCOUNTING ERROR: জাবেদা ভারসাম্যহীন (Unbalanced Journal Entry)! মোট ডেবিট: ৳${totalDebit}, মোট ক্রেডিট: ৳${totalCredit}। পার্থক্য: ৳${difference}। Double-entry accounting requires Debits = Credits.`
    );
  }

  return {
    isBalanced: true,
    totalDebit,
    totalCredit,
    difference: 0
  };
}

/**
 * Validates a journal entry object
 */
export function validateJournalEntry(
  entry: { lines: JournalLine[] },
  validAccounts?: Account[]
): { isBalanced: boolean; totalDebit: number; totalCredit: number; difference: number } {
  return validateBalancedLines(entry.lines, validAccounts);
}

/**
 * Retrieve the most recent closed accounting period (if any)
 */
export async function getLatestClosedPeriod(dbInstance?: any): Promise<ClosedPeriod | null> {
  const periods = await getClosedPeriods(dbInstance);
  return periods.length > 0 ? periods[0] : null;
}

/**
 * Retrieve all closed accounting periods ordered from newest to oldest
 */
export async function getClosedPeriods(dbInstance?: any): Promise<ClosedPeriod[]> {
  const targetDb = dbInstance || db;
  try {
    if (targetDb?.closedPeriods) {
      if (typeof targetDb.closedPeriods.toArray === 'function') {
        const periods = await targetDb.closedPeriods.toArray();
        return ((periods as ClosedPeriod[]) || []).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
      }
      if (typeof targetDb.closedPeriods.values === 'function') {
        const periods = Array.from(targetDb.closedPeriods.values()) as ClosedPeriod[];
        return (periods || []).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
      }
      if (Array.isArray(targetDb.closedPeriods)) {
        return ([...targetDb.closedPeriods] as ClosedPeriod[]).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
      }
    }
    if (typeof db.isOpen === 'function' && !db.isOpen()) {
      await db.open();
    }
    const currentTx = Dexie.currentTransaction;
    if (currentTx && !currentTx.storeNames.includes('closedPeriods')) {
      return [];
    }
    if (!db.tables?.some((t) => t.name === 'closedPeriods')) {
      return [];
    }
    return await db.closedPeriods.orderBy('endDate').reverse().toArray();
  } catch (err) {
    if (targetDb?.closedPeriods) {
      try {
        if (typeof targetDb.closedPeriods.toArray === 'function') {
          const periods = await targetDb.closedPeriods.toArray();
          return ((periods as ClosedPeriod[]) || []).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
        }
        if (typeof targetDb.closedPeriods.values === 'function') {
          const periods = Array.from(targetDb.closedPeriods.values()) as ClosedPeriod[];
          return (periods || []).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
        }
        if (Array.isArray(targetDb.closedPeriods)) {
          return ([...targetDb.closedPeriods] as ClosedPeriod[]).sort((a: any, b: any) => (b.endDate || '').localeCompare(a.endDate || ''));
        }
      } catch {}
    }
    return [];
  }
}

/**
 * Post a balanced journal entry into IndexedDB with full schema and integrity validation
 */
export async function postJournalEntry(
  entry: Omit<JournalEntry, 'totalDebit' | 'totalCredit'>,
  options?: { skipDbPut?: boolean; accounts?: Account[]; isClosingEntry?: boolean; dbInstance?: any }
): Promise<JournalEntry> {
  const targetDb = options?.dbInstance || db;
  const todayStr = new Date().toISOString().split('T')[0];
  if (entry.date > todayStr) {
    throw new Error(
      `জাবেদা ভাউচারের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
    );
  }

  // Prevent posting new journal entries on or before the latest closed period's endDate
  const latestClosed = await getLatestClosedPeriod(targetDb);

  if (options?.isClosingEntry) {
    if (latestClosed && entry.date <= latestClosed.endDate) {
      throw new Error(
        `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর বা তারিখ (${entry.date}) ইতোমধ্যে বন্ধ সময়কালের (${latestClosed.endDate}) অন্তর্ভুক্ত। বন্ধ সময়কালে পুনরায় সমাপনী দাখিলা পোস্ট করা যাবে না (Fiscal year/date already closed).`
      );
    }
    const existingExact = targetDb.closedPeriods?.where
      ? await targetDb.closedPeriods.where('endDate').equals(entry.date).first()
      : null;
    if (existingExact) {
      throw new Error(
        `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর সমাপ্তির তারিখ (${entry.date}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই তারিখে পুনরায় বছর সমাপ্তি করা যাবে না (Fiscal year-end date already closed).`
      );
    }
  } else {
    if (latestClosed && entry.date <= latestClosed.endDate) {
      throw new Error(
        `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosed.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে নতুন জাবেদা পোস্ট বা পরিবর্তন করা যাবে না। সংশোধনের জন্য সমাপ্তির পরবর্তী তারিখের নতুন সমন্বয় দাখিলা প্রদান করুন। (Cannot post journal entry dated on or before closed period end date: ${latestClosed.endDate}).`
      );
    }
  }

  const accounts = options?.accounts ?? (await targetDb.accounts.toArray());
  const check = validateBalancedLines(entry.lines, accounts);

  if (!check.isBalanced) {
    throw new Error(
      `CRITICAL ACCOUNTING ERROR: জাবেদা ভারসাম্যহীন (Unbalanced Journal Entry)! মোট ডেবিট: ৳${check.totalDebit}, মোট ক্রেডিট: ৳${check.totalCredit}. পার্থক্য: ৳${check.difference}`
    );
  }

  if (check.totalDebit <= 0) {
    throw new Error('লেনদেনের পরিমাণ শূন্য বা ঋণাত্মক হতে পারে না (Zero or negative amount not allowed).');
  }

  const fullEntry: JournalEntry = {
    ...entry,
    totalDebit: check.totalDebit,
    totalCredit: check.totalCredit,
    synced: false
  };

  if (!options?.skipDbPut) {
    await safeInsert(targetDb.journalEntries, fullEntry, { idPrefix: 'j' });
  }

  return fullEntry;
}

/**
 * In-memory concurrency locks to prevent concurrent duplicate reversal execution
 */
const activeReversalLocks = new Set<string>();

/**
 * Reverses a mistaken journal entry traceable and balances it out.
 * 1. Creates a brand-new journal entry dated today (or specified valid date).
 * 2. Swaps every debit and credit line exactly (equal and opposite).
 * 3. Narration: "মূল এন্ট্রি #[id] তারিখ [date]-এর সংশোধনী"
 * 4. Links reversalOf on new entry and reversedBy on original entry.
 * 5. Does NOT delete or remove original entry, keeping it fully traceable and searchable.
 * 6. Strictly prevents duplicate reversal: an already reversed transaction cannot be reversed again.
 */
export async function reverseJournalEntry(
  originalEntryId: string,
  currentUserId: string,
  customReversalDate?: string,
  dbInstance: any = db
): Promise<{ original: JournalEntry; reversal: JournalEntry; [key: string]: any }> {
  if (activeReversalLocks.has(originalEntryId)) {
    throw new Error(`এই জাবেদা দাখিলাটির (#${originalEntryId}) রিভার্সাল প্রক্রিয়া বর্তমানে চলমান রয়েছে। ডুপ্লিকেট রিভার্সাল প্রতিরোধ করা হয়েছে।`);
  }
  activeReversalLocks.add(originalEntryId);

  try {
    const targetDb = dbInstance || db;

    const transactionTables = [
      targetDb.journalEntries,
      targetDb.cashBankAccounts,
      targetDb.inventoryItems,
      targetDb.stockMovements,
      targetDb.parties,
      targetDb.sales,
      targetDb.purchases,
      targetDb.animalEvents,
      targetDb.animals,
      targetDb.payments,
      targetDb.loans,
      targetDb.investors,
      targetDb.fixedAssets,
      targetDb.fishBatches,
      targetDb.cropCycles,
      targetDb.reminders,
      targetDb.accounts,
      targetDb.auditLogs,
      targetDb.closedPeriods,
      targetDb.bankTransfers
    ].filter(Boolean);

    const performReversal = async (): Promise<{ original: JournalEntry; reversal: JournalEntry; [key: string]: any }> => {
      // 1. Locate original journal entry, or resolve from linked operational ID
      let resolvedEntryId = originalEntryId;
      let original = targetDb.journalEntries?.get ? await targetDb.journalEntries.get(resolvedEntryId) : null;

      if (!original) {
        // Try looking up via sale, purchase, payment, animalEvent, fixedAsset, loan, investor, fishBatch, cropCycle
        if (targetDb.sales?.get) {
          const s = await targetDb.sales.get(originalEntryId);
          if (s?.journalEntryId) {
            resolvedEntryId = s.journalEntryId;
            original = await targetDb.journalEntries.get(resolvedEntryId);
          }
        }
        if (!original && targetDb.purchases?.get) {
          const p = await targetDb.purchases.get(originalEntryId);
          if (p?.journalEntryId) {
            resolvedEntryId = p.journalEntryId;
            original = await targetDb.journalEntries.get(resolvedEntryId);
          }
        }
        if (!original && targetDb.payments?.get) {
          const pmt = await targetDb.payments.get(originalEntryId);
          if (pmt?.journalEntryId) {
            resolvedEntryId = pmt.journalEntryId;
            original = await targetDb.journalEntries.get(resolvedEntryId);
          }
        }
        if (!original && targetDb.animalEvents?.get) {
          const evt = await targetDb.animalEvents.get(originalEntryId);
          if (evt?.journalEntryId) {
            resolvedEntryId = evt.journalEntryId;
            original = await targetDb.journalEntries.get(resolvedEntryId);
          }
        }
        if (!original && targetDb.fixedAssets?.get) {
          const ast = await targetDb.fixedAssets.get(originalEntryId);
          if (ast?.disposalJournalId || ast?.journalEntryId) {
            resolvedEntryId = ast.disposalJournalId || ast.journalEntryId!;
            original = await targetDb.journalEntries.get(resolvedEntryId);
          }
        }
        if (!original && targetDb.loans?.get) {
          const ln = await targetDb.loans.get(originalEntryId);
          if (ln && targetDb.journalEntries?.toArray) {
            const allJ = await targetDb.journalEntries.toArray();
            const j = allJ.slice().reverse().find((entry: any) => entry.reference === ln.id || entry.reference === ln.loanNumber);
            if (j) {
              resolvedEntryId = j.id;
              original = j;
            }
          }
        }
        if (!original && targetDb.investors?.get) {
          const inv = await targetDb.investors.get(originalEntryId);
          if (inv && targetDb.journalEntries?.toArray) {
            const allJ = await targetDb.journalEntries.toArray();
            const j = allJ.slice().reverse().find((entry: any) => entry.reference === inv.id || (entry as any).relatedInvestorId === inv.id);
            if (j) {
              resolvedEntryId = j.id;
              original = j;
            }
          }
        }
        if (!original && targetDb.fishBatches?.get) {
          const fb = await targetDb.fishBatches.get(originalEntryId);
          if (fb && targetDb.journalEntries?.toArray) {
            const allJ = await targetDb.journalEntries.toArray();
            const j = allJ.slice().reverse().find((entry: any) => entry.reference === fb.id);
            if (j) {
              resolvedEntryId = j.id;
              original = j;
            }
          }
        }
        if (!original && targetDb.cropCycles?.get) {
          const cc = await targetDb.cropCycles.get(originalEntryId);
          if (cc && targetDb.journalEntries?.toArray) {
            const allJ = await targetDb.journalEntries.toArray();
            const j = allJ.slice().reverse().find((entry: any) => entry.reference === cc.id);
            if (j) {
              resolvedEntryId = j.id;
              original = j;
            }
          }
        }
      }

      if (!original && targetDb.bankTransfers?.get) {
        const bt = await targetDb.bankTransfers.get(originalEntryId);
        if (bt && bt.journalEntryId) {
          resolvedEntryId = bt.journalEntryId;
          original = targetDb.journalEntries?.get ? await targetDb.journalEntries.get(resolvedEntryId) : null;
        }
      }

      if (!original) {
        throw new Error(`মূল জাবেদা দাখিলা (ID: ${originalEntryId}) খুঁজে পাওয়া যায়নি।`);
      }

      if (original.reversedBy || original.status === 'REVERSED') {
        throw new Error(`এই জাবেদা দাখিলাটি (#${original.voucherNumber || original.id}) ইতোমধ্যে সংশোধিত/রিভার্স করা হয়েছে।`);
      }

      if (original.reversalOf) {
        throw new Error(`একটি রিভার্সাল জাবেদা দাখিলা (#${original.voucherNumber || original.id}) পুনরায় রিভার্স করা যাবে না।`);
      }

      // Verify whether any existing reversal entry already points to this original transaction
      let existingReversal: JournalEntry | undefined;
      if (targetDb.journalEntries?.where) {
        existingReversal = await targetDb.journalEntries.where('reversalOf').equals(original.id).first();
      } else if (targetDb.journalEntries?.toArray) {
        const all = await targetDb.journalEntries.toArray();
        existingReversal = all.find((j: any) => j.reversalOf === original.id);
      }
      if (existingReversal) {
        if (!original.reversedBy) {
          await targetDb.journalEntries.update(original.id, {
            reversedBy: existingReversal.id,
            status: 'REVERSED',
            synced: false
          });
        }
        throw new Error(`এই জাবেদা দাখিলাটি (#${original.voucherNumber || original.id}) ইতোমধ্যে রিভার্সাল #${existingReversal.voucherNumber || existingReversal.id} দ্বারা রিভার্স করা হয়েছে।`);
      }

      if (original.reference?.startsWith('YEC-') || original.voucherNumber?.startsWith('YEC')) {
        throw new Error('সমাপনী দাখিলা (Year-End Closing Entry) সরাসরি রিভার্স করা যাবে না।');
      }

      const today = customReversalDate || new Date().toISOString().split('T')[0];

      // Task B5: Reversal Closed-Period Protection
      // A reversal must not create an accounting entry inside a closed period.
      // Use existing closed-period rules.
      const closedPeriods = await getClosedPeriods(targetDb);
      const latestClosed = closedPeriods.length > 0 ? closedPeriods[0] : null;

      const conflictingClosed = closedPeriods.find((cp: any) =>
        cp.startDate ? today >= cp.startDate && today <= cp.endDate : today <= cp.endDate
      ) || (latestClosed && today <= latestClosed.endDate ? latestClosed : null);

      if (conflictingClosed) {
        throw new Error(
          `হিসাবরক্ষণ সীমাবদ্ধতা: সর্বশেষ সমাপ্ত হিসাবকাল ${conflictingClosed.endDate} পর্যন্ত বন্ধ। সংশোধনী আজকের তারিখে (${today}) পোস্ট করতে হবে যা বন্ধ সময়কালের পরবর্তী হতে হবে (Cannot create reversal entry dated on or before closed period end date: ${conflictingClosed.endDate})।`
        );
      }

      // ----------------------------------------------------
      // Task B4: Locate linked purchase & verify sufficient stock BEFORE making any changes
      // ----------------------------------------------------
      let linkedPurchase: Purchase | undefined;
      if (targetDb.purchases?.get) {
        if (original.reference) {
          const pByRef = await targetDb.purchases.get(original.reference);
          if (pByRef) linkedPurchase = pByRef;
        }
        if (!linkedPurchase) {
          const pById = await targetDb.purchases.get(originalEntryId);
          if (pById && (pById.journalEntryId === original.id || pById.invoiceNumber === original.reference || pById.id === original.reference)) {
            linkedPurchase = pById;
          }
        }
      }
      if (!linkedPurchase && targetDb.purchases?.toArray) {
        const allPurchases = await targetDb.purchases.toArray();
        linkedPurchase = allPurchases.find(
          (p: any) =>
            p.journalEntryId === original.id ||
            (original.reference && (p.invoiceNumber === original.reference || p.id === original.reference)) ||
            p.id === originalEntryId
        );
      }

      // Check if this transaction represents a purchase reversal
      const purchaseQtyByItem = new Map<string, { quantity: number; name: string }>();

      if (linkedPurchase && linkedPurchase.status !== 'CANCELLED' && Array.isArray(linkedPurchase.items)) {
        for (const it of linkedPurchase.items) {
          const cur = purchaseQtyByItem.get(it.itemId) || { quantity: 0, name: it.itemName || '' };
          cur.quantity += Number(it.quantity || 0);
          if (it.itemName) cur.name = it.itemName;
          purchaseQtyByItem.set(it.itemId, cur);
        }
      }

      // Also check unreversed PURCHASE stock movements if not already covered by linkedPurchase
      if (purchaseQtyByItem.size === 0 && targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const purMovements = movements.filter((m: any) =>
          !m.reversedBy &&
          m.movementType === 'PURCHASE' &&
          ((linkedPurchase && (m.referenceId === linkedPurchase.invoiceNumber || m.referenceId === linkedPurchase.id)) ||
            m.referenceId === original.reference ||
            m.referenceId === original.id ||
            m.referenceId === original.voucherNumber)
        );
        for (const sm of purMovements) {
          const cur = purchaseQtyByItem.get(sm.itemId) || { quantity: 0, name: '' };
          cur.quantity += Number(sm.quantity || 0);
          purchaseQtyByItem.set(sm.itemId, cur);
        }
      }

      // TASK B4: Verify sufficient current stock exists to remove the purchased quantity.
      // If insufficient: reject reversal, make no partial changes. Never silently clamp stock to zero.
      if (purchaseQtyByItem.size > 0 && targetDb.inventoryItems?.get) {
        for (const [itemId, info] of purchaseQtyByItem.entries()) {
          const invItem = await targetDb.inventoryItems.get(itemId);
          const currentStock = Number(invItem?.currentStock || 0);
          if (currentStock < info.quantity) {
            const name = invItem?.nameBn || invItem?.nameEn || info.name || itemId;
            throw new Error(
              `ক্রয় চালান রিভার্সাল ব্যর্থ: '${name}' এর পর্যাপ্ত স্টক নেই (বর্তমান স্টক: ${currentStock}, কর্তন প্রয়োজন: ${info.quantity})। স্টক নেগেটিভ করা যাবে না (Insufficient stock for purchase reversal).`
            );
          }
        }
      }

      // Swap every debit/credit line exactly (equal and opposite)
      const reversedLines: JournalLine[] = original.lines.map((line) => ({
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: Number(line.credit || 0),
        credit: Number(line.debit || 0),
        memo: line.memo ? `সংশোধনী: ${line.memo}` : undefined
      }));

      const voucherNum = generateTransactionNumber('ADJ');
      const reversalId = generateUniqueId('j');

      const reversalEntryData: Omit<JournalEntry, 'totalDebit' | 'totalCredit'> = {
        id: reversalId,
        voucherNumber: voucherNum,
        voucherType: 'ADJUSTMENT',
        date: today,
        narration: `মূল এন্ট্রি #${original.voucherNumber || original.id} তারিখ ${original.date}-এর সংশোধনী`,
        lines: reversedLines,
        reference: original.id,
        reversalOf: original.id,
        relatedPerson: original.relatedPerson,
        createdBy: currentUserId || 'system',
        createdAt: new Date().toISOString()
      };

      // 1. Post reversal journal entry
      const reversalEntry = await postJournalEntry(reversalEntryData, { dbInstance: targetDb });

      // 2. Link reversedBy and status on original entry (preserving original lines and identity)
      await targetDb.journalEntries.update(original.id, {
        reversedBy: reversalEntry.id,
        status: 'REVERSED',
        synced: false
      });

      const updatedOriginal: JournalEntry = {
        ...original,
        reversedBy: reversalEntry.id,
        status: 'REVERSED'
      };

      // Helper function to create an appropriate reversal/counter stock movement linked to the original movement
      // Preserves original stock movement for audit history without deletion
      const recordStockMovementReversal = async (
        originalSm: StockMovement,
        revDate: string,
        refId: string,
        reason: string
      ): Promise<StockMovement | null> => {
        if (!targetDb.stockMovements) return null;
        if (originalSm.reversedBy || originalSm.movementType === 'REVERSAL') {
          return null; // Already reversed or is a reversal itself
        }

        const isOriginalInflow =
          originalSm.movementType === 'PURCHASE' ||
          originalSm.movementType === 'PRODUCTION' ||
          originalSm.movementType === 'OPENING' ||
          (originalSm as any).adjustmentType === 'INCREASE' ||
          (originalSm as any).direction === 'IN';

        const counterDirection = isOriginalInflow ? 'OUT' : 'IN';
        const counterAdjType = isOriginalInflow ? 'DECREASE' : 'INCREASE';

        const counterSm: StockMovement = {
          id: generateUniqueId('sm_rev'),
          date: revDate,
          itemId: originalSm.itemId,
          movementType: 'REVERSAL',
          quantity: originalSm.quantity,
          unitCost: originalSm.unitCost,
          totalValue: originalSm.totalValue,
          referenceId: refId || originalSm.referenceId || originalSm.id,
          reversalOf: originalSm.id,
          notes: `স্টক রিভার্সাল (${isOriginalInflow ? 'হ্রাস' : 'বৃদ্ধি'}): ${reason} (মূল মুভমেন্ট: ${originalSm.id})`,
          direction: counterDirection,
          adjustmentType: counterAdjType,
          synced: false
        };

        await safeInsert(targetDb.stockMovements, counterSm, { idPrefix: 'sm' });

        await targetDb.stockMovements.update(originalSm.id, {
          reversedBy: counterSm.id,
          status: 'REVERSED',
          synced: false
        });

        return counterSm;
      };

      // 3. Atomically reverse linked operational records and subledgers (cash/bank, inventory, stock movement, AR/AP, operational record)
      // Check for linked Sale
      let linkedSale: Sale | undefined;
      if (targetDb.sales?.toArray) {
        const allSales = await targetDb.sales.toArray();
        linkedSale = allSales.find(
          (s: any) => s.journalEntryId === original.id || (original.reference && (s.invoiceNumber === original.reference || s.id === original.reference))
        );
      }

      if (linkedSale && linkedSale.status !== 'CANCELLED') {
        // Operational record
        await targetDb.sales.update(linkedSale.id, { status: 'CANCELLED', synced: false });

        // Inventory restoration
        if (targetDb.inventoryItems?.get && Array.isArray(linkedSale.items)) {
          for (const it of linkedSale.items) {
            const invItem = await targetDb.inventoryItems.get(it.itemId);
            if (invItem) {
              await targetDb.inventoryItems.update(invItem.id, {
                currentStock: Math.round(((invItem.currentStock || 0) + it.quantity) * 100) / 100,
                synced: false
              });
            }
          }
        }

        // Stock movement reversal: create counter movement linked to original movement
        if (targetDb.stockMovements?.toArray) {
          const movements = await targetDb.stockMovements.toArray();
          const toReverse = movements.filter((m: any) =>
            !m.reversedBy &&
            m.movementType !== 'REVERSAL' &&
            (m.referenceId === linkedSale!.invoiceNumber ||
              m.referenceId === linkedSale!.id ||
              (m.movementType === 'SALE' && linkedSale!.items?.some((it: any) => it.itemId === m.itemId && it.quantity === m.quantity)))
          );
          for (const sm of toReverse) {
            await recordStockMovementReversal(
              sm,
              today,
              linkedSale!.invoiceNumber || linkedSale!.id,
              `বিক্রয় চালান ${linkedSale!.invoiceNumber || linkedSale!.id} বাতিল`
            );
          }
        }

        // Fish Batch harvest restoration
        if (targetDb.fishBatches?.toArray && (linkedSale.category === 'FISH' || original.lines?.some((l: any) => l.accountCode === '4010'))) {
          const allBatches = await targetDb.fishBatches.toArray();
          const batch = allBatches.find(
            (b: any) =>
              b.id === original.reference ||
              linkedSale!.items?.some((it: any) => it.itemId === b.id) ||
              (original.narration && original.narration.includes(b.id))
          );
          if (batch) {
            const soldQty = Number(linkedSale.items?.[0]?.quantity || 0);
            const revAmt = Number(linkedSale.totalAmount || 0);
            const newHarvestWeight = Math.max(0, Math.round(((batch.harvestWeightKg || 0) - soldQty) * 100) / 100);
            const newHarvestRev = Math.max(0, Math.round(((batch.harvestRevenue || 0) - revAmt) * 100) / 100);
            await targetDb.fishBatches.update(batch.id, {
              harvestWeightKg: newHarvestWeight,
              harvestRevenue: newHarvestRev,
              status: batch.status === 'HARVESTED' ? 'ACTIVE' : batch.status,
              synced: false
            });
          }
        }

        // Crop Cycle harvest restoration
        if (targetDb.cropCycles?.toArray && (linkedSale.category === 'CROP' || original.lines?.some((l: any) => l.accountCode === '4020'))) {
          const allCycles = await targetDb.cropCycles.toArray();
          const cycle = allCycles.find(
            (c: any) =>
              c.id === original.reference ||
              linkedSale!.items?.some((it: any) => it.itemId === c.id) ||
              (original.narration && original.narration.includes(c.id))
          );
          if (cycle) {
            const soldQty = Number(linkedSale.items?.[0]?.quantity || 0);
            const revAmt = Number(linkedSale.totalAmount || 0);
            const newHarvestQty = Math.max(0, Math.round(((cycle.totalHarvestQuantity || 0) - soldQty) * 100) / 100);
            const newHarvestRev = Math.max(0, Math.round(((cycle.totalHarvestRevenue || 0) - revAmt) * 100) / 100);
            await targetDb.cropCycles.update(cycle.id, {
              totalHarvestQuantity: newHarvestQty,
              totalHarvestRevenue: newHarvestRev,
              status: (cycle.status === 'HARVESTED' || cycle.status === 'CLOSED') ? 'GROWING' : cycle.status,
              synced: false
            });
          }
        }

        // AR revert
        if (linkedSale.paymentMethod === 'CREDIT' && linkedSale.customerId && targetDb.parties?.get) {
          const customer = await targetDb.parties.get(linkedSale.customerId);
          if (customer) {
            await targetDb.parties.update(customer.id, {
              balance: Math.round(((customer.balance || 0) - linkedSale.totalAmount) * 100) / 100
            });
          }
        }

        // Cash / Bank revert
        if (linkedSale.paymentMethod === 'CASH' && targetDb.cashBankAccounts?.where) {
          const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await targetDb.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round(((cashAcc.currentBalance || 0) - linkedSale.totalAmount) * 100) / 100
            });
          }
        } else if (linkedSale.paymentMethod === 'BANK' && targetDb.cashBankAccounts) {
          const bankAcc = linkedSale.bankAccountId && targetDb.cashBankAccounts.get
            ? await targetDb.cashBankAccounts.get(linkedSale.bankAccountId)
            : await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await targetDb.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round(((bankAcc.currentBalance || 0) - linkedSale.totalAmount) * 100) / 100
            });
          }
        }
      }

      // Process linked Purchase reversal
      if (linkedPurchase && linkedPurchase.status !== 'CANCELLED') {
        // Operational record
        await targetDb.purchases.update(linkedPurchase.id, { status: 'CANCELLED', synced: false });

        // Inventory deduction - verified sufficient above, never silently clamp to zero
        if (targetDb.inventoryItems?.get && Array.isArray(linkedPurchase.items)) {
          for (const it of linkedPurchase.items) {
            const invItem = await targetDb.inventoryItems.get(it.itemId);
            if (invItem) {
              const currentStock = Number(invItem.currentStock || 0);
              const deductQty = Number(it.quantity || 0);
              if (currentStock < deductQty) {
                throw new Error(
                  `ক্রয় চালান রিভার্সাল ব্যর্থ: '${invItem.nameBn || it.itemName}' এর পর্যাপ্ত স্টক নেই (বর্তমান স্টক: ${currentStock}, কর্তন প্রয়োজন: ${deductQty})। স্টক নেগেটিভ করা যাবে না।`
                );
              }
              await targetDb.inventoryItems.update(invItem.id, {
                currentStock: Math.round((currentStock - deductQty) * 100) / 100,
                synced: false
              });
            }
          }
        }

        // Stock movement reversal: create counter movement linked to original movement
        if (targetDb.stockMovements?.toArray) {
          const movements = await targetDb.stockMovements.toArray();
          const toReverse = movements.filter((m: any) =>
            !m.reversedBy &&
            m.movementType !== 'REVERSAL' &&
            (m.referenceId === linkedPurchase!.invoiceNumber ||
              m.referenceId === linkedPurchase!.id ||
              (m.movementType === 'PURCHASE' && linkedPurchase!.items?.some((it: any) => it.itemId === m.itemId && it.quantity === m.quantity)))
          );
          for (const sm of toReverse) {
            await recordStockMovementReversal(
              sm,
              today,
              linkedPurchase!.invoiceNumber || linkedPurchase!.id,
              `ক্রয় চালান ${linkedPurchase!.invoiceNumber || linkedPurchase!.id} বাতিল`
            );
          }
        }

        // AP revert
        if (linkedPurchase.paymentMethod === 'CREDIT' && linkedPurchase.supplierId && targetDb.parties?.get) {
          const supplier = await targetDb.parties.get(linkedPurchase.supplierId);
          if (supplier) {
            await targetDb.parties.update(supplier.id, {
              balance: Math.round(((supplier.balance || 0) - linkedPurchase.grandTotal) * 100) / 100
            });
          }
        }

        // Cash / Bank revert
        if (linkedPurchase.paymentMethod === 'CASH' && targetDb.cashBankAccounts?.where) {
          const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await targetDb.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round(((cashAcc.currentBalance || 0) + linkedPurchase.grandTotal) * 100) / 100
            });
          }
        } else if (linkedPurchase.paymentMethod === 'BANK' && targetDb.cashBankAccounts) {
          const bankAcc = linkedPurchase.bankAccountId && targetDb.cashBankAccounts.get
            ? await targetDb.cashBankAccounts.get(linkedPurchase.bankAccountId)
            : await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await targetDb.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round(((bankAcc.currentBalance || 0) + linkedPurchase.grandTotal) * 100) / 100
            });
          }
        }
      }

      // Check for linked AnimalEvent
      let linkedEvent: AnimalEvent | undefined;
      if (targetDb.animalEvents?.toArray) {
        const allEvents = await targetDb.animalEvents.toArray();
        linkedEvent = allEvents.find(
          (e: any) => e.journalEntryId === original.id || (original.reference && e.id === original.reference)
        );
      }

      if (linkedEvent) {
        // Operational record
        if (targetDb.animalEvents?.delete) {
          await targetDb.animalEvents.delete(linkedEvent.id);
        }

        // Animal cost breakdown revert
        if (linkedEvent.animalId && targetDb.animals?.get) {
          const freshAnimal = await targetDb.animals.get(linkedEvent.animalId);
          if (freshAnimal) {
            const feedCost = linkedEvent.eventType === 'FEED' ? (linkedEvent.cost || 0) : 0;
            const medCost = (linkedEvent.eventType === 'VACCINE' || linkedEvent.eventType === 'TREATMENT') ? (linkedEvent.cost || 0) : 0;
            const isLabour = (linkedEvent.eventType as string) === 'LABOUR';
            const labourCost = isLabour ? (linkedEvent.cost || 0) : 0;
            const otherCost = (!isLabour && linkedEvent.eventType !== 'FEED' && linkedEvent.eventType !== 'VACCINE' && linkedEvent.eventType !== 'TREATMENT') ? (linkedEvent.cost || 0) : 0;

            const newFeed = Math.max(0, (freshAnimal.accumulatedFeedCost || 0) - feedCost);
            const newMed = Math.max(0, (freshAnimal.accumulatedMedCost || 0) - medCost);
            const newLabour = Math.max(0, (freshAnimal.accumulatedLabourCost || 0) - labourCost);
            const newOther = Math.max(0, (freshAnimal.otherCosts || 0) - otherCost);
            const newTotal = Math.max(0, (freshAnimal.purchaseCost || 0) + newFeed + newMed + newLabour + newOther);

            await targetDb.animals.update(freshAnimal.id, {
              accumulatedFeedCost: Math.round(newFeed * 100) / 100,
              accumulatedMedCost: Math.round(newMed * 100) / 100,
              accumulatedLabourCost: Math.round(newLabour * 100) / 100,
              otherCosts: Math.round(newOther * 100) / 100,
              totalCost: Math.round(newTotal * 100) / 100,
              synced: false
            });
          }
        }

        // Feed stock revert
        if (linkedEvent.feedItemId && linkedEvent.feedQuantityUsed && linkedEvent.feedQuantityUsed > 0 && targetDb.inventoryItems?.get) {
          const feedItem = await targetDb.inventoryItems.get(linkedEvent.feedItemId);
          if (feedItem) {
            await targetDb.inventoryItems.update(feedItem.id, {
              currentStock: Math.round(((feedItem.currentStock || 0) + linkedEvent.feedQuantityUsed) * 100) / 100,
              synced: false
            });
          }
        }

        // Feed stock movement reversal: create counter movement linked to original movement
        if (targetDb.stockMovements?.toArray) {
          const movements = await targetDb.stockMovements.toArray();
          const toReverse = movements.filter((m: any) =>
            !m.reversedBy &&
            m.movementType !== 'REVERSAL' &&
            m.referenceId === linkedEvent!.id
          );
          for (const sm of toReverse) {
            await recordStockMovementReversal(
              sm,
              today,
              linkedEvent!.id,
              `পশুর ইভেন্ট ${linkedEvent!.id} বাতিল`
            );
          }
        }

        // Cash/Bank revert if paid
        if (linkedEvent.cost && linkedEvent.cost > 0) {
          const cashLine = original.lines.find((l: any) => l.accountCode === '1010' && (l.credit || 0) > 0);
          const bankLine = original.lines.find((l: any) => l.accountCode === '1030' && (l.credit || 0) > 0);
          if (cashLine && targetDb.cashBankAccounts?.where) {
            const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
            if (cashAcc) {
              await targetDb.cashBankAccounts.update(cashAcc.id, {
                currentBalance: Math.round(((cashAcc.currentBalance || 0) + (cashLine.credit || 0)) * 100) / 100
              });
            }
          } else if (bankLine && targetDb.cashBankAccounts?.where) {
            const bankAcc = await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
            if (bankAcc) {
              await targetDb.cashBankAccounts.update(bankAcc.id, {
                currentBalance: Math.round(((bankAcc.currentBalance || 0) + (bankLine.credit || 0)) * 100) / 100
              });
            }
          }
        }
      }

      // Check for linked Payment
      let linkedPayment: PaymentRecord | undefined;
      if (targetDb.payments?.toArray) {
        const allPayments = await targetDb.payments.toArray();
        linkedPayment = allPayments.find(
          (p: any) => p.journalEntryId === original.id || (original.reference && (p.id === original.reference || (p as any).receiptNumber === original.reference))
        );
      }

      if (linkedPayment && (linkedPayment as any).status !== 'CANCELLED') {
        await targetDb.payments.update(linkedPayment.id, { status: 'CANCELLED', synced: false });

        if (linkedPayment.parentId) {
          if (targetDb.sales?.get) {
            const parentSale = await targetDb.sales.get(linkedPayment.parentId);
            if (parentSale) {
              const newPaid = Math.max(0, Math.round(((parentSale.paidAmount || 0) - linkedPayment.amount) * 100) / 100);
              const newDue = Math.round(((parentSale.totalAmount || parentSale.grandTotal || 0) - newPaid) * 100) / 100;
              await targetDb.sales.update(parentSale.id, {
                paidAmount: newPaid,
                dueAmount: newDue,
                status: newPaid <= 0 ? 'DUE' : 'PARTIAL'
              });
            }
          }
          if (targetDb.purchases?.get) {
            const parentPurchase = await targetDb.purchases.get(linkedPayment.parentId);
            if (parentPurchase) {
              const newPaid = Math.max(0, Math.round(((parentPurchase.paidAmount || 0) - linkedPayment.amount) * 100) / 100);
              const newDue = Math.round(((parentPurchase.grandTotal || 0) - newPaid) * 100) / 100;
              await targetDb.purchases.update(parentPurchase.id, {
                paidAmount: newPaid,
                dueAmount: newDue,
                status: newPaid <= 0 ? 'DUE' : 'PARTIAL'
              });
            }
          }
        }

        if (linkedPayment.partyId && targetDb.parties?.get) {
          const party = await targetDb.parties.get(linkedPayment.partyId);
          if (party) {
            const isReceipt = (linkedPayment as any).type === 'RECEIPT' || linkedPayment.parentType === 'SALE';
            const delta = isReceipt ? linkedPayment.amount : -linkedPayment.amount;
            await targetDb.parties.update(party.id, {
              balance: Math.round(((party.balance || 0) + delta) * 100) / 100
            });
          }
        }

        if (linkedPayment.paymentMethod === 'CASH' && targetDb.cashBankAccounts?.where) {
          const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            const isReceipt = (linkedPayment as any).type === 'RECEIPT' || linkedPayment.parentType === 'SALE';
            const delta = isReceipt ? -linkedPayment.amount : linkedPayment.amount;
            await targetDb.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round(((cashAcc.currentBalance || 0) + delta) * 100) / 100
            });
          }
        } else if (linkedPayment.paymentMethod === 'BANK' && targetDb.cashBankAccounts) {
          const bankAcc = linkedPayment.bankAccountId && targetDb.cashBankAccounts.get
            ? await targetDb.cashBankAccounts.get(linkedPayment.bankAccountId)
            : await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            const isReceipt = (linkedPayment as any).type === 'RECEIPT' || linkedPayment.parentType === 'SALE';
            const delta = isReceipt ? -linkedPayment.amount : linkedPayment.amount;
            await targetDb.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round(((bankAcc.currentBalance || 0) + delta) * 100) / 100
            });
          }
        }
      }

      // Check for linked FixedAsset
      let linkedFixedAsset: FixedAsset | undefined;
      if (targetDb.fixedAssets?.toArray) {
        const allAssets = await targetDb.fixedAssets.toArray();
        linkedFixedAsset = allAssets.find(
          (a: any) =>
            a.journalEntryId === original.id ||
            a.disposalJournalId === original.id ||
            (original.reference && a.id === original.reference) ||
            (original.narration && original.narration.includes(a.id))
        );
      }

      if (linkedFixedAsset) {
        // Case A: Fixed Asset Disposal Reversal
        const isDisposal =
          original.id === linkedFixedAsset.disposalJournalId ||
          original.voucherNumber?.startsWith('DISP') ||
          (original.narration && (original.narration.includes('স্থায়ী সম্পদ অপসারণ') || original.narration.includes('Asset Disposal')));

        if (isDisposal) {
          await targetDb.fixedAssets.update(linkedFixedAsset.id, {
            status: 'ACTIVE',
            disposalJournalId: undefined,
            disposalDate: undefined,
            disposalProceeds: undefined,
            gainLossOnDisposal: undefined,
            synced: false
          });
        } else {
          // Case B: Depreciation Entry Reversal
          const deprLine = original.lines.find((l: any) => l.accountCode === '1590' && (l.credit || 0) > 0) ||
            original.lines.find((l: any) => (l.accountCode === '6140' || l.accountCode === '6040') && (l.debit || 0) > 0);

          if (deprLine) {
            const deprAmt = Number(deprLine.credit || deprLine.debit || 0);
            const newAccum = Math.max(0, Math.round(((linkedFixedAsset.accumulatedDepreciation || 0) - deprAmt) * 100) / 100);
            const newBookValue = Math.round(((linkedFixedAsset.originalCost || 0) - newAccum) * 100) / 100;
            await targetDb.fixedAssets.update(linkedFixedAsset.id, {
              accumulatedDepreciation: newAccum,
              currentBookValue: newBookValue,
              synced: false
            });
          } else {
            // Case C: Acquisition Reversal
            if (linkedFixedAsset.status !== 'CANCELLED') {
              await targetDb.fixedAssets.update(linkedFixedAsset.id, {
                status: 'CANCELLED',
                synced: false
              });
              // If purchased on credit, revert AP in parties
              if (linkedFixedAsset.paymentMethod === 'CREDIT' && linkedFixedAsset.supplierId && targetDb.parties?.get) {
                const supplier = await targetDb.parties.get(linkedFixedAsset.supplierId);
                if (supplier) {
                  await targetDb.parties.update(supplier.id, {
                    balance: Math.round(((supplier.balance || 0) - linkedFixedAsset.originalCost) * 100) / 100,
                    synced: false
                  });
                }
              }
            }
          }
        }
      }

      // Check for linked Loan
      let linkedLoan: Loan | undefined;
      if (targetDb.loans?.toArray) {
        const allLoans = await targetDb.loans.toArray();
        linkedLoan = allLoans.find(
          (l: any) =>
            l.id === original.reference ||
            l.loanNumber === original.reference ||
            (original as any).loanId === l.id ||
            (l.schedule && l.schedule.some((s: any) => s.repaymentJournalId === original.id))
        );
      }

      if (linkedLoan) {
        const principalLine = original.lines.find(
          (l: any) => (l.accountCode === '2110' || l.accountCode === '2120') && (l.debit || 0) > 0
        );
        const interestLine = original.lines.find(
          (l: any) => l.accountCode === '8010' && (l.debit || 0) > 0
        );
        const hasRepaymentSchedule = linkedLoan.schedule?.some((s: any) => s.repaymentJournalId === original.id);

        if (principalLine || interestLine || hasRepaymentSchedule) {
          // Loan Repayment Reversal
          const pAmt = Number(principalLine?.debit || 0);
          const iAmt = Number(interestLine?.debit || 0);

          const curRemP = linkedLoan.remainingPrincipal ?? linkedLoan.remainingBalance ?? 0;
          const newRemP = Math.round((curRemP + pAmt) * 100) / 100;
          const newTotalPaidP = Math.max(0, Math.round(((linkedLoan.totalPaidPrincipal || 0) - pAmt) * 100) / 100);
          const newTotalPaidI = Math.max(0, Math.round(((linkedLoan.totalPaidInterest || 0) - iAmt) * 100) / 100);

          let updatedSchedule = linkedLoan.schedule ? [...linkedLoan.schedule] : [];
          if (updatedSchedule.length > 0) {
            let matched = false;
            updatedSchedule = updatedSchedule.map((s: any) => {
              if (s.repaymentJournalId === original.id) {
                matched = true;
                return { ...s, isPaid: false, paidDate: undefined, repaymentJournalId: undefined };
              }
              return s;
            });
            if (!matched && (pAmt > 0 || iAmt > 0)) {
              for (let i = updatedSchedule.length - 1; i >= 0; i--) {
                if (updatedSchedule[i].isPaid) {
                  updatedSchedule[i] = { ...updatedSchedule[i], isPaid: false, paidDate: undefined, repaymentJournalId: undefined };
                  break;
                }
              }
            }
          }

          await targetDb.loans.update(linkedLoan.id, {
            remainingPrincipal: newRemP,
            remainingBalance: newRemP,
            totalPaidPrincipal: newTotalPaidP,
            totalPaidInterest: newTotalPaidI,
            schedule: updatedSchedule,
            status: 'ACTIVE',
            synced: false
          });
        } else {
          // Loan Disbursement Reversal
          const isDisbursement = original.lines.some(
            (l: any) => (l.accountCode === '2110' || l.accountCode === '2120') && (l.credit || 0) > 0
          );
          if (isDisbursement && linkedLoan.status !== 'CANCELLED') {
            await targetDb.loans.update(linkedLoan.id, {
              status: 'CANCELLED',
              synced: false
            });
          }
        }
      }

      // Check for linked Investor
      let linkedInvestor: Investor | undefined;
      if (targetDb.investors?.toArray) {
        const allInvestors = await targetDb.investors.toArray();
        linkedInvestor = allInvestors.find(
          (inv: any) =>
            inv.id === original.reference ||
            inv.id === (original as any).relatedInvestorId ||
            (original.lines && original.lines.some((l: any) => l.memo && l.memo.includes(inv.name)))
        );
      }

      if (linkedInvestor) {
        const capCreditLine = original.lines.find((l: any) => l.accountCode === '3020' && (l.credit || 0) > 0);
        const capDebitLine = original.lines.find((l: any) => l.accountCode === '3020' && (l.debit || 0) > 0);
        const profitPayableCreditLine = original.lines.find((l: any) => l.accountCode === '2050' && (l.credit || 0) > 0);
        const profitPayableDebitLine = original.lines.find((l: any) => l.accountCode === '2050' && (l.debit || 0) > 0);

        if (capCreditLine) {
          // Case 1: Reversal of Investor Capital Contribution
          const contribAmt = Number(capCreditLine.credit || 0);
          const newCapContrib = Math.max(0, Math.round(((linkedInvestor.capitalContributed || linkedInvestor.capitalAmount || 0) - contribAmt) * 100) / 100);
          const newNetCap = Math.max(0, Math.round(((linkedInvestor.netCapital || linkedInvestor.currentBalance || 0) - contribAmt) * 100) / 100);
          const newStatus = newNetCap <= 0 && newCapContrib <= 0 ? 'CANCELLED' : linkedInvestor.status;
          await targetDb.investors.update(linkedInvestor.id, {
            capitalContributed: newCapContrib,
            capitalAmount: newCapContrib,
            netCapital: newNetCap,
            currentBalance: newNetCap,
            currentEquityBalance: newNetCap,
            status: newStatus,
            synced: false
          });
        } else if (capDebitLine) {
          // Case 2: Reversal of Capital Return / Withdrawal
          const returnAmt = Number(capDebitLine.debit || 0);
          const newCapReturned = Math.max(0, Math.round(((linkedInvestor.totalCapitalReturned || 0) - returnAmt) * 100) / 100);
          const newWithdrawals = Math.max(0, Math.round(((linkedInvestor.withdrawals || linkedInvestor.totalWithdrawals || 0) - returnAmt) * 100) / 100);
          const newNetCap = Math.round(((linkedInvestor.netCapital || 0) + returnAmt) * 100) / 100;
          await targetDb.investors.update(linkedInvestor.id, {
            totalCapitalReturned: newCapReturned,
            withdrawals: newWithdrawals,
            totalWithdrawals: newWithdrawals,
            netCapital: newNetCap,
            currentBalance: newNetCap,
            currentEquityBalance: newNetCap,
            status: 'ACTIVE',
            synced: false
          });
        } else if (profitPayableCreditLine) {
          // Case 3: Reversal of Profit Allocation
          const allocAmt = Number(profitPayableCreditLine.credit || 0);
          const newAlloc = Math.max(0, Math.round(((linkedInvestor.totalProfitAllocated || 0) - allocAmt) * 100) / 100);
          const newPayable = Math.max(0, Math.round(((linkedInvestor.profitPayable || 0) - allocAmt) * 100) / 100);
          await targetDb.investors.update(linkedInvestor.id, {
            totalProfitAllocated: newAlloc,
            profitPayable: newPayable,
            synced: false
          });
        } else if (profitPayableDebitLine) {
          // Case 4: Reversal of Profit Payment
          const paidAmt = Number(profitPayableDebitLine.debit || 0);
          const newTotalPaid = Math.max(0, Math.round(((linkedInvestor.totalProfitPaid || 0) - paidAmt) * 100) / 100);
          const newPayable = Math.round(((linkedInvestor.profitPayable || 0) + paidAmt) * 100) / 100;
          await targetDb.investors.update(linkedInvestor.id, {
            totalProfitPaid: newTotalPaid,
            profitPayable: newPayable,
            synced: false
          });
        }
      }

      // Check for linked FishBatch (Stocking or Production Cost)
      let linkedFishBatch: FishBatch | undefined;
      if (targetDb.fishBatches?.toArray) {
        const allFishBatches = await targetDb.fishBatches.toArray();
        linkedFishBatch = allFishBatches.find(
          (fb: any) =>
            fb.id === original.reference ||
            (original.narration && original.narration.includes(fb.id)) ||
            (original.lines && original.lines.some((l: any) => l.memo && l.memo.includes(fb.id)))
        );
      }

      if (linkedFishBatch) {
        const costLine = original.lines.find(
          (l: any) => (l.accountCode === '1580' || l.accountCode === '1054') && (l.debit || 0) > 0
        );

        const isStocking =
          original.voucherType === 'PAYMENT' &&
          (original.narration?.includes('পোনা মজুদ') ||
            original.lines.some((l: any) => l.memo && l.memo.includes('[FINGERLING] পোনা মজুদ')));

        if (isStocking && linkedFishBatch.status !== 'CANCELLED') {
          await targetDb.fishBatches.update(linkedFishBatch.id, {
            status: 'CANCELLED',
            synced: false
          });
        } else if (costLine && costLine.debit) {
          const costAmt = Number(costLine.debit);
          const memo = (costLine.memo || original.narration || '').toUpperCase();

          let fCost = linkedFishBatch.fingerlingCost || 0;
          let feedCost = linkedFishBatch.totalFeedCost || 0;
          let medCost = linkedFishBatch.medicineCost || 0;
          let labCost = linkedFishBatch.labourCost || 0;
          let elecCost = linkedFishBatch.electricityCost || 0;
          let waterCost = linkedFishBatch.waterTreatmentCost || 0;
          let otherCost = linkedFishBatch.otherCost || 0;

          if (memo.includes('FINGERLING') || memo.includes('পোনা')) {
            fCost = Math.max(0, Math.round((fCost - costAmt) * 100) / 100);
          } else if (memo.includes('FEED') || memo.includes('খাদ্য')) {
            feedCost = Math.max(0, Math.round((feedCost - costAmt) * 100) / 100);
          } else if (memo.includes('MEDICINE') || memo.includes('ওষুধ')) {
            medCost = Math.max(0, Math.round((medCost - costAmt) * 100) / 100);
          } else if (memo.includes('LABOUR') || memo.includes('শ্রমিক')) {
            labCost = Math.max(0, Math.round((labCost - costAmt) * 100) / 100);
          } else if (memo.includes('ELECTRICITY') || memo.includes('বিদ্যুৎ')) {
            elecCost = Math.max(0, Math.round((elecCost - costAmt) * 100) / 100);
          } else if (memo.includes('WATER_TREATMENT') || memo.includes('পানি')) {
            waterCost = Math.max(0, Math.round((waterCost - costAmt) * 100) / 100);
          } else {
            otherCost = Math.max(0, Math.round((otherCost - costAmt) * 100) / 100);
          }

          const newTotalCost = Math.round((fCost + feedCost + medCost + labCost + elecCost + waterCost + otherCost) * 100) / 100;

          await targetDb.fishBatches.update(linkedFishBatch.id, {
            fingerlingCost: fCost,
            totalFeedCost: feedCost,
            medicineCost: medCost,
            labourCost: labCost,
            electricityCost: elecCost,
            waterTreatmentCost: waterCost,
            otherCost,
            totalCost: newTotalCost,
            synced: false
          });

          // If feed inventory was consumed, restore inventory stock and record counter stock movement
          if (targetDb.stockMovements?.toArray) {
            const movements = await targetDb.stockMovements.toArray();
            const sm = movements.find(
              (m: any) =>
                !m.reversedBy &&
                m.movementType !== 'REVERSAL' &&
                m.referenceId === linkedFishBatch!.id &&
                (m.movementType === 'CONSUMPTION' || (m as any).referenceType === 'PRODUCTION') &&
                (m.date === original.date || m.totalValue === costAmt)
            );
            if (sm) {
              if (targetDb.inventoryItems?.get) {
                const invItem = await targetDb.inventoryItems.get(sm.itemId);
                if (invItem) {
                  await targetDb.inventoryItems.update(invItem.id, {
                    currentStock: Math.round(((invItem.currentStock || 0) + sm.quantity) * 100) / 100,
                    synced: false
                  });
                }
              }
              await recordStockMovementReversal(
                sm,
                today,
                linkedFishBatch!.id,
                `মাছের খাদ্য/পোনা ব্যবহার বাতিল`
              );
            }
          }
        }
      }

      // Check for linked CropCycle (Production Cost)
      let linkedCropCycle: CropCycle | undefined;
      if (targetDb.cropCycles?.toArray) {
        const allCycles = await targetDb.cropCycles.toArray();
        linkedCropCycle = allCycles.find(
          (cc: any) =>
            cc.id === original.reference ||
            (original.narration && original.narration.includes(cc.id)) ||
            (original.lines && original.lines.some((l: any) => l.memo && l.memo.includes(cc.id)))
        );
      }

      if (linkedCropCycle) {
        const costLine = original.lines.find(
          (l: any) => (l.accountCode === '1054' || l.accountCode === '1052' || l.accountCode === '1053') && (l.debit || 0) > 0
        );

        if (costLine && costLine.debit) {
          const costAmt = Number(costLine.debit);
          const memo = (costLine.memo || original.narration || '').toUpperCase();

          let seedCost = linkedCropCycle.seedCost || 0;
          let fertCost = linkedCropCycle.fertilizerCost || 0;
          let irrigCost = linkedCropCycle.irrigationCost || 0;
          let labCost = linkedCropCycle.labourCost || 0;
          let protCost = linkedCropCycle.protectionCost || 0;
          let machCost = linkedCropCycle.machineryCost || 0;
          let otherCost = linkedCropCycle.otherCost || 0;

          if (memo.includes('SEED') || memo.includes('বীজ')) {
            seedCost = Math.max(0, Math.round((seedCost - costAmt) * 100) / 100);
          } else if (memo.includes('FERTILIZER') || memo.includes('সার')) {
            fertCost = Math.max(0, Math.round((fertCost - costAmt) * 100) / 100);
          } else if (memo.includes('IRRIGATION') || memo.includes('সেচ')) {
            irrigCost = Math.max(0, Math.round((irrigCost - costAmt) * 100) / 100);
          } else if (memo.includes('LABOUR') || memo.includes('শ্রমিক')) {
            labCost = Math.max(0, Math.round((labCost - costAmt) * 100) / 100);
          } else if (memo.includes('PROTECTION') || memo.includes('বালাইনাশক') || memo.includes('কীটনাশক')) {
            protCost = Math.max(0, Math.round((protCost - costAmt) * 100) / 100);
          } else if (memo.includes('MACHINERY') || memo.includes('যন্ত্রপাতি') || memo.includes('চাষ')) {
            machCost = Math.max(0, Math.round((machCost - costAmt) * 100) / 100);
          } else {
            otherCost = Math.max(0, Math.round((otherCost - costAmt) * 100) / 100);
          }

          const newTotalCost = Math.round((seedCost + fertCost + irrigCost + labCost + protCost + machCost + otherCost) * 100) / 100;

          await targetDb.cropCycles.update(linkedCropCycle.id, {
            seedCost,
            fertilizerCost: fertCost,
            irrigationCost: irrigCost,
            labourCost: labCost,
            protectionCost: protCost,
            machineryCost: machCost,
            otherCost,
            totalCost: newTotalCost,
            synced: false
          });

          // If inventory was consumed (fertilizer/seed), restore stock and record counter stock movement
          if (targetDb.stockMovements?.toArray) {
            const movements = await targetDb.stockMovements.toArray();
            const sm = movements.find(
              (m: any) =>
                !m.reversedBy &&
                m.movementType !== 'REVERSAL' &&
                m.referenceId === linkedCropCycle!.id &&
                m.movementType === 'CONSUMPTION' &&
                (m.date === original.date || m.totalValue === costAmt)
            );
            if (sm) {
              if (targetDb.inventoryItems?.get) {
                const invItem = await targetDb.inventoryItems.get(sm.itemId);
                if (invItem) {
                  await targetDb.inventoryItems.update(invItem.id, {
                    currentStock: Math.round(((invItem.currentStock || 0) + sm.quantity) * 100) / 100,
                    synced: false
                  });
                }
              }
              await recordStockMovementReversal(
                sm,
                today,
                linkedCropCycle!.id,
                `ফসলের সার/বীজ ব্যবহার বাতিল`
              );
            }
          }
        }
      }

      // Check for Production Receipt (transfer from farm production to inventory)
      const isProductionReceipt =
        (original.narration?.includes('উৎপাদন প্রাপ্তি') ||
          original.narration?.includes('খামার উৎপাদন হতে ইনভেন্টরিতে স্থানান্তর')) &&
        original.lines.some((l: any) => l.accountCode >= '1051' && l.accountCode <= '1056' && (l.debit || 0) > 0);

      if (isProductionReceipt && targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const prMovements = movements.filter(
          (m: any) =>
            !m.reversedBy &&
            m.movementType !== 'REVERSAL' &&
            m.movementType === 'PRODUCTION' &&
            (m.referenceId === original.reference || (original.lines && original.lines.some((l: any) => l.memo && l.memo.includes(m.referenceId))))
        );
        for (const sm of prMovements) {
          if (targetDb.inventoryItems?.get) {
            const invItem = await targetDb.inventoryItems.get(sm.itemId);
            if (invItem) {
              await targetDb.inventoryItems.update(invItem.id, {
                currentStock: Math.max(0, Math.round(((invItem.currentStock || 0) - sm.quantity) * 100) / 100),
                synced: false
              });
            }
          }
          await recordStockMovementReversal(
            sm,
            today,
            original.reference || sm.referenceId,
            `উৎপাদন প্রাপ্তি বাতিল`
          );
        }
      }

      // Generic check for any stock movements referencing this journal entry that haven't been reversed yet
      if (targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const orphanMovements = movements.filter((m: any) =>
          !m.reversedBy &&
          m.movementType !== 'REVERSAL' &&
          (m.referenceId === original.id || m.referenceId === original.voucherNumber || (original.reference && m.referenceId === original.reference))
        );
        for (const sm of orphanMovements) {
          if (!linkedPurchase && sm.movementType === 'PURCHASE' && targetDb.inventoryItems?.get) {
            const invItem = await targetDb.inventoryItems.get(sm.itemId);
            if (invItem) {
              const currentStock = Number(invItem.currentStock || 0);
              const deductQty = Number(sm.quantity || 0);
              if (currentStock < deductQty) {
                throw new Error(
                  `ক্রয় চালান রিভার্সাল ব্যর্থ: '${invItem.nameBn || sm.itemId}' এর পর্যাপ্ত স্টক নেই (বর্তমান স্টক: ${currentStock}, কর্তন প্রয়োজন: ${deductQty})। স্টক নেগেটিভ করা যাবে না।`
                );
              }
              await targetDb.inventoryItems.update(invItem.id, {
                currentStock: Math.round((currentStock - deductQty) * 100) / 100,
                synced: false
              });
            }
          }
          await recordStockMovementReversal(
            sm,
            today,
            original.voucherNumber || original.id,
            `জাবেদা দাখিলা ${original.voucherNumber || original.id} রিভার্সাল`
          );
        }
      }

      // Check if there are AP credit lines that need party balance reduction (e.g. Fixed asset or production cost on credit)
      if (!linkedPurchase && targetDb.parties?.get) {
        const apLine = original.lines.find((l: any) => l.accountCode === '2010' && (l.credit || 0) > 0);
        if (apLine) {
          const supplierId =
            linkedFixedAsset?.supplierId ||
            (original as any).supplierId ||
            (original as any).partyId;
          if (supplierId) {
            const party = await targetDb.parties.get(supplierId);
            if (party) {
              await targetDb.parties.update(party.id, {
                balance: Math.round(((party.balance || 0) - (apLine.credit || 0)) * 100) / 100,
                synced: false
              });
            }
          }
        }
      }

      // Check for linked BankTransfer (Contra cash/bank transfer)
      let linkedBankTransfer: any;
      if (targetDb.bankTransfers?.toArray) {
        const allTransfers = await targetDb.bankTransfers.toArray();
        linkedBankTransfer = allTransfers.find(
          (bt: any) =>
            bt.journalEntryId === original.id ||
            bt.voucherNumber === original.voucherNumber ||
            (original.reference && bt.reference === original.reference)
        );
      }

      if (linkedBankTransfer) {
        if (targetDb.bankTransfers?.update) {
          await targetDb.bankTransfers.update(linkedBankTransfer.id, {
            status: 'REVERSED',
            reversedBy: reversalEntry.id,
            synced: false
          });
        }

        if (targetDb.cashBankAccounts?.get) {
          const fromAcc = await targetDb.cashBankAccounts.get(linkedBankTransfer.fromAccountId);
          const toAcc = await targetDb.cashBankAccounts.get(linkedBankTransfer.toAccountId);
          if (fromAcc) {
            await targetDb.cashBankAccounts.update(fromAcc.id, {
              currentBalance: Math.round(((fromAcc.currentBalance || 0) + linkedBankTransfer.amount) * 100) / 100,
              synced: false
            });
          }
          if (toAcc) {
            await targetDb.cashBankAccounts.update(toAcc.id, {
              currentBalance: Math.round(((toAcc.currentBalance || 0) - linkedBankTransfer.amount) * 100) / 100,
              synced: false
            });
          }
        }
      }

      // If standalone journal entry with direct Cash/Bank movements (not covered by above)
      if (!linkedSale && !linkedPurchase && !linkedEvent && !linkedPayment && !linkedBankTransfer && targetDb.cashBankAccounts?.where) {
        for (const line of original.lines) {
          if (line.accountCode === '1010') {
            const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
            if (cashAcc) {
              const netCashDelta = (line.credit || 0) - (line.debit || 0);
              if (netCashDelta !== 0) {
                await targetDb.cashBankAccounts.update(cashAcc.id, {
                  currentBalance: Math.round(((cashAcc.currentBalance || 0) + netCashDelta) * 100) / 100
                });
              }
            }
          } else if (line.accountCode === '1030') {
            let bankAcc: any;
            const targetBankId =
              linkedFixedAsset?.bankAccountId ||
              (original as any).bankAccountId ||
              (original as any).cashBankAccountId;
            if (targetBankId && targetDb.cashBankAccounts?.get) {
              bankAcc = await targetDb.cashBankAccounts.get(targetBankId);
            }
            if (!bankAcc && targetDb.cashBankAccounts?.where) {
              bankAcc = await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
            }
            if (bankAcc) {
              const netBankDelta = (line.credit || 0) - (line.debit || 0);
              if (netBankDelta !== 0) {
                await targetDb.cashBankAccounts.update(bankAcc.id, {
                  currentBalance: Math.round(((bankAcc.currentBalance || 0) + netBankDelta) * 100) / 100
                });
              }
            }
          }
        }
      }

      // Safe audit log
      if (targetDb.auditLogs?.put) {
        await safeInsert(targetDb.auditLogs, {
          id: generateUniqueId('audit'),
          timestamp: new Date().toISOString(),
          userId: currentUserId || 'system',
          role: 'OWNER',
          action: 'REVERSE_VOUCHER',
          module: 'ACCOUNTING',
          recordId: reversalEntry.id,
          status: 'SUCCESS',
          details: `মূল এন্ট্রি #${original.voucherNumber || original.id} (${original.id}) রিভার্স করা হয়েছে। নতুন সংশোধনী ভাউচার: ${reversalEntry.voucherNumber}`
        });
      }

      return {
        original: updatedOriginal,
        reversal: reversalEntry,
        sale: linkedSale,
        purchase: linkedPurchase,
        animalEvent: linkedEvent,
        payment: linkedPayment,
        loan: linkedLoan,
        investor: linkedInvestor,
        fixedAsset: linkedFixedAsset,
        fishBatch: linkedFishBatch,
        cropCycle: linkedCropCycle
      };
    };

    // Execute within Dexie / MockTable transaction for strict all-or-nothing reversal atomicity
    if (typeof targetDb.transaction === 'function') {
      return await targetDb.transaction('rw', transactionTables, performReversal);
    } else {
      return await performReversal();
    }
  } finally {
    activeReversalLocks.delete(originalEntryId);
  }
}

/**
 * Atomic Reversal of any transaction across journal, cash/bank, inventory, stock movement, AR/AP, and operational records.
 */
export const reverseTransaction = reverseJournalEntry;

/**
 * Helper to resolve or synthesize account metadata for any account code
 * present in journal entries (guaranteeing that Balance Sheet & P&L remain balanced).
 */
function resolveAccountMetadata(code: string, accountsByCode: Map<string, Account>): Account {
  const existing = accountsByCode.get(code);
  if (existing) return existing;

  const defaultAcc = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === code);
  if (defaultAcc) {
    accountsByCode.set(code, defaultAcc);
    return defaultAcc;
  }

  // Infer class based on standard Bangladesh Agro ERP chart prefix
  const firstDigit = code.charAt(0);
  let accountClass: AccountClass = 'ASSET';
  let normalBalance: NormalBalance = 'DEBIT';

  if (firstDigit === '2') {
    accountClass = 'LIABILITY';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '3') {
    accountClass = 'EQUITY';
    normalBalance = code === '3040' ? 'DEBIT' : 'CREDIT';
  } else if (firstDigit === '4') {
    accountClass = 'REVENUE';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '5') {
    accountClass = 'COGS';
    normalBalance = 'DEBIT';
  } else if (firstDigit === '6') {
    accountClass = 'EXPENSE';
    normalBalance = 'DEBIT';
  } else if (firstDigit === '7') {
    accountClass = 'OTHER_INCOME';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '8') {
    accountClass = 'OTHER_EXPENSE';
    normalBalance = 'DEBIT';
  } else {
    accountClass = 'ASSET';
    normalBalance = code === '1590' ? 'CREDIT' : 'DEBIT';
  }

  const synthesized: Account = {
    id: `acc_${code}`,
    code,
    nameBn: `[অনিবন্ধিত হিসাব] ${code}`,
    nameEn: `[Unregistered Account] ${code}`,
    accountClass,
    normalBalance,
    isSystem: false,
    isActive: true
  };
  accountsByCode.set(code, synthesized);
  return synthesized;
}

/**
 * Computes Trial Balance from all posted journal entries.
 * Detects genuine imbalance and identifies any invalid/orphan account references.
 */
export async function generateTrialBalance(
  dateRange?: DateRangeFilter,
  dbInstance?: any
): Promise<{
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  difference: number;
  orphanAccounts: string[];
  hasInvalidAccounts: boolean;
}> {
  const targetDb = dbInstance || db;
  const rawAccounts = await targetDb.accounts.toArray();
  let entries = await targetDb.journalEntries.toArray();

  const normalizeToDateString = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return null;
      const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1];
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      return null;
    }
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString().slice(0, 10);
    }
    if (typeof val === 'number') {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
    return null;
  };

  const rawStart = dateRange?.startDate || (dateRange as any)?.fromDate || (dateRange as any)?.from || (dateRange as any)?.start;
  const rawEnd = dateRange?.endDate || (dateRange as any)?.toDate || (dateRange as any)?.to || (dateRange as any)?.end;
  const cleanStartDate = normalizeToDateString(rawStart);
  const cleanEndDate = normalizeToDateString(rawEnd);

  if (cleanStartDate || cleanEndDate) {
    entries = entries.filter((e) => {
      const entryDate = normalizeToDateString(e.date);
      if (!entryDate) return false;
      if (cleanStartDate && entryDate < cleanStartDate) return false;
      if (cleanEndDate && entryDate > cleanEndDate) return false;
      return true;
    });
  }

  // Deduplicate accounts by code
  const accountMap = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountMap.has(acc.code)) {
      accountMap.set(acc.code, acc);
    }
  }
  const accounts = Array.from(accountMap.values());

  const balances: Record<string, { debitSum: number; creditSum: number }> = {};
  const orphanAccountsSet = new Set<string>();

  for (const acc of accounts) {
    balances[acc.code] = { debitSum: 0, creditSum: 0 };
  }

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;
      if (!balances[code]) {
        balances[code] = { debitSum: 0, creditSum: 0 };
      }
      balances[code].debitSum += Number(line.debit || 0);
      balances[code].creditSum += Number(line.credit || 0);

      if (!accountMap.has(code)) {
        orphanAccountsSet.add(code);
      }
    }
  }

  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  // 1. Process valid accounts
  for (const acc of accounts) {
    const raw = balances[acc.code] || { debitSum: 0, creditSum: 0 };
    const net = raw.debitSum - raw.creditSum;

    let debit = 0;
    let credit = 0;

    if (acc.normalBalance === 'DEBIT') {
      if (net >= 0) {
        debit = net;
      } else {
        credit = Math.abs(net);
      }
    } else {
      // CREDIT normal balance
      if (net <= 0) {
        credit = Math.abs(net);
      } else {
        debit = net;
      }
    }

    if (debit > 0 || credit > 0) {
      debit = Math.round(debit * 100) / 100;
      credit = Math.round(credit * 100) / 100;
      totalDebit += debit;
      totalCredit += credit;

      rows.push({
        accountId: acc.id,
        code: acc.code,
        nameBn: acc.nameBn,
        nameEn: acc.nameEn,
        accountClass: acc.accountClass,
        debit,
        credit
      });
    }
  }

  // 2. Process orphan / invalid accounts to detect genuine imbalance and report references
  for (const orphanCode of orphanAccountsSet) {
    const raw = balances[orphanCode] || { debitSum: 0, creditSum: 0 };
    const net = raw.debitSum - raw.creditSum;

    let debit = 0;
    let credit = 0;

    if (net >= 0) {
      debit = net;
    } else {
      credit = Math.abs(net);
    }

    if (debit > 0 || credit > 0) {
      debit = Math.round(debit * 100) / 100;
      credit = Math.round(credit * 100) / 100;
      totalDebit += debit;
      totalCredit += credit;

      rows.push({
        accountId: `orphan_${orphanCode}`,
        code: orphanCode,
        nameBn: `[অবৈধ / অনাথ হিসাব] ${orphanCode}`,
        nameEn: `[INVALID / ORPHAN ACCOUNT] ${orphanCode}`,
        accountClass: 'UNKNOWN',
        debit,
        credit,
        isOrphan: true
      });
    }
  }

  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
  const orphanAccounts = Array.from(orphanAccountsSet);

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: difference === 0,
    difference,
    orphanAccounts,
    hasInvalidAccounts: orphanAccounts.length > 0
  };
}

/**
 * Computes Profit & Loss Statement (লাভ-ক্ষতি বিবরণী)
 */
export async function generateProfitLoss(
  dateRange?: DateRangeFilter | { fromDate?: string; toDate?: string; from?: string; to?: string; start?: string; end?: string; startDate?: string; endDate?: string } | string,
  options?: { includeClosingEntries?: boolean },
  dbInstance: any = db
): Promise<ProfitLossReport> {
  const rawAccounts = await dbInstance.accounts.toArray();
  let entries = await dbInstance.journalEntries.toArray();

  // Exclude Year-End Closing entries unless explicitly requested so that P&L reports reflect actual period operations
  if (!options?.includeClosingEntries) {
    entries = entries.filter((e) => !e.reference?.startsWith('YEC-') && !e.voucherNumber?.startsWith('YEC'));
  }

  let cleanStartDate: string | undefined = undefined;
  let cleanEndDate: string | undefined = undefined;

  if (typeof dateRange === 'string') {
    const trimmed = dateRange.trim();
    if (/^\d{4}$/.test(trimmed)) {
      cleanStartDate = `${trimmed}-01-01`;
      cleanEndDate = `${trimmed}-12-31`;
    } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
      cleanStartDate = `${trimmed}-01`;
      const [yStr, mStr] = trimmed.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      cleanEndDate = `${trimmed}-${String(lastDay).padStart(2, '0')}`;
    } else {
      const s = trimmed.split('T')[0].split(' ')[0].trim();
      cleanStartDate = s;
      cleanEndDate = s;
    }
  } else if (dateRange && typeof dateRange === 'object') {
    const rawStart = (dateRange as any).startDate || (dateRange as any).fromDate || (dateRange as any).from || (dateRange as any).start;
    const rawEnd = (dateRange as any).endDate || (dateRange as any).toDate || (dateRange as any).to || (dateRange as any).end;

    if (rawStart) {
      cleanStartDate = String(rawStart).trim().split('T')[0].split(' ')[0].trim();
    }
    if (rawEnd) {
      cleanEndDate = String(rawEnd).trim().split('T')[0].split(' ')[0].trim();
    }
  }

  // Filter transactions strictly within the selected reporting period:
  // cleanStartDate <= entryDate <= cleanEndDate
  if (cleanStartDate || cleanEndDate) {
    entries = entries.filter((e) => {
      if (!e.date) return false;
      const entryDate = String(e.date).trim().split('T')[0].split(' ')[0].trim();
      if (!entryDate) return false;
      if (cleanStartDate && entryDate < cleanStartDate) return false;
      if (cleanEndDate && entryDate > cleanEndDate) return false;
      return true;
    });
  }

  // Deduplicate accounts by code
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  const accountBalances: Record<string, number> = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;

      if (accountBalances[code] === undefined) accountBalances[code] = 0;
      const acc = resolveAccountMetadata(code, accountsByCode);
      if (acc.normalBalance === 'CREDIT') {
        accountBalances[code] += (Number(line.credit || 0) - Number(line.debit || 0));
      } else {
        accountBalances[code] += (Number(line.debit || 0) - Number(line.credit || 0));
      }
    }
  }

  const revenues: { code: string; nameBn: string; amount: number }[] = [];
  const cogs: { code: string; nameBn: string; amount: number }[] = [];
  const operatingExpenses: { code: string; nameBn: string; amount: number }[] = [];
  const otherIncome: { code: string; nameBn: string; amount: number }[] = [];
  const otherExpenses: { code: string; nameBn: string; amount: number }[] = [];

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOperatingExpenses = 0;
  let totalOtherIncome = 0;
  let totalOtherExpenses = 0;

  for (const acc of accountsByCode.values()) {
    const val = Math.round((accountBalances[acc.code] || 0) * 100) / 100;
    if (val === 0) continue;

    if (acc.accountClass === 'REVENUE') {
      revenues.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalRevenue += val;
    } else if (acc.accountClass === 'COGS') {
      cogs.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalCogs += val;
    } else if (acc.accountClass === 'EXPENSE') {
      operatingExpenses.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOperatingExpenses += val;
    } else if (acc.accountClass === 'OTHER_INCOME') {
      otherIncome.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOtherIncome += val;
    } else if (acc.accountClass === 'OTHER_EXPENSE') {
      otherExpenses.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOtherExpenses += val;
    }
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCogs = Math.round(totalCogs * 100) / 100;
  const grossProfit = Math.round((totalRevenue - totalCogs) * 100) / 100;
  totalOperatingExpenses = Math.round(totalOperatingExpenses * 100) / 100;
  const operatingProfit = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;
  totalOtherIncome = Math.round(totalOtherIncome * 100) / 100;
  totalOtherExpenses = Math.round(totalOtherExpenses * 100) / 100;
  const netProfit = Math.round((operatingProfit + totalOtherIncome - totalOtherExpenses) * 100) / 100;

  return {
    revenues,
    totalRevenue,
    cogs,
    totalCogs,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    operatingProfit,
    otherIncome,
    totalOtherIncome,
    otherExpenses,
    totalOtherExpenses,
    netProfit
  };
}

/**
 * Computes Balance Sheet (উদ্বৃত্তপত্র)
 * Assets = Liabilities + Equity
 * Correctly handles Contra accounts (e.g. 1590 Accumulated Depreciation reduces Assets,
 * and 3040 Owner Drawings reduces Equity).
 */
export async function generateBalanceSheet(
  dateRange?: DateRangeFilter | { asOfDate?: string; date?: string; toDate?: string } | string,
  dbInstance: any = db
): Promise<BalanceSheetReport> {
  const rawAccounts = await dbInstance.accounts.toArray();
  let entries = await dbInstance.journalEntries.toArray();

  // Balance Sheet at endDate must use cumulative balances through that date (date <= endDate).
  // Report start date (dateRange.startDate) must NEVER filter Balance Sheet balances.
  const rawEndDate = typeof dateRange === 'string'
    ? dateRange
    : ((dateRange as any)?.endDate || (dateRange as any)?.asOfDate || (dateRange as any)?.date || (dateRange as any)?.toDate);
  const cleanEndDate = rawEndDate ? String(rawEndDate).split('T')[0].trim() : undefined;

  if (cleanEndDate) {
    entries = entries.filter((e) => {
      if (!e.date) return false;
      const entryDate = String(e.date).split('T')[0];
      return entryDate <= cleanEndDate;
    });
  }

  // Find the latest closed period on or before the balance sheet as-of date (if any)
  const allClosed = await getClosedPeriods(dbInstance);
  const relevantClosed = allClosed.filter(
    (cp: any) => cp.endDate && (!cleanEndDate || String(cp.endDate).split('T')[0] <= cleanEndDate)
  );
  const latestRelevantClosed = relevantClosed.length > 0 ? relevantClosed[0] : null;

  let unclosedStartDate: string | undefined = undefined;
  if (latestRelevantClosed?.endDate) {
    const cleanClosedEnd = String(latestRelevantClosed.endDate).split('T')[0];
    const [y, m, d] = cleanClosedEnd.split('-').map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    unclosedStartDate = nextDay.toISOString().split('T')[0];
  }

  // Only calculate net profit for the unclosed portion of the period so that closed profits transferred
  // into Retained Earnings (3050) are not double-counted on the Balance Sheet.
  // We explicitly do NOT filter by dateRange.startDate.
  const pl = await generateProfitLoss({
    startDate: unclosedStartDate,
    endDate: cleanEndDate
  }, undefined, dbInstance);

  // Deduplicate accounts by code
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  // Accumulate raw debits and credits per account code
  const debits: Record<string, number> = {};
  const credits: Record<string, number> = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;
      resolveAccountMetadata(code, accountsByCode);

      if (debits[code] === undefined) debits[code] = 0;
      if (credits[code] === undefined) credits[code] = 0;
      debits[code] += Number(line.debit || 0);
      credits[code] += Number(line.credit || 0);
    }
  }

  const assets: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];
  const liabilities: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];
  const equity: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const acc of accountsByCode.values()) {
    const dr = debits[acc.code] || 0;
    const cr = credits[acc.code] || 0;

    if (acc.accountClass === 'ASSET') {
      const isContra = acc.normalBalance === 'CREDIT'; // e.g. 1590 Accumulated Depreciation
      if (isContra) {
        // Contra-asset normal balance is CREDIT. A credit balance reduces total assets.
        const contraVal = Math.round((cr - dr) * 100) / 100;
        if (contraVal !== 0) {
          assets.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalAssets -= contraVal; // Contra account reduces asset balance
        }
      } else {
        // Normal asset: Debit balance increases assets
        const assetVal = Math.round((dr - cr) * 100) / 100;
        if (assetVal !== 0) {
          assets.push({ code: acc.code, nameBn: acc.nameBn, amount: assetVal, isContra: false });
          totalAssets += assetVal;
        }
      }
    } else if (acc.accountClass === 'LIABILITY') {
      const isContra = acc.normalBalance === 'DEBIT';
      if (isContra) {
        // Contra-liability: Debit balance reduces liabilities
        const contraVal = Math.round((dr - cr) * 100) / 100;
        if (contraVal !== 0) {
          liabilities.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalLiabilities -= contraVal;
        }
      } else {
        // Normal liability: Credit balance increases liabilities
        const liabVal = Math.round((cr - dr) * 100) / 100;
        if (liabVal !== 0) {
          liabilities.push({ code: acc.code, nameBn: acc.nameBn, amount: liabVal, isContra: false });
          totalLiabilities += liabVal;
        }
      }
    } else if (acc.accountClass === 'EQUITY') {
      const isContra = acc.normalBalance === 'DEBIT'; // e.g. 3040 Owner Drawings
      if (isContra) {
        // Contra-equity: Debit balance reduces equity
        const contraVal = Math.round((dr - cr) * 100) / 100;
        if (contraVal !== 0) {
          equity.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalEquity -= contraVal; // Contra-equity reduces total equity
        }
      } else {
        // Normal equity: Credit balance increases equity
        const eqVal = Math.round((cr - dr) * 100) / 100;
        if (eqVal !== 0) {
          equity.push({ code: acc.code, nameBn: acc.nameBn, amount: eqVal, isContra: false });
          totalEquity += eqVal;
        }
      }
    }
  }

  totalAssets = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;

  // Current year net profit rolls directly into Equity
  const currentYearNetProfit = pl.netProfit;
  totalEquity = Math.round((totalEquity + currentYearNetProfit) * 100) / 100;

  let totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;
  let discrepancy = Math.round(Math.abs(totalAssets - totalLiabilitiesAndEquity) * 100) / 100;

  // Financial rounding reconciliation: discrepancy <= 0.01 is within float rounding tolerance
  const isBalanced = discrepancy <= 0.01;
  if (isBalanced && discrepancy > 0) {
    totalLiabilitiesAndEquity = totalAssets;
    discrepancy = 0;
  }

  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    currentYearNetProfit,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    discrepancy
  };
}

export const LEGACY_ACCOUNTS_MIGRATION_KEY = 'goted_legacy_accounts_migrated_v1';

/**
 * Automatically migrates deprecated / legacy accounts (e.g. 1050)
 * to their designated canonical replacements (1051, 1052, 1053, 1055).
 * Migration runs ONLY when the required migration has not already been completed.
 */
export async function migrateLegacyAccounts(force = false): Promise<number> {
  // Check if migration has already been completed via systemConfig or localStorage
  if (!force) {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem(LEGACY_ACCOUNTS_MIGRATION_KEY) === 'true') {
        return 0;
      }
      const sysConfig = await db.systemConfig.toCollection().first();
      if (sysConfig?.legacyAccountsMigratedAt) {
        if (typeof window !== 'undefined') {
          localStorage.setItem(LEGACY_ACCOUNTS_MIGRATION_KEY, 'true');
        }
        return 0;
      }
    } catch {
      // Fallback to check if migration is needed
    }
  }

  let migratedCount = 0;
  const accounts = await db.accounts.toArray();
  const entries = await db.journalEntries.toArray();

  for (const entry of entries) {
    // 1. Check if record has already been migrated - already-migrated records must not be modified again
    if ((entry as any).legacyMigrated || (entry as any).isMigrated || (entry as any).migratedFromLegacy) {
      continue;
    }

    let entryModified = false;
    const newLines = entry.lines.map((line) => {
      // If line is already migrated, preserve as-is
      if ((line as any).legacyMigrated || (line as any).isMigrated || (line as any).migratedFromLegacy) {
        return line;
      }

      const code = line.accountCode?.trim();
      const isLegacy1050 = code === '1050' || line.accountId === '1050' || line.accountId === 'acc_1050';

      if (isLegacy1050) {
        entryModified = true;
        migratedCount++;
        const desc = `${entry.narration || ''} ${line.memo || ''} ${line.accountName || ''}`.toLowerCase();
        let targetCode = '1051';
        let targetName = 'মজুদ খাদ্য (Feed Inventory)';
        if (desc.includes('সার') || desc.includes('বীজ') || desc.includes('fert') || desc.includes('seed')) {
          targetCode = '1052';
          targetName = 'মজুদ বীজ ও সার (Seed & Fertilizer Inventory)';
        } else if (desc.includes('কাঁচামাল') || desc.includes('raw') || desc.includes('ঔষধ') || desc.includes('medicine')) {
          targetCode = '1053';
          targetName = 'মজুদ কাঁচামাল (Raw Materials)';
        } else if (desc.includes('প্রক্রিয়াধীন') || desc.includes('wip')) {
          targetCode = '1054';
          targetName = 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)';
        } else if (desc.includes('প্যাকেজিং') || desc.includes('pack')) {
          targetCode = '1056';
          targetName = 'মজুদ প্যাকেজিং সামগ্রী (Packaging Inventory)';
        } else if (
          desc.includes('পণ্য') ||
          desc.includes('দুধ') ||
          desc.includes('মাছ') ||
          desc.includes('product') ||
          desc.includes('meat') ||
          desc.includes('মাংস')
        ) {
          targetCode = '1055';
          targetName = 'বিক্রয়যোগ্য উৎপাদিত পণ্য (Finished Farm Products)';
        }

        const targetAcc = accounts.find((a) => a.code === targetCode);
        const resolvedAccountId = targetAcc
          ? targetAcc.id
          : line.accountId?.startsWith('acc_')
            ? `acc_${targetCode}`
            : targetCode;

        return {
          ...line,
          accountId: resolvedAccountId,
          accountCode: targetCode,
          accountName: targetName,
          legacyMigrated: true
        };
      }
      return line;
    });

    if (entryModified) {
      await db.journalEntries.update(entry.id, {
        lines: newLines,
        legacyMigrated: true
      });
    }
  }

  // Remove legacy 1050 account if present in db.accounts
  const legacy1050 = await db.accounts.where('code').equals('1050').first();
  if (legacy1050) {
    await db.accounts.delete(legacy1050.id);
  }

  // Mark migration as completed in both indexedDb systemConfig and localStorage
  const nowIso = new Date().toISOString();
  try {
    const sysConfig = await db.systemConfig.toCollection().first();
    if (sysConfig) {
      if (!sysConfig.legacyAccountsMigratedAt) {
        await db.systemConfig.update(sysConfig.ownerUid, {
          legacyAccountsMigratedAt: nowIso
        });
      }
    } else {
      await db.systemConfig.put({
        ownerUid: 'system_default',
        companyName: 'The Goated Farm',
        currency: '৳',
        initializedAt: nowIso,
        legacyAccountsMigratedAt: nowIso
      });
    }
  } catch (err) {
    console.warn('Notice: Could not persist legacy accounts migration flag in systemConfig:', err);
  }

  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LEGACY_ACCOUNTS_MIGRATION_KEY, 'true');
    }
  } catch {}

  return migratedCount;
}

/**
 * Computes General Ledger entries for a specific account code
 */
export async function getGeneralLedger(accountCode: string): Promise<{ account?: Account; entries: LedgerEntry[]; netBalance: number }> {
  const account = await db.accounts.where('code').equals(accountCode).first();
  const entries = await db.journalEntries.orderBy('date').toArray();

  const ledgerEntries: LedgerEntry[] = [];
  let running = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode === accountCode) {
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);

        if (account?.normalBalance === 'CREDIT') {
          running += (credit - debit);
        } else {
          running += (debit - credit);
        }

        ledgerEntries.push({
          journalEntryId: entry.id,
          date: entry.date,
          voucherNumber: entry.voucherNumber,
          voucherType: entry.voucherType,
          narration: entry.narration,
          debit,
          credit,
          runningBalance: Math.round(running * 100) / 100,
          reversedBy: entry.reversedBy,
          reversalOf: entry.reversalOf,
          correctionOf: entry.correctionOf,
          relatedPerson: entry.relatedPerson,
          createdBy: entry.createdBy
        });
      }
    }
  }

  return {
    account,
    entries: ledgerEntries,
    netBalance: Math.round(running * 100) / 100
  };
}

export interface YearEndClosingPreview {
  closingDate: string;
  previousClosingDate?: string;
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  totalOtherIncome: number;
  totalOtherExpenses: number;
  netProfit: number;
  previousTransferred: number;
  netProfitToTransfer: number;
  canClose: boolean;
  blockReason?: string;
}

/**
 * Calculates a preview of the year-end closing up to the chosen date.
 * Reuses the existing Profit & Loss logic from the beginning up to the chosen date.
 */
export async function previewYearEndClosing(closingDate: string, dbInstance?: any): Promise<YearEndClosingPreview> {
  const targetDb = dbInstance || db;
  const emptyPreview = (reason: string, prevDate?: string): YearEndClosingPreview => ({
    closingDate,
    previousClosingDate: prevDate,
    totalRevenue: 0,
    totalCogs: 0,
    grossProfit: 0,
    totalOperatingExpenses: 0,
    operatingProfit: 0,
    totalOtherIncome: 0,
    totalOtherExpenses: 0,
    netProfit: 0,
    previousTransferred: 0,
    netProfitToTransfer: 0,
    canClose: false,
    blockReason: reason
  });

  if (!closingDate) {
    return emptyPreview('সমাপ্তি তারিখ নির্বাচন করা হয়নি।');
  }

  const todayStr = new Date().toISOString().split('T')[0];
  if (closingDate > todayStr) {
    return emptyPreview(`সমাপ্তি তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
  }

  // Check ClosedPeriod for the exact fiscal year-end date
  const allClosed = await getClosedPeriods(targetDb);
  const existingExact = allClosed.find((p) => p.endDate === closingDate);
  if (existingExact) {
    return emptyPreview(
      `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর সমাপ্তির তারিখ (${closingDate}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই তারিখে পুনরায় সমাপ্তি সম্ভব নয়।`,
      existingExact.endDate
    );
  }

  const latestClosed = allClosed.length > 0 ? allClosed[0] : null;
  if (latestClosed && closingDate <= latestClosed.endDate) {
    return emptyPreview(
      `সমাপ্তি তারিখটি পূর্ববর্তী বন্ধ সময়কালের শেষ তারিখ (${latestClosed.endDate}) এর পরের হতে হবে।`,
      latestClosed.endDate
    );
  }

  const conflictingClosed = allClosed.find((p) => p.endDate >= closingDate);
  if (conflictingClosed) {
    return emptyPreview(
      `সমাপ্তি তারিখটি ইতোমধ্যে সমাপ্ত সময়কালের অন্তর্ভুক্ত (${conflictingClosed.endDate})।`,
      conflictingClosed.endDate
    );
  }

  // Pre-closing integrity check: Trial Balance must be balanced before closing
  const tb = await generateTrialBalance({ endDate: closingDate }, targetDb);
  if (!tb.isBalanced) {
    return emptyPreview(
      `রেওয়ামিল ভারসাম্যহীন (Trial Balance is unbalanced: পার্থক্য ৳${tb.difference})। রেওয়ামিল না মেলা পর্যন্ত বছর সমাপ্তি করা সম্ভব নয়।`
    );
  }

  const rawAccounts = await targetDb.accounts.toArray();
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  // Read all journal entries up to closingDate
  const allEntries = await targetDb.journalEntries.toArray();
  const periodEntries = allEntries.filter((e) => e.date && e.date <= closingDate);

  const accountBalances: Record<string, number> = {};
  for (const entry of periodEntries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;
      if (accountBalances[code] === undefined) accountBalances[code] = 0;
      const acc = resolveAccountMetadata(code, accountsByCode);
      if (acc.normalBalance === 'CREDIT') {
        accountBalances[code] += (Number(line.credit || 0) - Number(line.debit || 0));
      } else {
        accountBalances[code] += (Number(line.debit || 0) - Number(line.credit || 0));
      }
    }
  }

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOperatingExpenses = 0;
  let totalOtherIncome = 0;
  let totalOtherExpenses = 0;

  const allRelevantCodes = new Set([...accountsByCode.keys(), ...Object.keys(accountBalances)]);
  for (const code of allRelevantCodes) {
    const bal = Math.round((accountBalances[code] || 0) * 100) / 100;
    if (bal === 0) continue;

    const acc = resolveAccountMetadata(code, accountsByCode);
    if (acc.accountClass === 'REVENUE') {
      totalRevenue += bal;
    } else if (acc.accountClass === 'COGS') {
      totalCogs += bal;
    } else if (acc.accountClass === 'EXPENSE') {
      totalOperatingExpenses += bal;
    } else if (acc.accountClass === 'OTHER_INCOME') {
      totalOtherIncome += bal;
    } else if (acc.accountClass === 'OTHER_EXPENSE') {
      totalOtherExpenses += bal;
    }
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCogs = Math.round(totalCogs * 100) / 100;
  totalOperatingExpenses = Math.round(totalOperatingExpenses * 100) / 100;
  totalOtherIncome = Math.round(totalOtherIncome * 100) / 100;
  totalOtherExpenses = Math.round(totalOtherExpenses * 100) / 100;

  const grossProfit = Math.round((totalRevenue - totalCogs) * 100) / 100;
  const operatingProfit = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;
  const netProfit = Math.round((operatingProfit + totalOtherIncome - totalOtherExpenses) * 100) / 100;

  const previousTransferred = Math.round(
    allClosed.reduce((sum, p) => sum + (Number(p.netProfitTransferred) || 0), 0) * 100
  ) / 100;

  return {
    closingDate,
    previousClosingDate: latestClosed ? latestClosed.endDate : undefined,
    totalRevenue,
    totalCogs,
    grossProfit,
    totalOperatingExpenses,
    operatingProfit,
    totalOtherIncome,
    totalOtherExpenses,
    netProfit,
    previousTransferred,
    netProfitToTransfer: netProfit,
    canClose: true
  };
}

const activeClosingLocks = new Set<string>();

async function findAccountByCode(targetDb: any, code: string): Promise<Account | undefined> {
  if (targetDb.accounts?.where) {
    try {
      const res = await targetDb.accounts.where('code').equals(code).first();
      if (res) return res;
    } catch {}
  }
  if (targetDb.accounts?.toArray) {
    try {
      const all = await targetDb.accounts.toArray();
      return all.find((a: any) => a.code === code);
    } catch {}
  }
  return undefined;
}

/**
 * Executes Year-End Closing:
 * 1. Validates that closingDate is not already closed in ClosedPeriod, and strictly after any previously closed period.
 * 2. Closes all Revenue and Expense (COGS, Operating Expense, Other Expense/Income) account balances into Income Summary (3060).
 * 3. Transfers the net profit/loss from Income Summary (3060) to Retained Earnings (3050).
 * 4. After closing, all Revenue and Expense accounts have a zero balance.
 * 5. Balanced closing entry: Assets = Liabilities + Equity maintained.
 * 6. Records the closed period in db.closedPeriods.
 */
export async function executeYearEndClosing(
  params:
    | string
    | {
        closingDate?: string;
        endDate?: string;
        date?: string;
        fiscalYear?: string | number;
        period?: string;
        startDate?: string;
        currentUserId?: string;
        userId?: string;
        notes?: string;
        dbInstance?: any;
        [key: string]: any;
      },
  optionalUserIdOrDb?: any,
  optionalNotes?: string,
  optionalDb?: any
): Promise<{
  closedPeriod: ClosedPeriod;
  journalEntry?: JournalEntry;
  netProfitTransferred: number;
}> {
  let closingDate: string = '';
  let currentUserId: string = 'system';
  let notes: string | undefined = undefined;
  let targetDb: any = db;
  let fiscalYearInput: string | number | undefined = undefined;
  let startDateInput: string | undefined = undefined;
  let periodInput: string | undefined = undefined;

  if (typeof params === 'string') {
    closingDate = params;
    if (typeof optionalUserIdOrDb === 'string') {
      currentUserId = optionalUserIdOrDb;
      notes = optionalNotes;
      targetDb = optionalDb || db;
    } else if (optionalUserIdOrDb && typeof optionalUserIdOrDb === 'object') {
      targetDb = optionalUserIdOrDb.closedPeriods ? optionalUserIdOrDb : (optionalDb || db);
      notes = optionalNotes;
    }
  } else if (params && typeof params === 'object') {
    closingDate = params.closingDate || params.endDate || params.date || '';
    fiscalYearInput = params.fiscalYear;
    startDateInput = params.startDate;
    periodInput = params.period;
    if (!closingDate && fiscalYearInput) {
      closingDate = `${fiscalYearInput}-12-31`;
    }
    if (!closingDate && periodInput) {
      if (/^\d{4}$/.test(periodInput)) {
        closingDate = `${periodInput}-12-31`;
      } else {
        closingDate = periodInput;
      }
    }
    currentUserId = params.currentUserId || params.userId || 'system';
    notes = params.notes;
    targetDb = params.dbInstance || (optionalUserIdOrDb?.closedPeriods ? optionalUserIdOrDb : (optionalDb || db));
  }

  closingDate = (closingDate || '').trim();
  if (!closingDate) {
    throw new Error('সমাপ্তি তারিখ প্রদান করা বাধ্যতামূলক (Closing date is required)।');
  }

  const todayStr = new Date().toISOString().split('T')[0];
  if (closingDate > todayStr) {
    throw new Error(`সমাপ্তি তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
  }

  // Concurrency locking: prevent concurrent close attempts on the same period
  const lockKey = `${closingDate}_${fiscalYearInput || ''}_${periodInput || ''}`;
  if (activeClosingLocks.has(lockKey) || activeClosingLocks.has(closingDate)) {
    throw new Error(
      `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর বা সময়কালের সমাপ্তি প্রক্রিয়া ইতোমধ্যে চলমান রয়েছে। একই সময়কালে ডুপ্লিকেট বছর সমাপ্তি প্রতিরোধ করা হয়েছে (Fiscal period closing already in progress).`
    );
  }
  activeClosingLocks.add(lockKey);
  activeClosingLocks.add(closingDate);

  try {
    const txTables = [
      targetDb.accounts,
      targetDb.journalEntries,
      targetDb.closedPeriods,
      targetDb.auditLogs
    ].filter(Boolean);

    // Atomic execution block
    const runInTx = async (): Promise<{
      closedPeriod: ClosedPeriod;
      journalEntry?: JournalEntry;
      netProfitTransferred: number;
    }> => {
      // 1. Check ClosedPeriod for duplicate fiscal period closing
      const allClosed = await getClosedPeriods(targetDb);
      const cleanDate = closingDate.split('T')[0];

      // A. Exact same closing date
      const existingExactClosed = allClosed.find(
        (p) =>
          (p.endDate && p.endDate.trim() === closingDate) ||
          (p.endDate && p.endDate.split('T')[0] === cleanDate)
      );
      if (existingExactClosed) {
        throw new Error(
          `হিসাবকাল সমাপ্তি ত্রুটি: এই অর্থবছর সমাপ্তির তারিখ (${closingDate}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই তারিখে পুনরায় বছর সমাপ্তি করা যাবে না (Fiscal year-end date already closed).`
        );
      }

      // B. Same fiscal year (if fiscalYear explicitly passed, e.g. 2025)
      if (fiscalYearInput) {
        const yrStr = String(fiscalYearInput);
        const existingYear = allClosed.find(
          (p) => (p.endDate && p.endDate.startsWith(yrStr)) || (p.notes && p.notes.includes(yrStr))
        );
        if (existingYear) {
          throw new Error(
            `হিসাবকাল সমাপ্তি ত্রুটি: অর্থবছর (${yrStr}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই অর্থবছর পুনরায় সমাপ্তি করা যাবে না (Fiscal year ${yrStr} already closed).`
          );
        }
      }

      // C. Range match
      if (startDateInput) {
        const existingRange = allClosed.find(
          (p) => p.startDate === startDateInput && (p.endDate === closingDate || p.endDate.split('T')[0] === cleanDate)
        );
        if (existingRange) {
          throw new Error(
            `হিসাবকাল সমাপ্তি ত্রুটি: হিসাবকাল (${startDateInput} থেকে ${closingDate}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই সময়কাল পুনরায় সমাপ্তি করা যাবে না (Fiscal period already closed).`
          );
        }
      }

      // D. Period name match
      if (periodInput) {
        const existingNamed = allClosed.find(
          (p) => (p as any).period === periodInput || (p.notes && p.notes.includes(String(periodInput)))
        );
        if (existingNamed) {
          throw new Error(
            `হিসাবকাল সমাপ্তি ত্রুটি: হিসাবকাল (${periodInput}) ইতোমধ্যে বন্ধ (Closed) করা হয়েছে। একই সময়কাল পুনরায় সমাপ্তি করা যাবে না (Fiscal period already closed).`
          );
        }
      }

      // E. Chronological ordering: closingDate must be strictly after the latest closed period
      const latestClosed = allClosed.length > 0 ? allClosed[0] : null;
      if (latestClosed && cleanDate <= latestClosed.endDate.split('T')[0]) {
        throw new Error(
          `সমাপ্তি তারিখটি পূর্ববর্তী বন্ধ সময়কালের শেষ তারিখ (${latestClosed.endDate}) এর পরের হতে হবে। পূর্ববর্তী বা একই বন্ধ সময়কালে পুনরায় সমাপ্তি করা যাবে না (Fiscal period ending on or before ${latestClosed.endDate} is already closed).`
        );
      }

      // F. Any period with endDate >= closingDate
      const conflictingClosed = allClosed.find((p) => p.endDate && p.endDate.split('T')[0] >= cleanDate);
      if (conflictingClosed) {
        throw new Error(
          `সমাপ্তি তারিখটি ইতোমধ্যে সমাপ্ত সময়কালের অন্তর্ভুক্ত (${conflictingClosed.endDate})। পুনরায় হিসাবকাল সমাপ্তি অনুমোদিত নয় (Fiscal period already closed).`
        );
      }

      // G. Overlapping range check
      const rangeConflicted = allClosed.find(
        (p) => p.startDate && p.endDate && cleanDate >= p.startDate.split('T')[0] && cleanDate <= p.endDate.split('T')[0]
      );
      if (rangeConflicted) {
        throw new Error(
          `সমাপ্তি তারিখটি ইতোমধ্যে সমাপ্ত সময়কালের অন্তর্ভুক্ত (${rangeConflicted.startDate} হতে ${rangeConflicted.endDate})। পুনরায় হিসাবকাল সমাপ্তি অনুমোদিত নয় (Fiscal period already closed).`
        );
      }

      // 2. Pre-closing integrity check: Trial Balance must be balanced before closing
      const preTb = await generateTrialBalance({ endDate: closingDate }, targetDb);
      if (!preTb.isBalanced) {
        throw new Error(
          `হিসাবকাল সমাপ্তি ত্রুটি: রেওয়ামিল ভারসাম্যহীন (Trial balance unbalanced)! মোট ডেবিট: ৳${preTb.totalDebit}, মোট ক্রেডিট: ৳${preTb.totalCredit} (পার্থক্য: ৳${preTb.difference})। রেওয়ামিল ভারসাম্যপূর্ণ না হলে বছর সমাপ্তি করা যাবে না।`
        );
      }

      // 3. Ensure accounts 3050 (Retained Earnings) and 3060 (Income Summary) exist
      let reAcc = await findAccountByCode(targetDb, '3050');
      if (!reAcc) {
        reAcc = {
          id: 'acc_3050',
          code: '3050',
          nameBn: 'পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)',
          nameEn: 'Retained Earnings',
          accountClass: 'EQUITY',
          normalBalance: 'CREDIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(targetDb.accounts, reAcc);
      }

      let isAcc = await findAccountByCode(targetDb, '3060');
      if (!isAcc) {
        isAcc = {
          id: 'acc_3060',
          code: '3060',
          nameBn: 'আয় সারাংশ হিসাব (Income Summary)',
          nameEn: 'Income Summary',
          accountClass: 'EQUITY',
          normalBalance: 'CREDIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(targetDb.accounts, isAcc);
      }

      const rawAccounts = await targetDb.accounts.toArray();
      const accountsByCode = new Map<string, Account>();
      for (const acc of rawAccounts) {
        if (!accountsByCode.has(acc.code)) {
          accountsByCode.set(acc.code, acc);
        }
      }

      // Read all journal entries up to closingDate
      const allJournalEntries = await targetDb.journalEntries.toArray();
      const periodEntries = allJournalEntries.filter((e: any) => e.date && e.date <= closingDate);

      // Compute cumulative balances for all accounts up to closingDate
      const accountBalances: Record<string, number> = {};
      for (const entry of periodEntries) {
        for (const line of entry.lines) {
          const code = line.accountCode?.trim();
          if (!code) continue;

          if (accountBalances[code] === undefined) accountBalances[code] = 0;
          const acc = resolveAccountMetadata(code, accountsByCode);
          if (acc.normalBalance === 'CREDIT') {
            accountBalances[code] += (Number(line.credit || 0) - Number(line.debit || 0));
          } else {
            accountBalances[code] += (Number(line.debit || 0) - Number(line.credit || 0));
          }
        }
      }

      // Identify all Revenue, COGS, Expense, Other Income, and Other Expense accounts that have non-zero balances
      const closingLines: JournalLine[] = [];
      let totalRevenueCreditsToClose = 0;
      let totalExpenseDebitsToClose = 0;

      const allAccountCodes = new Set([...accountsByCode.keys(), ...Object.keys(accountBalances)]);
      for (const code of allAccountCodes) {
        const bal = Math.round((accountBalances[code] || 0) * 100) / 100;
        if (bal === 0) continue;

        const acc = resolveAccountMetadata(code, accountsByCode);
        const isRevenueClass = acc.accountClass === 'REVENUE' || acc.accountClass === 'OTHER_INCOME';
        const isExpenseClass = acc.accountClass === 'EXPENSE' || acc.accountClass === 'COGS' || acc.accountClass === 'OTHER_EXPENSE';

        if (isRevenueClass) {
          if (bal > 0) {
            // Normal CREDIT balance: debit to zero out
            closingLines.push({
              accountId: acc.id,
              accountCode: acc.code,
              accountName: acc.nameBn,
              debit: bal,
              credit: 0,
              memo: `বছর সমাপ্তি: আয় হিসাব বন্ধ (${acc.nameBn})`
            });
            totalRevenueCreditsToClose += bal;
          } else {
            // Negative balance (DEBIT excess): credit to zero out
            const absBal = Math.abs(bal);
            closingLines.push({
              accountId: acc.id,
              accountCode: acc.code,
              accountName: acc.nameBn,
              debit: 0,
              credit: absBal,
              memo: `বছর সমাপ্তি: বিপরীত আয় হিসাব বন্ধ (${acc.nameBn})`
            });
            totalRevenueCreditsToClose -= absBal;
          }
        } else if (isExpenseClass) {
          if (bal > 0) {
            // Normal DEBIT balance: credit to zero out
            closingLines.push({
              accountId: acc.id,
              accountCode: acc.code,
              accountName: acc.nameBn,
              debit: 0,
              credit: bal,
              memo: `বছর সমাপ্তি: ব্যয় হিসাব বন্ধ (${acc.nameBn})`
            });
            totalExpenseDebitsToClose += bal;
          } else {
            // Negative balance (CREDIT excess): debit to zero out
            const absBal = Math.abs(bal);
            closingLines.push({
              accountId: acc.id,
              accountCode: acc.code,
              accountName: acc.nameBn,
              debit: absBal,
              credit: 0,
              memo: `বছর সমাপ্তি: বিপরীত ব্যয় হিসাব বন্ধ (${acc.nameBn})`
            });
            totalExpenseDebitsToClose -= absBal;
          }
        }
      }

      // Net profit is total revenues closed minus total expenses closed
      const calculatedNetProfit = Math.round((totalRevenueCreditsToClose - totalExpenseDebitsToClose) * 100) / 100;

      // Transfer the net amount directly to Retained Earnings (3050)
      if (calculatedNetProfit > 0) {
        closingLines.push({
          accountId: reAcc.id,
          accountCode: '3050',
          accountName: reAcc.nameBn,
          debit: 0,
          credit: calculatedNetProfit,
          memo: `বছর সমাপ্তি: পুঞ্জীভূত লাভে নিট লাভ স্থানান্তর (${closingDate})`
        });
      } else if (calculatedNetProfit < 0) {
        const absLoss = Math.abs(calculatedNetProfit);
        closingLines.push({
          accountId: reAcc.id,
          accountCode: '3050',
          accountName: reAcc.nameBn,
          debit: absLoss,
          credit: 0,
          memo: `বছর সমাপ্তি: পুঞ্জীভূত লাভে নিট ক্ষতি সমন্বয় (${closingDate})`
        });
      }

      // Verify balanced closing lines before posting
      const sumDebits = Math.round(closingLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
      const sumCredits = Math.round(closingLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0) * 100) / 100;
      if (sumDebits !== sumCredits) {
        throw new Error(
          `CRITICAL ACCOUNTING ERROR: সমাপনী দাখিলা ভারসাম্যহীন (Unbalanced Closing Entry)! মোট ডেবিট: ৳${sumDebits}, মোট ক্রেডিট: ৳${sumCredits}`
        );
      }

      const voucherNum = generateTransactionNumber('YEC');
      const entryId = generateUniqueId('j');
      let postedEntry: JournalEntry | undefined;

      // Post the closing journal entry if there are any balances to close
      if (closingLines.length > 0) {
        const allAccountsList: Account[] = [];
        for (const code of allAccountCodes) {
          allAccountsList.push(resolveAccountMetadata(code, accountsByCode));
        }

        postedEntry = await postJournalEntry(
          {
            id: entryId,
            voucherNumber: voucherNum,
            voucherType: 'ADJUSTMENT',
            date: closingDate,
            narration: `বছর সমাপ্তি সমাপনী দাখিলা (${closingDate}) - সকল আয় ও ব্যয় হিসাব শূন্যকরণ ও পুঞ্জীভূত লাভে নিট লাভ/ক্ষতি স্থানান্তর (Year-End Closing)`,
            reference: `YEC-${closingDate}`,
            lines: closingLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts: allAccountsList, isClosingEntry: true, dbInstance: targetDb }
        );
      }

      // Record closing in closedPeriods list
      const closedPeriod: ClosedPeriod = {
        id: generateUniqueId('cp'),
        endDate: closingDate,
        startDate: latestClosed ? latestClosed.endDate : undefined,
        netProfitTransferred: calculatedNetProfit,
        closedAt: new Date().toISOString(),
        closedBy: currentUserId,
        journalEntryId: postedEntry ? entryId : undefined,
        voucherNumber: postedEntry ? voucherNum : undefined,
        notes: notes?.trim() || undefined,
        synced: false
      };

      await safeInsert(targetDb.closedPeriods, closedPeriod);

      // Audit log entry
      if (targetDb.auditLogs) {
        try {
          await safeInsert(targetDb.auditLogs, {
            id: generateUniqueId('audit'),
            timestamp: new Date().toISOString(),
            userId: currentUserId,
            role: 'OWNER',
            action: 'YEAR_END_CLOSING',
            module: 'ACCOUNTING',
            recordId: closedPeriod.id,
            status: 'SUCCESS',
            details: `বছর সমাপ্তি সম্পন্ন (${closingDate}): সকল আয় ও ব্যয় হিসাব শূন্য করা হয়েছে এবং পুঞ্জীভূত লাভে স্থানান্তরিত ৳${calculatedNetProfit}${postedEntry ? ` (ভাউচার: ${voucherNum})` : ''}`
          });
        } catch (auditErr) {
          console.warn('Notice: Could not write audit log for year-end closing:', auditErr);
        }
      }

      // Post-closing Trial Balance verification
      const postTb = await generateTrialBalance({ endDate: closingDate }, targetDb);
      if (!postTb.isBalanced) {
        throw new Error(
          `CRITICAL ACCOUNTING ERROR: সমাপনী পরবর্তী রেওয়ামিল ভারসাম্যহীন (Post-closing Trial Balance unbalanced: পার্থক্য ৳${postTb.difference})!`
        );
      }

      return {
        closedPeriod,
        journalEntry: postedEntry,
        netProfitTransferred: calculatedNetProfit
      };
    };

    if (typeof targetDb.transaction === 'function') {
      return await targetDb.transaction('rw', txTables, runInTx);
    }

    // Fallback transaction support for custom mock tables without built-in transaction
    const tableSnapshots: Array<{
      table: any;
      restore: () => Promise<void> | void;
    }> = [];

    for (const table of txTables) {
      if (!table) continue;
      if (typeof table._snapshot === 'function' && typeof table._restore === 'function') {
        const snap = table._snapshot();
        tableSnapshots.push({
          table,
          restore: () => table._restore(snap)
        });
      } else if (table.data instanceof Map) {
        const snap = new Map(table.data);
        tableSnapshots.push({
          table,
          restore: () => { table.data = new Map(snap); }
        });
      } else if (table._data instanceof Map) {
        const snap = new Map(table._data);
        tableSnapshots.push({
          table,
          restore: () => { table._data = new Map(snap); }
        });
      } else if (Array.isArray(table.data)) {
        const snap = [...table.data];
        tableSnapshots.push({
          table,
          restore: () => { table.data = [...snap]; }
        });
      } else if (Array.isArray(table._data)) {
        const snap = [...table._data];
        tableSnapshots.push({
          table,
          restore: () => { table._data = [...snap]; }
        });
      } else if (typeof table.toArray === 'function' && (typeof table.clear === 'function' || typeof table.bulkPut === 'function' || typeof table.put === 'function')) {
        try {
          const snap = await table.toArray();
          tableSnapshots.push({
            table,
            restore: async () => {
              if (typeof table.clear === 'function') await table.clear();
              if (typeof table.bulkPut === 'function') {
                await table.bulkPut(snap);
              } else if (typeof table.put === 'function') {
                for (const item of snap) {
                  await table.put(item);
                }
              }
            }
          });
        } catch {}
      }
    }

    try {
      return await runInTx();
    } catch (err) {
      for (const { restore } of tableSnapshots) {
        try {
          await restore();
        } catch {}
      }
      throw err;
    }
  } finally {
    activeClosingLocks.delete(lockKey);
    activeClosingLocks.delete(closingDate);
  }
}

export const closeFiscalPeriod = executeYearEndClosing;
export const closePeriod = executeYearEndClosing;

/**
 * Cash Flow Statement (নগদ প্রবাহ বিবরণী)
 * Built strictly from actual dated accounting transactions (General Ledger journal entries),
 * adhering to IAS 7 / Bangladesh Accounting Standards (Direct Method):
 *   Opening cash
 *   + Operating cash flows
 *   + Investing cash flows
 *   + Financing cash flows
 *   = Closing cash
 * Reconciled with General Ledger Cash & Bank accounts as of the report end date.
 */
export interface CashFlowStatementReport {
  startDate?: string;
  endDate?: string;
  openingCash: number;

  operating: {
    customerReceipts: number;
    customerReceiptsCount: number;
    supplierPayments: number;
    supplierPaymentsCount: number;
    operatingExpenses: number;
    operatingExpensesCount: number;
    otherOperatingReceipts: number;
    otherOperatingReceiptsCount: number;
    totalInflows: number;
    totalOutflows: number;
    netOperatingFlow: number;
  };

  investing: {
    assetPurchases: number;
    assetPurchasesCount: number;
    assetDisposalProceeds: number;
    assetDisposalProceedsCount: number;
    totalInflows: number;
    totalOutflows: number;
    netInvestingFlow: number;
  };

  financing: {
    ownerCapital: number;
    ownerCapitalCount: number;
    investorCapital: number;
    investorCapitalCount: number;
    loanProceeds: number;
    loanProceedsCount: number;
    investorProfitDistributions: number;
    investorProfitDistributionsCount: number;
    investorCapitalReturns: number;
    investorCapitalReturnsCount: number;
    loanRepayments: number;
    loanRepaymentsCount: number;
    ownerDrawings: number;
    ownerDrawingsCount: number;
    totalInflows: number;
    totalOutflows: number;
    netFinancingFlow: number;
  };

  totalCashIn: number;
  totalCashOut: number;
  netCashFlow: number;
  closingCash: number;

  // General Ledger Cash & Bank Reconciliation
  glOpeningCash: number;
  glClosingCash: number;
  isReconciled: boolean;
  reconciliationDiscrepancy: number;

  // Account level GL balances as of report end date
  accountsBreakdown: {
    id: string;
    code: string;
    nameBn: string;
    nameEn: string;
    accountType: string;
    openingBalance: number;
    periodInflows: number;
    periodOutflows: number;
    balance: number;
    closingBalance: number;
  }[];
}

export async function generateCashFlowStatement(
  dateRange?: DateRangeFilter | { fromDate?: string; toDate?: string; from?: string; to?: string; start?: string; end?: string; startDate?: string; endDate?: string; asOfDate?: string; date?: string } | string,
  customDb?: any
): Promise<CashFlowStatementReport> {
  const dbInstance = customDb || db;
  const rawAccounts = await dbInstance.accounts.toArray();
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  // Parse and normalize reporting date range
  let cleanStartDate: string | undefined = undefined;
  let cleanEndDate: string | undefined = undefined;

  if (typeof dateRange === 'string') {
    const trimmed = dateRange.trim();
    if (/^\d{4}$/.test(trimmed)) {
      cleanStartDate = `${trimmed}-01-01`;
      cleanEndDate = `${trimmed}-12-31`;
    } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
      cleanStartDate = `${trimmed}-01`;
      const [yStr, mStr] = trimmed.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      cleanEndDate = `${trimmed}-${String(lastDay).padStart(2, '0')}`;
    } else {
      const s = trimmed.split('T')[0].split(' ')[0].trim();
      cleanStartDate = s;
      cleanEndDate = s;
    }
  } else if (dateRange && typeof dateRange === 'object') {
    const rawStart = (dateRange as any).startDate || (dateRange as any).fromDate || (dateRange as any).from || (dateRange as any).start;
    const rawEnd = (dateRange as any).endDate || (dateRange as any).toDate || (dateRange as any).to || (dateRange as any).end || (dateRange as any).asOfDate || (dateRange as any).date;

    if (rawStart) {
      cleanStartDate = String(rawStart).trim().split('T')[0].split(' ')[0].trim();
    }
    if (rawEnd) {
      cleanEndDate = String(rawEnd).trim().split('T')[0].split(' ')[0].trim();
    }
  }

  // Helper to extract clean YYYY-MM-DD from an entry
  const getEntryDate = (e: any): string | null => {
    if (!e || !e.date) return null;
    return String(e.date).trim().split('T')[0].split(' ')[0].trim();
  };

  const isPrePeriod = (entryDate: string | null): boolean => {
    if (!entryDate || !cleanStartDate) return false;
    return entryDate < cleanStartDate;
  };

  const isThroughEndDate = (entryDate: string | null): boolean => {
    if (!entryDate) return false;
    if (!cleanEndDate) return true;
    return entryDate <= cleanEndDate;
  };

  const isInRange = (entryDate: string | null): boolean => {
    if (!entryDate) return false;
    if (cleanStartDate && entryDate < cleanStartDate) return false;
    if (cleanEndDate && entryDate > cleanEndDate) return false;
    return true;
  };

  // Identify all Cash and Bank GL account codes and IDs
  const cashAccountCodes = new Set<string>();
  const cashAccountIds = new Set<string>();

  for (const acc of accountsByCode.values()) {
    if (
      acc.code === '1010' ||
      acc.code === '1020' ||
      acc.code === '1030' ||
      acc.code.startsWith('101') ||
      acc.code.startsWith('102') ||
      acc.code.startsWith('103') ||
      (acc.accountClass === 'ASSET' &&
        (acc.nameEn?.toLowerCase().includes('cash') ||
          acc.nameEn?.toLowerCase().includes('bank') ||
          acc.nameBn?.includes('নগদ') ||
          acc.nameBn?.includes('ব্যাংক')))
    ) {
      cashAccountCodes.add(acc.code);
      if (acc.id) cashAccountIds.add(acc.id);
    }
  }
  cashAccountCodes.add('1010');
  cashAccountCodes.add('1020');
  cashAccountCodes.add('1030');

  // Also include any accounts from dbInstance.cashBankAccounts if present
  if (dbInstance.cashBankAccounts?.toArray) {
    try {
      const cbAccs = await dbInstance.cashBankAccounts.toArray();
      for (const cb of cbAccs) {
        if (cb.code) cashAccountCodes.add(String(cb.code).trim());
        if (cb.accountId) {
          cashAccountIds.add(String(cb.accountId).trim());
          const acc = rawAccounts.find((a: any) => a.id === cb.accountId || a.code === cb.accountId);
          if (acc?.code) cashAccountCodes.add(String(acc.code).trim());
        }
      }
    } catch {
      // ignore
    }
  }

  const isCashLine = (l: any): boolean => {
    if (!l) return false;
    const code = l.accountCode ? String(l.accountCode).trim() : '';
    const id = l.accountId ? String(l.accountId).trim() : '';
    return (code !== '' && cashAccountCodes.has(code)) ||
           (id !== '' && (cashAccountCodes.has(id) || cashAccountIds.has(id)));
  };

  const getCashLineCode = (l: any): string => {
    const code = l.accountCode ? String(l.accountCode).trim() : '';
    if (code && cashAccountCodes.has(code)) return code;
    const id = l.accountId ? String(l.accountId).trim() : '';
    if (id && cashAccountCodes.has(id)) return id;
    for (const [c, acc] of accountsByCode.entries()) {
      if (acc.id === id) return c;
    }
    return code || '1010';
  };

  let allEntries = await dbInstance.journalEntries.toArray();
  allEntries = allEntries.filter((e: any) => e && Array.isArray(e.lines));

  // 1. Calculate GL Opening Cash as of day before startDate (or 0 if no startDate)
  let glOpeningCash = 0;
  const accountOpeningBalances: Record<string, number> = {};
  for (const code of cashAccountCodes) {
    accountOpeningBalances[code] = 0;
  }

  if (cleanStartDate) {
    for (const e of allEntries) {
      const d = getEntryDate(e);
      if (isPrePeriod(d)) {
        for (const l of e.lines) {
          if (isCashLine(l)) {
            const c = getCashLineCode(l);
            const dr = Number(l.debit || 0);
            const cr = Number(l.credit || 0);
            accountOpeningBalances[c] = (accountOpeningBalances[c] || 0) + (dr - cr);
            glOpeningCash += (dr - cr);
          }
        }
      }
    }
  }
  glOpeningCash = Math.round(glOpeningCash * 100) / 100;
  const openingCash = glOpeningCash;

  // 2. Calculate GL Closing Cash as of report endDate
  let glClosingCash = 0;
  const accountClosingBalances: Record<string, number> = {};
  const accountPeriodInflows: Record<string, number> = {};
  const accountPeriodOutflows: Record<string, number> = {};
  for (const code of cashAccountCodes) {
    accountClosingBalances[code] = 0;
    accountPeriodInflows[code] = 0;
    accountPeriodOutflows[code] = 0;
  }

  for (const e of allEntries) {
    const d = getEntryDate(e);
    if (isThroughEndDate(d)) {
      for (const l of e.lines) {
        if (isCashLine(l)) {
          const c = getCashLineCode(l);
          const dr = Number(l.debit || 0);
          const cr = Number(l.credit || 0);
          accountClosingBalances[c] = (accountClosingBalances[c] || 0) + (dr - cr);
          glClosingCash += (dr - cr);
        }
      }
    }
  }
  glClosingCash = Math.round(glClosingCash * 100) / 100;

  // 3. Filter entries strictly within the selected date range
  const inRangeEntries = allEntries.filter((e: any) => {
    const d = getEntryDate(e);
    return isInRange(d);
  });

  // Track in-period cash inflows and outflows per account
  for (const e of inRangeEntries) {
    for (const l of e.lines) {
      if (isCashLine(l)) {
        const c = getCashLineCode(l);
        const dr = Number(l.debit || 0);
        const cr = Number(l.credit || 0);
        if (dr > 0) accountPeriodInflows[c] = (accountPeriodInflows[c] || 0) + dr;
        if (cr > 0) accountPeriodOutflows[c] = (accountPeriodOutflows[c] || 0) + cr;
      }
    }
  }

  // Activity accumulators
  let customerReceipts = 0;
  let customerReceiptsCount = 0;
  let otherOperatingReceipts = 0;
  let otherOperatingReceiptsCount = 0;
  let supplierPayments = 0;
  let supplierPaymentsCount = 0;
  let operatingExpenses = 0;
  let operatingExpensesCount = 0;

  let assetPurchases = 0;
  let assetPurchasesCount = 0;
  let assetDisposalProceeds = 0;
  let assetDisposalProceedsCount = 0;

  let ownerCapital = 0;
  let ownerCapitalCount = 0;
  let investorCapital = 0;
  let investorCapitalCount = 0;
  let loanProceeds = 0;
  let loanProceedsCount = 0;
  let investorProfitDistributions = 0;
  let investorProfitDistributionsCount = 0;
  let investorCapitalReturns = 0;
  let investorCapitalReturnsCount = 0;
  let loanRepayments = 0;
  let loanRepaymentsCount = 0;
  let ownerDrawings = 0;
  let ownerDrawingsCount = 0;

  // Process each in-range journal entry exactly once
  for (const e of inRangeEntries) {
    const cashLines = e.lines.filter((l: any) => isCashLine(l));
    if (cashLines.length === 0) {
      continue; // Non-cash transaction
    }

    const totalCashDr = cashLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
    const totalCashCr = cashLines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
    const netCashEffect = Math.round((totalCashDr - totalCashCr) * 100) / 100;

    if (netCashEffect === 0) {
      continue; // Pure contra transfer between cash & cash equivalents; net cash impact is 0
    }

    const nonCashLines = e.lines.filter((l: any) => !isCashLine(l));

    if (netCashEffect > 0) {
      // CASH INFLOW
      const inflowAmount = netCashEffect;

      // Classify Financing Inflows
      if (
        nonCashLines.some((l: any) => l.accountCode === '3010' && Number(l.credit || 0) > 0) ||
        e.voucherNumber?.startsWith('CAP-') ||
        e.narration?.includes('মালিকের মূলধন')
      ) {
        ownerCapital += inflowAmount;
        ownerCapitalCount++;
      } else if (
        nonCashLines.some((l: any) => l.accountCode === '3020' && Number(l.credit || 0) > 0) ||
        e.voucherNumber?.startsWith('INV-CAP-') ||
        e.voucherNumber?.startsWith('ICAP-') ||
        e.narration?.includes('বিনিয়োগকারীর মূলধন') ||
        e.narration?.includes('Investor capital')
      ) {
        investorCapital += inflowAmount;
        investorCapitalCount++;
      } else if (
        nonCashLines.some(
          (l: any) => (l.accountCode === '2110' || l.accountCode === '2120' || l.accountCode?.startsWith('21')) && Number(l.credit || 0) > 0
        ) ||
        e.voucherNumber?.startsWith('LN-') ||
        e.narration?.includes('গৃহীত ঋণ') ||
        e.narration?.includes('Loan disbursement')
      ) {
        loanProceeds += inflowAmount;
        loanProceedsCount++;
      } else if (
        // Classify Investing Inflow: Asset Disposal
        e.voucherType === 'DISPOSAL' ||
        e.voucherNumber?.startsWith('DISP-') ||
        e.narration?.includes('স্থায়ী সম্পদ বিক্রয়লব্ধ') ||
        e.narration?.includes('Asset disposal') ||
        nonCashLines.some(
          (l: any) =>
            l.accountCode === '7020' ||
            l.accountCode === '1590' ||
            (l.accountCode?.startsWith('15') && Number(l.credit || 0) > 0)
        )
      ) {
        assetDisposalProceeds += inflowAmount;
        assetDisposalProceedsCount++;
      } else if (
        // Classify Operating Inflow: Customer Receipts
        e.voucherType === 'SALE' ||
        e.voucherType === 'RECEIPT' ||
        e.voucherNumber?.startsWith('SL-') ||
        e.voucherNumber?.startsWith('INV-') ||
        e.voucherNumber?.startsWith('RV-') ||
        e.reference?.startsWith('sal_') ||
        nonCashLines.some(
          (l: any) =>
            l.accountCode === '1040' ||
            l.accountCode === '2040' ||
            l.accountCode?.startsWith('4')
        )
      ) {
        customerReceipts += inflowAmount;
        customerReceiptsCount++;
      } else {
        // Other operating receipts
        otherOperatingReceipts += inflowAmount;
        otherOperatingReceiptsCount++;
      }
    } else {
      // CASH OUTFLOW
      const outflowAmount = Math.abs(netCashEffect);

      // Classify Financing Outflows
      if (
        nonCashLines.some((l: any) => l.accountCode === '3040' && Number(l.debit || 0) > 0) ||
        e.voucherNumber?.startsWith('DRW-') ||
        e.narration?.includes('উত্তোলন') ||
        e.narration?.includes('Drawing')
      ) {
        ownerDrawings += outflowAmount;
        ownerDrawingsCount++;
      } else if (
        nonCashLines.some((l: any) => l.accountCode === '3020' && Number(l.debit || 0) > 0) ||
        e.voucherNumber?.startsWith('ICR-') ||
        e.narration?.includes('মূলধন ফেরত') ||
        e.narration?.includes('Capital return')
      ) {
        investorCapitalReturns += outflowAmount;
        investorCapitalReturnsCount++;
      } else if (
        nonCashLines.some((l: any) => l.accountCode === '2050' && Number(l.debit || 0) > 0) ||
        e.voucherNumber?.startsWith('IPAY-') ||
        e.voucherNumber?.startsWith('INV-PAY-') ||
        e.narration?.includes('লভ্যাংশ প্রদান') ||
        e.narration?.includes('Profit payment')
      ) {
        investorProfitDistributions += outflowAmount;
        investorProfitDistributionsCount++;
      } else if (
        e.voucherNumber?.startsWith('LRP-') ||
        e.narration?.includes('ঋণ পরিশোধ') ||
        e.narration?.includes('Loan repayment') ||
        nonCashLines.some(
          (l: any) => (l.accountCode === '2110' || l.accountCode === '2120' || l.accountCode?.startsWith('21')) && Number(l.debit || 0) > 0
        )
      ) {
        loanRepayments += outflowAmount;
        loanRepaymentsCount++;
      } else if (
        // Classify Investing Outflow: Fixed Asset Purchases
        e.reference?.startsWith('ast_') ||
        e.voucherNumber?.startsWith('AST-') ||
        e.narration?.includes('স্থায়ী সম্পদ ক্রয়') ||
        e.narration?.includes('Fixed asset purchase') ||
        nonCashLines.some((l: any) => l.accountCode?.startsWith('15') && l.accountCode !== '1590' && Number(l.debit || 0) > 0)
      ) {
        assetPurchases += outflowAmount;
        assetPurchasesCount++;
      } else if (
        // Classify Operating Outflow: Supplier Payments
        e.voucherType === 'PURCHASE' ||
        e.voucherNumber?.startsWith('PUR-') ||
        e.voucherNumber?.startsWith('PV-') ||
        e.reference?.startsWith('pur_') ||
        nonCashLines.some((l: any) => l.accountCode === '2010' || l.accountCode?.startsWith('105'))
      ) {
        supplierPayments += outflowAmount;
        supplierPaymentsCount++;
      } else {
        // Classify Operating Outflow: Operating Expenses & overhead
        operatingExpenses += outflowAmount;
        operatingExpensesCount++;
      }
    }
  }

  // Calculate totals and net flows
  const totalOperatingInflows = Math.round((customerReceipts + otherOperatingReceipts) * 100) / 100;
  const totalOperatingOutflows = Math.round((supplierPayments + operatingExpenses) * 100) / 100;
  const netOperatingFlow = Math.round((totalOperatingInflows - totalOperatingOutflows) * 100) / 100;

  const totalInvestingInflows = Math.round(assetDisposalProceeds * 100) / 100;
  const totalInvestingOutflows = Math.round(assetPurchases * 100) / 100;
  const netInvestingFlow = Math.round((totalInvestingInflows - totalInvestingOutflows) * 100) / 100;

  const totalFinancingInflows = Math.round((ownerCapital + investorCapital + loanProceeds) * 100) / 100;
  const totalFinancingOutflows =
    Math.round((investorProfitDistributions + investorCapitalReturns + loanRepayments + ownerDrawings) * 100) / 100;
  const netFinancingFlow = Math.round((totalFinancingInflows - totalFinancingOutflows) * 100) / 100;

  const totalCashIn = Math.round((totalOperatingInflows + totalInvestingInflows + totalFinancingInflows) * 100) / 100;
  const totalCashOut = Math.round((totalOperatingOutflows + totalInvestingOutflows + totalFinancingOutflows) * 100) / 100;
  const netCashFlow = Math.round((netOperatingFlow + netInvestingFlow + netFinancingFlow) * 100) / 100;

  const closingCash = Math.round((openingCash + netCashFlow) * 100) / 100;
  const reconciliationDiscrepancy = Math.round((closingCash - glClosingCash) * 100) / 100;
  const isReconciled = Math.abs(reconciliationDiscrepancy) < 0.001;

  // Build account-level breakdown as of report end date
  const accountsBreakdown = Array.from(cashAccountCodes)
    .map((code) => {
      const acc = accountsByCode.get(code);
      const op = Math.round((accountOpeningBalances[code] || 0) * 100) / 100;
      const inf = Math.round((accountPeriodInflows[code] || 0) * 100) / 100;
      const outf = Math.round((accountPeriodOutflows[code] || 0) * 100) / 100;
      const cl = Math.round((accountClosingBalances[code] || 0) * 100) / 100;
      return {
        id: acc?.id || `acc_${code}`,
        code,
        nameBn:
          acc?.nameBn ||
          (code === '1010'
            ? 'নগদ তহবিল (হাতে নগদ)'
            : code === '1020'
            ? 'পেটি ক্যাশ (খুচরা খরচ)'
            : 'ব্যাংক হিসাব (চলতি/সঞ্চয়ী)'),
        nameEn:
          acc?.nameEn ||
          (code === '1010' ? 'Cash on Hand' : code === '1020' ? 'Petty Cash' : 'Bank Accounts'),
        accountType: code === '1030' ? 'BANK' : 'CASH',
        openingBalance: op,
        periodInflows: inf,
        periodOutflows: outf,
        balance: cl,
        closingBalance: cl
      };
    })
    .filter(
      (a) =>
        a.openingBalance !== 0 ||
        a.periodInflows !== 0 ||
        a.periodOutflows !== 0 ||
        a.closingBalance !== 0 ||
        a.code === '1010' ||
        a.code === '1030'
    );

  return {
    startDate: (dateRange as any)?.startDate ?? cleanStartDate,
    endDate: (dateRange as any)?.endDate ?? cleanEndDate,
    openingCash,
    operating: {
      customerReceipts: Math.round(customerReceipts * 100) / 100,
      customerReceiptsCount,
      supplierPayments: Math.round(supplierPayments * 100) / 100,
      supplierPaymentsCount,
      operatingExpenses: Math.round(operatingExpenses * 100) / 100,
      operatingExpensesCount,
      otherOperatingReceipts: Math.round(otherOperatingReceipts * 100) / 100,
      otherOperatingReceiptsCount,
      totalInflows: totalOperatingInflows,
      totalOutflows: totalOperatingOutflows,
      netOperatingFlow
    },
    investing: {
      assetPurchases: Math.round(assetPurchases * 100) / 100,
      assetPurchasesCount,
      assetDisposalProceeds: Math.round(assetDisposalProceeds * 100) / 100,
      assetDisposalProceedsCount,
      totalInflows: totalInvestingInflows,
      totalOutflows: totalInvestingOutflows,
      netInvestingFlow
    },
    financing: {
      ownerCapital: Math.round(ownerCapital * 100) / 100,
      ownerCapitalCount,
      investorCapital: Math.round(investorCapital * 100) / 100,
      investorCapitalCount,
      loanProceeds: Math.round(loanProceeds * 100) / 100,
      loanProceedsCount,
      investorProfitDistributions: Math.round(investorProfitDistributions * 100) / 100,
      investorProfitDistributionsCount,
      investorCapitalReturns: Math.round(investorCapitalReturns * 100) / 100,
      investorCapitalReturnsCount,
      loanRepayments: Math.round(loanRepayments * 100) / 100,
      loanRepaymentsCount,
      ownerDrawings: Math.round(ownerDrawings * 100) / 100,
      ownerDrawingsCount,
      totalInflows: totalFinancingInflows,
      totalOutflows: totalFinancingOutflows,
      netFinancingFlow
    },
    totalCashIn,
    totalCashOut,
    netCashFlow,
    closingCash,
    glOpeningCash,
    glClosingCash,
    isReconciled,
    reconciliationDiscrepancy,
    accountsBreakdown
  };
}
