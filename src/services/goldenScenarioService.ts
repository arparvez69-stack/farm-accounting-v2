import { db } from '../db/indexedDb';
import { generateUniqueId } from '../utils/idGenerator';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  postJournalEntry,
  generateProfitLoss,
  generateBalanceSheet,
  generateTrialBalance,
  BalanceSheetReport
} from '../accounting/accountingEngine';
import {
  calculateCapitalParticipationAllocation,
  calculateNetAssetValuation,
  createValuationEvent,
  finalizeValuationEvent
} from './valuationService';
import { executeParticipantProfitSettlement } from './settlementService';
import { InvestmentTranche } from '../types';

export interface GoldenScenarioResult {
  step1Capital: {
    investorA: { id: string; capital: number };
    investorB: { id: string; capital: number };
    totalCapital: number;
    bankBalance: number;
  };
  step2Operations: {
    revenue: number;
    expenses: number;
    distributableProfit: number;
    bankBalance: number;
  };
  step3ProfitAllocation: {
    investorA: {
      economicProfit: number;
      contractPercentage: number;
      investorProfit: number;
      mudaribShare: number;
    };
    investorB: {
      economicProfit: number;
      contractPercentage: number;
      investorProfit: number;
      mudaribShare: number;
    };
    totalInvestorProfit: number;
    totalMudaribProfit: number;
    sumProfits: number;
    isAllocatedCleanly: boolean;
  };
  step4Settlement: {
    investorA: {
      reinvestPercentage: number;
      reinvestedCapital: number;
      withdrawableAmount: number;
      initialCapital: number;
      futureCapitalPosition: number;
    };
    investorB: {
      reinvestPercentage: number;
      reinvestedCapital: number;
      withdrawableAmount: number;
      initialCapital: number;
      futureCapitalPosition: number;
    };
    totalReinvested: number;
    totalWithdrawn: number;
    bankBalanceAfterSettlement: number;
  };
  step5PostSettlementValuation: {
    valuationDate: string;
    totalAssets: number;
    totalLiabilities: number;
    nav: number;
    formula: string;
    isBalanced: boolean;
  };
  lifecycleReconciled: boolean;
  discrepancies: string[];
}

/**
 * FINAL TEST E — Complete Golden Scenario Service
 *
 * Runs:
 * 1. A invests 100 in January. B invests 200 in January.
 * 2. Business generates 300 distributable profit.
 * 3. Contractual Rates: A = 50%, B = 60%.
 *    Expected:
 *      A economic profit = 100.
 *      B economic profit = 200.
 *      A investor profit = 50. A Mudarib share = 50.
 *      B investor profit = 120. B Mudarib share = 80.
 *      Total investor profit = 170. Total Mudarib profit = 130.
 * 4. Settlements:
 *      A reinvests 50% (reinvest 25, withdraw 25). Future capital = 125.
 *      B reinvests 100% (reinvest 120, withdraw 0). Future capital = 320.
 * 5. Accounting Entries & Balance Sheet Verification.
 * 6. New Valuation: NAV = Assets - Liabilities = 575.
 */
