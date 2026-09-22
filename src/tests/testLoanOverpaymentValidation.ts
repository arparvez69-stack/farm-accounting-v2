import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { executeLoanRepaymentTransaction } from '../services/transactionService';
import { Loan, CashBankAccount } from '../types';
import { generateAmortizationSchedule } from '../accounting/amortizationService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runLoanOverpaymentValidationTest() {
  console.log('====================================================');
  console.log('STARTING LOAN REPAYMENT OVERPAYMENT VALIDATION TEST');
  console.log('====================================================\n');

  // 1. Seed Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  await db.journalEntries.clear();
  await db.cashBankAccounts.clear();
  await db.loans.clear();
  await db.auditLogs.clear();

  const bankAccount: CashBankAccount = {
    id: 'cba-bank-loan-test',
    name: 'City Bank',
    accountName: 'City Bank A/C',
    accountType: 'BANK',
    accountNumber: 'BANK-01',
    bankName: 'City Bank',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.add(bankAccount);

  // 2. Seed a Loan: Principal 50,000, 10% annual rate, 12 months
  const schedule = generateAmortizationSchedule(50000, 10, 12, '2026-01-01');
  const totalScheduledInterest = schedule.reduce((sum, s) => sum + s.interestPortion, 0);

  const loan: Loan = {
    id: 'LN-TEST-001',
    loanNumber: 'PAY-LN-001',
    lenderName: 'BRAC Bank',
    loanType: 'BANK',
    principalAmount: 50000,
    remainingPrincipal: 50000,
    remainingBalance: 50000,
    annualInterestRatePercent: 10,
    interestRateAnnual: 10,
    termMonths: 12,
    schedule,
    status: 'ACTIVE'
  };
  await db.loans.add(loan);

  console.log(`Loan initialized with Principal: 50,000, Scheduled Interest: ~${Math.round(totalScheduledInterest)}`);

  // --- TEST 1: Reject when principal repayment > remaining principal ---
  console.log('\n--- TEST 1: Reject principal repayment > remaining principal ---');
  const journalCountBefore1 = await db.journalEntries.count();
  const bankBalanceBefore1 = (await db.cashBankAccounts.get('cba-bank-loan-test'))?.currentBalance;
  let caught1 = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: 'LN-TEST-001',
      sourceAccountId: 'cba-bank-loan-test',
      principalAmount: 55000, // 55,000 > 50,000 remaining principal
      interestAmount: 0,
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught1 = true;
    console.log('Caught error as expected:', err.message);
    assert(
      err.message.includes('principal repayment exceeds remaining principal') ||
      err.message.includes('অবশিষ্ট আসলের চেয়ে বেশি'),
      'Must mention principal repayment exceeds remaining principal'
    );
  }
  assert(caught1, 'Should reject when principal repayment > remaining principal');

  // Verify NO changes occurred before reject
  const journalCountAfter1 = await db.journalEntries.count();
  assert(journalCountBefore1 === journalCountAfter1, 'No journal entry should be created on rejection');
  const bankBalanceAfter1 = (await db.cashBankAccounts.get('cba-bank-loan-test'))?.currentBalance;
  assert(bankBalanceBefore1 === bankBalanceAfter1, 'Bank balance must not change on rejection');
  const loanAfter1 = await db.loans.get('LN-TEST-001');
  assert(loanAfter1?.remainingPrincipal === 50000, 'Loan remaining principal must not change on rejection');
  console.log('[PASS] Test 1: Principal overpayment rejected with 0 journal/cash/loan changes.');

  // --- TEST 2: Reject when repayment > remaining liability ---
  console.log('\n--- TEST 2: Reject repayment > remaining liability ---');
  // Suppose principal is 40,000 (within remaining principal of 50,000), but interest is 20,000.
  // Total repayment = 60,000 > remaining liability (50,000 + scheduled interest ~2,748 = ~52,748).
  const journalCountBefore2 = await db.journalEntries.count();
  let caught2 = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: 'LN-TEST-001',
      sourceAccountId: 'cba-bank-loan-test',
      principalAmount: 40000,
      interestAmount: 20000, // Total 60,000 exceeds liability
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught2 = true;
    console.log('Caught error as expected:', err.message);
    assert(
      err.message.includes('repayment exceeds remaining liability') ||
      err.message.includes('অবশিষ্ট ঋণ দায়ের চেয়ে বেশি'),
      'Must mention repayment exceeds remaining liability'
    );
  }
  assert(caught2, 'Should reject when repayment > remaining liability');

  const journalCountAfter2 = await db.journalEntries.count();
  assert(journalCountBefore2 === journalCountAfter2, 'No journal entry should be created on rejection');
  const loanAfter2 = await db.loans.get('LN-TEST-001');
  assert(loanAfter2?.remainingPrincipal === 50000, 'Loan remaining principal must not change on rejection');
  console.log('[PASS] Test 2: Liability overpayment rejected with 0 journal/cash/loan changes.');

  // --- TEST 3: Reject on 0% interest loan when repayment > remaining liability ---
  console.log('\n--- TEST 3: Reject on 0% interest loan when repayment > remaining liability ---');
  const zeroInterestLoan: Loan = {
    id: 'LN-ZERO-002',
    loanNumber: 'PAY-LN-002',
    lenderName: 'Family Member',
    loanType: 'INDIVIDUAL',
    principalAmount: 20000,
    remainingPrincipal: 20000,
    remainingBalance: 20000,
    annualInterestRatePercent: 0,
    interestRateAnnual: 0,
    termMonths: 6,
    status: 'ACTIVE'
  };
  await db.loans.add(zeroInterestLoan);

  let caught3 = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: 'LN-ZERO-002',
      sourceAccountId: 'cba-bank-loan-test',
      principalAmount: 15000,
      interestAmount: 8000, // Total 23,000 > 20,000 remaining liability
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught3 = true;
    console.log('Caught error on 0% loan:', err.message);
    assert(
      err.message.includes('repayment exceeds remaining liability') ||
      err.message.includes('অবশিষ্ট ঋণ দায়ের চেয়ে বেশি'),
      'Must reject repayment > remaining liability'
    );
  }
  assert(caught3, 'Should reject when repayment > remaining liability on 0% loan');
  console.log('[PASS] Test 3: Zero-interest loan overpayment rejected cleanly.');

  // --- TEST 4: Valid repayment succeeds within limits ---
  console.log('\n--- TEST 4: Valid repayment succeeds within limits ---');
  const validRes = await executeLoanRepaymentTransaction({
    loanId: 'LN-ZERO-002',
    sourceAccountId: 'cba-bank-loan-test',
    principalAmount: 10000,
    interestAmount: 0,
    currentUserId: 'test-user'
  });
  assert(validRes.updatedLoan.remainingPrincipal === 10000, 'Remaining principal must be 10,000');
  assert(validRes.updatedLoan.status === 'ACTIVE', 'Status must still be ACTIVE');
  console.log('[PASS] Test 4: Valid repayment succeeded, remaining principal updated to 10,000.');

  // --- TEST 5: Paying off remaining balance succeeds and transitions to PAID_OFF ---
  console.log('\n--- TEST 5: Paying off remaining balance transitions to PAID_OFF ---');
  const payoffRes = await executeLoanRepaymentTransaction({
    loanId: 'LN-ZERO-002',
    sourceAccountId: 'cba-bank-loan-test',
    principalAmount: 10000,
    interestAmount: 0,
    currentUserId: 'test-user'
  });
  assert(payoffRes.updatedLoan.remainingPrincipal === 0, 'Remaining principal must be 0');
  assert(payoffRes.updatedLoan.status === 'PAID_OFF', 'Status must transition to PAID_OFF');
  console.log('[PASS] Test 5: Paid off loan status is PAID_OFF.');

  // --- TEST 6: Subsequent repayment on PAID_OFF loan is rejected ---
  console.log('\n--- TEST 6: Subsequent repayment on PAID_OFF loan is rejected ---');
  let caught6 = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: 'LN-ZERO-002',
      sourceAccountId: 'cba-bank-loan-test',
      principalAmount: 100,
      interestAmount: 0,
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught6 = true;
    console.log('Caught repayment on PAID_OFF loan:', err.message);
  }
  assert(caught6, 'Must reject repayment on PAID_OFF loan');
  console.log('[PASS] Test 6: Repayment on PAID_OFF loan rejected.');

  console.log('\n====================================================');
  console.log('ALL LOAN OVERPAYMENT VALIDATION TESTS PASSED!');
  console.log('====================================================');
  return { success: true };
}

runLoanOverpaymentValidationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
