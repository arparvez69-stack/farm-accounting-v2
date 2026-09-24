/**
 * Bank and Cash Reconciliation Service
 * 
 * Provides a read/tracking layer for manual bank passbook & cash drawer reconciliation.
 * DOES NOT alter any journal entries, ledger accounts, or financial statements.
 */

import { db } from '../db/indexedDb';
import { CashBankAccount, JournalEntry } from '../types';

export interface BankReconcileTransaction {
  id: string; // unique transaction identifier (e.g. `${journalEntryId}_${lineIdx}`)
  journalEntryId: string;
  date: string;
  voucherNumber: string;
  voucherType: string;
  narration: string;
  memo?: string;
  debit: number; // Deposit / Inflow (টাকা জমা)
  credit: number; // Withdrawal / Outflow (টাকা উত্তোলন / খরচ)
  amount: number;
  runningBalance?: number;
  isReversed?: boolean;
}

export interface BankReconcileState {
  statementBalance: string;
  clearedTxIds: string[];
  statementDate: string;
  notes: string;
  updatedAt?: string;
}

export interface BankReconciliationSummary {
  bookBalance: number;
  statementBalance: number;
  difference: number;
  isBalanced: boolean;
  hasStatementEntered: boolean;
  totalTransactions: number;
  clearedCount: number;
  unclearedCount: number;
  clearedDeposits: number;
  clearedWithdrawals: number;
  clearedNet: number;
  unclearedDeposits: number;
  unclearedWithdrawals: number;
  unclearedNet: number;
}

// In-memory fallback cache for Node test environments where localStorage is not defined
const inMemoryReconciliationCache: Record<string, string> = {};

const STORAGE_PREFIX = 'goted_bank_reconcile_';

/**
 * Retrieves persisted reconciliation tracking state for an account
 */
export function getStoredBankReconciliation(accountId: string): BankReconcileState {
  try {
    const key = `${STORAGE_PREFIX}${accountId}`;
    let raw: string | null = null;

    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(key);
    } else if (typeof (globalThis as any).localStorage !== 'undefined') {
      raw = (globalThis as any).localStorage.getItem(key);
    } else {
      raw = inMemoryReconciliationCache[key] || null;
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        statementBalance: parsed.statementBalance !== undefined ? String(parsed.statementBalance) : '',
        clearedTxIds: Array.isArray(parsed.clearedTxIds) ? parsed.clearedTxIds : [],
        statementDate: parsed.statementDate || new Date().toISOString().split('T')[0],
        notes: parsed.notes || '',
        updatedAt: parsed.updatedAt
      };
    }
  } catch (err) {
    console.error('Error reading bank reconciliation state from storage:', err);
  }

  return {
    statementBalance: '',
    clearedTxIds: [],
    statementDate: new Date().toISOString().split('T')[0],
    notes: ''
  };
}

/**
 * Saves persisted reconciliation tracking state for an account
 */
export function saveStoredBankReconciliation(
  accountId: string,
  data: Partial<BankReconcileState>
): BankReconcileState {
  const current = getStoredBankReconciliation(accountId);
  const updated: BankReconcileState = {
    statementBalance: data.statementBalance !== undefined ? String(data.statementBalance) : current.statementBalance,
    clearedTxIds: data.clearedTxIds !== undefined ? data.clearedTxIds : current.clearedTxIds,
    statementDate: data.statementDate !== undefined ? data.statementDate : current.statementDate,
    notes: data.notes !== undefined ? data.notes : current.notes,
    updatedAt: new Date().toISOString()
  };

  const key = `${STORAGE_PREFIX}${accountId}`;
  const serialized = JSON.stringify(updated);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    } else if (typeof (globalThis as any).localStorage !== 'undefined') {
      (globalThis as any).localStorage.setItem(key, serialized);
    }
  } catch (err) {
    console.error('Error writing bank reconciliation state to localStorage:', err);
  }

  inMemoryReconciliationCache[key] = serialized;
  return updated;
}

/**
 * Loads all journal entries associated with a specific cash or bank account
 * for manual reconciliation.
 * Does NOT modify any data.
 */
