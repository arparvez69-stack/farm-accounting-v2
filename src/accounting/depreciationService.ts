import { db } from '../db/indexedDb';
import { getDepreciationAccounts, CANONICAL_ACCOUNTS } from './accountMapping';
import { postJournalEntry } from './accountingEngine';
import { JournalLine, FixedAsset, JournalEntry } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

export interface DepreciationRunResult {
  assetsProcessed: number;
  entriesPosted: number;
  totalDepreciationAmount: number;
  details: {
    assetId: string;
    assetName: string;
    monthsPosted: number;
    amount: number;
    lastDepreciationDate: string;
  }[];
}

export interface AssetDepreciationAtomicResult {
  assetId: string;
  assetName: string;
  monthsPosted: number;
  totalDepreciation: number;
  newAccumulatedDepreciation: number;
  newBookValue: number;
  lastDepreciationDate: string;
  journalEntryIds: string[];
}

export interface FixedAssetAcquisitionParams {
  assetId?: string;
  name: string;
  category: 'LAND' | 'BUILDINGS' | 'BUILDING' | 'PONDS' | 'POND' | 'MACHINERY' | 'EQUIPMENT' | 'VEHICLES' | 'VEHICLE' | string;
  purchaseDate?: string;
  originalCost: number;
  usefulLifeYears?: number;
  salvageValue?: number;
  depreciationRatePercent?: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  supplierId?: string;
  notes?: string;
  photoUrl?: string;
  currentUserId?: string;
}

export interface FixedAssetAcquisitionResult {
  asset: FixedAsset;
  journalEntry: JournalEntry;
  journalEntryId: string;
  voucherNumber: string;
  auditLogId: string;
}

export interface FixedAssetDisposalParams {
  assetId: string;
  disposalDate?: string;
  disposalProceeds?: number;
  paymentMethod?: 'CASH' | 'BANK';
  bankAccountId?: string;
  disposalReason?: string;
  currentUserId?: string;
}

export interface FixedAssetDisposalResult {
  asset: FixedAsset;
  journalEntryId: string;
  voucherNumber: string;
  carryingValue: number;
  disposalProceeds: number;
  gainLoss: number;
}

let activeDepreciationPromise: Promise<DepreciationRunResult> | null = null;
let hasRunOnAppLoad = false;

/**
 * Returns canonical GL account code for asset category.
 */
export function getAssetGLCode(category: string): string {
  switch (category) {
    case 'LAND':
      return CANONICAL_ACCOUNTS.LAND || '1510';
    case 'BUILDINGS':
    case 'BUILDING':
      return CANONICAL_ACCOUNTS.BUILDINGS || '1520';
    case 'PONDS':
    case 'POND':
      return CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE || '1530';
    case 'MACHINERY':
    case 'EQUIPMENT':
    case 'VEHICLES':
    case 'VEHICLE':
    default:
      return CANONICAL_ACCOUNTS.MACHINERY || '1550';
  }
}

/**
 * Returns canonical GL account code and name for asset category.
 */
export function getAssetAccountInfo(category: string): { code: string; name: string } {
  switch (category) {
    case 'LAND':
      return { code: CANONICAL_ACCOUNTS.LAND || '1510', name: 'জমি ও প্লট (Land & Plots)' };
    case 'BUILDINGS':
    case 'BUILDING':
      return { code: CANONICAL_ACCOUNTS.BUILDINGS || '1520', name: 'শেড ও ভবন (Sheds & Buildings)' };
    case 'PONDS':
    case 'POND':
      return { code: CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE || '1530', name: 'পুকুর অবকাঠামো (Pond Infrastructure)' };
    case 'MACHINERY':
    case 'EQUIPMENT':
    case 'VEHICLES':
    case 'VEHICLE':
    default:
      return { code: CANONICAL_ACCOUNTS.MACHINERY || '1550', name: 'যন্ত্রপাতি ও সরঞ্জাম (Machinery & Equipment)' };
  }
}

/**
 * TASK 12: Atomic Fixed Asset Acquisition Transaction
 *
 * Guarantees that the following succeed or fail together in a single Dexie transaction:
 * 1. Journal entry (Dr Asset GL, Cr Cash/Bank/AP)
 * 2. Cash/Bank account balance deduction or Supplier AP balance increase
 * 3. Fixed Asset register record with journalEntryId reference
 * 4. Audit record tracking acquisition
 *
 * Rollback occurs if any operation fails. Never leaves GL without Asset record or Asset record without GL.
 */
