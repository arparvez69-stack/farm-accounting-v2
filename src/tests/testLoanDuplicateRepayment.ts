import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { executeLoanRepaymentTransaction } from '../services/transactionService';
import { generateAmortizationSchedule } from '../accounting/amortizationService';
import { Loan, CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runLoanDuplicateRepaymentTests() {
  console.log('=== STARTING LOAN DUPLICATE REPAYMENT INTEGRITY TESTS ===');

  await db.accounts.clear();
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.put(acc as any);
  }

  // Seed test accounts
  const sourceAcc: CashBankAccount = {
    id: 'cba-bank-dup-test',
    name: 'City Bank Dup Test Account',
    accountName: 'City Bank Dup Test Account',
    accountType: 'BANK',
    accountNumber: '111-222-3333',
    currentBalance: 500000,
    isActive: true
  };
  await db.cashBankAccounts.put(sourceAcc);

  // --- TEST 1: Duplicate Installment Repayment (same installment number) ---
  console.log('\n--- TEST 1: Duplicate Installment Repayment (same installment number) ---');
  const loan1Schedule = generateAmortizationSchedule(12000, 10, 12, '2026-01-01');
  const loan1: Loan = {
    id: 'LN-DUP-001',
    loanNumber: 'LN-DUP-001',
    lenderName: 'Krishi Bank Dup 1',
    loanType: 'BANK',
    principalAmount: 12000,
    annualInterestRatePercent: 10,
    interestRateAnnual: 10,
    tenureMonths: 12,
    termMonths: 12,
    startDate: '2026-01-01',
    disbursedDate: '2026-01-01',
    remainingPrincipal: 12000,
    remainingBalance: 12000,
    totalPaidPrincipal: 0,
    totalPaidInterest: 0,
    status: 'ACTIVE',
    schedule: loan1Schedule
  };
  await db.loans.put(loan1);

  const journalsBefore1 = await db.journalEntries.count();
  const balanceBefore1 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;

  // 1st repayment of installment 1
  const inst1 = loan1Schedule[0];
  await executeLoanRepaymentTransaction({
    loanId: loan1.id,
    sourceAccountId: sourceAcc.id,
    principalAmount: inst1.principalPortion,
    interestAmount: inst1.interestPortion,
    installmentNumber: 1,
    currentUserId: 'test-user'
  });

  const journalsAfter1st = await db.journalEntries.count();
  const balanceAfter1st = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfter1st = (await db.loans.get(loan1.id))!;

  assert(journalsAfter1st === journalsBefore1 + 1, 'Exactly 1 journal entry should be created on first repayment');
  assert(
    Math.abs(balanceBefore1 - balanceAfter1st - inst1.totalPayment) < 0.01,
    'Cash balance should be deducted exactly by first payment amount'
  );
  assert(loanAfter1st.schedule![0].isPaid === true, 'Installment 1 should be marked isPaid: true');

  // Attempt duplicate repayment of installment 1
  let duplicate1Rejected = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan1.id,
      sourceAccountId: sourceAcc.id,
      principalAmount: inst1.principalPortion,
      interestAmount: inst1.interestPortion,
      installmentNumber: 1,
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicate1Rejected = true;
    console.log('Caught expected duplicate rejection:', err.message);
  }

  assert(duplicate1Rejected, 'Duplicate repayment of installment 1 MUST throw an error');

  const journalsAfterDup1 = await db.journalEntries.count();
  const balanceAfterDup1 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfterDup1 = (await db.loans.get(loan1.id))!;

  assert(journalsAfterDup1 === journalsAfter1st, 'Duplicate attempt must create NO second journal entry');
  assert(balanceAfterDup1 === balanceAfter1st, 'Duplicate attempt must create NO second cash movement');
  assert(
    loanAfterDup1.remainingPrincipal === loanAfter1st.remainingPrincipal,
    'Duplicate attempt must create NO second loan reduction'
  );
  console.log('[PASS] Test 1: Duplicate installment repayment blocked with 0 side effects.');

  // --- TEST 2: Duplicate Repayment with Idempotency Key ---
  console.log('\n--- TEST 2: Duplicate Repayment with Idempotency Key ---');
  const loan2: Loan = {
    id: 'LN-DUP-002',
    loanNumber: 'LN-DUP-002',
    lenderName: 'BRAC Bank Dup 2',
    loanType: 'BANK',
    principalAmount: 20000,
    annualInterestRatePercent: 0,
    interestRateAnnual: 0,
    tenureMonths: 6,
    termMonths: 6,
    startDate: '2026-02-01',
    disbursedDate: '2026-02-01',
    remainingPrincipal: 20000,
    remainingBalance: 20000,
    totalPaidPrincipal: 0,
    totalPaidInterest: 0,
    status: 'ACTIVE'
  };
  await db.loans.put(loan2);

  const journalsBefore2 = await db.journalEntries.count();
  const balanceBefore2 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;

  // 1st repayment with idempotency key
  await executeLoanRepaymentTransaction({
    loanId: loan2.id,
    sourceAccountId: sourceAcc.id,
    principalAmount: 5000,
    interestAmount: 0,
    idempotencyKey: 'idemp-ln-002-pay1',
    currentUserId: 'test-user'
  });

  const journalsAfter2nd1 = await db.journalEntries.count();
  const balanceAfter2nd1 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfter2nd1 = (await db.loans.get(loan2.id))!;

  assert(journalsAfter2nd1 === journalsBefore2 + 1, 'Exactly 1 journal entry created on first call');
  assert(balanceBefore2 - balanceAfter2nd1 === 5000, 'Balance reduced by 5,000');
  assert(loanAfter2nd1.remainingPrincipal === 15000, 'Remaining principal reduced to 15,000');

  // Attempt identical duplicate call with same idempotency key
  let duplicate2Rejected = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan2.id,
      sourceAccountId: sourceAcc.id,
      principalAmount: 5000,
      interestAmount: 0,
      idempotencyKey: 'idemp-ln-002-pay1',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicate2Rejected = true;
    console.log('Caught expected idempotency duplicate rejection:', err.message);
  }

  assert(duplicate2Rejected, 'Duplicate with same idempotencyKey MUST throw an error');

  const journalsAfterDup2 = await db.journalEntries.count();
  const balanceAfterDup2 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfterDup2 = (await db.loans.get(loan2.id))!;

  assert(journalsAfterDup2 === journalsAfter2nd1, 'Duplicate idempotency call must create NO second journal entry');
  assert(balanceAfterDup2 === balanceAfter2nd1, 'Duplicate idempotency call must create NO second cash movement');
  assert(
    loanAfterDup2.remainingPrincipal === loanAfter2nd1.remainingPrincipal,
    'Duplicate idempotency call must create NO second loan reduction'
  );
  console.log('[PASS] Test 2: Idempotent duplicate repayment blocked with 0 side effects.');

  // --- TEST 3: Duplicate Repayment with Note / Reference on same date ---
  console.log('\n--- TEST 3: Duplicate Repayment with Note / Reference on same date ---');
  const loan3: Loan = {
    id: 'LN-DUP-003',
    loanNumber: 'LN-DUP-003',
    lenderName: 'Agrani Bank Dup 3',
    loanType: 'BANK',
    principalAmount: 30000,
    annualInterestRatePercent: 0,
    interestRateAnnual: 0,
    tenureMonths: 6,
    termMonths: 6,
    startDate: '2026-03-01',
    disbursedDate: '2026-03-01',
    remainingPrincipal: 30000,
    remainingBalance: 30000,
    totalPaidPrincipal: 0,
    totalPaidInterest: 0,
    status: 'ACTIVE'
  };
  await db.loans.put(loan3);

  const noteUnique = 'Ref-Check-998877';
  await executeLoanRepaymentTransaction({
    loanId: loan3.id,
    sourceAccountId: sourceAcc.id,
    principalAmount: 6000,
    interestAmount: 0,
    note: noteUnique,
    repaymentDate: '2026-03-15',
    currentUserId: 'test-user'
  });

  const journalsAfter3rd1 = await db.journalEntries.count();
  const balanceAfter3rd1 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfter3rd1 = (await db.loans.get(loan3.id))!;

  let duplicate3Rejected = false;
  try {
    await executeLoanRepaymentTransaction({
      loanId: loan3.id,
      sourceAccountId: sourceAcc.id,
      principalAmount: 6000,
      interestAmount: 0,
      note: noteUnique,
      repaymentDate: '2026-03-15',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicate3Rejected = true;
    console.log('Caught expected note duplicate rejection:', err.message);
  }

  assert(duplicate3Rejected, 'Duplicate with same note & date MUST throw an error');

  const journalsAfterDup3 = await db.journalEntries.count();
  const balanceAfterDup3 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfterDup3 = (await db.loans.get(loan3.id))!;

  assert(journalsAfterDup3 === journalsAfter3rd1, 'Duplicate note call must create NO second journal entry');
  assert(balanceAfterDup3 === balanceAfter3rd1, 'Duplicate note call must create NO second cash movement');
  assert(
    loanAfterDup3.remainingPrincipal === loanAfter3rd1.remainingPrincipal,
    'Duplicate note call must create NO second loan reduction'
  );
  console.log('[PASS] Test 3: Same note duplicate repayment blocked with 0 side effects.');

  // --- TEST 4: Concurrent Duplicate Repayment Attempts (double submission) ---
  console.log('\n--- TEST 4: Concurrent Duplicate Repayment Attempts (double submission) ---');
  const loan4Schedule = generateAmortizationSchedule(15000, 8, 12, '2026-04-01');
  const loan4: Loan = {
    id: 'LN-DUP-004',
    loanNumber: 'LN-DUP-004',
    lenderName: 'Sonali Bank Dup 4',
    loanType: 'BANK',
    principalAmount: 15000,
    annualInterestRatePercent: 8,
    interestRateAnnual: 8,
    tenureMonths: 12,
    termMonths: 12,
    startDate: '2026-04-01',
    disbursedDate: '2026-04-01',
    remainingPrincipal: 15000,
    remainingBalance: 15000,
    totalPaidPrincipal: 0,
    totalPaidInterest: 0,
    status: 'ACTIVE',
    schedule: loan4Schedule
  };
  await db.loans.put(loan4);

  const journalsBefore4 = await db.journalEntries.count();
  const balanceBefore4 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;

  // Run 2 identical repayment calls concurrently in parallel
  const [resA, resB] = await Promise.allSettled([
    executeLoanRepaymentTransaction({
      loanId: loan4.id,
      sourceAccountId: sourceAcc.id,
      principalAmount: loan4Schedule[0].principalPortion,
      interestAmount: loan4Schedule[0].interestPortion,
      installmentNumber: 1,
      currentUserId: 'test-user'
    }),
    executeLoanRepaymentTransaction({
      loanId: loan4.id,
      sourceAccountId: sourceAcc.id,
      principalAmount: loan4Schedule[0].principalPortion,
      interestAmount: loan4Schedule[0].interestPortion,
      installmentNumber: 1,
      currentUserId: 'test-user'
    })
  ]);

  const fulfilledCount = (resA.status === 'fulfilled' ? 1 : 0) + (resB.status === 'fulfilled' ? 1 : 0);
  const rejectedCount = (resA.status === 'rejected' ? 1 : 0) + (resB.status === 'rejected' ? 1 : 0);

  assert(fulfilledCount === 1, 'Exactly one concurrent repayment must succeed');
  assert(rejectedCount === 1, 'Exactly one concurrent repayment must be rejected');

  const journalsAfter4 = await db.journalEntries.count();
  const balanceAfter4 = (await db.cashBankAccounts.get(sourceAcc.id))!.currentBalance;
  const loanAfter4 = (await db.loans.get(loan4.id))!;

  assert(journalsAfter4 === journalsBefore4 + 1, 'Concurrent race condition must create ONLY 1 journal entry');
  assert(
    Math.abs(balanceBefore4 - balanceAfter4 - loan4Schedule[0].totalPayment) < 0.01,
    'Concurrent race condition must create ONLY 1 cash reduction'
  );
  assert(
    loanAfter4.schedule![0].isPaid === true && loanAfter4.schedule![1].isPaid === false,
    'Only installment 1 must be marked paid'
  );
  console.log('[PASS] Test 4: Concurrent duplicate repayment caught by active lock.');

  console.log('\n=== ALL LOAN DUPLICATE REPAYMENT INTEGRITY TESTS PASSED! ===');
  return true;
}

runLoanDuplicateRepaymentTests()
  .then(() => {
    console.log('SUCCESS: All duplicate loan repayment tests verified successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAILURE in duplicate loan repayment tests:', err);
    process.exit(1);
  });
