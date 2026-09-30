import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import {
  calculateAdmissionParticipation,
  admitNewInvestorWithValuation,
  getAdmissionAuditById,
  getAllAdmissionAudits,
  getAdmissionAuditsForInvestor,
  clearAdmissionAuditsForTest,
  executeInvestorTransaction,
  createValuationEvent,
  createInvestorEntrySnapshot
} from '../services/transactionService';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 9 — NEW INVESTOR ADMISSION USING VALUATION MODEL TESTS
 * Validates new-investor admission driven by valuation and contribution:
 * - Example: Pre-money ৳110, Contribution ৳100 -> Post-money ৳210
 * - Existing economic participation = 110 / 210 (52.38%)
 * - New investor economic participation = 100 / 210 (47.62%)
 * - Strictly prevents automatic 50/50 split when both contributed ৳100
 * - Driven strictly by actual contribution and valuation
 * - Stores admission valuation and participation in an auditable way
 * - Preserves original investor's historical investment amount without rewriting
 */
export async function runNewInvestorEntryValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 9: NEW INVESTOR ADMISSION VALUATION TESTS');
  console.log('Testing valuation-driven participation, 50/50 avoidance, & capital preservation');
  console.log('================================================================\n');

  clearAdmissionAuditsForTest();
  const testUserId = 'admission_auditor_p9';

  // 1. Setup mock database with default chart of accounts
  const mDb = createMockAgroDatabase();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account (1030)
  const bankAccId = 'bank_prime_p9';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 500000,
    synced: false
  });

  // ---------------------------------------------------------------------------
  // STEP 1: Pure Calculation Verification of the Prompt Example
  // ---------------------------------------------------------------------------
  console.log('--- Step 1: Mathematical Calculation Verification of the Prompt Example ---');

  // Prompt Example:
  // Existing business value before admission = ৳110.
  // New investor contributes = ৳100.
  // Post-money economic value = ৳210.
  // Existing economic participation = ৳110 / ৳210.
  // New investor economic participation = ৳100 / ৳210.
  // Original investor contributed ৳100 in the past.
  const promptExampleCalc = calculateAdmissionParticipation({
    preMoneyValuation: 110,
    contribution: 100,
    existingInvestors: [
      {
        investorId: 'inv_founder_01',
        investorName: 'Founder Tariqul',
        historicalCapital: 100, // Contributed ৳100 originally
        profitSharingRatio: 100 // Originally owned 100% of the business
      }
    ]
  });

  assert(promptExampleCalc.preMoneyValuation === 110, 'Prompt Example: Pre-money valuation is ৳110');
  assert(promptExampleCalc.contributionAmount === 100, 'Prompt Example: Contribution amount is ৳100');
  assert(promptExampleCalc.postMoneyValuation === 210, 'Prompt Example: Post-money economic value is ৳210 (110 + 100)');

  // Exact math:
  // New investor participation = 100 / 210 = 0.476190476... -> 47.62%
  // Existing economic participation = 110 / 210 = 0.523809523... -> 52.38%
  const expectedNewRatio = 100 / 210;
  const expectedExistingRatio = 110 / 210;

  assert(
    Math.abs(promptExampleCalc.newInvestorParticipationRatio - expectedNewRatio) < 0.000001,
    'Prompt Example: New investor economic participation ratio strictly equals ৳100 / ৳210'
  );
  assert(
    Math.abs(promptExampleCalc.existingEconomicParticipationRatio - expectedExistingRatio) < 0.000001,
    'Prompt Example: Existing economic participation ratio strictly equals ৳110 / ৳210'
  );
  assert(promptExampleCalc.newInvestorParticipationPercentage === 47.62, 'Prompt Example: New investor participation is 47.62%');
  assert(promptExampleCalc.existingEconomicParticipationPercentage === 52.38, 'Prompt Example: Existing participation is 52.38%');

  // CRITICAL CONSTRAINT:
  // "Do not automatically make them 50/50 merely because both contributed ৳100 originally/currently."
  assert(
    promptExampleCalc.newInvestorParticipationPercentage !== 50,
    'CRITICAL: Participation is NOT 50% for new investor despite both contributing ৳100'
  );
  assert(
    promptExampleCalc.existingEconomicParticipationPercentage !== 50,
    'CRITICAL: Participation is NOT 50% for existing investor despite both contributing ৳100'
  );
  assert(promptExampleCalc.is5050DefaultPrevented === true, 'Flag is5050DefaultPrevented is strictly true');

  // CRITICAL CONSTRAINT:
  // "Do not rewrite the original investor's historical investment amount."
  assert(
    promptExampleCalc.existingInvestorsDilution[0].historicalCapital === 100,
    'CRITICAL: Original investor historical capital remains ৳100 (NOT rewritten to ৳110 or ৳210)'
  );
  assert(
    promptExampleCalc.existingInvestorsDilution[0].newParticipationPercentage === 52.38,
    'Original investor participation diluted from 100% to 52.38%'
  );
  assert(promptExampleCalc.historicalCapitalPreserved === true, 'Flag historicalCapitalPreserved is strictly true');

  // ---------------------------------------------------------------------------
  // STEP 2: Full Database Workflow with Existing Investor & Historical Capital
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 2: Full End-to-End Admission Workflow with Valuation Model ---');

  // 1. Establish Founding Investor Tariqul with historical contribution ৳100
  const founderTx = await executeInvestorTransaction(
    {
      investorName: 'Founder Tariqul',
      phone: '01711000001',
      contribution: 100, // Historical contribution: ৳100
      profitSharingRatio: 100,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      date: '2026-01-01',
      notes: 'Initial founding capital'
    },
    mDb
  );

  assert(founderTx.investor.capitalContributed === 100, 'Founder initial capitalContributed is ৳100');
  assert(founderTx.tranche.investmentAmount === 100, 'Founder initial tranche investmentAmount is ৳100');

  // 2. Establish Approved Pre-Money Valuation Event of ৳110 (Business grew from ৳100 to ৳110)
  const valEvent = await createValuationEvent(
    {
      valuationDate: '2026-05-31',
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      totalBusinessAssetsIncluded: 150,
      relevantLiabilities: 40, // 150 - 40 = ৳110 Net Business Value
      notes: 'Pre-admission valuation establishing business value at ৳110'
    },
    mDb
  );

  assert(valEvent.resultingNetBusinessValue === 110, 'Approved valuation event establishes net business value of ৳110');

  // 3. Admit New Investor Kamal contributing ৳100 using the approved valuation model
  const admissionRes = await admitNewInvestorWithValuation(
    {
      investorName: 'New Investor Kamal',
      phone: '01811000002',
      contribution: 100, // Contributes ৳100
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      admissionDate: '2026-06-01',
      valuationEventId: valEvent.id, // Linked to ৳110 valuation event
      notes: 'Series Seed entry based on approved valuation'
    },
    mDb
  );

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Valuation-Driven Participation & Non-50/50 Rule
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 3: Verifying Valuation-Driven Participation in Admitted Records ---');

  const newInvestor = admissionRes.investor;
  const newTranche = admissionRes.tranche;
  const admissionAudit = admissionRes.admissionAudit;

  assert(newInvestor.name === 'New Investor Kamal', 'New investor record created for Kamal');
  assert(newInvestor.capitalContributed === 100, 'New investor capital contributed is ৳100');

  // New investor economic participation must be 47.62% (100 / 210), NOT 50%!
  assert(
    newInvestor.profitSharingRatio === 47.62,
    'New investor profitSharingRatio is driven by valuation to 47.62% (100 / 210)'
  );
  assert(
    newInvestor.profitSharingRatio !== 50,
    'System DID NOT automatically make them 50/50'
  );

  assert(newTranche.contractualProfitSharePercentage === 47.62, 'Tranche records contractual percentage of 47.62%');
  assert(newTranche.preMoneyValuation === 110, 'Tranche records pre-money valuation of ৳110');
  assert(newTranche.postMoneyValuation === 210, 'Tranche records post-money valuation of ৳210');
  assert(newTranche.economicParticipationPercentage === 47.62, 'Tranche records economicParticipationPercentage = 47.62%');
  assert(newTranche.valuationEventId === valEvent.id, 'Tranche links to valuation event ID');

  // ---------------------------------------------------------------------------
  // STEP 4: Verify Original Investor Historical Capital Is NOT Rewritten
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 4: Verifying Original Investor Historical Capital Preserved ---');

  const updatedFounder = await mDb.investors.get(founderTx.investor.id);
  assert(updatedFounder !== undefined, 'Founder investor record retrieved');
  assert(
    updatedFounder?.capitalContributed === 100,
    'HISTORICAL CAPITAL PRESERVED: Founder capitalContributed is still ৳100 (NOT rewritten to 110 or 210)'
  );
  assert(
    updatedFounder?.capitalAmount === 100,
    'HISTORICAL CAPITAL PRESERVED: Founder capitalAmount is still ৳100'
  );
  assert(
    updatedFounder?.currentCapitalBalance === 100,
    'HISTORICAL CAPITAL PRESERVED: Founder currentCapitalBalance is still ৳100'
  );

  // Founder tranche check
  const founderTranche = await mDb.investmentTranches.get(founderTx.tranche.id);
  assert(
    founderTranche?.investmentAmount === 100,
    'HISTORICAL TRANCHE PRESERVED: Founder tranche investmentAmount remains ৳100'
  );

  // Founder profit-sharing ratio is updated to reflect post-dilution participation: 52.38% (110 / 210)
  assert(
    updatedFounder?.profitSharingRatio === 52.38,
    'Founder economic participation diluted to 52.38% (110 / 210)'
  );

  // Combined economic participation sums to 100% (52.38% + 47.62% = 100%)
  const combinedRatio = Math.round(((updatedFounder?.profitSharingRatio || 0) + newInvestor.profitSharingRatio) * 100) / 100;
  assert(combinedRatio === 100, 'Combined economic participation of existing (52.38%) + new (47.62%) equals 100%');

  // ---------------------------------------------------------------------------
  // STEP 5: Verify Auditable Storage of Admission Valuation
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 5: Verifying Auditable Storage of Admission Valuation ---');

  assert(Boolean(admissionAudit.admissionId), 'Admission audit record generated with ID');
  assert(admissionAudit.preMoneyValuation === 110, 'Admission audit records pre-money valuation ৳110');
  assert(admissionAudit.contributionAmount === 100, 'Admission audit records contribution ৳100');
  assert(admissionAudit.postMoneyValuation === 210, 'Admission audit records post-money valuation ৳210');
  assert(admissionAudit.newInvestorParticipationPercentage === 47.62, 'Admission audit records new participation 47.62%');
  assert(admissionAudit.existingEconomicParticipationPercentage === 52.38, 'Admission audit records existing participation 52.38%');
  assert(admissionAudit.is5050DefaultPrevented === true, 'Admission audit confirms 50/50 default was prevented');
  assert(admissionAudit.historicalCapitalPreserved === true, 'Admission audit confirms historical capital preserved');
  assert(admissionAudit.valuationDrivenParticipation === true, 'Admission audit confirms valuation-driven participation');
  assert(admissionAudit.existingInvestorsDilution.length === 1, 'Admission audit captures existing investors dilution breakdown');
  assert(
    admissionAudit.existingInvestorsDilution[0].historicalCapital === 100,
    'Dilution breakdown records historical capital ৳100'
  );

  // Retrieval verification
  const retrievedAudit = await getAdmissionAuditById(admissionAudit.admissionId, mDb);
  assert(retrievedAudit !== null, 'getAdmissionAuditById retrieves audit record');
  assert(retrievedAudit?.admissionId === admissionAudit.admissionId, 'Retrieved audit ID matches');

  const investorAudits = await getAdmissionAuditsForInvestor(newInvestor.id, mDb);
  assert(investorAudits.length === 1, 'getAdmissionAuditsForInvestor retrieves audit record');

  const allAudits = await getAllAdmissionAudits(mDb);
  assert(allAudits.some((a) => a.admissionId === admissionAudit.admissionId), 'getAllAdmissionAudits includes admission audit');

  // Database audit logs check
  const dbAudits = await mDb.auditLogs.toArray();
  const admissionDbAudit = dbAudits.find((a: any) => a.action === 'INVESTOR_ADMISSION_VALUATION_RECORDED');
  assert(admissionDbAudit !== undefined, 'Audit log persisted in database for investor admission');
  assert(admissionDbAudit?.userId === testUserId, 'Audit log records responsible user ID');

  // ---------------------------------------------------------------------------
  // STEP 6: Admission via Pre-Entry Snapshot Integration
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 6: Admission via Pre-Entry Snapshot Integration ---');

  // Create pre-entry snapshot with net business value ৳300
  const snap = await createInvestorEntrySnapshot(
    {
      snapshotDate: '2026-06-15',
      responsibleUser: testUserId,
      notes: 'Pre-entry snapshot for partner 3'
    },
    mDb
  );

  // New partner Rafiq contributes ৳100 on pre-money valuation of snapshot
  // If snapshot net value is X, post-money is X + 100, participation is 100 / (X + 100)
  const snapNetValue = snap.netBusinessValue;
  const expectedSnapPostMoney = snapNetValue + 100;
  const expectedRafiqRatio = Math.round((100 / expectedSnapPostMoney) * 10000) / 100;

  const snapAdmission = await admitNewInvestorWithValuation(
    {
      investorName: 'Partner Rafiq',
      contribution: 100,
      targetAccountId: bankAccId,
      currentUserId: testUserId,
      admissionDate: '2026-06-16',
      snapshotId: snap.id,
      notes: 'Entry based on snapshot'
    },
    mDb
  );

  assert(snapAdmission.admissionAudit.snapshotId === snap.id, 'Admission links to snapshot ID');
  assert(snapAdmission.admissionAudit.preMoneyValuation === snapNetValue, 'Admission uses snapshot netBusinessValue as pre-money');
  assert(snapAdmission.investor.profitSharingRatio === expectedRafiqRatio, 'Rafiq participation matches formula: 100 / (snapNetValue + 100)');

  // ---------------------------------------------------------------------------
  // STEP 7: Input Validation & Error Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- Step 7: Input Validation & Error Handling ---');

  let rejectedMissingName = false;
  try {
    await admitNewInvestorWithValuation(
      {
        investorName: '',
        contribution: 100,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        admissionDate: '2026-06-20'
      },
      mDb
    );
  } catch {
    rejectedMissingName = true;
  }
  assert(rejectedMissingName, 'admitNewInvestorWithValuation rejects empty investor name');

  let rejectedNegativeContribution = false;
  try {
    await admitNewInvestorWithValuation(
      {
        investorName: 'Invalid Investor',
        contribution: -50,
        targetAccountId: bankAccId,
        currentUserId: testUserId,
        admissionDate: '2026-06-20'
      },
      mDb
    );
  } catch {
    rejectedNegativeContribution = true;
  }
  assert(rejectedNegativeContribution, 'admitNewInvestorWithValuation rejects negative contribution');

  let rejectedNegativeValuation = false;
  try {
    calculateAdmissionParticipation({
      preMoneyValuation: -100,
      contribution: 100
    });
  } catch {
    rejectedNegativeValuation = true;
  }
  assert(rejectedNegativeValuation, 'calculateAdmissionParticipation rejects negative pre-money valuation');

  console.log('\n================================================================');
  console.log(`PROMPT 9 NEW INVESTOR ADMISSION TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('================================================================\n');

  return result;
}

// Self-executing runner
const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('testNewInvestorEntryValuation.ts') || process.argv[1].endsWith('testNewInvestorEntryValuation.js'));

if (isDirectRun) {
  runNewInvestorEntryValuationTests()
    .then((result) => {
      if (result.failed > 0) {
        console.error(`Prompt 9 admission tests failed with ${result.failed} failures.`);
        process.exit(1);
      } else {
        console.log(`Prompt 9 admission tests PASSED cleanly: ${result.passed}/${result.total} PASS.`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running Prompt 9 admission tests:', err);
      process.exit(1);
    });
}
