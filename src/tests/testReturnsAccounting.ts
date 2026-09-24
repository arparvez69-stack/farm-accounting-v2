import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeSaleTransaction,
  executePurchaseTransaction,
  executeSalesReturnTransaction,
  executePurchaseReturnTransaction
} from '../services/transactionService';
import {
  Party,
  InventoryItem,
  CashBankAccount,
  SalesReturn,
  PurchaseReturn
} from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runReturnsAccountingTest() {
  console.log('========================================================');
  console.log('STARTING SALES RETURN & PURCHASE RETURN ACCOUNTING TESTS');
  console.log('========================================================\n');

  // 1. Reset Database & Seed
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);
  await db.journalEntries.clear();
  await db.sales.clear();
  await db.purchases.clear();
  await db.salesReturns.clear();
  await db.purchaseReturns.clear();
  await db.inventoryItems.clear();
  await db.stockMovements.clear();
  await db.parties.clear();
  await db.cashBankAccounts.clear();
  await db.auditLogs.clear();
  await db.closedPeriods.clear();

  // Seed Cash and Bank Accounts
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-main',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountType: 'CASH',
    accountNumber: 'CASH-01',
    currentBalance: 500000,
    isActive: true
  };
  const bankAccount: CashBankAccount = {
    id: 'cba-bank-main',
    name: 'Agrani Bank Current A/C',
    accountName: 'Agrani Bank Current A/C',
    accountType: 'BANK',
    accountNumber: 'BANK-01',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.bulkAdd([cashAccount, bankAccount]);

  // Seed Customer and Supplier
  const customer: Party = {
    id: 'party-cust-1',
    name: 'Kashem Traders',
    type: 'CUSTOMER',
    balance: 0,
    phone: '01711000001'
  };
  const supplier: Party = {
    id: 'party-supp-1',
    name: 'Bengal Feed & Seeds',
    type: 'SUPPLIER',
    balance: 0,
    phone: '01711000002'
  };
  await db.parties.bulkAdd([customer, supplier]);

  // Seed Inventory Items
  const fishItem: InventoryItem = {
    id: 'inv-fish-rui',
    code: 'FISH-001',
    nameBn: 'রুই মাছ',
    nameEn: 'Rui Fish',
    category: 'FINISHED_GOODS',
    unit: 'কেজি',
    currentStock: 200,
    avgCostPrice: 200,
    sellingPrice: 300,
    reorderLevel: 20
  };
  const feedItem: InventoryItem = {
    id: 'inv-feed-grower',
    code: 'FEED-001',
    nameBn: 'গ্রোয়ার ফিড',
    nameEn: 'Grower Feed',
    category: 'FEED',
    unit: 'বস্তা',
    currentStock: 100,
    avgCostPrice: 1500,
    sellingPrice: 1700,
    reorderLevel: 10
  };
  const cropItem: InventoryItem = {
    id: 'inv-crop-rice',
    code: 'CROP-001',
    nameBn: 'ব্রি-২৮ ধান',
    nameEn: 'BR-28 Rice',
    category: 'FINISHED_GOODS',
    unit: 'কেজি',
    currentStock: 500,
    avgCostPrice: 30,
    sellingPrice: 40,
    reorderLevel: 50
  };
  await db.inventoryItems.bulkAdd([fishItem, feedItem, cropItem]);

  // -------------------------------------------------------------
  // TEST 1: Full Sales Return with ADJUST_DUE (Credit Note)
  // -------------------------------------------------------------
  console.log('--- TEST 1: Full Sales Return with ADJUST_DUE ---');
  // Sell 50 kg Rui fish @ 300 = 15,000 on credit (paidAmount = 0)
  // COGS = 50 * 200 = 10,000
  const sale1Res = await executeSaleTransaction({
    invoiceNumber: 'INV-SRET-01',
    customer,
    item: fishItem,
    quantity: 50,
    unitPrice: 300,
    paymentMethod: 'CREDIT',
    currentUserId: 'user-tester'
  });

  const origSale1 = await db.sales.get(sale1Res.sale.id);
  assert(Boolean(origSale1), 'Original sale 1 must exist');
  const custAfterSale1 = await db.parties.get(customer.id);
  assert(custAfterSale1?.balance === 15000, `Customer balance should be 15000, got ${custAfterSale1?.balance}`);
  const fishAfterSale1 = await db.inventoryItems.get(fishItem.id);
  assert(fishAfterSale1?.currentStock === 150, `Fish stock should be 150, got ${fishAfterSale1?.currentStock}`);

  // Perform Full Sales Return
  const sret1Res = await executeSalesReturnTransaction({
    saleId: sale1Res.sale.id,
    items: [
      {
        itemId: fishItem.id,
        returnedQuantity: 50,
        reason: 'Customer cancelled credit order'
      }
    ],
    refundMethod: 'ADJUST_DUE',
    currentUserId: 'user-tester'
  });

  assert(Boolean(sret1Res.salesReturn), 'Sales return record must be returned');
  assert(sret1Res.salesReturn.totalRefundAmount === 15000, `Refund should be 15000, got ${sret1Res.salesReturn.totalRefundAmount}`);
  assert(sret1Res.salesReturn.totalCogsReversed === 10000, `COGS reversed should be 10000, got ${sret1Res.salesReturn.totalCogsReversed}`);

  // Verify debit = credit on journal entry
  const jEntry1 = sret1Res.journalEntry;
  const totalDebit1 = jEntry1.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit1 = jEntry1.lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  assert(totalDebit1 === totalCredit1, `Journal entry must balance: debit ${totalDebit1} vs credit ${totalCredit1}`);
  assert(totalDebit1 === 25000, `Total debit should be 15000 (Rev) + 10000 (Inv) = 25000, got ${totalDebit1}`);

  // Verify specific accounts reversed
  const revLine = jEntry1.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FISH_REVENUE);
  assert(Boolean(revLine && revLine.debit === 15000), 'Sales Revenue (Fish) must be debited by 15000');
  const arLine = jEntry1.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE);
  assert(Boolean(arLine && arLine.credit === 15000), 'AR must be credited by 15000');
  const invLine = jEntry1.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FINISHED_GOODS);
  assert(Boolean(invLine && invLine.debit === 10000), 'Fish Inventory must be debited by 10000');
  const cogsLine = jEntry1.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FISH_COGS);
  assert(Boolean(cogsLine && cogsLine.credit === 10000), 'COGS (Fish) must be credited by 10000');

  // Verify stock restored
  const fishAfterRet1 = await db.inventoryItems.get(fishItem.id);
  assert(fishAfterRet1?.currentStock === 200, `Fish stock must be restored to 200, got ${fishAfterRet1?.currentStock}`);

  // Verify customer AR balance
  const custAfterRet1 = await db.parties.get(customer.id);
  assert(custAfterRet1?.balance === 0, `Customer balance must be 0, got ${custAfterRet1?.balance}`);

  // Verify original sale unchanged
  const origSale1Check = await db.sales.get(sale1Res.sale.id);
  assert(origSale1Check?.grandTotal === 15000, 'Original sale record must remain unchanged');
  console.log('✅ TEST 1 PASSED: Full Sales Return with ADJUST_DUE perfectly balanced and restored.\n');

  // -------------------------------------------------------------
  // TEST 2: Partial Sales Return with CASH Refund
  // -------------------------------------------------------------
  console.log('--- TEST 2: Partial Sales Return with CASH Refund ---');
  // Sell 100 kg Rice @ 40 = 4,000 paid in CASH. COGS = 100 * 30 = 3,000.
  const cashBeforeSale2 = (await db.cashBankAccounts.get(cashAccount.id))!.currentBalance;
  const sale2Res = await executeSaleTransaction({
    invoiceNumber: 'INV-SRET-02',
    customer,
    item: cropItem,
    quantity: 100,
    unitPrice: 40,
    paymentMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-tester'
  });

  const cashAfterSale2 = (await db.cashBankAccounts.get(cashAccount.id))!.currentBalance;
  assert(cashAfterSale2 === cashBeforeSale2 + 4000, 'Cash should increase by 4000');
  const cropAfterSale2 = await db.inventoryItems.get(cropItem.id);
  assert(cropAfterSale2?.currentStock === 400, `Crop stock should be 400, got ${cropAfterSale2?.currentStock}`);

  // Return 30 kg Rice with CASH refund
  const sret2Res = await executeSalesReturnTransaction({
    saleId: sale2Res.sale.id,
    items: [
      {
        itemId: cropItem.id,
        returnedQuantity: 30,
        reason: 'Damaged packaging'
      }
    ],
    refundMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-tester'
  });

  assert(sret2Res.salesReturn.totalRefundAmount === 1200, `Refund should be 30 * 40 = 1200, got ${sret2Res.salesReturn.totalRefundAmount}`);
  assert(sret2Res.salesReturn.totalCogsReversed === 900, `COGS reversed should be 30 * 30 = 900, got ${sret2Res.salesReturn.totalCogsReversed}`);

  // Verify journal balance
  const totalDebit2 = sret2Res.journalEntry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit2 = sret2Res.journalEntry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebit2 === totalCredit2, `Journal entry must balance: debit ${totalDebit2} vs credit ${totalCredit2}`);

  // Verify cash balance decreased
  const cashAfterRet2 = (await db.cashBankAccounts.get(cashAccount.id))!.currentBalance;
  assert(cashAfterRet2 === cashAfterSale2 - 1200, `Cash should decrease by 1200, got ${cashAfterRet2}`);

  // Verify stock increased by 30
  const cropAfterRet2 = await db.inventoryItems.get(cropItem.id);
  assert(cropAfterRet2?.currentStock === 430, `Crop stock should be 430, got ${cropAfterRet2?.currentStock}`);

  // Second partial return of 20 kg
  const sret2Part2Res = await executeSalesReturnTransaction({
    saleId: sale2Res.sale.id,
    items: [
      {
        itemId: cropItem.id,
        returnedQuantity: 20,
        reason: 'Customer overordered'
      }
    ],
    refundMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-tester'
  });
  assert(sret2Part2Res.salesReturn.totalRefundAmount === 800, `Refund should be 20 * 40 = 800, got ${sret2Part2Res.salesReturn.totalRefundAmount}`);
  const cropAfterRet2Part2 = await db.inventoryItems.get(cropItem.id);
  assert(cropAfterRet2Part2?.currentStock === 450, `Crop stock should be 450, got ${cropAfterRet2Part2?.currentStock}`);
  console.log('✅ TEST 2 PASSED: Multiple partial sales returns succeeded with correct weighted-average cost.\n');

  // -------------------------------------------------------------
  // TEST 3: Sales Over-Return Rejection
  // -------------------------------------------------------------
  console.log('--- TEST 3: Sales Over-Return Rejection ---');
  // Sale 2 had 100 units sold. 30 + 20 = 50 already returned. Remaining returnable: 50.
  // Attempt to return 51 units:
  let overReturnThrew = false;
  try {
    await executeSalesReturnTransaction({
      saleId: sale2Res.sale.id,
      items: [
        {
          itemId: cropItem.id,
          returnedQuantity: 51
        }
      ],
      refundMethod: 'CASH',
      cashBankAccountId: cashAccount.id,
      currentUserId: 'user-tester'
    });
  } catch (err: any) {
    overReturnThrew = true;
    assert(
      err.message.includes('বেশি হতে পারে না') || err.message.includes('Cannot return more'),
      `Expected over-return message, got: ${err.message}`
    );
  }
  assert(overReturnThrew, 'Over-return must be strictly rejected');

  // Verify stock unchanged
  const cropAfterOverReturn = await db.inventoryItems.get(cropItem.id);
  assert(cropAfterOverReturn?.currentStock === 450, 'Stock must remain unchanged after rejection');
  console.log('✅ TEST 3 PASSED: Over-return was rejected without altering DB state.\n');

  // -------------------------------------------------------------
  // TEST 4: Duplicate Sales Return Submission (Idempotency)
  // -------------------------------------------------------------
  console.log('--- TEST 4: Duplicate Sales Return Submission (Idempotency) ---');
  const idempKeySales = 'idemp-sret-test-123';
  await executeSalesReturnTransaction({
    idempotencyKey: idempKeySales,
    saleId: sale2Res.sale.id,
    items: [
      {
        itemId: cropItem.id,
        returnedQuantity: 10
      }
    ],
    refundMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-tester'
  });

  // Try again with identical idempotencyKey
  let duplicateThrew = false;
  try {
    await executeSalesReturnTransaction({
      idempotencyKey: idempKeySales,
      saleId: sale2Res.sale.id,
      items: [
        {
          itemId: cropItem.id,
          returnedQuantity: 10
        }
      ],
      refundMethod: 'CASH',
      cashBankAccountId: cashAccount.id,
      currentUserId: 'user-tester'
    });
  } catch (err: any) {
    duplicateThrew = true;
    assert(
      err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate'),
      `Expected duplicate message, got: ${err.message}`
    );
  }
  assert(duplicateThrew, 'Duplicate sales return must be rejected by idempotency check');
  console.log('✅ TEST 4 PASSED: Duplicate sales return prevented.\n');

  // -------------------------------------------------------------
  // TEST 5: Full Purchase Return with ADJUST_DUE (Debit Note)
  // -------------------------------------------------------------
  console.log('--- TEST 5: Full Purchase Return with ADJUST_DUE ---');
  // Buy 50 bags feed @ 1600 = 80,000 on credit
  const purch1Res = await executePurchaseTransaction({
    invoiceNumber: 'INV-PRET-01',
    supplier,
    item: feedItem,
    quantity: 50,
    unitPrice: 1600,
    paymentMethod: 'CREDIT',
    currentUserId: 'user-tester'
  });

  const suppAfterPurch1 = await db.parties.get(supplier.id);
  assert(suppAfterPurch1?.balance === 80000, `Supplier balance should be 80000, got ${suppAfterPurch1?.balance}`);
  const feedAfterPurch1 = await db.inventoryItems.get(feedItem.id);
  assert(feedAfterPurch1?.currentStock === 150, `Feed stock should be 150, got ${feedAfterPurch1?.currentStock}`);

  // Return all 50 bags
  const pret1Res = await executePurchaseReturnTransaction({
    purchaseId: purch1Res.purchase.id,
    items: [
      {
        itemId: feedItem.id,
        returnedQuantity: 50,
        reason: 'Expired feed stock received'
      }
    ],
    refundMethod: 'ADJUST_DUE',
    currentUserId: 'user-tester'
  });

  assert(pret1Res.purchaseReturn.totalRefundAmount === 80000, `Refund should be 80000, got ${pret1Res.purchaseReturn.totalRefundAmount}`);

  // Verify journal entry debit = credit
  const totalDebit5 = pret1Res.journalEntry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit5 = pret1Res.journalEntry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebit5 === totalCredit5, `Journal entry must balance: debit ${totalDebit5} vs credit ${totalCredit5}`);
  assert(totalDebit5 === 80000, `Total debit should be 80000, got ${totalDebit5}`);

  // Verify accounts reversed
  const apLine = pret1Res.journalEntry.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE);
  assert(Boolean(apLine && apLine.debit === 80000), 'AP must be debited by 80000');
  const feedInvLine = pret1Res.journalEntry.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FEED_INVENTORY);
  assert(Boolean(feedInvLine && feedInvLine.credit === 80000), 'Feed Inventory must be credited by 80000');

  // Verify inventory stock deducted
  const feedAfterRet1 = await db.inventoryItems.get(feedItem.id);
  assert(feedAfterRet1?.currentStock === 100, `Feed stock should return to 100, got ${feedAfterRet1?.currentStock}`);

  // Verify supplier AP balance reduced
  const suppAfterRet1 = await db.parties.get(supplier.id);
  assert(suppAfterRet1?.balance === 0, `Supplier balance should be 0, got ${suppAfterRet1?.balance}`);

  // Verify original purchase unchanged
  const origPurch1 = await db.purchases.get(purch1Res.purchase.id);
  assert(origPurch1?.grandTotal === 80000, 'Original purchase must remain untouched');
  console.log('✅ TEST 5 PASSED: Full Purchase Return with ADJUST_DUE perfectly balanced and restored.\n');

  // -------------------------------------------------------------
  // TEST 6: Partial Purchase Return with BANK Refund
  // -------------------------------------------------------------
  console.log('--- TEST 6: Partial Purchase Return with BANK Refund ---');
  // Buy 40 bags feed @ 1500 = 60,000 paid via BANK
  const bankBeforePurch2 = (await db.cashBankAccounts.get(bankAccount.id))!.currentBalance;
  const purch2Res = await executePurchaseTransaction({
    invoiceNumber: 'INV-PRET-02',
    supplier,
    item: feedItem,
    quantity: 40,
    unitPrice: 1500,
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    currentUserId: 'user-tester'
  });

  const bankAfterPurch2 = (await db.cashBankAccounts.get(bankAccount.id))!.currentBalance;
  assert(bankAfterPurch2 === bankBeforePurch2 - 60000, 'Bank should decrease by 60000');
  const feedAfterPurch2 = await db.inventoryItems.get(feedItem.id);
  assert(feedAfterPurch2?.currentStock === 140, `Feed stock should be 140, got ${feedAfterPurch2?.currentStock}`);

  // Return 15 bags via BANK refund
  const pret2Res = await executePurchaseReturnTransaction({
    purchaseId: purch2Res.purchase.id,
    items: [
      {
        itemId: feedItem.id,
        returnedQuantity: 15,
        reason: 'Defective bags'
      }
    ],
    refundMethod: 'BANK',
    bankAccountId: bankAccount.id,
    currentUserId: 'user-tester'
  });

  assert(pret2Res.purchaseReturn.totalRefundAmount === 22500, `Refund should be 15 * 1500 = 22500, got ${pret2Res.purchaseReturn.totalRefundAmount}`);

  // Verify journal balance
  const totalDebit6 = pret2Res.journalEntry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit6 = pret2Res.journalEntry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebit6 === totalCredit6, `Journal entry must balance: debit ${totalDebit6} vs credit ${totalCredit6}`);

  // Verify bank account credited
  const bankAfterRet2 = (await db.cashBankAccounts.get(bankAccount.id))!.currentBalance;
  assert(bankAfterRet2 === bankAfterPurch2 + 22500, `Bank should increase by 22500, got ${bankAfterRet2}`);

  // Verify feed stock reduced by 15
  const feedAfterRet2 = await db.inventoryItems.get(feedItem.id);
  assert(feedAfterRet2?.currentStock === 125, `Feed stock should be 125, got ${feedAfterRet2?.currentStock}`);
  console.log('✅ TEST 6 PASSED: Partial Purchase Return with BANK refund correctly updated accounts and inventory.\n');

  // -------------------------------------------------------------
  // TEST 7: Purchase Over-Return Rejection
  // -------------------------------------------------------------
  console.log('--- TEST 7: Purchase Over-Return Rejection ---');
  // Purchase 2 had 40 bags, 15 already returned. Remaining returnable: 25.
  // Attempt to return 26 bags:
  let purchOverReturnThrew = false;
  try {
    await executePurchaseReturnTransaction({
      purchaseId: purch2Res.purchase.id,
      items: [
        {
          itemId: feedItem.id,
          returnedQuantity: 26
        }
      ],
      refundMethod: 'BANK',
      bankAccountId: bankAccount.id,
      currentUserId: 'user-tester'
    });
  } catch (err: any) {
    purchOverReturnThrew = true;
    assert(
      err.message.includes('বেশি হতে পারে না') || err.message.includes('Cannot return more'),
      `Expected over-return message, got: ${err.message}`
    );
  }
  assert(purchOverReturnThrew, 'Purchase over-return must be rejected');
  console.log('✅ TEST 7 PASSED: Purchase over-return was strictly rejected.\n');

  // -------------------------------------------------------------
  // TEST 8: Purchase Return Stock Availability Protection
  // -------------------------------------------------------------
  console.log('--- TEST 8: Purchase Return Stock Availability Protection ---');
  // Let's reduce feedItem currentStock to 5 bags
  await db.inventoryItems.update(feedItem.id, { currentStock: 5 });

  // Attempt to return 10 bags to supplier
  let stockShortageThrew = false;
  try {
    await executePurchaseReturnTransaction({
      purchaseId: purch2Res.purchase.id,
      items: [
        {
          itemId: feedItem.id,
          returnedQuantity: 10
        }
      ],
      refundMethod: 'BANK',
      bankAccountId: bankAccount.id,
      currentUserId: 'user-tester'
    });
  } catch (err: any) {
    stockShortageThrew = true;
    assert(
      err.message.includes('মজুদ ঘাটতি') || err.message.includes('Insufficient stock'),
      `Expected insufficient stock message, got: ${err.message}`
    );
  }
  assert(stockShortageThrew, 'Purchase return exceeding physical stock must be rejected');
  // Restore stock
  await db.inventoryItems.update(feedItem.id, { currentStock: 125 });
  console.log('✅ TEST 8 PASSED: Physical stock availability protection verified.\n');

  // -------------------------------------------------------------
  // TEST 9: Duplicate Purchase Return Submission (Idempotency)
  // -------------------------------------------------------------
  console.log('--- TEST 9: Duplicate Purchase Return Submission (Idempotency) ---');
  const idempKeyPurch = 'idemp-pret-test-456';
  await executePurchaseReturnTransaction({
    idempotencyKey: idempKeyPurch,
    purchaseId: purch2Res.purchase.id,
    items: [
      {
        itemId: feedItem.id,
        returnedQuantity: 5
      }
    ],
    refundMethod: 'BANK',
    bankAccountId: bankAccount.id,
    currentUserId: 'user-tester'
  });

  let duplicatePurchThrew = false;
  try {
    await executePurchaseReturnTransaction({
      idempotencyKey: idempKeyPurch,
      purchaseId: purch2Res.purchase.id,
      items: [
        {
          itemId: feedItem.id,
          returnedQuantity: 5
        }
      ],
      refundMethod: 'BANK',
      bankAccountId: bankAccount.id,
      currentUserId: 'user-tester'
    });
  } catch (err: any) {
    duplicatePurchThrew = true;
    assert(
      err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate'),
      `Expected duplicate message, got: ${err.message}`
    );
  }
  assert(duplicatePurchThrew, 'Duplicate purchase return must be rejected by idempotency check');
  console.log('✅ TEST 9 PASSED: Duplicate purchase return prevented.\n');

  // -------------------------------------------------------------
  // TEST 10: Multi-line Sale Invoice Return Support
  // -------------------------------------------------------------
  console.log('--- TEST 10: Multi-line Sale Invoice Return Support ---');
  // Seed a multi-line sale directly to simulate a multi-item POS invoice:
  const multiSaleId = 'sale-multi-test-1';
  const multiSaleInvoiceNumber = 'INV-MULTI-01';
  await db.sales.add({
    id: multiSaleId,
    invoiceNumber: multiSaleInvoiceNumber,
    customerId: customer.id,
    customerName: customer.name,
    date: new Date().toISOString().split('T')[0],
    items: [
      {
        itemId: fishItem.id,
        itemName: fishItem.nameBn,
        quantity: 10,
        unitPrice: 300,
        lineTotal: 3000,
        cogsAmount: 2000
      },
      {
        itemId: cropItem.id,
        itemName: cropItem.nameBn,
        quantity: 20,
        unitPrice: 40,
        lineTotal: 800,
        cogsAmount: 600
      }
    ],
    subtotal: 3800,
    discount: 0,
    vatTax: 0,
    totalAmount: 3800,
    grandTotal: 3800,
    paidAmount: 0,
    dueAmount: 3800,
    paymentMethod: 'CREDIT'
  });
  await db.parties.update(customer.id, { balance: 3800 });

  // Return 5 kg fish and 10 kg crop in one Credit Note
  const multiRetRes = await executeSalesReturnTransaction({
    saleId: multiSaleId,
    items: [
      {
        itemId: fishItem.id,
        returnedQuantity: 5
      },
      {
        itemId: cropItem.id,
        returnedQuantity: 10
      }
    ],
    refundMethod: 'ADJUST_DUE',
    currentUserId: 'user-tester'
  });

  assert(multiRetRes.salesReturn.items.length === 2, 'Must have 2 returned items');
  // Refund: 5 * 300 + 10 * 40 = 1500 + 400 = 1900
  assert(multiRetRes.salesReturn.totalRefundAmount === 1900, `Refund should be 1900, got ${multiRetRes.salesReturn.totalRefundAmount}`);
  // COGS reversed: 5 * 200 + 10 * 30 = 1000 + 300 = 1300
  assert(multiRetRes.salesReturn.totalCogsReversed === 1300, `COGS reversed should be 1300, got ${multiRetRes.salesReturn.totalCogsReversed}`);

  // Verify journal balance
  const totalDebit10 = multiRetRes.journalEntry.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit10 = multiRetRes.journalEntry.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebit10 === totalCredit10, `Multi-line journal must balance: debit ${totalDebit10} vs credit ${totalCredit10}`);
  console.log('✅ TEST 10 PASSED: Multi-line invoice return accurately reversed all accounts with balanced entries.\n');

  console.log('========================================================');
  console.log('ALL SALES RETURN & PURCHASE RETURN TESTS PASSED (10/10)!');
  console.log('========================================================');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runReturnsAccountingTest()
    .then(() => {
      console.log('\nTEST RUNNER FINISHED SUCCESSFULLY.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nTEST RUNNER FAILED:', err);
      process.exit(1);
    });
}
