import { db } from '../db/indexedDb';
import { Account, AccountClass, JournalEntry, JournalLine, NormalBalance, VoucherType } from '../types';
import { safeInsert } from '../utils/idGenerator';
import { DEFAULT_CHART_OF_ACCOUNTS } from './defaultAccounts';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  nameBn: string;
  nameEn: string;
  accountClass: string;
  debit: number;
  credit: number;
  isOrphan?: boolean;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  difference: number;
  orphanAccounts: string[];
  hasInvalidAccounts: boolean;
}

export interface LedgerEntry {
  date: string;
  voucherNumber: string;
  voucherType: VoucherType;
  narration: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface ProfitLossReport {
  revenues: { code: string; nameBn: string; amount: number }[];
  totalRevenue: number;
  cogs: { code: string; nameBn: string; amount: number }[];
  totalCogs: number;
  grossProfit: number;
  operatingExpenses: { code: string; nameBn: string; amount: number }[];
  totalOperatingExpenses: number;
  operatingProfit: number;
  otherIncome: { code: string; nameBn: string; amount: number }[];
  totalOtherIncome: number;
  otherExpenses: { code: string; nameBn: string; amount: number }[];
  totalOtherExpenses: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  assets: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  totalAssets: number;
  liabilities: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  totalLiabilities: number;
  equity: { code: string; nameBn: string; amount: number; isContra?: boolean }[];
  currentYearNetProfit: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  discrepancy: number;
}

export interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

export type ProfitLossResult = ProfitLossReport;
export type BalanceSheetResult = BalanceSheetReport;

/**
 * Validates that journal lines are strictly balanced, account codes are valid,
 * and amounts are non-negative and non-zero.
 */
export function validateBalancedLines(
  lines: JournalLine[],
  validAccounts?: Account[]
): { isBalanced: boolean; totalDebit: number; totalCredit: number; difference: number } {
  if (!lines || !Array.isArray(lines) || lines.length < 2) {
    throw new Error('Journal entry must contain at least 2 lines.');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.accountCode?.trim();

    if (!code) {
      throw new Error(`Line ${i + 1}: Account code is missing.`);
    }

    // Explicit rejection of invalid account 1050
    if (code === '1050') {
      throw new Error('REJECTED: Account code 1050 does not exist in Chart of Accounts. Use 1051 (Feed), 1052 (Seed/Fert), 1053 (Raw Material), or 1055 (Finished Goods).');
    }

    // Verify against Chart of Accounts if provided
    if (validAccounts && validAccounts.length > 0) {
      const exists = validAccounts.some((a) => a.code === code);
      if (!exists) {
        throw new Error(`REJECTED: Nonexistent account code "${code}". Posting to undefined accounts is strictly forbidden.`);
      }
    }

    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);

    if (isNaN(debit) || isNaN(credit) || !isFinite(debit) || !isFinite(credit)) {
      throw new Error(`Line ${i + 1} (${code}): Invalid numeric amount.`);
    }

    if (debit < 0 || credit < 0) {
      throw new Error(`Line ${i + 1} (${code}): Negative amounts are not allowed (Debit: ${debit}, Credit: ${credit}).`);
    }

    if (debit > 0 && credit > 0) {
      throw new Error(`Line ${i + 1} (${code}): A line cannot have both Debit and Credit amounts.`);
    }

    if (debit === 0 && credit === 0) {
      throw new Error(`Line ${i + 1} (${code}): Line must have a non-zero Debit or Credit amount.`);
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  // Round to 2 decimal places to avoid floating point anomalies
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;

  if (difference !== 0) {
    throw new Error(
      `CRITICAL ACCOUNTING ERROR: জাবেদা ভারসাম্যহীন (Unbalanced Journal Entry)! মোট ডেবিট: ৳${totalDebit}, মোট ক্রেডিট: ৳${totalCredit}। পার্থক্য: ৳${difference}। Double-entry accounting requires Debits = Credits.`
    );
  }

  return {
    isBalanced: true,
    totalDebit,
    totalCredit,
    difference: 0
  };
}

/**
 * Validates a journal entry object
 */
export function validateJournalEntry(
  entry: { lines: JournalLine[] },
  validAccounts?: Account[]
): { isBalanced: boolean; totalDebit: number; totalCredit: number; difference: number } {
  return validateBalancedLines(entry.lines, validAccounts);
}

/**
 * Post a balanced journal entry into IndexedDB with full schema and integrity validation
 */
export async function postJournalEntry(
  entry: Omit<JournalEntry, 'totalDebit' | 'totalCredit'>,
  options?: { skipDbPut?: boolean; accounts?: Account[] }
): Promise<JournalEntry> {
  const accounts = options?.accounts ?? (await db.accounts.toArray());
  const check = validateBalancedLines(entry.lines, accounts);

  if (!check.isBalanced) {
    throw new Error(
      `CRITICAL ACCOUNTING ERROR: জাবেদা ভারসাম্যহীন (Unbalanced Journal Entry)! মোট ডেবিট: ৳${check.totalDebit}, মোট ক্রেডিট: ৳${check.totalCredit}. পার্থক্য: ৳${check.difference}`
    );
  }

  if (check.totalDebit <= 0) {
    throw new Error('লেনদেনের পরিমাণ শূন্য বা ঋণাত্মক হতে পারে না (Zero or negative amount not allowed).');
  }

  const fullEntry: JournalEntry = {
    ...entry,
    totalDebit: check.totalDebit,
    totalCredit: check.totalCredit,
    synced: false
  };

  if (!options?.skipDbPut) {
    await safeInsert(db.journalEntries, fullEntry, { idPrefix: 'j' });
  }

  return fullEntry;
}

/**
 * Helper to resolve or synthesize account metadata for any account code
 * present in journal entries (guaranteeing that Balance Sheet & P&L remain balanced).
 */
function resolveAccountMetadata(code: string, accountsByCode: Map<string, Account>): Account {
  const existing = accountsByCode.get(code);
  if (existing) return existing;

  const defaultAcc = DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.code === code);
  if (defaultAcc) {
    accountsByCode.set(code, defaultAcc);
    return defaultAcc;
  }

  // Infer class based on standard Bangladesh Agro ERP chart prefix
  const firstDigit = code.charAt(0);
  let accountClass: AccountClass = 'ASSET';
  let normalBalance: NormalBalance = 'DEBIT';

  if (firstDigit === '2') {
    accountClass = 'LIABILITY';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '3') {
    accountClass = 'EQUITY';
    normalBalance = code === '3040' ? 'DEBIT' : 'CREDIT';
  } else if (firstDigit === '4') {
    accountClass = 'REVENUE';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '5') {
    accountClass = 'COGS';
    normalBalance = 'DEBIT';
  } else if (firstDigit === '6') {
    accountClass = 'EXPENSE';
    normalBalance = 'DEBIT';
  } else if (firstDigit === '7') {
    accountClass = 'OTHER_INCOME';
    normalBalance = 'CREDIT';
  } else if (firstDigit === '8') {
    accountClass = 'OTHER_EXPENSE';
    normalBalance = 'DEBIT';
  } else {
    accountClass = 'ASSET';
    normalBalance = code === '1590' ? 'CREDIT' : 'DEBIT';
  }

  const synthesized: Account = {
    id: `acc_${code}`,
    code,
    nameBn: `[অনিবন্ধিত হিসাব] ${code}`,
    nameEn: `[Unregistered Account] ${code}`,
    accountClass,
    normalBalance,
    isSystem: false,
    isActive: true
  };
  accountsByCode.set(code, synthesized);
  return synthesized;
}

/**
 * Computes Trial Balance from all posted journal entries.
 * Detects genuine imbalance and identifies any invalid/orphan account references.
 */
export async function generateTrialBalance(dateRange?: DateRangeFilter): Promise<{
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  difference: number;
  orphanAccounts: string[];
  hasInvalidAccounts: boolean;
}> {
  const rawAccounts = await db.accounts.toArray();
  let entries = await db.journalEntries.toArray();

  if (dateRange?.startDate || dateRange?.endDate) {
    entries = entries.filter((e) => {
      if (!e.date) return false;
      if (dateRange.startDate && e.date < dateRange.startDate) return false;
      if (dateRange.endDate && e.date > dateRange.endDate) return false;
      return true;
    });
  }

  // Deduplicate accounts by code
  const accountMap = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountMap.has(acc.code)) {
      accountMap.set(acc.code, acc);
    }
  }
  const accounts = Array.from(accountMap.values());

  const balances: Record<string, { debitSum: number; creditSum: number }> = {};
  const orphanAccountsSet = new Set<string>();

  for (const acc of accounts) {
    balances[acc.code] = { debitSum: 0, creditSum: 0 };
  }

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;
      if (!balances[code]) {
        balances[code] = { debitSum: 0, creditSum: 0 };
      }
      balances[code].debitSum += Number(line.debit || 0);
      balances[code].creditSum += Number(line.credit || 0);

      if (!accountMap.has(code)) {
        orphanAccountsSet.add(code);
      }
    }
  }

  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  // 1. Process valid accounts
  for (const acc of accounts) {
    const raw = balances[acc.code] || { debitSum: 0, creditSum: 0 };
    const net = raw.debitSum - raw.creditSum;

    let debit = 0;
    let credit = 0;

    if (acc.normalBalance === 'DEBIT') {
      if (net >= 0) {
        debit = net;
      } else {
        credit = Math.abs(net);
      }
    } else {
      // CREDIT normal balance
      if (net <= 0) {
        credit = Math.abs(net);
      } else {
        debit = net;
      }
    }

    if (debit > 0 || credit > 0) {
      debit = Math.round(debit * 100) / 100;
      credit = Math.round(credit * 100) / 100;
      totalDebit += debit;
      totalCredit += credit;

      rows.push({
        accountId: acc.id,
        code: acc.code,
        nameBn: acc.nameBn,
        nameEn: acc.nameEn,
        accountClass: acc.accountClass,
        debit,
        credit
      });
    }
  }

  // 2. Process orphan / invalid accounts to detect genuine imbalance and report references
  for (const orphanCode of orphanAccountsSet) {
    const raw = balances[orphanCode] || { debitSum: 0, creditSum: 0 };
    const net = raw.debitSum - raw.creditSum;

    let debit = 0;
    let credit = 0;

    if (net >= 0) {
      debit = net;
    } else {
      credit = Math.abs(net);
    }

    if (debit > 0 || credit > 0) {
      debit = Math.round(debit * 100) / 100;
      credit = Math.round(credit * 100) / 100;
      totalDebit += debit;
      totalCredit += credit;

      rows.push({
        accountId: `orphan_${orphanCode}`,
        code: orphanCode,
        nameBn: `[অবৈধ / অনাথ হিসাব] ${orphanCode}`,
        nameEn: `[INVALID / ORPHAN ACCOUNT] ${orphanCode}`,
        accountClass: 'UNKNOWN',
        debit,
        credit,
        isOrphan: true
      });
    }
  }

  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
  const orphanAccounts = Array.from(orphanAccountsSet);

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: difference === 0,
    difference,
    orphanAccounts,
    hasInvalidAccounts: orphanAccounts.length > 0
  };
}

