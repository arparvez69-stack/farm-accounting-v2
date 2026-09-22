import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeFishProductionCostTransaction,
  executeCropProductionCostTransaction,
  executeLivestockProductionCostTransaction,
  executeAnimalEventTransaction
} from '../services/transactionService';
import { FishBatch, CropCycle, Animal, CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runProductionCostPaymentValidationTest() {
  console.log('====================================================');
  console.log('STARTING PRODUCTION COST PAYMENT VALIDATION TEST');
  console.log('====================================================\n');

  // 1. Clean and Seed Accounts
  await db.accounts.clear();
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  await db.journalEntries.clear();
  await db.cashBankAccounts.clear();
  await db.inventoryItems.clear();
  await db.stockMovements.clear();
  await db.auditLogs.clear();
  await db.fishBatches.clear();
  await db.cropCycles.clear();
  await db.animals.clear();
  await db.animalEvents.clear();

  // 2. Seed Cash and Bank Accounts with tight balances
  const cashAccount: CashBankAccount = {
    id: 'cba-cash-test',
    name: 'Cash Box',
    accountName: 'Cash Box',
    accountType: 'CASH',
    accountNumber: 'CASH-01',
    currentBalance: 1000, // Only 1000 available
    isActive: true
  };
  await db.cashBankAccounts.add(cashAccount);

  const bankAccount: CashBankAccount = {
    id: 'cba-bank-test',
    name: 'City Bank',
    accountName: 'City Bank A/C',
    accountType: 'BANK',
    accountNumber: 'BANK-01',
    bankName: 'City Bank',
    currentBalance: 2000, // Only 2000 available
    isActive: true
  };
  await db.cashBankAccounts.add(bankAccount);

  // 3. Seed Fish Batch
  const fishBatch: FishBatch = {
    id: 'FISH-TEST-01',
    pondId: 'pond-01',
    pondName: 'North Pond',
    species: 'Tilapia',
    stockingDate: '2026-03-01',
    fingerlingCost: 10000,
    fingerlingQty: 1000,
    mortalityCount: 0,
    currentEstimatedWeightKg: 50,
    status: 'ACTIVE',
    totalFeedCost: 0,
    totalFeedKg: 0,
    medicineCost: 0,
    labourCost: 0,
    electricityCost: 0,
    otherCost: 0,
    totalCost: 10000
  };
  await db.fishBatches.add(fishBatch);

  // 4. Seed Crop Cycle
  const cropCycle: CropCycle = {
    id: 'CROP-TEST-01',
    plotId: 'plot-01',
    plotName: 'Field 1',
    cropName: 'Paddy',
    cropCategory: 'GRAIN',
    areaDecimals: 50,
    plantingDate: '2026-03-01',
    expectedHarvestDate: '2026-06-30',
    status: 'GROWING',
    seedCost: 5000,
    fertilizerCost: 0,
    irrigationCost: 0,
    labourCost: 0,
    protectionCost: 0,
    machineryCost: 0,
    otherCost: 0,
    totalCost: 5000,
    harvestYieldKg: 0,
    harvestRevenue: 0,
    internalConsumptionKg: 0
  };
  await db.cropCycles.add(cropCycle);

  // 5. Seed Animal
  const animal: Animal = {
    id: 'COW-TEST-01',
    tag: 'TAG-001',
    species: 'CATTLE',
    breed: 'Holstein',
    gender: 'FEMALE',
    birthDate: '2024-01-01',
    currentWeightKg: 300,
    location: 'Shed 1',
    status: 'ACTIVE',
    purchaseDate: '2025-01-01',
    purchaseCost: 50000,
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    totalCost: 50000
  };
  await db.animals.add(animal);

  console.log('--- TEST 1: Reject Insufficient CASH in Fish Production Cost ---');
  const journalCountBefore1 = await db.journalEntries.count();
  let caught1 = false;
  try {
    // Attempt to spend 1500 from cash (balance is 1000)
    await executeFishProductionCostTransaction({
      batchId: fishBatch.id,
      costType: 'LABOUR',
      amount: 1500,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      notes: 'Labour cost exceeding cash',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught1 = true;
    console.log('Correctly caught insufficient cash:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught1, 'Should throw for insufficient cash');

  // Verify no partial journal, no cash change, no fish batch change
  const journalCountAfter1 = await db.journalEntries.count();
  assert(journalCountBefore1 === journalCountAfter1, 'No journal entry should be created on rejection');
  const cashAcc1 = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAcc1?.currentBalance === 1000, 'Cash balance must not change on rejection');
  const freshFish1 = await db.fishBatches.get(fishBatch.id);
  assert(freshFish1?.totalCost === 10000 && freshFish1?.labourCost === 0, 'Fish batch must not be updated on rejection');
  console.log('[PASS] Test 1: Fish cost insufficient CASH rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 2: Reject Insufficient BANK in Fish Production Cost ---');
  const journalCountBefore2 = await db.journalEntries.count();
  let caught2 = false;
  try {
    // Attempt to spend 2500 from bank (balance is 2000)
    await executeFishProductionCostTransaction({
      batchId: fishBatch.id,
      costType: 'ELECTRICITY',
      amount: 2500,
      paymentMethod: 'BANK',
      bankAccountId: 'cba-bank-test',
      date: '2026-03-10',
      notes: 'Electricity cost exceeding bank',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught2 = true;
    console.log('Correctly caught insufficient bank:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught2, 'Should throw for insufficient bank');

  const journalCountAfter2 = await db.journalEntries.count();
  assert(journalCountBefore2 === journalCountAfter2, 'No journal entry should be created on rejection');
  const bankAcc2 = await db.cashBankAccounts.get('cba-bank-test');
  assert(bankAcc2?.currentBalance === 2000, 'Bank balance must not change on rejection');
  const freshFish2 = await db.fishBatches.get(fishBatch.id);
  assert(freshFish2?.totalCost === 10000 && freshFish2?.electricityCost === 0, 'Fish batch must not be updated on rejection');
  console.log('[PASS] Test 2: Fish cost insufficient BANK rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 3: Reject Insufficient CASH in Crop Production Cost ---');
  const journalCountBefore3 = await db.journalEntries.count();
  let caught3 = false;
  try {
    // Attempt to spend 1200 from cash (balance is 1000)
    await executeCropProductionCostTransaction({
      cycleId: cropCycle.id,
      costType: 'LABOUR',
      amount: 1200,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      notes: 'Crop labour cost exceeding cash',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught3 = true;
    console.log('Correctly caught insufficient cash:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught3, 'Should throw for insufficient cash');

  const journalCountAfter3 = await db.journalEntries.count();
  assert(journalCountBefore3 === journalCountAfter3, 'No journal entry created');
  const cashAcc3 = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAcc3?.currentBalance === 1000, 'Cash balance must not change');
  const freshCrop3 = await db.cropCycles.get(cropCycle.id);
  assert(freshCrop3?.totalCost === 5000 && freshCrop3?.labourCost === 0, 'Crop cycle must not be updated');
  console.log('[PASS] Test 3: Crop cost insufficient CASH rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 4: Reject Insufficient BANK in Crop Production Cost ---');
  const journalCountBefore4 = await db.journalEntries.count();
  let caught4 = false;
  try {
    // Attempt to spend 2100 from bank (balance is 2000)
    await executeCropProductionCostTransaction({
      cycleId: cropCycle.id,
      costType: 'IRRIGATION',
      amount: 2100,
      paymentMethod: 'BANK',
      bankAccountId: 'cba-bank-test',
      date: '2026-03-10',
      notes: 'Irrigation cost exceeding bank',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught4 = true;
    console.log('Correctly caught insufficient bank:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught4, 'Should throw for insufficient bank');

  const journalCountAfter4 = await db.journalEntries.count();
  assert(journalCountBefore4 === journalCountAfter4, 'No journal entry created');
  const bankAcc4 = await db.cashBankAccounts.get('cba-bank-test');
  assert(bankAcc4?.currentBalance === 2000, 'Bank balance must not change');
  const freshCrop4 = await db.cropCycles.get(cropCycle.id);
  assert(freshCrop4?.totalCost === 5000 && freshCrop4?.irrigationCost === 0, 'Crop cycle must not be updated');
  console.log('[PASS] Test 4: Crop cost insufficient BANK rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 5: Reject Insufficient CASH in Livestock Production Cost ---');
  const journalCountBefore5 = await db.journalEntries.count();
  let caught5 = false;
  try {
    // Attempt to spend 1001 from cash (balance is 1000)
    await executeLivestockProductionCostTransaction({
      animalId: animal.id,
      costType: 'FEED',
      amount: 1001,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      notes: 'Feed cost exceeding cash',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught5 = true;
    console.log('Correctly caught insufficient cash:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught5, 'Should throw for insufficient cash');

  const journalCountAfter5 = await db.journalEntries.count();
  assert(journalCountBefore5 === journalCountAfter5, 'No journal entry created');
  const cashAcc5 = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAcc5?.currentBalance === 1000, 'Cash balance must not change');
  const freshAnimal5 = await db.animals.get(animal.id);
  assert(freshAnimal5?.totalCost === 50000 && freshAnimal5?.accumulatedFeedCost === 0, 'Animal must not be updated');
  console.log('[PASS] Test 5: Livestock cost insufficient CASH rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 6: Reject Insufficient BANK in Livestock Production Cost ---');
  const journalCountBefore6 = await db.journalEntries.count();
  let caught6 = false;
  try {
    // Attempt to spend 2001 from bank (balance is 2000)
    await executeLivestockProductionCostTransaction({
      animalId: animal.id,
      costType: 'MEDICINE',
      amount: 2001,
      paymentMethod: 'BANK',
      bankAccountId: 'cba-bank-test',
      date: '2026-03-10',
      notes: 'Medicine cost exceeding bank',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught6 = true;
    console.log('Correctly caught insufficient bank:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected insufficient funds error');
  }
  assert(caught6, 'Should throw for insufficient bank');

  const journalCountAfter6 = await db.journalEntries.count();
  assert(journalCountBefore6 === journalCountAfter6, 'No journal entry created');
  const bankAcc6 = await db.cashBankAccounts.get('cba-bank-test');
  assert(bankAcc6?.currentBalance === 2000, 'Bank balance must not change');
  const freshAnimal6 = await db.animals.get(animal.id);
  assert(freshAnimal6?.totalCost === 50000 && freshAnimal6?.accumulatedMedCost === 0, 'Animal must not be updated');
  console.log('[PASS] Test 6: Livestock cost insufficient BANK rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 7: Reject Insufficient CASH in Animal Event Transaction ---');
  const journalCountBefore7 = await db.journalEntries.count();
  let caught7 = false;
  try {
    await executeAnimalEventTransaction({
      animal,
      event: {
        animalId: animal.id,
        eventType: 'TREATMENT',
        date: '2026-03-10',
        cost: 3000, // Exceeds cash 1000
        details: 'Event cost exceeding cash'
      },
      paymentMethod: 'CASH',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caught7 = true;
    console.log('Correctly caught insufficient cash in animal event:', err.message);
    assert(err.message.includes('পর্যাপ্ত ব্যালেন্স নেই') || err.message.includes('নেগেটিভ'), 'Expected error');
  }
  assert(caught7, 'Should throw for insufficient cash in animal event');
  const journalCountAfter7 = await db.journalEntries.count();
  assert(journalCountBefore7 === journalCountAfter7, 'No journal entry created');
  console.log('[PASS] Test 7: Animal event insufficient CASH rejected cleanly with 0 partial updates.\n');

  console.log('--- TEST 8: Successful Production Cost Payment within Available Balance ---');
  // Spend 400 from cash (balance is 1000 -> remaining 600)
  const resFish = await executeFishProductionCostTransaction({
    batchId: fishBatch.id,
    costType: 'MEDICINE',
    amount: 400,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    notes: 'Valid medicine payment',
    currentUserId: 'test-user'
  });
  assert(!!resFish.journalEntryId, 'Journal entry should be created on success');
  const cashAcc8 = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAcc8?.currentBalance === 600, 'Cash balance should be exactly 600');

  // Spend 500 from bank (balance is 2000 -> remaining 1500)
  const resCrop = await executeCropProductionCostTransaction({
    cycleId: cropCycle.id,
    costType: 'IRRIGATION',
    amount: 500,
    paymentMethod: 'BANK',
    bankAccountId: 'cba-bank-test',
    date: '2026-03-10',
    notes: 'Valid irrigation payment',
    currentUserId: 'test-user'
  });
  assert(!!resCrop.journalEntryId, 'Journal entry should be created on success');
  const bankAcc8 = await db.cashBankAccounts.get('cba-bank-test');
  assert(bankAcc8?.currentBalance === 1500, 'Bank balance should be exactly 1500');

  // Spend exact remaining cash (600 -> remaining 0, valid non-negative)
  const resLive = await executeLivestockProductionCostTransaction({
    animalId: animal.id,
    costType: 'FEED',
    amount: 600,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    notes: 'Valid exact remaining balance payment',
    currentUserId: 'test-user'
  });
  assert(!!resLive.journalEntryId, 'Journal entry should be created on success');
  const cashAccFinal = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAccFinal?.currentBalance === 0, 'Cash balance should be exactly 0 (non-negative)');

  // Now spending even 1 from cash must fail because balance is 0
  let caughtFinal = false;
  try {
    await executeLivestockProductionCostTransaction({
      animalId: animal.id,
      costType: 'FEED',
      amount: 1,
      paymentMethod: 'CASH',
      date: '2026-03-10',
      notes: 'Overdraft attempt on zero balance',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    caughtFinal = true;
    console.log('Correctly rejected overdraft when balance is 0:', err.message);
  }
  assert(caughtFinal, 'Must reject overdraft when balance is 0');
  const cashAccAfterOverdraft = await db.cashBankAccounts.get('cba-cash-test');
  assert(cashAccAfterOverdraft?.currentBalance === 0, 'Cash balance must still be 0 (no negative cash allowed)');

  console.log('\n====================================================');
  console.log('ALL PRODUCTION COST PAYMENT VALIDATION TESTS PASSED!');
  console.log('====================================================');
  return { success: true };
}

runProductionCostPaymentValidationTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });

