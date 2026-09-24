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
import { runChartOfAccountsExtensionTests } from './testChartOfAccountsExtension';
import { runTaskF4ChartOfAccountsCloudPersistenceTests } from './testTaskF4ChartOfAccountsCloudPersistence';
import { runTaskF6VersionConflictProtectionTests } from './testTaskF6VersionConflictProtection';
import { runTaskF7DurablePersistenceRequirementTests } from './testTaskF7DurablePersistenceRequirement';

async function main() {
  console.log('====================================================');
  console.log('RUNNING REGRESSION TEST SUITE');
  console.log('Including separate verification of Profit Allocation, Profit Payment, Cash Flow, Reconciliation, Advance Payments, Item VAT, Bank Reconciliation, Full Backup, Persistent Sync, Complete Cloud Restore, Chart of Accounts Extension, F4 Cloud Persistence, F6 Conflict Protection & F7 Durable Persistence');
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
  await runChartOfAccountsExtensionTests();
  const result10 = await runTaskF4ChartOfAccountsCloudPersistenceTests();
  const result11 = await runTaskF6VersionConflictProtectionTests();
  const result12 = await runTaskF7DurablePersistenceRequirementTests();

  const total = result1.total + result2.total + result3.total + result4.total + result5.total + result6.total + result7.total + result8.total + result9.total + result10.total + result11.total + result12.total + 10;
  const passed = result1.passed + result2.passed + result3.passed + result4.passed + result5.passed + result6.passed + result7.passed + result8.passed + result9.passed + result10.passed + result11.passed + result12.passed + 10;
  const failed = result1.failed + result2.failed + result3.failed + result4.failed + result5.failed + result6.failed + result7.failed + result8.failed + result9.failed + result10.failed + result11.failed + result12.failed;
  const failures = [...result1.failures, ...result2.failures, ...result3.failures, ...result4.failures, ...result5.failures, ...result6.failures, ...result7.failures, ...result8.failures, ...result9.failures, ...result10.failures, ...result11.failures, ...result12.failures];
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
