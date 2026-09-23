import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { reverseTransaction } from '../accounting/accountingEngine';
import {
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction,
  executeInvestorProfitPaymentTransaction,
  executeInvestorCapitalReturnTransaction,
  executeFishStockingTransaction,
  executeFishProductionCostTransaction,
  executeFishHarvestAndSaleTransaction
} from '../services/transactionService';
import {
  executeFixedAssetAcquisitionTransaction,
  executeAssetDepreciationAtomic,
  executeFixedAssetDisposalTransaction
} from '../accounting/depreciationService';
import { InventoryItem } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runTaskB2Tests() {
  console.log('====================================================');
  console.log('RUNNING TASK B2: REVERSAL COVERAGE TESTS');
  console.log('====================================================');

  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.add({
      ...acc
    });
  }

  const cashAccount = {
    id: 'cba-cash-01',
    name: 'নগদ ক্যাশ (Main Cash)',
    accountName: 'নগদ ক্যাশ (Main Cash)',
    accountType: 'CASH' as const,
    accountNumber: '1010-01',
    currentBalance: 1000000,
    isActive: true,
    isDefault: true,
    synced: false
  };
  await db.cashBankAccounts.add(cashAccount);

  // ----------------------------------------------------
  // TEST 1: LOAN DISBURSEMENT & REPAYMENT REVERSAL
  // ----------------------------------------------------
  console.log('\n--- Test 1: Loan Disbursement & Repayment Reversal ---');
  const loanDisburseRes = await executeLoanTransaction({
    lenderName: 'Grameen Bank',
    principal: 100000,
    interestRate: 10,
    tenureMonths: 12,
    annualInterestRatePercent: 10,
    termMonths: 12,
    startDate: '2026-03-01',
    targetAccountId: 'cba-cash-01',
    currentUserId: 'usr-b2'
  });
  const loanId = loanDisburseRes.loan.id;
  const disburseJournalId = loanDisburseRes.journalEntryId;

  const loanAfterDisburse = await db.loans.get(loanId);
  assert(loanAfterDisburse?.status === 'ACTIVE', 'Loan should be active after disburse');
  assert(loanAfterDisburse?.remainingPrincipal === 100000, 'Loan remainingPrincipal should be 100000');

  // Repay one installment
  const repayRes = await executeLoanRepaymentTransaction({
    loanId,
    principalAmount: 8000,
    interestAmount: 833,
    sourceAccountId: 'cba-cash-01',
    repaymentDate: '2026-03-15',
    currentUserId: 'usr-b2'
  });
  const repayJournalId = repayRes.journalEntryId;

  let loanAfterRepay = await db.loans.get(loanId);
  assert(loanAfterRepay?.remainingPrincipal === 92000, 'Loan remaining principal should be 92000');
  assert(loanAfterRepay?.totalPaidPrincipal === 8000, 'Total paid principal should be 8000');

  // Reversal 1A: Reverse the repayment
  const revRepayRes = await reverseTransaction(repayJournalId, 'usr-b2');
  assert(!!revRepayRes.reversal, 'Reversal entry should be created');

  let loanAfterRepayReversal = await db.loans.get(loanId);
  assert(loanAfterRepayReversal?.remainingPrincipal === 100000, `Loan remaining principal should be restored to 100000, got ${loanAfterRepayReversal?.remainingPrincipal}`);
  assert(loanAfterRepayReversal?.totalPaidPrincipal === 0, `Loan totalPaidPrincipal should be restored to 0, got ${loanAfterRepayReversal?.totalPaidPrincipal}`);
  assert(loanAfterRepayReversal?.status === 'ACTIVE', 'Loan status should be ACTIVE');
  console.log('✅ Test 1A Passed: Loan repayment reversal successfully restored loan balance and schedule');

  // Reversal 1B: Reverse the disbursement
  await reverseTransaction(disburseJournalId, 'usr-b2');
  const loanAfterDisburseReversal = await db.loans.get(loanId);
  assert(loanAfterDisburseReversal?.status === 'CANCELLED', `Loan status should be CANCELLED, got ${loanAfterDisburseReversal?.status}`);
  console.log('✅ Test 1B Passed: Loan disbursement reversal marked loan CANCELLED');

  // ----------------------------------------------------
  // TEST 2: INVESTOR TRANSACTIONS REVERSAL
  // ----------------------------------------------------
  console.log('\n--- Test 2: Investor Transactions Reversal ---');
  // 2A: Capital Contribution
  const investRes = await executeInvestorTransaction({
    investorName: 'Akram Khan',
    contribution: 200000,
    profitShare: 20,
    date: '2026-03-01',
    targetAccountId: 'cba-cash-01',
    currentUserId: 'usr-b2'
  });
  const investorId = investRes.investor.id;
  const investJournalId = investRes.journalEntryId;

  let inv = await db.investors.get(investorId);
  assert(inv?.capitalContributed === 200000, 'Investor capitalContributed should be 200000');

  // 2B: Profit Allocation (Profit must be > 0)
  const allocRes = await executeInvestorProfitAllocationTransaction({
    investorId,
    finalizedDistributableProfit: 100000, // 20% of 100000 = 20000
    allocationDate: '2026-03-10',
    currentUserId: 'usr-b2'
  });
  const allocJournalId = allocRes.journalEntryId;
  inv = await db.investors.get(investorId);
  assert(inv?.totalProfitAllocated === 20000, `Investor totalProfitAllocated should be 20000, got ${inv?.totalProfitAllocated}`);
  assert(inv?.profitPayable === 20000, `Investor profitPayable should be 20000, got ${inv?.profitPayable}`);

  // Reverse profit allocation
  await reverseTransaction(allocJournalId, 'usr-b2');
  inv = await db.investors.get(investorId);
  assert(inv?.totalProfitAllocated === 0, 'Investor totalProfitAllocated should be reverted to 0');
  assert(inv?.profitPayable === 0, 'Investor profitPayable should be reverted to 0');
  console.log('✅ Test 2A Passed: Investor profit allocation reversal succeeded');

  // Re-allocate and then pay profit
  await executeInvestorProfitAllocationTransaction({
    investorId,
    finalizedDistributableProfit: 100000,
    allocationDate: '2026-03-10',
    currentUserId: 'usr-b2'
  });
  const payProfitRes = await executeInvestorProfitPaymentTransaction({
    investorId,
    amount: 15000,
    sourceAccountId: 'cba-cash-01',
    paymentDate: '2026-03-12',
    currentUserId: 'usr-b2'
  });
  const payProfitJournalId = payProfitRes.journalEntryId;
  inv = await db.investors.get(investorId);
  assert(inv?.totalProfitPaid === 15000, 'Investor totalProfitPaid should be 15000');
  assert(inv?.profitPayable === 5000, 'Investor profitPayable should be 5000');

  // Reverse profit payment
  await reverseTransaction(payProfitJournalId, 'usr-b2');
  inv = await db.investors.get(investorId);
  assert(inv?.totalProfitPaid === 0, 'Investor totalProfitPaid should be reverted to 0');
  assert(inv?.profitPayable === 20000, 'Investor profitPayable should be restored to 20000');
  console.log('✅ Test 2B Passed: Investor profit payment reversal succeeded');

  // 2C: Capital Return
  const capReturnRes = await executeInvestorCapitalReturnTransaction({
    investorId,
    amount: 50000,
    sourceAccountId: 'cba-cash-01',
    returnDate: '2026-03-14',
    currentUserId: 'usr-b2'
  });
  const capReturnJournalId = capReturnRes.journalEntryId;
  inv = await db.investors.get(investorId);
  assert(inv?.totalCapitalReturned === 50000, 'Investor totalCapitalReturned should be 50000');

  // Reverse Capital Return
  await reverseTransaction(capReturnJournalId, 'usr-b2');
  inv = await db.investors.get(investorId);
  assert(inv?.totalCapitalReturned === 0, 'Investor totalCapitalReturned should be reverted to 0');
  assert(inv?.netCapital === 200000, 'Investor netCapital should be restored to 200000');
  console.log('✅ Test 2C Passed: Investor capital return reversal succeeded');

  // ----------------------------------------------------
  // TEST 3: FIXED ASSET REVERSAL (ACQUISITION, DEPRECIATION, DISPOSAL)
  // ----------------------------------------------------
  console.log('\n--- Test 3: Fixed Asset Reversal ---');
  // 3A: Acquisition
  const acqRes = await executeFixedAssetAcquisitionTransaction({
    name: 'Water Pump A1',
    category: 'MACHINERY',
    purchaseDate: '2026-01-01',
    originalCost: 50000,
    salvageValue: 5000,
    usefulLifeYears: 5,
    paymentMethod: 'CASH',
    bankAccountId: 'cba-cash-01',
    currentUserId: 'usr-b2'
  });
  const assetId = acqRes.asset.id;
  const acqJournalId = acqRes.journalEntry.id;

  let asset = await db.fixedAssets.get(assetId);
  assert(asset?.status === 'ACTIVE', 'Asset should be ACTIVE');
  assert(asset?.originalCost === 50000, 'Asset originalCost should be 50000');

  // 3B: Post depreciation
  const deprRes = await executeAssetDepreciationAtomic(
    assetId,
    { targetDate: '2026-02-01' }
  );
  assert(deprRes.journalEntryIds.length > 0, 'Depreciation journal should be posted');
  const deprJournalId = deprRes.journalEntryIds[0];

  asset = await db.fixedAssets.get(assetId);
  const accumBeforeRev = asset?.accumulatedDepreciation || 0;
  assert(accumBeforeRev > 0, 'Accumulated depreciation should be > 0');

  // Reverse depreciation
  await reverseTransaction(deprJournalId, 'usr-b2');
  asset = await db.fixedAssets.get(assetId);
  assert(asset?.accumulatedDepreciation === 0, `Accumulated depreciation should be 0, got ${asset?.accumulatedDepreciation}`);
  assert(asset?.currentBookValue === 50000, `Book value should be restored to 50000, got ${asset?.currentBookValue}`);
  console.log('✅ Test 3A Passed: Fixed asset depreciation reversal succeeded');

  // 3C: Disposal
  const dispRes = await executeFixedAssetDisposalTransaction({
    assetId,
    disposalDate: '2026-03-01',
    disposalProceeds: 40000,
    paymentMethod: 'CASH',
    bankAccountId: 'cba-cash-01'
  });
  asset = await db.fixedAssets.get(assetId);
  assert(asset?.status === 'DISPOSED', 'Asset status should be DISPOSED');

  // Reverse Disposal
  await reverseTransaction(dispRes.journalEntryId, 'usr-b2');
  asset = await db.fixedAssets.get(assetId);
  assert(asset?.status === 'ACTIVE', 'Asset status should be restored to ACTIVE');
  assert(!asset?.disposalJournalId, 'Asset disposalJournalId should be cleared');
  console.log('✅ Test 3B Passed: Fixed asset disposal reversal restored asset to ACTIVE');

  // Reverse Acquisition
  await reverseTransaction(acqJournalId, 'usr-b2');
  asset = await db.fixedAssets.get(assetId);
  assert(asset?.status === 'CANCELLED', 'Asset status should be CANCELLED after acquisition reversal');
  console.log('✅ Test 3C Passed: Fixed asset acquisition reversal marked asset CANCELLED');

  // ----------------------------------------------------
  // TEST 4: FISH / CROP PRODUCTION REVERSAL
  // ----------------------------------------------------
  console.log('\n--- Test 4: Fish & Crop Production Reversal ---');
  // Stock feed item in inventory
  const feedItem: InventoryItem = {
    id: 'inv-feed-01',
    code: 'FEED-01',
    nameBn: 'মেগা ফিশ ফিড ১০কেজি',
    nameEn: 'Mega Fish Feed 10kg',
    category: 'FEED',
    currentStock: 100,
    unit: 'কেজি',
    avgCostPrice: 50,
    sellingPrice: 60,
    reorderLevel: 10,
    synced: false
  };
  await db.inventoryItems.add(feedItem);

  // 4A: Fish Stocking and Cost
  const fishStockRes = await executeFishStockingTransaction({
    pondName: 'Pond B2 Test',
    species: 'Tilapia',
    fingerlingQty: 2000,
    fingerlingCost: 15000,
    paymentMethod: 'CASH',
    stockingDate: '2026-03-01',
    currentUserId: 'usr-b2'
  });
  const batchId = fishStockRes.batch.id;

  // Add Feed cost from inventory
  const fishCostRes = await executeFishProductionCostTransaction({
    batchId,
    costType: 'FEED',
    amount: 1500, // 30 kg * 50
    quantity: 30,
    paymentMethod: 'INVENTORY',
    feedItemId: 'inv-feed-01',
    date: '2026-03-05',
    currentUserId: 'usr-b2'
  });

  let fb = await db.fishBatches.get(batchId);
  assert(fb?.totalFeedCost === 1500, 'Batch feed cost should be 1500');
  let invItem = await db.inventoryItems.get('inv-feed-01');
  assert(invItem?.currentStock === 70, `Inventory stock should be 70, got ${invItem?.currentStock}`);

  // Reverse fish feed cost
  await reverseTransaction(fishCostRes.journalEntryId, 'usr-b2');
  fb = await db.fishBatches.get(batchId);
  assert(fb?.totalFeedCost === 0, `Batch feed cost should be reverted to 0, got ${fb?.totalFeedCost}`);
  invItem = await db.inventoryItems.get('inv-feed-01');
  assert(invItem?.currentStock === 100, `Inventory stock should be restored to 100, got ${invItem?.currentStock}`);
  console.log('✅ Test 4A Passed: Fish production cost reversal restored batch cost and feed inventory');

  // 4B: Fish Harvest & Sale Reversal
  await db.fishBatches.update(batchId, { currentEstimatedWeightKg: 1000 });
  const harvestSaleRes = await executeFishHarvestAndSaleTransaction({
    batchId,
    harvestWeightKg: 200,
    soldWeightKg: 200,
    salePrice: 40000,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    currentUserId: 'usr-b2'
  });
  fb = await db.fishBatches.get(batchId);
  assert(fb?.harvestWeightKg === 200, 'Batch harvestWeightKg should be 200');
  assert(fb?.harvestRevenue === 40000, 'Batch harvestRevenue should be 40000');

  // Reverse fish harvest sale
  await reverseTransaction(harvestSaleRes.journalEntryId, 'usr-b2');
  fb = await db.fishBatches.get(batchId);
  assert(fb?.harvestWeightKg === 0, `Batch harvestWeightKg should be reverted to 0, got ${fb?.harvestWeightKg}`);
  assert(fb?.harvestRevenue === 0, `Batch harvestRevenue should be reverted to 0, got ${fb?.harvestRevenue}`);
  const saleRecord = await db.sales.get(harvestSaleRes.sale.id);
  assert(saleRecord?.status === 'CANCELLED', 'Sale record should be CANCELLED');
  console.log('✅ Test 4B Passed: Fish harvest and sale reversal restored batch stats and cancelled sale');

  console.log('\n====================================================');
  console.log('ALL TASK B2 REVERSAL COVERAGE TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('====================================================');
}

runTaskB2Tests()
  .then(() => {
    console.log('PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('UNRESOLVED:', err);
    process.exit(1);
  });
