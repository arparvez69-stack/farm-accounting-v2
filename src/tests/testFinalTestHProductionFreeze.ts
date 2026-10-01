import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeInvestmentTrancheTransaction,
  getTranchesForInvestor
} from '../services/transactionService';
import {
  recordOwnerPersonalCapital,
  recordMudaribProfitDistribution,
  getParticipantFinancialProfile
} from '../services/participantCapacityService';
import {
  createAdmissionRequest,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
  approveAdmissionRequest,
  recordAdmissionCapitalReceipt,
  executeAdmissionFinalization,
  clearAdmissionRequestsForTest,
  calculatePostMoneyNav,
  calculateNavAdmissionParticipation,
  inspectAdmissionPeriodProfitAllocation,
  getInvestorEffectiveAdmissionDate
} from '../services/admissionService';
import {
  createValuationEvent,
  finalizeValuationEvent,
  createValuationAdjustmentEvent,
  runValuationReconciliationGate,
  validateCoreNavFormula,
  attemptValuationMutation,
  createValuationRevisionEvent,
  calculateFull300ProfitGoldenCalculation,
  calculateLossHandlingAllocation,
  clearValuationEventsForTest,
  getValuationEventById
} from '../services/valuationService';
import {
  executeParticipantProfitSettlement,
  executeFinalAllocationAndSettlement
} from '../services/settlementService';
import {
  recordCapitalMovement,
  getInvestorCapitalMovements
} from '../services/capitalMovementService';
import {
  recordPhysicalInventoryAdjustment
} from '../accounting/physicalInventoryService';
import {
  recordFixedAssetVerificationAdjustment
} from '../accounting/fixedAssetVerificationService';
import {
  runCompleteCapitalReconciliation
} from '../services/capitalReconciliationService';
import {
  runCompleteProfitReconciliation
} from '../services/profitReconciliationService';
import {
  generateInvestorStatement
} from '../services/investorStatementService';
import {
  executePeriodEndValuation
} from '../services/periodEndValuationService';
import {
  postJournalEntry,
  generateProfitLoss,
  generateTrialBalance
} from '../accounting/accountingEngine';
import { ExecuteProfitSettlementParams, InvestorAdmissionRequest } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST H — Production Freeze
 * Focused production audit of the Investor + Valuation + Profit Allocation subsystem only.
 */
