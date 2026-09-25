import { useState, useEffect } from 'react';

export type Language = 'bn' | 'en';

export const LANGUAGE_STORAGE_KEY = 'goted_app_language';

export const translations = {
  bn: {
    // Navigation labels
    'nav.dashboard': 'ড্যাশবোর্ড',
    'nav.accounting': 'হিসাব',
    'nav.operations': 'খামার',
    'nav.commerce': 'মজুদ/বিক্রয়',
    'nav.finance': 'ব্যাংক/ঋণ',
    'nav.reports': 'রিপোর্ট',
    'nav.more': 'মেনু',

    // Buttons
    'btn.save': 'সংরক্ষণ করুন',
    'btn.cancel': 'বাতিল করুন',
    'btn.add': 'যোগ করুন',
    'btn.edit': 'সম্পাদনা করুন',
    'btn.delete': 'মুছুন',
    'btn.close': 'বন্ধ করুন',
    'btn.confirm': 'নিশ্চিত করুন',
    'btn.back': 'ফিরে যান',
    'btn.search': 'অনুসন্ধান',
    'btn.filter': 'ফিল্টার',
    'btn.export': 'এক্সপোর্ট',
    'btn.import': 'ইমপোর্ট',
    'btn.sync': 'ক্লাউড সিঙ্ক',
    'btn.downloadBackup': 'ব্যাকআপ ডাউনলোড',
    'btn.loadMore': 'আরও দেখুন',
    'btn.logout': 'লগ আউট',
    'btn.dismiss': 'বন্ধ করুন',
    'btn.done': 'সম্পন্ন',
    'btn.skip': 'এড়িয়ে যান',
    'btn.newVoucher': 'নতুন ভাউচার',
    'btn.salesInvoice': 'বিক্রয় / চালান',
    'btn.login': 'লগইন করুন ও অ্যাপে প্রবেশ করুন',
    'btn.verifying': 'যাচাই করা হচ্ছে...',
    'btn.checkAgain': 'পুনরায় যাচাই করুন',
    'btn.forgotPin': 'PIN ভুলে গেছেন?',
    'btn.sendResetCode': 'রিসেট কোড পাঠান',
    'btn.resetPinConfirm': 'নতুন পিন সংরক্ষণ করুন',

    // App Branding & General
    'app.title': 'The Goated Farm',
    'app.subtitle': 'সমন্বিত কৃষি ও খামার হিসাবরক্ষণ ব্যবস্থাপনা',
    'app.tagline': 'সমন্বিত খামার ও হিসাবরক্ষণ',
    'app.secureGate': 'সুরক্ষিত প্রবেশদ্বার',
    'language.setting': 'ভাষা / Language',
    'language.bn': 'বাংলা (ডিফল্ট)',
    'language.en': 'English',
    'language.desc': 'অ্যাপের দৃশ্যমান লেখার ভাষা পরিবর্তন করুন (Change app display language)',

    // Login Screen
    'login.yourEmail': 'আপনার ইমেইল ঠিকানা',
    'login.emailPlaceholder': 'যেমন: yourname@example.com',
    'login.secretPin': 'গোপন পিন',
    'login.pinPlaceholder': 'গোপন পিন দিন (ডিফল্ট: 123456)...',
    'login.defaultPinLabel': 'ডিফল্ট পিন:',
    'login.autoFillPin': 'পিন পূরণ করুন (Auto-fill 123456)',
    'login.rememberNotice': 'একবার সঠিক পিন দিয়ে সফলভাবে লগইন করলে এই ডিভাইসে আপনার সেশন সংরক্ষিত থাকবে। পরবর্তীতে লিংক খুললে বারবার পিন দিতে হবে না।',
    'login.setupIncompleteTitle': 'সেটআপ অসম্পূর্ণ',
    'login.setupIncompleteMsg': 'সেটআপ অসম্পূর্ণ: অনুগ্রহ করে AI Studio-র Secrets প্যানেলে আপনার ইমেইল ও পিন যোগ করুন।',
    'login.requiredSecrets': 'প্রয়োজনীয় সিক্রেট ভ্যারিয়েবল:',
    'login.checkingSecurity': 'নিরাপত্তা স্ট্যাটাস যাচাই করা হচ্ছে...',
    'login.invalidCredentials': 'অবৈধ ইমেইল অথবা গোপন পিন! সঠিক তথ্য না দিলে অ্যাপে প্রবেশ করা যাবে না।',
    'login.verificationError': 'যাচাইকরণে ত্রুটি দেখা দিয়েছে। পুনরায় চেষ্টা করুন।',
    'login.forgotModalTitle': 'গোপন পিন রিসেট করুন',
    'login.forgotStep1Desc': 'আপনার অনুমোদিত ইমেইল দিন। আমরা একটি সাময়িক যাচাইকরণ কোড তৈরি করব।',
    'login.forgotStep2Desc': 'সার্ভার কনসোল/ইমেইল থেকে প্রাপ্ত কোড এবং আপনার নতুন গোপন পিন দিন।',
    'login.resetCodeLabel': 'যাচাইকরণ কোড',
    'login.newPinLabel': 'নতুন গোপন পিন (কমপক্ষে ৬ ডিজিট)',
    'login.confirmPinLabel': 'নতুন পিন পুনরায় লিখুন',

    // Dashboard
    'dashboard.title': 'খামার সার্বিক চিত্র',
    'dashboard.subtitle': 'রিয়েল-টাইম হিসাবরক্ষণ, গবাদিপশু, মৎস্য ও শস্যের সার্বিক অবস্থা',
    'dashboard.balanced': 'দ্বৈত-দাখিলা নির্ভুল',
    'dashboard.dueThisWeek': 'এই সপ্তাহে করণীয়',
    'dashboard.pendingCount': 'টি পেন্ডিং',
    'dashboard.noReminders': 'এই সপ্তাহে কোনো স্বাস্থ্য বা পরিচর্যা সংক্রান্ত কাজ বকেয়া নেই।',
    'dashboard.today': 'আজকের কাজ',
    'dashboard.tomorrow': 'আগামীকাল',
    'dashboard.daysRemaining': 'দিন বাকি',
    'dashboard.overdue': 'মেয়াদোত্তীর্ণ',
    'dashboard.date': 'তারিখ:',
    'dashboard.animalId': 'পশু আইডি:',
    'dashboard.viewDetails': '| বিস্তারিত ও ইতিহাস দেখতে ট্যাপ করুন →',
    'dashboard.totalLiquidity': 'তরল তহবিল (নগদ ও ব্যাংক)',
    'dashboard.cash': 'ক্যাশ:',
    'dashboard.bank': 'ব্যাংক:',
    'dashboard.netProfit': 'নিট লাভ / ক্ষতি',
    'dashboard.netProfitNote': 'চলতি হিসাবকাল অনুযায়ী দ্বৈত-দাখিলা মুনাফা',
    'dashboard.totalRevenue': 'মোট রাজস্ব / আয়',
    'dashboard.revenueDesc': 'পশু, মাছ, দুধ ও ফসল বিক্রয়',
    'dashboard.totalExpenses': 'মোট খরচ ও COGS',
    'dashboard.expensesDesc': 'খাবার, ওষুধ ও পরিচালন ব্যয়',
    'dashboard.receivables': 'কাস্টমারদের কাছে পাওনা',
    'dashboard.receivablesDesc': 'বকেয়া বিক্রয় বিল',
    'dashboard.payables': 'সাপ্লায়ার দেনা (AP)',
    'dashboard.payablesDesc': 'খাবার ও কাঁচামাল দেনা',
    'dashboard.bioAssets': 'খামারের বর্তমান জৈব সম্পদ সূচক',
    'dashboard.details': 'বিস্তারিত →',
    'dashboard.activeLivestock': 'সক্রিয় গবাদিপশু',
    'dashboard.livestockDesc': 'গরু ও ছাগল পালনে সক্রিয়',
    'dashboard.activeFish': 'সক্রিয় মাছের ব্যাচ',
    'dashboard.fishDesc': 'পুকুরভিত্তিক মাছ চাষ',
    'dashboard.activeCrops': 'চলতি শস্য ও ঘাস চক্র',
    'dashboard.cropDesc': 'নেপিয়ার ঘাস ও মৌসুমী ফসল',
    'dashboard.recentTx': 'সাম্প্রতিক জাবেদা লেনদেন',
    'dashboard.allJournals': 'সকল জাবেদা →',
    'dashboard.noTx': 'এখনও কোন আর্থিক লেনদেন লিপিবদ্ধ করা হয়নি। "নতুন ভাউচার" দিয়ে শুরু করুন।',
    'dashboard.noNarration': 'কোন বিবরণ নেই',
    'dashboard.balancedDebitCredit': 'ডেবিট = ক্রেডিট',
    'dashboard.corrected': 'সংশোধিত',
    'dashboard.backupReminder': 'আপনার খামারের হিসাব সুরক্ষিত রাখতে নিয়মিত ক্লাউড সিঙ্ক অথবা ব্যাকআপ ডাউনলোড করুন',
    'dashboard.backupReminderSub': '(Sync to cloud or download backup to keep your farm data safe)',
    'dashboard.syncOverdue': 'ক্লাউড সিঙ্ক ৫ দিনের বেশি পুরোনো',
    'dashboard.exportOverdue': 'ফাইল ব্যাকআপ ১৪ দিনের বেশি পুরোনো',
    'dashboard.syncing': 'সিঙ্ক হচ্ছে...',
    'dashboard.downloading': 'ডাউনলোড হচ্ছে...',
    'dashboard.alerts': 'জরুরি সতর্কতা',
    'dashboard.unitPieces': 'টি'
  },
  en: {
    // Navigation labels
    'nav.dashboard': 'Dashboard',
    'nav.accounting': 'Accounts',
    'nav.operations': 'Farm',
    'nav.commerce': 'Inventory',
    'nav.finance': 'Finance',
    'nav.reports': 'Reports',
    'nav.more': 'Menu',

    // Buttons
    'btn.save': 'Save',
    'btn.cancel': 'Cancel',
    'btn.add': 'Add',
    'btn.edit': 'Edit',
    'btn.delete': 'Delete',
    'btn.close': 'Close',
    'btn.confirm': 'Confirm',
    'btn.back': 'Back',
    'btn.search': 'Search',
    'btn.filter': 'Filter',
    'btn.export': 'Export',
    'btn.import': 'Import',
    'btn.sync': 'Cloud Sync',
    'btn.downloadBackup': 'Download Backup',
    'btn.loadMore': 'Load More',
    'btn.logout': 'Log Out',
    'btn.dismiss': 'Dismiss',
    'btn.done': 'Done',
    'btn.skip': 'Skip',
    'btn.newVoucher': 'New Voucher',
    'btn.salesInvoice': 'Sales / Invoice',
    'btn.login': 'Log In & Access App',
    'btn.verifying': 'Verifying...',
    'btn.checkAgain': 'Check Again',
    'btn.forgotPin': 'Forgot PIN?',
    'btn.sendResetCode': 'Send Reset Code',
    'btn.resetPinConfirm': 'Save New PIN',

    // App Branding & General
    'app.title': 'The Goated Farm',
    'app.subtitle': 'Integrated Agriculture & Farm Accounting Management',
    'app.tagline': 'Integrated Farm & Accounting',
    'app.secureGate': 'Secure Portal',
    'language.setting': 'Language / ভাষা',
    'language.bn': 'বাংলা (Bengali)',
    'language.en': 'English (ইংরেজি)',
    'language.desc': 'Change the visible display language of the app',

    // Login Screen
    'login.yourEmail': 'Your Email Address',
    'login.emailPlaceholder': 'e.g., yourname@example.com',
    'login.secretPin': 'Secret Master PIN',
    'login.pinPlaceholder': 'Enter secret PIN (default: 123456)...',
    'login.defaultPinLabel': 'Default PIN:',
    'login.autoFillPin': 'Auto-fill PIN (123456)',
    'login.rememberNotice': 'Once logged in with the correct PIN, your session is saved on this device so you will not need to re-enter your PIN on subsequent visits.',
    'login.setupIncompleteTitle': 'Setup Incomplete',
    'login.setupIncompleteMsg': 'Setup incomplete: Please add your approved email and initial PIN in the AI Studio Secrets panel.',
    'login.requiredSecrets': 'Required Secret Variables:',
    'login.checkingSecurity': 'Verifying security status...',
    'login.invalidCredentials': 'Invalid email or secret PIN! Please provide valid credentials to access the app.',
    'login.verificationError': 'Verification error occurred. Please try again.',
    'login.forgotModalTitle': 'Reset Secret PIN',
    'login.forgotStep1Desc': 'Enter your authorized email. We will generate a temporary verification code.',
    'login.forgotStep2Desc': 'Enter the verification code received and your new secret PIN.',
    'login.resetCodeLabel': 'Verification Code',
    'login.newPinLabel': 'New Secret PIN (min 6 digits)',
    'login.confirmPinLabel': 'Re-enter New PIN',

    // Dashboard
    'dashboard.title': 'Farm Executive Overview',
    'dashboard.subtitle': 'Real-time accounting, livestock, fisheries & crop operational status',
    'dashboard.balanced': 'Double-Entry Balanced',
    'dashboard.dueThisWeek': 'Due This Week',
    'dashboard.pendingCount': 'pending',
    'dashboard.noReminders': 'No scheduled health or care tasks due this week.',
    'dashboard.today': 'Due Today',
    'dashboard.tomorrow': 'Tomorrow',
    'dashboard.daysRemaining': 'days left',
    'dashboard.overdue': 'Overdue',
    'dashboard.date': 'Date:',
    'dashboard.animalId': 'Animal ID:',
    'dashboard.viewDetails': '| Tap to view history & details →',
    'dashboard.totalLiquidity': 'Total Liquidity (Cash & Bank)',
    'dashboard.cash': 'Cash:',
    'dashboard.bank': 'Bank:',
    'dashboard.netProfit': 'Net Profit / Loss',
    'dashboard.netProfitNote': 'Double-entry net profit for current period',
    'dashboard.totalRevenue': 'Total Revenue / Income',
    'dashboard.revenueDesc': 'Sales of livestock, fish, milk & crops',
    'dashboard.totalExpenses': 'Total Expenses & COGS',
    'dashboard.expensesDesc': 'Feed, medicine & operational costs',
    'dashboard.receivables': 'Accounts Receivable (AR)',
    'dashboard.receivablesDesc': 'Unpaid customer sales invoices',
    'dashboard.payables': 'Accounts Payable (AP)',
    'dashboard.payablesDesc': 'Supplier feed & raw material dues',
    'dashboard.bioAssets': 'Current Biological Asset Indicators',
    'dashboard.details': 'Details →',
    'dashboard.activeLivestock': 'Active Livestock',
    'dashboard.livestockDesc': 'Active cattle & goat rearing',
    'dashboard.activeFish': 'Active Fish Batches',
    'dashboard.fishDesc': 'Pond-based fish farming',
    'dashboard.activeCrops': 'Active Crops & Grass',
    'dashboard.cropDesc': 'Napier grass & seasonal crops',
    'dashboard.recentTx': 'Recent Journal Transactions',
    'dashboard.allJournals': 'All Journals →',
    'dashboard.noTx': 'No transactions posted yet. Start with "New Voucher".',
    'dashboard.noNarration': 'No narration',
    'dashboard.balancedDebitCredit': 'Debit = Credit',
    'dashboard.corrected': 'Reversed',
    'dashboard.backupReminder': 'Regularly sync to cloud or download backup to keep your farm data safe',
    'dashboard.backupReminderSub': '(Sync to cloud or download backup to keep your farm data safe)',
    'dashboard.syncOverdue': 'Cloud sync is over 5 days old',
    'dashboard.exportOverdue': 'File backup is over 14 days old',
    'dashboard.syncing': 'Syncing...',
    'dashboard.downloading': 'Downloading...',
    'dashboard.alerts': 'Urgent Alerts',
    'dashboard.unitPieces': 'units'
  }
};

