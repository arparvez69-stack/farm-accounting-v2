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

export async function runStabilityTasks31_32_33Tests(): Promise<AssertionResult> {
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
  console.log('STABILITY TASKS 31, 32, 33 AUDIT SUITE');
  console.log('Task 31: Restore Validation Before Mutation');
  console.log('Task 32: Safe Restore Rollback on Failure');
  console.log('Task 33: Backup Version & Schema Compatibility');
  console.log('========================================================\n');

  const testDbName = `AgroStabilityDb_${Date.now()}`;
  const testDb = new AgroDatabase();
  (testDb as any).name = testDbName;
  await testDb.open();

  // Helper to populate baseline test data
  async function seedBaseline(db: AgroDatabase) {
    await db.systemConfig.put({
      ownerUid: 'owner_stab_01',
      companyName: 'Stability Test Agro',
      phone: '01711111111',
      currency: 'BDT',
      initializedAt: '2026-09-27T00:00:00.000Z',
      synced: true
    } as any);

    await db.accounts.bulkPut([
      { id: 'acc_1010', code: '1010', nameEn: 'Cash', accountClass: 'ASSET', normalBalance: 'DEBIT', isSystem: true },
      { id: 'acc_2010', code: '2010', nameEn: 'Payable', accountClass: 'LIABILITY', normalBalance: 'CREDIT', isSystem: true }
    ] as any);

    await db.animals.put({
      id: 'anim_stab_01',
      tag: 'STAB-01',
      species: 'GOAT',
      breed: 'Black Bengal',
      status: 'ACTIVE',
      synced: true
    } as any);

    await db.journalEntries.put({
      id: 'je_stab_01',
      voucherNumber: 'JV-STAB-01',
      voucherType: 'JOURNAL',
      date: '2026-09-27',
      lines: [
        { id: 'l1', accountCode: '1010', debit: 5000, credit: 0 },
        { id: 'l2', accountCode: '2010', debit: 0, credit: 5000 }
      ],
      synced: true
    } as any);
  }

  async function assertBaselineUntouched(db: AgroDatabase, context: string) {
    const config = await db.systemConfig.get('owner_stab_01');
    const accCount = await db.accounts.count();
    const animCount = await db.animals.count();
    const jeCount = await db.journalEntries.count();

    assert(config?.ownerUid === 'owner_stab_01', `[${context}] Baseline systemConfig preserved untouched`);
    assert(accCount === 2, `[${context}] Baseline accounts preserved untouched (count: ${accCount})`);
    assert(animCount === 1, `[${context}] Baseline animals preserved untouched (count: ${animCount})`);
    assert(jeCount === 1, `[${context}] Baseline journalEntries preserved untouched (count: ${jeCount})`);
  }

  try {
    await seedBaseline(testDb);
    const validBackupStr = await createFullJsonBackup(testDb);
    const validBackupObj = JSON.parse(validBackupStr);

    // =========================================================================
    // TASK 31: RESTORE VALIDATION BEFORE MUTATION
    // =========================================================================
    console.log('\n--- TASK 31: Validation Before Writing ---');

    // 31.1 Malformed JSON
    const malformedJsonRes = await restoreFromJsonBackup('{ "version": "1.0.0", incomplete...', 'user', testDb);
    assert(malformedJsonRes.success === false, 'Task 31: Malformed JSON is rejected');
    await assertBaselineUntouched(testDb, 'Malformed JSON');

    // 31.2 Missing Required Manifest
    const noManifestObj = { ...validBackupObj };
    delete noManifestObj.manifest;
    delete noManifestObj.metadata;
    delete noManifestObj.expectedTables;
    const noManifestRes = await restoreFromJsonBackup(JSON.stringify(noManifestObj), 'user', testDb);
    assert(noManifestRes.success === false, 'Task 31: Missing required manifest is rejected');
    assert(noManifestRes.message.includes('manifest') || noManifestRes.message.includes('Incomplete backup'), 'Task 31: Error message indicates missing manifest');
    await assertBaselineUntouched(testDb, 'Missing Required Manifest');

    // 31.3 Malformed Manifest (string instead of object)
    const badManifestObj = { ...validBackupObj, manifest: 'corrupted_string_manifest' };
    delete badManifestObj.metadata;
    delete badManifestObj.expectedTables;
    const badManifestRes = await restoreFromJsonBackup(JSON.stringify(badManifestObj), 'user', testDb);
    assert(badManifestRes.success === false, 'Task 31: Malformed string manifest is rejected');
    await assertBaselineUntouched(testDb, 'Malformed Manifest');

    // 31.4 Incompatible schema version
    const futureSchemaObj = { ...validBackupObj, schemaVersion: 99 };
    const futureSchemaRes = await restoreFromJsonBackup(JSON.stringify(futureSchemaObj), 'user', testDb);
    assert(futureSchemaRes.success === false, 'Task 31: Incompatible future schema version is rejected');
    assert(futureSchemaRes.message.includes('Incompatible future schema') || futureSchemaRes.message.includes('অসামঞ্জস্যপূর্ণ'), 'Task 31: Error indicates incompatible schema version');
    await assertBaselineUntouched(testDb, 'Incompatible schema');

    // 31.5 Invalid record collection (non-array in collection)
    const nonArrayColObj = { ...validBackupObj, accounts: { not: 'an array' } };
    const nonArrayRes = await restoreFromJsonBackup(JSON.stringify(nonArrayColObj), 'user', testDb);
    assert(nonArrayRes.success === false, 'Task 31: Non-array collection is rejected');
    await assertBaselineUntouched(testDb, 'Non-array collection');

    // 31.6 Invalid record with missing primary key
    const missingIdObj = {
      ...validBackupObj,
      animals: [{ species: 'COW', tag: 'NO-ID' }]
    };
    const missingIdRes = await restoreFromJsonBackup(JSON.stringify(missingIdObj), 'user', testDb);
    assert(missingIdRes.success === false, 'Task 31: Record missing primary key ID is rejected');
    await assertBaselineUntouched(testDb, 'Missing Primary Key');

    // 31.7 Obviously corrupted data: Unbalanced journal entry (debit != credit)
    const unbalancedJeObj = {
      ...validBackupObj,
      journalEntries: [
        {
          id: 'je_unbalanced_01',
          voucherNumber: 'JV-UNBALANCED',
          date: '2026-09-27',
          lines: [
            { accountCode: '1010', debit: 10000, credit: 0 },
            { accountCode: '2010', debit: 0, credit: 8000 } // 2000 mismatch!
          ]
        }
      ]
    };
    const unbalancedRes = await restoreFromJsonBackup(JSON.stringify(unbalancedJeObj), 'user', testDb);
    assert(unbalancedRes.success === false, 'Task 31: Unbalanced journal entry is rejected as corrupted data');
    assert(unbalancedRes.message.includes('unbalanced') || unbalancedRes.message.includes('lines are unbalanced'), 'Task 31: Error flags unbalanced lines');
    await assertBaselineUntouched(testDb, 'Unbalanced Journal Entry');

    // 31.8 Obviously corrupted data: Negative manifest count
    const negCountObj = {
      ...validBackupObj,
      manifest: {
        ...validBackupObj.manifest,
        recordCounts: { ...validBackupObj.recordCounts, animals: -5 }
      }
    };
    const negCountRes = await restoreFromJsonBackup(JSON.stringify(negCountObj), 'user', testDb);
    assert(negCountRes.success === false, 'Task 31: Negative count in manifest is rejected as corrupted data');
    await assertBaselineUntouched(testDb, 'Negative Manifest Count');

    // =========================================================================
    // TASK 32: SAFE RESTORE ROLLBACK
    // =========================================================================
    console.log('\n--- TASK 32: Safe Restore Rollback on Failure ---');

    // Create a target database with existing records
    const rollbackDbName = `AgroRollbackDb_${Date.now()}`;
    const rollbackDb = new AgroDatabase();
    (rollbackDb as any).name = rollbackDbName;
    await rollbackDb.open();
    await seedBaseline(rollbackDb);

    // Verify baseline records in rollbackDb
    const preRollbackAnimalsCount = await rollbackDb.animals.count();
    const preRollbackAccountsCount = await rollbackDb.accounts.count();
    assert(preRollbackAnimalsCount === 1, 'Pre-rollback animals count is 1');
    assert(preRollbackAccountsCount === 2, 'Pre-rollback accounts count is 2');

    // Prepare a mock database where an error is thrown AFTER mutation has started (e.g. at pond table)
    const failureTracker = { triggered: false };
    const originalPondsBulkPut = rollbackDb.ponds.bulkPut;
    const originalPondsClear = rollbackDb.ponds.clear;

    // Simulate disk/DB write failure on ponds table during restore
    (rollbackDb.ponds as any).clear = async () => {
      failureTracker.triggered = true;
      throw new Error('Simulated disk write failure on table "ponds" during restore execution');
    };

    // Attempt restore using valid backup
    const rollbackRes = await restoreFromJsonBackup(validBackupStr, 'user', rollbackDb);
    assert(rollbackRes.success === false, 'Task 32: Restore returns false when an error occurs during mutation');
    assert(failureTracker.triggered === true, 'Task 32: Simulated failure was triggered after mutation started');
    assert(rollbackRes.message.includes('পূর্বাবস্থায়') || rollbackRes.message.includes('স্বয়ংক্রিয়ভাবে'), 'Task 32: Response indicates automatic rollback was performed');

    // Restore original method
    (rollbackDb.ponds as any).clear = originalPondsClear;

    // Verify that rollback automatically restored all pre-restore records
    const postRollbackConfig = await rollbackDb.systemConfig.get('owner_stab_01');
    const postRollbackAnimals = await rollbackDb.animals.count();
    const postRollbackAccounts = await rollbackDb.accounts.count();
    const postRollbackJe = await rollbackDb.journalEntries.count();

    assert(postRollbackConfig?.ownerUid === 'owner_stab_01', 'Task 32: Pre-restore systemConfig restored intact');
    assert(postRollbackAnimals === 1, 'Task 32: Pre-restore animals restored intact (count: 1)');
    assert(postRollbackAccounts === 2, 'Task 32: Pre-restore accounts restored intact (count: 2)');
    assert(postRollbackJe === 1, 'Task 32: Pre-restore journalEntries restored intact (count: 1)');
    console.log('✅ Task 32 Passed: User was not left with a half-restored database; pre-restore snapshot was automatically restored.');

    await rollbackDb.delete();

    // =========================================================================
    // TASK 33: BACKUP VERSION & SCHEMA COMPATIBILITY
    // =========================================================================
    console.log('\n--- TASK 33: Backup Version & Schema Compatibility ---');

    // 33.1 Reject incompatible major version (e.g. 2.0.0)
    const incompMajorObj = { ...validBackupObj, version: '2.0.0' };
    const incompMajorRes = await restoreFromJsonBackup(JSON.stringify(incompMajorObj), 'user', testDb);
    assert(incompMajorRes.success === false, 'Task 33: Major version 2.0.0 is rejected clearly before mutation');
    assert(incompMajorRes.message.includes('Incompatible backup version') || incompMajorRes.message.includes('অসামঞ্জস্যপূর্ণ'), 'Task 33: Clear error message for incompatible major version');

    // 33.2 Safe migration of a known compatible older schema (e.g. schemaVersion 8)
    // In schema version 8, salesReturns, purchaseReturns, advancePayments did not exist yet.
    // They should be safely migrated as empty arrays [] without error.
    const olderSchemaObj = { ...validBackupObj, schemaVersion: 8 };
    if (olderSchemaObj.manifest) olderSchemaObj.manifest.schemaVersion = 8;
    if (olderSchemaObj.metadata) olderSchemaObj.metadata.schemaVersion = 8;
    // Delete tables that were introduced in later versions
    delete olderSchemaObj.salesReturns;
    delete olderSchemaObj.purchaseReturns;
    delete olderSchemaObj.advancePayments;

    const migrationTargetDbName = `AgroMigrateDb_${Date.now()}`;
    const migrationDb = new AgroDatabase();
    (migrationDb as any).name = migrationTargetDbName;
    await migrationDb.open();

    const olderSchemaRes = await restoreFromJsonBackup(JSON.stringify(olderSchemaObj), 'user', migrationDb);
    assert(olderSchemaRes.success === true, 'Task 33: Known compatible older schemaVersion 8 migrates safely');
    const migratedAccounts = await migrationDb.accounts.count();
    const migratedAnimals = await migrationDb.animals.count();
    const migratedReturns = await migrationDb.salesReturns.count();
    assert(migratedAccounts === 2, 'Task 33: Migrated accounts preserved accurately');
    assert(migratedAnimals === 1, 'Task 33: Migrated animals preserved accurately');
    assert(migratedReturns === 0, 'Task 33: Later-introduced table safely initialized as empty');

    // 33.3 Reject corrupted / incompatible data in older schema
    const corruptOlderObj = {
      ...olderSchemaObj,
      journalEntries: [
        {
          id: 'je_old_corrupt',
          voucherNumber: 'JV-OLD',
          date: '2026-09-27',
          lines: [{ accountCode: '1010', debit: 5000, credit: 1000 }] // Unbalanced!
        }
      ]
    };
    const corruptOlderRes = await restoreFromJsonBackup(JSON.stringify(corruptOlderObj), 'user', migrationDb);
    assert(corruptOlderRes.success === false, 'Task 33: Incompatible/corrupted data in older schema is rejected before mutation');
    assert(corruptOlderRes.message.includes('unbalanced') || corruptOlderRes.message.includes('lines are unbalanced'), 'Task 33: Error identifies unbalanced lines');

    await migrationDb.delete();
  } finally {
    await testDb.delete();
  }

  console.log('\n========================================================');
  console.log(`STABILITY TASKS 31, 32, 33 TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testStabilityTasks31_32_33.ts') || process.argv[1]?.endsWith('testStabilityTasks31_32_33.js')) {
  runStabilityTasks31_32_33Tests().then((res) => {
    if (res.failed > 0) process.exit(1);
    process.exit(0);
  });
}
