import 'fake-indexeddb/auto';
import crypto from 'crypto';
import { db } from '../db/indexedDb';
import {
  createSessionToken,
  verifySessionToken,
  isStrongSessionSecret,
  resolveSessionSecret,
  setSessionSecretForTest,
  assertStrongSecretConfigured,
  getApprovedOwnerEmails
} from '../../server';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF8HardenOwnerSessionAuthTests(): Promise<AssertionResult> {
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
  console.log('F8 TEST SUITE: HARDEN OWNER SESSION AUTHENTICATION');
  console.log('Testing Secret Policy, Unpredictability, Allow-List, Expiration & Anti-Forgery');
  console.log('========================================================\n');

  const serverBaseUrl = 'http://localhost:3000';
  const approvedEmail = 'atikurrahman00021@gmail.com';
  const unapprovedEmail = 'attacker_unauthorized@example.com';

  // Ensure test secret override is reset at start
  setSessionSecretForTest(undefined);

  // -------------------------------------------------------------
  // TEST SCENARIO 1: Strong Secret Policy & Insecure Default Rejection
  // -------------------------------------------------------------
  console.log('--- Scenario 1: Strong Secret Policy & Default Rejection ---');
  assert(!isStrongSessionSecret(null), 'Rejects null session secret');
  assert(!isStrongSessionSecret(undefined), 'Rejects undefined session secret');
  assert(!isStrongSessionSecret(''), 'Rejects empty session secret');
  assert(!isStrongSessionSecret('short-weak-secret-123'), 'Rejects secrets under 32 characters');
  assert(!isStrongSessionSecret('the-goated-farm-session-secret-salt-2025'), 'Strictly rejects known old hardcoded default secret');
  assert(!isStrongSessionSecret('the-goated-farm-session-secret'), 'Strictly rejects variants of old default secret');
  assert(!isStrongSessionSecret('passwordpasswordpasswordpassword'), 'Rejects repetitive low-entropy string');
  assert(!isStrongSessionSecret('12345678901234567890123456789012'), 'Rejects sequential numeric string');

  const validTestStrongSecret = 'a8f3b49c71e2056d4981fae620c384157d092bf3589a1c4e70624e5b38d91c2f';
  assert(isStrongSessionSecret(validTestStrongSecret), 'Accepts strong 64-char high-entropy hex secret');

  // Test production refusal when secret is missing or weak
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    setSessionSecretForTest(null);
    let threwInProd = false;
    try {
      assertStrongSecretConfigured();
    } catch {
      threwInProd = true;
    }
    assert(threwInProd, 'Production environment strictly refuses to start when secret is null');

    setSessionSecretForTest('the-goated-farm-session-secret-salt-2025');
    let threwWithDefault = false;
    try {
      assertStrongSecretConfigured();
    } catch {
      threwWithDefault = true;
    }
    assert(threwWithDefault, 'Production environment strictly refuses to start with default secret');
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    setSessionSecretForTest(undefined);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 2: Refuse to Start Secure Session Auth Without Strong Secret
  // -------------------------------------------------------------
  console.log('\n--- Scenario 2: Refuse Operations When Strong Secret Not Configured ---');
  setSessionSecretForTest(null);

  let createThrewOnNull = false;
  try {
    createSessionToken(approvedEmail);
  } catch (err: any) {
    createThrewOnNull = true;
    assert(err.message.includes('Refusing to issue') || err.message.includes('SESSION_SECRET'), 'Error explicitly states refusal to issue token without strong secret');
  }
  assert(createThrewOnNull, 'createSessionToken threw when secret is null');

  const dummyToken = 'eyJlbWFpbCI6ImF0aWt1cnJhaG1hbjAwMDIxQGdtYWlsLmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.dummy_sig';
  const verifyResultNull = verifySessionToken(dummyToken);
  assert(verifyResultNull === null, 'verifySessionToken returns null when secret is not configured');

  // Test with weak secret
  setSessionSecretForTest('weak-secret-1234');
  let createThrewOnWeak = false;
  try {
    createSessionToken(approvedEmail);
  } catch {
    createThrewOnWeak = true;
  }
  assert(createThrewOnWeak, 'createSessionToken threw when secret is weak (< 32 chars)');

  // Reset to valid test strong secret
  setSessionSecretForTest(validTestStrongSecret);

  // -------------------------------------------------------------
  // TEST SCENARIO 3: Session Tokens are Cryptographically Unpredictable
  // -------------------------------------------------------------
  console.log('\n--- Scenario 3: Cryptographically Unpredictable Tokens ---');
  const token1 = createSessionToken(approvedEmail);
  const token2 = createSessionToken(approvedEmail);
  const token3 = createSessionToken(approvedEmail);

  assert(token1 !== token2 && token2 !== token3, 'Subsequent tokens for same email are completely distinct');

  const [p1B64, sig1] = token1.split('.');
  const [p2B64, sig2] = token2.split('.');
  assert(sig1 !== sig2, 'HMAC signatures are unique between consecutive tokens');

  const p1 = JSON.parse(Buffer.from(p1B64, 'base64url').toString('utf8'));
  const p2 = JSON.parse(Buffer.from(p2B64, 'base64url').toString('utf8'));

  assert(typeof p1.jti === 'string' && p1.jti.length >= 24, 'Token payload contains secure random jti (unpredictability nonce)');
  assert(typeof p2.jti === 'string' && p2.jti.length >= 24, 'Second token contains secure random jti');
  assert(p1.jti !== p2.jti, 'jti values are strictly unique between tokens');

  // Verify verification of valid token succeeds
  const verified1 = verifySessionToken(token1);
  assert(verified1 !== null && verified1.email === approvedEmail, 'Valid unpredictable token verifies successfully');

  // -------------------------------------------------------------
  // TEST SCENARIO 4: Expiration Checking Preserved
  // -------------------------------------------------------------
  console.log('\n--- Scenario 4: Expiration Checking Preserved ---');
  const expiredPayload = {
    email: approvedEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now() - 100000,
    exp: Date.now() - 1000 // Expired 1 second ago
  };
  const expB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
  const expSig = crypto.createHmac('sha256', validTestStrongSecret).update(expB64).digest('base64url');
  const expiredToken = `${expB64}.${expSig}`;

  const verifiedExpired = verifySessionToken(expiredToken);
  assert(verifiedExpired === null, 'Expired session token is strictly rejected');

  // -------------------------------------------------------------
  // TEST SCENARIO 5: Owner Allow-list Checking Preserved
  // -------------------------------------------------------------
  console.log('\n--- Scenario 5: Owner Allow-list Checking Preserved ---');
  let createUnapprovedThrew = false;
  try {
    createSessionToken(unapprovedEmail);
  } catch (err: any) {
    createUnapprovedThrew = true;
    assert(err.message.includes('not in approved owner allow-list'), 'Refuses creation for unapproved email with clear error');
  }
  assert(createUnapprovedThrew, 'createSessionToken threw for unapproved email');

  // Even if an attacker somehow obtains a valid signature for an unapproved email:
  const forgedUnapprovedPayload = {
    email: unapprovedEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 3600000
  };
  const unapprovedB64 = Buffer.from(JSON.stringify(forgedUnapprovedPayload)).toString('base64url');
  const unapprovedSig = crypto.createHmac('sha256', validTestStrongSecret).update(unapprovedB64).digest('base64url');
  const unapprovedToken = `${unapprovedB64}.${unapprovedSig}`;

  const verifiedUnapproved = verifySessionToken(unapprovedToken);
  assert(verifiedUnapproved === null, 'Token for email not on allow-list is strictly rejected');

  // -------------------------------------------------------------
  // TEST SCENARIO 6: Knowing an Approved Email Alone is NEVER Sufficient to Forge a Session
  // -------------------------------------------------------------
  console.log('\n--- Scenario 6: Anti-Forgery (Knowing Approved Email is NEVER Sufficient) ---');

  // Attacker attempt A: Forge using old default secret 'the-goated-farm-session-secret-salt-2025'
  const oldDefaultSecret = 'the-goated-farm-session-secret-salt-2025';
  const forgedPayloadObj = {
    email: approvedEmail,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 3600000
  };
  const forgedPayloadB64 = Buffer.from(JSON.stringify(forgedPayloadObj)).toString('base64url');
  const forgedSigOldDefault = crypto.createHmac('sha256', oldDefaultSecret).update(forgedPayloadB64).digest('base64url');
  const forgedTokenOldDefault = `${forgedPayloadB64}.${forgedSigOldDefault}`;

  assert(verifySessionToken(forgedTokenOldDefault) === null, 'Forge Attempt A (old default secret) REJECTED');

  // Attacker attempt B: Forge using empty string as secret
  const forgedSigEmpty = crypto.createHmac('sha256', '').update(forgedPayloadB64).digest('base64url');
  assert(verifySessionToken(`${forgedPayloadB64}.${forgedSigEmpty}`) === null, 'Forge Attempt B (empty secret) REJECTED');

  // Attacker attempt C: Forge using the victim email as secret
  const forgedSigEmailAsSecret = crypto.createHmac('sha256', approvedEmail).update(forgedPayloadB64).digest('base64url');
  assert(verifySessionToken(`${forgedPayloadB64}.${forgedSigEmailAsSecret}`) === null, 'Forge Attempt C (email as secret) REJECTED');

  // Attacker attempt D: Unsigned token or stripped signature
  assert(verifySessionToken(`${forgedPayloadB64}.`) === null, 'Forge Attempt D1 (stripped signature) REJECTED');
  assert(verifySessionToken(forgedPayloadB64) === null, 'Forge Attempt D2 (missing dot/signature) REJECTED');

  // Attacker attempt E: Random signature
  const randomSig = crypto.randomBytes(32).toString('base64url');
  assert(verifySessionToken(`${forgedPayloadB64}.${randomSig}`) === null, 'Forge Attempt E (random signature) REJECTED');

  // Attacker attempt F: Payload tampering (change email in valid token)
  const validToken = createSessionToken(approvedEmail);
  const [valPB64, valSig] = validToken.split('.');
  const tamperedPayload = {
    ...JSON.parse(Buffer.from(valPB64, 'base64url').toString('utf8')),
    email: 'arparvez111@gmail.com' // Changed to another owner email without updating HMAC
  };
  const tamperedPB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url');
  assert(verifySessionToken(`${tamperedPB64}.${valSig}`) === null, 'Forge Attempt F (tampered payload) REJECTED');

  // Attacker attempt G: Direct API request with forged token
  try {
    const apiRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${forgedTokenOldDefault}`
      },
      body: JSON.stringify({ id: 'f8-forged-animal', tag: 'FORGE-TEST', species: 'GOAT' })
    });
    assert(apiRes.status === 401, `Server HTTP API rejects forged session token with HTTP 401 (got ${apiRes.status})`);
  } catch (err: any) {
    assert(false, `API request failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 7: Existing Valid Users Data Preservation
  // -------------------------------------------------------------
  console.log('\n--- Scenario 7: Existing Valid Users Data Preservation ---');
  // Reset test override to default production/env secret
  setSessionSecretForTest(undefined);

  const realToken = createSessionToken(approvedEmail);
  const testAnimalId = 'f8-data-preservation-cow';

  await db.animals.put({
    id: testAnimalId,
    tag: 'F8-COW-DATA-SAFE',
    species: 'CATTLE',
    breed: 'Sahiwal',
    gender: 'FEMALE',
    status: 'ACTIVE',
    purchasePrice: 95000,
    currentWeightKg: 450,
    synced: false,
    updatedAt: new Date().toISOString(),
    version: 1
  } as any);

  // Sync with real hardened token
  try {
    const syncRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${realToken}`
      },
      body: JSON.stringify({
        id: testAnimalId,
        tag: 'F8-COW-DATA-SAFE',
        species: 'CATTLE',
        breed: 'Sahiwal',
        gender: 'FEMALE',
        status: 'ACTIVE',
        purchasePrice: 95000,
        currentWeightKg: 450,
        updatedAt: new Date().toISOString(),
        version: 1
      })
    });
    const syncJson = await syncRes.json();
    assert(syncRes.status === 200 && syncJson.success === true, 'Legitimate authenticated owner sync succeeds without data loss');
  } catch (err: any) {
    assert(false, `Valid sync failed: ${err.message}`);
  }

  const localAnimal = await db.animals.get(testAnimalId);
  assert(localAnimal !== undefined && localAnimal.tag === 'F8-COW-DATA-SAFE', 'Local user data remains completely intact');
  await db.animals.delete(testAnimalId);

  console.log('\n========================================================');
  console.log(`F8 TEST RESULT: ${result.passed}/${result.total} Assertions Passed`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testTaskF8HardenOwnerSessionAuth.ts')) {
  runTaskF8HardenOwnerSessionAuthTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`❌ F8 TESTS FAILED: ${res.failed} failure(s)`);
        process.exit(1);
      } else {
        console.log('✅ ALL F8 AUTHENTICATION TESTS PASSED CLEANLY');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running F8 tests:', err);
      process.exit(1);
    });
}
