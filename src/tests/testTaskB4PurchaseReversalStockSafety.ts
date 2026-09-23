import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { reverseTransaction } from '../accounting/accountingEngine';
import { executePurchaseTransaction } from '../services/transactionService';
import { executeUndo } from '../services/undoService';
import { InventoryItem, Party } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export async function runTaskB4Tests() {
  console.log('====================================================');
  console.log('RUNNING TASK B4: PURCHASE REVERSAL STOCK SAFETY TESTS');
  console.log('====================================================');

  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.add({ ...acc });
  }

  const cashAcc = {
    id: 'cba-cash-01',
    name: 'Main Cash',
    accountName: 'Main Cash',
    accountType: 'CASH' as const,
    accountNumber: '1010-01',
    currentBalance: 500000,
    isActive: true,
    isDefault: true,
    synced: false
  };
  await db.cashBankAccounts.add(cashAcc);

  const supplier: Party = {
    id: 'party-supp-01',
    type: 'SUPPLIER',
    name: 'Mega Agro Feed Supplier',
    phone: '01711000000',
    balance: 0,
    isActive: true,
    synced: false
  };
  await db.parties.add(supplier);

  const testUserId = 'usr-test-b4';

  // ========================================================
  // TEST 1: Insufficient stock rejects purchase reversal and leaves state unchanged
  // ========================================================
  console.log('\n--- Test 1: Insufficient Stock Rejects Purchase Reversal (No Partial Changes, Never Clamp to Zero) ---');
  const feedItem: InventoryItem = {
    id: 'item-feed-b4-01',
    code: 'FEED-B4-01',
    nameBn: 'স্টার্টার ফিড',
    nameEn: 'Starter Feed',
    category: 'FEED',
    unit: 'কেজি',
    currentStock: 20,
    avgCostPrice: 50,
    sellingPrice: 0,
    reorderLevel: 10,
    synced: false
  };
  await db.inventoryItems.add(feedItem);

  // Purchase 50 kg -> Stock becomes 70 kg
  const pur1Res = await executePurchaseTransaction({
    date: '2026-04-10',
    supplier,
    item: feedItem,
    quantity: 50,
    unitPrice: 60,
    paymentMethod: 'CASH',
    cashBankAccountId: cashAcc.id,
    currentUserId: testUserId
  });

  const pur1JournalId = pur1Res.journalEntryId!;
  const pur1Id = pur1Res.purchase.id;

  const itemAfterPur1 = await db.inventoryItems.get(feedItem.id);
  assert(itemAfterPur1?.currentStock === 70, `Item stock should be 70 after purchase, got ${itemAfterPur1?.currentStock}`);

  // Now simulate feed consumption: reduce stock to 30 kg (which is less than the 50 kg purchased)
  await db.inventoryItems.update(feedItem.id, { currentStock: 30 });
  const itemBeforeReversalAttempt = await db.inventoryItems.get(feedItem.id);
  assert(itemBeforeReversalAttempt?.currentStock === 30, 'Current stock should be set to 30');

  // Attempt reversal of the 50 kg purchase
  let errorCaught = false;
  try {
    await reverseTransaction(pur1JournalId, testUserId, '2026-04-11');
  } catch (err: any) {
    errorCaught = true;
    console.log(`✓ Expected error caught: ${err.message}`);
  }

  assert(errorCaught, 'Purchase reversal MUST be rejected when current stock is insufficient!');

  // Verify NO PARTIAL CHANGES were made
  const itemAfterFailedReversal = await db.inventoryItems.get(feedItem.id);
  assert(
    itemAfterFailedReversal?.currentStock === 30,
    `Stock must NOT change or clamp to zero! Expected 30, got ${itemAfterFailedReversal?.currentStock}`
  );

  const purchaseAfterFailedReversal = await db.purchases.get(pur1Id);
  assert(
    purchaseAfterFailedReversal?.status !== 'CANCELLED',
    `Purchase status must NOT be cancelled on rejected reversal, got ${purchaseAfterFailedReversal?.status}`
  );

  const originalJournalAfterFailedReversal = await db.journalEntries.get(pur1JournalId);
  assert(
    originalJournalAfterFailedReversal?.status !== 'REVERSED',
    `Original journal must NOT be marked REVERSED on rejected reversal, got ${originalJournalAfterFailedReversal?.status}`
  );
  assert(
    !originalJournalAfterFailedReversal?.reversedBy,
    'Original journal reversedBy must NOT be set on rejected reversal'
  );

  const allReversals = await db.journalEntries.where('reversalOf').equals(pur1JournalId).toArray();
  assert(allReversals.length === 0, 'No reversal journal entry should have been posted');

  const stockMovements = await db.stockMovements.where('itemId').equals(feedItem.id).toArray();
  const counterMovements = stockMovements.filter(m => m.movementType === 'REVERSAL');
  assert(counterMovements.length === 0, 'No reversal stock movement should have been created');

  console.log('✓ Test 1 passed: Purchase reversal rejected with no partial changes and no silent clamping.');

  // ========================================================
  // TEST 2: Successful reversal when sufficient stock exists
  // ========================================================
  console.log('\n--- Test 2: Successful Reversal When Sufficient Stock Exists ---');
  // Restore stock to 60 kg (which is >= 50 kg required to remove)
  await db.inventoryItems.update(feedItem.id, { currentStock: 60 });

  const revRes = await reverseTransaction(pur1JournalId, testUserId, '2026-04-11');
  assert(Boolean(revRes.reversal), 'Reversal should succeed when stock is sufficient');

  const itemAfterSuccessReversal = await db.inventoryItems.get(feedItem.id);
  assert(
    itemAfterSuccessReversal?.currentStock === 10,
    `Stock should be 60 - 50 = 10, got ${itemAfterSuccessReversal?.currentStock}`
  );

  const purchaseAfterSuccess = await db.purchases.get(pur1Id);
  assert(purchaseAfterSuccess?.status === 'CANCELLED', 'Purchase status should be CANCELLED');

  const journalAfterSuccess = await db.journalEntries.get(pur1JournalId);
  assert(journalAfterSuccess?.status === 'REVERSED', 'Journal entry should be REVERSED');

  console.log('✓ Test 2 passed: Reversal succeeds properly when stock is sufficient.');

  // ========================================================
  // TEST 3: Multi-item purchase reversal stock safety
  // ========================================================
  console.log('\n--- Test 3: Multi-Item Purchase Reversal (Partial stock deficiency on one item rejects entire reversal) ---');
  const itemA: InventoryItem = {
    id: 'item-multi-a',
    code: 'MULTI-A',
    nameBn: 'আইটেম এ',
    nameEn: 'Item A',
    category: 'RAW_MATERIAL',
    unit: 'পিস',
    currentStock: 100,
    avgCostPrice: 10,
    sellingPrice: 0,
    reorderLevel: 5,
    synced: false
  };
  const itemB: InventoryItem = {
    id: 'item-multi-b',
    code: 'MULTI-B',
    nameBn: 'আইটেম বি',
    nameEn: 'Item B',
    category: 'RAW_MATERIAL',
    unit: 'পিস',
    currentStock: 5, // Insufficient for purchase of 20
    avgCostPrice: 20,
    sellingPrice: 0,
    reorderLevel: 5,
    synced: false
  };
  await db.inventoryItems.add(itemA);
  await db.inventoryItems.add(itemB);

  // Directly insert multi-item purchase record and journal entry
  const multiPurId = 'pur-multi-01';
  const multiJId = 'j-multi-01';
  await db.purchases.add({
    id: multiPurId,
    invoiceNumber: 'PUR-MULTI-01',
    supplierId: supplier.id,
    supplierName: supplier.name,
    date: '2026-04-12',
    items: [
      { itemId: itemA.id, itemName: itemA.nameBn, quantity: 15, unitPrice: 10, lineTotal: 150 },
      { itemId: itemB.id, itemName: itemB.nameBn, quantity: 20, unitPrice: 20, lineTotal: 400 }
    ],
    grandTotal: 550,
    paidAmount: 550,
    paymentMethod: 'CASH',
    journalEntryId: multiJId,
    status: 'PAID',
    synced: false
  });

  await db.journalEntries.add({
    id: multiJId,
    voucherNumber: 'PRV-MULTI-01',
    voucherType: 'PURCHASE',
    date: '2026-04-12',
    narration: 'Multi-item purchase',
    reference: 'PUR-MULTI-01',
    lines: [
      { accountId: '1055', accountCode: '1055', accountName: 'কাঁচামাল', debit: 550, credit: 0 },
      { accountId: '1010', accountCode: '1010', accountName: 'নগদ', debit: 0, credit: 550 }
    ],
    createdBy: testUserId,
    createdAt: new Date().toISOString(),
    status: 'POSTED'
  });

  let multiErrorCaught = false;
  try {
    await reverseTransaction(multiJId, testUserId, '2026-04-13');
  } catch (err: any) {
    multiErrorCaught = true;
    console.log(`✓ Expected error caught for multi-item purchase: ${err.message}`);
  }

  assert(multiErrorCaught, 'Multi-item purchase reversal must be rejected when ANY item has insufficient stock');

  // Verify neither Item A nor Item B stock was changed (NO PARTIAL CHANGES)
  const itemAAfter = await db.inventoryItems.get(itemA.id);
  const itemBAfter = await db.inventoryItems.get(itemB.id);
  assert(itemAAfter?.currentStock === 100, `Item A stock must remain 100 (no partial changes), got ${itemAAfter?.currentStock}`);
  assert(itemBAfter?.currentStock === 5, `Item B stock must remain 5, got ${itemBAfter?.currentStock}`);

  console.log('✓ Test 3 passed: Multi-item purchase reversal cleanly rejected with no partial changes.');

  // ========================================================
  // TEST 4: UndoService Purchase Stock Safety
  // ========================================================
  console.log('\n--- Test 4: UndoService Purchase Stock Safety ---');
  const undoItem: InventoryItem = {
    id: 'item-undo-01',
    code: 'UNDO-01',
    nameBn: 'ইউন্ডো আইটেম',
    nameEn: 'Undo Item',
    category: 'FEED',
    unit: 'কেজি',
    currentStock: 5, // Insufficient for undoing purchase of 25
    avgCostPrice: 30,
    sellingPrice: 0,
    reorderLevel: 5,
    synced: false
  };
  await db.inventoryItems.add(undoItem);

  let undoErrorCaught = false;
  try {
    await executeUndo({
      type: 'PURCHASE',
      purchaseId: 'pur-fake-undo',
      journalEntryId: '',
      itemId: undoItem.id,
      quantity: 25,
      supplierId: supplier.id,
      grandTotal: 750,
      paymentMethod: 'CASH',
      currentUserId: testUserId
    });
  } catch (err: any) {
    undoErrorCaught = true;
    console.log(`✓ Expected error caught in executeUndo: ${err.message}`);
  }

  assert(undoErrorCaught, 'UndoService executeUndo must reject purchase undo when stock is insufficient');
  const undoItemAfter = await db.inventoryItems.get(undoItem.id);
  assert(undoItemAfter?.currentStock === 5, `Undo item stock must remain 5, got ${undoItemAfter?.currentStock}`);

  console.log('✓ Test 4 passed: UndoService rejected purchase undo on insufficient stock.');

  console.log('\n====================================================');
  console.log('ALL TASK B4 TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
  return true;
}

runTaskB4Tests()
  .then(() => {
    console.log('Task B4 tests finished successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Task B4 tests failed:', err);
    process.exit(1);
  });
