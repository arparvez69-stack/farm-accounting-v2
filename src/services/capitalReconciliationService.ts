import { db } from '../db/indexedDb';
import { Investor, InvestorCapitalMovement, JournalEntry } from '../types';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { calculateGlBalanceForAccounts } from '../accounting/reconciliationService';
import { generateInvestorStatement } from './investorStatementService';

export interface ParticipantCapitalReconciliation {
  participantId: string;
  participantName: string;
  role: 'INVESTOR' | 'OWNER' | 'MUDARIB';
  openingCapital: number;
  newCapital: number;
  reinvestedProfit: number;
  capitalWithdrawals: number;
  approvedCapitalAdjustments: number;
  expectedClosingCapital: number;
  actualClosingCapital: number;
  discrepancy: number;
  isReconciled: boolean;
  formula: string;
  notes?: string;
}

export interface FullCapitalReconciliationReport {
  timestamp: string;
  asOfDate?: string;
  totalParticipants: number;
  reconciledCount: number;
  discrepancyCount: number;
  isFullyReconciled: boolean;
  totalOpeningCapital: number;
  totalNewCapital: number;
  totalReinvestedProfit: number;
  totalCapitalWithdrawals: number;
  totalApprovedCapitalAdjustments: number;
  totalExpectedClosingCapital: number;
  totalActualClosingCapital: number;
  totalDiscrepancy: number;
  glAccount3020Balance: number;
  glAccount3010Balance: number;
  isGlReconciled: boolean;
  participantReconciliations: ParticipantCapitalReconciliation[];
  discrepancies: string[];
}

export interface RunCapitalReconciliationOptions {
  periodStartDate?: string;
  periodEndDate?: string;
  asOfDate?: string;
}

/**
 * FINAL TEST A — Capital Reconciliation
 *
 * Runs a complete mathematical reconciliation across EVERY participant in the farm system:
 *
 * For every participant:
 *   Opening Capital
 *   + New Capital
 *   + Reinvested Profit
 *   - Capital Withdrawals
 *   +/- approved capital adjustments
 *   = Closing Capital
 *
 * Discrepancies are identified mathematically.
 * Numbers are never altered merely to make the equation pass.
 * Returns PASS only when the equation reconciles.
 */
