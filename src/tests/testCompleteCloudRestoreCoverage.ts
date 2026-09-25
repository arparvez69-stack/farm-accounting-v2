import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { restoreRemoteDataIfLocalEmpty } from '../firebase/firebaseClient';
import { app, createSessionToken, inMemoryStores } from '../../server';
import http from 'http';

interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runCompleteCloudRestoreCoverageTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, description: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`✅ PASS: ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`❌ FAIL: ${description}`);
    }
  }

  console.log('\n========================================================');
  console.log('F3 TEST SUITE: COMPLETE CLOUD RESTORE COVERAGE');
  console.log('Auditing All 30 Persistent Dexie Tables & Relationships');
  console.log('========================================================\n');

  // Setup localStorage polyfill if needed in Node
  if (typeof globalThis.localStorage === 'undefined') {
    const memStore = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => memStore.get(key) || null,
      setItem: (key: string, val: string) => { memStore.set(key, String(val)); },
      removeItem: (key: string) => { memStore.delete(key); },
      clear: () => { memStore.clear(); },
      key: (idx: number) => Array.from(memStore.keys())[idx] || null,
      length: 0
    };
  }

  // Ensure server is running
  let serverInstance: http.Server | null = null;
  let testPort = 3000;
  try {
    const healthCheck = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(1000) });
    if (!healthCheck.ok) throw new Error('Health check non-200');
  } catch {
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        testPort = addr.port;
        process.env.PORT = String(testPort);
        resolve();
      });
    });
  }

  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const validSessionToken = createSessionToken(testOwnerEmail);
  localStorage.setItem('goted_owner_session', JSON.stringify({ sessionToken: validSessionToken }));

  const baseUrl = `http://127.0.0.1:${testPort}`;
  const runTag = `f3_${Date.now()}`;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Audit all 30 persistent tables in Dexie
    // -------------------------------------------------------------------------
    console.log('--- AUDIT 1: Persistent Tables Registry Verification ---');
    const persistentTableNames = db.tables.map(t => t.name).sort();
    assert(persistentTableNames.length === 30, `Dexie database schema contains exactly 30 persistent tables (actual: ${persistentTableNames.length})`);

    const expectedAll30 = [
      'accessLogs',
      'accounts',
      'advancePayments',
      'animalEvents',
      'animals',
      'auditLogs',
      'bankTransfers',
      'cashBankAccounts',
      'closedPeriods',
      'cropCycles',
      'fishBatches',
      'fixedAssets',
      'internalFlows',
      'inventoryItems',
      'investors',
      'journalEntries',
      'loans',
      'parties',
      'payments',
      'plots',
      'ponds',
      'processingRuns',
      'purchaseReturns',
      'purchases',
      'recurringExpenseTemplates',
      'reminders',
      'sales',
      'salesReturns',
      'stockMovements',
      'systemConfig'
    ].sort();

    assert(
      JSON.stringify(persistentTableNames) === JSON.stringify(expectedAll30),
      'All 30 persistent tables match the complete farm ERP schema specification'
    );

    // -------------------------------------------------------------------------
    // STEP 2: Create records in all 30 tables with relational integrity
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 2: Generating & Seeding Linked Multi-Table Records ---');

    // Relational keys
    const customerId = `party_cust_${runTag}`;
    const supplierId = `party_supp_${runTag}`;
    const saleId = `sale_${runTag}`;
    const purchaseId = `purch_${runTag}`;
    const journalId = `jnl_${runTag}`;
    const animalId = `anim_${runTag}`;
    const pondId = `pond_${runTag}`;
    const plotId = `plot_${runTag}`;
    const itemId = `inv_${runTag}`;
    const cashAccId = `cash_${runTag}`;
    const loanId = `loan_${runTag}`;
    const investorId = `invst_${runTag}`;

    const testRecords: Record<string, any> = {
      systemConfig: {
        ownerUid: `owner_${runTag}`,
        companyName: 'The Goated Integrated Organic Agro Farm',
        currency: 'BDT',
        initializedAt: '2026-09-24T00:00:00.000Z'
      },
      accounts: {
        id: `acc_custom_${runTag}`,
        code: `58${String(Math.floor(10 + Math.random() * 89))}`,
        nameEn: 'Special Organic Certification Expense',
        nameBn: 'বিশেষ অর্গানিক সার্টিফিকেশন খরচ',
        accountClass: 'EXPENSE',
        isSystem: false
      },
      parties: {
        id: customerId,
        type: 'CUSTOMER',
        name: 'Dhaka Agro Superstore',
        phone: '01711998877',
        synced: true
      },
      animals: {
        id: animalId,
        tag: `TAG-${runTag.slice(-4)}`,
        species: 'GOAT',
        breed: 'Black Bengal Dairy Special',
        status: 'ACTIVE',
        purchasePrice: 12000,
        synced: true
      },
      animalEvents: {
        id: `event_${runTag}`,
        animalId: animalId,
        eventType: 'VACCINATION',
        date: '2026-09-24',
        cost: 300,
        synced: true
      },
      reminders: {
        id: `rem_${runTag}`,
        animalId: animalId,
        title: 'Quarterly Deworming Booster',
        category: 'DEWORMING',
        dueDate: '2026-10-15',
        status: 'PENDING',
        synced: true
      },
      ponds: {
        id: pondId,
        name: `Tilapia Nursery Pond ${runTag.slice(-4)}`,
        areaDecimals: 25,
        waterDepthFt: 5,
        status: 'ACTIVE',
        synced: true
      },
      fishBatches: {
        id: `fish_${runTag}`,
        pondId: pondId,
        species: 'GIFT Tilapia Monosex',
        stockingDate: '2026-09-24',
        initialCount: 5000,
        currentCount: 4950,
        status: 'ACTIVE',
        synced: true
      },
      plots: {
        id: plotId,
        name: `Napier Grass Sector ${runTag.slice(-4)}`,
        sizeInDecimals: 40,
        soilType: 'Loam',
        currentStatus: 'CULTIVATED',
        synced: true
      },
      cropCycles: {
        id: `crop_${runTag}`,
        plotId: plotId,
        cropName: 'Super Napier Hybrid',
        plantingDate: '2026-09-24',
        expectedHarvestDate: '2026-11-20',
        status: 'ACTIVE',
        synced: true
      },
      stockMovements: {
        id: `sm_${runTag}`,
        date: '2026-09-24',
        itemId: itemId,
        movementType: 'OPENING',
        quantity: 100,
        unitCost: 1250,
        totalCost: 125000,
        synced: true
      },
      inventoryItems: {
        id: itemId,
        code: `ITEM-${runTag.slice(-4)}`,
        nameEn: 'High Protein Goat Pellets 25kg',
        nameBn: 'উচ্চ প্রোটিন ছাগলের ফিড ২৫কেজি',
        category: 'FEED',
        unit: 'BAG',
        currentStock: 100,
        avgCostPrice: 1250,
        sellingPrice: 1450,
        synced: true
      },
      cashBankAccounts: {
        id: cashAccId,
        name: `Farm Operational Cash ${runTag.slice(-4)}`,
        accountType: 'CASH',
        currency: 'BDT',
        openingBalance: 500000,
        currentBalance: 500000,
        synced: true
      },
      bankTransfers: {
        id: `bt_${runTag}`,
        fromAccountId: cashAccId,
        toAccountId: 'cash_bank_reserve',
        amount: 25000,
        date: '2026-09-24',
        type: 'INTERNAL_CONTRA',
        synced: true
      },
      journalEntries: {
        id: journalId,
        voucherNumber: `JV-${runTag.slice(-6)}`,
        voucherType: 'STANDARD',
        date: '2026-09-24',
        narration: 'Composite operational entry for restore audit',
        lines: [
          { accountCode: '1010', debit: 5000, credit: 0 },
          { accountCode: '4010', debit: 0, credit: 5000 }
        ],
        synced: true
      },
      sales: {
        id: saleId,
        invoiceNumber: `INV-S-${runTag.slice(-6)}`,
        customerId: customerId,
        date: '2026-09-24',
        totalAmount: 15000,
        paidAmount: 10000,
        dueAmount: 5000,
        journalEntryId: journalId,
        synced: true
      },
      purchases: {
        id: purchaseId,
        invoiceNumber: `INV-P-${runTag.slice(-6)}`,
        supplierId: supplierId,
        date: '2026-09-24',
        totalAmount: 30000,
        paidAmount: 20000,
        dueAmount: 10000,
        journalEntryId: journalId,
        synced: true
      },
      salesReturns: {
        id: `sr_${runTag}`,
        returnNumber: `SR-${runTag.slice(-6)}`,
        saleId: saleId,
        customerId: customerId,
        date: '2026-09-24',
        items: [
          {
            itemId: itemId,
            itemName: 'High Protein Goat Pellets 25kg',
            returnedQuantity: 2,
            unitPrice: 1450,
            lineTotal: 2900,
            cogsAmount: 2500,
            reason: 'Excess order delivered'
          }
        ],
        totalRefundAmount: 2900,
        totalCogsReversed: 2500,
        refundMethod: 'ADJUST_DUE',
        journalEntryId: journalId,
        synced: true
      },
      purchaseReturns: {
        id: `pr_${runTag}`,
        returnNumber: `PR-${runTag.slice(-6)}`,
        purchaseId: purchaseId,
        supplierId: supplierId,
        date: '2026-09-24',
        items: [
          {
            itemId: itemId,
            itemName: 'High Protein Goat Pellets 25kg',
            returnedQuantity: 4,
            unitPrice: 1250,
            lineTotal: 5000,
            reason: 'Moisture damaged bag'
          }
        ],
        totalRefundAmount: 5000,
        refundMethod: 'ADJUST_DUE',
        journalEntryId: journalId,
        synced: true
      },
      advancePayments: {
        id: `adv_${runTag}`,
        advanceNumber: `ADV-${runTag.slice(-6)}`,
        partyId: customerId,
        partyType: 'CUSTOMER',
        direction: 'RECEIVED',
        amount: 8000,
        remainingAmount: 8000,
        date: '2026-09-24',
        paymentMethod: 'CASH',
        cashBankAccountId: cashAccId,
        journalEntryId: journalId,
        synced: true
      },
      payments: {
        id: `pay_${runTag}`,
        parentType: 'PURCHASE',
        parentId: purchaseId,
        amount: 5000,
        date: '2026-09-24',
        paymentMethod: 'CASH',
        bankAccountId: cashAccId,
        journalEntryId: journalId,
        synced: true
      },
      loans: {
        id: loanId,
        lenderName: 'Bangladesh Krishi Bank',
        principalAmount: 200000,
        remainingBalance: 200000,
        interestRatePercent: 8,
        status: 'ACTIVE',
        synced: true
      },
      investors: {
        id: investorId,
        name: 'Haji Shamsul Huda',
        phone: '01819223344',
        initialCapital: 350000,
        currentCapitalBalance: 350000,
        profitPayable: 0,
        status: 'ACTIVE',
        synced: true
      },
      fixedAssets: {
        id: `asset_${runTag}`,
        name: 'High-Capacity Automatic Chaff Cutter 5HP',
        category: 'MACHINERY',
        acquisitionCost: 65000,
        purchaseDate: '2026-09-24',
        accumulatedDepreciation: 0,
        synced: true
      },
      internalFlows: {
        id: `flow_${runTag}`,
        date: '2026-09-24',
        resource: 'GOAT_MANURE',
        quantity: 500,
        unit: 'KG',
        sourceEnterprise: 'DAIRY_GOAT',
        destinationEnterprise: 'CROP_NAPIER',
        estimatedValue: 1500,
        synced: true
      },
      processingRuns: {
        id: `run_${runTag}`,
        date: '2026-09-24',
        recipeName: 'Silage Fermentation Batch #12',
        inputCost: 18000,
        outputYieldQuantity: 2500,
        outputYieldUnit: 'KG',
        synced: true
      },
      recurringExpenseTemplates: {
        id: `recur_${runTag}`,
        accountCode: '5010',
        amount: 15000,
        dayOfMonth: 5,
        narration: 'Monthly farm supervisor salary',
        active: true,
        synced: true
      },
      closedPeriods: {
        id: `cp_${runTag}`,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        closedAt: '2026-01-05T00:00:00.000Z',
        closedBy: testOwnerEmail,
        synced: true
      },
      auditLogs: {
        id: `audit_${runTag}`,
        timestamp: '2026-09-24T02:00:00.000Z',
        userId: testOwnerEmail,
        action: 'BACKUP_SYNC_AUDIT',
        module: 'ACCOUNTING',
        synced: true
      },
      accessLogs: {
        id: `access_${runTag}`,
        email: testOwnerEmail,
        timestamp: '2026-09-24T02:00:00.000Z',
        loginMethod: 'SECRET_PIN',
        status: 'SUCCESS',
        synced: true
      }
    };

    // -------------------------------------------------------------------------
    // STEP 3: Persist all 30 records to Server / Cloud Storage
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 3: Synchronizing All 30 Persistent Tables to Cloud Server ---');

    for (const [tableName, record] of Object.entries(testRecords)) {
      const postRes = await fetch(`${baseUrl}/api/sync/${tableName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validSessionToken}`
        },
        body: JSON.stringify(record)
      });
      const postData = await postRes.json();
      assert(postRes.status === 200 && postData.success === true, `Cloud server accepted and persisted record for "${tableName}"`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Verify Server GET /api/sync/restore contains all 30 collections
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 4: Validating Server /api/sync/restore Payload ---');

    const restoreRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: {
        Authorization: `Bearer ${validSessionToken}`
      }
    });
    assert(restoreRes.status === 200, '/api/sync/restore responded with HTTP 200');

    const restorePayload = await restoreRes.json();
    assert(restorePayload.success === true, 'Restore response indicates success: true');
    assert(typeof restorePayload.collections === 'object', 'Restore response contains collections object');

    // Verify all 3 required tables specifically
    assert(Array.isArray(restorePayload.collections?.salesReturns), 'Server restore collections includes "salesReturns" array');
    assert(Array.isArray(restorePayload.collections?.purchaseReturns), 'Server restore collections includes "purchaseReturns" array');
    assert(Array.isArray(restorePayload.collections?.advancePayments), 'Server restore collections includes "advancePayments" array');

    // Verify every single persistent Dexie table is present in server restore payload
    for (const tableName of persistentTableNames) {
      assert(
        Array.isArray(restorePayload.collections?.[tableName]),
        `Server restore payload includes persistent collection "${tableName}"`
      );
    }

    // -------------------------------------------------------------------------
    // STEP 5: Simulate Completely Empty Local Database
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 5: Simulating Empty Local Database ---');

    await Promise.all(db.tables.map(t => t.clear()));

    for (const table of db.tables) {
      const count = await table.count();
      assert(count === 0, `Table "${table.name}" cleared completely (count: 0)`);
    }

    // -------------------------------------------------------------------------
    // STEP 6: Execute Cloud Restore into Empty Database
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 6: Restoring Data from Cloud into Empty Local Database ---');

    const restoreOutcome = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, true);
    assert(restoreOutcome.restored === true, 'restoreRemoteDataIfLocalEmpty executed with restored: true');
    assert(restoreOutcome.count >= 30, `restoreRemoteDataIfLocalEmpty restored all records (restored: ${restoreOutcome.count})`);

    // -------------------------------------------------------------------------
    // STEP 7: Verify Required Tables: salesReturns, purchaseReturns, advancePayments
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 7: Detailed Verification for Returns & Advance Payments ---');

    // 1. salesReturns
    const restoredSR = await db.salesReturns.get(testRecords.salesReturns.id);
    assert(restoredSR !== undefined, 'salesReturns record restored with original ID');
    assert(restoredSR?.returnNumber === testRecords.salesReturns.returnNumber, 'Restored salesReturns returnNumber matches');
    assert(restoredSR?.saleId === saleId, 'Restored salesReturns saleId foreign key preserved');
    assert(restoredSR?.customerId === customerId, 'Restored salesReturns customerId foreign key preserved');
    assert(restoredSR?.totalRefundAmount === 2900, 'Restored salesReturns totalRefundAmount matches');
    assert(restoredSR?.totalCogsReversed === 2500, 'Restored salesReturns totalCogsReversed matches');
    assert(Array.isArray(restoredSR?.items) && restoredSR.items.length === 1, 'Restored salesReturns items array preserved');
    assert(restoredSR?.items[0].itemId === itemId, 'Restored salesReturns item reference itemId preserved');
    assert(restoredSR?.journalEntryId === journalId, 'Restored salesReturns journalEntryId foreign key preserved');
    assert(restoredSR?.synced === true, 'Restored salesReturns marked synced=true');

    // 2. purchaseReturns
    const restoredPR = await db.purchaseReturns.get(testRecords.purchaseReturns.id);
    assert(restoredPR !== undefined, 'purchaseReturns record restored with original ID');
    assert(restoredPR?.returnNumber === testRecords.purchaseReturns.returnNumber, 'Restored purchaseReturns returnNumber matches');
    assert(restoredPR?.purchaseId === purchaseId, 'Restored purchaseReturns purchaseId foreign key preserved');
    assert(restoredPR?.supplierId === supplierId, 'Restored purchaseReturns supplierId foreign key preserved');
    assert(restoredPR?.totalRefundAmount === 5000, 'Restored purchaseReturns totalRefundAmount matches');
    assert(Array.isArray(restoredPR?.items) && restoredPR.items.length === 1, 'Restored purchaseReturns items array preserved');
    assert(restoredPR?.items[0].itemId === itemId, 'Restored purchaseReturns item reference itemId preserved');
    assert(restoredPR?.journalEntryId === journalId, 'Restored purchaseReturns journalEntryId foreign key preserved');
    assert(restoredPR?.synced === true, 'Restored purchaseReturns marked synced=true');

    // 3. advancePayments
    const restoredADV = await db.advancePayments.get(testRecords.advancePayments.id);
    assert(restoredADV !== undefined, 'advancePayments record restored with original ID');
    assert(restoredADV?.advanceNumber === testRecords.advancePayments.advanceNumber, 'Restored advancePayments advanceNumber matches');
    assert(restoredADV?.partyId === customerId, 'Restored advancePayments partyId foreign key preserved');
    assert(restoredADV?.direction === 'RECEIVED', 'Restored advancePayments direction matches');
    assert(restoredADV?.amount === 8000, 'Restored advancePayments amount matches');
    assert(restoredADV?.remainingAmount === 8000, 'Restored advancePayments remainingAmount matches');
    assert(restoredADV?.cashBankAccountId === cashAccId, 'Restored advancePayments cashBankAccountId foreign key preserved');
    assert(restoredADV?.journalEntryId === journalId, 'Restored advancePayments journalEntryId foreign key preserved');
    assert(restoredADV?.synced === true, 'Restored advancePayments marked synced=true');

    // -------------------------------------------------------------------------
    // STEP 8: Verify Every Other Persistent Table Restored With Original ID & Relations
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 8: Verifying Original IDs & Relationships Across All Other Persistent Tables ---');

    // 4. systemConfig
    const restoredConfig = await db.systemConfig.get(testRecords.systemConfig.ownerUid);
    assert(restoredConfig !== undefined, 'systemConfig restored with original ownerUid');
    assert(restoredConfig?.companyName === testRecords.systemConfig.companyName, 'systemConfig companyName matches');

    // 5. accounts
    const restoredAccount = await db.accounts.get(testRecords.accounts.id);
    assert(restoredAccount !== undefined, 'accounts restored with original ID');
    assert(restoredAccount?.code === testRecords.accounts.code, 'accounts code matches');
    assert(restoredAccount?.accountClass === testRecords.accounts.accountClass, 'accounts accountClass matches');

    // 6. parties
    const restoredParty = await db.parties.get(customerId);
    assert(restoredParty !== undefined, 'parties restored with original ID');
    assert(restoredParty?.name === testRecords.parties.name, 'parties name matches');

    // 7. animals
    const restoredAnimal = await db.animals.get(animalId);
    assert(restoredAnimal !== undefined, 'animals restored with original ID');
    assert(restoredAnimal?.tag === testRecords.animals.tag, 'animals tag matches');

    // 8. animalEvents
    const restoredAnimalEvent = await db.animalEvents.get(testRecords.animalEvents.id);
    assert(restoredAnimalEvent !== undefined, 'animalEvents restored with original ID');
    assert(restoredAnimalEvent?.animalId === animalId, 'animalEvents foreign key animalId preserved');

    // 9. reminders
    const restoredReminder = await db.reminders.get(testRecords.reminders.id);
    assert(restoredReminder !== undefined, 'reminders restored with original ID');
    assert(restoredReminder?.animalId === animalId, 'reminders foreign key animalId preserved');

    // 10. ponds
    const restoredPond = await db.ponds.get(pondId);
    assert(restoredPond !== undefined, 'ponds restored with original ID');
    assert(restoredPond?.name === testRecords.ponds.name, 'ponds name matches');

    // 11. fishBatches
    const restoredFish = await db.fishBatches.get(testRecords.fishBatches.id);
    assert(restoredFish !== undefined, 'fishBatches restored with original ID');
    assert(restoredFish?.pondId === pondId, 'fishBatches foreign key pondId preserved');

    // 12. plots
    const restoredPlot = await db.plots.get(plotId);
    assert(restoredPlot !== undefined, 'plots restored with original ID');
    assert(restoredPlot?.name === testRecords.plots.name, 'plots name matches');

    // 13. cropCycles
    const restoredCrop = await db.cropCycles.get(testRecords.cropCycles.id);
    assert(restoredCrop !== undefined, 'cropCycles restored with original ID');
    assert(restoredCrop?.plotId === plotId, 'cropCycles foreign key plotId preserved');

    // 14. inventoryItems
    const restoredItem = await db.inventoryItems.get(itemId);
    assert(restoredItem !== undefined, 'inventoryItems restored with original ID');
    assert(restoredItem?.nameEn === testRecords.inventoryItems.nameEn, 'inventoryItems nameEn matches');

    // 15. stockMovements
    const restoredMovement = await db.stockMovements.get(testRecords.stockMovements.id);
    assert(restoredMovement !== undefined, 'stockMovements restored with original ID');
    assert(restoredMovement?.itemId === itemId, 'stockMovements foreign key itemId preserved');

    // 16. cashBankAccounts
    const restoredCash = await db.cashBankAccounts.get(cashAccId);
    assert(restoredCash !== undefined, 'cashBankAccounts restored with original ID');
    assert(restoredCash?.name === testRecords.cashBankAccounts.name, 'cashBankAccounts name matches');

    // 17. bankTransfers
    const restoredTransfer = await db.bankTransfers.get(testRecords.bankTransfers.id);
    assert(restoredTransfer !== undefined, 'bankTransfers restored with original ID');
    assert(restoredTransfer?.fromAccountId === cashAccId, 'bankTransfers foreign key fromAccountId preserved');

    // 18. journalEntries
    const restoredJournal = await db.journalEntries.get(journalId);
    assert(restoredJournal !== undefined, 'journalEntries restored with original ID');
    assert(restoredJournal?.voucherNumber === testRecords.journalEntries.voucherNumber, 'journalEntries voucherNumber matches');
    assert(Array.isArray(restoredJournal?.lines) && restoredJournal.lines.length === 2, 'journalEntries debit/credit lines preserved');

    // 19. sales
    const restoredSale = await db.sales.get(saleId);
    assert(restoredSale !== undefined, 'sales restored with original ID');
    assert(restoredSale?.customerId === customerId, 'sales foreign key customerId preserved');
    assert(restoredSale?.journalEntryId === journalId, 'sales foreign key journalEntryId preserved');

    // 20. purchases
    const restoredPurchase = await db.purchases.get(purchaseId);
    assert(restoredPurchase !== undefined, 'purchases restored with original ID');
    assert(restoredPurchase?.supplierId === supplierId, 'purchases foreign key supplierId preserved');
    assert(restoredPurchase?.journalEntryId === journalId, 'purchases foreign key journalEntryId preserved');

    // 21. payments
    const restoredPayment = await db.payments.get(testRecords.payments.id);
    assert(restoredPayment !== undefined, 'payments restored with original ID');
    assert(restoredPayment?.parentId === purchaseId, 'payments foreign key parentId preserved');
    assert(restoredPayment?.bankAccountId === cashAccId, 'payments foreign key bankAccountId preserved');

    // 22. loans
    const restoredLoan = await db.loans.get(loanId);
    assert(restoredLoan !== undefined, 'loans restored with original ID');
    assert(restoredLoan?.lenderName === testRecords.loans.lenderName, 'loans lenderName matches');

    // 23. investors
    const restoredInvestor = await db.investors.get(investorId);
    assert(restoredInvestor !== undefined, 'investors restored with original ID');
    assert(restoredInvestor?.name === testRecords.investors.name, 'investors name matches');

    // 24. fixedAssets
    const restoredAsset = await db.fixedAssets.get(testRecords.fixedAssets.id);
    assert(restoredAsset !== undefined, 'fixedAssets restored with original ID');
    assert(restoredAsset?.name === testRecords.fixedAssets.name, 'fixedAssets name matches');

    // 25. internalFlows
    const restoredFlow = await db.internalFlows.get(testRecords.internalFlows.id);
    assert(restoredFlow !== undefined, 'internalFlows restored with original ID');
    assert(restoredFlow?.resource === testRecords.internalFlows.resource, 'internalFlows resource matches');

    // 26. processingRuns
    const restoredProcessing = await db.processingRuns.get(testRecords.processingRuns.id);
    assert(restoredProcessing !== undefined, 'processingRuns restored with original ID');
    assert(restoredProcessing?.recipeName === testRecords.processingRuns.recipeName, 'processingRuns recipeName matches');

    // 27. recurringExpenseTemplates
    const restoredRecurring = await db.recurringExpenseTemplates.get(testRecords.recurringExpenseTemplates.id);
    assert(restoredRecurring !== undefined, 'recurringExpenseTemplates restored with original ID');
    assert(restoredRecurring?.accountCode === testRecords.recurringExpenseTemplates.accountCode, 'recurringExpenseTemplates accountCode matches');

    // 28. closedPeriods
    const restoredClosed = await db.closedPeriods.get(testRecords.closedPeriods.id);
    assert(restoredClosed !== undefined, 'closedPeriods restored with original ID');
    assert(restoredClosed?.endDate === testRecords.closedPeriods.endDate, 'closedPeriods endDate matches');

    // 29. auditLogs
    const restoredAudit = await db.auditLogs.get(testRecords.auditLogs.id);
    assert(restoredAudit !== undefined, 'auditLogs restored with original ID');
    assert(restoredAudit?.action === testRecords.auditLogs.action, 'auditLogs action matches');

    // 30. accessLogs
    const restoredAccess = await db.accessLogs.get(testRecords.accessLogs.id);
    assert(restoredAccess !== undefined, 'accessLogs restored with original ID');
    assert(restoredAccess?.email === testRecords.accessLogs.email, 'accessLogs email matches');

    // -------------------------------------------------------------------------
    // STEP 9: Verify Zero Tables Omitted
    // -------------------------------------------------------------------------
    console.log('\n--- AUDIT 9: Exhaustive Verification That No Table Was Silently Omitted ---');

    for (const table of db.tables) {
      const count = await table.count();
      assert(count > 0, `Persistent table "${table.name}" has at least 1 record after restore (actual count: ${count})`);
    }

  } finally {
    if (serverInstance) {
      serverInstance.close();
    }
  }

  console.log('\n========================================================');
  console.log(`COMPLETE CLOUD RESTORE TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testCompleteCloudRestoreCoverage.ts') || process.argv[1]?.endsWith('testCompleteCloudRestoreCoverage.js')) {
  runCompleteCloudRestoreCoverageTests().then((res) => {
    if (res.failed > 0) process.exit(1);
    process.exit(0);
  });
}
