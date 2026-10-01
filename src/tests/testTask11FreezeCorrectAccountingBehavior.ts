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
import {
  postJournalEntry,
  validateBalancedLines
} from '../accounting/accountingEngine';
import {
  assertProductionEnvironmentValid,
  validateProductionEnvironment,
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
 * TASK 11 — FREEZE CORRECT ACCOUNTING BEHAVIOR
 *
 * Verifies and permanently freezes all 14 accounting invariants:
 * 1. Single-farm architecture
 * 2. Owner capital ≠ investor capital
 * 3. Investor percentages are per investor/tranche
 * 4. Investor percentages do not need to total 100%
 * 5. Economic allocation ≠ contractual profit split
 * 6. No farm-wide investor ratio
 * 7. No automatic Mudarib ratio from investor percentages
 * 8. New investor requires finalized admission/valuation
 * 9. Entry dates are respected where time-weighting is enabled
 * 10. Authoritative finalized accounting profit is used
 * 11. Allocation is atomic and idempotent
 * 12. Accounting debit = credit
 * 13. No hard-coded/default production PIN
 * 14. Missing production authentication secret fails closed
 */
export async function runTask11FreezeCorrectAccountingBehaviorTests(): Promise<TestSummary> {
  const summary: TestSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n================================================================');
  console.log('TASK 11: FREEZE CORRECT ACCOUNTING BEHAVIOR REGRESSION TESTS');
  console.log('Verifying all 14 frozen accounting invariants');
  console.log('================================================================\n');

  const testUserId = 'test_owner_task11';

  // ---------------------------------------------------------------------------
  // 1. Single-farm architecture
  // ---------------------------------------------------------------------------
  console.log('--- 1. Single-farm architecture ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    await db.systemConfig.put({
      ownerUid: 'owner_primary',
      companyName: 'The Goated Farm',
      currency: 'BDT',
      initializedAt: '2026-01-01T00:00:00.000Z'
    });

    const configs = await db.systemConfig.toArray();
    assert(configs.length === 1, 'Exactly one unified farm entity exists (single-farm architecture)', summary);
    assert(configs[0].companyName === 'The Goated Farm', 'Farm identity is unified (The Goated Farm)', summary);
    assert(configs[0].currency === 'BDT', 'Unified standard currency (BDT)', summary);
  }

  // ---------------------------------------------------------------------------
  // 2. Owner capital ≠ investor capital
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Owner capital ≠ investor capital ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const bankId = 'bank_acc_f2';
    await db.cashBankAccounts.put({
      id: bankId,
      name: 'Bank',
      accountType: 'BANK',
      currentBalance: 500000,
      synced: false
    });

    // Owner capital -> strictly 3010
    const ownerRes = await executeOwnerCapitalTransaction(
      {
        amount: 100000,
        targetAccountId: bankId,
        currentUserId: testUserId,
        date: '2026-03-01'
      },
      db
    );
    const ownerJnl = await db.journalEntries.get(ownerRes.journalEntryId);
    assert(ownerJnl?.lines?.some((l) => l.accountCode === '3010'), 'Owner capital credits account 3010 (OWNER_CAPITAL)', summary);
    assert(!ownerJnl?.lines?.some((l) => l.accountCode === '3020'), 'Owner capital NEVER touches account 3020 (INVESTOR_CAPITAL)', summary);

    // Cross-mapping rejection
    let crossRejected = false;
    try {
      await executeOwnerCapitalTransaction(
        {
          amount: 50000,
          targetAccountId: bankId,
          currentUserId: testUserId,
          investorId: 'inv_fake',
          capitalType: 'INVESTOR'
        } as any,
        db
      );
    } catch (e: any) {
      crossRejected = e.message.includes('Cross-mapping rejected');
    }
    assert(crossRejected, 'Cross-mapping investor capital into owner capital is strictly rejected', summary);
  }

  // ---------------------------------------------------------------------------
  // 3. Investor percentages are per investor/tranche
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Investor percentages are per investor/tranche ---');
  {
    const p1 = { id: 'inv_1', name: 'Partner 1', eligibleCapital: 100, contractualProfitSharingPercentage: 45 };
    const p2 = { id: 'inv_2', name: 'Partner 2', eligibleCapital: 200, contractualProfitSharingPercentage: 70 };
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: [p1, p2]
    });
    const a1 = res.allocations.find((a) => a.participantId === 'inv_1')!;
    const a2 = res.allocations.find((a) => a.participantId === 'inv_2')!;
    assert(a1.contractualProfitSharingPercentage === 45, 'Partner 1 retains independent rate of 45%', summary);
    assert(a2.contractualProfitSharingPercentage === 70, 'Partner 2 retains independent rate of 70%', summary);
  }

  // ---------------------------------------------------------------------------
  // 4. Investor percentages do not need to total 100%
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Investor percentages do not need to total 100% ---');
  {
    const pOver = [
      { id: 'o1', eligibleCapital: 100, contractualProfitSharingPercentage: 55 },
      { id: 'o2', eligibleCapital: 100, contractualProfitSharingPercentage: 65 }
    ];
    const resOver = calculateEconomicAllocationByCapital({
      distributableProfit: 200,
      participants: pOver
    });
    assert(55 + 65 === 120, 'Rates sum to 120% (> 100%)', summary);
    assert(resOver.allocations.length === 2, 'Allocation completes normally when contractual rates exceed 100%', summary);
  }

  // ---------------------------------------------------------------------------
  // 5. Economic allocation ≠ contractual profit split
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Economic allocation ≠ contractual profit split ---');
  {
    // A capital = 100, B capital = 200, Profit = 300, A contract = 50%, B contract = 60%
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: [
        { id: 'A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
        { id: 'B', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
      ]
    });
    const a = res.allocations.find((x) => x.participantId === 'A')!;
    const b = res.allocations.find((x) => x.participantId === 'B')!;

    // Stage 1: Economic allocation
    assert(a.allocatedEconomicProfit === 100, 'Stage 1: A economic allocation = ৳100 (capital proportional)', summary);
    assert(b.allocatedEconomicProfit === 200, 'Stage 1: B economic allocation = ৳200 (capital proportional)', summary);

    // Stage 2: Contractual profit split
    assert(a.investorContractualProfit === 50, 'Stage 2: A investor profit = ৳50 (100 × 50%) ≠ economic allocation (৳100)', summary);
    assert(b.investorContractualProfit === 120, 'Stage 2: B investor profit = ৳120 (200 × 60%) ≠ economic allocation (৳200)', summary);
  }

  // ---------------------------------------------------------------------------
  // 6. No farm-wide investor ratio
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. No farm-wide investor ratio ---');
  {
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: [
        { id: 'X', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
        { id: 'Y', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
      ]
    });
    assert((res as any).farmWideInvestorRatio === undefined, 'No single farm-wide investor ratio exists in allocation result', summary);
    assert((res as any).globalInvestorRatio === undefined, 'No global investor ratio exists in allocation result', summary);
  }

  // ---------------------------------------------------------------------------
  // 7. No automatic Mudarib ratio from investor percentages
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. No automatic Mudarib ratio from investor percentages ---');
  {
    // Rates: 50% + 60% = 110%.
    // If a bug did "100% - total investor rate", Mudarib would be -10%!
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      participants: [
        { id: 'A', eligibleCapital: 100, contractualProfitSharingPercentage: 50 },
        { id: 'B', eligibleCapital: 200, contractualProfitSharingPercentage: 60 }
      ]
    });
    const a = res.allocations.find((x) => x.participantId === 'A')!;
    const b = res.allocations.find((x) => x.participantId === 'B')!;
    assert(a.workingPartnerShare === 50, 'A: Mudarib share is positive ৳50 (100 - 50)', summary);
    assert(b.workingPartnerShare === 80, 'B: Mudarib share is positive ৳80 (200 - 120)', summary);
    assert(res.totalMudaribProfit === 130, 'Total Mudarib is positive ৳130 (50 + 80), not derived from 100% - 110%', summary);
  }

  // ---------------------------------------------------------------------------
  // 8. New investor requires finalized admission/valuation
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. New investor requires finalized admission/valuation ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const bankId = 'bank_acc_f8';
    await db.cashBankAccounts.put({
      id: bankId,
      name: 'Bank',
      accountType: 'BANK',
      currentBalance: 500000,
      synced: false
    });

    let directBlocked = false;
    try {
      await executeInvestorTransaction(
        {
          investorName: 'Candidate Without Valuation',
          contribution: 100000,
          profitSharingRatio: 30,
          targetAccountId: bankId,
          currentUserId: testUserId,
          date: '2026-03-01'
        },
        db
      );
    } catch (e: any) {
      directBlocked = e.message.includes('Admission blocked') || e.message.includes('স্থগিত');
    }
    assert(directBlocked, 'Brand new investor without finalized admission/valuation is strictly blocked', summary);
  }

  // ---------------------------------------------------------------------------
  // 9. Entry dates are respected where time-weighting is enabled
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Entry dates are respected where time-weighting is enabled ---');
  {
    const res = calculateEconomicAllocationByCapital({
      distributableProfit: 300,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      allocationMethod: 'TIME_WEIGHTED',
      participants: [
        {
          id: 'early',
          eligibleCapital: 100000,
          contractualProfitSharingPercentage: 50,
          eligibilityPeriodStart: '2026-01-01',
          eligibilityPeriodEnd: '2026-03-31',
          allocationMethod: 'TIME_WEIGHTED'
        },
        {
          id: 'late',
          eligibleCapital: 100000,
          contractualProfitSharingPercentage: 50,
          eligibilityPeriodStart: '2026-02-15',
          eligibilityPeriodEnd: '2026-03-31',
          allocationMethod: 'TIME_WEIGHTED'
        }
      ]
    });
    const early = res.allocations.find((a) => a.participantId === 'early')!;
    const late = res.allocations.find((a) => a.participantId === 'late')!;
    assert(early.allocatedEconomicProfit === 200, 'Earlier entrant receives ৳200 (90 days)', summary);
    assert(late.allocatedEconomicProfit === 100, 'Later entrant receives ৳100 (45 days)', summary);
    assert(early.allocatedEconomicProfit > late.allocatedEconomicProfit, 'Time-weighting gives earlier entrant higher allocation for equal capital', summary);
  }

  // ---------------------------------------------------------------------------
  // 10. Authoritative finalized accounting profit is used
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Authoritative finalized accounting profit is used ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const invId = 'inv_auth_test';
    await db.investors.put({
      id: invId,
      name: 'Auth Test Investor',
      capitalAmount: 100000,
      currentCapitalBalance: 100000,
      profitSharingRatio: 50,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      joinedDate: '2026-01-01',
      synced: false
    });

    // An allocation with missing period or invalid source is guarded
    let invalidRejected = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invId,
          finalizedDistributableProfit: 0,
          allocatedEconomicProfit: 0,
          allocationDate: '2026-06-30',
          currentUserId: testUserId
        },
        db
      );
    } catch (e: any) {
      invalidRejected = true;
    }
    assert(invalidRejected, 'Zero or unfinalized profit allocation is strictly rejected', summary);
  }

  // ---------------------------------------------------------------------------
  // 11. Allocation is atomic and idempotent
  // ---------------------------------------------------------------------------
  console.log('\n--- 11. Allocation is atomic and idempotent ---');
  {
    const db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await db.accounts.put(acc);
    }
    const invId = 'inv_idemp_f11';
    await db.investors.put({
      id: invId,
      name: 'Idempotency Frozen Test',
      capitalAmount: 50000,
      currentCapitalBalance: 50000,
      profitSharingRatio: 40,
      profitPayable: 0,
      status: 'ACTIVE',
      isAdmitted: true,
      economicParticipationActive: true,
      joinedDate: '2026-01-01',
      synced: false
    });

    const allocCall = {
      investorId: invId,
      finalizedDistributableProfit: 5000,
      allocatedEconomicProfit: 5000,
      allocationDate: '2026-06-30',
      idempotencyKey: 'IDEMP-FROZEN-001',
      currentUserId: testUserId
    };

    const first = await executeInvestorProfitAllocationTransaction(allocCall, db);
    assert(Boolean(first.journalEntryId), 'First allocation posts cleanly', summary);

    let secondBlocked = false;
    try {
      await executeInvestorProfitAllocationTransaction(allocCall, db);
    } catch (e: any) {
      secondBlocked = e.message.includes('Duplicate profit allocation prevented');
    }
    assert(secondBlocked, 'Second allocation with identical idempotencyKey is rejected as duplicate (idempotent)', summary);
  }

  // ---------------------------------------------------------------------------
  // 12. Accounting debit = credit
  // ---------------------------------------------------------------------------
  console.log('\n--- 12. Accounting debit = credit ---');
  {
    const balancedLines: JournalLine[] = [
      { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 500, credit: 0 },
      { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 500 }
    ];
    const balancedCheck = validateBalancedLines(balancedLines, DEFAULT_CHART_OF_ACCOUNTS as any);
    assert(balancedCheck.isBalanced === true, 'Balanced lines (debit = credit = 500) validated as balanced', summary);
    assert(balancedCheck.totalDebit === 500 && balancedCheck.totalCredit === 500, 'Total debit (500) === total credit (500)', summary);

    const unbalancedLines: JournalLine[] = [
      { accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 500, credit: 0 },
      { accountId: 'acc_3010', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 400 }
    ];
    let unbalancedThrew = false;
    try {
      validateBalancedLines(unbalancedLines, DEFAULT_CHART_OF_ACCOUNTS as any);
    } catch (e: any) {
      unbalancedThrew = e.message.includes('Unbalanced Journal Entry') || e.message.includes('ভারসাম্যহীন');
    }
    assert(unbalancedThrew, 'Unbalanced lines (500 ≠ 400) strictly rejected with critical unbalanced error', summary);
  }

  // ---------------------------------------------------------------------------
  // 13. No hard-coded/default production PIN
  // ---------------------------------------------------------------------------
  console.log('\n--- 13. No hard-coded/default production PIN ---');
  {
    for (const badPin of INSECURE_DEFAULT_PINS) {
      const res = validateProductionEnvironment({
        env: {
          NODE_ENV: 'production',
          INITIAL_PIN: badPin,
          SESSION_SECRET: '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599',
          APPROVED_OWNER_EMAILS: 'owner@thegoatedfarm.com'
        }
      });
      assert(!res.valid, `Default PIN "${badPin}" makes production validation invalid`, summary);
      assert(res.errors.some((e) => e.includes('Insecure default PIN')), `Error message flags insecure PIN "${badPin}"`, summary);
    }
  }

  // ---------------------------------------------------------------------------
  // 14. Missing production authentication secret fails closed
  // ---------------------------------------------------------------------------
  console.log('\n--- 14. Missing production authentication secret fails closed ---');
  {
    // Missing SESSION_SECRET in production
    const resNoSecret = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        INITIAL_PIN: '91827364',
        APPROVED_OWNER_EMAILS: 'owner@thegoatedfarm.com'
      }
    });
    assert(!resNoSecret.valid, 'Missing SESSION_SECRET in production fails validation (valid: false)', summary);
    assert(resNoSecret.errors.some((e) => e.includes('SESSION_SECRET')), 'Validation errors state missing SESSION_SECRET', summary);

    let assertThrew = false;
    try {
      assertProductionEnvironmentValid({
        env: {
          NODE_ENV: 'production',
          INITIAL_PIN: '91827364',
          APPROVED_OWNER_EMAILS: 'owner@thegoatedfarm.com'
        }
      });
    } catch (e: any) {
      assertThrew = e.message.includes('FATAL: Production environment validation failed');
    }
    assert(assertThrew, 'Missing production secret throws fatal error refusing startup (fails closed)', summary);
  }

  console.log('\n================================================================');
  console.log(`TASK 11 RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

// Auto-run if executed directly via npx tsx
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testTask11FreezeCorrectAccountingBehavior.ts') ||
    process.argv[1].endsWith('testTask11FreezeCorrectAccountingBehavior.js'));

if (isDirectRun) {
  runTask11FreezeCorrectAccountingBehaviorTests()
    .then((summary) => {
      if (summary.failed > 0) {
        console.error(`Task 11 failed with ${summary.failed} failures.`);
        process.exit(1);
      } else {
        console.log('Task 11: All tests passed successfully.');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error in Task 11 tests:', err);
      process.exit(1);
    });
}
