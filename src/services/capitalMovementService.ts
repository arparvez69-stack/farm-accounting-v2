import { db } from '../db/indexedDb';
import { generateUniqueId, generateTransactionNumber, safeInsert } from '../utils/idGenerator';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  CapitalMovementType,
  InvestorCapitalMovement,
  InvestmentTranche,
  Investor,
  JournalLine
} from '../types';

/**
 * CAPITAL MOVEMENT SERVICE (Agro ERP Prompt 06)
 *
 * Provides a dedicated capital movement ledger for investor capital transactions.
 * Separately identifiable movement categories:
 * - INITIAL_CONTRIBUTION: First-time capital contribution
 * - ADDITIONAL_CONTRIBUTION: Subsequent capital injections / tranches
 * - WITHDRAWAL: Capital returned / withdrawn by investor
 * - REINVESTED_PROFIT: Conversion of earned profit payable into capital (NO new profit created!)
 * - ADJUSTMENT: Other approved capital restructuring adjustments
 *
 * Strict Accounting Invariants:
 * - Investor capital contribution must NOT become farm revenue (no 4xxx accounts).
 * - Investor capital withdrawal must NOT become farm expense (no 5xxx/6xxx accounts).
 * - Reinvested profit must NOT create new profit (no P&L impact).
 */

export interface RecordCapitalMovementParams {
  investorId: string;
  participantId?: string;
  investorName?: string;
  trancheId?: string;
  movementType: CapitalMovementType;
  amount: number;
  direction: 'INFLOW' | 'OUTFLOW';
  date: string;
  effectiveDate?: string;
  journalEntryId: string;
  voucherNumber: string;
  sourceOrTargetAccountId?: string;
  sourceProfitAllocationId?: string;
  sourceProfitAllocation?: string;
  settlementEventId?: string;
  settlementEvent?: string;
  isReinvestment?: boolean;
  notes?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  approvedBy?: string;
  currentUserId: string;
  idempotencyKey?: string;
}

/**
 * Persists an investor capital movement in the dedicated ledger
 */
export async function recordCapitalMovement(
  params: RecordCapitalMovementParams,
  dbInstance: any = db
): Promise<InvestorCapitalMovement> {
  const {
    investorId,
    participantId,
    investorName,
    trancheId,
    movementType,
    amount,
    direction,
    date,
    effectiveDate,
    journalEntryId,
    voucherNumber,
    sourceOrTargetAccountId,
    sourceProfitAllocationId,
    sourceProfitAllocation,
    settlementEventId,
    settlementEvent,
    isReinvestment,
    notes,
    balanceBefore,
    balanceAfter,
    approvedBy,
    currentUserId,
    idempotencyKey
  } = params;

  if (amount <= 0) {
    throw new Error('Capital movement amount must be strictly greater than 0.');
  }

  const effectiveAllocId = sourceProfitAllocationId || sourceProfitAllocation;
  const effectiveSettleId = settlementEventId || settlementEvent;

  // Deduplication & Idempotency: Prevent duplicate capital movement records
  if (dbInstance.investorCapitalMovements?.toArray) {
    try {
      const existingMovements: InvestorCapitalMovement[] = await dbInstance.investorCapitalMovements.toArray();
      const duplicate = existingMovements.find(
        (m: any) =>
          (idempotencyKey && m.idempotencyKey === idempotencyKey) ||
          (trancheId && m.trancheId === trancheId && m.movementType === movementType) ||
          (journalEntryId && m.journalEntryId === journalEntryId && m.movementType === movementType)
      );
      if (duplicate) {
        return duplicate;
      }
    } catch {}
  }

  const movementRecord: InvestorCapitalMovement = {
    id: generateUniqueId('cap_mov'),
    investorId,
    participantId: participantId || investorId,
    investorName,
    trancheId,
    movementType,
    amount,
    direction,
    date,
    effectiveDate: effectiveDate || date,
    journalEntryId,
    voucherNumber,
    sourceOrTargetAccountId,
    sourceProfitAllocationId: effectiveAllocId,
    sourceProfitAllocation: effectiveAllocId,
    settlementEventId: effectiveSettleId,
    settlementEvent: effectiveSettleId,
    isReinvestment: isReinvestment ?? (movementType === 'REINVESTED_PROFIT'),
    notes,
    balanceBefore,
    balanceAfter,
    approvedBy,
    createdAt: new Date().toISOString(),
    createdBy: currentUserId,
    idempotencyKey,
    synced: false
  };

  if (dbInstance.investorCapitalMovements) {
    await safeInsert(dbInstance.investorCapitalMovements, movementRecord, { idPrefix: 'cap_mov' });
  }

  return movementRecord;
}

