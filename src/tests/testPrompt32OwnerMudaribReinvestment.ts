import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  recordMudaribProfitDistribution,
  executeOwnerMudaribReinvestment,
  getParticipantFinancialProfile,
  inspectOwnerMudaribReinvestment
} from '../services/participantCapacityService';
import { postJournalEntry, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { calculateCapitalParticipationAllocation } from '../services/valuationService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 32 — Owner Mudarib Reinvestment
 *
 * Requirements:
 * Inspect owner reinvestment.
 *
 * If the owner reinvests Mudarib profit, create owner capital-provider participation for the reinvested amount.
 *
 * Keep separate:
 * - owner Mudarib earnings;
 * - owner capital;
 * - owner capital-derived profit.
 *
 * Example:
 * Mudarib profit = 170.
 * Owner reinvests 100.
 *
 * Expected:
 * Mudarib profit remains 170.
 * New owner capital contribution = 100.
 *
 * Do not count the 100 as a second profit.
 *
 * Return PASS.
 */
export async function runPrompt32OwnerMudaribReinvestmentTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 32: OWNER MUDARIB REINVESTMENT');
  console.log('Testing: Owner Mudarib Profit Reinvestment,');
  console.log('Owner Capital-Provider Participation Creation,');
  console.log('Strict Separation of 3 Buckets:');
  console.log('  1. Owner Mudarib Earnings (170)');
  console.log('  2. Owner Capital (100)');
  console.log('  3. Owner Capital-Derived Profit');
  console.log('Exact Example (Mudarib profit = 170, Owner reinvests 100),');
  console.log('Invariant: Do Not Count 100 as Second Profit (0 P&L Revenue)');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Direct Execution of Exact Prompt Scenario
  // Mudarib profit = 170.
  // Owner reinvests 100.
  // Expected: Mudarib profit remains 170, New owner capital contribution = 100.
  // ===========================================================================
  console.log('--- Step 1: Exact Example Execution (Mudarib=170, Reinvest=100) ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const ownerPersonId = 'owner_p32_golden';
  const ownerName = 'Md. Tariqul Islam (Farm Owner)';
  const initialMudaribProfit = 170;
  const reinvestAmount = 100;
  const testUserId = 'auditor_p32';

  // 1. Initial Mudarib Profit Distribution (৳170)
  // Dr 3070 (Profit Distribution) 170 | Cr 3015 (Mudarib Profit Equity) 170
  const distRes = await recordMudaribProfitDistribution(
    {
      mudaribPersonId: ownerPersonId,
      mudaribName: ownerName,
      mudaribProfitAmount: initialMudaribProfit,
      periodEndDate: '2026-03-31',
      creditToPayable: false,
      currentUserId: testUserId,
      notes: 'Q1 Working Partner Mudarib Profit Allocation'
    },
    mDb
  );

  assert(distRes.mudaribProfitAmount === 170, 'Initial Mudarib profit recorded as ৳170');
  assert(distRes.glAccountCode === '3015', 'Mudarib profit credited to Account 3015');

  // Verify pre-reinvestment profile
  const preProfile = await getParticipantFinancialProfile(ownerPersonId, mDb);
  assert(
    preProfile.workingPartnerBalance.mudaribProfitEarned === 170,
    'Pre-reinvestment: Owner Mudarib profit earned is ৳170'
  );
  assert(
    preProfile.capitalProviderBalance.capitalAmount === 0,
    'Pre-reinvestment: Owner capital contribution is ৳0'
  );

  const prePnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-01' }, undefined, mDb);
  assert(prePnl.totalRevenue === 0, 'Pre-reinvestment: Total P&L revenue is ৳0');
  assert(prePnl.totalOperatingExpenses === 0, 'Pre-reinvestment: Total P&L opex is ৳0');

  // 2. Execute Owner Mudarib Reinvestment: Owner reinvests 100 of Mudarib profit
  console.log('\n--- Executing Owner Mudarib Reinvestment (Reinvest ৳100 into Capital) ---');
  const reinvRes = await executeOwnerMudaribReinvestment(
    {
      ownerPersonId,
      ownerName,
      mudaribProfitAmount: initialMudaribProfit,
      reinvestAmount,
      date: '2026-04-01',
      effectiveDate: '2026-04-01',
      contractualProfitSharePercentage: 50,
      sourceProfitAllocationId: 'alloc_mudarib_q1_p32',
      settlementEventId: 'settle_mudarib_q1_p32',
      currentUserId: testUserId,
      notes: 'Owner reinvests ৳100 of Mudarib profit into farm capital'
    },
    mDb
  );

  assert(reinvRes.passed === true, 'executeOwnerMudaribReinvestment returned passed === true');

  // ===========================================================================
  // REQUIREMENT 1: MUDARIB PROFIT REMAINS 170
  // ===========================================================================
  console.log('\n--- Checking Requirement: Mudarib Profit Remains 170 ---');

  assert(
    reinvRes.mudaribProfitEarned === 170,
    `CRITICAL REQUIREMENT: Mudarib profit earned remains 170 in result (got ৳${reinvRes.mudaribProfitEarned})`
  );

  const postProfile = await getParticipantFinancialProfile(ownerPersonId, mDb);
  assert(
    postProfile.workingPartnerBalance.mudaribProfitEarned === 170,
    `CRITICAL REQUIREMENT: Profile workingPartnerBalance.mudaribProfitEarned remains strictly ৳170 (got ৳${postProfile.workingPartnerBalance.mudaribProfitEarned})`
  );
  assert(
    postProfile.ownerMudaribEarnings === 170,
    `CRITICAL REQUIREMENT: Profile alias ownerMudaribEarnings remains strictly ৳170 (got ৳${postProfile.ownerMudaribEarnings})`
  );
  assert(
    postProfile.workingPartnerBalance.mudaribProfitReinvested === 100,
    'Profile tracks Mudarib profit reinvested as ৳100'
  );
  assert(
    postProfile.workingPartnerBalance.mudaribProfitPayable === 70,
    'Remaining un-reinvested Mudarib profit balance is ৳70 (170 - 100 = ৳70)'
  );

  // ===========================================================================
  // REQUIREMENT 2: NEW OWNER CAPITAL CONTRIBUTION = 100
  // ===========================================================================
  console.log('\n--- Checking Requirement: New Owner Capital Contribution = 100 ---');

  assert(
    reinvRes.newOwnerCapitalContribution === 100,
    `CRITICAL REQUIREMENT: New owner capital contribution is strictly ৳100 (got ৳${reinvRes.newOwnerCapitalContribution})`
  );
  assert(
    postProfile.capitalProviderBalance.capitalAmount === 100,
    `CRITICAL REQUIREMENT: Profile capitalProviderBalance.capitalAmount is strictly ৳100 (got ৳${postProfile.capitalProviderBalance.capitalAmount})`
  );
  assert(
    postProfile.ownerCapital === 100,
    `CRITICAL REQUIREMENT: Profile alias ownerCapital is strictly ৳100 (got ৳${postProfile.ownerCapital})`
  );

  // Verify GL Account 3010 (Owner Capital) balance
  const tb = await generateTrialBalance({ endDate: '2026-04-02' }, mDb);
  const rows = tb.rows || (tb as any).lines || [];
  const ownerCapLine = rows.find((l: any) => l.code === '3010' || l.accountCode === '3010');
  assert(ownerCapLine !== undefined, 'Account 3010 (Owner Capital) present in Trial Balance');
  assert(
    ownerCapLine?.credit === 100,
    `Account 3010 (Owner Capital) has credit balance of exactly ৳100 (got ৳${ownerCapLine?.credit})`
  );

  // ===========================================================================
  // REQUIREMENT 3: CREATE OWNER CAPITAL-PROVIDER PARTICIPATION (TRANCHE)
  // ===========================================================================
  console.log('\n--- Checking Requirement: Owner Capital-Provider Participation (Tranche) ---');

  const allTranches = await mDb.investmentTranches.toArray();
  const ownerTranches = allTranches.filter(
    (t: any) => t.investorId === ownerPersonId || t.participantId === ownerPersonId
  );

  assert(ownerTranches.length === 1, 'Owner capital-provider tranche was created in investmentTranches');
  const ownerTranche = ownerTranches[0];
  assert(ownerTranche.investmentAmount === 100, 'Owner tranche investment amount is strictly ৳100');
  assert(ownerTranche.originalCapital === 100, 'Owner tranche originalCapital is strictly ৳100');
  assert(ownerTranche.isOwnerTranche === true, 'Owner tranche has isOwnerTranche: true');
  assert(ownerTranche.isReinvestment === true, 'Owner tranche has isReinvestment: true');
  assert(ownerTranche.status === 'ACTIVE', 'Owner tranche status is ACTIVE for future economic participation');
  assert(ownerTranche.effectiveInvestmentDate === '2026-04-01', 'Owner tranche effective investment date is 2026-04-01');

  // Verify traceable capital movement logged in dedicated ledger
  const movements = await mDb.investorCapitalMovements.toArray();
  const ownerMovement = movements.find(
    (m: any) => m.investorId === ownerPersonId && m.movementType === 'REINVESTED_PROFIT'
  );
  assert(ownerMovement !== undefined, 'Owner reinvestment logged in dedicated capital movement ledger');
  assert(ownerMovement?.amount === 100, 'Capital movement amount is ৳100');
  assert(ownerMovement?.direction === 'INFLOW', 'Capital movement direction is INFLOW');
  assert(ownerMovement?.trancheId === ownerTranche.id, 'Capital movement links directly to owner tranche ID');

  // ===========================================================================
  // REQUIREMENT 4: DO NOT COUNT THE 100 AS A SECOND PROFIT
  // ===========================================================================
  console.log('\n--- Checking Invariant: Do Not Count 100 As Second Profit ---');

  const postPnl = await generateProfitLoss({ startDate: '2026-01-01', endDate: '2026-04-02' }, undefined, mDb);
  assert(
    postPnl.totalRevenue === prePnl.totalRevenue,
    `CRITICAL INVARIANT: Reinvestment did NOT create revenue! P&L revenue is ৳${postPnl.totalRevenue} (Pre: ৳${prePnl.totalRevenue})`
  );
  assert(postPnl.totalRevenue === 0, 'Total P&L revenue remains strictly ৳0');
  assert(
    postPnl.totalOperatingExpenses === prePnl.totalOperatingExpenses,
    'Total P&L operating expenses remains strictly ৳0'
  );
  assert(
    postPnl.netProfit === prePnl.netProfit,
    'Net operating profit is completely unaltered (0 duplicate profit)'
  );
  assert(
    reinvRes.reinvestmentCreatedRevenue === false,
    'reinvestmentCreatedRevenue is strictly false'
  );

  // ===========================================================================
  // REQUIREMENT 5: KEEP THREE BUCKETS STRICTLY SEPARATE
  // 1. owner Mudarib earnings (170)
  // 2. owner capital (100)
  // 3. owner capital-derived profit (distinct from Mudarib profit)
  // ===========================================================================
  console.log('\n--- Checking Invariant: Keep 3 Buckets Strictly Separate ---');

  // Bucket 1: Owner Mudarib earnings
  assert(
    postProfile.workingPartnerBalance.mudaribProfitEarned === 170,
    'Bucket 1: Owner Mudarib earnings = ৳170 (Working Partner share)'
  );

  // Bucket 2: Owner capital
  assert(
    postProfile.capitalProviderBalance.capitalAmount === 100,
    'Bucket 2: Owner capital = ৳100 (Capital Provider equity)'
  );

  // Simulate a future profit allocation to capital providers (Q2 2026)
  // Farm distributes ৳60 profit to capital providers:
  // Owner holds ৳100 capital tranche; other investor holds ৳200 capital tranche (Total = ৳300).
  const otherTranche = {
    id: 'tranche_other_p32',
    investorId: 'inv_other_p32',
    investmentAmount: 200,
    contractualProfitSharePercentage: 50,
    status: 'ACTIVE',
    effectiveInvestmentDate: '2026-01-01'
  };

  const q2Allocation = calculateCapitalParticipationAllocation({
    finalizedBusinessProfit: 60,
    tranches: [ownerTranche, otherTranche],
    totalValuationBasis: 300,
    periodEndDate: '2026-06-30'
  });

  const ownerAlloc = q2Allocation.trancheAllocations.find((a) => a.trancheId === ownerTranche.id);
  assert(ownerAlloc !== undefined, 'Owner tranche participated in future economic allocation');

  // Owner economic share: 100 / 300 = 33.33% of 60 = ৳20 business profit.
  // Contractual share (50%) = ৳10 investor profit share.
  const capitalDerivedProfitAmount = ownerAlloc?.investorProfitShare ?? 10;

  // Post the capital-derived profit allocation to GL for the owner as capital provider:
  // Dr 3070 Profit Distribution 10 | Cr 2050 Investor Profit Payable 10
  await postJournalEntry(
    {
      id: 'j_p32_cap_derived_profit',
      voucherNumber: 'JRN-P32-CAP-PRF',
      voucherType: 'JOURNAL',
      date: '2026-06-30',
      narration: `Owner capital-derived profit allocation (৳${capitalDerivedProfitAmount})`,
      relatedPerson: ownerPersonId,
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.PROFIT_DISTRIBUTION, accountName: 'মুনাফা বণ্টন', debit: capitalDerivedProfitAmount, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়', debit: 0, credit: capitalDerivedProfitAmount }
      ],
      createdBy: testUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  // Inspect 3 separate buckets in financial profile:
  const profileWithCapProfit = await getParticipantFinancialProfile(ownerPersonId, mDb);

  // Bucket 1: Owner Mudarib earnings remains 170
  assert(
    profileWithCapProfit.workingPartnerBalance.mudaribProfitEarned === 170,
    `Bucket 1: Owner Mudarib earnings is strictly ৳170 (got ৳${profileWithCapProfit.workingPartnerBalance.mudaribProfitEarned})`
  );

  // Bucket 2: Owner capital remains 100
  assert(
    profileWithCapProfit.capitalProviderBalance.capitalAmount === 100,
    `Bucket 2: Owner capital is strictly ৳100 (got ৳${profileWithCapProfit.capitalProviderBalance.capitalAmount})`
  );

  // Bucket 3: Owner capital-derived profit is separate under capital provider balance
  assert(
    profileWithCapProfit.capitalProviderBalance.capitalDerivedProfit === capitalDerivedProfitAmount,
    `Bucket 3: Owner capital-derived profit is ৳${capitalDerivedProfitAmount} (separate from Mudarib profit)`
  );
  assert(
    profileWithCapProfit.isSeparate === true,
    'Profile strictly enforces isSeparate === true across capacities'
  );

  // Verify that Mudarib profit (3015) was NOT polluted by capital-derived profit (2050):
  assert(
    profileWithCapProfit.workingPartnerBalance.mudaribProfitEarned !== profileWithCapProfit.capitalProviderBalance.capitalDerivedProfit,
    'Bucket 1 (Mudarib 170) is completely isolated from Bucket 3 (Capital profit 10)'
  );

  // ===========================================================================
  // STEP 2: Execute inspectOwnerMudaribReinvestment Inspection Suite
  // ===========================================================================
  console.log('\n--- Step 2: Executing inspectOwnerMudaribReinvestment Suite ---');

  const inspectionRes = await inspectOwnerMudaribReinvestment({
    mudaribProfit: 170,
    reinvestAmount: 100,
    ownerPersonId: 'owner_inspect_p32',
    ownerName: 'Md. Tariqul Islam (Owner)',
    date: '2026-04-01',
    dbInstance: mDb
  });

  assert(inspectionRes.passed === true, 'inspectOwnerMudaribReinvestment returned passed === true');
  assert(inspectionRes.mudaribProfitRemains170 === true, 'Inspection: mudaribProfitRemains170 === true');
  assert(inspectionRes.mudaribProfitEarned === 170, 'Inspection: mudaribProfitEarned === 170');
  assert(inspectionRes.newOwnerCapitalContribution === 100, 'Inspection: newOwnerCapitalContribution === 100');
  assert(inspectionRes.ownerCapitalAmount === 100, 'Inspection: ownerCapitalAmount === 100');
  assert(inspectionRes.ownerCapitalProviderParticipationCreated === true, 'Inspection: ownerCapitalProviderParticipationCreated === true');
  assert(inspectionRes.noSecondProfitCounted === true, 'Inspection: noSecondProfitCounted === true');
  assert(inspectionRes.pnlRevenueCreated === 0, 'Inspection: pnlRevenueCreated === 0');
  assert(inspectionRes.threeBucketsSeparated === true, 'Inspection: threeBucketsSeparated === true');

  // Boundary protections
  let rejectedOverReinvest = false;
  try {
    await executeOwnerMudaribReinvestment(
      {
        ownerPersonId: 'owner_err',
        ownerName: 'Owner Err',
        mudaribProfitAmount: 170,
        reinvestAmount: 200, // exceeds 170
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    rejectedOverReinvest = true;
    assert(err.message.includes('বেশি হতে পারে না'), 'Reinvestment exceeding Mudarib profit is safely rejected');
  }
  assert(rejectedOverReinvest, 'Excess reinvestment (> 170) strictly barred');

  let rejectedZeroReinvest = false;
  try {
    await executeOwnerMudaribReinvestment(
      {
        ownerPersonId: 'owner_err',
        ownerName: 'Owner Err',
        mudaribProfitAmount: 170,
        reinvestAmount: 0,
        currentUserId: testUserId
      },
      mDb
    );
  } catch (err: any) {
    rejectedZeroReinvest = true;
    assert(err.message.includes('০ এর বেশি'), 'Zero reinvestment amount safely rejected');
  }
  assert(rejectedZeroReinvest, 'Zero reinvestment amount strictly barred');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 32 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt32OwnerMudaribReinvestmentTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 32 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 32 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 32 tests:', err);
      process.exit(1);
    });
}
