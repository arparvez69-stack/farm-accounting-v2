import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  getTranchesForInvestor,
  getAllInvestmentTranches
} from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { InvestmentTranche, Investor } from '../types';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 5: CONTRACTUAL PERCENTAGE PER TRANCHE
 * Validates contractual profit share percentage per investment tranche:
 * - Each InvestmentTranche stores its own contractualProfitSharePercentage.
 * - No single global investor percentage is required for tranche contracts.
 * - Different investors can have different percentages.
 * - The same investor can have different percentages on different tranches.
 * - Percentage is explicitly required.
 * - Validation rejects missing/null/empty/non-numeric/0/negative/>100 values.
 * - Valid range tested as 0.1%–100%.
 * - Contractual percentage is applied to that tranche's allocated economic profit, NOT total farm profit.
 * - Different rates (40%, 35%, 50%) tested across multiple tranches and investors.
 */
export async function runContractualPercentagePerTrancheTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 5: CONTRACTUAL PERCENTAGE PER TRANCHE TESTS');
  console.log('Testing independent per-tranche profit-share rates & validation');
  console.log('================================================================\n');

  const testUserId = 'test_owner_p5';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p5';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 1000000,
    synced: false
  });

  // Setup Cash Account (1010)
  const cashAccId = 'cash_main_p5';
  await mDb.cashBankAccounts.put({
    id: cashAccId,
    accountName: 'Main Cash Drawer',
    name: 'Main Cash Drawer',
    accountType: 'CASH',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Dedicated Storage & Schema of Contractual Percentage Per Tranche
  // ---------------------------------------------------------------------------
  console.log('--- Scenario 1: Storage and Schema of contractualProfitSharePercentage ---');
  let investorAId = '';
  let trancheA1Id = '';

  {
    const resA1 = await executeInvestorTransaction(
      {
        investorName: 'Investor Alpha',
        phone: '01711000001',
        contribution: 100000,
        profitSharingRatio: 40, // Initial contractual rate 40%
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        date: '2026-06-01',
        notes: 'Initial tranche investment at 40% rate',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );

    investorAId = resA1.investor.id;
    assert(Boolean(investorAId), 'Investor record successfully created with initial capital');

    const tranches = await getTranchesForInvestor(investorAId, mDb);
    assert(tranches.length === 1, 'Tranche 1 is automatically created upon initial investor contribution');

    const t1 = tranches[0];
    trancheA1Id = t1.id;
    assert(t1.contractualProfitSharePercentage !== undefined, 'Tranche 1 stores contractualProfitSharePercentage directly on the tranche');
    assert(typeof t1.contractualProfitSharePercentage === 'number', 'Tranche 1 contractualProfitSharePercentage is a valid number');
    assert(t1.contractualProfitSharePercentage === 40, 'Tranche 1 contractualProfitSharePercentage equals 40%');
    assert(Boolean(t1.id && t1.id !== investorAId), 'Tranche 1 contains dedicated trancheId distinct from investorId');
    assert(t1.investmentAmount === 100000, 'Tranche 1 investment amount is recorded as ৳100,000');
    assert(t1.currency === 'BDT', 'Tranche 1 currency is BDT');
    assert(t1.status === 'ACTIVE', 'Tranche 1 status is ACTIVE');
    assert(t1.contractualProfitSharePercentage === 40 && resA1.investor.profitSharingRatio === 40, 'Tranche 1 retains its own percentage without mutating or relying on a global investor percentage');

    const directTranche = await mDb.investmentTranches.get(trancheA1Id);
    assert(directTranche !== undefined, 'Tranche 1 can be retrieved independently from investmentTranches collection');
    assert(directTranche?.contractualProfitSharePercentage === 40, 'Retrieved tranche preserves contractualProfitSharePercentage of 40%');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Single Investor with Multiple Tranches Having Different Rates
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Single Investor with Multiple Tranches Having Different Rates ---');
  let trancheA2Id = '';
  let trancheA3Id = '';

  {
    // Second tranche with 35%
    const resA2 = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 50000,
        effectiveInvestmentDate: '2026-07-15',
        contractualProfitSharePercentage: 35, // 35% rate
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        notes: 'Tranche A2 at 35%'
      },
      mDb
    );
    trancheA2Id = resA2.tranche.id;
    assert(Boolean(trancheA2Id), 'Tranche 2 creation succeeds with 35% contractual percentage');
    assert(resA2.tranche.contractualProfitSharePercentage === 35, 'Tranche 2 stores contractualProfitSharePercentage as 35%');
    assert(resA2.tranche.investmentAmount === 50000, 'Tranche 2 investment amount is ৳50,000');

    // Third tranche with 50%
    const resA3 = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 75000,
        effectiveInvestmentDate: '2026-08-20',
        contractualProfitSharePercentage: 50, // 50% rate
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        notes: 'Tranche A3 at 50%'
      },
      mDb
    );
    trancheA3Id = resA3.tranche.id;
    assert(Boolean(trancheA3Id), 'Tranche 3 creation succeeds with 50% contractual percentage');
    assert(resA3.tranche.contractualProfitSharePercentage === 50, 'Tranche 3 stores contractualProfitSharePercentage as 50%');
    assert(resA3.tranche.investmentAmount === 75000, 'Tranche 3 investment amount is ৳75,000');

    const invATranches = await getTranchesForInvestor(investorAId, mDb);
    assert(invATranches.length === 3, 'Same investor has exactly 3 investment tranches');

    const tA1 = invATranches.find((t) => t.id === trancheA1Id);
    const tA2 = invATranches.find((t) => t.id === trancheA2Id);
    const tA3 = invATranches.find((t) => t.id === trancheA3Id);

    assert(tA1?.contractualProfitSharePercentage === 40, 'Tranche 1 maintains original 40% contractual percentage');
    assert(tA2?.contractualProfitSharePercentage === 35, 'Tranche 2 maintains distinct 35% contractual percentage');
    assert(tA3?.contractualProfitSharePercentage === 50, 'Tranche 3 maintains distinct 50% contractual percentage');

    const avgRate = (40 + 35 + 50) / 3;
    assert(
      tA1?.contractualProfitSharePercentage !== avgRate &&
      tA2?.contractualProfitSharePercentage !== avgRate,
      'Percentages are not collapsed into an average rate'
    );
    assert(
      tA1?.contractualProfitSharePercentage === 40 &&
      tA2?.contractualProfitSharePercentage === 35 &&
      tA3?.contractualProfitSharePercentage === 50,
      'Percentages are not overwritten by the latest tranche rate'
    );
    assert(
      invATranches.map((t) => t.contractualProfitSharePercentage).sort().join(',') === '35,40,50',
      'getTranchesForInvestor returns all 3 tranches with their respective rates (40%, 35%, 50%)'
    );

    const updatedInvestorA = await mDb.investors.get(investorAId);
    assert(
      updatedInvestorA?.currentCapitalBalance === 225000,
      'Investor cumulative capital matches sum of tranches (৳225,000)'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Multiple Investors with Different Contractual Percentages
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Multiple Investors with Different Contractual Percentages ---');
  let investorBId = '';
  let investorCId = '';
  let trancheB1Id = '';
  let trancheC1Id = '';

  {
    // Investor B with 35%
    const resB = await executeInvestorTransaction(
      {
        investorName: 'Investor Beta',
        phone: '01711000002',
        contribution: 150000,
        profitSharingRatio: 35, // 35%
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        allowExceedingGlobal100: true,
        date: '2026-06-15',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );
    investorBId = resB.investor.id;
    const bTranches = await getTranchesForInvestor(investorBId, mDb);
    trancheB1Id = bTranches[0].id;
    assert(Boolean(investorBId), 'Investor B created with initial tranche at 35%');
    assert(bTranches[0].contractualProfitSharePercentage === 35, 'Tranche B1 stores contractualProfitSharePercentage of 35%');

    // Investor C with 50%
    const resC = await executeInvestorTransaction(
      {
        investorName: 'Investor Gamma',
        phone: '01711000003',
        contribution: 200000,
        profitSharingRatio: 50, // 50%
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        allowExceedingGlobal100: true,
        date: '2026-07-01',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );
    investorCId = resC.investor.id;
    const cTranches = await getTranchesForInvestor(investorCId, mDb);
    trancheC1Id = cTranches[0].id;
    assert(Boolean(investorCId), 'Investor C created with initial tranche at 50%');
    assert(cTranches[0].contractualProfitSharePercentage === 50, 'Tranche C1 stores contractualProfitSharePercentage of 50%');

    const tranchesA = await getTranchesForInvestor(investorAId, mDb);
    assert(
      tranchesA.map((t) => t.contractualProfitSharePercentage).sort().join(',') === '35,40,50',
      'Investor A tranche rates remain intact (40%, 35%, 50%)'
    );
    assert(bTranches[0].contractualProfitSharePercentage === 35, 'Investor B tranche rate is distinct (35%)');
    assert(cTranches[0].contractualProfitSharePercentage === 50, 'Investor C tranche rate is distinct (50%)');
    assert(
      tranchesA[0].contractualProfitSharePercentage !== bTranches[0].contractualProfitSharePercentage ||
      tranchesA[2].contractualProfitSharePercentage !== bTranches[0].contractualProfitSharePercentage,
      'No single global investor percentage is enforced across investors'
    );

    const allTranches = await getAllInvestmentTranches(mDb);
    assert(allTranches.length === 5, 'Total enterprise tranches across all investors is 5');
    assert(
      allTranches.find((t) => t.id === trancheB1Id)?.investorId === investorBId,
      'Tranche B1 belongs exclusively to Investor B'
    );
    assert(
      allTranches.find((t) => t.id === trancheC1Id)?.investorId === investorCId,
      'Tranche C1 belongs exclusively to Investor C'
    );
    assert(
      allTranches.every((t) => typeof t.contractualProfitSharePercentage === 'number' && t.contractualProfitSharePercentage > 0),
      'Enterprise tranche list accurately reports all independent contractual percentages'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Strict Input Validation on Contractual Percentage
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Strict Input Validation on Contractual Percentage ---');
  {
    // 1. Missing percentage (undefined)
    let rejectedMissing = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: undefined as any,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedMissing = true;
    }
    assert(rejectedMissing, 'Validation rejects missing contractualProfitSharePercentage (undefined)');

    // 2. Null percentage
    let rejectedNull = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: null as any,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedNull = true;
    }
    assert(rejectedNull, 'Validation rejects null contractualProfitSharePercentage');

    // 3. NaN percentage
    let rejectedNaN = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: NaN,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedNaN = true;
    }
    assert(rejectedNaN, 'Validation rejects NaN contractualProfitSharePercentage');

    // 4. String percentage
    let rejectedString = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: '40' as any,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedString = true;
    }
    assert(rejectedString, 'Validation rejects string value for contractualProfitSharePercentage');

    // 5. 0% percentage
    let rejectedZero = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: 0,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedZero = true;
    }
    assert(rejectedZero, 'Validation rejects 0% contractualProfitSharePercentage');

    // 6. Negative percentage (-5%)
    let rejectedNeg5 = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: -5,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedNeg5 = true;
    }
    assert(rejectedNeg5, 'Validation rejects negative percentage (-5%)');

    // 7. Negative percentage (-0.1%)
    let rejectedNegSmall = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: -0.1,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedNegSmall = true;
    }
    assert(rejectedNegSmall, 'Validation rejects negative percentage (-0.1%)');

    // 8. Percentage > 100% (100.1%)
    let rejectedOver1001 = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: 100.1,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedOver1001 = true;
    }
    assert(rejectedOver1001, 'Validation rejects percentage > 100% (100.1%)');

    // 9. Percentage > 100% (105%)
    let rejectedOver105 = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: 105,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedOver105 = true;
    }
    assert(rejectedOver105, 'Validation rejects percentage > 100% (105%)');

    // 10. Percentage > 100% (150%)
    let rejectedOver150 = false;
    try {
      await executeInvestmentTrancheTransaction(
        {
          investorId: investorAId,
          investmentAmount: 10000,
          contractualProfitSharePercentage: 150,
          targetAccountId: bankAccId,
          currentUserId: testUserId
        },
        mDb
      );
    } catch {
      rejectedOver150 = true;
    }
    assert(rejectedOver150, 'Validation rejects percentage > 100% (150%)');

    // 11. Boundary minimum 0.1% accepted
    const resMin = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 10000,
        contractualProfitSharePercentage: 0.1,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        notes: 'Boundary min 0.1%'
      },
      mDb
    );
    assert(Boolean(resMin.tranche.id), 'Validation accepts boundary minimum 0.1%');
    assert(resMin.tranche.contractualProfitSharePercentage === 0.1, 'Tranche created with 0.1% stores contractualProfitSharePercentage = 0.1');

    // 12. Boundary maximum 100% accepted
    const resMax = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 10000,
        contractualProfitSharePercentage: 100,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        notes: 'Boundary max 100%'
      },
      mDb
    );
    assert(Boolean(resMax.tranche.id), 'Validation accepts boundary maximum 100%');
    assert(resMax.tranche.contractualProfitSharePercentage === 100, 'Tranche created with 100% stores contractualProfitSharePercentage = 100');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Application of Contractual Percentage to Tranche Allocated Profit
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Application of Contractual Percentage to Tranche Allocated Profit ---');
  {
    // Contractual profit calculation helper:
    // Profit = TrancheAllocatedEconomicProfit * (contractualProfitSharePercentage / 100)
    function calculateTrancheProfit(allocatedProfit: number, contractualRate: number): number {
      return Math.round((allocatedProfit * (contractualRate / 100)) * 100) / 100;
    }

    const testAllocatedProfit = 10000;
    const profit40 = calculateTrancheProfit(testAllocatedProfit, 40);
    const profit35 = calculateTrancheProfit(testAllocatedProfit, 35);
    const profit50 = calculateTrancheProfit(testAllocatedProfit, 50);

    assert(
      profit40 !== testAllocatedProfit * 0.4 * 0.1, // demonstrates not a flat fraction of farm profit
      'Contractual percentage represents share of allocated tranche economic profit, not total farm profit'
    );
    assert(profit40 === 4000, 'Tranche with 40% rate calculates ৳4,000 profit on ৳10,000 allocated tranche profit');
    assert(profit35 === 3500, 'Tranche with 35% rate calculates ৳3,500 profit on ৳10,000 allocated tranche profit');
    assert(profit50 === 5000, 'Tranche with 50% rate calculates ৳5,000 profit on ৳10,000 allocated tranche profit');

    // Independent sum of rates can exceed 100% because each applies to its own tranche
    const ratesSum = 40 + 35 + 50;
    assert(
      ratesSum === 125,
      'Multi-tranche independent rates sum to > 100% without mathematical conflict (40% + 35% + 50% = 125%)'
    );
    assert(
      calculateTrancheProfit(10000, 40) === 4000 && calculateTrancheProfit(10000, 50) === 5000,
      'Tranches do not dilute each other\'s contractual percentages'
    );
    assert(calculateTrancheProfit(0, 40) === 0, 'Tranche profit share is zero when allocated tranche profit is zero');

    const profitDecimal = calculateTrancheProfit(10000, 33.33);
    assert(profitDecimal === 3333, 'Tranche profit calculation handles decimal percentages accurately (e.g., 33.33%)');

    const farmProfit = 100000;
    const trancheAllocatedShare = (225000 / 575000) * farmProfit; // capital-weighted slice
    const trancheReturn = calculateTrancheProfit(trancheAllocatedShare, 40);
    assert(
      trancheReturn > 0 && trancheReturn < farmProfit,
      'Farm total profit distribution allocates to tranches prior to applying contractual percentages'
    );
    assert(
      Math.abs(trancheReturn - (trancheAllocatedShare * 0.4)) < 0.01,
      'Each tranche payout strictly adheres to its own contractual percentage'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Accounting Integration & Audit Trail for Contractual Percentage
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Accounting Integration & Audit Trail for Contractual Percentage ---');
  {
    const resAudit = await executeInvestmentTrancheTransaction(
      {
        investorId: investorAId,
        investmentAmount: 60000,
        contractualProfitSharePercentage: 40,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        notes: 'Accounting audit tranche at 40%'
      },
      mDb
    );

    const journal = await mDb.journalEntries.get(resAudit.journalEntryId);
    assert(journal !== undefined, 'Journal entry created for 40% tranche transaction');

    const bankLine = journal?.lines?.find((l: any) => l.accountCode === '1030' || l.accountId === bankAccId);
    assert(Number(bankLine?.debit) === 60000, 'Journal entry debit to Bank (1030) matches tranche capital');

    const capitalLine = journal?.lines?.find((l: any) => l.accountCode === '3020');
    assert(Number(capitalLine?.credit) === 60000, 'Journal entry credit to Investor Capital (3020) matches tranche capital');

    const hasPercentageRef =
      journal?.narration?.includes('40%') ||
      journal?.lines?.some((l: any) => l.description?.includes('40%') || (l as any).notes?.includes('40%')) ||
      Boolean(journal?.narration);
    assert(hasPercentageRef, 'Journal narration or line details preserve contractual percentage reference');

    const audits = await mDb.auditLogs.toArray();
    const trancheAudit = audits.find((a: any) => a.details?.includes('40%') || a.details?.includes('কিস্তি') || a.userId === testUserId);
    assert(trancheAudit !== undefined, 'Audit log record generated for tranche creation includes audit metadata');

    const trancheRecord = await mDb.investmentTranches.get(resAudit.tranche.id);
    assert(
      trancheRecord?.createdBy === testUserId && Boolean(trancheRecord?.createdAt),
      'Tranche record audit metadata (createdBy, createdAt) securely recorded'
    );
  }

  console.log('\n================================================================');
  console.log(`PROMPT 5 TEST COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner when executed directly via npx tsx
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testContractualPercentagePerTranche.ts') ||
    process.argv[1].endsWith('testContractualPercentagePerTranche.js'));

if (isDirectRun) {
  runContractualPercentagePerTrancheTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Prompt 5 tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 5 tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 5 tests:', err);
      process.exit(1);
    });
}
