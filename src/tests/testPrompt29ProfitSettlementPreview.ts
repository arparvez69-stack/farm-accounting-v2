import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  generateProfitSettlementPreview,
  inspectProfitSettlementPreview,
  previewProfitSettlement
} from '../services/settlementService';
import { postJournalEntry } from '../accounting/accountingEngine';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 5 — SETTLEMENT AND REINVESTMENT
 * PROMPT 29 — Profit Settlement Preview
 *
 * Requirements:
 * Inspect investor/Mudarib settlement.
 *
 * After allocation, settlement must first be PREVIEW only.
 *
 * Show:
 * - allocated profit;
 * - investor profit;
 * - Mudarib profit;
 * - amount to withdraw;
 * - amount to reinvest;
 * - resulting capital.
 *
 * Preview must not mutate financial records.
 *
 * Test preview and compare database state before and after.
 *
 * Expected:
 * No financial mutation.
 *
 * Return PASS.
 */
export async function runPrompt29ProfitSettlementPreviewTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 29: PROFIT SETTLEMENT PREVIEW');
  console.log('Testing: Preview-Only Mode, All 6 Required Display Fields,');
  console.log('Investor & Mudarib Settlement, Database Snapshot Comparison (Before vs After),');
  console.log('and Guarantee of Zero Financial Mutation');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Setup Realistic Database State Before Preview
  // ===========================================================================
  console.log('--- Step 1: Initialize Database with Established Financial Records ---');

  const mDb = createMockAgroDatabase();

  // Populate Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // Populate Bank Account with established funds
  const bankAccId = 'bank_main_p29';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    name: 'Agrani Bank Main Farm Account',
    accountType: 'BANK',
    currentBalance: 75000,
    synced: false
  });

  // Populate Investors
  const invAId = 'inv_p29_A';
  const invBId = 'inv_p29_B';
  await mDb.investors.put({
    id: invAId,
    name: 'Participant A',
    phone: '01711000001',
    totalInvestment: 100,
    currentCapital: 100,
    profitPayable: 50,
    contractPercentage: 50,
    joinedDate: '2026-01-01',
    status: 'ACTIVE',
    isActive: true
  });
  await mDb.investors.put({
    id: invBId,
    name: 'Participant B',
    phone: '01711000002',
    totalInvestment: 200,
    currentCapital: 200,
    profitPayable: 120,
    contractPercentage: 60,
    joinedDate: '2026-01-01',
    status: 'ACTIVE',
    isActive: true
  });

  // Post Initial Capital & Profit Allocation Journal Entries in GL
  await postJournalEntry(
    {
      id: 'j_p29_init_cap_A',
      voucherNumber: 'JRN-P29-001A',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'Initial capital deposit A (৳100)',
      relatedPerson: invAId,
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 100, credit: 0 },
        { accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 100 }
      ],
      createdBy: 'auditor_prompt29',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  await postJournalEntry(
    {
      id: 'j_p29_init_cap_B',
      voucherNumber: 'JRN-P29-001B',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'Initial capital deposit B (৳200)',
      relatedPerson: invBId,
      lines: [
        { accountCode: '1030', accountName: 'ব্যাংক হিসাব', debit: 200, credit: 0 },
        { accountCode: '3020', accountName: 'বিনিয়োগকারীর মূলধন', debit: 0, credit: 200 }
      ],
      createdBy: 'auditor_prompt29',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  await postJournalEntry(
    {
      id: 'j_p29_profit_alloc',
      voucherNumber: 'JRN-P29-002',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: 'Allocated profit appropriation (Investor: ৳170, Mudarib: ৳130)',
      relatedPerson: invAId,
      lines: [
        { accountCode: '3070', accountName: 'মুনাফা বণ্টন', debit: 300, credit: 0 },
        { accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয় - A', debit: 0, credit: 50 },
        { accountCode: '2050', accountName: 'লভ্যাংশ প্রদেয় - B', debit: 0, credit: 120 },
        { accountCode: '3015', accountName: 'মুদারিব অংশীদারের ইকুইটি', debit: 0, credit: 130 }
      ],
      createdBy: 'auditor_prompt29',
      createdAt: new Date().toISOString()
    },
    { dbInstance: mDb }
  );

  // Capture Database State BEFORE calling Preview
  const journalEntriesBefore = await mDb.journalEntries.toArray();
  const accountsBefore = await mDb.accounts.toArray();
  const bankAccountsBefore = await mDb.cashBankAccounts.toArray();
  const investorsBefore = await mDb.investors.toArray();

  const fullDbBeforeJson = JSON.stringify({
    journalEntries: journalEntriesBefore,
    accounts: accountsBefore,
    bankAccounts: bankAccountsBefore,
    investors: investorsBefore
  });

  assert(journalEntriesBefore.length === 3, 'Initial journal entries count is exactly 3');
  assert(investorsBefore.length === 2, 'Initial investors count is exactly 2');
  assert(bankAccountsBefore[0].currentBalance === 75000, 'Initial bank balance is ৳75,000');

  // ===========================================================================
  // STEP 2: Execute Settlement Preview (Post-Allocation Scenario)
  // ===========================================================================
  console.log('\n--- Step 2: Execute generateProfitSettlementPreview ---');

  const previewParams = {
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-03-31',
    participants: [
      {
        investorId: invAId,
        name: 'Participant A',
        currentCapital: 100,
        allocatedProfit: 100,
        investorProfit: 50,
        mudaribProfit: 50,
        amountToWithdraw: 20, // Choose withdraw ৳20
        amountToReinvest: 30  // Choose reinvest ৳30 into capital
      },
      {
        investorId: invBId,
        name: 'Participant B',
        currentCapital: 200,
        allocatedProfit: 200,
        investorProfit: 120,
        mudaribProfit: 80,
        amountToWithdraw: 120, // Choose 100% withdraw
        amountToReinvest: 0    // ৳0 reinvest
      }
    ],
    mudaribWithdrawPercentage: 50 // Mudarib withdraws 50% (৳65), reinvests 50% (৳65)
  };

  const preview = await generateProfitSettlementPreview(previewParams, mDb);

  // ===========================================================================
  // STEP 3: Verify Required Preview Display Fields
  // ===========================================================================
  console.log('\n--- Step 3: Verify Preview Mode and Required Fields ---');

  // 1. Preview-Only Confirmation
  assert(preview.previewOnly === true, 'CRITICAL REQUIREMENT: Settlement response is PREVIEW only');
  assert(preview.isMutating === false, 'CRITICAL REQUIREMENT: isMutating flag is FALSE');

  const pA = preview.participants.find((p) => p.investorId === invAId)!;
  const pB = preview.participants.find((p) => p.investorId === invBId)!;

  assert(pA !== undefined, 'Participant A settlement preview item found');
  assert(pB !== undefined, 'Participant B settlement preview item found');

  // 2. Show Allocated Profit
  assert(pA.allocatedProfit === 100, 'A displays allocated profit: ৳100');
  assert(pB.allocatedProfit === 200, 'B displays allocated profit: ৳200');
  assert(preview.totalAllocatedProfit === 300, 'Total allocated profit displayed: ৳300');

  // 3. Show Investor Profit
  assert(pA.investorProfit === 50, 'A displays investor profit: ৳50');
  assert(pB.investorProfit === 120, 'B displays investor profit: ৳120');
  assert(preview.totalInvestorProfit === 170, 'Total investor profit displayed: ৳170');

  // 4. Show Mudarib Profit
  assert(pA.mudaribProfit === 50, 'A displays Mudarib profit generated: ৳50');
  assert(pB.mudaribProfit === 80, 'B displays Mudarib profit generated: ৳80');
  assert(preview.totalMudaribProfit === 130, 'Total Mudarib profit displayed: ৳130');
  assert(preview.mudarib.mudaribProfit === 130, 'Mudarib record displays total Mudarib profit: ৳130');

  // 5. Show Amount to Withdraw
  assert(pA.amountToWithdraw === 20, 'A displays amount to withdraw: ৳20');
  assert(pB.amountToWithdraw === 120, 'B displays amount to withdraw: ৳120');
  assert(preview.totalAmountToWithdraw === 140, 'Total investor amount to withdraw displayed: ৳140');
  assert(preview.mudarib.amountToWithdraw === 65, 'Mudarib displays amount to withdraw: ৳65');

  // 6. Show Amount to Reinvest
  assert(pA.amountToReinvest === 30, 'A displays amount to reinvest: ৳30');
  assert(pB.amountToReinvest === 0, 'B displays amount to reinvest: ৳0');
  assert(preview.totalAmountToReinvest === 30, 'Total investor amount to reinvest displayed: ৳30');
  assert(preview.mudarib.amountToReinvest === 65, 'Mudarib displays amount to reinvest: ৳65');

  // 7. Show Resulting Capital
  // A: 100 current + 30 reinvest = ৳130
  assert(
    pA.resultingCapital === 130,
    `CRITICAL REQUIREMENT: A displays resulting capital = ৳130 (Current 100 + Reinvest 30 = ৳${pA.resultingCapital})`
  );
  // B: 200 current + 0 reinvest = ৳200
  assert(
    pB.resultingCapital === 200,
    `CRITICAL REQUIREMENT: B displays resulting capital = ৳200 (Current 200 + Reinvest 0 = ৳${pB.resultingCapital})`
  );
  assert(
    preview.totalResultingCapital === 330,
    `Total resulting investor capital displayed = ৳330 (300 current + 30 reinvest = ৳${preview.totalResultingCapital})`
  );

  // Mudarib resulting capital/equity: ৳65
  assert(
    preview.mudarib.resultingCapitalOrEquity === 65,
    `Mudarib displays resulting equity/capital = ৳65 (got ৳${preview.mudarib.resultingCapitalOrEquity})`
  );

  // ===========================================================================
  // STEP 4: Compare Database State Before and After Preview
  // ===========================================================================
  console.log('\n--- Step 4: Compare Database State Before vs After Preview ---');

  const journalEntriesAfter = await mDb.journalEntries.toArray();
  const accountsAfter = await mDb.accounts.toArray();
  const bankAccountsAfter = await mDb.cashBankAccounts.toArray();
  const investorsAfter = await mDb.investors.toArray();

  const fullDbAfterJson = JSON.stringify({
    journalEntries: journalEntriesAfter,
    accounts: accountsAfter,
    bankAccounts: bankAccountsAfter,
    investors: investorsAfter
  });

  // Verify Counts
  assert(
    journalEntriesAfter.length === journalEntriesBefore.length,
    `Journal entries count unchanged: Before ${journalEntriesBefore.length} === After ${journalEntriesAfter.length}`
  );
  assert(
    investorsAfter.length === investorsBefore.length,
    `Investors count unchanged: Before ${investorsBefore.length} === After ${investorsAfter.length}`
  );
  assert(
    accountsAfter.length === accountsBefore.length,
    `Accounts count unchanged: Before ${accountsBefore.length} === After ${accountsAfter.length}`
  );

  // Verify Balances Unchanged
  const invAAfter = investorsAfter.find((i) => i.id === invAId)!;
  const invBAfter = investorsAfter.find((i) => i.id === invBId)!;

  assert(
    invAAfter.currentCapital === 100,
    `Investor A capital was NOT mutated in database: remains ৳100 (got ৳${invAAfter.currentCapital})`
  );
  assert(
    invBAfter.currentCapital === 200,
    `Investor B capital was NOT mutated in database: remains ৳200 (got ৳${invBAfter.currentCapital})`
  );
  assert(
    invAAfter.profitPayable === 50,
    `Investor A profit payable was NOT mutated in database: remains ৳50 (got ৳${invAAfter.profitPayable})`
  );
  assert(
    invBAfter.profitPayable === 120,
    `Investor B profit payable was NOT mutated in database: remains ৳120 (got ৳${invBAfter.profitPayable})`
  );
  assert(
    bankAccountsAfter[0].currentBalance === 75000,
    `Bank balance was NOT mutated in database: remains ৳75,000 (got ৳${bankAccountsAfter[0].currentBalance})`
  );

  // CRITICAL REQUIREMENT: Exact Deep Equality of Database State
  assert(
    fullDbBeforeJson === fullDbAfterJson,
    'CRITICAL REQUIREMENT: Expected: No financial mutation. Complete database snapshot matches 100% before and after!'
  );

  // ===========================================================================
  // STEP 5: Multiple Preview Invocations Do Not Mutate
  // ===========================================================================
  console.log('\n--- Step 5: Stress Test Multiple Consecutive Previews ---');

  // Run 5 consecutive previews with differing parameters
  for (let i = 1; i <= 5; i++) {
    await generateProfitSettlementPreview(
      {
        ...previewParams,
        participants: [
          { ...previewParams.participants[0], amountToWithdraw: i * 5, amountToReinvest: 50 - i * 5 },
          { ...previewParams.participants[1], amountToWithdraw: i * 10, amountToReinvest: 120 - i * 10 }
        ]
      },
      mDb
    );
  }

  const entriesAfterStress = await mDb.journalEntries.toArray();
  const bankAfterStress = await mDb.cashBankAccounts.toArray();
  const invAfterStress = await mDb.investors.toArray();

  assert(entriesAfterStress.length === 3, 'After 5 preview runs: Journal entries count strictly 3');
  assert(bankAfterStress[0].currentBalance === 75000, 'After 5 preview runs: Bank balance strictly ৳75,000');
  assert(invAfterStress[0].currentCapital === 100, 'After 5 preview runs: Investor A capital strictly ৳100');

  // ===========================================================================
  // STEP 6: Run Comprehensive Inspection Suite
  // ===========================================================================
  console.log('\n--- Step 6: Comprehensive inspectProfitSettlementPreview Suite ---');

  const inspection = await inspectProfitSettlementPreview({
    params: previewParams,
    dbInstance: mDb
  });

  assert(inspection.passed === true, 'inspectProfitSettlementPreview returned passed === true');
  assert(inspection.previewOnlyVerified === true, 'Inspection confirms previewOnly === true');
  assert(inspection.financialRecordsMutated === false, 'Inspection confirms financialRecordsMutated === false');
  assert(inspection.dbSnapshotMatchesBeforeAndAfter === true, 'Inspection confirms dbSnapshotMatchesBeforeAndAfter === true');
  assert(inspection.allocatedProfitShown === true, 'Inspection confirms allocatedProfitShown === true');
  assert(inspection.investorProfitShown === true, 'Inspection confirms investorProfitShown === true');
  assert(inspection.mudaribProfitShown === true, 'Inspection confirms mudaribProfitShown === true');
  assert(inspection.amountToWithdrawShown === true, 'Inspection confirms amountToWithdrawShown === true');
  assert(inspection.amountToReinvestShown === true, 'Inspection confirms amountToReinvestShown === true');
  assert(inspection.resultingCapitalShown === true, 'Inspection confirms resultingCapitalShown === true');

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('PROMPT 29 TEST SUMMARY:');
  console.log(`Total Assertions: ${result.total}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`STATUS: ${result.failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return result;
}

// Direct CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt29ProfitSettlementPreviewTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Prompt 29 tests failed with ${res.failed} failure(s).`);
        process.exit(1);
      } else {
        console.log('Prompt 29 tests passed cleanly!');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Unhandled error in Prompt 29 tests:', err);
      process.exit(1);
    });
}
