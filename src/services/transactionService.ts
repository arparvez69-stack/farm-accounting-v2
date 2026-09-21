import { db } from '../db/indexedDb';
import {
  CANONICAL_ACCOUNTS,
  INVENTORY_CATEGORY_ACCOUNT_MAP,
  getPaymentAccount,
  getCashBankAccountGLCode,
  getInventoryAssetAccount,
  getInventoryAccountDetails,
  getRevenueAndCogsAccounts,
  getLoanLiabilityAccount,
  getInvestorCapitalAccount,
  getInvestorProfitPayableAccount,
  getProfitDistributionAccount
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
  JournalEntry,
  JournalLine,
  Animal,
  AnimalCostBreakdown,
  AnimalEvent,
  AnimalStatus,
  FishBatch,
  CropCycle,
  CropCostBreakdown,
  CropProductionCostParams,
  StockMovement,
  PaymentRecord
} from '../types';
import { generateAmortizationSchedule } from '../accounting/amortizationService';

/**
 * Atomic Execution of Sales Invoice Transaction
 */
export async function executeSaleTransaction(
  params: {
    customer: Party;
    item: InventoryItem;
    quantity: number;
    unitPrice: number;
    discount?: number;
    paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
    bankAccountId?: string;
    currentUserId: string;
    date?: string;
  },
  dbInstance: any = db
): Promise<{ sale: Sale; journalEntryId: string }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.sales,
      dbInstance.inventoryItems,
      dbInstance.stockMovements,
      dbInstance.parties,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const { customer, item, quantity, unitPrice, discount = 0, paymentMethod, bankAccountId, currentUserId, date } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`বিক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      // Re-fetch fresh item state inside transaction
      const freshItem = await dbInstance.inventoryItems.get(item.id);
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

      const accounts = await dbInstance.accounts.toArray();
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
            accountName: accounts.find((a) => a.code === inventoryAssetCode)?.nameBn || getInventoryAccountDetails(freshItem.category).nameBn,
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
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

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
      await safeInsert(dbInstance.sales, saleRecord, { idPrefix: 'sal' });

      // 3. Deduct Inventory Stock
      await dbInstance.inventoryItems.update(freshItem.id, {
        currentStock: Math.round((freshItem.currentStock - quantity) * 100) / 100,
        synced: false
      });

      // 4. Record StockMovement for SALE
      const stockMovement: StockMovement = {
        id: generateUniqueId('sm_sal'),
        date: dateStr,
        itemId: freshItem.id,
        movementType: 'SALE',
        quantity,
        unitCost: freshItem.avgCostPrice || unitPrice,
        totalValue: totalCogs || Math.round(quantity * (freshItem.avgCostPrice || unitPrice) * 100) / 100,
        referenceId: invoiceNumber,
        notes: `বিক্রয় চালান ${invoiceNumber}: ${customer.name} কে ${quantity} ${freshItem.unit} ${freshItem.nameBn} বিক্রয়`,
        synced: false
      };
      await safeInsert(dbInstance.stockMovements, stockMovement, { idPrefix: 'sm' });

      // 5. Update Customer AR balance if credit sale
      if (paymentMethod === 'CREDIT') {
        const freshCustomer = await dbInstance.parties.get(customer.id);
        if (freshCustomer) {
          await dbInstance.parties.update(customer.id, {
            balance: Math.round(((freshCustomer.balance || 0) + totalAmount) * 100) / 100
          });
        }
      }

      // 6. Update Operational Cash / Bank balance consistently with GL
      if (paymentMethod === 'CASH') {
        const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await dbInstance.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance + totalAmount) * 100) / 100
          });
        }
      } else if (paymentMethod === 'BANK') {
        let bankAcc: CashBankAccount | undefined;
        if (bankAccountId) {
          bankAcc = await dbInstance.cashBankAccounts.get(bankAccountId);
        }
        if (!bankAcc) {
          bankAcc = await dbInstance.cashBankAccounts.where('accountType').equals('BANK').first();
        }
        if (bankAcc) {
          await dbInstance.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance + totalAmount) * 100) / 100
          });
        }
      }

      // 7. Record Audit Log
      await safeInsert(dbInstance.auditLogs, {
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
export async function executePurchaseTransaction(
  params: {
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
  },
  dbInstance: any = db
): Promise<{ purchase: Purchase; journalEntryId: string }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.purchases,
      dbInstance.inventoryItems,
      dbInstance.stockMovements,
      dbInstance.parties,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const { supplier, item, quantity, unitPrice, transportCost = 0, discount = 0, paymentMethod, bankAccountId, currentUserId, date } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`ক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const freshItem = await dbInstance.inventoryItems.get(item.id);
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

      const accounts = await dbInstance.accounts.toArray();
      const invAccName = accounts.find((a: any) => a.code === inventoryAssetCode)?.nameBn || getInventoryAccountDetails(freshItem.category).nameBn;
      const journalLines: JournalLine[] = [
        {
          accountId: inventoryAssetCode,
          accountCode: inventoryAssetCode,
          accountName: invAccName,
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
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

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
      await safeInsert(dbInstance.purchases, purchaseRecord, { idPrefix: 'pur' });

      // 3. Update stock and weighted average cost price
      const newStock = Math.round((freshItem.currentStock + quantity) * 100) / 100;
      const prevTotalCost = (freshItem.currentStock || 0) * (freshItem.avgCostPrice || 0);
      const newAvgCost = newStock > 0 ? Math.round(((prevTotalCost + grandTotal) / newStock) * 100) / 100 : unitPrice;

      await dbInstance.inventoryItems.update(freshItem.id, {
        currentStock: newStock,
        avgCostPrice: newAvgCost,
        lastRestockAmount: quantity,
        synced: false
      });

      // 4. Record StockMovement for PURCHASE
      const stockMovement: StockMovement = {
        id: generateUniqueId('sm_pur'),
        date: dateStr,
        itemId: freshItem.id,
        movementType: 'PURCHASE',
        quantity,
        unitCost: unitPrice,
        totalValue: grandTotal,
        referenceId: invoiceNumber,
        notes: `ক্রয় চালান ${invoiceNumber}: ${supplier.name} থেকে ${quantity} ${freshItem.unit} ${freshItem.nameBn} ক্রয়`,
        synced: false
      };
      await safeInsert(dbInstance.stockMovements, stockMovement, { idPrefix: 'sm' });

      // 5. Update Supplier AP balance if credit purchase
      if (paymentMethod === 'CREDIT') {
        const freshSupplier = await dbInstance.parties.get(supplier.id);
        if (freshSupplier) {
          await dbInstance.parties.update(supplier.id, {
            balance: Math.round(((freshSupplier.balance || 0) + grandTotal) * 100) / 100
          });
        }
      }

      // 6. Update Operational Cash / Bank balance consistently with GL
      if (paymentMethod === 'CASH') {
        const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await dbInstance.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance - grandTotal) * 100) / 100
          });
        }
      } else if (paymentMethod === 'BANK') {
        let bankAcc: CashBankAccount | undefined;
        if (bankAccountId) {
          bankAcc = await dbInstance.cashBankAccounts.get(bankAccountId);
        }
        if (!bankAcc) {
          bankAcc = await dbInstance.cashBankAccounts.where('accountType').equals('BANK').first();
        }
        if (bankAcc) {
          await dbInstance.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance - grandTotal) * 100) / 100
          });
        }
      }

      // 7. Record Audit Log
      await safeInsert(dbInstance.auditLogs, {
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
/**
 * Atomic Execution of Investor Capital Contribution (Sleeping Partner Model)
 * - Capital is NOT revenue: Credits 3020 Investor Capital (Equity)
 * - Debits 1010 Cash or 1030 Bank (Asset)
 * - Stores agreed profit sharing ratio
 * - No interest or amortization schedule
 */
export async function executeInvestorTransaction(
  params: {
    investorId?: string;
    investorName: string;
    contribution: number;
    profitShare?: number;
    profitSharingRatio?: number;
    targetAccountId: string;
    currentUserId: string;
    phone?: string;
    annualInterestRatePercent?: number; // legacy ignored in non-interest model
    termMonths?: number; // legacy ignored in non-interest model
    date?: string;
    notes?: string;
  },
  dbInstance: any = db
): Promise<{ investor: Investor; journalEntryId: string }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.investors,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const {
        investorId,
        investorName,
        contribution,
        profitShare = 0,
        profitSharingRatio,
        targetAccountId,
        currentUserId,
        phone,
        date,
        notes
      } = params;

      if (contribution <= 0) {
        throw new Error('Contribution amount must be strictly greater than 0.');
      }

      const dateStr = date || new Date().toISOString().split('T')[0];

      // Closed period validation
      if (dbInstance.closedPeriods) {
        const closedPeriods = await dbInstance.closedPeriods.toArray();
        const isClosed = closedPeriods.some((cp: any) => cp.endDate >= dateStr);
        if (isClosed) {
          throw new Error(`সীমাবদ্ধতা: ${dateStr} তারিখটি ইতোমধ্যে বন্ধ হিসাবকালের (Closed Period) অন্তর্ভুক্ত।`);
        }
      }

      let targetAcc = await dbInstance.cashBankAccounts.get(targetAccountId);
      if (!targetAcc) {
        targetAcc = await dbInstance.cashBankAccounts.where('accountType').equals(targetAccountId).first();
      }
      if (!targetAcc) {
        targetAcc = await dbInstance.cashBankAccounts.toCollection?.().first?.();
      }
      if (!targetAcc) {
        targetAcc = (await dbInstance.cashBankAccounts.toArray())[0];
      }
      if (!targetAcc) {
        throw new Error(`Target cash/bank account ${targetAccountId} not found.`);
      }

      const invId = investorId || generateUniqueId('inv');
      const invRef = generateTransactionNumber('INV');

      // Canonical GL Mapping:
      // Dr Cash (1010) or Bank (1030)
      // Cr 3020 Investor Capital (Equity - NEVER 4000 Revenue and NEVER 3010 Owner Capital!)
      const assetGlCode = getCashBankAccountGLCode(targetAcc.accountType);
      const equityGlCode = getInvestorCapitalAccount(); // 3020

      const accounts = await dbInstance.accounts.toArray();
      const assetAcc = accounts.find((a: any) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: targetAcc.accountName || targetAcc.name || 'ব্যাংক/নগদ তহবিল',
        accountClass: 'ASSET',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === assetGlCode)) {
        accounts.push(assetAcc);
      }

      const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
        id: `acc_${equityGlCode}`,
        code: equityGlCode,
        nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
        accountClass: 'EQUITY',
        normalBalance: 'CREDIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === equityGlCode)) {
        accounts.push(equityAcc);
      }

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
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      // 2. Fetch or initialize investor record
      const existingInvestor = investorId ? await dbInstance.investors.get(investorId) : undefined;
      const agreedRatio = profitSharingRatio !== undefined ? profitSharingRatio : profitShare;
      const workingRatio = Math.max(0, 100 - agreedRatio);

      const totalContributed = Math.round(((existingInvestor?.capitalContributed || existingInvestor?.capitalAmount || 0) + contribution) * 100) / 100;
      const existingReturned = existingInvestor?.totalCapitalReturned || 0;
      const currentCapBalance = Math.max(0, totalContributed - existingReturned);

      const investorRecord: Investor = {
        id: invId,
        name: investorName.trim(),
        phone: phone?.trim() || existingInvestor?.phone || undefined,
        capitalAmount: totalContributed,
        initialCapital: existingInvestor?.initialCapital ?? contribution,
        capitalContributed: totalContributed,
        totalContribution: totalContributed,
        currentCapitalBalance: currentCapBalance,
        totalWithdrawals: existingInvestor?.totalWithdrawals || 0,
        drawings: existingInvestor?.drawings || 0,
        totalCapitalReturned: existingReturned,
        currentBalance: currentCapBalance,
        currentEquityBalance: currentCapBalance,
        profitSharingRatio: agreedRatio,
        profitSharePercentage: agreedRatio,
        sharePercentage: agreedRatio,
        workingPartnerShareRatio: workingRatio,
        totalProfitAllocated: existingInvestor?.totalProfitAllocated || 0,
        profitPayable: existingInvestor?.profitPayable || 0,
        totalProfitPaid: existingInvestor?.totalProfitPaid || 0,
        joinedDate: existingInvestor?.joinedDate || dateStr,
        entryDate: existingInvestor?.entryDate || dateStr,
        status: 'ACTIVE',
        notes: notes || existingInvestor?.notes,
        synced: false
      };

      if (existingInvestor) {
        await dbInstance.investors.put(investorRecord);
      } else {
        await safeInsert(dbInstance.investors, investorRecord, { idPrefix: 'inv' });
      }

      // 3. Update target account operational balance
      await dbInstance.cashBankAccounts.update(targetAcc.id, {
        currentBalance: Math.round(((targetAcc.currentBalance || 0) + contribution) * 100) / 100
      });

      // 4. Audit Log
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_CONTRIBUTION',
        module: 'FINANCE',
        recordId: invRef,
        status: 'SUCCESS',
        details: `বিনিয়োগকারী ${investorName} এর মূলধন জমা (৳${contribution}) - অংশীদারি অনুপাত ${agreedRatio}%`
      });

      return { investor: investorRecord, journalEntryId: journalEntry.id };
    }
  );
}

/**
 * Atomic Execution of Actual Profit Allocation to Investor (Sleeping Partner)
 * Required flow: Finalized profit → allocation → investor payable → actual payment
 * - Profit must be calculated from finalized actual distributable profit.
 * - Formula: Profit * Investor% (e.g. ৳200,000 * 40% = ৳80,000; Working partner = 60%).
 * - Never calculate profit from investment capital.
 * - Never guarantee profit (rejects profit <= 0).
 * - No interest.
 * - Do not charge investor profit as normal operating expense.
 * - Allocation GL:
 *     Dr Profit Distribution (3070 / appropriate equity account)
 *     Cr Investor Profit Payable (2050)
 * - Prevents duplicate allocation.
 * - Respects closed periods.
 */
export async function executeInvestorProfitAllocationTransaction(
  params: {
    investorId: string;
    finalizedDistributableProfit?: number; // Finalized actual distributable profit of the farm
    actualBusinessProfit?: number; // Alias for backwards compatibility
    allocatedProfit?: number; // Direct agreed share of actual profit
    closedPeriodId?: string; // Optional: Link to a closed period
    allocationDate?: string;
    allocationReference?: string;
    idempotencyKey?: string;
    notes?: string;
    currentUserId: string;
  },
  dbInstance: any = db
): Promise<{
  investor: Investor;
  journalEntryId: string;
  allocatedProfit: number;
  finalizedProfit: number;
  workingPartnerShare: number;
  profitSharingRatio: number;
  workingPartnerRatio: number;
}> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.investors,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const {
        investorId,
        finalizedDistributableProfit,
        actualBusinessProfit,
        allocatedProfit,
        closedPeriodId,
        allocationDate,
        allocationReference,
        idempotencyKey,
        notes,
        currentUserId
      } = params;
      const dateStr = allocationDate || new Date().toISOString().split('T')[0];

      // 1. Closed period validation - respect closed periods
      if (dbInstance.closedPeriods) {
        const closedPeriods = await dbInstance.closedPeriods.toArray();
        const isClosed = closedPeriods.some((cp: any) => cp.endDate >= dateStr);
        if (isClosed) {
          throw new Error(`সীমাবদ্ধতা: ${dateStr} তারিখটি ইতোমধ্যে বন্ধ হিসাবকালের (Closed Period) অন্তর্ভুক্ত। বন্ধ হিসাবকালে নতুন বণ্টন দাখিলা দেওয়া যাবে না।`);
        }
      }

      // 2. Prevent duplicate allocation
      const allEntries = await dbInstance.journalEntries.toArray();
      const isDuplicate = allEntries.some((j: any) => {
        if (idempotencyKey && (j.reference === idempotencyKey || j.idempotencyKey === idempotencyKey)) return true;
        if (allocationReference && j.reference === allocationReference) return true;
        if (closedPeriodId && j.relatedClosedPeriodId === closedPeriodId && j.relatedInvestorId === investorId) return true;
        return false;
      });
      if (isDuplicate) {
        throw new Error('এই হিসাবকাল বা রেফারেন্সের জন্য লভ্যাংশ বণ্টন ইতোমধ্যে সম্পন্ন হয়েছে (Duplicate profit allocation prevented)।');
      }

      // 3. Fetch investor
      const investor = await dbInstance.investors.get(investorId);
      if (!investor) {
        throw new Error(`বিনিয়োগকারী পাওয়া যায়নি (Investor not found: ${investorId})।`);
      }

      const ratio = investor.profitSharingRatio ?? investor.profitSharePercentage ?? investor.sharePercentage ?? 0;
      if (ratio <= 0) {
        throw new Error(`বিনিয়োগকারী ${investor.name} এর কোনো নির্ধারিত লভ্যাংশ বণ্টন অনুপাত নেই (Profit sharing ratio must be > 0)।`);
      }
      const workingRatio = investor.workingPartnerShareRatio ?? Math.max(0, 100 - ratio);

      // 4. Determine finalized actual distributable profit
      let effectiveFinalizedProfit = 0;
      if (closedPeriodId) {
        const closedPeriod = await dbInstance.closedPeriods.get(closedPeriodId);
        if (!closedPeriod) {
          throw new Error(`হিসাবকাল পাওয়া যায়নি (Closed period not found: ${closedPeriodId})।`);
        }
        effectiveFinalizedProfit = Number(closedPeriod.netProfitTransferred) || 0;
      } else if (finalizedDistributableProfit !== undefined) {
        effectiveFinalizedProfit = Number(finalizedDistributableProfit) || 0;
      } else if (actualBusinessProfit !== undefined) {
        effectiveFinalizedProfit = Number(actualBusinessProfit) || 0;
      }

      // 5. Calculate profit amount (Never calculate from capital, never guarantee profit)
      let profitAmount: number;
      if (allocatedProfit !== undefined) {
        profitAmount = Math.round(allocatedProfit * 100) / 100;
      } else {
        if (effectiveFinalizedProfit <= 0) {
          throw new Error(
            `চূড়ান্ত বণ্টনযোগ্য প্রকৃত মুনাফা অবশ্যই ০ এর বেশি হতে হবে (Finalized distributable profit must be > 0: ৳${effectiveFinalizedProfit})। কোনো প্রকৃত মুনাফা অর্জিত না হলে বা লোকসান হলে লভ্যাংশ বণ্টন সম্ভব নয় (Never guarantee profit)।`
          );
        }
        // Calculated strictly from finalized actual profit, NEVER from capital
        profitAmount = Math.round(effectiveFinalizedProfit * (ratio / 100) * 100) / 100;
      }

      if (profitAmount <= 0) {
        throw new Error('বণ্টনযোগ্য লভ্যাংশের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Allocated profit must be strictly > 0)।');
      }

      const workingPartnerProfit = effectiveFinalizedProfit > 0
        ? Math.round(effectiveFinalizedProfit * (workingRatio / 100) * 100) / 100
        : 0;

      // 6. Canonical GL Mapping:
      // Profit distribution is NOT an operating expense!
      // Dr 3070 Profit Distribution (or 3050 Retained Earnings)
      // Cr 2050 Investor Profit Payable
      const distGlCode = getProfitDistributionAccount(); // '3070'
      const payableGlCode = getInvestorProfitPayableAccount(); // '2050'

      const accounts = await dbInstance.accounts.toArray();
      const distAcc = accounts.find((a: any) => a.code === distGlCode) || {
        id: `acc_${distGlCode}`,
        code: distGlCode,
        nameBn: 'মুনাফা বণ্টন / লভ্যাংশ (Profit Distribution)',
        accountClass: 'EQUITY',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === distGlCode)) {
        accounts.push(distAcc);
      }

      const payableAcc = accounts.find((a: any) => a.code === payableGlCode) || {
        id: `acc_${payableGlCode}`,
        code: payableGlCode,
        nameBn: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয় (Investor Profit Payable)',
        accountClass: 'LIABILITY',
        normalBalance: 'CREDIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === payableGlCode)) {
        accounts.push(payableAcc);
      }

      const journalLines: JournalLine[] = [
        {
          accountId: distAcc.id,
          accountCode: distGlCode,
          accountName: distAcc.nameBn,
          debit: profitAmount,
          credit: 0,
          memo: `${investor.name} এর মুনাফা বণ্টন (${ratio}% অব ৳${effectiveFinalizedProfit || profitAmount})`
        },
        {
          accountId: payableAcc.id,
          accountCode: payableGlCode,
          accountName: payableAcc.nameBn,
          debit: 0,
          credit: profitAmount,
          memo: `বিনিয়োগকারীর প্রদেয় লভ্যাংশ সঞ্চিতি`
        }
      ];

      const refNumber = allocationReference || idempotencyKey || generateTransactionNumber('INV-DIST');
      const voucherNumber = generateTransactionNumber('INV-DIST-V');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_inv_dist'),
          voucherNumber,
          voucherType: 'JOURNAL',
          date: dateStr,
          narration: `চূড়ান্ত প্রকৃত মুনাফা বণ্টন: ${investor.name} (${ratio}%) ৳${profitAmount} (মোট মুনাফা: ৳${effectiveFinalizedProfit || profitAmount})`,
          reference: refNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      // Attach metadata for duplicate prevention
      if (closedPeriodId) {
        (journalEntry as any).relatedClosedPeriodId = closedPeriodId;
      }
      (journalEntry as any).relatedInvestorId = investorId;
      if (idempotencyKey) {
        (journalEntry as any).idempotencyKey = idempotencyKey;
      }

      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      // 7. Update investor state
      const updatedInvestor: Investor = {
        ...investor,
        totalProfitAllocated: Math.round(((investor.totalProfitAllocated || 0) + profitAmount) * 100) / 100,
        profitPayable: Math.round(((investor.profitPayable || 0) + profitAmount) * 100) / 100,
        lastProfitAllocationDate: dateStr,
        notes: notes ? (investor.notes ? `${investor.notes}\n${notes}` : notes) : investor.notes,
        synced: false
      };
      await dbInstance.investors.put(updatedInvestor);

      // 8. Audit Log
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_PROFIT_ALLOCATION',
        module: 'FINANCE',
        recordId: investor.id,
        status: 'SUCCESS',
        details: `বিনিয়োগকারী ${investor.name} এর লভ্যাংশ বণ্টন ৳${profitAmount} (চূড়ান্ত মুনাফা ৳${effectiveFinalizedProfit}, অনুপাত ${ratio}%)`
      });

      return {
        investor: updatedInvestor,
        journalEntryId: journalEntry.id,
        allocatedProfit: profitAmount,
        finalizedProfit: effectiveFinalizedProfit,
        workingPartnerShare: workingPartnerProfit,
        profitSharingRatio: ratio,
        workingPartnerRatio: workingRatio
      };
    }
  );
}

/**
 * Atomic Execution of Investor Profit Payment (Disbursement of Payable Profit)
 * Required flow: Finalized profit → allocation → investor payable → actual payment
 * - Debits 2050 Investor Profit Payable (Liability reduction)
 * - Credits 1010 Cash or 1030 Bank (Asset reduction)
 * - Settles investor.profitPayable without touching operating expense.
 * - Do not pay more than allocated (amount <= investor.profitPayable).
 * - Prevents duplicate payment.
 * - Respects closed periods.
 */
export async function executeInvestorProfitPaymentTransaction(
  params: {
    investorId: string;
    amount: number;
    sourceAccountId: string;
    paymentDate?: string;
    paymentReference?: string;
    idempotencyKey?: string;
    notes?: string;
    currentUserId: string;
  },
  dbInstance: any = db
): Promise<{ investor: Investor; journalEntryId: string; paidAmount: number; remainingPayable: number }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.investors,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const { investorId, amount, sourceAccountId, paymentDate, paymentReference, idempotencyKey, notes, currentUserId } = params;
      const dateStr = paymentDate || new Date().toISOString().split('T')[0];

      if (amount <= 0) {
        throw new Error('পরিশোধের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Payment amount must be > 0).');
      }

      // 1. Closed period validation - respect closed periods
      if (dbInstance.closedPeriods) {
        const closedPeriods = await dbInstance.closedPeriods.toArray();
        const isClosed = closedPeriods.some((cp: any) => cp.endDate >= dateStr);
        if (isClosed) {
          throw new Error(`সীমাবদ্ধতা: ${dateStr} তারিখটি ইতোমধ্যে বন্ধ হিসাবকালের (Closed Period) অন্তর্ভুক্ত। বন্ধ হিসাবকালে নতুন পরিশোধ দাখিলা দেওয়া যাবে না।`);
        }
      }

      // 2. Prevent duplicate payment
      const allEntries = await dbInstance.journalEntries.toArray();
      const isDuplicate = allEntries.some((j: any) => {
        if (idempotencyKey && (j.reference === idempotencyKey || j.idempotencyKey === idempotencyKey)) return true;
        if (paymentReference && j.reference === paymentReference) return true;
        return false;
      });
      if (isDuplicate) {
        throw new Error('এই ভাউচার বা রেফারেন্সের জন্য লভ্যাংশ পরিশোধ ইতোমধ্যে সম্পন্ন হয়েছে (Duplicate profit payment prevented)।');
      }

      // 3. Investor validation & Payable checks
      const investor = await dbInstance.investors.get(investorId);
      if (!investor) {
        throw new Error(`বিনিয়োগকারী পাওয়া যায়নি (Investor not found: ${investorId})।`);
      }

      const currentPayable = investor.profitPayable || 0;
      if (currentPayable <= 0) {
        throw new Error(`এই বিনিয়োগকারীর কোনো বকেয়া বা প্রদেয় লভ্যাংশ নেই (No profit payable to disburse: ৳${currentPayable})।`);
      }
      if (amount > currentPayable) {
        throw new Error(
          `পাওনা লভ্যাংশের চেয়ে বেশি পরিশোধ করা সম্ভব নয়। বর্তমান প্রদেয় লভ্যাংশ: ৳${currentPayable}, পরিশোধের আবেদন: ৳${amount}।`
        );
      }

      // 4. Source Account check
      let sourceAcc = await dbInstance.cashBankAccounts.get(sourceAccountId);
      if (!sourceAcc) {
        sourceAcc = await dbInstance.cashBankAccounts.where('accountType').equals(sourceAccountId).first();
      }
      if (!sourceAcc) {
        sourceAcc = (await dbInstance.cashBankAccounts.toArray())[0];
      }
      if (!sourceAcc) {
        throw new Error(`Source cash/bank account ${sourceAccountId} not found.`);
      }

      // 5. Canonical GL accounts
      // Payment is NOT an operating expense!
      // Dr 2050 Investor Profit Payable (Liability reduction)
      // Cr 1010 Cash or 1030 Bank (Asset reduction)
      const assetGlCode = getCashBankAccountGLCode(sourceAcc.accountType);
      const payableGlCode = getInvestorProfitPayableAccount(); // '2050'

      const accounts = await dbInstance.accounts.toArray();
      const assetAcc = accounts.find((a: any) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: sourceAcc.accountName || sourceAcc.name || 'ব্যাংক/নগদ তহবিল',
        accountClass: 'ASSET',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === assetGlCode)) {
        accounts.push(assetAcc);
      }

      const payableAcc = accounts.find((a: any) => a.code === payableGlCode) || {
        id: `acc_${payableGlCode}`,
        code: payableGlCode,
        nameBn: 'বিনিয়োগকারীর লভ্যাংশ প্রদেয় (Investor Profit Payable)',
        accountClass: 'LIABILITY',
        normalBalance: 'CREDIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === payableGlCode)) {
        accounts.push(payableAcc);
      }

      const journalLines: JournalLine[] = [
        {
          accountId: payableAcc.id,
          accountCode: payableGlCode,
          accountName: payableAcc.nameBn,
          debit: amount,
          credit: 0,
          memo: `${investor.name} কে লভ্যাংশ প্রদান`
        },
        {
          accountId: assetAcc.id,
          accountCode: assetGlCode,
          accountName: sourceAcc.accountName || sourceAcc.name || assetAcc.nameBn,
          debit: 0,
          credit: amount,
          memo: `লভ্যাংশ পরিশোধ বাবদ তহবিল হ্রাস`
        }
      ];

      const refNumber = paymentReference || idempotencyKey || generateTransactionNumber('INV-PAY');
      const voucherNumber = generateTransactionNumber('INV-PAY-V');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_inv_pay'),
          voucherNumber,
          voucherType: 'PAYMENT',
          date: dateStr,
          narration: `বিনিয়োগকারীর লভ্যাংশ পরিশোধ: ${investor.name} কে প্রদান ৳${amount}`,
          reference: refNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      (journalEntry as any).relatedInvestorId = investorId;
      if (idempotencyKey) {
        (journalEntry as any).idempotencyKey = idempotencyKey;
      }

      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      // 6. Update source cash/bank operational balance
      await dbInstance.cashBankAccounts.update(sourceAcc.id, {
        currentBalance: Math.round(((sourceAcc.currentBalance || 0) - amount) * 100) / 100
      });

      // 7. Update investor state
      const remaining = Math.round(Math.max(0, currentPayable - amount) * 100) / 100;
      const updatedInvestor: Investor = {
        ...investor,
        totalProfitPaid: Math.round(((investor.totalProfitPaid || 0) + amount) * 100) / 100,
        profitPayable: remaining,
        lastProfitPaymentDate: dateStr,
        notes: notes ? (investor.notes ? `${investor.notes}\n${notes}` : notes) : investor.notes,
        synced: false
      };
      await dbInstance.investors.put(updatedInvestor);

      // 8. Audit Log
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_PROFIT_PAYMENT',
        module: 'FINANCE',
        recordId: investor.id,
        status: 'SUCCESS',
        details: `বিনিয়োগকারী ${investor.name} কে লভ্যাংশ পরিশোধ ৳${amount} (অবশিষ্ট প্রদেয়: ৳${remaining})`
      });

      return {
        investor: updatedInvestor,
        journalEntryId: journalEntry.id,
        paidAmount: amount,
        remainingPayable: remaining
      };
    }
  );
}

/**
 * Atomic Execution of Investor Capital Return (Reduction / Exit)
 * - Capital return is NOT operating expense:
 * - Debits 3020 Investor Capital (Equity reduction)
 * - Credits 1010 Cash or 1030 Bank (Asset reduction)
 * - Reduces investor.currentCapitalBalance and tracks totalCapitalReturned
 */
