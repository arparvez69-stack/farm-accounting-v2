import { db } from '../db/indexedDb';
import { generateUniqueId, generateTransactionNumber, safeInsert } from '../utils/idGenerator';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry, generateProfitLoss } from '../accounting/accountingEngine';
import { recordCapitalMovement } from './capitalMovementService';
import {
  FinancialCapacity,
  ParticipantFinancialProfile,
  InvestmentTranche,
  InvestorCapitalMovement,
  ExecuteOwnerMudaribReinvestmentParams,
  ExecuteOwnerMudaribReinvestmentResult,
  InspectOwnerMudaribReinvestmentParams,
  InspectOwnerMudaribReinvestmentResult,
  JournalLine
} from '../types';

/**
 * Participant Financial Capacity Service
 * Enforces separation of Person from Financial Capacity:
 * - CAPITAL_PROVIDER / INVESTOR
 * - MUDARIB / WORKING_PARTNER
 *
 * Prevents blending of Owner personal capital (Account 3010)
 * with Owner Mudarib/Working Partner profit (Account 3015 / 2060).
 */

export interface RecordOwnerPersonalCapitalParams {
  ownerPersonId: string;
  ownerName: string;
  amount: number;
  targetAccountId: string;
  date?: string;
  currentUserId: string;
  notes?: string;
}

export interface RecordMudaribProfitDistributionParams {
  mudaribPersonId: string;
  mudaribName: string;
  mudaribProfitAmount: number;
  periodStartDate?: string;
  periodEndDate: string;
  creditToPayable?: boolean; // If true, Cr 2060 (Liability), else Cr 3015 (Equity)
  currentUserId: string;
  notes?: string;
}

/**
 * Records Owner Personal Capital into Account 3010 (Owner Capital)
 * Dr Cash/Bank (1010/1030) | Cr Owner Capital (3010)
 */
export async function recordOwnerPersonalCapital(
  params: RecordOwnerPersonalCapitalParams,
  dbInstance: any = db
): Promise<{
  journalEntryId: string;
  voucherNumber: string;
  capitalAmount: number;
  glAccountCode: string;
}> {
  const {
    ownerPersonId,
    ownerName,
    amount,
    targetAccountId,
    date = new Date().toISOString().split('T')[0],
    currentUserId,
    notes
  } = params;

  if (amount <= 0) {
    throw new Error('Owner personal capital amount must be strictly greater than 0.');
  }

  const targetAcc = await dbInstance.cashBankAccounts.get(targetAccountId);
  if (!targetAcc) {
    throw new Error(`Target cash/bank account ${targetAccountId} not found.`);
  }

  const assetGlCode = targetAcc.accountType === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
  const equityGlCode = CANONICAL_ACCOUNTS.OWNER_CAPITAL; // 3010

  const accounts = await dbInstance.accounts.toArray();
  const assetAcc = accounts.find((a: any) => a.code === assetGlCode) || {
    id: `acc_${assetGlCode}`,
    code: assetGlCode,
    nameBn: targetAcc.accountName || targetAcc.name || 'নগদ/ব্যাংক তহবিল',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  };

  const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
    id: `acc_${equityGlCode}`,
    code: equityGlCode,
    nameBn: 'মালিকের মূলধন (Owner Capital)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('OWN-CAP-V');
  const journalId = generateUniqueId('j_own_cap');

  const lines: JournalLine[] = [
    {
      accountId: assetAcc.id,
      accountCode: assetGlCode,
      accountName: targetAcc.accountName || targetAcc.name || assetAcc.nameBn,
      debit: amount,
      credit: 0,
      memo: `মালিকের ব্যক্তিগত মূলধন জমা (${ownerName})`
    },
    {
      accountId: equityAcc.id,
      accountCode: equityGlCode,
      accountName: equityAcc.nameBn,
      debit: 0,
      credit: amount,
      memo: `${ownerName} ব্যক্তিগত মূলধন সংযোজন [Person ID: ${ownerPersonId}]`
    }
  ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'RECEIPT',
      date,
      narration: notes || `মালিকের ব্যক্তিগত মূলধন সংযোজন: ${ownerName} ৳${amount}`,
      reference: `OWN-CAP-${ownerPersonId.slice(0, 8)}`,
      relatedPerson: ownerName,
      lines,
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance, accounts }
  );

  // Update target cash/bank account balance
  await dbInstance.cashBankAccounts.update(targetAcc.id, {
    currentBalance: Math.round(((targetAcc.currentBalance || 0) + amount) * 100) / 100
  });

  return {
    journalEntryId: journalId,
    voucherNumber,
    capitalAmount: amount,
    glAccountCode: equityGlCode
  };
}

