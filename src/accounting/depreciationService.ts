import { db } from '../db/indexedDb';
import { getDepreciationAccounts } from './accountMapping';
import { postJournalEntry } from './accountingEngine';
import { JournalLine } from '../types';
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

let activeDepreciationPromise: Promise<DepreciationRunResult> | null = null;
let hasRunOnAppLoad = false;

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
 * Core engine for automated fixed asset depreciation:
 * 1. For every active fixed asset, monthly depreciation = (cost × depreciationRatePercent / 100) / 12
 * 2. For every full month elapsed since lastDepreciationDate that hasn't yet been posted,
 *    auto-posts a balanced journal entry:
 *    Debit: Depreciation Expense (6140), Credit: Accumulated Depreciation (1590)
 * 3. Updates accumulatedDepreciation, currentBookValue, and lastDepreciationDate on the asset.
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
    const accounts = await db.accounts.toArray();
    const deprAccounts = getDepreciationAccounts();

    const expenseAcc = accounts.find((a) => a.code === deprAccounts.expenseCode) || {
      id: 'acc_6140',
      code: '6140',
      nameBn: 'অবচয় খরচ (Depreciation Expense)'
    };

    const accumAcc = accounts.find((a) => a.code === deprAccounts.accumulatedCode) || {
      id: 'acc_1590',
      code: '1590',
      nameBn: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation)'
    };

    const existingJournalEntries = await db.journalEntries.toArray();
    const todayStr = new Date().toISOString().split('T')[0];
    let totalEntriesPosted = 0;
    let grandTotalDepr = 0;
    const resultDetails: DepreciationRunResult['details'] = [];

    for (const asset of assets) {
      try {
        if ((asset as any).status === 'DISPOSED') continue;
        const cost = Number(asset.originalCost || 0);
        if (cost <= 0) continue;

        // Rate: annual % entered at purchase or derived from useful life years
        const rate = Number(
          asset.depreciationRatePercent ?? (asset.usefulLifeYears > 0 ? 100 / asset.usefulLifeYears : 10)
        );
        if (rate <= 0) continue;

        // Monthly depreciation = (cost × depreciationRatePercent / 100) / 12
        const monthlyDepr = Math.round(((cost * rate / 100) / 12) * 100) / 100;
        if (monthlyDepr <= 0) continue;

        let currentAccumulated = Number(asset.accumulatedDepreciation || 0);
        const salvage = Number(asset.salvageValue || 0);
        const maxDepreciableTotal = Math.max(0, cost - salvage);

        if (currentAccumulated >= maxDepreciableTotal) {
          // Already fully depreciated
          continue;
        }

        // Starting point: lastDepreciationDate or purchaseDate or today
        let cursorDate = asset.lastDepreciationDate || asset.purchaseDate || todayStr;
        let monthsPostedForAsset = 0;
        let totalAssetDepr = 0;

        while (true) {
          const nextDate = getNextMonthDate(cursorDate);
          // Only post for full months elapsed up to today
          if (nextDate > todayStr) {
            break;
          }

          const period = nextDate.slice(0, 7); // YYYY-MM

          // Check for an existing depreciation entry for the same assetId + period
          const isAlreadyPosted = existingJournalEntries.some((entry) => {
            if (!entry) return false;
            const isSameAsset =
              entry.reference === asset.id ||
              Boolean(entry.narration && entry.narration.includes(asset.id));
            if (!isSameAsset) return false;

            const entryPeriod = entry.date ? entry.date.slice(0, 7) : '';
            const isSamePeriod = entryPeriod === period || entry.date === nextDate;
            if (!isSamePeriod) return false;

            const hasDeprLine = entry.lines?.some(
              (l) =>
                l.accountCode === deprAccounts.expenseCode ||
                l.accountCode === deprAccounts.accumulatedCode
            );
            return hasDeprLine || entry.voucherType === 'ADJUSTMENT';
          });

          if (isAlreadyPosted) {
            // Skip if already posted; advance cursorDate to ensure safe repeated runs without duplicates
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

          // Auto-post balanced journal entry
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
            createdBy: currentUserId || 'AUTO_DEPRECIATION',
            createdAt: new Date().toISOString()
          };

          await postJournalEntry(newEntry, { accounts });

          existingJournalEntries.push(newEntry as any);

          currentAccumulated = Math.round((currentAccumulated + amountToPost) * 100) / 100;
          cursorDate = nextDate;
          monthsPostedForAsset += 1;
          totalAssetDepr = Math.round((totalAssetDepr + amountToPost) * 100) / 100;
        }

        if (monthsPostedForAsset > 0) {
          const newBookValue = Math.max(0, Math.round((cost - currentAccumulated) * 100) / 100);

          await db.fixedAssets.update(asset.id, {
            accumulatedDepreciation: currentAccumulated,
            currentBookValue: newBookValue,
            lastDepreciationDate: cursorDate,
            synced: false
          });

          // Audit log
          await safeInsert(db.auditLogs, {
            id: generateUniqueId('audit'),
            timestamp: new Date().toISOString(),
            userId: currentUserId || 'SYSTEM_AUTO_DEPRECIATION',
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

          totalEntriesPosted += monthsPostedForAsset;
          grandTotalDepr = Math.round((grandTotalDepr + totalAssetDepr) * 100) / 100;

          resultDetails.push({
            assetId: asset.id,
            assetName: asset.name,
            monthsPosted: monthsPostedForAsset,
            amount: totalAssetDepr,
            lastDepreciationDate: cursorDate
          });
        } else if (cursorDate && cursorDate > (asset.lastDepreciationDate || '')) {
          await db.fixedAssets.update(asset.id, {
            lastDepreciationDate: cursorDate,
            synced: false
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
 * Runs automated depreciation once per application load session.
 */
export async function runDepreciationOnAppLoad(currentUserId?: string): Promise<DepreciationRunResult | null> {
  if (hasRunOnAppLoad) {
    return null;
  }
  hasRunOnAppLoad = true;
  return runAutomatedDepreciation(currentUserId);
}
