import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  calculateCapitalParticipationAllocation,
  executeCapitalParticipationAllocation,
  clearValuationEventsForTest,
  clearAdmissionAuditsForTest
} from '../services/valuationService';
import {
  executeInvestorTransaction,
  executeInvestmentTrancheTransaction,
  admitNewInvestorWithValuation
} from '../services/transactionService';
import {
  generateProfitLoss,
  generateTrialBalance,
  postJournalEntry
} from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 11: CAPITAL-PARTICIPATION ALLOCATION REGRESSION SUITE
 *
 * Verifies:
 * 1. Do NOT calculate: Investor Profit = Total Farm Profit × Investor Contract %
 * 2. Determine eligible investor participation according to approved investment/valuation structure.
 * 3. Allocate applicable business profit according to that participation.
 * 4. Apply each tranche's own contractual investor profit-sharing percentage to that tranche's allocated economic profit.
 * 5. Remaining contractual share belongs to the working/business partner according to the agreement.
 * 6. Different investors may have different percentages.
 * 7. Do not allow percentages from one investor to leak into another investor's calculation.
 * 8. Full accounting integrity: Trial Balance balanced, operating P&L untouched, zero/loss rejected.
 */
export async function runCapitalParticipationAllocationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 11: CAPITAL-PARTICIPATION ALLOCATION TESTS');
  console.log('Testing valuation-driven tranche economic participation & non-leakage');
  console.log('================================================================\n');

  clearValuationEventsForTest();
  clearAdmissionAuditsForTest();

  const testUserId = 'test_owner_p11';

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Strict Anti-Pattern Prevention (NOT Total Farm Profit × Contract %)
  // ---------------------------------------------------------------------------
  console.log('--- Scenario 1: Preventing Flat Total Profit × Contract % Anti-Pattern ---');
  {
    const totalFarmProfit = 100000; // ৳100,000
    const tranches = [
      {
        id: 't_alpha_1',
        trancheNumber: 'TR-ALPHA-1',
        investorId: 'inv_alpha',
        investorName: 'Investor Alpha',
        investmentAmount: 200000,
        economicParticipationPercentage: 20, // 20% economic participation
        contractualProfitSharePercentage: 40 // 40% contractual rate
      }
    ];

    const calc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: totalFarmProfit,
      tranches
    });

    const alloc = calc.trancheAllocations[0];
    const flatProfit = totalFarmProfit * 0.40; // ৳40,000 (WRONG anti-pattern!)

    assert(
      alloc.investorProfitShare !== flatProfit,
      `ANTI-PATTERN PREVENTED: Investor profit (৳${alloc.investorProfitShare}) is NOT Total Farm Profit × Contract % (৳${flatProfit})`
    );
    assert(
      alloc.applicableBusinessProfit === 20000,
      `Allocated economic profit is strictly ৳20,000 (20% economic participation of ৳100,000)`
    );
    assert(
      alloc.investorProfitShare === 8000,
      `Investor receives 40% of allocated economic profit: ৳8,000 (40% of ৳20,000)`
    );
    assert(
      alloc.workingPartnerProfitShare === 12000,
      `Working partner receives remaining 60% of tranche economic profit: ৳12,000`
    );
    assert(
      alloc.investorProfitShare + alloc.workingPartnerProfitShare === alloc.applicableBusinessProfit,
      `Tranche economic profit is fully accounted for: ৳8,000 + ৳12,000 === ৳20,000`
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Approved Investment/Valuation-Driven Participation
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Participation Driven by Approved Valuation Structure ---');
  {
    // Post-money valuation = ৳210,000.
    // Founder pre-money value = ৳110,000 (52.38% economic participation).
    // New investor Kamal contributed = ৳100,000 (47.62% economic participation).
    const totalFarmProfit = 200000;
    const tranches = [
      {
        id: 't_kamal_admit',
        trancheNumber: 'TR-KAMAL-01',
        investorId: 'inv_kamal',
        investorName: 'Kamal Hossain',
        investmentAmount: 100000,
        economicParticipationPercentage: 47.62, // From admission valuation audit
        contractualProfitSharePercentage: 40 // Contractual 40%
      },
      {
        id: 't_founder_share',
        trancheNumber: 'TR-FOUNDER-01',
        investorId: 'inv_founder',
        investorName: 'Farid (Founder)',
        investmentAmount: 100000,
        economicParticipationPercentage: 52.38, // From admission valuation audit
        contractualProfitSharePercentage: 50 // Contractual 50%
      }
    ];

    const calc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: totalFarmProfit,
      tranches
    });

    const kamalAlloc = calc.trancheAllocations.find((a) => a.investorId === 'inv_kamal')!;
    const founderAlloc = calc.trancheAllocations.find((a) => a.investorId === 'inv_founder')!;

    assert(kamalAlloc.applicableBusinessProfit === 95240, 'Kamal allocated economic profit is ৳95,240 (47.62% of ৳200,000)');
    assert(kamalAlloc.investorProfitShare === 38096, 'Kamal receives 40% of ৳95,240 = ৳38,096');
    assert(kamalAlloc.workingPartnerProfitShare === 57144, 'Working partner receives 60% of ৳95,240 = ৳57,144');

    assert(founderAlloc.applicableBusinessProfit === 104760, 'Founder allocated economic profit is ৳104,760 (52.38% of ৳200,000)');
    assert(founderAlloc.investorProfitShare === 52380, 'Founder receives 50% of ৳104,760 = ৳52,380');
    assert(founderAlloc.workingPartnerProfitShare === 52380, 'Working partner receives 50% of ৳104,760 = ৳52,380');

    assert(
      kamalAlloc.applicableBusinessProfit + founderAlloc.applicableBusinessProfit === totalFarmProfit,
      'Combined tranche economic profit matches 100% of farm profit (৳95,240 + ৳104,760 = ৳200,000)'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Multi-Investor Independent Percentages & Strict Zero-Leakage
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Different Investors with Different Percentages & Zero Leakage ---');
  {
    const totalFarmProfit = 100000;
    const tranches = [
      {
        id: 't_alpha',
        investorId: 'inv_alpha',
        investorName: 'Investor Alpha',
        investmentAmount: 250000,
        economicParticipationPercentage: 25, // 25% economic participation
        contractualProfitSharePercentage: 40 // 40%
      },
      {
        id: 't_beta',
        investorId: 'inv_beta',
        investorName: 'Investor Beta',
        investmentAmount: 200000,
        economicParticipationPercentage: 20, // 20% economic participation
        contractualProfitSharePercentage: 35 // 35%
      },
      {
        id: 't_gamma',
        investorId: 'inv_gamma',
        investorName: 'Investor Gamma',
        investmentAmount: 150000,
        economicParticipationPercentage: 15, // 15% economic participation
        contractualProfitSharePercentage: 50 // 50%
      }
    ];

    const baseCalc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: totalFarmProfit,
      tranches
    });

    const alphaAlloc = baseCalc.trancheAllocations.find((a) => a.investorId === 'inv_alpha')!;
    const betaAlloc = baseCalc.trancheAllocations.find((a) => a.investorId === 'inv_beta')!;
    const gammaAlloc = baseCalc.trancheAllocations.find((a) => a.investorId === 'inv_gamma')!;

    // Alpha: 25% of 100k = 25k economic profit. 40% of 25k = 10k investor, 15k working partner.
    assert(alphaAlloc.applicableBusinessProfit === 25000, 'Alpha allocated economic profit = ৳25,000');
    assert(alphaAlloc.investorProfitShare === 10000, 'Alpha investor share = ৳10,000 (40%)');
    assert(alphaAlloc.workingPartnerProfitShare === 15000, 'Working partner from Alpha = ৳15,000 (60%)');

    // Beta: 20% of 100k = 20k economic profit. 35% of 20k = 7k investor, 13k working partner.
    assert(betaAlloc.applicableBusinessProfit === 20000, 'Beta allocated economic profit = ৳20,000');
    assert(betaAlloc.investorProfitShare === 7000, 'Beta investor share = ৳7,000 (35%)');
    assert(betaAlloc.workingPartnerProfitShare === 13000, 'Working partner from Beta = ৳13,000 (65%)');

    // Gamma: 15% of 100k = 15k economic profit. 50% of 15k = 7.5k investor, 7.5k working partner.
    assert(gammaAlloc.applicableBusinessProfit === 15000, 'Gamma allocated economic profit = ৳15,000');
    assert(gammaAlloc.investorProfitShare === 7500, 'Gamma investor share = ৳7,500 (50%)');
    assert(gammaAlloc.workingPartnerProfitShare === 7500, 'Working partner from Gamma = ৳7,500 (50%)');

    // Retained business equity: (100% - 25% - 20% - 15%) = 40% = ৳40,000
    assert(baseCalc.retainedBusinessEquityProfit === 40000, 'Retained business equity profit is strictly ৳40,000 (40% unallocated to tranches)');
    // Total working partner earnings: 15k + 13k + 7.5k + 40k = 75.5k
    assert(baseCalc.totalWorkingPartnerEarnings === 75500, 'Total working partner earnings = ৳75,500 (tranche shares + retained equity)');
    // Total investor payouts: 10k + 7k + 7.5k = 24.5k
    assert(baseCalc.totalInvestorProfitShare === 24500, 'Total investor payouts = ৳24,500');
    // Full reconciliation
    assert(
      baseCalc.totalInvestorProfitShare + baseCalc.totalWorkingPartnerEarnings === totalFarmProfit,
      'Full mathematical reconciliation: Total Investor Payouts + Total Working Partner Earnings === Total Farm Profit (24.5k + 75.5k = 100k)'
    );

    // ZERO LEAKAGE AUDIT:
    // If Alpha's contractual rate changes from 40% to 90%, Beta and Gamma MUST remain 100% unchanged!
    const modifiedTranches = [
      { ...tranches[0], contractualProfitSharePercentage: 90 }, // 40% -> 90%
      { ...tranches[1] },
      { ...tranches[2] }
    ];
    const testLeakageCalc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: totalFarmProfit,
      tranches: modifiedTranches
    });

    const betaMod = testLeakageCalc.trancheAllocations.find((a) => a.investorId === 'inv_beta')!;
    const gammaMod = testLeakageCalc.trancheAllocations.find((a) => a.investorId === 'inv_gamma')!;

    assert(
      betaMod.investorProfitShare === betaAlloc.investorProfitShare &&
      betaMod.workingPartnerProfitShare === betaAlloc.workingPartnerProfitShare,
      'ZERO LEAKAGE: Beta payouts strictly identical (৳7,000 / ৳13,000) when Alpha rate changes from 40% to 90%'
    );
    assert(
      gammaMod.investorProfitShare === gammaAlloc.investorProfitShare &&
      gammaMod.workingPartnerProfitShare === gammaAlloc.workingPartnerProfitShare,
      'ZERO LEAKAGE: Gamma payouts strictly identical (৳7,500 / ৳7,500) when Alpha rate changes from 40% to 90%'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Single Investor with Multiple Tranches Having Different Rates
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Single Investor with Multiple Tranches Having Different Rates ---');
  {
    const totalFarmProfit = 100000;
    const tranches = [
      {
        id: 't_alpha_1',
        trancheNumber: 'TR-A1',
        investorId: 'inv_alpha',
        investorName: 'Investor Alpha',
        investmentAmount: 100000,
        economicParticipationPercentage: 10,
        contractualProfitSharePercentage: 40 // 40% rate on Tranche 1
      },
      {
        id: 't_alpha_2',
        trancheNumber: 'TR-A2',
        investorId: 'inv_alpha',
        investorName: 'Investor Alpha',
        investmentAmount: 100000,
        economicParticipationPercentage: 10,
        contractualProfitSharePercentage: 30 // 30% rate on Tranche 2
      }
    ];

    const calc = calculateCapitalParticipationAllocation({
      finalizedBusinessProfit: totalFarmProfit,
      tranches
    });

    const t1Alloc = calc.trancheAllocations.find((a) => a.trancheId === 't_alpha_1' || a.id === 't_alpha_1')!;
    const t2Alloc = calc.trancheAllocations.find((a) => a.trancheId === 't_alpha_2' || a.id === 't_alpha_2')!;

    assert(t1Alloc.investorProfitShare === 4000, 'Tranche 1 (40%) calculates ৳4,000 on ৳10,000 economic slice');
    assert(t1Alloc.workingPartnerProfitShare === 6000, 'Tranche 1 working partner share is ৳6,000 (60%)');

    assert(t2Alloc.investorProfitShare === 3000, 'Tranche 2 (30%) calculates ৳3,000 on ৳10,000 economic slice');
    assert(t2Alloc.workingPartnerProfitShare === 7000, 'Tranche 2 working partner share is ৳7,000 (70%)');

    const invSummary = calc.investorSummary.find((s) => s.investorId === 'inv_alpha')!;
    assert(invSummary.totalInvestorProfitShare === 7000, 'Investor Alpha total profit share is ৳7,000 (4k + 3k)');
    assert(invSummary.trancheCount === 2, 'Investor Alpha summary reflects 2 separate tranches');

    // Confirm rates were not collapsed to average (35%)
    assert(
      t1Alloc.contractualProfitSharePercentage === 40 && t2Alloc.contractualProfitSharePercentage === 30,
      'Tranche rates retained independently without blending to 35%'
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Durable GL Accounting & Execution Integrity
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 5: End-to-End Accounting & GL Persistence ---');
  {
    const mDb = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await mDb.accounts.put(acc);
    }

    await mDb.cashBankAccounts.put({
      id: 'cash_main',
      accountName: 'Main Cash Drawer',
      name: 'Main Cash Drawer',
      accountType: 'CASH',
      currentBalance: 1000000,
      synced: false
    });

    // Setup active investors and tranches in database
    const inv1Res = await executeInvestorTransaction(
      {
        investorName: 'Sultan Ahmed',
        phone: '01811000001',
        contribution: 250000,
        profitSharingRatio: 40,
        targetAccountId: 'cash_main',
        currentUserId: testUserId,
        date: '2026-01-01',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );

    const inv2Res = await executeInvestorTransaction(
      {
        investorName: 'Begum Rokeya',
        phone: '01811000002',
        contribution: 200000,
        profitSharingRatio: 35,
        targetAccountId: 'cash_main',
        currentUserId: testUserId,
        date: '2026-01-01',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      mDb
    );

    // Update tranches with explicit economic participation percentages
    const t1 = (await mDb.investmentTranches.toArray()).find((t: any) => t.investorId === inv1Res.investor.id);
    const t2 = (await mDb.investmentTranches.toArray()).find((t: any) => t.investorId === inv2Res.investor.id);

    await mDb.investmentTranches.update(t1.id, {
      economicParticipationPercentage: 25, // 25% economic share
      contractualProfitSharePercentage: 40
    });
    await mDb.investmentTranches.update(t2.id, {
      economicParticipationPercentage: 20, // 20% economic share
      contractualProfitSharePercentage: 35
    });

    // Post farm revenue (৳300,000) and expenses (৳100,000) -> Net Operating Profit = ৳200,000
    await postJournalEntry(
      {
        id: 'j_p11_rev',
        voucherNumber: 'V-REV-01',
        voucherType: 'RECEIPT',
        date: '2026-03-31',
        narration: 'দুধ ও মাছ বিক্রয়',
        lines: [
          { accountCode: '1010', accountName: 'নগদ তহবিল', debit: 300000, credit: 0 },
          { accountCode: '4010', accountName: 'মাছ বিক্রয় আয়', debit: 0, credit: 300000 }
        ],
        createdBy: testUserId,
        createdAt: '2026-03-31T12:00:00.000Z'
      },
      { dbInstance: mDb }
    );

    await postJournalEntry(
      {
        id: 'j_p11_exp',
        voucherNumber: 'V-EXP-01',
        voucherType: 'PAYMENT',
        date: '2026-03-31',
        narration: 'শ্রমিক মজুরি ও বিদ্যুৎ খরচ',
        lines: [
          { accountCode: '6010', accountName: 'মজুরি ও বেতন', debit: 100000, credit: 0 },
          { accountCode: '1010', accountName: 'নগদ তহবিল', debit: 0, credit: 100000 }
        ],
        createdBy: testUserId,
        createdAt: '2026-03-31T13:00:00.000Z'
      },
      { dbInstance: mDb }
    );

    // Verify pre-allocation P&L
    const prePnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
    assert(prePnl.netProfit === 200000, 'Baseline Farm Business Profit is strictly ৳200,000');

    // Execute Capital Participation Allocation
    const execResult = await executeCapitalParticipationAllocation(
      {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        responsibleUser: testUserId,
        notes: 'Q1 2026 Capital Participation Allocation'
      },
      mDb
    );

    assert(execResult.finalizedBusinessProfit === 200000, 'Allocation confirms finalized business profit of ৳200,000');
    // Investor 1: 25% of 200k = 50,000. 40% of 50,000 = ৳20,000.
    // Investor 2: 20% of 200k = 40,000. 35% of 40,000 = ৳14,000.
    // Total investor share = ৳34,000.
    assert(execResult.totalInvestorProfitShare === 34000, 'Total investor profit share is ৳34,000 (20k + 14k)');

    // Verify post-allocation P&L remains 100% UNTOUCHED
    const postPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-03-31' }, undefined, mDb);
    assert(postPnl.totalRevenue === prePnl.totalRevenue, 'Operating Revenue completely unchanged (৳300,000)');
    assert(postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses, 'Operating Expenses completely unchanged (৳100,000)');
    assert(postPnl.netProfit === prePnl.netProfit, 'Net Operating Profit completely unchanged (৳200,000)');

    // Verify Trial Balance is balanced
    const tb = await generateTrialBalance({ endDate: '2026-03-31' }, mDb);
    assert(tb.isBalanced, 'Trial Balance is strictly balanced post-allocation');
    assert(Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, 'Trial Balance difference is 0');

    // Verify GL entries: Dr 3070 / Cr 2050
    const journals = await mDb.journalEntries.toArray();
    const allocJournals = journals.filter((j: any) => j.reference?.startsWith('ALLOC-CAP-'));
    assert(allocJournals.length === 2, 'Two GL journal entries created for the two investors');

    for (const j of allocJournals) {
      const debitLine = j.lines.find((l: any) => l.debit > 0);
      const creditLine = j.lines.find((l: any) => l.credit > 0);
      assert(debitLine?.accountCode === '3070', 'Debit line is strictly 3070 (Profit Distribution)');
      assert(creditLine?.accountCode === '2050', 'Credit line is strictly 2050 (Investor Profit Payable)');
      assert(debitLine?.debit === creditLine?.credit, 'Journal entry lines strictly balance');
    }

    // Verify investor payable balances updated in database
    const inv1Updated = await mDb.investors.get(inv1Res.investor.id);
    const inv2Updated = await mDb.investors.get(inv2Res.investor.id);
    assert(inv1Updated?.profitPayable === 20000, 'Investor 1 profitPayable balance updated to ৳20,000');
    assert(inv1Updated?.totalProfitAllocated === 20000, 'Investor 1 totalProfitAllocated updated to ৳20,000');
    assert(inv2Updated?.profitPayable === 14000, 'Investor 2 profitPayable balance updated to ৳14,000');
    assert(inv2Updated?.totalProfitAllocated === 14000, 'Investor 2 totalProfitAllocated updated to ৳14,000');
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Input Validation & Zero/Loss Rejection
  // ---------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Validation & Error Handling ---');
  {
    let rejectedZeroProfit = false;
    try {
      calculateCapitalParticipationAllocation({
        finalizedBusinessProfit: 0,
        tranches: [
          {
            id: 't1',
            investorId: 'i1',
            investmentAmount: 10000,
            contractualProfitSharePercentage: 40,
            economicParticipationPercentage: 20
          }
        ]
      });
    } catch {
      rejectedZeroProfit = true;
    }
    assert(rejectedZeroProfit, 'Validation strictly rejects 0 business profit');

    let rejectedLossProfit = false;
    try {
      calculateCapitalParticipationAllocation({
        finalizedBusinessProfit: -50000,
        tranches: [
          {
            id: 't1',
            investorId: 'i1',
            investmentAmount: 10000,
            contractualProfitSharePercentage: 40,
            economicParticipationPercentage: 20
          }
        ]
      });
    } catch {
      rejectedLossProfit = true;
    }
    assert(rejectedLossProfit, 'Validation strictly rejects negative business profit (loss)');

    let rejectedZeroContractRate = false;
    try {
      calculateCapitalParticipationAllocation({
        finalizedBusinessProfit: 100000,
        tranches: [
          {
            id: 't1',
            investorId: 'i1',
            investmentAmount: 10000,
            contractualProfitSharePercentage: 0,
            economicParticipationPercentage: 20
          }
        ]
      });
    } catch {
      rejectedZeroContractRate = true;
    }
    assert(rejectedZeroContractRate, 'Validation rejects 0% contractual percentage');

    let rejectedOver100Rate = false;
    try {
      calculateCapitalParticipationAllocation({
        finalizedBusinessProfit: 100000,
        tranches: [
          {
            id: 't1',
            investorId: 'i1',
            investmentAmount: 10000,
            contractualProfitSharePercentage: 105,
            economicParticipationPercentage: 20
          }
        ]
      });
    } catch {
      rejectedOver100Rate = true;
    }
    assert(rejectedOver100Rate, 'Validation rejects > 100% contractual percentage');

    let rejectedEmptyTranches = false;
    try {
      calculateCapitalParticipationAllocation({
        finalizedBusinessProfit: 100000,
        tranches: []
      });
    } catch {
      rejectedEmptyTranches = true;
    }
    assert(rejectedEmptyTranches, 'Validation rejects empty tranches array');
  }

  console.log('\n================================================================');
  console.log(`PROMPT 11 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testCapitalParticipationAllocation.ts') ||
    process.argv[1].endsWith('testCapitalParticipationAllocation.js'));

if (isDirectRun) {
  runCapitalParticipationAllocationTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 11 tests failed with ${res.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 11 tests PASSED cleanly: ${res.passed}/${res.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 11 tests:', err);
      process.exit(1);
    });
}
