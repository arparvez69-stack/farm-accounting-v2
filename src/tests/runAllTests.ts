import { runRegressionTests } from './regressionTests';

async function main() {
  console.log('====================================================');
  console.log('RUNNING REGRESSION TEST SUITE');
  console.log('Including separate verification of Profit Allocation and Profit Payment');
  console.log('====================================================');

  const result = await runRegressionTests();

  console.log('\n====================================================');
  console.log('TEST SUITE RESULTS:');
  console.log(`Success: ${result.success}`);
  console.log(`Total assertions: ${result.total}`);
  console.log(`Passed assertions: ${result.passed}`);
  console.log(`Failed assertions: ${result.failed}`);
  console.log('====================================================');

  if (result.failures.length > 0) {
    console.error('\nFAILURES:');
    result.failures.forEach((f, idx) => {
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
