import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  postJournalEntry,
  generateTrialBalance,
  generateBalanceSheet,
  generateProfitLoss,
  reverseJournalEntry,
  executeYearEndClosing
} from '../accounting/accountingEngine';
import {
  executeOwnerCapitalTransaction,
  executeInvestorTransaction,
  executePurchaseTransaction,
  executeSaleTransaction,
  executePaymentTransaction,
  executePurchaseReturnTransaction,
  executeSalesReturnTransaction,
  executeAdvancePaymentTransaction,
  executeStockAdjustmentTransaction,
  executeLivestockProductionCostTransaction,
  executeFishProductionCostTransaction,
  executeCropProductionCostTransaction,
  executeFishHarvestAndSaleTransaction,
  executeCropHarvestAndSaleTransaction,
  executeAnimalSaleOrRemovalTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeInvestorProfitAllocationTransaction,
  executeInvestorCapitalReturnTransaction,
  executeContraTransferTransaction
} from '../services/transactionService';
import {
  executeFixedAssetAcquisitionTransaction,
  executeAssetDepreciationAtomic,
  executeFixedAssetDisposalTransaction
} from '../accounting/depreciationService';
import { generateUniqueId } from '../utils/idGenerator';
import {
  Party,
  InventoryItem,
  Animal,
  FishBatch,
  CropCycle,
  JournalEntry,
  StockMovement
} from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function verifyAccountingState(context: string) {
  // 1. Debits = Credits for EVERY journal entry
  const entries: JournalEntry[] = await db.journalEntries.toArray();
  const seenIds = new Set<string>();

  for (const entry of entries) {
    assert(!seenIds.has(entry.id), `[${context}] Duplicate journal entry ID: ${entry.id}`);
    seenIds.add(entry.id);

    let debits = 0;
    let credits = 0;
    for (const line of entry.lines) {
      debits += Number(line.debit) || 0;
      credits += Number(line.credit) || 0;
    }
    const diff = Math.abs(Math.round(debits * 100) - Math.round(credits * 100)) / 100;
    assert(diff <= 0.05, `[${context}] Journal entry ${entry.voucherNumber || entry.id} unbalanced: Debits ৳${debits} != Credits ৳${credits}`);
  }

  // 2. Trial Balance balances: Total Debits = Total Credits
  const tb = await generateTrialBalance(undefined, db);
  const tbDiff = Math.abs(Math.round(tb.totalDebit * 100) - Math.round(tb.totalCredit * 100)) / 100;
  assert(tbDiff <= 0.05, `[${context}] Trial Balance unbalanced: Debits ৳${tb.totalDebit} != Credits ৳${tb.totalCredit}`);

  // 3. Balance Sheet balances: Assets = Liabilities + Equity
  const bs = await generateBalanceSheet(undefined, db);
  const bsDiff = Math.abs(Math.round(bs.totalAssets * 100) - Math.round((bs.totalLiabilities + bs.totalEquity) * 100)) / 100;
  assert(bsDiff <= 0.05, `[${context}] Balance Sheet unbalanced: Assets ৳${bs.totalAssets} != Liab+Equity ৳${bs.totalLiabilities + bs.totalEquity}`);

  // 4. Stock movements: No duplicates
  const movements: StockMovement[] = await db.stockMovements.toArray();
  const seenMvmtIds = new Set<string>();
  for (const m of movements) {
    assert(!seenMvmtIds.has(m.id), `[${context}] Duplicate stock movement ID: ${m.id}`);
    seenMvmtIds.add(m.id);
  }
}

