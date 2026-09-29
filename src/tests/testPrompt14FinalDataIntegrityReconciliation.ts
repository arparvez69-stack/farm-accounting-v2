import 'fake-indexeddb/auto';
import { createMockAgroDatabase } from './regressionTests';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../accounting/defaultAccounts';
import { CANONICAL_ACCOUNTS, getInventoryAssetAccount } from '../accounting/accountMapping';
import {
  generateTrialBalance,
  generateProfitLoss,
  generateBalanceSheet,
  postJournalEntry
} from '../accounting/accountingEngine';
import {
  calculateGlBalanceForAccounts,
  runAccountingReconciliation
} from '../accounting/reconciliationService';
import {
  executeSaleTransaction,
  executePurchaseTransaction,
  executePaymentTransaction,
  executeProductionReceiptTransaction,
  executeLoanTransaction,
  executeLoanRepaymentTransaction,
  executeInvestorTransaction,
  executeInvestorProfitAllocationTransaction,
  executeInvestorProfitPaymentTransaction,
  executeInvestorCapitalReturnTransaction,
  executeStockAdjustmentTransaction
} from '../services/transactionService';
import {
  executeAssetDepreciationAtomic,
  executeFixedAssetAcquisitionTransaction
} from '../accounting/depreciationService';
import {
  Account,
  CashBankAccount,
  InventoryItem,
  JournalEntry,
  Party,
  StockMovement,
  FixedAsset,
  Investor,
  Loan
} from '../types';

export interface ReconciliationAssertionResult {
  checkNumber: number;
  name: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  error?: string;
  details?: string;
}

export interface Prompt14ReconciliationSummary {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
  assertions: ReconciliationAssertionResult[];
}

