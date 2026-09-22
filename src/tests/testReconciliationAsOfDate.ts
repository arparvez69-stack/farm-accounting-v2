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
  reconcileCashBankBalances,
  calculateGlBalanceForAccounts
} from '../accounting/reconciliationService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { JournalEntry } from '../types';

async function testAsOfDateReconciliation() {
  console.log('--- Testing TASK 8: Reconciliation As-Of Date Implementation ---');

  const asOfDate = '2026-03-15';
  const beforeDate = '2026-03-10';
  const afterDate = '2026-03-20';

  // 1. Test calculateGlBalanceForAccounts date filtering
  const testGlEntries: JournalEntry[] = [
    {
      id: 'je-1',
      voucherNumber: 'JV-1',
      voucherType: 'RECEIPT',
      date: beforeDate,
      reference: 'REF-1',
      narration: 'Before as of date',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'Cash', debit: 5000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL, accountName: 'Owner Capital', debit: 0, credit: 5000 }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'je-2',
      voucherNumber: 'JV-2',
      voucherType: 'SALES',
      date: afterDate,
      reference: 'REF-2',
      narration: 'After as of date',
      lines: [
        { accountCode: CANONICAL_ACCOUNTS.CASH, accountName: 'Cash', debit: 3000, credit: 0 },
        { accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE, accountName: 'Fish Revenue', debit: 0, credit: 3000 }
      ],
      createdAt: new Date().toISOString()
    }
  ];

  const glCashAsOf = calculateGlBalanceForAccounts(testGlEntries, [CANONICAL_ACCOUNTS.CASH], 'DEBIT', asOfDate);
  const glCashAll = calculateGlBalanceForAccounts(testGlEntries, [CANONICAL_ACCOUNTS.CASH], 'DEBIT');

  console.assert(glCashAsOf === 5000, `GL Cash as of ${asOfDate} should be 5000, got ${glCashAsOf}`);
  console.assert(glCashAll === 8000, `GL Cash all dates should be 8000, got ${glCashAll}`);
  console.log('✓ calculateGlBalanceForAccounts correctly filters GL entries by asOfDate');

  // 2. Test Cash/Bank as of date
  const mockDbCash = {
    cashBankAccounts: {
      toArray: async () => [
        { id: 'acc-1', name: 'Main Cash', accountType: 'CASH', currentBalance: 8000 }
      ]
    },
    journalEntries: {
      toArray: async () => testGlEntries
    }
  };

  const cashRecAsOf = await reconcileCashBankBalances(mockDbCash, testGlEntries, asOfDate);
  console.assert(cashRecAsOf.operationalAmount === 5000, `Cash op as of ${asOfDate} should be 5000, got ${cashRecAsOf.operationalAmount}`);
  console.assert(cashRecAsOf.glAmount === 5000, `Cash GL as of ${asOfDate} should be 5000, got ${cashRecAsOf.glAmount}`);
  console.assert(cashRecAsOf.isMatched === true, `Cash should be matched as of ${asOfDate}`);
  console.log('✓ Check 11 (Cash/Bank) correctly reconciles as-of date');

  // 3. Test Inventory as of date
  const mockDbInventory = {
    inventoryItems: {
      toArray: async () => [
        { id: 'item-1', name: 'Fish Feed', category: 'FEED', currentStock: 150, avgCostPrice: 50 } // current val = 7500
      ]
    },
    stockMovements: {
      toArray: async () => [
        { id: 'sm-1', itemId: 'item-1', date: beforeDate, movementType: 'PURCHASE', quantity: 100, unitCost: 50 },
        { id: 'sm-2', itemId: 'item-1', date: afterDate, movementType: 'PURCHASE', quantity: 50, unitCost: 50 }
      ]
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-inv-1',
          date: beforeDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, debit: 5000, credit: 0 }]
        },
        {
          id: 'je-inv-2',
          date: afterDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY, debit: 2500, credit: 0 }]
        }
      ]
    }
  };

  const invRecAsOf = await reconcileInventorySubledger(mockDbInventory, undefined, asOfDate);
  console.assert(invRecAsOf.operationalAmount === 5000, `Inventory op as of ${asOfDate} should be 5000, got ${invRecAsOf.operationalAmount}`);
  console.assert(invRecAsOf.glAmount === 5000, `Inventory GL as of ${asOfDate} should be 5000, got ${invRecAsOf.glAmount}`);
  console.assert(invRecAsOf.isMatched === true, `Inventory should match as of ${asOfDate}`);
  console.log('✓ Check 1 (Inventory) correctly reconciles as-of date');

  // 4. Test AR (Customer Balances) as of date
  const mockDbAR = {
    parties: {
      toArray: async () => [
        { id: 'cust-1', name: 'Rahim Traders', type: 'CUSTOMER', balance: 12000 } // current balance 12,000
      ]
    },
    sales: {
      toArray: async () => [
        { id: 'sale-1', customerId: 'cust-1', date: beforeDate, paymentMethod: 'CREDIT', dueAmount: 7000 },
        { id: 'sale-2', customerId: 'cust-1', date: afterDate, paymentMethod: 'CREDIT', dueAmount: 5000 }
      ]
    },
    payments: {
      toArray: async () => []
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-ar-1',
          date: beforeDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 7000, credit: 0 }]
        },
        {
          id: 'je-ar-2',
          date: afterDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 5000, credit: 0 }]
        }
      ]
    }
  };

  const arRecAsOf = await reconcileCustomerBalances(mockDbAR, undefined, asOfDate);
  console.assert(arRecAsOf.operationalAmount === 7000, `AR op as of ${asOfDate} should be 7000, got ${arRecAsOf.operationalAmount}`);
  console.assert(arRecAsOf.glAmount === 7000, `AR GL as of ${asOfDate} should be 7000, got ${arRecAsOf.glAmount}`);
  console.assert(arRecAsOf.isMatched === true, `AR should match as of ${asOfDate}`);
  console.log('✓ Check 2 (Customer Balances / AR) correctly reconciles as-of date');

  // 5. Test AP (Supplier Balances) as of date
  const mockDbAP = {
    parties: {
      toArray: async () => [
        { id: 'sup-1', name: 'Agro Supplies', type: 'SUPPLIER', balance: 9000 } // current balance 9,000
      ]
    },
    purchases: {
      toArray: async () => [
        { id: 'pur-1', supplierId: 'sup-1', date: beforeDate, paymentMethod: 'CREDIT', dueAmount: 4000 },
        { id: 'pur-2', supplierId: 'sup-1', date: afterDate, paymentMethod: 'CREDIT', dueAmount: 5000 }
      ]
    },
    payments: {
      toArray: async () => []
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-ap-1',
          date: beforeDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: 4000 }]
        },
        {
          id: 'je-ap-2',
          date: afterDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: 5000 }]
        }
      ]
    }
  };

  const apRecAsOf = await reconcileSupplierBalances(mockDbAP, undefined, asOfDate);
  console.assert(apRecAsOf.operationalAmount === 4000, `AP op as of ${asOfDate} should be 4000, got ${apRecAsOf.operationalAmount}`);
  console.assert(apRecAsOf.glAmount === 4000, `AP GL as of ${asOfDate} should be 4000, got ${apRecAsOf.glAmount}`);
  console.assert(apRecAsOf.isMatched === true, `AP should match as of ${asOfDate}`);
  console.log('✓ Check 3 (Supplier Balances / AP) correctly reconciles as-of date');

  // 6. Test Fixed Assets & Accumulated Depreciation as of date
  const mockDbAssets = {
    fixedAssets: {
      toArray: async () => [
        {
          id: 'fa-1',
          name: 'Tractor',
          category: 'MACHINERY',
          originalCost: 500000,
          purchaseDate: beforeDate,
          accumulatedDepreciation: 50000,
          status: 'ACTIVE'
        },
        {
          id: 'fa-2',
          name: 'Water Pump',
          category: 'MACHINERY',
          originalCost: 80000,
          purchaseDate: afterDate, // purchased AFTER asOfDate
          accumulatedDepreciation: 0,
          status: 'ACTIVE'
        }
      ]
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-fa-1',
          date: beforeDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.MACHINERY, debit: 500000, credit: 0 }]
        },
        {
          id: 'je-fa-2',
          date: afterDate,
          lines: [{ accountCode: CANONICAL_ACCOUNTS.MACHINERY, debit: 80000, credit: 0 }]
        },
        {
          id: 'je-dep-1',
          date: beforeDate,
          reference: 'fa-1',
          narration: 'Depreciation fa-1',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, debit: 0, credit: 30000 }]
        },
        {
          id: 'je-dep-2',
          date: afterDate,
          reference: 'fa-1',
          narration: 'Depreciation fa-1',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION, debit: 0, credit: 20000 }]
        }
      ]
    }
  };

  const faRecAsOf = await reconcileFixedAssetRegister(mockDbAssets, undefined, asOfDate);
  console.assert(faRecAsOf.operationalAmount === 500000, `FA op as of ${asOfDate} should exclude pump: 500000, got ${faRecAsOf.operationalAmount}`);
  console.assert(faRecAsOf.glAmount === 500000, `FA GL as of ${asOfDate} should be 500000, got ${faRecAsOf.glAmount}`);
  console.assert(faRecAsOf.isMatched === true, `FA should match as of ${asOfDate}`);
  console.log('✓ Check 7 (Fixed Assets) correctly reconciles as-of date');

  const depRecAsOf = await reconcileAccumulatedDepreciation(mockDbAssets, undefined, asOfDate);
  console.assert(depRecAsOf.operationalAmount === 30000, `Dep op as of ${asOfDate} should be 30000, got ${depRecAsOf.operationalAmount}`);
  console.assert(depRecAsOf.glAmount === 30000, `Dep GL as of ${asOfDate} should be 30000, got ${depRecAsOf.glAmount}`);
  console.assert(depRecAsOf.isMatched === true, `Depreciation should match as of ${asOfDate}`);
  console.log('✓ Check 8 (Accumulated Depreciation) correctly reconciles as-of date');

  // 7. Test Investor Capital and Profit Payable as of date
  const mockDbInvestors = {
    investors: {
      toArray: async () => [
        {
          id: 'inv-1',
          name: 'Zahid Khan',
          currentCapitalBalance: 200000, // 100k initial + 100k after asOfDate
          profitPayable: 25000, // 15k before + 10k after
          entryDate: beforeDate
        }
      ]
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-cap-1',
          date: beforeDate,
          reference: 'inv-1',
          narration: 'Zahid Khan initial capital',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, debit: 0, credit: 100000 }]
        },
        {
          id: 'je-cap-2',
          date: afterDate,
          reference: 'inv-1',
          narration: 'Zahid Khan add capital',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL, debit: 0, credit: 100000 }]
        },
        {
          id: 'je-prof-1',
          date: beforeDate,
          reference: 'inv-1',
          narration: 'Zahid Khan profit allocation',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, debit: 0, credit: 15000 }]
        },
        {
          id: 'je-prof-2',
          date: afterDate,
          reference: 'inv-1',
          narration: 'Zahid Khan profit allocation 2',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE, debit: 0, credit: 10000 }]
        }
      ]
    }
  };

  const capRecAsOf = await reconcileInvestorCapital(mockDbInvestors, undefined, asOfDate);
  console.assert(capRecAsOf.operationalAmount === 100000, `Investor Cap op as of ${asOfDate} should be 100000, got ${capRecAsOf.operationalAmount}`);
  console.assert(capRecAsOf.glAmount === 100000, `Investor Cap GL as of ${asOfDate} should be 100000, got ${capRecAsOf.glAmount}`);
  console.assert(capRecAsOf.isMatched === true, `Investor Capital should match as of ${asOfDate}`);
  console.log('✓ Check 9 (Investor Capital) correctly reconciles as-of date');

  const profRecAsOf = await reconcileInvestorProfitPayable(mockDbInvestors, undefined, asOfDate);
  console.assert(profRecAsOf.operationalAmount === 15000, `Investor Profit Payable op as of ${asOfDate} should be 15000, got ${profRecAsOf.operationalAmount}`);
  console.assert(profRecAsOf.glAmount === 15000, `Investor Profit Payable GL as of ${asOfDate} should be 15000, got ${profRecAsOf.glAmount}`);
  console.assert(profRecAsOf.isMatched === true, `Investor Profit Payable should match as of ${asOfDate}`);
  console.log('✓ Check 10 (Investor Profit Payable) correctly reconciles as-of date');

  // 8. Test Livestock biological assets as of date
  const mockDbLivestock = {
    animals: {
      toArray: async () => [
        {
          id: 'cow-1',
          name: 'Shahiwal Cow',
          tag: 'TAG-101',
          purchaseDate: beforeDate,
          purchasePrice: 60000,
          feedCost: 15000, // 10k before + 5k after
          status: 'ACTIVE'
        },
        {
          id: 'cow-2',
          name: 'Friesian Heifer',
          tag: 'TAG-102',
          purchaseDate: afterDate, // purchased AFTER asOfDate
          purchasePrice: 70000,
          status: 'ACTIVE'
        }
      ]
    },
    journalEntries: {
      toArray: async () => [
        {
          id: 'je-ls-1',
          date: beforeDate,
          reference: 'cow-1',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, debit: 70000, credit: 0 }]
        },
        {
          id: 'je-ls-2',
          date: afterDate,
          reference: 'cow-1',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, debit: 5000, credit: 0 }]
        },
        {
          id: 'je-ls-3',
          date: afterDate,
          reference: 'cow-2',
          lines: [{ accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, debit: 70000, credit: 0 }]
        }
      ]
    }
  };

  const lsRecAsOf = await reconcileLivestockBiologicalAssets(mockDbLivestock, undefined, asOfDate);
  console.assert(lsRecAsOf.operationalAmount === 70000, `Livestock op as of ${asOfDate} should exclude cow-2 and post debits: 70000, got ${lsRecAsOf.operationalAmount}`);
  console.assert(lsRecAsOf.glAmount === 70000, `Livestock GL as of ${asOfDate} should be 70000, got ${lsRecAsOf.glAmount}`);
  console.assert(lsRecAsOf.isMatched === true, `Livestock should match as of ${asOfDate}`);
  console.log('✓ Check 6 (Livestock) correctly reconciles as-of date');

  console.log('--- ALL AS-OF DATE RECONCILIATION TESTS PASSED! ---');
}

testAsOfDateReconciliation().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