export async function executeFixedAssetAcquisitionTransaction(
  params: FixedAssetAcquisitionParams,
  dbInstance: any = db
): Promise<FixedAssetAcquisitionResult> {
  const runInTx = async (): Promise<FixedAssetAcquisitionResult> => {
    // 1. Validate inputs
    if (!params.name || !params.name.trim()) {
      throw new Error('স্থায়ী সম্পদের নাম প্রদান করা বাধ্যতামূলক (Asset name is required).');
    }

    const cost = Number(params.originalCost);
    if (isNaN(cost) || cost <= 0) {
      throw new Error('সম্পদের ক্রয়মূল্য অবশ্যই শূন্যের বেশি হতে হবে (Asset acquisition cost must be greater than zero).');
    }

    const inputLife = Number(params.usefulLifeYears !== undefined ? params.usefulLifeYears : 5);
    if (isNaN(inputLife) || inputLife < 0) {
      throw new Error('সম্পদের আয়ুষ্কাল সঠিক নয় (Useful life years must be non-negative).');
    }

    const salvage = Number(params.salvageValue || 0);
    if (isNaN(salvage) || salvage < 0 || salvage >= cost) {
      throw new Error('ভগ্নাংশ মূল্য (Salvage value) ক্রয়মূল্যের চেয়ে কম হতে হবে (Salvage value must be non-negative and less than original cost).');
    }

    const deprParams = calculateAssetDepreciationParameters(
      cost,
      salvage,
      inputLife,
      params.depreciationRatePercent !== undefined ? Number(params.depreciationRatePercent) : undefined
    );
    const life = deprParams.usefulLifeYears;
    const rate = deprParams.depreciationRatePercent;

    const purchaseDate = params.purchaseDate || new Date().toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    if (purchaseDate > todayStr) {
      throw new Error(`সম্পদ ক্রয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা পূর্বের তারিখ নির্বাচন করুন)।`);
    }

    const normCat = params.category === 'BUILDING' ? 'BUILDINGS' : (params.category || 'MACHINERY');
    const method = params.paymentMethod;
    if (!['CASH', 'BANK', 'CREDIT'].includes(method)) {
      throw new Error(`অবৈধ পরিশোধ মাধ্যম: "${method}" (Payment method must be CASH, BANK, or CREDIT).`);
    }

    let paymentCode: string = CANONICAL_ACCOUNTS.CASH || '1010';
    let paymentAccountName = 'নগদ টাকা (Cash on Hand)';
    let effectiveBankId: string | undefined = undefined;
    let effectiveSupplierId: string | undefined = undefined;
    let bAcc: any = null;
    let sParty: any = null;

    if (method === 'BANK') {
      paymentCode = CANONICAL_ACCOUNTS.BANK || '1030';
      effectiveBankId = params.bankAccountId;
      if (!effectiveBankId) {
        throw new Error('ব্যাংক পরিশোধের ক্ষেত্রে ব্যাংক হিসাব নির্বাচন করা বাধ্যতামূলক (Bank account is required).');
      }
      bAcc = await dbInstance.cashBankAccounts.get(effectiveBankId);
      if (!bAcc) {
        throw new Error(`নির্বাচিত ব্যাংক হিসাব (ID: ${effectiveBankId}) খুঁজে পাওয়া যায়নি।`);
      }
      paymentAccountName = `ব্যাংক হিসাব (${bAcc.name || 'Bank Accounts'})`;
    } else if (method === 'CREDIT') {
      paymentCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE || '2010';
      effectiveSupplierId = params.supplierId;
      if (!effectiveSupplierId) {
        throw new Error('বাকিতে সম্পদ ক্রয়ের ক্ষেত্রে সরবরাহকারী নির্বাচন করা বাধ্যতামূলক (Supplier is required).');
      }
      sParty = await dbInstance.parties.get(effectiveSupplierId);
      if (!sParty) {
        throw new Error(`নির্বাচিত সরবরাহকারী (ID: ${effectiveSupplierId}) খুঁজে পাওয়া যায়নি।`);
      }
      paymentAccountName = `সরবরাহকারীর দেনা (${sParty.name || 'Accounts Payable'})`;
    }

    const assetAcc = getAssetAccountInfo(normCat);
    const assetId = params.assetId || generateTransactionNumber('AST');

    // 2. Balanced Journal Lines
    const lines: JournalLine[] = [
      {
        accountId: assetAcc.code,
        accountCode: assetAcc.code,
        accountName: assetAcc.name,
        debit: cost,
        credit: 0,
        memo: `স্থায়ী সম্পদ ক্রয়: ${params.name.trim()}`
      },
      {
        accountId: paymentCode,
        accountCode: paymentCode,
        accountName: paymentAccountName,
        debit: 0,
        credit: cost,
        memo:
          method === 'CASH'
            ? 'সম্পদ ক্রয়ে নগদ পরিশোধ'
            : method === 'BANK'
            ? 'সম্পদ ক্রয়ে ব্যাংক পরিশোধ'
            : 'সম্পদ ক্রয়ে সরবরাহকারীর নিকট দেনা'
      }
    ];

    const voucherNumber = generateTransactionNumber(method === 'CREDIT' ? 'JV' : 'PAY');
    const jEntryId = generateUniqueId('j_ast');
    const accounts = await dbInstance.accounts.toArray();

    const journalEntry = await postJournalEntry(
      {
        id: jEntryId,
        voucherNumber,
        voucherType: method === 'CREDIT' ? 'JOURNAL' : 'PAYMENT',
        date: purchaseDate,
        narration: `স্থায়ী সম্পদ ক্রয়: ${params.name.trim()} (${assetAcc.name}), ক্রয়মূল্য: ৳${cost}`,
        reference: assetId,
        lines,
        createdBy: params.currentUserId || 'SYSTEM',
        createdAt: new Date().toISOString()
      },
      { accounts, skipDbPut: true }
    );

    await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

    // 3. Operational Cash/Bank or Supplier AP Subledger update
    if (method === 'CASH') {
      const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
      if (cashAcc) {
        await dbInstance.cashBankAccounts.update(cashAcc.id, {
          currentBalance: Math.round((cashAcc.currentBalance - cost) * 100) / 100,
          synced: false
        });
      }
    } else if (method === 'BANK' && effectiveBankId) {
      await dbInstance.cashBankAccounts.update(effectiveBankId, {
        currentBalance: Math.round((bAcc.currentBalance - cost) * 100) / 100,
        synced: false
      });
    } else if (method === 'CREDIT' && effectiveSupplierId) {
      await dbInstance.parties.update(effectiveSupplierId, {
        balance: Math.round(((sParty.balance || 0) + cost) * 100) / 100,
        synced: false
      });
    }

    // 4. Fixed Asset Register Record
    const newAsset: FixedAsset = {
      id: assetId,
      name: params.name.trim(),
      category: normCat as any,
      purchaseDate,
      originalCost: cost,
      salvageValue: salvage,
      usefulLifeYears: life,
      accumulatedDepreciation: 0,
      currentBookValue: cost,
      depreciationRatePercent: rate,
      lastDepreciationDate: purchaseDate,
      status: 'ACTIVE',
      journalEntryId: journalEntry.id,
      paymentMethod: method,
      bankAccountId: effectiveBankId,
      supplierId: effectiveSupplierId,
      ...(params.notes ? { notes: params.notes } : {}),
      ...(params.photoUrl ? { photoUrl: params.photoUrl } : {}),
      synced: false
    };

    await safeInsert(dbInstance.fixedAssets, newAsset, { idPrefix: 'ast' });

    // 5. Audit Log Entry
    const auditLogId = generateUniqueId('aud_ast_acq');
    const auditRecord = {
      id: auditLogId,
      timestamp: new Date().toISOString(),
      userId: params.currentUserId || 'SYSTEM',
      role: 'OWNER',
      action: 'CREATE',
      module: 'ASSETS',
      recordId: newAsset.id,
      status: 'SUCCESS',
      details: JSON.stringify({
        action: 'ASSET_ACQUISITION',
        assetId: newAsset.id,
        name: newAsset.name,
        category: newAsset.category,
        cost,
        paymentMethod: method,
        voucherNumber,
        journalEntryId: journalEntry.id,
        bankAccountId: effectiveBankId,
        supplierId: effectiveSupplierId
      }),
      synced: false
    };

    if (dbInstance.auditLogs) {
      await safeInsert(dbInstance.auditLogs, auditRecord, { idPrefix: 'aud' });
    }

    return {
      asset: newAsset,
      journalEntry,
      journalEntryId: journalEntry.id,
      voucherNumber,
      auditLogId
    };
  };

  const tablesToLock = [
    dbInstance.fixedAssets,
    dbInstance.journalEntries,
    dbInstance.cashBankAccounts,
    dbInstance.parties,
    dbInstance.accounts,
    dbInstance.auditLogs,
    dbInstance.closedPeriods
  ].filter(Boolean);

  if (dbInstance.transaction) {
    return await dbInstance.transaction('rw', tablesToLock, runInTx);
  } else {
    return await runInTx();
  }
}

/**
 * Calculates the exact next calendar day YYYY-MM-DD after the given YYYY-MM-DD date.
 */
