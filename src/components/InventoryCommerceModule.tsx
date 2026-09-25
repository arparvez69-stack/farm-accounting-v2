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
  X,
  LayoutGrid,
  List,
  ArrowLeft,
  ChevronRight,
  CreditCard,
  Calendar,
  FileText,
  Receipt,
  Download,
  Share2,
  Printer,
  Check,
  MessageCircle,
  Copy,
  RotateCcw,
  Plus,
  Trash2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { db } from '../db/indexedDb';
import {
  executePurchaseTransaction,
  executeSaleTransaction,
  executePaymentTransaction,
  executeInventoryItemCreationTransaction,
  executeSalesReturnTransaction,
  executePurchaseReturnTransaction,
  executeAdvancePaymentTransaction,
  getPartyAvailableAdvance
} from '../services/transactionService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import {
  InventoryItem,
  Party,
  PaymentRecord,
  Purchase,
  PurchaseItem,
  PurchaseLineInput,
  Sale,
  SaleItem,
  SaleLineInput,
  UserRole,
  CashBankAccount,
  SalesReturn,
  PurchaseReturn,
  ReturnRefundMethod,
  AdvancePayment,
  AdvanceDirection
} from '../types';
import { HIGH_AMOUNT_CONFIRMATION_THRESHOLD } from '../constants/validation';
import { notifyUndoableAction } from '../services/undoService';
import { triggerSuccessAnimation } from './ui/SuccessAnimation';
import { CANONICAL_ACCOUNTS, getInventoryAssetAccount, getInventoryAccountDetails } from '../accounting/accountMapping';
import { SearchableSelect, SearchableOption } from './ui';

const getInventoryCategoryBadge = (category?: string): { code: string; label: string } => {
  const details = getInventoryAccountDetails(category);
  return { code: details.code, label: details.categoryLabelBn };
};

export interface ReceiptData {
  type: 'SALE' | 'PURCHASE';
  record: Sale | Purchase;
}

/**
 * Transliterates and sanitizes text for safe, crisp ASCII rendering in jsPDF standard fonts
 */
function cleanPdfText(text: any, fallback = '-'): string {
  if (text === undefined || text === null) return fallback;
  const str = String(text).trim();
  if (!str) return fallback;

  const numMap: Record<string, string> = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
  };
  let cleaned = str.replace(/[০-৯]/g, (w) => numMap[w] || w);

  const translationMap: Record<string, string> = {
    'বিক্রয়': 'Sale',
    'ক্রয়': 'Purchase',
    'চালান': 'Invoice',
    'রশিদ': 'Receipt',
    'ভাউচার': 'Voucher',
    'নগদ': 'Cash',
    'ব্যাংক': 'Bank',
    'বাকি': 'Credit',
    'পরিশোধিত': 'Paid',
    'আংশিক বাকি': 'Partial Due',
    'আংশিক': 'Partial',
    'পরিশোধ': 'Paid',
    'কেজি': 'kg',
    'লিটার': 'L',
    'বস্তা': 'Bag',
    'পিস': 'Pcs',
    'টন': 'Ton',
    'গ্রাম': 'gm',
    'ফিড': 'Feed',
    'ঘাস': 'Grass',
    'ভুট্টা': 'Corn',
    'গম': 'Wheat',
    'ভূষি': 'Bran',
    'খৈল': 'Mustard Cake',
    'দুধ': 'Milk',
    'মাছ': 'Fish',
    'পোনা': 'Fingerling',
    'ছাগল': 'Goat',
    'গরু': 'Cattle',
    'গাভী': 'Cow',
    'ভেড়া': 'Sheep',
    'মহিষ': 'Buffalo',
    'সার': 'Fertilizer',
    'বীজ': 'Seed',
    'ইউরিয়া': 'Urea',
    'ডিএপি': 'DAP',
    'পটাশ': 'Potash',
    'ওষুধ': 'Medicine',
    'টিকা': 'Vaccine',
    'পরিবহন': 'Transport',
    'খরচ': 'Cost',
    'ক্রেতা': 'Customer',
    'সরবরাহকারী': 'Supplier',
    'হ্যাঁ': 'Yes',
    'না': 'No'
  };

  for (const [bn, en] of Object.entries(translationMap)) {
    cleaned = cleaned.split(bn).join(en);
  }

  const safeStr = cleaned.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return safeStr || fallback;
}

/**
 * Generates an elegant, professional, one-page PDF receipt for a Sale or Purchase
 */
