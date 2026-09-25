import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  resolveAuthoritativeAccount,
  resolveAccountMetadata,
  generateTrialBalance,
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlowStatement,
  postJournalEntry,
  getGeneralLedger
} from '../accounting/accountingEngine';
import { Account, JournalEntry } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runClassificationConsistencyAuditTests() {
  console.log('====================================================');
  console.log('STARTING B2: CHART OF ACCOUNTS CLASSIFICATION CONSISTENCY AUDIT');
  console.log('====================================================');

  await db.delete();
  await db.open();

  // Seed default chart of accounts
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  // ----------------------------------------------------
  // TEST 1: Preserve all existing valid accounts & default chart
  // ----------------------------------------------------
  console.log('\n--- Test 1: Preserve All Existing Valid Accounts & Default Chart ---');
  const cashAcc = resolveAuthoritativeAccount({ code: '1010' });
  assert(cashAcc.accountClass === 'ASSET', '1010 must be ASSET');
  assert(cashAcc.type === 'ASSET', '1010 type must be ASSET');
  assert(cashAcc.normalBalance === 'DEBIT', '1010 normalBalance must be DEBIT');

  const apAcc = resolveAuthoritativeAccount({ code: '2010' });
  assert(apAcc.accountClass === 'LIABILITY', '2010 must be LIABILITY');
  assert(apAcc.normalBalance === 'CREDIT', '2010 normalBalance must be CREDIT');

  const salesAcc = resolveAuthoritativeAccount({ code: '4010' });
  assert(salesAcc.accountClass === 'REVENUE', '4010 must be REVENUE');
  assert(salesAcc.normalBalance === 'CREDIT', '4010 normalBalance must be CREDIT');

  const feedExpAcc = resolveAuthoritativeAccount({ code: '6010' });
  assert(feedExpAcc.accountClass === 'EXPENSE', '6010 must be EXPENSE');
  assert(feedExpAcc.normalBalance === 'DEBIT', '6010 normalBalance must be DEBIT');

  // Contra accounts in default chart:
  const deprAcc = resolveAuthoritativeAccount({ code: '1590' });
  assert(deprAcc.accountClass === 'ASSET', '1590 must be ASSET');
  assert(deprAcc.normalBalance === 'CREDIT', '1590 contra-asset must be CREDIT normal balance');

  const drawAcc = resolveAuthoritativeAccount({ code: '3040' });
  assert(drawAcc.accountClass === 'EQUITY', '3040 must be EQUITY');
  assert(drawAcc.normalBalance === 'DEBIT', '3040 contra-equity must be DEBIT normal balance');
  console.log('✅ Test 1 Passed: Default chart accounts and canonical contra-accounts correctly preserved.');

  // ----------------------------------------------------
  // TEST 2: Authoritative resolution of conflicting fields
  // ----------------------------------------------------
  console.log('\n--- Test 2: Authoritative Resolution of Conflicting Fields ---');

  // 2a: Conflicting accountClass vs type
  const conflictingAccount: Partial<Account> = {
    id: 'acc_custom_1088',
    code: '1088',
    nameBn: 'পরীক্ষামূলক সম্পদ হিসাব',
    nameEn: 'Experimental Asset Account',
    accountClass: 'ASSET', // Declared ASSET
    type: 'LIABILITY',     // Conflicting type
    normalBalance: 'CREDIT' // Incompatible normal balance for standard asset
  };
  const resolved2a = resolveAuthoritativeAccount(conflictingAccount);
  assert(resolved2a.accountClass === 'ASSET', 'Primary accountClass must win over conflicting type');
  assert(resolved2a.type === 'ASSET', 'Type must be synchronized with authoritative accountClass');
  assert(resolved2a.normalBalance === 'DEBIT', 'Non-contra asset must have authoritative normalBalance: DEBIT');

  // 2b: Missing accountClass, but valid type
  const typeOnlyAccount: Partial<Account> = {
    id: 'acc_custom_6099',
    code: '6099',
    nameBn: 'কাস্টম পরীক্ষা ব্যয়',
    nameEn: 'Custom Test Expense',
    type: 'EXPENSE'
  };
  const resolved2b = resolveAuthoritativeAccount(typeOnlyAccount);
  assert(resolved2b.accountClass === 'EXPENSE', 'accountClass must inherit from valid type');
  assert(resolved2b.type === 'EXPENSE', 'type must remain EXPENSE');
  assert(resolved2b.normalBalance === 'DEBIT', 'EXPENSE normal balance must be DEBIT');

  // 2c: Missing accountClass and type, but parentCode points to an ASSET
  const childAccount: Partial<Account> = {
    id: 'acc_custom_child_1015',
    code: '1015',
    nameBn: 'শাখা ক্যাশ (Branch Cash)',
    nameEn: 'Branch Cash',
    parentCode: '1010'
  };
  const resolved2c = resolveAuthoritativeAccount(childAccount, (code) =>
    DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === code)
  );
  assert(resolved2c.accountClass === 'ASSET', 'Child account must inherit ASSET from parentCode 1010');
  assert(resolved2c.normalBalance === 'DEBIT', 'Child asset must have normalBalance: DEBIT');

  // 2d: Conflicting normalBalance on an EXPENSE account (CREDIT instead of DEBIT)
  const invertedExpense: Partial<Account> = {
    id: 'acc_custom_6188',
    code: '6188',
    nameBn: 'ভুল ব্যালেন্স ব্যয় হিসাব',
    nameEn: 'Erroneous Balance Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'CREDIT' as any // Conflicting normal balance
  };
  const resolved2d = resolveAuthoritativeAccount(invertedExpense);
  assert(resolved2d.accountClass === 'EXPENSE', 'accountClass must be EXPENSE');
  assert(resolved2d.normalBalance === 'DEBIT', 'EXPENSE authoritative normalBalance must be enforced as DEBIT');
  console.log('✅ Test 2 Passed: Conflicting fields resolve strictly through the single authoritative path.');

  // ----------------------------------------------------
  // TEST 3: Unknown / Orphan Accounts Do NOT Default to ASSET or DEBIT
  // ----------------------------------------------------
  console.log('\n--- Test 3: Unknown/Orphan Accounts Resolve as UNKNOWN ---');
  const orphan = resolveAccountMetadata('9999');
  assert((orphan.accountClass as any) === 'UNKNOWN', 'Orphan accountClass must be UNKNOWN');
  assert(orphan.normalBalance === 'UNKNOWN', 'Orphan normalBalance must be UNKNOWN');
  assert((orphan.accountClass as any) !== 'ASSET', 'Orphan must NOT default to ASSET');
  assert(orphan.normalBalance !== 'DEBIT', 'Orphan must NOT default to DEBIT');
  console.log('✅ Test 3 Passed: Unknown/orphan accounts safely resolve as UNKNOWN.');

  // ----------------------------------------------------
  // TEST 4: Compatibility with Journal, Trial Balance, P&L, Balance Sheet, Cash Flow
  // ----------------------------------------------------
  console.log('\n--- Test 4: Report Compatibility & Single Authoritative Behavior ---');

  // Register a custom expense account with conflicting type/balance in db
  const dbCustomAccount: Account = {
    id: 'acc_6199',
    code: '6199',
    nameBn: 'বিশেষ গবেষণা ও উন্নয়ন ব্যয়',
    nameEn: 'Special R&D Expense',
    accountClass: 'EXPENSE',
    type: 'ASSET', // conflicting type in db
    normalBalance: 'CREDIT', // conflicting normalBalance in db
    isSystem: false,
    isActive: true
  };
  await db.accounts.add(dbCustomAccount);

  // Post Journal Entry: Dr 6199 (৳15,000), Cr 1010 (৳15,000)
  const entry1: JournalEntry = {
    id: 'j-b2-test-01',
    voucherNumber: 'JRN-B2-01',
    voucherType: 'PAYMENT',
    date: '2026-06-15',
    narration: 'Payment for R&D Expense',
    lines: [
      {
        accountCode: '6199',
        accountName: 'বিশেষ গবেষণা ও উন্নয়ন ব্যয়',
        debit: 15000,
        credit: 0
      },
      {
        accountCode: '1010',
        accountName: 'নগদ টাকা (Cash on Hand)',
        debit: 0,
        credit: 15000
      }
    ],
    createdAt: new Date().toISOString()
  };
  await postJournalEntry(entry1);

  // Also post a Revenue Entry: Dr 1010 (৳50,000), Cr 4010 (৳50,000)
  const entry2: JournalEntry = {
    id: 'j-b2-test-02',
    voucherNumber: 'JRN-B2-02',
    voucherType: 'RECEIPT',
    date: '2026-06-16',
    narration: 'Fish Sales Receipt',
    lines: [
      {
        accountCode: '1010',
        accountName: 'নগদ টাকা (Cash on Hand)',
        debit: 50000,
        credit: 0
      },
      {
        accountCode: '4010',
        accountName: 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
        debit: 0,
        credit: 50000
      }
    ],
    createdAt: new Date().toISOString()
  };
  await postJournalEntry(entry2);

  // 4a: Trial Balance Verification
  const tb = await generateTrialBalance();
  assert(tb.isBalanced === true, 'Trial Balance must be balanced');
  assert(tb.totalDebit === tb.totalCredit, 'TB total debit must equal total credit');
  const tb6199 = tb.rows.find((r) => r.code === '6199');
  assert(!!tb6199, 'Custom account 6199 must appear in Trial Balance');
  assert(tb6199!.accountClass === 'EXPENSE', 'Custom account class in TB must be EXPENSE');
  assert(tb6199!.debit === 15000, 'Custom account must show 15,000 debit balance');
  assert(tb6199!.credit === 0, 'Custom account credit must be 0');

  // 4b: P&L Verification
  const pl = await generateProfitAndLoss();
  assert(pl.totalRevenue === 50000, 'P&L totalRevenue must be 50,000');
  const expenseInPl = pl.operatingExpenses.find((e) => e.code === '6199');
  assert(!!expenseInPl, 'Account 6199 must appear in P&L Operating Expenses');
  assert(expenseInPl!.amount === 15000, 'Operating expense amount must be positive 15,000 (not inverted)');
  assert(pl.totalOperatingExpenses === 15000, 'Total operating expenses must be 15,000');
  assert(pl.netProfit === 35000, 'Net profit must be 35,000 (50,000 revenue - 15,000 expense)');

  // 4c: Balance Sheet Verification
  const bs = await generateBalanceSheet();
  // Account 6199 MUST NOT appear in Balance Sheet Assets or Liabilities
  const inBsAssets = bs.assets.some((a) => a.code === '6199');
  const inBsLiab = bs.liabilities.some((l) => l.code === '6199');
  assert(!inBsAssets, 'Expense account 6199 must NEVER appear in Balance Sheet Assets');
  assert(!inBsLiab, 'Expense account 6199 must NEVER appear in Balance Sheet Liabilities');

  // Cash on Hand in Balance Sheet must reflect net debits: 50,000 - 15,000 = 35,000
  const cashInBs = bs.assets.find((a) => a.code === '1010');
  assert(!!cashInBs, 'Cash account 1010 must be in Balance Sheet');
  assert(cashInBs!.amount === 35000, 'Cash balance in BS must be 35,000');
  assert(bs.currentYearNetProfit === 35000, 'Balance sheet net profit must match P&L net profit 35,000');
  assert(bs.isBalanced === true, 'Balance Sheet must balance (Assets === Liabilities + Equity)');

  // 4d: General Ledger Verification
  const gl = await getGeneralLedger('6199');
  assert(gl.account.accountClass === 'EXPENSE', 'GL accountClass must be EXPENSE');
  assert(gl.account.normalBalance === 'DEBIT', 'GL normalBalance must be DEBIT');
  assert(gl.closingBalance === 15000, 'GL closing balance must be 15,000');

  // 4e: Cash Flow Verification
  const cf = await generateCashFlowStatement();
  assert(cf.netCashFlow === 35000, 'Cash flow net cash flow must match 35,000');
  assert(cf.closingCash === 35000, 'Cash flow closing cash must be 35,000');

  console.log('✅ Test 4 Passed: Compatible across Journal, Trial Balance, P&L, Balance Sheet, General Ledger, Cash Flow.');

  console.log('\n====================================================');
  console.log('ALL B2 CLASSIFICATION CONSISTENCY AUDIT TESTS PASSED! 🎉');
  console.log('====================================================');
  return { success: true };
}

runClassificationConsistencyAuditTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