export async function executeInvestorCapitalReturnTransaction(
  params: {
    investorId: string;
    amount: number;
    sourceAccountId: string;
    returnDate?: string;
    notes?: string;
    currentUserId: string;
  },
  dbInstance: any = db
): Promise<{ investor: Investor; journalEntryId: string; returnedAmount: number }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.journalEntries,
      dbInstance.investors,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const { investorId, amount, sourceAccountId, returnDate, notes, currentUserId } = params;
      const dateStr = returnDate || new Date().toISOString().split('T')[0];

      if (amount <= 0) {
        throw new Error('মূলধন ফেরতের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে (Return amount must be > 0).');
      }

      // Closed period validation
      if (dbInstance.closedPeriods) {
        const closedPeriods = await dbInstance.closedPeriods.toArray();
        const isClosed = closedPeriods.some((cp: any) => cp.endDate >= dateStr);
        if (isClosed) {
          throw new Error(`সীমাবদ্ধতা: ${dateStr} তারিখটি ইতোমধ্যে বন্ধ হিসাবকালের (Closed Period) অন্তর্ভুক্ত।`);
        }
      }

      const investor = await dbInstance.investors.get(investorId);
      if (!investor) {
        throw new Error(`বিনিয়োগকারী পাওয়া যায়নি (Investor not found: ${investorId})।`);
      }

      const currentCapital = investor.currentCapitalBalance ?? investor.capitalAmount ?? 0;
      if (amount > currentCapital) {
        throw new Error(
          `মূলধন ফেরতের পরিমাণ বিদ্যমান মূলধনের চেয়ে বেশি হতে পারে না। বর্তমান মূলধন স্থিতি: ৳${currentCapital}, ফেরত আবেদন: ৳${amount}।`
        );
      }

      let sourceAcc = await dbInstance.cashBankAccounts.get(sourceAccountId);
      if (!sourceAcc) {
        sourceAcc = await dbInstance.cashBankAccounts.where('accountType').equals(sourceAccountId).first();
      }
      if (!sourceAcc) {
        sourceAcc = (await dbInstance.cashBankAccounts.toArray())[0];
      }
      if (!sourceAcc) {
        throw new Error(`Source cash/bank account ${sourceAccountId} not found.`);
      }

      const assetGlCode = getCashBankAccountGLCode(sourceAcc.accountType);
      const equityGlCode = getInvestorCapitalAccount(); // '3020'

      const accounts = await dbInstance.accounts.toArray();
      const assetAcc = accounts.find((a: any) => a.code === assetGlCode) || {
        id: `acc_${assetGlCode}`,
        code: assetGlCode,
        nameBn: sourceAcc.accountName || sourceAcc.name || 'ব্যাংক/নগদ তহবিল',
        accountClass: 'ASSET',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === assetGlCode)) {
        accounts.push(assetAcc);
      }

      const equityAcc = accounts.find((a: any) => a.code === equityGlCode) || {
        id: `acc_${equityGlCode}`,
        code: equityGlCode,
        nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
        accountClass: 'EQUITY',
        normalBalance: 'CREDIT',
        isSystem: true,
        isActive: true
      };
      if (!accounts.some((a: any) => a.code === equityGlCode)) {
        accounts.push(equityAcc);
      }

      const journalLines: JournalLine[] = [
        {
          accountId: equityAcc.id,
          accountCode: equityGlCode,
          accountName: equityAcc.nameBn,
          debit: amount,
          credit: 0,
          memo: `${investor.name} এর মূলধন ফেরত`
        },
        {
          accountId: assetAcc.id,
          accountCode: assetGlCode,
          accountName: sourceAcc.accountName || sourceAcc.name || assetAcc.nameBn,
          debit: 0,
          credit: amount,
          memo: `মূলধন ফেরত বাবদ তহবিল হ্রাস`
        }
      ];

      const voucherNumber = generateTransactionNumber('INV-RET-V');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_inv_ret'),
          voucherNumber,
          voucherType: 'PAYMENT',
          date: dateStr,
          narration: `বিনিয়োগকারীর মূলধন ফেরত: ${investor.name} কে ফেরত ৳${amount}`,
          reference: generateTransactionNumber('INV-RET'),
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );

      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      // Update source cash/bank operational balance
      await dbInstance.cashBankAccounts.update(sourceAcc.id, {
        currentBalance: Math.round(((sourceAcc.currentBalance || 0) - amount) * 100) / 100
      });

      const newCapBalance = Math.round(Math.max(0, currentCapital - amount) * 100) / 100;
      const totalReturned = Math.round(((investor.totalCapitalReturned || 0) + amount) * 100) / 100;

      // Update investor state
      const updatedInvestor: Investor = {
        ...investor,
        totalCapitalReturned: totalReturned,
        currentCapitalBalance: newCapBalance,
        currentBalance: newCapBalance,
        currentEquityBalance: newCapBalance,
        drawings: Math.round(((investor.drawings || 0) + amount) * 100) / 100,
        totalWithdrawals: Math.round(((investor.totalWithdrawals || 0) + amount) * 100) / 100,
        lastCapitalReturnDate: dateStr,
        status: newCapBalance === 0 && (investor.profitPayable || 0) === 0 ? 'EXITED' : investor.status,
        notes: notes ? (investor.notes ? `${investor.notes}\n${notes}` : notes) : investor.notes,
        synced: false
      };
      await dbInstance.investors.put(updatedInvestor);

      // Audit Log
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'INVESTOR_CAPITAL_RETURN',
        module: 'FINANCE',
        recordId: investor.id,
        status: 'SUCCESS',
        details: `বিনিয়োগকারী ${investor.name} কে মূলধন ফেরত ৳${amount} (অবশিষ্ট মূলধন: ৳${newCapBalance})`
      });

      return { investor: updatedInvestor, journalEntryId: journalEntry.id, returnedAmount: amount };
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

      const freshAnimalForEvent = (await db.animals.get(animal.id)) || animal;

      if (freshAnimalForEvent.status === 'DECEASED') {
        throw new Error(`গবাদিপশু ${freshAnimalForEvent.id} ইতিপূর্বে মৃত ঘোষণা করা হয়েছে। পুনরায় মৃত্যু বা কার্যক্রম দাখিলা তৈরি করা নিষিদ্ধ।`);
      }
      if (['SOLD', 'TRANSFERRED', 'STOLEN'].includes(freshAnimalForEvent.status)) {
        throw new Error(`অপসারণকৃত বা বিক্রিত পশুর (${freshAnimalForEvent.id} - ${freshAnimalForEvent.status}) নতুন কার্যক্রম বা ব্যয় সংরক্ষণ করা যাবে না।`);
      }

      // TASK 10: Livestock Mortality Event Handling
      if (event.eventType === 'MORTALITY') {
        const pastEntries = await db.journalEntries
          .filter((j) => j.reference === freshAnimalForEvent.id || (Boolean(j.narration) && j.narration.includes(freshAnimalForEvent.id)))
          .toArray();

        let alreadyWrittenOff = 0;
        for (const entry of pastEntries) {
          for (const line of entry.lines || []) {
            const isForThis = line.memo ? line.memo.includes(freshAnimalForEvent.id) : (entry.reference === freshAnimalForEvent.id);
            if (!isForThis) continue;
            if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF || line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS || line.accountCode === '8020') {
              alreadyWrittenOff += (line.debit || 0) - (line.credit || 0);
            }
          }
        }
        if (alreadyWrittenOff > 0) {
          throw new Error(`গবাদিপশু ${freshAnimalForEvent.id} এর জন্য ইতিপূর্বে ৳${alreadyWrittenOff} মৃত্যুজনিত অবলোপন দাখিলা সম্পন্ন হয়েছে। পুনরায় ডুপ্লিকেট মৃত্যু দাখিলা নিষিদ্ধ।`);
        }

        const costBreakdown = calculateAnimalRecordedCosts(freshAnimalForEvent);
        const costToDerecognize = costBreakdown.totalRecordedCost;

        // Verify GL debits to prevent unbacked/invented loss
        let glAssetDebit1580 = 0;
        let glExpenseDebit = 0;
        for (const entry of pastEntries) {
          for (const line of entry.lines || []) {
            const isForThis = line.memo ? line.memo.includes(freshAnimalForEvent.id) : (entry.reference === freshAnimalForEvent.id);
            if (!isForThis) continue;
            if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
              glAssetDebit1580 += (line.debit || 0) - (line.credit || 0);
            } else if (
              line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
              line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
              line.accountCode === CANONICAL_ACCOUNTS.VACCINATION ||
              line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
              line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
            ) {
              glExpenseDebit += (line.debit || 0) - (line.credit || 0);
            }
          }
        }

        const totalAvailableInGl = Math.max(0, Math.round((glAssetDebit1580 + glExpenseDebit) * 100) / 100);
        if (costToDerecognize > totalAvailableInGl) {
          const unbackedAmount = Math.round((costToDerecognize - totalAvailableInGl) * 100) / 100;
          throw new Error(
            `গবাদিপশু ${freshAnimalForEvent.id} এর মৃত্যুজনিত অবলোপন ব্যয়ে অমিল রয়েছে: মোট অপারেশনাল ব্যয় ৳${costToDerecognize}, কিন্তু সংশ্লিষ্ট অনুমোদিত জাবেদা ব্যালেন্স পাওয়া গেছে মাত্র ৳${totalAvailableInGl} (অননুমোদিত বা হিসাবহীন ঘাটতি: ৳${unbackedAmount})। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রকৃত লেনদেন নথিভুক্ত করুন।`
          );
        }

        let mortalityJournalId: string | undefined;
        if (costToDerecognize > 0) {
          const accounts = await db.accounts.toArray();
          let writeOffAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS || a.code === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF);
          if (!writeOffAcc) {
            writeOffAcc = {
              id: `acc_${CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS}`,
              code: CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS,
              nameBn: 'পশুসম্পদ অবলোপন ও মৃত্যুজনিত ক্ষতি (Livestock Write-off & Mortality Loss)',
              nameEn: 'Livestock Write-off & Mortality Loss',
              accountClass: 'OTHER_EXPENSE',
              normalBalance: 'DEBIT',
              isSystem: true,
              isActive: true
            };
            await safeInsert(db.accounts, writeOffAcc);
          }

          const creditLines = await buildLivestockCostCreditLines(freshAnimalForEvent, costToDerecognize, accounts);
          const writeOffJournalLines: JournalLine[] = [
            {
              accountId: writeOffAcc.id,
              accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS,
              accountName: writeOffAcc.nameBn || 'পশুসম্পদ অবলোপন ও মৃত্যুজনিত ক্ষতি (Livestock Write-off & Mortality Loss)',
              debit: costToDerecognize,
              credit: 0,
              memo: `পশু মৃত্যুজনিত ক্ষতি (Mortality Loss): ${freshAnimalForEvent.id} (${freshAnimalForEvent.breed}) পুঞ্জীভূত ব্যয়`
            },
            ...creditLines
          ];

          const balanceCheck = validateBalancedLines(writeOffJournalLines, accounts);
          if (!balanceCheck.isBalanced) {
            throw new Error(`মৃত্যুজনিত অবলোপন জাবেদা অসন্তুলিত: ডেবিট ৳${balanceCheck.totalDebit}, ক্রেডিট ৳${balanceCheck.totalCredit}। দাখিলা বাতিল করা হলো।`);
          }

          const voucherNumber = generateTransactionNumber('ADJ');
          const writeOffEntry = await postJournalEntry(
            {
              id: generateUniqueId('je'),
              date: event.date,
              voucherType: 'ADJUSTMENT',
              voucherNumber,
              reference: freshAnimalForEvent.id,
              narration: `গবাদিপশু মৃত্যুজনিত ক্ষতি ও অবলোপন (MORTALITY): ${freshAnimalForEvent.id} (${freshAnimalForEvent.breed}) মৃত্যু বাবদ পুঞ্জীভূত ব্যয় অবলোপন (পুঞ্জীভূত মোট ব্যয়: ৳${costToDerecognize})${event.details ? ` [${event.details}]` : ''}`,
              lines: writeOffJournalLines,
              createdBy: currentUserId,
              createdAt: new Date().toISOString()
            },
            { accounts, skipDbPut: true }
          );
          await safeInsert(db.journalEntries, writeOffEntry, { idPrefix: 'je' });
          mortalityJournalId = writeOffEntry.id;
        }

        const eventId = generateUniqueId('evt');
        const eventRecord: AnimalEvent = {
          id: eventId,
          animalId: freshAnimalForEvent.id,
          eventType: 'MORTALITY',
          date: event.date,
          cost: 0, // Mortality is derecognition, NOT an added expense
          details: event.details || 'মৃত্যুজনিত ক্ষতি ও অবলোপন সম্পন্ন',
          synced: false
        };
        await safeInsert(db.animalEvents, eventRecord);

        const noteAddition = event.details
          ? `[DECEASED - ${event.date}: ${event.details}]`
          : `[DECEASED - ${event.date}]`;
        const combinedNotes = freshAnimalForEvent.notes ? `${freshAnimalForEvent.notes} | ${noteAddition}` : noteAddition;

        await db.animals.update(freshAnimalForEvent.id, {
          status: 'DECEASED',
          notes: combinedNotes,
          journalEntryId: mortalityJournalId || freshAnimalForEvent.journalEntryId,
          salePrice: undefined,
          saleDate: undefined,
          synced: false
        });

        await safeInsert(db.auditLogs, {
          id: generateUniqueId('audit'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'ANIMAL_MORTALITY',
          module: 'LIVESTOCK',
          recordId: freshAnimalForEvent.id,
          status: 'SUCCESS',
          details: `${freshAnimalForEvent.id} (${freshAnimalForEvent.breed}) মৃত্যুজনিত অবলোপন সম্পন্ন (পুঞ্জীভূত ক্ষতি: ৳${costToDerecognize})`
        });

        return { event: eventRecord, journalEntryId: mortalityJournalId };
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
          } else if ((event.eventType as string) === 'LABOUR') {
            expenseCode = CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES; // 6020
            expenseName = 'খামার শ্রমিক মজুরি (Farm Labour Wages)';
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
      // Legitimate accumulated raising costs: Purchase, Feed, Medicine/veterinary, Labour, Other
      const freshAnimal = (await db.animals.get(animal.id)) || animal;
      const isLabour = (event.eventType as string) === 'LABOUR';
      const newFeed = (freshAnimal.accumulatedFeedCost || 0) + (event.eventType === 'FEED' ? cost : 0);
      const newMed = (freshAnimal.accumulatedMedCost || 0) + (event.eventType === 'VACCINE' || event.eventType === 'TREATMENT' ? cost : 0);
      const newLabour = (freshAnimal.accumulatedLabourCost || 0) + (isLabour ? cost : 0);
      const newOther = (freshAnimal.otherCosts || 0) + (!isLabour && event.eventType !== 'FEED' && event.eventType !== 'VACCINE' && event.eventType !== 'TREATMENT' ? cost : 0);
      const newTotal = (freshAnimal.purchaseCost || 0) + newFeed + newMed + newLabour + newOther;

      const animalUpdates: Partial<Animal> = {
        accumulatedFeedCost: Math.round(newFeed * 100) / 100,
        accumulatedMedCost: Math.round(newMed * 100) / 100,
        accumulatedLabourCost: Math.round(newLabour * 100) / 100,
        otherCosts: Math.round(newOther * 100) / 100,
        totalCost: Math.round(newTotal * 100) / 100,
        synced: false
      };

      if (event.eventType === 'WEIGHT' && event.weightKg && event.weightKg > 0) {
        animalUpdates.currentWeightKg = event.weightKg;
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
 * Calculate legitimate accumulated recorded raising costs for a livestock animal.
 * Production costs include:
 * - Purchase (capitalized asset cost)
 * - Feed (accumulated feed costs)
 * - Medicine / Veterinary (accumulated medicine & vaccine costs)
 * - Labour (accumulated labour & wages)
 * - Other production costs
 */
export function calculateAnimalRecordedCosts(animal: Animal): AnimalCostBreakdown {
  const purchaseCost = Math.max(0, Number(animal.purchaseCost) || Number((animal as any).purchasePrice) || 0);
  const feedCost = Math.max(0, Number(animal.accumulatedFeedCost) || Number((animal as any).feedCost) || 0);
  const medicineCost = Math.max(0, Number(animal.accumulatedMedCost) || Number((animal as any).medicineCost) || 0);
  const labourCost = Math.max(0, Number(animal.accumulatedLabourCost) || Number((animal as any).labourCost) || 0);
  const otherCost = Math.max(0, Number(animal.otherCosts) || Number((animal as any).otherCost) || 0);

  const sumComponents = Math.round(
    (purchaseCost + feedCost + medicineCost + labourCost + otherCost) * 100
  ) / 100;
  const totalCostField = Math.max(0, Number(animal.totalCost) || 0);
  const totalRecordedCost = sumComponents > 0 ? sumComponents : Math.round(totalCostField * 100) / 100;

  return {
    purchaseCost,
    feedCost,
    medicineCost,
    labourCost,
    otherCost,
    totalRecordedCost
  };
}

/**
 * Builds balanced credit lines for livestock cost derecognition upon sale or write-off.
 * Reconciles the animal's accumulated costs with accounting without double-counting:
 * 1. Credits Livestock Assets (1580) for the capitalized portion (purchase cost or existing net 1580 debit).
 * 2. Credits the corresponding expense accounts (Feed 6010, Vet/Med 6040, Labour 6020, Misc 6090)
 *    so accumulated raising expenses already in GL are reconciled into COGS (5020) without double counting!
 */
export async function buildLivestockCostCreditLines(
  freshAnimal: Animal,
  amountToCredit: number,
  accounts: Account[],
  dbInstance: any = db
): Promise<JournalLine[]> {
  const breakdown = calculateAnimalRecordedCosts(freshAnimal);
  let remaining = Math.round(amountToCredit * 100) / 100;
  const creditLines: JournalLine[] = [];

  // Check how much net debit is currently in Livestock Assets (1580) or expense accounts for this animal
  let netAssetDebit1580 = 0;
  const glExpenseMap = new Map<string, number>();
  let hasQueriedGl = false;

  try {
    const animalEntries = await dbInstance.journalEntries
      .filter((j: any) => j.reference === freshAnimal.id || (Boolean(j.narration) && j.narration.includes(freshAnimal.id)))
      .toArray();

    if (animalEntries && animalEntries.length > 0) {
      hasQueriedGl = true;
      for (const entry of animalEntries) {
        for (const line of entry.lines || []) {
          const isForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
          if (!isForThisAnimal) continue;

          if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
            netAssetDebit1580 += (line.debit || 0) - (line.credit || 0);
          } else if (
            line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            line.accountCode === CANONICAL_ACCOUNTS.VACCINATION ||
            line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const prev = glExpenseMap.get(line.accountCode) || 0;
            glExpenseMap.set(line.accountCode, prev + (line.debit || 0) - (line.credit || 0));
          }
        }
      }
    }
  } catch {
    // If query unavailable (e.g. testing in-memory without Dexie storage), safely fall back to recorded breakdown
  }

  // Capitalized portion to derecognize from Livestock Assets (1580)
  // When GL entries exist, derecognize up to existing 1580 net debit
  // In pure unit testing fallback (no GL entries), derecognize up to purchaseCost
  const assetPortion = Math.min(
    remaining,
    Math.max(0, hasQueriedGl ? netAssetDebit1580 : breakdown.purchaseCost)
  );

  if (assetPortion > 0) {
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
      await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
      accounts.push(newAcc);
      livestockAssetAcc = newAcc;
    }

    creditLines.push({
      accountId: livestockAssetAcc.id,
      accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
      accountName: livestockAssetAcc.nameBn || 'পশুসম্পদ (Livestock & Biological Assets)',
      debit: 0,
      credit: assetPortion,
      memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) বিক্রয় বাবদ সম্পদ হিসাব সমন্বয়`
    });

    remaining = Math.round((remaining - assetPortion) * 100) / 100;
  }

  // If raising costs remain, credit original expense accounts to avoid double-counting in P&L
  // Never create negative/false expense balances and never invent artificial credits
  if (remaining > 0) {
    const expenseDefs = [
      {
        code: CANONICAL_ACCOUNTS.FEED_EXPENSE, // 6010
        nameBn: 'খাদ্য ক্রয় খরচ (Feed Expense)',
        nameEn: 'Feed Expense',
        breakdownAmt: breakdown.feedCost,
        glAmt: glExpenseMap.get(CANONICAL_ACCOUNTS.FEED_EXPENSE) || 0,
        label: 'খাদ্য ব্যয় সমন্বয়'
      },
      {
        code: CANONICAL_ACCOUNTS.VACCINATION, // 6050
        nameBn: 'টিকা প্রদান খরচ (Vaccination Expense)',
        nameEn: 'Vaccination Expense',
        breakdownAmt: 0,
        glAmt: glExpenseMap.get(CANONICAL_ACCOUNTS.VACCINATION) || 0,
        label: 'টিকা ব্যয় সমন্বয়'
      },
      {
        code: CANONICAL_ACCOUNTS.VET_MEDICINE, // 6040
        nameBn: 'চিকিৎসা ও ওষুধ (Veterinary & Medicine)',
        nameEn: 'Veterinary & Medicine',
        breakdownAmt: breakdown.medicineCost,
        glAmt: glExpenseMap.get(CANONICAL_ACCOUNTS.VET_MEDICINE) || 0,
        label: 'চিকিৎসা/ওষুধ ব্যয় সমন্বয়'
      },
      {
        code: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES, // 6020
        nameBn: 'খামার শ্রমিক মজুরি (Farm Labour Wages)',
        nameEn: 'Farm Labour Wages',
        breakdownAmt: breakdown.labourCost,
        glAmt: glExpenseMap.get(CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES) || 0,
        label: 'শ্রমিক মজুরি সমন্বয়'
      },
      {
        code: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, // 6090
        nameBn: 'বিবিধ পরিচালন ব্যয় (Miscellaneous Expense)',
        nameEn: 'Miscellaneous Expense',
        breakdownAmt: breakdown.otherCost,
        glAmt: glExpenseMap.get(CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE) || 0,
        label: 'অন্যান্য উৎপাদন ব্যয় সমন্বয়'
      }
    ];

    for (const def of expenseDefs) {
      if (remaining <= 0) break;
      // When GL entries were found, only credit up to verified GL debit to avoid negative balances
      // In pure unit test fallback, allocate up to recorded breakdown amount
      const targetAmt = hasQueriedGl ? def.glAmt : def.breakdownAmt;
      if (targetAmt > 0) {
        const allocAmt = Math.min(remaining, targetAmt);
        if (allocAmt > 0) {
          let expAcc = accounts.find((a) => a.code === def.code);
          if (!expAcc) {
            const newAcc: Account = {
              id: `acc_${def.code}`,
              code: def.code,
              nameBn: def.nameBn,
              nameEn: def.nameEn,
              accountClass: 'EXPENSE',
              normalBalance: 'DEBIT',
              isSystem: true,
              isActive: true
            };
            await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
            accounts.push(newAcc);
            expAcc = newAcc;
          }

          creditLines.push({
            accountId: expAcc.id,
            accountCode: def.code,
            accountName: expAcc.nameBn || def.nameBn,
            debit: 0,
            credit: allocAmt,
            memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}): বিক্রিত পশুর উৎপাদন ব্যয় COGS এ সমন্বয় (${def.label})`
          });

          remaining = Math.round((remaining - allocAmt) * 100) / 100;
        }
      }
    }
  }

  // If unallocated amount still remains, do NOT invent an artificial credit to Miscellaneous Expense or Cash
  if (remaining > 0) {
    throw new Error(
      `গবাদিপশু ${freshAnimal.id} এর পুঞ্জীভূত ব্যয় (৳${amountToCredit}) এবং অনুমোদিত হিসাব ব্যালেন্সের মাঝে ৳${remaining} এর অমিল রয়েছে। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ।`
    );
  }

  return creditLines;
}

/**
 * Helper to build balanced credit lines against original expense accounts for livestock cost reclassification.
 * Never creates negative expense balances; only credits accounts up to their verified GL debit amount.
 */
export async function buildLivestockExpenseCreditLines(
  freshAnimal: Animal,
  amountToCredit: number,
  accounts: Account[],
  expenseAccountsMap?: Map<string, number>,
  dbInstance: any = db
): Promise<JournalLine[]> {
  let remaining = Math.round(amountToCredit * 100) / 100;
  const creditLines: JournalLine[] = [];
  const breakdown = calculateAnimalRecordedCosts(freshAnimal);

  if (expenseAccountsMap && expenseAccountsMap.size > 0) {
    for (const [accCode, netAmount] of expenseAccountsMap.entries()) {
      if (remaining <= 0) break;
      if (netAmount > 0) {
        const allocAmt = Math.min(remaining, netAmount);
        let expAcc = accounts.find((a) => a.code === accCode);
        if (!expAcc) {
          expAcc = {
            id: `acc_${accCode}`,
            code: accCode,
            nameBn: 'পরিচালন ব্যয়',
            nameEn: 'Operating Expense',
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(dbInstance.accounts, expAcc, { idPrefix: 'acc' });
          accounts.push(expAcc);
        }

        creditLines.push({
          accountId: expAcc.id,
          accountCode: accCode,
          accountName: expAcc.nameBn || 'পরিচালন ব্যয়',
          debit: 0,
          credit: allocAmt,
          memo: `পশু ${freshAnimal.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় জৈবিক সম্পদে সমন্বয়`
        });
        remaining = Math.round((remaining - allocAmt) * 100) / 100;
      }
    }
  } else {
    const components = [
      { code: CANONICAL_ACCOUNTS.FEED_EXPENSE, amount: breakdown.feedCost, label: 'খাদ্য ব্যয়' },
      { code: CANONICAL_ACCOUNTS.VET_MEDICINE, amount: breakdown.medicineCost, label: 'চিকিৎসা ও ওষুধ' },
      { code: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES, amount: breakdown.labourCost, label: 'শ্রমিক মজুরি' },
      { code: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, amount: breakdown.otherCost, label: 'অন্যান্য ব্যয়' }
    ];

    for (const comp of components) {
      if (remaining <= 0) break;
      if (comp.amount > 0) {
        const allocAmt = Math.min(remaining, comp.amount);
        let expAcc = accounts.find((a) => a.code === comp.code);
        if (!expAcc) {
          expAcc = {
            id: `acc_${comp.code}`,
            code: comp.code,
            nameBn: comp.label,
            nameEn: comp.label,
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(dbInstance.accounts, expAcc, { idPrefix: 'acc' });
          accounts.push(expAcc);
        }

        creditLines.push({
          accountId: expAcc.id,
          accountCode: comp.code,
          accountName: expAcc.nameBn || comp.label,
          debit: 0,
          credit: allocAmt,
          memo: `পশু ${freshAnimal.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় সম্পদে সমন্বয় (${comp.label})`
        });
        remaining = Math.round((remaining - allocAmt) * 100) / 100;
      }
    }
  }

  return creditLines;
}

/**
 * Reclassify existing expense transactions for a specific Livestock animal to Biological Assets (1580).
 * Dr Livestock & Biological Assets (1580) / Cr Original Expense (6010, 6040, 6020, 6090), NEVER Cash or Bank.
 * Strictly prevents artificial cash credits, negative expense balances, or double-counting.
 */
export async function reclassifyLivestockExpenseToBiologicalAsset(
  animalId: string,
  currentUserId: string = 'system-user',
  dbInstance: any = db
): Promise<{ journalEntryId?: string; voucherNumber?: string; reclassifiedAmount: number }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.animals,
      dbInstance.journalEntries,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const freshAnimal = await dbInstance.animals.get(animalId);
      if (!freshAnimal) {
        throw new Error(`গবাদিপশু পাওয়া যায়নি (ID: ${animalId})।`);
      }

      if (['SOLD', 'DECEASED', 'TRANSFERRED', 'STOLEN'].includes(freshAnimal.status)) {
        throw new Error(`বিক্রিত বা অপসারণকৃত গবাদিপশু (${freshAnimal.id} - ${freshAnimal.status}) এর ব্যয় জৈবিক সম্পদে স্থানান্তর করা যাবে না।`);
      }

      const existingEntries = await dbInstance.journalEntries
        .filter(
          (j: any) =>
            j.reference === freshAnimal.id ||
            (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(freshAnimal.id)))
        )
        .toArray();

      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          const isLineForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
          if (!isLineForThisAnimal) continue;

          const code = line.accountCode;
          if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.VACCINATION ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      expensedDebit = Math.max(0, Math.round(expensedDebit * 100) / 100);
      if (expensedDebit <= 0) {
        return { reclassifiedAmount: 0 };
      }

      const accounts = await dbInstance.accounts.toArray();
      let assetAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      const creditLines = await buildLivestockExpenseCreditLines(freshAnimal, expensedDebit, accounts, expenseAccountsMap, dbInstance);

      const journalLines: JournalLine[] = [
        {
          accountId: assetAcc.id,
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          debit: expensedDebit,
          credit: 0,
          memo: `[RECLASSIFICATION] [${freshAnimal.id}] পশু পালন ব্যয় জৈবিক সম্পদে রূপান্তর: ${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id})`
        },
        ...creditLines
      ];

      const balanceCheck = validateBalancedLines(journalLines, accounts);
      if (!balanceCheck.isBalanced) {
        throw new Error('পশুসম্পদ ব্যয় সমন্বয় জাবেদা ভারসাম্যহীন!');
      }

      const dateStr = freshAnimal.purchaseDate || new Date().toISOString().split('T')[0];
      const voucherNumber = generateTransactionNumber('JV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_live_asset'),
          voucherNumber,
          voucherType: 'JOURNAL',
          date: dateStr,
          narration: `পশু পালন ব্যয় সমন্বয় (Asset Reclassification): পশু ${freshAnimal.id} (${freshAnimal.breed}) - ৳${expensedDebit}`,
          reference: freshAnimal.id,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      return {
        journalEntryId: journalEntry.id,
        voucherNumber,
        reclassifiedAmount: expensedDebit
      };
    }
  );
}

/**
 * Integrate legitimate recorded production costs on an Animal into accounting Biological Assets (1580).
 * Checks General Ledger strictly by animal ID to verify whether costs have already been capitalized to 1580
 * or transferred to COGS/Write-off. Any reclassification of previously paid and expensed costs debits Livestock Assets (1580)
 * and credits the original Expense accounts (Dr Livestock Assets / Cr original Expense) — NEVER crediting Cash/Bank,
 * preventing artificial cash credits, negative expense balances, or duplicate costs.
 * If an operational cost exists with no source GL transaction, it rejects the capitalization.
 */
