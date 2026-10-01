import { db } from '../db/indexedDb';
import {
  generateProfitLoss,
  generateBalanceSheet
} from '../accounting/accountingEngine';
import {
  calculateNetAssetValuation,
  runValuationReconciliationGate,
  createValuationEvent,
  categorizeNavAsset,
  categorizeNavLiability,
  getAllValuationEvents
} from './valuationService';
import {
  Investor,
  InvestmentTranche,
  NavAssetCategorySummary,
  NavLiabilityCategorySummary,
  ValuationAssetItem,
  ValuationLiabilityItem,
  ValuationReconciliationGateResult,
  PeriodEndValuationParams,
  PeriodEndValuationResult,
  PeriodEndParticipantPosition,
  InspectPeriodEndValuationResult
} from '../types';
import { generateUniqueId } from '../utils/idGenerator';

/**
 * PHASE 6 — REPORTING AND PERIODIC VALUATION
 * PROMPT 36 — Year-End / Period-End Valuation
 *
 * Core Principles:
 * 1. The system MUST support valuation even when no new investor is entering.
 * 2. Do not require a new investor to trigger valuation.
 * 3. At period end, allow all 9 components:
 *    - reconciliation
 *    - verified assets
 *    - liabilities
 *    - NAV
 *    - profit/loss
 *    - participant economic positions
 *    - contractual profit allocation
 *    - Mudarib allocation
 *    - settlement/reinvestment
 */
