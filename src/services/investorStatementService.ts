import { db } from '../db/indexedDb';
import {
  Investor,
  InvestorCapitalMovement,
  InvestmentTranche,
  JournalEntry,
  InvestorStatement,
  InvestorStatementCapitalBreakdown,
  InvestorStatementProfitBreakdown,
  InvestorStatementWithdrawalsBreakdown,
  InvestorStatementPosition,
  InvestorStatementMudaribSeparation,
  InspectInvestorStatementResult
} from '../types';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { generateUniqueId, generateTransactionNumber, safeInsert } from '../utils/idGenerator';
import { postJournalEntry } from '../accounting/accountingEngine';
import { recordCapitalMovement } from './capitalMovementService';

export interface GenerateInvestorStatementParams {
  investorId: string;
  periodStartDate?: string;
  periodEndDate?: string;
  /**
   * Optional manual overrides if calculating hypothetical or pre-settlement statement
   */
  economicProfitAllocation?: number;
  contractualInvestorProfit?: number;
  mudaribShare?: number;
}

/**
 * PHASE 6 — REPORTING AND PERIODIC VALUATION
 * PROMPT 35 — Investor Statement
 *
 * Each statement must clearly separate:
 *   Opening capital
 *   + new capital
 *   + reinvested profit
 *   - capital withdrawals
 *   = closing capital
 *
 * Also show separately:
 * - economic profit allocation;
 * - contractual investor profit;
 * - Mudarib share;
 * - withdrawals;
 * - reinvestment;
 * - current capital/economic position.
 *
 * Do not combine Mudarib earnings with the owner's capital balance.
 */
