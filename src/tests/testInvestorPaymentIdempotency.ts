import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorProfitPaymentTransaction,
  executeInvestorCapitalReturnTransaction
} from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export async function runInvestorPaymentIdempotencyTests() {
  console.log('--- Starting Investor Payment Idempotency Tests (Task C8) ---');

  const testUserId = 'test_user_c8';

  // 1. Setup mock DB
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Cash account (1010)
  await mDb.cashBankAccounts.put({
    id: 'cash-c8-1',
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 100000,
    synced: false
  });

  // Setup Bank account (1030)
  await mDb.cashBankAccounts.put({
    id: 'bank-c8-1',
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 200000,
    synced: false
  });

  // Setup Investor
  await mDb.investors.put({
    id: 'inv-c8-1',
    name: 'Rahim Chowdhury',
    phone: '01700000001',
    capitalAmount: 100000,
    capitalContributed: 100000,
    currentCapitalBalance: 100000,
    totalCapitalReturned: 0,
    profitSharingRatio: 40,
    profitPayable: 30000,
    totalProfitPaid: 0,
    status: 'ACTIVE',
    synced: false
  });

  // =========================================================================
  // TEST 1: Initial Profit Payment with idempotencyKey
  // =========================================================================
  console.log('Test 1: Executing initial investor profit payment...');
  const profitIdempKey = 'pay_key_inv_001';
  const payRes1 = await executeInvestorProfitPaymentTransaction(
    {
      investorId: 'inv-c8-1',
      amount: 10000,
      sourceAccountId: 'cash-c8-1',
      paymentDate: '2026-05-10',
      idempotencyKey: profitIdempKey,
      currentUserId: testUserId
    },
    mDb
  );

  if (!payRes1.journalEntryId || payRes1.paidAmount !== 10000 || payRes1.remainingPayable !== 20000) {
    throw new Error('Test 1 Failed: Initial profit payment returned unexpected values');
  }

  const postPayJournalsCount = (await mDb.journalEntries.toArray()).length;
  const postPayCashBal = (await mDb.cashBankAccounts.get('cash-c8-1')).currentBalance;
  const postPayInvestor = await mDb.investors.get('inv-c8-1');

  if (postPayJournalsCount !== 1) {
    throw new Error(`Test 1 Failed: Expected 1 journal entry, got ${postPayJournalsCount}`);
  }
  if (postPayCashBal !== 90000) {
    throw new Error(`Test 1 Failed: Expected cash balance 90000, got ${postPayCashBal}`);
  }
  if (postPayInvestor.profitPayable !== 20000 || postPayInvestor.totalProfitPaid !== 10000) {
    throw new Error(`Test 1 Failed: Investor payable or total paid mismatch`);
  }

  // =========================================================================
  // TEST 2: Duplicate Profit Payment Retry (Idempotency Protection)
  // =========================================================================
  console.log('Test 2: Retrying duplicate profit payment with same idempotencyKey...');
  let duplicatePrevented = false;
  try {
    await executeInvestorProfitPaymentTransaction(
      {
        investorId: 'inv-c8-1',
        amount: 10000,
        sourceAccountId: 'cash-c8-1',
        paymentDate: '2026-05-10',
        idempotencyKey: profitIdempKey,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    duplicatePrevented = true;
    console.log('  -> Duplicate prevented as expected:', err.message);
  }

  if (!duplicatePrevented) {
    throw new Error('Test 2 Failed: Duplicate profit payment was allowed!');
  }

  // Verify NO duplicate journal, NO cash reduction, NO subledger reduction
  const postRetryJournalsCount = (await mDb.journalEntries.toArray()).length;
  const postRetryCashBal = (await mDb.cashBankAccounts.get('cash-c8-1')).currentBalance;
  const postRetryInvestor = await mDb.investors.get('inv-c8-1');

  if (postRetryJournalsCount !== postPayJournalsCount) {
    throw new Error(`Test 2 Failed: Journal entries increased from ${postPayJournalsCount} to ${postRetryJournalsCount}`);
  }
  if (postRetryCashBal !== postPayCashBal) {
    throw new Error(`Test 2 Failed: Cash balance altered from ${postPayCashBal} to ${postRetryCashBal}`);
  }
  if (postRetryInvestor.profitPayable !== postPayInvestor.profitPayable) {
    throw new Error(`Test 2 Failed: Subledger profitPayable altered from ${postPayInvestor.profitPayable} to ${postRetryInvestor.profitPayable}`);
  }

  // =========================================================================
  // TEST 3: Duplicate Profit Payment Retry with paymentReference
  // =========================================================================
  console.log('Test 3: Executing payment with paymentReference and retrying...');
  const payRef = 'REF-PROFIT-2026-002';
  await executeInvestorProfitPaymentTransaction(
    {
      investorId: 'inv-c8-1',
      amount: 5000,
      sourceAccountId: 'cash-c8-1',
      paymentDate: '2026-05-11',
      paymentReference: payRef,
      currentUserId: testUserId
    },
    mDb
  );

  let refDuplicatePrevented = false;
  try {
    await executeInvestorProfitPaymentTransaction(
      {
        investorId: 'inv-c8-1',
        amount: 5000,
        sourceAccountId: 'cash-c8-1',
        paymentDate: '2026-05-11',
        paymentReference: payRef,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    refDuplicatePrevented = true;
    console.log('  -> Duplicate with paymentReference prevented:', err.message);
  }

  if (!refDuplicatePrevented) {
    throw new Error('Test 3 Failed: Duplicate payment with paymentReference was allowed!');
  }

  // Verify journal count is 2
  const countAfterTest3 = (await mDb.journalEntries.toArray()).length;
  if (countAfterTest3 !== 2) {
    throw new Error(`Test 3 Failed: Expected exactly 2 journals, found ${countAfterTest3}`);
  }

  // =========================================================================
  // TEST 4: Initial Capital Return with idempotencyKey & returnReference
  // =========================================================================
  console.log('Test 4: Executing initial investor capital return...');
  const capIdempKey = 'ret_key_inv_001';
  const capRef = 'RET-CAP-2026-001';
  const retRes1 = await executeInvestorCapitalReturnTransaction(
    {
      investorId: 'inv-c8-1',
      amount: 25000,
      sourceAccountId: 'bank-c8-1',
      returnDate: '2026-05-12',
      idempotencyKey: capIdempKey,
      returnReference: capRef,
      currentUserId: testUserId
    },
    mDb
  );

  if (!retRes1.journalEntryId || retRes1.returnedAmount !== 25000) {
    throw new Error('Test 4 Failed: Initial capital return returned unexpected values');
  }

  const postRetJournalsCount = (await mDb.journalEntries.toArray()).length;
  const postRetBankBal = (await mDb.cashBankAccounts.get('bank-c8-1')).currentBalance;
  const postRetInvestor = await mDb.investors.get('inv-c8-1');

  if (postRetJournalsCount !== 3) {
    throw new Error(`Test 4 Failed: Expected 3 journal entries total, got ${postRetJournalsCount}`);
  }
  if (postRetBankBal !== 175000) {
    throw new Error(`Test 4 Failed: Expected bank balance 175000, got ${postRetBankBal}`);
  }
  if (postRetInvestor.currentCapitalBalance !== 75000 || postRetInvestor.totalCapitalReturned !== 25000) {
    throw new Error(`Test 4 Failed: Investor capital balance or total returned mismatch`);
  }

  // =========================================================================
  // TEST 5: Duplicate Capital Return Retry (Idempotency Protection)
  // =========================================================================
  console.log('Test 5: Retrying duplicate capital return with same idempotencyKey...');
  let capDuplicatePrevented = false;
  try {
    await executeInvestorCapitalReturnTransaction(
      {
        investorId: 'inv-c8-1',
        amount: 25000,
        sourceAccountId: 'bank-c8-1',
        returnDate: '2026-05-12',
        idempotencyKey: capIdempKey,
        returnReference: capRef,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    capDuplicatePrevented = true;
    console.log('  -> Duplicate capital return prevented as expected:', err.message);
  }

  if (!capDuplicatePrevented) {
    throw new Error('Test 5 Failed: Duplicate capital return was allowed!');
  }

  // Verify NO duplicate journal, NO cash movement, NO subledger reduction
  const postRetryRetJournalsCount = (await mDb.journalEntries.toArray()).length;
  const postRetryRetBankBal = (await mDb.cashBankAccounts.get('bank-c8-1')).currentBalance;
  const postRetryRetInvestor = await mDb.investors.get('inv-c8-1');

  if (postRetryRetJournalsCount !== postRetJournalsCount) {
    throw new Error(`Test 5 Failed: Journal entries increased from ${postRetJournalsCount} to ${postRetryRetJournalsCount}`);
  }
  if (postRetryRetBankBal !== postRetBankBal) {
    throw new Error(`Test 5 Failed: Bank balance altered from ${postRetBankBal} to ${postRetryRetBankBal}`);
  }
  if (postRetryRetInvestor.currentCapitalBalance !== postRetInvestor.currentCapitalBalance) {
    throw new Error(`Test 5 Failed: Subledger currentCapitalBalance altered`);
  }

  // =========================================================================
  // TEST 6: Concurrent Execution Race Condition Protection (In-memory locks)
  // =========================================================================
  console.log('Test 6: Testing concurrent duplicate profit payments and capital returns...');
  const concurrentKey = 'conc_pay_key_001';
  let concurrentRejectCount = 0;

  const concurrentPromises = [
    executeInvestorProfitPaymentTransaction(
      {
        investorId: 'inv-c8-1',
        amount: 2000,
        sourceAccountId: 'cash-c8-1',
        paymentDate: '2026-05-15',
        idempotencyKey: concurrentKey,
        currentUserId: testUserId
      },
      mDb
    ),
    executeInvestorProfitPaymentTransaction(
      {
        investorId: 'inv-c8-1',
        amount: 2000,
        sourceAccountId: 'cash-c8-1',
        paymentDate: '2026-05-15',
        idempotencyKey: concurrentKey,
        currentUserId: testUserId
      },
      mDb
    )
  ];

  const results = await Promise.allSettled(concurrentPromises);
  const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
  const rejectedCount = results.filter(r => r.status === 'rejected').length;

  if (fulfilledCount !== 1 || rejectedCount !== 1) {
    throw new Error(`Test 6 Failed: Expected 1 fulfilled and 1 rejected, got ${fulfilledCount} fulfilled and ${rejectedCount} rejected`);
  }
  console.log('  -> Concurrent race condition properly blocked 1 duplicate submission');

  console.log('--- ALL Investor Payment Idempotency Tests PASSED Successfully! ---');
  return true;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testInvestorPaymentIdempotency')) {
  runInvestorPaymentIdempotencyTests()
    .then(() => {
      console.log('PASS');
      process.exit(0);
    })
    .catch((err) => {
      console.error('FAILED:', err);
      process.exit(1);
    });
}