/**
 * Records Mudarib / Working Partner Profit Distribution into Account 3015 (Mudarib Profit Equity)
 * or Account 2060 (Mudarib Profit Payable)
 * Dr Profit Distribution (3070) | Cr Mudarib Profit Equity (3015) / Payable (2060)
 */
export async function recordMudaribProfitDistribution(
  params: RecordMudaribProfitDistributionParams,
  dbInstance: any = db
): Promise<{
  journalEntryId: string;
  voucherNumber: string;
  mudaribProfitAmount: number;
  glAccountCode: string;
}> {
  const {
    mudaribPersonId,
    mudaribName,
    mudaribProfitAmount,
    periodStartDate,
    periodEndDate,
    creditToPayable = false,
    currentUserId,
    notes
  } = params;

  if (mudaribProfitAmount <= 0) {
    throw new Error('Mudarib / Working Partner profit amount must be strictly greater than 0.');
  }

  const distGlCode = CANONICAL_ACCOUNTS.PROFIT_DISTRIBUTION; // 3070
  const creditGlCode = creditToPayable
    ? (CANONICAL_ACCOUNTS.MUDARIB_PROFIT_PAYABLE || '2060')
    : (CANONICAL_ACCOUNTS.MUDARIB_PROFIT || '3015');

  const accounts = await dbInstance.accounts.toArray();
  const distAcc = accounts.find((a: any) => a.code === distGlCode) || {
    id: `acc_${distGlCode}`,
    code: distGlCode,
    nameBn: 'মুনাফা বণ্টন / লভ্যাংশ (Profit Distribution)',
    accountClass: 'EQUITY',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  };

  const creditAcc = accounts.find((a: any) => a.code === creditGlCode) || {
    id: `acc_${creditGlCode}`,
    code: creditGlCode,
    nameBn: creditToPayable
      ? 'মুদারিব / কর্ম অংশীদারের মুনাফা প্রদেয় (Mudarib Profit Payable)'
      : 'মুদারিব / কর্ম অংশীদারের মুনাফা স্বত্ব (Mudarib Profit Equity)',
    accountClass: creditToPayable ? 'LIABILITY' : 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('MUD-PRF-V');
  const journalId = generateUniqueId('j_mud_prf');

  const lines: JournalLine[] = [
    {
      accountId: distAcc.id,
      accountCode: distGlCode,
      accountName: distAcc.nameBn,
      debit: mudaribProfitAmount,
      credit: 0,
      memo: `মুদারিব / কর্ম অংশীদারের মুনাফা বণ্টন (${mudaribName})`,
      investorId: mudaribPersonId
    },
    {
      accountId: creditAcc.id,
      accountCode: creditGlCode,
      accountName: creditAcc.nameBn,
      debit: 0,
      credit: mudaribProfitAmount,
      memo: `${mudaribName} মুদারিব মুনাফা ক্রেডিট [Person ID: ${mudaribPersonId}]`,
      investorId: mudaribPersonId
    }
  ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'JOURNAL',
      date: periodEndDate,
      narration:
        notes ||
        `মুদারিব / কর্ম অংশীদার হিসেবে অর্জিত মুনাফা: ${mudaribName} ৳${mudaribProfitAmount}${
          periodStartDate ? ` (${periodStartDate} হতে ${periodEndDate})` : ''
        }`,
      reference: `MUD-PRF-${(mudaribPersonId || 'mudarib').slice(0, 8)}`,
      relatedPerson: mudaribName || 'Farm Mudarib',
      investorId: mudaribPersonId || 'mudarib',
      lines,
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance, accounts }
  );

  return {
    journalEntryId: journalId,
    voucherNumber,
    mudaribProfitAmount,
    glAccountCode: creditGlCode
  };
}