export type TranslationKey = keyof typeof translations.bn;

/**
 * Get current saved language from local storage, defaulting to 'bn'.
 */
export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'bn') return saved;
  } catch {
    // Ignore storage exceptions
  }
  return 'bn'; // Default to Bengali
}

/**
 * Save language to local storage and notify listening components.
 */
export function setSavedLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    window.dispatchEvent(new CustomEvent('language_changed', { detail: lang }));
    window.dispatchEvent(new Event('goted_settings_changed'));
  } catch (e) {
    console.error('Failed to save language preference:', e);
  }
}

/**
 * Translate helper function.
 * @param key Dictionary key
 * @param lang Optional language override (uses saved language by default)
 * @param fallback Optional fallback text if key is missing
 */
export function t(key: TranslationKey | string, lang?: Language, fallback?: string): string {
  const currentLang = lang || getSavedLanguage();
  const dict = translations[currentLang] || translations.bn;
  return (dict as any)[key] ?? (translations.bn as any)[key] ?? fallback ?? key;
}

/**
 * React hook to access and switch current language with automatic reactivity.
 */
export function useLanguage() {
  const [lang, setLangState] = useState<Language>(getSavedLanguage);

  useEffect(() => {
    const handleUpdate = () => {
      setLangState(getSavedLanguage());
    };
    window.addEventListener('language_changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('goted_settings_changed', handleUpdate);
    return () => {
      window.removeEventListener('language_changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('goted_settings_changed', handleUpdate);
    };
  }, []);

  const changeLanguage = (newLang: Language) => {
    setSavedLanguage(newLang);
    setLangState(newLang);
  };

  const translateKey = (key: TranslationKey | string, fallback?: string): string => {
    return t(key, lang, fallback);
  };

  return {
    lang,
    language: lang,
    setLanguage: changeLanguage,
    t: translateKey
  };
}
