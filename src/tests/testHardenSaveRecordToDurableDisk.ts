import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  saveRecordToDurableDisk,
  setDurableStorageFileForTest,
  setSimulateWriteInterruptionForTest,
  getEffectiveDurableStorageFile
} from '../../server';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runHardenSaveRecordToDurableDiskTests(): Promise<AssertionResult> {
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
  console.log('TEST SUITE: HARDEN saveRecordToDurableDisk()');
  console.log('Testing Fail-Closed on Malformed JSON, Interrupted Writes, & Concurrent Updates');
  console.log('========================================================\n');

  // Verify real live durable file is preserved
  const realStorageFile = path.join(process.cwd(), 'data', 'durable_cloud_storage.json');
  const realFileExistedBefore = fs.existsSync(realStorageFile);
  const realFileSizeBefore = realFileExistedBefore ? fs.statSync(realStorageFile).size : 0;

  // Set up isolated temporary test environment
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goated-durable-test-'));
  const testStorageFile = path.join(testDir, 'test_durable_storage.json');

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: CRITICAL FAIL-CLOSED ON MALFORMED JSON
    // If existing durable JSON cannot be parsed, fail closed.
    // Never replace it with an empty object or overwrite with partial data.
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Malformed JSON Truncation & Fail-Closed Protection ---');
    setDurableStorageFileForTest(testStorageFile);
    setSimulateWriteInterruptionForTest(false);

    const malformedContent = '{\n  "animals": {\n    "cow_01": {\n      "name": "Brahma",\n      "tag"'; // Truncated / malformed JSON
    fs.writeFileSync(testStorageFile, malformedContent, 'utf-8');

    let errorThrown = false;
    let errorMessage = '';
    try {
      saveRecordToDurableDisk('animals', 'cow_02', { name: 'Red Chittagong', tag: 'RC-02' });
    } catch (err: any) {
      errorThrown = true;
      errorMessage = err.message;
    }

    assert(errorThrown, 'saveRecordToDurableDisk must throw an error when existing durable JSON is malformed');
    assert(
      errorMessage.includes('CRITICAL') && errorMessage.includes('cannot be parsed'),
      `Error message must indicate critical unparseable JSON fail-closed failure: "${errorMessage}"`
    );

    // Verify the file was NOT replaced with an empty object or overwritten with partial data
    const contentAfterFailure = fs.readFileSync(testStorageFile, 'utf-8');
    assert(
      contentAfterFailure === malformedContent,
      'Existing malformed file must be preserved byte-for-byte and NEVER replaced with {} or partial data'
    );

    // -------------------------------------------------------------
    // SCENARIO 2: FAIL-CLOSED ON INVALID ROOT STRUCTURE (NON-OBJECT)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Invalid Root Structure (Array or Primitive) ---');
    fs.writeFileSync(testStorageFile, JSON.stringify(['not', 'an', 'object']), 'utf-8');

    let nonObjErrorThrown = false;
    try {
      saveRecordToDurableDisk('animals', 'cow_03', { name: 'Sahiwal' });
    } catch {
      nonObjErrorThrown = true;
    }

    assert(nonObjErrorThrown, 'saveRecordToDurableDisk must fail closed if root structure is an Array instead of Object');
    const contentAfterArray = fs.readFileSync(testStorageFile, 'utf-8');
    assert(
      contentAfterArray.includes('not') && contentAfterArray.includes('object'),
      'File with array root must NOT be overwritten'
    );

    // Also test empty file (0 bytes)
    fs.writeFileSync(testStorageFile, '', 'utf-8');
    let emptyErrorThrown = false;
    try {
      saveRecordToDurableDisk('animals', 'cow_04', { name: 'Gir' });
    } catch {
      emptyErrorThrown = true;
    }
    assert(emptyErrorThrown, 'saveRecordToDurableDisk must fail closed on empty existing file');

    // -------------------------------------------------------------
    // SCENARIO 3: ATOMIC REPLACEMENT & INTERRUPTED WRITES PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Interrupted Writes & Atomic Replacement ---');
    // Start with a clean, valid file containing initial data
    const initialValidData = {
      farms: {
        farm_main: { name: 'The Goated Farm Main Campus', established: 2024 }
      },
      accounts: {
        '1010': { code: '1010', name: 'Cash in Hand', balance: 50000 }
      }
    };
    fs.writeFileSync(testStorageFile, JSON.stringify(initialValidData, null, 2), 'utf-8');

    // Simulate an interrupted write (e.g. disk write failure before atomic rename)
    setSimulateWriteInterruptionForTest(true);

    let interruptionErrorThrown = false;
    try {
      saveRecordToDurableDisk('animals', 'cow_new', { name: 'Attempted During Interruption' });
    } catch (err: any) {
      interruptionErrorThrown = true;
      assert(err.message === 'SIMULATED_DISK_WRITE_INTERRUPTION', 'Error must be simulated interruption');
    }

    assert(interruptionErrorThrown, 'saveRecordToDurableDisk threw during simulated interruption');

    // Verify existing file is completely intact with original data
    const fileAfterInterruption = fs.readFileSync(testStorageFile, 'utf-8');
    const parsedAfterInterruption = JSON.parse(fileAfterInterruption);
    assert(
      parsedAfterInterruption.farms?.farm_main?.name === 'The Goated Farm Main Campus',
      'Original farm data must be intact after interrupted write'
    );
    assert(
      parsedAfterInterruption.accounts?.['1010']?.balance === 50000,
      'Original accounts data must be intact after interrupted write'
    );
    assert(
      parsedAfterInterruption.animals === undefined,
      'Partial record from interrupted write must NEVER appear in durable storage'
    );

    // Check no temp files leaked in directory
    const dirFiles = fs.readdirSync(testDir);
    const tempFiles = dirFiles.filter((f) => f.includes('.tmp.'));
    assert(tempFiles.length === 0, `No temporary files leaked after interrupted write (found: ${tempFiles.length})`);

    // Reset interruption flag and verify clean write works
    setSimulateWriteInterruptionForTest(false);
    saveRecordToDurableDisk('animals', 'cow_valid', { name: 'Successful Cow', breed: 'Sindhi' });

    const updatedAfterResume = JSON.parse(fs.readFileSync(testStorageFile, 'utf-8'));
    assert(
      updatedAfterResume.animals?.cow_valid?.name === 'Successful Cow',
      'Normal atomic write succeeds after interruption is cleared'
    );
    assert(
      updatedAfterResume.farms?.farm_main?.name === 'The Goated Farm Main Campus',
      'Existing records are preserved along with the newly added record'
    );

    // -------------------------------------------------------------
    // SCENARIO 4: CONCURRENT WRITES & DATA LOSS PREVENTION
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Concurrent Updates Serialization & Zero Data Loss ---');
    // We will launch 25 concurrent async write tasks across 3 different collections
    const concurrentWritesCount = 25;
    const writePromises: Promise<void>[] = [];

    for (let i = 0; i < concurrentWritesCount; i++) {
      const col = i % 3 === 0 ? 'birds' : i % 3 === 1 ? 'feed_logs' : 'transactions';
      const docId = `rec_${i}`;
      const payload = {
        index: i,
        collection: col,
        timestamp: Date.now(),
        data: `payload_content_${i}_${Math.random().toString(36).substring(2, 7)}`
      };

      writePromises.push(
        new Promise<void>((resolve, reject) => {
          // Add random jitter between 1-15ms to induce concurrent interleaving
          setTimeout(() => {
            try {
              saveRecordToDurableDisk(col, docId, payload);
              resolve();
            } catch (err) {
              reject(err);
            }
          }, Math.floor(Math.random() * 15) + 1);
        })
      );
    }

    await Promise.all(writePromises);

    // Read final file and verify ALL 25 records are present without a single lost record
    const finalData = JSON.parse(fs.readFileSync(testStorageFile, 'utf-8'));

    let allConcurrentRecordsFound = true;
    const missingRecords: string[] = [];

    for (let i = 0; i < concurrentWritesCount; i++) {
      const col = i % 3 === 0 ? 'birds' : i % 3 === 1 ? 'feed_logs' : 'transactions';
      const docId = `rec_${i}`;
      const rec = finalData[col]?.[docId];
      if (!rec || rec.index !== i) {
        allConcurrentRecordsFound = false;
        missingRecords.push(`${col}/${docId}`);
      }
    }

    assert(
      allConcurrentRecordsFound,
      `All ${concurrentWritesCount} concurrent writes must be durably persisted without data loss (missing: ${missingRecords.length})`
    );

    // Verify previously written records are STILL intact
    assert(
      finalData.farms?.farm_main?.name === 'The Goated Farm Main Campus',
      'Initial farm records remain preserved after all concurrent updates'
    );
    assert(
      finalData.animals?.cow_valid?.breed === 'Sindhi',
      'Initial animal records remain preserved after all concurrent updates'
    );

    // Verify storage format is clean indented JSON
    const rawFinalText = fs.readFileSync(testStorageFile, 'utf-8');
    assert(rawFinalText.includes('{\n  "farms": {'), 'Storage format remains clean 2-space indented JSON');

    // -------------------------------------------------------------
    // SCENARIO 5: VERIFY LIVE DURABLE STORAGE FILE PRESERVATION
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Live Durable Storage File Safety ---');
    if (realFileExistedBefore) {
      const realFileSizeAfter = fs.statSync(realStorageFile).size;
      assert(
        realFileSizeAfter === realFileSizeBefore,
        `Live data file "${realStorageFile}" was safely untouched (before: ${realFileSizeBefore} bytes, after: ${realFileSizeAfter} bytes)`
      );
    } else {
      console.log('ℹ️ Live data file did not exist before test.');
    }
  } finally {
    // Reset test overrides and clean up temporary test files
    setDurableStorageFileForTest(null);
    setSimulateWriteInterruptionForTest(false);

    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n========================================================');
  console.log(`HARDEN saveRecordToDurableDisk() RESULTS:`);
  console.log(`Total: ${result.total} | Passed: ${result.passed} | Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

// Direct execution when invoked via CLI
if (process.argv[1]?.endsWith('testHardenSaveRecordToDurableDisk.ts')) {
  runHardenSaveRecordToDurableDiskTests().then((res) => {
    if (res.failed > 0) {
      console.error(`Tests finished with ${res.failed} failure(s).`);
      process.exit(1);
    } else {
      console.log('All tests passed successfully.');
      process.exit(0);
    }
  });
}