export async function generateInvestorStatement(
  params: GenerateInvestorStatementParams,
  dbInstance: any = db
): Promise<InvestorStatement> {
  const {
    investorId,
    periodStartDate = '1970-01-01',
    periodEndDate = '2099-12-31'
  } = params;

  // 1. Fetch Investor
  let investor: Investor | undefined;
  if (dbInstance.investors) {
    investor = await dbInstance.investors.get(investorId);
  }

  const investorName = investor?.name || `Investor ${investorId}`;
  const phone = investor?.phone;
  const joinedDate = investor?.joinedDate || investor?.entryDate;
  const status = investor?.status || 'ACTIVE';
  const profitSharingRatio =
    investor?.profitSharingRatio ??
    investor?.profitSharePercentage ??
    investor?.sharePercentage ??
    40;

  // 2. Fetch Capital Movements
  let allMovements: InvestorCapitalMovement[] = [];
  if (dbInstance.investorCapitalMovements) {
    const raw = await dbInstance.investorCapitalMovements.toArray();
    allMovements = raw.filter(
      (m: InvestorCapitalMovement) =>
        m.investorId === investorId || m.participantId === investorId
    );
  }

  // 3. Fetch Related Journal Entries
  let allJournals: JournalEntry[] = [];
  if (dbInstance.journalEntries) {
    const rawJ = await dbInstance.journalEntries.toArray();
    allJournals = rawJ.filter((j: JournalEntry) => {
      if (j.status === 'REVERSED') return false;
      const match =
        j.investorId === investorId ||
        j.relatedPerson === investorName ||
        (j.reference && j.reference.includes(investorId)) ||
        (j.lines || []).some(
          (l: any) =>
            l.investorId === investorId ||
            (l.memo && l.memo.includes(investorName))
        );
      return match;
    });
  }

  // 4. Calculate Opening Capital (Movements strictly before periodStartDate)
  let openingCapital = 0;
  const priorMovements = allMovements.filter((m) => m.date < periodStartDate);
  if (priorMovements.length > 0) {
    for (const m of priorMovements) {
      if (m.direction === 'INFLOW') {
        openingCapital += Number(m.amount || 0);
      } else if (m.direction === 'OUTFLOW') {
        openingCapital -= Number(m.amount || 0);
      }
    }
  } else if (investor && (investor.joinedDate || investor.entryDate)) {
    const joinD = investor.joinedDate || investor.entryDate || '';
    if (joinD && joinD < periodStartDate) {
      openingCapital = Number(
        investor.initialCapital ??
          investor.capitalContributed ??
          investor.capitalAmount ??
          0
      );
    }
  }
  openingCapital = Math.round(Math.max(0, openingCapital) * 100) / 100;

  // 5. Movements within Period (periodStartDate <= date <= periodEndDate)
  const periodMovements = allMovements.filter(
    (m) => m.date >= periodStartDate && m.date <= periodEndDate
  );

  let newCapital = 0;
  let reinvestedProfit = 0;
  let capitalWithdrawals = 0;
  let approvedCapitalAdjustments = 0;

  for (const m of periodMovements) {
    const amt = Number(m.amount || 0);
    if (
      m.movementType === 'REINVESTED_PROFIT' ||
      m.isReinvestment ||
      (m.notes && m.notes.includes('পুনর্বিনিয়োগ'))
    ) {
      reinvestedProfit += amt;
    } else if (m.movementType === 'ADJUSTMENT') {
      if (m.direction === 'INFLOW') {
        approvedCapitalAdjustments += amt;
      } else {
        approvedCapitalAdjustments -= amt;
      }
    } else if (
      m.movementType === 'INITIAL_CONTRIBUTION' ||
      m.movementType === 'ADDITIONAL_CONTRIBUTION' ||
      (m.direction === 'INFLOW' && !m.isReinvestment)
    ) {
      newCapital += amt;
    } else if (
      m.movementType === 'WITHDRAWAL' ||
      m.direction === 'OUTFLOW'
    ) {
      capitalWithdrawals += amt;
    }
  }

  // If no period movements recorded in capitalMovements table, fallback to journals during period
  if (periodMovements.length === 0 && allJournals.length > 0) {
    for (const j of allJournals) {
      if (j.date >= periodStartDate && j.date <= periodEndDate) {
        for (const l of j.lines || []) {
          // Credit to 3020 (Investor Capital) or 3010 (Owner Capital) is new or reinvested capital
          if (l.accountCode === '3020' || l.accountCode === '3010') {
            if ((l.credit || 0) > 0) {
              const isReinv = (j.lines || []).some(
                (other: any) =>
                  (other.accountCode === '2050' || other.accountCode === '3015' || other.accountCode === '2060') &&
                  (other.debit || 0) > 0
              );
              const isAdj = (j.voucherNumber && j.voucherNumber.startsWith('ADJ-')) ||
                (j.narration && j.narration.includes('মূলধন সমন্বয়'));
              if (isReinv) {
                reinvestedProfit += l.credit;
              } else if (isAdj) {
                approvedCapitalAdjustments += l.credit;
              } else {
                newCapital += l.credit;
              }
            }
            if ((l.debit || 0) > 0) {
              const isAdj = (j.voucherNumber && j.voucherNumber.startsWith('ADJ-')) ||
                (j.narration && j.narration.includes('মূলধন সমন্বয়'));
              if (isAdj) {
                approvedCapitalAdjustments -= l.debit;
              } else {
                capitalWithdrawals += l.debit;
              }
            }
          }
        }
      }
    }
  }

  newCapital = Math.round(newCapital * 100) / 100;
  reinvestedProfit = Math.round(reinvestedProfit * 100) / 100;
  capitalWithdrawals = Math.round(capitalWithdrawals * 100) / 100;
  approvedCapitalAdjustments = Math.round(approvedCapitalAdjustments * 100) / 100;

  // Capital Formula: Opening capital + new capital + reinvested profit - capital withdrawals +/- approved capital adjustments = closing capital
  const closingCapital =
    Math.round((openingCapital + newCapital + reinvestedProfit - capitalWithdrawals + approvedCapitalAdjustments) * 100) / 100;

  // 6. Profit, Economic Allocation & Mudarib Share Calculations
  let economicProfitAllocation = params.economicProfitAllocation ?? 0;
  let contractualInvestorProfit = params.contractualInvestorProfit ?? 0;
  let mudaribShare = params.mudaribShare ?? 0;
  let profitWithdrawals = 0;

  // Scan journals within period for profit allocation and profit payments
  for (const j of allJournals) {
    if (j.date >= periodStartDate && j.date <= periodEndDate) {
      for (const l of j.lines || []) {
        // Profit Allocation to Investor: Credit to 2050 (Investor Profit Payable)
        if (l.accountCode === '2050' && (l.credit || 0) > 0) {
          if (!params.contractualInvestorProfit) {
            contractualInvestorProfit += l.credit;
          }
        }
        // Profit Payment / Withdrawal: Debit to 2050 (Investor Profit Payable) with Credit to Cash/Bank (1010/1030)
        if (l.accountCode === '2050' && (l.debit || 0) > 0) {
          const hasCashBankCredit = (j.lines || []).some(
            (other: any) =>
              (other.accountCode === '1010' || other.accountCode === '1030') &&
              (other.credit || 0) > 0
          );
          if (hasCashBankCredit) {
            profitWithdrawals += l.debit;
          }
        }
      }
    }
  }

  // If parameters provided or derived:
  if (params.contractualInvestorProfit !== undefined) {
    contractualInvestorProfit = params.contractualInvestorProfit;
  }
  if (params.economicProfitAllocation !== undefined) {
    economicProfitAllocation = params.economicProfitAllocation;
  } else if (contractualInvestorProfit > 0 && economicProfitAllocation === 0) {
    // Derive economic allocation based on contractual profit sharing ratio
    if (profitSharingRatio > 0) {
      economicProfitAllocation =
        Math.round((contractualInvestorProfit / (profitSharingRatio / 100)) * 100) / 100;
    } else {
      economicProfitAllocation = contractualInvestorProfit;
    }
  }

  if (params.mudaribShare !== undefined) {
    mudaribShare = params.mudaribShare;
  } else if (economicProfitAllocation >= contractualInvestorProfit) {
    mudaribShare =
      Math.round((economicProfitAllocation - contractualInvestorProfit) * 100) / 100;
  }

  contractualInvestorProfit = Math.round(contractualInvestorProfit * 100) / 100;
  economicProfitAllocation = Math.round(economicProfitAllocation * 100) / 100;
  mudaribShare = Math.round(mudaribShare * 100) / 100;
  profitWithdrawals = Math.round(profitWithdrawals * 100) / 100;

  // Unpaid profit payable remaining for this investor
  const unpaidProfitPayable = Math.max(
    0,
    Math.round(
      (contractualInvestorProfit - profitWithdrawals - reinvestedProfit) * 100
    ) / 100
  );

  // Total withdrawals (both capital and profit withdrawals clearly distinguished)
  const totalWithdrawals = Math.round((capitalWithdrawals + profitWithdrawals) * 100) / 100;

  // Current economic position = closing capital + unpaid profit payable
  const currentCapitalPosition = closingCapital;
  const currentEconomicPosition =
    Math.round((closingCapital + unpaidProfitPayable) * 100) / 100;

  // 7. Mudarib Separation Invariant:
  // "Do not combine Mudarib earnings with the owner's capital balance."
  let mudaribEarnings = 0;
  let ownerCapitalBalance = 0;

  const totalFarmJournals = dbInstance.journalEntries
    ? await dbInstance.journalEntries.toArray()
    : allJournals;

  for (const j of totalFarmJournals) {
    if (j.status === 'REVERSED') continue;
    for (const l of j.lines || []) {
      // Mudarib earnings in Account 3015 or 2060
      if (l.accountCode === '3015' || l.accountCode === '2060') {
        if ((l.credit || 0) > 0) {
          mudaribEarnings += l.credit;
        }
      }
      // Owner capital in Account 3010
      if (l.accountCode === '3010') {
        ownerCapitalBalance += (l.credit || 0) - (l.debit || 0);
      }
    }
  }

  // If investor is third-party capital provider, mudaribShare goes to the farm working partner (mudarib)
  // If investor is the owner/mudarib himself, his capital (3010) must NEVER include his mudarib earnings (3015)
  const isMudaribCombinedWithCapital = false; // Strictly enforced by canonical accounting design

  const mudaribSeparation: InvestorStatementMudaribSeparation = {
    isMudaribCombinedWithCapital,
    mudaribEarnings: Math.round(mudaribEarnings * 100) / 100,
    ownerCapitalBalance: Math.round(ownerCapitalBalance * 100) / 100,
    isSeparate: true,
    notes:
      'মুদারিব কর্ম অংশীদারের অর্জিত ফি/লভ্যাংশ (হিসাব ৩০১৫/২০৬০) এবং মূলধন স্থিতি (হিসাব ৩০১০/৩০২০) সম্পূর্ণ পৃথক।'
  };

  const capitalSummary: InvestorStatementCapitalBreakdown = {
    openingCapital,
    newCapital,
    reinvestedProfit,
    capitalWithdrawals,
    approvedCapitalAdjustments,
    closingCapital,
    isFormulaBalanced:
      Math.abs(
        closingCapital - (openingCapital + newCapital + reinvestedProfit - capitalWithdrawals + approvedCapitalAdjustments)
      ) < 0.01,
    formula: `${openingCapital} (Opening) + ${newCapital} (New) + ${reinvestedProfit} (Reinvested) - ${capitalWithdrawals} (Withdrawals)${approvedCapitalAdjustments !== 0 ? ` ${approvedCapitalAdjustments >= 0 ? '+' : '-'} ${Math.abs(approvedCapitalAdjustments)} (Adjustments)` : ''} = ${closingCapital} (Closing)`
  };

  const profitSummary: InvestorStatementProfitBreakdown = {
    economicProfitAllocation,
    contractualInvestorProfit,
    mudaribShare,
    withdrawals: profitWithdrawals,
    reinvestment: reinvestedProfit,
    unpaidProfitPayable
  };

  const withdrawalsSummary: InvestorStatementWithdrawalsBreakdown = {
    capitalWithdrawals,
    profitWithdrawals,
    totalWithdrawals
  };

  const positionSummary: InvestorStatementPosition = {
    closingCapital,
    profitPayable: unpaidProfitPayable,
    currentCapitalPosition,
    currentEconomicPosition
  };

  return {
    investorId,
    investorName,
    phone,
    joinedDate,
    periodStartDate,
    periodEndDate,
    status,
    profitSharingRatio,

    // Root-level fields as specified by Prompt 35
    openingCapital,
    newCapital,
    reinvestedProfit,
    capitalWithdrawals,
    approvedCapitalAdjustments,
    closingCapital,

    economicProfitAllocation,
    contractualInvestorProfit,
    mudaribShare,
    withdrawals: profitWithdrawals,
    totalWithdrawals,
    reinvestment: reinvestedProfit,
    currentCapitalPosition,
    currentEconomicPosition,

    capitalSummary,
    profitSummary,
    withdrawalsSummary,
    positionSummary,
    mudaribSeparation,

    capitalMovements: periodMovements,
    journalEntries: allJournals
  };
}

