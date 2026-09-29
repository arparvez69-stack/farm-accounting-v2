import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import {
  generateTrialBalance,
  generateProfitLoss,
  generateBalanceSheet,
  getGeneralLedger
} from '../accounting/accountingEngine';
import {
  executeOwnerCapitalTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction
} from '../services/transactionService';
import { CashBankAccount, JournalEntry } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 05 — PRINCIPAL-ONLY LOAN TEST
 * FINAL RELEASE TASK 05 — FINAL PRINCIPAL-ONLY LOAN REGRESSION
 *
 * Verifies the complete principal-only loan lifecycle on isolated test data:
 * Loan received -> Principal liability recorded -> Partial principal repayment -> Final principal repayment.
 *
 * Explicitly verifies:
 * 1. No interest income (0 interest income across P&L and GL)
 * 2. No interest expense (0 interest expense across P&L and GL)
 * 3. No interest calculation (Amortization schedule items strictly have interestPortion === 0)
 * 4. No interest journal account (Account 8010 Loan Interest Expense and 7010 are never posted)
 * 5. Principal liability increases and decreases correctly
 * 6. Cash/bank balance changes correctly
 * 7. Journal entries remain balanced (Debit = Credit)
 * 8. Duplicate repayment is prevented (idempotency key, duplicate installment, overpayment)
 * 9. Loan cannot be accidentally converted into an interest-bearing transaction
 * 10. Compatibility with legacy data fields is preserved without reactivating interest accounting
 * 11. Multiple loan paths (short-term and long-term loans) remain fully intact
 * 12. Isolated test data cleanup
 */
