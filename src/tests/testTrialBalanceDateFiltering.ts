import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { initDefaultAccounts } from '../accounting/defaultAccounts';
import { generateTrialBalance } from '../accounting/accountingEngine';
import { JournalEntry } from '../types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runTrialBalanceDateFilteringTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}> {
  console.log('\n========================================================');
  console.log('TRIAL BALANCE DATE FILTERING & NORMALIZATION TESTS');
  console.log('Verifying start date, end date, ISO timestamps & outside range');
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

  // Clear previous test records
  await db.journalEntries.clear();
  await initDefaultAccounts();

  // Test entries
  const testEntries: JournalEntry[] = [
    // 1. Entry on start date (plain YYYY-MM-DD)
    {
      id: 'tb_test_start_plain',
      voucherNumber: 'JV-TB-001',
      voucherType: 'JOURNAL',
      date: '2026-03-01',
      narration: 'Entry on start date (plain YYYY-MM-DD)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 1000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 1000 }
      ],
      createdAt: '2026-03-01T00:00:00.000Z'
    },
    // 2. Entry on start date (ISO timestamp)
    {
      id: 'tb_test_start_iso',
      voucherNumber: 'JV-TB-002',
      voucherType: 'JOURNAL',
      date: '2026-03-01T09:15:30.000Z',
      narration: 'Entry on start date with ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 500, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 500 }
      ],
      createdAt: '2026-03-01T09:15:30.000Z'
    },
    // 3. Entry inside range (mid-month)
    {
      id: 'tb_test_mid',
      voucherNumber: 'JV-TB-003',
      voucherType: 'JOURNAL',
      date: '2026-03-15',
      narration: 'Entry inside range',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 2000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 2000 }
      ],
      createdAt: '2026-03-15T12:00:00.000Z'
    },
    // 4. Entry on end date (plain YYYY-MM-DD)
    {
      id: 'tb_test_end_plain',
      voucherNumber: 'JV-TB-004',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Entry on end date (plain YYYY-MM-DD)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 3000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 3000 }
      ],
      createdAt: '2026-03-31T00:00:00.000Z'
    },
    // 5. Entry on end date (ISO timestamp end of day UTC)
    {
      id: 'tb_test_end_iso_eod',
      voucherNumber: 'JV-TB-005',
      voucherType: 'JOURNAL',
      date: '2026-03-31T23:59:59.999Z',
      narration: 'Entry on end date with 23:59:59 timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 4000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 4000 }
      ],
      createdAt: '2026-03-31T23:59:59.999Z'
    },
    // 6. Entry on end date (ISO timestamp afternoon)
    {
      id: 'tb_test_end_iso_pm',
      voucherNumber: 'JV-TB-006',
      voucherType: 'JOURNAL',
      date: '2026-03-31T14:30:00.000Z',
      narration: 'Entry on end date with afternoon ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 1500, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 1500 }
      ],
      createdAt: '2026-03-31T14:30:00.000Z'
    },
    // 7. Entry on end date (with space-separated time)
    {
      id: 'tb_test_end_space_time',
      voucherNumber: 'JV-TB-007',
      voucherType: 'JOURNAL',
      date: '2026-03-31 18:20:00',
      narration: 'Entry on end date with space-separated time',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 700, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 700 }
      ],
      createdAt: '2026-03-31T18:20:00.000Z'
    },
    // 8. Entry outside range: before start date (plain YYYY-MM-DD)
    {
      id: 'tb_test_before_plain',
      voucherNumber: 'JV-TB-008',
      voucherType: 'JOURNAL',
      date: '2026-02-28',
      narration: 'Entry before start date (2026-02-28)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 8000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 8000 }
      ],
      createdAt: '2026-02-28T10:00:00.000Z'
    },
    // 9. Entry outside range: before start date (ISO timestamp on day before)
    {
      id: 'tb_test_before_iso',
      voucherNumber: 'JV-TB-009',
      voucherType: 'JOURNAL',
      date: '2026-02-28T23:59:59.999Z',
      narration: 'Entry before start date with end of day timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 9000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 9000 }
      ],
      createdAt: '2026-02-28T23:59:59.999Z'
    },
    // 10. Entry outside range: after end date (plain YYYY-MM-DD)
    {
      id: 'tb_test_after_plain',
      voucherNumber: 'JV-TB-010',
      voucherType: 'JOURNAL',
      date: '2026-04-01',
      narration: 'Entry after end date (2026-04-01)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 10000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 10000 }
      ],
      createdAt: '2026-04-01T08:00:00.000Z'
    },
    // 11. Entry outside range: after end date (ISO timestamp early morning)
    {
      id: 'tb_test_after_iso',
      voucherNumber: 'JV-TB-011',
      voucherType: 'JOURNAL',
      date: '2026-04-01T00:00:01.000Z',
      narration: 'Entry after end date with 00:00:01 timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 11000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 11000 }
      ],
      createdAt: '2026-04-01T00:00:01.000Z'
    }
  ];

  await db.journalEntries.bulkAdd(testEntries);

  // --- SECTION 1: Full Range Filtering (2026-03-01 to 2026-03-31) ---
  console.log('\n--- Section 1: Full Monthly Range [2026-03-01, 2026-03-31] ---');
  const tbMonth = await generateTrialBalance({
    startDate: '2026-03-01',
    endDate: '2026-03-31'
  });

  const expectedMonthTotal = 1000 + 500 + 2000 + 3000 + 4000 + 1500 + 700; // 12,700
  assert(
    tbMonth.totalDebit === expectedMonthTotal,
    'Trial balance total debit includes start date, end date, and timestamps on end date',
    `Expected ${expectedMonthTotal}, got ${tbMonth.totalDebit}`
  );
  assert(
    tbMonth.totalCredit === expectedMonthTotal,
    'Trial balance total credit matches debit (balanced)',
    `Expected ${expectedMonthTotal}, got ${tbMonth.totalCredit}`
  );
  assert(tbMonth.isBalanced === true, 'Trial balance isBalanced flag is true');
  assert(tbMonth.difference === 0, 'Trial balance difference is 0');

  const cashRow = tbMonth.rows.find((r) => r.code === '1010');
  assert(
    cashRow !== undefined && cashRow.debit === expectedMonthTotal,
    'Account 1010 debit reflects all entries within [2026-03-01, 2026-03-31]',
    `Expected ${expectedMonthTotal}, got ${cashRow?.debit}`
  );

  const salesRow = tbMonth.rows.find((r) => r.code === '4010');
  assert(
    salesRow !== undefined && salesRow.credit === expectedMonthTotal,
    'Account 4010 credit reflects all entries within [2026-03-01, 2026-03-31]',
    `Expected ${expectedMonthTotal}, got ${salesRow?.credit}`
  );

  // --- SECTION 2: Focused Start Date Inclusivity ---
  console.log('\n--- Section 2: Focused Start Date Inclusivity [2026-03-01, 2026-03-01] ---');
  const tbStartOnly = await generateTrialBalance({
    startDate: '2026-03-01',
    endDate: '2026-03-01'
  });
  const expectedStartTotal = 1000 + 500; // 1,500
  assert(
    tbStartOnly.totalDebit === expectedStartTotal,
    'Start date filtering includes both plain date and ISO timestamp on start date',
    `Expected ${expectedStartTotal}, got ${tbStartOnly.totalDebit}`
  );
  assert(
    tbStartOnly.totalCredit === expectedStartTotal,
    'Start date filtering credit matches debit',
    `Expected ${expectedStartTotal}, got ${tbStartOnly.totalCredit}`
  );

  // --- SECTION 3: Focused End Date & Timestamp Inclusivity ---
  console.log('\n--- Section 3: Focused End Date & Timestamp Inclusivity [2026-03-31, 2026-03-31] ---');
  const tbEndOnly = await generateTrialBalance({
    startDate: '2026-03-31',
    endDate: '2026-03-31'
  });
  // Entries 4, 5, 6, 7: 3000 (plain) + 4000 (23:59:59.999Z) + 1500 (14:30:00Z) + 700 (18:20:00 space) = 9,200
  const expectedEndTotal = 3000 + 4000 + 1500 + 700; // 9,200
  assert(
    tbEndOnly.totalDebit === expectedEndTotal,
    'End date filtering includes plain date, afternoon ISO timestamp, 23:59:59 timestamp, and space-separated time',
    `Expected ${expectedEndTotal}, got ${tbEndOnly.totalDebit}`
  );
  assert(
    tbEndOnly.totalCredit === expectedEndTotal,
    'End date filtering credit is strictly balanced',
    `Expected ${expectedEndTotal}, got ${tbEndOnly.totalCredit}`
  );

  // --- SECTION 4: Entries Outside the Range are Excluded ---
  console.log('\n--- Section 4: Entries Outside Range Excluded [2026-03-02, 2026-03-30] ---');
  const tbMidOnly = await generateTrialBalance({
    startDate: '2026-03-02',
    endDate: '2026-03-30'
  });
  // Only entry 3 (2026-03-15) = 2,000 should be present
  const expectedMidTotal = 2000;
  assert(
    tbMidOnly.totalDebit === expectedMidTotal,
    'Entries on start date boundary (March 1), end date boundary (March 31), and outside (Feb/Apr) are excluded',
    `Expected ${expectedMidTotal}, got ${tbMidOnly.totalDebit}`
  );
  assert(
    tbMidOnly.totalCredit === expectedMidTotal,
    'Mid-range credit matches debit',
    `Expected ${expectedMidTotal}, got ${tbMidOnly.totalCredit}`
  );

  // --- SECTION 5: Open-Ended Filtering (endDate only, as used by Period Closing) ---
  console.log('\n--- Section 5: Open-Ended Closing Filter (endDate only: 2026-03-31) ---');
  const tbClosing = await generateTrialBalance({
    endDate: '2026-03-31'
  });
  // Entries 1 through 7 (March) + Entries 8 & 9 (February: 8000 + 9000 = 17000)
  // Total: 12,700 + 17,000 = 29,700. Excludes April (10 & 11: 10000 + 11000 = 21000)
  const expectedClosingTotal = 12700 + 17000; // 29,700
  assert(
    tbClosing.totalDebit === expectedClosingTotal,
    'Closing filter (endDate only) preserves historical entries and includes all end date timestamps, excluding future entries',
    `Expected ${expectedClosingTotal}, got ${tbClosing.totalDebit}`
  );
  assert(
    tbClosing.totalCredit === expectedClosingTotal,
    'Closing filter credit matches debit',
    `Expected ${expectedClosingTotal}, got ${tbClosing.totalCredit}`
  );

  // --- SECTION 6: Open-Ended Filtering (startDate only) ---
  console.log('\n--- Section 6: Open-Ended Starting Filter (startDate only: 2026-03-31) ---');
  const tbFromEnd = await generateTrialBalance({
    startDate: '2026-03-31'
  });
  // Entries 4, 5, 6, 7 (March 31 = 9200) + Entries 10 & 11 (April = 21000) = 30,200
  const expectedFromEndTotal = 9200 + 21000; // 30,200
  assert(
    tbFromEnd.totalDebit === expectedFromEndTotal,
    'startDate-only filter includes entries on start date (with all timestamps) and all subsequent entries',
    `Expected ${expectedFromEndTotal}, got ${tbFromEnd.totalDebit}`
  );

  // --- SECTION 7: ISO Timestamps passed in DateRangeFilter itself ---
  console.log('\n--- Section 7: ISO Timestamps in Filter Range Object ---');
  const tbIsoFilter = await generateTrialBalance({
    startDate: '2026-03-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z'
  });
  assert(
    tbIsoFilter.totalDebit === expectedMonthTotal,
    'ISO timestamps in dateRange.startDate and dateRange.endDate are normalized and behave identically',
    `Expected ${expectedMonthTotal}, got ${tbIsoFilter.totalDebit}`
  );

  // --- SECTION 8: Unfiltered Trial Balance ---
  console.log('\n--- Section 8: Unfiltered Trial Balance ---');
  const tbAll = await generateTrialBalance();
  const expectedAllTotal = 12700 + 17000 + 21000; // 50,700
  assert(
    tbAll.totalDebit === expectedAllTotal,
    'Unfiltered trial balance includes all journal entries in targetDb',
    `Expected ${expectedAllTotal}, got ${tbAll.totalDebit}`
  );

  // Clean up test entries
  await db.journalEntries.where('id').startsWith('tb_test_').delete();

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const failures = results.filter((r) => !r.passed).map((r) => r.error || r.name);

  console.log('\n========================================================');
  console.log(`TRIAL BALANCE TESTS COMPLETED: Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
  console.log('========================================================\n');

  return { total, passed, failed, failures };
}

if (process.argv[1]?.includes('testTrialBalanceDateFiltering')) {
  runTrialBalanceDateFilteringTests()
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
