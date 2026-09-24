import 'fake-indexeddb/auto';
import { runRegressionTests } from './regressionTests';
import { runCashFlowAccountingTests } from './testCashFlowAccounting';
import { runReconciliationTests } from './testReconciliationChecks';
import { runAdvancePaymentTests } from './testAdvancePayments';
import { runVatAccountingTests } from './testVatAccounting';
import { runBankReconciliationTests } from './testBankReconciliation';
import { runFullJsonBackupCoverageTests } from './testFullJsonBackupCoverage';
import { runSyncPersistentTablesTests } from './testSyncPersistentTables';
import { runCompleteCloudRestoreCoverageTests } from './testCompleteCloudRestoreCoverage';

async function main() {
  console.log('====================================================');
  console.log('RUNNING REGRESSION TEST SUITE');
  console.log('Including separate verification of Profit Allocation, Profit Payment, Cash Flow, Reconciliation, Advance Payments, Item VAT, Bank Reconciliation, Full Backup, Persistent Sync & Complete Cloud Restore');
  console.log('====================================================');

  const result1 = await runRegressionTests();
  const result2 = await runCashFlowAccountingTests();
  const result3 = await runReconciliationTests();
  const result4 = await runAdvancePaymentTests();
  const result5 = await runVatAccountingTests();
  const result6 = await runBankReconciliationTests();
  const result7 = await runFullJsonBackupCoverageTests();
  const result8 = await runSyncPersistentTablesTests();
  const result9 = await runCompleteCloudRestoreCoverageTests();

  const total = result1.total + result2.total + result3.total + result4.total + result5.total + result6.total + result7.total + result8.total + result9.total;
  const passed = result1.passed + result2.passed + result3.passed + result4.passed + result5.passed + result6.passed + result7.passed + result8.passed + result9.passed;
  const failed = result1.failed + result2.failed + result3.failed + result4.failed + result5.failed + result6.failed + result7.failed + result8.failed + result9.failed;
  const failures = [...result1.failures, ...result2.failures, ...result3.failures, ...result4.failures, ...result5.failures, ...result6.failures, ...result7.failures, ...result8.failures, ...result9.failures];
  const success = failed === 0;

  console.log('\n====================================================');
  console.log('TEST SUITE RESULTS:');
  console.log(`Success: ${success}`);
  console.log(`Total assertions: ${total}`);
  console.log(`Passed assertions: ${passed}`);
  console.log(`Failed assertions: ${failed}`);
  console.log('====================================================');

  if (failures.length > 0) {
    console.error('\nFAILURES:');
    failures.forEach((f, idx) => {
      console.error(`${idx + 1}. ${f}`);
    });
    process.exit(1);
  } else {
    console.log('\nAll assertions passed cleanly!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
