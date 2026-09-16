import React, { useEffect, useState } from 'react';
import {
  Tractor,
  Fish,
  Wheat,
  PlusCircle,
  Activity,
  ArrowRightLeft,
  Factory,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { db } from '../db/indexedDb';
import { Animal, CropCycle, FishBatch, InternalFlow, ProcessingRun, UserRole } from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';

interface Props {
  role: UserRole;
  currentUserId: string;
}

type OpsTab = 'livestock' | 'fisheries' | 'crops' | 'flows' | 'processing';

export const FarmOperationsModule: React.FC<Props> = ({ role, currentUserId }) => {
  const [tab, setTab] = useState<OpsTab>('livestock');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [fishBatches, setFishBatches] = useState<FishBatch[]>([]);
  const [cropCycles, setCropCycles] = useState<CropCycle[]>([]);
  const [internalFlows, setInternalFlows] = useState<InternalFlow[]>([]);
  const [processingRuns, setProcessingRuns] = useState<ProcessingRun[]>([]);

  // Add Animal
  const [showAddAnimal, setShowAddAnimal] = useState(false);
  const [tagId, setTagId] = useState('');
  const [species, setSpecies] = useState<'CATTLE' | 'GOAT' | 'SHEEP'>('CATTLE');
  const [breed, setBreed] = useState('দেশি ও ফ্রিজিয়ান ক্রস');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('FEMALE');
  const [purchaseCost, setPurchaseCost] = useState('65000');
  const [currentWeight, setCurrentWeight] = useState('180');

  // Add Fish Batch
  const [showAddFish, setShowAddFish] = useState(false);
  const [pondName, setPondName] = useState('পুকুর নং ১ (উত্তর পাড়)');
  const [fishSpecies, setFishSpecies] = useState('পাঙ্গাশ ও তেলাপিয়া');
  const [fingerlingQty, setFingerlingQty] = useState('5000');
  const [fingerlingCost, setFingerlingCost] = useState('15000');

  // Add Crop Cycle
  const [showAddCrop, setShowAddCrop] = useState(false);
  const [plotName, setPlotName] = useState('প্লট এ (নেপিয়ার ঘাস)');
  const [cropName, setCropName] = useState('সুপার নেপিয়ার ঘাস');
  const [cropArea, setCropArea] = useState('33');

  // Add Internal Flow
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [flowResource, setFlowResource] = useState<InternalFlow['resource']>('MANURE');
  const [flowSource, setFlowSource] = useState('শেড ১ (ডেইরি)');
  const [flowDestination, setFlowDestination] = useState('পুকুর ১');
  const [flowDesc, setFlowDesc] = useState('গোবর সার পুকুরে প্রয়োগ');
  const [flowQty, setFlowQty] = useState('500');
  const [flowValue, setFlowValue] = useState('1000');

  useEffect(() => {
    loadOpsData();
  }, [tab]);

  const loadOpsData = async () => {
    setLoading(true);
    try {
      // Seed default animals if empty
      let aList = await db.animals.toArray();
      if (aList.length === 0) {
        const seedA: Animal[] = [
          {
            id: 'COW-101',
            tag: 'TAG-101',
            species: 'CATTLE',
            breed: 'হলস্টাইন ফ্রিজিয়ান সংকর (Holstein Cross)',
            gender: 'FEMALE',
            birthDate: '2022-03-15',
            purchaseDate: '2023-01-10',
            purchaseCost: 85000,
            currentWeightKg: 380,
            accumulatedFeedCost: 24000,
            accumulatedMedCost: 3500,
            accumulatedLabourCost: 6000,
            otherCosts: 0,
            totalCost: 118500,
            status: 'ACTIVE',
            location: 'শেড নং ১',
            synced: false
          },
          {
            id: 'BULL-102',
            tag: 'TAG-102',
            species: 'CATTLE',
            breed: 'শাহীওয়াল ক্রস (Sahiwal)',
            gender: 'MALE',
            birthDate: '2023-01-20',
            purchaseDate: '2023-06-15',
            purchaseCost: 60000,
            currentWeightKg: 310,
            accumulatedFeedCost: 18000,
            accumulatedMedCost: 2000,
            accumulatedLabourCost: 4500,
            otherCosts: 0,
            totalCost: 84500,
            status: 'ACTIVE',
            location: 'শেড নং ২ (ফ্যাটেনিং)',
            synced: false
          }
        ];
        await db.animals.bulkPut(seedA);
        aList = seedA;
      }
      setAnimals(aList);

      // Seed default fish batches if empty
      let fList = await db.fishBatches.toArray();
      if (fList.length === 0) {
        const seedF: FishBatch[] = [
          {
            id: 'FISH-P1-24',
            pondId: 'p1',
            pondName: '১ নং প্রধান পুকুর (কার্প মিশ্র চাষ)',
            species: 'রুই, কাতলা ও মৃগেল',
            stockingDate: '2024-02-01',
            fingerlingQty: 3000,
            fingerlingCost: 18000,
            totalFeedKg: 1200,
            totalFeedCost: 68000,
            mortalityCount: 150,
            currentEstimatedWeightKg: 750,
            status: 'ACTIVE',
            synced: false
          }
        ];
        await db.fishBatches.bulkPut(seedF);
        fList = seedF;
      }
      setFishBatches(fList);

      // Seed default crop cycles if empty
      let cList = await db.cropCycles.toArray();
      if (cList.length === 0) {
        const seedC: CropCycle[] = [
          {
            id: 'CROP-NAP-01',
            plotId: 'plot1',
            plotName: 'দক্ষিণ খণ্ড (প্লট-১)',
            cropName: 'সুপার নেপিয়ার ঘাস (গবাদিপশুর খাদ্য)',
            cropCategory: 'FODDER',
            areaDecimals: 50,
            plantingDate: '2024-01-15',
            expectedHarvestDate: '2024-05-15',
            seedCost: 5000,
            fertilizerCost: 6500,
            irrigationCost: 2000,
            labourCost: 8000,
            otherCost: 0,
            totalCost: 21500,
            harvestYieldKg: 12000,
            harvestRevenue: 0,
            internalConsumptionKg: 12000,
            status: 'GROWING',
            synced: false
          }
        ];
        await db.cropCycles.bulkPut(seedC);
        cList = seedC;
      }
      setCropCycles(cList);

      if (tab === 'flows') {
        const flowList = await db.internalFlows.orderBy('date').reverse().toArray();
        setInternalFlows(flowList);
      } else if (tab === 'processing') {
        const prList = await db.processingRuns.orderBy('date').reverse().toArray();
        setProcessingRuns(prList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAnimal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const pCost = parseFloat(purchaseCost) || 0;
      const anId = tagId.trim() || generateTransactionNumber('COW');
      const animal: Animal = {
        id: anId,
        tag: anId,
        species,
        breed: breed.trim(),
        gender,
        birthDate: new Date().toISOString().split('T')[0],
        purchaseDate: new Date().toISOString().split('T')[0],
        purchaseCost: pCost,
        currentWeightKg: parseFloat(currentWeight) || 0,
        accumulatedFeedCost: 0,
        accumulatedMedCost: 0,
        accumulatedLabourCost: 0,
        otherCosts: 0,
        totalCost: pCost,
        status: 'ACTIVE',
        location: 'প্রধান শেড',
        synced: false
      };
      await safeInsert(db.animals, animal, { idPrefix: 'COW' });
      setShowAddAnimal(false);
      setTagId('');
      setMsg({ type: 'success', text: `পশু ট্যাগ ${animal.id} সফলভাবে যুক্ত হয়েছে!` });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddFish = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fCost = parseFloat(fingerlingCost) || 0;
      const batch: FishBatch = {
        id: generateTransactionNumber('FISH'),
        pondId: generateUniqueId('pond'),
        pondName: pondName.trim(),
        species: fishSpecies.trim(),
        stockingDate: new Date().toISOString().split('T')[0],
        fingerlingQty: parseInt(fingerlingQty) || 1000,
        fingerlingCost: fCost,
        totalFeedKg: 0,
        totalFeedCost: 0,
        mortalityCount: 0,
        currentEstimatedWeightKg: 0,
        status: 'ACTIVE',
        synced: false
      };
      await safeInsert(db.fishBatches, batch, { idPrefix: 'FISH' });
      setShowAddFish(false);
      setMsg({ type: 'success', text: `মাছের ব্যাচ ${batch.id} যুক্ত হয়েছে!` });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddCrop = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cycle: CropCycle = {
        id: generateTransactionNumber('CROP'),
        plotId: generateUniqueId('plt'),
        plotName: plotName.trim(),
        cropName: cropName.trim(),
        cropCategory: 'FODDER',
        areaDecimals: parseFloat(cropArea) || 0,
        plantingDate: new Date().toISOString().split('T')[0],
        expectedHarvestDate: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
        seedCost: 0,
        fertilizerCost: 0,
        irrigationCost: 0,
        labourCost: 0,
        otherCost: 0,
        totalCost: 0,
        harvestYieldKg: 0,
        harvestRevenue: 0,
        internalConsumptionKg: 0,
        status: 'GROWING',
        synced: false
      };
      await safeInsert(db.cropCycles, cycle, { idPrefix: 'CROP' });
      setShowAddCrop(false);
      setMsg({ type: 'success', text: `শস্য/ঘাস চক্র ${cycle.id} তৈরি হয়েছে!` });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddInternalFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const flow: InternalFlow = {
        id: generateUniqueId('flow'),
        date: new Date().toISOString().split('T')[0],
        resource: flowResource,
        source: flowSource.trim(),
        destination: flowDestination.trim(),
        quantity: parseFloat(flowQty) || 0,
        unit: 'কেজি',
        internalCostValuation: parseFloat(flowValue) || 0,
        notes: flowDesc.trim(),
        synced: false
      };
      await safeInsert(db.internalFlows, flow, { idPrefix: 'flow' });
      setShowAddFlow(false);
      setMsg({ type: 'success', text: 'অভ্যন্তরীণ স্থানান্তর রেকর্ড সম্পন্ন!' });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Tractor className="w-5 h-5 text-[#1E5128]" />
            <span>সমন্বিত খামার ব্যবস্থাপনা (Agro Operations)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            গরু-ছাগল ফ্যাটেনিং/দুগ্ধ খামার, মৎস্য হ্যাচারি, নেপিয়ার ঘাস, বায়ো-ফ্লো ও প্রসেসিং
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
          <button
            onClick={() => setTab('livestock')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'livestock' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            গবাদিপশু (Livestock)
          </button>
          <button
            onClick={() => setTab('fisheries')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'fisheries' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            মৎস্য চাষ (Fisheries)
          </button>
          <button
            onClick={() => setTab('crops')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'crops' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            শস্য ও ঘাস (Crops)
          </button>
          <button
            onClick={() => setTab('flows')}
            className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
              tab === 'flows' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
            }`}
          >
            অভ্যন্তরীণ প্রবাহ (Flows)
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
          {msg.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* ===================== TAB 1: LIVESTOCK ===================== */}
      {tab === 'livestock' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1E5128]" />
                <span>গবাদিপশু প্রোফাইল ও উৎপাদন সূচক ({animals.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">প্রতিটি প্রাণীর স্বতন্ত্র ক্রয়মূল্য, ওজন ও ক্রমবর্ধমান খাদ্য খরচ</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddAnimal(!showAddAnimal)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন পশু নিবন্ধন</span>
              </button>
            )}
          </div>

          {showAddAnimal && (
            <form onSubmit={handleAddAnimal} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন গবাদিপশু তথ্য যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <input
                  type="text"
                  placeholder="ট্যাগ নং (যেমন: COW-105)"
                  value={tagId}
                  onChange={(e) => setTagId(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <select
                  value={species}
                  onChange={(e) => setSpecies(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="CATTLE">গরু (Cattle)</option>
                  <option value="GOAT">ছাগল (Goat)</option>
                  <option value="SHEEP">ভেড়া (Sheep)</option>
                </select>
                <input
                  type="text"
                  placeholder="জাত (Breed)"
                  value={breed}
                  onChange={(e) => setBreed(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="FEMALE">মাদি (Female)</option>
                  <option value="MALE">মদ্দা (Male)</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বর্তমান ওজন (কেজি)</label>
                  <input
                    type="number"
                    value={currentWeight}
                    onChange={(e) => setCurrentWeight(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddAnimal(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  নিবন্ধন করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {animals.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-[#1E5128] text-[15px]">{a.id}</span>
                    <h4 className="font-bold text-gray-900 text-[14px]">{a.breed}</h4>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-700 font-semibold">
                    {a.gender === 'FEMALE' ? 'গাভী' : 'ষাঁড়'} ({a.currentWeightKg} কেজি)
                  </span>
                </div>

                <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-600">ক্রয়মূল্য:</span>
                    <span className="font-semibold text-gray-900">{fmt(a.purchaseCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">খাদ্য খরচ:</span>
                    <span className="font-semibold text-amber-700">{fmt(a.accumulatedFeedCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">ওষুধ ও লেবার:</span>
                    <span className="font-semibold text-gray-900">{fmt(a.accumulatedMedCost + a.accumulatedLabourCost)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900 pt-1.5 border-t border-gray-200 text-[14px]">
                    <span>মোট পুঞ্জীভূত খরচ:</span>
                    <span className="text-[#15803D]">{fmt(a.totalCost)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 2: FISHERIES ===================== */}
      {tab === 'fisheries' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Fish className="w-5 h-5 text-sky-600" />
                <span>মৎস্য চাষ ও পুকুর ব্যাচ ({fishBatches.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">পোনা মজুদের হিসাব, ফিড খরচ ও মরটালিটি ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddFish(!showAddFish)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন মাছের ব্যাচ</span>
              </button>
            )}
          </div>

          {showAddFish && (
            <form onSubmit={handleAddFish} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন মাছের ব্যাচ মজুদ</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="পুকুরের নাম (যেমন: পশ্চিম পুকুর)"
                  value={pondName}
                  onChange={(e) => setPondName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  required
                  placeholder="মাছের প্রজাতি (যেমন: কার্প ও পাবদা)"
                  value={fishSpecies}
                  onChange={(e) => setFishSpecies(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="number"
                  placeholder="পোনা সংখ্যা (Qty)"
                  value={fingerlingQty}
                  onChange={(e) => setFingerlingQty(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="পোনা ক্রয়ের মোট খরচ ৳"
                  value={fingerlingCost}
                  onChange={(e) => setFingerlingCost(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddFish(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  ব্যাচ তৈরি করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {fishBatches.map((b) => (
              <div
                key={b.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-sky-700 text-[14px]">{b.id}</span>
                    <h4 className="font-bold text-gray-900 text-[15px]">{b.pondName}</h4>
                    <p className="text-[13px] text-gray-600">{b.species}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold">
                    {b.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-600">মজুদ পোনা:</span>
                    <span className="font-semibold text-gray-900">{b.fingerlingQty} টি</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">পোনা খরচ:</span>
                    <span className="font-semibold text-gray-900">{fmt(b.fingerlingCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মোট ফিড প্রয়োগ:</span>
                    <span className="font-semibold text-amber-700">{b.totalFeedKg} কেজি ({fmt(b.totalFeedCost)})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মৃত পোনা সংখ্যা:</span>
                    <span className="font-semibold text-red-600">{b.mortalityCount} টি</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: CROPS & FODDER ===================== */}
      {tab === 'crops' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Wheat className="w-5 h-5 text-amber-600" />
                <span>শস্য ও নেপিয়ার ঘাস চাষ ({cropCycles.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">ঘাস চাষ, সার প্রয়োগ, সেচ ও ফসল কর্তন ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddCrop(!showAddCrop)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন শস্য চক্র</span>
              </button>
            )}
          </div>

          {showAddCrop && (
            <form onSubmit={handleAddCrop} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন শস্য চক্র যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="জমির প্লট (যেমন: প্লট-২ উত্তর)"
                  value={plotName}
                  onChange={(e) => setPlotName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  required
                  placeholder="ফসলের নাম (যেমন: পাকচং নেপিয়ার)"
                  value={cropName}
                  onChange={(e) => setCropName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="জমির পরিমাণ (শতাংশ)"
                  value={cropArea}
                  onChange={(e) => setCropArea(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddCrop(false)}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {cropCycles.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-amber-700 text-[14px]">{c.id}</span>
                    <h4 className="font-bold text-gray-900 text-[15px]">{c.cropName}</h4>
                    <p className="text-[13px] text-gray-600">{c.plotName} ({c.areaDecimals} শতাংশ)</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                    {c.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-600">রোপণের তারিখ:</span>
                    <span className="font-medium text-gray-900">{c.plantingDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মোট চাষ খরচ:</span>
                    <span className="font-semibold text-red-600">{fmt(c.totalCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">কর্তনকৃত ফলন:</span>
                    <span className="text-[#15803D] font-bold">{c.harvestYieldKg} কেজি</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 4: INTERNAL FLOWS ===================== */}
      {tab === 'flows' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#1E5128]" />
                <span>অভ্যন্তরীণ সমন্বিত সম্পদ স্থানান্তর (Circular Bio-Flows)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                গোবর পুকুর বা ফসলে প্রয়োগ, কিংবা উৎপাদিত নেপিয়ার ঘাস গরুকে খাওয়ানো (ডাবল-কাউন্টিং মুক্ত)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddFlow(!showAddFlow)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন স্থানান্তর</span>
              </button>
            )}
          </div>

          {showAddFlow && (
            <form onSubmit={handleAddInternalFlow} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন বায়ো-ফ্লো রেকর্ড</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select
                  value={flowResource}
                  onChange={(e) => setFlowResource(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="MANURE">গোবর সার (Manure)</option>
                  <option value="COMPOST">কম্পোস্ট সার (Compost)</option>
                  <option value="FODDER_GRASS">নেপিয়ার ঘাস (Fodder Grass)</option>
                  <option value="CROP_RESIDUE">ফসলের উচ্ছিষ্টাংশ (Crop Residue)</option>
                  <option value="OTHER">অন্যান্য জৈব উপাদান</option>
                </select>
                <input
                  type="text"
                  placeholder="উৎস (যেমন: ডেইরি শেড)"
                  value={flowSource}
                  onChange={(e) => setFlowSource(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  placeholder="গন্তব্য (যেমন: মাছের পুকুর)"
                  value={flowDestination}
                  onChange={(e) => setFlowDestination(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  placeholder="বিবরণ"
                  value={flowDesc}
                  onChange={(e) => setFlowDesc(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="পরিমাণ (কেজি)"
                  value={flowQty}
                  onChange={(e) => setFlowQty(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="আনুমানিক আর্থিক মূল্য ৳"
                  value={flowValue}
                  onChange={(e) => setFlowValue(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddFlow(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  রেকর্ড করুন
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2.5">
            {internalFlows.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-[14px]">
                কোনো অভ্যন্তরীণ প্রবাহ রেকর্ড করা নেই।
              </div>
            ) : (
              internalFlows.map((fl) => (
                <div
                  key={fl.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] border border-gray-200 text-[14px] gap-2"
                >
                  <div>
                    <div className="font-bold text-gray-900">{fl.notes || fl.resource}</div>
                    <div className="text-[13px] text-gray-600">
                      {fl.source} ➔ {fl.destination} | তারিখ: {fl.date} | পরিমাণ: {fl.quantity} {fl.unit}
                    </div>
                  </div>
                  <div className="font-bold text-[#15803D] font-mono text-[15px]">
                    মূল্য: {fmt(fl.internalCostValuation)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
