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
  Copy
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { db } from '../db/indexedDb';
import { executePurchaseTransaction, executeSaleTransaction } from '../services/transactionService';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import { InventoryItem, Party, PaymentRecord, Purchase, Sale, UserRole, StockMovement, JournalLine, CashBankAccount } from '../types';
import { HIGH_AMOUNT_CONFIRMATION_THRESHOLD } from '../constants/validation';
import { notifyUndoableAction } from '../services/undoService';
import { triggerSuccessAnimation } from './ui/SuccessAnimation';
import { postJournalEntry, validateBalancedLines } from '../accounting/accountingEngine';
import { CANONICAL_ACCOUNTS, getInventoryAssetAccount, getInventoryAccountDetails } from '../accounting/accountMapping';
import { SearchableSelect, SearchableOption } from './ui';

declare module '../types' {
  interface PaymentRecord {
    paymentMethod?: 'CASH' | 'BANK';
    bankAccountId?: string;
    journalEntryId?: string;
  }
}

const getInventoryOpeningAssetAccount = (category?: string): { code: string; name: string } => {
  const details = getInventoryAccountDetails(category);
  return { code: details.code, name: details.nameBn };
};

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
          items: s.items || [],
          payments: invPayments
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
          items: p.items || [],
          payments: invPayments
        };
      });

    const combined = [...matchedSales, ...matchedPurchases];
    // Chronological order by date (ascending)
    return combined.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  }, [activeParty, sales, purchases, payments]);

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

  // New Sale Form
  const [showNewSale, setShowNewSale] = useState(false);
  const [saleDate, setSaleDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [saleCustomerId, setSaleCustomerId] = useState('');
  const [saleItemId, setSaleItemId] = useState('');
  const [saleQty, setSaleQty] = useState('1');
  const [saleUnitPrice, setSaleUnitPrice] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('');
  const [saleDiscountType, setSaleDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'BANK' | 'CREDIT'>('CASH');

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

  useEffect(() => {
    const handleDataChanged = () => {
      loadCommerceData();
    };
    window.addEventListener('goted_data_changed', handleDataChanged);
    return () => window.removeEventListener('goted_data_changed', handleDataChanged);
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
      const todayStr = new Date().toISOString().split('T')[0];

      let postedJournalEntryId: string | undefined = undefined;

      // When openingStock > 0 and unitCost > 0 (or buyPrice > 0):
      // - debit the appropriate inventory asset account (1051 FEED, 1052 SEED & FERTILIZER, 1053 RAW MATERIALS, 1054 WIP, 1055 FINISHED GOODS, or 1056 PACKAGING)
      // - credit 3050 (Retained Earnings / মালিকানা স্বত্ব ও প্রারম্ভিক মূলধন) as this is opening stock from prior periods, NOT a cash purchase today
      if (stockNum > 0 && totalOpeningValue > 0) {
        const invAccount = getInventoryOpeningAssetAccount(itemCategory);
        const accounts = await db.accounts.toArray();
        const existingInvAcc = accounts.find((a) => a.code === invAccount.code);
        const invAccountName = existingInvAcc ? existingInvAcc.nameBn : invAccount.name;

        const lines: JournalLine[] = [
          {
            accountId: invAccount.code,
            accountCode: invAccount.code,
            accountName: invAccountName,
            debit: totalOpeningValue,
            credit: 0,
            memo: `প্রারম্ভিক মজুদ: ${itemNameBn.trim()} (${stockNum} ${itemUnit.trim() || 'কেজি'} @ ৳${effectiveUnitCost})`
          },
          {
            accountId: '3050',
            accountCode: '3050',
            accountName: 'পুঞ্জীভূত লাভ/মুনাফা (Retained Earnings)',
            debit: 0,
            credit: totalOpeningValue,
            memo: 'প্রারম্ভিক মজুদ সমন্বয় (মালিকানা স্বত্ব / পূর্ববর্তী মেয়াদের উদ্বৃত্ত)'
          }
        ];

        const jEntry = await postJournalEntry(
          {
            id: generateUniqueId('j_inv_open'),
            voucherNumber: generateTransactionNumber('JV'),
            voucherType: 'JOURNAL',
            date: todayStr,
            narration: `প্রারম্ভিক মজুদ পণ্য দাখিলা: ${itemNameBn.trim()} (${stockNum} ${itemUnit.trim() || 'কেজি'} @ ৳${effectiveUnitCost})`,
            reference: 'OPENING_STOCK',
            lines,
            createdBy: currentUserId || 'system',
            createdAt: new Date().toISOString()
          },
          { accounts, skipDbPut: true }
        );

        await safeInsert(db.journalEntries, jEntry, { idPrefix: 'j' });
        postedJournalEntryId = jEntry.id;
      }

      const item: InventoryItem = {
        id: generateUniqueId('it'),
        code: itemCategory === 'FEED' ? generateTransactionNumber('FED') : generateTransactionNumber('ITM'),
        nameBn: itemNameBn.trim(),
        nameEn: itemNameBn.trim(),
        category: itemCategory,
        unit: itemUnit.trim() || 'কেজি',
        currentStock: stockNum,
        reorderLevel: reorderNum,
        avgCostPrice: costNum,
        sellingPrice: priceNum,
        lastRestockAmount: stockNum,
        lowStockThreshold: finalThreshold,
        journalEntryId: postedJournalEntryId,
        synced: false
      };
      await safeInsert(db.inventoryItems, item, { idPrefix: 'it' });

      // Create a StockMovement record of type 'OPENING' so the inventory sub-ledger matches the GL
      if (stockNum > 0) {
        const movement: StockMovement = {
          id: generateUniqueId('sm'),
          date: todayStr,
          itemId: item.id,
          movementType: 'OPENING',
          quantity: stockNum,
          unitCost: effectiveUnitCost,
          totalValue: totalOpeningValue,
          referenceId: postedJournalEntryId || item.id,
          notes: `প্রারম্ভিক মজুদ (Opening Stock): ${item.nameBn}`,
          synced: false
        };
        await safeInsert(db.stockMovements, movement, { idPrefix: 'sm' });
      }

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
    const item = items.find((i) => i.id === saleItemId);
    const customer = parties.find((p) => p.id === saleCustomerId);
    if (!item || !customer) return;

    const qty = parseFloat(saleQty) || 0;
    const price = parseFloat(saleUnitPrice) || item.sellingPrice || 0;
    const subtotal = Math.round(qty * price * 100) / 100;
    const discountAmount = Math.min(subtotal, Math.max(0, calcSaleDiscountAmount(subtotal, saleDiscount, saleDiscountType)));

    try {
      const res = await executeSaleTransaction({
        customer,
        item,
        quantity: qty,
        unitPrice: price,
        discount: discountAmount,
        paymentMethod: salePaymentMethod,
        currentUserId,
        date: saleDate
      });

      setShowNewSale(false);
      setSaleQty('1');
      setSaleUnitPrice('');
      setSaleDiscount('');
      setSaleDiscountType('FIXED');
      setSaleDate(new Date().toISOString().split('T')[0]);
      setMsg({
        type: 'success',
        text: `বিক্রয় চালান ${res.sale.displayNumber || res.sale.invoiceNumber} (৳${res.sale.totalAmount}) সফলভাবে সম্পন্ন এবং দ্বৈত-দাখিলায় পোস্ট হয়েছে!`
      });
      triggerSuccessAnimation('বিক্রয় চালান সফলভাবে তৈরি হয়েছে!', `চালান: ${res.sale.displayNumber || res.sale.invoiceNumber} (৳${res.sale.totalAmount.toLocaleString()})`);
      notifyUndoableAction({
        type: 'SALE',
        saleId: res.sale.id,
        journalEntryId: res.journalEntryId,
        itemId: item.id,
        quantity: qty,
        customerId: customer.id,
        totalAmount: res.sale.totalAmount,
        paymentMethod: salePaymentMethod,
        currentUserId
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

    const subtotal = Math.round(qty * price * 100) / 100;
    const discountAmount = Math.min(subtotal, Math.max(0, calcSaleDiscountAmount(subtotal, saleDiscount, saleDiscountType)));
    const totalAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    if (totalAmount <= 0) {
      setMsg({ type: 'error', text: 'মূল্যছাড়ের পর চালানের সর্বমোট মূল্য ০ এর বেশি হতে হবে।' });
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
    const item = items.find((i) => i.id === purchItemId);
    const supplier = parties.find((p) => p.id === purchSupplierId);
    if (!item || !supplier) return;

    const qty = parseFloat(purchQty) || 0;
    const price = parseFloat(purchUnitPrice) || item.avgCostPrice || 0;
    const transport = parseFloat(purchTransportCost) || 0;
    const itemsTotal = Math.round(qty * price * 100) / 100;
    const discountAmount = Math.min(itemsTotal + transport, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));

    try {
      const res = await executePurchaseTransaction({
        supplier,
        item,
        quantity: qty,
        unitPrice: price,
        transportCost: transport,
        discount: discountAmount,
        paymentMethod: purchPaymentMethod,
        currentUserId,
        date: purchDate
      });

      setShowNewPurchase(false);
      setPurchQty('1');
      setPurchUnitPrice('');
      setPurchTransportCost('0');
      setPurchDiscount('');
      setPurchDiscountType('FIXED');
      setPurchDate(new Date().toISOString().split('T')[0]);
      setMsg({
        type: 'success',
        text: `ক্রয় চালান ${res.purchase.displayNumber || res.purchase.invoiceNumber} (৳${res.purchase.grandTotal}) সফলভাবে সংরক্ষিত এবং স্টকে যুক্ত হয়েছে!`
      });
      triggerSuccessAnimation('ক্রয় চালান সফলভাবে সংরক্ষিত হয়েছে!', `চালান: ${res.purchase.displayNumber || res.purchase.invoiceNumber} (৳${res.purchase.grandTotal.toLocaleString()})`);
      notifyUndoableAction({
        type: 'PURCHASE',
        purchaseId: res.purchase.id,
        journalEntryId: res.journalEntryId,
        itemId: item.id,
        quantity: qty,
        supplierId: supplier.id,
        grandTotal: res.purchase.grandTotal,
        paymentMethod: purchPaymentMethod,
        currentUserId
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

    const itemsTotal = Math.round(qty * price * 100) / 100;
    const discountAmount = Math.min(itemsTotal + transport, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
    const grandTotal = Math.max(0, Math.round((itemsTotal + transport - discountAmount) * 100) / 100);

    if (grandTotal <= 0) {
      setMsg({ type: 'error', text: 'মূল্যছাড়ের পর চালানের সর্বমোট মূল্য ০ এর বেশি হতে হবে।' });
      return;
    }

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
    if (!paymentModal) return;

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

    const isSale = paymentModal.parentType === 'SALE';
    const cashBankAccountCode = method === 'BANK' ? CANONICAL_ACCOUNTS.BANK : CANONICAL_ACCOUNTS.CASH;
    const cashBankAccountName = method === 'BANK' ? 'ব্যাংক হিসাব (Bank Accounts)' : 'নগদ টাকা (Cash on Hand)';
    const arCode = CANONICAL_ACCOUNTS.ACCOUNTS_RECEIVABLE;
    const arName = 'গ্রাহকের নিকট পাওনা (Accounts Receivable)';
    const apCode = CANONICAL_ACCOUNTS.ACCOUNTS_PAYABLE;
    const apName = 'সরবরাহকারীর দেনা (Accounts Payable)';

    let journalLines: JournalLine[];

    if (isSale) {
      // SALE payment: require Cash/Bank source → Dr Cash/Bank, Cr Accounts Receivable
      journalLines = [
        {
          accountId: cashBankAccountCode,
          accountCode: cashBankAccountCode,
          accountName: cashBankAccountName,
          debit: amt,
          credit: 0,
          memo: `বিক্রয় চালান ${paymentModal.invoiceNumber}-এর কিস্তি গ্রহণ: ${paymentModal.partyName}`
        },
        {
          accountId: arCode,
          accountCode: arCode,
          accountName: arName,
          debit: 0,
          credit: amt,
          memo: `গ্রাহকের দেনা সমন্বয়: ${paymentModal.partyName} (চালান: ${paymentModal.invoiceNumber})`
        }
      ];
    } else {
      // PURCHASE payment: Dr Accounts Payable, Cr Cash/Bank
      journalLines = [
        {
          accountId: apCode,
          accountCode: apCode,
          accountName: apName,
          debit: amt,
          credit: 0,
          memo: `সরবরাহকারী দেনা পরিশোধ: ${paymentModal.partyName} (চালান: ${paymentModal.invoiceNumber})`
        },
        {
          accountId: cashBankAccountCode,
          accountCode: cashBankAccountCode,
          accountName: cashBankAccountName,
          debit: 0,
          credit: amt,
          memo: `ক্রয় চালান ${paymentModal.invoiceNumber}-এর কিস্তি পরিশোধ: ${paymentModal.partyName}`
        }
      ];
    }

    try {
      // Wrap PaymentRecord insert + Sale/Purchase update + journal posting in one atomic Dexie transaction
      await db.transaction(
        'rw',
        [
          db.payments,
          db.sales,
          db.purchases,
          db.journalEntries,
          db.accounts,
          db.closedPeriods,
          db.cashBankAccounts,
          db.parties
        ],
        async () => {
          // 1. Validate balanced lines using validateBalancedLines pattern
          const accounts = await db.accounts.toArray();
          const check = validateBalancedLines(journalLines, accounts);
          if (!check.isBalanced) {
            throw new Error(`জাবেদা ভারসাম্যহীন! মোট ডেবিট: ৳${check.totalDebit}, মোট ক্রেডিট: ৳${check.totalCredit}`);
          }

          // 2. Post journal entry using existing postJournalEntry pattern
          const voucherNumber = generateTransactionNumber(isSale ? 'RV' : 'PV');
          const journalEntry = await postJournalEntry(
            {
              id: generateUniqueId('j_pmt'),
              voucherNumber,
              voucherType: isSale ? 'RECEIPT' : 'PAYMENT',
              date: dateStr,
              narration: isSale
                ? `বিক্রয় চালান ${paymentModal.invoiceNumber}-এর কিস্তি আদায় (${paymentModal.partyName}) - ৳${amt}`
                : `ক্রয় চালান ${paymentModal.invoiceNumber}-এর কিস্তি পরিশোধ (${paymentModal.partyName}) - ৳${amt}`,
              reference: paymentModal.invoiceNumber,
              lines: journalLines,
              createdBy: currentUserId || 'system',
              createdAt: new Date().toISOString()
            },
            { accounts }
          );

          // 3. Save returned journalEntryId into PaymentRecord
          const paymentRecord: PaymentRecord = {
            id: generateUniqueId('pmt'),
            parentType: paymentModal.parentType,
            parentId: paymentModal.parentId,
            amount: amt,
            date: dateStr,
            note: paymentNote.trim() || undefined,
            paymentMethod: method,
            bankAccountId: paymentBankAccountId || undefined,
            journalEntryId: journalEntry.id,
            synced: false
          };

          await safeInsert(db.payments, paymentRecord, { idPrefix: 'pmt' });

          // 4. Update Sale or Purchase invoice
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

          // 5. Update operational Cash / Bank account balance consistently
          if (method === 'CASH') {
            const cashAcc = await db.cashBankAccounts.where('accountType').equals('CASH').first();
            if (cashAcc) {
              const newBal = isSale
                ? cashAcc.currentBalance + amt
                : cashAcc.currentBalance - amt;
              await db.cashBankAccounts.update(cashAcc.id, {
                currentBalance: Math.round(newBal * 100) / 100,
                synced: false
              });
            }
          } else if (method === 'BANK') {
            let bankAcc: CashBankAccount | undefined;
            if (paymentBankAccountId) {
              bankAcc = await db.cashBankAccounts.get(paymentBankAccountId);
            }
            if (!bankAcc) {
              bankAcc = await db.cashBankAccounts.where('accountType').equals('BANK').first();
            }
            if (bankAcc) {
              const newBal = isSale
                ? bankAcc.currentBalance + amt
                : bankAcc.currentBalance - amt;
              await db.cashBankAccounts.update(bankAcc.id, {
                currentBalance: Math.round(newBal * 100) / 100,
                synced: false
              });
            }
          }

          // 6. Update Customer AR / Supplier AP party balance
          if (paymentModal.parentType === 'SALE') {
            const saleRec = await db.sales.get(paymentModal.parentId);
            if (saleRec?.customerId) {
              const customerParty = await db.parties.get(saleRec.customerId);
              if (customerParty) {
                await db.parties.update(customerParty.id, {
                  balance: Math.round(((customerParty.balance || 0) - amt) * 100) / 100,
                  synced: false
                });
              }
            }
          } else {
            const purchRec = await db.purchases.get(paymentModal.parentId);
            if (purchRec?.supplierId) {
              const supplierParty = await db.parties.get(purchRec.supplierId);
              if (supplierParty) {
                await db.parties.update(supplierParty.id, {
                  balance: Math.round(((supplierParty.balance || 0) - amt) * 100) / 100,
                  synced: false
                });
              }
            }
          }
        }
      );

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
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

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
    <div className="space-y-4 pb-6 max-w-5xl mx-auto rounded-3xl p-2 sm:p-4 bg-gradient-to-b from-amber-500/[0.08] via-amber-500/[0.03] to-transparent dark:from-amber-950/30 dark:via-amber-950/10 dark:to-transparent">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-700" />
            <span>ক্রয়-বিক্রয়, মজুদ ও পক্ষসমূহ (Commerce & Inventory)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            ফিড, সার, ওষুধ মজুদ, ক্রয় চালান, বিক্রয় ও দেনাদার-পাওনাদার খতিয়ান
          </p>
        </div>

        <div className="w-full md:w-auto grid grid-cols-2 sm:grid-cols-4 gap-2 bg-amber-50/50 border border-amber-100 p-1.5 rounded-xl text-[13px] font-semibold">
          <button
            type="button"
            onClick={() => setTab('inventory')}
            className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg transition-all cursor-pointer min-h-[42px] text-center text-xs sm:text-[13px] font-bold ${
              tab === 'inventory'
                ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
                : 'bg-white text-amber-950 border border-amber-200/80 hover:bg-amber-100/80'
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
                ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
                : 'bg-white text-amber-950 border border-amber-200/80 hover:bg-amber-100/80'
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
                ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
                : 'bg-white text-amber-950 border border-amber-200/80 hover:bg-amber-100/80'
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
                ? 'bg-amber-700 text-white shadow-xs border border-amber-700'
                : 'bg-white text-amber-950 border border-amber-200/80 hover:bg-amber-100/80'
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
          {/* Stock Header Illustration */}
          <div
            className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
            }}
          >
            <img
              src="/illustrations/Nature-pana.svg"
              alt="Stock & Nature illustration"
              loading="lazy"
              className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
            />
          </div>

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
            <form onSubmit={handleAddItem} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3">
              <div className="font-bold text-amber-900 text-[15px]">নতুন আইটেম যোগ করুন</div>
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
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">একক (Unit: কেজি/ব্যাগ)</label>
                  <input
                    type="text"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    placeholder="কেজি / ব্যাগ / লিটার"
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    {['কেজি', 'ব্যাগ', 'লিটার', 'মণ'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setItemUnit(u)}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                          itemUnit === u ? 'bg-amber-700 text-white border-amber-700' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
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
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">সতর্কতার সীমা (Threshold)</label>
                  <input
                    type="number"
                    value={itemThreshold}
                    placeholder="ডিফল্ট: ২০%"
                    onChange={(e) => setItemThreshold(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                  <span className="text-[11px] text-gray-500">ডিফল্ট: ২০% রিস্টক</span>
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
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
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
                          {isLow ? (
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
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    ডিফল্ট: শেষ রিস্টকের ২০% ({editingThresholdItem.lastRestockAmount ? Math.round(editingThresholdItem.lastRestockAmount * 0.2) : Math.round(editingThresholdItem.currentStock * 0.2)} {editingThresholdItem.unit})
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingThresholdItem(null)}
                    className="px-3.5 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
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
                    className="px-4 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
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
          {/* Sales Invoices Header Illustration */}
          <div
            className="w-full h-40 sm:h-48 flex justify-center items-center overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)'
            }}
          >
            <img
              src="/illustrations/Farmers_market-cuate.svg"
              alt="Sales invoices illustration"
              loading="lazy"
              className="w-auto max-w-full h-full object-contain pointer-events-none drop-shadow-xs"
            />
          </div>

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
              <button
                onClick={() => setShowNewSale(!showNewSale)}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন বিক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewSale && (
            <form onSubmit={handleCreateSale} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3">
              <div className="font-bold text-amber-900 text-[15px]">নতুন বিক্রয় চালান তৈরি করুন</div>
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
                  <SearchableSelect
                    options={customerOptions}
                    value={saleCustomerId}
                    onChange={(val) => setSaleCustomerId(val)}
                    placeholder="-- ক্রেতা সন্ধান বা নির্বাচন --"
                    allowClear
                  />
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মূল্যছাড় / Discount (ঐচ্ছিক)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="ছাড়"
                      value={saleDiscount}
                      onChange={(e) => setSaleDiscount(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                    />
                    <select
                      value={saleDiscountType}
                      onChange={(e) => setSaleDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                      className="bg-white border border-gray-300 rounded-lg px-2 text-[13px] font-medium text-gray-700 shrink-0"
                    >
                      <option value="FIXED">৳ (টাকা)</option>
                      <option value="PERCENT">% (শতাংশ)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Dynamic Sale Preview Summary */}
              {(() => {
                const sQty = parseFloat(saleQty) || 0;
                const sPrice = parseFloat(saleUnitPrice) || 0;
                const sub = Math.round(sQty * sPrice * 100) / 100;
                const disc = Math.min(sub, Math.max(0, calcSaleDiscountAmount(sub, saleDiscount, saleDiscountType)));
                const net = Math.max(0, Math.round((sub - disc) * 100) / 100);
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="text-gray-700">উপমোট: <strong className="text-gray-900 font-mono">৳{sub.toLocaleString('en-IN')}</strong></span>
                    {disc > 0 && (
                      <span className="text-rose-700">ছাড় ({saleDiscountType === 'PERCENT' ? `${saleDiscount}%` : 'নির্দিষ্ট'}): <strong className="font-mono">-৳{disc.toLocaleString('en-IN')}</strong></span>
                    )}
                    <span className="text-amber-900 font-semibold">চালানের নেট মোট: <strong className="text-amber-950 font-mono text-[14px]">৳{net.toLocaleString('en-IN')}</strong></span>
                  </div>
                );
              })()}

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
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
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
                          <td className="p-3 font-bold text-amber-800 font-mono">{s.displayNumber || s.invoiceNumber}</td>
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
                            <div className="text-amber-800 font-bold">{fmt(total)}</div>
                            {Boolean(s.discount && s.discount > 0) && (
                              <div className="text-[11px] text-rose-600 font-sans font-medium">
                                ছাড়: ৳{fmt(s.discount)}
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
                                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                                : (paid > 0 ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200')
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
              <button
                onClick={() => setShowNewPurchase(!showNewPurchase)}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন ক্রয় চালান</span>
              </button>
            )}
          </div>

          {showNewPurchase && (
            <form onSubmit={handleCreatePurchase} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3">
              <div className="font-bold text-amber-900 text-[15px]">নতুন ক্রয় চালান লিপিবদ্ধ করুন</div>
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
                  <SearchableSelect
                    options={supplierOptions}
                    value={purchSupplierId}
                    onChange={(val) => setPurchSupplierId(val)}
                    placeholder="-- সরবরাহকারী সন্ধান বা নির্বাচন --"
                    allowClear
                  />
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
                        {it.nameBn} ({getInventoryAssetAccount(it.category)})
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

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
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
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">মূল্যছাড় / Discount (ঐচ্ছিক)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="ছাড়"
                      value={purchDiscount}
                      onChange={(e) => setPurchDiscount(e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                    />
                    <select
                      value={purchDiscountType}
                      onChange={(e) => setPurchDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                      className="bg-white border border-gray-300 rounded-lg px-2 text-[13px] font-medium text-gray-700 shrink-0"
                    >
                      <option value="FIXED">৳ (টাকা)</option>
                      <option value="PERCENT">% (শতাংশ)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Dynamic Purchase Preview Summary */}
              {(() => {
                const pQty = parseFloat(purchQty) || 0;
                const pPrice = parseFloat(purchUnitPrice) || 0;
                const pTrans = parseFloat(purchTransportCost) || 0;
                const itemsTotal = Math.round(pQty * pPrice * 100) / 100;
                const disc = Math.min(itemsTotal + pTrans, Math.max(0, calcPurchDiscountAmount(itemsTotal, purchDiscount, purchDiscountType)));
                const grand = Math.max(0, Math.round((itemsTotal + pTrans - disc) * 100) / 100);
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="text-gray-700">পণ্যের মোট: <strong className="text-gray-900 font-mono">৳{itemsTotal.toLocaleString('en-IN')}</strong></span>
                    {pTrans > 0 && (
                      <span className="text-amber-800">পরিবহন: <strong className="font-mono">+৳{pTrans.toLocaleString('en-IN')}</strong></span>
                    )}
                    {disc > 0 && (
                      <span className="text-rose-700">ছাড় ({purchDiscountType === 'PERCENT' ? `${purchDiscount}%` : 'নির্দিষ্ট'}): <strong className="font-mono">-৳{disc.toLocaleString('en-IN')}</strong></span>
                    )}
                    <span className="text-amber-900 font-semibold">ক্রয়ের নেট সর্বমোট: <strong className="text-amber-950 font-mono text-[14px]">৳{grand.toLocaleString('en-IN')}</strong></span>
                  </div>
                );
              })()}

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
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
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
                          <td className="p-3 font-bold text-sky-700 font-mono">{p.displayNumber || p.invoiceNumber}</td>
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
                            {Boolean(p.discount && p.discount > 0) && (
                              <div className="text-[11px] text-emerald-700 font-sans font-medium">
                                ছাড়: ৳{fmt(p.discount)}
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
                                ? 'bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]'
                                : (paid > 0 ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-amber-50 text-amber-800 border border-amber-200')
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

              <div className="text-xs text-gray-500">
                পক্ষ কোড: <span className="font-mono text-gray-700 font-semibold">{activeParty?.id}</span>
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

                {/* Summary Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 text-center">
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
                  <div className="bg-white/90 backdrop-blur-xs p-2.5 sm:p-3 rounded-xl border border-amber-100 shadow-2xs col-span-2 sm:col-span-1">
                    <div className="text-[11px] sm:text-xs text-gray-500 font-semibold">মোট পরিশোধিত</div>
                    <div className="text-base sm:text-lg font-bold text-emerald-700 font-mono mt-0.5">
                      ৳{fmt(partySummary.totalPaid)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

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
                <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
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
                                ৳{fmt(inv.totalAmount)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                                ৳{fmt(inv.paidAmount)}
                              </td>
                              <td className="p-3 text-right font-mono font-bold whitespace-nowrap">
                                <span className={inv.dueAmount > 0 ? 'text-red-700 font-extrabold' : 'text-gray-500'}>
                                  ৳{fmt(inv.dueAmount)}
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
              )}
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
                <button
                  onClick={() => setShowAddParty(!showAddParty)}
                  className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ নতুন ব্যক্তি/প্রতিষ্ঠান</span>
                </button>
              )}
            </div>

            {showAddParty && (
              <form onSubmit={handleAddParty} className="p-4 bg-amber-50/40 border border-amber-200 rounded-xl space-y-3">
                <div className="font-bold text-amber-900 text-[15px]">নতুন পক্ষ (Party) নিবন্ধন</div>
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
                    className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  পরিশোধের মাধ্যম (উৎস) <span className="text-red-500">*</span>
                </label>
                <select
                  id="select-installment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK')}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
                >
                  <option value="CASH">নগদ (Cash on Hand - 1010)</option>
                  <option value="BANK">ব্যাংক স্থানান্তর (Bank Account - 1030)</option>
                </select>
              </div>

              {paymentMethod === 'BANK' && cashBankAccounts.filter((b) => b.accountType === 'BANK' || b.accountType === 'MOBILE_BANKING').length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ব্যাংক হিসাব নির্বাচন করুন
                  </label>
                  <select
                    id="select-installment-bank-account"
                    value={paymentBankAccountId}
                    onChange={(e) => setPaymentBankAccountId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
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
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
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
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
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
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-base text-gray-900 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
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
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold cursor-pointer min-h-[40px] shadow-xs"
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
                className="px-5 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold transition-all cursor-pointer shadow-xs min-h-[40px]"
              >
                নিশ্চিত করুন (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== RECEIPT MODAL (VIEW / DOWNLOAD / SHARE) ===================== */}
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
