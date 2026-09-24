import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeSaleTransaction,
  executePurchaseTransaction
} from '../services/transactionService';
import {
  Party,
  InventoryItem,
  CashBankAccount,
  JournalEntry
} from '../types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failures.push(message);
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`✅ PASS: ${message}`);
  }
}

export async function runVatAccountingTests() {
  console.log('========================================================');
  console.log('STARTING ITEM-LEVEL VAT ACCOUNTING & VERIFICATION TESTS');
  console.log('========================================================');

  // Reset database tables
  await db.journalEntries.clear();
  await db.accounts.clear();
  await db.parties.clear();
  await db.inventoryItems.clear();
  await db.sales.clear();
  await db.purchases.clear();
  await db.stockMovements.clear();
  await db.cashBankAccounts.clear();
  await db.auditLogs.clear();

  // Populate Default Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.put(acc as any);
  }

  // Setup Cash & Bank Accounts
  const cashDrawer: CashBankAccount = {
    id: 'cba_cash_vat_test',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountNumber: 'CASH-01',
    accountType: 'CASH',
    currentBalance: 100000,
    isActive: true,
    openingBalance: 100000
  };
  const bankAccount: CashBankAccount = {
    id: 'cba_bank_vat_test',
    name: 'City Bank Ltd',
    accountName: 'City Bank Ltd',
    accountNumber: 'BANK-01',
    accountType: 'BANK',
    currentBalance: 200000,
    isActive: true,
    openingBalance: 200000
  };
  await db.cashBankAccounts.put(cashDrawer);
  await db.cashBankAccounts.put(bankAccount);

  // Setup Parties
  const customer: Party = {
    id: 'party_cust_vat_1',
    name: 'Green Agro Supermarket',
    type: 'CUSTOMER',
    phone: '01711000001',
    balance: 0,
    isActive: true
  };
  const supplier: Party = {
    id: 'party_supp_vat_1',
    name: 'National Feed Mill Ltd',
    type: 'SUPPLIER',
    phone: '01811000002',
    balance: 0,
    isActive: true
  };
  await db.parties.put(customer);
  await db.parties.put(supplier);

  // Setup Inventory Items
  const itemFeed: InventoryItem = {
    id: 'item_feed_vat_1',
    code: 'FEED-001',
    nameEn: 'Broiler Feed',
    nameBn: 'ব্রয়লার ফিড (Broiler Feed)',
    category: 'FEED',
    currentStock: 100,
    avgCostPrice: 50,
    sellingPrice: 70,
    unit: 'কেজি',
    lowStockThreshold: 10,
    reorderLevel: 20
  };
  const itemMeat: InventoryItem = {
    id: 'item_meat_vat_1',
    code: 'MEAT-001',
    nameEn: 'Processed Meat',
    nameBn: 'প্রক্রিয়াজাত ব্রয়লার মাংস (Processed Meat)',
    category: 'PROCESSED',
    currentStock: 100,
    avgCostPrice: 150,
    sellingPrice: 220,
    unit: 'কেজি',
    lowStockThreshold: 5,
    reorderLevel: 10
  };
  const itemEggs: InventoryItem = {
    id: 'item_egg_vat_1',
    code: 'EGG-001',
    nameEn: 'Fresh Eggs',
    nameBn: 'তাজা ডিম (Fresh Eggs)',
    category: 'FARM_PRODUCT',
    currentStock: 500,
    avgCostPrice: 8,
    sellingPrice: 12,
    unit: 'পিস',
    lowStockThreshold: 50,
    reorderLevel: 100
  };
  await db.inventoryItems.put(itemFeed);
  await db.inventoryItems.put(itemMeat);
  await db.inventoryItems.put(itemEggs);

  // Helper for localStorage in node
  const setVatSetting = (enabled: boolean) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('goted_vat_registered', enabled ? 'true' : 'false');
    }
    (globalThis as any).goted_vat_registered = enabled ? 'true' : 'false';
  };

  // =========================================================================
  // TEST 1: SALE WITH MIXED VAT RATES ACROSS LINES (VAT MODE ON)
  // =========================================================================
  console.log('\n--- TEST 1: Sale with Mixed VAT Rates across Lines (VAT Mode ON) ---');
  setVatSetting(true);

  // Line 1: Fresh Eggs (Exempt / 0% VAT): 50 pcs @ ৳12 = ৳600, VAT = ৳0
  // Line 2: Broiler Feed (5% VAT): 20 kg @ ৳70 = ৳1,400, VAT = ৳70
  // Line 3: Processed Meat (15% VAT): 10 kg @ ৳220 = ৳2,200, VAT = ৳330
  // Total Subtotal = ৳4,200, Total VAT = ৳400, Grand Total = ৳4,600
  const saleRes = await executeSaleTransaction({
    customer,
    items: [
      { item: itemEggs, quantity: 50, unitPrice: 12, vatRatePercent: 0 },
      { item: itemFeed, quantity: 20, unitPrice: 70, vatRatePercent: 5 },
      { item: itemMeat, quantity: 10, unitPrice: 220, vatRatePercent: 15 }
    ],
    paymentMethod: 'CREDIT',
    isVatRegistered: true,
    currentUserId: 'usr_vat_test',
    date: '2026-04-10'
  });

  const saleRec = saleRes.sale;
  assert(!!saleRec, 'Sale record created successfully');
  assert(Number(saleRec.subtotal) === 4200, `Sale subtotal is ৳4,200 (actual: ৳${saleRec.subtotal})`);
  assert(Number(saleRec.taxVat) === 400, `Sale taxVat is ৳400 (actual: ৳${saleRec.taxVat})`);
  assert(Number(saleRec.grandTotal) === 4600, `Sale grandTotal is ৳4,600 (actual: ৳${saleRec.grandTotal})`);
  assert(saleRec.items.length === 3, 'Sale has 3 line items');
  assert(saleRec.items[0].vatRatePercent === 0 && Number(saleRec.items[0].vatAmount) === 0, 'Line 1 has 0% VAT rate and ৳0 VAT');
  assert(saleRec.items[1].vatRatePercent === 5 && Number(saleRec.items[1].vatAmount) === 70, 'Line 2 has 5% VAT rate and ৳70 VAT');
  assert(saleRec.items[2].vatRatePercent === 15 && Number(saleRec.items[2].vatAmount) === 330, 'Line 3 has 15% VAT rate and ৳330 VAT');

  // Verify journal entry
  const saleJe = await db.journalEntries.get(saleRes.journalEntryId);
  assert(!!saleJe, 'Sale journal entry created in database');
  if (saleJe) {
    const totalDebit = saleJe.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = saleJe.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert(
      Math.abs(totalDebit - totalCredit) < 0.001,
      `Sale journal balanced: Debits ৳${totalDebit} == Credits ৳${totalCredit}`
    );

    // Verify Output VAT lines: Credit CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE ('2030')
    const vatLines = saleJe.lines.filter(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE && Number(l.credit) > 0
    );
    assert(vatLines.length === 2, `Created 2 separate Output VAT credit lines for non-zero lines (actual: ${vatLines.length})`);
    const totalVatCredited = vatLines.reduce((s, l) => s + Number(l.credit), 0);
    assert(totalVatCredited === 400, `Total Output VAT credited is ৳400 (actual: ৳${totalVatCredited})`);

    // Verify Accounts Receivable debited for the full gross amount (including VAT)
    const arLine = saleJe.lines.find(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE && Number(l.debit) > 0
    );
    assert(!!arLine, 'Accounts Receivable debited');
    assert(Number(arLine?.debit) === 4600, `AR debited for ৳4,600 (net revenue + VAT)`);

    // Verify Sales Revenue credited separately from VAT
    const revLines = saleJe.lines.filter(
      (l) => l.accountCode.startsWith('4') && Number(l.credit) > 0
    );
    const totalRevCredited = revLines.reduce((s, l) => s + Number(l.credit), 0);
    assert(totalRevCredited === 4200, `Sales Revenue credited for ৳4,200 (not lumped with VAT)`);
  }

  // =========================================================================
  // TEST 2: PURCHASE WITH VAT ACROSS LINES (VAT MODE ON)
  // =========================================================================
  console.log('\n--- TEST 2: Purchase with VAT across Lines (VAT Mode ON) ---');
  // Line 1: Feed 50 kg @ ৳50 = ৳2,500, VAT 5% = ৳125
  // Line 2: Packaging/Supplies 100 pcs @ ৳10 = ৳1,000, VAT 15% = ৳150
  // Items Total = ৳3,500, Total VAT = ৳275, Transport = ৳100, Grand Total = ৳3,875
  const purchRes = await executePurchaseTransaction({
    supplier,
    items: [
      { item: itemFeed, quantity: 50, unitPrice: 50, vatRatePercent: 5 },
      { item: itemEggs, quantity: 100, unitPrice: 10, vatRatePercent: 15 }
    ],
    transportCost: 100,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    isVatRegistered: true,
    currentUserId: 'usr_vat_test',
    date: '2026-04-11'
  });

  const purchRec = purchRes.purchase;
  assert(!!purchRec, 'Purchase record created successfully');
  assert(Number(purchRec.taxVat) === 275, `Purchase taxVat is ৳275 (actual: ৳${purchRec.taxVat})`);
  assert(Number(purchRec.grandTotal) === 3875, `Purchase grandTotal is ৳3,875 (actual: ৳${purchRec.grandTotal})`);
  assert(purchRec.items.length === 2, 'Purchase has 2 items');
  assert(purchRec.items[0].vatRatePercent === 5 && Number(purchRec.items[0].vatAmount) === 125, 'Item 1 VAT is 5% (৳125)');
  assert(purchRec.items[1].vatRatePercent === 15 && Number(purchRec.items[1].vatAmount) === 150, 'Item 2 VAT is 15% (৳150)');

  // Verify journal entry
  const purchJe = await db.journalEntries.get(purchRes.journalEntryId);
  assert(!!purchJe, 'Purchase journal entry created in database');
  if (purchJe) {
    const totalDebit = purchJe.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = purchJe.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert(
      Math.abs(totalDebit - totalCredit) < 0.001,
      `Purchase journal balanced: Debits ৳${totalDebit} == Credits ৳${totalCredit}`
    );

    // Verify Input VAT lines: Debit CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE ('2030')
    const vatLines = purchJe.lines.filter(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE && Number(l.debit) > 0
    );
    assert(vatLines.length === 2, `Created 2 separate Input VAT debit lines (actual: ${vatLines.length})`);
    const totalVatDebited = vatLines.reduce((s, l) => s + Number(l.debit), 0);
    assert(totalVatDebited === 275, `Total Input VAT debited is ৳275 (actual: ৳${totalVatDebited})`);

    // Verify Inventory Asset lines: debit amount does NOT include VAT (only cost + apportioned transport)
    const invLines = purchJe.lines.filter(
      (l) => (l.accountCode.startsWith('105') || l.accountCode.startsWith('102')) && Number(l.debit) > 0
    );
    const totalInvDebited = invLines.reduce((s, l) => s + Number(l.debit), 0);
    assert(totalInvDebited === 3600, `Inventory debited for cost + transport = ৳3,600 (VAT NOT capitalized into inventory)`);

    // Bank account credited for full grand total
    const bankLine = purchJe.lines.find(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.BANK && Number(l.credit) > 0
    );
    assert(!!bankLine, 'Bank account credited');
    assert(Number(bankLine?.credit) === 3875, `Bank credited for full payment ৳3,875`);
  }

  // =========================================================================
  // TEST 3: VAT MODE OFF (ZERO EFFECT - IDENTICAL TO EXISTING SYSTEM)
  // =========================================================================
  console.log('\n--- TEST 3: VAT Mode OFF (Zero Effect) ---');
  setVatSetting(false);

  // Test Sale with VAT Mode OFF
  const saleVatOff = await executeSaleTransaction({
    customer,
    items: [
      { item: itemEggs, quantity: 10, unitPrice: 12, vatRatePercent: 15 } // Passed 15% but VAT mode is OFF
    ],
    paymentMethod: 'CASH',
    isVatRegistered: false,
    currentUserId: 'usr_vat_test',
    date: '2026-04-12'
  });

  assert(Number(saleVatOff.sale.subtotal) === 120, 'Sale subtotal is ৳120');
  assert(Number(saleVatOff.sale.taxVat || 0) === 0, 'Sale taxVat is 0 when VAT mode is OFF');
  assert(Number(saleVatOff.sale.grandTotal) === 120, 'Sale grandTotal is ৳120 (no VAT added)');
  assert(!saleVatOff.sale.items[0].vatRatePercent, 'Item vatRatePercent is 0 or undefined when VAT mode is OFF');
  assert(!saleVatOff.sale.items[0].vatAmount, 'Item vatAmount is 0 or undefined when VAT mode is OFF');

  const saleOffJe = await db.journalEntries.get(saleVatOff.journalEntryId);
  if (saleOffJe) {
    const hasVatLine = saleOffJe.lines.some((l) => l.accountCode === CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE);
    assert(!hasVatLine, 'No VAT journal lines posted when VAT mode is OFF');
    const totalDebit = saleOffJe.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = saleOffJe.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert(
      Math.abs(totalDebit - totalCredit) < 0.001,
      `Sale journal balanced when VAT mode off: Debits ৳${totalDebit} == Credits ৳${totalCredit}`
    );
  }

  // Test Purchase with VAT Mode OFF
  const purchVatOff = await executePurchaseTransaction({
    supplier,
    items: [
      { item: itemFeed, quantity: 10, unitPrice: 50, vatRatePercent: 10 } // Passed 10% but VAT mode is OFF
    ],
    transportCost: 0,
    paymentMethod: 'CASH',
    isVatRegistered: false,
    currentUserId: 'usr_vat_test',
    date: '2026-04-12'
  });

  assert(Number(purchVatOff.purchase.grandTotal) === 500, 'Purchase grandTotal is ৳500 (no VAT added)');
  assert(Number(purchVatOff.purchase.taxVat || 0) === 0, 'Purchase taxVat is 0 when VAT mode is OFF');
  assert(!purchVatOff.purchase.items[0].vatRatePercent, 'Item vatRatePercent is 0 or undefined when VAT mode is OFF');
  assert(!purchVatOff.purchase.items[0].vatAmount, 'Item vatAmount is 0 or undefined when VAT mode is OFF');

  const purchOffJe = await db.journalEntries.get(purchVatOff.journalEntryId);
  if (purchOffJe) {
    const hasVatLine = purchOffJe.lines.some((l) => l.accountCode === CANONICAL_ACCOUNTS.TAX_VAT_PAYABLE);
    assert(!hasVatLine, 'No VAT journal lines posted for purchase when VAT mode is OFF');
    const totalDebit = purchOffJe.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = purchOffJe.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert(
      Math.abs(totalDebit - totalCredit) < 0.001,
      `Purchase journal balanced when VAT mode off: Debits ৳${totalDebit} == Credits ৳${totalCredit}`
    );
  }

  // =========================================================================
  // TEST 4: DEBIT = CREDIT BALANCE VERIFICATION ON COMPLEX MULTI-LINE VOUCHERS
  // =========================================================================
  console.log('\n--- TEST 4: Debit = Credit Verification on Complex Multi-Line Vouchers ---');
  setVatSetting(true);

  // Multi-line sale with fractional amounts and discounts
  const complexSale = await executeSaleTransaction({
    customer,
    items: [
      { item: itemMeat, quantity: 7.5, unitPrice: 215.5, vatRatePercent: 7.5 },
      { item: itemEggs, quantity: 135, unitPrice: 11.25, vatRatePercent: 5 },
      { item: itemFeed, quantity: 33.3, unitPrice: 65, vatRatePercent: 0 }
    ],
    discount: 50,
    paymentMethod: 'CREDIT',
    isVatRegistered: true,
    currentUserId: 'usr_vat_test',
    date: '2026-04-13'
  });

  const complexJe = await db.journalEntries.get(complexSale.journalEntryId);
  assert(!!complexJe, 'Complex multi-line sale journal entry created');
  if (complexJe) {
    const totalDebit = Math.round(complexJe.lines.reduce((s, l) => s + Number(l.debit || 0), 0) * 100) / 100;
    const totalCredit = Math.round(complexJe.lines.reduce((s, l) => s + Number(l.credit || 0), 0) * 100) / 100;
    assert(
      Math.abs(totalDebit - totalCredit) < 0.01,
      `Complex sale journal balanced down to the penny: Debits ৳${totalDebit} == Credits ৳${totalCredit}`
    );
  }

  console.log('========================================================');
  console.log(`VAT ACCOUNTING TESTS COMPLETED: Total: ${totalTests}, Passed: ${passedTests}, Failed: ${failedTests}`);
  console.log('========================================================');

  return { total: totalTests, passed: passedTests, failed: failedTests, failures };
}
