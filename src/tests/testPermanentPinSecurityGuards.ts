import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  app,
  getApprovedOwnerEmails,
  clearRateLimitsForTest,
  clearRevokedSessionsForTest
} from '../../server';
import {
  extractRawPinFromEnv,
  validateProductionEnvironment,
  assertProductionEnvironmentValid,
  INSECURE_DEFAULT_PINS
} from '../server/envValidation';

export interface GuardTestSummary {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

function assert(condition: boolean, description: string, summary: GuardTestSummary) {
  summary.total++;
  if (condition) {
    summary.passed++;
    console.log(`  ✅ [GUARD PASS] ${description}`);
  } else {
    summary.failed++;
    summary.failures.push(description);
    console.error(`  ❌ [GUARD FAIL] ${description}`);
  }
}

/**
 * Permanent PIN Security Guards (Task 7):
 * Automated regression checks that permanently prevent:
 * 1. Hard-coded login PINs in production source
 * 2. Default PIN fallback in production source
 * 3. PIN auto-fill in LoginScreen/UI
 * 4. PIN displayed in login UI/text
 * 5. Authentication fallback to common/default PINs
 * 6. Missing secret allowing login (fails closed)
 * 7. Test-only credentials leaking into production source
 */
export async function runPermanentPinSecurityGuards(): Promise<GuardTestSummary> {
  const summary: GuardTestSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  console.log('\n================================================================');
  console.log('TASK 7: PERMANENT PIN SECURITY GUARDS & REGRESSION CHECKS');
  console.log('Verifying static code guards and dynamic authentication security');
  console.log('================================================================\n');

  const rootDir = process.cwd();

  // Helper to collect all production source files (excluding tests, node_modules, build output, data, git)
  function getProductionSourceFiles(dir: string, fileList: string[] = []): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === 'tests' ||
          entry.name === 'data' ||
          entry.name === 'public'
        ) {
          continue;
        }
        getProductionSourceFiles(fullPath, fileList);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.js') ||
          entry.name.endsWith('.jsx') ||
          entry.name === 'index.html')
      ) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const productionFiles = getProductionSourceFiles(path.join(rootDir, 'src'));
  const rootServerFile = path.join(rootDir, 'server.ts');
  if (fs.existsSync(rootServerFile)) {
    productionFiles.push(rootServerFile);
  }

  // =========================================================================
  // GUARD 1: STATIC ANALYSIS — NO HARD-CODED LOGIN PINS IN PRODUCTION SOURCE
  // =========================================================================
  console.log('--- Guard 1: Static Source Check for Hard-coded Login PINs ---');
  const knownForbiddenPins = ['849201', '123456', '654321'];

  for (const filePath of productionFiles) {
    const relPath = path.relative(rootDir, filePath);
    // envValidation.ts defines INSECURE_DEFAULT_PINS for blacklisting/rejection purposes
    if (relPath === 'src/server/envValidation.ts') continue;

    const content = fs.readFileSync(filePath, 'utf8');

    for (const pin of knownForbiddenPins) {
      // Check for PIN literals used in variable assignments or auth checks
      const forbiddenPattern = new RegExp(
        `(?:pin|password|secret|loginCode|masterPin|currentPin|newPin)\\s*[:=]\\s*['"\`]${pin}['"\`]`,
        'i'
      );
      assert(
        !forbiddenPattern.test(content),
        `No hardcoded PIN '${pin}' in ${relPath}`,
        summary
      );
    }
  }

  // =========================================================================
  // GUARD 2: STATIC ANALYSIS — NO DEFAULT PIN FALLBACK IN PRODUCTION SOURCE
  // =========================================================================
  console.log('\n--- Guard 2: Static Source Check for Default PIN Fallback ---');
  for (const filePath of productionFiles) {
    const relPath = path.relative(rootDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    // Reject fallback operators leading to numeric PIN string literals
    const fallbackWithPin = /(?:rawPin|pin|secret|envPin|extractRawPinFromEnv\([^)]*\)|getRawPinEnv\([^)]*\))\s*(?:\|\||\?\?)\s*['"`](?:849201|123456|654321|112233|000000|1234|12345)['"`]/i;
    assert(
      !fallbackWithPin.test(content),
      `No default PIN fallback syntax in ${relPath}`,
      summary
    );
  }

  // =========================================================================
  // GUARD 3: STATIC ANALYSIS — NO PIN AUTO-FILL IN LOGIN UI
  // =========================================================================
  console.log('\n--- Guard 3: Static Source Check for PIN Auto-fill ---');
  const loginScreenPath = path.join(rootDir, 'src', 'components', 'LoginScreen.tsx');
  assert(fs.existsSync(loginScreenPath), 'LoginScreen.tsx exists', summary);

  if (fs.existsSync(loginScreenPath)) {
    const loginCode = fs.readFileSync(loginScreenPath, 'utf8');

    // A. Must not have any auto-fill button or handler
    assert(
      !/btn-autofill|autofillPin|autoFillPin|Auto-fill PIN/i.test(loginCode),
      'LoginScreen does not contain auto-fill PIN buttons or handlers',
      summary
    );

    // B. Initial PIN state must be empty string
    assert(
      loginCode.includes("const [pin, setPin] = useState('')") ||
        loginCode.includes('const [pin, setPin] = useState("")'),
      'LoginScreen initializes PIN state with strictly empty string',
      summary
    );

    // C. No prefilling of PIN via localStorage
    assert(
      !/localStorage\.getItem\(['"`](?:goted_last_pin|last_pin|pin|secret_pin)['"`]\)/i.test(loginCode),
      'LoginScreen does not auto-populate PIN from localStorage',
      summary
    );
  }

  // =========================================================================
  // GUARD 4: STATIC ANALYSIS — NO PIN DISPLAYED IN LOGIN UI / TRANSLATIONS
  // =========================================================================
  console.log('\n--- Guard 4: Static Source Check for PIN Displayed in Login UI ---');
  const translationsPath = path.join(rootDir, 'src', 'i18n', 'translations.ts');
  assert(fs.existsSync(translationsPath), 'translations.ts exists', summary);

  if (fs.existsSync(translationsPath)) {
    const transCode = fs.readFileSync(translationsPath, 'utf8');
    assert(
      !/['"`]login\.defaultPinLabel['"`]\s*:\s*['"`][^'"`]*\d{4,}[^'"`]*['"`]/i.test(transCode),
      'Translations do not expose or display a default PIN value',
      summary
    );
    assert(
      !transCode.includes('849201') && !transCode.includes('123456'),
      'Translations do not contain literal default PIN digits',
      summary
    );
  }

  if (fs.existsSync(loginScreenPath)) {
    const loginCode = fs.readFileSync(loginScreenPath, 'utf8');
    assert(
      !loginCode.includes('849201') && !loginCode.includes('123456'),
      'LoginScreen JSX does not contain or display default PIN literals',
      summary
    );
    // PIN input must use password masking
    assert(
      loginCode.includes("type={showPin ? 'text' : 'password'}") ||
        loginCode.includes('type="password"'),
      'PIN input in LoginScreen uses secure password masking',
      summary
    );
  }

  // =========================================================================
  // GUARD 5: RUNTIME AUTHENTICATION — FAILS CLOSED WHEN SECRET IS MISSING
  // =========================================================================
  console.log('\n--- Guard 5: Runtime Check — Fails Closed When Secret Missing ---');
  {
    // A. validateProductionEnvironment rejects missing INITIAL_PIN in production
    const missingPinResult = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599',
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });
    assert(
      missingPinResult.valid === false,
      'validateProductionEnvironment returns valid: false when INITIAL_PIN is missing',
      summary
    );
    assert(
      missingPinResult.errors.some((e) => e.includes('INITIAL_PIN') || e.includes('PIN')),
      'Validation explicitly records missing INITIAL_PIN error',
      summary
    );

    // B. assertProductionEnvironmentValid throws on missing INITIAL_PIN
    let threw = false;
    try {
      assertProductionEnvironmentValid({
        env: {
          NODE_ENV: 'production',
          SESSION_SECRET: '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599',
          APPROVED_OWNER_EMAILS: 'owner@example.com'
        }
      });
    } catch {
      threw = true;
    }
    assert(
      threw,
      'assertProductionEnvironmentValid throws exception when INITIAL_PIN is missing',
      summary
    );

    // C. Providing an insecure default PIN in production is strictly rejected
    const insecureDefaultPinResult = validateProductionEnvironment({
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599',
        INITIAL_PIN: '123456',
        APPROVED_OWNER_EMAILS: 'owner@example.com'
      }
    });
    assert(
      insecureDefaultPinResult.valid === false,
      'validateProductionEnvironment rejects insecure default PIN (123456) in production',
      summary
    );
    assert(
      insecureDefaultPinResult.errors.some((e) => e.includes('Insecure default PIN') || e.includes('INITIAL_PIN')),
      'Validation explicitly flags insecure default PIN as prohibited',
      summary
    );
  }

  // =========================================================================
  // GUARD 6: RUNTIME AUTHENTICATION — REJECTS COMMON/DEFAULT PINS & ACCEPT SECURE
  // =========================================================================
  console.log('\n--- Guard 6: Runtime Check — Common/Default PIN Rejection ---');
  let serverInstance: http.Server | null = null;
  let testPort = 0;

  // Configure secure test secrets for server instance
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || '49eb6b423fa27ff07a76d80cb34211be0dc45f1a136712335e24ba649d086599';
  process.env.INITIAL_PIN = '95817283';

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

    clearRevokedSessionsForTest();
    clearRateLimitsForTest();

    // Verify all blacklisted default PINs fail
    for (const badPin of INSECURE_DEFAULT_PINS) {
      clearRateLimitsForTest();
      const res = await fetch(`${baseUrl}/api/verify-login-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, code: badPin })
      });
      assert(
        res.status === 401,
        `Authentication rejects blacklisted default PIN '${badPin}' with HTTP 401`,
        summary
      );
      const data = await res.json();
      assert(
        !data.sessionToken,
        `No session token issued for default PIN '${badPin}'`,
        summary
      );
    }

    // Verify Bengali localized digits of default PINs are also rejected
    const bengaliDefaultPins = ['১২৩৪৫৬', '৮৪৯২০১'];
    for (const bnPin of bengaliDefaultPins) {
      clearRateLimitsForTest();
      const res = await fetch(`${baseUrl}/api/verify-login-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerEmail, code: bnPin })
      });
      assert(
        res.status === 401,
        `Authentication rejects Bengali numeral default PIN '${bnPin}' with HTTP 401`,
        summary
      );
    }

    // Verify genuinely configured secure secret succeeds
    clearRateLimitsForTest();
    const validRes = await fetch(`${baseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, code: '95817283' })
    });
    assert(
      validRes.status === 200,
      'Authentication accepts genuinely configured secure PIN with HTTP 200',
      summary
    );
    const validData = await validRes.json();
    assert(
      validData.success === true && validData.role === 'OWNER' && Boolean(validData.sessionToken),
      'Secure PIN login returns confirmed OWNER role and valid session token',
      summary
    );
  } finally {
    if (serverInstance) {
      (serverInstance as http.Server).close();
    }
  }

  // =========================================================================
  // GUARD 7: TEST-ONLY CREDENTIALS ISOLATION
  // =========================================================================
  console.log('\n--- Guard 7: Test-only Credentials Isolation ---');
  {
    // Test-only credentials like '95817283' or '987654321_PRIVATE_PIN'
    // must NEVER be referenced in production code files
    const testOnlyPinFixtures = ['95817283', '987654321_PRIVATE_PIN'];
    for (const filePath of productionFiles) {
      const relPath = path.relative(rootDir, filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      for (const testFixture of testOnlyPinFixtures) {
        assert(
          !content.includes(testFixture),
          `Test fixture '${testFixture}' does not leak into production file ${relPath}`,
          summary
        );
      }
    }
  }

  console.log('\n================================================================');
  console.log(`PERMANENT PIN SECURITY GUARDS RESULT: Passed: ${summary.passed}/${summary.total}, Failed: ${summary.failed}`);
  console.log('================================================================\n');

  return summary;
}

if (process.argv[1]?.endsWith('testPermanentPinSecurityGuards.ts')) {
  runPermanentPinSecurityGuards()
    .then((res) => {
      if (res.failed > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error running permanent PIN security guards:', err);
      process.exit(1);
    });
}
