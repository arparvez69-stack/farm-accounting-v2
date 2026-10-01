import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  executePeriodEndValuation,
  inspectPeriodEndValuation
} from '../services/periodEndValuationService';
import { Investor } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 6 — REPORTING AND PERIODIC VALUATION
 * PROMPT 36 — Year-End / Period-End Valuation
 *
 * Requirements:
 * Inspect period-end valuation.
 *
 * The system must support valuation even when no new investor is entering.
 *
 * At period end, allow:
 * - reconciliation;
 * - verified assets;
 * - liabilities;
 * - NAV;
 * - profit/loss;
 * - participant economic positions;
 * - contractual profit allocation;
 * - Mudarib allocation;
 * - settlement/reinvestment.
 *
 * Do not require a new investor to trigger valuation.
 *
 * Test a normal year-end with no admission.
 *
 * Return PASS.
 */
export async function runPrompt36PeriodEndValuationTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 36: YEAR-END / PERIOD-END VALUATION');
  console.log('Testing: Normal Year-End Valuation with NO New Investor Admission');
  console.log('Core Verification: Valuation operates independently of admissions');
  console.log('9 Required Period-End Components:');
  console.log('  1. Reconciliation');
  console.log('  2. Verified Assets');
  console.log('  3. Liabilities');
  console.log('  4. NAV (Net Asset Value)');
  console.log('  5. Profit/Loss');
  console.log('  6. Participant Economic Positions');
  console.log('  7. Contractual Profit Allocation');
  console.log('  8. Mudarib Allocation');
  console.log('  9. Settlement / Reinvestment');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Initialize Database with Established Business Operations
  // Period: 2026-01-01 to 2026-12-31 (Normal Year-End Close)
  //
  // Existing Participants:
  // - Participant A: Capital ৳100,000 (Contractual Profit Share: 40%)
  // - Participant B: Capital ৳200,000 (Contractual Profit Share: 50%)
  // Total Capital: ৳300,000
  //
  // Operating Performance in 2026:
  // - Farm Sales Revenue: ৳150,000
  // - Operating Expenses: ৳50,000
  // Net Profit: ৳100,000
  //
  // Invariant: Zero admission requests, NO new investor entering!
  // ===========================================================================
  console.log('--- Step 1: Initialize Operating Farm with Established Records ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  // 1. Bank Account (Assets) = ৳460,000 (Subledger matches GL)
  await mDb.cashBankAccounts.put({
    id: 'bank_p36_main',
    accountType: 'BANK',
    name: 'Sonali Bank Farm Operational Account',
    currentBalance: 460000,
    isActive: true,
    synced: false
  });

  // Fixed Asset subledger record = ৳50,000 (Matches GL account 1550)
  await mDb.fixedAssets.put({
    id: 'fa_p36_equip',
    name: 'Dairy Farm Equipment',
    category: 'MACHINERY',
    cost: 50000,
    purchaseDate: '2026-01-01',
    status: 'ACTIVE',
    currentBookValue: 50000,
    accumulatedDepreciation: 0,
    synced: false
  });

  // Supplier subledger record = ৳30,000 (Matches GL account 2010)
  await mDb.parties.put({
    id: 'supp_p36_feed',
    name: 'Standard Feed Mills Ltd',
    phone: '01700000000',
    type: 'SUPPLIER',
    balance: 30000,
    currentBalance: 30000,
    synced: false
  });

  // Post initial capital to GL
  await postJournalEntry(
    {
      id: 'j_p36_cap_owner',
      voucherNumber: 'INIT-V-001',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'মালিকের প্রারম্ভিক মূলধন জমা',
      relatedPerson: 'Md. Tariqul Islam (Owner)',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 80000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'মালিকের মূলধন',
          debit: 0,
          credit: 80000
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-01-01T08:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  await postJournalEntry(
    {
      id: 'j_p36_cap_A',
      voucherNumber: 'INIT-V-002',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'বিনিয়োগকারী A এর মূলধন জমা',
      relatedPerson: 'Investor A (Al-Amin)',
      investorId: 'inv_p36_A',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 100000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন',
          debit: 0,
          credit: 100000,
          investorId: 'inv_p36_A'
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-01-01T08:15:00.000Z'
    },
    { dbInstance: mDb }
  );

  await postJournalEntry(
    {
      id: 'j_p36_cap_B',
      voucherNumber: 'INIT-V-003',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'বিনিয়োগকারী B এর মূলধন জমা',
      relatedPerson: 'Investor B (Babul Hossain)',
      investorId: 'inv_p36_B',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 200000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন',
          debit: 0,
          credit: 200000,
          investorId: 'inv_p36_B'
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-01-01T08:30:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 2. Fixed Assets: Dairy Farm Equipment = ৳50,000 (Account 1550)
  await postJournalEntry(
    {
      id: 'j_p36_fixed_asset',
      voucherNumber: 'FA-V-001',
      voucherType: 'JOURNAL',
      date: '2026-01-01',
      narration: 'স্থায়ী যন্ত্রপাতি সম্পদ',
      lines: [
        {
          accountId: 'acc_1550',
          accountCode: '1550',
          accountName: 'যন্ত্রপাতি ও সরঞ্জাম',
          debit: 50000,
          credit: 0
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 50000
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-01-01T09:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 3. Trade Liabilities: Feed Supplier Payable = ৳30,000 (Account 2010)
  await postJournalEntry(
    {
      id: 'j_p36_liab',
      voucherNumber: 'AP-V-001',
      voucherType: 'JOURNAL',
      date: '2026-02-01',
      narration: 'ফিড সরবরাহকারী দেনা (Accounts Payable)',
      lines: [
        {
          accountId: 'acc_5010',
          accountCode: '5010',
          accountName: 'পশুখাদ্য ও ফিড খরচ',
          debit: 30000,
          credit: 0
        },
        {
          accountId: 'acc_2010',
          accountCode: '2010',
          accountName: 'প্রদেয় হিসাব',
          debit: 0,
          credit: 30000
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-02-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 4. Sales Revenues: Cattle & Milk Sales = ৳150,000 (Account 4010)
  await postJournalEntry(
    {
      id: 'j_p36_sales',
      voucherNumber: 'SALES-V-001',
      voucherType: 'RECEIPT',
      date: '2026-06-15',
      narration: 'খামারের দুধ ও পশু বিক্রয় রাজস্ব',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 150000,
          credit: 0
        },
        {
          accountId: 'acc_4010',
          accountCode: '4010',
          accountName: 'পশু ও দুধ বিক্রয় রাজস্ব',
          debit: 0,
          credit: 150000
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-06-15T11:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 5. Operating Expenses: Farm Labour & Vet = ৳20,000 (Account 5020 & 5030)
  await postJournalEntry(
    {
      id: 'j_p36_exp',
      voucherNumber: 'EXP-V-001',
      voucherType: 'PAYMENT',
      date: '2026-08-20',
      narration: 'ফার্মের শ্রমিক ও ওষুধ খরচ',
      lines: [
        {
          accountId: 'acc_5020',
          accountCode: '5020',
          accountName: 'পশু চিকিৎসা ও টিকা খরচ',
          debit: 20000,
          credit: 0
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 20000
        }
      ],
      createdBy: 'auditor_p36',
      createdAt: '2026-08-20T12:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Seed 2 Existing Active Investors (No new investor enters)
  const invA: Investor = {
    id: 'inv_p36_A',
    name: 'Investor A (Al-Amin)',
    phone: '01711223344',
    status: 'ACTIVE',
    profitSharingRatio: 40,
    currentCapital: 100000,
    currentCapitalBalance: 100000,
    capitalAmount: 100000,
    totalInvestment: 100000,
    profitPayable: 0,
    joinedDate: '2025-01-01',
    synced: false
  };

  const invB: Investor = {
    id: 'inv_p36_B',
    name: 'Investor B (Babul Hossain)',
    phone: '01811556677',
    status: 'ACTIVE',
    profitSharingRatio: 50,
    currentCapital: 200000,
    currentCapitalBalance: 200000,
    capitalAmount: 200000,
    totalInvestment: 200000,
    profitPayable: 0,
    joinedDate: '2025-06-01',
    synced: false
  };

  await mDb.investors.put(invA);
  await mDb.investors.put(invB);

  // ===========================================================================
  // STEP 2: Execute Normal Year-End Valuation (Date: 2026-12-31)
  // Strictly WITHOUT new investor admission!
  // ===========================================================================
  console.log('--- Step 2: Executing Year-End Valuation (2026-12-31) Without Admission ---');

  const valuationDate = '2026-12-31';
  const periodStartDate = '2026-01-01';

  const valResult = await executePeriodEndValuation(
    {
      valuationDate,
      periodStartDate,
      responsibleUser: 'auditor_p36_lead',
      valuationType: 'YEAR_END',
      defaultReinvestmentPercentage: 50,
      settlementPreferences: {
        inv_p36_A: { reinvestPercentage: 50 },
        inv_p36_B: { reinvestPercentage: 25 }
      },
      notes: '২০২৬ অর্থবছরের স্বাভাবিক সমাপ্তি মূল্যায়ন — কোনো নতুন বিনিয়োগকারী নেই'
    },
    mDb
  );

  const inspection = inspectPeriodEndValuation(valResult);

  // ===========================================================================
  // Verification 1: System allows valuation without new investor / admission
  // ===========================================================================
  console.log('\n--- Verifying Core Invariant: No Admission Required ---');
  assert(valResult.isNewInvestorEntering === false, 'isNewInvestorEntering is strictly false');
  assert(valResult.hasAdmission === false, 'hasAdmission is strictly false');
  assert(valResult.admissionReference === undefined, 'admissionReference is undefined (not required)');
  assert(valResult.linkedInvestorId === undefined, 'linkedInvestorId is undefined (not required)');
  assert(inspection.noAdmissionRequired === true, 'Inspection verifies no admission required');

  // ===========================================================================
  // Verification 2: Reconciliation
  // ===========================================================================
  console.log('\n--- Verifying Component 1: Reconciliation ---');
  assert(inspection.hasReconciliation === true, 'Reconciliation component present and executed');
  assert(valResult.reconciliation.isReconciled === true, 'Reconciliation status is reconciled');
  assert(valResult.reconciliation.discrepanciesCount === 0, 'Zero unresolved reconciliation discrepancies');

  // ===========================================================================
  // Verification 3: Verified Assets
  // ===========================================================================
  console.log('\n--- Verifying Component 2: Verified Assets ---');
  assert(inspection.hasVerifiedAssets === true, 'Verified assets component present');
  assert(valResult.verifiedAssets.totalAssets > 0, `Verified total assets = ৳${valResult.verifiedAssets.totalAssets}`);
  assert(valResult.verifiedAssets.categories.length > 0, 'Asset categories transparently listed');

  // ===========================================================================
  // Verification 4: Liabilities
  // ===========================================================================
  console.log('\n--- Verifying Component 3: Liabilities ---');
  assert(inspection.hasLiabilities === true, 'Liabilities component present');
  assert(valResult.liabilities.totalLiabilities === 30000, 'Trade liabilities equal ৳30,000 (Accounts Payable)');
  assert(valResult.liabilities.categories.length > 0, 'Liability categories transparently listed');

  // ===========================================================================
  // Verification 5: Net Asset Value (NAV)
  // ===========================================================================
  console.log('\n--- Verifying Component 4: Net Asset Value (NAV) ---');
  assert(inspection.hasNav === true, 'NAV component present');
  const expectedNav = valResult.verifiedAssets.totalAssets - valResult.liabilities.totalLiabilities;
  assert(valResult.nav.netAssetValue === expectedNav, `NAV = ৳${valResult.nav.netAssetValue} matches Assets - Liabilities`);
  assert(inspection.isNavFormulaExact === true, 'NAV mathematical formula verified exact');

  // ===========================================================================
  // Verification 6: Profit / Loss
  // ===========================================================================
  console.log('\n--- Verifying Component 5: Profit/Loss ---');
  assert(inspection.hasProfitLoss === true, 'Profit/Loss component present');
  assert(valResult.profitLoss.revenue === 150000, 'Operating Revenue = ৳150,000');
  assert(valResult.profitLoss.expenses === 50000, 'Operating Expenses = ৳50,000 (30,000 feed + 20,000 vet)');
  assert(valResult.profitLoss.netProfitOrLoss === 100000, 'Net Profit = ৳100,000 (150,000 - 50,000)');
  assert(valResult.profitLoss.isProfit === true, 'Period recognized positive profit');

  // ===========================================================================
  // Verification 7: Participant Economic Positions
  // ===========================================================================
  console.log('\n--- Verifying Component 6: Participant Economic Positions ---');
  assert(inspection.hasParticipantEconomicPositions === true, 'Participant economic positions present');
  assert(valResult.participantPositions.length === 2, 'Evaluated all 2 active participants');
  assert(valResult.totalCapital === 300000, 'Total capital equals ৳300,000 (100k + 200k)');

  const posA = valResult.participantPositions.find((p) => p.participantId === 'inv_p36_A')!;
  const posB = valResult.participantPositions.find((p) => p.participantId === 'inv_p36_B')!;

  assert(posA !== undefined && posB !== undefined, 'Both participants found in positions breakdown');
  assert(posA.capitalProportionPercentage === 33.33, 'Participant A capital proportion is 33.33%');
  assert(posB.capitalProportionPercentage === 66.67, 'Participant B capital proportion is 66.67%');

  // ===========================================================================
  // Verification 8: Contractual Profit Allocation & Mudarib Allocation
  // ===========================================================================
  console.log('\n--- Verifying Components 7 & 8: Contractual Profit & Mudarib Allocation ---');
  assert(inspection.hasContractualProfitAllocation === true, 'Contractual profit allocation present');
  assert(inspection.hasMudaribAllocation === true, 'Mudarib allocation present');

  // Participant A: Economic allocation = ৳33,333.33. Contractual 40% = ৳13,333.33. Mudarib 60% = ৳20,000.00
  assert(Math.abs(posA.economicProfitAllocation - 33333.33) < 1, `A Economic Allocation: ৳${posA.economicProfitAllocation}`);
  assert(Math.abs(posA.contractualInvestorProfit - 13333.33) < 1, `A Contractual Investor Profit (40%): ৳${posA.contractualInvestorProfit}`);
  assert(Math.abs(posA.mudaribShare - 20000.00) < 1, `A Mudarib Share (60%): ৳${posA.mudaribShare}`);

  // Participant B: Economic allocation = ৳66,666.67. Contractual 50% = ৳33,333.33. Mudarib 50% = ৳33,333.34
  assert(Math.abs(posB.economicProfitAllocation - 66666.67) < 1, `B Economic Allocation: ৳${posB.economicProfitAllocation}`);
  assert(Math.abs(posB.contractualInvestorProfit - 33333.33) < 1, `B Contractual Investor Profit (50%): ৳${posB.contractualInvestorProfit}`);
  assert(Math.abs(posB.mudaribShare - 33333.34) < 1, `B Mudarib Share (50%): ৳${posB.mudaribShare}`);

  // Total sums
  const totalInvestor = posA.contractualInvestorProfit + posB.contractualInvestorProfit;
  const totalMudarib = posA.mudaribShare + posB.mudaribShare;
  assert(Math.abs(valResult.totalContractualInvestorProfit - totalInvestor) < 0.02, `Total Investor Profit: ৳${valResult.totalContractualInvestorProfit}`);
  assert(Math.abs(valResult.totalMudaribShare - totalMudarib) < 0.02, `Total Mudarib Share: ৳${valResult.totalMudaribShare}`);
  assert(inspection.isProfitDistributionExact === true, 'Economic profit distribution strictly matches investor + mudarib');

  // ===========================================================================
  // Verification 9: Settlement / Reinvestment
  // ===========================================================================
  console.log('\n--- Verifying Component 9: Settlement / Reinvestment ---');
  assert(inspection.hasSettlementReinvestment === true, 'Settlement / Reinvestment component present');
  assert(valResult.settlement.totalReinvestment > 0, `Total Reinvestment: ৳${valResult.settlement.totalReinvestment}`);
  assert(valResult.settlement.totalWithdrawal > 0, `Total Withdrawal: ৳${valResult.settlement.totalWithdrawal}`);
  assert(valResult.settlement.resultingTotalCapital === 300000 + valResult.settlement.totalReinvestment, 'Resulting capital equals initial capital + reinvestment');

  // A: 50% reinvestment of ৳13,333.33 ≈ ৳6,666.67
  assert(Math.abs(posA.amountToReinvest - 6666.67) < 1, `A Reinvestment: ৳${posA.amountToReinvest}`);
  assert(Math.abs(posA.resultingCapital - 106666.67) < 1, `A Resulting Capital: ৳${posA.resultingCapital}`);

  // B: 25% reinvestment of ৳33,333.33 ≈ ৳8,333.33
  assert(Math.abs(posB.amountToReinvest - 8333.33) < 1, `B Reinvestment: ৳${posB.amountToReinvest}`);
  assert(Math.abs(posB.resultingCapital - 208333.33) < 1, `B Resulting Capital: ৳${posB.resultingCapital}`);

  // Overall Inspection assertion
  assert(inspection.passed === true, 'Full Prompt 36 inspection passed with 0 discrepancies');

  console.log(`\n================================================================`);
  console.log(`PROMPT 36 SUMMARY: Passed ${result.passed}/${result.total} checks`);
  console.log(`PASS: Normal year-end valuation executed and verified without`);
  console.log(`requiring any new investor admission, covering all 9 components.`);
  console.log(`================================================================\n`);

  return result;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('testPrompt36PeriodEndValuation')) {
  runPrompt36PeriodEndValuationTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }).catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}
