import { db } from '../db/indexedDb';
import { getDepreciationAccounts, CANONICAL_ACCOUNTS } from './accountMapping';
import { postJournalEntry } from './accountingEngine';
import { JournalLine, FixedAsset } from '../types';
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
 * 1. Checks duplicate-period protection so retrying does NOT duplicate depreciation.
 * 2. Ensures journal entries and asset register update succeed together.
 * 3. Any failure automatically rolls back both.
 * 4. Respects closed accounting periods.
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

    const cost = Number(asset.originalCost || 0);
    if (cost <= 0) {
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

    const rate = Number(
      asset.depreciationRatePercent ?? (asset.usefulLifeYears > 0 ? 100 / asset.usefulLifeYears : 10)
    );
    if (rate <= 0) {
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

    const monthlyDepr = Math.round(((cost * rate / 100) / 12) * 100) / 100;
    if (monthlyDepr <= 0) {
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

    let currentAccumulated = Number(asset.accumulatedDepreciation || 0);
    const salvage = Number(asset.salvageValue || 0);
    const maxDepreciableTotal = Math.max(0, cost - salvage);

    if (currentAccumulated >= maxDepreciableTotal) {
      return {
        assetId: asset.id,
        assetName: asset.name,
        monthsPosted: 0,
        totalDepreciation: 0,
        newAccumulatedDepreciation: currentAccumulated,
        newBookValue: Math.max(0, Math.round((cost - currentAccumulated) * 100) / 100),
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

    const todayStr = options?.targetDate || new Date().toISOString().split('T')[0];
    let cursorDate = asset.lastDepreciationDate || asset.purchaseDate || todayStr;
    let monthsPostedForAsset = 0;
    let totalAssetDepr = 0;
    const postedEntryIds: string[] = [];

    // Check closed periods to respect closed periods
    let latestClosedDate = '';
    if (dbInstance.closedPeriods) {
      const closedPeriods = await dbInstance.closedPeriods.orderBy('endDate').reverse().toArray();
      if (closedPeriods && closedPeriods.length > 0 && closedPeriods[0].endDate) {
        latestClosedDate = closedPeriods[0].endDate;
      }
    }

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

      // Respect closed periods: do not post depreciation entries into closed periods
      if (latestClosedDate && nextDate <= latestClosedDate) {
        cursorDate = nextDate;
        continue;
      }

      const period = nextDate.slice(0, 7); // YYYY-MM

      // Existing duplicate-period protection
      const isAlreadyPosted = existingForAsset.some((entry: any) => {
        if (!entry) return false;
        const entryPeriod = entry.date ? entry.date.slice(0, 7) : '';
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

      const remainingDepreciable = Math.max(0, maxDepreciableTotal - currentAccumulated);
      if (remainingDepreciable <= 0) {
        cursorDate = nextDate;
        break;
      }

      const amountToPost = Math.round(Math.min(monthlyDepr, remainingDepreciable) * 100) / 100;
      if (amountToPost <= 0) {
        cursorDate = nextDate;
        break;
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
        date: nextDate,
        narration: `স্থায়ী সম্পদ স্বয়ংক্রিয় অবচয়: ${asset.name} (${asset.id}) - মাসিক কিস্তি (${nextDate})`,
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

    const newBookValue = Math.max(0, Math.round((cost - currentAccumulated) * 100) / 100);

    // Journal + asset-register update succeed together
    if (monthsPostedForAsset > 0) {
      await dbInstance.fixedAssets.update(asset.id, {
        accumulatedDepreciation: currentAccumulated,
        currentBookValue: newBookValue,
        lastDepreciationDate: cursorDate,
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
    } else if (cursorDate && cursorDate > (asset.lastDepreciationDate || '')) {
      await dbInstance.fixedAssets.update(asset.id, {
        lastDepreciationDate: cursorDate,
        synced: false
      });
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

    const todayStr = new Date().toISOString().split('T')[0];
    const dateStr = params.disposalDate || todayStr;
    if (dateStr > todayStr) {
      throw new Error(`অপসারণের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ দিন)।`);
    }

    // 3. Respect closed periods
    if (dbInstance.closedPeriods) {
      const closedPeriods = await dbInstance.closedPeriods.orderBy('endDate').reverse().toArray();
      const latestClosed = closedPeriods && closedPeriods.length > 0 ? closedPeriods[0] : undefined;
      if (latestClosed && dateStr <= latestClosed.endDate) {
        throw new Error(
          `হিসাবরক্ষণ সীমাবদ্ধতা: ${latestClosed.endDate} বা তার পূর্বের সময়কালের হিসাব ইতোমধ্যে বছর সমাপ্তি (Year-End Closed) করা হয়েছে। বন্ধ সময়কালের কোনো তারিখে নতুন জাবেদা পোস্ট বা পরিবর্তন করা যাবে না (Period closed: ${latestClosed.endDate}).`
        );
      }
      if (dbInstance.closedPeriods.where) {
        const closedExact = await dbInstance.closedPeriods.where('endDate').equals(dateStr).first();
        if (closedExact) {
          throw new Error(
            `হিসাবরক্ষণ সীমাবদ্ধতা: ${dateStr} তারিখের হিসাব ইতোমধ্যে বন্ধ রয়েছে (Fiscal year-end date already closed).`
          );
        }
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
          cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
        } else {
          const allCB = await dbInstance.cashBankAccounts.toArray();
          cashAcc = allCB.find((cb: any) => cb.accountType === 'CASH');
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
    await safeInsert(dbInstance.auditLogs, {
      id: generateUniqueId('audit'),
      timestamp: new Date().toISOString(),
      userId: params.currentUserId || 'SYSTEM',
      role: 'OWNER',
      action: 'DELETE',
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
        date: dateStr
      }),
      synced: false
    });

    return {
      asset: updatedAsset,
      journalEntryId: entryId,
      voucherNumber,
      carryingValue,
      disposalProceeds: proceeds,
      gainLoss
    };
  };

  if (dbInstance.transaction) {
    return await dbInstance.transaction(
      'rw',
      [
        dbInstance.fixedAssets,
        dbInstance.journalEntries,
        dbInstance.cashBankAccounts,
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
 * Runs automated depreciation once per application load session.
 */
export async function runDepreciationOnAppLoad(currentUserId?: string): Promise<DepreciationRunResult | null> {
  if (hasRunOnAppLoad) {
    return null;
  }
  hasRunOnAppLoad = true;
  return runAutomatedDepreciation(currentUserId);
}