export function getNextDay(dateStr: string): string {
  if (!dateStr || !dateStr.includes('-')) {
    return dateStr;
  }
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

/**
 * Calculates straight-line depreciation parameters consistently:
 * 1. Useful life and depreciation rate must not contradict each other.
 * 2. Derives annual/monthly depreciation consistently from:
 *    - original cost
 *    - salvage value
 *    - useful life
 * 3. Never allows a contradictory rate (e.g., 5-year life with 10% rate).
 */
export interface AssetDepreciationParameters {
  originalCost: number;
  salvageValue: number;
  depreciableBase: number;
  usefulLifeYears: number;
  depreciationRatePercent: number;
  annualDepreciation: number;
  monthlyDepreciation: number;
}

export function calculateAssetDepreciationParameters(
  costInput: number,
  salvageInput?: number,
  lifeInput?: number,
  rateInput?: number
): AssetDepreciationParameters {
  const originalCost = Math.max(0, Number(costInput || 0));
  const salvageValue = Math.max(0, Number(salvageInput || 0));
  const depreciableBase = Math.max(0, Math.round((originalCost - salvageValue) * 100) / 100);

  let usefulLifeYears = Number(lifeInput || 0);
  let depreciationRatePercent = Number(rateInput || 0);

  // 1 & 3: Useful life and depreciation rate must not contradict each other.
  // Straight-line: usefulLifeYears * depreciationRatePercent = 100%
  if (usefulLifeYears > 0) {
    const derivedRate = Number((100 / usefulLifeYears).toFixed(2));
    // If rate is missing, 0, or contradicts useful life, useful life strictly governs straight-line depreciation
    if (depreciationRatePercent <= 0 || Math.abs(depreciationRatePercent - derivedRate) > 0.05) {
      depreciationRatePercent = derivedRate;
    }
  } else if (depreciationRatePercent > 0) {
    usefulLifeYears = Number((100 / depreciationRatePercent).toFixed(2));
  } else {
    // Default fallback if neither provided
    usefulLifeYears = 5;
    depreciationRatePercent = 20;
  }

  // 2: For straight-line depreciation, derive annual & monthly depreciation consistently from:
  // (originalCost - salvageValue) / usefulLifeYears
  const annualDepreciation = usefulLifeYears > 0
    ? Math.round((depreciableBase / usefulLifeYears) * 100) / 100
    : 0;

  const monthlyDepreciation = usefulLifeYears > 0
    ? Math.round((depreciableBase / (usefulLifeYears * 12)) * 100) / 100
    : 0;

  return {
    originalCost,
    salvageValue,
    depreciableBase,
    usefulLifeYears,
    depreciationRatePercent,
    annualDepreciation,
    monthlyDepreciation
  };
}

/**
 * Calculates the exact date 1 calendar month after the given YYYY-MM-DD date.
 * Accurately caps days to the target month's maximum days (e.g. Jan 31 -> Feb 28/29).
 */
export function getNextMonthDate(dateStr: string): string {
  if (!dateStr || !dateStr.includes('-')) {
    return dateStr;
  }
  const parts = dateStr.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];

  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const daysInNextMonth = new Date(nextY, nextM, 0).getDate();
  const nextD = Math.min(d, daysInNextMonth);

  return `${nextY.toString().padStart(4, '0')}-${nextM.toString().padStart(2, '0')}-${nextD.toString().padStart(2, '0')}`;
}

/**
 * Executes depreciation for a single asset atomically inside a Dexie transaction:
 * 1. Useful life and depreciation rate do not contradict each other.
 * 2. Straight-line depreciation derived consistently from: cost, salvage value, useful life.
 * 3. Does not depreciate below salvage value.
 * 4. Checks duplicate-period protection so retrying does NOT duplicate depreciation.
 * 5. Respects closed accounting periods without permanently or silently skipping depreciation.
 * 6. Ensures journal entries and asset register update succeed together.
 * 7. Any failure automatically rolls back both.
 */