/**
 * Computes Profit & Loss Statement (লাভ-ক্ষতি বিবরণী)
 */
export async function generateProfitLoss(dateRange?: DateRangeFilter): Promise<ProfitLossReport> {
  const rawAccounts = await db.accounts.toArray();
  let entries = await db.journalEntries.toArray();

  if (dateRange?.startDate || dateRange?.endDate) {
    entries = entries.filter((e) => {
      if (!e.date) return false;
      if (dateRange.startDate && e.date < dateRange.startDate) return false;
      if (dateRange.endDate && e.date > dateRange.endDate) return false;
      return true;
    });
  }

  // Deduplicate accounts by code
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  const accountBalances: Record<string, number> = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;

      if (accountBalances[code] === undefined) accountBalances[code] = 0;
      const acc = resolveAccountMetadata(code, accountsByCode);
      if (acc.normalBalance === 'CREDIT') {
        accountBalances[code] += (Number(line.credit || 0) - Number(line.debit || 0));
      } else {
        accountBalances[code] += (Number(line.debit || 0) - Number(line.credit || 0));
      }
    }
  }

  const revenues: { code: string; nameBn: string; amount: number }[] = [];
  const cogs: { code: string; nameBn: string; amount: number }[] = [];
  const operatingExpenses: { code: string; nameBn: string; amount: number }[] = [];
  const otherIncome: { code: string; nameBn: string; amount: number }[] = [];
  const otherExpenses: { code: string; nameBn: string; amount: number }[] = [];

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOperatingExpenses = 0;
  let totalOtherIncome = 0;
  let totalOtherExpenses = 0;

  for (const acc of accountsByCode.values()) {
    const val = Math.round((accountBalances[acc.code] || 0) * 100) / 100;
    if (val === 0) continue;

    if (acc.accountClass === 'REVENUE') {
      revenues.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalRevenue += val;
    } else if (acc.accountClass === 'COGS') {
      cogs.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalCogs += val;
    } else if (acc.accountClass === 'EXPENSE') {
      operatingExpenses.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOperatingExpenses += val;
    } else if (acc.accountClass === 'OTHER_INCOME') {
      otherIncome.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOtherIncome += val;
    } else if (acc.accountClass === 'OTHER_EXPENSE') {
      otherExpenses.push({ code: acc.code, nameBn: acc.nameBn, amount: val });
      totalOtherExpenses += val;
    }
  }

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCogs = Math.round(totalCogs * 100) / 100;
  const grossProfit = Math.round((totalRevenue - totalCogs) * 100) / 100;
  totalOperatingExpenses = Math.round(totalOperatingExpenses * 100) / 100;
  const operatingProfit = Math.round((grossProfit - totalOperatingExpenses) * 100) / 100;
  totalOtherIncome = Math.round(totalOtherIncome * 100) / 100;
  totalOtherExpenses = Math.round(totalOtherExpenses * 100) / 100;
  const netProfit = Math.round((operatingProfit + totalOtherIncome - totalOtherExpenses) * 100) / 100;

  return {
    revenues,
    totalRevenue,
    cogs,
    totalCogs,
    grossProfit,
    operatingExpenses,
    totalOperatingExpenses,
    operatingProfit,
    otherIncome,
    totalOtherIncome,
    otherExpenses,
    totalOtherExpenses,
    netProfit
  };
}

