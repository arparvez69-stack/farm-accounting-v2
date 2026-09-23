import * as XLSX from 'xlsx';
import { db } from '../db/indexedDb';
import { generateBalanceSheet, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';
import { PaymentRecord } from '../types';

export async function exportAllToExcel(companyName = 'Agro-ERP'): Promise<void> {
  const wb = XLSX.utils.book_new();

  // 1. Chart of Accounts
  const accounts = await db.accounts.toArray();
  const accountsWs = XLSX.utils.json_to_sheet(
    accounts.map((a) => ({
      Code: a.code,
      'Bangla Name': a.nameBn,
      'English Name': a.nameEn,
      Class: a.accountClass,
      'Normal Balance': a.normalBalance,
      System: a.isSystem ? 'Yes' : 'No'
    }))
  );
  XLSX.utils.book_append_sheet(wb, accountsWs, 'Chart of Accounts');

  // 2. Trial Balance
  const tb = await generateTrialBalance();
  const tbWs = XLSX.utils.json_to_sheet(
    tb.rows.map((r) => ({
      Code: r.code,
      Account: r.nameBn,
      Class: r.accountClass,
      'Debit (৳)': r.debit,
      'Credit (৳)': r.credit
    }))
  );
  XLSX.utils.book_append_sheet(wb, tbWs, 'Trial Balance');

  // 3. Profit & Loss
  const pl = await generateProfitLoss();
  const plData = [
    { Category: 'REVENUE', Account: 'মোট আয় (Total Revenue)', 'Amount (৳)': pl.totalRevenue },
    ...pl.revenues.map((r) => ({ Category: 'Revenue Item', Account: r.nameBn, 'Amount (৳)': r.amount })),
    { Category: 'COGS', Account: 'মোট বিক্রিত পণ্যের ব্যয় (Total COGS)', 'Amount (৳)': pl.totalCogs },
    { Category: 'GROSS PROFIT', Account: 'মোট মুনাফা (Gross Profit)', 'Amount (৳)': pl.grossProfit },
    { Category: 'EXPENSES', Account: 'মোট পরিচালন ব্যয় (Total Operating Expenses)', 'Amount (৳)': pl.totalOperatingExpenses },
    ...pl.operatingExpenses.map((e) => ({ Category: 'Operating Expense', Account: e.nameBn, 'Amount (৳)': e.amount })),
    { Category: 'NET PROFIT', Account: 'খামারের নিট মুনাফা (Net Farm Profit)', 'Amount (৳)': pl.netProfit }
  ];
  const plWs = XLSX.utils.json_to_sheet(plData);
  XLSX.utils.book_append_sheet(wb, plWs, 'Profit & Loss');

  // 4. Balance Sheet
  const bs = await generateBalanceSheet();
  const bsData = [
    { Section: 'ASSETS', Item: 'মোট সম্পদ (Total Assets)', 'Amount (৳)': bs.totalAssets },
    ...bs.assets.map((a) => ({ Section: 'Asset Detail', Item: a.nameBn, 'Amount (৳)': a.amount })),
    { Section: 'LIABILITIES', Item: 'মোট দায় (Total Liabilities)', 'Amount (৳)': bs.totalLiabilities },
    ...bs.liabilities.map((l) => ({ Section: 'Liability Detail', Item: l.nameBn, 'Amount (৳)': l.amount })),
    { Section: 'EQUITY', Item: 'মোট মূলধন ও নিট লাভ (Total Equity)', 'Amount (৳)': bs.totalEquity },
    { Section: 'EQUITY', Item: 'চলতি বছরের লাভ (Current Year Profit)', 'Amount (৳)': bs.currentYearNetProfit },
    { Section: 'CHECK', Item: 'ভারসাম্য নিশ্চিতকরণ (Balanced?)', 'Amount (৳)': bs.isBalanced ? 'YES' : `NO (Diff: ${bs.discrepancy})` }
  ];
  const bsWs = XLSX.utils.json_to_sheet(bsData);
  XLSX.utils.book_append_sheet(wb, bsWs, 'Balance Sheet');

  // 5. Journal Entries
  const journals = await db.journalEntries.toArray();
  const flatJournals: any[] = [];
  for (const j of journals) {
    for (const l of j.lines) {
      flatJournals.push({
        Date: j.date,
        'Voucher No': j.voucherNumber,
        Type: j.voucherType,
        'Account Code': l.accountCode,
        'Account Name': l.accountName,
        'Debit (৳)': l.debit,
        'Credit (৳)': l.credit,
        Narration: j.narration,
        Memo: l.memo || ''
      });
    }
  }
  const jWs = XLSX.utils.json_to_sheet(flatJournals);
  XLSX.utils.book_append_sheet(wb, jWs, 'Journal Vouchers');

  // 6. Livestock
  const animals = await db.animals.toArray();
  const animalsWs = XLSX.utils.json_to_sheet(
    animals.map((a) => ({
      'Tag ID': a.id,
      Species: a.species,
      Breed: a.breed,
      Gender: a.gender,
      'Purchase Cost (৳)': a.purchaseCost,
      'Current Weight (Kg)': a.currentWeightKg,
      'Accumulated Feed Cost (৳)': a.accumulatedFeedCost,
      'Accumulated Med Cost (৳)': a.accumulatedMedCost,
      'Accumulated Labour (৳)': a.accumulatedLabourCost,
      'Total Cost (৳)': a.totalCost,
      Status: a.status,
      Location: a.location
    }))
  );
  XLSX.utils.book_append_sheet(wb, animalsWs, 'Livestock');

  // 7. Fisheries
  const fishBatches = await db.fishBatches.toArray();
  const fishWs = XLSX.utils.json_to_sheet(
    fishBatches.map((f) => ({
      'Batch ID': f.id,
      Pond: f.pondName,
      Species: f.species,
      'Stocking Date': f.stockingDate,
      'Fingerling Qty': f.fingerlingQty,
      'Fingerling Cost (৳)': f.fingerlingCost,
      'Feed (Kg)': f.totalFeedKg,
      'Feed Cost (৳)': f.totalFeedCost,
      Mortality: f.mortalityCount,
      'Harvest Kg': f.harvestWeightKg || 0,
      'Revenue (৳)': f.harvestRevenue || 0,
      Status: f.status
    }))
  );
  XLSX.utils.book_append_sheet(wb, fishWs, 'Fisheries');

  // 8. Crops & Fodder
  const cropCycles = await db.cropCycles.toArray();
  const cropsWs = XLSX.utils.json_to_sheet(
    cropCycles.map((c) => ({
      'Cycle ID': c.id,
      Plot: c.plotName,
      Crop: c.cropName,
      Category: c.cropCategory,
      'Area (Decimals)': c.areaDecimals,
      'Planting Date': c.plantingDate,
      'Total Cost (৳)': c.totalCost,
      'Yield (Kg)': c.harvestYieldKg,
      'Revenue (৳)': c.harvestRevenue,
      Status: c.status
    }))
  );
  XLSX.utils.book_append_sheet(wb, cropsWs, 'Crops');

  // 9. Purchases & Sales
  const purchases = await db.purchases.toArray();
  const pWs = XLSX.utils.json_to_sheet(
    purchases.map((p) => ({
      Invoice: p.invoiceNumber,
      Date: p.date,
      Supplier: p.supplierName,
      'Total (৳)': p.grandTotal,
      'Paid (৳)': p.paidAmount,
      'Due (৳)': p.dueAmount,
      Method: p.paymentMethod
    }))
  );
  XLSX.utils.book_append_sheet(wb, pWs, 'Purchases');

  const sales = await db.sales.toArray();
  const sWs = XLSX.utils.json_to_sheet(
    sales.map((s) => ({
      Invoice: s.invoiceNumber,
      Date: s.date,
      Customer: s.customerName,
      Category: s.category,
      'Total (৳)': s.grandTotal,
      'Paid (৳)': s.paidAmount,
      'Due (৳)': s.dueAmount,
      'COGS (৳)': s.totalCogs,
      Method: s.paymentMethod
    }))
  );
  XLSX.utils.book_append_sheet(wb, sWs, 'Sales');

  // 10. Audit Log
  const logs = await db.auditLogs.orderBy('timestamp').reverse().limit(200).toArray();
  const logWs = XLSX.utils.json_to_sheet(
    logs.map((l) => ({
      Timestamp: l.timestamp,
      User: l.userId,
      Role: l.role,
      Action: l.action,
      Module: l.module,
      Status: l.status,
      Details: l.details
    }))
  );
  XLSX.utils.book_append_sheet(wb, logWs, 'Audit Log');

  // Download File
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${companyName}_Accounting_Report_${dateStr}.xlsx`);
  recordExportTime();
}

/**
 * Safe table reader helper
 */
async function safeTableToArray(table: any): Promise<any[]> {
  if (!table) return [];
  try {
    if (typeof table.toArray === 'function') {
      return await table.toArray();
    }
    if (Array.isArray(table)) {
      return [...table];
    }
  } catch (err) {
    console.warn('Error reading table for backup:', err);
  }
  return [];
}

/**
 * Full JSON Backup creation for disaster recovery
 */
export async function createFullJsonBackup(targetDb: any = db): Promise<string> {
  const activeDb = targetDb || db;
  const [
    rawPayments,
    journalEntries,
    sales,
    purchases
  ] = await Promise.all([
    safeTableToArray(activeDb.payments),
    safeTableToArray(activeDb.journalEntries),
    safeTableToArray(activeDb.sales),
    safeTableToArray(activeDb.purchases)
  ]);

  const jeById = new Map(journalEntries.map((j: any) => [j.id, j]));
  const jeByVoucher = new Map(journalEntries.map((j: any) => [j.voucherNumber, j]));
  const saleById = new Map(sales.map((s: any) => [s.id, s]));
  const purchaseById = new Map(purchases.map((p: any) => [p.id, p]));

  const paymentMapByParent = new Map<string, number>();
  const mappedPayments: PaymentRecord[] = rawPayments.map((p: any) => {
    let journalEntryId = p.journalEntryId;
    let voucherNumber = p.voucherNumber;

    if (!voucherNumber && journalEntryId) {
      voucherNumber = jeById.get(journalEntryId)?.voucherNumber;
    }
    if (!journalEntryId && voucherNumber) {
      journalEntryId = jeByVoucher.get(voucherNumber)?.id;
    }

    const parentSale = p.parentType === 'SALE' ? saleById.get(p.parentId) : undefined;
    const parentPurch = p.parentType === 'PURCHASE' ? purchaseById.get(p.parentId) : undefined;

    if (!journalEntryId) {
      journalEntryId = parentSale?.journalEntryId || parentPurch?.journalEntryId;
    }
    if (!voucherNumber) {
      voucherNumber = parentSale?.invoiceNumber || parentPurch?.invoiceNumber;
    }

    const paymentMethod =
      p.paymentMethod ||
      (p.bankAccountId
        ? 'BANK'
        : parentSale?.paymentMethod === 'BANK' || parentPurch?.paymentMethod === 'BANK'
        ? 'BANK'
        : 'CASH');

    const amt = Math.round((Number(p.amount) || 0) * 100) / 100;
    if (p.parentId) {
      paymentMapByParent.set(p.parentId, (paymentMapByParent.get(p.parentId) || 0) + amt);
    }

    return {
      ...p,
      id: p.id,
      date: p.date || p.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      amount: amt,
      parentType: p.parentType,
      parentId: p.parentId,
      paymentMethod: paymentMethod as 'CASH' | 'BANK',
      bankAccountId: p.bankAccountId || undefined,
      journalEntryId: journalEntryId || undefined,
      voucherNumber: voucherNumber || undefined,
      partyId: p.partyId || parentSale?.customerId || parentPurch?.supplierId,
      customerId: p.customerId || parentSale?.customerId,
      supplierId: p.supplierId || parentPurch?.supplierId,
      partyName: p.partyName || parentSale?.customerName || parentPurch?.supplierName
    };
  });

  // Ensure upfront payments on sales/purchases without explicit payment log are also captured
  const upfrontPayments: PaymentRecord[] = [];
  for (const s of sales) {
    const recordedPaid = Number(s.paidAmount) || 0;
    const existingPaid = paymentMapByParent.get(s.id) || 0;
    const unrecordedPaid = Math.round((recordedPaid - existingPaid) * 100) / 100;
    if (unrecordedPaid > 0) {
      upfrontPayments.push({
        id: `pmt_init_${s.id}`,
        parentType: 'SALE',
        parentId: s.id,
        amount: unrecordedPaid,
        date: s.date || new Date().toISOString().slice(0, 10),
        paymentMethod: (s.paymentMethod === 'BANK' ? 'BANK' : 'CASH') as 'CASH' | 'BANK',
        bankAccountId: s.bankAccountId || undefined,
        journalEntryId: s.journalEntryId || undefined,
        voucherNumber: s.invoiceNumber || undefined,
        note: `বিক্রয় চালানের প্রাথমিক পরিশোধ (${s.invoiceNumber || s.id})`,
        createdAt: (s as any).createdAt || new Date().toISOString(),
        synced: true,
        partyId: s.customerId,
        customerId: s.customerId,
        partyName: s.customerName
      });
    }
  }

  for (const p of purchases) {
    const recordedPaid = Number(p.paidAmount) || 0;
    const existingPaid = paymentMapByParent.get(p.id) || 0;
    const unrecordedPaid = Math.round((recordedPaid - existingPaid) * 100) / 100;
    if (unrecordedPaid > 0) {
      upfrontPayments.push({
        id: `pmt_init_${p.id}`,
        parentType: 'PURCHASE',
        parentId: p.id,
        amount: unrecordedPaid,
        date: p.date || new Date().toISOString().slice(0, 10),
        paymentMethod: (p.paymentMethod === 'BANK' ? 'BANK' : 'CASH') as 'CASH' | 'BANK',
        bankAccountId: p.bankAccountId || undefined,
        journalEntryId: p.journalEntryId || undefined,
        voucherNumber: p.invoiceNumber || undefined,
        note: `ক্রয় চালানের প্রাথমিক পরিশোধ (${p.invoiceNumber || p.id})`,
        createdAt: (p as any).createdAt || new Date().toISOString(),
        synced: true,
        partyId: p.supplierId,
        supplierId: p.supplierId,
        partyName: p.supplierName
      });
    }
  }

  const paymentsToBackup = [...mappedPayments, ...upfrontPayments];

  const backup = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    systemConfig: await safeTableToArray(activeDb.systemConfig),
    accounts: await safeTableToArray(activeDb.accounts),
    journalEntries: await safeTableToArray(activeDb.journalEntries),
    closedPeriods: await safeTableToArray(activeDb.closedPeriods),
    recurringExpenseTemplates: await safeTableToArray(activeDb.recurringExpenseTemplates),
    animals: await safeTableToArray(activeDb.animals),
    animalEvents: await safeTableToArray(activeDb.animalEvents),
    reminders: await safeTableToArray(activeDb.reminders),
    ponds: await safeTableToArray(activeDb.ponds),
    fishBatches: await safeTableToArray(activeDb.fishBatches),
    plots: await safeTableToArray(activeDb.plots),
    cropCycles: await safeTableToArray(activeDb.cropCycles),
    internalFlows: await safeTableToArray(activeDb.internalFlows),
    processingRuns: await safeTableToArray(activeDb.processingRuns),
    inventory: await safeTableToArray(activeDb.inventoryItems),
    inventoryItems: await safeTableToArray(activeDb.inventoryItems),
    stockMovements: await safeTableToArray(activeDb.stockMovements),
    parties: await safeTableToArray(activeDb.parties),
    purchases: await safeTableToArray(activeDb.purchases),
    sales: await safeTableToArray(activeDb.sales),
    payments: paymentsToBackup,
    cashBankAccounts: await safeTableToArray(activeDb.cashBankAccounts),
    bankTransfers: await safeTableToArray(activeDb.bankTransfers),
    loans: await safeTableToArray(activeDb.loans),
    investors: await safeTableToArray(activeDb.investors),
    fixedAssets: await safeTableToArray(activeDb.fixedAssets),
    accessLogs: await safeTableToArray(activeDb.accessLogs),
    auditLogs: await safeTableToArray(activeDb.auditLogs),
    ...((activeDb as any).investorTransactions
      ? { investorTransactions: await safeTableToArray((activeDb as any).investorTransactions) }
      : {})
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Agro_ERP_Full_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore DOM trigger error in non-browser/test environments
    }
  }
  recordExportTime();

  return jsonStr;
}

/**
 * Validated Database Restore
 */
export async function restoreFromJsonBackup(
  jsonString: string,
  currentUserUid = 'owner',
  targetDb: any = db
): Promise<{ success: boolean; message: string; recordCounts?: Record<string, number> }> {
  try {
    const data = JSON.parse(jsonString);
    if (!data.version || !data.timestamp || !Array.isArray(data.journalEntries) || !Array.isArray(data.accounts)) {
      return { success: false, message: 'অবৈধ ব্যাকআপ ফাইল (Invalid backup structure or missing core financial tables).' };
    }

    const activeDb = targetDb || db;

    // Helper to normalize data items (array or single object)
    const normalizeItems = (val: any): any[] | undefined => {
      if (Array.isArray(val)) return val;
      if (val && typeof val === 'object' && Object.keys(val).length > 0) {
        return [val];
      }
      return undefined;
    };

    // Helper to safely clear and restore table
    const restoreTable = async (table: any, items: any[] | undefined) => {
      if (!table || items === undefined) return;
      if (typeof table.clear === 'function') {
        await table.clear();
      }
      if (items.length > 0) {
        if (typeof table.bulkPut === 'function') {
          await table.bulkPut(items);
        } else if (typeof table.put === 'function') {
          for (const item of items) {
            await table.put(item);
          }
        }
      }
    };

    // Table resolver helper
    const getTable = (fieldName: string): any => {
      if (!activeDb) return null;
      if (activeDb[fieldName]) return activeDb[fieldName];

      const aliasMap: Record<string, string> = {
        system: 'systemConfig',
        systemConfig: 'systemConfig',
        inventory: 'inventoryItems',
        inventoryItems: 'inventoryItems',
        salesInvoices: 'sales',
        sales: 'sales',
        purchaseInvoices: 'purchases',
        purchases: 'purchases',
        recurringExpenses: 'recurringExpenseTemplates',
        recurringExpenseTemplates: 'recurringExpenseTemplates',
        bankAccounts: 'cashBankAccounts',
        cashBankAccounts: 'cashBankAccounts',
        transfers: 'bankTransfers',
        bankTransfers: 'bankTransfers',
        assets: 'fixedAssets',
        fixedAssets: 'fixedAssets'
      };

      const mapped = aliasMap[fieldName];
      if (mapped && activeDb[mapped]) return activeDb[mapped];

      if (typeof activeDb.table === 'function') {
        try {
          const t = activeDb.table(fieldName);
          if (t) return t;
        } catch {
          // ignore
        }
      }
      return null;
    };

    const tablesToLock = (
      Array.isArray(activeDb.tables) && activeDb.tables.length > 0
        ? activeDb.tables
        : [
            activeDb.systemConfig,
            activeDb.accounts,
            activeDb.journalEntries,
            activeDb.closedPeriods,
            activeDb.recurringExpenseTemplates,
            activeDb.animals,
            activeDb.animalEvents,
            activeDb.reminders,
            activeDb.ponds,
            activeDb.fishBatches,
            activeDb.plots,
            activeDb.cropCycles,
            activeDb.internalFlows,
            activeDb.processingRuns,
            activeDb.inventoryItems,
            activeDb.stockMovements,
            activeDb.parties,
            activeDb.purchases,
            activeDb.sales,
            activeDb.payments,
            activeDb.cashBankAccounts,
            activeDb.bankTransfers,
            activeDb.loans,
            activeDb.investors,
            activeDb.fixedAssets,
            activeDb.accessLogs,
            activeDb.auditLogs,
            ...((activeDb as any).investorTransactions ? [(activeDb as any).investorTransactions] : [])
          ]
    ).filter(Boolean);

    const recordCounts: Record<string, number> = {};

    const performRestores = async () => {
      // 1. Core financial & operational tables
      const systemData = normalizeItems(data.systemConfig !== undefined ? data.systemConfig : data.system);
      await restoreTable(activeDb.systemConfig, systemData);
      if (systemData !== undefined) recordCounts.systemConfig = systemData.length;

      const accountsData = normalizeItems(data.accounts);
      await restoreTable(activeDb.accounts, accountsData);
      if (accountsData !== undefined) recordCounts.accounts = accountsData.length;

      const jeData = normalizeItems(data.journalEntries);
      await restoreTable(activeDb.journalEntries, jeData);
      if (jeData !== undefined) recordCounts.journalEntries = jeData.length;

      const cpData = normalizeItems(data.closedPeriods);
      await restoreTable(activeDb.closedPeriods, cpData);
      if (cpData !== undefined) recordCounts.closedPeriods = cpData.length;

      const recData = normalizeItems(data.recurringExpenseTemplates !== undefined ? data.recurringExpenseTemplates : data.recurringExpenses);
      await restoreTable(activeDb.recurringExpenseTemplates, recData);
      if (recData !== undefined) recordCounts.recurringExpenseTemplates = recData.length;

      const animData = normalizeItems(data.animals);
      await restoreTable(activeDb.animals, animData);
      if (animData !== undefined) recordCounts.animals = animData.length;

      const aeData = normalizeItems(data.animalEvents);
      await restoreTable(activeDb.animalEvents, aeData);
      if (aeData !== undefined) recordCounts.animalEvents = aeData.length;

      const remData = normalizeItems(data.reminders);
      await restoreTable(activeDb.reminders, remData);
      if (remData !== undefined) recordCounts.reminders = remData.length;

      const pndData = normalizeItems(data.ponds);
      await restoreTable(activeDb.ponds, pndData);
      if (pndData !== undefined) recordCounts.ponds = pndData.length;

      const fbData = normalizeItems(data.fishBatches);
      await restoreTable(activeDb.fishBatches, fbData);
      if (fbData !== undefined) recordCounts.fishBatches = fbData.length;

      const pltData = normalizeItems(data.plots);
      await restoreTable(activeDb.plots, pltData);
      if (pltData !== undefined) recordCounts.plots = pltData.length;

      const ccData = normalizeItems(data.cropCycles);
      await restoreTable(activeDb.cropCycles, ccData);
      if (ccData !== undefined) recordCounts.cropCycles = ccData.length;

      const ifData = normalizeItems(data.internalFlows);
      await restoreTable(activeDb.internalFlows, ifData);
      if (ifData !== undefined) recordCounts.internalFlows = ifData.length;

      const prData = normalizeItems(data.processingRuns);
      await restoreTable(activeDb.processingRuns, prData);
      if (prData !== undefined) recordCounts.processingRuns = prData.length;

      const invData = normalizeItems(data.inventoryItems !== undefined ? data.inventoryItems : data.inventory);
      await restoreTable(activeDb.inventoryItems, invData);
      if (invData !== undefined) {
        recordCounts.inventoryItems = invData.length;
        recordCounts.inventory = invData.length;
      }

      const smData = normalizeItems(data.stockMovements);
      await restoreTable(activeDb.stockMovements, smData);
      if (smData !== undefined) recordCounts.stockMovements = smData.length;

      const ptyData = normalizeItems(data.parties);
      await restoreTable(activeDb.parties, ptyData);
      if (ptyData !== undefined) recordCounts.parties = ptyData.length;

      const purData = normalizeItems(data.purchases !== undefined ? data.purchases : data.purchaseInvoices);
      await restoreTable(activeDb.purchases, purData);
      if (purData !== undefined) recordCounts.purchases = purData.length;

      const salData = normalizeItems(data.sales !== undefined ? data.sales : data.salesInvoices);
      await restoreTable(activeDb.sales, salData);
      if (salData !== undefined) recordCounts.sales = salData.length;

      const pmtData = normalizeItems(data.payments);
      await restoreTable(activeDb.payments, pmtData);
      if (pmtData !== undefined) recordCounts.payments = pmtData.length;

      const cbData = normalizeItems(data.cashBankAccounts !== undefined ? data.cashBankAccounts : data.bankAccounts);
      await restoreTable(activeDb.cashBankAccounts, cbData);
      if (cbData !== undefined) recordCounts.cashBankAccounts = cbData.length;

      const btData = normalizeItems(data.bankTransfers !== undefined ? data.bankTransfers : data.transfers);
      await restoreTable(activeDb.bankTransfers, btData);
      if (btData !== undefined) recordCounts.bankTransfers = btData.length;

      const lnData = normalizeItems(data.loans);
      await restoreTable(activeDb.loans, lnData);
      if (lnData !== undefined) recordCounts.loans = lnData.length;

      const invUserData = normalizeItems(data.investors);
      await restoreTable(activeDb.investors, invUserData);
      if (invUserData !== undefined) recordCounts.investors = invUserData.length;

      const faData = normalizeItems(data.fixedAssets !== undefined ? data.fixedAssets : data.assets);
      await restoreTable(activeDb.fixedAssets, faData);
      if (faData !== undefined) recordCounts.fixedAssets = faData.length;

      const aclData = normalizeItems(data.accessLogs);
      await restoreTable(activeDb.accessLogs, aclData);
      if (aclData !== undefined) recordCounts.accessLogs = aclData.length;

      const audData = normalizeItems(data.auditLogs);
      await restoreTable(activeDb.auditLogs, audData);
      if (audData !== undefined) recordCounts.auditLogs = audData.length;

      // 2. investorTransactions if present
      if (data.investorTransactions !== undefined) {
        const itxTable = getTable('investorTransactions');
        if (itxTable) {
          const itxData = normalizeItems(data.investorTransactions);
          await restoreTable(itxTable, itxData);
          if (itxData !== undefined) recordCounts.investorTransactions = itxData.length;
        }
      }

      // 3. Scan for any remaining persistent tables in backup not explicitly covered
      const handledKeys = new Set([
        'version', 'timestamp', 'metadata', 'exportDate',
        'systemConfig', 'system',
        'accounts',
        'journalEntries',
        'closedPeriods',
        'recurringExpenseTemplates', 'recurringExpenses',
        'animals',
        'animalEvents',
        'reminders',
        'ponds',
        'fishBatches',
        'plots',
        'cropCycles',
        'internalFlows',
        'processingRuns',
        'inventory', 'inventoryItems',
        'stockMovements',
        'parties',
        'purchases', 'purchaseInvoices',
        'sales', 'salesInvoices',
        'payments',
        'cashBankAccounts', 'bankAccounts',
        'bankTransfers', 'transfers',
        'loans',
        'investors',
        'fixedAssets', 'assets',
        'accessLogs',
        'auditLogs',
        'investorTransactions'
      ]);

      for (const key of Object.keys(data)) {
        if (!handledKeys.has(key)) {
          const targetTable = getTable(key);
          const items = normalizeItems(data[key]);
          if (targetTable && items !== undefined) {
            await restoreTable(targetTable, items);
            recordCounts[key] = items.length;
          }
        }
      }

      // 4. Record restore audit inside atomic transaction
      if (activeDb.auditLogs && typeof activeDb.auditLogs.put === 'function') {
        try {
          await activeDb.auditLogs.put({
            id: `audit_restore_${Date.now()}`,
            timestamp: new Date().toISOString(),
            userId: currentUserUid,
            role: 'OWNER',
            action: 'SYSTEM_RESTORE',
            module: 'BACKUP',
            recordId: 'indexedDb',
            status: 'SUCCESS',
            details: `ডাটাবেজ সফলভাবে রিস্টোর করা হয়েছে (ব্যাকআপ তারিখ: ${data.timestamp})`
          });
        } catch {
          // Non-blocking if audit logging fails
        }
      }
    };

    if (typeof activeDb.transaction === 'function' && tablesToLock.length > 0) {
      await activeDb.transaction('rw', tablesToLock, performRestores);
    } else {
      await performRestores();
    }

    return {
      success: true,
      message: 'ডাটাবেজ সফলভাবে রিস্টোর সম্পন্ন হয়েছে!',
      recordCounts
    };
  } catch (err: any) {
    return { success: false, message: `রিস্টোর ব্যর্থ হয়েছে: ${err.message}` };
  }
}

// Convenient alias exports
export const exportMultiSheetExcel = exportAllToExcel;
export const exportSystemBackupJson = createFullJsonBackup;
export const exportDatabaseToJson = createFullJsonBackup;
export const exportFullJsonBackup = createFullJsonBackup;
export const getFullJsonBackup = createFullJsonBackup;
export const restoreSystemBackupJson = (jsonString: string, uid = 'owner', targetDb = db) =>
  restoreFromJsonBackup(jsonString, uid, targetDb);

/**
 * Track last successful cloud sync timestamp
 */
export function getLastSyncTime(): string | null {
  try {
    return localStorage.getItem('goted_last_sync_time') || localStorage.getItem('goted_last_backup_time');
  } catch {
    return null;
  }
}

export function recordSyncTime(): void {
  try {
    const now = new Date().toISOString();
    localStorage.setItem('goted_last_sync_time', now);
    localStorage.setItem('goted_last_backup_time', now);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('goted-sync-time-updated', { detail: now }));
    }
  } catch {}
}

/**
 * Track last manual export timestamp
 */
export function getLastExportTime(): string | null {
  try {
    return localStorage.getItem('goted_last_export_time');
  } catch {
    return null;
  }
}

export function recordExportTime(): void {
  try {
    const now = new Date().toISOString();
    localStorage.setItem('goted_last_export_time', now);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('goted-export-time-updated', { detail: now }));
    }
  } catch {}
}

/**
 * Format timestamp in human-readable Bengali/English for farm owners
 */
export function formatBackupTimestamp(isoString: string | null): string {
  if (!isoString) return 'কখনও ব্যাকআপ হয়নি (No backup yet)';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'কখনও ব্যাকআপ হয়নি';
    return d.toLocaleString('bn-BD', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return isoString;
  }
}

