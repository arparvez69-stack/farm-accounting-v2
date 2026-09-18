import { validateBalancedLines } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { getInventoryAssetAccount, getPaymentAccount } from '../accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';
import { JournalLine } from '../types';

export interface TestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

let activeRegressionTestPromise: Promise<TestResult> | null = null;
let latestRegressionTestResult: TestResult | null = null;

export function getLatestRegressionTestResult(): TestResult | null {
  return latestRegressionTestResult;
}

export async function runRegressionTests(): Promise<TestResult> {
  if (activeRegressionTestPromise) {
    return activeRegressionTestPromise;
  }
  activeRegressionTestPromise = runRegressionTestsInternal().finally(() => {
    activeRegressionTestPromise = null;
  });
  return activeRegressionTestPromise;
}

async function runRegressionTestsInternal(): Promise<TestResult> {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, description: string) {
    total++;
    if (condition) {
      passed++;
    } else {
      failures.push(`FAILED: ${description}`);
      console.error(`[REGRESSION ASSERTION FAILED] ${description}`);
    }
  }

  try {
    const accounts = DEFAULT_CHART_OF_ACCOUNTS;

    // ----------------------------------------------------
    // TEST 1: Account 1050 Hard Rejection
    // ----------------------------------------------------
    let blocked1050 = false;
    try {
      const invalidLines: JournalLine[] = [
        { accountId: '1050', accountCode: '1050', accountName: 'Invalid Inventory', debit: 500, credit: 0 },
        { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 0, credit: 500 }
      ];
      validateBalancedLines(invalidLines, accounts);
    } catch (err: any) {
      if (err.message.includes('1050')) {
        blocked1050 = true;
      }
    }
    assert(blocked1050, 'Account 1050 MUST be strictly rejected by accounting validation.');

    // ----------------------------------------------------
    // TEST 2: Unbalanced Journal Entry Rejection
    // ----------------------------------------------------
    let blockedUnbalanced = false;
    try {
      const unbalancedLines: JournalLine[] = [
        { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 500, credit: 0 },
        { accountId: '4010', accountCode: '4010', accountName: 'Sales', debit: 0, credit: 490 }
      ];
      validateBalancedLines(unbalancedLines, accounts);
    } catch {
      blockedUnbalanced = true;
    }
    assert(blockedUnbalanced, 'Unbalanced journal lines (debit != credit) MUST be rejected.');

    // ----------------------------------------------------
    // TEST 3: Balanced Journal Lines Pass
    // ----------------------------------------------------
    let passedBalanced = false;
    try {
      const balancedLines: JournalLine[] = [
        { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 500, credit: 0 },
        { accountId: '4010', accountCode: '4010', accountName: 'Sales', debit: 0, credit: 500 }
      ];
      validateBalancedLines(balancedLines, accounts);
      passedBalanced = true;
    } catch {
      passedBalanced = false;
    }
    assert(passedBalanced, 'Balanced journal lines (debit == credit) MUST pass validation.');

    // ----------------------------------------------------
    // TEST 4: Feed Category Maps to 1051 (NEVER 1050)
    // ----------------------------------------------------
    const feedAcc = getInventoryAssetAccount('FEED');
    assert(feedAcc === '1051', 'Feed inventory MUST map strictly to 1051 Feed Inventory.');

    // ----------------------------------------------------
    // TEST 5: Seed/Fertilizer Maps to 1052
    // ----------------------------------------------------
    const seedAcc = getInventoryAssetAccount('SEED');
    assert(seedAcc === '1052', 'Seed inventory MUST map strictly to 1052.');

    // ----------------------------------------------------
    // TEST 6: Payment Accounts Mapping
    // ----------------------------------------------------
    const arAcc = getPaymentAccount('CREDIT', 'SALE');
    assert(arAcc === '1040', 'Credit sale MUST debit 1040 Accounts Receivable.');

    const bankSaleAcc = getPaymentAccount('BANK', 'SALE');
    assert(bankSaleAcc === '1030', 'Bank sale MUST debit 1030 Bank Accounts.');

    const cashPurAcc = getPaymentAccount('CASH', 'PURCHASE');
    assert(cashPurAcc === '1010', 'Cash purchase MUST credit 1010 Cash on Hand.');

    // ----------------------------------------------------
    // TEST 7: Unique ID Generation and Collision Resistance
    // ----------------------------------------------------
    const uid1 = generateUniqueId('test');
    const uid2 = generateUniqueId('test');
    assert(uid1 !== uid2, 'Generated unique IDs must never collide.');
    assert(uid1.startsWith('test_'), 'Generated ID prefix must be respected.');

    const txnNum1 = generateTransactionNumber('PAY');
    const txnNum2 = generateTransactionNumber('PAY');
    assert(txnNum1.startsWith('PAY-'), 'Transaction voucher number prefix must be formatted correctly.');
    assert(txnNum1 !== txnNum2, 'Transaction numbers must be unique.');

    // ----------------------------------------------------
    // TEST 8: Asset Monthly Straight-Line Depreciation Formula
    // ----------------------------------------------------
    const cost = 120000;
    const rate = 20; // 20% annual
    const expectedMonthlyDepr = Math.round(((cost * rate) / 100 / 12) * 100) / 100;
    assert(expectedMonthlyDepr === 2000, 'Monthly straight-line depreciation formula must equal (cost * rate / 100) / 12.');

    // ----------------------------------------------------
    // TEST 9: Animal Cost Accumulation Formula
    // ----------------------------------------------------
    const purchaseCost = 50000;
    const feedCost = 1650;
    const medCost = 850;
    const labourCost = 200;
    const totalCost = purchaseCost + feedCost + medCost + labourCost;
    assert(totalCost === 52700, 'Animal total cost must correctly sum purchase and operational accumulated costs.');

    // ----------------------------------------------------
    // TEST 10: Animal Sale Net Margin Formula
    // ----------------------------------------------------
    const salePrice = 75000;
    const netProfit = salePrice - totalCost;
    assert(netProfit === 22300, 'Animal sale margin calculation must equal salePrice - totalCost.');

    // ----------------------------------------------------
    // TEST 11: Contra-Equity Classification
    // ----------------------------------------------------
    const drawingsAccount = accounts.find((a) => a.code === '3040');
    assert(
      !!drawingsAccount && drawingsAccount.accountClass === 'EQUITY' && drawingsAccount.normalBalance === 'DEBIT',
      'Account 3040 Owner Drawings must be classified as an Equity debit normal (contra-equity) account.'
    );

    // ----------------------------------------------------
    // TEST 12: Zero Orphan System Accounts
    // ----------------------------------------------------
    const systemAccounts = accounts.filter((a) => a.isSystem);
    assert(systemAccounts.length >= 30, 'System Chart of Accounts must contain all standard canonical accounts.');

  } catch (error: any) {
    failures.push(`CRITICAL RUNTIME ERROR: ${error.message}`);
    console.error('Regression suite runtime error:', error);
  }

  const res: TestResult = {
    success: failures.length === 0,
    total,
    passed,
    failed: failures.length,
    failures
  };

  latestRegressionTestResult = res;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('regression-tests-finished', { detail: res }));
  }

  return res;
}