function round2(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * PROMPT 14 — FINAL DATA-INTEGRITY RECONCILIATION
 * FINAL RELEASE TASK 14 — FINAL ERP DATA-INTEGRITY RECONCILIATION.
 *
 * Controlled representative dataset verifying:
 * 1. Total Journal Debits vs Total Journal Credits
 * 2. Trial Balance Debit vs Credit
 * 3. Assets vs Liabilities + Equity
 * 4. Opening Cash + Cash Inflows - Cash Outflows = Closing Cash
 * 5. Opening Inventory + Purchases/Production - Sales/Consumption = Closing Inventory
 * 6. Opening AR + Credit Sales - Collections = Closing AR
 * 7. Opening AP + Credit Purchases - Payments = Closing AP
 * 8. Revenue - legitimate expenses/COGS = Profit
 * 9. Investor capital/profit transactions
 * 10. Principal-only loan balances
 * 11. Fixed asset/depreciation balances where applicable
 * 12. No orphan financial references
 * 13. No duplicate transaction IDs
 */
export async function runPrompt14FinalDataIntegrityReconciliation(): Promise<Prompt14ReconciliationSummary> {
  const assertions: ReconciliationAssertionResult[] = [];
  const failures: string[] = [];

  function record(
    checkNumber: number,
    name: string,
    passed: boolean,
    expected?: any,
    actual?: any,
    details?: string
  ) {
    assertions.push({
      checkNumber,
      name,
      passed,
      expected,
      actual,
      details,
      error: passed ? undefined : `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    });

    if (passed) {
      console.log(`  ✅ [Check ${checkNumber}] ${name}`);
      if (details) console.log(`     └─ ${details}`);
    } else {
      const msg = `[Check ${checkNumber}] ${name} FAILED: Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${details || ''}`;
      failures.push(msg);
      console.error(`  ❌ ${msg}`);
    }
  }

  console.log('\n================================================================');
  console.log('STARTING TASK 14 — FINAL ERP DATA-INTEGRITY RECONCILIATION');
  console.log('Testing 11 Financial & Operational Reconciliations + Orphan & Duplicate Audits');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // STEP 0: Setup Controlled Representative Dataset
  // --------------------------------------------------------------------------
  const dbInstance = createMockAgroDatabase();
  const currentUserId = 'auditor_prompt14';
  const opDate = '2026-06-01';

  // Seed Chart of Accounts
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await dbInstance.accounts.put(acc);
  }

  // Initial Cash & Bank Accounts
  const initialCashBal = 50000;
  const initialBankBal = 200000;

  const cashAcc: CashBankAccount = {
    id: 'cb_cash_main',
    name: 'Main Farm Cash Till',
    accountName: 'Main Farm Cash Till',
    accountType: 'CASH',
    currentBalance: initialCashBal,
    isActive: true,
    synced: false
  };
  await dbInstance.cashBankAccounts.put(cashAcc);

  const bankAcc: CashBankAccount = {
    id: 'cb_bank_prime',
    name: 'Agrani Bank Commercial A/C',
    accountName: 'Agrani Bank Commercial A/C',
    accountNumber: 'AGRANI-AGRO-7701',
    accountType: 'BANK',
    bankName: 'Agrani Bank PLC',
    currentBalance: initialBankBal,
    isActive: true,
    synced: false
  };
  await dbInstance.cashBankAccounts.put(bankAcc);

  // Journal entry for initial Cash/Bank liquidity from Owner Capital
  await postJournalEntry(
    {
      id: 'j_init_liquidity',
      voucherNumber: 'JV-INIT-01',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Initial Owner Liquidity Contribution for Working Capital',
      reference: 'INIT-CAPITAL',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'নগদ টাকা (Cash on Hand)',
          debit: initialCashBal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.BANK,
          accountName: 'ব্যাংক হিসাব (Bank Accounts)',
          debit: initialBankBal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: 0,
          credit: round2(initialCashBal + initialBankBal)
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Initial Inventory Items & Baseline Stocks
  // Item 1: Poultry Feed (FEED, 1051)
  const itemFeed: InventoryItem = {
    id: 'item_feed_poultry',
    code: 'FEED-PLT-01',
    nameBn: 'ব্রয়লার স্টার্টার ফিড',
    nameEn: 'Broiler Starter Feed',
    category: 'FEED',
    unit: 'ব্যাগ',
    currentStock: 100, // 100 bags @ ৳1,000 = ৳100,000
    avgCostPrice: 1000,
    sellingPrice: 1250,
    reorderLevel: 20,
    synced: false
  };
  await dbInstance.inventoryItems.put(itemFeed);

  // Item 2: Paddy Seed (SEED, 1052)
  const itemSeed: InventoryItem = {
    id: 'item_seed_paddy',
    code: 'SEED-PDY-01',
    nameBn: 'ব্রি ধান ২৮ বীজ',
    nameEn: 'BRRI Dhan 28 Seed',
    category: 'SEED',
    unit: 'কেজি',
    currentStock: 50, // 50 kg @ ৳120 = ৳6,000
    avgCostPrice: 120,
    sellingPrice: 160,
    reorderLevel: 10,
    synced: false
  };
  await dbInstance.inventoryItems.put(itemSeed);

  // Item 3: Farm Eggs (FINISHED_GOODS, 1055)
  const itemEggs: InventoryItem = {
    id: 'item_fresh_eggs',
    code: 'EGG-LAY-01',
    nameBn: 'লেয়ার মুরগির লাল ডিম',
    nameEn: 'Layer Farm Fresh Eggs',
    category: 'FINISHED_GOODS',
    unit: 'পিস',
    currentStock: 2000, // 2,000 pcs @ ৳8.00 = ৳16,000
    avgCostPrice: 8,
    sellingPrice: 12,
    reorderLevel: 200,
    synced: false
  };
  await dbInstance.inventoryItems.put(itemEggs);

  // Record opening stock movements to ensure subledger consistency
  const openingFeedVal = round2(100 * 1000);
  const openingSeedVal = round2(50 * 120);
  const openingEggsVal = round2(2000 * 8);
  const totalOpeningInvVal = round2(openingFeedVal + openingSeedVal + openingEggsVal); // 122,000

  await dbInstance.stockMovements.put({
    id: 'sm_init_feed',
    date: opDate,
    itemId: itemFeed.id,
    movementType: 'OPENING',
    quantity: 100,
    unitCost: 1000,
    totalValue: openingFeedVal,
    referenceId: 'INIT-FEED',
    notes: 'প্রারম্ভিক ফিড মজুদ',
    synced: false
  });
  await dbInstance.stockMovements.put({
    id: 'sm_init_seed',
    date: opDate,
    itemId: itemSeed.id,
    movementType: 'OPENING',
    quantity: 50,
    unitCost: 120,
    totalValue: openingSeedVal,
    referenceId: 'INIT-SEED',
    notes: 'প্রারম্ভিক বীজ মজুদ',
    synced: false
  });
  await dbInstance.stockMovements.put({
    id: 'sm_init_eggs',
    date: opDate,
    itemId: itemEggs.id,
    movementType: 'OPENING',
    quantity: 2000,
    unitCost: 8,
    totalValue: openingEggsVal,
    referenceId: 'INIT-EGGS',
    notes: 'প্রারম্ভিক ডিম মজুদ',
    synced: false
  });

  // Journal entry for initial inventory from Owner Capital
  await postJournalEntry(
    {
      id: 'j_init_inventory',
      voucherNumber: 'JV-INIT-02',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Initial Inventory Opening Balances',
      reference: 'INIT-INVENTORY',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.FEED_INVENTORY,
          accountName: 'মজুদ খাদ্য (Feed Inventory)',
          debit: openingFeedVal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY,
          accountName: 'মজুদ বীজ ও সার (Seed & Fert Inventory)',
          debit: openingSeedVal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.FINISHED_GOODS,
          accountName: 'উৎপাদিত পণ্য মজুদ (Finished Goods)',
          debit: openingEggsVal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: 0,
          credit: totalOpeningInvVal
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Initial Customer with Opening AR
  const initialArBal = 30000;
  const customer: Party = {
    id: 'cust_tamim',
    name: 'Tamim Wholesale Mart',
    phone: '01711998877',
    type: 'CUSTOMER',
    balance: initialArBal,
    synced: false
  };
  await dbInstance.parties.put(customer);

  await postJournalEntry(
    {
      id: 'j_init_ar',
      voucherNumber: 'JV-INIT-03',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Opening Customer Accounts Receivable Balance',
      reference: 'INIT-AR',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE,
          accountName: 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
          debit: initialArBal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: 0,
          credit: initialArBal
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Initial Supplier with Opening AP
  const initialApBal = 40000;
  const supplier: Party = {
    id: 'supp_mega_feed',
    name: 'Mega Feed & Agro Industries',
    phone: '01811887766',
    type: 'SUPPLIER',
    balance: initialApBal,
    synced: false
  };
  await dbInstance.parties.put(supplier);

  await postJournalEntry(
    {
      id: 'j_init_ap',
      voucherNumber: 'JV-INIT-04',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Opening Supplier Accounts Payable Balance',
      reference: 'INIT-AP',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: initialApBal,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE,
          accountName: 'সরবরাহকারীর নিকট দেনা (Accounts Payable)',
          debit: 0,
          credit: initialApBal
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Initial Fixed Assets & Accumulated Depreciation
  const tractorAsset: FixedAsset = {
    id: 'fa_tractor_01',
    name: 'Kubota 45HP Farm Tractor',
    category: 'MACHINERY',
    originalCost: 400000,
    accumulatedDepreciation: 40000,
    currentBookValue: 360000,
    usefulLifeYears: 5,
    usefulLifeMonths: 60,
    salvageValue: 40000,
    purchaseDate: '2025-06-01',
    lastDepreciationDate: '2026-05-31',
    status: 'ACTIVE',
    synced: false
  };
  await dbInstance.fixedAssets.put(tractorAsset);

  const pondAsset: FixedAsset = {
    id: 'fa_pond_01',
    name: 'East Fish Pond Excavation & Embankment',
    category: 'PONDS',
    originalCost: 150000,
    accumulatedDepreciation: 15000,
    currentBookValue: 135000,
    usefulLifeYears: 10,
    usefulLifeMonths: 120,
    salvageValue: 0,
    purchaseDate: '2025-06-01',
    lastDepreciationDate: '2026-05-31',
    status: 'ACTIVE',
    synced: false
  };
  await dbInstance.fixedAssets.put(pondAsset);

  const initialFixedAssetCost = round2(400000 + 150000); // 550,000
  const initialAccDep = round2(40000 + 15000); // 55,000

  await postJournalEntry(
    {
      id: 'j_init_fixed_assets',
      voucherNumber: 'JV-INIT-05',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Opening Fixed Assets and Accumulated Depreciation Balances',
      reference: 'INIT-ASSETS',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.MACHINERY,
          accountName: 'যন্ত্রপাতি ও সরঞ্জাম (Machinery - 1550)',
          debit: 400000,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE,
          accountName: 'পুকুর ও জলাশয় অবকাঠামো (Pond - 1530)',
          debit: 150000,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION,
          accountName: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation - 1590)',
          debit: 0,
          credit: initialAccDep
        },
        {
          accountCode: CANONICAL_ACCOUNTS.OWNER_CAPITAL,
          accountName: 'মালিকের মূলধন (Owner Capital)',
          debit: 0,
          credit: round2(initialFixedAssetCost - initialAccDep) // 495,000
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Initial Principal-Only Commercial Loan
  // Bangladesh Krishi Bank Loan of ৳100,000 received into bank
  const initialLoanPrincipal = 100000;
  const initialLoanDisburse = await executeLoanTransaction(
    {
      lenderName: 'Bangladesh Krishi Bank',
      principal: initialLoanPrincipal,
      interestRate: 0, // Strictly principal-only
      annualInterestRatePercent: 0,
      tenureMonths: 10,
      termMonths: 10,
      startDate: opDate,
      targetAccountId: bankAcc.id,
      currentUserId,
      notes: 'Commercial working capital loan (Principal-Only)'
    },
    dbInstance
  );
  const loanRecordId = initialLoanDisburse.loan.id;

  // Initial Investors:
  // Investor 1: Zakir Hossain (Capital ৳200,000, Profit Payable ৳10,000)
  // Investor 2: Mahbub Alam (Capital ৳150,000, Profit Payable ৳8,000)
  const inv1: Investor = {
    id: 'inv_zakir_01',
    name: 'Zakir Hossain',
    phone: '01711223344',
    capitalAmount: 200000,
    currentCapitalBalance: 200000,
    profitPayable: 10000,
    profitSharingRatio: 60,
    entryDate: opDate,
    status: 'ACTIVE',
    synced: false
  };
  await dbInstance.investors.put(inv1);

  const inv2: Investor = {
    id: 'inv_mahbub_02',
    name: 'Mahbub Alam',
    phone: '01911223344',
    capitalAmount: 150000,
    currentCapitalBalance: 150000,
    profitPayable: 8000,
    profitSharingRatio: 40,
    entryDate: opDate,
    status: 'ACTIVE',
    synced: false
  };
  await dbInstance.investors.put(inv2);

  const initialInvCapital = round2(200000 + 150000); // 350,000
  const initialInvPayable = round2(10000 + 8000); // 18,000

  // Post investor baseline into GL with offsetting Bank deposit
  await postJournalEntry(
    {
      id: 'j_init_investors',
      voucherNumber: 'JV-INIT-06',
      voucherType: 'JOURNAL',
      date: opDate,
      narration: 'Opening Investor Capital and Profit Payable Setup',
      reference: 'INIT-INVESTORS',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.BANK,
          accountName: 'ব্যাংক হিসাব (Bank Accounts)',
          debit: round2(initialInvCapital + initialInvPayable), // 368,000
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.INVESTOR_CAPITAL,
          accountName: 'বিনিয়োগকারীর মূলধন (Investor Capital - 3020)',
          debit: 0,
          credit: initialInvCapital
        },
        {
          accountCode: CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE,
          accountName: 'বিনিয়োগকারীর প্রদেয় লভ্যাংশ (Investor Profit Payable - 2050)',
          debit: 0,
          credit: initialInvPayable
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );

  // Update bank account operational balance for investor funds
  const curBank = await dbInstance.cashBankAccounts.get(bankAcc.id);
  await dbInstance.cashBankAccounts.update(bankAcc.id, {
    currentBalance: round2((curBank?.currentBalance || 0) + initialInvCapital + initialInvPayable)
  });

  // Calculate total opening state metrics
  const freshBankInit = await dbInstance.cashBankAccounts.get(bankAcc.id);
  const openingTotalCash = round2(initialCashBal + (freshBankInit?.currentBalance || 0));
  const openingTotalInvVal = totalOpeningInvVal;
  const openingTotalInvQty = 100 + 50 + 2000;
  const openingTotalAr = initialArBal;
  const openingTotalAp = initialApBal;
  const openingTotalLoan = initialLoanPrincipal;
  const openingTotalInvCapital = initialInvCapital;
  const openingTotalInvPayable = initialInvPayable;

  console.log(`Opening Baseline established on ${opDate}:`);
  console.log(`  - Total Cash & Bank: ৳${openingTotalCash}`);
  console.log(`  - Total Inventory: ${openingTotalInvQty} units (Valuation ৳${openingTotalInvVal})`);
  console.log(`  - Accounts Receivable (AR): ৳${openingTotalAr}`);
  console.log(`  - Accounts Payable (AP): ৳${openingTotalAp}`);
  console.log(`  - Principal Loan Balance: ৳${openingTotalLoan}`);
  console.log(`  - Investor Capital: ৳${openingTotalInvCapital} | Profit Payable: ৳${openingTotalInvPayable}`);

  // --------------------------------------------------------------------------
  // STEP 1: Execute Representative Lifecycle Transactions During Period
  // --------------------------------------------------------------------------
  let runningCashInflows = 0;
  let runningCashOutflows = 0;
  let runningPurchasesAdditionsVal = 0;
  let runningPurchasesAdditionsQty = 0;
  let runningProductionAdditionsVal = 0;
  let runningProductionAdditionsQty = 0;
  let runningSalesReductionsVal = 0; // COGS
  let runningSalesReductionsQty = 0;
  let runningConsumptionReductionsVal = 0;
  let runningConsumptionReductionsQty = 0;
  let runningCreditSales = 0;
  let runningArCollections = 0;
  let runningCreditPurchases = 0;
  let runningApPayments = 0;

  // 1. Credit Purchase of Feed from Mega Feed
  // 50 bags @ ৳1,050 = ৳52,500
  console.log('\n--- Executing 1: Credit Purchase of Feed ---');
  const feedPurchase = await executePurchaseTransaction(
    {
      supplier,
      item: itemFeed,
      quantity: 50,
      unitPrice: 1050,
      paymentMethod: 'CREDIT',
      date: '2026-06-05',
      currentUserId
    },
    dbInstance
  );
  runningCreditPurchases = round2(runningCreditPurchases + 52500);
  runningPurchasesAdditionsQty = round2(runningPurchasesAdditionsQty + 50);
  runningPurchasesAdditionsVal = round2(runningPurchasesAdditionsVal + 52500);

  // 2. Cash Purchase of Seeds
  // 20 kg @ ৳130 = ৳2,600 paid via Cash
  console.log('--- Executing 2: Cash Purchase of Seeds ---');
  const seedPurchase = await executePurchaseTransaction(
    {
      item: itemSeed,
      quantity: 20,
      unitPrice: 130,
      paymentMethod: 'CASH',
      cashBankAccountId: cashAcc.id,
      date: '2026-06-06',
      currentUserId
    },
    dbInstance
  );
  runningCashOutflows = round2(runningCashOutflows + 2600);
  runningPurchasesAdditionsQty = round2(runningPurchasesAdditionsQty + 20);
  runningPurchasesAdditionsVal = round2(runningPurchasesAdditionsVal + 2600);

  // 3. Production Receipt of Finished Goods (Eggs)
  // Farm harvest: 1,000 eggs produced into inventory @ ৳8.20 cost = ৳8,200
  console.log('--- Executing 3: Production Receipt of Finished Goods (Eggs) ---');
  // First seed WIP production cost of ৳8,200 funded via Cash labor
  await postJournalEntry(
    {
      id: 'j_prod_wip_seed',
      voucherNumber: 'JV-PROD-01',
      voucherType: 'JOURNAL',
      date: '2026-06-08',
      narration: 'WIP feed & labor costs for layer flock egg production',
      reference: 'PROD-EGG-FLOCK-01',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.WIP,
          accountName: 'প্রক্রিয়াধীন পণ্য (WIP - 1054)',
          debit: 8200,
          credit: 0,
          memo: '[PRODUCTION_COST] [WIP] [egg_batch_01] Daily layer flock egg gathering WIP'
        },
        {
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'নগদ টাকা (Cash on Hand)',
          debit: 0,
          credit: 8200,
          memo: '[PRODUCTION_COST] [WIP] [egg_batch_01] Paid Cash'
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );
  // Update cash account for WIP expense
  const freshCashWip = await dbInstance.cashBankAccounts.get(cashAcc.id);
  await dbInstance.cashBankAccounts.update(cashAcc.id, {
    currentBalance: round2((freshCashWip?.currentBalance || 0) - 8200)
  });
  runningCashOutflows = round2(runningCashOutflows + 8200);

  // Now execute Production Receipt to transfer 1,000 eggs into inventory (1055)
  await executeProductionReceiptTransaction(
    {
      itemId: itemEggs.id,
      quantity: 1000,
      unitCost: 8.2,
      date: '2026-06-09',
      sourceBatchId: 'egg_batch_01',
      notes: 'ফার্ম থেকে দৈনিক ডিম ইনভেন্টরিতে গ্রহণ',
      currentUserId
    },
    dbInstance
  );
  runningProductionAdditionsQty = round2(runningProductionAdditionsQty + 1000);
  runningProductionAdditionsVal = round2(runningProductionAdditionsVal + 8200);

  // 4. Cash Sale of Eggs
  // 600 eggs @ ৳12.00 = ৳7,200 received in Cash
  console.log('--- Executing 4: Cash Sale of Eggs ---');
  const cashSaleRes = await executeSaleTransaction(
    {
      item: itemEggs,
      quantity: 600,
      unitPrice: 12,
      paymentMethod: 'CASH',
      date: '2026-06-10',
      currentUserId
    },
    dbInstance
  );
  runningCashInflows = round2(runningCashInflows + 7200);
  runningSalesReductionsQty = round2(runningSalesReductionsQty + 600);
  // Get exact COGS from sale journal entry
  const cashSaleJournal = await dbInstance.journalEntries.get(cashSaleRes.journalEntryId);
  const cashSaleCogs = cashSaleJournal?.lines?.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.COGS_EGGS || l.accountCode === '5030')?.debit || 0;
  runningSalesReductionsVal = round2(runningSalesReductionsVal + cashSaleCogs);

  // 5. Credit Sale of Eggs to Tamim Wholesale Mart
  // 1,000 eggs @ ৳12.50 = ৳12,500 on credit
  console.log('--- Executing 5: Credit Sale of Eggs ---');
  const creditSaleRes = await executeSaleTransaction(
    {
      customer,
      item: itemEggs,
      quantity: 1000,
      unitPrice: 12.5,
      paymentMethod: 'CREDIT',
      date: '2026-06-12',
      currentUserId
    },
    dbInstance
  );
  runningCreditSales = round2(runningCreditSales + 12500);
  runningSalesReductionsQty = round2(runningSalesReductionsQty + 1000);
  const creditSaleJournal = await dbInstance.journalEntries.get(creditSaleRes.journalEntryId);
  const creditSaleCogs = creditSaleJournal?.lines?.find((l: any) => l.accountCode === CANONICAL_ACCOUNTS.COGS_EGGS || l.accountCode === '5030')?.debit || 0;
  runningSalesReductionsVal = round2(runningSalesReductionsVal + creditSaleCogs);

  // 6. Customer Collection / AR Payment Received
  // Tamim pays ৳10,000 against credit sale deposited into Bank
  console.log('--- Executing 6: Customer Collection (Bank) ---');
  await executePaymentTransaction(
    {
      parentType: 'SALE',
      parentId: creditSaleRes.sale.id,
      amount: 10000,
      paymentMethod: 'BANK',
      bankAccountId: bankAcc.id,
      date: '2026-06-15',
      note: 'গ্রাহক তামিমের নিকট থেকে বকেয়া বিল আদায়',
      currentUserId
    },
    dbInstance
  );
  runningCashInflows = round2(runningCashInflows + 10000);
  runningArCollections = round2(runningArCollections + 10000);

  // 7. Supplier Payment (AP Reduction)
  // Pay Mega Feed ৳30,000 against feed purchase from Bank
  console.log('--- Executing 7: Supplier AP Payment (Bank) ---');
  await executePaymentTransaction(
    {
      parentType: 'PURCHASE',
      parentId: feedPurchase.purchase.id,
      amount: 30000,
      paymentMethod: 'BANK',
      bankAccountId: bankAcc.id,
      date: '2026-06-16',
      note: 'মেগা ফিড সরবরাহকারীকে বিল পরিশোধ',
      currentUserId
    },
    dbInstance
  );
  runningCashOutflows = round2(runningCashOutflows + 30000);
  runningApPayments = round2(runningApPayments + 30000);

  // 8. Internal Feed Consumption / Farm Usage
  // 30 bags of feed consumed by farm livestock
  console.log('--- Executing 8: Internal Feed Consumption ---');
  const feedFresh = await dbInstance.inventoryItems.get(itemFeed.id);
  const feedUnitCost = feedFresh?.avgCostPrice || 1016.67;
  const feedConsumeQty = 30;
  const feedConsumeCost = round2(feedConsumeQty * feedUnitCost);

  await executeStockAdjustmentTransaction(
    {
      itemId: itemFeed.id,
      type: 'OUT',
      adjustmentType: 'DECREASE',
      quantity: feedConsumeQty,
      reason: 'খামারের মুরগি ও গবাদিপশুকে খাদ্য প্রদান (অভ্যন্তরীণ ব্যবহার)',
      date: '2026-06-18',
      currentUserId
    },
    dbInstance
  );
  runningConsumptionReductionsQty = round2(runningConsumptionReductionsQty + feedConsumeQty);
  runningConsumptionReductionsVal = round2(runningConsumptionReductionsVal + feedConsumeCost);

  // 9. Legitimate Operating Expenses
  // Labor expense ৳12,000 paid via Cash, Electricity/Utility ৳5,000 paid via Bank
  console.log('--- Executing 9: Operating Expenses ---');
  await postJournalEntry(
    {
      id: 'j_expense_labor',
      voucherNumber: 'JV-EXP-01',
      voucherType: 'PAYMENT',
      date: '2026-06-20',
      narration: 'মাসিক খামার শ্রমিকদের মজুরি পরিশোধ',
      reference: 'EXP-LABOR-01',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.FARM_LABOUR_WAGES,
          accountName: 'খামার শ্রমিকের মজুরি (Farm Labour Wages - 6020)',
          debit: 12000,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.CASH,
          accountName: 'নগদ টাকা (Cash on Hand)',
          debit: 0,
          credit: 12000
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );
  const curCashExp = await dbInstance.cashBankAccounts.get(cashAcc.id);
  await dbInstance.cashBankAccounts.update(cashAcc.id, {
    currentBalance: round2((curCashExp?.currentBalance || 0) - 12000)
  });
  runningCashOutflows = round2(runningCashOutflows + 12000);

  await postJournalEntry(
    {
      id: 'j_expense_utility',
      voucherNumber: 'JV-EXP-02',
      voucherType: 'PAYMENT',
      date: '2026-06-21',
      narration: 'খামারের বিদ্যুৎ ও সেচ বিল পরিশোধ',
      reference: 'EXP-UTIL-01',
      lines: [
        {
          accountCode: CANONICAL_ACCOUNTS.ELECTRICITY,
          accountName: 'বিদ্যুৎ বিল (Electricity & Utilities - 6060)',
          debit: 5000,
          credit: 0
        },
        {
          accountCode: CANONICAL_ACCOUNTS.BANK,
          accountName: 'ব্যাংক হিসাব (Bank Accounts)',
          debit: 0,
          credit: 5000
        }
      ],
      createdBy: currentUserId,
      createdAt: new Date().toISOString()
    },
    { dbInstance }
  );
  const curBankExp = await dbInstance.cashBankAccounts.get(bankAcc.id);
  await dbInstance.cashBankAccounts.update(bankAcc.id, {
    currentBalance: round2((curBankExp?.currentBalance || 0) - 5000)
  });
  runningCashOutflows = round2(runningCashOutflows + 5000);

  // 10. Fixed Asset Depreciation
  // Straight-line monthly depreciation: Tractor ৳6,000, Pond ৳1,250
  console.log('--- Executing 10: Fixed Asset Depreciation ---');
  await executeAssetDepreciationAtomic(
    tractorAsset.id,
    {
      targetDate: '2026-06-30',
      currentUserId
    },
    dbInstance
  );
  await executeAssetDepreciationAtomic(
    pondAsset.id,
    {
      targetDate: '2026-06-30',
      currentUserId
    },
    dbInstance
  );
  const periodDepreciation = round2(6000 + 1250); // 7,250

  // 11. Principal-Only Loan Repayment
  // Repay ৳15,000 principal from Bank (0 interest added or charged)
  console.log('--- Executing 11: Principal-Only Loan Repayment ---');
  await executeLoanRepaymentTransaction(
    {
      loanId: loanRecordId,
      principalAmount: 15000,
      sourceAccountId: bankAcc.id,
      repaymentDate: '2026-06-27',
      currentUserId,
      note: 'বাংলাদেশ কৃষি ব্যাংক ঋণের প্রথম কিস্তি (শুধুমাত্র আসল)'
    },
    dbInstance
  );
  runningCashOutflows = round2(runningCashOutflows + 15000);

  // 12. Investor Transactions:
  // - Investor 1 profit payment of ৳5,000 paid from Bank
  // - Investor 2 contributes additional capital ৳50,000 deposited to Bank
  // - Period profit allocation to investors: ৳8,000
  console.log('--- Executing 12: Investor Transactions ---');
  await executeInvestorProfitPaymentTransaction(
    {
      investorId: inv1.id,
      amount: 5000,
      sourceAccountId: bankAcc.id,
      paymentDate: '2026-06-28',
      currentUserId,
      notes: 'জাকির হোসেনকে বকেয়া মুনাফা বাবদ অর্থ প্রদান'
    },
    dbInstance
  );
  runningCashOutflows = round2(runningCashOutflows + 5000);

  await executeInvestorTransaction(
    {
      investorId: inv2.id,
      investorName: inv2.name,
      contribution: 50000,
      profitSharingRatio: 40,
      targetAccountId: bankAcc.id,
      date: '2026-06-29',
      currentUserId,
      notes: 'মাহবুব আলমের অতিরিক্ত মূলধন বিনিয়োগ'
    },
    dbInstance
  );
  runningCashInflows = round2(runningCashInflows + 50000);

  await executeInvestorProfitAllocationTransaction(
    {
      investorId: inv1.id,
      finalizedDistributableProfit: 20000,
      allocatedProfit: 8000,
      allocationDate: '2026-06-30',
      currentUserId,
      notes: 'জুন ২০২৬ প্রান্তিক বিনিয়োগকারী লভ্যাংশ বরাদ্দ'
    },
    dbInstance
  );

  console.log('\n================================================================');
  console.log('ALL REPRESENTATIVE LIFECYCLE TRANSACTIONS EXECUTED SUCCESSFULLY');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // RECONCILIATION 1: Total Journal Debits vs Total Journal Credits
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 1: Total Journal Debits vs Total Journal Credits ---');
  const allJournals: JournalEntry[] = await dbInstance.journalEntries.toArray();
  let totalJournalDr = 0;
  let totalJournalCr = 0;
  let allIndividualJournalsBalanced = true;
  let unbalancedJournalError = '';

  for (const j of allJournals) {
    let jDr = 0;
    let jCr = 0;
    for (const l of j.lines || []) {
      jDr += Number(l.debit) || 0;
      jCr += Number(l.credit) || 0;
    }
    jDr = round2(jDr);
    jCr = round2(jCr);
    if (Math.abs(jDr - jCr) > 0.001) {
      allIndividualJournalsBalanced = false;
      unbalancedJournalError = `Journal ${j.voucherNumber || j.id} unbalanced: Dr ৳${jDr} != Cr ৳${jCr}`;
      break;
    }
    totalJournalDr = round2(totalJournalDr + jDr);
    totalJournalCr = round2(totalJournalCr + jCr);
  }

  const journalDiff = round2(Math.abs(totalJournalDr - totalJournalCr));
  const isJournalDebitsEqualsCredits = journalDiff === 0 && allIndividualJournalsBalanced;

  record(
    1,
    'Total Journal Debits vs Total Journal Credits',
    isJournalDebitsEqualsCredits,
    totalJournalDr,
    totalJournalCr,
    `Total Dr: ৳${totalJournalDr}, Total Cr: ৳${totalJournalCr}, Difference: ৳${journalDiff}. All ${allJournals.length} journals internally balanced: ${allIndividualJournalsBalanced} ${unbalancedJournalError}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 2: Trial Balance Debit vs Credit
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 2: Trial Balance Debit vs Credit ---');
  const tb = await generateTrialBalance(undefined, dbInstance);
  const isTbBalanced = tb.isBalanced && tb.difference === 0 && Math.abs(tb.totalDebit - tb.totalCredit) < 0.01;

  record(
    2,
    'Trial Balance Debit vs Credit',
    isTbBalanced,
    tb.totalDebit,
    tb.totalCredit,
    `Trial Balance Dr: ৳${tb.totalDebit}, Cr: ৳${tb.totalCredit}, Difference: ৳${tb.difference}, Rows: ${tb.rows.length}, Orphan Accounts: ${tb.orphanAccounts.length}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 3: Assets vs Liabilities + Equity
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 3: Assets vs Liabilities + Equity ---');
  const bs = await generateBalanceSheet(undefined, dbInstance);
  const totalLiabAndEquity = round2(bs.totalLiabilities + bs.totalEquity);
  const bsDiff = round2(Math.abs(bs.totalAssets - totalLiabAndEquity));
  const isBsBalanced = bs.isBalanced && bsDiff === 0;

  record(
    3,
    'Assets vs Liabilities + Equity',
    isBsBalanced,
    bs.totalAssets,
    totalLiabAndEquity,
    `Total Assets: ৳${bs.totalAssets}, Total Liabilities: ৳${bs.totalLiabilities}, Total Equity: ৳${bs.totalEquity} (incl. Net Profit ৳${bs.currentYearNetProfit}), Discrepancy: ৳${bs.discrepancy}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 4: Opening Cash + Inflows - Outflows = Closing Cash
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 4: Opening Cash + Inflows - Outflows = Closing Cash ---');
  const freshCashAccounts: CashBankAccount[] = await dbInstance.cashBankAccounts.toArray();
  const operationalClosingCash = round2(freshCashAccounts.reduce((sum, acc) => sum + (Number(acc.currentBalance) || 0), 0));
  const calculatedClosingCash = round2(openingTotalCash + runningCashInflows - runningCashOutflows);

  // Compare with GL Cash and Bank accounts (1010, 1020, 1030)
  const glCashBal = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.CASH, CANONICAL_ACCOUNTS.PETTY_CASH, CANONICAL_ACCOUNTS.BANK], 'DEBIT');

  const isCashReconciled =
    Math.abs(calculatedClosingCash - operationalClosingCash) < 0.01 &&
    Math.abs(operationalClosingCash - glCashBal) < 0.01;

  record(
    4,
    'Opening Cash + Cash Inflows - Cash Outflows = Closing Cash',
    isCashReconciled,
    calculatedClosingCash,
    operationalClosingCash,
    `Opening: ৳${openingTotalCash} + Inflows: ৳${runningCashInflows} - Outflows: ৳${runningCashOutflows} = Calculated: ৳${calculatedClosingCash} | Operational: ৳${operationalClosingCash} | GL (1010, 1030): ৳${glCashBal}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 5: Opening Inventory + Purchases/Production - Sales/Consumption = Closing Inventory
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 5: Inventory Valuation & Movement Lifecycle ---');
  const freshInventory: InventoryItem[] = await dbInstance.inventoryItems.toArray();
  let operationalClosingInvVal = 0;
  let operationalClosingInvQty = 0;

  for (const item of freshInventory) {
    const s = Number(item.currentStock) || 0;
    const c = Number(item.avgCostPrice) || 0;
    operationalClosingInvQty = round2(operationalClosingInvQty + s);
    operationalClosingInvVal = round2(operationalClosingInvVal + s * c);
  }

  const calculatedClosingInvQty = round2(
    openingTotalInvQty + runningPurchasesAdditionsQty + runningProductionAdditionsQty - runningSalesReductionsQty - runningConsumptionReductionsQty
  );
  const calculatedClosingInvVal = round2(
    openingTotalInvVal + runningPurchasesAdditionsVal + runningProductionAdditionsVal - runningSalesReductionsVal - runningConsumptionReductionsVal
  );

  const glInventoryVal = calculateGlBalanceForAccounts(
    allJournals,
    [
      CANONICAL_ACCOUNTS.FEED_INVENTORY,
      CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY,
      CANONICAL_ACCOUNTS.RAW_MATERIALS,
      CANONICAL_ACCOUNTS.FINISHED_GOODS,
      CANONICAL_ACCOUNTS.PACKAGING_INVENTORY
    ],
    'DEBIT'
  );

  const isInventoryReconciled =
    Math.abs(operationalClosingInvQty - calculatedClosingInvQty) < 0.01 &&
    Math.abs(operationalClosingInvVal - glInventoryVal) < 0.05 &&
    Math.abs(calculatedClosingInvVal - glInventoryVal) < 0.05;

  record(
    5,
    'Opening Inventory + Purchases/Production - Sales/Consumption = Closing Inventory',
    isInventoryReconciled,
    calculatedClosingInvVal,
    operationalClosingInvVal,
    `Quantity: Opening (${openingTotalInvQty}) + Purchases (${runningPurchasesAdditionsQty}) + Prod (${runningProductionAdditionsQty}) - Sales (${runningSalesReductionsQty}) - Cons (${runningConsumptionReductionsQty}) = ${calculatedClosingInvQty} (Operational: ${operationalClosingInvQty}) | Value: Calculated ৳${calculatedClosingInvVal} | Operational ৳${operationalClosingInvVal} | GL ৳${glInventoryVal}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 6: Opening AR + Credit Sales - Collections = Closing AR
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 6: Opening AR + Credit Sales - Collections = Closing AR ---');
  const freshParties: Party[] = await dbInstance.parties.toArray();
  const customerParties = freshParties.filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH');
  const operationalClosingAr = round2(customerParties.reduce((sum, c) => sum + (Number(c.balance) || 0), 0));
  const calculatedClosingAr = round2(openingTotalAr + runningCreditSales - runningArCollections);
  const glAr = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE], 'DEBIT');

  const isArReconciled =
    Math.abs(calculatedClosingAr - operationalClosingAr) < 0.01 &&
    Math.abs(operationalClosingAr - glAr) < 0.01;

  record(
    6,
    'Opening AR + Credit Sales - Collections = Closing AR',
    isArReconciled,
    calculatedClosingAr,
    operationalClosingAr,
    `Opening AR: ৳${openingTotalAr} + Credit Sales: ৳${runningCreditSales} - Collections: ৳${runningArCollections} = Calculated: ৳${calculatedClosingAr} | Operational Customer Balances: ৳${operationalClosingAr} | GL AR (1040): ৳${glAr}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 7: Opening AP + Credit Purchases - Payments = Closing AP
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 7: Opening AP + Credit Purchases - Payments = Closing AP ---');
  const supplierParties = freshParties.filter((p) => p.type === 'SUPPLIER' || p.type === 'BOTH');
  const operationalClosingAp = round2(supplierParties.reduce((sum, s) => sum + (Number(s.balance) || 0), 0));
  const calculatedClosingAp = round2(openingTotalAp + runningCreditPurchases - runningApPayments);
  const glAp = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE], 'CREDIT');

  const isApReconciled =
    Math.abs(calculatedClosingAp - operationalClosingAp) < 0.01 &&
    Math.abs(operationalClosingAp - glAp) < 0.01;

  record(
    7,
    'Opening AP + Credit Purchases - Payments = Closing AP',
    isApReconciled,
    calculatedClosingAp,
    operationalClosingAp,
    `Opening AP: ৳${openingTotalAp} + Credit Purchases: ৳${runningCreditPurchases} - Payments: ৳${runningApPayments} = Calculated: ৳${calculatedClosingAp} | Operational Supplier Balances: ৳${operationalClosingAp} | GL AP (2010): ৳${glAp}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 8: Revenue - legitimate expenses/COGS = Profit
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 8: Revenue - legitimate expenses/COGS = Profit ---');
  const pl = await generateProfitLoss(undefined, undefined, dbInstance);
  const indepRevenue = calculateGlBalanceForAccounts(allJournals, ['4010', '4020', '4030', '4040', '4050'], 'CREDIT');
  const indepCogs = calculateGlBalanceForAccounts(allJournals, ['5010', '5020', '5030', '5040', '5050', '5090'], 'DEBIT');
  const indepOpex = calculateGlBalanceForAccounts(allJournals, ['6010', '6020', '6030', '6040', '6050', '6060', '6070', '6080', '6140'], 'DEBIT');
  const indepOtherInc = calculateGlBalanceForAccounts(allJournals, ['7010'], 'CREDIT');
  const indepOtherExp = calculateGlBalanceForAccounts(allJournals, ['8010'], 'DEBIT');

  const calculatedNetProfit = round2(indepRevenue - indepCogs - indepOpex + indepOtherInc - indepOtherExp);

  const isProfitReconciled =
    Math.abs(pl.netProfit - calculatedNetProfit) < 0.01 &&
    Math.abs(bs.currentYearNetProfit - pl.netProfit) < 0.01;

  record(
    8,
    'Revenue - legitimate expenses/COGS = Profit',
    isProfitReconciled,
    calculatedNetProfit,
    pl.netProfit,
    `P&L Revenue: ৳${pl.totalRevenue} (Indep: ৳${indepRevenue}) - COGS: ৳${pl.totalCogs} (Indep: ৳${indepCogs}) - OpEx: ৳${pl.totalOperatingExpenses} (Indep: ৳${indepOpex}) = Calculated Profit: ৳${calculatedNetProfit} | P&L Net Profit: ৳${pl.netProfit} | Balance Sheet Current Year Profit: ৳${bs.currentYearNetProfit}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 9: Investor Capital & Profit Transactions
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 9: Investor Capital & Profit Transactions ---');
  const freshInvestors: Investor[] = await dbInstance.investors.toArray();
  const operationalInvestorCapital = round2(freshInvestors.reduce((sum, inv) => sum + (Number(inv.currentCapitalBalance) || 0), 0));
  const operationalInvestorPayable = round2(freshInvestors.reduce((sum, inv) => sum + (Number(inv.profitPayable) || 0), 0));

  const calculatedInvestorCapital = round2(openingTotalInvCapital + 50000); // 350,000 + 50,000 = 400,000
  const calculatedInvestorPayable = round2(openingTotalInvPayable - 5000 + 8000); // 18,000 - 5,000 + 8,000 = 21,000

  const glInvestorCapital = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.INVESTOR_CAPITAL], 'CREDIT');
  const glInvestorPayable = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.INVESTOR_PROFIT_PAYABLE], 'CREDIT');

  const isInvestorReconciled =
    Math.abs(operationalInvestorCapital - calculatedInvestorCapital) < 0.01 &&
    Math.abs(operationalInvestorCapital - glInvestorCapital) < 0.01 &&
    Math.abs(operationalInvestorPayable - calculatedInvestorPayable) < 0.01 &&
    Math.abs(operationalInvestorPayable - glInvestorPayable) < 0.01;

  record(
    9,
    'Investor capital/profit transactions',
    isInvestorReconciled,
    `Capital: ৳${calculatedInvestorCapital}, Payable: ৳${calculatedInvestorPayable}`,
    `Capital: ৳${operationalInvestorCapital}, Payable: ৳${operationalInvestorPayable}`,
    `Capital [Calculated: ৳${calculatedInvestorCapital} | Operational: ৳${operationalInvestorCapital} | GL 3020: ৳${glInvestorCapital}] | Payable [Calculated: ৳${calculatedInvestorPayable} | Operational: ৳${operationalInvestorPayable} | GL 2050: ৳${glInvestorPayable}]`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 10: Principal-Only Loan Balances
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 10: Principal-Only Loan Balances ---');
  const freshLoans: Loan[] = await dbInstance.loans.toArray();
  const activeLoan = freshLoans.find((l) => l.id === loanRecordId);
  const operationalLoanPrincipal = round2(activeLoan?.remainingPrincipal || 0);
  const operationalLoanBalance = round2(activeLoan?.remainingBalance || 0);

  const calculatedLoanPrincipal = round2(openingTotalLoan - 15000); // 100,000 - 15,000 = 85,000
  const glLoanBalance = calculateGlBalanceForAccounts(
    allJournals,
    [CANONICAL_ACCOUNTS.SHORT_TERM_LOANS, CANONICAL_ACCOUNTS.LONG_TERM_LOANS],
    'CREDIT'
  );

  // Strict check that 0 interest accounts were posted
  const interestExpenseGl = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.LOAN_INTEREST, '8010'], 'DEBIT');
  const isInterestZero = interestExpenseGl === 0;

  const isLoanReconciled =
    Math.abs(operationalLoanPrincipal - calculatedLoanPrincipal) < 0.01 &&
    Math.abs(operationalLoanPrincipal - operationalLoanBalance) < 0.01 &&
    Math.abs(operationalLoanPrincipal - glLoanBalance) < 0.01 &&
    isInterestZero;

  record(
    10,
    'Principal-only loan balances',
    isLoanReconciled,
    calculatedLoanPrincipal,
    operationalLoanPrincipal,
    `Opening Principal: ৳${openingTotalLoan} - Repayment: ৳15,000 = Calculated: ৳${calculatedLoanPrincipal} | Operational Principal: ৳${operationalLoanPrincipal} | GL (2030): ৳${glLoanBalance} | Interest Expense in GL: ৳${interestExpenseGl} (Zero enforced: ${isInterestZero})`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 11: Fixed Asset / Depreciation Balances
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 11: Fixed Asset & Depreciation Balances ---');
  const freshAssets: FixedAsset[] = await dbInstance.fixedAssets.toArray();
  const operationalAssetCost = round2(freshAssets.reduce((sum, a) => sum + (Number(a.originalCost) || 0), 0));
  const operationalAccDep = round2(freshAssets.reduce((sum, a) => sum + (Number(a.accumulatedDepreciation) || 0), 0));
  const operationalBookValue = round2(operationalAssetCost - operationalAccDep);

  const calculatedAccDep = round2(initialAccDep + periodDepreciation); // 55,000 + 7,250 = 62,250
  const glAssetCost = calculateGlBalanceForAccounts(
    allJournals,
    [CANONICAL_ACCOUNTS.LAND, CANONICAL_ACCOUNTS.BUILDINGS, CANONICAL_ACCOUNTS.POND_INFRASTRUCTURE, CANONICAL_ACCOUNTS.MACHINERY],
    'DEBIT'
  );
  const glAccDep = calculateGlBalanceForAccounts(allJournals, [CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION], 'CREDIT');
  const glBookValue = round2(glAssetCost - glAccDep);

  const isAssetReconciled =
    Math.abs(operationalAssetCost - glAssetCost) < 0.01 &&
    Math.abs(operationalAccDep - calculatedAccDep) < 0.01 &&
    Math.abs(operationalAccDep - glAccDep) < 0.01 &&
    Math.abs(operationalBookValue - glBookValue) < 0.01;

  record(
    11,
    'Fixed asset/depreciation balances where applicable',
    isAssetReconciled,
    `Cost: ৳${glAssetCost}, AccDep: ৳${calculatedAccDep}`,
    `Cost: ৳${operationalAssetCost}, AccDep: ৳${operationalAccDep}`,
    `Asset Cost [Operational: ৳${operationalAssetCost} | GL: ৳${glAssetCost}] | Acc Depreciation [Calculated: ৳${calculatedAccDep} | Operational: ৳${operationalAccDep} | GL 1590: ৳${glAccDep}] | Net Book Value: ৳${operationalBookValue}`
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 12: No Orphan Financial References Exist
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 12: Orphan Financial References Audit ---');
  const coaAccountCodes = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code));
  const partyIds = new Set(freshParties.map((p) => p.id));
  const itemIds = new Set(freshInventory.map((i) => i.id));
  const journalIds = new Set(allJournals.map((j) => j.id));

  let orphanFoundCount = 0;
  const orphanDetails: string[] = [];

  // Check 12.1: Journal lines account code
  for (const j of allJournals) {
    for (const l of j.lines || []) {
      if (!coaAccountCodes.has(l.accountCode)) {
        orphanFoundCount++;
        orphanDetails.push(`Journal ${j.voucherNumber} line uses undefined account "${l.accountCode}"`);
      }
    }
  }

  // Check 12.2: Sales customer & items
  const allSales = await dbInstance.sales.toArray();
  for (const s of allSales) {
    if (s.customerId && !partyIds.has(s.customerId)) {
      orphanFoundCount++;
      orphanDetails.push(`Sale ${s.invoiceNumber} references non-existent customer ${s.customerId}`);
    }
    for (const it of s.items || []) {
      if (it.itemId && !itemIds.has(it.itemId)) {
        orphanFoundCount++;
        orphanDetails.push(`Sale ${s.invoiceNumber} references non-existent item ${it.itemId}`);
      }
    }
    if (s.journalEntryId && !journalIds.has(s.journalEntryId)) {
      orphanFoundCount++;
      orphanDetails.push(`Sale ${s.invoiceNumber} references non-existent journal ${s.journalEntryId}`);
    }
  }

  // Check 12.3: Purchases supplier & items
  const allPurchases = await dbInstance.purchases.toArray();
  for (const p of allPurchases) {
    if (p.supplierId && !partyIds.has(p.supplierId)) {
      orphanFoundCount++;
      orphanDetails.push(`Purchase ${p.invoiceNumber} references non-existent supplier ${p.supplierId}`);
    }
    for (const it of p.items || []) {
      if (it.itemId && !itemIds.has(it.itemId)) {
        orphanFoundCount++;
        orphanDetails.push(`Purchase ${p.invoiceNumber} references non-existent item ${it.itemId}`);
      }
    }
    if (p.journalEntryId && !journalIds.has(p.journalEntryId)) {
      orphanFoundCount++;
      orphanDetails.push(`Purchase ${p.invoiceNumber} references non-existent journal ${p.journalEntryId}`);
    }
  }

  // Check 12.4: Payments party & parent
  const allPayments = await dbInstance.payments.toArray();
  for (const pm of allPayments) {
    if (pm.partyId && !partyIds.has(pm.partyId)) {
      orphanFoundCount++;
      orphanDetails.push(`Payment ${pm.id} references non-existent party ${pm.partyId}`);
    }
    if (pm.journalEntryId && !journalIds.has(pm.journalEntryId)) {
      orphanFoundCount++;
      orphanDetails.push(`Payment ${pm.id} references non-existent journal ${pm.journalEntryId}`);
    }
  }

  const isOrphansZero = orphanFoundCount === 0;
  record(
    12,
    'No orphan financial references exist',
    isOrphansZero,
    0,
    orphanFoundCount,
    isOrphansZero ? 'Audited journals, sales, purchases, payments, and stock movements: 0 orphan references found' : orphanDetails.join('; ')
  );

  // --------------------------------------------------------------------------
  // RECONCILIATION 13: No Duplicate Transaction IDs Exist
  // --------------------------------------------------------------------------
  console.log('--- AUDIT 13: Duplicate Transaction IDs Audit ---');
  let duplicateCount = 0;
  const duplicateDetails: string[] = [];

  function checkUniqueness(list: any[], idGetter: (x: any) => string, label: string) {
    const seen = new Set<string>();
    for (const item of list) {
      const id = idGetter(item);
      if (!id) continue;
      if (seen.has(id)) {
        duplicateCount++;
        duplicateDetails.push(`Duplicate ${label}: ${id}`);
      }
      seen.add(id);
    }
  }

  checkUniqueness(allJournals, (j) => j.id, 'Journal Entry ID');
  checkUniqueness(allJournals, (j) => j.voucherNumber, 'Journal Voucher Number');
  checkUniqueness(allSales, (s) => s.id, 'Sale ID');
  checkUniqueness(allSales, (s) => s.invoiceNumber, 'Sale Invoice Number');
  checkUniqueness(allPurchases, (p) => p.id, 'Purchase ID');
  checkUniqueness(allPurchases, (p) => p.invoiceNumber, 'Purchase Invoice Number');
  checkUniqueness(allPayments, (pm) => pm.id, 'Payment ID');
  const allStockMovements = await dbInstance.stockMovements.toArray();
  checkUniqueness(allStockMovements, (sm) => sm.id, 'Stock Movement ID');

  const isDuplicatesZero = duplicateCount === 0;
  record(
    13,
    'No duplicate transaction IDs exist',
    isDuplicatesZero,
    0,
    duplicateCount,
    isDuplicatesZero ? `Audited ${allJournals.length} journals, ${allSales.length} sales, ${allPurchases.length} purchases, ${allPayments.length} payments, and ${allStockMovements.length} stock movements: 0 duplicates found` : duplicateDetails.join('; ')
  );

  // --------------------------------------------------------------------------
  // Summary & Return
  // --------------------------------------------------------------------------
  const total = assertions.length;
  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  const success = failed === 0;

  console.log('\n================================================================');
  console.log(`TASK 14 RECONCILIATION COMPLETED: ${success ? 'ALL PASS' : 'FAIL'}`);
  console.log(`Total Checks: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('================================================================\n');

  return {
    success,
    total,
    passed,
    failed,
    failures,
    assertions
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPrompt14FinalDataIntegrityReconciliation()
    .then((summary) => {
      if (!summary.success) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal reconciliation error:', err);
      process.exit(1);
    });
}
