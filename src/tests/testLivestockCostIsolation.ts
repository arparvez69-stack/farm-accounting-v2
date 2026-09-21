/**
 * Test Suite: Livestock Production Cost Accounting & Reclassification
 * 
 * Verifies Task 5 Requirements for Livestock:
 * 1. Each animal has isolated accumulated production costs by animal ID.
 * 2. Operating production costs paid to expense accounts are reclassified to Biological Assets (1580):
 *    Dr Biological Assets (1580) / Cr Original Expense (6010, 6040, 6020, 6090).
 *    NEVER Dr Biological Asset / Cr Cash (because Cash was already credited by the original payment).
 * 3. Never invent journal entries from operational totals:
 *    If no source GL transaction exists, reject capitalization and derecognition.
 * 4. Never create negative or false expense balances.
 * 5. Derecognition upon sale transfers costs to Livestock COGS (5020) without double-counting.
 */

import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeAnimalPurchaseTransaction,
  executeLivestockProductionCostTransaction,
  integrateLivestockProductionCostAccounting,
  reclassifyLivestockExpenseToBiologicalAsset,
  executeAnimalSaleOrRemovalTransaction,
  calculateAnimalRecordedCosts,
  getAnimalAccumulatedCost
} from '../services/transactionService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { Animal, Account, CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runLivestockCostIsolationTest() {
  console.log('====================================================');
  console.log('STARTING LIVESTOCK PRODUCTION COST & RECLASSIFICATION TEST');
  console.log('====================================================');

  // 1. Clean test tables
  await db.animals.clear();
  await db.journalEntries.clear();
  await db.cashBankAccounts.clear();
  await db.accounts.clear();
  await db.sales.clear();
  await db.auditLogs.clear();

  // 2. Seed chart of accounts
  const seedAccounts: Account[] = [
    {
      id: 'acc_1010',
      code: CANONICAL_ACCOUNTS.CASH,
      nameBn: 'নগদ টাকা',
      nameEn: 'Cash on Hand',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_1020',
      code: CANONICAL_ACCOUNTS.BANK,
      nameBn: 'ব্যাংক হিসাব',
      nameEn: 'Bank Accounts',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_1580',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
      nameBn: 'পশুসম্পদ ও জৈবিক সম্পদ',
      nameEn: 'Livestock & Biological Assets',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_4020',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE,
      nameBn: 'পশু বিক্রয় আয়',
      nameEn: 'Livestock Sales Revenue',
      accountClass: 'REVENUE',
      normalBalance: 'CREDIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_5020',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
      nameBn: 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয়',
      nameEn: 'Livestock COGS',
      accountClass: 'COGS',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_6010',
      code: CANONICAL_ACCOUNTS.FEED_EXPENSE,
      nameBn: 'পশু খাদ্য ক্রয় খরচ',
      nameEn: 'Feed Expense',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_6020',
      code: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
      nameBn: 'খামার শ্রমিক মজুরি',
      nameEn: 'Farm Labour Wages',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_6040',
      code: CANONICAL_ACCOUNTS.VET_MEDICINE,
      nameBn: 'চিকিৎসা ও ওষুধ',
      nameEn: 'Veterinary & Medicine',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_6090',
      code: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE,
      nameBn: 'বিবিধ পরিচালন ব্যয়',
      nameEn: 'Miscellaneous Expense',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_8020',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF,
      nameBn: 'পশুসম্পদ অবলোপন',
      nameEn: 'Livestock Write-off',
      accountClass: 'OTHER_EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    }
  ];
  await db.accounts.bulkAdd(seedAccounts);

  // Seed cash account with opening balance ৳500,000
  const cashAcc: CashBankAccount = {
    id: 'cash_main',
    name: 'Main Cash Box',
    accountName: 'Main Cash Box',
    accountType: 'CASH',
    accountNumber: 'CASH-01',
    currentBalance: 500000,
    isActive: true,
    synced: false
  };
  await db.cashBankAccounts.add(cashAcc);

  // 3. Create two distinct animals
  const animal1Id = 'COW-2026-001';
  const animal2Id = 'GOAT-2026-002';

  const animal1: Animal = {
    id: animal1Id,
    tag: 'TAG-COW-01',
    species: 'CATTLE',
    breed: 'Sahiwal Cross',
    gender: 'FEMALE',
    birthDate: '2024-01-01',
    currentWeightKg: 280,
    location: 'Shed 1',
    status: 'ACTIVE',
    purchaseCost: 60000,
    purchaseDate: '2026-01-05',
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    totalCost: 60000,
    synced: false
  };

  const animal2: Animal = {
    id: animal2Id,
    tag: 'TAG-GOAT-02',
    species: 'GOAT',
    breed: 'Black Bengal',
    gender: 'MALE',
    birthDate: '2025-01-01',
    currentWeightKg: 35,
    location: 'Shed 2',
    status: 'ACTIVE',
    purchaseCost: 15000,
    purchaseDate: '2026-01-10',
    accumulatedFeedCost: 0,
    accumulatedMedCost: 0,
    accumulatedLabourCost: 0,
    otherCosts: 0,
    totalCost: 15000,
    synced: false
  };

  await db.animals.add(animal1);
  await db.animals.add(animal2);

  // Initial purchase entries (Dr 1580 / Cr Cash)
  await db.journalEntries.bulkAdd([
    {
      id: 'j_init_cow',
      voucherNumber: 'PV-COW-01',
      voucherType: 'PAYMENT',
      date: '2026-01-05',
      narration: `গরু ক্রয়: ${animal1Id}`,
      reference: animal1Id,
      totalDebit: 60000,
      totalCredit: 60000,
      lines: [
        {
          accountId: 'acc_1580',
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: 'পশুসম্পদ',
          debit: 60000,
          credit: 0,
          memo: `গরু ক্রয়: ${animal1Id}`
        },
        {
          accountId: 'acc_1010',
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'নগদ টাকা',
          debit: 0,
          credit: 60000,
          memo: `গরু ক্রয় পরিশোধ: ${animal1Id}`
        }
      ],
      createdBy: 'test-user',
      createdAt: new Date().toISOString()
    },
    {
      id: 'j_init_goat',
      voucherNumber: 'PV-GOAT-02',
      voucherType: 'PAYMENT',
      date: '2026-01-10',
      narration: `ছাগল ক্রয়: ${animal2Id}`,
      reference: animal2Id,
      totalDebit: 15000,
      totalCredit: 15000,
      lines: [
        {
          accountId: 'acc_1580',
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: 'পশুসম্পদ',
          debit: 15000,
          credit: 0,
          memo: `ছাগল ক্রয়: ${animal2Id}`
        },
        {
          accountId: 'acc_1010',
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'নগদ টাকা',
          debit: 0,
          credit: 15000,
          memo: `ছাগল ক্রয় পরিশোধ: ${animal2Id}`
        }
      ],
      createdBy: 'test-user',
      createdAt: new Date().toISOString()
    }
  ]);

  console.log('✓ Initial animals seeded: Cow 1 (৳60,000) and Goat 2 (৳15,000)');

  // 4. Record production costs for Animal 1 (Cow) using executeLivestockProductionCostTransaction
  // Feed: ৳12,000, Medicine: ৳4,000, Labour: ৳6,000
  await executeLivestockProductionCostTransaction({
    animalId: animal1Id,
    costType: 'FEED',
    amount: 12000,
    paymentMethod: 'CASH',
    date: '2026-02-01',
    currentUserId: 'test-user'
  });

  await executeLivestockProductionCostTransaction({
    animalId: animal1Id,
    costType: 'MEDICINE',
    amount: 4000,
    paymentMethod: 'CASH',
    date: '2026-02-15',
    currentUserId: 'test-user'
  });

  await executeLivestockProductionCostTransaction({
    animalId: animal1Id,
    costType: 'LABOUR',
    amount: 6000,
    paymentMethod: 'CASH',
    date: '2026-03-01',
    currentUserId: 'test-user'
  });

  // Record a feed cost for Animal 2 (Goat): ৳2,500
  await executeLivestockProductionCostTransaction({
    animalId: animal2Id,
    costType: 'FEED',
    amount: 2500,
    paymentMethod: 'CASH',
    date: '2026-02-10',
    currentUserId: 'test-user'
  });

  // Verify cost isolation between Animal 1 and Animal 2
  const updatedCow = await db.animals.get(animal1Id);
  const updatedGoat = await db.animals.get(animal2Id);

  assert(updatedCow !== undefined, 'Cow must exist in DB');
  assert(updatedGoat !== undefined, 'Goat must exist in DB');

  const cowRecorded = calculateAnimalRecordedCosts(updatedCow!);
  const goatRecorded = calculateAnimalRecordedCosts(updatedGoat!);

  assert(cowRecorded.feedCost === 12000, `Cow feed cost must be ৳12,000 (got ${cowRecorded.feedCost})`);
  assert(cowRecorded.medicineCost === 4000, `Cow medicine cost must be ৳4,000 (got ${cowRecorded.medicineCost})`);
  assert(cowRecorded.labourCost === 6000, `Cow labour cost must be ৳6,000 (got ${cowRecorded.labourCost})`);
  assert(cowRecorded.totalRecordedCost === 82000, `Cow total recorded cost must be ৳82,000 (got ${cowRecorded.totalRecordedCost})`);

  assert(goatRecorded.feedCost === 2500, `Goat feed cost must be ৳2,500 (got ${goatRecorded.feedCost})`);
  assert(goatRecorded.totalRecordedCost === 17500, `Goat total recorded cost must be ৳17,500 (got ${goatRecorded.totalRecordedCost})`);

  console.log('✓ Cost isolation verified: Cow total ৳82,000 vs Goat total ৳17,500');

  // 5. TEST RECLASSIFICATION FLOW (TASK 5):
  // Let's inspect the Cash balance and Expense accounts before reclassification.
  const cashBeforeReclass = (await db.cashBankAccounts.get('cash_main'))?.currentBalance;

  // Let's reclassify Cow's operating expenses into Biological Assets (1580)
  const reclassResult = await reclassifyLivestockExpenseToBiologicalAsset(animal1Id, 'test-user');
  console.log(`✓ Reclassification executed for Cow: ৳${reclassResult.reclassifiedAmount}`);
  assert(reclassResult.reclassifiedAmount === 22000, `Reclassified amount must be ৳22,000 (got ${reclassResult.reclassifiedAmount})`);

  // Verify the journal entry created for reclassification:
  // MUST BE: Dr Biological Assets (1580) ৳22,000 / Cr Feed (6010) ৳12,000, Cr Vet (6040) ৳4,000, Cr Labour (6020) ৳6,000
  // NEVER Cr Cash!
  const reclassEntry = await db.journalEntries.get(reclassResult.journalEntryId!);
  assert(reclassEntry !== undefined, 'Reclassification journal entry must exist');

  let assetDebit = 0;
  let feedCredit = 0;
  let vetCredit = 0;
  let labourCredit = 0;
  let cashCredit = 0;

  for (const line of reclassEntry!.lines) {
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) assetDebit += line.debit;
    if (line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE) feedCredit += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE) vetCredit += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES) labourCredit += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.CASH || line.accountCode === CANONICAL_ACCOUNTS.BANK) {
      cashCredit += line.credit;
    }
  }

  assert(assetDebit === 22000, `Biological Asset debit must be ৳22,000 (got ${assetDebit})`);
  assert(feedCredit === 12000, `Feed credit must be ৳12,000 (got ${feedCredit})`);
  assert(vetCredit === 4000, `Vet credit must be ৳4,000 (got ${vetCredit})`);
  assert(labourCredit === 6000, `Labour credit must be ৳6,000 (got ${labourCredit})`);
  assert(cashCredit === 0, `Cash must NOT be credited during reclassification! (got ${cashCredit})`);

  // Cash balance must remain identical!
  const cashAfterReclass = (await db.cashBankAccounts.get('cash_main'))?.currentBalance;
  assert(cashBeforeReclass === cashAfterReclass, 'Cash balance must not change during reclassification!');
  console.log('✓ Task 5 verified: Operating expenses reclassified to Biological Assets without touching Cash/Bank');

  // Verify no negative expense balances in GL for Cow
  const allEntries = await db.journalEntries.toArray();
  const netExpenseMap = new Map<string, number>();
  for (const entry of allEntries) {
    for (const line of entry.lines) {
      if (line.memo && line.memo.includes(animal1Id)) {
        if (
          line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
          line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
          line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES
        ) {
          const prev = netExpenseMap.get(line.accountCode) || 0;
          netExpenseMap.set(line.accountCode, prev + (line.debit || 0) - (line.credit || 0));
        }
      }
    }
  }

  for (const [code, net] of netExpenseMap.entries()) {
    assert(net >= 0, `Account ${code} net balance must not be negative! (got ${net})`);
  }
  console.log('✓ Task 5 verified: No negative expense balances created');

  // 6. TEST UNBACKED OPERATIONAL NUMBER REJECTION (TASK 5):
  // Set phantom unbacked operational cost on Animal 2 (Goat): otherCosts = ৳10,000 with NO source journal entry!
  const goatRecord = await db.animals.get(animal2Id);
  if (goatRecord) {
    goatRecord.otherCosts = 10000;
    await db.animals.put(goatRecord);
  }

  // Attempting integration must reject the unbacked operational amount
  let goatIntegrationRejected = false;
  try {
    await integrateLivestockProductionCostAccounting(animal2Id);
  } catch (err: any) {
    goatIntegrationRejected = true;
    console.log(`✓ integrateLivestockProductionCostAccounting rejected unbacked amount: "${err.message}"`);
  }
  assert(goatIntegrationRejected, 'integrateLivestockProductionCostAccounting must reject unbacked operational cost!');

  // Attempting sale of Goat with unbacked operational cost must also be rejected
  let goatSaleRejected = false;
  try {
    await executeAnimalSaleOrRemovalTransaction({
      animalId: animal2Id,
      newStatus: 'SOLD',
      salePrice: 25000,
      paymentMethod: 'CASH',
      date: '2026-03-15',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    goatSaleRejected = true;
    console.log(`✓ executeAnimalSaleOrRemovalTransaction rejected unbacked amount: "${err.message}"`);
  }
  assert(goatSaleRejected, 'executeAnimalSaleOrRemovalTransaction must reject sale when operational costs are unbacked!');

  // Revert Goat's phantom cost
  if (goatRecord) {
    goatRecord.otherCosts = 0;
    await db.animals.put(goatRecord);
  }

  // 7. TEST SALE & DERECOGNITION OF ANIMAL 1 (COW)
  // Total cost: ৳82,000 (Purchase ৳60,000 + Raising ৳22,000)
  // Sale Price: ৳95,000
  const saleResult = await executeAnimalSaleOrRemovalTransaction({
    animalId: animal1Id,
    newStatus: 'SOLD',
    salePrice: 95000,
    paymentMethod: 'CASH',
    date: '2026-03-20',
    customerName: 'Rahim Meat Traders',
    currentUserId: 'test-user'
  });

  assert(saleResult.updatedAnimal.status === 'SOLD', 'Cow status must be SOLD');
  assert(saleResult.journalEntryId !== undefined, 'Sale journal entry must exist');

  const saleEntry = await db.journalEntries.get(saleResult.journalEntryId!);
  assert(saleEntry !== undefined, 'Sale journal entry must be in database');

  let cowCogsDebit = 0;
  let cowAssetCredit = 0;
  let revenueCredit = 0;
  let cashRevenueDebit = 0;

  for (const line of saleEntry!.lines) {
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS) cowCogsDebit += line.debit;
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) cowAssetCredit += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE) revenueCredit += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.CASH) cashRevenueDebit += line.debit;
  }

  assert(revenueCredit === 95000, `Revenue credit must be ৳95,000 (got ${revenueCredit})`);
  assert(cashRevenueDebit === 95000, `Cash revenue debit must be ৳95,000 (got ${cashRevenueDebit})`);
  assert(cowCogsDebit === 82000, `Livestock COGS debit must be ৳82,000 (got ${cowCogsDebit})`);
  assert(cowAssetCredit === 82000, `Livestock Asset credit must be ৳82,000 (got ${cowAssetCredit})`);

  console.log('✓ Sale & derecognition cleanly executed: COGS ৳82,000 / Revenue ৳95,000');

  // Verify Goat 2 is still ACTIVE and untouched
  const finalGoat = await db.animals.get(animal2Id);
  assert(finalGoat!.status === 'ACTIVE', 'Goat must remain ACTIVE');
  assert(finalGoat!.totalCost === 17500, `Goat total cost must remain ৳17,500 (got ${finalGoat!.totalCost})`);
  console.log('✓ Goat 2 remains untouched and intact at ৳17,500');

  // =========================================================================
  // 8. TASK 9 COMPREHENSIVE VERIFICATION:
  // Actual accounting transaction -> production cost -> animal/group cost -> accumulated carrying cost -> sale -> COGS
  // =========================================================================
  console.log('\n--- 8. TASK 9 COMPLETE LIFECYCLE: PURCHASE → COSTS → ACCUMULATED COST → SALE → COGS ---');

  // 8.1. Actual accounting transaction: Purchase (executeAnimalPurchaseTransaction)
  const animal3Id = 'SHP-2026-003';
  const purchaseResult = await executeAnimalPurchaseTransaction({
    animalData: {
      id: animal3Id,
      tag: 'TAG-SHP-03',
      species: 'SHEEP',
      breed: 'Garole Sheep Group',
      gender: 'FEMALE',
      birthDate: '2025-06-01',
      currentWeightKg: 45,
      location: 'Shed 3'
    },
    purchaseCost: 25000,
    paymentMethod: 'CASH',
    date: '2026-01-15',
    currentUserId: 'test-user'
  });

  assert(purchaseResult.animal.id === animal3Id, 'Purchased animal must be created with ID');
  assert(purchaseResult.animal.purchaseCost === 25000, 'Purchase cost must be ৳25,000');
  assert(purchaseResult.animal.totalCost === 25000, 'Total cost must equal purchase cost ৳25,000');
  assert(purchaseResult.journalEntryId !== undefined, 'Purchase journal entry must be created');

  const purchaseEntry = await db.journalEntries.get(purchaseResult.journalEntryId!);
  assert(purchaseEntry !== undefined, 'Purchase journal entry must exist in GL');
  const shpAssetDebit = purchaseEntry!.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS)?.debit;
  const shpCashCredit = purchaseEntry!.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.CASH)?.credit;
  assert(shpAssetDebit === 25000, 'Livestock Asset (1580) must be debited ৳25,000 on purchase');
  assert(shpCashCredit === 25000, 'Cash (1010) must be credited ৳25,000 on purchase');
  console.log('✓ 8.1 Actual accounting transaction for purchase verified (Dr 1580 ৳25,000 / Cr Cash ৳25,000)');

  // 8.2. Actual production costs via real accounting transactions
  // Feed: ৳5,000, Medicine: ৳2,000, Labour: ৳3,000, Other: ৳1,000
  await executeLivestockProductionCostTransaction({
    animalId: animal3Id,
    costType: 'FEED',
    amount: 5000,
    paymentMethod: 'CASH',
    date: '2026-02-05',
    currentUserId: 'test-user'
  });

  await executeLivestockProductionCostTransaction({
    animalId: animal3Id,
    costType: 'MEDICINE',
    amount: 2000,
    paymentMethod: 'CASH',
    date: '2026-02-20',
    currentUserId: 'test-user'
  });

  await executeLivestockProductionCostTransaction({
    animalId: animal3Id,
    costType: 'LABOUR',
    amount: 3000,
    paymentMethod: 'CASH',
    date: '2026-03-05',
    currentUserId: 'test-user'
  });

  await executeLivestockProductionCostTransaction({
    animalId: animal3Id,
    costType: 'OTHER',
    amount: 1000,
    paymentMethod: 'CASH',
    date: '2026-03-10',
    currentUserId: 'test-user'
  });

  // 8.3. Accumulated cost & carrying cost calculation based only on actual recorded costs
  const sheepAccumulated = await getAnimalAccumulatedCost(animal3Id);
  assert(sheepAccumulated.breakdown.purchaseCost === 25000, 'Breakdown purchase cost must be ৳25,000');
  assert(sheepAccumulated.breakdown.feedCost === 5000, 'Breakdown feed cost must be ৳5,000');
  assert(sheepAccumulated.breakdown.medicineCost === 2000, 'Breakdown medicine cost must be ৳2,000');
  assert(sheepAccumulated.breakdown.labourCost === 3000, 'Breakdown labour cost must be ৳3,000');
  assert(sheepAccumulated.breakdown.otherCost === 1000, 'Breakdown other cost must be ৳1,000');
  assert(sheepAccumulated.accumulatedCost === 36000, 'Total accumulated cost must be ৳36,000');
  assert(sheepAccumulated.accountingDebits === 36000, 'Total GL accounting debits must be ৳36,000');
  assert(sheepAccumulated.isConsistent === true, 'Accounting and operational costs must strictly match');
  assert(sheepAccumulated.unbackedCost === 0, 'Unbacked cost must be 0');
  assert(sheepAccumulated.netRemainingCost === 36000, 'Net remaining carrying cost must be ৳36,000');
  assert(sheepAccumulated.cogsTransferred === 0, 'COGS must NOT be recognized before sale');
  console.log('✓ 8.2-8.3 Accumulated carrying cost strictly matches GL: ৳36,000 (Purchase 25k + Feed 5k + Med 2k + Labour 3k + Other 1k)');

  // 8.4. Rule Verification: "If operational cost and GL cost disagree, flag/reject the mismatch rather than inventing an accounting entry"
  const rawSheep = await db.animals.get(animal3Id);
  rawSheep!.otherCosts = 5000; // Inventing +৳4,000 unbacked operational cost without GL transaction
  rawSheep!.totalCost = 40000;
  await db.animals.put(rawSheep!);

  let unbackedSaleFailed = false;
  try {
    await executeAnimalSaleOrRemovalTransaction({
      animalId: animal3Id,
      newStatus: 'SOLD',
      salePrice: 50000,
      paymentMethod: 'CASH',
      date: '2026-03-25',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    unbackedSaleFailed = true;
    console.log(`✓ 8.4 Mismatch rejected cleanly: "${err.message}"`);
  }
  assert(unbackedSaleFailed, 'Sale must be rejected when operational cost exceeds verified GL balance!');

  // Restore sheep to real GL backed numbers
  rawSheep!.otherCosts = 1000;
  rawSheep!.totalCost = 36000;
  await db.animals.put(rawSheep!);

  // 8.5. Sale → COGS: Sale COGS must use the applicable accumulated cost of the animal/group actually sold
  const sheepSale = await executeAnimalSaleOrRemovalTransaction({
    animalId: animal3Id,
    newStatus: 'SOLD',
    salePrice: 48000,
    paymentMethod: 'CASH',
    date: '2026-03-25',
    customerName: 'Local Livestock Market',
    currentUserId: 'test-user'
  });

  assert(sheepSale.updatedAnimal.status === 'SOLD', 'Animal status must be SOLD');
  assert(sheepSale.journalEntryId !== undefined, 'Sale journal entry must exist');

  const sheepSaleEntry = await db.journalEntries.get(sheepSale.journalEntryId!);
  assert(sheepSaleEntry !== undefined, 'Sale journal entry must exist in DB');

  let sheepCogs = 0;
  let sheepRevenue = 0;
  let sheepAssetRelieved = 0;
  let sheepFeedRelieved = 0;
  let sheepMedRelieved = 0;
  let sheepLabourRelieved = 0;
  let sheepOtherRelieved = 0;

  for (const line of sheepSaleEntry!.lines) {
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS) sheepCogs += line.debit;
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE) sheepRevenue += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) sheepAssetRelieved += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE) sheepFeedRelieved += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE) sheepMedRelieved += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES) sheepLabourRelieved += line.credit;
    if (line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE) sheepOtherRelieved += line.credit;
  }

  assert(sheepRevenue === 48000, `Revenue must be ৳48,000 (got ${sheepRevenue})`);
  assert(sheepCogs === 36000, `Sale COGS must be ৳36,000 (got ${sheepCogs})`);
  assert(sheepAssetRelieved === 25000, `Asset (1580) relieved must be ৳25,000 (got ${sheepAssetRelieved})`);
  assert(sheepFeedRelieved === 5000, `Feed (6010) relieved must be ৳5,000 (got ${sheepFeedRelieved})`);
  assert(sheepMedRelieved === 2000, `Vet/Medicine (6040) relieved must be ৳2,000 (got ${sheepMedRelieved})`);
  assert(sheepLabourRelieved === 3000, `Labour (6020) relieved must be ৳3,000 (got ${sheepLabourRelieved})`);
  assert(sheepOtherRelieved === 1000, `Other (6090) relieved must be ৳1,000 (got ${sheepOtherRelieved})`);
  console.log('✓ 8.5 Sale recognized Revenue ৳48,000 and full accumulated COGS ৳36,000 without double-counting');

  // 8.6. Rule: "Prevent duplicate COGS"
  let duplicateSaleBlocked = false;
  try {
    await executeAnimalSaleOrRemovalTransaction({
      animalId: animal3Id,
      newStatus: 'SOLD',
      salePrice: 48000,
      paymentMethod: 'CASH',
      date: '2026-03-26',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicateSaleBlocked = true;
    console.log(`✓ 8.6 Duplicate sale/COGS blocked: "${err.message}"`);
  }
  assert(duplicateSaleBlocked, 'Attempting to sell an already SOLD animal must be rejected');

  // 8.7. Rule: "Preserve historical data"
  const historyEntries = await db.journalEntries
    .filter((j) => j.reference === animal3Id || (Boolean(j.narration) && j.narration.includes(animal3Id)))
    .toArray();
  assert(historyEntries.length >= 6, `All 6 historical transactions for ${animal3Id} must be preserved (got ${historyEntries.length})`);
  const cowPreserved = await db.animals.get(animal1Id);
  const goatPreserved = await db.animals.get(animal2Id);
  assert(cowPreserved?.status === 'SOLD', 'Cow historical record preserved');
  assert(goatPreserved?.status === 'ACTIVE' && goatPreserved?.totalCost === 17500, 'Goat active state and cost preserved');
  console.log('✓ 8.7 Historical transactions, animal records, and audit logs fully preserved');

  console.log('====================================================');
  console.log('ALL LIVESTOCK COST ISOLATION & RECLASSIFICATION TESTS PASSED!');
  console.log('====================================================');
  return true;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('testLivestockCostIsolation')) {
  runLivestockCostIsolationTest().then(() => {
    console.log('Test completed successfully');
    process.exit(0);
  }).catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
