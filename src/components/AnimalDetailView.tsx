import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Edit3,
  Scale,
  Droplets,
  Wheat,
  Syringe,
  Stethoscope,
  Activity,
  Heart,
  AlertTriangle,
  Calendar,
  DollarSign,
  Tag,
  PlusCircle,
  Clock,
  FileText,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  QrCode,
  Download,
  FileDown
} from 'lucide-react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { db } from '../db/indexedDb';
import { Animal, AnimalEvent, UserRole, Reminder } from '../types';
import { IconTile } from './ui/IconTile';
import { Card } from './ui/Card';
import { StatusBadge } from './ui/StatusBadge';
import { EmptyState } from './ui/EmptyState';

interface AnimalDetailViewProps {
  animal: Animal;
  events: AnimalEvent[];
  onBack: () => void;
  onAddEvent: (animal: Animal) => void;
  onUpdateStatus: (animal: Animal) => void;
  onEditAnimal?: (animal: Animal) => void;
  role: UserRole;
}

const fmt = (num: number): string => `৳${Math.round(num).toLocaleString('en-IN')}`;

/**
 * Loads an image URL into a base64 data URL for embedding into jsPDF
 */
async function loadImgDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) return url;
  try {
    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      const timer = setTimeout(() => resolve(null), 3500);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 300;
          canvas.height = img.naturalHeight || img.height || 300;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}

/**
 * Sanitizes and transliterates text to ensure 100% crisp, uncorrupted ASCII in jsPDF
 */
function cleanPdfText(text: any, fallback = '-'): string {
  if (text === undefined || text === null) return fallback;
  const str = String(text).trim();
  if (!str) return fallback;

  const translationMap: Record<string, string> = {
    'ছাগল': 'Goat',
    'গাভী': 'Cow',
    'গরু': 'Cattle',
    'ভেড়া': 'Sheep',
    'মহিষ': 'Buffalo',
    'স্ত্রী': 'Female',
    'পুরুষ': 'Male',
    'সক্রিয়': 'Active',
    'অসুস্থ': 'Sick',
    'বিক্রি': 'Sold',
    'মৃত': 'Deceased',
    'কোয়ারেন্টাইন': 'Quarantine',
    'খাদ্য': 'Feed',
    'টিকা': 'Vaccine',
    'চিকিৎসা': 'Treatment',
    'ওজন': 'Weight',
    'দুধ': 'Milk',
    'প্রজনন': 'Breeding',
    'হ্যাঁ': 'Yes',
    'না': 'No'
  };

  let cleaned = str;
  for (const [bn, en] of Object.entries(translationMap)) {
    cleaned = cleaned.split(bn).join(en);
  }

  // Strip characters outside printable ASCII (\x20 to \x7E) to avoid font encoding errors
  const safeStr = cleaned.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  return safeStr || fallback;
}