export async function runCompleteCapitalReconciliation(
  options: RunCapitalReconciliationOptions = {},
  dbInstance: any = db
): Promise<FullCapitalReconciliationReport> {
  const {
    periodStartDate = '1970-01-01',
    periodEndDate = '2099-12-31',
    asOfDate
  } = options;

  const effectiveEndDate = asOfDate || periodEndDate;
  const discrepancies: string[] = [];
  const participantReconciliations: ParticipantCapitalReconciliation[] = [];

  // Fetch all investors/participants
  let investors: Investor[] = [];
  if (dbInstance.investors) {
    investors = await dbInstance.investors.toArray();
  }

  // Fetch journal entries for GL balance audit
  let journalEntries: JournalEntry[] = [];
  if (dbInstance.journalEntries) {
    journalEntries = await dbInstance.journalEntries.toArray();
  }

  let totalOpeningCapital = 0;
  let totalNewCapital = 0;
  let totalReinvestedProfit = 0;
  let totalCapitalWithdrawals = 0;
  let totalApprovedCapitalAdjustments = 0;
  let totalExpectedClosingCapital = 0;
  let totalActualClosingCapital = 0;

  // 1. Reconcile each registered investor participant
  for (const inv of investors) {
    const statement = await generateInvestorStatement(
      {
        investorId: inv.id,
        periodStartDate,
        periodEndDate: effectiveEndDate
      },
      dbInstance
    );

    const opening = Number(statement.openingCapital || 0);
    const newCap = Number(statement.newCapital || 0);
    const reinvested = Number(statement.reinvestedProfit || 0);
    const withdrawals = Number(statement.capitalWithdrawals || 0);
    const adjustments = Number(statement.approvedCapitalAdjustments || 0);

    const expectedClosing =
      Math.round((opening + newCap + reinvested - withdrawals + adjustments) * 100) / 100;

    // Actual closing capital from participant record in DB
    const actualClosing = Math.round(
      Number(inv.currentCapitalBalance ?? inv.capitalAmount ?? inv.capitalContributed ?? 0) * 100
    ) / 100;

    const diff = Math.round((actualClosing - expectedClosing) * 100) / 100;
    const isReconciled = Math.abs(diff) < 0.01;

    const formula = `${opening} (Opening) + ${newCap} (New) + ${reinvested} (Reinvested) - ${withdrawals} (Withdrawals)${
      adjustments !== 0 ? ` ${adjustments >= 0 ? '+' : '-'} ${Math.abs(adjustments)} (Adjustments)` : ''
    } = ${expectedClosing} (Expected) vs ${actualClosing} (Actual)`;

    if (!isReconciled) {
      discrepancies.push(
        `Participant "${inv.name}" (ID: ${inv.id}) capital mismatch: Expected ৳${expectedClosing}, Actual ৳${actualClosing} (Diff: ৳${diff}). Formula: ${formula}`
      );
    }

    participantReconciliations.push({
      participantId: inv.id,
      participantName: inv.name,
      role: 'INVESTOR',
      openingCapital: opening,
      newCapital: newCap,
      reinvestedProfit: reinvested,
      capitalWithdrawals: withdrawals,
      approvedCapitalAdjustments: adjustments,
      expectedClosingCapital: expectedClosing,
      actualClosingCapital: actualClosing,
      discrepancy: diff,
      isReconciled,
      formula,
      notes: inv.phone ? `Phone: ${inv.phone}` : undefined
    });

    totalOpeningCapital += opening;
    totalNewCapital += newCap;
    totalReinvestedProfit += reinvested;
    totalCapitalWithdrawals += withdrawals;
    totalApprovedCapitalAdjustments += adjustments;
    totalExpectedClosingCapital += expectedClosing;
    totalActualClosingCapital += actualClosing;
  }

  // 2. Reconcile Farm Owner Capital (Account 3010) if present in journals
  const ownerCapitalJournals = journalEntries.filter((j) => {
    if (j.status === 'REVERSED') return false;
    return (j.lines || []).some(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010'
    );
  });

  if (ownerCapitalJournals.length > 0) {
    let ownerOpening = 0;
    let ownerNew = 0;
    let ownerReinvested = 0;
    let ownerWithdrawals = 0;
    let ownerAdjustments = 0;

    for (const j of ownerCapitalJournals) {
      const isPrior = j.date < periodStartDate;
      const inPeriod = j.date >= periodStartDate && j.date <= effectiveEndDate;
      if (!isPrior && !inPeriod) continue;

      for (const l of j.lines || []) {
        if (l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010') {
          const credit = Number(l.credit || 0);
          const debit = Number(l.debit || 0);

          if (isPrior) {
            ownerOpening += credit - debit;
          } else {
            const isReinv = (j.lines || []).some(
              (o) =>
                (o.accountCode === '3015' || o.accountCode === '2060') &&
                (o.debit || 0) > 0
            );
            const isAdj =
              (j.voucherNumber && j.voucherNumber.startsWith('ADJ-')) ||
              (j.narration && j.narration.includes('মূলধন সমন্বয়'));

            if (credit > 0) {
              if (isReinv) ownerReinvested += credit;
              else if (isAdj) ownerAdjustments += credit;
              else ownerNew += credit;
            }
            if (debit > 0) {
              if (isAdj) ownerAdjustments -= debit;
              else ownerWithdrawals += debit;
            }
          }
        }
      }
    }

    ownerOpening = Math.round(ownerOpening * 100) / 100;
    ownerNew = Math.round(ownerNew * 100) / 100;
    ownerReinvested = Math.round(ownerReinvested * 100) / 100;
    ownerWithdrawals = Math.round(ownerWithdrawals * 100) / 100;
    ownerAdjustments = Math.round(ownerAdjustments * 100) / 100;

    const ownerExpectedClosing =
      Math.round((ownerOpening + ownerNew + ownerReinvested - ownerWithdrawals + ownerAdjustments) * 100) / 100;

    // Actual GL balance for Owner Capital (3010)
    const ownerActualClosing = calculateGlBalanceForAccounts(
      journalEntries,
      [CANONICAL_ACCOUNTS.OWNER_CAPITAL, '3010'],
      'CREDIT',
      effectiveEndDate
    );

    const ownerDiff = Math.round((ownerActualClosing - ownerExpectedClosing) * 100) / 100;
    const isOwnerReconciled = Math.abs(ownerDiff) < 0.01;

    const ownerFormula = `${ownerOpening} (Opening) + ${ownerNew} (New) + ${ownerReinvested} (Reinvested) - ${ownerWithdrawals} (Withdrawals)${
      ownerAdjustments !== 0 ? ` ${ownerAdjustments >= 0 ? '+' : '-'} ${Math.abs(ownerAdjustments)} (Adjustments)` : ''
    } = ${ownerExpectedClosing} (Expected) vs ${ownerActualClosing} (Actual)`;

    if (!isOwnerReconciled) {
      discrepancies.push(
        `Farm Owner Capital (3010) mismatch: Expected ৳${ownerExpectedClosing}, Actual ৳${ownerActualClosing} (Diff: ৳${ownerDiff}). Formula: ${ownerFormula}`
      );
    }

    participantReconciliations.push({
      participantId: 'owner_farm_capital',
      participantName: 'ফার্মের স্বত্বাধিকারী / মালিকের মূলধন (Farm Owner Capital)',
      role: 'OWNER',
      openingCapital: ownerOpening,
      newCapital: ownerNew,
      reinvestedProfit: ownerReinvested,
      capitalWithdrawals: ownerWithdrawals,
      approvedCapitalAdjustments: ownerAdjustments,
      expectedClosingCapital: ownerExpectedClosing,
      actualClosingCapital: ownerActualClosing,
      discrepancy: ownerDiff,
      isReconciled: isOwnerReconciled,
      formula: ownerFormula,
      notes: 'মালিকের ব্যক্তিগত মূলধন (Account 3010)'
    });

    totalOpeningCapital += ownerOpening;
    totalNewCapital += ownerNew;
    totalReinvestedProfit += ownerReinvested;
    totalCapitalWithdrawals += ownerWithdrawals;
    totalApprovedCapitalAdjustments += ownerAdjustments;
    totalExpectedClosingCapital += ownerExpectedClosing;
    totalActualClosingCapital += ownerActualClosing;
  }

  // 3. GL Account 3020 Reconciliation Check
  const glAccount3020Balance = calculateGlBalanceForAccounts(
    journalEntries,
    [CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, '3020'],
    'CREDIT',
    effectiveEndDate
  );

  const glAccount3010Balance = calculateGlBalanceForAccounts(
    journalEntries,
    [CANONICAL_ACCOUNTS.OWNER_CAPITAL, '3010'],
    'CREDIT',
    effectiveEndDate
  );

  // Compare sum of investor actual capital with GL 3020
  const totalInvestorActual = participantReconciliations
    .filter((p) => p.role === 'INVESTOR')
    .reduce((sum, p) => sum + p.actualClosingCapital, 0);

  const glDiff = Math.round((totalInvestorActual - glAccount3020Balance) * 100) / 100;
  const isGlReconciled = Math.abs(glDiff) < 0.01;
  if (!isGlReconciled) {
    discrepancies.push(
      `GL Account 3020 Mismatch: Sum of Investor Capital (৳${totalInvestorActual}) does not match GL Account 3020 credit balance (৳${glAccount3020Balance}), diff = ৳${glDiff}.`
    );
  }

  const totalDiscrepancy = Math.round((totalActualClosingCapital - totalExpectedClosingCapital) * 100) / 100;
  const reconciledCount = participantReconciliations.filter((p) => p.isReconciled).length;
  const discrepancyCount = participantReconciliations.length - reconciledCount;
  const isFullyReconciled = discrepancyCount === 0 && isGlReconciled && discrepancies.length === 0;

  return {
    timestamp: new Date().toISOString(),
    asOfDate: effectiveEndDate,
    totalParticipants: participantReconciliations.length,
    reconciledCount,
    discrepancyCount,
    isFullyReconciled,
    totalOpeningCapital: Math.round(totalOpeningCapital * 100) / 100,
    totalNewCapital: Math.round(totalNewCapital * 100) / 100,
    totalReinvestedProfit: Math.round(totalReinvestedProfit * 100) / 100,
    totalCapitalWithdrawals: Math.round(totalCapitalWithdrawals * 100) / 100,
    totalApprovedCapitalAdjustments: Math.round(totalApprovedCapitalAdjustments * 100) / 100,
    totalExpectedClosingCapital: Math.round(totalExpectedClosingCapital * 100) / 100,
    totalActualClosingCapital: Math.round(totalActualClosingCapital * 100) / 100,
    totalDiscrepancy,
    glAccount3020Balance,
    glAccount3010Balance,
    isGlReconciled,
    participantReconciliations,
    discrepancies
  };
}
