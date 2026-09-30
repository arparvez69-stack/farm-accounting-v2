import { db } from '../db/indexedDb';
import {
  FixedAsset,
  JournalEntry,
  FixedAssetVerificationItem,
  FixedAssetRevaluationEvent
} from '../types';
import { postJournalEntry } from './accountingEngine';
import { CANONICAL_ACCOUNTS } from './accountMapping';
import { getAssetGLCode } from './depreciationService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

// In-memory store for Fixed Asset Revaluation Events (Prompt 09)
const inMemoryFixedAssetRevaluationEvents: Map<string, FixedAssetRevaluationEvent> = new Map();

/**
 * Clear in-memory revaluation events (for test isolation)
 */
export function clearFixedAssetRevaluationEventsForTest(): void {
  inMemoryFixedAssetRevaluationEvents.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('goted_fixed_asset_revaluation_events');
    }
  } catch {}
}

/**
 * Get all recorded fixed asset revaluation events
 */
export function getFixedAssetRevaluationEvents(): FixedAssetRevaluationEvent[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_fixed_asset_revaluation_events') || '{}');
      for (const [k, v] of Object.entries(stored)) {
        if (!inMemoryFixedAssetRevaluationEvents.has(k)) {
          inMemoryFixedAssetRevaluationEvents.set(k, v as FixedAssetRevaluationEvent);
        }
      }
    }
  } catch {}
  return Array.from(inMemoryFixedAssetRevaluationEvents.values());
}

/**
 * Get a single fixed asset revaluation event by ID
 */
export function getFixedAssetRevaluationEventById(id: string): FixedAssetRevaluationEvent | undefined {
  if (inMemoryFixedAssetRevaluationEvents.has(id)) {
    return inMemoryFixedAssetRevaluationEvents.get(id);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = JSON.parse(localStorage.getItem('goted_fixed_asset_revaluation_events') || '{}');
      if (stored[id]) {
        inMemoryFixedAssetRevaluationEvents.set(id, stored[id]);
        return stored[id];
      }
    }
  } catch {}
  return undefined;
}

/**
 * PROMPT 09: Fixed Asset Verification Breakdown
 *
 * Shows separately:
 * - original cost;
 * - accumulated depreciation;
 * - carrying amount;
 * - verified/approved value;
 * - adjustment;
 * - reason.
 */
export function getFixedAssetVerificationBreakdown(
  asset: FixedAsset,
  approvedValue?: number,
  reason?: string
): FixedAssetVerificationItem {
  const originalCost = round2(Number(asset.originalCost ?? (asset as any).cost ?? (asset as any).purchasePrice) || 0);
  const accumulatedDepreciation = round2(Number(asset.accumulatedDepreciation) || 0);
  const carryingAmount = asset.currentBookValue !== undefined
    ? round2(asset.currentBookValue)
    : round2(originalCost - accumulatedDepreciation);

  const verifiedApprovedValue = approvedValue !== undefined
    ? round2(approvedValue)
    : (asset.verifiedApprovedValue !== undefined
        ? round2(asset.verifiedApprovedValue)
        : (asset.currentBookValue !== undefined ? round2(asset.currentBookValue) : carryingAmount));

  const adjustment = round2(verifiedApprovedValue - carryingAmount);
  const adjustmentType: FixedAssetVerificationItem['adjustmentType'] =
    adjustment < 0 ? 'IMPAIRMENT_DECREASE' : adjustment > 0 ? 'REVALUATION_SURPLUS' : 'NO_CHANGE';

  const defaultReason = adjustment === 0
    ? 'স্থায়ী সম্পদ শারীরিক যাচাই সম্পন্ন (বহিমূল্য অপরিবর্তিত)'
    : adjustment < 0
    ? 'শারীরিক পর্যবেক্ষণ ও কারিগরি মূল্যায়ন অনুসারে অবমূল্যায়ন / ক্ষতি (Asset Impairment)'
    : 'বাজারমূল্য ও উৎপাদন ক্ষমতা বৃদ্ধিজনিত পুনর্মূল্যায়ন উদ্বৃত্ত (Revaluation Surplus)';

  return {
    assetId: asset.id,
    assetName: asset.name,
    category: asset.category,
    originalCost,
    accumulatedDepreciation,
    carryingAmount,
    verifiedApprovedValue,
    adjustment,
    adjustmentType,
    reason: reason || asset.revaluationReason || defaultReason,
    status: adjustment !== 0 ? 'ADJUSTED' : 'VERIFIED'
  };
}

/**
 * PROMPT 09: Fixed Asset Verification & Revaluation Adjustment
 *
 * A user correction must become an auditable adjustment/revaluation event.
 * Do not silently overwrite historical depreciation.
 * Do not automatically classify every valuation adjustment as operating profit.
 *
 * Test case:
 * Cost = 1000
 * Accumulated depreciation = 300
 * Carrying amount = 700
 * Approved value = 600
 * Verify the 100 difference is traceable.
 */
