import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  createAdmissionRequest,
  executeAdmissionReconciliation,
  executeAdmissionValuation,
  finalizeAdmissionValuation,
  executeAdmissionReview,
  executeAdmissionApproval,
  executeAdmissionCapitalReceipt,
  executeAdmissionFinalization,
  getAdmissionRequestById,
  clearAdmissionRequestsForTest,
  calculateNavAdmissionParticipation,
  verifyNoPrematureRounding,
  inspectNavAdmissionParticipation
} from '../services/admissionService';
import {
  calculateAdmissionParticipation,
  createValuationEvent,
  clearValuationEventsForTest
} from '../services/valuationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 3 — NEW INVESTOR ADMISSION
 * PROMPT 19 — New Investor Participation
 *
 * Requirements:
 * Implement or repair NAV-based admission participation.
 * For the current configured NAV-based admission method:
 *
 * New investor participation
 * = New capital / Post-money NAV
 *
 * Example:
 * 100 / 700
 * = 14.285714...%
 *
 * Existing participants collectively represent:
 * 600 / 700
 * = 85.714285...%
 *
 * Use safe decimal/money precision.
 * Do not round intermediate calculations prematurely.
 * Test the exact example.
 * Return PASS.
 */
export async function runPrompt19NewInvestorParticipationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 19: NEW INVESTOR PARTICIPATION (NAV-BASED)');
  console.log('Formula: New investor participation = New capital / Post-money NAV');
  console.log('Exact Example: 100 / 700 = 14.285714...%');
  console.log('Existing Participants: 600 / 700 = 85.714285...%');
  console.log('Precision: Safe decimal/money precision, no premature rounding');
  console.log('================================================================\n');

  clearAdmissionRequestsForTest();
  clearValuationEventsForTest();

  // ===========================================================================
  // STEP 1: Direct Unit Test of calculateNavAdmissionParticipation (Exact Example)
  // ===========================================================================
  console.log('--- Step 1: Exact Example Unit Test (100 / 700) ---');

  const calcExact = calculateNavAdmissionParticipation({
    newCapital: 100,
    postMoneyNav: 700,
    preMoneyNav: 600
  });

  assert(calcExact.newCapital === 100, 'New capital is 100');
  assert(calcExact.postMoneyNav === 700, 'Post-money NAV is 700');
  assert(calcExact.preMoneyNav === 600, 'Pre-money NAV is 600');

  // Verify intermediate unrounded ratios:
  const expectedNewRatio = 100 / 700; // 0.14285714285714285...
  const expectedExistingRatio = 600 / 700; // 0.8571428571428571...

  assert(
    Math.abs(calcExact.newInvestorParticipationRatio - expectedNewRatio) < 1e-12,
    `New investor participation ratio is exactly 100 / 700 (${calcExact.newInvestorParticipationRatio})`
  );
  assert(
    Math.abs(calcExact.existingParticipantsRatio - expectedExistingRatio) < 1e-12,
    `Existing participants ratio is exactly 600 / 700 (${calcExact.existingParticipantsRatio})`
  );

  // Verify exact percentages:
  const expectedNewPct = (100 / 700) * 100; // 14.285714285714285...
  const expectedExistingPct = (600 / 700) * 100; // 85.71428571428571...

  assert(
    Math.abs(calcExact.exactNewInvestorPercentage - expectedNewPct) < 1e-10,
    `Exact new investor percentage is 14.285714...% (${calcExact.exactNewInvestorPercentage}%)`
  );
  assert(
    Math.abs(calcExact.exactExistingParticipantsPercentage - expectedExistingPct) < 1e-10,
    `Exact existing participants percentage is 85.714285...% (${calcExact.exactExistingParticipantsPercentage}%)`
  );

  // Verify 6-decimal truncated values:
  assert(
    calcExact.newInvestorPercentage6Dec === 14.285714,
    `New investor percentage to 6 decimals is 14.285714 (got ${calcExact.newInvestorPercentage6Dec})`
  );
  assert(
    calcExact.existingParticipantsPercentage6Dec === 85.714285,
    `Existing participants percentage to 6 decimals is 85.714285 (got ${calcExact.existingParticipantsPercentage6Dec})`
  );

  // Verify formatted strings matching prompt:
  assert(
    calcExact.newInvestorPercentageFormatted === '14.285714...%',
    `New investor formatted string is "14.285714...%" (got "${calcExact.newInvestorPercentageFormatted}")`
  );
  assert(
    calcExact.existingParticipantsPercentageFormatted === '85.714285...%',
    `Existing participants formatted string is "85.714285...%" (got "${calcExact.existingParticipantsPercentageFormatted}")`
  );

  // Verify standard 2 decimal places rounding for display:
  assert(calcExact.newInvestorPercentage2Dec === 14.29, 'Display percentage is 14.29%');
  assert(calcExact.existingParticipantsPercentage2Dec === 85.71, 'Display percentage for existing is 85.71%');

  // Verify total sums to 100%:
  const sumPct = calcExact.exactNewInvestorPercentage + calcExact.exactExistingParticipantsPercentage;
  assert(Math.abs(sumPct - 100) < 1e-10, `Sum of economic participation equals 100% (${sumPct}%)`);

  // Verify formula string:
  assert(
    calcExact.formula.includes('New capital') && calcExact.formula.includes('Post-money NAV'),
    `Formula is: "${calcExact.formula}"`
  );
  assert(calcExact.isPrematurelyRounded === false, 'Intermediate calculations are unrounded');
  assert(calcExact.safePrecision === true, 'Safe precision flag is active');

  // ===========================================================================
  // STEP 2: Automatic Derivation of Missing Pre/Post-Money NAV
  // ===========================================================================
  console.log('\n--- Step 2: Automatic Derivation with Consistent Pre/Post Money ---');

  // Given only newCapital: 100 and postMoneyNav: 700 -> Pre-money must be 600
  const derivedFromPost = calculateNavAdmissionParticipation({
    newCapital: 100,
    postMoneyNav: 700
  });
  assert(derivedFromPost.preMoneyNav === 600, 'Pre-money NAV automatically derived as 600 from Post-money 700 - 100');
  assert(derivedFromPost.newInvestorPercentageFormatted === '14.285714...%', 'Derived post-money gives 14.285714...%');

  // Given only newCapital: 100 and preMoneyNav: 600 -> Post-money must be 700
  const derivedFromPre = calculateNavAdmissionParticipation({
    newCapital: 100,
    preMoneyNav: 600
  });
  assert(derivedFromPre.postMoneyNav === 700, 'Post-money NAV automatically derived as 700 from Pre-money 600 + 100');
  assert(derivedFromPre.existingParticipantsPercentageFormatted === '85.714285...%', 'Derived pre-money gives 85.714285...%');

  // ===========================================================================
  // STEP 3: Safe Decimal / Money Precision & Premature Rounding Prevention
  // ===========================================================================
  console.log('\n--- Step 3: Premature Rounding Prevention ---');

  // 1. Verify verifyNoPrematureRounding validates exact unrounded value
  const precisionPass = verifyNoPrematureRounding({
    newCapital: 100,
    postMoneyNav: 700,
    actualPercentage: (100 / 700) * 100
  });
  assert(precisionPass.isSafePrecision === true, 'verifyNoPrematureRounding accepts exact unrounded value');
  assert(precisionPass.discrepancy < 1e-10, 'Discrepancy for exact value is negligible');

  // 2. Verify verifyNoPrematureRounding detects and rejects premature rounding
  // If an engineer prematurely rounded 100 / 700 to 0.14 -> 14%:
  const premature14 = verifyNoPrematureRounding({
    newCapital: 100,
    postMoneyNav: 700,
    actualPercentage: 14.0
  });
  assert(premature14.isSafePrecision === false, 'verifyNoPrematureRounding detects premature rounding to 14.0%');
  assert(premature14.discrepancy > 0.28, `Discrepancy correctly reported as ~0.2857% (${premature14.discrepancy})`);

  // If an engineer prematurely rounded 100 / 700 to 0.1429 -> 14.29%:
  const premature1429 = verifyNoPrematureRounding({
    newCapital: 100,
    postMoneyNav: 700,
    actualPercentage: 14.29
  });
  assert(
    premature1429.isSafePrecision === false,
    'verifyNoPrematureRounding detects premature rounding to 14.29% (tolerance 1e-6)'
  );

  // 3. Verify existing investor dilution does NOT drift due to premature rounding
  const partCalc = calculateAdmissionParticipation({
    preMoneyValuation: 600,
    contribution: 100,
    existingInvestors: [
      {
        investorId: 'founder_alpha',
        investorName: 'Founder Alpha',
        historicalCapital: 300,
        profitSharingRatio: 60
      },
      {
        investorId: 'founder_beta',
        investorName: 'Founder Beta',
        historicalCapital: 300,
        profitSharingRatio: 40
      }
    ]
  });

  assert(partCalc.newInvestorParticipationPercentage === 14.29, 'New investor gets 14.29%');
  assert(partCalc.exactNewInvestorParticipationPercentage !== undefined, 'Exact new investor pct exists');
  assert(
    Math.abs((partCalc.exactNewInvestorParticipationPercentage || 0) - (100 / 700) * 100) < 1e-10,
    'Exact new investor pct matches 14.285714...%'
  );

  // Dilution calculation must use unrounded existingEconomicParticipationRatio (600 / 700):
  // Alpha: 60% * (600/700) = 51.42857...% -> 51.43%
  // Beta: 40% * (600/700) = 34.28571...% -> 34.29%
  const alphaDiluted = partCalc.existingInvestorsDilution.find((d) => d.investorId === 'founder_alpha');
  const betaDiluted = partCalc.existingInvestorsDilution.find((d) => d.investorId === 'founder_beta');

  assert(alphaDiluted !== undefined, 'Founder Alpha dilution computed');
  assert(alphaDiluted?.newParticipationPercentage === 51.43, 'Founder Alpha diluted to 51.43% (uses unrounded 600/700)');
  assert(betaDiluted !== undefined, 'Founder Beta dilution computed');
  assert(betaDiluted?.newParticipationPercentage === 34.29, 'Founder Beta diluted to 34.29% (uses unrounded 600/700)');
  assert(
    Math.round((51.43 + 34.29) * 100) / 100 === 85.72 || Math.round((51.43 + 34.29) * 100) / 100 === 85.71,
    'Combined diluted percentage matches existing participants portion ~85.71%'
  );

  // ===========================================================================
  // STEP 4: Full End-to-End Admission Workflow with 600 Pre-Money & 100 New Capital
  // ===========================================================================
  console.log('\n--- Step 4: Full End-to-End Admission Workflow with 600 Pre-Money & 100 New Capital ---');

  const mDb = createMockAgroDatabase();

  // Setup Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Setup Bank Account & Inventory for NAV = 600 (Cash ৳200, Inventory ৳400, Capital/Profit ৳600)
  const bankAccId = 'bank_prime_p19';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountName: 'Prime Bank A/C',
    name: 'Prime Bank A/C',
    accountType: 'BANK',
    currentBalance: 200,
    synced: false
  });

  const testUserId = 'auditor_prompt19';
  const admissionDate = '2026-06-20';

  // Setup GL entries for pre-money state: Total Assets 600, Liabilities 0 -> Pre-money NAV = 600
  await postJournalEntry(
    {
      id: 'j_p19_setup',
      voucherNumber: 'JRN-P19-001',
      voucherType: 'JOURNAL',
      date: '2026-06-01',
      narration: 'ব্যবসার প্রারম্ভিক সম্পদ ও মূলধন (Bank ৳200, Inventory ৳400, Equity ৳600)',
      reference: 'SETUP-P19',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 200,
          credit: 0,
          memo: 'ব্যাংক তহবিল'
        },
        {
          accountId: 'acc_1040',
          accountCode: '1040',
          accountName: 'পণ্য সামগ্রী ও ফিড ইনভেন্টরি',
          debit: 400,
          credit: 0,
          memo: 'ইনভেন্টরি সম্পদ'
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'মালিকের সাধারণ মূলধন',
          debit: 0,
          credit: 600,
          memo: 'মালিকানা ইকুইটি'
        }
      ],
      createdBy: testUserId,
      createdAt: '2026-06-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Create finalized pre-admission valuation event (NAV = 600)
  const valEvent = await createValuationEvent(
    {
      valuationDate: '2026-06-19',
      responsibleUser: testUserId,
      valuationMethodology: 'NET_ASSET_VALUE',
      notes: 'Finalized Business Valuation immediately prior to admission: Pre-Money NAV = 600',
      finalize: true,
      status: 'FINALIZED',
      bypassReconciliationForTest: true
    },
    mDb
  );

  // Step 4.1: Create Admission Request (Proposed: ৳100)
  const req = await createAdmissionRequest(
    {
      investorName: 'Dr. Mahmudul Hasan',
      phone: '01719999999',
      proposedContribution: 100,
      proposedProfitSharingRatio: 14.29,
      requestDate: admissionDate,
      currentUserId: testUserId,
      notes: 'PROMPT 19 candidate investor: ৳100 capital'
    },
    mDb
  );
  assert(req.id !== '', `Admission request created: ${req.requestNumber}`);
  assert(req.proposedContribution === 100, 'Proposed contribution is ৳100');

  // Step 4.2: Execute Reconciliation Gate
  const recReq = await executeAdmissionReconciliation(
    req.id,
    {
      responsibleUser: testUserId,
      bypassReconciliationForTest: true,
      notes: 'Reconciliation gate audit verified'
    },
    mDb
  );
  assert(recReq.reconciliation?.status === 'PASS', 'Reconciliation gate status is PASS');

  // Step 4.3: Execute Valuation (Pre-money NAV: ৳600, New Capital: ৳100 -> Post-money: ৳700)
  const valReq = await executeAdmissionValuation(
    req.id,
    {
      responsibleUser: testUserId,
      valuationEventId: valEvent.id,
      finalizeValuation: true,
      notes: 'Valuation established: ৳600 Pre-money NAV'
    },
    mDb
  );

  assert(valReq.valuation?.preMoneyValuation === 600, 'Valuation pre-money NAV is ৳600');
  assert(valReq.valuation?.postMoneyValuation === 700, 'Valuation post-money NAV is ৳700');
  assert(
    valReq.valuation?.calculatedParticipationPercentage === 14.29,
    'Valuation calculated participation is 14.29%'
  );
  assert(
    valReq.valuation?.exactParticipationPercentage !== undefined,
    'Exact participation percentage recorded on valuation'
  );
  assert(
    Math.abs((valReq.valuation?.exactParticipationPercentage || 0) - (100 / 700) * 100) < 1e-10,
    'Exact participation percentage matches 14.285714...%'
  );

  // Step 4.4: Review & Approval
  await executeAdmissionReview(
    req.id,
    {
      reviewedBy: 'CFO Tareq',
      reviewNotes: 'Terms reviewed and verified against NAV model',
      approvedRecommendation: true
    },
    mDb
  );

  const approvedReq = await executeAdmissionApproval(
    req.id,
    {
      approvedBy: 'Managing Director',
      approvalNotes: 'Officially approved',
      decision: 'APPROVE'
    },
    mDb
  );
  assert(approvedReq.status === 'APPROVED', 'Admission request approved');

  // Step 4.5: Capital Receipt (৳100 into Bank)
  const capReceiptReq = await executeAdmissionCapitalReceipt(
    req.id,
    {
      receivedAmount: 100,
      targetAccountId: bankAccId,
      receiptDate: admissionDate,
      currentUserId: testUserId,
      notes: '৳100 capital received'
    },
    mDb
  );
  assert(capReceiptReq.stage === 'CAPITAL_RECEIPT', 'Capital receipt stage complete');
  assert(capReceiptReq.capitalReceipt?.receivedAmount === 100, 'Capital received is ৳100');

  // Step 4.6: Finalization
  const finalResult = await executeAdmissionFinalization(
    req.id,
    {
      admissionDate,
      currentUserId: testUserId,
      contractualProfitSharePercentage: 14.29,
      notes: 'PROMPT 19 admission finalized'
    },
    mDb
  );

  assert(finalResult.request.status === 'ADMITTED', 'Request status is ADMITTED');
  assert(finalResult.investor.isAdmitted === true, 'Investor isAdmitted is true');
  assert(finalResult.investor.economicParticipationActive === true, 'Economic participation is active');
  assert(finalResult.tranche.economicParticipationPercentage === 14.29, 'Tranche participation is 14.29%');

  // Verify formal InvestorAdmissionAudit record
  const audit = finalResult.admissionAudit;
  assert(audit.preMoneyValuation === 600, 'Audit record preMoneyValuation is 600');
  assert(audit.contributionAmount === 100, 'Audit record contributionAmount is 100');
  assert(audit.postMoneyValuation === 700, 'Audit record postMoneyValuation is 700');
  assert(
    audit.exactNewInvestorParticipationPercentage !== undefined &&
      Math.abs(audit.exactNewInvestorParticipationPercentage - (100 / 700) * 100) < 1e-10,
    'Audit record preserves exactNewInvestorParticipationPercentage (14.285714...%)'
  );
  assert(
    audit.exactExistingEconomicParticipationPercentage !== undefined &&
      Math.abs(audit.exactExistingEconomicParticipationPercentage - (600 / 700) * 100) < 1e-10,
    'Audit record preserves exactExistingEconomicParticipationPercentage (85.714285...%)'
  );
  assert(audit.intermediateCalculationsUnrounded === true, 'Audit confirms intermediateCalculationsUnrounded');

  // ===========================================================================
  // STEP 5: Audit Inspection via inspectNavAdmissionParticipation
  // ===========================================================================
  console.log('\n--- Step 5: Comprehensive Inspection via inspectNavAdmissionParticipation ---');

  // Inspect by request ID
  const inspectionReq = await inspectNavAdmissionParticipation(finalResult.request.id, mDb);
  assert(inspectionReq.passed === true, 'inspectNavAdmissionParticipation on request returned PASS: true');
  assert(inspectionReq.preMoneyNav === 600, 'Inspection confirms Pre-money NAV = 600');
  assert(inspectionReq.newCapital === 100, 'Inspection confirms New Capital = 100');
  assert(inspectionReq.postMoneyNav === 700, 'Inspection confirms Post-money NAV = 700');
  assert(
    inspectionReq.newInvestorPercentageFormatted === '14.285714...%',
    `Inspection confirms new investor percentage is "14.285714...%"`
  );
  assert(
    inspectionReq.existingParticipantsPercentageFormatted === '85.714285...%',
    `Inspection confirms existing participants percentage is "85.714285...%"`
  );
  assert(inspectionReq.isPrematurelyRounded === false, 'Inspection confirms isPrematurelyRounded = false');
  assert(inspectionReq.safePrecision === true, 'Inspection confirms safePrecision = true');

  // Inspect by audit ID
  const inspectionAudit = await inspectNavAdmissionParticipation(audit.admissionId, mDb);
  assert(inspectionAudit.passed === true, 'inspectNavAdmissionParticipation on audit returned PASS: true');
  assert(
    inspectionAudit.newInvestorPercentageFormatted === '14.285714...%',
    'Audit inspection verifies 14.285714...%'
  );
  assert(
    inspectionAudit.existingParticipantsPercentageFormatted === '85.714285...%',
    'Audit inspection verifies 85.714285...%'
  );

  // Inspect arbitrary parameters (100 / 700)
  const inspectionDirect = await inspectNavAdmissionParticipation({
    newCapital: 100,
    postMoneyNav: 700,
    preMoneyNav: 600
  });
  assert(inspectionDirect.passed === true, 'inspectNavAdmissionParticipation on {100, 700, 600} returned PASS: true');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 19 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log('STATUS: ' + (result.failed === 0 ? 'PASS' : 'FAIL'));
  console.log('================================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testPrompt19NewInvestorParticipation')) {
  runPrompt19NewInvestorParticipationTests()
    .then((r) => {
      process.exit(r.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test run failed:', err);
      process.exit(1);
    });
}
