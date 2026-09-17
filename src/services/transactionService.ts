import { db } from '../db/indexedDb';
import {
  CANONICAL_ACCOUNTS,
  getPaymentAccount,
  getCashBankAccountGLCode,
  getInventoryAssetAccount,
  getRevenueAndCogsAccounts,
  getLoanLiabilityAccount,
  getInvestorCapitalAccount
} from '../accounting/accountMapping';
import { postJournalEntry, validateBalancedLines } from '../accounting/accountingEngine';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import {
  InventoryItem,
  Party,
  Sale,
  Purchase,
  Loan,
  Investor,
  CashBankAccount,
  VoucherType,
  JournalLine,
  Animal,
  AnimalEvent,
  AnimalStatus
} from '../types';

/**
 * Atomic Execution of Sales Invoice Transaction
 */
export async function executeSaleTransaction(params: {
  customer: Party;
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  currentUserId: string;
  date?: string;
}): Promise<{ sale: Sale; journalEntryId: string }> {
  return await db.transaction(
    'rw',
    [
      db.journalEntries,
      db.sales,
      db.inventoryItems,
      db.parties,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { customer, item, quantity, unitPrice, paymentMethod, bankAccountId, currentUserId, date } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`বিক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      // Re-fetch fresh item state inside transaction
      const freshItem = await db.inventoryItems.get(item.id);
      if (!freshItem) {
        throw new Error(`Item ${item.id} not found.`);
      }

      if (freshItem.currentStock < quantity) {
        throw new Error(
          `Insufficient stock for "${freshItem.nameBn}". Requested: ${quantity} ${freshItem.unit}, Available: ${freshItem.currentStock} ${freshItem.unit}.`
        );
      }

      const totalAmount = Math.round(quantity * unitPrice * 100) / 100;
      const totalCogs = Math.round(quantity * (freshItem.avgCostPrice || 0) * 100) / 100;

      if (totalAmount <= 0) {
        throw new Error('Sale total amount must be strictly greater than 0.');
      }

      const saleId = generateUniqueId('sal');
      const invoiceNumber = generateTransactionNumber('SAL');

      // Canonical account mappings:
      // Credit sale -> 1040 AR
      // Cash sale -> 1010 Cash
      // Bank sale -> 1030 Bank
      const paymentAccountCode = getPaymentAccount(paymentMethod, 'SALE');
      const { revenueCode, cogsCode } = getRevenueAndCogsAccounts(freshItem);
      const inventoryAssetCode = getInventoryAssetAccount(freshItem.category);

      const accounts = await db.accounts.toArray();
      const journalLines: JournalLine[] = [
        {
          accountId: paymentAccountCode,
          accountCode: paymentAccountCode,
          accountName:
            paymentMethod === 'CASH'
              ? 'নগদ টাকা (Cash on Hand)'
              : paymentMethod === 'BANK'
              ? 'ব্যাংক হিসাব (Bank Accounts)'
              : 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
          debit: totalAmount,
          credit: 0,
          memo: `বিক্রয় চালান ${invoiceNumber}`
        },
        {
          accountId: revenueCode,
          accountCode: revenueCode,
          accountName: 'পণ্য বিক্রয় রাজস্ব (Sales Revenue)',
          debit: 0,
          credit: totalAmount,
          memo: `${freshItem.nameBn} বিক্রয়`
        }
      ];

      // COGS & Inventory Asset movement
      if (totalCogs > 0) {
        journalLines.push(
          {
            accountId: cogsCode,
            accountCode: cogsCode,
            accountName: 'বিক্রিত পণ্যের উৎপাদন ব্যয় (COGS)',
            debit: totalCogs,
            credit: 0,
            memo: 'COGS স্বীকৃতি'
          },
          {
            accountId: inventoryAssetCode,
            accountCode: inventoryAssetCode,
            accountName: 'মজুদ পণ্য (Inventory Asset)',
            debit: 0,
            credit: totalCogs,
            memo: 'মজুদ হ্রাস'
          }
        );
      }

      const voucherNumber = generateTransactionNumber('SLV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_sale'),
          voucherNumber,
          voucherType: 'SALES',
          date: dateStr,
          narration: `বিক্রয় চালান: ${customer.name} কে ${quantity} ${freshItem.unit} ${freshItem.nameBn} বিক্রয়`,
          reference: invoiceNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // 1. Safe insert journal entry
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Safe insert sales invoice
      const saleRecord: Sale = {
        id: saleId,
        invoiceNumber,
        date: dateStr,
        customerId: customer.id,
        customerName: customer.name,
        items: [
          {
            itemId: freshItem.id,
            itemName: freshItem.nameBn,
            quantity,
            unitPrice,
            lineTotal: totalAmount,
            cogsAmount: totalCogs
          }
        ],
        subtotal: totalAmount,
        discount: 0,
        vatTax: 0,
        totalAmount,
        grandTotal: totalAmount,
        paidAmount: paymentMethod === 'CREDIT' ? 0 : totalAmount,
        dueAmount: paymentMethod === 'CREDIT' ? totalAmount : 0,
        paymentMethod,
        bankAccountId,
        journalEntryId: journalEntry.id,
        status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
        synced: false
      };
      await safeInsert(db.sales, saleRecord, { idPrefix: 'sal' });

      // 3. Deduct Inventory Stock
      await db.inventoryItems.update(freshItem.id, {
        currentStock: Math.round((freshItem.currentStock - quantity) * 100) / 100,
        synced: false
      });

      // 4. Update Customer AR balance if credit sale
      if (paymentMethod === 'CREDIT') {
        const freshCustomer = await db.parties.get(customer.id);
        if (freshCustomer) {
          await db.parties.update(customer.id, {
            balance: Math.round(((freshCustomer.balance || 0) + totalAmount) * 100) / 100
          });
        }
      }

      // 5. Update Operational Cash / Bank balance consistently with GL
      if (paymentMethod === 'CASH') {
        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance + totalAmount) * 100) / 100
          });
        }
      } else if (paymentMethod === 'BANK') {
        let bankAcc: CashBankAccount | undefined;
        if (bankAccountId) {
          bankAcc = await db.cashBankAccounts.get(bankAccountId);
        }
        if (!bankAcc) {
          bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
        }
        if (bankAcc) {
          await db.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance + totalAmount) * 100) / 100
          });
        }
      }

      // 6. Record Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'SALE_CREATE',
        module: 'COMMERCE',
        recordId: invoiceNumber,
        status: 'SUCCESS',
        details: `বিক্রয় চালান ${invoiceNumber} সম্পন্ন (৳${totalAmount})`
      });

      return { sale: saleRecord, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Purchase Invoice Transaction
 */
export async function executePurchaseTransaction(params: {
  supplier: Party;
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  transportCost?: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  currentUserId: string;
  date?: string;
}): Promise<{ purchase: Purchase; journalEntryId: string }> {
  return await db.transaction(
    'rw',
    [
      db.journalEntries,
      db.purchases,
      db.inventoryItems,
      db.parties,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { supplier, item, quantity, unitPrice, transportCost = 0, paymentMethod, bankAccountId, currentUserId, date } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`ক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const freshItem = await db.inventoryItems.get(item.id);
      if (!freshItem) {
        throw new Error(`Item ${item.id} not found.`);
      }

      const itemsTotal = Math.round(quantity * unitPrice * 100) / 100;
      const grandTotal = Math.round((itemsTotal + transportCost) * 100) / 100;

      if (grandTotal <= 0) {
        throw new Error('Purchase total amount must be strictly greater than 0.');
      }

      const purchaseId = generateUniqueId('pur');
      const invoiceNumber = generateTransactionNumber('PUR');

      // Canonical account mappings:
      // Feed Purchase -> 1051 Feed Inventory!
      // Other inventory -> 1052, 1053, 1055 (NEVER 1050)
      // Cash -> 1010, Bank -> 1030, Credit -> 2010 AP
      const inventoryAssetCode = getInventoryAssetAccount(freshItem.category);
      const paymentAccountCode = getPaymentAccount(paymentMethod, 'PURCHASE');

      const accounts = await db.accounts.toArray();
      const journalLines: JournalLine[] = [
        {
          accountId: inventoryAssetCode,
          accountCode: inventoryAssetCode,
          accountName:
            freshItem.category === 'FEED'
              ? 'মজুদ খাদ্য (Feed Inventory)'
              : 'মজুদ কাঁচামাল/পণ্য (Inventory Asset)',
          debit: grandTotal,
          credit: 0,
          memo: `ক্রয় চালান ${invoiceNumber} (পরিবহন ব্যয়সহ মূল্যায়ন)`
        },
        {
          accountId: paymentAccountCode,
          accountCode: paymentAccountCode,
          accountName:
            paymentMethod === 'CASH'
              ? 'নগদ টাকা (Cash on Hand)'
              : paymentMethod === 'BANK'
              ? 'ব্যাংক হিসাব (Bank Accounts)'
              : 'সরবরাহকারীর দেনা (Accounts Payable)',
          debit: 0,
          credit: grandTotal,
          memo: `${supplier.name} থেকে ক্রয়`
        }
      ];

      const voucherNumber = generateTransactionNumber('PRV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_pur'),
          voucherNumber,
          voucherType: 'PURCHASE',
          date: dateStr,
          narration: `ক্রয় চালান: ${supplier.name} এর নিকট থেকে ${quantity} ${freshItem.unit} ${freshItem.nameBn} ক্রয়`,
          reference: invoiceNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // 1. Safe insert journal entry
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Safe insert purchase invoice
      const purchaseRecord: Purchase = {
        id: purchaseId,
        invoiceNumber,
        date: dateStr,
        supplierId: supplier.id,
        supplierName: supplier.name,
        items: [
          {
            itemId: freshItem.id,
            itemName: freshItem.nameBn,
            quantity,
            unitPrice,
            lineTotal: itemsTotal
          }
        ],
        subtotal: itemsTotal,
        transportCost,
        grandTotal,
        totalAmount: grandTotal,
        paidAmount: paymentMethod === 'CREDIT' ? 0 : grandTotal,
        dueAmount: paymentMethod === 'CREDIT' ? grandTotal : 0,
        paymentMethod,
        bankAccountId,
        journalEntryId: journalEntry.id,
        status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
        synced: false
      };
      await safeInsert(db.purchases, purchaseRecord, { idPrefix: 'pur' });

      // 3. Update stock and weighted average cost price
      const newStock = Math.round((freshItem.currentStock + quantity) * 100) / 100;
      const prevTotalCost = (freshItem.currentStock || 0) * (freshItem.avgCostPrice || 0);
      const newAvgCost = newStock > 0 ? Math.round(((prevTotalCost + grandTotal) / newStock) * 100) / 100 : unitPrice;

      await db.inventoryItems.update(freshItem.id, {
        currentStock: newStock,
        avgCostPrice: newAvgCost,
        synced: false
      });

      // 4. Update Supplier AP balance if credit purchase
      if (paymentMethod === 'CREDIT') {
        const freshSupplier = await db.parties.get(supplier.id);
        if (freshSupplier) {
          await db.parties.update(supplier.id, {
            balance: Math.round(((freshSupplier.balance || 0) + grandTotal) * 100) / 100
          });
        }
      }

      // 5. Update Operational Cash / Bank balance consistently with GL
      if (paymentMethod === 'CASH') {
        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance - grandTotal) * 100) / 100
          });
        }
      } else if (paymentMethod === 'BANK') {
        let bankAcc: CashBankAccount | undefined;
        if (bankAccountId) {
          bankAcc = await db.cashBankAccounts.get(bankAccountId);
        }
        if (!bankAcc) {
          bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
        }
        if (bankAcc) {
          await db.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance - grandTotal) * 100) / 100
          });
        }
      }

      // 6. Record Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'PURCHASE_CREATE',
        module: 'COMMERCE',
        recordId: invoiceNumber,
        status: 'SUCCESS',
        details: `ক্রয় চালান ${invoiceNumber} সম্পন্ন (৳${grandTotal})`
      });

      return { purchase: purchaseRecord, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Bank / Agricultural Loan Transaction
 */
export async function executeLoanTransaction(params: {
  lenderName: string;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  targetAccountId: string;
  currentUserId: string;
}): Promise<{ loan: Loan; journalEntryId: string }> {
  return await db.transaction(
    'rw',
    [
      db.journalEntries,
      db.loans,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { lenderName, principal, interestRate, tenureMonths, targetAccountId, currentUserId } = params;

      if (principal <= 0) {
        throw new Error('Loan principal must be strictly greater than 0.');
      }

      const targetAcc = await db.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        throw new Error(`Target cash/bank account ${targetAccountId} not found.`);
      }

      const loanId = generateUniqueId('ln');
      const loanRef = generateTransactionNumber('LN');
      const dateStr = new Date().toISOString().split('T')[0];

      // Canonical GL Mapping:
      // Dr Cash (1010) or Bank (1030)
      // Cr 2110 (Short-Term Loan) or 2120 (Long-Term Loan) - NEVER 2020 Accrued Wages!
      const assetGlCode = getCashBankAccountGLCode(targetAcc.accountType);
      const liabilityGlCode = getLoanLiabilityAccount(tenureMonths);

      const accounts = await db.accounts.toArray();
      const journalLines: JournalLine[] = [
        {
          accountId: assetGlCode,
          accountCode: assetGlCode,
          accountName: targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল',
          debit: principal,
          credit: 0,
          memo: 'ঋণের অর্থ প্রাপ্তি'
        },
        {
          accountId: liabilityGlCode,
          accountCode: liabilityGlCode,
          accountName:
            liabilityGlCode === '2110'
              ? 'স্বল্পমেয়াদী ঋণ (Short-Term Loans)'
              : 'দীর্ঘমেয়াদী ঋণ (Long-Term Loans)',
          debit: 0,
          credit: principal,
          memo: `${lenderName} ঋণ অনুমোদন`
        }
      ];

      const voucherNumber = generateTransactionNumber('LNV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_loan'),
          voucherNumber,
          voucherType: 'RECEIPT',
          date: dateStr,
          narration: `ঋণ প্রাপ্তি: ${lenderName} হতে ৳${principal} জমা`,
          reference: loanRef,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // 1. Safe insert journal entry
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Safe insert loan record
      const loanRecord: Loan = {
        id: loanId,
        lenderName: lenderName.trim(),
        loanType: 'BANK',
        principalAmount: principal,
        disbursedDate: dateStr,
        interestRateAnnual: interestRate,
        monthlyInstallment: Math.round((principal / (tenureMonths || 24)) * 100) / 100,
        tenureMonths,
        remainingPrincipal: principal,
        status: 'ACTIVE',
        synced: false
      };
      await safeInsert(db.loans, loanRecord, { idPrefix: 'ln' });

      // 3. Update target account operational balance
      await db.cashBankAccounts.update(targetAcc.id, {
        currentBalance: Math.round((targetAcc.currentBalance + principal) * 100) / 100
      });

      // 4. Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'LOAN_DISBURSE',
        module: 'FINANCE',
        recordId: loanRef,
        status: 'SUCCESS',
        details: `ঋণ ${loanRef} মঞ্জুর ও জমা (৳${principal})`
      });

      return { loan: loanRecord, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Investor Capital Contribution
 */
export async function executeInvestorTransaction(params: {
  investorName: string;
  contribution: number;
  profitShare: number;
  targetAccountId: string;
  currentUserId: string;
}): Promise<{ investor: Investor; journalEntryId: string }> {
  return await db.transaction(
    'rw',
    [
      db.journalEntries,
      db.investors,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { investorName, contribution, profitShare, targetAccountId, currentUserId } = params;

      if (contribution <= 0) {
        throw new Error('Contribution amount must be strictly greater than 0.');
      }

      const targetAcc = await db.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        throw new Error(`Target cash/bank account ${targetAccountId} not found.`);
      }

      const invId = generateUniqueId('inv');
      const invRef = generateTransactionNumber('INV');
      const dateStr = new Date().toISOString().split('T')[0];

      // Canonical GL Mapping:
      // Dr Cash (1010) or Bank (1030)
      // Cr 3020 Investor Capital (NEVER 3010 Owner Capital!)
      const assetGlCode = getCashBankAccountGLCode(targetAcc.accountType);
      const equityGlCode = getInvestorCapitalAccount(); // 3020

      const accounts = await db.accounts.toArray();
      const journalLines: JournalLine[] = [
        {
          accountId: assetGlCode,
          accountCode: assetGlCode,
          accountName: targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল',
          debit: contribution,
          credit: 0,
          memo: 'বিনিয়োগ মূলধন গ্রহণ'
        },
        {
          accountId: equityGlCode,
          accountCode: equityGlCode,
          accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
          debit: 0,
          credit: contribution,
          memo: `${investorName} মূলধন সংযোজন`
        }
      ];

      const voucherNumber = generateTransactionNumber('INV-V');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_invest'),
          voucherNumber,
          voucherType: 'RECEIPT',
          date: dateStr,
          narration: `বিনিয়োগকারীর মূলধন জমা: ${investorName} এর বিনিয়োগ ৳${contribution}`,
          reference: invRef,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // 1. Safe insert journal entry
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Safe insert investor record
      const investorRecord: Investor = {
        id: invId,
        name: investorName.trim(),
        totalContribution: contribution,
        totalWithdrawals: 0,
        currentEquityBalance: contribution,
        profitSharePercentage: profitShare,
        ownershipPercentage: profitShare,
        joinedDate: dateStr,
        status: 'ACTIVE',
        synced: false
      };
      await safeInsert(db.investors, investorRecord, { idPrefix: 'inv' });

      // 3. Update target account operational balance
      await db.cashBankAccounts.update(targetAcc.id, {
        currentBalance: Math.round((targetAcc.currentBalance + contribution) * 100) / 100
      });

      // 4. Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_CONTRIBUTION',
        module: 'FINANCE',
        recordId: invRef,
        status: 'SUCCESS',
        details: `বিনিয়োগকারী ${investorName} এর মূলধন জমা (৳${contribution})`
      });

      return { investor: investorRecord, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Contra Cash/Bank Transfer
 */
export async function executeContraTransferTransaction(params: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  narration?: string;
  currentUserId: string;
}): Promise<{ voucherNumber: string; journalEntryId: string }> {
  return await db.transaction(
    'rw',
    [
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { fromAccountId, toAccountId, amount, narration, currentUserId } = params;

      if (fromAccountId === toAccountId) {
        throw new Error('উৎস ও গন্তব্য হিসাব ভিন্ন হতে হবে (Source and destination accounts must be different).');
      }

      if (amount <= 0) {
        throw new Error('স্থানান্তরের পরিমাণ ০ থেকে বেশি হতে হবে (Transfer amount must be greater than 0).');
      }

      const fromAcc = await db.cashBankAccounts.get(fromAccountId);
      const toAcc = await db.cashBankAccounts.get(toAccountId);

      if (!fromAcc || !toAcc) {
        throw new Error('উৎস বা গন্তব্য হিসাব পাওয়া যায়নি (Account not found).');
      }

      if (fromAcc.currentBalance < amount) {
        throw new Error(
          `পর্যাপ্ত ব্যালেন্স নেই! ${fromAcc.accountName || fromAcc.name} এ বর্তমান স্থিতি: ৳${fromAcc.currentBalance}`
        );
      }

      const dateStr = new Date().toISOString().split('T')[0];
      const voucherNumber = generateTransactionNumber('CNV');

      // Canonical GL Mapping:
      // Cash -> 1010
      // Bank -> 1030 (NOT 1020!)
      const toCode = getCashBankAccountGLCode(toAcc.accountType);
      const fromCode = getCashBankAccountGLCode(fromAcc.accountType);

      const accounts = await db.accounts.toArray();
      const journalLines: JournalLine[] = [
        {
          accountId: toCode,
          accountCode: toCode,
          accountName: `${toAcc.accountName || toAcc.name} (গন্তব্য)`,
          debit: amount,
          credit: 0,
          memo: 'কন্ট্রা জমা'
        },
        {
          accountId: fromCode,
          accountCode: fromCode,
          accountName: `${fromAcc.accountName || fromAcc.name} (উৎস)`,
          debit: 0,
          credit: amount,
          memo: 'কন্ট্রা উত্তোলন'
        }
      ];

      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_contra'),
          voucherNumber,
          voucherType: 'CONTRA',
          date: dateStr,
          narration: narration?.trim() || `কন্ট্রা তহবিল স্থানান্তর: ${fromAcc.accountName || fromAcc.name} থেকে ${toAcc.accountName || toAcc.name}`,
          reference: voucherNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // 1. Safe insert journal entry
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Atomically update balances
      await db.cashBankAccounts.update(fromAcc.id, {
        currentBalance: Math.round((fromAcc.currentBalance - amount) * 100) / 100
      });
      await db.cashBankAccounts.update(toAcc.id, {
        currentBalance: Math.round((toAcc.currentBalance + amount) * 100) / 100
      });

      // 3. Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'CONTRA_TRANSFER',
        module: 'FINANCE',
        recordId: voucherNumber,
        status: 'SUCCESS',
        details: `কন্ট্রা স্থানান্তর ${voucherNumber} সম্পন্ন (৳${amount})`
      });

      return { voucherNumber, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Animal Activity / Event Logging with optional Expense Auto-Posting
 * Updates matching running totals on Animal record:
 * - accumulatedFeedCost for FEED
 * - accumulatedMedCost for VACCINE / TREATMENT
 * - totalCost
 * Auto-posts expense to 6010 / 6050 / 6040 if cost > 0 and strictly validates double-entry balance.
 */
export async function executeAnimalEventTransaction(params: {
  animal: Animal;
  event: Omit<AnimalEvent, 'id' | 'synced'>;
  paymentMethod?: 'CASH' | 'BANK';
  bankAccountId?: string;
  currentUserId: string;
}): Promise<{ event: AnimalEvent; journalEntryId?: string }> {
  return await db.transaction(
    'rw',
    [
      db.animalEvents,
      db.animals,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const { animal, event, paymentMethod = 'CASH', bankAccountId, currentUserId } = params;

      // Date validations for Animal Event:
      // 1. Cannot be more than 1 day in the future
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const maxFutureDate = tomorrow.toISOString().split('T')[0];
      if (event.date > maxFutureDate) {
        throw new Error(`কার্যক্রমের তারিখ সর্বোচ্চ ১ দিন ভবিষ্যতের হতে পারে (${maxFutureDate} এর পরে গ্রহণযোগ্য নয়)।`);
      }

      // 2. Cannot be before that animal's purchase or birth date
      if (animal.purchaseDate && event.date < animal.purchaseDate) {
        throw new Error(`কার্যক্রমের তারিখ (${event.date}) পশুর ক্রয় তারিখের (${animal.purchaseDate}) পূর্ববর্তী হতে পারে না।`);
      }
      if (animal.birthDate && event.date < animal.birthDate) {
        throw new Error(`কার্যক্রমের তারিখ (${event.date}) পশুর জন্ম তারিখের (${animal.birthDate}) পূর্ববর্তী হতে পারে না।`);
      }

      const cost = Math.round((event.cost || 0) * 100) / 100;
      let journalEntryId: string | undefined;

      // If cost > 0, auto-post the expense using existing feed/medicine expense accounts
      if (cost > 0) {
        let expenseCode: string = CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE;
        let expenseName = 'বিবিধ পরিচালন ব্যয় (Miscellaneous Expense)';

        if (event.eventType === 'FEED') {
          expenseCode = CANONICAL_ACCOUNTS.FEED_EXPENSE; // 6010
          expenseName = 'খাদ্য ক্রয় খরচ (Feed Expense)';
        } else if (event.eventType === 'VACCINE') {
          expenseCode = CANONICAL_ACCOUNTS.VACCINATION; // 6050
          expenseName = 'টিকা প্রদান খরচ (Vaccination Expense)';
        } else if (event.eventType === 'TREATMENT') {
          expenseCode = CANONICAL_ACCOUNTS.VET_MEDICINE; // 6040
          expenseName = 'চিকিৎসা ও ওষুধ (Veterinary & Medicine)';
        }

        const paymentCode = paymentMethod === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
        const paymentName = paymentMethod === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'নগদ টাকা (Cash on Hand)';

        const journalLines: JournalLine[] = [
          {
            accountId: expenseCode,
            accountCode: expenseCode,
            accountName: expenseName,
            debit: cost,
            credit: 0,
            memo: `${animal.id} (${animal.breed}) - ${event.eventType} ব্যয়`
          },
          {
            accountId: paymentCode,
            accountCode: paymentCode,
            accountName: paymentName,
            debit: 0,
            credit: cost,
            memo: 'কার্যক্রম ব্যয় পরিশোধ'
          }
        ];

        // Explicit double-entry validation: Do not let this event save if unbalanced
        const accounts = await db.accounts.toArray();
        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('জাবেদা দাখিলা ভারসাম্যহীন! কার্যক্রম সংরক্ষণ বাতিল করা হলো।');
        }

        const voucherNumber = generateTransactionNumber('EVV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_evt'),
            voucherNumber,
            voucherType: 'PAYMENT',
            date: event.date,
            narration: `গবাদিপশু ${animal.id}: ${event.eventType}${event.vaccineName ? ` (${event.vaccineName})` : ''} কার্যক্রম ব্যয়`,
            reference: animal.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );

        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Update operational Cash / Bank balance consistently with GL
        if (paymentMethod === 'CASH') {
          const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await db.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance - cost) * 100) / 100
            });
          }
        } else if (paymentMethod === 'BANK') {
          let bankAcc: CashBankAccount | undefined;
          if (bankAccountId) bankAcc = await db.cashBankAccounts.get(bankAccountId);
          if (!bankAcc) bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance - cost) * 100) / 100
            });
          }
        }
      }

      // Insert AnimalEvent
      const eventId = generateUniqueId('evt');
      const eventRecord: AnimalEvent = {
        ...event,
        id: eventId,
        cost,
        synced: false
      };
      await safeInsert(db.animalEvents, eventRecord, { idPrefix: 'evt' });

      // Update matching running total on Animal record
      // accumulatedFeedCost for FEED, accumulatedMedCost for VACCINE/TREATMENT, accumulatedLabourCost stays manual, plus totalCost.
      const freshAnimal = (await db.animals.get(animal.id)) || animal;
      const newFeed = (freshAnimal.accumulatedFeedCost || 0) + (event.eventType === 'FEED' ? cost : 0);
      const newMed = (freshAnimal.accumulatedMedCost || 0) + (event.eventType === 'VACCINE' || event.eventType === 'TREATMENT' ? cost : 0);
      const newOther = (freshAnimal.otherCosts || 0) + (event.eventType !== 'FEED' && event.eventType !== 'VACCINE' && event.eventType !== 'TREATMENT' ? cost : 0);
      const newTotal = (freshAnimal.purchaseCost || 0) + newFeed + newMed + (freshAnimal.accumulatedLabourCost || 0) + newOther;

      const animalUpdates: Partial<Animal> = {
        accumulatedFeedCost: Math.round(newFeed * 100) / 100,
        accumulatedMedCost: Math.round(newMed * 100) / 100,
        otherCosts: Math.round(newOther * 100) / 100,
        totalCost: Math.round(newTotal * 100) / 100,
        synced: false
      };

      if (event.eventType === 'WEIGHT' && event.weightKg && event.weightKg > 0) {
        animalUpdates.currentWeightKg = event.weightKg;
      }
      if (event.eventType === 'MORTALITY') {
        animalUpdates.status = 'DECEASED';
      }

      await db.animals.update(freshAnimal.id, animalUpdates);

      // Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'ANIMAL_EVENT',
        module: 'LIVESTOCK',
        recordId: freshAnimal.id,
        status: 'SUCCESS',
        details: `${freshAnimal.id} (${freshAnimal.breed}) এ ${event.eventType} কার্যক্রম যুক্ত (ব্যয়: ৳${cost})`
      });

      return { event: eventRecord, journalEntryId };
    }
  );
}

