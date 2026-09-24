import 'fake-indexeddb/auto';
import assert from 'assert';
import {
  executeProductionReceiptTransaction,
  getSourceProductionCostStatus
} from '../services/transactionService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { InventoryItem, CropCycle, Animal, JournalEntry, Account } from '../types';

/**
 * In-memory mock Dexie DB for Production Receipt Cost Protection tests
 */
function createMockDb() {
  const store: Record<string, Map<string, any>> = {
    inventoryItems: new Map(),
    stockMovements: new Map(),
    journalEntries: new Map(),
    accounts: new Map(),
    auditLogs: new Map(),
    cropCycles: new Map(),
    fishBatches: new Map(),
    animals: new Map(),
    closedPeriods: new Map()
  };

  function makeTable(name: string) {
    const map = store[name];
    return {
      get: async (id: string) => (map.has(id) ? JSON.parse(JSON.stringify(map.get(id))) : undefined),
      put: async (item: any) => {
        map.set(item.id, JSON.parse(JSON.stringify(item)));
        return item.id;
      },
      add: async (item: any) => {
        map.set(item.id, JSON.parse(JSON.stringify(item)));
        return item.id;
      },
      update: async (id: string, changes: any) => {
        const existing = map.get(id);
        if (existing) {
          const updated = { ...existing, ...changes };
          map.set(id, updated);
        }
      },
      delete: async (id: string) => {
        map.delete(id);
      },
      toArray: async () => Array.from(map.values()).map((i) => JSON.parse(JSON.stringify(i))),
      filter: (predicate: (item: any) => boolean) => ({
        toArray: async () =>
          Array.from(map.values())
            .filter(predicate)
            .map((i) => JSON.parse(JSON.stringify(i))),
        first: async () => {
          const found = Array.from(map.values()).find(predicate);
          return found ? JSON.parse(JSON.stringify(found)) : undefined;
        }
      })
    };
  }

  const dbInstance: any = {
    inventoryItems: makeTable('inventoryItems'),
    stockMovements: makeTable('stockMovements'),
    journalEntries: makeTable('journalEntries'),
    accounts: makeTable('accounts'),
    auditLogs: makeTable('auditLogs'),
    cropCycles: makeTable('cropCycles'),
    fishBatches: makeTable('fishBatches'),
    animals: makeTable('animals'),
    closedPeriods: makeTable('closedPeriods'),
    transaction: async (_mode: string, _tables: any[], callback: () => Promise<any>) => {
      return await callback();
    }
  };

  return { dbInstance, store };
}

async function seedChartOfAccounts(dbInstance: any) {
  const accounts: Partial<Account>[] = [
    { id: 'acc_1010', code: CANONICAL_ACCOUNTS.CASH, nameBn: 'নগদ টাকা (Cash)', type: 'ASSET' },
    { id: 'acc_1020', code: CANONICAL_ACCOUNTS.BANK, nameBn: 'ব্যাংক হিসাব (Bank)', type: 'ASSET' },
    { id: 'acc_1054', code: CANONICAL_ACCOUNTS.WIP, nameBn: 'প্রক্রিয়াধীন পণ্য (WIP)', type: 'ASSET' },
    { id: 'acc_1055', code: CANONICAL_ACCOUNTS.FINISHED_GOODS, nameBn: 'উৎপাদিত পণ্য (Finished Goods)', type: 'ASSET' },
    { id: 'acc_1580', code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS, nameBn: 'গবাদিপশু ও জৈবিক সম্পদ (Biological Assets)', type: 'ASSET' },
    { id: 'acc_5010', code: CANONICAL_ACCOUNTS.FEED_EXPENSE, nameBn: 'খাদ্য খরচ (Feed Expense)', type: 'EXPENSE' }
  ];

  for (const acc of accounts) {
    await dbInstance.accounts.put(acc);
  }
}

