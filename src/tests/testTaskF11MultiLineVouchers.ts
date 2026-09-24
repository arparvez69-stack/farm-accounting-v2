import 'fake-indexeddb/auto';
import { db } from '../db/indexedDb';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import {
  executePurchaseTransaction,
  executeSaleTransaction
} from '../services/transactionService';
import { InventoryItem, Party } from '../types';

export interface AssertionResult {
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

export async function runTaskF11MultiLineVouchersTests(): Promise<AssertionResult> {
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
  console.log('F11 TEST SUITE: MULTI-LINE PURCHASE AND SALES VOUCHERS');
  console.log('Testing Eggs + Bread + Rice Purchase, Movements, Journal & Atomicity');
  console.log('========================================================\n');

  try {
    // 0. Ensure Chart of Accounts
    await db.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS);

    // 1. Setup Test Master Data
    const eggItem: InventoryItem = {
      id: 'item_test_eggs_' + Date.now(),
      code: 'ITM-EGG-01',
      nameBn: 'ডিম (Eggs)',
      nameEn: 'Eggs',
      category: 'FEED',
      unit: 'হালি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 40,
      reorderLevel: 10
    };

    const breadItem: InventoryItem = {
      id: 'item_test_bread_' + Date.now(),
      code: 'ITM-BRD-01',
      nameBn: 'পাউরুটি (Bread)',
      nameEn: 'Bread',
      category: 'FEED',
      unit: 'প্যাকেট',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 50,
      reorderLevel: 5
    };

    const riceItem: InventoryItem = {
      id: 'item_test_rice_' + Date.now(),
      code: 'ITM-RIC-01',
      nameBn: 'চাল (Rice)',
      nameEn: 'Rice',
      category: 'FARM_PRODUCT',
      unit: 'কেজি',
      currentStock: 0,
      avgCostPrice: 0,
      sellingPrice: 70,
      reorderLevel: 20
    };

    await db.inventoryItems.bulkPut([eggItem, breadItem, riceItem]);

    const testSupplier: Party = {
      id: 'sup_test_' + Date.now(),
      name: 'মেসার্স ভাই ভাই এন্টারপ্রাইজ (Supplier)',
      type: 'SUPPLIER',
      phone: '01700000001',
      balance: 0
    };
    await db.parties.put(testSupplier);

    const testCustomer: Party = {
      id: 'cust_test_' + Date.now(),
      name: 'করিম স্টোর (Customer)',
      type: 'CUSTOMER',
      phone: '01800000001',
      balance: 0
    };
    await db.parties.put(testCustomer);

    // Initial counts
    const initialPurchasesCount = await db.purchases.count();
    const initialStockMovementsCount = await db.stockMovements.count();
    const initialJournalsCount = await db.journalEntries.count();

    // =========================================================================
    // TEST CASE 1: Eggs + Bread + Rice in ONE purchase voucher (CREDIT)
    // =========================================================================
    // Eggs: 10 h规范 @ 30 = 300
    // Bread: 5 packets @ 35 = 175
    // Rice: 20 kg @ 50 = 1000
    // Transport: 50
    // Discount: 25
    // Expected Items Subtotal: 300 + 175 + 1000 = 1475
    // Net Grand Total: 1475 + 50 - 25 = 1500
    // =========================================================================
    const purchaseResult = await executePurchaseTransaction(
      {
        supplier: testSupplier,
        items: [
          { item: eggItem, quantity: 10, unitPrice: 30 },
          { item: breadItem, quantity: 5, unitPrice: 35 },
          { item: riceItem, quantity: 20, unitPrice: 50 }
        ],
        transportCost: 50,
        discount: 25,
        paymentMethod: 'CREDIT',
        currentUserId: 'test_user'
      },
      db
    );

    assert(!!purchaseResult && !!purchaseResult.purchase, 'Purchase transaction executed successfully');
    const finalPurchasesCount = await db.purchases.count();
    assert(finalPurchasesCount === initialPurchasesCount + 1, 'Exactly ONE purchase voucher created in database');

    const createdPurchase = await db.purchases.get(purchaseResult.purchase.id);
    assert(createdPurchase?.items?.length === 3, 'Purchase voucher contains exactly 3 item lines');
    assert(createdPurchase?.subtotal === 1475, 'Purchase items subtotal is correct (৳1475)');
    assert(createdPurchase?.grandTotal === 1500, 'Purchase grand total with transport & discount is correct (৳1500)');
    assert(createdPurchase?.dueAmount === 1500, 'Purchase due amount for credit is correct (৳1500)');

    // Verify inventory movements
    const updatedEgg = await db.inventoryItems.get(eggItem.id);
    const updatedBread = await db.inventoryItems.get(breadItem.id);
    const updatedRice = await db.inventoryItems.get(riceItem.id);

    assert(updatedEgg?.currentStock === 10, 'Egg stock correctly increased to 10');
    assert(updatedBread?.currentStock === 5, 'Bread stock correctly increased to 5');
    assert(updatedRice?.currentStock === 20, 'Rice stock correctly increased to 20');

    const newStockMovements = await db.stockMovements
      .filter((sm) => sm.referenceId === createdPurchase?.invoiceNumber)
      .toArray();
    assert(newStockMovements.length === 3, 'Exactly 3 stock movements created for the multi-line purchase voucher');

    // Verify journal entry
    const journalEntry = await db.journalEntries.get(purchaseResult.journalEntryId);
    assert(!!journalEntry, 'Associated journal entry exists');

    const totalDebit = journalEntry?.lines.reduce((s, l) => s + (l.debit || 0), 0) || 0;
    const totalCredit = journalEntry?.lines.reduce((s, l) => s + (l.credit || 0), 0) || 0;
    assert(Math.abs(totalDebit - totalCredit) < 0.01, `Journal is balanced: Debit = ৳${totalDebit}, Credit = ৳${totalCredit}`);

    // Verify supplier balance
    const updatedSupplier = await db.parties.get(testSupplier.id);
    assert(updatedSupplier?.balance === 1500, `Supplier balance correctly increased to ৳1500 (actual: ৳${updatedSupplier?.balance})`);

    // =========================================================================
    // TEST CASE 2: Atomicity - If any line fails validation/stock, ENTIRE voucher fails atomically
    // =========================================================================
    const preFailPurchasesCount = await db.purchases.count();
    const preFailMovementsCount = await db.stockMovements.count();
    const preFailJournalsCount = await db.journalEntries.count();

    let atomicityFailedAsExpected = false;
    try {
      await executePurchaseTransaction(
        {
          supplier: testSupplier,
          items: [
            { item: eggItem, quantity: 5, unitPrice: 30 },
            { item: { ...breadItem, id: 'non_existent_item_id' }, quantity: 2, unitPrice: 35 } // Will fail!
          ],
          paymentMethod: 'CREDIT',
          currentUserId: 'test_user'
        },
        db
      );
    } catch (e: any) {
      atomicityFailedAsExpected = true;
    }

    assert(atomicityFailedAsExpected, 'Invalid item in line caused purchase transaction to reject');
    const postFailPurchasesCount = await db.purchases.count();
    const postFailMovementsCount = await db.stockMovements.count();
    const postFailJournalsCount = await db.journalEntries.count();

    assert(postFailPurchasesCount === preFailPurchasesCount, 'No purchase voucher persisted after line failure');
    assert(postFailMovementsCount === preFailMovementsCount, 'No stock movements persisted after line failure');
    assert(postFailJournalsCount === preFailJournalsCount, 'No journal entry persisted after line failure');

    // =========================================================================
    // TEST CASE 3: Multi-Line Sale Voucher & Stock Validation Atomicity
    // =========================================================================
    // Attempt sale where one item exceeds available stock (Eggs: available 10, requested 15)
    let saleAtomicityFailed = false;
    try {
      await executeSaleTransaction(
        {
          customer: testCustomer,
          items: [
            { item: breadItem, quantity: 2, unitPrice: 50 },
            { item: eggItem, quantity: 15, unitPrice: 40 } // Exceeds 10!
          ],
          paymentMethod: 'CASH',
          currentUserId: 'test_user'
        },
        db
      );
    } catch (e: any) {
      saleAtomicityFailed = true;
    }

    assert(saleAtomicityFailed, 'Insufficient stock on line 2 aborted entire sales voucher atomically');
    const breadItemAfterFailedSale = await db.inventoryItems.get(breadItem.id);
    assert(breadItemAfterFailedSale?.currentStock === 5, 'Bread stock remained untouched at 5 after atomic rollback');

    // Valid Multi-Line Sale Voucher
    // Bread: 2 @ 50 = 100
    // Eggs: 4 @ 40 = 160
    // Rice: 5 @ 70 = 350
    // Subtotal: 610, Discount: 10, Total: 600
    const saleResult = await executeSaleTransaction(
      {
        customer: testCustomer,
        items: [
          { item: breadItem, quantity: 2, unitPrice: 50 },
          { item: eggItem, quantity: 4, unitPrice: 40 },
          { item: riceItem, quantity: 5, unitPrice: 70 }
        ],
        discount: 10,
        paymentMethod: 'CREDIT',
        currentUserId: 'test_user'
      },
      db
    );

    assert(!!saleResult && !!saleResult.sale, 'Valid multi-line sale completed successfully');
    const createdSale = await db.sales.get(saleResult.sale.id);
    assert(createdSale?.items?.length === 3, 'Sale record contains exactly 3 item lines');
    assert(createdSale?.totalAmount === 600, 'Sale totalAmount is ৳600');
    assert(createdSale?.dueAmount === 600, 'Sale dueAmount is ৳600 for credit sale');

    const breadAfterSale = await db.inventoryItems.get(breadItem.id);
    const eggAfterSale = await db.inventoryItems.get(eggItem.id);
    const riceAfterSale = await db.inventoryItems.get(riceItem.id);
    assert(breadAfterSale?.currentStock === 3, 'Bread stock reduced from 5 to 3');
    assert(eggAfterSale?.currentStock === 6, 'Egg stock reduced from 10 to 6');
    assert(riceAfterSale?.currentStock === 15, 'Rice stock reduced from 20 to 15');

    const customerAfterSale = await db.parties.get(testCustomer.id);
    assert(customerAfterSale?.balance === 600, 'Customer receivable balance is ৳600');

    // =========================================================================
    // TEST CASE 4: Backward Compatibility with Single-Item Calls
    // =========================================================================
    const singlePurchase = await executePurchaseTransaction(
      {
        supplier: testSupplier,
        item: breadItem,
        quantity: 1,
        unitPrice: 35,
        paymentMethod: 'CREDIT',
        currentUserId: 'test_user'
      },
      db
    );
    assert(!!singlePurchase.purchase, 'Single-item purchase remains fully backward-compatible');
    assert(singlePurchase.purchase.items?.length === 1, 'Single-item purchase has 1 item line');

    const singleSale = await executeSaleTransaction(
      {
        customer: testCustomer,
        item: breadItem,
        quantity: 1,
        unitPrice: 50,
        paymentMethod: 'CREDIT',
        currentUserId: 'test_user'
      },
      db
    );
    assert(!!singleSale.sale, 'Single-item sale remains fully backward-compatible');
    assert(singleSale.sale.items?.length === 1, 'Single-item sale has 1 item line');

  } catch (err: any) {
    result.total++;
    result.failed++;
    result.failures.push(`Unexpected error: ${err.message}`);
    console.error('Test error:', err);
  }

  return result;
}

if (typeof process !== 'undefined' && process.argv[1]?.includes('testTaskF11MultiLineVouchers')) {
  runTaskF11MultiLineVouchersTests()
    .then((res) => {
      process.exit(res.failed === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
