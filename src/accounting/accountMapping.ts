/**
 * Canonical Account Mapping Layer for Agro ERP
 * Source of truth: Chart of Accounts
 */

export const CANONICAL_ACCOUNTS = {
  // 1000 Assets
  CASH: '1010',
  PETTY_CASH: '1020',
  BANK: '1030',
  ACCOUNTS_RECEIVABLE: '1040',
  FEED_INVENTORY: '1051',
  SEED_FERT_INVENTORY: '1052',
  RAW_MATERIALS: '1053',
  WIP: '1054',
  FINISHED_GOODS: '1055',
  PACKAGING_INVENTORY: '1056',
  PREPAID_EXPENSES: '1060',
  LAND: '1510',
  BUILDINGS: '1520',
  POND_INFRASTRUCTURE: '1530',
  MACHINERY: '1550',
  ACCUMULATED_DEPRECIATION: '1590', // Contra-Asset (CREDIT normal balance)

  // 2000 Liabilities
  ACCOUNTS_PAYABLE: '2010',
  ACCRUED_WAGES: '2020',
  TAX_VAT_PAYABLE: '2030',
  CUSTOMER_ADVANCES: '2040',
  SHORT_TERM_LOANS: '2110',
  LONG_TERM_LOANS: '2120',

  // 3000 Equity
  OWNER_CAPITAL: '3010',
  INVESTOR_CAPITAL: '3020',
  OWNER_DRAWINGS: '3040', // Contra-Equity (DEBIT normal balance)
  RETAINED_EARNINGS: '3050',

  // 4000 Revenue
  FISH_REVENUE: '4010',
  LIVESTOCK_REVENUE: '4020',
  MILK_REVENUE: '4030',
  CROP_REVENUE: '4040',
  FODDER_REVENUE: '4050',
  PROCESSED_REVENUE: '4060',
  OTHER_REVENUE: '4090',

  // 5000 Cost of Goods Sold (COGS)
  FISH_COGS: '5010',
  LIVESTOCK_COGS: '5020',
  CROP_COGS: '5030',
  PROCESSED_COGS: '5040',

  // 6000 Operating Expenses
  FEED_EXPENSE: '6010',
  FARM_LABOUR_WAGES: '6020',
  STAFF_SALARY: '6030',
  VET_MEDICINE: '6040',
  VACCINATION: '6050',
  ELECTRICITY: '6060',
  IRRIGATION: '6070',
  FUEL_TRANSPORT: '6080',
  REPAIR_MAINTENANCE: '6090',
  PACKAGING_EXPENSE: '6100',
  LAND_POND_RENT: '6110',
  BANK_CHARGES: '6130',
  DEPRECIATION_EXPENSE: '6140',
  MISCELLANEOUS_EXPENSE: '6150',

  // 7000 Other Income
  GOVERNMENT_SUBSIDY: '7010',

  // 8000 Other Expense
  LOAN_INTEREST: '8010'
} as const;

/**
 * Ensures code 1050 is NEVER used.
 */
export function assertValidInventoryAccount(code: string): string {
  if (code === '1050') {
    throw new Error('ILLEGAL ACCOUNT POSTING: Account 1050 does not exist. Use 1051 (Feed), 1052 (Seed/Fert), 1053 (Raw Material), or 1055 (Finished Goods).');
  }
  return code;
}

/**
 * Maps payment method to Cash / Bank / Receivable / Payable account
 */
export function getPaymentAccount(
  method: 'CASH' | 'BANK' | 'CREDIT',
  type: 'SALE' | 'PURCHASE'
): string {
  if (type === 'SALE') {
    switch (method) {
      case 'CASH':
        return CANONICAL_ACCOUNTS.CASH; // 1010
      case 'BANK':
        return CANONICAL_ACCOUNTS.BANK; // 1030
      case 'CREDIT':
        return CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE; // 1040 AR
    }
  } else {
    switch (method) {
      case 'CASH':
        return CANONICAL_ACCOUNTS.CASH; // 1010
      case 'BANK':
        return CANONICAL_ACCOUNTS.BANK; // 1030
      case 'CREDIT':
        return CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE; // 2010 AP
    }
  }
}

/**
 * Maps operational cash/bank account type to general ledger account code
 */
export function getCashBankAccountGLCode(accountType: 'CASH' | 'BANK' | 'MOBILE_BANKING'): string {
  if (accountType === 'CASH') {
    return CANONICAL_ACCOUNTS.CASH; // 1010
  }
  // BANK and MOBILE_BANKING post to Bank Accounts 1030
  return CANONICAL_ACCOUNTS.BANK; // 1030
}

