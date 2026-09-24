import { generateCashFlowStatement } from '../accounting/accountingEngine';
import { JournalEntry, CashBankAccount, Account } from '../types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runCashFlowAccountingTests(): Promise<{ success: boolean; total: number; passed: number; failed: number; failures: string[] }> {
  const results: TestResult[] = [];

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      results.push({ name, passed: true });
    } else {
      results.push({ name, passed: false, error: detail || 'Assertion failed' });
    }
  }

  const mockAccounts: Account[] = [
    { id: 'acc-1010', code: '1010', nameEn: 'Cash in Hand', nameBn: 'হাতে নগদ', type: 'ASSET', normalBalance: 'DEBIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-1020', code: '1020', nameEn: 'Bank Account - Sonali Bank', nameBn: 'সোনালী ব্যাংক একাউন্ট', type: 'ASSET', normalBalance: 'DEBIT', currentBalance: 0, isSystemAccount: false },
    { id: 'acc-1110', code: '1110', nameEn: 'Accounts Receivable', nameBn: 'প্রাপ্য হিসাব', type: 'ASSET', normalBalance: 'DEBIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-1510', code: '1510', nameEn: 'Farm Equipment', nameBn: 'যন্ত্রপাতি ও সরঞ্জাম', type: 'ASSET', normalBalance: 'DEBIT', currentBalance: 0, isSystemAccount: false },
    { id: 'acc-2010', code: '2010', nameEn: 'Accounts Payable', nameBn: 'প্রদেয় হিসাব', type: 'LIABILITY', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-2050', code: '2050', nameEn: 'Investor Profit Payable', nameBn: 'বিনিয়োগকারীর প্রদেয় মুনাফা', type: 'LIABILITY', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-2110', code: '2110', nameEn: 'Bank Loan', nameBn: 'ব্যাংক ঋণ', type: 'LIABILITY', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: false },
    { id: 'acc-3010', code: '3010', nameEn: 'Owner Capital', nameBn: 'মালিকের মূলধন', type: 'EQUITY', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-3020', code: '3020', nameEn: 'Investor Capital', nameBn: 'বিনিয়োগকারীর মূলধন', type: 'EQUITY', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: true },
    { id: 'acc-4010', code: '4010', nameEn: 'Crop Sales Revenue', nameBn: 'ফসল বিক্রয় আয়', type: 'REVENUE', normalBalance: 'CREDIT', currentBalance: 0, isSystemAccount: false },
    { id: 'acc-5010', code: '5010', nameEn: 'Feed Expenses', nameBn: 'খাদ্য খরচ', type: 'EXPENSE', normalBalance: 'DEBIT', currentBalance: 0, isSystemAccount: false }
  ];

  const mockCashBankAccounts: CashBankAccount[] = [
    { id: 'cb-1', name: 'Cash Register', accountType: 'CASH', balance: 0, code: '1010', isActive: true },
    { id: 'cb-2', name: 'Sonali Bank Ltd.', accountType: 'BANK', balance: 0, code: '1020', isActive: true }
  ];

  // Dated Journal Entries
  // Period to report: 2026-03-01 to 2026-03-31
  const mockEntries: JournalEntry[] = [
    // --- 1. Pre-period transactions (affect opening cash) ---
    // 2026-02-15: Initial owner deposit ৳50,000 in Cash
    {
      id: 'je-pre-1',
      date: '2026-02-15',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-001',
      narration: 'Initial cash capital before period',
      status: 'POSTED',
      lines: [
        { id: 'l1', accountCode: '1010', accountName: 'Cash in Hand', debit: 50000, credit: 0 },
        { id: 'l2', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 50000 }
      ],
      createdAt: '2026-02-15T10:00:00Z'
    },
    // 2026-02-20: Pre-period expense ৳10,000 from Cash
    {
      id: 'je-pre-2',
      date: '2026-02-20',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-001',
      narration: 'Pre-period farm setup expense',
      status: 'POSTED',
      lines: [
        { id: 'l3', accountCode: '5010', accountName: 'Feed Expenses', debit: 10000, credit: 0 },
        { id: 'l4', accountCode: '1010', accountName: 'Cash in Hand', debit: 0, credit: 10000 }
      ],
      createdAt: '2026-02-20T10:00:00Z'
    },

    // --- 2. In-period transactions (2026-03-01 to 2026-03-31) ---

    // A. Operating: Customer Receipt (Dr 1010 Cash, Cr 1110 AR) ৳15,000
    {
      id: 'je-op-1',
      date: '2026-03-02',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-002',
      narration: 'Customer payment received from Rahman Traders',
      status: 'POSTED',
      lines: [
        { id: 'l5', accountCode: '1010', accountName: 'Cash in Hand', debit: 15000, credit: 0 },
        { id: 'l6', accountCode: '1110', accountName: 'Accounts Receivable', debit: 0, credit: 15000 }
      ],
      createdAt: '2026-03-02T11:00:00Z'
    },

    // B. Operating: Direct Cash Sale (Dr 1020 Bank, Cr 4010 Revenue) ৳25,000
    {
      id: 'je-op-2',
      date: '2026-03-04',
      voucherType: 'SALES',
      voucherNumber: 'INV-2026-001',
      narration: 'Vegetable sale paid directly into Sonali Bank',
      status: 'POSTED',
      lines: [
        { id: 'l7', accountCode: '1020', accountName: 'Sonali Bank', debit: 25000, credit: 0 },
        { id: 'l8', accountCode: '4010', accountName: 'Crop Sales Revenue', debit: 0, credit: 25000 }
      ],
      createdAt: '2026-03-04T12:00:00Z'
    },

    // C. Operating: Supplier Payment (Dr 2010 AP, Cr 1010 Cash) ৳10,000
    {
      id: 'je-op-3',
      date: '2026-03-08',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-002',
      narration: 'Payment to seed and fertilizer supplier',
      status: 'POSTED',
      lines: [
        { id: 'l9', accountCode: '2010', accountName: 'Accounts Payable', debit: 10000, credit: 0 },
        { id: 'l10', accountCode: '1010', accountName: 'Cash in Hand', debit: 0, credit: 10000 }
      ],
      createdAt: '2026-03-08T09:00:00Z'
    },

    // D. Operating: Cash Expense (Dr 5010 Feed, Cr 1010 Cash) ৳5,000
    {
      id: 'je-op-4',
      date: '2026-03-10',
      voucherType: 'EXPENSE',
      voucherNumber: 'EXP-2026-001',
      narration: 'Poultry feed purchased in cash',
      status: 'POSTED',
      lines: [
        { id: 'l11', accountCode: '5010', accountName: 'Feed Expenses', debit: 5000, credit: 0 },
        { id: 'l12', accountCode: '1010', accountName: 'Cash in Hand', debit: 0, credit: 5000 }
      ],
      createdAt: '2026-03-10T14:00:00Z'
    },

    // E. Investing: Fixed Asset Purchase (Dr 1510 Equipment, Cr 1020 Bank) ৳20,000
    {
      id: 'je-inv-1',
      date: '2026-03-12',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-003',
      narration: 'Purchased irrigation pump via bank check',
      status: 'POSTED',
      lines: [
        { id: 'l13', accountCode: '1510', accountName: 'Farm Equipment', debit: 20000, credit: 0 },
        { id: 'l14', accountCode: '1020', accountName: 'Sonali Bank', debit: 0, credit: 20000 }
      ],
      createdAt: '2026-03-12T15:00:00Z'
    },

    // F. Investing: Fixed Asset Disposal (Dr 1010 Cash, Cr 1510 Equipment) ৳8,000
    {
      id: 'je-inv-2',
      date: '2026-03-15',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-003',
      narration: 'Sold old sprayer equipment for cash',
      status: 'POSTED',
      lines: [
        { id: 'l15', accountCode: '1010', accountName: 'Cash in Hand', debit: 8000, credit: 0 },
        { id: 'l16', accountCode: '1510', accountName: 'Farm Equipment', debit: 0, credit: 8000 }
      ],
      createdAt: '2026-03-15T16:00:00Z'
    },

    // G. Financing: Investor Capital Contribution (Dr 1010 Cash, Cr 3020 Investor Capital) ৳100,000
    {
      id: 'je-fin-1',
      date: '2026-03-16',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-004',
      narration: 'Investor Tariqul Islam capital contribution (Sleeping Partner)',
      status: 'POSTED',
      lines: [
        { id: 'l17', accountCode: '1010', accountName: 'Cash in Hand', debit: 100000, credit: 0 },
        { id: 'l18', accountCode: '3020', accountName: 'Investor Capital', debit: 0, credit: 100000 }
      ],
      createdAt: '2026-03-16T10:00:00Z'
    },

    // H. Financing: Bank Loan Received (Dr 1020 Bank, Cr 2110 Bank Loan) ৳40,000
    {
      id: 'je-fin-2',
      date: '2026-03-18',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-005',
      narration: 'Agricultural seasonal loan disbursed into bank',
      status: 'POSTED',
      lines: [
        { id: 'l19', accountCode: '1020', accountName: 'Sonali Bank', debit: 40000, credit: 0 },
        { id: 'l20', accountCode: '2110', accountName: 'Bank Loan', debit: 0, credit: 40000 }
      ],
      createdAt: '2026-03-18T11:00:00Z'
    },

    // I. Financing: Investor Profit Payment (Dr 2050 Investor Profit Payable, Cr 1010 Cash) ৳12,000
    {
      id: 'je-fin-3',
      date: '2026-03-22',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-004',
      narration: 'Investor profit distribution paid in cash to Tariqul Islam',
      status: 'POSTED',
      lines: [
        { id: 'l21', accountCode: '2050', accountName: 'Investor Profit Payable', debit: 12000, credit: 0 },
        { id: 'l22', accountCode: '1010', accountName: 'Cash in Hand', debit: 0, credit: 12000 }
      ],
      createdAt: '2026-03-22T12:00:00Z'
    },

    // J. Financing: Investor Capital Return (Dr 3020 Investor Capital, Cr 1020 Bank) ৳25,000
    {
      id: 'je-fin-4',
      date: '2026-03-25',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-005',
      narration: 'Partial investor capital returned to Tariqul Islam',
      status: 'POSTED',
      lines: [
        { id: 'l23', accountCode: '3020', accountName: 'Investor Capital', debit: 25000, credit: 0 },
        { id: 'l24', accountCode: '1020', accountName: 'Sonali Bank', debit: 0, credit: 25000 }
      ],
      createdAt: '2026-03-25T14:00:00Z'
    },

    // K. Financing: Loan Repayment (Dr 2110 Bank Loan, Cr 1020 Bank) ৳15,000
    {
      id: 'je-fin-5',
      date: '2026-03-28',
      voucherType: 'PAYMENT',
      voucherNumber: 'VP-2026-006',
      narration: 'Bank loan monthly installment paid from Sonali Bank',
      status: 'POSTED',
      lines: [
        { id: 'l25', accountCode: '2110', accountName: 'Bank Loan', debit: 15000, credit: 0 },
        { id: 'l26', accountCode: '1020', accountName: 'Sonali Bank', debit: 0, credit: 15000 }
      ],
      createdAt: '2026-03-28T16:00:00Z'
    },

    // L. Internal Cash Transfer (Contra: Cash deposited into Bank) ৳30,000
    // Dr 1020 Bank 30,000 / Cr 1010 Cash 30,000 -> Net cash flow MUST be 0!
    {
      id: 'je-contra-1',
      date: '2026-03-29',
      voucherType: 'CONTRA',
      voucherNumber: 'VCONTRA-001',
      narration: 'Cash deposit from register into Sonali Bank',
      status: 'POSTED',
      lines: [
        { id: 'l27', accountCode: '1020', accountName: 'Sonali Bank', debit: 30000, credit: 0 },
        { id: 'l28', accountCode: '1010', accountName: 'Cash in Hand', debit: 0, credit: 30000 }
      ],
      createdAt: '2026-03-29T11:00:00Z'
    },

    // --- 3. Post-period transaction (after 2026-03-31, must NOT affect period) ---
    {
      id: 'je-post-1',
      date: '2026-04-05',
      voucherType: 'RECEIPT',
      voucherNumber: 'VR-2026-006',
      narration: 'April sales receipt after period',
      status: 'POSTED',
      lines: [
        { id: 'l29', accountCode: '1010', accountName: 'Cash in Hand', debit: 70000, credit: 0 },
        { id: 'l30', accountCode: '4010', accountName: 'Crop Sales Revenue', debit: 0, credit: 70000 }
      ],
      createdAt: '2026-04-05T10:00:00Z'
    }
  ];

  const mockDb = {
    accounts: {
      toArray: async () => mockAccounts
    },
    journalEntries: {
      toArray: async () => mockEntries
    }
  };

  // Execute generateCashFlowStatement for 2026-03-01 to 2026-03-31
  const report = await generateCashFlowStatement(
    { startDate: '2026-03-01', endDate: '2026-03-31' },
    mockDb
  );

  // Verify Opening Cash:
  // Pre-period: Dr 50,000 - Cr 10,000 = 40,000
  assert(report.openingCash === 40000, 'Opening cash correctly calculated from pre-period dated entries (৳40,000)', `Got ${report.openingCash}`);

  // Verify Operating:
  // Customer receipts: +15,000 (AR receipt) + 25,000 (direct sales) = 40,000
  assert(report.operating.customerReceipts === 40000, 'Operating: Customer receipts = ৳40,000', `Got ${report.operating.customerReceipts}`);
  // Supplier payments: 10,000
  assert(report.operating.supplierPayments === 10000, 'Operating: Supplier payments = ৳10,000', `Got ${report.operating.supplierPayments}`);
  // Operating expenses: 5,000
  assert(report.operating.operatingExpenses === 5000, 'Operating: Operating expenses = ৳5,000', `Got ${report.operating.operatingExpenses}`);
  // Net operating flow = 40,000 - 10,000 - 5,000 = +25,000
  assert(report.operating.netOperatingFlow === 25000, 'Operating: Net Operating Cash Flow = +৳25,000', `Got ${report.operating.netOperatingFlow}`);

  // Verify Investing:
  // Asset purchases: 20,000
  assert(report.investing.assetPurchases === 20000, 'Investing: Asset purchases = ৳20,000', `Got ${report.investing.assetPurchases}`);
  // Asset disposal proceeds: 8,000
  assert(report.investing.assetDisposalProceeds === 8000, 'Investing: Asset disposal proceeds = ৳8,000', `Got ${report.investing.assetDisposalProceeds}`);
  // Net investing flow = 8,000 - 20,000 = -12,000
  assert(report.investing.netInvestingFlow === -12000, 'Investing: Net Investing Cash Flow = -৳12,000', `Got ${report.investing.netInvestingFlow}`);

  // Verify Financing:
  // Investor capital: +100,000
  assert(report.financing.investorCapital === 100000, 'Financing: Investor Capital = +৳100,000', `Got ${report.financing.investorCapital}`);
  // Loan proceeds: +40,000
  assert(report.financing.loanProceeds === 40000, 'Financing: Loan proceeds = +৳40,000', `Got ${report.financing.loanProceeds}`);
  // Investor profit payment: 12,000
  assert(report.financing.investorProfitDistributions === 12000, 'Financing: Investor profit payment = ৳12,000', `Got ${report.financing.investorProfitDistributions}`);
  // Investor capital return: 25,000
  assert(report.financing.investorCapitalReturns === 25000, 'Financing: Investor capital return = ৳25,000', `Got ${report.financing.investorCapitalReturns}`);
  // Loan repayment: 15,000
  assert(report.financing.loanRepayments === 15000, 'Financing: Loan repayments = ৳15,000', `Got ${report.financing.loanRepayments}`);
  // Net financing flow = (100,000 + 40,000) - (12,000 + 25,000 + 15,000) = 140,000 - 52,000 = +88,000
  assert(report.financing.netFinancingFlow === 88000, 'Financing: Net Financing Cash Flow = +৳88,000', `Got ${report.financing.netFinancingFlow}`);

  // Net Cash Flow for Period:
  // Net = 25,000 + (-12,000) + 88,000 = +101,000
  assert(report.netCashFlow === 101000, 'Net cash flow = +৳101,000', `Got ${report.netCashFlow}`);

  // Closing Cash = Opening (40,000) + Net (101,000) = 141,000
  assert(report.closingCash === 141000, 'Closing cash = ৳141,000', `Got ${report.closingCash}`);

  // Verification with GL Cash & Bank Accounts as of 2026-03-31:
  // Let's manually compute GL balances as of 2026-03-31:
  // 1010 Cash:
  //  +50,000 (pre) - 10,000 (pre) = 40,000 opening
  //  +15,000 (AR) - 10,000 (AP) - 5,000 (Exp) + 8,000 (Disposal) + 100,000 (Inv Cap) - 12,000 (Inv Profit) - 30,000 (Contra)
  //  1010 net change in period = 15,000 - 10,000 - 5,000 + 8,000 + 100,000 - 12,000 - 30,000 = +66,000
  //  1010 closing balance = 40,000 + 66,000 = 106,000
  //
  // 1020 Bank:
  //  0 opening
  //  +25,000 (Sale) - 20,000 (Asset) + 40,000 (Loan) - 25,000 (Inv Return) - 15,000 (Loan Repay) + 30,000 (Contra)
  //  1020 net change in period = 25,000 - 20,000 + 40,000 - 25,000 - 15,000 + 30,000 = +35,000
  //  1020 closing balance = 35,000
  //
  // Total GL closing cash & bank = 106,000 + 35,000 = 141,000!
  assert(report.glClosingCash === 141000, 'GL Closing Cash reconciles to ৳141,000', `Got ${report.glClosingCash}`);
  assert(report.isReconciled === true, 'Report is 100% reconciled with GL balances', `Discrepancy: ${report.reconciliationDiscrepancy}`);
  assert(report.reconciliationDiscrepancy === 0, 'Reconciliation discrepancy is 0', `Got ${report.reconciliationDiscrepancy}`);

  // Check that post-period April entry (৳70,000) was NOT counted
  assert(report.closingCash === 141000 && report.glClosingCash === 141000, 'Post-period April transaction excluded from report period', `Closing is ${report.closingCash}`);

  // Check accounts breakdown
  const cashAcc = report.accountsBreakdown.find(a => a.code === '1010');
  const bankAcc = report.accountsBreakdown.find(a => a.code === '1020');
  assert(cashAcc?.closingBalance === 106000, 'Cash in Hand (1010) GL closing balance is ৳106,000', `Got ${cashAcc?.closingBalance}`);
  assert(bankAcc?.closingBalance === 35000, 'Bank Account (1020) GL closing balance is ৳35,000', `Got ${bankAcc?.closingBalance}`);

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  const failures = results.filter(r => !r.passed).map(r => `${r.name}: ${r.error}`);

  return {
    success: failedCount === 0,
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    failures
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCashFlowAccountingTests().then((res) => {
    console.log(`Cash flow test: success=${res.success}, passed=${res.passed}/${res.total}`);
    if (!res.success) process.exit(1);
  });
}