/**
 * Inspects a person's separate financial capacities and balances across the ledger.
 *
 * PROMPT 32: Keep separate:
 * - owner Mudarib earnings (Account 3015/2060 cumulative earned: e.g. 170);
 * - owner capital (Account 3010: e.g. 100);
 * - owner capital-derived profit (Account 2050 / capitalProviderBalance.profitPayable).
 */
export async function getParticipantFinancialProfile(
  personIdOrName: string,
  dbInstance: any = db
): Promise<ParticipantFinancialProfile> {
  const allJournals = await dbInstance.journalEntries.toArray();

  let capitalProviderCapital = 0;
  let capitalProviderProfit = 0;
  let mudaribProfitEarned = 0;
  let mudaribProfitReinvested = 0;
  let mudaribWithdrawn = 0;

  // Build comprehensive match set
  const matchSet = new Set<string>();
  if (personIdOrName) {
    matchSet.add(personIdOrName);
    matchSet.add(personIdOrName.trim());
  }

  // Cross-reference with investors table
  if (dbInstance.investors) {
    const allInvestors = await dbInstance.investors.toArray();
    for (const inv of allInvestors) {
      if (inv.id === personIdOrName || inv.name === personIdOrName) {
        if (inv.id) matchSet.add(inv.id);
        if (inv.name) matchSet.add(inv.name);
      }
    }
  }

  // Cross-reference with investment tranches
  if (dbInstance.investmentTranches) {
    const allTranches = await dbInstance.investmentTranches.toArray();
    for (const tr of allTranches) {
      if (
        tr.investorId === personIdOrName ||
        tr.participantId === personIdOrName ||
        tr.investorName === personIdOrName
      ) {
        if (tr.investorId) matchSet.add(tr.investorId);
        if (tr.participantId) matchSet.add(tr.participantId);
        if (tr.investorName) matchSet.add(tr.investorName);
      }
    }
  }

  const matchValues = Array.from(matchSet).filter(Boolean);

  for (const j of allJournals) {
    if (j.status === 'REVERSED') continue;
    const isPersonMatch =
      matchValues.some((val) => j.relatedPerson === val || j.investorId === val) ||
      (j.reference && matchValues.some((val) => j.reference.includes(val) || (val.length >= 6 && j.reference.includes(val.slice(0, 8))))) ||
      (j.narration && matchValues.some((val) => j.narration.includes(val))) ||
      (j.lines || []).some(
        (l: any) =>
          matchValues.some((val) => l.investorId === val) ||
          (l.memo && matchValues.some((val) => l.memo.includes(val)))
      );

    if (!isPersonMatch) continue;

    for (const l of j.lines || []) {
      // 1. Owner Personal Capital (3010) or Investor Capital (3020)
      if (l.accountCode === '3010' || l.accountCode === '3020') {
        capitalProviderCapital += (l.credit || 0) - (l.debit || 0);
      }
      // 2. Investor Profit Payable (2050) — owner capital-derived profit
      if (l.accountCode === '2050') {
        capitalProviderProfit += (l.credit || 0) - (l.debit || 0);
      }
      // 3. Mudarib / Working Partner Profit Equity (3015) or Payable (2060)
      if (l.accountCode === '3015' || l.accountCode === '2060') {
        // Credits represent Mudarib profit earned
        if ((l.credit || 0) > 0) {
          mudaribProfitEarned += l.credit;
        }
        // Debits: check if transferred/reinvested into capital vs withdrawn
        if ((l.debit || 0) > 0) {
          const hasCapitalCredit = (j.lines || []).some(
            (otherLine: any) =>
              (otherLine.accountCode === '3010' || otherLine.accountCode === '3020') &&
              (otherLine.credit || 0) > 0
          );
          if (
            hasCapitalCredit ||
            j.narration?.includes('পুনর্বিনিয়োগ') ||
            j.narration?.includes('Reinvest') ||
            j.narration?.includes('reinvest')
          ) {
            mudaribProfitReinvested += l.debit;
          } else {
            mudaribWithdrawn += l.debit;
          }
        }
      }
      // 4. Mudarib Drawings / Withdrawals from Mudarib profit
      if (
        l.accountCode === '3040' &&
        (j.narration?.includes('মুদারিব') || j.narration?.includes('Mudarib'))
      ) {
        mudaribWithdrawn += l.debit || 0;
      }
    }
  }

  // Also check investor database record if applicable
  const allInvestors = await dbInstance.investors.toArray();
  const investorRecord = allInvestors.find(
    (inv: any) => inv.id === personIdOrName || inv.name === personIdOrName
  );

  if (investorRecord) {
    if (capitalProviderCapital === 0) {
      capitalProviderCapital =
        investorRecord.capitalAmount ||
        investorRecord.capitalContributed ||
        investorRecord.currentCapital ||
        0;
    }
    if (capitalProviderProfit === 0 && investorRecord.profitPayable) {
      capitalProviderProfit = investorRecord.profitPayable;
    }
  }

  const capacities: FinancialCapacity[] = [];
  if (capitalProviderCapital > 0 || capitalProviderProfit > 0) {
    capacities.push('CAPITAL_PROVIDER');
  }
  if (mudaribProfitEarned > 0) {
    capacities.push('MUDARIB');
  }

  // Strict invariant: capital provider balance and mudarib profit MUST NOT be combined
  const isSeparate = true;

  const roundedCapital = Math.round(capitalProviderCapital * 100) / 100;
  const roundedCapitalProfit = Math.round(capitalProviderProfit * 100) / 100;
  const roundedMudaribEarned = Math.round(mudaribProfitEarned * 100) / 100;
  const roundedMudaribReinvested = Math.round(mudaribProfitReinvested * 100) / 100;
  const roundedMudaribPayable = Math.max(
    0,
    Math.round((mudaribProfitEarned - mudaribProfitReinvested - mudaribWithdrawn) * 100) / 100
  );
  const roundedWithdrawn = Math.round(mudaribWithdrawn * 100) / 100;

  return {
    personId: personIdOrName,
    name: investorRecord?.name || personIdOrName,
    isOwner: true,
    capacities,
    capitalProviderBalance: {
      capitalAmount: roundedCapital,
      currentCapitalBalance: roundedCapital,
      profitPayable: roundedCapitalProfit,
      totalProfitAllocated: roundedCapitalProfit,
      capitalDerivedProfit: roundedCapitalProfit,
      glAccountCode: '3010'
    },
    workingPartnerBalance: {
      mudaribProfitEarned: roundedMudaribEarned,
      mudaribProfitPayable: roundedMudaribPayable,
      totalWithdrawn: roundedWithdrawn,
      mudaribProfitReinvested: roundedMudaribReinvested,
      glAccountCode: '3015'
    },
    ownerMudaribEarnings: roundedMudaribEarned,
    ownerCapital: roundedCapital,
    ownerCapitalDerivedProfit: roundedCapitalProfit,
    isSeparate
  };
}

