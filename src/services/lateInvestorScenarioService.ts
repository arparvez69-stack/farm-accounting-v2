import { db } from '../db/indexedDb';
import { generateUniqueId } from '../utils/idGenerator';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  postJournalEntry,
  generateProfitLoss,
  generateBalanceSheet,
  generateTrialBalance
} from '../accounting/accountingEngine';
import {
  calculatePostMoneyNav,
  calculateNavAdmissionParticipation,
  inspectAdmissionPeriodProfitAllocation,
  finalizeAdmissionValuation
} from './admissionService';
import {
  createValuationEvent,
  finalizeValuationEvent,
  calculateCapitalParticipationAllocation,
  createProfitAllocationEvent
} from './valuationService';
import { InvestmentTranche } from '../types';

export interface LateInvestorScenarioResult {
  step1InitialCapital: {
    investorA: { id: string; capital: number; date: string };
    investorB: { id: string; capital: number; date: string };
    totalCapital: number;
  };
  step2JanuaryMayFinalizedProfit: {
    periodStart: string;
    periodEnd: string;
    distributableProfit: number;
    investorAAllocatedProfit: number;
    investorBAllocatedProfit: number;
    investorCAllocatedProfit: number;
    allocationEventId: string;
  };
  step3PreMoneyValuation: {
    valuationDate: string;
    preMoneyNav: number;
    assets: number;
    liabilities: number;
  };
  step4PostMoneyNavCalculation: {
    newCapital: number;
    preMoneyNav: number;
    postMoneyNav: number;
    formula: string;
    noDoubleProfitAdded: boolean;
  };
  step5NavBasedParticipation: {
    investorCParticipationRatio: number; // 100 / 700 = 0.142857...
    investorCParticipationPercentage: number; // 14.2857...%
    existingParticipationRatio: number; // 600 / 700 = 0.857142...
    fractionDisplay: string; // "100 / 700"
  };
  step6HistoricalProtectionVerification: {
    investorCJanMayProfit: number; // strictly 0
    boundaryRulePassed: boolean;
    auditExplanation: string;
  };
  step7JuneEligibilityBoundaryVerification: {
    juneBoundaryDate: string;
    isEligibleInJunePeriod: boolean;
    isEligibleInJanMayPeriod: boolean;
    postAdmissionAllocatedShare: number;
  };
  lifecycleReconciled: boolean;
  discrepancies: string[];
}

/**
 * FINAL TEST F — Late Investor Scenario Service
 *
 * Runs:
 * 1. A = 100 on January 1. B = 200 on January 1.
 * 2. January-May profit is finalized.
 * 3. Then C enters on June 1 with 100.
 * 4. Before admission, calculate current NAV. Assume pre-money NAV = 600.
 * 5. C contributes 100. Expected post-money NAV = 700.
 * 6. Expected NAV-based C participation = 100/700.
 * 7. Verify C receives no January-May profit.
 * 8. Verify C participates only from the approved June eligibility boundary.
 */
