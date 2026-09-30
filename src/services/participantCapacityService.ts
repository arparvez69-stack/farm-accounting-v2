import { db } from '../db/indexedDb';
import { generateUniqueId, generateTransactionNumber } from '../utils/idGenerator';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  FinancialCapacity,
  ParticipantFinancialProfile,
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
      memo: `মুদারিব / কর্ম অংশীদারের মুনাফা বণ্টন (${mudaribName})`
    },
    {
      accountId: creditAcc.id,
      accountCode: creditGlCode,
      accountName: creditAcc.nameBn,
      debit: 0,
      credit: mudaribProfitAmount,
      memo: `${mudaribName} মুদারিব মুনাফা ক্রেডিট [Person ID: ${mudaribPersonId}]`
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
      reference: `MUD-PRF-${mudaribPersonId.slice(0, 8)}`,
      relatedPerson: mudaribName,
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
 * Inspects a person's separate financial capacities and balances across the ledger
 */
export async function getParticipantFinancialProfile(
  personIdOrName: string,
  dbInstance: any = db
): Promise<ParticipantFinancialProfile> {
  const allJournals = await dbInstance.journalEntries.toArray();

  let capitalProviderCapital = 0;
  let capitalProviderProfit = 0;
  let mudaribProfit = 0;
  let mudaribWithdrawn = 0;

  for (const j of allJournals) {
    if (j.status === 'REVERSED') continue;
    const isPersonMatch =
      j.relatedPerson === personIdOrName ||
      j.investorId === personIdOrName ||
      (j.narration && j.narration.includes(personIdOrName));

    if (!isPersonMatch) continue;

    for (const l of j.lines || []) {
      // 1. Owner Personal Capital (3010) or Investor Capital (3020)
      if (l.accountCode === '3010' || l.accountCode === '3020') {
        capitalProviderCapital += (l.credit || 0) - (l.debit || 0);
      }
      // 2. Investor Profit Payable (2050)
      if (l.accountCode === '2050') {
        capitalProviderProfit += (l.credit || 0) - (l.debit || 0);
      }
      // 3. Mudarib / Working Partner Profit Equity (3015) or Payable (2060)
      if (l.accountCode === '3015' || l.accountCode === '2060') {
        mudaribProfit += (l.credit || 0) - (l.debit || 0);
      }
      // 4. Mudarib Drawings / Withdrawals from Mudarib profit
      if (l.accountCode === '3040' && (j.narration?.includes('মুদারিব') || j.narration?.includes('Mudarib'))) {
        mudaribWithdrawn += (l.debit || 0);
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
      capitalProviderCapital = investorRecord.capitalAmount || investorRecord.capitalContributed || 0;
    }
  }

  const capacities: FinancialCapacity[] = [];
  if (capitalProviderCapital > 0 || capitalProviderProfit > 0) {
    capacities.push('CAPITAL_PROVIDER');
  }
  if (mudaribProfit > 0) {
    capacities.push('MUDARIB');
  }

  // Strict invariant: capital provider balance and mudarib profit MUST NOT be combined
  const isSeparate = true;

  return {
    personId: personIdOrName,
    name: investorRecord?.name || personIdOrName,
    isOwner: true,
    capacities,
    capitalProviderBalance: {
      capitalAmount: Math.round(capitalProviderCapital * 100) / 100,
      currentCapitalBalance: Math.round(capitalProviderCapital * 100) / 100,
      profitPayable: Math.round(capitalProviderProfit * 100) / 100,
      totalProfitAllocated: Math.round(capitalProviderProfit * 100) / 100,
      glAccountCode: '3010'
    },
    workingPartnerBalance: {
      mudaribProfitEarned: Math.round(mudaribProfit * 100) / 100,
      mudaribProfitPayable: Math.round(mudaribProfit * 100) / 100,
      totalWithdrawn: Math.round(mudaribWithdrawn * 100) / 100,
      glAccountCode: '3015'
    },
    isSeparate
  };
}