export async function integrateLivestockProductionCostAccounting(
  animalId: string,
  currentUserId: string = 'system-user',
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT' = 'CASH'
): Promise<{ journalEntryId?: string; voucherNumber?: string; integratedAmount: number }> {
  return await db.transaction(
    'rw',
    [
      db.animals,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const freshAnimal = await db.animals.get(animalId);
      if (!freshAnimal) {
        throw new Error(`গবাদিপশু পাওয়া যায়নি (ID: ${animalId})।`);
      }

      if (['SOLD', 'DECEASED', 'TRANSFERRED', 'STOLEN'].includes(freshAnimal.status)) {
        throw new Error(`বিক্রিত বা অপসারণকৃত গবাদিপশু (${freshAnimal.id} - ${freshAnimal.status}) এর ব্যয় সম্পদে স্থানান্তর বা সমন্বয় করা যাবে না।`);
      }

      const recordedCosts = calculateAnimalRecordedCosts(freshAnimal);
      const totalRecordedCost = recordedCosts.totalRecordedCost;
      if (totalRecordedCost <= 0) {
        return { integratedAmount: 0 };
      }

      const existingEntries = await db.journalEntries
        .filter(
          (j) =>
            j.reference === freshAnimal.id ||
            (j.lines && j.lines.some((l) => l.memo && l.memo.includes(freshAnimal.id)))
        )
        .toArray();

      let alreadyCapitalizedAsset = 0;
      let alreadyTransferredCogs = 0;
      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          const isLineForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
          if (!isLineForThisAnimal) continue;

          const code = line.accountCode;
          if (code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS || code === CANONICAL_ACCOUNTS.WIP) {
            alreadyCapitalizedAsset += (line.debit || 0) - (line.credit || 0);
          } else if (code === CANONICAL_ACCOUNTS.LIVESTOCK_COGS || code === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF) {
            alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
          } else if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.VACCINATION ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      alreadyCapitalizedAsset = Math.max(0, Math.round(alreadyCapitalizedAsset * 100) / 100);
      alreadyTransferredCogs = Math.max(0, Math.round(alreadyTransferredCogs * 100) / 100);

      const missingAsset = Math.max(
        0,
        Math.round((totalRecordedCost - (alreadyCapitalizedAsset + alreadyTransferredCogs)) * 100) / 100
      );

      if (missingAsset <= 0) {
        return { integratedAmount: 0 };
      }

      const accounts = await db.accounts.toArray();
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

      // Reclassify previously paid and expensed costs into Livestock Assets (1580): Dr Livestock Assets / Cr original Expense (NEVER Cash/Bank)
      if (expenseAccountsMap && expenseAccountsMap.size > 0 && expensedDebit > 0) {
        const reclassAmt = Math.min(missingAsset, expensedDebit);
        const creditLines = await buildLivestockExpenseCreditLines(freshAnimal, reclassAmt, accounts, expenseAccountsMap);

        const journalLines: JournalLine[] = [
          {
            accountId: assetAcc.id,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: reclassAmt,
            credit: 0,
            memo: `[RECLASSIFICATION] [${freshAnimal.id}] পশু পালন ব্যয় সম্পদে সমন্বয়: ${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id})`
          },
          ...creditLines
        ];

        const balanceCheck = validateBalancedLines(journalLines, accounts);
        if (!balanceCheck.isBalanced) {
          throw new Error('পশুসম্পদ সম্পদ হিসাবভুক্তকরণ জাবেদা ভারসাম্যহীন!');
        }

        const dateStr = freshAnimal.purchaseDate || new Date().toISOString().split('T')[0];
        const voucherNumber = generateTransactionNumber('JV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_live_asset'),
            voucherNumber,
            voucherType: 'JOURNAL',
            date: dateStr,
            narration: `পশু পালন ব্যয় সমন্বয় (Asset Reclassification): পশু ${freshAnimal.id} (${freshAnimal.breed}) - ৳${reclassAmt}`,
            reference: freshAnimal.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

        const remainingMissing = Math.round((missingAsset - reclassAmt) * 100) / 100;
        if (remainingMissing > 0) {
          throw new Error(
            `গবাদিপশু ${freshAnimal.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এবং অনুমোদিত জাবেদা ব্যালেন্সের মাঝে ৳${remainingMissing} এর অমিল রয়েছে। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
          );
        }

        return {
          journalEntryId: journalEntry.id,
          voucherNumber,
          integratedAmount: reclassAmt
        };
      }

      // If no legitimate source expense entries exist to reclassify, do NOT invent entries from operational totals!
      throw new Error(
        `গবাদিপশু ${freshAnimal.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এর বিপরীতে কোনো উৎস হিসাব লেনদেন পাওয়া যায়নি। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
      );
    }
  );
}

export interface AnimalPurchaseParams {
  animalData: {
    id?: string;
    tag?: string;
    species?: Animal['species'];
    breed?: string;
    gender?: Animal['gender'];
    birthDate?: string;
    purchaseDate?: string;
    currentWeightKg?: number;
    location?: string;
    photoUrl?: string;
    notes?: string;
  };
  purchaseCost: number;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  supplierId?: string;
  date?: string;
  currentUserId: string;
}

/**
 * Atomic Execution of Animal Purchase Transaction
 * Creates Animal record and posts accounting transaction:
 * Dr Livestock & Biological Assets (1580)
 * Cr Cash (1010) / Bank (1020) / Accounts Payable (2010)
 * Reconciles strictly with double-entry accounting.
 */
export async function executeAnimalPurchaseTransaction(
  params: AnimalPurchaseParams
): Promise<{ animal: Animal; journalEntryId?: string; voucherNumber?: string }> {
  return await db.transaction(
    'rw',
    [
      db.animals,
      db.journalEntries,
      db.accounts,
      db.cashBankAccounts,
      db.parties,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        animalData,
        purchaseCost,
        paymentMethod = 'CASH',
        bankAccountId,
        supplierId,
        date = new Date().toISOString().split('T')[0],
        currentUserId
      } = params;

      const cleanPurchaseCost = Math.max(0, Math.round((purchaseCost || 0) * 100) / 100);

      const closedPeriod = await db.closedPeriods
        .filter((p) => (p.startDate ? p.startDate <= date : true) && p.endDate >= date)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const species = animalData.species || 'CATTLE';
      const speciesPrefix = species === 'GOAT' ? 'GOT' : species === 'SHEEP' ? 'SHP' : species === 'POULTRY' ? 'PLT' : 'COW';
      const animalId = animalData.id?.trim() || animalData.tag?.trim() || generateTransactionNumber(speciesPrefix);

      // Check for duplicate animal ID/tag
      const existing = await db.animals.get(animalId);
      if (existing) {
        throw new Error(`এই আইডি বা ট্যাগের পশু ইতিপূর্বে নিবন্ধিত হয়েছে (ID: ${animalId})।`);
      }

      let journalEntryId: string | undefined;
      let voucherNumber: string | undefined;

      if (cleanPurchaseCost > 0) {
        const accounts = await db.accounts.toArray();
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

        let paymentCode: string = CANONICAL_ACCOUNTS.CASH;
        let paymentName = 'নগদ টাকা (Cash on Hand)';
        if (paymentMethod === 'BANK') {
          paymentCode = CANONICAL_ACCOUNTS.BANK;
          paymentName = 'ব্যাংক হিসাব (Bank Accounts)';
        } else if (paymentMethod === 'CREDIT') {
          paymentCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE;
          paymentName = 'সরবরাহকারীর দেনা (Accounts Payable)';
        }

        const paymentAcc = accounts.find((a) => a.code === paymentCode) || {
          id: `acc_${paymentCode}`,
          code: paymentCode,
          nameBn: paymentName
        };

        const journalLines: JournalLine[] = [
          {
            accountId: livestockAssetAcc.id,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: livestockAssetAcc.nameBn || 'পশুসম্পদ (Livestock & Biological Assets)',
            debit: cleanPurchaseCost,
            credit: 0,
            memo: `পশু ক্রয়: ট্যাগ ${animalId}`
          },
          {
            accountId: paymentAcc.id,
            accountCode: paymentCode,
            accountName: paymentAcc.nameBn || paymentName,
            debit: 0,
            credit: cleanPurchaseCost,
            memo: paymentMethod === 'CASH'
              ? `পশু ক্রয়ে নগদ পরিশোধ: ${animalId}`
              : paymentMethod === 'BANK'
              ? `পশু ক্রয়ে ব্যাংক পরিশোধ: ${animalId}`
              : `পশু ক্রয়ে সরবরাহকারীর নিকট দেনা: ${animalId}`
          }
        ];

        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('পশু ক্রয় জাবেদা ভারসাম্যহীন! ক্রয় সংরক্ষণ বাতিল করা হলো।');
        }

        voucherNumber = generateTransactionNumber(paymentMethod === 'CREDIT' ? 'JV' : 'PAY');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_anm'),
            voucherNumber,
            voucherType: paymentMethod === 'CREDIT' ? 'JOURNAL' : 'PAYMENT',
            date,
            narration: `গবাদিপশু ক্রয়: ${species} (ট্যাগ: ${animalId}), ক্রয়মূল্য: ৳${cleanPurchaseCost}`,
            reference: animalId,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Update operational cash/bank account balance or supplier balance
        if (paymentMethod === 'CASH') {
          const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await db.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance - cleanPurchaseCost) * 100) / 100,
              synced: false
            });
          }
        } else if (paymentMethod === 'BANK') {
          let bankAcc: CashBankAccount | undefined;
          if (bankAccountId) bankAcc = await db.cashBankAccounts.get(bankAccountId);
          if (!bankAcc) bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance - cleanPurchaseCost) * 100) / 100,
              synced: false
            });
          }
        } else if (paymentMethod === 'CREDIT' && supplierId) {
          const sParty = await db.parties.get(supplierId);
          if (sParty) {
            await db.parties.update(supplierId, {
              balance: Math.round(((sParty.balance || 0) + cleanPurchaseCost) * 100) / 100,
              synced: false
            });
          }
        }
      }

      const animal: Animal = {
        id: animalId,
        tag: animalData.tag || animalId,
        species,
        breed: animalData.breed?.trim() || '',
        gender: animalData.gender || 'FEMALE',
        birthDate: animalData.birthDate || date,
        purchaseDate: animalData.purchaseDate || date,
        purchaseCost: cleanPurchaseCost,
        currentWeightKg: animalData.currentWeightKg || 0,
        status: 'ACTIVE',
        location: animalData.location || 'প্রধান শেড',
        accumulatedFeedCost: 0,
        accumulatedMedCost: 0,
        accumulatedLabourCost: 0,
        otherCosts: 0,
        totalCost: cleanPurchaseCost,
        photoUrl: animalData.photoUrl,
        notes: animalData.notes,
        journalEntryId,
        paymentMethod,
        bankAccountId,
        supplierId,
        synced: false
      };

      await safeInsert(db.animals, animal, { idPrefix: speciesPrefix });

      // Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'ANIMAL_REGISTERED',
        module: 'LIVESTOCK',
        recordId: animal.id,
        status: 'SUCCESS',
        details: `${animal.id} (${animal.breed}) ক্রয় ও নিবন্ধন সম্পন্ন (ক্রয়মূল্য: ৳${cleanPurchaseCost})`
      });

      return { animal, journalEntryId, voucherNumber };
    }
  );
}

/**
 * Retrieves an Animal's accumulated cost and reconciles it against General Ledger transactions.
 * Returns breakdown, GL debits, COGS already transferred, net remaining cost, and consistency flag.
 * Ensures that operational cost cannot be claimed without source accounting transactions.
 */
export async function getAnimalAccumulatedCost(
  animalId: string,
  dbInstance: any = db
): Promise<{
  animalId: string;
  accumulatedCost: number;
  breakdown: AnimalCostBreakdown;
  accountingDebits: number;
  cogsTransferred: number;
  writeOffTransferred: number;
  netRemainingCost: number;
  isConsistent: boolean;
  unbackedCost: number;
}> {
  const animal = await dbInstance.animals.get(animalId);
  if (!animal) {
    throw new Error(`পশু খুঁজে পাওয়া যায়নি (ID: ${animalId})।`);
  }

  const breakdown = calculateAnimalRecordedCosts(animal);
  const accumulatedCost = breakdown.totalRecordedCost;

  const animalEntries = await dbInstance.journalEntries
    .filter(
      (j: any) =>
        j.reference === animalId ||
        (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(animalId)))
    )
    .toArray();

  let assetDebits1580 = 0;
  let expenseDebits = 0;
  let cogsTransferred = 0;
  let writeOffTransferred = 0;

  for (const entry of animalEntries) {
    for (const line of entry.lines || []) {
      const isForThisAnimal = line.memo ? line.memo.includes(animalId) : entry.reference === animalId;
      if (!isForThisAnimal) continue;

      if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
        assetDebits1580 += (line.debit || 0) - (line.credit || 0);
      } else if (
        line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
        line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
        line.accountCode === CANONICAL_ACCOUNTS.VACCINATION ||
        line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
        line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
      ) {
        expenseDebits += (line.debit || 0) - (line.credit || 0);
      } else if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS) {
        cogsTransferred += (line.debit || 0) - (line.credit || 0);
      } else if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF || line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS || line.accountCode === '8020') {
        writeOffTransferred += (line.debit || 0) - (line.credit || 0);
      }
    }
  }

  cogsTransferred = Math.max(0, Math.round(cogsTransferred * 100) / 100);
  writeOffTransferred = Math.max(0, Math.round(writeOffTransferred * 100) / 100);
  const totalGlAvailable = Math.max(0, Math.round((assetDebits1580 + expenseDebits) * 100) / 100);
  const accountingDebits = Math.max(0, Math.round((totalGlAvailable + cogsTransferred + writeOffTransferred) * 100) / 100);
  const netRemainingCost = totalGlAvailable;

  const unbackedCost = Math.max(0, Math.round((accumulatedCost - accountingDebits) * 100) / 100);
  const isConsistent = unbackedCost === 0;

  return {
    animalId,
    accumulatedCost,
    breakdown,
    accountingDebits,
    cogsTransferred,
    writeOffTransferred,
    netRemainingCost,
    isConsistent,
    unbackedCost
  };
}

export interface LivestockProductionCostParams {
  animalId: string;
  costType: 'FEED' | 'MEDICINE' | 'LABOUR' | 'OTHER';
  eventType?: AnimalEvent['eventType'];
  amount: number;
  date?: string;
  paymentMethod?: 'CASH' | 'BANK' | 'INVENTORY';
  bankAccountId?: string;
  feedItemId?: string;
  feedQuantityUsed?: number;
  vaccineName?: string;
  nextDueDate?: string;
  weightKg?: number;
  milkLiters?: number;
  notes?: string;
  currentUserId: string;
}

/**
 * Atomic Execution of Recording Livestock Production Costs (Feed, Medicine, Labour, Other)
 * Reconciles directly with double-entry accounting and updates the animal's accumulated cost breakdown.
 */
export async function executeLivestockProductionCostTransaction(
  params: LivestockProductionCostParams
): Promise<{ updatedAnimal: Animal; journalEntryId?: string; voucherNumber?: string; eventId?: string }> {
  return await db.transaction(
    'rw',
    [
      db.animals,
      db.animalEvents,
      db.inventoryItems,
      db.stockMovements,
      db.journalEntries,
      db.accounts,
      db.cashBankAccounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        animalId,
        costType,
        eventType,
        amount,
        date = new Date().toISOString().split('T')[0],
        paymentMethod = 'CASH',
        bankAccountId,
        feedItemId,
        feedQuantityUsed,
        notes,
        currentUserId
      } = params;

      const cleanAmount = Math.round(Math.max(0, amount) * 100) / 100;
      if (cleanAmount <= 0) {
        throw new Error('উৎপাদন ব্যয়ের পরিমাণ ০ এর বেশি হতে হবে।');
      }

      const closedPeriod = await db.closedPeriods
        .filter((p) => (p.startDate ? p.startDate <= date : true) && p.endDate >= date)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const freshAnimal = await db.animals.get(animalId);
      if (!freshAnimal) {
        throw new Error(`পশু খুঁজে পাওয়া যায়নি (ID: ${animalId})`);
      }

      if ((eventType as any) === 'MORTALITY') {
        throw new Error('মৃত্যুজনিত ঘটনা উৎপাদন ব্যয় হিসেবে গণ্য করা যাবে না। অনুগ্রহ করে মৃত্যু দাখিলা ব্যবহার করুন।');
      }

      if (freshAnimal.status === 'DECEASED') {
        throw new Error(`গবাদিপশু ${freshAnimal.id} ইতিপূর্বে মৃত ঘোষণা করা হয়েছে। মৃত পশুর ক্ষেত্রে উৎপাদন ব্যয় যুক্ত করা নিষিদ্ধ।`);
      }
      if (['SOLD', 'TRANSFERRED', 'STOLEN'].includes(freshAnimal.status)) {
        throw new Error(`বিক্রিত বা অপসারণকৃত পশুর (${freshAnimal.id} - ${freshAnimal.status}) উৎপাদন ব্যয় যুক্ত করা যাবে না।`);
      }

      const accounts = await db.accounts.toArray();
      let journalEntryId: string | undefined;
      let voucherNumber: string | undefined;

      if (paymentMethod === 'INVENTORY' && feedItemId) {
        const freshItem = await db.inventoryItems.get(feedItemId);
        if (!freshItem) {
          throw new Error('নির্বাচিত খাদ্য আইটেম খুঁজে পাওয়া যায়নি!');
        }
        const qtyUsed = Math.max(0, feedQuantityUsed || 0);
        if (qtyUsed > 0 && freshItem.currentStock < qtyUsed) {
          throw new Error(`পর্যাপ্ত খাদ্য মজুদ নেই! বর্তমান মজুদ: ${freshItem.currentStock} ${freshItem.unit}`);
        }

        const feedExpAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FEED_EXPENSE) || {
          id: `acc_${CANONICAL_ACCOUNTS.FEED_EXPENSE}`,
          code: CANONICAL_ACCOUNTS.FEED_EXPENSE,
          nameBn: 'খাদ্য ক্রয় খরচ (Feed Expense)'
        };
        const feedAssetAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.FEED_INVENTORY) || {
          id: `acc_${CANONICAL_ACCOUNTS.FEED_INVENTORY}`,
          code: CANONICAL_ACCOUNTS.FEED_INVENTORY,
          nameBn: 'খাদ্য মজুদ (Feed Inventory Asset)'
        };

        const journalLines: JournalLine[] = [
          {
            accountId: feedExpAcc.id,
            accountCode: CANONICAL_ACCOUNTS.FEED_EXPENSE,
            accountName: feedExpAcc.nameBn,
            debit: cleanAmount,
            credit: 0,
            memo: `${freshAnimal.breed} (${freshAnimal.id}) খাদ্য ব্যবহার ব্যয়`
          },
          {
            accountId: feedAssetAcc.id,
            accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY,
            accountName: feedAssetAcc.nameBn,
            debit: 0,
            credit: cleanAmount,
            memo: `${freshItem.nameBn} মজুদ হ্রাস (${qtyUsed} ${freshItem.unit})`
          }
        ];

        voucherNumber = generateTransactionNumber('EVV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_prod_cost'),
            voucherNumber,
            voucherType: 'JOURNAL',
            date,
            narration: `গবাদিপশু ${freshAnimal.id} (${freshAnimal.breed}): খাদ্য উপাদান ব্যবহার ব্যয় (মজুদ হ্রাস)`,
            reference: freshAnimal.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        if (qtyUsed > 0) {
          const newStock = Math.max(0, Math.round((freshItem.currentStock - qtyUsed) * 100) / 100);
          await db.inventoryItems.update(freshItem.id, {
            currentStock: newStock,
            synced: false
          });

          await safeInsert(db.stockMovements, {
            id: generateUniqueId('stk'),
            date,
            itemId: freshItem.id,
            movementType: 'CONSUMPTION',
            quantity: qtyUsed,
            unitCost: qtyUsed > 0 ? Math.round((cleanAmount / qtyUsed) * 100) / 100 : 0,
            totalValue: cleanAmount,
            referenceId: freshAnimal.id,
            notes: `${freshAnimal.breed} (${freshAnimal.id}) খাদ্য খরচ বাবদ মজুদ হ্রাস`,
            synced: false
          });
        }
      } else {
        // Cash or Bank Payment
        let expenseCode: string = CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE;
        let expenseName = 'বিবিধ পরিচালন ব্যয় (Miscellaneous Expense)';

        if (costType === 'FEED') {
          expenseCode = CANONICAL_ACCOUNTS.FEED_EXPENSE; // 6010
          expenseName = 'খাদ্য ক্রয় খরচ (Feed Expense)';
        } else if (costType === 'MEDICINE') {
          expenseCode = CANONICAL_ACCOUNTS.VET_MEDICINE; // 6040
          expenseName = 'চিকিৎসা ও ওষুধ (Veterinary & Medicine)';
        } else if (costType === 'LABOUR') {
          expenseCode = CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES; // 6020
          expenseName = 'খামার শ্রমিক মজুরি (Farm Labour Wages)';
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
            debit: cleanAmount,
            credit: 0,
            memo: `${freshAnimal.id} (${freshAnimal.breed}) - ${costType} ব্যয়`
          },
          {
            accountId: paymentAcc.id,
            accountCode: paymentCode,
            accountName: paymentAcc.nameBn || paymentName,
            debit: 0,
            credit: cleanAmount,
            memo: `পশুর উৎপাদন ব্যয় পরিশোধ (${costType})`
          }
        ];

        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('জাবেদা দাখিলা ভারসাম্যহীন! উৎপাদন ব্যয় সংরক্ষণ বাতিল করা হলো।');
        }

        voucherNumber = generateTransactionNumber('EVV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_prod_cost'),
            voucherNumber,
            voucherType: 'PAYMENT',
            date,
            narration: `গবাদিপশু ${freshAnimal.id} (${freshAnimal.breed}): ${costType} উৎপাদন ব্যয়${notes ? ` (${notes})` : ''}`,
            reference: freshAnimal.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;

        // Update operational cash/bank account balance
        if (paymentMethod === 'CASH') {
          const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await db.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance - cleanAmount) * 100) / 100
            });
          }
        } else if (paymentMethod === 'BANK') {
          let bankAcc: CashBankAccount | undefined;
          if (bankAccountId) bankAcc = await db.cashBankAccounts.get(bankAccountId);
          if (!bankAcc) bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
          if (bankAcc) {
            await db.cashBankAccounts.update(bankAcc.id, {
              currentBalance: Math.round((bankAcc.currentBalance - cleanAmount) * 100) / 100
            });
          }
        }
      }

      // Record event
      const eventId = generateUniqueId('evt');
      const eventTypeMap: Record<string, 'FEED' | 'TREATMENT' | 'LABOUR' | 'OTHER'> = {
        FEED: 'FEED',
        MEDICINE: 'TREATMENT',
        LABOUR: 'LABOUR',
        OTHER: 'OTHER'
      };
      const finalEventType = params.eventType || eventTypeMap[costType] || 'OTHER';
      const animalEvent: AnimalEvent = {
        id: eventId,
        animalId: freshAnimal.id,
        eventType: finalEventType,
        date,
        cost: cleanAmount,
        feedItemId,
        feedQuantityUsed,
        vaccineName: params.vaccineName,
        nextDueDate: params.nextDueDate,
        weightKg: params.weightKg,
        milkLiters: params.milkLiters,
        details: notes || `উৎপাদন ব্যয় (${costType}): ৳${cleanAmount}`,
        journalEntryId,
        synced: false
      };
      await safeInsert(db.animalEvents, animalEvent, { idPrefix: 'evt' });

      // Update animal accumulated costs
      const purchaseAmt = (freshAnimal.purchaseCost || (freshAnimal as any).purchasePrice || 0);
      const newFeed = (freshAnimal.accumulatedFeedCost || (freshAnimal as any).feedCost || 0) + (costType === 'FEED' ? cleanAmount : 0);
      const newMed = (freshAnimal.accumulatedMedCost || (freshAnimal as any).medicineCost || 0) + (costType === 'MEDICINE' ? cleanAmount : 0);
      const newLabour = (freshAnimal.accumulatedLabourCost || (freshAnimal as any).labourCost || 0) + (costType === 'LABOUR' ? cleanAmount : 0);
      const newOther = (freshAnimal.otherCosts || (freshAnimal as any).otherCost || 0) + (costType === 'OTHER' ? cleanAmount : 0);
      const newTotal = purchaseAmt + newFeed + newMed + newLabour + newOther;

      const updatedAnimal: Animal = {
        ...freshAnimal,
        purchaseCost: purchaseAmt,
        currentWeightKg: params.weightKg !== undefined ? params.weightKg : freshAnimal.currentWeightKg,
        accumulatedFeedCost: Math.round(newFeed * 100) / 100,
        accumulatedMedCost: Math.round(newMed * 100) / 100,
        accumulatedLabourCost: Math.round(newLabour * 100) / 100,
        otherCosts: Math.round(newOther * 100) / 100,
        totalCost: Math.round(newTotal * 100) / 100,
        synced: false
      };
      await db.animals.put(updatedAnimal);

      // Audit Log
      await safeInsert(db.auditLogs, {
        id: generateUniqueId('audit'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'PRODUCTION_COST_RECORDED',
        module: 'LIVESTOCK',
        recordId: freshAnimal.id,
        status: 'SUCCESS',
        details: `${freshAnimal.id} (${freshAnimal.breed}) এ ${costType} উৎপাদন ব্যয় যুক্ত (৳${cleanAmount})`
      });

      return { updatedAnimal, journalEntryId, voucherNumber, eventId: animalEvent.id };
    }
  );
}

/**
 * Atomic Execution of Animal Sell or Removal (Sold, Deceased, Transferred, Stolen)
 * If SOLD, auto-posts revenue using the same sales-posting pattern as InventoryCommerceModule.
 */