/**
 * Computes Balance Sheet (উদ্বৃত্তপত্র)
 * Assets = Liabilities + Equity
 * Correctly handles Contra accounts (e.g. 1590 Accumulated Depreciation reduces Assets,
 * and 3040 Owner Drawings reduces Equity).
 */
export async function generateBalanceSheet(dateRange?: DateRangeFilter): Promise<BalanceSheetReport> {
  const rawAccounts = await db.accounts.toArray();
  let entries = await db.journalEntries.toArray();

  if (dateRange?.startDate || dateRange?.endDate) {
    entries = entries.filter((e) => {
      if (!e.date) return false;
      if (dateRange.startDate && e.date < dateRange.startDate) return false;
      if (dateRange.endDate && e.date > dateRange.endDate) return false;
      return true;
    });
  }

  const pl = await generateProfitLoss(dateRange);

  // Deduplicate accounts by code
  const accountsByCode = new Map<string, Account>();
  for (const acc of rawAccounts) {
    if (!accountsByCode.has(acc.code)) {
      accountsByCode.set(acc.code, acc);
    }
  }

  // Accumulate raw debits and credits per account code
  const debits: Record<string, number> = {};
  const credits: Record<string, number> = {};

  for (const entry of entries) {
    for (const line of entry.lines) {
      const code = line.accountCode?.trim();
      if (!code) continue;
      resolveAccountMetadata(code, accountsByCode);

      if (debits[code] === undefined) debits[code] = 0;
      if (credits[code] === undefined) credits[code] = 0;
      debits[code] += Number(line.debit || 0);
      credits[code] += Number(line.credit || 0);
    }
  }

  const assets: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];
  const liabilities: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];
  const equity: { code: string; nameBn: string; amount: number; isContra?: boolean }[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const acc of accountsByCode.values()) {
    const dr = debits[acc.code] || 0;
    const cr = credits[acc.code] || 0;

    if (acc.accountClass === 'ASSET') {
      const isContra = acc.normalBalance === 'CREDIT'; // e.g. 1590 Accumulated Depreciation
      if (isContra) {
        // Contra-asset normal balance is CREDIT. A credit balance reduces total assets.
        const contraVal = Math.round((cr - dr) * 100) / 100;
        if (contraVal !== 0) {
          assets.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalAssets -= contraVal; // Contra account reduces asset balance
        }
      } else {
        // Normal asset: Debit balance increases assets
        const assetVal = Math.round((dr - cr) * 100) / 100;
        if (assetVal !== 0) {
          assets.push({ code: acc.code, nameBn: acc.nameBn, amount: assetVal, isContra: false });
          totalAssets += assetVal;
        }
      }
    } else if (acc.accountClass === 'LIABILITY') {
      const isContra = acc.normalBalance === 'DEBIT';
      if (isContra) {
        // Contra-liability: Debit balance reduces liabilities
        const contraVal = Math.round((dr - cr) * 100) / 100;
        if (contraVal !== 0) {
          liabilities.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalLiabilities -= contraVal;
        }
      } else {
        // Normal liability: Credit balance increases liabilities
        const liabVal = Math.round((cr - dr) * 100) / 100;
        if (liabVal !== 0) {
          liabilities.push({ code: acc.code, nameBn: acc.nameBn, amount: liabVal, isContra: false });
          totalLiabilities += liabVal;
        }
      }
    } else if (acc.accountClass === 'EQUITY') {
      const isContra = acc.normalBalance === 'DEBIT'; // e.g. 3040 Owner Drawings
      if (isContra) {
        // Contra-equity: Debit balance reduces equity
        const contraVal = Math.round((dr - cr) * 100) / 100;
        if (contraVal !== 0) {
          equity.push({ code: acc.code, nameBn: acc.nameBn, amount: -contraVal, isContra: true });
          totalEquity -= contraVal; // Contra-equity reduces total equity
        }
      } else {
        // Normal equity: Credit balance increases equity
        const eqVal = Math.round((cr - dr) * 100) / 100;
        if (eqVal !== 0) {
          equity.push({ code: acc.code, nameBn: acc.nameBn, amount: eqVal, isContra: false });
          totalEquity += eqVal;
        }
      }
    }
  }

  totalAssets = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;

  // Current year net profit rolls directly into Equity
  const currentYearNetProfit = pl.netProfit;
  totalEquity = Math.round((totalEquity + currentYearNetProfit) * 100) / 100;

  let totalLiabilitiesAndEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;
  let discrepancy = Math.round(Math.abs(totalAssets - totalLiabilitiesAndEquity) * 100) / 100;

  // Financial rounding reconciliation: discrepancy <= 0.01 is within float rounding tolerance
  const isBalanced = discrepancy <= 0.01;
  if (isBalanced && discrepancy > 0) {
    totalLiabilitiesAndEquity = totalAssets;
    discrepancy = 0;
  }

  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    currentYearNetProfit,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    discrepancy
  };
}