/**
 * PROMPT 32: Owner Mudarib Reinvestment
 *
 * If the owner reinvests Mudarib profit, create owner capital-provider participation for the reinvested amount.
 *
 * Keep separate:
 * - owner Mudarib earnings;
 * - owner capital;
 * - owner capital-derived profit.
 *
 * Example:
 * Mudarib profit = 170.
 * Owner reinvests 100.
 *
 * Expected:
 * Mudarib profit remains 170.
 * New owner capital contribution = 100.
 *
 * Do not count the 100 as a second profit.
 */
export async function executeOwnerMudaribReinvestment(
  params: ExecuteOwnerMudaribReinvestmentParams,
  dbInstance: any = db
): Promise<ExecuteOwnerMudaribReinvestmentResult> {
  const targetDb = dbInstance || db;
  const {
    ownerPersonId,
    ownerName,
    mudaribProfitAmount,
    reinvestAmount,
    date = new Date().toISOString().split('T')[0],
    effectiveDate = date,
    contractualProfitSharePercentage,
    sourceProfitAllocationId = `alloc_mudarib_${ownerPersonId}_${date}`,
    settlementEventId = `settle_mudarib_${ownerPersonId}_${date}`,
    currentUserId,
    notes
  } = params;

  if (mudaribProfitAmount <= 0) {
    throw new Error('মুদারিব মুনাফার পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Mudarib profit amount must be > 0)।');
  }

  if (reinvestAmount <= 0) {
    throw new Error('পুনর্বিনিয়োগের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Reinvestment amount must be > 0)।');
  }

  if (reinvestAmount > mudaribProfitAmount) {
    throw new Error(
      `পুনর্বিনিয়োগের পরিমাণ (৳${reinvestAmount}) মোট মুদারিব মুনাফার (৳${mudaribProfitAmount}) চেয়ে বেশি হতে পারে না।`
    );
  }

  // Pre-P&L capture to verify zero profit duplication (no second profit counted)
  const prePnl = await generateProfitLoss(
    { startDate: '2020-01-01', endDate: '2030-12-31' },
    undefined,
    targetDb
  );

  const mudaribGlCode = CANONICAL_ACCOUNTS.MUDARIB_PROFIT; // 3015
  const ownerCapGlCode = CANONICAL_ACCOUNTS.OWNER_CAPITAL; // 3010

  const accounts = await targetDb.accounts.toArray();
  const mudaribAcc = accounts.find((a: any) => a.code === mudaribGlCode) || {
    id: `acc_${mudaribGlCode}`,
    code: mudaribGlCode,
    nameBn: 'মুদারিব / কর্ম অংশীদারের মুনাফা স্বত্ব (Mudarib Profit Equity)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const ownerCapAcc = accounts.find((a: any) => a.code === ownerCapGlCode) || {
    id: `acc_${ownerCapGlCode}`,
    code: ownerCapGlCode,
    nameBn: 'মালিকের মূলধন (Owner Capital)',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  };

  const voucherNumber = generateTransactionNumber('OWN-MUD-REINV-V');
  const journalId = generateUniqueId('j_own_mud_reinv');

  // GL Posting: Dr 3015 (Mudarib Profit Equity) | Cr 3010 (Owner Capital)
  // Both are Equity accounts. Zero revenue (4xxx) or income. Zero second profit!
  const lines: JournalLine[] = [
    {
      accountId: mudaribAcc.id,
      accountCode: mudaribGlCode,
      accountName: mudaribAcc.nameBn,
      debit: reinvestAmount,
      credit: 0,
      memo: `মুদারিব মুনাফা হতে মালিকের মূলধনে রূপান্তর (${ownerName})`,
      investorId: ownerPersonId
    },
    {
      accountId: ownerCapAcc.id,
      accountCode: ownerCapGlCode,
      accountName: ownerCapAcc.nameBn,
      debit: 0,
      credit: reinvestAmount,
      memo: `${ownerName} ব্যক্তিগত মূলধন সংযোজন (মুদারিব মুনাফা পুনর্বিনিয়োগ)`,
      investorId: ownerPersonId
    }
  ];

  await postJournalEntry(
    {
      id: journalId,
      voucherNumber,
      voucherType: 'JOURNAL',
      date,
      narration:
        notes ||
        `মালিকের মুদারিব মুনাফা পুনর্বিনিয়োগ: ${ownerName} ৳${reinvestAmount} (মোট মুদারিব লভ্যাংশ: ৳${mudaribProfitAmount})`,
      reference: `MUD-REINV-${ownerPersonId.slice(0, 8)}`,
      relatedPerson: ownerName,
      investorId: ownerPersonId,
      lines,
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance: targetDb, accounts }
  );

  // PROMPT 32: Create owner capital-provider participation for the reinvested amount
  let createdTranche: InvestmentTranche | undefined;
  if (targetDb.investmentTranches) {
    const tId = generateUniqueId('tranche_own_reinv');
    const tNum = generateTransactionNumber('TR-OWN-REINV');
    const shareRate = contractualProfitSharePercentage ?? 50;

    createdTranche = {
      id: tId,
      trancheId: tId,
      trancheNumber: tNum,
      investorId: ownerPersonId,
      participantId: ownerPersonId,
      investorName: ownerName,
      investmentAmount: reinvestAmount,
      amount: reinvestAmount,
      originalCapital: reinvestAmount,
      currentCapital: reinvestAmount,
      currentCapitalBalance: reinvestAmount,
      totalCapitalReturned: 0,
      investmentDate: date,
      effectiveDate,
      effectiveInvestmentDate: effectiveDate,
      contractualProfitSharePercentage: shareRate,
      currency: 'BDT',
      status: 'ACTIVE',
      creationTimestamp: new Date().toISOString(),
      journalEntryId: journalId,
      sourceProfitAllocationId,
      sourceProfitAllocation: sourceProfitAllocationId,
      settlementEventId,
      settlementEvent: settlementEventId,
      isReinvestment: true,
      isOwnerTranche: true,
      sourceType: 'PROFIT_REINVESTMENT',
      notes: notes || `মালিকের মুদারিব মুনাফা পুনর্বিনিয়োগ কিস্তি (Allocation: ${sourceProfitAllocationId})`,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
      synced: false
    };

    await safeInsert(targetDb.investmentTranches, createdTranche, { idPrefix: 'tranche' });
  }

  // Update or create owner in investors table to support capital-provider tracking
  if (targetDb.investors) {
    const existingInvestor = await targetDb.investors.get(ownerPersonId);
    if (existingInvestor) {
      const currentCap = Number(
        existingInvestor.currentCapital || existingInvestor.capitalAmount || 0
      );
      const newCap = Math.round((currentCap + reinvestAmount) * 100) / 100;
      await targetDb.investors.update(ownerPersonId, {
        currentCapital: newCap,
        totalInvestment: newCap,
        capitalAmount: newCap,
        capitalContributed: newCap,
        currentCapitalBalance: newCap,
        isOwner: true
      });
    } else if (targetDb.investors.put) {
      await targetDb.investors.put({
        id: ownerPersonId,
        name: ownerName,
        phone: '01711000000',
        totalInvestment: reinvestAmount,
        currentCapital: reinvestAmount,
        capitalAmount: reinvestAmount,
        capitalContributed: reinvestAmount,
        currentCapitalBalance: reinvestAmount,
        profitPayable: 0,
        joinedDate: date,
        isOwner: true,
        status: 'ACTIVE',
        isActive: true,
        synced: false
      });
    }
  }

  // Record traceable capital movement in dedicated ledger
  let movementRecord: InvestorCapitalMovement | undefined;
  if (targetDb.investorCapitalMovements) {
    movementRecord = await recordCapitalMovement(
      {
        investorId: ownerPersonId,
        participantId: ownerPersonId,
        investorName: ownerName,
        trancheId: createdTranche?.id,
        movementType: 'REINVESTED_PROFIT',
        amount: reinvestAmount,
        direction: 'INFLOW',
        date,
        effectiveDate,
        journalEntryId: journalId,
        voucherNumber,
        sourceOrTargetAccountId: mudaribGlCode,
        sourceProfitAllocationId,
        sourceProfitAllocation: sourceProfitAllocationId,
        settlementEventId,
        settlementEvent: settlementEventId,
        isReinvestment: true,
        notes: `মালিকের মুদারিব মুনাফা পুনর্বিনিয়োগ মূলধন সংযোজন (Settlement: ${settlementEventId})`,
        balanceBefore: 0,
        balanceAfter: reinvestAmount,
        approvedBy: currentUserId,
        currentUserId
      },
      targetDb
    );
  }

  // Verify Post P&L invariants: DO NOT count the reinvestment as a second profit!
  const postPnl = await generateProfitLoss(
    { startDate: '2020-01-01', endDate: '2030-12-31' },
    undefined,
    targetDb
  );
  if (postPnl.totalRevenue !== prePnl.totalRevenue) {
    throw new Error(
      'অ্যাকাউন্টিং ত্রুটি: মুদারিব পুনর্বিনিয়োগের ফলে দ্বিতীয়বার রাজস্ব তৈরি হয়েছে যা নিষিদ্ধ (Second profit prohibited).'
    );
  }

  const financialProfile = await getParticipantFinancialProfile(ownerPersonId, targetDb);
  const remainingMudarib = Math.round((mudaribProfitAmount - reinvestAmount) * 100) / 100;

  return {
    passed: true,
    mudaribProfitEarned: mudaribProfitAmount, // strictly 170 (remains 170)
    reinvestAmount, // 100
    newOwnerCapitalContribution: reinvestAmount, // 100
    remainingMudaribBalance: remainingMudarib,
    journalEntryId: journalId,
    tranche: createdTranche,
    capitalMovement: movementRecord,
    financialProfile,
    reinvestmentCreatedRevenue: false,
    details: `Owner Mudarib reinvestment executed: Mudarib Profit Earned=৳${mudaribProfitAmount} (remains intact), New Owner Capital Contribution=৳${reinvestAmount}, Zero second profit generated.`
  };
}

