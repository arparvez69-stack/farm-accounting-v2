import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeParticipantProfitSettlement,
  inspectReinvestmentHandling,
  inspectReinvestmentCreatesNewCapitalTranche
} from '../services/settlementService';
import { calculateCapitalParticipationAllocation } from '../services/valuationService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { InvestmentTranche, InvestorCapitalMovement } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 31 — Reinvestment Creates New Capital Tranche
 *
 * Requirements:
 * Inspect reinvestment handling.
 * Reinvested profit must become a traceable new capital movement/tranche for future economic participation.
 *
 * It must reference:
 * - source profit allocation;
 * - participant;
 * - amount;
 * - effective date;
 * - settlement event.
 *
 * Do not rewrite the original investment tranche.
 * Do not duplicate the original profit.
 *
 * Test:
 * Original capital = 100
 * Reinvested profit = 50
 * Expected future capital position = 150, while historical tranche data remains intact.
 *
 * Return PASS.
 */
export async function runPrompt31ReinvestmentCreatesNewCapitalTrancheTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, message: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`  ✅ [PASS] ${message}`);
    } else {
      result.failed++;
      result.failures.push(message);
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  console.log('\n================================================================');
  console.log('STARTING PROMPT 31: REINVESTMENT CREATES NEW CAPITAL TRANCHE');
  console.log('Testing: Traceable New Tranche & Capital Movement Generation,');
  console.log('Required References (Source Profit Allocation, Participant, Amount, Effective Date, Settlement Event),');
  console.log('Original Tranche Preservation (Do Not Rewrite), No Duplicate Profit,');
  console.log('Exact Test: Original Capital = 100, Reinvested Profit = 50 -> Expected Capital Position = 150');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Direct Test of The Exact Prompt Requirements
  // Original capital = 100
  // Reinvested profit = 50
  // Expected future capital position = 150, while historical tranche data remains intact.
  // ===========================================================================
  console.log('--- Step 1: Direct Execution of Exact Prompt Scenario ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_main_p31';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Agrani Bank Main Farm Account',
    accountType: 'BANK',
    currentBalance: 80000,
    synced: false
  });

  const participantId = 'inv_p31_participant_1';
  const participantName = 'Hasan Mahmud';
  const originalCapital = 100;
  const reinvestedProfit = 50;
  const originalTrancheId = 'tranche_p31_orig_001';
  const sourceProfitAllocationId = 'alloc_p31_2026_q1';
  const settlementEventId = 'settle_p31_event_001';
  const effectiveDate = '2026-04-01';

  // 1. Establish participant in database
  await mDb.investors.put({
    id: participantId,
    name: participantName,
    phone: '01711223344',
    totalInvestment: originalCapital,
    currentCapital: originalCapital,
    capitalContributed: originalCapital,
    currentCapitalBalance: originalCapital,
    profitPayable: reinvestedProfit, // ৳50 allocated profit waiting in liability
    joinedDate: '2026-01-01',
    profitSharingRatio: 40,
    status: 'ACTIVE',
    isActive: true,
    synced: false
  });

  // 2. Establish original investment tranche (Original capital = 100)
  const originalTrancheData: InvestmentTranche = {
    id: originalTrancheId,
    trancheId: originalTrancheId,
    trancheNumber: 'TR-2026-ORIG-01',
    investorId: participantId,
    participantId: participantId,
    investorName: participantName,
    investmentAmount: originalCapital,
    amount: originalCapital,
    originalCapital: originalCapital,
    currentCapital: originalCapital,
    currentCapitalBalance: originalCapital,
    totalCapitalReturned: 0,
    investmentDate: '2026-01-01',
    effectiveDate: '2026-01-01',
    effectiveInvestmentDate: '2026-01-01',
    contractualProfitSharePercentage: 40,
    currency: 'BDT',
    status: 'ACTIVE',
    creationTimestamp: '2026-01-01T10:00:00.000Z',
    notes: 'Initial original investment tranche ৳100',
    createdBy: 'founder_setup',
    createdAt: '2026-01-01T10:00:00.000Z',
    synced: false
  };

  await mDb.investmentTranches.put(originalTrancheData);

  // Take an immutable pre-settlement snapshot of original tranche
  const originalTranchePreSnapshot = JSON.stringify(await mDb.investmentTranches.get(originalTrancheId));

  // Verify pre-state
  const preTranches = await mDb.investmentTranches.toArray();
  assert(preTranches.length === 1, 'Pre-condition: exactly 1 historical tranche exists in database');
  assert(preTranches[0].investmentAmount === 100, 'Pre-condition: original tranche investment amount is ৳100');

  // 3. Post baseline capital in GL
  await postJournalEntry(
    {
      id: 'j_p31_init',
      voucherNumber: 'JRN-P31-001',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: `Initial capital Hasan Mahmud (৳${originalCapital})`,
      relatedPerson: participantId,
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100 }
      ],
      createdBy: 'auditor_p31',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  // Post profit allocation liability in GL
  await postJournalEntry(
    {
      id: 'j_p31_alloc',
      voucherNumber: 'JRN-P31-002',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: `Allocated profit payable (৳${reinvestedProfit})`,
      relatedPerson: participantId,
      lines: [
        { accountCode: '3070', accountName: 'মুনাফা বণ্টন', debit: 50, credit: 0 },
        { accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয়', debit: 0, credit: 50 }
      ],
      createdBy: 'auditor_p31',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  const prePnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-01' }, undefined, mDb);
  assert(prePnl.totalRevenue === 0, 'Pre-settlement revenue is ৳0');
  assert(prePnl.totalOperatingExpenses === 0, 'Pre-settlement operating expenses is ৳0');

  // 4. Execute Reinvestment of Profit (Original capital = 100, Reinvested profit = 50)
  console.log('\n--- Executing Reinvestment of ৳50 into New Capital Tranche ---');
  const settlementResult = await executeParticipantProfitSettlement(
    {
      investorId: participantId,
      participantId,
      profit: reinvestedProfit, // 50
      reinvestPercentage: 100, // 100% reinvested = 50
      date: effectiveDate,
      effectiveDate,
      sourceProfitAllocationId,
      sourceProfitAllocation: sourceProfitAllocationId,
      settlementEventId,
      settlementEvent: settlementEventId,
      currentUserId: 'auditor_p31',
      notes: 'Prompt 31 Reinvestment Execution'
    },
    mDb
  );

  assert(settlementResult.passed === true, 'Settlement execution passed cleanly');
  assert(settlementResult.reinvestedCapital === 50, 'Settlement executed reinvested capital is ৳50');

  // ===========================================================================
  // REQUIREMENT 1: DO NOT REWRITE THE ORIGINAL INVESTMENT TRANCHE
  // ===========================================================================
  console.log('\n--- Checking Invariant: Do Not Rewrite The Original Investment Tranche ---');
  const postOriginalTranche = await mDb.investmentTranches.get(originalTrancheId);

  assert(
    postOriginalTranche !== undefined,
    'Original investment tranche still exists with its original ID'
  );
  assert(
    postOriginalTranche.investmentAmount === 100,
    `CRITICAL: Original investment tranche amount is still strictly ৳100 (got ৳${postOriginalTranche.investmentAmount})`
  );
  assert(
    postOriginalTranche.originalCapital === 100,
    `CRITICAL: Original tranche originalCapital is still strictly ৳100 (got ৳${postOriginalTranche.originalCapital})`
  );
  assert(
    postOriginalTranche.creationTimestamp === '2026-01-01T10:00:00.000Z',
    'Original investment tranche creationTimestamp was NOT rewritten'
  );
  assert(
    JSON.stringify(postOriginalTranche) === originalTranchePreSnapshot,
    'Original investment tranche data is 100% identical byte-for-byte to pre-reinvestment snapshot'
  );

  // ===========================================================================
  // REQUIREMENT 2: REINVESTED PROFIT CREATES A TRACEABLE NEW CAPITAL TRANCHE
  // ===========================================================================
  console.log('\n--- Checking New Tranche Generation & Required References ---');

  const allTranches = await mDb.investmentTranches.toArray();
  const participantTranches = allTranches.filter((t) => t.investorId === participantId);

  assert(
    participantTranches.length === 2,
    `CRITICAL: Participant now has exactly 2 tranches (original + reinvestment). Got: ${participantTranches.length}`
  );

  const newReinvestTranche = participantTranches.find((t) => t.id !== originalTrancheId);
  assert(newReinvestTranche !== undefined, 'A distinct new investment tranche was created');

  // Verify all 5 required references on the new tranche:
  // 1. source profit allocation
  assert(
    newReinvestTranche?.sourceProfitAllocationId === sourceProfitAllocationId ||
      newReinvestTranche?.sourceProfitAllocation === sourceProfitAllocationId,
    `Tranche references source profit allocation: "${newReinvestTranche?.sourceProfitAllocationId}" === "${sourceProfitAllocationId}"`
  );

  // 2. participant
  assert(
    newReinvestTranche?.investorId === participantId &&
      (newReinvestTranche?.participantId === participantId || newReinvestTranche?.participantId === undefined),
    `Tranche references participant: "${newReinvestTranche?.investorId}" === "${participantId}"`
  );

  // 3. amount
  assert(
    newReinvestTranche?.investmentAmount === reinvestedProfit,
    `Tranche references amount: ৳${newReinvestTranche?.investmentAmount} === ৳${reinvestedProfit}`
  );
  assert(
    newReinvestTranche?.amount === reinvestedProfit,
    `Tranche amount alias matches: ৳${newReinvestTranche?.amount} === ৳${reinvestedProfit}`
  );

  // 4. effective date
  assert(
    newReinvestTranche?.effectiveDate === effectiveDate ||
      newReinvestTranche?.effectiveInvestmentDate === effectiveDate,
    `Tranche references effective date: "${newReinvestTranche?.effectiveInvestmentDate}" === "${effectiveDate}"`
  );

  // 5. settlement event
  assert(
    newReinvestTranche?.settlementEventId === settlementEventId ||
      newReinvestTranche?.settlementEvent === settlementEventId,
    `Tranche references settlement event: "${newReinvestTranche?.settlementEventId}" === "${settlementEventId}"`
  );

  assert(
    newReinvestTranche?.status === 'ACTIVE',
    'New reinvestment tranche status is ACTIVE for future economic participation'
  );
  assert(
    newReinvestTranche?.isReinvestment === true,
    'New tranche is flagged as isReinvestment: true'
  );

  // ===========================================================================
  // REQUIREMENT 3: TRACEABLE CAPITAL MOVEMENT IN DEDICATED LEDGER
  // ===========================================================================
  console.log('\n--- Checking Traceable Capital Movement Ledger ---');

  const capitalMovements: InvestorCapitalMovement[] = await mDb.investorCapitalMovements.toArray();
  const reinvestMovement = capitalMovements.find(
    (m) => m.investorId === participantId && m.movementType === 'REINVESTED_PROFIT'
  );

  assert(reinvestMovement !== undefined, 'A dedicated capital movement record of type REINVESTED_PROFIT was logged');
  assert(reinvestMovement?.amount === 50, 'Capital movement amount is ৳50');
  assert(reinvestMovement?.direction === 'INFLOW', 'Capital movement direction is INFLOW');
  assert(reinvestMovement?.trancheId === newReinvestTranche?.id, 'Capital movement links directly to the new tranche ID');
  assert(
    reinvestMovement?.sourceProfitAllocationId === sourceProfitAllocationId ||
      reinvestMovement?.sourceProfitAllocation === sourceProfitAllocationId,
    'Capital movement references source profit allocation'
  );
  assert(
    reinvestMovement?.settlementEventId === settlementEventId ||
      reinvestMovement?.settlementEvent === settlementEventId,
    'Capital movement references settlement event'
  );
  assert(
    reinvestMovement?.effectiveDate === effectiveDate || reinvestMovement?.date === effectiveDate,
    'Capital movement references effective date'
  );

  // ===========================================================================
  // REQUIREMENT 4: DO NOT DUPLICATE THE ORIGINAL PROFIT
  // ===========================================================================
  console.log('\n--- Checking Invariant: Do Not Duplicate The Original Profit ---');

  const freshParticipant = await mDb.investors.get(participantId);
  assert(
    freshParticipant.profitPayable === 0,
    `Profit payable liability cleared from ৳50 to ৳0 without duplication (got ৳${freshParticipant.profitPayable})`
  );

  const postPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-02' }, undefined, mDb);
  assert(
    postPnl.totalRevenue === prePnl.totalRevenue,
    'Reinvestment did NOT create new revenue (Revenue unchanged: ৳0)'
  );
  assert(
    postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses,
    'Reinvestment did NOT create operating expenses (Opex unchanged: ৳0)'
  );
  assert(
    postPnl.netProfit === prePnl.netProfit,
    'Net operating profit is completely unaltered (0 P&L impact)'
  );

  // ===========================================================================
  // REQUIREMENT 5: EXPECTED FUTURE CAPITAL POSITION = 150
  // ===========================================================================
  console.log('\n--- Checking Future Capital Position (Expected: 150) ---');

  const currentCapital = Number(freshParticipant.currentCapital);
  const totalInvestment = Number(freshParticipant.totalInvestment);

  assert(
    currentCapital === 150,
    `CRITICAL REQUIREMENT: Expected future capital position = 150 (got currentCapital = ৳${currentCapital})`
  );
  assert(
    totalInvestment === 150,
    `CRITICAL REQUIREMENT: totalInvestment = ৳150 (got ৳${totalInvestment})`
  );

  const sumOfActiveTranches = participantTranches.reduce((sum, t) => sum + t.investmentAmount, 0);
  assert(
    sumOfActiveTranches === 150,
    `Sum of active tranches equals expected capital position: 100 + 50 = ৳150 (got ৳${sumOfActiveTranches})`
  );

  // ===========================================================================
  // REQUIREMENT 6: FUTURE ECONOMIC PARTICIPATION ACROSS BOTH TRANCHES
  // ===========================================================================
  console.log('\n--- Checking Future Economic Participation Allocation ---');

  // Simulate a future profit distribution of ৳300 in Q2 2026
  // Participant holds 2 tranches: Tranche 1 = ৳100, Tranche 2 = ৳50 (Total = ৳150)
  // Assume total farm valuation basis = ৳300
  const futureAllocation = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 300,
    tranches: participantTranches,
    totalValuationBasis: 300,
    periodEndDate: '2026-06-30'
  });

  assert(
    futureAllocation.trancheAllocations.length === 2,
    'Future economic allocation includes both tranches independently'
  );

  const t1Alloc = futureAllocation.trancheAllocations.find((a) => a.trancheId === originalTrancheId);
  const t2Alloc = futureAllocation.trancheAllocations.find((a) => a.trancheId === newReinvestTranche?.id);

  assert(t1Alloc !== undefined, 'Historical tranche 1 received economic allocation');
  assert(t2Alloc !== undefined, 'Reinvested tranche 2 received economic allocation');

  // Tranche 1: 100 / 300 = 33.33% economic participation -> ৳99.99 (rounds to ৳100)
  assert(
    Math.round(t1Alloc?.applicableBusinessProfit || 0) === 100 && Math.abs((t1Alloc?.applicableBusinessProfit || 0) - 100) <= 0.02,
    `Tranche 1 allocated economic profit is ৳100 (got ৳${t1Alloc?.applicableBusinessProfit})`
  );

  // Tranche 2: 50 / 300 = 16.67% economic participation -> ৳50.01 (rounds to ৳50)
  assert(
    Math.round(t2Alloc?.applicableBusinessProfit || 0) === 50 && Math.abs((t2Alloc?.applicableBusinessProfit || 0) - 50) <= 0.02,
    `Tranche 2 allocated economic profit is ৳50 (got ৳${t2Alloc?.applicableBusinessProfit})`
  );

  // Combined investor summary
  const invSummary = futureAllocation.investorSummary.find((s) => s.investorId === participantId);
  assert(
    invSummary?.totalInvestmentAmount === 150,
    `Future investor total investment amount is ৳150 (got ৳${invSummary?.totalInvestmentAmount})`
  );
  assert(
    invSummary?.totalAllocatedEconomicProfit === 150,
    `Future total allocated economic profit across both tranches is ৳150 (100 + 50 = ৳150)`
  );

  // ===========================================================================
  // STEP 2: Comprehensive Test Suite via inspectReinvestmentHandling
  // ===========================================================================
  console.log('\n--- Step 2: Executing inspectReinvestmentHandling Inspection Suite ---');

  const inspectionRes = await inspectReinvestmentHandling({
    originalCapital: 100,
    reinvestedProfit: 50,
    effectiveDate: '2026-04-01',
    sourceProfitAllocationId: 'alloc_q1_p31',
    settlementEventId: 'settle_q1_p31',
    dbInstance: mDb
  });

  assert(inspectionRes.passed === true, 'inspectReinvestmentHandling returned passed === true');
  assert(inspectionRes.originalTrancheIntact === true, 'Inspection: originalTrancheIntact === true');
  assert(inspectionRes.historicalTrancheAmount === 100, 'Inspection: historicalTrancheAmount === 100');
  assert(inspectionRes.reinvestedTrancheCreated === true, 'Inspection: reinvestedTrancheCreated === true');
  assert(inspectionRes.reinvestedTrancheAmount === 50, 'Inspection: reinvestedTrancheAmount === 50');
  assert(inspectionRes.capitalMovementRecorded === true, 'Inspection: capitalMovementRecorded === true');
  assert(inspectionRes.referencesSourceProfitAllocation === true, 'Inspection: referencesSourceProfitAllocation === true');
  assert(inspectionRes.referencesParticipant === true, 'Inspection: referencesParticipant === true');
  assert(inspectionRes.referencesAmount === true, 'Inspection: referencesAmount === true');
  assert(inspectionRes.referencesEffectiveDate === true, 'Inspection: referencesEffectiveDate === true');
  assert(inspectionRes.referencesSettlementEvent === true, 'Inspection: referencesSettlementEvent === true');
  assert(inspectionRes.noProfitDuplicated === true, 'Inspection: noProfitDuplicated === true');
  assert(inspectionRes.expectedFutureCapitalPosition === 150, 'Inspection: expectedFutureCapitalPosition === 150');
  assert(inspectionRes.actualFutureCapitalPosition === 150, 'Inspection: actualFutureCapitalPosition === 150');
  assert(inspectionRes.totalTranchesCount >= 2, 'Inspection: totalTranchesCount >= 2');
  assert(inspectionRes.futureEconomicParticipationVerified === true, 'Inspection: futureEconomicParticipationVerified === true');
  assert(inspectionRes.reinvestmentCreatedRevenue === false, 'Inspection: reinvestmentCreatedRevenue === false');

  // Alias verification
  const aliasInspection = await inspectReinvestmentCreatesNewCapitalTranche({ dbInstance: mDb });
  assert(aliasInspection.passed === true, 'inspectReinvestmentCreatesNewCapitalTranche alias returned passed === true');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 31 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt31ReinvestmentCreatesNewCapitalTrancheTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 31 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 31 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 31 tests:', err);
      process.exit(1);
    });
}
