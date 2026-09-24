import Dexie, { type Table } from 'dexie';
import {
  Account,
  JournalEntry,
  Animal,
  AnimalEvent,
  Pond,
  FishBatch,
  Plot,
  CropCycle,
  InternalFlow,
  ProcessingRun,
  InventoryItem,
  StockMovement,
  Party,
  Purchase,
  Sale,
  CashBankAccount,
  BankTransfer,
  Loan,
  Investor,
  FixedAsset,
  AuditLogEntry,
  SystemConfig,
  AppAccessLog,
  Reminder,
  PaymentRecord,
  ClosedPeriod,
  RecurringExpenseTemplate,
  SalesReturn,
  PurchaseReturn,
  AdvancePayment
} from '../types';

export class AgroDatabase extends Dexie {
  systemConfig!: Table<SystemConfig, string>;
  accounts!: Table<Account, string>;
  journalEntries!: Table<JournalEntry, string>;
  closedPeriods!: Table<ClosedPeriod, string>;
  recurringExpenseTemplates!: Table<RecurringExpenseTemplate, string>;
  animals!: Table<Animal, string>;
  animalEvents!: Table<AnimalEvent, string>;
  reminders!: Table<Reminder, string>;
  ponds!: Table<Pond, string>;
  fishBatches!: Table<FishBatch, string>;
  plots!: Table<Plot, string>;
  cropCycles!: Table<CropCycle, string>;
  internalFlows!: Table<InternalFlow, string>;
  processingRuns!: Table<ProcessingRun, string>;
  inventoryItems!: Table<InventoryItem, string>;
  stockMovements!: Table<StockMovement, string>;
  parties!: Table<Party, string>;
  purchases!: Table<Purchase, string>;
  sales!: Table<Sale, string>;
  salesReturns!: Table<SalesReturn, string>;
  purchaseReturns!: Table<PurchaseReturn, string>;
  advancePayments!: Table<AdvancePayment, string>;
  payments!: Table<PaymentRecord, string>;
  cashBankAccounts!: Table<CashBankAccount, string>;
  bankTransfers!: Table<BankTransfer, string>;
  loans!: Table<Loan, string>;
  investors!: Table<Investor, string>;
  fixedAssets!: Table<FixedAsset, string>;
  auditLogs!: Table<AuditLogEntry, string>;
  accessLogs!: Table<AppAccessLog, string>;

  get salesInvoices(): Table<Sale, string> {
    return this.sales;
  }
  get purchaseInvoices(): Table<Purchase, string> {
    return this.purchases;
  }

  constructor() {
    super('AgroErpLocalDb');
    this.version(1).stores({
      systemConfig: 'ownerUid',
      accounts: 'id, code, accountClass, isSystem',
      journalEntries: 'id, voucherNumber, voucherType, date, synced',
      animals: 'id, tag, species, status, synced',
      animalEvents: 'id, animalId, eventType, date, synced',
      reminders: 'id, animalId, category, dueDate, status, synced',
      ponds: 'id, name, status, synced',
      fishBatches: 'id, pondId, species, status, stockingDate, synced',
      plots: 'id, name, currentStatus, synced',
      cropCycles: 'id, plotId, cropName, status, plantingDate, synced',
      internalFlows: 'id, date, resource, synced',
      processingRuns: 'id, recipeName, date, synced',
      inventoryItems: 'id, code, category, synced',
      stockMovements: 'id, date, itemId, movementType, synced',
      parties: 'id, type, name, phone, synced',
      purchases: 'id, invoiceNumber, supplierId, date, synced',
      sales: 'id, invoiceNumber, customerId, date, synced',
      salesReturns: 'id, returnNumber, saleId, customerId, date, synced',
      purchaseReturns: 'id, returnNumber, purchaseId, supplierId, date, synced',
      advancePayments: 'id, partyId, direction, date, synced',
      cashBankAccounts: 'id, accountType, name, synced',
      bankTransfers: 'id, date, type, synced',
      loans: 'id, lenderName, status, synced',
      investors: 'id, name, status, synced',
      fixedAssets: 'id, name, category, synced',
      auditLogs: 'id, timestamp, userId, action, module, synced',
      accessLogs: 'id, email, timestamp, status, synced',
      payments: 'id, parentType, parentId, date, synced',
      closedPeriods: 'id, endDate, closedAt, synced',
      recurringExpenseTemplates: 'id, accountCode, dayOfMonth, active'
    });

    this.version(2).stores({
      fishBatches: 'id, pondId, species, status, stockingDate, synced',
      cropCycles: 'id, plotId, cropName, status, plantingDate, synced'
    });

    this.version(3).stores({
      accessLogs: 'id, email, timestamp, status, synced'
    });

    this.version(4).stores({
      reminders: 'id, animalId, category, dueDate, status, synced'
    });

    this.version(5).stores({
      payments: 'id, parentType, parentId, date, synced'
    });

    this.version(6).stores({
      closedPeriods: 'id, endDate, closedAt, synced'
    });

    this.version(7).stores({
      closedPeriods: 'id, endDate, closedAt, synced'
    });

    this.version(8).stores({
      journalEntries: 'id, voucherNumber, voucherType, date, reversedBy, reversalOf, correctionOf, synced'
    });

    this.version(9).stores({
      recurringExpenseTemplates: 'id, accountCode, dayOfMonth, active'
    });

    this.version(10).stores({
      salesReturns: 'id, returnNumber, saleId, customerId, date, synced',
      purchaseReturns: 'id, returnNumber, purchaseId, supplierId, date, synced'
    });

    this.version(11).stores({
      advancePayments: 'id, partyId, direction, date, synced'
    });

    this.version(12).stores({
      accounts: 'id, code, accountClass, isSystem, synced'
    });
  }
}

