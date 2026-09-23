import { createMockAgroDatabase } from './regressionTests';
import { executeContraTransferTransaction } from '../services/transactionService';
import { reverseTransaction } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export async function runTaskB6Tests() {
  console.log('--- Starting Task B6 Contra Transfer Record Tests ---');

  const testUserId = 'test_user_b6';

  // 1. Setup mock DB
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Cash account (1010)
  await mDb.cashBankAccounts.put({
    id: 'cash-acc-1',
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 50000,
    synced: false
  });

  // Setup Bank account (1030)
  await mDb.cashBankAccounts.put({
    id: 'bank-acc-1',
    accountName: 'Sonali Bank A/C',
    name: 'Sonali Bank A/C',
    accountType: 'BANK',
    currentBalance: 10000,
    synced: false
  });

  // TEST 1: Execute Cash to Bank Contra Transfer (Creation of new bankTransfers record)
  console.log('Test 1: Executing Cash to Bank Contra Transfer...');
  const res1 = await executeContraTransferTransaction({
    fromAccountId: 'cash-acc-1',
    toAccountId: 'bank-acc-1',
    amount: 15000,
    narration: 'Deposit cash to bank',
    currentUserId: testUserId,
    dbInstance: mDb
  });

  if (!res1.voucherNumber || !res1.journalEntryId) {
    throw new Error('Test 1 Failed: Missing voucherNumber or journalEntryId in response!');
  }
  console.log('Created voucher:', res1.voucherNumber, 'Journal ID:', res1.journalEntryId);

  // Verify journal entry & GL treatment
  const jEntry1 = await mDb.journalEntries.get(res1.journalEntryId);
  if (!jEntry1) {
    throw new Error('Test 1 Failed: Journal entry not found in database!');
  }
  if (jEntry1.voucherType !== 'CONTRA') {
    throw new Error(`Test 1 Failed: Expected voucherType CONTRA, got ${jEntry1.voucherType}`);
  }
  // Check GL lines: Debit 1030 (Bank), Credit 1010 (Cash)
  const debitLine = jEntry1.lines.find((l: any) => l.debit > 0);
  const creditLine = jEntry1.lines.find((l: any) => l.credit > 0);
  if (!debitLine || debitLine.accountCode !== '1030' || debitLine.debit !== 15000) {
    throw new Error(`Test 1 Failed: Expected debit 1030 of 15000, got ${JSON.stringify(debitLine)}`);
  }
  if (!creditLine || creditLine.accountCode !== '1010' || creditLine.credit !== 15000) {
    throw new Error(`Test 1 Failed: Expected credit 1010 of 15000, got ${JSON.stringify(creditLine)}`);
  }

  // Check account balances
  const cashAcc1 = await mDb.cashBankAccounts.get('cash-acc-1');
  const bankAcc1 = await mDb.cashBankAccounts.get('bank-acc-1');
  if (cashAcc1.currentBalance !== 35000) {
    throw new Error(`Test 1 Failed: Expected cash balance 35000, got ${cashAcc1.currentBalance}`);
  }
  if (bankAcc1.currentBalance !== 25000) {
    throw new Error(`Test 1 Failed: Expected bank balance 25000, got ${bankAcc1.currentBalance}`);
  }

  // Verify bankTransfers operational record
  const allTransfers1 = await mDb.bankTransfers.toArray();
  console.log(`Found ${allTransfers1.length} bankTransfers records`);
  if (allTransfers1.length !== 1) {
    throw new Error(`Test 1 Failed: Expected 1 bankTransfers record, found ${allTransfers1.length}`);
  }
  const btRecord1 = allTransfers1[0];
  if (btRecord1.journalEntryId !== res1.journalEntryId) {
    throw new Error(`Test 1 Failed: bankTransfer.journalEntryId (${btRecord1.journalEntryId}) !== ${res1.journalEntryId}`);
  }
  if (btRecord1.voucherNumber !== res1.voucherNumber) {
    throw new Error(`Test 1 Failed: bankTransfer.voucherNumber (${btRecord1.voucherNumber}) !== ${res1.voucherNumber}`);
  }
  if (btRecord1.fromAccountId !== 'cash-acc-1') {
    throw new Error(`Test 1 Failed: fromAccountId mismatch: ${btRecord1.fromAccountId}`);
  }
  if (btRecord1.toAccountId !== 'bank-acc-1') {
    throw new Error(`Test 1 Failed: toAccountId mismatch: ${btRecord1.toAccountId}`);
  }
  if (btRecord1.amount !== 15000) {
    throw new Error(`Test 1 Failed: amount mismatch: ${btRecord1.amount}`);
  }
  if (btRecord1.type !== 'CASH_TO_BANK') {
    throw new Error(`Test 1 Failed: expected type CASH_TO_BANK, got ${btRecord1.type}`);
  }
  console.log('✓ Test 1 Passed: Bank transfer operational record created and linked successfully.');

  // TEST 2: Update existing bankTransfers record when bankTransferId is provided
  console.log('Test 2: Testing update of pre-existing bankTransfers record...');
  const existingBtId = 'bt_pre_existing_1';
  await mDb.bankTransfers.put({
    id: existingBtId,
    date: '2026-04-10',
    fromAccountId: 'bank-acc-1',
    fromAccountName: 'Sonali Bank A/C',
    toAccountId: 'cash-acc-1',
    toAccountName: 'Main Cash Drawer',
    amount: 5000,
    transferFee: 20,
    reference: 'REF-DRAFT',
    type: 'BANK_TO_CASH',
    status: 'DRAFT',
    synced: false
  });

  const res2 = await executeContraTransferTransaction({
    bankTransferId: existingBtId,
    fromAccountId: 'bank-acc-1',
    toAccountId: 'cash-acc-1',
    amount: 5000,
    narration: 'Withdraw cash from bank',
    currentUserId: testUserId,
    dbInstance: mDb
  });

  const updatedBt = await mDb.bankTransfers.get(existingBtId);
  if (!updatedBt) {
    throw new Error('Test 2 Failed: Pre-existing bank transfer not found!');
  }
  if (updatedBt.journalEntryId !== res2.journalEntryId) {
    throw new Error(`Test 2 Failed: Updated record missing journalEntryId!`);
  }
  if (updatedBt.voucherNumber !== res2.voucherNumber) {
    throw new Error(`Test 2 Failed: Updated record missing voucherNumber!`);
  }
  if (updatedBt.fromAccountId !== 'bank-acc-1' || updatedBt.toAccountId !== 'cash-acc-1') {
    throw new Error('Test 2 Failed: Account link mismatch on updated record!');
  }
  console.log('✓ Test 2 Passed: Pre-existing bankTransfers record updated and linked properly.');

  // TEST 3: Reversal of contra transfer
  console.log('Test 3: Testing reversal of contra transfer and operational record update...');
  await reverseTransaction(res1.journalEntryId, testUserId, undefined, mDb);

  const reversedBt = await mDb.bankTransfers.get(btRecord1.id);
  if (reversedBt.status !== 'REVERSED') {
    throw new Error(`Test 3 Failed: Expected bankTransfer status REVERSED, got ${reversedBt.status}`);
  }
  if (!reversedBt.reversedBy) {
    throw new Error('Test 3 Failed: Expected reversedBy to be set on bankTransfer record!');
  }

  // Account balances after reversal should be restored to initial
  const cashAccAfterRev = await mDb.cashBankAccounts.get('cash-acc-1');
  const bankAccAfterRev = await mDb.cashBankAccounts.get('bank-acc-1');
  // Initial cash: 50000 - 15000 + 5000 + 15000 (reversal of #1) = 55000
  // Initial bank: 10000 + 15000 - 5000 - 15000 (reversal of #1) = 5000
  if (cashAccAfterRev.currentBalance !== 55000) {
    throw new Error(`Test 3 Failed: Expected cash balance 55000, got ${cashAccAfterRev.currentBalance}`);
  }
  if (bankAccAfterRev.currentBalance !== 5000) {
    throw new Error(`Test 3 Failed: Expected bank balance 5000, got ${bankAccAfterRev.currentBalance}`);
  }
  console.log('✓ Test 3 Passed: Reversal updated operational record status and restored balances.');

  console.log('--- ALL TASK B6 TESTS PASSED ---');
  return true;
}

if (process.argv[1]?.includes('testTaskB6ContraTransferRecord')) {
  runTaskB6Tests()
    .then(() => {
      console.log('Task B6 tests finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Task B6 tests failed:', err);
      process.exit(1);
    });
}
