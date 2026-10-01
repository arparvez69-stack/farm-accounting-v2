import { db } from '../db/indexedDb';
import { generateBalanceSheet, generateProfitLoss, ProfitLossReport, BalanceSheetReport } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { JournalEntry, JournalLine } from '../types';

export interface NavSnapshot {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  nav: number;
  assetDetails: { code: string; nameBn: string; amount: number }[];
  liabilityDetails: { code: string; nameBn: string; amount: number }[];
}

export interface NavMovementBreakdown {
  openingNav: number;
  operatingResult: number;
  capitalContributions: number;
  capitalWithdrawals: number;
  approvedValuationAdjustments: number;
  otherEquityMovements: number;
  expectedClosingNav: number;
  actualClosingNav: number;
  discrepancy: number;
  isReconciled: boolean;
  formula: string;
}

export interface NavReconciliationReport {
  timestamp: string;
  periodStartDate: string;
  periodEndDate: string;
  openingNavSnapshot: NavSnapshot;
  closingNavSnapshot: NavSnapshot;
  movement: NavMovementBreakdown;
  isReconciled: boolean;
  discrepancies: string[];
}

export interface RunNavReconciliationParams {
  periodStartDate?: string;
  periodEndDate: string;
  approvedValuationAdjustments?: number;
}

/**
 * FINAL TEST C — NAV Reconciliation Service
 *
 * Runs:
 *   NAV = Assets - Liabilities
 *
 * Then reconciles NAV movement against:
 *   Opening NAV
 *   + operating result
 *   + capital contributions
 *   - capital withdrawals
 *   + approved valuation adjustments
 *   + other legitimate equity movements
 *   = Closing NAV
 *
 * Does not force the result.
 * Identifies real sources of discrepancies.
 */
