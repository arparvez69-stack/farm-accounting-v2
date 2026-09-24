import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { createFullJsonBackup, restoreFromJsonBackup, safeTableToArray } from '../services/exportService';

export async function runFullJsonBackupCoverageTests() {
  console.log('\n========================================================');
  console.log('TASK F5 TEST SUITE: COMPLETE JSON BACKUP PREVENTS FALSE-SUCCESS');
  console.log('Validating Full Dexie Table Coverage, Clear Failure On Read Error & Zero-Record Validity');
  console.log('========================================================');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  function assert(condition: boolean, msg: string) {
    if (condition) {
      passed++;
      console.log(`✅ PASS: ${msg}`);
    } else {
      failed++;
      console.error(`❌ FAIL: ${msg}`);
      failures.push(msg);
    }
  }

  // Set up an isolated test database instance
  const testDbName = `AgroBackupTestDb_${Date.now()}`;
  const testDb = new AgroDatabase();
  // Override name for test isolation
  (testDb as any).name = testDbName;
  await testDb.open();

  console.log('\n--- TEST 1: Schema Audit - Verify All 30 Persistent Tables Exist ---');
  const allTables = testDb.tables;
  assert(allTables.length >= 30, `AgroDatabase has at least 30 persistent tables (actual: ${allTables.length})`);

  const requiredTables = [
    'systemConfig',
    'accounts',
    'journalEntries',
    'closedPeriods',
    'recurringExpenseTemplates',
    'animals',
    'animalEvents',
    'reminders',
    'ponds',
    'fishBatches',
    'plots',
    'cropCycles',
    'internalFlows',
    'processingRuns',
    'inventoryItems',
    'stockMovements',
    'parties',
    'purchases',
    'sales',
    'salesReturns',
    'purchaseReturns',
    'advancePayments',
    'payments',
    'cashBankAccounts',
    'bankTransfers',
    'loans',
    'investors',
    'fixedAssets',
    'auditLogs',
    'accessLogs'
  ];

  for (const tName of requiredTables) {
    const tableExists = allTables.some((t) => t.name === tName);
    assert(tableExists, `Persistent table "${tName}" exists in AgroDatabase schema`);
  }

  console.log('\n--- TEST 2: Seed Sample Records into Tables Including Minimum Required Tables ---');
  // 1. systemConfig
  await testDb.systemConfig.put({
    ownerUid: 'test_owner_123',
    farmName: 'বিকল্প অর্গানিক এগ্রো ফার্ম',
    phone: '01711000000',
    currency: 'BDT',
    synced: false
  } as any);

  // 2. accounts
  await testDb.accounts.bulkPut([
    {
      id: 'acc_1010',
      code: '1010',
      name: 'ক্যাশ ইন হ্যান্ড (Cash in Hand)',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true,
      balance: 50000
    },
    {
      id: 'acc_2010',
      code: '2010',
      name: 'পাওনাদার (Accounts Payable)',
      accountClass: 'LIABILITY',
      normalBalance: 'CREDIT',
      isSystem: true,
      balance: 10000
    }
  ] as any);

  // 3. journalEntries
  await testDb.journalEntries.put({
    id: 'je_test_001',
    voucherNumber: 'JV-2026-0001',
    voucherType: 'JOURNAL',
    date: '2026-09-24',
    description: 'Initial funding voucher',
    lines: [
      { id: 'l1', accountId: 'acc_1010', accountCode: '1010', accountName: 'Cash', debit: 50000, credit: 0 },
      { id: 'l2', accountId: 'acc_2010', accountCode: '2010', accountName: 'AP', debit: 0, credit: 50000 }
    ],
    totalAmount: 50000,
    synced: true,
    createdAt: new Date().toISOString()
  } as any);

  // 4. salesReturns
  await testDb.salesReturns.put({
    id: 'sr_test_001',
    returnNumber: 'SR-2026-001',
    saleId: 'sale_001',
    saleInvoiceNumber: 'INV-2026-001',
    customerId: 'cust_001',
    customerName: 'করিম ট্রেডার্স',
    date: '2026-09-24',
    items: [{ itemId: 'item_01', itemName: 'ছাগল খাদ্য', quantity: 2, unitPrice: 500, total: 1000 }],
    returnSubtotal: 1000,
    returnVatAmount: 0,
    returnTotal: 1000,
    settlementMethod: 'CREDIT_ADJUSTMENT',
    journalEntryId: 'je_sr_001',
    idempotencyKey: 'idemp_sr_001',
    synced: false,
    createdAt: new Date().toISOString()
  } as any);

  // 5. purchaseReturns
  await testDb.purchaseReturns.put({
    id: 'pr_test_001',
    returnNumber: 'PR-2026-001',
    purchaseId: 'purch_001',
    purchaseInvoiceNumber: 'PINV-2026-001',
    supplierId: 'supp_001',
    supplierName: 'ঢাকা ফিড মিল',
    date: '2026-09-24',
    items: [{ itemId: 'item_02', itemName: 'মাছের খাবার', quantity: 5, unitPrice: 300, total: 1500 }],
    returnSubtotal: 1500,
    returnVatAmount: 0,
    returnTotal: 1500,
    settlementMethod: 'CASH',
    journalEntryId: 'je_pr_001',
    idempotencyKey: 'idemp_pr_001',
    synced: true,
    createdAt: new Date().toISOString()
  } as any);

  // 6. advancePayments
  await testDb.advancePayments.put({
    id: 'adv_test_001',
    partyId: 'cust_001',
    direction: 'CUSTOMER_ADVANCE',
    date: '2026-09-24',
    originalAmount: 5000,
    appliedAmount: 2000,
    remainingBalance: 3000,
    paymentMethod: 'CASH',
    receiptNumber: 'ADV-REC-001',
    journalEntryId: 'je_adv_001',
    idempotencyKey: 'idemp_adv_001',
    synced: true,
    createdAt: new Date().toISOString()
  } as any);

  // 7. payments
  await testDb.payments.put({
    id: 'pmt_test_001',
    parentId: 'sale_001',
    parentType: 'SALE',
    amount: 3000,
    date: '2026-09-24',
    paymentMethod: 'CASH',
    journalEntryId: 'je_pmt_001',
    idempotencyKey: 'idemp_pmt_001',
    synced: false
  } as any);

  // 8. inventoryItems
  await testDb.inventoryItems.put({
    id: 'item_01',
    code: 'FEED-01',
    name: 'ছাগল খাদ্য সুপ্রিম',
    category: 'FEED',
    unit: 'KG',
    currentStock: 150,
    costPrice: 45,
    synced: true
  } as any);

  // 9. animals
  await testDb.animals.put({
    id: 'anim_001',
    tag: 'GOAT-001',
    species: 'GOAT',
    breed: 'Black Bengal',
    status: 'ACTIVE',
    birthDate: '2025-01-01',
    synced: true
  } as any);

  // 10. fixedAssets
  await testDb.fixedAssets.put({
    id: 'fa_001',
    name: 'ট্রাক্টর ও ট্রলি',
    category: 'MACHINERY',
    purchaseDate: '2025-06-01',
    purchasePrice: 450000,
    currentBookValue: 410000,
    synced: true
  } as any);

  console.log('\n--- TEST 3: Create Full JSON Backup and Verify Table Inclusion & Record Counts ---');
  const backupJsonString = await createFullJsonBackup(testDb);
  assert(typeof backupJsonString === 'string' && backupJsonString.length > 50, 'Backup generated non-empty JSON string');

  const backupData = JSON.parse(backupJsonString);
  assert(backupData.version === '1.0.0', 'Backup contains schema version 1.0.0');
  assert(typeof backupData.timestamp === 'string', 'Backup contains valid ISO timestamp');

  // Verify that EVERY table in allTables appears in the backup and record counts match
  for (const table of allTables) {
    const tableName = table.name;
    const tableDataInBackup = backupData[tableName];
    assert(Array.isArray(tableDataInBackup), `Table "${tableName}" is present in backup as an array`);

    const dbRecordCount = await table.count();
    const backupRecordCount = tableDataInBackup.length;
    assert(
      backupRecordCount === dbRecordCount,
      `Table "${tableName}" count in backup (${backupRecordCount}) matches DB count (${dbRecordCount})`
    );
  }

  console.log('\n--- TEST 4: Zero-Record Tables Are Still Valid When Successfully Read ---');
  // Check empty tables like 'ponds', 'plots', 'loans', etc. which have 0 records in testDb
  const zeroRecordTables = ['ponds', 'plots', 'loans', 'investors', 'bankTransfers', 'auditLogs'];
  for (const zeroTable of zeroRecordTables) {
    const dbCount = await (testDb as any)[zeroTable].count();
    assert(dbCount === 0, `Table "${zeroTable}" in test DB has 0 records`);
    const tableData = await safeTableToArray(testDb, zeroTable);
    assert(Array.isArray(tableData) && tableData.length === 0, `safeTableToArray on 0-record table "${zeroTable}" returns empty array []`);
    assert(Array.isArray(backupData[zeroTable]) && backupData[zeroTable].length === 0, `0-record table "${zeroTable}" is valid and present in backup as []`);
  }

  console.log('\n--- TEST 5: Verify Exact Record & Field Preservation (Zero Mutation) ---');
  // Check salesReturns record preservation
  const srInDb = await testDb.salesReturns.get('sr_test_001');
  const srInBackup = backupData.salesReturns.find((r: any) => r.id === 'sr_test_001');
  assert(!!srInBackup, 'salesReturns record "sr_test_001" found in backup');
  assert(srInBackup?.returnNumber === 'SR-2026-001', 'salesReturns returnNumber preserved exactly');
  assert(srInBackup?.journalEntryId === 'je_sr_001', 'salesReturns journalEntryId preserved exactly');
  assert(srInBackup?.idempotencyKey === 'idemp_sr_001', 'salesReturns idempotencyKey preserved exactly');
  assert(srInBackup?.synced === false, 'salesReturns synced boolean preserved exactly');

  // Check purchaseReturns record preservation
  const prInBackup = backupData.purchaseReturns.find((r: any) => r.id === 'pr_test_001');
  assert(!!prInBackup, 'purchaseReturns record "pr_test_001" found in backup');
  assert(prInBackup?.returnNumber === 'PR-2026-001', 'purchaseReturns returnNumber preserved exactly');
  assert(prInBackup?.journalEntryId === 'je_pr_001', 'purchaseReturns journalEntryId preserved exactly');
  assert(prInBackup?.idempotencyKey === 'idemp_pr_001', 'purchaseReturns idempotencyKey preserved exactly');

  // Check advancePayments record preservation
  const advInBackup = backupData.advancePayments.find((r: any) => r.id === 'adv_test_001');
  assert(!!advInBackup, 'advancePayments record "adv_test_001" found in backup');
  assert(advInBackup?.direction === 'CUSTOMER_ADVANCE', 'advancePayments direction preserved exactly');
  assert(advInBackup?.remainingBalance === 3000, 'advancePayments remainingBalance preserved exactly');
  assert(advInBackup?.idempotencyKey === 'idemp_adv_001', 'advancePayments idempotencyKey preserved exactly');

  // Check payments record preservation
  const pmtInBackup = backupData.payments.find((r: any) => r.id === 'pmt_test_001');
  assert(!!pmtInBackup, 'payments record "pmt_test_001" found in backup');
  assert(pmtInBackup?.parentId === 'sale_001', 'payments parentId preserved exactly');
  assert(pmtInBackup?.idempotencyKey === 'idemp_pmt_001', 'payments idempotencyKey preserved exactly');
  assert(pmtInBackup?.journalEntryId === 'je_pmt_001', 'payments journalEntryId preserved exactly');

  console.log('\n--- TEST 6: Verify Clear Failure When a Persistent Table Cannot Be Read ---');
  // Scenario A: When a table's toArray throws an error on salesReturns
  const brokenDb = new AgroDatabase();
  (brokenDb as any).name = `AgroBrokenTestDb_${Date.now()}`;
  await brokenDb.open();
  (brokenDb.salesReturns as any).toArray = async () => {
    throw new Error('IndexedDB disk I/O read failure or table locked');
  };

  let failureCaughtA = false;
  let failureErrorMessageA = '';
  try {
    await createFullJsonBackup(brokenDb);
  } catch (err: any) {
    failureCaughtA = true;
    failureErrorMessageA = err.message;
  }

  assert(failureCaughtA, 'createFullJsonBackup failed when a persistent table threw a read error');
  assert(
    failureErrorMessageA.includes('salesReturns'),
    `Failure message identifies the failing table "salesReturns" (actual: "${failureErrorMessageA}")`
  );

  // Scenario B: When a table's toArray throws an error on accounts
  const brokenDbAccounts = new AgroDatabase();
  (brokenDbAccounts as any).name = `AgroBrokenAccounts_${Date.now()}`;
  await brokenDbAccounts.open();
  (brokenDbAccounts.accounts as any).toArray = async () => {
    throw new Error('Database locked or read error on accounts table');
  };

  let failureCaughtAccounts = false;
  let failureErrorMessageAccounts = '';
  try {
    await createFullJsonBackup(brokenDbAccounts);
  } catch (err: any) {
    failureCaughtAccounts = true;
    failureErrorMessageAccounts = err.message;
  }

  assert(failureCaughtAccounts, 'createFullJsonBackup failed when "accounts" table threw a read error');
  assert(
    failureErrorMessageAccounts.includes('accounts'),
    `Failure message identifies the failing table "accounts" (actual: "${failureErrorMessageAccounts}")`
  );

  // Scenario C: When a table's toArray throws an error on advancePayments
  const brokenDbAdv = new AgroDatabase();
  (brokenDbAdv as any).name = `AgroBrokenAdv_${Date.now()}`;
  await brokenDbAdv.open();
  (brokenDbAdv.advancePayments as any).toArray = async () => {
    throw new Error('Corrupted block on advancePayments table');
  };

  let failureCaughtAdv = false;
  let failureErrorMessageAdv = '';
  try {
    await createFullJsonBackup(brokenDbAdv);
  } catch (err: any) {
    failureCaughtAdv = true;
    failureErrorMessageAdv = err.message;
  }

  assert(failureCaughtAdv, 'createFullJsonBackup failed when "advancePayments" table threw a read error');
  assert(
    failureErrorMessageAdv.includes('advancePayments'),
    `Failure message identifies the failing table "advancePayments" (actual: "${failureErrorMessageAdv}")`
  );

  // Scenario D: When a persistent table is completely missing on the DB
  const incompleteDb: any = {
    tables: [{ name: 'accounts', toArray: async () => [] }]
  };
  let failureCaughtB = false;
  let failureErrorMessageB = '';
  try {
    await createFullJsonBackup(incompleteDb);
  } catch (err: any) {
    failureCaughtB = true;
    failureErrorMessageB = err.message;
  }
  assert(failureCaughtB, 'createFullJsonBackup failed when a persistent table is missing');
  assert(
    failureErrorMessageB.includes('systemConfig'),
    `Failure message identifies the missing table "systemConfig" (actual: "${failureErrorMessageB}")`
  );

  console.log('\n--- TEST 7: Round-Trip Restore Verification ---');
  const restoreDbName = `AgroRestoreTestDb_${Date.now()}`;
  const restoreDb = new AgroDatabase();
  (restoreDb as any).name = restoreDbName;
  await restoreDb.open();

  const restoreResult = await restoreFromJsonBackup(backupJsonString, 'test_user', restoreDb);
  assert(restoreResult.success === true, 'restoreFromJsonBackup completed with success=true');

  const restoredSRCount = await restoreDb.salesReturns.count();
  assert(restoredSRCount === 1, `restored salesReturns count matches original (actual: ${restoredSRCount})`);

  const restoredPRCount = await restoreDb.purchaseReturns.count();
  assert(restoredPRCount === 1, `restored purchaseReturns count matches original (actual: ${restoredPRCount})`);

  const restoredAdvCount = await restoreDb.advancePayments.count();
  assert(restoredAdvCount === 1, `restored advancePayments count matches original (actual: ${restoredAdvCount})`);

  const restoredAccountsCount = await restoreDb.accounts.count();
  assert(restoredAccountsCount === 2, `restored accounts count matches original (actual: ${restoredAccountsCount})`);

  console.log('\n========================================================');
  console.log(`JSON BACKUP COVERAGE TESTS COMPLETED: Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log('========================================================');

  return { total: passed + failed, passed, failed, failures };
}
