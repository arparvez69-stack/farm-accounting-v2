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
import { runInvestmentTrancheModelTests } from './testInvestmentTrancheModel';
import { runContractualPercentagePerTrancheTests } from './testContractualPercentagePerTranche';
import { runValuationEventTests } from './testValuationEvent';
import { runNetAssetValuationTests } from './testNetAssetValuation';
import { runInvestorEntrySnapshotTests } from './testInvestorEntrySnapshot';
import { runNewInvestorEntryValuationTests } from './testNewInvestorEntryValuation';
import { runSeparateBusinessProfitFromInvestorProfitTests } from './testSeparateBusinessProfitFromInvestorProfit';
import { runCapitalParticipationAllocationTests } from './testCapitalParticipationAllocation';
import { runSameTimeEqualInvestmentsTests } from './testSameTimeEqualInvestments';
import { runPrompt02TrancheStructureTests } from './testPrompt02TrancheStructure';
import { runSeparatePersonFromCapacityTests } from './testSeparatePersonFromCapacity';
import { runIndividualContractPercentageTests } from './testIndividualContractPercentage';
import { runEffectiveInvestmentDatesTests } from './testEffectiveInvestmentDates';
import { runCapitalMovementLedgerTests } from './testCapitalMovementLedger';
import { runValuationReconciliationGateTests } from './testValuationReconciliationGate';
import { runPhysicalInventoryAdjustmentTests } from './testPhysicalInventoryAdjustment';
import { runFixedAssetVerificationTests } from './testFixedAssetVerification';
import { runLiabilityVerificationTests } from './testLiabilityVerification';
import { runCorrectNavFormulaTests } from './testCorrectNavFormula';
import { runSeparateProfitFromValuationTests } from './testSeparateProfitFromValuation';
import { runImmutableValuationSnapshotTests } from './testImmutableValuationSnapshot';
import { runValuationPreviewNoMutationTests } from './testValuationPreviewNoMutation';
import { runPrompt15AdmissionRequestTests } from './testPrompt15AdmissionRequest';
import { runPrompt16BlockAdmissionWithoutFinalValuationTests } from './testPrompt16BlockAdmissionWithoutFinalValuation';
import { runPrompt17PreMoneyNavAdmissionValuationTests } from './testPrompt17PreMoneyNavAdmissionValuation';
import { runPrompt18PostMoneyNavTests } from './testPrompt18PostMoneyNav';
import { runPrompt19NewInvestorParticipationTests } from './testPrompt19NewInvestorParticipation';
import { runPrompt20ProtectHistoricalProfitTests } from './testPrompt20ProtectHistoricalProfit';
import { runPrompt21CapitalReceiptTests } from './testPrompt21CapitalReceipt';
import { runPrompt22FinalizeAdmissionAtomicallyTests } from './testPrompt22FinalizeAdmissionAtomically';
import { runPrompt23CreateProfitPoolTests } from './testPrompt23CreateProfitPool';
import { runPrompt24EconomicAllocationByCapitalTests } from './testPrompt24EconomicAllocationByCapital';
import { runPrompt27Full300ProfitGoldenCalculationTests } from './testPrompt27Full300ProfitGoldenCalculation';
import { runPrompt28LossHandlingTests } from './testPrompt28LossHandling';
import { runPrompt29ProfitSettlementPreviewTests } from './testPrompt29ProfitSettlementPreview';
import { runPrompt30PartialReinvestmentTests } from './testPrompt30PartialReinvestment';
import { runPrompt31ReinvestmentCreatesNewCapitalTrancheTests } from './testPrompt31ReinvestmentCreatesNewCapitalTranche';
import { runPrompt32OwnerMudaribReinvestmentTests } from './testPrompt32OwnerMudaribReinvestment';
import { runPrompt33SettlementIdempotencyTests } from './testPrompt33SettlementIdempotency';
import { runPrompt34CrashSafeFinalizationTests } from './testPrompt34CrashSafeFinalization';
import { runPrompt35InvestorStatementTests } from './testPrompt35InvestorStatement';
import { runPrompt36PeriodEndValuationTests } from './testPrompt36PeriodEndValuation';
import { runFinalTestACapitalReconciliation } from './testFinalTestACapitalReconciliation';
import { runFinalTestBProfitReconciliation } from './testFinalTestBProfitReconciliation';
import { runFinalTestCNavReconciliation } from './testFinalTestCNavReconciliation';
import { runFinalTestDHistoricalProtection } from './testFinalTestDHistoricalProtection';
import { runFinalTestECompleteGoldenScenario } from './testFinalTestECompleteGoldenScenario';
import { runFinalTestFLateInvestorScenario } from './testFinalTestFLateInvestorScenario';
import { runFinalTestGDuplicateCrashRetry } from './testFinalTestGDuplicateCrashRetry';
import { runFinalTestHProductionFreeze } from './testFinalTestHProductionFreeze';

