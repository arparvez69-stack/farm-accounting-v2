import React, { useEffect, useState, useMemo } from 'react';
import {
  ShieldCheck,
  Building,
  Shield,
  History,
  HardDrive,
  Users,
  CheckCircle2,
  Mail,
  Lock,
  UserCheck,
  KeyRound,
  RefreshCw,
  LogOut,
  Eye,
  EyeOff,
  AlertCircle,
  Calculator,
  FileText,
  Globe,
  Phone,
  Moon,
  Syringe,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  Wallet,
  Clock,
  Laptop,
  LayoutDashboard,
  BookOpen,
  Tractor,
  Package,
  Landmark,
  FileSpreadsheet,
  Menu,
  Flame,
  AlertTriangle
} from 'lucide-react';
import { useLanguage } from '../i18n/translations';
import { db } from '../db/indexedDb';
import { auth, initializeLocalDatabase } from '../firebase/firebaseClient';
import { AuditLog, FixedAsset, SystemConfig, UserRole, AppAccessLog, VaccineTemplate, JournalLine, CashBankAccount, Party } from '../types';
import { getStoredAuthorizedEmails, getAppAccessLogs, logoutOwner } from '../services/authService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { getLastSyncTime, formatBackupTimestamp } from '../services/exportService';
import {
  runAutomatedDepreciation,
  executeFixedAssetAcquisitionTransaction,
  executeFixedAssetDisposalTransaction,
  hasAssetPostedAccounting,
  executeEditFixedAssetTransaction,
  getAssetAccountInfo,
  calculateAssetDepreciationParameters
} from '../accounting/depreciationService';
import { postJournalEntry } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS } from '../accounting/accountMapping';
import { getVaccineTemplates, saveVaccineTemplates, DEFAULT_VACCINE_TEMPLATES } from '../data/vaccineTemplates';
import { IconTile } from './ui/IconTile';
import { ActiveTab } from './MobileBottomNav';
import { triggerSuccessAnimation } from './ui/SuccessAnimation';

interface Props {
  role: UserRole;
  currentUserId: string;
  systemConfig: SystemConfig | null;
  userEmail?: string;
  onLogout?: () => void;
  onNavigate?: (tab: ActiveTab) => void;
}

const MAIN_MODULES: {
  id: ActiveTab;
  nameBn: string;
  nameEn: string;
  icon: React.ElementType;
  color: string;
  subtitle: string;
}[] = [
  {
    id: 'dashboard',
    nameBn: 'ড্যাশবোর্ড',
    nameEn: 'Dashboard',
    icon: LayoutDashboard,
    color: 'emerald',
    subtitle: 'সারসংক্ষেপ ও জরুরি রিমাইন্ডার'
  },
  {
    id: 'accounting',
    nameBn: 'হিসাবরক্ষণ',
    nameEn: 'Accounting',
    icon: BookOpen,
    color: 'blue',
    subtitle: 'জাবেদা, খতিয়ান ও হিসাবের তালিকা'
  },
  {
    id: 'operations',
    nameBn: 'খামার ও পশুপালন',
    nameEn: 'Livestock & Ops',
    icon: Tractor,
    color: 'emerald',
    subtitle: 'পশু ব্যবস্থাপনা, খাদ্য ও দুধ উৎপাদন'
  },
  {
    id: 'commerce',
    nameBn: 'ইনভেন্টরি ও বাণিজ্য',
    nameEn: 'Inventory & Commerce',
    icon: Package,
    color: 'amber',
    subtitle: 'পণ্য স্টক, খাদ্য সরবরাহ ও চালান'
  },
  {
    id: 'finance',
    nameBn: 'ব্যাংক ও তহবিল',
    nameEn: 'Banking & Finance',
    icon: Landmark,
    color: 'indigo',
    subtitle: 'ব্যাংক খতিয়ান, ঋণ ও বিনিয়োগকারী'
  },
  {
    id: 'reports',
    nameBn: 'রিপোর্টস ও বিবরণী',
    nameEn: 'Reports & Analytics',
    icon: FileSpreadsheet,
    color: 'teal',
    subtitle: 'লাভ-ক্ষতি, ব্যালেন্স শিট ও আর্থিক বিশ্লেষণ'
  },
  {
    id: 'more',
    nameBn: 'সিস্টেম ও অডিট',
    nameEn: 'System & More',
    icon: Menu,
    color: 'gray',
    subtitle: 'অডিট ট্রেইল, গোপন পিন ও ফার্ম সেটিংস'
  }
];

type MoreTab = 'accessLogs' | 'changePin' | 'audit' | 'assets' | 'owners' | 'settings' | 'vaccines';