async function generateReceiptPdf(
  data: ReceiptData,
  partiesList: Party[],
  paymentsList: PaymentRecord[]
): Promise<jsPDF> {
  const isSale = data.type === 'SALE';
  const rec = data.record;
  const partyId = isSale ? (rec as Sale).customerId : (rec as Purchase).supplierId;
  const rawPartyName = isSale ? (rec as Sale).customerName : (rec as Purchase).supplierName;
  const party = partiesList.find(
    (p) =>
      p.id === partyId ||
      (p.name && rawPartyName && p.name.trim().toLowerCase() === rawPartyName.trim().toLowerCase())
  );
  const partyName = party?.name || rawPartyName || (isSale ? 'Customer' : 'Supplier');
  const partyPhone = party?.phone || '';
  const partyAddress = party?.address || '';
  const displayNumber = rec.displayNumber || rec.invoiceNumber || rec.id.slice(0, 8);
  const dateStr = rec.date || new Date().toISOString().split('T')[0];

  const total = Number(rec.grandTotal || rec.totalAmount || 0);
  const paid = Number(rec.paidAmount || 0);
  const due = Number(rec.dueAmount !== undefined ? rec.dueAmount : Math.max(0, total - paid));
  const recordPayments = paymentsList.filter((pmt) => pmt.parentId === rec.id);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // 1. Top Header Banner (Forest Green #1E5128)
  doc.setFillColor(30, 81, 40);
  doc.rect(0, 0, 210, 24, 'F');

  // Farm Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('THE GOATED FARM', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(220, 235, 220);
  doc.text('Integrated Agro ERP & Sustainable Livestock Management', 14, 16.5);
  doc.text('Dairy * Fisheries * Crops * Organic Feeds', 14, 20.5);

  // Right Header Banner: Invoice Title & Number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(isSale ? 'SALES INVOICE & RECEIPT' : 'PURCHASE VOUCHER & RECEIPT', 196, 10.5, { align: 'right' });

  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(`INVOICE #: ${cleanPdfText(displayNumber)}`, 196, 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(220, 235, 220);
  doc.text(`DATE: ${cleanPdfText(dateStr)}`, 196, 20.5, { align: 'right' });

  // 2. Metadata Cards (Two-column info box)
  // Left Box: Party Info
  doc.setDrawColor(215, 225, 215);
  doc.setFillColor(250, 253, 250);
  doc.roundedRect(14, 29, 94, 33, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 81, 40);
  doc.text(isSale ? 'BILLED TO (CUSTOMER):' : 'SUPPLIER (PURCHASED FROM):', 18, 35);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(30, 30, 30);
  doc.text(cleanPdfText(partyName).slice(0, 38), 18, 41);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  if (partyPhone) {
    doc.text(`Mobile: ${cleanPdfText(partyPhone)}`, 18, 46.5);
  } else {
    doc.text('Mobile: Not specified', 18, 46.5);
  }

  if (partyAddress) {
    doc.text(`Address: ${cleanPdfText(partyAddress).slice(0, 42)}`, 18, 51.5);
  } else {
    doc.text(`Party ID: ${cleanPdfText(partyId || 'WALK-IN')}`, 18, 51.5);
  }

  doc.text(`Payment Mode: ${cleanPdfText(rec.paymentMethod || 'CASH')}`, 18, 56.5);

  // Right Box: Invoice Summary Info
  doc.roundedRect(112, 29, 84, 33, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 81, 40);
  doc.text('INVOICE STATUS & SUMMARY:', 116, 35);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text('Invoice Ref:', 116, 41);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text(cleanPdfText(displayNumber), 150, 41);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Issue Date:', 116, 46.5);
  doc.setTextColor(30, 30, 30);
  doc.text(cleanPdfText(dateStr), 150, 46.5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Payment Status:', 116, 52);

  const statusLabel = due <= 0 ? 'FULLY PAID' : paid > 0 ? 'PARTIAL DUE' : 'UNPAID / DUE';
  if (due <= 0) {
    doc.setTextColor(21, 128, 61);
  } else if (paid > 0) {
    doc.setTextColor(202, 138, 4);
  } else {
    doc.setTextColor(185, 28, 28);
  }
  doc.setFont('helvetica', 'bold');
  doc.text(statusLabel, 150, 52);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 110, 110);
  doc.text('Recorded in Farm Ledger', 116, 57);

  // 3. Line Items Table
  let currentY = 68;

  // Table Header
  doc.setFillColor(235, 244, 235);
  doc.rect(14, currentY, 182, 8, 'F');
  doc.setDrawColor(200, 215, 200);
  doc.rect(14, currentY, 182, 8, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 70, 35);
  doc.text('#', 17, currentY + 5.5);
  doc.text('ITEM / DESCRIPTION', 27, currentY + 5.5);
  doc.text('QTY', 116, currentY + 5.5, { align: 'right' });
  doc.text('UNIT PRICE (BDT)', 152, currentY + 5.5, { align: 'right' });
  doc.text('TOTAL (BDT)', 192, currentY + 5.5, { align: 'right' });

  currentY += 8;

  const items = rec.items || [];
  let rowIndex = 1;

  items.forEach((item) => {
    const itemName = cleanPdfText(item.itemName || 'Item');
    const qtyStr = `${item.quantity || 1} ${cleanPdfText(item.unit || '')}`.trim();
    const rate = Number(item.unitPrice || item.rate || 0);
    const lineTotal = Number(item.lineTotal || item.total || (item.quantity || 1) * rate);

    if (rowIndex % 2 === 0) {
      doc.setFillColor(250, 252, 250);
      doc.rect(14, currentY, 182, 7, 'F');
    }

    doc.setDrawColor(230, 235, 230);
    doc.line(14, currentY + 7, 196, currentY + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(String(rowIndex), 17, currentY + 5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(itemName.slice(0, 48), 27, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(qtyStr, 116, currentY + 5, { align: 'right' });
    doc.text(rate.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 152, currentY + 5, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 192, currentY + 5, { align: 'right' });

    currentY += 7;
    rowIndex++;
  });

  // Transport Cost if purchase
  const transport = Number((rec as Purchase).transportCost || 0);
  if (transport > 0) {
    doc.setFillColor(254, 252, 246);
    doc.rect(14, currentY, 182, 7, 'F');
    doc.setDrawColor(230, 235, 230);
    doc.line(14, currentY + 7, 196, currentY + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(String(rowIndex), 17, currentY + 5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 60, 20);
    doc.text('Transport & Logistics Handling', 27, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text('1 trip', 116, currentY + 5, { align: 'right' });
    doc.text(transport.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 152, currentY + 5, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.text(transport.toLocaleString('en-IN', { minimumFractionDigits: 2 }), 192, currentY + 5, { align: 'right' });

    currentY += 7;
  }

  // Outer border of table
  doc.setDrawColor(200, 215, 200);
  doc.rect(14, 68, 182, currentY - 68, 'S');

  currentY += 4;

  // 4. Financial Summary Box (Right) & Installment History (Left)
  const totalsBoxY = currentY;
  const totalsBoxW = 84;
  const totalsBoxX = 112;

  const recSubtotal = Number((rec as any).subtotal || (rec as any).grandTotal || total);
  const recDiscount = Number((rec as any).discount || 0);
  const boxHeight = recDiscount > 0 ? 42 : 36;

  doc.setDrawColor(210, 225, 210);
  doc.setFillColor(252, 254, 252);
  doc.roundedRect(totalsBoxX, totalsBoxY, totalsBoxW, boxHeight, 1.5, 1.5, 'FD');

  let curLineY = totalsBoxY + 6.5;

  if (recDiscount > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text('Subtotal:', totalsBoxX + 5, curLineY);
    doc.text(`BDT ${recSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

    curLineY += 5;
    doc.setTextColor(185, 28, 28);
    doc.text('Discount:', totalsBoxX + 5, curLineY);
    doc.text(`- BDT ${recDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

    curLineY += 2;
    doc.setDrawColor(220, 230, 220);
    doc.line(totalsBoxX + 4, curLineY, totalsBoxX + totalsBoxW - 4, curLineY);
    curLineY += 5;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    doc.text('Subtotal:', totalsBoxX + 5, curLineY);
    doc.text(`BDT ${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

    curLineY += 4;
    // Divider inside totals
    doc.setDrawColor(220, 230, 220);
    doc.line(totalsBoxX + 4, curLineY, totalsBoxX + totalsBoxW - 4, curLineY);
    curLineY += 6;
  }

  // Grand Total
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text('Grand Total:', totalsBoxX + 5, curLineY);
  doc.text(`BDT ${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

  // Paid Amount
  curLineY += 7;
  doc.setFontSize(9);
  doc.setTextColor(21, 128, 61);
  doc.text('Paid Amount:', totalsBoxX + 5, curLineY);
  doc.text(`BDT ${paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

  // Due Amount
  curLineY += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  if (due > 0) {
    doc.setTextColor(185, 28, 28);
  } else {
    doc.setTextColor(21, 128, 61);
  }
  doc.text('Amount Still Due:', totalsBoxX + 5, curLineY);
  doc.text(`BDT ${due.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, totalsBoxX + totalsBoxW - 5, curLineY, { align: 'right' });

  // Left side: Payment History or Terms
  const leftBoxW = 94;
  const leftBoxX = 14;
  doc.setDrawColor(225, 230, 225);
  doc.setFillColor(254, 255, 254);
  doc.roundedRect(leftBoxX, totalsBoxY, leftBoxW, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 81, 40);
  doc.text('PAYMENT & INSTALLMENT HISTORY:', leftBoxX + 4, totalsBoxY + 6.5);

  if (recordPayments.length > 0) {
    let pmtY = totalsBoxY + 12;
    recordPayments.slice(0, 4).forEach((pmt, pIdx) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(90, 90, 90);
      doc.text(`${pIdx + 1}. Date: ${cleanPdfText(pmt.date)}`, leftBoxX + 4, pmtY);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(21, 128, 61);
      doc.text(`BDT ${Number(pmt.amount || 0).toLocaleString('en-IN')}`, leftBoxX + leftBoxW - 5, pmtY, { align: 'right' });
      pmtY += 5.5;
    });
    if (recordPayments.length > 4) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`+ ${recordPayments.length - 4} more installment(s)...`, leftBoxX + 4, pmtY);
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    if (due <= 0) {
      doc.text('Payment settled in full upon transaction issue.', leftBoxX + 4, totalsBoxY + 16);
      doc.text(`Method: ${cleanPdfText(rec.paymentMethod || 'CASH')}`, leftBoxX + 4, totalsBoxY + 22);
    } else {
      doc.text('Credit transaction. Pending installment clearance.', leftBoxX + 4, totalsBoxY + 16);
      doc.text(`Outstanding Due: BDT ${due.toLocaleString('en-IN')}`, leftBoxX + 4, totalsBoxY + 22);
    }
  }

  // 5. QR Code & Authenticity Section
  const qrSectionY = totalsBoxY + 41;

  // Generate QR Code
  try {
    const qrDataText = `The Goated Farm | ${isSale ? 'Sale' : 'Purchase'} | Inv: ${displayNumber} | Date: ${dateStr} | Total: BDT ${total} | Paid: BDT ${paid} | Due: BDT ${due}`;
    const qrDataUrl = await QRCode.toDataURL(qrDataText, { margin: 1, width: 120 });
    doc.addImage(qrDataUrl, 'PNG', 14, qrSectionY, 22, 22);
    doc.setDrawColor(210, 225, 210);
    doc.rect(14, qrSectionY, 22, 22, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 81, 40);
    doc.text('OFFICIAL DIGITAL RECORD', 39, qrSectionY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('Scan with any smartphone camera to verify', 39, qrSectionY + 11);
    doc.text(`System ID: ${cleanPdfText(rec.id).slice(0, 32)}`, 39, qrSectionY + 15.5);
    doc.text('Certified authentic entry in ERP general ledger', 39, qrSectionY + 20);
  } catch (err) {
    console.warn('QR Code embedding skipped:', err);
  }

  // Signatures
  const sigY = qrSectionY + 16;
  doc.setDrawColor(180, 190, 180);
  doc.setLineDashPattern([1, 1], 0);

  // Customer / Receiver Signature line
  doc.line(110, sigY, 145, sigY);
  // Authorized Manager Signature line
  doc.line(160, sigY, 196, sigY);

  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('Customer / Received By', 127.5, sigY + 4, { align: 'center' });
  doc.text('Authorized Signature', 178, sigY + 4, { align: 'center' });

  // 6. Bottom Clean Footer (284mm to 297mm)
  doc.setFillColor(242, 247, 242);
  doc.rect(0, 285, 210, 12, 'F');
  doc.setDrawColor(215, 230, 215);
  doc.line(0, 285, 210, 285);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 81, 40);
  doc.text('THE GOATED FARM * INTEGRATED AGRO COMMERCE & ERP', 105, 289.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(110, 125, 110);
  doc.text('For queries or support, please contact farm administration. All transactions are logged securely.', 105, 293.5, { align: 'center' });

  return doc;
}

interface Props {
  role: UserRole;
  currentUserId: string;
}

type CommerceTab = 'inventory' | 'sales' | 'purchases' | 'parties';

export const InventoryCommerceModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [tab, setTab] = useState<CommerceTab>('inventory');
  const [inventoryViewMode, setInventoryViewMode] = useState<'cards' | 'table'>('cards');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);

  const activeParty = selectedParty ? (parties.find((p) => p.id === selectedParty.id) || selectedParty) : null;

  // Invoices and payment history for the selected party
  const partyInvoices = React.useMemo(() => {
    if (!activeParty) return [];

    const matchedSales = sales
      .filter(
        (s) =>
          s.customerId === activeParty.id ||
          (s.customerName && s.customerName.trim().toLowerCase() === activeParty.name.trim().toLowerCase())
      )
      .map((s) => {
        const total = Number(s.grandTotal || s.totalAmount || 0);
        const paid = Number(s.paidAmount || 0);
        const due = Number(s.dueAmount !== undefined ? s.dueAmount : Math.max(0, total - paid));
        const invPayments = payments.filter((pmt) => pmt.parentId === s.id);
        const invReturns = salesReturns.filter((ret) => ret.saleId === s.id);
        return {
          id: s.id,
          type: 'SALE' as const,
          rawRecord: s,
          date: s.date,
          displayNumber: s.displayNumber || s.invoiceNumber,
          internalNumber: s.invoiceNumber,
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          status: due <= 0 || s.status === 'PAID' ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DUE',
          paymentMethod: s.paymentMethod,
          items: (s.items && s.items.length > 0)
            ? s.items
            : ((s as any).itemName ? [{ itemId: (s as any).itemId || '', itemName: (s as any).itemName, quantity: (s as any).quantity || 1, unitPrice: (s as any).unitPrice || total, unit: (s as any).unit || 'একক' }] : []),
          payments: invPayments,
          returns: invReturns
        };
      });

    const matchedPurchases = purchases
      .filter(
        (p) =>
          p.supplierId === activeParty.id ||
          (p.supplierName && p.supplierName.trim().toLowerCase() === activeParty.name.trim().toLowerCase())
      )
      .map((p) => {
        const total = Number(p.grandTotal || p.totalAmount || 0);
        const paid = Number(p.paidAmount || 0);
        const due = Number(p.dueAmount !== undefined ? p.dueAmount : Math.max(0, total - paid));
        const invPayments = payments.filter((pmt) => pmt.parentId === p.id);
        const invReturns = purchaseReturns.filter((ret) => ret.purchaseId === p.id);
        return {
          id: p.id,
          type: 'PURCHASE' as const,
          rawRecord: p,
          date: p.date,
          displayNumber: p.displayNumber || p.invoiceNumber,
          internalNumber: p.invoiceNumber,
          totalAmount: total,
          paidAmount: paid,
          dueAmount: due,
          status: due <= 0 || p.status === 'PAID' ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DUE',
          paymentMethod: p.paymentMethod,
          items: (p.items && p.items.length > 0)
            ? p.items
            : ((p as any).itemName ? [{ itemId: (p as any).itemId || '', itemName: (p as any).itemName, quantity: (p as any).quantity || 1, unitPrice: (p as any).unitPrice || total, unit: (p as any).unit || 'একক' }] : []),
          payments: invPayments,
          returns: invReturns
        };
      });

    const combined = [...matchedSales, ...matchedPurchases];
    // Chronological order by date (ascending)
    return combined.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  }, [activeParty, sales, purchases, payments, salesReturns, purchaseReturns]);

  const partySummary = React.useMemo(() => {
    if (!activeParty) return { totalInvoiced: 0, totalPaid: 0, totalDue: 0, runningBalance: 0 };
    const totalInvoiced = partyInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);
    const totalPaid = partyInvoices.reduce((acc, inv) => acc + inv.paidAmount, 0);
    const totalDue = partyInvoices.reduce((acc, inv) => acc + inv.dueAmount, 0);
    const runningBalance = totalDue > 0 ? totalDue : (activeParty.balance || 0);
    return { totalInvoiced, totalPaid, totalDue, runningBalance };
  }, [activeParty, partyInvoices]);

  // Memoized options for customers and suppliers
  const customerOptions = React.useMemo<SearchableOption[]>(() => {
    return parties
      .filter((p) => p.type === 'CUSTOMER')
      .map((c) => ({
        value: c.id,
        label: c.name,
        code: c.phone || undefined,
        secondaryLabel: c.address || 'ক্রেতা'
      }));
  }, [parties]);

  const supplierOptions = React.useMemo<SearchableOption[]>(() => {
    return parties
      .filter((p) => p.type === 'SUPPLIER')
      .map((s) => ({
        value: s.id,
        label: s.name,
        code: s.phone || undefined,
        secondaryLabel: s.address || 'সরবরাহকারী'
      }));
  }, [parties]);

  // High amount transaction confirmation modal state
  const [confirmHighAmountCommerce, setConfirmHighAmountCommerce] = useState<{
    amount: number;
    type: 'SALE' | 'PURCHASE';
  } | null>(null);

  // Receipt Modal State
  const [receiptModal, setReceiptModal] = useState<ReceiptData | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [modalQrUrl, setModalQrUrl] = useState<string>('');

  useEffect(() => {
    if (!receiptModal) {
      setModalQrUrl('');
      return;
    }
    const rec = receiptModal.record;
    const num = rec.displayNumber || rec.invoiceNumber || rec.id;
    const qrData = `The Goated Farm | ${receiptModal.type} | #${num} | Date: ${rec.date} | Total: BDT ${rec.grandTotal || rec.totalAmount || 0} | Paid: BDT ${rec.paidAmount || 0}`;
    QRCode.toDataURL(qrData, { margin: 1, width: 140 })
      .then((url) => setModalQrUrl(url))
      .catch((err) => console.warn('QR error:', err));
  }, [receiptModal]);

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
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [paymentBankAccountId, setPaymentBankAccountId] = useState<string>('');
  const [cashBankAccounts, setCashBankAccounts] = useState<CashBankAccount[]>([]);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Advance Feature States
  const [advancePayments, setAdvancePayments] = useState<AdvancePayment[]>([]);
  const [showAdvanceModal, setShowAdvanceModal] = useState<boolean>(false);
  const [advPartyId, setAdvPartyId] = useState<string>('');
  const [advDirection, setAdvDirection] = useState<AdvanceDirection>('RECEIVED');
  const [advAmount, setAdvAmount] = useState<string>('');
  const [advPaymentMethod, setAdvPaymentMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [advBankAccountId, setAdvBankAccountId] = useState<string>('');
  const [advCashBankAccountId, setAdvCashBankAccountId] = useState<string>('');
  const [advDate, setAdvDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [advNarration, setAdvNarration] = useState<string>('');
  const [isSubmittingAdvance, setIsSubmittingAdvance] = useState<boolean>(false);

  // Advance Application during Sale/Purchase
  const [saleAdvanceApplied, setSaleAdvanceApplied] = useState<string>('');
  const [purchAdvanceApplied, setPurchAdvanceApplied] = useState<string>('');

  // Memoized options for advance modal parties
  const advancePartyOptions = React.useMemo<SearchableOption[]>(() => {
    return parties
      .filter((p) => {
        if (advDirection === 'RECEIVED') {
          return p.type === 'CUSTOMER' || (p.type as string) === 'BOTH';
        } else {
          return p.type === 'SUPPLIER' || (p.type as string) === 'BOTH';
        }
      })
      .map((p) => ({
        value: p.id,
        label: p.name,
        code: p.phone || undefined,
        secondaryLabel: p.type === 'CUSTOMER' ? 'ক্রেতা' : p.type === 'SUPPLIER' ? 'সরবরাহকারী' : 'উভয়'
      }));
  }, [parties, advDirection]);

  // Add Item Modal
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemNameBn, setItemNameBn] = useState('');
  const [itemCategory, setItemCategory] = useState<InventoryItem['category']>('FEED');
  const [itemUnit, setItemUnit] = useState('কেজি');
  const [itemStock, setItemStock] = useState('0');
  const [itemCost, setItemCost] = useState('0');
  const [itemPrice, setItemPrice] = useState('0');
  const [itemReorder, setItemReorder] = useState('10');
  const [itemThreshold, setItemThreshold] = useState('');
  const [editingThresholdItem, setEditingThresholdItem] = useState<InventoryItem | null>(null);
  const [newThresholdValue, setNewThresholdValue] = useState('');

  // VAT/TIN Registered Business State (stored in local settings, off by default)
  const [isVatRegistered, setIsVatRegistered] = useState<boolean>(() => {
    return localStorage.getItem('goted_vat_registered') === 'true';
  });

  // Multi-line Voucher Line Item Interface
  interface VoucherLineItem {
    id: string;
    itemId: string;
    quantity: string;
    unitPrice: string;
    vatRatePercent?: string;
  }

  // New Sale Form
  const [showNewSale, setShowNewSale] = useState(false);
  const [saleDate, setSaleDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [saleCustomerId, setSaleCustomerId] = useState('');
  const [saleItemId, setSaleItemId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleUnitPrice, setSaleUnitPrice] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('');
  const [saleDiscountType, setSaleDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [saleVatRate, setSaleVatRate] = useState('0');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');
  const [saleLines, setSaleLines] = useState<VoucherLineItem[]>([
    { id: 'sale_line_1', itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }
  ]);

  // New Purchase Form
  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [purchDate, setPurchDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [purchSupplierId, setPurchSupplierId] = useState('');
  const [purchItemId, setPurchItemId] = useState('');
  const [purchQty, setPurchQty] = useState('1');
  const [purchUnitPrice, setPurchUnitPrice] = useState('');
  const [purchTransportCost, setPurchTransportCost] = useState('0');
  const [purchDiscount, setPurchDiscount] = useState('');
  const [purchDiscountType, setPurchDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [purchVatRate, setPurchVatRate] = useState('0');
  const [purchPaymentMethod, setPurchPaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');
  const [purchLines, setPurchLines] = useState<VoucherLineItem[]>([
    { id: 'purch_line_1', itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }
  ]);

  // Multi-line Sale Handlers
  const resetSaleForm = () => {
    setSaleLines([{ id: 'sale_line_1', itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }]);
    setSaleItemId('');
    setSaleQty('1');
    setSaleUnitPrice('');
    setSaleDiscount('');
    setSaleDiscountType('FIXED');
    setSaleVatRate('0');
    setSaleAdvanceApplied('');
    setSaleCustomerId('');
    setSaleDate(new Date().toISOString().split('T')[0]);
  };

  const handleAddSaleLine = () => {
    setSaleLines((prev) => [
      ...prev,
      {
        id: 'sale_line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        itemId: '',
        quantity: '1',
        unitPrice: '',
        vatRatePercent: '0'
      }
    ]);
  };

  const handleRemoveSaleLine = (index: number) => {
    setSaleLines((prev) => {
      if (prev.length <= 1) {
        setSaleItemId('');
        setSaleQty('1');
        setSaleUnitPrice('');
        return [{ id: 'sale_line_' + Date.now(), itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }];
      }
      const next = prev.filter((_, i) => i !== index);
      if (next[0]) {
        setSaleItemId(next[0].itemId);
        setSaleQty(next[0].quantity);
        setSaleUnitPrice(next[0].unitPrice);
      }
      return next;
    });
  };

  const handleUpdateSaleLine = (index: number, field: keyof VoucherLineItem, value: string) => {
    setSaleLines((prev) => {
      const updated = [...prev];
      const current = { ...updated[index], [field]: value };
      if (field === 'itemId') {
        const selectedItem = items.find((i) => i.id === value);
        if (selectedItem && selectedItem.sellingPrice > 0) {
          current.unitPrice = selectedItem.sellingPrice.toString();
        }
      }
      updated[index] = current;
      if (index === 0) {
        if (field === 'itemId') setSaleItemId(value);
        if (field === 'quantity') setSaleQty(value);
        if (field === 'unitPrice') setSaleUnitPrice(value);
      }
      return updated;
    });
  };

  // Multi-line Purchase Handlers
  const resetPurchForm = () => {
    setPurchLines([{ id: 'purch_line_1', itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }]);
    setPurchItemId('');
    setPurchQty('1');
    setPurchUnitPrice('');
    setPurchTransportCost('0');
    setPurchDiscount('');
    setPurchDiscountType('FIXED');
    setPurchVatRate('0');
    setPurchAdvanceApplied('');
    setPurchSupplierId('');
    setPurchDate(new Date().toISOString().split('T')[0]);
  };

  const handleAddPurchLine = () => {
    setPurchLines((prev) => [
      ...prev,
      {
        id: 'purch_line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        itemId: '',
        quantity: '1',
        unitPrice: '',
        vatRatePercent: '0'
      }
    ]);
  };

  const handleRemovePurchLine = (index: number) => {
    setPurchLines((prev) => {
      if (prev.length <= 1) {
        setPurchItemId('');
        setPurchQty('1');
        setPurchUnitPrice('');
        return [{ id: 'purch_line_' + Date.now(), itemId: '', quantity: '1', unitPrice: '', vatRatePercent: '0' }];
      }
      const next = prev.filter((_, i) => i !== index);
      if (next[0]) {
        setPurchItemId(next[0].itemId);
        setPurchQty(next[0].quantity);
        setPurchUnitPrice(next[0].unitPrice);
      }
      return next;
    });
  };

  const handleUpdatePurchLine = (index: number, field: keyof VoucherLineItem, value: string) => {
    setPurchLines((prev) => {
      const updated = [...prev];
      const current = { ...updated[index], [field]: value };
      if (field === 'itemId') {
        const selectedItem = items.find((i) => i.id === value);
        if (selectedItem && selectedItem.avgCostPrice > 0) {
          current.unitPrice = selectedItem.avgCostPrice.toString();
        }
      }
      updated[index] = current;
      if (index === 0) {
        if (field === 'itemId') setPurchItemId(value);
        if (field === 'quantity') setPurchQty(value);
        if (field === 'unitPrice') setPurchUnitPrice(value);
      }
      return updated;
    });
  };

  // Add Party Modal
  const [showAddParty, setShowAddParty] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [partyType, setPartyType] = useState<Party['type']>('CUSTOMER');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyAddress, setPartyAddress] = useState('');

  // Return Feature States
  const [returnModal, setReturnModal] = useState<{
    type: 'SALE' | 'PURCHASE';
    invoiceId: string;
    invoiceNumber: string;
    partyName: string;
    partyId: string;
    items: Array<{
      itemId: string;
      itemName: string;
      unit: string;
      soldOrPurchasedQty: number;
      previouslyReturnedQty: number;
      remainingReturnableQty: number;
      unitPrice: number;
      currentWarehouseStock: number;
    }>;
    selectedItemId: string;
  } | null>(null);
  const [returnSelectedItemId, setReturnSelectedItemId] = useState<string>('');
  const [returnQuantity, setReturnQuantity] = useState<string>('');
  const [returnReason, setReturnReason] = useState<string>('');
  const [returnRefundMethod, setReturnRefundMethod] = useState<ReturnRefundMethod>('ADJUST_DUE');
  const [returnBankAccountId, setReturnBankAccountId] = useState<string>('');
  const [returnCashBankAccountId, setReturnCashBankAccountId] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isSubmittingReturn, setIsSubmittingReturn] = useState<boolean>(false);

  // Available customer advance for the selected sale customer
  const availableCustomerAdvance = React.useMemo(() => {
    if (!saleCustomerId) return 0;
    return advancePayments
      .filter(
        (a) =>
          (a.partyId === saleCustomerId || (a.party as any)?.id === saleCustomerId) &&
          a.direction === 'RECEIVED' &&
          Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0) > 0
      )
      .reduce((sum, a) => sum + Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0), 0);
  }, [saleCustomerId, advancePayments]);

  // Available supplier advance for the selected purchase supplier
  const availableSupplierAdvance = React.useMemo(() => {
    if (!purchSupplierId) return 0;
    return advancePayments
      .filter(
        (a) =>
          (a.partyId === purchSupplierId || (a.party as any)?.id === purchSupplierId) &&
          a.direction === 'PAID' &&
          Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0) > 0
      )
      .reduce((sum, a) => sum + Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0), 0);
  }, [purchSupplierId, advancePayments]);

  // Current advance balance for active selected party in party statement
  const partyAdvanceBalance = React.useMemo(() => {
    if (!activeParty) return 0;
    const dir: AdvanceDirection = activeParty.type === 'CUSTOMER' ? 'RECEIVED' : 'PAID';
    return advancePayments
      .filter(
        (a) =>
          (a.partyId === activeParty.id || (a.party as any)?.id === activeParty.id) &&
          a.direction === dir &&
          Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0) > 0
      )
      .reduce((sum, a) => sum + Number(a.remainingBalance ?? a.remainingUnappliedBalance ?? 0), 0);
  }, [activeParty, advancePayments]);

  // All advance records for active selected party
  const partyAdvanceRecords = React.useMemo(() => {
    if (!activeParty) return [];
    return advancePayments.filter(
      (a) => a.partyId === activeParty.id || (a.party as any)?.id === activeParty.id
    );
  }, [activeParty, advancePayments]);

  useEffect(() => {
    loadCommerceData();
  }, [tab]);

  useEffect(() => {
    const handleDataChanged = () => {
      loadCommerceData();
    };
    const handleSettingsChanged = () => {
      setIsVatRegistered(localStorage.getItem('goted_vat_registered') === 'true');
    };
    window.addEventListener('goted_data_changed', handleDataChanged);
    window.addEventListener('goted_settings_changed', handleSettingsChanged);
    return () => {
      window.removeEventListener('goted_data_changed', handleDataChanged);
      window.removeEventListener('goted_settings_changed', handleSettingsChanged);
    };
  }, []);

  const loadCommerceData = async () => {
    setLoading(true);
    try {
      // Load inventory items from database without auto-seeding
      const itemList = await db.inventoryItems.toArray();
      setItems(itemList);

      // Load parties from database without auto-seeding
      const partyList = await db.parties.toArray();
      setParties(partyList);

      const pmtList = await db.payments.toArray();
      setPayments(pmtList);

      const bankList = await db.cashBankAccounts.toArray();
      setCashBankAccounts(bankList);

      const sReturns = db.salesReturns ? await db.salesReturns.orderBy('date').reverse().toArray() : [];
      setSalesReturns(sReturns);

      const pReturns = db.purchaseReturns ? await db.purchaseReturns.orderBy('date').reverse().toArray() : [];
      setPurchaseReturns(pReturns);

      const advList = db.advancePayments ? await db.advancePayments.orderBy('date').reverse().toArray() : [];
      setAdvancePayments(advList);

      if (tab === 'sales' || tab === 'parties') {
        const sList = await db.sales.orderBy('date').reverse().toArray();
        setSales(sList);
      }
      if (tab === 'purchases' || tab === 'parties') {
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
      const stockNum = parseFloat(itemStock) || 0;
      const reorderNum = parseFloat(itemReorder) || 10;
      const costNum = parseFloat(itemCost) || 0;
      const priceNum = parseFloat(itemPrice) || 0;
      const effectiveUnitCost = costNum > 0 ? costNum : (priceNum > 0 ? priceNum : 0);
      const totalOpeningValue = Math.round(stockNum * effectiveUnitCost * 100) / 100;

      const customThreshold = itemThreshold.trim() !== '' ? parseFloat(itemThreshold) : undefined;
      const defaultThreshold = Math.round((stockNum > 0 ? stockNum : reorderNum) * 0.20 * 100) / 100;
      const finalThreshold = customThreshold !== undefined && !isNaN(customThreshold) ? customThreshold : defaultThreshold;

      const { item, journalEntryId: postedJournalEntryId } = await executeInventoryItemCreationTransaction({
        itemData: {
          nameBn: itemNameBn.trim(),
          nameEn: itemNameBn.trim(),
          category: itemCategory,
          unit: itemUnit.trim() || 'কেজি',
          currentStock: stockNum,
          reorderLevel: reorderNum,
          avgCostPrice: effectiveUnitCost,
          sellingPrice: priceNum,
          lowStockThreshold: finalThreshold
        },
        currentUserId: currentUserId || 'system'
      });

      setShowAddItem(false);
      setItemNameBn('');
      setItemStock('0');
      setItemCost('0');
      setItemPrice('0');
      setItemReorder('10');
      setItemThreshold('');
      setMsg({
        type: 'success',
        text: `পণ্য ${item.nameBn} যুক্ত হয়েছে!${postedJournalEntryId ? ' (প্রারম্ভিক মজুদ জাবেদা দাখিলা সম্পন্ন হয়েছে)' : ''}`
      });
      triggerSuccessAnimation('পণ্য সফলভাবে যুক্ত হয়েছে!', item.nameBn);
      window.dispatchEvent(new CustomEvent('goted_data_changed'));
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleSaveThreshold = async (item: InventoryItem, thresholdVal: number) => {
    try {
      await db.inventoryItems.update(item.id, {
        lowStockThreshold: thresholdVal,
        reorderLevel: thresholdVal,
        synced: false
      });
      setEditingThresholdItem(null);
      setMsg({ type: 'success', text: `${item.nameBn} এর সতর্কতার সীমা ৳${thresholdVal} ${item.unit} আপডেট হয়েছে!` });
      triggerSuccessAnimation('সতর্কতার সীমা হালনাগাদ হয়েছে!', `${item.nameBn}: ${thresholdVal} ${item.unit}`);
      window.dispatchEvent(new CustomEvent('goted_data_changed'));
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
      triggerSuccessAnimation('পার্টি সংরক্ষিত হয়েছে!', pty.name);
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  // Discount calculation helpers
  const calcSaleDiscountAmount = (subtotal: number, discVal: string, discType: 'FIXED' | 'PERCENT') => {
    const val = parseFloat(discVal) || 0;
    if (val <= 0) return 0;
    if (discType === 'PERCENT') {
      return Math.round(subtotal * (val / 100) * 100) / 100;
    }
    return Math.round(val * 100) / 100;
  };

  const calcPurchDiscountAmount = (subtotal: number, discVal: string, discType: 'FIXED' | 'PERCENT') => {
    const val = parseFloat(discVal) || 0;
    if (val <= 0) return 0;
    if (discType === 'PERCENT') {
      return Math.round(subtotal * (val / 100) * 100) / 100;
    }
    return Math.round(val * 100) / 100;
  };

  // EXECUTE SALE WITH ATOMIC TRANSACTION & CANONICAL MAPPINGS
  const executeSaveSale = async () => {
    const customer = parties.find((p) => p.id === saleCustomerId);
    if (!customer) return;

    // Collect all valid line inputs
    const lineInputs: SaleLineInput[] = [];
    for (const line of saleLines) {
      const it = items.find((i) => i.id === line.itemId);
      if (!it) continue;
      const q = parseFloat(line.quantity) || 0;
      const p = parseFloat(line.unitPrice) || it.sellingPrice || 0;
      const vatRate = isVatRegistered ? (parseFloat(line.vatRatePercent || saleVatRate || '0') || 0) : 0;
      lineInputs.push({
        item: it,
        quantity: q,
        unitPrice: p,
        vatRatePercent: vatRate
      });
    }

    if (lineInputs.length === 0) return;

    const subtotal = lineInputs.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);
    const discountAmount = Math.min(subtotal, Math.max(0, calcSaleDiscountAmount(subtotal, saleDiscount, saleDiscountType)));
    const advanceApplied = parseFloat(saleAdvanceApplied) || 0;

    try {
      const res = await executeSaleTransaction({
        customer,
        items: lineInputs,
        discount: discountAmount,
        isVatRegistered,
        paymentMethod: salePaymentMethod,
        advanceAppliedAmount: advanceApplied > 0 ? advanceApplied : undefined,
        currentUserId,
        date: saleDate
      });

      setShowNewSale(false);
      resetSaleForm();
      setMsg({
        type: 'success',
        text: `বিক্রয় চালান ${res.sale.displayNumber || res.sale.invoiceNumber} (৳${res.sale.totalAmount}) সফলভাবে সম্পন্ন এবং দ্বৈত-দাখিলায় পোস্ট হয়েছে!`
      });
      triggerSuccessAnimation('বিক্রয় চালান সফলভাবে তৈরি হয়েছে!', `চালান: ${res.sale.displayNumber || res.sale.invoiceNumber} (৳${res.sale.totalAmount.toLocaleString()})`);
      if (lineInputs[0]) {
        notifyUndoableAction({
          type: 'SALE',
          saleId: res.sale.id,
          journalEntryId: res.journalEntryId,
          itemId: lineInputs[0].item.id,
          quantity: lineInputs[0].quantity,
          customerId: customer.id,
          totalAmount: res.sale.totalAmount,
          paymentMethod: salePaymentMethod,
          currentUserId
        });
      }
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'বিক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  const handleCreateSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleCustomerId) {
      setMsg({ type: 'error', text: 'ক্রেতা নির্বাচন করুন।' });
      return;
    }

    const customer = parties.find((p) => p.id === saleCustomerId);
    if (!customer) {
      setMsg({ type: 'error', text: 'সঠিক ক্রেতা পাওয়া যায়নি।' });
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

    if (!saleLines || saleLines.length === 0) {
      setMsg({ type: 'error', text: 'কমপক্ষে একটি বিক্রয় পণ্য লাইন যোগ করুন।' });
      return;
    }

    // Atomic validation across all sale lines
    const seenItemIds = new Set<string>();
    let totalSubtotal = 0;
    let totalVat = 0;

    for (let idx = 0; idx < saleLines.length; idx++) {
      const line = saleLines[idx];
      if (!line.itemId) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1}: পণ্য নির্বাচন করুন।` });
        return;
      }
      if (seenItemIds.has(line.itemId)) {
        const dupItem = items.find((i) => i.id === line.itemId);
        setMsg({
          type: 'error',
          text: `লাইন #${idx + 1}: "${dupItem?.nameBn || 'পণ্য'}" একই চালানে একাধিকবার যোগ করা হয়েছে। অনুগ্রহ করে পরিমাণ একত্রিত করুন।`
        });
        return;
      }
      seenItemIds.add(line.itemId);

      const it = items.find((i) => i.id === line.itemId);
      if (!it) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1}: নির্বাচিত পণ্য পাওয়া যায়নি।` });
        return;
      }

      const qty = parseFloat(line.quantity) || 0;
      const price = parseFloat(line.unitPrice) || it.sellingPrice || 0;

      if (qty <= 0 || price <= 0) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1} (${it.nameBn}): পরিমাণ ও দর ০ এর বেশি হতে হবে।` });
        return;
      }

      if (it.currentStock < qty) {
        setMsg({
          type: 'error',
          text: `লাইন #${idx + 1} (${it.nameBn}): পর্যাপ্ত স্টক নেই (অনুরোধ: ${qty} ${it.unit}, মজুদ: ${it.currentStock} ${it.unit})। সমগ্র চালানটি স্থগিত করা হয়েছে।`
        });
        return;
      }

      const lineSub = Math.round(qty * price * 100) / 100;
      const vatRate = isVatRegistered ? (parseFloat(line.vatRatePercent || saleVatRate || '0') || 0) : 0;
      const lineVat = vatRate > 0 ? Math.round(lineSub * (vatRate / 100) * 100) / 100 : 0;

      totalSubtotal += lineSub;
      totalVat += lineVat;
    }

    const discountAmount = Math.min(totalSubtotal, Math.max(0, calcSaleDiscountAmount(totalSubtotal, saleDiscount, saleDiscountType)));
    const netBeforeVat = Math.max(0, Math.round((totalSubtotal - discountAmount) * 100) / 100);
    const totalAmount = Math.max(0, Math.round((netBeforeVat + totalVat) * 100) / 100);

    if (totalAmount <= 0) {
      setMsg({ type: 'error', text: 'মূল্যছাড়ের পর চালানের সর্বমোট মূল্য ০ এর বেশি হতে হবে।' });
      return;
    }

    const advanceApplied = parseFloat(saleAdvanceApplied) || 0;
    if (advanceApplied > availableCustomerAdvance) {
      setMsg({
        type: 'error',
        text: `অগ্রিম সমন্বয় (৳${advanceApplied}) উপলব্ধ অগ্রিম ব্যালেন্সের (৳${availableCustomerAdvance}) চেয়ে বেশি হতে পারে না।`
      });
      return;
    }
    if (advanceApplied > totalAmount) {
      setMsg({
        type: 'error',
        text: `অগ্রিম সমন্বয় (৳${advanceApplied}) চালানের মোট মূল্যের (৳${totalAmount}) চেয়ে বেশি হতে পারে না।`
      });
      return;
    }

    if (totalAmount > HIGH_AMOUNT_CONFIRMATION_THRESHOLD) {
      setConfirmHighAmountCommerce({ amount: totalAmount, type: 'SALE' });
      return;
    }

    await executeSaveSale();
  };

  // EXECUTE PURCHASE WITH ATOMIC TRANSACTION & CANONICAL MAPPINGS
  const executeSavePurchase = async () => {
    const supplier = parties.find((p) => p.id === purchSupplierId);
    if (!supplier) return;

    // Collect all valid line inputs
    const lineInputs: PurchaseLineInput[] = [];
    for (const line of purchLines) {
      const it = items.find((i) => i.id === line.itemId);
      if (!it) continue;
      const q = parseFloat(line.quantity) || 0;
      const p = parseFloat(line.unitPrice) || it.avgCostPrice || 0;
      const vatRate = isVatRegistered ? (parseFloat(line.vatRatePercent || purchVatRate || '0') || 0) : 0;
      lineInputs.push({
        item: it,
        quantity: q,
        unitPrice: p,
        vatRatePercent: vatRate
      });
    }

    if (lineInputs.length === 0) return;

    const itemsTotal = lineInputs.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);
    const transport = parseFloat(purchTransportCost) || 0;
    const discountAmount = Math.min(itemsTotal + transport, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
    const advanceApplied = parseFloat(purchAdvanceApplied) || 0;

    try {
      const res = await executePurchaseTransaction({
        supplier,
        items: lineInputs,
        transportCost: transport,
        discount: discountAmount,
        isVatRegistered,
        paymentMethod: purchPaymentMethod,
        advanceAppliedAmount: advanceApplied > 0 ? advanceApplied : undefined,
        currentUserId,
        date: purchDate
      });

      setShowNewPurchase(false);
      resetPurchForm();
      setMsg({
        type: 'success',
        text: `ক্রয় চালান ${res.purchase.displayNumber || res.purchase.invoiceNumber} (৳${res.purchase.grandTotal}) সফলভাবে সংরক্ষিত এবং স্টকে যুক্ত হয়েছে!`
      });
      triggerSuccessAnimation('ক্রয় চালান সফলভাবে সংরক্ষিত হয়েছে!', `চালান: ${res.purchase.displayNumber || res.purchase.invoiceNumber} (৳${res.purchase.grandTotal.toLocaleString()})`);
      if (lineInputs[0]) {
        notifyUndoableAction({
          type: 'PURCHASE',
          purchaseId: res.purchase.id,
          journalEntryId: res.journalEntryId,
          itemId: lineInputs[0].item.id,
          quantity: lineInputs[0].quantity,
          supplierId: supplier.id,
          grandTotal: res.purchase.grandTotal,
          paymentMethod: purchPaymentMethod,
          currentUserId
        });
      }
      loadCommerceData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'ক্রয় লেনদেন ব্যর্থ হয়েছে।' });
    }
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchSupplierId) {
      setMsg({ type: 'error', text: 'সরবরাহকারী নির্বাচন করুন।' });
      return;
    }

    const supplier = parties.find((p) => p.id === purchSupplierId);
    if (!supplier) {
      setMsg({ type: 'error', text: 'সঠিক সরবরাহকারী পাওয়া যায়নি।' });
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

    if (!purchLines || purchLines.length === 0) {
      setMsg({ type: 'error', text: 'কমপক্ষে একটি ক্রয় পণ্য লাইন যোগ করুন।' });
      return;
    }

    // Atomic validation across all purchase lines
    const seenItemIds = new Set<string>();
    let itemsTotal = 0;
    let totalVat = 0;

    for (let idx = 0; idx < purchLines.length; idx++) {
      const line = purchLines[idx];
      if (!line.itemId) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1}: পণ্য নির্বাচন করুন।` });
        return;
      }
      if (seenItemIds.has(line.itemId)) {
        const dupItem = items.find((i) => i.id === line.itemId);
        setMsg({
          type: 'error',
          text: `লাইন #${idx + 1}: "${dupItem?.nameBn || 'পণ্য'}" একই চালানে একাধিকবার যোগ করা হয়েছে। অনুগ্রহ করে পরিমাণ একত্রিত করুন।`
        });
        return;
      }
      seenItemIds.add(line.itemId);

      const it = items.find((i) => i.id === line.itemId);
      if (!it) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1}: নির্বাচিত পণ্য পাওয়া যায়নি।` });
        return;
      }

      const qty = parseFloat(line.quantity) || 0;
      const price = parseFloat(line.unitPrice) || it.avgCostPrice || 0;

      if (qty <= 0 || price <= 0) {
        setMsg({ type: 'error', text: `লাইন #${idx + 1} (${it.nameBn}): পরিমাণ ও দর ০ এর বেশি হতে হবে।` });
        return;
      }

      const lineSub = Math.round(qty * price * 100) / 100;
      const vatRate = isVatRegistered ? (parseFloat(line.vatRatePercent || purchVatRate || '0') || 0) : 0;
      const lineVat = vatRate > 0 ? Math.round(lineSub * (vatRate / 100) * 100) / 100 : 0;

      itemsTotal += lineSub;
      totalVat += lineVat;
    }

    const transport = parseFloat(purchTransportCost) || 0;
    const discountAmount = Math.min(itemsTotal + transport, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
    const netBeforeVat = Math.max(0, Math.round((itemsTotal + transport - discountAmount) * 100) / 100);
    const grandTotal = Math.max(0, Math.round((netBeforeVat + totalVat) * 100) / 100);

    if (grandTotal <= 0) {
      setMsg({ type: 'error', text: 'মূল্যছাড়ের পর চালানের সর্বমোট মূল্য ০ এর বেশি হতে হবে।' });
      return;
    }

    const advanceApplied = parseFloat(purchAdvanceApplied) || 0;
    if (advanceApplied > availableSupplierAdvance) {
      setMsg({
        type: 'error',
        text: `অগ্রিম সমন্বয় (৳${advanceApplied}) উপলব্ধ অগ্রিম ব্যালেন্সের (৳${availableSupplierAdvance}) চেয়ে বেশি হতে পারে না।`
      });
      return;
    }
    if (advanceApplied > grandTotal) {
      setMsg({
        type: 'error',
        text: `অগ্রিম সমন্বয় (৳${advanceApplied}) চালানের মোট মূল্যের (৳${grandTotal}) চেয়ে বেশি হতে পারে না।`
      });
      return;
    }

    if (grandTotal > HIGH_AMOUNT_CONFIRMATION_THRESHOLD) {
      setConfirmHighAmountCommerce({ amount: grandTotal, type: 'PURCHASE' });
      return;
    }

    await executeSavePurchase();
  };

  // HANDLE ADVANCE RECEIPT / PAYMENT SUBMIT
  const handleAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advPartyId) {
      setMsg({ type: 'error', text: 'অনুগ্রহ করে পক্ষ (Party) নির্বাচন করুন।' });
      return;
    }
    const targetParty = parties.find((p) => p.id === advPartyId);
    if (!targetParty) {
      setMsg({ type: 'error', text: 'নির্বাচিত পক্ষ পাওয়া যায়নি।' });
      return;
    }
    const amt = parseFloat(advAmount);
    if (isNaN(amt) || amt <= 0) {
      setMsg({ type: 'error', text: 'অগ্রিমের পরিমাণ অবশ্যই ০ এর বেশি হতে হবে।' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (advDate > todayStr) {
      setMsg({
        type: 'error',
        text: `অগ্রিমের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    if (advPaymentMethod === 'BANK' && !advBankAccountId) {
      const hasBank = cashBankAccounts.some((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING');
      if (hasBank) {
        setMsg({ type: 'error', text: 'ব্যাংক হিসাব নির্বাচন করুন।' });
        return;
      }
    }

    setIsSubmittingAdvance(true);
    try {
      const res = await executeAdvancePaymentTransaction({
        partyId: targetParty.id,
        party: targetParty,
        amount: amt,
        direction: advDirection,
        paymentMethod: advPaymentMethod,
        bankAccountId:
          advPaymentMethod === 'BANK'
            ? advBankAccountId || cashBankAccounts.find((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING')?.id
            : undefined,
        cashBankAccountId:
          advPaymentMethod === 'CASH'
            ? advCashBankAccountId || cashBankAccounts.find((b) => b.accountType === 'CASH')?.id
            : undefined,
        date: advDate,
        narration: advNarration.trim() || undefined,
        currentUserId: currentUserId || 'system'
      });

      setShowAdvanceModal(false);
      setAdvAmount('');
      setAdvNarration('');
      setAdvPartyId('');
      setMsg({
        type: 'success',
        text: `${advDirection === 'RECEIVED' ? 'গ্রাহক অগ্রিম গ্রহণ' : 'সরবরাহকারী অগ্রিম প্রদান'} ${res.advancePayment.displayNumber || res.advancePayment.advanceNumber} (৳${amt.toLocaleString('en-IN')}) সফলভাবে সম্পন্ন ও জাবেদায় পোস্ট হয়েছে!`
      });
      triggerSuccessAnimation(
        advDirection === 'RECEIVED' ? 'গ্রাহক অগ্রিম গ্রহণ সম্পন্ন হয়েছে!' : 'সরবরাহকারী অগ্রিম প্রদান সম্পন্ন হয়েছে!',
        `৳${amt.toLocaleString('en-IN')}`
      );
      window.dispatchEvent(new CustomEvent('goted_data_changed'));
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadCommerceData();
    } catch (err: any) {
      console.error(err);
      setMsg({ type: 'error', text: err.message || 'অগ্রিম লেনদেন সম্পন্ন করতে ত্রুটি হয়েছে।' });
    } finally {
      setIsSubmittingAdvance(false);
    }
  };

  const openPaymentModal = (parentType: 'SALE' | 'PURCHASE', item: Sale | Purchase) => {
    const total = Number(item.grandTotal || item.totalAmount || 0);
    const paid = Number(item.paidAmount || 0);
    const due = Number(item.dueAmount !== undefined ? item.dueAmount : Math.max(0, total - paid));
    setPaymentModal({
      parentType,
      parentId: item.id,
      invoiceNumber: item.displayNumber || item.invoiceNumber,
      partyName: 'customerName' in item ? item.customerName : item.supplierName,
      totalAmount: total,
      paidAmount: paid,
      dueAmount: due
    });
    setPaymentAmount(due > 0 ? due.toString() : '');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentNote('');
    setPaymentMethod('CASH');
    setPaymentBankAccountId('');
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModal || isSubmittingPayment) return;

    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      setMsg({ type: 'error', text: 'সঠিক কিস্তির পরিমাণ প্রদান করুন।' });
      return;
    }

    if (amt > paymentModal.dueAmount + 0.001) {
      setMsg({ type: 'error', text: `পরিশোধের পরিমাণ বর্তমান বকেয়া (৳${paymentModal.dueAmount}) এর চেয়ে বেশি হতে পারে না।` });
      return;
    }

    // Require Cash/Bank source
    const method: 'CASH' | 'BANK' = paymentMethod || 'CASH';
    if (method !== 'CASH' && method !== 'BANK') {
      setMsg({ type: 'error', text: 'পরিশোধের মাধ্যম হিসেবে অবশ্যই নগদ (Cash) বা ব্যাংক (Bank) নির্বাচন করতে হবে।' });
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const dateStr = paymentDate || todayStr;
    if (dateStr > todayStr) {
      setMsg({ type: 'error', text: `পরিশোধের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।` });
      return;
    }

    setIsSubmittingPayment(true);
    try {
      await executePaymentTransaction({
        parentType: paymentModal.parentType,
        parentId: paymentModal.parentId,
        amount: amt,
        paymentMethod: method,
        bankAccountId: paymentBankAccountId || undefined,
        date: dateStr,
        note: paymentNote,
        currentUserId
      });

      setPaymentModal(null);
      setMsg({ type: 'success', text: `৳${amt.toLocaleString()} কিস্তি সফলভাবে সংরক্ষিত হয়েছে!` });
      triggerSuccessAnimation(
        'কিস্তি পরিশোধ সফলভাবে সংরক্ষিত হয়েছে!',
        `চালান নং: ${paymentModal.invoiceNumber} (৳${amt.toLocaleString()})`
      );
      await loadCommerceData();
    } catch (err: any) {
      console.error(err);
      setMsg({ type: 'error', text: err.message || 'কিস্তি সংরক্ষণে ত্রুটি হয়েছে।' });
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  // Return Tracking Helpers
  const getItemReturnedQtyForSale = (saleId: string, itemId: string): number => {
    let returned = 0;
    for (const sr of salesReturns) {
      if (sr.saleId === saleId) {
        for (const it of sr.items || []) {
          if (it.itemId === itemId) {
            returned += Number(it.returnedQuantity) || 0;
          }
        }
      }
    }
    return Math.round(returned * 1000) / 1000;
  };

  const getItemReturnedQtyForPurchase = (purchaseId: string, itemId: string): number => {
    let returned = 0;
    for (const pr of purchaseReturns) {
      if (pr.purchaseId === purchaseId) {
        for (const it of pr.items || []) {
          if (it.itemId === itemId) {
            returned += Number(it.returnedQuantity) || 0;
          }
        }
      }
    }
    return Math.round(returned * 1000) / 1000;
  };

  const openReturnModal = (type: 'SALE' | 'PURCHASE', record: Sale | Purchase, defaultItemId?: string) => {
    const isSale = type === 'SALE';
    const saleRecord = isSale ? (record as Sale) : null;

    const mappedItems = (record.items || []).map((item) => {
      const invItem = items.find((it) => it.id === item.itemId);
      const unit = invItem?.unit || 'কেজি';
      const soldOrPurchasedQty = Number(item.quantity) || 0;
      const previouslyReturnedQty = isSale
        ? getItemReturnedQtyForSale(record.id, item.itemId)
        : getItemReturnedQtyForPurchase(record.id, item.itemId);
      const remainingReturnableQty = Math.max(0, Math.round((soldOrPurchasedQty - previouslyReturnedQty) * 1000) / 1000);

      let unitPrice = 0;
      if (isSale) {
        if (item.lineTotal && item.quantity > 0) {
          const effectiveDiscountRatio =
            saleRecord?.subtotal && saleRecord.subtotal > 0 && saleRecord.discount
              ? 1 - saleRecord.discount / saleRecord.subtotal
              : 1;
          unitPrice = Math.round((item.lineTotal / item.quantity) * effectiveDiscountRatio * 100) / 100;
        } else {
          unitPrice = item.unitPrice || 0;
        }
      } else {
        if (item.lineTotal && item.quantity > 0) {
          unitPrice = Math.round((item.lineTotal / item.quantity) * 100) / 100;
        } else {
          unitPrice = item.unitPrice || 0;
        }
      }

      return {
        itemId: item.itemId,
        itemName: item.itemName || invItem?.nameBn || 'পণ্য',
        unit,
        soldOrPurchasedQty,
        previouslyReturnedQty,
        remainingReturnableQty,
        unitPrice,
        currentWarehouseStock: invItem ? Number(invItem.currentStock || 0) : 0
      };
    });

    let selected = mappedItems.find((it) => it.itemId === defaultItemId && it.remainingReturnableQty > 0);
    if (!selected) {
      selected = mappedItems.find((it) => it.remainingReturnableQty > 0) || mappedItems[0];
    }

    const selectedId = selected?.itemId || (mappedItems[0]?.itemId ?? '');
    const initialQty = selected && selected.remainingReturnableQty > 0 ? selected.remainingReturnableQty.toString() : '0';

    const due = Number(
      record.dueAmount !== undefined
        ? record.dueAmount
        : Math.max(0, (record.grandTotal || record.totalAmount || 0) - (record.paidAmount || 0))
    );
    const defaultRefundMethod: ReturnRefundMethod = due > 0 ? 'ADJUST_DUE' : 'CASH';

    const defaultBankAcc =
      cashBankAccounts.find((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING')?.id || '';
    const defaultCashAcc = cashBankAccounts.find((b) => b.accountType === 'CASH')?.id || '';

    setReturnModal({
      type,
      invoiceId: record.id,
      invoiceNumber: record.displayNumber || record.invoiceNumber,
      partyName: 'customerName' in record ? record.customerName : record.supplierName,
      partyId: 'customerId' in record ? record.customerId : record.supplierId,
      items: mappedItems,
      selectedItemId: selectedId
    });

    setReturnSelectedItemId(selectedId);
    setReturnQuantity(initialQty);
    setReturnReason('');
    setReturnRefundMethod(defaultRefundMethod);
    setReturnBankAccountId(defaultBankAcc);
    setReturnCashBankAccountId(defaultCashAcc);
    setReturnDate(new Date().toISOString().split('T')[0]);
  };

  const handleSwitchReturnItem = (itemId: string) => {
    if (!returnModal) return;
    const targetItem = returnModal.items.find((it) => it.itemId === itemId);
    setReturnSelectedItemId(itemId);
    if (targetItem) {
      setReturnQuantity(targetItem.remainingReturnableQty > 0 ? targetItem.remainingReturnableQty.toString() : '0');
    }
  };

  const handleExecuteReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModal || isSubmittingReturn) return;

    const targetItem = returnModal.items.find((it) => it.itemId === returnSelectedItemId);
    if (!targetItem) {
      setMsg({ type: 'error', text: 'ফেরতের পণ্য নির্বাচন সঠিক নয়।' });
      return;
    }

    const returnQty = parseFloat(returnQuantity);
    if (isNaN(returnQty) || returnQty <= 0) {
      setMsg({ type: 'error', text: 'সঠিক ফেরতের পরিমাণ প্রদান করুন (০ এর বেশি হতে হবে)।' });
      return;
    }

    if (returnQty > targetItem.remainingReturnableQty) {
      setMsg({
        type: 'error',
        text: `ফেরতের পরিমাণ অবশিষ্ট ফেরতযোগ্য পরিমাণের (${targetItem.remainingReturnableQty} ${targetItem.unit}) চেয়ে বেশি হতে পারে না।`
      });
      return;
    }

    if (returnModal.type === 'PURCHASE') {
      const invItem = items.find((it) => it.id === targetItem.itemId);
      if (invItem && invItem.currentStock < returnQty) {
        setMsg({
          type: 'error',
          text: `গুদামে পর্যাপ্ত মজুদ নেই (অবশিষ্ট মজুদ: ${invItem.currentStock} ${invItem.unit}, ফেরত চাওয়া হয়েছে: ${returnQty} ${targetItem.unit})।`
        });
        return;
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const dateStr = returnDate || todayStr;
    if (dateStr > todayStr) {
      setMsg({
        type: 'error',
        text: `ফেরতের তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    if (returnRefundMethod === 'BANK' && !returnBankAccountId) {
      const hasBank = cashBankAccounts.some((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING');
      if (hasBank) {
        setMsg({ type: 'error', text: 'ব্যাংক রিফান্ডের জন্য একটি ব্যাংক হিসাব নির্বাচন করুন।' });
        return;
      }
    }

    setIsSubmittingReturn(true);
    try {
      if (returnModal.type === 'SALE') {
        const res = await executeSalesReturnTransaction({
          saleId: returnModal.invoiceId,
          itemId: targetItem.itemId,
          returnedQuantity: returnQty,
          unitPrice: targetItem.unitPrice,
          reason: returnReason.trim() || undefined,
          refundMethod: returnRefundMethod,
          bankAccountId: returnRefundMethod === 'BANK' ? returnBankAccountId : undefined,
          cashBankAccountId: returnRefundMethod === 'CASH' ? returnCashBankAccountId : undefined,
          currentUserId: currentUserId || 'system',
          date: dateStr
        });

        setReturnModal(null);
        setMsg({
          type: 'success',
          text: `বিক্রয় ফেরত ক্রেডিট নোট ${res.salesReturn.displayNumber || res.salesReturn.returnNumber} (${fmt(res.salesReturn.totalRefundAmount)}) সফলভাবে সম্পন্ন ও জাবেদায় পোস্ট হয়েছে!`
        });
        triggerSuccessAnimation(
          'বিক্রয় ফেরত ক্রেডিট নোট সম্পন্ন হয়েছে!',
          `${res.salesReturn.displayNumber || res.salesReturn.returnNumber} (${fmt(res.salesReturn.totalRefundAmount)})`
        );
      } else {
        const res = await executePurchaseReturnTransaction({
          purchaseId: returnModal.invoiceId,
          itemId: targetItem.itemId,
          returnedQuantity: returnQty,
          unitPrice: targetItem.unitPrice,
          reason: returnReason.trim() || undefined,
          refundMethod: returnRefundMethod,
          bankAccountId: returnRefundMethod === 'BANK' ? returnBankAccountId : undefined,
          cashBankAccountId: returnRefundMethod === 'CASH' ? returnCashBankAccountId : undefined,
          currentUserId: currentUserId || 'system',
          date: dateStr
        });

        setReturnModal(null);
        setMsg({
          type: 'success',
          text: `ক্রয় ফেরত ডেবিট নোট ${res.purchaseReturn.displayNumber || res.purchaseReturn.returnNumber} (${fmt(res.purchaseReturn.totalRefundAmount)}) সফলভাবে সম্পন্ন ও মজুদ হ্রাস করা হয়েছে!`
        });
        triggerSuccessAnimation(
          'ক্রয় ফেরত ডেবিট নোট সম্পন্ন হয়েছে!',
          `${res.purchaseReturn.displayNumber || res.purchaseReturn.returnNumber} (${fmt(res.purchaseReturn.totalRefundAmount)})`
        );
      }

      window.dispatchEvent(new CustomEvent('goted_data_changed'));
      window.dispatchEvent(new CustomEvent('accounting_entry_posted'));
      await loadCommerceData();
    } catch (err: any) {
      console.error(err);
      setMsg({ type: 'error', text: err.message || 'পণ্য ফেরত সম্পন্ন করতে ত্রুটি হয়েছে।' });
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  const handleDownloadReceiptPdf = async (data: ReceiptData) => {
    setIsExportingPdf(true);
    try {
      const doc = await generateReceiptPdf(data, parties, payments);
      const isSale = data.type === 'SALE';
      const num = cleanPdfText(data.record.displayNumber || data.record.invoiceNumber || 'receipt');
      doc.save(`Receipt-${isSale ? 'Sale' : 'Purchase'}-${num}.pdf`);
      setMsg({ type: 'success', text: 'চালান রশিদ পিডিএফ সফলভাবে ডাউনলোড হয়েছে।' });
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      setMsg({ type: 'error', text: 'পিডিএফ রশিদ তৈরি করতে সমস্যা হয়েছে।' });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleShareReceipt = async (data: ReceiptData) => {
    setIsSharing(true);
    try {
      const isSale = data.type === 'SALE';
      const rec = data.record;
      const num = rec.displayNumber || rec.invoiceNumber || rec.id.slice(0, 8);
      const partyName = isSale ? (rec as Sale).customerName : (rec as Purchase).supplierName;
      const total = Number(rec.grandTotal || rec.totalAmount || 0);
      const paid = Number(rec.paidAmount || 0);
      const due = Number(rec.dueAmount !== undefined ? rec.dueAmount : Math.max(0, total - paid));

      const shareTitle = `The Goated Farm - ${isSale ? 'বিক্রয় চালান রশিদ' : 'ক্রয় ভাউচার রশিদ'} #${num}`;
      const shareText = `The Goated Farm\n${isSale ? 'বিক্রয় রশিদ' : 'ক্রয় ভাউচার'} #${num}\nতারিখ: ${rec.date}\n${isSale ? 'ক্রেতা' : 'সরবরাহকারী'}: ${partyName}\nসর্বমোট: ৳${Number(total).toLocaleString('en-IN')}\nপরিশোধিত: ৳${Number(paid).toLocaleString('en-IN')}\nঅবশিষ্ট বাকি: ৳${Number(due).toLocaleString('en-IN')}\n\nThe Goated Farm ERP থেকে প্রস্তুতকৃত`;

      const doc = await generateReceiptPdf(data, parties, payments);
      const pdfBlob = doc.output('blob');
      const fileName = `Receipt-${num}.pdf`;
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          files: [pdfFile]
        });
      } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: shareTitle,
          text: shareText
        });
      } else {
        const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        window.open(waUrl, '_blank');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Native share error or cancelled:', err);
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handlePrintReceipt = async (data: ReceiptData) => {
    try {
      const doc = await generateReceiptPdf(data, parties, payments);
      const blobUrl = doc.output('bloburl');
      const win = window.open(blobUrl, '_blank');
      if (win) {
        win.focus();
      } else {
        window.print();
      }
    } catch (err) {
      console.warn('Print preview error, opening window.print():', err);
      window.print();
    }
  };

  const handleCopyReceiptText = (data: ReceiptData) => {
    const isSale = data.type === 'SALE';
    const rec = data.record;
    const num = rec.displayNumber || rec.invoiceNumber || rec.id.slice(0, 8);
    const partyName = isSale ? (rec as Sale).customerName : (rec as Purchase).supplierName;
    const total = Number(rec.grandTotal || rec.totalAmount || 0);
    const paid = Number(rec.paidAmount || 0);
    const due = Number(rec.dueAmount !== undefined ? rec.dueAmount : Math.max(0, total - paid));

    const text = `The Goated Farm\n${isSale ? 'বিক্রয় রশিদ' : 'ক্রয় ভাউচার'} #${num}\nতারিখ: ${rec.date}\n${isSale ? 'ক্রেতা' : 'সরবরাহকারী'}: ${partyName}\nসর্বমোট: ৳${Number(total).toLocaleString('en-IN')}\nপরিশোধিত: ৳${Number(paid).toLocaleString('en-IN')}\nঅবশিষ্ট বাকি: ৳${Number(due).toLocaleString('en-IN')}\n\nThe Goated Farm ERP`;
    navigator.clipboard.writeText(text);
    setReceiptCopied(true);
    setTimeout(() => setReceiptCopied(false), 2500);
  };

  return (
    <div className="space-y-5 pb-6 max-w-5xl mx-auto p-2 sm:p-4">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <Package className="w-5 h-5 text-[#1E5128] dark:text-emerald-400" />
            <span>ক্রয়-বিক্রয়, মজুদ ও পক্ষসমূহ (Commerce & Inventory)</span>
          </h2>
          <p className="text-[14px] text-gray-600 dark:text-slate-400 mt-0.5">
            ফিড, সার, ওষুধ মজুদ, ক্রয় চালান, বিক্রয় ও দেনাদার-পাওনাদার খতিয়ান
          </p>
        </div>

        <div className="w-full md:w-auto grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 p-1.5 rounded-xl text-[13px] font-semibold">
          <button
            type="button"
            onClick={() => setTab('inventory')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'inventory'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Package className="w-4 h-4 shrink-0" />
            <span>স্টক/মজুদ</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('sales')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'sales'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <TrendingUp className="w-4 h-4 shrink-0" />
            <span>বিক্রয় চালান</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('purchases')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'purchases'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <ShoppingCart className="w-4 h-4 shrink-0" />
            <span>ক্রয় চালান</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('parties')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'parties'
                ? 'bg-[#1E5128] text-white shadow-xs border border-[#1E5128]'
                : 'bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>গ্রাহক ও সাপ্লায়ার</span>
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
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">

          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-700" />
                <span>মজুদ পণ্যের তালিকা ও মূল্যায়ন ({items.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">গড় ক্রয়মূল্য (Weighted Average Cost) ভিত্তিতে মূল্যায়ন</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => setInventoryViewMode('cards')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    inventoryViewMode === 'cards'
                      ? 'bg-white text-amber-700 shadow-xs font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="কার্ড ভিউ"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>কার্ড</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInventoryViewMode('table')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    inventoryViewMode === 'table'
                      ? 'bg-white text-amber-700 shadow-xs font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="তালিকা ভিউ"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>তালিকা</span>
                </button>
              </div>

              {role === 'OWNER' && (
                <button
                  onClick={() => setShowAddItem(!showAddItem)}
                  className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ নতুন পণ্য</span>
                </button>
              )}
            </div>
          </div>

          {showAddItem && (
            <form onSubmit={handleAddItem} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3.5">
              <div className="font-bold text-amber-900 text-[15px]">নতুন আইটেম যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পণ্যের নাম *</label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: কার্প মাছের গ্রোয়ার ফিড"
                    value={itemNameBn}
                    onChange={(e) => setItemNameBn(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ক্যাটাগরি *</label>
                  <select
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  >
                    <option value="FEED">মজুদ খাদ্য (Feed Stock - 1051)</option>
                    <option value="SEED">বীজ (Seed - 1052)</option>
                    <option value="FERTILIZER">সার ও পুষ্টি (Fertilizer - 1052)</option>
                    <option value="RAW_MATERIAL">কাঁচামাল ও ওষুধ (Raw Materials - 1053)</option>
                    <option value="WIP">প্রক্রিয়াধীন পণ্য (WIP - 1054)</option>
                    <option value="FARM_PRODUCT">খামারের উৎপাদিত পণ্য (Finished Goods - 1055)</option>
                    <option value="PACKAGING">প্যাকেজিং সামগ্রী (Packaging - 1056)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">একক (Unit: কেজি/ব্যাগ)</label>
                  <input
                    type="text"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder="কেজি / ব্যাগ / লিটার"
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                  <div className="flex gap-1.5 mt-2">
                    {['কেজি', 'ব্যাগ', 'লিটার', 'মণ'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setItemUnit(u)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors min-h-[36px] flex items-center justify-center font-medium cursor-pointer ${
                          itemUnit === u ? 'bg-amber-700 text-white border-amber-700 shadow-2xs' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বর্তমান স্টক</label>
                  <input
                    type="number"
                    value={itemStock}
                    onChange={(e) => setItemStock(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">গড় ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemCost}
                    onChange={(e) => setItemCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">বিক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">রিঅর্ডার লেভেল</label>
                  <input
                    type="number"
                    value={itemReorder}
                    onChange={(e) => setItemReorder(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">সতর্কতার সীমা (Threshold)</label>
                  <input
                    type="number"
                    value={itemThreshold}
                    placeholder="ডিফল্ট: ২০%"
                    onChange={(e) => setItemThreshold(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                  <span className="text-[11px] text-gray-500 mt-1 block">ডিফল্ট: ২০% রিস্টক</span>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddItem(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm transition-colors"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          {inventoryViewMode === 'cards' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((it, idx) => {
                const val = it.currentStock * it.avgCostPrice;
                const lastRestock = it.lastRestockAmount && it.lastRestockAmount > 0 ? it.lastRestockAmount : (it.currentStock || 100);
                const defaultThreshold = Math.round(lastRestock * 0.20 * 100) / 100;
                const effectiveThreshold = (it.lowStockThreshold != null && it.lowStockThreshold >= 0)
                  ? it.lowStockThreshold
                  : (it.reorderLevel && it.reorderLevel > 0 ? it.reorderLevel : defaultThreshold);
                const isLow = it.currentStock <= effectiveThreshold;

                return (
                  <div
                    key={it.id}
                    style={{ animationDelay: `${Math.min(idx * 35, 350)}ms` }}
                    className="p-4 rounded-2xl bg-white border border-gray-200 hover:border-gray-300 space-y-3 shadow-xs animate-fade-slide-up flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      {/* Standardized Aspect-Video Media Card */}
                      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-gray-100 dark:border-slate-700/60 shrink-0 flex items-center justify-center">
                        {it.photoUrl ? (
                          <img
                            src={it.photoUrl}
                            alt={it.nameBn}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-amber-50 to-emerald-50/50 text-slate-500">
                            <Package className="w-10 h-10 text-amber-700/70 mb-1 stroke-[1.5]" />
                            <span className="text-[11px] font-semibold text-gray-500">{getInventoryCategoryBadge(it.category).label}</span>
                          </div>
                        )}
                        <div className="absolute top-2.5 right-2.5">
                          {it.currentStock <= 0 ? (
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-600 text-white shadow-xs">
                              মজুদ শেষ!
                            </span>
                          ) : isLow ? (
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-xs">
                              মজুদ কম!
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#15803D] text-white shadow-xs">
                              মজুদ পর্যাপ্ত
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-gray-900 text-[15px]">{it.nameBn}</h4>
                          <span className="text-[11px] text-gray-400 font-mono shrink-0">{it.code}</span>
                        </div>
                        <div className="text-[12px] text-gray-500 mt-0.5">
                          {getInventoryCategoryBadge(it.category).label} ({getInventoryAssetAccount(it.category)})
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-2.5 border-t border-gray-100 font-mono text-[13px]">
                      <div className="flex justify-between">
                        <span className="font-sans text-gray-600">বর্তমান স্টক:</span>
                        <span className="text-gray-900 font-bold">{it.currentStock} {it.unit}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-sans text-gray-600">গড় ক্রয়মূল্য:</span>
                        <span className="text-gray-700 font-semibold">{fmt(it.avgCostPrice)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-sans text-gray-600">বিক্রয় মূল্য:</span>
                        <span className="text-[#15803D] font-semibold">{it.sellingPrice > 0 ? fmt(it.sellingPrice) : '-'}</span>
                      </div>
                      <div className="flex justify-between font-bold text-amber-900 pt-1 border-t border-gray-100">
                        <span className="font-sans text-gray-900">মোট মজুদ মূল্য:</span>
                        <span>{fmt(val)}</span>
                      </div>
                      <div className="flex justify-between items-center text-[12px] pt-1.5 border-t border-gray-100 font-sans">
                        <span className="text-gray-500">সতর্কতার সীমা: {effectiveThreshold} {it.unit}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingThresholdItem(it);
                            setNewThresholdValue(effectiveThreshold.toString());
                          }}
                          className="text-gray-400 hover:text-amber-700 text-xs font-semibold p-1 hover:bg-gray-100 rounded transition-colors"
                          title="সতর্কতার সীমা পরিবর্তন করুন"
                        >
                          ✏️ সীমা পরিবর্তন
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Mobile Inventory Table/List View (Optimized for iPhone 13 mini) */}
              <div className="md:hidden space-y-3">
                {items.map((it, idx) => {
                  const val = it.currentStock * it.avgCostPrice;
                  const lastRestock = it.lastRestockAmount && it.lastRestockAmount > 0 ? it.lastRestockAmount : (it.currentStock || 100);
                  const defaultThreshold = Math.round(lastRestock * 0.20 * 100) / 100;
                  const effectiveThreshold = (it.lowStockThreshold != null && it.lowStockThreshold >= 0)
                    ? it.lowStockThreshold
                    : (it.reorderLevel && it.reorderLevel > 0 ? it.reorderLevel : defaultThreshold);
                  const isLow = it.currentStock <= effectiveThreshold;

                  return (
                    <div
                      key={`mob-inv-tbl-${it.id}`}
                      className="p-3.5 rounded-xl border border-gray-200 bg-white shadow-xs space-y-2.5 animate-fade-slide-up"
                      style={{ animationDelay: `${Math.min(idx * 25, 250)}ms` }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-gray-900 text-sm leading-snug">{it.nameBn}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] text-gray-400 font-mono">{it.code}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
                              {getInventoryCategoryBadge(it.category).label}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${
                          it.currentStock <= 0
                            ? 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                            : isLow
                            ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-emerald-50 text-[#14532D] border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                        }`}>
                          {it.currentStock <= 0 ? 'মজুদ শেষ' : isLow ? 'মজুদ কম!' : 'পর্যাপ্ত'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 text-xs font-mono">
                        <div>
                          <span className="font-sans text-gray-500 block text-[11px]">বর্তমান স্টক:</span>
                          <span className="font-bold text-gray-900 text-sm">{it.currentStock} {it.unit}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-sans text-gray-500 block text-[11px]">মোট মজুদ মূল্য:</span>
                          <span className="font-bold text-amber-900 text-sm">৳{fmt(val)}</span>
                        </div>
                        <div>
                          <span className="font-sans text-gray-500 block text-[11px]">গড় ক্রয়মূল্য:</span>
                          <span className="text-gray-700">৳{fmt(it.avgCostPrice)}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-sans text-gray-500 block text-[11px]">বিক্রয় মূল্য:</span>
                          <span className="text-[#15803D] font-semibold">{it.sellingPrice > 0 ? `৳${fmt(it.sellingPrice)}` : '—'}</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-xs pt-1.5 border-t border-gray-100 font-sans">
                        <span className="text-gray-500 text-[11px]">সতর্কতার সীমা: {effectiveThreshold} {it.unit}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingThresholdItem(it);
                            setNewThresholdValue(effectiveThreshold.toString());
                          }}
                          className="text-amber-800 hover:text-amber-900 font-semibold p-1 hover:bg-amber-50 rounded transition-colors text-xs inline-flex items-center gap-1"
                        >
                          <span>✏️ সীমা পরিবর্তন</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Full Table View */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[650px] text-left text-[14px] text-gray-800">
                  <thead className="bg-[#F8FAFC] text-gray-600 font-semibold border-b border-gray-200 text-[13px]">
                    <tr>
                      <th className="p-3">পণ্যের নাম</th>
                      <th className="p-3">ক্যাটাগরি</th>
                      <th className="p-3">বর্তমান স্টক</th>
                      <th className="p-3">গড় ক্রয়মূল্য</th>
                      <th className="p-3">বিক্রয় মূল্য</th>
                      <th className="p-3 text-right">মোট মজুদ মূল্য (৳)</th>
                      <th className="p-3">সতর্কতার সীমা</th>
                      <th className="p-3">অবস্থা</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((it, idx) => {
                      const val = it.currentStock * it.avgCostPrice;
                      const lastRestock = it.lastRestockAmount && it.lastRestockAmount > 0 ? it.lastRestockAmount : (it.currentStock || 100);
                      const defaultThreshold = Math.round(lastRestock * 0.20 * 100) / 100;
                      const effectiveThreshold = (it.lowStockThreshold != null && it.lowStockThreshold >= 0)
                        ? it.lowStockThreshold
                        : (it.reorderLevel && it.reorderLevel > 0 ? it.reorderLevel : defaultThreshold);
                      const isLow = it.currentStock <= effectiveThreshold;

                      return (
                        <tr
                          key={it.id}
                          style={{ animationDelay: `${Math.min(idx * 25, 250)}ms` }}
                          className="hover:bg-gray-50/80 animate-fade-slide-up"
                        >
                          <td className="p-3 font-medium text-gray-900">
                            <div>{it.nameBn}</div>
                            <div className="text-[11px] text-gray-400 font-mono">{it.code}</div>
                          </td>
                          <td className="p-3 text-gray-600 text-[13px]">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {getInventoryCategoryBadge(it.category).label} ({getInventoryAssetAccount(it.category)})
                            </span>
                          </td>
                          <td className="p-3 font-bold text-gray-900">{it.currentStock} {it.unit}</td>
                          <td className="p-3 text-gray-700">{fmt(it.avgCostPrice)}</td>
                          <td className="p-3 text-[#15803D] font-semibold">{it.sellingPrice > 0 ? fmt(it.sellingPrice) : '-'}</td>
                          <td className="p-3 text-right font-bold text-amber-900">{fmt(val)}</td>
                          <td className="p-3 text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold">{effectiveThreshold} {it.unit}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingThresholdItem(it);
                                  setNewThresholdValue(effectiveThreshold.toString());
                                }}
                                className="text-gray-400 hover:text-amber-700 text-xs font-semibold p-1 hover:bg-gray-100 rounded transition-colors"
                                title="সতর্কতার সীমা পরিবর্তন করুন"
                              >
                                ✏️
                              </button>
                            </div>
                          </td>
                          <td className="p-3">
                            {it.currentStock <= 0 ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                                মজুদ শেষ
                              </span>
                            ) : isLow ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                মজুদ কম!
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                পর্যাপ্ত
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Edit Threshold Modal */}
          {editingThresholdItem && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-gray-900 text-[15px]">কম মজুদের সীমা নির্ধারণ</h4>
                  <button
                    type="button"
                    onClick={() => setEditingThresholdItem(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-gray-600">
                  <strong>{editingThresholdItem.nameBn}</strong>-এর জন্য কম মজুদের সতর্কতা সীমা নির্ধারণ করুন ({editingThresholdItem.unit}):
                </p>
                <div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newThresholdValue}
                    onChange={(e) => setNewThresholdValue(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    ডিফল্ট: শেষ রিস্টকের ২০% ({editingThresholdItem.lastRestockAmount ? Math.round(editingThresholdItem.lastRestockAmount * 0.2) : Math.round(editingThresholdItem.currentStock * 0.2)} {editingThresholdItem.unit})
                  </p>
                </div>
                <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditingThresholdItem(null)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                  >
                    বাতিল
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = parseFloat(newThresholdValue);
                      if (!isNaN(val) && val >= 0) {
                        handleSaveThreshold(editingThresholdItem, val);
                      }
                    }}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm transition-colors"
                  >
                    সংরক্ষণ করুন
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

      {/* ===================== TAB 2: SALES ===================== */}
      {tab === 'sales' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">

          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-amber-700" />
                <span>বিক্রয় চালান ও রাজস্ব (Sales Invoices)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">স্বয়ংক্রিয় জাবেদা (নগদ: 1010, ব্যাংক: 1030, বাকি: 1040 AR)</p>
            </div>

            {role === 'OWNER' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  id="btn-open-advance-action-sales"
                  onClick={() => {
                    setAdvPartyId(saleCustomerId || '');
                    setAdvDirection('RECEIVED');
                    setAdvAmount('');
                    setAdvNarration('');
                    setShowAdvanceModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-[13px] font-bold shadow-2xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <CreditCard className="w-4 h-4 text-amber-700" />
                  <span>অগ্রিম গ্রহণ (Advance)</span>
                </button>
                <button
                  onClick={() => setShowNewSale(!showNewSale)}
                  className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ নতুন বিক্রয় চালান</span>
                </button>
              </div>
            )}
          </div>

          {showNewSale && (
            <form onSubmit={handleCreateSale} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-amber-900 text-[15px]">নতুন বিক্রয় চালান তৈরি করুন (Multi-Line Sales Voucher)</div>
                <span className="text-xs text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded font-medium">
                  {saleLines.length} টি পণ্য লাইন
                </span>
              </div>

              {/* Header Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">চালানের তারিখ</label>
                  <input
                    type="date"
                    id="input-sale-date"
                    value={saleDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className={`w-full bg-white border rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none ${
                      saleDate > new Date().toISOString().split('T')[0] ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-gray-300 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20'
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
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ক্রেতা নির্বাচন</label>
                  <SearchableSelect
                    options={customerOptions}
                    value={saleCustomerId}
                    onChange={(val) => setSaleCustomerId(val)}
                    placeholder="-- ক্রেতা সন্ধান বা নির্বাচন --"
                    allowClear
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পরিশোধের মাধ্যম</label>
                  <select
                    value={salePaymentMethod}
                    onChange={(e) => setSalePaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / দেনাদার (Accounts Receivable - 1040)</option>
                  </select>
                </div>
              </div>

              {/* Multi-Line Items Table */}
              <div className="border border-amber-200/80 rounded-xl overflow-hidden bg-white">
                <div className="bg-amber-100/60 px-3.5 py-2.5 border-b border-amber-200/80 flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                    বিক্রয়যোগ্য পণ্যসমূহের তালিকা (Voucher Item Lines)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddSaleLine}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-200/80 hover:bg-amber-300/80 rounded-lg transition-colors cursor-pointer min-h-[38px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ লাইন যোগ করুন</span>
                  </button>
                </div>

                <div className="divide-y divide-gray-100">
                  {saleLines.map((line, idx) => {
                    const selItem = items.find((i) => i.id === line.itemId);
                    const q = parseFloat(line.quantity) || 0;
                    const p = parseFloat(line.unitPrice) || 0;
                    const lineTotal = Math.round(q * p * 100) / 100;
                    const hasStockAlert = selItem && selItem.currentStock < q;

                    return (
                      <div key={line.id} className="p-3 hover:bg-amber-50/20 transition-colors">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                          <div className="sm:col-span-1 flex items-center gap-1 text-xs font-mono font-bold text-gray-500">
                            <span>#{idx + 1}</span>
                          </div>

                          <div className="sm:col-span-4">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">পণ্য *</label>
                            <select
                              value={line.itemId}
                              onChange={(e) => handleUpdateSaleLine(idx, 'itemId', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                            >
                              <option value="">-- পণ্য নির্বাচন করুন --</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.nameBn} (মজুদ: {it.currentStock} {it.unit})
                                </option>
                              ))}
                            </select>
                            {hasStockAlert && (
                              <p className="text-[11px] text-rose-600 font-semibold mt-1">
                                অপূর্ণ মজুদ! বর্তমান স্টক: {selItem.currentStock} {selItem.unit}
                              </p>
                            )}
                          </div>

                          <div className="sm:col-span-2">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">পরিমাণ *</label>
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.001"
                                step="any"
                                placeholder="পরিমাণ"
                                value={line.quantity}
                                onChange={(e) => handleUpdateSaleLine(idx, 'quantity', e.target.value)}
                                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 pr-8 min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                              />
                              {selItem?.unit && (
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-500 font-medium pointer-events-none">
                                  {selItem.unit}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">একক দর ৳ *</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              placeholder="দর ৳"
                              value={line.unitPrice}
                              onChange={(e) => handleUpdateSaleLine(idx, 'unitPrice', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                            />
                          </div>

                          <div className="sm:col-span-2 text-right">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1 text-left">মোট ৳</label>
                            <span className="font-mono font-bold text-gray-900 text-[14px]">
                              ৳{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRemoveSaleLine(idx)}
                              title="লাইন মুছুন"
                              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 bg-gray-50/70 border-t border-gray-100 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={handleAddSaleLine}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-700" />
                    <span>+ আরও পণ্য যোগ করুন</span>
                  </button>
                  <div className="text-xs text-gray-600 font-medium">
                    মোট লাইন: <strong className="font-mono text-gray-900">{saleLines.length}</strong>
                  </div>
                </div>
              </div>

              {/* Discount & VAT Options */}
              <div className={`grid grid-cols-1 ${isVatRegistered ? 'sm:grid-cols-2' : 'sm:grid-cols-1'} gap-3`}>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মূল্যছাড় / Discount (ঐচ্ছিক)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="ছাড়"
                      value={saleDiscount}
                      onChange={(e) => setSaleDiscount(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    />
                    <select
                      value={saleDiscountType}
                      onChange={(e) => setSaleDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                      className="bg-white border border-gray-300 rounded-xl px-3 text-[13px] font-medium text-gray-700 shrink-0 min-h-[44px] focus:outline-none focus:border-amber-600"
                    >
                      <option value="FIXED">৳ (টাকা)</option>
                      <option value="PERCENT">% (শতাংশ)</option>
                    </select>
                  </div>
                </div>

                {isVatRegistered && (
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ভ্যাট হার (%) / VAT Rate</label>
                    <div className="relative">
                      <input
                        type="number"
                        id="sale-vat-rate"
                        name="vatRate"
                        min="0"
                        max="100"
                        step="any"
                        list="sale-vat-presets"
                        value={saleVatRate}
                        onChange={(e) => setSaleVatRate(e.target.value)}
                        placeholder="0"
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 pr-8 font-mono min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                      <datalist id="sale-vat-presets">
                        <option value="0">০% (অব্যাহতিপ্রাপ্ত / Exempt)</option>
                        <option value="5">৫% (হ্রাসকৃত / Reduced)</option>
                        <option value="7.5">৭.৫% (সেবা / Services)</option>
                        <option value="10">১০% (মধ্যম / Intermediate)</option>
                        <option value="15">১৫% (আদর্শ হার / Standard)</option>
                      </datalist>
                    </div>
                  </div>
                )}
              </div>

              {/* Dynamic Sale Preview Summary */}
              {(() => {
                const sub = Math.round(
                  saleLines.reduce((sum, l) => {
                    const q = parseFloat(l.quantity) || 0;
                    const p = parseFloat(l.unitPrice) || 0;
                    return sum + Math.round(q * p * 100) / 100;
                  }, 0) * 100
                ) / 100;
                const disc = Math.min(sub, Math.max(0, calcSaleDiscountAmount(sub, saleDiscount, saleDiscountType)));
                const net = Math.max(0, Math.round((sub - disc) * 100) / 100);
                const vatRate = isVatRegistered ? (parseFloat(saleVatRate) || 0) : 0;
                const vatAmt = vatRate > 0 ? Math.round(net * (vatRate / 100) * 100) / 100 : 0;
                const total = Math.max(0, Math.round((net + vatAmt) * 100) / 100);
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="text-gray-700">উপমোট ({saleLines.length} আইটেম): <strong className="text-gray-900 font-mono">৳{sub.toLocaleString('en-IN')}</strong></span>
                    {disc > 0 && (
                      <span className="text-rose-700">ছাড় ({saleDiscountType === 'PERCENT' ? `${saleDiscount}%` : 'নির্দিষ্ট'}): <strong className="font-mono">-৳{disc.toLocaleString('en-IN')}</strong></span>
                    )}
                    {isVatRegistered && (
                      <span className="text-emerald-800">ভ্যাট ({vatRate}%): <strong className="font-mono">{vatAmt > 0 ? `+৳${vatAmt.toLocaleString('en-IN')}` : '৳0'}</strong></span>
                    )}
                    <span className="text-amber-900 font-semibold">
                      {isVatRegistered ? 'চালানের সর্বমোট (ভ্যাটসহ): ' : 'চালানের সর্বমোট: '}
                      <strong className="text-amber-950 font-mono text-[14px]">৳{total.toLocaleString('en-IN')}</strong>
                    </span>
                  </div>
                );
              })()}

              {/* Customer Advance Application (Requirement 2) */}
              {availableCustomerAdvance > 0 && (() => {
                const sub = Math.round(
                  saleLines.reduce((sum, l) => {
                    const q = parseFloat(l.quantity) || 0;
                    const p = parseFloat(l.unitPrice) || 0;
                    return sum + Math.round(q * p * 100) / 100;
                  }, 0) * 100
                ) / 100;
                const disc = Math.min(sub, Math.max(0, calcSaleDiscountAmount(sub, saleDiscount, saleDiscountType)));
                const net = Math.max(0, Math.round((sub - disc) * 100) / 100);
                const vatRate = isVatRegistered ? (parseFloat(saleVatRate) || 0) : 0;
                const vatAmt = vatRate > 0 ? Math.round(net * (vatRate / 100) * 100) / 100 : 0;
                const total = Math.max(0, Math.round((net + vatAmt) * 100) / 100);
                const appliedNum = parseFloat(saleAdvanceApplied) || 0;
                const maxApplicable = Math.min(availableCustomerAdvance, total);

                return (
                  <div className="bg-emerald-50/90 border border-emerald-300 rounded-xl p-3 space-y-2 text-xs sm:text-sm shadow-2xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 font-bold text-emerald-950">
                        <CreditCard className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>
                          এই গ্রাহকের অব্যবহৃত অগ্রিম ব্যালেন্স জমা আছে: <strong className="font-mono text-emerald-900 text-base">৳{fmt(availableCustomerAdvance)}</strong>
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-apply-max-sale-advance"
                        onClick={() => {
                          setSaleAdvanceApplied(maxApplicable > 0 ? maxApplicable.toString() : '');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs min-h-[38px] flex items-center justify-center"
                      >
                        সম্পূর্ণ সমন্বয় করুন (Apply Max: ৳{fmt(maxApplicable)})
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center pt-1">
                      <div>
                        <label className="block text-[12px] font-semibold text-emerald-950 mb-1">
                          চালানে সমন্বয় করার অগ্রিম পরিমাণ (৳):
                        </label>
                        <input
                          type="number"
                          id="input-sale-advance-applied"
                          min="0"
                          max={maxApplicable}
                          step="any"
                          placeholder="৳ অগ্রিম সমন্বয়"
                          value={saleAdvanceApplied}
                          onChange={(e) => setSaleAdvanceApplied(e.target.value)}
                          className="w-full bg-white border border-emerald-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] font-mono font-bold text-gray-900 focus:ring-2 focus:ring-emerald-500 min-h-[44px]"
                        />
                      </div>
                      <div className="text-xs text-emerald-900 space-y-1 bg-white/80 p-2.5 rounded-lg border border-emerald-200">
                        <div className="flex justify-between">
                          <span>সমন্বয় পরবর্তী প্রদেয়/বাকি:</span>
                          <span className="font-mono font-bold text-gray-900">৳{fmt(Math.max(0, net - appliedNum))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>পরবর্তী অবশিষ্ট অগ্রিম:</span>
                          <span className="font-mono font-bold text-emerald-800">৳{fmt(Math.max(0, availableCustomerAdvance - appliedNum))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewSale(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm"
                >
                  চালান পোস্ট করুন
                </button>
              </div>
            </form>
          )}

          {/* Mobile Card View (Optimized for iPhone 13 mini & small viewports) */}
          <div className="md:hidden space-y-3">
            {sales.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                এখনো কোনো বিক্রয় চালান ইস্যু করা হয়নি।
              </div>
            ) : (
              sales.map((s) => {
                const sPayments = payments.filter((pmt) => pmt.parentId === s.id);
                const sReturns = salesReturns.filter((ret) => ret.saleId === s.id);
                const total = Number(s.grandTotal || s.totalAmount || 0);
                const paid = Number(s.paidAmount || 0);
                const due = Number(s.dueAmount !== undefined ? s.dueAmount : Math.max(0, total - paid));
                const hasDue = due > 0;
                const hasReturnableItems = (s.items || []).some((i) => {
                  const retQty = getItemReturnedQtyForSale(s.id, i.itemId);
                  return (Number(i.quantity) || 0) - retQty > 0.0001;
                });
                const sItems = (s.items && Array.isArray(s.items) && s.items.length > 0)
                  ? s.items
                  : [{
                      itemId: (s as any).itemId || '',
                      itemName: (s as any).itemName || 'আইটেম',
                      quantity: (s as any).quantity || 1,
                      unitPrice: (s as any).unitPrice || total,
                      unit: (s as any).unit || 'একক',
                      total: total
                    }];

                return (
                  <div key={`mob-sale-${s.id}`} className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-amber-900 font-mono text-[15px]">{s.displayNumber || s.invoiceNumber}</div>
                        <div className="text-xs text-gray-500 font-sans mt-0.5">
                          <span>{s.date}</span> · <span className="font-semibold text-gray-900">{s.customerName}</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                        due <= 0 || s.status === 'PAID'
                          ? 'bg-emerald-50 text-[#14532D] border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : (paid > 0
                              ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800')
                      }`}>
                        {due <= 0 || s.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                      </span>
                    </div>

                    <div className="bg-[#F8FAFC] rounded-xl p-3 space-y-1.5 text-xs text-gray-700 border border-gray-100">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">পণ্যসমূহ ({sItems.length}টি)</div>
                      {sItems.map((i, idx) => {
                        const returnedQty = getItemReturnedQtyForSale(s.id, i.itemId);
                        const remainingReturnable = Math.max(0, Math.round(((Number(i.quantity) || 0) - returnedQty) * 1000) / 1000);
                        return (
                          <div key={idx} className="flex items-center justify-between gap-2 py-0.5 border-b border-gray-100 last:border-0">
                            <div className="flex-1 truncate">
                              <span className="font-semibold text-gray-900">{i.itemName}</span>
                              <span className="text-gray-500 font-mono ml-1">({i.quantity} × {fmt(i.unitPrice || 0)})</span>
                              {returnedQty > 0 && (
                                <span className="ml-1.5 text-[10px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  ফেরত: {returnedQty}
                                </span>
                              )}
                            </div>
                            {role === 'OWNER' && remainingReturnable > 0 && (
                              <button
                                type="button"
                                onClick={() => openReturnModal('SALE', s, i.itemId)}
                                className="px-2 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold cursor-pointer shrink-0"
                              >
                                ফেরত
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-2 border-y border-gray-100 text-center font-mono">
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">মোট মূল্য</div>
                        <div className="text-sm font-bold text-gray-900">{fmt(total)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">পরিশোধিত</div>
                        <div className="text-sm font-semibold text-emerald-700">{fmt(paid)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">বকেয়া</div>
                        <div className={`text-sm font-bold ${due > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{fmt(due)}</div>
                      </div>
                    </div>

                    {sReturns.length > 0 && (
                      <div className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 font-mono flex items-center justify-between">
                        <span>{sReturns.length}টি ফেরত সমন্বিত</span>
                        <span className="font-bold">৳{fmt(sReturns.reduce((sum, r) => sum + (r.totalRefundAmount || 0), 0))}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <button
                        type="button"
                        id={`btn-view-receipt-sale-${s.id}`}
                        onClick={() => setReceiptModal({ type: 'SALE', record: s })}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Receipt className="w-4 h-4 text-emerald-700" />
                        <span>রশিদ</span>
                      </button>
                      {hasDue && (
                        <button
                          type="button"
                          id={`btn-add-installment-sale-${s.id}`}
                          onClick={() => openPaymentModal('SALE', s)}
                          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <PlusCircle className="w-4 h-4" />
                          <span>কিস্তি যোগ</span>
                        </button>
                      )}
                      {role === 'OWNER' && hasReturnableItems && (
                        <button
                          type="button"
                          id={`btn-return-sale-${s.id}`}
                          onClick={() => openReturnModal('SALE', s)}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1 shadow-xs"
                        >
                          <RotateCcw className="w-4 h-4 text-amber-700" />
                          <span>ফেরত</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View (Hidden on mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[650px] text-left text-[14px] text-gray-800">
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
                    const sReturns = salesReturns.filter((ret) => ret.saleId === s.id);
                    const total = Number(s.grandTotal || s.totalAmount || 0);
                    const paid = Number(s.paidAmount || 0);
                    const due = Number(s.dueAmount !== undefined ? s.dueAmount : Math.max(0, total - paid));
                    const hasDue = due > 0;
                    const hasReturnableItems = (s.items || []).some((i) => {
                      const retQty = getItemReturnedQtyForSale(s.id, i.itemId);
                      return (Number(i.quantity) || 0) - retQty > 0.0001;
                    });

                    const sItems = (s.items && Array.isArray(s.items) && s.items.length > 0)
                      ? s.items
                      : [{
                          itemId: (s as any).itemId || '',
                          itemName: (s as any).itemName || 'আইটেম',
                          quantity: (s as any).quantity || 1,
                          unitPrice: (s as any).unitPrice || total,
                          unit: (s as any).unit || 'একক',
                          total: total
                        }];

                    return (
                      <React.Fragment key={s.id}>
                        <tr className="hover:bg-gray-50/80">
                          <td className="p-3 font-bold text-amber-800 font-mono">{s.displayNumber || s.invoiceNumber}</td>
                          <td className="p-3 text-gray-600">{s.date}</td>
                          <td className="p-3 font-semibold text-gray-900">{s.customerName}</td>
                          <td className="p-3">
                            {sItems.map((i, idx) => {
                              const returnedQty = getItemReturnedQtyForSale(s.id, i.itemId);
                              const remainingReturnable = Math.max(0, Math.round(((Number(i.quantity) || 0) - returnedQty) * 1000) / 1000);
                              return (
                                <div key={idx} className="flex items-center justify-between gap-2 py-0.5 text-gray-700 text-[13px]">
                                  <div>
                                    <span>{i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})</span>
                                    {Boolean(i.vatRatePercent && i.vatRatePercent > 0) && (
                                      <span className="ml-1 text-[11px] text-emerald-700 font-medium">
                                        ({i.vatRatePercent}% ভ্যাট)
                                      </span>
                                    )}
                                    {returnedQty > 0 && (
                                      <span className="ml-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                        ফেরত: {returnedQty} | অবশিষ্ট: {remainingReturnable}
                                      </span>
                                    )}
                                  </div>
                                  {role === 'OWNER' && (
                                    remainingReturnable > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => openReturnModal('SALE', s, i.itemId)}
                                        className="px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 shrink-0 shadow-2xs"
                                        title={`${i.itemName} ফেরত দিন (ক্রেডিট নোট)`}
                                      >
                                        <RotateCcw className="w-3 h-3 text-amber-700" />
                                        <span>ফেরত</span>
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                        সম্পূর্ণ ফেরত
                                      </span>
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </td>
                          <td className="p-3 font-mono">
                            <div className="text-amber-800 font-bold">{fmt(total)}</div>
                            {Boolean(s.discount && s.discount > 0) && (
                              <div className="text-[11px] text-rose-600 font-sans font-medium">
                                ছাড়: ৳{fmt(s.discount)}
                              </div>
                            )}
                            {Boolean((s.taxVat || s.vat || s.vatTax) && Number(s.taxVat || s.vat || s.vatTax) > 0) && (
                              <div className="text-[11px] text-emerald-700 font-sans font-medium">
                                ভ্যাট: ৳{fmt(Number(s.taxVat || s.vat || s.vatTax))}
                              </div>
                            )}
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
                                ? 'bg-emerald-50 text-[#14532D] border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                : (paid > 0
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                    : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800')
                            }`}>
                              {due <= 0 || s.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক বাকি (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                type="button"
                                id={`btn-view-receipt-sale-${s.id}`}
                                onClick={() => setReceiptModal({ type: 'SALE', record: s })}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                title="রশিদ দেখুন / ডাউনলোড / শেয়ার করুন"
                              >
                                <Receipt className="w-3.5 h-3.5 text-emerald-700" />
                                <span>রশিদ দেখুন/শেয়ার করুন</span>
                              </button>
                              {role === 'OWNER' && hasReturnableItems && (
                                <button
                                  type="button"
                                  id={`btn-return-sale-${s.id}`}
                                  onClick={() => openReturnModal('SALE', s)}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                  title="পণ্য ফেরত ও ক্রেডিট নোট তৈরি করুন"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                                  <span>ফেরত (Return)</span>
                                </button>
                              )}
                              {hasDue && (
                                <button
                                  type="button"
                                  id={`btn-add-installment-sale-${s.id}`}
                                  onClick={() => openPaymentModal('SALE', s)}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" />
                                  <span>কিস্তি যোগ করুন</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {sReturns.length > 0 && (
                          <tr className="bg-amber-50/60 border-b border-amber-200">
                            <td colSpan={8} className="px-4 py-2.5">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                                    <RotateCcw className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                    <span>ফেরতের ইতিহাস (Return History - {sReturns.length}টি ফেরত):</span>
                                  </div>
                                  <span className="text-[11px] text-amber-800 font-semibold font-mono">
                                    মোট সমন্বয়: {fmt(sReturns.reduce((sum, r) => sum + (r.totalRefundAmount || 0), 0))}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {sReturns.map((ret) => (
                                    <div
                                      key={ret.id}
                                      className="inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-amber-200 text-xs shadow-2xs text-gray-800 font-mono flex-wrap"
                                    >
                                      <span className="font-bold text-amber-900">{ret.displayNumber || ret.returnNumber}</span>
                                      <span className="text-gray-400">|</span>
                                      <span className="text-gray-600 font-sans">{ret.date}</span>
                                      <span className="text-gray-400">|</span>
                                      <span className="font-bold text-rose-700">{fmt(ret.totalRefundAmount)}</span>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-amber-100 text-amber-800">
                                        {ret.refundMethod === 'CASH'
                                          ? 'নগদ রিফান্ড'
                                          : ret.refundMethod === 'BANK'
                                          ? 'ব্যাংক রিফান্ড'
                                          : 'বাকি সমন্বয়'}
                                      </span>
                                      <span className="text-gray-400">|</span>
                                      <span className="text-gray-700 font-sans text-[11px]">
                                        {ret.items?.map((it) => `${it.itemName}: ${it.returnedQuantity}`).join(', ')}
                                      </span>
                                      {ret.reason && (
                                        <span className="text-gray-500 font-sans text-[11px] italic">
                                          ({ret.reason})
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {sPayments.length > 0 && (
                          <tr className="bg-amber-50/40 border-b border-gray-100">
                            <td colSpan={8} className="px-4 py-2">
                              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-700">
                                <span className="font-semibold text-amber-800">পরিশোধের ইতিহাস:</span>
                                {sPayments.map((pmt) => (
                                  <span
                                    key={pmt.id}
                                    className="inline-flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-gray-200 text-gray-800 font-mono shadow-2xs"
                                  >
                                    <span className="text-gray-500">{pmt.date}:</span>
                                    <span className="font-bold text-amber-800">৳{fmt(pmt.amount)}</span>
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
              <p className="text-[13px] text-gray-600 mt-0.5">পণ্য ক্রয়: Dr ইনভেন্টরি (1051-1056), নগদ: Cr 1010, ব্যাংক: Cr 1030, বাকি: Cr 2010 AP</p>
            </div>

            {role === 'OWNER' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  id="btn-open-advance-action-purchases"
                  onClick={() => {
                    setAdvPartyId(purchSupplierId || '');
                    setAdvDirection('PAID');
                    setAdvAmount('');
                    setAdvNarration('');
                    setShowAdvanceModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 text-[13px] font-bold shadow-2xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <CreditCard className="w-4 h-4 text-sky-700" />
                  <span>অগ্রিম প্রদান (Advance)</span>
                </button>
                <button
                  onClick={() => setShowNewPurchase(!showNewPurchase)}
                  className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ নতুন ক্রয় চালান</span>
                </button>
              </div>
            )}
          </div>

          {showNewPurchase && (
            <form onSubmit={handleCreatePurchase} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-amber-900 text-[15px]">নতুন ক্রয় চালান লিপিবদ্ধ করুন (Multi-Line Purchase Voucher)</div>
                <span className="text-xs text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded font-medium">
                  {purchLines.length} টি পণ্য লাইন
                </span>
              </div>

              {/* Header Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">চালানের তারিখ</label>
                  <input
                    type="date"
                    id="input-purch-date"
                    value={purchDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setPurchDate(e.target.value)}
                    className={`w-full bg-white border rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 min-h-[44px] focus:outline-none ${
                      purchDate > new Date().toISOString().split('T')[0] ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-gray-300 focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20'
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
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">সরবরাহকারী নির্বাচন</label>
                  <SearchableSelect
                    options={supplierOptions}
                    value={purchSupplierId}
                    onChange={(val) => setPurchSupplierId(val)}
                    placeholder="-- সরবরাহকারী সন্ধান বা নির্বাচন --"
                    allowClear
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পরিশোধের মাধ্যম</label>
                  <select
                    value={purchPaymentMethod}
                    onChange={(e) => setPurchPaymentMethod(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  >
                    <option value="CASH">নগদ (Cash - 1010)</option>
                    <option value="BANK">ব্যাংক স্থানান্তর (Bank - 1030)</option>
                    <option value="CREDIT">বাকি / পাওনাদার (Accounts Payable - 2010)</option>
                  </select>
                </div>
              </div>

              {/* Multi-Line Items Table */}
              <div className="border border-amber-200/80 rounded-xl overflow-hidden bg-white">
                <div className="bg-amber-100/60 px-3.5 py-2.5 border-b border-amber-200/80 flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                    ক্রয়কৃত পণ্যসমূহের তালিকা (Voucher Item Lines)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddPurchLine}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-200/80 hover:bg-amber-300/80 rounded-lg transition-colors cursor-pointer min-h-[38px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ লাইন যোগ করুন</span>
                  </button>
                </div>

                <div className="divide-y divide-gray-100">
                  {purchLines.map((line, idx) => {
                    const selItem = items.find((i) => i.id === line.itemId);
                    const q = parseFloat(line.quantity) || 0;
                    const p = parseFloat(line.unitPrice) || 0;
                    const lineTotal = Math.round(q * p * 100) / 100;

                    return (
                      <div key={line.id} className="p-3 hover:bg-amber-50/20 transition-colors">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                          <div className="sm:col-span-1 flex items-center gap-1 text-xs font-mono font-bold text-gray-500">
                            <span>#{idx + 1}</span>
                          </div>

                          <div className="sm:col-span-4">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">ক্রয়কৃত আইটেম *</label>
                            <select
                              value={line.itemId}
                              onChange={(e) => handleUpdatePurchLine(idx, 'itemId', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                            >
                              <option value="">-- পণ্য নির্বাচন করুন --</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.nameBn} ({getInventoryAssetAccount(it.category)})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">পরিমাণ *</label>
                            <div className="relative">
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0.001"
                                step="any"
                                placeholder="পরিমাণ"
                                value={line.quantity}
                                onChange={(e) => handleUpdatePurchLine(idx, 'quantity', e.target.value)}
                                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 pr-8 min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                              />
                              {selItem?.unit && (
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-500 font-medium pointer-events-none">
                                  {selItem.unit}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1">একক দর ৳ *</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              placeholder="দর ৳"
                              value={line.unitPrice}
                              onChange={(e) => handleUpdatePurchLine(idx, 'unitPrice', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 font-mono min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                            />
                          </div>

                          <div className="sm:col-span-2 text-right">
                            <label className="sm:hidden block text-[11px] font-semibold text-gray-600 mb-1 text-left">মোট ৳</label>
                            <span className="font-mono font-bold text-gray-900 text-[14px]">
                              ৳{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRemovePurchLine(idx)}
                              title="লাইন মুছুন"
                              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 bg-gray-50/70 border-t border-gray-100 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={handleAddPurchLine}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-700" />
                    <span>+ আরও পণ্য যোগ করুন</span>
                  </button>
                  <div className="text-xs text-gray-600 font-medium">
                    মোট লাইন: <strong className="font-mono text-gray-900">{purchLines.length}</strong>
                  </div>
                </div>
              </div>

              {/* Extra Costs, Discount & VAT */}
              <div className={`grid grid-cols-1 ${isVatRegistered ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পরিবহন খরচ ৳ (Carriage Inward)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="৳"
                    value={purchTransportCost}
                    onChange={(e) => setPurchTransportCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">মূল্যছাড় / Discount (ঐচ্ছিক)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="ছাড়"
                      value={purchDiscount}
                      onChange={(e) => setPurchDiscount(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    />
                    <select
                      value={purchDiscountType}
                      onChange={(e) => setPurchDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                      className="bg-white border border-gray-300 rounded-xl px-3 text-[13px] font-medium text-gray-700 shrink-0 min-h-[44px] focus:outline-none focus:border-amber-600"
                    >
                      <option value="FIXED">৳ (টাকা)</option>
                      <option value="PERCENT">% (শতাংশ)</option>
                    </select>
                  </div>
                </div>

                {isVatRegistered && (
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ভ্যাট হার (%) / VAT Rate</label>
                    <div className="relative">
                      <input
                        type="number"
                        id="purch-vat-rate"
                        name="purchVatRate"
                        min="0"
                        max="100"
                        step="any"
                        list="purch-vat-presets"
                        value={purchVatRate}
                        onChange={(e) => setPurchVatRate(e.target.value)}
                        placeholder="0"
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 pr-8 font-mono min-h-[44px] focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">%</span>
                      <datalist id="purch-vat-presets">
                        <option value="0">০% (অব্যাহতির হার / Exempt)</option>
                        <option value="5">৫% (হ্রাসকৃত / Reduced)</option>
                        <option value="7.5">৭.৫% (সেবা / Services)</option>
                        <option value="10">১০% (মধ্যম / Intermediate)</option>
                        <option value="15">১৫% (আদর্শ হার / Standard)</option>
                      </datalist>
                    </div>
                  </div>
                )}
              </div>

              {/* Dynamic Purchase Preview Summary */}
              {(() => {
                const itemsTotal = Math.round(
                  purchLines.reduce((sum, l) => {
                    const q = parseFloat(l.quantity) || 0;
                    const p = parseFloat(l.unitPrice) || 0;
                    return sum + Math.round(q * p * 100) / 100;
                  }, 0) * 100
                ) / 100;
                const pTrans = parseFloat(purchTransportCost) || 0;
                const disc = Math.min(itemsTotal + pTrans, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
                const net = Math.max(0, Math.round((itemsTotal + pTrans - disc) * 100) / 100);
                const vatRate = isVatRegistered ? (parseFloat(purchVatRate) || 0) : 0;
                const vatAmt = vatRate > 0 ? Math.round(net * (vatRate / 100) * 100) / 100 : 0;
                const grand = Math.max(0, Math.round((net + vatAmt) * 100) / 100);
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="text-gray-700">পণ্যের মোট ({purchLines.length} আইটেম): <strong className="text-gray-900 font-mono">৳{itemsTotal.toLocaleString('en-IN')}</strong></span>
                    {pTrans > 0 && (
                      <span className="text-amber-800">পরিবহন: <strong className="font-mono">+৳{pTrans.toLocaleString('en-IN')}</strong></span>
                    )}
                    {disc > 0 && (
                      <span className="text-rose-700">ছাড় ({purchDiscountType === 'PERCENT' ? `${purchDiscount}%` : 'নির্দিষ্ট'}): <strong className="font-mono">-৳{disc.toLocaleString('en-IN')}</strong></span>
                    )}
                    {isVatRegistered && (
                      <span className="text-emerald-800">ভ্যাট ({vatRate}%): <strong className="font-mono">{vatAmt > 0 ? `+৳${vatAmt.toLocaleString('en-IN')}` : '৳0'}</strong></span>
                    )}
                    <span className="text-amber-900 font-semibold">
                      {isVatRegistered ? 'ক্রয়ের সর্বমোট (ভ্যাটসহ): ' : 'ক্রয়ের নেট সর্বমোট: '}
                      <strong className="text-amber-950 font-mono text-[14px]">৳{grand.toLocaleString('en-IN')}</strong>
                    </span>
                  </div>
                );
              })()}

              {/* Supplier Advance Application (Requirement 2) */}
              {availableSupplierAdvance > 0 && (() => {
                const itemsTotal = Math.round(
                  purchLines.reduce((sum, l) => {
                    const q = parseFloat(l.quantity) || 0;
                    const p = parseFloat(l.unitPrice) || 0;
                    return sum + Math.round(q * p * 100) / 100;
                  }, 0) * 100
                ) / 100;
                const pTrans = parseFloat(purchTransportCost) || 0;
                const disc = Math.min(itemsTotal + pTrans, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
                const net = Math.max(0, Math.round((itemsTotal + pTrans - disc) * 100) / 100);
                const vatRate = isVatRegistered ? (parseFloat(purchVatRate) || 0) : 0;
                const vatAmt = vatRate > 0 ? Math.round(net * (vatRate / 100) * 100) / 100 : 0;
                const grand = Math.max(0, Math.round((net + vatAmt) * 100) / 100);
                const appliedNum = parseFloat(purchAdvanceApplied) || 0;
                const maxApplicable = Math.min(availableSupplierAdvance, grand);

                return (
                  <div className="bg-sky-50/90 border border-sky-300 rounded-xl p-3 space-y-2 text-xs sm:text-sm shadow-2xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 font-bold text-sky-950">
                        <CreditCard className="w-4 h-4 text-sky-700 shrink-0" />
                        <span>
                          এই সরবরাহকারীকে পূর্বে প্রদত্ত অগ্রিম জমা আছে: <strong className="font-mono text-sky-900 text-base">৳{fmt(availableSupplierAdvance)}</strong>
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-apply-max-purch-advance"
                        onClick={() => {
                          setPurchAdvanceApplied(maxApplicable > 0 ? maxApplicable.toString() : '');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs min-h-[38px] flex items-center justify-center"
                      >
                        সম্পূর্ণ সমন্বয় করুন (Apply Max: ৳{fmt(maxApplicable)})
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center pt-1">
                      <div>
                        <label className="block text-[12px] font-semibold text-sky-950 mb-1">
                          চালানে সমন্বয় করার অগ্রিম পরিমাণ (৳):
                        </label>
                        <input
                          type="number"
                          id="input-purch-advance-applied"
                          min="0"
                          max={maxApplicable}
                          step="any"
                          placeholder="৳ অগ্রিম সমন্বয়"
                          value={purchAdvanceApplied}
                          onChange={(e) => setPurchAdvanceApplied(e.target.value)}
                          className="w-full bg-white border border-sky-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] font-mono font-bold text-gray-900 focus:ring-2 focus:ring-sky-500 min-h-[44px]"
                        />
                      </div>
                      <div className="text-xs text-sky-900 space-y-1 bg-white/80 p-2.5 rounded-lg border border-sky-200">
                        <div className="flex justify-between">
                          <span>সমন্বয় পরবর্তী প্রদেয়/বাকি:</span>
                          <span className="font-mono font-bold text-gray-900">৳{fmt(Math.max(0, grand - appliedNum))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>পরবর্তী অবশিষ্ট অগ্রিম:</span>
                          <span className="font-mono font-bold text-sky-800">৳{fmt(Math.max(0, availableSupplierAdvance - appliedNum))}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewPurchase(false)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm"
                >
                  চালান সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          {/* Mobile Card View (Optimized for iPhone 13 mini & small viewports) */}
          <div className="md:hidden space-y-3">
            {purchases.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-[14px] bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                এখনো কোনো ক্রয় চালান রেকর্ড করা হয়নি।
              </div>
            ) : (
              purchases.map((p) => {
                const pPayments = payments.filter((pmt) => pmt.parentId === p.id);
                const pReturns = purchaseReturns.filter((ret) => ret.purchaseId === p.id);
                const total = Number(p.grandTotal || p.totalAmount || 0);
                const paid = Number(p.paidAmount || 0);
                const due = Number(p.dueAmount !== undefined ? p.dueAmount : Math.max(0, total - paid));
                const hasDue = due > 0;
                const hasReturnableItems = (p.items || []).some((i) => {
                  const retQty = getItemReturnedQtyForPurchase(p.id, i.itemId);
                  return (Number(i.quantity) || 0) - retQty > 0.0001;
                });
                const pItems = (p.items && Array.isArray(p.items) && p.items.length > 0)
                  ? p.items
                  : [{
                      itemId: (p as any).itemId || '',
                      itemName: (p as any).itemName || 'আইটেম',
                      quantity: (p as any).quantity || 1,
                      unitPrice: (p as any).unitPrice || total,
                      unit: (p as any).unit || 'একক',
                      total: total
                    }];

                return (
                  <div key={`mob-purch-${p.id}`} className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-sky-900 font-mono text-[15px]">{p.displayNumber || p.invoiceNumber}</div>
                        <div className="text-xs text-gray-500 font-sans mt-0.5">
                          <span>{p.date}</span> · <span className="font-semibold text-gray-900">{p.supplierName}</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                        due <= 0 || p.status === 'PAID'
                          ? 'bg-emerald-50 text-[#14532D] border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                          : (paid > 0
                              ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800')
                      }`}>
                        {due <= 0 || p.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                      </span>
                    </div>

                    <div className="bg-[#F8FAFC] rounded-xl p-3 space-y-1.5 text-xs text-gray-700 border border-gray-100">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">ক্রয়কৃত পণ্য ({pItems.length}টি)</div>
                      {pItems.map((i, idx) => {
                        const returnedQty = getItemReturnedQtyForPurchase(p.id, i.itemId);
                        const remainingReturnable = Math.max(0, Math.round(((Number(i.quantity) || 0) - returnedQty) * 1000) / 1000);
                        return (
                          <div key={idx} className="flex items-center justify-between gap-2 py-0.5 border-b border-gray-100 last:border-0">
                            <div className="flex-1 truncate">
                              <span className="font-semibold text-gray-900">{i.itemName}</span>
                              <span className="text-gray-500 font-mono ml-1">({i.quantity} × {fmt(i.unitPrice || 0)})</span>
                              {returnedQty > 0 && (
                                <span className="ml-1.5 text-[10px] text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                                  ফেরত: {returnedQty}
                                </span>
                              )}
                            </div>
                            {role === 'OWNER' && remainingReturnable > 0 && (
                              <button
                                type="button"
                                onClick={() => openReturnModal('PURCHASE', p, i.itemId)}
                                className="px-2 py-1 rounded-md bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-[11px] font-bold cursor-pointer shrink-0"
                              >
                                ফেরত
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-3 gap-2 py-2 border-y border-gray-100 text-center font-mono">
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">মোট মূল্য</div>
                        <div className="text-sm font-bold text-gray-900">{fmt(total)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">পরিশোধিত</div>
                        <div className="text-sm font-semibold text-emerald-700">{fmt(paid)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-500 font-sans">বকেয়া</div>
                        <div className={`text-sm font-bold ${due > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{fmt(due)}</div>
                      </div>
                    </div>

                    {p.transportCost > 0 && (
                      <div className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-mono flex items-center justify-between">
                        <span>পরিবহন খরচ:</span>
                        <span className="font-bold">৳{fmt(p.transportCost)}</span>
                      </div>
                    )}

                    {pReturns.length > 0 && (
                      <div className="text-xs text-sky-800 bg-sky-50 px-2.5 py-1.5 rounded-lg border border-sky-200 font-mono flex items-center justify-between">
                        <span>{pReturns.length}টি ফেরত সমন্বিত</span>
                        <span className="font-bold">৳{fmt(pReturns.reduce((sum, r) => sum + (r.totalRefundAmount || 0), 0))}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <button
                        type="button"
                        id={`btn-view-receipt-purchase-${p.id}`}
                        onClick={() => setReceiptModal({ type: 'PURCHASE', record: p })}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                      >
                        <Receipt className="w-4 h-4 text-sky-700" />
                        <span>রশিদ</span>
                      </button>
                      {hasDue && (
                        <button
                          type="button"
                          id={`btn-add-installment-purchase-${p.id}`}
                          onClick={() => openPaymentModal('PURCHASE', p)}
                          className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <PlusCircle className="w-4 h-4" />
                          <span>কিস্তি যোগ</span>
                        </button>
                      )}
                      {role === 'OWNER' && hasReturnableItems && (
                        <button
                          type="button"
                          id={`btn-return-purchase-${p.id}`}
                          onClick={() => openReturnModal('PURCHASE', p)}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1 shadow-xs"
                        >
                          <RotateCcw className="w-4 h-4 text-sky-700" />
                          <span>ফেরত</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View (Hidden on mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[650px] text-left text-[14px] text-gray-800">
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
                    const pReturns = purchaseReturns.filter((ret) => ret.purchaseId === p.id);
                    const total = Number(p.grandTotal || p.totalAmount || 0);
                    const paid = Number(p.paidAmount || 0);
                    const due = Number(p.dueAmount !== undefined ? p.dueAmount : Math.max(0, total - paid));
                    const hasDue = due > 0;
                    const hasReturnableItems = (p.items || []).some((i) => {
                      const retQty = getItemReturnedQtyForPurchase(p.id, i.itemId);
                      return (Number(i.quantity) || 0) - retQty > 0.0001;
                    });

                    const pItems = (p.items && Array.isArray(p.items) && p.items.length > 0)
                      ? p.items
                      : [{
                          itemId: (p as any).itemId || '',
                          itemName: (p as any).itemName || 'আইটেম',
                          quantity: (p as any).quantity || 1,
                          unitPrice: (p as any).unitPrice || total,
                          unit: (p as any).unit || 'একক',
                          total: total
                        }];

                    return (
                      <React.Fragment key={p.id}>
                        <tr className="hover:bg-gray-50/80">
                          <td className="p-3 font-bold text-sky-700 font-mono">{p.displayNumber || p.invoiceNumber}</td>
                          <td className="p-3 text-gray-600">{p.date}</td>
                          <td className="p-3 font-semibold text-gray-900">{p.supplierName}</td>
                          <td className="p-3">
                            {pItems.map((i, idx) => {
                              const returnedQty = getItemReturnedQtyForPurchase(p.id, i.itemId);
                              const remainingReturnable = Math.max(0, Math.round(((Number(i.quantity) || 0) - returnedQty) * 1000) / 1000);
                              return (
                                <div key={idx} className="flex items-center justify-between gap-2 py-0.5 text-gray-700 text-[13px]">
                                  <div>
                                    <span>{i.itemName} ({i.quantity} × {fmt(i.unitPrice || 0)})</span>
                                    {Boolean(i.vatRatePercent && i.vatRatePercent > 0) && (
                                      <span className="ml-1 text-[11px] text-emerald-700 font-medium">
                                        ({i.vatRatePercent}% ভ্যাট)
                                      </span>
                                    )}
                                    {returnedQty > 0 && (
                                      <span className="ml-1.5 text-[11px] font-semibold text-sky-800 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                                        ফেরত: {returnedQty} | অবশিষ্ট: {remainingReturnable}
                                      </span>
                                    )}
                                  </div>
                                  {role === 'OWNER' && (
                                    remainingReturnable > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => openReturnModal('PURCHASE', p, i.itemId)}
                                        className="px-2 py-0.5 rounded-md bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1 shrink-0 shadow-2xs"
                                        title={`${i.itemName} সরবরাহকারীকে ফেরত দিন (ডেবিট নোট)`}
                                      >
                                        <RotateCcw className="w-3 h-3 text-sky-700" />
                                        <span>ফেরত</span>
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                        সম্পূর্ণ ফেরত
                                      </span>
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </td>
                          <td className="p-3 text-amber-700 font-medium">{fmt(p.transportCost || 0)}</td>
                          <td className="p-3 font-mono">
                            <div className="text-red-600 font-bold">{fmt(total)}</div>
                            {Boolean(p.discount && p.discount > 0) && (
                              <div className="text-[11px] text-emerald-700 font-sans font-medium">
                                ছাড়: ৳{fmt(p.discount)}
                              </div>
                            )}
                            {Boolean((p.taxVat || p.vat || p.vatTax) && Number(p.taxVat || p.vat || p.vatTax) > 0) && (
                              <div className="text-[11px] text-emerald-700 font-sans font-medium">
                                ভ্যাট: ৳{fmt(Number(p.taxVat || p.vat || p.vatTax))}
                              </div>
                            )}
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
                                ? 'bg-emerald-50 text-[#14532D] border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                : (paid > 0
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                                    : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800')
                            }`}>
                              {due <= 0 || p.status === 'PAID' ? 'পরিশোধিত' : (paid > 0 ? `আংশিক বাকি (৳${fmt(due)})` : `বাকি (৳${fmt(due)})`)}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              <button
                                type="button"
                                id={`btn-view-receipt-purchase-${p.id}`}
                                onClick={() => setReceiptModal({ type: 'PURCHASE', record: p })}
                                className="px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                title="রশিদ দেখুন / ডাউনলোড / শেয়ার করুন"
                              >
                                <Receipt className="w-3.5 h-3.5 text-sky-700" />
                                <span>রশিদ দেখুন/শেয়ার করুন</span>
                              </button>
                              {role === 'OWNER' && hasReturnableItems && (
                                <button
                                  type="button"
                                  id={`btn-return-purchase-${p.id}`}
                                  onClick={() => openReturnModal('PURCHASE', p)}
                                  className="px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                  title="সরবরাহকারীকে পণ্য ফেরত ও ডেবিট নোট তৈরি করুন"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-sky-700" />
                                  <span>ফেরত (Return)</span>
                                </button>
                              )}
                              {hasDue && (
                                <button
                                  type="button"
                                  id={`btn-add-installment-purchase-${p.id}`}
                                  onClick={() => openPaymentModal('PURCHASE', p)}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap min-h-[36px]"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" />
                                  <span>কিস্তি যোগ করুন</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {pReturns.length > 0 && (
                          <tr className="bg-sky-50/60 border-b border-sky-200">
                            <td colSpan={9} className="px-4 py-2.5">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                                  <div className="flex items-center gap-1.5 font-bold text-sky-900">
                                    <RotateCcw className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                    <span>ফেরতের ইতিহাস (Return History - {pReturns.length}টি ডেবিট নোট):</span>
                                  </div>
                                  <span className="text-[11px] text-sky-800 font-semibold font-mono">
                                    মোট সমন্বয়: {fmt(pReturns.reduce((sum, r) => sum + (r.totalRefundAmount || 0), 0))}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {pReturns.map((ret) => (
                                    <div
                                      key={ret.id}
                                      className="inline-flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-sky-200 text-xs shadow-2xs text-gray-800 font-mono flex-wrap"
                                    >
                                      <span className="font-bold text-sky-900">{ret.displayNumber || ret.returnNumber}</span>
                                      <span className="text-gray-400">|</span>
                                      <span className="text-gray-600 font-sans">{ret.date}</span>
                                      <span className="text-gray-400">|</span>
                                      <span className="font-bold text-emerald-700">{fmt(ret.totalRefundAmount)}</span>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-sky-100 text-sky-800">
                                        {ret.refundMethod === 'CASH'
                                          ? 'নগদ ফেরত'
                                          : ret.refundMethod === 'BANK'
                                          ? 'ব্যাংক জমা'
                                          : 'বাকি সমন্বয়'}
                                      </span>
                                      <span className="text-gray-400">|</span>
                                      <span className="text-gray-700 font-sans text-[11px]">
                                        {ret.items?.map((it) => `${it.itemName}: ${it.returnedQuantity}`).join(', ')}
                                      </span>
                                      {ret.reason && (
                                        <span className="text-gray-500 font-sans text-[11px] italic">
                                          ({ret.reason})
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
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
                                    <span className="font-bold text-[#15803D]">{fmt(pmt.amount)}</span>
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
        selectedParty ? (
          /* Detailed Party Statement View */
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-xs space-y-6">
            {/* Header with Back Button and Party Information */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedParty(null)}
                  className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 transition-colors cursor-pointer flex items-center gap-1.5 text-xs sm:text-sm font-bold min-h-[40px]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>তালিকায় ফিরুন</span>
                </button>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-900">
                      {activeParty?.name}
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        activeParty?.type === 'CUSTOMER'
                          ? 'bg-sky-50 text-sky-700 border border-sky-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {activeParty?.type === 'CUSTOMER' ? 'ক্রেতা (Customer)' : 'সরবরাহকারী (Supplier)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs sm:text-[13px] text-gray-500 mt-1 flex-wrap">
                    {activeParty?.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-gray-400" />
                        {activeParty.phone}
                      </span>
                    )}
                    {activeParty?.address && (
                      <span>ঠিকানা: {activeParty.address}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {role === 'OWNER' && activeParty && (
                  <button
                    type="button"
                    id="btn-party-statement-advance"
                    onClick={() => {
                      setAdvPartyId(activeParty.id);
                      setAdvDirection(activeParty.type === 'CUSTOMER' ? 'RECEIVED' : 'PAID');
                      setAdvAmount('');
                      setAdvNarration('');
                      setShowAdvanceModal(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs sm:text-[13px] flex items-center gap-1.5 shadow-xs transition-all cursor-pointer min-h-[38px]"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>
                      {activeParty.type === 'CUSTOMER'
                        ? '+ অগ্রিম গ্রহণ (Advance)'
                        : '+ অগ্রিম প্রদান (Advance)'}
                    </span>
                  </button>
                )}
                <div className="text-xs text-gray-500">
                  পক্ষ কোড: <span className="font-mono text-gray-700 font-semibold">{activeParty?.id}</span>
                </div>
              </div>
            </div>

            {/* Top Running Balance Card (Requirement 2) */}
            <div className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50/50 to-amber-50/30 border border-amber-200/80 p-5 sm:p-6 shadow-2xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="text-xs sm:text-sm font-bold tracking-wide uppercase text-amber-800">
                    {activeParty?.type === 'CUSTOMER'
                      ? 'চলতি জের — গ্রাহকের নিকট মোট বকেয়া পাওনা (Total Owed by Customer)'
                      : 'চলতি জের — সরবরাহকারীকে মোট প্রদেয় দেনা (Total Owed to Supplier)'}
                  </div>
                  <div className="text-2xl sm:text-4xl font-extrabold text-amber-950 font-mono mt-1">
                    ৳{fmt(partySummary.runningBalance)}
                  </div>
                  <p className="text-xs text-amber-700/80 mt-1">
                    {activeParty?.type === 'CUSTOMER'
                      ? 'এই গ্রাহকের নিকট থেকে সর্বমোট বাকি আদায়যোগ্য পাওনা'
                      : 'এই সরবরাহকারীকে খামার থেকে সর্বমোট পরিশোধযোগ্য বাকি দেনা'}
                  </p>
                </div>

                {/* Summary Metrics (Requirement 3: Party Advance Balance) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 text-center">
                  <div className="bg-white/90 backdrop-blur-xs p-2.5 sm:p-3 rounded-xl border border-amber-100 shadow-2xs">
                    <div className="text-[11px] sm:text-xs text-gray-500 font-semibold">মোট চালান</div>
                    <div className="text-base sm:text-lg font-bold text-gray-900 font-mono mt-0.5">
                      {partyInvoices.length}টি
                    </div>
                  </div>
                  <div className="bg-white/90 backdrop-blur-xs p-2.5 sm:p-3 rounded-xl border border-amber-100 shadow-2xs">
                    <div className="text-[11px] sm:text-xs text-gray-500 font-semibold">সর্বমোট ইনভয়েস</div>
                    <div className="text-base sm:text-lg font-bold text-gray-900 font-mono mt-0.5">
                      ৳{fmt(partySummary.totalInvoiced)}
                    </div>
                  </div>
                  <div className="bg-white/90 backdrop-blur-xs p-2.5 sm:p-3 rounded-xl border border-amber-100 shadow-2xs">
                    <div className="text-[11px] sm:text-xs text-gray-500 font-semibold">মোট পরিশোধিত</div>
                    <div className="text-base sm:text-lg font-bold text-emerald-700 font-mono mt-0.5">
                      ৳{fmt(partySummary.totalPaid)}
                    </div>
                  </div>
                  <div
                    id="party-advance-balance-metric"
                    className={`p-2.5 sm:p-3 rounded-xl border shadow-2xs ${
                      partyAdvanceBalance > 0
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950 ring-1 ring-emerald-300'
                        : 'bg-white/90 border-amber-100'
                    }`}
                  >
                    <div className="text-[11px] sm:text-xs text-gray-600 font-semibold">
                      {activeParty?.type === 'CUSTOMER' ? 'জমা অগ্রিম ব্যালেন্স' : 'প্রদত্ত অগ্রিম ব্যালেন্স'}
                    </div>
                    <div
                      className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${
                        partyAdvanceBalance > 0 ? 'text-emerald-700' : 'text-gray-800'
                      }`}
                    >
                      ৳{fmt(partyAdvanceBalance)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Party Advance Highlight Banner (Requirement 3) */}
            {partyAdvanceBalance > 0 && (
              <div id="party-advance-balance-banner" className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 text-emerald-950 text-xs sm:text-sm">
                  <CreditCard className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <span className="font-bold">
                      {activeParty?.type === 'CUSTOMER'
                        ? 'গ্রাহক অগ্রিম স্থিতি (Customer Advance Balance): '
                        : 'সরবরাহকারী অগ্রিম স্থিতি (Supplier Advance Balance): '}
                    </span>
                    <strong className="font-mono text-emerald-900 text-base">৳{fmt(partyAdvanceBalance)}</strong>
                    <span className="text-emerald-800 text-xs ml-2">
                      ({activeParty?.type === 'CUSTOMER'
                        ? 'পরবর্তী বিক্রয় চালানে সমন্বয়যোগ্য'
                        : 'পরবর্তী ক্রয় চালানে সমন্বয়যোগ্য'})
                    </span>
                  </div>
                </div>
                {role === 'OWNER' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (activeParty?.type === 'CUSTOMER') {
                        setTab('sales');
                        setSaleCustomerId(activeParty.id);
                        setShowNewSale(true);
                      } else if (activeParty?.type === 'SUPPLIER') {
                        setTab('purchases');
                        setPurchSupplierId(activeParty.id);
                        setShowNewPurchase(true);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-all shadow-2xs cursor-pointer"
                  >
                    চালানে সমন্বয় করুন →
                  </button>
                )}
              </div>
            )}

            {/* Chronological Statement List (Requirement 1) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-700" />
                  <span>চালান ও কিস্তি পরিশোধের কালানুক্রমিক বিবরণী (Chronological Statement)</span>
                </h4>
                <span className="text-xs text-gray-500">
                  সর্বমোট {partyInvoices.length}টি লেনদেন
                </span>
              </div>

              {partyInvoices.length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 space-y-1">
                  <FileCheck className="w-8 h-8 text-gray-400 mx-auto" />
                  <div className="text-sm font-semibold text-gray-700">কোনো চালান পাওয়া যায়নি</div>
                  <div className="text-xs text-gray-500">
                    এই {activeParty?.type === 'CUSTOMER' ? 'গ্রাহকের' : 'সরবরাহকারীর'} সাথে এখনো কোনো বিক্রয় বা ক্রয় চালান সম্পন্ন হয়নি।
                  </div>
                </div>
              ) : (
                <>
                  {/* Mobile Invoices Card View (Optimized for iPhone 13 mini) */}
                  <div className="md:hidden space-y-3">
                    {partyInvoices.map((inv) => (
                      <div
                        key={`mob-inv-${inv.id}`}
                        className="p-4 rounded-2xl border border-gray-200 bg-white shadow-xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-amber-900 font-mono text-[15px]">{inv.displayNumber}</div>
                            <div className="text-xs text-gray-500 font-mono mt-0.5">{inv.date}</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                inv.type === 'SALE'
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : 'bg-sky-50 text-sky-700 border border-sky-200'
                              }`}
                            >
                              {inv.type === 'SALE' ? 'বিক্রয়' : 'ক্রয়'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                inv.status === 'PAID'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : inv.status === 'PARTIAL'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                            >
                              {inv.status === 'PAID' ? 'পরিশোধিত' : inv.status === 'PARTIAL' ? 'আংশিক' : 'বকেয়া'}
                            </span>
                          </div>
                        </div>

                        {inv.items && inv.items.length > 0 && (
                          <div className="bg-[#F8FAFC] rounded-xl p-2.5 text-xs text-gray-700 border border-gray-100 space-y-1">
                            <div className="text-[11px] font-bold text-gray-500 uppercase">পণ্যসমূহ ({inv.items.length}টি):</div>
                            {inv.items.slice(0, 3).map((item, iIdx) => (
                              <div key={iIdx} className="flex justify-between items-center text-xs">
                                <span className="font-medium text-gray-900 truncate">{item.itemName}</span>
                                <span className="text-gray-500 font-mono ml-1">{item.quantity} {item.unit}</span>
                              </div>
                            ))}
                            {inv.items.length > 3 && (
                              <div className="text-[11px] text-gray-400 italic text-right">+ আরও {inv.items.length - 3}টি আইটেম</div>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2 py-2 border-y border-gray-100 text-center font-mono">
                          <div>
                            <div className="text-[11px] font-sans text-gray-500">মোট মূল্য</div>
                            <div className="text-sm font-bold text-gray-900">৳{fmt(inv.totalAmount)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-gray-500">পরিশোধ</div>
                            <div className="text-sm font-semibold text-emerald-700">৳{fmt(inv.paidAmount)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-gray-500">বকেয়া</div>
                            <div className={`text-sm font-bold ${inv.dueAmount > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                              ৳{fmt(inv.dueAmount)}
                            </div>
                          </div>
                        </div>

                        {inv.returns && inv.returns.length > 0 && (
                          <div className="text-xs text-amber-900 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 font-mono flex items-center justify-between">
                            <span>{inv.returns.length}টি ফেরত সমন্বিত</span>
                            <span className="font-bold">৳{fmt(inv.returns.reduce((sum: number, r: any) => sum + (r.totalRefundAmount || 0), 0))}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setReceiptModal({ type: inv.type, record: inv.rawRecord })}
                            className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <Receipt className="w-4 h-4 text-amber-700" />
                            <span>রশিদ</span>
                          </button>
                          {inv.dueAmount > 0 && (
                            <button
                              type="button"
                              onClick={() => openPaymentModal(inv.type, inv.rawRecord)}
                              className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-xs"
                            >
                              <PlusCircle className="w-4 h-4" />
                              <span>কিস্তি যোগ</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop Full Invoices Table */}
                  <div className="hidden md:block border border-gray-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs sm:text-[13px]">
                      <thead className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-bold uppercase text-[11px] tracking-wider">
                        <tr>
                          <th className="p-3">তারিখ</th>
                          <th className="p-3">চালান নম্বর</th>
                          <th className="p-3">ধরণ</th>
                          <th className="p-3">পণ্যের বিবরণ</th>
                          <th className="p-3 text-right">মোট মূল্য</th>
                          <th className="p-3 text-right">পরিশোধ</th>
                          <th className="p-3 text-right">বাকি</th>
                          <th className="p-3 text-center">অবস্থা</th>
                          <th className="p-3 text-center">অ্যাকশন</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {partyInvoices.map((inv) => (
                          <React.Fragment key={inv.id}>
                            <tr className="hover:bg-amber-50/30 transition-colors">
                              <td className="p-3 text-gray-600 whitespace-nowrap font-mono">{inv.date}</td>
                              <td className="p-3 font-bold text-amber-900 font-mono whitespace-nowrap">
                                {inv.displayNumber}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                    inv.type === 'SALE'
                                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                      : 'bg-sky-50 text-sky-700 border border-sky-200'
                                  }`}
                                >
                                  {inv.type === 'SALE' ? 'বিক্রয় চালান' : 'ক্রয় চালান'}
                                </span>
                              </td>
                              <td className="p-3 text-gray-700 max-w-[220px]">
                                {inv.items && inv.items.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {inv.items.map((item, iIdx) => (
                                      <div key={iIdx} className="truncate">
                                        <span className="font-medium text-gray-900">{item.itemName}</span>{' '}
                                        <span className="text-gray-500">
                                          ({item.quantity} {item.unit})
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-gray-400">বিবরণ নেই</span>
                                )}
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-gray-900 whitespace-nowrap">
                                {fmt(inv.totalAmount)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                {fmt(inv.paidAmount)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold whitespace-nowrap">
                                <span className={inv.dueAmount > 0 ? 'text-red-700 font-extrabold' : 'text-gray-500'}>
                                  {fmt(inv.dueAmount)}
                                </span>
                              </td>
                              <td className="p-3 text-center whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                    inv.status === 'PAID'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : inv.status === 'PARTIAL'
                                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                      : 'bg-red-50 text-red-700 border border-red-200'
                                  }`}
                                >
                                  {inv.status === 'PAID' ? 'পরিশোধিত' : inv.status === 'PARTIAL' ? 'আংশিক বাকি' : 'বাকি'}
                                </span>
                              </td>
                              <td className="p-3 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                  <button
                                    type="button"
                                    id={`btn-view-receipt-party-${inv.id}`}
                                    onClick={() => setReceiptModal({ type: inv.type, record: inv.rawRecord })}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 min-h-[30px]"
                                    title="রশিদ দেখুন/শেয়ার করুন"
                                  >
                                    <Receipt className="w-3.5 h-3.5 text-emerald-700" />
                                    <span>রশিদ দেখুন/শেয়ার করুন</span>
                                  </button>
                                  {role === 'OWNER' && (
                                    <button
                                      type="button"
                                      onClick={() => openReturnModal(inv.type, inv.rawRecord)}
                                      className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 min-h-[30px]"
                                      title="পণ্য ফেরত ও নোট তৈরি করুন"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                                      <span>ফেরত</span>
                                    </button>
                                  )}
                                  {inv.dueAmount > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => openPaymentModal(inv.type, inv.rawRecord)}
                                      className="px-2.5 py-1 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1 min-h-[30px]"
                                    >
                                      <PlusCircle className="w-3.5 h-3.5" />
                                      <span>কিস্তি পরিশোধ</span>
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-400 font-medium">সম্পূর্ণ পরিশোধিত</span>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {/* Return History Sub-Row */}
                            {inv.returns && inv.returns.length > 0 && (
                              <tr className="bg-amber-50/50 border-b border-amber-200">
                                <td colSpan={9} className="px-4 py-2">
                                  <div className="space-y-1">
                                    <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                                      <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                                      <span>ফেরতের ইতিহাস ({inv.returns.length}টি ফেরত সম্পন্ন):</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {inv.returns.map((ret: any) => (
                                        <div
                                          key={ret.id}
                                          className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-amber-200 text-gray-800 font-mono text-xs shadow-2xs"
                                        >
                                          <span className="font-bold text-amber-900">{ret.displayNumber || ret.returnNumber}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="text-gray-600 font-sans">{ret.date}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="font-bold text-rose-700">{fmt(ret.totalRefundAmount)}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="text-gray-700 font-sans text-[11px]">
                                            {ret.items?.map((it: any) => `${it.itemName}: ${it.returnedQuantity}`).join(', ')}
                                          </span>
                                          {ret.reason && (
                                            <span className="text-gray-500 font-sans text-[11px] italic">
                                              ({ret.reason})
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}

                            {/* Full Installment / Partial-Payment History Sub-Row */}
                            {inv.payments && inv.payments.length > 0 ? (
                              <tr className="bg-amber-50/25 border-b border-gray-100">
                                <td colSpan={9} className="px-4 py-2.5">
                                  <div className="space-y-1.5">
                                    <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                                      <CreditCard className="w-3.5 h-3.5 text-amber-700" />
                                      <span>কিস্তি ও আংশিক পরিশোধের ইতিহাস ({inv.payments.length}টি কিস্তি সম্পন্ন):</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {inv.payments.map((pmt) => (
                                        <div
                                          key={pmt.id}
                                          className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-gray-200 text-gray-800 font-mono text-xs shadow-2xs"
                                        >
                                          <span className="text-gray-500">{pmt.date}:</span>
                                          <span className="font-bold text-emerald-700">+ ৳{fmt(pmt.amount)}</span>
                                          {pmt.note && (
                                            <span className="text-gray-400 font-sans text-[11px]">({pmt.note})</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : inv.paidAmount > 0 ? (
                              <tr className="bg-gray-50/40 border-b border-gray-100">
                                <td colSpan={9} className="px-4 py-1.5 text-xs text-gray-500">
                                  চালান সৃষ্টির সময় এককালীন পরিশোধ: <span className="font-mono font-bold text-emerald-700">৳{fmt(inv.paidAmount)}</span>
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

              {/* Advance Payments & Receipts Table for this Party (Requirement 3) */}
              {(() => {
                const partyAdvances = advancePayments.filter(
                  (a) => a.partyId === activeParty?.id && a.status !== 'CANCELLED'
                );
                if (partyAdvances.length === 0) return null;
                return (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="font-bold text-gray-900 text-sm sm:text-base flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-emerald-700" />
                        <span>অগ্রিম গ্রহণ ও প্রদানের বিবরণী (Advance Transactions)</span>
                      </h4>
                      <span className="text-xs text-gray-500 font-mono">
                        মোট {partyAdvances.length}টি অগ্রিম এন্ট্রি
                      </span>
                    </div>
                    {/* Mobile Party Advances Cards View (Optimized for iPhone 13 mini) */}
                    <div className="md:hidden space-y-2.5">
                      {partyAdvances.map((adv) => {
                        const remaining = adv.remainingAmount !== undefined
                          ? adv.remainingAmount
                          : (adv.remainingBalance ?? adv.remainingUnappliedBalance ?? 0);
                        const applied = adv.appliedAmount !== undefined
                          ? adv.appliedAmount
                          : Math.max(0, adv.amount - remaining);
                        const isFully = adv.status === 'FULLY_APPLIED' || adv.status === 'EXHAUSTED' || remaining <= 0;
                        const isPartial = adv.status === 'PARTIALLY_APPLIED' || (remaining > 0 && remaining < adv.amount);

                        return (
                          <div
                            key={`mob-adv-${adv.id}`}
                            className="p-3.5 rounded-xl border border-emerald-200 bg-white shadow-2xs space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-bold text-emerald-950 font-mono text-sm">
                                  {adv.displayNumber || adv.advanceNumber}
                                </div>
                                <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                  {adv.date} · {adv.paymentMethod === 'CASH' ? 'নগদ' : 'ব্যাংক'}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    adv.direction === 'RECEIVED'
                                      ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  {adv.direction === 'RECEIVED' ? 'অগ্রিম গ্রহণ' : 'অগ্রিম প্রদান'}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    isFully
                                      ? 'bg-gray-100 text-gray-600'
                                      : isPartial
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {isFully ? 'সমন্বিত' : isPartial ? 'আংশিক' : 'অব্যবহৃত'}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 py-1.5 border-t border-emerald-100 text-center font-mono text-xs">
                              <div>
                                <span className="font-sans text-gray-500 block text-[10px]">মূল অগ্রিম</span>
                                <span className="font-bold text-gray-900">৳{fmt(adv.amount)}</span>
                              </div>
                              <div>
                                <span className="font-sans text-gray-500 block text-[10px]">সমন্বিত</span>
                                <span className="text-gray-700">৳{fmt(applied)}</span>
                              </div>
                              <div>
                                <span className="font-sans text-gray-500 block text-[10px]">অবশিষ্ট</span>
                                <span className="font-bold text-emerald-700">৳{fmt(remaining)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop Full Advances Table */}
                    <div className="hidden md:block border border-emerald-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-[13px]">
                          <thead className="bg-emerald-50/70 border-b border-emerald-200 text-emerald-950 font-bold uppercase text-[11px]">
                            <tr>
                              <th className="p-3">তারিখ</th>
                              <th className="p-3">অগ্রিম নং</th>
                              <th className="p-3">ধরণ</th>
                              <th className="p-3">উৎস/মাধ্যম</th>
                              <th className="p-3 text-right">মূল অগ্রিম</th>
                              <th className="p-3 text-right">চালানে সমন্বিত</th>
                              <th className="p-3 text-right">অবশিষ্ট অগ্রিম</th>
                              <th className="p-3 text-center">স্থিতি</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {partyAdvances.map((adv) => {
                              const remaining = adv.remainingAmount !== undefined
                                ? adv.remainingAmount
                                : (adv.remainingBalance ?? adv.remainingUnappliedBalance ?? 0);
                              const applied = adv.appliedAmount !== undefined
                                ? adv.appliedAmount
                                : Math.max(0, adv.amount - remaining);
                              const isFully = adv.status === 'FULLY_APPLIED' || adv.status === 'EXHAUSTED' || remaining <= 0;
                              const isPartial = adv.status === 'PARTIALLY_APPLIED' || (remaining > 0 && remaining < adv.amount);

                              return (
                                <tr key={adv.id} className="hover:bg-emerald-50/30 transition-colors">
                                  <td className="p-3 font-mono text-gray-700 whitespace-nowrap">{adv.date}</td>
                                  <td className="p-3 font-bold font-mono text-emerald-950 whitespace-nowrap">
                                    {adv.displayNumber || adv.advanceNumber}
                                  </td>
                                  <td className="p-3 whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                        adv.direction === 'RECEIVED'
                                          ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                                      }`}
                                    >
                                      {adv.direction === 'RECEIVED' ? 'অগ্রিম গ্রহণ (দায়)' : 'অগ্রিম প্রদান (সম্পদ)'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-gray-700 whitespace-nowrap">
                                    {adv.paymentMethod === 'CASH' ? 'নগদ (Cash)' : 'ব্যাংক (Bank)'}
                                  </td>
                                  <td className="p-3 text-right font-mono font-bold text-gray-900 whitespace-nowrap">
                                    ৳{fmt(adv.amount)}
                                  </td>
                                  <td className="p-3 text-right font-mono text-gray-600 whitespace-nowrap">
                                    ৳{fmt(applied)}
                                  </td>
                                  <td className="p-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                    ৳{fmt(remaining)}
                                  </td>
                                  <td className="p-3 text-center whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                        isFully
                                          ? 'bg-gray-100 text-gray-600'
                                          : isPartial
                                          ? 'bg-amber-100 text-amber-800'
                                          : 'bg-emerald-100 text-emerald-800'
                                      }`}
                                    >
                                      {isFully
                                        ? 'সম্পূর্ণ সমন্বিত'
                                        : isPartial
                                        ? 'আংশিক সমন্বিত'
                                        : 'অব্যবহৃত'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          /* Parties Directory List */
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
              <div>
                <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-700" />
                  <span>গ্রাহক ও সরবরাহকারী তালিকা (Parties Directory)</span>
                </h3>
                <p className="text-[13px] text-gray-600 mt-0.5">যেকোনো পক্ষে ট্যাপ করে বিস্তারিত স্টেটমেন্ট ও চালানের ইতিহাস দেখুন</p>
              </div>

              {role === 'OWNER' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    id="btn-open-advance-action-parties"
                    onClick={() => {
                      setAdvPartyId('');
                      setAdvDirection('RECEIVED');
                      setAdvAmount('');
                      setAdvNarration('');
                      setShowAdvanceModal(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 text-[13px] font-bold shadow-2xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                  >
                    <CreditCard className="w-4 h-4 text-sky-700" />
                    <span>অগ্রিম গ্রহণ/প্রদান (Advance Received/Paid)</span>
                  </button>
                  <button
                    onClick={() => setShowAddParty(!showAddParty)}
                    className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>+ নতুন ব্যক্তি/প্রতিষ্ঠান</span>
                  </button>
                </div>
              )}
            </div>

            {showAddParty && (
              <form onSubmit={handleAddParty} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3.5">
                <div className="font-bold text-amber-900 text-[15px]">নতুন পক্ষ (Party) নিবন্ধন</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">নাম / প্রতিষ্ঠান *</label>
                    <input
                      type="text"
                      required
                      placeholder="যেমন: হাজী ট্রেডার্স"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">পক্ষের ধরন *</label>
                    <select
                      value={partyType}
                      onChange={(e) => setPartyType(e.target.value as any)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    >
                      <option value="CUSTOMER">ক্রেতা (Customer)</option>
                      <option value="SUPPLIER">সরবরাহকারী (Supplier)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ফোন নম্বর</label>
                    <input
                      type="text"
                      placeholder="০১৭১১-xxxxxx"
                      value={partyPhone}
                      onChange={(e) => setPartyPhone(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">ঠিকানা</label>
                    <input
                      type="text"
                      placeholder="ঠিকানা"
                      value={partyAddress}
                      onChange={(e) => setPartyAddress(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddParty(false)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                  >
                    বাতিল
                  </button>
                  <button
                    type="submit"
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm transition-colors"
                  >
                    সংরক্ষণ করুন
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {parties.map((p, idx) => (
                <div
                  key={p.id}
                  style={{ animationDelay: `${Math.min(idx * 35, 350)}ms` }}
                  onClick={() => setSelectedParty(p)}
                  className="p-4 rounded-2xl bg-[#F8FAFC] border border-gray-200 space-y-2 shadow-xs animate-fade-slide-up hover:border-amber-400 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900 text-[15px] group-hover:text-amber-800 transition-colors">{p.name}</span>
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
                  {(() => {
                    const pAdv = advancePayments
                      .filter((a) => a.partyId === p.id && a.status !== 'CANCELLED')
                      .reduce((sum, a) => sum + (Number(a.remainingAmount ?? a.remainingBalance ?? a.remainingUnappliedBalance) || 0), 0);
                    return pAdv > 0 ? (
                      <div className="flex items-center justify-between font-mono text-xs text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        <span className="font-sans font-semibold">অগ্রিম ব্যালেন্স:</span>
                        <span className="font-bold text-emerald-700">৳{fmt(pAdv)}</span>
                      </div>
                    ) : null;
                  })()}
                  <div className="pt-1.5 border-t border-gray-100 flex items-center justify-between text-xs text-amber-800 font-semibold group-hover:text-amber-900">
                    <span>স্টেটমেন্ট ও চালান হিসাব দেখুন</span>
                    <ChevronRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform text-amber-700" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
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
                  চালান নং: <span className="font-mono font-bold text-amber-800">{paymentModal.invoiceNumber}</span> ({paymentModal.partyName})
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
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                  পরিশোধের মাধ্যম (উৎস) <span className="text-red-500">*</span>
                </label>
                <select
                  id="select-installment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK')}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                >
                  <option value="CASH">নগদ (Cash on Hand - 1010)</option>
                  <option value="BANK">ব্যাংক স্থানান্তর (Bank Account - 1030)</option>
                </select>
              </div>

              {paymentMethod === 'BANK' && cashBankAccounts.filter((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING').length > 0 && (
                <div>
                  <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                    ব্যাংক হিসাব নির্বাচন করুন
                  </label>
                  <select
                    id="select-installment-bank-account"
                    value={paymentBankAccountId}
                    onChange={(e) => setPaymentBankAccountId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  >
                    <option value="">-- ব্যাংক হিসাব নির্বাচন করুন --</option>
                    {cashBankAccounts
                      .filter((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING')
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.accountNumber ? `(${b.accountNumber})` : ''} - ব্যালেন্স: ৳{b.currentBalance.toLocaleString()}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
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
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] font-mono font-bold text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                  পরিশোধের তারিখ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  id="input-installment-date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                  নোট / বিবরণ (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  id="input-installment-note"
                  placeholder="যেমন: বিকাশ / ব্যাংক চেক / নগদ কিস্তি ১"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  id="btn-cancel-installment"
                  onClick={() => setPaymentModal(null)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  id="btn-save-installment"
                  disabled={isSubmittingPayment}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm transition-colors"
                >
                  {isSubmittingPayment ? 'সংরক্ষণ হচ্ছে...' : 'কিস্তি সংরক্ষণ করুন'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sales / Purchase Return Modal */}
      {returnModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-auto animate-in fade-in zoom-in duration-150">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    returnModal.type === 'SALE' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
                  }`}
                >
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-900">
                    {returnModal.type === 'SALE' ? 'বিক্রয় ফেরত (ফেরত ক্রেডিট নোট)' : 'ক্রয় ফেরত (ফেরত ডেবিট নোট)'}
                  </h3>
                  <p className="text-xs text-gray-500 font-mono">
                    চালান নং: <strong className="text-gray-800">{returnModal.invoiceNumber}</strong>
                    {' • '}
                    {returnModal.type === 'SALE' ? 'ক্রেতা: ' : 'সরবরাহকারী: '}
                    <strong className="text-gray-800 font-sans">{returnModal.partyName}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReturnModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteReturn} className="mt-4 space-y-4">
              {/* If multi-item invoice or selection */}
              <div>
                <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                  ফেরতযোগ্য পণ্য নির্বাচন করুন <span className="text-red-500">*</span>
                </label>
                {(returnModal.items || []).length > 1 ? (
                  <select
                    value={returnSelectedItemId}
                    onChange={(e) => handleSwitchReturnItem(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                  >
                    {(returnModal.items || []).map((it) => (
                      <option
                        key={it.itemId}
                        value={it.itemId}
                        disabled={it.remainingReturnableQty <= 0}
                      >
                        {it.itemName} (চালানে: {it.soldOrPurchasedQty} {it.unit} | অবশিষ্ট ফেরতযোগ্য: {it.remainingReturnableQty} {it.unit})
                        {it.remainingReturnableQty <= 0 ? ' - সম্পন্ন' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-semibold text-gray-800">
                    {(returnModal.items || [])[0]?.itemName} ({(returnModal.items || [])[0]?.soldOrPurchasedQty} {(returnModal.items || [])[0]?.unit})
                  </div>
                )}
              </div>

              {/* Selected Item Stats Card */}
              {(() => {
                const target = (returnModal.items || []).find((it) => it.itemId === returnSelectedItemId) || (returnModal.items || [])[0];
                if (!target) return null;

                const qty = parseFloat(returnQuantity) || 0;
                const estimatedRefund = Math.round(qty * target.unitPrice * 100) / 100;

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <span className="text-gray-500 block text-[11px]">মূল চালান</span>
                        <span className="font-bold text-gray-900 font-mono text-sm">
                          {target.soldOrPurchasedQty} {target.unit}
                        </span>
                      </div>
                      <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-2">
                        <span className="text-amber-800 block text-[11px]">পূর্বের ফেরত</span>
                        <span className="font-bold text-amber-900 font-mono text-sm">
                          {target.previouslyReturnedQty} {target.unit}
                        </span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 col-span-2 sm:col-span-2">
                        <span className="text-emerald-800 block text-[11px] font-semibold">অবশিষ্ট ফেরতযোগ্য পরিমাণ</span>
                        <span className="font-bold text-emerald-900 font-mono text-sm">
                          {target.remainingReturnableQty} {target.unit}
                        </span>
                        {returnModal.type === 'PURCHASE' && (
                          <span className="block text-[10px] text-gray-500 mt-0.5 font-sans">
                            গুদাম মজুদ: {target.currentWarehouseStock} {target.unit}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Return Quantity Input */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs sm:text-[13px] font-semibold text-gray-700">
                          ফেরতের পরিমাণ ({target.unit}) <span className="text-red-500">*</span>
                        </label>
                        {target.remainingReturnableQty > 0 && (
                          <button
                            type="button"
                            onClick={() => setReturnQuantity(target.remainingReturnableQty.toString())}
                            className="text-xs text-amber-800 hover:text-amber-950 font-bold cursor-pointer underline py-1 px-1.5"
                          >
                            সম্পূর্ণ অবশিষ্ট ({target.remainingReturnableQty} {target.unit})
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        max={target.remainingReturnableQty}
                        required
                        id="input-return-quantity"
                        placeholder={`যেমন: ${target.remainingReturnableQty}`}
                        value={returnQuantity}
                        onChange={(e) => setReturnQuantity(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 font-mono min-h-[44px]"
                      />
                    </div>

                    {/* Refund Method */}
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                        রিফান্ড / সমন্বয় মাধ্যম <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="select-return-refund-method"
                        value={returnRefundMethod}
                        onChange={(e) => setReturnRefundMethod(e.target.value as ReturnRefundMethod)}
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                      >
                        <option value="ADJUST_DUE">বাকি সমন্বয় (চালানের বাকি কমবে / সমন্বয় হবে)</option>
                        <option value="CASH">
                          {returnModal.type === 'SALE' ? 'নগদ ফেরত (ক্যাশ থেকে ফেরত প্রদান)' : 'নগদ গ্রহণ (সরবরাহকারী নগদ ফেরত দিয়েছে)'}
                        </option>
                        <option value="BANK">
                          {returnModal.type === 'SALE' ? 'ব্যাংক / মোবাইল ব্যাংকিং ফেরত' : 'ব্যাংক হিসাব জমা'}
                        </option>
                      </select>
                    </div>

                    {/* Bank Account Selection if BANK */}
                    {returnRefundMethod === 'BANK' && (
                      <div>
                        <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                          ব্যাংক হিসাব নির্বাচন করুন <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="select-return-bank-account"
                          value={returnBankAccountId}
                          onChange={(e) => setReturnBankAccountId(e.target.value)}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                        >
                          <option value="">-- ব্যাংক হিসাব নির্বাচন করুন --</option>
                          {cashBankAccounts
                            .filter((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING')
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.bankName || b.accountName} ({b.accountNumber || b.accountType})
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {/* Cash Account Selection if CASH */}
                    {returnRefundMethod === 'CASH' && cashBankAccounts.filter((b) => b.accountType === 'CASH').length > 1 && (
                      <div>
                        <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                          ক্যাশ হিসাব নির্বাচন করুন
                        </label>
                        <select
                          id="select-return-cash-account"
                          value={returnCashBankAccountId}
                          onChange={(e) => setReturnCashBankAccountId(e.target.value)}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                        >
                          {cashBankAccounts
                            .filter((b) => b.accountType === 'CASH')
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.accountName} (ব্যালেন্স: {fmt(b.currentBalance)})
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {/* Reason */}
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                        ফেরতের কারণ (Reason for Return)
                      </label>
                      <input
                        type="text"
                        id="input-return-reason"
                        placeholder="যেমন: পণ্যের মান খারাপ / নষ্ট / ভুল সরবরাহ"
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                      />
                      <div className="flex flex-wrap gap-2 mt-2">
                        {['নষ্ট / গুণগত ত্রুটি', 'মেয়াদ উত্তীর্ণ', 'ভুল পণ্য সরবরাহ', 'অতিরিক্ত অর্ডার'].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setReturnReason(preset)}
                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg cursor-pointer transition-colors min-h-[36px] flex items-center justify-center font-medium"
                          >
                            + {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Return Date */}
                    <div>
                      <label className="block text-xs sm:text-[13px] font-semibold text-gray-700 mb-1.5">
                        ফেরতের তারিখ <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        id="input-return-date"
                        value={returnDate}
                        max={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setReturnDate(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm sm:text-[15px] text-gray-900 focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/20 min-h-[44px]"
                      />
                    </div>

                    {/* Calculation Summary Box */}
                    <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between">
                      <div className="text-xs text-amber-900">
                        <span className="font-semibold block text-[13px]">আনুমানিক সমন্বয়/রিফান্ড মোট:</span>
                        <span className="text-xs text-gray-600 font-mono">
                          {qty || 0} {target.unit} × {fmt(target.unitPrice)}
                        </span>
                      </div>
                      <div className="text-base sm:text-lg font-bold text-amber-900 font-mono">
                        {fmt(estimatedRefund)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  id="btn-cancel-return"
                  onClick={() => setReturnModal(null)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[44px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  id="btn-confirm-return"
                  disabled={
                    isSubmittingReturn ||
                    !returnQuantity ||
                    parseFloat(returnQuantity) <= 0 ||
                    (returnModal.items.find((it) => it.itemId === returnSelectedItemId)?.remainingReturnableQty || 0) <= 0
                  }
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-[13px] font-bold cursor-pointer min-h-[44px] shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>
                    {isSubmittingReturn
                      ? 'প্রক্রিয়াকরণ হচ্ছে...'
                      : returnModal.type === 'SALE'
                      ? 'বিক্রয় ফেরত নিশ্চিত করুন'
                      : 'ক্রয় ফেরত নিশ্চিত করুন'}
                  </span>
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
                className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs min-h-[40px]"
              >
                নিশ্চিত করুন (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: ADVANCE RECEIVED / PAID (Requirement 1) ===================== */}
      {showAdvanceModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    অগ্রিম গ্রহণ / প্রদান (Advance Received / Paid)
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    চালান তৈরির পূর্বেই অগ্রিম গ্রহণ বা পরিশোধ লিপিবদ্ধ করুন
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="btn-close-advance-modal"
                onClick={() => setShowAdvanceModal(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdvanceSubmit} className="space-y-3.5">
              {/* Party Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  পক্ষ (Party) নির্বাচন করুন <span className="text-red-500">*</span>
                </label>
                <select
                  id="select-advance-party"
                  required
                  value={advPartyId}
                  onChange={(e) => {
                    const pId = e.target.value;
                    setAdvPartyId(pId);
                    const selected = parties.find((p) => p.id === pId);
                    if (selected) {
                      setAdvDirection(selected.type === 'CUSTOMER' ? 'RECEIVED' : 'PAID');
                    }
                  }}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">-- পক্ষ (Party) নির্বাচন করুন --</option>
                  <optgroup label="গ্রাহকবৃন্দ (Customers)">
                    {parties
                      .filter((p) => p.type === 'CUSTOMER')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.phone ? `(${p.phone})` : ''} - ব্যালেন্স: ৳{fmt(p.balance)}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="সরবরাহকারীগণ (Suppliers)">
                    {parties
                      .filter((p) => p.type === 'SUPPLIER')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.phone ? `(${p.phone})` : ''} - ব্যালেন্স: ৳{fmt(p.balance)}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>

              {/* Advance Direction */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  অগ্রিমের ধরণ (Direction) <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    id="btn-adv-direction-received"
                    onClick={() => setAdvDirection('RECEIVED')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      advDirection === 'RECEIVED'
                        ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span>অগ্রিম গ্রহণ (Received)</span>
                  </button>
                  <button
                    type="button"
                    id="btn-adv-direction-paid"
                    onClick={() => setAdvDirection('PAID')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      advDirection === 'PAID'
                        ? 'bg-amber-700 text-white border-amber-700 shadow-2xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span>অগ্রিম প্রদান (Paid)</span>
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {advDirection === 'RECEIVED'
                    ? 'গ্রাহক থেকে অগ্রিম গ্রহণ (Liability: 2040 Customer Advance)'
                    : 'সরবরাহকারীকে অগ্রিম প্রদান (Asset: 1070 Supplier Advance)'}
                </p>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  অগ্রিমের পরিমাণ (৳) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  required
                  id="input-advance-amount"
                  placeholder="যেমন: 10000"
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base font-mono font-bold text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  অর্থের মাধ্যম <span className="text-red-500">*</span>
                </label>
                <select
                  id="select-advance-payment-method"
                  value={advPaymentMethod}
                  onChange={(e) => setAdvPaymentMethod(e.target.value as 'CASH' | 'BANK')}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                >
                  <option value="CASH">নগদ (Cash on Hand - 1010)</option>
                  <option value="BANK">ব্যাংক / মোবাইল ব্যাংকিং (Bank Account - 1030)</option>
                </select>
              </div>

              {/* Bank Account Selection if BANK */}
              {advPaymentMethod === 'BANK' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ব্যাংক হিসাব নির্বাচন করুন <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="select-advance-bank-account"
                    required
                    value={advBankAccountId}
                    onChange={(e) => setAdvBankAccountId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="">-- ব্যাংক হিসাব নির্বাচন করুন --</option>
                    {cashBankAccounts
                      .filter((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING')
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.accountNumber ? `(${b.accountNumber})` : ''} - ব্যালেন্স: ৳{fmt(b.currentBalance)}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  তারিখ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  id="input-advance-date"
                  value={advDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setAdvDate(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {/* Narration */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  মন্তব্য / নোট (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  id="input-advance-narration"
                  placeholder="যেমন: পরবর্তী চালানের জন্য অগ্রিম প্রাপ্তি/প্রদান"
                  value={advNarration}
                  onChange={(e) => setAdvNarration(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                />
              </div>

              {/* Accounting Preview */}
              {parseFloat(advAmount) > 0 && (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-1 text-xs font-mono">
                  <div className="font-sans font-semibold text-gray-600 text-[11px]">জাবেদা পূর্বরূপ (Double Entry):</div>
                  {advDirection === 'RECEIVED' ? (
                    <>
                      <div className="text-emerald-700">Dr {advPaymentMethod === 'CASH' ? 'নগদ তহবিল (1010 Cash)' : 'ব্যাংক হিসাব (1030 Bank)'}: ৳{fmt(parseFloat(advAmount))}</div>
                      <div className="text-sky-800 ml-4">Cr গ্রাহক অগ্রিম (2040 Customer Advance): ৳{fmt(parseFloat(advAmount))}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sky-800">Dr সরবরাহকারী অগ্রিম (1070 Supplier Advance): ৳{fmt(parseFloat(advAmount))}</div>
                      <div className="text-rose-700 ml-4">Cr {advPaymentMethod === 'CASH' ? 'নগদ তহবিল (1010 Cash)' : 'ব্যাংক হিসাব (1030 Bank)'}: ৳{fmt(parseFloat(advAmount))}</div>
                    </>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  id="btn-cancel-advance"
                  onClick={() => setShowAdvanceModal(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  id="btn-confirm-advance"
                  disabled={isSubmittingAdvance || !advPartyId || !advAmount || parseFloat(advAmount) <= 0}
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-xs font-bold cursor-pointer min-h-[40px] shadow-xs flex items-center gap-1.5"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>
                    {isSubmittingAdvance
                      ? 'সংরক্ষণ হচ্ছে...'
                      : advDirection === 'RECEIVED'
                      ? 'অগ্রিম গ্রহণ সংরক্ষণ করুন'
                      : 'অগ্রিম প্রদান সংরক্ষণ করুন'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {receiptModal && (() => {
        const isSale = receiptModal.type === 'SALE';
        const rec = receiptModal.record;
        const partyId = isSale ? (rec as Sale).customerId : (rec as Purchase).supplierId;
        const rawPartyName = isSale ? (rec as Sale).customerName : (rec as Purchase).supplierName;
        const party = parties.find(
          (p) =>
            p.id === partyId ||
            (p.name && rawPartyName && p.name.trim().toLowerCase() === rawPartyName.trim().toLowerCase())
        );
        const partyName = party?.name || rawPartyName || (isSale ? 'সাধারণ ক্রেতা (Walk-in Customer)' : 'সাধারণ সরবরাহকারী (Supplier)');
        const partyPhone = party?.phone || '';
        const partyAddress = party?.address || '';
        const displayNumber = rec.displayNumber || rec.invoiceNumber || rec.id.slice(0, 8);
        const dateStr = rec.date || new Date().toISOString().split('T')[0];

        const total = Number(rec.grandTotal || rec.totalAmount || 0);
        const paid = Number(rec.paidAmount || 0);
        const due = Number(rec.dueAmount !== undefined ? rec.dueAmount : Math.max(0, total - paid));
        const hasDue = due > 0;
        const recPayments = payments.filter((pmt) => pmt.parentId === rec.id);
        const transportCost = Number((rec as Purchase).transportCost || 0);

        const shareSummaryText = `The Goated Farm - ${isSale ? 'বিক্রয় চালান রশিদ' : 'ক্রয় ভাউচার রশিদ'} #${displayNumber}\nতারিখ: ${dateStr}\n${isSale ? 'ক্রেতা' : 'সরবরাহকারী'}: ${partyName}\nসর্বমোট: ৳${total.toLocaleString('en-IN')}\nপরিশোধিত: ৳${paid.toLocaleString('en-IN')}\nঅবশিষ্ট বাকি: ৳${due.toLocaleString('en-IN')}\n\nThe Goated Farm ERP থেকে প্রস্তুতকৃত`;

        const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-2xl w-full my-6 shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[92vh]">
              {/* Modal Top Bar */}
              <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs border border-white/15 shadow-inner">
                    <Receipt className="w-5 h-5 text-emerald-300" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <span>{isSale ? 'বিক্রয় চালান ও মানি রশিদ' : 'ক্রয় ভাউচার ও ব্যয় রশিদ'}</span>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white/20 text-emerald-100">
                        #{displayNumber}
                      </span>
                    </h3>
                    <p className="text-xs text-emerald-200/90 mt-0.5">
                      The Goated Farm • অফিসিয়াল ডিজিটাল চালানপত্র
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  id="btn-close-receipt-modal"
                  onClick={() => setReceiptModal(null)}
                  className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                  title="বন্ধ করুন"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Action Toolbar */}
              <div className="bg-emerald-50/70 border-b border-emerald-100 p-3 sm:px-5 flex items-center justify-between flex-wrap gap-2 shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Download PDF Button */}
                  <button
                    type="button"
                    id="btn-download-receipt-pdf"
                    onClick={() => handleDownloadReceiptPdf(receiptModal)}
                    disabled={isExportingPdf}
                    className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px] disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isExportingPdf ? 'প্রস্তুত হচ্ছে...' : 'Download PDF (ডাউনলোড)'}</span>
                  </button>

                  {/* Native Web Share API Button */}
                  {canShare && (
                    <button
                      type="button"
                      id="btn-native-share-receipt"
                      onClick={() => handleShareReceipt(receiptModal)}
                      disabled={isSharing}
                      className="px-3.5 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 active:scale-98 text-white text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px] disabled:opacity-50"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>{isSharing ? 'শেয়ার হচ্ছে...' : 'Share (শেয়ার)'}</span>
                    </button>
                  )}

                  {/* WhatsApp Direct Share Button */}
                  <button
                    type="button"
                    id="btn-whatsapp-share-receipt"
                    onClick={() => {
                      const waUrl = `https://wa.me/?text=${encodeURIComponent(shareSummaryText)}`;
                      window.open(waUrl, '_blank');
                    }}
                    className="px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 active:scale-98 text-white text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px]"
                    title="WhatsApp এ পাঠান"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>হোয়াটসঅ্যাপ</span>
                  </button>

                  {/* SMS Share Button */}
                  <button
                    type="button"
                    id="btn-sms-share-receipt"
                    onClick={() => {
                      window.location.href = `sms:?body=${encodeURIComponent(shareSummaryText)}`;
                    }}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white text-xs font-bold shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px]"
                    title="SMS পাঠান"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>এসএমএস</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Print Button */}
                  <button
                    type="button"
                    id="btn-print-receipt"
                    onClick={() => handlePrintReceipt(receiptModal)}
                    className="px-3 py-2 rounded-xl bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px]"
                    title="প্রিন্ট করুন"
                  >
                    <Printer className="w-4 h-4 text-gray-600" />
                    <span className="hidden sm:inline">প্রিন্ট</span>
                  </button>

                  {/* Copy Text Button */}
                  <button
                    type="button"
                    id="btn-copy-receipt-text"
                    onClick={() => handleCopyReceiptText(receiptModal)}
                    className="px-3 py-2 rounded-xl bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-xs font-bold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5 min-h-[38px]"
                    title="রশিদ বিবরণ কপি করুন"
                  >
                    {receiptCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-gray-600" />}
                    <span className="hidden sm:inline">{receiptCopied ? 'কপি হয়েছে' : 'কপি'}</span>
                  </button>
                </div>
              </div>

              {/* Scrollable Printable Receipt Card Preview */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-4 bg-gray-50/50">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 sm:p-6 space-y-5 text-gray-800">
                  {/* Farm & Header Banner */}
                  <div className="flex items-start justify-between border-b border-gray-200 pb-4 gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black tracking-tight text-emerald-900">THE GOATED FARM</span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold">
                          {isSale ? 'বিক্রয় রশিদ' : 'ক্রয় ভাউচার'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        সমন্বিত কৃষি, গবাদিপশু, মৎস্য ও শস্য খামার ইআরপি
                      </p>
                      <p className="text-[11px] text-gray-400">
                        পরিবেশবান্ধব ও বৈজ্ঞানিক খামার ব্যবস্থাপনা
                      </p>
                    </div>

                    <div className="text-right space-y-1 font-mono text-xs">
                      <div>
                        <span className="text-gray-500">চালান নম্বর: </span>
                        <span className="font-bold text-gray-900 text-sm">#{displayNumber}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">তারিখ: </span>
                        <span className="font-bold text-gray-800">{dateStr}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">পরিশোধ মাধ্যম: </span>
                        <span className="font-semibold text-gray-800 font-sans">{rec.paymentMethod}</span>
                      </div>
                      <div>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold font-sans ${
                          due <= 0
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : (paid > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-red-100 text-red-800 border border-red-300')
                        }`}>
                          {due <= 0 ? '✓ পরিশোধিত (PAID)' : (paid > 0 ? `⚠ আংশিক বাকি (৳${Number(due).toLocaleString('en-IN')})` : `⚠ বাকি (৳${Number(due).toLocaleString('en-IN')})`)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Party Information Box */}
                  <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                        {isSale ? 'ক্রেতার তথ্য (Billed To)' : 'সরবরাহকারীর তথ্য (Purchased From)'}
                      </div>
                      <div className="font-bold text-sm text-gray-900 mt-0.5">{partyName}</div>
                      {partyPhone && (
                        <div className="text-gray-600 mt-0.5 flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-gray-400" />
                          <span>{partyPhone}</span>
                        </div>
                      )}
                      {partyAddress && (
                        <div className="text-gray-500 mt-0.5 truncate max-w-xs">{partyAddress}</div>
                      )}
                    </div>

                    <div className="sm:text-right space-y-1">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">লেনদেন তথ্য</div>
                      <div className="text-gray-700">খাত: <span className="font-semibold">{isSale ? 'পণ্য বিক্রয়' : 'উপকরণ ক্রয়'}</span></div>
                      <div className="text-gray-500 font-mono text-[11px]">আইডি: {rec.id.slice(0, 16)}...</div>
                    </div>
                  </div>

                  {/* Line Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="bg-emerald-50 text-emerald-950 font-bold border-y border-emerald-200">
                          <th className="p-2.5 w-10 text-center">#</th>
                          <th className="p-2.5">পণ্যের বিবরণ (Item Description)</th>
                          <th className="p-2.5 text-right">পরিমাণ (Qty)</th>
                          <th className="p-2.5 text-right">একক দর (Rate)</th>
                          <th className="p-2.5 text-right">মোট মূল্য (Total)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rec.items && rec.items.map((item, idx) => {
                          const rate = Number(item.unitPrice || item.rate || 0);
                          const lineTotal = Number(item.lineTotal || item.total || (item.quantity || 1) * rate);
                          return (
                            <tr key={idx} className="hover:bg-gray-50/60">
                              <td className="p-2.5 text-center text-gray-500 font-mono">{idx + 1}</td>
                              <td className="p-2.5 font-semibold text-gray-900">
                                {item.itemName}
                              </td>
                              <td className="p-2.5 text-right text-gray-700 font-mono">
                                {item.quantity} {item.unit || ''}
                              </td>
                              <td className="p-2.5 text-right text-gray-700 font-mono">
                                ৳{rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="p-2.5 text-right font-bold text-gray-900 font-mono">
                                ৳{lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                        {transportCost > 0 && (
                          <tr className="bg-amber-50/50">
                            <td className="p-2.5 text-center text-gray-500 font-mono">{(rec.items?.length || 0) + 1}</td>
                            <td className="p-2.5 font-semibold text-amber-900">পরিবহন ও লোডিং খরচ (Transport Cost)</td>
                            <td className="p-2.5 text-right text-gray-700 font-mono">১ ট্রিপ</td>
                            <td className="p-2.5 text-right text-gray-700 font-mono">৳{transportCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            <td className="p-2.5 text-right font-bold text-amber-900 font-mono">৳{transportCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals and Installment Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start pt-2 border-t border-gray-200">
                    {/* Left: Installments & Verification */}
                    <div className="space-y-3">
                      {recPayments.length > 0 ? (
                        <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100 space-y-1.5">
                          <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-emerald-700" />
                            <span>পরিশোধের ইতিহাস ({recPayments.length}টি কিস্তি সম্পন্ন):</span>
                          </div>
                          <div className="space-y-1">
                            {recPayments.map((pmt) => (
                              <div key={pmt.id} className="flex items-center justify-between text-xs bg-white px-2.5 py-1 rounded-md border border-gray-100 font-mono">
                                <span className="text-gray-500">{pmt.date}</span>
                                <span className="font-bold text-emerald-800">৳{Number(pmt.amount).toLocaleString('en-IN')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-xl border border-gray-100">
                          {due <= 0 ? 'চালান ইস্যুর সাথে সাথেই সম্পূর্ণ মূল্য পরিশোধ সম্পন্ন হয়েছে।' : 'বাকি লেনদেন। কিস্তি পরিশোধের পর সাথে সাথে রশিদ হালনাগাদ হবে।'}
                        </div>
                      )}

                      {/* QR Code and System Verification */}
                      <div className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-xl border border-gray-200/80">
                        {modalQrUrl ? (
                          <img
                            src={modalQrUrl}
                            alt="Receipt Verification QR"
                            className="w-14 h-14 rounded-lg border border-gray-200 bg-white p-0.5 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 bg-gray-200 animate-pulse rounded-lg shrink-0" />
                        )}
                        <div className="text-[11px] text-gray-600">
                          <div className="font-bold text-emerald-900">ডিজিটাল সত্যতা যাচাই QR</div>
                          <div>স্মার্টফোন ক্যামেরা দিয়ে স্ক্যান করে চালানের ইলেকট্রনিক সত্যতা যাচাই করুন।</div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Financial Totals Box */}
                    <div className="bg-emerald-50/70 rounded-xl p-4 border border-emerald-200 space-y-2 text-xs">
                      <div className="flex justify-between text-gray-600">
                        <span>চালানের মোট মূল্য:</span>
                        <span className="font-mono font-bold text-gray-900">৳{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {transportCost > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>পরিবহন খরচ:</span>
                          <span className="font-mono text-gray-800">৳{transportCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="border-t border-emerald-200 pt-2 flex justify-between text-sm font-bold text-emerald-950">
                        <span>সর্বমোট টাকা (Grand Total):</span>
                        <span className="font-mono">৳{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-emerald-800 font-bold">
                        <span>পরিশোধিত টাকা (Paid Amount):</span>
                        <span className="font-mono">৳{paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className={`flex justify-between pt-1 border-t border-emerald-200 font-bold text-sm ${
                        due > 0 ? 'text-red-700' : 'text-emerald-800'
                      }`}>
                        <span>অবশিষ্ট বাকি (Due Amount):</span>
                        <span className="font-mono">৳{due.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>

                  {/* Signatures Area */}
                  <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs text-gray-500">
                    <div>
                      <div className="border-t border-dashed border-gray-400 pt-1.5 font-medium">
                        গ্রাহক / প্রাপকের স্বাক্ষর
                      </div>
                    </div>
                    <div>
                      <div className="border-t border-dashed border-gray-400 pt-1.5 font-medium">
                        খামার কর্তৃপক্ষ / ব্যবস্থাপকের স্বাক্ষর
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 sm:px-6 flex items-center justify-between flex-wrap gap-2 shrink-0">
                <span className="text-xs text-gray-500">
                  এক পাতার অফিসিয়াল ডিজিটাল রশিদ • jsPDF দ্বারা প্রস্তুতকৃত
                </span>
                <button
                  type="button"
                  id="btn-close-receipt-bottom"
                  onClick={() => setReceiptModal(null)}
                  className="px-4 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-bold transition-colors cursor-pointer min-h-[38px]"
                >
                  বন্ধ করুন (Close)
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