export async function executeAssetDepreciationAtomic(
  assetId: string,
  options?: {
    currentUserId?: string;
    targetDate?: string;
  },
  dbInstance: any = db
): Promise<AssetDepreciationAtomicResult> {
  const runInTx = async (): Promise<AssetDepreciationAtomicResult> => {
    // 1. Fetch fresh asset inside transaction
    const asset = await dbInstance.fixedAssets.get(assetId);
    if (!asset) {
      throw new Error(`Fixed asset with ID "${assetId}" not found.`);
    }

    if (asset.status === 'DISPOSED') {
      return {
        assetId: asset.id,
        assetName: asset.name,
        monthsPosted: 0,
        totalDepreciation: 0,
        newAccumulatedDepreciation: Number(asset.accumulatedDepreciation || 0),
        newBookValue: Number(asset.currentBookValue || 0),
        lastDepreciationDate: asset.lastDepreciationDate || asset.purchaseDate || '',
        journalEntryIds: []
      };
    }

    // Derive depreciation parameters consistently
    const deprParams = calculateAssetDepreciationParameters(
      asset.originalCost,
      asset.salvageValue,
      asset.usefulLifeYears,
      asset.depreciationRatePercent
    );

    const cost = deprParams.originalCost;
    const salvage = deprParams.salvageValue;
    const maxDepreciableTotal = deprParams.depreciableBase;
    const monthlyDepr = deprParams.monthlyDepreciation;

    if (cost <= 0 || maxDepreciableTotal <= 0 || monthlyDepr <= 0) {
      return {
        assetId: asset.id,
        assetName: asset.name,
        monthsPosted: 0,
        totalDepreciation: 0,
        newAccumulatedDepreciation: Number(asset.accumulatedDepreciation || 0),
        newBookValue: Math.max(salvage, Number(asset.currentBookValue || cost)),
        lastDepreciationDate: asset.lastDepreciationDate || asset.purchaseDate || '',
        journalEntryIds: []
      };
    }

    let currentAccumulated = Math.max(0, Number(asset.accumulatedDepreciation || 0));

    // Boundary check: do not depreciate below salvage value
    if (currentAccumulated >= maxDepreciableTotal) {
      return {
        assetId: asset.id,
        assetName: asset.name,
        monthsPosted: 0,
        totalDepreciation: 0,
        newAccumulatedDepreciation: currentAccumulated,
        newBookValue: salvage,
        lastDepreciationDate: asset.lastDepreciationDate || asset.purchaseDate || '',
        journalEntryIds: []
      };
    }

    const accounts = await dbInstance.accounts.toArray();
    const deprAccounts = getDepreciationAccounts();

    const expenseAcc = accounts.find((a: any) => a.code === deprAccounts.expenseCode) || {
      id: 'acc_6140',
      code: '6140',
      nameBn: 'অবচয় খরচ (Depreciation Expense)'
    };
    if (!accounts.some((a: any) => a.code === expenseAcc.code)) {
      accounts.push(expenseAcc);
    }

    const accumAcc = accounts.find((a: any) => a.code === deprAccounts.accumulatedCode) || {
      id: 'acc_1590',
      code: '1590',
      nameBn: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation)'
    };
    if (!accounts.some((a: any) => a.code === accumAcc.code)) {
      accounts.push(accumAcc);
    }

    // Check closed periods to respect closed periods
    let latestClosedDate = '';
    if (dbInstance.closedPeriods) {
      const closedPeriods = await dbInstance.closedPeriods.orderBy('endDate').reverse().toArray();
      if (closedPeriods && closedPeriods.length > 0 && closedPeriods[0].endDate) {
        latestClosedDate = closedPeriods[0].endDate;
      }
    }

    const todayStr = options?.targetDate || new Date().toISOString().split('T')[0];

    // Respect closed periods: If targetDate itself is in a closed period, block posting into closed period
    if (latestClosedDate && todayStr <= latestClosedDate) {
      throw new Error(
        `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosedDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে অবচয় পোস্ট করা যাবে না (Cannot post depreciation into closed period ending: ${latestClosedDate}).`
      );
    }

    let cursorDate = asset.lastDepreciationDate || asset.purchaseDate || todayStr;
    let monthsPostedForAsset = 0;
    let totalAssetDepr = 0;
    const postedEntryIds: string[] = [];

    // Load existing journal entries for duplicate-period protection
    const allEntries = await dbInstance.journalEntries.toArray();
    const existingForAsset = allEntries.filter(
      (e: any) => e && (e.reference === asset.id || (e.narration && e.narration.includes(asset.id)))
    );

    while (true) {
      const nextDate = getNextMonthDate(cursorDate);
      if (nextDate > todayStr) {
        break;
      }

      const period = nextDate.slice(0, 7); // YYYY-MM

      // Existing duplicate-period protection
      const isAlreadyPosted = existingForAsset.some((entry: any) => {
        if (!entry) return false;

        // 1. Exact installment tag in narration
        if (
          entry.narration &&
          (entry.narration.includes(`কিস্তি [${nextDate}]`) ||
            entry.narration.includes(`মাসিক কিস্তি (${nextDate})`))
        ) {
          return true;
        }

        // 2. If this entry explicitly tags a DIFFERENT installment (e.g. catch-up entry posted on a later date),
        // it must not be treated as having covered this period
        if (
          entry.narration &&
          (entry.narration.includes('কিস্তি [') || entry.narration.includes('মাসিক কিস্তি ('))
        ) {
          return false;
        }

        // 3. Fallback for legacy/standard entries without explicit installment tags
        if (!entry.date) return false;
        const entryPeriod = entry.date.slice(0, 7);
        const isSamePeriod = entryPeriod === period || entry.date === nextDate;
        if (!isSamePeriod) return false;

        const hasDeprLine = entry.lines?.some(
          (l: any) =>
            l.accountCode === deprAccounts.expenseCode ||
            l.accountCode === deprAccounts.accumulatedCode
        );
        return hasDeprLine || entry.voucherType === 'ADJUSTMENT';
      });

      if (isAlreadyPosted) {
        cursorDate = nextDate;
        continue;
      }

      const remainingDepreciable = Math.max(0, Math.round((maxDepreciableTotal - currentAccumulated) * 100) / 100);
      if (remainingDepreciable <= 0) {
        cursorDate = nextDate;
        break;
      }

      // Do not depreciate below salvage value: cap amountToPost at remainingDepreciable
      const amountToPost = Math.round(Math.min(monthlyDepr, remainingDepreciable) * 100) / 100;
      if (amountToPost <= 0) {
        cursorDate = nextDate;
        break;
      }

      // Respect closed periods and do not silently skip depreciation permanently:
      // If nextDate fell into a closed period, post this unrecorded depreciation into the open period!
      let postingDate = nextDate;
      let isCatchUpFromClosed = false;
      if (latestClosedDate && postingDate <= latestClosedDate) {
        postingDate = getNextDay(latestClosedDate);
        isCatchUpFromClosed = true;
      }

      const voucherNumber = generateTransactionNumber('ADJ');
      const entryId = generateUniqueId('j_depr');

      const lines: JournalLine[] = [
        {
          accountId: expenseAcc.id,
          accountCode: deprAccounts.expenseCode,
          accountName: expenseAcc.nameBn,
          debit: amountToPost,
          credit: 0,
          memo: `${asset.name} মাসিক অবচয় খরচ`
        },
        {
          accountId: accumAcc.id,
          accountCode: deprAccounts.accumulatedCode,
          accountName: accumAcc.nameBn,
          debit: 0,
          credit: amountToPost,
          memo: `${asset.name} পুঞ্জীভূত অবচয়`
        }
      ];

      const newEntry = {
        id: entryId,
        voucherNumber,
        voucherType: 'ADJUSTMENT' as const,
        date: postingDate,
        narration: isCatchUpFromClosed
          ? `স্থায়ী সম্পদ স্বয়ংক্রিয় অবচয় (সমাপ্ত হিসাবকাল সমন্বয়): ${asset.name} (${asset.id}) - মাসিক কিস্তি (${nextDate}), পোস্টিং তারিখ (${postingDate})`
          : `স্থায়ী সম্পদ স্বয়ংক্রিয় অবচয়: ${asset.name} (${asset.id}) - মাসিক কিস্তি (${nextDate})`,
        reference: asset.id,
        lines,
        createdBy: options?.currentUserId || 'AUTO_DEPRECIATION',
        createdAt: new Date().toISOString()
      };

      const posted = await postJournalEntry(newEntry, { accounts, skipDbPut: true });
      await safeInsert(dbInstance.journalEntries, posted, { idPrefix: 'j' });

      existingForAsset.push(posted);
      postedEntryIds.push(entryId);

      currentAccumulated = Math.round((currentAccumulated + amountToPost) * 100) / 100;
      cursorDate = nextDate;
      monthsPostedForAsset += 1;
      totalAssetDepr = Math.round((totalAssetDepr + amountToPost) * 100) / 100;
    }

    const newBookValue = Math.max(salvage, Math.round((cost - currentAccumulated) * 100) / 100);

    // Journal + asset-register update succeed together in lockstep
    if (monthsPostedForAsset > 0) {
      await dbInstance.fixedAssets.update(asset.id, {
        accumulatedDepreciation: currentAccumulated,
        currentBookValue: newBookValue,
        lastDepreciationDate: cursorDate,
        usefulLifeYears: deprParams.usefulLifeYears,
        depreciationRatePercent: deprParams.depreciationRatePercent,
        synced: false
      });

      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: options?.currentUserId || 'SYSTEM_AUTO_DEPRECIATION',
        role: 'OWNER',
        action: 'UPDATE',
        module: 'ACCOUNTING',
        recordId: asset.id,
        status: 'SUCCESS',
        details: JSON.stringify({
          action: 'AUTO_DEPRECIATION_POSTED',
          assetId: asset.id,
          assetName: asset.name,
          monthsPosted: monthsPostedForAsset,
          totalDepreciation: totalAssetDepr,
          newAccumulatedDepreciation: currentAccumulated,
          newBookValue,
          lastDepreciationDate: cursorDate
        }),
        synced: false
      });
    } else {
      // If 0 entries were posted, only advance lastDepreciationDate if cursorDate represents
      // periods that are genuinely ALREADY POSTED in existing journal entries,
      // and NEVER advance past unposted periods!
      const isCursorFullyAccounted = existingForAsset.some((e: any) => {
        if (!e || !e.date) return false;
        return e.date >= cursorDate || (cursorDate && e.date.slice(0, 7) === cursorDate.slice(0, 7));
      });
      if (isCursorFullyAccounted && cursorDate && cursorDate > (asset.lastDepreciationDate || '')) {
        await dbInstance.fixedAssets.update(asset.id, {
          lastDepreciationDate: cursorDate,
          synced: false
        });
      }
    }

    return {
      assetId: asset.id,
      assetName: asset.name,
      monthsPosted: monthsPostedForAsset,
      totalDepreciation: totalAssetDepr,
      newAccumulatedDepreciation: currentAccumulated,
      newBookValue,
      lastDepreciationDate: cursorDate,
      journalEntryIds: postedEntryIds
    };
  };

  if (dbInstance.transaction) {
    return await dbInstance.transaction(
      'rw',
      [
        dbInstance.fixedAssets,
        dbInstance.journalEntries,
        dbInstance.accounts,
        dbInstance.auditLogs,
        dbInstance.closedPeriods
      ],
      runInTx
    );
  } else {
    return await runInTx();
  }
}

