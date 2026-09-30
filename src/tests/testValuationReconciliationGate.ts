import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  createValuationEvent,
  finalizeValuationEvent,
  finalizeValuation,
  getValuationEventById,
  runValuationReconciliationGate,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 2 — RECONCILIATION AND VALUATION
 * PROMPT 07 — Valuation Reconciliation Gate
 *
 * Inspect the valuation process.
 * Before a valuation can be finalized, require reconciliation of material:
 * - cash;
 * - bank;
 * - inventory;
 * - receivables;
 * - payables;
 * - loans;
 * - fixed assets;
 * - depreciation;
 * - other material assets/liabilities.
 * An unresolved material discrepancy must block final valuation.
 * Do not silently ignore missing or conflicting data.
 * Test with one unresolved inventory discrepancy.
 * Verify valuation finalization is blocked.
 * Return PASS or UNRESOLVED.
 */
export async function runValuationReconciliationGateTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 07: VALUATION RECONCILIATION GATE TEST');
  console.log('Testing: Material reconciliations before valuation finalization');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  const testUser = 'valuation_lead_officer';
  const valDate = '2026-06-30';

  // ---------------------------------------------------------------------------
  // STEP 1: Establish Fully Reconciled Accounting & Operational Baseline
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Setting up Fully Reconciled Material Accounts ---');
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 1. Cash (GL 1010: ৳50,000)
  const cashAccId = 'cash_drawer_p7';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    name: 'প্রধান ক্যাশ ড্রয়ার',
    accountName: 'প্রধান ক্যাশ ড্রয়ার',
    accountType: 'CASH',
    currentBalance: 50000,
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_cash',
      voucherNumber: 'V-P7-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রতিষ্ঠাতার নগদ ক্যাশ জমার দাখিলা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'হাতে নগদ', debit: 50000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 50000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 2. Bank (GL 1030: ৳200,000)
  const bankAccId = 'bank_prime_p7';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'প্রাইম ব্যাংক লিমিটেড',
    accountName: 'প্রাইম ব্যাংক লিমিটেড',
    accountType: 'BANK',
    currentBalance: 200000,
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_bank',
      voucherNumber: 'V-P7-02',
      voucherType: 'RECEIPT',
      date: '2026-01-02',
      narration: 'ব্যাংক হিসাবে মূলধন জমা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 200000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মালিকের মূলধন', debit: 0, credit: 200000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-02T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 3. Inventory (GL 1051 Feed: ৳100,000, 100 bags @ ৳1,000)
  const feedItemId = 'item_feed_p7';
  await mDb.inventoryItems.put({
    id: feedItemId,
    code: 'FEED-001',
    nameBn: 'প্রিমিয়াম ডেইরি ফিড',
    nameEn: 'Premium Dairy Feed',
    category: 'FEED',
    currentStock: 100,
    unit: 'BAG',
    avgCostPrice: 1000,
    costPrice: 1000,
    synced: false
  });
  await mDb.stockMovements.put({
    id: 'sm_feed_p7_01',
    date: '2026-01-05',
    itemId: feedItemId,
    movementType: 'IN',
    quantity: 100,
    unitPrice: 1000,
    totalCost: 100000,
    referenceType: 'PURCHASE',
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_inv',
      voucherNumber: 'V-P7-03',
      voucherType: 'PAYMENT',
      date: '2026-01-05',
      narration: 'ফিড ইনভেন্টরি ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: 100000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 100000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-05T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  // Restore bank balance for the payment:
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 100000 });

  // 4. Receivables (Customer dues: ৳30,000, GL 1040: ৳30,000)
  const custId = 'cust_superstore_p7';
  await mDb.parties.put({
    id: custId,
    name: 'ঢাকা এগ্রো মার্ট',
    type: 'CUSTOMER',
    phone: '01711223344',
    currentBalance: 30000,
    balance: 30000,
    synced: false
  });
  await mDb.sales.put({
    id: 'sale_p7_01',
    invoiceNumber: 'INV-P7-001',
    customerId: custId,
    customerName: 'ঢাকা এগ্রো মার্ট',
    date: '2026-01-15',
    items: [],
    grandTotal: 30000,
    totalAmount: 30000,
    paidAmount: 0,
    dueAmount: 30000,
    paymentMethod: 'CREDIT',
    status: 'DUE',
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_rec',
      voucherNumber: 'V-P7-04',
      voucherType: 'SALES',
      date: '2026-01-15',
      narration: 'বাকিতে দুধ ও দুগ্ধজাত পণ্য বিক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, accountName: 'প্রাপ্য হিসাব', debit: 30000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.MILK_REVENUE, accountName: 'দুধ বিক্রয় আয়', debit: 0, credit: 30000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-15T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 5. Payables (Supplier dues: ৳40,000, GL 2010: ৳40,000)
  const suppId = 'supp_agro_corp_p7';
  await mDb.parties.put({
    id: suppId,
    name: 'কৃষি মেডিসিন সরবরাহকারী',
    type: 'SUPPLIER',
    phone: '01811223344',
    currentBalance: 40000,
    balance: 40000,
    synced: false
  });
  await mDb.purchases.put({
    id: 'purch_p7_01',
    invoiceNumber: 'BILL-P7-001',
    supplierId: suppId,
    supplierName: 'কৃষি মেডিসিন সরবরাহকারী',
    date: '2026-01-20',
    items: [],
    grandTotal: 40000,
    totalAmount: 40000,
    paidAmount: 0,
    dueAmount: 40000,
    paymentMethod: 'CREDIT',
    status: 'DUE',
    synced: false
  });
  const medItemId = 'item_med_p7';
  await mDb.inventoryItems.put({
    id: medItemId,
    code: 'MED-001',
    nameBn: 'জরুরি ভ্যাকসিন ও মেডিসিন',
    nameEn: 'Emergency Vaccine & Medicine',
    category: 'RAW_MATERIALS',
    currentStock: 40,
    unit: 'VIAL',
    avgCostPrice: 1000,
    costPrice: 1000,
    synced: false
  });
  await mDb.stockMovements.put({
    id: 'sm_med_p7_01',
    date: '2026-01-20',
    itemId: medItemId,
    movementType: 'IN',
    quantity: 40,
    unitPrice: 1000,
    totalCost: 40000,
    referenceType: 'PURCHASE',
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_pay',
      voucherNumber: 'V-P7-05',
      voucherType: 'PURCHASE',
      date: '2026-01-20',
      narration: 'বাকিতে ওষুধ ও ভ্যাকসিন ক্রয়',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.RAW_MATERIALS, accountName: 'কাঁচামাল ও ওষুধ', debit: 40000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, accountName: 'প্রদেয় হিসাব', debit: 0, credit: 40000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-20T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 6. Loans (Active loan: ৳60,000, GL 2110: ৳60,000)
  const loanId = 'loan_brac_p7';
  await mDb.loans.put({
    id: loanId,
    lenderName: 'ব্র্যাক ব্যাংক কৃষি ঋণ',
    loanType: 'BANK',
    loanNumber: 'LN-BRAC-2026',
    principalAmount: 60000,
    remainingPrincipal: 60000,
    outstandingPrincipal: 60000,
    remainingBalance: 60000,
    interestRateAnnual: 0,
    startDate: '2026-01-25',
    status: 'ACTIVE',
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_loan',
      voucherNumber: 'V-P7-06',
      voucherType: 'RECEIPT',
      date: '2026-01-25',
      narration: 'ব্র্যাক ব্যাংক থেকে ঋণ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 60000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ঋণ', debit: 0, credit: 60000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-25T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 160000 });

  // 7. Fixed Assets & 8. Depreciation
  // Cost: ৳150,000 (GL 1550: ৳150,000), Acc. Dep: ৳15,000 (GL 1590: ৳15,000)
  const assetId = 'asset_tractor_p7';
  await mDb.fixedAssets.put({
    id: assetId,
    name: 'মহিন্দ্রা মিনি ট্র্যাক্টর',
    category: 'MACHINERY',
    cost: 150000,
    originalCost: 150000,
    purchasePrice: 150000,
    purchaseDate: '2026-01-30',
    accumulatedDepreciation: 15000,
    usefulLifeMonths: 60,
    status: 'ACTIVE',
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_fa',
      voucherNumber: 'V-P7-07',
      voucherType: 'JOURNAL',
      date: '2026-01-30',
      narration: 'স্থায়ী সম্পদ ট্র্যাক্টর ক্রয় ও অবচয় সঞ্চিতি',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, accountName: 'যন্ত্রপাতি', debit: 150000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 15000 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, accountName: 'ব্যাংক হিসাব', debit: 0, credit: 135000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-30T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );
  await mDb.cashBankAccounts.update(bankAccId, { currentBalance: 25000 });

  // ---------------------------------------------------------------------------
  // STEP 2: Execute Gate on Clean Baseline -> MUST RETURN PASS
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Testing Valuation Reconciliation Gate on Clean Baseline ---');
  const gateBaseline = await runValuationReconciliationGate(mDb, valDate);

  assert(gateBaseline.passed === true, 'Reconciliation gate passes when all material items match');
  assert(gateBaseline.status === 'PASS', 'Gate status is strictly PASS');
  assert(gateBaseline.unresolvedCount === 0, 'Zero unresolved discrepancies on clean baseline (0)');
  assert(gateBaseline.totalMaterialDiscrepancy === 0, 'Total material discrepancy is 0');
  assert(gateBaseline.checks.length >= 9, 'All 9 material categories evaluated (cash, bank, inventory, receivables, payables, loans, fixed assets, depreciation, other)');

  const cashCheck = gateBaseline.checks.find(c => c.item === 'cash');
  const bankCheck = gateBaseline.checks.find(c => c.item === 'bank');
  const invCheck = gateBaseline.checks.find(c => c.item === 'inventory');
  const recCheck = gateBaseline.checks.find(c => c.item === 'receivables');
  const payCheck = gateBaseline.checks.find(c => c.item === 'payables');
  const loanCheck = gateBaseline.checks.find(c => c.item === 'loans');
  const faCheck = gateBaseline.checks.find(c => c.item === 'fixed_assets');
  const depCheck = gateBaseline.checks.find(c => c.item === 'depreciation');

  assert(cashCheck?.isMatched === true, 'Cash reconciliation is verified and matched (৳50,000)');
  assert(bankCheck?.isMatched === true, 'Bank reconciliation is verified and matched (৳25,000)');
  assert(invCheck?.isMatched === true, 'Inventory reconciliation is verified and matched (৳140,000)');
  assert(recCheck?.isMatched === true, 'Receivables reconciliation is verified and matched (৳30,000)');
  assert(payCheck?.isMatched === true, 'Payables reconciliation is verified and matched (৳40,000)');
  assert(loanCheck?.isMatched === true, 'Loans reconciliation is verified and matched (৳60,000)');
  assert(faCheck?.isMatched === true, 'Fixed assets reconciliation is verified and matched (৳150,000)');
  assert(depCheck?.isMatched === true, 'Depreciation reconciliation is verified and matched (৳15,000)');

  // Test finalization on clean baseline succeeds
  const cleanFinalizedVal = await finalizeValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      notes: 'Clean baseline pre-investment valuation'
    },
    mDb
  );

  assert(Boolean(cleanFinalizedVal.id), 'Valuation event successfully created with unique ID');
  assert(cleanFinalizedVal.status === 'FINALIZED', 'Valuation event status is FINALIZED when gate passes');
  assert(cleanFinalizedVal.reconciliationGate?.status === 'PASS', 'Valuation event captures passing reconciliation gate audit');
  assert(Boolean(cleanFinalizedVal.finalizedAt), 'Valuation event records finalizedAt timestamp');
  assert(cleanFinalizedVal.finalizedBy === testUser, 'Valuation event records finalizedBy user');

  // ---------------------------------------------------------------------------
  // STEP 3: Prompt Requirement - Test with ONE Unresolved Inventory Discrepancy
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Testing with ONE Unresolved Inventory Discrepancy ---');
  // Introduce an inventory discrepancy: Physical count or subledger adjusted to ৳80,000 (80 bags),
  // while general ledger 1051 remains ৳100,000 -> ৳20,000 material difference!
  await mDb.inventoryItems.update(feedItemId, { currentStock: 80 });
  await mDb.stockMovements.put({
    id: 'sm_feed_p7_shrinkage',
    date: '2026-06-01',
    itemId: feedItemId,
    movementType: 'OUT',
    quantity: 20,
    unitPrice: 1000,
    totalCost: 20000,
    notes: 'Unrecorded feed damage / discrepancy not yet booked in GL',
    referenceType: 'DAMAGE',
    synced: false
  });

  const gateWithDiscrepancy = await runValuationReconciliationGate(mDb, valDate);

  assert(gateWithDiscrepancy.passed === false, 'Gate MUST fail when inventory discrepancy exists');
  assert(gateWithDiscrepancy.status === 'UNRESOLVED', 'Gate status is strictly UNRESOLVED');
  assert(gateWithDiscrepancy.unresolvedCount >= 1, 'At least 1 unresolved discrepancy detected');

  const invDiscrepancy = gateWithDiscrepancy.unresolvedDiscrepancies.find(d => d.item === 'inventory');
  assert(invDiscrepancy !== undefined, 'Inventory is explicitly listed among unresolved discrepancies');
  assert(Math.abs(invDiscrepancy!.difference) === 20000, 'Unresolved inventory discrepancy amount is strictly ৳20,000');
  assert(Boolean(gateWithDiscrepancy.blockingReason), 'Gate provides descriptive blocking reason');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Valuation Finalization is BLOCKED with Unresolved Discrepancy
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Valuation Finalization is BLOCKED ---');
  let finalizationBlocked = false;
  let blockingErrorMessage = '';

  try {
    await finalizeValuationEvent(
      {
        valuationDate: valDate,
        responsibleUser: testUser,
        notes: 'Attempting valuation finalization with unresolved inventory discrepancy'
      },
      mDb
    );
  } catch (err: any) {
    finalizationBlocked = true;
    blockingErrorMessage = err.message || '';
  }

  assert(finalizationBlocked === true, 'CRITICAL: Valuation finalization is strictly BLOCKED when inventory discrepancy is unresolved');
  assert(
    blockingErrorMessage.includes('Valuation finalization blocked') ||
    blockingErrorMessage.includes('মূল্যায়ন চূড়ান্তকরণ স্থগিত') ||
    blockingErrorMessage.includes('inventory'),
    'Blocking error message explicitly informs the user that valuation finalization was blocked due to material discrepancy'
  );

  // Also test createValuationEvent with finalize: true
  let directFinalizeBlocked = false;
  try {
    await createValuationEvent(
      {
        valuationDate: valDate,
        responsibleUser: testUser,
        finalize: true
      },
      mDb
    );
  } catch (err: any) {
    directFinalizeBlocked = true;
  }
  assert(directFinalizeBlocked === true, 'createValuationEvent with finalize: true is also strictly BLOCKED by reconciliation gate');

  // Test that finalizeValuation on a draft event is also blocked
  const draftVal = await createValuationEvent(
    {
      valuationDate: valDate,
      responsibleUser: testUser,
      finalize: false,
      status: 'DRAFT',
      notes: 'Draft valuation created prior to reconciliation'
    },
    mDb
  );
  assert(draftVal.status === 'DRAFT', 'Draft valuation event can be created with status DRAFT for pre-audit inspection');

  let finalizeDraftBlocked = false;
  try {
    await finalizeValuation(draftVal.id, testUser, mDb);
  } catch (err: any) {
    finalizeDraftBlocked = true;
  }
  assert(finalizeDraftBlocked === true, 'finalizeValuation(draftId) is strictly BLOCKED while inventory discrepancy remains unresolved');

  // Verify the draft valuation remained DRAFT and was NOT finalized
  const draftAfterAttempt = await getValuationEventById(draftVal.id, mDb);
  assert(draftAfterAttempt?.status === 'DRAFT', 'Valuation event remains strictly in DRAFT state; unapproved valuation was not finalized');

  // ---------------------------------------------------------------------------
  // STEP 5: Resolving the Inventory Discrepancy & Unblocking Finalization
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Resolving the Inventory Discrepancy & Verifying Unblocking ---');
  // Reconcile GL with physical reality by booking the inventory shrinkage loss:
  // Dr 5010 (Feed Loss / COGS) ৳20,000 | Cr 1051 (Feed Inventory) ৳20,000
  await postJournalEntry(
    {
      id: 'j_p7_inv_adj',
      voucherNumber: 'V-P7-ADJ',
      voucherType: 'JOURNAL',
      date: '2026-06-05',
      narration: 'ইনভেন্টরি ফিজিক্যাল কাউন্ট সমন্বয় দাখিলা (Damage write-off)',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FISH_COGS, accountName: 'মজুদ সমন্বয় ক্ষতি', debit: 20000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, accountName: 'মজুদ খাদ্য', debit: 0, credit: 20000 }
      ],
      createdBy: testUser,
      createdAt: '2026-06-05T00:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  const gateAfterResolution = await runValuationReconciliationGate(mDb, valDate);
  assert(gateAfterResolution.passed === true, 'Gate passes immediately after resolving inventory discrepancy');
  assert(gateAfterResolution.status === 'PASS', 'Gate status returns strictly PASS after resolution');
  assert(gateAfterResolution.unresolvedCount === 0, 'Zero unresolved discrepancies remain');

  // Now finalization must succeed!
  const successfullyFinalized = await finalizeValuation(draftVal.id, testUser, mDb);
  assert(successfullyFinalized.status === 'FINALIZED', 'Valuation event is now successfully FINALIZED after reconciliation');
  assert(successfullyFinalized.reconciliationGate?.status === 'PASS', 'Finalized valuation event contains confirmed passing reconciliation gate audit');

  // ---------------------------------------------------------------------------
  // STEP 6: Testing That Missing or Conflicting Data is NOT Silently Ignored
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Testing That Missing Data is NOT Silently Ignored ---');
  // Case A: Missing Loan Record when GL shows Loan balance
  const mDb2 = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb2.accounts.put(acc);
  }
  // Cash & Bank balanced
  await mDb2.cashBankAccounts.put({
    id: 'cb_test_02',
    name: 'Main Cash',
    accountType: 'CASH',
    currentBalance: 10000,
    synced: false
  });
  await postJournalEntry(
    {
      id: 'j_p7_2_cash',
      voucherNumber: 'V-2-01',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'নগদ ক্যাশ গ্রহণ',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'ক্যাশ', debit: 10000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'মূলধন', debit: 0, credit: 10000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { dbInstance: mDb2 }
  );

  // Introduce GL loan of ৳50,000 without corresponding record in loans table!
  await postJournalEntry(
    {
      id: 'j_p7_phantom_loan',
      voucherNumber: 'V-2-02',
      voucherType: 'RECEIPT',
      date: '2026-01-02',
      narration: 'ভূতুড়ে ব্যাংক ঋণ দাখিলা',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'ক্যাশ', debit: 50000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountName: 'স্বল্পমেয়াদী ঋণ', debit: 0, credit: 50000 }
      ],
      createdBy: testUser,
      createdAt: '2026-01-02T00:00:00.000Z'
    },
    { dbInstance: mDb2 }
  );
  await mDb2.cashBankAccounts.update('cb_test_02', { currentBalance: 60000 });

  const gateMissingLoan = await runValuationReconciliationGate(mDb2, valDate);
  assert(gateMissingLoan.passed === false, 'Gate fails when GL has loan balance but loans subledger has zero records (missing data not ignored)');
  assert(gateMissingLoan.status === 'UNRESOLVED', 'Gate returns UNRESOLVED on missing loan data');
  const loanDiscrepancy = gateMissingLoan.unresolvedDiscrepancies.find(d => d.item === 'loans');
  assert(loanDiscrepancy !== undefined, 'Loans discrepancy is caught (GL ৳50,000 vs Subledger ৳0)');

  let missingLoanBlocked = false;
  try {
    await finalizeValuationEvent(
      {
        valuationDate: valDate,
        responsibleUser: testUser
      },
      mDb2
    );
  } catch (err) {
    missingLoanBlocked = true;
  }
  assert(missingLoanBlocked === true, 'Valuation finalization is BLOCKED when loan data is missing or conflicting');

  console.log('\n================================================================');
  console.log(`PROMPT 07 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testValuationReconciliationGate')) {
  runValuationReconciliationGateTests().then((res) => {
    if (res.failed > 0) {
      console.error(`Prompt 07 tests FAILED with ${res.failed} failure(s).`);
      process.exit(1);
    } else {
      console.log(`Prompt 07 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
      process.exit(0);
    }
  });
}
