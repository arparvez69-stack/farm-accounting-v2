import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  recordOwnerPersonalCapital,
  recordMudaribProfitDistribution,
  getParticipantFinancialProfile
} from '../services/participantCapacityService';
import { generateTrialBalance } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 03: SEPARATE PERSON FROM CAPACITY TEST
 *
 * Verifies that one person (e.g. Farm Owner) can hold separate financial capacities:
 * - CAPITAL_PROVIDER / INVESTOR
 * - MUDARIB / WORKING_PARTNER
 *
 * Exact Prompt Example:
 * - Owner Mudarib profit = ৳170.
 * - Owner personal capital = ৳100.
 * - These must remain separate.
 * - No duplicate or conflicting ledger balances.
 */
export async function runSeparatePersonFromCapacityTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, message: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`  ✅ [PASS] ${message}`);
    } else {
      result.failed++;
      result.failures.push(message);
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  console.log('\n================================================================');
  console.log('STARTING PROMPT 03: SEPARATE PERSON FROM CAPACITY TEST');
  console.log('Scenario: Owner personal capital = ৳100, Owner Mudarib profit = ৳170');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p03';
  const ownerPersonId = 'owner_person_001';
  const ownerName = 'Md. Tariqul Islam (Owner)';

  // 1. Setup mock database
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const cashAccId = 'cash_main_p03';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 50000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Capacity 1 — CAPITAL_PROVIDER: Owner Personal Capital = ৳100
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Recording Owner Personal Capital (৳100) ---');
  const capRes = await recordOwnerPersonalCapital(
    {
      ownerPersonId,
      ownerName,
      amount: 100,
      targetAccountId: cashAccId,
      date: '2026-01-01',
      currentUserId: testUserId,
      notes: 'Initial owner personal capital contribution'
    },
    mDb
  );

  assert(capRes.capitalAmount === 100, 'Owner personal capital recorded as ৳100');
  assert(capRes.glAccountCode === '3010', 'Capital posted strictly to Account 3010 (Owner Capital)');

  // ---------------------------------------------------------------------------
  // STEP 2: Capacity 2 — MUDARIB: Owner Mudarib Profit = ৳170
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Recording Owner Mudarib Profit (৳170) ---');
  const mudRes = await recordMudaribProfitDistribution(
    {
      mudaribPersonId: ownerPersonId,
      mudaribName: ownerName,
      mudaribProfitAmount: 170,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      currentUserId: testUserId,
      notes: 'Q1 Mudarib working partner profit distribution'
    },
    mDb
  );

  assert(mudRes.mudaribProfitAmount === 170, 'Owner Mudarib profit recorded as ৳170');
  assert(mudRes.glAccountCode === '3015', 'Mudarib profit posted strictly to Account 3015 (Mudarib Profit Equity)');

  // ---------------------------------------------------------------------------
  // STEP 3: Verify That Both Capacities Coexist on the Same Person Without Blending
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Profile Separation for Same Person ---');
  const profile = await getParticipantFinancialProfile(ownerName, mDb);

  assert(profile.personId === ownerName, 'Profile found for owner');
  assert(
    profile.capacities.includes('CAPITAL_PROVIDER'),
    'Profile confirms person holds CAPACITY: CAPITAL_PROVIDER'
  );
  assert(
    profile.capacities.includes('MUDARIB'),
    'Profile confirms person holds CAPACITY: MUDARIB'
  );

  // Capital Provider balance must be strictly ৳100
  assert(
    profile.capitalProviderBalance.capitalAmount === 100,
    `Owner personal capital balance is strictly ৳100`
  );
  assert(
    profile.capitalProviderBalance.glAccountCode === '3010',
    `Capital provider balance resides in GL 3010`
  );

  // Mudarib Working Partner profit must be strictly ৳170
  assert(
    profile.workingPartnerBalance.mudaribProfitEarned === 170,
    `Owner Mudarib profit balance is strictly ৳170`
  );
  assert(
    profile.workingPartnerBalance.glAccountCode === '3015',
    `Mudarib profit resides in GL 3015`
  );

  // CRITICAL NEGATIVE ASSERTIONS: Balances MUST NOT be combined!
  assert(
    profile.capitalProviderBalance.capitalAmount !== 270,
    'NEGATIVE ASSERTION: Personal capital balance is NOT combined to ৳270'
  );
  assert(
    profile.workingPartnerBalance.mudaribProfitEarned !== 270,
    'NEGATIVE ASSERTION: Mudarib profit balance is NOT combined to ৳270'
  );
  assert(
    profile.capitalProviderBalance.capitalAmount !== 170,
    'NEGATIVE ASSERTION: Capital does not bleed into Mudarib profit'
  );
  assert(
    profile.workingPartnerBalance.mudaribProfitEarned !== 100,
    'NEGATIVE ASSERTION: Mudarib profit does not bleed into personal capital'
  );
  assert(
    profile.isSeparate === true,
    'Profile separation flag is strictly true'
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Double-Entry GL Ledger Integrity & Zero Conflict
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: General Ledger Double-Entry Audit ---');
  const allJournals = await mDb.journalEntries.toArray();

  const capJnl = allJournals.find((j: any) => j.id === capRes.journalEntryId);
  const mudJnl = allJournals.find((j: any) => j.id === mudRes.journalEntryId);

  assert(capJnl !== undefined, 'Owner capital journal entry exists in GL');
  assert(mudJnl !== undefined, 'Mudarib profit journal entry exists in GL');

  // Verify Cap entry lines: Dr Cash (1010) ৳100 | Cr Owner Capital (3010) ৳100
  const capDr = capJnl.lines.find((l: any) => l.debit > 0);
  const capCr = capJnl.lines.find((l: any) => l.credit > 0);
  assert(capDr.accountCode === '1010' && capDr.debit === 100, 'Cap entry: Dr 1010 (Cash) ৳100');
  assert(capCr.accountCode === '3010' && capCr.credit === 100, 'Cap entry: Cr 3010 (Owner Capital) ৳100');

  // Verify Mudarib entry lines: Dr Profit Distribution (3070) ৳170 | Cr Mudarib Profit Equity (3015) ৳170
  const mudDr = mudJnl.lines.find((l: any) => l.debit > 0);
  const mudCr = mudJnl.lines.find((l: any) => l.credit > 0);
  assert(mudDr.accountCode === '3070' && mudDr.debit === 170, 'Mudarib entry: Dr 3070 (Profit Distribution) ৳170');
  assert(mudCr.accountCode === '3015' && mudCr.credit === 170, 'Mudarib entry: Cr 3015 (Mudarib Profit Equity) ৳170');

  // Verify Trial Balance post-transactions
  const tb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
  assert(tb.isBalanced, 'Trial Balance is strictly balanced');
  assert(Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, 'Trial Balance difference is zero');

  const line3010 = tb.rows.find((r) => r.code === '3010');
  const line3015 = tb.rows.find((r) => r.code === '3015');

  assert(line3010?.credit === 100, 'Trial Balance: Account 3010 (Owner Capital) has credit balance of ৳100');
  assert(line3015?.credit === 170, 'Trial Balance: Account 3015 (Mudarib Profit Equity) has credit balance of ৳170');
  assert(line3010?.credit !== 270 && line3015?.credit !== 270, 'Trial Balance: Neither account is collapsed into ৳270');

  console.log('\n================================================================');
  console.log(`PROMPT 03 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testSeparatePersonFromCapacity.ts') ||
    process.argv[1].endsWith('testSeparatePersonFromCapacity.js'));

if (isDirectRun) {
  runSeparatePersonFromCapacityTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 03 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 03 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 03 tests:', err);
      process.exit(1);
    });
}
