import { db } from '../db/indexedDb';
import { reverseJournalEntry, getClosedPeriods } from '../accounting/accountingEngine';

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
    const today = new Date().toISOString().split('T')[0];
    const closedPeriods = await getClosedPeriods(targetDb);
    const latestClosed = closedPeriods.length > 0 ? closedPeriods[0] : null;
    const conflictingClosed = closedPeriods.find((cp: any) =>
      cp.startDate ? today >= cp.startDate && today <= cp.endDate : today <= cp.endDate
    ) || (latestClosed && today <= latestClosed.endDate ? latestClosed : null);

    if (conflictingClosed) {
      throw new Error(
        `হিসাবরক্ষণ সীমাবদ্ধতা: সর্বশেষ সমাপ্ত হিসাবকাল ${conflictingClosed.endDate} পর্যন্ত বন্ধ। বন্ধ সময়কালে কোনো লেনদেন বাতিল বা পরিবর্তন করা যাবে না (Cannot undo/reverse inside closed period ending ${conflictingClosed.endDate})।`
      );
    }

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

      // 6. Record counter stock movement if not already reversed
      if (targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const toReverse = movements.filter((m: any) => m.referenceId === action.eventId && !m.reversedBy && m.movementType !== 'REVERSAL');
        for (const sm of toReverse) {
          const counterSm = {
            id: `sm_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            date: new Date().toISOString().split('T')[0],
            itemId: sm.itemId,
            movementType: 'REVERSAL' as const,
            quantity: sm.quantity,
            unitCost: sm.unitCost,
            totalValue: sm.totalValue,
            referenceId: sm.referenceId || action.eventId,
            reversalOf: sm.id,
            notes: `ইভেন্ট বাতিল/রিভার্সাল (Reversal of feed movement ${sm.id})`,
            direction: 'IN' as const,
            adjustmentType: 'INCREASE' as const,
            synced: false
          };
          await targetDb.stockMovements.add(counterSm);
          await targetDb.stockMovements.update(sm.id, {
            reversedBy: counterSm.id,
            status: 'REVERSED',
            synced: false
          });
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

      // 5. Record counter stock movement for sale if not already reversed by reverseJournalEntry
      if (targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const toReverse = movements.filter((m: any) =>
          !m.reversedBy &&
          m.movementType !== 'REVERSAL' &&
          ((sale && (m.referenceId === sale.invoiceNumber || m.referenceId === sale.id)) ||
            m.referenceId === action.saleId ||
            (m.movementType === 'SALE' && m.itemId === action.itemId && m.quantity === action.quantity))
        );
        for (const sm of toReverse) {
          const counterSm = {
            id: `sm_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            date: new Date().toISOString().split('T')[0],
            itemId: sm.itemId,
            movementType: 'REVERSAL' as const,
            quantity: sm.quantity,
            unitCost: sm.unitCost,
            totalValue: sm.totalValue,
            referenceId: sm.referenceId || action.saleId,
            reversalOf: sm.id,
            notes: `বিক্রয় বাতিল/রিভার্সাল (Reversal of sale movement ${sm.id})`,
            direction: 'IN' as const,
            adjustmentType: 'INCREASE' as const,
            synced: false
          };
          await targetDb.stockMovements.add(counterSm);
          await targetDb.stockMovements.update(sm.id, {
            reversedBy: counterSm.id,
            status: 'REVERSED',
            synced: false
          });
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
      // 0. Task B4: Verify sufficient stock exists BEFORE making any changes or calling reverseJournalEntry
      const purchase = targetDb.purchases?.get ? await targetDb.purchases.get(action.purchaseId) : null;
      const itemsToCheck: { itemId: string; quantity: number }[] = [];
      if (purchase?.items && Array.isArray(purchase.items) && purchase.items.length > 0) {
        for (const it of purchase.items) {
          itemsToCheck.push({ itemId: it.itemId, quantity: Number(it.quantity || 0) });
        }
      } else if (action.itemId && action.quantity) {
        itemsToCheck.push({ itemId: action.itemId, quantity: Number(action.quantity || 0) });
      }

      const requiredQtyByItem = new Map<string, number>();
      for (const it of itemsToCheck) {
        requiredQtyByItem.set(it.itemId, (requiredQtyByItem.get(it.itemId) || 0) + it.quantity);
      }

      if (targetDb.inventoryItems?.get) {
        for (const [itemId, requiredQty] of requiredQtyByItem.entries()) {
          const item = await targetDb.inventoryItems.get(itemId);
          const currentStock = Number(item?.currentStock || 0);
          if (currentStock < requiredQty) {
            throw new Error(
              `ক্রয় বাতিল ব্যর্থ: '${item?.nameBn || item?.nameEn || itemId}' এর পর্যাপ্ত স্টক নেই (বর্তমান স্টক: ${currentStock}, কর্তন প্রয়োজন: ${requiredQty})। স্টক নেগেটিভ করা যাবে না (Insufficient stock for purchase reversal).`
            );
          }
        }
      }

      // 1. Reverse the journal entry (which will handle linked purchase and inventory deduction atomically)
      let journalReversed = false;
      if (action.journalEntryId) {
        await reverseJournalEntry(action.journalEntryId, action.currentUserId, undefined, targetDb);
        journalReversed = true;
      }

      // 2. Remove purchase record
      if (targetDb.purchases?.delete) {
        await targetDb.purchases.delete(action.purchaseId);
      }

      // 3. Deduct stock added by purchase ONLY if not already deducted by reverseJournalEntry
      if (!journalReversed && targetDb.inventoryItems?.get) {
        const item = await targetDb.inventoryItems.get(action.itemId);
        if (item) {
          const currentStock = Number(item.currentStock || 0);
          if (currentStock < action.quantity) {
            throw new Error(
              `ক্রয় বাতিল ব্যর্থ: পর্যাপ্ত স্টক নেই (বর্তমান স্টক: ${currentStock}, কর্তন প্রয়োজন: ${action.quantity})।`
            );
          }
          await targetDb.inventoryItems.update(item.id, {
            currentStock: Math.round((currentStock - action.quantity) * 100) / 100,
            synced: false
          });
        }
      }

      // 4. Record counter stock movement for purchase if not already reversed by reverseJournalEntry
      if (!journalReversed && targetDb.stockMovements?.toArray) {
        const movements = await targetDb.stockMovements.toArray();
        const toReverse = movements.filter((m: any) =>
          !m.reversedBy &&
          m.movementType !== 'REVERSAL' &&
          ((purchase && (m.referenceId === purchase.invoiceNumber || m.referenceId === purchase.id)) ||
            m.referenceId === action.purchaseId ||
            (m.movementType === 'PURCHASE' && m.itemId === action.itemId && m.quantity === action.quantity))
        );
        for (const sm of toReverse) {
          const counterSm = {
            id: `sm_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            date: new Date().toISOString().split('T')[0],
            itemId: sm.itemId,
            movementType: 'REVERSAL' as const,
            quantity: sm.quantity,
            unitCost: sm.unitCost,
            totalValue: sm.totalValue,
            referenceId: sm.referenceId || action.purchaseId,
            reversalOf: sm.id,
            notes: `ক্রয় বাতিল/রিভার্সাল (Reversal of purchase movement ${sm.id})`,
            direction: 'OUT' as const,
            adjustmentType: 'DECREASE' as const,
            synced: false
          };
          await targetDb.stockMovements.add(counterSm);
          await targetDb.stockMovements.update(sm.id, {
            reversedBy: counterSm.id,
            status: 'REVERSED',
            synced: false
          });
        }
      }

      // 5. Revert party AP/AR if credit
      if (!journalReversed) {
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
