import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { restoreRemoteDataIfLocalEmpty } from '../firebase/firebaseClient';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runPartialLossCloudRestoreTests() {
  console.log('====================================================');
  console.log('STARTING C1: PARTIAL-LOSS CLOUD RESTORE DETECTION TESTS');
  console.log('====================================================');

  const testOwnerEmail = 'arparvez4@gmail.com';

  await db.delete();
  await db.open();

  // ----------------------------------------------------
  // SCENARIO 1: Completely empty local DB
  // ----------------------------------------------------
  console.log('\n--- Scenario 1: Completely Empty Local DB Full Restore ---');
  await Promise.all(db.tables.map((t) => t.clear()));

  const snapshot1: Record<string, any[]> = {
    animals: [
      { id: 'anim_01', tag: 'GT-01', species: 'GOAT', status: 'ACTIVE', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' },
      { id: 'anim_02', tag: 'GT-02', species: 'GOAT', status: 'ACTIVE', createdAt: '2026-09-02T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z' }
    ],
    sales: [
      { id: 'sale_01', invoiceNumber: 'INV-2026-001', totalAmount: 12000, date: '2026-09-10', createdAt: '2026-09-10T12:00:00Z', updatedAt: '2026-09-10T12:00:00Z' }
    ],
    journalEntries: [
      {
        id: 'jrn_01',
        voucherNumber: 'JRN-2026-001',
        voucherType: 'RECEIPT',
        date: '2026-09-10',
        lines: [
          { accountCode: '1010', accountName: 'Cash', debit: 12000, credit: 0 },
          { accountCode: '4020', accountName: 'Livestock Sales', debit: 0, credit: 12000 }
        ],
        createdAt: '2026-09-10T12:00:00Z',
        updatedAt: '2026-09-10T12:00:00Z'
      }
    ],
    accounts: [
      {
        id: 'acc_6199',
        code: '6199',
        nameBn: 'বিশেষ গবেষণা ও উন্নয়ন ব্যয়',
        nameEn: 'Special R&D Expense',
        accountClass: 'EXPENSE',
        normalBalance: 'DEBIT',
        createdAt: '2026-09-05T10:00:00Z',
        updatedAt: '2026-09-05T10:00:00Z'
      }
    ]
  };

  const res1 = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false, { mockRemoteCollections: snapshot1 });
  assert(res1.restored === true, 'Completely empty local DB must trigger restore (restored: true)');
  assert(res1.count === 5, `Expected 5 records restored, got ${res1.count}`);

  const anim1Count = await db.animals.count();
  const sales1Count = await db.sales.count();
  const jrn1Count = await db.journalEntries.count();
  const acc1 = await db.accounts.get('acc_6199');

  assert(anim1Count === 2, '2 animals restored');
  assert(sales1Count === 1, '1 sale restored');
  assert(jrn1Count === 1, '1 journal entry restored');
  assert(!!acc1 && acc1.code === '6199', 'Custom account 6199 restored');
  console.log('✅ Scenario 1 Passed: Completely empty local DB successfully restores all collections.');

  // ----------------------------------------------------
  // SCENARIO 2: One missing table (Partial Loss)
  // ----------------------------------------------------
  console.log('\n--- Scenario 2: One Missing Table (Partial Loss) ---');
  // Wipe ONLY journalEntries to simulate loss of a single table while other operational tables still have records
  await db.journalEntries.clear();
  const jrnCountBefore = await db.journalEntries.count();
  const animCountBefore = await db.animals.count();
  const salesCountBefore = await db.sales.count();

  assert(jrnCountBefore === 0, 'journalEntries is missing (count: 0)');
  assert(animCountBefore === 2, 'animals has existing records (count: 2)');
  assert(salesCountBefore === 1, 'sales has existing records (count: 1)');

  const res2 = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false, { mockRemoteCollections: snapshot1 });
  assert(res2.restored === true, 'Partial loss of one table must trigger restore even though local DB is NOT empty');
  assert(res2.count === 1, `Expected exactly 1 record restored (the missing journal entry), got ${res2.count}`);

  const jrnCountAfter = await db.journalEntries.count();
  const animCountAfter = await db.animals.count();
  const salesCountAfter = await db.sales.count();

  assert(jrnCountAfter === 1, 'Missing journalEntries table successfully recovered');
  assert(animCountAfter === 2, 'Existing animals were not duplicated (still 2)');
  assert(salesCountAfter === 1, 'Existing sales were not duplicated (still 1)');
  console.log('✅ Scenario 2 Passed: Single missing table detected and recovered without touching intact tables.');

  // ----------------------------------------------------
  // SCENARIO 3: Partially missing records within a table
  // ----------------------------------------------------
  console.log('\n--- Scenario 3: Partially Missing Records Within a Table ---');
  // Local DB has anim_01 and anim_02. Cloud snapshot has anim_01, anim_02, anim_03, anim_04.
  const snapshot3: Record<string, any[]> = {
    ...snapshot1,
    animals: [
      ...snapshot1.animals,
      { id: 'anim_03', tag: 'GT-03', species: 'GOAT', status: 'ACTIVE', createdAt: '2026-09-03T10:00:00Z', updatedAt: '2026-09-03T10:00:00Z' },
      { id: 'anim_04', tag: 'GT-04', species: 'GOAT', status: 'ACTIVE', createdAt: '2026-09-04T10:00:00Z', updatedAt: '2026-09-04T10:00:00Z' }
    ]
  };

  const res3 = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false, { mockRemoteCollections: snapshot3 });
  assert(res3.restored === true, 'Partially missing records must trigger recovery');
  assert(res3.count === 2, `Expected exactly 2 missing animal records restored, got ${res3.count}`);

  const animCount3 = await db.animals.count();
  assert(animCount3 === 4, `Total animals must now be 4, got ${animCount3}`);

  const anim3 = await db.animals.get('anim_03');
  const anim4 = await db.animals.get('anim_04');
  assert(!!anim3 && anim3.tag === 'GT-03', 'anim_03 restored correctly');
  assert(!!anim4 && anim4.tag === 'GT-04', 'anim_04 restored correctly');
  console.log('✅ Scenario 3 Passed: Partially missing records restored without duplicating existing records.');

  // ----------------------------------------------------
  // SCENARIO 4: Local record newer than cloud (Never overwrite newer local data)
  // ----------------------------------------------------
  console.log('\n--- Scenario 4: Local Newer Than Cloud (Never Destroy Newer Local Data) ---');
  // Modify anim_01 locally with a newer timestamp
  await db.animals.put({
    id: 'anim_01',
    tag: 'GT-01-LOCAL-EDIT',
    species: 'GOAT',
    status: 'TRANSFERRED',
    notes: 'Local diagnosis updated on farm',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-24T20:00:00.000Z' // NEWER local timestamp
  } as any);

  // Cloud snapshot has older timestamp for anim_01
  const snapshot4: Record<string, any[]> = {
    animals: [
      {
        id: 'anim_01',
        tag: 'GT-01-CLOUD-OLD',
        species: 'GOAT',
        status: 'ACTIVE',
        notes: 'Old cloud notes',
        createdAt: '2026-09-01T10:00:00Z',
        updatedAt: '2026-09-10T10:00:00.000Z' // OLDER cloud timestamp
      }
    ]
  };

  const res4 = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false, { mockRemoteCollections: snapshot4 });
  const localAnim1 = await db.animals.get('anim_01');
  assert(localAnim1?.tag === 'GT-01-LOCAL-EDIT', 'Local tag must NOT be overwritten by older cloud tag');
  assert(localAnim1?.status === 'TRANSFERRED', 'Local status must remain TRANSFERRED');
  assert(localAnim1?.notes === 'Local diagnosis updated on farm', 'Local notes must be preserved');
  console.log('✅ Scenario 4 Passed: Newer local records are protected from older cloud snapshot overwrite.');

  // ----------------------------------------------------
  // SCENARIO 5: Cloud record newer than local (Update with confirmed newer cloud record)
  // ----------------------------------------------------
  console.log('\n--- Scenario 5: Cloud Newer Than Local (Restore Confirmed Newer Cloud Record) ---');
  // Local anim_02 has older timestamp
  await db.animals.put({
    id: 'anim_02',
    tag: 'GT-02',
    species: 'GOAT',
    status: 'ACTIVE',
    createdAt: '2026-09-02T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00.000Z' // OLDER local timestamp
  } as any);

  // Cloud snapshot has newer timestamp for anim_02
  const snapshot5: Record<string, any[]> = {
    animals: [
      {
        id: 'anim_02',
        tag: 'GT-02',
        species: 'GOAT',
        status: 'SOLD', // Status updated remotely
        createdAt: '2026-09-02T10:00:00Z',
        updatedAt: '2026-09-24T22:00:00.000Z' // NEWER cloud timestamp
      }
    ]
  };

  const res5 = await restoreRemoteDataIfLocalEmpty(testOwnerEmail, false, { mockRemoteCollections: snapshot5 });
  assert(res5.restored === true, 'Newer cloud record must trigger update');
  assert(res5.count === 1, 'Exactly 1 newer record updated');

  const updatedAnim2 = await db.animals.get('anim_02');
  assert(updatedAnim2?.status === 'SOLD', 'anim_02 status updated to newer cloud status: SOLD');
  assert(updatedAnim2?.updatedAt === '2026-09-24T22:00:00.000Z', 'anim_02 timestamp updated');
  console.log('✅ Scenario 5 Passed: Confirmed newer cloud record cleanly updates local record.');

  console.log('\n====================================================');
  console.log('ALL C1 PARTIAL-LOSS CLOUD RESTORE TESTS PASSED! 🎉');
  console.log('====================================================');
  return { success: true };
}

runPartialLossCloudRestoreTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