/**
 * Core engine for automated fixed asset depreciation:
 * 1. Iterates active fixed assets.
 * 2. Runs executeAssetDepreciationAtomic for each asset.
 * 3. Aggregates results.
 */
export async function runAutomatedDepreciation(currentUserId?: string): Promise<DepreciationRunResult> {
  // If a depreciation run is currently in progress, wait for it to finish first
  while (activeDepreciationPromise) {
    try {
      await activeDepreciationPromise;
    } catch {
      // Ignore errors from previous in-flight run
    }
  }

  const runPromise = executeDepreciationInternal(currentUserId);
  activeDepreciationPromise = runPromise;

  try {
    return await runPromise;
  } finally {
    activeDepreciationPromise = null;
  }
}

async function executeDepreciationInternal(currentUserId?: string): Promise<DepreciationRunResult> {
  try {
    const assets = await db.fixedAssets.toArray();
    let totalEntriesPosted = 0;
    let grandTotalDepr = 0;
    const resultDetails: DepreciationRunResult['details'] = [];

    for (const asset of assets) {
      try {
        if ((asset as any).status === 'DISPOSED') continue;
        const res = await executeAssetDepreciationAtomic(asset.id, { currentUserId }, db);
        if (res.monthsPosted > 0) {
          totalEntriesPosted += res.monthsPosted;
          grandTotalDepr = Math.round((grandTotalDepr + res.totalDepreciation) * 100) / 100;
          resultDetails.push({
            assetId: res.assetId,
            assetName: res.assetName,
            monthsPosted: res.monthsPosted,
            amount: res.totalDepreciation,
            lastDepreciationDate: res.lastDepreciationDate
          });
        }
      } catch (assetErr: any) {
        console.error(
          `[DepreciationService] Failed to post automated depreciation for asset "${asset.name}" (${asset.id}):`,
          assetErr?.message || assetErr
        );
      }
    }

    return {
      assetsProcessed: assets.length,
      entriesPosted: totalEntriesPosted,
      totalDepreciationAmount: grandTotalDepr,
      details: resultDetails
    };
  } catch (err) {
    console.error('[DepreciationService] Error during automated depreciation calculation:', err);
    throw err;
  }
}

/**
 * Executes Fixed Asset Disposal atomically in a single Dexie transaction.
 * 
 * All succeed together or roll back on failure:
 * - Journal
 * - Cash/Bank update
 * - Asset status
 * - Accumulated depreciation
 * - Proceeds
 * - Gain/loss
 * - History/audit
 * 
 * Rules:
 * - Prevents duplicate disposal.
 * - Prevents disposal of an already disposed asset.
 * - Calculates gain/loss from carrying value (originalCost - accumulatedDepreciation).
 * - Preserves historical data (disposedOriginalCost, disposedAccumulatedDepreciation).
 * - Respects closed accounting periods.
 */
