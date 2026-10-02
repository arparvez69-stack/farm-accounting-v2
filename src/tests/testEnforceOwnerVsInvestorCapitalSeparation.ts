import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { postJournalEntry } from '../accounting/accountingEngine';
import {
  executeOwnerCapitalTransaction,
  executeOwnerDrawingTransaction,
  executeInvestorTransaction,
  executeInvestorCapitalReturnTransaction
} from '../services/transactionService';
import {
  executeReinvestInvestorProfitTransaction
} from '../services/capitalMovementService';
import { JournalLine } from '../types';
import { MOCK_FINALIZED_VALUATION_FIXTURE } from './testFixtures';

export interface TestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  total: number;
  failures: string[];
}

function assert(condition: boolean, message: string, summary: TestSuiteResult) {
  summary.total++;
  if (!condition) {
    summary.failed++;
    summary.failures.push(message);
    console.error(`❌ FAIL: ${message}`);
  } else {
    summary.passed++;
    console.log(`✅ PASS: ${message}`);
  }
}

async function setupCleanDatabase() {
  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.add({ ...acc });
  }

  const cashAccount = {
    id: 'cba-cash-01',
    name: 'ফার্ম প্রধান ক্যাশ (Main Cash)',
    accountName: 'ফার্ম প্রধান ক্যাশ (Main Cash)',
    accountType: 'CASH' as const,
    accountNumber: '1010-01',
    currentBalance: 500000,
    isActive: true,
    isDefault: true,
    synced: false
  };
  await db.cashBankAccounts.add(cashAccount);

  const bankAccount = {
    id: 'cba-bank-01',
    name: 'ফার্ম ব্যাংক হিসাব (Islami Bank)',
    accountName: 'ফার্ম ব্যাংক হিসাব (Islami Bank)',
    accountType: 'BANK' as const,
    accountNumber: '1030-01',
    currentBalance: 1000000,
    isActive: true,
    isDefault: false,
    synced: false
  };
  await db.cashBankAccounts.add(bankAccount);
}

