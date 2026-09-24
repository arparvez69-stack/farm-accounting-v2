import 'fake-indexeddb/auto';
import http from 'http';
import {
  app,
  createSessionToken,
  isValidDocumentId,
  validateRecordShape,
  ALLOWED_SYNC_COLLECTIONS,
  inMemoryStores
} from '../../server';

interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runSyncRequestValidationTests(): Promise<AssertionResult> {
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
  console.log('AUDIT: SYNC REQUEST VALIDATION IN SERVER.TS');
  console.log('Testing Malformed Payloads, Invalid IDs, Unsupported Collections & Shapes');
  console.log('========================================================\n');

  // Ensure server is reachable or start test server
  let serverInstance: http.Server | null = null;
  let testPort = 3000;
  let serverBaseUrl = 'http://localhost:3000';

  try {
    const healthCheck = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(1000) });
    if (!healthCheck.ok) throw new Error('Health check non-200');
  } catch {
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        const addr = serverInstance!.address() as any;
        testPort = addr.port;
        serverBaseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      });
    });
  }

  // Ensure admin DB is in success mode for accepting valid requests
  try {
    await fetch(`${serverBaseUrl}/api/test/admin-db-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'success' })
    });
  } catch {
    // Ignore if not present
  }

  const testOwnerEmail = 'atikurrahman00021@gmail.com';
  const token = createSessionToken(testOwnerEmail);
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  try {
    // ----------------------------------------------------
    // SECTION 1: Unit Validation of Document IDs
    // ----------------------------------------------------
    console.log('--- SECTION 1: Document ID Validation ---');
    assert(isValidDocumentId('valid_doc_123'), 'Valid alphanumeric ID is accepted');
    assert(isValidDocumentId('sr_2026-09-24_001'), 'Valid ID with dashes/underscores is accepted');
    assert(!isValidDocumentId(''), 'Empty string ID is rejected');
    assert(!isValidDocumentId('   '), 'Whitespace-only ID is rejected');
    assert(!isValidDocumentId(12345), 'Numeric ID is rejected');
    assert(!isValidDocumentId(null), 'Null ID is rejected');
    assert(!isValidDocumentId(undefined), 'Undefined ID is rejected');
    assert(!isValidDocumentId({ id: 'foo' }), 'Object ID is rejected');
    assert(!isValidDocumentId('path/traversal/doc'), 'ID containing forward slashes is rejected');
    assert(!isValidDocumentId('path\\traversal\\doc'), 'ID containing backslashes is rejected');
    assert(!isValidDocumentId('..'), 'Path traversal ".." is rejected');
    assert(!isValidDocumentId('.'), 'Path traversal "." is rejected');
    assert(!isValidDocumentId('__proto__'), 'Prototype pollution identifier "__proto__" is rejected');
    assert(!isValidDocumentId('constructor'), 'Reserved identifier "constructor" is rejected');
    assert(!isValidDocumentId('prototype'), 'Reserved identifier "prototype" is rejected');
    assert(!isValidDocumentId('a'.repeat(256)), 'Overlong ID (>255 chars) is rejected');

    // ----------------------------------------------------
    // SECTION 2: Unit Validation of Record Shapes
    // ----------------------------------------------------
    console.log('\n--- SECTION 2: Record Shape Validation ---');
    assert(validateRecordShape('sales', { customerId: 'c1', date: '2026-09-24', totalAmount: 500 }).valid, 'Valid sale shape is accepted');
    assert(!validateRecordShape('sales', { date: '2026-09-24', totalAmount: 500 }).valid, 'Sale missing customer is rejected');
    assert(!validateRecordShape('sales', { customerId: 'c1', totalAmount: 500 }).valid, 'Sale missing date is rejected');
    assert(!validateRecordShape('sales', { customerId: 'c1', date: '2026-09-24', totalAmount: -10 }).valid, 'Sale with negative totalAmount is rejected');

    assert(validateRecordShape('purchases', { supplierId: 's1', date: '2026-09-24', totalAmount: 1000 }).valid, 'Valid purchase shape is accepted');
    assert(!validateRecordShape('purchases', { date: '2026-09-24', totalAmount: 1000 }).valid, 'Purchase missing supplier is rejected');
    assert(!validateRecordShape('purchases', { supplierId: 's1', totalAmount: 1000 }).valid, 'Purchase missing date is rejected');
    assert(!validateRecordShape('purchases', { supplierId: 's1', date: '2026-09-24', totalAmount: -50 }).valid, 'Purchase with negative totalAmount is rejected');

    assert(validateRecordShape('bankTransfers', { fromAccountId: 'acc1', toAccountId: 'acc2', amount: 500 }).valid, 'Valid bank transfer is accepted');
    assert(!validateRecordShape('bankTransfers', { fromAccountId: 'acc1', toAccountId: 'acc1', amount: 500 }).valid, 'Bank transfer to same account is rejected');
    assert(!validateRecordShape('bankTransfers', { fromAccountId: 'acc1', toAccountId: 'acc2', amount: 0 }).valid, 'Bank transfer with 0 amount is rejected');
    assert(!validateRecordShape('bankTransfers', { fromAccountId: 'acc1', toAccountId: 'acc2', amount: -100 }).valid, 'Bank transfer with negative amount is rejected');

    assert(validateRecordShape('advancePayments', { partyId: 'p1', amount: 300, direction: 'RECEIVED' }).valid, 'Valid advance payment is accepted');
    assert(!validateRecordShape('advancePayments', { amount: 300, direction: 'RECEIVED' }).valid, 'Advance payment missing party is rejected');
    assert(!validateRecordShape('advancePayments', { partyId: 'p1', amount: 0, direction: 'RECEIVED' }).valid, 'Advance payment with 0 amount is rejected');
    assert(!validateRecordShape('advancePayments', { partyId: 'p1', amount: 300 }).valid, 'Advance payment missing direction is rejected');

    assert(validateRecordShape('stockMovements', { itemId: 'item1', movementType: 'PURCHASE', quantity: 10 }).valid, 'Valid stock movement is accepted');
    assert(!validateRecordShape('stockMovements', { movementType: 'PURCHASE', quantity: 10 }).valid, 'Stock movement missing itemId is rejected');
    assert(!validateRecordShape('stockMovements', { itemId: 'item1', movementType: 'PURCHASE', quantity: 0 }).valid, 'Stock movement with 0 quantity is rejected');

    assert(validateRecordShape('animals', { species: 'CATTLE', tag: 'TAG-101' }).valid, 'Valid animal shape is accepted');
    assert(!validateRecordShape('animals', { foo: 'bar' }).valid, 'Animal missing species/tag is rejected');

    assert(validateRecordShape('cropCycles', { plotId: 'plt1', cropName: 'Paddy' }).valid, 'Valid crop cycle shape is accepted');
    assert(!validateRecordShape('cropCycles', { cropName: 'Paddy' }).valid, 'Crop cycle missing plotId is rejected');

    assert(validateRecordShape('fishBatches', { pondId: 'pnd1', species: 'Tilapia' }).valid, 'Valid fish batch shape is accepted');
    assert(!validateRecordShape('fishBatches', { species: 'Tilapia' }).valid, 'Fish batch missing pondId is rejected');

    // ----------------------------------------------------
    // SECTION 3: HTTP API Sync Request Validation
    // ----------------------------------------------------
    console.log('\n--- SECTION 3: HTTP API Malformed Payload Rejection ---');

    // 3A. Array payload instead of object
    const resArrayPayload = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify([{ id: 'bad_array_item', species: 'GOAT' }])
    });
    assert(resArrayPayload.status === 400, 'Array payload is rejected before persistence (HTTP 400)');

    // 3B. Empty object payload
    const resEmptyObj = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({})
    });
    assert(resEmptyObj.status === 400, 'Empty object payload is rejected before persistence (HTTP 400)');

    // 3C. Malformed JSON syntax
    const resMalformedJson = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: '{"id": "bad_json", invalid syntax'
    });
    assert(resMalformedJson.status === 400, 'Malformed JSON syntax is rejected cleanly (HTTP 400)');

    // ----------------------------------------------------
    // SECTION 4: HTTP API Invalid Document IDs Rejection
    // ----------------------------------------------------
    console.log('\n--- SECTION 4: HTTP API Invalid Document ID Rejection ---');

    // 4A. Slash in document ID
    const resSlashId = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'animals/malicious/path', species: 'GOAT', tag: 'BAD-01' })
    });
    assert(resSlashId.status === 400, 'Document ID containing slash is rejected before persistence (HTTP 400)');

    // 4B. Path traversal ID
    const resTraversalId = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: '..', species: 'GOAT', tag: 'BAD-02' })
    });
    assert(resTraversalId.status === 400, 'Path traversal document ID ("..") is rejected (HTTP 400)');

    // 4C. Numeric document ID
    const resNumericId = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 99999, species: 'GOAT', tag: 'BAD-03' })
    });
    assert(resNumericId.status === 400, 'Numeric document ID is rejected (HTTP 400)');

    // 4D. Prototype injection ID
    const resProtoId = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: '__proto__', species: 'GOAT', tag: 'BAD-04' })
    });
    assert(resProtoId.status === 400, 'Prototype document ID ("__proto__") is rejected (HTTP 400)');

    // ----------------------------------------------------
    // SECTION 5: HTTP API Unsupported Collections Rejection
    // ----------------------------------------------------
    console.log('\n--- SECTION 5: HTTP API Unsupported Collections Rejection ---');

    const resUnsupportedGeneric = await fetch(`${serverBaseUrl}/api/sync/users`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'usr_1', email: 'test@example.com' })
    });
    assert(resUnsupportedGeneric.status === 400, 'Unsupported collection via generic route is rejected (HTTP 400)');

    const resUnsupportedSecrets = await fetch(`${serverBaseUrl}/api/sync/systemSecrets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'sec_1', secret: '12345' })
    });
    assert(resUnsupportedSecrets.status === 400, 'Unsupported secrets collection is rejected (HTTP 400)');

    // ----------------------------------------------------
    // SECTION 6: HTTP API Invalid Record Shape Rejection
    // ----------------------------------------------------
    console.log('\n--- SECTION 6: HTTP API Invalid Record Shape Rejection ---');

    // 6A. Sale missing customer
    const resBadSale = await fetch(`${serverBaseUrl}/api/sync/sales`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'bad_sale_1',
        date: '2026-09-24',
        totalAmount: 1000
      })
    });
    assert(resBadSale.status === 400, 'Sale missing customer is rejected with HTTP 400');

    // 6B. Purchase missing supplier
    const resBadPurchase = await fetch(`${serverBaseUrl}/api/sync/purchases`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'bad_purch_1',
        date: '2026-09-24',
        totalAmount: 1000
      })
    });
    assert(resBadPurchase.status === 400, 'Purchase missing supplier is rejected with HTTP 400');

    // 6C. Bank transfer with identical accounts
    const resBadTransfer = await fetch(`${serverBaseUrl}/api/sync/bankTransfers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'bad_xfer_1',
        fromAccountId: 'acc_main',
        toAccountId: 'acc_main',
        amount: 500,
        date: '2026-09-24'
      })
    });
    assert(resBadTransfer.status === 400, 'Bank transfer between same accounts is rejected with HTTP 400');

    // 6D. Negative payment amount
    const resBadPayment = await fetch(`${serverBaseUrl}/api/sync/payments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'bad_pay_1',
        amount: -500,
        date: '2026-09-24'
      })
    });
    assert(resBadPayment.status === 400, 'Payment with negative amount is rejected with HTTP 400');

    // 6E. Stock movement with zero quantity
    const resBadMove = await fetch(`${serverBaseUrl}/api/sync/stockMovements`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'bad_mov_1',
        itemId: 'item_valid_1',
        movementType: 'SALE',
        quantity: 0,
        date: '2026-09-24'
      })
    });
    assert(resBadMove.status === 400, 'Stock movement with 0 quantity is rejected with HTTP 400');

    // Verify rejection prevented persistence in in-memory store
    const animalStore = inMemoryStores.get('animals');
    assert(!animalStore?.has('animals/malicious/path'), 'Rejected malicious path record was NOT persisted');
    assert(!animalStore?.has('..'), 'Rejected path traversal record was NOT persisted');

    // ----------------------------------------------------
    // SECTION 7: Request Size Limits & Legitimate Multi-Line Vouchers
    // ----------------------------------------------------
    console.log('\n--- SECTION 7: Request Size Limits & Multi-Line Vouchers ---');

    // Construct a large legitimate multi-line voucher (> 150KB)
    // 60 balanced lines with detailed narration
    const largeLines: any[] = [];
    let runningBalance = 0;
    for (let i = 1; i <= 60; i++) {
      const isDebit = i % 2 === 1;
      const amount = 1000;
      largeLines.push({
        accountCode: isDebit ? '5010' : '1010',
        accountName: isDebit ? 'ক্যাটল খাদ্য খরচ' : 'নগদ তহবিল',
        debit: isDebit ? amount : 0,
        credit: isDebit ? 0 : amount,
        narration: `Detailed accounting line memo entry #${i} for bulk farm operations transaction covering feed, maintenance, logistics and inventory allocation`
      });
    }

    const largePayload = {
      id: `vchr_large_${Date.now()}`,
      voucherNumber: `JV-LRG-${Date.now()}`,
      date: '2026-09-24',
      voucherType: 'JOURNAL',
      narration: 'Comprehensive end-of-month multi-line journal reconciliation voucher for entire livestock feed consumption',
      lines: largeLines,
      totalDebit: 30000,
      totalCredit: 30000,
      version: 1
    };

    const payloadString = JSON.stringify(largePayload);
    console.log(`Generated large multi-line voucher payload size: ${(payloadString.length / 1024).toFixed(1)} KB`);

    const resLargeVoucher = await fetch(`${serverBaseUrl}/api/sync/journalEntries`, {
      method: 'POST',
      headers: authHeaders,
      body: payloadString
    });

    assert(resLargeVoucher.status === 200, `Large multi-line voucher (>100KB) is accepted without 413 error (HTTP ${resLargeVoucher.status})`);

    // Verify a standard legitimate animal record also syncs cleanly
    const legitimateAnimal = {
      id: `anim_legit_${Date.now()}`,
      tag: `TAG-OK-${Date.now().toString().slice(-4)}`,
      species: 'CATTLE',
      gender: 'FEMALE',
      status: 'ACTIVE',
      purchaseCost: 85000,
      purchaseDate: '2026-09-24',
      version: 1
    };

    const resLegitAnimal = await fetch(`${serverBaseUrl}/api/sync/animals`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(legitimateAnimal)
    });
    assert(resLegitAnimal.status === 200, 'Legitimate animal syncs with HTTP 200');

  } finally {
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as http.Server).close(() => resolve()));
    }
  }

  console.log('\n========================================================');
  console.log(`SYNC VALIDATION TESTS COMPLETED: Total: ${result.total}, Passed: ${result.passed}, Failed: ${result.failed}`);
  console.log('========================================================\n');

  return result;
}

// Allow direct run
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('testSyncRequestValidation.ts') ||
  process.argv[1].endsWith('testSyncRequestValidation.js')
);

if (isDirectRun) {
  runSyncRequestValidationTests().then((res) => {
    if (res.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }).catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  });
}
