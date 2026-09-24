import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { createSessionToken } from '../../server';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeInventoryItemCreationTransaction,
  executeLoanTransaction,
  executeInvestorTransaction
} from '../services/transactionService';
import { synchronizePendingData } from '../firebase/firebaseClient';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF10ValidateCalculatedFieldsOnNewRecordsTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, description: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`✅ PASS: ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`❌ FAIL: ${description}`);
    }
  }

  console.log('\n========================================================');
  console.log('F10 TEST SUITE: VALIDATE CALCULATED FIELDS ON NEW CLOUD RECORDS');
  console.log('Testing Inventory, Cash/Bank, Investor & Loan Validation');
  console.log('========================================================\n');

  // Setup localStorage polyfill if needed in Node
  if (typeof globalThis.localStorage === 'undefined') {
    const memStore = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => memStore.get(key) || null,
      setItem: (key: string, val: string) => { memStore.set(key, String(val)); },
      removeItem: (key: string) => { memStore.delete(key); },
      clear: () => { memStore.clear(); },
      key: (idx: number) => Array.from(memStore.keys())[idx] || null,
      length: 0
    };
  }

  const serverBaseUrl = `http://localhost:${process.env.PORT || 3000}`;
  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);
  localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken, email: testOwnerEmail }));

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${validSessionToken}`
  };

  const testRunTag = `f10_${Date.now()}`;

  // -------------------------------------------------------------
  // SCENARIO 1: INVENTORY ITEMS (currentStock / avgCostPrice)
  // -------------------------------------------------------------
  console.log('--- SCENARIO 1: Inventory Items Validation ---');

  // 1A. Legitimate: Zero stock catalog item creation
  const zeroStockItemId = `item_zero_${testRunTag}`;
  const resZeroItem = await fetch(`${serverBaseUrl}/api/sync/inventoryItems`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: zeroStockItemId,
      code: `CODE_Z_${testRunTag.slice(-4)}`,
      nameBn: 'পরীক্ষামূলক শূন্য মজুদ পণ্য',
      nameEn: 'Test Zero Stock Item',
      category: 'FEED',
      unit: 'KG',
      currentStock: 0,
      avgCostPrice: 0,
      version: 1
    })
  });
  assert(resZeroItem.status === 200, 'Legitimate new inventory item with zero stock is accepted (HTTP 200)');

  // 1B. Invalid: Arbitrary stock out of thin air (no stock movement, no opening journal)
  const fakeStockItemId = `item_fake_${testRunTag}`;
  const resFakeStock = await fetch(`${serverBaseUrl}/api/sync/inventoryItems`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: fakeStockItemId,
      code: `CODE_F_${testRunTag.slice(-4)}`,
      nameBn: 'ভুয়া মজুদ পণ্য',
      nameEn: 'Fake Stock Item',
      category: 'FEED',
      unit: 'BAG',
      currentStock: 500,
      avgCostPrice: 250,
      version: 1
    })
  });
  assert(resFakeStock.status === 400, 'Reject new inventory item establishing arbitrary calculated stock without movements/journal (HTTP 400)');
  const fakeStockBody = await resFakeStock.json().catch(() => ({}));
  assert(String(fakeStockBody.error || '').includes('সীমাবদ্ধতা'), 'Error message clearly indicates calculated inventory constraint');

  // 1C. Invalid: Negative stock
  const negStockItemId = `item_neg_${testRunTag}`;
  const resNegStock = await fetch(`${serverBaseUrl}/api/sync/inventoryItems`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: negStockItemId,
      code: `CODE_N_${testRunTag.slice(-4)}`,
      nameBn: 'ঋণাত্মক মজুদ পণ্য',
      nameEn: 'Negative Stock Item',
      category: 'FEED',
      unit: 'KG',
      currentStock: -15,
      avgCostPrice: 50,
      version: 1
    })
  });
  assert(resNegStock.status === 400, 'Reject new inventory item with negative stock (HTTP 400)');

  // 1D. Legitimate: Opening stock supported by StockMovement
  const validMovedItemId = `item_moved_${testRunTag}`;
  const moveId = `sm_open_${testRunTag}`;
  // Post supporting stock movement first
  const resMove = await fetch(`${serverBaseUrl}/api/sync/stockMovements`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: moveId,
      itemId: validMovedItemId,
      movementType: 'OPENING',
      quantity: 80,
      unitCost: 150,
      totalCost: 12000,
      date: '2026-09-24',
      version: 1
    })
  });
  assert(resMove.status === 200, 'Supporting stock movement persisted (HTTP 200)');

  // Now post new inventory item matching the stock movement
  const resValidMovedItem = await fetch(`${serverBaseUrl}/api/sync/inventoryItems`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: validMovedItemId,
      code: `CODE_M_${testRunTag.slice(-4)}`,
      nameBn: 'সমর্থিত প্রারম্ভিক মজুদ পণ্য',
      nameEn: 'Movement Supported Item',
      category: 'FEED',
      unit: 'BAG',
      currentStock: 80,
      avgCostPrice: 150,
      version: 1
    })
  });
  assert(resValidMovedItem.status === 200, 'Legitimate new inventory item supported by stock movement is accepted (HTTP 200)');

  // 1E. Invalid: Stock mismatch against movements
  const mismatchMovedItemId = `item_mismatch_${testRunTag}`;
  await fetch(`${serverBaseUrl}/api/sync/stockMovements`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: `sm_mis_${testRunTag}`,
      itemId: mismatchMovedItemId,
      movementType: 'OPENING',
      quantity: 50,
      unitCost: 100,
      totalCost: 5000,
      date: '2026-09-24',
      version: 1
    })
  });
  const resMismatchStock = await fetch(`${serverBaseUrl}/api/sync/inventoryItems`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: mismatchMovedItemId,
      code: `CODE_MIS_${testRunTag.slice(-4)}`,
      nameBn: 'অমিল মজুদ পণ্য',
      nameEn: 'Mismatch Stock Item',
      category: 'FEED',
      unit: 'KG',
      currentStock: 150, // Movement was only 50
      avgCostPrice: 100,
      version: 1
    })
  });
  assert(resMismatchStock.status === 400, 'Reject new inventory item when currentStock does not match supporting movements (HTTP 400)');

  // -------------------------------------------------------------
  // SCENARIO 2: CASH & BANK ACCOUNTS (currentBalance)
  // -------------------------------------------------------------
  console.log('\n--- SCENARIO 2: Cash & Bank Accounts Validation ---');

  // 2A. Legitimate: Zero balance account registration
  const zeroBankId = `cb_zero_${testRunTag}`;
  const resZeroBank = await fetch(`${serverBaseUrl}/api/sync/cashBankAccounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: zeroBankId,
      name: 'Islami Bank Main Account',
      accountType: 'BANK',
      openingBalance: 0,
      currentBalance: 0,
      version: 1
    })
  });
  assert(resZeroBank.status === 200, 'Legitimate zero-balance cash/bank account is accepted (HTTP 200)');

  // 2B. Legitimate: Opening balance explicitly defined and matching currentBalance
  const openBankId = `cb_open_${testRunTag}`;
  const resOpenBank = await fetch(`${serverBaseUrl}/api/sync/cashBankAccounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: openBankId,
      name: 'Dutch Bangla Bank Savings',
      accountType: 'BANK',
      openingBalance: 125000,
      currentBalance: 125000,
      version: 1
    })
  });
  assert(resOpenBank.status === 200, 'Legitimate cash/bank account with initial openingBalance is accepted (HTTP 200)');

  // 2C. Invalid: Arbitrary currentBalance without openingBalance and without journals
  const fakeBankId = `cb_fake_${testRunTag}`;
  const resFakeBank = await fetch(`${serverBaseUrl}/api/sync/cashBankAccounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: fakeBankId,
      name: 'Arbitrary Inflated Bank',
      accountType: 'BANK',
      openingBalance: 0,
      currentBalance: 850000,
      version: 1
    })
  });
  assert(resFakeBank.status === 400, 'Reject new cash/bank account establishing arbitrary currentBalance without opening/journal support (HTTP 400)');

  // 2D. Invalid: Current balance differs from opening balance without journals
  const mismatchBankId = `cb_mis_${testRunTag}`;
  const resMismatchBank = await fetch(`${serverBaseUrl}/api/sync/cashBankAccounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: mismatchBankId,
      name: 'Mismatch Bank Account',
      accountType: 'BANK',
      openingBalance: 50000,
      currentBalance: 150000, // No journal to support the extra 100,000
      version: 1
    })
  });
  assert(resMismatchBank.status === 400, 'Reject new cash/bank account when currentBalance differs from openingBalance without supporting transactions (HTTP 400)');

  // 2E. Legitimate: Opening balance 0, but supported by posted journal entry
  const journalSupportedBankId = `cb_jrnl_${testRunTag}`;
  const bankJournalId = `jv_cb_${testRunTag}`;
  await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: bankJournalId,
      voucherNumber: `JV-CB-${testRunTag.slice(-4)}`,
      date: '2026-09-24',
      lines: [
        { accountId: journalSupportedBankId, accountCode: '1030', debit: 45000, credit: 0, memo: `Deposit into ${journalSupportedBankId}` },
        { accountId: '3050', accountCode: '3050', debit: 0, credit: 45000 }
      ],
      version: 1
    })
  });
  const resJournalBank = await fetch(`${serverBaseUrl}/api/sync/cashBankAccounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: journalSupportedBankId,
      name: 'Journal Funded Account',
      accountType: 'BANK',
      openingBalance: 0,
      currentBalance: 45000,
      version: 1
    })
  });
  assert(resJournalBank.status === 200, 'Legitimate cash/bank account with currentBalance matching supporting journal entries is accepted (HTTP 200)');

  // -------------------------------------------------------------
  // SCENARIO 3: INVESTORS (capital / payable balances)
  // -------------------------------------------------------------
  console.log('\n--- SCENARIO 3: Investors Validation ---');

  // 3A. Legitimate: Registered investor with zero capital & zero payable
  const zeroInvId = `inv_zero_${testRunTag}`;
  const resZeroInv = await fetch(`${serverBaseUrl}/api/sync/investors`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: zeroInvId,
      name: 'Rahim Ullah (Prospective)',
      initialCapital: 0,
      currentCapitalBalance: 0,
      profitPayable: 0,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resZeroInv.status === 200, 'Legitimate new investor with zero capital/payable is accepted (HTTP 200)');

  // 3B. Legitimate: Initial capital contribution matching currentCapitalBalance
  const validInvId = `inv_valid_${testRunTag}`;
  const resValidInv = await fetch(`${serverBaseUrl}/api/sync/investors`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: validInvId,
      name: 'Karim Ahmed',
      initialCapital: 200000,
      currentCapitalBalance: 200000,
      profitPayable: 0,
      totalCapitalReturned: 0,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resValidInv.status === 200, 'Legitimate new investor with matching initialCapital and currentCapitalBalance is accepted (HTTP 200)');

  // 3C. Invalid: Arbitrary capital without initialCapital and without journals
  const fakeCapInvId = `inv_fakecap_${testRunTag}`;
  const resFakeCap = await fetch(`${serverBaseUrl}/api/sync/investors`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: fakeCapInvId,
      name: 'Fake Capital Investor',
      initialCapital: 0,
      currentCapitalBalance: 500000,
      profitPayable: 0,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resFakeCap.status === 400, 'Reject new investor establishing arbitrary capital balance without initialCapital or journals (HTTP 400)');

  // 3D. Invalid: Arbitrary profitPayable out of nowhere (no profit allocation journal)
  const fakePayInvId = `inv_fakepay_${testRunTag}`;
  const resFakePay = await fetch(`${serverBaseUrl}/api/sync/investors`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: fakePayInvId,
      name: 'Fake Payable Investor',
      initialCapital: 100000,
      currentCapitalBalance: 100000,
      profitPayable: 35000, // Arbitrary payable without journal entry
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resFakePay.status === 400, 'Reject new investor establishing arbitrary profitPayable without supporting allocation journal (HTTP 400)');

  // 3E. Legitimate: Profit payable supported by profit allocation journal entry (GL 2050)
  const journalSupportedInvId = `inv_jrnl_${testRunTag}`;
  const invJournalId = `jv_inv_${testRunTag}`;
  await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: invJournalId,
      voucherNumber: `JV-INV-${testRunTag.slice(-4)}`,
      reference: journalSupportedInvId,
      date: '2026-09-24',
      lines: [
        { accountId: '3050', accountCode: '3050', debit: 18000, credit: 0, memo: `Profit allocation for ${journalSupportedInvId}` },
        { accountId: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, debit: 0, credit: 18000, memo: `Profit payable to ${journalSupportedInvId}` }
      ],
      version: 1
    })
  });
  const resJournalInv = await fetch(`${serverBaseUrl}/api/sync/investors`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: journalSupportedInvId,
      name: 'Journal Supported Investor',
      initialCapital: 100000,
      currentCapitalBalance: 100000,
      profitPayable: 18000,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resJournalInv.status === 200, 'Legitimate new investor with profitPayable matching GL 2050 journal allocation is accepted (HTTP 200)');

  // -------------------------------------------------------------
  // SCENARIO 4: LOANS (remaining balances)
  // -------------------------------------------------------------
  console.log('\n--- SCENARIO 4: Loans Validation ---');

  // 4A. Legitimate: Newly disbursed loan with remainingBalance === principalAmount
  const newLoanId = `loan_valid_${testRunTag}`;
  const resValidLoan = await fetch(`${serverBaseUrl}/api/sync/loans`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: newLoanId,
      lenderName: 'Sonali Bank Agro Project',
      principalAmount: 300000,
      remainingBalance: 300000,
      remainingPrincipal: 300000,
      totalPaidPrincipal: 0,
      totalPaidInterest: 0,
      interestRatePercent: 9,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resValidLoan.status === 200, 'Legitimate new loan with remaining balance equal to principal is accepted (HTTP 200)');

  // 4B. Invalid: Remaining balance arbitrarily reduced without repayment transactions
  const fakeBalLoanId = `loan_fakebal_${testRunTag}`;
  const resFakeBalLoan = await fetch(`${serverBaseUrl}/api/sync/loans`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: fakeBalLoanId,
      lenderName: 'Agrani Bank Branch',
      principalAmount: 300000,
      remainingBalance: 120000, // Arbitrarily claimed 180,000 paid with no journal
      totalPaidPrincipal: 180000,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resFakeBalLoan.status === 400, 'Reject new loan establishing reduced remaining balance without supporting repayment entries (HTTP 400)');

  // 4C. Invalid: Remaining balance greater than principal amount
  const excessBalLoanId = `loan_excess_${testRunTag}`;
  const resExcessLoan = await fetch(`${serverBaseUrl}/api/sync/loans`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: excessBalLoanId,
      lenderName: 'Krishi Bank Branch',
      principalAmount: 200000,
      remainingBalance: 275000, // Remaining exceeds principal
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resExcessLoan.status === 400, 'Reject new loan where remaining balance exceeds principal amount (HTTP 400)');

  // 4D. Invalid: Zero or negative principal amount
  const zeroPrinLoanId = `loan_zeroprin_${testRunTag}`;
  const resZeroPrinLoan = await fetch(`${serverBaseUrl}/api/sync/loans`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: zeroPrinLoanId,
      lenderName: 'Invalid Zero Principal Loan',
      principalAmount: 0,
      remainingBalance: 0,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resZeroPrinLoan.status === 400, 'Reject new loan with zero or negative principal (HTTP 400)');

  // 4E. Legitimate: Reduced remaining balance supported by repayment journal entry
  const repaidLoanId = `loan_repaid_${testRunTag}`;
  const loanRepayJournalId = `jv_repay_${testRunTag}`;
  await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: loanRepayJournalId,
      voucherNumber: `JV-LP-${testRunTag.slice(-4)}`,
      reference: repaidLoanId,
      date: '2026-09-24',
      lines: [
        { accountId: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, accountCode: CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, debit: 50000, credit: 0, memo: `Repayment for ${repaidLoanId}` },
        { accountId: '1010', accountCode: '1010', debit: 0, credit: 50000, memo: 'Cash paid' }
      ],
      version: 1
    })
  });
  const resRepaidLoan = await fetch(`${serverBaseUrl}/api/sync/loans`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: repaidLoanId,
      lenderName: 'BRAC Bank Micro-Agro',
      principalAmount: 200000,
      remainingBalance: 150000, // 200000 - 50000 repaid in journal
      totalPaidPrincipal: 50000,
      status: 'ACTIVE',
      version: 1
    })
  });
  assert(resRepaidLoan.status === 200, 'Legitimate new loan with remaining balance matching supporting repayment journal is accepted (HTTP 200)');

  // -------------------------------------------------------------
  // SCENARIO 5: CLIENT DOMAIN TRANSACTIONS SYNC SEAMLESSLY
  // -------------------------------------------------------------
  console.log('\n--- SCENARIO 5: Standard Domain Transactions Sync Successfully ---');

  // Verify that legitimate local creation via transactionService synchronizes cleanly
  // Ensure default accounts and a cash account exist locally for testing
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.put(acc as any);
  }

  await db.cashBankAccounts.put({
    id: 'cash_main_f10',
    name: 'Cash Main Account',
    accountType: 'CASH',
    currentBalance: 500000,
    openingBalance: 500000,
    synced: true
  });

  // A. Inventory item with opening stock created locally
  const localItemResult = await executeInventoryItemCreationTransaction({
    itemData: {
      nameBn: `স্থানীয় পণ্য ${testRunTag.slice(-4)}`,
      nameEn: `Local Item ${testRunTag.slice(-4)}`,
      category: 'FEED',
      unit: 'BAG',
      currentStock: 40,
      avgCostPrice: 65,
      sellingPrice: 85
    },
    currentUserId: 'test-user-f10'
  });
  assert(localItemResult.item !== undefined, 'Local inventory item created with opening stock via domain transaction');

  // B. Loan created locally
  const localLoanResult = await executeLoanTransaction({
    lenderName: `গ্রামীণ ব্যাংক কৃষি ঋণ ${testRunTag.slice(-4)}`,
    principal: 100000,
    interestRate: 8,
    tenureMonths: 12,
    targetAccountId: 'cash_main_f10',
    currentUserId: 'test-user-f10',
    startDate: '2026-09-24',
    loanType: 'BANK'
  });
  assert(localLoanResult.loan !== undefined, 'Local loan created via domain transaction');

  // C. Investor contribution created locally
  const localInvResult = await executeInvestorTransaction({
    investorName: `আনিসুর রহমান ${testRunTag.slice(-4)}`,
    phone: '01711223344',
    contribution: 150000,
    profitSharingRatio: 10,
    targetAccountId: 'cash_main_f10',
    currentUserId: 'test-user-f10',
    date: '2026-09-24'
  });
  assert(localInvResult.investor !== undefined, 'Local investor created via domain transaction');

  // D. Run synchronizePendingData and verify that all legitimate records sync to the cloud
  const syncOutcome = await synchronizePendingData();
  console.log(`Sync outcome: ${syncOutcome.syncedCount} synced, errors: ${syncOutcome.errors.length}`);
  if (syncOutcome.errors.length > 0) {
    console.error('Sync errors:', syncOutcome.errors);
  }
  assert(syncOutcome.errors.length === 0, 'synchronizePendingData completed with zero errors for legitimate records');
  assert(syncOutcome.syncedCount >= 3, 'All legitimate domain records were durably synchronized to the cloud');

  console.log('\n========================================================');
  console.log(`F10 TEST RESULT: ${result.passed}/${result.total} Assertions Passed`);
  console.log('========================================================\n');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testTaskF10ValidateCalculatedFieldsOnNewRecords')) {
  runTaskF10ValidateCalculatedFieldsOnNewRecordsTests()
    .then((res) => {
      process.exit(res.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
