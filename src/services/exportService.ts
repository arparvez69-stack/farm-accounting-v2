import * as XLSX from 'xlsx';
import { db } from '../db/indexedDb';
import { generateBalanceSheet, generateProfitLoss, generateTrialBalance } from '../accounting/accountingEngine';

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
 * Full JSON Backup creation for disaster recovery
 */
export async function createFullJsonBackup(): Promise<string> {
  const backup = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    systemConfig: await db.systemConfig.toArray(),
    accounts: await db.accounts.toArray(),
    journalEntries: await db.journalEntries.toArray(),
    closedPeriods: await db.closedPeriods.toArray(),
    animals: await db.animals.toArray(),
    animalEvents: await db.animalEvents.toArray(),
    ponds: await db.ponds.toArray(),
    fishBatches: await db.fishBatches.toArray(),
    plots: await db.plots.toArray(),
    cropCycles: await db.cropCycles.toArray(),
    internalFlows: await db.internalFlows.toArray(),
    processingRuns: await db.processingRuns.toArray(),
    inventoryItems: await db.inventoryItems.toArray(),
    stockMovements: await db.stockMovements.toArray(),
    parties: await db.parties.toArray(),
    purchases: await db.purchases.toArray(),
    sales: await db.sales.toArray(),
    cashBankAccounts: await db.cashBankAccounts.toArray(),
    bankTransfers: await db.bankTransfers.toArray(),
    loans: await db.loans.toArray(),
    investors: await db.investors.toArray(),
    fixedAssets: await db.fixedAssets.toArray(),
    auditLogs: await db.auditLogs.toArray()
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Agro_ERP_Full_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  recordExportTime();

  return jsonStr;
}

/**
 * Validated Database Restore
 */
export async function restoreFromJsonBackup(
  jsonString: string,
  currentUserUid: string
): Promise<{ success: boolean; message: string; recordCounts?: Record<string, number> }> {
  try {
    const data = JSON.parse(jsonString);
    if (!data.version || !data.timestamp || !Array.isArray(data.journalEntries) || !Array.isArray(data.accounts)) {
      return { success: false, message: 'অবৈধ ব্যাকআপ ফাইল (Invalid backup structure or missing core financial tables).' };
    }

    // Safety step: clear and replace tables safely
    await db.transaction(
      'rw',
      [
        db.systemConfig,
        db.accounts,
        db.journalEntries,
        db.closedPeriods,
        db.animals,
        db.animalEvents,
        db.ponds,
        db.fishBatches,
        db.plots,
        db.cropCycles,
        db.internalFlows,
        db.processingRuns,
        db.inventoryItems,
        db.stockMovements,
        db.parties,
        db.purchases,
        db.sales,
        db.cashBankAccounts,
        db.bankTransfers,
        db.loans,
        db.investors,
        db.fixedAssets,
        db.auditLogs
      ],
      async () => {
        if (data.systemConfig?.length) {
          await db.systemConfig.clear();
          await db.systemConfig.bulkPut(data.systemConfig);
        }
        if (data.accounts?.length) {
          await db.accounts.clear();
          await db.accounts.bulkPut(data.accounts);
        }
        if (data.journalEntries?.length) {
          await db.journalEntries.clear();
          await db.journalEntries.bulkPut(data.journalEntries);
        }
        if (data.closedPeriods?.length) {
          await db.closedPeriods.clear();
          await db.closedPeriods.bulkPut(data.closedPeriods);
        }
        if (data.animals?.length) {
          await db.animals.clear();
          await db.animals.bulkPut(data.animals);
        }
        if (data.animalEvents?.length) {
          await db.animalEvents.clear();
          await db.animalEvents.bulkPut(data.animalEvents);
        }
        if (data.ponds?.length) {
          await db.ponds.clear();
          await db.ponds.bulkPut(data.ponds);
        }
        if (data.fishBatches?.length) {
          await db.fishBatches.clear();
          await db.fishBatches.bulkPut(data.fishBatches);
        }
        if (data.plots?.length) {
          await db.plots.clear();
          await db.plots.bulkPut(data.plots);
        }
        if (data.cropCycles?.length) {
          await db.cropCycles.clear();
          await db.cropCycles.bulkPut(data.cropCycles);
        }
        if (data.internalFlows?.length) {
          await db.internalFlows.clear();
          await db.internalFlows.bulkPut(data.internalFlows);
        }
        if (data.processingRuns?.length) {
          await db.processingRuns.clear();
          await db.processingRuns.bulkPut(data.processingRuns);
        }
        if (data.inventoryItems?.length) {
          await db.inventoryItems.clear();
          await db.inventoryItems.bulkPut(data.inventoryItems);
        }
        if (data.stockMovements?.length) {
          await db.stockMovements.clear();
          await db.stockMovements.bulkPut(data.stockMovements);
        }
        if (data.parties?.length) {
          await db.parties.clear();
          await db.parties.bulkPut(data.parties);
        }
        if (data.purchases?.length) {
          await db.purchases.clear();
          await db.purchases.bulkPut(data.purchases);
        }
        if (data.sales?.length) {
          await db.sales.clear();
          await db.sales.bulkPut(data.sales);
        }
        if (data.cashBankAccounts?.length) {
          await db.cashBankAccounts.clear();
          await db.cashBankAccounts.bulkPut(data.cashBankAccounts);
        }
        if (data.bankTransfers?.length) {
          await db.bankTransfers.clear();
          await db.bankTransfers.bulkPut(data.bankTransfers);
        }
        if (data.loans?.length) {
          await db.loans.clear();
          await db.loans.bulkPut(data.loans);
        }
        if (data.investors?.length) {
          await db.investors.clear();
          await db.investors.bulkPut(data.investors);
        }
        if (data.fixedAssets?.length) {
          await db.fixedAssets.clear();
          await db.fixedAssets.bulkPut(data.fixedAssets);
        }
      }
    );

    // Record restore audit
    await db.auditLogs.put({
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

    return {
      success: true,
      message: 'ডাটাবেজ সফলভাবে রিস্টোর সম্পন্ন হয়েছে!',
      recordCounts: {
        journalEntries: data.journalEntries?.length || 0,
        animals: data.animals?.length || 0,
        fishBatches: data.fishBatches?.length || 0,
        cropCycles: data.cropCycles?.length || 0,
        sales: data.sales?.length || 0
      }
    };
  } catch (err: any) {
    return { success: false, message: `রিস্টোর ব্যর্থ হয়েছে: ${err.message}` };
  }
}

// Convenient alias exports
export const exportMultiSheetExcel = exportAllToExcel;
export const exportSystemBackupJson = createFullJsonBackup;
export const restoreSystemBackupJson = (jsonString: string, uid = 'owner') => restoreFromJsonBackup(jsonString, uid);

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