export const db = new AgroDatabase();

/**
 * Request browser Notification permission on login and fire a one-time Notification()
 * for any reminder due today, as a best-effort foreground alert.
 * 
 * NOTE ON LIMITATIONS:
 * Browser Notification() works ONLY while the app tab or PWA is open in the foreground.
 * It does NOT operate as a background push notification service when the browser or tab
 * is closed (especially on iOS Chrome where Web Push is restricted/unreliable).
 * Background push is NOT claimed or simulated here; the in-app "Due This Week" list
 * is the authoritative, reliable mechanism on every app visit.
 */
export async function triggerForegroundDueTodayNotification(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission === 'granted') {
      const todayStr = new Date().toISOString().split('T')[0];
      const dueToday = await db.reminders
        .where('status')
        .equals('PENDING')
        .and((r) => r.dueDate === todayStr)
        .toArray();

      if (dueToday.length > 0) {
        const titleList = dueToday.map((r) => r.title).slice(0, 2).join(', ');
        const extra = dueToday.length > 2 ? ` এবং আরও ${dueToday.length - 2}টি` : '';
        new Notification('The Goated Farm - আজকের করণীয়', {
          body: `আজকের জন্য নির্ধারিত কাজ: ${titleList}${extra}`,
          icon: '/icon.svg'
        });
      }
    }
  } catch (err) {
    console.warn('[Reminders] Notification permission or trigger notice:', err);
  }
}

/**
 * Detects whether any real operational farm data exists in the local database.
 * Used to identify brand-new installs or freshly erased states.
 * Excludes system-seeded configuration and chart of accounts.
 */
export async function checkHasAnyFarmData(): Promise<boolean> {
  try {
    const counts = await Promise.all([
      db.animals.count(),
      db.animalEvents.count(),
      db.journalEntries.count(),
      db.fishBatches.count(),
      db.ponds.count(),
      db.cropCycles.count(),
      db.plots.count(),
      db.inventoryItems.count(),
      db.stockMovements.count(),
      db.parties.count(),
      db.purchases.count(),
      db.sales.count(),
      db.salesReturns.count(),
      db.purchaseReturns.count(),
      db.payments.count(),
      db.cashBankAccounts.count(),
      db.bankTransfers.count(),
      db.loans.count(),
      db.investors.count(),
      db.fixedAssets.count(),
      db.reminders.count(),
      db.processingRuns.count(),
      db.internalFlows.count()
    ]);
    return counts.some((cnt) => cnt > 0);
  } catch (err) {
    console.error('Error checking farm data existence:', err);
    return true; // Fail-safe: assume data exists on error
  }
}

