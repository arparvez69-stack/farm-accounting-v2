import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
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

export async function runBackupRestoreAuditTests(): Promise<AssertionResult> {
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
  console.log('AUDIT TEST SUITE: FULL JSON BACKUP RESTORE PATH');
  console.log('Validating Rejection of Malformed, Incomplete, & Incompatible Backups BEFORE Clearing');
  console.log('Confirming Preservation of IDs, Relationships, and All Persistent Tables');
  console.log('========================================================\n');

  // Setup test database
  const testDbName = `AgroRestoreAuditDb_${Date.now()}`;
  const testDb = new AgroDatabase();
  (testDb as any).name = testDbName;
  await testDb.open();

  // Helper to populate baseline test data across multiple tables
  async function seedBaselineData(targetDb: AgroDatabase) {
    await targetDb.systemConfig.put({
      ownerUid: 'owner_baseline_999',
      companyName: 'বেসলাইন অর্গানিক এগ্রো ফার্ম',
      phone: '01700000000',
      currency: 'BDT',
      initializedAt: '2026-09-24T00:00:00.000Z',
      synced: true
    } as any);

    await targetDb.accounts.bulkPut([
      {
        id: 'acc_base_1010',
        code: '1010',
        nameEn: 'Cash in Hand',
        nameBn: 'ক্যাশ ইন হ্যান্ড',
        accountClass: 'ASSET',
        normalBalance: 'DEBIT',
        isSystem: true
      },
      {
        id: 'acc_base_2010',
        code: '2010',
        nameEn: 'Accounts Payable',
        nameBn: 'পাওনাদার',
        accountClass: 'LIABILITY',
        normalBalance: 'CREDIT',
        isSystem: true
      }
    ] as any);

    await targetDb.journalEntries.put({
      id: 'je_base_001',
      voucherNumber: 'JV-BASE-001',
      voucherType: 'JOURNAL',
      date: '2026-09-24',
      lines: [
        { id: 'l1', accountCode: '1010', debit: 25000, credit: 0 },
        { id: 'l2', accountCode: '2010', debit: 0, credit: 25000 }
      ],
      synced: true
    } as any);

    await targetDb.animals.put({
      id: 'anim_base_001',
      tag: 'TAG-BASE-1',
      species: 'GOAT',
      breed: 'Black Bengal',
      status: 'ACTIVE',
      synced: true
    } as any);

    await targetDb.parties.put({
      id: 'party_base_001',
      type: 'CUSTOMER',
      name: 'Baseline Customer Ltd',
      phone: '01800000000',
      synced: true
    } as any);

    await targetDb.salesReturns.put({
      id: 'sr_base_001',
      returnNumber: 'SR-BASE-001',
      saleId: 'sale_base_001',
      customerId: 'party_base_001',
      totalRefundAmount: 5000,
      synced: true
    } as any);
  }

  // Helper to verify baseline counts remain unchanged
  async function assertBaselineDataUntouched(targetDb: AgroDatabase, context: string) {
    const config = await targetDb.systemConfig.get('owner_baseline_999');
    const accCount = await targetDb.accounts.count();
    const jeCount = await targetDb.journalEntries.count();
    const animCount = await targetDb.animals.count();
    const partyCount = await targetDb.parties.count();
    const srCount = await targetDb.salesReturns.count();

    assert(config?.ownerUid === 'owner_baseline_999', `[${context}] Existing systemConfig preserved untouched`);
    assert(accCount === 2, `[${context}] Existing accounts count preserved untouched (count: ${accCount})`);
    assert(jeCount === 1, `[${context}] Existing journalEntries count preserved untouched (count: ${jeCount})`);
    assert(animCount === 1, `[${context}] Existing animals count preserved untouched (count: ${animCount})`);
    assert(partyCount === 1, `[${context}] Existing parties count preserved untouched (count: ${partyCount})`);
    assert(srCount === 1, `[${context}] Existing salesReturns count preserved untouched (count: ${srCount})`);
  }

  try {
    // -----------------------------------------------------------------
    // TEST GROUP 1: MALFORMED JSON SYNTAX & ROOT STRUCTURE
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 1: Malformed JSON Syntax & Non-Object Root Rejection ---');
    await seedBaselineData(testDb);

    // 1.1 Truncated / invalid JSON syntax
    const badJsonRes = await restoreFromJsonBackup('{ "version": "1.0.0", "timestamp": "2026-09-24', 'test_user', testDb);
    assert(badJsonRes.success === false, 'Truncated JSON syntax is rejected');
    assert(badJsonRes.message.includes('Malformed JSON syntax') || badJsonRes.message.includes('অবৈধ'), 'Rejection message indicates malformed JSON syntax');
    await assertBaselineDataUntouched(testDb, 'Truncated JSON');

    // 1.2 Empty string
    const emptyRes = await restoreFromJsonBackup('', 'test_user', testDb);
    assert(emptyRes.success === false, 'Empty string backup is rejected');
    await assertBaselineDataUntouched(testDb, 'Empty String');

    // 1.3 Primitive string root
    const stringRootRes = await restoreFromJsonBackup('"just a string"', 'test_user', testDb);
    assert(stringRootRes.success === false, 'Primitive string root is rejected');
    await assertBaselineDataUntouched(testDb, 'Primitive String');

    // 1.4 Primitive number root
    const numberRootRes = await restoreFromJsonBackup('123456', 'test_user', testDb);
    assert(numberRootRes.success === false, 'Primitive number root is rejected');
    await assertBaselineDataUntouched(testDb, 'Primitive Number');

    // 1.5 Null root
    const nullRootRes = await restoreFromJsonBackup('null', 'test_user', testDb);
    assert(nullRootRes.success === false, 'Null JSON root is rejected');
    await assertBaselineDataUntouched(testDb, 'Null Root');

    // 1.6 Array root instead of object
    const arrayRootRes = await restoreFromJsonBackup('[{"version":"1.0.0"}]', 'test_user', testDb);
    assert(arrayRootRes.success === false, 'Array root instead of object is rejected');
    await assertBaselineDataUntouched(testDb, 'Array Root');

    // -----------------------------------------------------------------
    // TEST GROUP 2: INCOMPATIBLE VERSION & INVALID TIMESTAMP
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Incompatible Version & Invalid Timestamp Rejection ---');

    // 2.1 Incompatible major version (version 2.0.0)
    const validFullBackupStr = await createFullJsonBackup(testDb);
    const validBackupObj = JSON.parse(validFullBackupStr);

    const incompatibleVersionObj = { ...validBackupObj, version: '2.0.0' };
    const incompVerRes = await restoreFromJsonBackup(JSON.stringify(incompatibleVersionObj), 'test_user', testDb);
    assert(incompVerRes.success === false, 'Incompatible major version 2.0.0 is rejected');
    assert(incompVerRes.message.includes('Incompatible backup version') || incompVerRes.message.includes('অসামঞ্জস্যপূর্ণ'), 'Rejection message flags incompatible version');
    await assertBaselineDataUntouched(testDb, 'Incompatible Version 2.0.0');

    // 2.2 Incompatible non-semver version
    const invalidVerObj = { ...validBackupObj, version: 'custom_legacy_format' };
    const invalidVerRes = await restoreFromJsonBackup(JSON.stringify(invalidVerObj), 'test_user', testDb);
    assert(invalidVerRes.success === false, 'Invalid non-1.x version is rejected');
    await assertBaselineDataUntouched(testDb, 'Invalid Version');

    // 2.3 Missing version
    const missingVerObj = { ...validBackupObj };
    delete missingVerObj.version;
    const missingVerRes = await restoreFromJsonBackup(JSON.stringify(missingVerObj), 'test_user', testDb);
    assert(missingVerRes.success === false, 'Backup missing version is rejected');
    await assertBaselineDataUntouched(testDb, 'Missing Version');

    // 2.4 Invalid timestamp
    const invalidTsObj = { ...validBackupObj, timestamp: 'not-a-valid-iso-date' };
    const invalidTsRes = await restoreFromJsonBackup(JSON.stringify(invalidTsObj), 'test_user', testDb);
    assert(invalidTsRes.success === false, 'Backup with invalid timestamp is rejected');
    await assertBaselineDataUntouched(testDb, 'Invalid Timestamp');

    // 2.5 Missing timestamp
    const missingTsObj = { ...validBackupObj };
    delete missingTsObj.timestamp;
    const missingTsRes = await restoreFromJsonBackup(JSON.stringify(missingTsObj), 'test_user', testDb);
    assert(missingTsRes.success === false, 'Backup missing timestamp is rejected');
    await assertBaselineDataUntouched(testDb, 'Missing Timestamp');

    // -----------------------------------------------------------------
    // TEST GROUP 3: INCOMPLETE BACKUPS (MISSING REQUIRED PERSISTENT TABLES)
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Incomplete Backup Rejection (Missing Tables) ---');

    // 3.1 Missing salesReturns table
    const missingSR = { ...validBackupObj };
    delete missingSR.salesReturns;
    const missingSRRes = await restoreFromJsonBackup(JSON.stringify(missingSR), 'test_user', testDb);
    assert(missingSRRes.success === false, 'Backup missing "salesReturns" table is rejected');
    assert(missingSRRes.message.includes('salesReturns'), 'Failure message identifies the missing table "salesReturns"');
    await assertBaselineDataUntouched(testDb, 'Missing salesReturns');

    // 3.2 Missing purchaseReturns table
    const missingPR = { ...validBackupObj };
    delete missingPR.purchaseReturns;
    const missingPRRes = await restoreFromJsonBackup(JSON.stringify(missingPR), 'test_user', testDb);
    assert(missingPRRes.success === false, 'Backup missing "purchaseReturns" table is rejected');
    assert(missingPRRes.message.includes('purchaseReturns'), 'Failure message identifies the missing table "purchaseReturns"');
    await assertBaselineDataUntouched(testDb, 'Missing purchaseReturns');

    // 3.3 Missing advancePayments table
    const missingAdv = { ...validBackupObj };
    delete missingAdv.advancePayments;
    const missingAdvRes = await restoreFromJsonBackup(JSON.stringify(missingAdv), 'test_user', testDb);
    assert(missingAdvRes.success === false, 'Backup missing "advancePayments" table is rejected');
    assert(missingAdvRes.message.includes('advancePayments'), 'Failure message identifies the missing table "advancePayments"');
    await assertBaselineDataUntouched(testDb, 'Missing advancePayments');

    // 3.4 Missing animals table
    const missingAnim = { ...validBackupObj };
    delete missingAnim.animals;
    const missingAnimRes = await restoreFromJsonBackup(JSON.stringify(missingAnim), 'test_user', testDb);
    assert(missingAnimRes.success === false, 'Backup missing "animals" table is rejected');
    assert(missingAnimRes.message.includes('animals'), 'Failure message identifies the missing table "animals"');
    await assertBaselineDataUntouched(testDb, 'Missing animals');

    // 3.5 Missing systemConfig (and missing system alias)
    const missingSys = { ...validBackupObj };
    delete missingSys.systemConfig;
    delete missingSys.system;
    const missingSysRes = await restoreFromJsonBackup(JSON.stringify(missingSys), 'test_user', testDb);
    assert(missingSysRes.success === false, 'Backup missing "systemConfig" is rejected');
    assert(missingSysRes.message.includes('systemConfig'), 'Failure message identifies the missing table "systemConfig"');
    await assertBaselineDataUntouched(testDb, 'Missing systemConfig');

    // 3.6 Partial backup containing only accounts and journal entries (critical regression test)
    const partialBackup = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      accounts: validBackupObj.accounts,
      journalEntries: validBackupObj.journalEntries
    };
    const partialRes = await restoreFromJsonBackup(JSON.stringify(partialBackup), 'test_user', testDb);
    assert(partialRes.success === false, 'Incomplete partial backup containing only accounts/journalEntries is rejected');
    assert(partialRes.message.includes('Incomplete backup') || partialRes.message.includes('অসম্পূর্ণ'), 'Failure message flags incomplete backup');
    await assertBaselineDataUntouched(testDb, 'Incomplete Partial Backup');

    // -----------------------------------------------------------------
    // TEST GROUP 4: MALFORMED TABLE DATA (NON-ARRAY / INVALID TYPES)
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Malformed Table Data Rejection ---');

    // 4.1 Table is a corrupted string instead of array
    const corruptedAnimals = { ...validBackupObj, animals: 'corrupted_string_instead_of_array' };
    const corruptAnimRes = await restoreFromJsonBackup(JSON.stringify(corruptedAnimals), 'test_user', testDb);
    assert(corruptAnimRes.success === false, 'Table with corrupted string data is rejected');
    assert(corruptAnimRes.message.includes('animals'), 'Failure message identifies the malformed table "animals"');
    await assertBaselineDataUntouched(testDb, 'Corrupted animals table');

    // 4.2 Table is a number instead of array
    const corruptedParties = { ...validBackupObj, parties: 123456 };
    const corruptPartiesRes = await restoreFromJsonBackup(JSON.stringify(corruptedParties), 'test_user', testDb);
    assert(corruptPartiesRes.success === false, 'Table with number data is rejected');
    assert(corruptPartiesRes.message.includes('parties'), 'Failure message identifies the malformed table "parties"');
    await assertBaselineDataUntouched(testDb, 'Corrupted parties table');

    // 4.3 Table is null instead of array
    const nullSales = { ...validBackupObj, sales: null, salesInvoices: null };
    const nullSalesRes = await restoreFromJsonBackup(JSON.stringify(nullSales), 'test_user', testDb);
    assert(nullSalesRes.success === false, 'Table with null data is rejected');
    await assertBaselineDataUntouched(testDb, 'Null sales table');

    // -----------------------------------------------------------------
    // TEST GROUP 5: MALFORMED RECORD INTEGRITY & MISSING PRIMARY KEYS
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Malformed Record Integrity & Missing Primary Keys ---');

    // 5.1 Account record missing primary key 'id'
    const recordMissingId = {
      ...validBackupObj,
      accounts: [{ code: '1099', nameEn: 'Bad Account without ID', accountClass: 'ASSET' }]
    };
    const missingIdRes = await restoreFromJsonBackup(JSON.stringify(recordMissingId), 'test_user', testDb);
    assert(missingIdRes.success === false, 'Record missing string primary key id is rejected');
    assert(missingIdRes.message.includes('primary key') || missingIdRes.message.includes('id'), 'Failure message identifies missing primary key');
    await assertBaselineDataUntouched(testDb, 'Account missing ID');

    // 5.2 Animal record is a primitive null
    const nullAnimalRecord = {
      ...validBackupObj,
      animals: [null]
    };
    const nullAnimRes = await restoreFromJsonBackup(JSON.stringify(nullAnimalRecord), 'test_user', testDb);
    assert(nullAnimRes.success === false, 'Record that is null within table array is rejected');
    await assertBaselineDataUntouched(testDb, 'Null Animal Record');

    // 5.3 Journal entry record missing lines array
    const badJournalRecord = {
      ...validBackupObj,
      journalEntries: [{ id: 'je_bad_001', voucherNumber: 'JV-BAD', date: '2026-09-24', lines: 'not-an-array' }]
    };
    const badJnlRes = await restoreFromJsonBackup(JSON.stringify(badJournalRecord), 'test_user', testDb);
    assert(badJnlRes.success === false, 'Journal entry record with non-array lines is rejected');
    assert(badJnlRes.message.includes('lines') || badJnlRes.message.includes('journalEntries'), 'Failure message identifies malformed journal entry');
    await assertBaselineDataUntouched(testDb, 'Bad Journal Record');

    // 5.4 systemConfig record missing ownerUid and id
    const badConfigRecord = {
      ...validBackupObj,
      systemConfig: [{ farmName: 'Missing ownerUid farm' }]
    };
    const badConfigRes = await restoreFromJsonBackup(JSON.stringify(badConfigRecord), 'test_user', testDb);
    assert(badConfigRes.success === false, 'systemConfig record missing ownerUid/id is rejected');
    await assertBaselineDataUntouched(testDb, 'Bad systemConfig Record');

    // -----------------------------------------------------------------
    // TEST GROUP 6: VALID FULL BACKUP RESTORE (PRESERVES IDS & RELATIONS)
    // -----------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Valid Full Backup Restore (ID & Relation Preservation) ---');

    // Create a new fresh database to test full round-trip restore
    const restoreTargetDbName = `AgroRoundTripDb_${Date.now()}`;
    const restoreTargetDb = new AgroDatabase();
    (restoreTargetDb as any).name = restoreTargetDbName;
    await restoreTargetDb.open();

    const fullRestoreRes = await restoreFromJsonBackup(validFullBackupStr, 'test_owner_uid', restoreTargetDb);
    assert(fullRestoreRes.success === true, 'Valid complete full backup restores successfully');
    assert(fullRestoreRes.message.includes('সফলভাবে') || fullRestoreRes.message.includes('Success'), 'Success message returned');

    // Confirm all 30 persistent tables exist and are preserved
    for (const tName of CANONICAL_PERSISTENT_TABLES) {
      const table = (restoreTargetDb as any)[tName];
      assert(table !== undefined, `Persistent table "${tName}" exists on restored database`);
    }

    // Confirm exact preservation of IDs
    const restoredConfig = await restoreTargetDb.systemConfig.get('owner_baseline_999');
    assert(restoredConfig?.ownerUid === 'owner_baseline_999', 'systemConfig restored with original ownerUid');
    assert(restoredConfig?.companyName === 'বেসলাইন অর্গানিক এগ্রো ফার্ম', 'systemConfig companyName preserved');

    const restoredAccount1010 = await restoreTargetDb.accounts.get('acc_base_1010');
    assert(restoredAccount1010 !== undefined, 'Account acc_base_1010 restored with original ID');
    assert(restoredAccount1010?.code === '1010', 'Account code 1010 preserved');

    const restoredAnimal = await restoreTargetDb.animals.get('anim_base_001');
    assert(restoredAnimal !== undefined, 'Animal restored with original ID "anim_base_001"');
    assert(restoredAnimal?.tag === 'TAG-BASE-1', 'Animal tag preserved');

    const restoredParty = await restoreTargetDb.parties.get('party_base_001');
    assert(restoredParty !== undefined, 'Party restored with original ID "party_base_001"');
    assert(restoredParty?.name === 'Baseline Customer Ltd', 'Party name preserved');

    // Confirm relational integrity
    const restoredSR = await restoreTargetDb.salesReturns.get('sr_base_001');
    assert(restoredSR !== undefined, 'salesReturns restored with original ID "sr_base_001"');
    assert(restoredSR?.customerId === 'party_base_001', 'salesReturns customerId relation preserved');
    assert(restoredSR?.saleId === 'sale_base_001', 'salesReturns saleId relation preserved');

    const restoredJE = await restoreTargetDb.journalEntries.get('je_base_001');
    assert(restoredJE !== undefined, 'journalEntries restored with original ID "je_base_001"');
    assert(restoredJE?.lines.length === 2, 'journalEntries lines preserved with 2 items');
    assert(restoredJE?.lines[0].accountCode === '1010', 'journal line accountCode relation preserved');

    await restoreTargetDb.delete();
  } finally {
    await testDb.delete();
  }

  console.log('\n========================================================');
  console.log(`BACKUP RESTORE AUDIT TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testBackupRestoreAudit.ts') || process.argv[1]?.endsWith('testBackupRestoreAudit.js')) {
  runBackupRestoreAuditTests().then((res) => {
    if (res.failed > 0) process.exit(1);
    process.exit(0);
  });
}
