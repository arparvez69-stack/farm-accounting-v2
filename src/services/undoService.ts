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

export async function executeUndo(action: UndoableAction): Promise<{ success: boolean; message: string }> {
  // Clear the active undo toast immediately
  dismissUndo();

  try {
    if (action.type === 'JOURNAL_ENTRY') {
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId);
      }
    } else if (action.type === 'ANIMAL_EVENT') {
      // 1. If linked to a journal entry, reverse it with reversedBy/reversalOf
      if (action.journalEntryId) {
        try {
          await reverseJournalEntry(action.journalEntryId, action.currentUserId);
        } catch (revErr) {
          console.warn('Animal event journal entry reversal note:', revErr);
        }
      }

      // 2. Delete the just-created AnimalEvent record
      await db.animalEvents.delete(action.eventId);

      // 3. Delete any auto-created reminder
      if (action.createdReminderId) {
        await db.reminders.delete(action.createdReminderId);
      }

      // 4. Revert animal running totals
      const freshAnimal = await db.animals.get(action.animalId);
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

        await db.animals.update(freshAnimal.id, {
          accumulatedFeedCost: Math.round(newFeed * 100) / 100,
          accumulatedMedCost: Math.round(newMed * 100) / 100,
          accumulatedLabourCost: Math.round(newLabour * 100) / 100,
          otherCosts: Math.round(newOther * 100) / 100,
          totalCost: Math.round(newTotal * 100) / 100,
          synced: false
        });
      }

      // 5. Restore feed stock if quantity was deducted
      if (action.feedItemId && action.feedQuantityUsed && action.feedQuantityUsed > 0) {
        const feedItem = await db.inventoryItems.get(action.feedItemId);
        if (feedItem) {
          await db.inventoryItems.update(feedItem.id, {
            currentStock: Math.round((feedItem.currentStock + action.feedQuantityUsed) * 100) / 100,
            synced: false
          });
        }
      }
    } else if (action.type === 'SALE') {
      // 1. Reverse the journal entry
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId);
      }

      // 2. Remove sale record
      await db.sales.delete(action.saleId);

      // 3. Restore inventory stock
      const item = await db.inventoryItems.get(action.itemId);
      if (item) {
        await db.inventoryItems.update(item.id, {
          currentStock: Math.round((item.currentStock + action.quantity) * 100) / 100,
          synced: false
        });
      }

      // 4. Revert party AP/AR if credit
      if (action.paymentMethod === 'CREDIT') {
        const customer = await db.parties.get(action.customerId);
        if (customer) {
          await db.parties.update(customer.id, {
            balance: Math.round(((customer.balance || 0) - action.totalAmount) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'CASH') {
        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance - action.totalAmount) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'BANK') {
        const bankAcc = action.bankAccountId
          ? await db.cashBankAccounts.get(action.bankAccountId)
          : await db.cashBankAccounts.where('accountType').equals('BANK').first();
        if (bankAcc) {
          await db.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance - action.totalAmount) * 100) / 100
          });
        }
      }
    } else if (action.type === 'PURCHASE') {
      // 1. Reverse the journal entry
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId);
      }

      // 2. Remove purchase record
      await db.purchases.delete(action.purchaseId);

      // 3. Deduct stock added by purchase
      const item = await db.inventoryItems.get(action.itemId);
      if (item) {
        await db.inventoryItems.update(item.id, {
          currentStock: Math.max(0, Math.round((item.currentStock - action.quantity) * 100) / 100),
          synced: false
        });
      }

      // 4. Revert party AP/AR if credit
      if (action.paymentMethod === 'CREDIT') {
        const supplier = await db.parties.get(action.supplierId);
        if (supplier) {
          await db.parties.update(supplier.id, {
            balance: Math.round(((supplier.balance || 0) - action.grandTotal) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'CASH') {
        const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
        if (cashAcc) {
          await db.cashBankAccounts.update(cashAcc.id, {
            currentBalance: Math.round((cashAcc.currentBalance + action.grandTotal) * 100) / 100
          });
        }
      } else if (action.paymentMethod === 'BANK') {
        const bankAcc = action.bankAccountId
          ? await db.cashBankAccounts.get(action.bankAccountId)
          : await db.cashBankAccounts.where('accountType').equals('BANK').first();
        if (bankAcc) {
          await db.cashBankAccounts.update(bankAcc.id, {
            currentBalance: Math.round((bankAcc.currentBalance + action.grandTotal) * 100) / 100
          });
        }
      }
    }

    // Trigger global refresh for open modules
    window.dispatchEvent(new CustomEvent('goted_data_changed'));
    return { success: true, message: 'সফলভাবে বাতিল (Undo) করা হয়েছে।' };
  } catch (error) {
    console.error('Failed to execute undo:', error);
    throw error;
  }
}
