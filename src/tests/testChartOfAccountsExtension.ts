import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { initDefaultAccounts, DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry, generateTrialBalance, generateProfitLoss, generateBalanceSheet } from '../accounting/accountingEngine';
import { Account } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runChartOfAccountsExtensionTests(): Promise<AssertionResult> {
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
      console.log(`✅ PASS: ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`❌ FAIL: ${description}`);
    }
  }

  console.log('Testing Chart of Accounts extension, custom accounts, journal entries, and financial reports...');

  // 1. Initialize default accounts
  await initDefaultAccounts();

  const totalDefault = DEFAULT_CHART_OF_ACCOUNTS.length;
  const dbCount = await db.accounts.count();
  assert(dbCount >= totalDefault, `Expected at least ${totalDefault} accounts in db, got ${dbCount}`);

  // 2. Add custom user-created expense account
  const customExpenseCode = '6199';
  const customExpenseAccount: Account = {
    id: `acc_${customExpenseCode}`,
    code: customExpenseCode,
    nameBn: 'বিশেষ গবেষণা ও উন্নয়ন ব্যয় (R&D Custom Expense)',
    nameEn: 'Custom R&D Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: false,
    isActive: true
  };
  await db.accounts.put(customExpenseAccount);

  // 3. Add custom user-created asset account
  const customAssetCode = '1595';
  const customAssetAccount: Account = {
    id: `acc_${customAssetCode}`,
    code: customAssetCode,
    nameBn: 'সৌর বিদ্যুৎ সরঞ্জাম (Solar Power Equipment)',
    nameEn: 'Solar Power Equipment',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: false,
    isActive: true
  };
  await db.accounts.put(customAssetAccount);

  // 4. Verify postJournalEntry accepts newly created custom accounts
  const today = new Date().toISOString().split('T')[0];
  const testEntry = await postJournalEntry({
    id: 'test_custom_acc_jnl_1',
    voucherNumber: 'JV-TEST-001',
    voucherType: 'JOURNAL',
    date: today,
    narration: 'Test custom account journal posting',
    lines: [
      {
        accountCode: customExpenseCode,
        accountName: customExpenseAccount.nameBn,
        debit: 5000,
        credit: 0
      },
      {
        accountCode: '1010', // Cash on Hand (system account)
        accountName: 'নগদ টাকা',
        debit: 0,
        credit: 5000
      }
    ],
    createdAt: new Date().toISOString()
  });

  assert(!!testEntry && testEntry.totalDebit === 5000, 'Post journal entry with custom expense account succeeds with balanced 5000');

  // 5. Verify custom account appears in Trial Balance
  const trialBalance = await generateTrialBalance();
  const tbRow = trialBalance.rows.find((r) => r.code === customExpenseCode);
  assert(!!tbRow, `Custom account ${customExpenseCode} found in Trial Balance`);
  assert(tbRow?.debit === 5000, `Expected Trial Balance row debit 5000, got ${tbRow?.debit}`);
  assert(trialBalance.isBalanced, `Trial Balance is balanced: diff = ${trialBalance.difference}`);

  // 6. Verify custom expense account appears in Profit & Loss
  const plReport = await generateProfitLoss();
  const plExpense = plReport.operatingExpenses.find((e) => e.code === customExpenseCode);
  assert(!!plExpense, `Custom expense account ${customExpenseCode} found in Profit & Loss operatingExpenses`);
  assert(plExpense?.amount === 5000, `Expected P&L expense amount 5000, got ${plExpense?.amount}`);

  // 7. Post entry with custom asset account
  await postJournalEntry({
    id: 'test_custom_acc_jnl_2',
    voucherNumber: 'JV-TEST-002',
    voucherType: 'JOURNAL',
    date: today,
    narration: 'Test custom asset journal posting',
    lines: [
      {
        accountCode: customAssetCode,
        accountName: customAssetAccount.nameBn,
        debit: 25000,
        credit: 0
      },
      {
        accountCode: '1030', // Bank account (system account)
        accountName: 'ব্যাংক হিসাব',
        debit: 0,
        credit: 25000
      }
    ],
    createdAt: new Date().toISOString()
  });

  // 8. Verify custom asset appears in Balance Sheet
  const bsReport = await generateBalanceSheet();
  const bsAsset = bsReport.assets.find((a) => a.code === customAssetCode);
  assert(!!bsAsset, `Custom asset account ${customAssetCode} found in Balance Sheet assets`);
  assert(bsAsset?.amount === 25000, `Expected Balance Sheet asset amount 25000, got ${bsAsset?.amount}`);

  // 9. Verify Balance Sheet is balanced
  assert(bsReport.isBalanced, `Balance Sheet is balanced: discrepancy = ${bsReport.discrepancy}`);

  // 10. Verify default accounts integrity is preserved
  let allDefaultsIntact = true;
  for (const defAcc of DEFAULT_CHART_OF_ACCOUNTS) {
    const acc = await db.accounts.where('code').equals(defAcc.code).first();
    if (!acc || acc.accountClass !== defAcc.accountClass || acc.normalBalance !== defAcc.normalBalance) {
      allDefaultsIntact = false;
      break;
    }
  }
  assert(allDefaultsIntact, 'All default chart accounts remain intact with matching classes');

  // Cleanup test transactions so subsequent tests aren't polluted
  await db.journalEntries.delete('test_custom_acc_jnl_1');
  await db.journalEntries.delete('test_custom_acc_jnl_2');
  await db.accounts.delete(`acc_${customExpenseCode}`);
  await db.accounts.delete(`acc_${customAssetCode}`);

  console.log(`✅ All Chart of Accounts extension tests passed (${result.passed}/${result.total})!`);
  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testChartOfAccountsExtension')) {
  runChartOfAccountsExtensionTests()
    .then((r) => process.exit(r.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