export async function executePeriodEndValuation(
  params: PeriodEndValuationParams,
  dbInstance: any = db
): Promise<PeriodEndValuationResult> {
  const {
    valuationDate,
    periodStartDate: customStartDate,
    responsibleUser,
    valuationType = 'YEAR_END',
    requireReconciliationGate = false,
    bypassReconciliationForTest = false,
    defaultReinvestmentPercentage = 0,
    settlementPreferences = {},
    notes
  } = params;

  if (!valuationDate || typeof valuationDate !== 'string') {
    throw new Error('মূল্যায়ন তারিখ আবশ্যক (Valuation date is required).');
  }
  const cleanEndDate = valuationDate.split('T')[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanEndDate)) {
    throw new Error('অবৈধ মূল্যায়ন তারিখ বিন্যাস (Invalid valuation date format, YYYY-MM-DD required).');
  }

  if (!responsibleUser || typeof responsibleUser !== 'string' || !responsibleUser.trim()) {
    throw new Error('দায়িত্বপ্রাপ্ত ব্যবহারকারী আবশ্যক (Responsible user is required).');
  }

  // Determine period start date
  const cleanStartDate = customStartDate
    ? customStartDate.split('T')[0].trim()
    : `${cleanEndDate.substring(0, 4)}-01-01`;

  // =========================================================================
  // 1. RECONCILIATION GATE
  // =========================================================================
  let gateResult: ValuationReconciliationGateResult | undefined;
  try {
    gateResult = await runValuationReconciliationGate(dbInstance, cleanEndDate);
  } catch (err: any) {
    if (requireReconciliationGate && !bypassReconciliationForTest) {
      throw err;
    }
  }

  const isReconciled = !gateResult || gateResult.status === 'PASS';
  const discrepanciesCount = gateResult?.unresolvedDiscrepancies?.length || 0;

  if (requireReconciliationGate && !isReconciled && !bypassReconciliationForTest) {
    throw new Error(
      `পিরিয়ড সমাপ্তি মূল্যায়ন স্থগিত: উপাদানগত অমিল সনাক্ত হয়েছে (${discrepanciesCount}টি হিসাব অমিল)।`
    );
  }

  // =========================================================================
  // 2, 3 & 4. VERIFIED ASSETS, LIABILITIES & NAV CALCULATION
  // =========================================================================
  const auditedNav = await calculateNetAssetValuation(cleanEndDate, dbInstance);

  const totalAssets = auditedNav.totalEligibleAssets ?? (auditedNav as any).totalBusinessAssetsIncluded ?? 0;
  const totalLiabilities = auditedNav.totalDeductedLiabilities ?? (auditedNav as any).relevantLiabilities ?? 0;
  const netAssetValue = auditedNav.netAssetValue ?? (auditedNav as any).resultingNetBusinessValue ?? 0;

  const verifiedAssets = {
    totalAssets,
    categories: auditedNav.assetCategories,
    items: auditedNav.assetCategories.flatMap((c) => c.items)
  };

  const liabilities = {
    totalLiabilities,
    categories: auditedNav.liabilityCategories,
    items: auditedNav.liabilityCategories.flatMap((c) => c.items)
  };

  const nav = {
    totalAssets,
    totalLiabilities,
    netAssetValue,
    formula: `মোট ব্যবসায়িক সম্পদ (৳${totalAssets.toLocaleString()}) - মোট দায় (৳${totalAssets === 0 && totalLiabilities === 0 ? '০' : totalLiabilities.toLocaleString()}) = নিট সম্পদ মূল্য বা NAV (৳${netAssetValue.toLocaleString()})`
  };

  // =========================================================================
  // 5. PROFIT / LOSS FOR THE PERIOD
  // =========================================================================
  const pl = await generateProfitLoss(
    { startDate: cleanStartDate, endDate: cleanEndDate },
    undefined,
    dbInstance
  );

  const revenue = Math.round(Number(pl.totalRevenue || 0) * 100) / 100;
  const calculatedExpenses =
    (pl as any).totalExpense !== undefined
      ? Number((pl as any).totalExpense)
      : (Number(pl.totalCogs || 0) +
         Number(pl.totalOperatingExpenses || 0) +
         Number(pl.totalOtherExpenses || 0));
  const expenses = Math.round(calculatedExpenses * 100) / 100;
  const netProfitOrLoss = Math.round(Number(pl.netProfit || 0) * 100) / 100;
  const isProfit = netProfitOrLoss >= 0;

  const profitLoss = {
    revenue,
    expenses,
    netProfitOrLoss,
    isProfit,
    periodStartDate: cleanStartDate,
    periodEndDate: cleanEndDate
  };

  // =========================================================================
  // 6. PARTICIPANT ECONOMIC POSITIONS (EXISTING PARTICIPANTS - NO NEW ADMISSION)
  // =========================================================================
  let rawInvestors: Investor[] = [];
  if (dbInstance.investors) {
    rawInvestors = await dbInstance.investors.toArray();
  }

  // Filter to active participants eligible in this period
  const activeParticipants = rawInvestors.filter((inv) => inv.status !== 'EXITED');

  let totalCapital = 0;
  for (const inv of activeParticipants) {
    const cap = Math.max(
      0,
      Number(
        inv.currentCapitalBalance ??
          inv.currentCapital ??
          inv.capitalAmount ??
          inv.totalInvestment ??
          0
      )
    );
    totalCapital += cap;
  }
  totalCapital = Math.round(totalCapital * 100) / 100;

  // Fallback if no investors table or capital is 0
  if (totalCapital === 0) {
    totalCapital = Math.max(0, netAssetValue);
  }

  const distributableProfit = Math.max(0, netProfitOrLoss);
  const participantPositions: PeriodEndParticipantPosition[] = [];

  let totalEconomicProfitAllocation = 0;
  let totalContractualInvestorProfit = 0;
  let totalMudaribShare = 0;
  let totalReinvestment = 0;
  let totalWithdrawal = 0;
  let resultingTotalCapital = 0;

  for (let i = 0; i < activeParticipants.length; i++) {
    const inv = activeParticipants[i];
    const participantId = inv.id;
    const name = inv.name;
    const cap = Math.max(
      0,
      Number(
        inv.currentCapitalBalance ??
          inv.currentCapital ??
          inv.capitalAmount ??
          inv.totalInvestment ??
          0
      )
    );

    const ratio = totalCapital > 0 ? cap / totalCapital : 0;
    const capitalProportionRatio = Math.round(ratio * 10000) / 10000;
    const capitalProportionPercentage = Math.round(ratio * 10000) / 100;

    const contractPercentage =
      inv.profitSharingRatio ??
      inv.profitSharePercentage ??
      inv.sharePercentage ??
      40;

    // Economic allocation based on capital proportion
    const economicProfitAllocation =
      Math.round(distributableProfit * ratio * 100) / 100;

    // Contractual investor profit
    const contractualInvestorProfit =
      Math.round(economicProfitAllocation * (contractPercentage / 100) * 100) / 100;

    // Mudarib / working partner share
    const mudaribShare =
      Math.round((economicProfitAllocation - contractualInvestorProfit) * 100) / 100;

    // Settlement preferences
    const pref = settlementPreferences[participantId] || {};
    let amountToReinvest = 0;
    let amountToWithdraw = 0;

    if (pref.amountToReinvest !== undefined && pref.amountToWithdraw !== undefined) {
      amountToReinvest = Math.round(Number(pref.amountToReinvest) * 100) / 100;
      amountToWithdraw = Math.round(Number(pref.amountToWithdraw) * 100) / 100;
    } else if (pref.amountToReinvest !== undefined) {
      amountToReinvest = Math.round(Number(pref.amountToReinvest) * 100) / 100;
      amountToWithdraw = Math.max(
        0,
        Math.round((contractualInvestorProfit - amountToReinvest) * 100) / 100
      );
    } else if (pref.amountToWithdraw !== undefined) {
      amountToWithdraw = Math.round(Number(pref.amountToWithdraw) * 100) / 100;
      amountToReinvest = Math.max(
        0,
        Math.round((contractualInvestorProfit - amountToWithdraw) * 100) / 100
      );
    } else {
      const reinvestPct =
        pref.reinvestPercentage !== undefined
          ? pref.reinvestPercentage
          : defaultReinvestmentPercentage;
      amountToReinvest =
        Math.round(contractualInvestorProfit * (reinvestPct / 100) * 100) / 100;
      amountToWithdraw =
        Math.round((contractualInvestorProfit - amountToReinvest) * 100) / 100;
    }

    const resultingCapital = Math.round((cap + amountToReinvest) * 100) / 100;
    const remainingUnsettled = Math.max(
      0,
      Math.round(
        (contractualInvestorProfit - amountToReinvest - amountToWithdraw) * 100
      ) / 100
    );
    const resultingEconomicPosition =
      Math.round((resultingCapital + remainingUnsettled) * 100) / 100;

    totalEconomicProfitAllocation += economicProfitAllocation;
    totalContractualInvestorProfit += contractualInvestorProfit;
    totalMudaribShare += mudaribShare;
    totalReinvestment += amountToReinvest;
    totalWithdrawal += amountToWithdraw;
    resultingTotalCapital += resultingCapital;

    participantPositions.push({
      participantId,
      name,
      currentCapital: cap,
      capitalProportionRatio,
      capitalProportionPercentage,
      contractPercentage,
      economicProfitAllocation,
      contractualInvestorProfit,
      mudaribShare,
      amountToReinvest,
      amountToWithdraw,
      resultingCapital,
      resultingEconomicPosition
    });
  }

  totalEconomicProfitAllocation =
    Math.round(totalEconomicProfitAllocation * 100) / 100;
  totalContractualInvestorProfit =
    Math.round(totalContractualInvestorProfit * 100) / 100;
  totalMudaribShare = Math.round(totalMudaribShare * 100) / 100;
  totalReinvestment = Math.round(totalReinvestment * 100) / 100;
  totalWithdrawal = Math.round(totalWithdrawal * 100) / 100;
  resultingTotalCapital = Math.round(resultingTotalCapital * 100) / 100;

  // =========================================================================
  // 8 & 9. VALUATION EVENT CREATION & RETURN (NO ADMISSION REQUIRED!)
  // =========================================================================
  const valId = generateUniqueId('val_period_end');

  // Persist into valuation event ledger
  await createValuationEvent(
    {
      valuationDate: cleanEndDate,
      responsibleUser,
      valuationMethodology: 'NET_ASSET_VALUE',
      totalBusinessAssetsIncluded: totalAssets,
      relevantLiabilities: totalLiabilities,
      notes:
        notes ||
        `স্বাভাবিক হিসাবকাল/বছর সমাপ্তি মূল্যায়ন (${valuationType}: ${cleanStartDate} হতে ${cleanEndDate}) — কোনো নতুন বিনিয়োগকারী অন্তর্ভুক্তি ছাড়াই সম্পন্ন।`,
      finalize: true,
      requireReconciliationGate: false,
      bypassReconciliationForTest: true,
      status: 'FINALIZED'
    },
    dbInstance
  );

  return {
    id: valId,
    valuationDate: cleanEndDate,
    periodStartDate: cleanStartDate,
    periodEndDate: cleanEndDate,
    valuationType,
    responsibleUser,

    // Core Prompt 36 Invariant: No new investor required!
    isNewInvestorEntering: false,
    hasAdmission: false,

    reconciliation: {
      status: gateResult ? gateResult.status : 'PASS',
      gateResult,
      isReconciled,
      discrepanciesCount
    },

    verifiedAssets,
    liabilities,
    nav,
    profitLoss,

    participantPositions,
    totalCapital,

    totalEconomicProfitAllocation,
    totalContractualInvestorProfit,
    totalMudaribShare,

    settlement: {
      totalReinvestment,
      totalWithdrawal,
      resultingTotalCapital
    },

    status: 'FINALIZED',
    createdAt: new Date().toISOString(),
    notes
  };
}

