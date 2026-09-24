import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeSaleTransaction,
  executePurchaseTransaction,
  executeAdvancePaymentTransaction,
  executeApplyAdvanceTransaction,
  getPartyAvailableAdvance
} from '../services/transactionService';
import {
  Party,
  InventoryItem,
  CashBankAccount,
  AdvancePayment,
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

export async function runAdvancePaymentTests() {
  console.log('========================================================');
  console.log('STARTING ADVANCE PAYMENT ACCOUNTING & APPLICATION TESTS');
  console.log('========================================================\n');

  // 1. Reset Database & Seed
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);
  await db.journalEntries.clear();
  await db.sales.clear();
  await db.purchases.clear();
  if (db.advancePayments) {
    await db.advancePayments.clear();
  }
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
    accountNumber: 'AGRANI-01',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.bulkAdd([cashAccount, bankAccount]);

  // Seed Parties
  const customer: Party = {
    id: 'party-cust-1',
    name: 'Rahim Agro Traders',
    type: 'CUSTOMER',
    phone: '01711112222',
    balance: 0,
    isActive: true
  };
  const supplier: Party = {
    id: 'party-supp-1',
    name: 'Bengal Feed & Seeds Ltd',
    type: 'SUPPLIER',
    phone: '01811113333',
    balance: 0,
    isActive: true
  };
  await db.parties.bulkAdd([customer, supplier]);

  // Seed Inventory Item
  const feedItem: InventoryItem = {
    id: 'item-feed-grower',
    code: 'FEED-01',
    nameBn: 'গ্রোয়ার ফিড ২৫ কেজি',
    nameEn: 'Grower Feed 25kg',
    category: 'FEED',
    unit: 'BAG',
    currentStock: 1000,
    avgCostPrice: 1500,
    sellingPrice: 2000,
    reorderLevel: 50
  };
  await db.inventoryItems.add(feedItem);

  // ---------------------------------------------------------------------------
  // TEST 1: Customer Advance Receipt (Liability Recognition)
  // Debit Cash (1010), Credit Customer Advance (2040)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 1: Customer Advance Receipt ---');
  const custAdvanceResult = await executeAdvancePaymentTransaction({
    id: 'adv-cust-101',
    partyId: customer.id,
    party: customer,
    amount: 10000,
    direction: 'RECEIVED',
    paymentMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-admin',
    date: '2026-03-20',
    narration: 'Customer advance for future feed purchases'
  });

  assert(custAdvanceResult.advancePayment.id === 'adv-cust-101', 'Advance payment record created with expected ID');
  assert(custAdvanceResult.advancePayment.remainingBalance === 10000, 'Advance payment initial remaining balance is full amount');
  assert(custAdvanceResult.advancePayment.direction === 'RECEIVED', 'Direction is RECEIVED');

  // Verify journal entry debits and credits
  const advJournal: JournalEntry = await db.journalEntries.get(custAdvanceResult.journalEntryId);
  assert(!!advJournal, 'Customer advance journal entry created in DB');

  const advDebits = advJournal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const advCredits = advJournal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(advDebits - advCredits) < 0.001, `Customer advance journal balanced: Debits ৳${advDebits} == Credits ৳${advCredits}`);
  assert(advDebits === 10000, 'Customer advance journal total matches amount ৳10,000');

  const cashDebitLine = advJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.CASH);
  const liabilityCreditLine = advJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.CUSTOMER_ADVANCES);
  assert(!!cashDebitLine && cashDebitLine.debit === 10000, 'Debited Cash on Hand (1010) for ৳10,000');
  assert(!!liabilityCreditLine && liabilityCreditLine.credit === 10000, 'Credited Customer Advance (2040) for ৳10,000');

  // Verify cash drawer updated
  const updatedCash = await db.cashBankAccounts.get(cashAccount.id);
  assert(updatedCash?.currentBalance === 510000, 'Main cash drawer increased by ৳10,000');

  // ---------------------------------------------------------------------------
  // TEST 2: Supplier Advance Payment (Asset Recognition)
  // Debit Supplier Advance (1070), Credit Bank (1030)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Supplier Advance Payment ---');
  const suppAdvanceResult = await executeAdvancePaymentTransaction({
    id: 'adv-supp-201',
    partyId: supplier.id,
    party: supplier,
    amount: 15000,
    direction: 'PAID',
    paymentMethod: 'BANK',
    bankAccountId: bankAccount.id,
    currentUserId: 'user-admin',
    date: '2026-03-20',
    narration: 'Advance payment to Bengal Feed'
  });

  assert(suppAdvanceResult.advancePayment.id === 'adv-supp-201', 'Supplier advance payment created with expected ID');
  assert(suppAdvanceResult.advancePayment.remainingBalance === 15000, 'Supplier advance initial remaining balance is ৳15,000');

  const suppAdvJournal: JournalEntry = await db.journalEntries.get(suppAdvanceResult.journalEntryId);
  assert(!!suppAdvJournal, 'Supplier advance journal entry exists');

  const suppDebits = suppAdvJournal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const suppCredits = suppAdvJournal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(suppDebits - suppCredits) < 0.001, `Supplier advance journal balanced: Debits ৳${suppDebits} == Credits ৳${suppCredits}`);
  assert(suppDebits === 15000, 'Supplier advance journal total is ৳15,000');

  const suppAssetLine = suppAdvJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.SUPPLIER_ADVANCES);
  const bankCreditLine = suppAdvJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.BANK);
  assert(!!suppAssetLine && suppAssetLine.debit === 15000, 'Debited Supplier Advance (1070) for ৳15,000');
  assert(!!bankCreditLine && bankCreditLine.credit === 15000, 'Credited Bank Accounts (1030) for ৳15,000');

  // Verify bank account balance updated
  const updatedBank = await db.cashBankAccounts.get(bankAccount.id);
  assert(updatedBank?.currentBalance === 485000, 'Bank balance decreased by ৳15,000');

  // ---------------------------------------------------------------------------
  // TEST 3: Full Advance Application on Sale Invoice
  // Advance: ৳10,000 available. Sale: 2 bags @ ৳2,000 = ৳4,000. Apply: ৳4,000.
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Full Advance Application on Sale Invoice ---');
  const sale1Result = await executeSaleTransaction({
    id: 'sale-inv-301',
    customer,
    item: feedItem,
    quantity: 2,
    unitPrice: 2000,
    paymentMethod: 'CREDIT',
    advancePaymentId: 'adv-cust-101',
    advanceAppliedAmount: 4000,
    currentUserId: 'user-admin',
    date: '2026-03-21'
  });

  assert(sale1Result.sale.totalAmount === 4000, 'Sale total is ৳4,000');
  assert(sale1Result.sale.dueAmount === 0, 'Sale dueAmount is ৳0 due to full advance coverage');
  assert(sale1Result.sale.status === 'PAID', 'Sale status marked as PAID');
  assert(sale1Result.sale.advanceAppliedAmount === 4000, 'Sale records advanceAppliedAmount ৳4,000');

  // Check Advance record balance updated
  const freshCustAdv1 = await db.advancePayments.get('adv-cust-101');
  assert(freshCustAdv1?.remainingBalance === 6000, `Advance remaining balance reduced from ৳10,000 to ৳6,000 (actual: ৳${freshCustAdv1?.remainingBalance})`);
  assert(freshCustAdv1?.appliedInvoices?.length === 1, 'Advance record lists 1 applied invoice');

  // Check Sale Journal debits == credits
  const sale1Journal: JournalEntry = await db.journalEntries.get(sale1Result.journalEntryId);
  const s1Debits = sale1Journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const s1Credits = sale1Journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(s1Debits - s1Credits) < 0.001, `Sale 1 journal balanced: Debits ৳${s1Debits} == Credits ৳${s1Credits}`);

  // Check Advance Application Journal: Debit Customer Advance (2040), Credit Accounts Receivable (1040)
  assert(!!sale1Result.advanceJournalEntryId, 'Advance application journal entry created');
  const advApp1Journal: JournalEntry = await db.journalEntries.get(sale1Result.advanceJournalEntryId!);
  const a1Debits = advApp1Journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const a1Credits = advApp1Journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(a1Debits - a1Credits) < 0.001, `Advance application 1 journal balanced: Debits ৳${a1Debits} == Credits ৳${a1Credits}`);
  assert(a1Debits === 4000, 'Advance application 1 journal total is ৳4,000');

  const app1Debit = advApp1Journal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.CUSTOMER_ADVANCES);
  const app1Credit = advApp1Journal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE);
  assert(!!app1Debit && app1Debit.debit === 4000, 'Advance application debited Customer Advance (2040) for ৳4,000');
  assert(!!app1Credit && app1Credit.credit === 4000, 'Advance application credited Accounts Receivable (1040) for ৳4,000');

  // ---------------------------------------------------------------------------
  // TEST 4: Partial Advance Application Where Invoice Total Exceeds Remaining Advance
  // Remaining advance: ৳6,000. Sale: 5 bags @ ৳2,000 = ৳10,000. Apply: ৳6,000. Remaining Due: ৳4,000.
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Partial Advance Application (Invoice > Advance) ---');
  const sale2Result = await executeSaleTransaction({
    id: 'sale-inv-302',
    customer,
    item: feedItem,
    quantity: 5,
    unitPrice: 2000,
    paymentMethod: 'CREDIT',
    advancePaymentId: 'adv-cust-101',
    advanceAppliedAmount: 6000,
    currentUserId: 'user-admin',
    date: '2026-03-21'
  });

  assert(sale2Result.sale.totalAmount === 10000, 'Sale 2 total is ৳10,000');
  assert(sale2Result.sale.dueAmount === 4000, 'Sale 2 dueAmount is ৳4,000 (৳10,000 - ৳6,000)');
  assert(sale2Result.sale.status === 'PARTIAL', 'Sale 2 status is PARTIAL');

  const freshCustAdv2 = await db.advancePayments.get('adv-cust-101');
  assert(freshCustAdv2?.remainingBalance === 0, 'Advance remaining balance is now ৳0 (fully exhausted)');

  // Verify both journals balanced
  const sale2Journal: JournalEntry = await db.journalEntries.get(sale2Result.journalEntryId);
  const s2Debits = sale2Journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const s2Credits = sale2Journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(s2Debits - s2Credits) < 0.001, `Sale 2 journal balanced: Debits ৳${s2Debits} == Credits ৳${s2Credits}`);

  const advApp2Journal: JournalEntry = await db.journalEntries.get(sale2Result.advanceJournalEntryId!);
  const a2Debits = advApp2Journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const a2Credits = advApp2Journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(a2Debits - a2Credits) < 0.001, `Advance application 2 journal balanced: Debits ৳${a2Debits} == Credits ৳${a2Credits}`);
  assert(a2Debits === 6000, 'Advance application 2 journal total is ৳6,000');

  // ---------------------------------------------------------------------------
  // TEST 5: Over-Application Rejection
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 5: Over-Application Rejection ---');
  // Attempt 1: Advance is exhausted (৳0 remaining), trying to apply ৳1,000
  let overAppErrorCaught = false;
  try {
    await executeSaleTransaction({
      customer,
      item: feedItem,
      quantity: 1,
      unitPrice: 2000,
      paymentMethod: 'CREDIT',
      advancePaymentId: 'adv-cust-101',
      advanceAppliedAmount: 1000,
      currentUserId: 'user-admin'
    });
  } catch (err: any) {
    overAppErrorCaught = true;
    console.log(`Expected rejection caught: ${err.message}`);
  }
  assert(overAppErrorCaught, 'Correctly rejected advance application when remaining advance balance is ৳0');

  // Create new advance of ৳3,000 for customer
  await executeAdvancePaymentTransaction({
    id: 'adv-cust-102',
    partyId: customer.id,
    party: customer,
    amount: 3000,
    direction: 'RECEIVED',
    paymentMethod: 'CASH',
    cashBankAccountId: cashAccount.id,
    currentUserId: 'user-admin',
    date: '2026-03-22'
  });

  // Attempt 2: Try to apply ৳5,000 when available advance is ৳3,000
  let exceedAdvBalanceCaught = false;
  try {
    await executeSaleTransaction({
      customer,
      item: feedItem,
      quantity: 3,
      unitPrice: 2000,
      paymentMethod: 'CREDIT',
      advancePaymentId: 'adv-cust-102',
      advanceAppliedAmount: 5000,
      currentUserId: 'user-admin'
    });
  } catch (err: any) {
    exceedAdvBalanceCaught = true;
    console.log(`Expected rejection caught: ${err.message}`);
  }
  assert(exceedAdvBalanceCaught, 'Correctly rejected application exceeding available advance balance');

  // Attempt 3: Try to apply ৳3,000 advance on a ৳2,000 invoice (applying more than invoice total)
  let exceedInvoiceTotalCaught = false;
  try {
    await executeSaleTransaction({
      customer,
      item: feedItem,
      quantity: 1,
      unitPrice: 2000,
      paymentMethod: 'CREDIT',
      advancePaymentId: 'adv-cust-102',
      advanceAppliedAmount: 3000,
      currentUserId: 'user-admin'
    });
  } catch (err: any) {
    exceedInvoiceTotalCaught = true;
    console.log(`Expected rejection caught: ${err.message}`);
  }
  assert(exceedInvoiceTotalCaught, 'Correctly rejected application exceeding invoice total');

  // ---------------------------------------------------------------------------
  // TEST 6: Supplier Advance Application on Purchase Invoice
  // Supplier advance: ৳15,000 available. Purchase: 5 bags @ ৳1,600 = ৳8,000. Apply: ৳8,000.
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 6: Supplier Advance Application on Purchase Invoice ---');
  const pur1Result = await executePurchaseTransaction({
    id: 'pur-inv-401',
    supplier,
    item: feedItem,
    quantity: 5,
    unitPrice: 1600,
    paymentMethod: 'CREDIT',
    advancePaymentId: 'adv-supp-201',
    advanceAppliedAmount: 8000,
    currentUserId: 'user-admin',
    date: '2026-03-22'
  });

  assert(pur1Result.purchase.grandTotal === 8000, 'Purchase total is ৳8,000');
  assert(pur1Result.purchase.dueAmount === 0, 'Purchase dueAmount is ৳0 after advance applied');
  assert(pur1Result.purchase.status === 'PAID', 'Purchase status is PAID');

  const freshSuppAdv1 = await db.advancePayments.get('adv-supp-201');
  assert(freshSuppAdv1?.remainingBalance === 7000, `Supplier advance balance reduced from ৳15,000 to ৳7,000 (actual: ৳${freshSuppAdv1?.remainingBalance})`);

  // Check Purchase Journal debits == credits
  const pur1Journal: JournalEntry = await db.journalEntries.get(pur1Result.journalEntryId);
  const p1Debits = pur1Journal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const p1Credits = pur1Journal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(p1Debits - p1Credits) < 0.001, `Purchase journal balanced: Debits ৳${p1Debits} == Credits ৳${p1Credits}`);

  // Check Advance Application Journal: Debit Accounts Payable (2010), Credit Supplier Advance (1070)
  assert(!!pur1Result.advanceJournalEntryId, 'Advance application journal entry created for purchase');
  const suppAdvAppJournal: JournalEntry = await db.journalEntries.get(pur1Result.advanceJournalEntryId!);
  const sapDebits = suppAdvAppJournal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const sapCredits = suppAdvAppJournal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(sapDebits - sapCredits) < 0.001, `Supplier advance application journal balanced: Debits ৳${sapDebits} == Credits ৳${sapCredits}`);
  assert(sapDebits === 8000, 'Supplier advance application journal total is ৳8,000');

  const apDebit = suppAdvAppJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE);
  const suppAdvCredit = suppAdvAppJournal.lines.find(l => l.accountId === CANONICAL_ACCOUNTS.SUPPLIER_ADVANCES);
  assert(!!apDebit && apDebit.debit === 8000, 'Debited Accounts Payable (2010) for ৳8,000');
  assert(!!suppAdvCredit && suppAdvCredit.credit === 8000, 'Credited Supplier Advance (1070) for ৳8,000');

  // ---------------------------------------------------------------------------
  // TEST 7: Idempotency & Duplicate Protection
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 7: Idempotency & Duplicate Protection ---');
  let duplicateAdvCaught = false;
  try {
    await executeAdvancePaymentTransaction({
      partyId: customer.id,
      amount: 5000,
      direction: 'RECEIVED',
      paymentMethod: 'CASH',
      idempotencyKey: 'adv-idem-key-777',
      currentUserId: 'user-admin'
    });
    // Second execution with identical idempotencyKey
    await executeAdvancePaymentTransaction({
      partyId: customer.id,
      amount: 5000,
      direction: 'RECEIVED',
      paymentMethod: 'CASH',
      idempotencyKey: 'adv-idem-key-777',
      currentUserId: 'user-admin'
    });
  } catch (err: any) {
    duplicateAdvCaught = true;
    console.log(`Expected duplicate rejection caught: ${err.message}`);
  }
  assert(duplicateAdvCaught, 'Correctly prevented duplicate advance payment via idempotency key');

  // ---------------------------------------------------------------------------
  // TEST 8: Apply Advance on Existing Unpaid Invoice
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 8: Apply Advance on Existing Unpaid Invoice ---');
  // Create a credit sale without advance
  const existingSale = await executeSaleTransaction({
    id: 'sale-existing-501',
    customer,
    item: feedItem,
    quantity: 4,
    unitPrice: 2000,
    paymentMethod: 'CREDIT',
    currentUserId: 'user-admin',
    date: '2026-03-23'
  });
  assert(existingSale.sale.dueAmount === 8000, 'Existing sale due is ৳8,000');

  // Customer has advance 'adv-cust-102' with ৳3,000 balance
  const applyExistingResult = await executeApplyAdvanceTransaction({
    advancePaymentId: 'adv-cust-102',
    invoiceId: existingSale.sale.id,
    invoiceType: 'SALE',
    amount: 3000,
    currentUserId: 'user-admin'
  });

  assert(applyExistingResult.appliedAmount === 3000, 'Applied ৳3,000 to existing invoice');
  assert(applyExistingResult.remainingInvoiceDue === 5000, 'Remaining invoice due reduced to ৳5,000');
  assert(applyExistingResult.remainingAdvanceBalance === 0, 'Advance balance exhausted to ৳0');

  const updatedSaleRecord = await db.sales.get(existingSale.sale.id);
  assert(updatedSaleRecord?.dueAmount === 5000, 'Sale record dueAmount in DB is ৳5,000');
  assert(updatedSaleRecord?.status === 'PARTIAL', 'Sale record status is PARTIAL');

  // Verify journal entry of post-invoice advance application
  const existingAdvAppJournal: JournalEntry = await db.journalEntries.get(applyExistingResult.journalEntryId);
  const eaDebits = existingAdvAppJournal.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const eaCredits = existingAdvAppJournal.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(Math.abs(eaDebits - eaCredits) < 0.001, `Existing advance application journal balanced: Debits ৳${eaDebits} == Credits ৳${eaCredits}`);

  console.log('\n========================================================');
  console.log('ADVANCE PAYMENT TESTS COMPLETED');
  console.log(`Total: ${totalTests}, Passed: ${passedTests}, Failed: ${failedTests}`);
  console.log('========================================================\n');

  return { total: totalTests, passed: passedTests, failed: failedTests, failures };
}

// Allow direct execution via tsx
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('testAdvancePayments')) {
  runAdvancePaymentTests()
    .then((r) => {
      if (r.failed > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal test failure:', err);
      process.exit(1);
    });
}
