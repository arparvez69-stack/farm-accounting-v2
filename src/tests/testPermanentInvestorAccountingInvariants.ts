import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  executeInvestorTransaction,
  executeOwnerCapitalTransaction,
  executeOwnerDrawingTransaction,
  executeInvestorProfitAllocationTransaction
} from '../services/transactionService';
import {
  calculateEconomicAllocationByCapital,
  calculateNegativePeriodResultAllocation,
  createValuationEvent,
  finalizeValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';
import {
  createAdmissionRequest,
  clearAdmissionRequestsForTest
} from '../services/admissionService';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  assertProductionEnvironmentValid,
  extractRawPinFromEnv,
  INSECURE_DEFAULT_PINS
} from '../server/envValidation';
import { JournalLine } from '../types';

export interface TestSummary {
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

/**
 * TASK 10 — PERMANENT INVESTOR ACCOUNTING INVARIANTS
 *
 * Verifies the 12 permanent rules:
 * 1. Investor contractual percentages are independent.
 * 2. They do not need to total 100%.
 * 3. No farm-wide investor ratio exists.
 * 4. No "100% minus total investor percentage" calculation exists.
 * 5. Economic allocation and contractual profit split are separate stages.
 * 6. New investors require finalized admission.
 * 7. Different entry dates are respected when time-weighting is enabled.
 * 8. Owner capital and investor capital remain separate.
 * 9. Allocation is idempotent.
 * 10. Investor profit + Mudarib profit = allocated economic profit.
 * 11. Negative profit must not create positive investor/Mudarib profit.
 * 12. No hard-coded/default production PIN exists.
 */
export async function runPermanentInvestorAccountingInvariantsTests(): Promise<TestSummary> {
  const summary: TestSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n================================================================');
  console.log('TASK 10: PERMANENT INVESTOR ACCOUNTING INVARIANTS REGRESSION TEST');
  console.log('Verifying all 12 permanent rules');
  console.log('================================================================\n');

  const testUserId = 'test_owner_task10';

  // ===========================================================================
  // RULE 1: Investor contractual percentages are independent.
  // ===========================================================================
  console.log('--- Rule 1: Investor contractual percentages are independent ---');
  {
    // Participant A contract 50%, Participant B contract 60%
    const participants1 = [
      { id: 'inv_a', name: 'Investor A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
      { id: 'inv_b', name: 'Investor B', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
    ];
    const res1 = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: participants1
    });

    const allocA1 = res1.allocations.find((a) => a.participantId === 'inv_a')!;
    const allocB1 = res1.allocations.find((a) => a.participantId === 'inv_b')!;

    assert(allocA1.contractualProfitSharingPercentage === 50, 'Investor A contractual percentage is 50%', summary);
    assert(allocB1.contractualProfitSharingPercentage === 60, 'Investor B contractual percentage is 60%', summary);
    assert(allocA1.investorContractualProfit === 50, 'Investor A contractual profit is ৳50 (100 × 50%)', summary);
    assert(allocB1.investorContractualProfit === 120, 'Investor B contractual profit is ৳120 (200 × 60%)', summary);

    // Modify B's contractual percentage to 80% without modifying A
    const participants2 = [
      { id: 'inv_a', name: 'Investor A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
      { id: 'inv_b', name: 'Investor B', eligibleCapital: 200, contractualProfitSharingPercentage: 80 }
    ];
    const res2 = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: participants2
    });
    const allocA2 = res2.allocations.find((a) => a.participantId === 'inv_a')!;
    const allocB2 = res2.allocations.find((a) => a.participantId === 'inv_b')!;

    assert(
      allocA2.investorContractualProfit === 50,
      'Changing Investor B contract percentage has zero impact on Investor A profit (independent contracts)',
      summary
    );
    assert(
      allocB2.investorContractualProfit === 160,
      'Investor B contractual profit updates strictly based on own 80% rate (200 × 80% = ৳160)',
      summary
    );
  }