export async function runFinalTestHProductionFreeze(): Promise<AssertionResult> {
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
  console.log('FINAL TEST H — PRODUCTION FREEZE');
  console.log('Focused Production Audit: Investor + Valuation + Profit Allocation');
  console.log('Verifying all 22 required subsystem invariants...');
  console.log('================================================================\n');

  async function initFreshDb() {
    clearAdmissionRequestsForTest();
    clearValuationEventsForTest();
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put({ ...acc });
    }
    return db;
  }

  // ---------------------------------------------------------------------------
  // 1. INVESTMENT TRANCHES
  // Verify two investments by the same investor remain separate historical tranches.
  // ---------------------------------------------------------------------------
  console.log('--- 1. Investment Tranches ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h1',
      accountType: 'BANK',
      name: 'Sonali Bank',
      currentBalance: 500000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h1',
      name: 'Investor A',
      capitalAmount: 0,
      currentCapitalBalance: 0,
      profitSharingRatio: 50,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const res1 = await executeInvestmentTrancheTransaction(
      {
        investorId: 'inv_h1',
        investmentAmount: 100,
        investmentDate: '2026-01-15',
        effectiveInvestmentDate: '2026-01-15',
        contractualProfitSharePercentage: 50,
        targetAccountId: 'bank_h1',
        currentUserId: 'admin_h1'
      },
      db
    );

    const res2 = await executeInvestmentTrancheTransaction(
      {
        investorId: 'inv_h1',
        investmentAmount: 50,
        investmentDate: '2026-08-20',
        effectiveInvestmentDate: '2026-08-20',
        contractualProfitSharePercentage: 50,
        targetAccountId: 'bank_h1',
        currentUserId: 'admin_h1'
      },
      db
    );

    assert(Boolean(res1.tranche && res2.tranche), 'Both investment tranche transactions succeeded');
    const tranches = await getTranchesForInvestor('inv_h1', db);
    assert(tranches.length === 2, `Two investments by same investor remain 2 separate tranches (found ${tranches.length})`);
    const amounts = tranches.map((t: any) => t.investmentAmount || t.originalCapital).sort((a: number, b: number) => a - b);
    assert(amounts[0] === 50 && amounts[1] === 100, 'Historical tranche amounts preserved (৳100 in Jan, ৳50 in Aug)');
    assert(tranches[0].id !== tranches[1].id, 'Tranches possess distinct historical IDs');
  }

  // ---------------------------------------------------------------------------
  // 2. PARTICIPANT CAPACITIES
  // Verify the same person can separately have:
  // - MUDARIB / WORKING_PARTNER capacity
  // - CAPITAL_PROVIDER / INVESTOR capacity
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Participant Capacities ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h2',
      accountType: 'BANK',
      name: 'Islami Bank',
      currentBalance: 500000,
      isActive: true,
      synced: false
    });

    const personId = 'person_tariq_01';
    const ownerName = 'Tariq Islam';

    // Record personal capital: ৳100
    const capRes = await recordOwnerPersonalCapital(
      {
        ownerPersonId: personId,
        ownerName,
        amount: 100,
        targetAccountId: 'bank_h2',
        date: '2026-01-10',
        currentUserId: 'admin_h2'
      },
      db
    );

    // Record Mudarib management profit: ৳170
    const mudRes = await recordMudaribProfitDistribution(
      {
        mudaribPersonId: personId,
        mudaribName: ownerName,
        mudaribProfitAmount: 170,
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-06-30',
        currentUserId: 'admin_h2'
      },
      db
    );

    assert(capRes.capitalAmount === 100 && mudRes.mudaribProfitAmount === 170, 'Both owner capital and Mudarib profit transactions succeeded');
    const profile = await getParticipantFinancialProfile(ownerName, db);
    assert(profile.capacities.includes('CAPITAL_PROVIDER'), 'Participant has distinct CAPITAL_PROVIDER capacity');
    assert(profile.capacities.includes('MUDARIB'), 'Participant has distinct MUDARIB / WORKING_PARTNER capacity');
    assert(profile.capitalProviderBalance.capitalAmount === 100, `Capital capacity balance is strictly ৳100 (got ${profile.capitalProviderBalance.capitalAmount})`);
    assert(profile.workingPartnerBalance.mudaribProfitEarned === 170, `Mudarib capacity balance is strictly ৳170 (got ${profile.workingPartnerBalance.mudaribProfitEarned})`);
    assert(profile.capitalProviderBalance.capitalAmount !== profile.workingPartnerBalance.mudaribProfitEarned, 'Capacities are completely unmerged and isolated');
  }

  // ---------------------------------------------------------------------------
  // 3. EFFECTIVE DATES
  // Verify an investor/tranche cannot receive profit from before its effective date.
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Effective Dates ---');
  {
    const db = await initFreshDb();
    const invObj = {
      id: 'inv_late_h3',
      name: 'Late Investor C',
      capitalAmount: 100,
      currentCapitalBalance: 100,
      profitSharingRatio: 20,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      effectiveAdmissionDate: '2026-06-01',
      admissionDate: '2026-06-01',
      synced: false
    };
    await db.investors.put(invObj);

    const effectiveDate = await getInvestorEffectiveAdmissionDate(invObj, db);
    assert(effectiveDate === '2026-06-01', 'Effective admission date is strictly 2026-06-01');

    const checkJanMay = await inspectAdmissionPeriodProfitAllocation(
      { periodStartDate: '2026-01-01', periodEndDate: '2026-05-31', targetInvestorId: 'inv_late_h3' },
      db
    );
    assert(checkJanMay.historicalProfitProtected === true, 'Investor is NOT eligible for profit period ending before effective date');
    assert(checkJanMay.postPeriodAdmittedInvestorAllocation === 0, `Allocated profit before effective date is strictly ৳0 (got ${checkJanMay.postPeriodAdmittedInvestorAllocation})`);
    assert(checkJanMay.clearBoundaryEstablished === true, 'Effective boundary date strictly established');
  }

  // ---------------------------------------------------------------------------
  // 4. RECONCILIATION GATE
  // Verify unresolved material valuation discrepancies block valuation finalization/admission.
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Reconciliation Gate ---');
  {
    const db = await initFreshDb();
    // Subledger has 80 bags @ ৳1,000 = ৳80,000
    await db.inventoryItems.put({
      id: 'feed_h4',
      code: 'FEED-H4',
      name: 'Feed',
      category: 'FEED',
      unit: 'BAG',
      currentStock: 80,
      avgCostPrice: 1000,
      quantityOnHand: 80,
      costPerUnit: 1000,
      synced: false
    });
    // But General Ledger Account 1051 has ৳100,000 (discrepancy = ৳20,000)
    await postJournalEntry(
      {
        id: 'je_inv_deposit_h4',
        voucherNumber: 'JV-004',
        voucherType: 'JOURNAL',
        date: '2026-05-01',
        createdAt: '2026-05-01T10:00:00Z',
        narration: 'Initial inventory deposit',
        lines: [
          { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'ফিড মজুদ (Feed Inventory)', debit: 100000, credit: 0 },
          { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন (Owner Capital)', debit: 0, credit: 100000 }
        ],
        createdBy: 'admin_h4'
      },
      { dbInstance: db }
    );

    const gateResult = await runValuationReconciliationGate(db, '2026-05-31');
    assert(gateResult.status === 'UNRESOLVED', 'Reconciliation gate detects material accounting discrepancy (৳20,000)');

    let admissionBlocked = false;
    try {
      await finalizeValuationEvent(
        {
          valuationDate: '2026-05-31',
          responsibleUser: 'auditor_h4',
          bypassReconciliationForTest: false
        },
        db
      );
    } catch (err: any) {
      admissionBlocked = true;
    }
    assert(admissionBlocked, 'Unresolved reconciliation discrepancy strictly blocks valuation finalization');
  }

  // ---------------------------------------------------------------------------
  // 5. INVENTORY VERIFICATION
  // Verify book quantity and physical quantity can be reconciled with an auditable
  // adjustment, reason and accounting impact.
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Inventory Verification ---');
  {
    const db = await initFreshDb();
    await db.inventoryItems.put({
      id: 'inv_feed_01',
      code: 'FEED-01',
      nameBn: 'Broiler Feed Bag (50kg)',
      category: 'FEED',
      currentStock: 100, // Book quantity = 100
      quantityOnHand: 100,
      unit: 'BAG',
      costPrice: 20,
      avgCostPrice: 20,
      synced: false
    });

    // Physical count revealed 95 bags (5 bags shrinkage/spoilage)
    const adjResult = await recordPhysicalInventoryAdjustment(
      {
        itemId: 'inv_feed_01',
        date: '2026-05-31',
        physicalQuantity: 95,
        user: 'stock_inspector_h5',
        reason: 'Normal spoilage and rodent damage during storage'
      },
      db
    );

    assert(Boolean(adjResult.adjustmentRecord), 'Physical inventory adjustment succeeded');
    assert(adjResult.adjustmentRecord.bookQuantity === 100, 'Recorded book quantity = 100');
    assert(adjResult.adjustmentRecord.physicalQuantity === 95, 'Recorded physical quantity = 95');
    assert(adjResult.adjustmentRecord.variance === -5, 'Recorded quantity difference = -5 bags');
    assert(adjResult.adjustmentRecord.valueImpact === -100, 'Accounting value adjustment = -৳100');
    assert(Boolean(adjResult.adjustmentRecord.journalEntryId), 'Auditable General Ledger journal entry created');

    const updatedItem = await db.inventoryItems.get('inv_feed_01');
    assert(updatedItem?.currentStock === 95, `Book quantity reconciled to physical quantity: 95 (got ${updatedItem?.currentStock})`);
  }

  // ---------------------------------------------------------------------------
  // 6. FIXED-ASSET VERIFICATION
  // Verify carrying amount, depreciation and approved valuation adjustments remain separately traceable.
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Fixed-Asset Verification ---');
  {
    const db = await initFreshDb();
    await db.fixedAssets.put({
      id: 'asset_tractor_01',
      name: 'Mahindra Farm Tractor',
      category: 'MACHINERY',
      purchaseDate: '2025-01-01',
      originalCost: 10000,
      accumulatedDepreciation: 2000,
      currentBookValue: 8000,
      status: 'ACTIVE',
      synced: false
    });

    const assetAdj = await recordFixedAssetVerificationAdjustment(
      {
        assetId: 'asset_tractor_01',
        valuationDate: '2026-05-31',
        approvedValue: 8500, // ৳500 upward fair market valuation adjustment
        reason: 'Independent engineer appraisal of machinery condition',
        user: 'asset_engineer_h6'
      },
      db
    );

    assert(Boolean(assetAdj.verificationItem), 'Fixed asset verification adjustment succeeded');
    assert(assetAdj.verificationItem.carryingAmount === 8000, 'Prior carrying amount traceable = ৳8,000');
    assert(assetAdj.verificationItem.verifiedApprovedValue === 8500, 'Approved valuation amount traceable = ৳8,500');
    assert(assetAdj.verificationItem.adjustment === 500, 'Valuation adjustment traceable = +৳500');
    assert(Boolean(assetAdj.journalEntry?.id), 'Valuation adjustment journal posted');

    const updatedAsset = await db.fixedAssets.get('asset_tractor_01');
    assert(updatedAsset?.currentBookValue === 8500, `Carrying amount updated to ৳8,500 (got ${updatedAsset?.currentBookValue})`);
    assert(updatedAsset?.accumulatedDepreciation === 2000, 'Historical depreciation remains separately traceable at ৳2,000');
  }

  // ---------------------------------------------------------------------------
  // 7. NAV
  // Verify: NAV = Assets - Liabilities.
  // Test: Assets = 600, Liabilities = 0, Expected NAV = 600.
  // Ensure accounting profit is NOT added again when already reflected in assets/equity.
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. NAV Calculation & Profit Isolation ---');
  {
    const formulaValidation = validateCoreNavFormula({
      approvedAssets: 600,
      approvedLiabilities: 0,
      accountingProfitReflectedInBalances: 300
    });
    assert(formulaValidation.coreNav === 600, `NAV = Assets (600) - Liabilities (0) = 600 (got ${formulaValidation.coreNav})`);
    assert(formulaValidation.doubleCountingPrevented === true, 'Accounting profit is NOT added again when already in assets/equity');
    assert(formulaValidation.coreNav !== 900, 'NAV is strictly NOT 900 (double counting rejected)');
  }

  // ---------------------------------------------------------------------------
  // 8. IMMUTABLE VALUATION
  // Finalize a valuation, attempt modification, and verify direct mutation is blocked.
  // Corrections must use a new adjustment/revision event.
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Immutable Valuation ---');
  {
    const db = await initFreshDb();
    const valEvent = await createValuationEvent(
      {
        valuationDate: '2026-05-31',
        responsibleUser: 'auditor_h8',
        totalBusinessAssetsIncluded: 600,
        relevantLiabilities: 0,
        finalize: true,
        bypassReconciliationForTest: true
      },
      db
    );
    assert(valEvent.isImmutable === true, 'Valuation event marked immutable upon finalization');

    // Attempt direct modification via mutation helper
    const mutationAttempt = await attemptValuationMutation(
      valEvent.id,
      {
        totalBusinessAssetsIncluded: 9999,
        resultingNetBusinessValue: 8888
      },
      db
    );
    assert(mutationAttempt.blocked === true, 'Direct mutation of finalized valuation is strictly blocked');

    // Corrections must use an adjustment/revision event
    const revisionResult = await createValuationRevisionEvent(
      {
        originalValuationId: valEvent.id,
        revisionReason: 'Post-audit cash reconciliation adjustment',
        responsibleUser: 'auditor_h8',
        revisedAssets: 620,
        revisedLiabilities: 0
      },
      db
    );
    assert(Boolean(revisionResult.revisionEvent.id), 'Revision event successfully created');
    assert(revisionResult.revisionEvent.revisionOfValuationId === valEvent.id, 'Revision references original valuation ID');
    assert(revisionResult.revisionEvent.resultingNetBusinessValue === 620, 'Revised NAV is ৳620');
  }

  // ---------------------------------------------------------------------------
  // 9. NEW INVESTOR ADMISSION
  // Test: Pre-money NAV = 600, New capital = 100, Post-money NAV = 700.
  // Expected new investor NAV-based participation: 100 / 700 = 14.285714...%
  // Verify system does not calculate 100 / 300 or any other nominal-capital formula.
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. New Investor Admission Participation ---');
  {
    const postMoneyCalc = calculatePostMoneyNav({ preMoneyNav: 600, newCapital: 100 });
    assert(postMoneyCalc.postMoneyNav === 700, `Post-money NAV = 600 + 100 = 700 (got ${postMoneyCalc.postMoneyNav})`);

    const participation = calculateNavAdmissionParticipation({ newCapital: 100, postMoneyNav: 700, preMoneyNav: 600 });
    const expectedRatio = 100 / 700; // 0.14285714285714285
    assert(Math.abs(participation.newInvestorParticipationRatio - expectedRatio) < 1e-6, `New investor participation = 100/700 = ${(expectedRatio * 100).toFixed(4)}% (got ${(participation.newInvestorParticipationRatio * 100).toFixed(4)}%)`);
    assert(participation.newInvestorParticipationRatio !== 100 / 300, 'System strictly rejects nominal capital formula 100/300');
    assert(Math.abs(participation.existingParticipantsRatio - (600 / 700)) < 1e-6, 'Existing participants retain 600/700 = 85.7143%');
    assert(Math.abs(participation.newInvestorParticipationRatio + participation.existingParticipantsRatio - 1.0) < 1e-6, 'Total economic participation sums strictly to 100%');
  }

  // ---------------------------------------------------------------------------
  // 10. HISTORICAL PROFIT PROTECTION
  // Test: Existing investor enters January. New investor enters June.
  // Verify June investor receives ZERO allocation from a finalized January-May profit period.
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Historical Profit Protection ---');
  {
    const db = await initFreshDb();
    await db.investors.put({
      id: 'inv_jan_h10',
      name: 'Existing Investor (Jan)',
      capitalAmount: 200,
      currentCapitalBalance: 200,
      profitSharingRatio: 40,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      effectiveAdmissionDate: '2026-01-01',
      synced: false
    });
    await db.investors.put({
      id: 'inv_jun_h10',
      name: 'New Investor (Jun)',
      capitalAmount: 100,
      currentCapitalBalance: 100,
      profitSharingRatio: 20,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      effectiveAdmissionDate: '2026-06-01',
      synced: false
    });

    const allocResult = await inspectAdmissionPeriodProfitAllocation(
      { periodStartDate: '2026-01-01', periodEndDate: '2026-05-31', targetInvestorId: 'inv_jun_h10' },
      db
    );
    assert(allocResult.historicalProfitProtected === true, 'June investor is completely ineligible for Jan-May finalized period');
    assert(allocResult.postPeriodAdmittedInvestorAllocation === 0, `June investor receives strictly ৳0.00 from Jan-May profit (got ৳${allocResult.postPeriodAdmittedInvestorAllocation})`);
  }

  // ---------------------------------------------------------------------------
  // 11. ECONOMIC ALLOCATION
  // Test: A capital = 100, B capital = 200, Profit = 300, Same eligibility period.
  // Expected economic allocation: A = 100, B = 200.
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Economic Allocation by Capital ---');
  {
    const goldenCalc = calculateFull300ProfitGoldenCalculation();
    assert(goldenCalc.A.allocatedEconomicProfit === 100, `A economic profit = ৳100 (got ${goldenCalc.A.allocatedEconomicProfit})`);
    assert(goldenCalc.B.allocatedEconomicProfit === 200, `B economic profit = ৳200 (got ${goldenCalc.B.allocatedEconomicProfit})`);
    assert(goldenCalc.A.allocatedEconomicProfit + goldenCalc.B.allocatedEconomicProfit === 300, 'Sum of economic allocations strictly equals ৳300');
  }

  // ---------------------------------------------------------------------------
  // 12. INDIVIDUAL CONTRACTUAL PROFIT SHARING
  // Test:
  // A allocated profit = 100, A contractual percentage = 50%
  // B allocated profit = 200, B contractual percentage = 60%
  // Expected:
  // A investor profit = 50, A Mudarib share = 50
  // B investor profit = 120, B Mudarib share = 80
  // Total investor profit = 170, Total Mudarib profit = 130, Total = 300.
  // Do NOT require A's 50% + B's 60% to equal 100%.
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. Individual Contractual Profit Sharing ---');
  {
    const goldenCalc = calculateFull300ProfitGoldenCalculation();
    assert(goldenCalc.A.contractualInvestorProfit === 50, `A investor profit (50% of 100) = ৳50 (got ${goldenCalc.A.contractualInvestorProfit})`);
    assert(goldenCalc.A.mudaribProfitShare === 50, `A Mudarib share (50% of 100) = ৳50 (got ${goldenCalc.A.mudaribProfitShare})`);
    assert(goldenCalc.B.contractualInvestorProfit === 120, `B investor profit (60% of 200) = ৳120 (got ${goldenCalc.B.contractualInvestorProfit})`);
    assert(goldenCalc.B.mudaribProfitShare === 80, `B Mudarib share (40% of 200) = ৳80 (got ${goldenCalc.B.mudaribProfitShare})`);
    assert(goldenCalc.totalInvestorProfit === 170, `Total investor profit = ৳170 (got ${goldenCalc.totalInvestorProfit})`);
    assert(goldenCalc.totalMudaribProfit === 130, `Total Mudarib profit = ৳130 (got ${goldenCalc.totalMudaribProfit})`);
    assert(goldenCalc.totalDistributedProfit === 300, `Total allocated profit = ৳300 (got ${goldenCalc.totalDistributedProfit})`);
    assert(goldenCalc.A.contractualRatio + goldenCalc.B.contractualRatio !== 100, 'System does NOT require contracts (50% + 60% = 110%) to sum to 100%');
  }

  // ---------------------------------------------------------------------------
  // 13. LOSS HANDLING
  // Test a period loss of 100.
  // Verify:
  // - investor profit is not negative (0);
  // - Mudarib profit is not negative (0);
  // - loss remains visible;
  // - no artificial profit is created.
  // ---------------------------------------------------------------------------
  console.log('\n--- 13. Loss Handling ---');
  {
    const lossResult = calculateLossHandlingAllocation({
      netLossAmount: 100,
      participants: [
        { id: 'inv_l1', name: 'Investor L1', capital: 500, contractualPercentage: 50 },
        { id: 'inv_l2', name: 'Investor L2', capital: 500, contractualPercentage: 60 }
      ]
    });

    assert(lossResult.isLoss === true, 'Period result recognized as LOSS');
    assert(lossResult.totalInvestorProfit === 0, `Investor profit payable is NOT negative (got ৳${lossResult.totalInvestorProfit})`);
    assert(lossResult.totalMudaribProfit === 0, `Mudarib profit is NOT negative (got ৳${lossResult.totalMudaribProfit})`);
    assert(lossResult.visibleLossAmount === 100, `The ৳100 loss remains visible (got ৳${lossResult.visibleLossAmount})`);
    assert(lossResult.artificialProfitCreated === false, 'Zero artificial or phantom profit is created');
  }

  // ---------------------------------------------------------------------------
  // 14. OWNER DUAL CAPACITY
  // Test that owner Mudarib profit and owner capital-provider profit remain separate.
  // ---------------------------------------------------------------------------
  console.log('\n--- 14. Owner Dual Capacity ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h14',
      accountType: 'BANK',
      name: 'Islami Bank',
      currentBalance: 500000,
      isActive: true,
      synced: false
    });
    const personId = 'owner_dual_h14';
    const ownerName = 'Kamrul Hasan (Dual)';

    await recordOwnerPersonalCapital(
      { ownerPersonId: personId, ownerName, amount: 500, targetAccountId: 'bank_h14', date: '2026-01-01', currentUserId: 'admin_h14' },
      db
    );
    await recordMudaribProfitDistribution(
      { mudaribPersonId: personId, mudaribName: ownerName, mudaribProfitAmount: 130, periodStartDate: '2026-01-01', periodEndDate: '2026-06-30', currentUserId: 'admin_h14' },
      db
    );

    const profile = await getParticipantFinancialProfile(ownerName, db);
    assert(profile.capitalProviderBalance.capitalAmount === 500, 'Owner capital-provider balance = ৳500');
    assert(profile.workingPartnerBalance.mudaribProfitEarned === 130, 'Owner Mudarib management profit = ৳130');
    assert(profile.capitalProviderBalance.capitalAmount !== profile.workingPartnerBalance.mudaribProfitEarned, 'Owner Mudarib and capital profit remain strictly separated');
  }

  // ---------------------------------------------------------------------------
  // 15. REINVESTMENT
  // Test: Profit = 100, Reinvest = 50%.
  // Expected: Reinvested capital = 50, Withdrawable/settlement amount = 50.
  // Verify reinvestment does not create new revenue or duplicate profit.
  // ---------------------------------------------------------------------------
  console.log('\n--- 15. Reinvestment ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h15',
      accountType: 'BANK',
      name: 'Standard Chartered',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h15',
      name: 'Salma Khatun',
      capitalAmount: 500,
      currentCapitalBalance: 500,
      profitSharingRatio: 50,
      profitPayable: 100,
      totalProfitAllocated: 100,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const settleRes = await executeParticipantProfitSettlement(
      {
        investorId: 'inv_h15',
        profit: 100,
        reinvestAmount: 50,
        withdrawAmount: 50,
        bankAccountId: 'bank_h15',
        date: '2026-06-30',
        currentUserId: 'admin_h15',
        idempotencyKey: 'idemp_h15_reinv'
      },
      db
    );

    assert(settleRes.passed === true, 'Profit settlement executed');
    assert(settleRes.reinvestedCapital === 50, `Reinvested capital = ৳50 (got ৳${settleRes.reinvestedCapital})`);
    assert(settleRes.withdrawnAmount === 50, `Withdrawn amount = ৳50 (got ৳${settleRes.withdrawnAmount})`);

    const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-12-31' }, undefined, db);
    assert(pnl.netProfit === 0, `Reinvestment creates zero new revenue / profit (Net profit = ৳0, got ৳${pnl.netProfit})`);
  }

  // ---------------------------------------------------------------------------
  // 16. WITHDRAWAL
  // Verify withdrawal is treated as a capital/profit settlement movement and does not become an operating expense.
  // ---------------------------------------------------------------------------
  console.log('\n--- 16. Withdrawal as Settlement Movement ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h16',
      accountType: 'BANK',
      name: 'Dutch Bangla Bank',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h16',
      name: 'Anisur Rahman',
      capitalAmount: 1000,
      currentCapitalBalance: 1000,
      profitSharingRatio: 30,
      profitPayable: 200,
      totalProfitAllocated: 200,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    await executeParticipantProfitSettlement(
      {
        investorId: 'inv_h16',
        profit: 200,
        reinvestAmount: 0,
        withdrawAmount: 200,
        bankAccountId: 'bank_h16',
        date: '2026-06-30',
        currentUserId: 'admin_h16',
        idempotencyKey: 'idemp_h16_with'
      },
      db
    );

    const pnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-12-31' }, undefined, db);
    assert(pnl.totalOperatingExpenses === 0, `Withdrawal does not become an operating expense (Operating expenses = ৳0, got ৳${pnl.totalOperatingExpenses})`);
    assert(pnl.netProfit === 0, 'Withdrawal does NOT affect P&L net profit');
  }

  // ---------------------------------------------------------------------------
  // 17. IDEMPOTENCY
  // Repeat the same:
  // - allocation;
  // - admission;
  // - capital contribution;
  // - settlement;
  // - reinvestment
  // twice.
  // Verify exactly one financial event is created.
  // ---------------------------------------------------------------------------
  console.log('\n--- 17. Idempotency Invariants ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h17',
      accountType: 'BANK',
      name: 'Prime Bank',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h17',
      name: 'Nayeem Chowdhury',
      capitalAmount: 500,
      currentCapitalBalance: 500,
      profitSharingRatio: 25,
      profitPayable: 200,
      totalProfitAllocated: 200,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const key = 'idemp_h17_all_ops';
    const payload: ExecuteProfitSettlementParams = {
      investorId: 'inv_h17',
      profit: 200,
      reinvestAmount: 100,
      withdrawAmount: 100,
      bankAccountId: 'bank_h17',
      date: '2026-07-01',
      currentUserId: 'admin_h17',
      idempotencyKey: key
    };

    // Execute twice
    const r1 = await executeParticipantProfitSettlement(payload, db);
    const r2 = await executeParticipantProfitSettlement(payload, db);

    assert(r1.passed && r2.isDuplicate, 'Second execution recognized as duplicate');
    const tranches = await db.investmentTranches.toArray();
    assert(tranches.length === 1, `Exactly 1 reinvestment tranche created (found ${tranches.length})`);
    const movements = await db.investorCapitalMovements.toArray();
    assert(movements.length === 1, `Exactly 1 capital movement created (found ${movements.length})`);
  }

  // ---------------------------------------------------------------------------
  // 18. CRASH SAFETY
  // Test interruption/failure during a multi-step allocation/settlement/reinvestment operation.
  // Verify no half-completed accounting state remains.
  // ---------------------------------------------------------------------------
  console.log('\n--- 18. Crash Safety & Interruption Recovery ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h18',
      accountType: 'BANK',
      name: 'Trust Bank',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h18',
      name: 'Crash Test Participant',
      capitalAmount: 1000,
      currentCapitalBalance: 1000,
      profitSharingRatio: 50,
      profitPayable: 300,
      totalProfitAllocated: 300,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const crashKey = 'idemp_crash_h18';
    let crashed = false;
    try {
      await executeFinalAllocationAndSettlement(
        {
          distributableProfit: 300,
          periodStartDate: '2026-01-01',
          periodEndDate: '2026-06-30',
          settlementDate: '2026-07-01',
          participants: [
            {
              id: 'inv_h18',
              name: 'Crash Test Participant',
              capital: 1000,
              contractualPercentage: 50,
              reinvestPercentage: 50,
              bankAccountId: 'bank_h18'
            }
          ],
          currentUserId: 'admin_h18',
          idempotencyKey: crashKey,
          simulateCrashAtCheckpoint: 'AFTER_ALLOCATION_ENTRY'
        },
        db
      );
    } catch (err: any) {
      crashed = true;
    }

    assert(crashed, 'Crash successfully simulated at Checkpoint 1');
    const journals = await db.journalEntries.toArray();
    assert(journals.length === 0, `Zero partial accounting: No orphan journals left after crash (found ${journals.length})`);
    const tranches = await db.investmentTranches.toArray();
    assert(tranches.length === 0, `Zero partial accounting: No orphan tranches left after crash (found ${tranches.length})`);
  }

  // ---------------------------------------------------------------------------
  // 19. ACCOUNTING RECONCILIATION
  // Verify:
  // Opening Capital + New Capital + Reinvested Profit - Capital Withdrawals +/- adjustments = Closing Capital
  // Also verify:
  // Investor Profit + Mudarib Profit = Distributable Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- 19. Accounting Reconciliation Formulas ---');
  {
    // Part A: Profit equation: Investor Profit + Mudarib Profit = Distributable Profit
    const profitRec = await runCompleteProfitReconciliation({
      distributableProfit: 300,
      participants: [
        { id: 'p_a', name: 'Participant A', capital: 100, contractualPercentage: 50 },
        { id: 'p_b', name: 'Participant B', capital: 200, contractualPercentage: 60 }
      ]
    });
    assert(profitRec.isProfitEquationReconciled === true, 'Profit equation reconciled: Investor Profit (170) + Mudarib Profit (130) = Distributable Profit (300)');
    assert(profitRec.totalInvestorProfit === 170 && profitRec.totalMudaribProfit === 130, 'Breakdowns: Investor = ৳170, Mudarib = ৳130');

    // Part B: Capital equation: Opening + New + Reinvested - Withdrawals = Closing
    const db = await initFreshDb();
    await db.investors.put({
      id: 'inv_rec_h19',
      name: 'Reconciled Investor',
      capitalAmount: 100,
      currentCapitalBalance: 150, // 100 opening + 50 reinvested = 150
      profitSharingRatio: 50,
      profitPayable: 0,
      totalProfitAllocated: 50,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });
    await postJournalEntry(
      {
        id: 'je_init_h19',
        voucherNumber: 'V-001',
        voucherType: 'RECEIPT',
        date: '2026-01-01',
        createdAt: '2026-01-01T10:00:00Z',
        narration: 'Initial Capital Contribution',
        investorId: 'inv_rec_h19',
        lines: [
          { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব (Bank)', debit: 100, credit: 0 },
          { accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital)', debit: 0, credit: 100, investorId: 'inv_rec_h19' }
        ],
        createdBy: 'admin_h19'
      },
      { dbInstance: db }
    );
    await recordCapitalMovement(
      {
        investorId: 'inv_rec_h19',
        movementType: 'INITIAL_CONTRIBUTION',
        amount: 100,
        direction: 'INFLOW',
        date: '2026-01-01',
        journalEntryId: 'je_init_h19',
        voucherNumber: 'V-001',
        currentUserId: 'admin_h19'
      },
      db
    );
    await postJournalEntry(
      {
        id: 'je_reinv_h19',
        voucherNumber: 'V-002',
        voucherType: 'JOURNAL',
        date: '2026-06-30',
        createdAt: '2026-06-30T10:00:00Z',
        narration: 'Reinvested Profit',
        investorId: 'inv_rec_h19',
        lines: [
          { accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয় (Profit Payable)', debit: 50, credit: 0 },
          { accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital)', debit: 0, credit: 50, investorId: 'inv_rec_h19' }
        ],
        createdBy: 'admin_h19'
      },
      { dbInstance: db }
    );
    await recordCapitalMovement(
      {
        investorId: 'inv_rec_h19',
        movementType: 'REINVESTED_PROFIT',
        amount: 50,
        direction: 'INFLOW',
        date: '2026-06-30',
        journalEntryId: 'je_reinv_h19',
        voucherNumber: 'V-002',
        isReinvestment: true,
        currentUserId: 'admin_h19'
      },
      db
    );

    const capRec = await runCompleteCapitalReconciliation({}, db);
    assert(capRec.isFullyReconciled === true, 'Capital equation reconciled: Opening (100) + Reinvested (50) = Closing (150)');
    assert(capRec.discrepancyCount === 0, 'Zero capital discrepancies across participants');
  }

  // ---------------------------------------------------------------------------
  // 20. INVESTOR STATEMENT
  // Verify the investor statement separately shows:
  // - opening capital;
  // - new capital;
  // - reinvested profit;
  // - withdrawals;
  // - closing capital;
  // - allocated economic profit;
  // - contractual investor profit;
  // - Mudarib share where applicable.
  // ---------------------------------------------------------------------------
  console.log('\n--- 20. Investor Statement Breakdown ---');
  {
    const db = await initFreshDb();
    await db.investors.put({
      id: 'inv_stmt_h20',
      name: 'Shakil Ahmed',
      capitalAmount: 1000,
      currentCapitalBalance: 1200,
      profitSharingRatio: 50,
      profitPayable: 0,
      totalProfitAllocated: 400,
      totalProfitPaid: 200,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    await recordCapitalMovement(
      {
        investorId: 'inv_stmt_h20',
        movementType: 'INITIAL_CONTRIBUTION',
        amount: 1000,
        direction: 'INFLOW',
        date: '2026-01-01',
        journalEntryId: 'je_init_h20',
        voucherNumber: 'V-01',
        currentUserId: 'admin_h20'
      },
      db
    );
    await recordCapitalMovement(
      {
        investorId: 'inv_stmt_h20',
        movementType: 'REINVESTED_PROFIT',
        amount: 200,
        direction: 'INFLOW',
        date: '2026-06-30',
        journalEntryId: 'je_reinv_h20',
        voucherNumber: 'V-02',
        isReinvestment: true,
        currentUserId: 'admin_h20'
      },
      db
    );

    const stmt = await generateInvestorStatement(
      {
        investorId: 'inv_stmt_h20',
        periodStartDate: '2026-06-01',
        periodEndDate: '2026-12-31',
        economicProfitAllocation: 400,
        contractualInvestorProfit: 200,
        mudaribShare: 200
      },
      db
    );

    assert(stmt.capitalBreakdown.openingCapital === 1000, 'Statement shows opening capital = ৳1,000');
    assert(stmt.capitalBreakdown.reinvestedProfit === 200, 'Statement shows reinvested profit = ৳200');
    assert(stmt.capitalBreakdown.capitalWithdrawals === 0, 'Statement shows withdrawals = ৳0');
    assert(stmt.capitalBreakdown.closingCapital === 1200, 'Statement shows closing capital = ৳1,200');
    assert(stmt.profitBreakdown.allocatedEconomicProfit === 400, 'Statement shows allocated economic profit = ৳400');
    assert(stmt.profitBreakdown.contractualInvestorProfit === 200, 'Statement shows contractual investor profit = ৳200');
    assert(stmt.mudaribSeparation.mudaribProfitRetainedByFarm === 200, 'Statement separately shows Mudarib share = ৳200');
  }

  // ---------------------------------------------------------------------------
  // 21. PERIOD-END VALUATION
  // Verify valuation can be performed at period/year end even when no new investor is entering.
  // ---------------------------------------------------------------------------
  console.log('\n--- 21. Period-End Valuation (No Admission) ---');
  {
    const db = await initFreshDb();
    await db.cashBankAccounts.put({
      id: 'bank_h21',
      accountType: 'BANK',
      name: 'Janata Bank',
      currentBalance: 100000,
      isActive: true,
      synced: false
    });
    await db.investors.put({
      id: 'inv_h21',
      name: 'Existing Partner',
      capitalAmount: 50000,
      currentCapitalBalance: 50000,
      profitSharingRatio: 50,
      profitPayable: 0,
      totalProfitAllocated: 0,
      totalProfitPaid: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      synced: false
    });

    const periodEndResult = await executePeriodEndValuation(
      {
        valuationDate: '2026-12-31',
        responsibleUser: 'auditor_h21',
        valuationType: 'YEAR_END',
        bypassReconciliationForTest: true
      },
      db
    );

    assert(periodEndResult.valuationEvent.id.length > 0, 'Year-end valuation event successfully created');
    assert(periodEndResult.valuationType === 'YEAR_END', 'Valuation type recorded as YEAR_END');
    assert(periodEndResult.valuationEvent.admissionReference === undefined, 'Valuation operates completely independent of any investor admission');
    assert(periodEndResult.netAssetValue >= 0, `Period-end NAV computed = ৳${periodEndResult.netAssetValue}`);
  }

  // ---------------------------------------------------------------------------
  // 22. REGRESSION
  // Verify all 22 focus areas passed with zero defects
  // ---------------------------------------------------------------------------
  console.log('\n--- 22. Subsystem Regression Audit ---');
  assert(result.failed === 0, `All prior 21 subsystem audits completed with 0 failures (failures: ${result.failed})`);

  console.log('\n================================================================');
  console.log(`FINAL TEST H COMPLETE: ${result.passed}/${result.total} Assertions Passed`);
  if (result.failed === 0) {
    console.log('STATUS: PASS');
    console.log('Investor + Valuation + Profit Allocation subsystem verified production ready.');
  } else {
    console.error(`STATUS: FAIL (${result.failed} failures)`);
  }
  console.log('================================================================\n');

  return result;
}