export async function executeAnimalSaleOrRemovalTransaction(params: {
  animal?: Animal;
  animalId?: string;
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
      db.animalEvents,
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
        animalId,
        newStatus,
        date,
        salePrice = 0,
        customerName,
        paymentMethod = 'CASH',
        bankAccountId,
        notes,
        currentUserId
      } = params;

      const targetId = animal?.id || animalId;
      if (!targetId) {
        throw new Error('পশুর তথ্য বা আইডি পাওয়া যায়নি।');
      }
      const freshAnimal = (await db.animals.get(targetId)) || animal;
      if (!freshAnimal) {
        throw new Error(`পশু পাওয়া যায়নি (ID: ${targetId})।`);
      }
      const todayStr = new Date().toISOString().split('T')[0];

      if (newStatus === 'SOLD') {
        if (freshAnimal.status === 'SOLD') {
          throw new Error(`গবাদিপশু ${freshAnimal.id} ইতিপূর্বে বিক্রয় করা হয়েছে। পুনরায় বিক্রয় বা ডুপ্লিকেট COGS দাখিলা তৈরি করা যাবে না।`);
        }
        if (['DECEASED', 'STOLEN', 'TRANSFERRED'].includes(freshAnimal.status)) {
          throw new Error(`অপসারণকৃত গবাদিপশু (${freshAnimal.id} - ${freshAnimal.status}) পুনরায় বিক্রয় বা COGS নির্ধারণ করা যাবে না।`);
        }
        if (freshAnimal.purchaseDate && date < freshAnimal.purchaseDate) {
          throw new Error(`পশু বিক্রয়ের তারিখ (${date}) ক্রয় তারিখের (${freshAnimal.purchaseDate}) পূর্ববর্তী হতে পারে না।`);
        }
        if (date > todayStr) {
          throw new Error(`পশু বিক্রয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
        }
      } else {
        if (freshAnimal.status === 'DECEASED') {
          throw new Error(`গবাদিপশু ${freshAnimal.id} ইতিপূর্বে মৃত ঘোষণা করা হয়েছে। পুনরায় মৃত্যু বা অবলোপন দাখিলা নিষিদ্ধ।`);
        }
        if (['SOLD', 'STOLEN', 'TRANSFERRED'].includes(freshAnimal.status)) {
          throw new Error(`ইতিপূর্বে নিষ্পত্তি বা অপসারণকৃত গবাদিপশু (${freshAnimal.id} - ${freshAnimal.status}) পুনরায় অপসারণ বা অবলোপন করা যাবে না।`);
        }
        if (newStatus === 'DECEASED' && salePrice && salePrice > 0) {
          throw new Error(`মৃত পশুর ক্ষেত্রে বিক্রয়মূল্য ধার্য করা যাবে না। মৃত্যুজনিত ঘটনা বিক্রয় হিসেবে গণ্য করা নিষিদ্ধ।`);
        }
      }

      // Check if COGS or write-off already exists in GL for this animal to prevent duplicate COGS / derecognition
      let alreadyRecognizedCogs = 0;
      let alreadyWrittenOff = 0;
      try {
        const pastEntries = await db.journalEntries
          .filter((j) => j.reference === freshAnimal.id || (Boolean(j.narration) && j.narration.includes(freshAnimal.id)))
          .toArray();
        for (const entry of pastEntries) {
          for (const line of entry.lines || []) {
            const isForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
            if (!isForThisAnimal) continue;
            if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_COGS) {
              alreadyRecognizedCogs += (line.debit || 0) - (line.credit || 0);
            } else if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_WRITEOFF || line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS || line.accountCode === '8020') {
              alreadyWrittenOff += (line.debit || 0) - (line.credit || 0);
            }
          }
        }
      } catch {
        // Fallback
      }

      if (newStatus === 'SOLD' && alreadyRecognizedCogs > 0) {
        throw new Error(`গবাদিপশু ${freshAnimal.id} এর জন্য ইতিপূর্বে ৳${alreadyRecognizedCogs} COGS দাখিলা সম্পন্ন হয়েছে। পুনরায় COGS নির্ধারণ বা ডুপ্লিকেট বিক্রয় নিষিদ্ধ।`);
      }
      if (alreadyWrittenOff > 0) {
        throw new Error(`গবাদিপশু ${freshAnimal.id} এর জন্য ইতিপূর্বে ৳${alreadyWrittenOff} অবলোপন বা মৃত্যুজনিত দাখিলা সম্পন্ন হয়েছে। পুনরায় নিষ্পত্তি নিষিদ্ধ।`);
      }

      const cleanPrice = Math.round((salePrice || 0) * 100) / 100;
      // Legitimate accumulated raising costs: Purchase + Feed + Medicine/Vet + Labour + Other
      const costBreakdown = calculateAnimalRecordedCosts(freshAnimal);
      const costToDerecognize = costBreakdown.totalRecordedCost;
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
      // 2. Cost leg: Debit Livestock COGS (5020), Credit Livestock Assets / Expense accounts for total accumulated cost
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

        // COGS & Cost Derecognition (legitimate accumulated raising costs)
        if (costToDerecognize > 0) {
          // Verify total available in GL for this animal to prevent unbacked fake credits
          let glAssetDebit1580 = 0;
          let glExpenseDebit = 0;
          let totalJournalCount = 0;
          try {
            totalJournalCount = await db.journalEntries.count();
            const animalEntries = await db.journalEntries
              .filter((j) => j.reference === freshAnimal.id || (Boolean(j.narration) && j.narration.includes(freshAnimal.id)))
              .toArray();
            for (const entry of animalEntries) {
              for (const line of entry.lines || []) {
                const isForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
                if (!isForThisAnimal) continue;
                if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
                  glAssetDebit1580 += (line.debit || 0) - (line.credit || 0);
                } else if (
                  line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
                  line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
                  line.accountCode === CANONICAL_ACCOUNTS.VACCINATION ||
                  line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
                  line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
                ) {
                  glExpenseDebit += (line.debit || 0) - (line.credit || 0);
                }
              }
            }
          } catch {
            // Testing fallback
          }

          const totalAvailableInGl = Math.max(0, Math.round((glAssetDebit1580 + glExpenseDebit) * 100) / 100);
          if (costToDerecognize > totalAvailableInGl) {
            const unbackedAmount = Math.round((costToDerecognize - totalAvailableInGl) * 100) / 100;
            throw new Error(
              `গবাদিপশু ${freshAnimal.id} এর উৎপাদন ব্যয়ে অমিল রয়েছে: মোট অপারেশনাল ব্যয় ৳${costToDerecognize}, কিন্তু সংশ্লিষ্ট অনুমোদিত জাবেদা ব্যালেন্স পাওয়া গেছে মাত্র ৳${totalAvailableInGl} (অননুমোদিত বা হিসাবহীন ঘাটতি: ৳${unbackedAmount})। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রকৃত লেনদেন নথিভুক্ত করুন।`
            );
          }

          journalLines.push({
            accountId: livestockCogsAcc.id,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_COGS,
            accountName: livestockCogsAcc.nameBn || 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয় (Livestock COGS)',
            debit: costToDerecognize,
            credit: 0,
            memo: `${freshAnimal.breed} (ট্যাগ: ${freshAnimal.id}) পুঞ্জীভূত উৎপাদন ব্যয় (COGS)`
          });

          const creditLines = await buildLivestockCostCreditLines(freshAnimal, costToDerecognize, accounts);
          journalLines.push(...creditLines);
        }

        // Double check balance
        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('বিক্রয় জাবেদা ভারসাম্যহীন! বিক্রয় বাতিল করা হলো।');
        }

        const voucherNumber = generateTransactionNumber('SLV');
        const invoiceNumber = generateTransactionNumber('SAL');
        const displayNumber = await generateDisplayNumber('SAL', date);

        const costDetailStr = costToDerecognize > 0
          ? ` (পুঞ্জীভূত মোট ব্যয়: ৳${costToDerecognize} [ক্রয়: ৳${costBreakdown.purchaseCost}, খাদ্য: ৳${costBreakdown.feedCost}, চিকিৎসা: ৳${costBreakdown.medicineCost}, শ্রম: ৳${costBreakdown.labourCost}, অন্যান্য: ৳${costBreakdown.otherCost}])`
          : '';

        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_sale'),
            voucherNumber,
            voucherType: 'SALES',
            date,
            narration: `পশু বিক্রয় চালান: ${customerName || 'সাধারণ ক্রেতা'} এর নিকট ${freshAnimal.id} (${freshAnimal.breed}) বিক্রয়${costDetailStr}`,
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
                lineTotal: cleanPrice,
                cogsAmount: costToDerecognize
              }
            ],
            subtotal: cleanPrice,
            totalAmount: cleanPrice,
            grandTotal: cleanPrice,
            paidAmount: cleanPrice,
            dueAmount: 0,
            totalCogs: costToDerecognize,
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
        // Debit 'পশুসম্পদ অবলোপন (Livestock Write-off)' (8020), Credit Livestock Assets & Expenses, for total accumulated cost
        if (costToDerecognize > 0) {
          // Verify total available in GL for this animal to prevent unbacked fake credits
          let glAssetDebit1580 = 0;
          let glExpenseDebit = 0;
          let totalJournalCount = 0;
          try {
            totalJournalCount = await db.journalEntries.count();
            const animalEntries = await db.journalEntries
              .filter((j) => j.reference === freshAnimal.id || (Boolean(j.narration) && j.narration.includes(freshAnimal.id)))
              .toArray();
            for (const entry of animalEntries) {
              for (const line of entry.lines || []) {
                const isForThisAnimal = line.memo ? line.memo.includes(freshAnimal.id) : (entry.reference === freshAnimal.id);
                if (!isForThisAnimal) continue;
                if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
                  glAssetDebit1580 += (line.debit || 0) - (line.credit || 0);
                } else if (
                  line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
                  line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
                  line.accountCode === CANONICAL_ACCOUNTS.VACCINATION ||
                  line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
                  line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
                ) {
                  glExpenseDebit += (line.debit || 0) - (line.credit || 0);
                }
              }
            }
          } catch {
            // Testing fallback
          }

          const totalAvailableInGl = Math.max(0, Math.round((glAssetDebit1580 + glExpenseDebit) * 100) / 100);
          if (costToDerecognize > totalAvailableInGl) {
            const unbackedAmount = Math.round((costToDerecognize - totalAvailableInGl) * 100) / 100;
            throw new Error(
              `গবাদিপশু ${freshAnimal.id} এর অবলোপন ব্যয়ে অমিল রয়েছে: মোট অপারেশনাল ব্যয় ৳${costToDerecognize}, কিন্তু সংশ্লিষ্ট অনুমোদিত জাবেদা ব্যালেন্স পাওয়া গেছে মাত্র ৳${totalAvailableInGl} (অননুমোদিত বা হিসাবহীন ঘাটতি: ৳${unbackedAmount})। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রকৃত লেনদেন নথিভুক্ত করুন।`
            );
          }

          const isMortality = newStatus === 'DECEASED';
          const writeOffDebitLine: JournalLine = {
            accountId: writeOffAcc.id,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_MORTALITY_LOSS,
            accountName: writeOffAcc.nameBn || (isMortality ? 'পশুসম্পদ অবলোপন ও মৃত্যুজনিত ক্ষতি (Livestock Write-off & Mortality Loss)' : 'পশুসম্পদ অবলোপন (Livestock Write-off)'),
            debit: costToDerecognize,
            credit: 0,
            memo: isMortality
              ? `পশু মৃত্যুজনিত ক্ষতি (Mortality Loss): ${freshAnimal.id} (${freshAnimal.breed}) পুঞ্জীভূত ব্যয়`
              : `পশু অবলোপন (${newStatus}): ${freshAnimal.id} (${freshAnimal.breed}) পুঞ্জীভূত ব্যয়`
          };
          const creditLines = await buildLivestockCostCreditLines(freshAnimal, costToDerecognize, accounts);
          const writeOffLines: JournalLine[] = [writeOffDebitLine, ...creditLines];

          const check = validateBalancedLines(writeOffLines, accounts);
          if (!check.isBalanced) {
            throw new Error('অবলোপন জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
          }

          const voucherNumber = generateTransactionNumber('ADJ');
          const costDetailStr = costToDerecognize > 0
            ? ` (পুঞ্জীভূত মোট ব্যয়: ৳${costToDerecognize})`
            : '';

          const narration = isMortality
            ? `গবাদিপশু মৃত্যুজনিত ক্ষতি ও অবলোপন দাখিলা: ${freshAnimal.id} (${freshAnimal.breed}) মৃত্যু বাবদ অবলোপন${costDetailStr}${notes ? ` [${notes}]` : ''}`
            : `পশুসম্পদ অবলোপন দাখিলা (${newStatus}): ${freshAnimal.id} (${freshAnimal.breed}) খামার থেকে অপসারণ বাবদ অবলোপন${costDetailStr}${notes ? ` [${notes}]` : ''}`;

          const writeOffEntry = await postJournalEntry(
            {
              id: generateUniqueId('j_writeoff'),
              voucherNumber,
              voucherType: 'ADJUSTMENT',
              date,
              narration,
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

      // If DECEASED, ensure an AnimalEvent of type MORTALITY exists to keep operational logs in sync
      if (newStatus === 'DECEASED') {
        const existingEvent = await db.animalEvents
          .filter((ev) => ev.animalId === freshAnimal.id && ev.eventType === 'MORTALITY')
          .first();
        if (!existingEvent) {
          await safeInsert(db.animalEvents, {
            id: generateUniqueId('evt'),
            animalId: freshAnimal.id,
            eventType: 'MORTALITY',
            date,
            cost: 0,
            details: notes?.trim() || `পশু ${freshAnimal.id} মৃত্যুজনিত ক্ষতি ও অবলোপন সম্পন্ন`,
            synced: false
          });
        }
      }

      // Update animal status/salePrice/saleDate/notes
      const noteAddition = notes?.trim() ? `[${newStatus} - ${date}: ${notes.trim()}]` : `[${newStatus} - ${date}]`;
      const combinedNotes = freshAnimal.notes ? `${freshAnimal.notes} | ${noteAddition}` : noteAddition;

      const updatedAnimal: Animal = {
        ...freshAnimal,
        status: newStatus,
        salePrice: newStatus === 'SOLD' ? cleanPrice : undefined,
        saleDate: newStatus === 'SOLD' ? date : undefined,
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
        action: newStatus === 'SOLD' ? 'ANIMAL_SOLD' : (newStatus === 'DECEASED' ? 'ANIMAL_MORTALITY' : 'ANIMAL_REMOVED'),
        module: 'LIVESTOCK',
        recordId: freshAnimal.id,
        status: 'SUCCESS',
        details: newStatus === 'DECEASED'
          ? `${freshAnimal.id} (${freshAnimal.breed}) মৃত্যুজনিত অবলোপন সম্পন্ন (পুঞ্জীভূত ক্ষতি: ৳${costToDerecognize})`
          : `${freshAnimal.id} স্ট্যাটাস পরিবর্তন: ${newStatus}${newStatus === 'SOLD' ? ` (বিক্রয়মূল্য: ৳${cleanPrice})` : ''}`
      });

      return { updatedAnimal, sale: saleRecord, journalEntryId };
    }
  );
}

/**
 * TASK 10: Atomic Livestock Mortality Accounting
 * Derecognizes active biological asset carrying cost and recognizes Livestock Mortality Loss (8020).
 * Prevents treating mortality as a sale, rejects unbacked/invented losses, and blocks duplicate mortality entries.
 */
export async function executeLivestockMortalityTransaction(params: {
  animal?: Animal;
  animalId?: string;
  date?: string;
  causeOfDeath?: string;
  notes?: string;
  currentUserId: string;
}): Promise<{ updatedAnimal: Animal; journalEntryId?: string; eventId?: string }> {
  const targetId = params.animal?.id || params.animalId;
  if (!targetId) {
    throw new Error('পশুর তথ্য বা আইডি প্রদান করা হয়নি।');
  }
  const date = params.date || new Date().toISOString().split('T')[0];
  const combinedNotes = params.causeOfDeath
    ? (params.notes ? `${params.causeOfDeath} - ${params.notes}` : params.causeOfDeath)
    : params.notes;

  const result = await executeAnimalSaleOrRemovalTransaction({
    animal: params.animal,
    animalId: targetId,
    newStatus: 'DECEASED',
    date,
    notes: combinedNotes,
    currentUserId: params.currentUserId
  });

  const event = await db.animalEvents
    .filter((ev) => ev.animalId === targetId && ev.eventType === 'MORTALITY')
    .last();

  return {
    updatedAnimal: result.updatedAnimal,
    journalEntryId: result.journalEntryId,
    eventId: event?.id
  };
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
 * Fish Batch Cost Breakdown & Accumulation
 */
export interface FishCostBreakdown {
  fingerlingCost: number;
  feedCost: number;
  medicineCost: number;
  labourCost: number;
  electricityCost: number;
  waterTreatmentCost: number;
  otherCost: number;
  totalRecordedCost: number;
}

export function calculateFishBatchRecordedCosts(batch: FishBatch): FishCostBreakdown {
  const fingerlingCost = Math.max(0, Number(batch.fingerlingCost) || 0);
  const feedCost = Math.max(0, Number(batch.totalFeedCost) || 0);
  const medicineCost = Math.max(0, Number(batch.medicineCost) || 0);
  const labourCost = Math.max(0, Number(batch.labourCost) || 0);
  const electricityCost = Math.max(0, Number(batch.electricityCost) || 0);
  const waterTreatmentCost = Math.max(0, Number(batch.waterTreatmentCost) || 0);
  const otherCost = Math.max(0, Number(batch.otherCost ?? (batch as any).otherCosts) || 0);

  const totalRecordedCost = Math.round(
    (fingerlingCost + feedCost + medicineCost + labourCost + electricityCost + waterTreatmentCost + otherCost) * 100
  ) / 100;

  return {
    fingerlingCost,
    feedCost,
    medicineCost,
    labourCost,
    electricityCost,
    waterTreatmentCost,
    otherCost,
    totalRecordedCost
  };
}

/**
 * Computes and verifies the accumulated production cost for a specific Fish batch based on its batch-linked accounting records.
 * Ensures the cost is identified strictly by the batch ID and NEVER by the global balance of account 1580.
 */
export async function getFishBatchAccumulatedCost(
  batchId: string,
  dbInstance: any = db
): Promise<{
  batchId: string;
  accumulatedCost: number;
  breakdown: FishCostBreakdown;
  accountingDebits: number;
  cogsTransferred: number;
  mortalityTransferred: number;
  netRemainingCost: number;
  isConsistent: boolean;
  unbackedCost: number;
}> {
  const batch = await dbInstance.fishBatches.get(batchId);
  if (!batch) {
    throw new Error(`মাছের ব্যাচ পাওয়া যায়নি (ID: ${batchId})।`);
  }

  const breakdown = calculateFishBatchRecordedCosts(batch);
  const accumulatedCost = breakdown.totalRecordedCost;

  // Query ONLY journal entries specifically linked to THIS batch ID
  const batchEntries = await dbInstance.journalEntries
    .filter(
      (j: any) =>
        j.reference === batchId ||
        (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(batchId)))
    )
    .toArray();

  let accountingDebits = 0;
  let cogsTransferred = 0;
  let mortalityTransferred = 0;

  for (const entry of batchEntries) {
    for (const line of entry.lines || []) {
      const isForThisBatch = line.memo ? line.memo.includes(batchId) : entry.reference === batchId;
      if (!isForThisBatch) continue;

      if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS || line.accountCode === CANONICAL_ACCOUNTS.WIP) {
        accountingDebits += line.debit || 0;
      } else if (line.accountCode === CANONICAL_ACCOUNTS.FISH_COGS) {
        cogsTransferred += (line.debit || 0) - (line.credit || 0);
      } else if (line.accountCode === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS) {
        mortalityTransferred += (line.debit || 0) - (line.credit || 0);
      }
    }
  }

  accountingDebits = Math.round(accountingDebits * 100) / 100;
  cogsTransferred = Math.round(cogsTransferred * 100) / 100;
  mortalityTransferred = Math.round(mortalityTransferred * 100) / 100;
  const netRemainingCost = Math.max(0, Math.round((accountingDebits - (cogsTransferred + mortalityTransferred)) * 100) / 100);

  const unbackedCost = Math.max(0, Math.round((accumulatedCost - accountingDebits) * 100) / 100);
  const isConsistent = unbackedCost === 0;

  return {
    batchId,
    accumulatedCost,
    breakdown,
    accountingDebits,
    cogsTransferred,
    mortalityTransferred,
    netRemainingCost,
    isConsistent,
    unbackedCost
  };
}

/**
 * Atomic Execution of Fish Stocking Transaction
 * - Creates FishBatch record
 * - If fingerlingCost > 0: Capitalizes cost to Biological Assets (1580), Credits Cash/Bank/Payable
 * - Stores journalEntryId on the FishBatch
 */
export interface FishStockingParams {
  pondName: string;
  species: string;
  fingerlingQty: number;
  fingerlingCost: number;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  supplierId?: string;
  stockingDate?: string;
  notes?: string;
  currentUserId: string;
}

export async function executeFishStockingTransaction(
  params: FishStockingParams
): Promise<{ batch: FishBatch; journalEntryId?: string; voucherNumber?: string }> {
  return await db.transaction(
    'rw',
    [
      db.fishBatches,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        pondName,
        species,
        fingerlingQty,
        fingerlingCost,
        paymentMethod = 'CASH',
        bankAccountId,
        supplierId,
        stockingDate,
        notes,
        currentUserId
      } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = stockingDate || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`মজুদের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      const closedPeriod = await db.closedPeriods
        .filter((p) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const cleanCost = Math.max(0, Math.round((Number(fingerlingCost) || 0) * 100) / 100);
      const cleanQty = Math.max(1, parseInt(String(fingerlingQty)) || 1000);

      // Validate bank account if paymentMethod is BANK
      let bankAcc: CashBankAccount | undefined;
      if (paymentMethod === 'BANK' && cleanCost > 0) {
        if (!bankAccountId) {
          throw new Error('ব্যাংক মাধ্যমে পোনা ক্রয়ের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        bankAcc = await db.cashBankAccounts.get(bankAccountId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
      }

      const batchId = generateTransactionNumber('FISH');
      let journalEntryId: string | undefined;
      let voucherNumber: string | undefined;

      if (cleanCost > 0) {
        const accounts = await db.accounts.toArray();
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

        const creditAccCode = getPaymentAccount(paymentMethod, 'PURCHASE');
        const paymentAcc = accounts.find((a) => a.code === creditAccCode);

        const journalLines: JournalLine[] = [
          {
            accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: cleanCost,
            credit: 0,
            memo: `মাছের ব্যাচ ${batchId}: [FINGERLING] পোনা মজুদ (${species} - ${pondName}, ${cleanQty} টি)`
          },
          {
            accountId: creditAccCode,
            accountCode: creditAccCode,
            accountName: paymentAcc?.nameBn || (paymentMethod === 'CASH' ? 'নগদ টাকা (Cash on Hand)' : paymentMethod === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'সরবরাহকারীর নিকট দেনা (Accounts Payable)'),
            debit: 0,
            credit: cleanCost,
            memo: `পোনা ক্রয়ের পরিশোধ (${paymentMethod})`
          }
        ];

        const check = validateBalancedLines(journalLines, accounts);
        if (!check.isBalanced) {
          throw new Error('পোনা মজুদের জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        voucherNumber = generateTransactionNumber('PAY');
        const jEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_fish_stock'),
            voucherNumber,
            voucherType: 'PAYMENT',
            date: dateStr,
            narration: `মাছের নতুন ব্যাচ মজুদ ও পোনা ক্রয়: ${species} (${pondName}) - ${cleanQty} টি, খরচ: ৳${cleanCost}`,
            reference: batchId,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, jEntry, { idPrefix: 'j' });
        journalEntryId = jEntry.id;

        // Update Cash/Bank account balance
        if (paymentMethod === 'BANK' && bankAcc) {
          await db.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance - cleanCost) * 100) / 100,
            synced: false
          });
        } else if (paymentMethod === 'CASH') {
          const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await db.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance - cleanCost) * 100) / 100,
              synced: false
            });
          }
        }
      }

      const batch: FishBatch = {
        id: batchId,
        pondId: generateUniqueId('pond'),
        pondName: pondName.trim(),
        species: species.trim(),
        stockingDate: dateStr,
        fingerlingQty: cleanQty,
        fingerlingCost: cleanCost,
        totalFeedKg: 0,
        totalFeedCost: 0,
        medicineCost: 0,
        labourCost: 0,
        electricityCost: 0,
        waterTreatmentCost: 0,
        otherCost: 0,
        mortalityCount: 0,
        currentEstimatedWeightKg: 0,
        status: 'ACTIVE',
        notes: notes ? notes.trim() : undefined,
        totalCost: cleanCost,
        journalEntryId,
        synced: false
      };

      await safeInsert(db.fishBatches, batch, { idPrefix: 'FISH' });

      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'CREATE',
          module: 'PRODUCTION',
          recordId: batch.id,
          status: 'SUCCESS',
          details: `নতুন মাছের ব্যাচ মজুদ: ${batch.species} (${batch.pondName}), পোনা খরচ: ৳${cleanCost}, ভাউচার: ${voucherNumber || 'N/A'}`
        },
        { idPrefix: 'aud' }
      );

      return { batch, journalEntryId, voucherNumber };
    }
  );
}

/**
 * Atomic Execution of Fish Production Cost Transaction
 * - Directly capitalizes production cost (Feed, Medicine, Labour, Electricity, Water Treatment, Other) into Biological Assets (1580)
 * - Credits Cash / Bank / Accounts Payable / Feed Inventory
 * - Updates FishBatch operational metrics
 */
export interface FishProductionCostParams {
  batchId: string;
  costType: 'FINGERLING' | 'FEED' | 'MEDICINE' | 'LABOUR' | 'ELECTRICITY' | 'WATER_TREATMENT' | 'OTHER';
  amount: number;
  quantity?: number;
  date?: string;
  paymentMethod?: 'CASH' | 'BANK' | 'CREDIT' | 'INVENTORY';
  bankAccountId?: string;
  supplierId?: string;
  feedItemId?: string;
  notes?: string;
  currentUserId: string;
}

