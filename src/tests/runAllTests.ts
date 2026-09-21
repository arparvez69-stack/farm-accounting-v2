import { runRegressionTests } from './regressionTests';
import { runCashFlowAccountingTests } from './testCashFlowAccounting';

async function main() {
  console.log('====================================================');
  console.log('RUNNING REGRESSION TEST SUITE');
  console.log('Including separate verification of Profit Allocation and Profit Payment');
  console.log('====================================================');

  const result1 = await runRegressionTests();
  const result2 = await runCashFlowAccountingTests();

  const total = result1.total + result2.total;
  const passed = result1.passed + result2.passed;
  const failed = result1.failed + result2.failed;
  const failures = [...result1.failures, ...result2.failures];
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
