import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  verifyValuationLiabilities,
  detectCashOnlyLiabilitiesBias
} from '../accounting/liabilityVerificationService';
import {
  calculateNetAssetValuation,
  createValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';
import {
  reconcileSupplierBalances,
  reconcileLoansSubledger,
  runValuationReconciliationGate
} from '../accounting/reconciliationService';
import { postJournalEntry, generateBalanceSheet } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { Party, Loan, InventoryItem, FixedAsset } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 10 — Liability Verification
 *
 * Inspect valuation liability calculation.
 *
 * Ensure valuation includes material liabilities such as:
 * - supplier payables;
 * - loans;
 * - accrued obligations;
 * - other recorded liabilities.
 *
 * Do not use only cash liabilities.
 *
 * The system must use the accounting source of truth.
 *
 * Test with:
 *   Assets = 600
 *   Liabilities = 100
 *
 * Verify NAV is 500 before any additional valuation adjustment.
 *
 * Return PASS or UNRESOLVED.
 */
export async function runLiabilityVerificationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 10: LIABILITY VERIFICATION AUDIT');
  console.log('Testing: Assets = 600, Liabilities = 100, NAV = 500 before adjustment');
  console.log('================================================================\n');

  clearValuationEventsForTest();

  const testUser = 'chief_audit_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Accounting Environment (Source of Truth)
  // Assets = 600:
  //   - Bank (1030): 250
  //   - Feed Inventory (1051): 200
  //   - Machinery (1550): 150
  // Liabilities = 100:
  //   - Supplier Payables (2010): 40
  //   - Loans (2110): 30
  //   - Accrued Obligations (2020): 20
  //   - Other Recorded Liabilities (2030): 10
  // Equity = 500 (Owner Capital 3010: 500)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting up Accounting Source of Truth (Assets=600, Liab=100, Equity=500) ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 1a. Operational Cash/Bank Account: Balance ৳250
  await mDb.cashBankAccounts.put({
    id: 'cb_p10_main',
    name: 'Business Operating Bank Account',
    accountType: 'BANK',
    currentBalance: 250,
    synced: false
  });

  // 1b. Operational Inventory Item: Feed, Stock 2 bags @ ৳100 = ৳200
  await mDb.inventoryItems.put({
    id: 'item_feed_p10',
    code: 'FEED-P10',
    nameBn: 'মাছের বিশেষ খাবার',
    nameEn: 'Fish Feed',
    category: 'FEED',
    currentStock: 2,
    unit: 'BAG',
    avgCostPrice: 100,
    costPrice: 100,
    sellingPrice: 130,
    synced: false
  });
  await mDb.stockMovements.put({
    id: 'sm_feed_p10',
    date: '2026-01-10',
    itemId: 'item_feed_p10',
    movementType: 'OPENING',
    quantity: 2,
    unitCost: 100,
    totalValue: 200,
    status: 'POSTED',
    synced: false
  });

  // 1c. Operational Fixed Asset: Machinery, Cost ৳150, AccDep ৳0, BookValue ৳150
  await mDb.fixedAssets.put({
    id: 'asset_aerator_p10',
    name: 'পুকুর এয়ারেটর মেশিন',
    category: 'MACHINERY',
    purchaseDate: '2026-01-10',
    originalCost: 150,
    usefulLifeYears: 5,
    salvageValue: 0,
    accumulatedDepreciation: 0,
    currentBookValue: 150,
    status: 'ACTIVE',
    synced: false
  });

  // 1d. Operational Supplier: Feed Mills Ltd, Balance ৳40
  const supplierId = 'pty_supp_feed_p10';
  await mDb.parties.put({
    id: supplierId,
    name: 'মেঘনা ফিড মিলস লি.',
    type: 'SUPPLIER',
    phone: '01711000000',
    balance: 40,
    currentBalance: 40,
    isActive: true,
    synced: false
  });

  // 1e. Operational Loan: Sonali Bank SME Loan, Balance ৳30
  const loanId = 'loan_sme_p10';
  await mDb.loans.put({
    id: loanId,
    loanType: 'BORROWED',
    bankAccountId: 'cb_p10_main',
    principalAmount: 30,
    remainingPrincipal: 30,
    disbursementDate: '2026-01-10',
    status: 'ACTIVE',
    lenderName: 'সোনালী ব্যাংক পিএলসি',
    synced: false
  });

  // 1f. Authoritative Journal Entries in General Ledger:
  // Transaction 1: Owner Capital Contribution (Dr Bank ৳370 | Cr Owner Capital ৳370)
  await postJournalEntry(
    {
      id: 'j_p10_capital',
      voucherNumber: 'V-P10-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার প্রারম্ভিক মূলধন বিনিয়োগ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 370, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 370 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 2: Bank Loan Disbursement (Dr Bank ৳30 | Cr Short-Term Loans 2110 ৳30)
  // Material Liability 1: LOANS (৳30)
  await postJournalEntry(
    {
      id: 'j_p10_loan',
      voucherNumber: 'V-P10-02',
      voucherType: 'RECEIPT',
      date: '2026-01-10',
      reference: loanId,
      narration: 'সোনালী ব্যাংক হতে স্বল্পমেয়াদী ঋণ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 30, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ব্যাংক ঋণ', debit: 0, credit: 30 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-10T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 3: Purchase Feed on Credit (Dr Feed Inventory 1051 ৳200 | Cr Accounts Payable 2010 ৳40, Cr Bank 1030 ৳160)
  // Material Asset: Inventory (৳200) | Material Liability 2: SUPPLIER PAYABLES (৳40)
  await postJournalEntry(
    {
      id: 'j_p10_purchase',
      voucherNumber: 'V-P10-03',
      voucherType: 'PURCHASE',
      date: '2026-01-15',
      reference: supplierId,
      narration: 'সরবরাহকারীর নিকট হতে বাকিতে ও নগদে ফিড ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: 200, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, accountName: 'সরবরাহকারীর প্রদেয় হিসাব (AP)', debit: 0, credit: 40 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 160 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 4: Purchase Machinery (Dr Machinery 1550 ৳150 | Cr Bank 1030 ৳150)
  // Material Asset: Machinery (৳150)
  await postJournalEntry(
    {
      id: 'j_p10_machinery',
      voucherNumber: 'V-P10-04',
      voucherType: 'PAYMENT',
      date: '2026-01-20',
      reference: 'asset_aerator_p10',
      narration: 'পুকুর এয়ারেটর মেশিন ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি ও সরঞ্জাম', debit: 150, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 150 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-20T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 5: Farm Labor Accrual (Dr Farm Labour Wages 6020 ৳20 | Cr Accrued Wages 2020 ৳20)
  // Material Liability 3: ACCRUED OBLIGATIONS (৳20)
  await postJournalEntry(
    {
      id: 'j_p10_accrual',
      voucherNumber: 'V-P10-05',
      voucherType: 'JOURNAL',
      date: '2026-06-28',
      narration: 'জুন মাসের বকেয়া খামার শ্রমিকের মজুরি নির্ধারণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES, accountName: 'খামার শ্রমিকের মজুরি খরচ', debit: 20, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCRUED_WAGES, accountName: 'বকেয়া মজুরি (Accrued Wages)', debit: 0, credit: 20 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-28T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 6: Statutory / Other Accrual (Dr Miscellaneous Expense 6150 ৳10 | Cr Other Recorded Liabilities 2090 ৳10)
  // Material Liability 4: OTHER RECORDED LIABILITIES (৳10)
  await postJournalEntry(
    {
      id: 'j_p10_tax',
      voucherNumber: 'V-P10-06',
      voucherType: 'JOURNAL',
      date: '2026-06-29',
      narration: 'অন্যান্য স্বীকৃত সাধারণ প্রদেয় দায় হিসাবভুক্তকরণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, accountName: 'বিবিধ সাধারণ খরচ', debit: 10, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OTHER_LIABILITIES, accountName: 'অন্যান্য স্বীকৃত প্রদেয় দায় (Other Recorded Liabilities)', debit: 0, credit: 10 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-29T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Transaction 7: Operating Profit earned to bring Equity exactly to 500
  // Dr Bank 1030 ৳160 | Cr Fish Revenue 4010 ৳190
  // P&L Net Profit = 190 (revenue) - 20 (wages) - 10 (tax) = 160.
  // Total Equity = 370 (capital) + 160 (net profit) = 530 - 30 = 500!
  await postJournalEntry(
    {
      id: 'j_p10_revenue',
      voucherNumber: 'V-P10-07',
      voucherType: 'RECEIPT',
      date: '2026-06-30',
      narration: 'মাছ বিক্রয় আয় জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 160, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 160 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-30T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Verify the Accounting Source of Truth (Balance Sheet)
  // Assets = 600, Liabilities = 100, Equity = 500
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Verifying Balance Sheet from Accounting Source of Truth ---');
  const bs = await generateBalanceSheet(valDate, mDb);

  assert(bs.totalAssets === 600, 'Accounting source of truth: totalAssets is strictly 600');
  assert(bs.totalLiabilities === 100, 'Accounting source of truth: totalLiabilities is strictly 100');
  assert(bs.totalEquity === 500, 'Accounting source of truth: totalEquity is strictly 500');
  assert(bs.isBalanced === true, 'Accounting source of truth: Balance Sheet is 100% balanced');

  // Verify breakdown of assets in Balance Sheet:
  // Bank (1030): 370 + 30 - 160 - 150 + 160 = 250
  // Inventory (1051): 200
  // Machinery (1550): 150
  // Sum = 250 + 200 + 150 = 600
  const bankAsset = bs.assets.find((a) => a.code === CANONICAL_ACCOUNTS.BANK);
  const invAsset = bs.assets.find((a) => a.code === CANONICAL_ACCOUNTS.FEED_INVENTORY);
  const machAsset = bs.assets.find((a) => a.code === CANONICAL_ACCOUNTS.MACHINERY);
  assert(bankAsset?.amount === 250, 'Asset Bank (1030) is ৳250');
  assert(invAsset?.amount === 200, 'Asset Inventory (1051) is ৳200');
  assert(machAsset?.amount === 150, 'Asset Machinery (1550) is ৳150');

  // Verify breakdown of liabilities in Balance Sheet:
  // Payables (2010): 40
  // Loans (2110): 30
  // Accrued Wages (2020): 20
  // Other Recorded Liabilities (2090): 10
  // Sum = 40 + 30 + 20 + 10 = 100
  const apLiab = bs.liabilities.find((l) => l.code === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE);
  const loanLiab = bs.liabilities.find((l) => l.code === CANONICAL_ACCOUNTS.SHORT_TERM_LOANS);
  const accruedLiab = bs.liabilities.find((l) => l.code === CANONICAL_ACCOUNTS.ACCRUED_WAGES);
  const otherLiab = bs.liabilities.find((l) => l.code === CANONICAL_ACCOUNTS.OTHER_LIABILITIES);
  assert(apLiab?.amount === 40, 'Liability Accounts Payable (2010) is ৳40');
  assert(loanLiab?.amount === 30, 'Liability Short-Term Loans (2110) is ৳30');
  assert(accruedLiab?.amount === 20, 'Liability Accrued Wages (2020) is ৳20');
  assert(otherLiab?.amount === 10, 'Liability Other Recorded Liabilities (2090) is ৳10');

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Valuation Calculation (NAV = 500 before additional adjustment)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Valuation Calculation and NAV = 500 ---');
  const navCalc = await calculateNetAssetValuation(valDate, mDb);

  assert(navCalc.totalEligibleAssets === 600, 'Valuation totalEligibleAssets is strictly 600');
  assert(navCalc.totalDeductedLiabilities === 100, 'Valuation totalDeductedLiabilities is strictly 100');
  assert(navCalc.netAssetValue === 500, 'CRITICAL TEST: Net Asset Value (NAV) is strictly 500 before any additional valuation adjustment (600 - 100 = 500)');
  assert(navCalc.reproducibleFromGl === true, 'Valuation is 100% reproducible from General Ledger');

  // ---------------------------------------------------------------------------
  // STEP 4: Inspect That Valuation Includes All Material Liabilities
  // - supplier payables;
  // - loans;
  // - accrued obligations;
  // - other recorded liabilities.
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Inspecting That All 4 Material Liability Categories Are Included ---');
  const report = await verifyValuationLiabilities(valDate, mDb);

  assert(report.supplierPayables === 40, 'Material liability 1: Supplier payables (Trade Payables 2010) included as ৳40');
  assert(report.loans === 30, 'Material liability 2: Loans (Bank loans 2110) included as ৳30');
  assert(report.accruedObligations === 20, 'Material liability 3: Accrued obligations (Accrued wages 2020) included as ৳20');
  assert(report.otherRecordedLiabilities === 10, 'Material liability 4: Other recorded liabilities (2090) included as ৳10');
  assert(report.totalDeductedLiabilities === 100, 'Total deducted liabilities in verification report is strictly 100 (40 + 30 + 20 + 10)');
  assert(report.netAssetValue === 500, 'Verification report netAssetValue is strictly 500');

  // Verify category groupings inside NavAuditCalculation:
  const tpCat = navCalc.liabilityCategories.find((c) => c.category === 'TRADE_PAYABLES');
  const loanCat = navCalc.liabilityCategories.find((c) => c.category === 'LOANS');
  const accCat = navCalc.liabilityCategories.find((c) => c.category === 'ACCRUED_OBLIGATIONS');
  const otherCat = navCalc.liabilityCategories.find((c) => c.category === 'OTHER_LIABILITIES');

  assert(tpCat !== undefined && tpCat.totalAmount === 40, 'TRADE_PAYABLES category amount is ৳40');
  assert(loanCat !== undefined && loanCat.totalAmount === 30, 'LOANS category amount is ৳30');
  assert(accCat !== undefined && accCat.totalAmount === 20, 'ACCRUED_OBLIGATIONS category amount is ৳20');
  assert(otherCat !== undefined && otherCat.totalAmount === 10, 'OTHER_LIABILITIES category amount is ৳10');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify That System Does NOT Use Only Cash Liabilities
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Testing Rejection of "Cash Liabilities Only" ---');
  assert(report.onlyCashLiabilitiesUsed === false, 'CRITICAL: onlyCashLiabilitiesUsed is strictly FALSE');
  assert(report.includesNonCashAccrualLiabilities === true, 'includesNonCashAccrualLiabilities is confirmed TRUE');

  // Test bias detector: demonstrates what happens if someone tried to deduct only cash liabilities (loans = 30)
  const biasCheck = detectCashOnlyLiabilitiesBias(report);
  assert(biasCheck.isBiased === true, 'Bias detector catches non-cash liabilities present in business');
  assert(biasCheck.omittedNonCashObligations === 70, 'Bias detector quantifies exactly ৳70 of non-cash obligations (40 AP + 20 Accruals + 10 Tax)');
  assert(biasCheck.falselyReportedNav === 570, 'Bias detector demonstrates cash-only calculation would falsely report NAV as ৳570');
  assert(biasCheck.actualAuthoritativeNav === 500, 'Authoritative accounting NAV is strictly ৳500');

  // ---------------------------------------------------------------------------
  // STEP 6: Verify Valuation Reconciliation Gate & Return PASS
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Verifying Reconciliation Gate and Returning PASS ---');
  // Reconcile payables subledger (40 vs 40)
  const suppRecon = await reconcileSupplierBalances(mDb, undefined, valDate);
  assert(suppRecon.isMatched === true, 'Supplier payables subledger is 100% matched with GL 2010 (৳40)');
  assert(suppRecon.operationalAmount === 40, 'Operational supplier balance is ৳40');
  assert(suppRecon.glAmount === 40, 'GL 2010 balance is ৳40');

  // Reconcile loans subledger (30 vs 30)
  const loanRecon = await reconcileLoansSubledger(mDb, undefined, valDate);
  assert(loanRecon.isMatched === true, 'Loans subledger is 100% matched with GL 2110 (৳30)');
  assert(loanRecon.operationalAmount === 30, 'Operational loan balance is ৳30');
  assert(loanRecon.glAmount === 30, 'GL 2110 balance is ৳30');

  // Verify valuation reconciliation gate passes
  const gateResult = await runValuationReconciliationGate(mDb, valDate);
  assert(gateResult.status === 'PASS', 'Valuation reconciliation gate returns strictly PASS on reconciled state');

  // Verify verification report status is PASS
  assert(report.status === 'PASS', 'Valuation liability verification report status returns strictly PASS');

  // Create finalized valuation event
  const valEvent = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: true
    },
    mDb
  );
  assert(valEvent.status === 'FINALIZED', 'Valuation event successfully FINALIZED with verified liabilities');
  assert(valEvent.totalBusinessAssetsIncluded === 600, 'Valuation event totalBusinessAssetsIncluded = 600');
  assert(valEvent.relevantLiabilities === 100, 'Valuation event relevantLiabilities = 100');
  assert(valEvent.resultingNetBusinessValue === 500, 'Valuation event resultingNetBusinessValue = 500 (NAV before additional adjustment)');

  // ---------------------------------------------------------------------------
  // STEP 7: Verify UNRESOLVED Return Condition When Discrepancy Exists
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Testing UNRESOLVED Condition on Material Discrepancy ---');
  // Corrupt supplier balance in subledger to 20 without GL entry (simulating un-reconciled discrepancy)
  await mDb.parties.update(supplierId, { balance: 20, currentBalance: 20 });

  const corruptedSuppRecon = await reconcileSupplierBalances(mDb, undefined, valDate);
  assert(corruptedSuppRecon.isMatched === false, 'Supplier reconciliation fails on discrepancy (Subledger ৳20 vs GL ৳40)');

  const corruptedReport = await verifyValuationLiabilities(valDate, mDb);
  assert(corruptedReport.status === 'UNRESOLVED', 'CRITICAL: verifyValuationLiabilities returns UNRESOLVED when subledger discrepancy exists');
  assert(corruptedReport.unresolvedReasons !== undefined && corruptedReport.unresolvedReasons.length > 0, 'Unresolved reasons are provided');

  // Restore supplier balance back to 40
  await mDb.parties.update(supplierId, { balance: 40, currentBalance: 40 });
  const restoredReport = await verifyValuationLiabilities(valDate, mDb);
  assert(restoredReport.status === 'PASS', 'Restored report returns strictly PASS');

  console.log('\n================================================================');
  console.log(`PROMPT 10 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  if (result.failed === 0) {
    console.log('Prompt 10 tests PASSED cleanly: ' + result.passed + '/' + result.total + ' PASS.');
  } else {
    console.error('Prompt 10 tests FAILED: ' + result.failed + ' failures.');
  }

  return result;
}

// Standalone runner
if (typeof process !== 'undefined' && process.argv[1]?.includes('testLiabilityVerification')) {
  runLiabilityVerificationTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 10 tests:', err);
      process.exit(1);
    });
}
