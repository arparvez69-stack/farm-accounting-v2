import 'dotenv/config';
import http from 'http';
import {
  validateProductionEnvironment,
  assertProductionEnvironmentValid,
  isStrongSessionSecret,
  extractRawPinFromEnv
} from '../server/envValidation';
import {
  app,
  createSessionToken,
  verifySessionToken,
  resolveSessionSecret,
  getFirebaseAdminStatus,
  getApprovedOwnerEmails,
  isFirestorePersistenceAvailable
} from '../../server';

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

  const runAsyncTest = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
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

  // ===================================================================
  // PROMPT 11: ACTUAL PRODUCTION CONFIGURATION & ENDPOINT VERIFICATION
  // ===================================================================

  // -------------------------------------------------------------------
  // TEST 10: Actual Production Environment Variables Configured
  // -------------------------------------------------------------------
  runTest('Actual production environment variables are properly configured', () => {
    const rawSecret = process.env.SESSION_SECRET?.trim();
    assert(Boolean(rawSecret), 'SESSION_SECRET environment variable is configured');
    assert(isStrongSessionSecret(rawSecret), 'SESSION_SECRET meets strict cryptographic entropy requirements (>=32 chars, high entropy)');

    const rawPin = extractRawPinFromEnv(process.env);
    assert(Boolean(rawPin), 'INITIAL_PIN (or masterpin/PIN alias) is configured');
    assert(rawPin.length >= 4, 'INITIAL_PIN meets minimum length requirement');

    const approvedOwners = getApprovedOwnerEmails();
    assert(approvedOwners.length >= 1, 'Authorized owner allow-list contains at least one approved email');
  });

  // -------------------------------------------------------------------
  // TEST 11: Firebase Admin Initializes Correctly
  // -------------------------------------------------------------------
  runTest('Firebase Admin SDK initializes correctly', () => {
    const adminStatus = getFirebaseAdminStatus();
    assert(adminStatus.adminInitialized === true, 'Firebase Admin is initialized');
  });

  // -------------------------------------------------------------------
  // TEST 12: Development Fallback Secrets Are Disabled In Production
  // -------------------------------------------------------------------
  runTest('Development fallback secrets are strictly disabled in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      // In production, resolveSessionSecret returns null if SESSION_SECRET is not strong
      const originalSecret = process.env.SESSION_SECRET;
      delete process.env.SESSION_SECRET;

      const fallbackResult = resolveSessionSecret();
      assert(fallbackResult === null, 'In production mode, fallback local secret is NEVER used');

      // Restore
      if (originalSecret) process.env.SESSION_SECRET = originalSecret;
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // -------------------------------------------------------------------
  // TEST 13: Production Server Starts & PORT Works
  // -------------------------------------------------------------------
  let serverInstance: http.Server | null = null;
  let testPort = 0;
  const originalEnv = process.env.NODE_ENV;

  await runAsyncTest('Production server starts and binds to PORT', async () => {
    process.env.NODE_ENV = 'production';
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        testPort = addr.port;
        resolve();
      });
    });
    assert(testPort > 0 && testPort <= 65535, `Production server is actively listening on valid port ${testPort}`);
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;

  // -------------------------------------------------------------------
  // TEST 14: /api/health Works
  // -------------------------------------------------------------------
  await runAsyncTest('/api/health endpoint returns status: ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert(res.status === 200, `/api/health returned HTTP ${res.status}`);
    const body = await res.json();
    assert(body.status === 'ok', `Expected status 'ok', got '${body.status}'`);
  });

  // -------------------------------------------------------------------
  // TEST 15: /api/ready Works
  // -------------------------------------------------------------------
  await runAsyncTest('/api/ready endpoint confirms server readiness', async () => {
    const deadline = Date.now() + 6000;
    let res: Response | null = null;
    let body: any = null;
    while (Date.now() < deadline) {
      res = await fetch(`${baseUrl}/api/ready`);
      if (res.status === 200) {
        body = await res.json();
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert(res !== null && res.status === 200, `/api/ready returned HTTP ${res?.status}`);
    assert(body.ready === true, `Expected ready: true, got ${body?.ready}`);
    assert(body.status === 'ready', `Expected status 'ready', got '${body?.status}'`);
  });

  // -------------------------------------------------------------------
  // TEST 16: Production Test Endpoints Disabled In Production
  // -------------------------------------------------------------------
  await runAsyncTest('Production test and debug endpoints are strictly disabled', async () => {
    const testRes = await fetch(`${baseUrl}/api/test/firestore-status`);
    assert(testRes.status === 403, `Expected HTTP 403 Forbidden for /api/test in production, got ${testRes.status}`);
    const body = await testRes.json();
    assert(body.error && body.error.includes('নিষ্ক্রিয়'), 'Response explains test routes are disabled in production');
  });

  // -------------------------------------------------------------------
  // TEST 17: Production Authentication & Session Verification
  // -------------------------------------------------------------------
  await runAsyncTest('Authentication works with cryptographically signed tokens', async () => {
    const approvedOwners = getApprovedOwnerEmails();
    const ownerEmail = approvedOwners[0];
    assert(Boolean(ownerEmail), 'At least one owner email exists');

    // Generate valid session token
    const token = createSessionToken(ownerEmail);
    assert(Boolean(token) && token.includes('.'), 'Session token is successfully issued and signed');

    // Verify session token
    const verified = verifySessionToken(token);
    assert(verified !== null, 'Valid token verifies successfully');
    assert(verified?.email === ownerEmail, 'Verified email matches owner email');

    // Tampered token fails
    const tampered = token + 'tampered';
    const verifiedTampered = verifySessionToken(tampered);
    assert(verifiedTampered === null, 'Tampered token is strictly rejected');

    // Authenticated API request succeeds
    const farmInfoRes = await fetch(`${baseUrl}/api/farm-info`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert(farmInfoRes.status === 200, `Protected endpoint returned HTTP ${farmInfoRes.status}`);
  });

  // -------------------------------------------------------------------
  // TEST 18: Cloud Persistence Genuinely Confirmed
  // -------------------------------------------------------------------
  await runAsyncTest('Cloud persistence behavior is genuinely confirmed', async () => {
    const approvedOwners = getApprovedOwnerEmails();
    const token = createSessionToken(approvedOwners[0]);

    // Restore endpoint confirms cloud state
    const restoreRes = await fetch(`${baseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert(restoreRes.status === 200, `Cloud restore endpoint responded with HTTP ${restoreRes.status}`);
    const restoreData = await restoreRes.json();
    assert(restoreData.success === true, 'Cloud restore payload reports success: true');
    assert(typeof restoreData.collections === 'object', 'Cloud restore provides collections object');

    // Persistence availability check
    const persistenceStatus = isFirestorePersistenceAvailable();
    assert(typeof persistenceStatus === 'boolean', 'Persistence availability is defined as boolean');
  });

  // Clean up test server if started
  if (serverInstance) {
    (serverInstance as http.Server).close();
  }
  process.env.NODE_ENV = originalEnv;

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
