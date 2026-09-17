import { Account } from '../types';
import { db } from '../db/indexedDb';

export const DEFAULT_CHART_OF_ACCOUNTS: Account[] = [
  // 1000 Assets
  {
    id: 'acc_1010',
    code: '1010',
    nameBn: 'নগদ টাকা (Cash on Hand)',
    nameEn: 'Cash on Hand',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1020',
    code: '1020',
    nameBn: 'পেটি ক্যাশ (Petty Cash)',
    nameEn: 'Petty Cash',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1030',
    code: '1030',
    nameBn: 'ব্যাংক হিসাব (Bank Accounts)',
    nameEn: 'Bank Accounts',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1040',
    code: '1040',
    nameBn: 'গ্রাহকের নিকট পাওনা (Accounts Receivable)',
    nameEn: 'Accounts Receivable',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1051',
    code: '1051',
    nameBn: 'মজুদ খাদ্য (Feed Inventory)',
    nameEn: 'Feed Inventory',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1052',
    code: '1052',
    nameBn: 'মজুদ বীজ ও সার (Seed & Fertilizer Inventory)',
    nameEn: 'Seed & Fertilizer Inventory',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1053',
    code: '1053',
    nameBn: 'মজুদ কাঁচামাল (Raw Materials)',
    nameEn: 'Raw Materials',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1054',
    code: '1054',
    nameBn: 'প্রক্রিয়াধীন পণ্য (Work in Progress - WIP)',
    nameEn: 'Work in Progress',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1055',
    code: '1055',
    nameBn: 'বিক্রয়যোগ্য উৎপাদিত পণ্য (Finished Farm Products)',
    nameEn: 'Finished Goods Inventory',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1056',
    code: '1056',
    nameBn: 'মজুদ প্যাকেজিং সামগ্রী (Packaging Inventory)',
    nameEn: 'Packaging Inventory',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1060',
    code: '1060',
    nameBn: 'অগ্রিম খরচ (Prepaid Expenses & Advances)',
    nameEn: 'Prepaid Expenses',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1510',
    code: '1510',
    nameBn: 'জমি ও প্লট (Land & Plots)',
    nameEn: 'Land',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1520',
    code: '1520',
    nameBn: 'শেড ও ভবন (Sheds & Buildings)',
    nameEn: 'Buildings & Sheds',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1530',
    code: '1530',
    nameBn: 'পুকুর অবকাঠামো (Pond Infrastructure)',
    nameEn: 'Pond Infrastructure',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1550',
    code: '1550',
    nameBn: 'যন্ত্রপাতি ও সরঞ্জাম (Machinery & Equipment)',
    nameEn: 'Machinery & Equipment',
    accountClass: 'ASSET',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_1590',
    code: '1590',
    nameBn: 'পুঞ্জীভূত অবচয় (Accumulated Depreciation)',
    nameEn: 'Accumulated Depreciation',
    accountClass: 'ASSET',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },

  // 2000 Liabilities
  {
    id: 'acc_2010',
    code: '2010',
    nameBn: 'সরবরাহকারীর দেনা (Accounts Payable)',
    nameEn: 'Accounts Payable',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_2020',
    code: '2020',
    nameBn: 'বকেয়া বেতন ও বিল (Accrued Expenses & Wages)',
    nameEn: 'Accrued Wages & Bills',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_2030',
    code: '2030',
    nameBn: 'কর ও ভ্যাট প্রদেয় (Tax & VAT Payable)',
    nameEn: 'Tax & VAT Payable',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_2040',
    code: '2040',
    nameBn: 'গ্রাহকের অগ্রিম জমা (Customer Advances)',
    nameEn: 'Customer Advances',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_2110',
    code: '2110',
    nameBn: 'স্বল্পমেয়াদী ঋণ (Short-Term Loans)',
    nameEn: 'Short-Term Loans',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_2120',
    code: '2120',
    nameBn: 'দীর্ঘমেয়াদী ঋণ (Long-Term Loans)',
    nameEn: 'Long-Term Loans',
    accountClass: 'LIABILITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },

  // 3000 Equity
  {
    id: 'acc_3010',
    code: '3010',
    nameBn: 'মালিকের মূলধন (Owner Capital)',
    nameEn: 'Owner Capital',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_3020',
    code: '3020',
    nameBn: 'বিনিয়োগকারীর মূলধন (Investor Capital)',
    nameEn: 'Investor Capital',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_3040',
    code: '3040',
    nameBn: 'মালিকের উত্তোলন (Owner Drawings)',
    nameEn: 'Owner Drawings',
    accountClass: 'EQUITY',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_3050',
    code: '3050',
    nameBn: 'পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)',
    nameEn: 'Retained Earnings',
    accountClass: 'EQUITY',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },

  // 4000 Revenue
  {
    id: 'acc_4010',
    code: '4010',
    nameBn: 'মাছ বিক্রয় আয় (Fish Sales Revenue)',
    nameEn: 'Fish Sales Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4020',
    code: '4020',
    nameBn: 'পশু বিক্রয় আয় (Livestock Sales Revenue)',
    nameEn: 'Livestock Sales Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4030',
    code: '4030',
    nameBn: 'দুধ বিক্রয় আয় (Milk Sales Revenue)',
    nameEn: 'Milk Sales Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4040',
    code: '4040',
    nameBn: 'ফসল বিক্রয় আয় (Crop Sales Revenue)',
    nameEn: 'Crop Sales Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4050',
    code: '4050',
    nameBn: 'ঘাস/খড় বিক্রয় আয় (Fodder Sales Revenue)',
    nameEn: 'Fodder Sales Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4060',
    code: '4060',
    nameBn: 'প্রক্রিয়াজাত পণ্য বিক্রয় (Processed Product Sales)',
    nameEn: 'Processed Product Sales',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_4090',
    code: '4090',
    nameBn: 'বিবিধ খামার আয় (Other Farm Revenue)',
    nameEn: 'Other Farm Revenue',
    accountClass: 'REVENUE',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },

  // 5000 Cost of Goods Sold (COGS)
  {
    id: 'acc_5010',
    code: '5010',
    nameBn: 'বিক্রিত মাছের উৎপাদন ব্যয় (Fish COGS)',
    nameEn: 'Fish Cost of Goods Sold',
    accountClass: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_5020',
    code: '5020',
    nameBn: 'বিক্রিত পশুর অধিগ্রহণ/উৎপাদন ব্যয় (Livestock COGS)',
    nameEn: 'Livestock Cost of Goods Sold',
    accountClass: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_5030',
    code: '5030',
    nameBn: 'বিক্রিত ফসলের উৎপাদন ব্যয় (Crop COGS)',
    nameEn: 'Crop Cost of Goods Sold',
    accountClass: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_5040',
    code: '5040',
    nameBn: 'প্রক্রিয়াজাত পণ্যের উৎপাদন ব্যয় (Processed Product COGS)',
    nameEn: 'Processed Product COGS',
    accountClass: 'COGS',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },

  // 6000 Operating Expenses
  {
    id: 'acc_6010',
    code: '6010',
    nameBn: 'খাদ্য ক্রয় খরচ (Feed Expense)',
    nameEn: 'Feed Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6020',
    code: '6020',
    nameBn: 'খামার শ্রমিকের মজুরি (Farm Labour Wages)',
    nameEn: 'Farm Labour Wages',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6030',
    code: '6030',
    nameBn: 'কর্মচারীর বেতন (Staff Salary)',
    nameEn: 'Staff Salary',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6040',
    code: '6040',
    nameBn: 'চিকিৎসা ও ওষুধ (Veterinary & Medicine)',
    nameEn: 'Veterinary & Medicine',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6050',
    code: '6050',
    nameBn: 'টিকা প্রদান খরচ (Vaccination Expense)',
    nameEn: 'Vaccination Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6060',
    code: '6060',
    nameBn: 'বিদ্যুৎ বিল (Electricity & Utilities)',
    nameEn: 'Electricity & Utilities',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6070',
    code: '6070',
    nameBn: 'সেচ ও পানি সরবরাহ খরচ (Irrigation & Water)',
    nameEn: 'Irrigation & Water Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6080',
    code: '6080',
    nameBn: 'পরিবহন ও জ্বালানি (Fuel & Transport)',
    nameEn: 'Fuel & Transport',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6090',
    code: '6090',
    nameBn: 'মেরামত ও রক্ষণাবেক্ষণ (Repair & Maintenance)',
    nameEn: 'Repair & Maintenance',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6100',
    code: '6100',
    nameBn: 'প্যাকেজিং খরচ (Packaging Expense)',
    nameEn: 'Packaging Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6110',
    code: '6110',
    nameBn: 'জমি ও পুকুর ইজারা/ভাড়া (Land & Pond Lease/Rent)',
    nameEn: 'Land & Pond Lease/Rent',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6130',
    code: '6130',
    nameBn: 'ব্যাংক চার্জ (Bank Charges)',
    nameEn: 'Bank Charges',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6140',
    code: '6140',
    nameBn: 'অবচয় খরচ (Depreciation Expense)',
    nameEn: 'Depreciation Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },
  {
    id: 'acc_6150',
    code: '6150',
    nameBn: 'বিবিধ সাধারণ খরচ (Miscellaneous Expense)',
    nameEn: 'Miscellaneous Expense',
    accountClass: 'EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  },

  // 7000 Other Income
  {
    id: 'acc_7010',
    code: '7010',
    nameBn: 'সরকারি প্রণোদনা/ভর্তুকি (Government Subsidy)',
    nameEn: 'Government Subsidy',
    accountClass: 'OTHER_INCOME',
    normalBalance: 'CREDIT',
    isSystem: true,
    isActive: true
  },

  // 8000 Other Expense
  {
    id: 'acc_8010',
    code: '8010',
    nameBn: 'ঋণের সুদ খরচ (Loan Interest Expense)',
    nameEn: 'Loan Interest Expense',
    accountClass: 'OTHER_EXPENSE',
    normalBalance: 'DEBIT',
    isSystem: true,
    isActive: true
  }
];

export async function initDefaultAccounts(): Promise<void> {
  const count = await db.accounts.count();
  if (count === 0) {
    await db.accounts.bulkPut(DEFAULT_CHART_OF_ACCOUNTS);
  } else {
    // Ensure all default accounts exist without overwriting user custom accounts
    for (const defAcc of DEFAULT_CHART_OF_ACCOUNTS) {
      const existing = await db.accounts.where('code').equals(defAcc.code).first();
      if (!existing) {
        await db.accounts.put(defAcc);
      }
    }
  }
}