async function runTests() {
  console.log('--- STARTING TASK 2: PRODUCTION RECEIPT COST PROTECTION TESTS ---');
  const { dbInstance } = createMockDb();
  await seedChartOfAccounts(dbInstance);

  // Set up Inventory Item: ধান (Paddy)
  const paddyItem: InventoryItem = {
    id: 'item_paddy_001',
    code: 'INV-PDY-001',
    nameEn: 'Paddy Grain',
    nameBn: 'ধান',
    category: 'FINISHED_GOODS',
    unit: 'কেজি',
    currentStock: 50,
    reorderLevel: 10,
    avgCostPrice: 50, // Initial stock: 50 kg @ ৳50 = ৳2,500
    sellingPrice: 70,
    synced: false
  };
  await dbInstance.inventoryItems.put(paddyItem);

  // Set up Crop Cycle: আমন ধান ২০২৬
  const cycleA: CropCycle = {
    id: 'cycle_aman_2026',
    plotId: 'plot_east_01',
    plotName: 'পূর্ব মাঠ',
    cropName: 'আমন ধান ২০২৬',
    cropCategory: 'GRAIN',
    plantingDate: '2026-05-15',
    expectedHarvestDate: '2026-07-30',
    areaDecimals: 50,
    seedCost: 3000,
    fertilizerCost: 4000,
    irrigationCost: 2000,
    labourCost: 1000,
    otherCost: 0,
    totalCost: 10000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    status: 'GROWING'
  };
  await dbInstance.cropCycles.put(cycleA);

  // Seed legitimate accounting production cost for cycleA: ৳10,000 in WIP (1054)
  await dbInstance.journalEntries.put({
    id: 'j_seed_wip_cycle_a',
    voucherNumber: 'JV-WIP-01',
    voucherType: 'JOURNAL',
    date: '2026-06-01',
    narration: 'WIP production cost for Aman Paddy 2026',
    reference: cycleA.id,
    lines: [
      {
        accountId: 'acc_1054',
        accountCode: CANONICAL_ACCOUNTS.WIP,
        accountName: 'প্রক্রিয়াধীন পণ্য (WIP)',
        debit: 10000,
        credit: 0,
        memo: `[PRODUCTION_COST] [WIP] [${cycleA.id}] Seed, fertilizer, irrigation production cost`
      },
      {
        accountId: 'acc_1010',
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'নগদ টাকা (Cash)',
        debit: 0,
        credit: 10000,
        memo: `[PRODUCTION_COST] [WIP] [${cycleA.id}] Paid Cash`
      }
    ],
    createdAt: new Date().toISOString()
  });

  // Verify initial cost status for cycleA
  let status = await getSourceProductionCostStatus(cycleA.id, dbInstance);
  console.log('Initial Cycle A Cost Status:', {
    actualAccumulatedAccountingCost: status.actualAccumulatedAccountingCost,
    previouslyTransferredAmount: status.previouslyTransferredAmount,
    availableSourceProductionCost: status.availableSourceProductionCost,
    currentAssetBalance: status.currentAssetBalance
  });
  assert.strictEqual(status.actualAccumulatedAccountingCost, 10000, 'Actual accumulated cost must be ৳10,000');
  assert.strictEqual(status.previouslyTransferredAmount, 0, 'Previously transferred amount must be ৳0');
  assert.strictEqual(status.availableSourceProductionCost, 10000, 'Available source production cost must be ৳10,000');
  assert.strictEqual(status.currentAssetBalance, 10000, 'Current WIP asset balance must be ৳10,000');

  // =========================================================================
  // TEST 1: VALID RECEIPT
  // Transfer 100 kg @ ৳60 = ৳6,000 from cycleA into inventory (6000 <= 10000)
  // =========================================================================
  console.log('\n[TEST 1] Executing valid production receipt of ৳6,000 (below ৳10,000 limit)...');
  const validReceiptResult = await executeProductionReceiptTransaction(
    {
      itemId: paddyItem.id,
      quantity: 100,
      unitCost: 60,
      date: '2026-07-15',
      sourceBatchId: cycleA.id,
      notes: 'আমন ধান প্রথম মাড়াই শেষে ইনভেন্টরিতে গ্রহণ',
      currentUserId: 'usr_manager'
    },
    dbInstance
  );

  // 1. Verify physical inventory and weighted-average cost
  // Prev: 50 kg @ ৳50 = ৳2,500. New: 100 kg @ ৳60 = ৳6,000. Total: 150 kg, ৳8,500 => ৳56.67/kg
  assert.strictEqual(validReceiptResult.updatedItem.currentStock, 150, 'Stock must be updated to 150 kg');
  assert.strictEqual(validReceiptResult.updatedItem.avgCostPrice, 56.67, 'Weighted avg cost must be ৳56.67');

  // 2. Verify stock movement
  assert.strictEqual(validReceiptResult.movement.movementType, 'PRODUCTION', 'Movement must be PRODUCTION');
  assert.strictEqual(validReceiptResult.movement.totalValue, 6000, 'Movement total value must be ৳6,000');

  // 3. Verify balanced GL journal entry
  assert(validReceiptResult.journalEntry, 'Journal entry must be created');
  const debitedLine = validReceiptResult.journalEntry.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.FINISHED_GOODS);
  const creditedLine = validReceiptResult.journalEntry.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.WIP);
  assert(debitedLine && debitedLine.debit === 6000, 'Must debit Finished Goods (1055) by ৳6,000');
  assert(creditedLine && creditedLine.credit === 6000, 'Must credit WIP (1054) by ৳6,000');

  // 4. Verify updated source cost status
  status = await getSourceProductionCostStatus(cycleA.id, dbInstance);
  console.log('Post-Valid Receipt Cost Status:', {
    actualAccumulatedAccountingCost: status.actualAccumulatedAccountingCost,
    previouslyTransferredAmount: status.previouslyTransferredAmount,
    availableSourceProductionCost: status.availableSourceProductionCost,
    currentAssetBalance: status.currentAssetBalance
  });
  assert.strictEqual(status.actualAccumulatedAccountingCost, 10000, 'Total accumulated cost remains ৳10,000');
  assert.strictEqual(status.previouslyTransferredAmount, 6000, 'Previously transferred amount is now ৳6,000');
  assert.strictEqual(status.availableSourceProductionCost, 4000, 'Available remaining cost is now ৳4,000');
  assert.strictEqual(status.currentAssetBalance, 4000, 'Current WIP asset balance is now ৳4,000 (never negative)');
  console.log('✓ TEST 1 PASSED: Valid receipt executed correctly with weighted-average inventory and proper GL WIP credit.');

  // =========================================================================
  // TEST 2: EXACT REMAINING-COST RECEIPT
  // Transfer 40 kg @ ৳100 = ৳4,000 from cycleA into inventory (exact remaining ৳4,000)
  // =========================================================================
  console.log('\n[TEST 2] Executing exact remaining-cost receipt of ৳4,000 (exact remaining ৳4,000)...');
  const exactReceiptResult = await executeProductionReceiptTransaction(
    {
      itemId: paddyItem.id,
      quantity: 40,
      unitCost: 100,
      date: '2026-07-20',
      sourceBatchId: cycleA.id,
      notes: 'আমন ধান অবশিষ্ট সম্পূর্ণ ফলন ইনভেন্টরিতে গ্রহণ',
      currentUserId: 'usr_manager'
    },
    dbInstance
  );

  // 1. Verify physical inventory
  // Prev: 150 kg @ ৳56.67 = ৳8,500. New: 40 kg @ ৳100 = ৳4,000. Total: 190 kg, ৳12,500 => ৳65.79/kg
  assert.strictEqual(exactReceiptResult.updatedItem.currentStock, 190, 'Stock must be updated to 190 kg');
  assert.strictEqual(exactReceiptResult.updatedItem.avgCostPrice, 65.79, 'Weighted avg cost must be ৳65.79');

  // 2. Verify balanced GL journal entry
  const exactCredit = exactReceiptResult.journalEntry?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.WIP);
  assert(exactCredit && exactCredit.credit === 4000, 'Must credit WIP by exact remaining ৳4,000');

  // 3. Verify updated source cost status: remaining cost must be exactly 0
  status = await getSourceProductionCostStatus(cycleA.id, dbInstance);
  console.log('Post-Exact Receipt Cost Status:', {
    actualAccumulatedAccountingCost: status.actualAccumulatedAccountingCost,
    previouslyTransferredAmount: status.previouslyTransferredAmount,
    availableSourceProductionCost: status.availableSourceProductionCost,
    currentAssetBalance: status.currentAssetBalance
  });
  assert.strictEqual(status.previouslyTransferredAmount, 10000, 'Previously transferred amount is now ৳10,000');
  assert.strictEqual(status.availableSourceProductionCost, 0, 'Available remaining cost is now exactly ৳0');
  assert.strictEqual(status.currentAssetBalance, 0, 'Current WIP asset balance is exactly ৳0 (never negative)');
  console.log('✓ TEST 2 PASSED: Exact remaining-cost receipt executed with 100% absorption and zero negative WIP.');

  // =========================================================================
  // TEST 3: EXCESSIVE RECEIPT MUST BE REJECTED
  // =========================================================================
  console.log('\n[TEST 3] Testing excessive receipts and negative WIP prevention...');

  // 3a. Excessive transfer after source cost fully depleted
  console.log('3a: Attempting transfer of ৳100 from depleted source (available ৳0)...');
  let threwAfterDepleted = false;
  try {
    await executeProductionReceiptTransaction(
      {
        itemId: paddyItem.id,
        quantity: 1,
        unitCost: 100, // ৳100 requested > ৳0 available
        date: '2026-07-22',
        sourceBatchId: cycleA.id,
        notes: 'অতিরিক্ত অবৈধ স্থানান্তর চেষ্টা',
        currentUserId: 'usr_manager'
      },
      dbInstance
    );
  } catch (err: any) {
    threwAfterDepleted = true;
    console.log('Caught expected error:', err.message);
    assert(
      err.message.includes('অবশিষ্ট') || err.message.includes('নিষিদ্ধ'),
      'Error message must clearly reject transfer exceeding remaining cost'
    );
  }
  assert.strictEqual(threwAfterDepleted, true, 'Must throw error when attempting transfer from depleted source');

  // Verify inventory item and WIP remained completely unaffected
  const currentPaddy = await dbInstance.inventoryItems.get(paddyItem.id);
  assert.strictEqual(currentPaddy.currentStock, 190, 'Stock must not change when transaction is rejected');
  status = await getSourceProductionCostStatus(cycleA.id, dbInstance);
  assert.strictEqual(status.currentAssetBalance, 0, 'WIP balance must remain 0 and never become negative');

  // 3b. Excessive transfer exceeding available cost on a biological asset (Animal)
  console.log('3b: Attempting excessive transfer on an Animal source with ৳25,000 available when ৳30,000 is requested...');
  const milkCow: Animal = {
    id: 'cow_dairy_01',
    tag: 'COW-001',
    species: 'CATTLE',
    breed: 'Sahiwal',
    gender: 'FEMALE',
    birthDate: '2024-01-01',
    purchaseCost: 25000,
    purchaseDate: '2026-05-01',
    currentWeightKg: 350,
    location: 'Shed 1',
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    totalCost: 25000,
    status: 'ACTIVE'
  };
  await dbInstance.animals.put(milkCow);

  // Seed ৳25,000 biological asset carrying cost for cow_dairy_01
  await dbInstance.journalEntries.put({
    id: 'j_cow_purchase_01',
    voucherNumber: 'JV-COW-01',
    voucherType: 'JOURNAL',
    date: '2026-05-01',
    narration: 'Purchase and capitalization of dairy cow',
    reference: milkCow.id,
    lines: [
      {
        accountId: 'acc_1580',
        accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
        accountName: 'জৈবিক সম্পদ',
        debit: 25000,
        credit: 0,
        memo: `[CAPITALIZATION] [${milkCow.id}] Biological asset value`
      },
      {
        accountId: 'acc_1010',
        accountCode: CANONICAL_ACCOUNTS.CASH,
        accountName: 'নগদ টাকা',
        debit: 0,
        credit: 25000,
        memo: `[CAPITALIZATION] [${milkCow.id}] Paid Cash`
      }
    ],
    createdAt: new Date().toISOString()
  });

  const milkItem: InventoryItem = {
    id: 'item_milk_raw',
    code: 'INV-MLK-001',
    nameEn: 'Raw Milk',
    nameBn: 'কাঁচা দুধ',
    category: 'FINISHED_GOODS',
    unit: 'লিটার',
    currentStock: 0,
    reorderLevel: 5,
    avgCostPrice: 0,
    sellingPrice: 80,
    synced: false
  };
  await dbInstance.inventoryItems.put(milkItem);

  let threwAnimalExcess = false;
  try {
    await executeProductionReceiptTransaction(
      {
        itemId: milkItem.id,
        quantity: 300,
        unitCost: 100, // 300 * 100 = ৳30,000 > ৳25,000 available
        date: '2026-07-25',
        sourceAnimalId: milkCow.id,
        notes: 'গাভীর দুধ ইনভেন্টরিতে অতিরিক্ত স্থানান্তর',
        currentUserId: 'usr_manager'
      },
      dbInstance
    );
  } catch (err: any) {
    threwAnimalExcess = true;
    console.log('Caught expected error for animal excess:', err.message);
    assert(
      err.message.includes('অননুমোদিত') || err.message.includes('অতিরিক্ত'),
      'Must reject transfer exceeding biological asset carrying amount'
    );
  }
  assert.strictEqual(threwAnimalExcess, true, 'Excessive biological asset transfer must be rejected');

  // Verify biological asset balance was not made negative
  const cowCost = await getSourceProductionCostStatus(milkCow.id, dbInstance);
  assert.strictEqual(cowCost.availableSourceProductionCost, 25000, 'Animal available cost must remain ৳25,000');
  assert.strictEqual(cowCost.currentAssetBalance, 25000, 'Animal asset balance must remain ৳25,000 (never negative)');

  // 3c. Invented production cost rejection (Source has 0 accounting transactions)
  console.log('3c: Attempting transfer with invented/unbacked production cost (0 GL accounting debits)...');
  const fakeCycle: CropCycle = {
    id: 'cycle_fake_01',
    plotId: 'plot_fake_01',
    plotName: 'কাল্পনিক মাঠ',
    cropName: 'কাল্পনিক শস্য চক্র',
    cropCategory: 'GRAIN',
    plantingDate: '2026-05-15',
    expectedHarvestDate: '2026-07-30',
    areaDecimals: 50,
    seedCost: 0,
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 0,
    otherCost: 0,
    totalCost: 0,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    status: 'GROWING'
  };
  await dbInstance.cropCycles.put(fakeCycle);

  let threwInventedCost = false;
  try {
    await executeProductionReceiptTransaction(
      {
        itemId: paddyItem.id,
        quantity: 50,
        unitCost: 30, // ৳1,500 requested with no accounting cost
        date: '2026-07-25',
        sourceBatchId: fakeCycle.id,
        notes: 'কাল্পনিক হিসাবহীন স্থানান্তর',
        currentUserId: 'usr_manager'
      },
      dbInstance
    );
  } catch (err: any) {
    threwInventedCost = true;
    console.log('Caught expected error for invented cost:', err.message);
    assert(
      err.message.includes('কাল্পনিক') || err.message.includes('অনুমোদিত') || err.message.includes('হিসাব লেনদেন'),
      'Must reject invented production cost'
    );
  }
  assert.strictEqual(threwInventedCost, true, 'Invented unbacked cost must be rejected');

  // 3d. Cross-batch/cross-cycle isolation: Batch A cannot steal costs from Batch B
  console.log('3d: Attempting cross-batch transfer (Cycle A depleted, cannot borrow from Cow or Cycle B)...');
  let threwCrossBatch = false;
  try {
    await executeProductionReceiptTransaction(
      {
        itemId: paddyItem.id,
        quantity: 10,
        unitCost: 50, // ৳500 requested from cycleA which has 0 remaining
        date: '2026-07-26',
        sourceBatchId: cycleA.id,
        notes: 'অন্য ব্যাচ থেকে ধার নেওয়ার চেষ্টা',
        currentUserId: 'usr_manager'
      },
      dbInstance
    );
  } catch (err: any) {
    threwCrossBatch = true;
    console.log('Caught expected cross-batch error:', err.message);
  }
  assert.strictEqual(threwCrossBatch, true, 'Cross-batch transfer must be strictly blocked');

  console.log('✓ TEST 3 PASSED: All excessive, invented, depleted, and cross-batch transfers were rejected with zero negative WIP or biological assets.');

  console.log('\n=============================================================');
  console.log('ALL TASK 2 PRODUCTION RECEIPT COST PROTECTION TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