export async function recordFixedAssetVerificationAdjustment(
  params: {
    assetId: string;
    approvedValue: number;
    reason: string;
    user: string;
    valuationDate?: string;
    treatment?: 'IMPAIRMENT_LOSS' | 'REVALUATION_SURPLUS' | 'EQUITY_REVALUATION_RESERVE' | 'NON_OPERATING_LOSS';
    customExpenseAccountCode?: string;
    customSurplusAccountCode?: string;
  },
  dbInstance: any = db
): Promise<{
  verificationItem: FixedAssetVerificationItem;
  revaluationEvent?: FixedAssetRevaluationEvent;
  journalEntry?: JournalEntry;
  updatedAsset: FixedAsset;
}> {
  const {
    assetId,
    approvedValue,
    reason,
    user,
    valuationDate,
    treatment,
    customExpenseAccountCode,
    customSurplusAccountCode
  } = params;

  if (!assetId || typeof assetId !== 'string') {
    throw new Error('স্থায়ী সম্পদ আইডি আবশ্যক (Asset ID is required).');
  }

  if (typeof approvedValue !== 'number' || isNaN(approvedValue) || approvedValue < 0) {
    throw new Error('অনুমোদিত মূল্যায়ন মান একটি অ-ঋণাত্মক বৈধ সংখ্যা হতে হবে (Approved value must be a non-negative number).');
  }

  if (!user || typeof user !== 'string' || !user.trim()) {
    throw new Error('যাচাইকারী / দায়িত্বপ্রাপ্ত ব্যবহারকারী আবশ্যক (User/auditor is required).');
  }

  const cleanUser = user.trim();

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('মূল্যায়ন সমন্বয়ের কারণ আবশ্যক (Reason is required for fixed asset valuation adjustment).');
  }

  const cleanReason = reason.trim();

  // 1. Retrieve fixed asset
  const asset: FixedAsset | undefined = await dbInstance.fixedAssets.get(assetId);
  if (!asset) {
    throw new Error(`স্থায়ী সম্পদ পাওয়া যায়নি (Fixed asset not found: ${assetId})।`);
  }

  // 2. Generate detailed verification breakdown showing all 6 required fields separately
  const verificationItem = getFixedAssetVerificationBreakdown(asset, approvedValue, cleanReason);
  const { originalCost, accumulatedDepreciation, carryingAmount, adjustment } = verificationItem;

  const timestamp = new Date().toISOString();
  const cleanDate = valuationDate ? valuationDate.slice(0, 10) : timestamp.slice(0, 10);
  const eventId = `fa_rev_${Date.now()}_${generateUniqueId('far').slice(0, 8)}`;

  let revaluationEvent: FixedAssetRevaluationEvent | undefined;
  let journalEntry: JournalEntry | undefined;

  // 3. If there is an adjustment, post auditable revaluation event
  if (adjustment !== 0) {
    const isDecrease = adjustment < 0;
    const absAdjustment = Math.abs(adjustment);

    // Determine Accounting GL Accounts:
    // Asset GL Account (e.g. 1550 Machinery, 1510 Land, 1520 Buildings, etc.)
    const assetGLCode = getAssetGLCode(asset.category);

    // CRITICAL: Do NOT automatically classify valuation adjustment as operating profit!
    // Valuation adjustments are non-operating impairment losses or revaluation surplus/reserve.
    const isOperatingProfit = false;

    let debitCode: string;
    let creditCode: string;
    let selectedTreatment: FixedAssetRevaluationEvent['accountingTreatment'];

    if (isDecrease) {
      // Impairment / Downward Revaluation
      // Debit: Impairment Loss / Capital Asset Write-off (8020 / 7020 / 6150)
      // Credit: Fixed Asset Cost (1550 / 1510 / 1520 / 1530)
      debitCode = customExpenseAccountCode || CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF || '8020';
      creditCode = assetGLCode;
      selectedTreatment = treatment || 'IMPAIRMENT_LOSS';
    } else {
      // Revaluation Surplus
      // Debit: Fixed Asset Cost (1550)
      // Credit: Other Non-Operating Income (7020) or Equity Revaluation Reserve (3050)
      debitCode = assetGLCode;
      creditCode = customSurplusAccountCode || '7020';
      selectedTreatment = treatment || 'REVALUATION_SURPLUS';
    }

    const voucherNumber = generateTransactionNumber('V-REV');
    const narration = `স্থায়ী সম্পদ পুনর্মূল্যায়ন দাখিলা: "${asset.name}" (${asset.category}) | ক্রয়মূল্য: ৳${originalCost}, পুঞ্জীভূত অবচয়: ৳${accumulatedDepreciation}, পূর্ববর্তী বহিমূল্য: ৳${carryingAmount}, অনুমোদিত মান: ৳${approvedValue}, সমন্বয়: ৳${adjustment}। কারণ: ${cleanReason}। নিরীক্ষক: ${cleanUser} [অ-পরিচালন মূল্যায়ন সমন্বয়, অপারেটিং মুনাফায় অন্তর্ভুক্ত নয়]`;

    // 3a. Post Adjusting Journal Entry via Accounting Engine
    journalEntry = await postJournalEntry(
      {
        id: generateUniqueId('j_fa_rev'),
        voucherNumber,
        voucherType: 'JOURNAL',
        date: cleanDate,
        narration,
        lines: [
          {
            accountCode: debitCode,
            accountName: isDecrease
              ? 'স্থায়ী সম্পদ অবমূল্যায়ন / ক্ষতি (Asset Impairment Loss - Non-Operating)'
              : 'স্থায়ী সম্পদ হিসাব (Asset Revaluation Addition)',
            debit: absAdjustment,
            credit: 0
          },
          {
            accountCode: creditCode,
            accountName: isDecrease
              ? 'স্থায়ী সম্পদ খতিয়ান (Asset Valuation Reduction)'
              : 'স্থায়ী সম্পদ পুনর্মূল্যায়ন উদ্বৃত্ত (Revaluation Surplus - Non-Operating)',
            debit: 0,
            credit: absAdjustment
          }
        ],
        createdBy: cleanUser,
        createdAt: timestamp
      },
      { dbInstance }
    );

    // 3b. Record formal FixedAssetRevaluationEvent
    revaluationEvent = {
      id: eventId,
      assetId: asset.id,
      assetName: asset.name,
      category: asset.category,
      valuationDate: cleanDate,
      originalCost,
      accumulatedDepreciation, // PRESERVED: Historical depreciation is NOT silently overwritten
      carryingAmount,
      verifiedApprovedValue: approvedValue,
      adjustment,
      reason: cleanReason,
      accountingTreatment: selectedTreatment,
      debitAccountCode: debitCode,
      creditAccountCode: creditCode,
      isOperatingProfit, // Strictly FALSE
      user: cleanUser,
      timestamp,
      journalEntryId: journalEntry.id,
      voucherNumber,
      synced: false
    };

    // 3c. Record Audit Log
    if (dbInstance.auditLogs) {
      try {
        const auditId = generateUniqueId('audit');
        await safeInsert(dbInstance.auditLogs, {
          id: auditId,
          timestamp,
          userId: cleanUser,
          role: 'AUDITOR',
          action: 'FIXED_ASSET_VERIFICATION_REVALUATION',
          module: 'FIXED_ASSETS',
          recordId: asset.id,
          status: 'SUCCESS',
          details: JSON.stringify({
            eventId,
            assetId: asset.id,
            assetName: asset.name,
            originalCost,
            accumulatedDepreciation, // Preserved
            carryingAmount,
            verifiedApprovedValue: approvedValue,
            adjustment,
            reason: cleanReason,
            voucherNumber,
            isOperatingProfit: false
          }),
          synced: false
        });
        revaluationEvent.auditLogId = auditId;
      } catch {}
    }

    inMemoryFixedAssetRevaluationEvents.set(eventId, revaluationEvent);
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = JSON.parse(localStorage.getItem('goted_fixed_asset_revaluation_events') || '{}');
        stored[eventId] = revaluationEvent;
        localStorage.setItem('goted_fixed_asset_revaluation_events', JSON.stringify(stored));
      }
    } catch {}
  }

  // 4. Update Fixed Asset in database
  // CRITICAL: DO NOT silently overwrite historical depreciation!
  // accumulatedDepreciation remains exactly what it was (e.g. 300).
  const cumulativeRevaluationAdjustment = round2((Number(asset.revaluationAdjustment) || 0) + adjustment);

  const updatedAsset: FixedAsset = {
    ...asset,
    // Historical originalCost and accumulatedDepreciation are preserved
    originalCost,
    accumulatedDepreciation, // UNCHANGED!
    currentBookValue: approvedValue, // Updated carrying value matches approved value
    verifiedApprovedValue: approvedValue,
    revaluationAdjustment: cumulativeRevaluationAdjustment,
    revaluationReason: cleanReason,
    lastRevaluationDate: cleanDate,
    revaluationJournalId: journalEntry?.id,
    synced: false
  };

  await dbInstance.fixedAssets.update(asset.id, {
    currentBookValue: approvedValue,
    verifiedApprovedValue: approvedValue,
    revaluationAdjustment: cumulativeRevaluationAdjustment,
    revaluationReason: cleanReason,
    lastRevaluationDate: cleanDate,
    revaluationJournalId: journalEntry?.id,
    synced: false
  });

  return {
    verificationItem,
    revaluationEvent,
    journalEntry,
    updatedAsset
  };
}