  // ===========================================================================
  // RULE 2: Contractual percentages do NOT need to total 100%.
  // ===========================================================================
  console.log('\n--- Rule 2: Contractual percentages do not need to total 100% ---');
  {
    // Case 1: Contract percentages sum to 110% (> 100%)
    const participantsOver100 = [
      { id: 'inv_1', name: 'Partner 1', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
      { id: 'inv_2', name: 'Partner 2', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
    ];
    const sumOver = participantsOver100.reduce((s, p) => s + p.contractualProfitSharingPercentage, 0);
    assert(sumOver === 110, 'Investor contractual rates sum to 110% (> 100%)', summary);

    const resOver = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: participantsOver100
    });
    assert(resOver.allocations.length === 2, 'Allocation succeeds when contractual rates sum to 110%', summary);
    assert(resOver.totalInvestorProfit === 170, 'Total investor profit is exactly ৳170 (50 + 120)', summary);

    // Case 2: Contract percentages sum to 70% (< 100%)
    const participantsUnder100 = [
      { id: 'inv_3', name: 'Partner 3', eligibleCapital: 100, contractualProfitSharingPercentage: 35 },
      { id: 'inv_4', name: 'Partner 4', eligibleCapital: 200, contractualProfitSharingPercentage: 35 }
    ];
    const sumUnder = participantsUnder100.reduce((s, p) => s + p.contractualProfitSharingPercentage, 0);
    assert(sumUnder === 70, 'Investor contractual rates sum to 70% (< 100%)', summary);

    const resUnder = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: participantsUnder100
    });
    assert(resUnder.allocations.length === 2, 'Allocation succeeds when contractual rates sum to 70%', summary);
    assert(resUnder.totalInvestorProfit === 105, 'Total investor profit is exactly ৳105 (35 + 70)', summary);
  }

  // ===========================================================================
  // RULE 3: No farm-wide investor ratio exists.
  // ===========================================================================
  console.log('\n--- Rule 3: No farm-wide investor ratio exists ---');
  {
    const participants = [
      { id: 'p_1', name: 'P1', eligibleCapital: 100, contractualProfitSharingPercentage: 40 },
      { id: 'p_2', name: 'P2', eligibleCapital: 200, contractualProfitSharingPercentage: 70 }
    ];
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants
    });

    const p1 = res.allocations.find((a) => a.participantId === 'p_1')!;
    const p2 = res.allocations.find((a) => a.participantId === 'p_2')!;

    assert(p1.contractualProfitSharingPercentage !== p2.contractualProfitSharingPercentage, 'Participants maintain distinct individual contract rates', summary);
    assert((res as any).farmWideInvestorRatio === undefined, 'Result object has no singular farmWideInvestorRatio property', summary);
    assert((res as any).globalInvestorRatio === undefined, 'Result object has no singular globalInvestorRatio property', summary);
  }

  // ===========================================================================
  // RULE 4: No "100% minus total investor percentage" calculation exists.
  // ===========================================================================
  console.log('\n--- Rule 4: No "100% minus total investor percentage" calculation exists ---');
  {
    // A contract = 50%, B contract = 60%, Sum = 110%
    // If a bug did "100% - 110%", Mudarib percentage would be -10% and profit would be negative!
    const participants = [
      { id: 'a', name: 'A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
      { id: 'b', name: 'B', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
    ];
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants
    });

    const allocA = res.allocations.find((x) => x.participantId === 'a')!;
    const allocB = res.allocations.find((x) => x.participantId === 'b')!;

    // A Mudarib = 100 - 50 = 50 (50% of A's economic profit)
    // B Mudarib = 200 - 120 = 80 (40% of B's economic profit)
    assert(allocA.workingPartnerShare === 50, 'A: Mudarib share is positive ৳50 (100 - 50)', summary);
    assert(allocB.workingPartnerShare === 80, 'B: Mudarib share is positive ৳80 (200 - 120)', summary);
    assert(res.totalMudaribProfit === 130, 'Total Mudarib profit is positive ৳130 (50 + 80), NOT negative from 100% - 110%', summary);
  }

  // ===========================================================================
  // RULE 5: Economic allocation and contractual profit split are separate stages.
  // ===========================================================================
  console.log('\n--- Rule 5: Economic allocation and contractual profit split are separate stages ---');
  {
    const participants = [
      { id: 'pA', name: 'A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
      { id: 'pB', name: 'B', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
    ];
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants
    });

    const pA = res.allocations.find((x) => x.participantId === 'pA')!;
    const pB = res.allocations.find((x) => x.participantId === 'pB')!;

    // Stage 1: Economic allocation before contractual percentage
    assert(pA.allocatedEconomicProfit === 100, 'Stage 1: A economic allocation is ৳100 (proportional to capital 100/300)', summary);
    assert(pB.allocatedEconomicProfit === 200, 'Stage 1: B economic allocation is ৳200 (proportional to capital 200/300)', summary);
    assert(res.isBeforeContractualPercentages === true, 'Flag isBeforeContractualPercentages is strictly true', summary);
    assert(pA.directContractualApplicationToTotalProfitBlocked === true, 'Direct application of contractual rate to total profit is strictly blocked', summary);

    // Stage 2: Contractual split applied to individual economic allocations
    assert(pA.investorContractualProfit === 50, 'Stage 2: A contractual investor profit = 100 × 50% = ৳50', summary);
    assert(pA.mudaribProfit === 50, 'Stage 2: A Mudarib profit = 100 − 50 = ৳50', summary);
    assert(pB.investorContractualProfit === 120, 'Stage 2: B contractual investor profit = 200 × 60% = ৳120', summary);
    assert(pB.mudaribProfit === 80, 'Stage 2: B Mudarib profit = 200 − 120 = ৳80', summary);
  }

  // ===========================================================================
  // RULE 6: New investors require finalized admission.
  // ===========================================================================
  console.log('\n--- Rule 6: New investors require finalized admission ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const bankId = 'bank_acc_r6';
    await db.cashBankAccounts.put({
      id: bankId,
      accountName: 'Janata Bank PLC',
      name: 'Janata Bank PLC',
      accountType: 'BANK',
      currentBalance: 500000,
      synced: false
    });

    // Subtest 6.1: Direct capital attempt for candidate investor without admission is REJECTED
    let rejectedNoAdm = false;
    try {
      await executeInvestorTransaction(
        {
          investorName: 'Unadmitted Candidate Investor',
          contribution: 50000,
          profitSharingRatio: 25,
          targetAccountId: bankId,
          currentUserId: testUserId,
          date: '2026-03-01'
        },
        db
      );
    } catch (err: any) {
      rejectedNoAdm = true;
      assert(
        err.message.includes('Admission blocked') || err.message.includes('অন্তর্ভুক্তি স্থগিত'),
        `Rejection error identifies admission requirement: "${err.message}"`,
        summary
      );
    }
    assert(rejectedNoAdm, 'Direct capital entry for unadmitted new investor is strictly REJECTED', summary);

    // Subtest 6.2: Finalized admission allows new investor transaction
    clearAdmissionRequestsForTest();
    clearValuationEventsForTest();

    const valEvent = await createValuationEvent(
      {
        valuationDate: '2026-03-01',
        totalBusinessAssetsIncluded: 600000,
        relevantLiabilities: 100000,
        responsibleUser: testUserId,
        valuationMethodology: 'NET_ASSET_VALUE'
      },
      db
    );
    await finalizeValuationEvent(
      {
        valuationEventId: valEvent.id,
        responsibleUser: testUserId,
        bypassReconciliationForTest: true
      },
      db
    );

    const admReq = await createAdmissionRequest(
      {
        investorName: 'Formal Admitted Partner',
        phone: '01899112233',
        proposedContribution: 50000,
        proposedProfitSharingRatio: 25,
        requestDate: '2026-03-01',
        currentUserId: testUserId,
        notes: 'Pre-money: 500000, Post-money: 550000'
      },
      db
    );

    const admittedRes = await executeInvestorTransaction(
      {
        investorName: 'Formal Admitted Partner',
        phone: '01899112233',
        contribution: 50000,
        profitSharingRatio: 25,
        targetAccountId: bankId,
        currentUserId: testUserId,
        date: '2026-03-01',
        valuationEventId: valEvent.id,
        preMoneyValuation: 500000,
        postMoneyValuation: 550000,
        notes: 'New investor admitted with finalized valuation'
      },
      db
    );

    assert(Boolean(admittedRes?.journalEntryId), 'New investor with finalized admission succeeds and creates journal', summary);
    assert(admittedRes.investor.isAdmitted === true, 'Investor is explicitly marked as admitted', summary);
  }

  // ===========================================================================
  // RULE 7: Different entry dates are respected when time-weighting is enabled.
  // ===========================================================================
  console.log('\n--- Rule 7: Different entry dates are respected when time-weighting is enabled ---');
  {
    const distributableProfit = 300;
    const periodStartDate = '2026-01-01';
    const periodEndDate = '2026-03-31'; // 90 days

    const participants = [
      {
        id: 'earlier_inv',
        name: 'Earlier (Full 90 days)',
        eligibleCapital: 100000, // Equal capital
        contractualProfitSharingPercentage: 50,
        eligibilityPeriodStart: '2026-01-01',
        eligibilityPeriodEnd: '2026-03-31',
        allocationMethod: 'TIME_WEIGHTED' as const
      },
      {
        id: 'later_inv',
        name: 'Later (Half period 45 days)',
        eligibleCapital: 100000, // Equal capital
        contractualProfitSharingPercentage: 50,
        eligibilityPeriodStart: '2026-02-15',
        eligibilityPeriodEnd: '2026-03-31',
        allocationMethod: 'TIME_WEIGHTED' as const
      }
    ];

    const twResult = calculateEconomicAllocationByCapital({
      distributableProfit,
      participants,
      periodStartDate,
      periodEndDate,
      allocationMethod: 'TIME_WEIGHTED'
    });

    const earlierAlloc = twResult.allocations.find((a) => a.participantId === 'earlier_inv')!;
    const laterAlloc = twResult.allocations.find((a) => a.participantId === 'later_inv')!;

    assert(earlierAlloc.eligibleCapital === laterAlloc.eligibleCapital, 'Both participants have identical eligible capital (৳100,000)', summary);
    assert(earlierAlloc.allocatedEconomicProfit === 200, 'Earlier investor receives ৳200 economic allocation (90 days)', summary);
    assert(laterAlloc.allocatedEconomicProfit === 100, 'Later investor receives ৳100 economic allocation (45 days)', summary);
    assert(laterAlloc.allocatedEconomicProfit < earlierAlloc.allocatedEconomicProfit, 'Later investor receives strictly less allocation due to time weighting', summary);
    assert(earlierAlloc.allocatedEconomicProfit + laterAlloc.allocatedEconomicProfit === distributableProfit, 'Total allocations reconcile perfectly to distributable profit (200 + 100 = 300)', summary);
  }

  // ===========================================================================
  // RULE 8: Owner capital and investor capital remain separate.
  // ===========================================================================
  console.log('\n--- Rule 8: Owner capital and investor capital remain separate ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const bankId = 'bank_acc_r8';
    await db.cashBankAccounts.put({
      id: bankId,
      accountName: 'Rupali Bank PLC',
      name: 'Rupali Bank PLC',
      accountType: 'BANK',
      currentBalance: 500000,
      synced: false
    });

    // 8.1 Owner capital credits 3010 only
    const ownerRes = await executeOwnerCapitalTransaction(
      {
        amount: 200000,
        targetAccountId: bankId,
        currentUserId: testUserId,
        date: '2026-03-01',
        notes: 'Owner personal capital'
      },
      db
    );
    const ownerJournal = await db.journalEntries.get(ownerRes.journalEntryId);
    const has3010 = ownerJournal?.lines?.some((l) => l.accountCode === '3010');
    const has3020InOwner = ownerJournal?.lines?.some((l) => l.accountCode === '3020');
    assert(has3010 === true, 'Owner capital credits account 3010 (OWNER_CAPITAL)', summary);
    assert(has3020InOwner === false, 'Owner capital NEVER touches account 3020 (INVESTOR_CAPITAL)', summary);

    // 8.2 Cross-mapping rejection
    let rejectedCrossOwner = false;
    try {
      await executeOwnerCapitalTransaction(
        {
          amount: 50000,
          targetAccountId: bankId,
          currentUserId: testUserId,
          investorId: 'inv_attempted',
          capitalType: 'INVESTOR'
        } as any,
        db
      );
    } catch (err: any) {
      rejectedCrossOwner = true;
      assert(err.message.includes('Cross-mapping rejected'), `Cross-mapping error caught: "${err.message}"`, summary);
    }
    assert(rejectedCrossOwner, 'Passing investor attributes to executeOwnerCapitalTransaction is strictly REJECTED', summary);

    // 8.3 Mixing 3010 and 3020 in same voucher is rejected
    const accounts = await db.accounts.toArray();
    let rejectedMixing = false;
    try {
      const mixedLines: JournalLine[] = [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'Bank', debit: 60000, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 30000 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'Investor Capital', debit: 0, credit: 30000, investorId: 'inv_1' }
      ];
      await postJournalEntry(
        {
          id: 'j_mixed_test',
          voucherNumber: 'V-MIX-01',
          voucherType: 'RECEIPT',
          date: '2026-03-01',
          narration: 'Attempting to mix owner and investor capital',
          lines: mixedLines,
          createdBy: testUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejectedMixing = true;
      assert(err.message.includes('Cross-mapping rejected') || err.message.includes('mix'), `Mixing error message: "${err.message}"`, summary);
    }
    assert(rejectedMixing, 'Mixing 3010 and 3020 in the same journal transaction is strictly REJECTED', summary);
  }

  // ===========================================================================
  // RULE 9: Allocation is idempotent.
  // ===========================================================================
  console.log('\n--- Rule 9: Allocation is idempotent ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }

    const testInvId = 'inv_idemp_test';
    await db.investors.put({
      id: testInvId,
      name: 'Idempotency Partner',
      phone: '01811223344',
      capitalAmount: 100000,
      capitalContributed: 100000,
      currentCapitalBalance: 100000,
      profitPayable: 0,
      totalProfitAllocated: 0,
      profitSharingRatio: 40,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      joinedDate: '2026-01-01',
      synced: false
    });

    const allocParams = {
      investorId: testInvId,
      finalizedDistributableProfit: 10000,
      allocatedEconomicProfit: 10000,
      allocationDate: '2026-06-30',
      allocationReference: 'ALLOC-IDEMP-001',
      idempotencyKey: 'IDEMP-ALLOC-KEY-999',
      currentUserId: testUserId
    };

    // First call: succeeds
    const firstAlloc = await executeInvestorProfitAllocationTransaction(allocParams, db);
    assert(Boolean(firstAlloc?.journalEntryId), 'First allocation transaction succeeds', summary);
    assert(firstAlloc.allocatedProfit === 4000, 'Allocated profit is ৳4,000 (10,000 × 40%)', summary);

    const invAfterFirst = await db.investors.get(testInvId);
    assert(invAfterFirst?.profitPayable === 4000, 'Investor profitPayable balance is ৳4,000 after first call', summary);

    // Second call with same reference / idempotency key: strictly rejected as duplicate
    let duplicateRejected = false;
    try {
      await executeInvestorProfitAllocationTransaction(allocParams, db);
    } catch (err: any) {
      duplicateRejected = true;
      assert(
        err.message.includes('Duplicate profit allocation prevented') || err.message.includes('ইতোমধ্যে সম্পন্ন'),
        `Duplicate prevented with clear message: "${err.message}"`,
        summary
      );
    }
    assert(duplicateRejected, 'Second allocation with same reference is strictly REJECTED to prevent duplicate', summary);

    const invAfterSecond = await db.investors.get(testInvId);
    assert(invAfterSecond?.profitPayable === 4000, 'Investor profitPayable balance remains exactly ৳4,000 (no double-crediting)', summary);
  }

  // ===========================================================================
  // RULE 10: Investor profit + Mudarib profit = allocated economic profit.
  // ===========================================================================
  console.log('\n--- Rule 10: Investor profit + Mudarib profit = allocated economic profit ---');
  {
    const participants = [
      { id: 'inv_10a', name: 'Partner 1', eligibleCapital: 100, contractualProfitSharingPercentage: 35 },
      { id: 'inv_10b', name: 'Partner 2', eligibleCapital: 200, contractualProfitSharingPercentage: 65 },
      { id: 'inv_10c', name: 'Partner 3', eligibleCapital: 300, contractualProfitSharingPercentage: 50 }
    ];
    const totalDistributable = 600;
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: totalDistributable,
      participants
    });

    let sumInvestor = 0;
    let sumMudarib = 0;
    let sumEconomic = 0;

    for (const alloc of res.allocations) {
      const invProfit = alloc.investorContractualProfit || 0;
      const mudProfit = alloc.mudaribProfit || 0;
      const econProfit = alloc.allocatedEconomicProfit;

      assert(
        Math.abs((invProfit + mudProfit) - econProfit) < 0.001,
        `Participant ${alloc.participantName}: Investor (${invProfit}) + Mudarib (${mudProfit}) === Economic (${econProfit})`,
        summary
      );

      sumInvestor += invProfit;
      sumMudarib += mudProfit;
      sumEconomic += econProfit;
    }

    assert(
      Math.abs((sumInvestor + sumMudarib) - sumEconomic) < 0.001,
      `Aggregate: Total Investor (${sumInvestor}) + Total Mudarib (${sumMudarib}) === Total Economic (${sumEconomic})`,
      summary
    );
    assert(sumEconomic === totalDistributable, `Total economic allocation matches distributable profit (৳${totalDistributable})`, summary);
  }

  // ===========================================================================
  // RULE 11: Negative profit must not create positive investor/Mudarib profit.
  // ===========================================================================
  console.log('\n--- Rule 11: Negative profit must not create positive investor/Mudarib profit ---');
  {
    const participants = [
      { id: 'A', name: 'Participant A', capital: 100, contractPercentage: 50 },
      { id: 'B', name: 'Participant B', capital: 200, contractPercentage: 60 }
    ];

    const lossResult = calculateNegativePeriodResultAllocation({
      periodResult: -100,
      loss: 100,
      participants,
      lossPolicy: 'PRO_RATA_CAPITAL_IMPAIRMENT'
    });

    assert(lossResult.isLoss === true, 'Period result correctly marked as loss', summary);
    assert(lossResult.lossAmount === 100, 'Loss amount is ৳100', summary);
    assert(lossResult.finalizedAccountingResult === -100, 'Accounting result visibly shows -100', summary);

    for (const p of lossResult.participants) {
      assert(p.investorProfit === 0, `Participant ${p.name}: investorProfit is strictly 0 (never positive on loss)`, summary);
      assert(p.mudaribProfit === 0, `Participant ${p.name}: mudaribProfit is strictly 0 (never positive on loss)`, summary);
      assert(p.investorProfitPayable === 0, `Participant ${p.name}: investorProfitPayable is 0 (no manufactured payable)`, summary);
    }
    assert(lossResult.totalInvestorProfit === 0, 'Total investor profit on negative period is strictly 0', summary);
    assert(lossResult.totalMudaribProfit === 0, 'Total Mudarib profit on negative period is strictly 0', summary);
  }

  // ===========================================================================
  // RULE 12: No hard-coded/default production PIN exists.
  // ===========================================================================
  console.log('\n--- Rule 12: No hard-coded/default production PIN exists ---');
  {
    // Test that all known insecure default PINs are permanently rejected
    for (const badPin of INSECURE_DEFAULT_PINS) {
      const mockEnv: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        INITIAL_PIN: badPin,
        SESSION_SECRET: '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599',
        APPROVED_OWNER_EMAILS: 'owner@farm.com'
      };

      let threw = false;
      try {
        assertProductionEnvironmentValid({ env: mockEnv });
      } catch (err: any) {
        threw = true;
        assert(
          err.message.includes('default PIN') || err.message.includes('INSECURE_DEFAULT_PIN'),
          `Production validation correctly rejects insecure PIN "${badPin}": "${err.message}"`,
          summary
        );
      }
      assert(threw, `Insecure default PIN "${badPin}" is strictly rejected in production environment`, summary);
    }

    // Test that extractRawPinFromEnv does NOT return a hard-coded fallback when env is missing
    const emptyPin = extractRawPinFromEnv({});
    assert(!emptyPin, 'extractRawPinFromEnv returns empty (no hard-coded default fallback)', summary);
  }

  console.log('\n================================================================');
  console.log(`TASK 10 RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

// Auto-run if executed directly via npx tsx
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testPermanentInvestorAccountingInvariants.ts') ||
    process.argv[1].endsWith('testPermanentInvestorAccountingInvariants.js'));

if (isDirectRun) {
  runPermanentInvestorAccountingInvariantsTests()
    .then((summary) => {
      if (summary.failed > 0) {
        console.error(`Task 10 failed with ${summary.failed} failures.`);
        process.exit(1);
      } else {
        console.log('Task 10: All tests passed successfully.');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error in Task 10 tests:', err);
      process.exit(1);
    });
}
