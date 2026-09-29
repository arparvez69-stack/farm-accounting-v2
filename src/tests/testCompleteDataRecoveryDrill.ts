import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  generateTrialBalance,
  generateProfitLoss,
  generateBalanceSheet
} from '../accounting/accountingEngine';
import {
  createFullJsonBackup,
  restoreFromJsonBackup,
  CANONICAL_PERSISTENT_TABLES
} from '../services/exportService';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * PROMPT 06 — FULL BACKUP -> LOSS -> RESTORE
 * FINAL RELEASE TASK 06 — COMPLETE DATA RECOVERY DRILL
 *
 * Runs a complete, end-to-end data recovery drill against an isolated test database.
 * 1. Seeds representative data across all important ERP modules (Sales, Purchases, Inventory,
 *    Customers, Suppliers, Cash, Bank, Investors, Capital, Loans, Production, Expenses,
 *    Income, Fixed Assets, Journal, Ledger, and all persistent tables).
 * 2. Records pre-backup counts, accounting totals, inventory totals, cash/bank totals, Trial Balance.
 * 3. Creates a complete backup.
 * 4. Simulates complete local data loss ONLY for the isolated test database.
 * 5. Restores the backup.
 * 6. Verifies records, IDs, relationships, accounting totals, inventory, journal entries, and Trial Balance.
 * 7. Cleans up isolated test data.
 */
export async function runCompleteDataRecoveryDrillTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, message: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`  ✅ [PASS] ${message}`);
    } else {
      result.failed++;
      result.failures.push(message);
      console.error(`  ❌ [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 06: FULL BACKUP -> DATA LOSS -> RESTORE DRILL');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // 1. Setup Isolated Test Database
  // --------------------------------------------------------------------------
  const isolatedDbName = `AgroRecoveryDrillDb_${Date.now()}`;
  console.log(`\n--- 1. Initializing Isolated Test Database: ${isolatedDbName} ---`);
  const testDb = new AgroDatabase(isolatedDbName);
  await testDb.open();
  await Promise.all(testDb.tables.map((t) => t.clear()));

  // --------------------------------------------------------------------------
  // 2. Seed Representative Data Across All Important ERP Modules
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Seeding Representative Data Across All Important ERP Modules ---');

  // 2.1 System Configuration
  await testDb.systemConfig.put({
    ownerUid: 'usr_drill_owner_01',
    companyName: 'রূপসী বাংলা এগ্রো অ্যান্ড ডেইরি কমপ্লেক্স',
    farmName: 'রূপসী বাংলা এগ্রো অ্যান্ড ডেইরি কমপ্লেক্স',
    phone: '01712345678',
    currency: 'BDT',
    initializedAt: '2026-01-01T00:00:00.000Z',
    synced: true
  } as any);

  // 2.2 Chart of Accounts (COA)
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await testDb.accounts.put(acc);
  }

  // 2.3 Cash and Bank Accounts
  const cashAccId = 'cba_cash_main_drill';
  const bankAccId = 'cba_bank_sonali_drill';
  await testDb.cashBankAccounts.bulkPut([
    {
      id: cashAccId,
      name: 'প্রধান ক্যাশ তহবিল (Main Cash Drawer)',
      accountName: 'প্রধান ক্যাশ তহবিল',
      accountNumber: 'CASH-MAIN-01',
      accountType: 'CASH',
      currentBalance: 75000,
      isActive: true,
      synced: true
    },
    {
      id: bankAccId,
      name: 'সোনালী ব্যাংক বাণিজ্যিক চলতি হিসাব',
      accountName: 'সোনালী ব্যাংক বাণিজ্যিক চলতি হিসাব',
      accountNumber: 'SONALI-CA-9988',
      accountType: 'BANK',
      bankName: 'সোনালী ব্যাংক',
      currentBalance: 250000,
      isActive: true,
      synced: true
    }
  ] as any);

  // 2.4 Bank Transfer
  await testDb.bankTransfers.put({
    id: 'tx_drill_001',
    date: '2026-03-10',
    type: 'CONTRA',
    fromAccountId: bankAccId,
    toAccountId: cashAccId,
    amount: 25000,
    referenceNumber: 'REF-TX-001',
    notes: 'ক্যাশ ড্রয়ারের জন্য ব্যাংক থেকে উত্তোলন',
    synced: true
  } as any);

  // 2.5 Customers & Suppliers (Parties)
  const custPartyId = 'party_cust_drill_01';
  const suppPartyId = 'party_supp_drill_01';
  await testDb.parties.bulkPut([
    {
      id: custPartyId,
      type: 'CUSTOMER',
      name: 'মেসার্স সততা ডিলার্স',
      phone: '01811223344',
      address: 'চকবাজার, ঢাকা',
      balance: 20000, // Due receivable
      synced: true
    },
    {
      id: suppPartyId,
      type: 'SUPPLIER',
      name: 'মেগা ফিড অ্যান্ড ফার্টিলাইজার মিলস',
      phone: '01999887766',
      address: 'কাঁচপুর, নারায়ণগঞ্জ',
      balance: 30000, // Due payable
      synced: true
    }
  ] as any);

  // 2.6 Inventory Items
  const itemFeedId = 'item_feed_tilapia_drill';
  const itemFertId = 'item_fert_urea_drill';
  const itemMedId = 'item_med_vaccine_drill';
  await testDb.inventoryItems.bulkPut([
    {
      id: itemFeedId,
      code: 'FEED-TLP-01',
      name: 'তেলাপিয়া গ্রোয়ার ফিড (২৫ কেজি)',
      nameBn: 'তেলাপিয়া গ্রোয়ার ফিড (২৫ কেজি)',
      category: 'FEED',
      unit: 'BAG',
      quantity: 50,
      unitCost: 1000,
      avgCost: 1000,
      totalCost: 50000,
      currentStock: 50,
      averageCost: 1000,
      sellingPrice: 1250,
      synced: true
    },
    {
      id: itemFertId,
      code: 'FERT-UREA-01',
      name: 'ইউরিয়া সার (৫০ কেজি)',
      nameBn: 'ইউরিয়া সার (৫০ কেজি)',
      category: 'FERTILIZER',
      unit: 'BAG',
      quantity: 30,
      unitCost: 800,
      avgCost: 800,
      totalCost: 24000,
      currentStock: 30,
      averageCost: 800,
      sellingPrice: 950,
      synced: true
    },
    {
      id: itemMedId,
      code: 'MED-VACC-01',
      name: 'পিপিআর ছাগল ভ্যাকসিন',
      nameBn: 'পিপিআর ছাগল ভ্যাকসিন',
      category: 'MEDICINE',
      unit: 'VIAL',
      quantity: 20,
      unitCost: 500,
      avgCost: 500,
      totalCost: 10000,
      currentStock: 20,
      averageCost: 500,
      sellingPrice: 650,
      synced: true
    }
  ] as any);

  // 2.7 Stock Movements
  await testDb.stockMovements.bulkPut([
    {
      id: 'sm_drill_001',
      date: '2026-03-01',
      itemId: itemFeedId,
      movementType: 'IN',
      quantity: 50,
      unitCost: 1000,
      totalCost: 50000,
      referenceType: 'PURCHASE',
      referenceId: 'pur_drill_01',
      notes: 'Initial purchase stock receipt',
      synced: true
    },
    {
      id: 'sm_drill_002',
      date: '2026-03-02',
      itemId: itemFertId,
      movementType: 'IN',
      quantity: 30,
      unitCost: 800,
      totalCost: 24000,
      referenceType: 'PURCHASE',
      referenceId: 'pur_drill_01',
      notes: 'Fertilizer purchase stock receipt',
      synced: true
    }
  ] as any);

  // 2.8 Purchases
  const purchaseId = 'pur_drill_01';
  await testDb.purchases.put({
    id: purchaseId,
    invoiceNumber: 'PUR-DRL-202603-001',
    supplierId: suppPartyId,
    supplierName: 'মেগা ফিড অ্যান্ড ফার্টিলাইজার মিলস',
    date: '2026-03-01',
    totalAmount: 74000,
    grandTotal: 74000,
    paidAmount: 44000,
    dueAmount: 30000,
    paymentStatus: 'PARTIAL',
    paymentMethod: 'BANK',
    bankAccountId: bankAccId,
    accountId: bankAccId,
    items: [
      { itemId: itemFeedId, itemName: 'তেলাপিয়া গ্রোয়ার ফিড', quantity: 50, unitPrice: 1000, total: 50000 },
      { itemId: itemFertId, itemName: 'ইউরিয়া সার', quantity: 30, unitPrice: 800, total: 24000 }
    ],
    notes: 'খামারের প্রয়োজনীয় ফিড ও সার ক্রয়',
    synced: true
  } as any);

  // 2.9 Sales
  const saleId = 'sale_drill_01';
  await testDb.sales.put({
    id: saleId,
    invoiceNumber: 'INV-DRL-202603-001',
    customerId: custPartyId,
    customerName: 'মেসার্স সততা ডিলার্স',
    date: '2026-03-15',
    totalAmount: 80000,
    grandTotal: 80000,
    paidAmount: 60000,
    dueAmount: 20000,
    paymentStatus: 'PARTIAL',
    paymentMethod: 'BANK',
    bankAccountId: bankAccId,
    accountId: bankAccId,
    items: [
      { itemId: itemFeedId, itemName: 'তেলাপিয়া গ্রোয়ার ফিড', quantity: 40, unitPrice: 1250, total: 50000 },
      { itemId: itemFertId, itemName: 'ইউরিয়া সার', quantity: 20, unitPrice: 1500, total: 30000 }
    ],
    notes: 'ডিলারকে ফিড ও সার সরবরাহ',
    synced: true
  } as any);

  // 2.10 Returns & Advance Payments
  await testDb.salesReturns.put({
    id: 'sr_drill_001',
    returnNumber: 'SR-DRL-001',
    saleId,
    customerId: custPartyId,
    date: '2026-03-20',
    totalRefundAmount: 2500,
    items: [{ itemId: itemFeedId, quantity: 2, unitPrice: 1250, total: 2500 }],
    synced: true
  } as any);

  await testDb.purchaseReturns.put({
    id: 'pr_drill_001',
    returnNumber: 'PR-DRL-001',
    purchaseId,
    supplierId: suppPartyId,
    date: '2026-03-21',
    totalRefundAmount: 1600,
    items: [{ itemId: itemFertId, quantity: 2, unitCost: 800, total: 1600 }],
    synced: true
  } as any);

  await testDb.advancePayments.put({
    id: 'adv_drill_001',
    partyId: custPartyId,
    direction: 'CUSTOMER_ADVANCE',
    amount: 15000,
    date: '2026-03-22',
    accountId: bankAccId,
    notes: 'পরবর্তী চালানের অগ্রিম বুকিং মানি',
    synced: true
  } as any);

  // 2.11 Payments
  await testDb.payments.put({
    id: 'pmt_drill_001',
    parentType: 'PURCHASE',
    parentId: purchaseId,
    partyId: suppPartyId,
    amount: 44000,
    date: '2026-03-01',
    method: 'BANK',
    accountId: bankAccId,
    notes: 'সাপ্লায়ার বিল আংশিক পরিশোধ',
    synced: true
  } as any);

  // 2.12 Investors & Capital
  const investorId = 'inv_drill_01';
  await testDb.investors.put({
    id: investorId,
    name: 'আলহাজ্ব রফিকুল ইসলাম (বিনিয়োগকারী)',
    phone: '01700112233',
    totalInvested: 200000,
    totalWithdrawn: 0,
    status: 'ACTIVE',
    startDate: '2026-01-10',
    synced: true
  } as any);

  // 2.13 Loans (Principal-Only)
  const loanId = 'ln_drill_01';
  await testDb.loans.put({
    id: loanId,
    loanNumber: 'LN-DRL-BKB-01',
    lenderName: 'বাংলাদেশ কৃষি ব্যাংক',
    loanType: 'BANK',
    principalAmount: 100000,
    interestRateAnnual: 0,
    annualInterestRatePercent: 0,
    interestRate: 0,
    monthlyInstallment: 10000,
    tenureMonths: 10,
    termMonths: 10,
    term: 'SHORT_TERM',
    remainingPrincipal: 80000,
    remainingBalance: 80000,
    totalPaidPrincipal: 20000,
    totalPaidInterest: 0,
    disbursedDate: '2026-01-01',
    status: 'ACTIVE',
    schedule: [
      { installmentNumber: 1, date: '2026-02-01', principalPortion: 10000, interestPortion: 0, totalPayment: 10000, remainingBalance: 90000, isPaid: true },
      { installmentNumber: 2, date: '2026-03-01', principalPortion: 10000, interestPortion: 0, totalPayment: 10000, remainingBalance: 80000, isPaid: true },
      { installmentNumber: 3, date: '2026-04-01', principalPortion: 10000, interestPortion: 0, totalPayment: 10000, remainingBalance: 70000, isPaid: false }
    ],
    synced: true
  } as any);

  // 2.14 Production: Livestock (Animals & Animal Events)
  const animalId1 = 'anim_goat_drill_01';
  const animalId2 = 'anim_goat_drill_02';
  await testDb.animals.bulkPut([
    {
      id: animalId1,
      tag: 'GT-DRL-001',
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'FEMALE',
      birthDate: '2025-06-01',
      purchaseCost: 9000,
      purchaseDate: '2025-06-01',
      currentWeightKg: 24,
      status: 'ACTIVE',
      location: 'শেড নং ১',
      accumulatedFeedCost: 1500,
      accumulatedMedCost: 300,
      accumulatedLabourCost: 600,
      otherCosts: 0,
      totalCost: 11400,
      synced: true
    },
    {
      id: animalId2,
      tag: 'GT-DRL-002',
      species: 'GOAT',
      breed: 'Jamunapari Cross',
      gender: 'MALE',
      birthDate: '2025-07-01',
      purchaseCost: 12000,
      purchaseDate: '2025-07-01',
      currentWeightKg: 32,
      status: 'ACTIVE',
      location: 'শেড নং ১',
      accumulatedFeedCost: 2000,
      accumulatedMedCost: 400,
      accumulatedLabourCost: 600,
      otherCosts: 0,
      totalCost: 15000,
      synced: true
    }
  ] as any);

  await testDb.animalEvents.put({
    id: 'ae_drill_001',
    animalId: animalId1,
    eventType: 'VACCINATION',
    date: '2026-02-15',
    cost: 300,
    notes: 'পিপিআর টিকা প্রদান',
    synced: true
  } as any);

  // 2.15 Production: Aquaculture (Ponds & Fish Batches)
  const pondId = 'pnd_drill_01';
  await testDb.ponds.put({
    id: pondId,
    name: 'পুকুর নং ১ (উত্তর পাড়)',
    sizeDecimals: 35,
    depthFeet: 6,
    status: 'ACTIVE',
    waterSource: 'Deep Tube-well',
    synced: true
  } as any);

  await testDb.fishBatches.put({
    id: 'fb_drill_01',
    pondId,
    batchName: 'মনোসেক্স তেলাপিয়া ২০২৬/১',
    species: 'Tilapia',
    stockingDate: '2026-01-15',
    fingerlingsCount: 5000,
    initialCost: 15000,
    accumulatedFeedCost: 12000,
    accumulatedMedCost: 1500,
    accumulatedLabourCost: 2000,
    otherCosts: 500,
    totalCost: 31000,
    status: 'ACTIVE',
    synced: true
  } as any);

  // 2.16 Production: Agriculture (Plots & Crop Cycles)
  const plotId = 'plt_drill_01';
  await testDb.plots.put({
    id: plotId,
    name: 'দক্ষিণ মাঠ (প্লট ক)',
    areaAcres: 2.5,
    soilType: 'Loamy',
    currentStatus: 'CULTIVATED',
    synced: true
  } as any);

  await testDb.cropCycles.put({
    id: 'cc_drill_01',
    plotId,
    cycleName: 'ব্রি ধান-২৮ বোরো মৌসুম ২০২৬',
    cropName: 'Boro Rice',
    variety: 'BRRI-28',
    plantingDate: '2026-01-20',
    accumulatedSeedCost: 4000,
    accumulatedFertilizerCost: 8000,
    accumulatedPesticideCost: 2500,
    accumulatedLabourCost: 6000,
    accumulatedIrrigationCost: 3500,
    otherCosts: 1000,
    totalCost: 25000,
    status: 'ACTIVE',
    synced: true
  } as any);

  // 2.17 Processing Runs & Internal Resource Flows
  await testDb.processingRuns.put({
    id: 'prun_drill_01',
    recipeName: 'হোমমেড গ্রোয়ার ফিড মিক্সিং',
    date: '2026-03-05',
    inputCost: 15000,
    laborCost: 1200,
    totalCost: 16200,
    outputQuantityKg: 350,
    status: 'COMPLETED',
    synced: true
  } as any);

  await testDb.internalFlows.put({
    id: 'iflow_drill_01',
    date: '2026-03-06',
    resource: 'ORGANIC_MANURE',
    sourceType: 'LIVESTOCK',
    sourceId: animalId1,
    targetType: 'CROP',
    targetId: plotId,
    quantityKg: 200,
    valuation: 600,
    synced: true
  } as any);

  // 2.18 Fixed Assets
  await testDb.fixedAssets.put({
    id: 'fa_drill_01',
    name: 'মাহিন্দ্রা মিনি পাওয়ার টিলার ও পাম্প',
    category: 'MACHINERY',
    assetAccountCode: '1520',
    depreciationAccountCode: '1590',
    purchaseDate: '2026-01-05',
    purchasePrice: 120000,
    salvageValue: 20000,
    usefulLifeMonths: 60,
    currentBookValue: 116000,
    accumulatedDepreciation: 4000,
    synced: true
  } as any);

  // 2.19 Reminders, Recurring Expenses, Closed Periods
  await testDb.reminders.put({
    id: 'rem_drill_01',
    animalId: animalId1,
    title: 'ছাগলের কৃমিনাশক ডোজ',
    category: 'VACCINATION',
    dueDate: '2026-04-10',
    status: 'PENDING',
    synced: true
  } as any);

  await testDb.recurringExpenseTemplates.put({
    id: 'rec_drill_01',
    name: 'খামারের মাসিক বিদ্যুৎ বিল',
    accountCode: '6030',
    amount: 4500,
    dayOfMonth: 5,
    active: true
  } as any);

  await testDb.closedPeriods.put({
    id: 'cp_drill_2025',
    periodName: 'আর্থিক বছর ২০২৫ সমাপনী',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    closedAt: '2026-01-01T00:00:00.000Z',
    closedBy: 'usr_drill_owner_01',
    isClosed: true,
    synced: true
  } as any);

  // 2.20 Access Logs & Audit Logs
  await testDb.accessLogs.put({
    id: 'acl_drill_01',
    email: 'owner@agroerp.com',
    timestamp: '2026-03-31T08:00:00.000Z',
    status: 'SUCCESS',
    ipAddress: '127.0.0.1',
    synced: true
  } as any);

  await testDb.auditLogs.put({
    id: 'aud_drill_01',
    timestamp: '2026-03-31T08:05:00.000Z',
    userId: 'usr_drill_owner_01',
    role: 'OWNER',
    action: 'DATA_INITIALIZATION',
    module: 'SYSTEM',
    recordId: 'drill_seed',
    status: 'SUCCESS',
    synced: true
  } as any);

  // 2.21 Journal Entries (Fully Balanced Double-Entry Journals)
  await testDb.journalEntries.bulkPut([
    // JV 1: Initial Owner Capital (৳200,000 to Bank)
    {
      id: 'je_drill_001',
      voucherNumber: 'JV-DRL-001',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'মালিক কর্তৃক প্রাথমিক মূলধন বিনিয়োগ',
      lines: [
        { id: 'l1', accountCode: '1030', accountName: 'Sonali Bank', debit: 200000, credit: 0 },
        { id: 'l2', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 200000 }
      ],
      synced: true,
      createdAt: '2026-01-01T10:00:00.000Z'
    },
    // JV 2: Loan Disbursement (৳100,000 to Bank)
    {
      id: 'je_drill_002',
      voucherNumber: 'JV-DRL-002',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'বাংলাদেশ কৃষি ব্যাংক ঋণ অনুমোদন ও জমা',
      lines: [
        { id: 'l3', accountCode: '1030', accountName: 'Sonali Bank', debit: 100000, credit: 0 },
        { id: 'l4', accountCode: '2110', accountName: 'Short-Term Loans', debit: 0, credit: 100000 }
      ],
      synced: true,
      createdAt: '2026-01-01T11:00:00.000Z'
    },
    // JV 3: Purchase of Inventory (৳74,000 -> ৳44k paid by Bank, ৳30k AP)
    {
      id: 'je_drill_003',
      voucherNumber: 'JV-DRL-003',
      voucherType: 'PURCHASE',
      date: '2026-03-01',
      narration: 'ফিড ও সার ক্রয় দাখিলা',
      lines: [
        { id: 'l5', accountCode: '1051', accountName: 'Feed Inventory', debit: 50000, credit: 0 },
        { id: 'l6', accountCode: '1053', accountName: 'Fertilizer Inventory', debit: 24000, credit: 0 },
        { id: 'l7', accountCode: '1030', accountName: 'Sonali Bank', debit: 0, credit: 44000 },
        { id: 'l8', accountCode: '2010', accountName: 'Accounts Payable', debit: 0, credit: 30000 }
      ],
      synced: true,
      createdAt: '2026-03-01T10:00:00.000Z'
    },
    // JV 4: Sale of Goods (৳80,000 -> ৳60k received in Bank, ৳20k AR) + COGS (৳50k)
    {
      id: 'je_drill_004',
      voucherNumber: 'JV-DRL-004',
      voucherType: 'SALES',
      date: '2026-03-15',
      narration: 'মাছ খাদ্য ও সার বিক্রয় চালান',
      lines: [
        { id: 'l9', accountCode: '1030', accountName: 'Sonali Bank', debit: 60000, credit: 0 },
        { id: 'l10', accountCode: '1040', accountName: 'Accounts Receivable', debit: 20000, credit: 0 },
        { id: 'l11', accountCode: '4020', accountName: 'Product Sales Revenue', debit: 0, credit: 80000 },
        { id: 'l12', accountCode: '5020', accountName: 'Cost of Goods Sold', debit: 50000, credit: 0 },
        { id: 'l13', accountCode: '1051', accountName: 'Feed Inventory', debit: 0, credit: 50000 }
      ],
      synced: true,
      createdAt: '2026-03-15T12:00:00.000Z'
    },
    // JV 5: Loan Repayment (2 installments of ৳10k each = ৳20k from Bank)
    {
      id: 'je_drill_005',
      voucherNumber: 'JV-DRL-005',
      voucherType: 'PAYMENT',
      date: '2026-03-01',
      narration: 'ঋণ কিস্তি আসল পরিশোধ',
      lines: [
        { id: 'l14', accountCode: '2110', accountName: 'Short-Term Loans', debit: 20000, credit: 0 },
        { id: 'l15', accountCode: '1030', accountName: 'Sonali Bank', debit: 0, credit: 20000 }
      ],
      synced: true,
      createdAt: '2026-03-01T15:00:00.000Z'
    },
    // JV 6: Contra Cash Transfer (৳25,000 from Bank to Cash)
    {
      id: 'je_drill_006',
      voucherNumber: 'JV-DRL-006',
      voucherType: 'CONTRA',
      date: '2026-03-10',
      narration: 'ব্যাংক হতে নগদ উত্তোলন (কন্ট্রা)',
      lines: [
        { id: 'l16', accountCode: '1010', accountName: 'Cash in Hand', debit: 25000, credit: 0 },
        { id: 'l17', accountCode: '1030', accountName: 'Sonali Bank', debit: 0, credit: 25000 }
      ],
      synced: true,
      createdAt: '2026-03-10T11:00:00.000Z'
    },
    // JV 7: Purchase of Fixed Asset (৳120,000 Machinery paid from Bank)
    {
      id: 'je_drill_007',
      voucherNumber: 'JV-DRL-007',
      voucherType: 'PAYMENT',
      date: '2026-01-05',
      narration: 'পাওয়ার টিলার ক্রয়',
      lines: [
        { id: 'l18', accountCode: '1520', accountName: 'Machinery & Equipment', debit: 120000, credit: 0 },
        { id: 'l19', accountCode: '1030', accountName: 'Sonali Bank', debit: 0, credit: 120000 }
      ],
      synced: true,
      createdAt: '2026-01-05T14:00:00.000Z'
    },
    // JV 8: Operating Expense (৳9,000 farm labor paid from Bank)
    {
      id: 'je_drill_008',
      voucherNumber: 'JV-DRL-008',
      voucherType: 'PAYMENT',
      date: '2026-03-25',
      narration: 'খামারের শ্রম মজুরি ব্যয়',
      lines: [
        { id: 'l20', accountCode: '6020', accountName: 'Labor Costs', debit: 9000, credit: 0 },
        { id: 'l21', accountCode: '1030', accountName: 'Sonali Bank', debit: 0, credit: 9000 }
      ],
      synced: true,
      createdAt: '2026-03-25T16:00:00.000Z'
    }
  ] as any);

  // --------------------------------------------------------------------------
  // 3. Record Baseline State Before Backup
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Recording Baseline State: Record Counts, Accounting & Inventory Totals ---');

  // 3.1 Record Counts for every table
  const baselineRecordCounts: Record<string, number> = {};
  for (const tableName of CANONICAL_PERSISTENT_TABLES) {
    const table = (testDb as any)[tableName];
    if (table && typeof table.count === 'function') {
      baselineRecordCounts[tableName] = await table.count();
    }
  }

  console.log('  Recorded baseline table counts across canonical persistent tables:');
  for (const [tName, count] of Object.entries(baselineRecordCounts)) {
    if (count > 0) {
      console.log(`    - ${tName}: ${count} records`);
    }
  }

  // 3.2 Inventory Totals
  const baselineInventoryItems = await testDb.inventoryItems.toArray();
  const baselineInventoryQty = baselineInventoryItems.reduce((sum, item: any) => sum + (Number(item.currentStock ?? item.quantity) || 0), 0);
  const baselineInventoryValuation = baselineInventoryItems.reduce(
    (sum, item: any) => sum + Math.round((Number(item.currentStock ?? item.quantity) || 0) * (Number(item.avgCostPrice ?? item.avgCost ?? item.unitCost ?? 0)) * 100) / 100,
    0
  );
  console.log(`  Baseline Inventory Totals: Total Qty = ${baselineInventoryQty}, Total Valuation = ৳${baselineInventoryValuation}`);

  // 3.3 Cash & Bank Totals
  const baselineCashBankAccounts = await testDb.cashBankAccounts.toArray();
  const baselineCashBalance = baselineCashBankAccounts
    .filter((a) => a.accountType === 'CASH')
    .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  const baselineBankBalance = baselineCashBankAccounts
    .filter((a) => a.accountType === 'BANK')
    .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  const baselineTotalCashBank = baselineCashBalance + baselineBankBalance;
  console.log(`  Baseline Cash/Bank Totals: Cash = ৳${baselineCashBalance}, Bank = ৳${baselineBankBalance}, Total = ৳${baselineTotalCashBank}`);

  // 3.4 Trial Balance Totals
  const baselineTB = await generateTrialBalance(undefined, testDb);
  assert(baselineTB.isBalanced, `Baseline Trial Balance must balance (Debits: ৳${baselineTB.totalDebit}, Credits: ৳${baselineTB.totalCredit})`);
  assert(baselineTB.difference === 0, 'Baseline Trial Balance has zero discrepancy');
  const baselineTBDebit = baselineTB.totalDebit;
  const baselineTBCredit = baselineTB.totalCredit;
  console.log(`  Baseline Trial Balance: Total Debit = ৳${baselineTBDebit}, Total Credit = ৳${baselineTBCredit}`);

  // 3.5 Balance Sheet Totals
  const baselineBS = await generateBalanceSheet(undefined, testDb);
  assert(baselineBS.isBalanced, `Baseline Balance Sheet must balance (Assets: ৳${baselineBS.totalAssets}, Liab: ৳${baselineBS.totalLiabilities}, Equity: ৳${baselineBS.totalEquity})`);
  const baselineAssets = baselineBS.totalAssets;
  const baselineLiabilities = baselineBS.totalLiabilities;
  const baselineEquity = baselineBS.totalEquity;
  console.log(`  Baseline Balance Sheet: Assets = ৳${baselineAssets}, Liab = ৳${baselineLiabilities}, Equity = ৳${baselineEquity}`);

  // 3.6 Profit & Loss Totals
  const baselinePL = await generateProfitLoss(undefined, undefined, testDb);
  const baselineRevenue = baselinePL.totalRevenue;
  const baselineCogs = baselinePL.totalCogs;
  const baselineOperatingExpenses = baselinePL.totalOperatingExpenses;
  const baselineNetProfit = baselinePL.netProfit;
  console.log(`  Baseline P&L: Revenue = ৳${baselineRevenue}, COGS = ৳${baselineCogs}, Expenses = ৳${baselineOperatingExpenses}, Net Profit = ৳${baselineNetProfit}`);

  // --------------------------------------------------------------------------
  // 4. Create Complete Backup
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Creating Complete Full JSON Backup ---');
  const backupJsonStr = await createFullJsonBackup(testDb);
  assert(typeof backupJsonStr === 'string' && backupJsonStr.length > 500, 'Complete JSON backup created successfully');

  const backupData = JSON.parse(backupJsonStr);
  assert(backupData.version === '1.0.0', 'Backup root version is "1.0.0"');
  assert(typeof backupData.schemaVersion === 'number', 'Backup schemaVersion is valid number');
  assert(typeof backupData.timestamp === 'string' && !isNaN(Date.parse(backupData.timestamp)), 'Backup timestamp is valid ISO string');
  assert(Array.isArray(backupData.expectedTables) && backupData.expectedTables.length >= 30, 'Backup contains all expected persistent tables');
  assert(typeof backupData.recordCounts === 'object' && backupData.recordCounts !== null, 'Backup contains verified recordCounts');

  // Verify that all canonical persistent tables are included in backup JSON
  for (const tName of CANONICAL_PERSISTENT_TABLES) {
    assert(tName in backupData, `Table "${tName}" is included in backup payload`);
    assert(backupData.recordCounts[tName] === baselineRecordCounts[tName], `Record count in backup manifest matches baseline for "${tName}" (${baselineRecordCounts[tName]})`);
  }

  // --------------------------------------------------------------------------
  // 5. Simulate Complete Local Data Loss
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Simulating Complete Local Data Loss for Isolated Test Dataset ---');
  await Promise.all(testDb.tables.map((table) => table.clear()));

  // Verify complete erasure
  for (const t of testDb.tables) {
    const count = await t.count();
    assert(count === 0, `Table "${t.name}" is completely wiped (0 records)`);
  }
  console.log('  Confirmed: Complete local data loss successfully simulated. All tables are empty.');

  // --------------------------------------------------------------------------
  // 6. Restore the Backup
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Restoring Isolated Test Database from Backup ---');
  const restoreRes = await restoreFromJsonBackup(backupJsonStr, 'usr_drill_owner_01', testDb);
  assert(restoreRes.success === true, `Restore completed with success: true (${restoreRes.message})`);

  // --------------------------------------------------------------------------
  // 7. Compare Restored Dataset with Original
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Comprehensive Verification of Restored Dataset ---');

  // 7.1 Verify Table Record Counts
  console.log('\n  -> 7.1 Verifying Record Counts Intact Across All Tables');
  for (const tableName of CANONICAL_PERSISTENT_TABLES) {
    const table = (testDb as any)[tableName];
    if (table && typeof table.count === 'function') {
      const restoredCount = await table.count();
      // auditLogs has 1 additional entry appended for the SYSTEM_RESTORE event
      if (tableName === 'auditLogs') {
        assert(
          restoredCount === baselineRecordCounts[tableName] + 1,
          `auditLogs count is original (${baselineRecordCounts[tableName]}) + 1 SYSTEM_RESTORE audit log = ${restoredCount}`
        );
      } else {
        assert(
          restoredCount === baselineRecordCounts[tableName],
          `Restored table "${tableName}" record count (${restoredCount}) matches original (${baselineRecordCounts[tableName]})`
        );
      }
    }
  }

  // 7.2 Verify Records & Primary IDs Intact
  console.log('\n  -> 7.2 Verifying Primary IDs & Record Fields Intact');
  const restoredConfig = await testDb.systemConfig.get('usr_drill_owner_01');
  assert(!!restoredConfig && restoredConfig.ownerUid === 'usr_drill_owner_01', 'systemConfig record and ownerUid preserved');
  assert(restoredConfig?.companyName === 'রূপসী বাংলা এগ্রো অ্যান্ড ডেইরি কমপ্লেক্স', 'Company name preserved exactly');

  const restoredCashAcc = await testDb.cashBankAccounts.get(cashAccId);
  const restoredBankAcc = await testDb.cashBankAccounts.get(bankAccId);
  assert(!!restoredCashAcc && restoredCashAcc.id === cashAccId && restoredCashAcc.currentBalance === 75000, 'Cash account ID & balance preserved');
  assert(!!restoredBankAcc && restoredBankAcc.id === bankAccId && restoredBankAcc.currentBalance === 250000, 'Bank account ID & balance preserved');

  const restoredCustomer = await testDb.parties.get(custPartyId);
  const restoredSupplier = await testDb.parties.get(suppPartyId);
  assert(!!restoredCustomer && restoredCustomer.id === custPartyId && restoredCustomer.name === 'মেসার্স সততা ডিলার্স', 'Customer record & ID preserved');
  assert(!!restoredSupplier && restoredSupplier.id === suppPartyId && restoredSupplier.name === 'মেগা ফিড অ্যান্ড ফার্টিলাইজার মিলস', 'Supplier record & ID preserved');

  const restoredPurchase = await testDb.purchases.get(purchaseId);
  const restoredSale = await testDb.sales.get(saleId);
  assert(!!restoredPurchase && restoredPurchase.id === purchaseId && restoredPurchase.totalAmount === 74000, 'Purchase record & ID preserved');
  assert(!!restoredSale && restoredSale.id === saleId && restoredSale.totalAmount === 80000, 'Sale record & ID preserved');

  const restoredLoan = await testDb.loans.get(loanId);
  assert(!!restoredLoan && restoredLoan.id === loanId && restoredLoan.principalAmount === 100000, 'Loan record & ID preserved');
  assert(restoredLoan!.remainingPrincipal === 80000 && restoredLoan!.status === 'ACTIVE', 'Loan remaining principal & status preserved');
  assert(restoredLoan!.schedule?.length === 3, 'Loan amortization schedule preserved');

  const restoredAnimal1 = await testDb.animals.get(animalId1);
  const restoredAnimal2 = await testDb.animals.get(animalId2);
  assert(!!restoredAnimal1 && restoredAnimal1.id === animalId1 && restoredAnimal1.tag === 'GT-DRL-001', 'Animal 1 ID & tag preserved');
  assert(!!restoredAnimal2 && restoredAnimal2.id === animalId2 && restoredAnimal2.tag === 'GT-DRL-002', 'Animal 2 ID & tag preserved');

  const restoredPond = await testDb.ponds.get(pondId);
  const restoredBatch = await testDb.fishBatches.get('fb_drill_01');
  assert(!!restoredPond && restoredPond.id === pondId, 'Pond ID preserved');
  assert(!!restoredBatch && restoredBatch.id === 'fb_drill_01', 'Fish batch ID preserved');

  const restoredPlot = await testDb.plots.get(plotId);
  const restoredCycle = await testDb.cropCycles.get('cc_drill_01');
  assert(!!restoredPlot && restoredPlot.id === plotId, 'Plot ID preserved');
  assert(!!restoredCycle && restoredCycle.id === 'cc_drill_01', 'Crop cycle ID preserved');

  const restoredAsset = await testDb.fixedAssets.get('fa_drill_01');
  assert(!!restoredAsset && restoredAsset.id === 'fa_drill_01' && ((restoredAsset as any).originalCost === 120000 || (restoredAsset as any).purchasePrice === 120000), 'Fixed asset ID and purchasePrice preserved');

  const restoredInvestor = await testDb.investors.get(investorId);
  assert(!!restoredInvestor && restoredInvestor.id === investorId && ((restoredInvestor as any).totalInvested === 200000 || restoredInvestor.capitalContributed === 200000), 'Investor record preserved');

  // 7.3 Verify Relational Integrity (Foreign Keys)
  console.log('\n  -> 7.3 Verifying Relational Integrity Across Entities');
  assert(restoredSale?.customerId === restoredCustomer?.id, 'Sale customerId references restored Customer ID');
  assert(((restoredSale as any)?.bankAccountId || (restoredSale as any)?.accountId) === restoredBankAcc?.id, 'Sale accountId references restored Bank Account ID');
  assert(restoredPurchase?.supplierId === restoredSupplier?.id, 'Purchase supplierId references restored Supplier ID');
  assert(((restoredPurchase as any)?.bankAccountId || (restoredPurchase as any)?.accountId) === restoredBankAcc?.id, 'Purchase accountId references restored Bank Account ID');

  const restoredEvent = await testDb.animalEvents.get('ae_drill_001');
  assert(restoredEvent?.animalId === restoredAnimal1?.id, 'AnimalEvent animalId references restored Animal ID');

  assert(restoredBatch?.pondId === restoredPond?.id, 'FishBatch pondId references restored Pond ID');
  assert(restoredCycle?.plotId === restoredPlot?.id, 'CropCycle plotId references restored Plot ID');

  const restoredStockMovements = await testDb.stockMovements.toArray();
  for (const sm of restoredStockMovements) {
    const item = await testDb.inventoryItems.get(sm.itemId);
    assert(!!item, `Stock movement ${sm.id} successfully resolves foreign key itemId (${sm.itemId})`);
  }

  // 7.4 Verify Inventory Totals
  console.log('\n  -> 7.4 Verifying Inventory Totals');
  const restoredInventoryItems = await testDb.inventoryItems.toArray();
  const restoredInventoryQty = restoredInventoryItems.reduce((sum, item: any) => sum + (Number(item.currentStock ?? item.quantity) || 0), 0);
  const restoredInventoryValuation = restoredInventoryItems.reduce(
    (sum, item: any) => sum + Math.round((Number(item.currentStock ?? item.quantity) || 0) * (Number(item.avgCostPrice ?? item.avgCost ?? item.unitCost ?? 0)) * 100) / 100,
    0
  );

  assert(restoredInventoryQty === baselineInventoryQty, `Restored total inventory quantity (${restoredInventoryQty}) equals original (${baselineInventoryQty})`);
  assert(restoredInventoryValuation === baselineInventoryValuation, `Restored inventory valuation (৳${restoredInventoryValuation}) equals original (৳${baselineInventoryValuation})`);

  // 7.5 Verify Cash & Bank Totals
  console.log('\n  -> 7.5 Verifying Cash/Bank Balances');
  const restoredCashBankList = await testDb.cashBankAccounts.toArray();
  const restoredCashBal = restoredCashBankList.filter((a) => a.accountType === 'CASH').reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  const restoredBankBal = restoredCashBankList.filter((a) => a.accountType === 'BANK').reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);

  assert(restoredCashBal === baselineCashBalance, `Restored cash balance (৳${restoredCashBal}) equals original (৳${baselineCashBalance})`);
  assert(restoredBankBal === baselineBankBalance, `Restored bank balance (৳${restoredBankBal}) equals original (৳${baselineBankBalance})`);
  assert(restoredCashBal + restoredBankBal === baselineTotalCashBank, `Restored total cash/bank (৳${restoredCashBal + restoredBankBal}) equals original (৳${baselineTotalCashBank})`);

  // 7.6 Verify Journal Entries Intact & Balanced
  console.log('\n  -> 7.6 Verifying Journal Entries Intact & Debit = Credit');
  const restoredJournals = await testDb.journalEntries.toArray();
  assert(restoredJournals.length === 8, `All 8 original journal vouchers present in restored database`);
  for (const j of restoredJournals) {
    assert(Array.isArray(j.lines) && j.lines.length > 0, `Journal ${j.voucherNumber} has non-empty lines`);
    let jDr = 0;
    let jCr = 0;
    for (const l of j.lines) {
      jDr += Number(l.debit || 0);
      jCr += Number(l.credit || 0);
      assert(!!l.accountCode && l.accountCode.trim().length > 0, `Line in ${j.voucherNumber} has valid accountCode`);
    }
    jDr = Math.round(jDr * 100) / 100;
    jCr = Math.round(jCr * 100) / 100;
    assert(jDr === jCr, `Journal ${j.voucherNumber} is balanced: Debit (৳${jDr}) === Credit (৳${jCr})`);
  }

  // 7.7 Verify Trial Balance Totals & Balances
  console.log('\n  -> 7.7 Verifying Trial Balance Balances');
  const restoredTB = await generateTrialBalance(undefined, testDb);
  assert(restoredTB.isBalanced, `Restored Trial Balance balances (Difference: ${restoredTB.difference})`);
  assert(restoredTB.difference === 0, 'Restored Trial Balance difference is 0');
  assert(restoredTB.totalDebit === baselineTBDebit, `Restored TB totalDebit (৳${restoredTB.totalDebit}) equals original (৳${baselineTBDebit})`);
  assert(restoredTB.totalCredit === baselineTBCredit, `Restored TB totalCredit (৳${restoredTB.totalCredit}) equals original (৳${baselineTBCredit})`);

  // 7.8 Verify Balance Sheet & P&L Accounting Totals
  console.log('\n  -> 7.8 Verifying Balance Sheet & Profit & Loss Totals');
  const restoredBS = await generateBalanceSheet(undefined, testDb);
  assert(restoredBS.isBalanced, `Restored Balance Sheet balances (Assets: ৳${restoredBS.totalAssets})`);
  assert(restoredBS.totalAssets === baselineAssets, `Restored Total Assets (৳${restoredBS.totalAssets}) equals original (৳${baselineAssets})`);
  assert(restoredBS.totalLiabilities === baselineLiabilities, `Restored Total Liabilities (৳${restoredBS.totalLiabilities}) equals original (৳${baselineLiabilities})`);
  assert(restoredBS.totalEquity === baselineEquity, `Restored Total Equity (৳${restoredBS.totalEquity}) equals original (৳${baselineEquity})`);

  const restoredPL = await generateProfitLoss(undefined, undefined, testDb);
  assert(restoredPL.totalRevenue === baselineRevenue, `Restored Total Revenue (৳${restoredPL.totalRevenue}) equals original (৳${baselineRevenue})`);
  assert(restoredPL.totalCogs === baselineCogs, `Restored Total COGS (৳${restoredPL.totalCogs}) equals original (৳${baselineCogs})`);
  assert(restoredPL.totalOperatingExpenses === baselineOperatingExpenses, `Restored Operating Expenses (৳${restoredPL.totalOperatingExpenses}) equals original (৳${baselineOperatingExpenses})`);
  assert(restoredPL.netProfit === baselineNetProfit, `Restored Net Profit (৳${restoredPL.netProfit}) equals original (৳${baselineNetProfit})`);

  // --------------------------------------------------------------------------
  // 8. Clean Up Isolated Test Database
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Cleaning Up Isolated Test Database ---');
  await testDb.delete();
  console.log(`  Isolated test database "${isolatedDbName}" deleted completely. Zero persistent artifacts remain.`);

  console.log('\n================================================================');
  console.log(`ALL FULL BACKUP -> DATA LOSS -> RESTORE DRILL CHECKS PASSED! (${result.passed}/${result.total}) 🎉`);
  console.log('================================================================');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testCompleteDataRecoveryDrill')) {
  runCompleteDataRecoveryDrillTests()
    .then((r) => process.exit(r.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Data recovery drill failed:', err);
      process.exit(1);
    });
}
