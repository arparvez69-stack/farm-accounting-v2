import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
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
  CalendarDays
} from 'lucide-react';
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
import { Animal, AnimalEvent, UserRole } from '../types';

interface AnimalDetailViewProps {
  animal: Animal;
  events: AnimalEvent[];
  onBack: () => void;
  onAddEvent: (animal: Animal) => void;
  onUpdateStatus: (animal: Animal) => void;
  role: UserRole;
}

const fmt = (num: number): string => `৳${Math.round(num).toLocaleString('en-IN')}`;

export const AnimalDetailView: React.FC<AnimalDetailViewProps> = ({
  animal,
  events,
  onBack,
  onAddEvent,
  onUpdateStatus,
  role
}) => {
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

  const isInactive = animal.status !== 'ACTIVE';

  return (
    <div className="space-y-5">
      {/* Top Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all cursor-pointer flex items-center gap-1.5 font-semibold text-[13px]"
            title="গবাদিপশুর তালিকায় ফিরে যান"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>সকল গবাদিপশু</span>
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold font-mono text-[#1E5128]">{animal.id}</h2>
              <span className="text-gray-400">|</span>
              <span className="text-gray-900 font-semibold text-[15px]">{animal.breed}</span>
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
            </div>
            <p className="text-[13px] text-gray-500 mt-0.5">
              ট্যাগ: {animal.tag || animal.id} • শেড/অবস্থান: {animal.location || 'নির্ধারিত নয়'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Basic Info Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-gray-200 shadow-xs text-[13px]">
        <div className="p-3 bg-gray-50/80 rounded-xl border border-gray-100">
          <span className="text-gray-500 block text-[12px]">প্রজাতি ও লিঙ্গ</span>
          <span className="font-bold text-gray-900 text-[14px]">
            {animal.species === 'CATTLE' ? 'গরু (Cattle)' : animal.species === 'GOAT' ? 'ছাগল (Goat)' : animal.species}
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
          {/* SECTION 2: WEIGHT PROGRESSION LINE CHART */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[#1E5128]">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-[15px]">
                    ওজন বৃদ্ধির চার্ট (Weight Progression)
                  </h3>
                  <p className="text-[12px] text-gray-500">
                    সময় অনুযায়ী ওজন (কেজি) পরিবর্তনের সাধারণ সূচক
                  </p>
                </div>
              </div>
              <span className="text-[13px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                বর্তমান: {animal.currentWeightKg} কেজি
              </span>
            </div>

            {weightChartData.length > 0 ? (
              <div className="w-full pt-2">
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
              <div className="p-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 text-[13px]">
                কোনো ওজন পরিমাপের রেকর্ড নেই। '+ কার্যক্রম যোগ করুন' থেকে ওজন রেকর্ড করুন।
              </div>
            )}
          </div>

          {/* SECTION 3: MILK PRODUCTION (দুধ উৎপাদন) */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700">
                  <Droplets className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-[15px]">
                    দুধ উৎপাদন (Milk Production)
                  </h3>
                  <p className="text-[12px] text-gray-500">
                    দুধের দৈনিক ও মাসিক উৎপাদন রেকর্ড
                  </p>
                </div>
              </div>

              {/* Small total-this-month figure */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] text-gray-500 block">চলতি মাসে মোট</span>
                  <span className="text-[15px] font-bold text-cyan-800 font-mono">
                    {totalMilkThisMonth} লিটার
                  </span>
                </div>
                {totalMilkAllTime > totalMilkThisMonth && (
                  <div className="text-right pl-3 border-l border-gray-200 hidden sm:block">
                    <span className="text-[11px] text-gray-500 block">সর্বমোট উৎপাদিত</span>
                    <span className="text-[14px] font-semibold text-gray-700 font-mono">
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
                    <tr className="border-b border-gray-200 text-gray-500 text-[12px]">
                      <th className="py-2 px-2 font-medium">তারিখ</th>
                      <th className="py-2 px-2 font-medium">দুধের পরিমাণ</th>
                      <th className="py-2 px-2 font-medium">ব্যয় / ফিড</th>
                      <th className="py-2 px-2 font-medium">নোট বা বিবরণ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {milkEvents.map((m) => (
                      <tr key={m.id} className="hover:bg-cyan-50/40 transition-colors">
                        <td className="py-2.5 px-2 font-mono text-gray-800 font-semibold whitespace-nowrap">
                          {m.date}
                        </td>
                        <td className="py-2.5 px-2">
                          <span className="font-bold text-cyan-800 font-mono text-[14px]">
                            {m.milkLiters} লিটার
                          </span>
                        </td>
                        <td className="py-2.5 px-2 font-mono text-gray-600">
                          {m.cost > 0 ? fmt(m.cost) : '—'}
                        </td>
                        <td className="py-2.5 px-2 text-gray-600 max-w-xs truncate">
                          {m.details || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 text-[13px]">
                {animal.gender === 'FEMALE'
                  ? 'কোনো দুধ উৎপাদনের তথ্য রেকর্ড নেই। নতুন রেকর্ড করতে উপরের "+ কার্যক্রম যোগ করুন" বোতামে চাপুন।'
                  : 'এই গবাদিপশুর দুধ উৎপাদনের কোনো রেকর্ড প্রযোজ্য নয়।'}
              </div>
            )}
          </div>

          {/* SECTION 1: REVERSE-CHRONOLOGICAL TIMELINE OF ALL ANIMAL EVENTS */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[#1E5128]">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-[15px]">
                    কার্যক্রমের টাইমলাইন (Activity Timeline)
                  </h3>
                  <p className="text-[12px] text-gray-500">
                    সর্বমোট {animalEvents.length}টি কার্যক্রম সংরক্ষিত (নতুন থেকে পুরনো)
                  </p>
                </div>
              </div>
            </div>

            {animalEvents.length > 0 ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                {animalEvents.map((ev) => {
                  const badge = getEventBadge(ev.eventType);

                  return (
                    <div key={ev.id} className="relative group">
                      {/* Timeline Dot with Icon */}
                      <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-white border-2 border-[#1E5128] flex items-center justify-center shadow-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#1E5128]" />
                      </div>

                      {/* Event Card */}
                      <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-all space-y-2 text-[13px]">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-[12px] font-bold flex items-center gap-1.5 border ${badge.bg}`}
                            >
                              {badge.icon}
                              <span>{badge.label}</span>
                            </span>
                            <span className="font-mono text-gray-500 text-[12px] flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {ev.date}
                            </span>
                          </div>

                          {/* Cost if any */}
                          {ev.cost > 0 && (
                            <div className="font-mono font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                              খরচ: {fmt(ev.cost)}
                            </div>
                          )}
                        </div>

                        {/* Specific Event Metadata */}
                        {ev.weightKg !== undefined && ev.weightKg > 0 && (
                          <div className="font-semibold text-emerald-800 bg-emerald-50/80 px-2.5 py-1 rounded-md inline-block">
                            পরিমাপকৃত ওজন: {ev.weightKg} কেজি
                          </div>
                        )}

                        {ev.milkLiters !== undefined && ev.milkLiters > 0 && (
                          <div className="font-semibold text-cyan-800 bg-cyan-50/80 px-2.5 py-1 rounded-md inline-block">
                            দুধের পরিমাণ: {ev.milkLiters} লিটার
                          </div>
                        )}

                        {ev.vaccineName && (
                          <div className="text-[12px] text-blue-800 bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-200">
                            <span className="font-semibold">টিকা/ওষুধের নাম:</span> {ev.vaccineName}
                            {ev.nextDueDate && (
                              <span className="ml-2 font-mono text-blue-600">
                                (পরবর্তী ডোজ: {ev.nextDueDate})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Notes / Details */}
                        {ev.details && (
                          <p className="text-gray-700 leading-relaxed pt-1">
                            {ev.details}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-500 text-[14px]">
                এই পশুর কোনো কার্যক্রম রেকর্ড করা নেই। '+ কার্যক্রম যোগ করুন' বোতামে চাপ দিয়ে খাদ্য, চিকিৎসা, ওজন বা দুধ উৎপাদনের বিবরণ যোগ করুন।
              </div>
            )}
          </div>
        </div>

        {/* Right Column: SECTION 4: PROFIT & LOSS (লাভ-ক্ষতি) & COST BREAKDOWN */}
        <div className="space-y-4">
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4 sticky top-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${netProfitLoss >= 0 ? 'bg-emerald-50 text-[#15803D]' : 'bg-rose-50 text-rose-700'}`}>
                  {netProfitLoss >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-[15px]">
                    লাভ-ক্ষতি বিশ্লেষণ (Profit & Loss)
                  </h3>
                  <p className="text-[12px] text-gray-500">
                    আয়, মোট ব্যয় ও লাভ-ক্ষতির পূর্ণাঙ্গ হিসাব
                  </p>
                </div>
              </div>
            </div>

            {/* Prominent Net Profit / Loss Card */}
            <div
              className={`p-4 rounded-xl border ${
                netProfitLoss >= 0
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/60 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">
                  {netProfitLoss >= 0 ? 'নিট লাভ (Net Profit):' : 'নিট ক্ষতি (Net Loss):'}
                </span>
                <span
                  className={`text-[18px] font-mono font-bold ${
                    netProfitLoss >= 0 ? 'text-[#15803D]' : 'text-rose-700'
                  }`}
                >
                  {netProfitLoss >= 0 ? '+' : ''}
                  {fmt(netProfitLoss)}
                </span>
              </div>
              <div className="text-[11px] text-gray-600 mt-1 flex justify-between">
                <span>সর্বমোট রাজস্ব {fmt(totalRevenue)}</span>
                <span>−</span>
                <span>সর্বমোট খরচ {fmt(totalCost)}</span>
              </div>
            </div>

            {/* Cost Breakdown Details */}
            <div className="space-y-2 text-[13px]">
              <div className="text-[12px] font-bold text-gray-700 uppercase tracking-wide pt-1">
                ১. ব্যয়ের বিবরণী (Cost Breakdown)
              </div>
              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">ক্রয়মূল্য (Purchase Cost):</span>
                <span className="font-mono font-bold text-gray-900">
                  {fmt(animal.purchaseCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">পুঞ্জীভূত খাদ্য খরচ (Feed):</span>
                <span className="font-mono font-bold text-amber-700">
                  {fmt(animal.accumulatedFeedCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">চিকিৎসা ও ওষুধ খরচ (Med):</span>
                <span className="font-mono font-bold text-blue-700">
                  {fmt(animal.accumulatedMedCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">শ্রমিক ব্যয় (Labour):</span>
                <span className="font-mono font-bold text-gray-800">
                  {fmt(animal.accumulatedLabourCost || 0)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">অন্যান্য খরচ (Other):</span>
                <span className="font-mono font-bold text-gray-800">
                  {fmt(animal.otherCosts || 0)}
                </span>
              </div>

              {/* Total Cost Highlight */}
              <div className="flex justify-between items-center py-2 px-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-[13px]">
                <span className="text-gray-900">সর্বমোট খরচ (Total Cost):</span>
                <span className="font-mono text-gray-900 text-[14px]">
                  {fmt(totalCost)}
                </span>
              </div>

              {/* Revenue Breakdown */}
              <div className="text-[12px] font-bold text-gray-700 uppercase tracking-wide pt-3">
                ২. আয়ের বিবরণী (Revenue Breakdown)
              </div>

              <div className="flex justify-between items-center py-1 border-b border-gray-100">
                <span className="text-gray-600">বিক্রয়মূল্য (Sale Price):</span>
                <span className="font-mono font-bold text-gray-900">
                  {animal.status === 'SOLD' ? fmt(animal.salePrice || 0) : 'সক্রিয় (অবিক্রিত)'}
                </span>
              </div>

              {animal.status === 'SOLD' && animal.saleDate && (
                <div className="text-[11px] text-gray-500 text-right">
                  বিক্রয়ের তারিখ: {animal.saleDate}
                </div>
              )}

              {milkSalesRevenue > 0 && (
                <div className="flex justify-between items-center py-1 border-b border-gray-100">
                  <span className="text-gray-600">সংযুক্ত দুধ বিক্রয় (Milk Sales):</span>
                  <span className="font-mono font-bold text-cyan-700">
                    {fmt(milkSalesRevenue)}
                  </span>
                </div>
              )}

              {/* Milk production as memo line */}
              <div className="p-2.5 bg-cyan-50/70 border border-cyan-200 rounded-xl text-[12px] text-cyan-900 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <Droplets className="w-4 h-4 text-cyan-600" />
                  <span>দুধ উৎপাদন (মেমো লাইন / Memo line):</span>
                </span>
                <span className="font-mono font-bold">
                  {totalMilkAllTime} লিটার
                </span>
              </div>

              <div className="flex justify-between items-center py-2 px-3 bg-emerald-50/50 border border-emerald-200 rounded-xl font-bold text-[13px]">
                <span className="text-gray-900">সর্বমোট রাজস্ব (Total Revenue):</span>
                <span className="font-mono text-[#15803D] text-[14px]">
                  {fmt(totalRevenue)}
                </span>
              </div>

              {/* Cost Per Day Held */}
              <div className="text-[12px] font-bold text-gray-700 uppercase tracking-wide pt-3">
                ৩. প্রতিপালন ব্যয় সূচক (Daily Cost)
              </div>

              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1.5 text-[12px]">
                <div className="flex justify-between items-center">
                  <span className="text-amber-900 font-medium flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5 text-amber-700" />
                    <span>ক্রয়ের পর থেকে দিন সংখ্যা:</span>
                  </span>
                  <span className="font-mono font-bold text-amber-950">
                    {daysSincePurchase} দিন
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-amber-200/60">
                  <span className="text-gray-800 font-bold">দৈনিক খরচ (Cost / Day):</span>
                  <span className="font-mono font-bold text-amber-800 text-[13px]">
                    {fmt(costPerDayHeld)} / দিন
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 italic">
                  (সূত্র: মোট খরচ {fmt(totalCost)} ÷ {daysSincePurchase} দিন)
                </div>
              </div>
            </div>

            {/* Quick Stats Summary */}
            <div className="pt-2 text-[12px] text-gray-500 bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-1">
              <div className="flex justify-between">
                <span>মোট কার্যক্রম রেকর্ড:</span>
                <span className="font-bold text-gray-700">{animalEvents.length}টি</span>
              </div>
              <div className="flex justify-between">
                <span>ওজন পরিমাপ রেকর্ড:</span>
                <span className="font-bold text-gray-700">
                  {animalEvents.filter((e) => e.eventType === 'WEIGHT').length}টি
                </span>
              </div>
              <div className="flex justify-between">
                <span>দুধ উৎপাদনের এন্ট্রি:</span>
                <span className="font-bold text-gray-700">{milkEvents.length}টি</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