export async function runNavReconciliation(
  params: RunNavReconciliationParams,
  dbInstance: any = db
): Promise<NavReconciliationReport> {
  const {
    periodStartDate = '1970-01-01',
    periodEndDate,
    approvedValuationAdjustments = 0
  } = params;

  const discrepancies: string[] = [];

  // 1. Calculate Opening NAV: Assets - Liabilities as of periodStartDate
  // Opening snapshot: all transactions strictly before periodStartDate
  let openingAssets = 0;
  let openingLiabilities = 0;
  let openingAssetItems: { code: string; nameBn: string; amount: number }[] = [];
  let openingLiabilityItems: { code: string; nameBn: string; amount: number }[] = [];

  if (periodStartDate !== '1970-01-01') {
    // Determine the day prior to periodStartDate
    const [y, m, d] = periodStartDate.split('-').map(Number);
    const prevDay = new Date(Date.UTC(y, m - 1, d - 1));
    const prevDayStr = prevDay.toISOString().split('T')[0];

    const openingBs: BalanceSheetReport = await generateBalanceSheet(prevDayStr, dbInstance);
    openingAssets = Math.round((openingBs.totalAssets || 0) * 100) / 100;
    openingLiabilities = Math.round((openingBs.totalLiabilities || 0) * 100) / 100;
    openingAssetItems = openingBs.assets || [];
    openingLiabilityItems = openingBs.liabilities || [];
  }

  const openingNav = Math.round((openingAssets - openingLiabilities) * 100) / 100;

  const openingSnapshot: NavSnapshot = {
    date: periodStartDate,
    totalAssets: openingAssets,
    totalLiabilities: openingLiabilities,
    nav: openingNav,
    assetDetails: openingAssetItems,
    liabilityDetails: openingLiabilityItems
  };

  // 2. Calculate Closing NAV: Assets - Liabilities as of periodEndDate
  const closingBs: BalanceSheetReport = await generateBalanceSheet(periodEndDate, dbInstance);
  const closingAssets = Math.round((closingBs.totalAssets || 0) * 100) / 100;
  const closingLiabilities = Math.round((closingBs.totalLiabilities || 0) * 100) / 100;
  const actualClosingNav = Math.round((closingAssets - closingLiabilities) * 100) / 100;

  const closingSnapshot: NavSnapshot = {
    date: periodEndDate,
    totalAssets: closingAssets,
    totalLiabilities: closingLiabilities,
    nav: actualClosingNav,
    assetDetails: closingBs.assets || [],
    liabilityDetails: closingBs.liabilities || []
  };

  // 3. Calculate Operating Result from P&L (Operating Revenue - Operating Expenses) for the period
  const pnl: ProfitLossReport = await generateProfitLoss(
    { startDate: periodStartDate, endDate: periodEndDate },
    undefined,
    dbInstance
  );
  const operatingResult = Math.round((pnl.netProfit || 0) * 100) / 100;

  // 4. Analyze General Ledger for Capital Contributions, Withdrawals, Revaluations & Other Equity Movements
  let journalEntries: JournalEntry[] = [];
  if (dbInstance.journalEntries) {
    const raw = await dbInstance.journalEntries.toArray();
    journalEntries = raw.filter((j: JournalEntry) => {
      if (j.status === 'REVERSED') return false;
      return j.date >= periodStartDate && j.date <= periodEndDate;
    });
  }

  let capitalContributions = 0;
  let capitalWithdrawals = 0;
  let valuationAdjustmentsFromLedger = 0;
  let otherEquityMovements = 0;

  for (const j of journalEntries) {
    for (const l of j.lines || []) {
      const code = l.accountCode;
      const credit = Number(l.credit || 0);
      const debit = Number(l.debit || 0);

      // Capital Accounts: 3010 (Owner Capital), 3020 (Investor Capital)
      if (code === CANONICAL_ACCOUNTS.OWNER_CAPITAL || code === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || code === '3010' || code === '3020') {
        // Is this a reinvestment from profit payable / retained earnings?
        const isReinvestment = (j.lines || []).some(
          (other: any) =>
            (other.accountCode === '2050' || other.accountCode === '3015' || other.accountCode === '2060') &&
            (other.debit || 0) > 0
        );

        if (credit > 0) {
          if (isReinvestment) {
            // Reinvested profit is a transfer from Profit Payable (Liability) into Capital (Equity)
            // It was already excluded from Operating Result (P&L), and increases Equity.
            capitalContributions += credit;
          } else {
            // External capital injection
            capitalContributions += credit;
          }
        }
        if (debit > 0) {
          capitalWithdrawals += debit;
        }
      }

      // Revaluation Reserve: 3040 or revaluation entries
      if (code === '3040' || (l.memo && l.memo.includes('পুনর্মূল্যায়ন'))) {
        valuationAdjustmentsFromLedger += (credit - debit);
      }
    }
  }

  // Combine valuation adjustments from ledger with any explicitly provided approved valuation adjustments
  const totalValuationAdjustments = Math.round((valuationAdjustmentsFromLedger + approvedValuationAdjustments) * 100) / 100;

  capitalContributions = Math.round(capitalContributions * 100) / 100;
  capitalWithdrawals = Math.round(capitalWithdrawals * 100) / 100;
  otherEquityMovements = Math.round(otherEquityMovements * 100) / 100;

  // 5. NAV Movement Formula:
  // Expected Closing NAV = Opening NAV + Operating Result + Capital Contributions - Capital Withdrawals + Approved Valuation Adjustments + Other Equity Movements
  const expectedClosingNav = Math.round(
    (openingNav + operatingResult + capitalContributions - capitalWithdrawals + totalValuationAdjustments + otherEquityMovements) * 100
  ) / 100;

  const discrepancy = Math.round((actualClosingNav - expectedClosingNav) * 100) / 100;
  const isReconciled = Math.abs(discrepancy) < 0.01;

  const formula = `${openingNav} (Opening NAV) + ${operatingResult} (Operating Result) + ${capitalContributions} (Contributions) - ${capitalWithdrawals} (Withdrawals) + ${totalValuationAdjustments} (Valuation Adjustments)${
    otherEquityMovements !== 0 ? ` + ${otherEquityMovements} (Other Equity)` : ''
  } = ${expectedClosingNav} (Expected Closing NAV) vs ${actualClosingNav} (Actual Closing Assets ৳${closingAssets} - Liabilities ৳${closingLiabilities})`;

  if (!isReconciled) {
    discrepancies.push(
      `NAV Movement Discrepancy: Expected Closing NAV ৳${expectedClosingNav}, Actual Closing NAV ৳${actualClosingNav} (Difference: ৳${discrepancy}). Formula: ${formula}`
    );
  }

  const movement: NavMovementBreakdown = {
    openingNav,
    operatingResult,
    capitalContributions,
    capitalWithdrawals,
    approvedValuationAdjustments: totalValuationAdjustments,
    otherEquityMovements,
    expectedClosingNav,
    actualClosingNav,
    discrepancy,
    isReconciled,
    formula
  };

  return {
    timestamp: new Date().toISOString(),
    periodStartDate,
    periodEndDate,
    openingNavSnapshot: openingSnapshot,
    closingNavSnapshot: closingSnapshot,
    movement,
    isReconciled,
    discrepancies
  };
}
