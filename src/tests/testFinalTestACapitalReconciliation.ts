import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry, generateTrialBalance } from '../accounting/accountingEngine';
import {
  recordCapitalMovement,
  recordReinvestedProfitAsCapital,
  recordCapitalAdjustment
} from '../services/capitalMovementService';
import {
  generateInvestorStatement,
  inspectInvestorStatement
} from '../services/investorStatementService';
import {
  runCompleteCapitalReconciliation,
  FullCapitalReconciliationReport
} from '../services/capitalReconciliationService';
import { recordMudaribProfitDistribution } from '../services/participantCapacityService';
import { Investor, JournalLine } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL VERIFICATION — RUN ONLY AFTER 01–36 PASS
 * FINAL TEST A — Capital Reconciliation
 *
 * Requirements:
 * Run a complete mathematical reconciliation.
 *
 * For every participant:
 *   Opening Capital
 *   + New Capital
 *   + Reinvested Profit
 *   - Capital Withdrawals
 *   +/- approved capital adjustments
 *   = Closing Capital
 *
 * Find real discrepancies.
 * Do not alter numbers merely to make the equation pass.
 * Fix the root cause if necessary.
 * Return PASS only when the equation reconciles.
 */
export async function runFinalTestACapitalReconciliation(): Promise<AssertionResult> {
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
  console.log('FINAL TEST A — CAPITAL RECONCILIATION');
  console.log('Mathematical Invariant for Every Participant:');
  console.log('  Opening Capital');
  console.log('  + New Capital');
  console.log('  + Reinvested Profit');
  console.log('  - Capital Withdrawals');
  console.log('  +/- approved capital adjustments');
  console.log('  = Closing Capital');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  // Populate canonical Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: Set up Operating Farm with Multiple Diverse Participants
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Initializing Multiple Diverse Participants ---');

  // Participant 1: Al-Amin (Full lifecycle: Opening + New + Reinvest - Withdrawal + Positive Adj)
  const investor1: Investor = {
    id: 'inv_alamin_001',
    name: 'Al-Amin Agro Partner',
    phone: '01711000001',
    joinedDate: '2025-12-01',
    entryDate: '2025-12-01',
    status: 'ACTIVE',
    capitalAmount: 100000,
    capitalContributed: 100000,
    currentCapitalBalance: 100000,
    initialCapital: 100000,
    profitSharingRatio: 40,
    profitSharePercentage: 40,
    profitPayable: 0,
    totalProfitAllocated: 0,
    totalProfitPaid: 0
  };

  // Participant 2: Fatima (New entrant during period: 0 Opening + New + Reinvest)
  const investor2: Investor = {
    id: 'inv_fatima_002',
    name: 'Fatima Sultana',
    phone: '01711000002',
    joinedDate: '2026-01-10',
    entryDate: '2026-01-10',
    status: 'ACTIVE',
    capitalAmount: 150000,
    capitalContributed: 150000,
    currentCapitalBalance: 150000,
    initialCapital: 0,
    profitSharingRatio: 50,
    profitSharePercentage: 50,
    profitPayable: 0,
    totalProfitAllocated: 0,
    totalProfitPaid: 0
  };

  // Participant 3: Kamal (Opening Capital + Capital Withdrawal - Negative Adj)
  const investor3: Investor = {
    id: 'inv_kamal_003',
    name: 'Kamal Hossain',
    phone: '01711000003',
    joinedDate: '2025-10-15',
    entryDate: '2025-10-15',
    status: 'ACTIVE',
    capitalAmount: 80000,
    capitalContributed: 80000,
    currentCapitalBalance: 80000,
    initialCapital: 80000,
    profitSharingRatio: 30,
    profitSharePercentage: 30,
    profitPayable: 0,
    totalProfitAllocated: 0,
    totalProfitPaid: 0
  };

  await dbInstance.investors.put(investor1);
  await dbInstance.investors.put(investor2);
  await dbInstance.investors.put(investor3);

  // ---------------------------------------------------------------------------
  // STEP 2: Record Prior Period Opening Capital Movements & GL Journals
  // ---------------------------------------------------------------------------
  console.log('--- Step 2: Posting Prior Period Opening Capital ---');

  // Inv 1 Opening (2025-12-01): ৳100,000
  await postJournalEntry(
    {
      id: 'j_open_inv1',
      voucherNumber: 'JV-OPEN-001',
      voucherType: 'JOURNAL',
      date: '2025-12-01',
      narration: 'Al-Amin Opening Capital Contribution',
      investorId: investor1.id,
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব (Bank)',
          debit: 100000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
          debit: 0,
          credit: 100000,
          investorId: investor1.id
        }
      ],
      createdBy: 'sys_admin',
      createdAt: '2025-12-01T10:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor1.id,
      investorName: investor1.name,
      movementType: 'INITIAL_CONTRIBUTION',
      amount: 100000,
      direction: 'INFLOW',
      date: '2025-12-01',
      journalEntryId: 'j_open_inv1',
      voucherNumber: 'JV-OPEN-001',
      balanceBefore: 0,
      balanceAfter: 100000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );

  // Inv 3 Opening (2025-10-15): ৳80,000
  await postJournalEntry(
    {
      id: 'j_open_inv3',
      voucherNumber: 'JV-OPEN-003',
      voucherType: 'JOURNAL',
      date: '2025-10-15',
      narration: 'Kamal Opening Capital Contribution',
      investorId: investor3.id,
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব (Bank)',
          debit: 80000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
          debit: 0,
          credit: 80000,
          investorId: investor3.id
        }
      ],
      createdBy: 'sys_admin',
      createdAt: '2025-10-15T10:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor3.id,
      investorName: investor3.name,
      movementType: 'INITIAL_CONTRIBUTION',
      amount: 80000,
      direction: 'INFLOW',
      date: '2025-10-15',
      journalEntryId: 'j_open_inv3',
      voucherNumber: 'JV-OPEN-003',
      balanceBefore: 0,
      balanceAfter: 80000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );

  // Farm Owner Opening Capital (2025-10-01): ৳200,000
  await postJournalEntry(
    {
      id: 'j_open_owner',
      voucherNumber: 'JV-OPEN-OWNER',
      voucherType: 'JOURNAL',
      date: '2025-10-01',
      narration: 'Farm Owner Initial Capital (3010)',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব (Bank)',
          debit: 200000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: 0,
          credit: 200000
        }
      ],
      createdBy: 'sys_admin',
      createdAt: '2025-10-01T09:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Period 2026-01-01 to 2026-03-31 Movements for All Participants
  // ---------------------------------------------------------------------------
  console.log('--- Step 3: Posting Period Movements (New Capital, Reinvestment, Withdrawals, Adjustments) ---');

  // Inv 1: New Capital Inflow (2026-01-15): ৳50,000
  await postJournalEntry(
    {
      id: 'j_inv1_add',
      voucherNumber: 'JV-ADD-001',
      voucherType: 'JOURNAL',
      date: '2026-01-15',
      narration: 'Al-Amin Additional Capital Injection',
      investorId: investor1.id,
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 50000, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'মূলধন', debit: 0, credit: 50000, investorId: investor1.id }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-15T11:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor1.id,
      investorName: investor1.name,
      movementType: 'ADDITIONAL_CONTRIBUTION',
      amount: 50000,
      direction: 'INFLOW',
      date: '2026-01-15',
      journalEntryId: 'j_inv1_add',
      voucherNumber: 'JV-ADD-001',
      balanceBefore: 100000,
      balanceAfter: 150000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );
  await dbInstance.investors.update(investor1.id, { currentCapitalBalance: 150000, capitalAmount: 150000 });

  // Inv 1: Capital Withdrawal Outflow (2026-02-10): ৳20,000
  await postJournalEntry(
    {
      id: 'j_inv1_with',
      voucherNumber: 'JV-WITH-001',
      voucherType: 'JOURNAL',
      date: '2026-02-10',
      narration: 'Al-Amin Partial Capital Withdrawal',
      investorId: investor1.id,
      lines: [
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'মূলধন', debit: 20000, credit: 0, investorId: investor1.id },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 0, credit: 20000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-10T11:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor1.id,
      investorName: investor1.name,
      movementType: 'WITHDRAWAL',
      amount: 20000,
      direction: 'OUTFLOW',
      date: '2026-02-10',
      journalEntryId: 'j_inv1_with',
      voucherNumber: 'JV-WITH-001',
      balanceBefore: 150000,
      balanceAfter: 130000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );
  await dbInstance.investors.update(investor1.id, { currentCapitalBalance: 130000, capitalAmount: 130000 });

  // Inv 1: Profit Allocation & Reinvestment (2026-03-31):
  // Earns ৳25,000 profit payable, then reinvests ৳15,000 into capital
  await postJournalEntry(
    {
      id: 'j_inv1_alloc',
      voucherNumber: 'JV-ALLOC-001',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Al-Amin Contractual Profit Allocation',
      investorId: investor1.id,
      lines: [
        { accountId: 'acc_3050', accountCode: '3050', accountName: 'সংরক্ষিত আয়', debit: 25000, credit: 0 },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয়', debit: 0, credit: 25000, investorId: investor1.id }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-31T12:00:00Z'
    },
    { dbInstance }
  );
  await dbInstance.investors.update(investor1.id, { profitPayable: 25000 });

  await recordReinvestedProfitAsCapital(
    {
      investorId: investor1.id,
      reinvestAmount: 15000,
      date: '2026-03-31',
      effectiveDate: '2026-03-31',
      currentUserId: 'sys_admin',
      notes: 'Al-Amin Reinvest ৳15,000 into capital'
    },
    dbInstance
  );
  // Al-Amin capital is now: 130000 + 15000 = 145000

  // Inv 1: Approved Capital Adjustment (Positive INFLOW: ৳5,000 restructuring bonus)
  await recordCapitalAdjustment(
    {
      investorId: investor1.id,
      adjustmentAmount: 5000,
      direction: 'INFLOW',
      approvedBy: 'Board of Partners',
      date: '2026-03-31',
      currentUserId: 'sys_admin',
      notes: 'Approved capital restructuring addition'
    },
    dbInstance
  );
  // Al-Amin expected closing: 100,000 + 50,000 + 15,000 - 20,000 + 5,000 = ৳150,000. Actual = ৳150,000.

  // Participant 2 (Fatima): New Admission & Reinvestment
  // New Capital Inflow (2026-01-10): ৳150,000
  await postJournalEntry(
    {
      id: 'j_inv2_init',
      voucherNumber: 'JV-INIT-002',
      voucherType: 'JOURNAL',
      date: '2026-01-10',
      narration: 'Fatima Sultana New Capital Admission',
      investorId: investor2.id,
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 150000, credit: 0 },
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'মূলধন', debit: 0, credit: 150000, investorId: investor2.id }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-10T10:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor2.id,
      investorName: investor2.name,
      movementType: 'INITIAL_CONTRIBUTION',
      amount: 150000,
      direction: 'INFLOW',
      date: '2026-01-10',
      journalEntryId: 'j_inv2_init',
      voucherNumber: 'JV-INIT-002',
      balanceBefore: 0,
      balanceAfter: 150000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );

  // Fatima: Profit Allocation & Reinvestment (2026-03-31): Reinvest ৳20,000
  await postJournalEntry(
    {
      id: 'j_inv2_alloc',
      voucherNumber: 'JV-ALLOC-002',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Fatima Sultana Profit Allocation',
      investorId: investor2.id,
      lines: [
        { accountId: 'acc_3050', accountCode: '3050', accountName: 'সংরক্ষিত আয়', debit: 20000, credit: 0 },
        { accountId: 'acc_2050', accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয়', debit: 0, credit: 20000, investorId: investor2.id }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-03-31T12:00:00Z'
    },
    { dbInstance }
  );
  await dbInstance.investors.update(investor2.id, { profitPayable: 20000 });

  await recordReinvestedProfitAsCapital(
    {
      investorId: investor2.id,
      reinvestAmount: 20000,
      date: '2026-03-31',
      effectiveDate: '2026-03-31',
      currentUserId: 'sys_admin',
      notes: 'Fatima 100% profit reinvestment'
    },
    dbInstance
  );
  // Fatima expected closing: 0 (Opening) + 150,000 (New) + 20,000 (Reinvest) - 0 (Withdrawal) = ৳170,000. Actual = ৳170,000.

  // Participant 3 (Kamal): Opening Capital ৳80,000 - Capital Withdrawal ৳10,000 - Approved Adj ৳2,000
  // Capital Withdrawal (2026-02-28): ৳10,000
  await postJournalEntry(
    {
      id: 'j_inv3_with',
      voucherNumber: 'JV-WITH-003',
      voucherType: 'JOURNAL',
      date: '2026-02-28',
      narration: 'Kamal Partial Capital Withdrawal',
      investorId: investor3.id,
      lines: [
        { accountId: 'acc_3020', accountCode: '3020', accountName: 'মূলধন', debit: 10000, credit: 0, investorId: investor3.id },
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 0, credit: 10000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-02-28T10:00:00Z'
    },
    { dbInstance }
  );

  await recordCapitalMovement(
    {
      investorId: investor3.id,
      investorName: investor3.name,
      movementType: 'WITHDRAWAL',
      amount: 10000,
      direction: 'OUTFLOW',
      date: '2026-02-28',
      journalEntryId: 'j_inv3_with',
      voucherNumber: 'JV-WITH-003',
      balanceBefore: 80000,
      balanceAfter: 70000,
      currentUserId: 'sys_admin'
    },
    dbInstance
  );
  await dbInstance.investors.update(investor3.id, { currentCapitalBalance: 70000, capitalAmount: 70000 });

  // Kamal: Approved Capital Adjustment (Negative OUTFLOW: ৳2,000 loss write-down adjustment)
  await recordCapitalAdjustment(
    {
      investorId: investor3.id,
      adjustmentAmount: 2000,
      direction: 'OUTFLOW',
      approvedBy: 'Audit Committee',
      date: '2026-03-31',
      currentUserId: 'sys_admin',
      notes: 'Approved negative capital adjustment'
    },
    dbInstance
  );
  // Kamal expected closing: 80,000 (Opening) + 0 (New) + 0 (Reinvest) - 10,000 (Withdrawal) - 2,000 (Adjustment) = ৳68,000. Actual = ৳68,000.

  // Participant 4: Farm Owner (Mudarib & Capital Provider)
  // Owner Capital 3010: Opening ৳200,000 + Additional ৳50,000 (2026-01-20)
  await postJournalEntry(
    {
      id: 'j_owner_add',
      voucherNumber: 'JV-OWNER-ADD',
      voucherType: 'JOURNAL',
      date: '2026-01-20',
      narration: 'Owner Personal Capital Injection (3010)',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক', debit: 50000, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 50000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-20T10:00:00Z'
    },
    { dbInstance }
  );

  // Mudarib fee allocation to 3015 (strictly separated from 3010)
  await recordMudaribProfitDistribution(
    {
      mudaribPersonId: 'owner_mudarib_001',
      mudaribName: 'Farm Owner (Working Partner)',
      mudaribProfitAmount: 45000,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      currentUserId: 'sys_admin',
      notes: 'Mudarib management share strictly credited to 3015'
    },
    dbInstance
  );

  // ---------------------------------------------------------------------------
  // STEP 4: Run Mathematical Reconciliation for Every Participant
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Running Complete Mathematical Reconciliation Across All Participants ---');

  const report: FullCapitalReconciliationReport = await runCompleteCapitalReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31'
    },
    dbInstance
  );

  console.log(`\nReconciliation Results Summary:`);
  console.log(`  Total Participants Evaluated: ${report.totalParticipants}`);
  console.log(`  Reconciled Count: ${report.reconciledCount}`);
  console.log(`  Discrepancy Count: ${report.discrepancyCount}`);
  console.log(`  Is Fully Reconciled: ${report.isFullyReconciled}`);
  console.log(`  Total Opening Capital: ৳${report.totalOpeningCapital}`);
  console.log(`  Total New Capital: ৳${report.totalNewCapital}`);
  console.log(`  Total Reinvested Profit: ৳${report.totalReinvestedProfit}`);
  console.log(`  Total Capital Withdrawals: ৳${report.totalCapitalWithdrawals}`);
  console.log(`  Total Approved Adjustments: ৳${report.totalApprovedCapitalAdjustments}`);
  console.log(`  Total Expected Closing: ৳${report.totalExpectedClosingCapital}`);
  console.log(`  Total Actual Closing: ৳${report.totalActualClosingCapital}`);
  console.log(`  Total Discrepancy: ৳${report.totalDiscrepancy}`);

  // Assertions for Overall Status
  assert(report.totalParticipants >= 4, `All 4 participants evaluated (found ${report.totalParticipants})`);
  assert(report.discrepancyCount === 0, `Zero mathematical discrepancies detected (got ${report.discrepancyCount})`);
  assert(report.isFullyReconciled === true, 'Capital reconciliation overall status is strictly TRUE');
  assert(report.totalDiscrepancy === 0, `Aggregate capital discrepancy is exactly ৳0.00 (got ${report.totalDiscrepancy})`);
  assert(report.discrepancies.length === 0, 'Zero discrepancy messages reported');

  // Verify Participant 1 (Al-Amin) Mathematical Equation
  const p1 = report.participantReconciliations.find((p) => p.participantId === investor1.id);
  assert(Boolean(p1), 'Participant 1 (Al-Amin) exists in reconciliation report');
  if (p1) {
    assert(p1.openingCapital === 100000, `Al-Amin opening capital = ৳100,000 (got ${p1.openingCapital})`);
    assert(p1.newCapital === 50000, `Al-Amin new capital = ৳50,000 (got ${p1.newCapital})`);
    assert(p1.reinvestedProfit === 15000, `Al-Amin reinvested profit = ৳15,000 (got ${p1.reinvestedProfit})`);
    assert(p1.capitalWithdrawals === 20000, `Al-Amin capital withdrawals = ৳20,000 (got ${p1.capitalWithdrawals})`);
    assert(p1.approvedCapitalAdjustments === 5000, `Al-Amin approved adjustments = +৳5,000 (got ${p1.approvedCapitalAdjustments})`);
    assert(p1.expectedClosingCapital === 150000, `Al-Amin expected closing = ৳150,000 (got ${p1.expectedClosingCapital})`);
    assert(p1.actualClosingCapital === 150000, `Al-Amin actual closing = ৳150,000 (got ${p1.actualClosingCapital})`);
    assert(p1.discrepancy === 0, `Al-Amin discrepancy = ৳0 (got ${p1.discrepancy})`);
    assert(p1.isReconciled === true, 'Al-Amin is mathematically reconciled');
    // Verify exact equation: 100000 + 50000 + 15000 - 20000 + 5000 = 150000
    assert(
      p1.openingCapital + p1.newCapital + p1.reinvestedProfit - p1.capitalWithdrawals + p1.approvedCapitalAdjustments === p1.actualClosingCapital,
      'Al-Amin exact formula: Opening + New + Reinvest - Withdrawal + Adjustment = Closing holds'
    );
  }

  // Verify Participant 2 (Fatima) Mathematical Equation
  const p2 = report.participantReconciliations.find((p) => p.participantId === investor2.id);
  assert(Boolean(p2), 'Participant 2 (Fatima) exists in reconciliation report');
  if (p2) {
    assert(p2.openingCapital === 0, `Fatima opening capital = ৳0 (got ${p2.openingCapital})`);
    assert(p2.newCapital === 150000, `Fatima new capital = ৳150,000 (got ${p2.newCapital})`);
    assert(p2.reinvestedProfit === 20000, `Fatima reinvested profit = ৳20,000 (got ${p2.reinvestedProfit})`);
    assert(p2.capitalWithdrawals === 0, `Fatima capital withdrawals = ৳0 (got ${p2.capitalWithdrawals})`);
    assert(p2.approvedCapitalAdjustments === 0, `Fatima approved adjustments = ৳0 (got ${p2.approvedCapitalAdjustments})`);
    assert(p2.expectedClosingCapital === 170000, `Fatima expected closing = ৳170,000 (got ${p2.expectedClosingCapital})`);
    assert(p2.actualClosingCapital === 170000, `Fatima actual closing = ৳170,000 (got ${p2.actualClosingCapital})`);
    assert(p2.discrepancy === 0, `Fatima discrepancy = ৳0 (got ${p2.discrepancy})`);
    assert(p2.isReconciled === true, 'Fatima is mathematically reconciled');
    // Verify exact equation: 0 + 150000 + 20000 - 0 + 0 = 170000
    assert(
      p2.openingCapital + p2.newCapital + p2.reinvestedProfit - p2.capitalWithdrawals + p2.approvedCapitalAdjustments === p2.actualClosingCapital,
      'Fatima exact formula: Opening + New + Reinvest - Withdrawal + Adjustment = Closing holds'
    );
  }

  // Verify Participant 3 (Kamal) Mathematical Equation
  const p3 = report.participantReconciliations.find((p) => p.participantId === investor3.id);
  assert(Boolean(p3), 'Participant 3 (Kamal) exists in reconciliation report');
  if (p3) {
    assert(p3.openingCapital === 80000, `Kamal opening capital = ৳80,000 (got ${p3.openingCapital})`);
    assert(p3.newCapital === 0, `Kamal new capital = ৳0 (got ${p3.newCapital})`);
    assert(p3.reinvestedProfit === 0, `Kamal reinvested profit = ৳0 (got ${p3.reinvestedProfit})`);
    assert(p3.capitalWithdrawals === 10000, `Kamal capital withdrawals = ৳10,000 (got ${p3.capitalWithdrawals})`);
    assert(p3.approvedCapitalAdjustments === -2000, `Kamal approved adjustments = -৳2,000 (got ${p3.approvedCapitalAdjustments})`);
    assert(p3.expectedClosingCapital === 68000, `Kamal expected closing = ৳68,000 (got ${p3.expectedClosingCapital})`);
    assert(p3.actualClosingCapital === 68000, `Kamal actual closing = ৳68,000 (got ${p3.actualClosingCapital})`);
    assert(p3.discrepancy === 0, `Kamal discrepancy = ৳0 (got ${p3.discrepancy})`);
    assert(p3.isReconciled === true, 'Kamal is mathematically reconciled');
    // Verify exact equation: 80000 + 0 + 0 - 10000 - 2000 = 68000
    assert(
      p3.openingCapital + p3.newCapital + p3.reinvestedProfit - p3.capitalWithdrawals + p3.approvedCapitalAdjustments === p3.actualClosingCapital,
      'Kamal exact formula: Opening + New + Reinvest - Withdrawal + Adjustment = Closing holds'
    );
  }

  // Verify Participant 4 (Farm Owner) Mathematical Equation
  const pOwner = report.participantReconciliations.find((p) => p.role === 'OWNER');
  assert(Boolean(pOwner), 'Farm Owner exists in reconciliation report');
  if (pOwner) {
    assert(pOwner.openingCapital === 200000, `Owner opening capital = ৳200,000 (got ${pOwner.openingCapital})`);
    assert(pOwner.newCapital === 50000, `Owner new capital = ৳50,000 (got ${pOwner.newCapital})`);
    assert(pOwner.expectedClosingCapital === 250000, `Owner expected closing = ৳250,000 (got ${pOwner.expectedClosingCapital})`);
    assert(pOwner.actualClosingCapital === 250000, `Owner actual closing = ৳250,000 (got ${pOwner.actualClosingCapital})`);
    assert(pOwner.discrepancy === 0, `Owner discrepancy = ৳0 (got ${pOwner.discrepancy})`);
    assert(pOwner.isReconciled === true, 'Owner capital is mathematically reconciled');
  }

  // ---------------------------------------------------------------------------
  // STEP 5: Verify GL Control Accounts Reconciliation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying General Ledger Control Account Balances ---');

  // Sum of Investor Capital: 150,000 (Al-Amin) + 170,000 (Fatima) + 68,000 (Kamal) = ৳388,000
  const expectedTotalInvestorCapital = 150000 + 170000 + 68000;
  assert(
    report.glAccount3020Balance === expectedTotalInvestorCapital,
    `GL Account 3020 (Investor Capital) balance = ৳${expectedTotalInvestorCapital} (got ${report.glAccount3020Balance})`
  );
  assert(report.isGlReconciled === true, 'General Ledger Account 3020 is strictly reconciled with sub-ledger');

  // Owner Capital: ৳250,000
  assert(
    report.glAccount3010Balance === 250000,
    `GL Account 3010 (Owner Capital) balance = ৳250,000 (got ${report.glAccount3010Balance})`
  );

  // Mudarib Equity Account 3015: ৳45,000 (must NOT be merged into 3010)
  const mudaribEntries = await dbInstance.journalEntries.toArray();
  let mudaribEquityBalance = 0;
  for (const j of mudaribEntries) {
    for (const l of j.lines || []) {
      if (l.accountCode === '3015') {
        mudaribEquityBalance += (Number(l.credit) || 0) - (Number(l.debit) || 0);
      }
    }
  }
  assert(
    mudaribEquityBalance === 45000,
    `Mudarib Profit Equity (Account 3015) balance = ৳45,000 strictly separate from Owner Capital (got ${mudaribEquityBalance})`
  );

  // Double-Entry Balance Verification: Sum of Debits == Sum of Credits
  const trialBalance = await generateTrialBalance({ endDate: '2026-03-31' }, dbInstance);
  assert(trialBalance.isBalanced === true, `Trial balance is strictly balanced: Total Debit ${trialBalance.totalDebit} === Total Credit ${trialBalance.totalCredit}`);

  // ---------------------------------------------------------------------------
  // STEP 6: Negative Verification — Inject Simulated Corruption & Detect Real Discrepancy
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Negative Test — Detecting Injected Real Discrepancy ---');

  // Corrupt Al-Amin's record by tampering with his capitalAmount (e.g. ৳150,000 -> ৳155,000)
  await dbInstance.investors.update(investor1.id, { currentCapitalBalance: 155000 });

  const corruptedReport = await runCompleteCapitalReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31'
    },
    dbInstance
  );

  assert(corruptedReport.isFullyReconciled === false, 'Corrupted capital balance is correctly detected as NOT reconciled');
  assert(corruptedReport.discrepancyCount === 1, `Corrupted report flags exactly 1 discrepancy (got ${corruptedReport.discrepancyCount})`);
  assert(corruptedReport.totalDiscrepancy === 5000, `Corrupted discrepancy amount = ৳5,000 (got ${corruptedReport.totalDiscrepancy})`);
  assert(
    corruptedReport.discrepancies.some((d) => d.includes('inv_alamin_001') && d.includes('Diff: ৳5000')),
    'Discrepancy message explicitly details Al-Amin corrupted ৳5,000 diff and exact formula'
  );

  // ---------------------------------------------------------------------------
  // STEP 7: Root Cause Fix & Clean Re-Reconciliation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Root Cause Repair & Final Re-Reconciliation ---');

  // Restore true balance without altering equations
  await dbInstance.investors.update(investor1.id, { currentCapitalBalance: 150000 });

  const cleanReport = await runCompleteCapitalReconciliation(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31'
    },
    dbInstance
  );

  assert(cleanReport.isFullyReconciled === true, 'After root cause repair, complete reconciliation is strictly TRUE');
  assert(cleanReport.discrepancyCount === 0, 'Zero discrepancies after root cause fix');
  assert(cleanReport.totalDiscrepancy === 0, 'Total discrepancy is ৳0 after repair');

  console.log('\n================================================================');
  console.log('FINAL TEST A SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestACapitalReconciliation.ts') || process.argv[1]?.endsWith('testFinalTestACapitalReconciliation.js')) {
  runFinalTestACapitalReconciliation()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Test execution error:', err);
      process.exit(1);
    });
}
