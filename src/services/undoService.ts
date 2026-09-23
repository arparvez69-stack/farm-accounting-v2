import { db } from '../db/indexedDb';
import { reverseJournalEntry } from '../accounting/accountingEngine';

export type UndoableAction =
  | {
      type: 'ANIMAL_EVENT';
      eventId: string;
      journalEntryId?: string;
      animalId: string;
      cost: number;
      eventType: string;
      createdReminderId?: string;
      feedItemId?: string;
      feedQuantityUsed?: number;
      currentUserId: string;
    }
  | {
      type: 'JOURNAL_ENTRY';
      journalEntryId: string;
      currentUserId: string;
    }
  | {
      type: 'SALE';
      saleId: string;
      journalEntryId: string;
      itemId: string;
      quantity: number;
      customerId: string;
      totalAmount: number;
      paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
      bankAccountId?: string;
      currentUserId: string;
    }
  | {
      type: 'PURCHASE';
      purchaseId: string;
      journalEntryId: string;
      itemId: string;
      quantity: number;
      supplierId: string;
      grandTotal: number;
      paymentMethod: 'CASH' | 'BANK' | 'CREDIT';
      bankAccountId?: string;
      currentUserId: string;
    };

type UndoListener = (action: UndoableAction | null) => void;
const listeners = new Set<UndoListener>();
let currentAction: UndoableAction | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function notifyUndoableAction(action: UndoableAction) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  currentAction = action;
  listeners.forEach((listener) => listener(currentAction));

  // Auto-dismiss after exactly 5 seconds
  timer = setTimeout(() => {
    currentAction = null;
    listeners.forEach((listener) => listener(null));
    timer = null;
  }, 5000);
}

export function dismissUndo() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  currentAction = null;
  listeners.forEach((listener) => listener(null));
}

export function subscribeToUndo(listener: UndoListener): () => void {
  listeners.add(listener);
  listener(currentAction);
  return () => {
    listeners.delete(listener);
  };
}