export async function runCompleteGoldenScenario(dbInstance: any = db): Promise<GoldenScenarioResult> {
  const discrepancies: string[] = [];

  // Initialize standard chart of accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    const existing = await dbInstance.accounts?.get(acc.id);
    if (!existing && dbInstance.accounts) {
      await dbInstance.accounts.put({ ...acc });
    }
  }

  // Setup Bank Account
  const bankAccId = 'acc_1030';
  if (dbInstance.cashBankAccounts) {
    await dbInstance.cashBankAccounts.put({
      id: 'cba_main_farm',
      code: '1030',
      name: 'Farm Main Bank Account',
      accountType: 'BANK',
      currentBalance: 0,
      synced: false
    });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: A invests 100, B invests 200 in January 2026
  // ---------------------------------------------------------------------------
  const investorAId = 'inv_golden_a';
  const investorBId = 'inv_golden_b';
  const investorAName = 'Investor A';
  const investorBName = 'Investor B';

  if (dbInstance.investors) {
    await dbInstance.investors.put({
      id: investorAId,
      name: investorAName,
      initialCapital: 100,
      totalInvestment: 100,
      currentCapital: 100,
      profitShareRatio: 50,
      status: 'ACTIVE',
      synced: false
    });
    await dbInstance.investors.put({
      id: investorBId,
      name: investorBName,
      initialCapital: 200,
      totalInvestment: 200,
      currentCapital: 200,
      profitShareRatio: 60,
      status: 'ACTIVE',
      synced: false
    });
  }

  // Initial Tranches
  const trancheAId = 'tr_golden_a_001';
  const trancheBId = 'tr_golden_b_001';

  const trancheA: InvestmentTranche = {
    id: trancheAId,
    trancheId: trancheAId,
    trancheNumber: 'TR-GOLDEN-A-01',
    investorId: investorAId,
    participantId: investorAId,
    investorName: investorAName,
    investmentAmount: 100,
    originalCapital: 100,
    currentCapital: 100,
    contractualProfitSharePercentage: 50,
    investmentDate: '2026-01-05',
    effectiveDate: '2026-01-05',
    effectiveInvestmentDate: '2026-01-05',
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-01-05T10:00:00Z',
    createdBy: 'treasury',
    createdAt: '2026-01-05T10:00:00Z',
    synced: false
  };

  const trancheB: InvestmentTranche = {
    id: trancheBId,
    trancheId: trancheBId,
    trancheNumber: 'TR-GOLDEN-B-01',
    investorId: investorBId,
    participantId: investorBId,
    investorName: investorBName,
    investmentAmount: 200,
    originalCapital: 200,
    currentCapital: 200,
    contractualProfitSharePercentage: 60,
    investmentDate: '2026-01-10',
    effectiveDate: '2026-01-10',
    effectiveInvestmentDate: '2026-01-10',
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-01-10T10:00:00Z',
    createdBy: 'treasury',
    createdAt: '2026-01-10T10:00:00Z',
    synced: false
  };

  if (dbInstance.investmentTranches) {
    await dbInstance.investmentTranches.put(trancheA);
    await dbInstance.investmentTranches.put(trancheB);
  }

  // Post Capital Inflow Journal Entries in GL
  // Investor A: 100
  await postJournalEntry(
    {
      id: 'j_golden_cap_a',
      voucherNumber: 'JV-CAP-A',
      voucherType: 'RECEIPT',
      date: '2026-01-05',
      narration: 'Capital contribution by Investor A (৳100)',
      investorId: investorAId,
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100, investorId: investorAId }
      ],
      createdBy: 'treasury',
      createdAt: '2026-01-05T10:00:00Z'
    },
    { dbInstance }
  );

  // Investor B: 200
  await postJournalEntry(
    {
      id: 'j_golden_cap_b',
      voucherNumber: 'JV-CAP-B',
      voucherType: 'RECEIPT',
      date: '2026-01-10',
      narration: 'Capital contribution by Investor B (৳200)',
      investorId: investorBId,
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 200, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 200, investorId: investorBId }
      ],
      createdBy: 'treasury',
      createdAt: '2026-01-10T10:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Business generates 300 distributable profit
  // Operating Revenue: 500, Operating Expenses: 200 -> Net Profit = 300
  // ---------------------------------------------------------------------------
  await postJournalEntry(
    {
      id: 'j_golden_sales',
      voucherNumber: 'SV-GOLDEN-01',
      voucherType: 'RECEIPT',
      date: '2026-02-15',
      narration: 'Goat farm sales revenue (৳500)',
      lines: [
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountId: 'acc_4010', accountCode: '4010', accountName: 'ছাগল বিক্রয় আয়', debit: 0, credit: 500 }
      ],
      createdBy: 'sales_officer',
      createdAt: '2026-02-15T12:00:00Z'
    },
    { dbInstance }
  );

  await postJournalEntry(
    {
      id: 'j_golden_expenses',
      voucherNumber: 'PV-GOLDEN-01',
      voucherType: 'PAYMENT',
      date: '2026-02-28',
      narration: 'Farm operational expenses (৳200)',
      lines: [
        { accountId: 'acc_5010', accountCode: '5010', accountName: 'পশু খাদ্য খরচ', debit: 200, credit: 0 },
        { accountId: bankAccId, accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 200 }
      ],
      createdBy: 'expense_officer',
      createdAt: '2026-02-28T12:00:00Z'
    },
    { dbInstance }
  );

  const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, dbInstance);
  const distributableProfit = pnl.netProfit; // 300

  // ---------------------------------------------------------------------------
  // STEP 3: Profit Allocation
  // Total Distributable Profit = 300
  // Tranches: A (100, 50%), B (200, 60%)
  // ---------------------------------------------------------------------------
  const allocResult = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: distributableProfit,
    tranches: [
      {
        id: trancheAId,
        investorId: investorAId,
        investorName: investorAName,
        investmentAmount: 100,
        contractualProfitSharePercentage: 50
      },
      {
        id: trancheBId,
        investorId: investorBId,
        investorName: investorBName,
        investmentAmount: 200,
        contractualProfitSharePercentage: 60
      }
    ],
    totalValuationBasis: 300,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-03-31'
  });

  const aAlloc = allocResult.trancheAllocations.find((a) => a.investorId === investorAId)!;
  const bAlloc = allocResult.trancheAllocations.find((a) => a.investorId === investorBId)!;

  const aEconomic = aAlloc.applicableBusinessProfit; // 100
  const bEconomic = bAlloc.applicableBusinessProfit; // 200

  const aInvestorProfit = aAlloc.investorProfitShare; // 50
  const aMudaribShare = aAlloc.workingPartnerProfitShare; // 50

  const bInvestorProfit = bAlloc.investorProfitShare; // 120
  const bMudaribShare = bAlloc.workingPartnerProfitShare; // 80

  const totalInvestorProfit = aInvestorProfit + bInvestorProfit; // 170
  const totalMudaribProfit = aMudaribShare + bMudaribShare; // 130
  const sumProfits = totalInvestorProfit + totalMudaribProfit; // 300

  // Post Profit Appropriation in General Ledger:
  // Retained Earnings (3050): Debit 300
  // Investor Profit Payable (2050): Credit 170 (A: 50, B: 120)
  // Mudarib Profit Equity (3015): Credit 130
  const sourceAllocId = `pae_golden_${Date.now()}`;
  await postJournalEntry(
    {
      id: 'j_golden_profit_appropriation',
      voucherNumber: 'JV-PROFIT-ALLOC-01',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Distribution of Q1 net profit to Investor Payables and Mudarib Equity',
      lines: [
        { accountId: 'acc_3050', accountCode: '3050', accountName: 'পুঞ্জীভূত মুনাফা (Retained Earnings)', debit: 300, credit: 0 },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'বিনিয়োগকারী মুনাফা প্রদেয় (A)', debit: 0, credit: 50, investorId: investorAId },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'বিনিয়োগকারী মুনাফা প্রদেয় (B)', debit: 0, credit: 120, investorId: investorBId },
        { accountId: 'acc_3015', accountCode: '3015', accountName: 'মুদারিব মুনাফা মূলধন (Mudarib Equity)', debit: 0, credit: 130 }
      ],
      createdBy: 'financial_controller',
      createdAt: '2026-03-31T20:00:00Z'
    },
    { dbInstance }
  );

  // Update investor profit payable in DB
  if (dbInstance.investors) {
    const invA = await dbInstance.investors.get(investorAId);
    if (invA) await dbInstance.investors.update(investorAId, { profitPayable: aInvestorProfit });
    const invB = await dbInstance.investors.get(investorBId);
    if (invB) await dbInstance.investors.update(investorBId, { profitPayable: bInvestorProfit });
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Settlements
  // A reinvests 50%: reinvest 25, withdraw 25
  // B reinvests 100%: reinvest 120, withdraw 0
  // ---------------------------------------------------------------------------
  const settleEventAId = 'settle_golden_a_001';
  const settleEventBId = 'settle_golden_b_001';

  const settleA = await executeParticipantProfitSettlement(
    {
      investorId: investorAId,
      participantId: investorAId,
      profit: aInvestorProfit, // 50
      reinvestPercentage: 50,
      date: '2026-04-01',
      effectiveDate: '2026-04-01',
      sourceProfitAllocationId: sourceAllocId,
      settlementEventId: settleEventAId,
      currentUserId: 'treasury',
      notes: 'Investor A Golden Settlement: 50% reinvest, 50% payout'
    },
    dbInstance
  );

  const settleB = await executeParticipantProfitSettlement(
    {
      investorId: investorBId,
      participantId: investorBId,
      profit: bInvestorProfit, // 120
      reinvestPercentage: 100,
      date: '2026-04-01',
      effectiveDate: '2026-04-01',
      sourceProfitAllocationId: sourceAllocId,
      settlementEventId: settleEventBId,
      currentUserId: 'treasury',
      notes: 'Investor B Golden Settlement: 100% reinvest'
    },
    dbInstance
  );

  // Retrieve post-settlement investors
  const finalInvA = await dbInstance.investors.get(investorAId);
  const finalInvB = await dbInstance.investors.get(investorBId);

  const aFutureCap = finalInvA?.currentCapital ?? (100 + settleA.reinvestedCapital);
  const bFutureCap = finalInvB?.currentCapital ?? (200 + settleB.reinvestedCapital);

  // ---------------------------------------------------------------------------
  // STEP 5: Post-Settlement Balance Sheet & New Valuation
  // ---------------------------------------------------------------------------
  const bs: BalanceSheetReport = await generateBalanceSheet('2026-04-01', dbInstance);
  const postValuation = await createValuationEvent(
    {
      valuationDate: '2026-04-01',
      responsibleUser: 'chief_audit_officer',
      notes: 'Post-settlement complete lifecycle valuation',
      bypassReconciliationForTest: true
    },
    dbInstance
  );
  await finalizeValuationEvent(
    {
      valuationEventId: postValuation.id,
      valuationDate: '2026-04-01',
      responsibleUser: 'chief_audit_officer',
      bypassReconciliationForTest: true
    },
    dbInstance
  );

  const totalAssets = bs.totalAssets; // 575 (Bank)
  const totalLiabilities = bs.totalLiabilities; // 0
  const closingNav = Math.round((totalAssets - totalLiabilities) * 100) / 100; // 575

  const formula = `NAV = Assets (৳${totalAssets}) − Liabilities (৳${totalLiabilities}) = ৳${closingNav}`;

  // Validate complete mathematical invariants
  if (aEconomic !== 100) discrepancies.push(`A economic profit: expected 100, got ${aEconomic}`);
  if (bEconomic !== 200) discrepancies.push(`B economic profit: expected 200, got ${bEconomic}`);
  if (aInvestorProfit !== 50) discrepancies.push(`A investor profit: expected 50, got ${aInvestorProfit}`);
  if (aMudaribShare !== 50) discrepancies.push(`A Mudarib share: expected 50, got ${aMudaribShare}`);
  if (bInvestorProfit !== 120) discrepancies.push(`B investor profit: expected 120, got ${bInvestorProfit}`);
  if (bMudaribShare !== 80) discrepancies.push(`B Mudarib share: expected 80, got ${bMudaribShare}`);
  if (totalInvestorProfit !== 170) discrepancies.push(`Total investor profit: expected 170, got ${totalInvestorProfit}`);
  if (totalMudaribProfit !== 130) discrepancies.push(`Total Mudarib profit: expected 130, got ${totalMudaribProfit}`);
  if (settleA.reinvestedCapital !== 25) discrepancies.push(`A reinvested capital: expected 25, got ${settleA.reinvestedCapital}`);
  if (settleA.withdrawableAmount !== 25) discrepancies.push(`A withdrawable amount: expected 25, got ${settleA.withdrawableAmount}`);
  if (aFutureCap !== 125) discrepancies.push(`A future capital position: expected 125, got ${aFutureCap}`);
  if (settleB.reinvestedCapital !== 120) discrepancies.push(`B reinvested capital: expected 120, got ${settleB.reinvestedCapital}`);
  if (settleB.withdrawableAmount !== 0) discrepancies.push(`B withdrawable amount: expected 0, got ${settleB.withdrawableAmount}`);
  if (bFutureCap !== 320) discrepancies.push(`B future capital position: expected 320, got ${bFutureCap}`);
  if (closingNav !== 575) discrepancies.push(`Closing NAV: expected 575, got ${closingNav}`);
  if (totalLiabilities !== 0) discrepancies.push(`Closing liabilities: expected 0, got ${totalLiabilities}`);

  const trialBalance = await generateTrialBalance({ endDate: '2026-04-01' }, dbInstance);
  if (!trialBalance.isBalanced) {
    discrepancies.push(`Trial balance unbalanced: Total Debit ${trialBalance.totalDebit} !== Total Credit ${trialBalance.totalCredit}`);
  }

  const lifecycleReconciled = discrepancies.length === 0;

  return {
    step1Capital: {
      investorA: { id: investorAId, capital: 100 },
      investorB: { id: investorBId, capital: 200 },
      totalCapital: 300,
      bankBalance: 300
    },
    step2Operations: {
      revenue: 500,
      expenses: 200,
      distributableProfit: 300,
      bankBalance: 600
    },
    step3ProfitAllocation: {
      investorA: {
        economicProfit: aEconomic,
        contractPercentage: 50,
        investorProfit: aInvestorProfit,
        mudaribShare: aMudaribShare
      },
      investorB: {
        economicProfit: bEconomic,
        contractPercentage: 60,
        investorProfit: bInvestorProfit,
        mudaribShare: bMudaribShare
      },
      totalInvestorProfit,
      totalMudaribProfit,
      sumProfits,
      isAllocatedCleanly: sumProfits === 300
    },
    step4Settlement: {
      investorA: {
        reinvestPercentage: 50,
        reinvestedCapital: settleA.reinvestedCapital,
        withdrawableAmount: settleA.withdrawableAmount,
        initialCapital: 100,
        futureCapitalPosition: aFutureCap
      },
      investorB: {
        reinvestPercentage: 100,
        reinvestedCapital: settleB.reinvestedCapital,
        withdrawableAmount: settleB.withdrawableAmount,
        initialCapital: 200,
        futureCapitalPosition: bFutureCap
      },
      totalReinvested: settleA.reinvestedCapital + settleB.reinvestedCapital,
      totalWithdrawn: settleA.withdrawableAmount + settleB.withdrawableAmount,
      bankBalanceAfterSettlement: totalAssets
    },
    step5PostSettlementValuation: {
      valuationDate: '2026-04-01',
      totalAssets,
      totalLiabilities,
      nav: closingNav,
      formula,
      isBalanced: trialBalance.isBalanced
    },
    lifecycleReconciled,
    discrepancies
  };
}
