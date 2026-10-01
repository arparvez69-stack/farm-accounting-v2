import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction
} from '../services/transactionService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * TASK 2 REGRESSION TEST: ACTUAL INVESTOR PROFIT ALLOCATION
 *
 * Required model:
 * Stage 1: Total distributable profit comes from finalized authoritative profit amount (300).
 * Stage 2: Allocate economic profit to each investor/tranche according to configured economic allocation:
 *          A capital 100, B capital 200, Total capital 300
 *          => A economic = 100
 *          => B economic = 200
 * Stage 3: For each investor/tranche, apply THAT investor/tranche's own contractual profit-share percentage:
 *          A contract 50%:
 *            investor profit = 100 × 50% = 50
 *            Mudarib profit  = 100 − 50 = 50
 *          B contract 60%:
 *            investor profit = 200 × 60% = 120
 *            Mudarib profit  = 200 − 120 = 80
 *
 * NEVER:
 * - use a farm-wide investor ratio
 * - use 100% − sum(all investor percentages)
 * - make investor percentages add to 100%
 * - calculate one global Mudarib ratio
 *
 * Totals:
 * => total investor = 50 + 120 = 170
 * => total Mudarib  = 50 + 80 = 130
 * => grand total    = 170 + 130 = 300
 */
export async function runTask2InvestorProfitAllocationTests(): Promise<AssertionResult> {
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
  console.log('STARTING TASK 2: ACTUAL INVESTOR PROFIT ALLOCATION REGRESSION TEST');
  console.log('Testing 3-Stage Profit Allocation:');
  console.log('A capital 100, contract 50% | B capital 200, contract 60% | Economic profit = 300');
  console.log('================================================================\n');

  const testUserId = 'test_owner_task2';

  // ===========================================================================
  // TEST SUITE 1: Explicit Economic Profit Allocation (allocatedEconomicProfit)
  // ===========================================================================
  console.log('--- Test Suite 1: Explicit Economic Profit Allocation ---');
  const mDb1 = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb1.accounts.put(acc);
  }
  const bankAccId1 = 'bank_acc_t2_1';
  await mDb1.cashBankAccounts.put({
    id: bankAccId1,
    accountName: 'Agrani Bank PLC',
    name: 'Agrani Bank PLC',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // Investor A enters with capital 100, contractual ratio 50%
  const resA1 = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01811000011',
      contribution: 100,
      profitSharingRatio: 50,
      targetAccountId: bankAccId1,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Investor A Capital 100, Contract 50%'
    },
    mDb1
  );

  // Investor B enters with capital 200, contractual ratio 60% (50% + 60% = 110% > 100%)
  const resB1 = await executeInvestorTransaction(
    {
      investorName: 'Investor B',
      phone: '01811000012',
      contribution: 200,
      profitSharingRatio: 60,
      targetAccountId: bankAccId1,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Investor B Capital 200, Contract 60%'
    },
    mDb1
  );

  assert(Boolean(resA1?.investor?.id), 'Investor A created with capital 100');
  assert(Boolean(resB1?.investor?.id), 'Investor B created with capital 200');
  assert(resA1.investor.profitSharingRatio === 50, 'Investor A contract ratio is strictly 50%');
  assert(resB1.investor.profitSharingRatio === 60, 'Investor B contract ratio is strictly 60%');
  assert(
    resA1.investor.profitSharingRatio + resB1.investor.profitSharingRatio === 110,
    'Contract percentages sum to 110% (> 100%), confirming contracts do NOT need to sum to 100%'
  );

  // Stage 1 & 2 & 3 Allocation:
  // Economic profit total = 300
  // A economic = 100 -> Investor 50, Mudarib 50
  const allocA1 = await executeInvestorProfitAllocationTransaction(
    {
      investorId: resA1.investor.id,
      finalizedDistributableProfit: 300,
      allocatedEconomicProfit: 100,
      allocationDate: '2026-06-30',
      allocationReference: 'TASK2-ALLOC-SUITE1',
      currentUserId: testUserId,
      notes: 'A economic 100, contract 50%'
    },
    mDb1
  );

  // B economic = 200 -> Investor 120, Mudarib 80
  const allocB1 = await executeInvestorProfitAllocationTransaction(
    {
      investorId: resB1.investor.id,
      finalizedDistributableProfit: 300,
      allocatedEconomicProfit: 200,
      allocationDate: '2026-06-30',
      allocationReference: 'TASK2-ALLOC-SUITE1',
      currentUserId: testUserId,
      notes: 'B economic 200, contract 60%'
    },
    mDb1
  );

  // Verification for Investor A
  assert(allocA1.allocatedEconomicProfit === 100, 'A: Allocated economic profit is strictly ৳100');
  assert(allocA1.allocatedProfit === 50, 'A: Investor profit = 100 × 50% = strictly ৳50');
  assert(allocA1.mudaribProfit === 50, 'A: Mudarib profit = 100 − 50 = strictly ৳50');
  assert(allocA1.workingPartnerShare === 50, 'A: workingPartnerShare matches Mudarib profit ৳50');
  assert(allocA1.profitSharingRatio === 50, 'A: profitSharingRatio is 50%');
  assert(allocA1.workingPartnerRatio === 50, 'A: workingPartnerRatio is 50% (100% - 50%)');

  // Verification for Investor B
  assert(allocB1.allocatedEconomicProfit === 200, 'B: Allocated economic profit is strictly ৳200');
  assert(allocB1.allocatedProfit === 120, 'B: Investor profit = 200 × 60% = strictly ৳120');
  assert(allocB1.mudaribProfit === 80, 'B: Mudarib profit = 200 − 120 = strictly ৳80');
  assert(allocB1.workingPartnerShare === 80, 'B: workingPartnerShare matches Mudarib profit ৳80');
  assert(allocB1.profitSharingRatio === 60, 'B: profitSharingRatio is 60%');
  assert(allocB1.workingPartnerRatio === 40, 'B: workingPartnerRatio is 40% (100% - 60%, NOT a global ratio)');

  // Verification of Totals
  const totalInvestorProfit1 = allocA1.allocatedProfit + allocB1.allocatedProfit;
  const totalMudaribProfit1 = (allocA1.mudaribProfit || 0) + (allocB1.mudaribProfit || 0);
  const grandTotal1 = totalInvestorProfit1 + totalMudaribProfit1;

  assert(totalInvestorProfit1 === 170, `Total investor profit = 50 + 120 = strictly ৳170 (got ৳${totalInvestorProfit1})`);
  assert(totalMudaribProfit1 === 130, `Total Mudarib profit = 50 + 80 = strictly ৳130 (got ৳${totalMudaribProfit1})`);
  assert(grandTotal1 === 300, `Grand total distributed profit = 170 + 130 = strictly ৳300 (got ৳${grandTotal1})`);

  // ===========================================================================
  // TEST SUITE 2: Configured Economic Allocation Method ('CAPITAL_PROPORTION')
  // ===========================================================================
  console.log('\n--- Test Suite 2: Configured Economic Allocation by Capital Proportion ---');
  const mDb2 = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb2.accounts.put(acc);
  }
  const bankAccId2 = 'bank_acc_t2_2';
  await mDb2.cashBankAccounts.put({
    id: bankAccId2,
    accountName: 'Sonali Bank PLC',
    name: 'Sonali Bank PLC',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  const resA2 = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01811000021',
      contribution: 100,
      profitSharingRatio: 50,
      targetAccountId: bankAccId2,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Capital 100'
    },
    mDb2
  );

  const resB2 = await executeInvestorTransaction(
    {
      investorName: 'Investor B',
      phone: '01811000022',
      contribution: 200,
      profitSharingRatio: 60,
      targetAccountId: bankAccId2,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Capital 200'
    },
    mDb2
  );

  // Total profit 300, economicAllocationMethod: 'CAPITAL_PROPORTION'
  // Total capital = 100 + 200 = 300
  // A economic = 300 × (100 / 300) = 100 -> Investor 50, Mudarib 50
  const allocA2 = await executeInvestorProfitAllocationTransaction(
    {
      investorId: resA2.investor.id,
      finalizedDistributableProfit: 300,
      economicAllocationMethod: 'CAPITAL_PROPORTION',
      allocationDate: '2026-06-30',
      allocationReference: 'TASK2-ALLOC-SUITE2',
      currentUserId: testUserId
    },
    mDb2
  );

  // B economic = 300 × (200 / 300) = 200 -> Investor 120, Mudarib 80
  const allocB2 = await executeInvestorProfitAllocationTransaction(
    {
      investorId: resB2.investor.id,
      finalizedDistributableProfit: 300,
      economicAllocationMethod: 'CAPITAL_PROPORTION',
      allocationDate: '2026-06-30',
      allocationReference: 'TASK2-ALLOC-SUITE2',
      currentUserId: testUserId
    },
    mDb2
  );

  assert(allocA2.allocatedEconomicProfit === 100, 'Suite 2: A economic allocation by capital = ৳100');
  assert(allocA2.allocatedProfit === 50, 'Suite 2: A contractual investor profit = ৳50');
  assert(allocA2.mudaribProfit === 50, 'Suite 2: A Mudarib profit = ৳50');

  assert(allocB2.allocatedEconomicProfit === 200, 'Suite 2: B economic allocation by capital = ৳200');
  assert(allocB2.allocatedProfit === 120, 'Suite 2: B contractual investor profit = ৳120');
  assert(allocB2.mudaribProfit === 80, 'Suite 2: B Mudarib profit = ৳80');

  const totalInv2 = allocA2.allocatedProfit + allocB2.allocatedProfit;
  const totalMud2 = (allocA2.mudaribProfit || 0) + (allocB2.mudaribProfit || 0);
  assert(totalInv2 === 170, `Suite 2: Total investor profit = ৳170 (got ৳${totalInv2})`);
  assert(totalMud2 === 130, `Suite 2: Total Mudarib profit = ৳130 (got ৳${totalMud2})`);
  assert(totalInv2 + totalMud2 === 300, 'Suite 2: Grand total = ৳300');

  // ===========================================================================
  // TEST SUITE 3: General Ledger Journal & Balance Integrity
  // ===========================================================================
  console.log('\n--- Test Suite 3: General Ledger Journal & Balance Integrity ---');
  const journalA = await mDb1.journalEntries.get(allocA1.journalEntryId);
  const journalB = await mDb1.journalEntries.get(allocB1.journalEntryId);

  assert(journalA !== undefined, 'Journal entry for Investor A allocation posted');
  assert(journalB !== undefined, 'Journal entry for Investor B allocation posted');

  // Check lines for A: Dr 3070 ৳50, Cr 2050 ৳50
  const drA = journalA.lines.find((l: any) => l.accountCode === '3070');
  const crA = journalA.lines.find((l: any) => l.accountCode === '2050');
  assert(drA?.debit === 50, 'A Journal: Dr 3070 Profit Distribution is ৳50');
  assert(crA?.credit === 50, 'A Journal: Cr 2050 Investor Profit Payable is ৳50');

  // Check lines for B: Dr 3070 ৳120, Cr 2050 ৳120
  const drB = journalB.lines.find((l: any) => l.accountCode === '3070');
  const crB = journalB.lines.find((l: any) => l.accountCode === '2050');
  assert(drB?.debit === 120, 'B Journal: Dr 3070 Profit Distribution is ৳120');
  assert(crB?.credit === 120, 'B Journal: Cr 2050 Investor Profit Payable is ৳120');

  // Verify investor records
  const updatedA = await mDb1.investors.get(resA1.investor.id);
  const updatedB = await mDb1.investors.get(resB1.investor.id);
  assert(updatedA?.profitPayable === 50, 'A record: profitPayable = ৳50');
  assert(updatedA?.totalProfitAllocated === 50, 'A record: totalProfitAllocated = ৳50');
  assert(updatedB?.profitPayable === 120, 'B record: profitPayable = ৳120');
  assert(updatedB?.totalProfitAllocated === 120, 'B record: totalProfitAllocated = ৳120');

  console.log('\n================================================================');
  console.log(`TASK 2 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testTask2InvestorProfitAllocation.ts') ||
    process.argv[1].endsWith('testTask2InvestorProfitAllocation.js'));

if (isDirectRun) {
  runTask2InvestorProfitAllocationTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Task 2 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Task 2 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Task 2 tests:', err);
      process.exit(1);
    });
}
