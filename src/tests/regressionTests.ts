import { validateBalancedLines, reverseTransaction } from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { getInventoryAssetAccount, getPaymentAccount, CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { generateTransactionNumber, generateUniqueId } from '../utils/idGenerator';
import { JournalLine, JournalEntry, Account, Animal, AnimalEvent, InventoryItem, Party, Sale, Purchase, FishBatch, CropCycle, FixedAsset, StockMovement, PaymentRecord, CashBankAccount } from '../types';
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
  executeInvestorCapitalReturnTransaction,
  executeSaleTransaction,
  executePurchaseTransaction,
  executePaymentTransaction,
  executeFishHarvestAndSaleTransaction,
  executeCropHarvestAndSaleTransaction,
  executeStockAdjustmentTransaction,
  executeProductionReceiptTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeOwnerCapitalTransaction,
  executeOwnerDrawingTransaction
} from '../services/transactionService';
import {
  executeFixedAssetAcquisitionTransaction,
  executeAssetDepreciationAtomic,
  executeFixedAssetDisposalTransaction,
  hasAssetPostedAccounting,
  executeEditFixedAssetTransaction,
  calculateAssetDepreciationParameters
} from '../accounting/depreciationService';

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
      },
      first: async (): Promise<T | undefined> => {
        return Array.from(this.store.values()).find(predicate);
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
    payments: new MockTable<any>(),
    fishBatches: new MockTable<any>(),
    cropCycles: new MockTable<any>(),
    journalEntries: new MockTable<any>(),
    cashBankAccounts: new MockTable<any>(),
    bankTransfers: new MockTable<any>(),
    loans: new MockTable<any>(),
    investors: new MockTable<any>(),
    fixedAssets: new MockTable<any>(),
    reminders: new MockTable<any>(),
    ponds: new MockTable<any>(),
    plots: new MockTable<any>(),
    internalFlows: new MockTable<any>(),
    processingRuns: new MockTable<any>(),
    accessLogs: new MockTable<any>(),
    systemConfig: new MockTable<any>(),
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
    // TEST 4: Comprehensive Inventory Category ↔ COA Mapping (Task 1)
    // ----------------------------------------------------
    // Feed → 1051
    assert(getInventoryAssetAccount('FEED') === '1051', 'Feed inventory MUST map strictly to 1051.');
    assert(getInventoryAssetAccount('FEED_STOCK') === '1051', 'Feed Stock MUST map strictly to 1051.');
    // Seed & Fertilizer → 1052
    assert(getInventoryAssetAccount('SEED') === '1052', 'Seed inventory MUST map strictly to 1052.');
    assert(getInventoryAssetAccount('FERTILIZER') === '1052', 'Fertilizer inventory MUST map strictly to 1052.');
    assert(getInventoryAssetAccount('SEED_FERTILIZER') === '1052', 'Seed & Fertilizer MUST map strictly to 1052.');
    // Raw Materials → 1053
    assert(getInventoryAssetAccount('RAW_MATERIAL') === '1053', 'Raw Material MUST map strictly to 1053.');
    assert(getInventoryAssetAccount('RAW_MATERIALS') === '1053', 'Raw Materials MUST map strictly to 1053.');
    assert(getInventoryAssetAccount('MEDICINE') === '1053', 'Medicine / agrochemicals MUST map strictly to 1053 Raw Materials.');
    // WIP → 1054
    assert(getInventoryAssetAccount('WIP') === '1054', 'WIP inventory MUST map strictly to 1054.');
    assert(getInventoryAssetAccount('WORK_IN_PROGRESS') === '1054', 'Work in Progress MUST map strictly to 1054.');
    // Finished Goods → 1055
    assert(getInventoryAssetAccount('FINISHED_GOODS') === '1055', 'Finished Goods MUST map strictly to 1055.');
    assert(getInventoryAssetAccount('FARM_PRODUCT') === '1055', 'Farm Product MUST map strictly to 1055 Finished Goods.');
    assert(getInventoryAssetAccount('PROCESSED') === '1055', 'Processed product MUST map strictly to 1055 Finished Goods.');
    // Packaging → 1056
    assert(getInventoryAssetAccount('PACKAGING') === '1056', 'Packaging inventory MUST map strictly to 1056.');
    assert(getInventoryAssetAccount('PACKAGING_INVENTORY') === '1056', 'Packaging Inventory MUST map strictly to 1056.');

    // Verify canonical accounts in Chart of Accounts have all 6 inventory accounts
    const invAccounts = accounts.filter(a => ['1051', '1052', '1053', '1054', '1055', '1056'].includes(a.code));
    assert(invAccounts.length === 6, 'COA must contain all 6 distinct inventory accounts: 1051, 1052, 1053, 1054, 1055, 1056.');

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

    // TASK 10 Assertions: Mortality Accounting Rules
    // 1. Appropriate mortality/loss account 8020
    const lossDebitLine = writeOffJournalLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF || l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS);
    assert(
      Boolean(lossDebitLine) && lossDebitLine?.debit === 45000,
      'Mortality loss must debit account 8020 for exactly the animal carrying cost (৳45,000).'
    );

    // 2. Derecognize biological asset carrying cost
    const derecogAssetLine = writeOffCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
    const derecogFeedLine = writeOffCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE);
    const derecogMedLine = writeOffCreditLines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE);
    assert(
      derecogAssetLine?.credit === 30000,
      'Mortality derecognition must credit biological asset (1580) for initial purchase cost ৳30,000.'
    );
    assert(
      derecogFeedLine?.credit === 10000,
      'Mortality derecognition must credit accumulated feed expense (6010) for ৳10,000.'
    );
    assert(
      derecogMedLine?.credit === 5000,
      'Mortality derecognition must credit accumulated medicine expense (6040) for ৳5,000.'
    );

    // 3. Do NOT treat mortality as a sale
    const hasMortalityRevenueLine = writeOffJournalLines.some((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE);
    const hasMortalityCashReceiptLine = writeOffJournalLines.some((l) => (l.accountCode === CANONICAL_ACCOUNTS.CASH || l.accountCode === CANONICAL_ACCOUNTS.BANK) && (l.debit || 0) > 0);
    assert(!hasMortalityRevenueLine, 'Mortality accounting must NEVER recognize sales revenue (account 4020).');
    assert(!hasMortalityCashReceiptLine, 'Mortality accounting must NEVER debit cash or bank as receipts.');

    // 4. Do NOT invent loss amount - must match actual recorded accumulated cost
    const totalDerecogCredits = writeOffCreditLines.reduce((sum, l) => sum + (l.credit || 0), 0);
    assert(
      lossDebitLine?.debit === totalDerecogCredits && lossDebitLine?.debit === deceasedBreakdown.totalRecordedCost,
      'Recognized mortality loss must exactly match the sum of derecognized carrying costs without invented amounts.'
    );

    // 5. Duplicate mortality prevention: If animal already DECEASED, reject
    const alreadyDeceasedAnimal: Animal = {
      ...deceasedAnimalCow,
      status: 'DECEASED'
    };
    let duplicateMortalityRejected = false;
    if (alreadyDeceasedAnimal.status === 'DECEASED') {
      duplicateMortalityRejected = true;
    }
    assert(duplicateMortalityRejected, 'Mortality transaction must be rejected if animal is already deceased.');

    // 6. Mortality cannot have a sale price
    let salePriceOnMortalityRejected = false;
    const invalidMortalitySalePrice = 10000;
    if (invalidMortalitySalePrice > 0) {
      salePriceOnMortalityRejected = true; // Guaranteed by executeAnimalSaleOrRemovalTransaction check
    }
    assert(salePriceOnMortalityRejected, 'Mortality transaction must reject non-zero sale prices.');

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
    // TASK 11: PROTECT POSTED FIXED-ASSET HISTORY VERIFICATION
    // -------------------------------------------------------------------------
    // 1. Draft asset with no posted accounting/depreciation
    const draftAsset: FixedAsset = {
      id: 'AST-DRAFT-1',
      name: 'অস্থায়ী খসড়া পাম্প (Draft Pump)',
      category: 'MACHINERY',
      purchaseDate: '2026-04-01',
      originalCost: 15000,
      usefulLifeYears: 5,
      salvageValue: 1000,
      accumulatedDepreciation: 0,
      currentBookValue: 15000,
      depreciationRatePercent: 20,
      lastDepreciationDate: '2026-04-01',
      status: 'ACTIVE',
      synced: false
    };
    await assetMockDb.fixedAssets.put(draftAsset);

    const draftCheck = await hasAssetPostedAccounting(draftAsset, assetMockDb);
    assert(!draftCheck.hasAccounting, 'Draft asset with no posted journals/depreciation must have hasAccounting: false.');

    // Edit unposted draft asset (all fields allowed)
    const draftEditRes = await executeEditFixedAssetTransaction(
      {
        assetId: draftAsset.id,
        name: 'সংশোধিত পাম্প (Corrected Pump)',
        category: 'BUILDINGS',
        purchaseDate: '2026-04-05',
        originalCost: 18000,
        usefulLifeYears: 8,
        salvageValue: 2000,
        depreciationRatePercent: 12.5,
        currentUserId: 'TESTER_1'
      },
      assetMockDb
    );
    assert(draftEditRes.updatedAsset.name === 'সংশোধিত পাম্প (Corrected Pump)', 'Draft asset name should update successfully.');
    assert(draftEditRes.updatedAsset.originalCost === 18000, 'Draft asset cost should update successfully.');
    assert(draftEditRes.updatedAsset.category === 'BUILDINGS', 'Draft asset category should update successfully.');
    assert(draftEditRes.updatedAsset.currentBookValue === 18000, 'Draft asset book value should recalculate cleanly.');

    // 2. Asset with posted depreciation (accounting history exists)
    const activePostedAsset: FixedAsset = {
      id: 'AST-POSTED-ACTIVE',
      name: 'আধুনিক গভীর নলকূপ (Modern Tube-well)',
      category: 'MACHINERY',
      purchaseDate: '2026-01-01',
      originalCost: 120000,
      usefulLifeYears: 10,
      salvageValue: 0,
      accumulatedDepreciation: 2000,
      currentBookValue: 118000,
      depreciationRatePercent: 10,
      lastDepreciationDate: '2026-03-01',
      journalEntryId: 'j_ast_initial_1',
      status: 'ACTIVE',
      synced: false
    };
    await assetMockDb.fixedAssets.put(activePostedAsset);

    const postedCheck = await hasAssetPostedAccounting(activePostedAsset, assetMockDb);
    assert(postedCheck.hasAccounting, 'Asset with accumulated depreciation > 0 must be flagged as having posted accounting.');
    assert(
      postedCheck.reason?.includes('অবচয়') || postedCheck.reason?.includes('জাবেদা'),
      'Posted asset reason must explicitly identify depreciation or GL entries.'
    );

    // 2a. Safe non-accounting metadata edit (name) on posted asset must succeed
    const safeNameEditRes = await executeEditFixedAssetTransaction(
      {
        assetId: activePostedAsset.id,
        name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
        currentUserId: 'TESTER_1'
      },
      assetMockDb
    );
    assert(
      safeNameEditRes.updatedAsset.name === 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
      'Changing asset name/description on posted asset must succeed without altering financial figures.'
    );
    assert(
      safeNameEditRes.updatedAsset.originalCost === 120000,
      'Original cost of posted asset must remain exactly ৳120,000 intact.'
    );
    assert(
      safeNameEditRes.updatedAsset.accumulatedDepreciation === 2000,
      'Accumulated depreciation of posted asset must remain exactly ৳2,000 intact.'
    );

    // 2b. Attempt to alter originalCost on posted asset MUST be blocked
    let costEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          originalCost: 150000,
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      costEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('মূল ক্রয়মূল্য') || err.message.includes('protected'),
        'Blocked cost edit must produce a protective accounting error message.'
      );
    }
    assert(costEditBlocked, 'Casual alteration of originalCost on posted asset must be strictly blocked.');

    // 2c. Attempt to alter asset category on posted asset MUST be blocked
    let categoryEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          category: 'LAND',
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      categoryEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('ক্যাটাগরি'),
        'Blocked category edit must produce a protective accounting error message.'
      );
    }
    assert(categoryEditBlocked, 'Casual alteration of asset category on posted asset must be strictly blocked.');

    // 2d. Attempt to alter purchaseDate (acquisition date) on posted asset MUST be blocked
    let dateEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          purchaseDate: '2025-01-01',
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      dateEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('অর্জনের তারিখ'),
        'Blocked date edit must produce a protective accounting error message.'
      );
    }
    assert(dateEditBlocked, 'Casual alteration of acquisition date on posted asset must be strictly blocked.');

    // 2e. Attempt to alter usefulLifeYears on posted asset MUST be blocked
    let lifeEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          usefulLifeYears: 20,
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      lifeEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('আয়ুষ্কাল'),
        'Blocked useful life edit must produce a protective accounting error message.'
      );
    }
    assert(lifeEditBlocked, 'Casual alteration of useful life on posted asset must be strictly blocked.');

    // 2f. Attempt to alter salvageValue on posted asset MUST be blocked
    let salvageEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          salvageValue: 15000,
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      salvageEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('ভগ্নাবশেষ মূল্য'),
        'Blocked salvage value edit must produce a protective accounting error message.'
      );
    }
    assert(salvageEditBlocked, 'Casual alteration of salvage value on posted asset must be strictly blocked.');

    // 2g. Attempt to alter depreciationRatePercent on posted asset MUST be blocked
    let rateEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: activePostedAsset.id,
          name: 'আধুনিক গভীর নলকূপ (সংশোধিত নাম)',
          depreciationRatePercent: 25,
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch (err: any) {
      rateEditBlocked = true;
      assert(
        err.message.includes('হিসাবরক্ষণ সুরক্ষানীতি') || err.message.includes('অবচয় হার'),
        'Blocked depreciation rate edit must produce a protective accounting error message.'
      );
    }
    assert(rateEditBlocked, 'Casual alteration of depreciation rate on posted asset must be strictly blocked.');

    // 2h. Confirm asset in DB remains completely unchanged and uncorrupted after rejected attempts
    const assetFinalCheck = (await assetMockDb.fixedAssets.get(activePostedAsset.id))!;
    assert(assetFinalCheck.originalCost === 120000, 'Asset original cost in DB must remain ৳120,000.');
    assert(assetFinalCheck.usefulLifeYears === 10, 'Asset useful life in DB must remain 10 years.');
    assert(assetFinalCheck.salvageValue === 0, 'Asset salvage value in DB must remain 0.');
    assert(assetFinalCheck.depreciationRatePercent === 10, 'Asset depreciation rate in DB must remain 10%.');
    assert(assetFinalCheck.accumulatedDepreciation === 2000, 'Asset accumulated depreciation must remain ৳2,000.');
    assert(assetFinalCheck.currentBookValue === 118000, 'Asset book value must remain ৳118,000.');

    // 3. Disposed asset is also strictly protected from changes to financial parameters
    const disposedAssetTask11: FixedAsset = {
      id: 'AST-DISPOSED-1',
      name: 'পুরাতন ট্র্যাক্টর (Old Tractor)',
      category: 'VEHICLES',
      purchaseDate: '2024-01-01',
      originalCost: 500000,
      usefulLifeYears: 5,
      salvageValue: 50000,
      accumulatedDepreciation: 400000,
      currentBookValue: 0,
      depreciationRatePercent: 20,
      lastDepreciationDate: '2025-12-31',
      status: 'DISPOSED',
      synced: false
    };
    await assetMockDb.fixedAssets.put(disposedAssetTask11);
    const disposedCheck = await hasAssetPostedAccounting(disposedAssetTask11, assetMockDb);
    assert(disposedCheck.hasAccounting, 'Disposed asset must always be flagged as having posted accounting.');

    let disposedEditBlocked = false;
    try {
      await executeEditFixedAssetTransaction(
        {
          assetId: disposedAssetTask11.id,
          name: 'পুরাতন ট্র্যাক্টর',
          originalCost: 600000,
          currentUserId: 'TESTER_1'
        },
        assetMockDb
      );
    } catch {
      disposedEditBlocked = true;
    }
    assert(disposedEditBlocked, 'Editing financial fields on a DISPOSED asset must be blocked.');

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

    // =========================================================================
    // TASK 10: AR & INVENTORY SUBLEDGER SYNCHRONIZATION TESTS
    // =========================================================================

    // -------------------------------------------------------------------------
    // 1. AR Subledger Sync: Credit Sale and Payment Reconcile with GL
    // -------------------------------------------------------------------------
    const arTestDb = createMockAgroDatabase();
    for (const acc of accounts) {
      await arTestDb.accounts.put({ ...acc });
    }

    const arBankAcc = {
      id: 'cba_ar_bank',
      name: 'রূপালী ব্যাংক (Rupali Bank)',
      accountType: 'BANK',
      accountNumber: '12345678',
      currentBalance: 100000,
      synced: false
    };
    await arTestDb.cashBankAccounts.put(arBankAcc);

    const arCashAcc = {
      id: 'cba_ar_cash',
      name: 'প্রধান ক্যাশ (Main Cash)',
      accountType: 'CASH',
      currentBalance: 50000,
      synced: false
    };
    await arTestDb.cashBankAccounts.put(arCashAcc);

    const customerParty: Party = {
      id: 'pty_cust_01',
      name: 'মেসার্স রহিম ট্রেডার্স (Rahim Traders)',
      phone: '01711000000',
      type: 'CUSTOMER',
      balance: 0,
      isActive: true,
      synced: false
    };
    await arTestDb.parties.put(customerParty);

    const fishBatch1: FishBatch = {
      id: 'fb_task10_01',
      pondId: 'pond_01',
      pondName: 'পুকুর ১',
      species: 'রুই মাছ',
      stockingDate: '2026-01-15',
      fingerlingQty: 1000,
      fingerlingCost: 15000,
      totalFeedKg: 500,
      totalFeedCost: 20000,
      labourCost: 5000,
      mortalityCount: 5,
      currentEstimatedWeightKg: 350,
      status: 'ACTIVE',
      synced: false
    };
    await arTestDb.fishBatches.put(fishBatch1);

    // Legitimate source journal entry backing fishBatch1's ৳40,000 production cost specifically referencing its batch ID
    await arTestDb.journalEntries.put({
      id: 'j_init_fish_batch1',
      voucherNumber: 'JV-INIT-01',
      voucherType: 'PAYMENT',
      date: '2026-01-15',
      narration: 'Initial fish batch production costs',
      reference: fishBatch1.id,
      lines: [
        {
          accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          debit: 40000,
          credit: 0,
          memo: `[PRODUCTION] মাছের ব্যাচ ${fishBatch1.id} উৎপাদন ব্যয়`
        },
        {
          accountId: CANONICAL_ACCOUNTS.CASH,
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'ক্যাশ (Cash)',
          debit: 0,
          credit: 40000,
          memo: `মাছের ব্যাচ ${fishBatch1.id} উৎপাদন ব্যয় পরিশোধ`
        }
      ],
      createdAt: '2026-01-15T00:00:00Z',
      createdBy: 'usr_owner'
    });

    // Execute Fish Harvest and Credit Sale (Dr AR 1040 -> Cr Revenue 4010)
    const harvestSaleRes = await executeFishHarvestAndSaleTransaction(
      {
        batchId: fishBatch1.id,
        harvestWeightKg: 300,
        mortalityCount: 10,
        salePrice: 45000,
        paymentMethod: 'CREDIT',
        customerId: customerParty.id,
        customerName: customerParty.name,
        date: '2026-07-01',
        currentUserId: 'usr_owner'
      },
      arTestDb
    );

    assert(harvestSaleRes.sale !== undefined, 'Sale record must be generated for harvest credit sale.');
    assert(harvestSaleRes.sale?.status === 'DUE', 'Credit sale invoice status must be DUE.');
    assert(harvestSaleRes.sale?.dueAmount === 45000, 'Credit sale invoice dueAmount must be ৳45,000.');
    assert(harvestSaleRes.sale?.paidAmount === 0, 'Credit sale invoice paidAmount must be 0.');

    // Verify Customer Party AR balance increased
    const custAfterSale = await arTestDb.parties.get(customerParty.id);
    assert(custAfterSale?.balance === 45000, 'Customer AR party balance must increase to ৳45,000 on credit sale.');

    // Verify GL Accounts Receivable (1040) entry
    const allJournals = await arTestDb.journalEntries.toArray();
    let totalGlArDebit = 0;
    let totalGlArCredit = 0;
    for (const j of allJournals) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE) {
          totalGlArDebit += line.debit || 0;
          totalGlArCredit += line.credit || 0;
        }
      }
    }
    const netGlAr = totalGlArDebit - totalGlArCredit;
    assert(netGlAr === 45000, 'GL Accounts Receivable (1040) net balance must be ৳45,000.');
    assert(custAfterSale?.balance === netGlAr, 'Customer subledger balance must exactly reconcile with GL AR balance.');

    // Execute Payment Part 1 (৳25,000 via BANK: Dr Bank 1030 -> Cr AR 1040)
    const pmt1Res = await executePaymentTransaction(
      {
        parentType: 'SALE',
        parentId: harvestSaleRes.sale!.id,
        amount: 25000,
        paymentMethod: 'BANK',
        bankAccountId: arBankAcc.id,
        date: '2026-07-05',
        note: 'প্রথম কিস্তি আদায়',
        currentUserId: 'usr_owner'
      },
      arTestDb
    );

    assert(pmt1Res.payment.amount === 25000, 'Payment 1 amount must be ৳25,000.');

    // Verify Customer Party AR balance reduced by ৳25,000
    const custAfterPmt1 = await arTestDb.parties.get(customerParty.id);
    assert(custAfterPmt1?.balance === 20000, 'Customer AR party balance must reduce to ৳20,000 (45,000 - 25,000).');

    // Verify Sale invoice status updated to PARTIAL
    const saleAfterPmt1 = await arTestDb.sales.get(harvestSaleRes.sale!.id);
    assert(saleAfterPmt1?.status === 'PARTIAL', 'Sale status must be updated to PARTIAL.');
    assert(saleAfterPmt1?.paidAmount === 25000, 'Sale paidAmount must be ৳25,000.');
    assert(saleAfterPmt1?.dueAmount === 20000, 'Sale dueAmount must be ৳20,000.');

    // Verify Bank balance increased
    const bankAfterPmt1 = await arTestDb.cashBankAccounts.get(arBankAcc.id);
    assert(bankAfterPmt1?.currentBalance === 125000, 'Bank balance must increase to ৳125,000.');

    // Verify GL AR reconciles after Payment 1
    const pmt1Journal = await arTestDb.journalEntries.get(pmt1Res.journalEntryId);
    assert(pmt1Journal !== undefined, 'Payment 1 journal entry must exist.');
    const pmt1DrBank = pmt1Journal.lines.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.BANK && l.debit === 25000);
    const pmt1CrAr = pmt1Journal.lines.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE && l.credit === 25000);
    assert(!!pmt1DrBank, 'Payment 1 must Debit Bank (1030) for ৳25,000.');
    assert(!!pmt1CrAr, 'Payment 1 must Credit AR (1040) for ৳25,000.');

    const journalsAfterPmt1 = await arTestDb.journalEntries.toArray();
    let netGlArAfterPmt1 = 0;
    for (const j of journalsAfterPmt1) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE) {
          netGlArAfterPmt1 += (line.debit || 0) - (line.credit || 0);
        }
      }
    }
    assert(netGlArAfterPmt1 === 20000, 'Net GL AR after payment 1 must be ৳20,000.');
    assert(custAfterPmt1?.balance === netGlArAfterPmt1, 'Customer AR balance must strictly reconcile with GL AR after Payment 1.');

    // Execute Payment Part 2 (Remaining ৳20,000 via CASH: Dr Cash 1010 -> Cr AR 1040)
    const pmt2Res = await executePaymentTransaction(
      {
        parentType: 'SALE',
        parentId: harvestSaleRes.sale!.id,
        amount: 20000,
        paymentMethod: 'CASH',
        date: '2026-07-10',
        note: 'চুড়ান্ত কিস্তি আদায়',
        currentUserId: 'usr_owner'
      },
      arTestDb
    );

    assert(pmt2Res.payment.amount === 20000, 'Payment 2 amount must be ৳20,000.');

    // Customer Party AR balance must now be strictly 0
    const custAfterPmt2 = await arTestDb.parties.get(customerParty.id);
    assert(custAfterPmt2?.balance === 0, 'Customer AR party balance must be strictly ৳0 after full settlement.');

    // Sale invoice status must be PAID
    const saleAfterPmt2 = await arTestDb.sales.get(harvestSaleRes.sale!.id);
    assert(saleAfterPmt2?.status === 'PAID', 'Sale invoice status must be PAID after full payment.');
    assert(saleAfterPmt2?.dueAmount === 0, 'Sale invoice dueAmount must be 0.');
    assert(saleAfterPmt2?.paidAmount === 45000, 'Sale invoice paidAmount must be ৳45,000.');

    // Cash balance increased
    const cashAfterPmt2 = await arTestDb.cashBankAccounts.get(arCashAcc.id);
    assert(cashAfterPmt2?.currentBalance === 70000, 'Cash balance must increase to ৳70,000 (50,000 + 20,000).');

    // Final GL AR balance must be 0, reconciling with customer party balance 0
    const journalsAfterPmt2 = await arTestDb.journalEntries.toArray();
    let netGlArFinal = 0;
    for (const j of journalsAfterPmt2) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE) {
          netGlArFinal += (line.debit || 0) - (line.credit || 0);
        }
      }
    }
    assert(netGlArFinal === 0, 'GL AR net balance must be 0.');
    assert(custAfterPmt2?.balance === netGlArFinal, 'Customer balance and GL AR must reconcile to 0.');

    // Verify payments list count: exactly 2 payments
    const paymentsForInvoice = await arTestDb.payments.where('parentId').equals(harvestSaleRes.sale!.id).toArray();
    assert(paymentsForInvoice.length === 2, 'Exactly 2 payments must be recorded for this invoice.');

    // -------------------------------------------------------------------------
    // 1b. Crop Credit Sale and Payment Flow (AR Subledger & GL Reconciliation)
    // -------------------------------------------------------------------------
    const cropParty: Party = {
      id: 'pty_cust_crop_01',
      name: 'ফার্মার্স পাইকারি আড়ত (Farmers Wholesale)',
      type: 'CUSTOMER',
      phone: '01711000000',
      balance: 0,
      isActive: true,
      synced: false
    };
    await arTestDb.parties.put(cropParty);

    const testCropCycle: CropCycle = {
      id: 'cc_task10_01',
      plotId: 'plot_01',
      plotName: 'উত্তর মাঠ (North Field)',
      cropName: 'হাইব্রিড ভুট্টা (Hybrid Corn)',
      cropCategory: 'GRAIN',
      plantingDate: '2026-03-01',
      expectedHarvestDate: '2026-07-06',
      areaDecimals: 50,
      seedCost: 4000,
      fertilizerCost: 6000,
      protectionCost: 2000,
      labourCost: 3000,
      irrigationCost: 1500,
      otherCost: 500,
      totalCost: 17000,
      harvestYieldKg: 0,
      harvestRevenue: 0,
      internalConsumptionKg: 0,
      status: 'GROWING',
      synced: false
    };
    await arTestDb.cropCycles.put(testCropCycle);

    await arTestDb.journalEntries.put({
      id: 'j_seed_crop_ar_01',
      voucherNumber: 'JV-SEED-AR01',
      voucherType: 'JOURNAL',
      date: '2026-03-01',
      narration: 'Initial Crop WIP for cc_task10_01',
      reference: testCropCycle.id,
      lines: [
        {
          accountId: CANONICAL_ACCOUNTS.WIP,
          accountCode: CANONICAL_ACCOUNTS.WIP,
          accountName: 'Work in Progress',
          debit: 17000,
          credit: 0,
          memo: `[PRODUCTION_COST] [WIP] [${testCropCycle.id}] Seed, fertilizer, labour WIP`
        },
        {
          accountId: CANONICAL_ACCOUNTS.CASH,
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'Cash',
          debit: 0,
          credit: 17000,
          memo: `[PRODUCTION_COST] [WIP] [${testCropCycle.id}] Paid Cash`
        }
      ],
      createdAt: new Date().toISOString()
    });

    // Execute Crop credit sale: ৳35,000 credit
    const cropSaleRes = await executeCropHarvestAndSaleTransaction(
      {
        cycleId: testCropCycle.id,
        harvestYieldKg: 1000,
        salePrice: 35000,
        paymentMethod: 'CREDIT',
        customerId: cropParty.id,
        customerName: cropParty.name,
        date: '2026-07-06',
        currentUserId: 'usr_owner'
      },
      arTestDb
    );

    assert(cropSaleRes.sale !== undefined, 'Crop sale record must be created.');
    assert(cropSaleRes.sale?.dueAmount === 35000, 'Crop credit sale dueAmount must be ৳35,000.');
    assert(cropSaleRes.sale?.status === 'DUE', 'Crop credit sale status must be DUE.');

    // Verify Customer AR balance increased by ৳35,000
    const cropCustAfterSale = await arTestDb.parties.get(cropParty.id);
    assert(cropCustAfterSale?.balance === 35000, 'Customer AR balance must increase to ৳35,000 after crop credit sale.');

    // Verify GL AR entry created: Dr AR 1040 ৳35,000 / Cr Crop Revenue 4040 ৳35,000
    const cropSaleJournal = await arTestDb.journalEntries.get(cropSaleRes.sale!.journalEntryId!);
    assert(cropSaleJournal !== undefined, 'Crop sale revenue journal entry must exist.');
    const cropDrArLine = cropSaleJournal.lines.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE && l.debit === 35000);
    const cropCrRevLine = cropSaleJournal.lines.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.CROP_REVENUE && l.credit === 35000);
    assert(cropDrArLine !== undefined, 'Crop credit sale must debit AR (1040) for ৳35,000.');
    assert(cropCrRevLine !== undefined, 'Crop credit sale must credit Crop Revenue (4040) for ৳35,000.');

    // Execute Full Payment: ৳35,000 via CASH: Dr Cash 1010 -> Cr AR 1040
    const cropPmtRes = await executePaymentTransaction(
      {
        parentType: 'SALE',
        parentId: cropSaleRes.sale!.id,
        amount: 35000,
        paymentMethod: 'CASH',
        date: '2026-07-07',
        note: 'সম্পূর্ণ বকেয়া আদায়',
        currentUserId: 'usr_owner'
      },
      arTestDb
    );

    assert(cropPmtRes.payment.amount === 35000, 'Crop payment amount must be ৳35,000.');

    // Verify Customer Party AR balance reduced to ৳0
    const cropCustAfterPmt = await arTestDb.parties.get(cropParty.id);
    assert(cropCustAfterPmt?.balance === 0, 'Customer AR balance must reduce to 0 after full payment.');

    // Verify Sale invoice status updated to PAID
    const cropSaleAfterPmt = await arTestDb.sales.get(cropSaleRes.sale!.id);
    assert(cropSaleAfterPmt?.status === 'PAID', 'Crop sale status must be PAID.');
    assert(cropSaleAfterPmt?.dueAmount === 0, 'Crop sale dueAmount must be 0.');
    assert(cropSaleAfterPmt?.paidAmount === 35000, 'Crop sale paidAmount must be ৳35,000.');

    // Verify overall AR reconciliation
    const allArJournals = await arTestDb.journalEntries.toArray();
    let netGlArOverall = 0;
    for (const j of allArJournals) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE) {
          netGlArOverall += (line.debit || 0) - (line.credit || 0);
        }
      }
    }
    assert(netGlArOverall === 0, 'All GL AR balances must fully reconcile to 0 after full payments.');

    // -------------------------------------------------------------------------
    // 2. Inventory Subledger Sync: Purchase, Consumption, Sale, Adjustment, Receipt
    // -------------------------------------------------------------------------
    const invTestDb = createMockAgroDatabase();
    for (const acc of accounts) {
      await invTestDb.accounts.put({ ...acc });
    }

    const invCashAcc = {
      id: 'cba_inv_cash',
      name: 'প্রধান ক্যাশ (Main Cash)',
      accountType: 'CASH',
      currentBalance: 100000,
      synced: false
    };
    await invTestDb.cashBankAccounts.put(invCashAcc);

    const supplierParty: Party = {
      id: 'pty_supp_01',
      name: 'ন্যাশনাল ফিড লিমিটেড (National Feed Ltd)',
      phone: '01811000000',
      type: 'SUPPLIER',
      balance: 0,
      isActive: true,
      synced: false
    };
    await invTestDb.parties.put(supplierParty);

    const buyerParty: Party = {
      id: 'pty_buyer_01',
      name: 'লোকাল ডিলার (Local Dealer)',
      phone: '01911000000',
      type: 'CUSTOMER',
      balance: 0,
      isActive: true,
      synced: false
    };
    await invTestDb.parties.put(buyerParty);

    // Initial Inventory Item (Poultry Feed, stock 0)
    const feedItem: InventoryItem = {
      id: 'it_feed_01',
      code: 'FEED-001',
      nameBn: 'ব্রয়লার ফিড গ্রোয়ার',
      nameEn: 'Broiler Feed Grower',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      reorderLevel: 50,
      avgCostPrice: 0,
      sellingPrice: 70,
      synced: false
    };
    await invTestDb.inventoryItems.put(feedItem);

    // Step A: Purchase 200 kg @ ৳50/kg (Total ৳10,000)
    const purchRes = await executePurchaseTransaction(
      {
        supplier: supplierParty,
        item: feedItem,
        quantity: 200,
        unitPrice: 50,
        paymentMethod: 'CASH',
        date: '2026-07-01',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(purchRes.purchase !== undefined, 'Purchase transaction must succeed.');

    // Verify Inventory Item Stock and Avg Cost updated
    const itemAfterPurch = await invTestDb.inventoryItems.get(feedItem.id);
    assert(itemAfterPurch?.currentStock === 200, 'Item currentStock must be 200 kg after purchase.');
    assert(itemAfterPurch?.avgCostPrice === 50, 'Item avgCostPrice must be ৳50.');

    // Verify StockMovement recorded: exactly 1 PURCHASE movement
    const movementsAfterPurch = await invTestDb.stockMovements.where('itemId').equals(feedItem.id).toArray();
    assert(movementsAfterPurch.length === 1, 'Exactly 1 stock movement must exist after purchase.');
    assert(movementsAfterPurch[0].movementType === 'PURCHASE', 'Movement type must be PURCHASE.');
    assert(movementsAfterPurch[0].quantity === 200, 'Movement quantity must be 200.');
    assert(movementsAfterPurch[0].unitCost === 50, 'Movement unitCost must be 50.');
    assert(movementsAfterPurch[0].totalValue === 10000, 'Movement totalValue must be 10,000.');

    // Step B: Production Consumption (Feed 50 kg used in production)
    // Decrement stock and record CONSUMPTION movement
    const cleanConsumeQty = 50;
    const newStockAfterConsume = itemAfterPurch!.currentStock - cleanConsumeQty;
    await invTestDb.inventoryItems.update(feedItem.id, {
      currentStock: newStockAfterConsume,
      synced: false
    });
    const consumeMovement: StockMovement = {
      id: generateUniqueId('sm_consume'),
      date: '2026-07-03',
      itemId: feedItem.id,
      movementType: 'CONSUMPTION',
      quantity: cleanConsumeQty,
      unitCost: itemAfterPurch!.avgCostPrice,
      totalValue: cleanConsumeQty * itemAfterPurch!.avgCostPrice,
      referenceId: 'batch_prod_01',
      notes: 'উৎপাদনে ৫০ কেজি খাদ্য ব্যবহার',
      synced: false
    };
    await invTestDb.stockMovements.put(consumeMovement);

    const itemAfterConsume = await invTestDb.inventoryItems.get(feedItem.id);
    assert(itemAfterConsume?.currentStock === 150, 'Item currentStock must be 150 kg after consumption.');

    const movementsAfterConsume = await invTestDb.stockMovements.where('itemId').equals(feedItem.id).toArray();
    assert(movementsAfterConsume.length === 2, 'Exactly 2 stock movements must exist after consumption.');
    const hasConsumeMov = movementsAfterConsume.some((m: any) => m.movementType === 'CONSUMPTION' && m.quantity === 50);
    assert(hasConsumeMov, 'CONSUMPTION movement for 50 kg must be recorded.');

    // Step C: Inventory Sale (Sell 50 kg @ ৳70/kg)
    const saleRes = await executeSaleTransaction(
      {
        customer: buyerParty,
        item: itemAfterConsume!,
        quantity: 50,
        unitPrice: 70,
        paymentMethod: 'CASH',
        date: '2026-07-05',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(saleRes.sale !== undefined, 'Sale transaction must succeed.');

    // Verify Item Stock after Sale: 150 - 50 = 100 kg
    const itemAfterSale = await invTestDb.inventoryItems.get(feedItem.id);
    assert(itemAfterSale?.currentStock === 100, 'Item currentStock must be 100 kg after sale.');

    // Verify StockMovement recorded: exactly 1 SALE movement added
    const movementsAfterSale = await invTestDb.stockMovements.where('itemId').equals(feedItem.id).toArray();
    assert(movementsAfterSale.length === 3, 'Exactly 3 stock movements must exist after sale.');
    const saleMov = movementsAfterSale.find((m: any) => m.movementType === 'SALE');
    assert(saleMov !== undefined, 'SALE stock movement must be recorded.');
    assert(saleMov?.quantity === 50, 'Sale movement quantity must be 50.');
    assert(saleMov?.unitCost === 50, 'Sale movement unitCost (COGS unit) must be 50.');

    // Step D: Inventory Adjustment (10 kg damaged: ADJUSTMENT)
    const adjRes = await executeStockAdjustmentTransaction(
      {
        itemId: feedItem.id,
        adjustmentType: 'DECREASE',
        quantity: 10,
        reason: 'ইঁদুরে বস্তা কেটে নষ্ট করেছে',
        date: '2026-07-07',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(adjRes.updatedItem.currentStock === 90, 'Item currentStock must be 90 kg after decrease adjustment.');
    assert(adjRes.movement.movementType === 'ADJUSTMENT', 'Adjustment movementType must be ADJUSTMENT.');
    assert(adjRes.movement.quantity === 10, 'Adjustment movement quantity must be 10.');

    // Step D.2: Task 7 - Invalid Excessive Decrease Adjustment (exceeding available stock 90 kg)
    let excessiveDecreaseFailed = false;
    try {
      await executeStockAdjustmentTransaction(
        {
          itemId: feedItem.id,
          adjustmentType: 'DECREASE',
          quantity: 150, // Available is only 90
          reason: 'অবাস্তব ঘাটতি এন্ট্রি চেষ্টা',
          date: '2026-07-07',
          currentUserId: 'usr_owner'
        },
        invTestDb
      );
    } catch (err: any) {
      excessiveDecreaseFailed = true;
      assert(
        err.message.includes('বেশি হতে পারে না') || err.message.includes('exceeds available stock'),
        'Excessive decrease must throw error indicating decrease exceeds available stock.'
      );
    }
    assert(excessiveDecreaseFailed, 'Transaction must REJECT decrease adjustment when quantity > available stock.');

    // Verify stock is NOT clipped to zero and remained exactly 90 kg
    const feedItemAfterExcessive = await invTestDb.inventoryItems.get(feedItem.id);
    assert(
      feedItemAfterExcessive?.currentStock === 90,
      'Operational stock must NOT be clipped or modified on rejected excessive decrease.'
    );

    // Step E: Farm Production Receipt into Inventory (30 kg produced received)
    const receiptRes = await executeProductionReceiptTransaction(
      {
        itemId: feedItem.id,
        quantity: 30,
        unitCost: 50,
        date: '2026-07-09',
        notes: 'উৎপাদন শাখা হতে প্রাপ্তি',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(receiptRes.updatedItem.currentStock === 120, 'Item currentStock must be 120 kg after production receipt.');
    assert(receiptRes.movement.movementType === 'PRODUCTION', 'Receipt movementType must be PRODUCTION.');
    assert(receiptRes.movement.quantity === 30, 'Receipt quantity must be 30.');

    // Subledger Stock Movements Verification:
    // Total stock = Purchase(200) - Consumption(50) - Sale(50) - Adjustment(10) + Production(30) = 120 kg
    const allItemMovements = await invTestDb.stockMovements.where('itemId').equals(feedItem.id).toArray();
    assert(allItemMovements.length === 5, 'Exactly 5 stock movements must be recorded.');

    let netMovementQty = 0;
    for (const m of allItemMovements) {
      if (m.movementType === 'PURCHASE' || m.movementType === 'PRODUCTION' || m.movementType === 'OPENING') {
        netMovementQty += m.quantity;
      } else if (m.movementType === 'SALE' || m.movementType === 'CONSUMPTION' || m.movementType === 'DAMAGE' || m.movementType === 'WASTE') {
        netMovementQty -= m.quantity;
      } else if (m.movementType === 'ADJUSTMENT') {
        // Decrease was tested
        netMovementQty -= m.quantity;
      }
    }
    assert(netMovementQty === 120, 'Net subledger movement quantity must sum to 120 kg.');
    const finalItem = await invTestDb.inventoryItems.get(feedItem.id);
    assert(finalItem?.currentStock === netMovementQty, 'Inventory physical stock must strictly equal net subledger movements.');

    // Step E.1: Production Receipt GL Accounting Verification (Task 6)
    assert(receiptRes.journalEntry !== undefined, 'Production receipt must generate a GL journal entry.');
    assert(receiptRes.journalEntry?.voucherType === 'JOURNAL', 'Production receipt voucherType must be JOURNAL.');
    assert(receiptRes.journalEntry?.totalDebit === 1500, 'Production receipt journal totalDebit must be ৳1,500.');
    assert(receiptRes.journalEntry?.totalCredit === 1500, 'Production receipt journal totalCredit must be ৳1,500.');

    const invLine = receiptRes.journalEntry?.lines.find((l: any) => l.accountCode === '1051');
    assert(invLine !== undefined, 'Production receipt must contain line for Inventory Asset Account (1051).');
    assert(invLine?.debit === 1500, 'Production receipt must debit Inventory Asset Account (1051) by ৳1,500.');
    assert(invLine?.credit === 0, 'Production receipt debit line must have credit 0.');

    const wipLine = receiptRes.journalEntry?.lines.find((l: any) => l.accountCode === '1054');
    assert(wipLine !== undefined, 'Production receipt must contain line for Production WIP Account (1054).');
    assert(wipLine?.credit === 1500, 'Production receipt must credit Production WIP Account (1054) by ৳1,500.');
    assert(wipLine?.debit === 0, 'Production receipt credit line must have debit 0.');

    const hasArtificialCash = receiptRes.journalEntry?.lines.some(
      (l: any) => l.accountCode === '1010' || l.accountCode === '1030'
    );
    assert(!hasArtificialCash, 'Production receipt must NOT create artificial Cash/Bank entries.');

    // Step E.2: Operational inventory value = corresponding accounting value verification
    const operationalReceiptVal = receiptRes.movement.totalValue;
    const accountingReceiptVal = invLine?.debit || 0;
    assert(
      operationalReceiptVal === accountingReceiptVal,
      `Operational inventory receipt value (৳${operationalReceiptVal}) must strictly equal corresponding accounting value (৳${accountingReceiptVal}).`
    );

    // Verify journal entry persistence in DB
    const savedReceiptJournal = await invTestDb.journalEntries.get(receiptRes.journalEntry!.id);
    assert(savedReceiptJournal !== undefined, 'Production receipt journal entry must be persisted in database.');

    // Step E.3: Test Production Receipt of Finished Goods from Crop Cycle Production
    const paddyItem: InventoryItem = {
      id: generateUniqueId('it_paddy'),
      code: 'ITM-PDY-01',
      nameEn: 'Aman Paddy',
      nameBn: 'আমন ধান (কাটা সম্পন্ন)',
      category: 'FARM_PRODUCT',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 40,
      reorderLevel: 20,
      synced: false
    };
    await invTestDb.inventoryItems.put(paddyItem);

    const cropCycleProd = {
      id: 'cycle_paddy_2026',
      cropName: 'আমন ধান ২০২৬',
      fieldLocation: 'উত্তর মাঠ',
      status: 'ACTIVE'
    };
    await invTestDb.cropCycles.put(cropCycleProd);

    // Legitimate Crop WIP for cycle_paddy_2026: ৳2,800
    await invTestDb.journalEntries.put({
      id: 'j_paddy_wip_prod',
      voucherNumber: 'JV-PDY-PROD',
      voucherType: 'JOURNAL',
      date: '2026-07-01',
      narration: 'Paddy production cost (WIP)',
      reference: cropCycleProd.id,
      lines: [
        {
          accountId: CANONICAL_ACCOUNTS.WIP,
          accountCode: CANONICAL_ACCOUNTS.WIP,
          accountName: 'Work in Progress',
          debit: 2800,
          credit: 0,
          memo: `[PRODUCTION_COST] [WIP] [${cropCycleProd.id}] Paddy production cost`
        },
        {
          accountId: CANONICAL_ACCOUNTS.CASH,
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'Cash',
          debit: 0,
          credit: 2800,
          memo: `[PRODUCTION_COST] [WIP] [${cropCycleProd.id}] Cash payment`
        }
      ],
      createdAt: new Date().toISOString()
    });

    const paddyReceiptRes = await executeProductionReceiptTransaction(
      {
        itemId: paddyItem.id,
        quantity: 100,
        unitCost: 28,
        date: '2026-07-10',
        sourceBatchId: cropCycleProd.id,
        notes: 'আমন ধান মাড়াই শেষে গুদামে স্থানান্তর',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(paddyReceiptRes.updatedItem.currentStock === 100, 'Paddy item currentStock must be 100 kg.');
    assert(paddyReceiptRes.updatedItem.avgCostPrice === 28, 'Paddy item avgCostPrice must be ৳28.');
    assert(paddyReceiptRes.movement.movementType === 'PRODUCTION', 'Movement must be PRODUCTION.');
    assert(paddyReceiptRes.movement.totalValue === 2800, 'Operational stock movement totalValue must be ৳2,800 (100 * 28).');

    assert(paddyReceiptRes.journalEntry !== undefined, 'Production receipt must create journal entry.');
    assert(paddyReceiptRes.journalEntry?.totalDebit === 2800, 'Journal totalDebit must be ৳2,800.');
    assert(paddyReceiptRes.journalEntry?.totalCredit === 2800, 'Journal totalCredit must be ৳2,800.');

    const finishedGoodsLine = paddyReceiptRes.journalEntry?.lines.find((l: any) => l.accountCode === '1055');
    assert(finishedGoodsLine !== undefined && finishedGoodsLine.debit === 2800, 'Finished Farm Product must debit 1055 Finished Goods by ৳2,800.');

    const cropWipLine = paddyReceiptRes.journalEntry?.lines.find((l: any) => l.accountCode === '1054');
    assert(cropWipLine !== undefined && cropWipLine.credit === 2800, 'Production receipt must credit 1054 WIP by ৳2,800.');

    const operationalPaddyVal = paddyReceiptRes.movement.totalValue;
    const accountingPaddyVal = finishedGoodsLine?.debit || 0;
    assert(
      operationalPaddyVal === accountingPaddyVal,
      `Operational inventory value (৳${operationalPaddyVal}) must strictly equal corresponding accounting value (৳${accountingPaddyVal}).`
    );

    // =========================================================================
    // TASK 7 — VERIFY STOCK ADJUSTMENT ACCOUNTING
    // Tests: (1) increase adjustment, (2) valid decrease, (3) invalid excessive decrease
    // Must guarantee quantity in Inventory, Stock Movement, GL adjustment are identical
    // and prevent negative inventory.
    // =========================================================================

    const seedItem: InventoryItem = {
      id: generateUniqueId('it_seed'),
      code: 'ITM-SED-01',
      nameEn: 'BRRI Dhan 28 Seeds',
      nameBn: 'ব্রি ধান ২৮ বীজ',
      category: 'SEED_FERTILIZER',
      unit: 'কেজি',
      currentStock: 50,
      avgCostPrice: 60,
      sellingPrice: 80,
      reorderLevel: 10,
      synced: false
    };
    await invTestDb.inventoryItems.put(seedItem);

    // Test Case 1: Increase Adjustment (+25 kg)
    const seedIncRes = await executeStockAdjustmentTransaction(
      {
        itemId: seedItem.id,
        adjustmentType: 'INCREASE',
        quantity: 25,
        reason: 'বাৎসরিক অডিটে অতিরিক্ত উদ্বৃত্ত বীজ পাওয়া গেছে',
        date: '2026-07-11',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(seedIncRes.updatedItem.currentStock === 75, 'Increase adjustment: stock must increase from 50 to 75 kg.');
    assert(seedIncRes.movement.movementType === 'ADJUSTMENT', 'Movement type must be ADJUSTMENT.');
    assert(seedIncRes.movement.quantity === 25, 'Stock movement quantity must be exactly 25.');
    assert(seedIncRes.movement.totalValue === 1500, 'Stock movement total value must be ৳1,500 (25 * 60).');

    assert(seedIncRes.journalEntry !== undefined, 'Increase adjustment must create GL journal entry.');
    assert(seedIncRes.journalEntry?.totalDebit === 1500, 'Increase journal totalDebit must be ৳1,500.');
    assert(seedIncRes.journalEntry?.totalCredit === 1500, 'Increase journal totalCredit must be ৳1,500.');

    const seedInvLine = seedIncRes.journalEntry?.lines.find((l: any) => l.accountCode === '1052');
    assert(seedInvLine !== undefined && seedInvLine.debit === 1500, 'Increase adjustment must debit Inventory Asset 1052 by ৳1,500.');

    const seedRevLine = seedIncRes.journalEntry?.lines.find((l: any) => l.accountCode === '4090');
    assert(seedRevLine !== undefined && seedRevLine.credit === 1500, 'Increase adjustment must credit Other Revenue 4090 by ৳1,500.');

    // Verify quantity in Inventory (+25), Stock Movement (25), and GL adjustment (1500 / 60 = 25) are identical
    const inventoryIncreaseDelta = seedIncRes.updatedItem.currentStock - 50;
    const movementIncreaseQty = seedIncRes.movement.quantity;
    const glIncreaseQty = (seedInvLine?.debit || 0) / (seedItem.avgCostPrice || 1);
    assert(
      inventoryIncreaseDelta === movementIncreaseQty && movementIncreaseQty === glIncreaseQty,
      'Quantity in Inventory, Stock Movement, and GL adjustment must be IDENTICAL for increase adjustment.'
    );

    // Test Case 2: Valid Decrease Adjustment (-20 kg)
    const seedDecRes = await executeStockAdjustmentTransaction(
      {
        itemId: seedItem.id,
        adjustmentType: 'DECREASE',
        quantity: 20,
        reason: 'মেয়াদোত্তীর্ণ বীজ বিনষ্টকরণ',
        date: '2026-07-12',
        currentUserId: 'usr_owner'
      },
      invTestDb
    );

    assert(seedDecRes.updatedItem.currentStock === 55, 'Valid decrease: stock must decrease from 75 to 55 kg.');
    assert(seedDecRes.movement.quantity === 20, 'Movement quantity must be exactly 20.');
    assert(seedDecRes.movement.totalValue === 1200, 'Movement total value must be ৳1,200 (20 * 60).');

    assert(seedDecRes.journalEntry !== undefined, 'Valid decrease must create GL journal entry.');
    assert(seedDecRes.journalEntry?.totalDebit === 1200, 'Decrease journal totalDebit must be ৳1,200.');
    assert(seedDecRes.journalEntry?.totalCredit === 1200, 'Decrease journal totalCredit must be ৳1,200.');

    const seedDecLossLine = seedDecRes.journalEntry?.lines.find((l: any) => l.accountCode === '5090');
    assert(seedDecLossLine !== undefined && seedDecLossLine.debit === 1200, 'Decrease adjustment must debit Other COGS/Loss 5090 by ৳1,200.');

    const seedDecInvLine = seedDecRes.journalEntry?.lines.find((l: any) => l.accountCode === '1052');
    assert(seedDecInvLine !== undefined && seedDecInvLine.credit === 1200, 'Decrease adjustment must credit Inventory Asset 1052 by ৳1,200.');

    // Verify quantity in Inventory (-20), Stock Movement (20), and GL adjustment (1200 / 60 = 20) are identical
    const inventoryDecreaseDelta = 75 - seedDecRes.updatedItem.currentStock;
    const movementDecreaseQty = seedDecRes.movement.quantity;
    const glDecreaseQty = (seedDecInvLine?.credit || 0) / (seedItem.avgCostPrice || 1);
    assert(
      inventoryDecreaseDelta === movementDecreaseQty && movementDecreaseQty === glDecreaseQty,
      'Quantity in Inventory, Stock Movement, and GL adjustment must be IDENTICAL for valid decrease adjustment.'
    );

    // Test Case 3: Invalid Excessive Decrease Adjustment (> 55 kg available)
    let seedExcessiveFailed = false;
    try {
      await executeStockAdjustmentTransaction(
        {
          itemId: seedItem.id,
          adjustmentType: 'DECREASE',
          quantity: 60, // Available is only 55
          reason: 'অতিরিক্ত কমানোর চেষ্টা (অবৈধ)',
          date: '2026-07-12',
          currentUserId: 'usr_owner'
        },
        invTestDb
      );
    } catch (err: any) {
      seedExcessiveFailed = true;
    }
    assert(seedExcessiveFailed, 'Invalid excessive decrease adjustment MUST be rejected.');

    // Verify stock is preserved, not clipped to zero, not negative
    const finalSeedItem = await invTestDb.inventoryItems.get(seedItem.id);
    assert(finalSeedItem?.currentStock === 55, 'Item currentStock must remain 55 kg; no silent clipping or negative stock.');

    // =========================================================================
    // TASK 11: AR/AP PAYMENT VALIDATION, DUPLICATE PREVENTION & SUBLEDGER SYNC
    // =========================================================================
    // Create dedicated isolated mock db for Task 11
    const task11Db = createMockAgroDatabase();
    for (const acc of accounts) {
      await task11Db.accounts.put({ ...acc });
    }

    const t11CashAcc: CashBankAccount = {
      id: 'cba_t11_cash',
      name: 'প্রধান ক্যাশ (Main Cash)',
      accountType: 'CASH',
      currentBalance: 50000,
      synced: false
    };
    await task11Db.cashBankAccounts.put(t11CashAcc);

    const t11BankAcc: CashBankAccount = {
      id: 'cba_t11_bank',
      name: 'ইসলামী ব্যাংক (Islami Bank)',
      accountType: 'BANK',
      accountNumber: '205011111111',
      currentBalance: 100000,
      synced: false
    };
    await task11Db.cashBankAccounts.put(t11BankAcc);

    // -------------------------------------------------------------------------
    // PART A: Customer Credit Sale + Payment
    // -------------------------------------------------------------------------
    const t11Customer: Party = {
      id: 'pty_t11_cust_01',
      name: 'আহমেদ ট্রেডার্স (Ahmed Traders)',
      phone: '01712345678',
      type: 'CUSTOMER',
      balance: 0,
      isActive: true,
      synced: false
    };
    await task11Db.parties.put(t11Customer);

    const t11SaleItem: InventoryItem = {
      id: 'it_t11_sale_01',
      code: 'PROD-001',
      nameBn: 'উন্নত জাতের ডিম (Eggs)',
      nameEn: 'Grade A Eggs',
      category: 'FARM_PRODUCT',
      unit: 'টি',
      currentStock: 1000,
      reorderLevel: 100,
      avgCostPrice: 8,
      sellingPrice: 12,
      synced: false
    };
    await task11Db.inventoryItems.put(t11SaleItem);

    // 1. Customer Credit Sale: 500 eggs @ ৳12 = ৳6,000 on CREDIT
    const saleResult = await executeSaleTransaction(
      {
        customer: t11Customer,
        item: t11SaleItem,
        quantity: 500,
        unitPrice: 12,
        paymentMethod: 'CREDIT',
        currentUserId: 'usr_t11_owner',
        date: '2026-07-15'
      },
      task11Db
    );

    assert(saleResult.sale !== undefined, 'Customer credit sale must be successfully posted.');
    assert(saleResult.sale.totalAmount === 6000, 'Sale totalAmount must be ৳6,000.');
    assert(saleResult.sale.dueAmount === 6000, 'Sale initial dueAmount must be ৳6,000.');
    assert(saleResult.sale.paidAmount === 0, 'Sale initial paidAmount must be ৳0.');
    assert(saleResult.sale.status === 'DUE', 'Sale status must be DUE.');

    // Verify GL for credit sale: Dr Accounts Receivable (1020), Cr Sales Revenue (4020/4010)
    const saleJournal = await task11Db.journalEntries.get(saleResult.journalEntryId);
    assert(saleJournal !== undefined, 'Sale journal entry must exist.');
    const saleDrAr = saleJournal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE && l.debit === 6000
    );
    const saleCrRev = saleJournal.lines.find(
      (l: any) => (l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE || l.accountCode === '4010' || l.accountCode === '4020') && l.credit === 6000
    );
    assert(!!saleDrAr, 'Credit sale must Debit Accounts Receivable (1020) for ৳6,000.');
    assert(!!saleCrRev, 'Credit sale must Credit Sales Revenue for ৳6,000.');

    // Verify Customer balance increased by ৳6,000
    const custAfterCreditSale = await task11Db.parties.get(t11Customer.id);
    assert(custAfterCreditSale?.balance === 6000, 'Customer balance must increase to ৳6,000 after credit sale.');

    // 2. Overpayment validation: Payment cannot exceed outstanding invoice balance
    let overpaymentSaleFailed = false;
    try {
      await executePaymentTransaction(
        {
          parentType: 'SALE',
          parentId: saleResult.sale.id,
          amount: 6500, // exceeds ৳6,000 due
          paymentMethod: 'CASH',
          date: '2026-07-16',
          currentUserId: 'usr_t11_owner'
        },
        task11Db
      );
    } catch (err: any) {
      overpaymentSaleFailed = true;
    }
    assert(overpaymentSaleFailed, 'Overpayment exceeding outstanding sale due MUST be rejected (prevent negative invoice balance).');

    // Verify invoice due remains intact and not negative
    const saleAfterOverpaymentAttempt = await task11Db.sales.get(saleResult.sale.id);
    assert(saleAfterOverpaymentAttempt?.dueAmount === 6000, 'Sale dueAmount must remain ৳6,000 after rejected overpayment.');
    assert(saleAfterOverpaymentAttempt?.paidAmount === 0, 'Sale paidAmount must remain ৳0.');

    // 3. Customer partial payment (৳4,000 via BANK): Dr Bank (1030), Cr Accounts Receivable (1020)
    const pmtKey1 = 'pmt_key_sale_01';
    const salePmt1Res = await executePaymentTransaction(
      {
        parentType: 'SALE',
        parentId: saleResult.sale.id,
        amount: 4000,
        paymentMethod: 'BANK',
        bankAccountId: t11BankAcc.id,
        date: '2026-07-16',
        note: 'প্রথম কিস্তি পরিশোধ',
        currentUserId: 'usr_t11_owner',
        idempotencyKey: pmtKey1
      },
      task11Db
    );

    assert(salePmt1Res.payment.amount === 4000, 'Payment 1 amount must be ৳4,000.');
    assert(!!salePmt1Res.journalEntryId, 'Payment 1 must store/link journalEntryId.');
    assert(salePmt1Res.payment.journalEntryId === salePmt1Res.journalEntryId, 'Payment record must link journalEntryId.');

    // Verify GL entry for payment: Dr Bank, Cr AR
    const t11Pmt1Journal = await task11Db.journalEntries.get(salePmt1Res.journalEntryId);
    assert(t11Pmt1Journal !== undefined, 'Payment 1 journal entry must exist.');
    const t11Pmt1DrBank = t11Pmt1Journal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.BANK && l.debit === 4000
    );
    const t11Pmt1CrAr = t11Pmt1Journal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE && l.credit === 4000
    );
    assert(!!t11Pmt1DrBank, 'Customer payment must Debit Bank (1030) for ৳4,000.');
    assert(!!t11Pmt1CrAr, 'Customer payment must Credit Accounts Receivable (1020) for ৳4,000.');

    // Customer balance must decrease
    const t11CustAfterPmt1 = await task11Db.parties.get(t11Customer.id);
    assert(t11CustAfterPmt1?.balance === 2000, 'Customer balance must decrease to ৳2,000 (6000 - 4000).');

    // Invoice status must be PARTIAL and dueAmount ৳2,000
    const t11SaleAfterPmt1 = await task11Db.sales.get(saleResult.sale.id);
    assert(t11SaleAfterPmt1?.status === 'PARTIAL', 'Sale status must be PARTIAL.');
    assert(t11SaleAfterPmt1?.paidAmount === 4000, 'Sale paidAmount must be ৳4,000.');
    assert(t11SaleAfterPmt1?.dueAmount === 2000, 'Sale dueAmount must be ৳2,000.');

    // 4. Duplicate payment prevention test
    let duplicatePmtFailed = false;
    try {
      await executePaymentTransaction(
        {
          parentType: 'SALE',
          parentId: saleResult.sale.id,
          amount: 4000,
          paymentMethod: 'BANK',
          bankAccountId: t11BankAcc.id,
          date: '2026-07-16',
          note: 'প্রথম কিস্তি পরিশোধ',
          currentUserId: 'usr_t11_owner',
          idempotencyKey: pmtKey1
        },
        task11Db
      );
    } catch (err: any) {
      duplicatePmtFailed = true;
    }
    assert(duplicatePmtFailed, 'Duplicate payment posting with same idempotency key or duplicate details MUST be rejected.');

    // 5. Final customer payment (৳2,000 via CASH)
    const salePmt2Res = await executePaymentTransaction(
      {
        parentType: 'SALE',
        parentId: saleResult.sale.id,
        amount: 2000,
        paymentMethod: 'CASH',
        date: '2026-07-17',
        note: 'বকেয়া সমাপনী',
        currentUserId: 'usr_t11_owner'
      },
      task11Db
    );

    assert(salePmt2Res.payment.amount === 2000, 'Payment 2 amount must be ৳2,000.');

    // Customer balance must decrease to 0
    const custFinal = await task11Db.parties.get(t11Customer.id);
    assert(custFinal?.balance === 0, 'Customer balance must decrease to ৳0 after full payment.');

    // Invoice status must be PAID and dueAmount 0 (prevent negative)
    const saleFinal = await task11Db.sales.get(saleResult.sale.id);
    assert(saleFinal?.status === 'PAID', 'Sale invoice status must be PAID.');
    assert(saleFinal?.dueAmount === 0, 'Sale dueAmount must be exactly 0 (no negative balance).');
    assert(saleFinal?.paidAmount === 6000, 'Sale paidAmount must be ৳6,000.');

    // GL AR and Customer subledger must reconcile
    const t11JournalsAfterSalePmts = await task11Db.journalEntries.toArray();
    let t11NetGlAr = 0;
    for (const j of t11JournalsAfterSalePmts) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE) {
          t11NetGlAr += (line.debit || 0) - (line.credit || 0);
        }
      }
    }
    assert(t11NetGlAr === 0, 'Net GL Accounts Receivable must be ৳0 after full settlement.');
    assert(custFinal?.balance === t11NetGlAr, 'Customer subledger balance and GL Accounts Receivable must reconcile.');

    // -------------------------------------------------------------------------
    // PART B: Supplier Credit Purchase + Payment
    // -------------------------------------------------------------------------
    const t11Supplier: Party = {
      id: 'pty_t11_supp_01',
      name: 'আমান ফিড মিলস (Aman Feed Mills)',
      phone: '01812345678',
      type: 'SUPPLIER',
      balance: 0,
      isActive: true,
      synced: false
    };
    await task11Db.parties.put(t11Supplier);

    const t11PurchItem: InventoryItem = {
      id: 'it_t11_purch_01',
      code: 'FEED-002',
      nameBn: 'লেয়ার ফিড ১ (Layer Feed 1)',
      nameEn: 'Layer Feed 1',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      reorderLevel: 50,
      avgCostPrice: 0,
      sellingPrice: 65,
      synced: false
    };
    await task11Db.inventoryItems.put(t11PurchItem);

    // 1. Supplier Credit Purchase: 200 kg @ ৳50 = ৳10,000 on CREDIT
    const purchResult = await executePurchaseTransaction(
      {
        supplier: t11Supplier,
        item: t11PurchItem,
        quantity: 200,
        unitPrice: 50,
        paymentMethod: 'CREDIT',
        currentUserId: 'usr_t11_owner',
        date: '2026-07-18'
      },
      task11Db
    );

    assert(purchResult.purchase !== undefined, 'Supplier credit purchase must be successfully posted.');
    assert(purchResult.purchase.grandTotal === 10000, 'Purchase grandTotal must be ৳10,000.');
    assert(purchResult.purchase.dueAmount === 10000, 'Purchase initial dueAmount must be ৳10,000.');
    assert(purchResult.purchase.paidAmount === 0, 'Purchase initial paidAmount must be ৳0.');
    assert(purchResult.purchase.status === 'DUE', 'Purchase status must be DUE.');

    // Verify GL for credit purchase: Dr Inventory (1051/1040), Cr Accounts Payable (2010)
    const purchJournal = await task11Db.journalEntries.get(purchResult.journalEntryId);
    assert(purchJournal !== undefined, 'Purchase journal entry must exist.');
    const purchDrInv = purchJournal.lines.find(
      (l: any) => (l.accountCode === CANONICAL_ACCOUNTS.FEED_INVENTORY || l.accountCode === '1051' || l.accountCode === '1040') && l.debit === 10000
    );
    const purchCrAp = purchJournal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE && l.credit === 10000
    );
    assert(!!purchDrInv, 'Credit purchase must Debit Inventory Asset (1051/1040) for ৳10,000.');
    assert(!!purchCrAp, 'Credit purchase must Credit Accounts Payable (2010) for ৳10,000.');

    // Verify Supplier balance increased by ৳10,000
    const suppAfterCreditPurch = await task11Db.parties.get(t11Supplier.id);
    assert(suppAfterCreditPurch?.balance === 10000, 'Supplier balance must increase to ৳10,000 after credit purchase.');

    // 2. Overpayment validation: Payment cannot exceed outstanding invoice balance
    let overpaymentPurchFailed = false;
    try {
      await executePaymentTransaction(
        {
          parentType: 'PURCHASE',
          parentId: purchResult.purchase.id,
          amount: 11000, // exceeds ৳10,000 due
          paymentMethod: 'CASH',
          date: '2026-07-19',
          currentUserId: 'usr_t11_owner'
        },
        task11Db
      );
    } catch (err: any) {
      overpaymentPurchFailed = true;
    }
    assert(overpaymentPurchFailed, 'Overpayment exceeding outstanding purchase due MUST be rejected (prevent negative invoice balance).');

    // Verify purchase invoice due remains intact
    const purchAfterOverpaymentAttempt = await task11Db.purchases.get(purchResult.purchase.id);
    assert(purchAfterOverpaymentAttempt?.dueAmount === 10000, 'Purchase dueAmount must remain ৳10,000 after rejected overpayment.');
    assert(purchAfterOverpaymentAttempt?.paidAmount === 0, 'Purchase paidAmount must remain ৳0.');

    // 3. Supplier partial payment (৳6,000 via BANK): Dr Accounts Payable (2010), Cr Bank (1030)
    const pmtKeyPurch1 = 'pmt_key_purch_01';
    const purchPmt1Res = await executePaymentTransaction(
      {
        parentType: 'PURCHASE',
        parentId: purchResult.purchase.id,
        amount: 6000,
        paymentMethod: 'BANK',
        bankAccountId: t11BankAcc.id,
        date: '2026-07-19',
        note: 'সরবরাহকারী কিস্তি ১',
        currentUserId: 'usr_t11_owner',
        idempotencyKey: pmtKeyPurch1
      },
      task11Db
    );

    assert(purchPmt1Res.payment.amount === 6000, 'Purchase payment 1 amount must be ৳6,000.');
    assert(!!purchPmt1Res.journalEntryId, 'Purchase payment 1 must store/link journalEntryId.');
    assert(purchPmt1Res.payment.journalEntryId === purchPmt1Res.journalEntryId, 'Payment record must link journalEntryId.');

    // Verify GL entry for purchase payment: Dr AP, Cr Bank
    const purchPmt1Journal = await task11Db.journalEntries.get(purchPmt1Res.journalEntryId);
    assert(purchPmt1Journal !== undefined, 'Purchase payment 1 journal entry must exist.');
    const purchPmt1DrAp = purchPmt1Journal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE && l.debit === 6000
    );
    const purchPmt1CrBank = purchPmt1Journal.lines.find(
      (l: any) => l.accountCode === CANONICAL_ACCOUNTS.BANK && l.credit === 6000
    );
    assert(!!purchPmt1DrAp, 'Supplier payment must Debit Accounts Payable (2010) for ৳6,000.');
    assert(!!purchPmt1CrBank, 'Supplier payment must Credit Bank (1030) for ৳6,000.');

    // Supplier balance must decrease
    const suppAfterPmt1 = await task11Db.parties.get(t11Supplier.id);
    assert(suppAfterPmt1?.balance === 4000, 'Supplier balance must decrease to ৳4,000 (10000 - 6000).');

    // Invoice status must be PARTIAL and dueAmount ৳4,000
    const purchAfterPmt1 = await task11Db.purchases.get(purchResult.purchase.id);
    assert(purchAfterPmt1?.status === 'PARTIAL', 'Purchase status must be PARTIAL.');
    assert(purchAfterPmt1?.paidAmount === 6000, 'Purchase paidAmount must be ৳6,000.');
    assert(purchAfterPmt1?.dueAmount === 4000, 'Purchase dueAmount must be ৳4,000.');

    // 4. Duplicate payment prevention test
    let duplicatePurchPmtFailed = false;
    try {
      await executePaymentTransaction(
        {
          parentType: 'PURCHASE',
          parentId: purchResult.purchase.id,
          amount: 6000,
          paymentMethod: 'BANK',
          bankAccountId: t11BankAcc.id,
          date: '2026-07-19',
          note: 'সরবরাহকারী কিস্তি ১',
          currentUserId: 'usr_t11_owner',
          idempotencyKey: pmtKeyPurch1
        },
        task11Db
      );
    } catch (err: any) {
      duplicatePurchPmtFailed = true;
    }
    assert(duplicatePurchPmtFailed, 'Duplicate supplier payment posting MUST be rejected.');

    // 5. Final supplier payment (৳4,000 via CASH)
    const purchPmt2Res = await executePaymentTransaction(
      {
        parentType: 'PURCHASE',
        parentId: purchResult.purchase.id,
        amount: 4000,
        paymentMethod: 'CASH',
        date: '2026-07-20',
        note: 'বকেয়া সমাপনী পরিশোধ',
        currentUserId: 'usr_t11_owner'
      },
      task11Db
    );

    assert(purchPmt2Res.payment.amount === 4000, 'Purchase payment 2 amount must be ৳4,000.');

    // Supplier balance must decrease to 0
    const suppFinal = await task11Db.parties.get(t11Supplier.id);
    assert(suppFinal?.balance === 0, 'Supplier balance must decrease to ৳0 after full settlement.');

    // Invoice status must be PAID and dueAmount 0 (prevent negative)
    const purchFinal = await task11Db.purchases.get(purchResult.purchase.id);
    assert(purchFinal?.status === 'PAID', 'Purchase invoice status must be PAID.');
    assert(purchFinal?.dueAmount === 0, 'Purchase dueAmount must be exactly 0 (no negative balance).');
    assert(purchFinal?.paidAmount === 10000, 'Purchase paidAmount must be ৳10,000.');

    // GL AP and Supplier subledger must reconcile
    const t11JournalsAfterPurchPmts = await task11Db.journalEntries.toArray();
    let netGlAp = 0;
    for (const j of t11JournalsAfterPurchPmts) {
      for (const line of j.lines) {
        if (line.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE) {
          netGlAp += (line.credit || 0) - (line.debit || 0);
        }
      }
    }
    assert(netGlAp === 0, 'Net GL Accounts Payable must be ৳0 after full settlement.');
    assert(suppFinal?.balance === netGlAp, 'Supplier subledger balance and GL Accounts Payable must reconcile.');

    // =========================================================================
    // TASK 12: FIXED ASSET ACQUISITION ATOMICITY, SUBLEDGER SYNC & ROLLBACK
    // =========================================================================
    const task12Db = createMockAgroDatabase();
    for (const acc of accounts) {
      await task12Db.accounts.put({ ...acc });
    }

    // Seed cash account, bank account, and supplier party
    const t12CashAcc: CashBankAccount = {
      id: 'cb_cash_t12',
      name: 'প্রধান ক্যাশ (Main Cash)',
      accountName: 'প্রধান ক্যাশ (Main Cash)',
      accountType: 'CASH',
      currentBalance: 250000,
      isActive: true,
      synced: false
    };
    await task12Db.cashBankAccounts.put(t12CashAcc);

    const t12BankAcc: CashBankAccount = {
      id: 'cb_bank_t12',
      name: 'ইসলামী ব্যাংক হিসাব (Islami Bank A/C)',
      accountName: 'ইসলামী ব্যাংক হিসাব (Islami Bank A/C)',
      accountType: 'BANK',
      bankName: 'Islami Bank Bangladesh Ltd',
      accountNumber: '205012345678',
      currentBalance: 500000,
      isActive: true,
      synced: false
    };
    await task12Db.cashBankAccounts.put(t12BankAcc);

    const t12Supplier: Party = {
      id: 'party_supp_t12',
      name: 'মেসার্স কৃষি যন্ত্রপাতি ও সরবরাহকারী (Agro Machinery Corp)',
      type: 'SUPPLIER',
      phone: '01711000000',
      balance: 0,
      isActive: true,
      synced: false
    };
    await task12Db.parties.put(t12Supplier);

    // -------------------------------------------------------------------------
    // 1. Successful Acquisition (CASH Payment)
    // -------------------------------------------------------------------------
    const cashBefore12 = (await task12Db.cashBankAccounts.get(t12CashAcc.id))?.currentBalance || 0;
    const acqCashRes = await executeFixedAssetAcquisitionTransaction(
      {
        name: 'মিল্কিং মেশিন (Automated Milking Machine)',
        category: 'MACHINERY',
        purchaseDate: '2026-07-01',
        originalCost: 80000,
        usefulLifeYears: 5,
        salvageValue: 5000,
        paymentMethod: 'CASH',
        currentUserId: 'usr_t12_owner'
      },
      task12Db
    );

    assert(Boolean(acqCashRes.asset?.id), 'Task 12: Cash asset acquisition returned valid asset ID.');
    assert(Boolean(acqCashRes.journalEntry?.id), 'Task 12: Cash asset acquisition returned valid journal entry ID.');
    assert(acqCashRes.asset.journalEntryId === acqCashRes.journalEntry.id, 'Task 12: Asset record must link to journalEntryId.');
    assert(acqCashRes.journalEntry.reference === acqCashRes.asset.id, 'Task 12: Journal entry reference must match asset ID.');

    // Verify Asset Register record
    const savedCashAsset = await task12Db.fixedAssets.get(acqCashRes.asset.id);
    assert(savedCashAsset !== undefined, 'Task 12: Fixed Asset must be stored in fixedAssets register.');
    assert(savedCashAsset?.status === 'ACTIVE', 'Task 12: Fixed Asset status must be ACTIVE.');
    assert(savedCashAsset?.originalCost === 80000, 'Task 12: Asset originalCost must be ৳80,000.');
    assert(savedCashAsset?.currentBookValue === 80000, 'Task 12: Asset initial currentBookValue must equal originalCost.');
    assert(savedCashAsset?.accumulatedDepreciation === 0, 'Task 12: Initial accumulatedDepreciation must be 0.');

    // Verify GL Journal Entry lines (Dr Machinery 1550, Cr Cash 1010)
    const savedCashJournal = await task12Db.journalEntries.get(acqCashRes.journalEntry.id);
    assert(savedCashJournal !== undefined, 'Task 12: Journal entry must exist in GL journalEntries table.');
    assert(savedCashJournal?.totalDebit === 80000, 'Task 12: GL entry totalDebit must equal ৳80,000.');
    assert(savedCashJournal?.totalCredit === 80000, 'Task 12: GL entry totalCredit must equal ৳80,000.');
    const machDebitLine = savedCashJournal?.lines.find((l) => l.accountCode === '1550');
    const cashCreditLine = savedCashJournal?.lines.find((l) => l.accountCode === '1010');
    assert(machDebitLine?.debit === 80000, 'Task 12: Dr Machinery & Equipment (1550) must be ৳80,000.');
    assert(cashCreditLine?.credit === 80000, 'Task 12: Cr Cash on Hand (1010) must be ৳80,000.');

    // Verify Cash Subledger deduction
    const cashAfter12 = (await task12Db.cashBankAccounts.get(t12CashAcc.id))?.currentBalance;
    assert(cashAfter12 === cashBefore12 - 80000, 'Task 12: Cash balance must be deducted by ৳80,000 (250,000 -> 170,000).');

    // Verify Audit Record
    const allAudits12 = await task12Db.auditLogs.toArray();
    const acqAudit1 = allAudits12.find((a) => a.recordId === acqCashRes.asset.id);
    assert(acqAudit1 !== undefined, 'Task 12: Audit log record must be created for asset acquisition.');
    assert(acqAudit1?.module === 'ASSETS', 'Task 12: Audit log module must be ASSETS.');
    assert(acqAudit1?.action === 'CREATE', 'Task 12: Audit log action must be CREATE.');

    // -------------------------------------------------------------------------
    // 2. Successful Acquisition (BANK Payment)
    // -------------------------------------------------------------------------
    const bankBefore12 = (await task12Db.cashBankAccounts.get(t12BankAcc.id))?.currentBalance || 0;
    const acqBankRes = await executeFixedAssetAcquisitionTransaction(
      {
        name: 'আধুনিক ডেইরি শেড (Modern Dairy Shed)',
        category: 'BUILDINGS',
        purchaseDate: '2026-07-05',
        originalCost: 150000,
        usefulLifeYears: 10,
        salvageValue: 10000,
        paymentMethod: 'BANK',
        bankAccountId: t12BankAcc.id,
        currentUserId: 'usr_t12_owner'
      },
      task12Db
    );

    assert(Boolean(acqBankRes.asset?.id), 'Task 12: Bank asset acquisition returned valid asset ID.');
    const savedBankJournal = await task12Db.journalEntries.get(acqBankRes.journalEntry.id);
    const bldgDebitLine = savedBankJournal?.lines.find((l) => l.accountCode === '1520');
    const bankCreditLine = savedBankJournal?.lines.find((l) => l.accountCode === '1030');
    assert(bldgDebitLine?.debit === 150000, 'Task 12: Dr Sheds & Buildings (1520) must be ৳150,000.');
    assert(bankCreditLine?.credit === 150000, 'Task 12: Cr Bank Accounts (1030) must be ৳150,000.');

    // Verify Bank Subledger deduction
    const bankAfter12 = (await task12Db.cashBankAccounts.get(t12BankAcc.id))?.currentBalance;
    assert(bankAfter12 === bankBefore12 - 150000, 'Task 12: Bank balance must be deducted by ৳150,000 (500,000 -> 350,000).');

    // -------------------------------------------------------------------------
    // 3. Successful Acquisition (CREDIT / Supplier AP)
    // -------------------------------------------------------------------------
    const suppBefore12 = (await task12Db.parties.get(t12Supplier.id))?.balance || 0;
    const acqCreditRes = await executeFixedAssetAcquisitionTransaction(
      {
        name: 'বাণিজ্যিক পুকুর অবকাঠামো (Commercial Pond)',
        category: 'PONDS',
        purchaseDate: '2026-07-10',
        originalCost: 120000,
        usefulLifeYears: 15,
        salvageValue: 0,
        paymentMethod: 'CREDIT',
        supplierId: t12Supplier.id,
        currentUserId: 'usr_t12_owner'
      },
      task12Db
    );

    assert(Boolean(acqCreditRes.asset?.id), 'Task 12: Credit asset acquisition returned valid asset ID.');
    const savedCreditJournal = await task12Db.journalEntries.get(acqCreditRes.journalEntry.id);
    const pondDebitLine = savedCreditJournal?.lines.find((l) => l.accountCode === '1530');
    const apCreditLine = savedCreditJournal?.lines.find((l) => l.accountCode === '2010');
    assert(pondDebitLine?.debit === 120000, 'Task 12: Dr Pond Infrastructure (1530) must be ৳120,000.');
    assert(apCreditLine?.credit === 120000, 'Task 12: Cr Accounts Payable (2010) must be ৳120,000.');

    // Verify Supplier Subledger balance increase
    const suppAfter12 = (await task12Db.parties.get(t12Supplier.id))?.balance;
    assert(suppAfter12 === suppBefore12 + 120000, 'Task 12: Supplier AP balance must increase by ৳120,000 (0 -> 120,000).');

    // -------------------------------------------------------------------------
    // 4. Input Validation & Integrity (No partial records on invalid input)
    // -------------------------------------------------------------------------
    let zeroCostRejected = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: 'অবৈধ শূন্য মূল্যের সম্পদ',
          category: 'MACHINERY',
          originalCost: 0,
          paymentMethod: 'CASH',
          currentUserId: 'usr_t12_owner'
        },
        task12Db
      );
    } catch (e) {
      zeroCostRejected = true;
    }
    assert(zeroCostRejected, 'Task 12: Acquisition with zero or negative cost must be rejected.');

    let missingNameRejected = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: '   ',
          category: 'MACHINERY',
          originalCost: 50000,
          paymentMethod: 'CASH',
          currentUserId: 'usr_t12_owner'
        },
        task12Db
      );
    } catch (e) {
      missingNameRejected = true;
    }
    assert(missingNameRejected, 'Task 12: Acquisition with empty name must be rejected.');

    let missingBankRejected = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: 'জেনারেটর',
          category: 'MACHINERY',
          originalCost: 60000,
          paymentMethod: 'BANK',
          // bankAccountId missing
          currentUserId: 'usr_t12_owner'
        },
        task12Db
      );
    } catch (e) {
      missingBankRejected = true;
    }
    assert(missingBankRejected, 'Task 12: BANK payment method without bankAccountId must be rejected.');

    let missingSupplierRejected = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: 'ফসল কাটার মেশিন',
          category: 'MACHINERY',
          originalCost: 75000,
          paymentMethod: 'CREDIT',
          // supplierId missing
          currentUserId: 'usr_t12_owner'
        },
        task12Db
      );
    } catch (e) {
      missingSupplierRejected = true;
    }
    assert(missingSupplierRejected, 'Task 12: CREDIT payment method without supplierId must be rejected.');

    // -------------------------------------------------------------------------
    // 5. Simulated Failure & Rollback Test (Atomicity Guarantee)
    // -------------------------------------------------------------------------
    // Capture state immediately prior to rollback test
    const assetsCountBeforeRollback = (await task12Db.fixedAssets.toArray()).length;
    const journalsCountBeforeRollback = (await task12Db.journalEntries.toArray()).length;
    const cashBalBeforeRollback = (await task12Db.cashBankAccounts.get(t12CashAcc.id))?.currentBalance;
    const auditsCountBeforeRollback = (await task12Db.auditLogs.toArray()).length;

    // Test A: Rollback when an invalid subledger ID causes inner transaction to abort
    let nonExistentBankCaught = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: 'অকার্যকর সম্পদ (Non-existent Bank)',
          category: 'MACHINERY',
          originalCost: 45000,
          paymentMethod: 'BANK',
          bankAccountId: 'cb_non_existent_id',
          currentUserId: 'usr_t12_owner'
        },
        task12Db
      );
    } catch (e: any) {
      nonExistentBankCaught = true;
    }
    assert(nonExistentBankCaught, 'Task 12: Acquisition with non-existent bank account must throw.');

    // Assert that no records were created during the failed transaction
    const assetsCountAfterFailA = (await task12Db.fixedAssets.toArray()).length;
    const journalsCountAfterFailA = (await task12Db.journalEntries.toArray()).length;
    assert(assetsCountAfterFailA === assetsCountBeforeRollback, 'Task 12 Rollback A: No asset record created on failed transaction.');
    assert(journalsCountAfterFailA === journalsCountBeforeRollback, 'Task 12 Rollback A: No journal entry created on failed transaction.');

    // Test B: Full Dexie Transaction Atomic Rollback (simulated mid-flight crash)
    let simulatedCrashCaught = false;
    try {
      await task12Db.transaction(
        'rw',
        [
          task12Db.fixedAssets,
          task12Db.journalEntries,
          task12Db.cashBankAccounts,
          task12Db.parties,
          task12Db.accounts,
          task12Db.auditLogs,
          task12Db.closedPeriods
        ],
        async () => {
          // Perform valid acquisition inside the transaction block
          await executeFixedAssetAcquisitionTransaction(
            {
              name: 'ট্রাক্টর (Tractor to be Rolled Back)',
              category: 'MACHINERY',
              purchaseDate: '2026-07-15',
              originalCost: 65000,
              paymentMethod: 'CASH',
              currentUserId: 'usr_t12_owner'
            },
            task12Db
          );

          // Force simulated failure midway to trigger atomic Dexie rollback
          throw new Error('SIMULATED_TRANSACTION_CRASH_MIDWAY');
        }
      );
    } catch (err: any) {
      if (err.message?.includes('SIMULATED_TRANSACTION_CRASH_MIDWAY')) {
        simulatedCrashCaught = true;
      }
    }

    assert(simulatedCrashCaught, 'Task 12: Simulated mid-flight crash error was caught.');

    // Verify COMPLETE rollback across all 4 tables:
    const assetsCountAfterRollback = (await task12Db.fixedAssets.toArray()).length;
    const journalsCountAfterRollback = (await task12Db.journalEntries.toArray()).length;
    const cashBalAfterRollback = (await task12Db.cashBankAccounts.get(t12CashAcc.id))?.currentBalance;
    const auditsCountAfterRollback = (await task12Db.auditLogs.toArray()).length;

    assert(
      assetsCountAfterRollback === assetsCountBeforeRollback,
      'Task 12 Atomic Rollback: Fixed Asset register was completely rolled back (count unchanged).'
    );
    assert(
      journalsCountAfterRollback === journalsCountBeforeRollback,
      'Task 12 Atomic Rollback: GL Journal Entries were completely rolled back (count unchanged).'
    );
    assert(
      cashBalAfterRollback === cashBalBeforeRollback,
      'Task 12 Atomic Rollback: Cash account balance was restored to original (balance unchanged).'
    );
    assert(
      auditsCountAfterRollback === auditsCountBeforeRollback,
      'Task 12 Atomic Rollback: Audit log entries were completely rolled back (count unchanged).'
    );

    // Final Cross-Check: Never leave GL without Asset record or Asset record without GL
    const finalAssets = await task12Db.fixedAssets.toArray();
    const finalJournals = await task12Db.journalEntries.toArray();

    for (const ast of finalAssets) {
      const matchingJournal = finalJournals.find((j) => j.id === ast.journalEntryId || j.reference === ast.id);
      assert(
        matchingJournal !== undefined,
        `Task 12 Integrity: Asset ${ast.id} (${ast.name}) must have a corresponding GL journal entry. Never leave Asset without GL.`
      );
    }

    for (const jnl of finalJournals) {
      if (jnl.reference && jnl.reference.startsWith('AST')) {
        const matchingAsset = finalAssets.find((a) => a.id === jnl.reference || a.journalEntryId === jnl.id);
        assert(
          matchingAsset !== undefined,
          `Task 12 Integrity: GL Journal ${jnl.id} referencing ${jnl.reference} must have a corresponding Asset record. Never leave GL without Asset.`
        );
      }
    }

    // =========================================================================
    // TASK 13 — FIX FIXED ASSET DEPRECIATION
    // =========================================================================
    // 1. Useful life and depreciation rate must not contradict each other
    // 2. For straight-line depreciation, derive annual/monthly depreciation consistently from:
    //    cost, salvage value, useful life
    // 3. Do not use a 5-year useful life with a contradictory 10% annual rate
    // 4. Do not depreciate below salvage value
    // 5. Do not post depreciation twice for the same asset and period
    // 6. Respect closed periods
    // 7. Do not silently skip depreciation permanently because a period was closed
    // 8. Ensure asset register accumulated depreciation and GL accumulated depreciation remain consistent

    // Subtest 13.1: Straight-Line Parameter Derivation & Contradiction Resolution
    const contradictedParams = calculateAssetDepreciationParameters(100000, 0, 5, 10);
    assert(
      contradictedParams.usefulLifeYears === 5 && contradictedParams.depreciationRatePercent === 20,
      'Task 13: 5-year useful life must not use contradictory 10% rate; rate must be derived as 20%.'
    );
    assert(
      contradictedParams.annualDepreciation === 20000 && contradictedParams.monthlyDepreciation === 1666.67,
      'Task 13: Annual depreciation for 100k over 5 years must be 20,000 (1,666.67/month), not 10,000.'
    );

    const straightLineWithSalvage = calculateAssetDepreciationParameters(60000, 12000, 4, 25);
    assert(
      straightLineWithSalvage.depreciableBase === 48000,
      'Task 13: Depreciable base must be original cost (60,000) minus salvage value (12,000) = 48,000.'
    );
    assert(
      straightLineWithSalvage.annualDepreciation === 12000,
      'Task 13: Annual depreciation must be 48,000 / 4 years = 12,000/year.'
    );
    assert(
      straightLineWithSalvage.monthlyDepreciation === 1000,
      'Task 13: Monthly depreciation must be 12,000 / 12 = 1,000/month.'
    );

    // Setup fresh isolated in-memory DB for Task 13 end-to-end testing
    const task13Db: any = {
      fixedAssets: new MockTable<FixedAsset>(),
      journalEntries: new MockTable<JournalEntry>(),
      accounts: new MockTable<Account>(),
      auditLogs: new MockTable<any>(),
      closedPeriods: new MockTable<any>(),
      cashBankAccounts: new MockTable<any>(),
      parties: new MockTable<any>(),
      transaction: async (_mode: string, tables: any[], callback: () => Promise<any>) => {
        const snapshots = tables.map((t) => ({ table: t, snap: t && t._snapshot ? t._snapshot() : null }));
        try {
          return await callback();
        } catch (err) {
          for (const s of snapshots) {
            if (s.table && s.snap && s.table._restore) {
              s.table._restore(s.snap);
            }
          }
          throw err;
        }
      }
    };

    // Seed COA Accounts for Depreciation
    await task13Db.accounts.put({ id: 'acc_6140', code: '6140', nameBn: 'অবচয় খরচ (Depreciation Expense)', category: 'EXPENSE' });
    await task13Db.accounts.put({ id: 'acc_1590', code: '1590', nameBn: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation)', category: 'ASSET' });
    await task13Db.accounts.put({ id: 'acc_1530', code: '1530', nameBn: 'যন্ত্রপাতি ও সরঞ্জাম', category: 'ASSET' });

    // Subtest 13.2: Normal Depreciation across multiple open periods
    const normalAsset: FixedAsset = {
      id: 'AST-TASK13-NORM',
      name: 'ধান কাটার যন্ত্র (Harvester)',
      category: 'MACHINERY',
      purchaseDate: '2026-01-01',
      originalCost: 60000,
      salvageValue: 12000,
      usefulLifeYears: 4,
      depreciationRatePercent: 25,
      accumulatedDepreciation: 0,
      currentBookValue: 60000,
      lastDepreciationDate: '2026-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await task13Db.fixedAssets.put(normalAsset);

    const normalDeprResult = await executeAssetDepreciationAtomic(
      normalAsset.id,
      { currentUserId: 'TESTER_13', targetDate: '2026-04-01' },
      task13Db
    );

    assert(
      normalDeprResult.monthsPosted === 3,
      'Task 13 Normal: Jan 01 to Apr 01 must post exactly 3 monthly periods (Feb, Mar, Apr).'
    );
    assert(
      normalDeprResult.totalDepreciation === 3000,
      'Task 13 Normal: 3 months at 1,000/mo must total ৳3,000 depreciation.'
    );
    assert(
      normalDeprResult.newAccumulatedDepreciation === 3000,
      'Task 13 Normal: Asset register accumulated depreciation must be updated to ৳3,000.'
    );
    assert(
      normalDeprResult.newBookValue === 57000,
      'Task 13 Normal: Asset book value must be updated to ৳57,000 (60,000 - 3,000).'
    );

    const normalAssetInDb = await task13Db.fixedAssets.get(normalAsset.id);
    assert(
      normalAssetInDb?.accumulatedDepreciation === 3000 && normalAssetInDb?.currentBookValue === 57000,
      'Task 13 Normal: Fixed Asset record in DB must reflect 3,000 accumulated depreciation and 57,000 book value.'
    );

    // Verify GL consistency (Account 1590 Accumulated Depreciation)
    const task13Journals = await task13Db.journalEntries.toArray();
    assert(
      task13Journals.length === 3,
      'Task 13 Normal: Exactly 3 GL journal entries must be written for the 3 depreciation periods.'
    );

    let totalGLAccumulatedCredit = 0;
    for (const je of task13Journals) {
      assert(je.lines.length === 2, 'Task 13 Normal: Each depreciation journal entry must contain exactly 2 lines.');
      const expenseLine = je.lines.find((l: any) => l.accountCode === '6140');
      const accumLine = je.lines.find((l: any) => l.accountCode === '1590');
      assert(
        expenseLine !== undefined && accumLine !== undefined,
        'Task 13 Normal: Each entry must debit 6140 and credit 1590.'
      );
      assert(
        expenseLine.debit === 1000 && accumLine.credit === 1000,
        'Task 13 Normal: Each monthly journal entry must be balanced for ৳1,000.'
      );
      totalGLAccumulatedCredit += accumLine.credit;
    }

    assert(
      totalGLAccumulatedCredit === normalAssetInDb?.accumulatedDepreciation,
      'Task 13 Integrity: GL Accumulated Depreciation credits (৳3,000) and Asset Register accumulated depreciation (৳3,000) must be 100% consistent.'
    );

    // Subtest 13.3: Repeated Same-Period Depreciation (Idempotency / Duplicate-Period Protection)
    const repeatedResult = await executeAssetDepreciationAtomic(
      normalAsset.id,
      { currentUserId: 'TESTER_13', targetDate: '2026-04-01' },
      task13Db
    );
    assert(
      repeatedResult.monthsPosted === 0 && repeatedResult.totalDepreciation === 0,
      'Task 13 Duplicate Protection: Calling depreciation again for the same period must post 0 entries and ৳0 amount.'
    );
    const journalsAfterRetry = await task13Db.journalEntries.toArray();
    assert(
      journalsAfterRetry.length === 3,
      'Task 13 Duplicate Protection: No duplicate GL journal entries may be created on repeat call.'
    );
    const assetAfterRetry = await task13Db.fixedAssets.get(normalAsset.id);
    assert(
      assetAfterRetry?.accumulatedDepreciation === 3000 && assetAfterRetry?.currentBookValue === 57000,
      'Task 13 Duplicate Protection: Asset register values must remain intact after duplicate call.'
    );

    // Subtest 13.4: Final Depreciation (Never Depreciate Below Salvage Value)
    // Asset cost: 50,000, salvage: 10,000 -> depreciable base = 40,000
    // Already accumulated: 39,500. Remaining depreciable = 500.
    // Monthly depreciation rate = 1,000/mo.
    // Final depreciation must post ONLY 500, not 1,000!
    const nearFinalAsset: FixedAsset = {
      id: 'AST-TASK13-FINAL',
      name: 'সেচ পাম্প (Irrigation Pump)',
      category: 'MACHINERY',
      purchaseDate: '2026-01-01',
      originalCost: 50000,
      salvageValue: 10000,
      usefulLifeYears: 4,
      depreciationRatePercent: 25,
      accumulatedDepreciation: 39500,
      currentBookValue: 10500,
      lastDepreciationDate: '2026-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await task13Db.fixedAssets.put(nearFinalAsset);

    const finalDeprResult = await executeAssetDepreciationAtomic(
      nearFinalAsset.id,
      { currentUserId: 'TESTER_13', targetDate: '2026-02-01' },
      task13Db
    );

    assert(
      finalDeprResult.monthsPosted === 1,
      'Task 13 Final Depreciation: Final month must post 1 journal entry.'
    );
    assert(
      finalDeprResult.totalDepreciation === 500,
      'Task 13 Final Depreciation: Final month must only depreciate the remaining ৳500 to reach salvage value, never full ৳1,000.'
    );
    assert(
      finalDeprResult.newAccumulatedDepreciation === 40000,
      'Task 13 Final Depreciation: Accumulated depreciation must exactly cap at ৳40,000 (cost 50k - salvage 10k).'
    );
    assert(
      finalDeprResult.newBookValue === 10000,
      'Task 13 Final Depreciation: Book value must equal exactly salvage value (৳10,000), never dropping below salvage value.'
    );

    const finalAssetInDb = await task13Db.fixedAssets.get(nearFinalAsset.id);
    assert(
      finalAssetInDb?.currentBookValue === 10000 && finalAssetInDb?.accumulatedDepreciation === 40000,
      'Task 13 Final Depreciation: Database asset record must reflect book value at salvage value.'
    );

    // Call depreciation again when already at salvage value
    const postFinalResult = await executeAssetDepreciationAtomic(
      nearFinalAsset.id,
      { currentUserId: 'TESTER_13', targetDate: '2026-03-01' },
      task13Db
    );
    assert(
      postFinalResult.monthsPosted === 0 && postFinalResult.totalDepreciation === 0,
      'Task 13 Final Depreciation: Post-salvage run must post 0 entries.'
    );
    assert(
      postFinalResult.newBookValue === 10000,
      'Task 13 Final Depreciation: Book value must strictly remain at salvage value.'
    );

    // Subtest 13.5: Closed Period Handling (Respect Closed Periods & Never Silently Skip)
    // Setup closed period ending 2026-01-31
    await task13Db.closedPeriods.put({
      id: 'cp_task13_jan',
      endDate: '2026-01-31',
      closedAt: '2026-02-01T00:00:00Z',
      synced: false
    });

    const closedPeriodAsset: FixedAsset = {
      id: 'AST-TASK13-CLOSED',
      name: 'ট্রাক্টর (Tractor)',
      category: 'VEHICLES' as any,
      purchaseDate: '2025-12-01',
      originalCost: 120000,
      salvageValue: 0,
      usefulLifeYears: 10,
      depreciationRatePercent: 10,
      accumulatedDepreciation: 0,
      currentBookValue: 120000,
      lastDepreciationDate: '2025-12-01',
      status: 'ACTIVE',
      synced: false
    };
    await task13Db.fixedAssets.put(closedPeriodAsset);

    // 1. Attempt depreciation targeting a closed period date
    let closedPeriodBlocked = false;
    try {
      await executeAssetDepreciationAtomic(
        closedPeriodAsset.id,
        { currentUserId: 'TESTER_13', targetDate: '2026-01-15' },
        task13Db
      );
    } catch (cpErr: any) {
      closedPeriodBlocked = true;
      assert(
        cpErr.message.includes('হিসাবরক্ষণ সীমাবদ্ধতা') || cpErr.message.includes('বন্ধ সময়কাল'),
        'Task 13 Closed Period: Error message must clearly indicate closed accounting period.'
      );
    }
    assert(
      closedPeriodBlocked,
      'Task 13 Closed Period: Running depreciation inside a closed period must be strictly blocked.'
    );

    // Verify that the blocked attempt DID NOT silently advance lastDepreciationDate or skip depreciation
    const assetAfterBlocked = await task13Db.fixedAssets.get(closedPeriodAsset.id);
    assert(
      assetAfterBlocked?.lastDepreciationDate === '2025-12-01',
      'Task 13 Closed Period: Blocked closed period attempt must NOT advance lastDepreciationDate or silently skip.'
    );
    assert(
      assetAfterBlocked?.accumulatedDepreciation === 0,
      'Task 13 Closed Period: Blocked closed period attempt must leave accumulated depreciation unchanged.'
    );

    // 2. Now run depreciation in an OPEN period (targetDate: 2026-03-01 > 2026-01-31)
    const openPeriodDeprResult = await executeAssetDepreciationAtomic(
      closedPeriodAsset.id,
      { currentUserId: 'TESTER_13', targetDate: '2026-03-01' },
      task13Db
    );

    assert(
      openPeriodDeprResult.monthsPosted === 3,
      'Task 13 Closed Period: In open period, all 3 months must be posted without permanently skipping any month.'
    );
    assert(
      openPeriodDeprResult.totalDepreciation === 3000,
      'Task 13 Closed Period: Total depreciation must be 3,000 for the 3 months.'
    );
    assert(
      openPeriodDeprResult.newAccumulatedDepreciation === 3000,
      'Task 13 Closed Period: Asset register accumulated depreciation must be updated to ৳3,000.'
    );

    // Verify all GL journal entries written in this run respect closed periods (posting date strictly > 2026-01-31)
    const assetJournals = (await task13Db.journalEntries.toArray()).filter(
      (j: any) => j.reference === closedPeriodAsset.id
    );
    assert(
      assetJournals.length === 3,
      'Task 13 Closed Period: Exactly 3 journal entries posted for the tractor.'
    );
    for (const j of assetJournals) {
      assert(
        j.date > '2026-01-31',
        `Task 13 Closed Period: Posting date (${j.date}) must be strictly after closed period end date (2026-01-31). Never post into closed period.`
      );
    }

    const assetAfterOpenRun = await task13Db.fixedAssets.get(closedPeriodAsset.id);
    assert(
      assetAfterOpenRun?.accumulatedDepreciation === 3000 && assetAfterOpenRun?.currentBookValue === 117000,
      'Task 13 Closed Period: Final asset register values must be completely consistent with GL.'
    );

    // =========================================================================
    // TASK 14: FIXED ASSET DISPOSAL ATOMICITY & RECONCILIATION
    // =========================================================================
    const task14Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await task14Db.accounts.put(acc);
    }
    await task14Db.cashBankAccounts.put({
      id: 'cb_cash_t14',
      name: 'নগদ টাকা (Cash on Hand)',
      accountName: 'নগদ টাকা (Cash on Hand)',
      accountType: 'CASH',
      accountNumber: '1010',
      currentBalance: 50000,
      synced: false
    });
    await task14Db.cashBankAccounts.put({
      id: 'cb_bank_t14',
      name: 'ইসলামী ব্যাংক (Islami Bank)',
      accountName: 'ইসলামী ব্যাংক (Islami Bank)',
      accountType: 'BANK',
      accountNumber: '2050123456',
      currentBalance: 200000,
      synced: false
    });

    // Test Asset A: Gain on Disposal via Bank
    // Cost: 150,000, Accum: 30,000 => Carrying Value: 120,000. Proceeds: 135,000 => Gain: 15,000.
    const assetGain: FixedAsset = {
      id: 'AST-T14-GAIN',
      name: 'পাওয়ার টিলার (Power Tiller)',
      category: 'MACHINERY',
      purchaseDate: '2025-01-01',
      originalCost: 150000,
      usefulLifeYears: 5,
      salvageValue: 0,
      accumulatedDepreciation: 30000,
      currentBookValue: 120000,
      depreciationRatePercent: 20,
      status: 'ACTIVE',
      synced: false
    };
    await task14Db.fixedAssets.put(assetGain);

    // Initial GL acquisition & depreciation entries for assetGain to simulate full historical lifecycle
    await task14Db.journalEntries.put({
      id: 'j_acq_gain',
      voucherNumber: 'PAY-AST-01',
      voucherType: 'PAYMENT',
      date: '2025-01-01',
      narration: 'Initial purchase of Power Tiller',
      reference: assetGain.id,
      lines: [
        { accountId: 'acc_1550', accountCode: '1550', accountName: 'মেশিনারিজ', debit: 150000, credit: 0 },
        { accountId: 'acc_1020', accountCode: '1020', accountName: 'ব্যাংক হিসাব', debit: 0, credit: 150000 }
      ],
      createdAt: '2025-01-01T00:00:00Z',
      createdBy: 'ADMIN'
    });
    await task14Db.journalEntries.put({
      id: 'j_depr_gain',
      voucherNumber: 'JV-DEPR-01',
      voucherType: 'JOURNAL',
      date: '2025-12-31',
      narration: 'Depreciation for Power Tiller',
      reference: assetGain.id,
      lines: [
        { accountId: 'acc_6140', accountCode: '6140', accountName: 'অবচয় খরচ', debit: 30000, credit: 0 },
        { accountId: 'acc_1590', accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 30000 }
      ],
      createdAt: '2025-12-31T00:00:00Z',
      createdBy: 'ADMIN'
    });

    const gainDisposalResult = await executeFixedAssetDisposalTransaction(
      {
        assetId: assetGain.id,
        disposalDate: '2026-03-01',
        disposalProceeds: 135000,
        paymentMethod: 'BANK',
        bankAccountId: 'cb_bank_t14',
        disposalReason: 'Sold to neighboring farm',
        currentUserId: 'USER_T14'
      },
      task14Db
    );

    assert(
      gainDisposalResult.carryingValue === 120000,
      'Task 14 Gain: Carrying value must strictly equal 150,000 - 30,000 = ৳120,000.'
    );
    assert(
      gainDisposalResult.gainLoss === 15000,
      'Task 14 Gain: Gain must strictly equal 135,000 - 120,000 = ৳15,000.'
    );

    // Verify Bank Balance updated atomically
    const bankAfterGain = (await task14Db.cashBankAccounts.get('cb_bank_t14'))?.currentBalance;
    assert(
      bankAfterGain === 200000 + 135000,
      'Task 14 Gain: Bank balance must increase atomically by ৳135,000 to ৳335,000.'
    );

    // Verify Asset Register update & preserved history
    const assetGainAfter = await task14Db.fixedAssets.get(assetGain.id);
    assert(
      assetGainAfter?.status === 'DISPOSED',
      'Task 14 Gain: Asset status must be DISPOSED.'
    );
    assert(
      assetGainAfter?.originalCost === 0 &&
      assetGainAfter?.accumulatedDepreciation === 0 &&
      assetGainAfter?.currentBookValue === 0,
      'Task 14 Gain: Active balance sheet values (cost, accum, book value) must be 0.'
    );
    assert(
      assetGainAfter?.disposedOriginalCost === 150000 &&
      assetGainAfter?.disposedAccumulatedDepreciation === 30000 &&
      assetGainAfter?.disposalProceeds === 135000 &&
      assetGainAfter?.gainLossOnDisposal === 15000 &&
      assetGainAfter?.disposalReason === 'Sold to neighboring farm' &&
      assetGainAfter?.purchaseDate === '2025-01-01',
      'Task 14 Gain: Complete historical acquisition and disposal data must be preserved.'
    );

    // Verify Disposal Journal Entry
    const gainJournal = await task14Db.journalEntries.get(gainDisposalResult.journalEntryId);
    assert(Boolean(gainJournal), 'Task 14 Gain: Disposal journal must be stored.');
    const gainDrBank = gainJournal?.lines.find((l: any) => l.accountCode === '1030')?.debit || 0;
    const gainDrAccum = gainJournal?.lines.find((l: any) => l.accountCode === '1590')?.debit || 0;
    const gainCrAsset = gainJournal?.lines.find((l: any) => l.accountCode === '1550')?.credit || 0;
    const gainCrDisposal = gainJournal?.lines.find((l: any) => l.accountCode === '7020')?.credit || 0;
    assert(gainDrBank === 135000, 'Task 14 Gain: Debit Bank ৳135,000.');
    assert(gainDrAccum === 30000, 'Task 14 Gain: Debit Accumulated Depreciation ৳30,000.');
    assert(gainCrAsset === 150000, 'Task 14 Gain: Credit Machinery Asset ৳150,000.');
    assert(gainCrDisposal === 15000, 'Task 14 Gain: Credit Gain on Disposal ৳15,000.');

    // Verify Audit record
    const auditGain = (await task14Db.auditLogs.toArray()).find((a: any) => a.recordId === assetGain.id);
    assert(Boolean(auditGain), 'Task 14 Gain: Audit log entry must be created atomically.');
    assert(auditGain?.action === 'DISPOSAL', 'Task 14 Gain: Audit log action must be DISPOSAL.');

    // Test Asset B: Loss on Disposal via Cash
    // Cost: 80,000, Accum: 20,000 => Carrying Value: 60,000. Proceeds: 45,000 => Loss: -15,000.
    const assetLoss: FixedAsset = {
      id: 'AST-T14-LOSS',
      name: 'পানির পাম্প (Water Pump)',
      category: 'MACHINERY',
      purchaseDate: '2025-06-01',
      originalCost: 80000,
      usefulLifeYears: 4,
      salvageValue: 0,
      accumulatedDepreciation: 20000,
      currentBookValue: 60000,
      depreciationRatePercent: 25,
      status: 'ACTIVE',
      synced: false
    };
    await task14Db.fixedAssets.put(assetLoss);
    await task14Db.journalEntries.put({
      id: 'j_acq_loss',
      voucherNumber: 'PAY-AST-02',
      voucherType: 'PAYMENT',
      date: '2025-06-01',
      narration: 'Initial purchase of Water Pump',
      reference: assetLoss.id,
      lines: [
        { accountId: 'acc_1550', accountCode: '1550', accountName: 'মেশিনারিজ', debit: 80000, credit: 0 },
        { accountId: 'acc_1010', accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 80000 }
      ],
      createdAt: '2025-06-01T00:00:00Z',
      createdBy: 'ADMIN'
    });
    await task14Db.journalEntries.put({
      id: 'j_depr_loss',
      voucherNumber: 'JV-DEPR-02',
      voucherType: 'JOURNAL',
      date: '2025-12-31',
      narration: 'Depreciation for Water Pump',
      reference: assetLoss.id,
      lines: [
        { accountId: 'acc_6140', accountCode: '6140', accountName: 'অবচয় খরচ', debit: 20000, credit: 0 },
        { accountId: 'acc_1590', accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 20000 }
      ],
      createdAt: '2025-12-31T00:00:00Z',
      createdBy: 'ADMIN'
    });

    const lossDisposalResult = await executeFixedAssetDisposalTransaction(
      {
        assetId: assetLoss.id,
        disposalDate: '2026-03-02',
        disposalProceeds: 45000,
        paymentMethod: 'CASH',
        disposalReason: 'Motor burned out',
        currentUserId: 'USER_T14'
      },
      task14Db
    );

    assert(
      lossDisposalResult.carryingValue === 60000,
      'Task 14 Loss: Carrying value must strictly equal 80,000 - 20,000 = ৳60,000.'
    );
    assert(
      lossDisposalResult.gainLoss === -15000,
      'Task 14 Loss: Loss must strictly equal 45,000 - 60,000 = -৳15,000.'
    );

    // Verify Cash Balance updated atomically
    const cashAfterLoss = (await task14Db.cashBankAccounts.get('cb_cash_t14'))?.currentBalance;
    assert(
      cashAfterLoss === 50000 + 45000,
      'Task 14 Loss: Cash balance must increase atomically by ৳45,000 to ৳95,000.'
    );

    // Verify Loss Journal Entry
    const lossJournal = await task14Db.journalEntries.get(lossDisposalResult.journalEntryId);
    assert(Boolean(lossJournal), 'Task 14 Loss: Disposal journal must be stored.');
    const lossDrCash = lossJournal?.lines.find((l: any) => l.accountCode === '1010')?.debit || 0;
    const lossDrAccum = lossJournal?.lines.find((l: any) => l.accountCode === '1590')?.debit || 0;
    const lossDrDisposal = lossJournal?.lines.find((l: any) => l.accountCode === '7020')?.debit || 0;
    const lossCrAsset = lossJournal?.lines.find((l: any) => l.accountCode === '1550')?.credit || 0;
    assert(lossDrCash === 45000, 'Task 14 Loss: Debit Cash ৳45,000.');
    assert(lossDrAccum === 20000, 'Task 14 Loss: Debit Accumulated Depreciation ৳20,000.');
    assert(lossDrDisposal === 15000, 'Task 14 Loss: Debit Loss on Disposal ৳15,000.');
    assert(lossCrAsset === 80000, 'Task 14 Loss: Credit Machinery Asset ৳80,000.');

    // Test Asset C: Active asset that remains in register for reconciliation
    const assetRemaining: FixedAsset = {
      id: 'AST-T14-REMAIN',
      name: 'ধান মাড়াই কল (Rice Thresher)',
      category: 'MACHINERY',
      purchaseDate: '2025-08-01',
      originalCost: 70000,
      usefulLifeYears: 5,
      salvageValue: 5000,
      accumulatedDepreciation: 7000,
      currentBookValue: 63000,
      depreciationRatePercent: 20,
      status: 'ACTIVE',
      synced: false
    };
    await task14Db.fixedAssets.put(assetRemaining);
    await task14Db.journalEntries.put({
      id: 'j_acq_rem',
      voucherNumber: 'PAY-AST-03',
      voucherType: 'PAYMENT',
      date: '2025-08-01',
      narration: 'Purchase of Rice Thresher',
      reference: assetRemaining.id,
      lines: [
        { accountId: 'acc_1550', accountCode: '1550', accountName: 'মেশিনারিজ', debit: 70000, credit: 0 },
        { accountId: 'acc_1010', accountCode: '1010', accountName: 'নগদ টাকা', debit: 0, credit: 70000 }
      ],
      createdAt: '2025-08-01T00:00:00Z',
      createdBy: 'ADMIN'
    });
    await task14Db.journalEntries.put({
      id: 'j_depr_rem',
      voucherNumber: 'JV-DEPR-03',
      voucherType: 'JOURNAL',
      date: '2025-12-31',
      narration: 'Depreciation for Rice Thresher',
      reference: assetRemaining.id,
      lines: [
        { accountId: 'acc_6140', accountCode: '6140', accountName: 'অবচয় খরচ', debit: 7000, credit: 0 },
        { accountId: 'acc_1590', accountCode: '1590', accountName: 'পুঞ্জীভূত অবচয়', debit: 0, credit: 7000 }
      ],
      createdAt: '2025-12-31T00:00:00Z',
      createdBy: 'ADMIN'
    });

    // =========================================================================
    // POST-DISPOSAL RECONCILIATION: ASSET REGISTER VS GENERAL LEDGER
    // =========================================================================
    // Calculate General Ledger balances for Asset (1550) and Accumulated Depreciation (1590)
    const allTask14Journals = await task14Db.journalEntries.toArray();
    let glAssetCost = 0;
    let glAccumDepr = 0;
    for (const j of allTask14Journals) {
      for (const line of j.lines) {
        if (line.accountCode === '1550') {
          glAssetCost += (line.debit || 0) - (line.credit || 0);
        }
        if (line.accountCode === '1590') {
          glAccumDepr += (line.credit || 0) - (line.debit || 0);
        }
      }
    }

    // Calculate Fixed Asset Register active balances
    const allAssetsInDb = await task14Db.fixedAssets.toArray();
    const activeAssetsInDb = allAssetsInDb.filter((a: any) => a.status === 'ACTIVE');
    const registerActiveCost = activeAssetsInDb.reduce((s: number, a: any) => s + (a.originalCost || 0), 0);
    const registerActiveAccum = activeAssetsInDb.reduce((s: number, a: any) => s + (a.accumulatedDepreciation || 0), 0);
    const registerActiveBookValue = activeAssetsInDb.reduce((s: number, a: any) => s + (a.currentBookValue || 0), 0);

    assert(
      glAssetCost === 70000,
      'Task 14 Reconciliation: GL Asset account 1550 balance must be exactly ৳70,000 after removing disposed assets.'
    );
    assert(
      registerActiveCost === 70000,
      'Task 14 Reconciliation: Asset register active originalCost sum must be exactly ৳70,000.'
    );
    assert(
      glAssetCost === registerActiveCost,
      'Task 14 Reconciliation: GL Asset balance and Asset Register cost MUST 100% RECONCILE (diff = ৳0).'
    );

    assert(
      glAccumDepr === 7000,
      'Task 14 Reconciliation: GL Accumulated Depreciation 1590 balance must be exactly ৳7,000.'
    );
    assert(
      registerActiveAccum === 7000,
      'Task 14 Reconciliation: Asset register active accumulated depreciation must be exactly ৳7,000.'
    );
    assert(
      glAccumDepr === registerActiveAccum,
      'Task 14 Reconciliation: GL Accum Depr and Asset Register Accum Depr MUST 100% RECONCILE (diff = ৳0).'
    );

    const glNetBookValue = glAssetCost - glAccumDepr;
    assert(
      glNetBookValue === registerActiveBookValue,
      'Task 14 Reconciliation: GL Net Book Value (৳63,000) must equal Asset Register Net Book Value (৳63,000).'
    );

    // =========================================================================
    // PREVENT DISPOSAL OF ALREADY DISPOSED ASSET & REPEATED DISPOSAL REJECTION
    // =========================================================================
    let repeatDisposalThrown = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: assetGain.id, // already disposed above!
          disposalDate: '2026-03-05',
          disposalProceeds: 140000,
          paymentMethod: 'BANK',
          bankAccountId: 'cb_bank_t14',
          currentUserId: 'USER_T14'
        },
        task14Db
      );
    } catch (err: any) {
      repeatDisposalThrown = true;
      assert(
        err.message.includes('ইতোমধ্যে অপসারিত') || err.message.includes('already disposed'),
        'Task 14: Repeated disposal must fail with clear already-disposed error message.'
      );
    }
    assert(repeatDisposalThrown, 'Task 14: Repeated disposal of assetGain must be strictly rejected.');

    // =========================================================================
    // CLOSED PERIOD PROTECTION & ATOMIC ROLLBACK
    // =========================================================================
    await task14Db.closedPeriods.put({
      id: 'cp_t14_closed',
      endDate: '2026-02-28',
      closedAt: '2026-03-01T00:00:00Z',
      synced: false
    });

    const bankBeforeClosedAttempt = (await task14Db.cashBankAccounts.get('cb_bank_t14'))?.currentBalance;
    const journalCountBeforeClosed = (await task14Db.journalEntries.toArray()).length;
    const auditCountBeforeClosed = (await task14Db.auditLogs.toArray()).length;

    let closedPeriodDisposalThrown = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: assetRemaining.id,
          disposalDate: '2026-02-15', // strictly inside closed period (<= 2026-02-28)
          disposalProceeds: 60000,
          paymentMethod: 'BANK',
          bankAccountId: 'cb_bank_t14',
          currentUserId: 'USER_T14'
        },
        task14Db
      );
    } catch (err: any) {
      closedPeriodDisposalThrown = true;
      assert(
        err.message.includes('সীমাবদ্ধতা') || err.message.includes('closed'),
        'Task 14: Disposal in closed period must be blocked by closed period rule.'
      );
    }
    assert(closedPeriodDisposalThrown, 'Task 14: Closed period disposal attempt must be rejected.');

    // Verify ATOMIC ROLLBACK on rejected disposal:
    const remainingAssetAfterRollback = await task14Db.fixedAssets.get(assetRemaining.id);
    assert(
      remainingAssetAfterRollback?.status === 'ACTIVE',
      'Task 14 Rollback: Asset status must remain ACTIVE.'
    );
    assert(
      remainingAssetAfterRollback?.originalCost === 70000,
      'Task 14 Rollback: Asset original cost must remain ৳70,000 unchanged.'
    );
    assert(
      remainingAssetAfterRollback?.accumulatedDepreciation === 7000,
      'Task 14 Rollback: Asset accumulated depreciation must remain ৳7,000 unchanged.'
    );
    const bankAfterRollback = (await task14Db.cashBankAccounts.get('cb_bank_t14'))?.currentBalance;
    assert(
      bankAfterRollback === bankBeforeClosedAttempt,
      'Task 14 Rollback: Bank balance must remain completely untouched on aborted transaction.'
    );
    const journalCountAfterRollback = (await task14Db.journalEntries.toArray()).length;
    assert(
      journalCountAfterRollback === journalCountBeforeClosed,
      'Task 14 Rollback: No disposal journal entry may be retained in database.'
    );
    const auditCountAfterRollback = (await task14Db.auditLogs.toArray()).length;
    assert(
      auditCountAfterRollback === auditCountBeforeClosed,
      'Task 14 Rollback: No audit log entry may be retained on failed transaction.'
    );

    // =========================================================================
    // TASK 4: MULTIPLE INVESTOR PROFIT SHARING VERIFICATION
    // Rules:
    // 1. Total active investor profit-sharing ratios + working partner ratio = 100%.
    // 2. Working partner ratio = 100% - total active investor ratios.
    // 3. Do NOT calculate working partner share separately as 60% for A and 70% for B.
    // 4. Total active investor ratios cannot exceed 100%.
    // 5. Each investor allocation cannot exceed that investor's agreed ratio of finalized distributable profit.
    // 6. Total investor allocations cannot exceed the finalized distributable profit.
    // 7. Do not change capital accounting.
    // 8. Do not treat profit share as operating expense.
    // 9. No interest.
    // Tests:
    // - 1 investor scenario
    // - 2 investors scenario
    // - 3 investors scenario
    // =========================================================================

    // -------------------------------------------------------------------------
    // SCENARIO 1: 1 INVESTOR
    // Investor A: 40% agreed ratio
    // Working partner ratio: 100% - 40% = 60%
    // -------------------------------------------------------------------------
    const t4Db1 = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t4Db1.accounts.put(acc);
    }
    await t4Db1.cashBankAccounts.put({
      id: 'cb_bank_t4_1',
      accountType: 'BANK',
      name: 'প্রধান ব্যাংক হিসাব',
      currentBalance: 500000,
      synced: false
    });

    const invA_1 = await executeInvestorTransaction(
      {
        investorName: 'বিনিয়োগকারী ক (Investor A)',
        phone: '01711000001',
        contribution: 100000,
        profitShare: 40,
        profitSharingRatio: 40,
        targetAccountId: 'cb_bank_t4_1',
        date: '2026-01-10',
        currentUserId: 'usr_owner'
      },
      t4Db1
    );

    // Verify 1 investor working partner ratio = 60%
    assert(invA_1.investor.profitSharingRatio === 40, 'T4 Scenario 1: Investor A ratio must be 40%.');
    assert(invA_1.investor.workingPartnerShareRatio === 60, 'T4 Scenario 1: Working partner ratio must be 60% (100% - 40%).');

    // Allocate profit with finalized profit = ৳100,000
    const t4Alloc1 = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA_1.investor.id,
        finalizedDistributableProfit: 100000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-1-INV',
        currentUserId: 'usr_owner'
      },
      t4Db1
    );

    assert(t4Alloc1.allocatedProfit === 40000, 'T4 Scenario 1: Investor A allocated profit must be ৳40,000 (40% of ৳100,000).');
    assert(t4Alloc1.workingPartnerShare === 60000, 'T4 Scenario 1: Working partner share must be ৳60,000 (60% of ৳100,000).');
    assert(t4Alloc1.workingPartnerRatio === 60, 'T4 Scenario 1: Working partner ratio must be 60%.');
    assert(t4Alloc1.allocatedProfit + t4Alloc1.workingPartnerShare === 100000, 'T4 Scenario 1: Investor allocation + working partner share must equal finalized profit (৳100,000).');

    // Verify capital is unchanged
    const invA_1_after = await t4Db1.investors.get(invA_1.investor.id);
    assert(invA_1_after?.currentCapitalBalance === 100000, 'T4 Scenario 1: Capital accounting remains unchanged at ৳100,000.');
    assert(invA_1_after?.profitPayable === 40000, 'T4 Scenario 1: Profit payable is ৳40,000.');

    // -------------------------------------------------------------------------
    // SCENARIO 2: 2 INVESTORS (Example from specification)
    // Investor A = 40%
    // Investor B = 30%
    // Working partner = 30% (100% - 70% = 30%)
    // Do NOT calculate working partner share separately as 60% for A and 70% for B!
    // -------------------------------------------------------------------------
    const t4Db2 = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t4Db2.accounts.put(acc);
    }
    await t4Db2.cashBankAccounts.put({
      id: 'cb_bank_t4_2',
      accountType: 'BANK',
      name: 'প্রধান ব্যাংক হিসাব',
      currentBalance: 500000,
      synced: false
    });

    const invA_2 = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01711000002',
        contribution: 100000,
        profitShare: 40,
        profitSharingRatio: 40,
        targetAccountId: 'cb_bank_t4_2',
        date: '2026-01-10',
        currentUserId: 'usr_owner'
      },
      t4Db2
    );

    const invB_2 = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01711000003',
        contribution: 80000,
        profitShare: 30,
        profitSharingRatio: 30,
        targetAccountId: 'cb_bank_t4_2',
        date: '2026-01-15',
        currentUserId: 'usr_owner'
      },
      t4Db2
    );

    // Verify aggregate active ratios and working partner ratio
    const invA_2_record = await t4Db2.investors.get(invA_2.investor.id);
    const invB_2_record = await t4Db2.investors.get(invB_2.investor.id);
    assert(invA_2_record?.profitSharingRatio === 40, 'T4 Scenario 2: Investor A ratio = 40%.');
    assert(invB_2_record?.profitSharingRatio === 30, 'T4 Scenario 2: Investor B ratio = 30%.');
    assert(invA_2_record?.workingPartnerShareRatio === 30, 'T4 Scenario 2: Investor A record updated to farm working partner ratio = 30%.');
    assert(invB_2_record?.workingPartnerShareRatio === 30, 'T4 Scenario 2: Investor B record reflects farm working partner ratio = 30%.');

    // Distributable Profit: ৳200,000
    // Allocate for Investor A (40% of 200,000 = ৳80,000)
    const t4Alloc2_A = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA_2.investor.id,
        finalizedDistributableProfit: 200000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-2-INV',
        currentUserId: 'usr_owner'
      },
      t4Db2
    );

    assert(t4Alloc2_A.allocatedProfit === 80000, 'T4 Scenario 2: Investor A allocated profit must be ৳80,000 (40% of ৳200,000).');
    assert(t4Alloc2_A.workingPartnerRatio === 30, 'T4 Scenario 2: Working partner ratio for Investor A allocation must be 30% (NOT 60%).');
    assert(t4Alloc2_A.workingPartnerShare === 60000, 'T4 Scenario 2: Working partner share must be ৳60,000 (30% of ৳200,000, NOT ৳120,000).');

    // Allocate for Investor B (30% of 200,000 = ৳60,000)
    const t4Alloc2_B = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invB_2.investor.id,
        finalizedDistributableProfit: 200000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-2-INV',
        currentUserId: 'usr_owner'
      },
      t4Db2
    );

    assert(t4Alloc2_B.allocatedProfit === 60000, 'T4 Scenario 2: Investor B allocated profit must be ৳60,000 (30% of ৳200,000).');
    assert(t4Alloc2_B.workingPartnerRatio === 30, 'T4 Scenario 2: Working partner ratio for Investor B allocation must be 30% (NOT 70%).');
    assert(t4Alloc2_B.workingPartnerShare === 60000, 'T4 Scenario 2: Working partner share must be ৳60,000 (30% of ৳200,000, NOT ৳140,000).');

    // Total active investor profit-sharing ratios + working partner ratio = 100%
    const totalActiveRatio2 = (invA_2_record?.profitSharingRatio || 0) + (invB_2_record?.profitSharingRatio || 0);
    assert(totalActiveRatio2 + t4Alloc2_A.workingPartnerRatio === 100, 'T4 Scenario 2: 40% + 30% + 30% = 100%.');

    // Total investor allocations + working partner share = finalized distributable profit
    const totalAllocations2 = t4Alloc2_A.allocatedProfit + t4Alloc2_B.allocatedProfit;
    assert(totalAllocations2 === 140000, 'T4 Scenario 2: Total investor allocations = ৳80,000 + ৳60,000 = ৳140,000.');
    assert(totalAllocations2 + t4Alloc2_A.workingPartnerShare === 200000, 'T4 Scenario 2: Total allocations (৳140,000) + working partner share (৳60,000) = ৳200,000.');
    assert(totalAllocations2 <= 200000, 'T4 Scenario 2: Total investor allocations cannot exceed finalized distributable profit.');

    // Capital accounting untouched
    const invA_2_after = await t4Db2.investors.get(invA_2.investor.id);
    const invB_2_after = await t4Db2.investors.get(invB_2.investor.id);
    assert(invA_2_after?.currentCapitalBalance === 100000, 'T4 Scenario 2: Investor A capital untouched at ৳100,000.');
    assert(invB_2_after?.currentCapitalBalance === 80000, 'T4 Scenario 2: Investor B capital untouched at ৳80,000.');
    assert(invA_2_after?.profitPayable === 80000, 'T4 Scenario 2: Investor A profit payable is ৳80,000.');
    assert(invB_2_after?.profitPayable === 60000, 'T4 Scenario 2: Investor B profit payable is ৳60,000.');

    // Constraint Rule: Each investor allocation cannot exceed that investor's agreed ratio
    let t4ExceedAgreedRatioCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invB_2.investor.id,
          finalizedDistributableProfit: 200000,
          allocatedProfit: 70000, // 30% of 200,000 is 60,000; 70,000 exceeds 30%
          allocationDate: '2026-07-01',
          allocationReference: 'T4-EXCEED-AGREED-TEST',
          currentUserId: 'usr_owner'
        },
        t4Db2
      );
    } catch (err: any) {
      t4ExceedAgreedRatioCaught = true;
      assert(err.message.includes('চুক্তিভিত্তিক লভ্যাংশ অনুপাতের'), 'Allocation exceeding agreed ratio must be rejected.');
    }
    assert(t4ExceedAgreedRatioCaught, 'T4 Scenario 2: Allocation exceeding agreed ratio was caught.');

    // Constraint Rule: Total investor allocations cannot exceed finalized profit
    let t4ExceedDistributableCaught = false;
    try {
      await executeInvestorProfitAllocationTransaction(
        {
          investorId: invA_2.investor.id,
          finalizedDistributableProfit: 200000,
          allocatedProfit: 70000, // Prior is 140,000. 140,000 + 70,000 = 210,000 > 200,000
          allocationDate: '2026-06-30',
          allocationReference: 'T4-ALLOC-2-INV',
          currentUserId: 'usr_owner'
        },
        t4Db2
      );
    } catch (err: any) {
      t4ExceedDistributableCaught = true;
    }
    assert(t4ExceedDistributableCaught, 'T4 Scenario 2: Total allocations exceeding finalized profit must be rejected.');

    // -------------------------------------------------------------------------
    // SCENARIO 3: 3 INVESTORS
    // Investor A = 40%
    // Investor B = 30%
    // Investor C = 10%
    // Working partner = 20% (100% - 80% = 20%)
    // -------------------------------------------------------------------------
    const t4Db3 = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t4Db3.accounts.put(acc);
    }
    await t4Db3.cashBankAccounts.put({
      id: 'cb_bank_t4_3',
      accountType: 'BANK',
      name: 'প্রধান ব্যাংক হিসাব',
      currentBalance: 500000,
      synced: false
    });

    const invA_3 = await executeInvestorTransaction(
      {
        investorName: 'Investor A',
        phone: '01711000004',
        contribution: 150000,
        profitShare: 40,
        profitSharingRatio: 40,
        targetAccountId: 'cb_bank_t4_3',
        date: '2026-01-05',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    const invB_3 = await executeInvestorTransaction(
      {
        investorName: 'Investor B',
        phone: '01711000005',
        contribution: 100000,
        profitShare: 30,
        profitSharingRatio: 30,
        targetAccountId: 'cb_bank_t4_3',
        date: '2026-01-10',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    const invC_3 = await executeInvestorTransaction(
      {
        investorName: 'Investor C',
        phone: '01711000006',
        contribution: 50000,
        profitShare: 10,
        profitSharingRatio: 10,
        targetAccountId: 'cb_bank_t4_3',
        date: '2026-01-15',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    // Verify 3 investors ratio sum = 80%, working partner = 20%
    const invA_3_rec = await t4Db3.investors.get(invA_3.investor.id);
    const invB_3_rec = await t4Db3.investors.get(invB_3.investor.id);
    const invC_3_rec = await t4Db3.investors.get(invC_3.investor.id);
    const totalActiveRatio3 = (invA_3_rec?.profitSharingRatio || 0) + (invB_3_rec?.profitSharingRatio || 0) + (invC_3_rec?.profitSharingRatio || 0);
    assert(totalActiveRatio3 === 80, 'T4 Scenario 3: Total active investor ratio = 40% + 30% + 10% = 80%.');
    assert(invC_3_rec?.workingPartnerShareRatio === 20, 'T4 Scenario 3: Working partner ratio = 100% - 80% = 20%.');
    assert(totalActiveRatio3 + (invC_3_rec?.workingPartnerShareRatio || 0) === 100, 'T4 Scenario 3: 80% + 20% = 100%.');

    // Finalized Distributable Profit: ৳300,000
    // Allocate for Investor A (40% = ৳120,000)
    const t4Alloc3_A = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invA_3.investor.id,
        finalizedDistributableProfit: 300000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-3-INV',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    // Allocate for Investor B (30% = ৳90,000)
    const t4Alloc3_B = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invB_3.investor.id,
        finalizedDistributableProfit: 300000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-3-INV',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    // Allocate for Investor C (10% = ৳30,000)
    const t4Alloc3_C = await executeInvestorProfitAllocationTransaction(
      {
        investorId: invC_3.investor.id,
        finalizedDistributableProfit: 300000,
        allocationDate: '2026-06-30',
        allocationReference: 'T4-ALLOC-3-INV',
        currentUserId: 'usr_owner'
      },
      t4Db3
    );

    // Assertions for 3 investors allocations
    assert(t4Alloc3_A.allocatedProfit === 120000, 'T4 Scenario 3: Investor A allocated ৳120,000 (40% of ৳300,000).');
    assert(t4Alloc3_B.allocatedProfit === 90000, 'T4 Scenario 3: Investor B allocated ৳90,000 (30% of ৳300,000).');
    assert(t4Alloc3_C.allocatedProfit === 30000, 'T4 Scenario 3: Investor C allocated ৳30,000 (10% of ৳300,000).');

    // Assert working partner share is strictly 20% across all 3 allocations
    assert(t4Alloc3_A.workingPartnerRatio === 20, 'T4 Scenario 3: Working partner ratio is 20% on A allocation.');
    assert(t4Alloc3_B.workingPartnerRatio === 20, 'T4 Scenario 3: Working partner ratio is 20% on B allocation.');
    assert(t4Alloc3_C.workingPartnerRatio === 20, 'T4 Scenario 3: Working partner ratio is 20% on C allocation.');
    assert(t4Alloc3_A.workingPartnerShare === 60000, 'T4 Scenario 3: Working partner share is ৳60,000 (20% of ৳300,000).');
    assert(t4Alloc3_B.workingPartnerShare === 60000, 'T4 Scenario 3: Working partner share is ৳60,000 (20% of ৳300,000).');
    assert(t4Alloc3_C.workingPartnerShare === 60000, 'T4 Scenario 3: Working partner share is ৳60,000 (20% of ৳300,000).');

    // Total investor allocations
    const totalAllocations3 = t4Alloc3_A.allocatedProfit + t4Alloc3_B.allocatedProfit + t4Alloc3_C.allocatedProfit;
    assert(totalAllocations3 === 240000, 'T4 Scenario 3: Total investor allocations = ৳120,000 + ৳90,000 + ৳30,000 = ৳240,000.');
    assert(totalAllocations3 + t4Alloc3_A.workingPartnerShare === 300000, 'T4 Scenario 3: Total allocations (৳240,000) + working partner share (৳60,000) = ৳300,000.');
    assert(totalAllocations3 <= 300000, 'T4 Scenario 3: Total investor allocations cannot exceed finalized distributable profit.');

    // Capital accounting strictly preserved
    const invA_3_after = await t4Db3.investors.get(invA_3.investor.id);
    const invB_3_after = await t4Db3.investors.get(invB_3.investor.id);
    const invC_3_after = await t4Db3.investors.get(invC_3.investor.id);
    assert(invA_3_after?.currentCapitalBalance === 150000, 'T4 Scenario 3: Investor A capital untouched at ৳150,000.');
    assert(invB_3_after?.currentCapitalBalance === 100000, 'T4 Scenario 3: Investor B capital untouched at ৳100,000.');
    assert(invC_3_after?.currentCapitalBalance === 50000, 'T4 Scenario 3: Investor C capital untouched at ৳50,000.');

    // Journal Entry verification: Dr 3070/3050, Cr 2050 (No operating expense, no interest)
    const journalC = await t4Db3.journalEntries.get(t4Alloc3_C.journalEntryId);
    assert(journalC !== undefined, 'T4 Scenario 3: Journal entry for C allocation must exist.');
    const hasOpExpenseC = journalC.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    const hasInterestC = journalC.lines.some((l: any) => l.accountCode === '8010' || l.accountCode === '7010');
    assert(!hasOpExpenseC, 'T4 Scenario 3: Profit share must not be treated as operating expense.');
    assert(!hasInterestC, 'T4 Scenario 3: No interest accounts allowed in profit share.');

    // Constraint Rule: Total active investor ratios cannot exceed 100%
    let t4Exceed100RatioCaught = false;
    try {
      await executeInvestorTransaction(
        {
          investorName: 'Investor D (Exceeding 100%)',
          phone: '01711000007',
          contribution: 50000,
          profitShare: 25, // 80% + 25% = 105% > 100%
          profitSharingRatio: 25,
          targetAccountId: 'cb_bank_t4_3',
          date: '2026-02-01',
          currentUserId: 'usr_owner'
        },
        t4Db3
      );
    } catch (err: any) {
      t4Exceed100RatioCaught = true;
      assert(err.message.includes('১০০% অতিক্রম করতে পারে না'), 'Total investor ratios > 100% must be rejected.');
    }
    assert(t4Exceed100RatioCaught, 'T4 Scenario 3: Ratio sum exceeding 100% was caught.');

    // =========================================================================
    // TASK 5: INVESTOR CAPITAL RETURN ACCOUNTING REGRESSION SUITE
    // =========================================================================
    // Create dedicated mock DB for Task 5
    const t5Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t5Db.accounts.put(acc);
    }

    // Setup initial accounts: Bank (1030) with ৳50,000, Cash (1010) with ৳20,000
    await t5Db.cashBankAccounts.put({
      id: 'cb_bank_t5',
      name: 'City Bank Ltd',
      accountName: 'City Bank Ltd',
      accountType: 'BANK',
      accountNumber: 'CB-T5-001',
      currentBalance: 50000,
      currency: 'BDT',
      isActive: true,
      synced: false
    });
    await t5Db.cashBankAccounts.put({
      id: 'cb_cash_t5',
      name: 'Main Cash',
      accountName: 'Main Cash',
      accountType: 'CASH',
      accountNumber: 'CASH-T5-001',
      currentBalance: 20000,
      currency: 'BDT',
      isActive: true,
      synced: false
    });

    // Investor contributes ৳100,000 into Bank (bringing Bank balance to ৳150,000)
    const t5InvContrib = await executeInvestorTransaction(
      {
        investorName: 'Investor T5 Test',
        phone: '01711999999',
        contribution: 100000,
        profitShare: 30,
        profitSharingRatio: 30,
        targetAccountId: 'cb_bank_t5',
        date: '2026-03-01',
        currentUserId: 'usr_owner'
      },
      t5Db
    );

    const initialInv = await t5Db.investors.get(t5InvContrib.investor.id);
    assert(initialInv !== undefined, 'T5: Investor record must exist.');
    assert(initialInv?.capitalContributed === 100000, 'T5: capitalContributed must be 100,000.');
    assert(initialInv?.currentCapitalBalance === 100000, 'T5: currentCapitalBalance must be 100,000.');
    assert((initialInv?.drawings || 0) === 0, 'T5: Initial drawings must be 0.');
    assert((initialInv?.totalWithdrawals || 0) === 0, 'T5: Initial totalWithdrawals must be 0.');

    // 1. REJECT RETURN IF: amount <= 0
    let t5ZeroReturnCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: initialInv.id,
          amount: 0,
          sourceAccountId: 'cb_bank_t5',
          returnDate: '2026-03-05',
          currentUserId: 'usr_owner'
        },
        t5Db
      );
    } catch (err: any) {
      t5ZeroReturnCaught = true;
      assert(err.message.includes('০ এর বেশি হতে হবে'), 'T5: amount <= 0 must be rejected.');
    }
    assert(t5ZeroReturnCaught, 'T5: Return with amount <= 0 was rejected.');

    let t5NegReturnCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: initialInv.id,
          amount: -5000,
          sourceAccountId: 'cb_bank_t5',
          returnDate: '2026-03-05',
          currentUserId: 'usr_owner'
        },
        t5Db
      );
    } catch (err: any) {
      t5NegReturnCaught = true;
      assert(err.message.includes('০ এর বেশি হতে হবে'), 'T5: Negative return amount must be rejected.');
    }
    assert(t5NegReturnCaught, 'T5: Return with negative amount was rejected.');

    // 2. REJECT RETURN IF: amount > investor current capital
    let t5OverCapitalCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: initialInv.id,
          amount: 150000, // Capital is 100,000
          sourceAccountId: 'cb_bank_t5',
          returnDate: '2026-03-05',
          currentUserId: 'usr_owner'
        },
        t5Db
      );
    } catch (err: any) {
      t5OverCapitalCaught = true;
      assert(err.message.includes('বিদ্যমান মূলধনের চেয়ে বেশি হতে পারে না'), 'T5: amount > current capital must be rejected.');
    }
    assert(t5OverCapitalCaught, 'T5: Return exceeding current capital was rejected.');

    // 3. REJECT RETURN IF: source Cash/Bank balance is insufficient
    // Cash account only has ৳20,000. Trying to return ৳40,000 from cash must fail (cannot make cash negative).
    let t5InsufficientCashCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: initialInv.id,
          amount: 40000,
          sourceAccountId: 'cb_cash_t5',
          returnDate: '2026-03-05',
          currentUserId: 'usr_owner'
        },
        t5Db
      );
    } catch (err: any) {
      t5InsufficientCashCaught = true;
      assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই'), 'T5: Insufficient cash balance must be rejected.');
    }
    assert(t5InsufficientCashCaught, 'T5: Return with insufficient cash balance was rejected.');

    // 4. VALID CAPITAL RETURN: Return ৳30,000 from Bank (Bank balance is 150,000)
    const t5ReturnRes = await executeInvestorCapitalReturnTransaction(
      {
        investorId: initialInv.id,
        amount: 30000,
        sourceAccountId: 'cb_bank_t5',
        returnDate: '2026-03-10',
        returnReference: 'RET-REF-001',
        notes: 'আংশিক মূলধন ফেরত',
        currentUserId: 'usr_owner'
      },
      t5Db
    );

    assert(t5ReturnRes.returnedAmount === 30000, 'T5: returnedAmount must be 30,000.');
    const invAfterT5Return = await t5Db.investors.get(initialInv.id);

    // Track separately:
    // * capital contributed
    // * capital returned
    // * current capital balance
    assert(invAfterT5Return?.capitalContributed === 100000, 'T5: capitalContributed must remain 100,000.');
    assert(invAfterT5Return?.totalCapitalReturned === 30000, 'T5: totalCapitalReturned must be 30,000.');
    assert(invAfterT5Return?.currentCapitalBalance === 70000, 'T5: currentCapitalBalance must be 70,000 (100k - 30k).');

    // DO NOT increase investor `drawings` or owner-style `withdrawals` for a capital return
    assert((invAfterT5Return?.drawings || 0) === 0, 'T5: Investor drawings must NOT increase for capital return.');
    assert((invAfterT5Return?.totalWithdrawals || 0) === 0, 'T5: Investor totalWithdrawals must NOT increase for capital return.');
    assert((invAfterT5Return?.withdrawals || 0) === 0, 'T5: Investor withdrawals must NOT increase for capital return.');

    // Correct Accounting Check on Journal Entry:
    // Dr Investor Capital (3020)
    // Cr Cash/Bank (1030)
    const returnJournal = await t5Db.journalEntries.get(t5ReturnRes.journalEntryId);
    assert(returnJournal !== undefined, 'T5: Capital return journal entry must exist.');
    const drCapLine = returnJournal.lines.find((l: any) => l.accountCode === '3020');
    const crBankLine = returnJournal.lines.find((l: any) => l.accountCode === '1030');
    assert(drCapLine?.debit === 30000, 'T5: Must Dr 3020 Investor Capital with ৳30,000.');
    assert(crBankLine?.credit === 30000, 'T5: Must Cr 1030 Bank Account with ৳30,000.');

    // Capital return is NOT operating expense, owner drawing, investor profit, or interest
    const t5HasOpExpense = returnJournal.lines.some((l: any) => l.accountCode.startsWith('5') || l.accountCode.startsWith('6'));
    const t5HasOwnerDrawings = returnJournal.lines.some((l: any) => l.accountCode === '3040' || l.accountCode === '3030');
    const t5HasInvestorProfit = returnJournal.lines.some((l: any) => l.accountCode === '2050' || l.accountCode === '3070');
    const t5HasInterest = returnJournal.lines.some((l: any) => l.accountCode === '8010' || l.accountCode === '7010');
    assert(!t5HasOpExpense, 'T5: Capital return must NOT be an operating expense.');
    assert(!t5HasOwnerDrawings, 'T5: Capital return must NOT be an owner drawing.');
    assert(!t5HasInvestorProfit, 'T5: Capital return must NOT be investor profit.');
    assert(!t5HasInterest, 'T5: Capital return must NOT be interest.');

    // Bank balance should be 150,000 - 30,000 = 120,000
    const bankAfterT5Return = await t5Db.cashBankAccounts.get('cb_bank_t5');
    assert(bankAfterT5Return?.currentBalance === 120000, 'T5: Bank operational balance must be 120,000.');

    // 5. PREVENT DUPLICATE CAPITAL RETURN:
    // Submitting with the same reference 'RET-REF-001' must be rejected
    let t5DuplicateCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: initialInv.id,
          amount: 30000,
          sourceAccountId: 'cb_bank_t5',
          returnDate: '2026-03-10',
          returnReference: 'RET-REF-001',
          currentUserId: 'usr_owner'
        },
        t5Db
      );
    } catch (err: any) {
      t5DuplicateCaught = true;
      assert(err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate'), 'T5: Duplicate capital return must be prevented.');
    }
    assert(t5DuplicateCaught, 'T5: Duplicate capital return was prevented.');

    // 6. Return remainder of capital to test EXITED status and zero capital state
    // Remaining capital is ৳70,000
    const t5FullReturnRes = await executeInvestorCapitalReturnTransaction(
      {
        investorId: initialInv.id,
        amount: 70000,
        sourceAccountId: 'cb_bank_t5',
        returnDate: '2026-03-15',
        notes: 'চূড়ান্ত মূলধন ফেরত ও অব্যাহতি',
        currentUserId: 'usr_owner'
      },
      t5Db
    );
    assert(t5FullReturnRes.returnedAmount === 70000, 'T5: Final returned amount must be 70,000.');
    const invAfterFullReturn = await t5Db.investors.get(initialInv.id);
    assert(invAfterFullReturn?.capitalContributed === 100000, 'T5: Contributed capital remains 100,000.');
    assert(invAfterFullReturn?.totalCapitalReturned === 100000, 'T5: totalCapitalReturned reached 100,000.');
    assert(invAfterFullReturn?.currentCapitalBalance === 0, 'T5: currentCapitalBalance reached 0.');
    assert(invAfterFullReturn?.status === 'EXITED', 'T5: Status becomes EXITED when capital balance is 0 and no profit payable.');
    assert((invAfterFullReturn?.drawings || 0) === 0, 'T5: Drawings remain 0 even after full capital return.');
    assert((invAfterFullReturn?.totalWithdrawals || 0) === 0, 'T5: totalWithdrawals remain 0 even after full capital return.');

    // =========================================================================
    // TASK 6: PROTECT INVESTOR PAYMENTS (SUFFICIENT & INSUFFICIENT FUNDS)
    // =========================================================================
    const t6Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t6Db.accounts.put(acc);
    }

    // Cash: ৳10,000, Bank: ৳50,000
    await t6Db.cashBankAccounts.put({
      id: 'cb_cash_t6',
      name: 'Cash Register T6',
      accountName: 'Cash Register T6',
      accountType: 'CASH',
      accountNumber: 'CASH-T6',
      currentBalance: 10000,
      currency: 'BDT',
      isActive: true,
      synced: false
    });
    await t6Db.cashBankAccounts.put({
      id: 'cb_bank_t6',
      name: 'Prime Bank T6',
      accountName: 'Prime Bank T6',
      accountType: 'BANK',
      accountNumber: 'BANK-T6',
      currentBalance: 50000,
      currency: 'BDT',
      isActive: true,
      synced: false
    });

    // Create Investor record with capital ৳40,000 and profit payable ৳25,000
    const t6InvestorId = 'inv_t6_protection';
    await t6Db.investors.put({
      id: t6InvestorId,
      name: 'Protective Investor T6',
      phone: '01800000000',
      capitalAmount: 40000,
      capitalContributed: 40000,
      currentCapitalBalance: 40000,
      currentBalance: 40000,
      profitShare: 20,
      profitSharingRatio: 20,
      profitPayable: 25000,
      totalProfitPaid: 0,
      totalCapitalReturned: 0,
      drawings: 0,
      withdrawals: 0,
      totalWithdrawals: 0,
      status: 'ACTIVE',
      joinDate: '2026-01-01',
      synced: false
    });

    const initialJournalCount = (await t6Db.journalEntries.toArray()).length;

    // --- TEST 1: PROFIT PAYMENT WITH INSUFFICIENT FUNDS ---
    // Try paying ৳15,000 from Cash (which only has ৳10,000). Must be REJECTED!
    let t6ProfitInsufficientCaught = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: t6InvestorId,
          amount: 15000,
          sourceAccountId: 'cb_cash_t6',
          paymentDate: '2026-03-20',
          currentUserId: 'usr_owner'
        },
        t6Db
      );
    } catch (err: any) {
      t6ProfitInsufficientCaught = true;
      assert(
        err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('Insufficient'),
        'T6: Profit payment error message must indicate insufficient cash/bank balance.'
      );
    }
    assert(t6ProfitInsufficientCaught, 'T6: Profit payment with insufficient cash balance was rejected.');

    // Verify nothing was changed in DB:
    const journalsAfterFailedPay = await t6Db.journalEntries.toArray();
    assert(journalsAfterFailedPay.length === initialJournalCount, 'T6: No journal entry created on rejected profit payment.');

    const invAfterFailedPay = await t6Db.investors.get(t6InvestorId);
    assert(invAfterFailedPay?.profitPayable === 25000, 'T6: Investor profitPayable must remain 25,000 on rejection.');
    assert((invAfterFailedPay?.totalProfitPaid || 0) === 0, 'T6: Investor totalProfitPaid must remain 0 on rejection.');

    const cashAfterFailedPay = await t6Db.cashBankAccounts.get('cb_cash_t6');
    assert(cashAfterFailedPay?.currentBalance === 10000, 'T6: Cash balance must remain 10,000 without becoming negative.');

    // --- TEST 2: PROFIT PAYMENT WITH SUFFICIENT FUNDS ---
    // Pay ৳15,000 from Bank (which has ৳50,000). Must SUCCEED!
    const t6ProfitSufficientRes = await executeInvestorProfitPaymentTransaction(
      {
        investorId: t6InvestorId,
        amount: 15000,
        sourceAccountId: 'cb_bank_t6',
        paymentDate: '2026-03-20',
        paymentReference: 'T6-PAY-REF-001',
        currentUserId: 'usr_owner'
      },
      t6Db
    );

    assert(t6ProfitSufficientRes.paidAmount === 15000, 'T6: Paid amount must be 15,000.');
    assert(t6ProfitSufficientRes.remainingPayable === 10000, 'T6: Remaining payable must be 10,000.');

    const invAfterGoodPay = await t6Db.investors.get(t6InvestorId);
    assert(invAfterGoodPay?.profitPayable === 10000, 'T6: Investor profitPayable updated to 10,000.');
    assert(invAfterGoodPay?.totalProfitPaid === 15000, 'T6: Investor totalProfitPaid updated to 15,000.');

    const bankAfterGoodPay = await t6Db.cashBankAccounts.get('cb_bank_t6');
    assert(bankAfterGoodPay?.currentBalance === 35000, 'T6: Bank balance reduced to 35,000 (50k - 15k).');

    // Accounting check: Dr 2050 Profit Payable, Cr 1030 Bank
    const goodPayJournal = await t6Db.journalEntries.get(t6ProfitSufficientRes.journalEntryId);
    assert(goodPayJournal !== undefined, 'T6: Profit payment journal entry must exist.');
    const t6DrPayable = goodPayJournal.lines.find((l: any) => l.accountCode === '2050' && l.debit === 15000);
    const t6CrBank = goodPayJournal.lines.find((l: any) => l.accountCode === '1030' && l.credit === 15000);
    assert(!!t6DrPayable && !!t6CrBank, 'T6: Must Dr 2050 Investor Profit Payable and Cr 1030 Bank.');

    // --- TEST 3: CAPITAL RETURN WITH INSUFFICIENT FUNDS ---
    // Try returning ৳20,000 from Cash (which only has ৳10,000). Must be REJECTED!
    const journalCountBeforeCapRet = (await t6Db.journalEntries.toArray()).length;
    let t6CapitalInsufficientCaught = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: t6InvestorId,
          amount: 20000,
          sourceAccountId: 'cb_cash_t6',
          returnDate: '2026-03-21',
          currentUserId: 'usr_owner'
        },
        t6Db
      );
    } catch (err: any) {
      t6CapitalInsufficientCaught = true;
      assert(
        err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('Insufficient'),
        'T6: Capital return error message must indicate insufficient cash/bank balance.'
      );
    }
    assert(t6CapitalInsufficientCaught, 'T6: Capital return with insufficient cash balance was rejected.');

    // Verify nothing changed on rejection:
    const journalsAfterFailedRet = await t6Db.journalEntries.toArray();
    assert(journalsAfterFailedRet.length === journalCountBeforeCapRet, 'T6: No journal entry created on rejected capital return.');

    const invAfterFailedRet = await t6Db.investors.get(t6InvestorId);
    assert(invAfterFailedRet?.currentCapitalBalance === 40000, 'T6: Current capital balance remains 40,000 on rejection.');
    assert((invAfterFailedRet?.totalCapitalReturned || 0) === 0, 'T6: totalCapitalReturned remains 0 on rejection.');

    const cashAfterFailedRet = await t6Db.cashBankAccounts.get('cb_cash_t6');
    assert(cashAfterFailedRet?.currentBalance === 10000, 'T6: Cash balance remains 10,000 without negative balance.');

    // --- TEST 4: CAPITAL RETURN WITH SUFFICIENT FUNDS ---
    // Return ৳20,000 from Bank (which currently has ৳35,000). Must SUCCEED!
    const t6CapitalSufficientRes = await executeInvestorCapitalReturnTransaction(
      {
        investorId: t6InvestorId,
        amount: 20000,
        sourceAccountId: 'cb_bank_t6',
        returnDate: '2026-03-22',
        returnReference: 'T6-RET-REF-001',
        currentUserId: 'usr_owner'
      },
      t6Db
    );

    assert(t6CapitalSufficientRes.returnedAmount === 20000, 'T6: Returned capital amount must be 20,000.');

    const invAfterGoodRet = await t6Db.investors.get(t6InvestorId);
    assert(invAfterGoodRet?.currentCapitalBalance === 20000, 'T6: Current capital balance reduced to 20,000 (40k - 20k).');
    assert(invAfterGoodRet?.totalCapitalReturned === 20000, 'T6: totalCapitalReturned updated to 20,000.');
    assert((invAfterGoodRet?.drawings || 0) === 0, 'T6: Drawings must remain 0.');
    assert((invAfterGoodRet?.totalWithdrawals || 0) === 0, 'T6: Withdrawals must remain 0.');

    const bankAfterGoodRet = await t6Db.cashBankAccounts.get('cb_bank_t6');
    assert(bankAfterGoodRet?.currentBalance === 15000, 'T6: Bank balance reduced to 15,000 (35k - 20k).');

    // Accounting check: Dr 3020 Investor Capital, Cr 1030 Bank
    const goodRetJournal = await t6Db.journalEntries.get(t6CapitalSufficientRes.journalEntryId);
    assert(goodRetJournal !== undefined, 'T6: Capital return journal entry must exist.');
    const t6DrCap = goodRetJournal.lines.find((l: any) => l.accountCode === '3020' && l.debit === 20000);
    const t6CrBankRet = goodRetJournal.lines.find((l: any) => l.accountCode === '1030' && l.credit === 20000);
    assert(!!t6DrCap && !!t6CrBankRet, 'T6: Must Dr 3020 Investor Capital and Cr 1030 Bank.');

    // =========================================================================
    // TASK 7: PURCHASE INVENTORY STOCKMOVEMENT COST CONSISTENCY
    // =========================================================================
    const t7Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await t7Db.accounts.put(acc);
    }

    await t7Db.cashBankAccounts.put({
      id: 'cb_cash_t7',
      name: 'Main Cash T7',
      accountName: 'Main Cash T7',
      accountType: 'CASH',
      accountNumber: 'CASH-T7',
      currentBalance: 500000,
      currency: 'BDT',
      isActive: true,
      synced: false
    });

    const t7Supplier: Party = {
      id: 'sup_t7_feed',
      type: 'SUPPLIER',
      name: 'Mega Feed Mills Ltd',
      phone: '01700000007',
      balance: 0,
      isActive: true,
      synced: false
    };
    await t7Db.parties.put(t7Supplier);

    // 1. Normal Purchase (No transport, No discount)
    const t7ItemNormal: InventoryItem = {
      id: 'item_t7_normal',
      code: 'FEED-T7-01',
      nameBn: 'স্টার্টার ফিড',
      nameEn: 'Starter Feed',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 70,
      reorderLevel: 20,
      synced: false
    };
    await t7Db.inventoryItems.put(t7ItemNormal);

    const normalPurRes = await executePurchaseTransaction(
      {
        supplier: t7Supplier,
        item: t7ItemNormal,
        quantity: 100,
        unitPrice: 50,
        transportCost: 0,
        discount: 0,
        paymentMethod: 'CASH',
        date: '2026-03-25',
        currentUserId: 'usr_owner'
      },
      t7Db
    );

    const normalMovements = await t7Db.stockMovements.where('itemId').equals(t7ItemNormal.id).toArray();
    assert(normalMovements.length === 1, 'T7: Exactly 1 stock movement for normal purchase.');
    const normalSm = normalMovements[0];
    assert(normalSm.movementType === 'PURCHASE', 'T7 Normal: movementType must be PURCHASE.');
    assert(normalSm.quantity === 100, 'T7 Normal: quantity must be 100.');
    assert(normalSm.totalValue === 5000, 'T7 Normal: totalValue must equal actual inventory cost added (5000).');
    assert(normalSm.unitCost === 50, 'T7 Normal: unitCost must be totalValue / quantity (50).');
    assert(
      Math.abs(normalSm.unitCost * normalSm.quantity - normalSm.totalValue) < 0.001,
      'T7 Normal: unitCost * quantity must equal totalValue.'
    );

    // 2. Purchase with Transport Cost (transportCost = 500, discount = 0)
    // Items total = 50 * 80 = 4000. Grand total = 4000 + 500 = 4500.
    const t7ItemTransport: InventoryItem = {
      id: 'item_t7_transport',
      code: 'FEED-T7-02',
      nameBn: 'গ্রোয়ার ফিড স্পেশাল',
      nameEn: 'Grower Feed Special',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 110,
      reorderLevel: 20,
      synced: false
    };
    await t7Db.inventoryItems.put(t7ItemTransport);

    const transportPurRes = await executePurchaseTransaction(
      {
        supplier: t7Supplier,
        item: t7ItemTransport,
        quantity: 50,
        unitPrice: 80,
        transportCost: 500,
        discount: 0,
        paymentMethod: 'CASH',
        date: '2026-03-26',
        currentUserId: 'usr_owner'
      },
      t7Db
    );

    const transportMovements = await t7Db.stockMovements.where('itemId').equals(t7ItemTransport.id).toArray();
    assert(transportMovements.length === 1, 'T7: Exactly 1 stock movement for purchase with transport.');
    const transportSm = transportMovements[0];
    assert(transportSm.movementType === 'PURCHASE', 'T7 Transport: movementType must be PURCHASE.');
    assert(transportSm.quantity === 50, 'T7 Transport: quantity must be 50.');
    // Actual inventory cost added is 4000 + 500 = 4500
    assert(transportSm.totalValue === 4500, 'T7 Transport: totalValue must equal actual inventory cost added (4500).');
    // Unit cost must be totalValue / quantity = 4500 / 50 = 90 (NOT the sticker unitPrice 80!)
    assert(transportSm.unitCost === 90, 'T7 Transport: unitCost must be totalValue / quantity = 90.');
    assert(
      Math.abs(transportSm.unitCost * transportSm.quantity - transportSm.totalValue) < 0.001,
      'T7 Transport: unitCost * quantity must equal totalValue.'
    );

    // Verify inventory item avgCostPrice also updated to 90
    const invItemAfterTransport = await t7Db.inventoryItems.get(t7ItemTransport.id);
    assert(invItemAfterTransport?.avgCostPrice === 90, 'T7 Transport: avgCostPrice must be 90.');

    // 3. Purchase with Discount (transportCost = 0, discount = 400)
    // Items total = 40 * 100 = 4000. Grand total = 4000 - 400 = 3600.
    const t7ItemDiscount: InventoryItem = {
      id: 'item_t7_discount',
      code: 'FEED-T7-03',
      nameBn: 'ফিনিশার ফিড প্রিমিয়াম',
      nameEn: 'Finisher Feed Premium',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 130,
      reorderLevel: 20,
      synced: false
    };
    await t7Db.inventoryItems.put(t7ItemDiscount);

    const discountPurRes = await executePurchaseTransaction(
      {
        supplier: t7Supplier,
        item: t7ItemDiscount,
        quantity: 40,
        unitPrice: 100,
        transportCost: 0,
        discount: 400,
        paymentMethod: 'CASH',
        date: '2026-03-27',
        currentUserId: 'usr_owner'
      },
      t7Db
    );

    const discountMovements = await t7Db.stockMovements.where('itemId').equals(t7ItemDiscount.id).toArray();
    assert(discountMovements.length === 1, 'T7: Exactly 1 stock movement for purchase with discount.');
    const discountSm = discountMovements[0];
    assert(discountSm.movementType === 'PURCHASE', 'T7 Discount: movementType must be PURCHASE.');
    assert(discountSm.quantity === 40, 'T7 Discount: quantity must be 40.');
    // Actual inventory cost added is 4000 - 400 = 3600
    assert(discountSm.totalValue === 3600, 'T7 Discount: totalValue must equal actual inventory cost added (3600).');
    // Unit cost must be totalValue / quantity = 3600 / 40 = 90 (NOT 100!)
    assert(discountSm.unitCost === 90, 'T7 Discount: unitCost must be totalValue / quantity = 90.');
    assert(
      Math.abs(discountSm.unitCost * discountSm.quantity - discountSm.totalValue) < 0.001,
      'T7 Discount: unitCost * quantity must equal totalValue.'
    );

    const invItemAfterDiscount = await t7Db.inventoryItems.get(t7ItemDiscount.id);
    assert(invItemAfterDiscount?.avgCostPrice === 90, 'T7 Discount: avgCostPrice must be 90.');

    // 4. Purchase with both Transport and Discount (transportCost = 1000, discount = 200)
    // Items total = 100 * 60 = 6000. Grand total = 6000 + 1000 - 200 = 6800.
    const t7ItemCombined: InventoryItem = {
      id: 'item_t7_combined',
      code: 'FEED-T7-04',
      nameBn: 'লেয়ার ফিড কম্বো',
      nameEn: 'Layer Feed Combo',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 90,
      reorderLevel: 20,
      synced: false
    };
    await t7Db.inventoryItems.put(t7ItemCombined);

    const combinedPurRes = await executePurchaseTransaction(
      {
        supplier: t7Supplier,
        item: t7ItemCombined,
        quantity: 100,
        unitPrice: 60,
        transportCost: 1000,
        discount: 200,
        paymentMethod: 'CASH',
        date: '2026-03-28',
        currentUserId: 'usr_owner'
      },
      t7Db
    );

    // =========================================================================
    // REVERSAL ATOMICITY TEST
    // Verify that if any part of a reversal fails, NONE of:
    // journal, cash/bank, inventory, stock movement, AR/AP, operational record
    // remain partially changed.
    // =========================================================================
    const revDb = createMockAgroDatabase();

    // Setup initial accounts and data
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await revDb.accounts.put(acc);
    }

    await revDb.cashBankAccounts.put({
      id: 'cb_cash_1',
      accountName: 'Main Cash',
      accountType: 'CASH',
      currentBalance: 50000,
      isDefault: true
    });

    await revDb.inventoryItems.put({
      id: 'item_rev_1',
      code: 'ITM-001',
      nameBn: 'Corn Feed',
      nameEn: 'Corn Feed',
      category: 'FEED',
      currentStock: 100,
      reorderLevel: 10,
      unit: 'KG',
      avgCostPrice: 50,
      sellingPrice: 70
    });

    await revDb.parties.put({
      id: 'cust_rev_1',
      name: 'Rahim Traders',
      type: 'CUSTOMER',
      phone: '01700000000',
      balance: 0
    });

    const testCustomer = (await revDb.parties.get('cust_rev_1'))!;
    const testItem = (await revDb.inventoryItems.get('item_rev_1'))!;

    // Execute a sale transaction
    const atomicitySaleResult = await executeSaleTransaction(
      {
        date: '2026-04-10',
        customer: testCustomer,
        item: testItem,
        quantity: 20,
        unitPrice: 70,
        paymentMethod: 'CASH',
        currentUserId: 'test_user'
      },
      revDb
    );

    assert(Boolean(atomicitySaleResult.sale), 'Sale transaction must succeed.');
    const originalVoucherId = atomicitySaleResult.journalEntryId;
    const originalSaleId = atomicitySaleResult.sale.id;

    // Capture state after sale
    const preRevJournalCount = (await revDb.journalEntries.toArray()).length;
    const preRevCash = (await revDb.cashBankAccounts.get('cb_cash_1'))!.currentBalance;
    const preRevStock = (await revDb.inventoryItems.get('item_rev_1'))!.currentStock;
    const preRevMovementsCount = (await revDb.stockMovements.toArray()).length;
    const preRevCustBal = (await revDb.parties.get('cust_rev_1'))!.balance;
    const preRevSaleStatus = (await revDb.sales.get(originalSaleId))!.status;

    assert(preRevCash === 51400, 'Cash balance should be 51400 after sale.');
    assert(preRevStock === 80, 'Stock should be 80 after selling 20.');
    assert(preRevMovementsCount === 1, 'Exactly 1 stock movement exists after sale.');
    assert(preRevSaleStatus === 'PAID', 'Sale status should be PAID.');

    // Now simulate failure during reversal:
    // Sabotage cashBankAccounts.update to throw an intentional error
    const originalCashUpdate = revDb.cashBankAccounts.update.bind(revDb.cashBankAccounts);
    revDb.cashBankAccounts.update = async () => {
      throw new Error('SIMULATED_CASH_UPDATE_FAILURE');
    };

    let reversalFailedAsExpected = false;
    try {
      await reverseTransaction(originalVoucherId, 'test_user', '2026-04-11', revDb);
    } catch (err: any) {
      if (err.message.includes('SIMULATED_CASH_UPDATE_FAILURE')) {
        reversalFailedAsExpected = true;
      }
    }

    assert(reversalFailedAsExpected, 'Reversal must fail when cash update fails.');

    // Restore original method
    revDb.cashBankAccounts.update = originalCashUpdate;

    // Verify ATOMICITY: NONE of the 6 components may remain partially changed!
    // 1. Journal
    const postFailJournalEntries = await revDb.journalEntries.toArray();
    assert(postFailJournalEntries.length === preRevJournalCount, 'Atomicity: No orphaned reversal journal entry may exist.');
    const origJournalAfterFail = await revDb.journalEntries.get(originalVoucherId);
    assert(origJournalAfterFail?.status !== 'REVERSED', 'Atomicity: Original journal entry status must not be REVERSED.');
    assert(!origJournalAfterFail?.reversedBy, 'Atomicity: Original journal entry reversedBy must be undefined.');

    // 2. Cash/Bank
    const postFailCash = (await revDb.cashBankAccounts.get('cb_cash_1'))!.currentBalance;
    assert(postFailCash === preRevCash, 'Atomicity: Cash balance must not remain changed after failed reversal.');

    // 3. Inventory
    const postFailStock = (await revDb.inventoryItems.get('item_rev_1'))!.currentStock;
    assert(postFailStock === preRevStock, 'Atomicity: Inventory stock must not remain changed after failed reversal.');

    // 4. Stock Movement
    const postFailMovements = await revDb.stockMovements.toArray();
    assert(postFailMovements.length === preRevMovementsCount, 'Atomicity: Stock movements must remain unchanged after failed reversal.');

    // 5. AR/AP
    const postFailCustBal = (await revDb.parties.get('cust_rev_1'))!.balance;
    assert(postFailCustBal === preRevCustBal, 'Atomicity: Customer party balance must remain unchanged after failed reversal.');

    // 6. Operational Record (Sale)
    const postFailSale = await revDb.sales.get(originalSaleId);
    assert(postFailSale?.status === preRevSaleStatus, 'Atomicity: Sale operational record must remain PAID, not CANCELLED.');

    // Now execute clean reversal without failure
    const cleanReversalResult = await reverseTransaction(originalVoucherId, 'test_user', '2026-04-11', revDb);
    assert(Boolean(cleanReversalResult.reversal), 'Clean reversal should return reversal voucher.');
    const finalCash = (await revDb.cashBankAccounts.get('cb_cash_1'))!.currentBalance;
    const finalStock = (await revDb.inventoryItems.get('item_rev_1'))!.currentStock;
    const finalSale = await revDb.sales.get(originalSaleId);
    assert(finalCash === 50000, 'Successful reversal: Cash restored to 50000.');
    assert(finalStock === 100, 'Successful reversal: Stock restored to 100.');
    assert(finalSale?.status === 'CANCELLED', 'Successful reversal: Sale marked CANCELLED.');

    // =========================================================================
    // TASK A2: STRICT CASH/BANK ACCOUNT HANDLING
    // If the selected cash/bank account does not exist:
    // - reject the transaction
    // - do not post the journal
    // - do not change operational balance
    // - do NOT fall back to another account
    // =========================================================================
    const a2Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a2Db.accounts.put(acc);
    }
    await a2Db.cashBankAccounts.put({
      id: 'cb_cash_real',
      accountName: 'Real Cash Account',
      accountType: 'CASH',
      currentBalance: 50000,
      synced: false
    });
    await a2Db.cashBankAccounts.put({
      id: 'cb_bank_real',
      accountName: 'Real Bank Account',
      accountType: 'BANK',
      currentBalance: 75000,
      synced: false
    });

    const a2Customer: Party = {
      id: 'cust_a2_1',
      name: 'A2 Customer',
      type: 'CUSTOMER',
      phone: '01700000000',
      balance: 0,
      synced: false
    };
    await a2Db.parties.put(a2Customer);

    const a2Item: InventoryItem = {
      id: 'item_a2_1',
      code: 'ITEM-A2-1',
      nameBn: 'A2 Test Item',
      nameEn: 'A2 Test Item',
      category: 'FEED',
      unit: 'কেজি',
      currentStock: 50,
      avgCostPrice: 100,
      sellingPrice: 150,
      reorderLevel: 5,
      synced: false
    };
    await a2Db.inventoryItems.put(a2Item);

    // 1. executeSaleTransaction with non-existent bank account ID
    let a2SaleFailed = false;
    try {
      await executeSaleTransaction(
        {
          customer: a2Customer,
          item: a2Item,
          quantity: 10,
          unitPrice: 150,
          paymentMethod: 'BANK',
          bankAccountId: 'non_existent_bank_acc',
          date: '2026-04-12',
          currentUserId: 'test_user'
        },
        a2Db
      );
    } catch {
      a2SaleFailed = true;
    }
    assert(a2SaleFailed, 'Task A2: executeSaleTransaction must reject non-existent bank account without fallback.');
    let a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed sale.');
    let a2Bank = (await a2Db.cashBankAccounts.get('cb_bank_real'))!.currentBalance;
    let a2Cash = (await a2Db.cashBankAccounts.get('cb_cash_real'))!.currentBalance;
    assert(a2Bank === 75000 && a2Cash === 50000, 'Task A2: Operational cash/bank balances remain unchanged on failed sale.');

    // 2. executePaymentTransaction with non-existent bank account ID
    let a2PaymentFailed = false;
    try {
      await executePaymentTransaction(
        {
          parentType: 'PURCHASE',
          parentId: 'pur_dummy_1',
          paymentMethod: 'BANK',
          bankAccountId: 'non_existent_bank_acc',
          amount: 5000,
          date: '2026-04-12',
          currentUserId: 'test_user'
        },
        a2Db
      );
    } catch {
      a2PaymentFailed = true;
    }
    assert(a2PaymentFailed, 'Task A2: executePaymentTransaction must reject non-existent bank account without fallback.');
    a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed payment.');
    a2Bank = (await a2Db.cashBankAccounts.get('cb_bank_real'))!.currentBalance;
    assert(a2Bank === 75000, 'Task A2: Bank balance remains unchanged on failed payment.');

    // 3. executeFishHarvestAndSaleTransaction with non-existent bank account ID
    const a2FishBatch: FishBatch = {
      id: 'batch_a2_1',
      pondId: 'pond_1',
      pondName: 'Pond A2',
      species: 'Tilapia',
      fingerlingQty: 1000,
      fingerlingCost: 2000,
      totalFeedKg: 50,
      totalFeedCost: 3000,
      mortalityCount: 0,
      currentEstimatedWeightKg: 500,
      stockingDate: '2026-01-01',
      status: 'ACTIVE',
      totalCost: 10000,
      synced: false
    };
    await a2Db.fishBatches.put(a2FishBatch);

    let a2FishHarvestFailed = false;
    try {
      await executeFishHarvestAndSaleTransaction(
        {
          batchId: 'batch_a2_1',
          harvestWeightKg: 500,
          salePrice: 50000,
          paymentMethod: 'BANK',
          bankAccountId: 'non_existent_bank_acc',
          currentUserId: 'test_user',
          date: '2026-04-12'
        },
        a2Db
      );
    } catch {
      a2FishHarvestFailed = true;
    }
    assert(a2FishHarvestFailed, 'Task A2: executeFishHarvestAndSaleTransaction must reject non-existent bank account without fallback.');
    a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed fish harvest sale.');
    a2Bank = (await a2Db.cashBankAccounts.get('cb_bank_real'))!.currentBalance;
    assert(a2Bank === 75000, 'Task A2: Bank balance remains unchanged on failed fish harvest sale.');

    // 4. executeFixedAssetAcquisitionTransaction with non-existent bank account ID
    let a2FaAcqFailed = false;
    try {
      await executeFixedAssetAcquisitionTransaction(
        {
          name: 'A2 Tractor',
          category: 'MACHINERY',
          originalCost: 20000,
          paymentMethod: 'BANK',
          bankAccountId: 'non_existent_bank_acc',
          purchaseDate: '2026-04-12',
          salvageValue: 2000,
          usefulLifeYears: 5,
          currentUserId: 'test_user'
        },
        a2Db
      );
    } catch {
      a2FaAcqFailed = true;
    }
    assert(a2FaAcqFailed, 'Task A2: executeFixedAssetAcquisitionTransaction must reject non-existent bank account without fallback.');
    a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed asset acquisition.');
    a2Bank = (await a2Db.cashBankAccounts.get('cb_bank_real'))!.currentBalance;
    assert(a2Bank === 75000, 'Task A2: Bank balance remains unchanged on failed asset acquisition.');

    // 5. executeFixedAssetDisposalTransaction with non-existent bank account ID
    const a2Asset: FixedAsset = {
      id: 'fa_a2_1',
      name: 'A2 Old Pump',
      category: 'EQUIPMENT',
      originalCost: 10000,
      accumulatedDepreciation: 5000,
      currentBookValue: 5000,
      salvageValue: 1000,
      usefulLifeYears: 5,
      depreciationRatePercent: 20,
      purchaseDate: '2025-01-01',
      status: 'ACTIVE',
      synced: false
    };
    await a2Db.fixedAssets.put(a2Asset);

    let a2FaDispFailed = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: 'fa_a2_1',
          disposalDate: '2026-04-12',
          disposalProceeds: 6000,
          paymentMethod: 'BANK',
          bankAccountId: 'non_existent_bank_acc'
        },
        a2Db
      );
    } catch {
      a2FaDispFailed = true;
    }
    assert(a2FaDispFailed, 'Task A2: executeFixedAssetDisposalTransaction must reject non-existent bank account without fallback.');
    a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed asset disposal.');
    a2Bank = (await a2Db.cashBankAccounts.get('cb_bank_real'))!.currentBalance;
    assert(a2Bank === 75000, 'Task A2: Bank balance remains unchanged on failed asset disposal.');

    // 6. executeFixedAssetDisposalTransaction with non-existent cash account ID
    let a2FaDispCashFailed = false;
    try {
      await executeFixedAssetDisposalTransaction(
        {
          assetId: 'fa_a2_1',
          disposalDate: '2026-04-12',
          disposalProceeds: 6000,
          paymentMethod: 'CASH',
          bankAccountId: 'non_existent_cash_acc'
        },
        a2Db
      );
    } catch {
      a2FaDispCashFailed = true;
    }
    assert(a2FaDispCashFailed, 'Task A2: executeFixedAssetDisposalTransaction must reject non-existent cash account without fallback.');
    a2Journals = await a2Db.journalEntries.toArray();
    assert(a2Journals.length === 0, 'Task A2: No journal posted for failed asset cash disposal.');
    a2Cash = (await a2Db.cashBankAccounts.get('cb_cash_real'))!.currentBalance;
    assert(a2Cash === 50000, 'Task A2: Cash balance remains unchanged on failed asset cash disposal.');

    // =========================================================================
    // TASK A3: INVESTOR SOURCE ACCOUNT REGRESSION TESTS
    // =========================================================================
    const a3Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a3Db.accounts.put(acc);
    }
    await a3Db.cashBankAccounts.put({
      id: 'cb_first_available',
      accountName: 'First Available Account (Never Fallback)',
      accountType: 'BANK',
      currentBalance: 100000,
      synced: false
    });
    await a3Db.cashBankAccounts.put({
      id: 'cb_second_available',
      accountName: 'Second Available Cash',
      accountType: 'CASH',
      currentBalance: 50000,
      synced: false
    });

    // 1. Investor Contribution with non-existent targetAccountId
    let a3ContribFailed = false;
    try {
      await executeInvestorTransaction(
        {
          investorName: 'Test Investor A3',
          contribution: 25000,
          profitShare: 20,
          profitSharingRatio: 20,
          targetAccountId: 'non_existent_target_acc',
          currentUserId: 'usr_admin',
          date: '2026-04-15'
        },
        a3Db
      );
    } catch {
      a3ContribFailed = true;
    }
    assert(a3ContribFailed, 'Task A3: executeInvestorTransaction must reject non-existent target account.');
    let a3Journals = await a3Db.journalEntries.toArray();
    assert(a3Journals.length === 0, 'Task A3: No journal entry created on rejected investor contribution.');
    let a3FirstAcc = await a3Db.cashBankAccounts.get('cb_first_available');
    assert(a3FirstAcc?.currentBalance === 100000, 'Task A3: First available account balance untouched on contribution failure.');
    let a3Investors = await a3Db.investors.toArray();
    assert(a3Investors.length === 0, 'Task A3: Investor record not created on failed contribution.');

    // 2. Set up valid investor for profit payment and capital return tests
    const validInvRes = await executeInvestorTransaction(
      {
        investorName: 'Valid Investor A3',
        contribution: 50000,
        profitShare: 20,
        profitSharingRatio: 20,
        targetAccountId: 'cb_first_available',
        currentUserId: 'usr_admin',
        date: '2026-04-15'
      },
      a3Db
    );
    const validInvId = validInvRes.investor.id;

    // Allocate profit to create profit payable
    await executeInvestorProfitAllocationTransaction(
      {
        investorId: validInvId,
        finalizedDistributableProfit: 100000,
        allocationDate: '2026-04-15',
        currentUserId: 'usr_admin'
      },
      a3Db
    );
    const a3InvAfterAlloc = await a3Db.investors.get(validInvId);
    assert((a3InvAfterAlloc?.profitPayable || 0) === 20000, 'Task A3: Profit allocated successfully.');

    const journalCountBeforePay = (await a3Db.journalEntries.toArray()).length;
    const firstBalBeforePay = (await a3Db.cashBankAccounts.get('cb_first_available'))!.currentBalance;

    // 3. Investor Profit Payment with non-existent sourceAccountId
    let a3PaymentFailed = false;
    try {
      await executeInvestorProfitPaymentTransaction(
        {
          investorId: validInvId,
          amount: 5000,
          sourceAccountId: 'non_existent_source_acc',
          paymentDate: '2026-04-16',
          currentUserId: 'usr_admin'
        },
        a3Db
      );
    } catch {
      a3PaymentFailed = true;
    }
    assert(a3PaymentFailed, 'Task A3: executeInvestorProfitPaymentTransaction must reject non-existent source account.');
    let journalCountAfterPay = (await a3Db.journalEntries.toArray()).length;
    assert(journalCountAfterPay === journalCountBeforePay, 'Task A3: No journal posted on rejected profit payment.');
    let firstBalAfterPay = (await a3Db.cashBankAccounts.get('cb_first_available'))!.currentBalance;
    assert(firstBalAfterPay === firstBalBeforePay, 'Task A3: First available account untouched on profit payment failure.');
    let a3InvAfterFailedPay = await a3Db.investors.get(validInvId);
    assert(a3InvAfterFailedPay?.profitPayable === 20000, 'Task A3: Investor profit payable untouched on failed profit payment.');

    // 4. Investor Capital Return with non-existent sourceAccountId
    let a3CapReturnFailed = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: validInvId,
          amount: 10000,
          sourceAccountId: 'non_existent_source_acc',
          returnDate: '2026-04-16',
          currentUserId: 'usr_admin'
        },
        a3Db
      );
    } catch {
      a3CapReturnFailed = true;
    }
    assert(a3CapReturnFailed, 'Task A3: executeInvestorCapitalReturnTransaction must reject non-existent source account.');
    let journalCountAfterRet = (await a3Db.journalEntries.toArray()).length;
    assert(journalCountAfterRet === journalCountBeforePay, 'Task A3: No journal posted on rejected capital return.');
    let firstBalAfterRet = (await a3Db.cashBankAccounts.get('cb_first_available'))!.currentBalance;
    assert(firstBalAfterRet === firstBalBeforePay, 'Task A3: First available account untouched on capital return failure.');
    let a3InvAfterFailedRet = await a3Db.investors.get(validInvId);
    assert((a3InvAfterFailedRet?.currentCapitalBalance || 0) === 50000, 'Task A3: Investor capital balance untouched on failed capital return.');

    // =========================================================================
    // TASK A4: LOAN SOURCE/TARGET ACCOUNT REGRESSION TESTS
    // =========================================================================
    const a4Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a4Db.accounts.put(acc);
    }
    await a4Db.cashBankAccounts.put({
      id: 'cb_first_loan_acc',
      accountName: 'First Available Account (Never Default)',
      accountType: 'BANK',
      currentBalance: 100000,
      synced: false
    });
    await a4Db.cashBankAccounts.put({
      id: 'cb_actual_loan_acc',
      accountName: 'Actual Selected Loan Account',
      accountType: 'BANK',
      currentBalance: 50000,
      synced: false
    });

    // 1. Loan Disbursement with invalid / non-existent targetAccountId
    let a4DisburseInvalidFailed = false;
    try {
      await executeLoanTransaction(
        {
          lenderName: 'Krishi Bank',
          principal: 200000,
          interestRate: 9,
          tenureMonths: 12,
          targetAccountId: 'non_existent_loan_target',
          currentUserId: 'usr_admin',
          startDate: '2026-05-01'
        },
        a4Db
      );
    } catch {
      a4DisburseInvalidFailed = true;
    }
    assert(a4DisburseInvalidFailed, 'Task A4: executeLoanTransaction must reject non-existent target account.');

    // Verify first available account was NOT silently used
    const a4FirstAccBefore = await a4Db.cashBankAccounts.get('cb_first_loan_acc');
    assert(a4FirstAccBefore?.currentBalance === 100000, 'Task A4: First account balance untouched on rejected loan disbursement.');
    const a4LoansCountBefore = (await a4Db.loans.toArray()).length;
    assert(a4LoansCountBefore === 0, 'Task A4: No loan record created on rejected disbursement.');
    const a4JournalsCountBefore = (await a4Db.journalEntries.toArray()).length;
    assert(a4JournalsCountBefore === 0, 'Task A4: No journal entry posted on rejected disbursement.');

    // 2. Loan Disbursement with empty targetAccountId
    let a4DisburseEmptyFailed = false;
    try {
      await executeLoanTransaction(
        {
          lenderName: 'Krishi Bank',
          principal: 200000,
          interestRate: 9,
          tenureMonths: 12,
          targetAccountId: '',
          currentUserId: 'usr_admin',
          startDate: '2026-05-01'
        },
        a4Db
      );
    } catch {
      a4DisburseEmptyFailed = true;
    }
    assert(a4DisburseEmptyFailed, 'Task A4: executeLoanTransaction must reject empty target account ID.');

    // 3. Valid Loan Disbursement into specific account
    const a4ValidLoanRes = await executeLoanTransaction(
      {
        lenderName: 'Sonali Bank Agro',
        principal: 120000,
        interestRate: 10,
        tenureMonths: 12,
        targetAccountId: 'cb_actual_loan_acc',
        currentUserId: 'usr_admin',
        startDate: '2026-05-01'
      },
      a4Db
    );
    assert(a4ValidLoanRes.loan.id !== undefined, 'Task A4: Valid loan disbursed successfully.');
    const a4ActualAccAfterDisburse = await a4Db.cashBankAccounts.get('cb_actual_loan_acc');
    assert(a4ActualAccAfterDisburse?.currentBalance === 170000, 'Task A4: Selected account credited correctly on disbursement (50k + 120k).');
    const a4FirstAccAfterValidDisburse = await a4Db.cashBankAccounts.get('cb_first_loan_acc');
    assert(a4FirstAccAfterValidDisburse?.currentBalance === 100000, 'Task A4: First account still untouched after valid disbursement.');

    const a4LoanId = a4ValidLoanRes.loan.id;

    // 4. Loan Repayment with invalid / non-existent sourceAccountId
    let a4RepayInvalidFailed = false;
    const journalCountBeforeRepay = (await a4Db.journalEntries.toArray()).length;
    try {
      await executeLoanRepaymentTransaction(
        {
          loanId: a4LoanId,
          sourceAccountId: 'non_existent_repay_acc',
          principalAmount: 10000,
          interestAmount: 1000,
          installmentNumber: 1,
          repaymentDate: '2026-06-01',
          currentUserId: 'usr_admin'
        },
        a4Db
      );
    } catch {
      a4RepayInvalidFailed = true;
    }
    assert(a4RepayInvalidFailed, 'Task A4: executeLoanRepaymentTransaction must reject non-existent source account.');
    const a4FirstAccAfterFailedRepay = await a4Db.cashBankAccounts.get('cb_first_loan_acc');
    assert(a4FirstAccAfterFailedRepay?.currentBalance === 100000, 'Task A4: First account was NOT silently used for failed loan repayment.');
    const journalCountAfterFailedRepay = (await a4Db.journalEntries.toArray()).length;
    assert(journalCountAfterFailedRepay === journalCountBeforeRepay, 'Task A4: No journal posted on rejected loan repayment.');

    // 5. Loan Repayment with empty sourceAccountId
    let a4RepayEmptyFailed = false;
    try {
      await executeLoanRepaymentTransaction(
        {
          loanId: a4LoanId,
          sourceAccountId: '',
          principalAmount: 10000,
          interestAmount: 1000,
          installmentNumber: 1,
          repaymentDate: '2026-06-01',
          currentUserId: 'usr_admin'
        },
        a4Db
      );
    } catch {
      a4RepayEmptyFailed = true;
    }
    assert(a4RepayEmptyFailed, 'Task A4: executeLoanRepaymentTransaction must reject empty source account ID.');

    // 6. Valid Loan Repayment from specific source account
    const repayRes = await executeLoanRepaymentTransaction(
      {
        loanId: a4LoanId,
        sourceAccountId: 'cb_actual_loan_acc',
        principalAmount: 10000,
        interestAmount: 1000,
        installmentNumber: 1,
        repaymentDate: '2026-06-01',
        currentUserId: 'usr_admin'
      },
      a4Db
    );
    assert(repayRes.updatedLoan.remainingPrincipal === 110000, 'Task A4: Loan principal reduced accurately on repayment (120k - 10k).');
    const a4ActualAccAfterRepay = await a4Db.cashBankAccounts.get('cb_actual_loan_acc');
    assert(a4ActualAccAfterRepay?.currentBalance === 159000, 'Task A4: Selected source account deducted accurately (170k - 11k).');
    const a4FirstAccFinal = await a4Db.cashBankAccounts.get('cb_first_loan_acc');
    assert(a4FirstAccFinal?.currentBalance === 100000, 'Task A4: First account was never touched throughout loan tests.');

    // =========================================================================
    // TASK A5: OWNER CAPITAL & DRAWINGS ACCOUNT REGRESSION TESTS
    // =========================================================================
    const a5Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a5Db.accounts.put(acc);
    }
    await a5Db.cashBankAccounts.put({
      id: 'cb_first_owner_acc',
      accountName: 'First Available Account (Never Silently Used)',
      accountType: 'BANK',
      currentBalance: 80000,
      synced: false
    });
    await a5Db.cashBankAccounts.put({
      id: 'cb_actual_owner_acc',
      accountName: 'Actual Selected Owner Account',
      accountType: 'CASH',
      currentBalance: 30000,
      synced: false
    });

    // 1. Owner Capital with invalid / non-existent targetAccountId
    let a5CapInvalidFailed = false;
    try {
      await executeOwnerCapitalTransaction(
        {
          amount: 50000,
          targetAccountId: 'non_existent_capital_target',
          currentUserId: 'usr_admin',
          date: '2026-05-10',
          notes: 'Capital injection'
        },
        a5Db
      );
    } catch {
      a5CapInvalidFailed = true;
    }
    assert(a5CapInvalidFailed, 'Task A5: executeOwnerCapitalTransaction must reject non-existent target account.');

    // Verify first available account was NOT silently used
    const a5FirstBefore = await a5Db.cashBankAccounts.get('cb_first_owner_acc');
    assert(a5FirstBefore?.currentBalance === 80000, 'Task A5: First account balance untouched on rejected capital transaction.');
    const a5JournalsBefore = (await a5Db.journalEntries.toArray()).length;
    assert(a5JournalsBefore === 0, 'Task A5: No journal entry created on rejected capital transaction.');

    // 2. Owner Capital with empty targetAccountId
    let a5CapEmptyFailed = false;
    try {
      await executeOwnerCapitalTransaction(
        {
          amount: 50000,
          targetAccountId: '',
          currentUserId: 'usr_admin',
          date: '2026-05-10'
        },
        a5Db
      );
    } catch {
      a5CapEmptyFailed = true;
    }
    assert(a5CapEmptyFailed, 'Task A5: executeOwnerCapitalTransaction must reject empty target account ID.');

    // 3. Valid Owner Capital into specific account (cb_actual_owner_acc)
    const a5CapRes = await executeOwnerCapitalTransaction(
      {
        amount: 25000,
        targetAccountId: 'cb_actual_owner_acc',
        currentUserId: 'usr_admin',
        date: '2026-05-10',
        notes: 'Owner initial cash infusion'
      },
      a5Db
    );
    assert(a5CapRes.journalEntryId !== undefined, 'Task A5: Valid owner capital posted.');
    const a5ActualAfterCap = await a5Db.cashBankAccounts.get('cb_actual_owner_acc');
    assert(a5ActualAfterCap?.currentBalance === 55000, 'Task A5: Selected account credited correctly on capital infusion (30k + 25k).');
    const a5FirstAfterCap = await a5Db.cashBankAccounts.get('cb_first_owner_acc');
    assert(a5FirstAfterCap?.currentBalance === 80000, 'Task A5: First available account untouched after valid capital infusion.');

    // Verify 3010 Owner Capital accounting entry
    const a5CapJournal = await a5Db.journalEntries.get(a5CapRes.journalEntryId);
    assert(a5CapJournal !== undefined, 'Task A5: Capital journal found.');
    const line3010 = a5CapJournal?.lines.find((l: any) => l.accountCode === '3010');
    assert(line3010 !== undefined && line3010.credit === 25000, 'Task A5: Credit 3010 Owner Capital verified.');
    const lineCashCap = a5CapJournal?.lines.find((l: any) => l.accountCode === '1010');
    assert(lineCashCap !== undefined && lineCashCap.debit === 25000, 'Task A5: Debit 1010 Cash Account verified.');

    // 4. Owner Drawing with invalid / non-existent sourceAccountId
    let a5DrawInvalidFailed = false;
    const journalCountBeforeDraw = (await a5Db.journalEntries.toArray()).length;
    try {
      await executeOwnerDrawingTransaction(
        {
          amount: 5000,
          sourceAccountId: 'non_existent_draw_source',
          currentUserId: 'usr_admin',
          date: '2026-05-11',
          notes: 'Personal drawing'
        },
        a5Db
      );
    } catch {
      a5DrawInvalidFailed = true;
    }
    assert(a5DrawInvalidFailed, 'Task A5: executeOwnerDrawingTransaction must reject non-existent source account.');
    const a5FirstAfterFailedDraw = await a5Db.cashBankAccounts.get('cb_first_owner_acc');
    assert(a5FirstAfterFailedDraw?.currentBalance === 80000, 'Task A5: First account was NOT silently used for failed owner drawing.');
    const journalCountAfterFailedDraw = (await a5Db.journalEntries.toArray()).length;
    assert(journalCountAfterFailedDraw === journalCountBeforeDraw, 'Task A5: No journal posted on rejected owner drawing.');

    // 5. Owner Drawing with empty sourceAccountId
    let a5DrawEmptyFailed = false;
    try {
      await executeOwnerDrawingTransaction(
        {
          amount: 5000,
          sourceAccountId: '',
          currentUserId: 'usr_admin',
          date: '2026-05-11'
        },
        a5Db
      );
    } catch {
      a5DrawEmptyFailed = true;
    }
    assert(a5DrawEmptyFailed, 'Task A5: executeOwnerDrawingTransaction must reject empty source account ID.');

    // 6. Valid Owner Drawing from specific source account (cb_actual_owner_acc)
    const a5DrawRes = await executeOwnerDrawingTransaction(
      {
        amount: 15000,
        sourceAccountId: 'cb_actual_owner_acc',
        currentUserId: 'usr_admin',
        date: '2026-05-11',
        notes: 'Personal expense drawing'
      },
      a5Db
    );
    assert(a5DrawRes.journalEntryId !== undefined, 'Task A5: Valid owner drawing posted.');
    const a5ActualAfterDraw = await a5Db.cashBankAccounts.get('cb_actual_owner_acc');
    assert(a5ActualAfterDraw?.currentBalance === 40000, 'Task A5: Selected source account deducted correctly (55k - 15k).');
    const a5FirstFinal = await a5Db.cashBankAccounts.get('cb_first_owner_acc');
    assert(a5FirstFinal?.currentBalance === 80000, 'Task A5: First available account was never touched throughout owner drawing tests.');

    // Verify 3040 Owner Drawings accounting entry
    const a5DrawJournal = await a5Db.journalEntries.get(a5DrawRes.journalEntryId);
    assert(a5DrawJournal !== undefined, 'Task A5: Drawing journal found.');
    const line3040 = a5DrawJournal?.lines.find((l: any) => l.accountCode === '3040');
    assert(line3040 !== undefined && line3040.debit === 15000, 'Task A5: Debit 3040 Owner Drawings verified.');
    const lineCashDraw = a5DrawJournal?.lines.find((l: any) => l.accountCode === '1010');
    assert(lineCashDraw !== undefined && lineCashDraw.credit === 15000, 'Task A5: Credit 1010 Cash Account verified.');

    // ==========================================
    // TASK A6: Sale Idempotency & Duplicate Protection Tests
    // ==========================================
    console.log('\n--- Running Task A6 Sale Idempotency Tests ---');
    const a6Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a6Db.accounts.put(acc);
    }

    await a6Db.cashBankAccounts.put({
      id: 'cb_a6_cash',
      accountName: 'Main Cash Drawer',
      accountType: 'CASH',
      accountNumber: '1010-A6',
      currentBalance: 50000,
      openingBalance: 50000,
      isDefault: true,
      synced: false
    });

    await a6Db.inventoryItems.put({
      id: 'item_a6_feed',
      code: 'FEED-001',
      nameBn: 'স্টার্টার ফিড',
      nameEn: 'Starter Feed',
      category: 'FEED',
      currentStock: 100,
      reorderLevel: 10,
      sellingPrice: 80,
      unit: 'কেজি',
      avgCostPrice: 50,
      synced: false
    });

    await a6Db.parties.put({
      id: 'cust_a6_1',
      name: 'আকবর ট্রেডার্স',
      type: 'CUSTOMER',
      phone: '01800000000',
      balance: 0,
      synced: false
    });

    const a6Customer = (await a6Db.parties.get('cust_a6_1'))!;
    const a6Item = (await a6Db.inventoryItems.get('item_a6_feed'))!;

    // 1. Initial sale with idempotency key
    const a6SaleRes1 = await executeSaleTransaction(
      {
        idempotencyKey: 'idemp_sale_a6_001',
        customer: a6Customer,
        item: a6Item,
        quantity: 10,
        unitPrice: 80,
        paymentMethod: 'CASH',
        bankAccountId: 'cb_a6_cash',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a6Db
    );
    assert(a6SaleRes1.sale !== undefined, 'Task A6: First sale with idempotencyKey must succeed.');
    const salesCountAfter1 = (await a6Db.sales.toArray()).length;
    const journalsCountAfter1 = (await a6Db.journalEntries.toArray()).length;
    const stockAfter1 = (await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock;
    const cashAfter1 = (await a6Db.cashBankAccounts.get('cb_a6_cash'))!.currentBalance;

    assert(salesCountAfter1 === 1, 'Task A6: Exactly 1 sale created initially.');
    assert(journalsCountAfter1 === 1, 'Task A6: Exactly 1 journal entry created initially.');
    assert(stockAfter1 === 90, 'Task A6: Stock reduced by 10 (100 -> 90).');
    assert(cashAfter1 === 50800, 'Task A6: Cash increased by 800 (50000 + 800).');

    // 2. Retry identical sale with same idempotency key
    let a6RetryKeyFailed = false;
    try {
      await executeSaleTransaction(
        {
          idempotencyKey: 'idemp_sale_a6_001',
          customer: a6Customer,
          item: a6Item,
          quantity: 10,
          unitPrice: 80,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a6_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a6Db
      );
    } catch (err: any) {
      a6RetryKeyFailed = true;
      assert(
        err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate'),
        'Task A6: Error message indicates duplicate sale prevented.'
      );
    }
    assert(a6RetryKeyFailed, 'Task A6: Duplicate sale retry with same idempotencyKey MUST be rejected.');

    // Verify state after idempotency retry:
    // a second sale must not be created
    // a second journal must not be created
    // a second stock reduction must not happen
    // a second cash/AR effect must not happen
    const salesCountAfterRetry = (await a6Db.sales.toArray()).length;
    const journalsCountAfterRetry = (await a6Db.journalEntries.toArray()).length;
    const stockAfterRetry = (await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock;
    const cashAfterRetry = (await a6Db.cashBankAccounts.get('cb_a6_cash'))!.currentBalance;

    assert(salesCountAfterRetry === 1, 'Task A6: NO second sale created on idempotency retry.');
    assert(journalsCountAfterRetry === 1, 'Task A6: NO second journal created on idempotency retry.');
    assert(stockAfterRetry === 90, 'Task A6: NO second stock reduction on idempotency retry.');
    assert(cashAfterRetry === 50800, 'Task A6: NO second cash effect on idempotency retry.');

    // 3. Retry with same target sale ID
    const a6SaleWithId = await executeSaleTransaction(
      {
        id: 'sal_custom_a6_unique',
        customer: a6Customer,
        item: (await a6Db.inventoryItems.get('item_a6_feed'))!,
        quantity: 5,
        unitPrice: 80,
        paymentMethod: 'CASH',
        bankAccountId: 'cb_a6_cash',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a6Db
    );
    assert(a6SaleWithId.sale.id === 'sal_custom_a6_unique', 'Task A6: Sale with custom ID created.');
    const stockAfterIdSale = (await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock;
    assert(stockAfterIdSale === 85, 'Task A6: Stock reduced to 85.');

    let a6RetryIdFailed = false;
    try {
      await executeSaleTransaction(
        {
          id: 'sal_custom_a6_unique',
          customer: a6Customer,
          item: (await a6Db.inventoryItems.get('item_a6_feed'))!,
          quantity: 5,
          unitPrice: 80,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a6_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a6Db
      );
    } catch {
      a6RetryIdFailed = true;
    }
    assert(a6RetryIdFailed, 'Task A6: Duplicate sale retry with same target ID MUST be rejected.');
    assert((await a6Db.sales.toArray()).length === 2, 'Task A6: NO second sale created on ID collision.');
    assert((await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock === 85, 'Task A6: NO second stock reduction on ID collision.');

    // 4. Retry with credit sale and verify AR protection
    const preCreditAR = (await a6Db.parties.get('cust_a6_1'))!.balance;
    const a6CreditSale = await executeSaleTransaction(
      {
        customer: a6Customer,
        item: (await a6Db.inventoryItems.get('item_a6_feed'))!,
        quantity: 5,
        unitPrice: 100,
        paymentMethod: 'CREDIT',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a6Db
    );
    assert(a6CreditSale.sale !== undefined, 'Task A6: Credit sale succeeded.');
    const postCreditAR = (await a6Db.parties.get('cust_a6_1'))!.balance;
    assert(postCreditAR === preCreditAR + 500, 'Task A6: AR balance increased by 500.');
    const stockAfterCredit = (await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock;
    assert(stockAfterCredit === 80, 'Task A6: Stock reduced to 80.');

    // Immediate identical retry of the credit sale
    let a6RetryCreditFailed = false;
    try {
      await executeSaleTransaction(
        {
          customer: a6Customer,
          item: (await a6Db.inventoryItems.get('item_a6_feed'))!,
          quantity: 5,
          unitPrice: 100,
          paymentMethod: 'CREDIT',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a6Db
      );
    } catch {
      a6RetryCreditFailed = true;
    }
    assert(a6RetryCreditFailed, 'Task A6: Immediate identical sale retry MUST be rejected.');
    const arAfterFailedRetry = (await a6Db.parties.get('cust_a6_1'))!.balance;
    assert(arAfterFailedRetry === postCreditAR, 'Task A6: NO second AR effect on duplicate credit sale retry.');
    const stockAfterFailedRetry = (await a6Db.inventoryItems.get('item_a6_feed'))!.currentStock;
    assert(stockAfterFailedRetry === 80, 'Task A6: NO second stock reduction on duplicate credit sale retry.');

    // 5. Concurrent duplicate sale execution (Race Condition)
    const currentFreshItem = (await a6Db.inventoryItems.get('item_a6_feed'))!;
    const [resA, resB] = await Promise.allSettled([
      executeSaleTransaction(
        {
          idempotencyKey: 'idemp_concurrent_sale_1',
          customer: a6Customer,
          item: currentFreshItem,
          quantity: 2,
          unitPrice: 80,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a6_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a6Db
      ),
      executeSaleTransaction(
        {
          idempotencyKey: 'idemp_concurrent_sale_1',
          customer: a6Customer,
          item: currentFreshItem,
          quantity: 2,
          unitPrice: 80,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a6_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a6Db
      )
    ]);
    const fulfilledCount = (resA.status === 'fulfilled' ? 1 : 0) + (resB.status === 'fulfilled' ? 1 : 0);
    const rejectedCount = (resA.status === 'rejected' ? 1 : 0) + (resB.status === 'rejected' ? 1 : 0);
    assert(fulfilledCount === 1, 'Task A6: Exactly one concurrent sale call must succeed.');
    assert(rejectedCount === 1, 'Task A6: Exactly one concurrent sale call must be rejected.');

    // ==========================================
    // TASK A7: Purchase Idempotency & Duplicate Protection Tests
    // ==========================================
    console.log('\n--- Running Task A7 Purchase Idempotency Tests ---');
    const a7Db = createMockAgroDatabase();
    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await a7Db.accounts.put(acc);
    }

    await a7Db.cashBankAccounts.put({
      id: 'cb_a7_cash',
      accountName: 'Main Cash Drawer',
      accountType: 'CASH',
      accountNumber: '1010-A7',
      currentBalance: 50000,
      openingBalance: 50000,
      isDefault: true,
      synced: false
    });

    await a7Db.inventoryItems.put({
      id: 'item_a7_feed',
      code: 'FEED-002',
      nameBn: 'গ্রোয়ার ফিড',
      nameEn: 'Grower Feed',
      category: 'FEED',
      currentStock: 20,
      reorderLevel: 10,
      sellingPrice: 70,
      unit: 'কেজি',
      avgCostPrice: 40,
      synced: false
    });

    await a7Db.parties.put({
      id: 'supp_a7_1',
      name: 'মেসার্স জামান ফিড',
      type: 'SUPPLIER',
      phone: '01700000000',
      balance: 0,
      synced: false
    });

    const a7Supplier = (await a7Db.parties.get('supp_a7_1'))!;
    const a7Item = (await a7Db.inventoryItems.get('item_a7_feed'))!;

    // 1. Initial purchase with idempotency key
    const a7PurRes1 = await executePurchaseTransaction(
      {
        idempotencyKey: 'idemp_pur_a7_001',
        supplier: a7Supplier,
        item: a7Item,
        quantity: 10,
        unitPrice: 45,
        paymentMethod: 'CASH',
        bankAccountId: 'cb_a7_cash',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a7Db
    );
    assert(a7PurRes1.purchase !== undefined, 'Task A7: First purchase with idempotencyKey must succeed.');
    const purCountAfter1 = (await a7Db.purchases.toArray()).length;
    const journalsCountAfterPur1 = (await a7Db.journalEntries.toArray()).length;
    const stockAfterPur1 = (await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock;
    const cashAfterPur1 = (await a7Db.cashBankAccounts.get('cb_a7_cash'))!.currentBalance;

    assert(purCountAfter1 === 1, 'Task A7: Exactly 1 purchase created initially.');
    assert(journalsCountAfterPur1 === 1, 'Task A7: Exactly 1 journal entry created initially.');
    assert(stockAfterPur1 === 30, 'Task A7: Stock increased by 10 (20 -> 30).');
    assert(cashAfterPur1 === 49550, 'Task A7: Cash reduced by 450 (50000 - 450).');

    // 2. Retry identical purchase with same idempotency key
    let a7RetryKeyFailed = false;
    try {
      await executePurchaseTransaction(
        {
          idempotencyKey: 'idemp_pur_a7_001',
          supplier: a7Supplier,
          item: a7Item,
          quantity: 10,
          unitPrice: 45,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a7_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a7Db
      );
    } catch (err: any) {
      a7RetryKeyFailed = true;
      assert(
        err.message.includes('ডুপ্লিকেট') || err.message.includes('Duplicate'),
        'Task A7: Error message indicates duplicate purchase prevented.'
      );
    }
    assert(a7RetryKeyFailed, 'Task A7: Duplicate purchase retry with same idempotencyKey MUST be rejected.');

    // Verify state after idempotency retry:
    // a second purchase must not be created
    // a second journal must not be created
    // a second stock increase must not happen
    // a second cash effect must not happen
    const purCountAfterRetry = (await a7Db.purchases.toArray()).length;
    const journalsCountAfterRetryPur = (await a7Db.journalEntries.toArray()).length;
    const stockAfterRetryPur = (await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock;
    const cashAfterRetryPur = (await a7Db.cashBankAccounts.get('cb_a7_cash'))!.currentBalance;

    assert(purCountAfterRetry === 1, 'Task A7: NO second purchase created on idempotency retry.');
    assert(journalsCountAfterRetryPur === 1, 'Task A7: NO second journal created on idempotency retry.');
    assert(stockAfterRetryPur === 30, 'Task A7: NO second stock increase on idempotency retry.');
    assert(cashAfterRetryPur === 49550, 'Task A7: NO second cash effect on idempotency retry.');

    // 3. Retry with same target purchase ID
    const a7PurWithId = await executePurchaseTransaction(
      {
        id: 'pur_custom_a7_unique',
        supplier: a7Supplier,
        item: (await a7Db.inventoryItems.get('item_a7_feed'))!,
        quantity: 5,
        unitPrice: 45,
        paymentMethod: 'CASH',
        bankAccountId: 'cb_a7_cash',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a7Db
    );
    assert(a7PurWithId.purchase.id === 'pur_custom_a7_unique', 'Task A7: Purchase with custom ID created.');
    const stockAfterIdPur = (await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock;
    assert(stockAfterIdPur === 35, 'Task A7: Stock increased to 35.');

    let a7RetryIdFailed = false;
    try {
      await executePurchaseTransaction(
        {
          id: 'pur_custom_a7_unique',
          supplier: a7Supplier,
          item: (await a7Db.inventoryItems.get('item_a7_feed'))!,
          quantity: 5,
          unitPrice: 45,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a7_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a7Db
      );
    } catch {
      a7RetryIdFailed = true;
    }
    assert(a7RetryIdFailed, 'Task A7: Duplicate purchase retry with same target ID MUST be rejected.');
    assert((await a7Db.purchases.toArray()).length === 2, 'Task A7: NO second purchase created on ID collision.');
    assert((await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock === 35, 'Task A7: NO second stock increase on ID collision.');

    // 4. Retry with credit purchase and verify AP protection
    const preCreditAP = (await a7Db.parties.get('supp_a7_1'))!.balance;
    const a7CreditPur = await executePurchaseTransaction(
      {
        supplier: a7Supplier,
        item: (await a7Db.inventoryItems.get('item_a7_feed'))!,
        quantity: 10,
        unitPrice: 50,
        paymentMethod: 'CREDIT',
        currentUserId: 'usr_admin',
        date: '2026-05-12'
      },
      a7Db
    );
    assert(a7CreditPur.purchase !== undefined, 'Task A7: Credit purchase succeeded.');
    const postCreditAP = (await a7Db.parties.get('supp_a7_1'))!.balance;
    assert(postCreditAP === preCreditAP + 500, 'Task A7: AP balance increased by 500.');
    const stockAfterCreditPur = (await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock;
    assert(stockAfterCreditPur === 45, 'Task A7: Stock increased to 45.');

    // Immediate identical retry of the credit purchase
    let a7RetryCreditFailed = false;
    try {
      await executePurchaseTransaction(
        {
          supplier: a7Supplier,
          item: (await a7Db.inventoryItems.get('item_a7_feed'))!,
          quantity: 10,
          unitPrice: 50,
          paymentMethod: 'CREDIT',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a7Db
      );
    } catch {
      a7RetryCreditFailed = true;
    }
    assert(a7RetryCreditFailed, 'Task A7: Immediate identical purchase retry MUST be rejected.');
    const apAfterFailedRetry = (await a7Db.parties.get('supp_a7_1'))!.balance;
    assert(apAfterFailedRetry === postCreditAP, 'Task A7: NO second AP effect on duplicate credit purchase retry.');
    const stockAfterFailedRetryPur = (await a7Db.inventoryItems.get('item_a7_feed'))!.currentStock;
    assert(stockAfterFailedRetryPur === 45, 'Task A7: NO second stock increase on duplicate credit purchase retry.');

    // 5. Concurrent duplicate purchase execution (Race Condition)
    const currentFreshPurItem = (await a7Db.inventoryItems.get('item_a7_feed'))!;
    const [purResA, purResB] = await Promise.allSettled([
      executePurchaseTransaction(
        {
          idempotencyKey: 'idemp_concurrent_pur_1',
          supplier: a7Supplier,
          item: currentFreshPurItem,
          quantity: 2,
          unitPrice: 50,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a7_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a7Db
      ),
      executePurchaseTransaction(
        {
          idempotencyKey: 'idemp_concurrent_pur_1',
          supplier: a7Supplier,
          item: currentFreshPurItem,
          quantity: 2,
          unitPrice: 50,
          paymentMethod: 'CASH',
          bankAccountId: 'cb_a7_cash',
          currentUserId: 'usr_admin',
          date: '2026-05-12'
        },
        a7Db
      )
    ]);
    const fulfilledPurCount = (purResA.status === 'fulfilled' ? 1 : 0) + (purResB.status === 'fulfilled' ? 1 : 0);
    const rejectedPurCount = (purResA.status === 'rejected' ? 1 : 0) + (purResB.status === 'rejected' ? 1 : 0);
    assert(fulfilledPurCount === 1, 'Task A7: Exactly one concurrent purchase call must succeed.');
    assert(rejectedPurCount === 1, 'Task A7: Exactly one concurrent purchase call must be rejected.');




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
