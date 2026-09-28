import {
  validateProductionEnvironment,
  assertProductionEnvironmentValid,
  isStrongSessionSecret
} from '../server/envValidation';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runProductionEnvironmentValidationTests(): Promise<{
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}> {
  console.log('\n========================================================');
  console.log('STARTING PRODUCTION ENVIRONMENT VALIDATION TESTS');
  console.log('========================================================');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
      console.log(`✅ PASS: ${name}`);
    } catch (err: any) {
      failed++;
      failures.push(`${name}: ${err.message}`);
      console.error(`❌ FAIL: ${name} -> ${err.message}`);
    }
  };

  const VALID_STRONG_SECRET = 'e4b2c9d817f045a382c7104b9e28f16c5d9a0b3c4e5f60718293a4b5c6d7e8f9';
  const VALID_PIN = '849201';

  // -------------------------------------------------------------------
  // TEST 1: Valid Production Environment
  // -------------------------------------------------------------------
  runTest('Valid production configuration passes validation', () => {
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: VALID_STRONG_SECRET,
        INITIAL_PIN: VALID_PIN,
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });

    assert(result.valid === true, 'Validation result should be valid');
    assert(result.errors.length === 0, 'No errors should be recorded');
  });

  // -------------------------------------------------------------------
  // TEST 2: Missing SESSION_SECRET in Production
  // -------------------------------------------------------------------
  runTest('Fails startup when SESSION_SECRET is missing in production', () => {
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        INITIAL_PIN: VALID_PIN,
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });

    assert(result.valid === false, 'Should be invalid');
    assert(
      result.errors.some((e) => e.includes('SESSION_SECRET') && e.includes('Missing required secret')),
      'Should report missing SESSION_SECRET'
    );

    let threw = false;
    let thrownMessage = '';
    try {
      assertProductionEnvironmentValid({
        env: {
          NODE_ENV: 'production',
          INITIAL_PIN: VALID_PIN,
          APPROVED_OWNER_EMAILS: 'owner@example.com'
        }
      });
    } catch (err: any) {
      threw = true;
      thrownMessage = err.message;
    }
    assert(threw, 'assertProductionEnvironmentValid should throw');
    assert(thrownMessage.includes('SESSION_SECRET'), 'Thrown message should mention SESSION_SECRET');
  });

  // -------------------------------------------------------------------
  // TEST 3: Weak / Insecure Default SESSION_SECRET in Production
  // -------------------------------------------------------------------
  runTest('Fails startup when SESSION_SECRET is weak or default in production', () => {
    const weakSecret = 'the-goated-farm-session-secret-salt-2025';
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: weakSecret,
        INITIAL_PIN: VALID_PIN,
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });

    assert(result.valid === false, 'Should be invalid');
    assert(
      result.errors.some((e) => e.includes('SESSION_SECRET') && e.includes('cryptographic strength')),
      'Should report weak SESSION_SECRET'
    );

    // CRITICAL: NEVER print secret value
    const allErrorsText = result.errors.join(' ');
    assert(!allErrorsText.includes(weakSecret), 'Secret value must NEVER appear in error messages');
  });

  // -------------------------------------------------------------------
  // TEST 4: Missing INITIAL_PIN in Production
  // -------------------------------------------------------------------
  runTest('Fails startup when INITIAL_PIN is missing in production', () => {
    const secretValue = VALID_STRONG_SECRET;
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: secretValue,
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });

    assert(result.valid === false, 'Should be invalid');
    assert(
      result.errors.some((e) => e.includes('INITIAL_PIN') || e.includes('PIN')),
      'Should report missing INITIAL_PIN'
    );

    let threw = false;
    try {
      assertProductionEnvironmentValid({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: secretValue,
          APPROVED_OWNER_EMAILS: 'owner@example.com'
        }
      });
    } catch {
      threw = true;
    }
    assert(threw, 'assertProductionEnvironmentValid should throw when PIN missing');
  });

  // -------------------------------------------------------------------
  // TEST 5: Supports PIN aliases (MASTER_PIN, masterpin, PIN, etc.)
  // -------------------------------------------------------------------
  runTest('Recognizes supported aliases for INITIAL_PIN', () => {
    const aliases = ['MASTER_PIN', 'INITIAL_MASTER_PIN', 'masterpin', 'MASTERPIN', 'PIN', 'pin'];
    for (const alias of aliases) {
      const result = validateProductionEnvironment({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: VALID_STRONG_SECRET,
          [alias]: '918273',
          APPROVED_OWNER_EMAILS: 'owner@example.com'
        }
      });
      assert(result.valid === true, `Alias ${alias} should be recognized as valid PIN`);
    }
  });

  // -------------------------------------------------------------------
  // TEST 6: Missing Authorized Owner Emails in Production
  // -------------------------------------------------------------------
  runTest('Fails startup when no authorized owner emails are available', () => {
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: VALID_STRONG_SECRET,
        INITIAL_PIN: VALID_PIN,
        APPROVED_OWNER_EMAILS: ''
      },
      allowListPath: '/non-existent-path/no-file.json'
    });

    assert(result.valid === false, 'Should be invalid without owner emails');
    assert(
      result.errors.some((e) => e.includes('owner email')),
      'Should report missing authorized owner email'
    );
  });

  // -------------------------------------------------------------------
  // TEST 7: Invalid PORT Format
  // -------------------------------------------------------------------
  runTest('Fails startup when PORT is not a valid port number', () => {
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: VALID_STRONG_SECRET,
        INITIAL_PIN: VALID_PIN,
        APPROVED_OWNER_EMAILS: 'owner@example.com',
        PORT: '999999'
      }
    });

    assert(result.valid === false, 'Should be invalid with out-of-range port');
    assert(result.errors.some((e) => e.includes('PORT')), 'Should report PORT error');
  });

  // -------------------------------------------------------------------
  // TEST 8: Secrets are NEVER exposed in error strings
  // -------------------------------------------------------------------
  runTest('Never prints or leaks secret values in error messages or exceptions', () => {
    const testSecret = 'SUPER_SECRET_VALUE_DO_NOT_REVEAL_9999';
    const testPin = '987654321_PRIVATE_PIN';

    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: testSecret,
        INITIAL_PIN: testPin,
        APPROVED_OWNER_EMAILS: ''
      }
    });

    const concatenatedOutput = result.errors.join(' ') + ' ' + result.warnings.join(' ');
    assert(!concatenatedOutput.includes(testSecret), 'Error output must not contain secret');
    assert(!concatenatedOutput.includes(testPin), 'Error output must not contain PIN');

    let thrownMessage = '';
    try {
      assertProductionEnvironmentValid({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: 'short-weak',
          INITIAL_PIN: testPin,
          APPROVED_OWNER_EMAILS: ''
        }
      });
    } catch (err: any) {
      thrownMessage = err.message;
    }
    assert(!thrownMessage.includes('short-weak'), 'Thrown exception must not leak secret');
    assert(!thrownMessage.includes(testPin), 'Thrown exception must not leak PIN');
  });

  // -------------------------------------------------------------------
  // TEST 9: Non-Production Graceful Behavior
  // -------------------------------------------------------------------
  runTest('Non-production environments do not fail startup on missing production secrets', () => {
    const result = validateProductionEnvironment({
      env: {
        NODE_ENV: 'development'
      }
    });

    assert(result.valid === true, 'Non-production should return valid=true');
    assert(result.errors.length === 0, 'No errors in non-production mode');
  });

  console.log('========================================================');
  console.log(`PRODUCTION ENVIRONMENT VALIDATION RESULTS: Passed: ${passed}, Failed: ${failed}`);
  console.log('========================================================');

  return { total: passed + failed, passed, failed, failures };
}

if (process.argv[1]?.endsWith('testProductionEnvironmentValidation.ts')) {
  runProductionEnvironmentValidationTests().then((res) => {
    if (res.failed > 0) process.exit(1);
  });
}