export const AnimalDetailView: React.FC<AnimalDetailViewProps> = ({
  animal,
  events,
  onBack,
  onAddEvent,
  onUpdateStatus,
  onEditAnimal,
  role
}) => {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [reminders, setReminders] = useState<Reminder[]>([]);

  useEffect(() => {
    let isMounted = true;
    db.reminders.toArray().then((all) => {
      if (isMounted) {
        setReminders(all.filter((r) => r.animalId === animal.id || r.animalId === animal.tag));
      }
    }).catch(console.error);
    return () => {
      isMounted = false;
    };
  }, [animal.id, animal.tag]);

  const vaccineStatus = useMemo<'overdue' | 'due-soon' | null>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    const pending = reminders.filter(
      (r) =>
        r.status === 'PENDING' &&
        (r.category === 'VACCINE' || r.category === 'TREATMENT' || r.title.toLowerCase().includes('vaccin') || r.title.includes('টিকা'))
    );

    const overdue = pending.find((r) => new Date(r.dueDate).getTime() < todayTime);
    if (overdue) return 'overdue';

    const dueSoon = pending.find((r) => {
      const diffDays = Math.ceil((new Date(r.dueDate).getTime() - todayTime) / 86400000);
      return diffDays >= 0 && diffDays <= 7;
    });
    if (dueSoon) return 'due-soon';

    return null;
  }, [reminders]);

  useEffect(() => {
    if (animal.id) {
      QRCode.toDataURL(animal.id, {
        width: 256,
        margin: 1,
        color: {
          dark: '#1E5128',
          light: '#FFFFFF'
        }
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch((err) => console.error('Error generating QR code:', err));
    }
  }, [animal.id]);

  const handleDownloadQr = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!qrCodeDataUrl) return;
    const link = document.createElement('a');
    link.href = qrCodeDataUrl;
    link.download = `QR-${animal.id}.png`;
    link.click();
  };

  // 1. Filter events for this animal and sort reverse-chronological
  const animalEvents = useMemo(() => {
    return [...events]
      .filter((e) => e.animalId === animal.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [events, animal.id]);

  // 2. Weight events sorted chronologically for the line chart
  const weightChartData = useMemo(() => {
    const weightEvents = animalEvents
      .filter((e) => e.eventType === 'WEIGHT' && e.weightKg !== undefined && e.weightKg > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // If animal has birth or purchase date and known weight, and weightEvents is small, we can include points
    const dataPoints = weightEvents.map((e) => ({
      date: e.date,
      weightKg: e.weightKg,
      notes: e.details || ''
    }));

    // If no weight events yet, show at least current weight
    if (dataPoints.length === 0 && animal.currentWeightKg > 0) {
      return [
        {
          date: animal.purchaseDate || 'বর্তমান',
          weightKg: animal.currentWeightKg,
          notes: 'প্রাথমিক / বর্তমান ওজন'
        }
      ];
    }

    return dataPoints;
  }, [animalEvents, animal.currentWeightKg, animal.purchaseDate]);

  // 3. Milk events & total this month
  const milkEvents = useMemo(() => {
    return animalEvents.filter((e) => e.eventType === 'MILK' && e.milkLiters !== undefined);
  }, [animalEvents]);

  const { totalMilkThisMonth, totalMilkAllTime } = useMemo(() => {
    const currentYearMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    let monthSum = 0;
    let allSum = 0;

    for (const ev of milkEvents) {
      const liters = Number(ev.milkLiters) || 0;
      allSum += liters;
      if (ev.date && ev.date.startsWith(currentYearMonth)) {
        monthSum += liters;
      }
    }

    return {
      totalMilkThisMonth: Math.round(monthSum * 10) / 10,
      totalMilkAllTime: Math.round(allSum * 10) / 10
    };
  }, [milkEvents]);

  // 4. Trackable milk-related sales linked to this animal
  const [milkSalesRevenue, setMilkSalesRevenue] = useState<number>(0);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const allSales = await db.sales.toArray();
        let linkedRevenue = 0;
        for (const s of allSales) {
          if (
            s.category === 'MILK' ||
            s.items?.some((it) => it.itemName?.toLowerCase().includes('milk') || it.itemName?.includes('দুধ'))
          ) {
            const isTied =
              s.items?.some(
                (it) =>
                  it.itemName?.includes(animal.id) ||
                  (animal.tag && it.itemName?.includes(animal.tag))
              ) || s.invoiceNumber?.includes(animal.id);
            if (isTied) {
              linkedRevenue += s.grandTotal || s.totalAmount || 0;
            }
          }
        }
        if (isMounted) setMilkSalesRevenue(linkedRevenue);
      } catch (e) {
        console.error('Failed to load linked sales:', e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [animal.id, animal.tag]);

  // 5. Total cost so far (purchaseCost + accumulatedFeedCost + accumulatedMedCost + accumulatedLabourCost + otherCosts)
  const totalCost = useMemo(() => {
    return (
      (Number(animal.purchaseCost) || 0) +
      (Number(animal.accumulatedFeedCost) || 0) +
      (Number(animal.accumulatedMedCost) || 0) +
      (Number(animal.accumulatedLabourCost) || 0) +
      (Number(animal.otherCosts) || 0)
    );
  }, [
    animal.purchaseCost,
    animal.accumulatedFeedCost,
    animal.accumulatedMedCost,
    animal.accumulatedLabourCost,
    animal.otherCosts
  ]);

  // 6. Total revenue so far (salePrice if sold, plus sum of any MILK-related sales linked to this animal)
  const totalRevenue = useMemo(() => {
    const saleRev = animal.status === 'SOLD' ? Number(animal.salePrice) || 0 : 0;
    return saleRev + milkSalesRevenue;
  }, [animal.status, animal.salePrice, milkSalesRevenue]);

  // 7. Net profit/loss = revenue − cost
  const netProfitLoss = useMemo(() => {
    return totalRevenue - totalCost;
  }, [totalRevenue, totalCost]);

  // 8. Days since purchaseDate and cost-per-day-held (totalCost ÷ days since purchaseDate)
  const daysSincePurchase = useMemo(() => {
    if (!animal.purchaseDate) return 1;
    const pTime = new Date(animal.purchaseDate).getTime();
    if (isNaN(pTime)) return 1;
    const nowTime =
      animal.status === 'SOLD' && animal.saleDate
        ? new Date(animal.saleDate).getTime()
        : Date.now();
    const diff = Math.floor((nowTime - pTime) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
  }, [animal.purchaseDate, animal.status, animal.saleDate]);

  const costPerDayHeld = useMemo(() => {
    return daysSincePurchase > 0 ? totalCost / daysSincePurchase : totalCost;
  }, [totalCost, daysSincePurchase]);

  // Event icon & styling helper
  const getEventBadge = (type: AnimalEvent['eventType']) => {
    switch (type) {
      case 'FEED':
        return {
          icon: <Wheat className="w-4 h-4 text-amber-700" />,
          bg: 'bg-amber-100 border-amber-300 text-amber-900',
          label: 'খাদ্য (Feed)'
        };
      case 'VACCINE':
        return {
          icon: <Syringe className="w-4 h-4 text-blue-700" />,
          bg: 'bg-blue-100 border-blue-300 text-blue-900',
          label: 'টিকা (Vaccine)'
        };
      case 'TREATMENT':
        return {
          icon: <Stethoscope className="w-4 h-4 text-purple-700" />,
          bg: 'bg-purple-100 border-purple-300 text-purple-900',
          label: 'চিকিৎসা (Treatment)'
        };
      case 'WEIGHT':
        return {
          icon: <Scale className="w-4 h-4 text-emerald-700" />,
          bg: 'bg-emerald-100 border-emerald-300 text-emerald-900',
          label: 'ওজন পরিমাপ (Weight)'
        };
      case 'MILK':
        return {
          icon: <Droplets className="w-4 h-4 text-cyan-700" />,
          bg: 'bg-cyan-100 border-cyan-300 text-cyan-900',
          label: 'দুধ উৎপাদন (Milk)'
        };
      case 'BREEDING':
        return {
          icon: <Heart className="w-4 h-4 text-rose-700" />,
          bg: 'bg-rose-100 border-rose-300 text-rose-900',
          label: 'প্রজনন (Breeding)'
        };
      case 'MORTALITY':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-red-700" />,
          bg: 'bg-red-100 border-red-300 text-red-900',
          label: 'মৃত্যু (Mortality)'
        };
      default:
        return {
          icon: <Activity className="w-4 h-4 text-gray-700" />,
          bg: 'bg-gray-100 border-gray-300 text-gray-900',
          label: type
        };
    }
  };

  // State for generating and downloading 1-page PDF
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // 1. Top Header Banner
      doc.setFillColor(30, 81, 40);
      doc.rect(0, 0, 210, 20, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('THE GOATED FARM - ANIMAL HEALTH & SALES PASSPORT', 12, 9.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(220, 235, 220);
      doc.text('Complete Animal Dossier, Medical Timeline & Investment Summary', 12, 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`TAG: ${cleanPdfText(animal.tag || animal.id)}`, 198, 9.5, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(220, 235, 220);
      const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      doc.text(`Date: ${dateStr}`, 198, 15, { align: 'right' });

      // 2. Identity Card Box (x=12, y=23, w=186, h=44)
      doc.setDrawColor(210, 225, 210);
      doc.setFillColor(252, 254, 252);
      doc.roundedRect(12, 23, 186, 44, 2, 2, 'FD');

      // Animal Photo
      let photoBase64: string | null = null;
      if (animal.photoUrl) {
        photoBase64 = await loadImgDataUrl(animal.photoUrl);
      }
      if (photoBase64) {
        try {
          doc.addImage(photoBase64, 'JPEG', 15, 25, 34, 40);
          doc.setDrawColor(180, 205, 180);
          doc.rect(15, 25, 34, 40, 'S');
        } catch (err) {
          console.warn('Could not add photo to PDF:', err);
        }
      } else {
        doc.setFillColor(240, 244, 240);
        doc.rect(15, 25, 34, 40, 'F');
        doc.setDrawColor(210, 220, 210);
        doc.rect(15, 25, 34, 40, 'S');
        doc.setTextColor(140, 150, 140);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('NO PHOTO', 32, 43, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text('RECORDED', 32, 47, { align: 'center' });
      }

      // QR Code
      let qrBase64 = qrCodeDataUrl;
      if (!qrBase64 && animal.id) {
        qrBase64 = await QRCode.toDataURL(animal.id, { margin: 1 });
      }
      if (qrBase64) {
        try {
          doc.addImage(qrBase64, 'PNG', 53, 25, 30, 30);
          doc.setDrawColor(200, 215, 200);
          doc.rect(53, 25, 30, 30, 'S');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6);
          doc.setTextColor(100, 120, 100);
          doc.text('SCAN FOR RECORD', 68, 58, { align: 'center' });
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.setTextColor(30, 81, 40);
          doc.text(cleanPdfText(animal.id), 68, 62, { align: 'center' });
        } catch (err) {
          console.warn('Could not add QR to PDF:', err);
        }
      }

      // Basic Info Columns
      doc.setTextColor(30, 40, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(
        `${cleanPdfText(animal.id)} ${animal.tag ? `(Tag: ${cleanPdfText(animal.tag)})` : ''}`,
        88,
        29
      );

      doc.setFontSize(7.5);
      const col1X = 88;
      const col2X = 142;
      let curY = 35;

      const printInfoRow = (l1: string, v1: string, l2: string, v2: string) => {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 110, 100);
        doc.text(l1, col1X, curY);
        doc.text(l2, col2X, curY);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 35, 30);
        doc.text(v1, col1X + 22, curY);
        doc.text(v2, col2X + 22, curY);
        curY += 5;
      };

      printInfoRow('Species:', cleanPdfText(animal.species, 'GOAT'), 'Breed:', cleanPdfText(animal.breed, 'N/A'));
      printInfoRow('Gender:', cleanPdfText(animal.gender, 'FEMALE'), 'Status:', cleanPdfText(animal.status, 'ACTIVE'));
      printInfoRow('Weight:', `${animal.currentWeightKg || 0} kg`, 'Birth Date:', cleanPdfText(animal.birthDate, 'Unknown'));
      printInfoRow('Purchase Date:', cleanPdfText(animal.purchaseDate, 'N/A'), 'Days on Farm:', `${daysSincePurchase} days`);
      printInfoRow('Purchase Price:', `BDT ${(animal.purchaseCost || 0).toLocaleString()}`, 'Sale Status:', animal.status === 'SOLD' ? `Sold for BDT ${(animal.salePrice || 0).toLocaleString()}` : 'In Farm');

      // 3. Profitability & Financial Summary (x=12, y=69, w=186, h=43)
      doc.setDrawColor(200, 215, 200);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(12, 69, 186, 43, 2, 2, 'FD');

      doc.setFillColor(235, 243, 235);
      doc.rect(12, 69, 186, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 81, 40);
      doc.text('CURRENT PROFITABILITY & INVESTMENT SUMMARY', 15, 73.5);

      let finY = 80;
      const finCol1 = 15;
      const finCol2 = 64;
      const finCol3 = 110;
      const finCol4 = 194;

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 85, 80);
      doc.setFontSize(7.5);

      // Row 1
      doc.text('Initial Purchase Cost:', finCol1, finY);
      doc.setFont('helvetica', 'bold');
      doc.text(`BDT ${(animal.purchaseCost || 0).toLocaleString()}`, finCol2, finY, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.text('Holding Cost / Day:', finCol3, finY);
      doc.setFont('helvetica', 'bold');
      doc.text(`BDT ${Math.round(costPerDayHeld).toLocaleString()} / day`, finCol4, finY, { align: 'right' });
      finY += 4.5;

      // Row 2
      doc.setFont('helvetica', 'normal');
      doc.text('Accumulated Feed Cost:', finCol1, finY);
      doc.setFont('helvetica', 'bold');
      doc.text(`BDT ${(animal.accumulatedFeedCost || 0).toLocaleString()}`, finCol2, finY, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.text('Milk Sales Revenue:', finCol3, finY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 100, 50);
      doc.text(`BDT ${Math.round(milkSalesRevenue).toLocaleString()}`, finCol4, finY, { align: 'right' });
      finY += 4.5;

      // Row 3
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 85, 80);
      doc.text('Medical & Vaccine Cost:', finCol1, finY);
      doc.setFont('helvetica', 'bold');
      doc.text(`BDT ${(animal.accumulatedMedCost || 0).toLocaleString()}`, finCol2, finY, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.text('Sale Revenue (if sold):', finCol3, finY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 100, 50);
      doc.text(`BDT ${(animal.salePrice || 0).toLocaleString()}`, finCol4, finY, { align: 'right' });
      finY += 4.5;

      // Row 4
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 85, 80);
      doc.text('Labour & Other Operational Costs:', finCol1, finY);
      doc.setFont('helvetica', 'bold');
      doc.text(`BDT ${((animal.accumulatedLabourCost || 0) + (animal.otherCosts || 0)).toLocaleString()}`, finCol2, finY, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.text('Total Revenue Generated:', finCol3, finY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 100, 50);
      doc.text(`BDT ${Math.round(totalRevenue).toLocaleString()}`, finCol4, finY, { align: 'right' });
      finY += 5.5;

      doc.setDrawColor(220, 230, 220);
      doc.line(15, finY - 2, 195, finY - 2);

      // Row 5 (Totals)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 40, 30);
      doc.text('TOTAL INVESTED COST:', finCol1, finY + 1.5);
      doc.setTextColor(140, 30, 30);
      doc.text(`BDT ${Math.round(totalCost).toLocaleString()}`, finCol2, finY + 1.5, { align: 'right' });

      doc.setTextColor(30, 40, 30);
      doc.text('NET PROFIT / DEFICIT:', finCol3, finY + 1.5);
      const isProfitable = netProfitLoss >= 0;
      doc.setTextColor(isProfitable ? 30 : 180, isProfitable ? 110 : 30, 30);
      doc.text(
        `${isProfitable ? '+' : ''}BDT ${Math.round(netProfitLoss).toLocaleString()} (${isProfitable ? 'PROFIT' : 'NET DEFICIT'})`,
        finCol4,
        finY + 1.5,
        { align: 'right' }
      );

      // 4. Middle Section: Vaccines Timeline + Weight History (y=114, height=78)
      const midY = 114;
      const colW = 91;
      const leftColX = 12;
      const rightColX = 107;
      const midHeight = 78;

      // Left Column: VACCINATIONS & HEALTHCARE LOG
      doc.setDrawColor(200, 215, 200);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(leftColX, midY, colW, midHeight, 2, 2, 'FD');
      doc.setFillColor(235, 243, 235);
      doc.rect(leftColX, midY, colW, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 81, 40);
      doc.text('VACCINES & MEDICAL HEALTH TIMELINE', leftColX + 3, midY + 4.5);

      let vY = midY + 10;
      doc.setFontSize(6.8);
      doc.setTextColor(100, 110, 100);
      doc.text('DATE', leftColX + 3, vY);
      doc.text('EVENT / VACCINE', leftColX + 22, vY);
      doc.text('DETAILS / BATCH', leftColX + 54, vY);
      doc.setDrawColor(220, 230, 220);
      doc.line(leftColX + 2, vY + 1.5, leftColX + colW - 2, vY + 1.5);

      const vaccineAndHealthEvents = animalEvents
        .filter((e) => e.eventType === 'VACCINE' || e.eventType === 'TREATMENT')
        .slice(0, 10);

      vY += 4.5;
      if (vaccineAndHealthEvents.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(130, 140, 130);
        doc.text('No vaccination or medical treatment logs recorded yet.', leftColX + 3, vY + 3);
      } else {
        vaccineAndHealthEvents.forEach((ev) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(40, 50, 40);
          doc.text(cleanPdfText(ev.date, 'N/A'), leftColX + 3, vY);

          doc.setFont('helvetica', 'normal');
          const title = cleanPdfText(ev.vaccineName || (ev.eventType === 'VACCINE' ? 'Vaccination' : 'Treatment'));
          doc.text(title.slice(0, 20), leftColX + 22, vY);

          const details = cleanPdfText(ev.details || '-');
          doc.setTextColor(80, 90, 80);
          doc.text(details.slice(0, 25), leftColX + 54, vY);
          vY += 5.5;
        });
      }

      // Right Column: WEIGHT PROGRESSION HISTORY
      doc.setDrawColor(200, 215, 200);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(rightColX, midY, colW, midHeight, 2, 2, 'FD');
      doc.setFillColor(235, 243, 235);
      doc.rect(rightColX, midY, colW, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 81, 40);
      doc.text('WEIGHT PROGRESSION HISTORY', rightColX + 3, midY + 4.5);

      let wY = midY + 10;
      doc.setFontSize(6.8);
      doc.setTextColor(100, 110, 100);
      doc.text('DATE', rightColX + 3, wY);
      doc.text('WEIGHT (KG)', rightColX + 28, wY);
      doc.text('NOTES / GAIN', rightColX + 54, wY);
      doc.setDrawColor(220, 230, 220);
      doc.line(rightColX + 2, wY + 1.5, rightColX + colW - 2, wY + 1.5);

      const weightLogs = animalEvents
        .filter((e) => e.eventType === 'WEIGHT' && e.weightKg !== undefined && e.weightKg > 0)
        .slice(0, 10);

      wY += 4.5;
      if (weightLogs.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(130, 140, 130);
        doc.text(`Initial recorded weight: ${animal.currentWeightKg || 0} kg`, rightColX + 3, wY + 3);
      } else {
        weightLogs.forEach((ev) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(40, 50, 40);
          doc.text(cleanPdfText(ev.date, 'N/A'), rightColX + 3, wY);

          doc.setTextColor(30, 81, 40);
          doc.text(`${ev.weightKg} kg`, rightColX + 28, wY);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 90, 80);
          const notes = cleanPdfText(ev.details || '-');
          doc.text(notes.slice(0, 25), rightColX + 54, wY);
          wY += 5.5;
        });
      }

      // 5. Bottom Section: Milk Totals & Event Timeline (y=194, height=84)
      const botY = 194;
      const botHeight = 84;

      // Left Column: MILK PRODUCTION PERFORMANCE & TOTALS
      doc.setDrawColor(200, 215, 200);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(leftColX, botY, colW, botHeight, 2, 2, 'FD');
      doc.setFillColor(235, 243, 235);
      doc.rect(leftColX, botY, colW, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 81, 40);
      doc.text('MILK PRODUCTION TOTALS & LOGS', leftColX + 3, botY + 4.5);

      // Summary badges inside Milk
      doc.setFillColor(245, 250, 245);
      doc.roundedRect(leftColX + 3, botY + 8, colW - 6, 8, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 81, 40);
      doc.text(`All-Time Total: ${totalMilkAllTime} L`, leftColX + 5, botY + 13.5);
      doc.text(`This Month: ${totalMilkThisMonth} L`, leftColX + 48, botY + 13.5);

      let mY = botY + 20;
      doc.setFontSize(6.8);
      doc.setTextColor(100, 110, 100);
      doc.text('DATE', leftColX + 3, mY);
      doc.text('YIELD (L)', leftColX + 26, mY);
      doc.text('DETAILS / NOTES', leftColX + 48, mY);
      doc.setDrawColor(220, 230, 220);
      doc.line(leftColX + 2, mY + 1.5, leftColX + colW - 2, mY + 1.5);

      const recentMilk = milkEvents.slice(0, 9);
      mY += 4.5;
      if (recentMilk.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(130, 140, 130);
        doc.text('No milk production logs recorded (male, calf or dry animal).', leftColX + 3, mY + 3);
      } else {
        recentMilk.forEach((ev) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(40, 50, 40);
          doc.text(cleanPdfText(ev.date, 'N/A'), leftColX + 3, mY);

          doc.setTextColor(30, 81, 40);
          doc.text(`${ev.milkLiters} L`, leftColX + 26, mY);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(80, 90, 80);
          const shiftNotes = cleanPdfText(ev.details || '-');
          doc.text(shiftNotes.slice(0, 25), leftColX + 48, mY);
          mY += 5.5;
        });
      }

      // Right Column: FULL EVENT & ACTIVITY TIMELINE
      doc.setDrawColor(200, 215, 200);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(rightColX, botY, colW, botHeight, 2, 2, 'FD');
      doc.setFillColor(235, 243, 235);
      doc.rect(rightColX, botY, colW, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 81, 40);
      doc.text('FULL ACTIVITY & OPERATIONS TIMELINE', rightColX + 3, botY + 4.5);

      let aY = botY + 10;
      doc.setFontSize(6.8);
      doc.setTextColor(100, 110, 100);
      doc.text('DATE', rightColX + 3, aY);
      doc.text('TYPE', rightColX + 24, aY);
      doc.text('DETAILS / LOG', rightColX + 48, aY);
      doc.setDrawColor(220, 230, 220);
      doc.line(rightColX + 2, aY + 1.5, rightColX + colW - 2, aY + 1.5);

      const generalEvents = animalEvents.slice(0, 11);
      aY += 4.5;
      if (generalEvents.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(130, 140, 130);
        doc.text('No farm operational activity logs recorded yet.', rightColX + 3, aY + 3);
      } else {
        generalEvents.forEach((ev) => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(40, 50, 40);
          doc.text(cleanPdfText(ev.date, 'N/A'), rightColX + 3, aY);

          doc.setFont('helvetica', 'normal');
          doc.setTextColor(30, 81, 40);
          doc.text(cleanPdfText(ev.eventType).slice(0, 12), rightColX + 24, aY);

          doc.setTextColor(80, 90, 80);
          const det = cleanPdfText(ev.details || ev.vaccineName || '-');
          doc.text(det.slice(0, 26), rightColX + 48, aY);
          aY += 5.5;
        });
      }

      // 6. Footer
      doc.setDrawColor(210, 225, 210);
      doc.line(12, 281, 198, 281);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 130, 120);
      doc.text('The Goated Farm Management System - Generated for buyer/vet verification & official farm record', 12, 285);
      doc.text(`Animal ID: ${cleanPdfText(animal.id)} | 1-Page Summary`, 198, 285, { align: 'right' });

      // Save PDF
      const filename = `Animal-Report-${animal.id}${animal.tag ? `-${animal.tag}` : ''}.pdf`;
      doc.save(filename);
    } catch (error) {
      console.error('Error generating animal PDF:', error);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const isInactive = animal.status !== 'ACTIVE';

  return (
    <div className="space-y-5">
      {/* Top Navigation & Header */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all cursor-pointer flex items-center gap-1.5 font-semibold text-[13px] self-start"
            title="গবাদিপশুর তালিকায় ফিরে যান"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>সকল গবাদিপশু</span>
          </button>

          {/* Action Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              id="btn-export-animal-pdf"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 text-[13px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px] disabled:opacity-50"
              title="পশুর সম্পূর্ণ জীবনবৃত্তান্ত ও রিপোর্ট পিডিএফ ডাউনলোড করুন"
            >
              <FileDown className="w-4 h-4 text-[#1E5128]" />
              <span>{isExportingPdf ? 'তৈরি হচ্ছে...' : 'PDF হিসেবে সংরক্ষণ করুন'}</span>
            </button>

            {onEditAnimal && role === 'OWNER' && (
              <button
                type="button"
                id="btn-edit-animal-detail"
                onClick={() => onEditAnimal(animal)}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 text-[13px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px]"
              >
                <Edit3 className="w-4 h-4 text-[#1E5128]" />
                <span>তথ্য ও ছবি সম্পাদনা</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onAddEvent(animal)}
              className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px]"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ কার্যক্রম যোগ করুন</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateStatus(animal)}
              className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[13px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 min-h-[38px]"
            >
              <Tag className="w-4 h-4 text-amber-700" />
              <span>পশু বিক্রি/অপসারণ</span>
            </button>
          </div>
        </div>

        {/* Animal Profile Header: Photo, QR Code & Details */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-3 shrink-0">
            {animal.photoUrl ? (
              <img
                src={animal.photoUrl}
                alt={animal.id}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-2 border-emerald-100 shadow-sm shrink-0 bg-gray-50"
              />
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-gray-50 border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 shrink-0 gap-1">
                <Camera className="w-8 h-8 text-gray-400 stroke-[1.5]" />
                <span className="text-[11px] font-medium text-gray-400">ছবি নেই</span>
              </div>
            )}

            {/* Scannable QR Code */}
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white border border-gray-200 shadow-xs p-1.5 flex flex-col items-center justify-between shrink-0 relative group">
              {qrCodeDataUrl ? (
                <>
                  <img
                    src={qrCodeDataUrl}
                    alt={`QR কোড (${animal.id})`}
                    className="w-16 h-16 sm:w-20 sm:h-20 object-contain"
                  />
                  <div className="w-full flex items-center justify-between px-1">
                    <span className="text-[10px] font-mono font-bold text-[#1E5128] truncate">
                      {animal.id}
                    </span>
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      className="p-0.5 rounded text-gray-400 hover:text-[#1E5128] transition-colors cursor-pointer"
                      title="কিউআর কোড ডাউনলোড করুন"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-1 text-center">
                  <QrCode className="w-6 h-6 animate-pulse text-[#1E5128]" />
                  <span className="text-[9px]">তৈরি হচ্ছে...</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-bold font-mono text-[#1E5128]">{animal.id}</h2>
              <span className="text-gray-300">|</span>
              <span className="text-gray-900 font-semibold text-[16px] sm:text-[18px]">{animal.breed}</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[12px] font-bold ${
                  animal.status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : animal.status === 'SOLD'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'
                }`}
              >
                {animal.status === 'ACTIVE'
                  ? 'সক্রিয় (ACTIVE)'
                  : animal.status === 'SOLD'
                  ? 'বিক্রিত (SOLD)'
                  : animal.status === 'DECEASED'
                  ? 'মৃত (DECEASED)'
                  : animal.status}
              </span>
              {vaccineStatus && (
                <StatusBadge
                  status={vaccineStatus}
                  label={vaccineStatus === 'overdue' ? 'টিকা বকেয়া (Overdue)' : 'টিকা আসন্ন (Due Soon)'}
                />
              )}
            </div>
            <p className="text-[13px] text-gray-500 mt-1">
              ট্যাগ: {animal.tag || animal.id} • শেড/অবস্থান: {animal.location || 'নির্ধারিত নয়'}
            </p>
          </div>
        </div>
      </div>

      {/* Basic Info Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs text-[13px]">
        <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
          <span className="text-gray-500 block text-[12px]">প্রজাতি ও লিঙ্গ</span>
          <span className="font-bold text-gray-900 text-[14px]">
            {animal.species === 'CATTLE' ? 'গরু (Cattle)' : animal.species === 'GOAT' ? 'ছাগল (Goat)' : animal.species === 'SHEEP' ? 'ভেড়া (Sheep)' : animal.species === 'POULTRY' ? 'হাঁস-মুরগি (Poultry)' : animal.species}
            {' • '}
            {animal.gender === 'FEMALE' ? 'মাদি (Female)' : 'মদ্দা (Male)'}
          </span>
        </div>
        <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
          <span className="text-gray-500 block text-[12px]">বর্তমান ওজন</span>
          <span className="font-bold text-emerald-800 text-[15px]">
            {animal.currentWeightKg} কেজি
          </span>
        </div>
        <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
          <span className="text-gray-500 block text-[12px]">ক্রয়ের তারিখ</span>
          <span className="font-semibold text-gray-800 text-[14px]">
            {animal.purchaseDate || 'অজানা'}
          </span>
        </div>
        <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
          <span className="text-gray-500 block text-[12px]">জন্ম তারিখ</span>
          <span className="font-semibold text-gray-800 text-[14px]">
            {animal.birthDate || 'অজানা'}
          </span>
        </div>
      </div>

      {/* Grid: Left Column (Charts, Milk & Timeline) & Right Column (Cost Breakdown Box) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Content Area (2 Cols) */}
        <div className="lg:col-span-2 space-y-5">
          {/* SECTION 1: WEIGHT PROGRESSION (GROWTH CHART) */}
          <div id="section-growth-chart" className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-emerald-100/70 dark:border-emerald-950 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <IconTile icon={Scale} color="emerald" size="md" rounded="xl" />
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-slate-100 text-[15px]">
                    ওজন বৃদ্ধির চার্ট (Growth Chart)
                  </h3>
                  <p className="text-[12px] text-gray-500 dark:text-slate-400">
                    সময় অনুযায়ী দৈহিক বৃদ্ধি ও ওজনের অগ্রগতি সূচক
                  </p>
                </div>
              </div>
              <span className="text-[13px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900">
                বর্তমান: {animal.currentWeightKg} কেজি
              </span>
            </div>

            {weightChartData.length > 0 ? (
              <div className="w-full pt-1">
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weightChartData} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                      />
                      <YAxis
                        unit=" kg"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#FFFFFF',
                          borderColor: '#CBD5E1',
                          borderRadius: '0.75rem',
                          fontSize: '13px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                        }}
                        formatter={(value: any) => [`${value} কেজি`, 'ওজন']}
                        labelFormatter={(label) => `তারিখ: ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="weightKg"
                        name="ওজন"
                        stroke="#1E5128"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#1E5128', strokeWidth: 1.5, stroke: '#FFFFFF' }}
                        activeDot={{ r: 6, fill: '#15803D' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {weightChartData.length === 1 && (
                  <p className="text-[12px] text-gray-500 text-center mt-1">
                    * বর্তমানে ১টি ওজনের তথ্য সংরক্ষিত আছে। নতুন পরিমাপ যোগ করলে রেখাচিত্র প্রদর্শিত হবে।
                  </p>
                )}
              </div>
            ) : (
              <EmptyState
                id="empty-growth-chart"
                icon={Scale}
                heading="কোনো ওজন পরিমাপের রেকর্ড নেই"
                message="পশুর শারীরিক বৃদ্ধির অগ্রগতি পর্যবেক্ষণ করতে '+ কার্যক্রম যোগ করুন' থেকে নতুন ওজন রেকর্ড করুন।"
                compact
              />
            )}
          </div>

          {/* SECTION 2: MILK PRODUCTION (MILK LOG) */}
          <div id="section-milk-log" className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-cyan-200/80 dark:border-cyan-900/60 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-cyan-100/70 dark:border-cyan-950 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <IconTile icon={Droplets} color="cyan" size="md" rounded="xl" />
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-slate-100 text-[15px]">
                    দুধ উৎপাদন লগ (Milk Log)
                  </h3>
                  <p className="text-[12px] text-gray-500 dark:text-slate-400">
                    দৈনিক ও মাসিক দুধের উৎপাদন ও খাদ্য খরচ রেকর্ড
                  </p>
                </div>
              </div>

              {/* Small total-this-month figure */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] text-gray-500 dark:text-slate-400 block">চলতি মাসে মোট</span>
                  <span className="text-[15px] font-bold text-cyan-800 dark:text-cyan-400 font-mono">
                    {totalMilkThisMonth} লিটার
                  </span>
                </div>
                {totalMilkAllTime > totalMilkThisMonth && (
                  <div className="text-right pl-3 border-l border-gray-200 dark:border-slate-700 hidden sm:block">
                    <span className="text-[11px] text-gray-500 dark:text-slate-400 block">সর্বমোট উৎপাদিত</span>
                    <span className="text-[14px] font-semibold text-gray-700 dark:text-slate-300 font-mono">
                      {totalMilkAllTime} লিটার
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Milk Events List */}
            {milkEvents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-800 text-gray-500 dark:text-slate-400 text-[12px]">
                      <th className="py-2 px-2 font-medium">তারিখ</th>
                      <th className="py-2 px-2 font-medium">দুধের পরিমাণ</th>
                      <th className="py-2 px-2 font-medium">ব্যয় / ফিড</th>
                      <th className="py-2 px-2 font-medium">নোট বা বিবরণ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {milkEvents.map((m) => (
                      <tr key={m.id} className="hover:bg-cyan-50/40 dark:hover:bg-cyan-950/20 transition-colors">
                        <td className="py-2.5 px-2 font-mono text-gray-800 dark:text-slate-200 font-semibold whitespace-nowrap">
                          {m.date}
                        </td>
                        <td className="py-2.5 px-2">
                          <span className="font-bold text-cyan-800 dark:text-cyan-400 font-mono text-[14px]">
                            {m.milkLiters} লিটার
                          </span>
                        </td>
                        <td className="py-2.5 px-2 font-mono text-gray-600 dark:text-slate-400">
                          {m.cost > 0 ? fmt(m.cost) : '—'}
                        </td>
                        <td className="py-2.5 px-2 text-gray-600 dark:text-slate-300 max-w-xs truncate">
                          {m.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                id="empty-milk-log"
                icon={Droplets}
                heading="কোনো দুধ উৎপাদনের তথ্য নেই"
                message={
                  animal.gender === 'FEMALE'
                    ? 'দুধের ফলন ও উৎপাদন ট্র্যাক করতে "+ কার্যক্রম যোগ করুন" বোতামে চাপুন।'
                    : 'এই গবাদিপশুর দুধ উৎপাদনের কোনো রেকর্ড প্রযোজ্য নয়।'
                }
                compact
              />
            )}
          </div>

          {/* SECTION 3: REVERSE-CHRONOLOGICAL TIMELINE OF ALL ANIMAL EVENTS */}
          <div id="section-timeline" className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-indigo-100/70 dark:border-indigo-950 pb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <IconTile icon={Clock} color="indigo" size="md" rounded="xl" />
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-slate-100 text-[15px]">
                    কার্যক্রমের টাইমলাইন (Activity Timeline)
                  </h3>
                  <p className="text-[12px] text-gray-500 dark:text-slate-400">
                    সর্বমোট {animalEvents.length}টি খাদ্য, ওষুধ, চিকিৎসা ও পরিচর্যা কার্যক্রম সংরক্ষিত
                  </p>
                </div>
              </div>
            </div>

            {animalEvents.length > 0 ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200 dark:before:bg-slate-800">
                {animalEvents.map((ev) => {
                  const badge = getEventBadge(ev.eventType);

                  return (
                    <div key={ev.id} className="relative group">
                      {/* Timeline Dot with Icon */}
                      <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-white dark:bg-slate-900 border-2 border-indigo-600 flex items-center justify-center shadow-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                      </div>

                      {/* Event Card */}
                      <div className="p-3.5 bg-gray-50/80 dark:bg-slate-800/60 rounded-xl border border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all space-y-2 text-[13px]">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-[12px] font-bold flex items-center gap-1.5 border ${badge.bg}`}
                            >
                              {badge.icon}
                              <span>{badge.label}</span>
                            </span>
                            <span className="font-mono text-gray-500 dark:text-slate-400 text-[12px] flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {ev.date}
                            </span>
                          </div>

                          {/* Cost if any */}
                          {ev.cost > 0 && (
                            <div className="font-mono font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900">
                              খরচ: {fmt(ev.cost)}
                            </div>
                          )}
                        </div>

                        {/* Specific Event Metadata */}
                        {ev.weightKg !== undefined && ev.weightKg > 0 && (
                          <div className="font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/40 px-2.5 py-1 rounded-md inline-block">
                            পরিমাপকৃত ওজন: {ev.weightKg} কেজি
                          </div>
                        )}

                        {ev.milkLiters !== undefined && ev.milkLiters > 0 && (
                          <div className="font-semibold text-cyan-800 dark:text-cyan-300 bg-cyan-50/80 dark:bg-cyan-950/40 px-2.5 py-1 rounded-md inline-block">
                            দুধের পরিমাণ: {ev.milkLiters} লিটার
                          </div>
                        )}

                        {ev.vaccineName && (
                          <div className="text-[12px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-900">
                            <span className="font-semibold">টিকা/ওষুধের নাম:</span> {ev.vaccineName}
                            {ev.nextDueDate && (
                              <span className="ml-2 font-mono text-blue-600 dark:text-blue-400">
                                (পরবর্তী ডোজ: {ev.nextDueDate})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Notes / Details */}
                        {ev.details && (
                          <p className="text-gray-700 dark:text-slate-300 leading-relaxed pt-1">
                            {ev.details}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                id="empty-activity-timeline"
                icon={Clock}
                heading="কোনো কার্যক্রম রেকর্ড করা নেই"
                message="খাদ্য, চিকিৎসা, টিকা বা ওজন সংক্রান্ত বিবরণ সংরক্ষণ করতে '+ কার্যক্রম যোগ করুন' বোতামে চাপুন।"
                compact
              />
            )}
          </div>
        </div>

        {/* Right Column: SECTION 4: PROFIT & LOSS (PROFITABILITY) & COST BREAKDOWN */}
        <div className="space-y-4">
          <div id="section-profitability" className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-amber-200/80 dark:border-amber-900/60 shadow-xs space-y-4 sticky top-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-amber-100/70 dark:border-amber-950 pb-3">
              <div className="flex items-center gap-3">
                <IconTile
                  icon={netProfitLoss >= 0 ? TrendingUp : TrendingDown}
                  color={netProfitLoss >= 0 ? 'emerald' : 'danger'}
                  size="md"
                  rounded="xl"
                />
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-slate-100 text-[15px]">
                    লাভ-ক্ষতি ও আর্থিক বিশ্লেষণ (Profitability)
                  </h3>
                  <p className="text-[12px] text-gray-500 dark:text-slate-400">
                    আয়, মোট ব্যয় ও লাভ-ক্ষতির পূর্ণাঙ্গ হিসাব
                  </p>
                </div>
              </div>
            </div>

            {/* Prominent Net Profit / Loss Card */}
            <div
              className={`p-4 rounded-xl border ${
                netProfitLoss >= 0
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200'
                  : 'bg-rose-50/60 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">
                  {netProfitLoss >= 0 ? 'নিট লাভ (Net Profit):' : 'নিট ক্ষতি (Net Loss):'}
                </span>
                <span
                  className={`text-[18px] font-mono font-bold ${
                    netProfitLoss >= 0 ? 'text-[#15803D] dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {netProfitLoss >= 0 ? '+' : ''}
                  {fmt(netProfitLoss)}
                </span>
              </div>
              <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-1 flex justify-between">
                <span>সর্বমোট রাজস্ব {fmt(totalRevenue)}</span>
                <span>−</span>
                <span>সর্বমোট খরচ {fmt(totalCost)}</span>
              </div>
            </div>

            {/* Cost Breakdown Details */}
            <div className="space-y-2 text-[13px]">
              <div className="text-[12px] font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide pt-1">
                ১. ব্যয়ের বিবরণী (Cost Breakdown)
              </div>
              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">ক্রয়মূল্য (Purchase Cost):</span>
                <span className="font-mono font-bold text-gray-900 dark:text-slate-200">
                  {fmt(animal.purchaseCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">পুঞ্জীভূত খাদ্য খরচ (Feed):</span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                  {fmt(animal.accumulatedFeedCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">চিকিৎসা ও ওষুধ খরচ (Med):</span>
                <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                  {fmt(animal.accumulatedMedCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">শ্রমিক ব্যয় (Labour):</span>
                <span className="font-mono font-bold text-gray-800 dark:text-slate-200">
                  {fmt(animal.accumulatedLabourCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">অন্যান্য খরচ (Other):</span>
                <span className="font-mono font-bold text-gray-800 dark:text-slate-200">
                  {fmt(animal.otherCosts || 0)}
                </span>
              </div>

              {/* Total Cost Highlight */}
              <div className="flex justify-between items-center py-2 px-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-xl font-bold text-[13px]">
                <span className="text-gray-900 dark:text-slate-200">সর্বমোট খরচ (Total Cost):</span>
                <span className="font-mono text-gray-900 dark:text-slate-100 text-[14px]">
                  {fmt(totalCost)}
                </span>
              </div>

              {/* Revenue Breakdown */}
              <div className="text-[12px] font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide pt-3">
                ২. আয়ের বিবরণী (Revenue Breakdown)
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">বিক্রয়মূল্য (Sale Price):</span>
                <span className="font-mono font-bold text-gray-900 dark:text-slate-200">
                  {animal.status === 'SOLD' ? fmt(animal.salePrice || 0) : 'সক্রিয় (অবিক্রিত)'}
                </span>
              </div>

              {animal.status === 'SOLD' && animal.saleDate && (
                <div className="text-[11px] text-gray-500 dark:text-slate-400 text-right">
                  বিক্রয়ের তারিখ: {animal.saleDate}
                </div>
              )}

              {milkSalesRevenue > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-slate-800">
                  <span className="text-gray-600 dark:text-slate-400">সংযুক্ত দুধ বিক্রয় (Milk Sales):</span>
                  <span className="font-mono font-bold text-cyan-700 dark:text-cyan-400">
                    {fmt(milkSalesRevenue)}
                  </span>
                </div>
              )}

              {/* Milk production as memo line */}
              <div className="p-2.5 bg-cyan-50/70 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-800 rounded-xl text-[12px] text-cyan-900 dark:text-cyan-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <Droplets className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  <span>দুধ উৎপাদন (মেমো লাইন / Memo line):</span>
                </span>
                <span className="font-mono font-bold">
                  {totalMilkAllTime} লিটার
                </span>
              </div>

              <div className="flex justify-between items-center py-2 px-3 bg-emerald-50/50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl font-bold text-[13px]">
                <span className="text-gray-900 dark:text-slate-200">সর্বমোট রাজস্ব (Total Revenue):</span>
                <span className="font-mono text-[#15803D] dark:text-emerald-400 text-[14px]">
                  {fmt(totalRevenue)}
                </span>
              </div>

              {/* Cost Per Day Held */}
              <div className="text-[12px] font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wide pt-3">
                ৩. প্রতিপালন ব্যয় সূচক (Daily Cost)
              </div>

              <div className="p-3 bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl space-y-1.5 text-[12px]">
                <div className="flex justify-between items-center">
                  <span className="text-amber-900 dark:text-amber-300 font-medium flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                    <span>ক্রয়ের পর থেকে দিন সংখ্যা:</span>
                  </span>
                  <span className="font-mono font-bold text-amber-950 dark:text-amber-200">
                    {daysSincePurchase} দিন
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-amber-200/60 dark:border-amber-800">
                  <span className="text-gray-800 dark:text-slate-200 font-bold">দৈনিক খরচ (Cost / Day):</span>
                  <span className="font-mono font-bold text-amber-800 dark:text-amber-400 text-[13px]">
                    {fmt(costPerDayHeld)} / দিন
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 dark:text-slate-400 italic">
                  (সূত্র: মোট খরচ {fmt(totalCost)} ÷ {daysSincePurchase} দিন)
                </div>
              </div>
            </div>

            {/* Quick Stats Summary */}
            <div className="pt-2 text-[12px] text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-800/60 p-3 rounded-xl border border-gray-100 dark:border-slate-800 space-y-1">
              <div className="flex justify-between">
                <span>মোট কার্যক্রম রেকর্ড:</span>
                <span className="font-bold text-gray-700 dark:text-slate-300">{animalEvents.length}টি</span>
              </div>
              <div className="flex justify-between">
                <span>ওজন পরিমাপ রেকর্ড:</span>
                <span className="font-bold text-gray-700 dark:text-slate-300">
                  {animalEvents.filter((e) => e.eventType === 'WEIGHT').length}টি
                </span>
              </div>
              <div className="flex justify-between">
                <span>দুধ উৎপাদনের এন্ট্রি:</span>
                <span className="font-bold text-gray-700 dark:text-slate-300">{milkEvents.length}টি</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