export async function executeFixedAssetDisposalTransaction(
  params: FixedAssetDisposalParams,
  dbInstance: any = db
): Promise<FixedAssetDisposalResult> {
  const runInTx = async (): Promise<FixedAssetDisposalResult> => {
    // 1. Fetch fresh asset inside transaction
    const freshAsset = await dbInstance.fixedAssets.get(params.assetId);
    if (!freshAsset) {
      throw new Error(`Fixed asset with ID "${params.assetId}" not found.`);
    }

    // 2. Prevent duplicate disposal and disposal of already disposed asset
    if (freshAsset.status === 'DISPOSED' || (freshAsset as any).disposalDate || (freshAsset as any).disposalJournalId) {
      throw new Error(
        `স্থায়ী সম্পদ "${freshAsset.name}" (${freshAsset.id}) ইতোমধ্যে অপসারিত (DISPOSED) করা হয়েছে। পুনরায় অপসারণ সম্ভব নয় (Asset already disposed).`
      );
    }

    if (dbInstance.journalEntries) {
      const allJournals = await dbInstance.journalEntries.toArray();
      const existingDisposalJournal = allJournals.find(
        (j: any) =>
          j &&
          j.reference === freshAsset.id &&
          (j.voucherNumber?.startsWith('DISP') ||
            j.narration?.includes('স্থায়ী সম্পদ অপসারণ') ||
            j.narration?.includes('Asset Disposal') ||
            j.narration?.includes('Disposal'))
      );
      if (existingDisposalJournal) {
        throw new Error(
          `স্থায়ী সম্পদ "${freshAsset.name}" (${freshAsset.id}) ইতোমধ্যে অপসারিত (DISPOSED) করা হয়েছে। অপসারণ জাবেদা (${existingDisposalJournal.voucherNumber || existingDisposalJournal.id}) ইতোমধ্যে বিদ্যমান (Asset already disposed).`
        );
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const dateStr = params.disposalDate || todayStr;
    if (dateStr > todayStr) {
      throw new Error(`অপসারণের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ দিন)।`);
    }

    // 3. Respect closed periods
    if (dbInstance.closedPeriods) {
      let closedPeriods: any[] = [];
      if (typeof dbInstance.closedPeriods.orderBy === 'function') {
        try {
          closedPeriods = await dbInstance.closedPeriods.orderBy('endDate').reverse().toArray();
        } catch {
          closedPeriods = await dbInstance.closedPeriods.toArray();
        }
      } else if (typeof dbInstance.closedPeriods.toArray === 'function') {
        closedPeriods = await dbInstance.closedPeriods.toArray();
      }
      const sortedClosed = [...closedPeriods].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
      const latestClosed = sortedClosed.length > 0 ? sortedClosed[0] : undefined;
      if (latestClosed && latestClosed.endDate && dateStr <= latestClosed.endDate) {
        throw new Error(
          `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosed.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে নতুন জাবেদা পোস্ট বা পরিবর্তন করা যাবে না (Period closed: ${latestClosed.endDate}).`
        );
      }
      if (closedPeriods.some((cp: any) => cp && cp.endDate === dateStr)) {
        throw new Error(
          `হিসাবরক্ষণ সীমাবদ্ধতা: ${dateStr} তারিখের হিসাব ইতোমধ্যে বন্ধ রয়েছে (Fiscal year-end date already closed).`
        );
      }
    }

    // 4. Calculate gain/loss from carrying value
    const cost = Number(freshAsset.originalCost || (freshAsset as any).disposedOriginalCost || 0);
    const accum = Number(freshAsset.accumulatedDepreciation || (freshAsset as any).disposedAccumulatedDepreciation || 0);
    const carryingValue = Math.round(Math.max(0, cost - accum) * 100) / 100;
    const proceeds = Math.max(0, Number(params.disposalProceeds || 0));
    const gainLoss = Math.round((proceeds - carryingValue) * 100) / 100;

    // 5. Ensure Chart of Accounts has 7020 Gain/Loss on Asset Disposal
    const accounts = await dbInstance.accounts.toArray();
    let disposalAcc = accounts.find(
      (a: any) =>
        a.code === '7020' ||
        a.nameEn?.toLowerCase().includes('gain/loss on asset disposal') ||
        a.nameBn?.includes('Gain/Loss on Asset Disposal')
    );
    if (!disposalAcc) {
      disposalAcc = {
        id: 'acc_7020',
        code: '7020',
        nameBn: 'স্থায়ী সম্পদ বিক্রয়জনিত লাভ/ক্ষতি (Gain/Loss on Asset Disposal)',
        nameEn: 'Gain/Loss on Asset Disposal',
        accountClass: 'OTHER_INCOME',
        normalBalance: 'CREDIT',
        isSystem: true,
        isActive: true
      };
      await safeInsert(dbInstance.accounts, disposalAcc, { idPrefix: 'acc' });
    }
    if (!accounts.some((a: any) => a.code === disposalAcc.code)) {
      accounts.push(disposalAcc);
    }

    // 6. Payment account setup & validation
    const paymentMethod = params.paymentMethod || 'CASH';
    let paymentCode: string = CANONICAL_ACCOUNTS.CASH;
    let paymentAccName = 'নগদ টাকা (Cash on Hand)';
    let receivingBankId: string | undefined;

    if (proceeds > 0) {
      if (paymentMethod === 'BANK') {
        if (!params.bankAccountId) {
          throw new Error('ব্যাংক হিসাব নির্বাচন করুন (Bank account is required for bank payment).');
        }
        const bAcc = await dbInstance.cashBankAccounts.get(params.bankAccountId);
        if (!bAcc) {
          throw new Error(`Bank account with ID "${params.bankAccountId}" not found.`);
        }
        paymentCode = CANONICAL_ACCOUNTS.BANK;
        paymentAccName = bAcc.name || 'ব্যাংক হিসাব (Bank Accounts)';
        receivingBankId = params.bankAccountId;
      } else {
        paymentCode = CANONICAL_ACCOUNTS.CASH;
        let cashAcc: any = undefined;
        if (dbInstance.cashBankAccounts.where) {
          try {
            cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
          } catch {
            // fallback to toArray
          }
        }
        if (!cashAcc) {
          const allCB = await dbInstance.cashBankAccounts.toArray();
          cashAcc = allCB.find((cb: any) =>
            cb.accountType === 'CASH' ||
            cb.code === '1010' ||
            cb.name?.toLowerCase().includes('cash') ||
            cb.name?.includes('নগদ')
          ) || allCB[0];
        }
        if (!cashAcc && proceeds > 0) {
          cashAcc = {
            id: 'cb_cash_default',
            accountName: 'নগদ টাকা (Cash on Hand)',
            name: 'নগদ টাকা (Cash on Hand)',
            accountType: 'CASH',
            accountNumber: '1010',
            currentBalance: 0,
            synced: false
          };
          await safeInsert(dbInstance.cashBankAccounts, cashAcc, { idPrefix: 'cb' });
        }
        if (cashAcc) {
          receivingBankId = cashAcc.id;
        }
      }
    }

    const paymentAcc = accounts.find((a: any) => a.code === paymentCode) || {
      id: `acc_${paymentCode}`,
      code: paymentCode,
      nameBn: paymentAccName
    };
    if (!accounts.some((a: any) => a.code === paymentAcc.code)) {
      accounts.push(paymentAcc);
    }

    // 7. GL Account for Asset Category
    const normCat = (freshAsset.category === 'BUILDING' ? 'BUILDINGS' : freshAsset.category) || 'MACHINERY';
    const assetGLCode = getAssetGLCode(normCat);
    const assetGLAcc = accounts.find((a: any) => a.code === assetGLCode) || {
      id: `acc_${assetGLCode}`,
      code: assetGLCode,
      nameBn: 'স্থায়ী সম্পদ (Fixed Assets)'
    };
    if (!accounts.some((a: any) => a.code === assetGLAcc.code)) {
      accounts.push(assetGLAcc);
    }

    const accumGLCode = CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION || '1590';
    const accumGLAcc = accounts.find((a: any) => a.code === accumGLCode) || {
      id: 'acc_1590',
      code: accumGLCode,
      nameBn: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation)'
    };
    if (!accounts.some((a: any) => a.code === accumGLAcc.code)) {
      accounts.push(accumGLAcc);
    }

    // 8. Balanced Journal lines
    const lines: JournalLine[] = [];
    if (proceeds > 0) {
      lines.push({
        accountId: paymentAcc.id,
        accountCode: paymentCode,
        accountName: paymentAcc.nameBn || paymentAccName,
        debit: proceeds,
        credit: 0,
        memo: `${freshAsset.name} স্থায়ী সম্পদ বিক্রয়লব্ধ প্রাপ্তি`
      });
    }

    if (accum > 0) {
      lines.push({
        accountId: accumGLAcc.id,
        accountCode: accumGLCode,
        accountName: accumGLAcc.nameBn,
        debit: accum,
        credit: 0,
        memo: `${freshAsset.name} পুঞ্জীভূত অবচয় অবলোপন`
      });
    }

    if (gainLoss > 0) {
      lines.push({
        accountId: disposalAcc.id,
        accountCode: disposalAcc.code,
        accountName: disposalAcc.nameBn,
        debit: 0,
        credit: gainLoss,
        memo: `${freshAsset.name} সম্পদ বিক্রয়জনিত লাভ (Gain on Asset Disposal)`
      });
    } else if (gainLoss < 0) {
      const lossAmount = Math.abs(gainLoss);
      lines.push({
        accountId: disposalAcc.id,
        accountCode: disposalAcc.code,
        accountName: disposalAcc.nameBn,
        debit: lossAmount,
        credit: 0,
        memo: `${freshAsset.name} সম্পদ বিক্রয়জনিত ক্ষতি (Loss on Asset Disposal)`
      });
    }

    if (cost > 0) {
      lines.push({
        accountId: assetGLAcc.id,
        accountCode: assetGLCode,
        accountName: assetGLAcc.nameBn,
        debit: 0,
        credit: cost,
        memo: `${freshAsset.name} স্থায়ী সম্পদ হিসাব হতে অবলোপন`
      });
    }

    const voucherNumber = generateTransactionNumber('DISP');
    const entryId = generateUniqueId('j_disp');

    const journalEntry = await postJournalEntry(
      {
        id: entryId,
        voucherNumber,
        voucherType: 'JOURNAL',
        date: dateStr,
        narration: `স্থায়ী সম্পদ অপসারণ/বিক্রয়: ${freshAsset.name} (${freshAsset.id}), বিক্রয়মূল্য: ৳${proceeds}, পুস্তক মূল্য: ৳${carryingValue}, ${gainLoss >= 0 ? `লাভ: ৳${gainLoss}` : `ক্ষতি: ৳${Math.abs(gainLoss)}`}${params.disposalReason ? ` [মন্তব্য: ${params.disposalReason}]` : ''}`,
        reference: freshAsset.id,
        lines,
        createdBy: params.currentUserId || 'SYSTEM',
        createdAt: new Date().toISOString()
      },
      { accounts, skipDbPut: true }
    );
    await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

    // 9. Update Cash/Bank Account balance
    if (proceeds > 0 && receivingBankId) {
      const cbAcc = await dbInstance.cashBankAccounts.get(receivingBankId);
      if (cbAcc) {
        await dbInstance.cashBankAccounts.update(receivingBankId, {
          currentBalance: Math.round((cbAcc.currentBalance + proceeds) * 100) / 100,
          synced: false
        });
      }
    }

    // 10. Update Fixed Asset status and preserve historical data
    const updatedAsset: FixedAsset = {
      ...freshAsset,
      status: 'DISPOSED',
      originalCost: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 0,
      disposalDate: dateStr,
      disposalProceeds: proceeds,
      gainLossOnDisposal: gainLoss,
      disposalJournalId: entryId,
      disposedOriginalCost: cost,
      disposedAccumulatedDepreciation: accum,
      disposalReason: params.disposalReason,
      synced: false
    };

    await dbInstance.fixedAssets.update(freshAsset.id, {
      status: 'DISPOSED',
      originalCost: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 0,
      disposalDate: dateStr,
      disposalProceeds: proceeds,
      gainLossOnDisposal: gainLoss,
      disposalJournalId: entryId,
      disposedOriginalCost: cost,
      disposedAccumulatedDepreciation: accum,
      disposalReason: params.disposalReason,
      synced: false
    });

    // 11. History / Audit Log
    if (dbInstance.auditLogs) {
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: params.currentUserId || 'SYSTEM',
        role: 'OWNER',
        action: 'DISPOSAL',
        module: 'ASSETS',
        recordId: freshAsset.id,
        status: 'SUCCESS',
        details: JSON.stringify({
          action: 'ASSET_DISPOSED',
          assetId: freshAsset.id,
          name: freshAsset.name,
          cost,
          accumulatedDepreciation: accum,
          carryingValue,
          saleProceeds: proceeds,
          gainLoss,
          voucherNumber,
          date: dateStr,
          disposalReason: params.disposalReason
        }),
        synced: false
      });
    }

    return {
      asset: updatedAsset,
      journalEntryId: entryId,
      voucherNumber,
      carryingValue,
      disposalProceeds: proceeds,
      gainLoss
    };
  };

  const tablesToLock = [
    dbInstance.fixedAssets,
    dbInstance.journalEntries,
    dbInstance.cashBankAccounts,
    dbInstance.accounts,
    dbInstance.auditLogs,
    dbInstance.closedPeriods
  ].filter(Boolean);

  if (dbInstance.transaction) {
    return await dbInstance.transaction('rw', tablesToLock, runInTx);
  } else {
    return await runInTx();
  }
}

