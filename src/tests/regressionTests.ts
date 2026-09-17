import { db } from '../db/indexedDb';
import {
  generateBalanceSheet,
  generateTrialBalance,
  migrateLegacyAccounts,
  postJournalEntry,
  validateBalancedLines
} from '../accounting/accountingEngine';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeAnimalEventTransaction,
  executeAnimalSaleOrRemovalTransaction,
  executeContraTransferTransaction,
  executeInvestorTransaction,
  executeLoanTransaction,
  executePurchaseTransaction,
  executeSaleTransaction
} from '../services/transactionService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { Animal, InventoryItem, JournalLine, Party } from '../types';

export interface TestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runRegressionTests(): Promise<TestResult> {
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
    const testUserId = 'test_regression_runner';

    // Ensure legacy accounts are migrated and all canonical accounts are present
    await migrateLegacyAccounts();
    const existingAccounts = await db.accounts.toArray();
    if (existingAccounts.length === 0) {
      await db.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS);
    } else {
      for (const defAcc of DEFAULT_CHART_OF_ACCOUNTS) {
        if (!existingAccounts.some((a) => a.code === defAcc.code)) {
          await db.accounts.put(defAcc);
        }
      }
    }
    const accounts = await db.accounts.toArray();

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
    } catch (err: any) {
      blockedUnbalanced = true;
    }
    assert(blockedUnbalanced, 'Unbalanced journal lines (debit != credit) MUST be rejected.');

    // ----------------------------------------------------
    // TEST 3: Feed Purchase maps to 1051 (NEVER 1050)
    // ----------------------------------------------------
    let feedItem = await db.inventoryItems.where('category').equals('FEED').first();
    if (!feedItem) {
      feedItem = {
        id: generateUniqueId('item'),
        code: 'FEED-TEST',
        nameBn: 'পরীক্ষামূলক ফিড',
        nameEn: 'Test Feed',
        category: 'FEED',
        unit: 'কেজি',
        currentStock: 100,
        reorderLevel: 10,
        avgCostPrice: 50,
        sellingPrice: 70
      };
      await safeInsert(db.inventoryItems, feedItem);
    }

    let supplier = await db.parties.where('type').equals('SUPPLIER').first();
    if (!supplier) {
      supplier = {
        id: generateUniqueId('sup'),
        name: 'পরীক্ষামূলক ফিড মিল',
        phone: '01700000001',
        type: 'SUPPLIER',
        balance: 0
      };
      await safeInsert(db.parties, supplier);
    }

    // Ensure cash account exists and has sufficient balance for test cash purchase
    let cashForPur = await db.cashBankAccounts.where('accountType').equals('CASH').first();
    if (!cashForPur) {
      cashForPur = {
        id: generateUniqueId('csh'),
        name: 'প্রধান নগদ তহবিল (Main Cash Drawer)',
        accountType: 'CASH',
        currentBalance: 50000
      };
      await safeInsert(db.cashBankAccounts, cashForPur);
    } else if (cashForPur.currentBalance < 1000) {
      const topUp = Math.max(cashForPur.currentBalance, 0) + 50000;
      await db.cashBankAccounts.update(cashForPur.id, { currentBalance: topUp });
    }

    const purchaseRes = await executePurchaseTransaction({
      supplier,
      item: feedItem,
      quantity: 10,
      unitPrice: 60,
      transportCost: 50,
      paymentMethod: 'CASH',
      currentUserId: testUserId
    });

    const purJournal = await db.journalEntries.get(purchaseRes.journalEntryId);
    assert(!!purJournal, 'Purchase journal entry must be saved in database.');
    const feedLine = purJournal?.lines.find((l) => l.accountCode === '1051');
    assert(!!feedLine && feedLine.debit === 650, 'Feed purchase must debit 1051 Feed Inventory including transport cost.');
    const forbidden1050Line = purJournal?.lines.find((l) => l.accountCode === '1050');
    assert(!forbidden1050Line, 'Feed purchase must NEVER debit deprecated account 1050.');

    // ----------------------------------------------------
    // TEST 4: Credit Sale maps to 1040 Accounts Receivable
    // ----------------------------------------------------
    let customer = await db.parties.where('type').equals('CUSTOMER').first();
    if (!customer) {
      customer = {
        id: generateUniqueId('cust'),
        name: 'পরীক্ষামূলক খদ্দের',
        phone: '01800000002',
        type: 'CUSTOMER',
        balance: 0
      };
      await safeInsert(db.parties, customer);
    }

    // Refresh feed item stock before selling
    const freshFeed = (await db.inventoryItems.get(feedItem.id)) || feedItem;

    const creditSaleRes = await executeSaleTransaction({
      customer,
      item: freshFeed,
      quantity: 5,
      unitPrice: 80,
      paymentMethod: 'CREDIT',
      currentUserId: testUserId
    });

    const creditSaleJournal = await db.journalEntries.get(creditSaleRes.journalEntryId);
    assert(!!creditSaleJournal, 'Credit sale journal entry must be created.');
    const arLine = creditSaleJournal?.lines.find((l) => l.accountCode === '1040');
    assert(!!arLine && arLine.debit === 400, 'Credit sale must debit 1040 Accounts Receivable.');

    // ----------------------------------------------------
    // TEST 5: Bank Sale maps to 1030 Bank Accounts
    // ----------------------------------------------------
    let bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
    if (!bankAcc) {
      bankAcc = {
        id: generateUniqueId('bnk'),
        name: 'পরীক্ষামূলক ব্যাংক হিসাব',
        accountType: 'BANK',
        currentBalance: 50000
      };
      await safeInsert(db.cashBankAccounts, bankAcc);
    }

    const freshFeedForBank = (await db.inventoryItems.get(feedItem.id)) || feedItem;

    const bankSaleRes = await executeSaleTransaction({
      customer,
      item: freshFeedForBank,
      quantity: 2,
      unitPrice: 80,
      paymentMethod: 'BANK',
      bankAccountId: bankAcc.id,
      currentUserId: testUserId
    });

    const bankSaleJournal = await db.journalEntries.get(bankSaleRes.journalEntryId);
    const bankLine = bankSaleJournal?.lines.find((l) => l.accountCode === '1030');
    assert(!!bankLine && bankLine.debit === 160, 'Bank sale must debit 1030 Bank Accounts.');

    // ----------------------------------------------------
    // TEST 6: Loan Receipt maps to 2110 or 2120
    // ----------------------------------------------------
    const loanRes = await executeLoanTransaction({
      lenderName: 'অগ্রণী ব্যাংক কৃষি ঋণ',
      principal: 100000,
      interestRate: 8,
      tenureMonths: 12,
      targetAccountId: bankAcc.id,
      currentUserId: testUserId
    });

    const loanJournal = await db.journalEntries.get(loanRes.journalEntryId);
    const loanLiabilityLine = loanJournal?.lines.find((l) => l.accountCode === '2110' || l.accountCode === '2120');
    assert(!!loanLiabilityLine && loanLiabilityLine.credit === 100000, 'Loan transaction must credit 2110/2120 Loan Payable.');

    // ----------------------------------------------------
    // TEST 7: Investor Contribution maps to 3020 (NEVER 3010)
    // ----------------------------------------------------
    const investorRes = await executeInvestorTransaction({
      investorName: 'আনিসুর রহমান',
      contribution: 250000,
      profitShare: 25,
      targetAccountId: bankAcc.id,
      currentUserId: testUserId
    });

    const investorJournal = await db.journalEntries.get(investorRes.journalEntryId);
    const investorEquityLine = investorJournal?.lines.find((l) => l.accountCode === '3020');
    assert(!!investorEquityLine && investorEquityLine.credit === 250000, 'Investor capital must credit 3020 Investor Capital.');
    const forbiddenOwnerLine = investorJournal?.lines.find((l) => l.accountCode === '3010');
    assert(!forbiddenOwnerLine, 'Investor capital must NEVER be posted to 3010 Owner Capital.');

    // ----------------------------------------------------
    // TEST 8: Safe Insert & Unique ID Collision Resistance
    // ----------------------------------------------------
    const uniqueId1 = generateUniqueId('test');
    const uniqueId2 = generateUniqueId('test');
    assert(uniqueId1 !== uniqueId2, 'Generated unique IDs must never collide.');
    assert(uniqueId1.startsWith('test_'), 'Generated ID prefix must be respected.');

    // Test collision resistance with safeInsert
    const existingEntry = await db.journalEntries.limit(1).first();
    if (existingEntry) {
      const duplicateAttempt = { ...existingEntry };
      const inserted = await safeInsert(db.journalEntries, duplicateAttempt, { idPrefix: 'j' });
      assert(inserted.id !== existingEntry.id, 'safeInsert must auto-resolve ID collision by assigning a fresh ID.');
      await db.journalEntries.delete(inserted.id);
    }

    // ----------------------------------------------------
    // TEST 9: Contra Transfer (Cash to Bank / Bank to Cash)
    // ----------------------------------------------------
    let cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
    if (!cashAcc) {
      cashAcc = {
        id: generateUniqueId('csh'),
        name: 'নগদ ক্যাশ বাক্স',
        accountType: 'CASH',
        currentBalance: 50000
      };
      await safeInsert(db.cashBankAccounts, cashAcc);
    } else if (cashAcc.currentBalance < 10000) {
      const topUp = Math.max(cashAcc.currentBalance, 0) + 50000;
      await db.cashBankAccounts.update(cashAcc.id, { currentBalance: topUp });
      cashAcc.currentBalance = topUp;
    }

    const contraRes = await executeContraTransferTransaction({
      fromAccountId: cashAcc.id,
      toAccountId: bankAcc.id,
      amount: 5000,
      narration: 'নগদ উদ্বৃত্ত ব্যাংকে জমা',
      currentUserId: testUserId
    });

    const contraJournal = await db.journalEntries.get(contraRes.journalEntryId);
    const crCash = contraJournal?.lines.find((l) => l.accountCode === '1010' && l.credit === 5000);
    const drBank = contraJournal?.lines.find((l) => l.accountCode === '1030' && l.debit === 5000);
    assert(!!crCash && !!drBank, 'Contra transfer must debit 1030 Bank and credit 1010 Cash.');

    // ----------------------------------------------------
    // TEST 10: Balance Sheet Contra Account Calculations
    // ----------------------------------------------------
    const drawingsVoucher = generateTransactionNumber('DRW');
    await postJournalEntry({
      id: generateUniqueId('j_draw'),
      voucherNumber: drawingsVoucher,
      voucherType: 'PAYMENT',
      date: new Date().toISOString().split('T')[0],
      narration: 'মালিক কর্তৃক ব্যক্তিগত প্রয়োজনে নগদ উত্তোলন (Contra-Equity)',
      lines: [
        { accountId: '3040', accountCode: '3040', accountName: 'মালিকের ব্যক্তিগত উত্তোলন (Owner Drawings)', debit: 2000, credit: 0 },
        { accountId: '1010', accountCode: '1010', accountName: 'নগদ টাকা (Cash on Hand)', debit: 0, credit: 2000 }
      ],
      createdBy: testUserId,
      createdAt: new Date().toISOString()
    });

    const bs = await generateBalanceSheet();
    const drawingsRow = bs.equity.find((e) => e.code === '3040');
    assert(!!drawingsRow && drawingsRow.isContra === true, '3040 Owner Drawings must be marked as contra-account in Balance Sheet.');
    assert(bs.isBalanced, 'Balance Sheet must remain mathematically balanced after transactions.');

    // ----------------------------------------------------
    // TEST 11: Trial Balance Audit & Imbalance Detection
    // ----------------------------------------------------
    const tb = await generateTrialBalance();
    assert(tb.isBalanced, 'Trial Balance must be balanced with total debits equal to total credits.');
    assert(tb.difference === 0, 'Trial Balance discrepancy must be strictly 0.00.');

    // ----------------------------------------------------
    // TEST 12: Animal Event Transaction & Running Total Updates
    // ----------------------------------------------------
    const testCowId = generateTransactionNumber('COW_TEST');
    const testCow: Animal = {
      id: testCowId,
      tag: testCowId,
      species: 'CATTLE',
      breed: 'শাহিওয়াল ক্রস',
      gender: 'FEMALE',
      birthDate: '2023-01-01',
      purchaseDate: '2023-05-01',
      purchaseCost: 50000,
      currentWeightKg: 220,
      accumulatedFeedCost: 1000,
      accumulatedMedCost: 500,
      accumulatedLabourCost: 200,
      otherCosts: 0,
      totalCost: 51700,
      status: 'ACTIVE',
      location: 'শেড ১',
      synced: false
    };
    await db.animals.put(testCow);

    // Feed event with cost
    await executeAnimalEventTransaction({
      animal: testCow,
      event: {
        animalId: testCow.id,
        eventType: 'FEED',
        date: new Date().toISOString().split('T')[0],
        cost: 650,
        details: 'সাইলেজ ও ভুসি'
      },
      paymentMethod: 'CASH',
      currentUserId: testUserId
    });

    const updatedCowAfterFeed = await db.animals.get(testCow.id);
    assert(
      !!updatedCowAfterFeed && updatedCowAfterFeed.accumulatedFeedCost === 1650,
      'Animal accumulatedFeedCost must correctly increment after FEED event.'
    );
    assert(
      !!updatedCowAfterFeed && updatedCowAfterFeed.totalCost === 52350,
      'Animal totalCost must correctly reflect feed cost increment.'
    );

    // Vaccine event with vaccineName and nextDueDate
    await executeAnimalEventTransaction({
      animal: updatedCowAfterFeed!,
      event: {
        animalId: testCow.id,
        eventType: 'VACCINE',
        date: new Date().toISOString().split('T')[0],
        cost: 350,
        vaccineName: 'FMD ক্ষুরা টিকা',
        nextDueDate: '2025-06-01',
        details: 'রুটিন টিকাদান'
      },
      paymentMethod: 'CASH',
      currentUserId: testUserId
    });

    const updatedCowAfterVaccine = await db.animals.get(testCow.id);
    assert(
      !!updatedCowAfterVaccine && updatedCowAfterVaccine.accumulatedMedCost === 850,
      'Animal accumulatedMedCost must correctly increment after VACCINE event.'
    );
    assert(
      !!updatedCowAfterVaccine && updatedCowAfterVaccine.totalCost === 52700,
      'Animal totalCost must correctly reflect vaccine cost increment.'
    );

    // Weight event without cost
    await executeAnimalEventTransaction({
      animal: updatedCowAfterVaccine!,
      event: {
        animalId: testCow.id,
        eventType: 'WEIGHT',
        date: new Date().toISOString().split('T')[0],
        cost: 0,
        weightKg: 245,
        details: 'মাসিক ওজন বৃদ্ধি পরিমাপ'
      },
      paymentMethod: 'CASH',
      currentUserId: testUserId
    });
    const updatedCowAfterWeight = await db.animals.get(testCow.id);
    assert(
      !!updatedCowAfterWeight && updatedCowAfterWeight.currentWeightKg === 245,
      'Animal currentWeightKg must be updated upon WEIGHT event recording.'
    );

    // ----------------------------------------------------
    // TEST 13: Animal Sale Transaction & Accounting Auto-Posting
    // ----------------------------------------------------
    await executeAnimalSaleOrRemovalTransaction({
      animal: updatedCowAfterWeight!,
      newStatus: 'SOLD',
      date: new Date().toISOString().split('T')[0],
      salePrice: 75000,
      customerName: 'হাটের ব্যাপারী',
      paymentMethod: 'CASH',
      notes: 'কোরবানি হাটে বিক্রয়',
      currentUserId: testUserId
    });

    const soldCow = await db.animals.get(testCow.id);
    assert(!!soldCow && soldCow.status === 'SOLD', 'Animal status must be set to SOLD.');
    assert(!!soldCow && soldCow.salePrice === 75000, 'Animal salePrice must be recorded.');

    const tbAfterSale = await generateTrialBalance();
    assert(
      tbAfterSale.isBalanced,
      'Trial Balance must remain balanced after animal event and sale accounting entries.'
    );

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

  return res;
}
