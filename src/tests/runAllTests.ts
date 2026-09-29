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
import { runTaskF8HardenOwnerSessionAuthTests } from './testTaskF8HardenOwnerSessionAuth';
import { runTaskF9AuthoritativeOwnerAllowListTests } from './testTaskF9AuthoritativeOwnerAllowList';
import { runTaskF10ValidateCalculatedFieldsOnNewRecordsTests } from './testTaskF10ValidateCalculatedFieldsOnNewRecords';
import { runTaskF11MultiLineVouchersTests } from './testTaskF11MultiLineVouchers';
import { runHardenSaveRecordToDurableDiskTests } from './testHardenSaveRecordToDurableDisk';
import { runBackupRestoreAuditTests } from './testBackupRestoreAudit';
import { runSyncRequestValidationTests } from './testSyncRequestValidation';
import { runTrialBalanceDateFilteringTests } from './testTrialBalanceDateFiltering';
import { runGeneralLedgerDateConsistencyTests } from './testGeneralLedgerDateConsistency';

// Standalone test suites wired into the unified runner
import { runPrincipalOnlyLoanTests } from './testPrincipalOnlyLoans';
import { runInvalidOrphanAccountHandlingTests } from './testInvalidOrphanAccountHandling';
import { runClassificationConsistencyAuditTests } from './testClassificationConsistencyAudit';
import { runReturnsAccountingTest } from './testReturnsAccounting';
import { runCropCycleCostIsolationTest } from './testCropCycleCostIsolation';
import { runLivestockCostIsolationTest } from './testLivestockCostIsolation';
import { runProductionReceiptCostProtectionTests } from './testProductionReceiptCostProtection';
import { runHarvestQuantityControlTest } from './testHarvestQuantityControl';
import { runProductionEnvironmentValidationTests } from './testProductionEnvironmentValidation';
import { runStabilityTasks31_32_33Tests } from './testStabilityTasks31_32_33';
import { runStabilityTasks34_35_36_37Tests } from './testStabilityTasks34_35_36_37';
import { runStabilityTasks38_39_40Tests } from './testStabilityTasks38_39_40';
import { runStabilityTasks41_42Tests } from './testStabilityTasks41_42';
import { runStabilityTasks43_44Tests } from './testStabilityTasks43_44';
import { runCompleteAccountingGoldenLifecycleTests } from './testCompleteAccountingGoldenLifecycle';
import { runCompleteDataRecoveryDrillTests } from './testCompleteDataRecoveryDrill';
import { runCorruptedBackupSafeRejectionTests } from './testCorruptedBackupSafeRejection';
import { runInterruptedTransactionSafetyTests } from './testInterruptedTransactionSafety';
import { runOfflineReloadOnlineSyncRecoveryTests } from './testPrompt09OfflineSyncRecovery';
import { runBrowserInterruptionSafetyTests } from './testPrompt10BrowserInterruptionSafety';
import { runProductionSmokeTests } from './testPrompt12ProductionSmokeTest';
import { runRealDeviceRegressionTests } from './testPrompt13RealDeviceRegression';
import { runPrompt14FinalDataIntegrityReconciliation } from './testPrompt14FinalDataIntegrityReconciliation';

interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

async function main() {
  console.log('====================================================');
  console.log('RUNNING COMPLETE REGRESSION & AUDIT TEST SUITE');
  console.log('Including all canonical suites and newly wired standalone audit suites');
  console.log('====================================================');

  const suiteResults: SuiteResult[] = [];

  suiteResults.push(await runRegressionTests());
  suiteResults.push(await runCashFlowAccountingTests());
  suiteResults.push(await runReconciliationTests());
  suiteResults.push(await runAdvancePaymentTests());
  suiteResults.push(await runVatAccountingTests());
  suiteResults.push(await runBankReconciliationTests());
  suiteResults.push(await runFullJsonBackupCoverageTests());
  suiteResults.push(await runSyncPersistentTablesTests());
  suiteResults.push(await runCompleteCloudRestoreCoverageTests());
  suiteResults.push(await runChartOfAccountsExtensionTests());
  suiteResults.push(await runTaskF4ChartOfAccountsCloudPersistenceTests());
  suiteResults.push(await runTaskF6VersionConflictProtectionTests());
  suiteResults.push(await runTaskF7DurablePersistenceRequirementTests());
  suiteResults.push(await runTaskF8HardenOwnerSessionAuthTests());
  suiteResults.push(await runTaskF9AuthoritativeOwnerAllowListTests());
  suiteResults.push(await runTaskF10ValidateCalculatedFieldsOnNewRecordsTests());
  suiteResults.push(await runTaskF11MultiLineVouchersTests());
  suiteResults.push(await runHardenSaveRecordToDurableDiskTests());
  suiteResults.push(await runBackupRestoreAuditTests());
  suiteResults.push(await runSyncRequestValidationTests());
  suiteResults.push(await runTrialBalanceDateFilteringTests());
  suiteResults.push(await runGeneralLedgerDateConsistencyTests());

  // Newly wired standalone suites
  suiteResults.push(await runPrincipalOnlyLoanTests());
  suiteResults.push(await runInvalidOrphanAccountHandlingTests());
  suiteResults.push(await runClassificationConsistencyAuditTests());
  suiteResults.push(await runReturnsAccountingTest());
  suiteResults.push(await runCropCycleCostIsolationTest());
  suiteResults.push(await runLivestockCostIsolationTest());
  suiteResults.push(await runProductionReceiptCostProtectionTests());
  suiteResults.push(await runHarvestQuantityControlTest());
  suiteResults.push(await runProductionEnvironmentValidationTests());
  suiteResults.push(await runStabilityTasks31_32_33Tests());
  suiteResults.push(await runStabilityTasks34_35_36_37Tests());
  suiteResults.push(await runStabilityTasks38_39_40Tests());
  suiteResults.push(await runStabilityTasks41_42Tests());
  suiteResults.push(await runStabilityTasks43_44Tests());
  suiteResults.push(await runCompleteAccountingGoldenLifecycleTests());
  suiteResults.push(await runCompleteDataRecoveryDrillTests());
  suiteResults.push(await runCorruptedBackupSafeRejectionTests());
  suiteResults.push(await runInterruptedTransactionSafetyTests());
  suiteResults.push(await runOfflineReloadOnlineSyncRecoveryTests());
  suiteResults.push(await runBrowserInterruptionSafetyTests());
  suiteResults.push(await runProductionSmokeTests());
  suiteResults.push(await runRealDeviceRegressionTests());
  suiteResults.push(await runPrompt14FinalDataIntegrityReconciliation());

  // Strictly aggregate actual executed assertions — no manual +10 or phantom counts
  const total = suiteResults.reduce((s, r) => s + (r.total || 0), 0);
  const passed = suiteResults.reduce((s, r) => s + (r.passed || 0), 0);
  const failed = suiteResults.reduce((s, r) => s + (r.failed || 0), 0);
  const failures = suiteResults.flatMap((r) => r.failures || []);
  const success = failed === 0;

  console.log('\n====================================================');
  console.log('TEST SUITE RESULTS:');
  console.log(`Success: ${success}`);
  console.log(`Total suites executed: ${suiteResults.length}`);
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
