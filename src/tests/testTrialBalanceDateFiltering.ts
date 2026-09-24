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
  console.log('TRIAL BALANCE AS-OF DATE LOGIC REGRESSION TESTS');
  console.log('Verifying AS-OF semantics, startDate ignored, endDate cutoff, and balance');
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

  // Test dataset with transactions before startDate, within month, on endDate (with ISO timestamps), and after endDate
  const testEntries: JournalEntry[] = [
    // --- 1. Old historical transactions well before startDate (2025 and Feb 2026) ---
    {
      id: 'tb_test_hist_2025',
      voucherNumber: 'JV-TB-HIST-01',
      voucherType: 'JOURNAL',
      date: '2025-12-15',
      narration: 'Prior year opening transaction',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 5000, credit: 0 },
        { accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 5000 }
      ],
      createdAt: '2025-12-15T10:00:00.000Z'
    },
    {
      id: 'tb_test_before_plain',
      voucherNumber: 'JV-TB-FEB-01',
      voucherType: 'JOURNAL',
      date: '2026-02-28',
      narration: 'February transaction before startDate',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 8000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 8000 }
      ],
      createdAt: '2026-02-28T10:00:00.000Z'
    },
    {
      id: 'tb_test_before_iso',
      voucherNumber: 'JV-TB-FEB-02',
      voucherType: 'JOURNAL',
      date: '2026-02-28T23:59:59.999Z',
      narration: 'February transaction with end-of-day timestamp',
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 9000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 9000 }
      ],
      createdAt: '2026-02-28T23:59:59.999Z'
    },

    // --- 2. Transactions during the requested period (March 2026) ---
    {
      id: 'tb_test_start_plain',
      voucherNumber: 'JV-TB-MAR-01',
      voucherType: 'JOURNAL',
      date: '2026-03-01',
      narration: 'Transaction on startDate (plain date)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 1000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 1000 }
      ],
      createdAt: '2026-03-01T00:00:00.000Z'
    },
    {
      id: 'tb_test_start_iso',
      voucherNumber: 'JV-TB-MAR-02',
      voucherType: 'JOURNAL',
      date: '2026-03-01T09:15:30.000Z',
      narration: 'Transaction on startDate with ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 500, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 500 }
      ],
      createdAt: '2026-03-01T09:15:30.000Z'
    },
    {
      id: 'tb_test_mid',
      voucherNumber: 'JV-TB-MAR-03',
      voucherType: 'JOURNAL',
      date: '2026-03-15',
      narration: 'Mid-month transaction',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 2000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 2000 }
      ],
      createdAt: '2026-03-15T12:00:00.000Z'
    },

    // --- 3. Transactions on endDate (2026-03-31) including various timestamps ---
    {
      id: 'tb_test_end_plain',
      voucherNumber: 'JV-TB-MAR-04',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Transaction on endDate (plain date)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 3000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 3000 }
      ],
      createdAt: '2026-03-31T00:00:00.000Z'
    },
    {
      id: 'tb_test_end_iso_eod',
      voucherNumber: 'JV-TB-MAR-05',
      voucherType: 'JOURNAL',
      date: '2026-03-31T23:59:59.999Z',
      narration: 'Transaction on endDate with 23:59:59.999Z timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 4000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 4000 }
      ],
      createdAt: '2026-03-31T23:59:59.999Z'
    },
    {
      id: 'tb_test_end_iso_pm',
      voucherNumber: 'JV-TB-MAR-06',
      voucherType: 'JOURNAL',
      date: '2026-03-31T14:30:00.000Z',
      narration: 'Transaction on endDate with afternoon ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 1500, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 1500 }
      ],
      createdAt: '2026-03-31T14:30:00.000Z'
    },
    {
      id: 'tb_test_end_space_time',
      voucherNumber: 'JV-TB-MAR-07',
      voucherType: 'JOURNAL',
      date: '2026-03-31 18:20:00',
      narration: 'Transaction on endDate with space-separated time',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 700, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 700 }
      ],
      createdAt: '2026-03-31T18:20:00.000Z'
    },

    // --- 4. Future transactions after endDate (April 2026) ---
    {
      id: 'tb_test_after_plain',
      voucherNumber: 'JV-TB-APR-01',
      voucherType: 'JOURNAL',
      date: '2026-04-01',
      narration: 'Transaction after endDate (plain date)',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 10000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 10000 }
      ],
      createdAt: '2026-04-01T08:00:00.000Z'
    },
    {
      id: 'tb_test_after_iso',
      voucherNumber: 'JV-TB-APR-02',
      voucherType: 'JOURNAL',
      date: '2026-04-01T00:00:01.000Z',
      narration: 'Transaction after endDate with ISO timestamp',
      lines: [
        { accountCode: '1010', accountName: 'নগদ টাকা', debit: 11000, credit: 0 },
        { accountCode: '4010', accountName: 'পণ্য বিক্রয় আয়', debit: 0, credit: 11000 }
      ],
      createdAt: '2026-04-01T00:00:01.000Z'
    }
  ];

  await db.journalEntries.bulkAdd(testEntries);

  // Historical prior to startDate (2026-03-01):
  // 5000 (2025) + 8000 (Feb 28) + 9000 (Feb 28 ISO) = 22,000
  const expectedPreMarchTotal = 5000 + 8000 + 9000; // 22,000

  // March entries (through 2026-03-31):
  // 1000 + 500 + 2000 + 3000 + 4000 + 1500 + 700 = 12,700
  const expectedMarchTotal = 1000 + 500 + 2000 + 3000 + 4000 + 1500 + 700; // 12,700

  // Cumulative through 2026-03-31 (AS-OF):
  const expectedAsOfMarch31Total = expectedPreMarchTotal + expectedMarchTotal; // 34,700

  // After endDate (April):
  // 10000 + 11000 = 21,000
  const expectedPostAprilTotal = 10000 + 11000; // 21,000

  // --- PROOF 1: Old transactions before startDate are INCLUDED ---
  console.log('\n--- PROOF 1: Old transactions before startDate are INCLUDED ---');
  // Pass BOTH startDate and endDate. startDate MUST BE IGNORED.
  const tbWithBothDates = await generateTrialBalance({
    startDate: '2026-03-01',
    endDate: '2026-03-31'
  });

  assert(
    tbWithBothDates.totalDebit === expectedAsOfMarch31Total,
    'Trial Balance includes all old transactions prior to startDate (2025 and Feb 2026) when both startDate and endDate are provided',
    `Expected ${expectedAsOfMarch31Total}, got ${tbWithBothDates.totalDebit}`
  );

  const capitalRow = tbWithBothDates.rows.find((r) => r.code === '3010');
  assert(
    capitalRow !== undefined && capitalRow.credit === 5000,
    'Historical capital transaction from 2025 is preserved in Trial Balance despite startDate: 2026-03-01',
    `Expected 5000 credit, got ${capitalRow?.credit}`
  );

  const bankRow = tbWithBothDates.rows.find((r) => r.code === '1030');
  assert(
    bankRow !== undefined && bankRow.debit === 9000,
    'February bank transaction is preserved in Trial Balance despite startDate: 2026-03-01',
    `Expected 9000 debit, got ${bankRow?.debit}`
  );

  // Verify startDate is completely ignored: passing { endDate: '2026-03-31' } produces identical result
  const tbEndDateOnly = await generateTrialBalance({
    endDate: '2026-03-31'
  });
  assert(
    tbWithBothDates.totalDebit === tbEndDateOnly.totalDebit &&
    tbWithBothDates.totalCredit === tbEndDateOnly.totalCredit &&
    tbWithBothDates.rows.length === tbEndDateOnly.rows.length,
    'startDate parameter is completely ignored: result with { startDate, endDate } is identical to { endDate }',
    `Both: ${tbWithBothDates.totalDebit}, EndOnly: ${tbEndDateOnly.totalDebit}`
  );

  // --- PROOF 2: Transactions after endDate are EXCLUDED ---
  console.log('\n--- PROOF 2: Transactions after endDate are EXCLUDED ---');
  assert(
    tbWithBothDates.totalDebit < expectedAsOfMarch31Total + expectedPostAprilTotal,
    'Future April transactions (after endDate 2026-03-31) are strictly excluded from Trial Balance',
    `Total: ${tbWithBothDates.totalDebit}, should not include April (${expectedPostAprilTotal})`
  );

  // Verify all timestamps on the end date itself are included
  // Entries on 2026-03-31: 3000 + 4000 + 1500 + 700 = 9200
  // If April 1 is excluded and all March 31 timestamps are included, total must be exact
  assert(
    tbWithBothDates.totalDebit === 34700,
    'All end date transactions (including ISO 23:59:59.999Z, afternoon ISO, space-delimited time) are included up to cutoff',
    `Expected 34700, got ${tbWithBothDates.totalDebit}`
  );

  // --- PROOF 3: Trial Balance remains balanced ---
  console.log('\n--- PROOF 3: Trial Balance remains balanced ---');
  assert(
    tbWithBothDates.isBalanced === true,
    'Trial Balance isBalanced is true',
    `isBalanced: ${tbWithBothDates.isBalanced}`
  );
  assert(
    tbWithBothDates.difference === 0,
    'Trial Balance discrepancy difference is 0',
    `difference: ${tbWithBothDates.difference}`
  );
  assert(
    tbWithBothDates.totalDebit === tbWithBothDates.totalCredit,
    'totalDebit equals totalCredit exactly',
    `Debit: ${tbWithBothDates.totalDebit}, Credit: ${tbWithBothDates.totalCredit}`
  );

  // --- ADDITIONAL EDGE CASES: ISO timestamps in endDate, and Unfiltered All-Time ---
  console.log('\n--- ADDITIONAL VERIFICATIONS ---');
  // 1. ISO timestamp passed as endDate
  const tbIsoEndDate = await generateTrialBalance({
    startDate: '2026-03-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z'
  });
  assert(
    tbIsoEndDate.totalDebit === expectedAsOfMarch31Total,
    'ISO timestamp in endDate is normalized to YYYY-MM-DD cutoff correctly',
    `Expected ${expectedAsOfMarch31Total}, got ${tbIsoEndDate.totalDebit}`
  );

  // 2. Unfiltered call includes everything from inception through present
  const tbAll = await generateTrialBalance();
  const expectedAllTotal = expectedAsOfMarch31Total + expectedPostAprilTotal; // 55,700
  assert(
    tbAll.totalDebit === expectedAllTotal && tbAll.isBalanced,
    'Unfiltered generateTrialBalance includes all transactions and remains balanced',
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
