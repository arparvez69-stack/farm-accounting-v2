import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { resolveAccountMetadata, generateTrialBalance, getGeneralLedger } from '../accounting/accountingEngine';
import { Account } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runInvalidOrphanAccountHandlingTests() {
  console.log('====================================================');
  console.log('STARTING INVALID / ORPHAN ACCOUNT HANDLING TESTS (TASK B1)');
  console.log('====================================================');

  await db.delete();
  await db.open();

  // Seed default chart of accounts
  await db.accounts.bulkAdd(DEFAULT_CHART_OF_ACCOUNTS);

  // Seed a valid custom account
  const customAccount: Account = {
    id: 'acc_6134',
    code: '6134',
    nameBn: 'বিশেষ ভেটেরিনারি পরামর্শ ফি',
    nameEn: 'Custom Vet Consultation Fee',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: false,
    isActive: true
  };
  await db.accounts.add(customAccount);

  const accountsMap = new Map<string, Account>();
  for (const acc of await db.accounts.toArray()) {
    accountsMap.set(acc.code, acc);
  }

  // ----------------------------------------------------
  // TEST 1: Valid Registered Accounts Return Real Metadata
  // ----------------------------------------------------
  console.log('\n--- Test 1: Valid Registered Accounts Return Real Metadata ---');
  const cashAcc = resolveAccountMetadata('1010', accountsMap);
  assert(cashAcc.code === '1010', '1010 code must match');
  assert(cashAcc.accountClass === 'ASSET', '1010 must be ASSET');
  assert(cashAcc.normalBalance === 'DEBIT', '1010 must be DEBIT');

  const loanLiabAcc = resolveAccountMetadata('2110', accountsMap);
  assert(loanLiabAcc.code === '2110', '2110 code must match');
  assert(loanLiabAcc.accountClass === 'LIABILITY', '2110 must be LIABILITY');
  assert(loanLiabAcc.normalBalance === 'CREDIT', '2110 must be CREDIT');

  const customAccResolved = resolveAccountMetadata('6134', accountsMap);
  assert(customAccResolved.code === '6134', '6134 code must match');
  assert(customAccResolved.accountClass === 'EXPENSE', '6134 must be EXPENSE');
  assert(customAccResolved.normalBalance === 'DEBIT', '6134 must be DEBIT');
  console.log('✅ Test 1 Passed: Valid registered accounts return correct existing classification & normal balance.');

  // ----------------------------------------------------
  // TEST 2: Unknown / Orphan Account Codes Resolve as UNKNOWN / UNRESOLVED
  // ----------------------------------------------------
  console.log('\n--- Test 2: Unknown / Orphan Accounts Do NOT Default to DEBIT or ASSET ---');
  const orphanCodes = ['9999', '1999', '2999', '7777', 'XYZ01', '0000'];

  for (const code of orphanCodes) {
    const resolved = resolveAccountMetadata(code);
    assert(resolved.code === code, `Code must match requested code: ${code}`);

    // Must NOT default to DEBIT
    assert(
      resolved.normalBalance !== 'DEBIT',
      `Unknown account "${code}" must NEVER silently receive DEBIT normal balance! Got: ${resolved.normalBalance}`
    );

    // Must NOT default to ASSET
    assert(
      resolved.accountClass !== 'ASSET',
      `Unknown account "${code}" must NEVER silently receive ASSET class! Got: ${resolved.accountClass}`
    );

    // Must resolve as UNKNOWN / UNRESOLVED / INVALID
    const rawClass = resolved.accountClass as any;
    const isUnresolvedClass =
      rawClass === 'UNKNOWN' ||
      rawClass === 'UNRESOLVED' ||
      rawClass === 'INVALID';
    assert(
      isUnresolvedClass,
      `Unknown account "${code}" must resolve as UNKNOWN, UNRESOLVED, or INVALID! Got: ${resolved.accountClass}`
    );

    const isUnresolvedBalance =
      resolved.normalBalance === 'UNKNOWN' ||
      resolved.normalBalance === 'UNRESOLVED' ||
      resolved.normalBalance === 'INVALID';
    assert(
      isUnresolvedBalance,
      `Unknown account "${code}" normal balance must resolve as UNKNOWN/UNRESOLVED/INVALID! Got: ${resolved.normalBalance}`
    );
  }
  console.log('✅ Test 2 Passed: Unknown accounts never receive DEBIT normal balance or ASSET class; resolve safely as UNKNOWN.');

  // ----------------------------------------------------
  // TEST 3: Trial Balance Exposes Orphan Accounts Rather Than Hiding Them
  // ----------------------------------------------------
  console.log('\n--- Test 3: Trial Balance Exposes Orphan Accounts as UNKNOWN ---');
  // Post a journal entry with one valid account (1010 Cash) and one orphan account (9999 Ghost Account)
  await db.journalEntries.add({
    id: 'j-orphan-test-01',
    voucherNumber: 'JRN-ORPHAN-01',
    voucherType: 'JOURNAL',
    date: '2026-05-01',
    narration: 'Test entry containing orphan account',
    lines: [
      {
        accountCode: '9999',
        accountName: 'Ghost Account',
        debit: 5000,
        credit: 0
      },
      {
        accountCode: '1010',
        accountName: 'হাতে নগদ (Cash in Hand)',
        debit: 0,
        credit: 5000
      }
    ],
    createdAt: new Date().toISOString()
  });

  const tb = await generateTrialBalance();
  assert(tb.hasInvalidAccounts === true, 'Trial balance must detect invalid/orphan accounts');
  assert(tb.orphanAccounts.includes('9999'), 'Trial balance must list 9999 in orphanAccounts');

  const orphanRow = tb.rows.find((r) => r.code === '9999');
  assert(!!orphanRow, 'Orphan row must be present in Trial Balance');
  assert(orphanRow!.accountClass === 'UNKNOWN', 'Orphan row accountClass must be UNKNOWN');
  assert(orphanRow!.debit === 5000, 'Orphan row debit must be 5000');
  console.log('✅ Test 3 Passed: Trial Balance explicitly exposes orphan accounts with accountClass: UNKNOWN.');

  // ----------------------------------------------------
  // TEST 4: General Ledger for Unknown Account Resolves as UNKNOWN
  // ----------------------------------------------------
  console.log('\n--- Test 4: General Ledger for Unknown Account Resolves as UNKNOWN ---');
  const gl = await getGeneralLedger('9999');
  assert(!!gl.account, 'GL account metadata must be present');
  assert((gl.account!.accountClass as any) === 'UNKNOWN', 'GL accountClass must be UNKNOWN');
  assert(gl.account!.normalBalance === 'UNKNOWN', 'GL normalBalance must be UNKNOWN');
  assert(gl.entries.length === 1, 'GL must list the journal entry');
  console.log('✅ Test 4 Passed: General Ledger resolves unknown account with accountClass: UNKNOWN without inventing a chart record.');

  console.log('\n====================================================');
  console.log('ALL INVALID / ORPHAN ACCOUNT HANDLING TESTS PASSED! 🎉');
  console.log('====================================================');
  return { success: true };
}

runInvalidOrphanAccountHandlingTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
