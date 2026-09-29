import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  CANONICAL_ACCOUNTS,
  getInventoryAssetAccount,
  getRevenueAndCogsAccounts,
  getCashBankAccountGLCode
} from '../accounting/accountMapping';
import {
  generateTrialBalance,
  generateProfitLoss,
  generateBalanceSheet,
  generateCashFlowStatement,
  getGeneralLedger
} from '../accounting/accountingEngine';
import {
  executeOwnerCapitalTransaction,
  executePurchaseTransaction,
  executeSaleTransaction,
  executePaymentTransaction
} from '../services/transactionService';
import {
  Party,
  InventoryItem,
  CashBankAccount,
  JournalEntry
} from '../types';

export interface GoldenTestAssertionResult {
  stage: string;
  check: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  error?: string;
}

export interface GoldenTestSummary {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
  assertions: GoldenTestAssertionResult[];
}

/**
 * PROMPT 03 — COMPLETE ACCOUNTING GOLDEN TEST
 * FINAL RELEASE TASK 03 — COMPLETE ACCOUNTING GOLDEN-LIFECYCLE TEST
 *
 * Fully tests the complete accounting lifecycle on an isolated test dataset:
 * Purchase -> Inventory Receipt -> Accounts Payable -> Purchase Payment ->
 * Sale -> Inventory Reduction -> COGS -> Customer Receivable -> Customer Payment ->
 * Cash/Bank Movement -> Journal -> Ledger -> Trial Balance -> P&L -> Balance Sheet -> Cash Flow.
 *
 * Verifies at every stage:
 * 1. Debit = Credit on all journal entries
 * 2. Inventory quantity is correct
 * 3. Inventory value is correct
 * 4. Cash/bank is correct
 * 5. AR/AP is correct
 * 6. Revenue is correct
 * 7. COGS is correct
 * 8. Profit is correct
 * 9. Trial Balance balances
 * 10. Balance Sheet balances
 * 11. Cash Flow agrees with cash/bank movement
 * 12. Duplicate submission / idempotency protection
 * 13. Isolated test data cleanup
 */
