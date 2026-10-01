import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  app,
  getApprovedOwnerEmails,
  isOwnerEmail,
  clearRateLimitsForTest,
  clearRevokedSessionsForTest
} from '../../server';

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

function assert(condition: boolean, description: string, summary: TestSummary) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ [PASS] ${description}`);
  } else {
    summary.failed++;
    summary.failures.push(description);
    console.error(`  ❌ [FAIL] ${description}`);
  }
}

/**
 * TASK 8: Focused Test — Proves Unauthenticated Requests Cannot Retrieve Complete Owner Allow-List
 *
 * Requirements:
 * 1. Keep the authoritative five-owner allow-list unchanged.
 * 2. Remove the full owner-email list from the public login screen.
 * 3. Login authentication must validate the supplied owner identity server-side against the authoritative allow-list.
 * 4. Do not expose the complete allow-list through an unauthenticated API.
 * 5. Do not change owner authorization itself.
 */
export async function runNoUnauthenticatedAllowListDisclosureTest(): Promise<TestSummary> {
  const summary: TestSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n================================================================');
  console.log('TASK 8: UNAUTHENTICATED OWNER ALLOW-LIST DISCLOSURE TEST');
  console.log('Verifying zero disclosure of owner allow-list to unauthenticated callers');
  console.log('================================================================\n');

  const rootDir = process.cwd();

  // -------------------------------------------------------------------------
  // 1. Authoritative 5-Owner Allow-List is Unchanged
  // -------------------------------------------------------------------------
  console.log('--- 1. Authoritative Five-Owner Allow-List Unchanged ---');
  const EXPECTED_FIVE_OWNERS = [
    'arparvez111@gmail.com',
    'arparvez69@gmail.com',
    'arparvez4@gmail.com',
    'lubaiyatasnum111@gmail.com',
    'atikurrahman00021@gmail.com'
  ];

  const approvedEmails = getApprovedOwnerEmails();
  assert(
    approvedEmails.length === 5,
    `Authoritative allow-list retains exactly 5 owners (found ${approvedEmails.length})`,
    summary
  );

  for (const owner of EXPECTED_FIVE_OWNERS) {
    assert(
      approvedEmails.includes(owner),
      `Authoritative owner '${owner}' is present in allow-list`,
      summary
    );
    assert(
      isOwnerEmail(owner),
      `isOwnerEmail('${owner}') strictly returns true`,
      summary
    );
  }

  // -------------------------------------------------------------------------
  // 2. Static Analysis: LoginScreen UI Has Zero Email Disclosure
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Static Analysis: LoginScreen UI Email Disclosure Removal ---');
  const loginScreenPath = path.join(rootDir, 'src', 'components', 'LoginScreen.tsx');
  assert(fs.existsSync(loginScreenPath), 'LoginScreen.tsx exists', summary);

  const loginScreenContent = fs.readFileSync(loginScreenPath, 'utf8');

  // Must not import or reference AUTHORIZED_OWNER_EMAILS in LoginScreen
  assert(
    !loginScreenContent.includes('AUTHORIZED_OWNER_EMAILS'),
    'LoginScreen.tsx does NOT import or reference AUTHORIZED_OWNER_EMAILS',
    summary
  );

  // Must not contain buttons or selectors mapping through owner emails
  assert(
    !/authorizedOwners\.map/i.test(loginScreenContent),
    'LoginScreen.tsx does not map or loop over authorized owner emails to render selectors',
    summary
  );
  assert(
    !loginScreenContent.includes('Authorized Account:') && !loginScreenContent.includes('অনুমোদিত অ্যাকাউন্ট:'),
    'LoginScreen.tsx does not render quick owner email selector labels',
    summary
  );

  // Must not hardcode any owner email as default state
  for (const owner of EXPECTED_FIVE_OWNERS) {
    assert(
      !loginScreenContent.includes(`'${owner}'`) && !loginScreenContent.includes(`"${owner}"`),
      `LoginScreen.tsx does not hardcode owner email '${owner}' in source`,
      summary
    );
  }

  // -------------------------------------------------------------------------
  // 3. Dynamic Server API: Unauthenticated Requests Cannot Retrieve Allow-List
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Dynamic API: Unauthenticated Endpoints Hide Complete Allow-List ---');
  let serverInstance: http.Server | null = null;
  let testPort = 0;

  process.env.SESSION_SECRET = process.env.SESSION_SECRET || '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599';
  process.env.INITIAL_PIN = process.env.INITIAL_PIN || '95817283';

  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const addr = serverInstance!.address() as any;
      testPort = addr.port;
      resolve();
    });
  });
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    clearRevokedSessionsForTest();
    clearRateLimitsForTest();

    // A. GET /api/farm-info unauthenticated
    const farmInfoRes = await fetch(`${baseUrl}/api/farm-info`);
    assert(farmInfoRes.status === 200, '/api/farm-info responds with HTTP 200', summary);
    const farmInfoData = await farmInfoRes.json();
    const farmInfoRawText = JSON.stringify(farmInfoData);

    assert(
      farmInfoData.authorizedEmails === undefined,
      'Unauthenticated /api/farm-info does NOT contain authorizedEmails field',
      summary
    );
    assert(
      typeof farmInfoData.authorizedOwnersCount === 'number' && farmInfoData.authorizedOwnersCount === 5,
      'Unauthenticated /api/farm-info safely provides count without disclosing email strings',
      summary
    );

    // Ensure none of the 5 owner emails appear in the raw JSON response text
    for (const owner of EXPECTED_FIVE_OWNERS) {
      assert(
        !farmInfoRawText.toLowerCase().includes(owner.toLowerCase()),
        `Unauthenticated /api/farm-info does not leak email '${owner}'`,
        summary
      );
    }

    // B. Public endpoints /api/health and /api/ready do not leak allow-list
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthText = await healthRes.text();
    for (const owner of EXPECTED_FIVE_OWNERS) {
      assert(
        !healthText.toLowerCase().includes(owner.toLowerCase()),
        `/api/health does not contain owner email '${owner}'`,
        summary
      );
    }

    // C. Protected endpoints without authentication fail closed with 401 and zero email disclosure
    const protectedGetEndpoints = [
      '/api/access-logs',
      '/api/sync/restore'
    ];

    for (const endpoint of protectedGetEndpoints) {
      const unauthRes = await fetch(`${baseUrl}${endpoint}`);
      assert(
        unauthRes.status === 401,
        `Unauthenticated GET ${endpoint} returns HTTP 401 Unauthorized (got ${unauthRes.status})`,
        summary
      );
      const unauthText = await unauthRes.text();
      for (const owner of EXPECTED_FIVE_OWNERS) {
        assert(
          !unauthText.toLowerCase().includes(owner.toLowerCase()),
          `Unauthenticated ${endpoint} response does not leak owner email '${owner}'`,
          summary
        );
      }
    }

    const protectedPostEndpoints = [
      '/api/sync/animals',
      '/api/sync/journalEntries'
    ];

    for (const endpoint of protectedPostEndpoints) {
      const unauthRes = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test' })
      });
      assert(
        unauthRes.status === 401,
        `Unauthenticated POST ${endpoint} returns HTTP 401 Unauthorized (got ${unauthRes.status})`,
        summary
      );
      const unauthText = await unauthRes.text();
      for (const owner of EXPECTED_FIVE_OWNERS) {
        assert(
          !unauthText.toLowerCase().includes(owner.toLowerCase()),
          `Unauthenticated ${endpoint} response does not leak owner email '${owner}'`,
          summary
        );
      }
    }

    // D. Login authentication endpoint validates identity server-side against allow-list
    // Unknown/unauthorized email rejected with identical 401 error as bad PIN
    const strangerRes = await fetch(`${baseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'stranger_attacker@evil.com', code: '95817283' })
    });
    assert(strangerRes.status === 401, 'Unauthorized email login fails with HTTP 401', summary);
    const strangerData = await strangerRes.json();
    assert(
      strangerData.error?.includes('অবৈধ ইমেইল অথবা গোপন পিন'),
      'Unauthorized email returns generic invalid credentials error (no disclosure of valid owners)',
      summary
    );
    assert(
      !JSON.stringify(strangerData).includes('authorizedEmails'),
      'Failed login response does not contain authorizedEmails',
      summary
    );

    // E. Legitimate owner with valid PIN CAN authenticate and retrieve session
    clearRateLimitsForTest();
    const legitOwner = EXPECTED_FIVE_OWNERS[0];
    const validLoginRes = await fetch(`${baseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: legitOwner, code: '95817283' })
    });
    assert(validLoginRes.status === 200, 'Legitimate owner authenticates with HTTP 200', summary);
    const validLoginData = await validLoginRes.json();
    assert(
      validLoginData.success === true && validLoginData.role === 'OWNER',
      'Successful login confirms OWNER role',
      summary
    );
    const sessionToken = validLoginData.sessionToken;
    assert(typeof sessionToken === 'string' && sessionToken.length > 20, 'Session token issued to verified owner', summary);

    // F. Authenticated owner CAN access protected /api/farm-info with authorizedEmails
    const authFarmInfoRes = await fetch(`${baseUrl}/api/farm-info`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert(authFarmInfoRes.status === 200, 'Authenticated /api/farm-info returns HTTP 200', summary);
    const authFarmInfoData = await authFarmInfoRes.json();
    assert(
      Array.isArray(authFarmInfoData.authorizedEmails) && authFarmInfoData.authorizedEmails.length === 5,
      'Authenticated owner can retrieve authorizedEmails list',
      summary
    );
  } finally {
    if (serverInstance) {
      (serverInstance as http.Server).close();
    }
  }

  console.log('\n================================================================');
  console.log(`TASK 8 RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

if (process.argv[1]?.endsWith('testNoUnauthenticatedAllowListDisclosure.ts')) {
  runNoUnauthenticatedAllowListDisclosureTest()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error running Task 8 test:', err);
      process.exit(1);
    });
}