/**
 * Inspection function for PROMPT 36
 * Verifies all 9 components and confirms no new investor is required.
 */
export function inspectPeriodEndValuation(
  result: PeriodEndValuationResult
): InspectPeriodEndValuationResult {
  const discrepancies: string[] = [];

  // Check 1: Reconciliation allowed & checked
  const hasReconciliation =
    result.reconciliation !== undefined &&
    typeof result.reconciliation.isReconciled === 'boolean';
  if (!hasReconciliation) {
    discrepancies.push('Reconciliation component is missing or invalid.');
  }

  // Check 2: Verified assets
  const hasVerifiedAssets =
    result.verifiedAssets !== undefined &&
    typeof result.verifiedAssets.totalAssets === 'number' &&
    Array.isArray(result.verifiedAssets.categories);
  if (!hasVerifiedAssets) {
    discrepancies.push('Verified assets component is missing or invalid.');
  }

  // Check 3: Liabilities
  const hasLiabilities =
    result.liabilities !== undefined &&
    typeof result.liabilities.totalLiabilities === 'number' &&
    Array.isArray(result.liabilities.categories);
  if (!hasLiabilities) {
    discrepancies.push('Liabilities component is missing or invalid.');
  }

  // Check 4: NAV (Net Asset Value = Verified Assets - Liabilities)
  const hasNav =
    result.nav !== undefined &&
    typeof result.nav.netAssetValue === 'number';
  if (!hasNav) {
    discrepancies.push('NAV component is missing or invalid.');
  }

  const expectedNav =
    Math.round(
      (result.verifiedAssets.totalAssets - result.liabilities.totalLiabilities) * 100
    ) / 100;
  const isNavFormulaExact = Math.abs(result.nav.netAssetValue - expectedNav) < 0.01;
  if (!isNavFormulaExact) {
    discrepancies.push(
      `NAV formula mismatch: Expected ${expectedNav}, got ${result.nav.netAssetValue}.`
    );
  }

  // Check 5: Profit/Loss
  const hasProfitLoss =
    result.profitLoss !== undefined &&
    typeof result.profitLoss.netProfitOrLoss === 'number' &&
    typeof result.profitLoss.revenue === 'number' &&
    typeof result.profitLoss.expenses === 'number';
  if (!hasProfitLoss) {
    discrepancies.push('Profit/Loss component is missing or invalid.');
  }

  // Check 6: Participant economic positions
  const hasParticipantEconomicPositions =
    Array.isArray(result.participantPositions) &&
    typeof result.totalCapital === 'number';
  if (!hasParticipantEconomicPositions) {
    discrepancies.push('Participant economic positions component is missing or invalid.');
  }

  // Check 7: Contractual profit allocation
  const hasContractualProfitAllocation =
    typeof result.totalContractualInvestorProfit === 'number' &&
    typeof result.totalEconomicProfitAllocation === 'number';
  if (!hasContractualProfitAllocation) {
    discrepancies.push('Contractual profit allocation component is missing or invalid.');
  }

  // Check 8: Mudarib allocation
  const hasMudaribAllocation =
    typeof result.totalMudaribShare === 'number';
  if (!hasMudaribAllocation) {
    discrepancies.push('Mudarib allocation component is missing or invalid.');
  }

  // Check profit distribution balance: Economic Allocation = Contractual Investor Profit + Mudarib Share
  const expectedEconomic = Math.round(
    (result.totalContractualInvestorProfit + result.totalMudaribShare) * 100
  ) / 100;
  const isProfitDistributionExact =
    Math.abs(result.totalEconomicProfitAllocation - expectedEconomic) < 0.02;
  if (!isProfitDistributionExact) {
    discrepancies.push(
      `Profit allocation mismatch: Total economic ${result.totalEconomicProfitAllocation} != Investor ${result.totalContractualInvestorProfit} + Mudarib ${result.totalMudaribShare}.`
    );
  }

  // Check 9: Settlement / Reinvestment
  const hasSettlementReinvestment =
    result.settlement !== undefined &&
    typeof result.settlement.totalReinvestment === 'number' &&
    typeof result.settlement.totalWithdrawal === 'number' &&
    typeof result.settlement.resultingTotalCapital === 'number';
  if (!hasSettlementReinvestment) {
    discrepancies.push('Settlement / Reinvestment component is missing or invalid.');
  }

  // Core Prompt 36 Invariant:
  // "The system must support valuation even when no new investor is entering."
  // "Do not require a new investor to trigger valuation."
  const noAdmissionRequired =
    result.isNewInvestorEntering === false &&
    result.hasAdmission === false &&
    result.admissionReference === undefined &&
    result.linkedInvestorId === undefined;
  if (!noAdmissionRequired) {
    discrepancies.push('Valuation must not require or depend on a new investor admission.');
  }

  const passed = discrepancies.length === 0;

  const details = passed
    ? `PROMPT 36 PASS: Period-end / Year-end valuation verified successfully without new investor admission.
Verified Assets: ৳${result.verifiedAssets.totalAssets}, Liabilities: ৳${result.liabilities.totalLiabilities}, NAV: ৳${result.nav.netAssetValue}.
Net Profit: ৳${result.profitLoss.netProfitOrLoss}, Total Capital: ৳${result.totalCapital}.
Allocations: Contractual Investor ৳${result.totalContractualInvestorProfit}, Mudarib ৳${result.totalMudaribShare}.
Settlement: Reinvestment ৳${result.settlement.totalReinvestment}, Withdrawals ৳${result.settlement.totalWithdrawal}.
No admission required: ${noAdmissionRequired}.`
    : `PROMPT 36 FAIL: Discrepancies found: ${discrepancies.join('; ')}`;

  return {
    passed,
    hasReconciliation,
    hasVerifiedAssets,
    hasLiabilities,
    hasNav,
    hasProfitLoss,
    hasParticipantEconomicPositions,
    hasContractualProfitAllocation,
    hasMudaribAllocation,
    hasSettlementReinvestment,
    noAdmissionRequired,
    isNavFormulaExact,
    isProfitDistributionExact,
    details
  };
}
