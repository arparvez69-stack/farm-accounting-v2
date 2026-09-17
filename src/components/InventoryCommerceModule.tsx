import React, { useEffect, useState } from 'react';
import {
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  PlusCircle,
  AlertTriangle,
  FileCheck,
  Phone,
  X
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { executePurchaseTransaction, executeSaleTransaction } from '../services/transactionService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { InventoryItem, Party, PaymentRecord, Purchase, Sale, UserRole } from '../types';
import { HIGH_AMOUNT_CONFIRMATION_THRESHOLD } from '../constants/validation';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type CommerceTab = 'inventory' | 'sales' | 'purchases' | 'parties';

export const InventoryCommerceModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [tab, setTab] = useState<CommerceTab>('inventory');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);

  // High amount transaction confirmation modal state
  const [confirmHighAmountCommerce, setConfirmHighAmountCommerce] = useState<{
    amount: number;
    type: 'SALE' | 'PURCHASE';
  } | null>(null);

  // Add Installment Modal State
  const [paymentModal, setPaymentModal] = useState<{
    parentType: 'SALE' | 'PURCHASE';
    parentId: string;
    invoiceNumber: string;
    partyName: string;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [paymentNote, setPaymentNote] = useState<string>('');

  // Add Item Modal
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemNameBn, setItemNameBn] = useState('');
  const [itemCategory, setItemCategory] = useState<InventoryItem['category']>('FEED');
  const [itemUnit, setItemUnit] = useState('কেজি');
  const [itemStock, setItemStock] = useState('0');
  const [itemCost, setItemCost] = useState('0');
  const [itemPrice, setItemPrice] = useState('0');
  const [itemReorder, setItemReorder] = useState('10');

  // New Sale Form
  const [showNewSale, setShowNewSale] = useState(false);
  const [saleDate, setSaleDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [saleCustomerId, setSaleCustomerId] = useState('');
  const [saleItemId, setSaleItemId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleUnitPrice, setSaleUnitPrice] = useState('');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');

  // New Purchase Form
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [purchDate, setPurchDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [purchSupplierId, setPurchSupplierId] = useState('');
  const [purchItemId, setPurchItemId] = useState('');
  const [purchQty, setPurchQty] = useState('1');
  const [purchUnitPrice, setPurchUnitPrice] = useState('');
  const [purchTransportCost, setPurchTransportCost] = useState('0');
  const [purchPaymentMethod, setPurchPaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');

  // Add Party Modal
  const [showAddParty, setShowAddParty] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [partyType, setPartyType] = useState<Party['type']>('CUSTOMER');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyAddress, setPartyAddress] = useState('');

  useEffect(() => {
    loadCommerceData();
  }, [tab]);

  const loadCommerceData = async () => {
    setLoading(true);
    try {
      // Seed default items if empty
      let itemList = await db.inventoryItems.toArray();
      if (itemList.length === 0) {
        const defaultItems: InventoryItem[] = [
          { id: 'it_1', code: 'FEED-001', nameBn: 'শিং ও কৈ মাছের ফিড (Floating Feed)', nameEn: 'Fish Feed', category: 'FEED', unit: 'কেজি', currentStock: 1200, reorderLevel: 200, avgCostPrice: 72, sellingPrice: 0, synced: false },
          { id: 'it_2', code: 'FEED-002', nameBn: 'দুগ্ধবতী গাভীর দানাদার খাদ্য (Cattle Feed)', nameEn: 'Cattle Feed', category: 'FEED', unit: 'কেজি', currentStock: 850, reorderLevel: 150, avgCostPrice: 48, sellingPrice: 0, synced: false },
          { id: 'it_3', code: 'FERT-001', nameBn: 'ইউরিয়া ও টিএসপি সার', nameEn: 'Fertilizer Mix', category: 'FERTILIZER', unit: 'ব্যাগ', currentStock: 25, reorderLevel: 5, avgCostPrice: 1100, sellingPrice: 0, synced: false },
          { id: 'it_4', code: 'PROD-001', nameBn: 'খামারের খাঁটি তরল দুধ', nameEn: 'Fresh Cow Milk', category: 'FARM_PRODUCT', unit: 'লিটার', currentStock: 80, reorderLevel: 10, avgCostPrice: 50, sellingPrice: 85, synced: false },
          { id: 'it_5', code: 'PROD-002', nameBn: 'শিং ও শোল মাছ (লাইভ)', nameEn: 'Live Fish', category: 'FARM_PRODUCT', unit: 'কেজি', currentStock: 350, reorderLevel: 50, avgCostPrice: 280, sellingPrice: 450, synced: false }
        ];
        await db.inventoryItems.bulkPut(defaultItems);
        itemList = defaultItems;
      }
      setItems(itemList);

      // Seed default parties if empty
      let partyList = await db.parties.toArray();
      if (partyList.length === 0) {
        const defaultParties: Party[] = [
          { id: 'pty_1', name: 'মেসার্স ভাই ভাই ডেইরি ও মিল্ক সেন্টার', type: 'CUSTOMER', phone: '01711223344', address: 'কাওরান বাজার, ঢাকা', balance: 0, creditLimit: 50000, isActive: true },
          { id: 'pty_2', name: 'আমান ফিড মিলস লিমিটেড (ডিলার)', type: 'SUPPLIER', phone: '01811556677', address: 'গাজীপুর', balance: 0, creditLimit: 100000, isActive: true }
        ];
        await db.parties.bulkPut(defaultParties);
        partyList = defaultParties;
      }
      setParties(partyList);

      const pmtList = await db.payments.toArray();
      setPayments(pmtList);

      if (tab === 'sales') {
        const sList = await db.sales.orderBy('date').reverse().toArray();
        setSales(sList);
      } else if (tab === 'purchases') {
        const pList = await db.purchases.orderBy('date').reverse().toArray();
        setPurchases(pList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ADD ITEM
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const item: InventoryItem = {
        id: generateUniqueId('it'),
        code: generateTransactionNumber('ITM'),
        nameBn: itemNameBn.trim(),
        nameEn: itemNameBn.trim(),
        category: itemCategory,
        unit: itemUnit.trim(),
        currentStock: parseFloat(itemStock) || 0,
        reorderLevel: parseFloat(itemReorder) || 10,
        avgCostPrice: parseFloat(itemCost) || 0,
        sellingPrice: parseFloat(itemPrice) || 0,
        synced: false
      };
      await safeInsert(db.inventoryItems, item, { idPrefix: 'it' });
      setShowAddItem(false);
      setItemNameBn('');
      setMsg({ type: 'success', text: `পণ্য ${item.nameBn} যুক্ত হয়েছে!` });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  // ADD PARTY
  const handleAddParty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const pty: Party = {
        id: generateUniqueId('pty'),
        name: partyName.trim(),
        type: partyType,
        phone: partyPhone.trim(),
        address: partyAddress.trim(),
        balance: 0,
        creditLimit: 50000,
        isActive: true
      };
      await safeInsert(db.parties, pty, { idPrefix: 'pty' });
      setShowAddParty(false);
      setPartyName('');
      setPartyPhone('');
      setPartyAddress('');
      setMsg({ type: 'success', text: `${partyType === 'CUSTOMER' ? 'ক্রেতা' : 'সরবরাহকারী'} সংরক্ষিত হয়েছে!` });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  // EXECUTE SALE WITH ATOMIC TRANSACTION & CANONICAL MAPPINGS
  const executeSaveSale = async () => {
    const item = items.find((i) => i.id === saleItemId);
    const customer = parties.find((p) => p.id === saleCustomerId);
    if (!item || !customer) return;

    const qty = parseFloat(saleQty) || 0;
    const price = parseFloat(saleUnitPrice) || item.sellingPrice || 0;

    try {
      const res = await executeSaleTransaction({
        customer,
        item,
        quantity: qty,
        unitPrice: price,
        paymentMethod: salePaymentMethod,
        currentUserId,
        date: saleDate
      });

      setShowNewSale(false);
      setSaleQty('1');
      setSaleUnitPrice('');
      setSaleDate(new Date().toISOString().split('T')[0]);
      setMsg({
        type: 'success',
        text: `বিক্রয় চালান ${res.sale.invoiceNumber} (৳${res.sale.totalAmount}) সফলভাবে সম্পন্ন এবং দ্বৈত-দাখিলায় পোস্ট হয়েছে!`
      });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'বিক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  const handleCreateSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleCustomerId || !saleItemId) {
      setMsg({ type: 'error', text: 'ক্রেতা ও পণ্য নির্বাচন করুন।' });
      return;
    }

    const item = items.find((i) => i.id === saleItemId);
    const customer = parties.find((p) => p.id === saleCustomerId);
    if (!item || !customer) return;

    const qty = parseFloat(saleQty) || 0;
    const price = parseFloat(saleUnitPrice) || item.sellingPrice || 0;

    if (qty <= 0 || price <= 0) {
      setMsg({ type: 'error', text: 'পরিমাণ ও মূল্য সঠিকভাবে প্রদান করুন।' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (saleDate > todayStr) {
      setMsg({
        type: 'error',
        text: `বিক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    const totalAmount = Math.round(qty * price * 100) / 100;
    if (totalAmount > HIGH_AMOUNT_CONFIRMATION_THRESHOLD) {
      setConfirmHighAmountCommerce({ amount: totalAmount, type: 'SALE' });
      return;
    }

    await executeSaveSale();
  };

  // EXECUTE PURCHASE WITH ATOMIC TRANSACTION & CANONICAL MAPPINGS
  const executeSavePurchase = async () => {
    const item = items.find((i) => i.id === purchItemId);
    const supplier = parties.find((p) => p.id === purchSupplierId);
    if (!item || !supplier) return;

    const qty = parseFloat(purchQty) || 0;
    const price = parseFloat(purchUnitPrice) || item.avgCostPrice || 0;
    const transport = parseFloat(purchTransportCost) || 0;

    try {
      const res = await executePurchaseTransaction({
        supplier,
        item,
        quantity: qty,
        unitPrice: price,
        transportCost: transport,
        paymentMethod: purchPaymentMethod,
        currentUserId,
        date: purchDate
      });

      setShowNewPurchase(false);
      setPurchQty('1');
      setPurchUnitPrice('');
      setPurchTransportCost('0');
      setPurchDate(new Date().toISOString().split('T')[0]);
      setMsg({
        type: 'success',
        text: `ক্রয় চালান ${res.purchase.invoiceNumber} (৳${res.purchase.grandTotal}) সফলভাবে সংরক্ষিত এবং স্টকে যুক্ত হয়েছে!`
      });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchSupplierId || !purchItemId) {
      setMsg({ type: 'error', text: 'সরবরাহকারী ও পণ্য নির্বাচন করুন।' });
      return;
    }

    const item = items.find((i) => i.id === purchItemId);
    const supplier = parties.find((p) => p.id === purchSupplierId);
    if (!item || !supplier) return;

    const qty = parseFloat(purchQty) || 0;
    const price = parseFloat(purchUnitPrice) || item.avgCostPrice || 0;
    const transport = parseFloat(purchTransportCost) || 0;

    if (qty <= 0 || price <= 0) {
      setMsg({ type: 'error', text: 'পরিমাণ ও দর সঠিকভাবে প্রদান করুন।' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (purchDate > todayStr) {
      setMsg({
        type: 'error',
        text: `ক্রয় চালানের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    const grandTotal = Math.round((qty * price + transport) * 100) / 100;
    if (grandTotal > HIGH_AMOUNT_CONFIRMATION_THRESHOLD) {
      setConfirmHighAmountCommerce({ amount: grandTotal, type: 'PURCHASE' });
      return;
    }

    await executeSavePurchase();
  };

  const openPaymentModal = (parentType: 'SALE' | 'PURCHASE', item: Sale | Purchase) => {
    const total = Number(item.grandTotal || item.totalAmount || 0);
    const paid = Number(item.paidAmount || 0);
    const due = Number(item.dueAmount !== undefined ? item.dueAmount : Math.max(0, total - paid));
    setPaymentModal({
      parentType,
      parentId: item.id,
      invoiceNumber: item.invoiceNumber,
      partyName: 'customerName' in item ? item.customerName : item.supplierName,
      totalAmount: total,
      paidAmount: paid,
      dueAmount: due
    });
    setPaymentAmount(due > 0 ? due.toString() : '');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentNote('');
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModal) return;

    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      setMsg({ type: 'error', text: 'সঠিক কিস্তির পরিমাণ প্রদান করুন।' });
      return;
    }

    try {
      const paymentRecord: PaymentRecord = {
        id: generateUniqueId('pmt'),
        parentType: paymentModal.parentType,
        parentId: paymentModal.parentId,
        amount: amt,
        date: paymentDate || new Date().toISOString().split('T')[0],
        note: paymentNote.trim() || undefined,
        synced: false
      };

      await safeInsert(db.payments, paymentRecord, { idPrefix: 'pmt' });

      // Recalculate that sale/purchase's paidAmount as the sum of all its PaymentRecords, and dueAmount = total − paidAmount
      const allPaymentsForParent = await db.payments.where('parentId').equals(paymentModal.parentId).toArray();
      const totalPaid = allPaymentsForParent.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const invoiceTotal = paymentModal.totalAmount;
      const newDue = Math.max(0, invoiceTotal - totalPaid);
      const newStatus = newDue <= 0 ? 'PAID' : (totalPaid > 0 ? 'PARTIAL' : 'DUE');

      if (paymentModal.parentType === 'SALE') {
        await db.sales.update(paymentModal.parentId, {
          paidAmount: totalPaid,
          dueAmount: newDue,
          status: newStatus,
          synced: false
        });
      } else {
        await db.purchases.update(paymentModal.parentId, {
          paidAmount: totalPaid,
          dueAmount: newDue,
          status: newStatus,
          synced: false
        });
      }

      setPaymentModal(null);
      setMsg({ type: 'success', text: `৳${amt.toLocaleString()} কিস্তি সফলভাবে সংরক্ষিত হয়েছে!` });
      await loadCommerceData();
    } catch (err: any) {
      console.error(err);
      setMsg({ type: 'error', text: err.message || 'কিস্তি সংরক্ষণে ত্রুটি হয়েছে।' });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-[#1E5128]" />
            <span>ক্রয়-বিক্রয়, মজুদ ও পক্ষসমূহ (Commerce & Inventory)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            ফিড, সার, ওষুধ মজুদ, ক্রয় চালান, বিক্রয় ও দেনাদার-পাওনাদার খতিয়ান
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
          <button
            onClick={() => setTab('inventory')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'inventory' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            স্টক/মজুদ (Inventory)
          </button>
          <button
            onClick={() => setTab('sales')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'sales' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            বিক্রয় চালান (Sales)
          </button>
          <button
            onClick={() => setTab('purchases')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'purchases' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            ক্রয় চালান (Purchases)
          </button>
          <button
            onClick={() => setTab('parties')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'parties' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            গ্রাহক ও সাপ্লায়ার (Parties)
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3.5 rounded-xl border text-[14px] font-medium flex items-center gap-2.5 ${
            msg.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg.type === 'success' ? <FileCheck className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* ===================== TAB 1: INVENTORY ===================== */}
      {tab === 'inventory' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-[#1E5128]" />
                <span>মজুদ পণ্যের তালিকা ও মূল্যায়ন ({items.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">গড় ক্রয়মূল্য (Weighted Average Cost) ভিত্তিতে মূল্যায়ন</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddItem(!showAddItem)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন পণ্য</span>
              </button>
            )}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন আইটেম যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পণ্যের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: কার্প মাছের গ্রোয়ার ফিড"
                    value={itemNameBn}
                    onChange={(e) => setItemNameBn(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্যাটাগরি</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="FEED">ফিড/খাদ্য (Feed - 1051)</option>
                    <option value="FERTILIZER">সার (Fertilizer - 1052)</option>
                    <option value="SEED">বীজ (Seed - 1052)</option>
                    <option value="RAW_MATERIAL">কাঁচামাল (Raw Material - 1053)</option>
                    <option value="FARM_PRODUCT">খামারের উৎপাদিত পণ্য (Product - 1055)</option>
                    <option value="PACKAGING">প্যাকেজিং (Packaging - 1056)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">একক (Unit)</label>
                  <input
                    type="text"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder="কেজি / লিটার / ব্যাগ"
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বর্তমান স্টক</label>
                  <input
                    type="number"
                    value={itemStock}
                    onChange={(e) => setItemStock(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">গড় ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemCost}
                    onChange={(e) => setItemCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বিক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">রিঅর্ডার লেভেল</label>
                  <input
                    type="number"
                    value={itemReorder}
                    onChange={(e) => setItemReorder(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddItem(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">পণ্যের নাম</th>
                  <th className="p-3">ক্যাটাগরি</th>
                  <th className="p-3">বর্তমান স্টক</th>
                  <th className="p-3">গড় ক্রয়মূল্য</th>
                  <th className="p-3">বিক্রয় মূল্য</th>
                  <th className="p-3 text-right">মোট মজুদ মূল্য (৳)</th>
                  <th className="p-3">সতর্কতা</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it) => {
                  const val = it.currentStock * it.avgCostPrice;
                  const isLow = it.currentStock <= it.reorderLevel;
                  return (
                    <tr key={it.id} className="hover:bg-gray-50/80">
                      <td className="p-3 font-medium text-gray-900">{it.nameBn}</td>
                      <td className="p-3 text-gray-600 text-[13px]">{it.category}</td>
                      <td className="p-3 font-bold text-gray-900">{it.currentStock} {it.unit}</td>
                      <td className="p-3 text-gray-700">{fmt(it.avgCostPrice)}</td>
                      <td className="p-3 text-[#15803D] font-semibold">{it.sellingPrice > 0 ? fmt(it.sellingPrice) : '-'}</td>
                      <td className="p-3 text-right font-bold text-[#1E5128]">{fmt(val)}</td>
                      <td className="p-3">
                        {isLow ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            মজুদ কম!
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500">পর্যাপ্ত</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: SALES ===================== */}
      {tab === 'sales' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#1E5128]" />
                <span>বিক্রয় চালান ও রাজস্ব (Sales Invoices)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">স্বয়ংক্রিয় জাবেদা (নগদ: 1010, ব্যাংক: 1030, বাকি: 1040 AR)</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewSale(!showNewSale)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন বিক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewSale && (
            <form onSubmit={handleCreateSale} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন বিক্রয় চালান তৈরি করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">চালানের তারিখ</label>
                  <input
                    type="date"
                    id="input-sale-date"
                    value={saleDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 ${
                      saleDate > new Date().toISOString().split('T')[0] ? 'border-rose-500 ring-1 ring-rose-500' : 'border-gray-300'
                    }`}
                  />
                  {saleDate > new Date().toISOString().split('T')[0] && (
                    <p className="text-[12px] text-rose-600 font-semibold mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      ভবিষ্যতের তারিখ গ্রহণযোগ্য নয়
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রেতা নির্বাচন</label>
                  <select
                    value={saleCustomerId}
                    onChange={(e) => setSaleCustomerId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="">-- ক্রেতা নির্বাচন --</option>
                    {parties.filter((p) => p.type === 'CUSTOMER').map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বিক্রয়ের পণ্য</label>
                  <select
                    value={saleItemId}
                    onChange={(e) => {
                      setSaleItemId(e.target.value);
                      const it = items.find((i) => i.id === e.target.value);
                      if (it && it.sellingPrice > 0) setSaleUnitPrice(it.sellingPrice.toString());
                    }}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="">-- পণ্য নির্বাচন --</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nameBn} (স্টক: {it.currentStock} {it.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পরিশোধের মাধ্যম</label>
                  <select
                    value={salePaymentMethod}
                    onChange={(e) => setSalePaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / দেনাদার (Accounts Receivable - 1040)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পরিমাণ</label>
                  <input
                    type="number"
                    value={saleQty}
                    onChange={(e) => setSaleQty(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">একক দর ৳</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={saleUnitPrice}
                    onChange={(e) => setSaleUnitPrice(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewSale(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  চালান পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">চালান নং</th>
                  <th className="p-3">তারিখ</th>
                  <th className="p-3">ক্রেতা</th>
                  <th className="p-3">পণ্যসমূহ</th>
                  <th className="p-3">মোট মূল্য</th>
                  <th className="p-3">পরিশোধ মাধ্যম</th>
                  <th className="p-3">স্থিতি</th>
                  <th className="p-3 text-right">কার্যক্রম</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-gray-500 text-[14px]">
                      এখনো কোনো বিক্রয় চালান ইস্যু করা হয়নি।
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => {
                    const sPayments = payments.filter((pmt) => pmt.parentId === s.id);
                    const total = Number(s.grandTotal || s.totalAmount || 0);
                    const paid = Number(s.paidAmount || 0);
                    const due = Number(s.dueAmount !== undefined ? s.dueAmount : Math.max(0, total - paid));
                    const hasDue = due > 0;

                    return (
                      <React.Fragment key={s.id}>
                        <tr className="hover:bg-gray-50/80">
                          <td className="p-3 font-bold text-[#1E5128] font-mono">{s.invoiceNumber}</td>
                          <td className="p-3 text-gray-600">{s.date}</td>
                          <td className="p-3 font-semibold text-gray-900">{s.customerName}</td>
                          <td className="p-3">
                            {s.items.map((i, idx) => (
                              <div key={idx} className="text-gray-700 text-[13px]">
                                {i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})
                              </div>
                            ))}
                          </td>
                          <td className="p-3 font-mono">
                            <div className="text-[#15803D] font-bold">{fmt(total)}</div>
                            {(s.paymentMethod === 'CREDIT' || paid > 0 || due > 0) && (
                              <div className="text-xs text-gray-500 font-sans">
                                পরিশোধ: ৳{fmt(paid)} | বাকি: <span className={due > 0 ? "text-amber-700 font-bold" : "text-emerald-700"}>৳{fmt(due)}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-gray-700 text-[13px]">{s.paymentMethod}</td>
                          <td className="p-3">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              due <= 0 || s.status === 'PAID'
                                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                                : (paid > 0 ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200')
                            }`}>
                              {due <= 0 || s.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক বাকি (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {hasDue && (
                              <button
                                type="button"
                                id={`btn-add-installment-sale-${s.id}`}
                                onClick={() => openPaymentModal('SALE', s)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                              >
                                <PlusCircle className="w-3.5 h-3.5" />
                                <span>কিস্তি যোগ করুন</span>
                              </button>
                            )}
                          </td>
                        </tr>
                        {sPayments.length > 0 && (
                          <tr className="bg-emerald-50/40 border-b border-gray-100">
                            <td colSpan={8} className="px-4 py-2">
                              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-700">
                                <span className="font-semibold text-[#1E5128]">পরিশোধের ইতিহাস:</span>
                                {sPayments.map((pmt) => (
                                  <span
                                    key={pmt.id}
                                    className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-gray-200 text-gray-800 font-mono shadow-2xs"
                                  >
                                    <span className="text-gray-500">{pmt.date}:</span>
                                    <span className="font-bold text-[#15803D]">৳{fmt(pmt.amount)}</span>
                                    {pmt.note && <span className="text-gray-400 font-sans text-[11px]">({pmt.note})</span>}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: PURCHASES ===================== */}
      {tab === 'purchases' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-sky-600" />
                <span>ক্রয় চালান ও সরবরাহকারী খরচ (Purchase Invoices)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">ফিড ক্রয়: Dr 1051, নগদ: Cr 1010, ব্যাংক: Cr 1030, বাকি: Cr 2010 AP</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewPurchase(!showNewPurchase)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন ক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewPurchase && (
            <form onSubmit={handleCreatePurchase} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন ক্রয় চালান লিপিবদ্ধ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">চালানের তারিখ</label>
                  <input
                    type="date"
                    id="input-purch-date"
                    value={purchDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setPurchDate(e.target.value)}
                    className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 ${
                      purchDate > new Date().toISOString().split('T')[0] ? 'border-rose-500 ring-1 ring-rose-500' : 'border-gray-300'
                    }`}
                  />
                  {purchDate > new Date().toISOString().split('T')[0] && (
                    <p className="text-[12px] text-rose-600 font-semibold mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      ভবিষ্যতের তারিখ গ্রহণযোগ্য নয়
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">সরবরাহকারী নির্বাচন</label>
                  <select
                    value={purchSupplierId}
                    onChange={(e) => setPurchSupplierId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="">-- সরবরাহকারী নির্বাচন --</option>
                    {parties.filter((p) => p.type === 'SUPPLIER').map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রয়কৃত আইটেম</label>
                  <select
                    value={purchItemId}
                    onChange={(e) => {
                      setPurchItemId(e.target.value);
                      const it = items.find((i) => i.id === e.target.value);
                      if (it) setPurchUnitPrice(it.avgCostPrice.toString());
                    }}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="">-- পণ্য নির্বাচন --</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nameBn} ({it.category === 'FEED' ? '1051 Feed' : it.category})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পরিশোধের মাধ্যম</label>
                  <select
                    value={purchPaymentMethod}
                    onChange={(e) => setPurchPaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / পাওনাদার (Accounts Payable - 2010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পরিমাণ</label>
                  <input
                    type="number"
                    value={purchQty}
                    onChange={(e) => setPurchQty(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">একক ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={purchUnitPrice}
                    onChange={(e) => setPurchUnitPrice(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">পরিবহন খরচ ৳ (Carriage Inward)</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={purchTransportCost}
                    onChange={(e) => setPurchTransportCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewPurchase(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  চালান সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-left text-[14px] text-gray-800">
              <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                <tr>
                  <th className="p-3">চালান নং</th>
                  <th className="p-3">তারিখ</th>
                  <th className="p-3">সরবরাহকারী</th>
                  <th className="p-3">ক্রয়কৃত পণ্য</th>
                  <th className="p-3">পরিবহন খরচ</th>
                  <th className="p-3">মোট চালান মূল্য</th>
                  <th className="p-3">পরিশোধ মাধ্যম</th>
                  <th className="p-3">স্থিতি</th>
                  <th className="p-3 text-right">কার্যক্রম</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-500 text-[14px]">
                      এখনো কোনো ক্রয় চালান রেকর্ড করা হয়নি।
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => {
                    const pPayments = payments.filter((pmt) => pmt.parentId === p.id);
                    const total = Number(p.grandTotal || p.totalAmount || 0);
                    const paid = Number(p.paidAmount || 0);
                    const due = Number(p.dueAmount !== undefined ? p.dueAmount : Math.max(0, total - paid));
                    const hasDue = due > 0;

                    return (
                      <React.Fragment key={p.id}>
                        <tr className="hover:bg-gray-50/80">
                          <td className="p-3 font-bold text-sky-700 font-mono">{p.invoiceNumber}</td>
                          <td className="p-3 text-gray-600">{p.date}</td>
                          <td className="p-3 font-semibold text-gray-900">{p.supplierName}</td>
                          <td className="p-3">
                            {p.items.map((i, idx) => (
                              <div key={idx} className="text-gray-700 text-[13px]">
                                {i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})
                              </div>
                            ))}
                          </td>
                          <td className="p-3 text-amber-700 font-medium">{fmt(p.transportCost || 0)}</td>
                          <td className="p-3 font-mono">
                            <div className="text-red-600 font-bold">{fmt(total)}</div>
                            {(p.paymentMethod === 'CREDIT' || paid > 0 || due > 0) && (
                              <div className="text-xs text-gray-500 font-sans">
                                পরিশোধ: ৳{fmt(paid)} | বাকি: <span className={due > 0 ? "text-amber-700 font-bold" : "text-emerald-700"}>৳{fmt(due)}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-gray-700 text-[13px]">{p.paymentMethod}</td>
                          <td className="p-3">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              due <= 0 || p.status === 'PAID'
                                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                                : (paid > 0 ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200')
                            }`}>
                              {due <= 0 || p.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক বাকি (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {hasDue && (
                              <button
                                type="button"
                                id={`btn-add-installment-purchase-${p.id}`}
                                onClick={() => openPaymentModal('PURCHASE', p)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                              >
                                <PlusCircle className="w-3.5 h-3.5" />
                                <span>কিস্তি যোগ করুন</span>
                              </button>
                            )}
                          </td>
                        </tr>
                        {pPayments.length > 0 && (
                          <tr className="bg-sky-50/40 border-b border-gray-100">
                            <td colSpan={9} className="px-4 py-2">
                              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-700">
                                <span className="font-semibold text-sky-800">পরিশোধের ইতিহাস:</span>
                                {pPayments.map((pmt) => (
                                  <span
                                    key={pmt.id}
                                    className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-gray-200 text-gray-800 font-mono shadow-2xs"
                                  >
                                    <span className="text-gray-500">{pmt.date}:</span>
                                    <span className="font-bold text-[#15803D]">৳{fmt(pmt.amount)}</span>
                                    {pmt.note && <span className="text-gray-400 font-sans text-[11px]">({pmt.note})</span>}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: PARTIES (CUSTOMERS & SUPPLIERS) ===================== */}
      {tab === 'parties' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-[#1E5128]" />
                <span>গ্রাহক ও সরবরাহকারী তালিকা (Parties Directory)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">পাওনা ও দেনার হিসাব ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddParty(!showAddParty)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন ব্যক্তি/প্রতিষ্ঠান</span>
              </button>
            )}
          </div>

          {showAddParty && (
            <form onSubmit={handleAddParty} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন পক্ষ (Party) নিবন্ধন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="নাম/প্রতিষ্ঠান"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <select
                  value={partyType}
                  onChange={(e) => setPartyType(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="CUSTOMER">ক্রেতা (Customer)</option>
                  <option value="SUPPLIER">সরবরাহকারী (Supplier)</option>
                </select>
                <input
                  type="text"
                  placeholder="ফোন নম্বর"
                  value={partyPhone}
                  onChange={(e) => setPartyPhone(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  placeholder="ঠিকানা"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddParty(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {parties.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-900 text-[15px]">{p.name}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    p.type === 'CUSTOMER' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}>
                    {p.type === 'CUSTOMER' ? 'ক্রেতা' : 'সরবরাহকারী'}
                  </span>
                </div>
                <div className="text-gray-600 text-[13px] flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-gray-500" />
                  <span>{p.phone || 'ফোন নেই'}</span>
                </div>
                <div className="text-gray-600 text-[13px] truncate">
                  {p.address || 'ঠিকানা নেই'}
                </div>
                <div className="pt-2 border-t border-gray-200 flex items-center justify-between font-mono">
                  <span className="text-gray-600 text-[13px]">বর্তমান ব্যালেন্স:</span>
                  <span className={`font-bold text-[14px] ${p.balance > 0 ? (p.type === 'CUSTOMER' ? 'text-sky-700' : 'text-amber-700') : 'text-gray-600'}`}>
                    {fmt(p.balance)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== MODAL: ADD INSTALLMENT / PAYMENT ===================== */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {paymentModal.parentType === 'SALE' ? 'বিক্রয় কিস্তি গ্রহণ' : 'ক্রয় কিস্তি পরিশোধ'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  চালান নং: <span className="font-mono font-bold text-[#1E5128]">{paymentModal.invoiceNumber}</span> ({paymentModal.partyName})
                </p>
              </div>
              <button
                type="button"
                id="btn-close-payment-modal"
                onClick={() => setPaymentModal(null)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-gray-50 border border-gray-200 text-center font-mono">
              <div>
                <div className="text-[11px] font-sans text-gray-500 font-semibold">মোট মূল্য</div>
                <div className="font-bold text-gray-800 text-[13px]">{fmt(paymentModal.totalAmount)}</div>
              </div>
              <div>
                <div className="text-[11px] font-sans text-gray-500 font-semibold">পূর্বে পরিশোধ</div>
                <div className="font-bold text-emerald-700 text-[13px]">{fmt(paymentModal.paidAmount)}</div>
              </div>
              <div>
                <div className="text-[11px] font-sans text-gray-500 font-semibold">বর্তমান বকেয়া</div>
                <div className="font-bold text-amber-800 text-[13px]">{fmt(paymentModal.dueAmount)}</div>
              </div>
            </div>

            <form onSubmit={handleSavePayment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  কিস্তির পরিমাণ (৳) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  max={paymentModal.dueAmount}
                  required
                  id="input-installment-amount"
                  placeholder="যেমন: 5000"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  পরিশোধের তারিখ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  id="input-installment-date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  নোট / বিবরণ (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  id="input-installment-note"
                  placeholder="যেমন: বিকাশ / ব্যাংক চেক / নগদ কিস্তি ১"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-[#1E5128]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  id="btn-cancel-installment"
                  onClick={() => setPaymentModal(null)}
                  className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  id="btn-save-installment"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold cursor-pointer min-h-[40px] shadow-xs"
                >
                  কিস্তি সংরক্ষণ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* High Amount Confirmation Modal */}
      {confirmHighAmountCommerce && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5 text-amber-700">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">পোস্টিং নিশ্চিতকরণ</h3>
              </div>
              <button
                type="button"
                id="btn-close-high-amount-commerce"
                onClick={() => setConfirmHighAmountCommerce(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-800 text-[15px] font-medium leading-relaxed">
              আপনি কি {confirmHighAmountCommerce.amount.toLocaleString('en-IN')} টাকার এই এন্ট্রিটি পোস্ট করতে নিশ্চিত?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                id="btn-cancel-high-amount-commerce"
                onClick={() => setConfirmHighAmountCommerce(null)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer min-h-[40px]"
              >
                বাতিল (Cancel)
              </button>
              <button
                type="button"
                id="btn-confirm-high-amount-commerce"
                onClick={async () => {
                  const targetType = confirmHighAmountCommerce.type;
                  setConfirmHighAmountCommerce(null);
                  if (targetType === 'SALE') {
                    await executeSaveSale();
                  } else {
                    await executeSavePurchase();
                  }
                }}
                className="px-5 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-xs font-bold transition-all cursor-pointer shadow-xs min-h-[40px]"
              >
                নিশ্চিত করুন (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
