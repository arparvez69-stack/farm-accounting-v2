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
import { generateDisplayNumber, generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import {
  Account,
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
  AnimalStatus,
  FishBatch,
  CropCycle
} from '../types';
import { generateAmortizationSchedule } from '../accounting/amortizationService';

/**
 * Atomic Execution of Sales Invoice Transaction
 */
export async function executeSaleTransaction(params: {
  customer: Party;
  item: InventoryItem;
  quantity: number;
  unitPrice: number;
  discount?: number;
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
      const { customer, item, quantity, unitPrice, discount = 0, paymentMethod, bankAccountId, currentUserId, date } = params;

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

      const subtotal = Math.round(quantity * unitPrice * 100) / 100;
      const validDiscount = Math.min(subtotal, Math.max(0, Math.round((discount || 0) * 100) / 100));
      const totalAmount = Math.max(0, Math.round((subtotal - validDiscount) * 100) / 100);
      const totalCogs = Math.round(quantity * (freshItem.avgCostPrice || 0) * 100) / 100;

      if (totalAmount <= 0) {
        throw new Error('Sale total amount must be strictly greater than 0.');
      }

      const saleId = generateUniqueId('sal');
      const invoiceNumber = generateTransactionNumber('SAL');
      const displayNumber = await generateDisplayNumber('SAL', dateStr);

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
          memo: `${freshItem.nameBn} বিক্রয়${validDiscount > 0 ? ` (মূল্যছাড়: ৳${validDiscount})` : ''}`
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
          narration: `বিক্রয় চালান: ${customer.name} কে ${quantity} ${freshItem.unit} ${freshItem.nameBn} বিক্রয়${validDiscount > 0 ? ` (ছাড়: ৳${validDiscount})` : ''}`,
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
        displayNumber,
        date: dateStr,
        customerId: customer.id,
        customerName: customer.name,
        items: [
          {
            itemId: freshItem.id,
            itemName: freshItem.nameBn,
            quantity,
            unitPrice,
            lineTotal: subtotal,
            cogsAmount: totalCogs
          }
        ],
        subtotal: subtotal,
        discount: validDiscount,
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
  discount?: number;
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
      const { supplier, item, quantity, unitPrice, transportCost = 0, discount = 0, paymentMethod, bankAccountId, currentUserId, date } = params;

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
      const validDiscount = Math.min(itemsTotal + transportCost, Math.max(0, Math.round((discount || 0) * 100) / 100));
      const grandTotal = Math.max(0, Math.round((itemsTotal + transportCost - validDiscount) * 100) / 100);

      if (grandTotal <= 0) {
        throw new Error('Purchase total amount must be strictly greater than 0.');
      }

      const purchaseId = generateUniqueId('pur');
      const invoiceNumber = generateTransactionNumber('PUR');
      const displayNumber = await generateDisplayNumber('PUR', dateStr);

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
          memo: `ক্রয় চালান ${invoiceNumber} (পরিবহন ব্যয়${validDiscount > 0 ? ` ও মূল্যছাড় ৳${validDiscount}` : ''} সমন্বিত মূল্যায়ন)`
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
          narration: `ক্রয় চালান: ${supplier.name} এর নিকট থেকে ${quantity} ${freshItem.unit} ${freshItem.nameBn} ক্রয়${validDiscount > 0 ? ` (ছাড়: ৳${validDiscount})` : ''}`,
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
        displayNumber,
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
        discount: validDiscount,
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
        lastRestockAmount: quantity,
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
  annualInterestRatePercent?: number;
  termMonths?: number;
  startDate?: string;
  loanType?: 'BANK' | 'NGO' | 'INDIVIDUAL';
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
      const {
        lenderName,
        principal,
        interestRate,
        tenureMonths,
        targetAccountId,
        currentUserId,
        annualInterestRatePercent,
        termMonths,
        startDate,
        loanType = 'BANK'
      } = params;

      if (principal <= 0) {
        throw new Error('Loan principal must be strictly greater than 0.');
      }

      let targetAcc = await db.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.where('accountType').equals(targetAccountId).first();
      }
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.toCollection().first();
      }
      if (!targetAcc) {
        throw new Error(`Target cash/bank account ${targetAccountId} not found.`);
      }

      const loanId = generateUniqueId('ln');
      const loanRef = generateTransactionNumber('LN');
      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = startDate || todayStr;
      const effectiveRate = annualInterestRatePercent !== undefined ? annualInterestRatePercent : interestRate;
      const effectiveMonths = termMonths !== undefined ? termMonths : (tenureMonths || 12);

      // Canonical GL Mapping:
      // Dr Cash (1010) or Bank (1030)
      // Cr 2110 (Short-Term Loan) or 2120 (Long-Term Loan) - NEVER 2020 Accrued Wages!
      const assetGlCode = getCashBankAccountGLCode(targetAcc.accountType);
      const liabilityGlCode = getLoanLiabilityAccount(effectiveMonths);

      const accounts = await db.accounts.toArray();
      const assetAcc = accounts.find((a) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল'
      };
      const liabilityAcc = accounts.find((a) => a.code === liabilityGlCode) || {
        id: `acc_${liabilityGlCode}`,
        code: liabilityGlCode,
        nameBn:
          liabilityGlCode === '2110'
            ? 'স্বল্পমেয়াদী ঋণ (Short-Term Loans)'
            : 'দীর্ঘমেয়াদী ঋণ (Long-Term Loans)'
      };

      const journalLines: JournalLine[] = [
        {
          accountId: assetAcc.id,
          accountCode: assetGlCode,
          accountName: targetAcc.accountName || targetAcc.name || assetAcc.nameBn,
          debit: principal,
          credit: 0,
          memo: 'ঋণের অর্থ প্রাপ্তি'
        },
        {
          accountId: liabilityAcc.id,
          accountCode: liabilityGlCode,
          accountName: liabilityAcc.nameBn,
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

      // Generate Amortization Schedule (Reducing-Balance / Straight-Line)
      const schedule = generateAmortizationSchedule(principal, effectiveRate, effectiveMonths, dateStr);
      const monthlyEmi = schedule.length > 0 ? schedule[0].totalPayment : Math.round((principal / effectiveMonths) * 100) / 100;

      // 2. Safe insert loan record
      const loanRecord: Loan = {
        id: loanId,
        loanNumber: loanRef,
        lenderName: lenderName.trim(),
        loanType,
        principalAmount: principal,
        disbursedDate: dateStr,
        startDate: dateStr,
        interestRateAnnual: effectiveRate,
        annualInterestRatePercent: effectiveRate,
        interestRate: effectiveRate,
        monthlyInstallment: monthlyEmi,
        tenureMonths: effectiveMonths,
        termMonths: effectiveMonths,
        term: effectiveMonths <= 12 ? 'SHORT_TERM' : 'LONG_TERM',
        remainingPrincipal: principal,
        remainingBalance: principal,
        schedule,
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
  phone?: string;
  annualInterestRatePercent?: number;
  termMonths?: number;
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
      const {
        investorName,
        contribution,
        profitShare,
        targetAccountId,
        currentUserId,
        phone,
        annualInterestRatePercent,
        termMonths
      } = params;

      if (contribution <= 0) {
        throw new Error('Contribution amount must be strictly greater than 0.');
      }

      let targetAcc = await db.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.where('accountType').equals(targetAccountId).first();
      }
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.toCollection().first();
      }
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
      const assetAcc = accounts.find((a) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল'
      };
      const equityAcc = accounts.find((a) => a.code === equityGlCode) || {
        id: `acc_${equityGlCode}`,
        code: equityGlCode,
        nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)'
      };

      const journalLines: JournalLine[] = [
        {
          accountId: assetAcc.id,
          accountCode: assetGlCode,
          accountName: targetAcc.accountName || targetAcc.name || assetAcc.nameBn,
          debit: contribution,
          credit: 0,
          memo: 'বিনিয়োগ মূলধন গ্রহণ'
        },
        {
          accountId: equityAcc.id,
          accountCode: equityGlCode,
          accountName: equityAcc.nameBn,
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

      // Generate optional investor return/amortization schedule if terms provided
      let schedule: any[] | undefined = undefined;
      if (annualInterestRatePercent !== undefined && annualInterestRatePercent >= 0 && termMonths && termMonths > 0) {
        schedule = generateAmortizationSchedule(contribution, annualInterestRatePercent, termMonths, dateStr);
      }

      // 2. Safe insert investor record
      const investorRecord: Investor = {
        id: invId,
        name: investorName.trim(),
        phone: phone?.trim() || undefined,
        capitalAmount: contribution,
        initialCapital: contribution,
        totalContribution: contribution,
        totalWithdrawals: 0,
        drawings: 0,
        currentBalance: contribution,
        currentEquityBalance: contribution,
        sharePercentage: profitShare,
        profitSharePercentage: profitShare,
        ownershipPercentage: profitShare,
        annualInterestRatePercent: annualInterestRatePercent || 0,
        termMonths: termMonths || undefined,
        schedule,
        joinedDate: dateStr,
        entryDate: dateStr,
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
 * Atomic Execution of Loan Repayment
 * Debits Loan Liability (2110 or 2120) for principal, Debits Interest Expense (8010) for interest,
 * Credits Cash (1010) or Bank (1030).
 * Updates Loan schedule and remaining balance.
 */
export async function executeLoanRepaymentTransaction(params: {
  loanId: string;
  sourceAccountId: string; // Cash or Bank account ID
  principalAmount: number;
  interestAmount: number;
  installmentNumber?: number;
  repaymentDate?: string;
  note?: string;
  currentUserId: string;
}): Promise<{ journalEntryId: string; updatedLoan: Loan }> {
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
      const {
        loanId,
        sourceAccountId,
        principalAmount,
        interestAmount,
        installmentNumber,
        repaymentDate,
        note,
        currentUserId
      } = params;

      const pAmt = Math.max(0, Number(principalAmount) || 0);
      const iAmt = Math.max(0, Number(interestAmount) || 0);
      const totalRepayment = Math.round((pAmt + iAmt) * 100) / 100;

      if (totalRepayment <= 0) {
        throw new Error('পরিশোধের পরিমাণ (আসল বা সুদ) ০ থেকে বেশি হতে হবে।');
      }

      const loan = await db.loans.get(loanId);
      if (!loan) {
        throw new Error(`ঋণ চুক্তি ${loanId} পাওয়া যায়নি।`);
      }

      const sourceAcc = await db.cashBankAccounts.get(sourceAccountId);
      if (!sourceAcc) {
        throw new Error(`উৎস পরিশোধ হিসাব ${sourceAccountId} পাওয়া যায়নি।`);
      }

      if (sourceAcc.currentBalance < totalRepayment) {
        throw new Error(
          `পর্যাপ্ত ব্যালেন্স নেই! ${sourceAcc.name} এ বর্তমান স্থিতি: ৳${sourceAcc.currentBalance}`
        );
      }

      const dateStr = repaymentDate || new Date().toISOString().split('T')[0];
      const voucherNumber = generateTransactionNumber('PAY-LN');
      const repRef = generateTransactionNumber('REP');

      // Asset GL Code for cash/bank account
      const assetGlCode = getCashBankAccountGLCode(sourceAcc.accountType);
      // Liability GL Code (2110 or 2120)
      const liabilityGlCode = getLoanLiabilityAccount(loan.termMonths || loan.tenureMonths || 12);
      // Interest Expense Code (8010 Loan Interest Expense)
      const interestExpenseCode = '8010';

      const accounts = await db.accounts.toArray();
      const liabilityAcc = accounts.find((a) => a.code === liabilityGlCode) || {
        id: `acc_${liabilityGlCode}`,
        code: liabilityGlCode,
        nameBn:
          liabilityGlCode === '2110'
            ? 'স্বল্পমেয়াদী ঋণ (Short-Term Loans)'
            : 'দীর্ঘমেয়াদী ঋণ (Long-Term Loans)'
      };
      const interestAcc = accounts.find((a) => a.code === interestExpenseCode) || {
        id: `acc_${interestExpenseCode}`,
        code: interestExpenseCode,
        nameBn: 'ঋণের সুদ খরচ (Loan Interest Expense)'
      };
      const assetAcc = accounts.find((a) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: sourceAcc.accountName || sourceAcc.name || 'ব্যাংক/নগদ তহবিল'
      };

      const journalLines: JournalLine[] = [];

      // 1. Debit Principal to Liability (2110 / 2120)
      if (pAmt > 0) {
        journalLines.push({
          accountId: liabilityAcc.id,
          accountCode: liabilityGlCode,
          accountName: liabilityAcc.nameBn,
          debit: pAmt,
          credit: 0,
          memo: `ঋণ কিস্তি আসল পরিশোধ: ${loan.lenderName}`
        });
      }

      // 2. Debit Interest to Interest Expense (8010)
      if (iAmt > 0) {
        journalLines.push({
          accountId: interestAcc.id,
          accountCode: interestExpenseCode,
          accountName: interestAcc.nameBn,
          debit: iAmt,
          credit: 0,
          memo: `ঋণ কিস্তি সুদ পরিশোধ: ${loan.lenderName}`
        });
      }

      // 3. Credit Source Account (1010 Cash or 1030 Bank)
      journalLines.push({
        accountId: assetAcc.id,
        accountCode: assetGlCode,
        accountName: sourceAcc.accountName || sourceAcc.name || assetAcc.nameBn,
        debit: 0,
        credit: totalRepayment,
        memo: `ঋণ পরিশোধ: ${loan.lenderName} (${voucherNumber})`
      });

      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_rep'),
          voucherNumber,
          voucherType: 'PAYMENT',
          date: dateStr,
          narration: `ঋণ পরিশোধ: ${loan.lenderName} (আসল: ৳${pAmt}, সুদ: ৳${iAmt})${note ? ` - ${note}` : ''}`,
          reference: repRef,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // Update source bank/cash balance
      await db.cashBankAccounts.update(sourceAcc.id, {
        currentBalance: Math.round((sourceAcc.currentBalance - totalRepayment) * 100) / 100
      });

      // Update Loan record, schedule & balances
      const currentRemaining = Math.max(0, (loan.remainingPrincipal ?? loan.remainingBalance ?? loan.principalAmount) - pAmt);
      const newTotalPaidP = (loan.totalPaidPrincipal || 0) + pAmt;
      const newTotalPaidI = (loan.totalPaidInterest || 0) + iAmt;

      let updatedSchedule =
        loan.schedule && loan.schedule.length > 0
          ? [...loan.schedule]
          : generateAmortizationSchedule(
              loan.principalAmount,
              loan.annualInterestRatePercent ?? loan.interestRate ?? 0,
              loan.termMonths ?? loan.tenureMonths ?? 12,
              loan.disbursedDate || loan.startDate
            );

      if (updatedSchedule.length > 0) {
        if (installmentNumber && installmentNumber > 0) {
          // Specific installment matched
          const idx = updatedSchedule.findIndex((s) => s.installmentNumber === installmentNumber);
          if (idx !== -1) {
            updatedSchedule[idx] = {
              ...updatedSchedule[idx],
              isPaid: true,
              paidDate: dateStr,
              repaymentJournalId: journalEntry.id
            };
          }
        } else {
          // Mark the first unpaid installment as paid
          const firstUnpaidIdx = updatedSchedule.findIndex((s) => !s.isPaid);
          if (firstUnpaidIdx !== -1) {
            updatedSchedule[firstUnpaidIdx] = {
              ...updatedSchedule[firstUnpaidIdx],
              isPaid: true,
              paidDate: dateStr,
              repaymentJournalId: journalEntry.id
            };
          }
        }
      }

      const allPaid = updatedSchedule.length > 0
        ? updatedSchedule.every((s) => s.isPaid)
        : currentRemaining <= 0;

      const newStatus = allPaid || currentRemaining <= 0 ? 'PAID_OFF' : 'ACTIVE';

      const updatedLoan: Loan = {
        ...loan,
        remainingPrincipal: currentRemaining,
        remainingBalance: currentRemaining,
        totalPaidPrincipal: newTotalPaidP,
        totalPaidInterest: newTotalPaidI,
        schedule: updatedSchedule,
        status: newStatus
      };

      await db.loans.put(updatedLoan);

      // Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'LOAN_REPAYMENT',
        module: 'FINANCE',
        recordId: repRef,
        status: 'SUCCESS',
        details: `ঋণ ${loan.loanNumber || loan.id} পরিশোধ ৳${totalRepayment} (আসল: ৳${pAmt}, সুদ: ৳${iAmt})`
      });

      return { journalEntryId: journalEntry.id, updatedLoan };
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
      db.closedPeriods,
      db.inventoryItems,
      db.stockMovements
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

      // Determine inventory item consumption for FEED event with inventory item linked + quantity
      const feedItemId = (event as any).inventoryItemId || event.feedItemId;
      const feedQuantityUsed = (event as any).quantity ?? event.feedQuantityUsed;
      const isInventoryFeed = event.eventType === 'FEED' && !!feedItemId && typeof feedQuantityUsed === 'number' && feedQuantityUsed > 0;

      let feedItem: InventoryItem | undefined;
      let effectiveCost = Math.round((event.cost || 0) * 100) / 100;

      if (isInventoryFeed) {
        feedItem = await db.inventoryItems.get(feedItemId);
        if (feedItem) {
          effectiveCost = Math.round(feedQuantityUsed * (feedItem.avgCostPrice || 0) * 100) / 100;
        }
      }

      const cost = effectiveCost;
      let journalEntryId: string | undefined;

      // If cost > 0, auto-post the expense:
      // - For FEED with real inventory item link + quantity: Dr Feed Expense (6010), Cr Feed Inventory (1051) [do NOT credit Cash/Bank]
      // - For others (or FEED/VACCINE/TREATMENT without inventory link): Dr Expense, Cr Cash/Bank
      if (cost > 0) {
        const accounts = await db.accounts.toArray();

        if (isInventoryFeed && feedItem) {
          const expenseCode = CANONICAL_ACCOUNTS.FEED_EXPENSE; // 6010
          const expenseName = 'খাদ্য ক্রয় খরচ (Feed Expense)';
          const inventoryCode = CANONICAL_ACCOUNTS.FEED_INVENTORY; // 1051
          const inventoryName = 'মজুদ খাদ্য (Feed Inventory)';

          const expenseAcc = accounts.find((a) => a.code === expenseCode) || {
            id: `acc_${expenseCode}`,
            code: expenseCode,
            nameBn: expenseName
          };
          const inventoryAcc = accounts.find((a) => a.code === inventoryCode) || {
            id: `acc_${inventoryCode}`,
            code: inventoryCode,
            nameBn: inventoryName
          };

          const journalLines: JournalLine[] = [
            {
              accountId: expenseAcc.id,
              accountCode: expenseCode,
              accountName: expenseAcc.nameBn || expenseName,
              debit: cost,
              credit: 0,
              memo: `${animal.id} (${animal.breed}) - খাদ্য খরচ (ইনভেন্টরি ব্যবহার: ${feedQuantityUsed} ${feedItem.unit})`
            },
            {
              accountId: inventoryAcc.id,
              accountCode: inventoryCode,
              accountName: inventoryAcc.nameBn || inventoryName,
              debit: 0,
              credit: cost,
              memo: `${feedItem.nameEn || feedItem.nameBn}: খাদ্য মজুদ থেকে ব্যবহার`
            }
          ];

          const check = validateBalancedLines(journalLines, accounts);
          if (!check.isBalanced) {
            throw new Error('জাবেদা দাখিলা ভারসাম্যহীন! কার্যক্রম সংরক্ষণ বাতিল করা হলো।');
          }

          const voucherNumber = generateTransactionNumber('EVV');
          const journalEntry = await postJournalEntry(
            {
              id: generateUniqueId('j_evt'),
              voucherNumber,
              voucherType: 'JOURNAL',
              date: event.date,
              narration: `গবাদিপশু ${animal.id}: খাদ্য মজুদ থেকে ব্যবহার (${feedQuantityUsed} ${feedItem.unit})`,
              reference: animal.id,
              lines: journalLines,
              createdBy: currentUserId,
              createdAt: new Date().toISOString()
            },
            { accounts, skipDbPut: true }
          );

          await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
          journalEntryId = journalEntry.id;
        } else {
          // Standard cash/bank expense posting
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

          const expenseAcc = accounts.find((a) => a.code === expenseCode) || {
            id: `acc_${expenseCode}`,
            code: expenseCode,
            nameBn: expenseName
          };
          const paymentAcc = accounts.find((a) => a.code === paymentCode) || {
            id: `acc_${paymentCode}`,
            code: paymentCode,
            nameBn: paymentName
          };

          const journalLines: JournalLine[] = [
            {
              accountId: expenseAcc.id,
              accountCode: expenseCode,
              accountName: expenseAcc.nameBn || expenseName,
              debit: cost,
              credit: 0,
              memo: `${animal.id} (${animal.breed}) - ${event.eventType} ব্যয়`
            },
            {
              accountId: paymentAcc.id,
              accountCode: paymentCode,
              accountName: paymentAcc.nameBn || paymentName,
              debit: 0,
              credit: cost,
              memo: 'কার্যক্রম ব্যয় পরিশোধ'
            }
          ];

          // Explicit double-entry validation: Do not let this event save if unbalanced
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
      }

      // Insert AnimalEvent
      const eventId = generateUniqueId('evt');
      const eventRecord: AnimalEvent = {
        ...event,
        feedItemId: feedItemId || event.feedItemId,
        feedQuantityUsed: feedQuantityUsed ?? event.feedQuantityUsed,
        id: eventId,
        cost,
        journalEntryId,
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

      // Deduct feed stock from matching InventoryItem if feedItemId and feedQuantityUsed provided
      if (isInventoryFeed) {
        const itemToDeduct = feedItem || (feedItemId ? await db.inventoryItems.get(feedItemId) : undefined);
        if (itemToDeduct && feedQuantityUsed && feedQuantityUsed > 0) {
          const newStock = Math.max(0, Math.round((itemToDeduct.currentStock - feedQuantityUsed) * 100) / 100);
          await db.inventoryItems.update(itemToDeduct.id, {
            currentStock: newStock,
            synced: false
          });

          await safeInsert(
            db.stockMovements,
            {
              id: generateUniqueId('stkm'),
              date: event.date,
              itemId: itemToDeduct.id,
              movementType: 'CONSUMPTION',
              quantity: feedQuantityUsed,
              unitCost: itemToDeduct.avgCostPrice,
              totalValue: Math.round(feedQuantityUsed * itemToDeduct.avgCostPrice * 100) / 100,
              referenceId: eventId,
              notes: `পশু ${animal.tag || animal.id}: খাদ্য ব্যবহার (${feedQuantityUsed} ${itemToDeduct.unit})`,
              synced: false
            },
            { idPrefix: 'stkm' }
          );
        }
      }

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
      // Original purchase cost ONLY - do NOT include accumulated feed/med/labour costs
      const costToDerecognize = Math.round((freshAnimal.purchaseCost || 0) * 100) / 100;
      let saleRecord: Sale | undefined;
      let journalEntryId: string | undefined;

      const accounts = await db.accounts.toArray();

      // Ensure livestock asset, COGS, and write-off accounts exist
      let livestockAssetAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
      if (!livestockAssetAcc) {
        const newAcc: Account = {
          id: 'acc_1580',
          code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          nameBn: 'পশুসম্পদ (Livestock & Biological Assets)',
          nameEn: 'Livestock & Biological Assets',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        livestockAssetAcc = newAcc;
      }

      let livestockCogsAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_COGS);
      if (!livestockCogsAcc) {
        const newAcc: Account = {
          id: 'acc_5020',
          code: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
          nameBn: 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয় (Livestock COGS)',
          nameEn: 'Livestock Cost of Goods Sold',
          accountClass: 'COGS',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        livestockCogsAcc = newAcc;
      }

      let writeOffAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF);
      if (!writeOffAcc) {
        const newAcc: Account = {
          id: 'acc_8020',
          code: CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF,
          nameBn: 'পশুসম্পদ অবলোপন (Livestock Write-off)',
          nameEn: 'Livestock Write-off',
          accountClass: 'OTHER_EXPENSE',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        writeOffAcc = newAcc;
      }

      // If SOLD:
      // 1. Revenue leg: Debit Cash/Bank, Credit Livestock Revenue (4020)
      // 2. Cost leg: Debit Livestock COGS (5020), Credit Livestock Assets (1580) for original purchaseCost ONLY
      if (newStatus === 'SOLD' && (cleanPrice > 0 || costToDerecognize > 0)) {
        const paymentCode = paymentMethod === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
        const revenueCode = CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE; // 4020

        const paymentAcc = accounts.find((a) => a.code === paymentCode) || {
          id: `acc_${paymentCode}`,
          code: paymentCode,
          nameBn: paymentMethod === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'নগদ টাকা (Cash on Hand)'
        };
        const revenueAcc = accounts.find((a) => a.code === revenueCode) || {
          id: `acc_${revenueCode}`,
          code: revenueCode,
          nameBn: 'পশু বিক্রয় আয় (Livestock Sales Revenue)'
        };

        const journalLines: JournalLine[] = [];

        // Revenue recognition
        if (cleanPrice > 0) {
          journalLines.push(
            {
              accountId: paymentAcc.id,
              accountCode: paymentCode,
              accountName: paymentAcc.nameBn,
              debit: cleanPrice,
              credit: 0,
              memo: `পশু বিক্রয়: ${freshAnimal.id}`
            },
            {
              accountId: revenueAcc.id,
              accountCode: revenueCode,
              accountName: revenueAcc.nameBn,
              debit: 0,
              credit: cleanPrice,
              memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) বিক্রয় রাজস্ব`
            }
          );
        }

        // COGS & Asset Derecognition (original purchaseCost only)
        if (costToDerecognize > 0) {
          journalLines.push(
            {
              accountId: livestockCogsAcc.id,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
              accountName: livestockCogsAcc.nameBn || 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয় (Livestock COGS)',
              debit: costToDerecognize,
              credit: 0,
              memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) মূল ক্রয়মূল্য খরচ (COGS)`
            },
            {
              accountId: livestockAssetAcc.id,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
              accountName: livestockAssetAcc.nameBn || 'পশুসম্পদ (Livestock & Biological Assets)',
              debit: 0,
              credit: costToDerecognize,
              memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) বিক্রয় বাবদ সম্পদ হিসাব সমন্বয়`
            }
          );
        }

        // Double check balance
        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('বিক্রয় জাবেদা ভারসাম্যহীন! বিক্রয় বাতিল করা হলো।');
        }

        const voucherNumber = generateTransactionNumber('SLV');
        const invoiceNumber = generateTransactionNumber('SAL');
        const displayNumber = await generateDisplayNumber('SAL', date);

        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_sale'),
            voucherNumber,
            voucherType: 'SALES',
            date,
            narration: `পশু বিক্রয় চালান: ${customerName || 'সাধারণ ক্রেতা'} এর নিকট ${freshAnimal.id} (${freshAnimal.breed}) বিক্রয়${costToDerecognize > 0 ? ` (মূল ক্রয়মূল্য: ৳${costToDerecognize})` : ''}`,
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
        if (cleanPrice > 0) {
          const saleId = generateUniqueId('sal');
          saleRecord = {
            id: saleId,
            invoiceNumber,
            displayNumber,
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
      } else if (['DECEASED', 'STOLEN', 'TRANSFERRED'].includes(newStatus)) {
        // If an animal is marked DECEASED, STOLEN, or TRANSFERRED (not sold):
        // Debit 'পশুসম্পদ অবলোপন (Livestock Write-off)' (8020), Credit Livestock Assets (1580), for its purchaseCost ONLY
        if (costToDerecognize > 0) {
          const writeOffLines: JournalLine[] = [
            {
              accountId: writeOffAcc.id,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF,
              accountName: writeOffAcc.nameBn || 'পশুসম্পদ অবলোপন (Livestock Write-off)',
              debit: costToDerecognize,
              credit: 0,
              memo: `পশু অবলোপন (${newStatus}): ${freshAnimal.id} (${freshAnimal.breed}) মূল ক্রয়মূল্য`
            },
            {
              accountId: livestockAssetAcc.id,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
              accountName: livestockAssetAcc.nameBn || 'পশুসম্পদ (Livestock & Biological Assets)',
              debit: 0,
              credit: costToDerecognize,
              memo: `${freshAnimal.id} অপসারণ (${newStatus}) বাবদ সম্পদ বহির্গমন`
            }
          ];

          const check = validateBalancedLines(writeOffLines, accounts);
          if (!check.isBalanced) {
            throw new Error('অবলোপন জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
          }

          const voucherNumber = generateTransactionNumber('ADJ');
          const writeOffEntry = await postJournalEntry(
            {
              id: generateUniqueId('j_writeoff'),
              voucherNumber,
              voucherType: 'ADJUSTMENT',
              date,
              narration: `পশুসম্পদ অবলোপন দাখিলা (${newStatus}): ${freshAnimal.id} (${freshAnimal.breed}) খামার থেকে অপসারণ বাবদ অবলোপন${notes ? ` [${notes}]` : ''}`,
              reference: freshAnimal.id,
              lines: writeOffLines,
              createdBy: currentUserId,
              createdAt: new Date().toISOString()
            },
            { accounts, skipDbPut: true }
          );
          await safeInsert(db.journalEntries, writeOffEntry, { idPrefix: 'j' });
          journalEntryId = writeOffEntry.id;
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
        journalEntryId: journalEntryId || freshAnimal.journalEntryId,
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

/**
 * Atomic Execution of Owner Capital Transaction
 * Owner puts money into the business.
 * Debit: Cash (1010) or Bank (1030)
 * Credit: Owner Capital (3010)
 */
export async function executeOwnerCapitalTransaction(params: {
  amount: number;
  targetAccountId: string;
  currentUserId: string;
  date?: string;
  notes?: string;
}): Promise<{ journalEntryId: string; voucherNumber: string }> {
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
      const { amount, targetAccountId, currentUserId, date, notes } = params;

      if (amount <= 0) {
        throw new Error('মূলধনের পরিমাণ ০ থেকে বেশি হতে হবে (Capital amount must be strictly greater than 0).');
      }

      const cleanAmount = Math.round(amount * 100) / 100;
      let targetAcc = await db.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.where('accountType').equals(targetAccountId).first();
      }
      if (!targetAcc) {
        targetAcc = await db.cashBankAccounts.toCollection().first();
      }
      if (!targetAcc) {
        throw new Error(`তহবিল/ব্যাংক অ্যাকাউন্ট (${targetAccountId}) পাওয়া যায়নি।`);
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`লেনদেনের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const voucherNumber = generateTransactionNumber('RCV');
      const assetGlCode = getCashBankAccountGLCode(targetAcc.accountType);
      const capitalGlCode = CANONICAL_ACCOUNTS.OWNER_CAPITAL; // 3010

      const accounts = await db.accounts.toArray();
      const targetAccName = targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল';

      const journalLines: JournalLine[] = [
        {
          accountId: assetGlCode,
          accountCode: assetGlCode,
          accountName: targetAccName,
          debit: cleanAmount,
          credit: 0,
          memo: `মালিকের মূলধন জমা: ${targetAccName}`
        },
        {
          accountId: capitalGlCode,
          accountCode: capitalGlCode,
          accountName: 'মালিকের মূলধন (Owner\'s Capital)',
          debit: 0,
          credit: cleanAmount,
          memo: `মালিক কর্তৃক ব্যবসায় মূলধন বিনিয়োগ${notes ? ` (${notes.trim()})` : ''}`
        }
      ];

      const check = validateBalancedLines(journalLines, accounts);
      if (!check.isBalanced) {
        throw new Error('মূলধন জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
      }

      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_cap'),
          voucherNumber,
          voucherType: 'RECEIPT',
          date: dateStr,
          narration: `মালিকের মূলধন জমা: ৳${cleanAmount} (${targetAccName})${notes ? ` - ${notes.trim()}` : ''}`,
          reference: voucherNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // Update cash/bank balance
      await db.cashBankAccounts.update(targetAcc.id, {
        currentBalance: Math.round((targetAcc.currentBalance + cleanAmount) * 100) / 100,
        synced: false
      });

      // Audit log
      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'OWNER_CAPITAL_ADDED',
          module: 'FINANCE',
          recordId: journalEntry.id,
          status: 'SUCCESS',
          details: `মালিকের মূলধন জমা: ৳${cleanAmount} (${targetAccName}, ভাউচার: ${voucherNumber})`
        },
        { idPrefix: 'aud' }
      );

      return { journalEntryId: journalEntry.id, voucherNumber };
    }
  );
}

/**
 * Atomic Execution of Owner Drawing Transaction
 * Owner takes money out for personal use.
 * Debit: Owner Drawings (3040)
 * Credit: Cash (1010) or Bank (1030)
 */
export async function executeOwnerDrawingTransaction(params: {
  amount: number;
  sourceAccountId: string;
  currentUserId: string;
  date?: string;
  notes?: string;
}): Promise<{ journalEntryId: string; voucherNumber: string }> {
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
      const { amount, sourceAccountId, currentUserId, date, notes } = params;

      if (amount <= 0) {
        throw new Error('উত্তোলনের পরিমাণ ০ থেকে বেশি হতে হবে (Drawing amount must be strictly greater than 0).');
      }

      const cleanAmount = Math.round(amount * 100) / 100;
      let sourceAcc = await db.cashBankAccounts.get(sourceAccountId);
      if (!sourceAcc) {
        sourceAcc = await db.cashBankAccounts.where('accountType').equals(sourceAccountId).first();
      }
      if (!sourceAcc) {
        sourceAcc = await db.cashBankAccounts.toCollection().first();
      }
      if (!sourceAcc) {
        throw new Error(`তহবিল/ব্যাংক অ্যাকাউন্ট (${sourceAccountId}) পাওয়া যায়নি।`);
      }

      if (sourceAcc.currentBalance < cleanAmount) {
        throw new Error(
          `পর্যাপ্ত ব্যালেন্স নেই! ${sourceAcc.accountName || sourceAcc.name} এ বর্তমান স্থিতি: ৳${sourceAcc.currentBalance}`
        );
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`লেনদেনের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const voucherNumber = generateTransactionNumber('PMV');
      const assetGlCode = getCashBankAccountGLCode(sourceAcc.accountType);
      const drawingsGlCode = CANONICAL_ACCOUNTS.OWNER_DRAWINGS; // 3040

      const accounts = await db.accounts.toArray();
      const sourceAccName = sourceAcc.accountName || sourceAcc.name || 'ব্যাংক/নগদ তহবিল';

      const journalLines: JournalLine[] = [
        {
          accountId: drawingsGlCode,
          accountCode: drawingsGlCode,
          accountName: 'মালিকের উত্তোলন (Owner\'s Drawings)',
          debit: cleanAmount,
          credit: 0,
          memo: `মালিকের ব্যক্তিগত উত্তোলন${notes ? ` (${notes.trim()})` : ''}`
        },
        {
          accountId: assetGlCode,
          accountCode: assetGlCode,
          accountName: sourceAccName,
          debit: 0,
          credit: cleanAmount,
          memo: `মালিকের উত্তোলন পরিশোধ: ${sourceAccName}`
        }
      ];

      const check = validateBalancedLines(journalLines, accounts);
      if (!check.isBalanced) {
        throw new Error('উত্তোলন জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
      }

      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_draw'),
          voucherNumber,
          voucherType: 'PAYMENT',
          date: dateStr,
          narration: `মালিকের ব্যক্তিগত উত্তোলন: ৳${cleanAmount} (${sourceAccName})${notes ? ` - ${notes.trim()}` : ''}`,
          reference: voucherNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // Update cash/bank balance
      await db.cashBankAccounts.update(sourceAcc.id, {
        currentBalance: Math.round((sourceAcc.currentBalance - cleanAmount) * 100) / 100,
        synced: false
      });

      // Audit log
      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'OWNER_DRAWING',
          module: 'FINANCE',
          recordId: journalEntry.id,
          status: 'SUCCESS',
          details: `মালিকের ব্যক্তিগত উত্তোলন: ৳${cleanAmount} (${sourceAccName}, ভাউচার: ${voucherNumber})`
        },
        { idPrefix: 'aud' }
      );

      return { journalEntryId: journalEntry.id, voucherNumber };
    }
  );
}

/**
 * Atomic Execution of Fish Batch Harvest and Sale
 * - Records harvest weight and mortality count
 * - Posts Revenue leg: Debit Cash/Bank/Receivable, Credit Fish Sales Revenue (4010)
 * - Posts Cost leg: Debit Fish COGS (5010), Credit Biological Assets (1580) for accumulated costs (fingerlingCost + totalFeedCost)
 * - Marks FishBatch status as HARVESTED
 */
export interface FishHarvestSaleParams {
  batchId: string;
  harvestWeightKg: number;
  mortalityCount: number;
  salePrice: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  customerName?: string;
  date?: string;
  notes?: string;
  currentUserId: string;
}

export async function executeFishHarvestAndSaleTransaction(
  params: FishHarvestSaleParams
): Promise<{ updatedBatch: FishBatch; sale?: Sale; journalEntryId?: string; voucherNumber?: string }> {
  return await db.transaction(
    'rw',
    [
      db.fishBatches,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.sales,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        batchId,
        harvestWeightKg,
        mortalityCount,
        salePrice,
        paymentMethod,
        bankAccountId,
        customerName,
        date,
        notes,
        currentUserId
      } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`আহরণ ও বিক্রয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const closedPeriod = await db.closedPeriods
        .filter((p) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const freshBatch = await db.fishBatches.get(batchId);
      if (!freshBatch) {
        throw new Error(`মাছের ব্যাচ পাওয়া যায়নি (ID: ${batchId})।`);
      }
      if (freshBatch.status === 'HARVESTED') {
        throw new Error(`এই মাছের ব্যাচটি (${freshBatch.id}) ইতিমধ্যে আহরণ ও বিক্রয় সম্পন্ন হয়েছে।`);
      }

      const cleanWeight = Math.max(0, Number(harvestWeightKg) || 0);
      const cleanMortality = Math.max(0, Number(mortalityCount) || 0);
      const cleanPrice = Math.max(0, Math.round((Number(salePrice) || 0) * 100) / 100);

      // Validate payment source if BANK
      let bankAcc: CashBankAccount | undefined;
      if (paymentMethod === 'BANK' && cleanPrice > 0) {
        if (!bankAccountId) {
          throw new Error('ব্যাংক মাধ্যমে বিক্রয়ের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        bankAcc = await db.cashBankAccounts.get(bankAccountId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
      }

      const accounts = await db.accounts.toArray();

      // Ensure accounts exist
      let fishRevAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_REVENUE);
      if (!fishRevAcc) {
        const newAcc: Account = {
          id: 'acc_4010',
          code: CANONICAL_ACCOUNTS.FISH_REVENUE,
          nameBn: 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
          nameEn: 'Fish Sales Revenue',
          accountClass: 'REVENUE',
          normalBalance: 'CREDIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishRevAcc = newAcc;
      }

      let fishCogsAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_COGS);
      if (!fishCogsAcc) {
        const newAcc: Account = {
          id: 'acc_5010',
          code: CANONICAL_ACCOUNTS.FISH_COGS,
          nameBn: 'বিক্রিত মাছের উৎপাদন ব্যয় (Fish COGS)',
          nameEn: 'Fish Cost of Goods Sold',
          accountClass: 'COGS',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishCogsAcc = newAcc;
      }

      let fishMortalityAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS);
      if (!fishMortalityAcc) {
        const newAcc: Account = {
          id: 'acc_8030',
          code: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
          nameBn: 'মাছের মৃত্যুজনিত ক্ষতি (Fish Mortality Loss)',
          nameEn: 'Fish Mortality Loss',
          accountClass: 'OTHER_EXPENSE',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishMortalityAcc = newAcc;
      }

      let assetAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
      if (!assetAcc) {
        const newAcc: Account = {
          id: 'acc_1580',
          code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          nameBn: 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          nameEn: 'Livestock & Biological Assets',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      const accumulatedCost = Math.round(((freshBatch.fingerlingCost || 0) + (freshBatch.totalFeedCost || 0)) * 100) / 100;
      const totalStock = (freshBatch.fingerlingQty && freshBatch.fingerlingQty > 0)
        ? freshBatch.fingerlingQty
        : (cleanMortality > 0 ? cleanMortality : 1);
      const mortalityRatio = Math.min(1, Math.max(0, cleanMortality / totalStock));
      const mortalityCost = cleanMortality > 0 ? Math.round(accumulatedCost * mortalityRatio * 100) / 100 : 0;
      const harvestedCogs = Math.max(0, Math.round((accumulatedCost - mortalityCost) * 100) / 100);
      const paymentCode = getPaymentAccount(paymentMethod, 'SALE');

      let journalEntryId: string | undefined;
      let voucherNumber: string | undefined;
      let saleRecord: Sale | undefined;

      if (cleanPrice > 0 || accumulatedCost > 0) {
        const journalLines: JournalLine[] = [];

        // 1. Revenue recognition leg: Dr Cash/Bank/Receivable, Cr Fish Sales Revenue (4010)
        if (cleanPrice > 0) {
          journalLines.push(
            {
              accountId: paymentCode,
              accountCode: paymentCode,
              accountName:
                paymentMethod === 'CASH'
                  ? 'নগদ টাকা (Cash on Hand)'
                  : paymentMethod === 'BANK'
                  ? 'ব্যাংক হিসাব (Bank Accounts)'
                  : 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
              debit: cleanPrice,
              credit: 0,
              memo: `মাছ বিক্রয়: ${freshBatch.species} (${freshBatch.pondName})`
            },
            {
              accountId: CANONICAL_ACCOUNTS.FISH_REVENUE,
              accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE,
              accountName: fishRevAcc.nameBn || 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
              debit: 0,
              credit: cleanPrice,
              memo: `মাছ বিক্রয় রাজস্ব: ব্যাচ ${freshBatch.id} (${cleanWeight} কেজি)`
            }
          );
        }

        // 2. COGS & Mortality Loss & Biological Asset derecognition leg
        if (accumulatedCost > 0) {
          if (harvestedCogs > 0) {
            journalLines.push({
              accountId: CANONICAL_ACCOUNTS.FISH_COGS,
              accountCode: CANONICAL_ACCOUNTS.FISH_COGS,
              accountName: fishCogsAcc.nameBn || 'বিক্রিত মাছের উৎপাদন ব্যয় (Fish COGS)',
              debit: harvestedCogs,
              credit: 0,
              memo: `মাছের ব্যাচ ${freshBatch.id} আহরিত মাছের উৎপাদন ব্যয় (COGS)`
            });
          }

          if (mortalityCost > 0) {
            journalLines.push({
              accountId: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
              accountCode: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
              accountName: fishMortalityAcc.nameBn || 'মাছের মৃত্যুজনিত ক্ষতি (Fish Mortality Loss)',
              debit: mortalityCost,
              credit: 0,
              memo: `মাছের ব্যাচ ${freshBatch.id} মৃত মাছ অবলোপন (${cleanMortality} টি)`
            });
          }

          journalLines.push({
            accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: 0,
            credit: accumulatedCost,
            memo: `মাছের ব্যাচ ${freshBatch.id} আহরণ ও অবলোপন বাবদ পুঞ্জীভূত উৎপাদন খরচ হিসাব সমন্বয়`
          });
        }

        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('মাছ আহরণ ও বিক্রয় জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        voucherNumber = generateTransactionNumber('SLF');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_fish_sale'),
            voucherNumber,
            voucherType: 'SALES',
            date: dateStr,
            narration: `মাছ আহরণ ও বিক্রয়: ${freshBatch.species} (${freshBatch.pondName}) - ওজন: ${cleanWeight} কেজি, বিক্রয়মূল্য: ৳${cleanPrice}, পুঞ্জীভূত খরচ: ৳${accumulatedCost}`,
            reference: freshBatch.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Cash/Bank ledger update
        if (cleanPrice > 0) {
          if (paymentMethod === 'BANK' && bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance + cleanPrice) * 100) / 100,
              synced: false
            });
          } else if (paymentMethod === 'CASH') {
            const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
            if (cashAcc) {
              await db.cashBankAccounts.update(cashAcc.id, {
                currentBalance: Math.round((cashAcc.currentBalance + cleanPrice) * 100) / 100,
                synced: false
              });
            }
          }

          const fishDisplayNumber = await generateDisplayNumber('SAL', dateStr);
          saleRecord = {
            id: generateUniqueId('sal'),
            invoiceNumber: generateTransactionNumber('SAL'),
            displayNumber: fishDisplayNumber,
            date: dateStr,
            customerId: 'WALK_IN_CUSTOMER',
            customerName: customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)',
            category: 'FISH',
            items: [
              {
                itemId: freshBatch.id,
                itemName: `মাছ বিক্রয়: ${freshBatch.species} (${freshBatch.pondName})`,
                quantity: cleanWeight,
                unit: 'কেজি',
                unitPrice: cleanWeight > 0 ? Math.round((cleanPrice / cleanWeight) * 100) / 100 : cleanPrice,
                lineTotal: cleanPrice,
                cogsAmount: harvestedCogs
              }
            ],
            subtotal: cleanPrice,
            totalAmount: cleanPrice,
            grandTotal: cleanPrice,
            paidAmount: paymentMethod === 'CREDIT' ? 0 : cleanPrice,
            dueAmount: paymentMethod === 'CREDIT' ? cleanPrice : 0,
            paymentMethod,
            bankAccountId: paymentMethod === 'BANK' ? bankAccountId : undefined,
            journalEntryId,
            status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
            synced: false
          };
          await safeInsert(db.sales, saleRecord, { idPrefix: 'sal' });
        }
      }

      // Update FishBatch record
      freshBatch.harvestWeightKg = cleanWeight;
      freshBatch.mortalityCount = cleanMortality;
      freshBatch.harvestRevenue = cleanPrice;
      freshBatch.harvestDate = dateStr;
      freshBatch.status = 'HARVESTED';
      if (notes) {
        freshBatch.notes = freshBatch.notes ? `${freshBatch.notes} | ${notes.trim()}` : notes.trim();
      }
      freshBatch.synced = false;
      await db.fishBatches.put(freshBatch);

      // Audit Log
      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'UPDATE',
          module: 'PRODUCTION',
          recordId: freshBatch.id,
          status: 'SUCCESS',
          details: `মাছ আহরণ ও বিক্রয় সম্পন্ন: ব্যাচ ${freshBatch.id}, ওজন ${cleanWeight} কেজি, বিক্রয় ৳${cleanPrice}, COGS ৳${harvestedCogs}${mortalityCost > 0 ? `, মৃত্যুজনিত ক্ষতি ৳${mortalityCost}` : ''}`
        },
        { idPrefix: 'aud' }
      );

      return {
        updatedBatch: freshBatch,
        sale: saleRecord,
        journalEntryId,
        voucherNumber
      };
    }
  );
}

/**
 * Atomic Execution of Crop Cycle Harvest and Sale
 * - Records harvest yield (kg) and actual harvest date
 * - Posts Revenue leg: Debit Cash/Bank/Receivable, Credit Crop Sales Revenue (4040)
 * - Posts Cost leg: Debit Crop COGS (5030), Credit Biological Assets (1580) for accumulated costs
 * - Marks CropCycle status as HARVESTED
 */
export interface CropHarvestSaleParams {
  cycleId: string;
  harvestYieldKg: number;
  salePrice: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  customerName?: string;
  date?: string;
  notes?: string;
  currentUserId: string;
}

export async function executeCropHarvestAndSaleTransaction(
  params: CropHarvestSaleParams
): Promise<{ updatedCycle: CropCycle; sale?: Sale; journalEntryId?: string; voucherNumber?: string }> {
  return await db.transaction(
    'rw',
    [
      db.cropCycles,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.sales,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        cycleId,
        harvestYieldKg,
        salePrice,
        paymentMethod,
        bankAccountId,
        customerName,
        date,
        notes,
        currentUserId
      } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`কর্তন ও বিক্রয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const closedPeriod = await db.closedPeriods
        .filter((p) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const freshCycle = await db.cropCycles.get(cycleId);
      if (!freshCycle) {
        throw new Error(`শস্য চক্র পাওয়া যায়নি (ID: ${cycleId})।`);
      }
      if (freshCycle.status === 'HARVESTED') {
        throw new Error(`এই শস্য চক্রটি (${freshCycle.id}) ইতিমধ্যে কর্তন ও বিক্রয় সম্পন্ন হয়েছে।`);
      }

      const cleanYield = Math.max(0, Number(harvestYieldKg) || 0);
      const cleanPrice = Math.max(0, Math.round((Number(salePrice) || 0) * 100) / 100);

      // Validate payment source if BANK
      let bankAcc: CashBankAccount | undefined;
      if (paymentMethod === 'BANK' && cleanPrice > 0) {
        if (!bankAccountId) {
          throw new Error('ব্যাংক মাধ্যমে বিক্রয়ের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        bankAcc = await db.cashBankAccounts.get(bankAccountId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
      }

      const accounts = await db.accounts.toArray();

      // Ensure accounts exist
      let cropRevAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.CROP_REVENUE);
      if (!cropRevAcc) {
        const newAcc: Account = {
          id: 'acc_4040',
          code: CANONICAL_ACCOUNTS.CROP_REVENUE,
          nameBn: 'ফসল বিক্রয় আয় (Crop Sales Revenue)',
          nameEn: 'Crop Sales Revenue',
          accountClass: 'REVENUE',
          normalBalance: 'CREDIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        cropRevAcc = newAcc;
      }

      let cropCogsAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.CROP_COGS);
      if (!cropCogsAcc) {
        const newAcc: Account = {
          id: 'acc_5030',
          code: CANONICAL_ACCOUNTS.CROP_COGS,
          nameBn: 'বিক্রিত ফসলের উৎপাদন ব্যয় (Crop COGS)',
          nameEn: 'Crop Cost of Goods Sold',
          accountClass: 'COGS',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        cropCogsAcc = newAcc;
      }

      let assetAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
      if (!assetAcc) {
        const newAcc: Account = {
          id: 'acc_1580',
          code: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          nameBn: 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          nameEn: 'Livestock & Biological Assets',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      const costSum =
        (freshCycle.seedCost || 0) +
        (freshCycle.fertilizerCost || 0) +
        (freshCycle.irrigationCost || 0) +
        (freshCycle.labourCost || 0) +
        (freshCycle.otherCost || 0);
      const accumulatedCost = Math.round((costSum > 0 ? costSum : (freshCycle.totalCost || 0)) * 100) / 100;
      const paymentCode = getPaymentAccount(paymentMethod, 'SALE');

      let journalEntryId: string | undefined;
      let voucherNumber: string | undefined;
      let saleRecord: Sale | undefined;

      if (cleanPrice > 0 || accumulatedCost > 0) {
        const journalLines: JournalLine[] = [];

        // 1. Revenue recognition leg
        if (cleanPrice > 0) {
          journalLines.push(
            {
              accountId: paymentCode,
              accountCode: paymentCode,
              accountName:
                paymentMethod === 'CASH'
                  ? 'নগদ টাকা (Cash on Hand)'
                  : paymentMethod === 'BANK'
                  ? 'ব্যাংক হিসাব (Bank Accounts)'
                  : 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
              debit: cleanPrice,
              credit: 0,
              memo: `শস্য/ঘাস কর্তন ও বিক্রয়: ${freshCycle.cropName} (${freshCycle.plotName})`
            },
            {
              accountId: CANONICAL_ACCOUNTS.CROP_REVENUE,
              accountCode: CANONICAL_ACCOUNTS.CROP_REVENUE,
              accountName: cropRevAcc.nameBn || 'ফসল বিক্রয় আয় (Crop Sales Revenue)',
              debit: 0,
              credit: cleanPrice,
              memo: `ফসল বিক্রয় রাজস্ব: চক্র ${freshCycle.id} (${cleanYield} কেজি)`
            }
          );
        }

        // 2. COGS & Biological Asset derecognition leg (seedCost + fertilizerCost + irrigationCost + labourCost)
        if (accumulatedCost > 0) {
          journalLines.push(
            {
              accountId: CANONICAL_ACCOUNTS.CROP_COGS,
              accountCode: CANONICAL_ACCOUNTS.CROP_COGS,
              accountName: cropCogsAcc.nameBn || 'বিক্রিত ফসলের উৎপাদন ব্যয় (Crop COGS)',
              debit: accumulatedCost,
              credit: 0,
              memo: `শস্য চক্র ${freshCycle.id} মোট পুঞ্জীভূত চাষ খরচ (COGS)`
            },
            {
              accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
              accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
              debit: 0,
              credit: accumulatedCost,
              memo: `শস্য চক্র ${freshCycle.id} বিক্রয় বাবদ জৈবিক সম্পদ হিসাব সমন্বয়`
            }
          );
        }

        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('ফসল কর্তন ও বিক্রয় জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        voucherNumber = generateTransactionNumber('SLC');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_crop_sale'),
            voucherNumber,
            voucherType: 'SALES',
            date: dateStr,
            narration: `ফসল কর্তন ও বিক্রয়: ${freshCycle.cropName} (${freshCycle.plotName}) - ফলন: ${cleanYield} কেজি, বিক্রয়মূল্য: ৳${cleanPrice}, পুঞ্জীভূত খরচ: ৳${accumulatedCost}`,
            reference: freshCycle.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Cash/Bank ledger update
        if (cleanPrice > 0) {
          if (paymentMethod === 'BANK' && bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance + cleanPrice) * 100) / 100,
              synced: false
            });
          } else if (paymentMethod === 'CASH') {
            const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
            if (cashAcc) {
              await db.cashBankAccounts.update(cashAcc.id, {
                currentBalance: Math.round((cashAcc.currentBalance + cleanPrice) * 100) / 100,
                synced: false
              });
            }
          }

          const cropDisplayNumber = await generateDisplayNumber('SAL', dateStr);
          saleRecord = {
            id: generateUniqueId('sal'),
            invoiceNumber: generateTransactionNumber('SAL'),
            displayNumber: cropDisplayNumber,
            date: dateStr,
            customerId: 'WALK_IN_CUSTOMER',
            customerName: customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)',
            category: 'CROP',
            items: [
              {
                itemId: freshCycle.id,
                itemName: `শস্য/ঘাস বিক্রয়: ${freshCycle.cropName} (${freshCycle.plotName})`,
                quantity: cleanYield,
                unit: 'কেজি',
                unitPrice: cleanYield > 0 ? Math.round((cleanPrice / cleanYield) * 100) / 100 : cleanPrice,
                lineTotal: cleanPrice,
                cogsAmount: accumulatedCost
              }
            ],
            subtotal: cleanPrice,
            totalAmount: cleanPrice,
            grandTotal: cleanPrice,
            paidAmount: paymentMethod === 'CREDIT' ? 0 : cleanPrice,
            dueAmount: paymentMethod === 'CREDIT' ? cleanPrice : 0,
            paymentMethod,
            bankAccountId: paymentMethod === 'BANK' ? bankAccountId : undefined,
            journalEntryId,
            status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
            synced: false
          };
          await safeInsert(db.sales, saleRecord, { idPrefix: 'sal' });
        }
      }

      // Update CropCycle record
      freshCycle.harvestYieldKg = cleanYield;
      freshCycle.harvestRevenue = cleanPrice;
      freshCycle.actualHarvestDate = dateStr;
      freshCycle.status = 'HARVESTED';
      freshCycle.synced = false;
      await db.cropCycles.put(freshCycle);

      // Audit Log
      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'UPDATE',
          module: 'PRODUCTION',
          recordId: freshCycle.id,
          status: 'SUCCESS',
          details: `ফসল কর্তন ও বিক্রয় সম্পন্ন: চক্র ${freshCycle.id}, ফলন ${cleanYield} কেজি, বিক্রয় ৳${cleanPrice}, COGS ৳${accumulatedCost}`
        },
        { idPrefix: 'aud' }
      );

      return {
        updatedCycle: freshCycle,
        sale: saleRecord,
        journalEntryId,
        voucherNumber
      };
    }
  );
}
