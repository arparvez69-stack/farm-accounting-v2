import 'dotenv/config';

// Ensure test runner has secure non-default secrets configured
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599';
}
if (!process.env.INITIAL_PIN) {
  process.env.INITIAL_PIN = '95817283';
}

import http from 'http';
import {
  app,
  getApprovedOwnerEmails,
  clearRateLimitsForTest,
  clearRevokedSessionsForTest
} from '../../server';
import { extractRawPinFromEnv } from '../server/envValidation';

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

function assert(condition: boolean, message: string, summary: TestSummary) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    summary.failed++;
    summary.failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
  }
}

/**
 * Task 6 Regression Test:
 * Proves that all known default PINs (including 849201 and 123456) are strictly rejected
 * for owner authentication, while only the securely configured/stored secret is accepted.
 */
export async function runDefaultPinRejectionRegressionTest(): Promise<TestSummary> {
  const summary: TestSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n========================================================');
  console.log('STARTING TASK 6 FOCUSED REGRESSION TEST');
  console.log('Verifying default PIN rejection and secure secret authentication');
  console.log('========================================================\n');

  // Start ephemeral server
  let serverInstance: http.Server | null = null;
  let testPort = 0;
  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const addr = serverInstance!.address() as any;
      testPort = addr.port;
      resolve();
    });
  });
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    const approvedOwners = getApprovedOwnerEmails();
    const ownerEmail = approvedOwners[0] || 'arparvez4@gmail.com';
    const SECURE_CONFIGURED_PIN = extractRawPinFromEnv(process.env) || '95817283';

    // List of known default/literal PIN candidates that must ALWAYS be rejected
    const KNOWN_DEFAULT_PINS_TO_REJECT = [
      '849201',
      '123456',
      '1234',
      '12345',
      '654321',
      '0000',
      '000000',
      '1111',
      '111111',
      '112233'
    ];

    // Ensure state is clean before test
    clearRevokedSessionsForTest();
    clearRateLimitsForTest();

    // -------------------------------------------------------------------------
    // TEST 1: Every known default PIN must be REJECTED with HTTP 401
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Known Default PINs Are Strictly Rejected ---');
    for (const badPin of KNOWN_DEFAULT_PINS_TO_REJECT) {
      clearRateLimitsForTest(); // Avoid rate-limiting so we verify credential failure specifically

      const res = await fetch(`${baseUrl}/api/verify-login-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, code: badPin })
      });

      assert(
        res.status === 401,
        `Default PIN '${badPin}' is rejected for ${ownerEmail} with HTTP 401 (got ${res.status})`,
        summary
      );

      const data = await res.json();
      assert(
        data.success !== true,
        `Default PIN '${badPin}' response confirms success is not true`,
        summary
      );
      assert(
        !data.sessionToken,
        `Default PIN '${badPin}' never returns a sessionToken`,
        summary
      );
    }

    // -------------------------------------------------------------------------
    // TEST 2: The securely configured / stored secret remains valid
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Securely Configured Secret Is Accepted ---');
    clearRateLimitsForTest();

    const validRes = await fetch(`${baseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, code: SECURE_CONFIGURED_PIN })
    });

    assert(
      validRes.status === 200,
      `Valid secret PIN authenticates ${ownerEmail} with HTTP 200`,
      summary
    );

    const validData = await validRes.json();
    assert(validData.success === true, 'Login confirms success: true', summary);
    assert(validData.role === 'OWNER', 'Login assigns role: "OWNER"', summary);
    assert(
      typeof validData.sessionToken === 'string' && validData.sessionToken.includes('.'),
      'Login returns cryptographically signed sessionToken',
      summary
    );

    // -------------------------------------------------------------------------
    // TEST 3: Attempting PIN change with default PIN fails
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Change PIN Rejects Default PIN as Current PIN ---');
    const changeWithDefaultRes = await fetch(`${baseUrl}/api/change-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ownerEmail,
        currentPin: '849201',
        newPin: '99887766'
      })
    });

    assert(
      changeWithDefaultRes.status === 401,
      `Change PIN with default PIN '849201' is rejected with HTTP 401 (got ${changeWithDefaultRes.status})`,
      summary
    );

    // -------------------------------------------------------------------------
    // TEST 4: Empty / missing credentials fail closed
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Missing or Empty PIN Fails Closed ---');
    const emptyPinRes = await fetch(`${baseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, code: '' })
    });
    assert(
      emptyPinRes.status === 400 || emptyPinRes.status === 401,
      `Empty PIN is rejected with HTTP 400/401 (got ${emptyPinRes.status})`,
      summary
    );

    console.log('\n========================================================');
    console.log(`TASK 6 REGRESSION RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
    console.log('========================================================\n');
  } finally {
    if (serverInstance) {
      (serverInstance as http.Server).close();
    }
  }

  return summary;
}

if (process.argv[1]?.endsWith('testDefaultPinRejectionRegression.ts')) {
  runDefaultPinRejectionRegressionTest()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
