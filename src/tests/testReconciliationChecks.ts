import {
  runAccountingReconciliation,
  reconcileInventorySubledger,
  reconcileCustomerBalances,
  reconcileSupplierBalances,
  reconcileFishBatchProduction,
  reconcileCropCycleWip,
  reconcileLivestockBiologicalAssets,
  reconcileFixedAssetRegister,
  reconcileAccumulatedDepreciation,
  reconcileInvestorCapital,
  reconcileInvestorProfitPayable,
  reconcileCashBankBalances
} from '../accounting/reconciliationService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MockTable<T> {
  private data: T[] = [];
  constructor(initialData: T[] = []) {
    this.data = [...initialData];
  }
  async toArray(): Promise<T[]> {
    return [...this.data];
  }
  async get(id: any): Promise<T | undefined> {
    return this.data.find((item: any) => item.id === id);
  }
  where(field: string) {
    return {
      equals: (val: any) => ({
        toArray: async () => this.data.filter((item: any) => item[field] === val),
        first: async () => this.data.find((item: any) => item[field] === val)
      })
    };
  }
  filter(fn: (item: T) => boolean) {
    return {
      toArray: async () => this.data.filter(fn),
      first: async () => this.data.find(fn)
    };
  }
}

export async function runReconciliationTests(): Promise<{
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}> {
  const results: TestResult[] = [];

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      results.push({ name, passed: true });
    } else {
      results.push({ name, passed: false, error: detail || 'Assertion failed' });
    }
  }

  console.log('--- STARTING ACCOUNTING RECONCILIATION CHECKS TESTS ---');

  // Setup Mock DB with matched data for all 11 areas
  const mockInventoryItems = [
    { id: 'inv-1', nameBn: 'ফিড ক্যাটফিশ', category: 'FEED', currentStock: 100, avgCostPrice: 50 }, // 5000 (1051)
    { id: 'inv-2', nameBn: 'ধানের বীজ', category: 'SEED', currentStock: 20, avgCostPrice: 200 }, // 4000 (1052)
    { id: 'inv-3', nameBn: 'প্যারাসিটামল ভেট', category: 'RAW_MATERIAL', currentStock: 10, avgCostPrice: 150 }, // 1500 (1053)
    { id: 'inv-4', nameBn: 'প্যাকেজিং কার্টন', category: 'PACKAGING', currentStock: 50, avgCostPrice: 30 } // 1500 (1056)
  ]; // Total operational = 12000

  const mockParties = [
    { id: 'pty-1', type: 'CUSTOMER', name: 'করিম এন্টারপ্রাইজ', phone: '01711111111', balance: 15000 },
    { id: 'pty-2', type: 'CUSTOMER', name: 'রহিম ট্রেডার্স', phone: '01822222222', balance: 25000 },
    { id: 'pty-3', type: 'SUPPLIER', name: 'সিপি ফিড বাংলাদেশ', phone: '01933333333', balance: 35000 },
    { id: 'pty-4', type: 'SUPPLIER', name: 'এসিআই এগ্রো', phone: '01644444444', balance: 10000 }
  ];

  const mockFixedAssets = [
    { id: 'fa-1', name: 'ট্রাক্টর', category: 'MACHINERY', originalCost: 500000, accumulatedDepreciation: 50000, status: 'ACTIVE' },
    { id: 'fa-2', name: 'পুকুর সংস্কার', category: 'PONDS', originalCost: 200000, accumulatedDepreciation: 20000, status: 'ACTIVE' }
  ]; // Operational cost = 700,000, Acc dep = 70,000

  const mockInvestors = [
    { id: 'inv-p1', name: 'জাকির হোসেন', currentCapitalBalance: 200000, profitPayable: 18000, status: 'ACTIVE' },
    { id: 'inv-p2', name: 'মাহবুব আলম', currentCapitalBalance: 300000, profitPayable: 22000, status: 'ACTIVE' }
  ]; // Total capital = 500,000, Total profit payable = 40,000

  const mockCashBank = [
    { id: 'cb-1', name: 'নগদ ক্যাশ', accountType: 'CASH', currentBalance: 75000 },
    { id: 'cb-2', name: 'ডাচ বাংলা ব্যাংক', accountType: 'BANK', currentBalance: 250000 }
  ]; // Total cash/bank = 325,000

  const mockAnimals = [
    {
      id: 'an-1',
      name: 'অস্ট্রেলিয়ান ফ্রিজিয়ান গাই',
      tagNumber: 'COW-01',
      status: 'ACTIVE',
      purchaseCost: 120000,
      feedCost: 30000,
      medicineCost: 5000,
      otherCost: 2000
    }
  ]; // Total operational = 157,000

  const mockFishBatches = [
    {
      id: 'fb-1',
      pondName: 'পুকুর ১',
      species: 'রুই-কাতলা',
      fingerlingCost: 25000,
      totalFeedCost: 45000,
      medicineCost: 5000,
      status: 'ACTIVE'
    }
  ]; // Total operational = 75,000

  const mockCropCycles = [
    {
      id: 'cc-1',
      plotName: 'প্লট এ',
      cropName: 'আমন ধান',
      seedCost: 6000,
      fertilizerCost: 14000,
      labourCost: 15000,
      status: 'GROWING'
    }
  ]; // Total operational = 35,000

  // Balanced matching journal entries
  const matchedJournalEntries = [
    // 1. Inventory GL (Feed 5000, Seed 4000, Raw 1500, Packaging 1500 = 12000)
    {
      id: 'j-inv',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, debit: 5000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY, debit: 4000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.RAW_MATERIALS, debit: 1500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.PACKAGING_INVENTORY, debit: 1500, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: 12000 }
      ]
    },
    // 2. Customer AR GL (40,000)
    {
      id: 'j-ar',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 40000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, debit: 0, credit: 40000 }
      ]
    },
    // 3. Supplier AP GL (45,000 in total; 12,000 already from j-inv + 33,000 here)
    {
      id: 'j-ap',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.FEED_EXPENSE, debit: 33000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: 33000 }
      ]
    },
    // 4. Fish Batch entries (75,000)
    {
      id: 'j-fb',
      reference: 'fb-1',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.WIP, debit: 75000, credit: 0, memo: '[fb-1] মাছ চাষ ব্যয়' },
        { accountCode: CANONICAL_ACCOUNTS.CASH, debit: 0, credit: 75000 }
      ]
    },
    // 5. Crop Cycle entries (35,000)
    {
      id: 'j-cc',
      reference: 'cc-1',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.WIP, debit: 35000, credit: 0, memo: '[cc-1] শস্য চাষ ব্যয়' },
        { accountCode: CANONICAL_ACCOUNTS.CASH, debit: 0, credit: 35000 }
      ]
    },
    // 6. Livestock Assets GL (157,000)
    {
      id: 'j-an',
      reference: 'an-1',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, debit: 157000, credit: 0, memo: '[an-1] গরু ক্রয় ও লালন-পালন' },
        { accountCode: CANONICAL_ACCOUNTS.BANK, debit: 0, credit: 157000 }
      ]
    },
    // 7. Fixed Assets GL (Machinery 500,000, Ponds 200,000 = 700,000)
    {
      id: 'j-fa',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.MACHINERY, debit: 500000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE, debit: 200000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, debit: 0, credit: 700000 }
      ]
    },
    // 8. Accumulated Depreciation GL (70,000 credit)
    {
      id: 'j-dep',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.DEPRECIATION_EXPENSE, debit: 70000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, debit: 0, credit: 70000 }
      ]
    },
    // 9. Investor Capital GL (500,000 credit)
    {
      id: 'j-inv-cap',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.BANK, debit: 500000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, debit: 0, credit: 500000 }
      ]
    },
    // 10. Investor Profit Payable GL (40,000 credit)
    {
      id: 'j-inv-pay',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.PROFIT_DISTRIBUTION, debit: 40000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, debit: 0, credit: 40000 }
      ]
    },
    // 11. Cash/Bank GL (net debit 325,000: Cash 75,000, Bank 250,000)
    {
      id: 'j-cb-net',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, debit: 185000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.BANK, debit: 607000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OTHER_INCOME, debit: 0, credit: 792000 }
      ]
    }
  ];

  const mockDbMatched: any = {
    inventoryItems: new MockTable(mockInventoryItems),
    parties: new MockTable(mockParties),
    fixedAssets: new MockTable(mockFixedAssets),
    investors: new MockTable(mockInvestors),
    cashBankAccounts: new MockTable(mockCashBank),
    animals: new MockTable(mockAnimals),
    fishBatches: new MockTable(mockFishBatches),
    cropCycles: new MockTable(mockCropCycles),
    journalEntries: new MockTable(matchedJournalEntries)
  };

  // Test individual checks in matched state
  const res1 = await reconcileInventorySubledger(mockDbMatched, matchedJournalEntries as any);
  assert(res1.isMatched, 'Check 1: Inventory subledger matches GL', `Diff: ${res1.difference}`);
  assert(res1.operationalAmount === 12000, 'Check 1: Operational amount is 12,000', `Got ${res1.operationalAmount}`);
  assert(res1.glAmount === 12000, 'Check 1: GL amount is 12,000', `Got ${res1.glAmount}`);
  assert(res1.difference === 0, 'Check 1: Difference is 0');

  const res2 = await reconcileCustomerBalances(mockDbMatched, matchedJournalEntries as any);
  assert(res2.isMatched, 'Check 2: Customer balances match AR GL');
  assert(res2.operationalAmount === 40000, 'Check 2: Operational AR is 40,000');
  assert(res2.glAmount === 40000, 'Check 2: GL AR is 40,000');

  const res3 = await reconcileSupplierBalances(mockDbMatched, matchedJournalEntries as any);
  assert(res3.isMatched, 'Check 3: Supplier balances match AP GL');
  assert(res3.operationalAmount === 45000, 'Check 3: Operational AP is 45,000');
  assert(res3.glAmount === 45000, 'Check 3: GL AP is 45,000');

  const res4 = await reconcileFishBatchProduction(mockDbMatched, matchedJournalEntries as any);
  assert(res4.isMatched, 'Check 4: Fish batch costs match production accounting');
  assert(res4.operationalAmount === 75000, 'Check 4: Operational cost is 75,000');

  const res5 = await reconcileCropCycleWip(mockDbMatched, matchedJournalEntries as any);
  assert(res5.isMatched, 'Check 5: Crop cycle costs match WIP accounting');
  assert(res5.operationalAmount === 35000, 'Check 5: Operational cost is 35,000');

  const res6 = await reconcileLivestockBiologicalAssets(mockDbMatched, matchedJournalEntries as any);
  assert(res6.isMatched, 'Check 6: Livestock accumulated cost matches biological asset GL');
  assert(res6.operationalAmount === 157000, 'Check 6: Operational cost is 157,000');

  const res7 = await reconcileFixedAssetRegister(mockDbMatched, matchedJournalEntries as any);
  assert(res7.isMatched, 'Check 7: Fixed asset register matches fixed asset GL');
  assert(res7.operationalAmount === 700000, 'Check 7: Operational cost is 700,000');

  const res8 = await reconcileAccumulatedDepreciation(mockDbMatched, matchedJournalEntries as any);
  assert(res8.isMatched, 'Check 8: Accumulated depreciation matches GL');
  assert(res8.operationalAmount === 70000, 'Check 8: Operational depreciation is 70,000');

  const res9 = await reconcileInvestorCapital(mockDbMatched, matchedJournalEntries as any);
  assert(res9.isMatched, 'Check 9: Investor capital matches GL');
  assert(res9.operationalAmount === 500000, 'Check 9: Operational capital is 500,000');

  const res10 = await reconcileInvestorProfitPayable(mockDbMatched, matchedJournalEntries as any);
  assert(res10.isMatched, 'Check 10: Investor profit payable matches GL');
  assert(res10.operationalAmount === 40000, 'Check 10: Operational profit payable is 40,000');

  const res11 = await reconcileCashBankBalances(mockDbMatched, matchedJournalEntries as any);
  assert(res11.isMatched, 'Check 11: Cash/bank operational balances match GL');
  assert(res11.operationalAmount === 325000, 'Check 11: Operational cash/bank is 325,000');

  // Test full reconciliation suite
  const fullReport = await runAccountingReconciliation(mockDbMatched);
  assert(fullReport.isAllMatched, 'Full Report: All 11 checks matched');
  assert(fullReport.matchedCount === 11, 'Full Report: Exactly 11 checks matched');
  assert(fullReport.mismatchCount === 0, 'Full Report: 0 mismatches');
  assert(fullReport.checks.length === 11, 'Full Report: Contains all 11 required checks');

  // Now test MISMATCH detection across each of the 11 areas:
  console.log('--- TESTING MISMATCH DETECTION IN ALL 11 AREAS ---');

  // Mismatch 1: Extra inventory in subledger not in GL
  const mismatchInventoryItems = [
    ...mockInventoryItems,
    { id: 'inv-mismatch', nameBn: 'অতিরিক্ত ফিড', category: 'FEED', currentStock: 50, avgCostPrice: 100 } // +5000
  ];
  const mockDbMismatch1: any = { ...mockDbMatched, inventoryItems: new MockTable(mismatchInventoryItems) };
  const misRes1 = await reconcileInventorySubledger(mockDbMismatch1, matchedJournalEntries as any);
  assert(!misRes1.isMatched, 'Mismatch 1: Inventory subledger mismatch detected');
  assert(misRes1.difference === 5000, 'Mismatch 1: Difference is exactly +5000', `Got ${misRes1.difference}`);
  assert(misRes1.status === 'MISMATCH', 'Mismatch 1: Status is MISMATCH');

  // Mismatch 2: Customer balance mismatch
  const mismatchParties2 = [
    ...mockParties,
    { id: 'pty-extra', type: 'CUSTOMER', name: 'নতুন কাস্টমার', phone: '01500000000', balance: 8500 }
  ];
  const mockDbMismatch2: any = { ...mockDbMatched, parties: new MockTable(mismatchParties2) };
  const misRes2 = await reconcileCustomerBalances(mockDbMismatch2, matchedJournalEntries as any);
  assert(!misRes2.isMatched, 'Mismatch 2: Customer AR mismatch detected');
  assert(misRes2.difference === 8500, 'Mismatch 2: Difference is exactly +8500', `Got ${misRes2.difference}`);

  // Mismatch 3: Supplier balance mismatch
  const mismatchParties3 = [
    ...mockParties,
    { id: 'pty-sup-extra', type: 'SUPPLIER', name: 'অতিরিক্ত দেনা', phone: '01500000001', balance: 12000 }
  ];
  const mockDbMismatch3: any = { ...mockDbMatched, parties: new MockTable(mismatchParties3) };
  const misRes3 = await reconcileSupplierBalances(mockDbMismatch3, matchedJournalEntries as any);
  assert(!misRes3.isMatched, 'Mismatch 3: Supplier AP mismatch detected');
  assert(misRes3.difference === 12000, 'Mismatch 3: Difference is exactly +12000', `Got ${misRes3.difference}`);

  // Mismatch 4: Fish batch cost unposted to accounting
  const mismatchFish = [
    ...mockFishBatches,
    { id: 'fb-unposted', pondName: 'নতুন পুকুর', species: 'তেলাপিয়া', fingerlingCost: 10000, totalFeedCost: 15000, status: 'ACTIVE' }
  ];
  const mockDbMismatch4: any = { ...mockDbMatched, fishBatches: new MockTable(mismatchFish) };
  const misRes4 = await reconcileFishBatchProduction(mockDbMismatch4, matchedJournalEntries as any);
  assert(!misRes4.isMatched, 'Mismatch 4: Fish batch unposted cost mismatch detected');
  assert(misRes4.difference === 25000, 'Mismatch 4: Difference is exactly +25000', `Got ${misRes4.difference}`);

  // Mismatch 5: Crop cycle cost unposted to WIP
  const mismatchCrops = [
    ...mockCropCycles,
    { id: 'cc-unposted', plotName: 'প্লট বি', cropName: 'ভুট্টা', seedCost: 5000, fertilizerCost: 7000, status: 'GROWING' }
  ];
  const mockDbMismatch5: any = { ...mockDbMatched, cropCycles: new MockTable(mismatchCrops) };
  const misRes5 = await reconcileCropCycleWip(mockDbMismatch5, matchedJournalEntries as any);
  assert(!misRes5.isMatched, 'Mismatch 5: Crop cycle unposted WIP mismatch detected');
  assert(misRes5.difference === 12000, 'Mismatch 5: Difference is exactly +12000', `Got ${misRes5.difference}`);

  // Mismatch 6: Livestock accumulated cost mismatch
  const mismatchAnimals = [
    ...mockAnimals,
    { id: 'an-extra', name: 'বাছুর', tagNumber: 'CALF-02', status: 'ACTIVE', purchasePrice: 20000, feedCost: 5000 }
  ];
  const mockDbMismatch6: any = { ...mockDbMatched, animals: new MockTable(mismatchAnimals) };
  const misRes6 = await reconcileLivestockBiologicalAssets(mockDbMismatch6, matchedJournalEntries as any);
  assert(!misRes6.isMatched, 'Mismatch 6: Livestock biological asset mismatch detected');
  assert(misRes6.difference === 25000, 'Mismatch 6: Difference is exactly +25000', `Got ${misRes6.difference}`);

  // Mismatch 7: Fixed asset register mismatch
  const mismatchAssets = [
    ...mockFixedAssets,
    { id: 'fa-extra', name: 'জেনারেটর', category: 'MACHINERY', originalCost: 80000, accumulatedDepreciation: 0, status: 'ACTIVE' }
  ];
  const mockDbMismatch7: any = { ...mockDbMatched, fixedAssets: new MockTable(mismatchAssets) };
  const misRes7 = await reconcileFixedAssetRegister(mockDbMismatch7, matchedJournalEntries as any);
  assert(!misRes7.isMatched, 'Mismatch 7: Fixed asset register mismatch detected');
  assert(misRes7.difference === 80000, 'Mismatch 7: Difference is exactly +80000', `Got ${misRes7.difference}`);

  // Mismatch 8: Accumulated depreciation mismatch
  const mismatchAssetsDep = [
    { ...mockFixedAssets[0], accumulatedDepreciation: 65000 }, // +15,000 operational dep
    mockFixedAssets[1]
  ];
  const mockDbMismatch8: any = { ...mockDbMatched, fixedAssets: new MockTable(mismatchAssetsDep) };
  const misRes8 = await reconcileAccumulatedDepreciation(mockDbMismatch8, matchedJournalEntries as any);
  assert(!misRes8.isMatched, 'Mismatch 8: Accumulated depreciation mismatch detected');
  assert(misRes8.difference === 15000, 'Mismatch 8: Difference is exactly +15000', `Got ${misRes8.difference}`);

  // Mismatch 9: Investor capital mismatch
  const mismatchInvestors9 = [
    ...mockInvestors,
    { id: 'inv-extra', name: 'নতুন বিনিয়োগকারী', currentCapitalBalance: 150000, profitPayable: 0, status: 'ACTIVE' }
  ];
  const mockDbMismatch9: any = { ...mockDbMatched, investors: new MockTable(mismatchInvestors9) };
  const misRes9 = await reconcileInvestorCapital(mockDbMismatch9, matchedJournalEntries as any);
  assert(!misRes9.isMatched, 'Mismatch 9: Investor capital mismatch detected');
  assert(misRes9.difference === 150000, 'Mismatch 9: Difference is exactly +150000', `Got ${misRes9.difference}`);

  // Mismatch 10: Investor profit payable mismatch
  const mismatchInvestors10 = [
    mockInvestors[0],
    { ...mockInvestors[1], profitPayable: 30000 } // +8,000 profit payable
  ];
  const mockDbMismatch10: any = { ...mockDbMatched, investors: new MockTable(mismatchInvestors10) };
  const misRes10 = await reconcileInvestorProfitPayable(mockDbMismatch10, matchedJournalEntries as any);
  assert(!misRes10.isMatched, 'Mismatch 10: Investor profit payable mismatch detected');
  assert(misRes10.difference === 8000, 'Mismatch 10: Difference is exactly +8000', `Got ${misRes10.difference}`);

  // Mismatch 11: Cash/bank balance mismatch
  const mismatchCashBank11 = [
    { ...mockCashBank[0], currentBalance: 80000 }, // +5,000 operational cash
    mockCashBank[1]
  ];
  const mockDbMismatch11: any = { ...mockDbMatched, cashBankAccounts: new MockTable(mismatchCashBank11) };
  const misRes11 = await reconcileCashBankBalances(mockDbMismatch11, matchedJournalEntries as any);
  assert(!misRes11.isMatched, 'Mismatch 11: Cash/bank balance mismatch detected');
  assert(misRes11.difference === 5000, 'Mismatch 11: Difference is exactly +5000', `Got ${misRes11.difference}`);

  // Full report under mismatch state
  const reportWithMismatches = await runAccountingReconciliation(mockDbMismatch1);
  assert(!reportWithMismatches.isAllMatched, 'Full Report: Correctly detects overall mismatch');
  assert(reportWithMismatches.mismatchCount === 1, 'Full Report: Reports exactly 1 mismatch count');
  assert(reportWithMismatches.matchedCount === 10, 'Full Report: Reports exactly 10 matched count');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const failures = results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.error}`);

  return {
    success: failed === 0,
    total: results.length,
    passed,
    failed,
    failures
  };
}
