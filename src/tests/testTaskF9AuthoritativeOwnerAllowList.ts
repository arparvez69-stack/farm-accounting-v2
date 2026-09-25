import 'fake-indexeddb/auto';
import crypto from 'crypto';
import { db } from '../db/indexedDb';
import {
  getApprovedOwnerEmails,
  isOwnerEmail,
  createSessionToken,
  verifySessionToken,
  setApprovedOwnerEmailsForTest,
  isSetupComplete
} from '../../server';
import { resolveUserRole, AUTHORIZED_OWNER_EMAILS } from '../firebase/firebaseClient';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF9AuthoritativeOwnerAllowListTests(): Promise<AssertionResult> {
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
  console.log('F9 TEST SUITE: ENFORCE AUTHORITATIVE OWNER ALLOW-LIST');
  console.log('Testing Single Authoritative List, Obsolete Email Removal & Rejection');
  console.log('========================================================\n');

  const serverBaseUrl = 'http://localhost:3000';
  const obsoleteEmail1 = 'brandingdeshi@gmail.com';
  const obsoleteEmail2 = 'legacy-owner@olddomain.com';
  const randomAttacker = 'attacker@evil.corp';

  const EXACT_5_AUTHORIZED_OWNERS = [
    'arparvez111@gmail.com',
    'arparvez69@gmail.com',
    'arparvez4@gmail.com',
    'lubaiyatasnum111@gmail.com',
    'atikurrahman00021@gmail.com'
  ];

  // Ensure test override is reset
  setApprovedOwnerEmailsForTest(undefined);

  // -------------------------------------------------------------
  // TEST SCENARIO 1: Authoritative Owner Allow-List Audit (Exact 5 Owners)
  // -------------------------------------------------------------
  console.log('--- Scenario 1: Authoritative Allow-List Audit ---');
  const effectiveOwners = getApprovedOwnerEmails();
  console.log('Effective ERP Owner Allow-List:', effectiveOwners);

  assert(effectiveOwners.length === 5, `Authoritative list has exactly 5 configured owners (actual: ${effectiveOwners.length})`);
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    assert(effectiveOwners.includes(owner), `Authoritative owner ${owner} is present in allow-list`);
  }
  assert(!effectiveOwners.includes(obsoleteEmail1), `Obsolete email ${obsoleteEmail1} is NOT in the authoritative list`);
  assert(!effectiveOwners.includes(obsoleteEmail2), `Legacy email ${obsoleteEmail2} is NOT in the authoritative list`);
  assert(!effectiveOwners.includes(randomAttacker), `Attacker email ${randomAttacker} is NOT in the authoritative list`);

  // -------------------------------------------------------------
  // TEST SCENARIO 2: Obsolete & Non-Authorized Emails Cannot Authenticate as OWNER
  // -------------------------------------------------------------
  console.log('\n--- Scenario 2: Obsolete & Non-Authorized Emails Cannot Authenticate as OWNER ---');
  // All 5 must return isOwnerEmail === true
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    assert(isOwnerEmail(owner), `isOwnerEmail('${owner}') strictly returns true`);
  }

  // Any non-authorized email must return false
  assert(!isOwnerEmail(obsoleteEmail1), `isOwnerEmail('${obsoleteEmail1}') strictly returns false`);
  assert(!isOwnerEmail(obsoleteEmail2), `isOwnerEmail('${obsoleteEmail2}') strictly returns false`);
  assert(!isOwnerEmail(randomAttacker), `isOwnerEmail('${randomAttacker}') strictly returns false`);
  assert(!isOwnerEmail(''), 'isOwnerEmail with empty string returns false');
  assert(!isOwnerEmail(null as any), 'isOwnerEmail with null returns false');
  assert(!isOwnerEmail(undefined as any), 'isOwnerEmail with undefined returns false');

  // Token creation succeeds for all 5 authorized owners
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    const token = createSessionToken(owner);
    assert(typeof token === 'string' && token.length > 30, `createSessionToken succeeds for owner ${owner}`);
    const verified = verifySessionToken(token);
    assert(verified !== null && verified.email === owner, `verifySessionToken verifies valid token for owner ${owner}`);
  }

  // Token creation refusal for obsolete / attacker email
  let createObsolete1Threw = false;
  try {
    createSessionToken(obsoleteEmail1);
  } catch (err: any) {
    createObsolete1Threw = true;
    assert(err.message.includes('not in approved owner allow-list'), 'createSessionToken throws clear error rejecting obsolete email');
  }
  assert(createObsolete1Threw, 'createSessionToken strictly threw for obsolete email');

  let createAttackerThrew = false;
  try {
    createSessionToken(randomAttacker);
  } catch (err: any) {
    createAttackerThrew = true;
    assert(err.message.includes('not in approved owner allow-list'), 'createSessionToken throws clear error rejecting attacker email');
  }
  assert(createAttackerThrew, 'createSessionToken strictly threw for attacker email');

  // Token verification rejection: even if someone crafts or presents a token signed with the secret
  const sessionSecret = process.env.SESSION_SECRET || 'a8f3b49c71e2056d4981fae620c384157d092bf3589a1c4e70624e5b38d91c2f';
  const forgedPayload = {
    email: obsoleteEmail1,
    jti: crypto.randomBytes(32).toString('base64url'),
    iat: Date.now(),
    exp: Date.now() + 3600000
  };
  const forgedB64 = Buffer.from(JSON.stringify(forgedPayload)).toString('base64url');
  const forgedSig = crypto.createHmac('sha256', sessionSecret).update(forgedB64).digest('base64url');
  const forgedObsoleteToken = `${forgedB64}.${forgedSig}`;

  const verifiedObsolete = verifySessionToken(forgedObsoleteToken);
  assert(verifiedObsolete === null, 'verifySessionToken strictly returns null for obsolete email even with valid HMAC signature');

  // -------------------------------------------------------------
  // TEST SCENARIO 3: Server API Endpoints Reject Obsolete / Non-Authorized Emails
  // -------------------------------------------------------------
  console.log('\n--- Scenario 3: Server API Endpoints Reject Obsolete Emails ---');
  try {
    // 1. Sync endpoint rejects obsolete email token
    const syncRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${forgedObsoleteToken}`
      },
      body: JSON.stringify({ id: 'test-sync-obsolete', tag: 'OBSOLETE-TEST' })
    });
    assert(syncRes.status === 401, `Sync API rejects obsolete email session token with HTTP 401 (got ${syncRes.status})`);

    // 2. Login verification rejects obsolete email
    const loginRes = await fetch(`${serverBaseUrl}/api/verify-login-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: obsoleteEmail1, code: '123456' })
    });
    assert(loginRes.status === 401 || loginRes.status === 429, `Login API rejects obsolete email with HTTP 401/429 (got ${loginRes.status})`);

    // 3. Change PIN rejects obsolete email
    const changePinRes = await fetch(`${serverBaseUrl}/api/change-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: obsoleteEmail1, currentPin: '123456', newPin: '654321' })
    });
    assert(changePinRes.status === 403, `Change PIN API rejects obsolete email with HTTP 403 (got ${changePinRes.status})`);

    // 4. Request PIN reset rejects obsolete email
    const resetRes = await fetch(`${serverBaseUrl}/api/request-pin-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: obsoleteEmail1 })
    });
    assert(resetRes.status === 400, `PIN reset API rejects obsolete email with HTTP 400 (got ${resetRes.status})`);
  } catch (err: any) {
    assert(false, `API check threw unexpected network error: ${err.message}`);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 4: Unsafe Fallback is Prevented When Allow-List is Empty
  // -------------------------------------------------------------
  console.log('\n--- Scenario 4: No Silent Grant / Unsafe Fallback When Allow-List is Empty ---');
  try {
    setApprovedOwnerEmailsForTest([]);
    assert(!isSetupComplete(), 'isSetupComplete returns false when allow-list is empty');
    for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
      assert(!isOwnerEmail(owner), `isOwnerEmail returns false for ${owner} when allow-list is empty`);
    }
    assert(!isOwnerEmail(obsoleteEmail1), 'isOwnerEmail returns false for obsolete email when allow-list is empty');

    let createEmptyThrew = false;
    try {
      createSessionToken(EXACT_5_AUTHORIZED_OWNERS[0]);
    } catch {
      createEmptyThrew = true;
    }
    assert(createEmptyThrew, 'createSessionToken refuses to issue token when allow-list is empty');
  } finally {
    setApprovedOwnerEmailsForTest(undefined);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 5: Safe Configuration Override
  // -------------------------------------------------------------
  console.log('\n--- Scenario 5: Safe Configuration Override ---');
  try {
    const singleCustomOwner = 'custom_exclusive_owner@farm.com';
    setApprovedOwnerEmailsForTest([singleCustomOwner]);

    assert(isOwnerEmail(singleCustomOwner), 'Explicitly overridden owner is granted owner access');
    for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
      assert(!isOwnerEmail(owner), `Previous owner ${owner} is safely revoked when configuration overrides list`);
    }
    assert(!isOwnerEmail(obsoleteEmail1), 'Obsolete email is strictly not granted access');
  } finally {
    setApprovedOwnerEmailsForTest(undefined);
  }

  // -------------------------------------------------------------
  // TEST SCENARIO 6: Legitimate Authorized Owners Retain Full Access & Data
  // -------------------------------------------------------------
  console.log('\n--- Scenario 6: Legitimate Authorized Owners Retain Full Access ---');
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    assert(isOwnerEmail(owner), `Authoritative owner ${owner} is verified`);
  }

  const primaryOwner = EXACT_5_AUTHORIZED_OWNERS[0];
  const validToken = createSessionToken(primaryOwner);
  const verifiedValid = verifySessionToken(validToken);
  assert(verifiedValid !== null && verifiedValid.email === primaryOwner, 'Legitimate owner session token is issued and verified successfully');

  // Verify sync works cleanly for legitimate owner
  const testAnimalId = 'f9-authorized-owner-animal';
  await db.animals.put({
    id: testAnimalId,
    tag: 'F9-LEGIT-OWNER-COW',
    species: 'CATTLE',
    breed: 'Brahman',
    gender: 'FEMALE',
    status: 'ACTIVE',
    updatedAt: new Date().toISOString(),
    version: 1,
    synced: false
  } as any);

  try {
    const syncRes = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`
      },
      body: JSON.stringify({
        id: testAnimalId,
        tag: 'F9-LEGIT-OWNER-COW',
        species: 'CATTLE',
        breed: 'Brahman',
        gender: 'FEMALE',
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
        version: 1
      })
    });
    const syncJson = await syncRes.json();
    assert(syncRes.status === 200 && syncJson.success === true, 'Authorized owner sync succeeds with HTTP 200');
  } catch (err: any) {
    assert(false, `Sync failed: ${err.message}`);
  }

  const localAnimal = await db.animals.get(testAnimalId);
  assert(localAnimal !== undefined && localAnimal.tag === 'F9-LEGIT-OWNER-COW', 'Local animal data remains intact');
  await db.animals.delete(testAnimalId);

  // -------------------------------------------------------------
  // TEST SCENARIO 7: Firebase Authentication & Role Resolution
  // -------------------------------------------------------------
  console.log('\n--- Scenario 7: Firebase Auth & Role Resolution ---');
  assert(AUTHORIZED_OWNER_EMAILS.length === 5, 'Client AUTHORIZED_OWNER_EMAILS has exactly 5 owners');
  for (const owner of EXACT_5_AUTHORIZED_OWNERS) {
    assert(AUTHORIZED_OWNER_EMAILS.includes(owner), `Client constants include ${owner}`);
    const prof = await resolveUserRole({ uid: `test_${owner}`, email: owner } as any);
    assert(prof.role === 'OWNER', `${owner} resolves to OWNER role`);
    assert(prof.isApproved === true, `${owner} has isApproved === true`);
  }

  // Non-authorized emails must be rejected by resolveUserRole
  const attackerProf = await resolveUserRole({ uid: 'test_attacker', email: randomAttacker } as any);
  assert(attackerProf.role === 'UNAPPROVED', `Attacker ${randomAttacker} resolves to UNAPPROVED`);
  assert(attackerProf.isApproved === false, `Attacker ${randomAttacker} has isApproved === false`);

  const obsoleteProf = await resolveUserRole({ uid: 'test_obsolete', email: obsoleteEmail1 } as any);
  assert(obsoleteProf.role === 'UNAPPROVED', `Obsolete ${obsoleteEmail1} resolves to UNAPPROVED`);
  assert(obsoleteProf.isApproved === false, `Obsolete ${obsoleteEmail1} has isApproved === false`);

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('goted_owner_session');
  }
  const unauthenticatedProf = await resolveUserRole(null);
  assert(unauthenticatedProf.role === 'UNAUTHENTICATED', 'Null user resolves to UNAUTHENTICATED');
  assert(unauthenticatedProf.isApproved === false, 'Null user has isApproved === false');

  console.log('\n========================================================');
  console.log(`F9 TEST RESULT: ${result.passed}/${result.total} Assertions Passed`);
  console.log('========================================================\n');

  return result;
}

if (process.argv[1]?.endsWith('testTaskF9AuthoritativeOwnerAllowList.ts')) {
  runTaskF9AuthoritativeOwnerAllowListTests()
    .then((res) => {
      if (res.failed > 0) {
        console.error(`❌ F9 TESTS FAILED: ${res.failed} failure(s)`);
        process.exit(1);
      } else {
        console.log('✅ ALL F9 AUTHORITATIVE ALLOW-LIST TESTS PASSED CLEANLY');
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal error running F9 tests:', err);
      process.exit(1);
    });
}
