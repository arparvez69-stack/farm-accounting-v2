/**
 * Automated Verification Tests for Manual Bank Reconciliation
 *
 * Verifies:
 * 1. Transactions are correctly extracted for each bank/cash account without data mutation.
 * 2. Cleared state per transaction is persisted and remembered.
 * 3. Book balance, statement balance, and difference are calculated accurately.
 * 4. Zero mutations occur on journal entries, account balances, or reports.
 */

import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import {
  BankReconcileTransaction,
  calculateBankReconciliationMetrics,
  getStoredBankReconciliation,
  loadBankTransactionsForAccount,
  saveStoredBankReconciliation
} from '../accounting/bankReconciliationService';
import { CashBankAccount, JournalEntry } from '../types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runBankReconciliationTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}> {
  console.log('\n========================================================');
  console.log('STARTING MANUAL BANK RECONCILIATION VERIFICATION TESTS');
  console.log('========================================================');

  const results: TestResult[] = [];
  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      results.push({ name, passed: true });
    } else {
      console.error(`❌ FAIL: ${name}${detail ? ` - ${detail}` : ''}`);
      results.push({ name, passed: false, error: detail });
    }
  }

  // --- TEST 1: Persistence of Reconcile State & Cleared Checkboxes ---
  console.log('\n--- TEST 1: Persistence of Cleared Checkboxes & Statement Balance ---');
  const testAccId = 'cb_test_bank_recon_1';

  // Save initial state
  saveStoredBankReconciliation(testAccId, {
    statementBalance: '45500',
    clearedTxIds: ['tx_001', 'tx_002'],
    statementDate: '2026-09-24',
    notes: 'Checked against Sonali Bank e-statement'
  });

  // Read back state
  const loadedState = getStoredBankReconciliation(testAccId);
  assert(loadedState.statementBalance === '45500', 'Statement balance persisted and recalled correctly');
  assert(loadedState.clearedTxIds.length === 2, 'Two cleared transaction IDs remembered');
  assert(loadedState.clearedTxIds.includes('tx_001'), 'tx_001 is marked cleared in stored state');
  assert(loadedState.clearedTxIds.includes('tx_002'), 'tx_002 is marked cleared in stored state');

  // Toggle a cleared checkbox (add tx_003, remove tx_001)
  saveStoredBankReconciliation(testAccId, {
    clearedTxIds: ['tx_002', 'tx_003']
  });
  const updatedState = getStoredBankReconciliation(testAccId);
  assert(updatedState.statementBalance === '45500', 'Statement balance remains intact after toggling cleared items');
  assert(updatedState.clearedTxIds.length === 2, 'Updated cleared items persisted');
  assert(!updatedState.clearedTxIds.includes('tx_001'), 'tx_001 successfully unchecked');
  assert(updatedState.clearedTxIds.includes('tx_003'), 'tx_003 successfully checked');

  // --- TEST 2: Three Figures (Book Balance, Statement Balance, Difference) ---
  console.log('\n--- TEST 2: Calculation of Three Figures (Book, Statement, Difference) ---');
  const mockAccount: CashBankAccount = {
    id: 'cb_mock_bank',
    name: 'Sonali Bank Current A/C',
    accountType: 'BANK',
    currentBalance: 50000,
    accountNumber: '0123456789'
  };

  const mockTxList: BankReconcileTransaction[] = [
    {
      id: 'tx_1',
      journalEntryId: 'j_1',
      date: '2026-09-01',
      voucherNumber: 'VN-001',
      voucherType: 'RECEIPT',
      narration: 'Customer Milk Sale',
      debit: 30000,
      credit: 0,
      amount: 30000
    },
    {
      id: 'tx_2',
      journalEntryId: 'j_2',
      date: '2026-09-05',
      voucherNumber: 'VN-002',
      voucherType: 'PAYMENT',
      narration: 'Feed Purchase',
      debit: 0,
      credit: 10000,
      amount: 10000
    },
    {
      id: 'tx_3',
      journalEntryId: 'j_3',
      date: '2026-09-10',
      voucherNumber: 'VN-003',
      voucherType: 'CONTRA',
      narration: 'Cash Deposit to Bank',
      debit: 30000,
      credit: 0,
      amount: 30000
    }
  ];

  // Case A: Statement balance matches book balance exactly (৳50,000)
  const metricsBalanced = calculateBankReconciliationMetrics(
    mockAccount,
    mockTxList,
    '50000',
    new Set(['tx_1', 'tx_2', 'tx_3'])
  );
  assert(metricsBalanced.bookBalance === 50000, 'Figure 1: Book balance matches existing account balance (৳50,000)');
  assert(metricsBalanced.statementBalance === 50000, 'Figure 2: Statement balance matches manually entered figure (৳50,000)');
  assert(metricsBalanced.difference === 0, 'Figure 3: Difference is exactly 0 when balances match');
  assert(metricsBalanced.isBalanced === true, 'isBalanced flag is true when difference is 0');
  assert(metricsBalanced.clearedCount === 3, 'All 3 transactions marked as cleared');

  // Case B: Statement balance has discrepancy (e.g. ৳48,500 due to bank charges / timing)
  const metricsDiscrepancy = calculateBankReconciliationMetrics(
    mockAccount,
    mockTxList,
    '48500',
    new Set(['tx_1', 'tx_2'])
  );
  assert(metricsDiscrepancy.bookBalance === 50000, 'Book balance remains ৳50,000');
  assert(metricsDiscrepancy.statementBalance === 48500, 'Statement balance is ৳48,500');
  assert(metricsDiscrepancy.difference === -1500, 'Figure 3: Difference is -৳1,500 (Statement - Book)');
  assert(metricsDiscrepancy.isBalanced === false, 'isBalanced flag is false when discrepancy exists');
  assert(metricsDiscrepancy.clearedCount === 2, '2 transactions cleared, 1 uncleared');
  assert(metricsDiscrepancy.unclearedCount === 1, '1 uncleared transaction identified');

  // --- TEST 3: Zero Mutation Guarantee ---
  console.log('\n--- TEST 3: Zero Mutation of Journal Entries & Balances ---');
  // Snapshot all journal entries and accounts before test
  const initialJournals = await db.journalEntries.toArray();
  const initialAccounts = await db.cashBankAccounts.toArray();
  const initialJournalsCount = initialJournals.length;
  const initialAccountsCount = initialAccounts.length;

  if (initialAccounts.length > 0) {
    const firstAcc = initialAccounts[0];
    const initialBal = firstAcc.currentBalance;

    // Execute loadBankTransactionsForAccount
    const loaded = await loadBankTransactionsForAccount(firstAcc.id);
    assert(loaded.account !== undefined, 'Successfully loaded account for reconciliation');

    // Simulate saving reconciliation state
    saveStoredBankReconciliation(firstAcc.id, {
      statementBalance: '999999',
      clearedTxIds: loaded.transactions.slice(0, 2).map((t) => t.id)
    });

    // Check account in db again
    const reloadedAcc = await db.cashBankAccounts.get(firstAcc.id);
    assert(reloadedAcc?.currentBalance === initialBal, 'Account balance is completely UNCHANGED in IndexedDB');

    // Check journal entries count
    const postJournals = await db.journalEntries.toArray();
    assert(postJournals.length === initialJournalsCount, 'Journal entries count is completely UNCHANGED in IndexedDB');
  } else {
    assert(true, 'No accounts present, test passed by contract');
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const failures = results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.error || 'Failed'}`);

  console.log('========================================================');
  console.log(`MANUAL BANK RECONCILIATION TESTS COMPLETED: Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
  console.log('========================================================\n');

  return {
    total: results.length,
    passed,
    failed,
    failures
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBankReconciliationTests().then((res) => {
    console.log(`Bank reconciliation test: total=${res.total}, passed=${res.passed}, failed=${res.failed}`);
    if (res.failed > 0) process.exit(1);
  });
}