export async function executeFishProductionCostTransaction(
  params: FishProductionCostParams
): Promise<{ updatedBatch: FishBatch; journalEntryId: string; voucherNumber: string }> {
  return await db.transaction(
    'rw',
    [
      db.fishBatches,
      db.journalEntries,
      db.cashBankAccounts,
      db.inventoryItems,
      db.stockMovements,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const {
        batchId,
        costType,
        amount,
        quantity,
        date,
        paymentMethod = 'CASH',
        bankAccountId,
        supplierId,
        feedItemId,
        notes,
        currentUserId
      } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`খরচের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
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
      if (freshBatch.status !== 'ACTIVE') {
        throw new Error(`শুধুমাত্র সক্রিয় (ACTIVE) মাছের ব্যাচে উৎপাদন খরচ যোগ করা যাবে।`);
      }

      const cleanAmount = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
      if (cleanAmount <= 0) {
        throw new Error('খরচের পরিমাণ শূন্যের চেয়ে বেশি হতে হবে।');
      }

      const cleanQty = quantity ? Math.max(0, Number(quantity) || 0) : 0;

      const accounts = await db.accounts.toArray();
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

      const costLabels: Record<string, string> = {
        FINGERLING: 'অতিরিক্ত পোনা ক্রয়',
        FEED: 'মাছের খাদ্য (Feed)',
        MEDICINE: 'ওষুধ ও চিকিৎসা',
        LABOUR: 'শ্রমিক ও মজুরি',
        ELECTRICITY: 'বিদ্যুৎ ও পাম্পিং',
        WATER_TREATMENT: 'পানি শোধন ও পরিচর্যা',
        OTHER: 'অন্যান্য উৎপাদন খরচ'
      };
      const costLabel = costLabels[costType] || 'উৎপাদন খরচ';

      // Duplicate prevention: verify identical cost entry for this batch hasn't already been posted
      const duplicateEntry = await db.journalEntries
        .filter((j) => {
          if (j.reference !== freshBatch.id || j.date !== dateStr) return false;
          return (j.lines || []).some(
            (l) =>
              l.debit === cleanAmount &&
              l.memo &&
              (l.memo.includes(`[${costType}]`) || l.memo.includes(costLabel))
          );
        })
        .first();

      if (duplicateEntry) {
        const timeDiff = Math.abs(Date.now() - new Date(duplicateEntry.createdAt || '').getTime());
        if (timeDiff < 10000 || (notes && duplicateEntry.narration && duplicateEntry.narration.includes(notes.trim()))) {
          throw new Error(`এই ব্যাচের জন্য একই খরচের দাখিলা (${costLabel}: ৳${cleanAmount}) ইতিপূর্বে সংরক্ষিত হয়েছে (ভাউচার: ${duplicateEntry.voucherNumber || duplicateEntry.id})। ডুপ্লিকেট এন্ট্রি প্রতিরোধ করা হয়েছে।`);
        }
      }

      let creditAccCode: string = CANONICAL_ACCOUNTS.CASH;
      let creditAccName = 'নগদ টাকা (Cash on Hand)';

      if (paymentMethod === 'INVENTORY') {
        if (!feedItemId) {
          throw new Error('ইনভেন্টরি থেকে খাদ্য ব্যবহারের জন্য খাদ্য আইটেম নির্বাচন আবশ্যক।');
        }
        const invItem = await db.inventoryItems.get(feedItemId);
        if (!invItem) {
          throw new Error('নির্বাচিত খাদ্য আইটেমটি ইনভেন্টরিতে পাওয়া যায়নি।');
        }
        if (cleanQty > 0 && invItem.currentStock < cleanQty) {
          throw new Error(`ইনভেন্টরিতে পর্যাপ্ত খাদ্য মজুদ নেই (মজুদ: ${invItem.currentStock} ${invItem.unit}, প্রয়োজন: ${cleanQty} ${invItem.unit})।`);
        }

        creditAccCode = CANONICAL_ACCOUNTS.FEED_INVENTORY;
        creditAccName = 'খাদ্য মজুদ (Feed Inventory)';

        if (cleanQty > 0) {
          await db.inventoryItems.update(invItem.id, {
            currentStock: Math.max(0, invItem.currentStock - cleanQty),
            synced: false
          });

          await safeInsert(
            db.stockMovements,
            {
              id: generateUniqueId('stk'),
              itemId: invItem.id,
              date: dateStr,
              movementType: 'CONSUMPTION',
              quantity: cleanQty,
              unitCost: invItem.avgCostPrice || 0,
              totalValue: cleanAmount,
              referenceType: 'PRODUCTION',
              referenceId: freshBatch.id,
              notes: `মাছের ব্যাচ ${freshBatch.id}: খাদ্য প্রয়োগ (${cleanQty} ${invItem.unit})`,
              synced: false
            } as StockMovement,
            { idPrefix: 'stk' }
          );
        }
      } else if (paymentMethod === 'BANK') {
        if (!bankAccountId) {
          throw new Error('ব্যাংক মাধ্যমে পরিশোধের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        const bankAcc = await db.cashBankAccounts.get(bankAccountId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
        creditAccCode = CANONICAL_ACCOUNTS.BANK;
        creditAccName = 'ব্যাংক হিসাব (Bank Accounts)';
        await db.cashBankAccounts.update(bankAcc.id, {
          currentBalance: Math.round((bankAcc.currentBalance - cleanAmount) * 100) / 100,
          synced: false
        });
      } else if (paymentMethod === 'CREDIT') {
        creditAccCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE;
        creditAccName = 'সরবরাহকারীর নিকট দেনা (Accounts Payable)';
      } else {
        // CASH
        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance - cleanAmount) * 100) / 100,
            synced: false
          });
        }
      }

      const journalLines: JournalLine[] = [
        {
          accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          debit: cleanAmount,
          credit: 0,
          memo: `মাছের ব্যাচ ${freshBatch.id}: [${costType}] ${costLabel} (WIP Accumulation)`
        },
        {
          accountId: creditAccCode,
          accountCode: creditAccCode,
          accountName: creditAccName,
          debit: 0,
          credit: cleanAmount,
          memo: `${costLabel} পরিশোধ (${paymentMethod})`
        }
      ];

      const check = validateBalancedLines(journalLines, accounts);
      if (!check.isBalanced) {
        throw new Error('মাছের উৎপাদন খরচের জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
      }

      const voucherNumber = generateTransactionNumber('PAY');
      const jEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_fish_cost'),
          voucherNumber,
          voucherType: 'PAYMENT',
          date: dateStr,
          narration: `মাছের উৎপাদন খরচ: ব্যাচ ${freshBatch.id} (${freshBatch.species} - ${freshBatch.pondName}) - ${costLabel}: ৳${cleanAmount}`,
          reference: freshBatch.id,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(db.journalEntries, jEntry, { idPrefix: 'j' });

      // Update operational cost tracking on FishBatch
      if (costType === 'FINGERLING') {
        freshBatch.fingerlingCost = Math.round(((freshBatch.fingerlingCost || 0) + cleanAmount) * 100) / 100;
        if (cleanQty > 0) freshBatch.fingerlingQty = (freshBatch.fingerlingQty || 0) + cleanQty;
      } else if (costType === 'FEED') {
        freshBatch.totalFeedCost = Math.round(((freshBatch.totalFeedCost || 0) + cleanAmount) * 100) / 100;
        if (cleanQty > 0) freshBatch.totalFeedKg = (freshBatch.totalFeedKg || 0) + cleanQty;
      } else if (costType === 'MEDICINE') {
        freshBatch.medicineCost = Math.round(((freshBatch.medicineCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'LABOUR') {
        freshBatch.labourCost = Math.round(((freshBatch.labourCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'ELECTRICITY') {
        freshBatch.electricityCost = Math.round(((freshBatch.electricityCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'WATER_TREATMENT') {
        freshBatch.waterTreatmentCost = Math.round(((freshBatch.waterTreatmentCost || 0) + cleanAmount) * 100) / 100;
      } else {
        freshBatch.otherCost = Math.round(((freshBatch.otherCost || 0) + cleanAmount) * 100) / 100;
      }

      const breakdown = calculateFishBatchRecordedCosts(freshBatch);
      freshBatch.totalCost = breakdown.totalRecordedCost;

      freshBatch.synced = false;
      await db.fishBatches.put(freshBatch);

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
          details: `মাছের উৎপাদন খরচ সংযোজন: ব্যাচ ${freshBatch.id} - ${costLabel}: ৳${cleanAmount}, ভাউচার: ${voucherNumber}`
        },
        { idPrefix: 'aud' }
      );

      return { updatedBatch: freshBatch, journalEntryId: jEntry.id, voucherNumber };
    }
  );
}

/**
 * Helper to get default original operating expense account details for fish production cost types.
 */
export function getFishCostOriginalExpenseInfo(costType: string): { code: string; nameBn: string; nameEn: string } {
  switch (costType) {
    case 'FEED':
      return {
        code: CANONICAL_ACCOUNTS.FEED_EXPENSE, // 6010
        nameBn: 'খাদ্য ও পুষ্টি খরচ (Feed & Nutrition Expense)',
        nameEn: 'Feed & Nutrition Expense'
      };
    case 'LABOUR':
      return {
        code: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES, // 6020
        nameBn: 'খামার শ্রমিকের মজুরি (Farm Labour Wages)',
        nameEn: 'Farm Labour Wages'
      };
    case 'MEDICINE':
      return {
        code: CANONICAL_ACCOUNTS.VET_MEDICINE, // 6040
        nameBn: 'চিকিৎসা ও ওষুধ (Veterinary & Medicine)',
        nameEn: 'Veterinary & Medicine'
      };
    case 'ELECTRICITY':
      return {
        code: CANONICAL_ACCOUNTS.ELECTRICITY, // 6060
        nameBn: 'বিদ্যুৎ ও জ্বালানি খরচ (Electricity & Fuel)',
        nameEn: 'Electricity & Fuel'
      };
    case 'WATER_TREATMENT':
      return {
        code: CANONICAL_ACCOUNTS.IRRIGATION, // 6070
        nameBn: 'পানি ও সেচ পরিচালন ব্যয় (Water Treatment & Irrigation)',
        nameEn: 'Water Treatment & Irrigation'
      };
    case 'FINGERLING':
    case 'OTHER':
    default:
      return {
        code: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, // 6150
        nameBn: 'বিবিধ খামার পরিচালন ব্যয় (Miscellaneous Farm Expense)',
        nameEn: 'Miscellaneous Expense'
      };
  }
}

/**
 * Builds balanced journal credit lines for capitalizing fish production costs into Biological Assets (1580)
 * by crediting the original expense accounts rather than Cash/Bank, preventing duplicate cash deductions or artificial cash credits.
 */
export async function buildFishExpenseCreditLines(
  freshBatch: FishBatch,
  amountToCredit: number,
  accounts: Account[],
  expenseAccountsMap?: Map<string, number>
): Promise<JournalLine[]> {
  let remaining = Math.round(amountToCredit * 100) / 100;
  const creditLines: JournalLine[] = [];

  // 1. First, credit any specific GL expense accounts previously debited for this batch
  if (expenseAccountsMap && expenseAccountsMap.size > 0) {
    for (const [expCode, netAmount] of expenseAccountsMap.entries()) {
      if (remaining <= 0) break;
      const reclassAmt = Math.min(remaining, netAmount);
      if (reclassAmt > 0) {
        let expAcc = accounts.find((a) => a.code === expCode);
        if (!expAcc) {
          const newAcc: Account = {
            id: `acc_${expCode}`,
            code: expCode,
            nameBn: 'পরিচালন ব্যয়',
            nameEn: 'Operating Expense',
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
          accounts.push(newAcc);
          expAcc = newAcc;
        }
        creditLines.push({
          accountId: expCode,
          accountCode: expCode,
          accountName: expAcc.nameBn || 'পরিচালন ব্যয়',
          debit: 0,
          credit: reclassAmt,
          memo: `মাছের ব্যাচ ${freshBatch.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় জৈবিক সম্পদে সমন্বয়`
        });
        remaining = Math.round((remaining - reclassAmt) * 100) / 100;
        expenseAccountsMap.set(expCode, Math.max(0, netAmount - reclassAmt));
      }
    }
  }

  // 2. If additional recorded costs remain to be credited, distribute across component original expense accounts
  if (remaining > 0) {
    const breakdown = calculateFishBatchRecordedCosts(freshBatch);
    const components: Array<{ type: string; amount: number; label: string }> = [
      { type: 'FEED', amount: breakdown.feedCost, label: 'মাছের খাদ্য খরচ' },
      { type: 'LABOUR', amount: breakdown.labourCost, label: 'শ্রমিক মজুরি' },
      { type: 'MEDICINE', amount: breakdown.medicineCost, label: 'ওষুধ ও চিকিৎসা' },
      { type: 'ELECTRICITY', amount: breakdown.electricityCost, label: 'বিদ্যুৎ খরচ' },
      { type: 'WATER_TREATMENT', amount: breakdown.waterTreatmentCost, label: 'পানি শোধন খরচ' },
      { type: 'FINGERLING', amount: breakdown.fingerlingCost, label: 'পোনা ক্রয় খরচ' },
      { type: 'OTHER', amount: breakdown.otherCost, label: 'অন্যান্য উৎপাদন খরচ' }
    ];

    for (const comp of components) {
      if (remaining <= 0) break;
      if (comp.amount > 0) {
        const allocAmt = Math.min(remaining, comp.amount);
        const expInfo = getFishCostOriginalExpenseInfo(comp.type);
        let expAcc = accounts.find((a) => a.code === expInfo.code);
        if (!expAcc) {
          const newAcc: Account = {
            id: `acc_${expInfo.code}`,
            code: expInfo.code,
            nameBn: expInfo.nameBn,
            nameEn: expInfo.nameEn,
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
          accounts.push(newAcc);
          expAcc = newAcc;
        }

        creditLines.push({
          accountId: expInfo.code,
          accountCode: expInfo.code,
          accountName: expAcc.nameBn || expInfo.nameBn,
          debit: 0,
          credit: allocAmt,
          memo: `মাছের ব্যাচ ${freshBatch.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় জৈবিক সম্পদে সমন্বয় (${comp.label})`
        });
        remaining = Math.round((remaining - allocAmt) * 100) / 100;
      }
    }
  }

  // 3. Any final unallocated fraction goes to Miscellaneous Expense (6150), never Cash/Bank
  if (remaining > 0) {
    const expInfo = getFishCostOriginalExpenseInfo('OTHER');
    let expAcc = accounts.find((a) => a.code === expInfo.code);
    if (!expAcc) {
      const newAcc: Account = {
        id: `acc_${expInfo.code}`,
        code: expInfo.code,
        nameBn: expInfo.nameBn,
        nameEn: expInfo.nameEn,
        accountClass: 'EXPENSE',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
      accounts.push(newAcc);
      expAcc = newAcc;
    }

    creditLines.push({
      accountId: expInfo.code,
      accountCode: expInfo.code,
      accountName: expAcc.nameBn || expInfo.nameBn,
      debit: 0,
      credit: remaining,
      memo: `মাছের ব্যাচ ${freshBatch.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় জৈবিক সম্পদে সমন্বয় (বিবিধ)`
    });
    remaining = 0;
  }

  return creditLines;
}

/**
 * Atomic Execution of Fish Batch Harvest and Sale
 * - Records harvest weight and mortality count
 * - Validates all accumulated costs across Fingerlings, Feed, Medicine, Labour, Electricity, Water Treatment, Other
 * - Ensures pre-harvest biological asset (1580) accumulation is synchronized to avoid orphaned credits
 * - Posts Revenue leg: Debit Cash/Bank/Receivable, Credit Fish Sales Revenue (4010)
 * - Posts Cost leg: Debit Fish COGS (5010), Debit Fish Mortality Loss (8030), Credit Biological Assets (1580) for accumulated costs
 * - Marks FishBatch status as HARVESTED
 */
export interface FishHarvestSaleParams {
  batchId: string;
  harvestWeightKg: number;
  mortalityCount?: number;
  salePrice: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  customerId?: string;
  customerName?: string;
  date?: string;
  notes?: string;
  currentUserId: string;
  isPartialHarvest?: boolean;
  harvestPortionRatio?: number;
  remainingEstimatedWeightKg?: number;
  remainingFingerlingQty?: number;
}

export async function executeFishHarvestAndSaleTransaction(
  params: FishHarvestSaleParams,
  dbInstance: any = db
): Promise<{
  updatedBatch: FishBatch;
  sale?: Sale;
  journalEntryId?: string;
  voucherNumber?: string;
  cogsJournalEntryId?: string;
  cogsVoucherNumber?: string;
  costTransferred?: number;
  cogsAmount?: number;
}> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.fishBatches,
      dbInstance.journalEntries,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.sales,
      dbInstance.auditLogs,
      dbInstance.closedPeriods,
      dbInstance.parties
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

      const closedPeriod = await dbInstance.closedPeriods
        .filter((p: any) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const freshBatch = await dbInstance.fishBatches.get(batchId);
      if (!freshBatch) {
        throw new Error(`মাছের ব্যাচ পাওয়া যায়নি (ID: ${batchId})।`);
      }
      if (freshBatch.status === 'HARVESTED' || freshBatch.status === 'CLOSED') {
        throw new Error(`এই মাছের ব্যাচটি (${freshBatch.id}) ইতিমধ্যে আহরণ ও বিক্রয় সম্পন্ন হয়েছে।`);
      }

      const cleanWeight = Math.max(0, Number(harvestWeightKg) || 0);
      const cleanMortality = Math.max(0, Number(mortalityCount) || 0);
      const cleanPrice = Math.max(0, Math.round((Number(salePrice) || 0) * 100) / 100);

      if (cleanWeight <= 0 && cleanPrice <= 0) {
        throw new Error('আহরণের ওজন অথবা বিক্রয়মূল্য অবশ্যই শূন্যের বেশি হতে হবে।');
      }

      // Prevent duplicate harvest: verify identical harvest transaction was not just processed
      const duplicateHarvestEntry = await dbInstance.journalEntries
        .filter((j: any) => {
          if (j.reference !== freshBatch.id || j.date !== dateStr) return false;
          return (j.lines || []).some(
            (l: any) =>
              (l.accountCode === CANONICAL_ACCOUNTS.FISH_REVENUE && cleanPrice > 0 && l.credit === cleanPrice) ||
              (l.accountCode === CANONICAL_ACCOUNTS.FISH_COGS && l.memo && l.memo.includes(freshBatch.id))
          );
        })
        .first();

      if (duplicateHarvestEntry) {
        const timeDiff = Math.abs(Date.now() - new Date(duplicateHarvestEntry.createdAt || '').getTime());
        if (timeDiff < 15000) {
          throw new Error(`এই মাছের ব্যাচের জন্য একই আহরণ ও বিক্রয়ের দাখিলা ইতিপূর্বে প্রক্রিয়াধীন হয়েছে (ভাউচার: ${duplicateHarvestEntry.voucherNumber || duplicateHarvestEntry.id})। ডুপ্লিকেট আহরণ প্রতিরোধ করা হয়েছে।`);
        }
      }

      // Validate payment source if BANK
      let bankAcc: CashBankAccount | undefined;
      if (paymentMethod === 'BANK' && cleanPrice > 0) {
        if (!bankAccountId) {
          throw new Error('ব্যাংক মাধ্যমে বিক্রয়ের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        bankAcc = await dbInstance.cashBankAccounts.get(bankAccountId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
      }

      const accounts = await dbInstance.accounts.toArray();

      // Ensure canonical accounts exist
      let fishRevAcc = accounts.find((a: Account) => a.code === CANONICAL_ACCOUNTS.FISH_REVENUE);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishRevAcc = newAcc;
      }

      let fishCogsAcc = accounts.find((a: Account) => a.code === CANONICAL_ACCOUNTS.FISH_COGS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishCogsAcc = newAcc;
      }

      let fishMortalityAcc = accounts.find((a: Account) => a.code === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        fishMortalityAcc = newAcc;
      }

      let assetAcc = accounts.find((a: Account) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      let wipAcc = accounts.find((a: Account) => a.code === CANONICAL_ACCOUNTS.WIP);
      if (!wipAcc) {
        const newAcc: Account = {
          id: 'acc_1054',
          code: CANONICAL_ACCOUNTS.WIP,
          nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          nameEn: 'Work in Progress (WIP)',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        wipAcc = newAcc;
      }

      // Step 1: Revenue Recognition Leg (Separate from Production Cost)
      // Follows payment method: Dr Cash/Bank/AR, Cr Fish Sales Revenue (4010)
      let revenueJournalEntryId: string | undefined;
      let revenueVoucherNumber: string | undefined;
      let saleRecord: Sale | undefined;

      if (cleanPrice > 0) {
        const paymentCode = getPaymentAccount(paymentMethod, 'SALE');
        const paymentAcc = accounts.find((a: Account) => a.code === paymentCode);

        const revenueLines: JournalLine[] = [
          {
            accountId: paymentCode,
            accountCode: paymentCode,
            accountName:
              paymentAcc?.nameBn ||
              (paymentMethod === 'CASH'
                ? 'নগদ টাকা (Cash on Hand)'
                : paymentMethod === 'BANK'
                ? 'ব্যাংক হিসাব (Bank Accounts)'
                : 'গ্রাহকের নিকট পাওনা (Accounts Receivable)'),
            debit: cleanPrice,
            credit: 0,
            memo: `মাছ বিক্রয় আদায় (${paymentMethod}): ${freshBatch.species} (${freshBatch.pondName})`
          },
          {
            accountId: CANONICAL_ACCOUNTS.FISH_REVENUE,
            accountCode: CANONICAL_ACCOUNTS.FISH_REVENUE,
            accountName: fishRevAcc.nameBn || 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
            debit: 0,
            credit: cleanPrice,
            memo: `মাছ বিক্রয় রাজস্ব: ব্যাচ ${freshBatch.id} (${cleanWeight} কেজি)`
          }
        ];

        const revCheck = validateBalancedLines(revenueLines, accounts);
        if (!revCheck.isBalanced) {
          throw new Error('মাছ বিক্রয় আয়ের জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        revenueVoucherNumber = generateTransactionNumber('SLF');
        const revJournalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_fish_sale'),
            voucherNumber: revenueVoucherNumber,
            voucherType: 'SALES',
            date: dateStr,
            narration: `মাছ বিক্রয় রাজস্ব: ব্যাচ ${freshBatch.id} (${freshBatch.species} - ${freshBatch.pondName}) - ওজন: ${cleanWeight} কেজি, বিক্রয়মূল্য: ৳${cleanPrice}`,
            reference: freshBatch.id,
            lines: revenueLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(dbInstance.journalEntries, revJournalEntry, { idPrefix: 'j' });
        revenueJournalEntryId = revJournalEntry.id;

        // Update Cash/Bank account balance
        if (paymentMethod === 'BANK' && bankAcc) {
          await dbInstance.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance + cleanPrice) * 100) / 100,
            synced: false
          });
        } else if (paymentMethod === 'CASH') {
          const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await dbInstance.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance + cleanPrice) * 100) / 100,
              synced: false
            });
          }
        }

        // Find or create customer party for AR tracking
        let customerParty: Party | undefined;
        if (params.customerId) {
          customerParty = await dbInstance.parties.get(params.customerId);
        }
        if (!customerParty && customerName?.trim()) {
          const trimmedName = customerName.trim().toLowerCase();
          const allParties: Party[] = await dbInstance.parties.toArray();
          customerParty = allParties.find(
            (p: Party) => (p.type === 'CUSTOMER' || p.type === 'BOTH') && p.name.trim().toLowerCase() === trimmedName
          );
        }
        if (!customerParty) {
          const defaultName = customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)';
          const allParties: Party[] = await dbInstance.parties.toArray();
          const existingParty = allParties.find((p: Party) => p.name.trim().toLowerCase() === defaultName.toLowerCase());
          if (existingParty) {
            customerParty = existingParty;
          } else {
            const newParty: Party = {
              id: generateUniqueId('pty'),
              type: 'CUSTOMER',
              name: defaultName,
              phone: '',
              balance: 0,
              isActive: true,
              synced: false
            };
            await safeInsert(dbInstance.parties, newParty, { idPrefix: 'pty' });
            customerParty = newParty;
          }
        }

        // Update Customer AR balance if credit sale
        if (paymentMethod === 'CREDIT' && customerParty) {
          await dbInstance.parties.update(customerParty.id, {
            balance: Math.round(((customerParty.balance || 0) + cleanPrice) * 100) / 100,
            synced: false
          });
        }

        // Create Sale record
        const fishDisplayNumber = await generateDisplayNumber('SAL', dateStr);
        saleRecord = {
          id: generateUniqueId('sal'),
          invoiceNumber: generateTransactionNumber('SAL'),
          displayNumber: fishDisplayNumber,
          date: dateStr,
          customerId: customerParty ? customerParty.id : 'WALK_IN_CUSTOMER',
          customerName: customerParty ? customerParty.name : (customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)'),
          category: 'FISH',
          items: [
            {
              itemId: freshBatch.id,
              itemName: `মাছ বিক্রয়: ${freshBatch.species} (${freshBatch.pondName})`,
              quantity: cleanWeight,
              unit: 'কেজি',
              unitPrice: cleanWeight > 0 ? Math.round((cleanPrice / cleanWeight) * 100) / 100 : cleanPrice,
              lineTotal: cleanPrice,
              cogsAmount: 0
            }
          ],
          subtotal: cleanPrice,
          totalAmount: cleanPrice,
          grandTotal: cleanPrice,
          paidAmount: paymentMethod === 'CREDIT' ? 0 : cleanPrice,
          dueAmount: paymentMethod === 'CREDIT' ? cleanPrice : 0,
          paymentMethod,
          bankAccountId: paymentMethod === 'BANK' ? bankAccountId : undefined,
          journalEntryId: revenueJournalEntryId,
          status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
          synced: false
        };
        await safeInsert(dbInstance.sales, saleRecord, { idPrefix: 'sal' });
      }

      // Step 2: Production Cost, COGS & Mortality Accounting
      // Requirement 3: Fish COGS must use actual accumulated production cost
      const recordedCosts = calculateFishBatchRecordedCosts(freshBatch);
      const totalRecordedCost = recordedCosts.totalRecordedCost;

      // Inspect existing journal entries referencing this fish batch
      const existingEntries = await dbInstance.journalEntries
        .filter((j: any) => j.reference === freshBatch.id || (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(freshBatch.id))))
        .toArray();

      // Requirement 6: Do NOT create a second COGS entry for costs already transferred
      let alreadyTransferredCogs = 0;
      let alreadyTransferredMortality = 0;
      let assetDebits1580 = 0;
      let assetCredits1580 = 0;
      let assetDebits1054 = 0;
      let assetCredits1054 = 0;
      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          // Strictly verify this line belongs to THIS fish batch to prevent cross-batch contamination
          const isLineForThisBatch = line.memo ? line.memo.includes(freshBatch.id) : (entry.reference === freshBatch.id);
          if (!isLineForThisBatch) continue;

          if (line.accountCode === CANONICAL_ACCOUNTS.FISH_COGS) {
            alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
          } else if (line.accountCode === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS) {
            alreadyTransferredMortality += (line.debit || 0) - (line.credit || 0);
          } else if (line.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
            assetDebits1580 += (line.debit || 0);
            assetCredits1580 += (line.credit || 0);
          } else if (line.accountCode === CANONICAL_ACCOUNTS.WIP) {
            assetDebits1054 += (line.debit || 0);
            assetCredits1054 += (line.credit || 0);
          } else if (
            line.accountCode === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            line.accountCode === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            line.accountCode === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            line.accountCode === CANONICAL_ACCOUNTS.ELECTRICITY ||
            line.accountCode === CANONICAL_ACCOUNTS.IRRIGATION ||
            line.accountCode === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(line.accountCode, (expenseAccountsMap.get(line.accountCode) || 0) + netExp);
            }
          }
        }
      }

      const totalAlreadyTransferred = Math.max(0, Math.round((alreadyTransferredCogs + alreadyTransferredMortality) * 100) / 100);
      const remainingCostToTransfer = Math.max(0, Math.round((totalRecordedCost - totalAlreadyTransferred) * 100) / 100);

      // Determine target asset account (1580 Livestock Assets or 1054 WIP)
      const net1580 = Math.max(0, Math.round((assetDebits1580 - assetCredits1580) * 100) / 100);
      const net1054 = Math.max(0, Math.round((assetDebits1054 - assetCredits1054) * 100) / 100);
      const targetAssetCode = net1054 > net1580 ? CANONICAL_ACCOUNTS.WIP : CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS;
      let currentAssetBalance = Math.round((net1580 + net1054) * 100) / 100;
      const targetAssetAcc = accounts.find((a) => a.code === targetAssetCode) || assetAcc;

      // Reclassify operating expenses into biological asset / WIP if costs were posted to GL expenses
      if (remainingCostToTransfer > currentAssetBalance && expensedDebit > 0) {
        const reclassLines: JournalLine[] = [];
        let reclassRemaining = Math.min(remainingCostToTransfer - currentAssetBalance, expensedDebit);
        reclassRemaining = Math.round(reclassRemaining * 100) / 100;
        let totalReclassed = 0;

        for (const [expCode, netAmount] of expenseAccountsMap.entries()) {
          if (reclassRemaining <= 0) break;
          const reclassAmt = Math.min(reclassRemaining, netAmount);
          if (reclassAmt > 0) {
            const expAcc = accounts.find((a) => a.code === expCode);
            reclassLines.push({
              accountId: expCode,
              accountCode: expCode,
              accountName: expAcc?.nameBn || 'পরিচালন ব্যয়',
              debit: 0,
              credit: reclassAmt,
              memo: `[RECLASSIFICATION] [${freshBatch.id}] মাছের ব্যাচ ${freshBatch.id} বিক্রয় বাবদ পরিচালন ব্যয় জৈবিক সম্পদে রূপান্তর`
            });
            totalReclassed += reclassAmt;
            reclassRemaining = Math.round((reclassRemaining - reclassAmt) * 100) / 100;
            expenseAccountsMap.set(expCode, Math.max(0, netAmount - reclassAmt));
          }
        }

        if (totalReclassed > 0) {
          reclassLines.unshift({
            accountId: targetAssetCode,
            accountCode: targetAssetCode,
            accountName: targetAssetAcc.nameBn || (targetAssetCode === CANONICAL_ACCOUNTS.WIP ? 'প্রক্রিয়াধীন পণ্য (WIP)' : 'জৈবিক সম্পদ'),
            debit: totalReclassed,
            credit: 0,
            memo: `[RECLASSIFICATION] [${freshBatch.id}] মাছের ব্যাচ ${freshBatch.id} পরিচালন ব্যয় থেকে জৈবিক সম্পদে রূপান্তর সমন্বয়`
          });

          const checkReclass = validateBalancedLines(reclassLines, accounts);
          if (checkReclass.isBalanced) {
            const reclassEntry = await postJournalEntry(
              {
                id: generateUniqueId('j_fish_asset'),
                voucherNumber: generateTransactionNumber('JV'),
                voucherType: 'JOURNAL',
                date: dateStr,
                narration: `মাছ চাষ ব্যয় সমন্বয় (Asset Reclassification): ব্যাচ ${freshBatch.id} (${freshBatch.species}) - ৳${totalReclassed}`,
                reference: freshBatch.id,
                lines: reclassLines,
                createdBy: currentUserId,
                createdAt: new Date().toISOString()
              },
              { accounts, skipDbPut: true }
            );
            await safeInsert(dbInstance.journalEntries, reclassEntry, { idPrefix: 'j' });
            currentAssetBalance = Math.round((currentAssetBalance + totalReclassed) * 100) / 100;
          }
        }
      }

      // Verification of source accounting debits specifically linked to THIS batch ID:
      // Never create an accounting entry only because an operational field contains a number.
      // If a cost exists operationally but has no source accounting transaction, report/reject the mismatch instead of inventing a credit.
      const isPartial = Boolean(params.isPartialHarvest);
      let portionRatio = 1;
      if (isPartial) {
        if (params.harvestPortionRatio !== undefined && params.harvestPortionRatio > 0) {
          portionRatio = Math.min(1, Math.max(0.0001, params.harvestPortionRatio));
        } else if (params.remainingEstimatedWeightKg !== undefined && (cleanWeight + params.remainingEstimatedWeightKg) > 0) {
          portionRatio = Math.min(1, Math.max(0.0001, cleanWeight / (cleanWeight + params.remainingEstimatedWeightKg)));
        } else if (freshBatch.currentEstimatedWeightKg && freshBatch.currentEstimatedWeightKg > 0 && cleanWeight > 0) {
          portionRatio = Math.min(1, Math.max(0.0001, cleanWeight / Math.max(cleanWeight, freshBatch.currentEstimatedWeightKg)));
        }
      }

      // Proportional cost calculation for partial harvest
      let costToTransfer = remainingCostToTransfer;
      if (isPartial && portionRatio < 1) {
        const proportionalCost = Math.round(remainingCostToTransfer * portionRatio * 100) / 100;
        costToTransfer = Math.min(remainingCostToTransfer, proportionalCost);
      }

      if (costToTransfer > currentAssetBalance) {
        const unbackedAmount = Math.round((costToTransfer - currentAssetBalance) * 100) / 100;
        throw new Error(
          `মাছের ব্যাচ ${freshBatch.id} এর উৎপাদন ব্যয়ে অমিল রয়েছে: স্থানান্তরযোগ্য ব্যয় ৳${costToTransfer}, কিন্তু সংশ্লিষ্ট অনুমোদিত জাবেদা সম্পদ ব্যালেন্স পাওয়া গেছে মাত্র ৳${currentAssetBalance} (অননুমোদিত বা হিসাবহীন ঘাটতি: ৳${unbackedAmount})। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রকৃত লেনদেন নথিভুক্ত করুন।`
        );
      }

      let cogsJournalEntryId: string | undefined;
      let cogsVoucherNumber: string | undefined;
      let harvestedCogs = 0;
      let mortalityCost = 0;

      if (costToTransfer > 0) {
        // Requirements 7 & 8: Defensible accumulated-cost mortality basis
        const totalStock = Math.max(1, freshBatch.fingerlingQty || 0);
        const mortalityRatio = Math.min(1, Math.max(0, cleanMortality / totalStock));
        mortalityCost = cleanMortality > 0 ? Math.round(costToTransfer * mortalityRatio * 100) / 100 : 0;
        harvestedCogs = Math.max(0, Math.round((costToTransfer - mortalityCost) * 100) / 100);

        // Requirement 4: Transfer from actual Fish production/WIP/biological asset account
        // Dr Fish COGS (5010), Dr Fish Mortality Loss (8030), Cr Biological Asset / WIP
        const cogsLines: JournalLine[] = [];

        if (harvestedCogs > 0) {
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.FISH_COGS,
            accountCode: CANONICAL_ACCOUNTS.FISH_COGS,
            accountName: fishCogsAcc.nameBn || 'বিক্রিত মাছের উৎপাদন ব্যয় (Fish COGS)',
            debit: harvestedCogs,
            credit: 0,
            memo: `মাছের ব্যাচ ${freshBatch.id}: আহরিত মাছের উৎপাদন ব্যয় (COGS)`
          });
        }

        if (mortalityCost > 0) {
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
            accountCode: CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS,
            accountName: fishMortalityAcc.nameBn || 'মাছের মৃত্যুজনিত ক্ষতি (Fish Mortality Loss)',
            debit: mortalityCost,
            credit: 0,
            memo: `মাছের ব্যাচ ${freshBatch.id}: মৃত মাছ অবলোপন (${cleanMortality} টি)`
          });
        }

        // Relieve applicable production inventory/WIP/biological asset accounts
        let reliefRemaining = costToTransfer;
        if (net1580 > 0 && reliefRemaining > 0) {
          const relief1580 = Math.min(reliefRemaining, net1580);
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: 0,
            credit: relief1580,
            memo: `মাছের ব্যাচ ${freshBatch.id}: আহরণ ও অবলোপন বাবদ পুঞ্জীভূত জৈবিক সম্পদ সমন্বয়`
          });
          reliefRemaining = Math.round((reliefRemaining - relief1580) * 100) / 100;
        }

        if (net1054 > 0 && reliefRemaining > 0) {
          const relief1054 = Math.min(reliefRemaining, net1054);
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.WIP,
            accountCode: CANONICAL_ACCOUNTS.WIP,
            accountName: wipAcc?.nameBn || 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
            debit: 0,
            credit: relief1054,
            memo: `মাছের ব্যাচ ${freshBatch.id}: আহরণ ও অবলোপন বাবদ পুঞ্জীভূত WIP সমন্বয়`
          });
          reliefRemaining = Math.round((reliefRemaining - relief1054) * 100) / 100;
        }

        if (reliefRemaining > 0) {
          cogsLines.push({
            accountId: targetAssetCode,
            accountCode: targetAssetCode,
            accountName: targetAssetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: 0,
            credit: reliefRemaining,
            memo: `মাছের ব্যাচ ${freshBatch.id}: আহরণ ও অবলোপন বাবদ পুঞ্জীভূত উৎপাদন খরচ সমন্বয়`
          });
        }

        const cogsCheck = validateBalancedLines(cogsLines, accounts);
        if (!cogsCheck.isBalanced) {
          throw new Error('মাছ উৎপাদন ব্যয় ও অবলোপন জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        cogsVoucherNumber = generateTransactionNumber('COGS');
        const cogsEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_fish_cogs'),
            voucherNumber: cogsVoucherNumber,
            voucherType: 'JOURNAL',
            date: dateStr,
            narration: `মাছ আহরণকালীন ব্যয় স্থানান্তর: ব্যাচ ${freshBatch.id} - COGS: ৳${harvestedCogs}${mortalityCost > 0 ? `, মৃত্যুজনিত ক্ষতি: ৳${mortalityCost}` : ''}, মোট খালাস: ৳${costToTransfer}${isPartial ? ' (আংশিক আহরণ)' : ''}`,
            reference: freshBatch.id,
            lines: cogsLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(dbInstance.journalEntries, cogsEntry, { idPrefix: 'j' });
        cogsJournalEntryId = cogsEntry.id;

        // If a sale record was created, update its cogsAmount
        if (saleRecord && saleRecord.items && saleRecord.items.length > 0) {
          saleRecord.items[0].cogsAmount = harvestedCogs;
          await dbInstance.sales.put(saleRecord);
        }
      }

      // Step 3: Requirements - Update batch record.
      // If partial harvest and remaining cost/stock exists, keep batch ACTIVE and retain unsold production.
      const isStillActive = isPartial && (params.remainingEstimatedWeightKg === undefined || params.remainingEstimatedWeightKg > 0);

      freshBatch.harvestWeightKg = Math.round(((freshBatch.harvestWeightKg || 0) + cleanWeight) * 100) / 100;
      freshBatch.mortalityCount = (freshBatch.mortalityCount || 0) + cleanMortality;
      freshBatch.harvestRevenue = Math.round(((freshBatch.harvestRevenue || 0) + cleanPrice) * 100) / 100;
      freshBatch.harvestDate = dateStr;

      if (isStillActive) {
        freshBatch.status = 'ACTIVE';
        if (params.remainingEstimatedWeightKg !== undefined) {
          freshBatch.currentEstimatedWeightKg = params.remainingEstimatedWeightKg;
        } else if (freshBatch.currentEstimatedWeightKg && freshBatch.currentEstimatedWeightKg > cleanWeight) {
          freshBatch.currentEstimatedWeightKg = Math.max(0, Math.round((freshBatch.currentEstimatedWeightKg - cleanWeight) * 100) / 100);
        }
        if (params.remainingFingerlingQty !== undefined) {
          freshBatch.fingerlingQty = params.remainingFingerlingQty;
        } else if (cleanMortality > 0 && freshBatch.fingerlingQty) {
          freshBatch.fingerlingQty = Math.max(0, freshBatch.fingerlingQty - cleanMortality);
        }
      } else {
        freshBatch.status = 'HARVESTED';
        freshBatch.currentEstimatedWeightKg = 0;
      }

      if (notes) {
        freshBatch.notes = freshBatch.notes ? `${freshBatch.notes} | ${notes.trim()}` : notes.trim();
      }
      freshBatch.synced = false;
      await dbInstance.fishBatches.put(freshBatch);

      // Audit Log
      await safeInsert(
        dbInstance.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'UPDATE',
          module: 'PRODUCTION',
          recordId: freshBatch.id,
          status: 'SUCCESS',
          details: `মাছ আহরণ ও বিক্রয় সম্পন্ন (${isStillActive ? 'আংশিক' : 'সম্পূর্ণ'}): ব্যাচ ${freshBatch.id}, ওজন ${cleanWeight} কেজি, বিক্রয় ৳${cleanPrice}, COGS ৳${harvestedCogs}${mortalityCost > 0 ? `, ক্ষতি ৳${mortalityCost}` : ''}`
        },
        { idPrefix: 'aud' }
      );

      return {
        updatedBatch: freshBatch,
        sale: saleRecord,
        journalEntryId: revenueJournalEntryId || cogsJournalEntryId,
        voucherNumber: revenueVoucherNumber || cogsVoucherNumber,
        cogsJournalEntryId,
        cogsVoucherNumber,
        costTransferred: costToTransfer,
        cogsAmount: harvestedCogs
      };
    }
  );
}

/**
 * Calculate detailed recorded production costs for a Crop Cycle.
 * Accumulates seed, fertilizer, irrigation, labour, crop protection, machinery, and other operational costs.
 */
export function calculateCropCycleRecordedCosts(cycle: CropCycle): CropCostBreakdown {
  const seedCost = Math.max(0, Number(cycle.seedCost) || 0);
  const fertilizerCost = Math.max(0, Number(cycle.fertilizerCost) || 0);
  const irrigationCost = Math.max(0, Number(cycle.irrigationCost) || 0);
  const labourCost = Math.max(0, Number(cycle.labourCost) || 0);
  const protectionCost = Math.max(0, Number((cycle as any).protectionCost ?? (cycle as any).cropProtectionCost) || 0);
  const machineryCost = Math.max(0, Number((cycle as any).machineryCost ?? (cycle as any).operationalCost) || 0);
  const otherCost = Math.max(0, Number(cycle.otherCost ?? (cycle as any).otherCosts) || 0);

  const sumComponents = Math.round(
    (seedCost + fertilizerCost + irrigationCost + labourCost + protectionCost + machineryCost + otherCost) * 100
  ) / 100;
  const totalCostField = Math.max(0, Number(cycle.totalCost) || 0);
  const totalRecordedCost = sumComponents > 0 ? sumComponents : Math.round(totalCostField * 100) / 100;

  return {
    seedCost,
    fertilizerCost,
    irrigationCost,
    labourCost,
    protectionCost,
    machineryCost,
    otherCost,
    totalRecordedCost
  };
}

export type { CropProductionCostParams };

/**
 * Atomic Execution of Crop Production Cost Transaction
 * - Debits Work in Progress (WIP - 1054) / Biological Assets (1580)
 * - Credits Cash / Bank / Accounts Payable / Seed & Fertilizer Inventory (1052)
 * - Updates CropCycle cost fields and totalCost
 * - Records balanced journal entry and audit log
 */
export async function executeCropProductionCostTransaction(
  params: CropProductionCostParams
): Promise<{ updatedCycle: CropCycle; journalEntryId: string; voucherNumber: string }> {
  return await db.transaction(
    'rw',
    [
      db.cropCycles,
      db.journalEntries,
      db.cashBankAccounts,
      db.inventoryItems,
      db.stockMovements,
      db.accounts,
      db.auditLogs,
      db.closedPeriods,
      db.parties
    ],
    async () => {
      const {
        cycleId,
        costType,
        amount,
        quantity,
        date,
        paymentMethod = 'CASH',
        bankAccountId,
        supplierId,
        inventoryItemId,
        notes,
        currentUserId
      } = params;

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`খরচের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
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
      if (freshCycle.status === 'HARVESTED' || freshCycle.status === 'CLOSED') {
        throw new Error(`সম্পন্ন বা বন্ধ শস্য চক্রে নতুন উৎপাদন খরচ যোগ করা যাবে না।`);
      }

      const cleanAmount = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
      if (cleanAmount <= 0) {
        throw new Error('খরচের পরিমাণ শূন্যের চেয়ে বেশি হতে হবে।');
      }

      const cleanQty = quantity ? Math.max(0, Number(quantity) || 0) : 0;

      const accounts = await db.accounts.toArray();

      // Ensure WIP Account (1054) exists
      let wipAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.WIP);
      if (!wipAcc) {
        const newAcc: Account = {
          id: 'acc_1054',
          code: CANONICAL_ACCOUNTS.WIP,
          nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          nameEn: 'Work in Progress',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        wipAcc = newAcc;
      }

      const costLabels: Record<string, string> = {
        SEED: 'বীজ ও চারা (Seeds & Seedlings)',
        FERTILIZER: 'সার ও মাটির পুষ্টি (Fertilizers & Nutrients)',
        IRRIGATION: 'সেচ ও পানি ব্যবস্থাপনা (Irrigation & Water Management)',
        LABOUR: 'শ্রমিক ও মজুরি (Farm Labour & Wages)',
        PROTECTION: 'ফসল রক্ষা ও কীটনাশক/চিকিৎসা (Crop Protection & Treatment)',
        MACHINERY: 'যন্ত্রপাতি ও চাষাবাদ পরিচালন (Machinery & Operational Costs)',
        OTHER: 'অন্যান্য শস্য উৎপাদন খরচ (Other Crop Production Costs)'
      };
      const costLabel = costLabels[costType] || 'শস্য উৎপাদন খরচ';

      let creditAccCode: string = CANONICAL_ACCOUNTS.CASH;
      let creditAccName = 'নগদ টাকা (Cash on Hand)';

      if (paymentMethod === 'INVENTORY') {
        if (!inventoryItemId) {
          throw new Error('ইনভেন্টরি থেকে ব্যবহারের জন্য আইটেম নির্বাচন আবশ্যক।');
        }
        const invItem = await db.inventoryItems.get(inventoryItemId);
        if (!invItem) {
          throw new Error('নির্বাচিত আইটেমটি ইনভেন্টরিতে পাওয়া যায়নি।');
        }
        if (cleanQty > 0 && invItem.currentStock < cleanQty) {
          throw new Error(`ইনভেন্টরিতে পর্যাপ্ত মজুদ নেই (মজুদ: ${invItem.currentStock} ${invItem.unit}, প্রয়োজন: ${cleanQty} ${invItem.unit})।`);
        }

        // Determine inventory asset account: 1051 Feed, 1052 Seed & Fertilizer, 1053 Raw Materials, etc.
        creditAccCode = getInventoryAssetAccount(invItem.category || costType);
        const invDetails = getInventoryAccountDetails(invItem.category || costType);
        creditAccName = invDetails.nameBn;

        let invAcc = accounts.find((a) => a.code === creditAccCode);
        if (!invAcc) {
          const newAcc: Account = {
            id: `acc_${creditAccCode}`,
            code: creditAccCode,
            nameBn: creditAccName,
            nameEn: creditAccName,
            accountClass: 'ASSET',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
          accounts.push(newAcc);
        }

        // Decrement inventory stock
        if (cleanQty > 0) {
          await db.inventoryItems.update(invItem.id, {
            currentStock: Math.max(0, Math.round((invItem.currentStock - cleanQty) * 1000) / 1000),
            synced: false
          });

          await safeInsert(
            db.stockMovements,
            {
              id: generateUniqueId('stk'),
              itemId: invItem.id,
              date: dateStr,
              movementType: 'CONSUMPTION',
              referenceId: freshCycle.id,
              quantity: cleanQty,
              unitCost: invItem.avgCostPrice || (cleanQty > 0 ? cleanAmount / cleanQty : 0),
              totalValue: cleanAmount,
              notes: notes || `শস্য চক্র ${freshCycle.id} (${freshCycle.cropName} - ${freshCycle.plotName}) উৎপাদন খরচ বাবদ ব্যবহার`
            },
            { idPrefix: 'stk' }
          );
        }
      } else if (paymentMethod === 'BANK') {
        const targetBankId = bankAccountId || (params as any).cashBankAccountId;
        if (!targetBankId) {
          throw new Error('ব্যাংক পরিশোধের জন্য ব্যাংক হিসাব নির্বাচন আবশ্যক।');
        }
        const bankAcc = await db.cashBankAccounts.get(targetBankId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি পাওয়া যায়নি।');
        }
        creditAccCode = CANONICAL_ACCOUNTS.BANK;
        creditAccName = 'ব্যাংক হিসাব (Bank Accounts)';

        await db.cashBankAccounts.update(bankAcc.id, {
          currentBalance: Math.round((bankAcc.currentBalance - cleanAmount) * 100) / 100,
          synced: false
        });
      } else if (paymentMethod === 'CREDIT') {
        creditAccCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE;
        creditAccName = 'সরবরাহকারীর নিকট দেনা (Accounts Payable)';

        if (supplierId) {
          const supplier = await db.parties.get(supplierId);
          if (supplier) {
            await db.parties.update(supplier.id, {
              balance: Math.round(((supplier.balance || 0) + cleanAmount) * 100) / 100,
              synced: false
            });
          }
        }
      } else {
        // CASH
        creditAccCode = CANONICAL_ACCOUNTS.CASH;
        creditAccName = 'নগদ টাকা (Cash on Hand)';

        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance - cleanAmount) * 100) / 100,
            synced: false
          });
        }
      }

      // Duplicate prevention: verify identical cost entry for this cycle hasn't already been posted
      const duplicateEntry = await db.journalEntries
        .filter((j) => {
          if (j.reference !== freshCycle.id || j.date !== dateStr) return false;
          return (j.lines || []).some(
            (l) =>
              l.debit === cleanAmount &&
              l.memo &&
              (l.memo.includes(`[${costType}]`) || l.memo.includes(costLabel))
          );
        })
        .first();

      if (duplicateEntry) {
        const timeDiff = Math.abs(Date.now() - new Date(duplicateEntry.createdAt || '').getTime());
        if (timeDiff < 10000 || (notes && duplicateEntry.narration && duplicateEntry.narration.includes(notes.trim()))) {
          throw new Error(`এই শস্য চক্রের জন্য একই খরচের দাখিলা (${costLabel}: ৳${cleanAmount}) ইতিপূর্বে সংরক্ষিত হয়েছে (ভাউচার: ${duplicateEntry.voucherNumber || duplicateEntry.id})। ডুপ্লিকেট এন্ট্রি প্রতিরোধ করা হয়েছে।`);
        }
      }

      // Journal entry: Debit WIP (1054), Credit payment/inventory account
      const journalLines: JournalLine[] = [
        {
          accountId: CANONICAL_ACCOUNTS.WIP,
          accountCode: CANONICAL_ACCOUNTS.WIP,
          accountName: wipAcc.nameBn || 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          debit: cleanAmount,
          credit: 0,
          memo: `[PRODUCTION_COST] [${costType}] [${freshCycle.id}] শস্য উৎপাদন ব্যয় (WIP): চক্র ${freshCycle.id} (${freshCycle.cropName}) - ${costLabel}`
        },
        {
          accountId: creditAccCode,
          accountCode: creditAccCode,
          accountName: creditAccName,
          debit: 0,
          credit: cleanAmount,
          memo: `[PRODUCTION_COST] [${costType}] [${freshCycle.id}] শস্য চাষ খরচ পরিশোধ: চক্র ${freshCycle.id} - ${costLabel}`
        }
      ];

      const balanceCheck = validateBalancedLines(journalLines, accounts);
      if (!balanceCheck.isBalanced) {
        throw new Error('শস্য উৎপাদন খরচ জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
      }

      const voucherType: VoucherType = paymentMethod === 'INVENTORY' || paymentMethod === 'CREDIT' ? 'JOURNAL' : 'PAYMENT';
      const prefix = paymentMethod === 'INVENTORY' ? 'JV' : paymentMethod === 'CREDIT' ? 'JV' : 'PAY';
      const voucherNumber = generateTransactionNumber(prefix);

      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_crop_cost'),
          voucherNumber,
          voucherType,
          date: dateStr,
          narration: `শস্য উৎপাদন খরচ: ${costLabel} - চক্র ${freshCycle.id} (${freshCycle.cropName} - ${freshCycle.plotName}), পরিমাণ: ৳${cleanAmount}${notes ? ` - ${notes}` : ''}`,
          reference: freshCycle.id,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

      // Update CropCycle cost fields
      if (costType === 'SEED') {
        freshCycle.seedCost = Math.round(((freshCycle.seedCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'FERTILIZER') {
        freshCycle.fertilizerCost = Math.round(((freshCycle.fertilizerCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'IRRIGATION') {
        freshCycle.irrigationCost = Math.round(((freshCycle.irrigationCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'LABOUR') {
        freshCycle.labourCost = Math.round(((freshCycle.labourCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'PROTECTION') {
        freshCycle.protectionCost = Math.round(((freshCycle.protectionCost || 0) + cleanAmount) * 100) / 100;
      } else if (costType === 'MACHINERY') {
        freshCycle.machineryCost = Math.round(((freshCycle.machineryCost || 0) + cleanAmount) * 100) / 100;
      } else {
        freshCycle.otherCost = Math.round(((freshCycle.otherCost || 0) + cleanAmount) * 100) / 100;
      }

      freshCycle.totalCost = calculateCropCycleRecordedCosts(freshCycle).totalRecordedCost;
      freshCycle.synced = false;
      await db.cropCycles.put(freshCycle);

      // Audit Log
      await safeInsert(
        db.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OPERATOR',
          action: 'CREATE',
          module: 'PRODUCTION',
          recordId: freshCycle.id,
          status: 'SUCCESS',
          details: `শস্য উৎপাদন খরচ লিপিবদ্ধ: চক্র ${freshCycle.id} (${costLabel}), পরিমাণ: ৳${cleanAmount}, ভাউচার: ${voucherNumber}`
        },
        { idPrefix: 'aud' }
      );

      return {
        updatedCycle: freshCycle,
        journalEntryId: journalEntry.id,
        voucherNumber
      };
    }
  );
}

export interface CropCycleCostStatus {
  cycleId: string;
  accumulatedCost: number;
  accountingDebits: number;
  expensedDebits: number;
  cogsTransferred: number;
  netRemainingCost: number;
  totalRecordedCost: number;
  unbackedCost: number;
  isConsistent: boolean;
  breakdown: CropCostBreakdown;
}

/**
 * Derives the legitimate accumulated production cost of a specific Crop Cycle.
 * Strictly calculates using cycle-specific transactions and prevents mixing with other cycles or global Account 1054.
 */
export async function getCropCycleAccumulatedCost(
  cycleId: string,
  dbInstance: any = db
): Promise<CropCycleCostStatus> {
  const freshCycle = await dbInstance.cropCycles.get(cycleId);
  const recordedBreakdown = freshCycle
    ? calculateCropCycleRecordedCosts(freshCycle)
    : {
        seedCost: 0,
        fertilizerCost: 0,
        irrigationCost: 0,
        labourCost: 0,
        protectionCost: 0,
        machineryCost: 0,
        otherCost: 0,
        totalRecordedCost: 0
      };

  const existingEntries = await dbInstance.journalEntries
    .filter(
      (j: any) =>
        j.reference === cycleId ||
        (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(cycleId)))
    )
    .toArray();

  let assetDebits1054 = 0;
  let assetCredits1054 = 0;
  let alreadyTransferredCogs = 0;
  let expensedDebits = 0;

  for (const entry of existingEntries) {
    for (const line of entry.lines || []) {
      const isLineForThisCycle = line.memo ? line.memo.includes(cycleId) : (entry.reference === cycleId);
      if (!isLineForThisCycle) continue;

      const code = line.accountCode;
      if (code === CANONICAL_ACCOUNTS.WIP || code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
        assetDebits1054 += (line.debit || 0);
        assetCredits1054 += (line.credit || 0);
      } else if (code === CANONICAL_ACCOUNTS.CROP_COGS) {
        alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
      } else if (
        code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
        code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
        code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
        code === CANONICAL_ACCOUNTS.ELECTRICITY ||
        code === CANONICAL_ACCOUNTS.IRRIGATION ||
        code === CANONICAL_ACCOUNTS.FUEL_TRANSPORT ||
        code === CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE ||
        code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
      ) {
        const netExp = (line.debit || 0) - (line.credit || 0);
        if (netExp > 0) {
          expensedDebits += netExp;
        }
      }
    }
  }

  const accountingDebits = Math.round(assetDebits1054 * 100) / 100;
  const cogsTransferred = Math.max(0, Math.round(alreadyTransferredCogs * 100) / 100);
  const netRemainingCost = Math.max(0, Math.round((assetDebits1054 - assetCredits1054) * 100) / 100);
  const totalRecordedCost = recordedBreakdown.totalRecordedCost;

  const totalBackedCost = Math.round((accountingDebits + expensedDebits) * 100) / 100;
  const unbackedCost = Math.max(0, Math.round((totalRecordedCost - totalBackedCost) * 100) / 100);
  const isConsistent = unbackedCost === 0;

  // Each Crop cycle has its own accumulated production cost, never based on shared WIP 1054 balance
  const accumulatedCost = totalRecordedCost > 0 ? totalRecordedCost : totalBackedCost;

  return {
    cycleId,
    accumulatedCost,
    accountingDebits,
    expensedDebits,
    cogsTransferred,
    netRemainingCost,
    totalRecordedCost,
    unbackedCost,
    isConsistent,
    breakdown: recordedBreakdown
  };
}

/**
 * Helper to get default original operating expense account details for crop production cost types.
 */
function getCropCostOriginalExpenseInfo(costType: string): { code: string; nameBn: string; nameEn: string } {
  switch (costType) {
    case 'LABOUR':
      return {
        code: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES, // 6020
        nameBn: 'খামার শ্রমিকের মজুরি (Farm Labour Wages)',
        nameEn: 'Farm Labour Wages'
      };
    case 'IRRIGATION':
      return {
        code: CANONICAL_ACCOUNTS.IRRIGATION, // 6070
        nameBn: 'সেচ ও পানি সরবরাহ খরচ (Irrigation & Water)',
        nameEn: 'Irrigation & Water Expense'
      };
    case 'PROTECTION':
      return {
        code: CANONICAL_ACCOUNTS.VET_MEDICINE, // 6040
        nameBn: 'চিকিৎসা ও ওষুধ / বালাইনাশক (Veterinary & Medicine / Crop Protection)',
        nameEn: 'Veterinary & Medicine'
      };
    case 'MACHINERY':
      return {
        code: CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE, // 6090
        nameBn: 'যন্ত্রপাতি মেরামত ও পরিচালন (Machinery & Maintenance)',
        nameEn: 'Repair & Maintenance'
      };
    case 'SEED':
    case 'FERTILIZER':
    case 'OTHER':
    default:
      return {
        code: CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE, // 6150
        nameBn: 'বিবিধ খামার পরিচালন ব্যয় (Miscellaneous Farm Expense)',
        nameEn: 'Miscellaneous Expense'
      };
  }
}

/**
 * Builds balanced journal credit lines for capitalizing crop production costs into WIP
 * by crediting the original expense accounts rather than Cash/Bank, preventing duplicate cash deductions.
 */
export async function buildCropExpenseCreditLines(
  freshCycle: CropCycle,
  amountToCredit: number,
  accounts: Account[],
  expenseAccountsMap?: Map<string, number>
): Promise<JournalLine[]> {
  let remaining = Math.round(amountToCredit * 100) / 100;
  const creditLines: JournalLine[] = [];

  // 1. First, credit any specific GL expense accounts previously debited for this cycle
  if (expenseAccountsMap && expenseAccountsMap.size > 0) {
    for (const [expCode, netAmount] of expenseAccountsMap.entries()) {
      if (remaining <= 0) break;
      const reclassAmt = Math.min(remaining, netAmount);
      if (reclassAmt > 0) {
        let expAcc = accounts.find((a) => a.code === expCode);
        if (!expAcc) {
          const newAcc: Account = {
            id: `acc_${expCode}`,
            code: expCode,
            nameBn: 'পরিচালন ব্যয়',
            nameEn: 'Operating Expense',
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
          accounts.push(newAcc);
          expAcc = newAcc;
        }
        creditLines.push({
          accountId: expCode,
          accountCode: expCode,
          accountName: expAcc.nameBn || 'পরিচালন ব্যয়',
          debit: 0,
          credit: reclassAmt,
          memo: `শস্য চক্র ${freshCycle.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় WIP-তে সমন্বয়`
        });
        remaining = Math.round((remaining - reclassAmt) * 100) / 100;
        expenseAccountsMap.set(expCode, Math.max(0, netAmount - reclassAmt));
      }
    }
  }

  // 2. If additional recorded costs remain to be credited, distribute across component original expense accounts
  if (remaining > 0) {
    const breakdown = calculateCropCycleRecordedCosts(freshCycle);
    const components: Array<{ type: string; amount: number; label: string }> = [
      { type: 'LABOUR', amount: breakdown.labourCost, label: 'শ্রমিক মজুরি' },
      { type: 'IRRIGATION', amount: breakdown.irrigationCost, label: 'সেচ খরচ' },
      { type: 'PROTECTION', amount: breakdown.protectionCost, label: 'বালাইনাশক/ফসল রক্ষা' },
      { type: 'MACHINERY', amount: breakdown.machineryCost, label: 'যন্ত্রপাতি পরিচালন' },
      { type: 'FERTILIZER', amount: breakdown.fertilizerCost, label: 'সার প্রয়োগ' },
      { type: 'SEED', amount: breakdown.seedCost, label: 'বীজ/চারা খরচ' },
      { type: 'OTHER', amount: breakdown.otherCost, label: 'অন্যান্য উৎপাদন খরচ' }
    ];

    for (const comp of components) {
      if (remaining <= 0) break;
      if (comp.amount > 0) {
        const allocAmt = Math.min(remaining, comp.amount);
        const expInfo = getCropCostOriginalExpenseInfo(comp.type);
        let expAcc = accounts.find((a) => a.code === expInfo.code);
        if (!expAcc) {
          const newAcc: Account = {
            id: `acc_${expInfo.code}`,
            code: expInfo.code,
            nameBn: expInfo.nameBn,
            nameEn: expInfo.nameEn,
            accountClass: 'EXPENSE',
            normalBalance: 'DEBIT',
            isSystem: true,
            isActive: true
          };
          await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
          accounts.push(newAcc);
          expAcc = newAcc;
        }

        creditLines.push({
          accountId: expInfo.code,
          accountCode: expInfo.code,
          accountName: expAcc.nameBn || expInfo.nameBn,
          debit: 0,
          credit: allocAmt,
          memo: `শস্য চক্র ${freshCycle.id}: পূর্বে পরিশোধিত পরিচালন ব্যয় WIP-তে সমন্বয় (${comp.label})`
        });
        remaining = Math.round((remaining - allocAmt) * 100) / 100;
      }
    }
  }

  // 3. Any final unallocated fraction goes to Miscellaneous Expense (6150), never Cash/Bank
  if (remaining > 0) {
    const expInfo = getCropCostOriginalExpenseInfo('OTHER');
    let expAcc = accounts.find((a) => a.code === expInfo.code);
    if (!expAcc) {
      const newAcc: Account = {
        id: `acc_${expInfo.code}`,
        code: expInfo.code,
        nameBn: expInfo.nameBn,
        nameEn: expInfo.nameEn,
        accountClass: 'EXPENSE',
        normalBalance: 'DEBIT',
        isSystem: true,
        isActive: true
      };
      await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
      accounts.push(newAcc);
      expAcc = newAcc;
    }

    creditLines.push({
      accountId: expInfo.code,
      accountCode: expInfo.code,
      accountName: expAcc.nameBn || expInfo.nameBn,
      debit: 0,
      credit: remaining,
      memo: `শস্য চক্র ${freshCycle.id}: পূর্বে পরিশোধিত উৎপাদন ব্যয় WIP-তে সমন্বয়`
    });
    remaining = 0;
  }

  return creditLines;
}

/**
 * Integrate legitimate recorded production costs on a CropCycle into accounting WIP before harvest.
 * Checks General Ledger strictly by cycle ID to verify whether costs have already been capitalized to WIP (1054)
 * or transferred to COGS. Any reclassification of previously paid and expensed costs debits Crop WIP (1054)
 * and credits the original Expense accounts (Dr Crop WIP / Cr original Expense) — NEVER crediting Cash/Bank,
 * preventing artificial double-payment of cash and preventing duplicate costs.
 */
export async function integrateCropProductionCostAccounting(
  cycleId: string,
  currentUserId: string = 'system-user',
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT' = 'CASH'
): Promise<{ journalEntryId?: string; voucherNumber?: string; integratedAmount: number }> {
  return await db.transaction(
    'rw',
    [
      db.cropCycles,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const freshCycle = await db.cropCycles.get(cycleId);
      if (!freshCycle) {
        throw new Error(`শস্য চক্র পাওয়া যায়নি (ID: ${cycleId})।`);
      }

      const recordedCosts = calculateCropCycleRecordedCosts(freshCycle);
      const totalRecordedCost = recordedCosts.totalRecordedCost;
      if (totalRecordedCost <= 0) {
        return { integratedAmount: 0 };
      }

      const existingEntries = await db.journalEntries
        .filter(
          (j) =>
            j.reference === freshCycle.id ||
            (j.lines && j.lines.some((l) => l.memo && l.memo.includes(freshCycle.id)))
        )
        .toArray();

      let alreadyCapitalizedWip = 0;
      let alreadyTransferredCogs = 0;
      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          // Strictly verify this line belongs to THIS crop cycle to prevent cross-cycle contamination
          const isLineForThisCycle = line.memo ? line.memo.includes(freshCycle.id) : (entry.reference === freshCycle.id);
          if (!isLineForThisCycle) continue;

          const code = line.accountCode;
          if (code === CANONICAL_ACCOUNTS.WIP || code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
            alreadyCapitalizedWip += (line.debit || 0) - (line.credit || 0);
          } else if (code === CANONICAL_ACCOUNTS.CROP_COGS) {
            alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
          } else if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.ELECTRICITY ||
            code === CANONICAL_ACCOUNTS.IRRIGATION ||
            code === CANONICAL_ACCOUNTS.FUEL_TRANSPORT ||
            code === CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      alreadyCapitalizedWip = Math.max(0, Math.round(alreadyCapitalizedWip * 100) / 100);
      alreadyTransferredCogs = Math.max(0, Math.round(alreadyTransferredCogs * 100) / 100);

      // If already fully capitalized or transferred, no integration needed
      const missingWip = Math.max(
        0,
        Math.round((totalRecordedCost - (alreadyCapitalizedWip + alreadyTransferredCogs)) * 100) / 100
      );

      if (missingWip <= 0) {
        return { integratedAmount: 0 };
      }

      const accounts = await db.accounts.toArray();
      let wipAcc = accounts.find((a) => a.code === CANONICAL_ACCOUNTS.WIP);
      if (!wipAcc) {
        const newAcc: Account = {
          id: 'acc_1054',
          code: CANONICAL_ACCOUNTS.WIP,
          nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          nameEn: 'Work in Progress',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(db.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        wipAcc = newAcc;
      }

      // Reclassify previously paid and expensed costs into WIP: Dr Crop WIP / Cr original Expense (NEVER Cash/Bank)
      if (expenseAccountsMap && expenseAccountsMap.size > 0 && expensedDebit > 0) {
        const reclassAmt = Math.min(missingWip, expensedDebit);
        const creditLines = await buildCropExpenseCreditLines(freshCycle, reclassAmt, accounts, expenseAccountsMap);

        const journalLines: JournalLine[] = [
          {
            accountId: CANONICAL_ACCOUNTS.WIP,
            accountCode: CANONICAL_ACCOUNTS.WIP,
            accountName: wipAcc.nameBn || 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
            debit: reclassAmt,
            credit: 0,
            memo: `[RECLASSIFICATION] [${freshCycle.id}] শস্য উৎপাদন ব্যয় WIP-তে সমন্বয়: চক্র ${freshCycle.id} (${freshCycle.cropName})`
          },
          ...creditLines
        ];

        const balanceCheck = validateBalancedLines(journalLines, accounts);
        if (!balanceCheck.isBalanced) {
          throw new Error('শস্য WIP হিসাবভুক্তকরণ জাবেদা ভারসাম্যহীন!');
        }

        const dateStr = freshCycle.plantingDate || new Date().toISOString().split('T')[0];
        const voucherNumber = generateTransactionNumber('JV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_crop_wip'),
            voucherNumber,
            voucherType: 'JOURNAL',
            date: dateStr,
            narration: `শস্য উৎপাদন ব্যয় সমন্বয় (WIP Reclassification): চক্র ${freshCycle.id} (${freshCycle.cropName} - ${freshCycle.plotName}) - ৳${reclassAmt}`,
            reference: freshCycle.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

        const remainingMissing = Math.round((missingWip - reclassAmt) * 100) / 100;
        if (remainingMissing > 0) {
          throw new Error(
            `শস্য চক্র ${freshCycle.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এবং অনুমোদিত জাবেদা ব্যালেন্সের মাঝে ৳${remainingMissing} এর অমিল রয়েছে। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
          );
        }

        return {
          journalEntryId: journalEntry.id,
          voucherNumber,
          integratedAmount: reclassAmt
        };
      }

      // If no legitimate source expense entries exist to reclassify, do NOT invent entries from operational totals!
      throw new Error(
        `শস্য চক্র ${freshCycle.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এর বিপরীতে কোনো উৎস হিসাব লেনদেন পাওয়া যায়নি। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
      );
    }
  );
}

/**
 * Reclassify existing expense transactions for a specific Crop cycle to WIP.
 * Dr WIP (1054) / Cr Original Expense (6020, 6070, 6040, etc.), NEVER Cash or Bank.
 */
export async function reclassifyCropExpenseToWip(
  cycleId: string,
  currentUserId: string = 'system-user',
  dbInstance: any = db
): Promise<{ journalEntryId?: string; voucherNumber?: string; reclassifiedAmount: number }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.cropCycles,
      dbInstance.journalEntries,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const freshCycle = await dbInstance.cropCycles.get(cycleId);
      if (!freshCycle) {
        throw new Error(`শস্য চক্র পাওয়া যায়নি (ID: ${cycleId})।`);
      }

      const existingEntries = await dbInstance.journalEntries
        .filter(
          (j: any) =>
            j.reference === freshCycle.id ||
            (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(freshCycle.id)))
        )
        .toArray();

      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          const isLineForThisCycle = line.memo ? line.memo.includes(freshCycle.id) : (entry.reference === freshCycle.id);
          if (!isLineForThisCycle) continue;

          const code = line.accountCode;
          if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.ELECTRICITY ||
            code === CANONICAL_ACCOUNTS.IRRIGATION ||
            code === CANONICAL_ACCOUNTS.FUEL_TRANSPORT ||
            code === CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      if (expensedDebit <= 0 || expenseAccountsMap.size === 0) {
        return { reclassifiedAmount: 0 };
      }

      const accounts = await dbInstance.accounts.toArray();
      let wipAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.WIP);
      if (!wipAcc) {
        const newAcc: Account = {
          id: 'acc_1054',
          code: CANONICAL_ACCOUNTS.WIP,
          nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          nameEn: 'Work in Progress',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        wipAcc = newAcc;
      }

      const reclassLines: JournalLine[] = [];
      let totalReclassed = 0;

      for (const [expCode, netAmount] of expenseAccountsMap.entries()) {
        if (netAmount > 0) {
          const expAcc = accounts.find((a: any) => a.code === expCode);
          reclassLines.push({
            accountId: expCode,
            accountCode: expCode,
            accountName: expAcc?.nameBn || 'পরিচালন ব্যয়',
            debit: 0,
            credit: netAmount,
            memo: `[RECLASSIFICATION] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} পূর্বে পরিশোধিত পরিচালন ব্যয় WIP-তে রূপান্তর`
          });
          totalReclassed += netAmount;
        }
      }

      totalReclassed = Math.round(totalReclassed * 100) / 100;
      if (totalReclassed <= 0) {
        return { reclassifiedAmount: 0 };
      }

      reclassLines.unshift({
        accountId: CANONICAL_ACCOUNTS.WIP,
        accountCode: CANONICAL_ACCOUNTS.WIP,
        accountName: wipAcc.nameBn || 'প্রক্রিয়াধীন পণ্য (WIP)',
        debit: totalReclassed,
        credit: 0,
        memo: `[RECLASSIFICATION] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} পরিচালন ব্যয় থেকে WIP রূপান্তর সমন্বয়`
      });

      const checkReclass = validateBalancedLines(reclassLines, accounts);
      if (!checkReclass.isBalanced) {
        throw new Error('শস্য ব্যয় রূপান্তর জাবেদা ভারসাম্যহীন!');
      }

      const dateStr = freshCycle.plantingDate || new Date().toISOString().split('T')[0];
      const voucherNumber = generateTransactionNumber('JV');
      const reclassEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_reclass'),
          voucherNumber,
          voucherType: 'ADJUSTMENT',
          date: dateStr,
          narration: `শস্য চাষ ব্যয় সমন্বয় (Reclassification to WIP): চক্র ${freshCycle.id} (${freshCycle.cropName}) - মোট: ৳${totalReclassed}`,
          reference: freshCycle.id,
          lines: reclassLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(dbInstance.journalEntries, reclassEntry, { idPrefix: 'j' });

      // Audit Log
      await safeInsert(
        dbInstance.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'ACCOUNTANT',
          action: 'UPDATE',
          module: 'ACCOUNTING',
          recordId: freshCycle.id,
          status: 'SUCCESS',
          details: `শস্য চক্র ${freshCycle.id} পূর্বে পরিশোধিত ব্যয় (৳${totalReclassed}) সফলভাবে WIP-তে রূপান্তর করা হয়েছে। ভাউচার: ${voucherNumber}`
        },
        { idPrefix: 'aud' }
      );

      return {
        journalEntryId: reclassEntry.id,
        voucherNumber,
        reclassifiedAmount: totalReclassed
      };
    }
  );
}

/**
 * Integrate legitimate recorded production costs on a FishBatch into accounting Biological Assets (1580) before harvest.
 * Checks General Ledger strictly by batch ID to verify whether costs have already been capitalized to Biological Assets (1580),
 * avoiding duplicate entries while ensuring full traceable cost accumulation per batch.
 */
export async function integrateFishProductionCostAccounting(
  batchId: string,
  currentUserId: string = 'system-user',
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT' = 'CASH'
): Promise<{ journalEntryId?: string; voucherNumber?: string; integratedAmount: number }> {
  return await db.transaction(
    'rw',
    [
      db.fishBatches,
      db.journalEntries,
      db.cashBankAccounts,
      db.accounts,
      db.auditLogs,
      db.closedPeriods
    ],
    async () => {
      const freshBatch = await db.fishBatches.get(batchId);
      if (!freshBatch) {
        throw new Error(`মাছের ব্যাচ পাওয়া যায়নি (ID: ${batchId})।`);
      }

      const recordedCosts = calculateFishBatchRecordedCosts(freshBatch);
      const totalRecordedCost = recordedCosts.totalRecordedCost;
      if (totalRecordedCost <= 0) {
        return { integratedAmount: 0 };
      }

      const existingEntries = await db.journalEntries
        .filter(
          (j) =>
            j.reference === freshBatch.id ||
            (j.lines && j.lines.some((l) => l.memo && l.memo.includes(freshBatch.id)))
        )
        .toArray();

      let alreadyCapitalizedAsset = 0;
      let alreadyTransferredCogs = 0;
      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          const isLineForThisBatch = line.memo ? line.memo.includes(freshBatch.id) : (entry.reference === freshBatch.id);
          if (!isLineForThisBatch) continue;

          const code = line.accountCode;
          if (code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS || code === CANONICAL_ACCOUNTS.WIP) {
            alreadyCapitalizedAsset += (line.debit || 0) - (line.credit || 0);
          } else if (code === CANONICAL_ACCOUNTS.FISH_COGS || code === CANONICAL_ACCOUNTS.FISH_MORTALITY_LOSS) {
            alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
          } else if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.ELECTRICITY ||
            code === CANONICAL_ACCOUNTS.IRRIGATION ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      alreadyCapitalizedAsset = Math.max(0, Math.round(alreadyCapitalizedAsset * 100) / 100);
      alreadyTransferredCogs = Math.max(0, Math.round(alreadyTransferredCogs * 100) / 100);

      const missingAsset = Math.max(
        0,
        Math.round((totalRecordedCost - (alreadyCapitalizedAsset + alreadyTransferredCogs)) * 100) / 100
      );

      if (missingAsset <= 0) {
        return { integratedAmount: 0 };
      }

      const accounts = await db.accounts.toArray();
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

      // Reclassify previously paid and expensed costs into Biological Assets (1580): Dr Biological Assets / Cr original Expense (NEVER Cash/Bank)
      if (expenseAccountsMap && expenseAccountsMap.size > 0 && expensedDebit > 0) {
        const reclassAmt = Math.min(missingAsset, expensedDebit);
        const creditLines = await buildFishExpenseCreditLines(freshBatch, reclassAmt, accounts, expenseAccountsMap);

        const journalLines: JournalLine[] = [
          {
            accountId: assetAcc.id,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: reclassAmt,
            credit: 0,
            memo: `[RECLASSIFICATION] [${freshBatch.id}] মাছ চাষ ব্যয় জৈবিক সম্পদে সমন্বয়: ব্যাচ ${freshBatch.id} (${freshBatch.species})`
          },
          ...creditLines
        ];

        const balanceCheck = validateBalancedLines(journalLines, accounts);
        if (!balanceCheck.isBalanced) {
          throw new Error('মাছের জৈবিক সম্পদ হিসাবভুক্তকরণ জাবেদা ভারসাম্যহীন!');
        }

        const dateStr = freshBatch.stockingDate || new Date().toISOString().split('T')[0];
        const voucherNumber = generateTransactionNumber('JV');
        const journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_fish_asset'),
            voucherNumber,
            voucherType: 'JOURNAL',
            date: dateStr,
            narration: `মাছ উৎপাদন ব্যয় সমন্বয় (Asset Reclassification): ব্যাচ ${freshBatch.id} (${freshBatch.species} - ${freshBatch.pondName}) - ৳${reclassAmt}`,
            reference: freshBatch.id,
            lines: journalLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(db.journalEntries, journalEntry, { idPrefix: 'j' });

        const remainingMissing = Math.round((missingAsset - reclassAmt) * 100) / 100;
        if (remainingMissing > 0) {
          throw new Error(
            `মাছের ব্যাচ ${freshBatch.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এবং অনুমোদিত জাবেদা ব্যালেন্সের মাঝে ৳${remainingMissing} এর অমিল রয়েছে। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
          );
        }

        return {
          journalEntryId: journalEntry.id,
          voucherNumber,
          integratedAmount: reclassAmt
        };
      }

      // If no legitimate source expense entries exist to reclassify, do NOT invent entries from operational totals!
      throw new Error(
        `মাছের ব্যাচ ${freshBatch.id} এর অপারেশনাল ব্যয় (৳${totalRecordedCost}) এবং অনুমোদিত জাবেদা ব্যালেন্সের মাঝে ৳${missingAsset} এর অমিল রয়েছে। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রতিটি খরচের বিপরীতে প্রকৃত লেনদেন ভাউচার এন্ট্রি করুন।`
      );
    }
  );
}

/**
 * Reclassify existing expense transactions for a specific Fish batch to Biological Assets (1580).
 * Dr Biological Assets (1580) / Cr Original Expense (6010, 6020, 6040, 6030, 6070, 6090), NEVER Cash or Bank.
 * Strictly prevents artificial cash credits, negative expense balances, or double-counting.
 */
export async function reclassifyFishExpenseToBiologicalAsset(
  batchId: string,
  currentUserId: string = 'system-user',
  dbInstance: any = db
): Promise<{ journalEntryId?: string; voucherNumber?: string; reclassifiedAmount: number }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.fishBatches,
      dbInstance.journalEntries,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const freshBatch = await dbInstance.fishBatches.get(batchId);
      if (!freshBatch) {
        throw new Error(`মাছের ব্যাচ পাওয়া যায়নি (ID: ${batchId})।`);
      }

      const existingEntries = await dbInstance.journalEntries
        .filter(
          (j: any) =>
            j.reference === freshBatch.id ||
            (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(freshBatch.id)))
        )
        .toArray();

      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          const isLineForThisBatch = line.memo ? line.memo.includes(freshBatch.id) : (entry.reference === freshBatch.id);
          if (!isLineForThisBatch) continue;

          const code = line.accountCode;
          if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.ELECTRICITY ||
            code === CANONICAL_ACCOUNTS.IRRIGATION ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      expensedDebit = Math.max(0, Math.round(expensedDebit * 100) / 100);
      if (expensedDebit <= 0) {
        return { reclassifiedAmount: 0 };
      }

      const accounts = await dbInstance.accounts.toArray();
      let assetAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      const creditLines = await buildFishExpenseCreditLines(freshBatch, expensedDebit, accounts, expenseAccountsMap);

      const journalLines: JournalLine[] = [
        {
          accountId: assetAcc.id,
          accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
          accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
          debit: expensedDebit,
          credit: 0,
          memo: `[RECLASSIFICATION] [${freshBatch.id}] মাছ চাষের ব্যয় জৈবিক সম্পদে রূপান্তর: ব্যাচ ${freshBatch.id} (${freshBatch.species})`
        },
        ...creditLines
      ];

      const balanceCheck = validateBalancedLines(journalLines, accounts);
      if (!balanceCheck.isBalanced) {
        throw new Error('মাছ চাষ ব্যয় সমন্বয় জাবেদা ভারসাম্যহীন!');
      }

      const dateStr = freshBatch.stockingDate || new Date().toISOString().split('T')[0];
      const voucherNumber = generateTransactionNumber('JV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_fish_asset'),
          voucherNumber,
          voucherType: 'JOURNAL',
          date: dateStr,
          narration: `মাছ চাষ ব্যয় সমন্বয় (Asset Reclassification): ব্যাচ ${freshBatch.id} (${freshBatch.species} - ${freshBatch.pondName}) - ৳${expensedDebit}`,
          reference: freshBatch.id,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      return {
        journalEntryId: journalEntry.id,
        voucherNumber,
        reclassifiedAmount: expensedDebit
      };
    }
  );
}

/**
 * Atomic Execution of Crop Cycle Harvest and Sale
 * - Records harvest yield (kg) and actual harvest date
 * - Posts Revenue leg: Debit Cash/Bank/Receivable, Credit Crop Sales Revenue (4040)
 * - Capitalizes any unposted legitimate recorded costs / reclassifies period expenses to WIP
 * - Posts Cost leg: Debit Crop COGS (5030), Credit Work In Progress (1054) / Biological Assets (1580)
 * - Marks CropCycle status as HARVESTED
 */
export interface CropHarvestSaleParams {
  cycleId: string;
  harvestYieldKg: number;
  salePrice: number;
  paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
  bankAccountId?: string;
  customerId?: string;
  customerName?: string;
  date?: string;
  notes?: string;
  currentUserId?: string;
  isPartialHarvest?: boolean;
  harvestPortionRatio?: number;
  remainingAreaDecimals?: number;
}

export async function executeCropHarvestAndSaleTransaction(
  params: CropHarvestSaleParams,
  dbInstance: any = db
): Promise<{
  updatedCycle: CropCycle;
  sale?: Sale;
  journalEntryId?: string;
  voucherNumber?: string;
  cogsJournalEntryId?: string;
  cogsVoucherNumber?: string;
  costTransferred?: number;
}> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.cropCycles,
      dbInstance.journalEntries,
      dbInstance.cashBankAccounts,
      dbInstance.accounts,
      dbInstance.sales,
      dbInstance.auditLogs,
      dbInstance.closedPeriods,
      dbInstance.parties
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

      const closedPeriod = await dbInstance.closedPeriods
        .filter((p: any) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const freshCycle = await dbInstance.cropCycles.get(cycleId);
      if (!freshCycle) {
        throw new Error(`শস্য চক্র পাওয়া যায়নি (ID: ${cycleId})।`);
      }
      if (freshCycle.status === 'HARVESTED' || freshCycle.status === 'CLOSED') {
        throw new Error(`এই শস্য চক্রটি (${freshCycle.id}) ইতিমধ্যে কর্তন ও বিক্রয় সম্পন্ন হয়েছে।`);
      }

      const cleanYield = Math.max(0, Number(harvestYieldKg) || 0);
      const cleanPrice = Math.max(0, Math.round((Number(salePrice) || 0) * 100) / 100);

      if (cleanYield <= 0 && cleanPrice <= 0) {
        throw new Error('কর্তনের ফলন অথবা বিক্রয়মূল্য অবশ্যই শূন্যের বেশি হতে হবে।');
      }

      // Prevent duplicate harvest: verify identical harvest transaction was not just processed
      const duplicateHarvestEntry = await dbInstance.journalEntries
        .filter((j: any) => {
          if (j.reference !== freshCycle.id || j.date !== dateStr) return false;
          return (j.lines || []).some(
            (l: any) =>
              (l.accountCode === CANONICAL_ACCOUNTS.CROP_REVENUE && cleanPrice > 0 && l.credit === cleanPrice) ||
              (l.accountCode === CANONICAL_ACCOUNTS.CROP_COGS && l.memo && l.memo.includes(freshCycle.id))
          );
        })
        .first();

      if (duplicateHarvestEntry) {
        const timeDiff = Math.abs(Date.now() - new Date(duplicateHarvestEntry.createdAt || '').getTime());
        if (timeDiff < 15000) {
          throw new Error(`এই শস্য চক্রের জন্য একই কর্তন ও বিক্রয়ের দাখিলা ইতিপূর্বে প্রক্রিয়াধীন হয়েছে (ভাউচার: ${duplicateHarvestEntry.voucherNumber || duplicateHarvestEntry.id})। ডুপ্লিকেট কর্তন প্রতিরোধ করা হয়েছে।`);
        }
      }

      // Validate payment source if BANK
      let bankAcc: CashBankAccount | undefined;
      if (paymentMethod === 'BANK' && cleanPrice > 0) {
        const targetBankId = bankAccountId || (params as any).cashBankAccountId;
        if (!targetBankId) {
          throw new Error('ব্যাংক মাধ্যমে বিক্রয়ের জন্য ব্যাংক হিসাব নির্বাচন করা আবশ্যক।');
        }
        bankAcc = await dbInstance.cashBankAccounts.get(targetBankId);
        if (!bankAcc) {
          throw new Error('নির্বাচিত ব্যাংক হিসাবটি ডাটাবেজে পাওয়া যায়নি।');
        }
      }

      const accounts = await dbInstance.accounts.toArray();

      // Ensure accounts exist
      let cropRevAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.CROP_REVENUE);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        cropRevAcc = newAcc;
      }

      let cropCogsAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.CROP_COGS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        cropCogsAcc = newAcc;
      }

      let wipAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.WIP);
      if (!wipAcc) {
        const newAcc: Account = {
          id: 'acc_1054',
          code: CANONICAL_ACCOUNTS.WIP,
          nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
          nameEn: 'Work in Progress',
          accountClass: 'ASSET',
          normalBalance: 'DEBIT',
          isSystem: true,
          isActive: true
        };
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        wipAcc = newAcc;
      }

      let assetAcc = accounts.find((a: any) => a.code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS);
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
        await safeInsert(dbInstance.accounts, newAcc, { idPrefix: 'acc' });
        accounts.push(newAcc);
        assetAcc = newAcc;
      }

      // 1. Calculate full recorded production cost
      const recordedCosts = calculateCropCycleRecordedCosts(freshCycle);
      const totalRecordedCost = recordedCosts.totalRecordedCost;

      // 2. Inspect existing journal entries referencing this crop cycle to prevent duplicate GL postings
      const existingEntries = await dbInstance.journalEntries
        .filter(
          (j: any) =>
            j.reference === freshCycle.id ||
            (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(freshCycle.id)))
        )
        .toArray();

      let alreadyTransferredCogs = 0;
      let assetDebits1054 = 0;
      let assetCredits1054 = 0;
      let assetDebits1580 = 0;
      let assetCredits1580 = 0;
      let expensedDebit = 0;
      const expenseAccountsMap = new Map<string, number>();

      for (const entry of existingEntries) {
        for (const line of entry.lines || []) {
          // Strictly verify this line belongs to THIS crop cycle to prevent cross-cycle contamination
          const isLineForThisCycle = line.memo ? line.memo.includes(freshCycle.id) : (entry.reference === freshCycle.id);
          if (!isLineForThisCycle) continue;

          const code = line.accountCode;
          if (code === CANONICAL_ACCOUNTS.CROP_COGS) {
            alreadyTransferredCogs += (line.debit || 0) - (line.credit || 0);
          } else if (code === CANONICAL_ACCOUNTS.WIP) {
            assetDebits1054 += line.debit || 0;
            assetCredits1054 += line.credit || 0;
          } else if (code === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) {
            assetDebits1580 += line.debit || 0;
            assetCredits1580 += line.credit || 0;
          } else if (
            code === CANONICAL_ACCOUNTS.FEED_EXPENSE ||
            code === CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES ||
            code === CANONICAL_ACCOUNTS.VET_MEDICINE ||
            code === CANONICAL_ACCOUNTS.ELECTRICITY ||
            code === CANONICAL_ACCOUNTS.IRRIGATION ||
            code === CANONICAL_ACCOUNTS.FUEL_TRANSPORT ||
            code === CANONICAL_ACCOUNTS.REPAIR_MAINTENANCE ||
            code === CANONICAL_ACCOUNTS.MISCELLANEOUS_EXPENSE
          ) {
            const netExp = (line.debit || 0) - (line.credit || 0);
            if (netExp > 0) {
              expensedDebit += netExp;
              expenseAccountsMap.set(code, (expenseAccountsMap.get(code) || 0) + netExp);
            }
          }
        }
      }

      alreadyTransferredCogs = Math.max(0, Math.round(alreadyTransferredCogs * 100) / 100);
      const remainingCostToTransfer = Math.max(0, Math.round((totalRecordedCost - alreadyTransferredCogs) * 100) / 100);

      // Determine target asset account (1054 WIP vs 1580 Livestock/Biological Assets)
      const net1054 = Math.max(0, Math.round((assetDebits1054 - assetCredits1054) * 100) / 100);
      const net1580 = Math.max(0, Math.round((assetDebits1580 - assetCredits1580) * 100) / 100);
      const targetAssetCode = net1580 > net1054 ? CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS : CANONICAL_ACCOUNTS.WIP;
      const targetAssetAcc = accounts.find((a) => a.code === targetAssetCode) || (targetAssetCode === CANONICAL_ACCOUNTS.WIP ? wipAcc : assetAcc);
      let currentAssetBalance = Math.round((net1054 + net1580) * 100) / 100;

      // 3. Reclassify operating expenses into biological asset / WIP if costs were posted to GL expenses
      if (remainingCostToTransfer > currentAssetBalance && expensedDebit > 0) {
        const reclassLines: JournalLine[] = [];
        let reclassRemaining = Math.min(remainingCostToTransfer - currentAssetBalance, expensedDebit);
        reclassRemaining = Math.round(reclassRemaining * 100) / 100;
        let totalReclassed = 0;

        for (const [expCode, netAmount] of expenseAccountsMap.entries()) {
          if (reclassRemaining <= 0) break;
          const reclassAmt = Math.min(reclassRemaining, netAmount);
          if (reclassAmt > 0) {
            const expAcc = accounts.find((a) => a.code === expCode);
            reclassLines.push({
              accountId: expCode,
              accountCode: expCode,
              accountName: expAcc?.nameBn || 'পরিচালন ব্যয়',
              debit: 0,
              credit: reclassAmt,
              memo: `[RECLASSIFICATION] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} বিক্রয় বাবদ পরিচালন ব্যয় জৈবিক সম্পদে/WIP রূপান্তর`
            });
            totalReclassed += reclassAmt;
            reclassRemaining = Math.round((reclassRemaining - reclassAmt) * 100) / 100;
            expenseAccountsMap.set(expCode, Math.max(0, netAmount - reclassAmt));
          }
        }

        if (totalReclassed > 0) {
          reclassLines.unshift({
            accountId: targetAssetCode,
            accountCode: targetAssetCode,
            accountName: targetAssetAcc.nameBn || (targetAssetCode === CANONICAL_ACCOUNTS.WIP ? 'প্রক্রিয়াধীন পণ্য (WIP)' : 'জৈবিক সম্পদ'),
            debit: totalReclassed,
            credit: 0,
            memo: `[RECLASSIFICATION] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} পরিচালন ব্যয় থেকে জৈবিক সম্পদে/WIP রূপান্তর সমন্বয়`
          });

          const checkReclass = validateBalancedLines(reclassLines, accounts);
          if (checkReclass.isBalanced) {
            const reclassEntry = await postJournalEntry(
              {
                id: generateUniqueId('j_reclass'),
                voucherNumber: generateTransactionNumber('JV'),
                voucherType: 'ADJUSTMENT',
                date: dateStr,
                narration: `শস্য চাষ ব্যয় সমন্বয় (Reclassification to Asset/WIP): চক্র ${freshCycle.id} (${freshCycle.cropName}) - মোট: ৳${totalReclassed}`,
                reference: freshCycle.id,
                lines: reclassLines,
                createdBy: currentUserId,
                createdAt: new Date().toISOString()
              },
              { accounts, skipDbPut: true }
            );
            await safeInsert(dbInstance.journalEntries, reclassEntry, { idPrefix: 'j' });
            currentAssetBalance = Math.round((currentAssetBalance + totalReclassed) * 100) / 100;
          }
        }
      }

      // 4. Verification of source accounting debits specifically linked to THIS crop cycle ID:
      // Never create an accounting entry only because an operational field contains a number.
      // If a cost exists operationally but has no source accounting transaction, report/reject the mismatch instead of inventing a credit.
      const isPartial = Boolean(params.isPartialHarvest);
      let portionRatio = 1;
      if (isPartial) {
        if (params.harvestPortionRatio !== undefined && params.harvestPortionRatio > 0) {
          portionRatio = Math.min(1, Math.max(0.0001, params.harvestPortionRatio));
        } else if (params.remainingAreaDecimals !== undefined && freshCycle.areaDecimals && freshCycle.areaDecimals > 0) {
          const harvestedArea = Math.max(0, freshCycle.areaDecimals - params.remainingAreaDecimals);
          portionRatio = Math.min(1, Math.max(0.0001, harvestedArea / freshCycle.areaDecimals));
        }
      }

      // Proportional cost calculation for partial harvest
      let costToTransfer = remainingCostToTransfer;
      if (isPartial && portionRatio < 1) {
        const proportionalCost = Math.round(remainingCostToTransfer * portionRatio * 100) / 100;
        costToTransfer = Math.min(remainingCostToTransfer, proportionalCost);
      }

      if (costToTransfer > currentAssetBalance) {
        const unbackedAmount = Math.round((costToTransfer - currentAssetBalance) * 100) / 100;
        throw new Error(
          `শস্য চক্র ${freshCycle.id} এর উৎপাদন ব্যয়ে অমিল রয়েছে: স্থানান্তরযোগ্য ব্যয় ৳${costToTransfer}, কিন্তু সংশ্লিষ্ট অনুমোদিত জাবেদা সম্পদ ব্যালেন্স পাওয়া গেছে মাত্র ৳${currentAssetBalance} (অননুমোদিত বা হিসাবহীন ঘাটতি: ৳${unbackedAmount})। কোনো প্রকৃত হিসাব লেনদেন ছাড়া স্বয়ংক্রিয় ক্রেডিট সৃষ্টি করা নিষিদ্ধ। অনুগ্রহ করে প্রকৃত লেনদেন নথিভুক্ত করুন।`
        );
      }

      // 5. Transfer accumulated cycle cost to Crop COGS (5030).
      // Each Crop cycle has its own accumulated cost; shared WIP account 1054 does not determine cycle cost by itself.
      let cogsJournalEntryId: string | undefined;
      let cogsVoucherNumber: string | undefined;

      if (costToTransfer > 0) {
        const cogsLines: JournalLine[] = [
          {
            accountId: CANONICAL_ACCOUNTS.CROP_COGS,
            accountCode: CANONICAL_ACCOUNTS.CROP_COGS,
            accountName: cropCogsAcc.nameBn || 'বিক্রিত ফসলের উৎপাদন ব্যয় (Crop COGS)',
            debit: costToTransfer,
            credit: 0,
            memo: `[COGS_TRANSFER] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} বিক্রিত ফসলের উৎপাদন ব্যয় (COGS)${isPartial ? ' (আংশিক কর্তন)' : ''}`
          }
        ];

        // Relieve applicable production inventory/WIP/biological asset accounts
        let reliefRemaining = costToTransfer;
        if (net1054 > 0 && reliefRemaining > 0) {
          const relief1054 = Math.min(reliefRemaining, net1054);
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.WIP,
            accountCode: CANONICAL_ACCOUNTS.WIP,
            accountName: wipAcc.nameBn || 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
            debit: 0,
            credit: relief1054,
            memo: `[COGS_TRANSFER] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} বিক্রয় বাবদ WIP সমাপ্তি সমন্বয়`
          });
          reliefRemaining = Math.round((reliefRemaining - relief1054) * 100) / 100;
        }

        if (net1580 > 0 && reliefRemaining > 0) {
          const relief1580 = Math.min(reliefRemaining, net1580);
          cogsLines.push({
            accountId: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountCode: CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS,
            accountName: assetAcc.nameBn || 'পশুসম্পদ ও জৈবিক সম্পদ (Livestock & Biological Assets)',
            debit: 0,
            credit: relief1580,
            memo: `[COGS_TRANSFER] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} বিক্রয় বাবদ জৈবিক সম্পদ সমাপ্তি সমন্বয়`
          });
          reliefRemaining = Math.round((reliefRemaining - relief1580) * 100) / 100;
        }

        if (reliefRemaining > 0) {
          cogsLines.push({
            accountId: targetAssetCode,
            accountCode: targetAssetCode,
            accountName: targetAssetAcc.nameBn || (targetAssetCode === CANONICAL_ACCOUNTS.WIP ? 'প্রক্রিয়াধীন পণ্য (WIP)' : 'জৈবিক সম্পদ'),
            debit: 0,
            credit: reliefRemaining,
            memo: `[COGS_TRANSFER] [${freshCycle.id}] শস্য চক্র ${freshCycle.id} বিক্রয় বাবদ সম্পদে/WIP সমাপ্তি সমন্বয়`
          });
        }

        const checkCogs = validateBalancedLines(cogsLines, accounts);
        if (!checkCogs.isBalanced) {
          throw new Error('ফসল COGS জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        cogsVoucherNumber = generateTransactionNumber('COGS');
        const cogsEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_crop_cogs'),
            voucherNumber: cogsVoucherNumber,
            voucherType: 'JOURNAL',
            date: dateStr,
            narration: `ফসল কর্তন ও বিক্রয় COGS: চক্র ${freshCycle.id} (${freshCycle.cropName}) - স্থানান্তরিত উৎপাদন ব্যয়: ৳${costToTransfer}${isPartial ? ' (আংশিক কর্তন)' : ''}`,
            reference: freshCycle.id,
            lines: cogsLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(dbInstance.journalEntries, cogsEntry, { idPrefix: 'j' });
        cogsJournalEntryId = cogsEntry.id;
      }

      // 6. Revenue Recognition leg (separate SALES voucher)
      let revenueJournalEntryId: string | undefined;
      let revenueVoucherNumber: string | undefined;
      let saleRecord: Sale | undefined;

      if (cleanPrice > 0) {
        const paymentCode = getPaymentAccount(paymentMethod, 'SALE');
        const revenueLines: JournalLine[] = [
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
        ];

        const checkRev = validateBalancedLines(revenueLines, accounts);
        if (!checkRev.isBalanced) {
          throw new Error('ফসল বিক্রয় রাজস্ব জাবেদা ভারসাম্যহীন! কার্যক্রম বাতিল করা হলো।');
        }

        revenueVoucherNumber = generateTransactionNumber('SLC');
        const revenueEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_crop_sale'),
            voucherNumber: revenueVoucherNumber,
            voucherType: 'SALES',
            date: dateStr,
            narration: `ফসল কর্তন ও বিক্রয়: ${freshCycle.cropName} (${freshCycle.plotName}) - ফলন: ${cleanYield} কেজি, বিক্রয়মূল্য: ৳${cleanPrice}`,
            reference: freshCycle.id,
            lines: revenueLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );
        await safeInsert(dbInstance.journalEntries, revenueEntry, { idPrefix: 'j' });
        revenueJournalEntryId = revenueEntry.id;

        // Cash/Bank ledger update
        if (paymentMethod === 'BANK' && bankAcc) {
          await dbInstance.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance + cleanPrice) * 100) / 100,
            synced: false
          });
        } else if (paymentMethod === 'CASH') {
          const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
          if (cashAcc) {
            await dbInstance.cashBankAccounts.update(cashAcc.id, {
              currentBalance: Math.round((cashAcc.currentBalance + cleanPrice) * 100) / 100,
              synced: false
            });
          }
        }

        // Find or create customer party for AR tracking
        let customerParty: Party | undefined;
        if (params.customerId) {
          customerParty = await dbInstance.parties.get(params.customerId);
        }
        if (!customerParty && customerName?.trim()) {
          const trimmedName = customerName.trim().toLowerCase();
          const allParties: Party[] = await dbInstance.parties.toArray();
          customerParty = allParties.find(
            (p: Party) => (p.type === 'CUSTOMER' || p.type === 'BOTH') && p.name.trim().toLowerCase() === trimmedName
          );
        }
        if (!customerParty) {
          const defaultName = customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)';
          const allParties: Party[] = await dbInstance.parties.toArray();
          const existingParty = allParties.find((p: Party) => p.name.trim().toLowerCase() === defaultName.toLowerCase());
          if (existingParty) {
            customerParty = existingParty;
          } else {
            const newParty: Party = {
              id: generateUniqueId('pty'),
              type: 'CUSTOMER',
              name: defaultName,
              phone: '',
              balance: 0,
              isActive: true,
              synced: false
            };
            await safeInsert(dbInstance.parties, newParty, { idPrefix: 'pty' });
            customerParty = newParty;
          }
        }

        // Update Customer AR balance if credit sale
        if (paymentMethod === 'CREDIT' && customerParty) {
          await dbInstance.parties.update(customerParty.id, {
            balance: Math.round(((customerParty.balance || 0) + cleanPrice) * 100) / 100,
            synced: false
          });
        }

        const cropDisplayNumber = await generateDisplayNumber('SAL', dateStr);
        saleRecord = {
          id: generateUniqueId('sal'),
          invoiceNumber: generateTransactionNumber('SAL'),
          displayNumber: cropDisplayNumber,
          date: dateStr,
          customerId: customerParty ? customerParty.id : 'WALK_IN_CUSTOMER',
          customerName: customerParty ? customerParty.name : (customerName?.trim() || 'সাধারণ ক্রেতা (Local Buyer)'),
          category: 'CROP',
          items: [
            {
              itemId: freshCycle.id,
              itemName: `শস্য/ঘাস বিক্রয়: ${freshCycle.cropName} (${freshCycle.plotName})`,
              quantity: cleanYield,
              unit: 'কেজি',
              unitPrice: cleanYield > 0 ? Math.round((cleanPrice / cleanYield) * 100) / 100 : cleanPrice,
              lineTotal: cleanPrice,
              cogsAmount: costToTransfer
            }
          ],
          subtotal: cleanPrice,
          totalAmount: cleanPrice,
          grandTotal: cleanPrice,
          paidAmount: paymentMethod === 'CREDIT' ? 0 : cleanPrice,
          dueAmount: paymentMethod === 'CREDIT' ? cleanPrice : 0,
          paymentMethod,
          bankAccountId: paymentMethod === 'BANK' ? bankAccountId : undefined,
          journalEntryId: revenueJournalEntryId,
          status: paymentMethod === 'CREDIT' ? 'DUE' : 'PAID',
          synced: false
        };
        await safeInsert(dbInstance.sales, saleRecord, { idPrefix: 'sal' });
      }

      // 7. Update CropCycle record
      // If partial harvest and remaining cost/area exists, keep cycle GROWING and retain unsold crop.
      const isStillActive = isPartial && (params.remainingAreaDecimals === undefined || params.remainingAreaDecimals > 0);

      freshCycle.harvestYieldKg = Math.round(((freshCycle.harvestYieldKg || 0) + cleanYield) * 100) / 100;
      freshCycle.harvestRevenue = Math.round(((freshCycle.harvestRevenue || 0) + cleanPrice) * 100) / 100;
      freshCycle.actualHarvestDate = dateStr;

      if (isStillActive) {
        freshCycle.status = 'GROWING';
        if (params.remainingAreaDecimals !== undefined) {
          freshCycle.areaDecimals = params.remainingAreaDecimals;
        }
      } else {
        freshCycle.status = 'HARVESTED';
      }

      freshCycle.synced = false;
      await dbInstance.cropCycles.put(freshCycle);

      // 8. Audit Log
      await safeInsert(
        dbInstance.auditLogs,
        {
          id: generateUniqueId('aud'),
          timestamp: new Date().toISOString(),
          userId: currentUserId,
          role: 'OWNER',
          action: 'UPDATE',
          module: 'PRODUCTION',
          recordId: freshCycle.id,
          status: 'SUCCESS',
          details: `ফসল কর্তন ও বিক্রয় সম্পন্ন (${isStillActive ? 'আংশিক' : 'সম্পূর্ণ'}): চক্র ${freshCycle.id}, ফলন ${cleanYield} কেজি, বিক্রয় ৳${cleanPrice}, স্থানান্তরিত COGS ৳${costToTransfer}`
        },
        { idPrefix: 'aud' }
      );

      return {
        updatedCycle: freshCycle,
        sale: saleRecord,
        journalEntryId: revenueJournalEntryId || cogsJournalEntryId,
        voucherNumber: revenueVoucherNumber || cogsVoucherNumber,
        cogsJournalEntryId,
        cogsVoucherNumber,
        costTransferred: costToTransfer
      };
    }
  );
}

/**
 * Atomic Execution of Customer / Supplier Invoice Payment
 * - For credit sale payment: Dr Cash/Bank -> Cr Accounts Receivable (1020)
 *   Reduces customer's AR balance in parties table. Reconciles GL AR and customer balance.
 * - For credit purchase payment: Dr Accounts Payable (2010) -> Cr Cash/Bank
 *   Reduces supplier's AP balance in parties table. Reconciles GL AP and supplier balance.
 */
export interface PaymentTransactionParams {
  parentType: 'SALE' | 'PURCHASE';
  parentId: string;
  amount: number;
  paymentMethod: 'CASH' | 'BANK';
  bankAccountId?: string;
  date?: string;
  note?: string;
  currentUserId?: string;
}

export async function executePaymentTransaction(
  params: PaymentTransactionParams,
  dbInstance: any = db
): Promise<{ payment: PaymentRecord; journalEntryId: string; voucherNumber: string }> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.payments,
      dbInstance.sales,
      dbInstance.purchases,
      dbInstance.journalEntries,
      dbInstance.accounts,
      dbInstance.closedPeriods,
      dbInstance.cashBankAccounts,
      dbInstance.parties,
      dbInstance.auditLogs
    ],
    async () => {
      const {
        parentType,
        parentId,
        amount,
        paymentMethod,
        bankAccountId,
        date = new Date().toISOString().split('T')[0],
        note,
        currentUserId = 'system'
      } = params;

      const amt = Math.round(Math.max(0, amount) * 100) / 100;
      if (amt <= 0) {
        throw new Error('পরিশোধের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে।');
      }

      const isSale = parentType === 'SALE';
      let saleRec: Sale | undefined;
      let purchRec: Purchase | undefined;
      let partyName = '';
      let partyId = '';
      let invoiceNumber = '';
      let totalAmount = 0;

      if (isSale) {
        saleRec = await dbInstance.sales.get(parentId);
        if (!saleRec) throw new Error('বিক্রয় চালান পাওয়া যায়নি।');
        partyName = saleRec.customerName || 'ক্রেতা';
        partyId = saleRec.customerId || '';
        invoiceNumber = saleRec.invoiceNumber;
        totalAmount = saleRec.grandTotal || saleRec.totalAmount;
      } else {
        purchRec = await dbInstance.purchases.get(parentId);
        if (!purchRec) throw new Error('ক্রয় চালান পাওয়া যায়নি।');
        partyName = purchRec.supplierName || 'সরবরাহকারী';
        partyId = purchRec.supplierId || '';
        invoiceNumber = purchRec.invoiceNumber;
        totalAmount = purchRec.grandTotal || purchRec.totalAmount;
      }

      // Check closed period
      const closedPeriod = await dbInstance.closedPeriods
        .filter((p: any) => (p.startDate ? p.startDate <= date : true) && p.endDate >= date)
        .first();
      if (closedPeriod) {
        throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
      }

      const accounts: Account[] = await dbInstance.accounts.toArray();
      const cashBankAccountCode = paymentMethod === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
      const cashBankAccountName = paymentMethod === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'নগদ তহবিল (Cash on Hand)';
      const arCode = CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE;
      const arName = 'প্রাপ্য হিসাব (Accounts Receivable)';
      const apCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE;
      const apName = 'প্রদেয় হিসাব (Accounts Payable)';

      let journalLines: JournalLine[] = [];
      if (isSale) {
        // Dr Cash/Bank, Cr Accounts Receivable
        journalLines = [
          {
            accountId: cashBankAccountCode,
            accountCode: cashBankAccountCode,
            accountName: cashBankAccountName,
            debit: amt,
            credit: 0,
            memo: `বিক্রয় চালান ${invoiceNumber}-এর কিস্তি গ্রহণ: ${partyName}`
          },
          {
            accountId: arCode,
            accountCode: arCode,
            accountName: arName,
            debit: 0,
            credit: amt,
            memo: `গ্রাহকের দেনা সমন্বয়: ${partyName} (চালান: ${invoiceNumber})`
          }
        ];
      } else {
        // Dr Accounts Payable, Cr Cash/Bank
        journalLines = [
          {
            accountId: apCode,
            accountCode: apCode,
            accountName: apName,
            debit: amt,
            credit: 0,
            memo: `সরবরাহকারী দেনা পরিশোধ: ${partyName} (চালান: ${invoiceNumber})`
          },
          {
            accountId: cashBankAccountCode,
            accountCode: cashBankAccountCode,
            accountName: cashBankAccountName,
            debit: 0,
            credit: amt,
            memo: `ক্রয় চালান ${invoiceNumber}-এর কিস্তি পরিশোধ: ${partyName}`
          }
        ];
      }

      const check = validateBalancedLines(journalLines, accounts);
      if (!check.isBalanced) {
        throw new Error(`জাবেদা ভারসাম্যহীন! মোট ডেবিট: ৳${check.totalDebit}, মোট ক্রেডিট: ৳${check.totalCredit}`);
      }

      const voucherNumber = generateTransactionNumber(isSale ? 'RV' : 'PV');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_pmt'),
          voucherNumber,
          voucherType: isSale ? 'RECEIPT' : 'PAYMENT',
          date,
          narration: isSale
            ? `বিক্রয় চালান ${invoiceNumber}-এর কিস্তি আদায় (${partyName}) - ৳${amt}`
            : `ক্রয় চালান ${invoiceNumber}-এর কিস্তি পরিশোধ (${partyName}) - ৳${amt}`,
          reference: invoiceNumber,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts, skipDbPut: true }
      );
      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      // Save PaymentRecord
      const paymentRecord: PaymentRecord = {
        id: generateUniqueId('pmt'),
        parentType,
        parentId,
        amount: amt,
        date,
        note: note?.trim() || undefined,
        paymentMethod,
        bankAccountId: bankAccountId || undefined,
        journalEntryId: journalEntry.id,
        synced: false
      };
      await safeInsert(dbInstance.payments, paymentRecord, { idPrefix: 'pmt' });

      // Update Sale or Purchase invoice
      const allPaymentsForParent = await dbInstance.payments.where('parentId').equals(parentId).toArray();
      const totalPaid = allPaymentsForParent.reduce((sum: number, p: PaymentRecord) => sum + (Number(p.amount) || 0), 0);
      const newDue = Math.max(0, Math.round((totalAmount - totalPaid) * 100) / 100);
      const newStatus = newDue <= 0 ? 'PAID' : (totalPaid > 0 ? 'PARTIAL' : 'DUE');

      if (isSale) {
        await dbInstance.sales.update(parentId, {
          paidAmount: totalPaid,
          dueAmount: newDue,
          status: newStatus,
          synced: false
        });
      } else {
        await dbInstance.purchases.update(parentId, {
          paidAmount: totalPaid,
          dueAmount: newDue,
          status: newStatus,
          synced: false
        });
      }

      // Update operational Cash / Bank account balance
      if (paymentMethod === 'CASH') {
        const cashAcc = await dbInstance.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          const newBal = isSale
            ? cashAcc.currentBalance + amt
            : cashAcc.currentBalance - amt;
          await dbInstance.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round(newBal * 100) / 100,
            synced: false
          });
        }
      } else if (paymentMethod === 'BANK') {
        let bankAcc: CashBankAccount | undefined;
        if (bankAccountId) {
          bankAcc = await dbInstance.cashBankAccounts.get(bankAccountId);
        }
        if (!bankAcc) {
          bankAcc = await dbInstance.cashBankAccounts.where('accountType').equals('BANK').first();
        }
        if (bankAcc) {
          const newBal = isSale
            ? bankAcc.currentBalance + amt
            : bankAcc.currentBalance - amt;
          await dbInstance.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round(newBal * 100) / 100,
            synced: false
          });
        }
      }

      // Update Customer AR or Supplier AP party balance
      if (isSale) {
        let customerParty: Party | undefined;
        if (partyId) {
          customerParty = await dbInstance.parties.get(partyId);
        }
        if (!customerParty && partyName) {
          const allParties: Party[] = await dbInstance.parties.toArray();
          customerParty = allParties.find(
            (p: Party) => (p.type === 'CUSTOMER' || p.type === 'BOTH') && p.name.trim().toLowerCase() === partyName.trim().toLowerCase()
          );
        }
        if (customerParty) {
          await dbInstance.parties.update(customerParty.id, {
            balance: Math.round(((customerParty.balance || 0) - amt) * 100) / 100,
            synced: false
          });
        }
      } else {
        let supplierParty: Party | undefined;
        if (partyId) {
          supplierParty = await dbInstance.parties.get(partyId);
        }
        if (!supplierParty && partyName) {
          const allParties: Party[] = await dbInstance.parties.toArray();
          supplierParty = allParties.find(
            (p: Party) => (p.type === 'SUPPLIER' || p.type === 'BOTH') && p.name.trim().toLowerCase() === partyName.trim().toLowerCase()
          );
        }
        if (supplierParty) {
          await dbInstance.parties.update(supplierParty.id, {
            balance: Math.round(((supplierParty.balance || 0) - amt) * 100) / 100,
            synced: false
          });
        }
      }

      // Record Audit Log
      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('aud'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: isSale ? 'SALE_PAYMENT' : 'PURCHASE_PAYMENT',
        module: 'COMMERCE',
        recordId: paymentRecord.id,
        status: 'SUCCESS',
        details: `${isSale ? 'বিক্রয়' : 'ক্রয়'} চালান ${invoiceNumber}-এর কিস্তি আদায়/পরিশোধ: ৳${amt} (${partyName})`
      });

      return {
        payment: paymentRecord,
        journalEntryId: journalEntry.id,
        voucherNumber
      };
    }
  );
}

/**
 * Atomic Execution of Inventory Stock Adjustment
 * - Updates inventory item stock
 * - Records StockMovement of movementType: 'ADJUSTMENT'
 * - Posts GL journal entry for stock gain or loss to ensure subledger reconciles with GL
 */
export interface StockAdjustmentParams {
  itemId: string;
  adjustmentType: 'INCREASE' | 'DECREASE';
  quantity: number;
  reason?: string;
  date?: string;
  currentUserId?: string;
}

export interface StockAdjustmentResult {
  updatedItem: InventoryItem;
  movement: StockMovement;
  journalEntry?: JournalEntry;
  journalEntryId?: string;
}

export async function executeStockAdjustmentTransaction(
  params: StockAdjustmentParams,
  dbInstance: any = db
): Promise<StockAdjustmentResult> {
  return await dbInstance.transaction(
    'rw',
    [
      dbInstance.inventoryItems,
      dbInstance.stockMovements,
      dbInstance.journalEntries,
      dbInstance.accounts,
      dbInstance.auditLogs,
      dbInstance.closedPeriods
    ],
    async () => {
      const {
        itemId,
        adjustmentType,
        quantity,
        reason,
        date,
        currentUserId = 'system'
      } = params;

      const cleanQty = Math.max(0, quantity);
      if (cleanQty <= 0) {
        throw new Error('সমন্বয়ের পরিমাণ ০ এর বেশি হতে হবে।');
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`সমন্বয়ের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      if (dbInstance.closedPeriods) {
        try {
          const closedPeriod = await dbInstance.closedPeriods
            .filter((p: any) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
            .first();
          if (closedPeriod) {
            throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
          }
        } catch (cpErr: any) {
          if (cpErr?.message && cpErr.message.includes('হিসাবকাল বন্ধ রয়েছে')) {
            throw cpErr;
          }
        }
      }

      const item = await dbInstance.inventoryItems.get(itemId);
      if (!item) {
        throw new Error('ইনভেন্টরি আইটেম পাওয়া যায়নি।');
      }

      const currentAvailableStock = Number(item.currentStock || 0);
      const isIncrease = adjustmentType === 'INCREASE';

      // Rule: If decrease quantity > available quantity: REJECT the transaction.
      // Never silently change or clip the requested amount. Prevent negative inventory.
      if (!isIncrease) {
        if (cleanQty > currentAvailableStock) {
          throw new Error(
            `মজুদ হ্রাস সমন্বয় ত্রুটি: সমন্বয়ের পরিমাণ (${cleanQty} ${item.unit || ''}) বিদ্যমান মজুদের (${currentAvailableStock} ${item.unit || ''}) চেয়ে বেশি হতে পারে না (Decrease quantity exceeds available stock).`
          );
        }
      }

      const newStock = isIncrease
        ? Math.round((currentAvailableStock + cleanQty) * 100) / 100
        : Math.round((currentAvailableStock - cleanQty) * 100) / 100;

      const effectiveUnitCost = item.avgCostPrice || item.sellingPrice || 0;
      const totalVal = Math.round(cleanQty * effectiveUnitCost * 100) / 100;

      // Update inventory stock (exact quantity delta matches cleanQty)
      await dbInstance.inventoryItems.update(item.id, {
        currentStock: newStock,
        synced: false
      });

      // Record Stock Movement (exact quantity matches cleanQty)
      const movement: StockMovement = {
        id: generateUniqueId('sm'),
        date: dateStr,
        itemId: item.id,
        movementType: 'ADJUSTMENT',
        quantity: cleanQty,
        unitCost: effectiveUnitCost,
        totalValue: totalVal,
        referenceId: item.id,
        notes: `স্টক সমন্বয় (${isIncrease ? 'বৃদ্ধি' : 'হ্রাস'}): ${reason || ''} - নতুন মজুদ: ${newStock} ${item.unit || ''}`,
        synced: false
      };
      await safeInsert(dbInstance.stockMovements, movement, { idPrefix: 'sm' });

      // GL journal entry for inventory adjustment:
      // If increase: Dr Inventory, Cr Other Revenue (4090)
      // If decrease: Dr Inventory Shrinkage/Loss (5090 / 6150), Cr Inventory
      let journalEntry: JournalEntry | undefined;
      let journalEntryId: string | undefined;
      if (totalVal > 0) {
        const accounts = await dbInstance.accounts.toArray();
        const invAccountCode = getInventoryAssetAccount(item.category);
        const invAcc = accounts.find((a: Account) => a.code === invAccountCode) || {
          id: `acc_${invAccountCode}`,
          code: invAccountCode,
          nameBn: INVENTORY_CATEGORY_ACCOUNT_MAP[invAccountCode]?.nameBn || 'মজুদ পণ্য (Inventory)'
        };
        const gainLossCode = isIncrease ? CANONICAL_ACCOUNTS.OTHER_REVENUE : CANONICAL_ACCOUNTS.OTHER_COGS;
        const gainLossAcc = accounts.find((a: Account) => a.code === gainLossCode) || {
          id: `acc_${gainLossCode}`,
          code: gainLossCode,
          nameBn: isIncrease ? 'অন্যান্য আয় (Other Revenue)' : 'অন্যান্য সমন্বয় খরচ (Other COGS)'
        };

        const combinedAccounts = [...accounts];
        if (!combinedAccounts.some((a) => a.code === invAccountCode)) combinedAccounts.push(invAcc as any);
        if (!combinedAccounts.some((a) => a.code === gainLossCode)) combinedAccounts.push(gainLossAcc as any);

        const invLines: JournalLine[] = isIncrease
          ? [
              {
                accountId: invAcc.id,
                accountCode: invAccountCode,
                accountName: invAcc.nameBn,
                debit: totalVal,
                credit: 0,
                memo: `স্টক বৃদ্ধি সমন্বয়: ${item.nameBn} (${cleanQty} ${item.unit || ''})`
              },
              {
                accountId: gainLossAcc.id,
                accountCode: gainLossCode,
                accountName: gainLossAcc.nameBn,
                debit: 0,
                credit: totalVal,
                memo: `স্টক বৃদ্ধি সমন্বয়: ${item.nameBn}`
              }
            ]
          : [
              {
                accountId: gainLossAcc.id,
                accountCode: gainLossCode,
                accountName: gainLossAcc.nameBn,
                debit: totalVal,
                credit: 0,
                memo: `স্টক ঘাটতি/ক্ষতি সমন্বয়: ${item.nameBn} (${cleanQty} ${item.unit || ''})`
              },
              {
                accountId: invAcc.id,
                accountCode: invAccountCode,
                accountName: invAcc.nameBn,
                debit: 0,
                credit: totalVal,
                memo: `স্টক হ্রাস সমন্বয়: ${item.nameBn}`
              }
            ];

        const voucherNumber = generateTransactionNumber('ADJ');
        journalEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_adj'),
            voucherNumber,
            voucherType: 'ADJUSTMENT',
            date: dateStr,
            narration: `ইনভেন্টরি সমন্বয়: ${item.nameBn} (${isIncrease ? '+' : '-'}${cleanQty} ${item.unit || ''}) - ${reason || ''}`,
            reference: item.id,
            lines: invLines,
            createdBy: currentUserId,
            createdAt: new Date().toISOString()
          },
          { accounts: combinedAccounts, skipDbPut: true }
        );
        await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });
        journalEntryId = journalEntry.id;
      }

      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('aud'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'STOCK_ADJUSTMENT',
        module: 'INVENTORY',
        recordId: item.id,
        status: 'SUCCESS',
        details: `ইনভেন্টরি সমন্বয়: ${item.nameBn} (${isIncrease ? '+' : '-'}${cleanQty} ${item.unit || ''})`
      });

      return {
        updatedItem: { ...item, currentStock: newStock },
        movement,
        journalEntry,
        journalEntryId
      };
    }
  );
}

/**
 * Atomic Execution of Farm Production Receipt into Inventory
 * - Increases stock of InventoryItem with weighted-average cost calculation
 * - Records StockMovement with movementType: 'PRODUCTION'
 */
export interface ProductionReceiptParams {
  itemId: string;
  quantity: number;
  unitCost: number;
  date?: string;
  notes?: string;
  sourceBatchId?: string;
  currentUserId?: string;
}

export interface ProductionReceiptParams {
  itemId: string;
  quantity: number;
  unitCost: number;
  date?: string;
  notes?: string;
  sourceBatchId?: string;
  sourceAccountCode?: string;
  currentUserId?: string;
}

export interface ProductionReceiptResult {
  updatedItem: InventoryItem;
  movement: StockMovement;
  journalEntry?: JournalEntry;
  journalEntryId?: string;
  voucherNumber?: string;
}

export async function executeProductionReceiptTransaction(
  params: ProductionReceiptParams,
  dbInstance: any = db
): Promise<ProductionReceiptResult> {
  const txTables: any[] = [
    dbInstance.inventoryItems,
    dbInstance.stockMovements,
    dbInstance.journalEntries,
    dbInstance.accounts,
    dbInstance.auditLogs
  ];
  if (dbInstance.cropCycles) txTables.push(dbInstance.cropCycles);
  if (dbInstance.fishBatches) txTables.push(dbInstance.fishBatches);
  if (dbInstance.animals) txTables.push(dbInstance.animals);
  if (dbInstance.closedPeriods) txTables.push(dbInstance.closedPeriods);

  return await dbInstance.transaction(
    'rw',
    txTables,
    async () => {
      const {
        itemId,
        quantity,
        unitCost,
        date,
        notes,
        sourceBatchId,
        sourceAccountCode: explicitSourceAccountCode,
        currentUserId = 'system'
      } = params;

      const cleanQty = Math.max(0, quantity);
      if (cleanQty <= 0) {
        throw new Error('উৎপাদন প্রাপ্তির পরিমাণ ০ এর বেশি হতে হবে।');
      }

      if (unitCost <= 0) {
        throw new Error('উৎপাদন প্রাপ্তির একক খরচ (Unit Cost) ০ এর বেশি হতে হবে।');
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const dateStr = date || todayStr;
      if (dateStr > todayStr) {
        throw new Error(`উৎপাদন প্রাপ্তির তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`);
      }

      if (dbInstance.closedPeriods) {
        try {
          const closedPeriod = await dbInstance.closedPeriods
            .filter((p: any) => (p.startDate ? p.startDate <= dateStr : true) && p.endDate >= dateStr)
            .first();
          if (closedPeriod) {
            throw new Error(`হিসাবকাল বন্ধ রয়েছে (${closedPeriod.notes || closedPeriod.endDate})। এই তারিখে নতুন লেনদেন পোস্টিং অনুমোদিত নয়।`);
          }
        } catch (cpErr: any) {
          if (cpErr?.message && cpErr.message.includes('হিসাবকাল বন্ধ রয়েছে')) {
            throw cpErr;
          }
        }
      }

      const item = await dbInstance.inventoryItems.get(itemId);
      if (!item) {
        throw new Error('ইনভেন্টরি আইটেম পাওয়া যায়নি।');
      }

      // Weighted average cost calculation
      const prevStock = Math.max(0, item.currentStock || 0);
      const prevCost = item.avgCostPrice || 0;
      const totalQty = prevStock + cleanQty;
      const totalCostVal = Math.round((prevStock * prevCost + cleanQty * unitCost) * 100) / 100;
      const newAvgCost = totalQty > 0 ? Math.round((totalCostVal / totalQty) * 100) / 100 : unitCost;
      const lineTotal = Math.round(cleanQty * unitCost * 100) / 100;

      // Update physical inventory subledger
      await dbInstance.inventoryItems.update(item.id, {
        currentStock: totalQty,
        avgCostPrice: newAvgCost,
        synced: false
      });

      // Record Stock Movement with movementType: 'PRODUCTION'
      const movement: StockMovement = {
        id: generateUniqueId('sm'),
        date: dateStr,
        itemId: item.id,
        movementType: 'PRODUCTION',
        quantity: cleanQty,
        unitCost,
        totalValue: lineTotal,
        referenceId: sourceBatchId || item.id,
        notes: notes || `খামার উৎপাদন থেকে প্রাপ্তি: ${cleanQty} ${item.unit || ''} ${item.nameBn}`,
        synced: false
      };
      await safeInsert(dbInstance.stockMovements, movement, { idPrefix: 'sm' });

      // Determine Destination Inventory Asset Account (Debit)
      // Feed -> 1051, Seed/Fert -> 1052, Raw Materials -> 1053, Finished Goods -> 1055, Packaging -> 1056
      let invAccountCode = getInventoryAssetAccount(item.category);
      if (invAccountCode === CANONICAL_ACCOUNTS.WIP) {
        invAccountCode = CANONICAL_ACCOUNTS.FINISHED_GOODS; // 1055 Finished Goods
      }

      // Determine Production / WIP Source Account (Credit)
      // When production is transferred into inventory, accounting corresponds to production/WIP source.
      // NEVER artificial Cash/Bank entries.
      let sourceAccountCode = explicitSourceAccountCode;
      let sourceBatchLabel = '';

      if (!sourceAccountCode) {
        if (sourceBatchId) {
          // 1. Check if sourceBatchId corresponds to a crop cycle (WIP 1054)
          if (dbInstance.cropCycles) {
            try {
              const cycle = await dbInstance.cropCycles.get(sourceBatchId);
              if (cycle) {
                sourceAccountCode = CANONICAL_ACCOUNTS.WIP; // 1054
                sourceBatchLabel = `শস্য চক্র: ${cycle.cropName || ''}`;
              }
            } catch {}
          }
          // 2. Check if sourceBatchId corresponds to a fish batch (Biological Asset 1580 / WIP 1054)
          if (!sourceAccountCode && dbInstance.fishBatches) {
            try {
              const batch = await dbInstance.fishBatches.get(sourceBatchId);
              if (batch) {
                sourceAccountCode = CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS; // 1580 default
                if (dbInstance.journalEntries) {
                  try {
                    const entries = await dbInstance.journalEntries
                      .filter((j: any) => j.reference === batch.id || (j.lines && j.lines.some((l: any) => l.memo && l.memo.includes(batch.id))))
                      .toArray();
                    let d1054 = 0;
                    let d1580 = 0;
                    for (const e of entries) {
                      for (const l of e.lines || []) {
                        if (l.accountCode === CANONICAL_ACCOUNTS.WIP) d1054 += (l.debit || 0);
                        if (l.accountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS) d1580 += (l.debit || 0);
                      }
                    }
                    if (d1054 > d1580) {
                      sourceAccountCode = CANONICAL_ACCOUNTS.WIP;
                    }
                  } catch {}
                }
                sourceBatchLabel = `মাছের ব্যাচ: ${batch.species || ''}`;
              }
            } catch {}
          }
          // 3. Check if sourceBatchId corresponds to an animal (Livestock Asset 1580)
          if (!sourceAccountCode && dbInstance.animals) {
            try {
              const animal = await dbInstance.animals.get(sourceBatchId);
              if (animal) {
                sourceAccountCode = CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS; // 1580
                sourceBatchLabel = `গবাদিপশু: ${animal.tagNumber || animal.name || ''}`;
              }
            } catch {}
          }
        }

        // Fallback default: Canonical Production WIP Account (1054)
        if (!sourceAccountCode) {
          sourceAccountCode = CANONICAL_ACCOUNTS.WIP;
        }
      }

      // Fetch accounts from DB or create reliable fallbacks
      const accounts = await dbInstance.accounts.toArray();
      const invAcc = accounts.find((a: Account) => a.code === invAccountCode) || {
        id: `acc_${invAccountCode}`,
        code: invAccountCode,
        nameBn: INVENTORY_CATEGORY_ACCOUNT_MAP[invAccountCode]?.nameBn || 'মজুদ পণ্য (Inventory)'
      };

      const sourceAcc = accounts.find((a: Account) => a.code === sourceAccountCode) || {
        id: `acc_${sourceAccountCode}`,
        code: sourceAccountCode,
        nameBn: sourceAccountCode === CANONICAL_ACCOUNTS.LIVESTOCK_ASSETS
          ? 'গবাদিপশু ও জৈবিক সম্পদ (Livestock & Biological Assets)'
          : 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)'
      };

      const combinedAccounts = [...accounts];
      if (!combinedAccounts.some((a) => a.code === invAccountCode)) combinedAccounts.push(invAcc as any);
      if (!combinedAccounts.some((a) => a.code === sourceAccountCode)) combinedAccounts.push(sourceAcc as any);

      // Create Balanced GL Journal Lines:
      // Dr Inventory Asset (1051-1056)
      // Cr Production/WIP Source (1054 WIP or 1580 Biological Assets)
      // NO artificial Cash or Bank entries!
      const journalLines: JournalLine[] = [
        {
          accountId: invAcc.id,
          accountCode: invAccountCode,
          accountName: invAcc.nameBn,
          debit: lineTotal,
          credit: 0,
          memo: `উৎপাদন প্রাপ্তি: ${item.nameBn} (${cleanQty} ${item.unit || ''} @ ৳${unitCost})`
        },
        {
          accountId: sourceAcc.id,
          accountCode: sourceAccountCode,
          accountName: sourceAcc.nameBn,
          debit: 0,
          credit: lineTotal,
          memo: sourceBatchLabel
            ? `উৎপাদন স্থানান্তর (${sourceBatchLabel}) [${sourceBatchId}]`
            : sourceBatchId
            ? `উৎপাদন ব্যয় সমন্বয় [${sourceBatchId}]`
            : `উৎপাদন ব্যয় সমন্বয় (WIP/উৎপাদন উৎস হতে ইনভেন্টরিতে স্থানান্তর)`
        }
      ];

      const voucherNumber = generateTransactionNumber('JRN');
      const journalEntry = await postJournalEntry(
        {
          id: generateUniqueId('j_prd'),
          voucherNumber,
          voucherType: 'JOURNAL',
          date: dateStr,
          narration: notes || `খামার উৎপাদন হতে ইনভেন্টরিতে স্থানান্তর: ${item.nameBn} (${cleanQty} ${item.unit || ''} @ ৳${unitCost})`,
          reference: sourceBatchId || item.id,
          lines: journalLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { accounts: combinedAccounts, skipDbPut: true }
      );

      await safeInsert(dbInstance.journalEntries, journalEntry, { idPrefix: 'j' });

      await safeInsert(dbInstance.auditLogs, {
        id: generateUniqueId('aud'),
        timestamp: new Date().toISOString(),
        userId: currentUserId,
        role: 'OWNER',
        action: 'PRODUCTION_RECEIPT',
        module: 'INVENTORY',
        recordId: item.id,
        status: 'SUCCESS',
        details: `উৎপাদন প্রাপ্তি: ${item.nameBn} (+${cleanQty} ${item.unit || ''}, মোট ৳${lineTotal})`
      });

      return {
        updatedItem: { ...item, currentStock: totalQty, avgCostPrice: newAvgCost },
        movement,
        journalEntry,
        journalEntryId: journalEntry.id,
        voucherNumber: journalEntry.voucherNumber
      };
    }
  );
}

// Fixed Asset Atomic Accounting Operations
export {
  executeFixedAssetDisposalTransaction,
  executeAssetDepreciationAtomic,
  hasAssetPostedAccounting,
  executeEditFixedAssetTransaction,
  getAssetGLCode,
  type FixedAssetDisposalParams,
  type FixedAssetDisposalResult,
  type AssetDepreciationAtomicResult,
  type EditFixedAssetParams,
  type EditFixedAssetResult
} from '../accounting/depreciationService';
