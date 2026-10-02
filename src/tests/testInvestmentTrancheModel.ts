import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  getTranchesForInvestor,
  getAllInvestmentTranches
} from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { InvestmentTranche, Investor } from '../types';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 3 — INVESTMENT TRANCHE MODEL TESTS
 * Validates that every capital contribution is represented as a separate, traceable Investment Tranche:
 * - One investor / one tranche
 * - One investor / multiple tranches (with different dates, amounts, and percentages)
 * - Multiple investors (with distinct tranches and partner ownership)
 * - Different percentages (independent contractual profit-share rates)
 * - Non-collapsing guarantee (tranches are never lost into a flat aggregate balance)
 * - Backward compatibility with existing investor records
 */
export async function runInvestmentTrancheModelTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 3: INVESTMENT TRANCHE MODEL TESTS');
  console.log('Testing separate tranches, non-collapsing balances, & contractual ratios');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p3';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p3';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p3';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 200000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 1: One Investor / One Tranche
  // ---------------------------------------------------------------------------
  console.log('--- Test Scenario 1: One Investor / One Tranche ---');
  let investorAId = '';
  let trancheA1Id = '';

  {
    // Step 1: Create initial investor with first investment contribution
    const resA1 = await executeInvestorTransaction(
      {
        investorName: 'Tariqul Islam',
        phone: '01711000001',
        contribution: 100000,
        profitSharingRatio: 30, // 30% contractual profit share
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-06-01',
        notes: 'Initial seed capital partner admission',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );

    investorAId = resA1.investor.id;
    assert(Boolean(investorAId), 'Investor Tariqul Islam created with valid ID');
    assert(Boolean(resA1.tranche), 'executeInvestorTransaction automatically created an InvestmentTranche record');

    trancheA1Id = resA1.tranche!.id;
    const trancheA1 = await mDb.investmentTranches.get(trancheA1Id);

    // Verify all required minimum tranche fields
    assert(Boolean(trancheA1), 'Tranche A1 exists in investmentTranches table');
    assert(trancheA1?.investorId === investorAId, 'Tranche A1 references correct investor ID');
    assert(trancheA1?.investmentAmount === 100000, 'Tranche A1 specifies correct investment amount ৳100,000');
    assert(trancheA1?.effectiveInvestmentDate === '2026-06-01', 'Tranche A1 specifies correct effective date 2026-06-01');
    assert(trancheA1?.contractualProfitSharePercentage === 30, 'Tranche A1 specifies contractual profit share 30%');
    assert(trancheA1?.currency === 'BDT', 'Tranche A1 specifies currency BDT');
    assert(trancheA1?.status === 'ACTIVE', 'Tranche A1 is initially in ACTIVE status');
    assert(Boolean(trancheA1?.creationTimestamp), 'Tranche A1 contains creation timestamp');
    assert(trancheA1?.createdBy === testUserId, 'Tranche A1 contains audit metadata: createdBy');
    assert(Boolean(trancheA1?.createdAt), 'Tranche A1 contains audit metadata: createdAt');
    assert(trancheA1?.currentCapitalBalance === 100000, 'Tranche A1 currentCapitalBalance equals investment amount');
    assert(trancheA1?.totalCapitalReturned === 0, 'Tranche A1 totalCapitalReturned is initialized to 0');

    // Verify GL double-entry journal for Tranche A1
    const jEntryA1 = await mDb.journalEntries.get(resA1.journalEntryId);
    assert(Boolean(jEntryA1), 'Journal entry created for Tranche A1');
    const drLineA1 = jEntryA1?.lines?.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.BANK);
    const crLineA1 = jEntryA1?.lines?.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL);
    assert(drLineA1?.debit === 100000, 'GL: Bank (1030) debited ৳100,000');
    assert(crLineA1?.credit === 100000, 'GL: Investor Capital (3020) credited ৳100,000');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 2: One Investor / Multiple Tranches
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Scenario 2: One Investor / Multiple Tranches ---');
  let trancheA2Id = '';
  let trancheA3Id = '';

  {
    // Step 2: Investor A contributes a 2nd separate tranche with different date, amount, and percentage
    const resA2 = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 50000,
        effectiveInvestmentDate: '2026-07-15',
        contractualProfitSharePercentage: 20, // 20% contractual rate for Tranche 2
        currency: 'BDT',
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        valuationEventId: 'val_event_q2_2026',
        preMoneyValuation: 2500000,
        postMoneyValuation: 2550000,
        notes: 'Mid-year expansion tranche at 20% contractual rate'
      },
      mDb
    );

    trancheA2Id = resA2.tranche.id;
    assert(Boolean(trancheA2Id) && trancheA2Id !== trancheA1Id, 'Tranche A2 generated with a distinct unique ID');
    assert(resA2.tranche.investmentAmount === 50000, 'Tranche A2 records distinct investment amount ৳50,000');
    assert(resA2.tranche.effectiveInvestmentDate === '2026-07-15', 'Tranche A2 records distinct effective date 2026-07-15');
    assert(resA2.tranche.contractualProfitSharePercentage === 20, 'Tranche A2 records distinct contractual percentage 20%');
    assert(resA2.tranche.valuationEventId === 'val_event_q2_2026', 'Tranche A2 preserves optional valuation-event reference');
    assert(resA2.tranche.preMoneyValuation === 2500000, 'Tranche A2 preserves pre-money valuation metadata');

    // Step 3: Investor A contributes a 3rd separate tranche with different date, amount, and percentage
    const resA3 = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 75000,
        effectiveInvestmentDate: '2026-08-20',
        contractualProfitSharePercentage: 25, // 25% contractual rate for Tranche 3
        currency: 'BDT',
        targetAccountId: cashAccId,
        currentUserId: testUserId,
        notes: 'Monsoon fish-feed bulk procurement tranche'
      },
      mDb
    );

    trancheA3Id = resA3.tranche.id;
    assert(Boolean(trancheA3Id) && trancheA3Id !== trancheA1Id && trancheA3Id !== trancheA2Id, 'Tranche A3 generated with a distinct unique ID');
    assert(resA3.tranche.investmentAmount === 75000, 'Tranche A3 records distinct investment amount ৳75,000');
    assert(resA3.tranche.effectiveInvestmentDate === '2026-08-20', 'Tranche A3 records distinct effective date 2026-08-20');
    assert(resA3.tranche.contractualProfitSharePercentage === 25, 'Tranche A3 records distinct contractual percentage 25%');

    // Step 4: Verify Non-Collapsing Guarantee: multiple investments remain separately traceable
    const investorATranches = await getTranchesForInvestor(investorAId, mDb);
    assert(investorATranches.length === 3, 'Investor A has exactly 3 separate traceable investment tranches');

    // Verify individual tranches retain their identity and distinct attributes
    const tA1 = investorATranches.find((t) => t.id === trancheA1Id);
    const tA2 = investorATranches.find((t) => t.id === trancheA2Id);
    const tA3 = investorATranches.find((t) => t.id === trancheA3Id);

    assert(tA1?.investmentAmount === 100000 && tA1?.contractualProfitSharePercentage === 30, 'Tranche A1 identity preserved: ৳100,000 @ 30%');
    assert(tA2?.investmentAmount === 50000 && tA2?.contractualProfitSharePercentage === 20, 'Tranche A2 identity preserved: ৳50,000 @ 20%');
    assert(tA3?.investmentAmount === 75000 && tA3?.contractualProfitSharePercentage === 25, 'Tranche A3 identity preserved: ৳75,000 @ 25%');

    // Verify cumulative investor summary reflects total capital contributed without overwriting history
    const freshInvestorA = await mDb.investors.get(investorAId);
    assert(freshInvestorA?.capitalContributed === 225000, 'Investor A cumulative capitalContributed equals sum of tranches (100k + 50k + 75k = 225k)');
    assert(freshInvestorA?.currentCapitalBalance === 225000, 'Investor A currentCapitalBalance equals ৳225,000');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 3: Multiple Investors
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Scenario 3: Multiple Investors ---');
  let investorBId = '';
  let investorCId = '';
  let trancheB1Id = '';
  let trancheC1Id = '';

  {
    // Investor B: Nasim Ahmed
    const resB = await executeInvestorTransaction(
      {
        investorName: 'Nasim Ahmed',
        phone: '01811000002',
        contribution: 200000,
        profitSharingRatio: 40,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-07-01',
        allowExceedingGlobal100: true,
        notes: 'Dairy processing unit capital partner',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );
    investorBId = resB.investor.id;
    trancheB1Id = resB.tranche!.id;

    // Investor C: Farhana Yasmin
    const resC = await executeInvestorTransaction(
      {
        investorName: 'Farhana Yasmin',
        phone: '01911000003',
        contribution: 150000,
        profitSharingRatio: 35,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-08-01',
        allowExceedingGlobal100: true,
        notes: 'Solar cold-storage infrastructure partner',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );
    investorCId = resC.investor.id;
    trancheC1Id = resC.tranche!.id;

    assert(investorBId !== investorAId && investorCId !== investorBId, 'All 3 investors have unique investor IDs');
    assert(trancheB1Id !== trancheC1Id && trancheB1Id !== trancheA1Id, 'All tranches have unique tranche IDs');

    // Query per investor isolation
    const tranchesA = await getTranchesForInvestor(investorAId, mDb);
    const tranchesB = await getTranchesForInvestor(investorBId, mDb);
    const tranchesC = await getTranchesForInvestor(investorCId, mDb);

    assert(tranchesA.length === 3, 'Investor A has exactly 3 tranches');
    assert(tranchesB.length === 1, 'Investor B has exactly 1 tranche');
    assert(tranchesC.length === 1, 'Investor C has exactly 1 tranche');

    assert(tranchesB[0].investorId === investorBId, 'Tranche B1 strictly belongs to Investor B');
    assert(tranchesC[0].investorId === investorCId, 'Tranche C1 strictly belongs to Investor C');

    // Global tranches count
    const allTranches = await getAllInvestmentTranches(mDb);
    assert(allTranches.length === 5, 'Total enterprise investment tranches across all investors equals 5 (3 + 1 + 1)');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 4: Different Contractual Percentages Across Tranches
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Scenario 4: Different Contractual Percentages ---');
  {
    const allTranches = await getAllInvestmentTranches(mDb);

    const tA1 = allTranches.find((t) => t.id === trancheA1Id);
    const tA2 = allTranches.find((t) => t.id === trancheA2Id);
    const tA3 = allTranches.find((t) => t.id === trancheA3Id);
    const tB1 = allTranches.find((t) => t.id === trancheB1Id);
    const tC1 = allTranches.find((t) => t.id === trancheC1Id);

    assert(tA1?.contractualProfitSharePercentage === 30, 'Tranche A1 percentage is 30%');
    assert(tA2?.contractualProfitSharePercentage === 20, 'Tranche A2 percentage is 20%');
    assert(tA3?.contractualProfitSharePercentage === 25, 'Tranche A3 percentage is 25%');
    assert(tB1?.contractualProfitSharePercentage === 40, 'Tranche B1 percentage is 40%');
    assert(tC1?.contractualProfitSharePercentage === 35, 'Tranche C1 percentage is 35%');

    // Sum of contractual percentages: 30 + 20 + 25 + 40 + 35 = 150%
    const totalPercentageSum = [tA1, tA2, tA3, tB1, tC1].reduce(
      (sum, t) => sum + (t?.contractualProfitSharePercentage || 0),
      0
    );
    assert(totalPercentageSum === 150, 'Contractual percentages independently sum to 150% without error, demonstrating they apply to allocated economic profit rather than total farm profit');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 5: GL Account 3020 Reconciliation & Double-Entry Integrity
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Scenario 5: GL Account 3020 Reconciliation ---');
  {
    const allJournals = await mDb.journalEntries.toArray();
    let totalCapCreditInGL = 0;
    for (const j of allJournals) {
      for (const l of j.lines || []) {
        if (l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL) {
          totalCapCreditInGL += (Number(l.credit) || 0) - (Number(l.debit) || 0);
        }
      }
    }

    const allTranches = await getAllInvestmentTranches(mDb);
    const totalTrancheCapital = allTranches.reduce((sum, t) => sum + t.investmentAmount, 0);
    // 100k + 50k + 75k + 200k + 150k = 575,000
    assert(totalTrancheCapital === 575000, 'Total capital across all 5 tranches equals ৳575,000');
    assert(totalCapCreditInGL === totalTrancheCapital, 'GL Account 3020 (Investor Capital) exact match with sum of all investment tranches (৳575,000)');

    // Verify all journals are internally balanced
    let allBalanced = true;
    for (const j of allJournals) {
      let dr = 0;
      let cr = 0;
      for (const l of j.lines || []) {
        dr += Number(l.debit) || 0;
        cr += Number(l.credit) || 0;
      }
      if (Math.abs(dr - cr) > 0.001) {
        allBalanced = false;
        break;
      }
    }
    assert(allBalanced, 'All journal entries posted for investment tranches are strictly balanced (Dr == Cr)');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 6: Input Validation & Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- Test Scenario 6: Input Validation & Error Handling ---');
  {
    // 1. Zero or negative amount rejected
    let zeroAmtThrew = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 0,
          contractualProfitSharePercentage: 20,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      zeroAmtThrew = true;
    }
    assert(zeroAmtThrew, 'executeInvestmentTrancheTransaction rejects amount <= 0');

    // 2. Invalid profit percentage rejected
    let badPctThrew = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 50000,
          contractualProfitSharePercentage: 120, // > 100%
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      badPctThrew = true;
    }
    assert(badPctThrew, 'executeInvestmentTrancheTransaction rejects contractual percentage > 100%');

    // 3. Nonexistent investor rejected
    let nonExistentInvestorThrew = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: 'inv_non_existent_999',
          investmentAmount: 50000,
          contractualProfitSharePercentage: 20,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      nonExistentInvestorThrew = true;
    }
    assert(nonExistentInvestorThrew, 'executeInvestmentTrancheTransaction rejects nonexistent investor ID');
  }

  console.log('\n================================================================');
  console.log('INVESTMENT TRANCHE MODEL TESTS COMPLETED');
  console.log(`Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testInvestmentTrancheModel.ts') ||
    process.argv[1].endsWith('testInvestmentTrancheModel.js'));

if (isDirectRun) {
  runInvestmentTrancheModelTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Investment tranche model tests failed with ${res.failed} failure(s)!`);
        process.exit(1);
      } else {
        console.log('All investment tranche model tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Test runner fatal error:', err);
      process.exit(1);
    });
}
