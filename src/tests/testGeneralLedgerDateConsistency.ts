import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { initDefaultAccounts } from '../accounting/defaultAccounts';
import { getGeneralLedger } from '../accounting/accountingEngine';
import { JournalEntry } from '../types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runGeneralLedgerDateConsistencyTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}> {
  console.log('\n========================================================');
  console.log('GENERAL LEDGER DATE-RANGE CONSISTENCY REGRESSION TESTS');
  console.log('Verifying date-range matching, opening balance, running balances & period context');
  console.log('========================================================');

  const results: TestResult[] = [];
  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      results.push({ name, passed: true });
    } else {
      const msg = detail ? `${name} - ${detail}` : name;
      console.error(`❌ FAIL: ${msg}`);
      results.push({ name, passed: false, error: msg });
    }
  }

  // Clear previous test records & init accounts
  await db.journalEntries.clear();
  await initDefaultAccounts();

  // Test dataset:
  // Account 1010: Cash on Hand (DEBIT normal)
  // Account 2010: Accounts Payable (CREDIT normal)
  const testEntries: JournalEntry[] = [
    // --- 1. Historical / Prior period (Jan & Feb 2026) ---
    {
      id: 'gl_test_jan_01',
      voucherNumber: 'JV-GL-JAN-01',
      voucherType: 'JOURNAL',
      date: '2026-01-15',
      narration: 'Owner capital injected in cash',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 50000, credit: 0 },
        { accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 50000 }
      ],
      createdAt: '2026-01-15T10:00:00.000Z'
    },
    {
      id: 'gl_test_feb_01',
      voucherNumber: 'JV-GL-FEB-01',
      voucherType: 'JOURNAL',
      date: '2026-02-10',
      narration: 'Feed purchase paid from cash',
      lines: [
        { accountCode: '5010', accountName: 'পশুখাদ্য ও পুষ্টি ব্যয়', debit: 15000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 15000 }
      ],
      createdAt: '2026-02-10T11:00:00.000Z'
    },
    {
      id: 'gl_test_feb_02',
      voucherNumber: 'JV-GL-FEB-02',
      voucherType: 'JOURNAL',
      date: '2026-02-28T23:59:59.999Z',
      narration: 'Farm supplies purchased on credit (AP)',
      lines: [
        { accountCode: '6020', accountName: 'ফার্ম সরঞ্জাম ও রক্ষণাবেক্ষণ', debit: 8000, credit: 0 },
        { accountCode: '2010', accountName: 'সরবরাহকারী প্রদেয় হিসাব (AP)', debit: 0, credit: 8000 }
      ],
      createdAt: '2026-02-28T23:59:59.999Z'
    },

    // --- 2. Reporting Period: March 2026 [2026-03-01 to 2026-03-31] ---
    {
      id: 'gl_test_mar_01',
      voucherNumber: 'JV-GL-MAR-01',
      voucherType: 'RECEIPT',
      date: '2026-03-01T08:30:00.000Z',
      narration: 'Cash sale on startDate',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 10000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 10000 }
      ],
      createdAt: '2026-03-01T08:30:00.000Z'
    },
    {
      id: 'gl_test_mar_02',
      voucherNumber: 'JV-GL-MAR-02',
      voucherType: 'PAYMENT',
      date: '2026-03-15',
      narration: 'Mid-month feed payment in cash',
      lines: [
        { accountCode: '5010', accountName: 'পশুখাদ্য ও পুষ্টি ব্যয়', debit: 6000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 6000 }
      ],
      createdAt: '2026-03-15T14:00:00.000Z'
    },
    {
      id: 'gl_test_mar_03',
      voucherNumber: 'JV-GL-MAR-03',
      voucherType: 'PAYMENT',
      date: '2026-03-20',
      narration: 'Supplier debt repayment in cash (reducing AP)',
      lines: [
        { accountCode: '2010', accountName: 'সরবরাহকারী প্রদেয় হিসাব (AP)', debit: 3000, credit: 0 },
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 3000 }
      ],
      createdAt: '2026-03-20T16:00:00.000Z'
    },
    {
      id: 'gl_test_mar_04',
      voucherNumber: 'JV-GL-MAR-04',
      voucherType: 'RECEIPT',
      date: '2026-03-31T23:59:59.999Z',
      narration: 'Cash sale on endDate with ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 4000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 4000 }
      ],
      createdAt: '2026-03-31T23:59:59.999Z'
    },

    // --- 3. Future Transactions: April 2026 (after endDate) ---
    {
      id: 'gl_test_apr_01',
      voucherNumber: 'JV-GL-APR-01',
      voucherType: 'RECEIPT',
      date: '2026-04-05',
      narration: 'Cash sale in April',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 25000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 25000 }
      ],
      createdAt: '2026-04-05T09:00:00.000Z'
    },
    {
      id: 'gl_test_apr_02',
      voucherNumber: 'JV-GL-APR-02',
      voucherType: 'JOURNAL',
      date: '2026-04-10',
      narration: 'New supplier debt in April',
      lines: [
        { accountCode: '6020', accountName: 'ফার্ম সরঞ্জাম ও রক্ষণাবেক্ষণ', debit: 12000, credit: 0 },
        { accountCode: '2010', accountName: 'সরবরাহকারী প্রদেয় হিসাব (AP)', debit: 0, credit: 12000 }
      ],
      createdAt: '2026-04-10T10:00:00.000Z'
    }
  ];

  await db.journalEntries.bulkAdd(testEntries);

  // Expected accounting metrics for Cash (1010, Debit normal):
  // Opening before March 1 = 50,000 - 15,000 = 35,000
  // March Debit = 10,000 (sale) + 4,000 (sale) = 14,000
  // March Credit = 6,000 (feed) + 3,000 (AP pay) = 9,000
  // March Net Change = +5,000
  // Closing as of March 31 = 35,000 + 5,000 = 40,000
  // All-time Cash (including April 25,000) = 65,000

  // Expected accounting metrics for Accounts Payable (2010, Credit normal):
  // Opening before March 1 = 8,000 credit
  // March Debit = 3,000 (paid off)
  // March Credit = 0
  // March Net Change = -3,000
  // Closing as of March 31 = 5,000 credit
  // All-time AP (including April 12,000) = 17,000 credit

  // ========================================================
  // TEST 1: Cash on Hand (1010) with Date Range [2026-03-01 to 2026-03-31]
  // ========================================================
  console.log('\n--- Test 1: Debit-normal Account (1010 Cash) in Date Range ---');
  const cashGl = await getGeneralLedger('1010', {
    startDate: '2026-03-01',
    endDate: '2026-03-31'
  });

  // 1. Opening balance calculated from entries before startDate
  assert(
    cashGl.openingBalance === 35000,
    'Opening balance is calculated correctly from entries strictly before startDate',
    `Expected 35000, got ${cashGl.openingBalance}`
  );

  // 2. Explicit opening balance row present
  const openingEntry = cashGl.entries.find((e) => e.isOpeningBalance);
  assert(
    openingEntry !== undefined,
    'An explicit opening balance row is included in ledger entries',
    `Found: ${Boolean(openingEntry)}`
  );
  assert(
    openingEntry?.runningBalance === 35000 && openingEntry?.debit === 35000,
    'Opening balance entry displays 35000 running balance and debit',
    `debit: ${openingEntry?.debit}, running: ${openingEntry?.runningBalance}`
  );

  // 3. Transactions within date range are included
  const regularEntries = cashGl.entries.filter((e) => !e.isOpeningBalance);
  assert(
    regularEntries.length === 4,
    'Displayed period entries match exactly the 4 March transactions',
    `Expected 4, got ${regularEntries.length}`
  );

  // 4. Pre-period entries (Jan/Feb) and post-period entries (April) are NOT listed as regular rows
  const hasJanFeb = regularEntries.some((e) => e.date < '2026-03-01');
  const hasApril = regularEntries.some((e) => e.date > '2026-03-31');
  assert(
    !hasJanFeb && !hasApril,
    'Entries outside date range are not displayed as period transaction rows',
    `hasJanFeb: ${hasJanFeb}, hasApril: ${hasApril}`
  );

  // 5. Running balances progress consistently from opening balance
  // Entry 1 (Mar 01, +10000): 45000
  // Entry 2 (Mar 15, -6000): 39000
  // Entry 3 (Mar 20, -3000): 36000
  // Entry 4 (Mar 31, +4000): 40000
  const runningBalances = regularEntries.map((e) => e.runningBalance);
  assert(
    JSON.stringify(runningBalances) === JSON.stringify([45000, 39000, 36000, 40000]),
    'Running balances progress continuously and accurately from opening balance',
    `Expected [45000, 39000, 36000, 40000], got ${JSON.stringify(runningBalances)}`
  );

  // 6. Net balance is consistent with reporting context (NOT all-time 65000)
  assert(
    cashGl.netBalance === 40000 && cashGl.closingBalance === 40000,
    'Calculated netBalance/closingBalance is consistent with the report period (40000, not 65000)',
    `Expected 40000, got netBalance: ${cashGl.netBalance}, closingBalance: ${cashGl.closingBalance}`
  );

  // 7. Cumulative accounting relation holds
  assert(
    cashGl.openingBalance + (cashGl.periodDebit - cashGl.periodCredit) === cashGl.closingBalance,
    'Cumulative accounting holds: openingBalance + (periodDebit - periodCredit) === closingBalance',
    `35000 + (14000 - 9000) = 40000`
  );

  // ========================================================
  // TEST 2: Credit-normal Account (2010 AP) with Date Range
  // ========================================================
  console.log('\n--- Test 2: Credit-normal Account (2010 AP) in Date Range ---');
  const apGl = await getGeneralLedger('2010', {
    startDate: '2026-03-01',
    endDate: '2026-03-31'
  });

  assert(
    apGl.openingBalance === 8000,
    'AP opening balance correctly reflects 8000 credit before March 1',
    `Expected 8000, got ${apGl.openingBalance}`
  );

  const apOpeningEntry = apGl.entries.find((e) => e.isOpeningBalance);
  assert(
    apOpeningEntry?.credit === 8000 && apOpeningEntry?.runningBalance === 8000,
    'AP opening balance entry shows 8000 credit and 8000 running balance',
    `credit: ${apOpeningEntry?.credit}, running: ${apOpeningEntry?.runningBalance}`
  );

  const apRegularEntries = apGl.entries.filter((e) => !e.isOpeningBalance);
  assert(
    apRegularEntries.length === 1 && apRegularEntries[0].voucherNumber === 'JV-GL-MAR-03',
    'Only the March 20 AP repayment is shown in period transactions',
    `Found ${apRegularEntries.length} entries`
  );

  assert(
    apRegularEntries[0].runningBalance === 5000,
    'Running balance drops from 8000 to 5000 after 3000 repayment',
    `Expected 5000, got ${apRegularEntries[0].runningBalance}`
  );

  assert(
    apGl.netBalance === 5000 && apGl.closingBalance === 5000,
    'AP netBalance matches period closing balance (5000, not all-time 17000)',
    `Expected 5000, got ${apGl.netBalance}`
  );

  // ========================================================
  // TEST 3: Unfiltered General Ledger (No Date Range)
  // ========================================================
  console.log('\n--- Test 3: Unfiltered General Ledger (All-Time) ---');
  const allTimeCashGl = await getGeneralLedger('1010');

  assert(
    allTimeCashGl.openingBalance === 0,
    'Unfiltered ledger has openingBalance = 0',
    `Got ${allTimeCashGl.openingBalance}`
  );

  assert(
    allTimeCashGl.netBalance === 65000,
    'Unfiltered ledger netBalance reflects all transactions through present (65000)',
    `Expected 65000, got ${allTimeCashGl.netBalance}`
  );

  assert(
    !allTimeCashGl.entries.some((e) => e.isOpeningBalance),
    'Unfiltered ledger from inception does not add redundant opening balance row',
    'No opening row found'
  );

  // ========================================================
  // TEST 4: As-Of Date Filter (endDate only: 2026-03-31)
  // ========================================================
  console.log('\n--- Test 4: As-Of Filter (endDate only) ---');
  const asOfCashGl = await getGeneralLedger('1010', {
    endDate: '2026-03-31'
  });

  assert(
    asOfCashGl.openingBalance === 0,
    'endDate-only filter starts from inception with openingBalance = 0',
    `Got ${asOfCashGl.openingBalance}`
  );

  assert(
    asOfCashGl.closingBalance === 40000 && asOfCashGl.netBalance === 40000,
    'endDate-only filter excludes April transactions and yields 40000 balance as of March 31',
    `Expected 40000, got ${asOfCashGl.closingBalance}`
  );

  // ========================================================
  // TEST 5: Period with zero prior transactions
  // ========================================================
  console.log('\n--- Test 5: Period with Zero Prior Transactions ---');
  const zeroPriorGl = await getGeneralLedger('1010', {
    startDate: '2025-01-01',
    endDate: '2025-12-31'
  });

  assert(
    zeroPriorGl.openingBalance === 0,
    'Period before any transactions correctly has opening balance of 0',
    `Expected 0, got ${zeroPriorGl.openingBalance}`
  );

  assert(
    zeroPriorGl.closingBalance === 0 && zeroPriorGl.entries.filter((e) => !e.isOpeningBalance).length === 0,
    'Period before any transactions has 0 closing balance and 0 regular transactions',
    `closing: ${zeroPriorGl.closingBalance}`
  );

  // Clean up test entries
  await db.journalEntries.where('id').startsWith('gl_test_').delete();

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const failures = results.filter((r) => !r.passed).map((r) => r.error || r.name);

  console.log('\n========================================================');
  console.log(`GENERAL LEDGER TESTS COMPLETED: Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
  console.log('========================================================\n');

  return { total, passed, failed, failures };
}

if (process.argv[1]?.includes('testGeneralLedgerDateConsistency')) {
  runGeneralLedgerDateConsistencyTests()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
