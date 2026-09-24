import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { executeContraTransferTransaction } from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export async function runTaskB7Tests() {
  console.log('--- Starting Task B7 Contra Transfer Duplicate Protection Tests ---');

  const testUserId = 'test_user_b7';

  // 1. Setup mock DB
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Cash account (1010)
  await mDb.cashBankAccounts.put({
    id: 'cash-b7-1',
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 50000,
    synced: false
  });

  // Setup Bank account (1030)
  await mDb.cashBankAccounts.put({
    id: 'bank-b7-1',
    accountName: 'City Bank A/C',
    name: 'City Bank A/C',
    accountType: 'BANK',
    currentBalance: 20000,
    synced: false
  });

  // ----------------------------------------------------
  // TEST 1: First contra transfer with idempotencyKey
  // ----------------------------------------------------
  console.log('Test 1: Executing initial contra transfer with idempotencyKey...');
  const key1 = 'idemp_contra_b7_001';
  const res1 = await executeContraTransferTransaction({
    fromAccountId: 'cash-b7-1',
    toAccountId: 'bank-b7-1',
    amount: 10000,
    narration: 'Transfer 10k to bank',
    currentUserId: testUserId,
    idempotencyKey: key1,
    dbInstance: mDb
  });

  if (!res1.voucherNumber || !res1.journalEntryId) {
    throw new Error('Test 1 Failed: Initial transfer failed to return voucherNumber or journalEntryId');
  }

  const initialJournalsCount = (await mDb.journalEntries.toArray()).length;
  const initialTransfersCount = (await mDb.bankTransfers.toArray()).length;
  const initialCashBal = (await mDb.cashBankAccounts.get('cash-b7-1')).currentBalance;
  const initialBankBal = (await mDb.cashBankAccounts.get('bank-b7-1')).currentBalance;

  if (initialJournalsCount !== 1) {
    throw new Error(`Test 1 Failed: Expected 1 journal entry, got ${initialJournalsCount}`);
  }
  if (initialTransfersCount !== 1) {
    throw new Error(`Test 1 Failed: Expected 1 bank transfer record, got ${initialTransfersCount}`);
  }
  if (initialCashBal !== 40000) {
    throw new Error(`Test 1 Failed: Expected cash balance 40000, got ${initialCashBal}`);
  }
  if (initialBankBal !== 30000) {
    throw new Error(`Test 1 Failed: Expected bank balance 30000, got ${initialBankBal}`);
  }
  console.log('✓ Test 1 Passed: Initial contra transfer executed successfully.');

  // ----------------------------------------------------
  // TEST 2: Retry with SAME idempotencyKey MUST BE REJECTED
  // ----------------------------------------------------
  console.log('Test 2: Retrying transfer with same idempotencyKey...');
  let retryKeyFailed = false;
  try {
    await executeContraTransferTransaction({
      fromAccountId: 'cash-b7-1',
      toAccountId: 'bank-b7-1',
      amount: 10000,
      narration: 'Retry duplicate transfer 10k',
      currentUserId: testUserId,
      idempotencyKey: key1,
      dbInstance: mDb
    });
  } catch (err: any) {
    retryKeyFailed = true;
    console.log('Caught expected duplicate error:', err.message);
    if (!err.message.includes('ডুপ্লিকেট') && !err.message.includes('Duplicate')) {
      throw new Error(`Test 2 Failed: Error message does not indicate duplicate prevented: ${err.message}`);
    }
  }

  if (!retryKeyFailed) {
    throw new Error('Test 2 Failed: Duplicate contra transfer retry with same idempotencyKey was NOT rejected!');
  }

  // Verify:
  // - A retry must not create second journal
  // - A retry must not create second cash movement
  // - A retry must not create second bankTransfers record
  const journalsAfterRetry1 = (await mDb.journalEntries.toArray()).length;
  const transfersAfterRetry1 = (await mDb.bankTransfers.toArray()).length;
  const cashAfterRetry1 = (await mDb.cashBankAccounts.get('cash-b7-1')).currentBalance;
  const bankAfterRetry1 = (await mDb.cashBankAccounts.get('bank-b7-1')).currentBalance;

  if (journalsAfterRetry1 !== 1) {
    throw new Error(`Test 2 Failed: Second journal was created! Count is ${journalsAfterRetry1}`);
  }
  if (transfersAfterRetry1 !== 1) {
    throw new Error(`Test 2 Failed: Second bankTransfers record was created! Count is ${transfersAfterRetry1}`);
  }
  if (cashAfterRetry1 !== 40000) {
    throw new Error(`Test 2 Failed: Second cash movement occurred! Cash balance is ${cashAfterRetry1}`);
  }
  if (bankAfterRetry1 !== 30000) {
    throw new Error(`Test 2 Failed: Second bank cash movement occurred! Bank balance is ${bankAfterRetry1}`);
  }
  console.log('✓ Test 2 Passed: Duplicate retry with same idempotencyKey prevented second journal, cash movement, and bankTransfers record.');

  // ----------------------------------------------------
  // TEST 3: Duplicate protection with explicit target ID
  // ----------------------------------------------------
  console.log('Test 3: Testing duplicate protection with explicit bankTransferId...');
  const targetBtId = 'bt_b7_custom_unique_99';
  const res3 = await executeContraTransferTransaction({
    bankTransferId: targetBtId,
    fromAccountId: 'cash-b7-1',
    toAccountId: 'bank-b7-1',
    amount: 5000,
    narration: 'Transfer with explicit ID',
    currentUserId: testUserId,
    dbInstance: mDb
  });

  if (res3.bankTransferId !== targetBtId) {
    throw new Error(`Test 3 Failed: Expected transfer ID ${targetBtId}, got ${res3.bankTransferId}`);
  }

  const journalsCount3 = (await mDb.journalEntries.toArray()).length;
  const transfersCount3 = (await mDb.bankTransfers.toArray()).length;
  const cashBal3 = (await mDb.cashBankAccounts.get('cash-b7-1')).currentBalance;
  const bankBal3 = (await mDb.cashBankAccounts.get('bank-b7-1')).currentBalance;

  if (journalsCount3 !== 2) throw new Error('Expected 2 journals before ID retry');
  if (transfersCount3 !== 2) throw new Error('Expected 2 bankTransfers before ID retry');
  if (cashBal3 !== 35000) throw new Error('Expected cash balance 35000');
  if (bankBal3 !== 35000) throw new Error('Expected bank balance 35000');

  // Attempt duplicate call with same target ID
  let retryIdFailed = false;
  try {
    await executeContraTransferTransaction({
      bankTransferId: targetBtId,
      fromAccountId: 'cash-b7-1',
      toAccountId: 'bank-b7-1',
      amount: 5000,
      narration: 'Retry transfer with same explicit ID',
      currentUserId: testUserId,
      dbInstance: mDb
    });
  } catch (err: any) {
    retryIdFailed = true;
    console.log('Caught expected duplicate ID error:', err.message);
  }

  if (!retryIdFailed) {
    throw new Error('Test 3 Failed: Duplicate contra transfer retry with same ID was NOT rejected!');
  }

  const journalsAfterRetry3 = (await mDb.journalEntries.toArray()).length;
  const transfersAfterRetry3 = (await mDb.bankTransfers.toArray()).length;
  const cashAfterRetry3 = (await mDb.cashBankAccounts.get('cash-b7-1')).currentBalance;
  const bankAfterRetry3 = (await mDb.cashBankAccounts.get('bank-b7-1')).currentBalance;

  if (journalsAfterRetry3 !== 2) {
    throw new Error(`Test 3 Failed: Second journal created on ID retry! Count: ${journalsAfterRetry3}`);
  }
  if (transfersAfterRetry3 !== 2) {
    throw new Error(`Test 3 Failed: Second bankTransfers record created on ID retry! Count: ${transfersAfterRetry3}`);
  }
  if (cashAfterRetry3 !== 35000) {
    throw new Error(`Test 3 Failed: Second cash movement occurred on ID retry! Cash balance: ${cashAfterRetry3}`);
  }
  if (bankAfterRetry3 !== 35000) {
    throw new Error(`Test 3 Failed: Second bank movement occurred on ID retry! Bank balance: ${bankAfterRetry3}`);
  }
  console.log('✓ Test 3 Passed: Duplicate retry with same target ID rejected without duplicate records.');

  // ----------------------------------------------------
  // TEST 4: Duplicate protection with explicit reference
  // ----------------------------------------------------
  console.log('Test 4: Testing duplicate protection with explicit reference...');
  const ref4 = 'REF-TRANSFER-2026-B7';
  await executeContraTransferTransaction({
    reference: ref4,
    fromAccountId: 'cash-b7-1',
    toAccountId: 'bank-b7-1',
    amount: 2000,
    narration: 'Transfer with explicit reference',
    currentUserId: testUserId,
    dbInstance: mDb
  });

  let retryRefFailed = false;
  try {
    await executeContraTransferTransaction({
      reference: ref4,
      fromAccountId: 'cash-b7-1',
      toAccountId: 'bank-b7-1',
      amount: 2000,
      narration: 'Duplicate retry with same reference',
      currentUserId: testUserId,
      dbInstance: mDb
    });
  } catch (err: any) {
    retryRefFailed = true;
    console.log('Caught expected duplicate reference error:', err.message);
  }

  if (!retryRefFailed) {
    throw new Error('Test 4 Failed: Duplicate contra transfer with same reference was NOT rejected!');
  }
  console.log('✓ Test 4 Passed: Duplicate retry with same reference rejected.');

  console.log('--- ALL TASK B7 TESTS PASSED SUCCESSFULLY! ---');
  return true;
}

if (process.argv[1]?.includes('testTaskB7ContraTransferDuplicateProtection')) {
  runTaskB7Tests()
    .then(() => {
      console.log('Task B7 tests finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Task B7 tests failed:', err);
      process.exit(1);
    });
}
