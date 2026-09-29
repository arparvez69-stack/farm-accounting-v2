import 'fake-indexeddb/auto';
import { AgroDatabase } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { generateTrialBalance } from '../accounting/accountingEngine';
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
 * PROMPT 07 — CORRUPTED BACKUP + SAFE REJECTION
 * FINAL RELEASE TASK 07 — CORRUPTED BACKUP SAFETY
 *
 * Rigorously tests that every form of corrupted, malformed, truncated, or incompatible backup
 * is safely rejected BEFORE destructive replacement occurs, guaranteeing:
 * 1. Invalid backup is rejected with clear failure message (success: false).
 * 2. No destructive replacement occurs.
 * 3. Existing valid data remains 100% intact.
 * 4. No partial restore occurs.
 * 5. No false success is reported.
 * 6. Isolated test data is cleanly purged after the drill.
 */
export async function runCorruptedBackupSafeRejectionTests(): Promise<AssertionResult> {
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
      console.log(`  ✅ [PASS] ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`  ❌ [FAIL] ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
  }

  console.log('================================================================');
  console.log('STARTING PROMPT 07: CORRUPTED BACKUP + SAFE REJECTION AUDIT');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // 1. Setup Isolated Test Database & Baseline Data
  // --------------------------------------------------------------------------
  const isolatedDbName = `AgroCorruptedBackupTestDb_${Date.now()}`;
  console.log(`\n--- 1. Initializing Isolated Database: ${isolatedDbName} ---`);
  const testDb = new AgroDatabase(isolatedDbName);
  await testDb.open();
  await Promise.all(testDb.tables.map((t) => t.clear()));

  // Seed baseline systemConfig
  await testDb.systemConfig.put({
    ownerUid: 'usr_valid_baseline_owner',
    companyName: 'অক্ষত এগ্রো ফার্ম লিমিটেড',
    phone: '01711223344',
    currency: 'BDT',
    initializedAt: '2026-01-01T00:00:00.000Z',
    synced: true
  } as any);

  // Seed baseline accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await testDb.accounts.put(acc);
  }

  // Seed baseline cash/bank
  await testDb.cashBankAccounts.bulkPut([
    {
      id: 'cba_base_cash_01',
      name: 'প্রধান ক্যাশ ড্রয়ার',
      accountType: 'CASH',
      currentBalance: 50000,
      isActive: true,
      synced: true
    },
    {
      id: 'cba_base_bank_01',
      name: 'সোনালী ব্যাংক চলতি হিসাব',
      accountType: 'BANK',
      currentBalance: 200000,
      isActive: true,
      synced: true
    }
  ] as any);

  // Seed baseline parties
  await testDb.parties.bulkPut([
    {
      id: 'pty_base_cust_01',
      type: 'CUSTOMER',
      name: 'বিশ্বস্ত গ্রাহক ট্রেডার্স',
      phone: '01811998877',
      balance: 15000,
      synced: true
    },
    {
      id: 'pty_base_supp_01',
      type: 'SUPPLIER',
      name: 'মানসম্মত ফিড সরবরাহকারী',
      phone: '01911445566',
      balance: 25000,
      synced: true
    }
  ] as any);

  // Seed baseline animals
  await testDb.animals.put({
    id: 'anim_base_goat_01',
    tag: 'TAG-BASE-GT01',
    species: 'GOAT',
    breed: 'Black Bengal',
    status: 'ACTIVE',
    purchaseCost: 8000,
    totalCost: 10000,
    synced: true
  } as any);

  // Seed baseline fixed assets
  await testDb.fixedAssets.put({
    id: 'fa_base_tractor_01',
    name: 'মিনি ট্রাক্টর',
    category: 'MACHINERY',
    originalCost: 150000,
    purchaseDate: '2026-01-01',
    usefulLifeYears: 5,
    salvageValue: 20000,
    currentBookValue: 150000,
    accumulatedDepreciation: 0,
    synced: true
  } as any);

  // Seed baseline loans
  await testDb.loans.put({
    id: 'ln_base_01',
    loanNumber: 'LN-BASE-001',
    lenderName: 'বাংলাদেশ কৃষি ব্যাংক',
    loanType: 'BANK',
    principalAmount: 50000,
    interestRateAnnual: 0,
    annualInterestRatePercent: 0,
    remainingPrincipal: 50000,
    status: 'ACTIVE',
    synced: true
  } as any);

  // Seed baseline journal entries (balanced)
  await testDb.journalEntries.bulkPut([
    {
      id: 'je_base_001',
      voucherNumber: 'JV-BASE-001',
      voucherType: 'RECEIPT',
      date: '2026-01-01',
      narration: 'প্রাথমিক মূলধন জমা',
      lines: [
        { id: 'l1', accountCode: '1030', accountName: 'Sonali Bank', debit: 200000, credit: 0 },
        { id: 'l2', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 200000 }
      ],
      synced: true,
      createdAt: '2026-01-01T10:00:00.000Z'
    },
    {
      id: 'je_base_002',
      voucherNumber: 'JV-BASE-002',
      voucherType: 'RECEIPT',
      date: '2026-01-02',
      narration: 'নগদ ক্যাশ ফান্ড',
      lines: [
        { id: 'l3', accountCode: '1010', accountName: 'Cash', debit: 50000, credit: 0 },
        { id: 'l4', accountCode: '3010', accountName: 'Owner Capital', debit: 0, credit: 50000 }
      ],
      synced: true,
      createdAt: '2026-01-02T10:00:00.000Z'
    }
  ] as any);

  // Capture baseline fingerprints
  const baselineCounts: Record<string, number> = {};
  for (const t of testDb.tables) {
    baselineCounts[t.name] = await t.count();
  }

  const baselineTB = await generateTrialBalance(undefined, testDb);
  assert(baselineTB.isBalanced, 'Baseline Trial Balance is strictly balanced');
  assert(baselineTB.difference === 0, 'Baseline Trial Balance discrepancy is 0');
  const baselineDebitTotal = baselineTB.totalDebit;
  const baselineCreditTotal = baselineTB.totalCredit;

  // Helper to strictly assert database was untouched by corrupted restore attempt
  async function assertDatabaseUntouched(scenario: string) {
    // 1. Verify every table count is exactly identical
    for (const t of testDb.tables) {
      const currentCount = await t.count();
      assert(
        currentCount === baselineCounts[t.name],
        `[${scenario}] Table "${t.name}" count untouched (${currentCount} === ${baselineCounts[t.name]})`
      );
    }

    // 2. Verify key entities and attributes
    const config = await testDb.systemConfig.get('usr_valid_baseline_owner');
    assert(config?.companyName === 'অক্ষত এগ্রো ফার্ম লিমিটেড', `[${scenario}] systemConfig company name untouched`);

    const cashAcc = await testDb.cashBankAccounts.get('cba_base_cash_01');
    assert(cashAcc?.currentBalance === 50000, `[${scenario}] Cash account balance untouched`);

    const anim = await testDb.animals.get('anim_base_goat_01');
    assert(anim?.tag === 'TAG-BASE-GT01', `[${scenario}] Animal record untouched`);

    const fa = await testDb.fixedAssets.get('fa_base_tractor_01');
    assert(fa?.originalCost === 150000, `[${scenario}] Fixed asset untouched`);

    const ln = await testDb.loans.get('ln_base_01');
    assert(ln?.principalAmount === 50000, `[${scenario}] Loan record untouched`);

    const je1 = await testDb.journalEntries.get('je_base_001');
    assert(je1?.voucherNumber === 'JV-BASE-001', `[${scenario}] Journal entry JV-BASE-001 untouched`);

    // 3. Verify Trial Balance remains completely balanced with identical totals
    const currentTB = await generateTrialBalance(undefined, testDb);
    assert(currentTB.isBalanced, `[${scenario}] Trial Balance still balances`);
    assert(currentTB.difference === 0, `[${scenario}] Trial Balance difference is 0`);
    assert(currentTB.totalDebit === baselineDebitTotal, `[${scenario}] TB totalDebit (৳${currentTB.totalDebit}) equals baseline`);
    assert(currentTB.totalCredit === baselineCreditTotal, `[${scenario}] TB totalCredit (৳${currentTB.totalCredit}) equals baseline`);
  }

  // --------------------------------------------------------------------------
  // 2. Create a Valid Base Backup to Mutate
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Creating Valid Base Backup ---');
  const validBackupStr = await createFullJsonBackup(testDb);
  assert(typeof validBackupStr === 'string' && validBackupStr.length > 200, 'Valid base backup generated');
  const validBaseObj = JSON.parse(validBackupStr);

  // --------------------------------------------------------------------------
  // TEST SUITE 1: MALFORMED JSON SYNTAX
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 1: Malformed JSON Syntax Rejection ---');

  // 1.1 Unclosed curly brace / syntax error
  const syntaxErr1 = '{ "version": "1.0.0", "timestamp": "2026-09-28", "accounts": [';
  const res1_1 = await restoreFromJsonBackup(syntaxErr1, 'auditor', testDb);
  assert(res1_1.success === false, '1.1 Unclosed JSON syntax rejected');
  assert(res1_1.message.includes('Malformed JSON') || res1_1.message.includes('অবৈধ'), '1.1 Clear error message for malformed JSON syntax');
  await assertDatabaseUntouched('1.1 Unclosed JSON syntax');

  // 1.2 Unquoted keys and tokens
  const syntaxErr2 = '{ version: 1.0.0, timestamp: 2026-09-28, animals: [ { id: "a1" } ] }';
  const res1_2 = await restoreFromJsonBackup(syntaxErr2, 'auditor', testDb);
  assert(res1_2.success === false, '1.2 Unquoted keys JSON syntax rejected');
  await assertDatabaseUntouched('1.2 Unquoted keys JSON syntax');

  // 1.3 Trailing garbage after valid JSON
  const syntaxErr3 = validBackupStr + '\n<<<<CORRUPTED_DISK_SECTOR>>>>';
  const res1_3 = await restoreFromJsonBackup(syntaxErr3, 'auditor', testDb);
  assert(res1_3.success === false, '1.3 JSON with trailing garbage rejected');
  await assertDatabaseUntouched('1.3 JSON with trailing garbage');

  // --------------------------------------------------------------------------
  // TEST SUITE 2: TRUNCATED BACKUP (INTERRUPTED DOWNLOAD / WRITE)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Truncated Backup Rejection ---');

  // 2.1 File sliced in half (50% transmission loss)
  const truncatedHalf = validBackupStr.slice(0, Math.floor(validBackupStr.length / 2));
  const res2_1 = await restoreFromJsonBackup(truncatedHalf, 'auditor', testDb);
  assert(res2_1.success === false, '2.1 Truncated 50% backup rejected');
  assert(res2_1.message.length > 5, '2.1 Non-empty failure message for truncated backup');
  await assertDatabaseUntouched('2.1 Halfway truncated backup');

  // 2.2 Sliced at 90% (cut off in middle of journal lines)
  const truncated90 = validBackupStr.slice(0, Math.floor(validBackupStr.length * 0.9));
  const res2_2 = await restoreFromJsonBackup(truncated90, 'auditor', testDb);
  assert(res2_2.success === false, '2.2 Truncated 90% backup rejected');
  await assertDatabaseUntouched('2.2 90% truncated backup');

  // --------------------------------------------------------------------------
  // TEST SUITE 3: MISSING OR CORRUPTED MANIFEST
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Missing or Corrupted Manifest Rejection ---');

  // 3.1 Missing manifest, metadata, and expectedTables
  const missingManifestObj = { ...validBaseObj };
  delete missingManifestObj.manifest;
  delete missingManifestObj.metadata;
  delete missingManifestObj.expectedTables;
  const res3_1 = await restoreFromJsonBackup(JSON.stringify(missingManifestObj), 'auditor', testDb);
  assert(res3_1.success === false, '3.1 Missing manifest block rejected');
  assert(res3_1.message.includes('manifest') || res3_1.message.includes('metadata') || res3_1.message.includes('Incomplete backup'), '3.1 Error message specifies missing manifest');
  await assertDatabaseUntouched('3.1 Missing manifest block');

  // 3.2 Corrupted manifest: string instead of object
  const corruptManifestStrObj = { ...validBaseObj, manifest: 'INVALID_STRING_MANIFEST' };
  delete corruptManifestStrObj.metadata;
  delete corruptManifestStrObj.expectedTables;
  const res3_2 = await restoreFromJsonBackup(JSON.stringify(corruptManifestStrObj), 'auditor', testDb);
  assert(res3_2.success === false, '3.2 Corrupted string manifest rejected');
  await assertDatabaseUntouched('3.2 Corrupted string manifest');

  // 3.3 Corrupted manifest: array instead of object
  const corruptManifestArrObj = { ...validBaseObj, manifest: ['table1', 'table2'] };
  delete corruptManifestArrObj.metadata;
  delete corruptManifestArrObj.expectedTables;
  const res3_3 = await restoreFromJsonBackup(JSON.stringify(corruptManifestArrObj), 'auditor', testDb);
  assert(res3_3.success === false, '3.3 Corrupted array manifest rejected');
  await assertDatabaseUntouched('3.3 Corrupted array manifest');

  // --------------------------------------------------------------------------
  // TEST SUITE 4: INCOMPATIBLE SCHEMA VERSION
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Incompatible Schema Version Rejection ---');

  // 4.1 Incompatible future schema version (e.g. 99 > current 12)
  const futureSchemaObj = { ...validBaseObj, schemaVersion: 99 };
  if (futureSchemaObj.manifest) futureSchemaObj.manifest.schemaVersion = 99;
  if (futureSchemaObj.metadata) futureSchemaObj.metadata.schemaVersion = 99;
  const res4_1 = await restoreFromJsonBackup(JSON.stringify(futureSchemaObj), 'auditor', testDb);
  assert(res4_1.success === false, '4.1 Incompatible future schema version 99 rejected');
  assert(res4_1.message.includes('future schema') || res4_1.message.includes('অসামঞ্জস্যপূর্ণ'), '4.1 Error message flags incompatible future schema');
  await assertDatabaseUntouched('4.1 Incompatible future schema version');

  // 4.2 Negative schema version
  const negSchemaObj = { ...validBaseObj, schemaVersion: -5 };
  const res4_2 = await restoreFromJsonBackup(JSON.stringify(negSchemaObj), 'auditor', testDb);
  assert(res4_2.success === false, '4.2 Negative schema version -5 rejected');
  await assertDatabaseUntouched('4.2 Negative schema version');

  // 4.3 Incompatible root major version "2.0.0"
  const incompMajorVerObj = { ...validBaseObj, version: '2.0.0' };
  const res4_3 = await restoreFromJsonBackup(JSON.stringify(incompMajorVerObj), 'auditor', testDb);
  assert(res4_3.success === false, '4.3 Incompatible major version "2.0.0" rejected');
  assert(res4_3.message.includes('Incompatible backup version') || res4_3.message.includes('অসামঞ্জস্যপূর্ণ'), '4.3 Error message identifies version mismatch');
  await assertDatabaseUntouched('4.3 Incompatible major version');

  // 4.4 Non-semver version "v_beta_test"
  const nonSemverObj = { ...validBaseObj, version: 'v_beta_test' };
  const res4_4 = await restoreFromJsonBackup(JSON.stringify(nonSemverObj), 'auditor', testDb);
  assert(res4_4.success === false, '4.4 Non-semver version rejected');
  await assertDatabaseUntouched('4.4 Non-semver version');

  // --------------------------------------------------------------------------
  // TEST SUITE 5: MISSING REQUIRED TABLE / COLLECTION
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Missing Required Table / Collection Rejection ---');

  // 5.1 Missing journalEntries
  const missingJEObj = { ...validBaseObj };
  delete missingJEObj.journalEntries;
  const res5_1 = await restoreFromJsonBackup(JSON.stringify(missingJEObj), 'auditor', testDb);
  assert(res5_1.success === false, '5.1 Missing "journalEntries" table rejected');
  assert(res5_1.message.includes('journalEntries'), '5.1 Failure message names missing table "journalEntries"');
  await assertDatabaseUntouched('5.1 Missing journalEntries table');

  // 5.2 Missing accounts
  const missingAccObj = { ...validBaseObj };
  delete missingAccObj.accounts;
  const res5_2 = await restoreFromJsonBackup(JSON.stringify(missingAccObj), 'auditor', testDb);
  assert(res5_2.success === false, '5.2 Missing "accounts" table rejected');
  assert(res5_2.message.includes('accounts'), '5.2 Failure message names missing table "accounts"');
  await assertDatabaseUntouched('5.2 Missing accounts table');

  // 5.3 Missing sales and salesInvoices
  const missingSalesObj = { ...validBaseObj };
  delete missingSalesObj.sales;
  delete missingSalesObj.salesInvoices;
  const res5_3 = await restoreFromJsonBackup(JSON.stringify(missingSalesObj), 'auditor', testDb);
  assert(res5_3.success === false, '5.3 Missing "sales" table rejected');
  assert(res5_3.message.includes('sales'), '5.3 Failure message names missing table "sales"');
  await assertDatabaseUntouched('5.3 Missing sales table');

  // 5.4 Missing purchases and purchaseInvoices
  const missingPurchasesObj = { ...validBaseObj };
  delete missingPurchasesObj.purchases;
  delete missingPurchasesObj.purchaseInvoices;
  const res5_4 = await restoreFromJsonBackup(JSON.stringify(missingPurchasesObj), 'auditor', testDb);
  assert(res5_4.success === false, '5.4 Missing "purchases" table rejected');
  assert(res5_4.message.includes('purchases'), '5.4 Failure message names missing table "purchases"');
  await assertDatabaseUntouched('5.4 Missing purchases table');

  // 5.5 Missing cashBankAccounts and bankAccounts
  const missingCbaObj = { ...validBaseObj };
  delete missingCbaObj.cashBankAccounts;
  delete missingCbaObj.bankAccounts;
  const res5_5 = await restoreFromJsonBackup(JSON.stringify(missingCbaObj), 'auditor', testDb);
  assert(res5_5.success === false, '5.5 Missing "cashBankAccounts" table rejected');
  assert(res5_5.message.includes('cashBankAccounts'), '5.5 Failure message names missing table "cashBankAccounts"');
  await assertDatabaseUntouched('5.5 Missing cashBankAccounts table');

  // 5.6 Missing loans
  const missingLoansObj = { ...validBaseObj };
  delete missingLoansObj.loans;
  const res5_6 = await restoreFromJsonBackup(JSON.stringify(missingLoansObj), 'auditor', testDb);
  assert(res5_6.success === false, '5.6 Missing "loans" table rejected');
  assert(res5_6.message.includes('loans'), '5.6 Failure message names missing table "loans"');
  await assertDatabaseUntouched('5.6 Missing loans table');

  // 5.7 Missing systemConfig (and no system alias)
  const missingSysObj = { ...validBaseObj };
  delete missingSysObj.systemConfig;
  delete missingSysObj.system;
  const res5_7 = await restoreFromJsonBackup(JSON.stringify(missingSysObj), 'auditor', testDb);
  assert(res5_7.success === false, '5.7 Missing "systemConfig" table rejected');
  assert(res5_7.message.includes('systemConfig'), '5.7 Failure message names missing table "systemConfig"');
  await assertDatabaseUntouched('5.7 Missing systemConfig table');

  // 5.8 Table present in manifest expectedTables but missing from payload
  const tableOmittedObj = { ...validBaseObj };
  tableOmittedObj.expectedTables = [...(tableOmittedObj.expectedTables || []), 'customSensorData'];
  tableOmittedObj.recordCounts = { ...(tableOmittedObj.recordCounts || {}), customSensorData: 0 };
  const res5_8 = await restoreFromJsonBackup(JSON.stringify(tableOmittedObj), 'auditor', testDb);
  assert(res5_8.success === false, '5.8 Table in manifest expectedTables omitted from payload rejected');
  assert(res5_8.message.includes('customSensorData'), '5.8 Failure message specifies omitted table name');
  await assertDatabaseUntouched('5.8 Manifest table omitted from payload');

  // --------------------------------------------------------------------------
  // TEST SUITE 6: INVALID RECORD STRUCTURE
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Invalid Record Structure Rejection ---');

  // 6.1 Table is corrupted primitive string instead of array
  const strTableObj = { ...validBaseObj, animals: 'CORRUPTED_STRING_NOT_ARRAY' };
  const res6_1 = await restoreFromJsonBackup(JSON.stringify(strTableObj), 'auditor', testDb);
  assert(res6_1.success === false, '6.1 Table data as string instead of array rejected');
  assert(res6_1.message.includes('animals'), '6.1 Failure message names corrupted table "animals"');
  await assertDatabaseUntouched('6.1 String table data');

  // 6.2 Table contains null item
  const nullItemObj = { ...validBaseObj, animals: [null] };
  const res6_2 = await restoreFromJsonBackup(JSON.stringify(nullItemObj), 'auditor', testDb);
  assert(res6_2.success === false, '6.2 Table containing null record rejected');
  await assertDatabaseUntouched('6.2 Null record in table');

  // 6.3 Table contains primitive number
  const numItemObj = { ...validBaseObj, animals: [99999] };
  const res6_3 = await restoreFromJsonBackup(JSON.stringify(numItemObj), 'auditor', testDb);
  assert(res6_3.success === false, '6.3 Table containing primitive number rejected');
  await assertDatabaseUntouched('6.3 Primitive number in table');

  // 6.4 Record missing string primary key 'id'
  const missingKeyObj = {
    ...validBaseObj,
    parties: [{ name: 'Customer without primary key ID', type: 'CUSTOMER' }]
  };
  const res6_4 = await restoreFromJsonBackup(JSON.stringify(missingKeyObj), 'auditor', testDb);
  assert(res6_4.success === false, '6.4 Record missing string primary key "id" rejected');
  assert(res6_4.message.includes('primary key') || res6_4.message.includes('id'), '6.4 Failure message identifies missing primary key');
  await assertDatabaseUntouched('6.4 Missing primary key id');

  // 6.5 Record with empty/whitespace string 'id'
  const emptyKeyObj = {
    ...validBaseObj,
    animals: [{ id: '   ', tag: 'GT-EMPTY-KEY', species: 'GOAT' }]
  };
  const res6_5 = await restoreFromJsonBackup(JSON.stringify(emptyKeyObj), 'auditor', testDb);
  assert(res6_5.success === false, '6.5 Record with whitespace primary key "id" rejected');
  await assertDatabaseUntouched('6.5 Whitespace primary key id');

  // 6.6 systemConfig record missing ownerUid and id
  const badSysRecObj = {
    ...validBaseObj,
    systemConfig: [{ farmName: 'Missing Owner Key Farm' }]
  };
  const res6_6 = await restoreFromJsonBackup(JSON.stringify(badSysRecObj), 'auditor', testDb);
  assert(res6_6.success === false, '6.6 systemConfig record missing ownerUid/id rejected');
  await assertDatabaseUntouched('6.6 Bad systemConfig record');

  // 6.7 Account record missing 'code'
  const missingCodeObj = {
    ...validBaseObj,
    accounts: [{ id: 'acc_no_code', nameEn: 'Account Missing Code', accountClass: 'ASSET' }]
  };
  const res6_7 = await restoreFromJsonBackup(JSON.stringify(missingCodeObj), 'auditor', testDb);
  assert(res6_7.success === false, '6.7 Account record missing "code" rejected');
  assert(res6_7.message.includes('account code') || res6_7.message.includes('code'), '6.7 Failure message identifies missing code');
  await assertDatabaseUntouched('6.7 Account missing code');

  // 6.8 Journal entry missing 'lines' array
  const missingLinesObj = {
    ...validBaseObj,
    journalEntries: [{ id: 'je_no_lines', voucherNumber: 'JV-NOLINES', date: '2026-01-01', lines: 'string_not_array' }]
  };
  const res6_8 = await restoreFromJsonBackup(JSON.stringify(missingLinesObj), 'auditor', testDb);
  assert(res6_8.success === false, '6.8 Journal entry with non-array lines rejected');
  assert(res6_8.message.includes('lines'), '6.8 Failure message specifies lines array issue');
  await assertDatabaseUntouched('6.8 Journal entry missing lines');

  // 6.9 Journal entry with empty lines array
  const emptyLinesObj = {
    ...validBaseObj,
    journalEntries: [{ id: 'je_empty_lines', voucherNumber: 'JV-EMPTYLINES', date: '2026-01-01', lines: [] }]
  };
  const res6_9 = await restoreFromJsonBackup(JSON.stringify(emptyLinesObj), 'auditor', testDb);
  assert(res6_9.success === false, '6.9 Journal entry with empty lines array rejected');
  await assertDatabaseUntouched('6.9 Journal entry with empty lines array');

  // 6.10 Journal entry with UNBALANCED debits and credits
  const unbalancedJeObj = {
    ...validBaseObj,
    journalEntries: [
      {
        id: 'je_unbalanced_01',
        voucherNumber: 'JV-UNBALANCED',
        date: '2026-01-01',
        lines: [
          { accountCode: '1010', debit: 50000, credit: 0 },
          { accountCode: '3010', debit: 0, credit: 40000 } // Unbalanced by 10,000!
        ]
      }
    ]
  };
  const res6_10 = await restoreFromJsonBackup(JSON.stringify(unbalancedJeObj), 'auditor', testDb);
  assert(res6_10.success === false, '6.10 Journal entry with unbalanced lines rejected');
  assert(res6_10.message.includes('unbalanced') || res6_10.message.includes('Debit=') || res6_10.message.includes('বিকৃত'), '6.10 Failure message identifies unbalanced journal entry');
  await assertDatabaseUntouched('6.10 Unbalanced journal entry');

  // 6.11 Journal line with negative debit amount
  const negDebitJeObj = {
    ...validBaseObj,
    journalEntries: [
      {
        id: 'je_neg_debit',
        voucherNumber: 'JV-NEG',
        date: '2026-01-01',
        lines: [
          { accountCode: '1010', debit: -1000, credit: 0 },
          { accountCode: '3010', debit: 0, credit: -1000 }
        ]
      }
    ]
  };
  const res6_11 = await restoreFromJsonBackup(JSON.stringify(negDebitJeObj), 'auditor', testDb);
  assert(res6_11.success === false, '6.11 Journal entry with negative debit/credit amounts rejected');
  await assertDatabaseUntouched('6.11 Negative debit/credit in journal');

  // 6.12 Journal line missing accountCode
  const missingAccCodeJeObj = {
    ...validBaseObj,
    journalEntries: [
      {
        id: 'je_no_acc_code',
        voucherNumber: 'JV-NO-ACC',
        date: '2026-01-01',
        lines: [
          { debit: 1000, credit: 0 }, // missing accountCode
          { accountCode: '3010', debit: 0, credit: 1000 }
        ]
      }
    ]
  };
  const res6_12 = await restoreFromJsonBackup(JSON.stringify(missingAccCodeJeObj), 'auditor', testDb);
  assert(res6_12.success === false, '6.12 Journal entry line missing accountCode rejected');
  await assertDatabaseUntouched('6.12 Missing accountCode in journal line');

  // --------------------------------------------------------------------------
  // TEST SUITE 7: INCONSISTENT DATASET VS MANIFEST (TRUNCATION / COUNT MISMATCH)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Dataset vs Manifest Count Mismatch Rejection ---');

  // 7.1 Manifest says accounts has 62 records, but array is truncated to 5 records
  const truncatedAccObj = { ...validBaseObj };
  assert(truncatedAccObj.recordCounts.accounts >= 60, 'Valid base accounts has >= 60 records');
  truncatedAccObj.accounts = truncatedAccObj.accounts.slice(0, 5); // truncated to 5!
  const res7_1 = await restoreFromJsonBackup(JSON.stringify(truncatedAccObj), 'auditor', testDb);
  assert(res7_1.success === false, '7.1 Dataset truncated relative to manifest count rejected');
  assert(res7_1.message.includes('accounts') && (res7_1.message.includes('expected') || res7_1.message.includes('অসম্পূর্ণ')), '7.1 Failure message highlights count mismatch');
  await assertDatabaseUntouched('7.1 Truncated table relative to manifest count');

  // 7.2 Manifest contains negative count (-10)
  const negCountManifestObj = { ...validBaseObj };
  negCountManifestObj.recordCounts = { ...negCountManifestObj.recordCounts, animals: -10 };
  const res7_2 = await restoreFromJsonBackup(JSON.stringify(negCountManifestObj), 'auditor', testDb);
  assert(res7_2.success === false, '7.2 Negative record count in manifest rejected');
  await assertDatabaseUntouched('7.2 Negative count in manifest');

  // --------------------------------------------------------------------------
  // TEST SUITE 8: NON-OBJECT / PRIMITIVE / EMPTY ROOT
  // --------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Non-Object / Primitive / Empty Root Rejection ---');

  // 8.1 Empty string
  const res8_1 = await restoreFromJsonBackup('', 'auditor', testDb);
  assert(res8_1.success === false, '8.1 Empty string rejected');
  await assertDatabaseUntouched('8.1 Empty string');

  // 8.2 Null JSON root
  const res8_2 = await restoreFromJsonBackup('null', 'auditor', testDb);
  assert(res8_2.success === false, '8.2 Null root rejected');
  await assertDatabaseUntouched('8.2 Null root');

  // 8.3 Primitive number root
  const res8_3 = await restoreFromJsonBackup('987654321', 'auditor', testDb);
  assert(res8_3.success === false, '8.3 Primitive number root rejected');
  await assertDatabaseUntouched('8.3 Primitive number root');

  // 8.4 Array root
  const res8_4 = await restoreFromJsonBackup('[{"version":"1.0.0"}]', 'auditor', testDb);
  assert(res8_4.success === false, '8.4 Array root rejected');
  await assertDatabaseUntouched('8.4 Array root');

  // --------------------------------------------------------------------------
  // 9. Clean Up Isolated Test Database
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Cleaning Up Isolated Test Database ---');
  await testDb.delete();
  console.log(`  Isolated test database "${isolatedDbName}" deleted completely. Zero persistent artifacts remain.`);

  console.log('\n================================================================');
  console.log(`ALL CORRUPTED BACKUP SAFE REJECTION CHECKS PASSED! (${result.passed}/${result.total}) 🎉`);
  console.log('================================================================');

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testCorruptedBackupSafeRejection')) {
  runCorruptedBackupSafeRejectionTests()
    .then((r) => process.exit(r.failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error('Corrupted backup safety drill failed:', err);
      process.exit(1);
    });
}