/**
 * Retrieves capital movements, optionally filtered by investor or movement type
 */
export async function getInvestorCapitalMovements(
  options?: {
    investorId?: string;
    movementType?: CapitalMovementType;
    startDate?: string;
    endDate?: string;
  },
  dbInstance: any = db
): Promise<InvestorCapitalMovement[]> {
  if (!dbInstance.investorCapitalMovements) {
    return [];
  }

  let movements: InvestorCapitalMovement[] = await dbInstance.investorCapitalMovements.toArray();

  if (options?.investorId) {
    movements = movements.filter((m) => m.investorId === options.investorId);
  }

  if (options?.movementType) {
    movements = movements.filter((m) => m.movementType === options.movementType);
  }

  if (options?.startDate) {
    movements = movements.filter((m) => m.date >= options.startDate!);
  }

  if (options?.endDate) {
    movements = movements.filter((m) => m.date <= options.endDate!);
  }

  return movements.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Reinvests earned profit into investor capital.
 *
 * Accounting Postings:
 * - Dr 2050 (Investor Profit Payable - Liability Reduction)
 * - Cr 3020 (Investor Capital - Equity Increase)
 *
 * Strict Rule: Reinvested profit must NOT create new profit (zero revenue, zero expense, zero P&L impact).
 */
export async function executeReinvestInvestorProfitTransaction(
  params: {
    investorId: string;
    participantId?: string;
    reinvestAmount: number;
    contractualProfitSharePercentage?: number;
    date?: string;
    effectiveDate?: string;
    sourceProfitAllocationId?: string;
    sourceProfitAllocation?: string;
    settlementEventId?: string;
    settlementEvent?: string;
    currentUserId: string;
    notes?: string;
  },
  dbInstance: any = db
): Promise<{
  investor: Investor;
  tranche?: InvestmentTranche;
  movement: InvestorCapitalMovement;
  journalEntryId: string;
}> {
  const {
    investorId,
    participantId,
    reinvestAmount,
    contractualProfitSharePercentage,
    date = new Date().toISOString().split('T')[0],
    effectiveDate = date,
    sourceProfitAllocationId,
    sourceProfitAllocation,
    settlementEventId,
    settlementEvent,
    currentUserId,
    notes
  } = params;

  if (reinvestAmount <= 0) {
    throw new Error('Reinvestment amount must be strictly greater than 0.');
  }

  const effectiveAlloc = sourceProfitAllocationId || sourceProfitAllocation || `alloc_${investorId}_${effectiveDate}`;
  const effectiveSettle = settlementEventId || settlementEvent || `settle_${investorId}_${effectiveDate}`;
  const effectiveParticipantId = participantId || investorId;

  const investor = await dbInstance.investors.get(investorId);
  if (!investor) {
    throw new Error(`Investor not found: ${investorId}`);
  }

  const payable = Number(investor.profitPayable || 0);
  if (reinvestAmount > payable) {
    throw new Error(
      `পুনর্বিনিয়োগের পরিমাণ বিদ্যমান লভ্যাংশ প্রদেয়ের চেয়ে বেশি হতে পারে না (Reinvest amount ৳${reinvestAmount} exceeds profit payable ৳${payable})।`
    );
  }

  const payableGlCode = CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE; // 2050
  const equityGlCode = CANONICAL_ACCOUNTS.INVESTOR_CAPITAL; // 3020

  const accounts = await dbInstance.accounts.toArray();
  const payableAcc = accounts.find((a: any) => a.code === payableGlCode) || {
    id: `acc_${payableGlCode}`,
    code: payableGlCode,
    nameBn: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয় (Investor Profit Payable)',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
    id: `acc_${equityGlCode}`,
    code: equityGlCode,
    nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('REINV-V');
  const journalId = generateUniqueId('j_reinv');

  const lines: JournalLine[] = [
    {
      accountId: payableAcc.id,
      accountCode: payableGlCode,
      accountName: payableAcc.nameBn,
      debit: reinvestAmount,
      credit: 0,
      memo: `বণ্টনকৃত লভ্যাংশ হতে মূলধনে রূপান্তর (${investor.name})`
    },
    {
      accountId: equityAcc.id,
      accountCode: equityGlCode,
      accountName: equityAcc.nameBn,
      debit: 0,
      credit: reinvestAmount,
      memo: `${investor.name} লভ্যাংশ পুনর্বিনিয়োগ মূলধন সংযোজন`,
      investorId
    }
  ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'JOURNAL',
      date,
      narration: notes || `বিনিয়োগকারীর লভ্যাংশ পুনর্বিনিয়োগ: ${investor.name} ৳${reinvestAmount}`,
      reference: `REINV-${investorId.slice(0, 8)}`,
      relatedPerson: investor.name,
      investorId,
      lines,
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance, accounts }
  );

  const balanceBefore = Number(investor.currentCapitalBalance || investor.currentCapital || investor.capitalAmount || 0);
  const balanceAfter = Math.round((balanceBefore + reinvestAmount) * 100) / 100;
  const newPayable = Math.round((payable - reinvestAmount) * 100) / 100;

  // Update investor record
  await dbInstance.investors.update(investor.id, {
    profitPayable: newPayable,
    capitalAmount: balanceAfter,
    capitalContributed: balanceAfter,
    currentCapital: balanceAfter,
    totalInvestment: balanceAfter,
    currentCapitalBalance: balanceAfter,
    currentBalance: balanceAfter,
    currentEquityBalance: balanceAfter
  });

  // Create Tranche for Reinvested Capital if tranches supported
  let createdTranche: InvestmentTranche | undefined;
  if (dbInstance.investmentTranches) {
    const tId = generateUniqueId('tranche');
    const tNum = generateTransactionNumber('TR-REINV');
    const shareRate = contractualProfitSharePercentage ?? investor.profitSharingRatio ?? 40;

    createdTranche = {
      id: tId,
      trancheId: tId,
      trancheNumber: tNum,
      investorId,
      participantId: effectiveParticipantId,
      investorName: investor.name,
      investmentAmount: reinvestAmount,
      amount: reinvestAmount,
      originalCapital: reinvestAmount,
      investmentDate: date,
      effectiveDate,
      effectiveInvestmentDate: effectiveDate,
      contractualProfitSharePercentage: shareRate,
      currency: 'BDT',
      status: 'ACTIVE',
      creationTimestamp: new Date().toISOString(),
      currentCapital: reinvestAmount,
      currentCapitalBalance: reinvestAmount,
      totalCapitalReturned: 0,
      journalEntryId: journalId,
      sourceProfitAllocationId: effectiveAlloc,
      sourceProfitAllocation: effectiveAlloc,
      settlementEventId: effectiveSettle,
      settlementEvent: effectiveSettle,
      isReinvestment: true,
      sourceType: 'PROFIT_REINVESTMENT',
      notes: notes || `লভ্যাংশ পুনর্বিনিয়োগ কিস্তি (Allocation: ${effectiveAlloc}, Settlement: ${effectiveSettle})`,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
      synced: false
    };
    await safeInsert(dbInstance.investmentTranches, createdTranche, { idPrefix: 'tranche' });
  }

  // Record movement in dedicated ledger
  const movement = await recordCapitalMovement(
    {
      investorId,
      participantId: effectiveParticipantId,
      investorName: investor.name,
      trancheId: createdTranche?.id,
      movementType: 'REINVESTED_PROFIT',
      amount: reinvestAmount,
      direction: 'INFLOW',
      date,
      effectiveDate,
      journalEntryId: journalId,
      voucherNumber,
      sourceOrTargetAccountId: payableAcc.id,
      sourceProfitAllocationId: effectiveAlloc,
      sourceProfitAllocation: effectiveAlloc,
      settlementEventId: effectiveSettle,
      settlementEvent: effectiveSettle,
      isReinvestment: true,
      notes: notes || `লভ্যাংশ পুনর্বিনিয়োগ মূলধন বৃদ্ধি (Settlement: ${effectiveSettle})`,
      balanceBefore,
      balanceAfter,
      currentUserId
    },
    dbInstance
  );

  const updatedInvestor = await dbInstance.investors.get(investorId);

  return {
    investor: updatedInvestor,
    tranche: createdTranche,
    movement,
    journalEntryId: journalId
  };
}

/**
 * Records an approved capital adjustment (e.g. partner restructuring or capital reclassification).
 */
export async function executeApprovedCapitalAdjustmentTransaction(
  params: {
    investorId: string;
    adjustmentAmount: number;
    direction: 'INFLOW' | 'OUTFLOW';
    approvedBy: string;
    date?: string;
    currentUserId: string;
    notes: string;
  },
  dbInstance: any = db
): Promise<{
  investor: Investor;
  movement: InvestorCapitalMovement;
  journalEntryId: string;
}> {
  const {
    investorId,
    adjustmentAmount,
    direction,
    approvedBy,
    date = new Date().toISOString().split('T')[0],
    currentUserId,
    notes
  } = params;

  if (adjustmentAmount <= 0) {
    throw new Error('Adjustment amount must be strictly greater than 0.');
  }

  const investor = await dbInstance.investors.get(investorId);
  if (!investor) {
    throw new Error(`Investor not found: ${investorId}`);
  }

  const balanceBefore = Number(investor.currentCapitalBalance || investor.capitalAmount || 0);
  const balanceAfter =
    direction === 'INFLOW'
      ? Math.round((balanceBefore + adjustmentAmount) * 100) / 100
      : Math.round((balanceBefore - adjustmentAmount) * 100) / 100;

  if (direction === 'OUTFLOW' && balanceAfter < 0) {
    throw new Error('Adjustment cannot reduce investor capital balance below zero.');
  }

  const equityGlCode = CANONICAL_ACCOUNTS.INVESTOR_CAPITAL; // 3020
  const accounts = await dbInstance.accounts.toArray();
  const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
    id: `acc_${equityGlCode}`,
    code: equityGlCode,
    nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const adjGlCode = CANONICAL_ACCOUNTS.RETAINED_EARNINGS || '3050';
  const adjAcc = accounts.find((a: any) => a.code === adjGlCode) || {
    id: `acc_${adjGlCode}`,
    code: adjGlCode,
    nameBn: 'সংরক্ষিত আয় / পুনর্গঠন সমন্বয়',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('ADJ-V');
  const journalId = generateUniqueId('j_adj');

  const lines: JournalLine[] =
    direction === 'INFLOW'
      ? [
          {
            accountId: adjAcc.id,
            accountCode: adjGlCode,
            accountName: adjAcc.nameBn,
            debit: adjustmentAmount,
            credit: 0,
            memo: `অনুমোদিত মূলধন সমন্বয় সংযোজন (${investor.name})`
          },
          {
            accountId: equityAcc.id,
            accountCode: equityGlCode,
            accountName: equityAcc.nameBn,
            debit: 0,
            credit: adjustmentAmount,
            memo: `${investor.name} মূলধন বৃদ্ধি`,
            investorId
          }
        ]
      : [
          {
            accountId: equityAcc.id,
            accountCode: equityGlCode,
            accountName: equityAcc.nameBn,
            debit: adjustmentAmount,
            credit: 0,
            memo: `${investor.name} মূলধন হ্রাস`,
            investorId
          },
          {
            accountId: adjAcc.id,
            accountCode: adjGlCode,
            accountName: adjAcc.nameBn,
            debit: 0,
            credit: adjustmentAmount,
            memo: `অনুমোদিত মূলধন সমন্বয় কর্তন (${investor.name})`
          }
        ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'JOURNAL',
      date,
      narration: `অনুমোদিত মূলধন সমন্বয়: ${investor.name} ৳${adjustmentAmount} (${notes})`,
      reference: `ADJ-${investorId.slice(0, 8)}`,
      relatedPerson: investor.name,
      investorId,
      lines,
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance, accounts }
  );

  await dbInstance.investors.update(investor.id, {
    capitalAmount: balanceAfter,
    capitalContributed: balanceAfter,
    currentCapitalBalance: balanceAfter,
    currentBalance: balanceAfter,
    currentEquityBalance: balanceAfter
  });

  const movement = await recordCapitalMovement(
    {
      investorId,
      investorName: investor.name,
      movementType: 'ADJUSTMENT',
      amount: adjustmentAmount,
      direction,
      date,
      journalEntryId: journalId,
      voucherNumber,
      notes,
      balanceBefore,
      balanceAfter,
      approvedBy,
      currentUserId
    },
    dbInstance
  );

  const updatedInvestor = await dbInstance.investors.get(investorId);

  return {
    investor: updatedInvestor,
    movement,
    journalEntryId: journalId
  };
}

// Convenient aliases
export const recordReinvestedProfitAsCapital = executeReinvestInvestorProfitTransaction;
export const recordCapitalAdjustment = executeApprovedCapitalAdjustmentTransaction;

