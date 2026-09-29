import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { generateTrialBalance } from '../accounting/accountingEngine';
import {
  executeSaleTransaction,
  executePurchaseTransaction,
  executeContraTransferTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeAdvancePaymentTransaction
} from '../services/transactionService';
import { InventoryItem, Party } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 08 — INTERRUPTED TRANSACTION / CRASH SAFETY
 * FINAL RELEASE TASK 08 — INTERRUPTED FINANCIAL TRANSACTION SAFETY
 *
 * Verifies that financial transactions across all major paths (Sales, Purchases, Contra Transfers,
 * Loans, and Advances) maintain strict atomic guarantees:
 * - When interrupted/crashed at any point, the transaction is strictly NOT COMMITTED (clean rollback).
 * - No journal without source transaction.
 * - No source transaction without journal.
 * - No inventory movement without its transaction.
 * - No cash movement without corresponding accounting.
 * - No duplicate journals on retry.
 * - No duplicate inventory movements on retry.
 * - When resumed/re-attempted normally, the transaction completes cleanly (COMPLETE).
 */
export async function runInterruptedTransactionSafetyTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, description: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`  ✅ [PASS] ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`  ❌ [FAIL] ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 08: INTERRUPTED TRANSACTION / CRASH SAFETY');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // 1. Setup Isolated Test Database
  // --------------------------------------------------------------------------
  const isolatedDbName = `AgroInterruptedTxDb_${Date.now()}`;
  console.log(`\n--- 1. Initializing Isolated Database: ${isolatedDbName} ---`);
  const testDb = new AgroDatabase(isolatedDbName);
  await testDb.open();
  await Promise.all(testDb.tables.map((t) => t.clear()));

  // Seed system configuration
  await testDb.systemConfig.put({
    ownerUid: 'usr_atomicity_tester',
    companyName: 'পারমাণবিক লেনদেন পরীক্ষা এগ্রো ফার্ম',
    phone: '01711001122',
    currency: 'BDT',
    initializedAt: '2026-01-01T00:00:00.000Z',
    synced: true
  } as any);

  // Seed chart of accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await testDb.accounts.put(acc);
  }

  // Seed cash and bank accounts
  const cashAccId = 'cba_crash_cash_01';
  const bankAccId = 'cba_crash_bank_01';
  await testDb.cashBankAccounts.bulkPut([
    {
      id: cashAccId,
      name: 'প্রধান ক্যাশ ড্রয়ার',
      accountName: 'প্রধান ক্যাশ ড্রয়ার',
      accountType: 'CASH',
      currentBalance: 50000,
      isActive: true,
      synced: true
    },
    {
      id: bankAccId,
      name: 'ডাচ-বাংলা ব্যাংক চলতি হিসাব',
      accountName: 'ডাচ-বাংলা ব্যাংক চলতি হিসাব',
      accountType: 'BANK',
      currentBalance: 150000,
      isActive: true,
      synced: true
    }
  ] as any);

  // Seed parties
  const custParty: Party = {
    id: 'pty_cust_atom_01',
    type: 'CUSTOMER',
    name: 'মডার্ন ডেইরি ট্রেডার্স',
    phone: '01811556677',
    balance: 0,
    synced: true
  };
  const suppParty: Party = {
    id: 'pty_supp_atom_01',
    type: 'SUPPLIER',
    name: 'প্রিমিয়ার ফিড মিলস',
    phone: '01911778899',
    balance: 0,
    synced: true
  };
  await testDb.parties.bulkPut([custParty, suppParty]);

  // Seed inventory item
  const feedItem: InventoryItem = {
    id: 'item_feed_crash_01',
    code: 'FEED-CRASH-01',
    nameBn: 'প্রিমিয়াম ক্যাটল ফিড (৫০ কেজি)',
    nameEn: 'Premium Cattle Feed (50kg)',
    category: 'FEED',
    unit: 'BAG',
    currentStock: 100,
    reorderLevel: 10,
    avgCostPrice: 1000,
    sellingPrice: 1250,
    synced: true
  };
  await testDb.inventoryItems.put(feedItem);

  console.log('  Initial state established: 100 bags stock @ ৳1,000, Cash ৳50,000, Bank ৳150,000.');

  // --------------------------------------------------------------------------
  // SCENARIO 1: INTERRUPTED SALE TRANSACTION (FAILURE DURING STOCK MOVEMENT)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 1: Interrupted Sale Transaction (Failure during Stock Movement) ---');

  const preSale1Counts = {
    sales: await testDb.sales.count(),
    journalEntries: await testDb.journalEntries.count(),
    stockMovements: await testDb.stockMovements.count()
  };
  const preSale1Item = await testDb.inventoryItems.get(feedItem.id);
  const preSale1Bank = await testDb.cashBankAccounts.get(bankAccId);

  // Native Dexie creating hook on stockMovements to simulate a crash
  let simulateSale1Crash = true;
  const sale1CrashHook = function () {
    if (simulateSale1Crash) {
      throw new Error('SIMULATED_CRASH_DURING_SALE_STOCK_MOVEMENT');
    }
  };
  testDb.stockMovements.hook('creating', sale1CrashHook);

  let sale1ErrorCaught = false;
  try {
    await executeSaleTransaction(
      {
        invoiceNumber: 'INV-CRASH-001',
        idempotencyKey: 'idem_sale_crash_001',
        customer: custParty,
        item: feedItem,
        quantity: 10,
        unitPrice: 1250,
        paymentMethod: 'BANK',
        bankAccountId: bankAccId,
        currentUserId: 'usr_atomicity_tester',
        date: '2026-03-01'
      },
      testDb
    );
  } catch (err: any) {
    if (err.message?.includes('SIMULATED_CRASH_DURING_SALE_STOCK_MOVEMENT')) {
      sale1ErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert(sale1ErrorCaught, 'Simulated mid-transaction crash during stock movement was triggered');

  // Verify ATOMICITY: NOT COMMITTED
  const postCrashSale1Counts = {
    sales: await testDb.sales.count(),
    journalEntries: await testDb.journalEntries.count(),
    stockMovements: await testDb.stockMovements.count()
  };
  const postCrashSale1Item = await testDb.inventoryItems.get(feedItem.id);
  const postCrashSale1Bank = await testDb.cashBankAccounts.get(bankAccId);
  const postCrashSale1Cust = await testDb.parties.get(custParty.id);

  assert(postCrashSale1Counts.sales === preSale1Counts.sales, 'NOT COMMITTED: No sale record was saved in sales');
  assert(postCrashSale1Counts.journalEntries === preSale1Counts.journalEntries, 'NOT COMMITTED: No orphan journal entry without sale');
  assert(postCrashSale1Counts.stockMovements === preSale1Counts.stockMovements, 'NOT COMMITTED: No orphan stock movement without transaction');
  assert(postCrashSale1Item?.currentStock === preSale1Item?.currentStock, 'NOT COMMITTED: Inventory stock quantity remained unchanged (100)');
  assert(postCrashSale1Bank?.currentBalance === preSale1Bank?.currentBalance, 'NOT COMMITTED: Cash/Bank balance remained unchanged (৳150,000)');
  assert(postCrashSale1Cust?.balance === 0, 'NOT COMMITTED: Customer balance remained unchanged (0)');

  // Verify Trial Balance remains completely balanced with 0 entries
  const tbAfterCrash1 = await generateTrialBalance(undefined, testDb);
  assert(tbAfterCrash1.isBalanced, 'Trial Balance remains balanced after interrupted sale');
  assert(tbAfterCrash1.totalDebit === 0 && tbAfterCrash1.totalCredit === 0, 'Trial Balance has 0 orphan postings');

  // Disarm failure hook and re-attempt sale transaction: COMPLETE
  simulateSale1Crash = false;
  console.log('  Disarming failure hook and re-attempting sale transaction...');
  const successfulSale1 = await executeSaleTransaction(
    {
      invoiceNumber: 'INV-CRASH-001',
      idempotencyKey: 'idem_sale_crash_001',
      customer: custParty,
      item: feedItem,
      quantity: 10,
      unitPrice: 1250,
      paymentMethod: 'BANK',
      bankAccountId: bankAccId,
      currentUserId: 'usr_atomicity_tester',
      date: '2026-03-01'
    },
    testDb
  );

  assert(!!successfulSale1.sale && !!successfulSale1.journalEntryId, 'COMPLETE: Sale executed cleanly on normal retry');
  assert(await testDb.sales.count() === 1, 'COMPLETE: Exactly 1 sale record in sales table');
  assert(await testDb.journalEntries.count() === 1, 'COMPLETE: Exactly 1 journal entry in journalEntries table');
  assert(await testDb.stockMovements.count() === 1, 'COMPLETE: Exactly 1 stock movement in stockMovements table');
  const postSuccessItem = await testDb.inventoryItems.get(feedItem.id);
  assert(postSuccessItem?.currentStock === 90, 'COMPLETE: Inventory stock cleanly decremented to 90');
  const postSuccessBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postSuccessBank?.currentBalance === 162500, 'COMPLETE: Bank balance received ৳12,500 (now ৳162,500)');

  // Unsubscribe hook
  testDb.stockMovements.hook('creating').unsubscribe(sale1CrashHook);

  // --------------------------------------------------------------------------
  // SCENARIO 2: DUPLICATE PREVENTION ON RETRY (IDEMPOTENCY)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 2: Duplicate Prevention on Replay (Idempotency) ---');

  let duplicateSaleBlocked = false;
  try {
    await executeSaleTransaction(
      {
        invoiceNumber: 'INV-CRASH-001',
        idempotencyKey: 'idem_sale_crash_001', // Exact same idempotency key
        customer: custParty,
        item: feedItem,
        quantity: 10,
        unitPrice: 1250,
        paymentMethod: 'BANK',
        bankAccountId: bankAccId,
        currentUserId: 'usr_atomicity_tester',
        date: '2026-03-01'
      },
      testDb
    );
  } catch (err: any) {
    if (err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate')) {
      duplicateSaleBlocked = true;
    }
  }

  assert(duplicateSaleBlocked, 'Replaying completed sale with same idempotency key strictly rejected');
  assert(await testDb.sales.count() === 1, 'NO duplicate sale: sales count remains 1');
  assert(await testDb.journalEntries.count() === 1, 'NO duplicate journal: journalEntries count remains 1');
  assert(await testDb.stockMovements.count() === 1, 'NO duplicate inventory movement: stockMovements count remains 1');

  // --------------------------------------------------------------------------
  // SCENARIO 3: INTERRUPTED PURCHASE TRANSACTION (FAILURE MID-FLIGHT)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 3: Interrupted Purchase Transaction (Failure mid-flight) ---');

  const prePurCounts = {
    purchases: await testDb.purchases.count(),
    journalEntries: await testDb.journalEntries.count(),
    stockMovements: await testDb.stockMovements.count()
  };
  const prePurItem = await testDb.inventoryItems.get(feedItem.id);
  const prePurBank = await testDb.cashBankAccounts.get(bankAccId);

  // Hook stockMovements.creating during purchase to simulate crash
  let simulatePurCrash = true;
  const purCrashHook = function () {
    if (simulatePurCrash) {
      throw new Error('SIMULATED_CRASH_DURING_PURCHASE_STOCK_WRITE');
    }
  };
  testDb.stockMovements.hook('creating', purCrashHook);

  let purErrorCaught = false;
  try {
    await executePurchaseTransaction(
      {
        invoiceNumber: 'PUR-CRASH-001',
        idempotencyKey: 'idem_pur_crash_001',
        supplier: suppParty,
        item: feedItem,
        quantity: 50,
        unitPrice: 1000,
        paymentMethod: 'BANK',
        bankAccountId: bankAccId,
        currentUserId: 'usr_atomicity_tester',
        date: '2026-03-02'
      },
      testDb
    );
  } catch (err: any) {
    if (err.message?.includes('SIMULATED_CRASH_DURING_PURCHASE_STOCK_WRITE')) {
      purErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert(purErrorCaught, 'Simulated crash during purchase stock write was triggered');

  // Verify ATOMICITY: NOT COMMITTED
  assert(await testDb.purchases.count() === prePurCounts.purchases, 'NOT COMMITTED: No purchase record created in purchases');
  assert(await testDb.journalEntries.count() === prePurCounts.journalEntries, 'NOT COMMITTED: No journal created without purchase');
  assert(await testDb.stockMovements.count() === prePurCounts.stockMovements, 'NOT COMMITTED: No stock movement created without purchase');
  const postCrashPurItem = await testDb.inventoryItems.get(feedItem.id);
  assert(postCrashPurItem?.currentStock === prePurItem?.currentStock, 'NOT COMMITTED: Inventory stock remains 90 (no orphan increment)');
  const postCrashPurBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postCrashPurBank?.currentBalance === prePurBank?.currentBalance, 'NOT COMMITTED: Bank balance remains ৳162,500 (no orphan payment)');

  // Disarm and execute normal purchase: COMPLETE
  simulatePurCrash = false;
  console.log('  Disarming failure hook and re-attempting purchase transaction...');
  const successfulPur = await executePurchaseTransaction(
    {
      invoiceNumber: 'PUR-CRASH-001',
      idempotencyKey: 'idem_pur_crash_001',
      supplier: suppParty,
      item: feedItem,
      quantity: 50,
      unitPrice: 1000,
      paymentMethod: 'BANK',
      bankAccountId: bankAccId,
      currentUserId: 'usr_atomicity_tester',
      date: '2026-03-02'
    },
    testDb
  );

  assert(!!successfulPur.purchase && !!successfulPur.journalEntryId, 'COMPLETE: Purchase executed cleanly on normal retry');
  assert(await testDb.purchases.count() === 1, 'COMPLETE: Exactly 1 purchase record in purchases table');
  assert(await testDb.journalEntries.count() === 2, 'COMPLETE: Exactly 2 journal entries in table (1 sale + 1 purchase)');
  assert(await testDb.stockMovements.count() === 2, 'COMPLETE: Exactly 2 stock movements in table (1 sale OUT + 1 purchase IN)');
  const postSuccessPurItem = await testDb.inventoryItems.get(feedItem.id);
  assert(postSuccessPurItem?.currentStock === 140, 'COMPLETE: Inventory stock cleanly increased to 140 (90 + 50)');
  const postSuccessPurBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postSuccessPurBank?.currentBalance === 112500, 'COMPLETE: Bank balance deducted by ৳50,000 (now ৳112,500)');

  // Unsubscribe hook
  testDb.stockMovements.hook('creating').unsubscribe(purCrashHook);

  // --------------------------------------------------------------------------
  // SCENARIO 4: INTERRUPTED CONTRA BANK TRANSFER (FAILURE MID-FLIGHT)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 4: Interrupted Contra Bank Transfer (Failure mid-flight) ---');

  const preContraCash = await testDb.cashBankAccounts.get(cashAccId);
  const preContraBank = await testDb.cashBankAccounts.get(bankAccId);
  const preContraJournals = await testDb.journalEntries.count();
  const preContraTransfers = await testDb.bankTransfers.count();

  // Hook bankTransfers.creating to simulate crash before transfer audit is saved
  let simulateContraCrash = true;
  const contraCrashHook = function () {
    if (simulateContraCrash) {
      throw new Error('SIMULATED_CRASH_DURING_CONTRA_TRANSFER_PERSISTENCE');
    }
  };
  testDb.bankTransfers.hook('creating', contraCrashHook);

  let contraErrorCaught = false;
  try {
    await executeContraTransferTransaction({
      fromAccountId: bankAccId,
      toAccountId: cashAccId,
      amount: 25000,
      narration: 'নগদ উত্তোলন কন্ট্রা',
      currentUserId: 'usr_atomicity_tester',
      idempotencyKey: 'idem_contra_crash_001',
      dbInstance: testDb
    });
  } catch (err: any) {
    if (err.message?.includes('SIMULATED_CRASH_DURING_CONTRA_TRANSFER_PERSISTENCE')) {
      contraErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert(contraErrorCaught, 'Simulated crash during contra transfer persistence was triggered');

  // Verify ATOMICITY: NOT COMMITTED
  const postCrashContraCash = await testDb.cashBankAccounts.get(cashAccId);
  const postCrashContraBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postCrashContraBank?.currentBalance === preContraBank?.currentBalance, 'NOT COMMITTED: Source bank account balance NOT deducted (remains ৳112,500)');
  assert(postCrashContraCash?.currentBalance === preContraCash?.currentBalance, 'NOT COMMITTED: Destination cash account balance NOT credited (remains ৳50,000)');
  assert(await testDb.bankTransfers.count() === preContraTransfers, 'NOT COMMITTED: No bank transfer record saved');
  assert(await testDb.journalEntries.count() === preContraJournals, 'NOT COMMITTED: No orphan contra journal entry saved');

  // Disarm and execute normal contra transfer: COMPLETE
  simulateContraCrash = false;
  console.log('  Disarming failure hook and re-attempting contra transfer...');
  const successfulContra = await executeContraTransferTransaction({
    fromAccountId: bankAccId,
    toAccountId: cashAccId,
    amount: 25000,
    narration: 'নগদ উত্তোলন কন্ট্রা',
    currentUserId: 'usr_atomicity_tester',
    idempotencyKey: 'idem_contra_crash_001',
    dbInstance: testDb
  });

  assert(!!successfulContra.voucherNumber && !!successfulContra.journalEntryId, 'COMPLETE: Contra transfer completed cleanly');
  const postSuccessContraCash = await testDb.cashBankAccounts.get(cashAccId);
  const postSuccessContraBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postSuccessContraCash?.currentBalance === 75000, 'COMPLETE: Cash balance received ৳25,000 (now ৳75,000)');
  assert(postSuccessContraBank?.currentBalance === 87500, 'COMPLETE: Bank balance reduced by ৳25,000 (now ৳87,500)');
  assert(await testDb.bankTransfers.count() === 1, 'COMPLETE: Exactly 1 bank transfer record saved');

  // Unsubscribe hook
  testDb.bankTransfers.hook('creating').unsubscribe(contraCrashHook);

  // --------------------------------------------------------------------------
  // SCENARIO 5: INTERRUPTED LOAN REPAYMENT (FAILURE MID-FLIGHT)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 5: Interrupted Loan Repayment (Failure mid-flight) ---');

  // First create a clean loan: ৳100,000
  const loanRes = await executeLoanTransaction(
    {
      lenderName: 'বাংলাদেশ কৃষি ব্যাংক',
      principal: 100000,
      interestRate: 0,
      annualInterestRatePercent: 0,
      tenureMonths: 10,
      targetAccountId: bankAccId,
      currentUserId: 'usr_atomicity_tester',
      loanType: 'BANK'
    },
    testDb
  );
  assert(!!loanRes.loan?.id, 'Baseline loan initialized for repayment test');
  const activeLoanId = loanRes.loan.id;

  const preRepayBank = await testDb.cashBankAccounts.get(bankAccId);
  const preRepayLoan = await testDb.loans.get(activeLoanId);
  const preRepayJournals = await testDb.journalEntries.count();

  // Hook loans.updating to simulate crash
  let simulateRepayCrash = true;
  const repayCrashHook = function () {
    if (simulateRepayCrash) {
      throw new Error('SIMULATED_CRASH_DURING_LOAN_REPAYMENT_UPDATE');
    }
  };
  testDb.loans.hook('updating', repayCrashHook);

  let repayErrorCaught = false;
  try {
    await executeLoanRepaymentTransaction(
      {
        loanId: activeLoanId,
        sourceAccountId: bankAccId,
        principalAmount: 10000,
        interestAmount: 0,
        currentUserId: 'usr_atomicity_tester',
        idempotencyKey: 'idem_repay_crash_001'
      },
      testDb
    );
  } catch (err: any) {
    if (err.message?.includes('SIMULATED_CRASH_DURING_LOAN_REPAYMENT_UPDATE')) {
      repayErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert(repayErrorCaught, 'Simulated crash during loan repayment was triggered');

  // Verify ATOMICITY: NOT COMMITTED
  const postCrashRepayBank = await testDb.cashBankAccounts.get(bankAccId);
  const postCrashRepayLoan = await testDb.loans.get(activeLoanId);
  assert(postCrashRepayBank?.currentBalance === preRepayBank?.currentBalance, 'NOT COMMITTED: Bank balance NOT deducted for repayment');
  assert(postCrashRepayLoan?.remainingPrincipal === preRepayLoan?.remainingPrincipal, 'NOT COMMITTED: Loan remaining principal NOT deducted (remains ৳100,000)');
  assert(await testDb.journalEntries.count() === preRepayJournals, 'NOT COMMITTED: No orphan repayment journal entry created');

  // Disarm and execute normal loan repayment: COMPLETE
  simulateRepayCrash = false;
  console.log('  Disarming failure hook and re-attempting loan repayment...');
  const successfulRepay = await executeLoanRepaymentTransaction(
    {
      loanId: activeLoanId,
      sourceAccountId: bankAccId,
      principalAmount: 10000,
      interestAmount: 0,
      currentUserId: 'usr_atomicity_tester',
      idempotencyKey: 'idem_repay_crash_001'
    },
    testDb
  );

  assert(!!successfulRepay.journalEntryId && !!successfulRepay.updatedLoan, 'COMPLETE: Loan repayment completed cleanly');
  const postSuccessRepayBank = await testDb.cashBankAccounts.get(bankAccId);
  const postSuccessRepayLoan = await testDb.loans.get(activeLoanId);
  assert(postSuccessRepayBank?.currentBalance === (preRepayBank?.currentBalance || 0) - 10000, 'COMPLETE: Bank balance deducted by exactly ৳10,000');
  assert(postSuccessRepayLoan?.remainingPrincipal === 90000, 'COMPLETE: Loan remaining principal reduced to ৳90,000');

  // Unsubscribe hook
  testDb.loans.hook('updating').unsubscribe(repayCrashHook);

  // --------------------------------------------------------------------------
  // SCENARIO 6: INTERRUPTED ADVANCE PAYMENT (FAILURE MID-FLIGHT)
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 6: Interrupted Advance Payment (Failure mid-flight) ---');

  const preAdvBank = await testDb.cashBankAccounts.get(bankAccId);
  const preAdvJournals = await testDb.journalEntries.count();
  const preAdvCount = await testDb.advancePayments.count();

  // Hook advancePayments.creating to simulate crash
  let simulateAdvCrash = true;
  const advCrashHook = function () {
    if (simulateAdvCrash) {
      throw new Error('SIMULATED_CRASH_DURING_ADVANCE_PAYMENT_WRITE');
    }
  };
  testDb.advancePayments.hook('creating', advCrashHook);

  let advErrorCaught = false;
  try {
    await executeAdvancePaymentTransaction(
      {
        party: custParty,
        partyId: custParty.id,
        amount: 20000,
        direction: 'RECEIVED',
        paymentMethod: 'BANK',
        bankAccountId: bankAccId,
        narration: 'পরবর্তী চালানের অগ্রিম বুকিং',
        currentUserId: 'usr_atomicity_tester',
        idempotencyKey: 'idem_adv_crash_001'
      },
      testDb
    );
  } catch (err: any) {
    if (err.message?.includes('SIMULATED_CRASH_DURING_ADVANCE_PAYMENT_WRITE')) {
      advErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert(advErrorCaught, 'Simulated crash during advance payment write was triggered');

  // Verify ATOMICITY: NOT COMMITTED
  const postCrashAdvBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postCrashAdvBank?.currentBalance === preAdvBank?.currentBalance, 'NOT COMMITTED: Bank balance NOT credited for advance');
  assert(await testDb.advancePayments.count() === preAdvCount, 'NOT COMMITTED: No advance record saved in advancePayments');
  assert(await testDb.journalEntries.count() === preAdvJournals, 'NOT COMMITTED: No orphan advance journal saved');

  // Disarm and execute normal advance payment: COMPLETE
  simulateAdvCrash = false;
  console.log('  Disarming failure hook and re-attempting advance payment...');
  const successfulAdv = await executeAdvancePaymentTransaction(
    {
      party: custParty,
      partyId: custParty.id,
      amount: 20000,
      direction: 'RECEIVED',
      paymentMethod: 'BANK',
      bankAccountId: bankAccId,
      narration: 'পরবর্তী চালানের অগ্রিম বুকিং',
      currentUserId: 'usr_atomicity_tester',
      idempotencyKey: 'idem_adv_crash_001'
    },
    testDb
  );

  assert(!!successfulAdv.advancePayment && !!successfulAdv.journalEntryId, 'COMPLETE: Advance payment completed cleanly');
  const postSuccessAdvBank = await testDb.cashBankAccounts.get(bankAccId);
  assert(postSuccessAdvBank?.currentBalance === (preAdvBank?.currentBalance || 0) + 20000, 'COMPLETE: Bank balance credited by ৳20,000');
  assert(await testDb.advancePayments.count() === 1, 'COMPLETE: Exactly 1 advance payment record in table');

  // Unsubscribe hook
  testDb.advancePayments.hook('creating').unsubscribe(advCrashHook);

  // --------------------------------------------------------------------------
  // SCENARIO 7: OVERALL INTEGRITY AND TRIAL BALANCE FINAL VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- SCENARIO 7: Overall Accounting Consistency & Trial Balance Invariants ---');

  // 1. Verify every completed sale has an associated journal
  const allSales = await testDb.sales.toArray();
  for (const s of allSales) {
    assert(!!s.journalEntryId, `Sale ${s.invoiceNumber} has valid journalEntryId`);
    const j = await testDb.journalEntries.get(s.journalEntryId!);
    assert(!!j, `Journal entry for sale ${s.invoiceNumber} exists in journalEntries`);
  }

  // 2. Verify every completed purchase has an associated journal
  const allPurchases = await testDb.purchases.toArray();
  for (const p of allPurchases) {
    assert(!!p.journalEntryId, `Purchase ${p.invoiceNumber} has valid journalEntryId`);
    const j = await testDb.journalEntries.get(p.journalEntryId!);
    assert(!!j, `Journal entry for purchase ${p.invoiceNumber} exists in journalEntries`);
  }

  // 3. Verify every stock movement references a valid transaction
  const allMovements = await testDb.stockMovements.toArray();
  assert(allMovements.length === 2, 'Exactly 2 stock movements exist (1 sale OUT + 1 purchase IN)');
  for (const sm of allMovements) {
    assert(!!sm.referenceId, `Stock movement ${sm.id} has referenceId`);
    if (sm.movementType === 'SALE') {
      const sale = (await testDb.sales.get(sm.referenceId!)) || (await testDb.sales.where('invoiceNumber').equals(sm.referenceId!).first());
      assert(!!sale, `Sale stock movement references valid sale ${sm.referenceId}`);
    } else if (sm.movementType === 'PURCHASE') {
      const pur = (await testDb.purchases.get(sm.referenceId!)) || (await testDb.purchases.where('invoiceNumber').equals(sm.referenceId!).first());
      assert(!!pur, `Purchase stock movement references valid purchase ${sm.referenceId}`);
    }
  }

  // 4. Verify Trial Balance is strictly balanced
  const finalTB = await generateTrialBalance(undefined, testDb);
  assert(finalTB.isBalanced, `Final Trial Balance is strictly balanced (Difference: ${finalTB.difference})`);
  assert(finalTB.difference === 0, 'Final Trial Balance discrepancy is strictly 0');
  assert(finalTB.totalDebit === finalTB.totalCredit, `Final TB totalDebit (৳${finalTB.totalDebit}) === totalCredit (৳${finalTB.totalCredit})`);

  // --------------------------------------------------------------------------
  // 8. Clean Up Isolated Test Database
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Cleaning Up Isolated Test Database ---');
  await testDb.delete();
  console.log(`  Isolated test database "${isolatedDbName}" deleted completely. Zero persistent artifacts remain.`);

  console.log('\n================================================================');
  console.log(`ALL INTERRUPTED TRANSACTION SAFETY CHECKS PASSED! (${result.passed}/${result.total}) 🎉`);
  console.log('================================================================');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testInterruptedTransactionSafety')) {
  runInterruptedTransactionSafetyTests()
    .then((r) => process.exit(r.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Interrupted transaction safety test failed:', err);
      process.exit(1);
    });
}