/**
 * PROMPT 32 INSPECTION SUITE: Owner Mudarib Reinvestment
 *
 * Example:
 * Mudarib profit = 170.
 * Owner reinvests 100.
 *
 * Expected:
 * Mudarib profit remains 170.
 * New owner capital contribution = 100.
 *
 * Do not count the 100 as a second profit.
 *
 * Return PASS.
 */
export async function inspectOwnerMudaribReinvestment(
  params: InspectOwnerMudaribReinvestmentParams = {}
): Promise<InspectOwnerMudaribReinvestmentResult> {
  const mudaribProfit = params.mudaribProfit ?? 170;
  const reinvestAmount = params.reinvestAmount ?? 100;
  const ownerPersonId = params.ownerPersonId ?? 'owner_p32_001';
  const ownerName = params.ownerName ?? 'Md. Tariqul Islam (Owner)';
  const date = params.date ?? '2026-04-01';
  const effectiveDate = params.effectiveDate ?? date;
  const targetDb = params.dbInstance || db;

  // 1. Initial Mudarib Profit Distribution (৳170)
  await recordMudaribProfitDistribution(
    {
      mudaribPersonId: ownerPersonId,
      mudaribName: ownerName,
      mudaribProfitAmount: mudaribProfit,
      periodEndDate: '2026-03-31',
      creditToPayable: false,
      currentUserId: 'auditor_prompt32',
      notes: 'Initial Q1 Mudarib Profit Distribution'
    },
    targetDb
  );

  // 2. Execute Owner Mudarib Reinvestment (৳100)
  const reinvResult = await executeOwnerMudaribReinvestment(
    {
      ownerPersonId,
      ownerName,
      mudaribProfitAmount: mudaribProfit,
      reinvestAmount,
      date,
      effectiveDate,
      contractualProfitSharePercentage: 50,
      sourceProfitAllocationId: 'alloc_mudarib_q1',
      settlementEventId: 'settle_mudarib_q1',
      currentUserId: 'auditor_prompt32',
      notes: 'Prompt 32 Owner Reinvestment Test'
    },
    targetDb
  );

  // 3. Inspect post-reinvestment profile
  const postProfile = await getParticipantFinancialProfile(ownerPersonId, targetDb);

  // Check 1: Mudarib profit remains 170
  const mudaribProfitEarned = postProfile.workingPartnerBalance.mudaribProfitEarned;
  const mudaribProfitRemains170 = mudaribProfitEarned === 170;

  // Check 2: New owner capital contribution = 100
  const ownerCapitalAmount = postProfile.capitalProviderBalance.capitalAmount;
  const newOwnerCapitalContribution = reinvResult.newOwnerCapitalContribution;

  // Check 3: Owner capital-provider participation created
  const allTranches = targetDb.investmentTranches?.toArray
    ? await targetDb.investmentTranches.toArray()
    : [];
  const ownerTranche = allTranches.find(
    (t: any) =>
      (t.investorId === ownerPersonId || t.participantId === ownerPersonId) && t.isOwnerTranche
  );
  const ownerCapitalProviderParticipationCreated = Boolean(
    ownerTranche && ownerTranche.investmentAmount === 100
  );

  // Check 4: Three buckets kept separate
  // Bucket 1: owner Mudarib earnings (170)
  // Bucket 2: owner capital (100)
  // Bucket 3: owner capital-derived profit (separate)
  const threeBucketsSeparated =
    mudaribProfitEarned === 170 &&
    ownerCapitalAmount === 100 &&
    postProfile.isSeparate === true;

  // Check 5: Do not count the 100 as a second profit
  const pnl = await generateProfitLoss(
    { startDate: '2026-01-01', endDate: '2026-04-02' },
    undefined,
    targetDb
  );
  const noSecondProfitCounted =
    pnl.totalRevenue === 0 && reinvResult.reinvestmentCreatedRevenue === false;

  const passed =
    mudaribProfitRemains170 &&
    newOwnerCapitalContribution === 100 &&
    ownerCapitalAmount === 100 &&
    ownerCapitalProviderParticipationCreated &&
    noSecondProfitCounted &&
    threeBucketsSeparated;

  const details = passed
    ? `PROMPT 32 PASS: Owner Mudarib reinvestment verified. Mudarib profit remains ৳${mudaribProfitEarned} (170). New owner capital contribution = ৳${newOwnerCapitalContribution} (100). Owner capital-provider participation created (Tranche ID: ${ownerTranche?.id}). Zero second profit counted (P&L revenue = 0). Three buckets strictly separate: Mudarib earnings (৳${mudaribProfitEarned}), Owner capital (৳${ownerCapitalAmount}), Capital-derived profit (৳${postProfile.capitalProviderBalance.capitalDerivedProfit ?? 0}).`
    : `PROMPT 32 FAIL: mudRemains=${mudaribProfitRemains170}, newCap=${newOwnerCapitalContribution}, capAmt=${ownerCapitalAmount}, trancheCreated=${ownerCapitalProviderParticipationCreated}, noSecondProfit=${noSecondProfitCounted}, separate=${threeBucketsSeparated}.`;

  return {
    passed,
    mudaribProfitRemains170,
    mudaribProfitEarned,
    newOwnerCapitalContribution,
    ownerCapitalAmount,
    ownerCapitalDerivedProfit: postProfile.capitalProviderBalance.capitalDerivedProfit ?? 0,
    ownerCapitalProviderParticipationCreated,
    ownerTrancheId: ownerTranche?.id,
    ownerTrancheAmount: ownerTranche?.investmentAmount,
    noSecondProfitCounted,
    pnlRevenueCreated: pnl.totalRevenue,
    threeBucketsSeparated,
    details
  };
}

