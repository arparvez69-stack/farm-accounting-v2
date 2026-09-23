import { createMockAgroDatabase } from './regressionTests';
import { reverseTransaction, reverseJournalEntry, getClosedPeriods } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export async function runTaskB5Tests() {
  console.log('--- Starting Task B5 Reversal Closed Period Tests ---');

  const testUserId = 'test_user_b5';

  // 1. Setup mock database
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  await mDb.cashBankAccounts.put({
    id: 'cb-1',
    accountName: 'Main Cash',
    accountType: 'CASH',
    currentBalance: 50000,
    synced: false
  });

  // Create an original transaction in period 2026-03
  await mDb.journalEntries.put({
    id: 'je-march-1',
    voucherNumber: 'JV-2026-03-001',
    voucherType: 'EXPENSE',
    date: '2026-03-15',
    status: 'POSTED',
    lines: [
      { accountId: '5010', accountCode: '5010', accountName: 'General Expense', debit: 1500, credit: 0 },
      { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 0, credit: 1500 }
    ],
    totalDebit: 1500,
    totalCredit: 1500,
    createdBy: testUserId,
    createdAt: '2026-03-15T10:00:00Z'
  });

  // Create another transaction in period 2026-04
  await mDb.journalEntries.put({
    id: 'je-april-1',
    voucherNumber: 'JV-2026-04-001',
    voucherType: 'EXPENSE',
    date: '2026-04-10',
    status: 'POSTED',
    lines: [
      { accountId: '5010', accountCode: '5010', accountName: 'General Expense', debit: 2000, credit: 0 },
      { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 0, credit: 2000 }
    ],
    totalDebit: 2000,
    totalCredit: 2000,
    createdBy: testUserId,
    createdAt: '2026-04-10T10:00:00Z'
  });

  // Set closed period up to 2026-03-31
  await mDb.closedPeriods.put({
    id: 'cp-2026-q1',
    endDate: '2026-03-31',
    closedAt: '2026-04-01T00:00:00Z',
    synced: false
  });

  // TEST 1: Reversal with custom date on or before closed period end date (2026-03-20) MUST fail
  console.log('Test 1: Attempting reversal with date inside closed period (2026-03-20)...');
  let rejectedInside = false;
  try {
    await reverseTransaction('je-march-1', testUserId, '2026-03-20', mDb);
  } catch (err: any) {
    rejectedInside = true;
    console.log('Expected error caught:', err.message);
  }
  if (!rejectedInside) {
    throw new Error('Test 1 Failed: Reversal with date inside closed period was NOT rejected!');
  }

  // Verify no changes made to je-march-1
  const jeMarchAfterFail = await mDb.journalEntries.get('je-march-1');
  if (jeMarchAfterFail.status === 'REVERSED' || jeMarchAfterFail.reversedBy) {
    throw new Error('Test 1 Failed: Original entry was modified despite rejection!');
  }

  // TEST 2: Reversal with custom date exactly on closed period end date (2026-03-31) MUST fail
  console.log('Test 2: Attempting reversal on closed period end date (2026-03-31)...');
  let rejectedExact = false;
  try {
    await reverseTransaction('je-march-1', testUserId, '2026-03-31', mDb);
  } catch (err: any) {
    rejectedExact = true;
    console.log('Expected error caught:', err.message);
  }
  if (!rejectedExact) {
    throw new Error('Test 2 Failed: Reversal on exact closed period end date was NOT rejected!');
  }

  // TEST 3: Reversal of an entry from closed period into an OPEN period (2026-04-05) MUST succeed
  console.log('Test 3: Attempting reversal of closed-period entry into open period (2026-04-05)...');
  const revRes = await reverseTransaction('je-march-1', testUserId, '2026-04-05', mDb);
  if (!revRes.reversal) {
    throw new Error('Test 3 Failed: Reversal result missing reversal entry!');
  }
  if (revRes.reversal.date <= '2026-03-31') {
    throw new Error(`Test 3 Failed: Reversal entry date (${revRes.reversal.date}) is inside closed period!`);
  }
  console.log(`Reversal entry created with open period date: ${revRes.reversal.date}`);

  // TEST 4: Add another closed period up to 2026-04-30
  await mDb.closedPeriods.put({
    id: 'cp-2026-m4',
    endDate: '2026-04-30',
    closedAt: '2026-05-01T00:00:00Z',
    synced: false
  });

  // TEST 5: Attempting reversal in newly closed period (2026-04-15) MUST fail
  console.log('Test 5: Attempting reversal in newly closed period (2026-04-15)...');
  let rejectedNewClosed = false;
  try {
    await reverseTransaction('je-april-1', testUserId, '2026-04-15', mDb);
  } catch (err: any) {
    rejectedNewClosed = true;
    console.log('Expected error caught:', err.message);
  }
  if (!rejectedNewClosed) {
    throw new Error('Test 5 Failed: Reversal in newly closed period was NOT rejected!');
  }

  // TEST 6: Reversal in new open period (2026-05-05) MUST succeed
  console.log('Test 6: Attempting reversal in open period (2026-05-05)...');
  const revRes2 = await reverseTransaction('je-april-1', testUserId, '2026-05-05', mDb);
  if (revRes2.reversal.date !== '2026-05-05') {
    throw new Error(`Test 6 Failed: Reversal entry date is ${revRes2.reversal.date}, expected 2026-05-05`);
  }

  console.log('--- Task B5 Reversal Closed Period Tests PASSED ---');
  return true;
}

if (process.argv[1]?.includes('testTaskB5ReversalClosedPeriod')) {
  runTaskB5Tests()
    .then(() => {
      console.log('Task B5 tests finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Task B5 tests failed:', err);
      process.exit(1);
    });
}
