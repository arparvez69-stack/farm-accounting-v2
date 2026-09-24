/**
 * Test Suite: Livestock Sales Accounting (CASH, BANK, CREDIT)
 * 
 * Verifies Task 1 Requirements:
 * 1. CASH sale:
 *    - Dr Cash (1010), Cr Livestock Sales Revenue (4020)
 *    - Cost leg: Dr Livestock COGS (5020), Cr Livestock Assets (1580)
 *    - Increases Cash balance
 *    - paidAmount = salePrice, dueAmount = 0, status = 'PAID'
 * 2. BANK sale:
 *    - Dr Bank (1030), Cr Livestock Sales Revenue (4020)
 *    - Cost leg: Dr Livestock COGS (5020), Cr Livestock Assets (1580)
 *    - Increases Bank balance
 *    - paidAmount = salePrice, dueAmount = 0, status = 'PAID'
 * 3. CREDIT sale:
 *    - Dr Accounts Receivable (1040), Cr Livestock Sales Revenue (4020)
 *    - Cost leg: Dr Livestock COGS (5020), Cr Livestock Assets (1580)
 *    - Does NOT increase Cash/Bank balance
 *    - Creates/updates customer AR balance
 *    - paidAmount = 0, dueAmount = salePrice, status = 'DUE'
 *    - journalEntryId linked
 * 4. Later payment:
 *    - Dr Cash/Bank, Cr Accounts Receivable (1040)
 *    - Customer balance decreases
 *    - Sale record becomes 'PAID'
 * 5. Prevent duplicate sale/COGS
 */

