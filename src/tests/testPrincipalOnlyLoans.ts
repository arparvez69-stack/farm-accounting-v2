import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { executeLoanTransaction, executeLoanRepaymentTransaction } from '../services/transactionService';
import { CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runPrincipalOnlyLoanTests() {
  console.log('====================================================');
  console.log('STARTING PRINCIPAL-ONLY / NO-INTEREST LOAN REGRESSION TESTS');
  console.log('====================================================');

  await db.delete();
  await db.open();

  // Seed default chart of accounts
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  // Seed Bank Account
  const bankAcc: CashBankAccount = {
    id: 'cba-bank-loan-principal-test',
    name: 'Sonali Bank Loan Account',
    accountName: 'Sonali Bank Loan Account',
    accountNumber: 'SONALI-LOAN-01',
    accountType: 'BANK',
    bankName: 'Sonali Bank',
    currentBalance: 500000,
    isActive: true,
    synced: false
  };
  await db.cashBankAccounts.add(bankAcc);

  // ----------------------------------------------------
  // TEST 1: Principal-Only Loan Creation
  // ----------------------------------------------------
  console.log('\n--- Test 1: Principal-Only Loan Creation ---');
  const disburseRes = await executeLoanTransaction({
    lenderName: 'Bangladesh Krishi Bank',
    principal: 120000,
    interestRate: 0,
    tenureMonths: 12,
    annualInterestRatePercent: 0,
    termMonths: 12,
    startDate: '2026-04-01',
    targetAccountId: bankAcc.id,
    currentUserId: 'usr-a4-test'
  });

  const loan = await db.loans.get(disburseRes.loan.id);
  assert(!!loan, 'Loan record must be created');
  assert(loan!.principalAmount === 120000, 'Principal amount must be 120,000');
  assert(loan!.remainingPrincipal === 120000, 'Remaining principal must equal principal 120,000');
  assert(loan!.remainingBalance === 120000, 'Remaining balance must equal principal 120,000');
  assert(loan!.interestRateAnnual === 0, 'Annual interest rate must be 0%');
  assert(loan!.annualInterestRatePercent === 0, 'Interest rate percent must be 0%');
  assert(loan!.monthlyInstallment === 10000, 'Monthly installment must be 10,000 (120000 / 12)');

  // Verify schedule has 0 interest in every installment
  assert(!!loan!.schedule && loan!.schedule.length === 12, 'Schedule must contain 12 installments');
  for (const item of loan!.schedule!) {
    assert(item.interestPortion === 0, `Installment ${item.installmentNumber} interest portion must be 0`);
    assert(item.principalPortion === 10000, `Installment ${item.installmentNumber} principal portion must be 10,000`);
    assert(item.totalPayment === 10000, `Installment ${item.installmentNumber} total payment must equal principal portion 10,000`);
  }

  // Verify disburse journal entry
  const disburseJournal = await db.journalEntries.get(disburseRes.journalEntryId);
  assert(!!disburseJournal, 'Disbursement journal entry must exist');
  assert(disburseJournal!.lines.length === 2, 'Disbursement journal entry must have exactly 2 lines');
  const disburseDr = disburseJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const disburseCr = disburseJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(disburseDr === disburseCr, 'Disbursement journal debits must equal credits');
  assert(disburseDr === 120000, 'Disbursement debits must be 120,000');
  const hasInterestInDisburse = disburseJournal!.lines.some((l) => l.accountCode === '8010');
  assert(!hasInterestInDisburse, 'No account 8010 in disbursement journal');
  console.log('✅ Test 1 Passed: Principal loan creation recorded principal only with 0% interest schedule.');

  // ----------------------------------------------------
  // TEST 2: Principal Repayment Reduces Principal Only
  // ----------------------------------------------------
  console.log('\n--- Test 2: Principal Repayment Reduces Principal Only ---');
  const balanceBeforeRepay = (await db.cashBankAccounts.get(bankAcc.id))!.currentBalance;

  const repayRes = await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 20000,
    interestAmount: 0,
    installmentNumber: 1,
    repaymentDate: '2026-05-01',
    currentUserId: 'usr-a4-test'
  });

  const updatedLoan = await db.loans.get(loan!.id);
  assert(updatedLoan!.remainingPrincipal === 100000, `Remaining principal must be 100,000, got ${updatedLoan!.remainingPrincipal}`);
  assert(updatedLoan!.remainingBalance === 100000, `Remaining balance must be 100,000, got ${updatedLoan!.remainingBalance}`);
  assert(updatedLoan!.totalPaidPrincipal === 20000, 'Total paid principal must be 20,000');
  assert(!updatedLoan!.totalPaidInterest || updatedLoan!.totalPaidInterest === 0, 'Total paid interest must remain 0');

  const balanceAfterRepay = (await db.cashBankAccounts.get(bankAcc.id))!.currentBalance;
  assert(balanceBeforeRepay - balanceAfterRepay === 20000, 'Bank balance must decrease by exactly 20,000');

  // Verify repayment journal entry: no interest line, no 8010, debits equal credits
  const repayJournal = await db.journalEntries.get(repayRes.journalEntryId);
  assert(!!repayJournal, 'Repayment journal entry must exist');
  assert(repayJournal!.lines.length === 2, 'Repayment journal entry must have exactly 2 lines');

  const has8010 = repayJournal!.lines.some((l) => l.accountCode === '8010');
  assert(!has8010, 'Account 8010 Loan Interest Expense MUST NOT be posted');

  const repayDr = Math.round(repayJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const repayCr = Math.round(repayJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  assert(repayDr === 20000, 'Repayment debits must equal 20,000');
  assert(repayCr === 20000, 'Repayment credits must equal 20,000');
  assert(repayDr === repayCr, 'Repayment debits must equal credits');

  const liabilityLine = repayJournal!.lines.find((l) => l.accountCode === '2110' || l.accountCode === '2120');
  assert(!!liabilityLine, 'Repayment journal must debit loan liability (2110/2120)');
  assert(liabilityLine!.debit === 20000, 'Loan liability debit must be 20,000');

  const bankLine = repayJournal!.lines.find((l) => l.accountCode === '1030');
  assert(!!bankLine, 'Repayment journal must credit bank account (1030)');
  assert(bankLine!.credit === 20000, 'Bank credit must be 20,000');
  console.log('✅ Test 2 Passed: Repayment reduced principal only, no interest line, account 8010 not posted, debits equal credits.');

  // ----------------------------------------------------
  // TEST 3: Repayment with legacy interestAmount parameter
  // ----------------------------------------------------
  console.log('\n--- Test 3: Repayment with legacy interestAmount parameter ---');
  const repay2Res = await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 30000,
    interestAmount: 2500, // Legacy interest parameter passed
    installmentNumber: 2,
    repaymentDate: '2026-06-01',
    currentUserId: 'usr-a4-test'
  });

  const updatedLoan2 = await db.loans.get(loan!.id);
  assert(updatedLoan2!.remainingPrincipal === 70000, `Remaining principal must be 70,000, got ${updatedLoan2!.remainingPrincipal}`);
  assert(updatedLoan2!.remainingBalance === 70000, `Remaining balance must be 70,000, got ${updatedLoan2!.remainingBalance}`);

  const repay2Journal = await db.journalEntries.get(repay2Res.journalEntryId);
  const has8010InRepay2 = repay2Journal!.lines.some((l) => l.accountCode === '8010');
  assert(!has8010InRepay2, 'Account 8010 MUST NOT be posted even if interestAmount is passed');
  const repay2Dr = Math.round(repay2Journal!.lines.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const repay2Cr = Math.round(repay2Journal!.lines.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  assert(repay2Dr === repay2Cr, 'Debits must equal credits in repay2 journal');
  console.log('✅ Test 3 Passed: Legacy interestAmount did not create 8010 posting; debits equal credits.');

  // ----------------------------------------------------
  // TEST 4: Full Payoff Transitions to PAID_OFF
  // ----------------------------------------------------
  console.log('\n--- Test 4: Full Payoff Transitions to PAID_OFF ---');
  await executeLoanRepaymentTransaction({
    loanId: loan!.id,
    sourceAccountId: bankAcc.id,
    principalAmount: 70000,
    interestAmount: 0,
    repaymentDate: '2026-07-01',
    currentUserId: 'usr-a4-test'
  });

  const paidOffLoan = await db.loans.get(loan!.id);
  assert(paidOffLoan!.remainingPrincipal === 0, 'Remaining principal must be 0');
  assert(paidOffLoan!.remainingBalance === 0, 'Remaining balance must be 0');
  assert(paidOffLoan!.status === 'PAID_OFF', 'Loan status must be PAID_OFF');
  console.log('✅ Test 4 Passed: Full payoff transitioned loan to PAID_OFF cleanly.');

  console.log('\n====================================================');
  console.log('ALL PRINCIPAL-ONLY LOAN REGRESSION TESTS PASSED! 🎉');
  console.log('====================================================');
  return { success: true };
}

runPrincipalOnlyLoanTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