export async function runEnforceOwnerVsInvestorCapitalSeparationTest(): Promise<TestSuiteResult> {
  const summary: TestSuiteResult = {
    name: 'TASK 9: Enforce Owner vs Investor Capital Separation',
    passed: 0,
    failed: 0,
    total: 0,
    failures: []
  };

  console.log('================================================================');
  console.log('RUNNING TASK 9: ENFORCE OWNER VS INVESTOR CAPITAL SEPARATION');
  console.log('================================================================');

  await setupCleanDatabase();

  const currentUserId = 'owner_usr_001';

  // ===========================================================================
  // CATEGORY 1: OWNER CAPITAL → OWNER ACCOUNT ONLY (3010 / 3040)
  // ===========================================================================
  console.log('\n--- 1. OWNER CAPITAL → OWNER ACCOUNT ONLY ---');

  // Test 1.1: Owner Capital Contribution (Deposit)
  console.log('\n- Test 1.1: executeOwnerCapitalTransaction posts strictly to 3010 (OWNER_CAPITAL)');
  {
    const res = await executeOwnerCapitalTransaction(
      {
        amount: 200000,
        targetAccountId: 'cba-bank-01',
        currentUserId,
        date: '2026-03-01',
        notes: 'Owner personal capital injection'
      },
      db
    );

    assert(Boolean(res.journalEntryId), 'executeOwnerCapitalTransaction succeeds and returns journalEntryId', summary);

    const journal = await db.journalEntries.get(res.journalEntryId);
    assert(Boolean(journal), 'Journal entry persisted in database', summary);
    assert(journal?.transactionType === 'OWNER_CAPITAL', 'Journal transactionType is explicitly OWNER_CAPITAL', summary);
    assert((journal as any)?.capitalType === 'OWNER', 'Journal capitalType is explicitly OWNER', summary);

    // Verify lines touch 3010 and do NOT touch 3020
    const ownerCapLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010');
    assert(Boolean(ownerCapLine), 'Journal has credit line to account 3010 (OWNER_CAPITAL)', summary);
    assert(ownerCapLine?.credit === 200000, 'Owner capital line has correct credit amount (৳200,000)', summary);

    const investorLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || l.accountCode === '3020');
    assert(!investorLine, 'Owner capital transaction NEVER touches 3020 (INVESTOR_CAPITAL)', summary);

    assert(!journal?.investorId, 'Owner capital entry does not have investorId attached', summary);
  }

  // Test 1.2: Owner Drawings / Capital Withdrawal
  console.log('\n- Test 1.2: executeOwnerDrawingTransaction posts strictly to 3040 (OWNER_DRAWINGS)');
  {
    const res = await executeOwnerDrawingTransaction(
      {
        amount: 30000,
        sourceAccountId: 'cba-bank-01',
        currentUserId,
        date: '2026-03-05',
        notes: 'Owner personal withdrawal'
      },
      db
    );

    assert(Boolean(res.journalEntryId), 'executeOwnerDrawingTransaction succeeds and returns journalEntryId', summary);

    const journal = await db.journalEntries.get(res.journalEntryId);
    assert(Boolean(journal), 'Drawing journal persisted in database', summary);
    assert(journal?.transactionType === 'OWNER_DRAWING', 'Drawing transactionType is explicitly OWNER_DRAWING', summary);
    assert((journal as any)?.capitalType === 'OWNER', 'Drawing capitalType is explicitly OWNER', summary);

    const drawingLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_DRAWINGS || l.accountCode === '3040');
    assert(Boolean(drawingLine), 'Journal has debit line to account 3040 (OWNER_DRAWINGS)', summary);
    assert(drawingLine?.debit === 30000, 'Owner drawing line has correct debit amount (৳30,000)', summary);

    const investorLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || l.accountCode === '3020');
    assert(!investorLine, 'Owner drawing transaction NEVER touches 3020 (INVESTOR_CAPITAL)', summary);
    assert(!journal?.investorId, 'Owner drawing entry does not have investorId attached', summary);
  }

  // ===========================================================================
  // CATEGORY 2: INVESTOR CAPITAL → INVESTOR ACCOUNT ONLY (3020)
  // ===========================================================================
  console.log('\n--- 2. INVESTOR CAPITAL → INVESTOR ACCOUNT ONLY ---');

  // Setup test investor
  const testInvestorId = 'inv_partner_01';
  await db.investors.add({
    id: testInvestorId,
    name: 'Rafiqul Islam',
    phone: '+8801711223344',
    capitalAmount: 0,
    capitalContributed: 0,
    currentCapitalBalance: 0,
    profitPayable: 50000,
    profitSharingRatio: 30,
    status: 'ACTIVE',
    isAdmitted: true,
    economicParticipationActive: true,
    joinedDate: '2026-01-01',
    synced: false
  });

  // Test 2.1: Investor Capital Contribution
  console.log('\n- Test 2.1: executeInvestorTransaction posts strictly to 3020 (INVESTOR_CAPITAL)');
  {
    const res = await executeInvestorTransaction(
      {
        investorId: testInvestorId,
        investorName: 'Rafiqul Islam',
        contribution: 300000,
        amount: 300000,
        targetAccountId: 'cba-bank-01',
        profitSharingRatio: 30,
        date: '2026-03-02',
        currentUserId,
        notes: 'Initial partner investment',
        valuationRecord: MOCK_FINALIZED_VALUATION_FIXTURE
      },
      db
    );

    assert(Boolean(res.journalEntryId), 'executeInvestorTransaction succeeds and returns journalEntryId', summary);

    const journal = await db.journalEntries.get(res.journalEntryId);
    assert(Boolean(journal), 'Investor journal persisted in database', summary);
    assert(
      journal?.transactionType === 'INVESTOR_CONTRIBUTION',
      'Journal transactionType is explicitly INVESTOR_CONTRIBUTION',
      summary
    );
    assert((journal as any)?.capitalType === 'INVESTOR', 'Journal capitalType is explicitly INVESTOR', summary);
    assert(journal?.investorId === testInvestorId, 'Journal is attributed to specific investorId', summary);
    assert(journal?.relatedPerson === 'Rafiqul Islam', 'Journal is attributed to specific investor name', summary);

    const invCapLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || l.accountCode === '3020');
    assert(Boolean(invCapLine), 'Journal has credit line to account 3020 (INVESTOR_CAPITAL)', summary);
    assert(invCapLine?.credit === 300000, 'Investor capital line has correct credit amount (৳300,000)', summary);

    const ownerCapLine = journal?.lines?.find(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010' || l.accountCode === '3040'
    );
    assert(!ownerCapLine, 'Investor transaction NEVER touches owner accounts (3010/3040)', summary);
  }

  // Test 2.2: Investor Capital Return / Withdrawal
  console.log('\n- Test 2.2: executeInvestorCapitalReturnTransaction posts strictly to 3020 (INVESTOR_CAPITAL)');
  {
    const res = await executeInvestorCapitalReturnTransaction(
      {
        investorId: testInvestorId,
        amount: 50000,
        sourceAccountId: 'cba-bank-01',
        currentUserId,
        date: '2026-03-10',
        notes: 'Partial capital return to investor'
      },
      db
    );

    assert(Boolean(res.journalEntryId), 'executeInvestorCapitalReturnTransaction succeeds', summary);

    const journal = await db.journalEntries.get(res.journalEntryId);
    assert(Boolean(journal), 'Capital return journal persisted in database', summary);
    assert(
      journal?.transactionType === 'INVESTOR_CAPITAL_RETURN',
      'Journal transactionType is explicitly INVESTOR_CAPITAL_RETURN',
      summary
    );
    assert((journal as any)?.capitalType === 'INVESTOR', 'Journal capitalType is explicitly INVESTOR', summary);
    assert(journal?.investorId === testInvestorId, 'Journal belongs to specific investor', summary);

    const invCapLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || l.accountCode === '3020');
    assert(Boolean(invCapLine), 'Journal has debit line to account 3020 (INVESTOR_CAPITAL)', summary);
    assert(invCapLine?.debit === 50000, 'Investor capital debit amount is correct (৳50,000)', summary);

    const ownerCapLine = journal?.lines?.find(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010' || l.accountCode === '3040'
    );
    assert(!ownerCapLine, 'Investor capital return NEVER touches owner accounts (3010/3040)', summary);
  }

  // Test 2.3: Reinvest Investor Profit into Investor Capital
  console.log('\n- Test 2.3: executeReinvestInvestorProfitTransaction posts strictly to 3020 (INVESTOR_CAPITAL)');
  {
    const res = await executeReinvestInvestorProfitTransaction(
      {
        investorId: testInvestorId,
        reinvestAmount: 20000,
        currentUserId,
        date: '2026-03-12',
        notes: 'Reinvestment of earned profit into capital'
      },
      db
    );

    assert(Boolean(res.journalEntryId), 'executeReinvestInvestorProfitTransaction succeeds', summary);

    const journal = await db.journalEntries.get(res.journalEntryId);
    assert(Boolean(journal), 'Reinvestment journal persisted in database', summary);
    assert(
      journal?.transactionType === 'INVESTOR_PROFIT_REINVESTMENT',
      'Journal transactionType is explicitly INVESTOR_PROFIT_REINVESTMENT',
      summary
    );
    assert((journal as any)?.capitalType === 'INVESTOR', 'Journal capitalType is explicitly INVESTOR', summary);
    assert(journal?.investorId === testInvestorId, 'Journal is linked to specific investor', summary);

    const invCapLine = journal?.lines?.find((l) => l.accountCode === CANONICAL_ACCOUNTS.INVESTOR_CAPITAL || l.accountCode === '3020');
    assert(Boolean(invCapLine), 'Reinvestment credits 3020 (INVESTOR_CAPITAL)', summary);
    assert(invCapLine?.credit === 20000, 'Reinvestment credit is ৳20,000', summary);

    const ownerCapLine = journal?.lines?.find(
      (l) => l.accountCode === CANONICAL_ACCOUNTS.OWNER_CAPITAL || l.accountCode === '3010' || l.accountCode === '3040'
    );
    assert(!ownerCapLine, 'Investor reinvestment NEVER touches owner accounts (3010/3040)', summary);
  }

  // ===========================================================================
  // CATEGORY 3: CROSS-MAPPING → STRICTLY REJECTED
  // ===========================================================================
  console.log('\n--- 3. CROSS-MAPPING → REJECTED ---');

  // Test 3.1: Reject Investor Capital into executeOwnerCapitalTransaction
  console.log('\n- Test 3.1: executeOwnerCapitalTransaction rejects investor capital cross-mapping');
  {
    let rejected = false;
    try {
      await executeOwnerCapitalTransaction(
        {
          amount: 50000,
          targetAccountId: 'cba-bank-01',
          currentUserId,
          investorId: testInvestorId, // Cross-mapping attempt!
          capitalType: 'INVESTOR'
        } as any,
        db
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected') || err.message.includes('Investor capital'),
        `Rejection error explicitly mentions cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'executeOwnerCapitalTransaction with investor attributes was REJECTED', summary);
  }

  // Test 3.2: Reject Investor Capital into executeOwnerDrawingTransaction
  console.log('\n- Test 3.2: executeOwnerDrawingTransaction rejects investor withdrawal cross-mapping');
  {
    let rejected = false;
    try {
      await executeOwnerDrawingTransaction(
        {
          amount: 10000,
          sourceAccountId: 'cba-bank-01',
          currentUserId,
          investorId: testInvestorId, // Cross-mapping attempt!
          capitalType: 'INVESTOR'
        } as any,
        db
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected') || err.message.includes('Investor capital'),
        `Rejection error explicitly mentions cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'executeOwnerDrawingTransaction with investor attributes was REJECTED', summary);
  }

  // Test 3.3: Reject Owner Capital into executeInvestorTransaction
  console.log('\n- Test 3.3: executeInvestorTransaction rejects owner capital cross-mapping');
  {
    let rejected = false;
    try {
      await executeInvestorTransaction(
        {
          investorId: testInvestorId,
          amount: 50000,
          targetAccountId: 'cba-bank-01',
          currentUserId,
          capitalType: 'OWNER', // Cross-mapping attempt!
          isOwnerCapital: true
        } as any,
        db
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected') || err.message.includes('Owner capital'),
        `Rejection error explicitly mentions cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'executeInvestorTransaction with owner capital attributes was REJECTED', summary);
  }

  // Test 3.4: Reject Owner Drawing into executeInvestorCapitalReturnTransaction
  console.log('\n- Test 3.4: executeInvestorCapitalReturnTransaction rejects owner drawing cross-mapping');
  {
    let rejected = false;
    try {
      await executeInvestorCapitalReturnTransaction(
        {
          investorId: testInvestorId,
          amount: 10000,
          sourceAccountId: 'cba-bank-01',
          currentUserId,
          capitalType: 'OWNER', // Cross-mapping attempt!
          transactionType: 'OWNER_DRAWING'
        } as any,
        db
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected') || err.message.includes('Owner'),
        `Rejection error explicitly mentions cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'executeInvestorCapitalReturnTransaction with owner drawing attributes was REJECTED', summary);
  }

  // Test 3.5: Direct postJournalEntry mixing Owner Capital (3010) and Investor Capital (3020) in same entry
  console.log('\n- Test 3.5: postJournalEntry rejects mixing Owner Capital and Investor Capital in the same entry');
  {
    const accounts = await db.accounts.toArray();
    let rejected = false;
    try {
      const mixedLines: JournalLine[] = [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'Bank',
          debit: 100000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'Owner Capital',
          debit: 0,
          credit: 60000
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'Investor Capital',
          debit: 0,
          credit: 40000,
          investorId: testInvestorId
        }
      ];

      await postJournalEntry(
        {
          id: 'j_cross_mix',
          voucherNumber: 'V-MIX-01',
          voucherType: 'RECEIPT',
          date: '2026-03-15',
          narration: 'Mixed capital entry',
          lines: mixedLines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected') || err.message.includes('mix'),
        `Rejection error mentions mixing prohibited: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'postJournalEntry strictly REJECTS mixing 3010 and 3020 in same transaction', summary);
  }

  // Test 3.6: Direct postJournalEntry attempting to post Investor Capital into account 3010
  console.log('\n- Test 3.6: postJournalEntry rejects posting Investor Capital into Account 3010');
  {
    const accounts = await db.accounts.toArray();
    let rejected = false;
    try {
      const lines: JournalLine[] = [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'Bank',
          debit: 50000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'Owner Capital',
          debit: 0,
          credit: 50000
        }
      ];

      await postJournalEntry(
        {
          id: 'j_cross_inv_to_owner',
          voucherNumber: 'V-CROSS-01',
          voucherType: 'RECEIPT',
          transactionType: 'INVESTOR_CONTRIBUTION', // Investor type targeting 3010!
          capitalType: 'INVESTOR',
          date: '2026-03-15',
          narration: 'Investor money mapped to owner account',
          lines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected'),
        `Rejection error identifies cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'postJournalEntry strictly REJECTS Investor Capital into account 3010', summary);
  }

  // Test 3.7: Direct postJournalEntry attempting to post Owner Capital into account 3020
  console.log('\n- Test 3.7: postJournalEntry rejects posting Owner Capital into Account 3020');
  {
    const accounts = await db.accounts.toArray();
    let rejected = false;
    try {
      const lines: JournalLine[] = [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'Bank',
          debit: 50000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'Investor Capital',
          debit: 0,
          credit: 50000,
          investorId: testInvestorId
        }
      ];

      await postJournalEntry(
        {
          id: 'j_cross_owner_to_inv',
          voucherNumber: 'V-CROSS-02',
          voucherType: 'RECEIPT',
          transactionType: 'OWNER_CAPITAL', // Owner type targeting 3020!
          capitalType: 'OWNER',
          isOwnerCapital: true,
          relatedPerson: 'Farm Owner',
          date: '2026-03-15',
          narration: 'Owner money mapped to investor account',
          lines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cross-mapping rejected'),
        `Rejection error identifies cross-mapping: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'postJournalEntry strictly REJECTS Owner Capital into account 3020', summary);
  }

  // Test 3.8: Direct postJournalEntry with ambiguous or prohibited capital source
  console.log('\n- Test 3.8: postJournalEntry rejects ambiguous or unknown capital source');
  {
    const accounts = await db.accounts.toArray();
    let rejected = false;
    try {
      const lines: JournalLine[] = [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'Bank',
          debit: 25000,
          credit: 0
        },
        {
          accountId: 'acc_3010',
          accountCode: '3010',
          accountName: 'Owner Capital',
          debit: 0,
          credit: 25000
        }
      ];

      await postJournalEntry(
        {
          id: 'j_ambiguous_cap',
          voucherNumber: 'V-AMB-01',
          voucherType: 'RECEIPT',
          capitalType: 'UNKNOWN', // Ambiguous source!
          date: '2026-03-15',
          narration: 'Ambiguous capital source',
          lines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Ambiguous capital source') || err.message.includes('Explicit capital source'),
        `Rejection error flags ambiguous capital source: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'postJournalEntry strictly REJECTS ambiguous capital sources (UNKNOWN/DEFAULT/etc.)', summary);
  }

  // Test 3.9: Direct postJournalEntry on 3020 with anonymous / unassigned investor attribution
  console.log('\n- Test 3.9: postJournalEntry on 3020 rejects anonymous/unassigned investor');
  {
    const accounts = await db.accounts.toArray();
    let rejected = false;
    try {
      const lines: JournalLine[] = [
        {
          accountId: 'acc_1030',
          accountCode: '1030',
          accountName: 'Bank',
          debit: 25000,
          credit: 0
        },
        {
          accountId: 'acc_3020',
          accountCode: '3020',
          accountName: 'Investor Capital',
          debit: 0,
          credit: 25000,
          investorId: 'anonymous'
        }
      ];

      await postJournalEntry(
        {
          id: 'j_anon_inv',
          voucherNumber: 'V-ANON-01',
          voucherType: 'RECEIPT',
          transactionType: 'INVESTOR_CONTRIBUTION',
          capitalType: 'INVESTOR',
          investorId: 'anonymous', // Anonymous prohibited!
          relatedPerson: 'anonymous',
          date: '2026-03-15',
          narration: 'Anonymous investor contribution',
          lines,
          createdBy: currentUserId,
          createdAt: new Date().toISOString()
        },
        { dbInstance: db, accounts }
      );
    } catch (err: any) {
      rejected = true;
      assert(
        err.message.includes('Cannot silently assign an unknown or default investor') ||
          err.message.includes('Investor attribution required'),
        `Rejection error flags anonymous investor: "${err.message}"`,
        summary
      );
    }
    assert(rejected, 'postJournalEntry strictly REJECTS unattributed/anonymous investor capital on 3020', summary);
  }

  console.log('\n================================================================');
  console.log(`TASK 9 RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

if (process.argv[1]?.endsWith('testEnforceOwnerVsInvestorCapitalSeparation.ts')) {
  runEnforceOwnerVsInvestorCapitalSeparationTest()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`Task 9 tests failed (${res.failed} failures):`, res.failures);
        process.exit(1);
      }
      console.log('Task 9: All tests passed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error running Task 9 tests:', err);
      process.exit(1);
    });
}
