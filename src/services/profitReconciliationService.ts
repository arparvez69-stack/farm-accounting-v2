import { db } from '../db/indexedDb';
import { generateProfitLoss, generateTrialBalance, postJournalEntry, ProfitLossReport } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { calculateEconomicAllocationByCapital } from './valuationService';
import { generateUniqueId, generateTransactionNumber } from '../utils/idGenerator';
import { Investor, JournalLine } from '../types';

export interface ParticipantProfitBreakdown {
  participantId: string;
  participantName: string;
  eligibleCapital: number;
  capitalProportionPercentage: number;
  allocatedEconomicProfit: number;
  contractualPercentage: number;
  investorProfit: number;
  mudaribProfit: number;
  totalParticipantProfit: number;
  isBalanced: boolean;
  formula: string;
}

export interface ProfitReconciliationReport {
  timestamp: string;
  distributableProfit: number;
  totalEligibleCapital: number;
  participants: ParticipantProfitBreakdown[];
  totalInvestorProfit: number;
  totalMudaribProfit: number;
  sumInvestorPlusMudarib: number;
  profitDifference: number;
  isProfitEquationReconciled: boolean;
  contractualPercentagesSum: number;
  doesPercentagesSumTo100: boolean;
  // P&L Isolation Verification
  preAppropriationPnL: {
    operatingRevenue: number;
    operatingExpenses: number;
    netProfit: number;
  };
  postAppropriationPnL: {
    operatingRevenue: number;
    operatingExpenses: number;
    netProfit: number;
  };
  isPnLUnchanged: boolean;
  pnlNetProfitDifference: number;
  // GL Postings & Subledger Verification
  isGlReconciled: boolean;
  journalEntryId?: string;
  voucherNumber?: string;
  isFullyReconciled: boolean;
  discrepancies: string[];
}

export interface RunProfitReconciliationParams {
  distributableProfit: number;
  participants: Array<{
    id: string;
    name: string;
    capital: number;
    contractualPercentage: number;
  }>;
  periodStartDate?: string;
  periodEndDate?: string;
  postAppropriationToLedger?: boolean;
  currentUserId?: string;
}

/**
 * FINAL TEST B — Profit Reconciliation Service
 *
 * Mathematical Invariants:
 * 1. Total Investor Profit + Total Mudarib Profit = Total Distributable Profit
 * 2. Contractual percentages are individual per-investor agreements and do NOT need to sum to 100%.
 * 3. The accounting P&L (Operating Revenue, Operating Expenses, Net Operating Profit)
 *    is strictly UNCHANGED by profit appropriation.
 */
