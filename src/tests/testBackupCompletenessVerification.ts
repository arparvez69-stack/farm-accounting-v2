import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import {
  createFullJsonBackup,
  restoreFromJsonBackup,
  CANONICAL_PERSISTENT_TABLES
} from '../services/exportService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runBackupCompletenessVerificationTests() {
  console.log('====================================================');
  console.log('STARTING C2: BACKUP COMPLETENESS VERIFICATION TESTS');
  console.log('====================================================');

  const testDb = new AgroDatabase();
  await testDb.open();
  await Promise.all(testDb.tables.map((t) => t.clear()));

  // Seed test records across several tables
  await testDb.systemConfig.put({
    ownerUid: 'owner_c2_test',
    companyName: 'টেস্ট এগ্রো ফার্ম',
    phone: '01711111111',
    currency: 'BDT',
    initializedAt: '2026-09-24T00:00:00.000Z',
    synced: true
  } as any);

  await testDb.accounts.bulkPut([
    {
      id: 'acc_1010',
      code: '1010',
      nameEn: 'Cash in Hand',
      nameBn: 'নগদ টাকা',
      accountClass: 'ASSET',
      normalBalance: 'DEBIT',
      isSystem: true
    },
    {
      id: 'acc_4010',
      code: '4010',
      nameEn: 'Fish Sales',
      nameBn: 'মাছ বিক্রয় আয়',
      accountClass: 'REVENUE',
      normalBalance: 'CREDIT',
      isSystem: true
    }
  ] as any);

  await testDb.animals.bulkPut([
    {
      id: 'anim_c2_01',
      tag: 'GT-C2-01',
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'FEMALE',
      birthDate: '2025-01-01',
      purchaseCost: 8000,
      purchaseDate: '2025-01-01',
      currentWeightKg: 25,
      status: 'ACTIVE',
      location: 'Barn 1',
      accumulatedFeedCost: 1000,
      accumulatedMedCost: 200,
      accumulatedLabourCost: 500,
      otherCosts: 0,
      totalCost: 9700
    },
    {
      id: 'anim_c2_02',
      tag: 'GT-C2-02',
      species: 'GOAT',
      breed: 'Black Bengal',
      gender: 'MALE',
      birthDate: '2025-02-01',
      purchaseCost: 9000,
      purchaseDate: '2025-02-01',
      currentWeightKg: 28,
      status: 'ACTIVE',
      location: 'Barn 1',
      accumulatedFeedCost: 1200,
      accumulatedMedCost: 300,
      accumulatedLabourCost: 500,
      otherCosts: 0,
      totalCost: 11000
    }
  ] as any);

  await testDb.sales.put({
    id: 'sale_c2_01',
    invoiceNumber: 'INV-C2-001',
    customerId: 'cust_01',
    date: '2026-09-24',
    totalAmount: 25000,
    paidAmount: 25000,
    dueAmount: 0,
    paymentStatus: 'PAID',
    items: [{ itemId: 'fish_01', itemName: 'Tilapia', quantity: 100, unitPrice: 250, total: 25000 }]
  } as any);

  await testDb.journalEntries.put({
    id: 'jrn_c2_01',
    voucherNumber: 'JRN-C2-001',
    voucherType: 'RECEIPT',
    date: '2026-09-24',
    narration: 'Fish sale receipt',
    lines: [
      { accountCode: '1010', accountName: 'Cash', debit: 25000, credit: 0 },
      { accountCode: '4010', accountName: 'Fish Sales', debit: 0, credit: 25000 }
    ],
    createdAt: new Date().toISOString()
  } as any);

  // ----------------------------------------------------
  // TEST 1: Complete Backup Creation & Manifest Verification
  // ----------------------------------------------------
  console.log('\n--- Test 1: Complete Backup Creation & Metadata/Manifest Recording ---');
  const backupJsonStr = await createFullJsonBackup(testDb);
  assert(typeof backupJsonStr === 'string' && backupJsonStr.length > 100, 'Valid JSON backup string generated');

  const backupObj = JSON.parse(backupJsonStr);

  // 1. Verify schema version and timestamp
  assert(backupObj.version === '1.0.0', 'version is 1.0.0');
  assert(typeof backupObj.schemaVersion === 'number', 'schemaVersion is recorded as a number');
  assert(typeof backupObj.timestamp === 'string' && !isNaN(Date.parse(backupObj.timestamp)), 'timestamp is valid ISO date');
  assert(typeof backupObj.createdAt === 'string', 'createdAt timestamp is present');

  // 2. Verify expected persistent Dexie table list
  assert(Array.isArray(backupObj.expectedTables), 'expectedTables is an array in root');
  assert(backupObj.expectedTables.length >= CANONICAL_PERSISTENT_TABLES.length, 'expectedTables contains all persistent Dexie tables');
  for (const canonicalTable of CANONICAL_PERSISTENT_TABLES) {
    assert(backupObj.expectedTables.includes(canonicalTable), `expectedTables includes canonical table "${canonicalTable}"`);
  }

  // 3. Verify record counts for every table
  assert(typeof backupObj.recordCounts === 'object' && backupObj.recordCounts !== null, 'recordCounts is an object');
  assert(backupObj.recordCounts.systemConfig === 1, 'recordCounts.systemConfig === 1');
  assert(backupObj.recordCounts.accounts === 2, 'recordCounts.accounts === 2');
  assert(backupObj.recordCounts.animals === 2, 'recordCounts.animals === 2');
  assert(backupObj.recordCounts.sales === 1, 'recordCounts.sales === 1');
  assert(backupObj.recordCounts.journalEntries === 1, 'recordCounts.journalEntries === 1');
  assert(backupObj.recordCounts.purchases === 0, 'Empty table purchases has recordCounts === 0');

  // 4. Verify manifest / metadata structure
  assert(typeof backupObj.metadata === 'object', 'metadata block exists');
  assert(backupObj.metadata.totalTables === backupObj.expectedTables.length, 'metadata.totalTables matches expectedTables length');
  assert(backupObj.metadata.totalRecords === 7, 'metadata.totalRecords matches sum of records (1+2+2+1+1 = 7)');
  console.log('✅ Test 1 Passed: Complete backup records expected table list, counts, timestamp, and schema version.');

  // ----------------------------------------------------
  // TEST 2: Successful Restore from Complete Backup
  // ----------------------------------------------------
  console.log('\n--- Test 2: Successful Restore from Complete Backup ---');
  const restoreDb = new AgroDatabase();
  await restoreDb.open();
  await Promise.all(restoreDb.tables.map((t) => t.clear()));

  const restoreRes = await restoreFromJsonBackup(backupJsonStr, 'owner_c2_test', restoreDb);
  assert(restoreRes.success === true, 'Complete backup restores with success: true');

  const restoredAnim1 = await restoreDb.animals.get('anim_c2_01');
  const restoredSale1 = await restoreDb.sales.get('sale_c2_01');
  const restoredJrn1 = await restoreDb.journalEntries.get('jrn_c2_01');

  assert(!!restoredAnim1 && restoredAnim1.tag === 'GT-C2-01', 'Animal ID and attributes preserved');
  assert(!!restoredSale1 && restoredSale1.totalAmount === 25000, 'Sale ID and relationships preserved');
  assert(!!restoredJrn1 && restoredJrn1.lines.length === 2, 'Journal entry ID and lines preserved');
  console.log('✅ Test 2 Passed: Complete backup restores cleanly preserving IDs and relationships.');

  // ----------------------------------------------------
  // TEST 3: Incomplete Manifest - Expected Table Missing from Data
  // ----------------------------------------------------
  console.log('\n--- Test 3: Incomplete Manifest - Expected Table Missing from Data ---');
  const incompleteManifestObj = JSON.parse(backupJsonStr);
  // Add a non-existent table to expectedTables to simulate an incomplete backup missing a table
  incompleteManifestObj.expectedTables.push('futureTable');
  incompleteManifestObj.recordCounts.futureTable = 0;

  const incompleteRes = await restoreFromJsonBackup(JSON.stringify(incompleteManifestObj), 'owner_c2_test', restoreDb);
  assert(incompleteRes.success === false, 'Restore rejects incomplete backup when an expected table is missing');
  assert(incompleteRes.message.includes('futureTable'), 'Failure message identifies the missing expected table');
  console.log('✅ Test 3 Passed: Missing expected table in manifest causes restore to fail clearly.');

  // ----------------------------------------------------
  // TEST 4: Incomplete Dataset - Truncated / Count Mismatch in Table
  // ----------------------------------------------------
  console.log('\n--- Test 4: Incomplete Dataset - Truncated / Count Mismatch in Table ---');
  const truncatedDatasetObj = JSON.parse(backupJsonStr);
  // manifest recordCounts says animals has 2 records, but we truncate the animals array to 1 record
  assert(truncatedDatasetObj.recordCounts.animals === 2, 'Manifest says animals has 2 records');
  truncatedDatasetObj.animals = [truncatedDatasetObj.animals[0]]; // truncate to 1 record

  const truncatedRes = await restoreFromJsonBackup(JSON.stringify(truncatedDatasetObj), 'owner_c2_test', restoreDb);
  assert(truncatedRes.success === false, 'Restore rejects truncated dataset when actual count does not match manifest');
  assert(truncatedRes.message.includes('animals'), 'Failure message identifies the truncated table "animals"');
  assert(truncatedRes.message.includes('expected 2') || truncatedRes.message.includes('Incomplete backup dataset'), 'Failure message flags dataset count mismatch');
  console.log('✅ Test 4 Passed: Truncated dataset with count mismatch causes restore to fail clearly.');

  // ----------------------------------------------------
  // TEST 5: Missing Canonical Table is NEVER Silently Treated as Empty
  // ----------------------------------------------------
  console.log('\n--- Test 5: Missing Canonical Table Never Silently Treated as Empty ---');
  const missingTableObj = JSON.parse(backupJsonStr);
  delete missingTableObj.cropCycles; // Delete cropCycles table completely
  delete missingTableObj.expectedTables; // Remove manifest so it falls back to canonical check

  const missingTableRes = await restoreFromJsonBackup(JSON.stringify(missingTableObj), 'owner_c2_test', restoreDb);
  assert(missingTableRes.success === false, 'Missing canonical table must reject restore, not silently become []');
  assert(missingTableRes.message.includes('cropCycles'), 'Failure message identifies missing table "cropCycles"');
  console.log('✅ Test 5 Passed: Missing tables are never silently treated as empty.');

  // ----------------------------------------------------
  // TEST 6: Backup Creation Fails if Any Table Cannot Be Read
  // ----------------------------------------------------
  console.log('\n--- Test 6: Backup Creation Fails if Any Table Cannot Be Read ---');
  const brokenDb = {
    ...testDb,
    tables: testDb.tables,
    // Simulate a failure on animals table read
    animals: {
      toArray: async () => {
        throw new Error('Disk I/O failure while reading animals table');
      }
    }
  };

  let backupFailed = false;
  try {
    await createFullJsonBackup(brokenDb);
  } catch (err: any) {
    backupFailed = true;
    assert(err.message.includes('animals') || err.message.includes('Disk I/O failure'), 'Error message identifies the failed table read');
  }
  assert(backupFailed === true, 'createFullJsonBackup must throw and fail when any table cannot be read');
  console.log('✅ Test 6 Passed: Failed table read causes backup creation to fail without exporting partial data.');

  console.log('\n====================================================');
  console.log('ALL C2 BACKUP COMPLETENESS VERIFICATION TESTS PASSED! 🎉');
  console.log('====================================================');
  return { success: true };
}

runBackupCompletenessVerificationTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
