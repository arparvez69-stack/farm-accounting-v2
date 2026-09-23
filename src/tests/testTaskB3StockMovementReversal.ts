import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { executeSaleTransaction, executePurchaseTransaction } from '../services/transactionService';
import { reverseTransaction } from '../accounting/accountingEngine';
import { StockMovement, InventoryItem, Party, CashBankAccount } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runTaskB3Tests() {
  console.log('--- Starting Task B3 Stock Movement Reversal Tests ---');

  await db.delete();
  await db.open();

  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await db.accounts.add({
      ...acc
    });
  }

  const timestamp = Date.now();
  const testUserId = `user_b3_${timestamp}`;

  // 1. Setup Accounts and Cash
  const cashAcc: CashBankAccount = {
    id: `cb_b3_${timestamp}`,
    name: 'Test Cash B3',
    accountName: 'Test Cash B3',
    accountType: 'CASH',
    accountNumber: `CB-${timestamp}`,
    currentBalance: 100000,
    isActive: true,
    synced: false
  };
  await db.cashBankAccounts.put(cashAcc);

  // 2. Setup Party
  const customer: Party = {
    id: `cust_b3_${timestamp}`,
    name: 'Customer B3',
    phone: '01700000001',
    type: 'CUSTOMER',
    balance: 0,
    isActive: true,
    synced: false
  };
  await db.parties.put(customer);

  const supplier: Party = {
    id: `supp_b3_${timestamp}`,
    name: 'Supplier B3',
    phone: '01700000002',
    type: 'SUPPLIER',
    balance: 0,
    isActive: true,
    synced: false
  };
  await db.parties.put(supplier);

  // 3. Setup Inventory Items
  const saleItem: InventoryItem = {
    id: `item_sale_b3_${timestamp}`,
    code: `ITM-SALE-${timestamp}`,
    nameBn: 'Sale Item B3',
    nameEn: 'Sale Item B3',
    category: 'FARM_PRODUCT',
    currentStock: 100,
    unit: 'kg',
    avgCostPrice: 50,
    sellingPrice: 80,
    reorderLevel: 10,
    synced: false
  };
  await db.inventoryItems.put(saleItem);

  const purchaseItem: InventoryItem = {
    id: `item_pur_b3_${timestamp}`,
    code: `ITM-PUR-${timestamp}`,
    nameBn: 'Purchase Item B3',
    nameEn: 'Purchase Item B3',
    category: 'FEED',
    currentStock: 50,
    unit: 'kg',
    avgCostPrice: 80,
    sellingPrice: 100,
    reorderLevel: 5,
    synced: false
  };
  await db.inventoryItems.put(purchaseItem);

  // ==========================================
  // TEST 1: SALE STOCK MOVEMENT REVERSAL
  // ==========================================
  console.log('Test 1: Testing Sale Stock Movement Reversal...');
  const saleRes = await executeSaleTransaction({
    date: '2026-04-10',
    customer,
    item: saleItem,
    quantity: 20,
    unitPrice: 80,
    paymentMethod: 'CASH',
    cashBankAccountId: cashAcc.id,
    currentUserId: testUserId
  });

  assert(Boolean(saleRes.sale), 'Sale transaction execution should succeed');
  const saleJournalId = saleRes.journalEntryId!;

  // Verify initial stock movement created by sale
  const postSaleMovements = await db.stockMovements.where('itemId').equals(saleItem.id).toArray();
  assert(postSaleMovements.length === 1, 'Exactly one stock movement should exist after sale');
  const originalSaleSm = postSaleMovements[0];
  assert(originalSaleSm.movementType === 'SALE', 'Original movement type must be SALE');
  assert(originalSaleSm.quantity === 20, 'Original movement quantity must be 20');

  // Verify stock decremented
  const postSaleItem = await db.inventoryItems.get(saleItem.id);
  assert(postSaleItem?.currentStock === 80, 'Item stock should be 80 after sale');

  // Execute Reversal
  const saleRevRes = await reverseTransaction(saleJournalId, testUserId, '2026-04-11');
  assert(Boolean(saleRevRes.reversal), 'Reversal transaction should succeed');

  // Verify Original Movement NOT deleted
  const refreshedOriginalSaleSm = await db.stockMovements.get(originalSaleSm.id);
  assert(Boolean(refreshedOriginalSaleSm), 'Original stock movement must NOT be deleted');
  assert(refreshedOriginalSaleSm?.status === 'REVERSED', 'Original stock movement must be tagged REVERSED');
  assert(Boolean(refreshedOriginalSaleSm?.reversedBy), 'Original stock movement must have reversedBy set');

  // Verify Counter Movement created
  const postRevSaleMovements = await db.stockMovements.where('itemId').equals(saleItem.id).toArray();
  assert(postRevSaleMovements.length === 2, 'Exactly 2 movements should exist (original + counter)');
  const counterSaleSm = postRevSaleMovements.find(m => m.id !== originalSaleSm.id);
  assert(Boolean(counterSaleSm), 'Counter stock movement must exist');
  assert(counterSaleSm?.reversalOf === originalSaleSm.id, 'Counter movement reversalOf must equal original movement id');
  assert(refreshedOriginalSaleSm?.reversedBy === counterSaleSm?.id, 'Original movement reversedBy must equal counter movement id');
  assert(counterSaleSm?.quantity === 20, 'Counter movement quantity must match original movement quantity');
  assert(counterSaleSm?.movementType === 'REVERSAL', 'Counter movement movementType must be REVERSAL');
  assert((counterSaleSm as any)?.direction === 'IN', 'Counter movement for sale must be IN (restoring stock)');

  // Verify item stock restored
  const postRevSaleItem = await db.inventoryItems.get(saleItem.id);
  assert(postRevSaleItem?.currentStock === 100, 'Item stock must be restored to 100');

  console.log('✓ Test 1: Sale Stock Movement Reversal passed.');

  // ==========================================
  // TEST 2: PURCHASE STOCK MOVEMENT REVERSAL
  // ==========================================
  console.log('Test 2: Testing Purchase Stock Movement Reversal...');
  const purRes = await executePurchaseTransaction({
    date: '2026-04-10',
    supplier,
    item: purchaseItem,
    quantity: 30,
    unitPrice: 80,
    paymentMethod: 'CASH',
    cashBankAccountId: cashAcc.id,
    currentUserId: testUserId
  });

  assert(Boolean(purRes.purchase), 'Purchase transaction execution should succeed');
  const purJournalId = purRes.journalEntryId!;

  // Verify initial stock movement created by purchase
  const postPurMovements = await db.stockMovements.where('itemId').equals(purchaseItem.id).toArray();
  assert(postPurMovements.length === 1, 'Exactly one stock movement should exist after purchase');
  const originalPurSm = postPurMovements[0];
  assert(originalPurSm.movementType === 'PURCHASE', 'Original movement type must be PURCHASE');
  assert(originalPurSm.quantity === 30, 'Original movement quantity must be 30');

  // Verify stock incremented
  const postPurItem = await db.inventoryItems.get(purchaseItem.id);
  assert(postPurItem?.currentStock === 80, 'Item stock should be 80 after purchase');

  // Execute Reversal
  const purRevRes = await reverseTransaction(purJournalId, testUserId, '2026-04-11');
  assert(Boolean(purRevRes.reversal), 'Reversal transaction should succeed');

  // Verify Original Movement NOT deleted
  const refreshedOriginalPurSm = await db.stockMovements.get(originalPurSm.id);
  assert(Boolean(refreshedOriginalPurSm), 'Original purchase stock movement must NOT be deleted');
  assert(refreshedOriginalPurSm?.status === 'REVERSED', 'Original purchase stock movement must be tagged REVERSED');
  assert(Boolean(refreshedOriginalPurSm?.reversedBy), 'Original purchase stock movement must have reversedBy set');

  // Verify Counter Movement created
  const postRevPurMovements = await db.stockMovements.where('itemId').equals(purchaseItem.id).toArray();
  assert(postRevPurMovements.length === 2, 'Exactly 2 movements should exist (original + counter)');
  const counterPurSm = postRevPurMovements.find(m => m.id !== originalPurSm.id);
  assert(Boolean(counterPurSm), 'Counter stock movement must exist');
  assert(counterPurSm?.reversalOf === originalPurSm.id, 'Counter movement reversalOf must equal original purchase movement id');
  assert(refreshedOriginalPurSm?.reversedBy === counterPurSm?.id, 'Original movement reversedBy must equal counter movement id');
  assert(counterPurSm?.quantity === 30, 'Counter movement quantity must match original purchase movement quantity');
  assert(counterPurSm?.movementType === 'REVERSAL', 'Counter movement movementType must be REVERSAL');
  assert((counterPurSm as any)?.direction === 'OUT', 'Counter movement for purchase must be OUT (deducting stock)');

  // Verify item stock restored
  const postRevPurItem = await db.inventoryItems.get(purchaseItem.id);
  assert(postRevPurItem?.currentStock === 50, 'Item stock must be restored to 50');

  console.log('✓ Test 2: Purchase Stock Movement Reversal passed.');

  console.log('--- ALL TASK B3 TESTS PASSED SUCCESSFULLY! ---');
  return true;
}

runTaskB3Tests()
  .then(() => {
    console.log('Task B3 finished successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Task B3 failed:', err);
    process.exit(1);
  });