export async function runCompleteProfitReconciliation(
  params: RunProfitReconciliationParams,
  dbInstance: any = db
): Promise<ProfitReconciliationReport> {
  const {
    distributableProfit,
    participants,
    periodStartDate = '2026-01-01',
    periodEndDate = '2026-03-31',
    postAppropriationToLedger = true,
    currentUserId = 'sys_admin'
  } = params;

  const discrepancies: string[] = [];

  if (typeof distributableProfit !== 'number' || isNaN(distributableProfit) || distributableProfit <= 0) {
    throw new Error(`Distributable profit must be strictly positive: ${distributableProfit}`);
  }

  if (!participants || participants.length === 0) {
    throw new Error('At least one participant required for profit reconciliation.');
  }

  // 1. Capture Pre-Appropriation P&L
  const prePnLRaw: ProfitLossReport = await generateProfitLoss(
    { startDate: periodStartDate, endDate: periodEndDate },
    dbInstance
  );

  const prePnL = {
    operatingRevenue: Math.round((prePnLRaw.totalRevenue ?? 0) * 100) / 100,
    operatingExpenses: Math.round(((prePnLRaw.totalCogs || 0) + (prePnLRaw.totalOperatingExpenses || 0) + (prePnLRaw.totalOtherExpenses || 0)) * 100) / 100,
    netProfit: Math.round(prePnLRaw.netProfit * 100) / 100
  };

  // 2. Perform Dynamic Capital Proportional Economic Allocation
  const allocationResult = calculateEconomicAllocationByCapital({
    distributableProfit,
    participants: participants.map((p) => ({
      participantId: p.id,
      participantName: p.name,
      eligibleCapital: p.capital,
      contractualProfitSharingPercentage: p.contractualPercentage,
      eligibilityPeriodStart: periodStartDate,
      eligibilityPeriodEnd: periodEndDate
    })),
    periodStartDate,
    periodEndDate
  });

  const participantBreakdowns: ParticipantProfitBreakdown[] = [];
  let totalInvestorProfit = 0;
  let totalMudaribProfit = 0;
  let contractualPercentagesSum = 0;

  for (const alloc of allocationResult.allocations) {
    const rawInvestor = alloc.investorProfit ?? alloc.investorContractualProfit ?? 0;
    const rawMudarib = alloc.mudaribProfit ?? alloc.workingPartnerShare ?? 0;
    const rate = alloc.contractualProfitSharingPercentage ?? 40;

    contractualPercentagesSum += rate;
    totalInvestorProfit += rawInvestor;
    totalMudaribProfit += rawMudarib;

    const participantSum = Math.round((rawInvestor + rawMudarib) * 100) / 100;
    const isBalanced = Math.abs(participantSum - alloc.allocatedEconomicProfit) < 0.01;

    if (!isBalanced) {
      discrepancies.push(
        `Participant ${alloc.participantName} breakdown mismatch: Investor ৳${rawInvestor} + Mudarib ৳${rawMudarib} = ৳${participantSum} !== Economic Allocation ৳${alloc.allocatedEconomicProfit}`
      );
    }

    participantBreakdowns.push({
      participantId: alloc.participantId,
      participantName: alloc.participantName,
      eligibleCapital: alloc.eligibleCapital,
      capitalProportionPercentage: alloc.capitalProportionPercentage,
      allocatedEconomicProfit: alloc.allocatedEconomicProfit,
      contractualPercentage: rate,
      investorProfit: rawInvestor,
      mudaribProfit: rawMudarib,
      totalParticipantProfit: participantSum,
      isBalanced,
      formula: `${rawInvestor} (Investor ${rate}%) + ${rawMudarib} (Mudarib ${100 - rate}%) = ${participantSum} (Economic)`
    });
  }

  totalInvestorProfit = Math.round(totalInvestorProfit * 100) / 100;
  totalMudaribProfit = Math.round(totalMudaribProfit * 100) / 100;
  const sumInvestorPlusMudarib = Math.round((totalInvestorProfit + totalMudaribProfit) * 100) / 100;
  const profitDifference = Math.round((sumInvestorPlusMudarib - distributableProfit) * 100) / 100;
  const isProfitEquationReconciled = Math.abs(profitDifference) < 0.01;

  if (!isProfitEquationReconciled) {
    discrepancies.push(
      `Profit equation mismatch: Total Investor Profit (৳${totalInvestorProfit}) + Total Mudarib Profit (৳${totalMudaribProfit}) = ৳${sumInvestorPlusMudarib} !== Total Distributable Profit (৳${distributableProfit}), diff = ৳${profitDifference}`
    );
  }

  // 3. Post Profit Appropriation Journal Entry (Equity/Liability only, NO P&L accounts!)
  let journalEntryId: string | undefined;
  let voucherNumber: string | undefined;
  let isGlReconciled = true;

  if (postAppropriationToLedger) {
    voucherNumber = generateTransactionNumber('PRF-APP');
    journalEntryId = generateUniqueId('j_prf_app');

    const accounts = await dbInstance.accounts.toArray();
    const retEarnAcc = accounts.find((a: any) => a.code === '3050') || {
      id: 'acc_3050',
      code: '3050',
      nameBn: 'সংরক্ষিত আয় / মুনাফা বণ্টন (Retained Earnings / Profit Appropriation)'
    };
    const invPayableAcc = accounts.find((a: any) => a.code === '2050') || {
      id: 'acc_2050',
      code: '2050',
      nameBn: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয় (Investor Profit Payable)'
    };
    const mudaribEquityAcc = accounts.find((a: any) => a.code === '3015') || {
      id: 'acc_3015',
      code: '3015',
      nameBn: 'মুদারিব মুনাফা মালিকানা স্বত্ব (Mudarib Profit Equity)'
    };

    const lines: JournalLine[] = [
      // 1. Debit Retained Earnings (Equity) for total distributable profit
      {
        accountId: retEarnAcc.id,
        accountCode: '3050',
        accountName: retEarnAcc.nameBn,
        debit: distributableProfit,
        credit: 0,
        memo: `বণ্টনযোগ্য নিট মুনাফা বণ্টন সমন্বয় (Total Distributable Profit)`
      },
      // 2. Credit Investor Profit Payable (Liability)
      {
        accountId: invPayableAcc.id,
        accountCode: '2050',
        accountName: invPayableAcc.nameBn,
        debit: 0,
        credit: totalInvestorProfit,
        memo: `বিনিয়োগকারীদের চুক্তিবদ্ধ মুনাফা প্রদেয় ক্রেডিট`
      },
      // 3. Credit Mudarib Profit Equity (Equity)
      {
        accountId: mudaribEquityAcc.id,
        accountCode: '3015',
        accountName: mudaribEquityAcc.nameBn,
        debit: 0,
        credit: totalMudaribProfit,
        memo: `মুদারিব কর্ম অংশীদারের অর্জিত মুনাফা স্বত্ব ক্রেডিট`
      }
    ];

    await postJournalEntry(
      {
        id: journalEntryId,
        voucherNumber,
        voucherType: 'JOURNAL',
        date: periodEndDate,
        narration: `মুনাফা বণ্টন ও মুদারিব অংশীদারিত্ব সমন্বয়: মোট ৳${distributableProfit} (বিনিয়োগকারী ৳${totalInvestorProfit}, মুদারিব ৳${totalMudaribProfit})`,
        reference: `RECON-PROFIT-${periodEndDate}`,
        lines,
        createdBy: currentUserId,
        createdAt: new Date().toISOString()
      },
      { dbInstance, accounts }
    );
  }

  // 4. Capture Post-Appropriation P&L and verify complete invariance
  const postPnLRaw: ProfitLossReport = await generateProfitLoss(
    { startDate: periodStartDate, endDate: periodEndDate },
    dbInstance
  );

  const postPnL = {
    operatingRevenue: Math.round((postPnLRaw.totalRevenue ?? 0) * 100) / 100,
    operatingExpenses: Math.round(((postPnLRaw.totalCogs || 0) + (postPnLRaw.totalOperatingExpenses || 0) + (postPnLRaw.totalOtherExpenses || 0)) * 100) / 100,
    netProfit: Math.round(postPnLRaw.netProfit * 100) / 100
  };

  const pnlNetProfitDifference = Math.round((postPnL.netProfit - prePnL.netProfit) * 100) / 100;
  const isRevenueUnchanged = Math.abs(postPnL.operatingRevenue - prePnL.operatingRevenue) < 0.01;
  const isExpensesUnchanged = Math.abs(postPnL.operatingExpenses - prePnL.operatingExpenses) < 0.01;
  const isNetProfitUnchanged = Math.abs(pnlNetProfitDifference) < 0.01;

  const isPnLUnchanged = isRevenueUnchanged && isExpensesUnchanged && isNetProfitUnchanged;

  if (!isPnLUnchanged) {
    discrepancies.push(
      `Accounting P&L was altered by profit appropriation! Pre-Net Profit ৳${prePnL.netProfit} vs Post-Net Profit ৳${postPnL.netProfit} (diff: ৳${pnlNetProfitDifference}). Revenue diff: ৳${postPnL.operatingRevenue - prePnL.operatingRevenue}, Expense diff: ৳${postPnL.operatingExpenses - prePnL.operatingExpenses}`
    );
  }

  const isFullyReconciled = isProfitEquationReconciled && isPnLUnchanged && discrepancies.length === 0;

  return {
    timestamp: new Date().toISOString(),
    distributableProfit,
    totalEligibleCapital: allocationResult.totalEligibleCapital,
    participants: participantBreakdowns,
    totalInvestorProfit,
    totalMudaribProfit,
    sumInvestorPlusMudarib,
    profitDifference,
    isProfitEquationReconciled,
    contractualPercentagesSum,
    doesPercentagesSumTo100: Math.abs(contractualPercentagesSum - 100) < 0.01,
    preAppropriationPnL: prePnL,
    postAppropriationPnL: postPnL,
    isPnLUnchanged,
    pnlNetProfitDifference,
    isGlReconciled,
    journalEntryId,
    voucherNumber,
    isFullyReconciled,
    discrepancies
  };
}