interface SuiteResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

import fs from 'fs';
import path from 'path';

// Ensure test runner has a valid session secret and pin configured
if (!process.env.SESSION_SECRET) {
  try {
    const durableSecretPath = path.join(process.cwd(), 'data', '.session_secret');
    if (fs.existsSync(durableSecretPath)) {
      process.env.SESSION_SECRET = fs.readFileSync(durableSecretPath, 'utf8').trim();
    }
  } catch {}
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599';
  }
}
if (!process.env.INITIAL_PIN) {
  process.env.INITIAL_PIN = '849201';
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
  suiteResults.push(await runInvestmentTrancheModelTests());
  suiteResults.push(await runContractualPercentagePerTrancheTests());
  suiteResults.push(await runValuationEventTests());
  suiteResults.push(await runNetAssetValuationTests());
  suiteResults.push(await runInvestorEntrySnapshotTests());
  suiteResults.push(await runNewInvestorEntryValuationTests());
  suiteResults.push(await runSeparateBusinessProfitFromInvestorProfitTests());
  suiteResults.push(await runCapitalParticipationAllocationTests());
  suiteResults.push(await runSameTimeEqualInvestmentsTests());
  suiteResults.push(await runPrompt02TrancheStructureTests());
  suiteResults.push(await runSeparatePersonFromCapacityTests());
  suiteResults.push(await runIndividualContractPercentageTests());
  suiteResults.push(await runEffectiveInvestmentDatesTests());
  suiteResults.push(await runCapitalMovementLedgerTests());
  suiteResults.push(await runValuationReconciliationGateTests());
  suiteResults.push(await runPhysicalInventoryAdjustmentTests());
  suiteResults.push(await runFixedAssetVerificationTests());
  suiteResults.push(await runLiabilityVerificationTests());
  suiteResults.push(await runCorrectNavFormulaTests());
  suiteResults.push(await runSeparateProfitFromValuationTests());
  suiteResults.push(await runImmutableValuationSnapshotTests());
  suiteResults.push(await runValuationPreviewNoMutationTests());
  suiteResults.push(await runPrompt15AdmissionRequestTests());
  suiteResults.push(await runPrompt16BlockAdmissionWithoutFinalValuationTests());
  suiteResults.push(await runPrompt17PreMoneyNavAdmissionValuationTests());
  suiteResults.push(await runPrompt18PostMoneyNavTests());
  suiteResults.push(await runPrompt19NewInvestorParticipationTests());
  suiteResults.push(await runPrompt20ProtectHistoricalProfitTests());
  suiteResults.push(await runPrompt21CapitalReceiptTests());
  suiteResults.push(await runPrompt22FinalizeAdmissionAtomicallyTests());
  suiteResults.push(await runPrompt23CreateProfitPoolTests());
  suiteResults.push(await runPrompt24EconomicAllocationByCapitalTests());
  suiteResults.push(await runPrompt27Full300ProfitGoldenCalculationTests());
  suiteResults.push(await runPrompt28LossHandlingTests());
  suiteResults.push(await runPrompt29ProfitSettlementPreviewTests());
  suiteResults.push(await runPrompt30PartialReinvestmentTests());
  suiteResults.push(await runPrompt31ReinvestmentCreatesNewCapitalTrancheTests());
  suiteResults.push(await runPrompt32OwnerMudaribReinvestmentTests());
  suiteResults.push(await runPrompt33SettlementIdempotencyTests());
  suiteResults.push(await runPrompt34CrashSafeFinalizationTests());
  suiteResults.push(await runPrompt35InvestorStatementTests());
  suiteResults.push(await runPrompt36PeriodEndValuationTests());
  suiteResults.push(await runFinalTestACapitalReconciliation());
  suiteResults.push(await runFinalTestBProfitReconciliation());
  suiteResults.push(await runFinalTestCNavReconciliation());
  suiteResults.push(await runFinalTestDHistoricalProtection());
  suiteResults.push(await runFinalTestECompleteGoldenScenario());
  suiteResults.push(await runFinalTestFLateInvestorScenario());
  suiteResults.push(await runFinalTestGDuplicateCrashRetry());
  suiteResults.push(await runFinalTestHProductionFreeze());

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
