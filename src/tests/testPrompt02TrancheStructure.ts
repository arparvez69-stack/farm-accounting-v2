import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  getTranchesForInvestor,
  getAllInvestmentTranches
} from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 02: INVESTMENT TRANCHE STRUCTURE REGRESSION TEST
 *
 * Verifies that each investment is independently identifiable with:
 * - trancheId
 * - investor/participant ID
 * - investment date
 * - effective date
 * - original capital
 * - current capital
 * - contractual profit-share percentage
 * - status
 *
 * Exact Prompt Example:
 * - A invests 100 in January.
 * - A invests another 50 in August.
 * - These must remain two separate tranches.
 * - Investor-level totals may be calculated from tranches, but original tranches must remain traceable.
 */
export async function runPrompt02TrancheStructureTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 02: INVESTMENT TRANCHE STRUCTURE TEST');
  console.log('Testing independent tranches (A: ৳100 in Jan, ৳50 in Aug)');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p02';

  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_acc_p02';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'City Bank Ltd',
    name: 'City Bank Ltd',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Investor A invests ৳100 in January (2026-01-15)
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Investor A invests ৳100 in January ---');
  const res1 = await executeInvestorTransaction(
    {
      investorName: 'Investor A',
      phone: '01711999001',
      contribution: 100,
      profitSharingRatio: 40, // 40% contractual rate
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-15',
      notes: 'Initial tranche: ৳100 in January'
    },
    mDb
  );

  const investorId = res1.investor.id;
  assert(Boolean(investorId), 'Investor A created successfully with valid ID');

  const tranchesAfterJan = await getTranchesForInvestor(investorId, mDb);
  assert(tranchesAfterJan.length === 1, 'Exactly 1 tranche exists after January investment');

  const tranche1 = tranchesAfterJan[0];
  const tranche1Id = tranche1.trancheId || tranche1.id;

  // Verify all 8 required fields on Tranche 1
  assert(Boolean(tranche1Id), `Tranche 1 has valid trancheId: ${tranche1Id}`);
  assert(
    tranche1.investorId === investorId && (tranche1.participantId === investorId || !tranche1.participantId),
    `Tranche 1 records correct investor/participant ID (${investorId})`
  );
  assert(
    tranche1.investmentDate === '2026-01-15' || tranche1.effectiveInvestmentDate === '2026-01-15',
    'Tranche 1 records investment date in January (2026-01-15)'
  );
  assert(
    tranche1.effectiveDate === '2026-01-15' || tranche1.effectiveInvestmentDate === '2026-01-15',
    'Tranche 1 records effective date in January (2026-01-15)'
  );
  assert(
    tranche1.originalCapital === 100 || tranche1.investmentAmount === 100,
    'Tranche 1 records original capital of ৳100'
  );
  assert(
    tranche1.currentCapital === 100 || tranche1.currentCapitalBalance === 100,
    'Tranche 1 records current capital of ৳100'
  );
  assert(
    tranche1.contractualProfitSharePercentage === 40,
    'Tranche 1 records contractual profit-share percentage of 40%'
  );
  assert(
    tranche1.status === 'ACTIVE',
    'Tranche 1 status is ACTIVE'
  );

  // ---------------------------------------------------------------------------
  // STEP 2: Investor A invests another ৳50 in August (2026-08-20)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Investor A invests another ৳50 in August ---');
  const res2 = await executeInvestmentTrancheTransaction(
    {
      investorId,
      investmentAmount: 50,
      effectiveInvestmentDate: '2026-08-20',
      contractualProfitSharePercentage: 35, // 35% contractual rate for Tranche 2
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      notes: 'Second tranche: ৳50 in August'
    },
    mDb
  );

  const tranche2 = res2.tranche;
  const tranche2Id = tranche2.trancheId || tranche2.id;

  assert(Boolean(tranche2Id), `Tranche 2 created with valid trancheId: ${tranche2Id}`);
  assert(tranche2Id !== tranche1Id, 'Tranche 2 ID is distinct and unique from Tranche 1 ID');

  // Verify all 8 required fields on Tranche 2
  assert(
    tranche2.investorId === investorId && (tranche2.participantId === investorId || !tranche2.participantId),
    `Tranche 2 records correct investor/participant ID (${investorId})`
  );
  assert(
    tranche2.investmentDate === '2026-08-20' || tranche2.effectiveInvestmentDate === '2026-08-20',
    'Tranche 2 records investment date in August (2026-08-20)'
  );
  assert(
    tranche2.effectiveDate === '2026-08-20' || tranche2.effectiveInvestmentDate === '2026-08-20',
    'Tranche 2 records effective date in August (2026-08-20)'
  );
  assert(
    tranche2.originalCapital === 50 || tranche2.investmentAmount === 50,
    'Tranche 2 records original capital of ৳50'
  );
  assert(
    tranche2.currentCapital === 50 || tranche2.currentCapitalBalance === 50,
    'Tranche 2 records current capital of ৳50'
  );
  assert(
    tranche2.contractualProfitSharePercentage === 35,
    'Tranche 2 records contractual profit-share percentage of 35%'
  );
  assert(
    tranche2.status === 'ACTIVE',
    'Tranche 2 status is ACTIVE'
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Verification of Separate Traceability (No Historical Record Merging)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verification of Separate Traceability ---');
  const allTranchesForA = await getTranchesForInvestor(investorId, mDb);

  assert(
    allTranchesForA.length === 2,
    `Investor A has exactly 2 separate tranches (NOT merged into one historical record)`
  );

  const retrievedT1 = allTranchesForA.find((t) => (t.trancheId || t.id) === tranche1Id);
  const retrievedT2 = allTranchesForA.find((t) => (t.trancheId || t.id) === tranche2Id);

  assert(retrievedT1 !== undefined, 'Tranche 1 (January) is independently retrievable');
  assert(retrievedT2 !== undefined, 'Tranche 2 (August) is independently retrievable');

  // Verify Tranche 1 was not overwritten or corrupted
  assert(
    (retrievedT1?.originalCapital === 100 || retrievedT1?.investmentAmount === 100) &&
    (retrievedT1?.investmentDate === '2026-01-15' || retrievedT1?.effectiveInvestmentDate === '2026-01-15') &&
    retrievedT1?.contractualProfitSharePercentage === 40,
    'Tranche 1 preserves original ৳100 capital, January date, and 40% rate'
  );

  // Verify Tranche 2 preserves its distinct attributes
  assert(
    (retrievedT2?.originalCapital === 50 || retrievedT2?.investmentAmount === 50) &&
    (retrievedT2?.investmentDate === '2026-08-20' || retrievedT2?.effectiveInvestmentDate === '2026-08-20') &&
    retrievedT2?.contractualProfitSharePercentage === 35,
    'Tranche 2 preserves original ৳50 capital, August date, and 35% rate'
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Investor-Level Cumulative Totals Derived from Tranches
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Investor-Level Cumulative Totals ---');
  const updatedInvestor = await mDb.investors.get(investorId);

  const sumOriginalCapital = allTranchesForA.reduce(
    (sum, t) => sum + (t.originalCapital ?? t.investmentAmount),
    0
  );
  const sumCurrentCapital = allTranchesForA.reduce(
    (sum, t) => sum + (t.currentCapital ?? t.currentCapitalBalance ?? t.investmentAmount),
    0
  );

  assert(
    sumOriginalCapital === 150,
    'Sum of original capital from tranches is ৳150 (100 + 50)'
  );
  assert(
    sumCurrentCapital === 150,
    'Sum of current capital from tranches is ৳150 (100 + 50)'
  );
  assert(
    updatedInvestor?.capitalContributed === 150 || updatedInvestor?.capitalAmount === 150,
    'Investor record cumulative capital is ৳150 (derived from both tranches)'
  );
  assert(
    updatedInvestor?.currentCapitalBalance === 150,
    'Investor record current capital balance is ৳150'
  );

  // ---------------------------------------------------------------------------
  // STEP 5: Independent Identity Invariant Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Independent Identity Invariants ---');
  assert(
    retrievedT1?.id !== retrievedT2?.id,
    'Both tranches have strictly distinct primary IDs'
  );
  assert(
    retrievedT1?.contractualProfitSharePercentage !== retrievedT2?.contractualProfitSharePercentage,
    'Both tranches maintain strictly independent contractual percentages (40% vs 35%)'
  );
  assert(
    retrievedT1?.effectiveInvestmentDate !== retrievedT2?.effectiveInvestmentDate,
    'Both tranches maintain strictly independent effective investment dates (Jan vs Aug)'
  );

  console.log('\n================================================================');
  console.log(`PROMPT 02 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testPrompt02TrancheStructure.ts') ||
    process.argv[1].endsWith('testPrompt02TrancheStructure.js'));

if (isDirectRun) {
  runPrompt02TrancheStructureTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 02 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 02 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 02 tests:', err);
      process.exit(1);
    });
}
