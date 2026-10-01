import {
  SettlementPreviewParams,
  SettlementPreviewResult,
  ParticipantSettlementPreviewItem,
  MudaribSettlementPreviewItem,
  SettlementPreviewInspectionParams,
  SettlementPreviewInspectionResult
} from '../types';
import { db } from '../db/indexedDb';

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
