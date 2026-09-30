import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  generateProfitValuationSeparationReport,
  executeProfitDistributionCashSettlement,
  calculateNetAssetValuation,
  createValuationEvent,
  recordFixedAssetVerificationAdjustment,
  clearValuationEventsForTest
} from '../services/valuationService';
import { clearFixedAssetRevaluationEventsForTest } from '../accounting/fixedAssetVerificationService';
import {
  postJournalEntry,
  generateProfitLoss,
  generateBalanceSheet
} from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { FixedAsset, Investor } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 12 — Separate Profit From Valuation
 *
 * Inspect whether the system mixes accounting profit with valuation.
 *
 * Keep these concepts separate:
 * 1. Accounting profit/loss
 * 2. NAV
 * 3. Valuation adjustment
 * 4. Distributable profit
 * 5. Participant economic allocation
 * 6. Contractual profit split
 * 7. Cash settlement
 *
 * A valuation change must not automatically become operating revenue.
 *
 * An accounting profit must not be added again to NAV if already reflected in assets/equity.
 *
 * Test both an accounting profit and a valuation adjustment.
 *
 * Verify they remain separately traceable.
 *
 * Return PASS.
 */
export async function runSeparateProfitFromValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 12: SEPARATE PROFIT FROM VALUATION AUDIT');
  console.log('Testing 7 distinct concepts, non-operating valuation, and NAV non-double-counting');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  clearFixedAssetRevaluationEventsForTest();

  const testUser = 'chief_valuation_controller';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Setting up Accounting Foundation
  // Founder Capital: ৳1,000 | Investor Capital: ৳500 | Total Initial Cash: ৳1,500
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Establishing Accounting Foundation ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  await mDb.cashBankAccounts.put({
    id: 'cb_p12_main',
    name: 'Main Business Bank Account',
    accountType: 'BANK',
    currentBalance: 1500,
    synced: false
  });

  const investorId = 'inv_partner_p12';
  const investorRecord: Investor = {
    id: investorId,
    name: 'তারেক রহমান (Investor Partner)',
    phone: '01712345678',
    capitalContributed: 500,
    capitalAmount: 500,
    profitSharingRatio: 0.40, // 40% Contractual Split
    profitSharePercentage: 40,
    status: 'ACTIVE',
    joinedDate: '2026-01-01',
    synced: false
  };
  await mDb.investors.put(investorRecord);

  // Capital 1: Founder Capital = ৳1,000
  await postJournalEntry(
    {
      id: 'j_p12_founder_cap',
      voucherNumber: 'V-P12-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার প্রারম্ভিক মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 1000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 1000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Capital 2: Investor Capital = ৳500
  await postJournalEntry(
    {
      id: 'j_p12_investor_cap',
      voucherNumber: 'V-P12-02',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      reference: investorId,
      investorId: investorId,
      relatedPerson: investorId,
      narration: 'অংশীদার বিনিয়োগকারীর মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 500, investorId }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Fixed Asset Acquisition & Historical Depreciation
  // Buy Machinery ৳400, Historical Depreciation ৳100 -> Carrying Amount = ৳300
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Fixed Asset Acquisition and Historical Depreciation ---');
  const assetId = 'asset_machinery_p12';
  const initialAssetCost = 400;
  const initialAssetAccDep = 100;
  const initialCarrying = initialAssetCost - initialAssetAccDep; // 300

  const machineryAsset: FixedAsset = {
    id: assetId,
    name: 'ফিড মিল পেলেট মেশিন',
    category: 'MACHINERY',
    purchaseDate: '2026-01-10',
    originalCost: initialAssetCost,
    usefulLifeYears: 4,
    salvageValue: 0,
    accumulatedDepreciation: initialAssetAccDep,
    currentBookValue: initialCarrying,
    status: 'ACTIVE',
    synced: false
  };
  await mDb.fixedAssets.put(machineryAsset);

  // Buy Machinery: Dr 1550 ৳400 | Cr 1030 ৳400
  await postJournalEntry(
    {
      id: 'j_p12_asset_buy',
      voucherNumber: 'V-P12-03',
      voucherType: 'PAYMENT',
      date: '2026-01-10',
      reference: assetId,
      narration: 'ফিড মিল পেলেট মেশিন ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি', debit: initialAssetCost, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: initialAssetCost }
      ],
      createdBy: testUser,
      createdAt: '2026-01-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Depreciation: Dr 6140 ৳100 | Cr 1590 ৳100
  await postJournalEntry(
    {
      id: 'j_p12_asset_dep',
      voucherNumber: 'V-P12-04',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      reference: assetId,
      narration: 'মেশিনের ত্রৈমাসিক অবচয় ধার্যকরণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.DEPRECIATION_EXPENSE, accountName: 'অবচয় খরচ', debit: initialAssetAccDep, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: initialAssetAccDep }
      ],
      createdBy: testUser,
      createdAt: '2026-03-31T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 3: CONCEPT 1 — Accounting Profit/Loss (Trading Operations)
  // Farm Operations: Feed Cost ৳200, Fish Harvest Revenue ৳500
  // Operating Revenue = ৳500
  // Operating COGS = ৳200, Operating Dep = ৳100 -> Operating Expenses = ৳300
  // Accounting Operating Profit = ৳500 - ৳300 = ৳200
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: CONCEPT 1 — Accounting Operating Profit/Loss ---');
  // Feed COGS: Dr 5010 ৳200 | Cr 1030 ৳200
  await postJournalEntry(
    {
      id: 'j_p12_cogs',
      voucherNumber: 'V-P12-05',
      voucherType: 'PAYMENT',
      date: '2026-04-10',
      narration: 'মাছের খাদ্য ক্রয় ও ব্যবহার (COGS)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FISH_COGS, accountName: 'মাছের খাদ্য ও উৎপাদন খরচ', debit: 200, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 200 }
      ],
      createdBy: testUser,
      createdAt: '2026-04-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Fish Revenue: Dr 1030 ৳500 | Cr 4010 ৳500
  await postJournalEntry(
    {
      id: 'j_p12_revenue',
      voucherNumber: 'V-P12-06',
      voucherType: 'RECEIPT',
      date: '2026-05-15',
      narration: 'মাছ বিক্রয় আয় জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 500 }
      ],
      createdBy: testUser,
      createdAt: '2026-05-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Verify Concept 1: Accounting Profit before valuation adjustment
  const preRevalPl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-05-31' }, undefined, mDb);
  assert(preRevalPl.totalRevenue === 500, 'Concept 1: Operating revenue from trading is strictly ৳500');
  assert(preRevalPl.totalCogs === 200, 'Concept 1: Cost of goods sold is ৳200');
  assert(preRevalPl.grossProfit === 300, 'Concept 1: Gross profit is ৳300 (500 - 200)');
  assert(preRevalPl.totalOperatingExpenses === 100, 'Concept 1: Operating expenses (depreciation) is ৳100');
  assert(preRevalPl.operatingProfit === 200, 'Concept 1: Accounting operating profit is strictly ৳200 (300 - 100)');

  // ---------------------------------------------------------------------------
  // STEP 4: CONCEPT 3 — Valuation Adjustment (Non-Operating Revaluation)
  // Physical audit reveals machinery wear: Approved Value = ৳250 (Carrying was ৳300)
  // Valuation Adjustment = ৳250 - ৳300 = -৳50
  // CRITICAL RULE: Valuation change must NOT automatically become operating revenue!
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: CONCEPT 3 — Valuation Adjustment ---');
  const revalAdjustment = await recordFixedAssetVerificationAdjustment(
    {
      assetId,
      approvedValue: 250,
      reason: 'নিরীক্ষা কারিগরি মূল্যায়ন: পেলেট মেশিনের ব্লেড ও মোটরে ক্ষয়ক্ষতিজনিত অবমূল্যায়ন',
      user: testUser,
      valuationDate: '2026-06-15'
    },
    mDb
  );

  assert(revalAdjustment.revaluationEvent !== undefined, 'Concept 3: Auditable revaluation event created');
  assert(revalAdjustment.revaluationEvent!.adjustment === -50, 'Concept 3: Valuation adjustment is strictly -৳50');
  assert(revalAdjustment.revaluationEvent!.carryingAmount === 300, 'Concept 3: Carrying amount before adjustment was ৳300');
  assert(revalAdjustment.revaluationEvent!.verifiedApprovedValue === 250, 'Concept 3: Approved value is ৳250');
  assert(revalAdjustment.revaluationEvent!.isOperatingProfit === false, 'Concept 3: isOperatingProfit is strictly FALSE');

  // Verify that P&L operating revenue was NOT distorted by valuation adjustment:
  const postRevalPl = await generateProfitLoss({ startDate: '2026-01-01', endDate: valDate }, undefined, mDb);
  assert(postRevalPl.totalRevenue === 500, 'CRITICAL RULE: Operating revenue remains strictly ৳500 (valuation change did NOT become operating revenue)');
  assert(postRevalPl.grossProfit === 300, 'Gross profit remains strictly ৳300 (operating margin completely unaffected)');
  assert(postRevalPl.operatingProfit === 200, 'Operating profit remains strictly ৳200 (trading operations preserved)');
  assert(postRevalPl.totalOtherExpenses === 50, 'Impairment is classified separately under non-operating expenses (8020), NOT operating expenses');
  assert(postRevalPl.netProfit === 150, 'Bottom-line net profit is ৳150 (200 operating - 50 non-operating impairment)');

  // ---------------------------------------------------------------------------
  // STEP 5: CONCEPT 2 — NAV (Net Asset Value)
  // Total Approved Assets: Bank (৳1,400) + Net Machinery (৳250) = ৳1,650
  // Total Approved Liabilities = ৳0
  // Core NAV = ৳1,650 - ৳0 = ৳1,650
  // CRITICAL RULE: Accounting profit must NOT be added again to NAV if already in assets/equity!
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: CONCEPT 2 — Net Asset Value (NAV) ---');
  const navCalc = await calculateNetAssetValuation(valDate, mDb);

  assert(navCalc.totalEligibleAssets === 1650, 'Concept 2: Total approved assets = ৳1,650 (Bank ৳1,400 + Machinery ৳250)');
  assert(navCalc.totalDeductedLiabilities === 0, 'Concept 2: Total approved liabilities = ৳0');
  assert(navCalc.netAssetValue === 1650, 'Concept 2: NAV is strictly ৳1,650 (1,650 - 0 = 1,650)');

  // CRITICAL AUDIT: Verify profit was NOT double-counted in NAV
  // Erroneous calculation: 1,650 - 0 + 150 = 1,800
  assert(navCalc.netAssetValue !== 1800, 'CRITICAL RULE: NAV is NOT ৳1,800 (accounting profit is NOT added again to NAV)');
  assert(navCalc.netProfitExcludedFromNavSum === true, 'Audit flag confirms net profit excluded from NAV sum');
  assert(navCalc.doubleCountingProfitPrevented === true, 'Audit flag confirms double counting prevented');

  // Verify Balance Sheet balance:
  const bs = await generateBalanceSheet(valDate, mDb);
  assert(bs.totalAssets === 1650, 'Balance Sheet total assets = ৳1,650');
  assert(bs.totalLiabilities === 0, 'Balance Sheet total liabilities = ৳0');
  assert(bs.totalEquity === 1650, 'Balance Sheet total equity = ৳1,650 (Capital 1,500 + Net Profit 150)');

  // ---------------------------------------------------------------------------
  // STEP 6: CONCEPT 4 — Distributable Profit
  // Realized operating trading profit available for distribution = ৳200
  // Unrealized valuation changes are excluded from distributable operating dividend
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: CONCEPT 4 — Distributable Profit ---');
  const report = await generateProfitValuationSeparationReport({
    asOfDate: valDate,
    periodStartDate: '2026-01-01',
    investorId,
    investorRatio: 0.40,
    workingPartnerRatio: 0.60,
    dbInstance: mDb
  });

  assert(report.distributableProfit.realizedOperatingProfit === 200, 'Concept 4: Realized operating profit is strictly ৳200');
  assert(report.distributableProfit.distributableAmount === 200, 'Concept 4: Distributable profit is strictly ৳200');
  assert(report.distributableProfit.isRealized === true, 'Concept 4: Distributable profit is confirmed REALIZED');

  // ---------------------------------------------------------------------------
  // STEP 7: CONCEPT 5 — Participant Economic Allocation
  // Investor capital: ৳500 / Total capital ৳1,500 = 33.33% (0.33)
  // Demonstrates economic participation ratio based on capital contributed
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: CONCEPT 5 — Participant Economic Allocation ---');
  const participantAllocation = report.participantEconomicAllocation.find((p) => p.participantId === investorId);
  assert(participantAllocation !== undefined, 'Concept 5: Investor participant allocation exists');
  assert(participantAllocation?.capitalContributed === 500, 'Concept 5: Investor capital is ৳500');
  assert(participantAllocation?.economicRatio === 0.33, 'Concept 5: Economic ratio is 33.33% (500 / 1500)');

  // ---------------------------------------------------------------------------
  // STEP 8: CONCEPT 6 — Contractual Profit Split
  // Agreed ratio: Investor 40% (0.40), Working Partner 60% (0.60)
  // Applied strictly to Distributable Profit (৳200):
  // Investor Share = ৳200 × 40% = ৳80
  // Working Partner Share = ৳200 × 60% = ৳120
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 8: CONCEPT 6 — Contractual Profit Split ---');
  assert(report.contractualProfitSplit.investorRatio === 0.40, 'Concept 6: Contractual investor ratio is 40% (0.40)');
  assert(report.contractualProfitSplit.workingPartnerRatio === 0.60, 'Concept 6: Contractual working partner ratio is 60% (0.60)');
  assert(report.contractualProfitSplit.investorShare === 80, 'Concept 6: Investor profit share is strictly ৳80 (200 * 0.40)');
  assert(report.contractualProfitSplit.workingPartnerShare === 120, 'Concept 6: Working partner profit share is strictly ৳120 (200 * 0.60)');
  assert(report.contractualProfitSplit.totalSplit === 200, 'Concept 6: Total split equals distributable profit of ৳200');

  // Post allocation journal to formalize liability: Dr 3070 (Distribution) ৳80 | Cr 2050 (Payable) ৳80
  await postJournalEntry(
    {
      id: 'j_p12_profit_alloc',
      voucherNumber: 'V-P12-ALLOC',
      voucherType: 'JOURNAL',
      date: '2026-06-28',
      reference: investorId,
      narration: 'বিনিয়োগকারীর অর্জিত মুনাফা বণ্টন দায় নির্ধারণ (Dr 3070 / Cr 2050)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.PROFIT_DISTRIBUTION, accountName: 'মুনাফা বণ্টন হিসাব', debit: 80, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, accountName: 'বিনিয়োগকারীর মুনাফা প্রদেয় (2050)', debit: 0, credit: 80 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-28T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const postAllocBs = await generateBalanceSheet(valDate, mDb);
  const payableLine = postAllocBs.liabilities.find((l) => l.code === CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE);
  assert(payableLine?.amount === 80, 'Investor profit payable balance is ৳80 before cash settlement');

  // ---------------------------------------------------------------------------
  // STEP 9: CONCEPT 7 — Cash Settlement
  // Monetary disbursement executing the payable settlement:
  // Dr 2050 (Investor Profit Payable) ৳80 | Cr 1030 (Bank) ৳80
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 9: CONCEPT 7 — Cash Settlement ---');
  const settlementResult = await executeProfitDistributionCashSettlement({
    investorId,
    amount: 80,
    date: '2026-06-30',
    bankAccountId: 'cb_p12_main',
    responsibleUser: testUser,
    dbInstance: mDb
  });

  assert(settlementResult.settledAmount === 80, 'Concept 7: Cash settled amount is strictly ৳80');
  assert(settlementResult.remainingPayable === 0, 'Concept 7: Remaining profit payable liability is strictly ৳0');
  assert(Boolean(settlementResult.voucherNumber), 'Concept 7: Settlement generated valid payment voucher number');
  assert(Boolean(settlementResult.journalEntryId), 'Concept 7: Settlement posted double-entry journal');

  // Verify bank balance after settlement: ৳1,400 - ৳80 = ৳1,320
  const postSettleBs = await generateBalanceSheet(valDate, mDb);
  const bankAfterSettle = postSettleBs.assets.find((a) => a.code === CANONICAL_ACCOUNTS.BANK);
  assert(bankAfterSettle?.amount === 1320, 'Concept 7: Cash / Bank balance after settlement is ৳1,320 (1400 - 80)');

  // ---------------------------------------------------------------------------
  // STEP 10: Traceability Verification of All 7 Separate Concepts
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 10: Verifying Complete Traceability of All 7 Concepts ---');
  const finalReport = await generateProfitValuationSeparationReport({
    asOfDate: valDate,
    periodStartDate: '2026-01-01',
    investorId,
    investorRatio: 0.40,
    workingPartnerRatio: 0.60,
    dbInstance: mDb
  });

  // Verify all 7 concepts are separate and distinct:
  assert(finalReport.accountingProfit.operatingProfit === 200, 'Traceable 1: Accounting operating profit = ৳200');
  assert(finalReport.nav.netAssetValue === 1570, 'Traceable 2: Post-settlement NAV = ৳1,570 (Assets 1,570 [Bank 1320 + FA 250] - Liab 0)');
  assert(finalReport.valuationAdjustment.totalAdjustmentAmount === -50, 'Traceable 3: Valuation adjustment = -৳50');
  assert(finalReport.distributableProfit.distributableAmount === 200, 'Traceable 4: Distributable profit = ৳200');
  assert(finalReport.participantEconomicAllocation[0]?.economicRatio === 0.33, 'Traceable 5: Economic allocation ratio = 33.33%');
  assert(finalReport.contractualProfitSplit.investorShare === 80, 'Traceable 6: Contractual investor share = ৳80');
  assert(finalReport.cashSettlement.settledAmount === 80, 'Traceable 7: Cash settlement = ৳80');
  assert(finalReport.cashSettlement.isSettled === true, 'Traceable 7: Cash settlement status is SETTLED');

  // Verify core rules:
  assert(finalReport.valuationChangeNotOperatingRevenue === true, 'Rule confirmed: Valuation change is NOT operating revenue');
  assert(finalReport.accountingProfitNotDoubleCountedInNav === true, 'Rule confirmed: Accounting profit is NOT double-counted in NAV');
  assert(finalReport.conceptsAreSeparatelyTraceable === true, 'Rule confirmed: All 7 concepts remain separately traceable');
  assert(finalReport.status === 'PASS', 'Report status returns strictly PASS');

  console.log('\n================================================================');
  console.log(`PROMPT 12 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 12 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 12 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testSeparateProfitFromValuation')) {
  runSeparateProfitFromValuationTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 12 tests:', err);
      process.exit(1);
    });
}
