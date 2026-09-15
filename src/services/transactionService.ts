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
import { postJournalEntry } from '../accounting/accountingEngine';
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
  JournalLine
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
      db.auditLogs
    ],
    async () => {
      const { customer, item, quantity, unitPrice, paymentMethod, bankAccountId, currentUserId } = params;

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
      const dateStr = new Date().toISOString().split('T')[0];

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
      db.auditLogs
    ],
    async () => {
      const { supplier, item, quantity, unitPrice, transportCost = 0, paymentMethod, bankAccountId, currentUserId } = params;

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
      const dateStr = new Date().toISOString().split('T')[0];

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
      db.auditLogs
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
      db.auditLogs
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
      db.auditLogs
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