/**
 * Atomic Execution of Animal Sell or Removal (Sold, Deceased, Transferred, Stolen)
 * If SOLD, auto-posts revenue using the same sales-posting pattern as InventoryCommerceModule.
 */
export async function executeAnimalSaleOrRemovalTransaction(params: {
  animal: Animal;
  newStatus: AnimalStatus;
  date: string;
  salePrice?: number;
  customerName?: string;
  paymentMethod?: 'CASH' | 'BANK';
  bankAccountId?: string;
  notes?: string;
  currentUserId: string;
}): Promise<{ updatedAnimal: Animal; sale?: Sale; journalEntryId?: string }> {
  return await db.transaction(
    'rw',
    [
      db.animals,
      db.sales,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        animal,
        newStatus,
        date,
        salePrice = 0,
        customerName,
        paymentMethod = 'CASH',
        bankAccountId,
        notes,
        currentUserId
      } = params;

      const freshAnimal = (await db.animals.get(animal.id)) || animal;
      const todayStr = new Date().toISOString().split('T')[0];

      if (newStatus === 'SOLD') {
        if (freshAnimal.purchaseDate && date < freshAnimal.purchaseDate) {
          throw new Error(`পশু বিক্রয়ের তারিখ (${date}) ক্রয় তারিখের (${freshAnimal.purchaseDate}) পূর্ববর্তী হতে পারে না।`);
        }
        if (date > todayStr) {
          throw new Error(`পশু বিক্রয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
        }
      }

      const cleanPrice = Math.round((salePrice || 0) * 100) / 100;
      let saleRecord: Sale | undefined;
      let journalEntryId: string | undefined;

      // If SOLD and cleanPrice > 0, auto-post revenue using the same sales-posting pattern as InventoryCommerceModule
      if (newStatus === 'SOLD' && cleanPrice > 0) {
        const paymentCode = paymentMethod === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
        const revenueCode = CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE; // 4020
        const accounts = await db.accounts.toArray();

        const journalLines: JournalLine[] = [
          {
            accountId: paymentCode,
            accountCode: paymentCode,
            accountName: paymentMethod === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'নগদ টাকা (Cash on Hand)',
            debit: cleanPrice,
            credit: 0,
            memo: `পশু বিক্রয়: ${freshAnimal.id}`
          },
          {
            accountId: revenueCode,
            accountCode: revenueCode,
            accountName: 'পশু বিক্রয় আয় (Livestock Sales Revenue)',
            debit: 0,
            credit: cleanPrice,
            memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) বিক্রয় রাজস্ব`
          }
        ];

        // Double check balance
        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('বিক্রয় জাবেদা ভারসাম্যহীন! বিক্রয় বাতিল করা হলো।');
        }

        const voucherNumber = generateTransactionNumber('SLV');
        const invoiceNumber = generateTransactionNumber('SAL');

        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_sale'),
            voucherNumber,
            voucherType: 'SALES',
            date,
            narration: `পশু বিক্রয় চালান: ${customerName || 'সাধারণ ক্রেতা'} এর নিকট ${freshAnimal.id} (${freshAnimal.breed}) বিক্রয়`,
            reference: invoiceNumber,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Create Sale Record in sales table
        const saleId = generateUniqueId('sal');
        saleRecord = {
          id: saleId,
          invoiceNumber,
          date,
          customerId: 'pty_walkin',
          customerName: customerName?.trim() || 'সাধারণ ক্রেতা (Walk-in Buyer)',
          category: 'LIVESTOCK',
          items: [
            {
              itemId: freshAnimal.id,
              itemName: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id})`,
              quantity: 1,
              unit: 'টি',
              unitPrice: cleanPrice,
              lineTotal: cleanPrice
            }
          ],
          subtotal: cleanPrice,
          totalAmount: cleanPrice,
          grandTotal: cleanPrice,
          paidAmount: cleanPrice,
          dueAmount: 0,
          paymentMethod,
          bankAccountId,
          journalEntryId: journalEntry.id,
          status: 'PAID',
          synced: false
        };
        await safeInsert(db.sales, saleRecord, { idPrefix: 'sal' });

        // Update Cash/Bank account balance
        if (paymentMethod === 'CASH') {
          const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await db.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance + cleanPrice) * 100) / 100
            });
          }
        } else if (paymentMethod === 'BANK') {
          let bankAcc: CashBankAccount | undefined;
          if (bankAccountId) bankAcc = await db.cashBankAccounts.get(bankAccountId);
          if (!bankAcc) bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance + cleanPrice) * 100) / 100
            });
          }
        }
      }

      // Update animal status/salePrice/saleDate/notes
      const noteAddition = notes?.trim() ? `[${newStatus} - ${date}: ${notes.trim()}]` : `[${newStatus} - ${date}]`;
      const combinedNotes = freshAnimal.notes ? `${freshAnimal.notes} | ${noteAddition}` : noteAddition;

      const updatedAnimal: Animal = {
        ...freshAnimal,
        status: newStatus,
        salePrice: newStatus === 'SOLD' ? cleanPrice : freshAnimal.salePrice,
        saleDate: date,
        notes: combinedNotes,
        synced: false
      };
      await db.animals.put(updatedAnimal);

      // Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: newStatus === 'SOLD' ? 'ANIMAL_SOLD' : 'ANIMAL_REMOVED',
        module: 'LIVESTOCK',
        recordId: freshAnimal.id,
        status: 'SUCCESS',
        details: `${freshAnimal.id} স্ট্যাটাস পরিবর্তন: ${newStatus}${newStatus === 'SOLD' ? ` (বিক্রয়মূল্য: ৳${cleanPrice})` : ''}`
      });

      return { updatedAnimal, sale: saleRecord, journalEntryId };
    }
  );
}