export async function runCompleteAccountingLifecycleRegression() {
  console.log('================================================================');
  console.log('STARTING D1: COMPLETE ACCOUNTING INTEGRITY REGRESSION (32 TESTS)');
  console.log('================================================================');

  // Recreate fresh database
  await db.delete();
  await db.open();

  // Populate chart of accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.put(acc);
  }

  // Populate initial cash and bank accounts
  await db.cashBankAccounts.put({
    id: 'cb_cash',
    name: 'Main Cash Box',
    accountType: 'CASH',
    currentBalance: 0,
    synced: false
  });
  await db.cashBankAccounts.put({
    id: 'cb_bank',
    name: 'Sonali Bank A/C',
    accountType: 'BANK',
    currentBalance: 0,
    synced: false
  });

  const currentUserId = 'usr_auditor';

  // --------------------------------------------------------------------------
  // 1. Owner capital contribution
  // --------------------------------------------------------------------------
  console.log('1. Owner capital contribution...');
  await executeOwnerCapitalTransaction({
    amount: 500000,
    targetAccountId: 'cb_cash',
    currentUserId,
    date: '2026-01-01',
    notes: 'Initial owner investment'
  }, db);
  const cash1 = await db.cashBankAccounts.get('cb_cash');
  assert(cash1?.currentBalance === 500000, 'Cash balance updated to 500,000');
  await verifyAccountingState('1. Owner capital contribution');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 2. Investor capital contribution
  // --------------------------------------------------------------------------
  console.log('2. Investor capital contribution...');
  const invRes = await executeInvestorTransaction({
    investorName: 'Kazi Farhan',
    contribution: 200000,
    profitSharingRatio: 20,
    targetAccountId: 'cb_bank',
    currentUserId,
    date: '2026-01-02',
    notes: 'Investor equity share 20%'
  }, db);
  const bank2 = await db.cashBankAccounts.get('cb_bank');
  assert(bank2?.currentBalance === 200000, 'Bank balance updated to 200,000');
  assert(invRes.investor.currentBalance === 200000, 'Investor record balance 200,000');
  await verifyAccountingState('2. Investor capital contribution');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 3. Purchase — cash
  // --------------------------------------------------------------------------
  console.log('3. Purchase — cash...');
  const supplier: Party = {
    id: 'supp_1',
    name: 'Madina Agro Supplies',
    type: 'SUPPLIER',
    phone: '01700000001',
    balance: 0,
    synced: false
  };
  await db.parties.put(supplier);

  const feedItem: InventoryItem = {
    id: 'inv_feed',
    code: 'FEED-01',
    nameBn: 'পোল্ট্রি ও গবাদি ফিড',
    nameEn: 'Quality Animal Feed',
    category: 'FEED',
    unit: 'BAG',
    currentStock: 0,
    avgCostPrice: 0,
    sellingPrice: 1200,
    reorderLevel: 10,
    synced: false
  };
  await db.inventoryItems.put(feedItem);

  await executePurchaseTransaction({
    supplier,
    items: [{ item: feedItem, quantity: 100, unitPrice: 1000 }],
    paymentMethod: 'CASH',
    cashBankAccountId: 'cb_cash',
    date: '2026-01-05',
    currentUserId
  }, db);
  const feed3 = await db.inventoryItems.get('inv_feed');
  assert(feed3?.currentStock === 100, 'Feed stock is 100');
  assert(feed3?.avgCostPrice === 1000, 'Feed avg cost is 1,000');
  const cash3 = await db.cashBankAccounts.get('cb_cash');
  assert(cash3?.currentBalance === 400000, 'Cash balance reduced to 400,000');
  await verifyAccountingState('3. Purchase — cash');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 4. Purchase — payable (Credit)
  // --------------------------------------------------------------------------
  console.log('4. Purchase — payable (Credit)...');
  const medItem: InventoryItem = {
    id: 'inv_med',
    code: 'MED-01',
    nameBn: 'ভেট মেডিসিন',
    nameEn: 'Vet Medicine',
    category: 'MEDICINE',
    unit: 'BOTTLE',
    currentStock: 0,
    avgCostPrice: 0,
    sellingPrice: 250,
    reorderLevel: 10,
    synced: false
  };
  await db.inventoryItems.put(medItem);

  const purchaseCredit = await executePurchaseTransaction({
    supplier,
    items: [{ item: medItem, quantity: 50, unitPrice: 200 }],
    paymentMethod: 'CREDIT',
    date: '2026-01-06',
    currentUserId
  }, db);
  const med4 = await db.inventoryItems.get('inv_med');
  assert(med4?.currentStock === 50, 'Medicine stock is 50');
  const supp4 = await db.parties.get('supp_1');
  assert(supp4?.balance === 10000, 'Supplier payable is 10,000');
  await verifyAccountingState('4. Purchase — payable');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 5. Multi-line purchase
  // --------------------------------------------------------------------------
  console.log('5. Multi-line purchase...');
  await executePurchaseTransaction({
    supplier,
    items: [
      { item: feedItem, quantity: 20, unitPrice: 1000 },
      { item: medItem, quantity: 25, unitPrice: 200 }
    ],
    paymentMethod: 'CREDIT',
    date: '2026-01-07',
    currentUserId
  }, db);
  const feed5 = await db.inventoryItems.get('inv_feed');
  const med5 = await db.inventoryItems.get('inv_med');
  assert(feed5?.currentStock === 120, 'Feed stock is 120');
  assert(med5?.currentStock === 75, 'Med stock is 75');
  const supp5 = await db.parties.get('supp_1');
  assert(supp5?.balance === 35000, 'Supplier AP is 35,000 (10000 + 25000)');
  await verifyAccountingState('5. Multi-line purchase');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 6. Sale — cash
  // --------------------------------------------------------------------------
  console.log('6. Sale — cash...');
  const customer: Party = {
    id: 'cust_1',
    name: 'Rahim Poultry & Dairy',
    type: 'CUSTOMER',
    phone: '01700000002',
    balance: 0,
    synced: false
  };
  await db.parties.put(customer);

  await executeSaleTransaction({
    customer,
    items: [{ item: feedItem, quantity: 10, unitPrice: 1500 }],
    paymentMethod: 'CASH',
    cashBankAccountId: 'cb_cash',
    date: '2026-01-10',
    currentUserId
  }, db);
  const feed6 = await db.inventoryItems.get('inv_feed');
  assert(feed6?.currentStock === 110, 'Feed stock reduced to 110');
  const cash6 = await db.cashBankAccounts.get('cb_cash');
  assert(cash6?.currentBalance === 415000, 'Cash increased to 415,000 (400k + 15k)');
  await verifyAccountingState('6. Sale — cash');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 7. Sale — receivable (Credit)
  // --------------------------------------------------------------------------
  console.log('7. Sale — receivable...');
  const saleCredit = await executeSaleTransaction({
    customer,
    items: [{ item: feedItem, quantity: 10, unitPrice: 1500 }],
    paymentMethod: 'CREDIT',
    date: '2026-01-12',
    currentUserId
  }, db);
  const feed7 = await db.inventoryItems.get('inv_feed');
  assert(feed7?.currentStock === 100, 'Feed stock reduced to 100');
  const cust7 = await db.parties.get('cust_1');
  assert(cust7?.balance === 15000, 'Customer receivable is 15,000');
  await verifyAccountingState('7. Sale — receivable');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 8. Multi-line sale
  // --------------------------------------------------------------------------
  console.log('8. Multi-line sale...');
  await executeSaleTransaction({
    customer,
    items: [
      { item: feedItem, quantity: 5, unitPrice: 1500 },
      { item: medItem, quantity: 10, unitPrice: 300 }
    ],
    paymentMethod: 'CREDIT',
    date: '2026-01-14',
    currentUserId
  }, db);
  const feed8 = await db.inventoryItems.get('inv_feed');
  const med8 = await db.inventoryItems.get('inv_med');
  assert(feed8?.currentStock === 95, 'Feed stock is 95');
  assert(med8?.currentStock === 65, 'Med stock is 65');
  const cust8 = await db.parties.get('cust_1');
  assert(cust8?.balance === 25500, 'Customer AR is 25,500 (15000 + 10500)');
  await verifyAccountingState('8. Multi-line sale');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 9. Customer payment
  // --------------------------------------------------------------------------
  console.log('9. Customer payment...');
  await executePaymentTransaction({
    parentType: 'SALE',
    parentId: saleCredit.sale.id,
    amount: 15000,
    paymentMethod: 'CASH',
    date: '2026-01-15',
    currentUserId
  } as any, db);
  const cust9 = await db.parties.get('cust_1');
  assert(cust9?.balance === 10500, 'Customer AR reduced to 10,500');
  const cash9 = await db.cashBankAccounts.get('cb_cash');
  assert(cash9?.currentBalance === 430000, 'Cash increased to 430,000 (415k + 15k)');
  await verifyAccountingState('9. Customer payment');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 10. Supplier payment
  // --------------------------------------------------------------------------
  console.log('10. Supplier payment...');
  await executePaymentTransaction({
    parentType: 'PURCHASE',
    parentId: purchaseCredit.purchase.id,
    amount: 10000,
    paymentMethod: 'BANK',
    bankAccountId: 'cb_bank',
    date: '2026-01-16',
    currentUserId
  } as any, db);
  const supp10 = await db.parties.get('supp_1');
  assert(supp10?.balance === 25000, 'Supplier AP reduced to 25,000');
  const bank10 = await db.cashBankAccounts.get('cb_bank');
  assert(bank10?.currentBalance === 190000, 'Bank reduced to 190,000');
  await verifyAccountingState('10. Supplier payment');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 11. Purchase return
  // --------------------------------------------------------------------------
  console.log('11. Purchase return...');
  await executePurchaseReturnTransaction({
    purchaseId: purchaseCredit.purchase.id,
    itemId: 'inv_med',
    returnedQuantity: 5,
    unitPrice: 200,
    refundMethod: 'ADJUST_DUE',
    currentUserId,
    date: '2026-01-17'
  }, db);
  const med11 = await db.inventoryItems.get('inv_med');
  assert(med11?.currentStock === 60, 'Med stock reduced to 60');
  const supp11 = await db.parties.get('supp_1');
  assert(supp11?.balance === 24000, 'Supplier AP reduced by 1,000 to 24,000');
  await verifyAccountingState('11. Purchase return');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 12. Sales return
  // --------------------------------------------------------------------------
  console.log('12. Sales return...');
  await executeSalesReturnTransaction({
    saleId: saleCredit.sale.id,
    itemId: 'inv_feed',
    returnedQuantity: 2,
    unitPrice: 1500,
    refundMethod: 'ADJUST_DUE',
    currentUserId,
    date: '2026-01-18'
  }, db);
  const feed12 = await db.inventoryItems.get('inv_feed');
  assert(feed12?.currentStock === 97, 'Feed stock restored by 2 to 97');
  const cust12 = await db.parties.get('cust_1');
  assert(cust12?.balance === 7500, 'Customer AR reduced by 3,000 to 7,500');
  await verifyAccountingState('12. Sales return');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 13. Advance payment
  // --------------------------------------------------------------------------
  console.log('13. Advance payment...');
  await executeAdvancePaymentTransaction({
    partyId: customer.id,
    party: customer,
    amount: 8000,
    direction: 'RECEIVED',
    paymentMethod: 'CASH',
    cashBankAccountId: 'cb_cash',
    date: '2026-01-19',
    currentUserId
  }, db);
  const cash13 = await db.cashBankAccounts.get('cb_cash');
  assert(cash13?.currentBalance === 438000, 'Cash increased by 8,000 to 438,000');
  await verifyAccountingState('13. Advance payment');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 14. Inventory movement and valuation
  // --------------------------------------------------------------------------
  console.log('14. Inventory movement and valuation...');
  await executeStockAdjustmentTransaction({
    itemId: 'inv_feed',
    adjustmentType: 'INCREASE',
    quantity: 3,
    reason: 'Physical count found 3 extra bags',
    currentUserId,
    date: '2026-01-20'
  }, db);
  const feed14 = await db.inventoryItems.get('inv_feed');
  assert(feed14?.currentStock === 100, 'Feed stock adjusted to 100');
  await verifyAccountingState('14. Inventory movement and valuation');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 15. Feed inventory consumption & 16. Livestock production cost
  // --------------------------------------------------------------------------
  console.log('15. Feed inventory consumption & 16. Livestock production cost...');
  const animal: Animal = {
    id: 'cow_01',
    tag: 'COW-01',
    species: 'CATTLE',
    breed: 'Holstein Friesian',
    gender: 'FEMALE',
    birthDate: '2024-01-01',
    purchaseDate: '2025-01-01',
    purchaseCost: 0,
    currentWeightKg: 400,
    location: 'Shed A',
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    status: 'ACTIVE',
    totalCost: 0,
    synced: false
  };
  await db.animals.put(animal);

  // Consume 5 bags of feed directly for cow production cost
  await executeLivestockProductionCostTransaction({
    animalId: 'cow_01',
    costType: 'FEED',
    amount: 5000,
    paymentMethod: 'INVENTORY',
    feedItemId: 'inv_feed',
    feedQuantityUsed: 5,
    date: '2026-01-21',
    currentUserId
  });
  const cow16 = await db.animals.get('cow_01');
  assert(cow16?.accumulatedFeedCost === 5000, 'Cow feed cost is 5,000');
  assert(cow16?.totalCost === 5000, 'Cow total cost is 5,000');
  const feed16 = await db.inventoryItems.get('inv_feed');
  assert(feed16?.currentStock === 95, 'Feed stock reduced by 5 to 95');
  await verifyAccountingState('15 & 16. Feed consumption & Livestock production cost');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 17. Fish production cost
  // --------------------------------------------------------------------------
  console.log('17. Fish production cost...');
  const fishBatch: FishBatch = {
    id: 'batch_fish_01',
    pondId: 'pond_1',
    species: 'TILAPIA',
    status: 'ACTIVE',
    stockingDate: '2026-01-01',
    initialCount: 5000,
    currentCount: 5000,
    fingerlingQty: 5000,
    stockedQuantity: 5000,
    fingerlingCost: 0,
    totalCost: 0,
    synced: false
  } as any;
  await db.fishBatches.put(fishBatch);

  await executeFishProductionCostTransaction({
    batchId: 'batch_fish_01',
    costType: 'FEED',
    amount: 6000,
    paymentMethod: 'CASH',
    date: '2026-01-23',
    currentUserId
  });
  const batch17 = await db.fishBatches.get('batch_fish_01');
  assert(batch17?.totalFeedCost === 6000, 'Fish batch feed cost is 6,000');
  assert(batch17?.totalCost === 6000, 'Fish batch total cost is 6,000');
  await verifyAccountingState('17. Fish production cost');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 18. Crop production cost
  // --------------------------------------------------------------------------
  console.log('18. Crop production cost...');
  const cropCycle: any = {
    id: 'cycle_crop_01',
    plotId: 'plot_1',
    cropName: 'Aman Paddy',
    status: 'GROWING',
    plantingDate: '2026-01-01',
    seedCost: 0,
    totalCost: 0,
    synced: false
  };
  await db.cropCycles.put(cropCycle);

  await executeCropProductionCostTransaction({
    cycleId: 'cycle_crop_01',
    costType: 'FERTILIZER',
    amount: 5000,
    paymentMethod: 'CASH',
    date: '2026-01-24',
    currentUserId
  });
  const cycle18 = await db.cropCycles.get('cycle_crop_01');
  assert(cycle18?.fertilizerCost === 5000, 'Crop fertilizer cost is 5,000');
  assert(cycle18?.totalCost === 5000, 'Crop total cost is 5,000');
  await verifyAccountingState('18. Crop production cost');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 19. Fish harvest
  // --------------------------------------------------------------------------
  console.log('19. Fish harvest...');
  await executeFishHarvestAndSaleTransaction({
    batchId: 'batch_fish_01',
    harvestWeightKg: 800,
    soldWeightKg: 800,
    harvestQty: 5000,
    salePrice: 25000,
    paymentMethod: 'CASH',
    date: '2026-01-25',
    currentUserId
  } as any, db);
  const batch19 = await db.fishBatches.get('batch_fish_01');
  assert(batch19?.status === 'CLOSED' || (batch19?.status as any) === 'HARVESTED' || (batch19?.status as any) === 'COMPLETED', 'Fish batch harvested');
  await verifyAccountingState('19. Fish harvest');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 20. Crop harvest
  // --------------------------------------------------------------------------
  console.log('20. Crop harvest...');
  await executeCropHarvestAndSaleTransaction({
    cycleId: 'cycle_crop_01',
    harvestYieldKg: 1500,
    expectedYieldKg: 1500,
    salePrice: 20000,
    paymentMethod: 'CASH',
    date: '2026-01-26',
    currentUserId
  } as any, db);
  const cycle20 = await db.cropCycles.get('cycle_crop_01');
  assert(cycle20?.status === 'CLOSED' || (cycle20?.status as any) === 'HARVESTED' || (cycle20?.status as any) === 'COMPLETED', 'Crop cycle harvested');
  await verifyAccountingState('20. Crop harvest');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 21. Livestock sale
  // --------------------------------------------------------------------------
  console.log('21. Livestock sale...');
  await executeAnimalSaleOrRemovalTransaction({
    animalId: 'cow_01',
    newStatus: 'SOLD',
    salePrice: 85000,
    paymentMethod: 'CASH',
    date: '2026-01-27',
    currentUserId
  });
  const cow21 = await db.animals.get('cow_01');
  assert(cow21?.status === 'SOLD', 'Cow status is SOLD');
  await verifyAccountingState('21. Livestock sale');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 22. Loan principal and repayment with zero interest
  // --------------------------------------------------------------------------
  console.log('22. Loan principal and repayment with zero interest...');
  const loanRes = await executeLoanTransaction({
    lenderName: 'Krishi Bank',
    principal: 60000,
    interestRate: 0,
    tenureMonths: 6,
    targetAccountId: 'cb_bank',
    startDate: '2026-01-28',
    currentUserId
  }, db);
  const bank22A = await db.cashBankAccounts.get('cb_bank');
  assert(bank22A?.currentBalance === 250000, 'Bank increased to 250,000 (190k + 60k)');

  await executeLoanRepaymentTransaction({
    loanId: loanRes.loan.id,
    principalAmount: 20000,
    interestAmount: 0,
    sourceAccountId: 'cb_bank',
    repaymentDate: '2026-02-15',
    currentUserId
  }, db);
  const bank22B = await db.cashBankAccounts.get('cb_bank');
  assert(bank22B?.currentBalance === 230000, 'Bank reduced to 230,000');
  const loan22 = await db.loans.get(loanRes.loan.id);
  assert(loan22?.remainingPrincipal === 40000 || loan22?.remainingBalance === 40000, 'Loan balance is 40,000');
  await verifyAccountingState('22. Loan principal & repayment');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 23. Fixed asset purchase
  // --------------------------------------------------------------------------
  console.log('23. Fixed asset purchase...');
  const assetRes = await executeFixedAssetAcquisitionTransaction({
    name: 'Power Tiller Model X',
    category: 'EQUIPMENT',
    originalCost: 120000,
    purchaseDate: '2026-02-01',
    paymentMethod: 'BANK',
    bankAccountId: 'cb_bank',
    usefulLifeYears: 5,
    salvageValue: 0,
    currentUserId
  }, db);
  const bank23 = await db.cashBankAccounts.get('cb_bank');
  assert(bank23?.currentBalance === 110000, 'Bank reduced to 110,000 (230k - 120k)');
  await verifyAccountingState('23. Fixed asset purchase');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 24. Depreciation
  // --------------------------------------------------------------------------
  console.log('24. Depreciation...');
  await executeAssetDepreciationAtomic(assetRes.asset.id, {
    currentUserId,
    targetDate: '2026-03-31'
  }, db);
  const asset24 = await db.fixedAssets.get(assetRes.asset.id);
  assert(asset24?.accumulatedDepreciation > 0, 'Asset accumulated depreciation recorded');
  await verifyAccountingState('24. Depreciation');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 25. Asset disposal
  // --------------------------------------------------------------------------
  console.log('25. Asset disposal...');
  await executeFixedAssetDisposalTransaction({
    assetId: assetRes.asset.id,
    disposalDate: '2026-03-01',
    disposalProceeds: 119000,
    paymentMethod: 'BANK',
    bankAccountId: 'cb_bank',
    currentUserId
  }, db);
  const asset25 = await db.fixedAssets.get(assetRes.asset.id);
  assert(asset25?.status === 'DISPOSED', 'Asset status is DISPOSED');
  await verifyAccountingState('25. Asset disposal');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 26. Investor profit allocation
  // --------------------------------------------------------------------------
  console.log('26. Investor profit allocation...');
  await executeInvestorProfitAllocationTransaction({
    investorId: invRes.investor.id,
    finalizedDistributableProfit: 60000,
    allocatedProfit: 12000,
    allocationDate: '2026-03-05',
    currentUserId
  }, db);
  const inv26 = await db.investors.get(invRes.investor.id);
  assert((inv26?.profitPayable === 12000) || (inv26?.totalProfitAllocated === 12000), 'Investor profit payable is 12,000');
  await verifyAccountingState('26. Investor profit allocation');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 27. Investor capital return
  // --------------------------------------------------------------------------
  console.log('27. Investor capital return...');
  await executeInvestorCapitalReturnTransaction({
    investorId: invRes.investor.id,
    amount: 50000,
    sourceAccountId: 'cb_bank',
    returnDate: '2026-03-10',
    currentUserId
  }, db);
  const inv27 = await db.investors.get(invRes.investor.id);
  assert(inv27?.currentBalance === 150000, 'Investor principal is 150,000 (200k - 50k)');
  await verifyAccountingState('27. Investor capital return');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 28. Year-end closing
  // --------------------------------------------------------------------------
  console.log('28. Year-end closing...');
  await executeYearEndClosing({
    closingDate: '2026-06-30',
    userId: currentUserId,
    dbInstance: db
  });
  const closedPeriods = await db.closedPeriods.toArray();
  assert(closedPeriods.length > 0, 'Closed period record created');
  await verifyAccountingState('28. Year-end closing');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 29. Reversal
  // --------------------------------------------------------------------------
  console.log('29. Reversal...');
  // Post a test entry in an open date, then reverse it
  const testEntry = await postJournalEntry({
    id: generateUniqueId('j'),
    voucherNumber: 'JV-TEST-REV',
    voucherType: 'ADJUSTMENT',
    date: '2026-07-05',
    narration: 'Test entry for reversal',
    lines: [
      { accountCode: '1010', accountName: 'Cash', debit: 2000, credit: 0 },
      { accountCode: '4030', accountName: 'Feed Sales', debit: 0, credit: 2000 }
    ],
    createdBy: currentUserId,
    createdAt: new Date().toISOString()
  }, { dbInstance: db });

  await reverseJournalEntry(testEntry.id, currentUserId, '2026-07-06', db);
  const originalReversed = await db.journalEntries.get(testEntry.id);
  assert(!!originalReversed?.reversedBy, 'Original entry has reversedBy link');
  await verifyAccountingState('29. Reversal');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 30. Closed-period protection
  // --------------------------------------------------------------------------
  console.log('30. Closed-period protection...');
  let closedBlocked = false;
  try {
    await postJournalEntry({
      id: generateUniqueId('j'),
      voucherNumber: 'JV-BLOCKED',
      voucherType: 'ADJUSTMENT',
      date: '2026-06-15', // Inside closed period (2026-06-30)
      narration: 'Should be blocked',
      lines: [
        { accountCode: '1010', accountName: 'Cash', debit: 1000, credit: 0 },
        { accountCode: '4030', accountName: 'Feed Sales', debit: 0, credit: 1000 }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    }, { dbInstance: db });
  } catch (err: any) {
    if (err.message.includes('বন্ধ') || err.message.includes('closed') || err.message.includes('period')) {
      closedBlocked = true;
    }
  }
  assert(closedBlocked === true, 'Posting to closed period must be strictly rejected');
  await verifyAccountingState('30. Closed-period protection');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 31. Cash/bank transfer (Contra)
  // --------------------------------------------------------------------------
  console.log('31. Cash/bank transfer...');
  const cashBefore31 = (await db.cashBankAccounts.get('cb_cash'))?.currentBalance || 0;
  const bankBefore31 = (await db.cashBankAccounts.get('cb_bank'))?.currentBalance || 0;

  await executeContraTransferTransaction({
    fromAccountId: 'cb_cash',
    toAccountId: 'cb_bank',
    amount: 25000,
    currentUserId,
    date: '2026-07-10',
    dbInstance: db
  });

  const cashAfter31 = (await db.cashBankAccounts.get('cb_cash'))?.currentBalance || 0;
  const bankAfter31 = (await db.cashBankAccounts.get('cb_bank'))?.currentBalance || 0;
  assert(cashAfter31 === cashBefore31 - 25000, 'Cash reduced by 25,000');
  assert(bankAfter31 === bankBefore31 + 25000, 'Bank increased by 25,000');
  await verifyAccountingState('31. Cash/bank transfer');
  console.log('   ✅ PASS');

  // --------------------------------------------------------------------------
  // 32. Duplicate/idempotency protection & failure atomicity
  // --------------------------------------------------------------------------
  console.log('32. Duplicate/idempotency protection & failure atomicity...');
  let dupBlocked = false;
  try {
    // Reversing an already reversed entry must throw
    await reverseJournalEntry(testEntry.id, currentUserId, '2026-07-11', db);
  } catch (err: any) {
    dupBlocked = true;
  }
  assert(dupBlocked === true, 'Duplicate reversal must be blocked');

  // Failure atomicity: transaction failure rolls back completely
  const journalCountBeforeFail = await db.journalEntries.count();
  let failureRolledBack = false;
  try {
    await db.transaction('rw', [db.journalEntries, db.accounts], async () => {
      await db.journalEntries.put({
        id: 'bad_entry',
        voucherNumber: 'JV-FAIL',
        voucherType: 'ADJUSTMENT',
        date: '2026-07-12',
        narration: 'Failed transaction',
        lines: [
          { accountCode: '1010', accountName: 'Cash', debit: 500, credit: 0 },
          { accountCode: '1010', accountName: 'Cash', debit: 0, credit: 500 }
        ]
      } as any);
      // Throw intentionally
      throw new Error('Simulated atomic failure');
    });
  } catch {
    failureRolledBack = true;
  }
  assert(failureRolledBack === true, 'Transaction failure triggered');
  const journalCountAfterFail = await db.journalEntries.count();
  assert(journalCountAfterFail === journalCountBeforeFail, 'Failed transaction rolled back completely without partial state');

  await verifyAccountingState('32. Duplicate protection and atomicity');
  console.log('   ✅ PASS');

  console.log('================================================================');
  console.log('ALL 32 COMPLETE ACCOUNTING LIFECYCLE SCENARIOS PASSED! 🎉');
  console.log('================================================================');
  return { success: true };
}

runCompleteAccountingLifecycleRegression()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