export async function runCompleteAccountingGoldenLifecycleTests(): Promise<GoldenTestSummary> {
  const assertions: GoldenTestAssertionResult[] = [];
  const failures: string[] = [];

  function record(stage: string, check: string, passed: boolean, expected?: any, actual?: any, error?: string) {
    assertions.push({ stage, check, passed, expected, actual, error });
    if (!passed) {
      const msg = `[${stage}] ${check} FAILED: Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${error || ''}`;
      failures.push(msg);
      console.error(`  ❌ ${msg}`);
    } else {
      console.log(`  ✅ [${stage}] ${check}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 03: COMPLETE ACCOUNTING GOLDEN-LIFECYCLE TEST');
  console.log('Testing Purchase -> Receipt -> Payable -> Payment -> Sale ->');
  console.log('Reduction -> COGS -> Receivable -> Payment -> Cash/Bank ->');
  console.log('Journal -> Ledger -> Trial Balance -> P&L -> Balance Sheet -> Cash Flow');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // 0. Setup isolated test database & chart of accounts
  // --------------------------------------------------------------------------
  const dbInstance = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put(acc);
  }

  const cashAccount: CashBankAccount = {
    id: 'cb_golden_cash',
    name: 'Farm Cash Till',
    accountType: 'CASH',
    currentBalance: 0,
    synced: false
  };
  await dbInstance.cashBankAccounts.put(cashAccount);

  const bankAccount: CashBankAccount = {
    id: 'cb_golden_bank',
    name: 'Agrani Bank Current A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  };
  await dbInstance.cashBankAccounts.put(bankAccount);

  const currentUserId = 'golden_auditor_01';

  // Define isolated entities
  const supplier: Party = {
    id: 'supp_golden_alpha',
    name: 'Golden Standard Feeds Ltd.',
    type: 'SUPPLIER',
    phone: '01811223344',
    balance: 0,
    synced: false
  };
  await dbInstance.parties.put(supplier);

  const customer: Party = {
    id: 'cust_golden_beta',
    name: 'Golden Dairy & Agro Client',
    type: 'CUSTOMER',
    phone: '01911223344',
    balance: 0,
    synced: false
  };
  await dbInstance.parties.put(customer);

  const feedItem: InventoryItem = {
    id: 'inv_golden_layer_feed',
    code: 'GLD-FEED-01',
    nameBn: 'গোল্ডেন পোল্ট্রি ফিড ৫০ কেজি',
    nameEn: 'Golden Poultry Feed 50kg',
    category: 'FEED',
    unit: 'BAG',
    currentStock: 0,
    avgCostPrice: 0,
    sellingPrice: 1500,
    reorderLevel: 10,
    synced: false
  };
  await dbInstance.inventoryItems.put(feedItem);

  const invAssetGlCode = getInventoryAssetAccount(feedItem.category); // 1051
  const { revenueCode, cogsCode } = getRevenueAndCogsAccounts(feedItem);
  const cashGlCode = getCashBankAccountGLCode('CASH'); // 1010
  const bankGlCode = getCashBankAccountGLCode('BANK'); // 1030

  // Helper to run comprehensive verification at any stage
  async function verifyStage(
    stageName: string,
    expected: {
      inventoryQty: number;
      inventoryVal: number;
      cash: number;
      bank: number;
      ar: number;
      ap: number;
      revenue: number;
      cogs: number;
      profit: number;
      itemId: string;
      customerId: string;
      supplierId: string;
    }
  ) {
    // 1. Debit = Credit on EVERY journal entry
    const entries: JournalEntry[] = await dbInstance.journalEntries.toArray();
    let allEntriesBalanced = true;
    let unbalancedDetail = '';

    for (const e of entries) {
      let d = 0;
      let c = 0;
      for (const line of e.lines) {
        d += Number(line.debit) || 0;
        c += Number(line.credit) || 0;
      }
      const diff = Math.abs(Math.round(d * 100) - Math.round(c * 100)) / 100;
      if (diff > 0.01) {
        allEntriesBalanced = false;
        unbalancedDetail = `Voucher ${e.voucherNumber || e.id} unbalanced: Dr ৳${d} != Cr ৳${c}`;
        break;
      }
    }
    record(stageName, 'All Journal Entries: Debit = Credit', allEntriesBalanced, true, allEntriesBalanced, unbalancedDetail);

    // 2. Inventory quantity is correct
    const item = await dbInstance.inventoryItems.get(expected.itemId);
    const itemStock = item ? Number(item.currentStock) : 0;
    record(stageName, 'Inventory Quantity is correct', Math.abs(itemStock - expected.inventoryQty) < 0.001, expected.inventoryQty, itemStock);

    // 3. Inventory value is correct (quantity * average cost price & GL inventory asset code)
    const itemAvgCost = item ? Number(item.avgCostPrice || 0) : 0;
    const computedInvVal = Math.round(itemStock * itemAvgCost * 100) / 100;
    record(stageName, 'Inventory Value (qty * avg cost) is correct', Math.abs(computedInvVal - expected.inventoryVal) < 0.01, expected.inventoryVal, computedInvVal);

    const glInv = await getGeneralLedger(invAssetGlCode, undefined, dbInstance);
    const glInvBalance = Math.round(Number(glInv.closingBalance ?? glInv.netBalance ?? 0) * 100) / 100;
    record(stageName, `Inventory Asset GL (${invAssetGlCode}) matches inventory valuation`, Math.abs(glInvBalance - expected.inventoryVal) < 0.01, expected.inventoryVal, glInvBalance);

    // 4. Cash / Bank is correct
    const freshCash = await dbInstance.cashBankAccounts.get('cb_golden_cash');
    const freshBank = await dbInstance.cashBankAccounts.get('cb_golden_bank');
    const cashBal = freshCash ? Number(freshCash.currentBalance || 0) : 0;
    const bankBal = freshBank ? Number(freshBank.currentBalance || 0) : 0;
    record(stageName, 'Cash account balance is correct', Math.abs(cashBal - expected.cash) < 0.01, expected.cash, cashBal);
    record(stageName, 'Bank account balance is correct', Math.abs(bankBal - expected.bank) < 0.01, expected.bank, bankBal);

    const glCash = await getGeneralLedger(cashGlCode, undefined, dbInstance);
    const glCashBal = Math.round(Number(glCash.closingBalance ?? glCash.netBalance ?? 0) * 100) / 100;
    record(stageName, `Cash GL (${cashGlCode}) matches cash account balance`, Math.abs(glCashBal - expected.cash) < 0.01, expected.cash, glCashBal);

    const glBank = await getGeneralLedger(bankGlCode, undefined, dbInstance);
    const glBankBal = Math.round(Number(glBank.closingBalance ?? glBank.netBalance ?? 0) * 100) / 100;
    record(stageName, `Bank GL (${bankGlCode}) matches bank account balance`, Math.abs(glBankBal - expected.bank) < 0.01, expected.bank, glBankBal);

    // 5. AR / AP is correct
    const cust = await dbInstance.parties.get(expected.customerId);
    const customerBal = cust ? Number(cust.balance || 0) : 0;
    record(stageName, 'Customer AR sub-ledger balance is correct', Math.abs(customerBal - expected.ar) < 0.01, expected.ar, customerBal);

    const gl1040 = await getGeneralLedger(CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, undefined, dbInstance);
    const gl1040Bal = Math.round(Number(gl1040.closingBalance ?? gl1040.netBalance ?? 0) * 100) / 100;
    record(stageName, 'Accounts Receivable GL (1040) matches customer AR', Math.abs(gl1040Bal - expected.ar) < 0.01, expected.ar, gl1040Bal);

    const supp = await dbInstance.parties.get(expected.supplierId);
    const supplierBal = supp ? Number(supp.balance || 0) : 0;
    record(stageName, 'Supplier AP sub-ledger balance is correct', Math.abs(supplierBal - expected.ap) < 0.01, expected.ap, supplierBal);

    const gl2010 = await getGeneralLedger(CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, undefined, dbInstance);
    const gl2010Bal = Math.round(Number(gl2010.closingBalance ?? gl2010.netBalance ?? 0) * 100) / 100;
    record(stageName, 'Accounts Payable GL (2010) matches supplier AP', Math.abs(gl2010Bal - expected.ap) < 0.01, expected.ap, gl2010Bal);

    // 6. Revenue is correct
    const pl = await generateProfitLoss(undefined, undefined, dbInstance);
    record(stageName, 'P&L Total Revenue is correct', Math.abs(pl.totalRevenue - expected.revenue) < 0.01, expected.revenue, pl.totalRevenue);

    // 7. COGS is correct
    record(stageName, 'P&L Total COGS is correct', Math.abs(pl.totalCogs - expected.cogs) < 0.01, expected.cogs, pl.totalCogs);

    // 8. Profit is correct
    record(stageName, 'P&L Net Profit is correct', Math.abs(pl.netProfit - expected.profit) < 0.01, expected.profit, pl.netProfit);
    const expectedGrossProfit = Math.round((expected.revenue - expected.cogs) * 100) / 100;
    record(stageName, 'P&L Gross Profit is correct', Math.abs(pl.grossProfit - expectedGrossProfit) < 0.01, expectedGrossProfit, pl.grossProfit);

    // 9. Trial Balance balances
    const tb = await generateTrialBalance(undefined, dbInstance);
    record(stageName, 'Trial Balance is balanced (Debit = Credit)', tb.isBalanced && Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, true, tb.isBalanced);
    record(stageName, 'Trial Balance has zero difference', Math.abs(tb.difference) < 0.01, 0, tb.difference);
    record(stageName, 'Trial Balance has no invalid/orphan accounts', !tb.hasInvalidAccounts, false, tb.hasInvalidAccounts);

    // 10. Balance Sheet balances (Assets = Liabilities + Equity)
    const bs = await generateBalanceSheet(undefined, dbInstance);
    const totalLiabEquity = Math.round((bs.totalLiabilities + bs.totalEquity) * 100) / 100;
    record(stageName, 'Balance Sheet balances (Assets = Liab + Equity)', bs.isBalanced && Math.abs(bs.totalAssets - totalLiabEquity) < 0.05, true, bs.isBalanced, `Assets: ${bs.totalAssets}, Liab+Eq: ${totalLiabEquity}`);

    // 11. Cash Flow agrees with cash/bank movement
    const cf = await generateCashFlowStatement(undefined, dbInstance);
    const totalCashBankExpected = Math.round((expected.cash + expected.bank) * 100) / 100;
    record(stageName, 'Cash Flow closing cash matches total Cash/Bank', Math.abs(cf.closingCash - totalCashBankExpected) < 0.01, totalCashBankExpected, cf.closingCash);
    record(stageName, 'Cash Flow reconciles with GL (isReconciled)', cf.isReconciled === true, true, cf.isReconciled, `Discrepancy: ${cf.reconciliationDiscrepancy}`);
  }

  // --------------------------------------------------------------------------
  // STAGE 0: Initial Capital & Liquidity Injection
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 0: Initial Owner Capital Contribution (Liquidity Setup) ---');
  await executeOwnerCapitalTransaction({
    amount: 150000,
    targetAccountId: 'cb_golden_cash',
    currentUserId,
    date: '2026-03-01',
    notes: 'Initial owner liquidity for feed purchases'
  }, dbInstance);

  await verifyStage('Stage 0: Initial Capital', {
    inventoryQty: 0,
    inventoryVal: 0,
    cash: 150000,
    bank: 0,
    ar: 0,
    ap: 0,
    revenue: 0,
    cogs: 0,
    profit: 0,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 1: Purchase on Credit -> Inventory Receipt -> Accounts Payable
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 1: Purchase on Credit (100 bags @ ৳1,000 = ৳100,000) ---');
  const purchaseIdempotencyKey = 'idemp_golden_purch_001';
  const purchaseInvoiceNo = 'PUR-GLD-2026-001';

  const purchaseResult = await executePurchaseTransaction({
    purchaseId: 'pur_golden_001',
    invoiceNumber: purchaseInvoiceNo,
    idempotencyKey: purchaseIdempotencyKey,
    supplier,
    items: [{ item: feedItem, quantity: 100, unitPrice: 1000 }],
    paymentMethod: 'CREDIT',
    date: '2026-03-03',
    currentUserId,
    note: 'Initial feed batch inventory receipt on credit'
  }, dbInstance);

  record('Stage 1: Purchase', 'Purchase transaction returned purchase record', !!purchaseResult.purchase, true, !!purchaseResult.purchase);
  record('Stage 1: Purchase', 'Purchase transaction created balanced journal entry', !!purchaseResult.journalEntryId, true, !!purchaseResult.journalEntryId);

  await verifyStage('Stage 1: Purchase & Inventory Receipt', {
    inventoryQty: 100,
    inventoryVal: 100000,
    cash: 150000,
    bank: 0,
    ar: 0,
    ap: 100000,
    revenue: 0,
    cogs: 0,
    profit: 0,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 2: Duplicate Purchase Submission / Idempotency Test
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 2: Duplicate Purchase Submission / Idempotency Test ---');
  let duplicatePurchaseBlocked = false;
  try {
    await executePurchaseTransaction({
      purchaseId: 'pur_golden_001', // same ID
      invoiceNumber: purchaseInvoiceNo,
      idempotencyKey: purchaseIdempotencyKey, // same key
      supplier,
      items: [{ item: feedItem, quantity: 100, unitPrice: 1000 }],
      paymentMethod: 'CREDIT',
      date: '2026-03-03',
      currentUserId
    }, dbInstance);
  } catch (err: any) {
    duplicatePurchaseBlocked = true;
    console.log(`  Expected duplicate rejection caught: ${err.message}`);
  }
  record('Stage 2: Idempotency', 'Duplicate purchase submission strictly rejected', duplicatePurchaseBlocked, true, duplicatePurchaseBlocked);

  // Re-verify that state remained untouched after duplicate attempt
  await verifyStage('Stage 2: Post-Duplicate Purchase Check', {
    inventoryQty: 100,
    inventoryVal: 100000,
    cash: 150000,
    bank: 0,
    ar: 0,
    ap: 100000,
    revenue: 0,
    cogs: 0,
    profit: 0,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 3: Purchase Payment (Cash Movement & Payable Reduction)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 3: Purchase Payment (৳60,000 paid from Cash against Purchase) ---');
  const paymentResult = await executePaymentTransaction({
    parentType: 'PURCHASE',
    parentId: purchaseResult.purchase.id,
    amount: 60000,
    paymentMethod: 'CASH',
    bankAccountId: 'cb_golden_cash',
    date: '2026-03-05',
    currentUserId,
    note: 'Partial settlement to supplier for feed receipt'
  }, dbInstance);

  record('Stage 3: Purchase Payment', 'Payment record created cleanly', !!paymentResult.payment, true, !!paymentResult.payment);
  record('Stage 3: Purchase Payment', 'Payment journal entry created', !!paymentResult.journalEntryId, true, !!paymentResult.journalEntryId);

  await verifyStage('Stage 3: Purchase Payment', {
    inventoryQty: 100,
    inventoryVal: 100000,
    cash: 90000, // 150,000 - 60,000
    bank: 0,
    ar: 0,
    ap: 40000, // 100,000 - 60,000
    revenue: 0,
    cogs: 0,
    profit: 0,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 4: Sale on Credit (Reduction, COGS, Revenue, Customer Receivable)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 4: Sale on Credit (40 bags @ ৳1,500 = ৳60,000, COGS = ৳40,000) ---');
  const saleIdempotencyKey = 'idemp_golden_sale_001';
  const saleInvoiceNo = 'SAL-GLD-2026-001';

  const saleResult = await executeSaleTransaction({
    saleId: 'sal_golden_001',
    invoiceNumber: saleInvoiceNo,
    idempotencyKey: saleIdempotencyKey,
    customer,
    items: [{ item: feedItem, quantity: 40, unitPrice: 1500 }],
    paymentMethod: 'CREDIT',
    date: '2026-03-08',
    currentUserId,
    note: 'Feed sale to customer on credit'
  }, dbInstance);

  record('Stage 4: Sale', 'Sale record created cleanly', !!saleResult.sale, true, !!saleResult.sale);
  record('Stage 4: Sale', 'Sale journal entry created', !!saleResult.journalEntryId, true, !!saleResult.journalEntryId);

  await verifyStage('Stage 4: Sale & COGS Recognition', {
    inventoryQty: 60, // 100 - 40
    inventoryVal: 60000, // 60 * 1,000
    cash: 90000,
    bank: 0,
    ar: 60000, // 40 * 1,500
    ap: 40000,
    revenue: 60000, // 60,000
    cogs: 40000, // 40 * 1,000
    profit: 20000, // 60,000 - 40,000
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 5: Duplicate Sale Submission / Idempotency Test
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 5: Duplicate Sale Submission / Idempotency Test ---');
  let duplicateSaleBlocked = false;
  try {
    await executeSaleTransaction({
      saleId: 'sal_golden_001', // same ID
      invoiceNumber: saleInvoiceNo,
      idempotencyKey: saleIdempotencyKey, // same key
      customer,
      items: [{ item: feedItem, quantity: 40, unitPrice: 1500 }],
      paymentMethod: 'CREDIT',
      date: '2026-03-08',
      currentUserId
    }, dbInstance);
  } catch (err: any) {
    duplicateSaleBlocked = true;
    console.log(`  Expected duplicate sale rejection caught: ${err.message}`);
  }
  record('Stage 5: Idempotency', 'Duplicate sale submission strictly rejected', duplicateSaleBlocked, true, duplicateSaleBlocked);

  // Re-verify that state remained untouched after duplicate sale attempt
  await verifyStage('Stage 5: Post-Duplicate Sale Check', {
    inventoryQty: 60,
    inventoryVal: 60000,
    cash: 90000,
    bank: 0,
    ar: 60000,
    ap: 40000,
    revenue: 60000,
    cogs: 40000,
    profit: 20000,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 6: Customer Payment (Cash/Bank Movement & Receivable Reduction)
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 6: Customer Payment (৳45,000 paid into Bank against Sale) ---');
  const customerPaymentResult = await executePaymentTransaction({
    parentType: 'SALE',
    parentId: saleResult.sale.id,
    amount: 45000,
    paymentMethod: 'BANK',
    bankAccountId: 'cb_golden_bank',
    date: '2026-03-12',
    currentUserId,
    note: 'Customer partial payment credited into Agrani Bank'
  }, dbInstance);

  record('Stage 6: Customer Payment', 'Customer payment record created', !!customerPaymentResult.payment, true, !!customerPaymentResult.payment);
  record('Stage 6: Customer Payment', 'Customer payment journal created', !!customerPaymentResult.journalEntryId, true, !!customerPaymentResult.journalEntryId);

  await verifyStage('Stage 6: Customer Payment', {
    inventoryQty: 60,
    inventoryVal: 60000,
    cash: 90000,
    bank: 45000, // 0 + 45,000
    ar: 15000, // 60,000 - 45,000
    ap: 40000,
    revenue: 60000,
    cogs: 40000,
    profit: 20000,
    itemId: feedItem.id,
    customerId: customer.id,
    supplierId: supplier.id
  });

  // --------------------------------------------------------------------------
  // STAGE 7: Comprehensive Ledger & Cross-Statement Deep Audit
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 7: Comprehensive Ledger & Cross-Statement Deep Audit ---');
  // GL Cash on Hand (1010)
  const glCash = await getGeneralLedger(cashGlCode, undefined, dbInstance);
  record('Stage 7: Ledger', `GL ${cashGlCode} (Cash) closing balance equals ৳90,000`, glCash.closingBalance === 90000, 90000, glCash.closingBalance);
  record('Stage 7: Ledger', `GL ${cashGlCode} has 2 entries (Capital Inflow ৳150k, Payment Outflow ৳60k)`, glCash.entries.length === 2, 2, glCash.entries.length);

  // GL Bank (1030)
  const glBank = await getGeneralLedger(bankGlCode, undefined, dbInstance);
  record('Stage 7: Ledger', `GL ${bankGlCode} (Bank) closing balance equals ৳45,000`, glBank.closingBalance === 45000, 45000, glBank.closingBalance);
  record('Stage 7: Ledger', `GL ${bankGlCode} has 1 entry (Customer Payment Inflow ৳45k)`, glBank.entries.length === 1, 1, glBank.entries.length);

  // GL Accounts Receivable (1040)
  const glAr = await getGeneralLedger(CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, undefined, dbInstance);
  record('Stage 7: Ledger', 'GL 1040 (AR) closing balance equals ৳15,000', glAr.closingBalance === 15000, 15000, glAr.closingBalance);

  // GL Feed Inventory Asset (1051)
  const glInv = await getGeneralLedger(invAssetGlCode, undefined, dbInstance);
  record('Stage 7: Ledger', `GL ${invAssetGlCode} (Inventory) closing balance equals ৳60,000`, glInv.closingBalance === 60000, 60000, glInv.closingBalance);

  // GL Accounts Payable (2010)
  const glAp = await getGeneralLedger(CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, undefined, dbInstance);
  record('Stage 7: Ledger', 'GL 2010 (AP) closing balance equals ৳40,000', glAp.closingBalance === 40000, 40000, glAp.closingBalance);

  // GL Owner Capital (3010)
  const glEquity = await getGeneralLedger(CANONICAL_ACCOUNTS.OWNER_CAPITAL, undefined, dbInstance);
  record('Stage 7: Ledger', 'GL 3010 (Owner Capital) closing balance equals ৳150,000', glEquity.closingBalance === 150000, 150000, glEquity.closingBalance);

  // GL Sales Revenue
  const glRev = await getGeneralLedger(revenueCode, undefined, dbInstance);
  record('Stage 7: Ledger', `GL ${revenueCode} (Sales Revenue) closing balance equals ৳60,000`, glRev.closingBalance === 60000, 60000, glRev.closingBalance);

  // GL COGS
  const glCogs = await getGeneralLedger(cogsCode, undefined, dbInstance);
  record('Stage 7: Ledger', `GL ${cogsCode} (COGS) closing balance equals ৳40,000`, glCogs.closingBalance === 40000, 40000, glCogs.closingBalance);

  // Trial Balance Deep Audit
  const tbFinal = await generateTrialBalance(undefined, dbInstance);
  record('Stage 7: Trial Balance', 'Trial Balance Total Debit equals Total Credit exactly', Math.abs(tbFinal.totalDebit - tbFinal.totalCredit) < 0.01, true, Math.abs(tbFinal.totalDebit - tbFinal.totalCredit) < 0.01);
  record('Stage 7: Trial Balance', 'Trial Balance has zero difference', tbFinal.difference === 0, 0, tbFinal.difference);

  // Balance Sheet Deep Audit: Assets = Liabilities + Equity
  // Assets = Cash (90k) + Bank (45k) + AR (15k) + Inventory (60k) = 210,000
  // Liabilities = AP (40k)
  // Equity = Capital (150k) + Net Profit (20k) = 170,000
  // Total Liabilities + Equity = 40,000 + 170,000 = 210,000
  const bsFinal = await generateBalanceSheet(undefined, dbInstance);
  record('Stage 7: Balance Sheet', 'Balance Sheet Total Assets equals ৳210,000', bsFinal.totalAssets === 210000, 210000, bsFinal.totalAssets);
  record('Stage 7: Balance Sheet', 'Balance Sheet Total Liabilities equals ৳40,000', bsFinal.totalLiabilities === 40000, 40000, bsFinal.totalLiabilities);
  record('Stage 7: Balance Sheet', 'Balance Sheet Total Equity equals ৳170,000 (Capital 150k + Net Profit 20k)', bsFinal.totalEquity === 170000, 170000, bsFinal.totalEquity);
  record('Stage 7: Balance Sheet', 'Assets strictly equals Liabilities + Equity (Balanced)', bsFinal.isBalanced === true, true, bsFinal.isBalanced);

  // Cash Flow Deep Audit:
  // Operating Inflows: Customer Receipts = ৳45,000
  // Operating Outflows: Supplier Payments = ৳60,000
  // Net Operating Cash Flow: -৳15,000
  // Financing Inflows: Owner Capital = ৳150,000
  // Net Cash Flow: +৳135,000
  // Opening: ৳0, Closing: ৳135,000
  // Total Cash + Bank = 90k + 45k = 135k
  const cfFinal = await generateCashFlowStatement(undefined, dbInstance);
  record('Stage 7: Cash Flow', 'Cash Flow customer receipts equals ৳45,000', cfFinal.operating.customerReceipts === 45000, 45000, cfFinal.operating.customerReceipts);
  record('Stage 7: Cash Flow', 'Cash Flow supplier payments equals ৳60,000', cfFinal.operating.supplierPayments === 60000, 60000, cfFinal.operating.supplierPayments);
  record('Stage 7: Cash Flow', 'Net Operating Cash Flow equals -৳15,000', cfFinal.operating.netOperatingFlow === -15000, -15000, cfFinal.operating.netOperatingFlow);
  record('Stage 7: Cash Flow', 'Net Financing Cash Flow equals +৳150,000', cfFinal.financing.netFinancingFlow === 150000, 150000, cfFinal.financing.netFinancingFlow);
  record('Stage 7: Cash Flow', 'Net Cash Flow equals +৳135,000', cfFinal.netCashFlow === 135000, 135000, cfFinal.netCashFlow);
  record('Stage 7: Cash Flow', 'Closing Cash agrees with total GL Cash & Bank (৳135,000)', cfFinal.closingCash === 135000, 135000, cfFinal.closingCash);
  record('Stage 7: Cash Flow', 'Cash Flow statement is strictly reconciled (isReconciled)', cfFinal.isReconciled === true, true, cfFinal.isReconciled);

  // --------------------------------------------------------------------------
  // STAGE 8: Clean up ONLY the isolated test data
  // --------------------------------------------------------------------------
  console.log('\n--- STAGE 8: Clean up isolated test data ---');
  await dbInstance.journalEntries.clear();
  await dbInstance.sales.clear();
  await dbInstance.purchases.clear();
  await dbInstance.payments.clear();
  await dbInstance.stockMovements.clear();
  await dbInstance.parties.clear();
  await dbInstance.inventoryItems.clear();
  await dbInstance.cashBankAccounts.clear();
  await dbInstance.accounts.clear();

  const remainingEntries = await dbInstance.journalEntries.count();
  const remainingSales = await dbInstance.sales.count();
  const remainingPurchases = await dbInstance.purchases.count();
  const remainingPayments = await dbInstance.payments.count();
  const remainingStock = await dbInstance.stockMovements.count();
  const remainingParties = await dbInstance.parties.count();

  const isClean =
    remainingEntries === 0 &&
    remainingSales === 0 &&
    remainingPurchases === 0 &&
    remainingPayments === 0 &&
    remainingStock === 0 &&
    remainingParties === 0;

  record('Stage 8: Cleanup', 'Isolated test dataset cleanly purged with 0 remaining artifacts', isClean, true, isClean);

  // Final summary
  const total = assertions.length;
  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  const success = failed === 0;

  console.log('\n================================================================');
  console.log('GOLDEN ACCOUNTING LIFECYCLE AUDIT SUMMARY');
  console.log('================================================================');
  console.log(`Total Checks:  ${total}`);
  console.log(`Passed:        ${passed}`);
  console.log(`Failed:        ${failed}`);

  if (!success) {
    console.error('\nFAILURES IN GOLDEN LIFECYCLE:');
    failures.forEach((f) => console.error(`- ${f}`));
  } else {
    console.log('\n🎉 ALL GOLDEN ACCOUNTING LIFECYCLE VERIFICATIONS PASSED CLEANLY!');
    console.log('STATUS: PASS');
  }

  return {
    success,
    total,
    passed,
    failed,
    failures,
    assertions
  };
}

// Allow direct CLI execution via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  runCompleteAccountingGoldenLifecycleTests()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error during golden lifecycle test execution:', err);
      process.exit(1);
    });
}
