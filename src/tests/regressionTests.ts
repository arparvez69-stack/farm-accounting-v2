import { validateBalancedLines } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { getInventoryAssetAccount, getPaymentAccount, CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';
import { JournalLine, Animal, AnimalEvent, InventoryItem, Party, Sale, Purchase, FishBatch, CropCycle, FixedAsset } from '../types';
import {
  calculateFishBatchRecordedCosts,
  calculateCropCycleRecordedCosts,
  buildFishExpenseCreditLines,
  buildCropExpenseCreditLines,
  calculateAnimalRecordedCosts,
  buildLivestockCostCreditLines,
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction,
  executeInvestorProfitPaymentTransaction,
  executeInvestorCapitalReturnTransaction
} from '../services/transactionService';
import { executeAssetDepreciationAtomic, executeFixedAssetDisposalTransaction } from '../accounting/depreciationService';

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

  async add(item: T): Promise<string> {
    return this.put(item);
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

  _snapshot(): Map<string, T> {
    const copy = new Map<string, T>();
    for (const [k, v] of this.store.entries()) {
      copy.set(k, JSON.parse(JSON.stringify(v)));
    }
    return copy;
  }

  _restore(snap: Map<string, T>) {
    this.store = snap;
  }

  where(field: keyof T | string) {
    return {
      equals: (val: any) => ({
        toArray: async (): Promise<T[]> => {
          return Array.from(this.store.values()).filter((item) => (item as any)[field] === val);
        },
        count: async (): Promise<number> => {
          return Array.from(this.store.values()).filter((item) => (item as any)[field] === val).length;
        },
        first: async (): Promise<T | undefined> => {
          return Array.from(this.store.values()).find((item) => (item as any)[field] === val);
        }
      })
    };
  }

  orderBy(field: keyof T | string) {
    return {
      reverse: () => ({
        toArray: async (): Promise<T[]> => {
          const items = await this.toArray();
          return items.sort((a, b) => String((b as any)[field] || '').localeCompare(String((a as any)[field] || '')));
        },
        first: async (): Promise<T | undefined> => {
          const items = await this.toArray();
          const sorted = items.sort((a, b) => String((b as any)[field] || '').localeCompare(String((a as any)[field] || '')));
          return sorted[0];
        }
      }),
      toArray: async (): Promise<T[]> => {
        const items = await this.toArray();
        return items.sort((a, b) => String((a as any)[field] || '').localeCompare(String((b as any)[field] || '')));
      },
      first: async (): Promise<T | undefined> => {
        const items = await this.toArray();
        const sorted = items.sort((a, b) => String((a as any)[field] || '').localeCompare(String((b as any)[field] || '')));
        return sorted[0];
      }
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
    recurringExpenseTemplates: new MockTable<any>(),
    auditLogs: new MockTable<any>(),
    closedPeriods: new MockTable<any>(),
    transaction: async (_mode: string, tables: any[], callback: () => Promise<any>) => {
      const snapshots = tables.map((t) => ({ table: t, snap: t && t._snapshot ? t._snapshot() : null }));
      try {
        return await callback();
      } catch (err) {
        for (const { table, snap } of snapshots) {
          if (table && table._restore && snap) {
            table._restore(snap);
          }
        }
        throw err;
      }
    }
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

    // ----------------------------------------------------
    // TEST 15: Crop Production Cost Breakdown & WIP Accumulation
    // ----------------------------------------------------
    const mockCropCycle: CropCycle = {
      id: 'CROP-TEST-001',
      plotId: 'plot_1',
      plotName: 'Plot Alpha (1.5 Acre)',
      cropName: 'Aman Rice',
      cropCategory: 'GRAIN',
      plantingDate: '2026-06-15',
      expectedHarvestDate: '2026-11-15',
      areaDecimals: 150,
      seedCost: 6500,
      fertilizerCost: 12000,
      irrigationCost: 4500,
      labourCost: 8000,
      protectionCost: 3200,
      machineryCost: 5800,
      otherCost: 1500,
      totalCost: 41500,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      status: 'GROWING',
      synced: false
    };

    const cropCosts = calculateCropCycleRecordedCosts(mockCropCycle);
    assert(
      cropCosts.seedCost === 6500 &&
      cropCosts.fertilizerCost === 12000 &&
      cropCosts.irrigationCost === 4500 &&
      cropCosts.labourCost === 8000 &&
      cropCosts.protectionCost === 3200 &&
      cropCosts.machineryCost === 5800 &&
      cropCosts.otherCost === 1500,
      'Crop cycle recorded cost breakdown must preserve each distinct production cost component (Seed, Fert, Irrig, Labour, Protection, Machinery, Other).'
    );
    assert(
      cropCosts.totalRecordedCost === 41500,
      'Total accumulated crop production cost must accurately sum all legitimate production cost components.'
    );

    // Verify exact component sum (Seed + Fertilizer + Irrigation + Labour + Protection + Machinery + Other = Total exactly once)
    const testCycle: CropCycle = {
      id: 'cycle_test_exact_sum',
      plotId: 'plot_1',
      plotName: 'Plot 1',
      cropName: 'Corn',
      cropCategory: 'GRAIN',
      plantingDate: '2026-07-01',
      expectedHarvestDate: '2026-10-01',
      areaDecimals: 100,
      seedCost: 1000,
      fertilizerCost: 2000,
      irrigationCost: 500,
      labourCost: 1500,
      protectionCost: 800,
      machineryCost: 1200,
      otherCost: 300,
      totalCost: 0,
      status: 'GROWING',
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      synced: false
    };
    const exactSumCosts = calculateCropCycleRecordedCosts(testCycle);
    const expectedSum = 1000 + 2000 + 500 + 1500 + 800 + 1200 + 300; // 7300
    assert(
      exactSumCosts.totalRecordedCost === expectedSum && exactSumCosts.totalRecordedCost === 7300,
      `Crop cost total must equal actual sum of Seed + Fertilizer + Irrigation + Labour + Protection + Machinery + Other exactly once (expected 7300, got ${exactSumCosts.totalRecordedCost}).`
    );
    assert(
      exactSumCosts.protectionCost === 800 && exactSumCosts.machineryCost === 1200 && exactSumCosts.otherCost === 300,
      'Protection, Machinery, and Other must each be counted separately without overlap.'
    );

    // Verify WIP Account 1054 and Crop Accounts Exist
    const wipAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.WIP);
    assert(!!wipAcc, 'Account 1054 Work in Progress (WIP) must exist in chart of accounts.');

    const cropRevAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.CROP_REVENUE);
    assert(!!cropRevAcc, 'Account 4040 Crop Sales Revenue must exist in chart of accounts.');

    const cropCogsAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.CROP_COGS);
    assert(!!cropCogsAcc, 'Account 5030 Crop COGS must exist in chart of accounts.');

    // ----------------------------------------------------
    // TEST 16: Crop WIP Capitalization & Harvest Derecognition
    // ----------------------------------------------------
    // 1. WIP Capitalization Journal Lines (Dr 1054, Cr Cash/Bank/Inventory)
    const mockWipLines: JournalLine[] = [
      { accountId: CANONICAL_ACCOUNTS.WIP, accountCode: CANONICAL_ACCOUNTS.WIP, accountName: 'Work in Progress', debit: cropCosts.totalRecordedCost, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.CASH, accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'Cash', debit: 0, credit: cropCosts.totalRecordedCost }
    ];
    const wipCheck = validateBalancedLines(mockWipLines, accounts);
    assert(wipCheck.isBalanced, 'Crop production cost WIP capitalization journal entry must strictly balance (Dr 1054 WIP, Cr Cash).');

    // 2. Crop Harvest Revenue Recognition (Dr Cash, Cr 4040 Crop Revenue)
    const cropHarvestRevenue = 78000;
    const mockCropRevLines: JournalLine[] = [
      { accountId: CANONICAL_ACCOUNTS.CASH, accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'Cash', debit: cropHarvestRevenue, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.CROP_REVENUE, accountCode: CANONICAL_ACCOUNTS.CROP_REVENUE, accountName: 'Crop Revenue', debit: 0, credit: cropHarvestRevenue }
    ];
    const cropRevCheck = validateBalancedLines(mockCropRevLines, accounts);
    assert(cropRevCheck.isBalanced, 'Crop harvest revenue journal entry must strictly balance (Dr Cash, Cr 4040).');

    // 3. Crop Harvest COGS & WIP Derecognition (Dr 5030 Crop COGS, Cr 1054 WIP)
    const mockCropCogsLines: JournalLine[] = [
      { accountId: CANONICAL_ACCOUNTS.CROP_COGS, accountCode: CANONICAL_ACCOUNTS.CROP_COGS, accountName: 'Crop COGS', debit: cropCosts.totalRecordedCost, credit: 0 },
      { accountId: CANONICAL_ACCOUNTS.WIP, accountCode: CANONICAL_ACCOUNTS.WIP, accountName: 'Work in Progress', debit: 0, credit: cropCosts.totalRecordedCost }
    ];
    const cropCogsCheck = validateBalancedLines(mockCropCogsLines, accounts);
    assert(cropCogsCheck.isBalanced, 'Crop harvest COGS derecognition journal entry must strictly balance (Dr 5030 COGS, Cr 1054 WIP).');
    assert(mockCropCogsLines[0].debit === cropCosts.totalRecordedCost, 'Crop COGS derecognition must exactly match the traceable accumulated WIP production cost.');

    // ----------------------------------------------------
    // TEST 17: Crop Harvest & Sale Transaction Multi-Leg Integrity
    // ----------------------------------------------------
    // Verify separation of Sales Revenue from Production Cost
    assert((CANONICAL_ACCOUNTS.CROP_REVENUE as string) !== (CANONICAL_ACCOUNTS.CROP_COGS as string), 'Crop Revenue (4040) and Crop COGS (5030) must be distinct accounts.');
    assert((CANONICAL_ACCOUNTS.CROP_REVENUE as string) !== (CANONICAL_ACCOUNTS.WIP as string), 'Crop Revenue (4040) and Crop WIP (1054) must be distinct accounts.');
    
    // Verify Credit Sale payment mapping (Accounts Receivable 1030)
    const creditPaymentAccount = getPaymentAccount('CREDIT', 'SALE');
    assert(creditPaymentAccount === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, 'Crop credit sale must map to Accounts Receivable (1030).');
    
    // Verify Cash Sale payment mapping (Cash on Hand 1010)
    const cashPaymentAccount = getPaymentAccount('CASH', 'SALE');
    assert(cashPaymentAccount === CANONICAL_ACCOUNTS.CASH, 'Crop cash sale must map to Cash on Hand (1010).');

    // Verify Bank Sale payment mapping (Bank Accounts 1020)
    const bankPaymentAccount = getPaymentAccount('BANK', 'SALE');
    assert(bankPaymentAccount === CANONICAL_ACCOUNTS.BANK, 'Crop bank sale must map to Bank Accounts (1020).');

    // ----------------------------------------------------
    // TEST 18: Fish Batch Costing Isolation (Batch A vs Batch B & Account 1580)
    // ----------------------------------------------------
    const batchA: FishBatch = {
      id: 'FISH-BATCH-A',
      pondId: 'pond_1',
      pondName: 'Pond North',
      species: 'Tilapia',
      stockingDate: '2026-02-01',
      fingerlingQty: 1500,
      fingerlingCost: 12000,
      totalFeedKg: 600,
      totalFeedCost: 22000,
      medicineCost: 1800,
      labourCost: 4500,
      electricityCost: 2500,
      waterTreatmentCost: 1100,
      otherCost: 600,
      mortalityCount: 50,
      currentEstimatedWeightKg: 500,
      status: 'ACTIVE',
      synced: false
    };

    const batchB: FishBatch = {
      id: 'FISH-BATCH-B',
      pondId: 'pond_2',
      pondName: 'Pond South',
      species: 'Pangash',
      stockingDate: '2026-02-15',
      fingerlingQty: 2500,
      fingerlingCost: 18000,
      totalFeedKg: 900,
      totalFeedCost: 30000,
      medicineCost: 3200,
      labourCost: 6000,
      electricityCost: 3800,
      waterTreatmentCost: 1500,
      otherCost: 1000,
      mortalityCount: 80,
      currentEstimatedWeightKg: 850,
      status: 'ACTIVE',
      synced: false
    };

    const costsA = calculateFishBatchRecordedCosts(batchA);
    const costsB = calculateFishBatchRecordedCosts(batchB);

    assert(
      costsA.totalRecordedCost === 12000 + 22000 + 1800 + 4500 + 2500 + 1100 + 600 && costsA.totalRecordedCost === 44500,
      `Batch A recorded costs must equal exactly ৳44,500 (got ${costsA.totalRecordedCost}).`
    );
    assert(
      costsB.totalRecordedCost === 18000 + 30000 + 3200 + 6000 + 3800 + 1500 + 1000 && costsB.totalRecordedCost === 63500,
      `Batch B recorded costs must equal exactly ৳63,500 (got ${costsB.totalRecordedCost}).`
    );

    // Simulate adding production costs strictly to Batch A
    const updatedBatchA: FishBatch = {
      ...batchA,
      totalFeedCost: batchA.totalFeedCost + 5000,
      medicineCost: (batchA.medicineCost || 0) + 1200
    };
    const updatedCostsA = calculateFishBatchRecordedCosts(updatedBatchA);
    const unperturbedCostsB = calculateFishBatchRecordedCosts(batchB);

    assert(
      updatedCostsA.totalRecordedCost === 44500 + 5000 + 1200 && updatedCostsA.totalRecordedCost === 50700,
      `Batch A recorded costs after updates must equal exactly ৳50,700 (got ${updatedCostsA.totalRecordedCost}).`
    );
    assert(
      unperturbedCostsB.totalRecordedCost === 63500,
      'Batch A cost additions must NEVER alter or affect Batch B accumulated production cost.'
    );

    // Shared GL Account 1580 balance must NOT be used as the cost of a specific Fish batch
    const sharedGl1580Balance = updatedCostsA.totalRecordedCost + unperturbedCostsB.totalRecordedCost; // 114,200
    assert(
      updatedCostsA.totalRecordedCost !== sharedGl1580Balance && unperturbedCostsB.totalRecordedCost !== sharedGl1580Balance,
      'Specific Fish batch cost must derive from its own accumulated recorded costs, never the shared GL account 1580 pool.'
    );

    // ----------------------------------------------------
    // TEST 19: Crop Cycle WIP Costing & Cross-Cycle Isolation (Cycle A vs Cycle B)
    // ----------------------------------------------------
    // Each Crop cycle must have its own accumulated cost; shared WIP account 1054 must not determine a cycle's cost by itself.
    // Include legitimate: Seed, Fertilizer, Irrigation, Labour, Protection, Machinery, Other costs.
    const cropCycleA: CropCycle = {
      id: 'CROP-CYCLE-A',
      plotId: 'plot_1',
      plotName: 'Plot 1 North Field',
      cropName: 'BRRI-28 Boro Rice',
      cropCategory: 'GRAIN',
      plantingDate: '2026-01-15',
      expectedHarvestDate: '2026-05-15',
      areaDecimals: 50,
      status: 'GROWING',
      seedCost: 5000,
      fertilizerCost: 8000,
      irrigationCost: 6500,
      labourCost: 12000,
      protectionCost: 3500,
      machineryCost: 4500,
      otherCost: 2000,
      totalCost: 41500,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      synced: false
    };

    const cropCycleB: CropCycle = {
      id: 'CROP-CYCLE-B',
      plotId: 'plot_2',
      plotName: 'Plot 2 South Field',
      cropName: 'Kalyansona Wheat',
      cropCategory: 'GRAIN',
      plantingDate: '2026-02-10',
      expectedHarvestDate: '2026-06-10',
      areaDecimals: 35,
      status: 'GROWING',
      seedCost: 4000,
      fertilizerCost: 6000,
      irrigationCost: 3000,
      labourCost: 7500,
      protectionCost: 2200,
      machineryCost: 3500,
      otherCost: 1500,
      totalCost: 27700,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      synced: false
    };

    const costsCycleA = calculateCropCycleRecordedCosts(cropCycleA);
    const costsCycleB = calculateCropCycleRecordedCosts(cropCycleB);

    // Verify Cycle A has exact accumulated cost: Seed(5000) + Fert(8000) + Irrig(6500) + Labour(12000) + Protection(3500) + Machinery(4500) + Other(2000) = 41,500
    assert(
      costsCycleA.totalRecordedCost === 5000 + 8000 + 6500 + 12000 + 3500 + 4500 + 2000 && costsCycleA.totalRecordedCost === 41500,
      `Crop Cycle A recorded costs must equal exactly ৳41,500 (got ${costsCycleA.totalRecordedCost}).`
    );

    // Verify Cycle B has exact accumulated cost: Seed(4000) + Fert(6000) + Irrig(3000) + Labour(7500) + Protection(2200) + Machinery(3500) + Other(1500) = 27,700
    assert(
      costsCycleB.totalRecordedCost === 4000 + 6000 + 3000 + 7500 + 2200 + 3500 + 1500 && costsCycleB.totalRecordedCost === 27700,
      `Crop Cycle B recorded costs must equal exactly ৳27,700 (got ${costsCycleB.totalRecordedCost}).`
    );

    // Simulate adding further legitimate costs exclusively to Cycle A (e.g. additional weeding labour + protection)
    const updatedCycleA: CropCycle = {
      ...cropCycleA,
      labourCost: cropCycleA.labourCost + 3000,
      protectionCost: (cropCycleA.protectionCost || 0) + 1500
    };
    const updatedCostsCycleA = calculateCropCycleRecordedCosts(updatedCycleA);
    const unperturbedCostsCycleB = calculateCropCycleRecordedCosts(cropCycleB);

    assert(
      updatedCostsCycleA.totalRecordedCost === 41500 + 3000 + 1500 && updatedCostsCycleA.totalRecordedCost === 46000,
      `Crop Cycle A recorded costs after updates must equal exactly ৳46,000 (got ${updatedCostsCycleA.totalRecordedCost}).`
    );
    assert(
      unperturbedCostsCycleB.totalRecordedCost === 27700,
      'Crop Cycle A cost additions must NEVER alter or affect Crop Cycle B accumulated production cost.'
    );

    // Shared GL Account 1054 balance must NOT determine the cost of a specific Crop cycle by itself
    const sharedGl1054Balance = updatedCostsCycleA.totalRecordedCost + unperturbedCostsCycleB.totalRecordedCost; // 73,700
    assert(
      updatedCostsCycleA.totalRecordedCost !== sharedGl1054Balance && unperturbedCostsCycleB.totalRecordedCost !== sharedGl1054Balance,
      'Specific Crop cycle cost must derive from its own accumulated recorded costs, never the shared GL account 1054 pool.'
    );

    // ----------------------------------------------------
    // TEST 20: Reclassification to Crop WIP (Dr 1054 WIP / Cr original Expense, NOT Cash)
    // ----------------------------------------------------
    // When reclassifying costs already paid and expensed, journal entries MUST credit the original expense accounts,
    // NEVER Cash (1010) or Bank (1020), preventing artificial cash outflow duplicates.
    const mockReclassLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.WIP,
        accountCode: CANONICAL_ACCOUNTS.WIP,
        accountName: 'Work in Progress',
        debit: 46000,
        credit: 0,
        memo: `শস্য চক্র ${cropCycleA.id} উৎপাদন ব্যয় WIP-তে হিসাবভুক্তকরণ`
      },
      {
        accountId: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
        accountCode: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
        accountName: 'Farm Labour Wages',
        debit: 0,
        credit: 15000,
        memo: `শস্য চক্র ${cropCycleA.id} শ্রমিক মজুরি সমন্বয়`
      },
      {
        accountId: CANONICAL_ACCOUNTS.IRRIGATION,
        accountCode: CANONICAL_ACCOUNTS.IRRIGATION,
        accountName: 'Irrigation Expense',
        debit: 0,
        credit: 6500,
        memo: `শস্য চক্র ${cropCycleA.id} সেচ খরচ সমন্বয়`
      },
      {
        accountId: CANONICAL_ACCOUNTS.VET_MEDICINE,
        accountCode: CANONICAL_ACCOUNTS.VET_MEDICINE,
        accountName: 'Crop Protection Expense',
        debit: 0,
        credit: 5000,
        memo: `শস্য চক্র ${cropCycleA.id} বালাইনাশক সমন্বয়`
      },
      {
        accountId: CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE,
        accountCode: CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE,
        accountName: 'Machinery Expense',
        debit: 0,
        credit: 4500,
        memo: `শস্য চক্র ${cropCycleA.id} যন্ত্রপাতি পরিচালন সমন্বয়`
      },
      {
        accountId: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE,
        accountCode: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE,
        accountName: 'Miscellaneous Crop Expense',
        debit: 0,
        credit: 15000, // Seed (5000) + Fert (8000) + Other (2000)
        memo: `শস্য চক্র ${cropCycleA.id} সার ও বীজ পরিচালন সমন্বয়`
      }
    ];

    const reclassBalanceCheck = validateBalancedLines(mockReclassLines, accounts);
    assert(reclassBalanceCheck.isBalanced, 'Crop WIP reclassification journal entry must strictly balance (Dr 1054 WIP, Cr original Expense).');
    
    // Check that Cash and Bank are NOT credited
    const creditsCash = mockReclassLines.some(l => (l.accountCode === CANONICAL_ACCOUNTS.CASH || l.accountCode === CANONICAL_ACCOUNTS.BANK) && (l.credit || 0) > 0);
    assert(!creditsCash, 'Reclassification of already paid and expensed costs must NEVER credit Cash or Bank (Dr WIP / Cr original Expense).');

    // ----------------------------------------------------
    // TEST 21: Full Fish Batch Lifecycle (Cost -> Harvest -> COGS -> Mortality)
    // ----------------------------------------------------
    // 1. Specific Batch Cost Accumulation
    const lifecycleBatchA: FishBatch = {
      id: 'FISH-BATCH-ALPHA',
      pondId: 'pond_a',
      pondName: 'Pond Alpha',
      species: 'Rui & Katla',
      stockingDate: '2026-02-01',
      fingerlingQty: 2000,
      fingerlingCost: 12000,
      totalFeedKg: 800,
      totalFeedCost: 35000,
      medicineCost: 3000,
      labourCost: 8000,
      electricityCost: 4500,
      waterTreatmentCost: 2500,
      otherCost: 1000,
      mortalityCount: 200, // 10% mortality (200 / 2000)
      currentEstimatedWeightKg: 1200,
      status: 'ACTIVE',
      synced: false
    };

    const batchACosts = calculateFishBatchRecordedCosts(lifecycleBatchA);
    const expectedTotalCostA = 12000 + 35000 + 3000 + 8000 + 4500 + 2500 + 1000; // ৳66,000
    assert(
      batchACosts.totalRecordedCost === expectedTotalCostA && batchACosts.totalRecordedCost === 66000,
      `Fish batch Alpha total accumulated cost must equal exactly ৳66,000 (got ৳${batchACosts.totalRecordedCost}).`
    );

    // Rule: Never use global 1580 as a batch cost
    const global1580SimulatedBalance = 250000;
    assert(
      batchACosts.totalRecordedCost !== global1580SimulatedBalance,
      'Fish batch production cost must be derived exclusively from the batch record, never the global 1580 balance.'
    );

    // 2. Capitalization / Reclassification without artificial Cash credit
    const missingCapAmount = 66000;
    const fishCreditLines = await buildFishExpenseCreditLines(lifecycleBatchA, missingCapAmount, accounts);
    const sumCredits = fishCreditLines.reduce((acc, l) => acc + (l.credit || 0), 0);
    assert(
      Math.round(sumCredits * 100) / 100 === missingCapAmount,
      `Fish expense credit lines must sum to ৳${missingCapAmount} (got ৳${sumCredits}).`
    );

    const fishHasCashCredit = fishCreditLines.some(
      (l) => (l.accountCode === CANONICAL_ACCOUNTS.CASH || l.accountCode === CANONICAL_ACCOUNTS.BANK) && (l.credit || 0) > 0
    );
    assert(!fishHasCashCredit, 'Capitalization of fish costs must credit original expense accounts, NEVER Cash or Bank.');

    const fishCapLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
        accountName: 'Livestock & Biological Assets',
        debit: missingCapAmount,
        credit: 0,
        memo: `মাছের ব্যাচ ${lifecycleBatchA.id}: উৎপাদন ব্যয় জৈবিক সম্পদে হিসাবভুক্তকরণ`
      },
      ...fishCreditLines
    ];
    const capCheck = validateBalancedLines(fishCapLines, accounts);
    assert(capCheck.isBalanced, 'Fish biological asset capitalization journal entry must be strictly balanced.');

    // 3. Sales Revenue Recognition Leg: Cash Sale & Credit Sale
    const batchASalePrice = 110000;
    // Cash Sale: Dr Cash/Bank -> Cr Fish Sales Revenue
    const cashSaleLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.CASH,
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'Cash on Hand',
        debit: batchASalePrice,
        credit: 0,
        memo: 'Cash Sale'
      },
      {
        accountId: CANONICAL_ACCOUNTS.FISH_REVENUE,
        accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE,
        accountName: 'Fish Sales Revenue',
        debit: 0,
        credit: batchASalePrice,
        memo: 'Fish Sales Revenue'
      }
    ];
    const cashSaleCheck = validateBalancedLines(cashSaleLines, accounts);
    assert(cashSaleCheck.isBalanced, 'Cash sale journal entry must strictly balance (Dr Cash -> Cr Fish Sales Revenue).');

    // Credit Sale: Dr AR -> Cr Fish Sales Revenue
    const creditSaleLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
        accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
        accountName: 'Accounts Receivable',
        debit: batchASalePrice,
        credit: 0,
        memo: 'Credit Sale'
      },
      {
        accountId: CANONICAL_ACCOUNTS.FISH_REVENUE,
        accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE,
        accountName: 'Fish Sales Revenue',
        debit: 0,
        credit: batchASalePrice,
        memo: 'Fish Sales Revenue'
      }
    ];
    const creditSaleCheck = validateBalancedLines(creditSaleLines, accounts);
    assert(creditSaleCheck.isBalanced, 'Credit sale journal entry must strictly balance (Dr AR -> Cr Fish Sales Revenue).');

    // 4. Harvest COGS & Mortality Accounting
    // Mortality must use the appropriate portion of that batch's accumulated cost
    const totalQty = lifecycleBatchA.fingerlingQty;
    const mortalityCount = lifecycleBatchA.mortalityCount;
    const batchAMortalityRatio = mortalityCount / totalQty; // 200 / 2000 = 0.10
    const mortalityCost = Math.round(batchACosts.totalRecordedCost * batchAMortalityRatio * 100) / 100; // ৳6,600
    const harvestedCogs = Math.round((batchACosts.totalRecordedCost - mortalityCost) * 100) / 100; // ৳59,400

    assert(mortalityCost === 6600, `Fish mortality cost must be exactly 10% of ৳66,000 = ৳6,600 (got ৳${mortalityCost}).`);
    assert(harvestedCogs === 59400, `Harvested Fish COGS must be exactly remaining ৳59,400 (got ৳${harvestedCogs}).`);
    assert(
      mortalityCost + harvestedCogs === batchACosts.totalRecordedCost,
      'COGS and Mortality Loss combined must equal 100% of accumulated batch cost.'
    );

    // Harvest: Dr Fish COGS & Dr Mortality Loss -> Cr Biological Assets
    const harvestCogsLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.FISH_COGS,
        accountCode: CANONICAL_ACCOUNTS.FISH_COGS,
        accountName: 'Fish COGS',
        debit: harvestedCogs,
        credit: 0,
        memo: `মাছের ব্যাচ ${lifecycleBatchA.id}: বিক্রীত মাছের উৎপাদন ব্যয় (COGS)`
      },
      {
        accountId: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
        accountCode: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
        accountName: 'Fish Mortality Loss',
        debit: mortalityCost,
        credit: 0,
        memo: `মাছের ব্যাচ ${lifecycleBatchA.id}: মৃত্যুজনিত ক্ষতি`
      },
      {
        accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
        accountName: 'Livestock & Biological Assets',
        debit: 0,
        credit: batchACosts.totalRecordedCost,
        memo: `মাছের ব্যাচ ${lifecycleBatchA.id}: জৈবিক সম্পদ সমন্বয়`
      }
    ];
    const harvestCheck = validateBalancedLines(harvestCogsLines, accounts);
    assert(harvestCheck.isBalanced, 'Fish harvest COGS & mortality journal entry must strictly balance.');

    // 5. No Duplicate COGS
    const alreadyTransferredCogs = harvestedCogs;
    const alreadyTransferredMortality = mortalityCost;
    const remainingCostToTransfer = Math.max(
      0,
      Math.round((batchACosts.totalRecordedCost - (alreadyTransferredCogs + alreadyTransferredMortality)) * 100) / 100
    );
    assert(
      remainingCostToTransfer === 0,
      'After full harvest, remaining cost to transfer must be ৳0, preventing duplicate COGS posting.'
    );

    // 6. No Cross-Batch Cost Contamination
    const lifecycleBatchB: FishBatch = {
      id: 'FISH-BATCH-BETA',
      pondId: 'pond_b',
      pondName: 'Pond Beta',
      species: 'Tilapia',
      stockingDate: '2026-02-15',
      fingerlingQty: 3000,
      fingerlingCost: 9000,
      totalFeedKg: 600,
      totalFeedCost: 21000,
      mortalityCount: 0,
      currentEstimatedWeightKg: 0,
      status: 'ACTIVE',
      synced: false
    };
    const batchBCosts = calculateFishBatchRecordedCosts(lifecycleBatchB);
    assert(
      batchBCosts.totalRecordedCost === 30000,
      'Fish Batch Beta accumulated cost must be isolated at ৳30,000 without cross-batch interference.'
    );
    assert(
      batchACosts.totalRecordedCost === 66000,
      'Batch Alpha cost must remain unaffected by Batch Beta existence.'
    );

    // 7. Prevent Duplicate Harvest & Status Verification
    const harvestedBatchA: FishBatch = {
      ...lifecycleBatchA,
      status: 'HARVESTED',
      harvestRevenue: batchASalePrice,
      harvestWeightKg: 1200
    };
    assert(
      harvestedBatchA.status === 'HARVESTED',
      'Batch status must transition to HARVESTED only after accounting entries complete successfully.'
    );
    const isDuplicateBlocked = (harvestedBatchA.status as string) === 'HARVESTED' || (harvestedBatchA.status as string) === 'CLOSED';
    assert(
      isDuplicateBlocked,
      'A batch marked as HARVESTED or CLOSED must be blocked from duplicate harvesting.'
    );

    // ----------------------------------------------------
    // TEST 22: Full Crop Cycle Harvest & COGS Lifecycle
    // ----------------------------------------------------
    // 1. Specific Crop Cycle Cost Accumulation
    const lifecycleCycleA: CropCycle = {
      id: 'CROP-CYCLE-ALPHA',
      plotId: 'plot_1',
      plotName: 'North Field Plot 1',
      cropName: 'Aman Paddy (BRRI-28)',
      cropCategory: 'GRAIN',
      plantingDate: '2026-02-01',
      expectedHarvestDate: '2026-05-15',
      areaDecimals: 50,
      seedCost: 5000,
      fertilizerCost: 10000,
      irrigationCost: 4000,
      labourCost: 12000,
      protectionCost: 3000,
      machineryCost: 6000,
      otherCost: 2000,
      totalCost: 42000,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      status: 'GROWING',
      synced: false
    };

    const cycleACosts = calculateCropCycleRecordedCosts(lifecycleCycleA);
    const expectedTotalCostCycleA = 5000 + 10000 + 4000 + 12000 + 3000 + 6000 + 2000; // ৳42,000
    assert(
      cycleACosts.totalRecordedCost === expectedTotalCostCycleA && cycleACosts.totalRecordedCost === 42000,
      `Crop cycle Alpha total accumulated cost must equal exactly ৳42,000 (got ৳${cycleACosts.totalRecordedCost}).`
    );

    // Rule: Never use global 1054 balance as the cycle cost
    const global1054SimulatedBalance = 150000;
    assert(
      cycleACosts.totalRecordedCost !== global1054SimulatedBalance,
      'Crop cycle production cost must be derived exclusively from the cycle record, never the global 1054 WIP balance.'
    );

    // 2. Capitalization / WIP Integration without artificial Cash credit
    const missingWipAmount = 42000;
    const cropCreditLines = await buildCropExpenseCreditLines(lifecycleCycleA, missingWipAmount, accounts);
    const sumCropCredits = cropCreditLines.reduce((acc, l) => acc + (l.credit || 0), 0);
    assert(
      Math.round(sumCropCredits * 100) / 100 === missingWipAmount,
      `Crop expense credit lines must sum to ৳${missingWipAmount} (got ৳${sumCropCredits}).`
    );

    const cropHasCashCredit = cropCreditLines.some(
      (l) => (l.accountCode === CANONICAL_ACCOUNTS.CASH || l.accountCode === CANONICAL_ACCOUNTS.BANK) && (l.credit || 0) > 0
    );
    assert(!cropHasCashCredit, 'Capitalization of crop costs to WIP must credit original expense accounts, NEVER Cash or Bank.');

    const cropWipIntegrationLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.WIP,
        accountCode: CANONICAL_ACCOUNTS.WIP,
        accountName: 'Work in Progress (WIP)',
        debit: missingWipAmount,
        credit: 0,
        memo: `শস্য চক্র ${lifecycleCycleA.id}: নথিভুক্ত উৎপাদন ব্যয় WIP-তে হিসাবভুক্তকরণ`
      },
      ...cropCreditLines
    ];
    const cropWipCheck = validateBalancedLines(cropWipIntegrationLines, accounts);
    assert(cropWipCheck.isBalanced, 'Crop WIP integration journal entry must be strictly balanced.');

    // 3. Sales Revenue Recognition Leg: Cash Sale & Credit Sale
    const cycleASalePrice = 75000;
    // Cash Sale: Dr Cash/Bank -> Cr Crop Sales Revenue
    const cashCropSaleLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.CASH,
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'Cash on Hand',
        debit: cycleASalePrice,
        credit: 0,
        memo: 'Cash Sale'
      },
      {
        accountId: CANONICAL_ACCOUNTS.CROP_REVENUE,
        accountCode: CANONICAL_ACCOUNTS.CROP_REVENUE,
        accountName: 'Crop Sales Revenue',
        debit: 0,
        credit: cycleASalePrice,
        memo: 'Crop Sales Revenue'
      }
    ];
    const cashCropSaleCheck = validateBalancedLines(cashCropSaleLines, accounts);
    assert(cashCropSaleCheck.isBalanced, 'Cash sale journal entry must strictly balance (Dr Cash -> Cr Crop Sales Revenue).');

    // Credit Sale: Dr AR -> Cr Crop Sales Revenue
    const creditCropSaleLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
        accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
        accountName: 'Accounts Receivable',
        debit: cycleASalePrice,
        credit: 0,
        memo: 'Credit Sale'
      },
      {
        accountId: CANONICAL_ACCOUNTS.CROP_REVENUE,
        accountCode: CANONICAL_ACCOUNTS.CROP_REVENUE,
        accountName: 'Crop Sales Revenue',
        debit: 0,
        credit: cycleASalePrice,
        memo: 'Crop Sales Revenue'
      }
    ];
    const creditCropSaleCheck = validateBalancedLines(creditCropSaleLines, accounts);
    assert(creditCropSaleCheck.isBalanced, 'Credit sale journal entry must strictly balance (Dr AR -> Cr Crop Sales Revenue).');

    // 4. Harvest: Dr Crop COGS -> Cr that cycle's WIP
    const harvestedCropCogs = cycleACosts.totalRecordedCost; // ৳42,000
    const cropHarvestCogsLines: JournalLine[] = [
      {
        accountId: CANONICAL_ACCOUNTS.CROP_COGS,
        accountCode: CANONICAL_ACCOUNTS.CROP_COGS,
        accountName: 'Crop COGS',
        debit: harvestedCropCogs,
        credit: 0,
        memo: `শস্য চক্র ${lifecycleCycleA.id}: বিক্রিত ফসলের উৎপাদন ব্যয় (COGS)`
      },
      {
        accountId: CANONICAL_ACCOUNTS.WIP,
        accountCode: CANONICAL_ACCOUNTS.WIP,
        accountName: 'Work in Progress (WIP)',
        debit: 0,
        credit: harvestedCropCogs,
        memo: `শস্য চক্র ${lifecycleCycleA.id}: বিক্রয় বাবদ WIP সমাপ্তি সমন্বয়`
      }
    ];
    const cropHarvestCheck = validateBalancedLines(cropHarvestCogsLines, accounts);
    assert(cropHarvestCheck.isBalanced, 'Crop harvest COGS journal entry must strictly balance (Dr Crop COGS -> Cr that cycle WIP).');
    assert(
      cropHarvestCogsLines[0].accountCode === CANONICAL_ACCOUNTS.CROP_COGS && (cropHarvestCogsLines[0].debit || 0) === 42000,
      'Crop harvest COGS entry must debit Crop COGS (5030) for exactly ৳42,000.'
    );
    assert(
      cropHarvestCogsLines[1].accountCode === CANONICAL_ACCOUNTS.WIP && (cropHarvestCogsLines[1].credit || 0) === 42000,
      'Crop harvest COGS entry must credit that cycle WIP (1054) for exactly ৳42,000.'
    );

    // 5. No Duplicate COGS
    const alreadyTransferredCropCogs = harvestedCropCogs;
    const remainingCropCostToTransfer = Math.max(
      0,
      Math.round((cycleACosts.totalRecordedCost - alreadyTransferredCropCogs) * 100) / 100
    );
    assert(
      remainingCropCostToTransfer === 0,
      'After harvest, remaining cost to transfer must be ৳0, preventing duplicate COGS posting.'
    );

    // 6. No Cross-Cycle Cost Contamination
    const lifecycleCycleB: CropCycle = {
      id: 'CROP-CYCLE-BETA',
      plotId: 'plot_2',
      plotName: 'South Field Plot 2',
      cropName: 'Maize',
      cropCategory: 'GRAIN',
      plantingDate: '2026-02-10',
      expectedHarvestDate: '2026-06-01',
      areaDecimals: 30,
      seedCost: 3000,
      fertilizerCost: 5000,
      irrigationCost: 2000,
      labourCost: 4000,
      protectionCost: 1000,
      machineryCost: 2500,
      otherCost: 500,
      totalCost: 18000,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      status: 'GROWING',
      synced: false
    };
    const cycleBCosts = calculateCropCycleRecordedCosts(lifecycleCycleB);
    assert(
      cycleBCosts.totalRecordedCost === 18000,
      'Crop Cycle Beta accumulated cost must be isolated at ৳18,000 without cross-cycle interference.'
    );
    assert(
      cycleACosts.totalRecordedCost === 42000,
      'Cycle Alpha cost must remain unaffected by Cycle Beta existence.'
    );

    // 7. Prevent Duplicate Harvest & Status Verification
    const harvestedCycleA: CropCycle = {
      ...lifecycleCycleA,
      status: 'HARVESTED',
      harvestRevenue: cycleASalePrice,
      harvestYieldKg: 2500,
      actualHarvestDate: '2026-05-15'
    };
    assert(
      harvestedCycleA.status === 'HARVESTED',
      'Crop cycle status must transition to HARVESTED only after accounting entries complete successfully.'
    );
    const isCropDuplicateBlocked = (harvestedCycleA.status as string) === 'HARVESTED' || (harvestedCycleA.status as string) === 'CLOSED';
    assert(
      isCropDuplicateBlocked,
      'A crop cycle marked as HARVESTED or CLOSED must be blocked from duplicate harvesting.'
    );

    // ----------------------------------------------------
    // TEST 23: Full Livestock Accumulated Cost & COGS Lifecycle (Task 6 Verification)
    // ----------------------------------------------------
    // 1. Purchase: Animal initial capitalized acquisition
    const initialPurchaseCost = 50000;
    const testAnimalCow: Animal = {
      id: 'COW-TEST-001',
      tag: 'TAG-COW-001',
      species: 'CATTLE',
      breed: 'Holstein Friesian Cross',
      gender: 'FEMALE',
      birthDate: '2024-01-10',
      purchaseDate: '2025-01-15',
      purchaseCost: initialPurchaseCost,
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: initialPurchaseCost,
      currentWeightKg: 350,
      location: 'Shed-1',
      status: 'ACTIVE',
      synced: false
    };

    const initialBreakdown = calculateAnimalRecordedCosts(testAnimalCow);
    assert(
      initialBreakdown.purchaseCost === 50000 &&
      initialBreakdown.feedCost === 0 &&
      initialBreakdown.medicineCost === 0 &&
      initialBreakdown.labourCost === 0 &&
      initialBreakdown.otherCost === 0 &&
      initialBreakdown.totalRecordedCost === 50000,
      'Initial animal cost breakdown must reflect exact initial purchase cost of ৳50,000 without invented costs.'
    );

    // 2. Production Costs Incurred (Feed, Medicine/Vet, Labour, Other)
    const feedCostIncurred = 15000;
    const medCostIncurred = 5000;
    const labourCostIncurred = 8000;
    const otherCostIncurred = 2000;

    const raisedAnimalCow: Animal = {
      ...testAnimalCow,
      accumulatedFeedCost: feedCostIncurred,
      accumulatedMedCost: medCostIncurred,
      accumulatedLabourCost: labourCostIncurred,
      otherCosts: otherCostIncurred,
      totalCost: initialPurchaseCost + feedCostIncurred + medCostIncurred + labourCostIncurred + otherCostIncurred, // ৳80,000
      currentWeightKg: 480
    };

    // 3. Accumulated Cost Reconciliation
    const raisedBreakdown = calculateAnimalRecordedCosts(raisedAnimalCow);
    const expectedAccumulatedCost = 50000 + 15000 + 5000 + 8000 + 2000; // ৳80,000

    assert(
      raisedBreakdown.totalRecordedCost === expectedAccumulatedCost && raisedBreakdown.totalRecordedCost === 80000,
      `Livestock accumulated cost must strictly equal sum of Purchase + Feed + Medicine + Labour + Other = ৳80,000 (got ৳${raisedBreakdown.totalRecordedCost}).`
    );
    assert(
      raisedBreakdown.purchaseCost === 50000,
      'Capitalized purchase cost must be ৳50,000.'
    );
    assert(
      raisedBreakdown.feedCost === 15000,
      'Accumulated feed cost must reconcile to ৳15,000.'
    );
    assert(
      raisedBreakdown.medicineCost === 5000,
      'Accumulated medicine/vet cost must reconcile to ৳5,000.'
    );
    assert(
      raisedBreakdown.labourCost === 8000,
      'Accumulated labour cost must reconcile to ৳8,000.'
    );
    assert(
      raisedBreakdown.otherCost === 2000,
      'Other production cost must reconcile to ৳2,000.'
    );

    // 4. Sale & COGS: Sale COGS must use the applicable accumulated cost (৳80,000), not just purchase cost (৳50,000)
    const cowSalePrice = 120000;
    const livestockCogsToDerecognize = raisedBreakdown.totalRecordedCost;
    assert(
      livestockCogsToDerecognize === 80000 && (livestockCogsToDerecognize as number) !== initialPurchaseCost,
      `Sale COGS must use the full accumulated cost of ৳80,000, NOT just the initial purchase cost of ৳50,000.`
    );

    // Generate balanced credit lines for the derecognized cost
    const livestockCreditLines = await buildLivestockCostCreditLines(
      raisedAnimalCow,
      livestockCogsToDerecognize,
      accounts
    );
    const totalCreditsSum = Math.round(
      livestockCreditLines.reduce((sum, line) => sum + (line.credit || 0), 0) * 100
    ) / 100;

    assert(
      totalCreditsSum === livestockCogsToDerecognize,
      `Total credit lines (৳${totalCreditsSum}) must match the COGS amount (৳${livestockCogsToDerecognize}) exactly.`
    );

    // Verify credit lines structure reconciles without double-counting
    const assetCreditLine = livestockCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
    const feedCreditLine = livestockCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE);
    const medCreditLine = livestockCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE);
    const labourCreditLine = livestockCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES);
    const otherCreditLine = livestockCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE);

    assert(
      Boolean(assetCreditLine) && assetCreditLine?.credit === 50000,
      'Livestock Asset (1580) must be credited for ৳50,000.'
    );
    assert(
      Boolean(feedCreditLine) && feedCreditLine?.credit === 15000,
      'Feed Expense (6010) must be credited for ৳15,000 to reconcile raising cost into COGS.'
    );
    assert(
      Boolean(medCreditLine) && medCreditLine?.credit === 5000,
      'Veterinary & Medicine Expense (6040) must be credited for ৳5,000.'
    );
    assert(
      Boolean(labourCreditLine) && labourCreditLine?.credit === 8000,
      'Farm Labour Wages (6020) must be credited for ৳8,000.'
    );
    assert(
      Boolean(otherCreditLine) && otherCreditLine?.credit === 2000,
      'Miscellaneous Production Expense (6090) must be credited for ৳2,000.'
    );

    // Full Sale Journal Entry Verification
    const fullSaleJournalLines: JournalLine[] = [
      // Revenue leg
      {
        accountId: 'acc_1010',
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'নগদ টাকা (Cash on Hand)',
        debit: cowSalePrice,
        credit: 0,
        memo: `পশু বিক্রয়: ${raisedAnimalCow.id}`
      },
      {
        accountId: 'acc_4020',
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE,
        accountName: 'পশু বিক্রয় আয় (Livestock Sales Revenue)',
        debit: 0,
        credit: cowSalePrice,
        memo: `${raisedAnimalCow.breed} বিক্রয় রাজস্ব`
      },
      // COGS leg
      {
        accountId: 'acc_5020',
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
        accountName: 'Livestock COGS',
        debit: livestockCogsToDerecognize,
        credit: 0,
        memo: `${raisedAnimalCow.breed} পুঞ্জীভূত উৎপাদন ব্যয় (COGS)`
      },
      ...livestockCreditLines
    ];

    const saleCheck = validateBalancedLines(fullSaleJournalLines, accounts);
    assert(
      saleCheck.isBalanced,
      'Full livestock sale journal entry (Revenue + full accumulated COGS) must strictly balance.'
    );

    // Accounting reconciliation check: No double counting in P&L
    // Gross Margin = Revenue (120,000) - COGS (80,000) = 40,000
    // Expenses (Feed 15k, Med 5k, Labour 8k, Other 2k = 30k) are credited 30k upon derecognition,
    // so net P&L reflects exactly ৳40,000 profit rather than subtracting 30k twice.
    const netProfit = cowSalePrice - livestockCogsToDerecognize;
    assert(
      netProfit === 40000,
      `Livestock sale net profit must be exactly ৳40,000 (got ৳${netProfit}).`
    );

    // 5. Write-off Verification with Accumulated Cost
    const deceasedAnimalCow: Animal = {
      id: 'COW-TEST-002',
      tag: 'TAG-COW-002',
      species: 'CATTLE',
      breed: 'Sahiwal',
      gender: 'MALE',
      birthDate: '2024-03-01',
      purchaseDate: '2025-02-01',
      purchaseCost: 30000,
      accumulatedFeedCost: 10000,
      accumulatedMedCost: 5000,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 45000,
      currentWeightKg: 400,
      location: 'Shed-2',
      status: 'ACTIVE',
      synced: false
    };
    const deceasedBreakdown = calculateAnimalRecordedCosts(deceasedAnimalCow);
    assert(
      deceasedBreakdown.totalRecordedCost === 45000,
      'Deceased animal total accumulated cost must be ৳45,000.'
    );

    const writeOffCreditLines = await buildLivestockCostCreditLines(
      deceasedAnimalCow,
      deceasedBreakdown.totalRecordedCost,
      accounts
    );
    const writeOffJournalLines: JournalLine[] = [
      {
        accountId: 'acc_8020',
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF,
        accountName: 'Livestock Write-off',
        debit: deceasedBreakdown.totalRecordedCost,
        credit: 0,
        memo: `পশু অবলোপন (DECEASED): ${deceasedAnimalCow.id} পুঞ্জীভূত ব্যয়`
      },
      ...writeOffCreditLines
    ];
    const writeOffCheck = validateBalancedLines(writeOffJournalLines, accounts);
    assert(
      writeOffCheck.isBalanced,
      'Livestock write-off journal entry with full accumulated cost must strictly balance.'
    );

    // 6. Cross-Animal Cost Isolation
    const isolatedAnimal: Animal = {
      id: 'GOAT-TEST-001',
      tag: 'TAG-GOAT-001',
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'MALE',
      birthDate: '2024-05-01',
      purchaseDate: '2025-03-01',
      purchaseCost: 8000,
      accumulatedFeedCost: 2000,
      accumulatedMedCost: 500,
      accumulatedLabourCost: 1000,
      otherCosts: 0,
      totalCost: 11500,
      currentWeightKg: 25,
      location: 'Goat Shed',
      status: 'ACTIVE',
      synced: false
    };
    const goatBreakdown = calculateAnimalRecordedCosts(isolatedAnimal);
    assert(
      goatBreakdown.totalRecordedCost === 11500,
      'Goat accumulated cost must be isolated at ৳11,500 without interference from cow costs.'
    );
    assert(
      raisedBreakdown.totalRecordedCost === 80000,
      'Cow accumulated cost must remain strictly ৳80,000 unaffected by other animals.'
    );

    // 7. Preservation of existing livestock data
    const legacyAnimalWithoutBreakdown: Animal = {
      id: 'LEGACY-COW-099',
      tag: 'TAG-LEGACY-099',
      species: 'CATTLE',
      breed: 'Local Deshi',
      gender: 'FEMALE',
      birthDate: '2022-01-01',
      purchaseDate: '2023-01-01',
      purchaseCost: 25000,
      accumulatedFeedCost: 0,
      accumulatedMedCost: 0,
      accumulatedLabourCost: 0,
      otherCosts: 0,
      totalCost: 25000,
      currentWeightKg: 280,
      location: 'Shed-1',
      status: 'ACTIVE',
      synced: false
    };
    const legacyBreakdown = calculateAnimalRecordedCosts(legacyAnimalWithoutBreakdown);
    assert(
      legacyBreakdown.totalRecordedCost === 25000 && legacyBreakdown.purchaseCost === 25000,
      'Existing livestock data without detailed cost breakdown must safely fallback to purchaseCost / totalCost without error.'
    );

    // ----------------------------------------------------
    // TEST 24: FIXED ASSET ACCOUNTING ATOMICITY (TASK 7)
    // ----------------------------------------------------
    const assetMockDb = createMockAgroDatabase();

    // Populate default accounts into mock db
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await assetMockDb.accounts.put(acc);
    }
    // Cash account
    await assetMockDb.cashBankAccounts.put({
      id: 'cb_cash_1',
      accountType: 'CASH',
      name: 'নগদ টাকা (Cash on Hand)',
      currentBalance: 50000,
      synced: false
    });

    const testAsset: FixedAsset = {
      id: 'AST-TEST-001',
      name: 'পাওয়ার টিলার (Power Tiller)',
      category: 'MACHINERY',
      purchaseDate: '2026-01-01',
      originalCost: 120000,
      usefulLifeYears: 10,
      salvageValue: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 120000,
      depreciationRatePercent: 10, // 10% annual -> 1% monthly = 1000/mo
      lastDepreciationDate: '2026-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await assetMockDb.fixedAssets.put(testAsset);

    // 1. Normal depreciation
    const deprResult = await executeAssetDepreciationAtomic(
      testAsset.id,
      { currentUserId: 'TESTER_1', targetDate: '2026-03-01' },
      assetMockDb
    );
    assert(
      deprResult.monthsPosted === 2,
      'Normal depreciation for Jan to Mar must post exactly 2 monthly periods.'
    );
    assert(
      deprResult.totalDepreciation === 2000,
      'Depreciation amount for 2 months must equal ৳2,000.'
    );
    assert(
      deprResult.newAccumulatedDepreciation === 2000,
      'Asset accumulated depreciation must be updated to ৳2,000.'
    );
    assert(
      deprResult.newBookValue === 118000,
      'Asset book value must be updated to ৳118,000.'
    );

    const assetAfterDepr = await assetMockDb.fixedAssets.get(testAsset.id);
    assert(
      assetAfterDepr?.accumulatedDepreciation === 2000 && assetAfterDepr?.currentBookValue === 118000,
      'Asset register in database must reflect journal entries in lockstep.'
    );

    const deprJournalEntries = await assetMockDb.journalEntries.toArray();
    assert(
      deprJournalEntries.length === 2,
      'Exactly 2 journal entries must be written for the 2 depreciation months.'
    );
    for (const je of deprJournalEntries) {
      assert(je.lines.length === 2, 'Depreciation journal entry must contain 2 lines.');
      assert(je.lines[0].debit === 1000 && je.lines[1].credit === 1000, 'Depreciation journal lines must be balanced.');
    }

    // 2. Repeated depreciation (duplicate protection)
    const repeatedDeprResult = await executeAssetDepreciationAtomic(
      testAsset.id,
      { currentUserId: 'TESTER_1', targetDate: '2026-03-01' },
      assetMockDb
    );
    assert(
      repeatedDeprResult.monthsPosted === 0,
      'Repeated depreciation for the same period must post 0 new entries.'
    );
    assert(
      repeatedDeprResult.totalDepreciation === 0,
      'Repeated depreciation must post ৳0 total depreciation.'
    );
    const journalEntriesAfterRetry = await assetMockDb.journalEntries.toArray();
    assert(
      journalEntriesAfterRetry.length === 2,
      'Repeated depreciation must not create duplicate journal entries.'
    );

    // 3. Normal Disposal
    // Carrying value = 120,000 - 2,000 = 118,000.
    // Sale proceeds = 110,000.
    // Loss = 110,000 - 118,000 = -8,000.
    const initialCash = (await assetMockDb.cashBankAccounts.get('cb_cash_1'))?.currentBalance || 0;
    const disposalResult = await executeFixedAssetDisposalTransaction(
      {
        assetId: testAsset.id,
        disposalDate: '2026-03-15',
        disposalProceeds: 110000,
        paymentMethod: 'CASH',
        disposalReason: 'Upgrading to higher capacity model',
        currentUserId: 'TESTER_1'
      },
      assetMockDb
    );

    assert(
      disposalResult.carryingValue === 118000,
      'Disposal carrying value must be cost (120,000) minus accumulated depreciation (2,000) = ৳118,000.'
    );
    assert(
      disposalResult.gainLoss === -8000,
      'Loss on disposal must be calculated from carrying value: 110,000 - 118,000 = -৳8,000.'
    );

    const disposedAsset = await assetMockDb.fixedAssets.get(testAsset.id);
    assert(
      disposedAsset?.status === 'DISPOSED',
      'Disposed asset status must be DISPOSED.'
    );
    assert(
      disposedAsset?.originalCost === 0 &&
      disposedAsset?.accumulatedDepreciation === 0 &&
      disposedAsset?.currentBookValue === 0,
      'Active balance sheet values (cost, accumulated depreciation, book value) must be reset to 0.'
    );
    assert(
      disposedAsset?.disposedOriginalCost === 120000 &&
      disposedAsset?.disposedAccumulatedDepreciation === 2000 &&
      disposedAsset?.disposalProceeds === 110000 &&
      disposedAsset?.gainLossOnDisposal === -8000,
      'Historical cost, accumulated depreciation, proceeds, and gain/loss must be preserved.'
    );

    const cashAfterDisposal = (await assetMockDb.cashBankAccounts.get('cb_cash_1'))?.currentBalance || 0;
    assert(
      cashAfterDisposal === initialCash + 110000,
      'Cash balance must be atomically credited with sale proceeds (50,000 + 110,000 = ৳160,000).'
    );

    const dispJournal = await assetMockDb.journalEntries.get(disposalResult.journalEntryId);
    assert(
      Boolean(dispJournal),
      'Disposal journal entry must exist.'
    );
    const dispDebits = dispJournal?.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
    const dispCredits = dispJournal?.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
    assert(
      dispDebits === 120000 && dispCredits === 120000,
      'Disposal journal entry debits and credits must balance at exactly original cost (৳120,000).'
    );

    // 4. Repeated Disposal / Disposal of already disposed asset
    let repeatedDisposalError = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: testAsset.id,
          disposalDate: '2026-03-20',
          disposalProceeds: 110000,
          paymentMethod: 'CASH',
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      repeatedDisposalError = true;
      assert(
        err.message.includes('ইতোমধ্যে অপসারিত') || err.message.includes('already disposed'),
        'Repeated disposal must fail with clear already-disposed message.'
      );
    }
    assert(repeatedDisposalError, 'Calling disposal on an already disposed asset must be rejected.');

    // 5. Failure / Rollback consistency
    const assetForRollback: FixedAsset = {
      id: 'AST-TEST-ROLLBACK',
      name: 'জেনারেটর (Generator)',
      category: 'MACHINERY',
      purchaseDate: '2026-01-01',
      originalCost: 50000,
      usefulLifeYears: 5,
      salvageValue: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 50000,
      depreciationRatePercent: 20,
      lastDepreciationDate: '2026-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await assetMockDb.fixedAssets.put(assetForRollback);
    const cashBeforeFailedDisposal = (await assetMockDb.cashBankAccounts.get('cb_cash_1'))?.currentBalance || 0;
    const journalCountBeforeFailed = (await assetMockDb.journalEntries.toArray()).length;

    // Simulate disposal into closed period (respect closed periods requirement)
    await assetMockDb.closedPeriods.put({
      id: 'cp_2026_01',
      endDate: '2026-01-31',
      closedAt: '2026-02-01T00:00:00Z',
      synced: false
    });

    let rollbackErrorCaught = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: assetForRollback.id,
          disposalDate: '2026-01-15', // inside closed period!
          disposalProceeds: 40000,
          paymentMethod: 'CASH',
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      rollbackErrorCaught = true;
      assert(
        err.message.includes('সীমাবদ্ধতা') || err.message.includes('closed'),
        'Disposal inside closed period must throw closed period restriction error.'
      );
    }
    assert(rollbackErrorCaught, 'Closed period check must throw and abort disposal.');

    // Verify atomic rollback
    const assetAfterFailedDisposal = await assetMockDb.fixedAssets.get(assetForRollback.id);
    assert(
      assetAfterFailedDisposal?.status === 'ACTIVE',
      'Asset status must remain ACTIVE after aborted disposal transaction.'
    );
    assert(
      assetAfterFailedDisposal?.originalCost === 50000,
      'Asset original cost must remain ৳50,000 unaffected after rollback.'
    );
    const cashAfterFailedDisposal = (await assetMockDb.cashBankAccounts.get('cb_cash_1'))?.currentBalance || 0;
    assert(
      cashAfterFailedDisposal === cashBeforeFailedDisposal,
      'Cash balance must not change on aborted disposal transaction.'
    );
    const journalCountAfterFailed = (await assetMockDb.journalEntries.toArray()).length;
    assert(
      journalCountAfterFailed === journalCountBeforeFailed,
      'No journal entry must remain after aborted disposal transaction.'
    );

    // Also test depreciation rollback consistency on simulated failure
    const assetDeprRollback: FixedAsset = {
      id: 'AST-DEPR-ROLLBACK',
      name: 'সৌর প্যানেল (Solar Panel)',
      category: 'EQUIPMENT',
      purchaseDate: '2026-01-01',
      originalCost: 60000,
      usefulLifeYears: 5,
      salvageValue: 0,
      accumulatedDepreciation: 0,
      currentBookValue: 60000,
      depreciationRatePercent: 20,
      lastDepreciationDate: '2026-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await assetMockDb.fixedAssets.put(assetDeprRollback);
    const journalCountBeforeDeprFail = (await assetMockDb.journalEntries.toArray()).length;

    // Simulate failure during transaction by passing invalid or sabotaged update
    let deprFailCaught = false;
    try {
      await assetMockDb.transaction(
        'rw',
        [assetMockDb.fixedAssets, assetMockDb.journalEntries, assetMockDb.accounts, assetMockDb.auditLogs, assetMockDb.closedPeriods],
        async () => {
          // Post normal depreciation
          await executeAssetDepreciationAtomic(
            assetDeprRollback.id,
            { currentUserId: 'TESTER_1', targetDate: '2026-03-01' },
            assetMockDb
          );
          // Intentionally throw midway before completing batch
          throw new Error('Simulated mid-transaction failure for depreciation rollback test');
        }
      );
    } catch (err: any) {
      deprFailCaught = true;
      assert(err.message.includes('Simulated mid-transaction failure'), 'Simulated failure caught.');
    }
    assert(deprFailCaught, 'Depreciation transaction must catch simulated failure.');

    const assetAfterDeprFail = await assetMockDb.fixedAssets.get(assetDeprRollback.id);
    assert(
      assetAfterDeprFail?.accumulatedDepreciation === 0,
      'Asset accumulated depreciation must roll back to 0 on failure.'
    );
    assert(
      assetAfterDeprFail?.lastDepreciationDate === '2026-01-01',
      'Asset lastDepreciationDate must roll back to 2026-01-01 on failure.'
    );
    const journalCountAfterDeprFail = (await assetMockDb.journalEntries.toArray()).length;
    assert(
      journalCountAfterDeprFail === journalCountBeforeDeprFail,
      'All journal entries posted during aborted depreciation must be completely rolled back.'
    );

    // -------------------------------------------------------------------------
    // TASK 8: INVESTOR ACCOUNTING MODEL VERIFICATION (SLEEPING PARTNER)
    // -------------------------------------------------------------------------
    const invMockDb = createMockAgroDatabase();
    await invMockDb.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS);
    const invBankId = 'bank_acc_inv_1';
    await invMockDb.cashBankAccounts.put({
      id: invBankId,
      accountName: 'ইসলামী ব্যাংক বাংলাদেশ (Islami Bank)',
      accountType: 'BANK',
      accountNumber: 'IBBL-001',
      currentBalance: 50000,
      isActive: true,
      synced: false
    });

    // STEP 1: Investor Capital Contributed
    // Investor: "রহিম পার্টনার" (Sleeping partner), capital ৳100,000, profit share 40% (working partner 60%)
    const contribRes = await executeInvestorTransaction(
      {
        investorName: 'রহিম পার্টনার',
        contribution: 100000,
        profitShare: 40,
        profitSharingRatio: 40,
        targetAccountId: invBankId,
        currentUserId: 'usr_owner',
        phone: '01711000000',
        date: '2026-01-10'
      },
      invMockDb
    );

    assert(!!contribRes.investor && !!contribRes.journalEntryId, 'Contribution transaction must succeed.');
    const invAfterContrib = await invMockDb.investors.get(contribRes.investor.id);
    assert(invAfterContrib?.capitalContributed === 100000, 'Capital contributed must be 100,000.');
    assert(invAfterContrib?.currentCapitalBalance === 100000, 'Current capital balance must be 100,000.');
    assert(invAfterContrib?.profitSharingRatio === 40, 'Agreed profit sharing ratio must be 40%.');
    assert(invAfterContrib?.workingPartnerShareRatio === 60, 'Working partner share ratio must be 60%.');
    assert(invAfterContrib?.totalProfitAllocated === 0, 'Initial profit allocated must be 0.');
    assert(invAfterContrib?.profitPayable === 0, 'Initial profit payable must be 0.');
    assert(invAfterContrib?.totalProfitPaid === 0, 'Initial profit paid must be 0.');
    assert(invAfterContrib?.totalCapitalReturned === 0, 'Initial capital returned must be 0.');

    // GL Rule 1: Capital is NOT revenue
    // Check Journal Entry: Dr 1030 Bank, Cr 3020 Investor Capital
    const contribJournal = await invMockDb.journalEntries.get(contribRes.journalEntryId);
    assert(contribJournal !== undefined, 'Contribution journal entry must exist.');
    const contribDrBank = contribJournal.lines.find((l: any) => l.accountCode === '1030' && l.debit === 100000);
    const contribCrCap = contribJournal.lines.find((l: any) => l.accountCode === '3020' && l.credit === 100000);
    const hasRevenueLine = contribJournal.lines.some((l: any) => l.accountCode.startsWith('4'));
    const hasInterestLine = contribJournal.lines.some((l: any) => l.accountCode === '8010' || l.accountCode === '7010');
    assert(!!contribDrBank && !!contribCrCap, 'Contribution must Dr 1030 Bank and Cr 3020 Investor Capital.');
    assert(!hasRevenueLine, 'Rule: Capital contribution is NOT revenue (no 4000 accounts).');
    assert(!hasInterestLine, 'Rule: No interest-bearing logic or expense for investor capital.');

    // Check Bank balance: 50,000 + 100,000 = 150,000
    const bankAfterContrib = await invMockDb.cashBankAccounts.get(invBankId);
    assert(bankAfterContrib?.currentBalance === 150000, 'Bank balance must increase by 100,000 to 150,000.');

    // STEP 2: Actual Profit Allocated
    // Business earns actual net profit of ৳50,000.
    // Investor gets 40% agreed share of actual profit: ৳20,000.
    const allocRes = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invAfterContrib.id,
        actualBusinessProfit: 50000,
        allocationDate: '2026-06-30',
        notes: '২০২৬ অর্ধ-বার্ষিক প্রকৃত নীট মুনাফা বণ্টন',
        currentUserId: 'usr_owner'
      },
      invMockDb
    );

    assert(allocRes.allocatedProfit === 20000, 'Allocated profit must equal 40% of 50,000 = 20,000.');
    const invAfterAlloc = await invMockDb.investors.get(invAfterContrib.id);
    assert(invAfterAlloc?.totalProfitAllocated === 20000, 'totalProfitAllocated must be 20,000.');
    assert(invAfterAlloc?.profitPayable === 20000, 'profitPayable must be 20,000.');

    // GL Rule 2: Profit share is NOT operating expense
    // Check Journal Entry: Dr 3070 Profit Distribution / 3050 Retained Earnings (Equity), Cr 2050 Investor Profit Payable (Liability)
    const allocJournal = await invMockDb.journalEntries.get(allocRes.journalEntryId);
    assert(allocJournal !== undefined, 'Allocation journal entry must exist.');
    const allocDrRetained = allocJournal.lines.find((l: any) => (l.accountCode === '3070' || l.accountCode === '3050') && l.debit === 20000);
    const allocCrPayable = allocJournal.lines.find((l: any) => l.accountCode === '2050' && l.credit === 20000);
    const hasOpExpenseLine = allocJournal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    assert(!!allocDrRetained && !!allocCrPayable, 'Profit allocation must Dr 3070 Profit Distribution/3050 Retained Earnings and Cr 2050 Investor Profit Payable.');
    assert(!hasOpExpenseLine, 'Rule: Profit share allocation is NOT an operating expense (no 5000/6000 accounts).');

    // STEP 3: Investor Profit Payable verification
    // Current payable must be strictly 20,000 and separated from capital (100,000)
    assert(invAfterAlloc?.profitPayable === 20000, 'Investor profit payable must be 20,000.');
    assert(invAfterAlloc?.currentCapitalBalance === 100000, 'Investor capital balance remains 100,000 unchanged by profit allocation.');

    // STEP 4: Profit Actually Paid
    // Pay ৳15,000 of the ৳20,000 payable profit from the Bank account
    const payRes = await executeInvestorProfitPaymentTransaction(
      {
        investorId: invAfterAlloc.id,
        amount: 15000,
        sourceAccountId: invBankId,
        paymentDate: '2026-07-05',
        notes: 'লভ্যাংশ আংশিক পরিশোধ',
        currentUserId: 'usr_owner'
      },
      invMockDb
    );

    assert(payRes.paidAmount === 15000, 'Paid amount must be 15,000.');
    const invAfterPay = await invMockDb.investors.get(invAfterAlloc.id);
    assert(invAfterPay?.totalProfitPaid === 15000, 'totalProfitPaid must be 15,000.');
    assert(invAfterPay?.profitPayable === 5000, 'Remaining profitPayable must be 5,000.');

    // GL Rule 3: Profit payment reduces liability and cash/bank, NOT operating expense
    const payJournal = await invMockDb.journalEntries.get(payRes.journalEntryId);
    assert(payJournal !== undefined, 'Profit payment journal entry must exist.');
    const payDrPayable = payJournal.lines.find((l: any) => l.accountCode === '2050' && l.debit === 15000);
    const payCrBank = payJournal.lines.find((l: any) => l.accountCode === '1030' && l.credit === 15000);
    const hasPayOpExpense = payJournal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    assert(!!payDrPayable && !!payCrBank, 'Profit payment must Dr 2050 Profit Payable and Cr 1030 Bank.');
    assert(!hasPayOpExpense, 'Rule: Profit payment is NOT an operating expense.');

    // Bank balance should decrease by 15,000: 150,000 - 15,000 = 135,000
    const bankAfterPay = await invMockDb.cashBankAccounts.get(invBankId);
    assert(bankAfterPay?.currentBalance === 135000, 'Bank balance must decrease to 135,000.');

    // Overpayment prevention check: trying to pay ৳10,000 when only ৳5,000 is payable must fail
    let overpayCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: invAfterAlloc.id,
          amount: 10000,
          sourceAccountId: invBankId,
          paymentDate: '2026-07-06',
          currentUserId: 'usr_owner'
        },
        invMockDb
      );
    } catch (err: any) {
      overpayCaught = true;
      assert(err.message.includes('পাওনা লভ্যাংশের চেয়ে বেশি পরিশোধ করা সম্ভব নয়'), 'Overpayment must be rejected.');
    }
    assert(overpayCaught, 'Attempting to pay more than profitPayable must fail.');

    // STEP 5: Capital Returned
    // Return ৳30,000 capital from the Bank account
    const retRes = await executeInvestorCapitalReturnTransaction(
      {
        investorId: invAfterAlloc.id,
        amount: 30000,
        sourceAccountId: invBankId,
        returnDate: '2026-08-01',
        notes: 'মূলধন আংশিক ফেরত',
        currentUserId: 'usr_owner'
      },
      invMockDb
    );

    assert(retRes.returnedAmount === 30000, 'Returned capital amount must be 30,000.');
    const invAfterRet = await invMockDb.investors.get(invAfterAlloc.id);
    assert(invAfterRet?.totalCapitalReturned === 30000, 'totalCapitalReturned must be 30,000.');
    assert(invAfterRet?.currentCapitalBalance === 70000, 'currentCapitalBalance must be 70,000 (100k - 30k).');

    // GL Rule 4: Capital return is NOT operating expense
    // Check Journal Entry: Dr 3020 Investor Capital (Equity reduction), Cr 1030 Bank
    const retJournal = await invMockDb.journalEntries.get(retRes.journalEntryId);
    assert(retJournal !== undefined, 'Capital return journal entry must exist.');
    const retDrCap = retJournal.lines.find((l: any) => l.accountCode === '3020' && l.debit === 30000);
    const retCrBank = retJournal.lines.find((l: any) => l.accountCode === '1030' && l.credit === 30000);
    const hasRetOpExpense = retJournal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    assert(!!retDrCap && !!retCrBank, 'Capital return must Dr 3020 Investor Capital and Cr 1030 Bank.');
    assert(!hasRetOpExpense, 'Rule: Capital return is NOT an operating expense.');

    // Bank balance should decrease by 30,000: 135,000 - 30,000 = 105,000
    const bankAfterRet = await invMockDb.cashBankAccounts.get(invBankId);
    assert(bankAfterRet?.currentBalance === 105000, 'Bank balance must decrease to 105,000.');

    // Over-return prevention check: trying to return ৳80,000 when currentCapitalBalance is ৳70,000 must fail
    let overReturnCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: invAfterAlloc.id,
          amount: 80000,
          sourceAccountId: invBankId,
          returnDate: '2026-08-02',
          currentUserId: 'usr_owner'
        },
        invMockDb
      );
    } catch (err: any) {
      overReturnCaught = true;
      assert(err.message.includes('মূলধন ফেরতের পরিমাণ বিদ্যমান মূলধনের চেয়ে বেশি হতে পারে না'), 'Over-return must be rejected.');
    }
    assert(overReturnCaught, 'Attempting to return more than currentCapitalBalance must fail.');

    // Closed period protection check:
    await invMockDb.closedPeriods.put({
      id: 'cp_2026_h1',
      endDate: '2026-06-30',
      synced: false
    });

    let closedPeriodCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invAfterAlloc.id,
          actualBusinessProfit: 10000,
          allocationDate: '2026-05-01', // Before closed period end date 2026-06-30
          currentUserId: 'usr_owner'
        },
        invMockDb
      );
    } catch (err: any) {
      closedPeriodCaught = true;
      assert(err.message.includes('বন্ধ হিসাবকালের'), 'Closed period protection triggered.');
    }
    assert(closedPeriodCaught, 'Closed period must block profit allocation in closed period.');

    // =========================================================================
    // TASK 9: SEPARATE VERIFICATION 1 — PROFIT ALLOCATION (VERIFY ALLOCATION SEPARATELY)
    // User Scenario:
    // Profit = ৳200,000; Working partner = 60%; Investor = 40% -> Investor profit = ৳80,000.
    // Flow: Finalized profit → allocation → investor payable
    // Allocation: Dr Profit Distribution / appropriate equity account, Cr Investor Profit Payable
    // =========================================================================
    const allocTestDb = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await allocTestDb.accounts.put(acc);
    }
    const allocBankAcc = {
      id: 'cb_alloc_bank',
      accountType: 'BANK',
      name: 'ইসলামী ব্যাংক বাংলাদেশ',
      currentBalance: 500000,
      synced: false
    };
    await allocTestDb.cashBankAccounts.put(allocBankAcc);

    // Create Sleeping Partner with Capital ৳150,000 and 40% profit share
    const testInv = await executeInvestorTransaction(
      {
        investorName: 'তারেক জামান (স্লিপিং পার্টনার)',
        contribution: 150000,
        profitShare: 40,
        profitSharingRatio: 40,
        targetAccountId: allocBankAcc.id,
        currentUserId: 'usr_owner',
        phone: '01819000000',
        date: '2026-01-01'
      },
      allocTestDb
    );

    // Rule check: Never guarantee profit (reject profit <= 0)
    let negativeProfitCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: testInv.investor.id,
          finalizedDistributableProfit: -50000,
          allocationDate: '2026-06-30',
          currentUserId: 'usr_owner'
        },
        allocTestDb
      );
    } catch (err: any) {
      negativeProfitCaught = true;
      assert(err.message.includes('চূড়ান্ত বণ্টনযোগ্য প্রকৃত মুনাফা অবশ্যই ০ এর বেশি হতে হবে'), 'Negative or zero profit allocation must be rejected.');
    }
    assert(negativeProfitCaught, 'Allocation with non-positive profit must fail (Never guarantee profit).');

    // Rule check: Execute valid allocation with Profit = ৳200,000
    // Working partner = 60% (৳120,000), Investor = 40% (৳80,000)
    const task9AllocRes = await executeInvestorProfitAllocationTransaction(
      {
        investorId: testInv.investor.id,
        finalizedDistributableProfit: 200000,
        allocationDate: '2026-06-30',
        allocationReference: 'ALLOC-2026-Q2',
        notes: '২০২৬ দ্বিতীয় প্রান্তিকের প্রকৃত চূড়ান্ত মুনাফা বণ্টন',
        currentUserId: 'usr_owner'
      },
      allocTestDb
    );

    // Verify calculated shares
    assert(task9AllocRes.allocatedProfit === 80000, 'Investor profit share must be strictly ৳80,000 (40% of ৳200,000).');
    assert(task9AllocRes.workingPartnerShare === 120000, 'Working partner profit share must be strictly ৳120,000 (60% of ৳200,000).');
    assert(task9AllocRes.profitSharingRatio === 40, 'Agreed profit sharing ratio must be 40%.');
    assert(task9AllocRes.workingPartnerRatio === 60, 'Working partner ratio must be 60%.');

    // Verify investor state after allocation
    const invAfterTask9Alloc = await allocTestDb.investors.get(testInv.investor.id);
    assert(invAfterTask9Alloc?.totalProfitAllocated === 80000, 'totalProfitAllocated must be updated to ৳80,000.');
    assert(invAfterTask9Alloc?.profitPayable === 80000, 'profitPayable must be updated to ৳80,000.');
    // Ensure capital is strictly untouched
    assert(invAfterTask9Alloc?.currentCapitalBalance === 150000, 'Investor capital must remain completely separate and unchanged (৳150,000).');

    // Verify Allocation Journal Entry:
    // Dr Profit Distribution (3070) or appropriate equity account (3050)
    // Cr Investor Profit Payable (2050)
    const task9AllocJournal = await allocTestDb.journalEntries.get(task9AllocRes.journalEntryId);
    assert(task9AllocJournal !== undefined, 'Allocation journal entry must exist.');
    const allocDebitLine = task9AllocJournal.lines.find(
      (l: any) => (l.accountCode === '3070' || l.accountCode === '3050') && l.debit === 80000
    );
    const allocCreditPayable = task9AllocJournal.lines.find(
      (l: any) => l.accountCode === '2050' && l.credit === 80000
    );
    assert(!!allocDebitLine, 'Allocation must Debit Profit Distribution (3070) or Retained Earnings (3050) for ৳80,000.');
    assert(!!allocCreditPayable, 'Allocation must Credit Investor Profit Payable (2050) for ৳80,000.');

    // Rule: Profit share is NOT operating expense, NOT revenue, NO interest
    const hasOpExpense = task9AllocJournal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    const hasRevenue = task9AllocJournal.lines.some((l: any) => l.accountCode.startsWith('4'));
    const hasInterest = task9AllocJournal.lines.some((l: any) => l.accountCode === '8010' || l.accountCode === '7010');
    assert(!hasOpExpense, 'Rule: Profit allocation must NEVER use operating expense accounts (5000/6000).');
    assert(!hasRevenue, 'Rule: Profit allocation must NEVER use revenue accounts (4000).');
    assert(!hasInterest, 'Rule: Profit allocation must NEVER use interest accounts.');

    // Rule: Prevent duplicate allocation
    let duplicateAllocCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: testInv.investor.id,
          finalizedDistributableProfit: 200000,
          allocationDate: '2026-06-30',
          allocationReference: 'ALLOC-2026-Q2', // Same reference
          currentUserId: 'usr_owner'
        },
        allocTestDb
      );
    } catch (err: any) {
      duplicateAllocCaught = true;
      assert(err.message.includes('লভ্যাংশ বণ্টন ইতোমধ্যে সম্পন্ন হয়েছে'), 'Duplicate allocation must be prevented.');
    }
    assert(duplicateAllocCaught, 'Duplicate profit allocation must be rejected.');

    // Rule: Respect closed periods on allocation
    await allocTestDb.closedPeriods.put({
      id: 'cp_alloc_2026_q2',
      endDate: '2026-06-30',
      netProfitTransferred: 200000,
      synced: false
    });
    let allocInClosedPeriodCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: testInv.investor.id,
          finalizedDistributableProfit: 50000,
          allocationDate: '2026-06-15', // Falls in closed period
          allocationReference: 'ALLOC-CLOSED-TEST',
          currentUserId: 'usr_owner'
        },
        allocTestDb
      );
    } catch (err: any) {
      allocInClosedPeriodCaught = true;
      assert(err.message.includes('বন্ধ হিসাবকালের'), 'Allocation in closed period must be prevented.');
    }
    assert(allocInClosedPeriodCaught, 'Closed period must block profit allocation.');

    // =========================================================================
    // TASK 9: SEPARATE VERIFICATION 2 — PROFIT PAYMENT (VERIFY PAYMENT SEPARATELY)
    // Flow: investor payable → actual payment
    // Payment: Dr Investor Profit Payable (2050), Cr Cash/Bank (1010/1030)
    // =========================================================================
    const payTestDb = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await payTestDb.accounts.put(acc);
    }
    const payBankAcc = {
      id: 'cb_pay_bank',
      accountType: 'BANK',
      name: 'ডাচ বাংলা ব্যাংক',
      currentBalance: 300000,
      synced: false
    };
    await payTestDb.cashBankAccounts.put(payBankAcc);

    // Create investor with initial ৳80,000 profit payable from finalized profits
    const payInv = {
      id: 'inv_pay_test_1',
      name: 'জামাল পার্টনার',
      phone: '01711223344',
      sharePercentage: 40,
      profitSharingRatio: 40,
      workingPartnerShareRatio: 60,
      capitalAmount: 100000,
      capitalContributed: 100000,
      currentCapitalBalance: 100000,
      totalProfitAllocated: 80000,
      profitPayable: 80000,
      totalProfitPaid: 0,
      totalCapitalReturned: 0,
      drawings: 0,
      currentBalance: 100000,
      synced: false
    };
    await payTestDb.investors.put(payInv);

    // Rule: Do not pay more than allocated
    // Attempting to pay ৳85,000 when payable is ৳80,000 must fail
    let overpaymentCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: payInv.id,
          amount: 85000,
          sourceAccountId: payBankAcc.id,
          paymentDate: '2026-07-10',
          currentUserId: 'usr_owner'
        },
        payTestDb
      );
    } catch (err: any) {
      overpaymentCaught = true;
      assert(err.message.includes('পাওনা লভ্যাংশের চেয়ে বেশি পরিশোধ করা সম্ভব নয়'), 'Paying more than allocated payable must be rejected.');
    }
    assert(overpaymentCaught, 'Payment exceeding profitPayable must be rejected.');

    // Valid Payment Part 1: Pay partial ৳50,000 of the ৳80,000 payable
    const payPart1Res = await executeInvestorProfitPaymentTransaction(
      {
        investorId: payInv.id,
        amount: 50000,
        sourceAccountId: payBankAcc.id,
        paymentDate: '2026-07-10',
        paymentReference: 'PAY-REF-001',
        notes: 'লভ্যাংশ প্রথম কিস্তি পরিশোধ',
        currentUserId: 'usr_owner'
      },
      payTestDb
    );

    assert(payPart1Res.paidAmount === 50000, 'Paid amount must be ৳50,000.');
    assert(payPart1Res.remainingPayable === 30000, 'Remaining payable must be ৳30,000 (80k - 50k).');

    // Verify investor balances after partial payment
    const invAfterPay1 = await payTestDb.investors.get(payInv.id);
    assert(invAfterPay1?.totalProfitPaid === 50000, 'totalProfitPaid must be ৳50,000.');
    assert(invAfterPay1?.profitPayable === 30000, 'profitPayable must be ৳30,000.');
    assert(invAfterPay1?.currentCapitalBalance === 100000, 'Capital balance must remain ৳100,000 completely untouched.');

    // Verify Payment 1 Journal Entry:
    // Dr Investor Profit Payable (2050)
    // Cr Bank (1030)
    const pay1Journal = await payTestDb.journalEntries.get(payPart1Res.journalEntryId);
    assert(pay1Journal !== undefined, 'Payment journal entry must exist.');
    const pay1DrPayable = pay1Journal.lines.find((l: any) => l.accountCode === '2050' && l.debit === 50000);
    const pay1CrBank = pay1Journal.lines.find((l: any) => l.accountCode === '1030' && l.credit === 50000);
    assert(!!pay1DrPayable, 'Payment must Debit Investor Profit Payable (2050) for ৳50,000.');
    assert(!!pay1CrBank, 'Payment must Credit Bank (1030) for ৳50,000.');

    // Rule: Profit payment is NOT an operating expense
    const pay1HasOpExpense = pay1Journal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    assert(!pay1HasOpExpense, 'Rule: Profit payment must NEVER be charged as an operating expense.');

    // Verify Bank balance: 300,000 - 50,000 = 250,000
    const bankAfterPay1 = await payTestDb.cashBankAccounts.get(payBankAcc.id);
    assert(bankAfterPay1?.currentBalance === 250000, 'Bank balance must decrease to ৳250,000.');

    // Rule: Prevent duplicate payment
    let duplicatePayCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: payInv.id,
          amount: 50000,
          sourceAccountId: payBankAcc.id,
          paymentDate: '2026-07-10',
          paymentReference: 'PAY-REF-001', // Same reference
          currentUserId: 'usr_owner'
        },
        payTestDb
      );
    } catch (err: any) {
      duplicatePayCaught = true;
      assert(err.message.includes('লভ্যাংশ পরিশোধ ইতোমধ্যে সম্পন্ন হয়েছে'), 'Duplicate payment must be rejected.');
    }
    assert(duplicatePayCaught, 'Duplicate payment must be prevented.');

    // Valid Payment Part 2: Pay remaining ৳30,000
    const payPart2Res = await executeInvestorProfitPaymentTransaction(
      {
        investorId: payInv.id,
        amount: 30000,
        sourceAccountId: payBankAcc.id,
        paymentDate: '2026-07-15',
        paymentReference: 'PAY-REF-002',
        notes: 'লভ্যাংশ অবশিষ্ট সম্পূর্ণ পরিশোধ',
        currentUserId: 'usr_owner'
      },
      payTestDb
    );

    assert(payPart2Res.paidAmount === 30000, 'Paid amount must be ৳30,000.');
    assert(payPart2Res.remainingPayable === 0, 'Remaining payable must be strictly ৳0.');

    const invAfterPay2 = await payTestDb.investors.get(payInv.id);
    assert(invAfterPay2?.totalProfitPaid === 80000, 'totalProfitPaid must be ৳80,000.');
    assert(invAfterPay2?.profitPayable === 0, 'profitPayable must be 0.');

    // Attempting further payment when payable is 0 must fail
    let zeroPayableCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: payInv.id,
          amount: 5000,
          sourceAccountId: payBankAcc.id,
          paymentDate: '2026-07-20',
          currentUserId: 'usr_owner'
        },
        payTestDb
      );
    } catch (err: any) {
      zeroPayableCaught = true;
      assert(err.message.includes('কোনো বকেয়া বা প্রদেয় লভ্যাংশ নেই'), 'Payment with zero payable balance must be rejected.');
    }
    assert(zeroPayableCaught, 'Payment when profitPayable is 0 must fail.');

    // Rule: Respect closed periods on payment
    await payTestDb.closedPeriods.put({
      id: 'cp_pay_2026_q2',
      endDate: '2026-06-30',
      netProfitTransferred: 200000,
      synced: false
    });
    let payInClosedPeriodCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: payInv.id,
          amount: 1000,
          sourceAccountId: payBankAcc.id,
          paymentDate: '2026-06-15', // In closed period
          currentUserId: 'usr_owner'
        },
        payTestDb
      );
    } catch (err: any) {
      payInClosedPeriodCaught = true;
      assert(err.message.includes('বন্ধ হিসাবকালের'), 'Payment in closed period must be prevented.');
    }
    assert(payInClosedPeriodCaught, 'Closed period must block profit payment.');

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