/**
 * Normalizes fixed asset category string for reliable comparison.
 */
function normalizeCategory(category?: string): string {
  if (!category) return 'MACHINERY';
  const c = category.toUpperCase().trim();
  if (c === 'BUILDING') return 'BUILDINGS';
  if (c === 'VEHICLE') return 'VEHICLES';
  if (c === 'POND') return 'PONDS';
  return c;
}

/**
 * Checks whether an asset already has posted accounting entries
 * (e.g. initial acquisition journal entry, accumulated depreciation,
 * past depreciation run, or reference in general ledger).
 */
export async function hasAssetPostedAccounting(
  asset: FixedAsset,
  dbInstance: any = db
): Promise<{ hasAccounting: boolean; reason?: string }> {
  // 1. If asset is already disposed, history is permanently locked
  if (asset.status === 'DISPOSED' || (asset as any).disposalDate || (asset as any).disposalJournalId) {
    return {
      hasAccounting: true,
      reason: 'সম্পদটি ইতিমধ্যে অপসারিত (DISPOSED) করা হয়েছে'
    };
  }

  // 2. If accumulated depreciation is recorded
  if ((asset.accumulatedDepreciation || 0) > 0) {
    return {
      hasAccounting: true,
      reason: `সম্পদের বিপরীতে ৳${(asset.accumulatedDepreciation || 0).toLocaleString()} অবচয় ধার্য ও পোস্ট করা হয়েছে`
    };
  }

  // 3. If lastDepreciationDate differs from purchaseDate
  if (asset.lastDepreciationDate && asset.purchaseDate && asset.lastDepreciationDate !== asset.purchaseDate) {
    return {
      hasAccounting: true,
      reason: `সম্পদের অবচয় হিসাব ইতিমধ্যে কার্যকর রয়েছে (সর্বশেষ অবচয়: ${asset.lastDepreciationDate})`
    };
  }

  // 4. If initial acquisition journal entry exists
  if (asset.journalEntryId) {
    let jEntry: any;
    try {
      if (dbInstance.journalEntries && typeof dbInstance.journalEntries.get === 'function') {
        jEntry = await dbInstance.journalEntries.get(asset.journalEntryId);
      }
    } catch {
      // ignore
    }
    return {
      hasAccounting: true,
      reason: jEntry
        ? `সম্পদ ক্রয়ের জাবেদা দাখিলা (${jEntry.voucherNumber || jEntry.id}) সাধারণ খতিয়ানে পোস্ট করা রয়েছে`
        : 'সম্পদ ক্রয়ের জাবেদা দাখিলা সাধারণ খতিয়ানে পোস্ট করা রয়েছে'
    };
  }

  // 5. Check if any journal entries exist referencing this asset in the General Ledger
  if (dbInstance.journalEntries) {
    try {
      let related: any[] = [];
      if (typeof dbInstance.journalEntries.filter === 'function') {
        const q = dbInstance.journalEntries.filter((j: any) => j.reference === asset.id);
        related = typeof q.toArray === 'function' ? await q.toArray() : await q;
      } else if (typeof dbInstance.journalEntries.where === 'function') {
        related = await dbInstance.journalEntries.where('reference').equals(asset.id).toArray();
      } else if (typeof dbInstance.journalEntries.toArray === 'function') {
        const all = await dbInstance.journalEntries.toArray();
        related = all.filter((j: any) => j.reference === asset.id);
      }
      if (related && related.length > 0) {
        return {
          hasAccounting: true,
          reason: `সাধারণ খতিয়ানে এই সম্পদের বিপরীতে ${related.length}টি জাবেদা দাখিলা বিদ্যমান রয়েছে`
        };
      }
    } catch {
      // ignore query error on empty tables
    }
  }

  return { hasAccounting: false };
}

export interface EditFixedAssetParams {
  assetId: string;
  name: string;
  category?: FixedAsset['category'];
  purchaseDate?: string;
  originalCost?: number;
  usefulLifeYears?: number;
  salvageValue?: number;
  depreciationRatePercent?: number;
  photoUrl?: string;
  notes?: string;
  currentUserId?: string;
}

export interface EditFixedAssetResult {
  updatedAsset: FixedAsset;
  hasAccounting: boolean;
  accountingReason?: string;
}

/**
 * Safely updates a fixed asset, strictly protecting accounting-critical historical
 * fields (original cost, asset category, acquisition date, useful life, salvage value,
 * depreciation method/rate) from casual alteration once accounting or depreciation exists.
 *
 * Prevents silent divergence between the Fixed Asset Register and the General Ledger.
 */