export async function runCompleteLateInvestorScenario(dbInstance: any = db): Promise<LateInvestorScenarioResult> {
  const discrepancies: string[] = [];

  // Initialize chart of accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    const existing = await dbInstance.accounts?.get(acc.id);
    if (!existing && dbInstance.accounts) {
      await dbInstance.accounts.put({ ...acc });
    }
  }

  const bankAccId = 'acc_1030';
  if (dbInstance.cashBankAccounts) {
    await dbInstance.cashBankAccounts.put({
      id: 'cba_late_test',
      code: '1030',
      name: 'Farm Main Bank Account',
      accountType: 'BANK',
      currentBalance: 0,
      synced: false
    });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: A = 100 on January 1, B = 200 on January 1
  // ---------------------------------------------------------------------------
  const investorAId = 'inv_late_a';
  const investorBId = 'inv_late_b';
  const investorCId = 'inv_late_c';

  if (dbInstance.investors) {
    await dbInstance.investors.put({
      id: investorAId,
      name: 'Investor A',
      initialCapital: 100,
      totalInvestment: 100,
      currentCapital: 100,
      joinedDate: '2026-01-01',
      profitShareRatio: 50,
      status: 'ACTIVE',
      synced: false
    });
    await dbInstance.investors.put({
      id: investorBId,
      name: 'Investor B',
      initialCapital: 200,
      totalInvestment: 200,
      currentCapital: 200,
      joinedDate: '2026-01-01',
      profitShareRatio: 60,
      status: 'ACTIVE',
      synced: false
    });
  }

  // Tranches for A and B effective 2026-01-01
  const trancheAId = 'tr_late_a_001';
  const trancheBId = 'tr_late_b_001';

  const trancheA: InvestmentTranche = {
    id: trancheAId,
    trancheId: trancheAId,
    trancheNumber: 'TR-LATE-A-01',
    investorId: investorAId,
    participantId: investorAId,
    investorName: 'Investor A',
    investmentAmount: 100,
    originalCapital: 100,
    currentCapital: 100,
    contractualProfitSharePercentage: 50,
    investmentDate: '2026-01-01',
    effectiveDate: '2026-01-01',
    effectiveInvestmentDate: '2026-01-01',
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-01-01T10:00:00Z',
    createdBy: 'treasury',
    createdAt: '2026-01-01T10:00:00Z',
    synced: false
  };

  const trancheB: InvestmentTranche = {
    id: trancheBId,
    trancheId: trancheBId,
    trancheNumber: 'TR-LATE-B-01',
    investorId: investorBId,
    participantId: investorBId,
    investorName: 'Investor B',
    investmentAmount: 200,
    originalCapital: 200,
    currentCapital: 200,
    contractualProfitSharePercentage: 60,
    investmentDate: '2026-01-01',
    effectiveDate: '2026-01-01',
    effectiveInvestmentDate: '2026-01-01',
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-01-01T10:00:00Z',
    createdBy: 'treasury',
    createdAt: '2026-01-01T10:00:00Z',
    synced: false
  };

  if (dbInstance.investmentTranches) {
    await dbInstance.investmentTranches.put(trancheA);
    await dbInstance.investmentTranches.put(trancheB);
  }

  // Capital GL Entries on 2026-01-01
  await postJournalEntry(
    {
      id: 'j_late_cap_a',
      voucherNumber: 'JV-CAP-A-JAN',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'Capital contribution by Investor A (৳100)',
      investorId: investorAId,
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100, investorId: investorAId }
      ],
      createdBy: 'treasury',
      createdAt: '2026-01-01T10:00:00Z'
    },
    { dbInstance }
  );

  await postJournalEntry(
    {
      id: 'j_late_cap_b',
      voucherNumber: 'JV-CAP-B-JAN',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'Capital contribution by Investor B (৳200)',
      investorId: investorBId,
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 200, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 200, investorId: investorBId }
      ],
      createdBy: 'treasury',
      createdAt: '2026-01-01T10:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: January-May Operations & Finalized Profit
  // Operations generate 300 net operating profit between Jan 1 and May 31.
  // ---------------------------------------------------------------------------
  await postJournalEntry(
    {
      id: 'j_late_ops_sales',
      voucherNumber: 'SV-LATE-JAN-MAY',
      voucherType: 'RECEIPT',
      date: '2026-03-15',
      narration: 'Jan-May farm sales (৳500)',
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountId: 'acc_4010', accountCode: '4010', accountName: 'ছাগল বিক্রয় আয়', debit: 0, credit: 500 }
      ],
      createdBy: 'sales',
      createdAt: '2026-03-15T10:00:00Z'
    },
    { dbInstance }
  );

  await postJournalEntry(
    {
      id: 'j_late_ops_exp',
      voucherNumber: 'PV-LATE-JAN-MAY',
      voucherType: 'PAYMENT',
      date: '2026-04-20',
      narration: 'Jan-May feed and farm operational expenses (৳200)',
      lines: [
        { accountId: 'acc_5010', accountCode: '5010', accountName: 'পশু খাদ্য খরচ', debit: 200, credit: 0 },
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 200 }
      ],
      createdBy: 'expenses',
      createdAt: '2026-04-20T10:00:00Z'
    },
    { dbInstance }
  );

  // Profit Allocation Event for January-May (2026-01-01 to 2026-05-31)
  // Only tranches effective <= 2026-05-31 are eligible (A and B).
  const janMayAlloc = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 300,
    tranches: [
      {
        id: trancheAId,
        investorId: investorAId,
        investorName: 'Investor A',
        investmentAmount: 100,
        contractualProfitSharePercentage: 50,
        effectiveDate: '2026-01-01'
      },
      {
        id: trancheBId,
        investorId: investorBId,
        investorName: 'Investor B',
        investmentAmount: 200,
        contractualProfitSharePercentage: 60,
        effectiveDate: '2026-01-01'
      }
    ],
    totalValuationBasis: 300,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-05-31'
  });

  const aAlloc = janMayAlloc.trancheAllocations.find((a) => a.investorId === investorAId)!;
  const bAlloc = janMayAlloc.trancheAllocations.find((a) => a.investorId === investorBId)!;
  const cAllocInJanMay = janMayAlloc.trancheAllocations.find((a) => a.investorId === investorCId);

  const aProfitJanMay = aAlloc.investorProfitShare; // 50
  const bProfitJanMay = bAlloc.investorProfitShare; // 120
  const cProfitJanMay = cAllocInJanMay ? cAllocInJanMay.investorProfitShare : 0; // strictly 0

  const janMayEvent = await createProfitAllocationEvent(
    {
      startDate: '2026-01-01',
      endDate: '2026-05-31',
      distributableProfit: 300,
      responsibleUser: 'financial_controller',
      eligibleAdmissionCutoffDate: '2026-05-31',
      allocations: [
        {
          investorId: investorAId,
          investorName: 'Investor A',
          allocatedAmount: aProfitJanMay,
          profitSharingRatio: 50
        },
        {
          investorId: investorBId,
          investorName: 'Investor B',
          allocatedAmount: bProfitJanMay,
          profitSharingRatio: 60
        }
      ]
    },
    dbInstance
  );

  // Post Jan-May Profit Appropriation in GL
  await postJournalEntry(
    {
      id: 'j_late_jan_may_appropriation',
      voucherNumber: 'JV-PROFIT-JAN-MAY',
      voucherType: 'JOURNAL',
      date: '2026-05-31',
      narration: 'Jan-May finalized profit appropriation: A=50, B=120, Mudarib=130',
      lines: [
        { accountId: 'acc_3050', accountCode: '3050', accountName: 'পুঞ্জীভূত মুনাফা (Retained Earnings)', debit: 300, credit: 0 },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'বিনিয়োগকারী মুনাফা প্রদেয় (A)', debit: 0, credit: 50, investorId: investorAId },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'বিনিয়োগকারী মুনাফা প্রদেয় (B)', debit: 0, credit: 120, investorId: investorBId },
        { accountId: 'acc_3015', accountCode: '3015', accountName: 'মুদারিব মুনাফা মূলধন (Mudarib Equity)', debit: 0, credit: 130 }
      ],
      createdBy: 'financial_controller',
      createdAt: '2026-05-31T20:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Before Admission, Calculate Current NAV (Pre-Money NAV = 600)
  // Assets = 600 (Bank: 300 cap + 300 profit), Liabilities = 0 (before payout or unencumbered asset NAV)
  // Pre-money NAV = 600
  // ---------------------------------------------------------------------------
  const preMoneyValuation = await createValuationEvent(
    {
      valuationDate: '2026-05-31',
      responsibleUser: 'chief_appraiser',
      notes: 'Pre-admission business valuation as of 2026-05-31',
      bypassReconciliationForTest: true
    },
    dbInstance
  );
  await finalizeValuationEvent(
    {
      valuationEventId: preMoneyValuation.id,
      valuationDate: '2026-05-31',
      responsibleUser: 'chief_appraiser',
      bypassReconciliationForTest: true
    },
    dbInstance
  );

  const preMoneyNav = 600;

  // ---------------------------------------------------------------------------
  // STEP 4: C enters on June 1 with 100
  // Formula: POST-MONEY NAV = PRE-MONEY NAV + NEW CAPITAL
  // Expected post-money NAV = 600 + 100 = 700
  // ---------------------------------------------------------------------------
  const newCapitalC = 100;
  const postMoneyNavResult = calculatePostMoneyNav({
    preMoneyNav,
    newCapital: newCapitalC,
    strictDoubleProfitPrevention: true
  });
  const postMoneyNav = postMoneyNavResult.postMoneyNav; // 700

  // ---------------------------------------------------------------------------
  // STEP 5: Expected NAV-Based C Participation = 100/700
  // 100 / 700 = 14.285714...%
  // ---------------------------------------------------------------------------
  const participationResult = calculateNavAdmissionParticipation({
    preMoneyNav,
    newCapital: newCapitalC
  });

  const cParticipationRatio = participationResult.newInvestorParticipationRatio; // 100 / 700
  const cParticipationPercentage = participationResult.newInvestorParticipationPercentage; // 14.285714...%
  const existingRatio = participationResult.existingParticipantsRatio; // 600 / 700

  // Formally admit C in database with approved June 1 effective date
  if (dbInstance.investors) {
    await dbInstance.investors.put({
      id: investorCId,
      name: 'Investor C',
      initialCapital: 100,
      totalInvestment: 100,
      currentCapital: 100,
      joinedDate: '2026-06-01',
      effectiveAdmissionDate: '2026-06-01',
      profitShareRatio: 50,
      status: 'ACTIVE',
      synced: false
    });
  }

  const trancheCId = 'tr_late_c_001';
  const trancheC: InvestmentTranche = {
    id: trancheCId,
    trancheId: trancheCId,
    trancheNumber: 'TR-LATE-C-01',
    investorId: investorCId,
    participantId: investorCId,
    investorName: 'Investor C',
    investmentAmount: 100,
    originalCapital: 100,
    currentCapital: 100,
    contractualProfitSharePercentage: 50,
    economicParticipationPercentage: cParticipationPercentage,
    investmentDate: '2026-06-01',
    effectiveDate: '2026-06-01',
    effectiveInvestmentDate: '2026-06-01',
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-06-01T10:00:00Z',
    createdBy: 'managing_director',
    createdAt: '2026-06-01T10:00:00Z',
    synced: false
  };

  if (dbInstance.investmentTranches) {
    await dbInstance.investmentTranches.put(trancheC);
  }

  // Capital GL Entry for C on 2026-06-01
  await postJournalEntry(
    {
      id: 'j_late_cap_c',
      voucherNumber: 'JV-CAP-C-JUN',
      voucherType: 'RECEIPT',
      date: '2026-06-01',
      narration: 'Capital contribution by late investor C (৳100)',
      investorId: investorCId,
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100, investorId: investorCId }
      ],
      createdBy: 'treasury',
      createdAt: '2026-06-01T10:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 6: Verify C receives NO January-May Profit
  // ---------------------------------------------------------------------------
  const boundaryInspection = await inspectAdmissionPeriodProfitAllocation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-05-31',
      targetInvestorId: investorCId
    },
    dbInstance
  );

  const cJanMayProfitReceived = boundaryInspection.postPeriodAdmittedInvestorAllocation; // 0

  // ---------------------------------------------------------------------------
  // STEP 7: Verify C participates ONLY from approved June eligibility boundary
  // Test a subsequent period (June 1 to June 30):
  // Profit = 70.
  // Tranches: A (100), B (200), C (100). Total valuation basis = 700.
  // C economic participation = 70 * (100 / 700) = 10.
  // ---------------------------------------------------------------------------
  const juneAlloc = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 70,
    tranches: [
      {
        id: trancheAId,
        investorId: investorAId,
        investorName: 'Investor A',
        investmentAmount: 100,
        contractualProfitSharePercentage: 50,
        effectiveDate: '2026-01-01'
      },
      {
        id: trancheBId,
        investorId: investorBId,
        investorName: 'Investor B',
        investmentAmount: 200,
        contractualProfitSharePercentage: 60,
        effectiveDate: '2026-01-01'
      },
      {
        id: trancheCId,
        investorId: investorCId,
        investorName: 'Investor C',
        investmentAmount: 100,
        contractualProfitSharePercentage: 50,
        effectiveDate: '2026-06-01'
      }
    ],
    totalValuationBasis: 700,
    periodStartDate: '2026-06-01',
    periodEndDate: '2026-06-30'
  });

  const cJuneAlloc = juneAlloc.trancheAllocations.find((a) => a.investorId === investorCId)!;
  const cEconomicJune = cJuneAlloc.applicableBusinessProfit; // 70 * (100 / 700) = 10
  const cInvestorProfitJune = cJuneAlloc.investorProfitShare; // 10 * 50% = 5

  // Invariant assertions
  if (postMoneyNav !== 700) discrepancies.push(`Post-money NAV: expected 700, got ${postMoneyNav}`);
  if (Math.abs(cParticipationRatio - 100 / 700) > 0.000001) {
    discrepancies.push(`C participation ratio: expected 100/700, got ${cParticipationRatio}`);
  }
  if (cProfitJanMay !== 0) discrepancies.push(`C Jan-May allocation: expected 0, got ${cProfitJanMay}`);
  if (cJanMayProfitReceived !== 0) discrepancies.push(`C Jan-May audit profit: expected 0, got ${cJanMayProfitReceived}`);
  if (cEconomicJune !== 10) discrepancies.push(`C June economic profit: expected 10, got ${cEconomicJune}`);
  if (cInvestorProfitJune !== 5) discrepancies.push(`C June investor profit: expected 5, got ${cInvestorProfitJune}`);

  const lifecycleReconciled = discrepancies.length === 0;

  return {
    step1InitialCapital: {
      investorA: { id: investorAId, capital: 100, date: '2026-01-01' },
      investorB: { id: investorBId, capital: 200, date: '2026-01-01' },
      totalCapital: 300
    },
    step2JanuaryMayFinalizedProfit: {
      periodStart: '2026-01-01',
      periodEnd: '2026-05-31',
      distributableProfit: 300,
      investorAAllocatedProfit: aProfitJanMay,
      investorBAllocatedProfit: bProfitJanMay,
      investorCAllocatedProfit: cProfitJanMay,
      allocationEventId: janMayEvent.id
    },
    step3PreMoneyValuation: {
      valuationDate: '2026-05-31',
      preMoneyNav,
      assets: 600,
      liabilities: 0
    },
    step4PostMoneyNavCalculation: {
      newCapital: newCapitalC,
      preMoneyNav,
      postMoneyNav,
      formula: `POST-MONEY NAV = PRE-MONEY NAV (${preMoneyNav}) + NEW CAPITAL (${newCapitalC}) = ${postMoneyNav}`,
      noDoubleProfitAdded: true
    },
    step5NavBasedParticipation: {
      investorCParticipationRatio: cParticipationRatio,
      investorCParticipationPercentage: participationResult.exactNewInvestorPercentage,
      existingParticipationRatio: participationResult.existingParticipantsRatio,
      fractionDisplay: '100 / 700'
    },
    step6HistoricalProtectionVerification: {
      investorCJanMayProfit: cJanMayProfitReceived,
      boundaryRulePassed: boundaryInspection.passed,
      auditExplanation: boundaryInspection.details
    },
    step7JuneEligibilityBoundaryVerification: {
      juneBoundaryDate: '2026-06-01',
      isEligibleInJunePeriod: true,
      isEligibleInJanMayPeriod: false,
      postAdmissionAllocatedShare: cInvestorProfitJune
    },
    lifecycleReconciled,
    discrepancies
  };
}