/**
 * Maps inventory item category to inventory asset account in Chart of Accounts
 */
export function getInventoryAssetAccount(category?: string): string {
  switch (category) {
    case 'FEED':
      return CANONICAL_ACCOUNTS.FEED_INVENTORY; // 1051
    case 'SEED':
    case 'FERTILIZER':
      return CANONICAL_ACCOUNTS.SEED_FERT_INVENTORY; // 1052
    case 'RAW_MATERIAL':
      return CANONICAL_ACCOUNTS.RAW_MATERIALS; // 1053
    case 'WIP':
      return CANONICAL_ACCOUNTS.WIP; // 1054
    case 'PACKAGING':
      return CANONICAL_ACCOUNTS.PACKAGING_INVENTORY; // 1056
    case 'FARM_PRODUCT':
    case 'PROCESSED':
    default:
      return CANONICAL_ACCOUNTS.FINISHED_GOODS; // 1055
  }
}

/**
 * Maps sold farm product to revenue account and corresponding COGS account
 */
export function getRevenueAndCogsAccounts(item: { nameBn?: string; nameEn?: string; category?: string }): {
  revenueCode: string;
  cogsCode: string;
} {
  const name = `${item.nameBn || ''} ${item.nameEn || ''}`.toLowerCase();

  if (name.includes('মাছ') || name.includes('fish') || name.includes('shing') || name.includes('shol') || name.includes('rui')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.FISH_REVENUE, // 4010
      cogsCode: CANONICAL_ACCOUNTS.FISH_COGS // 5010
    };
  }

  if (name.includes('দুধ') || name.includes('milk')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.MILK_REVENUE, // 4030
      cogsCode: CANONICAL_ACCOUNTS.LIVESTOCK_COGS // 5020
    };
  }

  if (name.includes('পশু') || name.includes('গরু') || name.includes('ছাগল') || name.includes('cattle') || name.includes('goat') || name.includes('livestock')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.LIVESTOCK_REVENUE, // 4020
      cogsCode: CANONICAL_ACCOUNTS.LIVESTOCK_COGS // 5020
    };
  }

  if (name.includes('ঘাস') || name.includes('খড়') || name.includes('নেপিয়ার') || name.includes('fodder')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.FODDER_REVENUE, // 4050
      cogsCode: CANONICAL_ACCOUNTS.CROP_COGS // 5030
    };
  }

  if (name.includes('ফসল') || name.includes('ধান') || name.includes('crop') || name.includes('grain')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.CROP_REVENUE, // 4040
      cogsCode: CANONICAL_ACCOUNTS.CROP_COGS // 5030
    };
  }

  if (item.category === 'PROCESSED' || name.includes('প্রক্রিয়াজাত') || name.includes('processed') || name.includes('ঘি') || name.includes('পনির')) {
    return {
      revenueCode: CANONICAL_ACCOUNTS.PROCESSED_REVENUE, // 4060
      cogsCode: CANONICAL_ACCOUNTS.PROCESSED_COGS // 5040
    };
  }

  return {
    revenueCode: CANONICAL_ACCOUNTS.OTHER_REVENUE, // 4090
    cogsCode: CANONICAL_ACCOUNTS.PROCESSED_COGS // 5040
  };
}

/**
 * Maps loan tenure to Short-Term (2110) or Long-Term (2120) loan liability
 */
export function getLoanLiabilityAccount(tenureMonths?: number): string {
  if (tenureMonths && tenureMonths <= 12) {
    return CANONICAL_ACCOUNTS.SHORT_TERM_LOANS; // 2110
  }
  return CANONICAL_ACCOUNTS.LONG_TERM_LOANS; // 2120
}

/**
 * Maps investor contribution to 3020 Investor Capital
 */
export function getInvestorCapitalAccount(): string {
  return CANONICAL_ACCOUNTS.INVESTOR_CAPITAL; // 3020
}

/**
 * Maps fixed asset depreciation to Depreciation Expense (6140) and Accumulated Depreciation (1590)
 */
export function getDepreciationAccounts(): {
  expenseCode: string;
  accumulatedCode: string;
} {
  return {
    expenseCode: CANONICAL_ACCOUNTS.DEPRECIATION_EXPENSE, // 6140
    accumulatedCode: CANONICAL_ACCOUNTS.ACCUMULATED_DEPRECIATION // 1590
  };
}
