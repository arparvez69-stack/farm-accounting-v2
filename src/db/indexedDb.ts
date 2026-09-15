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
  ViewerAccount
} from '../types';

export class AgroDatabase extends Dexie {
  systemConfig!: Table<SystemConfig, string>;
  viewers!: Table<ViewerAccount, string>;
  accounts!: Table<Account, string>;
  journalEntries!: Table<JournalEntry, string>;
  animals!: Table<Animal, string>;
  animalEvents!: Table<AnimalEvent, string>;
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
  cashBankAccounts!: Table<CashBankAccount, string>;
  bankTransfers!: Table<BankTransfer, string>;
  loans!: Table<Loan, string>;
  investors!: Table<Investor, string>;
  fixedAssets!: Table<FixedAsset, string>;
  auditLogs!: Table<AuditLogEntry, string>;

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
      viewers: 'uid, status',
      accounts: 'id, code, accountClass, isSystem',
      journalEntries: 'id, voucherNumber, voucherType, date, synced',
      animals: 'id, tag, species, status, synced',
      animalEvents: 'id, animalId, eventType, date, synced',
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
      cashBankAccounts: 'id, accountType, name, synced',
      bankTransfers: 'id, date, type, synced',
      loans: 'id, lenderName, status, synced',
      investors: 'id, name, status, synced',
      fixedAssets: 'id, name, category, synced',
      auditLogs: 'id, timestamp, userId, action, module, synced'
    });

    this.version(2).stores({
      fishBatches: 'id, pondId, species, status, stockingDate, synced',
      cropCycles: 'id, plotId, cropName, status, plantingDate, synced'
    });
  }
}

export const db = new AgroDatabase();