import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executeAnimalPurchaseTransaction,
  executeAnimalSaleOrRemovalTransaction,
  executePaymentTransaction
} from '../services/transactionService';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { Account, CashBankAccount, Party } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runLivestockSalesTest() {
  console.log('====================================================');
  console.log('STARTING LIVESTOCK SALES TEST (CASH, BANK, CREDIT)');
  console.log('====================================================');

  // 1. Clean test tables
  await db.animals.clear();
  await db.animalEvents.clear();
  await db.journalEntries.clear();
  await db.cashBankAccounts.clear();
  await db.accounts.clear();
  await db.sales.clear();
  await db.parties.clear();
  await db.auditLogs.clear();

  // 2. Seed chart of accounts
  const seedAccounts: Account[] = [
    {
      id: 'acc_1010',
      code: CANONICAL_ACCOUNTS.CASH,
      nameBn: 'নগদ টাকা (Cash on Hand)',
      nameEn: 'Cash on Hand',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_1030',
      code: CANONICAL_ACCOUNTS.BANK,
      nameBn: 'ব্যাংক হিসাব (Bank Accounts)',
      nameEn: 'Bank Accounts',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_1040',
      code: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
      nameBn: 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
      nameEn: 'Accounts Receivable',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_1580',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
      nameBn: 'জৈব সম্পদ - গবাদিপশু (Biological Assets - Livestock)',
      nameEn: 'Biological Assets - Livestock',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_4020',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE,
      nameBn: 'পশু বিক্রয় আয় (Livestock Sales Revenue)',
      nameEn: 'Livestock Sales Revenue',
      accountClass: 'REVENUE',
      normalBalance: 'CREDIT',
      isSystem: true,
      isActive: true
    },
    {
      id: 'acc_5020',
      code: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
      nameBn: 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয় (Livestock COGS)',
      nameEn: 'Livestock COGS',
      accountClass: 'EXPENSE',
      normalBalance: 'DEBIT',
      isSystem: true,
      isActive: true
    }
  ];
  await db.accounts.bulkPut(seedAccounts);

  // 3. Seed Cash and Bank accounts
  const initialCash: CashBankAccount = {
    id: 'cba_cash',
    name: 'নগদ ক্যাশ (Main Cash)',
    accountName: 'নগদ ক্যাশ (Main Cash)',
    accountType: 'CASH',
    currentBalance: 500000,
    isActive: true,
    synced: false
  };
  const initialBank: CashBankAccount = {
    id: 'cba_bank',
    name: 'ডাচ বাংলা ব্যাংক (DBBL)',
    accountName: 'ডাচ বাংলা ব্যাংক (DBBL)',
    accountType: 'BANK',
    currentBalance: 500000,
    isActive: true,
    synced: false
  };
  await db.cashBankAccounts.bulkPut([initialCash, initialBank]);

  // 4. Seed 3 Animals with authentic purchases backed by GL
  console.log('\n--- 1. SEEDING 3 ANIMALS (COW 1, COW 2, COW 3) VIA PURCHASE ---');
  const cow1Res = await executeAnimalPurchaseTransaction({
    animalData: {
      breed: 'ব্রাহমা ক্রস (Brahma Cross)',
      species: 'CATTLE',
      gender: 'MALE',
      tag: 'COW-2026-001'
    },
    date: '2026-03-01',
    purchaseCost: 60000,
    paymentMethod: 'CASH',
    currentUserId: 'test-user'
  });
  const cow1 = cow1Res.animal;

  const cow2Res = await executeAnimalPurchaseTransaction({
    animalData: {
      breed: 'শাহিওয়াল (Sahiwal)',
      species: 'CATTLE',
      gender: 'FEMALE',
      tag: 'COW-2026-002'
    },
    date: '2026-03-01',
    purchaseCost: 75000,
    paymentMethod: 'CASH',
    currentUserId: 'test-user'
  });
  const cow2 = cow2Res.animal;

  const cow3Res = await executeAnimalPurchaseTransaction({
    animalData: {
      breed: 'হলস্টাইন ফ্রিজিয়ান (Holstein)',
      species: 'CATTLE',
      gender: 'MALE',
      tag: 'COW-2026-003'
    },
    date: '2026-03-01',
    purchaseCost: 90000,
    paymentMethod: 'CASH',
    currentUserId: 'test-user'
  });
  const cow3 = cow3Res.animal;

  console.log(`✓ 3 animals purchased: ${cow1.id} (৳60k), ${cow2.id} (৳75k), ${cow3.id} (৳90k)`);

  // Record cash balances after purchases: 200,000 - 60,000 - 75,000 - 90,000 = -25,000 (negative is fine in unit test, or let's inspect)
  const cashAfterPurchases = (await db.cashBankAccounts.get('cba_cash'))?.currentBalance || 0;
  const bankAfterPurchases = (await db.cashBankAccounts.get('cba_bank'))?.currentBalance || 0;

  // ----------------------------------------------------
  // TEST A: ONE CASH LIVESTOCK SALE
  // ----------------------------------------------------
  console.log('\n--- 2. TEST A: ONE CASH LIVESTOCK SALE ---');
  const cashSalePrice = 85000;
  const saleCashRes = await executeAnimalSaleOrRemovalTransaction({
    animal: cow1,
    newStatus: 'SOLD',
    date: '2026-03-15',
    salePrice: cashSalePrice,
    customerName: 'করিম সাহেব (Cash Customer)',
    paymentMethod: 'CASH',
    currentUserId: 'test-user'
  });

  assert(saleCashRes.updatedAnimal.status === 'SOLD', 'Cow 1 status must be SOLD');
  assert(saleCashRes.updatedAnimal.salePrice === cashSalePrice, 'Cow 1 salePrice must be 85000');
  assert(Boolean(saleCashRes.journalEntryId), 'CASH sale must have journalEntryId');

  // Verify journal entry lines for CASH sale
  const cashJournal = await db.journalEntries.get(saleCashRes.journalEntryId!);
  assert(Boolean(cashJournal), 'CASH sale journal entry must exist in DB');
  console.log('CASH sale journal narration:', cashJournal?.narration);

  const cashLine = cashJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.CASH);
  const revLine = cashJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE);
  const cogsLine = cashJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS);
  const assetLine = cashJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);

  assert(Boolean(cashLine && cashLine.debit === cashSalePrice && cashLine.credit === 0), 'Dr Cash 85,000');
  assert(Boolean(revLine && revLine.credit === cashSalePrice && revLine.debit === 0), 'Cr Livestock Revenue 85,000');
  assert(Boolean(cogsLine && cogsLine.debit === 60000 && cogsLine.credit === 0), 'Dr Livestock COGS 60,000');
  assert(Boolean(assetLine && assetLine.credit === 60000 && assetLine.debit === 0), 'Cr Biological Assets 60,000');

  // Verify journal balances
  const totalDebitCash = cashJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCreditCash = cashJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebitCash === totalCreditCash, `CASH sale journal must balance: Dr ${totalDebitCash} == Cr ${totalCreditCash}`);

  // Verify cash balance increased and bank unchanged
  const cashAfterSale1 = (await db.cashBankAccounts.get('cba_cash'))?.currentBalance || 0;
  const bankAfterSale1 = (await db.cashBankAccounts.get('cba_bank'))?.currentBalance || 0;
  assert(cashAfterSale1 === cashAfterPurchases + cashSalePrice, `Cash balance must increase by ${cashSalePrice}`);
  assert(bankAfterSale1 === bankAfterPurchases, 'Bank balance must remain unchanged during CASH sale');

  // Verify Sale record
  const saleRecordCash = saleCashRes.sale!;
  assert(saleRecordCash.paidAmount === cashSalePrice, 'CASH sale paidAmount == salePrice');
  assert(saleRecordCash.dueAmount === 0, 'CASH sale dueAmount == 0');
  assert(saleRecordCash.status === 'PAID', 'CASH sale status == PAID');
  assert(saleRecordCash.paymentMethod === 'CASH', 'CASH sale paymentMethod == CASH');
  console.log('✓ CASH livestock sale verified cleanly: Dr Cash / Cr Revenue, paidAmount=85000, dueAmount=0, status=PAID');

  // ----------------------------------------------------
  // TEST B: ONE BANK LIVESTOCK SALE
  // ----------------------------------------------------
  console.log('\n--- 3. TEST B: ONE BANK LIVESTOCK SALE ---');
  const bankSalePrice = 110000;
  const saleBankRes = await executeAnimalSaleOrRemovalTransaction({
    animal: cow2,
    newStatus: 'SOLD',
    date: '2026-03-16',
    salePrice: bankSalePrice,
    customerName: 'রহিম ট্রেডার্স (Bank Customer)',
    paymentMethod: 'BANK',
    bankAccountId: 'cba_bank',
    currentUserId: 'test-user'
  });

  assert(saleBankRes.updatedAnimal.status === 'SOLD', 'Cow 2 status must be SOLD');
  assert(Boolean(saleBankRes.journalEntryId), 'BANK sale must have journalEntryId');

  const bankJournal = await db.journalEntries.get(saleBankRes.journalEntryId!);
  assert(Boolean(bankJournal), 'BANK sale journal entry must exist');
  console.log('BANK sale journal narration:', bankJournal?.narration);

  const bankLine = bankJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.BANK);
  const revLineBank = bankJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE);
  const cogsLineBank = bankJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS);
  const assetLineBank = bankJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);

  assert(Boolean(bankLine && bankLine.debit === bankSalePrice && bankLine.credit === 0), 'Dr Bank 110,000');
  assert(Boolean(revLineBank && revLineBank.credit === bankSalePrice && revLineBank.debit === 0), 'Cr Livestock Revenue 110,000');
  assert(Boolean(cogsLineBank && cogsLineBank.debit === 75000 && cogsLineBank.credit === 0), 'Dr Livestock COGS 75,000');
  assert(Boolean(assetLineBank && assetLineBank.credit === 75000 && assetLineBank.debit === 0), 'Cr Biological Assets 75,000');

  const totalDebitBank = bankJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCreditBank = bankJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebitBank === totalCreditBank, `BANK sale journal must balance: Dr ${totalDebitBank} == Cr ${totalCreditBank}`);

  const cashAfterSale2 = (await db.cashBankAccounts.get('cba_cash'))?.currentBalance || 0;
  const bankAfterSale2 = (await db.cashBankAccounts.get('cba_bank'))?.currentBalance || 0;
  assert(cashAfterSale2 === cashAfterSale1, 'Cash balance must remain unchanged during BANK sale');
  assert(bankAfterSale2 === bankAfterPurchases + bankSalePrice, `Bank balance must increase by ${bankSalePrice}`);

  const saleRecordBank = saleBankRes.sale!;
  assert(saleRecordBank.paidAmount === bankSalePrice, 'BANK sale paidAmount == salePrice');
  assert(saleRecordBank.dueAmount === 0, 'BANK sale dueAmount == 0');
  assert(saleRecordBank.status === 'PAID', 'BANK sale status == PAID');
  assert(saleRecordBank.paymentMethod === 'BANK', 'BANK sale paymentMethod == BANK');
  console.log('✓ BANK livestock sale verified cleanly: Dr Bank / Cr Revenue, paidAmount=110000, dueAmount=0, status=PAID');

  // ----------------------------------------------------
  // TEST C: ONE CREDIT LIVESTOCK SALE
  // ----------------------------------------------------
  console.log('\n--- 4. TEST C: ONE CREDIT LIVESTOCK SALE ---');
  // Seed a customer party first to verify party linkage
  const creditCustomer: Party = {
    id: 'pty_cust_haji',
    name: 'হাজী ডেইরি অ্যান্ড মিট (Haji Dairy & Meat)',
    type: 'CUSTOMER',
    balance: 0,
    phone: '01711000000',
    synced: false
  };
  await db.parties.put(creditCustomer);

  const creditSalePrice = 130000;
  const saleCreditRes = await executeAnimalSaleOrRemovalTransaction({
    animal: cow3,
    newStatus: 'SOLD',
    date: '2026-03-17',
    salePrice: creditSalePrice,
    customerId: creditCustomer.id,
    customerName: creditCustomer.name,
    paymentMethod: 'CREDIT',
    currentUserId: 'test-user'
  });

  assert(saleCreditRes.updatedAnimal.status === 'SOLD', 'Cow 3 status must be SOLD');
  assert(Boolean(saleCreditRes.journalEntryId), 'CREDIT sale must have journalEntryId');

  const creditJournal = await db.journalEntries.get(saleCreditRes.journalEntryId!);
  assert(Boolean(creditJournal), 'CREDIT sale journal entry must exist');
  console.log('CREDIT sale journal narration:', creditJournal?.narration);

  // Verify journal lines:
  // Dr Accounts Receivable (1040)
  // Cr Livestock Sales Revenue (4020)
  // Dr Livestock COGS (5020)
  // Cr Livestock Assets (1580)
  const arLine = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE);
  const revLineCredit = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE);
  const cogsLineCredit = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS);
  const assetLineCredit = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);

  assert(Boolean(arLine && arLine.debit === creditSalePrice && arLine.credit === 0), 'Dr Accounts Receivable 130,000');
  assert(Boolean(revLineCredit && revLineCredit.credit === creditSalePrice && revLineCredit.debit === 0), 'Cr Livestock Revenue 130,000');
  assert(Boolean(cogsLineCredit && cogsLineCredit.debit === 90000 && cogsLineCredit.credit === 0), 'Dr Livestock COGS 90,000');
  assert(Boolean(assetLineCredit && assetLineCredit.credit === 90000 && assetLineCredit.debit === 0), 'Cr Biological Assets 90,000');

  // Verify no Cash or Bank lines in CREDIT sale
  const noCashLineInCredit = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.CASH);
  const noBankLineInCredit = creditJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.BANK);
  assert(!noCashLineInCredit, 'CREDIT sale journal must NOT contain Cash account line');
  assert(!noBankLineInCredit, 'CREDIT sale journal must NOT contain Bank account line');

  // Verify journal balances
  const totalDebitCredit = creditJournal!.lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCreditJournal = creditJournal!.lines.reduce((s, l) => s + (l.credit || 0), 0);
  assert(totalDebitCredit === totalCreditJournal, `CREDIT sale journal must balance: Dr ${totalDebitCredit} == Cr ${totalCreditJournal}`);

  // Verify Cash & Bank balances did NOT change!
  const cashAfterSale3 = (await db.cashBankAccounts.get('cba_cash'))?.currentBalance || 0;
  const bankAfterSale3 = (await db.cashBankAccounts.get('cba_bank'))?.currentBalance || 0;
  assert(cashAfterSale3 === cashAfterSale2, 'CREDIT sale must NOT increase Cash balance!');
  assert(bankAfterSale3 === bankAfterSale2, 'CREDIT sale must NOT increase Bank balance!');

  // Verify Customer AR balance
  const updatedCustomer = await db.parties.get(creditCustomer.id);
  assert(updatedCustomer?.balance === creditSalePrice, `Customer AR balance must be updated to ${creditSalePrice} (found: ${updatedCustomer?.balance})`);

  // Verify Sale record fields
  const saleRecordCredit = saleCreditRes.sale!;
  assert(saleRecordCredit.paidAmount === 0, `CREDIT sale paidAmount must be 0 (found: ${saleRecordCredit.paidAmount})`);
  assert(saleRecordCredit.dueAmount === creditSalePrice, `CREDIT sale dueAmount must be ${creditSalePrice} (found: ${saleRecordCredit.dueAmount})`);
  assert(saleRecordCredit.status === 'DUE', `CREDIT sale status must be DUE (found: ${saleRecordCredit.status})`);
  assert(saleRecordCredit.paymentMethod === 'CREDIT', 'CREDIT sale paymentMethod must be CREDIT');
  assert(saleRecordCredit.journalEntryId === creditJournal!.id, 'Sale record must link journalEntryId');
  assert(saleRecordCredit.customerId === creditCustomer.id, 'Sale record customerId matches customer');
  console.log('✓ CREDIT livestock sale verified: Dr AR / Cr Revenue, Cash/Bank unchanged, paidAmount=0, dueAmount=130000, status=DUE');

  // ----------------------------------------------------
  // TEST D: PREVENT DUPLICATE SALE / COGS
  // ----------------------------------------------------
  console.log('\n--- 5. TEST D: PREVENT DUPLICATE SALE / COGS ---');
  let duplicatePrevented = false;
  try {
    await executeAnimalSaleOrRemovalTransaction({
      animal: saleCreditRes.updatedAnimal,
      newStatus: 'SOLD',
      date: '2026-03-18',
      salePrice: 150000,
      paymentMethod: 'CASH',
      currentUserId: 'test-user'
    });
  } catch (err: any) {
    duplicatePrevented = true;
    console.log(`✓ Duplicate sale blocked with message: "${err.message}"`);
  }
  assert(duplicatePrevented, 'Selling already SOLD animal must be rejected');

  // ----------------------------------------------------
  // TEST E: LATER PAYMENT OF CREDIT SALE
  // ----------------------------------------------------
  console.log('\n--- 6. TEST E: LATER PAYMENT OF CREDIT SALE (Dr Cash / Cr AR) ---');
  const paymentAmount = 130000;
  const payRes = await executePaymentTransaction({
    parentType: 'SALE',
    parentId: saleRecordCredit.id,
    amount: paymentAmount,
    paymentMethod: 'CASH',
    date: '2026-03-25',
    note: 'হাজী ডেইরি কর্তৃক গরু ক্রয়ের বকেয়া পরিষদ',
    currentUserId: 'test-user'
  });

  // Verify journal for payment: Dr Cash / Cr AR
  const payJournal = await db.journalEntries.get(payRes.journalEntryId);
  assert(Boolean(payJournal), 'Payment journal entry must exist');
  console.log('Payment journal narration:', payJournal?.narration);

  const payCashLine = payJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.CASH);
  const payArLine = payJournal?.lines.find((l) => l.accountCode === CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE);
  assert(Boolean(payCashLine && payCashLine.debit === paymentAmount), `Payment Dr Cash ${paymentAmount}`);
  assert(Boolean(payArLine && payArLine.credit === paymentAmount), `Payment Cr Accounts Receivable ${paymentAmount}`);

  // Customer balance after full payment should be 0
  const customerAfterPay = await db.parties.get(creditCustomer.id);
  assert(customerAfterPay?.balance === 0, `Customer balance must be 0 after payment (found: ${customerAfterPay?.balance})`);

  // Cash balance should increase by paymentAmount
  const cashAfterPay = (await db.cashBankAccounts.get('cba_cash'))?.currentBalance || 0;
  assert(cashAfterPay === cashAfterSale3 + paymentAmount, `Cash balance must increase by ${paymentAmount}`);

  // Sale record status updated to PAID
  const saleAfterPay = await db.sales.get(saleRecordCredit.id);
  assert(saleAfterPay?.status === 'PAID', `Sale status must be updated to PAID (found: ${saleAfterPay?.status})`);
  assert(saleAfterPay?.dueAmount === 0, `Sale dueAmount must be 0 (found: ${saleAfterPay?.dueAmount})`);
  assert(saleAfterPay?.paidAmount === paymentAmount, `Sale paidAmount must be ${paymentAmount} (found: ${saleAfterPay?.paidAmount})`);
  console.log('✓ Later payment verified: Dr Cash / Cr AR, customer balance=0, sale status=PAID');

  console.log('\n====================================================');
  console.log('ALL LIVESTOCK CASH, BANK & CREDIT SALE TESTS PASSED!');
  console.log('====================================================');
}

// Auto-run if executed directly
runLivestockSalesTest()
  .then(() => {
    console.log('Test completed successfully');
  })
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
