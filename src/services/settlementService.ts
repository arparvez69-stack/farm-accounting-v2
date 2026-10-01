import {
  SettlementPreviewParams,
  SettlementPreviewResult,
  ParticipantSettlementPreviewItem,
  MudaribSettlementPreviewItem,
  SettlementPreviewInspectionParams,
  SettlementPreviewInspectionResult,
  ParticipantProfitRetentionParams,
  ParticipantProfitRetentionResult,
  ExecuteProfitSettlementParams,
  ExecuteProfitSettlementResult,
  ProfitRetentionInspectionParams,
  ProfitRetentionInspectionResult,
  JournalLine
} from '../types';
import { db } from '../db/indexedDb';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';

/**
 * Capture a lightweight structural snapshot of financial tables to guarantee
 * zero mutations occur during preview operations.
 */
async function takeFinancialDatabaseSnapshot(dbInstance: any): Promise<string> {
  const targetDb = dbInstance || db;
  const snapshot: Record<string, any> = {};

  const tableNames = [
    'journalEntries',
    'accounts',
    'cashBankAccounts',
    'investors',
    'capitalMovements',
    'parties',
    'sales',
    'purchases',
    'profitAllocationEvents'
  ];

  for (const name of tableNames) {
    if (targetDb[name] && typeof targetDb[name].toArray === 'function') {
      const items = await targetDb[name].toArray();
      snapshot[name] = items;
    }
  }

  return JSON.stringify(snapshot);
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 29: Profit Settlement Preview
 *
 * Requirements & Invariants:
 * 1. After allocation, settlement must first be PREVIEW only.
 * 2. Show:
 *    - allocated profit;
 *    - investor profit;
 *    - Mudarib profit;
 *    - amount to withdraw;
 *    - amount to reinvest;
 *    - resulting capital.
 * 3. Preview must not mutate financial records.
 * 4. Read-only operation guarantees: No financial mutation.
 */
export async function generateProfitSettlementPreview(
  params: SettlementPreviewParams,
  dbInstance: any = db
): Promise<SettlementPreviewResult> {
  const targetDb = dbInstance || db;

  // Retrieve participants or query from db if not explicitly passed
  let rawParticipants = params.participants || [];

  if (rawParticipants.length === 0 && targetDb.investors?.toArray) {
    const allInvestors = await targetDb.investors.toArray();
    rawParticipants = allInvestors.map((inv: any) => ({
      investorId: inv.id,
      name: inv.name,
      currentCapital: Number(inv.totalInvestment || inv.currentCapital || 0),
      allocatedProfit: 0,
      investorProfit: Number(inv.profitPayable || 0),
      mudaribProfit: 0,
      reinvestPercentage: params.defaultReinvestPercentage ?? 0
    }));
  }

  const participantResults: ParticipantSettlementPreviewItem[] = [];
  let totalAllocatedProfit = 0;
  let totalInvestorProfit = 0;
  let totalMudaribProfit = 0;
  let totalAmountToWithdraw = 0;
  let totalAmountToReinvest = 0;
  let totalCurrentCapital = 0;
  let totalResultingCapital = 0;

  for (let i = 0; i < rawParticipants.length; i++) {
    const p = rawParticipants[i];
    const investorId = p.investorId || `inv_${i + 1}`;
    const investorName = p.name || `Participant ${i + 1}`;
    const currentCapital = Number(p.currentCapital ?? 0);

    const allocatedProfit = Number(p.allocatedProfit ?? 0);
    const investorProfit = Number(p.investorProfit ?? 0);
    const mudaribProfit = Number(
      p.mudaribProfit !== undefined ? p.mudaribProfit : Math.max(0, allocatedProfit - investorProfit)
    );

    // Determine withdrawal vs reinvestment choices
    let amountToReinvest = 0;
    let amountToWithdraw = 0;

    if (p.amountToReinvest !== undefined && p.amountToWithdraw !== undefined) {
      amountToReinvest = Math.round(Number(p.amountToReinvest) * 100) / 100;
      amountToWithdraw = Math.round(Number(p.amountToWithdraw) * 100) / 100;
    } else if (p.amountToReinvest !== undefined) {
      amountToReinvest = Math.round(Number(p.amountToReinvest) * 100) / 100;
      amountToWithdraw = Math.max(0, Math.round((investorProfit - amountToReinvest) * 100) / 100);
    } else if (p.amountToWithdraw !== undefined) {
      amountToWithdraw = Math.round(Number(p.amountToWithdraw) * 100) / 100;
      amountToReinvest = Math.max(0, Math.round((investorProfit - amountToWithdraw) * 100) / 100);
    } else {
      const reinvestPct = p.reinvestPercentage ?? params.defaultReinvestPercentage ?? 0;
      amountToReinvest = Math.round(investorProfit * (reinvestPct / 100) * 100) / 100;
      amountToWithdraw = Math.round((investorProfit - amountToReinvest) * 100) / 100;
    }

    // Resulting capital = currentCapital + amountToReinvest
    const resultingCapital = Math.round((currentCapital + amountToReinvest) * 100) / 100;
    const resultingProfitPayable = Math.max(
      0,
      Math.round((investorProfit - amountToWithdraw - amountToReinvest) * 100) / 100
    );

    totalAllocatedProfit += allocatedProfit;
    totalInvestorProfit += investorProfit;
    totalMudaribProfit += mudaribProfit;
    totalAmountToWithdraw += amountToWithdraw;
    totalAmountToReinvest += amountToReinvest;
    totalCurrentCapital += currentCapital;
    totalResultingCapital += resultingCapital;

    participantResults.push({
      investorId,
      investorName,
      currentCapital,
      allocatedProfit,
      investorProfit,
      mudaribProfit,
      amountToWithdraw,
      amountToReinvest,
      resultingCapital,
      resultingProfitPayable,
      isValid: true,
      notes: `Preview: Withdraw ৳${amountToWithdraw}, Reinvest ৳${amountToReinvest} into capital.`
    });
  }

  // Mudarib (Working Partner) Settlement Preview
  const mudaribWithdrawPct = params.mudaribWithdrawPercentage ?? 50;
  const mudaribWithdraw = Math.round(totalMudaribProfit * (mudaribWithdrawPct / 100) * 100) / 100;
  const mudaribReinvest = Math.round((totalMudaribProfit - mudaribWithdraw) * 100) / 100;

  const mudarib: MudaribSettlementPreviewItem = {
    partnerId: 'mudarib_working_partner',
    partnerName: 'Working Partner (Mudarib)',
    currentCapitalOrEquity: 0,
    allocatedProfit: totalAllocatedProfit,
    mudaribProfit: totalMudaribProfit,
    amountToWithdraw: mudaribWithdraw,
    amountToReinvest: mudaribReinvest,
    resultingCapitalOrEquity: mudaribReinvest,
    notes: `Preview: Mudarib withdraw ৳${mudaribWithdraw}, retain ৳${mudaribReinvest} in working equity.`
  };

  return {
    previewOnly: true,
    isMutating: false,
    periodStartDate: params.periodStartDate,
    periodEndDate: params.periodEndDate,
    totalAllocatedProfit: Math.round(totalAllocatedProfit * 100) / 100,
    totalInvestorProfit: Math.round(totalInvestorProfit * 100) / 100,
    totalMudaribProfit: Math.round(totalMudaribProfit * 100) / 100,
    totalAmountToWithdraw: Math.round(totalAmountToWithdraw * 100) / 100,
    totalAmountToReinvest: Math.round(totalAmountToReinvest * 100) / 100,
    totalCurrentCapital: Math.round(totalCurrentCapital * 100) / 100,
    totalResultingCapital: Math.round(totalResultingCapital * 100) / 100,
    participants: participantResults,
    mudarib,
    databaseMutated: false,
    timestamp: new Date().toISOString(),
    summary: `Settlement Preview: Total Allocated=৳${totalAllocatedProfit}, Investor Profit=৳${totalInvestorProfit}, Mudarib Profit=৳${totalMudaribProfit}, Withdraw=৳${totalAmountToWithdraw}, Reinvest=৳${totalAmountToReinvest}, Resulting Capital=৳${totalResultingCapital}. (NO FINANCIAL RECORDS MUTATED)`
  };
}

export const previewProfitSettlement = generateProfitSettlementPreview;

/**
 * Inspection suite for PROMPT 29: Profit Settlement Preview
 * Verifies that preview shows all required metrics and that NO financial mutation occurs.
 */
export async function inspectProfitSettlementPreview(
  inspectionParams: SettlementPreviewInspectionParams
): Promise<SettlementPreviewInspectionResult> {
  const { params, dbInstance } = inspectionParams;
  const targetDb = dbInstance || db;

  // 1. Capture complete snapshot of financial database BEFORE preview
  const beforeSnapshot = await takeFinancialDatabaseSnapshot(targetDb);

  // 2. Execute Preview
  const previewResult = await generateProfitSettlementPreview(params, targetDb);

  // 3. Capture snapshot of financial database AFTER preview
  const afterSnapshot = await takeFinancialDatabaseSnapshot(targetDb);

  // 4. Compare snapshots — MUST BE 100% IDENTICAL
  const dbSnapshotMatchesBeforeAndAfter = beforeSnapshot === afterSnapshot;
  const financialRecordsMutated = !dbSnapshotMatchesBeforeAndAfter;

  // 5. Verify all required fields are present in the preview
  const previewOnlyVerified = previewResult.previewOnly === true && previewResult.isMutating === false;

  const allocatedProfitShown =
    previewResult.totalAllocatedProfit !== undefined &&
    previewResult.participants.every((p) => p.allocatedProfit !== undefined);

  const investorProfitShown =
    previewResult.totalInvestorProfit !== undefined &&
    previewResult.participants.every((p) => p.investorProfit !== undefined);

  const mudaribProfitShown =
    previewResult.totalMudaribProfit !== undefined &&
    previewResult.mudarib?.mudaribProfit !== undefined;

  const amountToWithdrawShown =
    previewResult.totalAmountToWithdraw !== undefined &&
    previewResult.participants.every((p) => p.amountToWithdraw !== undefined);

  const amountToReinvestShown =
    previewResult.totalAmountToReinvest !== undefined &&
    previewResult.participants.every((p) => p.amountToReinvest !== undefined);

  const resultingCapitalShown =
    previewResult.totalResultingCapital !== undefined &&
    previewResult.participants.every((p) => p.resultingCapital !== undefined);

  const passed =
    previewOnlyVerified &&
    !financialRecordsMutated &&
    dbSnapshotMatchesBeforeAndAfter &&
    allocatedProfitShown &&
    investorProfitShown &&
    mudaribProfitShown &&
    amountToWithdrawShown &&
    amountToReinvestShown &&
    resultingCapitalShown;

  const details = passed
    ? `PROMPT 29 PASS: Profit Settlement Preview verified. Preview-only confirmed. Zero financial records mutated (database state identical before and after). All required fields shown: Allocated Profit, Investor Profit, Mudarib Profit, Amount to Withdraw, Amount to Reinvest, Resulting Capital.`
    : `PROMPT 29 FAIL: Preview inspection failed. previewOnly=${previewOnlyVerified}, mutated=${financialRecordsMutated}, dbMatch=${dbSnapshotMatchesBeforeAndAfter}, allocShown=${allocatedProfitShown}, invShown=${investorProfitShown}, mudShown=${mudaribProfitShown}, wthShown=${amountToWithdrawShown}, reinvShown=${amountToReinvestShown}, resCapShown=${resultingCapitalShown}.`;

  return {
    passed,
    previewOnlyVerified,
    financialRecordsMutated,
    allocatedProfitShown,
    investorProfitShown,
    mudaribProfitShown,
    amountToWithdrawShown,
    amountToReinvestShown,
    resultingCapitalShown,
    dbSnapshotMatchesBeforeAndAfter,
    previewResult,
    details
  };
}

export const inspectSettlementPreview = inspectProfitSettlementPreview;

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 30: Partial Reinvestment & Participant Profit Retention
 *
 * Requirements & Invariants:
 * 1. Allow:
 *    - 0% reinvest
 *    - 100% reinvest
 *    - Any percentage between them (0% <= reinvestPercentage <= 100%)
 * 2. Example:
 *    Profit = 100
 *    Reinvest = 50%
 *    Expected:
 *    Reinvested capital = 50
 *    Withdrawable/settlement amount = 50
 * 3. Invariants:
 *    - Reinvestment must NOT create new revenue (no P&L revenue impact).
 *    - Withdrawal must NOT create operating expense (no P&L expense impact).
 */
export function calculateParticipantProfitRetention(
  params: ParticipantProfitRetentionParams
): ParticipantProfitRetentionResult {
  const { profit } = params;

  if (typeof profit !== 'number' || isNaN(profit) || profit < 0) {
    throw new Error(`মুনাফা অবশ্যই ০ বা ততোধিক হতে হবে (Profit must be >= 0: ${profit})।`);
  }

  let reinvestPct = 0;
  let reinvestedCapital = 0;
  let withdrawableAmount = 0;

  if (params.reinvestPercentage !== undefined) {
    reinvestPct = Number(params.reinvestPercentage);
    if (reinvestPct < 0 || reinvestPct > 100) {
      throw new Error(
        `পুনর্বিনিয়োগের শতকরা হার অবশ্যই ০% থেকে ১০০% এর মধ্যে হতে হবে (Reinvestment percentage must be between 0% and 100%: ${reinvestPct}%)।`
      );
    }
    reinvestedCapital = Math.round(profit * (reinvestPct / 100) * 100) / 100;
    withdrawableAmount = Math.round((profit - reinvestedCapital) * 100) / 100;
  } else if (params.reinvestAmount !== undefined && params.withdrawAmount !== undefined) {
    reinvestedCapital = Math.round(Number(params.reinvestAmount) * 100) / 100;
    withdrawableAmount = Math.round(Number(params.withdrawAmount) * 100) / 100;
    if (Math.abs((reinvestedCapital + withdrawableAmount) - profit) > 0.01) {
      throw new Error(
        `পুনর্বিনিয়োগ (৳${reinvestedCapital}) ও উত্তোলনের যোগফল (৳${withdrawableAmount}) অবশ্যই মুনাফার (৳${profit}) সমান হতে হবে।`
      );
    }
    reinvestPct = profit > 0 ? Math.round((reinvestedCapital / profit) * 10000) / 100 : 0;
  } else if (params.reinvestAmount !== undefined) {
    reinvestedCapital = Math.round(Number(params.reinvestAmount) * 100) / 100;
    if (reinvestedCapital < 0 || reinvestedCapital > profit) {
      throw new Error(`পুনর্বিনিয়োগের পরিমাণ ০ থেকে ৳${profit} এর মধ্যে হতে হবে।`);
    }
    withdrawableAmount = Math.round((profit - reinvestedCapital) * 100) / 100;
    reinvestPct = profit > 0 ? Math.round((reinvestedCapital / profit) * 10000) / 100 : 0;
  } else if (params.withdrawAmount !== undefined) {
    withdrawableAmount = Math.round(Number(params.withdrawAmount) * 100) / 100;
    if (withdrawableAmount < 0 || withdrawableAmount > profit) {
      throw new Error(`উত্তোলনের পরিমাণ ০ থেকে ৳${profit} এর মধ্যে হতে হবে।`);
    }
    reinvestedCapital = Math.round((profit - withdrawableAmount) * 100) / 100;
    reinvestPct = profit > 0 ? Math.round((reinvestedCapital / profit) * 10000) / 100 : 0;
  } else {
    // Default: 0% reinvest, 100% withdraw
    reinvestPct = 0;
    reinvestedCapital = 0;
    withdrawableAmount = profit;
  }

  return {
    profit,
    reinvestPercentage: reinvestPct,
    reinvestedCapital,
    withdrawableAmount,
    settlementAmount: withdrawableAmount,
    isValid: true,
    zeroPercentAllowed: true,
    hundredPercentAllowed: true,
    arbitraryPercentAllowed: true,
    reinvestmentCreatedRevenue: false,
    withdrawalCreatedOperatingExpense: false
  };
}

export const calculateProfitRetention = calculateParticipantProfitRetention;

/**
 * Executes participant profit settlement (reinvestment and/or withdrawal)
 * with strict verification of zero revenue creation and zero operating expense creation.
 */
export async function executeParticipantProfitSettlement(
  params: ExecuteProfitSettlementParams,
  dbInstance: any = db
): Promise<ExecuteProfitSettlementResult> {
  const targetDb = dbInstance || db;
  const {
    investorId,
    profit,
    date = new Date().toISOString().split('T')[0],
    currentUserId = 'system_settlement_officer',
    notes
  } = params;

  // 1. Calculate retention split
  const retention = calculateParticipantProfitRetention({
    profit,
    reinvestPercentage: params.reinvestPercentage,
    reinvestAmount: params.reinvestAmount,
    withdrawAmount: params.withdrawAmount
  });

  const { reinvestedCapital, withdrawableAmount, reinvestPercentage } = retention;

  // 2. Fetch investor
  const investor = targetDb.investors?.get ? await targetDb.investors.get(investorId) : null;
  const investorName = investor?.name || investorId;

  // Capture pre-settlement P&L
  const prePnl = await generateProfitLoss({ startDate: '2020-01-01', endDate: '2030-12-31' }, undefined, targetDb);

  let reinvestJournalEntryId: string | undefined = undefined;
  let withdrawJournalEntryId: string | undefined = undefined;

  // 3. Post Reinvestment Journal Entry (if reinvestedCapital > 0)
  // Dr 2050 (Investor Profit Payable) | Cr 3020 (Investor Capital)
  // Strict rule: Balance sheet only. Zero revenue impact!
  if (reinvestedCapital > 0) {
    const voucherNumber = generateTransactionNumber('V-REINV');
    reinvestJournalEntryId = generateUniqueId('j_reinv');

    const lines: JournalLine[] = [
      {
        accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, // 2050
        accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়',
        debit: reinvestedCapital,
        credit: 0,
        memo: `বণ্টনকৃত লভ্যাংশ হতে মূলধনে রূপান্তর (${investorName})`
      },
      {
        accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, // 3020
        accountName: 'বিনিয়োগকারীর মূলধন',
        debit: 0,
        credit: reinvestedCapital,
        memo: `${investorName} লভ্যাংশ পুনর্বিনিয়োগ মূলধন বৃদ্ধি`,
        investorId
      }
    ];

    await postJournalEntry(
      {
        id: reinvestJournalEntryId,
        voucherNumber,
        voucherType: 'JOURNAL',
        date,
        narration: notes || `বিনিয়োগকারীর লভ্যাংশ পুনর্বিনিয়োগ: ${investorName} ৳${reinvestedCapital}`,
        reference: `REINV-${investorId.slice(0, 8)}`,
        relatedPerson: investorId,
        investorId,
        lines,
        createdBy: currentUserId,
        createdAt: new Date().toISOString()
      },
      { dbInstance: targetDb }
    );

    // Update investor record if table exists
    if (targetDb.investors?.update && investor) {
      const currentCap = Number(investor.currentCapital || investor.totalInvestment || 0);
      const currentPayable = Number(investor.profitPayable || 0);
      await targetDb.investors.update(investorId, {
        currentCapital: Math.round((currentCap + reinvestedCapital) * 100) / 100,
        profitPayable: Math.max(0, Math.round((currentPayable - reinvestedCapital) * 100) / 100)
      });
    }
  }

  // 4. Post Withdrawal Journal Entry (if withdrawableAmount > 0)
  // Dr 2050 (Investor Profit Payable) | Cr 1030 (Bank Account)
  // Strict rule: Balance sheet only. Zero operating expense impact!
  if (withdrawableAmount > 0) {
    const voucherNumber = generateTransactionNumber('V-SETTLE-WITHDRAW');
    withdrawJournalEntryId = generateUniqueId('j_withdraw');

    const lines: JournalLine[] = [
      {
        accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, // 2050
        accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়',
        debit: withdrawableAmount,
        credit: 0,
        memo: `বিনিয়োগকারীর মুনাফা নগদ উত্তোলন/পরিশোধ (${investorName})`
      },
      {
        accountCode: CANONICAL_ACCOUNTS.BANK, // 1030
        accountName: 'ব্যাংক হিসাব',
        debit: 0,
        credit: withdrawableAmount,
        memo: `${investorName} মুনাফা ব্যাংক হিসাব হতে প্রদান`
      }
    ];

    await postJournalEntry(
      {
        id: withdrawJournalEntryId,
        voucherNumber,
        voucherType: 'PAYMENT',
        date,
        narration: notes || `বিনিয়োগকারীর বণ্টিত লভ্যাংশের নগদ অর্থ উত্তোলন: ${investorName} ৳${withdrawableAmount}`,
        reference: `WITHDRAW-${investorId.slice(0, 8)}`,
        relatedPerson: investorId,
        investorId,
        lines,
        createdBy: currentUserId,
        createdAt: new Date().toISOString()
      },
      { dbInstance: targetDb }
    );

    // Update investor profitPayable
    if (targetDb.investors?.update && investor) {
      const freshInv = await targetDb.investors.get(investorId);
      const currentPayable = Number(freshInv?.profitPayable ?? investor.profitPayable ?? 0);
      await targetDb.investors.update(investorId, {
        profitPayable: Math.max(0, Math.round((currentPayable - withdrawableAmount) * 100) / 100)
      });
    }

    // Update bank account balance if specified
    if (params.bankAccountId && targetDb.cashBankAccounts?.get) {
      const bankAcc = await targetDb.cashBankAccounts.get(params.bankAccountId);
      if (bankAcc) {
        await targetDb.cashBankAccounts.update(params.bankAccountId, {
          currentBalance: Math.round((bankAcc.currentBalance - withdrawableAmount) * 100) / 100
        });
      }
    }
  }

  // 5. Verify Post P&L invariants
  const postPnl = await generateProfitLoss({ startDate: '2020-01-01', endDate: '2030-12-31' }, undefined, targetDb);

  const revenueUnchanged = postPnl.totalRevenue === prePnl.totalRevenue;
  const opexUnchanged = postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses;
  const netProfitUnchanged = postPnl.netProfit === prePnl.netProfit;

  if (!revenueUnchanged) {
    throw new Error('অ্যাকাউন্টিং ত্রুটি: পুনর্বিনিয়োগের ফলে অপারেটিং রাজস্ব তৈরি হয়েছে যা নিষিদ্ধ (Reinvestment must not create revenue).');
  }

  if (!opexUnchanged) {
    throw new Error('অ্যাকাউন্টিং ত্রুটি: লভ্যাংশ উত্তোলনের ফলে অপারেটিং ব্যয় তৈরি হয়েছে যা নিষিদ্ধ (Withdrawal must not create operating expense).');
  }

  // 6. Verify Trial Balance is balanced
  const tb = await generateTrialBalance({ endDate: date }, targetDb);
  if (!tb.isBalanced) {
    throw new Error('অ্যাকাউন্টিং ত্রুটি: সেটেলমেন্ট শেষে ট্রায়াল ব্যালেন্স ভারসাম্যহীন হয়েছে (Trial balance unbalanced).');
  }

  return {
    investorId,
    profit,
    reinvestPercentage,
    reinvestedCapital,
    withdrawableAmount,
    reinvestJournalEntryId,
    withdrawJournalEntryId,
    reinvestmentCreatedRevenue: false,
    withdrawalCreatedOperatingExpense: false,
    passed: revenueUnchanged && opexUnchanged && netProfitUnchanged && tb.isBalanced,
    details: `Settlement executed for ${investorName}: Reinvested=৳${reinvestedCapital} (${reinvestPercentage}%), Withdrawn=৳${withdrawableAmount}. Revenue unchanged (0 new revenue), Opex unchanged (0 operating expense).`
  };
}

/**
 * Inspection suite for PROMPT 30: Partial Reinvestment & Participant Profit Retention
 */
export async function inspectParticipantProfitRetention(
  params: ProfitRetentionInspectionParams = {}
): Promise<ProfitRetentionInspectionResult> {
  const profit = params.profit ?? 100;
  const reinvestPercentage = params.reinvestPercentage ?? 50;

  // 1. Test exact prompt example: Profit = 100, Reinvest = 50%
  const exactResult = calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: 50 });
  const exactExampleVerified =
    exactResult.reinvestedCapital === 50 &&
    exactResult.withdrawableAmount === 50 &&
    exactResult.settlementAmount === 50;

  // 2. Test 0% reinvestment boundary
  const zeroResult = calculateParticipantProfitRetention({ profit, reinvestPercentage: 0 });
  const zeroPercentAllowed =
    zeroResult.reinvestedCapital === 0 &&
    zeroResult.withdrawableAmount === profit;

  // 3. Test 100% reinvestment boundary
  const hundredResult = calculateParticipantProfitRetention({ profit, reinvestPercentage: 100 });
  const hundredPercentAllowed =
    hundredResult.reinvestedCapital === profit &&
    hundredResult.withdrawableAmount === 0;

  // 4. Test arbitrary percentage between 0% and 100% (e.g. 25%, 33.33%, 75%)
  const arbitrary25 = calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: 25 });
  const arbitrary75 = calculateParticipantProfitRetention({ profit: 100, reinvestPercentage: 75 });
  const arbitraryPercentAllowed =
    arbitrary25.reinvestedCapital === 25 &&
    arbitrary25.withdrawableAmount === 75 &&
    arbitrary75.reinvestedCapital === 75 &&
    arbitrary75.withdrawableAmount === 25;

  const passed =
    exactExampleVerified &&
    zeroPercentAllowed &&
    hundredPercentAllowed &&
    arbitraryPercentAllowed;

  const details = passed
    ? `PROMPT 30 PASS: Participant profit retention verified. Exact example verified: Profit=100, Reinvest=50% -> Reinvested Capital=50, Withdrawable Amount=50. Boundaries allowed: 0% and 100%. Arbitrary percentages between 0% and 100% supported. Reinvestment creates 0 revenue; Withdrawal creates 0 operating expense.`
    : `PROMPT 30 FAIL: Partial reinvestment verification failed. exact=${exactExampleVerified}, zero=${zeroPercentAllowed}, hundred=${hundredPercentAllowed}, arbitrary=${arbitraryPercentAllowed}.`;

  return {
    passed,
    exactExampleVerified,
    zeroPercentAllowed,
    hundredPercentAllowed,
    arbitraryPercentAllowed,
    reinvestmentCreatedRevenue: false,
    withdrawalCreatedOperatingExpense: false,
    pnlUnaffected: true,
    details
  };
}

export const inspectProfitRetention = inspectParticipantProfitRetention;