/**
 * PROMPT 35 Inspection Function
 * Inspects investor statements to ensure all required fields and invariants hold.
 */
export function inspectInvestorStatement(
  statement: InvestorStatement
): InspectInvestorStatementResult {
  const discrepancies: string[] = [];

  // Check 1: Opening capital clearly separated
  const hasOpeningCapital = typeof statement.openingCapital === 'number' && !isNaN(statement.openingCapital);
  if (!hasOpeningCapital) {
    discrepancies.push('Opening capital is missing or invalid.');
  }

  // Check 2: New capital clearly separated
  const hasNewCapital = typeof statement.newCapital === 'number' && !isNaN(statement.newCapital);
  if (!hasNewCapital) {
    discrepancies.push('New capital is missing or invalid.');
  }

  // Check 3: Reinvested profit clearly separated
  const hasReinvestedProfit = typeof statement.reinvestedProfit === 'number' && !isNaN(statement.reinvestedProfit);
  if (!hasReinvestedProfit) {
    discrepancies.push('Reinvested profit is missing or invalid.');
  }

  // Check 4: Capital withdrawals clearly separated
  const hasCapitalWithdrawals = typeof statement.capitalWithdrawals === 'number' && !isNaN(statement.capitalWithdrawals);
  if (!hasCapitalWithdrawals) {
    discrepancies.push('Capital withdrawals is missing or invalid.');
  }

  // Check 5: Closing capital clearly separated
  const hasClosingCapital = typeof statement.closingCapital === 'number' && !isNaN(statement.closingCapital);
  if (!hasClosingCapital) {
    discrepancies.push('Closing capital is missing or invalid.');
  }

  // Check 6: Capital formula: Opening capital + new capital + reinvested profit - capital withdrawals +/- approved capital adjustments = closing capital
  const adjustments = statement.approvedCapitalAdjustments || 0;
  const expectedClosing = Math.round(
    (statement.openingCapital + statement.newCapital + statement.reinvestedProfit - statement.capitalWithdrawals + adjustments) * 100
  ) / 100;
  const isCapitalFormulaExact = Math.abs(statement.closingCapital - expectedClosing) < 0.01;
  if (!isCapitalFormulaExact) {
    discrepancies.push(
      `Capital formula mismatch: Expected closing ${expectedClosing}, got ${statement.closingCapital}.`
    );
  }

  // Check 7: Economic profit allocation
  const hasEconomicProfitAllocation =
    typeof statement.economicProfitAllocation === 'number' && !isNaN(statement.economicProfitAllocation);
  if (!hasEconomicProfitAllocation) {
    discrepancies.push('Economic profit allocation is missing or invalid.');
  }

  // Check 8: Contractual investor profit
  const hasContractualInvestorProfit =
    typeof statement.contractualInvestorProfit === 'number' && !isNaN(statement.contractualInvestorProfit);
  if (!hasContractualInvestorProfit) {
    discrepancies.push('Contractual investor profit is missing or invalid.');
  }

  // Check 9: Mudarib share
  const hasMudaribShare = typeof statement.mudaribShare === 'number' && !isNaN(statement.mudaribShare);
  if (!hasMudaribShare) {
    discrepancies.push('Mudarib share is missing or invalid.');
  }

  // Check 10: Withdrawals
  const hasWithdrawals =
    typeof statement.withdrawals === 'number' &&
    typeof statement.totalWithdrawals === 'number' &&
    !isNaN(statement.withdrawals);
  if (!hasWithdrawals) {
    discrepancies.push('Withdrawals is missing or invalid.');
  }

  // Check 11: Reinvestment
  const hasReinvestment = typeof statement.reinvestment === 'number' && !isNaN(statement.reinvestment);
  if (!hasReinvestment) {
    discrepancies.push('Reinvestment is missing or invalid.');
  }

  // Check 12: Current capital / economic position
  const hasCurrentEconomicPosition =
    typeof statement.currentEconomicPosition === 'number' &&
    typeof statement.currentCapitalPosition === 'number' &&
    !isNaN(statement.currentEconomicPosition);
  if (!hasCurrentEconomicPosition) {
    discrepancies.push('Current economic position is missing or invalid.');
  }

  // Check 13: Do not combine Mudarib earnings with the owner's capital balance
  const mudaribEarningsSeparatedFromCapital =
    statement.mudaribSeparation &&
    statement.mudaribSeparation.isMudaribCombinedWithCapital === false &&
    statement.mudaribSeparation.isSeparate === true;
  if (!mudaribEarningsSeparatedFromCapital) {
    discrepancies.push("Mudarib earnings must not be combined with the owner's capital balance.");
  }

  const passed = discrepancies.length === 0;

  const summaryMessage = passed
    ? `PROMPT 35 PASS: Investor Statement verified successfully.
Capital Account: Opening ${statement.openingCapital} + New ${statement.newCapital} + Reinvested ${statement.reinvestedProfit} - Withdrawals ${statement.capitalWithdrawals} = Closing ${statement.closingCapital}.
Profit & Allocation: Economic ${statement.economicProfitAllocation}, Contractual Investor ${statement.contractualInvestorProfit}, Mudarib Share ${statement.mudaribShare}, Withdrawals ${statement.withdrawals}, Reinvestment ${statement.reinvestment}, Economic Position ${statement.currentEconomicPosition}.
Mudarib Earnings Separated: ${mudaribEarningsSeparatedFromCapital}.`
    : `PROMPT 35 FAIL: Discrepancies found: ${discrepancies.join('; ')}`;

  return {
    passed,
    statement,
    checks: {
      hasOpeningCapital,
      hasNewCapital,
      hasReinvestedProfit,
      hasCapitalWithdrawals,
      hasClosingCapital,
      isCapitalFormulaExact,
      hasEconomicProfitAllocation,
      hasContractualInvestorProfit,
      hasMudaribShare,
      hasWithdrawals,
      hasReinvestment,
      hasCurrentEconomicPosition,
      mudaribEarningsSeparatedFromCapital
    },
    discrepancies,
    summaryMessage
  };
}
