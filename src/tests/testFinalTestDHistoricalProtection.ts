import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  finalizeHistoricalValuation,
  finalizeHistoricalProfitAllocation,
  finalizeHistoricalInvestorAdmission,
  finalizeHistoricalSettlement,
  attemptModifyFinalizedRecord,
  createHistoricalCorrectionEvent,
  verifyReportReproducibility
} from '../services/historicalProtectionService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * FINAL TEST D — Historical Protection
 *
 * Requirements:
 * Test historical data protection.
 *
 * Create and finalize:
 * - one valuation;
 * - one profit allocation;
 * - one investor admission;
 * - one settlement.
 *
 * Then attempt to modify the historical records.
 * Verify finalized records cannot be silently changed.
 * Corrections must create new adjustment/revision events.
 * Verify old reports remain reproducible.
 * Return PASS.
 */
export async function runFinalTestDHistoricalProtection(): Promise<AssertionResult> {
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
  console.log('FINAL TEST D — HISTORICAL DATA PROTECTION');
  console.log('Testing: Finalized Records Immutability, Blocked Silent Mutation,');
  console.log('Mandatory Revision Events, and Bitwise Report Reproducibility');
  console.log('================================================================\n');

  // Initialize Isolated Test Database
  const dbInstance = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put({ ...acc });
  }

  // Pre-seed bank and capital for transactions
  await postJournalEntry(
    {
      id: 'j_init_hist_test',
      voucherNumber: 'JV-HIST-INIT',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'Initial setup for historical protection test',
      lines: [
        { accountId: 'acc_1030', accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 500000, credit: 0 },
        { accountId: 'acc_3010', accountCode: '3010', accountName: 'মালিকের মূলধন', debit: 0, credit: 500000 }
      ],
      createdBy: 'sys_admin',
      createdAt: '2026-01-01T09:00:00Z'
    },
    { dbInstance }
  );

  // ---------------------------------------------------------------------------
  // STEP 1: Create and Finalize the 4 Required Historical Artifacts
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Creating and Finalizing 4 Core Historical Records ---');

  // 1. One Finalized Valuation
  const valBundle = await finalizeHistoricalValuation(
    {
      valuationDate: '2026-06-30',
      responsibleUser: 'audit_lead_officer',
      notes: 'Mid-year audited valuation event'
    },
    dbInstance
  );
  console.log(`  Created Finalized Valuation: ID = ${valBundle.id}, NAV = ৳${valBundle.nav}`);
  assert(Boolean(valBundle.id), '1. Finalized Valuation created successfully');
  assert(valBundle.isImmutable === true, '1. Valuation record is flagged as immutable');
  assert(Boolean(valBundle.checksum), '1. Valuation has deterministic reproducibility checksum');

  // 2. One Finalized Profit Allocation
  const allocBundle = await finalizeHistoricalProfitAllocation(
    {
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      distributableProfit: 100000,
      responsibleUser: 'financial_controller',
      allocations: [
        {
          investorId: 'inv_partner_1',
          investorName: 'Partner Al-Amin',
          allocatedAmount: 40000,
          profitSharingRatio: 40
        }
      ]
    },
    dbInstance
  );
  console.log(`  Created Finalized Profit Allocation: ID = ${allocBundle.id}, Distributable = ৳${allocBundle.distributableProfit}`);
  assert(Boolean(allocBundle.id), '2. Finalized Profit Allocation created successfully');
  assert(allocBundle.isImmutable === true, '2. Profit Allocation record is flagged as immutable');
  assert(allocBundle.distributableProfit === 100000, '2. Profit Allocation distributable profit = ৳100,000');

  // 3. One Finalized Investor Admission
  const admBundle = await finalizeHistoricalInvestorAdmission(
    {
      investorId: 'inv_kamal_hist',
      investorName: 'Kamal Hossain',
      proposedInvestmentAmount: 150000,
      contractualProfitSharePercentage: 45,
      responsibleUser: 'managing_director'
    },
    dbInstance
  );
  console.log(`  Created Finalized Investor Admission: ID = ${admBundle.id}, Capital = ৳${admBundle.admittedCapital}`);
  assert(Boolean(admBundle.id), '3. Finalized Investor Admission created successfully');
  assert(admBundle.isImmutable === true, '3. Investor Admission record is flagged as immutable');
  assert(admBundle.admittedCapital === 150000, '3. Admitted capital = ৳150,000');

  // 4. One Finalized Settlement
  const settleBundle = await finalizeHistoricalSettlement(
    {
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-06-30',
      totalDistributableProfit: 60000,
      investorId: 'inv_kamal_hist',
      investorName: 'Kamal Hossain',
      investorSharePercentage: 50,
      mudaribSharePercentage: 50,
      reinvestPercentage: 50,
      bankAccountId: 'acc_1030',
      responsibleUser: 'treasury_lead'
    },
    dbInstance
  );
  console.log(`  Created Finalized Settlement: ID = ${settleBundle.id}, Withdrawable = ৳${settleBundle.withdrawableAmount}`);
  assert(Boolean(settleBundle.id), '4. Finalized Settlement created successfully');
  assert(settleBundle.isImmutable === true, '4. Settlement record is flagged as immutable');
  assert(settleBundle.withdrawableAmount === 15000, '4. Withdrawable amount = ৳15,000 (50% of 30,000)');

  // ---------------------------------------------------------------------------
  // STEP 2: Attempt to Modify Historical Records (Verify Silent Change is Blocked)
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Attempting Silent Modification of Historical Records ---');

  // Attempt 1: Modify Valuation NAV
  const modVal = await attemptModifyFinalizedRecord(
    'VALUATION',
    valBundle.id,
    { resultingNetBusinessValue: 999999, totalBusinessAssetsIncluded: 1000000 },
    dbInstance
  );
  assert(modVal.blocked === true, 'Valuation silent modification is strictly BLOCKED');
  assert(modVal.originalIntact === true, 'Original valuation financial NAV remains 100% intact');
  assert(modVal.checksumMatchesOriginal === true, 'Valuation checksum remains unchanged');

  // Attempt 2: Modify Profit Allocation
  const modAlloc = await attemptModifyFinalizedRecord(
    'PROFIT_ALLOCATION',
    allocBundle.id,
    { distributableProfit: 888888 },
    dbInstance
  );
  assert(modAlloc.blocked === true, 'Profit allocation silent modification is strictly BLOCKED');
  assert(modAlloc.originalIntact === true, 'Original profit allocation values remain 100% intact');
  assert(modAlloc.checksumMatchesOriginal === true, 'Profit allocation checksum remains unchanged');

  // Attempt 3: Modify Investor Admission
  const modAdm = await attemptModifyFinalizedRecord(
    'INVESTOR_ADMISSION',
    admBundle.id,
    { admittedCapital: 99999 },
    dbInstance
  );
  assert(modAdm.blocked === true, 'Investor admission silent modification is strictly BLOCKED');
  assert(modAdm.originalIntact === true, 'Original admission capital remains 100% intact');
  assert(modAdm.checksumMatchesOriginal === true, 'Admission checksum remains unchanged');

  // Attempt 4: Modify Settlement
  const modSettle = await attemptModifyFinalizedRecord(
    'SETTLEMENT',
    settleBundle.id,
    { withdrawableAmount: 77777 },
    dbInstance
  );
  assert(modSettle.blocked === true, 'Settlement silent modification is strictly BLOCKED');
  assert(modSettle.originalIntact === true, 'Original settlement amount remains 100% intact');
  assert(modSettle.checksumMatchesOriginal === true, 'Settlement checksum remains unchanged');

  // ---------------------------------------------------------------------------
  // STEP 3: Corrections Must Create New Adjustment/Revision Events
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Executing Corrections via New Revision/Adjustment Events ---');

  // Revision 1: Valuation Revision Event
  const revVal = await createHistoricalCorrectionEvent(
    'VALUATION',
    valBundle.id,
    {
      reason: 'Post-audit fixed asset revaluation adjustment',
      responsibleUser: 'chief_audit_officer',
      adjustmentValues: { revisedAssets: 520000, revisedLiabilities: 20000 }
    },
    dbInstance
  );
  assert(Boolean(revVal.revisionEventId), 'Valuation correction created a NEW revision event');
  assert(revVal.originalValuesPreserved === true, 'Original valuation record remains completely unwritten');
  assert(revVal.priorChecksumPreserved === true, 'Original valuation checksum is strictly preserved');

  // Revision 2: Profit Allocation Revision Event
  const revAlloc = await createHistoricalCorrectionEvent(
    'PROFIT_ALLOCATION',
    allocBundle.id,
    {
      reason: 'Approved late rebate adjustment on Q2 operating expenses',
      responsibleUser: 'financial_controller',
      adjustmentValues: { adjustedDistributableProfit: 105000 }
    },
    dbInstance
  );
  assert(Boolean(revAlloc.revisionEventId), 'Profit allocation correction created a NEW revision event');
  assert(revAlloc.originalValuesPreserved === true, 'Original profit allocation values preserved');

  // Revision 3: Investor Admission Revision Event
  const revAdm = await createHistoricalCorrectionEvent(
    'INVESTOR_ADMISSION',
    admBundle.id,
    {
      reason: 'Contract amendment updating profit sharing percentage from 45% to 50%',
      responsibleUser: 'managing_director',
      adjustmentValues: { amendedProfitShare: 50 }
    },
    dbInstance
  );
  assert(Boolean(revAdm.revisionEventId), 'Investor admission correction created a NEW revision event');
  assert(revAdm.originalValuesPreserved === true, 'Original admission event preserved');

  // Revision 4: Settlement Revision Event
  const revSettle = await createHistoricalCorrectionEvent(
    'SETTLEMENT',
    settleBundle.id,
    {
      reason: 'Withholding tax correction on settled profit dividend',
      responsibleUser: 'tax_compliance_officer',
      adjustmentValues: { revisedNetWithdrawable: 13500 }
    },
    dbInstance
  );
  assert(Boolean(revSettle.revisionEventId), 'Settlement correction created a NEW revision event');
  assert(revSettle.originalValuesPreserved === true, 'Original settlement record preserved');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Old Reports Remain 100% Reproducible
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Historical Reports Remain Bitwise Reproducible ---');

  const repVal = await verifyReportReproducibility('VALUATION', valBundle.id, valBundle.checksum, dbInstance);
  assert(repVal.reproduced === true, 'Historical Valuation report is 100% reproducible');
  assert(repVal.checksumsMatch === true, 'Valuation reproducibility checksum matches original bit-for-bit');

  const repAlloc = await verifyReportReproducibility('PROFIT_ALLOCATION', allocBundle.id, allocBundle.checksum, dbInstance);
  assert(repAlloc.reproduced === true, 'Historical Profit Allocation report is 100% reproducible');
  assert(repAlloc.checksumsMatch === true, 'Profit Allocation checksum matches original bit-for-bit');

  const repAdm = await verifyReportReproducibility('INVESTOR_ADMISSION', admBundle.id, admBundle.checksum, dbInstance);
  assert(repAdm.reproduced === true, 'Historical Investor Admission report is 100% reproducible');
  assert(repAdm.checksumsMatch === true, 'Admission checksum matches original bit-for-bit');

  const repSettle = await verifyReportReproducibility('SETTLEMENT', settleBundle.id, settleBundle.checksum, dbInstance);
  assert(repSettle.reproduced === true, 'Historical Settlement report is 100% reproducible');
  assert(repSettle.checksumsMatch === true, 'Settlement checksum matches original bit-for-bit');

  console.log('\n================================================================');
  console.log('FINAL TEST D SUMMARY:');
  console.log(`  Total Assertions: ${result.total}`);
  console.log(`  Passed: ${result.passed}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Standalone execution support
if (process.argv[1]?.endsWith('testFinalTestDHistoricalProtection.ts') || process.argv[1]?.endsWith('testFinalTestDHistoricalProtection.js')) {
  runFinalTestDHistoricalProtection()
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
