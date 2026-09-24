import 'fake-indexeddb/auto';
import crypto from 'crypto';
import { db } from '../db/indexedDb';
import {
  createSessionToken,
  verifySessionToken,
  revokeSessionToken,
  revokeAllSessionsForOwner,
  isSessionRevoked,
  clearRevokedSessionsForTest,
  getApprovedOwnerEmails,
  isOwnerEmail,
  setApprovedOwnerEmailsForTest,
  resolveSessionSecret,
  setSessionSecretForTest,
  isStrongSessionSecret
} from '../../server';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runSessionAuthSecurityTests(): Promise<AssertionResult> {
  const result: AssertionResult = {
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };

  function assert(condition: boolean, description: string) {
    result.total++;
    if (condition) {
      result.passed++;
      console.log(`✅ PASS: ${description}`);
    } else {
      result.failed++;
      result.failures.push(description);
      console.error(`❌ FAIL: ${description}`);
    }
  }

  console.log('\n========================================================');
  console.log('FOCUSED SECURITY TEST SUITE: OWNER SESSION AUTHENTICATION');
  console.log('Testing Expired, Malformed, Tampered, Revoked Sessions & 5-Owner Allow-List Rechecks');
  console.log('========================================================\n');

  const serverBaseUrl = 'http://localhost:3000';
  const EXACT_5_AUTHORIZED_OWNERS = [
    'arparvez111@gmail.com',
    'arparvez69@gmail.com',
    'arparvez4@gmail.com',
    'lubaiyatasnum111@gmail.com',
    'atikurrahman00021@gmail.com'
  ];
  const primaryOwner = EXACT_5_AUTHORIZED_OWNERS[0];
  const secondaryOwner = EXACT_5_AUTHORIZED_OWNERS[1];
  const unapprovedEmail = 'attacker@evil.corp';
  const obsoleteEmail = 'brandingdeshi@gmail.com';

  // Configure test environment clean state
  setApprovedOwnerEmailsForTest(undefined);
  clearRevokedSessionsForTest();
  setSessionSecretForTest(undefined);

  // Configure admin db test mode to 'success' for clean sync endpoint testing
  try {
    await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'success' })
    });
  } catch {}

  const activeSecret = resolveSessionSecret()!;
  assert(Boolean(activeSecret && isStrongSessionSecret(activeSecret)), 'Active session secret meets strict cryptographic strength');

  // =============================================================
  // SECTION 1: EXPIRED SESSIONS REJECTION
  // =============================================================
  console.log('\n--- Section 1: Expired Sessions Rejection ---');

  // 1.1 Token expired in the past
  const pastExpiredPayload = {
    email: primaryOwner,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now() - 3600000,
    exp: Date.now() - 5000 // 5 seconds ago
  };
  const pastExpB64 = Buffer.from(JSON.stringify(pastExpiredPayload)).toString('base64url');
  const pastExpSig = crypto.createHmac('sha256', activeSecret).update(pastExpB64).digest('base64url');
  const pastExpToken = `${pastExpB64}.${pastExpSig}`;
  assert(verifySessionToken(pastExpToken) === null, 'Token expired in the past is strictly rejected');

  // 1.2 Token at exact expiration boundary (Date.now() >= exp)
  const nowTime = Date.now();
  const boundaryPayload = {
    email: primaryOwner,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: nowTime - 1000,
    exp: nowTime
  };
  const boundaryB64 = Buffer.from(JSON.stringify(boundaryPayload)).toString('base64url');
  const boundarySig = crypto.createHmac('sha256', activeSecret).update(boundaryB64).digest('base64url');
  const boundaryToken = `${boundaryB64}.${boundarySig}`;
  assert(verifySessionToken(boundaryToken) === null, 'Token at exact expiration timestamp boundary is strictly rejected');

  // 1.3 Token with zero or negative exp
  const zeroExpPayload = {
    email: primaryOwner,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: 0
  };
  const zeroExpB64 = Buffer.from(JSON.stringify(zeroExpPayload)).toString('base64url');
  const zeroExpSig = crypto.createHmac('sha256', activeSecret).update(zeroExpB64).digest('base64url');
  assert(verifySessionToken(`${zeroExpB64}.${zeroExpSig}`) === null, 'Token with exp = 0 is strictly rejected');

  // 1.4 Token with non-finite exp (Infinity, NaN)
  const infExpPayload = {
    email: primaryOwner,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: null
  };
  const infExpB64 = Buffer.from(JSON.stringify(infExpPayload)).toString('base64url');
  const infExpSig = crypto.createHmac('sha256', activeSecret).update(infExpB64).digest('base64url');
  assert(verifySessionToken(`${infExpB64}.${infExpSig}`) === null, 'Token with null/non-number exp is strictly rejected');

  // 1.5 HTTP Request with expired token rejected with 401
  try {
    const syncRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pastExpToken}`
      },
      body: JSON.stringify({ id: 'test-expired-animal', tag: 'EXP-1' })
    });
    assert(syncRes.status === 401, `HTTP POST /api/sync/animals rejects expired session with HTTP 401 (got ${syncRes.status})`);

    const restoreRes = await fetch(`${serverBaseUrl}/api/sync/restore`, {
      headers: { Authorization: `Bearer ${pastExpToken}` }
    });
    assert(restoreRes.status === 401, `HTTP GET /api/sync/restore rejects expired session with HTTP 401 (got ${restoreRes.status})`);

    const wipeRes = await fetch(`${serverBaseUrl}/api/wipe-all-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pastExpToken}`
      },
      body: JSON.stringify({ confirmation: 'মুছুন' })
    });
    assert(wipeRes.status === 401, `HTTP POST /api/wipe-all-data rejects expired session with HTTP 401 (got ${wipeRes.status})`);
  } catch (err: any) {
    assert(false, `API check with expired token failed: ${err.message}`);
  }

  // =============================================================
  // SECTION 2: MALFORMED SESSIONS REJECTION
  // =============================================================
  console.log('\n--- Section 2: Malformed Sessions Rejection ---');

  assert(verifySessionToken('') === null, 'Rejects empty token string');
  assert(verifySessionToken('    ') === null, 'Rejects whitespace-only token string');
  assert(verifySessionToken(null as any) === null, 'Rejects null token');
  assert(verifySessionToken(undefined as any) === null, 'Rejects undefined token');
  assert(verifySessionToken(12345 as any) === null, 'Rejects numeric non-string token');
  assert(verifySessionToken('single-string-no-dot') === null, 'Rejects token with no dot separator');
  assert(verifySessionToken('part1.part2.part3') === null, 'Rejects token with 3 parts (not exactly 2 parts)');
  assert(verifySessionToken('part1.') === null, 'Rejects token with empty signature');
  assert(verifySessionToken('.part2') === null, 'Rejects token with empty payload');
  assert(verifySessionToken('not-valid-base64.signature') === null, 'Rejects unparseable base64 payload');

  // JSON primitive / array payloads
  const arrayPayloadB64 = Buffer.from(JSON.stringify(['item1', 'item2'])).toString('base64url');
  const arrayPayloadSig = crypto.createHmac('sha256', activeSecret).update(arrayPayloadB64).digest('base64url');
  assert(verifySessionToken(`${arrayPayloadB64}.${arrayPayloadSig}`) === null, 'Rejects array payload (non-object)');

  const nullPayloadB64 = Buffer.from(JSON.stringify(null)).toString('base64url');
  const nullPayloadSig = crypto.createHmac('sha256', activeSecret).update(nullPayloadB64).digest('base64url');
  assert(verifySessionToken(`${nullPayloadB64}.${nullPayloadSig}`) === null, 'Rejects null JSON payload');

  const stringPayloadB64 = Buffer.from(JSON.stringify('just a string')).toString('base64url');
  const stringPayloadSig = crypto.createHmac('sha256', activeSecret).update(stringPayloadB64).digest('base64url');
  assert(verifySessionToken(`${stringPayloadB64}.${stringPayloadSig}`) === null, 'Rejects string JSON payload');

  // Missing essential fields
  const missingExpPayload = { email: primaryOwner, jti: crypto.randomBytes(32).toString('base64url'), iat: Date.now() };
  const missingExpB64 = Buffer.from(JSON.stringify(missingExpPayload)).toString('base64url');
  const missingExpSig = crypto.createHmac('sha256', activeSecret).update(missingExpB64).digest('base64url');
  assert(verifySessionToken(`${missingExpB64}.${missingExpSig}`) === null, 'Rejects payload missing exp');

  const missingEmailPayload = { exp: Date.now() + 3600000, jti: crypto.randomBytes(32).toString('base64url'), iat: Date.now() };
  const missingEmailB64 = Buffer.from(JSON.stringify(missingEmailPayload)).toString('base64url');
  const missingEmailSig = crypto.createHmac('sha256', activeSecret).update(missingEmailB64).digest('base64url');
  assert(verifySessionToken(`${missingEmailB64}.${missingEmailSig}`) === null, 'Rejects payload missing email');

  const shortJtiPayload = { email: primaryOwner, exp: Date.now() + 3600000, jti: 'short', iat: Date.now() };
  const shortJtiB64 = Buffer.from(JSON.stringify(shortJtiPayload)).toString('base64url');
  const shortJtiSig = crypto.createHmac('sha256', activeSecret).update(shortJtiB64).digest('base64url');
  assert(verifySessionToken(`${shortJtiB64}.${shortJtiSig}`) === null, 'Rejects payload with short jti (< 16 chars)');

  const futureIatPayload = { email: primaryOwner, exp: Date.now() + 3600000, jti: crypto.randomBytes(32).toString('base64url'), iat: Date.now() + 500000 };
  const futureIatB64 = Buffer.from(JSON.stringify(futureIatPayload)).toString('base64url');
  const futureIatSig = crypto.createHmac('sha256', activeSecret).update(futureIatB64).digest('base64url');
  assert(verifySessionToken(`${futureIatB64}.${futureIatSig}`) === null, 'Rejects payload with future issuance timestamp beyond clock skew');

  // HTTP Requests with malformed tokens rejected with 401
  try {
    const malformedHeaderRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer malformed.token.format.here'
      },
      body: JSON.stringify({ id: 'test-malformed-animal' })
    });
    assert(malformedHeaderRes.status === 401, `HTTP API rejects malformed session token with HTTP 401 (got ${malformedHeaderRes.status})`);

    const missingBearerRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic invalidcredentials'
      },
      body: JSON.stringify({ id: 'test-malformed-animal' })
    });
    assert(missingBearerRes.status === 401, `HTTP API rejects non-Bearer authorization with HTTP 401 (got ${missingBearerRes.status})`);
  } catch (err: any) {
    assert(false, `API check with malformed token failed: ${err.message}`);
  }

  // =============================================================
  // SECTION 3: TAMPERED SESSIONS REJECTION
  // =============================================================
  console.log('\n--- Section 3: Tampered Sessions Rejection ---');

  const genuineToken = createSessionToken(primaryOwner);
  const [genuinePB64, genuineSig] = genuineToken.split('.');

  // 3.1 Tampered payload email (attacker changes email to another owner without signing)
  const decodedGenuinePayload = JSON.parse(Buffer.from(genuinePB64, 'base64url').toString('utf8'));
  const tamperedEmailPayload = { ...decodedGenuinePayload, email: secondaryOwner };
  const tamperedEmailPB64 = Buffer.from(JSON.stringify(tamperedEmailPayload)).toString('base64url');
  assert(verifySessionToken(`${tamperedEmailPB64}.${genuineSig}`) === null, 'Tampered payload (modified email) is strictly rejected');

  // 3.2 Tampered payload exp (attacker extends expiration date)
  const tamperedExpPayload = { ...decodedGenuinePayload, exp: decodedGenuinePayload.exp + 100000000 };
  const tamperedExpPB64 = Buffer.from(JSON.stringify(tamperedExpPayload)).toString('base64url');
  assert(verifySessionToken(`${tamperedExpPB64}.${genuineSig}`) === null, 'Tampered payload (extended exp) is strictly rejected');

  // 3.3 Tampered signature bytes
  const tamperedSig = genuineSig.slice(0, -2) + (genuineSig.slice(-2) === 'aa' ? 'bb' : 'aa');
  assert(verifySessionToken(`${genuinePB64}.${tamperedSig}`) === null, 'Tampered signature bytes is strictly rejected');

  // 3.4 Truncated signature
  const truncatedSig = genuineSig.slice(0, 16);
  assert(verifySessionToken(`${genuinePB64}.${truncatedSig}`) === null, 'Truncated signature is strictly rejected');

  // 3.5 Stripped signature
  assert(verifySessionToken(`${genuinePB64}.`) === null, 'Stripped signature is strictly rejected');

  // 3.6 Forged with attacker's own secret key
  const evilSecret = crypto.randomBytes(32).toString('hex');
  const forgedEvilSig = crypto.createHmac('sha256', evilSecret).update(genuinePB64).digest('base64url');
  assert(verifySessionToken(`${genuinePB64}.${forgedEvilSig}`) === null, 'Token signed with non-configured secret is strictly rejected');

  // 3.7 HTTP Request with tampered token rejected with 401
  try {
    const tamperedApiRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tamperedEmailPB64}.${genuineSig}`
      },
      body: JSON.stringify({ id: 'test-tampered-animal' })
    });
    assert(tamperedApiRes.status === 401, `HTTP API rejects tampered session token with HTTP 401 (got ${tamperedApiRes.status})`);
  } catch (err: any) {
    assert(false, `API check with tampered token failed: ${err.message}`);
  }

  // =============================================================
  // SECTION 4: REVOKED SESSIONS REJECTION
  // =============================================================
  console.log('\n--- Section 4: Revoked Sessions Rejection ---');

  // 4.1 Revoke by exact session token
  const tokenToRevoke1 = createSessionToken(primaryOwner);
  assert(verifySessionToken(tokenToRevoke1) !== null, 'Initial session token is valid before revocation');
  assert(!isSessionRevoked(tokenToRevoke1), 'isSessionRevoked initially returns false');

  revokeSessionToken(tokenToRevoke1);
  await fetch(`${serverBaseUrl}/api/revoke-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokenToRevoke1 })
  });
  assert(isSessionRevoked(tokenToRevoke1), 'isSessionRevoked returns true after revokeSessionToken()');
  assert(verifySessionToken(tokenToRevoke1) === null, 'verifySessionToken strictly rejects revoked token');

  // 4.2 HTTP API rejects revoked token with 401
  try {
    const revokedApiRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenToRevoke1}`
      },
      body: JSON.stringify({ id: 'test-revoked-animal' })
    });
    assert(revokedApiRes.status === 401, `HTTP API rejects revoked session token with HTTP 401 (got ${revokedApiRes.status})`);
  } catch (err: any) {
    assert(false, `API check with revoked token failed: ${err.message}`);
  }

  // 4.3 Revoke by JTI nonce
  const tokenToRevoke2 = createSessionToken(secondaryOwner);
  const [p2B64] = tokenToRevoke2.split('.');
  const p2Obj = JSON.parse(Buffer.from(p2B64, 'base64url').toString('utf8'));
  const jtiToRevoke = p2Obj.jti;
  assert(typeof jtiToRevoke === 'string' && jtiToRevoke.length >= 16, 'Extracted valid JTI from token 2');

  revokeSessionToken(jtiToRevoke);
  assert(verifySessionToken(tokenToRevoke2) === null, 'verifySessionToken strictly rejects token when its JTI is revoked');

  // 4.4 Revoke via POST /api/revoke-session endpoint
  const tokenToRevokeViaApi = createSessionToken(primaryOwner);
  assert(verifySessionToken(tokenToRevokeViaApi) !== null, 'Token is valid prior to API revocation');

  try {
    const revokeApiRes = await fetch(`${serverBaseUrl}/api/revoke-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenToRevokeViaApi}`
      },
      body: JSON.stringify({ token: tokenToRevokeViaApi })
    });
    const revokeApiJson = await revokeApiRes.json();
    assert(revokeApiRes.status === 200 && revokeApiJson.revoked === true, 'POST /api/revoke-session returns success');

    revokeSessionToken(tokenToRevokeViaApi);
    assert(verifySessionToken(tokenToRevokeViaApi) === null, 'Token revoked via API endpoint is strictly rejected');

    const subsequentCall = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenToRevokeViaApi}`
      },
      body: JSON.stringify({ id: 'test-after-revocation' })
    });
    assert(subsequentCall.status === 401, `Subsequent API call with API-revoked token returns HTTP 401 (got ${subsequentCall.status})`);
  } catch (err: any) {
    assert(false, `Revoke session API test failed: ${err.message}`);
  }

  // 4.5 Owner-level revocation (revoke all prior sessions for an owner)
  const preCutoffToken = createSessionToken(primaryOwner);
  assert(verifySessionToken(preCutoffToken) !== null, 'Pre-cutoff token is valid');

  revokeAllSessionsForOwner(primaryOwner);
  assert(verifySessionToken(preCutoffToken) === null, 'All sessions issued prior to revokeAllSessionsForOwner() are strictly rejected');

  // A new session issued AFTER owner revocation is valid
  // Wait 5ms to ensure new timestamp > cutoff
  await new Promise((r) => setTimeout(r, 10));
  const postCutoffToken = createSessionToken(primaryOwner);
  assert(verifySessionToken(postCutoffToken) !== null, 'New session issued after owner revocation is valid');

  // Clear revocation state for next section
  clearRevokedSessionsForTest();
  try {
    await fetch(`${serverBaseUrl}/api/test/clear-revocations`, { method: 'POST' });
  } catch {}

  // =============================================================
  // SECTION 5: EVERY REQUEST RECHECKS FIVE-OWNER ALLOW-LIST
  // =============================================================
  console.log('\n--- Section 5: Every Request Rechecks Five-Owner Allow-List ---');

  const currentApproved = getApprovedOwnerEmails();
  assert(currentApproved.length === 5, `Authoritative allow-list has exactly 5 owners (got ${currentApproved.length})`);
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    assert(currentApproved.includes(owner), `Authoritative owner ${owner} is present in allow-list`);
  }

  // 5.1 Valid session token issued to each authorized owner
  const tokensByOwner = new Map<string, string>();
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    const token = createSessionToken(owner);
    tokensByOwner.set(owner, token);
    const verified = verifySessionToken(token);
    assert(verified !== null && verified.email === owner, `Session token verified successfully for approved owner ${owner}`);
  }

  // 5.2 Dynamic allow-list recheck: revoking an owner from the allow-list immediately invalidates their active session
  console.log('\n--- Dynamic Allow-List Recheck on Active Sessions ---');
  const victimOwner = EXACT_5_AUTHORIZED_OWNERS[4]; // atikurrahman00021@gmail.com
  const victimToken = tokensByOwner.get(victimOwner)!;
  assert(verifySessionToken(victimToken) !== null, `Before allow-list change, session for ${victimOwner} is valid`);

  // Simulate allow-list update removing victimOwner (leaving only 4 owners)
  const fourOwnersList = EXACT_5_AUTHORIZED_OWNERS.slice(0, 4);
  try {
    setApprovedOwnerEmailsForTest(fourOwnersList);
    await fetch(`${serverBaseUrl}/api/test/owner-allow-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: fourOwnersList })
    });

    // Dynamic recheck MUST immediately reject the active session on next request without restart
    const verifyAfterRemoval = verifySessionToken(victimToken);
    assert(verifyAfterRemoval === null, `Dynamically removed owner ${victimOwner} session is IMMEDIATELY rejected by verifySessionToken()`);

    // Protected HTTP endpoint also immediately rejects it with HTTP 401
    const syncResAfterRemoval = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${victimToken}`
      },
      body: JSON.stringify({ id: 'test-removed-owner-animal' })
    });
    assert(syncResAfterRemoval.status === 401, `Server HTTP API immediately rejects removed owner with HTTP 401 (got ${syncResAfterRemoval.status})`);

    // The other 4 owners still have valid active sessions
    for (const remainingOwner of fourOwnersList) {
      const remainingToken = tokensByOwner.get(remainingOwner)!;
      assert(verifySessionToken(remainingToken) !== null, `Remaining approved owner ${remainingOwner} session remains valid`);
    }

    // Attempting to create new session token for removed owner is strictly rejected
    let createThrewForRemoved = false;
    try {
      createSessionToken(victimOwner);
    } catch {
      createThrewForRemoved = true;
    }
    assert(createThrewForRemoved, `createSessionToken() strictly throws when owner is removed from allow-list`);
  } finally {
    // Restore full 5-owner list
    setApprovedOwnerEmailsForTest(undefined);
    await fetch(`${serverBaseUrl}/api/test/owner-allow-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: null })
    });
  }

  // Once restored to the 5-owner list, the session is valid again
  assert(verifySessionToken(victimToken) !== null, `Session for restored owner ${victimOwner} is accepted once present in 5-owner allow-list`);

  // 5.3 Obsolete and attacker emails strictly rejected even if signed
  const obsoleteForgedPayload = {
    email: obsoleteEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 3600000
  };
  const obsB64 = Buffer.from(JSON.stringify(obsoleteForgedPayload)).toString('base64url');
  const obsSig = crypto.createHmac('sha256', activeSecret).update(obsB64).digest('base64url');
  const obsoleteToken = `${obsB64}.${obsSig}`;
  assert(verifySessionToken(obsoleteToken) === null, 'Obsolete owner email is strictly rejected by verifySessionToken()');

  const attackerForgedPayload = {
    email: unapprovedEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 3600000
  };
  const attB64 = Buffer.from(JSON.stringify(attackerForgedPayload)).toString('base64url');
  const attSig = crypto.createHmac('sha256', activeSecret).update(attB64).digest('base64url');
  const attackerToken = `${attB64}.${attSig}`;
  assert(verifySessionToken(attackerToken) === null, 'Attacker email is strictly rejected by verifySessionToken()');

  // =============================================================
  // SECTION 6: PRESERVE DATA INTEGRITY & LEGITIMATE OWNER ACCESS
  // =============================================================
  console.log('\n--- Section 6: Preserve Data Integrity & Legitimate Owner Access ---');

  const legitimateToken = createSessionToken(primaryOwner);
  const testAnimalId = 'security-test-verified-cow';

  await db.animals.put({
    id: testAnimalId,
    tag: 'SEC-COW-VERIFIED',
    species: 'CATTLE',
    breed: 'Sahiwal',
    gender: 'FEMALE',
    status: 'ACTIVE',
    purchasePrice: 85000,
    currentWeightKg: 420,
    updatedAt: new Date().toISOString(),
    version: 1,
    synced: false
  } as any);

  try {
    await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'success' })
    });

    const syncRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legitimateToken}`,
        'x-test-admin-db-mode': 'success'
      },
      body: JSON.stringify({
        id: testAnimalId,
        tag: 'SEC-COW-VERIFIED',
        species: 'CATTLE',
        breed: 'Sahiwal',
        gender: 'FEMALE',
        status: 'ACTIVE',
        purchasePrice: 85000,
        currentWeightKg: 420,
        updatedAt: new Date().toISOString(),
        version: 1
      })
    });
    const syncJson = await syncRes.json();
    if (syncRes.status !== 200) {
      console.error('Section 6 sync failed:', syncRes.status, syncJson);
    }
    assert(syncRes.status === 200 && syncJson.success === true, 'Legitimate authenticated owner sync succeeds without data loss');
  } catch (err: any) {
    assert(false, `Legitimate sync failed: ${err.message}`);
  }

  const localAnimal = await db.animals.get(testAnimalId);
  assert(localAnimal !== undefined && localAnimal.tag === 'SEC-COW-VERIFIED', 'Local animal record remains intact');
  await db.animals.delete(testAnimalId);

  // Clean up
  setApprovedOwnerEmailsForTest(undefined);
  clearRevokedSessionsForTest();

  console.log('\n========================================================');
  console.log(`SECURITY TEST RESULT: ${result.passed}/${result.total} Assertions Passed`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testSessionAuthSecurityVerification.ts')) {
  runSessionAuthSecurityTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`❌ SECURITY TESTS FAILED: ${res.failed} failure(s)`);
        process.exit(1);
      } else {
        console.log('✅ ALL OWNER SESSION AUTHENTICATION SECURITY TESTS PASSED CLEANLY');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running security tests:', err);
      process.exit(1);
    });
}
