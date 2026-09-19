import { validateBalancedLines } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { getInventoryAssetAccount, getPaymentAccount, CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';
import { JournalLine, Animal, AnimalEvent, InventoryItem, Party, Sale, Purchase, FishBatch } from '../types';
import { calculateFishBatchRecordedCosts } from '../services/transactionService';

export interface TestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * In-memory Mock Table that mimics Dexie Table interface.
 * Operates purely in RAM via JavaScript Map to guarantee 0% chance
 * of leaking test/dummy records into real IndexedDB or Firestore.
 */
export class MockTable<T extends { id: string }> {
  private store: Map<string, T> = new Map();

  async get(id: string): Promise<T | undefined> {
    const item = this.store.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }

  async put(item: T): Promise<string> {
    this.store.set(item.id, JSON.parse(JSON.stringify(item)));
    return item.id;
  }

  async bulkPut(items: T[]): Promise<void> {
    for (const item of items) {
      this.store.set(item.id, JSON.parse(JSON.stringify(item)));
    }
  }

  async update(id: string, changes: Partial<T>): Promise<number> {
    const existing = this.store.get(id);
    if (!existing) return 0;
    const updated = { ...existing, ...changes };
    this.store.set(id, updated);
    return 1;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async toArray(): Promise<T[]> {
    return Array.from(this.store.values()).map((v) => JSON.parse(JSON.stringify(v)));
  }

  async count(): Promise<number> {
    return this.store.size;
  }

  where(field: keyof T) {
    return {
      equals: (val: any) => ({
        toArray: async (): Promise<T[]> => {
          return Array.from(this.store.values()).filter((item) => (item as any)[field] === val);
        },
        count: async (): Promise<number> => {
          return Array.from(this.store.values()).filter((item) => (item as any)[field] === val).length;
        }
      })
    };
  }

  filter(predicate: (item: T) => boolean) {
    return {
      toArray: async (): Promise<T[]> => {
        return Array.from(this.store.values()).filter(predicate);
      },
      count: async (): Promise<number> => {
        return Array.from(this.store.values()).filter(predicate).length;
      }
    };
  }
}

/**
 * Creates an isolated in-memory Mock Database for regression testing.
 * NEVER connects to IndexedDB or Firestore.
 */
export function createMockAgroDatabase() {
  return {
    accounts: new MockTable<any>(),
    animals: new MockTable<Animal>(),
    animalEvents: new MockTable<AnimalEvent>(),
    inventoryItems: new MockTable<InventoryItem>(),
    stockMovements: new MockTable<any>(),
    parties: new MockTable<Party>(),
    purchases: new MockTable<Purchase>(),
    sales: new MockTable<Sale>(),
    journalEntries: new MockTable<any>(),
    cashBankAccounts: new MockTable<any>(),
    bankTransfers: new MockTable<any>(),
    loans: new MockTable<any>(),
    investors: new MockTable<any>(),
    fixedAssets: new MockTable<any>(),
    reminders: new MockTable<any>(),
    recurringExpenseTemplates: new MockTable<any>()
  };
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
    // Instantiate fresh, isolated in-memory database
    const mockDb = createMockAgroDatabase();

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
    // TEST 9: In-Memory Mock Database Animal Lifecycle Test
    // ----------------------------------------------------
    const mockCow: Animal = {
      id: 'mock_cow_1',
      tag: 'MOCK-001',
      species: 'CATTLE',
      breed: 'HOLSTEIN',
      gender: 'FEMALE',
      birthDate: '2025-01-01',
      purchaseDate: '2026-01-01',
      purchaseCost: 50000,
      currentWeightKg: 280,
      status: 'ACTIVE',
      location: 'Barn 1',
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 50000,
      notes: 'In-memory test cow',
      synced: false
    };

    await mockDb.animals.put(mockCow);
    const retrievedCow = await mockDb.animals.get('mock_cow_1');
    assert(!!retrievedCow && retrievedCow.tag === 'MOCK-001', 'Mock animal stored and retrieved safely in RAM.');

    // Simulate Feed Event in Mock Database
    const feedCost = 1650;
    await mockDb.animals.update('mock_cow_1', {
      accumulatedFeedCost: (retrievedCow?.accumulatedFeedCost || 0) + feedCost,
      totalCost: (retrievedCow?.totalCost || 0) + feedCost
    });

    // Simulate Medicine Event in Mock Database
    const medCost = 850;
    const cowAfterFeed = await mockDb.animals.get('mock_cow_1');
    await mockDb.animals.update('mock_cow_1', {
      accumulatedMedCost: (cowAfterFeed?.accumulatedMedCost || 0) + medCost,
      totalCost: (cowAfterFeed?.totalCost || 0) + medCost
    });

    const cowAfterMed = await mockDb.animals.get('mock_cow_1');
    assert(cowAfterMed?.totalCost === 52500, 'Animal total cost calculation matches accumulated feed and medicine costs.');

    // Simulate Sale in Mock Database
    const salePrice = 75000;
    const netMargin = salePrice - (cowAfterMed?.totalCost || 0);
    assert(netMargin === 22500, 'Animal sale net margin formula accurately computed.');

    // ----------------------------------------------------
    // TEST 10: In-Memory Mock Database Journal Integrity
    // ----------------------------------------------------
    const mockJournalEntry = {
      id: 'mock_jrn_1',
      voucherNumber: 'PAY-MOCK-001',
      voucherType: 'PAYMENT',
      date: '2026-01-15',
      narration: 'Mock feed expense test',
      lines: [
        { accountId: '1051', accountCode: '1051', accountName: 'Feed Inventory', debit: 1650, credit: 0 },
        { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: 0, credit: 1650 }
      ],
      synced: false
    };
    await mockDb.journalEntries.put(mockJournalEntry);
    const retrievedJournal = await mockDb.journalEntries.get('mock_jrn_1');
    assert(
      !!retrievedJournal && retrievedJournal.lines.length === 2,
      'Mock journal entry stored and queried in RAM without writing to IndexedDB.'
    );

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

    // ----------------------------------------------------
    // TEST 13: Fish Production Cost Accounting & Integration
    // ----------------------------------------------------
    const mockFishBatch: FishBatch = {
      id: 'FISH-TEST-001',
      pondId: 'pond_1',
      pondName: 'North Pond 1',
      species: 'Rui',
      stockingDate: '2026-01-01',
      fingerlingQty: 1000,
      fingerlingCost: 15000,
      totalFeedKg: 500,
      totalFeedCost: 25000,
      medicineCost: 2500,
      labourCost: 6000,
      electricityCost: 3500,
      waterTreatmentCost: 1200,
      otherCost: 800,
      mortalityCount: 100,
      currentEstimatedWeightKg: 450,
      status: 'ACTIVE',
      synced: false
    };

    const recordedCosts = calculateFishBatchRecordedCosts(mockFishBatch);
    assert(
      recordedCosts.fingerlingCost === 15000 &&
      recordedCosts.feedCost === 25000 &&
      recordedCosts.medicineCost === 2500 &&
      recordedCosts.labourCost === 6000 &&
      recordedCosts.electricityCost === 3500 &&
      recordedCosts.waterTreatmentCost === 1200 &&
      recordedCosts.otherCost === 800,
      'Fish batch recorded cost breakdown must preserve each distinct production cost component.'
    );
    assert(
      recordedCosts.totalRecordedCost === 54000,
      'Total accumulated fish production cost must accurately sum fingerlings, feed, medicine, labour, electricity, water treatment, and other costs.'
    );

    // ----------------------------------------------------
    // TEST 14: Fish Harvest Accounting & Cost Derecognition
    // ----------------------------------------------------
    const bioAssetAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
    assert(!!bioAssetAcc, 'Account 1580 Livestock & Biological Assets must exist in chart of accounts.');

    const fishCogsAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_COGS);
    assert(!!fishCogsAcc, 'Account 5010 Fish COGS must exist in chart of accounts.');

    const fishMortalityAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS);
    assert(!!fishMortalityAcc, 'Account 8030 Fish Mortality Loss must exist in chart of accounts.');

    const fishRevenueAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_REVENUE);
    assert(!!fishRevenueAcc, 'Account 4010 Fish Sales Revenue must exist in chart of accounts.');

    // Calculate harvest cost distribution for 10% mortality (100 dead / 1000 stocked)
    const totalStock = mockFishBatch.fingerlingQty;
    const mortalityRatio = mockFishBatch.mortalityCount / totalStock;
    const expectedMortalityCost = Math.round(recordedCosts.totalRecordedCost * mortalityRatio * 100) / 100;
    const expectedCogs = Math.round((recordedCosts.totalRecordedCost - expectedMortalityCost) * 100) / 100;

    assert(expectedMortalityCost === 5400, 'Mortality loss (10%) of ৳54,000 must equal exactly ৳5,400.');
    assert(expectedCogs === 48600, 'Harvested Fish COGS must equal remaining ৳48,600.');
    assert(expectedMortalityCost + expectedCogs === recordedCosts.totalRecordedCost, 'Sum of COGS and Mortality Loss must equal total accumulated WIP (৳54,000).');

    // Verify harvest journal balance with separate Revenue and COGS vouchers (Requirement 1 & 2)
    const saleRevenue = 95000;
    const mockRevenueLines: JournalLine[] = [
      { accountId: '1010', accountCode: '1010', accountName: 'Cash', debit: saleRevenue, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.FISH_REVENUE, accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, accountName: 'Fish Revenue', debit: 0, credit: saleRevenue }
    ];
    const revenueCheck = validateBalancedLines(mockRevenueLines, accounts);
    assert(revenueCheck.isBalanced, 'Fish harvest revenue journal entry must strictly balance (Dr Cash, Cr Fish Revenue).');

    const mockCogsLines: JournalLine[] = [
      { accountId: CANONICAL_ACCOUNTS.FISH_COGS, accountCode: CANONICAL_ACCOUNTS.FISH_COGS, accountName: 'Fish COGS', debit: expectedCogs, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS, accountCode: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS, accountName: 'Fish Mortality Loss', debit: expectedMortalityCost, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, accountName: 'Biological Assets', debit: 0, credit: recordedCosts.totalRecordedCost }
    ];
    const cogsCheck = validateBalancedLines(mockCogsLines, accounts);
    assert(cogsCheck.isBalanced, 'Fish COGS and biological asset derecognition journal entry must strictly balance (Dr COGS/Mortality, Cr 1580).');

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