export async function executeEditFixedAssetTransaction(
  params: EditFixedAssetParams,
  dbInstance: any = db
): Promise<EditFixedAssetResult> {
  const runInTx = async (): Promise<EditFixedAssetResult> => {
    const freshAsset = await dbInstance.fixedAssets.get(params.assetId);
    if (!freshAsset) {
      throw new Error(`Fixed asset with ID "${params.assetId}" not found.`);
    }

    if (!params.name || !params.name.trim()) {
      throw new Error('সম্পদের নাম খালি রাখা যাবে না (Asset name is required).');
    }

    const accountingCheck = await hasAssetPostedAccounting(freshAsset, dbInstance);

    if (accountingCheck.hasAccounting) {
      // Check for changes in protected historical fields
      const violations: string[] = [];

      if (params.originalCost !== undefined && Math.abs(Number(params.originalCost) - (freshAsset.originalCost || 0)) > 0.001) {
        violations.push(`মূল ক্রয়মূল্য (Original Cost: ৳${freshAsset.originalCost} -> ৳${params.originalCost})`);
      }

      if (params.category !== undefined && normalizeCategory(params.category) !== normalizeCategory(freshAsset.category)) {
        violations.push(`ক্যাটাগরি (Category: ${freshAsset.category} -> ${params.category})`);
      }

      if (params.purchaseDate !== undefined && params.purchaseDate !== freshAsset.purchaseDate) {
        violations.push(`অর্জনের তারিখ (Acquisition Date: ${freshAsset.purchaseDate} -> ${params.purchaseDate})`);
      }

      if (params.usefulLifeYears !== undefined && Math.abs(Number(params.usefulLifeYears) - (freshAsset.usefulLifeYears || 0)) > 0.001) {
        violations.push(`আয়ুষ্কাল (Useful Life: ${freshAsset.usefulLifeYears} বছর -> ${params.usefulLifeYears} বছর)`);
      }

      if (params.salvageValue !== undefined && Math.abs(Number(params.salvageValue) - (freshAsset.salvageValue || 0)) > 0.001) {
        violations.push(`ভগ্নাবশেষ মূল্য (Salvage Value: ৳${freshAsset.salvageValue} -> ৳${params.salvageValue})`);
      }

      if (params.depreciationRatePercent !== undefined && Math.abs(Number(params.depreciationRatePercent) - (freshAsset.depreciationRatePercent || 0)) > 0.001) {
        violations.push(`অবচয় হার/পদ্ধতি (Depreciation Rate: ${freshAsset.depreciationRatePercent}% -> ${params.depreciationRatePercent}%)`);
      }

      if (violations.length > 0) {
        throw new Error(
          `হিসাবরক্ষণ সুরক্ষানীতি: এই স্থায়ী সম্পদের জন্য ইতিমধ্যে খতিয়ানে হিসাব/অবচয় বিদ্যমান (${accountingCheck.reason})। ঐতিহাসিক তথ্যের বিকৃতি রোধ করতে ${violations.join(', ')} পরিবর্তন করা সম্পূর্ণ নিষিদ্ধ। সাধারণ খতিয়ান ও সম্পদ তালিকার সামঞ্জস্য রক্ষায় পরিবর্তন প্রত্যাখ্যান করা হয়েছে (Posted accounting history is protected).`
        );
      }

      // Safe non-financial fields update
      const updatedAsset: FixedAsset = {
        ...freshAsset,
        name: params.name.trim(),
        ...(params.photoUrl !== undefined ? { photoUrl: params.photoUrl } : {}),
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
        synced: false
      };

      await dbInstance.fixedAssets.put(updatedAsset);

      // Audit Log
      const auditLog = {
        id: generateUniqueId('aud_ast_edit'),
        timestamp: new Date().toISOString(),
        userId: params.currentUserId || 'system',
        role: 'ADMIN',
        action: 'EDIT_FIXED_ASSET_METADATA',
        details: `স্থায়ী সম্পদ "${freshAsset.name}" (ID: ${freshAsset.id})-এর সাধারণ বিবরণ/নাম হালনাগাদ করা হয়েছে (ঐতিহাসিক হিসাব অপরিবর্তিত রাখা হয়েছে)।`,
        synced: false
      };
      if (dbInstance.auditLogs) {
        await safeInsert(dbInstance.auditLogs, auditLog, { idPrefix: 'aud' });
      }

      return {
        updatedAsset,
        hasAccounting: true,
        accountingReason: accountingCheck.reason
      };
    }

    // If NO posted accounting exists yet (unposted/draft asset)
    const newCost = params.originalCost !== undefined ? Number(params.originalCost) : freshAsset.originalCost;
    const newLife = params.usefulLifeYears !== undefined ? Number(params.usefulLifeYears) : freshAsset.usefulLifeYears;
    const newSalvage = params.salvageValue !== undefined ? Number(params.salvageValue) : freshAsset.salvageValue;
    const deprParams = calculateAssetDepreciationParameters(
      newCost,
      newSalvage,
      newLife,
      params.depreciationRatePercent !== undefined ? Number(params.depreciationRatePercent) : freshAsset.depreciationRatePercent
    );
    const newCategory = params.category !== undefined ? normalizeCategory(params.category) as any : freshAsset.category;
    const newPurchaseDate = params.purchaseDate !== undefined ? params.purchaseDate : freshAsset.purchaseDate;

    const updatedAsset: FixedAsset = {
      ...freshAsset,
      name: params.name.trim(),
      category: newCategory,
      purchaseDate: newPurchaseDate,
      originalCost: newCost,
      usefulLifeYears: deprParams.usefulLifeYears,
      salvageValue: newSalvage,
      depreciationRatePercent: deprParams.depreciationRatePercent,
      currentBookValue: Math.max(newSalvage, newCost - (freshAsset.accumulatedDepreciation || 0)),
      ...(params.photoUrl !== undefined ? { photoUrl: params.photoUrl } : {}),
      ...(params.notes !== undefined ? { notes: params.notes } : {}),
      synced: false
    };

    await dbInstance.fixedAssets.put(updatedAsset);

    const auditLog = {
      id: generateUniqueId('aud_ast_edit'),
      timestamp: new Date().toISOString(),
      userId: params.currentUserId || 'system',
      role: 'ADMIN',
      action: 'EDIT_UNPOSTED_FIXED_ASSET',
      details: `খসড়া স্থায়ী সম্পদ "${freshAsset.name}" (ID: ${freshAsset.id})-এর তথ্য হালনাগাদ করা হয়েছে।`,
      synced: false
    };
    if (dbInstance.auditLogs) {
      await safeInsert(dbInstance.auditLogs, auditLog, { idPrefix: 'aud' });
    }

    return {
      updatedAsset,
      hasAccounting: false
    };
  };

  if (dbInstance.transaction) {
    return await dbInstance.transaction(
      'rw',
      [
        dbInstance.fixedAssets,
        dbInstance.journalEntries,
        dbInstance.auditLogs
      ],
      runInTx
    );
  } else {
    return await runInTx();
  }
}

/**
 * Runs automated depreciation once per application load session.
 */
export async function runDepreciationOnAppLoad(currentUserId?: string): Promise<DepreciationRunResult | null> {
  if (hasRunOnAppLoad) {
    return null;
  }
  hasRunOnAppLoad = true;
  return runAutomatedDepreciation(currentUserId);
}