/**
 * Automatically migrates deprecated / legacy accounts (e.g. 1050)
 * to their designated canonical replacements (1051, 1052, 1053, 1055).
 */
export async function migrateLegacyAccounts(): Promise<number> {
  let migratedCount = 0;
  const entries = await db.journalEntries.toArray();

  for (const entry of entries) {
    let entryModified = false;
    const newLines = entry.lines.map((line) => {
      const code = line.accountCode?.trim();
      if (code === '1050' || line.accountId === '1050') {
        entryModified = true;
        migratedCount++;
        const desc = `${entry.narration || ''} ${line.memo || ''} ${line.accountName || ''}`.toLowerCase();
        let targetCode = '1051';
        let targetName = 'পশুখাদ্য মজুদ (Feed Inventory)';
        if (desc.includes('সার') || desc.includes('বীজ') || desc.includes('fert') || desc.includes('seed')) {
          targetCode = '1052';
          targetName = 'সার ও বীজ মজুদ (Fertilizer & Seed Inventory)';
        } else if (desc.includes('কাঁচামাল') || desc.includes('raw')) {
          targetCode = '1053';
          targetName = 'কাঁচামাল মজুদ (Raw Materials)';
        } else if (
          desc.includes('পণ্য') ||
          desc.includes('দুধ') ||
          desc.includes('মাছ') ||
          desc.includes('product') ||
          desc.includes('meat') ||
          desc.includes('মাংস')
        ) {
          targetCode = '1055';
          targetName = 'প্রস্তুত পণ্য / সমাপনী মজুদ (Finished Goods)';
        }

        return {
          ...line,
          accountId: targetCode,
          accountCode: targetCode,
          accountName: targetName
        };
      }
      return line;
    });

    if (entryModified) {
      await db.journalEntries.update(entry.id, { lines: newLines });
    }
  }

  // Remove legacy 1050 account if present in db.accounts
  const legacy1050 = await db.accounts.where('code').equals('1050').first();
  if (legacy1050) {
    await db.accounts.delete(legacy1050.id);
  }

  return migratedCount;
}

/**
 * Computes General Ledger entries for a specific account code
 */
export async function getGeneralLedger(accountCode: string): Promise<{ account?: Account; entries: LedgerEntry[]; netBalance: number }> {
  const account = await db.accounts.where('code').equals(accountCode).first();
  const entries = await db.journalEntries.orderBy('date').toArray();

  const ledgerEntries: LedgerEntry[] = [];
  let running = 0;

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode === accountCode) {
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);

        if (account?.normalBalance === 'CREDIT') {
          running += (credit - debit);
        } else {
          running += (debit - credit);
        }

        ledgerEntries.push({
          date: entry.date,
          voucherNumber: entry.voucherNumber,
          voucherType: entry.voucherType,
          narration: entry.narration,
          debit,
          credit,
          runningBalance: Math.round(running * 100) / 100
        });
      }
    }
  }

  return {
    account,
    entries: ledgerEntries,
    netBalance: Math.round(running * 100) / 100
  };
}
