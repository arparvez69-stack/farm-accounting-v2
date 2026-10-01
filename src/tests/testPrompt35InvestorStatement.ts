import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry, generateTrialBalance } from '../accounting/accountingEngine';
import { recordCapitalMovement } from '../services/capitalMovementService';
import {
  generateInvestorStatement,
  inspectInvestorStatement
} from '../services/investorStatementService';
import { recordMudaribProfitDistribution } from '../services/participantCapacityService';
import { Investor, InvestorCapitalMovement, JournalLine } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PHASE 6 — REPORTING AND PERIODIC VALUATION
 * PROMPT 35 — Investor Statement
 *
 * Requirements:
 * Inspect investor statements.
 *
 * Each statement must clearly separate:
 *   Opening capital
 *   + new capital
 *   + reinvested profit
 *   - capital withdrawals
 *   = closing capital
 *
 * Also show separately:
 * - economic profit allocation;
 * - contractual investor profit;
 * - Mudarib share;
 * - withdrawals;
 * - reinvestment;
 * - current capital/economic position.
 *
 * Do not combine Mudarib earnings with the owner's capital balance.
 *
 * Test one investor through a full period.
 *
 * Return PASS.
 */
export async function runPrompt35InvestorStatementTests(): Promise<AssertionResult> {
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
  console.log('STARTING PROMPT 35: INVESTOR STATEMENT');
  console.log('Testing: Full Period Investor Statement Inspection');
  console.log('Capital Equation:');
  console.log('  Opening capital + new capital + reinvested profit - capital withdrawals = closing capital');
  console.log('Separately Disclosed Elements:');
  console.log('  - economic profit allocation');
  console.log('  - contractual investor profit');
  console.log('  - Mudarib share');
  console.log('  - withdrawals (capital & profit)');
  console.log('  - reinvestment');
  console.log('  - current capital/economic position');
  console.log('Invariant:');
  console.log('  - Do NOT combine Mudarib earnings with the owner\'s capital balance');
  console.log('================================================================\n');

  // ===========================================================================
  // STEP 1: Setup Realistic Full Period Lifecycle for One Investor
  // Period: 2026-01-01 to 2026-03-31 (Q1)
  //
  // Opening capital (prior to period): ৳100,000
  // + New capital (injected 2026-01-15): ৳50,000
  // - Capital withdrawal (returned 2026-02-20): ৳20,000
  // Economic profit allocated (2026-03-31): ৳60,000
  //   - Contractual investor profit (40%): ৳24,000
  //   - Mudarib share (60%): ৳36,000
  // Settlement:
  //   + Reinvested profit (2026-03-31): ৳10,000
  //   - Profit withdrawal (paid 2026-03-31): ৳14,000
  // Expected Closing Capital: 100,000 + 50,000 + 10,000 - 20,000 = ৳140,000
  // ===========================================================================
  console.log('--- Step 1: Setting up Full Period Lifecycle for Test Investor ---');

  const mDb = createMockAgroDatabase();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await mDb.accounts.put(acc);
  }

  const bankAccId = 'bank_p35_islami';
  await mDb.cashBankAccounts.put({
    id: bankAccId,
    accountType: 'BANK',
    name: 'Islami Bank Main Farm Account',
    currentBalance: 500000,
    isActive: true,
    synced: false
  });

  const investorId = 'inv_p35_full_period';
  const investorName = 'Al-Hajj Rafiqul Islam (Investor)';
  const periodStartDate = '2026-01-01';
  const periodEndDate = '2026-03-31';

  // Seed investor profile
  await mDb.investors.put({
    id: investorId,
    name: investorName,
    phone: '01811223344',
    status: 'ACTIVE',
    profitSharingRatio: 40,
    joinedDate: '2025-12-01',
    initialCapital: 100000,
    capitalContributed: 100000,
    capitalAmount: 100000,
    currentCapitalBalance: 100000,
    profitPayable: 0,
    totalProfitAllocated: 0,
    synced: false
  });

  // 1. Prior Period Movement: Opening Capital = ৳100,000 (Date: 2025-12-01)
  await recordCapitalMovement(
    {
      investorId,
      investorName,
      movementType: 'INITIAL_CONTRIBUTION',
      amount: 100000,
      direction: 'INFLOW',
      date: '2025-12-01',
      journalEntryId: 'j_prior_cap',
      voucherNumber: 'CAP-V-001',
      sourceOrTargetAccountId: bankAccId,
      currentUserId: 'auditor_p35',
      notes: 'Initial capital investment'
    },
    mDb
  );

  // Journal for Opening Capital
  await postJournalEntry(
    {
      id: 'j_prior_cap',
      voucherNumber: 'CAP-V-001',
      voucherType: 'RECEIPT',
      date: '2025-12-01',
      narration: `${investorName} প্রারম্ভিক মূলধন বিনিয়োগ`,
      reference: 'CAP-INIT',
      relatedPerson: investorName,
      investorId,
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
          investorId
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2025-12-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 2. New Capital Injection during period (Date: 2026-01-15, ৳50,000)
  await recordCapitalMovement(
    {
      investorId,
      investorName,
      movementType: 'ADDITIONAL_CONTRIBUTION',
      amount: 50000,
      direction: 'INFLOW',
      date: '2026-01-15',
      journalEntryId: 'j_add_cap',
      voucherNumber: 'CAP-V-002',
      sourceOrTargetAccountId: bankAccId,
      currentUserId: 'auditor_p35',
      notes: 'Additional capital injection'
    },
    mDb
  );

  await postJournalEntry(
    {
      id: 'j_add_cap',
      voucherNumber: 'CAP-V-002',
      voucherType: 'RECEIPT',
      date: '2026-01-15',
      narration: `${investorName} অতিরিক্ত মূলধন সংযোজন`,
      reference: 'CAP-ADD',
      relatedPerson: investorName,
      investorId,
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 50000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন',
          debit: 0,
          credit: 50000,
          investorId
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-01-15T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 3. Capital Withdrawal during period (Date: 2026-02-20, ৳20,000)
  await recordCapitalMovement(
    {
      investorId,
      investorName,
      movementType: 'WITHDRAWAL',
      amount: 20000,
      direction: 'OUTFLOW',
      date: '2026-02-20',
      journalEntryId: 'j_cap_wd',
      voucherNumber: 'CAP-V-003',
      sourceOrTargetAccountId: bankAccId,
      currentUserId: 'auditor_p35',
      notes: 'Partial capital return/withdrawal'
    },
    mDb
  );

  await postJournalEntry(
    {
      id: 'j_cap_wd',
      voucherNumber: 'CAP-V-003',
      voucherType: 'PAYMENT',
      date: '2026-02-20',
      narration: `${investorName} মূলধন আংশিক প্রত্যাহার`,
      reference: 'CAP-WD',
      relatedPerson: investorName,
      investorId,
      lines: [
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন',
          debit: 20000,
          credit: 0,
          investorId
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 20000
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-02-20T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 4. Economic Profit Allocation (Date: 2026-03-31)
  // Economic allocation = ৳60,000
  // Contractual investor profit (40%) = ৳24,000 (Cr 2050)
  // Mudarib share (60%) = ৳36,000 (Cr 3015)
  // Farm distribution debit (Dr 3070) = ৳60,000
  await postJournalEntry(
    {
      id: 'j_profit_alloc',
      voucherNumber: 'ALLOC-V-001',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: `Q1 অর্জিত মুনাফা বণ্টন: ${investorName} (৪0%) ও মুদারিব (৬০%)`,
      reference: 'ALLOC-Q1',
      relatedPerson: investorName,
      investorId,
      lines: [
        {
          accountId: 'acc_3070',
          accountCode: '3070',
          accountName: 'মুনাফা বণ্টন',
          debit: 60000,
          credit: 0
        },
        {
          accountId: 'acc_2050',
          accountCode: '2050',
          accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়',
          debit: 0,
          credit: 24000,
          investorId
        },
        {
          accountId: 'acc_3015',
          accountCode: '3015',
          accountName: 'মুদারিব অংশীদারী মুনাফা',
          debit: 0,
          credit: 36000
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-03-31T15:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 5. Profit Reinvestment into Capital (Date: 2026-03-31, ৳10,000)
  // Dr 2050 (Payable) 10,000 | Cr 3020 (Capital) 10,000
  await recordCapitalMovement(
    {
      investorId,
      investorName,
      movementType: 'REINVESTED_PROFIT',
      amount: 10000,
      direction: 'INFLOW',
      date: '2026-03-31',
      journalEntryId: 'j_reinv',
      voucherNumber: 'REINV-V-001',
      isReinvestment: true,
      currentUserId: 'auditor_p35',
      notes: 'Profit reinvested into capital tranche'
    },
    mDb
  );

  await postJournalEntry(
    {
      id: 'j_reinv',
      voucherNumber: 'REINV-V-001',
      voucherType: 'JOURNAL',
      date: '2026-03-31',
      narration: `${investorName} লভ্যাংশ পুনর্বিনিয়োগ মূলধনে রূপান্তর`,
      reference: 'REINV-Q1',
      relatedPerson: investorName,
      investorId,
      lines: [
        {
          accountId: 'acc_2050',
          accountCode: '2050',
          accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়',
          debit: 10000,
          credit: 0,
          investorId
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'বিনিয়োগকারীর মূলধন',
          debit: 0,
          credit: 10000,
          investorId
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-03-31T16:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // 6. Profit Withdrawal / Payout (Date: 2026-03-31, ৳14,000)
  // Dr 2050 (Payable) 14,000 | Cr 1030 (Bank) 14,000
  await postJournalEntry(
    {
      id: 'j_profit_pay',
      voucherNumber: 'PAY-V-001',
      voucherType: 'PAYMENT',
      date: '2026-03-31',
      narration: `${investorName} অবশিষ্টাংশ লভ্যাংশ ব্যাংকে পরিশোধ`,
      reference: 'PAY-Q1',
      relatedPerson: investorName,
      investorId,
      lines: [
        {
          accountId: 'acc_2050',
          accountCode: '2050',
          accountName: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয়',
          debit: 14000,
          credit: 0,
          investorId
        },
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 0,
          credit: 14000
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-03-31T17:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  console.log('--- Step 2: Generate and Inspect Investor Statement for Full Period ---');

  const statement = await generateInvestorStatement(
    {
      investorId,
      periodStartDate,
      periodEndDate,
      economicProfitAllocation: 60000,
      contractualInvestorProfit: 24000,
      mudaribShare: 36000
    },
    mDb
  );

  const inspection = inspectInvestorStatement(statement);

  // ===========================================================================
  // Requirement 1: Each statement must clearly separate:
  //   Opening capital
  //   + new capital
  //   + reinvested profit
  //   - capital withdrawals
  //   = closing capital
  // ===========================================================================
  console.log('\n--- Verifying Capital Separation & Formula ---');
  assert(statement.openingCapital === 100000, 'Opening capital separated and equals ৳100,000');
  assert(statement.newCapital === 50000, 'New capital separated and equals ৳50,000');
  assert(statement.reinvestedProfit === 10000, 'Reinvested profit separated and equals ৳10,000');
  assert(statement.capitalWithdrawals === 20000, 'Capital withdrawals separated and equals ৳20,000');
  assert(statement.closingCapital === 140000, 'Closing capital separated and equals ৳140,000');

  // Verify exact mathematical formula: 100,000 + 50,000 + 10,000 - 20,000 = 140,000
  const expectedClosing =
    statement.openingCapital +
    statement.newCapital +
    statement.reinvestedProfit -
    statement.capitalWithdrawals;
  assert(
    statement.closingCapital === expectedClosing,
    `Capital formula matches exactly: ${statement.openingCapital} + ${statement.newCapital} + ${statement.reinvestedProfit} - ${statement.capitalWithdrawals} = ${expectedClosing}`
  );
  assert(inspection.checks.isCapitalFormulaExact, 'Inspection confirms isCapitalFormulaExact is true');

  // ===========================================================================
  // Requirement 2: Also show separately:
  //   - economic profit allocation;
  //   - contractual investor profit;
  //   - Mudarib share;
  //   - withdrawals;
  //   - reinvestment;
  //   - current capital/economic position.
  // ===========================================================================
  console.log('\n--- Verifying Separate Profit, Mudarib & Position Disclosures ---');
  assert(
    statement.economicProfitAllocation === 60000,
    'Economic profit allocation shown separately (৳60,000)'
  );
  assert(
    statement.contractualInvestorProfit === 24000,
    'Contractual investor profit shown separately (৳24,000)'
  );
  assert(
    statement.mudaribShare === 36000,
    'Mudarib share shown separately (৳36,000)'
  );
  assert(
    statement.withdrawalsSummary.capitalWithdrawals === 20000,
    'Capital withdrawals shown separately (৳20,000)'
  );
  assert(
    statement.withdrawalsSummary.profitWithdrawals === 14000,
    'Profit withdrawals shown separately (৳14,000)'
  );
  assert(
    statement.totalWithdrawals === 34000,
    'Total withdrawals shown separately (৳34,000)'
  );
  assert(
    statement.reinvestment === 10000,
    'Reinvestment shown separately (৳10,000)'
  );
  assert(
    statement.currentCapitalPosition === 140000,
    'Current capital position equals ৳140,000'
  );
  assert(
    statement.currentEconomicPosition === 140000,
    'Current economic position equals ৳140,000'
  );

  // ===========================================================================
  // Requirement 3: Do not combine Mudarib earnings with the owner's capital balance
  // ===========================================================================
  console.log('\n--- Verifying Mudarib Earnings Separation from Owner Capital ---');

  // Seed Owner with personal capital (Account 3010) = ৳200,000
  // and Mudarib Profit Distribution (Account 3015) = ৳36,000
  await postJournalEntry(
    {
      id: 'j_owner_cap_init',
      voucherNumber: 'OWN-V-001',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'মালিকের ব্যক্তিগত মূলধন জমা',
      reference: 'OWN-INIT',
      lines: [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'ব্যাংক হিসাব',
          debit: 200000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'মালিকের মূলধন',
          debit: 0,
          credit: 200000
        }
      ],
      createdBy: 'auditor_p35',
      createdAt: '2026-01-01T10:00:00.000Z'
    },
    { dbInstance: mDb }
  );

  // Generate statement after owner records
  const ownerStatement = await generateInvestorStatement(
    {
      investorId,
      periodStartDate,
      periodEndDate,
      economicProfitAllocation: 60000,
      contractualInvestorProfit: 24000,
      mudaribShare: 36000
    },
    mDb
  );

  assert(
    ownerStatement.mudaribSeparation.isMudaribCombinedWithCapital === false,
    'Mudarib earnings are NOT combined with owner capital balance'
  );
  assert(
    ownerStatement.mudaribSeparation.ownerCapitalBalance === 200000,
    'Owner personal capital balance (Account 3010) strictly maintained at ৳200,000'
  );
  assert(
    ownerStatement.mudaribSeparation.mudaribEarnings === 36000,
    'Mudarib earnings (Account 3015) strictly maintained in separate equity account at ৳36,000'
  );
  assert(
    ownerStatement.mudaribSeparation.isSeparate === true,
    'Mudarib separation verification flag is true'
  );

  // Verify overall inspection passed
  const fullInspection = inspectInvestorStatement(ownerStatement);
  assert(fullInspection.passed === true, 'Full inspection passes all Prompt 35 criteria');
  assert(fullInspection.discrepancies.length === 0, 'Zero discrepancies reported');

  console.log(`\n================================================================`);
  console.log(`PROMPT 35 SUMMARY: Passed ${result.passed}/${result.total} checks`);
  console.log(`PASS: Investor statement verified with exact capital equation,`);
  console.log(`separate profit/mudarib/withdrawal/position elements, and`);
  console.log(`strict separation of Mudarib earnings from owner capital.`);
  console.log(`================================================================\n`);

  return result;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('testPrompt35InvestorStatement')) {
  runPrompt35InvestorStatementTests().then((res) => {
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