export async function loadBankTransactionsForAccount(
  accountId: string,
  dbInstance: any = db
): Promise<{
  account: CashBankAccount | undefined;
  transactions: BankReconcileTransaction[];
}> {
  const accounts: CashBankAccount[] = await dbInstance.cashBankAccounts.toArray();
  const targetAcc = accounts.find((a) => a.id === accountId);
  if (!targetAcc) {
    return { account: undefined, transactions: [] };
  }

  const entries: JournalEntry[] = await dbInstance.journalEntries.toArray();

  // Sort chronologically ascending
  entries.sort((a, b) => {
    const dDiff = (a.date || '').localeCompare(b.date || '');
    if (dDiff !== 0) return dDiff;
    return (a.voucherNumber || '').localeCompare(b.voucherNumber || '');
  });

  const isCash = (targetAcc.accountType as string) === 'CASH' || (targetAcc.accountType as string) === 'PETTY_CASH';
  const targetCodes = isCash ? ['1010', '1020'] : ['1030'];

  const sameTypeAccounts = accounts.filter((a) =>
    isCash
      ? (a.accountType as string) === 'CASH' || (a.accountType as string) === 'PETTY_CASH'
      : (a.accountType as string) !== 'CASH' && (a.accountType as string) !== 'PETTY_CASH'
  );

  const isOnlyAccountOfType = sameTypeAccounts.length <= 1;

  let bankTransfers: any[] = [];
  try {
    if (dbInstance.bankTransfers?.toArray) {
      bankTransfers = await dbInstance.bankTransfers.toArray();
    }
  } catch {}

  const result: BankReconcileTransaction[] = [];
  let running = 0;

  for (const entry of entries) {
    const isEntryReversed = !!entry.reversedBy || entry.status === 'REVERSED';

    for (let lineIdx = 0; lineIdx < (entry.lines || []).length; lineIdx++) {
      const line = entry.lines[lineIdx];
      if (!targetCodes.includes(line.accountCode)) {
        continue;
      }

      let matched = false;

      // 1. Direct account ID match
      if (line.accountId === targetAcc.id) {
        matched = true;
      }
      // 2. Line memo contains target account ID or name
      else if (
        line.memo &&
        (line.memo.includes(targetAcc.id) ||
         (targetAcc.name && line.memo.toLowerCase().includes(targetAcc.name.toLowerCase())))
      ) {
        matched = true;
      }
      // 3. Line accountName contains target account name
      else if (
        line.accountName &&
        targetAcc.name &&
        line.accountName.toLowerCase().includes(targetAcc.name.toLowerCase())
      ) {
        matched = true;
      }
      // 4. Contra transfer voucher reference
      else if (entry.voucherType === 'CONTRA' && bankTransfers.length > 0) {
        const transfer = bankTransfers.find(
          (t) => t.journalEntryId === entry.id || t.reference === entry.voucherNumber || t.reference === entry.reference
        );
        if (transfer) {
          if (transfer.fromAccountId === targetAcc.id && Number(line.credit) > 0) {
            matched = true;
          }
          if (transfer.toAccountId === targetAcc.id && Number(line.debit) > 0) {
            matched = true;
          }
        }
      }
      // 5. Entry narration contains account name
      else if (
        entry.narration &&
        targetAcc.name &&
        entry.narration.toLowerCase().includes(targetAcc.name.toLowerCase())
      ) {
        matched = true;
      }
      // 6. If this is the only account of this type, all lines with this code belong to it
      else if (isOnlyAccountOfType) {
        matched = true;
      }
      // 7. Fallback when multiple accounts exist
      else {
        const otherMatches = sameTypeAccounts.some(
          (other) =>
            other.id !== targetAcc.id &&
            (line.accountId === other.id ||
             (line.memo && (line.memo.includes(other.id) || (other.name && line.memo.toLowerCase().includes(other.name.toLowerCase())))) ||
             (line.accountName && other.name && line.accountName.toLowerCase().includes(other.name.toLowerCase())) ||
             (entry.narration && other.name && entry.narration.toLowerCase().includes(other.name.toLowerCase())))
        );
        if (!otherMatches && sameTypeAccounts[0]?.id === targetAcc.id) {
          matched = true;
        }
      }

      if (matched) {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        running += debit - credit;

        result.push({
          id: `${entry.id}_${lineIdx}`,
          journalEntryId: entry.id,
          date: entry.date,
          voucherNumber: entry.voucherNumber,
          voucherType: entry.voucherType,
          narration: entry.narration,
          memo: line.memo,
          debit,
          credit,
          amount: debit > 0 ? debit : credit,
          runningBalance: Math.round(running * 100) / 100,
          isReversed: isEntryReversed
        });
      }
    }
  }

  return {
    account: targetAcc,
    transactions: result
  };
}

/**
 * Calculates reconciliation metrics comparing book balance, statement balance, and cleared items.
 */
export function calculateBankReconciliationMetrics(
  account: CashBankAccount,
  transactions: BankReconcileTransaction[],
  statementBalanceStr: string,
  clearedIds: Set<string>
): BankReconciliationSummary {
  const bookBalance = Math.round(Number(account.currentBalance ?? (account as any).balance ?? 0) * 100) / 100;
  const hasStatementEntered = statementBalanceStr.trim() !== '' && !isNaN(Number(statementBalanceStr));
  const statementBalance = hasStatementEntered ? Math.round(Number(statementBalanceStr) * 100) / 100 : 0;
  const difference = hasStatementEntered ? Math.round((statementBalance - bookBalance) * 100) / 100 : 0;
  const isBalanced = hasStatementEntered && Math.abs(difference) < 0.01;

  let clearedCount = 0;
  let clearedDeposits = 0;
  let clearedWithdrawals = 0;
  let unclearedDeposits = 0;
  let unclearedWithdrawals = 0;

  for (const tx of transactions) {
    if (clearedIds.has(tx.id)) {
      clearedCount++;
      clearedDeposits += tx.debit;
      clearedWithdrawals += tx.credit;
    } else {
      unclearedDeposits += tx.debit;
      unclearedWithdrawals += tx.credit;
    }
  }

  clearedDeposits = Math.round(clearedDeposits * 100) / 100;
  clearedWithdrawals = Math.round(clearedWithdrawals * 100) / 100;
  const clearedNet = Math.round((clearedDeposits - clearedWithdrawals) * 100) / 100;

  unclearedDeposits = Math.round(unclearedDeposits * 100) / 100;
  unclearedWithdrawals = Math.round(unclearedWithdrawals * 100) / 100;
  const unclearedNet = Math.round((unclearedDeposits - unclearedWithdrawals) * 100) / 100;

  return {
    bookBalance,
    statementBalance,
    difference,
    isBalanced,
    hasStatementEntered,
    totalTransactions: transactions.length,
    clearedCount,
    unclearedCount: transactions.length - clearedCount,
    clearedDeposits,
    clearedWithdrawals,
    clearedNet,
    unclearedDeposits,
    unclearedWithdrawals,
    unclearedNet
  };
}
