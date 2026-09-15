import React, { useEffect, useState } from 'react';
import {
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  PlusCircle,
  AlertTriangle,
  FileCheck,
  Phone
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { executePurchaseTransaction, executeSaleTransaction } from '../services/transactionService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { InventoryItem, Party, Purchase, Sale, UserRole } from '../types';

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
  const [saleCustomerId, setSaleCustomerId] = useState('');
  const [saleItemId, setSaleItemId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleUnitPrice, setSaleUnitPrice] = useState('');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');

  // New Purchase Form
  const [showNewPurchase, setShowNewPurchase] = useState(false);
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

    try {
      const res = await executeSaleTransaction({
        customer,
        item,
        quantity: qty,
        unitPrice: price,
        paymentMethod: salePaymentMethod,
        currentUserId
      });

      setShowNewSale(false);
      setSaleQty('1');
      setSaleUnitPrice('');
      setMsg({
        type: 'success',
        text: `বিক্রয় চালান ${res.sale.invoiceNumber} (৳${res.sale.totalAmount}) সফলভাবে সম্পন্ন এবং দ্বৈত-দাখিলায় পোস্ট হয়েছে!`
      });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'বিক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  // EXECUTE PURCHASE WITH ATOMIC TRANSACTION & CANONICAL MAPPINGS
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

    try {
      const res = await executePurchaseTransaction({
        supplier,
        item,
        quantity: qty,
        unitPrice: price,
        transportCost: transport,
        paymentMethod: purchPaymentMethod,
        currentUserId
      });

      setShowNewPurchase(false);
      setPurchQty('1');
      setPurchUnitPrice('');
      setPurchTransportCost('0');
      setMsg({
        type: 'success',
        text: `ক্রয় চালান ${res.purchase.invoiceNumber} (৳${res.purchase.grandTotal}) সফলভাবে সংরক্ষিত এবং স্টকে যুক্ত হয়েছে!`
      });
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-20 max-w-7xl mx-auto">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-400" />
            <span>ক্রয়-বিক্রয়, মজুদ ও পক্ষসমূহ (Commerce & Inventory)</span>
          </h2>
          <p className="text-xs text-slate-400">
            ফিড, সার, ওষুধ মজুদ, ক্রয় চালান, বিক্রয় ও দেনাদার-পাওনাদার খতিয়ান
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setTab('inventory')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'inventory' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            স্টক/মজুদ (Inventory)
          </button>
          <button
            onClick={() => setTab('sales')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'sales' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            বিক্রয় চালান (Sales)
          </button>
          <button
            onClick={() => setTab('purchases')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'purchases' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            ক্রয় চালান (Purchases)
          </button>
          <button
            onClick={() => setTab('parties')}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              tab === 'parties' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
            }`}
          >
            গ্রাহক ও সাপ্লায়ার (Parties)
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            msg.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/70 border-rose-800 text-rose-300'
          }`}
        >
          {msg.type === 'success' ? <FileCheck className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* ===================== TAB 1: INVENTORY ===================== */}
      {tab === 'inventory' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                <span>মজুদ পণ্যের তালিকা ও মূল্যায়ন ({items.length})</span>
              </h3>
              <p className="text-xs text-slate-400">গড় ক্রয়মূল্য (Weighted Average Cost) ভিত্তিতে মূল্যায়ন</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddItem(!showAddItem)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন পণ্য</span>
              </button>
            )}
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400 text-xs">নতুন আইটেম যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">পণ্যের নাম</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: কার্প মাছের গ্রোয়ার ফিড"
                    value={itemNameBn}
                    onChange={(e) => setItemNameBn(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">ক্যাটাগরি</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
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
                  <label className="text-[10px] text-slate-400">একক (Unit)</label>
                  <input
                    type="text"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder="কেজি / লিটার / ব্যাগ"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">বর্তমান স্টক</label>
                  <input
                    type="number"
                    value={itemStock}
                    onChange={(e) => setItemStock(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">গড় ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemCost}
                    onChange={(e) => setItemCost(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">বিক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">রিঅর্ডার লেভেল</label>
                  <input
                    type="number"
                    value={itemReorder}
                    onChange={(e) => setItemReorder(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddItem(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">পণ্যের নাম</th>
                  <th className="p-2.5">ক্যাটাগরি</th>
                  <th className="p-2.5">বর্তমান স্টক</th>
                  <th className="p-2.5">গড় ক্রয়মূল্য</th>
                  <th className="p-2.5">বিক্রয় মূল্য</th>
                  <th className="p-2.5 text-right">মোট মজুদ মূল্য (৳)</th>
                  <th className="p-2.5">সতর্কতা</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {items.map((it) => {
                  const val = it.currentStock * it.avgCostPrice;
                  const isLow = it.currentStock <= it.reorderLevel;
                  return (
                    <tr key={it.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-sans font-medium text-white">{it.nameBn}</td>
                      <td className="p-2.5 font-sans text-slate-400 text-[10px]">{it.category}</td>
                      <td className="p-2.5 font-bold text-white">{it.currentStock} {it.unit}</td>
                      <td className="p-2.5 text-slate-300">{fmt(it.avgCostPrice)}</td>
                      <td className="p-2.5 text-emerald-400">{it.sellingPrice > 0 ? fmt(it.sellingPrice) : '-'}</td>
                      <td className="p-2.5 text-right font-bold text-emerald-300">{fmt(val)}</td>
                      <td className="p-2.5 font-sans">
                        {isLow ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-950 text-amber-300 border border-amber-800">
                            মজুদ কম!
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">পর্যাপ্ত</span>
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
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>বিক্রয় চালান ও রাজস্ব (Sales Invoices)</span>
              </h3>
              <p className="text-xs text-slate-400">স্বয়ংক্রিয় জাবেদা (নগদ: 1010, ব্যাংক: 1030, বাকি: 1040 AR)</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewSale(!showNewSale)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন বিক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewSale && (
            <form onSubmit={handleCreateSale} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400 text-xs">নতুন বিক্রয় চালান তৈরি করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">ক্রেতা নির্বাচন</label>
                  <select
                    value={saleCustomerId}
                    onChange={(e) => setSaleCustomerId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="">-- ক্রেতা নির্বাচন --</option>
                    {parties.filter((p) => p.type === 'CUSTOMER').map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400">বিক্রয়ের পণ্য</label>
                  <select
                    value={saleItemId}
                    onChange={(e) => {
                      setSaleItemId(e.target.value);
                      const it = items.find((i) => i.id === e.target.value);
                      if (it && it.sellingPrice > 0) setSaleUnitPrice(it.sellingPrice.toString());
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
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
                  <label className="text-[10px] text-slate-400">পরিশোধের মাধ্যম</label>
                  <select
                    value={salePaymentMethod}
                    onChange={(e) => setSalePaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / দেনাদার (Accounts Receivable - 1040)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">পরিমাণ</label>
                  <input
                    type="number"
                    value={saleQty}
                    onChange={(e) => setSaleQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">একক দর ৳</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={saleUnitPrice}
                    onChange={(e) => setSaleUnitPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewSale(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  চালান পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">চালান নং</th>
                  <th className="p-2.5">তারিখ</th>
                  <th className="p-2.5">ক্রেতা</th>
                  <th className="p-2.5">পণ্যসমূহ</th>
                  <th className="p-2.5">মোট মূল্য</th>
                  <th className="p-2.5">পরিশোধ মাধ্যম</th>
                  <th className="p-2.5">স্থিতি</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500 font-sans text-xs">
                      এখনো কোনো বিক্রয় চালান ইস্যু করা হয়নি।
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-emerald-400">{s.invoiceNumber}</td>
                      <td className="p-2.5 text-slate-400">{s.date}</td>
                      <td className="p-2.5 font-sans font-medium text-white">{s.customerName}</td>
                      <td className="p-2.5 font-sans">
                        {s.items.map((i, idx) => (
                          <div key={idx} className="text-slate-300">
                            {i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})
                          </div>
                        ))}
                      </td>
                      <td className="p-2.5 text-emerald-300 font-bold">{fmt(s.totalAmount || s.grandTotal || 0)}</td>
                      <td className="p-2.5 font-sans text-[11px]">{s.paymentMethod}</td>
                      <td className="p-2.5 font-sans">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          s.status === 'PAID' ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-300'
                        }`}>
                          {s.status === 'PAID' ? 'পরিশোধিত' : 'বাকি (DUE)'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 3: PURCHASES ===================== */}
      {tab === 'purchases' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-sky-400" />
                <span>ক্রয় চালান ও সরবরাহকারী খরচ (Purchase Invoices)</span>
              </h3>
              <p className="text-xs text-slate-400">ফিড ক্রয়: Dr 1051, নগদ: Cr 1010, ব্যাংক: Cr 1030, বাকি: Cr 2010 AP</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowNewPurchase(!showNewPurchase)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন ক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewPurchase && (
            <form onSubmit={handleCreatePurchase} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400 text-xs">নতুন ক্রয় চালান লিপিবদ্ধ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">সরবরাহকারী নির্বাচন</label>
                  <select
                    value={purchSupplierId}
                    onChange={(e) => setPurchSupplierId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="">-- সরবরাহকারী নির্বাচন --</option>
                    {parties.filter((p) => p.type === 'SUPPLIER').map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400">ক্রয়কৃত আইটেম</label>
                  <select
                    value={purchItemId}
                    onChange={(e) => {
                      setPurchItemId(e.target.value);
                      const it = items.find((i) => i.id === e.target.value);
                      if (it) setPurchUnitPrice(it.avgCostPrice.toString());
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
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
                  <label className="text-[10px] text-slate-400">পরিশোধের মাধ্যম</label>
                  <select
                    value={purchPaymentMethod}
                    onChange={(e) => setPurchPaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / পাওনাদার (Accounts Payable - 2010)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">পরিমাণ</label>
                  <input
                    type="number"
                    value={purchQty}
                    onChange={(e) => setPurchQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">একক ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={purchUnitPrice}
                    onChange={(e) => setPurchUnitPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">পরিবহন খরচ ৳ (Carriage Inward)</label>
                  <input
                    type="number"
                    placeholder="৳"
                    value={purchTransportCost}
                    onChange={(e) => setPurchTransportCost(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewPurchase(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  চালান সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">চালান নং</th>
                  <th className="p-2.5">তারিখ</th>
                  <th className="p-2.5">সরবরাহকারী</th>
                  <th className="p-2.5">ক্রয়কৃত পণ্য</th>
                  <th className="p-2.5">পরিবহন খরচ</th>
                  <th className="p-2.5">মোট চালান মূল্য</th>
                  <th className="p-2.5">পরিশোধ মাধ্যম</th>
                  <th className="p-2.5">স্থিতি</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {purchases.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-500 font-sans text-xs">
                      এখনো কোনো ক্রয় চালান রেকর্ড করা হয়নি।
                    </td>
                  </tr>
                ) : (
                  purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-sky-400">{p.invoiceNumber}</td>
                      <td className="p-2.5 text-slate-400">{p.date}</td>
                      <td className="p-2.5 font-sans font-medium text-white">{p.supplierName}</td>
                      <td className="p-2.5 font-sans">
                        {p.items.map((i, idx) => (
                          <div key={idx} className="text-slate-300">
                            {i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})
                          </div>
                        ))}
                      </td>
                      <td className="p-2.5 text-amber-300">{fmt(p.transportCost || 0)}</td>
                      <td className="p-2.5 text-rose-300 font-bold">{fmt(p.grandTotal || p.totalAmount || 0)}</td>
                      <td className="p-2.5 font-sans text-[11px]">{p.paymentMethod}</td>
                      <td className="p-2.5 font-sans">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          p.status === 'PAID' ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-300'
                        }`}>
                          {p.status === 'PAID' ? 'পরিশোধিত' : 'বাকি (DUE)'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: PARTIES (CUSTOMERS & SUPPLIERS) ===================== */}
      {tab === 'parties' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>গ্রাহক ও সরবরাহকারী তালিকা (Parties Directory)</span>
              </h3>
              <p className="text-xs text-slate-400">পাওনা ও দেনার হিসাব ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddParty(!showAddParty)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ নতুন ব্যক্তি/প্রতিষ্ঠান</span>
              </button>
            )}
          </div>

          {showAddParty && (
            <form onSubmit={handleAddParty} className="p-4 bg-slate-800/80 border border-slate-700 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400 text-xs">নতুন পক্ষ (Party) নিবন্ধন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <input
                  type="text"
                  required
                  placeholder="নাম/প্রতিষ্ঠান"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <select
                  value={partyType}
                  onChange={(e) => setPartyType(e.target.value as any)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  <option value="CUSTOMER">ক্রেতা (Customer)</option>
                  <option value="SUPPLIER">সরবরাহকারী (Supplier)</option>
                </select>
                <input
                  type="text"
                  placeholder="ফোন নম্বর"
                  value={partyPhone}
                  onChange={(e) => setPartyPhone(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
                <input
                  type="text"
                  placeholder="ঠিকানা"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddParty(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-xs"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {parties.map((p) => (
              <div
                key={p.id}
                className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{p.name}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    p.type === 'CUSTOMER' ? 'bg-sky-950 text-sky-400' : 'bg-amber-950 text-amber-400'
                  }`}>
                    {p.type === 'CUSTOMER' ? 'ক্রেতা' : 'সরবরাহকারী'}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px] flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-500" />
                  <span>{p.phone || 'ফোন নেই'}</span>
                </div>
                <div className="text-slate-400 text-[11px] truncate">
                  {p.address || 'ঠিকানা নেই'}
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-mono">
                  <span className="text-slate-400 text-[11px]">বর্তমান ব্যালেন্স:</span>
                  <span className={`font-bold ${p.balance > 0 ? (p.type === 'CUSTOMER' ? 'text-sky-400' : 'text-amber-400') : 'text-slate-400'}`}>
                    {fmt(p.balance)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