export const MoreModule: React.FC<Props> = ({ role, currentUserId, systemConfig, userEmail, onLogout, onNavigate }) => {
  const [tab, setTab] = useState<MoreTab>('accessLogs');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [accessLogs, setAccessLogs] = useState<AppAccessLog[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(() => getLastSyncTime());

  // Language state (stored in local settings, defaulting to Bengali)
  const { lang: currentLanguage, setLanguage } = useLanguage();

  // VAT/TIN Registered Business State (stored in local settings, off by default)
  const [isVatRegistered, setIsVatRegistered] = useState<boolean>(() => {
    return localStorage.getItem('goted_vat_registered') === 'true';
  });
  const [tinNumber, setTinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_tin_number') || '';
  });
  const [binNumber, setBinNumber] = useState<string>(() => {
    return localStorage.getItem('goted_bin_number') || '';
  });
  const [farmPhone, setFarmPhone] = useState<string>(() => {
    return (systemConfig?.phone && systemConfig.phone !== '+8801700000000') ? systemConfig.phone : (localStorage.getItem('goted_farm_phone') || '');
  });

  // Low Cash Alert Threshold Setting (নগদ সতর্কতা সীমা, default: 5000)
  const [lowCashAlertThreshold, setLowCashAlertThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('goted_low_cash_alert_threshold');
    if (saved !== null && !isNaN(Number(saved))) {
      return Number(saved);
    }
    return 5000;
  });

  const handleLowCashAlertThresholdChange = (val: number) => {
    const safeVal = isNaN(val) ? 0 : val;
    setLowCashAlertThreshold(safeVal);
    localStorage.setItem('goted_low_cash_alert_threshold', safeVal.toString());
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  // Dark Mode state (saved to local settings, defaulting to off)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('goted_dark_mode') === 'true';
  });

  const handleToggleDarkMode = (checked: boolean) => {
    setIsDarkMode(checked);
    localStorage.setItem('goted_dark_mode', checked ? 'true' : 'false');
    if (checked) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handleToggleVat = (checked: boolean) => {
    setIsVatRegistered(checked);
    localStorage.setItem('goted_vat_registered', checked ? 'true' : 'false');
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handleTinChange = (val: string) => {
    setTinNumber(val);
    localStorage.setItem('goted_tin_number', val);
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handleBinChange = (val: string) => {
    setBinNumber(val);
    localStorage.setItem('goted_bin_number', val);
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  const handlePhoneChange = async (val: string) => {
    setFarmPhone(val);
    localStorage.setItem('goted_farm_phone', val);
    try {
      const configs = await db.systemConfig.toArray();
      if (configs.length > 0) {
        await db.systemConfig.update(configs[0].ownerUid, { phone: val.trim() });
      }
    } catch (err) {
      console.warn('Could not update phone in systemConfig:', err);
    }
    window.dispatchEvent(new Event('goted_settings_changed'));
  };

  useEffect(() => {
    const handleSyncTimeUpdated = () => {
      setLastBackupTime(getLastSyncTime());
    };
    window.addEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
    return () => window.removeEventListener('goted-sync-time-updated', handleSyncTimeUpdated);
  }, []);

  const ownerList = useMemo(() => {
    const fromStorage = getStoredAuthorizedEmails();
    if (fromStorage.length > 0) return fromStorage;
    if (systemConfig?.ownerEmails && systemConfig.ownerEmails.length > 0) return systemConfig.ownerEmails;
    if (userEmail) return [userEmail];
    return [];
  }, [systemConfig, userEmail]);

  // Change PIN state
  const [targetEmail, setTargetEmail] = useState<string>(userEmail || '');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  // Add Asset Modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [assetCategory, setAssetCategory] = useState<FixedAsset['category']>('MACHINERY');
  const [assetCost, setAssetCost] = useState('150000');
  const [assetLifeYears, setAssetLifeYears] = useState('5');
  const [assetSalvage, setAssetSalvage] = useState('15000');
  const [assetDepreciationRate, setAssetDepreciationRate] = useState('10');
  const [assetPaymentMethod, setAssetPaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');
  const [assetSelectedBankAccountId, setAssetSelectedBankAccountId] = useState('');
  const [assetSelectedSupplierId, setAssetSelectedSupplierId] = useState('');
  const [bankAccountsList, setBankAccountsList] = useState<CashBankAccount[]>([]);
  const [suppliersList, setSuppliersList] = useState<Party[]>([]);

  // Edit Asset State
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null);
  const [editAssetName, setEditAssetName] = useState('');
  const [editAssetCategory, setEditAssetCategory] = useState<FixedAsset['category']>('MACHINERY');
  const [editAssetCost, setEditAssetCost] = useState('');
  const [editAssetLifeYears, setEditAssetLifeYears] = useState('5');
  const [editAssetSalvage, setEditAssetSalvage] = useState('0');
  const [editAssetDepreciationRate, setEditAssetDepreciationRate] = useState('10');
  const [editAssetHasAccounting, setEditAssetHasAccounting] = useState(false);
  const [editAssetAccountingReason, setEditAssetAccountingReason] = useState<string | null>(null);
  const [submittingEditAsset, setSubmittingEditAsset] = useState(false);
  const [deprLoading, setDeprLoading] = useState(false);
  const [deprFeedback, setDeprFeedback] = useState<string | null>(null);

  // Erase All Data & Start Fresh (Danger Zone) State
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmInput, setWipeConfirmInput] = useState('');
  const [wipeLoading, setWipeLoading] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const handleExecuteWipeAllData = async () => {
    if (wipeConfirmInput.trim() !== 'মুছুন') {
      setWipeError('অনুগ্রহ করে নিশ্চিত করতে হুবহু "মুছুন" টাইপ করুন।');
      return;
    }

    setWipeLoading(true);
    setWipeError(null);

    try {
      // 1. Get authentication token for server call
      let token: string | null = null;
      if (auth.currentUser) {
        try {
          token = await auth.currentUser.getIdToken();
        } catch {}
      }
      if (!token) {
        try {
          const session = JSON.parse(localStorage.getItem('goted_owner_session') || '{}');
          token = session.sessionToken || null;
        } catch {}
      }

      // 2. Call backend wipe endpoint to clear all Firestore collections with Admin SDK
      const response = await fetch('/api/wipe-all-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ confirmation: 'মুছুন' })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'ক্লাউড ডেটা মোছা সম্পন্ন হয়নি।');
      }

      // 3. Wipe all local IndexedDB tables cleanly
      await Promise.all(db.tables.map((table) => table.clear()));
      await initializeLocalDatabase();

      // 4. Clear sync timestamps and farm preferences (except auth credentials needed for fresh login)
      localStorage.removeItem('goted_last_sync_time');
      localStorage.removeItem('goted_farm_phone');
      localStorage.removeItem('goted_tin_number');
      localStorage.removeItem('goted_bin_number');
      localStorage.removeItem('goted_low_cash_alert_threshold');
      localStorage.removeItem('goted_welcome_dismissed');
      localStorage.removeItem('goted_legacy_accounts_migrated_v1');

      // 5. Log out cleanly and return to login screen
      await logoutOwner();
      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    } catch (err: any) {
      console.error('Wipe data error:', err);
      setWipeError(err.message || 'ডেটা মোছা ব্যর্থ হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
      setWipeLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tab]);

  const handleLogoutDevice = async () => {
    if (window.confirm('আপনি কি নিশ্চিত যে আপনি এই ডিভাইস থেকে লগ আউট করতে চান? পুনরায় প্রবেশ করতে ইমেইল ও গোপন পিন প্রয়োজন হবে।')) {
      await logoutOwner();
      if (onLogout) {
        onLogout();
      } else {
        window.location.reload();
      }
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    const cleanCurrent = currentPin.trim();
    const cleanNew = newPin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!cleanCurrent) {
      setPinError('বর্তমান গোপন পিন প্রদান করুন।');
      return;
    }
    if (cleanNew.length < 6) {
      setPinError('নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে (New PIN must be 6+ digits)।');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      setPinError('নতুন পিন এবং নিশ্চিতকরণ পিন মিলছে না (PINs do not match)।');
      return;
    }

    setPinLoading(true);
    try {
      const res = await fetch('/api/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          currentPin: cleanCurrent,
          newPin: cleanNew
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPinSuccess('গোপন পিন সফলভাবে পরিবর্তন করা হয়েছে! আপনার পরবর্তী লগইনে এই নতুন পিনটি ব্যবহার করুন।');
        triggerSuccessAnimation('গোপন পিন সফলভাবে পরিবর্তন হয়েছে!');
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
      } else {
        setPinError(data.error || 'পিন পরিবর্তন ব্যর্থ হয়েছে।');
      }
    } catch (err: any) {
      setPinError(err.message || 'সার্ভার যোগাযোগে ত্রুটি দেখা দিয়েছে।');
    } finally {
      setPinLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'accessLogs') {
        const alList = await getAppAccessLogs();
        setAccessLogs(alList);
      } else if (tab === 'audit') {
        const aList = await db.auditLogs.orderBy('timestamp').reverse().limit(100).toArray();
        setLogs(aList);
      } else if (tab === 'assets') {
        const fList = await db.fixedAssets.toArray();
        setAssets(fList);
        const bList = await db.cashBankAccounts.toArray();
        setBankAccountsList(bList.filter((b) => b.isActive !== false));
        const sList = await db.parties.where('partyType').equals('SUPPLIER').toArray();
        setSuppliersList(sList.filter((s) => s.isActive !== false));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cost = parseFloat(assetCost) || 0;
      const life = parseFloat(assetLifeYears) || 5;
      const salvage = parseFloat(assetSalvage) || 0;
      const rate = parseFloat(assetDepreciationRate) || (life > 0 ? Number((100 / life).toFixed(2)) : 10);
      const purchaseDateStr = new Date().toISOString().split('T')[0];
      const normCat = assetCategory === 'BUILDING' ? 'BUILDINGS' : assetCategory;

      const effectiveBankId = assetPaymentMethod === 'BANK' ? (assetSelectedBankAccountId || bankAccountsList[0]?.id) : undefined;
      const effectiveSupplierId = assetPaymentMethod === 'CREDIT' ? (assetSelectedSupplierId || suppliersList[0]?.id) : undefined;

      const res = await executeFixedAssetAcquisitionTransaction(
        {
          name: assetName.trim(),
          category: normCat,
          purchaseDate: purchaseDateStr,
          originalCost: cost,
          salvageValue: salvage,
          usefulLifeYears: life,
          depreciationRatePercent: rate,
          paymentMethod: assetPaymentMethod,
          bankAccountId: effectiveBankId,
          supplierId: effectiveSupplierId,
          currentUserId
        },
        db
      );

      setShowAddAsset(false);
      setAssetName('');
      setAssetCost('150000');
      setAssetDepreciationRate('10');
      triggerSuccessAnimation('স্থায়ী সম্পদ সংরক্ষিত হয়েছে!', res.asset.name);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleOpenEditAsset = async (ast: FixedAsset) => {
    setEditingAsset(ast);
    setEditAssetName(ast.name);
    setEditAssetCategory(ast.category);
    setEditAssetCost(String(ast.originalCost || 0));
    setEditAssetLifeYears(String(ast.usefulLifeYears || 5));
    setEditAssetSalvage(String(ast.salvageValue || 0));
    setEditAssetDepreciationRate(String(ast.depreciationRatePercent || 10));

    const check = await hasAssetPostedAccounting(ast, db);
    setEditAssetHasAccounting(check.hasAccounting);
    setEditAssetAccountingReason(check.reason || null);
  };

  const handleSaveEditAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAsset) return;

    try {
      setSubmittingEditAsset(true);
      const res = await executeEditFixedAssetTransaction(
        {
          assetId: editingAsset.id,
          name: editAssetName,
          category: editAssetCategory,
          purchaseDate: editingAsset.purchaseDate,
          originalCost: parseFloat(editAssetCost) || 0,
          usefulLifeYears: parseFloat(editAssetLifeYears) || 5,
          salvageValue: parseFloat(editAssetSalvage) || 0,
          depreciationRatePercent: parseFloat(editAssetDepreciationRate) || 10,
          currentUserId
        },
        db
      );

      setEditingAsset(null);
      triggerSuccessAnimation('স্থায়ী সম্পদ সংরক্ষিত হয়েছে!', res.updatedAsset.name);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'সম্পদ হালনাগাদ করতে ত্রুটি হয়েছে।');
    } finally {
      setSubmittingEditAsset(false);
    }
  };

  const handleRunDepreciationNow = async () => {
    setDeprLoading(true);
    setDeprFeedback(null);
    try {
      const res = await runAutomatedDepreciation(currentUserId);
      if (res.entriesPosted > 0) {
        setDeprFeedback(`সফলভাবে ${res.entriesPosted}টি অবচয় জাবেদা (মোট ৳${res.totalDepreciationAmount.toLocaleString()}) দাখিলা করা হয়েছে।`);
        triggerSuccessAnimation('অবচয় হিসাব সম্পন্ন!', `${res.entriesPosted}টি অবচয় দাখিলা পোস্ট হয়েছে`);
      } else {
        setDeprFeedback('সকল সক্রিয় স্থায়ী সম্পদের অবচয় ইতোমধ্যে হালনাগাদ রয়েছে। নতুন কোনো বকেয়া অবচয় নেই।');
        triggerSuccessAnimation('সকল অবচয় হালনাগাদ রয়েছে');
      }
      await loadData();
    } catch (err: any) {
      setDeprFeedback(`অবচয় গণনায় ত্রুটি: ${err.message}`);
    } finally {
      setDeprLoading(false);
    }
  };

  // Fixed Asset Disposal State
  const [disposingAsset, setDisposingAsset] = useState<FixedAsset | null>(null);
  const [disposalProceeds, setDisposalProceeds] = useState<string>('0');
  const [disposalPaymentMethod, setDisposalPaymentMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [disposalBankAccountId, setDisposalBankAccountId] = useState<string>('');
  const [disposalDate, setDisposalDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [disposalReason, setDisposalReason] = useState<string>('');
  const [submittingDisposal, setSubmittingDisposal] = useState<boolean>(false);

  const handleOpenDisposeAsset = (ast: FixedAsset) => {
    setDisposingAsset(ast);
    setDisposalProceeds('0');
    setDisposalPaymentMethod('CASH');
    setDisposalBankAccountId(bankAccountsList.length > 0 ? bankAccountsList[0].id : '');
    setDisposalDate(new Date().toISOString().split('T')[0]);
    setDisposalReason('');
  };

  const handleConfirmDisposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposingAsset) return;

    try {
      setSubmittingDisposal(true);
      const proceeds = Math.max(0, parseFloat(disposalProceeds) || 0);
      const dateStr = disposalDate || new Date().toISOString().split('T')[0];

      const res = await executeFixedAssetDisposalTransaction({
        assetId: disposingAsset.id,
        disposalDate: dateStr,
        disposalProceeds: proceeds,
        paymentMethod: disposalPaymentMethod,
        bankAccountId: disposalPaymentMethod === 'BANK' ? disposalBankAccountId : undefined,
        disposalReason: disposalReason.trim() || undefined,
        currentUserId
      });

      setDisposingAsset(null);
      triggerSuccessAnimation(
        'স্থায়ী সম্পদ সফলভাবে অপসারিত হয়েছে!',
        `${disposingAsset.name} (পুস্তক মূল্য: ৳${res.carryingValue})`
      );
      await loadData();
    } catch (err: any) {
      alert(err.message || 'সম্পদ অপসারণ করতে ত্রুটি হয়েছে।');
    } finally {
      setSubmittingDisposal(false);
    }
  };

  // Vaccine Templates Management State
  const [vaccineTemplates, setVaccineTemplates] = useState<VaccineTemplate[]>(() => getVaccineTemplates());
  const [showAddEditVaccineModal, setShowAddEditVaccineModal] = useState<boolean>(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [vaccineFormName, setVaccineFormName] = useState<string>('');
  const [vaccineFormIntervalDays, setVaccineFormIntervalDays] = useState<string>('180');
  const [vaccineFormAppliesTo, setVaccineFormAppliesTo] = useState<string>('');
  const [vaccineFeedbackMsg, setVaccineFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const handleTemplatesChanged = () => {
      setVaccineTemplates(getVaccineTemplates());
    };
    window.addEventListener('goted_vaccine_templates_changed', handleTemplatesChanged);
    return () => window.removeEventListener('goted_vaccine_templates_changed', handleTemplatesChanged);
  }, []);

  const handleOpenAddVaccine = () => {
    setEditingTemplateId(null);
    setVaccineFormName('');
    setVaccineFormIntervalDays('180');
    setVaccineFormAppliesTo('');
    setVaccineFeedbackMsg(null);
    setShowAddEditVaccineModal(true);
  };

  const handleOpenEditVaccine = (tpl: VaccineTemplate) => {
    setEditingTemplateId(tpl.id);
    setVaccineFormName(tpl.name);
    setVaccineFormIntervalDays(tpl.intervalDays.toString());
    setVaccineFormAppliesTo(tpl.appliesTo || '');
    setVaccineFeedbackMsg(null);
    setShowAddEditVaccineModal(true);
  };

  const handleSaveVaccineTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = vaccineFormName.trim();
    const intervalDays = parseInt(vaccineFormIntervalDays, 10);
    if (!name) {
      setVaccineFeedbackMsg({ type: 'error', text: 'টিকার নাম আবশ্যক।' });
      return;
    }
    if (isNaN(intervalDays) || intervalDays <= 0) {
      setVaccineFeedbackMsg({ type: 'error', text: 'সঠিক দিনের ব্যবধান (১ বা তার বেশি) প্রদান করুন।' });
      return;
    }

    let updatedList: VaccineTemplate[];
    if (editingTemplateId) {
      updatedList = vaccineTemplates.map((t) =>
        t.id === editingTemplateId
          ? {
              ...t,
              name,
              intervalDays,
              appliesTo: vaccineFormAppliesTo.trim() || undefined
            }
          : t
      );
      setVaccineFeedbackMsg({ type: 'success', text: 'টিকা শিডিউল সফলভাবে আপডেট করা হয়েছে।' });
    } else {
      const newTpl: VaccineTemplate = {
        id: 'vac_' + Date.now(),
        name,
        intervalDays,
        appliesTo: vaccineFormAppliesTo.trim() || undefined
      };
      updatedList = [...vaccineTemplates, newTpl];
      setVaccineFeedbackMsg({ type: 'success', text: 'নতুন টিকা সফলভাবে যুক্ত করা হয়েছে।' });
    }

    saveVaccineTemplates(updatedList);
    setVaccineTemplates(updatedList);
    setShowAddEditVaccineModal(false);
  };

  const handleDeleteVaccineTemplate = (id: string, name: string) => {
    if (window.confirm(`আপনি কি নিশ্চিতভাবে "${name}" তালিকা থেকে মুছে ফেলতে চান?`)) {
      const updatedList = vaccineTemplates.filter((t) => t.id !== id);
      saveVaccineTemplates(updatedList);
      setVaccineTemplates(updatedList);
      setVaccineFeedbackMsg({ type: 'success', text: `"${name}" তালিকা থেকে মুছে ফেলা হয়েছে।` });
    }
  };

  const handleResetVaccineDefaults = () => {
    if (window.confirm('আপনি কি পূর্বনির্ধারিত (ডিফল্ট) টিকা তালিকায় ফিরে যেতে চান? আপনার নিজস্ব পরিবর্তনসমূহ মুছে যাবে।')) {
      saveVaccineTemplates(DEFAULT_VACCINE_TEMPLATES);
      setVaccineTemplates(DEFAULT_VACCINE_TEMPLATES);
      setVaccineFeedbackMsg({ type: 'success', text: 'ডিফল্ট টিকা শিডিউল সফলভাবে পুনরুদ্ধার করা হয়েছে।' });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-5 pb-6 max-w-5xl mx-auto p-2 sm:p-4">
      {/* Header & Subtabs */}
      <div className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3.5">
            <IconTile icon={ShieldCheck} color="emerald" size="lg" rounded="xl" />
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100">
                নিরাপত্তা, স্থায়ী সম্পদ ও অডিট (System & Security)
              </h2>
              <p className="text-[14px] text-gray-600 dark:text-slate-400 mt-0.5">
                অডিট ট্রেইল, খামার মালিক তালিকা, গোপন পিন পরিবর্তন ও ফার্ম সেটিংস
              </p>
              {/* TASK 2: Small সর্বশেষ ব্যাকআপ timestamp showing last cloud sync */}
              <div
                id="more-last-backup-timestamp"
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 text-xs font-semibold shadow-2xs"
                title="ক্লাউড ফায়ারস্টোরে সর্বশেষ ডেটা সিঙ্ক ও ব্যাকআপের সময়"
              >
                <RefreshCw className="w-3 h-3 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>সর্বশেষ ব্যাকআপ: {formatBackupTimestamp(lastBackupTime)}</span>
              </div>
            </div>
          </div>

          {/* TASK 6: Clearly labeled Log out this device button */}
          <button
            id="btn-logout-device-header"
            onClick={handleLogoutDevice}
            className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[13px] font-bold flex items-center gap-2 transition-all cursor-pointer min-h-[44px] shadow-xs active:scale-95"
            title="এই ডিভাইস থেকে লগ আউট করুন (Log out this device)"
          >
            <LogOut className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>এই ডিভাইস থেকে লগ আউট করুন / Log out this device</span>
          </button>
        </div>

        <div className="w-full grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-1.5 rounded-xl text-xs sm:text-[13px] font-semibold">
          <button
            id="tab-access-logs-btn"
            type="button"
            onClick={() => setTab('accessLogs')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'accessLogs'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <UserCheck className="w-4 h-4 shrink-0" />
            <span>অ্যাক্সেস লগ</span>
          </button>
          <button
            id="tab-change-pin-btn"
            type="button"
            onClick={() => setTab('changePin')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'changePin'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>পিন পরিবর্তন</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'audit'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span>অডিট ট্রেইল</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('assets')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'assets'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0" />
            <span>স্থায়ী সম্পদ</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('owners')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'owners'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>মালিকবৃন্দ</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'settings'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Building className="w-4 h-4 shrink-0" />
            <span>ফার্ম সেটিংস</span>
          </button>
          <button
            id="tab-vaccines-btn"
            type="button"
            onClick={() => setTab('vaccines')}
            className={`col-span-3 sm:col-span-2 lg:col-span-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 px-2 py-2 rounded-lg text-center transition-all cursor-pointer min-h-[44px] font-bold ${
              tab === 'vaccines'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Syringe className="w-4 h-4 shrink-0" />
            <span>টিকা শিডিউল</span>
          </button>
        </div>
      </div>

      {/* ===================== TAB: CHANGE PIN (TASK 7) ===================== */}
      {tab === 'changePin' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-7 shadow-xs space-y-5 max-w-xl mx-auto">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                গোপন পিন পরিবর্তন করুন (Change Secret PIN)
              </h3>
              <p className="text-[13px] text-gray-500">
                শুধুমাত্র অনুমোদিত খামার মালিকদের জন্য (Owner-only)। নতুন পিন কমপক্ষে ৬ ডিজিটের হতে হবে।
              </p>
            </div>
          </div>

          {pinSuccess && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-[14px] flex items-start gap-2.5 shadow-xs"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-semibold">{pinSuccess}</div>
            </div>
          )}

          {pinError && (
            <div
              role="alert"
              className="p-4 rounded-xl bg-red-50 border border-red-300 text-red-900 text-[14px] flex items-start gap-2.5 shadow-xs"
            >
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-semibold">{pinError}</div>
            </div>
          )}

          <form onSubmit={handleChangePin} className="space-y-4">
            {/* Owner Email Selection */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                মালিকের ইমেইল (Owner Email)
              </label>
              <select
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                disabled={pinLoading}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20 text-gray-900 text-[14px] font-mono outline-none"
              >
                {ownerList.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </div>

            {/* Current PIN */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                বর্তমান গোপন পিন (Current PIN)
              </label>
              <div className="relative">
                <input
                  type={showCurrentPin ? 'text' : 'password'}
                  inputMode="numeric"
                  required
                  placeholder="বর্তমান পিন দিন..."
                  value={currentPin}
                  onChange={(e) => {
                    setCurrentPin(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  disabled={pinLoading}
                  className="w-full px-3.5 pr-11 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPin(!showCurrentPin)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                >
                  {showCurrentPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New PIN (6+ digits) */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                নতুন গোপন পিন (New PIN — 6+ digits)
              </label>
              <div className="relative">
                <input
                  type={showNewPin ? 'text' : 'password'}
                  inputMode="numeric"
                  minLength={6}
                  required
                  placeholder="নতুন ৬+ ডিজিটের পিন দিন..."
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value);
                    if (pinError) setPinError(null);
                  }}
                  disabled={pinLoading}
                  className="w-full px-3.5 pr-11 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPin(!showNewPin)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-800 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
                >
                  {showNewPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[12px] text-gray-500 mt-1">
                পিনটি অন্তত ৬ ডিজিটের হতে হবে। সার্ভারে এটি Bcrypt Cost 12 অ্যালগরিদমে হ্যাশ হিসেবে সুরক্ষিত থাকবে।
              </p>
            </div>

            {/* Confirm New PIN */}
            <div>
              <label className="block text-[13px] font-bold text-gray-800 mb-1">
                নতুন পিন নিশ্চিত করুন (Confirm New PIN)
              </label>
              <input
                type="password"
                inputMode="numeric"
                minLength={6}
                required
                placeholder="নতুন পিনটি আবার লিখুন..."
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value);
                  if (pinError) setPinError(null);
                }}
                disabled={pinLoading}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-gray-300 focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20 text-gray-900 text-[15px] font-mono tracking-wider outline-none"
              />
            </div>

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={pinLoading || !currentPin || !newPin || !confirmPin}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-900 active:scale-98 disabled:opacity-50 text-white font-bold text-[14px] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[44px]"
              >
                {pinLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>পরিবর্তন সংরক্ষণ করা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>পিন পরিবর্তন সম্পন্ন করুন (Update PIN)</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== TAB 0: APP ACCESS LOGS ===================== */}
      {tab === 'accessLogs' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                <span>অ্যাপে প্রবেশ ও ব্যবহারকারীর তালিকা (App Access & Login History)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                কে কোন ইমেইল দিয়ে গোপন পিন ব্যবহার করে অ্যাপে প্রবেশ করেছে তার বিস্তারিত বিবরণ
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={loadData}
                className="px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-gray-200 min-h-[40px]"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>রিফ্রেশ</span>
              </button>
              <span className="text-[13px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full font-mono font-bold">
                মোট প্রবেশ রেকর্ড: {accessLogs.length}
              </span>
            </div>
          </div>

          {accessLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 p-8 text-center text-gray-500 dark:text-slate-400 text-[14px] bg-gray-50/50 dark:bg-slate-900/30">
              এখনো কোনো অ্যাক্সেস লগ নেই। নতুন কেউ পিন দিয়ে লগইন করলে এখানে প্রদর্শিত হবে।
            </div>
          ) : (
            <div className="space-y-3">
              {accessLogs.map((log) => {
                const isSuccess = log.status === 'SUCCESS';
                const formattedDate = new Date(log.timestamp).toLocaleString('bn-BD', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });

                return (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-gray-300 dark:hover:border-slate-700 transition-colors shadow-2xs space-y-2.5"
                  >
                    {/* Top line: Email in bold with avatar & status badge */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 font-bold text-xs shrink-0">
                          {log.email ? log.email.charAt(0).toUpperCase() : 'U'}
                        </div>
                        <span className="font-bold text-gray-900 dark:text-slate-100 font-mono text-[14px] sm:text-[15px] truncate">
                          {log.email}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
                          {log.loginMethod === 'SECRET_PIN' ? 'গোপন পিন' : 'সংরক্ষিত সেশন'}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isSuccess
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {isSuccess ? 'সফল (Success)' : 'প্রত্যাখ্যাত (Denied)'}
                        </span>
                      </div>
                    </div>

                    {/* Stacked details: Date/Time, Device, and IP each on their own line */}
                    <div className="pt-2 border-t border-gray-100 dark:border-slate-800/80 space-y-1.5 text-xs sm:text-[13px] text-gray-600 dark:text-slate-400">
                      {/* Date / Time */}
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-700 dark:text-slate-300 w-24 shrink-0">
                          সময়:
                        </span>
                        <span className="font-mono text-gray-900 dark:text-slate-200">
                          {formattedDate}
                        </span>
                      </div>

                      {/* Device / User Agent */}
                      <div className="flex items-start gap-2">
                        <span className="font-semibold text-gray-700 dark:text-slate-300 w-24 shrink-0">
                          ডিভাইস:
                        </span>
                        <span className="text-gray-800 dark:text-slate-200 break-words flex-1">
                          {log.userAgent || 'ওয়েব ব্রাউজার (Web Browser)'}
                        </span>
                      </div>

                      {/* IP Address */}
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-700 dark:text-slate-300 w-24 shrink-0">
                          আইপি (IP):
                        </span>
                        <span className="font-mono text-gray-800 dark:text-slate-300">
                          {log.ip || '127.0.0.1 (Local)'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 1: AUDIT TRAIL ===================== */}
      {tab === 'audit' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                <span>পরিবর্তনহীন নিরাপত্তা অডিট ট্রেইল (Immutable Audit Log)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                সকল লেনদেন, মুছে ফেলা বা পরিবর্তনের তথ্য ফায়ারস্টোর ও লোকাল ডাটাবেজে অপরিবর্তনীয়ভাবে সংরক্ষিত
              </p>
            </div>
            <span className="text-[13px] text-gray-500 font-medium">সর্বশেষ {logs.length} রেকর্ড</span>
          </div>

          {/* Responsive Audit Logs Display */}
          {logs.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50/50 dark:bg-slate-900/30 rounded-xl border border-dashed border-gray-300 dark:border-slate-700">
              কোনো অডিট লগ এন্ট্রি পাওয়া যায়নি
            </div>
          ) : (
            <>
              {/* Mobile / Tablet Cards View */}
              <div className="md:hidden space-y-3">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 shadow-2xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-slate-100 text-sm">{log.entity}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          log.action === 'CREATE'
                            ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                            : log.action === 'UPDATE'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {log.action}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                      {new Date(log.timestamp).toLocaleString('bn-BD')}
                    </div>
                    {log.userId && (
                      <div className="text-xs text-gray-600 dark:text-slate-400 font-mono">
                        UID: {log.userId}
                      </div>
                    )}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="p-2 rounded-lg bg-gray-50 dark:bg-slate-800/60 text-xs font-mono text-gray-600 dark:text-slate-300 break-all">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-800">
                <table className="w-full text-left text-[14px] text-gray-800 dark:text-slate-200">
                  <thead className="bg-[#F8FAFC] dark:bg-slate-800/80 text-gray-600 dark:text-slate-400 font-semibold border-b border-gray-200 dark:border-slate-700 text-[13px]">
                    <tr>
                      <th className="p-3">সময় (Timestamp)</th>
                      <th className="p-3">অ্যাকশন</th>
                      <th className="p-3">মডিউল</th>
                      <th className="p-3">ব্যবহারকারী UID</th>
                      <th className="p-3">বিবরণ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/40">
                        <td className="p-3 font-mono text-[13px] text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              log.action === 'CREATE'
                                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                                : log.action === 'UPDATE'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="p-3 font-semibold text-gray-900 dark:text-slate-100">{log.entity}</td>
                        <td className="p-3 font-mono text-[12px] text-gray-500 dark:text-slate-400">{log.userId}</td>
                        <td className="p-3 max-w-xs truncate text-gray-600 dark:text-slate-400 font-mono text-[12px]">
                          {JSON.stringify(log.details || {})}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================== TAB 2: FIXED ASSETS ===================== */}
      {tab === 'assets' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">

          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                <span>স্থায়ী সম্পদ রেজিস্টার ও অবচয় (Fixed Assets & Depreciation)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                সরলরৈখিক অবচয় (Straight-line Depreciation) স্বয়ংক্রিয় হিসাবরক্ষণ
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                id="btn-run-depreciation-more"
                type="button"
                onClick={handleRunDepreciationNow}
                disabled={deprLoading}
                className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px] disabled:opacity-50"
              >
                <Calculator className={`w-4 h-4 text-amber-700 ${deprLoading ? 'animate-spin' : ''}`} />
                <span>{deprLoading ? 'হিসাব করা হচ্ছে...' : 'এখনই অবচয় হিসাব করুন'}</span>
              </button>
              <button
                onClick={() => setShowAddAsset(!showAddAsset)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[13px] font-bold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer min-h-[40px]"
              >
                + নতুন স্থায়ী সম্পদ
              </button>
            </div>
          </div>

          {deprFeedback && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[13px] font-medium flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{deprFeedback}</span>
              </div>
              <button
                type="button"
                onClick={() => setDeprFeedback(null)}
                className="text-xs text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {showAddAsset && (
            <form onSubmit={handleAddAsset} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-slate-800 dark:text-slate-200 text-[15px]">নতুন সম্পদ যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 dark:text-slate-300 mb-1">সম্পদের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: মিল্কিং মেশিন"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 dark:text-slate-300 mb-1">ক্যাটাগরি</label>
                  <select
                    value={assetCategory}
                    onChange={(e) => setAssetCategory(e.target.value as any)}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                  >
                    <option value="LAND">জমি ও ভূমি উন্নয়ন (1510)</option>
                    <option value="BUILDINGS">শেড ও খামার ভবন (1520)</option>
                    <option value="PONDS">পুকুর অবকাঠামো (1530)</option>
                    <option value="MACHINERY">যন্ত্রপাতি ও ইকুইপমেন্ট (1550)</option>
                    <option value="VEHICLE">যানবাহন (1550)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 dark:text-slate-300 mb-1">ক্রয়মূল্য (Cost)</label>
                  <input
                    type="number"
                    required
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 dark:text-slate-300 mb-1">আয়ুষ্কাল (বছর)</label>
                  <input
                    type="number"
                    required
                    value={assetLifeYears}
                    onChange={(e) => {
                      const l = parseFloat(e.target.value);
                      setAssetLifeYears(e.target.value);
                      if (l > 0) {
                        setAssetDepreciationRate((100 / l).toFixed(1));
                      }
                    }}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-gray-700 dark:text-slate-300 mb-1">
                    বার্ষিক অবচয় হার (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    required
                    placeholder="যেমন: 20"
                    value={assetDepreciationRate}
                    onChange={(e) => setAssetDepreciationRate(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                  />
                </div>
              </div>

              {/* Payment Source Selection (When cost > 0) */}
              {parseFloat(assetCost) > 0 && (
                <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-gray-200 dark:border-slate-700 space-y-2">
                  <div className="text-[13px] font-bold text-gray-800 dark:text-slate-200">
                    পরিশোধের উৎস (Payment Source for Journal Entry)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setAssetPaymentMethod('CASH')}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        assetPaymentMethod === 'CASH'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                          : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                      }`}
                    >
                      <Wallet className="w-4 h-4" />
                      <span>নগদ তহবিল (Cash 1010)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssetPaymentMethod('BANK');
                        if (bankAccountsList.length > 0 && !assetSelectedBankAccountId) {
                          setAssetSelectedBankAccountId(bankAccountsList[0].id);
                        }
                      }}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        assetPaymentMethod === 'BANK'
                          ? 'bg-blue-50 border-blue-500 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 ring-2 ring-blue-500/20'
                          : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                      }`}
                    >
                      <Landmark className="w-4 h-4" />
                      <span>ব্যাংক হিসাব (Bank 1030)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssetPaymentMethod('CREDIT');
                        if (suppliersList.length > 0 && !assetSelectedSupplierId) {
                          setAssetSelectedSupplierId(suppliersList[0].id);
                        }
                      }}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        assetPaymentMethod === 'CREDIT'
                          ? 'bg-amber-50 border-amber-500 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 ring-2 ring-amber-500/20'
                          : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      <span>বাকি / দেনা (AP 2010)</span>
                    </button>
                  </div>

                  {assetPaymentMethod === 'BANK' && (
                    <div className="pt-1">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        ব্যাংক অ্যাকাউন্ট নির্বাচন করুন
                      </label>
                      <select
                        value={assetSelectedBankAccountId}
                        onChange={(e) => setAssetSelectedBankAccountId(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      >
                        {bankAccountsList.length === 0 && <option value="">কোনো সক্রিয় ব্যাংক অ্যাকাউন্ট পাওয়া যায়নি</option>}
                        {bankAccountsList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.accountNumber || 'সাধারণ'}) — বর্তমান স্থিতি: ৳{b.currentBalance?.toLocaleString() || 0}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {assetPaymentMethod === 'CREDIT' && (
                    <div className="pt-1">
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        সরবরাহকারী নির্বাচন করুন (Accounts Payable)
                      </label>
                      <select
                        value={assetSelectedSupplierId}
                        onChange={(e) => setAssetSelectedSupplierId(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      >
                        {suppliersList.length === 0 && <option value="">কোনো সরবরাহকারী পাওয়া যায়নি (ডিফল্ট পাওনাদার ব্যবহার হবে)</option>}
                        {suppliersList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.phone || 'সরবরাহকারী'}) — পূর্ব দেনা: ৳{s.balance?.toLocaleString() || 0}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddAsset(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm transition-colors"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((ast, idx) => {
              const deprParams = calculateAssetDepreciationParameters(
                ast.originalCost,
                ast.salvageValue,
                ast.usefulLifeYears,
                ast.depreciationRatePercent
              );
              const rate = deprParams.depreciationRatePercent;
              const monthly = deprParams.monthlyDepreciation;
              return (
                <div
                  key={ast.id}
                  style={{ animationDelay: `${Math.min(idx * 35, 350)}ms` }}
                  className="p-4 rounded-2xl bg-white border border-gray-200 hover:border-gray-300 space-y-3 shadow-xs animate-fade-slide-up flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Standardized Aspect-Video Media Card */}
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-gray-100 dark:border-slate-700/60 shrink-0 flex items-center justify-center">
                      {ast.photoUrl ? (
                        <img
                          src={ast.photoUrl}
                          alt={ast.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500">
                          <Tractor className="w-10 h-10 text-slate-400 mb-1 stroke-[1.5]" />
                          <span className="text-[11px] font-semibold text-slate-500">{ast.category}</span>
                        </div>
                      )}
                      <div className="absolute top-2.5 right-2.5">
                        <span className="px-2.5 py-1 rounded-full bg-white/95 dark:bg-slate-900/90 backdrop-blur-xs border border-gray-200 text-xs font-bold text-gray-800 shadow-xs">
                          {ast.usefulLifeYears} বছর ({rate}%/বছর)
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-gray-900 text-[15px]">{ast.name}</h4>
                          {(ast as any).status === 'DISPOSED' && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300">
                              অপসারিত (DISPOSED)
                            </span>
                          )}
                        </div>
                        <span className="text-[12px] text-gray-500 font-mono">{ast.id} | {ast.category}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEditAsset(ast)}
                          className="p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 transition-all cursor-pointer"
                          title="সম্পদ ও ক্রয়মূল্য সম্পাদনা করুন"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {(ast as any).status !== 'DISPOSED' && (
                          <button
                            type="button"
                            onClick={() => handleOpenDisposeAsset(ast)}
                            className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition-all cursor-pointer text-xs font-bold flex items-center gap-1"
                            title="স্থায়ী সম্পদ অপসারণ / বিক্রয় (Dispose Asset)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>অপসারণ</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2.5 border-t border-gray-200 font-mono text-[13px]">
                    {(ast as any).status === 'DISPOSED' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">মূল ক্রয়মূল্য (পূর্বে):</span>
                          <span className="text-gray-900 font-semibold line-through">{fmt((ast as any).disposedOriginalCost || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">অবলোপিত অবচয়:</span>
                          <span className="text-gray-500 font-semibold">{fmt((ast as any).disposedAccumulatedDepreciation || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">বিক্রয়লব্ধ মূল্য:</span>
                          <span className="text-emerald-700 font-semibold">{fmt((ast as any).disposalProceeds || 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">বিক্রয়জনিত লাভ/ক্ষতি:</span>
                          <span className={`font-semibold ${((ast as any).gainLossOnDisposal || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {((ast as any).gainLossOnDisposal || 0) >= 0 ? `লাভ ${fmt((ast as any).gainLossOnDisposal || 0)}` : `ক্ষতি ${fmt(Math.abs((ast as any).gainLossOnDisposal || 0))}`}
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-gray-500 pt-1.5 border-t border-gray-200">
                          <span className="font-sans">সক্রিয় ব্যালেন্স শিট প্রভাব:</span>
                          <span className="text-emerald-600">৳০.০০ (বাতিল)</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                          <span className="font-sans">অপসারণ তারিখ:</span>
                          <span>{(ast as any).disposalDate || 'অপসারিত'}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">মূল ক্রয়মূল্য:</span>
                          <span className="text-gray-900 font-semibold">{fmt(ast.originalCost)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">মাসিক অবচয় হার:</span>
                          <span className="text-amber-700 font-semibold">{fmt(monthly)}/মাস</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans text-gray-600">পুঞ্জীভূত অবচয় (1590):</span>
                          <span className="text-red-600 font-semibold">{fmt(ast.accumulatedDepreciation)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-[#15803D] pt-1.5 border-t border-gray-200">
                          <span className="font-sans text-gray-900">বর্তমান পুস্তক মূল্য:</span>
                          <span>{fmt(ast.currentBookValue)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                          <span className="font-sans">সর্বশেষ অবচয় হিসাব:</span>
                          <span>{ast.lastDepreciationDate || ast.purchaseDate || 'হিসাব হয়নি'}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Edit Asset Modal */}
          {editingAsset && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-xl animate-fade-in">
                <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-slate-100 text-base">
                      স্থায়ী সম্পদ তথ্য ও ক্রয়মূল্য সমন্বয়
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      আইডি: {editingAsset.id} | পূর্ববর্তী মূল ক্রয়মূল্য: ৳{editingAsset.originalCost?.toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingAsset(null)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 text-lg font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveEditAsset} className="space-y-3">
                  {editAssetHasAccounting ? (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
                      <span className="text-sm shrink-0 mt-0.5">🔒</span>
                      <div className="space-y-1">
                        <p className="font-bold">হিসাবরক্ষণ সুরক্ষানীতি সক্রিয় (Posted Accounting Protected)</p>
                        <p className="text-[11px] leading-relaxed">
                          {editAssetAccountingReason || 'এই সম্পদের জন্য সাধারণ খতিয়ানে জাবেদা বা অবচয় হিসাব পোস্ট করা হয়েছে।'}
                        </p>
                        <p className="text-[11px] text-amber-800 dark:text-amber-400">
                          ঐতিহাসিক তথ্যের নির্ভুলতা ও সাধারণ খতিয়ানের সামঞ্জস্য রক্ষার্থে ক্রয়মূল্য, ক্যাটাগরি, অর্জনের তারিখ, আয়ুষ্কাল, ভগ্নাবশেষ মূল্য এবং অবচয় হার পরিবর্তন লক করা হয়েছে। কেবল সম্পদের নাম বা বিবরণ সংশোধন করা যাবে।
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl text-xs text-blue-900 dark:text-blue-300">
                      ℹ️ এই খসড়া সম্পদের কোনো হিসাব বা অবচয় পোস্ট করা হয়নি। সকল তথ্য সংশোধনযোগ্য।
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      সম্পদের নাম
                    </label>
                    <input
                      type="text"
                      required
                      value={editAssetName}
                      onChange={(e) => setEditAssetName(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        ক্যাটাগরি {editAssetHasAccounting && <span className="text-amber-600 dark:text-amber-400 text-[10px] font-normal">(লক করা)</span>}
                      </label>
                      <select
                        value={editAssetCategory}
                        disabled={editAssetHasAccounting}
                        onChange={(e) => setEditAssetCategory(e.target.value as any)}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-slate-400 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      >
                        <option value="LAND">জমি ও ভূমি উন্নয়ন (1510)</option>
                        <option value="BUILDINGS">শেড ও খামার ভবন (1520)</option>
                        <option value="PONDS">পুকুর অবকাঠামো (1530)</option>
                        <option value="MACHINERY">যন্ত্রপাতি ও ইকুইপমেন্ট (1550)</option>
                        <option value="VEHICLE">যানবাহন (1550)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        মূল ক্রয়মূল্য (৳) {editAssetHasAccounting && <span className="text-amber-600 dark:text-amber-400 text-[10px] font-normal">(লক করা)</span>}
                      </label>
                      <input
                        type="number"
                        required
                        disabled={editAssetHasAccounting}
                        value={editAssetCost}
                        onChange={(e) => setEditAssetCost(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] font-mono text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-slate-400 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        আয়ুষ্কাল (বছর) {editAssetHasAccounting && <span className="text-amber-600 dark:text-amber-400 text-[10px] font-normal">(লক)</span>}
                      </label>
                      <input
                        type="number"
                        disabled={editAssetHasAccounting}
                        value={editAssetLifeYears}
                        onChange={(e) => {
                          const l = parseFloat(e.target.value);
                          setEditAssetLifeYears(e.target.value);
                          if (l > 0) {
                            setEditAssetDepreciationRate((100 / l).toFixed(1));
                          }
                        }}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-slate-400 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        ভগ্নাবশেষ মূল্য (৳) {editAssetHasAccounting && <span className="text-amber-600 dark:text-amber-400 text-[10px] font-normal">(লক)</span>}
                      </label>
                      <input
                        type="number"
                        disabled={editAssetHasAccounting}
                        value={editAssetSalvage}
                        onChange={(e) => setEditAssetSalvage(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-slate-400 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        অবচয় হার (%) {editAssetHasAccounting && <span className="text-amber-600 dark:text-amber-400 text-[10px] font-normal">(লক)</span>}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        disabled={editAssetHasAccounting}
                        value={editAssetDepreciationRate}
                        onChange={(e) => setEditAssetDepreciationRate(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 disabled:bg-gray-100 dark:disabled:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-gray-500 dark:disabled:text-slate-400 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditingAsset(null)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-xs font-semibold cursor-pointer min-h-[44px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingEditAsset}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 min-h-[44px] transition-colors"
                    >
                      {submittingEditAsset ? 'সংরক্ষণ হচ্ছে...' : 'হালনাগাদ সম্পন্ন করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Dispose Asset Modal */}
          {disposingAsset && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-xl animate-fade-in">
                <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-slate-100 text-base flex items-center gap-2">
                      <Trash2 className="w-5 h-5 text-rose-600" />
                      <span>স্থায়ী সম্পদ অপসারণ ও বিক্রয় (Dispose Asset)</span>
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      সম্পদটি ব্যালেন্স শিট হতে অবলোপন করা হবে এবং লাভ/ক্ষতি হিসাবভুক্ত হবে
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDisposingAsset(null)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {(() => {
                  const cost = Number(disposingAsset.originalCost || (disposingAsset as any).disposedOriginalCost || 0);
                  const accum = Number(disposingAsset.accumulatedDepreciation || (disposingAsset as any).disposedAccumulatedDepreciation || 0);
                  const carryingValue = Math.round(Math.max(0, cost - accum) * 100) / 100;
                  const proceeds = Math.max(0, parseFloat(disposalProceeds) || 0);
                  const gainLoss = Math.round((proceeds - carryingValue) * 100) / 100;

                  return (
                    <form onSubmit={handleConfirmDisposal} className="space-y-4">
                      {/* Asset Summary */}
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">সম্পদের নাম:</span>
                          <span className="font-bold text-gray-900 dark:text-slate-100">{disposingAsset.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">ক্যাটাগরি:</span>
                          <span className="text-gray-700 dark:text-slate-300 font-mono">{disposingAsset.category}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-gray-200/60 dark:border-slate-700/60">
                          <span className="text-gray-500">মূল ক্রয়মূল্য (Historical Cost):</span>
                          <span className="font-semibold text-gray-900 dark:text-slate-100 font-mono">৳{cost.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">পুঞ্জীভূত অবচয় (Accumulated Depreciation):</span>
                          <span className="font-semibold text-rose-600 font-mono">৳{accum.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-gray-200/60 dark:border-slate-700/60 font-bold">
                          <span className="text-gray-900 dark:text-slate-100">বহনকারী / পুস্তক মূল্য (Carrying Value):</span>
                          <span className="text-emerald-700 dark:text-emerald-400 font-mono">৳{carryingValue.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Inputs: Proceeds, Method, Date */}
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                            বিক্রয়লব্ধ অর্থ / বিক্রয়মূল্য (Sale Proceeds ৳)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            value={disposalProceeds}
                            onChange={(e) => setDisposalProceeds(e.target.value)}
                            className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono font-bold min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                            placeholder="0.00"
                          />
                          <p className="text-[11px] text-gray-500 mt-0.5">সম্পদটি অকেজো হয়ে গেলে বা মূল্য না পেলে 0 লিখুন।</p>
                        </div>

                        {proceeds > 0 && (
                          <div className="space-y-2 p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-700">
                            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300">
                              অর্থ প্রাপ্তির মাধ্যম (Payment Method)
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setDisposalPaymentMethod('CASH')}
                                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer flex items-center justify-center gap-1.5 transition-all ${
                                  disposalPaymentMethod === 'CASH'
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 ring-2 ring-emerald-500/20'
                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                                }`}
                              >
                                <Wallet className="w-4 h-4" />
                                <span>নগদ (Cash 1010)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDisposalPaymentMethod('BANK');
                                  if (bankAccountsList.length > 0 && !disposalBankAccountId) {
                                    setDisposalBankAccountId(bankAccountsList[0].id);
                                  }
                                }}
                                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer flex items-center justify-center gap-1.5 transition-all ${
                                  disposalPaymentMethod === 'BANK'
                                    ? 'bg-blue-50 border-blue-500 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 ring-2 ring-blue-500/20'
                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                                }`}
                              >
                                <Landmark className="w-4 h-4" />
                                <span>ব্যাংক (Bank 1030)</span>
                              </button>
                            </div>

                            {disposalPaymentMethod === 'BANK' && (
                              <div className="pt-1">
                                <label className="block text-[11px] font-semibold text-gray-600 dark:text-slate-400 mb-1">
                                  ব্যাংক অ্যাকাউন্ট
                                </label>
                                <select
                                  value={disposalBankAccountId}
                                  onChange={(e) => setDisposalBankAccountId(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                                >
                                  {bankAccountsList.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.name} ({b.accountNumber || 'সাধারণ'})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                              অপসারণের তারিখ
                            </label>
                            <input
                              type="date"
                              required
                              value={disposalDate}
                              onChange={(e) => setDisposalDate(e.target.value)}
                              className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                              অপসারণের কারণ / বিবরণ
                            </label>
                            <input
                              type="text"
                              value={disposalReason}
                              onChange={(e) => setDisposalReason(e.target.value)}
                              placeholder="যেমন: মেয়াদোত্তীর্ণ বা অকেজো বিক্রয়"
                              className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-500/20"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Gain / Loss live calculation box */}
                      <div
                        className={`p-3 rounded-xl border text-xs space-y-1 ${
                          gainLoss > 0
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                            : gainLoss < 0
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                            : 'bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex justify-between items-center font-bold text-[13px]">
                          <span>হিসাবভুক্ত লাভ / ক্ষতি (Gain/Loss):</span>
                          <span className="font-mono">
                            {gainLoss > 0
                              ? `+ ৳${gainLoss.toLocaleString()} (লাভ — Gain on Disposal)`
                              : gainLoss < 0
                              ? `- ৳${Math.abs(gainLoss).toLocaleString()} (ক্ষতি — Loss on Disposal)`
                              : '৳০.০০ (লাভ বা ক্ষতি নেই)'}
                          </span>
                        </div>
                        <p className="text-[11px] opacity-80 pt-0.5">
                          {gainLoss >= 0
                            ? 'উক্ত লাভটি "Gain/Loss on Asset Disposal" (7020) অ্যাকাউন্টে ক্রেডিট করা হবে।'
                            : 'উক্ত ক্ষতিটি "Gain/Loss on Asset Disposal" (7020) অ্যাকাউন্টে ডেবিট করা হবে।'}
                        </p>
                      </div>

                      <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-900 dark:text-amber-300">
                        ⚠️ নিশ্চিতকরণ: অপসারিত সম্পদের ক্রয়মূল্য ও পুঞ্জীভূত অবচয় সমন্বয় জাবেদার মাধ্যমে সক্রিয় ব্যালেন্স শিট হতে সম্পূর্ণ বাদ দেওয়া হবে।
                      </div>

                      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => setDisposingAsset(null)}
                          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-xs font-semibold cursor-pointer min-h-[44px]"
                        >
                          বাতিল
                        </button>
                        <button
                          type="submit"
                          disabled={submittingDisposal}
                          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 min-h-[44px] transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{submittingDisposal ? 'অপসারণ প্রক্রিয়াধীন...' : 'অপসারণ নিশ্চিত করুন'}</span>
                        </button>
                      </div>
                    </form>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    )}

      {/* ===================== TAB 3: AUTHORIZED OWNERS ===================== */}
      {tab === 'owners' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                <span>The Goated Farm — অনুমোদিত মালিক তালিকা (Authorized Owners)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                একক-মালিকানা খামার (Single-Tenant Farm)। শুধুমাত্র নির্ধারিত ৪ জন অনুমোদিত মালিক পিন মাধ্যমে প্রবেশাধিকার পাবেন।
              </p>
            </div>

            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#15803D]" />
              <span>নিরাপদ এলাও-লিস্ট</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {ownerList.map((email, idx) => (
              <div
                key={email}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 font-bold text-sm">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-[14px] font-mono flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-gray-500" />
                      <span>{email}</span>
                    </div>
                    <p className="text-[12px] text-[#15803D] font-medium mt-0.5">
                      পূর্ণ কর্তৃত্ব ও স্বাক্ষরকারী মালিক (Owner)
                    </p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>সক্রিয়</span>
                </span>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 text-[13px] text-gray-600 space-y-1.5">
            <p className="font-bold text-gray-900">নিরাপত্তা ও অ্যাক্সেস পলিসি:</p>
            <p>• ব্যবহারকারীকে তার ইমেইল প্রদান করতে হবে এবং মাস্টার সিক্রেট পিন দিয়ে প্রবেশ করতে হবে।</p>
            <p>• প্রতিটি লগইন ও অ্যাক্সেস প্রচেষ্টা অডিট লগে রেকর্ড থাকে, যা উপরের "কে কে অ্যাপ ব্যবহার করছে" ট্যাবে দেখা যাবে।</p>
            <p>• সঠিক এনক্রিপ্টেড পিন ব্যতীত কেউ সিস্টেমে কোনো অবস্থাতেই প্রবেশ করতে পারবে না।</p>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: SETTINGS ===================== */}
      {tab === 'settings' && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 max-w-xl mx-auto shadow-xs transition-colors">
          <div className="flex items-center gap-3 border-b border-gray-100 dark:border-slate-800 pb-4">
            <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <Building className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-slate-100 text-lg">
                {systemConfig?.companyName || 'The Goated Farm'}
              </h3>
              <p className="text-[13px] text-gray-500 dark:text-slate-400">
                {systemConfig?.companyAddress || 'ঢাকা, বাংলাদেশ'}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-[14px] text-gray-700 dark:text-slate-300">
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">খামার আর্কিটেকচার:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">একক মালিকানা (Single Tenant)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">অনুমোদিত মালিক সংখ্যা:</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-slate-100">৪ জন সক্রিয় অংশীদার</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">যোগাযোগ নম্বর (Phone):</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{farmPhone ? farmPhone : 'নির্ধারণ করা হয়নি (Not set)'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">মুদ্রা (Currency):</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{systemConfig?.currency || '৳'} (BDT)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">প্রমাণীকরণ পদ্ধতি:</span>
              <span className="semibold text-gray-900 dark:text-slate-100">সার্ভার-সাইড Bcrypt হ্যাশ যাচাইকরণ (Bcrypt Hashed PIN)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">সিক্রেট পিন নিরাপত্তা:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">•••••• (Bcrypt Cost 12 Secured)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-gray-500 dark:text-slate-400">ইনিশিয়ালাইজেশন:</span>
              <span className="font-mono text-gray-600 dark:text-slate-400">The Goated Farm Enterprise</span>
            </div>
          </div>

          {/* ডার্ক মোড / Dark Mode Setting */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[14px] flex items-center gap-1.5">
                    <Moon className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                    <span>ডার্ক মোড (Dark Mode)</span>
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    কম আলোতে বা রাতে খামার ব্যবহারের সুবিধার্থে ডার্ক মোড সক্রিয় করুন (Enable dark mode for night usage)
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    id="toggle-dark-mode"
                    checked={isDarkMode}
                    onChange={(e) => handleToggleDarkMode(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-800 dark:peer-checked:bg-slate-600"></div>
                </label>
              </div>
            </div>
          </div>

          {/* ভাষা / Language Setting */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[14px] flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                    <span>ভাষা / Language</span>
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    অ্যাপের দৃশ্যমান লেখার ভাষা পরিবর্তন করুন (Change app display language)
                  </p>
                </div>

                <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-gray-300 dark:border-slate-700 shadow-2xs self-start sm:self-auto">
                  <button
                    type="button"
                    id="btn-lang-bn"
                    onClick={() => setLanguage('bn')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                      currentLanguage === 'bn'
                        ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-xs'
                        : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    বাংলা (ডিফল্ট)
                  </button>
                  <button
                    type="button"
                    id="btn-lang-en"
                    onClick={() => setLanguage('en')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[36px] ${
                      currentLanguage === 'en'
                        ? 'bg-slate-800 dark:bg-slate-700 text-white shadow-xs'
                        : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ভ্যাট/টিন নিবন্ধন সেটিংস (VAT/TIN Registered Business Toggle) */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[14px] flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                    <span>ভ্যাট/টিন নিবন্ধিত ব্যবসা (VAT/TIN Registered Business)</span>
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    ব্যবসায়িক ভ্যাট বা কর নিবন্ধন থাকলে সক্রিয় করুন। এটি সক্রিয় থাকলে আর্থিক প্রতিবেদন মডিউলে "ভ্যাট সারাংশ" প্রদর্শিত হবে।
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    id="toggle-vat-registered"
                    checked={isVatRegistered}
                    onChange={(e) => handleToggleVat(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-300 dark:bg-slate-600 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-800 dark:peer-checked:bg-slate-600"></div>
                </label>
              </div>

              {/* Only when toggle is ON, show TIN/BIN-related fields */}
              {isVatRegistered && (
                <div className="pt-3 border-t border-gray-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      ই-টিন নম্বর (e-TIN Number)
                    </label>
                    <input
                      type="text"
                      id="input-tin-number"
                      placeholder="যেমন: ১২৩৪৫৬৭৮৯১০১"
                      value={tinNumber}
                      onChange={(e) => handleTinChange(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      বিআইএন / ভ্যাট নিবন্ধন নম্বর (BIN / VAT Reg No.)
                    </label>
                    <input
                      type="text"
                      id="input-bin-number"
                      placeholder="যেমন: ০০১২৩৪৫৬৭-০১০১"
                      value={binNumber}
                      onChange={(e) => handleBinChange(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* খামারের ফোন নম্বর / Farm Phone Number */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[14px] flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                  <span>খামারের যোগাযোগ নম্বর (Owner / Farm Phone)</span>
                </h4>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                খামার বা মালিকের অফিসিয়াল ফোন নম্বর (ঐচ্ছিক ক্ষেত্র, সেটিংস থেকে পূরণযোগ্য)
              </p>
              <input
                type="tel"
                id="input-farm-phone"
                placeholder="যেমন: +৮৮০ ১৭XXXXXXXXX (খামারের ফোন নম্বর লিখুন)"
                value={farmPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
              />
            </div>
          </div>

          {/* নগদ সতর্কতা সীমা (Low Cash Alert Threshold) */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-gray-900 dark:text-slate-100 text-[14px] flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                  <span>নগদ সতর্কতা সীমা (Low Cash Alert Threshold)</span>
                </h4>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono">
                  ডিফল্ট: ৳৫,০০০
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                নগদ এবং ব্যাংক জমার সম্মিলিত ব্যালেন্স এই সীমার নিচে নামলে ড্যাশবোর্ডে সতর্কতা ব্যানার প্রদর্শিত হবে (Show warning banner on dashboard if combined cash + bank balance falls below this limit)
              </p>
              <div className="relative max-w-xs">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500 dark:text-slate-400 font-bold">
                  ৳
                </span>
                <input
                  type="number"
                  id="input-low-cash-alert-threshold"
                  min="0"
                  step="500"
                  placeholder="5000"
                  value={lowCashAlertThreshold}
                  onChange={(e) => handleLowCashAlertThresholdChange(parseFloat(e.target.value) || 0)}
                  className="w-full pl-8 pr-3.5 py-2.5 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-700 rounded-xl text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 font-mono min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                />
              </div>
            </div>
          </div>

          {/* TASK 6: Prominent Logout Button in Settings */}
          <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
            <button
              id="btn-logout-device-settings"
              onClick={handleLogoutDevice}
              className="w-full py-3 px-4 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-700 text-[14px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs active:scale-98"
            >
              <LogOut className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              <span>এই ডিভাইস থেকে লগ আউট করুন / Log out this device</span>
            </button>
            <p className="text-[12px] text-gray-500 dark:text-slate-400 text-center mt-2">
              লগ আউট করলে এই ডিভাইসে সংরক্ষিত সেশন মুছে যাবে এবং পুনরায় প্রবেশ করতে ইমেইল ও গোপন পিন প্রয়োজন হবে।
            </p>
          </div>

          {/* DANGER ZONE: Erase All Data & Start Fresh */}
          <div className="pt-6 border-t-2 border-dashed border-red-200 dark:border-red-900/60">
            <div className="p-5 rounded-2xl bg-red-50/80 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-900/70 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[15px] font-bold text-red-900 dark:text-red-200 flex items-center gap-2">
                    <span>বিপদজনক অঞ্চল (Danger Zone)</span>
                  </h4>
                  <p className="text-[13px] text-red-800/90 dark:text-red-300/90 mt-0.5 leading-relaxed">
                    এই অপশনটি শুধুমাত্র খামার পুনরায় শূন্য থেকে সেটআপ করার জন্য। এটি আপনার সমস্ত স্থানীয় ও ক্লাউড ডেটা স্থায়ীভাবে মুছে ফেলবে।
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  id="btn-open-wipe-all-data-modal"
                  onClick={() => {
                    setWipeConfirmInput('');
                    setWipeError(null);
                    setShowWipeModal(true);
                  }}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-[14px] font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-98"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>সব ডেটা মুছে নতুন করে শুরু করুন (Erase All Data & Start Fresh)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wipe All Data Confirmation Modal */}
      {showWipeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border-2 border-red-300 dark:border-red-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3 border-b border-gray-100 dark:border-slate-800 pb-4">
              <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/80 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                  সব ডেটা মুছে নতুন করে শুরু করতে চান?
                </h3>
                <p className="text-xs text-red-600 dark:text-red-400 font-semibold mt-0.5">
                  সতর্কতা: এই ক্রিয়াটি স্থায়ী এবং অপরিবর্তনীয়!
                </p>
              </div>
              <button
                type="button"
                onClick={() => !wipeLoading && setShowWipeModal(false)}
                disabled={wipeLoading}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 p-1.5 rounded-lg cursor-pointer disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[13px] text-gray-700 dark:text-slate-300 leading-relaxed">
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-900 dark:text-red-200 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-red-600 shrink-0" />
                  <span>স্থায়ীভাবে মুছে ফেলা হবে:</span>
                </p>
                <ul className="list-disc list-inside text-xs space-y-1 pl-1 text-red-800 dark:text-red-300">
                  <li>সকল গবাদিপশু, ঘটনা, চিকিৎসা ও ওজন রেকর্ড</li>
                  <li>সকল মৎস্য ব্যাচ, পুকুর ও শস্য চক্রের তথ্য</li>
                  <li>দ্বৈত-দাখিলার সকল জাবেদা, ভাউচার ও হিসাবকাল সমাপনী</li>
                  <li>সকল বিক্রয়, ক্রয়, মজুদ পণ্য ও খতিয়ান পার্টি</li>
                  <li>সকল স্থায়ী সম্পদ, ঋণ, বিনিয়োগকারী ও রিমাইন্ডার</li>
                  <li>এই ডিভাইসের স্থানীয় ডেটাবেজ এবং ক্লাউড ফায়ারস্টোর উভয় স্থান থেকেই মুছে যাবে</li>
                </ul>
              </div>

              <div className="space-y-2 pt-1">
                <label className="block font-semibold text-gray-900 dark:text-slate-100">
                  নিশ্চিত করতে নিচে হুবহু <span className="font-bold text-red-600 dark:text-red-400 font-mono text-[14px]">"মুছুন"</span> শব্দটি লিখুন:
                </label>
                <input
                  type="text"
                  id="input-wipe-confirm-text"
                  autoFocus
                  disabled={wipeLoading}
                  value={wipeConfirmInput}
                  onChange={(e) => {
                    setWipeConfirmInput(e.target.value);
                    if (wipeError) setWipeError(null);
                  }}
                  placeholder="মুছুন"
                  className="w-full p-3 bg-white dark:bg-slate-800 border-2 border-red-300 dark:border-red-800 focus:border-red-600 rounded-xl text-base font-semibold text-gray-900 dark:text-slate-100 text-center tracking-wide"
                />
              </div>

              {wipeError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{wipeError}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-slate-800">
              <button
                type="button"
                disabled={wipeLoading}
                onClick={() => setShowWipeModal(false)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-[13px] font-semibold transition-all cursor-pointer disabled:opacity-50 min-h-[44px]"
              >
                বাতিল
              </button>
              <button
                type="button"
                id="btn-confirm-wipe-all-data-execute"
                disabled={wipeConfirmInput.trim() !== 'মুছুন' || wipeLoading}
                onClick={handleExecuteWipeAllData}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-bold shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 min-h-[44px]"
              >
                {wipeLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>সব ডেটা মোছা হচ্ছে...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>স্থায়ীভাবে সব ডেটা মুছুন</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB: VACCINE SCHEDULE LIBRARY ===================== */}
      {tab === 'vaccines' && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Syringe className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                  <span>টিকা শিডিউল লাইব্রেরি (Vaccine Schedule Library)</span>
                </h3>
                <p className="text-[13px] text-gray-600 dark:text-slate-400">
                  ফার্ম অপারেশন্সে স্বয়ংক্রিয়ভাবে পরবর্তী ডোজের তারিখ হিসাবের জন্য টিকার সময়সীমা কনফিগার করুন
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                id="btn-reset-vaccines-default"
                onClick={handleResetVaccineDefaults}
                className="px-3 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs"
                title="ডিফল্ট তালিকায় ফিরে যান"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ডিফল্ট রিকভারি</span>
              </button>
              <button
                type="button"
                id="btn-add-vaccine-template"
                onClick={handleOpenAddVaccine}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[13px] font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>নতুন টিকা যোগ করুন</span>
              </button>
            </div>
          </div>

          {/* Operational Guidance Notice */}
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-[12px] leading-relaxed">
            <p className="font-semibold flex items-center gap-1.5 mb-0.5">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>ব্যবহার নির্দেশিকা ও পরামর্শ:</span>
            </p>
            <p>
              এখানে নির্ধারিত ব্যবধানগুলো যুক্তিসঙ্গত ডিফল্ট সময়সূচি হিসেবে প্রস্তুত করা হয়েছে। প্রতিটি খামারের ভৌগোলিক অবস্থান, প্রাণীর প্রজাতি এবং আপনার স্থানীয় রেজিস্ট্রার্ড ভেটেরিনারি চিকিৎসকের পরামর্শ অনুযায়ী ব্যবধানের দিনগুলো পরিবর্তন করে আপনার ফার্মের উপযোগী করে নিতে পারেন (কোনো প্রকার ডাক্তারি পরামর্শ নয়)।
            </p>
          </div>

          {vaccineFeedbackMsg && (
            <div
              className={`p-3 rounded-xl text-[13px] font-medium border ${
                vaccineFeedbackMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
              }`}
            >
              {vaccineFeedbackMsg.text}
            </div>
          )}

          {/* List of Vaccines */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {vaccineTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-2xs hover:border-gray-300 dark:hover:border-slate-700 flex flex-col justify-between gap-3 transition-all"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-[15px] font-bold text-gray-900 dark:text-slate-100">
                      {tpl.name}
                    </h4>
                    <span className="shrink-0 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 font-mono text-xs font-bold border border-blue-200 dark:border-blue-800">
                      প্রতি {tpl.intervalDays} দিন পর
                    </span>
                  </div>

                  {tpl.appliesTo && (
                    <p className="text-[12px] text-gray-600 dark:text-slate-400 mt-1.5">
                      <span className="font-semibold text-gray-700 dark:text-slate-300">প্রযোজ্য:</span> {tpl.appliesTo}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleOpenEditVaccine(tpl)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-[12px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>সম্পাদনা</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteVaccineTemplate(tpl.id, tpl.name)}
                    className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-[12px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>মুছুন</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add / Edit Vaccine Template Modal */}
          {showAddEditVaccineModal && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
                  <h3 className="text-base font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    <Syringe className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                    <span>{editingTemplateId ? 'টিকা সম্পাদনা করুন' : 'নতুন টিকা যুক্ত করুন'}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddEditVaccineModal(false)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveVaccineTemplate} className="space-y-4">
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      টিকার নাম (Vaccine Name) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="যেমন: ক্ষুরারোগ টিকা (FMD)"
                      value={vaccineFormName}
                      onChange={(e) => setVaccineFormName(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      পরবর্তী ডোজের ব্যবধান (Interval in Days) *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        min="1"
                        step="1"
                        placeholder="১৮০"
                        value={vaccineFormIntervalDays}
                        onChange={(e) => setVaccineFormIntervalDays(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 pr-16 text-sm sm:text-[15px] font-mono text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                      />
                      <span className="absolute right-3.5 top-3 text-xs text-gray-500 dark:text-slate-400 font-semibold pointer-events-none">
                        দিন পর পর
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                      টিকা দেওয়ার পর এই সংখ্যক দিন যোগ করে পরবর্তী তারিখ স্বয়ংক্রিয়ভাবে প্রস্তাব করা হবে।
                    </p>
                  </div>

                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 dark:text-slate-300 mb-1">
                      প্রযোজ্য প্রজাতি / পশু (Applies To)
                    </label>
                    <input
                      type="text"
                      placeholder="যেমন: গরু / মহিষ / ছাগল / ভেড়া"
                      value={vaccineFormAppliesTo}
                      onChange={(e) => setVaccineFormAppliesTo(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 dark:text-slate-100 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-slate-600/20 focus:border-slate-600"
                    />
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5 pt-3 border-t border-gray-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowAddEditVaccineModal(false)}
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[13px] font-bold cursor-pointer shadow-xs transition-all active:scale-95 min-h-[44px]"
                    >
                      সংরক্ষণ করুন
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================== GENERAL NAVIGATION SHORTCUTS SECTION ===================== */}
      <div className="relative z-10 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
              <span>শর্টকাট (Shortcuts)</span>
            </h3>
            <p className="text-[13px] text-gray-500 dark:text-slate-400 mt-0.5">
              খামারের যেকোনো মডিউলে সরাসরি প্রবেশ করতে নিচের কার্ডে ট্যাপ করুন
            </p>
          </div>
          <span className="self-start sm:self-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            ৭টি প্রধান বিভাগ
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {MAIN_MODULES.map((mod) => {
            const isCurrent = mod.id === 'more';
            return (
              <button
                key={mod.id}
                id={`btn-module-select-${mod.id}`}
                type="button"
                onClick={() => onNavigate && onNavigate(mod.id)}
                className={`flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all cursor-pointer min-h-[64px] active:scale-[0.98] ${
                  isCurrent
                    ? 'bg-slate-50 dark:bg-slate-800/90 border-slate-300 dark:border-slate-600 ring-2 ring-slate-400/30 shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 hover:shadow-xs'
                }`}
              >
                <IconTile
                  icon={mod.icon}
                  color={mod.color}
                  size="md"
                  rounded="xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">
                      {mod.nameBn}
                    </span>
                    {isCurrent ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
                        বর্তমান
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase shrink-0">
                        প্রবেশ
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-slate-400 block truncate mt-0.5">
                    {mod.nameEn}
                  </span>
                  <span className="text-[11px] text-gray-400 dark:text-slate-500 block truncate mt-0.5">
                    {mod.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