export async function runPrincipalOnlyLoanTests(): Promise<AssertionResult> {
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
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 05: FINAL PRINCIPAL-ONLY LOAN REGRESSION TESTS');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // 0. Setup isolated test database & chart of accounts
  // --------------------------------------------------------------------------
  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.put(acc);
  }

  const initialBankBalance = 300000;
  const bankAcc: CashBankAccount = {
    id: 'cba-bank-loan-principal-test',
    name: 'Sonali Bank Commercial A/C',
    accountName: 'Sonali Bank Commercial A/C',
    accountNumber: 'SONALI-LOAN-01',
    accountType: 'BANK',
    bankName: 'Sonali Bank',
    currentBalance: 0,
    isActive: true,
    synced: false
  };
  await db.cashBankAccounts.put(bankAcc);

  const currentUserId = 'usr_principal_loan_auditor';

  // Seed initial bank liquidity via owner capital so GL 1030 and operational account are in sync
  await executeOwnerCapitalTransaction({
    amount: initialBankBalance,
    targetAccountId: bankAcc.id,
    currentUserId,
    date: '2026-03-31',
    notes: 'Initial bank funding for loan testing'
  }, db);

  // Helper to verify that NO interest accounts exist anywhere in journal entries
  async function assertNoInterestAccountsPosted(context: string) {
    const allJournals: JournalEntry[] = await db.journalEntries.toArray();
    for (const j of allJournals) {
      for (const line of j.lines) {
        assert(
          line.accountCode !== CANONICAL_ACCOUNTS.LOAN_INTEREST && line.accountCode !== '8010',
          `[${context}] Account 8010 Loan Interest Expense MUST NOT exist in journal ${j.voucherNumber || j.id}`
        );
        assert(
          line.accountCode !== '7010',
          `[${context}] Account 7010 Interest/Subsidy income MUST NOT be touched in journal ${j.voucherNumber || j.id}`
        );
      }
    }
  }

  // Helper to verify that P&L has 0 interest expense and 0 interest income
  async function assertZeroInterestInFinancialReports(context: string) {
    const pl = await generateProfitLoss(undefined, undefined, db);
    assert(
      (pl.totalOtherExpenses || 0) === 0 && pl.otherExpenses.length === 0,
      `[${context}] P&L Other Expenses (Interest) must be 0, got ${pl.totalOtherExpenses}`
    );
    assert(
      (pl.totalOtherIncome || 0) === 0 && pl.otherIncome.length === 0,
      `[${context}] P&L Other Income (Interest) must be 0, got ${pl.totalOtherIncome}`
    );
    const gl8010 = await getGeneralLedger('8010', undefined, db);
    assert(
      (gl8010.closingBalance || 0) === 0,
      `[${context}] GL 8010 Loan Interest Expense closing balance must be 0, got ${gl8010.closingBalance}`
    );
    const gl7010 = await getGeneralLedger('7010', undefined, db);
    assert(
      (gl7010.closingBalance || 0) === 0,
      `[${context}] GL 7010 Interest Income closing balance must be 0, got ${gl7010.closingBalance}`
    );
  }

  // Helper to verify Trial Balance and Balance Sheet are balanced
  async function assertStatementsBalanced(context: string) {
    const tb = await generateTrialBalance(undefined, db);
    assert(tb.isBalanced, `[${context}] Trial Balance must balance (Difference: ${tb.difference})`);
    assert(Math.abs(tb.totalDebit - tb.totalCredit) < 0.01, `[${context}] TB Debits == Credits`);

    const bs = await generateBalanceSheet(undefined, db);
    assert(bs.isBalanced, `[${context}] Balance Sheet must balance (Assets: ${bs.totalAssets})`);
  }

  // --------------------------------------------------------------------------
  // TEST 1: Loan Received -> Principal Liability Recorded
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Loan Received -> Principal Liability Recorded ---');
  const loanPrincipal = 120000;
  const tenureMonths = 12;

  // Notice we explicitly pass non-zero interestRate to prove that loan cannot be
  // accidentally converted into an interest-bearing transaction:
  const disburseRes = await executeLoanTransaction({
    lenderName: 'Bangladesh Krishi Bank',
    principal: loanPrincipal,
    interestRate: 12, // Attempt to request 12% interest
    tenureMonths,
    annualInterestRatePercent: 12, // Attempt to request 12% annual interest
    termMonths: tenureMonths,
    startDate: '2026-04-01',
    targetAccountId: bankAcc.id,
    currentUserId
  }, db);

  const loan = await db.loans.get(disburseRes.loan.id);
  assert(!!loan, 'Loan record created in database');
  assert(loan!.principalAmount === 120000, 'Principal amount is 120,000');
  assert(loan!.remainingPrincipal === 120000, 'Remaining principal is 120,000');
  assert(loan!.remainingBalance === 120000, 'Remaining balance is 120,000');
  assert(loan!.status === 'ACTIVE', 'Loan status is ACTIVE');

  // Verify interest rates were strictly forced to 0% (anti-conversion guarantee)
  assert(loan!.interestRateAnnual === 0, 'Annual interest rate is forced to 0%');
  assert(loan!.annualInterestRatePercent === 0, 'Interest rate percent is forced to 0%');
  assert(loan!.interestRate === 0, 'Interest rate is forced to 0%');
  assert(loan!.monthlyInstallment === 10000, 'Monthly installment is 10,000 (120,000 / 12 straight-line)');

  // Verify schedule has 0 interest in every installment
  assert(!!loan!.schedule && loan!.schedule.length === 12, 'Schedule contains 12 installments');
  for (const item of loan!.schedule!) {
    assert(item.interestPortion === 0, `Installment #${item.installmentNumber} interestPortion === 0`);
    assert(item.principalPortion === 10000, `Installment #${item.installmentNumber} principalPortion === 10,000`);
    assert(item.totalPayment === 10000, `Installment #${item.installmentNumber} totalPayment === 10,000`);
  }

  // Verify disbursement journal entry
  const disburseJournal = await db.journalEntries.get(disburseRes.journalEntryId);
  assert(!!disburseJournal, 'Disbursement journal entry exists');
  const dDr = disburseJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const dCr = disburseJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(dDr === dCr && dDr === 120000, 'Disbursement journal entry Debits equal Credits (৳120,000)');

  // Verify GL Accounts after disbursement:
  // Bank GL (1030) increased by 120k; Loan Liability (2110) increased by 120k
  const glBank1 = await getGeneralLedger(CANONICAL_ACCOUNTS.BANK, undefined, db);
  assert(glBank1.closingBalance === initialBankBalance + 120000, 'Bank GL (1030) increased to 420,000');

  const glLiab1 = await getGeneralLedger(CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, undefined, db);
  assert(glLiab1.closingBalance === 120000, 'Loan Liability GL (2110) credit balance is 120,000');

  const freshBank1 = await db.cashBankAccounts.get(bankAcc.id);
  assert(freshBank1!.currentBalance === initialBankBalance + 120000, 'Cash/Bank operational balance increased to 420,000');

  await assertNoInterestAccountsPosted('After Loan Disbursement');
  await assertZeroInterestInFinancialReports('After Loan Disbursement');
  await assertStatementsBalanced('After Loan Disbursement');

  // --------------------------------------------------------------------------
  // TEST 2: Partial Principal Repayment 1
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Partial Principal Repayment 1 (৳40,000) ---');
  const repay1Res = await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 40000,
    interestAmount: 0,
    installmentNumber: 1,
    repaymentDate: '2026-05-01',
    currentUserId,
    idempotencyKey: 'idemp_loan_repay_001'
  }, db);

  const loanAfterRepay1 = await db.loans.get(loan!.id);
  assert(loanAfterRepay1!.remainingPrincipal === 80000, 'Remaining principal decreased to 80,000');
  assert(loanAfterRepay1!.remainingBalance === 80000, 'Remaining balance decreased to 80,000');
  assert(loanAfterRepay1!.totalPaidPrincipal === 40000, 'Total paid principal recorded as 40,000');
  assert((loanAfterRepay1!.totalPaidInterest || 0) === 0, 'Total paid interest remains strictly 0');

  // Verify repayment journal entry
  const repay1Journal = await db.journalEntries.get(repay1Res.journalEntryId);
  assert(!!repay1Journal, 'Repayment 1 journal entry exists');
  const r1Dr = Math.round(repay1Journal!.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const r1Cr = Math.round(repay1Journal!.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  assert(r1Dr === r1Cr && r1Dr === 40000, 'Repayment 1 journal Debits equal Credits (৳40,000)');

  // Verify liability line debited and bank line credited
  const liabLine1 = repay1Journal!.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.SHORT_TERM_LOANS);
  assert(!!liabLine1 && liabLine1.debit === 40000, 'Loan Liability (2110) debited by 40,000');
  const bankLine1 = repay1Journal!.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.BANK);
  assert(!!bankLine1 && bankLine1.credit === 40000, 'Bank Account (1030) credited by 40,000');

  // Verify GL & operational balances
  const glBank2 = await getGeneralLedger(CANONICAL_ACCOUNTS.BANK, undefined, db);
  assert(glBank2.closingBalance === 380000, 'Bank GL (1030) reduced to 380,000');

  const glLiab2 = await getGeneralLedger(CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, undefined, db);
  assert(glLiab2.closingBalance === 80000, 'Loan Liability GL (2110) reduced to 80,000');

  const freshBank2 = await db.cashBankAccounts.get(bankAcc.id);
  assert(freshBank2!.currentBalance === 380000, 'Cash/Bank operational balance reduced to 380,000');

  await assertNoInterestAccountsPosted('After Repayment 1');
  await assertZeroInterestInFinancialReports('After Repayment 1');
  await assertStatementsBalanced('After Repayment 1');

  // --------------------------------------------------------------------------
  // TEST 3: Duplicate Repayment Prevention & Idempotency
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Duplicate Repayment Prevention & Idempotency ---');
  let duplicateIdempBlocked = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan!.id,
      sourceAccountId: bankAcc.id,
      principalAmount: 40000,
      interestAmount: 0,
      repaymentDate: '2026-05-01',
      currentUserId,
      idempotencyKey: 'idemp_loan_repay_001' // Same key as Repayment 1
    }, db);
  } catch (err: any) {
    duplicateIdempBlocked = true;
    console.log(`  Expected duplicate rejection caught: ${err.message}`);
  }
  assert(duplicateIdempBlocked, 'Duplicate repayment with identical idempotency key is strictly blocked');

  let duplicateInstBlocked = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan!.id,
      sourceAccountId: bankAcc.id,
      principalAmount: 10000,
      interestAmount: 0,
      installmentNumber: 1, // Already paid in Repayment 1
      repaymentDate: '2026-05-02',
      currentUserId
    }, db);
  } catch (err: any) {
    duplicateInstBlocked = true;
    console.log(`  Expected duplicate installment rejection caught: ${err.message}`);
  }
  assert(duplicateInstBlocked, 'Duplicate repayment of an already-paid installment is strictly blocked');

  // --------------------------------------------------------------------------
  // TEST 4: Partial Repayment 2 with Legacy Interest Parameter
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Partial Repayment 2 with Legacy Interest Field (৳30,000) ---');
  // Pass legacy interestAmount: 2500 to verify that system gracefully handles legacy callers
  // without reactivating interest accounting or posting account 8010:
  const repay2Res = await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 30000,
    interestAmount: 2500, // Legacy interest parameter passed
    installmentNumber: 2,
    repaymentDate: '2026-06-01',
    currentUserId,
    note: 'Partial repayment with legacy parameter'
  }, db);

  const loanAfterRepay2 = await db.loans.get(loan!.id);
  assert(loanAfterRepay2!.remainingPrincipal === 50000, 'Remaining principal decreased to 50,000 (80k - 30k)');
  assert(loanAfterRepay2!.remainingBalance === 50000, 'Remaining balance decreased to 50,000');
  assert(loanAfterRepay2!.totalPaidPrincipal === 70000, 'Total paid principal increased to 70,000');
  assert((loanAfterRepay2!.totalPaidInterest || 0) === 0, 'Total paid interest remains strictly 0');

  const repay2Journal = await db.journalEntries.get(repay2Res.journalEntryId);
  const r2Dr = Math.round(repay2Journal!.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const r2Cr = Math.round(repay2Journal!.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  assert(r2Dr === r2Cr && r2Dr === 30000, 'Repayment 2 journal Debits equal Credits (৳30,000)');

  const glLiab3 = await getGeneralLedger(CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, undefined, db);
  assert(glLiab3.closingBalance === 50000, 'Loan Liability GL (2110) reduced to 50,000');

  const glBank3 = await getGeneralLedger(CANONICAL_ACCOUNTS.BANK, undefined, db);
  assert(glBank3.closingBalance === 350000, 'Bank GL (1030) reduced to 350,000');

  await assertNoInterestAccountsPosted('After Repayment 2');
  await assertZeroInterestInFinancialReports('After Repayment 2');
  await assertStatementsBalanced('After Repayment 2');

  // --------------------------------------------------------------------------
  // TEST 5: Overpayment Protection
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Overpayment Protection ---');
  let overpaymentBlocked = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan!.id,
      sourceAccountId: bankAcc.id,
      principalAmount: 60000, // Remaining principal is 50,000
      interestAmount: 0,
      repaymentDate: '2026-06-15',
      currentUserId
    }, db);
  } catch (err: any) {
    overpaymentBlocked = true;
    console.log(`  Expected overpayment rejection caught: ${err.message}`);
  }
  assert(overpaymentBlocked, 'Repayment exceeding remaining principal (৳60k > ৳50k) is strictly blocked');

  // --------------------------------------------------------------------------
  // TEST 6: Final Principal Repayment -> Full Payoff -> PAID_OFF
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Final Principal Repayment (৳50,000) -> Full Payoff ---');
  const finalRepayRes = await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 50000,
    interestAmount: 0,
    repaymentDate: '2026-07-01',
    currentUserId,
    note: 'Final settlement of principal balance'
  }, db);

  const finalLoan = await db.loans.get(loan!.id);
  assert(finalLoan!.remainingPrincipal === 0, 'Remaining principal is 0');
  assert(finalLoan!.remainingBalance === 0, 'Remaining balance is 0');
  assert(finalLoan!.totalPaidPrincipal === 120000, 'Total paid principal equals initial principal (120,000)');
  assert((finalLoan!.totalPaidInterest || 0) === 0, 'Total paid interest remains strictly 0');
  assert(finalLoan!.status === 'PAID_OFF', 'Loan status transitioned cleanly to PAID_OFF');

  // Verify final journal entry
  const finalJournal = await db.journalEntries.get(finalRepayRes.journalEntryId);
  const fDr = Math.round(finalJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const fCr = Math.round(finalJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  assert(fDr === fCr && fDr === 50000, 'Final repayment Debits equal Credits (৳50,000)');

  // Verify GL liability is fully cleared
  const glLiabFinal = await getGeneralLedger(CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, undefined, db);
  assert(glLiabFinal.closingBalance === 0, 'Loan Liability GL (2110) closing balance is exactly 0');

  // Verify Bank GL balance is restored to initial balance (initial 300k + 120k loan - 120k repaid)
  const glBankFinal = await getGeneralLedger(CANONICAL_ACCOUNTS.BANK, undefined, db);
  assert(glBankFinal.closingBalance === initialBankBalance, 'Bank GL (1030) balance returned to initial 300,000');

  const freshBankFinal = await db.cashBankAccounts.get(bankAcc.id);
  assert(freshBankFinal!.currentBalance === initialBankBalance, 'Operational bank balance returned to initial 300,000');

  await assertNoInterestAccountsPosted('After Final Payoff');
  await assertZeroInterestInFinancialReports('After Final Payoff');
  await assertStatementsBalanced('After Final Payoff');

  // --------------------------------------------------------------------------
  // TEST 7: Attempting Repayment on Already PAID_OFF Loan is Blocked
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Attempt Repayment on Already PAID_OFF Loan ---');
  let paidOffBlocked = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan!.id,
      sourceAccountId: bankAcc.id,
      principalAmount: 5000,
      interestAmount: 0,
      repaymentDate: '2026-07-02',
      currentUserId
    }, db);
  } catch (err: any) {
    paidOffBlocked = true;
    console.log(`  Expected paid-off rejection caught: ${err.message}`);
  }
  assert(paidOffBlocked, 'Repayment attempt on already PAID_OFF loan is strictly blocked');

  // --------------------------------------------------------------------------
  // TEST 8: Verify Other Loan Paths (Long-Term Loans > 12 Months)
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Verify Other Loan Paths (Long-Term Loan > 12 Months) ---');
  const longTermPrincipal = 240000;
  const longTermTenure = 24; // 24 months > 12 months -> Long-Term Loan (2120)

  const ltRes = await executeLoanTransaction({
    lenderName: 'Sonali Bank SME Division',
    principal: longTermPrincipal,
    interestRate: 0,
    annualInterestRatePercent: 0,
    tenureMonths: longTermTenure,
    termMonths: longTermTenure,
    startDate: '2026-08-01',
    targetAccountId: bankAcc.id,
    currentUserId
  }, db);

  const ltLoan = await db.loans.get(ltRes.loan.id);
  assert(!!ltLoan, 'Long-term loan created');
  assert(ltLoan!.term === 'LONG_TERM', 'Loan classified as LONG_TERM');
  assert(ltLoan!.monthlyInstallment === 10000, 'Monthly installment is 10,000 (240,000 / 24)');

  const glLiabLT = await getGeneralLedger(CANONICAL_ACCOUNTS.LONG_TERM_LOANS, undefined, db);
  assert(glLiabLT.closingBalance === 240000, 'Long-Term Loan Liability (2120) credited by 240,000');

  // Repay one installment of long-term loan
  const ltRepayRes = await executeLoanRepaymentTransaction({
    loanId: ltLoan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 10000,
    interestAmount: 0,
    repaymentDate: '2026-09-01',
    currentUserId
  }, db);

  const ltLoanAfterRepay = await db.loans.get(ltLoan!.id);
  assert(ltLoanAfterRepay!.remainingPrincipal === 230000, 'Long-term loan remaining principal reduced to 230,000');

  const glLiabLT2 = await getGeneralLedger(CANONICAL_ACCOUNTS.LONG_TERM_LOANS, undefined, db);
  assert(glLiabLT2.closingBalance === 230000, 'Long-Term Loan Liability (2120) reduced to 230,000');

  await assertNoInterestAccountsPosted('After Long-Term Loan Partial Repayment');
  await assertZeroInterestInFinancialReports('After Long-Term Loan Partial Repayment');
  await assertStatementsBalanced('After Long-Term Loan Partial Repayment');

  // --------------------------------------------------------------------------
  // TEST 9: Clean Up Isolated Test Data
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Clean Up Isolated Test Data ---');
  await db.loans.clear();
  await db.journalEntries.clear();
  await db.cashBankAccounts.clear();
  await db.accounts.clear();
  await db.auditLogs.clear();

  const remainingLoans = await db.loans.count();
  const remainingJournals = await db.journalEntries.count();
  assert(remainingLoans === 0 && remainingJournals === 0, 'Isolated test data completely cleared');

  console.log('\n================================================================');
  console.log(`ALL PRINCIPAL-ONLY LOAN REGRESSION TESTS PASSED! (${result.passed}/${result.total}) 🎉`);
  console.log('================================================================');
  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testPrincipalOnlyLoans')) {
  runPrincipalOnlyLoanTests()
    .then((r) => process.exit(r.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}