export async function executeUndo(
  action: UndoableAction,
  dbInstance: any = db
): Promise<{ success: boolean; message: string }> {
  // Clear the active undo toast immediately
  dismissUndo();

  const targetDb = dbInstance || db;

  const transactionTables = [
    targetDb.journalEntries,
    targetDb.cashBankAccounts,
    targetDb.inventoryItems,
    targetDb.stockMovements,
    targetDb.parties,
    targetDb.sales,
    targetDb.purchases,
    targetDb.animalEvents,
    targetDb.animals,
    targetDb.payments,
    targetDb.reminders,
    targetDb.accounts,
    targetDb.auditLogs,
    targetDb.closedPeriods
  ].filter(Boolean);

  const performUndo = async (): Promise<{ success: boolean; message: string }> => {
    if (action.type === 'JOURNAL_ENTRY') {
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId, undefined, targetDb);
      }
    } else if (action.type === 'ANIMAL_EVENT') {
      // 1. If linked to a journal entry, reverse it atomically
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId, undefined, targetDb);
      }

      // 2. Delete the just-created AnimalEvent record
      if (targetDb.animalEvents?.delete) {
        await targetDb.animalEvents.delete(action.eventId);
      }

      // 3. Delete any auto-created reminder
      if (action.createdReminderId && targetDb.reminders?.delete) {
        await targetDb.reminders.delete(action.createdReminderId);
      }

      // 4. Revert animal running totals
      if (targetDb.animals?.get) {
        const freshAnimal = await targetDb.animals.get(action.animalId);
        if (freshAnimal) {
          const feedCost = action.eventType === 'FEED' ? action.cost : 0;
          const medCost = (action.eventType === 'VACCINE' || action.eventType === 'TREATMENT') ? action.cost : 0;
          const isLabour = (action.eventType as string) === 'LABOUR';
          const labourCost = isLabour ? action.cost : 0;
          const otherCost = (!isLabour && action.eventType !== 'FEED' && action.eventType !== 'VACCINE' && action.eventType !== 'TREATMENT') ? action.cost : 0;

          const newFeed = Math.max(0, (freshAnimal.accumulatedFeedCost || 0) - feedCost);
          const newMed = Math.max(0, (freshAnimal.accumulatedMedCost || 0) - medCost);
          const newLabour = Math.max(0, (freshAnimal.accumulatedLabourCost || 0) - labourCost);
          const newOther = Math.max(0, (freshAnimal.otherCosts || 0) - otherCost);
          const newTotal = Math.max(0, (freshAnimal.purchaseCost || 0) + newFeed + newMed + newLabour + newOther);

          await targetDb.animals.update(freshAnimal.id, {
            accumulatedFeedCost: Math.round(newFeed * 100) / 100,
            accumulatedMedCost: Math.round(newMed * 100) / 100,
            accumulatedLabourCost: Math.round(newLabour * 100) / 100,
            otherCosts: Math.round(newOther * 100) / 100,
            totalCost: Math.round(newTotal * 100) / 100,
            synced: false
          });
        }
      }

      // 5. Restore feed stock if quantity was deducted
      if (action.feedItemId && action.feedQuantityUsed && action.feedQuantityUsed > 0 && targetDb.inventoryItems?.get) {
        const feedItem = await targetDb.inventoryItems.get(action.feedItemId);
        if (feedItem) {
          await targetDb.inventoryItems.update(feedItem.id, {
            currentStock: Math.round(((feedItem.currentStock || 0) + action.feedQuantityUsed) * 100) / 100,
            synced: false
          });
        }
      }

      // 6. Clean up feed stock movements
      if (targetDb.stockMovements?.toArray && targetDb.stockMovements?.delete) {
        const movements = await targetDb.stockMovements.toArray();
        const toDelete = movements.filter((m: any) => m.referenceId === action.eventId);
        for (const sm of toDelete) {
          await targetDb.stockMovements.delete(sm.id);
        }
      }
    } else if (action.type === 'SALE') {
      // 1. Get sale details for stock movement and party cleanup
      const sale = targetDb.sales?.get ? await targetDb.sales.get(action.saleId) : null;

      // 2. Reverse the journal entry
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId, undefined, targetDb);
      }

      // 3. Remove sale record
      if (targetDb.sales?.delete) {
        await targetDb.sales.delete(action.saleId);
      }

      // 4. Restore inventory stock
      if (targetDb.inventoryItems?.get) {
        const item = await targetDb.inventoryItems.get(action.itemId);
        if (item) {
          await targetDb.inventoryItems.update(item.id, {
            currentStock: Math.round(((item.currentStock || 0) + action.quantity) * 100) / 100,
            synced: false
          });
        }
      }

      // 5. Delete stock movement created by sale
      if (targetDb.stockMovements?.toArray && targetDb.stockMovements?.delete) {
        const movements = await targetDb.stockMovements.toArray();
        const toDelete = movements.filter((m: any) =>
          (sale && (m.referenceId === sale.invoiceNumber || m.referenceId === sale.id)) ||
          m.referenceId === action.saleId ||
          (m.movementType === 'SALE' && m.itemId === action.itemId && m.quantity === action.quantity)
        );
        for (const sm of toDelete) {
          await targetDb.stockMovements.delete(sm.id);
        }
      }

      // 6. Revert party AP/AR if credit
      if (action.paymentMethod === 'CREDIT' && targetDb.parties?.get) {
        const customer = await targetDb.parties.get(action.customerId);
        if (customer) {
          await targetDb.parties.update(customer.id, {
            balance: Math.round(((customer.balance || 0) - action.totalAmount) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'CASH' && targetDb.cashBankAccounts?.where) {
        const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await targetDb.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round(((cashAcc.currentBalance || 0) - action.totalAmount) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'BANK' && targetDb.cashBankAccounts) {
        const bankAcc = action.bankAccountId && targetDb.cashBankAccounts.get
          ? await targetDb.cashBankAccounts.get(action.bankAccountId)
          : await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
        if (bankAcc) {
          await targetDb.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round(((bankAcc.currentBalance || 0) - action.totalAmount) * 100) / 100
          });
        }
      }
    } else if (action.type === 'PURCHASE') {
      // 1. Get purchase details for stock movement cleanup
      const purchase = targetDb.purchases?.get ? await targetDb.purchases.get(action.purchaseId) : null;

      // 2. Reverse the journal entry
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId, undefined, targetDb);
      }

      // 3. Remove purchase record
      if (targetDb.purchases?.delete) {
        await targetDb.purchases.delete(action.purchaseId);
      }

      // 4. Deduct stock added by purchase
      if (targetDb.inventoryItems?.get) {
        const item = await targetDb.inventoryItems.get(action.itemId);
        if (item) {
          await targetDb.inventoryItems.update(item.id, {
            currentStock: Math.max(0, Math.round(((item.currentStock || 0) - action.quantity) * 100) / 100),
            synced: false
          });
        }
      }

      // 5. Delete stock movement created by purchase
      if (targetDb.stockMovements?.toArray && targetDb.stockMovements?.delete) {
        const movements = await targetDb.stockMovements.toArray();
        const toDelete = movements.filter((m: any) =>
          (purchase && (m.referenceId === purchase.invoiceNumber || m.referenceId === purchase.id)) ||
          m.referenceId === action.purchaseId ||
          (m.movementType === 'PURCHASE' && m.itemId === action.itemId && m.quantity === action.quantity)
        );
        for (const sm of toDelete) {
          await targetDb.stockMovements.delete(sm.id);
        }
      }

      // 6. Revert party AP/AR if credit
      if (action.paymentMethod === 'CREDIT' && targetDb.parties?.get) {
        const supplier = await targetDb.parties.get(action.supplierId);
        if (supplier) {
          await targetDb.parties.update(supplier.id, {
            balance: Math.round(((supplier.balance || 0) - action.grandTotal) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'CASH' && targetDb.cashBankAccounts?.where) {
        const cashAcc = await targetDb.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await targetDb.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round(((cashAcc.currentBalance || 0) + action.grandTotal) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'BANK' && targetDb.cashBankAccounts) {
        const bankAcc = action.bankAccountId && targetDb.cashBankAccounts.get
          ? await targetDb.cashBankAccounts.get(action.bankAccountId)
          : await targetDb.cashBankAccounts.where('accountType').equals('BANK').first();
        if (bankAcc) {
          await targetDb.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round(((bankAcc.currentBalance || 0) + action.grandTotal) * 100) / 100
          });
        }
      }
    }

    // Trigger global refresh for open modules
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('goted_data_changed'));
    }
    return { success: true, message: 'সফলভাবে বাতিল (Undo) করা হয়েছে।' };
  };

  try {
    if (typeof targetDb.transaction === 'function') {
      return await targetDb.transaction('rw', transactionTables, performUndo);
    } else {
      return await performUndo();
    }
  } catch (error) {
    console.error('Failed to execute undo:', error);
    throw error;
  }
}
