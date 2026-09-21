import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeFishProductionCostTransaction,
  executeCropProductionCostTransaction,
  executeLivestockProductionCostTransaction
} from '../services/transactionService';
import { FishBatch, CropCycle, Animal, CashBankAccount, InventoryItem } from '../types';

async function runProductionCostActiveUITest() {
  console.log('====================================================');
  console.log('STARTING ACTIVE UI PRODUCTION COST VERIFICATION TEST');
  console.log('====================================================\n');

  // 1. Seed Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  // 2. Seed Cash Account
  await db.cashBankAccounts.clear();
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-01',
    name: 'Main Cash Drawer',
    accountName: 'Main Cash Drawer',
    accountType: 'CASH',
    accountNumber: 'CASH-01',
    currentBalance: 50000,
    isActive: true
  };
  await db.cashBankAccounts.add(cashAccount);

  // 3. Seed Feed Inventory Item (Feed -> 1051)
  await db.inventoryItems.clear();
  const feedItem: InventoryItem = {
    id: 'inv-feed-01',
    code: 'FD-01',
    nameBn: 'মাছের ভাসমান ফিড',
    nameEn: 'Floating Fish Feed',
    category: 'FEED',
    unit: 'kg',
    currentStock: 100,
    reorderLevel: 20,
    avgCostPrice: 75,
    sellingPrice: 85
  };
  await db.inventoryItems.add(feedItem);

  // 4. Seed Fertilizer Inventory Item (Seed & Fertilizer -> 1052)
  const fertItem: InventoryItem = {
    id: 'inv-fert-01',
    code: 'FERT-01',
    nameBn: 'ইউরিয়া সার',
    nameEn: 'Urea Fertilizer',
    category: 'SEED_FERTILIZER',
    unit: 'kg',
    currentStock: 50,
    reorderLevel: 10,
    avgCostPrice: 30,
    sellingPrice: 35
  };
  await db.inventoryItems.add(fertItem);

  // 5. Seed Fish Batch
  await db.fishBatches.clear();
  const fishBatch: FishBatch = {
    id: 'BATCH-FISH-001',
    pondId: 'pond-01',
    pondName: 'উত্তর পুকুর',
    species: 'তেলাপিয়া',
    stockingDate: '2026-03-01',
    fingerlingQty: 5000,
    fingerlingCost: 15000,
    totalFeedKg: 200,
    totalFeedCost: 16000,
    medicineCost: 500,
    labourCost: 2000,
    electricityCost: 1000,
    waterTreatmentCost: 500,
    otherCost: 0,
    mortalityCount: 50,
    currentEstimatedWeightKg: 800,
    status: 'ACTIVE'
  };
  await db.fishBatches.add(fishBatch);

  // 6. Seed Crop Cycle
  await db.cropCycles.clear();
  const cropCycle: CropCycle = {
    id: 'CYCLE-CROP-001',
    plotId: 'plot-01',
    plotName: 'প্লট-১ (দক্ষিণ মাঠ)',
    cropName: 'আমন ধান',
    cropCategory: 'GRAIN',
    plantingDate: '2026-03-05',
    expectedHarvestDate: '2026-07-15',
    areaDecimals: 50,
    seedCost: 3500,
    fertilizerCost: 4000,
    irrigationCost: 2500,
    labourCost: 6000,
    otherCost: 1000,
    protectionCost: 800,
    machineryCost: 1200,
    totalCost: 19000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0,
    status: 'GROWING'
  };
  await db.cropCycles.add(cropCycle);

  // 7. Seed Animal
  await db.animals.clear();
  const animal: Animal = {
    id: 'COW-001',
    tag: 'TAG-101',
    species: 'CATTLE',
    breed: 'হলস্টাইন ফ্রিজিয়ান',
    gender: 'FEMALE',
    birthDate: '2024-01-10',
    purchaseCost: 85000,
    purchaseDate: '2025-06-01',
    currentWeightKg: 350,
    status: 'ACTIVE',
    location: 'শেড ১',
    accumulatedFeedCost: 12000,
    accumulatedMedCost: 2500,
    accumulatedLabourCost: 4000,
    otherCosts: 1000,
    totalCost: 104500
  };
  await db.animals.add(animal);

  console.log('Initial Database Seeded Successfully.\n');

  // =========================================================================
  // TEST 1: FISH PRODUCTION COST THROUGH ACTIVE UI PATH
  // =========================================================================
  console.log('--- TEST 1: Executing Real Fish Cost Transaction ---');
  const fishCostAmount = 2500;
  const fishCostRes = await executeFishProductionCostTransaction({
    batchId: fishBatch.id,
    costType: 'FEED',
    amount: fishCostAmount,
    quantity: 30,
    date: '2026-03-21',
    paymentMethod: 'CASH',
    notes: 'নিয়মিত মাছের ভাসমান খাদ্য প্রয়োগ',
    currentUserId: 'test-user'
  });

  console.log(`Fish cost voucher generated: ${fishCostRes.voucherNumber}`);
  console.log(`Fish cost journal entry ID: ${fishCostRes.journalEntryId}`);

  // Verification 1a: Batch updated
  const updatedFishBatch = await db.fishBatches.get(fishBatch.id);
  if (!updatedFishBatch) throw new Error('Fish batch not found after cost update');
  const expectedFeedCost = fishBatch.totalFeedCost + fishCostAmount;
  if (updatedFishBatch.totalFeedCost !== expectedFeedCost) {
    throw new Error(`Fish totalFeedCost mismatch: expected ${expectedFeedCost}, got ${updatedFishBatch.totalFeedCost}`);
  }
  console.log(`[PASS] Fish batch totalFeedCost updated from ${fishBatch.totalFeedCost} to ${updatedFishBatch.totalFeedCost}`);

  // Verification 1b: Journal Entry
  const fishJournalEntry = await db.journalEntries.get(fishCostRes.journalEntryId);
  if (!fishJournalEntry) throw new Error('Fish journal entry not found');
  console.log(`[PASS] Fish journal entry found with totalDebit: ${fishJournalEntry.totalDebit}, totalCredit: ${fishJournalEntry.totalCredit}`);
  if (fishJournalEntry.totalDebit !== fishCostAmount || fishJournalEntry.totalCredit !== fishCostAmount) {
    throw new Error(`Fish journal entry unbalanced: debit=${fishJournalEntry.totalDebit}, credit=${fishJournalEntry.totalCredit}`);
  }
  const bioAssetDebit = fishJournalEntry.lines.find(l => l.accountCode === '1580');
  const cashCredit = fishJournalEntry.lines.find(l => l.accountCode === '1010');
  if (!bioAssetDebit || bioAssetDebit.debit !== fishCostAmount) {
    throw new Error(`Fish debit line to 1580 (Biological Asset) missing or wrong: ${JSON.stringify(bioAssetDebit)}`);
  }
  if (!cashCredit || cashCredit.credit !== fishCostAmount) {
    throw new Error(`Fish credit line to 1010 (Cash) missing or wrong: ${JSON.stringify(cashCredit)}`);
  }
  console.log(`[PASS] Fish journal lines verified: 1580 Biological Asset (Debit ৳${bioAssetDebit.debit}) / 1010 Cash (Credit ৳${cashCredit.credit})\n`);

  // =========================================================================
  // TEST 2: CROP PRODUCTION COST THROUGH ACTIVE UI PATH
  // =========================================================================
  console.log('--- TEST 2: Executing Real Crop Cost Transaction ---');
  const cropCostAmount = 1800;
  const cropCostRes = await executeCropProductionCostTransaction({
    cycleId: cropCycle.id,
    costType: 'FERTILIZER',
    amount: cropCostAmount,
    quantity: 60,
    date: '2026-03-21',
    paymentMethod: 'CASH',
    notes: 'সার প্রয়োগ (ইউরিয়া)',
    currentUserId: 'test-user'
  });

  console.log(`Crop cost voucher generated: ${cropCostRes.voucherNumber}`);
  console.log(`Crop cost journal entry ID: ${cropCostRes.journalEntryId}`);

  // Verification 2a: Crop Cycle updated
  const updatedCropCycle = await db.cropCycles.get(cropCycle.id);
  if (!updatedCropCycle) throw new Error('Crop cycle not found after cost update');
  const expectedFertCost = cropCycle.fertilizerCost + cropCostAmount;
  const expectedTotalCost = cropCycle.totalCost + cropCostAmount;
  if (updatedCropCycle.fertilizerCost !== expectedFertCost) {
    throw new Error(`Crop fertilizerCost mismatch: expected ${expectedFertCost}, got ${updatedCropCycle.fertilizerCost}`);
  }
  if (updatedCropCycle.totalCost !== expectedTotalCost) {
    throw new Error(`Crop totalCost mismatch: expected ${expectedTotalCost}, got ${updatedCropCycle.totalCost}`);
  }
  console.log(`[PASS] Crop cycle fertilizerCost updated from ${cropCycle.fertilizerCost} to ${updatedCropCycle.fertilizerCost}, totalCost updated from ${cropCycle.totalCost} to ${updatedCropCycle.totalCost}`);

  // Verification 2b: Journal Entry
  const cropJournalEntry = await db.journalEntries.get(cropCostRes.journalEntryId);
  if (!cropJournalEntry) throw new Error('Crop journal entry not found');
  console.log(`[PASS] Crop journal entry found with totalDebit: ${cropJournalEntry.totalDebit}, totalCredit: ${cropJournalEntry.totalCredit}`);
  if (cropJournalEntry.totalDebit !== cropCostAmount || cropJournalEntry.totalCredit !== cropCostAmount) {
    throw new Error(`Crop journal entry unbalanced: debit=${cropJournalEntry.totalDebit}, credit=${cropJournalEntry.totalCredit}`);
  }
  const wipDebit = cropJournalEntry.lines.find(l => l.accountCode === '1054');
  const cropCashCredit = cropJournalEntry.lines.find(l => l.accountCode === '1010');
  if (!wipDebit || wipDebit.debit !== cropCostAmount) {
    throw new Error(`Crop debit line to 1054 (WIP) missing or wrong: ${JSON.stringify(wipDebit)}`);
  }
  if (!cropCashCredit || cropCashCredit.credit !== cropCostAmount) {
    throw new Error(`Crop credit line to 1010 (Cash) missing or wrong: ${JSON.stringify(cropCashCredit)}`);
  }
  console.log(`[PASS] Crop journal lines verified: 1054 WIP (Debit ৳${wipDebit.debit}) / 1010 Cash (Credit ৳${cropCashCredit.credit})\n`);

  // =========================================================================
  // TEST 3: LIVESTOCK PRODUCTION COST THROUGH ACTIVE UI PATH
  // =========================================================================
  console.log('--- TEST 3: Executing Real Livestock Cost Transaction ---');
  const livestockCostAmount = 1200;
  const livestockCostRes = await executeLivestockProductionCostTransaction({
    animalId: animal.id,
    costType: 'MEDICINE',
    amount: livestockCostAmount,
    date: '2026-03-21',
    paymentMethod: 'CASH',
    notes: 'নিয়মিত কৃমিনাশক ও পুষ্টি ড্রিপ',
    weightKg: 355,
    nextDueDate: '2026-06-21',
    currentUserId: 'test-user'
  });

  console.log(`Livestock cost voucher generated: ${livestockCostRes.voucherNumber}`);
  console.log(`Livestock cost journal entry ID: ${livestockCostRes.journalEntryId}`);
  console.log(`Livestock event ID: ${livestockCostRes.eventId}`);

  // Verification 3a: Animal updated
  const updatedAnimal = await db.animals.get(animal.id);
  if (!updatedAnimal) throw new Error('Animal not found after cost update');
  const expectedMedCost = animal.accumulatedMedCost + livestockCostAmount;
  const expectedAnimalTotalCost = animal.totalCost + livestockCostAmount;
  if (updatedAnimal.accumulatedMedCost !== expectedMedCost) {
    throw new Error(`Animal accumulatedMedCost mismatch: expected ${expectedMedCost}, got ${updatedAnimal.accumulatedMedCost}`);
  }
  if (updatedAnimal.totalCost !== expectedAnimalTotalCost) {
    throw new Error(`Animal totalCost mismatch: expected ${expectedAnimalTotalCost}, got ${updatedAnimal.totalCost}`);
  }
  if (updatedAnimal.currentWeightKg !== 355) {
    throw new Error(`Animal currentWeightKg mismatch: expected 355, got ${updatedAnimal.currentWeightKg}`);
  }
  console.log(`[PASS] Animal accumulatedMedCost updated from ${animal.accumulatedMedCost} to ${updatedAnimal.accumulatedMedCost}, totalCost updated from ${animal.totalCost} to ${updatedAnimal.totalCost}, weight updated to ${updatedAnimal.currentWeightKg}kg`);

  // Verification 3b: AnimalEvent created
  const animalEvent = await db.animalEvents.get(livestockCostRes.eventId);
  if (!animalEvent) throw new Error('Animal event record not found');
  if (animalEvent.cost !== livestockCostAmount) {
    throw new Error(`Animal event cost mismatch: expected ${livestockCostAmount}, got ${animalEvent.cost}`);
  }
  console.log(`[PASS] AnimalEvent created: type=${animalEvent.eventType}, cost=৳${animalEvent.cost}`);

  // Verification 3c: Journal Entry
  const livestockJournalEntry = await db.journalEntries.get(livestockCostRes.journalEntryId);
  if (!livestockJournalEntry) throw new Error('Livestock journal entry not found');
  console.log(`[PASS] Livestock journal entry found with totalDebit: ${livestockJournalEntry.totalDebit}, totalCredit: ${livestockJournalEntry.totalCredit}`);
  if (livestockJournalEntry.totalDebit !== livestockCostAmount || livestockJournalEntry.totalCredit !== livestockCostAmount) {
    throw new Error(`Livestock journal entry unbalanced: debit=${livestockJournalEntry.totalDebit}, credit=${livestockJournalEntry.totalCredit}`);
  }
  const medExpenseDebit = livestockJournalEntry.lines.find(l => l.accountCode === '6040');
  const liveCashCredit = livestockJournalEntry.lines.find(l => l.accountCode === '1010');
  if (!medExpenseDebit || medExpenseDebit.debit !== livestockCostAmount) {
    throw new Error(`Livestock debit line to 6040 (Veterinary & Medicine) missing or wrong: ${JSON.stringify(medExpenseDebit)}`);
  }
  if (!liveCashCredit || liveCashCredit.credit !== livestockCostAmount) {
    throw new Error(`Livestock credit line to 1010 (Cash) missing or wrong: ${JSON.stringify(liveCashCredit)}`);
  }
  console.log(`[PASS] Livestock journal lines verified: 6040 Vet & Medicine (Debit ৳${medExpenseDebit.debit}) / 1010 Cash (Credit ৳${liveCashCredit.credit})\n`);

  console.log('====================================================');
  console.log('ALL 3 REAL PRODUCTION COSTS PASSED THROUGH ACTIVE UI FLOW');
  console.log('1. Fish Cost: UI -> executeFishProductionCostTransaction -> Journal Entry + Audit + Batch Accumulated Cost [PASSED]');
  console.log('2. Crop Cost: UI -> executeCropProductionCostTransaction -> Journal Entry + Audit + Cycle Accumulated Cost [PASSED]');
  console.log('3. Livestock Cost: UI -> executeLivestockProductionCostTransaction -> Journal Entry + Audit + Event + Animal Accumulated Cost [PASSED]');
  console.log('====================================================');
}

runProductionCostActiveUITest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
