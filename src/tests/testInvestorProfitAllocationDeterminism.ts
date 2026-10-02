import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction
} from '../services/transactionService';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

interface TestSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

function assert(condition: boolean, message: string, summary: TestSummary) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    summary.failed++;
    summary.failures.push(message);
    console.error(`  ❌ [FAIL] ${message}`);
  }
}

export async function runInvestorProfitAllocationDeterminismTests(): Promise<TestSummary> {
  const summary: TestSummary = {
    name: 'Task B: Investor Profit Allocation Determinism & Anti-Manipulation Suite',
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n================================================================');
  console.log('TASK B: INVESTOR PROFIT ALLOCATION DETERMINISM REGRESSION TEST');
  console.log('================================================================');

  const testUserId = 'usr_deterministic_owner';

  // Helper to create populated DB with 2 investors:
  // Investor A: Capital ৳100, Contract 50%
  // Investor B: Capital ৳200, Contract 60%
  // Closed period: Profit ৳300
  async function setupDeterministicDb() {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    await db.cashBankAccounts.put({
      id: 'bank_det_01',
      accountType: 'BANK',
      name: 'Deterministic Bank',
      currentBalance: 500000,
      synced: false
    });

    const resA = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01711000001',
        contribution: 100,
        profitSharingRatio: 50,
        targetAccountId: 'bank_det_01',
        date: '2026-01-01',
        currentUserId: testUserId,
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      db
    );

    const resB = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01711000002',
        contribution: 200,
        profitSharingRatio: 60,
        targetAccountId: 'bank_det_01',
        date: '2026-01-01',
        currentUserId: testUserId,
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      db
    );

    const cpId = 'cp_2026_q1';
    await db.closedPeriods.put({
      id: cpId,
      periodId: cpId,
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      netProfitTransferred: 300,
      status: 'CLOSED',
      isFinalized: true,
      closedAt: new Date().toISOString()
    });

    return { db, invA: resA.investor, invB: resB.investor, cpId };
  }

  // ===========================================================================
  // 1. Authoritative 5-Stage Deterministic Calculation
  // ===========================================================================
  console.log('\n--- 1. Authoritative 5-Stage Calculation ---');
  {
    const { db, invA, cpId } = await setupDeterministicDb();

    // Call without caller-supplied overrides
    const alloc = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA.id,
        closedPeriodId: cpId,
        economicAllocationMethod: 'CAPITAL_PROPORTION',
        allocationDate: '2026-04-01',
        allocationReference: 'REF-DET-01',
        currentUserId: testUserId
      },
      db
    );

    // 1. Read authoritative finalized business profit = 300
    assert(alloc.finalizedProfit === 300, 'Stage 1: Authoritative finalized profit is strictly ৳300', summary);

    // 2. Economic allocation = 300 * (100 / 300) = 100
    assert(alloc.allocatedEconomicProfit === 100, 'Stage 2: Economic allocation is strictly ৳100 (100/300 of ৳300)', summary);

    // 3. Contractual rate = 50%
    assert(alloc.profitSharingRatio === 50, 'Stage 3: Contractual percentage is strictly 50%', summary);

    // 4. investorProfit = 100 * 50% = 50
    assert(alloc.allocatedProfit === 50, 'Stage 4: investorProfit = economicAllocation × contract% = ৳50', summary);

    // 5. mudaribProfit = 100 - 50 = 50
    assert(alloc.mudaribProfit === 50, 'Stage 5: mudaribProfit = economicAllocation − investorProfit = ৳50', summary);
    assert(alloc.workingPartnerShare === 50, 'Stage 5: workingPartnerShare matches mudaribProfit (৳50)', summary);
    assert(alloc.allocatedProfit + alloc.mudaribProfit === 100, 'Stage 5: investorProfit + mudaribProfit === economicAllocation', summary);

    // GL Journal Posting
    const jEntry = await db.journalEntries.get(alloc.journalEntryId);
    assert(jEntry !== undefined, 'Journal entry exists in ledger', summary);
    const drLine = jEntry?.lines.find((l: any) => l.accountCode === '3070');
    const crLine = jEntry?.lines.find((l: any) => l.accountCode === '2050');
    assert(drLine?.debit === 50, 'Dr 3070 Profit Distribution is strictly ৳50', summary);
    assert(crLine?.credit === 50, 'Cr 2050 Investor Profit Payable is strictly ৳50', summary);
    assert(drLine?.debit === crLine?.credit, 'Accounting Debit = Credit (balanced)', summary);
  }

  // ===========================================================================
  // 2. Strict Determinism: Same Inputs Always Produce the Same Result
  // ===========================================================================
  console.log('\n--- 2. Determinism: Same Inputs Produce Identical Result ---');
  {
    const setup1 = await setupDeterministicDb();
    const setup2 = await setupDeterministicDb();

    const alloc1 = await executeInvestorProfitAllocationTransaction(
      {
        investorId: setup1.invA.id,
        closedPeriodId: setup1.cpId,
        economicAllocationMethod: 'CAPITAL_PROPORTION',
        allocationDate: '2026-04-01',
        allocationReference: 'REF-RUN-1',
        currentUserId: testUserId
      },
      setup1.db
    );

    const alloc2 = await executeInvestorProfitAllocationTransaction(
      {
        investorId: setup2.invA.id,
        closedPeriodId: setup2.cpId,
        economicAllocationMethod: 'CAPITAL_PROPORTION',
        allocationDate: '2026-04-01',
        allocationReference: 'REF-RUN-1',
        currentUserId: testUserId
      },
      setup2.db
    );

    assert(alloc1.finalizedProfit === alloc2.finalizedProfit, 'Deterministic: finalizedProfit is identical across runs', summary);
    assert(alloc1.allocatedEconomicProfit === alloc2.allocatedEconomicProfit, 'Deterministic: allocatedEconomicProfit is identical', summary);
    assert(alloc1.allocatedProfit === alloc2.allocatedProfit, 'Deterministic: allocatedProfit is identical', summary);
    assert(alloc1.mudaribProfit === alloc2.mudaribProfit, 'Deterministic: mudaribProfit is identical', summary);
    assert(alloc1.workingPartnerShare === alloc2.workingPartnerShare, 'Deterministic: workingPartnerShare is identical', summary);
  }

  // ===========================================================================
  // 3. Reject Caller Manipulation Overrides
  // ===========================================================================
  console.log('\n--- 3. Anti-Manipulation: Reject Caller Overrides ---');
  {
    // A. Arbitrary allocatedEconomicProfit override (e.g. caller supplies 250 when true is 100)
    const { db, invA, cpId } = await setupDeterministicDb();
    let economicOverrideCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          economicAllocationMethod: 'CAPITAL_PROPORTION',
          allocatedEconomicProfit: 250, // Manipulated! True is 100
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      economicOverrideCaught = true;
      assert(
        err.message.includes('অননুমোদিত অর্থনৈতিক মুনাফা ওভাররাইড') || err.message.includes('Arbitrary economic profit override rejected'),
        `Manipulated allocatedEconomicProfit rejected: "${err.message}"`,
        summary
      );
    }
    assert(economicOverrideCaught, 'Caller-supplied arbitrary allocatedEconomicProfit override strictly rejected', summary);

    // B. Arbitrary economicProfit override (e.g. caller supplies 999)
    let economicProfitParamCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          economicAllocationMethod: 'CAPITAL_PROPORTION',
          economicProfit: 999, // Manipulated!
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      economicProfitParamCaught = true;
      assert(
        err.message.includes('অননুমোদিত') || err.message.includes('rejected') || err.message.includes('অসঙ্গতিপূর্ণ'),
        `Manipulated economicProfit rejected: "${err.message}"`,
        summary
      );
    }
    assert(economicProfitParamCaught, 'Caller-supplied arbitrary economicProfit parameter strictly rejected', summary);

    // C. Arbitrary actualBusinessProfit override (e.g. caller supplies 5000 when true profit is 300)
    let actualProfitCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          actualBusinessProfit: 5000, // Manipulated! True is 300
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      actualProfitCaught = true;
      assert(
        err.message.includes('অননুমোদিত') || err.message.includes('rejected'),
        `Manipulated actualBusinessProfit rejected: "${err.message}"`,
        summary
      );
    }
    assert(actualProfitCaught, 'Caller-supplied arbitrary actualBusinessProfit strictly rejected', summary);

    // D. Arbitrary finalizedDistributableProfit override (e.g. caller supplies 10000 when closed period is 300)
    let finalizedProfitCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          finalizedDistributableProfit: 10000, // Manipulated! True is 300
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      finalizedProfitCaught = true;
      assert(
        err.message.includes('অননুমোদিত মুনাফা ওভাররাইড') || err.message.includes('Arbitrary manual profit override rejected'),
        `Manipulated finalizedDistributableProfit rejected: "${err.message}"`,
        summary
      );
    }
    assert(finalizedProfitCaught, 'Caller-supplied arbitrary finalizedDistributableProfit strictly rejected', summary);

    // E. Arbitrary contractual percentage override (e.g. caller supplies 90% when contract is 50%)
    let contractOverrideCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          contractualProfitSharePercentage: 90, // Manipulated! True contract is 50%
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      contractOverrideCaught = true;
      assert(
        err.message.includes('চুক্তিভিত্তিক') && (err.message.includes('অনুপাত') || err.message.includes('ওভাররাইড')),
        `Manipulated contractual percentage rejected: "${err.message}"`,
        summary
      );
    }
    assert(contractOverrideCaught, 'Caller-supplied contractual percentage override strictly rejected', summary);

    // F. Arbitrary allocatedProfit override (e.g. caller supplies 250 when true investor profit is 50)
    let allocatedProfitCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          economicAllocationMethod: 'CAPITAL_PROPORTION',
          allocatedProfit: 250, // Manipulated! True is 50
          allocationDate: '2026-04-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      allocatedProfitCaught = true;
      assert(
        err.message.includes('চুক্তিভিত্তিক লভ্যাংশ অনুপাতের'),
        `Manipulated allocatedProfit rejected: "${err.message}"`,
        summary
      );
    }
    assert(allocatedProfitCaught, 'Caller-supplied arbitrary allocatedProfit strictly rejected', summary);
  }

  // ===========================================================================
  // 4. Verified Values That Match Authoritative Result Pass Cleanly
  // ===========================================================================
  console.log('\n--- 4. Verified Values Matching Authoritative Result Pass Cleanly ---');
  {
    const { db, invA, cpId } = await setupDeterministicDb();
    // Caller passes values that match the independently verified authoritative accounting result
    const verifiedAlloc = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA.id,
        closedPeriodId: cpId,
        finalizedDistributableProfit: 300, // Matches closed period 300
        economicAllocationMethod: 'CAPITAL_PROPORTION',
        allocatedEconomicProfit: 100, // Matches verified 100
        allocatedProfit: 50, // Matches verified 50
        allocationDate: '2026-04-01',
        allocationReference: 'REF-VERIFIED-01',
        currentUserId: testUserId
      },
      db
    );

    assert(verifiedAlloc.allocatedProfit === 50, 'Verified call: allocatedProfit is strictly ৳50', summary);
    assert(verifiedAlloc.mudaribProfit === 50, 'Verified call: mudaribProfit is strictly ৳50', summary);
    assert(verifiedAlloc.finalizedProfit === 300, 'Verified call: finalizedProfit is strictly ৳300', summary);
  }

  // ===========================================================================
  // 5. Idempotency & Closed-Period Protection
  // ===========================================================================
  console.log('\n--- 5. Idempotency & Closed-Period Protection ---');
  {
    const { db, invA, cpId } = await setupDeterministicDb();

    // First allocation
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA.id,
        closedPeriodId: cpId,
        economicAllocationMethod: 'CAPITAL_PROPORTION',
        allocationDate: '2026-04-01',
        allocationReference: 'REF-IDEMPOTENT-01',
        idempotencyKey: 'IDEMP-KEY-999',
        currentUserId: testUserId
      },
      db
    );

    // Second allocation with same idempotency key or same period/investor must fail
    let duplicateRejected = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: cpId,
          economicAllocationMethod: 'CAPITAL_PROPORTION',
          allocationDate: '2026-04-01',
          allocationReference: 'REF-IDEMPOTENT-01',
          idempotencyKey: 'IDEMP-KEY-999',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      duplicateRejected = true;
      assert(err.message.includes('ইতোমধ্যে সম্পন্ন হয়েছে') || err.message.includes('Duplicate'), 'Duplicate allocation prevented', summary);
    }
    assert(duplicateRejected, 'Idempotency preserved: duplicate allocation strictly blocked', summary);

    // Unfinalized closed period
    const unfinCpId = 'cp_unfin_det';
    await db.closedPeriods.put({
      id: unfinCpId,
      startDate: '2026-04-01',
      endDate: '2026-06-30',
      netProfitTransferred: 500,
      status: 'OPEN',
      isFinalized: false
    });

    let unfinalizedBlocked = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA.id,
          closedPeriodId: unfinCpId,
          allocationDate: '2026-07-01',
          currentUserId: testUserId
        },
        db
      );
    } catch (err: any) {
      unfinalizedBlocked = true;
      assert(err.message.includes('চূড়ান্ত করা হয়নি') || err.message.includes('Unfinalized'), 'Unfinalized period blocked', summary);
    }
    assert(unfinalizedBlocked, 'Closed-period protection: unfinalized period strictly blocked', summary);
  }

  console.log('\n================================================================');
  console.log(`TASK B RESULT: Passed: ${summary.passed}/${summary.passed + summary.failed}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runInvestorProfitAllocationDeterminismTests().then((res) => {
    if (res.failed > 0) {
      console.error(`Task B: ${res.failed} tests failed!`);
      process.exit(1);
    } else {
      console.log('Task B: All tests passed successfully.');
      process.exit(0);
    }
  });
}
